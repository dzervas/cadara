import { test, expect } from "vitest";

import { validateSketchDefinition } from "@/contracts/sketch/runtime-schema";
import { translateSketch } from "@/domain/import/onshape/sketch-translator";

test("src/domain/import/onshape/sketch-translator.spec.ts", () => {
  const result = translateSketch({
    featureId: "FOoap8tw3jKAJf5_0",
    label: "Sketch 1",
    planeKey: "xy",
    entities: [
      {
        entityId: "line1",
        entityType: "lineSegment",
        start: [0, 0],
        end: [10, 0],
      },
      {
        entityId: "circle1",
        entityType: "circle",
        center: [5, 5],
        radius: 2,
        isConstruction: true,
      },
      { entityId: "spline1", entityType: "interpolatedSpline" },
    ],
  });

  expect(
    result.plane.support.kind === "construction" &&
      result.plane.key === "xy",
    "The sketch should sit on the canonical XY construction plane.",
  ).toBeTruthy();

  expect(
    result.definition.entities.map((entity) => entity.kind).sort(),
    "Supported entities (line, circle) should translate; the spline should not.",
  ).toEqual(["circle", "lineSegment"]);

  expect(
    result.definition.entities.find((entity) => entity.kind === "circle")
      ?.isConstruction,
    "Construction flags should be preserved.",
  ).toBe(true);

  const line = result.definition.points.filter((point) =>
    point.label.startsWith("line1"),
  );
  expect(
    line.some((point) => point.position[0] === 10 && point.position[1] === 0),
    "Line endpoints should be seeded from Onshape's solved positions.",
  ).toBeTruthy();

  expect(
    result.diagnostics[0]?.code,
    "The unsupported spline should produce an explicit dropped-entity diagnostic.",
  ).toBe("onshape-sketch-unsupported-entity");

  expect(
    validateSketchDefinition(result.definition).success,
    "The translated definition should validate against the sketch contract.",
  ).toBeTruthy();
});
