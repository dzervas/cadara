import { describe, expect, test } from "vitest";

import { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID } from "@/domain/reference-image-calibration/mode/shared";
import { makeAnnotationLifecycleState } from "@/domain/editor/annotation-lifecycle.fixtures";
import { getSketchAnnotationAffectedGeometryRefs } from "@/domain/editor/sketch-session";
import { transitionEditorState } from "./reducer-root";
import { getEditorViewState } from "./selectors";
import type { EditorEvent, EditorState, SketchEditorState } from "./types";

// Logic lane (editor transition seam `transitionEditorState`, action-owner
// seam `SketchAuthoredActions`): T14e's Show all switch (T-11/A-8) is editor
// UI state of the open sketch: it survives tool switches and special modes,
// ends with the sketch, is never authored and never an action. A list row
// selects through the same event as any annotation selection (T14c "select
// an annotation": owners = the annotation's affected geometry).

function apply(state: EditorState, event: EditorEvent) {
  const next = transitionEditorState(state, event).state;
  expect(next.kind, `${event.type} stays in sketch editing`).toBe(
    "editingSketch",
  );
  return next as SketchEditorState;
}

const showAll = (state: EditorState, value: boolean) =>
  apply(state, { type: "sketch.showAllAnnotationsChanged", showAll: value });
const viewShowAll = (state: EditorState) =>
  getEditorViewState(state).showAllAnnotations;

describe("T14e Show all", () => {
  test("the switch sets the editor flag and the view state; the session is untouched", async () => {
    const { state } = await makeAnnotationLifecycleState();
    expect(viewShowAll(state), "off by default").toBe(false);

    const on = showAll(state, true);
    expect(on.showAllAnnotations).toBe(true);
    expect(viewShowAll(on)).toBe(true);
    expect(on.session, "never in the session (no descriptor re-solve)").toBe(
      state.session,
    );
    expect(showAll(on, true), "setting the same value is a no-op").toBe(on);

    const off = showAll(on, false);
    expect(viewShowAll(off)).toBe(false);
    expect(off.session).toBe(state.session);
  });

  test("it survives tool switches, clearing the tool, Escape and special modes", async () => {
    const { state, image } = await makeAnnotationLifecycleState();
    let current = showAll(state, true);
    for (const event of [
      { type: "tool.activated", toolId: "line" },
      { type: "sketch.escapeRequested" },
      { type: "sketch.activeToolCleared" },
      { type: "tool.activated", toolId: "constraintHorizontal" },
      { type: "sketch.activeToolCleared" },
      { type: "tool.activated", toolId: "trim" },
      { type: "sketch.activeToolCleared" },
      { type: "selection.cleared" },
    ] as const satisfies readonly EditorEvent[]) {
      current = apply(current, event);
      expect(viewShowAll(current), `after ${event.type}`).toBe(true);
    }

    const special = apply(current, {
      type: "sketch.specialModeEntered",
      modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
      operationId: (image as { operationId: string }).operationId as never,
    });
    expect(
      special.session.activeSpecialMode?.modeId,
      "premise: the mode is entered",
    ).toBe(REFERENCE_IMAGE_CALIBRATION_MODE_ID);
    expect(viewShowAll(special), "kept in a special mode").toBe(true);
  });

  test("it ends with the sketch: Finish and Cancel leave it behind, a reopened sketch starts with it off", async () => {
    const { state } = await makeAnnotationLifecycleState();
    const on = showAll(state, true);

    const finished = transitionEditorState(on, {
      type: "tool.activated",
      toolId: "finishSketch",
    });
    expect(
      finished.effects.map((effect) => effect.type),
      "premise: Finish commits",
    ).toContain("sketch.commit");
    const committing = finished.state as SketchEditorState;
    const committed = transitionEditorState(committing, {
      type: "effect.sketchCommitted",
      requestId: committing.pendingCommitRequestId!,
      documentId: state.document.documentId!,
      commandSessionId: committing.command.commandSessionId,
      baseRevisionId: state.document.revisionId!,
      revisionId: state.document.revisionId!,
      accepted: true,
      diagnostics: [],
    }).state;
    expect(committed.kind, "premise: the published sketch is left").not.toBe(
      "editingSketch",
    );
    expect(viewShowAll(committed)).toBe(false);

    const left = transitionEditorState(on, {
      type: "command.cancelled",
      commandSessionId: on.command.commandSessionId,
    }).state;
    expect(left.kind, "premise: the sketch is left").toBe("idle");
    expect(viewShowAll(left)).toBe(false);

    const command = transitionEditorState(left, {
      type: "tool.activated",
      toolId: "sketch",
    }).state;
    const reopened = transitionEditorState(
      { ...command, pendingRequestId: "request_reopen" } as EditorState,
      {
        type: "effect.sketchSessionOpened",
        requestId: "request_reopen",
        documentId: state.document.documentId!,
        revisionId: state.document.revisionId!,
        commandSessionId: (command as SketchEditorState).command
          .commandSessionId,
        session: on.session,
      },
    ).state;
    expect(reopened.kind, "premise: reopened").toBe("editingSketch");
    expect(viewShowAll(reopened), "a reopened sketch starts off").toBe(false);
  });

  test("toggling it is never an action; the session object is kept through the action owner", async () => {
    const fixture = await makeAnnotationLifecycleState();
    const owner = new SketchAuthoredActions();
    let state: EditorState = fixture.state;
    const dispatch = (event: EditorEvent) => {
      state = owner.transition(state, event, (current) =>
        transitionEditorState(current, event),
      ).state;
      if (state.kind !== "editingSketch") throw Error("Expected sketch state");
      return state;
    };
    const undoLabels = () =>
      (state as SketchEditorState).session.actionHistory?.undo.map(
        (entry) => entry.label,
      ) ?? [];
    const before = dispatch({ type: "selection.cleared" }).session;

    const on = dispatch({
      type: "sketch.showAllAnnotationsChanged",
      showAll: true,
    });
    const off = dispatch({
      type: "sketch.showAllAnnotationsChanged",
      showAll: false,
    });
    expect(on.showAllAnnotations, "premise: toggled on").toBe(true);
    expect(off.showAllAnnotations, "premise: toggled off").toBe(false);
    expect(undoLabels(), "no Undo entry").toEqual([]);
    expect(off.session, "the session object is kept").toBe(before);
  });

  test("a list row selects its annotation: selection = [A], owners = A's affected geometry", async () => {
    const { state, g, h, c } = await makeAnnotationLifecycleState();
    const selected = apply(state, {
      type: "viewport.selectionRequested",
      target: c,
    });
    expect(selected.selection).toEqual([c]);
    const owners = getSketchAnnotationAffectedGeometryRefs(state.session, c);
    expect(owners, "premise: C is Parallel on G and H").toEqual([g, h]);
    expect(selected.annotationContext).toEqual({ owners, last: c });
  });
});
