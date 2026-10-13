import { expect, it } from "vitest";
import { createHeadlessSessionFactory } from "@/composition/headless";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type {
  SemanticCommand,
  SemanticResult,
} from "@/contracts/semantic/schema";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";

async function historyFixture(
  options: Parameters<typeof createHeadlessSessionFactory>[0] = {},
) {
  const opened = await createHeadlessSessionFactory(options).open();
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  const session = opened.session;
  let current: SemanticResult | undefined;
  let sequence = 0;
  const run = async (
    input: Record<string, unknown>,
    options?: { signal?: AbortSignal },
  ) => {
    current = await session.execute(
      {
        version: 1,
        commandId: `history-${++sequence}`,
        basis: current?.completion.live.state ?? opened.initialization.state,
        ...input,
      } as unknown as SemanticCommand,
      options,
    );
    return current;
  };
  const execute = async (input: Record<string, unknown>) => {
    const result = await run(input);
    expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
    const checked = validateSemanticResult(result.correlation, result);
    expect(checked.success, JSON.stringify(checked)).toBe(true);
    return result;
  };
  return {
    execute,
    run,
    current: () => current!,
    close: () => session.close(),
  };
}

it("undo and redo restore private geometry without compensating the document", async () => {
  const fixture = await historyFixture();
  const { execute, current } = fixture;
  try {
    await execute({ operation: "sketch.begin", plane: "xy" });
    await execute({
      operation: "sketch.author",
      draft: current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const documentRevision = current().discovery!.state.revisionId;
    expect(current().discovery!.sketch!.entities).toHaveLength(4);
    await execute({
      operation: "history.undo",
      draft: current().discovery!.state.draft,
    });
    expect(current().discovery!.sketch!.entities).toHaveLength(0);
    expect(current().discovery!.state.revisionId).toBe(documentRevision);
    expect(current().completion.persistence.kind).toBe("not-required");
    expect(current().discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: true,
    });
    await execute({
      operation: "history.redo",
      draft: current().discovery!.state.draft,
    });
    expect(current().discovery!.sketch!.entities).toHaveLength(4);
    expect(current().discovery!.sketch!.profiles).toHaveLength(1);
    expect(current().completion.geometry).toMatchObject({
      kind: "current",
      sketchBasis: current().discovery!.state.draft,
    });
  } finally {
    await fixture.close();
  }
}, 60000);

it("empty draft undo stays private; unavailable actions and wrong editing contexts are refused", async () => {
  const fixture = await historyFixture();
  try {
    await fixture.execute({
      operation: "document.rename",
      label: "Shared intent",
    });
    const begun = await fixture.execute({
      operation: "sketch.begin",
      plane: "xy",
    });
    const unavailable = await fixture.run({
      operation: "history.undo",
      draft: begun.discovery!.state.draft,
    });
    expect(unavailable.outcome).toEqual({
      kind: "unavailable",
      capability: "history.undo",
    });
    expect(unavailable.completion.live.kind).toBe("unchanged");
    const inspected = await fixture.execute({
      operation: "history.inspect",
      draft: begun.discovery!.state.draft,
    });
    expect(inspected.discovery!.document!.label).toBe("Shared intent");
    expect(inspected.discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
    const refused = await fixture.run({
      operation: "history.undo",
      draft: null,
    });
    expect(refused.outcome).toEqual({
      kind: "rejected",
      reasonCode: "editing-context",
    });
  } finally {
    await fixture.close();
  }
}, 60000);

it("explicit private history selection refuses dependent edits and stale final generations", async () => {
  const fixture = await historyFixture();
  try {
    await fixture.execute({ operation: "sketch.begin", plane: "xy" });
    await fixture.execute({
      operation: "sketch.author",
      draft: fixture.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const rectangleSequence = fixture
      .current()
      .discovery!.history!.undoEntries!.at(-1)!.sequence;
    const points = fixture.current().discovery!.sketch!.points;
    await fixture.execute({
      operation: "sketch.dimension.add",
      draft: fixture.current().discovery!.state.draft,
      axis: "horizontal",
      points: [points[0]!.pointId, points[1]!.pointId],
      mode: "driving",
      value: 20,
      intent: "fulfill",
    });
    const draft = fixture.current().discovery!.state.draft!;
    const stale = await fixture.run({
      operation: "history.undo",
      draft: { ...draft, generation: draft.generation + 1 },
    });
    expect(stale.outcome).toEqual({
      kind: "rejected",
      reasonCode: "editing-context",
    });
    const blocked = await fixture.run({
      operation: "history.undo",
      draft,
      actionSequence: rectangleSequence,
    });
    expect(blocked.outcome.kind, JSON.stringify(blocked)).toBe("conflicted");
    expect(blocked.completion.live.kind).toBe("unchanged");
    const inspected = await fixture.execute({
      operation: "history.inspect",
      draft,
    });
    expect(inspected.discovery!.sketch!.entities).toHaveLength(4);
    expect(inspected.discovery!.sketch!.requirements).toHaveLength(1);
    expect(inspected.discovery!.history!.undoEntries).toHaveLength(2);
  } finally {
    await fixture.close();
  }
}, 60000);

it("document compensation advances its basis and refuses aliases from before undo", async () => {
  const fixture = await historyFixture();
  try {
    const renamed = await fixture.execute({ operation: "document.rename", label: "Local name" });
    const before = renamed.discovery!.state;
    const undone = await fixture.execute({ operation: "history.undo", draft: null });
    expect(undone.discovery!.state.revisionId).not.toBe(before.revisionId);
    expect(undone.discovery!.state.repositoryHeads).not.toEqual(before.repositoryHeads);
    const stale = await fixture.run({ operation: "document.inspect", basis: before });
    expect(stale.outcome.kind).toBe("conflicted");
    expect(stale.completion.live.kind).toBe("unchanged");
  } finally { await fixture.close(); }
}, 60000);

it("document undo preserves independent peer fields and refuses an overlapping peer edit", async () => {
  let repository!: MemoryDocumentRepository;
  const fixture = await historyFixture({
    createRepository: (assets) =>
      (repository = new MemoryDocumentRepository([], assets)),
  });
  try {
    const original = await fixture.execute({ operation: "document.inspect" });
    await fixture.execute({
      operation: "document.rename",
      label: "Local name",
    });
    const expected = repository.savedDocuments.at(-1)!;
    const peer = structuredClone(expected);
    peer.settings.modelingTolerance = 0.005;
    const received = await repository.receivePeerDocument(peer, expected);
    expect(received.ok).toBe(true);
    await fixture.execute({ operation: "document.inspect" });
    const undo = await fixture.execute({
      operation: "history.undo",
      draft: null,
    });
    expect(undo.discovery!.document!.label).toBe(
      original.discovery!.document!.label,
    );
    expect(undo.discovery!.settings!.modelingTolerance).toBe(0.005);
    await fixture.execute({ operation: "history.redo", draft: null });
    const nextExpected = repository.savedDocuments.at(-1)!;
    const overlapping = structuredClone(nextExpected);
    overlapping.name = "Peer name";
    expect(
      (await repository.receivePeerDocument(overlapping, nextExpected)).ok,
    ).toBe(true);
    await fixture.execute({ operation: "document.inspect" });
    const refused = await fixture.run({
      operation: "history.undo",
      draft: null,
    });
    expect(refused.outcome.kind).toBe("conflicted");
    expect(refused.completion.live.kind).toBe("unchanged");
    const inspected = await fixture.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.document!.label).toBe("Peer name");
    expect(inspected.discovery!.history!.canUndo).toBe(true);
  } finally {
    await fixture.close();
  }
}, 60000);

it("document rename preserves an active private history owner and remains a document action", async () => {
  const fixture = await historyFixture();
  try {
    const initial = await fixture.execute({ operation: "document.inspect" });
    await fixture.execute({ operation: "sketch.begin", plane: "xy" });
    await fixture.execute({ operation: "sketch.author", draft: fixture.current().discovery!.state.draft, primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] }, construction: false, intent: "fulfill" });
    const privateBasis = fixture.current().discovery!.state.draft;
    const renamed = await fixture.execute({ operation: "document.rename", label: "Renamed while private" });
    expect(renamed.discovery!.state.draft).toEqual(privateBasis);
    expect(renamed.discovery!.history!.undoEntries).toHaveLength(1);
    await fixture.execute({ operation: "history.undo", draft: renamed.discovery!.state.draft });
    expect(fixture.current().discovery!.sketch!.entities).toHaveLength(0);
    expect(fixture.current().discovery!.document!.label).toBe("Renamed while private");
    await fixture.execute({ operation: "sketch.discard", draft: fixture.current().discovery!.state.draft });
    const undone = await fixture.execute({ operation: "history.undo", draft: null });
    expect(undone.discovery!.document!.label).toBe(initial.discovery!.document!.label);
  } finally { await fixture.close(); }
}, 60000);

it("native file opening starts a fresh document and private history owner", async () => {
  let saved = "";
  const fixture = await historyFixture({
    nativeFileIO: {
      read: async () => saved,
      write: async (_path, text) => {
        saved = text;
        return {
          kind: "written",
          bytesWritten: new TextEncoder().encode(text).byteLength,
          diagnostics: [],
        };
      },
    },
  });
  try {
    await fixture.execute({
      operation: "document.rename",
      label: "Saved document",
    });
    const history = await fixture.execute({
      operation: "history.inspect",
      draft: null,
    });
    expect(history.discovery!.history!.canUndo).toBe(true);
    await fixture.execute({
      operation: "document.save",
      path: "document.cadara",
    });
    await fixture.execute({ operation: "sketch.begin", plane: "xy" });
    await fixture.execute({
      operation: "sketch.author",
      draft: fixture.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    await fixture.execute({
      operation: "document.open",
      path: "document.cadara",
      basis: null,
    });
    const reopened = await fixture.execute({
      operation: "history.inspect",
      draft: null,
    });
    expect(reopened.discovery!.document!.label).toBe("Saved document");
    expect(reopened.discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
    await fixture.execute({ operation: "sketch.begin", plane: "xy" });
    expect(fixture.current().discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
  } finally {
    await fixture.close();
  }
}, 60000);

it("failed persistence retains the exact live document compensation at the semantic seam", async () => {
  class FailedUndoRepository extends MemoryDocumentRepository {
    override async undoDurableHistory(
      ...args: Parameters<MemoryDocumentRepository["undoDurableHistory"]>
    ) {
      const result = await super.undoDurableHistory(...args);
      if (!result?.ok) return result;
      return {
        ok: false as const,
        status: {
          kind: "failed" as const,
          documentId: args[0],
          diagnostic: {
            reasonCode: "write-failed",
            message: "Undo durability refused",
          },
        },
        appliedLive: result,
      };
    }
  }
  const fixture = await historyFixture({
    createRepository: (assets) => new FailedUndoRepository([], assets),
  });
  try {
    const initial = await fixture.execute({ operation: "document.inspect" });
    await fixture.execute({
      operation: "document.rename",
      label: "Local name",
    });
    const failed = await fixture.run({
      operation: "history.undo",
      draft: null,
    });
    expect(failed.outcome).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["persistence"]),
    });
    expect(failed.completion.live.kind).toBe("applied");
    expect(failed.completion.handoff.kind).toBe("current");
    expect(failed.discovery!.document!.label).toBe(
      initial.discovery!.document!.label,
    );
    expect(failed.completion.persistence).toMatchObject({
      kind: "failed",
      state: failed.completion.live.state,
    });
    const inspected = await fixture.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.document!.label).toBe(
      initial.discovery!.document!.label,
    );
    expect(inspected.discovery!.state.revisionId).toBe(
      failed.completion.live.state!.revisionId,
    );
    expect(inspected.discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: true,
    });
  } finally {
    await fixture.close();
  }
}, 60000);

it("abort and close drain an applied undo and preserve its late failed durability", async () => {
  let start!: () => void;
  const started = new Promise<void>((resolve) => (start = resolve));
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  class DelayedUndoRepository extends MemoryDocumentRepository {
    override async undoDurableHistory(
      ...args: Parameters<MemoryDocumentRepository["undoDurableHistory"]>
    ) {
      const result = await super.undoDurableHistory(...args);
      if (!result?.ok) return result;
      start();
      await pending;
      return {
        ok: false as const,
        status: {
          kind: "failed" as const,
          documentId: args[0],
          diagnostic: {
            reasonCode: "write-failed",
            message: "Late undo write failure",
          },
        },
        appliedLive: result,
      };
    }
  }
  const fixture = await historyFixture({
    createRepository: (assets) => new DelayedUndoRepository([], assets),
  });
  try {
    await fixture.execute({
      operation: "document.rename",
      label: "Local name",
    });
    const controller = new AbortController();
    let settled = false;
    const undo = fixture
      .run(
        { operation: "history.undo", draft: null },
        { signal: controller.signal },
      )
      .then((result) => {
        settled = true;
        return result;
      });
    await started;
    controller.abort();
    let closed = false;
    const close = fixture.close().then((result) => {
      closed = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(closed).toBe(false);
    release();
    const result = await undo;
    expect(result.outcome).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["persistence"]),
    });
    expect(result.completion.live.kind).toBe("applied");
    expect(result.completion.persistence.kind).toBe("failed");
    const cleanup = await close;
    // Cleanup succeeded; the outstanding command failure remains in settled.
    expect(cleanup.kind).toBe("closed");
    expect(cleanup.resourcesReleased).toBe(true);
    expect(cleanup.settled).toEqual([result]);
  } finally {
    release();
    await fixture.close();
  }
}, 60000);

function expectBodySize(result: SemanticResult, expected: readonly number[]) {
  const bounds = result.discovery!.model!.bodies[0]!.bounds!;
  expected.forEach((value, axis) =>
    expect(bounds.max[axis]! - bounds.min[axis]!).toBeCloseTo(value, 5),
  );
}

it("document compensation restores real extrusion depth and published driving width, not transient cursor actions", async () => {
  const fixture = await historyFixture();
  const { execute, current } = fixture;
  try {
    await execute({ operation: "sketch.begin", plane: "xy" });
    await execute({
      operation: "sketch.author",
      draft: current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const points = current().discovery!.sketch!.points;
    for (const dimension of [
      {
        axis: "horizontal",
        points: [points[0]!.pointId, points[1]!.pointId],
        value: 20,
      },
      {
        axis: "vertical",
        points: [points[1]!.pointId, points[2]!.pointId],
        value: 10,
      },
    ])
      await execute({
        operation: "sketch.dimension.add",
        draft: current().discovery!.state.draft,
        ...dimension,
        mode: "driving",
        intent: "fulfill",
      });
    await execute({
      operation: "sketch.publish",
      draft: current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = current().discovery!.sketch!;
    const sketchId = sketch.sketchId!;
    const widthId = sketch.requirements.find(
      (d) => d.value === 20,
    )!.dimensionId;
    await execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 7,
      intent: "fulfill",
    });
    const featureId = current().discovery!.model!.features[0]!.featureId;
    await execute({
      operation: "extrude.update",
      featureId,
      depth: 12,
      intent: "fulfill",
    });
    expectBodySize(current(), [20, 10, 12]);
    await execute({ operation: "history.undo", draft: null });
    expectBodySize(current(), [20, 10, 7]);
    expect(current().completion.persistence.kind).toBe("committed");
    await execute({ operation: "history.redo", draft: null });
    expectBodySize(current(), [20, 10, 12]);
    await execute({ operation: "sketch.open", sketchId });
    await execute({
      operation: "sketch.dimension.update",
      draft: current().discovery!.state.draft,
      dimensionId: widthId,
      value: 35,
      intent: "fulfill",
    });
    await execute({
      operation: "sketch.publish",
      draft: current().discovery!.state.draft,
      requireProfiles: true,
    });
    expectBodySize(current(), [35, 10, 12]);
    expect(current().discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Publish Sketch",
    );
    await execute({ operation: "history.undo", draft: null });
    expectBodySize(current(), [20, 10, 12]);
    await execute({ operation: "history.redo", draft: null });
    expectBodySize(current(), [35, 10, 12]);
    await execute({ operation: "history.undo", draft: null });
    expectBodySize(current(), [20, 10, 12]);
    await execute({ operation: "history.undo", draft: null });
    expectBodySize(current(), [20, 10, 7]);
    await execute({ operation: "history.undo", draft: null });
    expect(current().discovery!.model!.bodies).toEqual([]);
    expect(current().discovery!.model!.features).toEqual([]);
    await execute({ operation: "history.undo", draft: null });
    expect(
      current().discovery!.references.filter((r) => r.target.kind === "sketch"),
    ).toEqual([]);
    expect(current().discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: true,
    });
    await execute({ operation: "history.redo", draft: null });
    expect(
      current().discovery!.references.filter((r) => r.target.kind === "sketch"),
    ).toHaveLength(1);
    await execute({ operation: "history.redo", draft: null });
    expectBodySize(current(), [20, 10, 7]);
  } finally {
    await fixture.close();
  }
}, 60000);
