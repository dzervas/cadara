import { describe, expect, test } from "vitest";

import {
  getDefaultSelectionFilterForMode,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  setSketchInferenceSuppression,
  startSketchDraw,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { getSketchEditOperatorResult } from "@/core/editor/sketch-session/edit-geometry-operations";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/core/editor/sketch-session/test-snap-scale";
import type { ToolId } from "@/core/tools/tool-registry";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type { SketchEditorState } from "./types";

// Logic lane (core seam): cadara-h026.2, sketch tools activated on the
// preselection through the editor transition (`tool.activated` in the
// editing-sketch state, reducer-sketch.ts), and a tool's pick-cycle
// deselect entry (`viewport.selectionRequested` with `selectionMode:
// "remove"`).

const draw = (
  session: SketchSessionState,
  start: [number, number],
  end: [number, number],
) =>
  acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), start),
    end,
  );

type Segment = readonly [[number, number], [number, number]];

/** A skewed closed quadrilateral (no side horizontal, vertical, parallel or equal to another). */
const QUAD_CORNERS: [number, number][] = [
  [0, 0],
  [20, 2],
  [23, 17],
  [-1, 15],
];
const QUAD_SIDES: Segment[] = QUAD_CORNERS.map((corner, index) => [
  corner,
  QUAD_CORNERS[(index + 1) % 4]!,
]);

/**
 * `segments` drawn as separate lines, in the editing-sketch state with
 * nothing selected and no tool.
 */
async function makeLinesState(segments: readonly Segment[]) {
  let session = withSketchSnapScale(
    enterSketchSession(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    ),
    SPEC_SKETCH_UNITS_PER_PIXEL,
  );
  session = setSketchInferenceSuppression(session, { held: true });
  for (const [start, end] of segments) session = draw(session, start, end);
  session = { ...session, activeTool: null, status: "idle" };
  const lines = session.definition.entities.map(
    (entity): PrimitiveRef => entity.target,
  );
  const points = session.definition.points.map(
    (point): PrimitiveRef => point.target,
  );
  const state: SketchEditorState = {
    ...initialEditorState,
    kind: "editingSketch",
    mode: "sketch",
    selectionFilter: getDefaultSelectionFilterForMode("sketch"),
    snapshot: await createSeedDocumentSnapshot(),
    document: { documentId: "doc_workspace", revisionId: "rev_1" },
    command: {
      commandSessionId: "command_preselection",
      toolId: "sketch",
      phase: "editing",
    },
    session,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingRegionRequest: null,
  };
  return { state, lines, points };
}

/** The quadrilateral and a separate line far away. */
async function makeQuadState() {
  const { state, lines, points } = await makeLinesState([
    ...QUAD_SIDES,
    [
      [40, 30],
      [52, 37],
    ],
  ]);
  return { state, quad: lines.slice(0, 4), far: lines[4]!, points };
}

function activate(
  state: SketchEditorState,
  selection: readonly PrimitiveRef[],
  toolId: ToolId,
) {
  const result = transitionEditorState(
    { ...state, selection: [...selection] },
    { type: "tool.activated", toolId },
  );
  expect(result.state.kind).toBe("editingSketch");
  return result.state as SketchEditorState;
}

const editTargets = (state: SketchEditorState) =>
  state.session.activeEditTool?.selectedTargets ?? [];
const constraintTargets = (state: SketchEditorState) =>
  state.session.constraintAuthoring?.selectedTargets.map(
    (entry) => entry.target,
  ) ?? [];
const constraintsOfKind = (state: SketchEditorState, kind: string) =>
  state.session.definition.constraints.filter(
    (constraint) => constraint.kind === kind,
  );
const entityIdOf = (target: PrimitiveRef) =>
  target.kind === "sketchEntity" ? target.entityId : null;

describe("cadara-h026.2 Fillet/Chamfer adopt the preselected corners", () => {
  test("two adjacent lines: Chamfer previews at once, no re-pick", async () => {
    const { state, quad } = await makeQuadState();
    const chamfer = activate(state, [quad[0]!, quad[1]!], "sketchChamfer");
    expect(editTargets(chamfer)).toEqual([quad[0], quad[1]]);
    expect(chamfer.selection).toEqual([quad[0], quad[1]]);
    expect(
      chamfer.session.toolStagedEntities.some(
        (entity) => entity.id === "preview-chamfer-line",
      ),
      "The chamfer line previews from the preselection.",
    ).toBe(true);
    expect(chamfer.session.toolPresentation?.validation ?? []).toEqual([]);
  });

  test("a closed chain with its end points (a marquee): Fillet previews and rounds all 4 corners", async () => {
    const { state, quad, points } = await makeQuadState();
    // Marquee order: points and lines interleaved, not pick order.
    const fillet = activate(
      state,
      [...points.slice(0, 8), ...quad],
      "sketchFillet",
    );
    expect(
      editTargets(fillet),
      "Every chain line is adopted; the points are dropped.",
    ).toEqual(quad);
    expect(fillet.selection).toEqual(quad);
    const previewArcs = fillet.session.toolStagedEntities.filter((entity) =>
      entity.id.includes("preview-fillet-arc"),
    );
    expect(previewArcs, "One arc preview per corner.").toHaveLength(4);
    expect(new Set(previewArcs.map((entity) => entity.id)).size).toBe(4);

    const result = getSketchEditOperatorResult(
      fillet.session,
      fillet.session.activeEditTool!,
    );
    expect(result.valid, result.message ?? "").toBe(true);
    const arcs = result.definition!.entities.filter(
      (entity) => entity.kind === "arc",
    );
    expect(arcs, "Committing authors one fillet arc per corner.").toHaveLength(
      4,
    );
    expect(new Set(result.definition!.entityIds).size).toBe(
      result.definition!.entityIds.length,
    );
    expect(new Set(result.definition!.pointIds).size).toBe(
      result.definition!.pointIds.length,
    );

    const created = transitionEditorState(fillet, {
      type: "sketch.toolPatched",
      patch: { intent: "commitSketchEditOperator" },
    }).state as SketchEditorState;
    expect(
      created.session.definition.entities.filter(
        (entity) => entity.kind === "arc",
      ),
    ).toHaveLength(4);
    expect(created.session.sequence, "Create is one action.").toBe(
      state.session.sequence + 1,
    );
  });

  test("an open three-line chain rounds its 2 corners; a line without a corner is held but rounds nothing", async () => {
    const { state, quad, far } = await makeQuadState();
    const chamfer = activate(
      state,
      [quad[0]!, far, quad[1]!, quad[2]!],
      "sketchChamfer",
    );
    expect(editTargets(chamfer)).toEqual([quad[0], far, quad[1], quad[2]]);
    expect(
      chamfer.session.toolStagedEntities.filter((entity) =>
        entity.id.includes("preview-chamfer-line"),
      ),
    ).toHaveLength(2);
  });

  test("a side cut in two (a straight joint) is no corner: the other 4 corners are rounded", async () => {
    const [a, b] = QUAD_CORNERS;
    const middle: [number, number] = [(a![0] + b![0]) / 2, (a![1] + b![1]) / 2];
    const { state, lines } = await makeLinesState([
      [a!, middle],
      [middle, b!],
      ...QUAD_SIDES.slice(1),
    ]);
    const fillet = activate(state, lines, "sketchFillet");
    expect(editTargets(fillet)).toEqual(lines);
    const result = getSketchEditOperatorResult(
      fillet.session,
      fillet.session.activeEditTool!,
    );
    expect(result.valid, result.message ?? "").toBe(true);
    expect(
      result.definition!.entities.filter((entity) => entity.kind === "arc"),
    ).toHaveLength(4);
  });

  test("a three-line junction stays no corner when its stub has no corner of its own", async () => {
    const { state, lines } = await makeLinesState([
      ...QUAD_SIDES,
      [QUAD_CORNERS[1]!, [30, -5]],
    ]);
    const fillet = activate(state, lines, "sketchFillet");
    expect(editTargets(fillet), "The stub stays adopted.").toEqual(lines);
    const result = getSketchEditOperatorResult(
      fillet.session,
      fillet.session.activeEditTool!,
    );
    expect(result.valid, result.message ?? "").toBe(true);
    expect(
      result.definition!.entities.filter((entity) => entity.kind === "arc"),
      "The junction of sides 0, 1 and the stub is skipped.",
    ).toHaveLength(3);
  });

  test("a pick after an adopted superset keeps only the last adopted line with it", async () => {
    const { state, quad, far } = await makeQuadState();
    const fillet = activate(state, quad, "sketchFillet");
    const picked = transitionEditorState(fillet, {
      type: "viewport.selectionRequested",
      target: far,
    }).state as SketchEditorState;
    expect(editTargets(picked)).toEqual([quad[3], far]);
  });

  test("a preselection without a corner is cleared at activation", async () => {
    const { state, quad, far, points } = await makeQuadState();
    for (const selection of [
      [quad[0]!, quad[2]!],
      [quad[0]!, far],
      points.slice(0, 2),
    ]) {
      const fillet = activate(state, selection, "sketchFillet");
      expect(editTargets(fillet)).toEqual([]);
      expect(fillet.selection).toEqual([]);
      expect(fillet.session.toolStagedEntities).toEqual([]);
    }
  });
});

describe("cadara-h026.2 constraint and Dimension tools act on the preselection", () => {
  test("two lines, then Parallel: the constraint is applied and the tool disarms", async () => {
    const { state, quad } = await makeQuadState();
    const parallel = activate(
      state,
      [quad[0]!, quad[2]!],
      "constraintParallel",
    );
    const authored = constraintsOfKind(parallel, "parallel");
    expect(authored).toHaveLength(1);
    expect(parallel.session.activeTool).toBeNull();
    expect(parallel.command.toolId, "The toolbar shows Select.").toBe("sketch");
    expect(parallel.selection).toEqual([]);
  });

  test("N lines, then Horizontal: each line is constrained, in one commit", async () => {
    const { state, quad } = await makeQuadState();
    const horizontal = activate(
      state,
      quad.slice(0, 3),
      "constraintHorizontal",
    );
    const authored = constraintsOfKind(horizontal, "horizontal");
    expect(
      authored.map((constraint) =>
        "entityId" in constraint ? constraint.entityId : null,
      ),
    ).toEqual(quad.slice(0, 3).map(entityIdOf));
    expect(new Set(authored.map((c) => c.constraintId)).size).toBe(3);
    expect(horizontal.session.sequence, "One action.").toBe(
      state.session.sequence + 1,
    );
  });

  test("N lines, then Equal: they are chained in selection order", async () => {
    const { state, quad } = await makeQuadState();
    const equal = activate(state, quad.slice(0, 3), "constraintEqual");
    const authored = constraintsOfKind(equal, "equalLength");
    expect(
      authored.map((constraint) =>
        "entityIds" in constraint ? constraint.entityIds : null,
      ),
    ).toEqual([
      [entityIdOf(quad[0]!), entityIdOf(quad[1]!)],
      [entityIdOf(quad[1]!), entityIdOf(quad[2]!)],
    ]);
  });

  test("a partial set arms the tool with its picks; points Horizontal cannot take are dropped", async () => {
    const { state, quad, points } = await makeQuadState();
    const parallel = activate(state, [quad[0]!], "constraintParallel");
    expect(constraintTargets(parallel)).toEqual([quad[0]]);
    expect(parallel.selection).toEqual([quad[0]]);
    expect(parallel.command.toolId).toBe("constraintParallel");
    expect(constraintsOfKind(parallel, "parallel")).toEqual([]);

    const horizontal = activate(
      state,
      [points[0]!, quad[0]!, points[1]!],
      "constraintHorizontal",
    );
    expect(constraintsOfKind(horizontal, "horizontal")).toHaveLength(1);
  });

  test("an incompatible preselection is cleared and the tool armed empty", async () => {
    const { state, points } = await makeQuadState();
    const horizontal = activate(state, points.slice(0, 2), "constraintEqual");
    expect(horizontal.selection).toEqual([]);
    expect(constraintTargets(horizontal)).toEqual([]);
    expect(horizontal.session.activeTool).toBe("constraintEqual");
  });

  test("another tool's pick is no preselection: switching to Horizontal commits nothing", async () => {
    const { state, quad } = await makeQuadState();
    const chamfer = transitionEditorState(
      activate(state, [], "sketchChamfer"),
      {
        type: "viewport.selectionRequested",
        target: quad[0]!,
      },
    ).state as SketchEditorState;
    expect(chamfer.selection).toEqual([quad[0]]);
    const horizontal = transitionEditorState(chamfer, {
      type: "tool.activated",
      toolId: "constraintHorizontal",
    }).state as SketchEditorState;
    expect(constraintsOfKind(horizontal, "horizontal")).toEqual([]);
    expect(constraintTargets(horizontal)).toEqual([]);
    expect(horizontal.selection, "The old tool's pick is cleared.").toEqual([]);
    expect(horizontal.session.activeTool).toBe("constraintHorizontal");
  });

  test("Dimension adopts two points and awaits the value", async () => {
    const { state, points } = await makeQuadState();
    const dimension = activate(state, points.slice(0, 2), "dimension");
    expect(constraintTargets(dimension)).toEqual(points.slice(0, 2));
    expect(dimension.selection).toEqual(points.slice(0, 2));
    expect(dimension.session.status).toBe("awaitingValue");
    expect(dimension.command.toolId).toBe("dimension");
  });
});

describe("cadara-h026.2 a tool cycle's deselect entry removes only its own pick", () => {
  const remove = (state: SketchEditorState, target: PrimitiveRef) =>
    transitionEditorState(state, {
      type: "viewport.selectionRequested",
      target,
      selectionMode: "remove",
    }).state as SketchEditorState;
  const pick = (state: SketchEditorState, target: PrimitiveRef) =>
    transitionEditorState(state, {
      type: "viewport.selectionRequested",
      target,
    }).state as SketchEditorState;

  test("Chamfer: the last-added line is removed and the preview re-stages; an earlier pick is not", async () => {
    const { state, quad } = await makeQuadState();
    const both = pick(
      pick(activate(state, [], "sketchChamfer"), quad[0]!),
      quad[1]!,
    );
    expect(editTargets(both)).toEqual([quad[0], quad[1]]);
    expect(remove(both, quad[0]!), "Not the cycle's own pick.").toBe(both);
    const removed = remove(both, quad[1]!);
    expect(editTargets(removed)).toEqual([quad[0]]);
    expect(removed.session.toolStagedEntities).toEqual([]);
    expect(removed.selection).not.toContainEqual(quad[1]);
  });

  test("Dimension: its pick is removed and the tool stays armed", async () => {
    const { state, quad } = await makeQuadState();
    const picked = pick(activate(state, [], "dimension"), quad[0]!);
    expect(constraintTargets(picked)).toEqual([quad[0]]);
    expect(remove(picked, quad[1]!), "Not a pick of the tool.").toBe(picked);
    const removed = remove(picked, quad[0]!);
    expect(constraintTargets(removed)).toEqual([]);
    expect(removed.session.status).toBe("collectingTargets");
    expect(removed.session.activeTool).toBe("dimensionDistance");
  });
});
