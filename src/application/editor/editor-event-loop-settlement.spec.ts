import { expect, it } from "vitest";
import { createEditorEventLoop } from "./editor-event-loop";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createTestErrorReporter } from "@/contracts/errors";
import type {
  EditorEffectRuntime,
  EditorEvent,
} from "@/core/editor/state-machine";
import { runEditorEffect } from "./effect-registry";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  selectSketchEditToolTarget,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function runtime(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
): EditorEffectRuntime {
  return {
    getCurrentDocumentSnapshot: async () => snapshot,
    commitSketch: async () => null,
    commitSketchPlane: async () => {
      throw new Error("Unused");
    },
    evaluatePreview: async () => {
      throw new Error("Unused");
    },
    commitFeature: async () => {
      throw new Error("Unused");
    },
    projectSketchReferences: async () => ({
      projectedReferences: [],
      diagnostics: [],
    }),
  };
}
it("settles a correlated typed failure even when stopped before the late snapshot result", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const pending = deferred<typeof snapshot>();
  const loop = createEditorEventLoop(
    { ...runtime(snapshot), getCurrentDocumentSnapshot: () => pending.promise },
    createTestErrorReporter(),
  );
  const completion = loop.startAndSettle("startup");
  loop.stop();
  let drained = false;
  const closing = loop.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(drained).toBe(false);
  pending.reject(new Error("late snapshot failure"));
  const events = await completion;
  expect(events).toMatchObject([
    { type: "effect.snapshotFailed", error: "late snapshot failure" },
  ]);
  await closing;
  expect(drained).toBe(true);
});
it("waits for detached derivation descendants before correlated completion and drain", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  snapshot.document.cursor = {
    kind: "sketch",
    sketchId: snapshot.document.sketches[0]!.sketchId,
  };
  const started = deferred<void>();
  const regions = deferred<{
    regions: [];
    diagnostics: [];
    offsetPublications: [];
  }>();
  const loop = createEditorEventLoop(
    {
      ...runtime(snapshot),
      deriveSketchRegions: async () => {
        started.resolve();
        return regions.promise;
      },
    },
    createTestErrorReporter(),
  );
  await loop.startAndSettle("startup");
  const completion = loop.dispatchAndSettle("open", {
    type: "authoring.reopenRequested",
    target: {
      kind: "sketch",
      sketchId: snapshot.document.sketches[0]!.sketchId,
    },
    toolId: "sketch",
  });
  await started.promise;
  let settled = false;
  void completion.then(() => {
    settled = true;
  });
  let drained = false;
  const draining = loop.drain().then(() => {
    drained = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(drained).toBe(false);
  regions.resolve({ regions: [], diagnostics: [], offsetPublications: [] });
  const events = await completion;
  expect(
    events.some((event) => event.type === "effect.sketchRegionsDerived"),
  ).toBe(true);
  await draining;
  expect(loop.getState().kind).toBe("editingSketch");
  loop.stop();
});

function querySession(edit: boolean) {
  let session = enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  session = beginSketchTool(session, "spline");
  session = startSketchDraw(session, [0, 0]);
  session = acceptSketchDraw(session, [2, 3]);
  session = acceptSketchDraw(session, [4, 0]);
  session = finalizeSketchDraw(session);
  session = beginSketchTool(session, "line");
  session = startSketchDraw(session, [1, -1]);
  session = acceptSketchDraw(session, [1, 4]);
  session = beginSketchTool(session, edit ? "trim" : "line");
  return edit
    ? selectSketchEditToolTarget(session, {
        kind: "sketchEntity",
        sketchId: session.sketchId ?? "sketch_draft",
        entityId: session.definition.entities[0]!.entityId,
      })
    : session;
}

async function createQueryLoop(lane: "snap" | "edit") {
  const snapshot = await createSeedDocumentSnapshot();
  const session = querySession(lane === "edit");
  const queries: {
    event: EditorEvent;
    signal: AbortSignal;
    result: ReturnType<typeof deferred<EditorEvent>>;
  }[] = [];
  const base = runtime(snapshot);
  const loop = createEditorEventLoop(base, createTestErrorReporter(), async (effect, service, signal) => {
    if (effect.type === "sketch.querySnapIntersections" || effect.type === "sketch.queryEditIntersections") {
      const result = deferred<EditorEvent>();
      const event: EditorEvent = effect.type === "sketch.querySnapIntersections" ? {
        ...effect, type: "effect.sketchSnapIntersectionsQueried", targets: [],
      } : {
        ...effect,
        type: "effect.sketchEditIntersectionsQueried",
        result: {
          kind: "verified", cuts: [], parameterOrder: "increasing",
          incidences: [], nonAcceptedNearTarget: [],
          trimInterval: { from: null, to: null },
        },
      };
      queries.push({ event, signal, result });
      return result.promise;
    }
    if (effect.type === "sketch.openSession") return {
      type: "effect.sketchSessionOpened", requestId: effect.requestId,
      documentId: snapshot.document.documentId, revisionId: snapshot.document.revisionId,
      commandSessionId: effect.commandSessionId, session,
    };
    if (effect.type === "sketch.deriveRegions") return {
      ...effect, type: "effect.sketchRegionsDerived", regions: [], diagnostics: [], offsetPublications: [],
    };
    return runEditorEffect(effect, service, signal);
  });
  await loop.startAndSettle("startup");
  loop.dispatch({ type: "tool.activated", toolId: "sketch" });
  const opened = loop.dispatchAndSettle("open", {
    type: "viewport.selectionRequested",
    target: { kind: "construction", constructionId: "construction_plane-xy" },
  });
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  return { loop, queries, opened, session };
}

it.each(["snap", "edit"] as const)("releases a running %s query on stop and rejects its late publication after restart", async (lane) => {
  const { loop, queries, opened } = await createQueryLoop(lane);
  loop.stop();
  const stopped = loop.getState();
  if (stopped.kind !== "editingSketch") throw new Error("Expected sketch");
  expect(stopped.pendingSnapQueryRequest ?? null).toBeNull();
  expect(stopped.pendingEditQueryRequest ?? null).toBeNull();
  await opened;
  await loop.drain();
  const oldQueries = queries.splice(0);
  loop.start();
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  const restarted = loop.getState();
  for (const query of oldQueries) query.result.resolve(query.event);
  await Promise.resolve();
  await Promise.resolve();
  expect(loop.getState()).toBe(restarted);
  loop.stop();
});

it.each(["snap", "edit"] as const)("releases a running %s query on sketch exit before another session opens", async (lane) => {
  const { loop, queries, opened } = await createQueryLoop(lane);
  const oldQueries = queries.splice(0);
  loop.dispatch({ type: "sketch.discardRequested" });
  expect(loop.getState().kind).toBe("idle");
  expect(oldQueries.every(query => query.signal.aborted)).toBe(true);
  await opened;
  await loop.drain();
  loop.dispatch({ type: "tool.activated", toolId: "sketch" });
  loop.dispatch({ type: "viewport.selectionRequested", target: {
    kind: "construction", constructionId: "construction_plane-xy",
  } });
  await expect.poll(() => queries.length).toBeGreaterThan(0);
  const current = loop.getState();
  for (const query of oldQueries) query.result.resolve(query.event);
  await Promise.resolve();
  await Promise.resolve();
  expect(loop.getState()).toBe(current);
  loop.stop();
  await loop.drain();
});

it.each(["snap", "edit"] as const)("releases a running %s query when the new basis has no query work", async (lane) => {
  const { loop, queries, opened } = await createQueryLoop(lane);
  const before = loop.getState();
  if (before.kind !== "editingSketch") throw new Error("Expected sketch");
  const session = before.session;
  loop.dispatch({ type: "sketch.geometryDeleted", targets: session.definition.entities.map(entity => ({
    kind: "sketchEntity", sketchId: session.sketchId ?? "sketch_draft", entityId: entity.entityId,
  })) });
  const deleted = loop.getState();
  if (deleted.kind !== "editingSketch") throw new Error("Expected sketch");
  expect(deleted.session.definition.entities).toHaveLength(0);
  expect(queries.every(query => query.signal.aborted)).toBe(true);
  await opened;
  await loop.drain();
  const current = loop.getState();
  if (current.kind !== "editingSketch") throw new Error("Expected sketch");
  expect(current.pendingSnapQueryRequest ?? null).toBeNull();
  expect(current.pendingEditQueryRequest ?? null).toBeNull();
  for (const query of queries) query.result.resolve(query.event);
  await Promise.resolve();
  await Promise.resolve();
  expect(loop.getState()).toBe(current);
  loop.stop();
});

it("recovers the previous editor context and surfaces a rejected edit-entry cursor move", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const reporter = createTestErrorReporter();
  const loop = createEditorEventLoop({
    ...runtime(snapshot),
    setDocumentCursor: async () => { throw new Error("Rollback failed"); },
  }, reporter);
  await loop.startAndSettle("startup");
  const previous = loop.getState();
  const events = await loop.dispatchAndSettle("reopen", {
    type: "authoring.reopenRequested", toolId: "sketch",
    target: { kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId },
  });
  expect(events).toMatchObject([{ type: "effect.documentCursorMoveFailed", message: "Rollback failed" }]);
  expect(loop.getState()).toMatchObject({
    kind: previous.kind, snapshot: previous.snapshot, document: previous.document,
    selection: previous.selection, editSessionCursorContext: previous.editSessionCursorContext,
    pendingHistoryCursorRequestId: null,
    failureNotice: { kind: "historyMove", message: "Rollback failed" },
  });
  expect(reporter.reports).toMatchObject([{ error: { message: "Rollback failed" }, metadata: { visibility: "user" } }]);
  loop.stop();
});

it("retains the active sketch when cursor restoration fails and allows the exit to be retried", async () => {
  let snapshot = await createSeedDocumentSnapshot();
  const originalCursor = snapshot.document.cursor;
  let moves = 0;
  const reporter = createTestErrorReporter();
  const loop = createEditorEventLoop({
    ...runtime(snapshot),
    getCurrentDocumentSnapshot: async () => snapshot,
    deriveSketchRegions: async () => ({ regions: [], diagnostics: [], offsetPublications: [] }),
    setDocumentCursor: async input => {
      moves += 1;
      if (moves === 2) throw new Error("Restore failed");
      snapshot = structuredClone(snapshot);
      snapshot.document.cursor = input.cursor;
      return { revisionId: snapshot.document.revisionId, accepted: true, diagnostics: [] };
    },
  }, reporter);
  await loop.startAndSettle("startup");
  await loop.dispatchAndSettle("reopen", {
    type: "authoring.reopenRequested", toolId: "sketch",
    target: { kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId },
  });
  const previous = loop.getState();
  if (previous.kind !== "editingSketch") throw new Error("Expected sketch");
  expect(previous.editSessionCursorContext?.phase).toBe("active");
  await loop.dispatchAndSettle("exit", { type: "sketch.discardRequested" });
  const recovered = loop.getState();
  if (recovered.kind !== "editingSketch") throw new Error("Expected recovered sketch");
  expect(recovered.session).toBe(previous.session);
  expect(recovered.snapshot).toBe(previous.snapshot);
  expect(recovered.editSessionCursorContext).toBe(previous.editSessionCursorContext);
  expect(recovered.failureNotice).toEqual({ kind: "historyMove", message: "Restore failed" });
  expect(reporter.reports).toMatchObject([{ error: { message: "Restore failed" }, metadata: { visibility: "user" } }]);
  await loop.dispatchAndSettle("retry-exit", { type: "sketch.discardRequested" });
  expect(loop.getState()).toMatchObject({ kind: "idle", editSessionCursorContext: null });
  expect(snapshot.document.cursor).toEqual(originalCursor);
  loop.stop();
});

it("reissues cancelled snap work when a failed exit recovers the sketch", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const session = querySession(false);
  const sketch = snapshot.document.sketches[0]!;
  sketch.sketch.definition = session.definition;
  sketch.sketch.solvedSnapshot = session.liveSolve!.solvedSnapshot;
  sketch.sketch.projectedReferences = [];
  const queries: ReturnType<typeof deferred<[]>>[] = [];
  let moves = 0;
  const base: EditorEffectRuntime = {
    ...runtime(snapshot),
    deriveSketchRegions: async () => ({ regions: [], diagnostics: [], offsetPublications: [] }),
    setDocumentCursor: async () => {
      moves += 1;
      if (moves === 2) throw new Error("Restore failed");
      return { revisionId: snapshot.document.revisionId, accepted: true, diagnostics: [] };
    },
    querySketchSnapIntersections: () => {
      const result = deferred<[]>();
      queries.push(result);
      return result.promise;
    },
  };
  const loop = createEditorEventLoop(base, createTestErrorReporter());
  await loop.startAndSettle("startup");
  await loop.dispatchAndSettle("open", {
    type: "authoring.reopenRequested", toolId: "sketch",
    target: { kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId },
  });
  const drawing = loop.dispatchAndSettle("draw", { type: "tool.activated", toolId: "line" });
  await expect.poll(() => queries.length).toBe(1);
  const previous = loop.getState();
  if (previous.kind !== "editingSketch") throw new Error("Expected sketch");
  const exiting = loop.dispatchAndSettle("exit", { type: "sketch.discardRequested" });
  await expect.poll(() => queries.length).toBe(2);
  const recovered = loop.getState();
  if (recovered.kind !== "editingSketch") throw new Error("Expected recovered sketch");
  expect(recovered.session.definition).toBe(previous.session.definition);
  expect(recovered.pendingSnapQueryRequest?.requestId).not.toBe(previous.pendingSnapQueryRequest?.requestId);
  expect(recovered.failureNotice).toEqual({ kind: "historyMove", message: "Restore failed" });
  loop.stop();
  await drawing;
  await exiting;
  await loop.drain();
});
