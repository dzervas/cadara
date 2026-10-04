import { describe, expect, test } from "vitest";

import {
  getDefaultSelectionFilterForMode,
  type PrimitiveRef,
} from "@/core/editor/schema";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  startSketchDraw,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import {
  getSketchSelectionCycleContext,
  isSketchSelectionCyclePickRetained,
  isSketchSelectionCycleTargetEligible,
} from "@/domain/editor/sketch-session/selection";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSeedDocumentSnapshot } from "@/domain/modeling/modeling-test-fixtures";
import { transitionEditorState } from "./reducer-root";
import { initialEditorState } from "./state-creators";
import type { SketchAuthoringToolId } from "@/domain/editor/sketch-session";
import type { SketchEditorState } from "./types";

// Logic lane (core seam): a repeated-click cycle selection
// (`viewport.selectionRequested` with `cycleReplaces`, T11d) through the
// editor transition, per selection context (review R-2), and the one
// per-context table in `sketch-session/selection.ts`.

const draw = (
  session: SketchSessionState,
  start: [number, number],
  end: [number, number],
) =>
  acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), start),
    end,
  );

/**
 * A line on the X axis over a coincident construction line (entity 1) and
 * a separate line (entity 3) elsewhere, in the editing-sketch state with the
 * sketch selection filter.
 */
async function makeOverlapState(toolId: SketchAuthoringToolId | null = null) {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = draw(session, [-4, 0], [4, 0]);
  session = draw(session, [-4, 0.001], [4, 0.001]);
  session = draw(session, [-4, 3], [4, 3]);
  const [constructionEntity, lineEntity, otherEntity] =
    session.definition.entities;
  session = {
    ...session,
    definition: {
      ...session.definition,
      entities: session.definition.entities.map((entity) =>
        entity === constructionEntity
          ? { ...entity, isConstruction: true }
          : entity,
      ),
    },
  };
  session = toolId
    ? beginSketchTool(session, toolId)
    : { ...session, activeTool: null, status: "idle" };
  const ref = (entityId: string): PrimitiveRef => ({
    kind: "sketchEntity",
    sketchId: session.actionContextId,
    entityId: entityId as never,
  });
  const state: SketchEditorState = {
    ...initialEditorState,
    kind: "editingSketch",
    mode: "sketch",
    selectionFilter: getDefaultSelectionFilterForMode("sketch"),
    snapshot: await createSeedDocumentSnapshot(),
    document: { documentId: "doc_workspace", revisionId: "rev_1" },
    command: {
      commandSessionId: "command_cycle",
      toolId: "sketch",
      phase: "editing",
    },
    session,
    pendingCommitRequestId: null,
    pendingImportRequestId: null,
    pendingProjectionRequestId: null,
    pendingRegionRequest: null,
  };
  return {
    state,
    line: ref(lineEntity!.entityId),
    construction: ref(constructionEntity!.entityId),
    other: ref(otherEntity!.entityId),
    xAxis: {
      kind: "sketchDatumReference",
      sketchId: session.actionContextId,
      datumId: "xAxis",
      geometryKind: "line",
    } as PrimitiveRef,
  };
}

function select(
  state: SketchEditorState,
  target: PrimitiveRef,
  cycleReplaces?: PrimitiveRef,
) {
  const result = transitionEditorState(state, {
    type: "viewport.selectionRequested",
    target,
    ...(cycleReplaces ? { cycleReplaces } : {}),
  });
  const next = result.state as SketchEditorState;
  expect(next.kind).toBe("editingSketch");
  return next;
}

const offsetTargets = (state: SketchEditorState) =>
  state.session.activeEditTool?.selectedTargets ?? [];
const constraintTargets = (state: SketchEditorState) =>
  state.session.constraintAuthoring?.selectedTargets.map(
    (entry) => entry.target,
  ) ?? [];

describe("T11d per-context cycle table", () => {
  test("each context gets its mode: replace, replace-last-added or none", async () => {
    const mode = async (toolId: SketchAuthoringToolId | null) => {
      const { state } = await makeOverlapState(toolId);
      return getSketchSelectionCycleContext(
        state.session,
        state.selectionFilter,
      ).mode;
    };
    expect(await mode(null), "No tool: replace.").toBe("replace");
    expect(await mode("projectReference"), "Reference picker: replace.").toBe(
      "replace",
    );
    for (const toolId of [
      "offset",
      "sketchFillet",
      "sketchChamfer",
      "sketchSlot",
      "sketchLinearPattern",
      "sketchCircularPattern",
      "sketchTransform",
      "construction",
      "dimensionDistance",
    ] as const) {
      expect(await mode(toolId), `${toolId}: replace-last-added.`).toBe(
        "replaceLastAdded",
      );
    }
    for (const toolId of [
      "trim",
      "sketchExtend",
      "sketchSplit",
      "sketchMirror",
      "constraintHorizontal",
      "constraintCoincident",
      "line",
      "circle",
    ] as const) {
      expect(
        await mode(toolId),
        `${toolId}: immediate action or drawing, no cycle.`,
      ).toBe("none");
    }
  });

  test("a valued constraint whose next click pins its preview stops cycling", async () => {
    const { state, line, other } = await makeOverlapState("dimensionDistance");
    const first = select(state, line);
    expect(
      getSketchSelectionCycleContext(first.session, first.selectionFilter).mode,
      "One line: ready for a length but still takes a second target.",
    ).toBe("replaceLastAdded");
    const full = select(first, other);
    expect(constraintTargets(full)).toEqual([line, other]);
    expect(
      getSketchSelectionCycleContext(full.session, full.selectionFilter).mode,
      "Two lines: the next click pins the preview.",
    ).toBe("none");
  });

  test("contexts are keyed by their tool: a cycle never spans two contexts", async () => {
    const key = async (toolId: SketchAuthoringToolId | null) => {
      const { state } = await makeOverlapState(toolId);
      return getSketchSelectionCycleContext(
        state.session,
        state.selectionFilter,
      ).key;
    };
    const keys = await Promise.all(
      ([null, "offset", "sketchFillet", "projectReference"] as const).map(key),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("eligibility in replace-last-added contexts follows what the tool takes", async () => {
    const { state, line, xAxis } = await makeOverlapState("offset");
    expect(isSketchSelectionCycleTargetEligible(state.session, line)).toBe(
      true,
    );
    expect(
      isSketchSelectionCycleTargetEligible(state.session, xAxis),
      "Offset takes no datum axis.",
    ).toBe(false);
    const noTool = await makeOverlapState(null);
    expect(
      isSketchSelectionCycleTargetEligible(noTool.state.session, xAxis),
    ).toBe(true);
  });
});

describe("T11d cycle selection through the editor transition", () => {
  test("replace (no tool): the cycle pick replaces the previous one", async () => {
    const { state, line, construction, xAxis } = await makeOverlapState();
    const first = select(state, line);
    expect(first.selection).toEqual([line]);
    expect(
      isSketchSelectionCyclePickRetained(first, line),
      "The selection holds the first pick.",
    ).toBe(true);
    const second = select(first, construction, line);
    expect(second.selection).toEqual([construction]);
    const third = select(second, xAxis, construction);
    expect(third.selection).toEqual([xAxis]);
    expect(
      isSketchSelectionCyclePickRetained({ ...third, selection: [] }, xAxis),
      "A cleared selection (Escape, Undo, elsewhere) no longer holds it.",
    ).toBe(false);
  });

  test("Offset targets: one replace-last-added event, never a second toggle or append", async () => {
    const { state, line, construction, other } =
      await makeOverlapState("offset");
    const first = select(state, line);
    expect(offsetTargets(first)).toEqual([line]);
    const cycled = select(first, construction, line);
    expect(
      offsetTargets(cycled),
      "The construction line replaced the line (no append).",
    ).toEqual([construction]);
    const back = select(cycled, line, construction);
    expect(
      offsetTargets(back),
      "Cycling back replaces again (no toggle-off).",
    ).toEqual([line]);

    // An accumulated chain keeps its earlier targets.
    const chain = select(select(state, other), line);
    expect(offsetTargets(chain)).toEqual([other, line]);
    expect(offsetTargets(select(chain, construction, line))).toEqual([
      other,
      construction,
    ]);
  });

  test("review R-1: Offset, a lone target clicked twice is toggled off (no cycle event on a 1-entry stack)", async () => {
    const { state, other } = await makeOverlapState("offset");
    // The viewport never arms a cycle on a 1-entry stack, so the second
    // click is an ordinary one (`getArmedSketchPickCycleIndex` row).
    const first = select(state, other);
    expect(offsetTargets(first)).toEqual([other]);
    expect(
      offsetTargets(select(first, other)),
      "The ordinary toggle stands: 0 targets.",
    ).toEqual([]);
  });

  test("Offset: no cycle when the last-added target came from another click", async () => {
    const { state, line, construction, other } =
      await makeOverlapState("offset");
    const chain = select(select(state, line), other);
    const result = transitionEditorState(chain, {
      type: "viewport.selectionRequested",
      target: construction,
      cycleReplaces: line,
    });
    expect(
      result.state,
      "The last-added target is `other`, not the previous pick: unchanged.",
    ).toBe(chain);
  });

  test("Offset: a cycle target the tool rejects or toggles changes nothing", async () => {
    const { state, line, construction, xAxis } =
      await makeOverlapState("offset");
    const first = select(state, line);
    expect(
      transitionEditorState(first, {
        type: "viewport.selectionRequested",
        target: xAxis,
        cycleReplaces: line,
      }).state,
      "Offset ignores the axis: the line is not dropped.",
    ).toBe(first);

    const both = select(select(state, construction), line);
    expect(
      transitionEditorState(both, {
        type: "viewport.selectionRequested",
        target: construction,
        cycleReplaces: line,
      }).state,
      "The construction line is already a target: no toggle-off.",
    ).toBe(both);
  });

  test("constraint authoring: the cycle replaces the last resolved target", async () => {
    const { state, line, construction } =
      await makeOverlapState("dimensionDistance");
    const first = select(state, line);
    expect(constraintTargets(first)).toEqual([line]);
    const cycled = select(first, construction, line);
    expect(
      constraintTargets(cycled),
      "One target, the construction line (no second target appended).",
    ).toEqual([construction]);
  });

  test("an immediate-action context (Trim) never takes a cycle event", async () => {
    const { state, line, construction } = await makeOverlapState("trim");
    const result = transitionEditorState(state, {
      type: "viewport.selectionRequested",
      target: construction,
      cycleReplaces: line,
    }).state as SketchEditorState;
    expect(result.session, "Trim queued nothing.").toBe(state.session);
    expect(result.selection).toBe(state.selection);
  });
});
