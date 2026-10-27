import { expect, it } from "vitest";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";
import { createNewSketchSessionFromSupport } from "@/domain/editor/sketch-session";
import { SPEC_SKETCH_UNITS_PER_PIXEL } from "@/domain/editor/sketch-session/test-snap-scale";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";

it("undo to empty with Rectangle armed removes the last fill and false unsolved warning", async () => {
  const f = await createSketchActionOwnerFixture(
    createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    ),
  );
  f.dispatch({ type: "tool.activated", toolId: "rectangle" });
  for (const point of [
    [10, 10],
    [30, 20],
    [40, 10],
    [60, 20],
  ] as const) {
    f.dispatch({
      type: "sketch.pointerReleased",
      sketchUnitsPerPixel: SPEC_SKETCH_UNITS_PER_PIXEL,
      point,
    });
    await f.settle();
  }
  expect(f.session.liveRegions.regions).toHaveLength(2);
  expect(f.session.activeTool).toBe("rectangle");
  f.dispatch({ type: "history.undoRequested" });
  await f.settle();
  expect(f.session.liveRegions.regions).toHaveLength(1);
  f.dispatch({ type: "history.undoRequested" });
  await f.settle();
  expect(f.session.definition.entities).toEqual([]);
  expect(f.session.activeTool).toBe("rectangle");
  expect(f.session.liveSolve!.solvedSnapshot.status.solveState).toBe(
    "notEvaluated",
  );
  expect(f.session.liveSolve!.accepted).toBe(false);
  expect(f.session.validationMessage).toBeNull();
  expect(f.session.liveRegions.status).toBe("current");
  expect(f.session.liveRegions.regions).toEqual([]);
});
