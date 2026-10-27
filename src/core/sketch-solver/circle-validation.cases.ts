import { tolerances, makeCircle, makePoint } from "./solver-basic.fixtures";
import { solveSketchDefinitionCore } from "./solve-sketch";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect } from "vitest";

export async function testNegativeSolvedCircleRadiusIsFlaggedByGeometryValidation() {
    // B12: a circle with a positive authored radius driven to a negative
    // radius by a dimension should be flagged in the solved snapshot.
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_center"],
      points: [makePoint("sketch_point_center", "Center", 0, 0)],
      entityIds: ["sketch_entity_circle"],
      entities: [
        makeCircle(
          "sketch_entity_circle",
          "Circle",
          "sketch_point_center",
          1,
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_negative_radius"],
      dimensions: [
        {
          dimensionId: "dimension_negative_radius",
          kind: "circleRadius",
          label: "Negative radius",
          entityId: "sketch_entity_circle",
          value: -2,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const solvedCircle = solved.solvedSnapshot.solvedEntities.find(
      (entity) =>
        entity.entityId === "sketch_entity_circle" && entity.kind === "circle",
    );
    expect(
      solvedCircle?.kind === "circle" && solvedCircle.solvedRadius < 0,
      "The solver should drive the circle radius to a negative value.",
    ).toBe(true);
    expect(
      solved.solvedSnapshot.diagnostics.some(
        (diagnostic) => diagnostic.code === "invalid-solved-circle-radius",
      ),
      "A negative solved circle radius must produce an invalid-solved-circle-radius diagnostic.",
    ).toBe(true);
    expect(
      solved.solvedSnapshot.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "invalid-solved-circle-radius" &&
          diagnostic.severity === "error",
      ),
      "The invalid-solved-circle-radius diagnostic must be an error.",
    ).toBe(true);
    // The snapshot must report a failed/partially-solved state because
    // geometryValid is false.
    expect(
      solved.status.solveState,
      "A snapshot with a negative solved radius must not be solved.",
    ).toBe("partiallySolved");
  }

export async function testPositiveSolvedCircleRadiusIsNotFlaggedByGeometryValidation() {
    // Control row: a positive solved radius must not produce the diagnostic.
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_center"],
      points: [makePoint("sketch_point_center", "Center", 0, 0)],
      entityIds: ["sketch_entity_circle"],
      entities: [
        makeCircle(
          "sketch_entity_circle",
          "Circle",
          "sketch_point_center",
          1,
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_positive_radius"],
      dimensions: [
        {
          dimensionId: "dimension_positive_radius",
          kind: "circleRadius",
          label: "Radius 3",
          entityId: "sketch_entity_circle",
          value: 3,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    expect(
      solved.solvedSnapshot.diagnostics.some(
        (diagnostic) => diagnostic.code === "invalid-solved-circle-radius",
      ),
      "A positive solved circle radius must not produce the invalid-solved-circle-radius diagnostic.",
    ).toBe(false);
    expect(
      solved.status.solveState,
      "A circle with a positive solved radius should solve normally.",
    ).toBe("solved");
  }
