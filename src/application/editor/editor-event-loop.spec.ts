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
import { createReferenceImageOperation } from "@/domain/reference-image/operations";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createTestErrorReporter } from "@/contracts/errors";
import { createEditorEventLoop } from "./editor-event-loop";

function createRuntime(
  snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>,
): EditorEffectRuntime {
  return {
    async getCurrentDocumentSnapshot() {
      return snapshot;
    },
    async commitSketch() {
      return null;
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
  let resolveEffect: ((event: EditorEvent) => void) | null = null;
  let inFlightRequestId: EditorEffect["requestId"] | null = null;
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) =>
      new Promise<EditorEvent>((resolve) => {
        inFlightRequestId = effect.requestId;
        resolveEffect = resolve;
      }),
  );

  loop.start();
  await waitForState(
    loop,
    (candidate) => candidate.pendingSnapshotRequestId !== null,
  );

  loop.stop();
  resolveEffect?.({
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
  snapshot.cursor = { kind: "sketch", sketchId: sketch.sketchId };
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
  const startAndMove = (point: readonly [number, number, number]) => {
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
    currentSketch().session.definition.dimensions[0]!.annotationPlacement,
  ).toEqual(originalPlacement);
  annotationPatch("start", [40, 20]);
  annotationPatch("move", [50, 25]);
  annotationPatch("cancel", [50, 25]);
  expect(
    currentSketch().session.definition.dimensions[0]!.annotationPlacement,
  ).toEqual(originalPlacement);
  expect(currentSketch().session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: true,
  });
  annotationPatch("start", [60, 30]);
  annotationPatch("end", [60, 30]);
  expect(
    currentSketch().session.definition.dimensions[0]!.annotationPlacement,
  ).toEqual(originalPlacement);
  expect(currentSketch().session.actionAvailability).toEqual({
    canUndo: false,
    canRedo: true,
  });

  enterMode();
  startAndMove([20, 10, 0]);
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
  startAndMove([30, 15, 0]);
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
  startAndMove([40, 20, 0]);
  loop.dispatch({
    type: "sketch.specialModeDragEnded",
    handle,
    point: [40, 20, 0],
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
  startAndMove([50, 25, 0]);
  loop.dispatch({ type: "tool.activated", toolId: "finishSketch" });
  await waitForCondition(() => committedPoint !== null);
  expect(committedPoint).toEqual(originalPoint);
  loop.stop();
});

function moveFirstPoint(
  session: Extract<EditorState, { kind: "editingSketch" }>["session"],
  point: readonly [number, number, number],
) {
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
