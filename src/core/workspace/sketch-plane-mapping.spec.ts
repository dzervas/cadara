import { expect, test } from "bun:test";

import type { SketchPlaneDefinition } from "@/contracts/shared/sketch-plane";
import {
  mapSketchPointToWorkspaceWorld,
  mapWorldPointToWorkspaceSketch,
} from "@/core/workspace/sketch-plane-mapping";

test("src/core/workspace/sketch-plane-mapping.spec.ts", () => {
  const yzPlane: SketchPlaneDefinition = {
    support: { kind: "construction", constructionId: "construction_plane-yz" },
    key: "yz",
    frame: {
      origin: [10, 20, 30],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
  };

  const worldPoint = mapSketchPointToWorkspaceWorld(yzPlane, [4, 5]);
  expect(worldPoint).toEqual([10, 24, 35]);
  expect(mapWorldPointToWorkspaceSketch(yzPlane, worldPoint)).toEqual([4, 5]);

  expect(() =>
    mapSketchPointToWorkspaceWorld(
      {
        ...yzPlane,
        frame: {
          ...yzPlane.frame,
          normal: [-1, 0, 0],
        },
      },
      [4, 5],
    ),
  ).toThrow(/right-handed/);
});
