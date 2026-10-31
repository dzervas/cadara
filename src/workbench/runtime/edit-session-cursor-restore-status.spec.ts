import { expect, it } from "vitest";
import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
import { createEditorEventLoop } from "@/application/editor/editor-event-loop";
import { createSeedDocumentSnapshot } from "@/application/modeling/modeling-test-fixtures";
import { createTestErrorReporter } from "@/contracts/errors";
import type { EditorEffectRuntime } from "@/core/editor/state-machine";
import { isEditSessionCursorRestorePending } from "./edit-session-cursor-restore-status";

// Logic seam: the real editor event loop reopening a mid-history sketch and
// finishing it, with a fake modeling runtime. The rebuild status must cover
// the roll-forward and end with it, whether it lands or fails.
async function finishReopenedSketch(restore: "lands" | "fails") {
  let snapshot = await createSeedDocumentSnapshot();
  let moves = 0;
  const runtime: EditorEffectRuntime = {
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
    projectSketchReferences: async () => ({ projectedReferences: [], diagnostics: [] }),
    deriveSketchRegions: async () => ({ regions: [], diagnostics: [], offsetPublications: [] }),
    setDocumentCursor: async (input) => {
      moves += 1;
      if (moves === 2 && restore === "fails") throw new Error("Restore failed");
      snapshot = structuredClone(snapshot);
      snapshot.document.cursor = input.cursor;
      return { revisionId: snapshot.document.revisionId, accepted: true, diagnostics: [] };
    },
  };
  const loop = createEditorEventLoop(
    runtime,
    createTestErrorReporter(),
    undefined,
    defaultEditorExtensionDependencies,
  );
  const pending: boolean[] = [];
  loop.subscribe((state) => pending.push(isEditSessionCursorRestorePending(state)));
  await loop.startAndSettle("startup");
  await loop.dispatchAndSettle("reopen", {
    type: "authoring.reopenRequested",
    toolId: "sketch",
    target: { kind: "sketch", sketchId: snapshot.document.sketches[0]!.sketchId },
  });
  expect(loop.getState().editSessionCursorContext?.phase).toBe("active");
  pending.length = 0;
  await loop.dispatchAndSettle("finish", { type: "sketch.publishRequested" });
  await loop.drain();
  const final = loop.getState();
  loop.stop();
  return { pending, final, moves };
}

it("shows the rebuild status while a finished edit session rolls forward and clears it when the cursor lands", async () => {
  const { pending, final, moves } = await finishReopenedSketch("lands");
  expect(moves, "rollback, then restore").toBe(2);
  expect(pending, "the roll-forward is shown as a rebuild").toContain(true);
  expect(final.editSessionCursorContext).toBeNull();
  expect(isEditSessionCursorRestorePending(final)).toBe(false);
});

it("ends the rebuild status when the roll-forward fails, leaving the failure notice", async () => {
  const { final, moves } = await finishReopenedSketch("fails");
  expect(moves, "rollback, then the failed restore").toBe(2);
  expect(final.failureNotice).toEqual({ kind: "historyMove", message: "Restore failed" });
  // The failed restore keeps the context in its restore phase; the status
  // must not stay over the viewport behind the notice.
  expect(final.editSessionCursorContext?.phase).toMatch(/^restor/);
  expect(isEditSessionCursorRestorePending(final)).toBe(false);
});
