import {
  tolerances,
  assertClose,
  assertGradientMatchesFiniteDifference,
  assertRotatedRectangleSolvesWithStrategy,
  createLogoReferenceImageAnchorFixture,
  makeArc,
  makeLine,
  makePoint,
} from "./solver-basic.fixtures";
import { solveSketchDefinitionCore } from "./solve-sketch";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect } from "vitest";

export async function testArcStartPointCoincident() {
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

export async function testArcEndPointCoincident() {
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

export async function testAxisAlignedRectangle() {
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

export async function testRotatedRectangle() {
    await assertRotatedRectangleSolvesWithStrategy("bfgs", {
      expectedSolveState: "solved",
      branchTolerance: 1e-5,
      dimensionTolerance: 1e-4,
    });
  }

export async function testProjectedDatumConstraintSeedsLogoReferenceImageAnchorTranslation() {
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

export async function testRotatedRectangleGradientDescent() {
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

export async function testRotatedRectangleGaussNewton() {
    await assertRotatedRectangleSolvesWithStrategy("gaussNewton", {
      expectedSolveState: "partiallySolved",
      branchTolerance: 1e-1,
      dimensionTolerance: 1e-1,
    });
  }

export async function testRotatedRectangleLevenbergMarquardt() {
    await assertRotatedRectangleSolvesWithStrategy("levenbergMarquardt", {
      expectedSolveState: "partiallySolved",
      branchTolerance: 1e-1,
      dimensionTolerance: 1e-1,
    });
  }
