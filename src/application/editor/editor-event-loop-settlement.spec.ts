import { expect, it } from "vitest";
import { createEditorEventLoop } from "./editor-event-loop";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { createTestErrorReporter } from "@/contracts/errors";
import type { EditorEffectRuntime } from "@/core/editor/state-machine";
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
