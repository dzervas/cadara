import { expect, test } from "vitest";
import { getEditorHistoryAvailability } from "@/core/editor/state-machine";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";

for (const undo of [
  { type: "history.undoRequested" },
  { type: "tool.activated", toolId: "undo" },
] as const) {
  test(`${undo.type}: spline draft Undo pops fit points before authored history`, async () => {
    const f = await createSketchActionOwnerFixture(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
    );
    f.dispatch({ type: "tool.activated", toolId: "line" });
    f.dispatch({
      type: "sketch.primitiveAuthored",
      construction: false,
      primitive: { kind: "line", start: [10, 10], end: [20, 13] },
    });
    expect(f.undoLabels()).toEqual(["Create Sketch Geometry"]);
    const definition = f.session.definition;
    const history = f.session.actionHistory;
    const availability = f.session.actionAvailability;
    const cursor = f.state.snapshot;
    f.dispatch({ type: "tool.activated", toolId: "spline" });
    for (const point of [
      [30, 30],
      [40, 35],
      [50, 31],
    ] as const)
      f.dispatch({
        type: "sketch.pointerReleased",
        sketchUnitsPerPixel: null,
        point,
      });
    expect(f.session.toolPlacedPoints).toHaveLength(3);
    for (const remaining of [2, 1, 0]) {
      f.dispatch(undo);
      expect(f.session.toolPlacedPoints).toHaveLength(remaining);
      expect(f.session.toolPlacements).toHaveLength(remaining);
      expect(f.session.definition).toBe(definition);
      expect(f.session.actionHistory).toEqual(history);
      expect(f.session.actionAvailability).toEqual(availability);
      expect(f.state.snapshot).toBe(cursor);
    }
    expect(f.session.status).toBe("idle");
    expect(f.session.toolStagedEntities).toEqual([]);
    f.dispatch(undo);
    expect(f.session.definition.entities).toHaveLength(0);
    expect(f.session.actionHistory?.undo).toHaveLength(0);
    expect(f.session.actionHistory?.redo).toHaveLength(1);
  });
}

test("a draft alone enables Undo without adding an authored action", async () => {
  const f = await createSketchActionOwnerFixture(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
  );
  f.dispatch({ type: "tool.activated", toolId: "spline" });
  f.dispatch({
    type: "sketch.pointerReleased",
    sketchUnitsPerPixel: null,
    point: [30, 30],
  });
  expect(f.session.actionAvailability?.canUndo).toBe(false);
  expect(getEditorHistoryAvailability(f.state).canUndo).toBe(true);
  f.dispatch({ type: "history.undoRequested" });
  expect(getEditorHistoryAvailability(f.state).canUndo).toBe(false);
  expect(f.session.actionHistory).toEqual({ undo: [], redo: [] });
});
