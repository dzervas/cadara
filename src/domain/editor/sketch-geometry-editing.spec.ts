import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  deriveSketchDisplayEntities,
  finishSketchGeometryDrag,
  getConnectedSketchEntitySelectionTargets,
  getSketchSessionRegionDiagnostics,
  getSketchSessionDisplayRenderables,
  getStableSketchSessionDisplayKey,
  getStableSketchSessionDisplayRenderables,
  getTransientSketchSessionDisplayRenderables,
  isSketchSvgRenderingEnabled,
  patchSketchStyleValue,
  patchSketchEditToolValue,
  refreshLiveRegionsAfterDebounce,
  selectSketchEditToolTarget,
  startSketchDraw,
  toggleSketchSvgRendering,
  updateSketchGeometryDrag,
  updateSketchPointer,
  acceptSketchDraw,
} from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { deriveSketchRegionsCore } from "@/contracts/sketch/region-extraction";
import { toolDefinitions } from "@/core/tools/tool-registry";

test("src/domain/editor/sketch-geometry-editing.spec.ts", () => {
  function assertClosePoint(
    actual: readonly [number, number] | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    expect(actual, `${message} Missing point.`).toBeTruthy();
    const distance = Math.hypot(
      actual[0] - expected[0],
      actual[1] - expected[1],
    );
    expect(
      distance < 1e-4,
      `${message} Expected ${expected.join(", ")}, received ${actual.join(", ")}.`,
    ).toBeTruthy();
  }

  function assertIncludesPoint(
    points: readonly { position: readonly [number, number] }[],
    expected: readonly [number, number],
    message: string,
  ) {
    expect(
      points.some(
        (point) =>
          Math.hypot(
            point.position[0] - expected[0],
            point.position[1] - expected[1],
          ) < 1e-4,
      ),
      `${message} Missing ${expected.join(", ")}.`,
    ).toBeTruthy();
  }

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

  function makeArc(
    entityId: string,
    label: string,
    centerPointId: string,
    startPointId: string,
    endPointId: string,
    sweepDirection: "clockwise" | "counterClockwise" = "counterClockwise",
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
      sweepDirection,
    };
  }

  function makeSpline(
    entityId: string,
    label: string,
    fitPointIds: readonly string[],
  ) {
    return {
      kind: "spline" as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: entityId as `sketch_entity_${string}`,
      } as const,
      isConstruction: false,
      fitPointIds: fitPointIds.map(
        (pointId) => pointId as `sketch_point_${string}`,
      ),
      degree: 2 as const,
    };
  }

  function makeDefinition(input: {
    pointIds: readonly string[];
    points: SketchDefinition["points"];
    entityIds: readonly string[];
    entities: SketchDefinition["entities"];
  }): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: input.pointIds as `sketch_point_${string}`[],
      points: input.points,
      entityIds: input.entityIds as `sketch_entity_${string}`[],
      entities: input.entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
  }

  function createSquareDefinition(withFixedOrigin: boolean): SketchDefinition {
    const constraints = [
      ...(withFixedOrigin
        ? [
            {
              constraintId: "constraint_fix_a" as const,
              kind: "fixPoint" as const,
              label: "Fix A",
              pointId: "sketch_point_a" as const,
              position: [0, 0] as const,
            },
          ]
        : []),
      {
        constraintId: "constraint_horizontal_ab" as const,
        kind: "horizontal" as const,
        label: "AB horizontal",
        entityId: "sketch_entity_ab" as const,
      },
      {
        constraintId: "constraint_horizontal_cd" as const,
        kind: "horizontal" as const,
        label: "CD horizontal",
        entityId: "sketch_entity_cd" as const,
      },
      {
        constraintId: "constraint_vertical_bc" as const,
        kind: "vertical" as const,
        label: "BC vertical",
        entityId: "sketch_entity_bc" as const,
      },
      {
        constraintId: "constraint_vertical_da" as const,
        kind: "vertical" as const,
        label: "DA vertical",
        entityId: "sketch_entity_da" as const,
      },
    ];

    return {
      schemaVersion: "sketch-definition/v1alpha1",
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
        makePoint("sketch_point_c", "C", 1, 1),
        makePoint("sketch_point_d", "D", 0, 1),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
      ],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: ["dimension_width", "dimension_height"],
      dimensions: [
        {
          dimensionId: "dimension_width",
          kind: "horizontalDistance",
          label: "Width",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 1,
        },
        {
          dimensionId: "dimension_height",
          kind: "verticalDistance",
          label: "Height",
          pointIds: ["sketch_point_a", "sketch_point_d"],
          value: 1,
        },
      ],
    };
  }

  function createLogoLikeDragDefinition(
    withFixedDraggedPoint = false,
  ): SketchDefinition {
    const constraints = [
      {
        constraintId: "constraint_1_origin" as const,
        kind: "coincidentProjectedPoint" as const,
        label: "Line 1 start at origin",
        point: {
          kind: "localPoint" as const,
          pointId: "sketch_point_1_line-start" as const,
        },
        projectedPoint: {
          kind: "sketchDatum" as const,
          datum: "origin" as const,
        },
      },
      {
        constraintId: "constraint_1_vertical" as const,
        kind: "vertical" as const,
        label: "Line 1 vertical",
        entityId: "sketch_entity_1_line" as const,
      },
      {
        constraintId: "constraint_4_vertical" as const,
        kind: "vertical" as const,
        label: "Line 4 vertical",
        entityId: "sketch_entity_4_line" as const,
      },
      ...(withFixedDraggedPoint
        ? [
            {
              constraintId: "constraint_5_fixed" as const,
              kind: "fixPoint" as const,
              label: "Line 5 endpoint fixed",
              pointId: "sketch_point_5_line-end" as const,
              position: [10.227407084029718, -4.433639586425089] as const,
            },
          ]
        : []),
    ];

    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: [
        "sketch_point_1_line-start",
        "sketch_point_1_line-end",
        "sketch_point_2_line-end",
        "sketch_point_3_line-end",
        "sketch_point_4_line-end",
        "sketch_point_5_line-end",
      ],
      points: [
        makePoint(
          "sketch_point_1_line-start",
          "Line 1 start",
          3.7533016694624166e-7,
          0,
        ),
        makePoint(
          "sketch_point_1_line-end",
          "Line 1 end",
          -2.5022011129749444e-7,
          9.133302219150853,
        ),
        makePoint(
          "sketch_point_2_line-end",
          "Line 2 end",
          8.729451147568751,
          16.4148664011001,
        ),
        makePoint(
          "sketch_point_3_line-end",
          "Line 3 end",
          20.868582202662076,
          12.173020618432101,
        ),
        makePoint(
          "sketch_point_4_line-end",
          "Line 4 end",
          20.86858224838759,
          -7.82697899411442,
        ),
        makePoint(
          "sketch_point_5_line-end",
          "Line 5 end",
          10.227407084029718,
          -4.433639586425089,
        ),
      ],
      entityIds: [
        "sketch_entity_1_line",
        "sketch_entity_2_line",
        "sketch_entity_3_line",
        "sketch_entity_4_line",
        "sketch_entity_5_line",
      ],
      entities: [
        makeLine(
          "sketch_entity_1_line",
          "Line 1",
          "sketch_point_1_line-start",
          "sketch_point_1_line-end",
        ),
        makeLine(
          "sketch_entity_2_line",
          "Line 2",
          "sketch_point_1_line-end",
          "sketch_point_2_line-end",
        ),
        makeLine(
          "sketch_entity_3_line",
          "Line 3",
          "sketch_point_2_line-end",
          "sketch_point_3_line-end",
        ),
        makeLine(
          "sketch_entity_4_line",
          "Line 4",
          "sketch_point_3_line-end",
          "sketch_point_4_line-end",
        ),
        makeLine(
          "sketch_entity_5_line",
          "Line 5",
          "sketch_point_4_line-end",
          "sketch_point_5_line-end",
        ),
      ],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: ["dimension_4_length"],
      dimensions: [
        {
          dimensionId: "dimension_4_length" as const,
          kind: "lineLength",
          label: "Line 4 length",
          entityId: "sketch_entity_4_line" as const,
          value: 20,
        },
      ],
    };
  }

  function createAnchoredBranchDragDefinition(): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_anchor", "sketch_point_tip"],
      points: [
        makePoint("sketch_point_anchor", "Anchor", 0, 0),
        makePoint("sketch_point_tip", "Tip", 0, -20),
      ],
      entityIds: ["sketch_entity_branch_line"],
      entities: [
        makeLine(
          "sketch_entity_branch_line",
          "Branch line",
          "sketch_point_anchor",
          "sketch_point_tip",
        ),
      ],
      constraintIds: ["constraint_anchor_origin", "constraint_branch_vertical"],
      constraints: [
        {
          constraintId: "constraint_anchor_origin",
          kind: "coincidentProjectedPoint",
          label: "Anchor at origin",
          point: {
            kind: "localPoint",
            pointId: "sketch_point_anchor",
          },
          projectedPoint: {
            kind: "sketchDatum",
            datum: "origin",
          },
        },
        {
          constraintId: "constraint_branch_vertical",
          kind: "vertical",
          label: "Branch line vertical",
          entityId: "sketch_entity_branch_line",
        },
      ],
      dimensionIds: ["dimension_branch_length"],
      dimensions: [
        {
          dimensionId: "dimension_branch_length",
          kind: "lineLength",
          label: "Branch length",
          entityId: "sketch_entity_branch_line",
          value: 20,
        },
      ],
    };
  }

  function createSessionFromDefinition(definition: SketchDefinition) {
    const plane = createStandardPlaneDefinition("xy");
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });

    return createSketchSessionFromSnapshot({
      ownerDocumentId: "doc_workspace",
      ownerRevisionId: "rev_0001",
      ownerFeatureId: null,
      ownerSketchId: "sketch_primary",
      ownerBodyId: null,
      sketchId: "sketch_primary",
      label: "Sketch",
      plane,
      planeTarget: plane.support,
      planeKey: "xy",
      sketch: {
        ownerDocumentId: "doc_workspace",
        ownerRevisionId: "rev_0001",
        ownerFeatureId: null,
        ownerSketchId: "sketch_primary",
        ownerBodyId: null,
        sketchId: "sketch_primary",
        label: "Sketch",
        planeSupport: plane.support,
        definition,
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord);
  }

  function deriveRegionsForDefinition(definition: SketchDefinition) {
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });

    return deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: solved.solvedSnapshot,
    }).regions;
  }

  function getRegionRenderableBounds(
    session: ReturnType<typeof createSessionFromDefinition>,
  ) {
    const regionRenderable = getSketchSessionDisplayRenderables(session).find(
      (renderable) => renderable.target?.kind === "region",
    );
    expect(regionRenderable, "Expected live region renderable.").toBeTruthy();
    expect(
      regionRenderable.geometry.kind,
      "Live region renderable should use mesh geometry.",
    ).toBe("mesh");

    const xs = regionRenderable.geometry.vertexPositions.map(
      (point) => point[0],
    );
    const ys = regionRenderable.geometry.vertexPositions.map(
      (point) => point[1],
    );
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }

  function getLiveRegionMesh(
    session: ReturnType<typeof createSessionFromDefinition>,
  ) {
    const regionRenderable = getSketchSessionDisplayRenderables(session).find(
      (renderable) => renderable.target?.kind === "region",
    );
    expect(regionRenderable, "Expected live region renderable.").toBeTruthy();
    expect(
      regionRenderable.geometry.kind,
      "Live region renderable should use mesh geometry.",
    ).toBe("mesh");
    return regionRenderable.geometry;
  }

  function getTriangleArea(
    points: readonly [number, number, number][],
    triangle: readonly [number, number, number],
  ) {
    const a = points[triangle[0]]!;
    const b = points[triangle[1]]!;
    const c = points[triangle[2]]!;
    return Math.abs(
      ((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2,
    );
  }

  function getMeshArea(geometry: ReturnType<typeof getLiveRegionMesh>) {
    return geometry.triangleIndices.reduce(
      (area, triangle) =>
        area + getTriangleArea(geometry.vertexPositions, triangle),
      0,
    );
  }

  function getConnectedEntityIds(
    session: ReturnType<typeof createSessionFromDefinition>,
    entityId: string,
  ) {
    return getConnectedSketchEntitySelectionTargets(session, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: entityId as `sketch_entity_${string}`,
    }).map((target) => target.entityId);
  }

  function testConnectedSketchSelectionSelectsTwoConnectedLines() {
    const definition = makeDefinition({
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_e",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 1, 0),
        makePoint("sketch_point_c", "C", 2, 0),
        makePoint("sketch_point_d", "D", 10, 0),
        makePoint("sketch_point_e", "E", 11, 0),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_bc", "sketch_entity_de"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_de", "DE", "sketch_point_d", "sketch_point_e"),
      ],
    });
    const selectedEntityIds = getConnectedEntityIds(
      createSessionFromDefinition(definition),
      "sketch_entity_ab",
    );

    expect(
      selectedEntityIds.join(","),
      "Connected selection should select the two local entities joined by a shared endpoint.",
    ).toBe("sketch_entity_ab,sketch_entity_bc");
  }

  function testConnectedSketchSelectionSelectsRectangleFromAnyEdge() {
    const session = createSessionFromDefinition(createSquareDefinition(false));
    const expected =
      "sketch_entity_ab,sketch_entity_bc,sketch_entity_cd,sketch_entity_da";

    for (const entityId of session.definition.entityIds) {
      expect(
        getConnectedEntityIds(session, entityId).join(","),
        `Connected rectangle selection from ${entityId} should select all four edges.`,
      ).toBe(expected);
    }
  }

  function testConnectedSketchSelectionUsesLocalEntityTargetNamespace() {
    const session = {
      ...createSessionFromDefinition(createSquareDefinition(false)),
      sketchId: "sketch_draft" as const,
    };

    const selectedEntityIds = getConnectedSketchEntitySelectionTargets(
      session,
      {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: "sketch_entity_ab",
      },
    ).map((selectedTarget) => selectedTarget.entityId);

    expect(
      selectedEntityIds.join(","),
      "Connected selection should follow the local entity target sketch id even when the session sketch id differs.",
    ).toBe(
      "sketch_entity_ab,sketch_entity_bc,sketch_entity_cd,sketch_entity_da",
    );
    expect(
      getConnectedSketchEntitySelectionTargets(session, {
        kind: "sketchEntity",
        sketchId: "sketch_other" as const,
        entityId: "sketch_entity_ab",
      }).length,
      "Connected selection should still reject sketch entities from a different target namespace.",
    ).toBe(0);
  }

  function testConnectedSketchSelectionSelectsBranchingComponentAndRejectsUnsupportedTargets() {
    const definition = makeDefinition({
      pointIds: [
        "sketch_point_center",
        "sketch_point_left",
        "sketch_point_right",
        "sketch_point_top",
        "sketch_point_far",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_left", "Left", -1, 0),
        makePoint("sketch_point_right", "Right", 1, 0),
        makePoint("sketch_point_top", "Top", 0, 1),
        makePoint("sketch_point_far", "Far", 5, 5),
      ],
      entityIds: [
        "sketch_entity_left",
        "sketch_entity_right",
        "sketch_entity_top",
        "sketch_entity_point",
      ],
      entities: [
        makeLine(
          "sketch_entity_left",
          "Left",
          "sketch_point_left",
          "sketch_point_center",
        ),
        makeLine(
          "sketch_entity_right",
          "Right",
          "sketch_point_center",
          "sketch_point_right",
        ),
        makeLine(
          "sketch_entity_top",
          "Top",
          "sketch_point_center",
          "sketch_point_top",
        ),
        {
          kind: "point",
          entityId: "sketch_entity_point",
          label: "Point entity",
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_primary",
            entityId: "sketch_entity_point",
          },
          isConstruction: false,
          pointId: "sketch_point_far",
        },
      ],
    });
    const session = createSessionFromDefinition(definition);

    expect(
      getConnectedEntityIds(session, "sketch_entity_right").join(","),
      "Connected selection should select every entity in a branching component.",
    ).toBe("sketch_entity_left,sketch_entity_right,sketch_entity_top");
    expect(
      getConnectedSketchEntitySelectionTargets(session, {
        kind: "projectedReferenceGeometry",
        referenceId: "ref_projected" as const,
        geometryId: "projected_geometry_line" as const,
        geometryKind: "lineSegment",
      }).length,
      "Projected reference geometry should not expand through connected local geometry selection.",
    ).toBe(0);
    expect(
      getConnectedSketchEntitySelectionTargets(session, {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: "sketch_point_center",
      }).length,
      "Sketch points should not expand through connected local geometry selection.",
    ).toBe(0);
    expect(
      getConnectedEntityIds(session, "sketch_entity_point").length,
      "Point entities should not expand through connected local geometry selection.",
    ).toBe(0);
  }

  function testUnconstrainedPointDragUpdatesAuthoredDefinition() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [1, 0]);

    const point = session.definition.points[0];
    expect(point, "Expected authored point from line creation.").toBeTruthy();
    session = beginSketchGeometryDrag(session, point.target, point.position);
    expect(
      session.activeTool,
      "Dragging an existing point should clear an idle drawing tool.",
    ).toBe(null);
    session = finishSketchGeometryDrag(session, [2, 3]);

    const movedPoint = session.definition.points.find(
      (entry) => entry.pointId === point.pointId,
    );
    assertClosePoint(
      movedPoint?.position,
      [2, 3],
      "Unconstrained drag should update the authored point.",
    );
    const movedDisplayLine = deriveSketchDisplayEntities(session).find(
      (entity) => entity.kind === "line",
    );
    expect(
      movedDisplayLine?.kind,
      "Edited line should remain visible as a display line.",
    ).toBe("line");
    const movedDisplayEndpoint = [
      movedDisplayLine.start,
      movedDisplayLine.end,
    ].find((endpoint) => Math.hypot(endpoint[0] - 2, endpoint[1] - 3) < 1e-4);
    assertClosePoint(
      movedDisplayEndpoint,
      [2, 3],
      "Edited line display should derive from the updated sketch definition.",
    );
    expect(
      movedDisplayLine.start[0] === 0 &&
        movedDisplayLine.start[1] === 0 &&
        !(movedDisplayLine.end[0] === 0 && movedDisplayLine.end[1] === 0),
      "Edited line display should not include stale pre-drag point geometry.",
    ).toBeFalsy();
    assertClosePoint(
      session.commitRequest?.definition.points.find(
        (entry) => entry.pointId === point.pointId,
      )?.position,
      [2, 3],
      "Unconstrained drag should prepare the authored commit mutation.",
    );
  }

  function testConstrainedSquareDragTranslatesSolvedShape() {
    let session = createSessionFromDefinition(createSquareDefinition(false));
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_b",
    )?.target;
    expect(target, "Expected square vertex B.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [1, 0]);
    expect(
      session.activeDrag?.interactiveSolveSession,
      "Constrained drag should start an interactive solve session.",
    ).not.toBe(null);
    session = finishSketchGeometryDrag(session, [4, 3]);
    expect(
      session.activeDrag,
      "Constrained drag finish should dispose the active drag lifecycle.",
    ).toBe(null);

    const points = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    assertClosePoint(
      points.get("sketch_point_a"),
      [3, 3],
      "Dragging free square vertex should translate A.",
    );
    assertClosePoint(
      points.get("sketch_point_b"),
      [4, 3],
      "Dragging free square vertex should honor B target.",
    );
    assertClosePoint(
      points.get("sketch_point_c"),
      [4, 4],
      "Dragging free square vertex should translate C.",
    );
    assertClosePoint(
      points.get("sketch_point_d"),
      [3, 4],
      "Dragging free square vertex should translate D.",
    );
    expect(
      session.validationMessage,
      "Valid constrained drag should not leave blocked feedback.",
    ).toBe(null);
  }

  function testLogoLikeFreeEndpointDragClearsValidationFeedback() {
    let session = createSessionFromDefinition(createLogoLikeDragDefinition());
    const requestedPosition = [
      10.386898346172789, -3.3335358542735576,
    ] as const;
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_5_line-end",
    )?.target;
    expect(target, "Expected logo-like free endpoint.").toBeTruthy();

    session = beginSketchGeometryDrag(
      session,
      target,
      [10.227407084029718, -4.433639586425089],
    );
    expect(
      session.activeDrag?.interactiveSolveSession,
      "Logo-like constrained drag should start an interactive solve session.",
    ).not.toBe(null);
    session = finishSketchGeometryDrag(session, requestedPosition);

    const points = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    assertClosePoint(
      points.get("sketch_point_5_line-end"),
      requestedPosition,
      "Logo-like dragged endpoint should update to the requested position.",
    );
    expect(
      session.validationMessage,
      "Accepted logo-like drag should not leave constrained feedback.",
    ).toBe(null);
  }

  function testAnchoredBranchDragStaysContinuousWithoutFlipping() {
    // Regression fixture (minimum-motion-sketch-drag): the tip is pinned to the
    // y-axis at length 20 from the anchored origin, so its only other valid
    // configuration ([0, 20]) is a reflected branch reachable solely by crossing
    // the zero-length singularity. Dragging toward [4, 26] must NOT flip to that
    // mirrored branch; the drag frame stays continuous with the previous frame,
    // so the tip keeps its [0, -20] position and shows constrained feedback.
    let session = createSessionFromDefinition(
      createAnchoredBranchDragDefinition(),
    );
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_tip",
    )?.target;
    expect(target, "Expected anchored branch tip.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [0, -20]);
    expect(
      session.activeDrag?.interactiveSolveSession,
      "Anchored branch drag should start an interactive solve session.",
    ).not.toBe(null);
    session = finishSketchGeometryDrag(session, [4, 26]);

    const points = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    assertClosePoint(
      points.get("sketch_point_anchor"),
      [0, 0],
      "Anchored branch drag should keep the anchor at origin.",
    );
    assertClosePoint(
      points.get("sketch_point_tip"),
      [0, -20],
      "Anchored branch drag must not flip to the reflected branch.",
    );
    expect(
      session.validationMessage,
      "A tip that cannot move continuously should show constrained feedback.",
    ).toBe("Geometry is constrained and cannot move to that position.");
  }

  function testLiveRegionRenderableTracksJiggledSketchDrag() {
    let session = createSessionFromDefinition(createSquareDefinition(false));
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    };
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_b",
    )?.target;
    expect(target, "Expected square vertex B.").toBeTruthy();

    const initialBounds = getRegionRenderableBounds(session);
    const initialRegionId = session.solvedRegions[0]?.regionId;
    expect(
      initialRegionId,
      "Initial square should derive a live region id.",
    ).toBeTruthy();
    assertClosePoint(
      [initialBounds.minX, initialBounds.minY],
      [0, 0],
      "Initial live region should start at the square origin.",
    );
    assertClosePoint(
      [initialBounds.maxX, initialBounds.maxY],
      [1, 1],
      "Initial live region should match the square extents.",
    );

    session = beginSketchGeometryDrag(session, target, [1, 0]);
    session = finishSketchGeometryDrag(session, [4, 3]);

    expect(
      session.solvedRegions.length,
      "Dragging the square should keep one live derived region.",
    ).toBe(1);
    expect(
      session.solvedRegions[0]?.regionId,
      "Dragging the square should keep the live region identity stable.",
    ).toBe(initialRegionId);

    const movedBounds = getRegionRenderableBounds(session);
    assertClosePoint(
      [movedBounds.minX, movedBounds.minY],
      [3, 3],
      "Jiggled live region should move with the sketch.",
    );
    assertClosePoint(
      [movedBounds.maxX, movedBounds.maxY],
      [4, 4],
      "Jiggled live region should keep the solved square extents.",
    );
  }

  function testLiveRegionRenderablePreservesInnerLoopHole() {
    const definition = makeDefinition({
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_e",
        "sketch_point_f",
        "sketch_point_g",
        "sketch_point_h",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 8, 0),
        makePoint("sketch_point_c", "C", 8, 8),
        makePoint("sketch_point_d", "D", 0, 8),
        makePoint("sketch_point_e", "E", 2, 2),
        makePoint("sketch_point_f", "F", 6, 2),
        makePoint("sketch_point_g", "G", 6, 6),
        makePoint("sketch_point_h", "H", 2, 6),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_da",
        "sketch_entity_ef",
        "sketch_entity_fg",
        "sketch_entity_gh",
        "sketch_entity_he",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_da", "DA", "sketch_point_d", "sketch_point_a"),
        makeLine("sketch_entity_ef", "EF", "sketch_point_e", "sketch_point_f"),
        makeLine("sketch_entity_fg", "FG", "sketch_point_f", "sketch_point_g"),
        makeLine("sketch_entity_gh", "GH", "sketch_point_g", "sketch_point_h"),
        makeLine("sketch_entity_he", "HE", "sketch_point_h", "sketch_point_e"),
      ],
    });
    let session = createSessionFromDefinition(definition);
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    };

    const geometry = getLiveRegionMesh(session);
    expect(
      geometry.triangleIndices.length > 0,
      "Holed live region should render a triangulated mesh.",
    ).toBeTruthy();
    expect(
      Math.abs(getMeshArea(geometry) - 48) < 1e-6,
      "Holed live region mesh should subtract the inner loop area.",
    ).toBeTruthy();
  }

  function testLiveRegionRenderableTriangulatesConcaveRegion() {
    const definition = makeDefinition({
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_e",
        "sketch_point_f",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
        makePoint("sketch_point_c", "C", 4, 1),
        makePoint("sketch_point_d", "D", 1, 1),
        makePoint("sketch_point_e", "E", 1, 4),
        makePoint("sketch_point_f", "F", 0, 4),
      ],
      entityIds: [
        "sketch_entity_ab",
        "sketch_entity_bc",
        "sketch_entity_cd",
        "sketch_entity_de",
        "sketch_entity_ef",
        "sketch_entity_fa",
      ],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_de", "DE", "sketch_point_d", "sketch_point_e"),
        makeLine("sketch_entity_ef", "EF", "sketch_point_e", "sketch_point_f"),
        makeLine("sketch_entity_fa", "FA", "sketch_point_f", "sketch_point_a"),
      ],
    });
    let session = createSessionFromDefinition(definition);
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    };

    const geometry = getLiveRegionMesh(session);
    expect(
      geometry.triangleIndices.length,
      "Six-point concave live region should triangulate into four triangles.",
    ).toBe(4);
    expect(
      Math.abs(getMeshArea(geometry) - 7) < 1e-6,
      "Concave live region mesh should preserve polygon area without fan overlap.",
    ).toBeTruthy();
  }

  function testLiveRegionDiagnosticsAreAvailableDuringEditing() {
    const definition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 2, 0),
      ],
      entityIds: ["sketch_entity_open"],
      entities: [
        makeLine(
          "sketch_entity_open",
          "Open",
          "sketch_point_a",
          "sketch_point_b",
        ),
      ],
    });
    let session = createSessionFromDefinition(definition);
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_b",
    )?.target;
    expect(target, "Expected open segment endpoint.").toBeTruthy();
    session = beginSketchGeometryDrag(session, target, [2, 0]);
    session = updateSketchGeometryDrag(session, [2.25, 0]);

    expect(
      session.liveRegionState?.freshness,
      "Accepted drag movement should defer live region extraction until the debounce interval settles.",
    ).toBe("pendingRefresh");
    session = refreshLiveRegionsAfterDebounce(session, 100);
    expect(
      getSketchSessionRegionDiagnostics(session).some(
        (diagnostic) => diagnostic.code === "profile-open-segment",
      ),
      "Deferred live region diagnostics should be available after the refresh runs.",
    ).toBeTruthy();
  }

  function testConstrainedDragRegionDerivationBenchmark() {
    const definition = createSquareDefinition(false);
    let session = createSessionFromDefinition(definition);
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    };
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_b",
    )?.target;
    expect(target, "Expected square vertex B.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [1, 0]);
    const frameCount = 30;
    const startedAt = performance.now();
    for (let index = 0; index < frameCount; index += 1) {
      const t = index / (frameCount - 1);
      session = updateSketchGeometryDrag(session, [1 + t * 3, t * 2]);
      expect(
        session.solvedRegions.length,
        "Drag-frame updates should keep the previous constrained square profile visible.",
      ).toBe(1);
      expect(
        session.liveRegionState?.freshness,
        "Drag-frame updates should defer live region extraction.",
      ).toBe("pendingRefresh");
    }
    const elapsed = performance.now() - startedAt;
    expect(
      elapsed < 1_500,
      `Constrained drag live-region benchmark should stay responsive; ${frameCount} frames took ${elapsed.toFixed(1)}ms.`,
    ).toBeTruthy();
  }

  function testRectangleToolDragTranslatesWholeRectangle() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    session = beginSketchTool(session, "rectangle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 3]);

    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_1_rect-bottom-left",
    )?.target;
    expect(target, "Expected rectangle bottom-left vertex.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [0, 0]);
    session = finishSketchGeometryDrag(session, [2, 2]);

    const points = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    assertClosePoint(
      points.get("sketch_point_1_rect-bottom-left"),
      [2, 2],
      "Dragging rectangle corner should translate bottom left.",
    );
    assertClosePoint(
      points.get("sketch_point_1_rect-bottom-right"),
      [6, 2],
      "Dragging rectangle corner should translate bottom right.",
    );
    assertClosePoint(
      points.get("sketch_point_1_rect-top-right"),
      [6, 5],
      "Dragging rectangle corner should translate top right.",
    );
    assertClosePoint(
      points.get("sketch_point_1_rect-top-left"),
      [2, 5],
      "Dragging rectangle corner should translate top left.",
    );
    expect(
      session.validationMessage,
      "Translatable rectangle drag should not leave blocked feedback.",
    ).toBe(null);
  }

  function testImmovableConstrainedDragBlocksWithoutChangingDraft() {
    let session = createSessionFromDefinition(createSquareDefinition(true));
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    };
    const before = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    const beforeRegionIds = session.solvedRegions
      .map((region) => region.regionId)
      .join(",");
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_a",
    )?.target;
    expect(target, "Expected fixed square vertex A.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [0, 0]);
    session = finishSketchGeometryDrag(session, [2, 2]);

    const after = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    assertClosePoint(
      after.get("sketch_point_a"),
      before.get("sketch_point_a")!,
      "Blocked drag should leave A unchanged.",
    );
    assertClosePoint(
      after.get("sketch_point_b"),
      before.get("sketch_point_b")!,
      "Blocked drag should leave B unchanged.",
    );
    expect(
      session.solvedRegions.map((region) => region.regionId).join(","),
      "Blocked drag should leave current live regions unchanged.",
    ).toBe(beforeRegionIds);
    expect(
      session.validationMessage,
      "Blocked drag should leave visible constrained-movement feedback.",
    ).toBe("Geometry is constrained and cannot move to that position.");
  }

  function testFixedLogoLikeEndpointDragBlocksWithConstrainedFeedback() {
    let session = createSessionFromDefinition(
      createLogoLikeDragDefinition(true),
    );
    const before = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_5_line-end",
    )?.target;
    expect(target, "Expected fixed logo-like endpoint.").toBeTruthy();

    session = beginSketchGeometryDrag(
      session,
      target,
      [10.227407084029718, -4.433639586425089],
    );
    session = finishSketchGeometryDrag(
      session,
      [10.386898346172789, -3.3335358542735576],
    );

    const after = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    assertClosePoint(
      after.get("sketch_point_5_line-end"),
      before.get("sketch_point_5_line-end")!,
      "Blocked fixed logo-like endpoint drag should leave the point unchanged.",
    );
    expect(
      session.validationMessage,
      "Blocked fixed logo-like endpoint drag should leave constrained feedback.",
    ).toBe("Geometry is constrained and cannot move to that position.");
  }

  function testPerpendicularSlideShowsNoConstrainedFeedback() {
    // Regression (minimum-motion-sketch-drag, D6): a horizontal line pinned at
    // the origin lets its free endpoint slide along x only. Dragging straight up
    // (x unchanged) barely moves the endpoint, but the endpoint still has a free
    // DOF, so this reachable-limit lag must NOT show constrained feedback. This
    // is the axis-aligned case a moved-vs-requested ratio would misclassify.
    const definition = makeDefinition({
      pointIds: ["sketch_point_pin", "sketch_point_slide"],
      points: [
        makePoint("sketch_point_pin", "Pin", 0, 0),
        makePoint("sketch_point_slide", "Slide", 2, 0),
      ],
      entityIds: ["sketch_entity_slider"],
      entities: [
        makeLine(
          "sketch_entity_slider",
          "Slider",
          "sketch_point_pin",
          "sketch_point_slide",
        ),
      ],
    });
    const withConstraints: SketchDefinition = {
      ...definition,
      constraintIds: ["constraint_pin", "constraint_slider_horizontal"],
      constraints: [
        {
          constraintId: "constraint_pin",
          kind: "fixPoint",
          label: "Pin origin",
          pointId: "sketch_point_pin",
          position: [0, 0],
        },
        {
          constraintId: "constraint_slider_horizontal",
          kind: "horizontal",
          label: "Slider horizontal",
          entityId: "sketch_entity_slider",
        },
      ],
    };
    let session = createSessionFromDefinition(withConstraints);
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_slide",
    )?.target;
    expect(target, "Expected slider endpoint.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [2, 0]);
    session = finishSketchGeometryDrag(session, [2, 6]);

    expect(
      session.validationMessage,
      "A perpendicular pull on a point with a free sliding DOF must not show constrained feedback.",
    ).toBe(null);
  }

  function testSelectedEntityDeletionRemovesDependentAnnotations() {
    const session = createSessionFromDefinition({
      ...makeDefinition({
        pointIds: ["sketch_point_center", "sketch_point_a", "sketch_point_b"],
        points: [
          makePoint("sketch_point_center", "Center", 0, 0),
          makePoint("sketch_point_a", "A", 2, 0),
          makePoint("sketch_point_b", "B", 4, 0),
        ],
        entityIds: ["sketch_entity_circle", "sketch_entity_ab"],
        entities: [
          makeCircle(
            "sketch_entity_circle",
            "Circle",
            "sketch_point_center",
            1,
          ),
          makeLine(
            "sketch_entity_ab",
            "AB",
            "sketch_point_a",
            "sketch_point_b",
          ),
        ],
      }),
      constraintIds: ["constraint_horizontal_ab"],
      constraints: [
        {
          constraintId: "constraint_horizontal_ab",
          kind: "horizontal",
          label: "AB horizontal",
          entityId: "sketch_entity_ab",
        },
      ],
      dimensionIds: ["dimension_radius", "dimension_width"],
      dimensions: [
        {
          dimensionId: "dimension_radius",
          kind: "circleRadius",
          label: "Radius",
          entityId: "sketch_entity_circle",
          value: 1,
        },
        {
          dimensionId: "dimension_width",
          kind: "horizontalDistance",
          label: "Width",
          pointIds: ["sketch_point_a", "sketch_point_b"],
          value: 2,
        },
      ],
    });
    const deleted = deleteSelectedSketchGeometry(session, [
      {
        kind: "sketchEntity",
        sketchId: "sketch_primary",
        entityId: "sketch_entity_circle",
      },
    ]);

    expect(
      deleted.definition.entityIds.includes("sketch_entity_circle"),
      "Entity deletion should remove the selected entity.",
    ).toBeFalsy();
    expect(
      deleted.definition.constraintIds.includes("constraint_horizontal_ab"),
      "Entity deletion should preserve unrelated entity constraints.",
    ).toBeTruthy();
    expect(
      deleted.definition.dimensionIds.includes("dimension_radius"),
      "Entity deletion should remove dimensions that reference the deleted entity.",
    ).toBeFalsy();
    expect(
      deleted.definition.dimensionIds.includes("dimension_width"),
      "Entity deletion should preserve unrelated dimensions.",
    ).toBeTruthy();
    expect(
      deleted.commitRequest?.definition.entityIds.includes(
        "sketch_entity_circle",
      ),
      "Entity deletion should rebuild the commit request without deleted geometry.",
    ).toBeFalsy();
    expect(
      deriveSketchDisplayEntities(deleted).some(
        (entity) => entity.entityId === "sketch_entity_circle",
      ),
      "Entity deletion should remove deleted accepted geometry from derived display entities.",
    ).toBeFalsy();
  }

  function testSelectedPointDeletionRemovesDependentGeometryAndAnnotations() {
    const session = createSessionFromDefinition(createSquareDefinition(true));
    const deleted = deleteSelectedSketchGeometry(session, [
      {
        kind: "sketchPoint",
        sketchId: "sketch_primary",
        pointId: "sketch_point_a",
      },
    ]);

    expect(
      deleted.definition.pointIds.includes("sketch_point_a"),
      "Point deletion should remove the selected point.",
    ).toBeFalsy();
    expect(
      deleted.definition.entityIds.includes("sketch_entity_ab") &&
        !deleted.definition.entityIds.includes("sketch_entity_da"),
      "Point deletion should remove local entities that reference the deleted point.",
    ).toBeFalsy();
    expect(
      deleted.definition.constraintIds.includes("constraint_fix_a"),
      "Point deletion should remove point constraints that reference the deleted point.",
    ).toBeFalsy();
    expect(
      deleted.definition.constraintIds.includes("constraint_vertical_bc"),
      "Point deletion should preserve unrelated constraints.",
    ).toBeTruthy();
    expect(
      deleted.definition.dimensionIds.includes("dimension_width") &&
        !deleted.definition.dimensionIds.includes("dimension_height"),
      "Point deletion should remove dimensions that reference deleted point ids.",
    ).toBeFalsy();
    const remainingPointIds = new Set(deleted.definition.pointIds);
    expect(
      deleted.definition.entities.every((entity) =>
        entity.kind === "spline"
          ? entity.fitPointIds.every((pointId) =>
              remainingPointIds.has(pointId),
            )
          : entity.kind === "circle"
            ? remainingPointIds.has(entity.centerPointId)
            : entity.kind === "point"
              ? remainingPointIds.has(entity.pointId)
              : entity.kind === "arc"
                ? remainingPointIds.has(entity.centerPointId) &&
                  remainingPointIds.has(entity.startPointId) &&
                  remainingPointIds.has(entity.endPointId)
                : remainingPointIds.has(entity.startPointId) &&
                  remainingPointIds.has(entity.endPointId),
      ),
      "Point deletion should not leave entities with dangling point references.",
    ).toBeTruthy();
    expect(
      deriveSketchDisplayEntities(deleted).some(
        (entity) =>
          entity.entityId === "sketch_entity_ab" ||
          entity.entityId === "sketch_entity_da",
      ),
      "Point deletion should remove dependent accepted geometry from derived display entities.",
    ).toBeFalsy();
  }

  function testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets() {
    let session = toggleSketchSvgRendering(
      createSessionFromDefinition(createSquareDefinition(false)),
    );
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    };
    const entityTarget = session.definition.entities[0]?.target;
    const pointTarget = session.definition.points[0]?.target;
    const regionTarget = session.solvedRegions[0]?.target;
    expect(
      entityTarget && pointTarget && regionTarget,
      "Style patch fixture should create local edge, point, and region targets.",
    ).toBeTruthy();
    const before = structuredClone(session.commitRequest?.definition);

    session = patchSketchStyleValue(
      session,
      [{ kind: "edge", bodyId: "body_a", edgeId: "edge_a" }],
      { intent: "patchSketchStyle", field: "fillColor", value: "#00ffff" },
    );

    expect(
      JSON.stringify(session.commitRequest?.definition),
      "Style patch should ignore non-local targets such as external model geometry refs.",
    ).toBe(JSON.stringify(before));

    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "fillMode",
      value: "solid",
    });
    expect(
      session.definition.styles?.length ?? 0,
      "Fill style patch should reject sketch edge/entity targets without mutating style records.",
    ).toBe(0);

    session = patchSketchStyleValue(session, [regionTarget], {
      intent: "patchSketchStyle",
      field: "fillMode",
      value: "gradient",
    });
    session = patchSketchStyleValue(session, [regionTarget], {
      intent: "patchSketchStyle",
      field: "gradientStartColor",
      value: "#00ffff",
    });
    const regionStyle = session.definition.styles?.find(
      (style) =>
        style.target.kind === "region" &&
        style.target.regionId === regionTarget.regionId,
    );
    expect(
      regionStyle?.fill.kind === "gradient" &&
        regionStyle.fill.gradient.startColor === "#00ffff",
      "Fill style patch should author a region-scoped style record for selected live regions.",
    ).toBeTruthy();

    session = patchSketchStyleValue(session, [regionTarget], {
      intent: "patchSketchStyle",
      field: "strokeWidth",
      value: 4,
    });
    expect(
      session.definition.entities[0]?.style,
      "Stroke style patch should reject region targets without mutating entity stroke fields.",
    ).toBe(undefined);

    session = patchSketchStyleValue(session, [pointTarget], {
      intent: "patchSketchStyle",
      field: "strokeWidth",
      value: 4,
    });
    expect(
      session.definition.entities[0]?.style,
      "Stroke style patch should reject point targets without mutating entity stroke fields.",
    ).toBe(undefined);

    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "strokeWidth",
      value: 2.5,
    });
    expect(
      getSketchSessionDisplayRenderables(session).find(
        (entry) =>
          entry.target?.kind === "sketchEntity" &&
          entry.target.entityId === entityTarget.entityId,
      )?.strokeStyle,
      "Stroke fields should not render until stroke styling is explicitly enabled.",
    ).toBe(undefined);
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "strokeEnabled",
      value: true,
    });
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "strokeMiterLimit",
      value: 7,
    });
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "strokeDashSize",
      value: 0.6,
    });
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "strokeGapSize",
      value: 0.25,
    });

    expect(
      session.definition.entities[0]?.style?.strokeWidth,
      "Local style patch should update the selected sketch entity style in session definition.",
    ).toBe(2.5);
    expect(
      getSketchSessionDisplayRenderables(session).find(
        (entry) =>
          entry.target?.kind === "sketchEntity" &&
          entry.target.entityId === entityTarget.entityId,
      )?.strokeStyle?.width,
      "Explicitly enabled local stroke fields should render through sketch display metadata.",
    ).toBe(2.5);
    expect(
      session.commitRequest?.definition.styles?.some(
        (style) =>
          style.target.kind === "region" &&
          style.target.regionId === regionTarget.regionId &&
          style.fill.kind === "gradient",
      ),
      "Region fill style patch should rebuild the durable commit request payload.",
    ).toBeTruthy();
    expect(
      session.definition.entities[0]?.style?.strokeMiterLimit,
      "Local style patch should update miter limit in session definition.",
    ).toBe(7);
    expect(
      session.definition.entities[0]?.style?.strokeDashSize === 0.6 &&
        session.definition.entities[0]?.style?.strokeGapSize === 0.25,
      "Local style patch should update dash fields in session definition.",
    ).toBeTruthy();
    expect(
      session.commitRequest?.definition.entities[0]?.style?.strokeWidth ===
        2.5 &&
        session.commitRequest.definition.entities[0]?.style?.strokeEnabled ===
          true &&
        session.commitRequest.definition.entities[0]?.style?.strokeDashSize ===
          0.6,
      "Local style patch should rebuild commit request using the updated sketch definition.",
    ).toBeTruthy();
  }

  function testSvgRenderingToggleSuppressesAuthoredStylesWithoutDeletingThem() {
    let session = toggleSketchSvgRendering(
      createSessionFromDefinition(createSquareDefinition(false)),
    );
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    };
    const entityTarget = session.definition.entities[0]?.target;
    const regionTarget = session.solvedRegions[0]?.target;
    expect(
      entityTarget && regionTarget,
      "SVG rendering fixture should expose edge and region targets.",
    ).toBeTruthy();

    session = patchSketchStyleValue(session, [regionTarget], {
      intent: "patchSketchStyle",
      field: "fillMode",
      value: "solid",
    });
    session = patchSketchStyleValue(session, [regionTarget], {
      intent: "patchSketchStyle",
      field: "fillColor",
      value: "#00ffff",
    });
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "strokeEnabled",
      value: true,
    });
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: "patchSketchStyle",
      field: "strokeWidth",
      value: 2,
    });

    const styledRenderables = getSketchSessionDisplayRenderables(session);
    expect(
      styledRenderables.some(
        (entry) => entry.target?.kind === "region" && entry.paintStyle,
      ) &&
        styledRenderables.some(
          (entry) =>
            entry.target?.kind === "sketchEntity" &&
            entry.strokeStyle?.width === 2,
        ),
      "SVG rendering enabled should expose authored fill and stroke display metadata.",
    ).toBeTruthy();

    const disabled = toggleSketchSvgRendering(session);
    expect(
      isSketchSvgRenderingEnabled(disabled),
      "SVG rendering toggle should persist disabled state on the sketch.",
    ).toBeFalsy();
    expect(
      disabled.definition.styles?.length ===
        session.definition.styles?.length &&
        disabled.definition.entities[0]?.style?.strokeWidth === 2,
      "Disabling SVG rendering should not delete authored region or edge style data.",
    ).toBeTruthy();
    expect(
      getSketchSessionDisplayRenderables(disabled).every(
        (entry) => !entry.paintStyle && !entry.strokeStyle,
      ),
      "SVG rendering disabled should suppress authored fill and stroke display metadata.",
    ).toBeTruthy();

    const restored = toggleSketchSvgRendering(disabled);
    const restoredRenderables = getSketchSessionDisplayRenderables(restored);
    expect(
      restoredRenderables.some(
        (entry) => entry.target?.kind === "region" && entry.paintStyle,
      ) &&
        restoredRenderables.some(
          (entry) =>
            entry.target?.kind === "sketchEntity" &&
            entry.strokeStyle?.width === 2,
        ),
      "Re-enabling SVG rendering should restore visuals from persisted style data.",
    ).toBeTruthy();
  }

  function testTrimSplitsLineAtClearIntersections() {
    const definition = makeDefinition({
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
        "sketch_point_e",
        "sketch_point_f",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
        makePoint("sketch_point_c", "C", 1, -1),
        makePoint("sketch_point_d", "D", 1, 1),
        makePoint("sketch_point_e", "E", 3, -1),
        makePoint("sketch_point_f", "F", 3, 1),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_cd", "sketch_entity_ef"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
        makeLine("sketch_entity_ef", "EF", "sketch_point_e", "sketch_point_f"),
      ],
    });
    let session = beginSketchTool(
      createSessionFromDefinition(definition),
      "trim",
    );
    session = selectSketchEditToolTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_ab",
    });

    expect(
      session.validationMessage,
      "Accepted trim should not leave validation feedback.",
    ).toBe(null);
    expect(
      session.definition.entityIds.includes("sketch_entity_ab"),
      "Trim should preserve the selected line entity id.",
    ).toBeTruthy();
    expect(
      session.definition.entityIds.length,
      "Trim should add one split segment for the remaining geometry.",
    ).toBe(4);
    expect(
      session.commitRequest?.definition.entityIds.length,
      "Trim should rebuild the sketch commit request.",
    ).toBe(4);
  }

  function testTrimHandlesCircleArcAndSplineTargets() {
    const circleDefinition = makeDefinition({
      pointIds: [
        "sketch_point_center",
        "sketch_point_l0",
        "sketch_point_l1",
        "sketch_point_r0",
        "sketch_point_r1",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_l0", "L0", -1, -3),
        makePoint("sketch_point_l1", "L1", -1, 3),
        makePoint("sketch_point_r0", "R0", 1, -3),
        makePoint("sketch_point_r1", "R1", 1, 3),
      ],
      entityIds: [
        "sketch_entity_circle",
        "sketch_entity_left",
        "sketch_entity_right",
      ],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 2),
        makeLine(
          "sketch_entity_left",
          "Left cutter",
          "sketch_point_l0",
          "sketch_point_l1",
        ),
        makeLine(
          "sketch_entity_right",
          "Right cutter",
          "sketch_point_r0",
          "sketch_point_r1",
        ),
      ],
    });
    let circleSession = beginSketchTool(
      createSessionFromDefinition(circleDefinition),
      "trim",
    );
    circleSession = selectSketchEditToolTarget(circleSession, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_circle",
    });

    const trimmedCircle = circleSession.definition.entities.find(
      (entity) => entity.entityId === "sketch_entity_circle",
    );
    expect(
      trimmedCircle?.kind,
      "Trimming a circle should preserve the selected id as an authored arc.",
    ).toBe("arc");
    expect(
      circleSession.validationMessage,
      "Circle trim should not leave validation feedback.",
    ).toBe(null);

    const arcDefinition = makeDefinition({
      pointIds: [
        "sketch_point_center",
        "sketch_point_start",
        "sketch_point_end",
        "sketch_point_l0",
        "sketch_point_l1",
        "sketch_point_r0",
        "sketch_point_r1",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_start", "Start", 2, 0),
        makePoint("sketch_point_end", "End", -2, 0),
        makePoint("sketch_point_l0", "L0", -1, 0),
        makePoint("sketch_point_l1", "L1", -1, 3),
        makePoint("sketch_point_r0", "R0", 1, 0),
        makePoint("sketch_point_r1", "R1", 3, 3),
      ],
      entityIds: [
        "sketch_entity_arc",
        "sketch_entity_left",
        "sketch_entity_right",
      ],
      entities: [
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_center",
          "sketch_point_start",
          "sketch_point_end",
        ),
        makeLine(
          "sketch_entity_left",
          "Left cutter",
          "sketch_point_l0",
          "sketch_point_l1",
        ),
        makeLine(
          "sketch_entity_right",
          "Right cutter",
          "sketch_point_r0",
          "sketch_point_r1",
        ),
      ],
    });
    let arcSession = beginSketchTool(
      createSessionFromDefinition(arcDefinition),
      "trim",
    );
    arcSession = selectSketchEditToolTarget(arcSession, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_arc",
    });

    expect(
      arcSession.validationMessage,
      "Arc trim should not leave validation feedback.",
    ).toBe(null);
    expect(
      arcSession.definition.entities.filter((entity) => entity.kind === "arc")
        .length,
      "Trimming an arc should split the remaining geometry into two arcs.",
    ).toBe(2);

    const splineDefinition = makeDefinition({
      pointIds: [
        "sketch_point_s0",
        "sketch_point_s1",
        "sketch_point_s2",
        "sketch_point_l0",
        "sketch_point_l1",
        "sketch_point_r0",
        "sketch_point_r1",
      ],
      points: [
        makePoint("sketch_point_s0", "S0", 0, 0),
        makePoint("sketch_point_s1", "S1", 2, 3),
        makePoint("sketch_point_s2", "S2", 4, 0),
        makePoint("sketch_point_l0", "L0", 1, -1),
        makePoint("sketch_point_l1", "L1", 1, 3),
        makePoint("sketch_point_r0", "R0", 3, -1),
        makePoint("sketch_point_r1", "R1", 3, 3),
      ],
      entityIds: [
        "sketch_entity_spline",
        "sketch_entity_left",
        "sketch_entity_right",
      ],
      entities: [
        makeSpline("sketch_entity_spline", "Spline", [
          "sketch_point_s0",
          "sketch_point_s1",
          "sketch_point_s2",
        ]),
        makeLine(
          "sketch_entity_left",
          "Left cutter",
          "sketch_point_l0",
          "sketch_point_l1",
        ),
        makeLine(
          "sketch_entity_right",
          "Right cutter",
          "sketch_point_r0",
          "sketch_point_r1",
        ),
      ],
    });
    let splineSession = beginSketchTool(
      createSessionFromDefinition(splineDefinition),
      "trim",
    );
    splineSession = selectSketchEditToolTarget(splineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_spline",
    });

    expect(
      splineSession.validationMessage,
      "Spline trim should not leave validation feedback.",
    ).toBe(null);
    expect(
      splineSession.definition.entities.filter(
        (entity) => entity.kind === "spline",
      ).length,
      "Trimming a spline should split the remaining geometry into two spline entities.",
    ).toBe(2);
  }

  function testOffsetAddsLineCopyAndRejectsInvalidDistance() {
    let session = createNewSketchSessionFromSupport({
      kind: "construction",
      constructionId: "construction_plane-xy",
    });
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [2, 0]);
    const lineTarget = session.definition.entities[0]?.target;
    expect(
      lineTarget,
      "Offset fixture should create a line target.",
    ).toBeTruthy();

    session = beginSketchTool(session, "offset");
    session = selectSketchEditToolTarget(session, lineTarget);
    expect(
      session.toolStagedEntities.some((entity) => entity.status === "preview"),
      "Offset selection should stage preview geometry.",
    ).toBeTruthy();
    expect(
      deriveSketchDisplayEntities(session).some(
        (entity) => entity.status === "preview",
      ),
      "Offset preview should appear in derived display entities while staged.",
    ).toBeTruthy();

    session = patchSketchEditToolValue(session, { value: 0 });
    const beforeInvalidCommit = session.definition.entityIds.length;
    session = patchSketchEditToolValue(session, { intent: "commitOffset" });

    expect(
      session.definition.entityIds.length,
      "Invalid offset should not mutate the sketch draft.",
    ).toBe(beforeInvalidCommit);
    expect(
      session.validationMessage,
      "Invalid offset should report validation feedback.",
    ).toBe("Offset distance must be greater than zero.");

    session = patchSketchEditToolValue(session, { value: 1 });
    session = patchSketchEditToolValue(session, { intent: "commitOffset" });

    expect(
      session.definition.entityIds.length,
      "Valid offset should add one offset line.",
    ).toBe(2);
    expect(
      session.commitRequest?.definition.entityIds.length,
      "Valid offset should rebuild the sketch commit request.",
    ).toBe(2);
    expect(
      session.toolStagedEntities.length,
      "Committed offset should clear staged preview geometry.",
    ).toBe(0);
    expect(
      deriveSketchDisplayEntities(session).every(
        (entity) => entity.status === "accepted",
      ),
      "Committed offset display entities should be accepted definition-derived geometry only.",
    ).toBeTruthy();
  }

  function testOffsetActivationSeedsCompatiblePreselectionAndClearsInvalidSelection() {
    const definition = createSquareDefinition(false);
    const selectedTargets = definition.entities
      .slice(0, 2)
      .map((entity) => entity.target);
    const activated = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
      selectedTargets,
    );

    expect(
      activated.activeEditTool?.toolId,
      "Offset activation should open the offset edit tool.",
    ).toBe("offset");
    expect(
      activated.activeEditTool?.selectedTargets.length,
      "Offset activation should seed compatible preselected targets into the edit tool state.",
    ).toBe(selectedTargets.length);
    expect(
      activated.toolStagedEntities.some(
        (entity) => entity.status === "preview",
      ),
      "Offset activation should build preview geometry from compatible preselection.",
    ).toBeTruthy();

    const cleared = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
      [definition.points[0]!.target],
    );

    expect(
      cleared.activeEditTool?.selectedTargets.length,
      "Offset activation should clear incompatible preselected targets instead of carrying them into the edit tool.",
    ).toBe(0);
    expect(
      cleared.toolStagedEntities.length,
      "Cleared offset activation should not leave preview geometry behind.",
    ).toBe(0);
  }

  function testOffsetCreatesContinuousOuterAndInnerSquares() {
    const definition = createSquareDefinition(false);
    let outerSession = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );

    for (const entity of definition.entities) {
      outerSession = selectSketchEditToolTarget(outerSession, entity.target);
    }

    expect(
      outerSession.activeEditTool?.selectedTargets.length,
      "Offset should collect multiple selected square edges.",
    ).toBe(4);
    expect(
      outerSession.toolStagedEntities.filter(
        (entity) => entity.status === "preview" && entity.kind === "line",
      ).length,
      "Continuous square offset should preview one joined line per selected edge.",
    ).toBe(4);

    outerSession = patchSketchEditToolValue(outerSession, { value: 1 });
    outerSession = patchSketchEditToolValue(outerSession, {
      intent: "commitOffset",
    });

    const outerLines = outerSession.definition.entities.filter(
      (entity) =>
        entity.kind === "lineSegment" &&
        !definition.entityIds.includes(entity.entityId),
    );
    const outerPoints = outerSession.definition.points.filter(
      (point) => !definition.pointIds.includes(point.pointId),
    );

    expect(
      outerLines.length,
      "Outer square offset should create four joined line entities.",
    ).toBe(4);
    expect(
      outerPoints.length,
      "Outer square offset should create four joined corner points.",
    ).toBe(4);
    assertIncludesPoint(
      outerPoints,
      [-1, -1],
      "Outer square offset should extend the bottom-left corner.",
    );
    assertIncludesPoint(
      outerPoints,
      [2, -1],
      "Outer square offset should extend the bottom-right corner.",
    );
    assertIncludesPoint(
      outerPoints,
      [2, 2],
      "Outer square offset should extend the top-right corner.",
    );
    assertIncludesPoint(
      outerPoints,
      [-1, 2],
      "Outer square offset should extend the top-left corner.",
    );

    let innerSession = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );
    for (const entity of definition.entities) {
      innerSession = selectSketchEditToolTarget(innerSession, entity.target);
    }

    innerSession = patchSketchEditToolValue(innerSession, {
      intent: "setOffsetSide",
      value: "right",
    });
    innerSession = patchSketchEditToolValue(innerSession, { value: 0.25 });
    innerSession = patchSketchEditToolValue(innerSession, {
      intent: "commitOffset",
    });

    const innerPoints = innerSession.definition.points.filter(
      (point) => !definition.pointIds.includes(point.pointId),
    );
    assertIncludesPoint(
      innerPoints,
      [0.25, 0.25],
      "Inner square offset should miter the bottom-left corner inward.",
    );
    assertIncludesPoint(
      innerPoints,
      [0.75, 0.25],
      "Inner square offset should miter the bottom-right corner inward.",
    );
    assertIncludesPoint(
      innerPoints,
      [0.75, 0.75],
      "Inner square offset should miter the top-right corner inward.",
    );
    assertIncludesPoint(
      innerPoints,
      [0.25, 0.75],
      "Inner square offset should miter the top-left corner inward.",
    );
  }

  function testOffsetCreatesContinuousOpenAngle() {
    const definition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 2, 0),
        makePoint("sketch_point_c", "C", 2, 2),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_bc"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_bc", "BC", "sketch_point_b", "sketch_point_c"),
      ],
    });
    let session = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );
    for (const entity of definition.entities) {
      session = selectSketchEditToolTarget(session, entity.target);
    }

    session = patchSketchEditToolValue(session, { value: 1 });
    session = patchSketchEditToolValue(session, { intent: "commitOffset" });

    const offsetLines = session.definition.entities.filter(
      (entity) =>
        entity.kind === "lineSegment" &&
        !definition.entityIds.includes(entity.entityId),
    );
    const offsetPoints = session.definition.points.filter(
      (point) => !definition.pointIds.includes(point.pointId),
    );

    expect(
      offsetLines.length,
      "Open angle offset should create one joined line per selected edge.",
    ).toBe(2);
    expect(
      offsetPoints.length,
      "Open angle offset should share the mitered corner point.",
    ).toBe(3);
    assertIncludesPoint(
      offsetPoints,
      [0, 1],
      "Open angle offset should keep the first open endpoint offset.",
    );
    assertIncludesPoint(
      offsetPoints,
      [1, 1],
      "Open angle offset should intersect adjacent offset lines at the corner.",
    );
    assertIncludesPoint(
      offsetPoints,
      [1, 2],
      "Open angle offset should keep the last open endpoint offset.",
    );
  }

  function testOffsetAddsCircleArcAndSplineCopies() {
    const definition = makeDefinition({
      pointIds: [
        "sketch_point_center",
        "sketch_point_arc_start",
        "sketch_point_arc_end",
        "sketch_point_s0",
        "sketch_point_s1",
        "sketch_point_s2",
      ],
      points: [
        makePoint("sketch_point_center", "Center", 0, 0),
        makePoint("sketch_point_arc_start", "Arc start", 2, 0),
        makePoint("sketch_point_arc_end", "Arc end", 0, 2),
        makePoint("sketch_point_s0", "S0", 0, 0),
        makePoint("sketch_point_s1", "S1", 1, 2),
        makePoint("sketch_point_s2", "S2", 2, 0),
      ],
      entityIds: [
        "sketch_entity_circle",
        "sketch_entity_arc",
        "sketch_entity_spline",
      ],
      entities: [
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 2),
        makeArc(
          "sketch_entity_arc",
          "Arc",
          "sketch_point_center",
          "sketch_point_arc_start",
          "sketch_point_arc_end",
        ),
        makeSpline("sketch_entity_spline", "Spline", [
          "sketch_point_s0",
          "sketch_point_s1",
          "sketch_point_s2",
        ]),
      ],
    });

    let circleSession = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );
    circleSession = selectSketchEditToolTarget(circleSession, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_circle",
    });
    circleSession = patchSketchEditToolValue(circleSession, { value: 1 });
    circleSession = patchSketchEditToolValue(circleSession, {
      intent: "commitOffset",
    });
    const offsetCircle = circleSession.definition.entities.find(
      (entity) =>
        entity.entityId !== "sketch_entity_circle" && entity.kind === "circle",
    );
    expect(
      offsetCircle?.kind === "circle" && offsetCircle.radius === 3,
      "Circle offset should add a copied circle at the requested radius.",
    ).toBeTruthy();

    let arcSession = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );
    arcSession = selectSketchEditToolTarget(arcSession, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_arc",
    });
    arcSession = patchSketchEditToolValue(arcSession, { value: 1 });
    arcSession = patchSketchEditToolValue(arcSession, {
      intent: "commitOffset",
    });
    expect(
      arcSession.definition.entities.some(
        (entity) =>
          entity.entityId !== "sketch_entity_arc" && entity.kind === "arc",
      ),
      "Arc offset should add a copied arc entity.",
    ).toBeTruthy();

    let splineSession = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );
    splineSession = selectSketchEditToolTarget(splineSession, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_spline",
    });
    splineSession = patchSketchEditToolValue(splineSession, { value: 1 });
    splineSession = patchSketchEditToolValue(splineSession, {
      intent: "commitOffset",
    });
    expect(
      splineSession.definition.entities.some(
        (entity) =>
          entity.entityId !== "sketch_entity_spline" &&
          entity.kind === "spline",
      ),
      "Spline offset should add a copied spline entity.",
    ).toBeTruthy();
  }

  function testOffsetAddsProjectedCircleAndSplineCopies() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [
      {
        referenceId: "ref_projected_curves",
        status: "projected",
        geometry: [
          {
            geometryId: "projected_geometry_circle",
            kind: "circle",
            centerPosition: [0, 0],
            radius: 2,
          },
          {
            geometryId: "projected_geometry_spline",
            kind: "spline",
            fitPoints: [
              [0, 0],
              [1, 2],
              [2, 0],
            ],
            degree: 2,
            isClosed: false,
          },
        ],
        diagnostics: [],
      },
    ];

    let circleSession = beginSketchTool(
      {
        ...createSessionFromDefinition(
          makeDefinition({
            pointIds: [],
            points: [],
            entityIds: [],
            entities: [],
          }),
        ),
        projectedReferences,
      },
      "offset",
    );
    circleSession = selectSketchEditToolTarget(circleSession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_projected_curves",
      geometryId: "projected_geometry_circle",
      geometryKind: "circle",
    });
    expect(
      circleSession.toolStagedEntities.some(
        (entity) => entity.status === "preview" && entity.kind === "circle",
      ),
      "Projected circle offset should preview a circle.",
    ).toBeTruthy();
    circleSession = patchSketchEditToolValue(circleSession, { value: 1 });
    circleSession = patchSketchEditToolValue(circleSession, {
      intent: "commitOffset",
    });
    const offsetCircle = circleSession.definition.entities.find(
      (entity) => entity.kind === "circle",
    );
    expect(
      offsetCircle?.kind === "circle" && offsetCircle.radius === 3,
      "Projected circle offset should create a sketch-owned circle.",
    ).toBeTruthy();

    let splineSession = beginSketchTool(
      {
        ...createSessionFromDefinition(
          makeDefinition({
            pointIds: [],
            points: [],
            entityIds: [],
            entities: [],
          }),
        ),
        projectedReferences,
      },
      "offset",
    );
    splineSession = selectSketchEditToolTarget(splineSession, {
      kind: "projectedReferenceGeometry",
      referenceId: "ref_projected_curves",
      geometryId: "projected_geometry_spline",
      geometryKind: "spline",
    });
    expect(
      splineSession.toolStagedEntities.some(
        (entity) => entity.status === "preview" && entity.kind === "spline",
      ),
      "Projected spline offset should preview a spline.",
    ).toBeTruthy();
    splineSession = patchSketchEditToolValue(splineSession, { value: 1 });
    splineSession = patchSketchEditToolValue(splineSession, {
      intent: "commitOffset",
    });
    expect(
      splineSession.definition.entities.some(
        (entity) => entity.kind === "spline",
      ),
      "Projected spline offset should create a sketch-owned spline.",
    ).toBeTruthy();
  }

  function testSketchFilletChamferAndSlotUseSessionPreviewAndCommit() {
    const cornerDefinition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_c"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
        makePoint("sketch_point_c", "C", 0, 4),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_ac"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_ac", "AC", "sketch_point_a", "sketch_point_c"),
      ],
    });

    let filletSession = beginSketchTool(
      createSessionFromDefinition(cornerDefinition),
      "sketchFillet",
    );
    filletSession = selectSketchEditToolTarget(
      filletSession,
      cornerDefinition.entities[0]!.target,
    );
    filletSession = selectSketchEditToolTarget(
      filletSession,
      cornerDefinition.entities[1]!.target,
    );
    expect(
      filletSession.toolStagedEntities.length > 0,
      "Sketch fillet should preview supported adjacent line edits.",
    ).toBeTruthy();
    filletSession = patchSketchEditToolValue(filletSession, { value: 1 });
    filletSession = patchSketchEditToolValue(filletSession, {
      intent: "commitSketchEditOperator",
    });
    expect(
      filletSession.definition.entities.some((entity) => entity.kind === "arc"),
      "Sketch fillet should commit durable arc geometry through the session.",
    ).toBeTruthy();
    expect(
      filletSession.activeTool,
      "Sketch fillet should keep the active sketch session open.",
    ).toBe("sketchFillet");

    let chamferSession = beginSketchTool(
      createSessionFromDefinition(cornerDefinition),
      "sketchChamfer",
    );
    chamferSession = selectSketchEditToolTarget(
      chamferSession,
      cornerDefinition.entities[0]!.target,
    );
    chamferSession = selectSketchEditToolTarget(
      chamferSession,
      cornerDefinition.entities[1]!.target,
    );
    chamferSession = patchSketchEditToolValue(chamferSession, { value: 1 });
    chamferSession = patchSketchEditToolValue(chamferSession, {
      intent: "commitSketchEditOperator",
    });
    expect(
      chamferSession.definition.entities.length,
      "Sketch chamfer should add one durable chamfer segment.",
    ).toBe(3);

    const lineDefinition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
      ],
      entityIds: ["sketch_entity_ab"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
      ],
    });
    let slotSession = beginSketchTool(
      createSessionFromDefinition(lineDefinition),
      "sketchSlot",
    );
    slotSession = selectSketchEditToolTarget(
      slotSession,
      lineDefinition.entities[0]!.target,
    );
    expect(
      slotSession.toolStagedEntities.length > 0,
      "Sketch slot should preview slot boundary geometry.",
    ).toBeTruthy();
    slotSession = patchSketchEditToolValue(slotSession, { value: 2 });
    slotSession = patchSketchEditToolValue(slotSession, {
      intent: "commitSketchEditOperator",
    });
    expect(
      slotSession.definition.entities.filter((entity) => entity.kind === "arc")
        .length,
      "Sketch slot around a line should commit rounded end arcs.",
    ).toBe(2);
  }

  function testSketchExtendSplitAndUnsupportedDiagnosticsUseSessionState() {
    const extendDefinition = makeDefinition({
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 1, 0),
        makePoint("sketch_point_c", "C", 3, -1),
        makePoint("sketch_point_d", "D", 3, 1),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_cd"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
      ],
    });
    let extendSession = beginSketchTool(
      createSessionFromDefinition(extendDefinition),
      "sketchExtend",
    );
    extendSession = selectSketchEditToolTarget(
      extendSession,
      extendDefinition.entities[0]!.target,
    );
    extendSession = selectSketchEditToolTarget(
      extendSession,
      extendDefinition.entities[1]!.target,
    );
    assertIncludesPoint(
      extendSession.definition.points,
      [3, 0],
      "Sketch extend should update the selected line endpoint at the boundary.",
    );
    expect(
      extendSession.definition.entities.length,
      "Sketch extend should preserve unrelated boundary geometry.",
    ).toBe(2);

    const splitDefinition = makeDefinition({
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_c",
        "sketch_point_d",
      ],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
        makePoint("sketch_point_c", "C", 2, -1),
        makePoint("sketch_point_d", "D", 2, 1),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_cd"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine("sketch_entity_cd", "CD", "sketch_point_c", "sketch_point_d"),
      ],
    });
    let splitSession = beginSketchTool(
      createSessionFromDefinition(splitDefinition),
      "sketchSplit",
    );
    splitSession = selectSketchEditToolTarget(
      splitSession,
      splitDefinition.entities[0]!.target,
    );
    splitSession = selectSketchEditToolTarget(
      splitSession,
      splitDefinition.entities[1]!.target,
    );
    expect(
      splitSession.definition.entities.length,
      "Sketch split should divide the selected line in session state.",
    ).toBe(3);
    assertIncludesPoint(
      splitSession.definition.points,
      [2, 0],
      "Sketch split should add the split point at the crossing boundary.",
    );

    let unsupportedSession = beginSketchTool(
      createSessionFromDefinition(splitDefinition),
      "sketchFillet",
    );
    unsupportedSession = selectSketchEditToolTarget(
      unsupportedSession,
      splitDefinition.entities[0]!.target,
    );
    unsupportedSession = selectSketchEditToolTarget(
      unsupportedSession,
      splitDefinition.entities[1]!.target,
    );
    expect(
      unsupportedSession.validationMessage,
      "Sketch edit operators should report unsupported valid combinations without mutating.",
    ).toBe("Sketch fillet needs two lines that share a corner.");
    expect(
      unsupportedSession.definition.entities.length,
      "Unsupported fillet should not change the sketch definition.",
    ).toBe(splitDefinition.entities.length);
  }

  function testSketchDerivedTransformOperatorsCreateDurableRelationships() {
    const definition = makeDefinition({
      pointIds: [
        "sketch_point_a",
        "sketch_point_b",
        "sketch_point_axis_a",
        "sketch_point_axis_b",
      ],
      points: [
        makePoint("sketch_point_a", "A", 1, 1),
        makePoint("sketch_point_b", "B", 2, 1),
        makePoint("sketch_point_axis_a", "Axis A", -1, 0),
        makePoint("sketch_point_axis_b", "Axis B", 3, 0),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_axis"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeLine(
          "sketch_entity_axis",
          "Axis",
          "sketch_point_axis_a",
          "sketch_point_axis_b",
        ),
      ],
    });

    let mirrorSession = beginSketchTool(
      createSessionFromDefinition(definition),
      "sketchMirror",
    );
    expect(
      mirrorSession.activeTool,
      "Sketch mirror should activate a sketch-local edit workflow.",
    ).toBe("sketchMirror");
    mirrorSession = selectSketchEditToolTarget(
      mirrorSession,
      definition.entities[0]!.target,
    );
    mirrorSession = selectSketchEditToolTarget(
      mirrorSession,
      definition.entities[1]!.target,
    );

    const mirrorRelationship =
      mirrorSession.definition.derivedRelationships?.[0];
    expect(
      mirrorRelationship?.kind,
      "Sketch mirror should persist a mirror relationship.",
    ).toBe("mirror");
    expect(
      mirrorRelationship.seedEntityIds[0],
      "Mirror relationship should keep the selected seed entity.",
    ).toBe("sketch_entity_ab");
    const mirroredPointId = mirrorRelationship.outputs[0]?.outputPointIds[0];
    const mirroredPoint = mirrorSession.definition.points.find(
      (point) => point.pointId === mirroredPointId,
    );
    assertClosePoint(
      mirroredPoint?.position,
      [1, -1],
      "Mirror relationship should evaluate output points from the mirror axis.",
    );

    const editedSeed = {
      ...mirrorSession.definition,
      points: mirrorSession.definition.points.map((point) =>
        point.pointId === "sketch_point_a"
          ? { ...point, position: [1, 2] as const }
          : point,
      ),
    };
    const solvedEdited = solveSketchDefinitionCore({
      definition: editedSeed,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });
    const updatedDerivedPoint = solvedEdited.solvedSnapshot.solvedPoints.find(
      (point) => point.pointId === mirroredPointId,
    );
    assertClosePoint(
      updatedDerivedPoint?.solvedPosition,
      [1, -2],
      "Derived output should update when a supported seed point changes.",
    );

    const renderable = getSketchSessionDisplayRenderables(mirrorSession).find(
      (entry) =>
        entry.target?.kind === "sketchEntity" &&
        entry.target.entityId === mirrorRelationship.outputs[0]?.outputEntityId,
    );
    expect(
      renderable,
      "Derived sketch geometry should render with a stable sketch entity target.",
    ).toBeTruthy();
  }

  function testSketchPatternAndTransformOperatorsCommitWithoutPartFeatureSessions() {
    const definition = createSquareDefinition(false);
    const sketchToolIds = [
      "sketchLinearPattern",
      "sketchCircularPattern",
      "sketchTransform",
    ] as const;

    for (const toolId of sketchToolIds) {
      expect(
        toolDefinitions.some(
          (tool) => tool.id === toolId && tool.modes.includes("sketch"),
        ),
        `${toolId} should be registered as a sketch-mode toolbar tool.`,
      ).toBeTruthy();
      expect(
        toolDefinitions.some(
          (tool) => tool.id === toolId && tool.modes.includes("part"),
        ),
        `${toolId} should remain distinct from part-mode feature tools.`,
      ).toBeFalsy();

      let session = beginSketchTool(
        createSessionFromDefinition(definition),
        toolId,
      );
      expect(
        session.activeTool,
        `${toolId} should keep the active sketch session open.`,
      ).toBe(toolId);
      for (const entity of definition.entities) {
        session = selectSketchEditToolTarget(session, entity.target);
      }
      session = patchSketchEditToolValue(session, {
        value: toolId === "sketchCircularPattern" ? Math.PI : 2,
      });
      session = patchSketchEditToolValue(session, {
        intent: "commitSketchEditOperator",
      });

      const relationship = session.definition.derivedRelationships?.[0];
      expect(
        relationship,
        `${toolId} should persist a derived relationship.`,
      ).toBeTruthy();
      expect(
        session.definition.entities.length,
        `${toolId} should add addressable derived output entities.`,
      ).toBe(definition.entities.length * 2);
      expect(
        session.commitRequest?.definition.derivedRelationships?.length,
        `${toolId} commit payload should persist the relationship.`,
      ).toBe(1);
    }
  }

  function testDerivedLinearPatternGeometryParticipatesInProfiles() {
    const definition = createSquareDefinition(false);
    let session = beginSketchTool(
      createSessionFromDefinition(definition),
      "sketchLinearPattern",
    );
    for (const entity of definition.entities) {
      session = selectSketchEditToolTarget(session, entity.target);
    }
    session = patchSketchEditToolValue(session, { value: 3 });
    session = patchSketchEditToolValue(session, {
      intent: "commitSketchEditOperator",
    });

    const solved = solveSketchDefinitionCore({
      definition: session.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });
    const regions = deriveSketchRegionsCore({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition: session.definition,
      solvedSnapshot: solved.solvedSnapshot,
    });

    expect(
      regions.regions.length >= 2,
      "Derived pattern output should participate in profile extraction when it forms a closed loop.",
    ).toBeTruthy();
    expect(
      regions.regions.some((region) =>
        region.loops.some((loop) =>
          loop.segments.some(
            (segment) =>
              segment.source.kind === "entity" &&
              (session.definition.derivedRelationships?.[0]?.outputs.some(
                (output) => output.outputEntityId === segment.source.entityId,
              ) ??
                false),
          ),
        ),
      ),
      "At least one extracted profile should reference derived output entities without detaching them.",
    ).toBeTruthy();
  }

  function testPointerOnlyPreviewReusesStableDisplayRenderables() {
    let session = beginSketchTool(
      createSessionFromDefinition(createSquareDefinition(false)),
      "line",
    );
    session = startSketchDraw(session, [0, 0]);
    const previewAtOne = updateSketchPointer(session, [1, 0]);
    const stableAtOne = getStableSketchSessionDisplayRenderables(previewAtOne);
    const transientAtOne =
      getTransientSketchSessionDisplayRenderables(previewAtOne);
    const previewAtTwo = updateSketchPointer(previewAtOne, [2, 0]);
    const stableAtTwo = getStableSketchSessionDisplayRenderables(previewAtTwo);
    const transientAtTwo =
      getTransientSketchSessionDisplayRenderables(previewAtTwo);

    expect(
      stableAtOne,
      "Pointer-only drawing preview should reuse the accepted stable display renderables.",
    ).toBe(stableAtTwo);
    expect(
      transientAtOne,
      "Pointer-only drawing preview should rebuild only transient staged renderables.",
    ).not.toBe(transientAtTwo);
    expect(
      transientAtTwo.length > 0,
      "Pointer-only drawing preview should still produce visible staged tool feedback.",
    ).toBeTruthy();
  }

  function testAcceptedSketchEditInvalidatesStableDisplayRenderables() {
    let session = beginSketchTool(
      createSessionFromDefinition(createSquareDefinition(false)),
      "line",
    );
    session = startSketchDraw(session, [0, 0]);
    const preview = updateSketchPointer(session, [1, 0]);
    const stablePreviewKey = getStableSketchSessionDisplayKey(preview);
    const stablePreview = getStableSketchSessionDisplayRenderables(preview);
    const accepted = acceptSketchDraw(preview, [1, 0]);
    const stableAccepted = getStableSketchSessionDisplayRenderables(accepted);

    expect(
      getStableSketchSessionDisplayKey(accepted),
      "Accepted sketch geometry changes should invalidate the stable display basis.",
    ).not.toBe(stablePreviewKey);
    expect(
      stableAccepted,
      "Accepted sketch geometry changes should derive a new stable renderable basis.",
    ).not.toBe(stablePreview);
  }

  function testNoOpPointerMovementPreservesSessionIdentity() {
    const idleSession = createSessionFromDefinition(
      createSquareDefinition(false),
    );
    const idleMoved = updateSketchPointer(idleSession, [4, 4]);

    let drawingSession = beginSketchTool(idleSession, "line");
    drawingSession = startSketchDraw(drawingSession, [0, 0]);
    const firstPreview = updateSketchPointer(drawingSession, [1, 0]);
    const samePreview = updateSketchPointer(firstPreview, [1, 0]);

    expect(
      idleMoved,
      "Pointer movement with no active preview state should preserve session identity.",
    ).toBe(idleSession);
    expect(
      samePreview,
      "Pointer movement inside the same preview point bucket should preserve session identity.",
    ).toBe(firstPreview);
  }

  function testLogoCadaraPointerPreviewReusesStableDisplayBasis() {
    const parsed = parseAuthoredModelDocument(
      JSON.parse(readFileSync("public/logo.cadara", "utf8")),
    );
    expect(
      parsed.ok,
      "public/logo.cadara should parse as an authored Cadara document fixture.",
    ).toBeTruthy();
    if (!parsed.ok) {
      return;
    }

    const sketch = parsed.document.sketches[0];
    expect(
      sketch,
      "public/logo.cadara should contain a sketch fixture.",
    ).not.toBe(undefined);
    if (!sketch) {
      return;
    }

    const solved = solveSketchDefinitionCore({
      definition: sketch.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });
    let session = createSketchSessionFromSnapshot({
      ownerDocumentId: parsed.document.documentId,
      ownerRevisionId: parsed.document.revisionId,
      ownerFeatureId: null,
      ownerSketchId: sketch.sketchId,
      ownerBodyId: null,
      sketchId: sketch.sketchId,
      label: sketch.label,
      plane: sketch.plane,
      planeTarget: sketch.plane.support,
      planeKey: sketch.plane.key,
      sketch: {
        ownerDocumentId: parsed.document.documentId,
        ownerRevisionId: parsed.document.revisionId,
        ownerFeatureId: null,
        ownerSketchId: sketch.sketchId,
        ownerBodyId: null,
        sketchId: sketch.sketchId,
        label: sketch.label,
        planeSupport: sketch.plane.support,
        definition: sketch.definition,
        solvedSnapshot: solved.solvedSnapshot,
        regions: [],
      },
    } satisfies SketchSnapshotRecord);
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);

    const firstPreview = updateSketchPointer(session, [1, 0]);
    const stableDisplay =
      getStableSketchSessionDisplayRenderables(firstPreview);

    let nextPreview = firstPreview;
    for (let index = 0; index < 40; index += 1) {
      nextPreview = updateSketchPointer(nextPreview, [index + 2, index % 5]);
      expect(
        getStableSketchSessionDisplayRenderables(nextPreview),
        "Logo pointer-only preview movement should not rebuild accepted sketch display.",
      ).toBe(stableDisplay);
    }
  }

  testUnconstrainedPointDragUpdatesAuthoredDefinition();
  testConstrainedSquareDragTranslatesSolvedShape();
  testLogoLikeFreeEndpointDragClearsValidationFeedback();
  testAnchoredBranchDragStaysContinuousWithoutFlipping();
  testLiveRegionRenderableTracksJiggledSketchDrag();
  testLiveRegionRenderablePreservesInnerLoopHole();
  testLiveRegionRenderableTriangulatesConcaveRegion();
  testLiveRegionDiagnosticsAreAvailableDuringEditing();
  testConstrainedDragRegionDerivationBenchmark();
  testConnectedSketchSelectionSelectsTwoConnectedLines();
  testConnectedSketchSelectionSelectsRectangleFromAnyEdge();
  testConnectedSketchSelectionUsesLocalEntityTargetNamespace();
  testConnectedSketchSelectionSelectsBranchingComponentAndRejectsUnsupportedTargets();
  testRectangleToolDragTranslatesWholeRectangle();
  testImmovableConstrainedDragBlocksWithoutChangingDraft();
  testFixedLogoLikeEndpointDragBlocksWithConstrainedFeedback();
  testPerpendicularSlideShowsNoConstrainedFeedback();
  testSelectedEntityDeletionRemovesDependentAnnotations();
  testSelectedPointDeletionRemovesDependentGeometryAndAnnotations();
  testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets();
  testSvgRenderingToggleSuppressesAuthoredStylesWithoutDeletingThem();
  testTrimSplitsLineAtClearIntersections();
  testTrimHandlesCircleArcAndSplineTargets();
  testOffsetAddsLineCopyAndRejectsInvalidDistance();
  testOffsetActivationSeedsCompatiblePreselectionAndClearsInvalidSelection();
  testOffsetCreatesContinuousOuterAndInnerSquares();
  testOffsetCreatesContinuousOpenAngle();
  testOffsetAddsCircleArcAndSplineCopies();
  testOffsetAddsProjectedCircleAndSplineCopies();
  testSketchFilletChamferAndSlotUseSessionPreviewAndCommit();
  testSketchExtendSplitAndUnsupportedDiagnosticsUseSessionState();
  testSketchDerivedTransformOperatorsCreateDurableRelationships();
  testSketchPatternAndTransformOperatorsCommitWithoutPartFeatureSessions();
  testDerivedLinearPatternGeometryParticipatesInProfiles();
  testPointerOnlyPreviewReusesStableDisplayRenderables();
  testAcceptedSketchEditInvalidatesStableDisplayRenderables();
  testNoOpPointerMovementPreservesSessionIdentity();
  testLogoCadaraPointerPreviewReusesStableDisplayBasis();
});
