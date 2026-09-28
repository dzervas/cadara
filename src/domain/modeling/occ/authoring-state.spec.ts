import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

import type { FeatureDefinition } from "@/contracts/modeling/schema";
import type { BodyId, FeatureId } from "@/contracts/shared/ids";
import {
  EXTRUDE_FEATURE_SCHEMA_VERSION,
  SHELL_FEATURE_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";

const releaseFailures = vi.hoisted(() => ({
  /** Thrown, before releasing, by the next releaseOccObjects call containing a matching object. */
  objects: [] as { matches: (object: unknown) => boolean; error: unknown }[],
  discarded: [] as unknown[],
}));
const releaseCalls = vi.hoisted(() => ({ discarded: [] as unknown[] }));

vi.mock("@/domain/modeling/occ/memory", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/domain/modeling/occ/memory")>();
  return {
    ...actual,
    releaseDiscardedOccAuthoringStateObjects: (
      ...args: Parameters<
        typeof actual.releaseDiscardedOccAuthoringStateObjects
      >
    ) => {
      releaseCalls.discarded.push(args[0]);
      const failure = releaseFailures.discarded.shift();
      if (failure) throw failure;
      return actual.releaseDiscardedOccAuthoringStateObjects(...args);
    },
    releaseOccObjects: (
      ...args: Parameters<typeof actual.releaseOccObjects>
    ) => {
      const objects = [...args[0]];
      const failure = releaseFailures.objects[0];
      if (failure && objects.some(failure.matches)) {
        releaseFailures.objects.shift();
        throw failure.error;
      }
      return actual.releaseOccObjects(objects, args[1]);
    },
  };
});

const {
  applyOccFeatureToAuthoringState,
  createOccAuthoringState,
  rebuildOccAuthoringState,
} = await import("@/domain/modeling/occ/authoring-state");
const {
  OccCleanupError,
  collectOccCleanupErrors,
  releaseDiscardedOccAuthoringStateObjects,
  releaseOccAuthoringStateObjects,
} = await import("@/domain/modeling/occ/memory");
const {
  reconcileReplacementSolidBody,
  trackDerivedSolidBody,
  trackNewSolidBody,
} = await import("@/domain/modeling/occ/topology");
const {
  createOccFeatureTopologyLineageMap,
  serializeOccFeatureTopologyLineage,
} = await import("@/domain/modeling/occ/topology-stage");
const { OpenCascadeKernelAdapter } =
  await import("@/domain/modeling/opencascade-kernel-adapter");

// Lane: logic (docs/testing.md — domain ownership handoff at exported seams).
// Seams: the real OCC adapter create/update/dispose lifecycle, the exported
// authoring-state feature applier/rebuild with injected cleanup failures, and
// the exported topology trackers/reconciler on their failure paths.

type Wrapper = { delete(): void; isDeleted(): boolean };
type Naming = {
  document: Wrapper;
  bodyLabel: Wrapper;
  topologyLabelsByKey: ReadonlyMap<unknown, Wrapper>;
  selectorLabelsByKey: ReadonlyMap<unknown, Wrapper>;
};
type Body = { shape: Wrapper; naming?: Naming };
type Stages = ReadonlyMap<
  unknown,
  { outputs: ReadonlyMap<unknown, { body: Body }> }
>;
type OwnedState = {
  bodies: readonly Body[];
  baseBodies?: readonly Body[];
  featureTopologyStages?: Stages;
  previousFeatureTopologyStages?: Stages;
};

type NamingLedger = {
  documents: Wrapper[];
  labels: Wrapper[];
  /** JS-owned TopoDS copies read from NamedShape attributes, and document storage-format strings. */
  temporaries: Wrapper[];
  /** Builders, selectors and NamedShape attribute handles still undeleted. */
  liveAttributeOwners: Set<Wrapper>;
  /** Attribute owners alive when each naming document was deleted. */
  attributeOwnersLiveAtDocumentDelete: number[];
};

async function loadOpenCascade() {
  const module = (await import("../../../../public/cadara-occ.js")) as {
    default: new (
      module: Record<string, unknown>,
    ) => Promise<OpenCascadeInstance>;
  };
  const wasmBinary = new Uint8Array(
    await readFile(
      new URL("../../../../public/cadara-occ.wasm", import.meta.url),
    ),
  );
  return new module.default({ wasmBinary });
}

/**
 * Observes the naming wrappers that production creates on this private OCC
 * instance: documents, labels, TNaming builders/selectors and the NamedShape
 * attribute handles they expose. Every observed call still runs natively.
 */
function observeNaming(oc: OpenCascadeInstance): NamingLedger {
  const ledger: NamingLedger = {
    documents: [],
    labels: [],
    temporaries: [],
    liveAttributeOwners: new Set(),
    attributeOwnersLiveAtDocumentDelete: [],
  };
  const classes = oc as unknown as Record<
    string,
    { prototype: Record<string, (...args: unknown[]) => unknown> } & Record<
      string,
      unknown
    >
  >;
  const trackDelete = (className: string, onDelete: (w: Wrapper) => void) => {
    const prototype = classes[className]!.prototype;
    const inherited = prototype.delete!;
    prototype.delete = function (this: Wrapper) {
      onDelete(this);
      return inherited.call(this);
    };
  };
  const constructTracked = (
    className: string,
    onCreate: (w: Wrapper) => void,
  ) => {
    const constructor = classes[className] as unknown as new (
      ...args: unknown[]
    ) => Wrapper;
    classes[className] = new Proxy(constructor, {
      construct(target, args) {
        const created = Reflect.construct(target, args) as Wrapper;
        onCreate(created);
        return created;
      },
    }) as never;
  };
  const returnTracked = (
    owner: Record<string, unknown>,
    method: string,
    onReturn: (w: Wrapper) => void,
  ) => {
    const original = owner[method] as (...args: unknown[]) => Wrapper;
    owner[method] = function (this: unknown, ...args: unknown[]) {
      const returned = original.apply(this, args);
      onReturn(returned);
      return returned;
    };
  };
  const attributeOwner = (wrapper: Wrapper) =>
    ledger.liveAttributeOwners.add(wrapper);
  const label = (wrapper: Wrapper) => ledger.labels.push(wrapper);

  for (const className of [
    "TNaming_Builder",
    "TNaming_Selector",
    "Handle_TNaming_NamedShape",
  ]) {
    trackDelete(className, (wrapper) =>
      ledger.liveAttributeOwners.delete(wrapper),
    );
  }
  trackDelete("TDocStd_Document", () =>
    ledger.attributeOwnersLiveAtDocumentDelete.push(
      ledger.liveAttributeOwners.size,
    ),
  );
  returnTracked(classes.TDF_Label!.prototype, "NewChild", label);
  returnTracked(classes.TDocStd_Document!.prototype, "Main", label);
  returnTracked(
    classes.TNaming_Selector!.prototype,
    "NamedShape",
    attributeOwner,
  );
  returnTracked(classes.TNaming_Tool!, "CurrentNamedShape_1", attributeOwner);
  const temporary = (wrapper: Wrapper) => ledger.temporaries.push(wrapper);
  for (const method of ["GetShape", "CurrentShape_1", "CurrentShape_2"]) {
    returnTracked(classes.TNaming_Tool!, method, temporary);
  }
  constructTracked("TCollection_ExtendedString_2", temporary);
  constructTracked("TNaming_Builder", attributeOwner);
  constructTracked("TNaming_Selector", attributeOwner);
  constructTracked("TDocStd_Document", (wrapper) =>
    ledger.documents.push(wrapper),
  );
  return ledger;
}

function acceptedNamingOwners(state: OwnedState) {
  const owners = new Set<Wrapper>();
  const bodies = [...state.bodies, ...(state.baseBodies ?? [])];
  for (const stages of [
    state.featureTopologyStages,
    state.previousFeatureTopologyStages,
  ]) {
    for (const stage of stages?.values() ?? []) {
      for (const output of stage.outputs.values()) bodies.push(output.body);
    }
  }
  for (const body of bodies) {
    if (!body.naming) continue;
    owners.add(body.naming.document);
    owners.add(body.naming.bodyLabel);
    for (const l of body.naming.topologyLabelsByKey.values()) owners.add(l);
    for (const l of body.naming.selectorLabelsByKey.values()) owners.add(l);
  }
  return owners;
}

function extrudeDefinition(
  sketchId: string,
  regionId: string,
  distance: number,
  joinBodyId?: string,
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
        end: { kind: "blind", direction: "positive", distance },
      },
      operation: joinBodyId ? "join" : "newBody",
      booleanScope: joinBodyId
        ? { kind: "targetBody", bodyId: joinBodyId }
        : { kind: "standalone" },
    },
  } as FeatureDefinition;
}

async function seedSketch() {
  const seed = await new MockKernelAdapter().getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const sketch = seed.snapshot.document.sketches[0];
  if (!sketch) throw new Error("Seed sketch is required.");
  return sketch;
}

test("each accepted extrude update releases the naming state dropped by semantic stage reconciliation, after every attribute owner and while accepted naming stays live", async () => {
  const oc = await loadOpenCascade();
  const ledger = observeNaming(oc);
  const createSolver = (revisionId: string | null) =>
    new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      revisionId,
    });
  const adapter = new OpenCascadeKernelAdapter({
    createSolverAdapter: createSolver,
    getOpenCascadeInstance: async () => oc,
  });
  const request = {
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  } as const;
  const source = await seedSketch();
  const empty = await adapter.getDocumentSnapshot(request);
  await adapter.commitSketch({
    ...request,
    baseRevisionId: empty.snapshot.document.revisionId,
    solverCorrelation: {
      requestId: "request_naming",
      projectionRequestId: "request_naming:project",
      validationRequestId: "request_naming:validate",
      solveRequestId: "request_naming:solve",
      regionRequestId: "request_naming:regions",
    },
    sketchId: source.sketchId,
    restoreRecordedSketchId: true,
    sketchLabel: source.label,
    plane: source.plane,
    definition: source.sketch.definition,
  });
  const afterSketch = await adapter.getDocumentSnapshot(request);
  const sketch = afterSketch.snapshot.document.sketches[0]!;
  const regionId = sketch.sketch.regions[0]!.regionId;
  const created = await adapter.createFeature({
    ...request,
    baseRevisionId: afterSketch.snapshot.document.revisionId,
    definition: extrudeDefinition(sketch.sketchId, regionId, 2),
  });
  expect(created.revisionState.kind).toBe("accepted");
  let revisionId = created.revisionId;
  const accepted = () =>
    (
      adapter as unknown as {
        runtimeState: { authoringState: OwnedState } | null;
      }
    ).runtimeState!.authoringState;

  for (let update = 1; update <= 4; update += 1) {
    const documentsBefore = ledger.documents.length;
    const updated = await adapter.updateFeature({
      ...request,
      baseRevisionId: revisionId,
      featureId: created.featureId as FeatureId,
      definition: extrudeDefinition(sketch.sketchId, regionId, 2 + update),
    });
    expect(updated.revisionState.kind).toBe("accepted");
    revisionId = updated.revisionId;
    expect(
      ledger.documents.length,
      "Each update must still seed exactly the naming document it reconciles.",
    ).toBe(documentsBefore + 1);

    const acceptedOwners = acceptedNamingOwners(accepted());
    for (const owner of acceptedOwners) {
      expect(owner.isDeleted(), "Accepted naming must stay live.").toBe(false);
    }
    expect(
      [...ledger.documents, ...ledger.labels].filter(
        (wrapper) => !acceptedOwners.has(wrapper) && !wrapper.isDeleted(),
      ).length,
      "Naming documents/labels unreachable from the accepted state must be released by the update that dropped them.",
    ).toBe(0);
    expect(
      ledger.liveAttributeOwners.size,
      "TNaming builders, selectors and NamedShape handles must not outlive the naming operation.",
    ).toBe(0);
    expect(
      ledger.temporaries.filter((wrapper) => !wrapper.isDeleted()).length,
      "NamedShape TopoDS copies and storage-format strings are released after their final use.",
    ).toBe(0);
  }

  // A derived shell body seeds temporary naming for its source body, which
  // reconciliation left without naming.
  const extruded = accepted().bodies[0] as Body & {
    bodyId: string;
    naming?: Naming;
    topology: { faceIds: readonly string[] };
  };
  expect(extruded.naming).toBeUndefined();
  const shelled = await adapter.createFeature({
    ...request,
    baseRevisionId: revisionId,
    definition: {
      kind: "shell",
      featureTypeVersion: SHELL_FEATURE_SCHEMA_VERSION,
      parameters: {
        bodyTarget: { kind: "body", bodyId: extruded.bodyId },
        faceTargets: [
          {
            kind: "face",
            bodyId: extruded.bodyId,
            faceId: extruded.topology.faceIds[0]!,
          },
        ],
        thickness: 0.2,
        operation: "newBody",
        booleanScope: { kind: "standalone" },
      },
    } as FeatureDefinition,
  });
  expect(shelled.revisionState.kind).toBe("accepted");
  const shellOwners = acceptedNamingOwners(accepted());
  expect(
    [...ledger.documents, ...ledger.labels].filter(
      (wrapper) => !shellOwners.has(wrapper) && !wrapper.isDeleted(),
    ).length,
    "Temporary source naming seeded for a derived body must be released.",
  ).toBe(0);
  expect(ledger.liveAttributeOwners.size).toBe(0);

  expect(ledger.attributeOwnersLiveAtDocumentDelete.length).toBeGreaterThan(0);
  expect(
    ledger.attributeOwnersLiveAtDocumentDelete.every((live) => live === 0),
    "Every naming document is released only after its builders, selectors and attribute handles.",
  ).toBe(true);

  adapter.dispose();
  expect(
    [...ledger.documents, ...ledger.labels].filter((w) => !w.isDeleted())
      .length,
  ).toBe(0);
});

async function createRebuildScenario() {
  const oc = await loadOpenCascade();
  const ledger = observeNaming(oc);
  const source = await seedSketch();
  const sketches = [source];
  const regionId = source.sketch.regions[0]!.regionId;
  const feature = (distance: number) => ({
    featureId: "feature_naming_extrude" as FeatureId,
    definition: extrudeDefinition(source.sketchId, regionId, distance),
    suppressed: false,
  });
  const accepted = rebuildOccAuthoringState(
    createOccAuthoringState(oc, { sketches }),
    [feature(2)],
  );
  const base = createOccAuthoringState(oc, {
    sketches,
    historyOrder: accepted.historyOrder,
    previousFeatureTopologyStages: accepted.featureTopologyStages,
  });
  return { accepted, base, feature, ledger };
}

test("a failed orphan naming release rejects the reconciled state, keeps the input state live and retains its retry", async () => {
  const { accepted, base, feature, ledger } = await createRebuildScenario();
  const acceptedOwners = acceptedNamingOwners(
    accepted as unknown as OwnedState,
  );
  expect(acceptedOwners.size).toBeGreaterThan(0);
  const documentsBefore = ledger.documents.length;
  const injected = new Error("injected orphan document delete failure");
  let failNext = true;
  const originalPush = ledger.documents.push.bind(ledger.documents);
  ledger.documents.push = (...documents: Wrapper[]) => {
    for (const document of documents) {
      const release = document.delete.bind(document);
      document.delete = () => {
        if (failNext) {
          failNext = false;
          throw injected;
        }
        release();
      };
    }
    return originalPush(...documents);
  };
  releaseCalls.discarded.length = 0;

  let failure: unknown;
  try {
    applyOccFeatureToAuthoringState(base, feature(3));
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(OccCleanupError);
  expect((failure as AggregateError).errors).toContain(injected);
  const orphanDocument = ledger.documents[documentsBefore]!;
  expect(orphanDocument.isDeleted()).toBe(false);
  expect(
    ledger.labels.filter(
      (label) => !acceptedOwners.has(label) && !label.isDeleted(),
    ).length,
    "Orphan labels are released before the failing document.",
  ).toBe(0);
  const rejected = releaseCalls.discarded.at(-1) as OwnedState;
  expect(rejected.bodies.length).toBeGreaterThan(0);
  for (const body of rejected.bodies) {
    expect(body.naming).toBeUndefined();
    expect(
      body.shape.isDeleted(),
      "The rejected reconciled body is released.",
    ).toBe(true);
  }
  for (const owner of acceptedOwners) expect(owner.isDeleted()).toBe(false);
  for (const body of accepted.bodies)
    expect(body.shape.isDeleted()).toBe(false);

  (failure as InstanceType<typeof OccCleanupError>).retry();
  expect(orphanDocument.isDeleted()).toBe(true);
  for (const owner of acceptedOwners) expect(owner.isDeleted()).toBe(false);
});

test("orphan naming and rejected-state cleanup failures are both preserved with their retries", async () => {
  const { accepted, base, feature, ledger } = await createRebuildScenario();
  const acceptedOwners = acceptedNamingOwners(
    accepted as unknown as OwnedState,
  );
  const primaryRetry = vi.fn();
  const nestedRetry = vi.fn();
  const primary = new OccCleanupError([new Error("orphan")], primaryRetry);
  const nested = new OccCleanupError([new Error("rejected")], nestedRetry);
  releaseFailures.objects.push({
    matches: (object) => ledger.documents.includes(object as Wrapper),
    error: primary,
  });
  releaseFailures.discarded.push(nested);

  let failure: unknown;
  try {
    applyOccFeatureToAuthoringState(base, feature(3));
  } catch (error) {
    failure = error;
  }
  releaseFailures.objects.length = 0;
  releaseFailures.discarded.length = 0;

  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([primary, nested]);
  expect(collectOccCleanupErrors(failure)).toEqual([primary, nested]);
  for (const owner of acceptedOwners) expect(owner.isDeleted()).toBe(false);
});

function namingWrappers(naming: Naming | undefined) {
  return naming
    ? [
        naming.bodyLabel,
        ...naming.topologyLabelsByKey.values(),
        ...naming.selectorLabelsByKey.values(),
        naming.document,
      ]
    : [];
}

type TrackedBodyWrappers = {
  shape: Wrapper;
  facesById: ReadonlyMap<unknown, Wrapper>;
  edgesById: ReadonlyMap<unknown, Wrapper>;
  verticesById: ReadonlyMap<unknown, Wrapper>;
  naming?: Naming;
};

function bodyWrappers(trackedBody: object) {
  const body = trackedBody as TrackedBodyWrappers;
  return [
    body.shape,
    ...body.facesById.values(),
    ...body.edgesById.values(),
    ...body.verticesById.values(),
    ...namingWrappers(body.naming),
  ];
}

function liveUnowned(ledger: NamingLedger, ...states: OwnedState[]) {
  const owners = new Set<Wrapper>();
  for (const state of states)
    for (const owner of acceptedNamingOwners(state)) owners.add(owner);
  return [...ledger.documents, ...ledger.labels].filter(
    (wrapper) => !owners.has(wrapper) && !wrapper.isDeleted(),
  );
}

async function createJoinScenario() {
  const oc = await loadOpenCascade();
  const ledger = observeNaming(oc);
  const source = await seedSketch();
  const sketches = [source];
  const regionId = source.sketch.regions[0]!.regionId;
  const features = (distance: number, joinBodyId?: string) => [
    {
      featureId: "feature_naming_base" as FeatureId,
      definition: extrudeDefinition(source.sketchId, regionId, distance),
      suppressed: false,
    },
    ...(joinBodyId
      ? [
          {
            featureId: "feature_naming_join" as FeatureId,
            definition: extrudeDefinition(
              source.sketchId,
              regionId,
              distance + 1.5,
              joinBodyId,
            ),
            suppressed: false,
          },
        ]
      : []),
  ];
  const first = rebuildOccAuthoringState(
    createOccAuthoringState(oc, { sketches }),
    features(2),
  );
  return { oc, ledger, sketches, features, first };
}

test("join replacement rebuilds release the labels the reconciler seeded and dropped, never borrowed or accepted naming", async () => {
  const { oc, ledger, sketches, features, first } = await createJoinScenario();
  const bodyId = first.bodies[0]!.bodyId;

  // Without previous stages the join borrows the base body's stored naming.
  const borrowed = rebuildOccAuthoringState(
    createOccAuthoringState(oc, { sketches }),
    features(2, bodyId),
  );
  for (const owner of acceptedNamingOwners(borrowed as unknown as OwnedState))
    expect(owner.isDeleted(), "Borrowed naming must stay live.").toBe(false);
  expect(
    liveUnowned(ledger, first as never, borrowed as never),
    "A join that borrows stored naming leaves nothing unowned.",
  ).toEqual([]);
  releaseOccAuthoringStateObjects(borrowed);

  let accepted = rebuildOccAuthoringState(first, features(2, bodyId));
  releaseDiscardedOccAuthoringStateObjects(first, [accepted]);
  for (let rebuild = 1; rebuild <= 4; rebuild += 1) {
    const next = rebuildOccAuthoringState(
      accepted,
      features(2 + rebuild, bodyId),
    );
    for (const owner of acceptedNamingOwners(next as unknown as OwnedState))
      expect(owner.isDeleted(), "Accepted naming must stay live.").toBe(false);
    expect(
      liveUnowned(ledger, accepted as never, next as never).length,
      "Labels dropped by a seeded join reconciliation are released by it.",
    ).toBe(0);
    releaseDiscardedOccAuthoringStateObjects(accepted, [next]);
    accepted = next;
  }

  const activeIds = new Set(accepted.features.map((f) => f.featureId));
  const restored = rebuildOccAuthoringState(
    createOccAuthoringState(oc, {
      sketches,
      historyOrder: accepted.historyOrder,
      previousFeatureTopologyLineage: createOccFeatureTopologyLineageMap(
        serializeOccFeatureTopologyLineage(
          accepted.featureTopologyStages,
          new Map(),
          activeIds,
        ),
      ),
    }),
    features(7, bodyId),
  );
  expect(liveUnowned(ledger, accepted as never, restored as never)).toEqual([]);
  releaseOccAuthoringStateObjects(accepted);
  releaseOccAuthoringStateObjects(restored);

  expect(
    [...ledger.documents, ...ledger.labels].filter((w) => !w.isDeleted()),
    "Full release leaves no naming wrapper live.",
  ).toEqual([]);
  expect(ledger.liveAttributeOwners.size).toBe(0);
  expect(ledger.temporaries.filter((w) => !w.isDeleted())).toEqual([]);
  expect(
    ledger.attributeOwnersLiveAtDocumentDelete.every((live) => live === 0),
    "Documents are released only after their attribute owners.",
  ).toBe(true);
});

async function createReplacementScenario() {
  const scenario = await createJoinScenario();
  const bodyId = scenario.first.bodies[0]!.bodyId;
  // A second rebuild drops stored naming through semantic reconciliation.
  const unnamed = rebuildOccAuthoringState(
    scenario.first,
    scenario.features(3),
  );
  const unnamedBody = unnamed.bodies[0]!;
  expect(unnamedBody.naming).toBeUndefined();
  const namedBody = scenario.first.bodies[0]!;
  expect(namedBody.naming).toBeDefined();
  const replacementShape = scenario.first.bodies[0]!.shape;
  const primary = new Error("injected history failure");
  // Faces reconcile first (carrying or creating labels); the edge pass fails.
  const edgeType = scenario.oc.TopAbs_ShapeEnum.TopAbs_EDGE;
  const failingHistory = {
    Modified: (shape: { ShapeType(): unknown }) => {
      if (shape.ShapeType() === edgeType) throw primary;
      return new scenario.oc.TopTools_ListOfShape_1();
    },
    Generated: () => new scenario.oc.TopTools_ListOfShape_1(),
    IsDeleted: () => false,
  };
  const reconcile = (previous: typeof unnamedBody) =>
    reconcileReplacementSolidBody(scenario.oc, {
      previous,
      ownerFeatureId: "feature_naming_join" as FeatureId,
      shape: replacementShape,
      historySources: [failingHistory as never],
    });
  return {
    ...scenario,
    bodyId,
    unnamed,
    unnamedBody,
    namedBody,
    primary,
    reconcile,
  };
}

test("a failed seeded replacement reconciliation releases all of its local naming and preserves the primary error", async () => {
  const s = await createReplacementScenario();
  const retained = [
    ...bodyWrappers(s.unnamedBody),
    ...bodyWrappers(s.namedBody),
  ];
  const documentsBefore = s.ledger.documents.length;
  const labelsBefore = s.ledger.labels.length;

  let failure: unknown;
  try {
    s.reconcile(s.unnamedBody);
  } catch (error) {
    failure = error;
  }
  expect(failure, "The primary error is rethrown unchanged.").toBe(s.primary);
  const seeded = s.ledger.documents.slice(documentsBefore);
  expect(seeded.length, "The reconciler seeded temporary naming.").toBe(1);
  expect(
    [...seeded, ...s.ledger.labels.slice(labelsBefore)].filter(
      (w) => !w.isDeleted(),
    ),
    "Every document/label seeded by the failed reconciliation is released.",
  ).toEqual([]);
  expect(s.ledger.liveAttributeOwners.size).toBe(0);
  expect(s.ledger.temporaries.filter((w) => !w.isDeleted())).toEqual([]);
  expect(
    s.ledger.attributeOwnersLiveAtDocumentDelete.every((live) => live === 0),
  ).toBe(true);
  for (const wrapper of retained)
    expect(wrapper.isDeleted(), "Input bodies stay live.").toBe(false);

  // Borrowed stored naming is never released by a failed reconciliation.
  const borrowedLabelsBefore = s.ledger.labels.length;
  failure = undefined;
  try {
    s.reconcile(s.namedBody);
  } catch (error) {
    failure = error;
  }
  expect(failure).toBe(s.primary);
  expect(s.ledger.documents.length, "No seed for stored naming.").toBe(
    documentsBefore + 1,
  );
  for (const wrapper of retained) expect(wrapper.isDeleted()).toBe(false);
  expect(
    s.ledger.labels.slice(borrowedLabelsBefore).filter((w) => !w.isDeleted()),
  ).toEqual([]);

  // Primary plus local-naming cleanup failure: both kept, retry releases.
  const cleanup = new OccCleanupError([new Error("seed cleanup")], vi.fn());
  releaseFailures.objects.push({
    matches: (object) =>
      s.ledger.documents.indexOf(object as Wrapper) >= documentsBefore + 1,
    error: cleanup,
  });
  failure = undefined;
  try {
    s.reconcile(s.unnamedBody);
  } catch (error) {
    failure = error;
  }
  releaseFailures.objects.length = 0;
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors).toEqual([s.primary, cleanup]);
  expect(collectOccCleanupErrors(failure)).toEqual([cleanup]);
  for (const wrapper of retained) expect(wrapper.isDeleted()).toBe(false);
});

test("trackDerivedSolidBody releases the already-built body when derivation or its cleanup fails, keeping inputs live", async () => {
  const s = await createReplacementScenario();
  const oc = s.oc;
  const inputShape = s.unnamedBody.shape as unknown as Wrapper;
  const retained = [
    ...bodyWrappers(s.unnamedBody),
    ...bodyWrappers(s.namedBody),
    inputShape,
  ];
  const built: Wrapper[] = [];
  const solid = oc.TopoDS.Solid_1.bind(oc.TopoDS);
  oc.TopoDS.Solid_1 = ((shape: never) => {
    const copy = solid(shape);
    built.push(copy as unknown as Wrapper);
    return copy;
  }) as never;
  const derive = (previous: typeof s.unnamedBody) =>
    trackDerivedSolidBody(oc, {
      previous,
      bodyId: "body_naming_derived" as BodyId,
      label: "derived",
      ownerFeatureId: "feature_naming_derived" as FeatureId,
      shape: s.unnamedBody.shape,
      historySources: [
        {
          Modified: () => {
            throw s.primary;
          },
          Generated: () => new oc.TopTools_ListOfShape_1(),
          IsDeleted: () => false,
        } as never,
      ],
    });
  const attempt = (previous: typeof s.unnamedBody) => {
    const documentsBefore = s.ledger.documents.length;
    built.length = 0;
    let failure: unknown;
    try {
      derive(previous);
    } catch (error) {
      failure = error;
    }
    return { failure, documents: s.ledger.documents.slice(documentsBefore) };
  };

  for (const previous of [s.unnamedBody, s.namedBody]) {
    const { failure, documents } = attempt(previous);
    expect(failure, "The derivation error is rethrown unchanged.").toBe(
      s.primary,
    );
    expect(built.length).toBeGreaterThan(0);
    expect(
      [...built, ...documents].filter((w) => !w.isDeleted()),
      "The generated body (and any temporary source naming) is released.",
    ).toEqual([]);
    for (const wrapper of retained) expect(wrapper.isDeleted()).toBe(false);
  }
  expect(s.ledger.liveAttributeOwners.size).toBe(0);

  // Primary + temporary-naming cleanup + generated-body cleanup failures.
  const temporaryCleanup = new OccCleanupError([new Error("temp")], vi.fn());
  const generatedCleanup = new OccCleanupError([new Error("body")], vi.fn());
  const documentsBefore = s.ledger.documents.length;
  const isNew = (object: unknown) =>
    s.ledger.documents.indexOf(object as Wrapper) >= documentsBefore;
  releaseFailures.objects.push({ matches: isNew, error: temporaryCleanup });
  releaseFailures.discarded.push(generatedCleanup);
  const { failure } = attempt(s.unnamedBody);
  releaseFailures.objects.length = 0;
  releaseFailures.discarded.length = 0;
  expect((failure as AggregateError).errors).toEqual([
    expect.objectContaining({ errors: [s.primary, temporaryCleanup] }),
    generatedCleanup,
  ]);
  expect(collectOccCleanupErrors(failure)).toEqual([
    temporaryCleanup,
    generatedCleanup,
  ]);
  for (const wrapper of retained) expect(wrapper.isDeleted()).toBe(false);
});

test("a failed NamedShape handle delete still releases its selector and read copies, keeps the document for the handle retry, and surfaces the retry", async () => {
  const s = await createReplacementScenario();
  const oc = s.oc;
  const injected = new Error("injected NamedShape handle delete failure");
  const handlePrototype = (
    oc as unknown as Record<string, { prototype: Wrapper }>
  ).Handle_TNaming_NamedShape!.prototype;
  const inherited = handlePrototype.delete;
  const failedHandles: Wrapper[] = [];
  handlePrototype.delete = function (this: Wrapper) {
    if (failedHandles.length === 0) {
      failedHandles.push(this);
      throw injected;
    }
    return inherited.call(this);
  };
  const documentsBefore = s.ledger.documents.length;
  const labelsBefore = s.ledger.labels.length;
  let failure: unknown;
  try {
    trackNewSolidBody(oc, {
      bodyId: "body_naming_selector" as BodyId,
      label: "selector",
      ownerFeatureId: null,
      shape: s.unnamedBody.shape,
    });
  } catch (error) {
    failure = error;
  } finally {
    handlePrototype.delete = inherited;
  }
  const cleanups = collectOccCleanupErrors(failure);
  expect(cleanups.length).toBeGreaterThan(0);
  expect(cleanups.flatMap((c) => [...c.errors])).toContain(injected);
  expect(
    [...s.ledger.liveAttributeOwners],
    "Only the failed handle outlives its selector cleanup.",
  ).toEqual(failedHandles);
  const [document] = s.ledger.documents.slice(documentsBefore);
  expect(
    document!.isDeleted(),
    "The document waits for its pending attribute handle.",
  ).toBe(false);
  expect(s.ledger.temporaries.filter((w) => !w.isDeleted())).toEqual([]);

  for (const cleanup of cleanups) cleanup.retry();
  expect(failedHandles[0]!.isDeleted()).toBe(true);
  expect(document!.isDeleted()).toBe(true);
  expect(
    s.ledger.attributeOwnersLiveAtDocumentDelete.every((live) => live === 0),
    "The handle retry runs before its document is released.",
  ).toBe(true);
  expect(
    [
      ...s.ledger.documents.slice(documentsBefore),
      ...s.ledger.labels.slice(labelsBefore),
    ].filter((w) => !w.isDeleted()),
    "The partially seeded naming is fully released once its handle retry succeeds.",
  ).toEqual([]);
});
