import { expect, test } from "vitest";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";
import { createNewSketchSessionFromSupport } from "@/domain/editor/sketch-session";
import { resolveSketchDragTarget } from "@/domain/editor/workbench-interactions";
import { OCC_KERNEL_SETTINGS } from "@/core/modeling/opencascade-kernel-seed";

// O4: the direct point-drag path already resized correctly. The viewport's
// pick-to-drag resolver instead preferred a selected side over its vertex.
// Exercise that boundary before sending the real drag events through the owner.
test.each([0.005, 0.02])(
  "a selected rectangle side does not steal a corner drag at %s units/px",
  async (scale) => {
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
    ] as const) {
      f.dispatch({
        type: "sketch.pointerReleased",
        point,
        sketchUnitsPerPixel: scale,
      });
      await f.settle();
    }
    f.dispatch({ type: "sketch.activeToolCleared" });
    const before = f.session.definition;
    const corner = before.points.find(
      (p) => p.position[0] === 30 && p.position[1] === 20,
    )!;
    const opposite = before.points.find(
      (p) => p.position[0] === 10 && p.position[1] === 10,
    )!;
    expect(before.entities).toHaveLength(4);
    expect(before.dimensions).toEqual([]);
    expect(before.constraints.map((c) => c.kind).sort()).toEqual([
      "horizontal",
      "horizontal",
      "vertical",
      "vertical",
    ]);
    const target = corner.target;
    const side = before.entities.find(
      (e) => e.kind === "lineSegment" && e.endPointId === corner.pointId,
    )!;
    f.dispatch({ type: "viewport.selectionRequested", target: side.target });
    const acceptance = f.session.liveSolve!.solvedSnapshot;
    // A corner press has the authored point first, then the incident curves,
    // as resolveSketchPickStack orders them in the viewport.
    const stack = [{ target }, { target: side.target }];
    const picked = resolveSketchDragTarget(
      stack,
      f.state.selection,
      before,
      acceptance,
    )!;
    // Body-only grabs and explicit multi-selection keep their old precedence.
    expect(
      resolveSketchDragTarget(
        [{ target: side.target }],
        f.state.selection,
        before,
        acceptance,
      ),
    ).toEqual(side.target);
    expect(
      resolveSketchDragTarget(
        stack,
        before.entities.map((e) => e.target),
        before,
        acceptance,
      ),
    ).toEqual(side.target);
    const labels = f.undoLabels();
    f.dispatch({
      type: "sketch.geometryDragStarted",
      target: picked,
      point: [30, 20],
    });
    for (let step = 1; step <= 8; step++) {
      f.dispatch({
        type: "sketch.geometryDragMoved",
        point: [30 + step, 20 + step / 2],
      });
    }
    f.dispatch({ type: "sketch.geometryDragEnded", point: [38, 24] });
    await f.settle();
    const after = f.session.definition;
    const position = (id: string) =>
      after.points.find((p) => p.pointId === id)!.position;
    expect(position(opposite.pointId), "opposite corner stays put").toEqual(
      opposite.position,
    );
    expect(
      position(corner.pointId),
      "the grabbed vertex reaches the drop",
    ).toEqual([38, 24]);
    for (const entity of after.entities) {
      if (entity.kind !== "lineSegment") continue;
      const a = position(entity.startPointId);
      const b = position(entity.endPointId);
      const constraint = before.constraints.find(
        (c) =>
          (c.kind === "horizontal" || c.kind === "vertical") &&
          c.entityId === entity.entityId,
      )!;
      const axis = constraint.kind === "horizontal" ? 1 : 0;
      expect(a[axis]).toBeCloseTo(b[axis], 6);
    }
    expect(after.constraints).toEqual(before.constraints);
    expect(after.dimensions).toEqual([]);
    expect(f.session.liveRegions.regions).toHaveLength(1);
    expect(f.undoLabels()).toEqual([...labels, "Move Sketch Geometry"]);
    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expect(f.session.definition.points).toEqual(before.points);
    f.dispatch({ type: "history.redoRequested" });
    await f.settle();
    expect(f.session.definition.points).toEqual(after.points);
  },
);
