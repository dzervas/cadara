import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
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

  expectTrue(
    JSON.stringify(worldPoint) === JSON.stringify([2, 3, 0]),
    "Sketch feedback anchors should resolve sketch-space points through the active sketch plane.",
  );

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

  expectTrue(
    screenPoint,
    "Projected feedback anchor should produce a screen point.",
  );
  expectTrue(
    screenPoint.x === 125,
    "Projected feedback anchors should include horizontal descriptor offsets.",
  );
  expectTrue(
    screenPoint.y === 28,
    "Projected feedback anchors should include vertical descriptor offsets.",
  );
});
