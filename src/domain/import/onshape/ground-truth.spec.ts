import { test, expect } from "vitest";

import {
  compareTessellation,
  verificationUnavailable,
} from "@/domain/import/onshape/ground-truth";

test("src/domain/import/onshape/ground-truth.spec.ts", () => {
  expect(
    verificationUnavailable(true).status,
    "With bodies but no probe, verification must report as explicitly unavailable.",
  ).toBe("unavailable");

  expect(
    verificationUnavailable(false).status,
    "An empty studio has no ground truth to verify.",
  ).toBe("noGroundTruth");

  const passing = compareTessellation(
    { points: [0, 0, 0, 1, 1, 1] },
    { points: [0, 0, 0, 1, 1, 1.00001] },
    0.001,
  );
  expect(
    passing.status,
    "A rebuild within tolerance should report passing.",
  ).toBe("passing");

  const diverged = compareTessellation(
    { points: [0, 0, 0] },
    { points: [0, 0, 5] },
    0.001,
    ["feature_a"],
  );
  expect(
    diverged.status === "diverged" &&
      diverged.divergingFeatureIds[0] === "feature_a",
    "A rebuild beyond tolerance should report divergence with the diverging feature ids.",
  ).toBeTruthy();
});
