import { test, expect } from "vitest";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
  isCompiledSketchSolveProgramCompatible,
  solveSketchDefinitionCore,
  solveSketchDefinitionWithDraggedPointTarget,
  sketchDraggedPointHasFreeDof,
  updateCompiledSketchSolveSession,
  validateSketchDefinitionCore,
  type SketchSolveStrategy,
  type SketchSolveTolerancePolicy,
} from "@/contracts/sketch/solver-core";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import {
  evaluateSplineSpan,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";

test("src/contracts/sketch/solver-core.spec.ts", async () => {
  function assertClose(
    actual: number,
    expected: number,
    tolerance: number,
    message: string,
  ) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message} Expected ${expected}, received ${actual}.`);
    }
  }

  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  } as const;

  function makePoint(pointId: string, label: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label,
      target: {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: pointId as `sketch_point_${string}`,
      } as const,
      position: [x, y] as const,
      isConstruction: false,
    };
  }

  function makeLine(
    entityId: string,
    label: string,
    startPointId: string,
    endPointId: string,
  ) {
    return {
      kind: "lineSegment" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction: false,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
    };
  }

  function makeArc(
    entityId: string,
    label: string,
    centerPointId: string,
    startPointId: string,
    endPointId: string,
  ) {
    return {
      kind: "arc" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction: false,
      centerPointId: centerPointId as `sketch_point_${string}`,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
      sweepDirection: "counterClockwise" as const,
    };
  }

  function makeCircle(
    entityId: string,
    label: string,
    centerPointId: string,
    radius: number,
  ) {
    return {
      kind: "circle" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction: false,
      centerPointId: centerPointId as `sketch_point_${string}`,
      radius,
    };
  }

  function cloneValues(values: Float64Array) {
    return new Float64Array(values);
  }

  function assertGradientMatchesFiniteDifference(
    definition: SketchDefinition,
    constraintId: ConstraintId | DimensionId,
    tolerance: number,
    epsilon = 1e-6,
    values?: Float64Array,
  ) {
    const baseValues =
      values ??
      getSketchSolveInitialValuesForTest(definition, tolerances, 1e-3);
    const analytical = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition,
      constraintId,
      values: baseValues,
    });

    const numerical = new Float64Array(baseValues.length);
    for (let index = 0; index < baseValues.length; index += 1) {
      const plus = cloneValues(baseValues);
      plus[index] += epsilon;
      const minus = cloneValues(baseValues);
      minus[index] -= epsilon;
      const next = evaluateSketchScalarConstraintForTest({
        tolerances,
        modelingTolerance: 1e-3,
        definition,
        constraintId,
        values: plus,
      });
      const previous = evaluateSketchScalarConstraintForTest({
        tolerances,
        modelingTolerance: 1e-3,
        definition,
        constraintId,
        values: minus,
      });
      numerical[index] = (next.residual - previous.residual) / (2 * epsilon);
    }

    let squaredError = 0;
    for (let index = 0; index < analytical.gradient.length; index += 1) {
      const delta = analytical.gradient[index]! - numerical[index]!;
      squaredError += delta * delta;
    }
    const error = Math.sqrt(squaredError);
    expect(
      error < tolerance,
      `Gradient mismatch for ${constraintId}. Error ${error} exceeds tolerance ${tolerance}.`,
    ).toBeTruthy();
  }

  function assertRotatedRectangleMatchesIsotopeBranches(
    solved: ReturnType<typeof solveSketchDefinitionCore>,
    strategy: SketchSolveStrategy,
    tolerance: number,
  ) {
    const coords = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const a = coords.get("sketch_point_a");
    const b = coords.get("sketch_point_b");
    const c = coords.get("sketch_point_c");
    const d = coords.get("sketch_point_d");
    const reference = coords.get("sketch_point_reference");
    expect(
      a && b && c && d && reference,
      `Expected solved rotated-rectangle anchors for ${strategy}.`,
    ).toBeTruthy();

    const sqrt2 = Math.sqrt(2);
    const halfSqrt2 = sqrt2 / 2;
    const matches = (
      point: readonly [number, number],
      expected: readonly [number, number],
    ) => Math.hypot(point[0] - expected[0], point[1] - expected[1]) < tolerance;

    expect(
      matches(reference, [1, 0]),
      `Reference point should remain fixed for ${strategy}.`,
    ).toBeTruthy();
    expect(
      matches(a, [0, 0]),
      `A should remain at origin for ${strategy}.`,
    ).toBeTruthy();

    if (b[1] < 0) {
      expect(
        matches(b, [sqrt2, -sqrt2]),
        `B should match isotope below-axis branch for ${strategy}.`,
      ).toBeTruthy();
      if (c[1] < b[1]) {
        expect(
          matches(c, [-halfSqrt2, -5 * halfSqrt2]),
          `C should match isotope down-left branch for ${strategy}.`,
        ).toBeTruthy();
        expect(
          matches(d, [-3 * halfSqrt2, -3 * halfSqrt2]),
          `D should match isotope down-left branch for ${strategy}.`,
        ).toBeTruthy();
        return;
      }

      expect(
        matches(c, [5 * halfSqrt2, halfSqrt2]),
        `C should match isotope up-right branch for ${strategy}.`,
      ).toBeTruthy();
      expect(
        matches(d, [3 * halfSqrt2, 3 * halfSqrt2]),
        `D should match isotope up-right branch for ${strategy}.`,
      ).toBeTruthy();
      return;
    }

    expect(
      matches(b, [sqrt2, sqrt2]),
      `B should match isotope above-axis branch for ${strategy}.`,
    ).toBeTruthy();
    if (c[1] > b[1]) {
      expect(
        matches(c, [-halfSqrt2, 5 * halfSqrt2]),
        `C should match isotope up-left branch for ${strategy}.`,
      ).toBeTruthy();
      expect(
        matches(d, [-3 * halfSqrt2, 3 * halfSqrt2]),
        `D should match isotope up-left branch for ${strategy}.`,
      ).toBeTruthy();
      return;
    }

    expect(
      matches(c, [5 * halfSqrt2, -halfSqrt2]),
      `C should match isotope down-right branch for ${strategy}.`,
    ).toBeTruthy();
    expect(
      matches(d, [3 * halfSqrt2, -3 * halfSqrt2]),
      `D should match isotope down-right branch for ${strategy}.`,
    ).toBeTruthy();
  }

  function createLogoReferenceImageAnchorFixture(): SketchDefinition {
    const anchor1 =
      "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1";
    const anchor2 =
      "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2";
    const line6End = "sketch_point_6_line-end";
    const line8End = "sketch_point_8_line-end";
    const line12End = "sketch_point_12_line-end";
    const line13End = "sketch_point_13_line-end";
    const line19End = "sketch_point_19_line-end";
    const line21End = "sketch_point_21_line-end";

    return {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        anchor1,
        anchor2,
        line6End,
        line8End,
        line12End,
        line13End,
        line19End,
        line21End,
      ],
      points: [
        makePoint(anchor1, "Anchor 1", 29.110404607012146, 1.2961566959965458),
        makePoint(anchor2, "Anchor 2", 29.110404607076696, 21.296156697438256),
        makePoint(
          line6End,
          "Line 6 end",
          45.53114365977362,
          5.6960804368925855,
        ),
        makePoint(
          line8End,
          "Line 8 end",
          61.50591820712896,
          -0.11826201065457728,
        ),
        makePoint(
          line12End,
          "Line 12 end",
          45.53114365781939,
          25.69608044881377,
        ),
        makePoint(
          line13End,
          "Line 13 end",
          61.505918203348486,
          19.881737991355145,
        ),
        makePoint(
          line19End,
          "Line 19 end",
          61.5059182072414,
          -0.11826201028785953,
        ),
        makePoint(
          line21End,
          "Line 21 end",
          45.08517915454362,
          -4.518185748524435,
        ),
      ],
      entityIds: [
        "sketch_entity_3_line",
        "sketch_entity_6_line",
        "sketch_entity_8_line",
        "sketch_entity_12_line",
        "sketch_entity_13_line",
        "sketch_entity_19_line",
        "sketch_entity_21_line",
        "sketch_entity_22_line",
      ],
      entities: [
        makeLine("sketch_entity_3_line", "Line 3", anchor1, anchor2),
        makeLine("sketch_entity_6_line", "Line 6", anchor1, line6End),
        makeLine("sketch_entity_8_line", "Line 8", line6End, line8End),
        makeLine("sketch_entity_12_line", "Line 12", anchor2, line12End),
        makeLine("sketch_entity_13_line", "Line 13", line12End, line13End),
        makeLine("sketch_entity_19_line", "Line 19", line13End, line19End),
        makeLine("sketch_entity_21_line", "Line 21", anchor1, line21End),
        makeLine("sketch_entity_22_line", "Line 22", line21End, line19End),
      ],
      constraintIds: [
        "constraint_4_vertical",
        "constraint_11_equal",
        "constraint_15_equal",
        "constraint_16_parallel",
        "constraint_17_parallel",
        "constraint_18_equal",
        "constraint_20_coincident",
        "constraint_23_equal",
        "constraint_24_equal",
        "constraint_25_equal",
      ],
      constraints: [
        {
          constraintId: "constraint_4_vertical",
          kind: "vertical",
          label: "Line 3 vertical",
          entityId: "sketch_entity_3_line",
        },
        {
          constraintId: "constraint_11_equal",
          kind: "equalLength",
          label: "Lines 6 and 8 equal",
          entityIds: ["sketch_entity_6_line", "sketch_entity_8_line"],
        },
        {
          constraintId: "constraint_15_equal",
          kind: "equalLength",
          label: "Lines 12 and 6 equal",
          entityIds: ["sketch_entity_12_line", "sketch_entity_6_line"],
        },
        {
          constraintId: "constraint_16_parallel",
          kind: "parallel",
          label: "Lines 12 and 6 parallel",
          entityIds: ["sketch_entity_12_line", "sketch_entity_6_line"],
        },
        {
          constraintId: "constraint_17_parallel",
          kind: "parallel",
          label: "Lines 13 and 8 parallel",
          entityIds: ["sketch_entity_13_line", "sketch_entity_8_line"],
        },
        {
          constraintId: "constraint_18_equal",
          kind: "equalLength",
          label: "Lines 12 and 13 equal",
          entityIds: ["sketch_entity_12_line", "sketch_entity_13_line"],
        },
        {
          constraintId: "constraint_20_coincident",
          kind: "coincident",
          label: "Line 19 end coincident with Line 8 end",
          pointIds: [line19End, line8End],
        },
        {
          constraintId: "constraint_23_equal",
          kind: "equalLength",
          label: "Lines 22 and 6 equal",
          entityIds: ["sketch_entity_22_line", "sketch_entity_6_line"],
        },
        {
          constraintId: "constraint_24_equal",
          kind: "equalLength",
          label: "Lines 21 and 8 equal",
          entityIds: ["sketch_entity_21_line", "sketch_entity_8_line"],
        },
        {
          constraintId: "constraint_25_equal",
          kind: "equalLength",
          label: "Lines 19 and 3 equal",
          entityIds: ["sketch_entity_19_line", "sketch_entity_3_line"],
        },
      ],
      dimensionIds: [
        "dimension_5_line-length",
        "dimension_7_line-angle",
        "dimension_10_line-angle",
        "dimension_26_line-length",
      ],
      dimensions: [
        {
          dimensionId: "dimension_5_line-length",
          kind: "lineLength",
          label: "Line 3 length",
          entityId: "sketch_entity_3_line",
          value: 20,
        },
        {
          dimensionId: "dimension_7_line-angle",
          kind: "lineAngle",
          label: "Line 6 angle from Line 3",
          lines: [
            { kind: "localEntity", entityId: "sketch_entity_3_line" },
            { kind: "localEntity", entityId: "sketch_entity_6_line" },
          ],
          valueRadians: 1.3089969389957472,
        },
        {
          dimensionId: "dimension_10_line-angle",
          kind: "lineAngle",
          label: "Line 8 angle from Line 6",
          lines: [
            { kind: "localEntity", entityId: "sketch_entity_8_line" },
            { kind: "localEntity", entityId: "sketch_entity_6_line" },
          ],
          valueRadians: 2.5307274153917776,
        },
        {
          dimensionId: "dimension_26_line-length",
          kind: "lineLength",
          label: "Line 6 length",
          entityId: "sketch_entity_6_line",
          value: 17,
        },
      ],
    };
  }

  function createCollinearDefinition(input: {
    points: readonly ReturnType<typeof makePoint>[];
    lines: readonly ReturnType<typeof makeLine>[];
    constraints: SketchDefinition["constraints"];
    references?: SketchDefinition["references"];
  }): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds:
        input.references?.map((reference) => reference.referenceId) ?? [],
      references: input.references ?? [],
      pointIds: input.points.map((point) => point.pointId),
      points: input.points,
      entityIds: input.lines.map((line) => line.entityId),
      entities: input.lines,
      constraintIds: input.constraints.map(
        (constraint) => constraint.constraintId,
      ),
      constraints: input.constraints,
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: [],
      derivedRelationships: [],
      styles: [],
      styleIds: [],
    };
  }

  async function testCollinearSolvesLocalLinesAndPointsAgainstInfiniteGeometry() {
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

  async function testCollinearSolvesAgainstProjectedLineWithoutMovingReference() {
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

  async function testCollinearValidationReportsMissingAndDegenerateTargets() {
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

  async function testFixPoint() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a"],
      points: [makePoint("sketch_point_a", "A", 1, 0)],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_fix_a"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [1, 1],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    const point = solved.solvedSnapshot.solvedPoints[0];
    expect(point, "Expected one solved point.").not.toBe(undefined);
    expect(
      Math.abs(point.solvedPosition[0] - 1) < 1e-6,
      "Fix point should preserve x.",
    ).toBeTruthy();
    expect(
      Math.abs(point.solvedPosition[1] - 1) < 1e-6,
      "Fix point should solve y to 1.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(definition, "constraint_fix_a", 1e-6);
  }

  async function testEuclideanDistance() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_distance"],
      dimensions: [
        {
          dimensionId: "dimension_distance",
          kind: "distance",
          label: "Distance",
          axis: "aligned",
          pointIds: ["sketch_point_a", "sketch_point_b"],
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

    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved point pair.",
    ).toBeTruthy();
    const distance = Math.hypot(
      a.solvedPosition[0] - b.solvedPosition[0],
      a.solvedPosition[1] - b.solvedPosition[1],
    );
    expect(
      Math.abs(distance - 3) < 1e-4,
      "Aligned distance should solve to 3.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_distance",
      1e-6,
    );
  }

  async function testHorizontalDistance() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_horizontal_distance"],
      dimensions: [
        {
          dimensionId: "dimension_horizontal_distance",
          kind: "horizontalDistance",
          label: "Horizontal distance",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: -3,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved point pair.",
    ).toBeTruthy();
    expect(
      Math.abs(b.solvedPosition[0] - a.solvedPosition[0] + 3) < 1e-4,
      "Horizontal distance should solve to -3.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_horizontal_distance",
      1e-6,
    );
  }

  async function testVerticalDistance() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_vertical_distance"],
      dimensions: [
        {
          dimensionId: "dimension_vertical_distance",
          kind: "verticalDistance",
          label: "Vertical distance",
          pointIds: ["sketch_point_a", "sketch_point_b"],
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

    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved point pair.",
    ).toBeTruthy();
    expect(
      Math.abs(b.solvedPosition[1] - a.solvedPosition[1] - 3) < 1e-4,
      "Vertical distance should solve to 3.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_vertical_distance",
      1e-6,
    );
  }

  async function testEditedParallelLineDistanceConverges() {
    const points = [
      makePoint("sketch_point_a", "A", -4.5, 50),
      makePoint("sketch_point_b", "B", -4.5, -50),
      makePoint("sketch_point_c", "C", 4.5, 50),
      makePoint("sketch_point_d", "D", 4.5, -50),
    ];
    const entities = [
      makeLine(
        "sketch_entity_left",
        "Left",
        points[0]!.pointId,
        points[1]!.pointId,
      ),
      makeLine(
        "sketch_entity_right",
        "Right",
        points[2]!.pointId,
        points[3]!.pointId,
      ),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      points,
      pointIds: points.map((point) => point.pointId),
      entities,
      entityIds: entities.map((entity) => entity.entityId),
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_gap"],
      dimensions: [
        {
          dimensionId: "dimension_gap",
          kind: "lineDistance",
          label: "Gap",
          lines: [
            { kind: "localEntity", entityId: entities[0]!.entityId },
            { kind: "localEntity", entityId: entities[1]!.entityId },
          ],
          value: 12,
        },
      ],
      styleIds: [],
      styles: [],
      svgRenderingEnabled: true,
    };
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(
      solved.status.solveState,
      "An edited distance must not stall when initially parallel lines rotate during iteration.",
    ).toBe("solved");
    assertClose(
      solved.solvedSnapshot.dimensionStatuses[0]!.solvedValue!,
      12,
      1e-4,
      "The edited line gap must reach its authored distance.",
    );
  }

  async function testLineDistanceAdmissionAndStatusShareAngularTolerance() {
    const makeDefinition = (
      angle: number,
      pinned: boolean,
    ): SketchDefinition => {
      const points = [
        makePoint("sketch_point_base_start", "Base start", 0, 0),
        makePoint("sketch_point_base_end", "Base end", 10, 0),
        makePoint("sketch_point_tilted_start", "Tilted start", 0, 2),
        makePoint(
          "sketch_point_tilted_end",
          "Tilted end",
          10 * Math.cos(angle),
          2 + 10 * Math.sin(angle),
        ),
      ];
      const entities = [
        makeLine(
          "sketch_entity_base",
          "Base",
          points[0]!.pointId,
          points[1]!.pointId,
        ),
        makeLine(
          "sketch_entity_tilted",
          "Tilted",
          points[2]!.pointId,
          points[3]!.pointId,
        ),
      ];
      return {
        schemaVersion: "sketch-definition/v1alpha2",
        referenceIds: [],
        references: [],
        points,
        pointIds: points.map((point) => point.pointId),
        entities,
        entityIds: entities.map((entity) => entity.entityId),
        // Pinned endpoints keep the initial angle, so the solved status sees
        // the same non-parallel lines the admission gate saw.
        constraintIds: pinned
          ? points.map((point) => `constraint_pin_${point.pointId}` as const)
          : [],
        constraints: pinned
          ? points.map((point) => ({
              constraintId: `constraint_pin_${point.pointId}` as const,
              kind: "fixPoint" as const,
              label: `Pin ${point.label}`,
              pointId: point.pointId,
              position: point.position,
            }))
          : [],
        dimensionIds: ["dimension_gap"],
        dimensions: [
          {
            dimensionId: "dimension_gap",
            kind: "lineDistance",
            label: "Gap",
            lines: [
              { kind: "localEntity", entityId: entities[0]!.entityId },
              { kind: "localEntity", entityId: entities[1]!.entityId },
            ],
            value: pinned ? 2 : 3,
          },
        ],
      };
    };
    const judge = (
      angle: number,
      policy: SketchSolveTolerancePolicy,
      pinned = false,
    ) => {
      const definition = makeDefinition(angle, pinned);
      let admitted = true;
      try {
        evaluateSketchScalarConstraintForTest({
          tolerances: policy,
          modelingTolerance: 1e-3,
          definition,
          constraintId: "dimension_gap",
          values: getSketchSolveInitialValuesForTest(definition, policy, 1e-3),
        });
      } catch (error) {
        // Only a non-admitted dimension is expected; anything else bubbles.
        if (
          !(error instanceof Error) ||
          error.message !== "Unknown scalar constraint dimension_gap."
        ) {
          throw error;
        }
        admitted = false;
      }
      const status = solveSketchDefinitionCore({
        definition,
        tolerances: policy,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot.dimensionStatuses[0]!;
      return {
        admitted,
        status: status.status,
        solvedValue:
          status.solvedValue === null
            ? null
            : Math.round(status.solvedValue * 1e3) / 1e3,
      };
    };
    // A non-default document policy looser than the former hard-coded 1e-4.
    const documentPolicy = { ...tolerances, angleRadians: 0.01 };
    const loosePolicy = { ...documentPolicy, coincidence: 0.01 };

    expect(
      judge(0.005, documentPolicy),
      "Lines parallel within the policy angle are admitted and driven to the authored distance.",
    ).toEqual({ admitted: true, status: "driving", solvedValue: 3 });
    expect(
      judge(0.005, tolerances),
      "The same lines fall outside a tighter policy angle for both admission and status.",
    ).toEqual({ admitted: false, status: "unsatisfied", solvedValue: null });
    expect(
      judge(0.03, documentPolicy),
      "Lines skewed beyond the policy angle are neither admitted nor reported as driving.",
    ).toEqual({ admitted: false, status: "unsatisfied", solvedValue: null });
    expect(
      judge(0.005, loosePolicy, true),
      "Status keeps measuring lines that stay within the policy angle but beyond 1e-4.",
    ).toEqual({ admitted: true, status: "driving", solvedValue: 2 });
    expect(
      judge(0.03, loosePolicy, true),
      "Pinned lines beyond the policy angle are neither admitted nor measured.",
    ).toEqual({ admitted: false, status: "unsatisfied", solvedValue: null });
  }

  async function testRequirementStatusesUseDocumentLinearAndAngularTolerance() {
    // Default document settings: 1e-3 mm linear, 1e-4 rad angular. Residuals
    // are 0.5·r², so a requirement holds iff |r| ≤ its own tolerance.
    const documentPolicy = createDocumentSolverTolerances({
      modelingTolerance: 1e-3,
      angularToleranceRadians: 1e-4,
    });
    const tau = documentPolicy.coincidence;
    const pin = (pointId: string, position: readonly [number, number]) => ({
      constraintId: `constraint_pin_${pointId}` as const,
      kind: "fixPoint" as const,
      label: `Pin ${pointId}`,
      pointId: pointId as `sketch_point_${string}`,
      position,
    });
    const solve = (
      points: ReturnType<typeof makePoint>[],
      entities: SketchDefinition["entities"],
      requirement: SketchDefinition["constraints"][number],
      dimensions: SketchDefinition["dimensions"] = [],
    ) => {
      const constraints = [
        ...points.map((point) => pin(point.pointId, point.position)),
        requirement,
      ];
      const solved = solveSketchDefinitionCore({
        definition: {
          schemaVersion: "sketch-definition/v1alpha2",
          referenceIds: [],
          references: [],
          points,
          pointIds: points.map((point) => point.pointId),
          entities,
          entityIds: entities.map((entity) => entity.entityId),
          constraints,
          constraintIds: constraints.map((item) => item.constraintId),
          dimensions,
          dimensionIds: dimensions.map((item) => item.dimensionId),
        },
        tolerances: documentPolicy,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot;
      return {
        solveState: solved.status.solveState,
        requirement: solved.constraintStatuses.find(
          (status) => status.constraintId === requirement.constraintId,
        )!.status,
      };
    };

    // Fully pinned lines keep (almost all of) their initial angular error;
    // at length 10 a 1e-3 rad skew solves to ~9.6e-4 rad, inside the linear
    // tolerance but ~10x the angular one. 5e-5 rad solves to ~4.8e-5 rad.
    const pinnedAngular = (
      kind: "parallel" | "perpendicular" | "angle",
      skew: number,
    ) => {
      const base =
        kind === "parallel" ? 0 : kind === "perpendicular" ? Math.PI / 2 : 1;
      const direction = base + skew;
      const origin = kind === "angle" ? [0, 0] : [0, 5];
      const points = [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 10, 0),
        ...(kind === "angle"
          ? []
          : [makePoint("sketch_point_b0", "B0", origin[0]!, origin[1]!)]),
        makePoint(
          "sketch_point_b1",
          "B1",
          origin[0]! + 10 * Math.cos(direction),
          origin[1]! + 10 * Math.sin(direction),
        ),
      ];
      const entities = [
        makeLine("sketch_entity_a", "A", "sketch_point_a0", "sketch_point_a1"),
        makeLine(
          "sketch_entity_b",
          "B",
          kind === "angle" ? "sketch_point_a0" : "sketch_point_b0",
          "sketch_point_b1",
        ),
      ];
      return solve(
        points,
        entities,
        kind === "angle"
          ? {
              constraintId: "constraint_angular",
              kind: "angle",
              label: "Angle",
              pointIds: [
                "sketch_point_a1",
                "sketch_point_b1",
                "sketch_point_a0",
              ],
              valueRadians: base,
            }
          : {
              constraintId: "constraint_angular",
              kind,
              label: kind,
              entityIds: ["sketch_entity_a", "sketch_entity_b"],
            },
      );
    };
    for (const kind of ["parallel", "perpendicular", "angle"] as const) {
      expect(
        pinnedAngular(kind, 1e-3),
        `The ${kind} constraint ~1e-3 rad off is judged against the angular tolerance, not the linear one.`,
      ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
      expect(
        pinnedAngular(kind, 5e-5),
        `The ${kind} constraint within the angular tolerance stays solved.`,
      ).toEqual({ solveState: "solved", requirement: "satisfied" });
    }

    // Two pinned points joined by a coincidence settle at a third of their
    // initial gap, as does each pin: 3.6·τ apart leaves 1.2·τ everywhere,
    // which is outside |r| ≤ τ but inside the former √2·τ slack.
    const pinnedCoincidence = (gap: number) =>
      solve(
        [
          makePoint("sketch_point_a0", "A0", -10, 0),
          makePoint("sketch_point_a1", "A1", 0, 0),
          makePoint("sketch_point_b0", "B0", 3 * gap, 0),
          makePoint("sketch_point_b1", "B1", 3 * gap, 10),
        ],
        [
          makeLine(
            "sketch_entity_a",
            "A",
            "sketch_point_a0",
            "sketch_point_a1",
          ),
          makeLine(
            "sketch_entity_b",
            "B",
            "sketch_point_b0",
            "sketch_point_b1",
          ),
        ],
        {
          constraintId: "constraint_coincident",
          kind: "coincident",
          label: "Coincident",
          pointIds: ["sketch_point_a1", "sketch_point_b0"],
        },
      );
    expect(
      pinnedCoincidence(1.2 * tau),
      "A coincidence left 1.2·τ apart is outside the linear tolerance.",
    ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
    expect(
      pinnedCoincidence(0.9 * tau),
      "A coincidence left 0.9·τ apart is within the linear tolerance.",
    ).toEqual({ solveState: "solved", requirement: "satisfied" });

    // Normal: the contact point is the line start, so the contact term is
    // zero. A skewed pinned line leaves only the direction sine (angular);
    // a pinned radius mismatch of 4·g leaves g on the curve term and on each
    // of the pins and the radius dimension (linear).
    const pinnedNormal = (skew: number, radialGap: number) =>
      solve(
        [
          makePoint("sketch_point_center", "Center", 0, 0),
          makePoint("sketch_point_contact", "Contact", 5 + 4 * radialGap, 0),
          makePoint(
            "sketch_point_far",
            "Far",
            5 + 4 * radialGap + 10 * Math.cos(skew),
            10 * Math.sin(skew),
          ),
        ],
        [
          makeCircle(
            "sketch_entity_circle",
            "Circle",
            "sketch_point_center",
            5,
          ),
          makeLine(
            "sketch_entity_normal",
            "Normal",
            "sketch_point_contact",
            "sketch_point_far",
          ),
        ],
        {
          constraintId: "constraint_normal",
          kind: "normal",
          label: "Normal",
          line: { kind: "localEntity", entityId: "sketch_entity_normal" },
          curve: { kind: "localEntity", entityId: "sketch_entity_circle" },
          point: { kind: "localPoint", pointId: "sketch_point_contact" },
        },
        [
          {
            dimensionId: "dimension_radius",
            kind: "circleRadius",
            label: "Radius",
            entityId: "sketch_entity_circle",
            value: 5,
          },
        ],
      );
    expect(
      pinnedNormal(1e-3, 0),
      "A normal line ~1e-3 rad off radial is judged against the angular tolerance.",
    ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
    expect(
      pinnedNormal(5e-5, 0),
      "A normal line within the angular tolerance stays solved.",
    ).toEqual({ solveState: "solved", requirement: "satisfied" });
    expect(
      pinnedNormal(0, 0.9 * tau),
      "A normal contact 0.9·τ off the curve is judged against the linear tolerance.",
    ).toEqual({ solveState: "solved", requirement: "satisfied" });
    expect(
      pinnedNormal(0, 1.2 * tau),
      "A normal contact 1.2·τ off the curve is outside the linear tolerance.",
    ).toEqual({ solveState: "partiallySolved", requirement: "unsatisfied" });
  }

  async function testLowLossStartsStillSolveUntilEveryRequirementHolds() {
    // A total loss below the solver's 1e-8 short-circuit (or BFGS's 1e-12
    // floor) is not acceptance: one requirement can still be outside its
    // document tolerance, so the solve must continue instead of stopping.
    const twoFreeLines = (
      secondStart: readonly [number, number],
      secondDirection: number,
      requirement: SketchDefinition["constraints"][number],
    ): SketchDefinition => {
      const points = [
        makePoint("sketch_point_a0", "A0", 0, 0),
        makePoint("sketch_point_a1", "A1", 10, 0),
        makePoint("sketch_point_b0", "B0", ...secondStart),
        makePoint(
          "sketch_point_b1",
          "B1",
          secondStart[0] + 10 * Math.cos(secondDirection),
          secondStart[1] + 10 * Math.sin(secondDirection),
        ),
      ];
      const entities = [
        makeLine("sketch_entity_a", "A", "sketch_point_a0", "sketch_point_a1"),
        makeLine("sketch_entity_b", "B", "sketch_point_b0", "sketch_point_b1"),
      ];
      return {
        schemaVersion: "sketch-definition/v1alpha2",
        referenceIds: [],
        references: [],
        points,
        pointIds: points.map((point) => point.pointId),
        entities,
        entityIds: entities.map((entity) => entity.entityId),
        constraints: [requirement],
        constraintIds: [requirement.constraintId],
        dimensions: [],
        dimensionIds: [],
      };
    };
    const parallel: SketchDefinition["constraints"][number] = {
      constraintId: "constraint_parallel",
      kind: "parallel",
      label: "Parallel",
      entityIds: ["sketch_entity_a", "sketch_entity_b"],
    };
    const coincident: SketchDefinition["constraints"][number] = {
      constraintId: "constraint_coincident",
      kind: "coincident",
      label: "Coincident",
      pointIds: ["sketch_point_a1", "sketch_point_b0"],
    };
    const startSession = (
      definition: SketchDefinition,
      policy: SketchSolveTolerancePolicy,
    ) => {
      const snapshot = createCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_low_loss_start",
        program: compileSketchSolveProgram({
          definition,
          tolerances: policy,
          modelingTolerance: 1e-3,
          partialSolvePolicy: "failOnConflict",
        }),
      }).lastAcceptedSnapshot;
      return {
        solveState: snapshot.status.solveState,
        requirement: snapshot.constraintStatuses[0]!.status,
      };
    };
    const defaultPolicy = createDocumentSolverTolerances({
      modelingTolerance: 1e-3,
      angularToleranceRadians: 1e-4,
    });
    const tightPolicy = createDocumentSolverTolerances({
      modelingTolerance: 1e-5,
      angularToleranceRadians: 1e-6,
    });

    // 0.5·(1.2e-4)² = 7.2e-9 < 1e-8, but 1.2e-4 rad > the 1e-4 rad policy.
    expect
      .soft(
        startSession(twoFreeLines([0, 5], 1.2e-4, parallel), defaultPolicy),
        "An interactive session starting 1.2e-4 rad off parallel solves instead of short-circuiting.",
      )
      .toEqual({ solveState: "solved", requirement: "satisfied" });
    // 0.5·(1e-4)² = 5e-9 < 1e-8, but a 1e-4 gap > the 1e-5 linear policy.
    expect
      .soft(
        startSession(twoFreeLines([10 + 1e-4, 0], 1, coincident), tightPolicy),
        "An interactive session starting 1e-4 apart solves under a 1e-5 linear policy.",
      )
      .toEqual({ solveState: "solved", requirement: "satisfied" });

    // BFGS stops at loss < 1e-12 here with ~1.25e-6 rad left, above the
    // 1e-6 rad policy; the Gauss-Newton fallback must still run.
    const fallback = solveSketchDefinitionCore({
      definition: twoFreeLines([0, 5], 0.1, parallel),
      tolerances: tightPolicy,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot;
    expect
      .soft(
        {
          solveState: fallback.status.solveState,
          requirement: fallback.constraintStatuses[0]!.status,
        },
        "A low-loss BFGS result that misses a requirement falls back to Gauss-Newton.",
      )
      .toEqual({ solveState: "solved", requirement: "satisfied" });
  }

  async function testNeverAdmittedLineDimensionsAreUnsatisfied() {
    // Line-distance and line-angle admission is judged at the initial values
    // while status is judged at the solved values; another requirement can
    // close that gap, so a dimension that never entered the solver must not
    // report "driving" against geometry it never drove.
    const solveTwoLines = (input: {
      secondEnd: readonly [number, number];
      constraints: SketchDefinition["constraints"];
      dimension: SketchDefinition["dimensions"][number];
    }) => {
      const points = [
        makePoint("sketch_point_a_start", "A start", 0, 0),
        makePoint("sketch_point_a_end", "A end", 10, 0),
        makePoint("sketch_point_b_start", "B start", 0, 2),
        makePoint("sketch_point_b_end", "B end", ...input.secondEnd),
      ];
      const entities = [
        makeLine(
          "sketch_entity_a",
          "A",
          "sketch_point_a_start",
          "sketch_point_a_end",
        ),
        makeLine(
          "sketch_entity_b",
          "B",
          "sketch_point_b_start",
          "sketch_point_b_end",
        ),
      ];
      const solved = solveSketchDefinitionCore({
        definition: {
          schemaVersion: "sketch-definition/v1alpha2",
          referenceIds: [],
          references: [],
          points,
          pointIds: points.map((point) => point.pointId),
          entities,
          entityIds: entities.map((entity) => entity.entityId),
          constraints: input.constraints,
          constraintIds: input.constraints.map(
            (constraint) => constraint.constraintId,
          ),
          dimensions: [input.dimension],
          dimensionIds: [input.dimension.dimensionId],
        },
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot;
      return {
        solveState: solved.status.solveState,
        constraints: solved.constraintStatuses.map((status) => status.status),
        dimension: solved.dimensionStatuses[0]!.status,
        solvedValue: solved.dimensionStatuses[0]!.solvedValue,
      };
    };
    const lines = [
      { kind: "localEntity", entityId: "sketch_entity_a" },
      { kind: "localEntity", entityId: "sketch_entity_b" },
    ] as const;
    const parallel: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_parallel",
        kind: "parallel",
        label: "Parallel",
        entityIds: ["sketch_entity_a", "sketch_entity_b"],
      },
    ];
    const gap: SketchDefinition["dimensions"][number] = {
      dimensionId: "dimension_gap",
      kind: "lineDistance",
      label: "Gap",
      lines: [...lines],
      value: 3,
    };

    const admittedGap = solveTwoLines({
      secondEnd: [10, 2],
      constraints: parallel,
      dimension: gap,
    });
    expect(
      admittedGap,
      "Lines that start parallel admit the gap, which drives them to its value.",
    ).toMatchObject({
      solveState: "solved",
      constraints: ["satisfied"],
      dimension: "driving",
    });
    assertClose(
      admittedGap.solvedValue!,
      3,
      1e-6,
      "An admitted line gap must reach its authored distance.",
    );

    const skewAngle = 0.03;
    const skewedGap = solveTwoLines({
      secondEnd: [10 * Math.cos(skewAngle), 2 + 10 * Math.sin(skewAngle)],
      constraints: parallel,
      dimension: gap,
    });
    expect(
      skewedGap,
      "Lines that start skewed never admit the gap; a parallel constraint making them parallel must not turn it into a driving dimension.",
    ).toMatchObject({
      solveState: "partiallySolved",
      constraints: ["satisfied"],
      dimension: "unsatisfied",
    });
    expect(
      Math.abs(skewedGap.solvedValue! - 3),
      "The never-enforced gap keeps its measured value, which differs from the authored one.",
    ).toBeGreaterThan(0.1);

    // Lines that start parallel never admit an angle dimension; pinning the
    // second line vertical must not make the pi/4 angle read as driving at pi/2.
    const pinnedVertical: SketchDefinition["constraints"] = (
      [
        ["sketch_point_b_start", [0, 2]],
        ["sketch_point_b_end", [0, 12]],
      ] as const
    ).map(([pointId, position]) => ({
      constraintId: `constraint_pin_${pointId}` as const,
      kind: "fixPoint" as const,
      label: `Pin ${pointId}`,
      pointId,
      position,
    }));
    const parallelAngle = solveTwoLines({
      secondEnd: [10, 2],
      constraints: pinnedVertical,
      dimension: {
        dimensionId: "dimension_angle",
        kind: "lineAngle",
        label: "Angle",
        lines: [...lines],
        valueRadians: Math.PI / 4,
      },
    });
    expect(
      parallelAngle,
      "An angle dimension that was never admitted must be unsatisfied even when other requirements rotate the lines apart.",
    ).toMatchObject({
      solveState: "partiallySolved",
      constraints: ["satisfied", "satisfied"],
      dimension: "unsatisfied",
    });
    assertClose(
      parallelAngle.solvedValue!,
      Math.PI / 2,
      1e-9,
      "The never-enforced angle keeps its measured value.",
    );
  }

  async function testExpandedDimensionStatuses() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_circle_center",
        "sketch_point_arc_center",
        "sketch_point_arc_start",
        "sketch_point_arc_end",
        "sketch_point_l1a",
        "sketch_point_l1b",
        "sketch_point_l2a",
        "sketch_point_l2b",
        "sketch_point_l3a",
        "sketch_point_l3b",
        "sketch_point_free",
      ],
      points: [
        makePoint("sketch_point_circle_center", "Circle center", 0, 0),
        makePoint("sketch_point_arc_center", "Arc center", 20, 0),
        makePoint("sketch_point_arc_start", "Arc start", 25, 0),
        makePoint("sketch_point_arc_end", "Arc end", 20, 5),
        makePoint("sketch_point_l1a", "L1A", 0, 0),
        makePoint("sketch_point_l1b", "L1B", 10, 0),
        makePoint("sketch_point_l2a", "L2A", 0, 4),
        makePoint("sketch_point_l2b", "L2B", 10, 4),
        makePoint("sketch_point_l3a", "L3A", 0, 0),
        makePoint("sketch_point_l3b", "L3B", 0, 10),
        makePoint("sketch_point_free", "Free point", 5, 3),
      ],
      entityIds: [
        "sketch_entity_circle",
        "sketch_entity_arc",
        "sketch_entity_l1",
        "sketch_entity_l2",
        "sketch_entity_l3",
      ],
      entities: [
        makeCircle(
          "sketch_entity_circle",
          "Circle",
          "sketch_point_circle_center",
          5,
        ),
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_arc_center",
          "sketch_point_arc_start",
          "sketch_point_arc_end",
        ),
        makeLine(
          "sketch_entity_l1",
          "Line 1",
          "sketch_point_l1a",
          "sketch_point_l1b",
        ),
        makeLine(
          "sketch_entity_l2",
          "Line 2",
          "sketch_point_l2a",
          "sketch_point_l2b",
        ),
        makeLine(
          "sketch_entity_l3",
          "Line 3",
          "sketch_point_l3a",
          "sketch_point_l3b",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [
        "dimension_diameter_circle",
        "dimension_diameter_arc",
        "dimension_line_distance",
        "dimension_line_point",
        "dimension_line_angle",
        "dimension_invalid_line_distance",
      ],
      dimensions: [
        {
          dimensionId: "dimension_diameter_circle",
          kind: "diameter",
          label: "Circle diameter",
          entityId: "sketch_entity_circle",
          value: 10,
        },
        {
          dimensionId: "dimension_diameter_arc",
          kind: "diameter",
          label: "Arc diameter",
          entityId: "sketch_entity_arc",
          value: 10,
        },
        {
          dimensionId: "dimension_line_distance",
          kind: "lineDistance",
          label: "Line distance",
          lines: [
            { kind: "localEntity", entityId: "sketch_entity_l1" },
            { kind: "localEntity", entityId: "sketch_entity_l2" },
          ],
          value: 4,
        },
        {
          dimensionId: "dimension_line_point",
          kind: "linePointDistance",
          label: "Line point",
          line: { kind: "localEntity", entityId: "sketch_entity_l1" },
          point: { kind: "localPoint", pointId: "sketch_point_free" },
          value: 3,
        },
        {
          dimensionId: "dimension_line_angle",
          kind: "lineAngle",
          label: "Line angle",
          lines: [
            { kind: "localEntity", entityId: "sketch_entity_l1" },
            { kind: "localEntity", entityId: "sketch_entity_l3" },
          ],
          valueRadians: Math.PI / 2,
        },
        {
          dimensionId: "dimension_invalid_line_distance",
          kind: "lineDistance",
          label: "Invalid line distance",
          lines: [
            { kind: "localEntity", entityId: "sketch_entity_l1" },
            { kind: "localEntity", entityId: "sketch_entity_l3" },
          ],
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
    const statusById = new Map(
      solved.solvedSnapshot.dimensionStatuses.map((status) => [
        status.dimensionId,
        status,
      ]),
    );
    assertClose(
      statusById.get("dimension_diameter_circle")?.solvedValue ?? 0,
      10,
      1e-6,
      "Circle diameter should report solved diameter.",
    );
    assertClose(
      statusById.get("dimension_diameter_arc")?.solvedValue ?? 0,
      10,
      1e-4,
      "Arc diameter should report solved diameter.",
    );
    assertClose(
      statusById.get("dimension_line_distance")?.solvedValue ?? 0,
      4,
      1e-4,
      "Line distance should report perpendicular distance.",
    );
    assertClose(
      statusById.get("dimension_line_point")?.solvedValue ?? 0,
      3,
      1e-4,
      "Line-point dimension should report perpendicular distance.",
    );
    assertClose(
      statusById.get("dimension_line_angle")?.solvedValue ?? 0,
      Math.PI / 2,
      1e-4,
      "Line angle should report enclosed angle.",
    );
    expect(
      statusById.get("dimension_invalid_line_distance")?.status,
      "A line distance dimension between non-parallel lines should remain unsatisfied instead of becoming an angle dimension.",
    ).toBe("unsatisfied");
  }

  async function testAxisQualifiedDistance() {
    const horizontal: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_axis_horizontal"],
      dimensions: [
        {
          dimensionId: "dimension_axis_horizontal",
          kind: "distance",
          label: "Width",
          axis: "horizontal",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 3,
        },
      ],
    };
    const vertical: SketchDefinition = {
      ...horizontal,
      dimensionIds: ["dimension_axis_vertical"],
      dimensions: [
        {
          dimensionId: "dimension_axis_vertical",
          kind: "distance",
          label: "Height",
          axis: "vertical",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 4,
        },
      ],
    };

    const solvedHorizontal = solveSketchDefinitionCore({
      definition: horizontal,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const [horizontalA, horizontalB] =
      solvedHorizontal.solvedSnapshot.solvedPoints;
    expect(
      horizontalA !== undefined && horizontalB !== undefined,
      "Expected solved horizontal point pair.",
    ).toBeTruthy();
    assertClose(
      horizontalB.solvedPosition[0] - horizontalA.solvedPosition[0],
      3,
      1e-4,
      "Axis-qualified horizontal distance should solve to 3.",
    );
    assertGradientMatchesFiniteDifference(
      horizontal,
      "dimension_axis_horizontal",
      1e-6,
    );

    const solvedVertical = solveSketchDefinitionCore({
      definition: vertical,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const [verticalA, verticalB] = solvedVertical.solvedSnapshot.solvedPoints;
    expect(
      verticalA !== undefined && verticalB !== undefined,
      "Expected solved vertical point pair.",
    ).toBeTruthy();
    assertClose(
      verticalB.solvedPosition[1] - verticalA.solvedPosition[1],
      4,
      1e-4,
      "Axis-qualified vertical distance should solve to 4.",
    );
    assertGradientMatchesFiniteDifference(
      vertical,
      "dimension_axis_vertical",
      1e-6,
    );
  }

  async function testObtuseLineAngleDimension() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 0, 10),
        makePoint("sketch_point_c", "C", 7, 14),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_bc"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
      ],
      constraintIds: ["constraint_fix_a", "constraint_fix_b"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [0, 0],
        },
        {
          constraintId: "constraint_fix_b",
          kind: "fixPoint",
          label: "Fix B",
          pointId: "sketch_point_b",
          position: [0, 10],
        },
      ],
      dimensionIds: ["dimension_bc_length", "dimension_obtuse_angle"],
      dimensions: [
        {
          dimensionId: "dimension_bc_length",
          kind: "lineLength",
          label: "BC length",
          entityId: "sketch_entity_bc",
          value: 10,
        },
        {
          dimensionId: "dimension_obtuse_angle",
          kind: "lineAngle",
          label: "Obtuse angle",
          lines: [
            { kind: "localEntity", entityId: "sketch_entity_ab" },
            { kind: "localEntity", entityId: "sketch_entity_bc" },
          ],
          valueRadians: (120 * Math.PI) / 180,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const pointC = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_c",
    );
    const angleStatus = solved.solvedSnapshot.dimensionStatuses.find(
      (status) => status.dimensionId === "dimension_obtuse_angle",
    );

    expect(
      solved.status.solveState,
      "Obtuse line-angle dimensions should remain solvable.",
    ).toBe("solved");
    expect(
      solved.status.constraintState,
      "Obtuse line-angle dimensions should not be classified as over-constrained.",
    ).not.toBe("overConstrained");
    expect(
      pointC,
      "Expected solved endpoint for the obtuse-angle fixture.",
    ).toBeTruthy();
    assertClose(
      pointC.solvedPosition[0],
      8.660254037844387,
      1e-4,
      "Obtuse line-angle solve should place the free endpoint on the expected branch.",
    );
    assertClose(
      pointC.solvedPosition[1],
      15,
      1e-4,
      "Obtuse line-angle solve should preserve the requested line length.",
    );
    assertClose(
      angleStatus?.solvedValue ?? 0,
      (120 * Math.PI) / 180,
      1e-4,
      "Obtuse line-angle dimensions should report their solved angle in radians.",
    );
  }

  async function testHorizontalLine() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 3, 4),
        makePoint("sketch_point_b", "B", 5, 6),
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
      constraintIds: ["constraint_horizontal"],
      constraints: [
        {
          constraintId: "constraint_horizontal",
          kind: "horizontal",
          label: "Horizontal",
          entityId: "sketch_entity_line",
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved line endpoints.",
    ).toBeTruthy();
    expect(
      Math.abs(b.solvedPosition[1] - a.solvedPosition[1]) < 1e-6,
      "Horizontal line should end with zero y delta.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_horizontal",
      1e-6,
    );
  }

  async function testVerticalLine() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 3, 4),
        makePoint("sketch_point_b", "B", 5, 6),
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
      constraintIds: ["constraint_vertical"],
      constraints: [
        {
          constraintId: "constraint_vertical",
          kind: "vertical",
          label: "Vertical",
          entityId: "sketch_entity_line",
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const [a, b] = solved.solvedSnapshot.solvedPoints;
    expect(
      a !== undefined && b !== undefined,
      "Expected solved line endpoints.",
    ).toBeTruthy();
    expect(
      Math.abs(b.solvedPosition[0] - a.solvedPosition[0]) < 1e-6,
      "Vertical line should end with zero x delta.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_vertical",
      1e-6,
    );
  }

  async function testAngleBetweenPoints() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_m"],
      points: [
        makePoint("sketch_point_a", "A", 1, 0),
        makePoint("sketch_point_b", "B", 0, 1),
        makePoint("sketch_point_m", "M", 0, 0),
      ],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_angle"],
      constraints: [
        {
          constraintId: "constraint_angle",
          kind: "angle",
          label: "Angle",
          pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_m"],
          valueRadians: Math.PI / 4,
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const pointA = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_a",
    );
    const pointB = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_b",
    );
    const pointM = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_m",
    );
    expect(
      pointA && pointB && pointM,
      "Expected solved angle points.",
    ).toBeTruthy();
    const d1x = pointA.solvedPosition[0] - pointM.solvedPosition[0];
    const d1y = pointA.solvedPosition[1] - pointM.solvedPosition[1];
    const d2x = pointB.solvedPosition[0] - pointM.solvedPosition[0];
    const d2y = pointB.solvedPosition[1] - pointM.solvedPosition[1];
    const angle = Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (d1x * d2x + d1y * d2y) /
            (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)),
        ),
      ),
    );
    expect(
      Math.abs(angle - Math.PI / 4) < 1e-4,
      "Angle should solve to PI/4.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(definition, "constraint_angle", 1e-6);
  }

  async function testAngleBetweenPointsSpecificCase() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_m"],
      points: [
        makePoint(
          "sketch_point_a",
          "A",
          0.7805516932908316,
          -0.00782612334736288,
        ),
        makePoint(
          "sketch_point_b",
          "B",
          1.22103191002294,
          0.004601914768224987,
        ),
        makePoint(
          "sketch_point_m",
          "M",
          0.013589691730458502,
          -0.10039941813640837,
        ),
      ],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_angle_specific"],
      constraints: [
        {
          constraintId: "constraint_angle_specific",
          kind: "angle",
          label: "Specific angle case",
          pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_m"],
          valueRadians: Math.PI / 2,
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const pointA = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_a",
    );
    const pointB = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_b",
    );
    const pointM = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === "sketch_point_m",
    );
    expect(
      pointA && pointB && pointM,
      "Expected solved points for specific angle case.",
    ).toBeTruthy();
    const d1x = pointA.solvedPosition[0] - pointM.solvedPosition[0];
    const d1y = pointA.solvedPosition[1] - pointM.solvedPosition[1];
    const d2x = pointB.solvedPosition[0] - pointM.solvedPosition[0];
    const d2y = pointB.solvedPosition[1] - pointM.solvedPosition[1];
    const angle = Math.acos(
      Math.max(
        -1,
        Math.min(
          1,
          (d1x * d2x + d1y * d2y) /
            (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)),
        ),
      ),
    );
    expect(
      Math.abs(angle - Math.PI / 2) < 1e-3,
      "Specific angle case should solve to PI/2.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_angle_specific",
      1e-4,
    );
  }

  async function testEqualLength() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a1",
        "sketch_point_a2",
        "sketch_point_b1",
        "sketch_point_b2",
      ],
      points: [
        makePoint("sketch_point_a1", "A1", 3, 4),
        makePoint("sketch_point_a2", "A2", 5, 6),
        makePoint("sketch_point_b1", "B1", 0, 4),
        makePoint("sketch_point_b2", "B2", 10, 6),
      ],
      entityIds: ["sketch_entity_a", "sketch_entity_b"],
      entities: [
        makeLine(
          "sketch_entity_a",
          "Line A",
          "sketch_point_a1",
          "sketch_point_a2",
        ),
        makeLine(
          "sketch_entity_b",
          "Line B",
          "sketch_point_b1",
          "sketch_point_b2",
        ),
      ],
      constraintIds: ["constraint_equal_length"],
      constraints: [
        {
          constraintId: "constraint_equal_length",
          kind: "equalLength",
          label: "Equal length",
          entityIds: ["sketch_entity_a", "sketch_entity_b"],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
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
    const lenA = Math.hypot(
      points.get("sketch_point_a2")![0] - points.get("sketch_point_a1")![0],
      points.get("sketch_point_a2")![1] - points.get("sketch_point_a1")![1],
    );
    const lenB = Math.hypot(
      points.get("sketch_point_b2")![0] - points.get("sketch_point_b1")![0],
      points.get("sketch_point_b2")![1] - points.get("sketch_point_b1")![1],
    );
    expect(
      Math.abs(lenA - lenB) < 1e-4,
      "Equal-length constraint should equalize solved line lengths.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_equal_length",
      1e-6,
    );
  }

  async function testParallelLines() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a1",
        "sketch_point_a2",
        "sketch_point_b1",
        "sketch_point_b2",
      ],
      points: [
        makePoint("sketch_point_a1", "A1", 3, 4),
        makePoint("sketch_point_a2", "A2", 5, 6),
        makePoint("sketch_point_b1", "B1", 0, 4),
        makePoint("sketch_point_b2", "B2", 5, 6),
      ],
      entityIds: ["sketch_entity_a", "sketch_entity_b"],
      entities: [
        makeLine(
          "sketch_entity_a",
          "Line A",
          "sketch_point_a1",
          "sketch_point_a2",
        ),
        makeLine(
          "sketch_entity_b",
          "Line B",
          "sketch_point_b1",
          "sketch_point_b2",
        ),
      ],
      constraintIds: ["constraint_parallel"],
      constraints: [
        {
          constraintId: "constraint_parallel",
          kind: "parallel",
          label: "Parallel",
          entityIds: ["sketch_entity_a", "sketch_entity_b"],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
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
    const ax =
      points.get("sketch_point_a2")![0] - points.get("sketch_point_a1")![0];
    const ay =
      points.get("sketch_point_a2")![1] - points.get("sketch_point_a1")![1];
    const bx =
      points.get("sketch_point_b2")![0] - points.get("sketch_point_b1")![0];
    const by =
      points.get("sketch_point_b2")![1] - points.get("sketch_point_b1")![1];
    const cross = ax * by - ay * bx;
    expect(
      Math.abs(cross) < 1e-4,
      "Parallel constraint should drive the line cross product to zero.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_parallel",
      1e-6,
    );
  }

  async function testPerpendicularLines() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a1",
        "sketch_point_a2",
        "sketch_point_b1",
        "sketch_point_b2",
      ],
      points: [
        makePoint("sketch_point_a1", "A1", 3, 4),
        makePoint("sketch_point_a2", "A2", 5, 6),
        makePoint("sketch_point_b1", "B1", 0, 4),
        makePoint("sketch_point_b2", "B2", 5, 6),
      ],
      entityIds: ["sketch_entity_a", "sketch_entity_b"],
      entities: [
        makeLine(
          "sketch_entity_a",
          "Line A",
          "sketch_point_a1",
          "sketch_point_a2",
        ),
        makeLine(
          "sketch_entity_b",
          "Line B",
          "sketch_point_b1",
          "sketch_point_b2",
        ),
      ],
      constraintIds: ["constraint_perpendicular"],
      constraints: [
        {
          constraintId: "constraint_perpendicular",
          kind: "perpendicular",
          label: "Perpendicular",
          entityIds: ["sketch_entity_a", "sketch_entity_b"],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };

    const solved = solveSketchDefinitionCore({
      definition,
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
    const ax =
      points.get("sketch_point_a2")![0] - points.get("sketch_point_a1")![0];
    const ay =
      points.get("sketch_point_a2")![1] - points.get("sketch_point_a1")![1];
    const bx =
      points.get("sketch_point_b2")![0] - points.get("sketch_point_b1")![0];
    const by =
      points.get("sketch_point_b2")![1] - points.get("sketch_point_b1")![1];
    const dot = ax * bx + ay * by;
    expect(
      Math.abs(dot) < 1e-2,
      "Perpendicular constraint should drive the line dot product near zero.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_perpendicular",
      1e-6,
    );
  }

  async function testArcStartPointCoincident() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_center",
        "sketch_point_arc_start",
        "sketch_point_arc_end",
        "sketch_point_line_start",
        "sketch_point_line_end",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_arc_start", "Arc start", 1, 0),
        makePoint("sketch_point_arc_end", "Arc end", -1, 0),
        makePoint("sketch_point_line_start", "Line start", 3, 4),
        makePoint("sketch_point_line_end", "Line end", 5, 6),
      ],
      entityIds: ["sketch_entity_arc", "sketch_entity_line"],
      entities: [
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_center",
          "sketch_point_arc_start",
          "sketch_point_arc_end",
        ),
        makeLine(
          "sketch_entity_line",
          "Line",
          "sketch_point_line_start",
          "sketch_point_line_end",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_arc_start_coincident"],
      dimensions: [
        {
          dimensionId: "dimension_arc_start_coincident",
          kind: "arcStartPointCoincident",
          label: "Arc start coincident",
          entityId: "sketch_entity_arc",
          pointId: "sketch_point_line_end",
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const arc = solved.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === "sketch_entity_arc",
    );
    const point = solved.solvedSnapshot.solvedPoints.find(
      (entry) => entry.pointId === "sketch_point_line_end",
    );
    expect(
      arc?.kind === "arc" && point,
      "Expected solved arc and endpoint point.",
    ).toBeTruthy();
    expect(
      Math.hypot(
        arc.startPosition[0] - point.solvedPosition[0],
        arc.startPosition[1] - point.solvedPosition[1],
      ) < 1e-4,
      "Arc start coincidence should match the referenced point.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_arc_start_coincident",
      1e-5,
    );
  }

  async function testArcEndPointCoincident() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_center",
        "sketch_point_arc_start",
        "sketch_point_arc_end",
        "sketch_point_line_start",
        "sketch_point_line_end",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_arc_start", "Arc start", 1, 0),
        makePoint("sketch_point_arc_end", "Arc end", -1, 0),
        makePoint("sketch_point_line_start", "Line start", 3, 4),
        makePoint("sketch_point_line_end", "Line end", 5, 6),
      ],
      entityIds: ["sketch_entity_arc", "sketch_entity_line"],
      entities: [
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_center",
          "sketch_point_arc_start",
          "sketch_point_arc_end",
        ),
        makeLine(
          "sketch_entity_line",
          "Line",
          "sketch_point_line_start",
          "sketch_point_line_end",
        ),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_arc_end_coincident"],
      dimensions: [
        {
          dimensionId: "dimension_arc_end_coincident",
          kind: "arcEndPointCoincident",
          label: "Arc end coincident",
          entityId: "sketch_entity_arc",
          pointId: "sketch_point_line_start",
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const arc = solved.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === "sketch_entity_arc",
    );
    const point = solved.solvedSnapshot.solvedPoints.find(
      (entry) => entry.pointId === "sketch_point_line_start",
    );
    expect(
      arc?.kind === "arc" && point,
      "Expected solved arc and endpoint point.",
    ).toBeTruthy();
    expect(
      Math.hypot(
        arc.endPosition[0] - point.solvedPosition[0],
        arc.endPosition[1] - point.solvedPosition[1],
      ) < 1e-4,
      "Arc end coincidence should match the referenced point.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_arc_end_coincident",
      1e-5,
    );
  }

  async function testAxisAlignedRectangle() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 0.2, 0),
        makePoint("sketch_point_c", "C", 0.2, 0.2),
        makePoint("sketch_point_d", "D", 0, 0.2),
      ],
      entityIds: [
        "sketch_entity_line_a",
        "sketch_entity_line_b",
        "sketch_entity_line_c",
        "sketch_entity_line_d",
      ],
      entities: [
        makeLine(
          "sketch_entity_line_a",
          "A-B",
          "sketch_point_a",
          "sketch_point_b",
        ),
        makeLine(
          "sketch_entity_line_b",
          "B-C",
          "sketch_point_b",
          "sketch_point_c",
        ),
        makeLine(
          "sketch_entity_line_c",
          "C-D",
          "sketch_point_c",
          "sketch_point_d",
        ),
        makeLine(
          "sketch_entity_line_d",
          "D-A",
          "sketch_point_d",
          "sketch_point_a",
        ),
      ],
      constraintIds: [
        "constraint_fix_a",
        "constraint_horizontal_a",
        "constraint_horizontal_c",
        "constraint_vertical_b",
        "constraint_vertical_d",
      ],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [0, 0],
        },
        {
          constraintId: "constraint_horizontal_a",
          kind: "horizontal",
          label: "Horizontal A",
          entityId: "sketch_entity_line_a",
        },
        {
          constraintId: "constraint_horizontal_c",
          kind: "horizontal",
          label: "Horizontal C",
          entityId: "sketch_entity_line_c",
        },
        {
          constraintId: "constraint_vertical_b",
          kind: "vertical",
          label: "Vertical B",
          entityId: "sketch_entity_line_b",
        },
        {
          constraintId: "constraint_vertical_d",
          kind: "vertical",
          label: "Vertical D",
          entityId: "sketch_entity_line_d",
        },
      ],
      dimensionIds: ["dimension_width", "dimension_height"],
      dimensions: [
        {
          dimensionId: "dimension_width",
          kind: "horizontalDistance",
          label: "Width",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 2,
        },
        {
          dimensionId: "dimension_height",
          kind: "verticalDistance",
          label: "Height",
          pointIds: ["sketch_point_a", "sketch_point_d"],
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
    const coords = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(coords.has("sketch_point_a"), "Expected A.").toBeTruthy();
    expect(coords.has("sketch_point_b"), "Expected B.").toBeTruthy();
    expect(coords.has("sketch_point_c"), "Expected C.").toBeTruthy();
    expect(coords.has("sketch_point_d"), "Expected D.").toBeTruthy();
    const a = coords.get("sketch_point_a")!;
    const b = coords.get("sketch_point_b")!;
    const c = coords.get("sketch_point_c")!;
    const d = coords.get("sketch_point_d")!;
    expect(
      Math.hypot(a[0] - 0, a[1] - 0) < 1e-5,
      "A should solve to origin.",
    ).toBeTruthy();
    expect(
      Math.hypot(b[0] - 2, b[1] - 0) < 1e-4,
      "B should solve to (2,0).",
    ).toBeTruthy();
    expect(
      Math.hypot(c[0] - 2, c[1] - 3) < 1e-4,
      "C should solve to (2,3).",
    ).toBeTruthy();
    expect(
      Math.hypot(d[0] - 0, d[1] - 3) < 1e-4,
      "D should solve to (0,3).",
    ).toBeTruthy();
  }

  async function testRotatedRectangle() {
    await assertRotatedRectangleSolvesWithStrategy("bfgs", {
      expectedSolveState: "solved",
      branchTolerance: 1e-5,
      dimensionTolerance: 1e-4,
    });
  }

  async function testProjectedDatumConstraintSeedsLogoReferenceImageAnchorTranslation() {
    const anchor2 =
      "sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2";
    const baseDefinition = createLogoReferenceImageAnchorFixture();
    const anchoredDefinition: SketchDefinition = {
      ...baseDefinition,
      constraintIds: [
        ...baseDefinition.constraintIds,
        "constraint_reference_image_anchor_2_origin",
      ],
      constraints: [
        ...baseDefinition.constraints,
        {
          constraintId: "constraint_reference_image_anchor_2_origin",
          kind: "coincidentProjectedPoint",
          label: "Anchor 2 at origin",
          point: {
            kind: "localPoint",
            pointId: anchor2,
          },
          projectedPoint: {
            kind: "sketchDatum",
            datum: "origin",
          },
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition: anchoredDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      strategy: "bfgs",
    });
    const anchor = solved.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === anchor2,
    );

    expect(
      solved.status.solveState,
      "Logo-like anchor-to-origin constraint should solve.",
    ).toBe("solved");
    expect(anchor, "Expected solved reference image anchor.").not.toBe(
      undefined,
    );
    assertClose(
      anchor.solvedPosition[0],
      0,
      1e-5,
      "Reference image anchor should solve to origin x.",
    );
    assertClose(
      anchor.solvedPosition[1],
      0,
      1e-5,
      "Reference image anchor should solve to origin y.",
    );
    expect(
      solved.solvedSnapshot.constraintStatuses.every(
        (status) => status.status === "satisfied",
      ),
      "All logo-like fixture constraints should remain satisfied after anchor-to-origin solve.",
    ).toBeTruthy();
    expect(
      solved.solvedSnapshot.dimensionStatuses.every(
        (status) => status.status !== "unsatisfied",
      ),
      "All logo-like fixture dimensions should remain satisfied after anchor-to-origin solve.",
    ).toBeTruthy();
  }

  async function assertRotatedRectangleSolvesWithStrategy(
    strategy: SketchSolveStrategy,
    options: {
      expectedSolveState: "solved" | "partiallySolved";
      branchTolerance: number;
      dimensionTolerance: number;
    },
  ) {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_reference",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0.1),
        makePoint("sketch_point_b", "B", 0.3, 0),
        makePoint("sketch_point_c", "C", 0.3, 0.3),
        makePoint("sketch_point_d", "D", 0.1, 0.3),
        makePoint("sketch_point_reference", "R", 1, 0),
      ],
      entityIds: [
        "sketch_entity_line_a",
        "sketch_entity_line_b",
        "sketch_entity_line_c",
        "sketch_entity_line_d",
      ],
      entities: [
        makeLine(
          "sketch_entity_line_a",
          "A-B",
          "sketch_point_a",
          "sketch_point_b",
        ),
        makeLine(
          "sketch_entity_line_b",
          "B-C",
          "sketch_point_b",
          "sketch_point_c",
        ),
        makeLine(
          "sketch_entity_line_c",
          "C-D",
          "sketch_point_c",
          "sketch_point_d",
        ),
        makeLine(
          "sketch_entity_line_d",
          "D-A",
          "sketch_point_d",
          "sketch_point_a",
        ),
      ],
      constraintIds: [
        "constraint_fix_a",
        "constraint_fix_reference",
        "constraint_perpendicular_ab",
        "constraint_perpendicular_bc",
        "constraint_perpendicular_cd",
        "constraint_angle",
      ],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [0, 0],
        },
        {
          constraintId: "constraint_fix_reference",
          kind: "fixPoint",
          label: "Fix reference",
          pointId: "sketch_point_reference",
          position: [1, 0],
        },
        {
          constraintId: "constraint_perpendicular_ab",
          kind: "perpendicular",
          label: "AB perpendicular BC",
          entityIds: ["sketch_entity_line_a", "sketch_entity_line_b"],
        },
        {
          constraintId: "constraint_perpendicular_bc",
          kind: "perpendicular",
          label: "BC perpendicular CD",
          entityIds: ["sketch_entity_line_b", "sketch_entity_line_c"],
        },
        {
          constraintId: "constraint_perpendicular_cd",
          kind: "perpendicular",
          label: "CD perpendicular DA",
          entityIds: ["sketch_entity_line_c", "sketch_entity_line_d"],
        },
        {
          constraintId: "constraint_angle",
          kind: "angle",
          label: "Reference angle",
          pointIds: [
            "sketch_point_reference",
            "sketch_point_b",
            "sketch_point_a",
          ],
          valueRadians: Math.PI / 4,
        },
      ],
      dimensionIds: ["dimension_ab", "dimension_ad"],
      dimensions: [
        {
          dimensionId: "dimension_ab",
          kind: "distance",
          label: "AB",
          axis: "aligned",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 2,
        },
        {
          dimensionId: "dimension_ad",
          kind: "distance",
          label: "AD",
          axis: "aligned",
          pointIds: ["sketch_point_a", "sketch_point_d"],
          value: 3,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      strategy,
    });
    const coords = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const a = coords.get("sketch_point_a");
    const b = coords.get("sketch_point_b");
    const d = coords.get("sketch_point_d");
    const reference = coords.get("sketch_point_reference");
    expect(
      a && b && d && reference,
      `Expected solved rotated-rectangle anchors for ${strategy}.`,
    ).toBeTruthy();
    expect(
      solved.status.solveState,
      `Rotated rectangle should report ${options.expectedSolveState} for ${strategy}.`,
    ).toBe(options.expectedSolveState);
    assertRotatedRectangleMatchesIsotopeBranches(
      solved,
      strategy,
      options.branchTolerance,
    );
    assertClose(
      Math.hypot(b[0] - a[0], b[1] - a[1]),
      2,
      options.dimensionTolerance,
      `AB should solve to length 2 for ${strategy}.`,
    );
    assertClose(
      Math.hypot(d[0] - a[0], d[1] - a[1]),
      3,
      options.dimensionTolerance,
      `AD should solve to length 3 for ${strategy}.`,
    );
  }

  async function testRotatedRectangleGradientDescent() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 0.2, 0),
        makePoint("sketch_point_c", "C", 0.2, 0.2),
        makePoint("sketch_point_d", "D", 0, 0.2),
      ],
      entityIds: [
        "sketch_entity_line_a",
        "sketch_entity_line_b",
        "sketch_entity_line_c",
        "sketch_entity_line_d",
      ],
      entities: [
        makeLine(
          "sketch_entity_line_a",
          "A-B",
          "sketch_point_a",
          "sketch_point_b",
        ),
        makeLine(
          "sketch_entity_line_b",
          "B-C",
          "sketch_point_b",
          "sketch_point_c",
        ),
        makeLine(
          "sketch_entity_line_c",
          "C-D",
          "sketch_point_c",
          "sketch_point_d",
        ),
        makeLine(
          "sketch_entity_line_d",
          "D-A",
          "sketch_point_d",
          "sketch_point_a",
        ),
      ],
      constraintIds: [
        "constraint_fix_a",
        "constraint_horizontal_a",
        "constraint_horizontal_c",
        "constraint_vertical_b",
        "constraint_vertical_d",
      ],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [0, 0],
        },
        {
          constraintId: "constraint_horizontal_a",
          kind: "horizontal",
          label: "Horizontal A",
          entityId: "sketch_entity_line_a",
        },
        {
          constraintId: "constraint_horizontal_c",
          kind: "horizontal",
          label: "Horizontal C",
          entityId: "sketch_entity_line_c",
        },
        {
          constraintId: "constraint_vertical_b",
          kind: "vertical",
          label: "Vertical B",
          entityId: "sketch_entity_line_b",
        },
        {
          constraintId: "constraint_vertical_d",
          kind: "vertical",
          label: "Vertical D",
          entityId: "sketch_entity_line_d",
        },
      ],
      dimensionIds: ["dimension_width", "dimension_height"],
      dimensions: [
        {
          dimensionId: "dimension_width",
          kind: "horizontalDistance",
          label: "Width",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 2,
        },
        {
          dimensionId: "dimension_height",
          kind: "verticalDistance",
          label: "Height",
          pointIds: ["sketch_point_a", "sketch_point_d"],
          value: 3,
        },
      ],
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      strategy: "gradientDescent",
    });
    const coords = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const a = coords.get("sketch_point_a");
    const b = coords.get("sketch_point_b");
    const c = coords.get("sketch_point_c");
    const d = coords.get("sketch_point_d");
    expect(
      a && b && c && d,
      "Expected solved axis-aligned rectangle anchors for gradient descent.",
    ).toBeTruthy();
    expect(
      solved.status.solveState,
      "Gradient descent should solve the axis-aligned rectangle fixture.",
    ).toBe("solved");
    expect(
      Math.hypot(a[0] - 0, a[1] - 0) < 1e-5,
      "Gradient descent should keep A at the origin.",
    ).toBeTruthy();
    expect(
      Math.hypot(b[0] - 2, b[1] - 0) < 1e-4,
      "Gradient descent should solve B to (2,0).",
    ).toBeTruthy();
    expect(
      Math.hypot(c[0] - 2, c[1] - 3) < 1e-4,
      "Gradient descent should solve C to (2,3).",
    ).toBeTruthy();
    expect(
      Math.hypot(d[0] - 0, d[1] - 3) < 1e-4,
      "Gradient descent should solve D to (0,3).",
    ).toBeTruthy();
  }

  async function testRotatedRectangleGaussNewton() {
    await assertRotatedRectangleSolvesWithStrategy("gaussNewton", {
      expectedSolveState: "partiallySolved",
      branchTolerance: 1e-1,
      dimensionTolerance: 1e-1,
    });
  }

  async function testRotatedRectangleLevenbergMarquardt() {
    await assertRotatedRectangleSolvesWithStrategy("levenbergMarquardt", {
      expectedSolveState: "partiallySolved",
      branchTolerance: 1e-1,
      dimensionTolerance: 1e-1,
    });
  }

  async function testValidationRejectsDegenerateLine() {
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

  async function testValidationRejectsPointIdsWithoutRecords() {
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

  async function testValidationRejectsMissingConstraintReferences() {
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

  async function testValidationRejectsDuplicatePointRecords() {
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

  async function testValidationRejectsDuplicateEntityRecords() {
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

  async function testCircleRadiusDimensionDrivesSolvedCircleRadius() {
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

  async function testCircleDiameterDimensionDrivesSolvedCircleRadius() {
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

  function createIndependentLineComponentsDefinition(): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 1, 0),
        makePoint("sketch_point_c", "C", 10, 0),
        makePoint("sketch_point_d", "D", 11, 0),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_cd"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
      ],
      constraintIds: ["constraint_ab_horizontal", "constraint_cd_horizontal"],
      constraints: [
        {
          constraintId: "constraint_ab_horizontal",
          kind: "horizontal",
          label: "AB horizontal",
          entityId: "sketch_entity_ab",
        },
        {
          constraintId: "constraint_cd_horizontal",
          kind: "horizontal",
          label: "CD horizontal",
          entityId: "sketch_entity_cd",
        },
      ],
      dimensionIds: ["dimension_ab_length", "dimension_cd_length"],
      dimensions: [
        {
          dimensionId: "dimension_ab_length",
          kind: "lineLength",
          label: "AB length",
          entityId: "sketch_entity_ab",
          value: 1,
        },
        {
          dimensionId: "dimension_cd_length",
          kind: "lineLength",
          label: "CD length",
          entityId: "sketch_entity_cd",
          value: 1,
        },
      ],
    };
  }

  async function testCompiledSolveProgramReuseAndInvalidation() {
    const definition = createIndependentLineComponentsDefinition();
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const numericEdit: SketchDefinition = {
      ...definition,
      points: definition.points.map((point) =>
        point.pointId === "sketch_point_a"
          ? { ...point, position: [0.25, 0] as const }
          : point,
      ),
    };

    expect(
      program.components.length,
      "Compiled program should partition independent line components.",
    ).toBe(2);
    expect(
      isCompiledSketchSolveProgramCompatible(program, {
        definition: numericEdit,
        tolerances,
        modelingTolerance: 1e-3,
      }),
      "Compiled program should remain compatible across authored point numeric edits.",
    ).toBeTruthy();
    expect(
      isCompiledSketchSolveProgramCompatible(program, {
        definition,
        tolerances: { ...tolerances, coincidence: 1e-5 },
        modelingTolerance: 1e-3,
      }),
      "Compiled program should invalidate when tolerance policy changes.",
    ).toBeFalsy();
    expect(
      solveSketchDefinitionCore({
        definition,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).status.solveState,
      "Full solve should route through the compiled-program path and remain solved.",
    ).toBe("solved");
  }

  async function testInteractiveSessionWarmStartStaleRejectionAndComponentIsolation() {
    const definition = createIndependentLineComponentsDefinition();
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_core_spec",
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    expect(
      session.warmStarted,
      "Interactive sessions should warm-start from compatible solved snapshots.",
    ).toBeTruthy();

    const result = updateCompiledSketchSolveSession(
      session,
      {
        kind: "sketchPoint",
        pointId: "sketch_point_b",
        position: [2, 0],
      },
      1e-4,
    );
    expect(
      result.kind,
      "Interactive update should accept a translatable constrained component.",
    ).toBe("solved");
    const points = new Map(
      result.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      points.get("sketch_point_c")?.[0] ?? Number.NaN,
      10,
      1e-6,
      "Unaffected component point C should remain stable.",
    );
    assertClose(
      points.get("sketch_point_d")?.[0] ?? Number.NaN,
      11,
      1e-6,
      "Unaffected component point D should remain stable.",
    );

    session.disposed = true;
    const stale = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: "sketch_point_b",
      position: [3, 0],
    });
    expect(
      stale.kind === "blocked" &&
        stale.reason === "staleSession" &&
        stale.diagnostics.some(
          (diagnostic) => diagnostic.code === "stale-interactive-solve-session",
        ),
      "Disposed interactive sessions should reject later updates with a stale-session diagnostic.",
    ).toBeTruthy();
  }

  async function testCompiledInteractiveDragKeepsInitiallyCoincidentPointsTogether() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 0, 0),
      ],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_ab_coincident"],
      constraints: [
        {
          constraintId: "constraint_ab_coincident",
          kind: "coincident",
          label: "A coincident B",
          pointIds: ["sketch_point_a", "sketch_point_b"],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };
    const dragTarget = {
      kind: "sketchPoint",
      pointId: "sketch_point_a",
      position: [2, 3],
    } as const;

    const stateless = solveSketchDefinitionWithDraggedPointTarget({
      definition,
      dragTarget,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      targetTolerance: 1e-4,
    });
    expect(
      stateless.kind,
      "Stateless dragged solve should accept initially coincident points.",
    ).toBe("solved");

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_coincident_core_spec",
      program,
      priorSolvedSnapshot: solveSketchDefinitionCore({
        definition,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      }).solvedSnapshot,
    });
    const compiled = updateCompiledSketchSolveSession(
      session,
      dragTarget,
      1e-4,
    );

    expect(
      compiled.kind,
      "Compiled interactive update should accept initially coincident points.",
    ).toBe("solved");
    const points = new Map(
      compiled.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      points.get("sketch_point_a")?.[0] ?? Number.NaN,
      2,
      1e-4,
      "Dragged point A should reach the target x position.",
    );
    assertClose(
      points.get("sketch_point_a")?.[1] ?? Number.NaN,
      3,
      1e-4,
      "Dragged point A should reach the target y position.",
    );
    assertClose(
      points.get("sketch_point_b")?.[0] ?? Number.NaN,
      2,
      1e-4,
      "Coincident point B should move with A on x.",
    );
    assertClose(
      points.get("sketch_point_b")?.[1] ?? Number.NaN,
      3,
      1e-4,
      "Coincident point B should move with A on y.",
    );
  }

  async function testCompiledInteractiveDragTranslatesRigidRectangle() {
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 2, 0),
        makePoint("sketch_point_c", "C", 2, 3),
        makePoint("sketch_point_d", "D", 0, 3),
      ],
      entityIds: [
        "sketch_entity_line_a",
        "sketch_entity_line_b",
        "sketch_entity_line_c",
        "sketch_entity_line_d",
      ],
      entities: [
        makeLine(
          "sketch_entity_line_a",
          "A-B",
          "sketch_point_a",
          "sketch_point_b",
        ),
        makeLine(
          "sketch_entity_line_b",
          "B-C",
          "sketch_point_b",
          "sketch_point_c",
        ),
        makeLine(
          "sketch_entity_line_c",
          "C-D",
          "sketch_point_c",
          "sketch_point_d",
        ),
        makeLine(
          "sketch_entity_line_d",
          "D-A",
          "sketch_point_d",
          "sketch_point_a",
        ),
      ],
      constraintIds: [
        "constraint_horizontal_a",
        "constraint_horizontal_c",
        "constraint_vertical_b",
        "constraint_vertical_d",
      ],
      constraints: [
        {
          constraintId: "constraint_horizontal_a",
          kind: "horizontal",
          label: "Horizontal A",
          entityId: "sketch_entity_line_a",
        },
        {
          constraintId: "constraint_horizontal_c",
          kind: "horizontal",
          label: "Horizontal C",
          entityId: "sketch_entity_line_c",
        },
        {
          constraintId: "constraint_vertical_b",
          kind: "vertical",
          label: "Vertical B",
          entityId: "sketch_entity_line_b",
        },
        {
          constraintId: "constraint_vertical_d",
          kind: "vertical",
          label: "Vertical D",
          entityId: "sketch_entity_line_d",
        },
      ],
      dimensionIds: ["dimension_width", "dimension_height"],
      dimensions: [
        {
          dimensionId: "dimension_width",
          kind: "horizontalDistance",
          label: "Width",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 2,
        },
        {
          dimensionId: "dimension_height",
          kind: "verticalDistance",
          label: "Height",
          pointIds: ["sketch_point_a", "sketch_point_d"],
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
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_rectangle_translate_core_spec",
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    const result = updateCompiledSketchSolveSession(
      session,
      {
        kind: "sketchPoint",
        pointId: "sketch_point_b",
        position: [7, 11],
      },
      1e-4,
    );

    expect(
      result.kind,
      "Interactive update should accept rigid rectangle translation.",
    ).toBe("solved");
    const points = new Map(
      result.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    assertClose(
      points.get("sketch_point_a")?.[0] ?? Number.NaN,
      5,
      1e-4,
      "Point A should translate on x.",
    );
    assertClose(
      points.get("sketch_point_a")?.[1] ?? Number.NaN,
      11,
      1e-4,
      "Point A should translate on y.",
    );
    assertClose(
      points.get("sketch_point_b")?.[0] ?? Number.NaN,
      7,
      1e-4,
      "Point B should reach target x.",
    );
    assertClose(
      points.get("sketch_point_b")?.[1] ?? Number.NaN,
      11,
      1e-4,
      "Point B should reach target y.",
    );
    assertClose(
      points.get("sketch_point_c")?.[0] ?? Number.NaN,
      7,
      1e-4,
      "Point C should translate on x.",
    );
    assertClose(
      points.get("sketch_point_c")?.[1] ?? Number.NaN,
      14,
      1e-4,
      "Point C should translate on y.",
    );
    assertClose(
      points.get("sketch_point_d")?.[0] ?? Number.NaN,
      5,
      1e-4,
      "Point D should translate on x.",
    );
    assertClose(
      points.get("sketch_point_d")?.[1] ?? Number.NaN,
      14,
      1e-4,
      "Point D should translate on y.",
    );
  }

  async function testDefaultSolveRecoversFromStalledImportedProfile() {
    const pointTuples = [
      ["sketch_point_a", 1, 0],
      ["sketch_point_b", 1, 1],
      ["sketch_point_c", 6, 1],
      ["sketch_point_d", 6, 0],
      ["sketch_point_e", 9, 0],
      ["sketch_point_f", 9, 4],
      ["sketch_point_g", -9, 4],
      ["sketch_point_h", -9, 0],
      ["sketch_point_mid", 0, 4],
    ] as const;
    const lineTuples = [
      ["sketch_entity_ab", "sketch_point_a", "sketch_point_b"],
      ["sketch_entity_bc", "sketch_point_b", "sketch_point_c"],
      ["sketch_entity_cd", "sketch_point_c", "sketch_point_d"],
      ["sketch_entity_de", "sketch_point_d", "sketch_point_e"],
      ["sketch_entity_ef", "sketch_point_e", "sketch_point_f"],
      ["sketch_entity_fg", "sketch_point_f", "sketch_point_g"],
      ["sketch_entity_gh", "sketch_point_g", "sketch_point_h"],
      ["sketch_entity_ha", "sketch_point_h", "sketch_point_a"],
    ] as const;
    const points = pointTuples.map(([id, x, y]) => makePoint(id, id, x, y));
    const entities = lineTuples.map(([id, start, end]) =>
      makeLine(id, id, start, end),
    );
    const constraints: SketchDefinition["constraints"] = [
      ...[0, 2, 4, 6].map((index) => ({
        constraintId: `constraint_vertical_${index}` as `constraint_${string}`,
        kind: "vertical" as const,
        label: `Vertical ${index}`,
        entityId: entities[index]!.entityId,
      })),
      ...[1, 3, 5, 7].map((index) => ({
        constraintId:
          `constraint_horizontal_${index}` as `constraint_${string}`,
        kind: "horizontal" as const,
        label: `Horizontal ${index}`,
        entityId: entities[index]!.entityId,
      })),
      {
        constraintId: "constraint_midpoint",
        kind: "midpoint",
        label: "Midpoint",
        point: { kind: "localPoint", pointId: points[8]!.pointId },
        line: { kind: "localEntity", entityId: entities[5]!.entityId },
      },
      {
        constraintId: "constraint_anchor",
        kind: "fixPoint",
        label: "Imported source anchor",
        pointId: points[0]!.pointId,
        position: [1, 0],
      },
    ];
    const dimensions: SketchDefinition["dimensions"] = [
      ["dimension_width", 1, 5],
      ["dimension_height", 2, 1],
      ["dimension_wall", 3, 3],
      ["dimension_variable_span", 7, 11],
    ].map(([id, entityIndex, value]) => ({
      dimensionId: id as `dimension_${string}`,
      kind: "lineLength" as const,
      label: String(id),
      entityId: entities[Number(entityIndex)]!.entityId,
      value: Number(value),
    }));
    dimensions.push({
      dimensionId: "dimension_wall_distance",
      kind: "lineDistance",
      label: "Wall distance",
      lines: [
        { kind: "localEntity", entityId: entities[1]!.entityId },
        { kind: "localEntity", entityId: entities[5]!.entityId },
      ],
      value: 3,
    });
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
      dimensions,
    };

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const solvedPoints = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );

    expect(
      solved.status.solveState,
      "The default solver should recover when its BFGS pass stalls on a satisfiable imported profile.",
    ).toBe("solved");
    for (const [index, line] of entities.entries()) {
      const start = solvedPoints.get(line.startPointId)!;
      const end = solvedPoints.get(line.endPointId)!;
      const axisDelta =
        index % 2 === 0
          ? Math.abs(start[0] - end[0])
          : Math.abs(start[1] - end[1]);
      expect(
        axisDelta,
        `Solved imported profile line ${index} should not render crooked.`,
      ).toBeLessThan(1e-6);
    }
  }

  async function testOrdinarySplineUsesAnalyticOwnerJacobiansAndAuthoredHandleVariables() {
    const points = [
      makePoint("sketch_point_s0", "S0", 0, 0),
      makePoint("sketch_point_s1", "S1", 1, 1),
      makePoint("sketch_point_s2", "S2", 2, 0),
      makePoint("sketch_point_contact", "Contact", 0.55, 0.8),
    ];
    const spline = {
      kind: "spline" as const,
      entityId: "sketch_entity_spline" as const,
      label: "Spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_s0", "occ_s1", "occ_s2"],
      // Deliberately shuffled: variable identity follows occurrence IDs, not record order.
      pointOccurrences: [
        {
          occurrenceId: "occ_s2",
          pointId: "sketch_point_s2" as const,
          tangent: { kind: "authored" as const, vector: [0.2, -0.1] as const },
        },
        {
          occurrenceId: "occ_s0",
          pointId: "sketch_point_s0" as const,
          tangent: { kind: "authored" as const, vector: [0.3, 0.15] as const },
        },
        {
          occurrenceId: "occ_s1",
          pointId: "sketch_point_s1" as const,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
      ],
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const constraints: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_contact",
        kind: "pointOnCurve",
        label: "Contact on spline",
        point: { kind: "localPoint", pointId: points[3]!.pointId },
        curve: { kind: "localEntity", entityId: spline.entityId },
      },
      ...points.map((point, index) => ({
        constraintId:
          `constraint_fix_spline_${index}` as `constraint_${string}`,
        kind: "fixPoint" as const,
        label: `Fix ${index}`,
        pointId: point.pointId,
        position: point.position,
      })),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [spline.entityId],
      entities: [spline],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
    };
    const before = structuredClone(definition);
    const initial = getSketchSolveInitialValuesForTest(
      definition,
      tolerances,
      1e-3,
    );

    // Four point pairs plus all three authored tangent-vector pairs.
    expect(initial.length).toBe(14);
    expect([...initial.slice(8)]).toEqual([0.3, 0.15, 0, 0, 0.2, -0.1]);
    const contactEvaluation = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition,
      constraintId: "constraint_contact",
      values: initial,
    });
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_contact",
      2e-5,
      2e-6,
    );
    expect(
      [...contactEvaluation.gradient.slice(8, 12)].some(
        (component) => Math.abs(component) > 1e-8,
      ),
      "The contacted span must expose authored handle components to the analytic residual.",
    ).toBeTruthy();
    expect(
      [...contactEvaluation.gradient.slice(12, 14)].every(
        (component) => Math.abs(component) < 1e-12,
      ),
      "A distant authored handle must remain outside this local span residual.",
    ).toBeTruthy();

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const status = solved.solvedSnapshot.constraintStatuses.find(
      (entry) => entry.constraintId === "constraint_contact",
    );
    const solvedSpline = solved.solvedSnapshot.solvedEntities.find(
      (entity) =>
        entity.entityId === spline.entityId && entity.kind === "spline",
    );
    expect(status?.status).toBe("satisfied");
    expect(solvedSpline?.kind).toBe("spline");
    if (solvedSpline?.kind === "spline") {
      expect(solvedSpline.reconstruction.validity).toBe("valid");
      if (solvedSpline.reconstruction.validity === "valid") {
        expect(solvedSpline.reconstruction.handles[1]).not.toEqual([0, 0]);
        const firstEnd = evaluateSplineSpan(
          solvedSpline.reconstruction.spans[0]!,
          {
            kind: "source",
            value: solvedSpline.reconstruction.spans[0]!.interval[1],
          },
        );
        const secondStart = evaluateSplineSpan(
          solvedSpline.reconstruction.spans[1]!,
          {
            kind: "source",
            value: solvedSpline.reconstruction.spans[1]!.interval[0],
          },
        );
        expect(firstEnd.position).toEqual(secondStart.position);
        expect(
          Math.hypot(
            firstEnd.first[0] - secondStart.first[0],
            firstEnd.first[1] - secondStart.first[1],
          ),
        ).toBeLessThan(1e-8);
      }
    }
    expect(definition).toEqual(before);
  }

  async function testOrdinarySplineAliasClosureKeepsAutomaticTangentsDerivedAndExactZeroAuthored() {
    const points = [
      makePoint("sketch_point_a0", "A0", 0, 0),
      makePoint("sketch_point_a1", "A1", 1, 1),
      makePoint("sketch_point_a2", "A2", 2, 0),
    ];
    const baseSpline = {
      kind: "spline" as const,
      entityId: "sketch_entity_alias_spline" as const,
      label: "Alias spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_alias_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_a0", "occ_a1", "occ_a2", "occ_a0_close"],
      pointOccurrences: [
        {
          occurrenceId: "occ_a0_close",
          pointId: points[0]!.pointId,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
        {
          occurrenceId: "occ_a1",
          pointId: points[1]!.pointId,
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "occ_a0",
          pointId: points[0]!.pointId,
          tangent: { kind: "authored" as const, vector: [0.4, 0] as const },
        },
        {
          occurrenceId: "occ_a2",
          pointId: points[2]!.pointId,
          tangent: { kind: "automatic" as const },
        },
      ],
      closure: "positional" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [baseSpline.entityId],
      entities: [baseSpline],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const initial = getSketchSolveInitialValuesForTest(
      definition,
      tolerances,
      1e-3,
    );
    // Shared canonical aliases have one point pair; automatic occurrences add no variables.
    expect(initial.length).toBe(10);
    expect([...initial.slice(6)]).toEqual([0.4, 0, 0, 0]);
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
    });
    const geometry = solved.solvedSnapshot.solvedEntities.find(
      (entity) =>
        entity.entityId === baseSpline.entityId && entity.kind === "spline",
    );
    expect(geometry?.kind).toBe("spline");
    if (
      geometry?.kind === "spline" &&
      geometry.reconstruction.validity === "valid"
    ) {
      expect(geometry.reconstruction.handles[3]).toEqual([0, 0]);
      expect(geometry.reconstruction.handles[1]).not.toEqual([0, 0]);
      expect(geometry.reconstruction.spans.at(-1)?.poles[3]).toEqual(
        geometry.reconstruction.spans[0]?.poles[0],
      );
    }
  }

  async function testProjectedSourceSamplesAreRejectedAsDisplayOnly() {
    const point = makePoint("sketch_point_projected", "Projected", 0.5, 0.5);
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: ["ref_spline"],
      references: [
        {
          referenceId: "ref_spline",
          kind: "modelReference",
          label: "External spline",
          source: { kind: "edge", bodyId: "body_1", edgeId: "edge_1" },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
      pointIds: [point.pointId],
      points: [point],
      entityIds: [],
      entities: [],
      constraintIds: ["constraint_projected_spline"],
      constraints: [
        {
          constraintId: "constraint_projected_spline",
          kind: "pointOnProjectedCurve",
          label: "Point on external spline",
          point: { kind: "localPoint", pointId: point.pointId },
          projectedCurve: {
            kind: "projectedGeometry",
            reference: {
              kind: "projectedSpline",
              referenceId: "ref_spline",
              geometryId: "projected_geometry_spline",
            },
          },
        },
      ],
      dimensionIds: [],
      dimensions: [],
    };
    const projectedReferences = [
      {
        referenceId: "ref_spline" as const,
        status: "projected" as const,
        geometry: [
          {
            geometryId: "projected_geometry_spline" as const,
            kind: "spline" as const,
            representation: {
              kind: "sourceSamples" as const,
              points: [
                [0, 0],
                [1, 1],
              ] as const,
              isClosed: false,
            },
          },
        ],
        diagnostics: [],
      },
    ];
    const validated = validateSketchDefinitionCore({
      definition,
      projectedReferences,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(validated.isValid).toBe(false);
    expect(validated.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unsupported-projected-spline-samples" }),
    );
    const solved = solveSketchDefinitionCore({
      definition,
      projectedReferences,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("failed");
  }

  async function testDrivenOutputConstraintUsesSourceAndAxisJacobians() {
    const points = [
      makePoint("sketch_point_source", "Source", 1, 1),
      makePoint("sketch_point_output", "Output", 1, -1),
      makePoint("sketch_point_axis_start", "Axis start", 0, 0),
      makePoint("sketch_point_axis_end", "Axis end", 2, 0),
    ];
    const axis = makeLine(
      "sketch_entity_axis",
      "Axis",
      "sketch_point_axis_start",
      "sketch_point_axis_end",
    );
    const source = {
      kind: "point" as const,
      entityId: "sketch_entity_source" as const,
      label: "Source",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_source" as const,
      },
      isConstruction: false,
      pointId: "sketch_point_source" as const,
    };
    const output = {
      ...source,
      entityId: "sketch_entity_output" as const,
      label: "Output",
      target: {
        ...source.target,
        entityId: "sketch_entity_output" as const,
      },
      pointId: "sketch_point_output" as const,
    };
    const constraints: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_output_position",
        kind: "fixPoint",
        label: "Output position",
        pointId: output.pointId,
        position: [3, -2],
      },
      {
        constraintId: "constraint_axis_start",
        kind: "fixPoint",
        label: "Axis start",
        pointId: axis.startPointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_axis_end",
        kind: "fixPoint",
        label: "Axis end",
        pointId: axis.endPointId,
        position: [2, 0],
      },
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [source.entityId, output.entityId, axis.entityId],
      entities: [source, output, axis],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: ["derivation_mirror"],
      derivedRelationships: [
        {
          derivationId: "derivation_mirror",
          kind: "mirror",
          label: "Mirror",
          seedEntityIds: [source.entityId],
          mirrorReference: { kind: "lineEntity", entityId: axis.entityId },
          outputs: [
            {
              seedEntityId: source.entityId,
              outputEntityId: output.entityId,
              instanceIndex: 1,
              seedPointIds: [source.pointId],
              outputPointIds: [output.pointId],
            },
          ],
        },
      ],
    };

    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_output_position",
      2e-5,
    );
    const evaluation = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition,
      constraintId: "constraint_output_position",
      values: getSketchSolveInitialValuesForTest(definition, tolerances, 1e-3),
    });
    expect(
      [...evaluation.gradient.slice(0, 2)].some(
        (component) => Math.abs(component) > 1e-8,
      ),
      "A driven-output requirement must pull back to source point variables.",
    ).toBeTruthy();
    expect(
      [...evaluation.gradient.slice(4, 8)].some(
        (component) => Math.abs(component) > 1e-8,
      ),
      "Mirror output evaluation must include analytic axis dependencies.",
    ).toBeTruthy();
    expect([...evaluation.gradient.slice(2, 4)]).toEqual([0, 0]);
    const constrainedProgram = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputEquation = constrainedProgram.equationMetadata.find(
      (metadata) => metadata.id === "constraint_output_position",
    );
    expect(outputEquation?.variableIndices).toEqual([0, 1, 4, 5, 6, 7]);
    expect(
      constrainedProgram.components[outputEquation!.componentId]
        ?.variableIndices,
    ).toEqual([0, 1, 4, 5, 6, 7]);

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(
      solved.solvedSnapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_output_position",
      )?.status,
    ).toBe("satisfied");
    const solvedPoints = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(solvedPoints.get(source.pointId)?.[0]).toBeCloseTo(3, 5);
    expect(solvedPoints.get(source.pointId)?.[1]).toBeCloseTo(2, 5);
    expect(solvedPoints.get(output.pointId)?.[0]).toBeCloseTo(3, 5);
    expect(solvedPoints.get(output.pointId)?.[1]).toBeCloseTo(-2, 5);

    const dragDefinition: SketchDefinition = {
      ...definition,
      constraintIds: ["constraint_axis_start", "constraint_axis_end"],
      constraints: constraints.slice(1),
    };
    const program = compileSketchSolveProgram({
      definition: dragDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputComponent = program.components.find((component) =>
      component.pointIds.includes(output.pointId),
    );
    expect(outputComponent?.variableIndices).toEqual([0, 1, 4, 5, 6, 7]);
    expect(outputComponent?.variableIndices).not.toContain(2);
    expect(outputComponent?.variableIndices).not.toContain(3);
    const initialDragSolve = solveSketchDefinitionCore({
      definition: dragDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_driven_output",
      program,
      priorSolvedSnapshot: initialDragSolve.solvedSnapshot,
    });
    expect(sketchDraggedPointHasFreeDof(session, output.pointId)).toBe(true);
    const dragged = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: output.pointId,
      position: [3, -2],
    });
    expect(dragged.kind).toBe("solved");
    const draggedPoints = new Map(
      dragged.solvedSnapshot?.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(draggedPoints.get(source.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(draggedPoints.get(source.pointId)?.[1]).toBeCloseTo(2, 3);
    expect(draggedPoints.get(output.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(draggedPoints.get(output.pointId)?.[1]).toBeCloseTo(-2, 3);

    const lastAccepted = dragged.solvedSnapshot;
    const rejected = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: output.pointId,
      position: [Number.NaN, -2],
    });
    expect(rejected.kind).toBe("blocked");
    expect(rejected).toMatchObject({ reason: "nonConvergent" });
    expect(rejected.solvedSnapshot).toEqual(lastAccepted);
  }

  async function testProjectionSupportClosesOverOrderedDerivedChains() {
    const points = [
      makePoint("sketch_point_chain_source", "Source", 1, 0),
      makePoint("sketch_point_chain_middle", "Middle", 1, 0),
      makePoint("sketch_point_chain_output", "Output", 2, 0),
      makePoint("sketch_point_chain_axis_start", "Axis start", 0, 0),
      makePoint("sketch_point_chain_axis_end", "Axis end", 2, 0),
    ];
    const pointEntities = points.slice(0, 3).map((point, index) => ({
      kind: "point" as const,
      entityId: `sketch_entity_chain_${index}` as const,
      label: point.label,
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: `sketch_entity_chain_${index}` as const,
      },
      isConstruction: false,
      pointId: point.pointId,
    }));
    const axis = makeLine(
      "sketch_entity_chain_axis",
      "Axis",
      points[3]!.pointId,
      points[4]!.pointId,
    );
    const constraints: SketchDefinition["constraints"] = [
      {
        constraintId: "constraint_chain_axis_start",
        kind: "fixPoint",
        label: "Fix axis start",
        pointId: points[3]!.pointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_chain_axis_end",
        kind: "fixPoint",
        label: "Fix axis end",
        pointId: points[4]!.pointId,
        position: [2, 0],
      },
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [
        ...pointEntities.map((entity) => entity.entityId),
        axis.entityId,
      ],
      entities: [...pointEntities, axis],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: [
        "derivation_chain_mirror",
        "derivation_chain_transform",
      ],
      derivedRelationships: [
        {
          derivationId: "derivation_chain_mirror",
          kind: "mirror",
          label: "Mirror source",
          seedEntityIds: [pointEntities[0]!.entityId],
          mirrorReference: { kind: "lineEntity", entityId: axis.entityId },
          outputs: [
            {
              seedEntityId: pointEntities[0]!.entityId,
              outputEntityId: pointEntities[1]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[0]!.pointId],
              outputPointIds: [points[1]!.pointId],
            },
          ],
        },
        {
          derivationId: "derivation_chain_transform",
          kind: "transform",
          label: "Translate mirror",
          seedEntityIds: [pointEntities[1]!.entityId],
          translation: [1, 0],
          rotationRadians: 0,
          scale: 1,
          origin: [0, 0],
          outputs: [
            {
              seedEntityId: pointEntities[1]!.entityId,
              outputEntityId: pointEntities[2]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[1]!.pointId],
              outputPointIds: [points[2]!.pointId],
            },
          ],
        },
      ],
    };
    const outputRequirement = {
      constraintId: "constraint_chain_output" as const,
      kind: "fixPoint" as const,
      label: "Fix chained output",
      pointId: points[2]!.pointId,
      position: [4, -2] as const,
    };
    const gradientDefinition: SketchDefinition = {
      ...definition,
      constraintIds: [
        ...definition.constraintIds,
        outputRequirement.constraintId,
      ],
      constraints: [...definition.constraints, outputRequirement],
    };
    assertGradientMatchesFiniteDifference(
      gradientDefinition,
      outputRequirement.constraintId,
      2e-5,
    );
    const gradientProgram = compileSketchSolveProgram({
      definition: gradientDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputScalar = gradientProgram.system.scalarConstraints.find(
      (constraint) => constraint.id === outputRequirement.constraintId,
    )!;
    const mutableValues = new Float64Array(
      gradientProgram.system.initialValues,
    );
    const axisGradientAtZeroPose =
      outputScalar.evaluate(mutableValues).gradient;
    mutableValues[1] = 1;
    mutableValues[7] = 0.5;
    const mutatedEvaluation = outputScalar.evaluate(mutableValues);
    const freshEvaluation = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition: gradientDefinition,
      constraintId: outputRequirement.constraintId,
      values: new Float64Array(mutableValues),
    });
    expect(mutatedEvaluation.residual).toBeCloseTo(
      freshEvaluation.residual,
      12,
    );
    expect([...mutatedEvaluation.gradient]).toEqual([
      ...freshEvaluation.gradient,
    ]);
    expect(
      [...mutatedEvaluation.gradient.slice(6, 10)].some(
        (component, index) =>
          Math.abs(axisGradientAtZeroPose[index + 6]!) < 1e-12 &&
          Math.abs(component) > 1e-8,
      ),
      "Mutating the same candidate array must recompute a mirror-axis gradient component that becomes nonzero in the current frame.",
    ).toBeTruthy();
    assertGradientMatchesFiniteDifference(
      gradientDefinition,
      outputRequirement.constraintId,
      2e-5,
      1e-6,
      mutableValues,
    );

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const outputComponent = program.components.find((component) =>
      component.pointIds.includes(points[2]!.pointId),
    );
    expect(outputComponent?.variableIndices).toEqual([0, 1, 6, 7, 8, 9]);
    const initial = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_derived_chain",
      program,
      priorSolvedSnapshot: initial.solvedSnapshot,
    });
    const dragged = updateCompiledSketchSolveSession(session, {
      kind: "sketchPoint",
      pointId: points[2]!.pointId,
      position: [4, -2],
    });
    expect(dragged.kind).toBe("solved");
    const solvedPoints = new Map(
      dragged.solvedSnapshot?.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(solvedPoints.get(points[0]!.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(solvedPoints.get(points[0]!.pointId)?.[1]).toBeCloseTo(2, 3);
    expect(solvedPoints.get(points[1]!.pointId)?.[0]).toBeCloseTo(3, 3);
    expect(solvedPoints.get(points[1]!.pointId)?.[1]).toBeCloseTo(-2, 3);
    expect(solvedPoints.get(points[2]!.pointId)?.[0]).toBeCloseTo(4, 3);
    expect(solvedPoints.get(points[2]!.pointId)?.[1]).toBeCloseTo(-2, 3);
  }

  async function testDimensionStatusUsesLinearAndAngularTolerancePolicies() {
    const solveWithTolerance = (
      definition: SketchDefinition,
      policy: typeof tolerances,
    ) =>
      solveSketchDefinitionCore({
        definition,
        tolerances: policy,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "bestEffort",
      });
    const fixedConstraints = (
      points: readonly ReturnType<typeof makePoint>[],
    ) =>
      points.map((point, index) => ({
        constraintId:
          `constraint_policy_fix_${index}` as `constraint_${string}`,
        kind: "fixPoint" as const,
        label: `Fix ${index}`,
        pointId: point.pointId,
        position: point.position,
      }));

    const linearPoints = [
      makePoint("sketch_point_policy_a", "A", 0, 0),
      makePoint("sketch_point_policy_b", "B", 1.01, 0),
    ];
    const linearConstraints = fixedConstraints(linearPoints);
    const linearDimension = {
      dimensionId: "dimension_policy_linear" as const,
      kind: "distance" as const,
      label: "Linear policy boundary",
      pointIds: [linearPoints[0]!.pointId, linearPoints[1]!.pointId] as const,
      axis: "aligned" as const,
      value: 1,
    };
    const linearDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: linearPoints.map((point) => point.pointId),
      points: linearPoints,
      entityIds: [],
      entities: [],
      constraintIds: linearConstraints.map(
        (constraint) => constraint.constraintId,
      ),
      constraints: linearConstraints,
      dimensionIds: [linearDimension.dimensionId],
      dimensions: [linearDimension],
    };
    const looseLinear = solveWithTolerance(linearDefinition, {
      ...tolerances,
      coincidence: 0.01,
    });
    const strictLinear = solveWithTolerance(linearDefinition, {
      ...tolerances,
      coincidence: 1e-5,
    });
    expect(
      looseLinear.solvedSnapshot.dimensionStatuses[0]?.status,
      "A linear dimension residual inside the supplied linear policy should be driving.",
    ).toBe("driving");
    expect(
      strictLinear.solvedSnapshot.dimensionStatuses[0]?.status,
      "The same linear residual outside a stricter linear policy should be unsatisfied.",
    ).toBe("unsatisfied");

    const anglePoints = [
      makePoint("sketch_point_policy_o", "O", 0, 0),
      makePoint("sketch_point_policy_x", "X", 1, 0),
      makePoint("sketch_point_policy_y", "Y", 0, 1),
    ];
    const angleLines = [
      makeLine(
        "sketch_entity_policy_x",
        "X axis",
        anglePoints[0]!.pointId,
        anglePoints[1]!.pointId,
      ),
      makeLine(
        "sketch_entity_policy_y",
        "Y axis",
        anglePoints[0]!.pointId,
        anglePoints[2]!.pointId,
      ),
    ];
    const angleConstraints = fixedConstraints(anglePoints);
    const angleDimension = {
      dimensionId: "dimension_policy_angle" as const,
      kind: "lineAngle" as const,
      label: "Angular policy boundary",
      lines: angleLines.map((line) => ({
        kind: "localEntity" as const,
        entityId: line.entityId,
      })) as [
        {
          kind: "localEntity";
          entityId: (typeof angleLines)[number]["entityId"];
        },
        {
          kind: "localEntity";
          entityId: (typeof angleLines)[number]["entityId"];
        },
      ],
      valueRadians: Math.PI / 2 + 0.01,
    };
    const angleDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: anglePoints.map((point) => point.pointId),
      points: anglePoints,
      entityIds: angleLines.map((line) => line.entityId),
      entities: angleLines,
      constraintIds: angleConstraints.map(
        (constraint) => constraint.constraintId,
      ),
      constraints: angleConstraints,
      dimensionIds: [angleDimension.dimensionId],
      dimensions: [angleDimension],
    };
    const looseAngle = solveWithTolerance(angleDefinition, {
      coincidence: 1,
      angleRadians: 0.01,
      minimumSegmentLength: 1e-6,
    });
    const strictAngle = solveWithTolerance(angleDefinition, {
      coincidence: 1,
      angleRadians: 1e-5,
      minimumSegmentLength: 1e-6,
    });
    expect(looseAngle.solvedSnapshot.dimensionStatuses[0]?.status).toBe(
      "driving",
    );
    expect(strictAngle.solvedSnapshot.dimensionStatuses[0]?.status).toBe(
      "unsatisfied",
    );
  }

  async function testOffsetOutputRequirementDrivesSourceAuthority() {
    const points = [
      makePoint("sketch_point_offset_a", "A", 0, 0),
      makePoint("sketch_point_offset_b", "B", 4, 0),
      makePoint("sketch_point_offset_c", "C", 4, 4),
      makePoint("sketch_point_offset_o1s", "O1S", 0, 0),
      makePoint("sketch_point_offset_o1e", "O1E", 0, 0),
      makePoint("sketch_point_offset_o2s", "O2S", 0, 0),
      makePoint("sketch_point_offset_o2e", "O2E", 0, 0),
      makePoint("sketch_point_offset_joint", "Joint center", 0, 0),
    ];
    const entities = [
      makeLine(
        "sketch_entity_offset_ab",
        "AB",
        points[0]!.pointId,
        points[1]!.pointId,
      ),
      makeLine(
        "sketch_entity_offset_bc",
        "BC",
        points[1]!.pointId,
        points[2]!.pointId,
      ),
      makeLine(
        "sketch_entity_offset_o1",
        "O1",
        points[3]!.pointId,
        points[4]!.pointId,
      ),
      makeLine(
        "sketch_entity_offset_o2",
        "O2",
        points[5]!.pointId,
        points[6]!.pointId,
      ),
      makeArc(
        "sketch_entity_offset_joint",
        "Joint",
        points[7]!.pointId,
        points[4]!.pointId,
        points[5]!.pointId,
      ),
    ];
    const constraint = {
      constraintId: "constraint_fix_offset_output" as const,
      kind: "fixPoint" as const,
      label: "Near offset output",
      pointId: points[3]!.pointId,
      position: [0, -1.00001] as const,
    };
    const jointConstraint = {
      constraintId: "constraint_fix_offset_joint" as const,
      kind: "fixPoint" as const,
      label: "Drive committed joint center",
      pointId: points[7]!.pointId,
      position: [5, 0] as const,
    };
    const unrelatedSourceConstraint = {
      constraintId: "constraint_move_offset_source" as const,
      kind: "fixPoint" as const,
      label: "Move unrelated source coordinate",
      pointId: points[1]!.pointId,
      position: [5, 0] as const,
    };
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [
        constraint.constraintId,
        jointConstraint.constraintId,
        unrelatedSourceConstraint.constraintId,
      ],
      constraints: [constraint, jointConstraint, unrelatedSourceConstraint],
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: ["derivation_offset"],
      derivedRelationships: [
        {
          derivationId: "derivation_offset",
          kind: "offset",
          label: "Offset",
          seedEntityIds: [entities[0]!.entityId, entities[1]!.entityId],
          distance: -1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [
            {
              firstSeedEntityId: entities[0]!.entityId,
              secondSeedEntityId: entities[1]!.entityId,
              outputEntityId: entities[4]!.entityId,
              centerPointId: points[7]!.pointId,
              startPointId: points[4]!.pointId,
              endPointId: points[5]!.pointId,
            },
          ],
          outputs: [
            {
              seedEntityId: entities[0]!.entityId,
              outputEntityId: entities[2]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[0]!.pointId, points[1]!.pointId],
              outputPointIds: [points[3]!.pointId, points[4]!.pointId],
            },
            {
              seedEntityId: entities[1]!.entityId,
              outputEntityId: entities[3]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[1]!.pointId, points[2]!.pointId],
              outputPointIds: [points[5]!.pointId, points[6]!.pointId],
            },
          ],
        },
      ],
    };
    assertGradientMatchesFiniteDifference(
      definition,
      constraint.constraintId,
      1e-5,
    );
    const result = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(result.status.solveState).toBe("solved");
    expect(result.solvedSnapshot.constraintStatuses).toContainEqual({
      constraintId: constraint.constraintId,
      status: "satisfied",
    });
    expect(result.solvedSnapshot.constraintStatuses).toContainEqual({
      constraintId: jointConstraint.constraintId,
      status: "satisfied",
    });
    expect(result.solvedSnapshot.constraintStatuses).toContainEqual({
      constraintId: unrelatedSourceConstraint.constraintId,
      status: "satisfied",
    });
    const solvedPositions = new Map(
      result.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    expect(solvedPositions.get(points[1]!.pointId)![0]).toBeCloseTo(5, 6);
    expect(solvedPositions.get(points[1]!.pointId)![1]).toBeCloseTo(0, 6);
    expect(
      Math.abs(solvedPositions.get(points[0]!.pointId)![1]) > 1e-7,
      "The offset-output requirement should move seed authority rather than an output slot.",
    ).toBeTruthy();
    const freshlyDerived = evaluateSketchDerivations({
      definition: {
        ...definition,
        points: definition.points.map((point) => ({
          ...point,
          position: solvedPositions.get(point.pointId) ?? point.position,
        })),
      },
      modelingTolerance: 1e-3,
    }).definition;
    const freshOutput = freshlyDerived.points.find(
      (point) => point.pointId === points[3]!.pointId,
    )!.position;
    expect(solvedPositions.get(points[3]!.pointId)![0]).toBeCloseTo(
      freshOutput[0],
      8,
    );
    expect(solvedPositions.get(points[3]!.pointId)![1]).toBeCloseTo(
      freshOutput[1],
      8,
    );

    const anchorConstraints = (
      bPosition: readonly [number, number],
    ): SketchDefinition["constraints"] => [
      {
        constraintId: "constraint_offset_topology_a",
        kind: "fixPoint",
        label: "Anchor A",
        pointId: points[0]!.pointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_offset_topology_b",
        kind: "fixPoint",
        label: "Force topology frame",
        pointId: points[1]!.pointId,
        position: bPosition,
      },
      {
        constraintId: "constraint_offset_topology_c",
        kind: "fixPoint",
        label: "Anchor C",
        pointId: points[2]!.pointId,
        position: [4, 4],
      },
    ];
    const definitionWithAnchors = (
      bPosition: readonly [number, number],
    ): SketchDefinition => {
      const constraints = anchorConstraints(bPosition);
      return {
        ...definition,
        constraintIds: constraints.map((candidate) => candidate.constraintId),
        constraints,
      };
    };
    const accepted = solveSketchDefinitionCore({
      definition: definitionWithAnchors([4, 0]),
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const topologyProgram = compileSketchSolveProgram({
      definition: definitionWithAnchors([4, 5]),
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const topologySession = createCompiledSketchSolveSession({
      sessionId: "interactive_offset_topology_change",
      program: topologyProgram,
      priorSolvedSnapshot: accepted.solvedSnapshot,
    });
    const blocked = updateCompiledSketchSolveSession(topologySession, {
      kind: "sketchPoint",
      pointId: points[1]!.pointId,
      position: [4, 5],
    });
    expect(blocked.kind).toBe("blocked");
    expect(blocked.solvedSnapshot).toEqual(accepted.solvedSnapshot);
    expect(
      blocked.diagnostics.some(
        (diagnostic) =>
          // T08b-g5 ([TECH] G6): arc presence is authored intent, so a
          // corner that can no longer hold its authored arc is
          // `topologyChanged` (was the legacy joint-count check).
          diagnostic.code === OFFSET_DIAGNOSTIC_CODES.topologyChanged &&
          diagnostic.severity === "error" &&
          diagnostic.target?.kind === "entity",
      ),
      "A committed offset joint topology change should block with its targeted diagnostic.",
    ).toBeTruthy();
  }

  async function testOffsetCircleScalarAuthorityMovesTheSource() {
    const points = [
      makePoint("sketch_point_offset_circle_seed", "Seed center", 0, 0),
      makePoint("sketch_point_offset_circle_output", "Output center", 0, 0),
    ];
    const entities = [
      makeCircle(
        "sketch_entity_offset_circle_seed",
        "Seed circle",
        points[0]!.pointId,
        2,
      ),
      makeCircle(
        "sketch_entity_offset_circle_output",
        "Offset circle",
        points[1]!.pointId,
        1,
      ),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_offset_circle_radius"],
      dimensions: [
        {
          dimensionId: "dimension_offset_circle_radius",
          kind: "circleRadius",
          label: "Derived radius",
          entityId: entities[1]!.entityId,
          value: 1.2,
        },
      ],
      derivedRelationshipIds: ["derivation_offset_circle"],
      derivedRelationships: [
        {
          derivationId: "derivation_offset_circle",
          kind: "offset",
          label: "Circle offset",
          seedEntityIds: [entities[0]!.entityId],
          distance: 1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: entities[0]!.entityId,
              outputEntityId: entities[1]!.entityId,
              instanceIndex: 1,
              seedPointIds: [points[0]!.pointId],
              outputPointIds: [points[1]!.pointId],
            },
          ],
        },
      ],
    };

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const seedState = program.system.entityStates.get(entities[0]!.entityId)!;
    const outputState = program.system.entityStates.get(entities[1]!.entityId)!;
    expect(seedState.kind).toBe("circle");
    expect(outputState.kind).toBe("circle");
    expect(
      program.system.parameterProjection.authorityVariableIndices,
    ).toContain(seedState.baseIndex);
    expect(
      program.system.parameterProjection.authorityVariableIndices,
      "A derived output radius must not remain an independent solver variable.",
    ).not.toContain(outputState.baseIndex);
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_offset_circle_radius",
      1e-5,
    );

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(solved.solvedSnapshot.dimensionStatuses[0]?.status).toBe("driving");
    expect(solved.solvedSnapshot.dimensionStatuses[0]?.solvedValue).toBeCloseTo(
      1.2,
      10,
    );
    const solvedCircles = new Map(
      solved.solvedSnapshot.solvedEntities
        .filter((entity) => entity.kind === "circle")
        .map((entity) => [entity.entityId, entity] as const),
    );
    const solvedSeed = solvedCircles.get(entities[0]!.entityId)!;
    const solvedOutput = solvedCircles.get(entities[1]!.entityId)!;
    expect(solvedSeed.solvedRadius).toBeCloseTo(2.2, 6);
    expect(solvedOutput.solvedRadius).toBeCloseTo(1.2, 8);
    expect(solvedSeed.solvedRadius).not.toBeCloseTo(2, 6);

    const fresh = evaluateSketchDerivations({
      definition: {
        ...definition,
        entities: definition.entities.map((entity) =>
          entity.entityId === solvedSeed.entityId && entity.kind === "circle"
            ? { ...entity, radius: solvedSeed.solvedRadius }
            : entity,
        ),
      },
      modelingTolerance: 1e-3,
    }).definition;
    const freshOutput = fresh.entities.find(
      (entity) => entity.entityId === solvedOutput.entityId,
    );
    expect(freshOutput?.kind).toBe("circle");
    if (freshOutput?.kind === "circle") {
      expect(solvedOutput.solvedRadius).toBeCloseTo(freshOutput.radius, 10);
    }
  }

  async function testOffsetArcScalarStateFollowsDefiningPoints() {
    const points = [
      makePoint("sketch_point_offset_arc_c", "Seed center", 0, 0),
      makePoint("sketch_point_offset_arc_s", "Seed start", 2, 0),
      makePoint("sketch_point_offset_arc_e", "Seed end", 0, 2),
      makePoint("sketch_point_offset_arc_oc", "Output center", 0, 0),
      makePoint("sketch_point_offset_arc_os", "Output start", 1, 0),
      makePoint("sketch_point_offset_arc_oe", "Output end", 0, 1),
    ];
    const entities = [
      makeArc(
        "sketch_entity_offset_arc_seed",
        "Seed arc",
        points[0]!.pointId,
        points[1]!.pointId,
        points[2]!.pointId,
      ),
      makeArc(
        "sketch_entity_offset_arc_output",
        "Output arc",
        points[3]!.pointId,
        points[4]!.pointId,
        points[5]!.pointId,
      ),
    ];
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: ["dimension_offset_arc_diameter"],
      dimensions: [
        {
          dimensionId: "dimension_offset_arc_diameter",
          kind: "diameter",
          label: "Derived arc diameter",
          entityId: entities[1]!.entityId,
          value: 2.4,
        },
      ],
      derivedRelationshipIds: ["derivation_offset_arc"],
      derivedRelationships: [
        {
          derivationId: "derivation_offset_arc",
          kind: "offset",
          label: "Arc offset",
          seedEntityIds: [entities[0]!.entityId],
          distance: 1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [
            {
              seedEntityId: entities[0]!.entityId,
              outputEntityId: entities[1]!.entityId,
              instanceIndex: 1,
              seedPointIds: points.slice(0, 3).map((point) => point.pointId),
              outputPointIds: points.slice(3).map((point) => point.pointId),
            },
          ],
        },
      ],
    };
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const seedState = program.system.entityStates.get(entities[0]!.entityId)!;
    const outputState = program.system.entityStates.get(entities[1]!.entityId)!;
    expect(seedState.kind).toBe("arc");
    expect(outputState.kind).toBe("arc");
    if (seedState.kind !== "arc" || outputState.kind !== "arc") return;
    for (const scalarIndex of [
      seedState.baseIndex,
      seedState.baseIndex + 1,
      seedState.baseIndex + 2,
      outputState.baseIndex,
      outputState.baseIndex + 1,
      outputState.baseIndex + 2,
    ]) {
      expect(
        program.system.parameterProjection.authorityVariableIndices,
        "Offset source/output arc scalars must follow their authoritative defining points.",
      ).not.toContain(scalarIndex);
    }
    const commonRadiusValues = new Float64Array(program.system.initialValues);
    const seedEndRecord = program.system.pointRecords.get(points[2]!.pointId)!;
    commonRadiusValues[seedEndRecord.baseIndex] += 0.2;
    assertGradientMatchesFiniteDifference(
      definition,
      `constraint_internal_arc_common_radius_${entities[0]!.entityId}`,
      1e-5,
      1e-6,
      commonRadiusValues,
    );
    assertGradientMatchesFiniteDifference(
      definition,
      "dimension_offset_arc_diameter",
      1e-5,
    );
    const sourceDimensionDefinition: SketchDefinition = {
      ...definition,
      dimensionIds: ["dimension_offset_arc_source_diameter"],
      dimensions: [
        {
          ...definition.dimensions[0]!,
          dimensionId: "dimension_offset_arc_source_diameter",
          label: "Source arc diameter",
          entityId: entities[0]!.entityId,
          value: 4.4,
        },
      ],
    };
    assertGradientMatchesFiniteDifference(
      sourceDimensionDefinition,
      "dimension_offset_arc_source_diameter",
      1e-5,
    );
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    const dimensionStatus = solved.solvedSnapshot.dimensionStatuses[0];
    expect(dimensionStatus?.status).toBe("driving");
    expect(dimensionStatus?.solvedValue).toBeCloseTo(2.4, 6);
    const seed = solved.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === entities[0]!.entityId,
    );
    const output = solved.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === entities[1]!.entityId,
    );
    expect(seed?.kind).toBe("arc");
    expect(output?.kind).toBe("arc");
    if (seed?.kind !== "arc" || output?.kind !== "arc") return;
    const solvedPoints = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const seedCenter = solvedPoints.get(points[0]!.pointId)!;
    const seedStart = solvedPoints.get(points[1]!.pointId)!;
    const seedEnd = solvedPoints.get(points[2]!.pointId)!;
    const center = solvedPoints.get(points[3]!.pointId)!;
    const start = solvedPoints.get(points[4]!.pointId)!;
    const end = solvedPoints.get(points[5]!.pointId)!;
    expect(
      Math.hypot(
        seedStart[0] - points[1]!.position[0],
        seedStart[1] - points[1]!.position[1],
      ),
      "The output diameter must move source defining points rather than private output state.",
    ).toBeGreaterThan(0.09);
    const seedStartRadius = Math.hypot(
      seedStart[0] - seedCenter[0],
      seedStart[1] - seedCenter[1],
    );
    const seedEndRadius = Math.hypot(
      seedEnd[0] - seedCenter[0],
      seedEnd[1] - seedCenter[1],
    );
    expect(Math.abs(seedStartRadius - 2.2)).toBeLessThan(
      tolerances.coincidence,
    );
    expect(Math.abs(seedEndRadius - 2.2)).toBeLessThan(tolerances.coincidence);
    expect(Math.abs(seedEndRadius - seedStartRadius)).toBeLessThan(
      tolerances.coincidence,
    );
    expect(seed.centerPosition[0]).toBeCloseTo(seedCenter[0], 10);
    expect(seed.centerPosition[1]).toBeCloseTo(seedCenter[1], 10);
    expect(seed.startPosition[0]).toBeCloseTo(seedStart[0], 10);
    expect(seed.startPosition[1]).toBeCloseTo(seedStart[1], 10);
    expect(seed.endPosition[0]).toBeCloseTo(seedEnd[0], 10);
    expect(seed.endPosition[1]).toBeCloseTo(seedEnd[1], 10);
    expect(output.centerPosition[0]).toBeCloseTo(center[0], 10);
    expect(output.centerPosition[1]).toBeCloseTo(center[1], 10);
    expect(output.startPosition[0]).toBeCloseTo(start[0], 10);
    expect(output.startPosition[1]).toBeCloseTo(start[1], 10);
    expect(output.endPosition[0]).toBeCloseTo(end[0], 10);
    expect(output.endPosition[1]).toBeCloseTo(end[1], 10);
    expect(
      Math.hypot(
        output.startPosition[0] - output.centerPosition[0],
        output.startPosition[1] - output.centerPosition[1],
      ),
    ).toBeCloseTo(Math.hypot(start[0] - center[0], start[1] - center[1]), 10);
    expect(
      Math.atan2(
        output.startPosition[1] - output.centerPosition[1],
        output.startPosition[0] - output.centerPosition[0],
      ),
    ).toBeCloseTo(Math.atan2(start[1] - center[1], start[0] - center[0]), 10);
    expect(
      Math.atan2(
        output.endPosition[1] - output.centerPosition[1],
        output.endPosition[0] - output.centerPosition[0],
      ),
    ).toBeCloseTo(Math.atan2(end[1] - center[1], end[0] - center[0]), 10);

    const fresh = evaluateSketchDerivations({
      definition: {
        ...definition,
        points: definition.points.map((point) => ({
          ...point,
          position: solvedPoints.get(point.pointId) ?? point.position,
        })),
      },
      modelingTolerance: 1e-3,
    }).definition;
    for (const pointId of [
      points[3]!.pointId,
      points[4]!.pointId,
      points[5]!.pointId,
    ]) {
      const solvedPosition = solvedPoints.get(pointId)!;
      const freshPosition = fresh.points.find(
        (point) => point.pointId === pointId,
      )!.position;
      expect(solvedPosition[0]).toBeCloseTo(freshPosition[0], 10);
      expect(solvedPosition[1]).toBeCloseTo(freshPosition[1], 10);
    }
    const outputStartRadius = Math.hypot(
      start[0] - center[0],
      start[1] - center[1],
    );
    const outputEndRadius = Math.hypot(end[0] - center[0], end[1] - center[1]);
    expect(Math.abs(outputStartRadius - 1.2)).toBeLessThan(
      tolerances.coincidence,
    );
    expect(Math.abs(outputEndRadius - outputStartRadius)).toBeLessThan(
      tolerances.coincidence,
    );

    const radialGap = 1e-5;
    const mismatchedDefinition: SketchDefinition = {
      ...definition,
      points: definition.points.map((point) =>
        point.pointId === points[2]!.pointId
          ? { ...point, position: [0, 2 + radialGap] }
          : point,
      ),
      dimensionIds: [],
      dimensions: [],
    };
    const mismatched = solveSketchDefinitionCore({
      definition: mismatchedDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
      strategy: "gaussNewton",
    });
    expect(0.5 * radialGap * radialGap).toBeLessThan(1e-8);
    expect(radialGap).toBeGreaterThan(tolerances.coincidence);
    expect(mismatched.status.solveState).toBe("failed");
    expect(mismatched.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "offset-arc-common-circle-unsatisfied",
        severity: "error",
        target: { kind: "entity", entityId: entities[0]!.entityId },
      }),
    );
    expect(
      () =>
        createCompiledSketchSolveSession({
          sessionId: "interactive_sketch_solve_offset_arc_invalid_initial",
          program: compileSketchSolveProgram({
            definition: mismatchedDefinition,
            tolerances,
            modelingTolerance: 1e-3,
            partialSolvePolicy: "failOnConflict",
            strategy: "gaussNewton",
          }),
        }),
      "An invalid initial common-circle snapshot must not become lastAcceptedSnapshot.",
    ).toThrow(/common-circle snapshot.*radial gap/);

    const dragProgram = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
      strategy: "gaussNewton",
    });
    const dragSession = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_offset_arc_radial_gap",
      program: dragProgram,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    const acceptedBeforeDrag = dragSession.lastAcceptedSnapshot;
    const dragEndRecord = dragProgram.system.pointRecords.get(
      points[2]!.pointId,
    )!;
    const acceptedEnd = acceptedBeforeDrag.solvedPoints.find(
      (point) => point.pointId === points[2]!.pointId,
    )!.solvedPosition;
    const acceptedCenter = acceptedBeforeDrag.solvedPoints.find(
      (point) => point.pointId === points[0]!.pointId,
    )!.solvedPosition;
    const acceptedRadius = Math.hypot(
      acceptedEnd[0] - acceptedCenter[0],
      acceptedEnd[1] - acceptedCenter[1],
    );
    const radialScale = (acceptedRadius + radialGap) / acceptedRadius;
    const invalidDragEnd = [
      acceptedCenter[0] + (acceptedEnd[0] - acceptedCenter[0]) * radialScale,
      acceptedCenter[1] + (acceptedEnd[1] - acceptedCenter[1]) * radialScale,
    ] as const;
    dragSession.values[dragEndRecord.baseIndex] = invalidDragEnd[0];
    dragSession.values[dragEndRecord.baseIndex + 1] = invalidDragEnd[1];
    const dragged = updateCompiledSketchSolveSession(dragSession, {
      kind: "sketchPoint",
      pointId: points[2]!.pointId,
      position: invalidDragEnd,
    });
    expect(dragged.kind).toBe("blocked");
    expect(dragged.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "offset-arc-common-circle-unsatisfied",
        severity: "error",
      }),
    );
    expect(dragged.solvedSnapshot).toBe(acceptedBeforeDrag);
    expect(dragSession.lastAcceptedSnapshot).toBe(acceptedBeforeDrag);
  }

  async function testSplinePointResidualPreservesSubnormalPhysicalGap() {
    const splinePoints = [
      makePoint("sketch_point_tiny_s0", "S0", 0, 0),
      makePoint("sketch_point_tiny_s1", "S1", 1, 0),
    ];
    const contact = makePoint(
      "sketch_point_tiny_contact",
      "Contact",
      0,
      1e-200,
    );
    const spline = {
      kind: "spline" as const,
      entityId: "sketch_entity_tiny_spline" as const,
      label: "Tiny-gap spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_tiny_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_tiny_0", "occ_tiny_1"],
      pointOccurrences: [
        {
          occurrenceId: "occ_tiny_0",
          pointId: splinePoints[0]!.pointId,
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "occ_tiny_1",
          pointId: splinePoints[1]!.pointId,
          tangent: { kind: "automatic" as const },
        },
      ],
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const localConstraint = {
      constraintId: "constraint_tiny_local_spline" as const,
      kind: "pointOnCurve" as const,
      label: "Tiny local gap",
      point: { kind: "localPoint" as const, pointId: contact.pointId },
      curve: { kind: "localEntity" as const, entityId: spline.entityId },
    };
    const localDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [
        ...splinePoints.map((point) => point.pointId),
        contact.pointId,
      ],
      points: [...splinePoints, contact],
      entityIds: [spline.entityId],
      entities: [spline],
      constraintIds: [localConstraint.constraintId],
      constraints: [localConstraint],
      dimensionIds: [],
      dimensions: [],
    };
    const local = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition: localDefinition,
      constraintId: localConstraint.constraintId,
      values: getSketchSolveInitialValuesForTest(
        localDefinition,
        tolerances,
        1e-3,
      ),
    });
    expect(local.residual).toBe(Number.MIN_VALUE);

    const reconstruction = reconstructSplineAggregate(
      spline,
      Object.fromEntries(
        splinePoints.map((point) => [point.pointId, point.position]),
      ),
    );
    expect(reconstruction.validity).toBe("valid");
    if (reconstruction.validity !== "valid") return;
    const projectedConstraint = {
      constraintId: "constraint_tiny_projected_spline" as const,
      kind: "pointOnProjectedCurve" as const,
      label: "Tiny projected gap",
      point: { kind: "localPoint" as const, pointId: contact.pointId },
      projectedCurve: {
        kind: "projectedGeometry" as const,
        reference: {
          kind: "projectedSpline" as const,
          referenceId: "ref_tiny_spline" as const,
          geometryId: "projected_geometry_tiny_spline" as const,
        },
      },
    };
    const projectedDefinition: SketchDefinition = {
      ...localDefinition,
      referenceIds: ["ref_tiny_spline"],
      references: [
        {
          referenceId: "ref_tiny_spline",
          kind: "modelReference",
          label: "Tiny external spline",
          source: { kind: "edge", bodyId: "body_1", edgeId: "edge_1" },
          projectionMode: "projectAlongPlaneNormal",
        },
      ],
      entityIds: [],
      entities: [],
      pointIds: [contact.pointId],
      points: [contact],
      constraintIds: [projectedConstraint.constraintId],
      constraints: [projectedConstraint],
    };
    const projectedReferences = [
      {
        referenceId: "ref_tiny_spline" as const,
        status: "projected" as const,
        geometry: [
          {
            geometryId: "projected_geometry_tiny_spline" as const,
            kind: "spline" as const,
            representation: {
              kind: "neutralCubicSpans" as const,
              spans: reconstruction.spans,
            },
          },
        ],
        diagnostics: [],
      },
    ];
    const projected = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition: projectedDefinition,
      projectedReferences,
      constraintId: projectedConstraint.constraintId,
      values: getSketchSolveInitialValuesForTest(
        projectedDefinition,
        tolerances,
        1e-3,
      ),
    });
    expect(projected.residual).toBe(Number.MIN_VALUE);
  }

  async function testInvalidOrdinarySplineSolveDoesNotMutateAuthoredInput() {
    const points = [
      makePoint("sketch_point_bad0", "Bad 0", 0, 0),
      makePoint("sketch_point_bad1", "Bad 1", 0, 0),
      makePoint("sketch_point_bad_contact", "Bad contact", 1, 1),
    ];
    const spline = {
      kind: "spline" as const,
      entityId: "sketch_entity_bad_spline" as const,
      label: "Invalid spline",
      target: {
        kind: "sketchEntity" as const,
        sketchId: "sketch_primary" as const,
        entityId: "sketch_entity_bad_spline" as const,
      },
      isConstruction: false,
      pointOccurrenceIds: ["occ_bad0", "occ_bad1"],
      pointOccurrences: [
        {
          occurrenceId: "occ_bad0",
          pointId: points[0]!.pointId,
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "occ_bad1",
          pointId: points[1]!.pointId,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
      ],
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const constraint = {
      constraintId: "constraint_bad_contact" as const,
      kind: "pointOnCurve" as const,
      label: "Impossible contact",
      point: { kind: "localPoint" as const, pointId: points[2]!.pointId },
      curve: { kind: "localEntity" as const, entityId: spline.entityId },
    };
    const definition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: [spline.entityId],
      entities: [spline],
      constraintIds: [constraint.constraintId],
      constraints: [constraint],
      dimensionIds: [],
      dimensions: [],
    };
    const before = structuredClone(definition);
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("failed");
    expect(definition).toEqual(before);
    expect(
      solved.solvedSnapshot.solvedEntities.find(
        (entity) =>
          entity.entityId === spline.entityId && entity.kind === "spline",
      ),
    ).toMatchObject({ reconstruction: { validity: "invalid" } });
  }

  function makeEqualOffsetDefinition(input?: {
    points?: readonly (readonly [number, number])[];
    sides?: readonly ["left" | "right", "left" | "right"];
    reverseEntities?: readonly string[];
    drivenDistance?: number;
  }): SketchDefinition {
    const coordinates =
      input?.points ??
      ([
        [0, 0],
        [4, 0],
        [0, 2],
        [4, 2],
        [0, 6],
        [4, 6],
        [0, 8],
        [4, 8],
      ] as const);
    const points = coordinates.map((position, index) =>
      makePoint(
        `sketch_point_equal_offset_${index}`,
        `Equal offset ${index}`,
        position[0],
        position[1],
      ),
    );
    const reverse = new Set(input?.reverseEntities ?? []);
    const lines = [0, 1, 2, 3].map((index) => {
      const first = points[index * 2]!.pointId;
      const second = points[index * 2 + 1]!.pointId;
      const entityId = `sketch_entity_equal_offset_${index}`;
      return makeLine(
        entityId,
        `Equal offset line ${index}`,
        reverse.has(entityId) ? second : first,
        reverse.has(entityId) ? first : second,
      );
    });
    const equalOffset = {
      constraintId: "constraint_equal_offset" as const,
      kind: "equalOffset" as const,
      label: "Equal offsets",
      pairs: [
        {
          seedEntityId: lines[0]!.entityId,
          offsetEntityId: lines[1]!.entityId,
          side: input?.sides?.[0] ?? "left",
        },
        {
          seedEntityId: lines[2]!.entityId,
          offsetEntityId: lines[3]!.entityId,
          side: input?.sides?.[1] ?? "left",
        },
      ] as const,
    };
    const dimension =
      input?.drivenDistance === undefined
        ? []
        : [
            {
              dimensionId: "dimension_equal_offset_magnitude" as const,
              kind: "lineDistance" as const,
              label: "Offset magnitude",
              lines: [
                { kind: "localEntity" as const, entityId: lines[0]!.entityId },
                { kind: "localEntity" as const, entityId: lines[1]!.entityId },
              ] as const,
              value: input.drivenDistance,
            },
          ];
    return {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: lines.map((line) => line.entityId),
      entities: lines,
      constraintIds: [equalOffset.constraintId],
      constraints: [equalOffset],
      dimensionIds: dimension.map((entry) => entry.dimensionId),
      dimensions: dimension,
    };
  }

  async function testEqualOffsetFreeMagnitudeAndComponentCoupling() {
    const definition = makeEqualOffsetDefinition();
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(solved.solvedSnapshot.constraintStatuses).toEqual([
      { constraintId: "constraint_equal_offset", status: "satisfied" },
    ]);
    expect(definition.derivedRelationships).toBeUndefined();
    expect(solved.solvedSnapshot.solvedEntities).toHaveLength(4);

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    const metadata = program.equationMetadata.find(
      (entry) => entry.id === "constraint_equal_offset",
    );
    expect(metadata?.variableIndices).toHaveLength(16);
    expect(program.components).toHaveLength(1);
    expect(program.components[0]?.entityIds).toEqual(definition.entityIds);
    const session = createCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_equal_offset",
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    });
    expect(sketchDraggedPointHasFreeDof(session, definition.pointIds[0]!)).toBe(
      true,
    );
  }

  async function testEqualOffsetUsesSeparateMagnitudeDriver() {
    const definition = makeEqualOffsetDefinition({
      points: [
        [0, 0],
        [4, 0],
        [0, 3],
        [4, 3],
        [0, 6],
        [4, 6],
        [0, 9],
        [4, 9],
      ],
      drivenDistance: 3,
    });
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
      strategy: "levenbergMarquardt",
    });
    expect(solved.status.solveState).toBe("solved");
    expect(solved.solvedSnapshot.constraintStatuses[0]?.status).toBe(
      "satisfied",
    );
    expect(solved.solvedSnapshot.dimensionStatuses[0]).toMatchObject({
      dimensionId: "dimension_equal_offset_magnitude",
      status: "driving",
      solvedValue: 3,
    });
  }

  async function testEqualOffsetOrientationSideObliqueAndGradient() {
    const angle = 0.63;
    const axis = [Math.cos(angle), Math.sin(angle)] as const;
    const normal = [-axis[1], axis[0]] as const;
    const point = (
      along: number,
      across: number,
    ): readonly [number, number] => [
      axis[0] * along + normal[0] * across,
      axis[1] * along + normal[1] * across,
    ];
    const definition = makeEqualOffsetDefinition({
      points: [
        point(0, 0),
        point(5, 0),
        point(0, 2),
        point(5, 2),
        point(1, 7),
        point(6, 7),
        point(1, 5),
        point(6, 5),
      ],
      sides: ["right", "right"],
      reverseEntities: [
        "sketch_entity_equal_offset_0",
        "sketch_entity_equal_offset_3",
      ],
    });
    const initial = evaluateSketchScalarConstraintForTest({
      tolerances,
      modelingTolerance: 1e-3,
      definition,
      constraintId: "constraint_equal_offset",
      values: getSketchSolveInitialValuesForTest(definition, tolerances, 1e-3),
    });
    expect(initial.residual).toBeLessThan(1e-20);

    const perturbed = getSketchSolveInitialValuesForTest(
      definition,
      tolerances,
      1e-3,
    );
    perturbed[5] += 0.37;
    perturbed[10] -= 0.21;
    assertGradientMatchesFiniteDifference(
      definition,
      "constraint_equal_offset",
      2e-6,
      1e-6,
      perturbed,
    );
  }

  async function testEqualOffsetClassifiesAngularAndLinearToleranceSeparately() {
    const makeFixedDefinition = (
      points: readonly (readonly [number, number])[],
    ) => {
      const definition = makeEqualOffsetDefinition({ points });
      const fixed = definition.points.map((point, index) => ({
        constraintId: `constraint_equal_offset_fix_${index}`,
        kind: "fixPoint" as const,
        label: `Fix equal-offset point ${index}`,
        pointId: point.pointId,
        position: point.position,
      }));
      definition.constraints.push(...fixed);
      definition.constraintIds.push(
        ...fixed.map((constraint) => constraint.constraintId),
      );
      return definition;
    };
    const angularViolation = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4, 2 + 4e-5],
      [0, 6],
      [4, 6],
      [0, 8],
      [4, 8 + 4e-5],
    ]);
    const angularSolve = solveSketchDefinitionCore({
      definition: angularViolation,
      tolerances: {
        ...tolerances,
        coincidence: 1e-3,
        angleRadians: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(angularSolve.status.solveState).toBe("failed");
    expect(angularSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
      constraintId: "constraint_equal_offset",
      status: "unsatisfied",
    });

    const linearViolation = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4, 2],
      [0, 6],
      [4, 6],
      [0, 8 + 1e-5],
      [4, 8 + 1e-5],
    ]);
    const linearSolve = solveSketchDefinitionCore({
      definition: linearViolation,
      tolerances: {
        ...tolerances,
        coincidence: 1e-6,
        angleRadians: 1e-3,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(linearSolve.status.solveState).toBe("failed");
    expect(linearSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
      constraintId: "constraint_equal_offset",
      status: "unsatisfied",
    });

    const angularGap = 1e-7;
    const angularAccepted = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4 * Math.cos(angularGap), 2 + 4 * Math.sin(angularGap)],
      [0, 6],
      [4, 6],
      [0, 8],
      [4 * Math.cos(angularGap), 8 + 4 * Math.sin(angularGap)],
    ]);
    const angularBoundary = Math.asin(
      Math.abs(
        Math.sin(angularGap) /
          Math.hypot(Math.cos(angularGap), Math.sin(angularGap)),
      ),
    );
    for (const angleRadians of [angularBoundary, angularBoundary + 1e-9]) {
      const accepted = solveSketchDefinitionCore({
        definition: angularAccepted,
        tolerances: { ...tolerances, coincidence: 1e-3, angleRadians },
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(accepted.status.solveState).toBe("solved");
      expect(accepted.solvedSnapshot.constraintStatuses[0]?.status).toBe(
        "satisfied",
      );
      expect(
        accepted.solvedSnapshot.solvedPoints.map((point) =>
          point.solvedPosition,
        ),
      ).toEqual(angularAccepted.points.map((point) => point.position));
    }

    const linearGap = 1e-7;
    const linearAccepted = makeFixedDefinition([
      [0, 0],
      [4, 0],
      [0, 2],
      [4, 2],
      [0, 6],
      [4, 6],
      [0, 8 + linearGap],
      [4, 8 + linearGap],
    ]);
    const linearBoundary = Math.abs(2 - (8 + linearGap - 6));
    for (const coincidence of [linearBoundary, linearBoundary + 1e-9]) {
      const accepted = solveSketchDefinitionCore({
        definition: linearAccepted,
        tolerances: { ...tolerances, coincidence, angleRadians: 1e-3 },
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(accepted.status.solveState).toBe("solved");
      expect(accepted.solvedSnapshot.constraintStatuses[0]?.status).toBe(
        "satisfied",
      );
      expect(
        accepted.solvedSnapshot.solvedPoints.map((point) =>
          point.solvedPosition,
        ),
      ).toEqual(linearAccepted.points.map((point) => point.position));
    }
  }

  async function testEqualOffsetRejectsIncompatibleAndDegeneratePairs() {
    const incompatible = makeEqualOffsetDefinition();
    incompatible.entities[3] = {
      kind: "circle",
      entityId: incompatible.entities[3]!.entityId,
      label: "Not a line",
      target: incompatible.entities[3]!.target,
      isConstruction: false,
      centerPointId: incompatible.points[6]!.pointId,
      radius: 2,
    };
    const incompatibleValidation = validateSketchDefinitionCore({
      definition: incompatible,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(incompatibleValidation.isValid).toBe(false);
    expect(incompatibleValidation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "invalid-equal-offset-line-pair" }),
    );

    const selfPaired = makeEqualOffsetDefinition();
    const equalOffset = selfPaired.constraints[0];
    if (equalOffset?.kind !== "equalOffset") {
      throw new Error("Expected equal-offset fixture constraint.");
    }
    equalOffset.pairs[0].offsetEntityId = equalOffset.pairs[0].seedEntityId;
    const selfPairedProgram = compileSketchSolveProgram({
      definition: selfPaired,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(
      selfPairedProgram.equationMetadata.some(
        (metadata) => metadata.id === "constraint_equal_offset",
      ),
    ).toBe(false);
    const selfPairedSolve = solveSketchDefinitionCore({
      definition: selfPaired,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(selfPairedSolve.status.solveState).toBe("failed");
    expect(selfPairedSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
      constraintId: "constraint_equal_offset",
      status: "conflicting",
    });

    const validPrior = solveSketchDefinitionCore({
      definition: makeEqualOffsetDefinition(),
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    }).solvedSnapshot;
    for (const nonFiniteCoordinate of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const nonFinite = makeEqualOffsetDefinition();
      nonFinite.points[1]!.position = [nonFiniteCoordinate, 0];
      const nonFiniteEvaluation = evaluateSketchScalarConstraintForTest({
        tolerances,
        modelingTolerance: 1e-3,
        definition: nonFinite,
        constraintId: "constraint_equal_offset",
        values: getSketchSolveInitialValuesForTest(nonFinite, tolerances, 1e-3),
      });
      expect(nonFiniteEvaluation.residual).toBe(Number.POSITIVE_INFINITY);
      expect(
        [...nonFiniteEvaluation.gradient].every(
          (component) => Number.isFinite(component) && component === 0,
        ),
      ).toBe(true);
      const nonFiniteSolve = solveSketchDefinitionCore({
        definition: nonFinite,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(nonFiniteSolve.status.solveState).toBe("failed");
      expect(nonFiniteSolve.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "non-finite-equal-offset-geometry",
          severity: "error",
        }),
      );
      expect(nonFiniteSolve.solvedSnapshot.constraintStatuses[0]).toEqual({
        constraintId: "constraint_equal_offset",
        status: "conflicting",
      });

      const nonFiniteProgram = compileSketchSolveProgram({
        definition: nonFinite,
        tolerances,
        modelingTolerance: 1e-3,
        partialSolvePolicy: "failOnConflict",
      });
      expect(() =>
        createCompiledSketchSolveSession({
          sessionId: "interactive_sketch_solve_equal_offset_non_finite",
          program: nonFiniteProgram,
        }),
      ).toThrow(/without an acceptable solved snapshot/);
      expect(() =>
        createCompiledSketchSolveSession({
          sessionId: "interactive_sketch_solve_equal_offset_failed_prior",
          program: nonFiniteProgram,
          priorSolvedSnapshot: nonFiniteSolve.solvedSnapshot,
        }),
      ).toThrow(/without an acceptable solved snapshot/);

      const sessionWithValidPrior = createCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_equal_offset_valid_prior",
        program: nonFiniteProgram,
        priorSolvedSnapshot: validPrior,
      });
      expect(sessionWithValidPrior.lastAcceptedSnapshot).toBe(validPrior);
    }

    const sharedPoint = makePoint(
      "sketch_point_equal_offset_0",
      "Only shared point",
      0,
      0,
    );
    const oldPoint = makePoint("sketch_point_old", "Old point", 1, 0);
    const oldLine = makeLine(
      "sketch_entity_old",
      "Old line",
      sharedPoint.pointId,
      oldPoint.pointId,
    );
    const unrelatedDefinition: SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: [sharedPoint.pointId, oldPoint.pointId],
      points: [sharedPoint, oldPoint],
      entityIds: [oldLine.entityId],
      entities: [oldLine],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const unrelatedPrior = solveSketchDefinitionCore({
      definition: unrelatedDefinition,
      tolerances,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    }).solvedSnapshot;
    expect(unrelatedPrior.status.solveState).toBe("solved");
    const invalidForUnrelatedPrior = makeEqualOffsetDefinition();
    invalidForUnrelatedPrior.points[1]!.position = [Number.NaN, 0];
    expect(() =>
      createCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_equal_offset_unrelated_prior",
        program: compileSketchSolveProgram({
          definition: invalidForUnrelatedPrior,
          tolerances,
          modelingTolerance: 1e-3,
          partialSolvePolicy: "failOnConflict",
        }),
        priorSolvedSnapshot: unrelatedPrior,
      }),
    ).toThrow(/without an acceptable solved snapshot/);

    const degenerate = makeEqualOffsetDefinition();
    degenerate.points[1]!.position = degenerate.points[0]!.position;
    const degenerateValidation = validateSketchDefinitionCore({
      definition: degenerate,
      tolerances,
      modelingTolerance: 1e-3,
    });
    expect(degenerateValidation.isValid).toBe(false);
    expect(degenerateValidation.diagnostics).toContainEqual(
      expect.objectContaining({ code: "degenerate-line-segment" }),
    );
  }

  async function run() {
    await testEqualOffsetFreeMagnitudeAndComponentCoupling();
    await testEqualOffsetUsesSeparateMagnitudeDriver();
    await testEqualOffsetOrientationSideObliqueAndGradient();
    await testEqualOffsetClassifiesAngularAndLinearToleranceSeparately();
    await testEqualOffsetRejectsIncompatibleAndDegeneratePairs();
    await testFixPoint();
    await testEuclideanDistance();
    await testHorizontalDistance();
    await testVerticalDistance();
    await testEditedParallelLineDistanceConverges();
    await testLineDistanceAdmissionAndStatusShareAngularTolerance();
    await testNeverAdmittedLineDimensionsAreUnsatisfied();
    await testRequirementStatusesUseDocumentLinearAndAngularTolerance();
    await testLowLossStartsStillSolveUntilEveryRequirementHolds();
    await testExpandedDimensionStatuses();
    await testAxisQualifiedDistance();
    await testObtuseLineAngleDimension();
    await testHorizontalLine();
    await testVerticalLine();
    await testAngleBetweenPoints();
    await testAngleBetweenPointsSpecificCase();
    await testEqualLength();
    await testParallelLines();
    await testPerpendicularLines();
    await testCollinearSolvesLocalLinesAndPointsAgainstInfiniteGeometry();
    await testCollinearSolvesAgainstProjectedLineWithoutMovingReference();
    await testCollinearValidationReportsMissingAndDegenerateTargets();
    await testArcStartPointCoincident();
    await testArcEndPointCoincident();
    await testAxisAlignedRectangle();
    await testProjectedDatumConstraintSeedsLogoReferenceImageAnchorTranslation();
    await testDefaultSolveRecoversFromStalledImportedProfile();
    await testRotatedRectangle();
    await testRotatedRectangleGradientDescent();
    await testRotatedRectangleGaussNewton();
    await testRotatedRectangleLevenbergMarquardt();
    await testValidationRejectsDegenerateLine();
    await testValidationRejectsPointIdsWithoutRecords();
    await testValidationRejectsMissingConstraintReferences();
    await testValidationRejectsDuplicatePointRecords();
    await testValidationRejectsDuplicateEntityRecords();
    await testCircleRadiusDimensionDrivesSolvedCircleRadius();
    await testCircleDiameterDimensionDrivesSolvedCircleRadius();
    await testCompiledSolveProgramReuseAndInvalidation();
    await testInteractiveSessionWarmStartStaleRejectionAndComponentIsolation();
    await testCompiledInteractiveDragKeepsInitiallyCoincidentPointsTogether();
    await testCompiledInteractiveDragTranslatesRigidRectangle();
    await testOrdinarySplineUsesAnalyticOwnerJacobiansAndAuthoredHandleVariables();
    await testOrdinarySplineAliasClosureKeepsAutomaticTangentsDerivedAndExactZeroAuthored();
    await testDrivenOutputConstraintUsesSourceAndAxisJacobians();
    await testProjectionSupportClosesOverOrderedDerivedChains();
    await testDimensionStatusUsesLinearAndAngularTolerancePolicies();
    await testOffsetOutputRequirementDrivesSourceAuthority();
    await testOffsetCircleScalarAuthorityMovesTheSource();
    await testOffsetArcScalarStateFollowsDefiningPoints();
    await testSplinePointResidualPreservesSubnormalPhysicalGap();
    await testProjectedSourceSamplesAreRejectedAsDisplayOnly();
    await testInvalidOrdinarySplineSolveDoesNotMutateAuthoredInput();
  }

  await run();
});
