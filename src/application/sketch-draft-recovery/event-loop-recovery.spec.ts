import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
import { expect, test, vi } from "vitest";
import { createEditorEventLoop } from "@/application/editor/editor-event-loop";
import { createTestErrorReporter } from "@/contracts/errors";
import type { EditorEffectRuntime } from "@/core/editor/state-machine";
import { createSketchDraftRecoveryController } from "./controller";
import { makeSketchDraftRecoveryFixture } from "./recovery.fixtures";
import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
import { createSketchSessionFromSnapshot } from "@/core/editor/sketch-session";

for (const published of [false, true]) {
  test(`Resume uses normal sketch opening for a ${published ? "published" : "new private"} sketch and never invokes publication`, async () => {
    const { snapshot, draft, session } = await makeSketchDraftRecoveryFixture(published);
    const authored = await createSketchActionOwnerFixture(published
      ? createSketchSessionFromSnapshot(snapshot.document.sketches[0]!, snapshot.document.settings)
      : session);
    authored.dispatch({ type: "tool.activated", toolId: "rectangle" });
    authored.dispatch({ type: "sketch.primitiveAuthored", construction: false, primitive: { kind: "rectangle", start: [100, 100], end: [120, 115] } });
    draft.definition = authored.session.definition;
    let live = snapshot;
    const unexpected = async () => { throw new Error("Recovery must not invoke a document mutation"); };
    const commit = vi.fn(unexpected);
    const derive: NonNullable<EditorEffectRuntime["deriveSketchRegions"]> = vi.fn(async () => ({
      regions: [], diagnostics: [], offsetPublications: [],
    }));
    const runtime: EditorEffectRuntime = {
      getCurrentDocumentSnapshot: async () => live,
      commitSketch: commit,
      commitSketchPlane: unexpected,
      evaluatePreview: unexpected,
      commitFeature: unexpected,
      projectSketchReferences: async () => ({ projectedReferences: [], diagnostics: [] }),
      deriveSketchRegions: derive,
      setDocumentCursor: async input => {
        live = { ...live, document: { ...live.document, cursor: input.cursor } };
        return { revisionId: live.document.revisionId, accepted: true, diagnostics: [] };
      },
    };
    const loop = createEditorEventLoop(runtime, createTestErrorReporter(), undefined, defaultEditorExtensionDependencies);
    const store = { load: () => draft, save: vi.fn(), clear: vi.fn() };
    await loop.startAndSettle("load");
    const recovery = createSketchDraftRecoveryController(loop, store);
    const disconnect = recovery.connect(error => { throw error; });
    try {
      expect(recovery.getOffer()).toEqual(draft);
      expect(loop.getState().kind, "loading only offers; it does not resume").toBe("idle");
      recovery.resume();
      await loop.drain();
      const state = loop.getState();
      expect(state.kind).toBe("editingSketch");
      if (state.kind !== "editingSketch") throw new Error("Expected recovered draft");
      expect(state.session.actionContextId).toBe(draft.sketchId);
      expect(state.session.definition).toEqual(draft.definition);
      expect(state.session.liveSolve).not.toBeNull();
      expect(state.session.liveRegions.status).toBe("current");
      expect(derive).toHaveBeenCalledWith(expect.objectContaining({ basis: expect.objectContaining({
        definition: expect.objectContaining({ entityIds: draft.definition.entityIds }),
      }) }));
      expect(loop.getSketchDraftCheckpoint()?.publishedRevision).toBe(draft.publishedRevision);
      expect(state.snapshot?.document.sketches).toEqual(snapshot.document.sketches);
      expect(recovery.getOffer()).toBeNull();
      expect(commit).not.toHaveBeenCalled();
      expect(store.clear, "the checkpoint survives until Finish/Discard").not.toHaveBeenCalled();
      if (published) expect(state.editSessionCursorContext?.phase).toBe("active");
    } finally {
      disconnect();
      loop.stop();
    }
  });
}
