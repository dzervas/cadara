import { test, expect } from "vitest";

import { validateFeatureDefinition } from "@/contracts/modeling/runtime-schema";
import { PLANE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import type { SketchPlaneFrame } from "@/contracts/shared/sketch-plane";

const orthonormalFrame: SketchPlaneFrame = {
  origin: [10, 20, 30],
  xAxis: [1, 0, 0],
  yAxis: [0, 1, 0],
  normal: [0, 0, 1],
  linearUnit: "documentLength",
  handedness: "rightHanded",
};

function explicitFramePlane(frame: SketchPlaneFrame) {
  return {
    kind: "plane" as const,
    featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
    parameters: { mode: "explicitFrame" as const, frame },
  };
}

test("src/contracts/modeling/plane-explicit-frame.runtime-schema.spec.ts", () => {
  // Valid orthonormal right-handed frame is accepted.
  const accepted = validateFeatureDefinition(
    explicitFramePlane(orthonormalFrame),
  );
  expect(
    accepted.success,
    "An orthonormal right-handed explicit-frame plane must pass contract validation.",
  ).toBeTruthy();

  // Non-unit axis is rejected.
  const nonUnit = validateFeatureDefinition(
    explicitFramePlane({ ...orthonormalFrame, xAxis: [2, 0, 0] }),
  );
  expect(
    nonUnit.success,
    "An explicit-frame plane with a non-unit axis must fail contract validation.",
  ).toBeFalsy();

  // Non-orthogonal axes are rejected.
  const nonOrthogonal = validateFeatureDefinition(
    explicitFramePlane({ ...orthonormalFrame, yAxis: [1, 0, 0] }),
  );
  expect(
    nonOrthogonal.success,
    "An explicit-frame plane whose axes are not mutually orthogonal must fail contract validation.",
  ).toBeFalsy();

  // Left-handed frame is rejected.
  const leftHanded = validateFeatureDefinition(
    explicitFramePlane({ ...orthonormalFrame, normal: [0, 0, -1] }),
  );
  expect(
    leftHanded.success,
    "A left-handed explicit-frame plane must fail contract validation.",
  ).toBeFalsy();

  // The degenerate-frame diagnostic is structured and machine-readable.
  expect(
    leftHanded.success === false &&
      leftHanded.issues.some((issue) => issue.path === "parameters.frame"),
    "A degenerate explicit frame must be reported at parameters.frame.",
  ).toBeTruthy();

  // Coplanar mode is unchanged: a valid coplanar plane still validates.
  const coplanar = validateFeatureDefinition({
    kind: "plane",
    featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
    parameters: {
      mode: "coplanar",
      reference: {
        target: { kind: "construction", constructionId: "construction_plane-xy" },
      },
    },
  });
  expect(
    coplanar.success,
    "A coplanar plane definition must remain valid after adding the explicit-frame mode.",
  ).toBeTruthy();
});
