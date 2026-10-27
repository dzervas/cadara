import {
  tolerances,
  assertClose,
  assertGradientMatchesFiniteDifference,
  makeArc,
  makeCircle,
  makeLine,
  makePoint,
} from "./solver-basic.fixtures";
import { solveSketchDefinitionCore } from "./solve-sketch";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect } from "vitest";

export async function testExpandedDimensionStatuses() {
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

export async function testAxisQualifiedDistance() {
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

export async function testObtuseLineAngleDimension() {
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

export async function testHorizontalLine() {
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

export async function testVerticalLine() {
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

export async function testAngleBetweenPoints() {
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

export async function testAngleBetweenPointsSpecificCase() {
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

export async function testEqualLength() {
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

export async function testParallelLines() {
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

export async function testPerpendicularLines() {
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
