import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { test, expect } from "vitest";

import type {
  EditorEffect,
  EditorEffectRuntime,
  EditorEvent,
  EditorState,
} from "@/domain/editor/state-machine";
import { defaultEditorExtensionDependencies } from "@/core/editor/state-machine";
import { createSketchSpecialModeHandleRef } from "@/core/sketch-special-modes/presentation";
import { createSketchSpecialModeRegistry } from "@/core/sketch-special-modes/registry";
import type { SketchSpecialModeDefinition } from "@/core/sketch-special-modes/schema";
import { createReferenceImageOperation } from "@/core/reference-image/operations";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  getSketchSessionDerivedValidity,
  getSketchSessionPreviewLabel,
  startSketchDraw,
  withLiveSolveBasis,
} from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { runEditorEffect } from "./effect-registry";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { buildSelectionTargetCatalog } from "@/core/modeling/document-snapshot-view";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createTestErrorReporter } from "@/contracts/errors";
import { getPreviousDocumentHistoryCursor } from "@/core/modeling/document-history";
import {
  createEditorEventLoop,
  getEditorInvocationFailureVisibility,
} from "./editor-event-loop";

function createRuntime(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
): EditorEffectRuntime {
  const solver = new SketchConstraintSolverAdapter({
    neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    documentId: snapshot.document.documentId,
    revisionId: null,
  });
  return {
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    // The production solver boundary behind modelingService.sketchSolver.
    async deriveSketchRegions(input) {
      return solver.deriveSketchRegions({
        contractVersion: "modeling-contract/v1alpha1",
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: input.requestId,
        documentId: input.documentId,
        revisionId: input.baseRevisionId,
        sketchId: input.basis.sketchId,
        definition: input.basis.definition,
        solvedSnapshot: input.basis.solvedSnapshot,
        projectedReferences: input.basis.projectedReferences,
        modelingTolerance: input.basis.modelingTolerance,
      });
    },
    async commitSketch() {
      return null;
    },
    async commitSketchPlane() {
      throw new Error("Sketch-plane commit is not used by this test.");
    },
    async projectSketchReferences() {
      throw new Error("Sketch projection is not used by this test.");
    },
    async evaluatePreview() {
      throw new Error("Feature preview is not used by this test.");
    },
    async commitFeature() {
      throw new Error("Feature commit is not used by this test.");
    },
  };
}

function waitForState(
  loop: ReturnType<typeof createEditorEventLoop>,
  predicate: (state: EditorState) => boolean,
): Promise<EditorState> {
  const current = loop.getState();

  if (predicate(current)) {
    return Promise.resolve(current);
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      subscription.unsubscribe();
      reject(new Error("Timed out waiting for editor event loop state."));
    }, 2_000);
    const subscription = loop.subscribe((state) => {
      if (!predicate(state)) {
        return;
      }

      clearTimeout(timeoutId);
      subscription.unsubscribe();
      resolve(state);
    });
  });
}

function waitForCondition(predicate: () => boolean): Promise<void> {
  if (predicate()) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error("Timed out waiting for condition."));
    }, 2_000);
    const intervalId = setInterval(() => {
      if (!predicate()) {
        return;
      }

      clearTimeout(timeoutId);
      clearInterval(intervalId);
      resolve();
    }, 0);
  });
}

test("src/application/editor/editor-event-loop.spec.ts bootstraps through start()", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  let snapshotCallCount = 0;
  const loop = createEditorEventLoop({
    ...createRuntime(snapshot),
    async getCurrentDocumentSnapshot() {
      snapshotCallCount += 1;
      return snapshot;
    },
  });

  loop.start();

  const state = await waitForState(
    loop,
    (candidate) => candidate.document.revisionId !== null,
  );

  expect(
    snapshotCallCount,
    "Starting the loop should dispatch session.started and fetch the initial snapshot once.",
  ).toBe(1);
  expect(
    state.document.documentId,
    "Starting the loop should hydrate the document id.",
  ).toBe(snapshot.document.documentId);
  expect(
    state.document.revisionId,
    "Starting the loop should hydrate the revision id.",
  ).toBe(snapshot.document.revisionId);

  loop.stop();
});

test("src/application/editor/editor-event-loop.spec.ts dispatches synchronous events and supports unsubscribe", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const loop = createEditorEventLoop(createRuntime(snapshot));
  let notifications = 0;
  const subscription = loop.subscribe(() => {
    notifications += 1;
  });

  loop.start();
  await waitForState(
    loop,
    (candidate) => candidate.document.revisionId !== null,
  );

  const importedSnapshot = structuredClone(snapshot);
  importedSnapshot.document.revisionId = "rev_imported";
  importedSnapshot.document.revisionId = "rev_imported";

  loop.dispatch({
    type: "document.snapshotLoaded",
    snapshot: importedSnapshot,
  });

  expect(
    loop.getState().document.revisionId,
    "Dispatch should route direct editor events through the reducer immediately.",
  ).toBe("rev_imported");
  expect(
    notifications > 0,
    "Subscribers should be notified after transitions.",
  ).toBeTruthy();

  const beforeUnsubscribe = notifications;
  subscription.unsubscribe();
  loop.dispatch({ type: "selection.cleared" });

  expect(
    notifications,
    "Unsubscribed listeners should stop receiving state updates.",
  ).toBe(beforeUnsubscribe);

  loop.stop();
});

test("src/application/editor/editor-event-loop.spec.ts executes effects serially in FIFO order", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const startedEffects: EditorEffect[] = [];
  const resolvers: Array<(event: EditorEvent) => void> = [];
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) => {
      startedEffects.push(effect);

      return new Promise<EditorEvent>((resolve) => {
        resolvers.push(resolve);
      });
    },
  );

  loop.start();
  loop.dispatch({ type: "document.refreshRequested" });

  expect(
    startedEffects.length,
    "Only the first queued effect should start while it is in flight.",
  ).toBe(1);

  const firstEffect = startedEffects[0];
  expect(
    firstEffect?.type,
    "Session bootstrap should enqueue a snapshot fetch effect.",
  ).toBe("document.fetchSnapshot");
  resolvers[0]?.({
    type: "effect.snapshotLoaded",
    payload: {
      requestId: firstEffect.requestId,
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  });

  await waitForCondition(() => startedEffects.length === 2);

  expect(
    startedEffects.length,
    "The next queued effect should start only after the prior effect completes.",
  ).toBe(2);
  expect(
    startedEffects[1]?.type,
    "Queued effects should preserve FIFO ordering.",
  ).toBe("document.fetchSnapshot");

  const secondEffect = startedEffects[1];
  if (secondEffect) {
    resolvers[1]?.({
      type: "effect.snapshotLoaded",
      payload: {
        requestId: secondEffect.requestId,
        documentId: snapshot.document.documentId,
        revisionId: snapshot.document.revisionId,
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
        preserveRenderRecordsOnFeatureDiagnostics: false,
      },
    });
  }

  await waitForState(
    loop,
    (candidate) => candidate.pendingSnapshotRequestId === null,
  );
  loop.stop();
});

// cadara-se2. Logic lane; seam: the event loop over the real effect executor
// and a fake modeling runtime. A viewport LOD change refines in the
// background: a history move queued meanwhile runs without waiting for it,
// and only a refinement that changed the snapshot tier fetches a snapshot.
// Red on base: the LOD change queued a serial snapshot fetch that every
// later effect waited behind.
test("cadara-se2: a queued history move runs while LOD refinement is in flight; only a completed refinement refreshes the snapshot", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  let snapshotReads = 0;
  let cursorMoves = 0;
  const refinements: Array<(refined: boolean) => void> = [];
  const loop = createEditorEventLoop(
    {
      ...createRuntime(snapshot),
      async getCurrentDocumentSnapshot() {
        snapshotReads += 1;
        return snapshot;
      },
      refineSnapshotLod: () =>
        new Promise((resolve) => refinements.push(resolve)),
      async setDocumentCursor() {
        cursorMoves += 1;
        return {
          revisionId: snapshot.document.revisionId,
          accepted: true,
          diagnostics: [],
        };
      },
    },
    createTestErrorReporter(),
  );
  loop.start();
  await waitForState(loop, (state) => state.snapshot !== null);

  loop.dispatch({ type: "document.lodRefinementRequested" });
  expect(refinements).toHaveLength(1);
  const previous = getPreviousDocumentHistoryCursor(snapshot);
  expect(previous, "premise: a previous history cursor").not.toBeNull();
  loop.dispatch({ type: "document.historyCursorRequested", cursor: previous! });
  await waitForCondition(
    () =>
      cursorMoves === 1 &&
      loop.getState().pendingHistoryCursorRequestId === null &&
      loop.getState().pendingSnapshotRequestId === null,
  );
  const readsBeforeRefinement = snapshotReads;

  refinements[0]!(true);
  await waitForCondition(() => snapshotReads === readsBeforeRefinement + 1);
  await loop.drain();

  loop.dispatch({ type: "document.lodRefinementRequested" });
  refinements[1]!(false);
  await loop.drain();
  expect(
    snapshotReads,
    "A refinement that kept the snapshot tier fetches nothing.",
  ).toBe(readsBeforeRefinement + 1);
  loop.stop();
});

// T17o (T17c3 route, high priority). Logic lane; seam: the event loop over
// the real effect executor. A failed document snapshot fetch must reach
// error handling (the reporter, user visibility) and leave the reason in
// the editor state the workbench shows; a later loaded snapshot clears it.
// Red on base: the executor caught the failure into `effect.snapshotFailed`
// (no report) and only the debug preview label carried it, so the view
// silently stayed on the older revision.
test("T17o: a failed snapshot refresh is reported and kept in the editor state until a snapshot loads", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const reporter = createTestErrorReporter();
  let offline = false;
  const loop = createEditorEventLoop(
    {
      ...createRuntime(snapshot),
      async getCurrentDocumentSnapshot() {
        if (offline) throw new Error("Repository offline.");
        return snapshot;
      },
    },
    reporter,
  );
  loop.start();
  await waitForState(loop, (state) => state.snapshot !== null);
  expect(loop.getState().documentRefreshFailure, "premise").toBeNull();

  offline = true;
  loop.dispatch({ type: "document.refreshRequested" });
  const failed = await waitForState(
    loop,
    (state) => state.pendingSnapshotRequestId === null,
  );
  expect(failed.documentRefreshFailure).toBe("Repository offline.");
  expect(failed.snapshot, "the older revision is kept").toBe(snapshot);
  expect(
    reporter.reports.map(({ error, metadata }) => ({
      code: error.code,
      message: error.message,
      source: metadata.source,
      visibility: metadata.visibility,
    })),
  ).toEqual([
    {
      code: "editor/invocation-failed",
      message: "Repository offline.",
      source: "editor-runtime",
      visibility: "user",
    },
  ]);

  offline = false;
  loop.dispatch({ type: "document.refreshRequested" });
  const retried = await waitForState(
    loop,
    (state) => state.pendingSnapshotRequestId === null,
  );
  expect(
    retried.documentRefreshFailure,
    "a loaded snapshot clears it",
  ).toBeNull();
  loop.stop();
});

// T17o review fixes. Logic lane; seam: the event loop over the real effect
// executor. A sketch open or history move that throws reaches error
// reporting (user visibility) and the editor's failure notice (the
// workbench shows it). Red on base: the executor caught both into their
// failure events, nothing was reported, and only the debug preview label
// carried the reason.
test("T17o review: a thrown sketch open and a thrown history move are reported and shown as the failure notice", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const reporter = createTestErrorReporter();
  let offline = false;
  const loop = createEditorEventLoop(
    {
      ...createRuntime(snapshot),
      async getCurrentDocumentSnapshot() {
        if (offline) throw new Error("Repository offline.");
        return snapshot;
      },
      async setDocumentCursor() {
        throw new Error("Cursor write failed.");
      },
    },
    reporter,
  );
  loop.start();
  await waitForState(loop, (state) => state.snapshot !== null);
  const reports = () =>
    reporter.reports.map(({ error, metadata }) => ({
      code: error.code,
      message: error.message,
      visibility: metadata.visibility,
    }));

  offline = true;
  loop.dispatch({ type: "tool.activated", toolId: "sketch" });
  loop.dispatch({
    type: "viewport.selectionRequested",
    target: { kind: "construction", constructionId: "construction_plane-xy" },
  });
  const openFailed = await waitForState(
    loop,
    (state) => state.failureNotice !== null,
  );
  expect(openFailed.failureNotice).toEqual({
    kind: "sketchOpen",
    message: "Repository offline.",
  });
  expect(reports()).toEqual([
    {
      code: "editor/invocation-failed",
      message: "Repository offline.",
      visibility: "user",
    },
  ]);

  offline = false;
  loop.dispatch({
    type: "command.cancelled",
    commandSessionId: (
      openFailed as Extract<EditorState, { kind: "selectionCommand" }>
    ).command.commandSessionId,
  });
  loop.dispatch({ type: "failureNotice.dismissed" });
  expect(loop.getState().failureNotice, "dismissed").toBeNull();
  const previous = getPreviousDocumentHistoryCursor(snapshot);
  expect(previous, "premise: a previous history cursor").not.toBeNull();
  loop.dispatch({ type: "document.historyCursorRequested", cursor: previous! });
  const moveFailed = await waitForState(
    loop,
    (state) => state.failureNotice !== null,
  );
  expect(moveFailed.failureNotice).toEqual({
    kind: "historyMove",
    message: "Cursor write failed.",
  });
  expect(reports().at(-1)).toEqual({
    code: "editor/invocation-failed",
    message: "Cursor write failed.",
    visibility: "user",
  });
  loop.stop();
});

// cadara-4x2 (Sentry CADARA-15). Logic lane; seam: the event loop over the
// real history-cursor effect. The workbench stops a document's loop on
// switch/close and disposes its modeling service a microtask later; a cursor
// mutation accepted after that must not read the snapshot from the disposed
// service. Red on base: the stale run read it and reported "Modeling service
// has been disposed." as a user-visible editor-runtime failure.
test("cadara-4x2: a history move accepted after its loop stopped and its service was disposed drops its snapshot read", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const reporter = createTestErrorReporter();
  let disposed = false;
  let snapshotReadsAfterDisposal = 0;
  let acceptCursorMove: (() => void) | null = null;
  const loop = createEditorEventLoop(
    {
      ...createRuntime(snapshot),
      async getCurrentDocumentSnapshot() {
        if (disposed) {
          snapshotReadsAfterDisposal += 1;
          throw new Error("Modeling service has been disposed.");
        }
        return snapshot;
      },
      setDocumentCursor: () =>
        new Promise((resolve) => {
          acceptCursorMove = () =>
            resolve({
              revisionId: snapshot.document.revisionId,
              accepted: true,
              diagnostics: [],
            });
        }),
    },
    reporter,
  );
  loop.start();
  await waitForState(loop, (state) => state.snapshot !== null);
  const previous = getPreviousDocumentHistoryCursor(snapshot);
  expect(previous, "premise: a previous history cursor").not.toBeNull();
  loop.dispatch({ type: "document.historyCursorRequested", cursor: previous! });
  await waitForCondition(() => acceptCursorMove !== null);

  loop.stop();
  disposed = true;
  acceptCursorMove!();
  await loop.drain();

  expect(
    snapshotReadsAfterDisposal,
    "A stopped run must not read the snapshot from its disposed service.",
  ).toBe(0);
  expect(
    reporter.reports.map(({ error }) => error.message),
    "A stopped run's dropped continuation is not a user-visible failure.",
  ).toEqual([]);
});

// [TECH] T17-11 (T17o). Logic lane; seam: the loop's report policy for an
// escaped effect failure. Red on base: every escaped failure was `user`.
// T17o review fixes (review A-3). Logic lane; seam: the loop's escaped-effect
// report for a real `sketch.querySnapIntersections` effect. The sketch
// (a spline crossed by a line, an accepted basis, so the loop issues a snap
// query) is opened through the loop; the executor fails only the snap
// query. Fails when the loop's report is reverted to `visibility: "user"`.
test("T17-11: the loop reports a thrown snap query with developer visibility", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  let session = enterSketchSession(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  const draw = (toolId: "spline" | "line", clicks: [number, number][]) => {
    let current = beginSketchTool(session, toolId);
    clicks.forEach((click, index) => {
      current =
        index === 0
          ? startSketchDraw(current, click)
          : acceptSketchDraw(current, click);
    });
    session = toolId === "spline" ? finalizeSketchDraw(current) : current;
  };
  draw("spline", [
    [0, 0],
    [2, 3],
    [4, 0],
  ]);
  draw("line", [
    [1, -1],
    [1, 4],
  ]);
  session = beginSketchTool(session, "line");
  const runtime = createRuntime(snapshot);
  const reporter = createTestErrorReporter();
  const snapEffects: EditorEffect[] = [];
  const loop = createEditorEventLoop(runtime, reporter, async (effect) => {
    if (effect.type === "sketch.querySnapIntersections") {
      snapEffects.push(effect);
      throw new Error("Snap worker died.");
    }
    if (effect.type === "sketch.openSession")
      return {
        type: "effect.sketchSessionOpened",
        requestId: effect.requestId,
        documentId: effect.documentId,
        revisionId: effect.revisionId,
        commandSessionId: effect.commandSessionId,
        session,
      } as EditorEvent;
    return runEditorEffect(effect, runtime);
  });
  loop.start();
  await waitForState(loop, (state) => state.snapshot !== null);
  loop.dispatch({ type: "tool.activated", toolId: "sketch" });
  loop.dispatch({
    type: "viewport.selectionRequested",
    target: { kind: "construction", constructionId: "construction_plane-xy" },
  });
  await waitForCondition(() =>
    reporter.reports.some(
      (record) => record.error.message === "Snap worker died.",
    ),
  );
  expect(snapEffects.length, "premise: the loop issued a snap query").toBe(1);
  expect(
    reporter.reports
      .filter((record) => record.error.message === "Snap worker died.")
      .map(({ error, metadata }) => ({
        code: error.code,
        source: metadata.source,
        visibility: metadata.visibility,
      })),
  ).toEqual([
    {
      code: "editor/invocation-failed",
      source: "editor-runtime",
      visibility: "developer",
    },
  ]);
  loop.stop();
});

test("T17-11: an escaped snap-query failure is a developer report; every other effect's is a user report", () => {
  expect(
    getEditorInvocationFailureVisibility({
      type: "sketch.querySnapIntersections",
    }),
  ).toBe("developer");
  for (const type of [
    "document.fetchSnapshot",
    "sketch.deriveRegions",
    "sketch.publishOffsetPreview",
    "sketch.queryEditIntersections",
    "sketch.specialModeEffect",
  ] as const)
    expect(getEditorInvocationFailureVisibility({ type }), type).toBe("user");
});

test("src/application/editor/editor-event-loop.spec.ts reports escaped effect errors and continues with failure events", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const reporter = createTestErrorReporter();
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    reporter,
    async () => {
      throw new Error("Editor event loop invocation escaped.");
    },
  );

  loop.start();

  const state = await waitForState(
    loop,
    (candidate) => candidate.pendingSnapshotRequestId === null,
  );

  expect(
    reporter.reports.length,
    "Escaped effect failures should be reported through the configured error reporter.",
  ).toBe(1);
  expect(
    reporter.reports[0]?.error.code,
    "Escaped effect failures should use the invocation failure code.",
  ).toBe("editor/invocation-failed");
  expect(
    state.preview?.kind,
    "Escaped effect failures should re-enter the reducer as visible failure state.",
  ).toBe("selection");

  loop.stop();
});

test("src/application/editor/editor-event-loop.spec.ts stop() discards queued and in-flight effect results", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const pending: { resolve?: (event: EditorEvent) => void } = {};
  let inFlightRequestId: EditorEffect["requestId"] | null = null;
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) =>
      new Promise<EditorEvent>((resolve) => {
        inFlightRequestId = effect.requestId;
        pending.resolve = resolve;
      }),
  );

  loop.start();
  await waitForState(
    loop,
    (candidate) => candidate.pendingSnapshotRequestId !== null,
  );

  loop.stop();
  if (!pending.resolve) throw new Error("Expected an in-flight effect.");
  pending.resolve({
    type: "effect.snapshotLoaded",
    payload: {
      requestId:
        inFlightRequestId ??
        ("request_snapshot_after_stop" as EditorEffect["requestId"]),
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(
    loop.getState().document.revisionId,
    "Stopping the loop should ignore in-flight effect completions.",
  ).toBe(null);
});

test("EditorEventLoop keeps special-mode drag previews out of history until release", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const operation = createReferenceImageOperation({
    sequence: 1,
    sketchId: sketch.sketchId,
    payload: {
      mediaType: "image/png",
      pixelWidth: 4,
      pixelHeight: 2,
      base64Data: "cG5n",
    },
  });
  sketch.sketch.definition.referenceImages = [operation];

  const mode = {
    id: "test-authored-drag",
    label: "Test authored drag",
    enter: () => ({ state: null }),
    handleDragStart: ({ handle }) => ({ activeDragHandle: handle }),
    handleDragMove: ({ sketchSession, point }) => ({
      session: moveFirstPoint(sketchSession, point),
    }),
    handleDragEnd: ({ sketchSession, point }) => ({
      session: moveFirstPoint(sketchSession, point),
      activeDragHandle: null,
    }),
    cancel: () => ({ exit: true }),
  } satisfies SketchSpecialModeDefinition<null>;
  const dependencies = {
    ...defaultEditorExtensionDependencies,
    sketchSpecialModes: createSketchSpecialModeRegistry([mode]),
  };
  let committedPoint: readonly [number, number] | null = null;
  const loop = createEditorEventLoop(
    {
      ...createRuntime(snapshot),
      async commitSketch(input) {
        committedPoint = input.session.definition.points[0]!.position;
        return null;
      },
    },
    createTestErrorReporter(),
    undefined,
    dependencies,
  );

  loop.start();
  await waitForState(loop, (state) => state.document.revisionId !== null);
  loop.dispatch({
    type: "authoring.reopenRequested",
    target: { kind: "sketch", sketchId: sketch.sketchId },
    toolId: "sketch",
  });
  const opened = await waitForState(
    loop,
    (state) => state.kind === "editingSketch",
  );
  if (opened.kind !== "editingSketch")
    throw new Error("Expected sketch edit state.");
  const originalPoint = opened.session.definition.points[0]!.position;
  const handle = createSketchSpecialModeHandleRef(
    operation.operationId,
    "test-handle",
  );

  const enterMode = () =>
    loop.dispatch({
      type: "sketch.specialModeEntered",
      modeId: mode.id,
      operationId: operation.operationId,
    });
  const startAndMove = (point: readonly [number, number]) => {
    loop.dispatch({ type: "sketch.specialModeDragStarted", handle, point });
    loop.dispatch({ type: "sketch.specialModeDragMoved", handle, point });
  };
  const currentSketch = () => {
    const state = loop.getState();
    if (state.kind !== "editingSketch")
      throw new Error("Expected sketch edit state.");
    return state;
  };

  const dimension = currentSketch().session.definition.dimensions[0]!;
  if (dimension.kind !== "distance")
    throw new Error("Expected a seed distance dimension.");
  const originalPlacement = dimension.annotationPlacement;
  const annotationPatch = (
    gesturePhase: "start" | "move" | "end" | "cancel",
    point: readonly [number, number],
  ) =>
    loop.dispatch({
      type: "sketch.toolPatched",
      patch: {
        intent: "setDimensionAnnotationPlacement",
        dimensionId: dimension.dimensionId,
        point,
        gesturePhase,
        clientPoint: point,
      },
    });
  annotationPatch("start", [20, 10]);
  annotationPatch("move", [30, 15]);
  expect(currentSketch().session.actionAvailability?.canUndo).toBe(false);
  annotationPatch("end", [30, 15]);
  expect(currentSketch().session.actionAvailability?.canUndo).toBe(true);
  loop.dispatch({ type: "history.undoRequested" });
  expect(
    dimensionPlacement(currentSketch().session),
  ).toEqual(originalPlacement);
  annotationPatch("start", [40, 20]);
  annotationPatch("move", [50, 25]);
  annotationPatch("cancel", [50, 25]);
  expect(
    dimensionPlacement(currentSketch().session),
  ).toEqual(originalPlacement);
  expect(currentSketch().session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: true,
  });
  annotationPatch("start", [60, 30]);
  annotationPatch("end", [60, 30]);
  expect(
    dimensionPlacement(currentSketch().session),
  ).toEqual(originalPlacement);
  expect(currentSketch().session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: true,
  });

  enterMode();
  startAndMove([20, 10]);
  expect(currentSketch().session.definition.points[0]!.position).not.toEqual(
    originalPoint,
  );
  expect(currentSketch().session.actionAvailability?.canUndo).toBe(false);
  loop.dispatch({
    type: "command.cancelled",
    commandSessionId: currentSketch().command.commandSessionId,
  });
  expect(currentSketch().session.definition.points[0]!.position).toEqual(
    originalPoint,
  );
  expect(currentSketch().session.actionAvailability?.canUndo).toBe(false);

  enterMode();
  startAndMove([30, 15]);
  loop.dispatch({ type: "tool.activated", toolId: "line" });
  expect(currentSketch().session.definition.points[0]!.position).toEqual(
    originalPoint,
  );
  expect(currentSketch().session.actionAvailability?.canUndo).toBe(false);
  loop.dispatch({
    type: "command.cancelled",
    commandSessionId: currentSketch().command.commandSessionId,
  });

  enterMode();
  startAndMove([40, 20]);
  loop.dispatch({
    type: "sketch.specialModeDragEnded",
    handle,
    point: [40, 20],
  });
  const releasedPoint = currentSketch().session.definition.points[0]!.position;
  expect(releasedPoint).not.toEqual(originalPoint);
  expect(currentSketch().session.actionAvailability?.canUndo).toBe(true);
  loop.dispatch({ type: "history.undoRequested" });
  expect(currentSketch().session.definition.points[0]!.position).toEqual(
    originalPoint,
  );
  expect(currentSketch().session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: true,
  });
  loop.dispatch({ type: "history.redoRequested" });
  expect(currentSketch().session.definition.points[0]!.position).toEqual(
    releasedPoint,
  );

  loop.dispatch({ type: "history.undoRequested" });
  enterMode();
  startAndMove([50, 25]);
  loop.dispatch({ type: "tool.activated", toolId: "finishSketch" });
  await waitForCondition(() => committedPoint !== null);
  expect(committedPoint).toEqual(originalPoint);
  loop.stop();
});

test("EditorEventLoop Undo and Redo recompute equivalent invalid diagnostics and profile capability", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const operation = createReferenceImageOperation({
    sequence: 2,
    sketchId: sketch.sketchId,
    payload: {
      mediaType: "image/png",
      pixelWidth: 4,
      pixelHeight: 2,
      base64Data: "cG5n",
    },
  });
  sketch.sketch.definition.referenceImages = [operation];

  const conflictIds: readonly `constraint_${string}`[] = [
    "constraint_event_conflict_a",
    "constraint_event_conflict_b",
  ];
  const mode = {
    id: "test-invalid-action-history",
    label: "Test invalid action history",
    enter: () => ({ state: null }),
    handleDragStart: ({ handle }) => ({ activeDragHandle: handle }),
    handleDragEnd: ({ sketchSession }) => {
      const definition = structuredClone(sketchSession.definition);
      definition.constraintIds = definition.constraintIds.filter(
        (id) => !conflictIds.includes(id),
      );
      definition.constraints = definition.constraints.filter(
        (constraint) => !conflictIds.includes(constraint.constraintId),
      );
      if (!sketchSession.definition.constraintIds.includes(conflictIds[0]!)) {
        const pointId = definition.points[0]!.pointId;
        definition.constraintIds.push(...conflictIds);
        definition.constraints.push(
          {
            constraintId: conflictIds[0]!,
            kind: "fixPoint",
            label: "Conflicting event-loop point A",
            pointId,
            position: [0, 0],
          },
          {
            constraintId: conflictIds[1]!,
            kind: "fixPoint",
            label: "Conflicting event-loop point B",
            pointId,
            position: [100, 0],
          },
        );
      }
      return {
        session: withLiveSolveBasis(
          { ...sketchSession, definition },
          definition,
        ),
        activeDragHandle: null,
      };
    },
    cancel: () => ({ exit: true }),
  } satisfies SketchSpecialModeDefinition<null>;
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    undefined,
    {
      ...defaultEditorExtensionDependencies,
      sketchSpecialModes: createSketchSpecialModeRegistry([mode]),
    },
  );
  loop.start();
  await waitForState(loop, (state) => state.document.revisionId !== null);
  loop.dispatch({
    type: "authoring.reopenRequested",
    target: { kind: "sketch", sketchId: sketch.sketchId },
    toolId: "sketch",
  });
  await waitForState(loop, (state) => state.kind === "editingSketch");
  const handle = createSketchSpecialModeHandleRef(
    operation.operationId,
    "invalid-history-handle",
  );
  const currentSession = () => {
    const state = loop.getState();
    if (state.kind !== "editingSketch")
      throw new Error("Expected sketch state.");
    return state.session;
  };
  const applyDefinitionAction = (x: number) => {
    loop.dispatch({
      type: "sketch.specialModeEntered",
      modeId: mode.id,
      operationId: operation.operationId,
    });
    loop.dispatch({
      type: "sketch.specialModeDragStarted",
      handle,
      point: [x, 0],
    });
    loop.dispatch({
      type: "sketch.specialModeDragEnded",
      handle,
      point: [x, 0],
    });
    loop.dispatch({
      type: "command.cancelled",
      commandSessionId: (
        loop.getState() as Extract<EditorState, { kind: "editingSketch" }>
      ).command.commandSessionId,
    });
  };

  applyDefinitionAction(1);
  const invalidValidity = getSketchSessionDerivedValidity(currentSession());
  expect(invalidValidity.state).toBe("invalid");
  expect(
    invalidValidity.diagnostics.some(
      (diagnostic) => diagnostic.code === "solver-residual-too-large",
    ),
  ).toBe(true);
  expect(invalidValidity.state).not.toBe("current");
  const invalidFeedback = getSketchSessionPreviewLabel(currentSession());
  // T13c (D7, review R-2): the invalid feedback is the conflict explanation
  // naming both conflicting requirements, not the raw residual.
  expect(invalidFeedback).toBe(
    "Conflicting event-loop point A, Conflicting event-loop point B conflict. The sketch is invalid; profiles from it are blocked. Change or delete one of them, or Undo.",
  );

  applyDefinitionAction(2);
  expect(
    getSketchSessionDerivedValidity(currentSession()).state,
    "An accepted solve keeps its regions stale until the async derivation publishes.",
  ).toBe("stale");
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );
  expect(getSketchSessionDerivedValidity(currentSession()).state).toBe(
    "current",
  );
  expect(getSketchSessionDerivedValidity(currentSession()).state).toBe(
    "current",
  );

  loop.dispatch({ type: "history.undoRequested" });
  const undoneValidity = getSketchSessionDerivedValidity(currentSession());
  expect(currentSession().liveRegions.status).toBe("unavailable");
  expect(undoneValidity).toEqual(invalidValidity);
  expect(getSketchSessionPreviewLabel(currentSession())).toBe(invalidFeedback);
  expect(undoneValidity.state).not.toBe("current");

  loop.dispatch({ type: "history.redoRequested" });
  expect(
    currentSession().liveRegions.status,
    "Redo restores an accepted basis, so the loop re-derives its regions.",
  ).toBe("pending");
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );
  const redoneValidity = getSketchSessionDerivedValidity(currentSession());
  expect(redoneValidity.state).toBe("current");
  expect(redoneValidity.state).toBe("current");
  loop.stop();
});

function dimensionPlacement(
  session: Extract<EditorState, { kind: "editingSketch" }>["session"],
) {
  const dimension = session.definition.dimensions[0];
  if (dimension?.kind !== "distance")
    throw new Error("Expected a seed distance dimension.");
  return dimension.annotationPlacement;
}

function moveFirstPoint(
  session: Extract<EditorState, { kind: "editingSketch" }>["session"],
  point: readonly [number, number],
): typeof session {
  return {
    ...session,
    definition: {
      ...session.definition,
      points: session.definition.points.map((entry, index) =>
        index === 0 ? { ...entry, position: [point[0], point[1]] } : entry,
      ),
    },
  };
}

test("src/application/editor/editor-event-loop.spec.ts restart() resumes draining after stop during an in-flight effect", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const startedEffects: EditorEffect[] = [];
  const resolvers: Array<(event: EditorEvent) => void> = [];
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) => {
      startedEffects.push(effect);
      return new Promise<EditorEvent>((resolve) => {
        resolvers.push(resolve);
      });
    },
  );

  loop.start();
  await waitForState(
    loop,
    (candidate) => candidate.pendingSnapshotRequestId !== null,
  );

  loop.stop();
  loop.start();

  expect(
    startedEffects.length,
    "Restart should queue a new bootstrap effect even while the previous drain is still in flight.",
  ).toBe(1);

  resolvers[0]?.({
    type: "effect.snapshotLoaded",
    payload: {
      requestId:
        startedEffects[0]?.requestId ??
        ("request_snapshot_stale" as EditorEffect["requestId"]),
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  });

  await waitForCondition(() => startedEffects.length === 2);

  const restartedEffect = startedEffects[1];
  expect(
    restartedEffect?.type,
    "Restart should resume draining the new bootstrap snapshot effect.",
  ).toBe("document.fetchSnapshot");

  resolvers[1]?.({
    type: "effect.snapshotLoaded",
    payload: {
      requestId: restartedEffect.requestId,
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  });

  const state = await waitForState(
    loop,
    (candidate) => candidate.document.revisionId !== null,
  );

  expect(
    state.document.revisionId,
    "Restarted drains should still deliver the snapshot into loop state.",
  ).toBe(snapshot.document.revisionId);
  loop.stop();
});

type DeriveSketchRegionsInput = Parameters<
  NonNullable<EditorEffectRuntime["deriveSketchRegions"]>
>[0];
type DeriveSketchRegionsOutput = Awaited<
  ReturnType<NonNullable<EditorEffectRuntime["deriveSketchRegions"]>>
>;

/** Fake runtime whose live region derivations resolve only when the test says so. */
function createControlledRegionRuntime(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
) {
  const derivations: {
    input: DeriveSketchRegionsInput;
    resolve: (output: DeriveSketchRegionsOutput) => void;
    reject: (error: Error) => void;
  }[] = [];
  const commits: number[] = [];
  const runtime: EditorEffectRuntime = {
    ...createRuntime(snapshot),
    async commitSketch() {
      commits.push(derivations.length);
      return null;
    },
    async projectSketchReferences() {
      return { projectedReferences: [], diagnostics: [] };
    },
    deriveSketchRegions(input) {
      return new Promise((resolve, reject) => {
        derivations.push({ input, resolve, reject });
      });
    },
  };
  return { runtime, derivations, commits };
}

async function openSeedSketch(
  loop: ReturnType<typeof createEditorEventLoop>,
  sketchId: Awaited<
    ReturnType<typeof createSeedDocumentSnapshot>
  >["document"]["sketches"][number]["sketchId"],
) {
  loop.start();
  await waitForState(loop, (state) => state.document.revisionId !== null);
  loop.dispatch({
    type: "authoring.reopenRequested",
    target: { kind: "sketch", sketchId },
    toolId: "sketch",
  });
  // The seed sketch has a reference: entry bases on the record's projections
  // and requests their refresh, whose result re-bases (T11a).
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.pendingProjectionRequestId === null,
  );
  return () => {
    const state = loop.getState();
    if (state.kind !== "editingSketch")
      throw new Error("Expected sketch state.");
    return state;
  };
}

function relabelRegions(
  regions: DeriveSketchRegionsOutput["regions"],
  label: string,
) {
  return regions.map((region) => ({ ...region, label }));
}

/**
 * Settles a seed sketch's opening (T11a): the entry basis derives first; the
 * projection result re-bases, so that request is stale (serial) or
 * superseded, and the projected basis derives second and publishes.
 */
async function settleOpeningRounds(
  loop: ReturnType<typeof createEditorEventLoop>,
  derivations: ReturnType<typeof createControlledRegionRuntime>["derivations"],
  regions: DeriveSketchRegionsOutput["regions"],
) {
  await waitForCondition(() => derivations.length >= 1);
  derivations[0]!.resolve({ regions, diagnostics: [], offsetPublications: [] });
  await waitForCondition(() => derivations.length >= 2);
  derivations[1]!.resolve({ regions, diagnostics: [], offsetPublications: [] });
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );
  expect(derivations, "Opening derives two bases, once each.").toHaveLength(2);
}

test("EditorEventLoop derives live regions in the background, discards stale generations and coalesces to the latest basis", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const { runtime, derivations, commits } =
    createControlledRegionRuntime(snapshot);
  const loop = createEditorEventLoop(runtime, createTestErrorReporter());
  const currentSketch = await openSeedSketch(loop, sketch.sketchId);

  await waitForCondition(() => derivations.length === 1);
  const opened = currentSketch();
  expect(opened.session.liveRegions.status).toBe("pending");
  expect(
    getSketchSessionDerivedValidity(opened.session).state,
    "Retained regions are stale while the derivation is outstanding.",
  ).toBe("stale");
  // The entry basis (record projections) derives first; the projection
  // result re-based the same definition (T11a).
  expect(derivations[0]!.input.basis.definition).toEqual(
    opened.session.liveSolve!.definition,
  );
  // Request 0 is the entry basis: one generation behind the projected one.
  // (The runtime input carries no generation; the pending request does.)
  expect(opened.pendingRegionRequest).toEqual({
    requestId: derivations[0]!.input.requestId,
    generation: opened.session.liveRegions.generation - 1,
  });

  // Geometry edits establish new live solve bases. (Dimension label moves no
  // longer do: placements never affect regions, T09b review A6(a).)
  const point = opened.session.definition.points[0]!;
  const movePoint = (offset: number) => {
    const current = currentSketch().session.definition.points.find(
      (candidate) => candidate.pointId === point.pointId,
    )!;
    loop.dispatch({
      type: "sketch.geometryDragStarted",
      target: current.target,
      point: current.position,
    });
    const to: [number, number] = [
      current.position[0] + offset,
      current.position[1],
    ];
    loop.dispatch({ type: "sketch.geometryDragMoved", point: to });
    loop.dispatch({ type: "sketch.geometryDragEnded", point: to });
  };
  movePoint(0.25);
  movePoint(0.25);
  const latestGeneration = currentSketch().session.liveRegions.generation;
  expect(latestGeneration).toBeGreaterThan(
    opened.session.liveRegions.generation,
  );
  expect(
    derivations,
    "Newer bases coalesce while one derivation is in flight.",
  ).toHaveLength(1);

  const retained = currentSketch().session.liveRegions.regions;
  derivations[0]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "stale generation"),
    diagnostics: [],
    offsetPublications: [],
  });
  await waitForCondition(() => derivations.length === 2);
  expect(
    currentSketch().session.liveRegions.regions,
    "A stale generation must not be published.",
  ).toBe(retained);
  expect(currentSketch().session.liveRegions.status).toBe("pending");
  expect(currentSketch().pendingRegionRequest?.generation).toBe(
    latestGeneration,
  );

  derivations[1]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "latest generation"),
    diagnostics: [],
    offsetPublications: [],
  });
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );
  expect(
    currentSketch().session.liveRegions.regions.map((region) => region.label),
  ).toEqual(["latest generation"]);
  expect(currentSketch().pendingRegionRequest).toBe(null);

  movePoint(0.25);
  await waitForCondition(() => derivations.length === 3);
  loop.dispatch({ type: "tool.activated", toolId: "finishSketch" });
  await waitForCondition(() => commits.length === 1);
  expect(
    commits[0],
    "Finish runs on the serial queue while the detached derivation is still unresolved.",
  ).toBe(3);
  await waitForState(loop, (state) => state.kind !== "editingSketch");
  const finishedSessionId = opened.command.commandSessionId;

  // Reopen the same sketch while the finished session's derivation is still
  // unresolved; its late result must not touch the new session.
  loop.dispatch({
    type: "authoring.reopenRequested",
    target: { kind: "sketch", sketchId: sketch.sketchId },
    toolId: "sketch",
  });
  await waitForCondition(() => derivations.length === 4);
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.command.commandSessionId !== finishedSessionId &&
      state.pendingProjectionRequestId === null,
  );
  const reopened = currentSketch();
  expect(reopened.command.commandSessionId).not.toBe(finishedSessionId);
  const reopenedRequest = reopened.pendingRegionRequest;
  expect(reopenedRequest?.requestId).toBe(derivations[3]!.input.requestId);
  const reopenedRegions = reopened.session.liveRegions.regions;

  derivations[2]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "finished session"),
    diagnostics: [],
    offsetPublications: [],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const afterLate = currentSketch();
  expect(
    afterLate.pendingRegionRequest,
    "A late result from the finished session must not clear the reopened session's request.",
  ).toEqual(reopenedRequest);
  expect(
    afterLate.session.liveRegions.regions,
    "A late result from the finished session must not publish into the reopened session.",
  ).toBe(reopenedRegions);
  expect(afterLate.session.liveRegions.status).toBe("pending");
  expect(
    derivations,
    "A late result from the finished session must not trigger a new derivation.",
  ).toHaveLength(4);

  // The entry basis's request is stale once the projection result re-based.
  derivations[3]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "reopen entry basis"),
    diagnostics: [],
    offsetPublications: [],
  });
  await waitForCondition(() => derivations.length === 5);
  expect(currentSketch().session.liveRegions.regions).toBe(reopenedRegions);
  derivations[4]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "reopened session"),
    diagnostics: [],
    offsetPublications: [],
  });
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );
  expect(
    currentSketch().session.liveRegions.regions.map((region) => region.label),
  ).toEqual(["reopened session"]);
  loop.stop();
});

test("O30 (cadara-b3k.2): a second Finish while the first commit is in flight does not emit a second commit", async () => {
  // Logic lane, EditorEventLoop seam: the sketch.commit effect runs on the
  // serial queue, so a second sketch.commit emitted while the first is pending
  // reaches the repository AFTER the first has published and carries the same
  // entry-time publication base; the repository then refuses it as 'changed
  // by another session' with one tab. Finish must be idempotent while a
  // commit is pending.
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const { runtime, derivations } = createControlledRegionRuntime(snapshot);
  const commits: { resolve: () => void }[] = [];
  runtime.commitSketch = () =>
    new Promise((resolve) => {
      commits.push({ resolve: () => resolve(null) });
    });
  const loop = createEditorEventLoop(runtime, createTestErrorReporter());
  const currentSketch = await openSeedSketch(loop, sketch.sketchId);
  await settleOpeningRounds(loop, derivations, sketch.sketch.regions);

  const point = currentSketch().session.definition.points[0]!;
  loop.dispatch({
    type: "sketch.geometryDragStarted",
    target: point.target,
    point: point.position,
  });
  const to: [number, number] = [point.position[0] + 0.25, point.position[1]];
  loop.dispatch({ type: "sketch.geometryDragMoved", point: to });
  loop.dispatch({ type: "sketch.geometryDragEnded", point: to });
  await waitForCondition(() => derivations.length === 3);
  derivations[2]!.resolve({
    regions: sketch.sketch.regions,
    diagnostics: [],
    offsetPublications: [],
  });
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );

  loop.dispatch({ type: "sketch.publishRequested" });
  await waitForCondition(() => commits.length === 1);
  const firstCommitRequestId = currentSketch().pendingCommitRequestId;
  expect(firstCommitRequestId).not.toBeNull();
  // The user presses Finish again while the first commit is still running.
  loop.dispatch({ type: "sketch.publishRequested" });
  loop.dispatch({ type: "tool.activated", toolId: "finishSketch" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(
    commits,
    "Finish while a commit is pending must not emit a second sketch.commit.",
  ).toHaveLength(1);

  expect(
    currentSketch().pendingCommitRequestId,
    "The first commit stays the pending one, so its result is honoured.",
  ).toBe(firstCommitRequestId);
  commits[0]!.resolve();
  await waitForState(loop, (state) => state.kind !== "editingSketch");
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(commits, "One publication for one edit.").toHaveLength(1);
  loop.stop();
});

test("EditorEventLoop keeps drag regions stale until the drag completes, then derives once", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const { runtime, derivations } = createControlledRegionRuntime(snapshot);
  const loop = createEditorEventLoop(runtime, createTestErrorReporter());
  const currentSketch = await openSeedSketch(loop, sketch.sketchId);
  await settleOpeningRounds(loop, derivations, sketch.sketch.regions);

  const point = currentSketch().session.definition.points[0]!;
  loop.dispatch({
    type: "sketch.geometryDragStarted",
    target: point.target,
    point: point.position,
  });
  loop.dispatch({
    type: "sketch.geometryDragMoved",
    point: [point.position[0] - 1, point.position[1] - 1],
  });
  loop.dispatch({
    type: "sketch.geometryDragMoved",
    point: [point.position[0] - 2, point.position[1] - 1],
  });
  expect(currentSketch().session.activeDrag).not.toBe(null);
  expect(
    getSketchSessionDerivedValidity(currentSketch().session).state,
    "Drag frames show the retained regions as stale.",
  ).toBe("stale");
  await Promise.resolve();
  expect(
    derivations,
    "No derivation is requested while the drag is active.",
  ).toHaveLength(2);

  loop.dispatch({
    type: "sketch.geometryDragEnded",
    point: [point.position[0] - 2, point.position[1] - 1],
  });
  await waitForCondition(() => derivations.length === 3);
  expect(derivations[2]!.input.basis.definition).toBe(
    currentSketch().session.liveSolve!.definition,
  );
  loop.stop();
});

test.each([false, true])(
  "EditorEventLoop derives nothing for a cancelled or unmoved annotation gesture; live regions stay current (T10 A11/A13, T14a C1, supersede=%s)",
  async (supersede) => {
    const snapshot = await createSeedDocumentSnapshot();
    const sketch = snapshot.document.sketches[0]!;
    snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
    const { runtime, derivations } = createControlledRegionRuntime(snapshot);
    const loop = createEditorEventLoop(
      { ...runtime, supersedesSketchRegionDerivation: supersede },
      createTestErrorReporter(),
    );
    const currentSketch = await openSeedSketch(loop, sketch.sketchId);
    await settleOpeningRounds(loop, derivations, sketch.sketch.regions);

    const dimension = currentSketch().session.definition.dimensions[0]!;
    const patch = (
      gesturePhase: "start" | "move" | "end" | "cancel",
      point: readonly [number, number],
    ) =>
      loop.dispatch({
        type: "sketch.toolPatched",
        patch: {
          intent: "setDimensionAnnotationPlacement",
          dimensionId: dimension.dimensionId,
          point,
          gesturePhase,
          clientPoint: point,
        },
      });
    const placement = () =>
      dimensionPlacement(currentSketch().session);
    /** A label restore re-bases nothing: no request, same generation, regions current. */
    const expectNoDerivation = async (
      derivationCount: number,
      generation: number,
      message: string,
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(derivations, message).toHaveLength(derivationCount);
      expect(currentSketch().pendingRegionRequest, message).toBe(null);
      expect(currentSketch().session.liveRegions.generation, message).toBe(
        generation,
      );
      expect(currentSketch().session.liveRegions.status, message).toBe(
        "current",
      );
    };
    const original = placement();
    const generation = currentSketch().session.liveRegions.generation;

    patch("start", [20, 10]);
    patch("move", [30, 15]);
    patch("cancel", [30, 15]);
    expect(placement()).toEqual(original);
    await expectNoDerivation(2, generation, "A cancel derives nothing.");

    patch("start", [20, 10]);
    patch("end", [22, 12]);
    expect(placement()).toEqual(original);
    await expectNoDerivation(2, generation, "A no-move end derives nothing.");

    patch("start", [20, 10]);
    patch("move", [40, 30]);
    patch("end", [40, 30]);
    const moved = placement();
    expect(moved).not.toEqual(original);
    expect(currentSketch().session.actionAvailability?.canUndo).toBe(true);
    patch("start", [40, 30]);
    patch("move", [60, 40]);
    patch("cancel", [60, 40]);
    expect(placement()).toEqual(moved);
    await expectNoDerivation(
      2,
      generation,
      "A cancel after a moved label derives nothing.",
    );

    // Undo re-bases once; a later label cancel derives nothing (review A-3).
    loop.dispatch({ type: "history.undoRequested" });
    await waitForCondition(() => derivations.length === 3);
    derivations[2]!.resolve({
      regions: sketch.sketch.regions,
      diagnostics: [],
      offsetPublications: [],
    });
    await waitForState(
      loop,
      (state) =>
        state.kind === "editingSketch" &&
        state.session.liveRegions.status === "current",
    );
    expect(placement()).toEqual(original);
    const undoneGeneration = currentSketch().session.liveRegions.generation;
    patch("start", [20, 10]);
    patch("move", [30, 15]);
    patch("cancel", [30, 15]);
    expect(placement()).toEqual(original);
    await expectNoDerivation(
      3,
      undoneGeneration,
      "Undo then a label cancel derives nothing more.",
    );
    loop.stop();
  },
);

test("EditorEventLoop reports a rejected background derivation and marks live regions failed", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const { runtime, derivations } = createControlledRegionRuntime(snapshot);
  const reporter = createTestErrorReporter();
  const loop = createEditorEventLoop(runtime, reporter);
  const currentSketch = await openSeedSketch(loop, sketch.sketchId);
  await waitForCondition(() => derivations.length === 1);
  const retained = currentSketch().session.liveRegions.regions;
  // The entry basis's request is stale once the projection result re-based.
  derivations[0]!.resolve({ regions: [], diagnostics: [], offsetPublications: [] });
  await waitForCondition(() => derivations.length === 2);

  derivations[1]!.reject(new Error("Region core exploded."));
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "failed",
  );
  expect(
    reporter.reports.map((report) => report.error.message),
    "The rejection reaches the normal editor error reporting.",
  ).toEqual(["Region core exploded."]);
  expect(currentSketch().session.liveRegions.regions).toBe(retained);
  const validity = getSketchSessionDerivedValidity(currentSketch().session);
  expect(validity.state).toBe("invalid");
  expect(
    validity.diagnostics.some(
      (diagnostic) =>
        diagnostic.code === "regions-derivation-failed" &&
        diagnostic.message === "Region core exploded.",
    ),
  ).toBe(true);
  expect(currentSketch().pendingRegionRequest).toBe(null);
  await Promise.resolve();
  expect(derivations, "A failure is not retried.").toHaveLength(2);
  loop.stop();
});

test("EditorEventLoop re-derives live regions after stop() drops an in-flight derivation", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const { runtime, derivations } = createControlledRegionRuntime(snapshot);
  const loop = createEditorEventLoop(runtime, createTestErrorReporter());
  const currentSketch = await openSeedSketch(loop, sketch.sketchId);
  await waitForCondition(() => derivations.length === 1);

  loop.stop();
  expect(
    currentSketch().pendingRegionRequest,
    "stop() drops the in-flight result, so the request must not stay outstanding.",
  ).toBe(null);
  loop.start();
  await waitForCondition(() => derivations.length === 2);
  derivations[0]!.resolve({ regions: [], diagnostics: [], offsetPublications: [] });
  derivations[1]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "after restart"),
    diagnostics: [],
    offsetPublications: [],
  });
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );
  expect(
    currentSketch().session.liveRegions.regions.map((region) => region.label),
  ).toEqual(["after restart"]);
  loop.stop();
});
