/**
 * T17f (D3; T17b0 P-6). Logic lane; seam: the authored-action owner
 * (`SketchAuthoredActions`) around the real reducer on an entered session
 * (`createSketchActionOwnerFixture`). A committed dimension-label move
 * ("Move Dimension Label") does not change the solve, so the live solve
 * stays the accepted solve of the moved definition: a Trim click queues its
 * query instead of the "needs a solved sketch" refusal (base), and the
 * near-gap basis stays present. A cancelled label gesture keeps it too.
 */
import { describe, expect, test } from "vitest";
import { createLiteralAuthoredValue } from "@/contracts/modeling/authored-values";
import type { EditorEvent } from "@/core/editor/state-machine";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  hasAcceptedLiveSolveOfDefinition,
  patchSketchDimensionAnnotationPlacement,
  startSketchDraw,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/core/editor/sketch-session/definition-authoring";
import { getSketchNearGapBasis } from "@/core/sketch-interaction/near-gap";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";

const draw = (
  session: SketchSessionState,
  start: [number, number],
  end: [number, number],
) =>
  acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), start),
    end,
  );

/** A horizontal line crossed by two verticals, with a placed length dimension. */
async function labelledLines() {
  const drawn = draw(
    draw(
      draw(
        enterSketchSession(
          createNewSketchSession(
            createStandardPlaneDefinition("xy"),
            OCC_KERNEL_SETTINGS,
          ),
        ),
        [0, 0],
        [4, 0],
      ),
      [1, -1],
      [1, 1],
    ),
    [3, -1],
    [3, 1],
  );
  const line = drawn.definition.entities[0]!;
  const definition = {
    ...drawn.definition,
    dimensionIds: [...drawn.definition.dimensionIds, "dimension_len"],
    dimensions: [
      ...drawn.definition.dimensions,
      {
        dimensionId: "dimension_len",
        kind: "lineLength",
        label: "Length",
        entityId: line.entityId,
        value: createLiteralAuthoredValue(4),
        annotationPlacement: { kind: "dimensionLine", offset: 1 },
      },
    ],
  } as SketchSessionState["definition"];
  const f = await createSketchActionOwnerFixture(
    rebuildSessionForDefinition(
      { ...drawn, activeTool: null, activeEditTool: null },
      { definition },
    ),
  );
  const frame = (gesturePhase: string, point: [number, number]) =>
    f.dispatch({
      type: "sketch.toolPatched",
      patch: {
        intent: "setDimensionAnnotationPlacement",
        dimensionId: "dimension_len",
        point,
        gesturePhase,
        clientPoint: [point[0] * 50, point[1] * 50],
      },
    } as EditorEvent);
  return { f, line, frame };
}

describe("T17f D3: a dimension-label move keeps the accepted live solve", () => {
  test("label move → Trim queues its query (no 'needs a solved sketch' refusal); near-gap basis kept", async () => {
    const { f, line, frame } = await labelledLines();
    expect(hasAcceptedLiveSolveOfDefinition(f.session), "premise").toBe(true);
    const solved = f.session.liveSolve!.solvedSnapshot;
    frame("start", [2, 1]);
    frame("move", [2, 2]);
    frame("end", [2, 3]);
    await f.settle();
    expect(f.undoLabels()).toEqual(["Move Dimension Label"]);
    expect(
      hasAcceptedLiveSolveOfDefinition(f.session),
      "the solve of the moved definition",
    ).toBe(true);
    expect(f.session.liveSolve!.solvedSnapshot, "not re-solved").toBe(solved);
    expect(getSketchNearGapBasis(f.session)).not.toBe(null);

    f.dispatch({ type: "tool.activated", toolId: "trim" });
    f.dispatch({ type: "viewport.selectionRequested", target: line.target });
    const query = f.session.activeEditTool?.editQuery;
    expect(f.session.validationMessage, "no refusal").toBe(null);
    expect(query?.queue, "the Trim click is queued").toHaveLength(1);
    expect(query?.inFlight, "its query is in flight").not.toBe(null);
  });

  // T17f review A-3: only a solve of the current definition is carried.
  test("a live solve of an older definition is not carried onto the moved one", async () => {
    const { f } = await labelledLines();
    const stale = {
      ...f.session,
      definition: structuredClone(f.session.definition),
    };
    expect(hasAcceptedLiveSolveOfDefinition(stale), "premise: stale").toBe(
      false,
    );
    const moved = patchSketchDimensionAnnotationPlacement(stale, {
      intent: "setDimensionAnnotationPlacement",
      dimensionId: "dimension_len",
      point: [2, 3],
    });
    expect(moved.definition, "premise: placed").not.toBe(stale.definition);
    expect(moved.liveSolve, "the old solve is left as it was").toBe(
      stale.liveSolve,
    );
    expect(hasAcceptedLiveSolveOfDefinition(moved)).toBe(false);
  });

  test("a cancelled label gesture keeps the accepted live solve", async () => {
    const { f, frame } = await labelledLines();
    frame("start", [2, 1]);
    frame("move", [2, 3]);
    frame("cancel", [2, 3]);
    expect(f.undoLabels(), "premise: nothing recorded").toEqual([]);
    expect(hasAcceptedLiveSolveOfDefinition(f.session)).toBe(true);
  });
});
