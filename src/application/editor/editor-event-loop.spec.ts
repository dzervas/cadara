import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
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
import {
  getSketchSessionDerivedValidity,
  getSketchSessionPreviewLabel,
  withLiveSolveBasis,
} from "@/domain/editor/sketch-session";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { SketchConstraintSolverAdapter } from "@/domain/solver/sketch-constraint-solver-adapter";
import { isSketchProfileOutputCurrent } from "@/contracts/sketch/derived-validity";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createTestErrorReporter } from "@/contracts/errors";
import { createEditorEventLoop } from "./editor-event-loop";

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

test("EditorEventLoop Undo and Redo recompute equivalent invalid diagnostics and profile capability", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  snapshot.cursor = { kind: "sketch", sketchId: sketch.sketchId };
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

  const conflictIds = [
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
      point: [x, 0, 0],
    });
    loop.dispatch({
      type: "sketch.specialModeDragEnded",
      handle,
      point: [x, 0, 0],
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
  expect(isSketchProfileOutputCurrent(invalidValidity)).toBe(false);
  const invalidFeedback = getSketchSessionPreviewLabel(currentSession());
  expect(invalidFeedback).toMatch(/residual/i);

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
  expect(
    isSketchProfileOutputCurrent(
      getSketchSessionDerivedValidity(currentSession()),
    ),
  ).toBe(true);

  loop.dispatch({ type: "history.undoRequested" });
  const undoneValidity = getSketchSessionDerivedValidity(currentSession());
  expect(currentSession().liveRegions.status).toBe("unavailable");
  expect(undoneValidity).toEqual(invalidValidity);
  expect(getSketchSessionPreviewLabel(currentSession())).toBe(invalidFeedback);
  expect(isSketchProfileOutputCurrent(undoneValidity)).toBe(false);

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
  expect(isSketchProfileOutputCurrent(redoneValidity)).toBe(true);
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
  await waitForState(loop, (state) => state.kind === "editingSketch");
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

test("EditorEventLoop derives live regions in the background, discards stale generations and coalesces to the latest basis", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  snapshot.cursor = { kind: "sketch", sketchId: sketch.sketchId };
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
  expect(derivations[0]!.input.basis.definition).toBe(
    opened.session.liveSolve!.definition,
  );

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
  const reopened = currentSketch();
  expect(reopened.command.commandSessionId).not.toBe(finishedSessionId);
  const reopenedRequest = reopened.pendingRegionRequest;
  expect(reopenedRequest?.requestId).toBe(derivations[3]!.input.requestId);
  const reopenedRegions = reopened.session.liveRegions.regions;

  derivations[2]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "finished session"),
    diagnostics: [],
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

  derivations[3]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "reopened session"),
    diagnostics: [],
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

test("EditorEventLoop keeps drag regions stale until the drag completes, then derives once", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  snapshot.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const { runtime, derivations } = createControlledRegionRuntime(snapshot);
  const loop = createEditorEventLoop(runtime, createTestErrorReporter());
  const currentSketch = await openSeedSketch(loop, sketch.sketchId);
  await waitForCondition(() => derivations.length === 1);
  derivations[0]!.resolve({
    regions: sketch.sketch.regions,
    diagnostics: [],
  });
  await waitForState(
    loop,
    (state) =>
      state.kind === "editingSketch" &&
      state.session.liveRegions.status === "current",
  );

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
  ).toHaveLength(1);

  loop.dispatch({
    type: "sketch.geometryDragEnded",
    point: [point.position[0] - 2, point.position[1] - 1],
  });
  await waitForCondition(() => derivations.length === 2);
  expect(derivations[1]!.input.basis.definition).toBe(
    currentSketch().session.liveSolve!.definition,
  );
  loop.stop();
});

test.each([false, true])(
  "EditorEventLoop derives a restored annotation-gesture basis once (T10 A11/A13, supersede=%s)",
  async (supersede) => {
    const snapshot = await createSeedDocumentSnapshot();
    const sketch = snapshot.document.sketches[0]!;
    snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
    snapshot.cursor = { kind: "sketch", sketchId: sketch.sketchId };
    const { runtime, derivations } = createControlledRegionRuntime(snapshot);
    const loop = createEditorEventLoop(
      { ...runtime, supersedesSketchRegionDerivation: supersede },
      createTestErrorReporter(),
    );
    const currentSketch = await openSeedSketch(loop, sketch.sketchId);
    await waitForCondition(() => derivations.length === 1);
    derivations[0]!.resolve({
      regions: sketch.sketch.regions,
      diagnostics: [],
    });
    await waitForState(
      loop,
      (state) =>
        state.kind === "editingSketch" &&
        state.session.liveRegions.status === "current",
    );

    const dimension = currentSketch().session.definition.dimensions[0]!;
    const patch = (
      gesturePhase: "start" | "move" | "cancel",
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
    patch("start", [20, 10]);
    patch("move", [30, 15]);
    patch("cancel", [30, 15]);
    await waitForCondition(() => derivations.length === 2);
    const restored = currentSketch();
    expect(restored.pendingRegionRequest).toEqual({
      requestId: derivations[1]!.input.requestId,
      generation: restored.session.liveRegions.generation,
    });
    expect(derivations[1]!.input.basis.definition).toBe(
      restored.session.liveSolve!.definition,
    );
    derivations[1]!.resolve({
      regions: sketch.sketch.regions,
      diagnostics: [],
    });
    await waitForState(
      loop,
      (state) =>
        state.kind === "editingSketch" &&
        state.session.liveRegions.status === "current",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      derivations,
      "The cancel restores after the reducer; the reducer's request for the superseded basis is dropped, so the restored basis derives once.",
    ).toHaveLength(2);
    loop.stop();
  },
);

test("EditorEventLoop reports a rejected background derivation and marks live regions failed", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  snapshot.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  const { runtime, derivations } = createControlledRegionRuntime(snapshot);
  const reporter = createTestErrorReporter();
  const loop = createEditorEventLoop(runtime, reporter);
  const currentSketch = await openSeedSketch(loop, sketch.sketchId);
  await waitForCondition(() => derivations.length === 1);
  const retained = currentSketch().session.liveRegions.regions;

  derivations[0]!.reject(new Error("Region core exploded."));
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
  expect(derivations, "A failure is not retried.").toHaveLength(1);
  loop.stop();
});

test("EditorEventLoop re-derives live regions after stop() drops an in-flight derivation", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const sketch = snapshot.document.sketches[0]!;
  snapshot.document.cursor = { kind: "sketch", sketchId: sketch.sketchId };
  snapshot.cursor = { kind: "sketch", sketchId: sketch.sketchId };
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
  derivations[0]!.resolve({ regions: [], diagnostics: [] });
  derivations[1]!.resolve({
    regions: relabelRegions(sketch.sketch.regions, "after restart"),
    diagnostics: [],
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
