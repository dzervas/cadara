import { test, expect } from "vitest";

import type {
  EditorEffect,
  EditorEffectRuntime,
  EditorEvent,
  EditorState,
} from "@/domain/editor/state-machine";
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
