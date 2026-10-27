import {
  tolerances,
  makeCircle,
  makeLine,
  makePoint,
} from "./solver-basic.fixtures";
import {
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
} from "./solve-sketch";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect } from "vitest";

export async function testValidationRejectsDegenerateLine() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 0, 0),
      ],
      entityIds: ["sketch_entity_line"],
      entities: [
        makeLine(
          "sketch_entity_line",
          "Line",
          "sketch_point_a",
          "sketch_point_b",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const validation = validateSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(validation.isValid, "Degenerate line should fail validation.").toBe(
      false,
    );
  }

export async function testValidationRejectsPointIdsWithoutRecords() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_missing"],
      points: [makePoint("sketch_point_a", "A", 0, 0)],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const validation = validateSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(
      validation.diagnostics.some(
        (diagnostic) => diagnostic.code === "point-missing-from-records",
      ),
      "Validation should reject point ids that do not have backing records.",
    ).toBeTruthy();
  }

export async function testValidationRejectsMissingConstraintReferences() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a"],
      points: [makePoint("sketch_point_a", "A", 0, 0)],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_missing_fix_point"],
      constraints: [
        {
          constraintId: "constraint_missing_fix_point",
          kind: "fixPoint",
          label: "Broken fix point",
          pointId: "sketch_point_b",
          position: [0, 0],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const validation = validateSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(
      validation.diagnostics.some(
        (diagnostic) => diagnostic.code === "missing-fix-point",
      ),
      "Validation should reject constraints that reference missing points.",
    ).toBeTruthy();
  }

export async function testValidationRejectsDuplicatePointRecords() {
    const duplicate = makePoint("sketch_point_duplicate", "Duplicate", 0, 0);
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_duplicate"],
      points: [
        duplicate,
        {
          ...duplicate,
          position: [10, 0],
        },
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const validation = validateSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(
      validation.isValid,
      "Validation should reject duplicate point records even when pointIds is unique.",
    ).toBeFalsy();
    expect(
      validation.diagnostics.some(
        (diagnostic) => diagnostic.code === "duplicate-point-record",
      ),
      "Validation should emit duplicate-point-record for duplicate point records.",
    ).toBeTruthy();
  }

export async function testValidationRejectsDuplicateEntityRecords() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 1, 0),
        makePoint("sketch_point_c", "C", 0, 1),
      ],
      entityIds: ["sketch_entity_duplicate"],
      entities: [
        makeLine(
          "sketch_entity_duplicate",
          "AB",
          "sketch_point_a",
          "sketch_point_b",
        ),
        makeLine(
          "sketch_entity_duplicate",
          "AC",
          "sketch_point_a",
          "sketch_point_c",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };

    const validation = validateSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(
      validation.isValid,
      "Validation should reject duplicate entity records even when entityIds is unique.",
    ).toBeFalsy();
    expect(
      validation.diagnostics.some(
        (diagnostic) => diagnostic.code === "duplicate-entity-record",
      ),
      "Validation should emit duplicate-entity-record for duplicate entity records.",
    ).toBeTruthy();
  }

export async function testCircleRadiusDimensionDrivesSolvedCircleRadius() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_center"],
      points: [makePoint("sketch_point_center", "Center", 0, 0)],
      entityIds: ["sketch_entity_circle"],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 1),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_circle_radius"],
      dimensions: [
        {
          dimensionId: "dimension_circle_radius",
          kind: "circleRadius",
          label: "Radius 2",
          entityId: "sketch_entity_circle",
          value: 2,
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
    const dimensionStatus = solved.solvedSnapshot.dimensionStatuses.find(
      (status) => status.dimensionId === "dimension_circle_radius",
    );

    expect(
      solved.status.solveState,
      "Circle radius dimension should keep the solve in a solved state.",
    ).toBe("solved");
    expect(
      !solvedCircle,
      "Circle radius dimension should produce solved circle geometry.",
    ).toBeFalsy();
    expect(
      solvedCircle?.kind === "circle" &&
        Math.abs(solvedCircle.solvedRadius - 2) < 1e-4,
      "Circle radius dimension should drive the solved circle radius to the dimension value.",
    ).toBeTruthy();
    expect(
      dimensionStatus?.status,
      "Circle radius dimension should report driving status once satisfied.",
    ).toBe("driving");
    expect(
      dimensionStatus !== undefined &&
        dimensionStatus.solvedValue !== null &&
        Math.abs(dimensionStatus.solvedValue - 2) < 1e-4,
      "Circle radius dimension status should report the solved radius value.",
    ).toBeTruthy();
  }

export async function testCircleDiameterDimensionDrivesSolvedCircleRadius() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_center"],
      points: [makePoint("sketch_point_center", "Center", 0, 0)],
      entityIds: ["sketch_entity_circle"],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 1),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_circle_diameter"],
      dimensions: [
        {
          dimensionId: "dimension_circle_diameter",
          kind: "diameter",
          label: "Diameter 6",
          entityId: "sketch_entity_circle",
          value: 6,
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
    const dimensionStatus = solved.solvedSnapshot.dimensionStatuses.find(
      (status) => status.dimensionId === "dimension_circle_diameter",
    );

    expect(
      solved.status.solveState,
      "Circle diameter dimension should keep the solve in a solved state.",
    ).toBe("solved");
    expect(
      !solvedCircle,
      "Circle diameter dimension should produce solved circle geometry.",
    ).toBeFalsy();
    expect(
      solvedCircle?.kind === "circle" &&
        Math.abs(solvedCircle.solvedRadius - 3) < 1e-4,
      "Circle diameter dimension should drive the solved circle radius to half of the diameter value.",
    ).toBeTruthy();
    expect(
      dimensionStatus?.status,
      "Circle diameter dimension should report driving status once satisfied.",
    ).toBe("driving");
    expect(
      dimensionStatus !== undefined &&
        dimensionStatus.solvedValue !== null &&
        Math.abs(dimensionStatus.solvedValue - 6) < 1e-4,
      "Circle diameter dimension status should report the solved diameter value.",
    ).toBeTruthy();
  }
