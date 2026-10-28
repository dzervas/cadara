import { defaultEditorExtensionDependencies } from "@/composition/editor-extension-dependencies";
import { describe, expect, test } from "vitest";

import { makeAnnotationLifecycleState } from "@/core/editor/annotation-lifecycle.fixtures";
import { transitionEditorState } from "./reducer-root";
import { getEditorViewState } from "./selectors";
import type { EditorEvent, EditorState, SketchEditorState } from "./types";

// Logic lane (editor transition seam `transitionEditorState`): T17h and
// O3/D2 (cadara-b3k.4). Non-value constraints return to Select; value tools
// restart with an empty pick and stay armed until Escape. F-1 still requires
// clearing the committed pick on both annotation-placement paths.

function apply(state: EditorState, event: EditorEvent) {
  const next = transitionEditorState(state, event, defaultEditorExtensionDependencies).state;
  expect(next.kind, `${event.type} stays in sketch editing`).toBe(
    "editingSketch",
  );
  return next as SketchEditorState;
}

const activeCommand = (state: EditorState) =>
  getEditorViewState(state).activeCommand;

describe("T17h / D2: constraint commands follow their commit lifecycle", () => {
  test("Horizontal: the last pick commits; the command is Select again", async () => {
    const { state, h } = await makeAnnotationLifecycleState();
    const armed = apply(state, {
      type: "tool.activated",
      toolId: "constraintHorizontal",
    });
    expect(armed.session.activeTool, "premise: armed").toBe(
      "constraintHorizontal",
    );
    expect(activeCommand(armed)?.toolId).toBe("constraintHorizontal");

    const committed = apply(armed, {
      type: "viewport.selectionRequested",
      target: h,
    });
    expect(
      committed.session.definition.constraints.filter(
        (constraint) =>
          constraint.kind === "horizontal" &&
          "entityId" in constraint &&
          constraint.entityId === (h as { entityId: string }).entityId,
      ),
      "premise: Horizontal on H is committed",
    ).toHaveLength(1);
    expect(committed.session.activeTool, "premise: the tool disarms").toBe(
      null,
    );
    expect(committed.command).toMatchObject({
      toolId: "sketch",
      phase: "editing",
    });
    expect(activeCommand(committed)?.toolId).toBe("sketch");
  });

  test("Distance: the value commit re-arms with an empty pick; Escape returns to Select", async () => {
    const { state, h } = await makeAnnotationLifecycleState();
    let current = apply(state, {
      type: "tool.activated",
      toolId: "dimensionDistance",
    });
    current = apply(current, {
      type: "viewport.selectionRequested",
      target: h,
    });
    current = apply(current, {
      type: "sketch.toolPatched",
      patch: { intent: "setConstraintAnnotationPlacement", point: [5, 8] },
    });
    expect(
      current.session.constraintAuthoring?.isPreviewPinned,
      "premise: the value input is open",
    ).toBe(true);
    expect(current.command.toolId).toBe("dimensionDistance");

    const committed = apply(current, {
      type: "sketch.toolPatched",
      patch: { intent: "commitConstraintValue" },
    });
    expect(
      committed.session.definition.dimensions,
      "premise: one dimension is committed",
    ).toHaveLength(1);
    expect(committed.session.activeTool).toBe("dimensionDistance");
    expect(committed.session.status).toBe("collectingTargets");
    expect(committed.session.constraintAuthoring?.selectedTargets).toEqual([]);
    expect(committed.session.constraintAuthoring?.isPreviewPinned).toBe(false);
    expect(committed.session.toolPresentation?.floatingInput).toBeNull();
    expect(committed.command).toMatchObject({
      toolId: "dimensionDistance",
      phase: "collecting",
    });
    expect(activeCommand(committed)?.toolId).toBe("dimensionDistance");
    const escaped = apply(committed, { type: "sketch.escapeRequested" });
    expect(escaped.session.activeTool).toBeNull();
    expect(escaped.session.constraintAuthoring).toBeNull();
    expect(escaped.command).toMatchObject({ toolId: "sketch", phase: "editing" });
    expect(activeCommand(escaped)?.toolId).toBe("sketch");
  });

  test("T17j3 F-1: the Distance value commit leaves the pick unselected whether the placement press hit the canvas or the preview's dimension-line handle", async () => {
    const { state, h } = await makeAnnotationLifecycleState();
    let picked = apply(state, {
      type: "tool.activated",
      toolId: "dimensionDistance",
    });
    picked = apply(picked, { type: "viewport.selectionRequested", target: h });
    expect(picked.selection, "premise: the pick selects H").toContainEqual(h);

    // The canvas: the release pins the placement, then its blank click
    // clears the selection.
    let canvas = apply(picked, {
      type: "sketch.pointerReleased",
      point: [5, 8],
      sketchUnitsPerPixel: null,
      target: null,
    });
    canvas = apply(canvas, { type: "selection.cleared" });
    // The preview's dimension-line handle: a drag placement, no click.
    let handle = picked;
    for (const gesturePhase of ["start", "end"])
      handle = apply(handle, {
        type: "sketch.toolPatched",
        patch: {
          intent: "setConstraintAnnotationPlacement",
          point: [5, 8],
          gesturePhase,
        },
      });
    for (const placed of [canvas, handle])
      expect(
        placed.session.constraintAuthoring?.isPreviewPinned,
        "premise: the value input is open",
      ).toBe(true);
    expect(
      handle.selection,
      "premise: the handle path keeps H selected",
    ).toContainEqual(h);

    const commit = (placed: SketchEditorState) =>
      apply(placed, {
        type: "sketch.toolPatched",
        patch: { intent: "commitConstraintValue" },
      });
    const [fromCanvas, fromHandle] = [commit(canvas), commit(handle)];
    for (const committed of [fromCanvas, fromHandle])
      expect(
        committed.session.definition.dimensions,
        "premise: one dimension is committed",
      ).toHaveLength(1);
    const outcome = (committed: SketchEditorState) => ({
      selection: committed.selection,
      hoverTarget: committed.hoverTarget,
      annotationContext: committed.annotationContext,
      command: committed.command.toolId,
    });
    expect(outcome(fromHandle), "one outcome for both presses").toEqual(
      outcome(fromCanvas),
    );
    expect(outcome(fromCanvas)).toEqual({
      selection: [],
      hoverTarget: null,
      annotationContext: null,
      command: "dimensionDistance",
    });
    for (const committed of [fromCanvas, fromHandle]) {
      expect(committed.session.activeTool).toBe("dimensionDistance");
      expect(committed.session.status).toBe("collectingTargets");
      expect(committed.session.constraintAuthoring?.selectedTargets).toEqual([]);
      const escaped = apply(committed, { type: "sketch.escapeRequested" });
      expect(escaped.session.activeTool).toBeNull();
      expect(escaped.command.toolId).toBe("sketch");
    }
  });

  test("control: a refused duplicate restarts the tool, which stays armed", async () => {
    const { state, g } = await makeAnnotationLifecycleState();
    const armed = apply(state, {
      type: "tool.activated",
      toolId: "constraintHorizontal",
    });
    const refused = apply(armed, {
      type: "viewport.selectionRequested",
      target: g,
    });
    expect(refused.session.toolPresentation?.validation?.[0]?.message).toMatch(/^Already constrained/);
    expect(refused.session.activeTool).toBe("constraintHorizontal");
    expect(refused.command.toolId).toBe("constraintHorizontal");
  });
});
