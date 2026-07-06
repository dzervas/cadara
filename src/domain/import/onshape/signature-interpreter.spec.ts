import { test, expect } from "vitest";

import { interpretResolvedReference } from "@/domain/import/onshape/signature-interpreter";

test("src/domain/import/onshape/signature-interpreter.spec.ts", () => {
  const topPlane = interpretResolvedReference({
    deterministicId: "JDC",
    evaluatedAt: "finalState",
    signature: {
      entityClass: "face",
      geometryType: "PLANE",
      definingData: { origin: [0, 0, 0], normal: [0, 0, 1] },
    },
  });
  expect(
    topPlane.kind === "canonicalPlane" && topPlane.planeKey === "xy",
    "A datum plane at the origin with a +Z normal should map to the canonical XY plane.",
  ).toBeTruthy();

  const rightPlane = interpretResolvedReference({
    deterministicId: "R",
    evaluatedAt: "finalState",
    signature: {
      entityClass: "face",
      geometryType: "PLANE",
      isDefaultPlane: true,
      definingData: { normal: [-1, 0, 0] },
    },
  });
  expect(
    rightPlane.kind === "canonicalPlane" && rightPlane.planeKey === "yz",
    "An unoriented default plane with an X-aligned normal should map to YZ.",
  ).toBeTruthy();

  const cylinder = interpretResolvedReference({
    deterministicId: "JGC",
    evaluatedAt: "finalState",
    signature: {
      entityClass: "face",
      geometryType: "CYLINDER",
      definingData: { radius: 0.005 },
    },
  });
  expect(
    cylinder.kind,
    "A non-datum face must require the probe rather than resolving probe-free.",
  ).toBe("needsProbe");

  const unresolved = interpretResolvedReference({
    deterministicId: "ZZZ",
    evaluatedAt: "finalState",
    unresolved: { reason: "consumed mid-history" },
  });
  expect(
    unresolved.kind,
    "A capture-side unresolved reference should pass through as unresolved.",
  ).toBe("unresolved");
});
