import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import { stableJsonValue } from "@/contracts/modeling/authored-document-serialization";
import type { PersistedSketchDraft } from "@/contracts/sketch/draft-recovery";
import { canStartSketchFromTarget } from "@/domain/editor/sketch-session-controller";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import type { EditorTransitionResult } from "@/core/editor/state-machine";
import { emitSketchReferenceProjection } from "@/core/editor/state-machine/effect-emitters";

/** Sketch records have no separate revision counter. Compare authored content,
 * not document revisions (unrelated document edits must not invalidate a draft). */
export function publishedSketchRevision(value: unknown): string {
  return JSON.stringify(stableJsonValue(value));
}

export function shouldPersistSketchDraft(actionsSincePersist: number, elapsedMs: number) {
  return actionsSincePersist > 0 && (actionsSincePersist >= 10 || elapsedMs >= 60_000);
}

export function canOfferSketchDraft(
  draft: PersistedSketchDraft,
  snapshot: WorkspaceSnapshot,
  explicitFileOpen = false,
): boolean {
  if (explicitFileOpen || draft.documentId !== snapshot.document.documentId) return false;
  const sketch = snapshot.document.sketches.find(s => s.sketchId === draft.sketchId);
  if (draft.published) {
    return !!sketch && draft.publishedRevision === publishedSketchRevision({
      sketchId: sketch.sketchId, label: sketch.label, plane: sketch.plane,
      definition: sketch.sketch.definition,
    });
  }
  // A never-published sketch has a private identity; its support must still exist.
  return !sketch && canStartSketchFromTarget(draft.plane.support, snapshot);
}

/** Called only at ordinary sketch entry, before authored acceptance/projection.
 * This preserves rollback-aware opening and Finish's document-cursor restore. */
export function restoreSketchDraftSession(session: SketchSessionState, draft: PersistedSketchDraft): SketchSessionState {
  return rebuildSessionForDefinition({
    ...session,
    actionContextId: draft.sketchId,
    sketchLabel: draft.label,
    sequence: draft.sequence,
    // Always derive the recovered authored graph anew, never revive cached output.
    liveSolve: null,
    liveRegions: { generation: 0, status: "pending", regions: [], boundaryBasis: null, diagnostics: [] },
  }, { definition: draft.definition });
}

export function restoreSketchDraftEntry(result: EditorTransitionResult, draft: PersistedSketchDraft): EditorTransitionResult {
  const opened = result.state;
  if (opened.kind !== "editingSketch" || !opened.snapshot || !canOfferSketchDraft(draft, opened.snapshot) ||
      (draft.published ? opened.session.sketchId !== draft.sketchId : opened.session.sketchId !== null)) return result;
  const session = restoreSketchDraftSession(opened.session, draft);
  const recovered = emitSketchReferenceProjection({ ...opened, session, pendingProjectionRequestId: null, pendingRegionRequest: null }, session);
  return { ...recovered, effects: [
    ...result.effects.filter(effect => effect.type !== "sketch.projectReferences" && effect.type !== "sketch.deriveRegions"),
    ...recovered.effects,
  ] };
}
