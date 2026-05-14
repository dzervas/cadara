import { test, expect } from "vitest";

import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import {
  projectSketchFeedbackAnchor,
  resolveSketchFeedbackAnchorWorldPoint,
} from "@/core/workspace/sketch-feedback-projection";

test("src/core/workspace/sketch-feedback-projection.spec.ts", () => {
  const plane = createStandardPlaneDefinition("xy");
  const anchor = {
    kind: "sketchPoint" as const,
    point: [2, 3] as const,
    offset: { x: 5, y: -7 },
  };
  const worldPoint = resolveSketchFeedbackAnchorWorldPoint(anchor, plane);

  expect(
    JSON.stringify(worldPoint),
    "Sketch feedback anchors should resolve sketch-space points through the active sketch plane.",
  ).toBe(JSON.stringify([2, 3, 0]));

  const screenPoint = projectSketchFeedbackAnchor({
    anchor,
    plane,
    viewport: { width: 200, height: 100 },
    projectWorldPoint: (point) => ({
      x: point[0] / 10,
      y: point[1] / 10,
      z: 0,
    }),
  });

  expect(
    screenPoint,
    "Projected feedback anchor should produce a screen point.",
  ).toBeTruthy();
  expect(
    screenPoint.x,
    "Projected feedback anchors should include horizontal descriptor offsets.",
  ).toBe(125);
  expect(
    screenPoint.y,
    "Projected feedback anchors should include vertical descriptor offsets.",
  ).toBe(28);
});
