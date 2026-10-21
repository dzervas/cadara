import { expect, test } from "vitest";
import { canOfferSketchDraft, restoreSketchDraftSession, shouldPersistSketchDraft } from "./rules";
import { makeSketchDraftRecoveryFixture } from "./recovery.fixtures";
import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
import { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";
import { transitionEditorState, type EditorEvent } from "@/core/editor/state-machine";

test("persist after ten completed actions OR sixty seconds, never gesture-only/unchanged state", () => {
  expect(shouldPersistSketchDraft(9, 59_999)).toBe(false);
  expect(shouldPersistSketchDraft(10, 1)).toBe(true);
  expect(shouldPersistSketchDraft(1, 60_000)).toBe(true);
  expect(shouldPersistSketchDraft(0, 600_000)).toBe(false);
});

test("offer has no age expiry, ignores unrelated document revisions, rejects deletion, changed publication and explicit file open", async () => {
  const { snapshot, draft } = await makeSketchDraftRecoveryFixture(true);
  expect(canOfferSketchDraft({ ...draft, persistedAt: 0 }, snapshot)).toBe(true);
  expect(canOfferSketchDraft(draft, { ...snapshot, document: { ...snapshot.document, revisionId: "rev_unrelated" } })).toBe(true);
  expect(canOfferSketchDraft(draft, snapshot, true)).toBe(false);
  const deleted = structuredClone(snapshot);
  deleted.document.sketches = deleted.document.sketches.filter(s => s.sketchId !== draft.sketchId);
  expect(canOfferSketchDraft(draft, deleted)).toBe(false);
  const changed = structuredClone(snapshot);
  changed.document.sketches[0]!.sketch.definition.points[0]!.position = [123, 456];
  expect(canOfferSketchDraft(draft, changed)).toBe(false);
});

test("Resume reconstructs a private session from authored data and recomputes solve, regions and diagnostics without publishing", async () => {
  const { snapshot, draft, session } = await makeSketchDraftRecoveryFixture();
  const f = await createSketchActionOwnerFixture(session);
  f.dispatch({ type: "sketch.primitiveAuthored", construction: false, primitive: { kind: "rectangle", start: [10, 10], end: [30, 25] } });
  await f.settle();
  const stored = { ...draft, definition: structuredClone(f.session.definition) };
  const restored = restoreSketchDraftSession(session, stored);
  expect(restored.sketchId).toBeNull();
  expect(restored.definition).toEqual(stored.definition);
  expect(restored.liveSolve).not.toBeNull();
  expect(restored.liveRegions.regions).toEqual([]);
  // Fixture's commit port throws if recovery ever tries to publish.
  const recovered = await createSketchActionOwnerFixture(restored);
  expect(recovered.session.liveRegions.status).toBe("current");
  expect(recovered.session.liveRegions.regions.length).toBeGreaterThan(0);
  expect(recovered.session.liveSolve?.solvedSnapshot.diagnostics).toEqual([]);
  expect(snapshot.document.sketches.some(s => s.sketchId === draft.sketchId)).toBe(false);
});

test("accepted checkpoint excludes unfinished creation; Undo/Redo are completed actions", async () => {
  const { session } = await makeSketchDraftRecoveryFixture();
  const f = await createSketchActionOwnerFixture(session);
  const owner = new SketchAuthoredActions();
  let state = f.state;
  const dispatch = (event: EditorEvent) => {
    const result = owner.transition(state, event, current => transitionEditorState(current, event));
    if (result.state.kind !== "editingSketch") throw new Error("Expected private sketch");
    state = result.state;
  };
  dispatch({ type: "tool.activated", toolId: "line" });
  dispatch({ type: "sketch.primitiveAuthored", construction: false, primitive: { kind: "line", start: [10, 10], end: [20, 13] } });
  const accepted = owner.getDraftCheckpoint(state)!;
  expect(accepted.completedActions).toBe(1);
  dispatch({ type: "tool.activated", toolId: "spline" });
  dispatch({ type: "sketch.pointerReleased", point: [50, 50], sketchUnitsPerPixel: null });
  expect(state.session.toolPlacedPoints).toHaveLength(1);
  expect(owner.getDraftCheckpoint(state)?.definition).toBe(accepted.definition);
  dispatch({ type: "history.undoRequested" });
  expect(owner.getDraftCheckpoint(state)?.completedActions).toBe(1);
  dispatch({ type: "history.undoRequested" });
  expect(owner.getDraftCheckpoint(state)?.completedActions).toBe(2);
  expect(owner.getDraftCheckpoint(state)?.definition.entities).toHaveLength(0);
  dispatch({ type: "history.redoRequested" });
  expect(owner.getDraftCheckpoint(state)?.completedActions).toBe(3);
  expect(owner.getDraftCheckpoint(state)?.definition.entities).toHaveLength(1);
});
