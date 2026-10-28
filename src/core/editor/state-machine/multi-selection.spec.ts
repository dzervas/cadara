import { describe, expect, test } from "vitest";

import {
  getDefaultSelectionFilterForMode,
  getPrimitiveRefKey,
  primitiveRefEquals,
  type PrimitiveRef,
} from "@/core/editor/schema";
import type { FaceId, BodyId, EdgeId } from "@/contracts/shared/ids";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  startSketchDraw,
  type SketchAuthoringToolId,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/application/modeling/modeling-test-fixtures";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";
import { transitionEditorState } from "./reducer-root";
import { createShellRowSelectRequest } from "./selection-helpers";
import { initialEditorState } from "./state-creators";
import type {
  EditorEvent,
  EditorState,
  SelectionRequestMode,
  SketchEditorState,
} from "./types";

// Logic lane (core seam): the multi-selection contract (cadara-h026.1)
// through the editor transition: `viewport.selectionRequested` with its
// `selectionMode` and in-place `cycleReplaces`, `selection.targetsRequested`
// and `selection.cleared`, in the idle part selection and the no-tool sketch
// selection; other contexts keep their own rules.

const bodyId = "body_a" as BodyId;
const face = (id: string): PrimitiveRef => ({
  kind: "face",
  bodyId,
  faceId: id as FaceId,
});
const edge = (id: string): PrimitiveRef => ({
  kind: "edge",
  bodyId,
  edgeId: id as EdgeId,
});
const [f1, f2, f3] = [face("f1"), face("f2"), face("f3")];
const e1 = edge("e1");

function send<TState extends EditorState>(state: TState, event: EditorEvent) {
  return transitionEditorState(state, event).state as TState;
}

function pick<TState extends EditorState>(
  state: TState,
  target: PrimitiveRef,
  selectionMode?: SelectionRequestMode,
  cycleReplaces?: PrimitiveRef,
) {
  return send(state, {
    type: "viewport.selectionRequested",
    target,
    ...(selectionMode ? { selectionMode } : {}),
    ...(cycleReplaces ? { cycleReplaces } : {}),
  });
}

describe("idle part selection", () => {
  const idle: EditorState = initialEditorState;

  test("toggling clicks accumulate in pick order; a selected target clicked again is removed", () => {
    const three = pick(
      pick(pick(idle, f1, "toggle"), f2, "toggle"),
      f3,
      "toggle",
    );
    expect(three.selection).toEqual([f1, f2, f3]);
    expect(pick(three, f2, "toggle").selection).toEqual([f1, f3]);
    expect(
      pick(pick(three, f2, "toggle"), f2, "toggle").selection,
      "Re-added at the end: the order is the pick order.",
    ).toEqual([f1, f3, f2]);
  });

  test("replace, and an event without a mode, select the target alone", () => {
    const two = pick(pick(idle, f1, "toggle"), f2, "toggle");
    expect(pick(two, f3, "replace").selection).toEqual([f3]);
    expect(pick(two, f3).selection, "Sidebar rows send no mode.").toEqual([f3]);
  });

  test("a cycle pick replaces its own previous pick in place and keeps the rest", () => {
    const two = pick(pick(idle, f1, "toggle"), e1, "toggle");
    expect(pick(two, f2, "toggle", e1).selection).toEqual([f1, f2]);
    expect(
      pick(two, f1, "toggle", e1).selection,
      "The next entry is already selected: only the own pick goes.",
    ).toEqual([f1]);
    expect(
      pick(pick(two, f2, "toggle", e1), f2, "remove").selection,
      "The deselect entry removes the own pick only.",
    ).toEqual([f1]);
  });

  test("several targets: replace makes them the selection, add appends the new ones", () => {
    const one = pick(idle, f2, "toggle");
    expect(
      send(one, {
        type: "selection.targetsRequested",
        targets: [f1, f2, f3],
        mode: "add",
      }).selection,
    ).toEqual([f2, f1, f3]);
    expect(
      send(one, {
        type: "selection.targetsRequested",
        targets: [f3, f1, f3],
        mode: "replace",
      }).selection,
    ).toEqual([f3, f1]);
  });

  test("selection.cleared (Escape, an empty click) clears every target", () => {
    const two = pick(pick(idle, f1, "toggle"), f2, "toggle");
    expect(send(two, { type: "selection.cleared" }).selection).toEqual([]);
  });
});

const draw = (
  session: SketchSessionState,
  start: [number, number],
  end: [number, number],
) =>
  acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), start),
    end,
  );

/** Three separate lines in the editing-sketch state. */
async function makeSketchState(toolId: SketchAuthoringToolId | null = null) {
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  session = draw(session, [-4, 0], [4, 0]);
  session = draw(session, [-4, 3], [4, 3]);
  session = draw(session, [-4, 6], [4, 6]);
  const lines = session.definition.entities.map(
    (entity): PrimitiveRef => ({
      kind: "sketchEntity",
      sketchId: session.actionContextId,
      entityId: entity.entityId,
    }),
  );
  session = toolId
    ? beginSketchTool(session, toolId)
    : { ...session, activeTool: null, status: "idle" };
  const state: SketchEditorState = {
    ...initialEditorState,
    kind: "editingSketch",
    mode: "sketch",
    selectionFilter: getDefaultSelectionFilterForMode("sketch"),
    snapshot: await createSeedDocumentSnapshot(),
    document: { documentId: "doc_workspace", revisionId: "rev_1" },
    command: {
      commandSessionId: "command_multi",
      toolId: "sketch",
      phase: "editing",
    },
    session,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingRegionRequest: null,
  };
  const point: PrimitiveRef = session.definition.points[0]!.target;
  return {
    state,
    lines: lines as [PrimitiveRef, PrimitiveRef, PrimitiveRef],
    point,
  };
}

describe("no-tool sketch selection", () => {
  test("lines and points accumulate in pick order and are the annotation owners", async () => {
    const {
      state,
      lines: [a, b],
      point,
    } = await makeSketchState();
    const selected = pick(
      pick(pick(state, a, "toggle"), point, "toggle"),
      b,
      "toggle",
    );
    expect(selected.selection).toEqual([a, point, b]);
    expect(selected.annotationContext?.owners).toEqual([a, point, b]);
    expect(
      selected.session.activeEditTarget,
      "An added point is the edit target, as a plain point click makes it.",
    ).toEqual(point);
    const dropped = pick(selected, a, "toggle");
    expect(dropped.selection).toEqual([point, b]);
    expect(dropped.annotationContext?.owners).toEqual([point, b]);
  });

  test("a cycle pick replaces only its own pick; the deselect entry removes it", async () => {
    const {
      state,
      lines: [a, b, c],
    } = await makeSketchState();
    const two = pick(pick(state, a, "toggle"), b, "toggle");
    const cycled = pick(two, c, "toggle", b);
    expect(cycled.selection).toEqual([a, c]);
    expect(pick(cycled, c, "remove").selection).toEqual([a]);
  });

  test("a marquee adds or replaces; Escape's selection.cleared clears", async () => {
    const {
      state,
      lines: [a, b, c],
      point,
    } = await makeSketchState();
    const one = pick(state, a, "toggle");
    const boxed = send(one, {
      type: "selection.targetsRequested",
      targets: [point, b, c],
      mode: "add",
    });
    expect(boxed.selection).toEqual([a, point, b, c]);
    expect(boxed.annotationContext?.owners).toEqual([a, point, b, c]);
    expect(
      send(one, {
        type: "selection.targetsRequested",
        targets: [c],
        mode: "replace",
      }).selection,
    ).toEqual([c]);
    expect(send(boxed, { type: "selection.cleared" }).selection).toEqual([]);
  });

  test("a tool keeps its own rules: Offset ignores the mode; a remove drops only its last-added pick (cadara-h026.2)", async () => {
    const {
      state,
      lines: [a, b],
    } = await makeSketchState("offset");
    const picked = pick(pick(state, a, "toggle"), b, "toggle");
    expect(
      picked.session.activeEditTool?.selectedTargets,
      "Offset accumulates its own targets.",
    ).toEqual([a, b]);
    expect(
      picked.selection,
      "The viewport selection is the last pick.",
    ).toEqual([b]);
    expect(
      pick(picked, a, "remove"),
      "A tool's remove (its cycle's deselect entry) never drops an earlier pick.",
    ).toBe(picked);
    expect(
      pick(picked, b, "remove").session.activeEditTool?.selectedTargets,
      "It drops the last-added pick.",
    ).toEqual([a]);
  });
});

describe("parts-tree row clicks (list conventions)", () => {
  const rows = [f1, f2, f3, e1];
  const request = (
    target: PrimitiveRef,
    anchor: PrimitiveRef | null,
    keys: Partial<{ shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }>,
  ) =>
    createShellRowSelectRequest({
      rows,
      anchorKey: anchor ? getPrimitiveRefKey(anchor) : null,
      target,
      modifiers: { shiftKey: false, ctrlKey: false, metaKey: false, ...keys },
      isSelectable: (row) => !primitiveRefEquals(row, f3),
    });

  test("click replaces, Ctrl/Cmd toggles, Shift selects the selectable range from the anchor, Ctrl+Shift adds it", () => {
    expect(request(f2, f1, {})).toBeUndefined();
    expect(request(f2, f1, { ctrlKey: true })).toEqual({ mode: "toggle" });
    expect(request(f2, f1, { metaKey: true })).toEqual({ mode: "toggle" });
    expect(request(e1, f1, { shiftKey: true }), "f3 is not selectable").toEqual(
      { range: [f1, f2, e1] },
    );
    expect(
      request(f1, e1, { shiftKey: true }),
      "Upwards: anchor first",
    ).toEqual({ range: [e1, f2, f1] });
    expect(request(e1, f1, { shiftKey: true, ctrlKey: true })).toEqual({
      range: [f1, f2, e1],
      mode: "toggle",
    });
    expect(
      request(e1, null, { shiftKey: true }),
      "No anchor: a plain click",
    ).toBeUndefined();
  });

  test("through the editor: a range replaces, a Ctrl range adds", () => {
    const one = pick(initialEditorState, e1, "toggle");
    expect(
      send(one, {
        type: "selection.targetsRequested",
        targets: [f1, f2],
        mode: "replace",
      }).selection,
    ).toEqual([f1, f2]);
    expect(
      send(one, {
        type: "selection.targetsRequested",
        targets: [f1, f2],
        mode: "add",
      }).selection,
    ).toEqual([e1, f1, f2]);
  });
});

test("no-tool sketch: dragging a point adds it to the multi-selection instead of replacing it", async () => {
  const {
    state,
    lines: [a],
    point,
  } = await makeSketchState();
  const selected = pick(state, a, "toggle");
  const dragged = send(selected, {
    type: "sketch.geometryDragStarted",
    target: point,
    point: [0, 0],
  });
  expect(dragged.selection).toEqual([a, point]);
});
