import { expect, test } from "vitest";
import { threePointArcSketchToolDefinition as tool } from "./three-point-arc";

test("O7: the preview passes exactly through stationary B as C moves", () => {
  let { state } = tool.activate();
  state = tool.pointerRelease({ state, point: [0, 0] }).state;
  const middle = [20, 12] as const;
  state = tool.pointerRelease({ state, point: middle }).state;
  for (const end of [[40, 1], [35, -20], [21, 14]] as const) {
    const result = tool.pointerMove({ state, point: end });
    const preview = result.stagedEntities[0];
    expect(preview?.kind).toBe("polyline");
    if (preview?.kind !== "polyline") throw new Error("Missing arc preview");
    // A circumcircle alone is insufficient: the displayed chords must meet B.
    expect(preview.points).toContainEqual(middle);
    expect(result.state.placedPoints).toEqual([[0, 0], middle]);
  }
});
