import { solveSketchDefinitionCore } from "./solve-sketch";
import type { SketchSolveStrategy } from "./solve-types";
import {
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
} from "./solver-test-seams";
import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect } from "vitest";

export function assertClose(
    actual: number,
    expected: number,
    tolerance: number,
    message: string,
  ) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message} Expected ${expected}, received ${actual}.`);
    }
  }

export const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  } as const;

export function makePoint(pointId: string, label: string, x: number, y: number) {
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

export function makeLine(
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

export function makeArc(
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

export function makeCircle(
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

export function cloneValues(values: Float64Array) {
    return new Float64Array(values);
  }

export function assertGradientMatchesFiniteDifference(
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

export function assertRotatedRectangleMatchesIsotopeBranches(
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

export function createLogoReferenceImageAnchorFixture(): SketchDefinition {
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

export function createCollinearDefinition(input: {
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

export async function assertRotatedRectangleSolvesWithStrategy(
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

export function createIndependentLineComponentsDefinition(): SketchDefinition {
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

export function makeEqualOffsetDefinition(input?: {
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
