// Lane: logic (docs/testing.md).
// Seam: the exported OpenCascadeKernelAdapter lifecycle (commitSketch, tail-append
// createFeature join, updateFeature owner replacement, rejected createFeature and
// evaluatePreview candidates, repeated dispose) on a real OCC instance. Runtime
// binding patches make Handle_TNaming_NamedShape deletes throw before deleting, and
// an independent ledger records, at every TDocStd_Document delete, whether a failed
// attribute handle of that document is still live.
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { readFile } from "node:fs/promises";
import { expect, test } from "vitest";

import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type {
  BodyId,
  FeatureId,
  RegionId,
  RevisionId,
  SketchId,
} from "@/contracts/shared/ids";
import { EXTRUDE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  collectOccCleanupErrors,
  OccCleanupError,
} from "@/domain/modeling/occ/memory";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { OpenCascadeKernelAdapter } from "@/domain/modeling/opencascade-kernel-adapter";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

type W = { delete(): void; isDeleted(): boolean };
type Prototype = { delete(this: W): void };

async function loadOc(): Promise<OpenCascadeInstance> {
  const mod = (await import("../../../public/cadara-occ.js")) as unknown as {
    default: new (m: Record<string, unknown>) => Promise<OpenCascadeInstance>;
  };
  const wasmBinary = new Uint8Array(
    await readFile(new URL("../../../public/cadara-occ.wasm", import.meta.url)),
  );
  return new mod.default({ wasmBinary });
}

/**
 * Independent naming ledger plus handle-delete fault. `armed` fails the next
 * NamedShape handle delete; `sticky` keeps already-failed handles failing.
 */
function makeNamingLedger(oc: OpenCascadeInstance) {
  const classes = oc as unknown as Record<string, unknown>;
  const fault = {
    armed: false,
    sticky: false,
    failed: [] as W[],
    error: (): unknown =>
      new Error("injected NamedShape handle delete failure"),
  };
  const handleAttempts = new Map<W, number>();
  const documents: W[] = [];
  const documentDeletes = new Map<W, number>();
  const documentDeleteEvents: { document: W; failedHandlesLive: number }[] = [];

  const handle = (classes.Handle_TNaming_NamedShape as { prototype: Prototype })
    .prototype;
  const deleteHandle = handle.delete;
  handle.delete = function (this: W) {
    handleAttempts.set(this, (handleAttempts.get(this) ?? 0) + 1);
    if (fault.sticky && fault.failed.includes(this)) throw fault.error();
    if (fault.armed) {
      fault.armed = false;
      fault.failed.push(this);
      throw fault.error();
    }
    deleteHandle.call(this);
  };

  const Document = classes.TDocStd_Document as {
    prototype: Prototype;
  } & (new (...args: unknown[]) => W);
  const deleteDocument = Document.prototype.delete;
  Document.prototype.delete = function (this: W) {
    documentDeletes.set(this, (documentDeletes.get(this) ?? 0) + 1);
    documentDeleteEvents.push({
      document: this,
      failedHandlesLive: fault.failed.filter((h) => !h.isDeleted()).length,
    });
    deleteDocument.call(this);
  };
  classes.TDocStd_Document = new Proxy(Document, {
    construct(target, args) {
      const created = Reflect.construct(target, args) as W;
      documents.push(created);
      return created;
    },
  });

  return {
    fault,
    documents,
    handleAttempts,
    documentDeletes,
    /** Deletes of `watched` documents that happened while a failed handle was live. */
    unsafeDeletes: (watched: readonly W[]) =>
      documentDeleteEvents.filter(
        (e) => watched.includes(e.document) && e.failedHandlesLive > 0,
      ),
    liveDocuments: () => documents.filter((d) => !d.isDeleted()),
  };
}

/** A retry that keeps surfacing a *new* retry closure until `stop` is set. */
function makeFreshRetryChain() {
  const chain = {
    stop: false,
    call: 0,
    sameCallInvocations: 0,
    invocations: 0,
    maxGeneration: 0,
    error: (generation = 0): OccCleanupError => {
      const createdInCall = chain.call;
      chain.maxGeneration = Math.max(chain.maxGeneration, generation);
      return new OccCleanupError(
        [new Error(`fresh retry generation ${generation}`)],
        () => {
          chain.invocations += 1;
          if (createdInCall === chain.call) chain.sameCallInvocations += 1;
          // The cap only keeps an unbounded pass from hanging the red run.
          if (chain.stop || generation >= 256) return;
          throw chain.error(generation + 1);
        },
      );
    },
  };
  return chain;
}

function leafErrors(error: unknown): unknown[] {
  return error instanceof AggregateError
    ? error.errors.flatMap(leafErrors)
    : [error];
}

function messages(error: unknown) {
  return leafErrors(error).map((e) => (e instanceof Error ? e.message : e));
}

const req = {
  contractVersion: "modeling-contract/v1alpha1",
  documentId: "doc_workspace",
} as const;

function extrude(
  sketchId: SketchId,
  regionId: RegionId,
  distance: number,
  joinBodyId?: BodyId,
): FeatureDefinition {
  return {
    kind: "extrude",
    featureTypeVersion: EXTRUDE_FEATURE_SCHEMA_VERSION,
    parameters: {
      resultBodyType: "solid",
      profiles: [{ kind: "region", sketchId, regionId }],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: {
          kind: "blind",
          direction: "positive",
          distance: { source: "literal", value: distance },
        },
      },
      operation: {
        source: "literal",
        value: joinBodyId ? ("join" as const) : ("newBody" as const),
      },
      booleanScope: joinBodyId
        ? { kind: "targetBody", bodyId: joinBodyId }
        : { kind: "standalone" },
    },
  };
}

type RuntimeView = {
  runtimeState: {
    authoringState: {
      revisionId: RevisionId;
      bodies: { bodyId: BodyId; shape: W; naming?: { document: W } }[];
    };
  } | null;
};

/** Base extrude (tail-appended, keeps stored naming document D). */
async function makeAdapterWithNamedBody() {
  const oc = await loadOc();
  const ledger = makeNamingLedger(oc);
  const createSolver = (revisionId: RevisionId | null) =>
    new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      revisionId,
    });
  const adapter = new OpenCascadeKernelAdapter({
    createSolverAdapter: createSolver,
    getOpenCascadeInstance: async () => oc,
  });
  const seed = await new MockKernelAdapter().getDocumentSnapshot(req);
  const source = seed.snapshot.document.sketches[0]!;
  const empty = await adapter.getDocumentSnapshot(req);
  await adapter.commitSketch({
    ...req,
    baseRevisionId: empty.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_gate",
      projectionRequestId: "request_gate:project",
      validationRequestId: "request_gate:validate",
      solveRequestId: "request_gate:solve",
      regionRequestId: "request_gate:regions",
    },
    sketchId: source.sketchId,
    restoreRecordedSketchId: true,
    sketchLabel: source.label,
    plane: source.plane,
    definition: source.sketch.definition,
  });
  const after = await adapter.getDocumentSnapshot(req);
  const sketch = after.snapshot.document.sketches[0]!;
  const regionId = sketch.sketch.regions[0]!.regionId;
  const created = await adapter.createFeature({
    ...req,
    baseRevisionId: after.snapshot.document.revisionId,
    definition: extrude(sketch.sketchId, regionId, 2),
  });
  expect(created.revisionState.kind).toBe("accepted");
  const view = adapter as unknown as RuntimeView;
  const runtime = () => view.runtimeState!.authoringState;
  const borrowed = runtime().bodies[0]!.naming?.document;
  expect(
    borrowed,
    "the tail-appended base body keeps stored naming",
  ).toBeDefined();
  expect(ledger.documents).toContain(borrowed);
  const featureId = created.featureId as FeatureId;

  return {
    oc,
    ledger,
    adapter,
    runtime,
    borrowed: borrowed!,
    featureId,
    created,
    async join(revisionId: RevisionId) {
      const before = ledger.documents.length;
      const error = await adapter
        .createFeature({
          ...req,
          baseRevisionId: revisionId,
          definition: extrude(
            sketch.sketchId,
            regionId,
            3.5,
            runtime().bodies[0]!.bodyId,
          ),
        })
        .then(
          () => undefined,
          (e: unknown) => e,
        );
      return { error, newDocuments: ledger.documents.slice(before) };
    },
    update(distance: number) {
      return adapter.updateFeature({
        ...req,
        baseRevisionId:
          view.runtimeState?.authoringState.revisionId ?? created.revisionId,
        featureId,
        definition: extrude(sketch.sketchId, regionId, distance),
      });
    },
    createRejected() {
      return adapter.createFeature({
        ...req,
        baseRevisionId: runtime().revisionId,
        definition: extrude(sketch.sketchId, regionId, 0),
      });
    },
    preview() {
      return adapter.evaluatePreview({
        ...req,
        baseRevisionId: runtime().revisionId,
        previewId: "preview_gate",
        definition: extrude(sketch.sketchId, regionId, 5),
      });
    },
    dispose() {
      try {
        adapter.dispose();
        return undefined;
      } catch (error) {
        return error;
      }
    },
  };
}

function expectJoinCleanupFailure(error: unknown, injected: string) {
  expect(
    collectOccCleanupErrors(error).length,
    "the failed join surfaces a cleanup retry",
  ).toBeGreaterThan(0);
  expect(messages(error)).toContain(injected);
}

test("A: a transient handle failure on a borrowed join is retried before owner-replacing updates free its document", async () => {
  const s = await makeAdapterWithNamedBody();
  s.ledger.fault.armed = true;
  const join = await s.join(s.created.revisionId);
  expectJoinCleanupFailure(
    join.error,
    "injected NamedShape handle delete failure",
  );
  const [failed] = s.ledger.fault.failed;
  expect(failed, "a NamedShape handle delete failed").toBeDefined();

  for (const distance of [3, 4]) {
    const updated = await s.update(distance);
    expect(updated.revisionState.kind).toBe("accepted");
    const snapshot = await s.adapter.getDocumentSnapshot(req);
    expect(snapshot.snapshot.document.revisionId).toBe(updated.revisionId);
    expect(snapshot.snapshot.document.bodies).toHaveLength(1);
  }
  expect(
    s.ledger.unsafeDeletes([s.borrowed]),
    "the borrowed document is never deleted while its failed handle is live",
  ).toEqual([]);

  expect(
    s.dispose(),
    "dispose completes without a trap or error",
  ).toBeUndefined();
  expect(failed!.isDeleted()).toBe(true);
  expect(
    s.ledger.handleAttempts.get(failed!),
    "only the failed handle is retried",
  ).toBe(2);
  expect(
    [...s.ledger.handleAttempts].filter(([h, n]) => h !== failed && n !== 1),
  ).toEqual([]);
  expect(s.ledger.liveDocuments(), "every naming document is released").toEqual(
    [],
  );
  expect([...s.ledger.documentDeletes.values()].every((n) => n === 1)).toBe(
    true,
  );
});

for (const disposals of [2, 3]) {
  test(`B: persistent handle failure keeps the disposed owner graph across ${disposals - 1} failing dispose(s), then drains`, async () => {
    const s = await makeAdapterWithNamedBody();
    s.ledger.fault.armed = true;
    s.ledger.fault.sticky = true;
    const join = await s.join(s.created.revisionId);
    expectJoinCleanupFailure(
      join.error,
      "injected NamedShape handle delete failure",
    );
    const [failed] = s.ledger.fault.failed;

    for (let attempt = 1; attempt < disposals; attempt += 1) {
      const error = s.dispose();
      expect(
        error,
        `dispose ${attempt} surfaces the failed retry`,
      ).toBeInstanceOf(AggregateError);
      expect(messages(error)).toContain(
        "injected NamedShape handle delete failure",
      );
      expect(collectOccCleanupErrors(error).length).toBeGreaterThan(0);
      expect(s.borrowed.isDeleted(), "the borrowed document is retained").toBe(
        false,
      );
      expect(failed!.isDeleted()).toBe(false);
      await expect(s.update(5), "disposal stays final").rejects.toThrow(
        "OpenCascade kernel adapter has been disposed.",
      );
    }

    s.ledger.fault.sticky = false;
    expect(
      s.dispose(),
      "the final dispose drains without error",
    ).toBeUndefined();
    expect(failed!.isDeleted()).toBe(true);
    expect(s.ledger.unsafeDeletes([s.borrowed])).toEqual([]);
    expect(s.borrowed.isDeleted()).toBe(true);
    expect(s.ledger.liveDocuments()).toEqual([]);
    expect([...s.ledger.documentDeletes.values()].every((n) => n === 1)).toBe(
      true,
    );
    expect(
      s.dispose(),
      "a drained adapter disposes idempotently",
    ).toBeUndefined();
  });
}

test("C (control): a transient borrowed-join failure followed directly by dispose releases everything", async () => {
  const s = await makeAdapterWithNamedBody();
  s.ledger.fault.armed = true;
  const join = await s.join(s.created.revisionId);
  expectJoinCleanupFailure(
    join.error,
    "injected NamedShape handle delete failure",
  );
  const [failed] = s.ledger.fault.failed;
  expect(s.dispose()).toBeUndefined();
  expect(failed!.isDeleted()).toBe(true);
  expect(s.ledger.unsafeDeletes([s.borrowed])).toEqual([]);
  expect(s.ledger.liveDocuments()).toEqual([]);
});

test("E (control): a seeded join document stays deferred behind its persistent handle until the retry succeeds", async () => {
  const s = await makeAdapterWithNamedBody();
  // The update rebuild drops stored naming, so the next join seeds local naming.
  const updated = await s.update(2.5);
  expect(updated.revisionState.kind).toBe("accepted");
  expect(s.runtime().bodies[0]!.naming).toBeUndefined();
  s.ledger.fault.armed = true;
  s.ledger.fault.sticky = true;
  const join = await s.join(updated.revisionId);
  expectJoinCleanupFailure(
    join.error,
    "injected NamedShape handle delete failure",
  );
  expect(join.newDocuments).toHaveLength(1);
  const [failed] = s.ledger.fault.failed;

  const first = s.dispose();
  expect(messages(first)).toContain(
    "injected NamedShape handle delete failure",
  );
  expect(join.newDocuments[0]!.isDeleted()).toBe(false);
  s.ledger.fault.sticky = false;
  expect(s.dispose()).toBeUndefined();
  expect(failed!.isDeleted()).toBe(true);
  expect(s.ledger.unsafeDeletes(join.newDocuments)).toEqual([]);
  expect(s.ledger.liveDocuments()).toEqual([]);
});

test("owner replacement under a persistent retry failure publishes, surfaces the failure, parks old graphs, and drains them oldest first", async () => {
  const s = await makeAdapterWithNamedBody();
  s.ledger.fault.armed = true;
  s.ledger.fault.sticky = true;
  const join = await s.join(s.created.revisionId);
  expectJoinCleanupFailure(
    join.error,
    "injected NamedShape handle delete failure",
  );
  const [failed] = s.ledger.fault.failed;

  let revision = s.created.revisionId;
  for (const distance of [3, 4]) {
    const error = await s.update(distance).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(
      error,
      "the failed retry pass surfaces through the update",
    ).toBeInstanceOf(AggregateError);
    expect(messages(error)).toContain(
      "injected NamedShape handle delete failure",
    );
    expect(collectOccCleanupErrors(error).length).toBeGreaterThan(0);
    // replaceRuntimeState publishes before releasing the old owner graph.
    const snapshot = await s.adapter.getDocumentSnapshot(req);
    expect(snapshot.snapshot.document.revisionId).not.toBe(revision);
    expect(snapshot.snapshot.document.bodies).toHaveLength(1);
    revision = snapshot.snapshot.document.revisionId;
    expect(
      s.borrowed.isDeleted(),
      "the parked owner graph keeps its document",
    ).toBe(false);
  }

  s.ledger.fault.sticky = false;
  const drained = await s.update(5);
  expect(drained.revisionState.kind).toBe("accepted");
  expect(failed!.isDeleted()).toBe(true);
  expect(
    s.borrowed.isDeleted(),
    "parked graphs drain after a successful pass",
  ).toBe(true);
  expect(s.ledger.unsafeDeletes([s.borrowed])).toEqual([]);
  const current = await s.adapter.getDocumentSnapshot(req);
  expect(current.snapshot.document.revisionId).toBe(drained.revisionId);
  expect(current.snapshot.document.bodies).toHaveLength(1);
  expect(s.runtime().bodies[0]!.shape.isDeleted()).toBe(false);

  expect(s.dispose()).toBeUndefined();
  expect(s.ledger.liveDocuments()).toEqual([]);
  expect([...s.ledger.documentDeletes.values()].every((n) => n === 1)).toBe(
    true,
  );
  expect(
    [...s.ledger.handleAttempts].filter(([h, n]) => h !== failed && n !== 1),
    "no other handle is retried or deleted twice",
  ).toEqual([]);
});

test("each dispose runs one bounded pass over a retry that keeps surfacing new retries and surfaces the newest failure", async () => {
  const s = await makeAdapterWithNamedBody();
  const chain = makeFreshRetryChain();
  s.ledger.fault.error = () => chain.error();
  s.ledger.fault.armed = true;
  s.ledger.fault.sticky = true;
  const join = await s.join(s.created.revisionId);
  expectJoinCleanupFailure(join.error, "fresh retry generation 0");

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    chain.call += 1;
    const error = s.dispose();
    expect(
      chain.sameCallInvocations,
      `dispose ${attempt} runs one bounded pass`,
    ).toBe(0);
    expect(error).toBeInstanceOf(AggregateError);
    expect(messages(error)).toContain(`fresh retry generation ${attempt}`);
    expect(s.borrowed.isDeleted()).toBe(false);
  }

  chain.stop = true;
  s.ledger.fault.sticky = false;
  expect(s.dispose()).toBeUndefined();
  expect(s.ledger.unsafeDeletes([s.borrowed])).toEqual([]);
  expect(s.ledger.liveDocuments()).toEqual([]);
});

test("rejected and preview candidates behind a retry that keeps surfacing new retries: bounded passes, surfaced errors, shared owners kept", async () => {
  const s = await makeAdapterWithNamedBody();
  // Without a pending retry the same requests keep their ordinary results.
  expect((await s.createRejected()).revisionState.kind).toBe("rejected");
  expect((await s.preview()).render.records.length).toBeGreaterThan(0);
  const chain = makeFreshRetryChain();
  s.ledger.fault.error = () => chain.error();
  s.ledger.fault.armed = true;
  s.ledger.fault.sticky = true;
  const join = await s.join(s.created.revisionId);
  expectJoinCleanupFailure(join.error, "fresh retry generation 0");
  const [failed] = s.ledger.fault.failed;
  const accepted = s.runtime();
  const acceptedBody = accepted.bodies[0]!;

  const candidateDocuments: W[] = [];
  const operations = [
    { name: "rejected createFeature", run: () => s.createRejected() },
    { name: "evaluatePreview", run: () => s.preview() },
  ];
  for (const operation of operations) {
    chain.call += 1;
    const before = s.ledger.documents.length;
    const error = await operation.run().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(
      chain.sameCallInvocations,
      `${operation.name} runs one bounded pass`,
    ).toBe(0);
    expect(error, `${operation.name} surfaces the failed pass`).toBeInstanceOf(
      AggregateError,
    );
    expect(
      messages(error).some((m) =>
        /fresh retry generation [1-9]/.test(String(m)),
      ),
      `${operation.name} surfaces the newly nested retry failure`,
    ).toBe(true);
    // Documents deleted inside the operation were build temporaries; the
    // remaining ones belong to the parked candidate graph.
    const parked = s.ledger.documents
      .slice(before)
      .filter((d) => !d.isDeleted());
    candidateDocuments.push(...parked);
    expect(s.runtime(), "the accepted state is unchanged").toBe(accepted);
    expect(s.borrowed.isDeleted()).toBe(false);
    expect(acceptedBody.shape.isDeleted()).toBe(false);
    const snapshot = await s.adapter.getDocumentSnapshot(req);
    expect(snapshot.snapshot.document.revisionId).toBe(accepted.revisionId);
    expect(snapshot.snapshot.document.bodies).toHaveLength(1);
  }
  expect(
    candidateDocuments.length,
    "the preview candidate's naming document is parked, not released",
  ).toBeGreaterThan(0);

  chain.call += 1;
  const disposeError = s.dispose();
  expect(chain.sameCallInvocations, "dispose runs one bounded pass").toBe(0);
  expect(
    chain.maxGeneration,
    "each call advances a retry chain at most once",
  ).toBeLessThan(8);
  expect(disposeError).toBeInstanceOf(AggregateError);
  expect(
    messages(disposeError).some((m) =>
      /fresh retry generation [1-9]/.test(String(m)),
    ),
  ).toBe(true);
  expect(s.borrowed.isDeleted()).toBe(false);
  expect(candidateDocuments.filter((d) => d.isDeleted())).toEqual([]);

  chain.stop = true;
  s.ledger.fault.sticky = false;
  chain.call += 1;
  expect(
    s.dispose(),
    "the drain completes once every retry succeeds",
  ).toBeUndefined();
  expect(failed!.isDeleted()).toBe(true);
  expect(s.ledger.unsafeDeletes([s.borrowed, ...candidateDocuments])).toEqual(
    [],
  );
  expect(s.ledger.liveDocuments()).toEqual([]);
  expect([...s.ledger.documentDeletes.values()].every((n) => n === 1)).toBe(
    true,
  );
});
