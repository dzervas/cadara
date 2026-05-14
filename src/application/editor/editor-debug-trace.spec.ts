import { test, expect } from "vitest";

import { createEditorDebugTraceRecorder } from "@/application/editor/editor-debug-trace";
import { createEditorEventLoop } from "@/application/editor/editor-event-loop";
import type { EditorRuntimeTraceEntry } from "@/domain/debug/debug-platform";
import type {
  EditorEvent,
  EditorEffectRuntime,
} from "@/domain/editor/state-machine";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createTestErrorReporter } from "@/contracts/errors";

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

function waitForTraceEntries(
  entries: EditorRuntimeTraceEntry[],
  count: number,
): Promise<void> {
  if (entries.length >= count) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      reject(new Error("Timed out waiting for runtime trace entries."));
    }, 2_000);
    const intervalId = setInterval(() => {
      if (entries.length < count) {
        return;
      }

      clearTimeout(timeoutId);
      clearInterval(intervalId);
      resolve();
    }, 0);
  });
}

test("src/application/editor/editor-debug-trace.spec.ts keeps a bounded runtime trace ring buffer", () => {
  const recorder = createEditorDebugTraceRecorder(2);

  recorder.record({
    kind: "effect-started",
    sequence: 1,
    at: "2026-05-03T00:00:00.000Z",
    effect: { type: "document.fetchSnapshot", requestId: "request_1" },
    queueDepthAfterStart: 1,
  });
  recorder.record({
    kind: "effect-started",
    sequence: 2,
    at: "2026-05-03T00:00:01.000Z",
    effect: { type: "document.fetchSnapshot", requestId: "request_2" },
    queueDepthAfterStart: 0,
  });
  recorder.record({
    kind: "effect-started",
    sequence: 3,
    at: "2026-05-03T00:00:02.000Z",
    effect: { type: "document.fetchSnapshot", requestId: "request_3" },
    queueDepthAfterStart: 0,
  });

  const snapshot = recorder.getSnapshot();

  expect(snapshot.maxEntries, "Trace recorder should report its configured capacity.").toBe(2);
  expect(
    snapshot.totalEntries,
    "Trace recorder should report the total recorded entry count.",
  ).toBe(3);
  expect(
    snapshot.droppedEntries,
    "Trace recorder should count entries dropped from the ring buffer.",
  ).toBe(1);
  expect(
    snapshot.entries.length,
    "Trace recorder should keep only the bounded recent entries.",
  ).toBe(2);
  expect(
    snapshot.entries[0]?.sequence,
    "Trace recorder should evict the oldest entry first.",
  ).toBe(2);
  expect(snapshot.entries[1]?.sequence, "Trace recorder should retain the newest entry.").toBe(3);
});

test("src/application/editor/editor-debug-trace.spec.ts observes event, effect completion, and follow-up transition sequencing", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const traces: EditorRuntimeTraceEntry[] = [];
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) => {
      const event: EditorEvent = {
        type: "effect.snapshotLoaded",
        payload: {
          requestId: effect.requestId,
          documentId: snapshot.document.documentId,
          revisionId: snapshot.document.revisionId,
          snapshot,
          selectionCatalog: buildSelectionTargetCatalog(snapshot),
          preserveRenderRecordsOnFeatureDiagnostics: false,
        },
      };

      return event;
    },
  );

  const traceSubscription = loop.subscribeToTrace((entry) => {
    traces.push(entry);
  });

  loop.start();

  await waitForTraceEntries(traces, 3);

  const dispatchedTrace = traces[0];
  const startedTrace = traces[1];
  const completedTrace = traces[2];

  expect(
    dispatchedTrace?.kind,
    "Trace observers should see the initial session.started dispatch.",
  ).toBe("event-dispatched");
  if (dispatchedTrace?.kind === "event-dispatched") {
    expect(
      dispatchedTrace.event.type,
      "Trace observers should receive the dispatched event type.",
    ).toBe("session.started");
    expect(
      dispatchedTrace.emittedEffects[0]?.type,
      "Dispatched events should report emitted effects.",
    ).toBe("document.fetchSnapshot");
  }
  expect(
    startedTrace?.kind,
    "Trace observers should see effect execution start.",
  ).toBe("effect-started");
  expect(
    completedTrace?.kind,
    "Trace observers should see completed effects.",
  ).toBe("effect-completed");
  if (completedTrace?.kind === "effect-completed") {
    expect(
      completedTrace.completion.type,
      "Completed effects should report the follow-up event type.",
    ).toBe("effect.snapshotLoaded");
    expect(
      completedTrace.state.revisionId,
      "Completed effects should report the accepted state summary.",
    ).toBe(snapshot.document.revisionId);
  }

  traceSubscription.unsubscribe();
  loop.stop();
});

test("src/application/editor/editor-debug-trace.spec.ts records failed effects without changing runtime ownership", async () => {
  const snapshot = await createSeedDocumentSnapshot();
  const traces: EditorRuntimeTraceEntry[] = [];
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async () => {
      throw new Error("Trace this failure.");
    },
  );

  const traceSubscription = loop.subscribeToTrace((entry) => {
    traces.push(entry);
  });

  loop.start();

  await waitForTraceEntries(traces, 3);

  const failedTrace = traces[2];

  expect(
    failedTrace?.kind,
    "Trace observers should receive failed effect entries.",
  ).toBe("effect-failed");
  if (failedTrace?.kind === "effect-failed") {
    expect(
      failedTrace.error.message,
      "Failed effect entries should summarize the surfaced error.",
    ).toBe("Trace this failure.");
    expect(
      failedTrace.failure.type,
      "Failed effect entries should report the synthesized failure event.",
    ).toBe("effect.snapshotFailed");
  }

  traceSubscription.unsubscribe();
  loop.stop();
});
