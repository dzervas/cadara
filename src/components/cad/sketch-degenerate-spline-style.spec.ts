/**
 * T17c3 (issue 08 :107). UI lane; seam: the sketch display style of the
 * renderable the session draws for a spline: once a fit point is dragged
 * onto its neighbour (a degenerate span), the spline's renderable is drawn
 * in the palette's danger red (the invalid tint), whatever its authored
 * stroke; before, it keeps the normal colour. The renderable comes from a
 * real entered session (T17-10′ builder) and the real drag owner.
 */
import { expect, test } from "vitest";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { getSketchDisplayPolylineMaterialConfig } from "@/components/cad/sketch-display-style";
import { enterSketchSession } from "@/core/editor/sketch-entry.fixtures";
import { pointRef } from "@/core/editor/sketch-mirror.fixtures";
import {
  acceptSketchDraw,
  beginSketchGeometryDrag,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  finishSketchGeometryDrag,
  startSketchDraw,
  updateSketchGeometryDrag,
  type SketchSessionState,
} from "@/core/editor/sketch-session";
import { getSketchSessionDisplayRenderables } from "@/infrastructure/editor/sketch-session/display";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";

const palette = {
  constrained: 0x222222,
  underconstrained: 0x1651b0,
  overconstrained: 0xff5555,
  regionFill: 0x343a40,
} as const;

const splineOf = (definition: SketchDefinition) =>
  definition.entities.find((entity) => entity.kind === "spline")!;
const strokeOf = (session: SketchSessionState) => {
  const renderable = getSketchSessionDisplayRenderables(session).find(
    (candidate) =>
      candidate.target?.kind === "sketchEntity" &&
      candidate.target.entityId === splineOf(session.definition).entityId,
  );
  if (!renderable) throw new Error("The spline is not drawn.");
  return getSketchDisplayPolylineMaterialConfig(
    { ...renderable, strokeStyle: { color: 0x33ffaa, opacity: 0.5 } },
    true,
    palette,
  );
};

test("T17c3: a spline whose fit point 3 was dragged onto fit point 2 is drawn in the invalid tint; the drawn spline is not", () => {
  let session = startSketchDraw(
    beginSketchTool(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      "spline",
    ),
    [0.5, 0.25],
  );
  for (const point of [
    [1, 1],
    [2, 1],
    [3, 0.125],
  ] as const)
    session = acceptSketchDraw(session, point);
  session = clearActiveSketchTool(finalizeSketchDraw(session));
  const control = strokeOf(session);
  expect(control.color, "control: the authored stroke").toBe(0x33ffaa);

  const spline = splineOf(session.definition);
  if (spline.kind !== "spline") throw new Error("spline");
  let dragged = beginSketchGeometryDrag(
    session,
    pointRef(session, spline.pointOccurrences[2]!.pointId),
    [2, 1],
  );
  for (const x of [1.75, 1.5, 1.25, 1])
    dragged = updateSketchGeometryDrag(dragged, [x, 1]);
  dragged = finishSketchGeometryDrag(dragged, [1, 1]);
  const [, second, thirdPosition] = spline.pointOccurrences.map(
    (occurrence) =>
      dragged.definition.points.find(
        (point) => point.pointId === occurrence.pointId,
      )!.position,
  );
  expect(thirdPosition, "premise: points 2 and 3 at the same place").toEqual(
    second,
  );
  const tinted = strokeOf(dragged);
  expect(tinted.color, "the invalid tint replaces the authored stroke").toBe(
    palette.overconstrained,
  );
});
