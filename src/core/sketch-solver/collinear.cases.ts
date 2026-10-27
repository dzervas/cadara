import {
  tolerances,
  assertClose,
  createCollinearDefinition,
  makeLine,
  makePoint,
} from "./solver-basic.fixtures";
import {
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
} from "./solve-sketch";
import { expect } from "vitest";

export async function testCollinearSolvesLocalLinesAndPointsAgainstInfiniteGeometry() {
    const lineDefinition = createCollinearDefinition({
      points: [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 10, 0),
        makePoint("sketch_point_b0", "B0", 20, 5),
        makePoint("sketch_point_b1", "B1", 30, 5),
      ],
      lines: [
        makeLine(
          "sketch_entity_a",
          "Reference",
          "sketch_point_a0",
          "sketch_point_a1",
        ),
        makeLine(
          "sketch_entity_b",
          "Driven",
          "sketch_point_b0",
          "sketch_point_b1",
        ),
      ],
      constraints: [
        {
          constraintId: "constraint_fix_a0",
          kind: "fixPoint",
          label: "Fix A0",
          pointId: "sketch_point_a0",
          position: [0, 0],
        },
        {
          constraintId: "constraint_fix_a1",
          kind: "fixPoint",
          label: "Fix A1",
          pointId: "sketch_point_a1",
          position: [10, 0],
        },
        {
          constraintId: "constraint_collinear_lines",
          kind: "collinear",
          label: "Collinear lines",
          target: { kind: "localEntity", entityId: "sketch_entity_b" },
          line: { kind: "localEntity", entityId: "sketch_entity_a" },
        },
      ],
    });
    const lineSolved = solveSketchDefinitionCore({
      definition: lineDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const linePoints = new Map(
      lineSolved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      linePoints.get("sketch_point_b0")?.[1] ?? Number.NaN,
      0,
      1e-4,
      "Non-overlapping driven line start should solve onto the reference infinite line.",
    );
    assertClose(
      linePoints.get("sketch_point_b1")?.[1] ?? Number.NaN,
      0,
      1e-4,
      "Non-overlapping driven line end should solve onto the reference infinite line.",
    );
    expect(
      lineSolved.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_collinear_lines",
      )?.status,
      "Line-line Collinear should report satisfied after solving.",
    ).toBe("satisfied");

    const pointDefinition = createCollinearDefinition({
      points: [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 1, 0),
        makePoint("sketch_point_p", "P", 3, 5),
      ],
      lines: [
        makeLine(
          "sketch_entity_a",
          "Reference",
          "sketch_point_a0",
          "sketch_point_a1",
        ),
      ],
      constraints: [
        {
          constraintId: "constraint_fix_a0",
          kind: "fixPoint",
          label: "Fix A0",
          pointId: "sketch_point_a0",
          position: [0, 0],
        },
        {
          constraintId: "constraint_fix_a1",
          kind: "fixPoint",
          label: "Fix A1",
          pointId: "sketch_point_a1",
          position: [1, 0],
        },
        {
          constraintId: "constraint_collinear_point",
          kind: "collinear",
          label: "Collinear point",
          target: { kind: "localPoint", pointId: "sketch_point_p" },
          line: { kind: "localEntity", entityId: "sketch_entity_a" },
        },
      ],
    });
    const pointSolved = solveSketchDefinitionCore({
      definition: pointDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const solvedPoint = pointSolved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_p",
    );
    assertClose(
      solvedPoint?.solvedPosition[1] ?? Number.NaN,
      0,
      1e-4,
      "Point-line Collinear should solve onto the reference infinite line.",
    );
    expect(
      pointSolved.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_collinear_point",
      )?.status,
      "Point-line Collinear should report satisfied for a point that lies on the infinite line outside the finite segment span.",
    ).toBe("satisfied");
  }

export async function testCollinearSolvesAgainstProjectedLineWithoutMovingReference() {
    const definition = createCollinearDefinition({
      points: [
        makePoint("sketch_point_a0", "A0", 0, 5),
        makePoint("sketch_point_a1", "A1", 10, 6),
      ],
      lines: [
        makeLine(
          "sketch_entity_a",
          "Driven",
          "sketch_point_a0",
          "sketch_point_a1",
        ),
      ],
      references: [
        {
          referenceId: "ref_collinear",
          kind: "modelReference",
          label: "Projected line",
          source: { kind: "edge", bodyId: "body_1", edgeId: "edge_1" },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
      constraints: [
        {
          constraintId: "constraint_collinear_projected",
          kind: "collinearProjectedLine",
          label: "Collinear projected",
          target: { kind: "localEntity", entityId: "sketch_entity_a" },
          projectedLine: {
            kind: "projectedGeometry",
            reference: {
              kind: "projectedLineSegment",
              referenceId: "ref_collinear",
              geometryId: "projected_geometry_line",
            },
          },
        },
      ],
    });
    const projectedReferences = [
      {
        referenceId: "ref_collinear",
        status: "projected" as const,
        geometry: [
          {
            geometryId: "projected_geometry_line" as const,
            kind: "lineSegment" as const,
            startPosition: [0, 2] as const,
            endPosition: [10, 2] as const,
          },
        ],
        diagnostics: [],
      },
    ];
    const solved = solveSketchDefinitionCore({
      definition,
      projectedReferences,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const points = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      points.get("sketch_point_a0")?.[1] ?? Number.NaN,
      2,
      1e-4,
      "Projected-line Collinear should move the local line start onto the read-only line.",
    );
    assertClose(
      points.get("sketch_point_a1")?.[1] ?? Number.NaN,
      2,
      1e-4,
      "Projected-line Collinear should move the local line end onto the read-only line.",
    );
    expect(
      solved.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_collinear_projected",
      )?.status,
      "Projected-line Collinear should report satisfied when the editable line reaches the projected line.",
    ).toBe("satisfied");
  }

export async function testCollinearValidationReportsMissingAndDegenerateTargets() {
    const missing = createCollinearDefinition({
      points: [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 10, 0),
      ],
      lines: [
        makeLine(
          "sketch_entity_a",
          "Reference",
          "sketch_point_a0",
          "sketch_point_a1",
        ),
      ],
      constraints: [
        {
          constraintId: "constraint_collinear_missing",
          kind: "collinear",
          label: "Missing collinear",
          target: { kind: "localPoint", pointId: "sketch_point_missing" },
          line: { kind: "localEntity", entityId: "sketch_entity_a" },
        },
      ],
    });
    const missingValidation = validateSketchDefinitionCore({
      definition: missing,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(
      missingValidation.diagnostics.some(
        (diagnostic) => diagnostic.code === "missing-collinear-target",
      ),
      "Collinear validation should report missing local operands.",
    ).toBeTruthy();

    const degenerate = createCollinearDefinition({
      points: [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 0, 0),
        makePoint("sketch_point_p", "P", 1, 1),
      ],
      lines: [
        makeLine(
          "sketch_entity_a",
          "Degenerate",
          "sketch_point_a0",
          "sketch_point_a1",
        ),
      ],
      constraints: [
        {
          constraintId: "constraint_collinear_degenerate",
          kind: "collinear",
          label: "Degenerate collinear",
          target: { kind: "localPoint", pointId: "sketch_point_p" },
          line: { kind: "localEntity", entityId: "sketch_entity_a" },
        },
      ],
    });
    const degenerateValidation = validateSketchDefinitionCore({
      definition: degenerate,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(
      degenerateValidation.diagnostics.some(
        (diagnostic) => diagnostic.code === "degenerate-line-segment",
      ),
      "Degenerate Collinear reference lines should surface a solver validation diagnostic instead of fallback geometry.",
    ).toBeTruthy();
  }
