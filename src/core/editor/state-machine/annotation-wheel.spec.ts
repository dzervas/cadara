import { describe, expect, test } from "vitest";

import type { PrimitiveRef } from "@/core/editor/schema";
import { getEscapeEvent } from "@/domain/editor/workbench-interactions";
import { makeAnnotationLifecycleState } from "@/domain/editor/annotation-lifecycle.fixtures";
import { REFERENCE_IMAGE_CALIBRATION_MODE_ID } from "@/core/reference-image-calibration/mode/shared";
import { transitionEditorState } from "./reducer-root";
import { getEditorViewState } from "./selectors";
import type { EditorEvent, EditorState, SketchEditorState } from "./types";

// Logic lane (editor transition seam `transitionEditorState`, plus
// `getEscapeEvent` over the view state): the T14g radial wheel lifecycle
// (issue 10 Answer and wheel comments, prototype `expandedCluster`; T14
// plan §2.3/§2.4, T-10). The wheel is `annotationContext.wheel` (editor UI
// state); its screen centre is the viewport's. Fixture (T14c): lines G, H,
// K; A Horizontal(G), B Fix(G start), C Parallel(G, H), D Horizontal(K).

function apply(state: EditorState, event: EditorEvent) {
  const next = transitionEditorState(state, event).state;
  expect(next.kind, `${event.type} stays in sketch editing`).toBe(
    "editingSketch",
  );
  return next as SketchEditorState;
}

const select = (state: EditorState, target: PrimitiveRef) =>
  apply(state, { type: "viewport.selectionRequested", target });
const blank = (state: EditorState) =>
  apply(state, { type: "selection.cleared" });
const escape = (state: SketchEditorState) => {
  const event = getEscapeEvent(getEditorViewState(state));
  expect(event, "Escape applies").not.toBe(null);
  return { event: event!, state: apply(state, event!) };
};
const contextOf = (state: SketchEditorState) => state.annotationContext ?? null;
const wheelOf = (state: SketchEditorState) =>
  state.annotationContext?.wheel ?? null;

async function openOnG() {
  const fixture = await makeAnnotationLifecycleState();
  const geometry = select(fixture.state, fixture.g);
  // A and B are G's dense cluster (both pinned by G, T-4).
  const members = [fixture.a, fixture.b];
  const open = apply(geometry, {
    type: "sketch.annotationWheelOpened",
    clusterKey: "annotation:cluster-g",
    members,
  });
  return { ...fixture, geometry, open, members };
}

describe("T14g radial wheel lifecycle (T-10)", () => {
  test("a pinned, idle `+N` opens the wheel: the context keeps its owners and `last`; nothing else changes", async () => {
    const { geometry, open, g, members } = await openOnG();
    expect(wheelOf(open)).toEqual({
      clusterKey: "annotation:cluster-g",
      members,
    });
    expect(contextOf(open)).toMatchObject({ owners: [g], last: null });
    expect(open.selection, "the selection is untouched").toEqual([g]);
    expect(open.session, "editor UI state only: same session").toBe(
      geometry.session,
    );
  });

  test("with Show all and nothing selected the wheel opens a context of its own, which the first blank removes", async () => {
    const { state, a, b } = await makeAnnotationLifecycleState();
    const shown = apply(state, {
      type: "sketch.showAllAnnotationsChanged",
      showAll: true,
    });
    expect(contextOf(shown), "premise: no context").toBe(null);
    const open = apply(shown, {
      type: "sketch.annotationWheelOpened",
      clusterKey: "k",
      members: [a, b],
    });
    expect(contextOf(open)).toEqual({
      owners: [],
      last: null,
      wheel: { clusterKey: "k", members: [a, b] },
    });
    expect(contextOf(blank(open))).toBe(null);
  });

  test("the wheel never opens outside the idle select context or without members", async () => {
    const { state, g, a } = await makeAnnotationLifecycleState();
    const armed = apply(select(state, g), {
      type: "tool.activated",
      toolId: "line",
    });
    expect(
      wheelOf(
        apply(armed, {
          type: "sketch.annotationWheelOpened",
          clusterKey: "k",
          members: [a],
        }),
      ),
      "a tool is armed",
    ).toBe(null);
    const idle = select(state, g);
    const empty = apply(idle, {
      type: "sketch.annotationWheelOpened",
      clusterKey: "k",
      members: [],
    });
    expect(empty, "no members: nothing happens").toBe(idle);
  });

  test("selecting a spoke makes it the active selection and `last` and keeps the wheel; another spoke swaps; a non-member closes it", async () => {
    const { open, g, a, b, c, members } = await openOnG();
    const first = select(open, a);
    expect(first.selection, "the spoke is the active selection").toEqual([a]);
    expect(contextOf(first)).toEqual({
      owners: [g],
      last: a,
      wheel: { clusterKey: "annotation:cluster-g", members },
    });

    const swapped = select(first, b);
    expect(swapped.selection, "choosing another spoke swaps").toEqual([b]);
    expect(contextOf(swapped)).toMatchObject({ owners: [g], last: b });
    expect(wheelOf(swapped), "the wheel stays open").not.toBe(null);

    const other = select(swapped, c);
    expect(other.selection).toEqual([c]);
    expect(
      contextOf(other),
      "C (pinned by G, not a spoke) closes the wheel",
    ).toEqual({ owners: [g], last: c });
  });

  test("the first blank collapses the wheel and keeps owners and `last`; a sibling is then selectable; the second blank clears", async () => {
    const { open, g, a, b } = await openOnG();
    const active = select(open, a);
    const firstBlank = blank(active);
    expect(firstBlank.selection).toEqual([]);
    expect(contextOf(firstBlank), "wheel collapsed, context kept").toEqual({
      owners: [g],
      last: a,
    });
    const sibling = select(firstBlank, b);
    expect(sibling.selection).toEqual([b]);
    expect(contextOf(sibling)).toEqual({ owners: [g], last: b });
    expect(contextOf(blank(blank(sibling)))).toBe(null);

    // With no active spoke the open wheel alone makes the blank first-stage
    // (contrast: without the wheel this blank clears everything).
    const geometryOnly = blank(open);
    expect(geometryOnly.selection).toEqual([]);
    expect(contextOf(geometryOnly)).toEqual({ owners: [g], last: null });
    const { geometry } = await openOnG();
    expect(contextOf(blank(geometry)), "contrast without a wheel").toBe(null);
  });

  test("Escape closes the wheel as its own stage, before the two context stages", async () => {
    const { open, g, a } = await openOnG();
    const active = select(open, a);

    const wheelStage = escape(active);
    expect(wheelStage.event).toEqual({ type: "sketch.annotationWheelClosed" });
    expect(wheelStage.state.selection, "the spoke stays selected").toEqual([a]);
    expect(contextOf(wheelStage.state)).toEqual({ owners: [g], last: a });

    const firstStage = escape(wheelStage.state);
    expect(firstStage.event).toEqual({ type: "selection.cleared" });
    expect(contextOf(firstStage.state)).toEqual({ owners: [g], last: a });
    const secondStage = escape(firstStage.state);
    expect(contextOf(secondStage.state)).toBe(null);
    expect(getEscapeEvent(getEditorViewState(secondStage.state))).toBe(null);
  });

  test("a close (`−N`, camera change, chooser, stale wheel) keeps the selection and context; closing a closed wheel is a no-op", async () => {
    const { open, g, a } = await openOnG();
    const active = select(open, a);
    expect(wheelOf(active), "premise: open").not.toBe(null);
    const closed = apply(active, { type: "sketch.annotationWheelClosed" });
    expect(wheelOf(closed)).toBe(null);
    expect(closed.selection).toEqual([a]);
    expect(contextOf(closed)).toEqual({ owners: [g], last: a });
    expect(
      apply(closed, { type: "sketch.annotationWheelClosed" }),
      "same state object",
    ).toBe(closed);
  });

  test("geometry inside the context keeps the wheel; geometry outside it closes the wheel", async () => {
    const { open, gStart, h } = await openOnG();
    const point = select(open, gStart);
    expect(
      wheelOf(point),
      "G's start point pins B (a spoke): the wheel stays",
    ).not.toBe(null);
    expect(contextOf(point)).toMatchObject({ owners: [gStart] });

    const outside = select(open, h);
    expect(contextOf(outside), "H pins neither A nor B: closed").toEqual({
      owners: [h],
      last: null,
    });
  });

  test("deleting a spoke shrinks the wheel; deleting the last spoke closes it", async () => {
    const { open, g, a, b } = await openOnG();
    const deleted = apply(select(open, a), {
      type: "sketch.annotationDeleteRequested",
    });
    expect(deleted.selection).toEqual([]);
    expect(contextOf(deleted), "A left the wheel and `last`").toEqual({
      owners: [g],
      last: null,
      wheel: { clusterKey: "annotation:cluster-g", members: [b] },
    });
    const empty = apply(select(deleted, b), {
      type: "sketch.annotationDeleteRequested",
    });
    expect(contextOf(empty), "no spoke left: the wheel is gone").toEqual({
      owners: [g],
      last: null,
    });
  });

  test("tool activation, a special mode and Finish close the wheel with the context", async () => {
    const { open, image } = await openOnG();
    expect(wheelOf(open), "premise: open").not.toBe(null);
    expect(
      contextOf(apply(open, { type: "tool.activated", toolId: "line" })),
    ).toBe(null);
    const special = apply(open, {
      type: "sketch.specialModeEntered",
      modeId: REFERENCE_IMAGE_CALIBRATION_MODE_ID,
      operationId: (image as { operationId: string }).operationId as never,
    });
    expect(
      special.session.activeSpecialMode?.modeId,
      "premise: the mode is entered",
    ).toBe(REFERENCE_IMAGE_CALIBRATION_MODE_ID);
    expect(contextOf(special)).toBe(null);
    const finish = transitionEditorState(open, {
      type: "tool.activated",
      toolId: "finishSketch",
    });
    expect(
      finish.effects.map((effect) => effect.type),
      "premise: Finish commits",
    ).toContain("sketch.commit");
    expect(contextOf(finish.state as SketchEditorState)).toBe(null);
  });

  test('"More…" filters the Constraints list to the members until it is reset or the wheel closes', async () => {
    const { open, members } = await openOnG();
    const filtered = apply(open, {
      type: "sketch.annotationWheelListFilterChanged",
      filtered: true,
    });
    expect(wheelOf(filtered)).toEqual({
      clusterKey: "annotation:cluster-g",
      members,
      listFiltered: true,
    });
    expect(
      apply(filtered, {
        type: "sketch.annotationWheelListFilterChanged",
        filtered: true,
      }),
    ).toBe(filtered);
    expect(
      wheelOf(
        apply(filtered, {
          type: "sketch.annotationWheelListFilterChanged",
          filtered: false,
        }),
      ),
    ).toEqual({ clusterKey: "annotation:cluster-g", members });
    expect(wheelOf(blank(filtered)), "the filter goes with the wheel").toBe(
      null,
    );
  });
});
