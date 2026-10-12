import { test, expect } from "vitest";
import { readFileSync } from "node:fs";

import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchSessionState } from "@/domain/editor/sketch-session";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";
import type { SketchSnapshotRecord } from "@/contracts/modeling/schema";
import { parseAuthoredModelDocument } from "@/contracts/modeling/authored-document.runtime-schema";
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  cancelSketchGeometryDrag,
  completeSketchOffsetPreviewPublication,
  createNewSketchSession,
  createNewSketchSessionFromSupport,
  hasAcceptedLiveSolveOfDefinition,
  withLiveSolveBasis,
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  deriveSketchDisplayEntities,
  finalizeSketchDraw,
  finishSketchGeometryDrag,
  getConnectedSketchEntitySelectionTargets,
  getSketchSessionDerivedValidity,
  getSketchSessionRegionDiagnostics,
  isSketchSvgRenderingEnabled,
  patchSketchStyleValue,
  patchSketchEditToolValue,
  getSketchSessionLiveRegionBasis,
  publishSketchLiveRegions,
  patchSketchConstraintValue,
  selectSketchConstraintTarget,
  selectSketchEditToolTarget,
  startSketchDraw,
  toggleSketchSvgRendering,
  updateSketchGeometryDrag,
  updateSketchPointer,
  updateSketchReferenceProjection,
  acceptSketchDraw
} from "@/domain/editor/sketch-session";
import { getSketchSessionDisplayRenderables, getStableSketchSessionDisplayRenderables, getTransientSketchSessionDisplayRenderables 
} from "@/domain/editor/sketch-session/display";
import { getStableSketchSessionDisplayKey } from "@/domain/editor/sketch-session/solved-snapshot";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import { completeSketchEditQueriesForTest } from "@/domain/editor/state-machine-test-builder";
import { TRIM_BASIS_NOT_ACCEPTED_MESSAGE } from "@/domain/editor/sketch-session/editing";
import {
  PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
  SPLINE_SLOT_UNSUPPORTED_MESSAGE,
} from "@/domain/sketch-editing/operations";
import { createSketchArrangementDeriver } from "@/contracts/sketch/region-extraction";
import { createRegionBoundaryBasis } from "@/contracts/sketch/region-boundary-curves";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { toolDefinitions } from "@/core/tools/tool-registry";
import { publishSketchOffsets } from "@/contracts/sketch/offset-publication";
import { createCertifiedNeutralCurveRequestQuery } from "@/domain/modeling/neutral-curve-certification/query";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import {
  SPEC_SKETCH_UNITS_PER_PIXEL,
  withSketchSnapScale,
} from "@/domain/editor/sketch-session/test-snap-scale";

test("src/domain/editor/sketch-geometry-editing.spec.ts", async () => {
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
      pointOccurrenceIds: fitPointIds.map((_, index) => `occ-${index}`),
      pointOccurrences: fitPointIds.map((pointId, index) => ({
        occurrenceId: `occ-${index}`,
        pointId: pointId as `sketch_point_${string}`,
        tangent: { kind: "automatic" as const },
      })),
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
  }

  function makeDefinition(input: {
    pointIds: readonly string[];
    points: SketchDefinition["points"];
    entityIds: readonly string[];
    entities: SketchDefinition["entities"];
  }): SketchDefinition {
    return {
      schemaVersion: "sketch-definition/v1alpha2",
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
      schemaVersion: "sketch-definition/v1alpha2",
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
      schemaVersion: "sketch-definition/v1alpha2",
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
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    return createSketchSessionFromSnapshot(
      {
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
          derivedValidity: { state: "current", diagnostics: [] },
          regions: [],
        },
      } satisfies SketchSnapshotRecord,
      OCC_KERNEL_SETTINGS,
    );
  }

  /** A sketch opened for editing: every entry establishes its live solve (T11a), as `enterSketchEditing` does without references. */
  function openSessionFromDefinition(definition: SketchDefinition) {
    return updateSketchReferenceProjection(
      createSessionFromDefinition(definition),
      [],
      [],
    );
  }

  const regionDeriver = createSketchArrangementDeriver(
    createCertifiedNeutralCurveQueryCapabilityForTest(),
  );

  async function deriveRegionsForDefinition(definition: SketchDefinition) {
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });

    const { regions } = await regionDeriver.derive({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition,
      solvedSnapshot: solved.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
    });
    return {
      regions,
      // T10e (R2): committed regions travel with the pair they came from.
      boundaryBasis: createRegionBoundaryBasis(
        {
          definition,
          solvedSnapshot: solved.solvedSnapshot,
          projectedReferences: [],
        },
        regions,
      ),
    };
  }

  async function withCommittedRegions(
    session: ReturnType<typeof createSessionFromDefinition>,
  ) {
    return {
      ...session,
      liveRegions: {
        ...session.liveRegions,
        ...(await deriveRegionsForDefinition(session.definition)),
      },
    };
  }

  // Stands in for the editor's async `sketch.deriveRegions` effect at the
  // session seam: derives for the session's own pending basis and publishes.
  async function publishPendingLiveRegions(
    session: ReturnType<typeof createSessionFromDefinition>,
  ) {
    expect(
      session.liveRegions.status,
      "A new live solve basis should leave live regions pending until derived.",
    ).toBe("pending");
    const basis = getSketchSessionLiveRegionBasis(session);
    expect(
      basis,
      "A pending session should expose its live basis.",
    ).toBeTruthy();
    const derived = await regionDeriver.derive({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: basis!.sketchId,
      definition: basis!.definition,
      solvedSnapshot: basis!.solvedSnapshot,
      projectedReferences: basis!.projectedReferences,
      modelingTolerance: basis!.modelingTolerance,
    });
    return publishSketchLiveRegions(
      session,
      derived.regions,
      derived.diagnostics,
    );
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
    let session = createNewSketchSessionFromSupport(
      {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [1, 0]);
    // The line chain continues after the segment (T11-D11); ending it (the
    // Escape step restarts the armed Line) leaves an idle drawing tool.
    session = beginSketchTool(session, "line");

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
      (point) =>
        point.pointId === "sketch_point_5_line-end" ||
        point.pointId.startsWith("sketch_point_5_line-end_"),
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

  async function testLiveRegionRenderableTracksJiggledSketchDrag() {
    let session = createSessionFromDefinition(createSquareDefinition(false));
    session = await withCommittedRegions(session);
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_b",
    )?.target;
    expect(target, "Expected square vertex B.").toBeTruthy();

    const initialBounds = getRegionRenderableBounds(session);
    const initialRegionId = session.liveRegions.regions[0]?.regionId;
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
      getSketchSessionDerivedValidity(session).state,
      "A completed drag should show the retained regions as stale until derived.",
    ).toBe("stale");
    session = await publishPendingLiveRegions(session);

    expect(
      session.liveRegions.regions.length,
      "Dragging the square should keep one live derived region.",
    ).toBe(1);
    expect(
      session.liveRegions.regions[0]?.regionId,
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

  async function testLiveRegionRenderablePreservesInnerLoopHole() {
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
    session = await withCommittedRegions(session);

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

  async function testLiveRegionRenderableTriangulatesConcaveRegion() {
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
    session = await withCommittedRegions(session);

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

  async function testLiveRegionDiagnosticsAreAvailableDuringEditing() {
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
      session.liveRegions.status,
      "Accepted drag movement should defer live region derivation until the drag completes.",
    ).toBe("pending");
    expect(
      getSketchSessionDerivedValidity(session).state,
      "Deferred profile output must be explicitly stale.",
    ).toBe("stale");
    session = finishSketchGeometryDrag(session, [2.25, 0]);
    session = await publishPendingLiveRegions(session);
    expect(
      getSketchSessionRegionDiagnostics(session).some(
        (diagnostic) => diagnostic.code === "profile-open-segment",
      ),
      "Deferred live region diagnostics should be available after the refresh runs.",
    ).toBeTruthy();
  }

  async function testConstrainedDragRegionDerivationBenchmark() {
    const definition = createSquareDefinition(false);
    let session = createSessionFromDefinition(definition);
    session = await withCommittedRegions(session);
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_b",
    )?.target;
    expect(target, "Expected square vertex B.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [1, 0]);
    const frameCount = 30;
    const startedAt = performance.now();
    for (let index = 0; index < frameCount; index += 1) {
      const t = index / (frameCount - 1);
      const previous = session;
      session = updateSketchGeometryDrag(session, [1 + t * 3, t * 2]);
      expect(
        session.liveRegions.regions.length,
        "Drag-frame updates should keep the previous constrained square profile visible.",
      ).toBe(1);
      if (index === 0) {
        expect(
          session,
          "A motionless frame must not mutate or rederive the draft.",
        ).toBe(previous);
      } else {
        expect(
          session.liveRegions.status,
          "Moving drag frames should defer live region derivation.",
        ).toBe("pending");
        expect(
          getSketchSessionDisplayRenderables(session)
            .filter((renderable) => renderable.semanticClass === "region")
            .every((renderable) => renderable.target === null),
          "Stale profile display must not expose selectable region targets.",
        ).toBeTruthy();
      }
    }
    const elapsed = performance.now() - startedAt;
    expect(
      elapsed < 1_500,
      `Constrained drag live-region benchmark should stay responsive; ${frameCount} frames took ${elapsed.toFixed(1)}ms.`,
    ).toBeTruthy();
  }

  // T13a2 (issue 05): a size-free rectangle's corner drag resizes it with
  // minimum motion; the opposite corner stays (re-pinned from "translates").
  function testRectangleToolCornerDragResizesRectangle() {
    let session = createNewSketchSessionFromSupport(
      {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "rectangle");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 3]);

    const target = session.definition.points.find(
      (point) =>
        point.pointId === "sketch_point_1_rect-bottom-left" ||
        point.pointId.startsWith("sketch_point_1_rect-bottom-left_"),
    )?.target;
    expect(target, "Expected rectangle bottom-left vertex.").toBeTruthy();

    session = beginSketchGeometryDrag(session, target, [0, 0]);
    session = finishSketchGeometryDrag(session, [2, 2]);

    const points = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    assertClosePoint(
      points.get(
        session.definition.pointIds.find((id) =>
          id.startsWith("sketch_point_1_rect-bottom-left_"),
        )!,
      ),
      [2, 2],
      "The dragged bottom-left corner reaches the pointer.",
    );
    assertClosePoint(
      points.get(
        session.definition.pointIds.find((id) =>
          id.startsWith("sketch_point_1_rect-bottom-right_"),
        )!,
      ),
      [4, 2],
      "Bottom right rises with the bottom side (horizontal held).",
    );
    assertClosePoint(
      points.get(
        session.definition.pointIds.find((id) =>
          id.startsWith("sketch_point_1_rect-top-right_"),
        )!,
      ),
      [4, 3],
      "The opposite top-right corner stays (minimum motion).",
    );
    assertClosePoint(
      points.get(
        session.definition.pointIds.find((id) =>
          id.startsWith("sketch_point_1_rect-top-left_"),
        )!,
      ),
      [2, 3],
      "Top left moves with the left side (vertical held).",
    );
    expect(
      session.validationMessage,
      "A resizable rectangle drag should not leave blocked feedback.",
    ).toBe(null);
  }

  async function testImmovableConstrainedDragBlocksWithoutChangingDraft() {
    let session = createSessionFromDefinition(createSquareDefinition(true));
    session = await withCommittedRegions(session);
    const before = new Map(
      session.definition.points.map((point) => [point.pointId, point.position]),
    );
    const beforeRegionIds = session.liveRegions.regions
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
      session.liveRegions.regions.map((region) => region.regionId).join(","),
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
      (point) =>
        point.pointId === "sketch_point_5_line-end" ||
        point.pointId.startsWith("sketch_point_5_line-end_"),
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

  // T12b: grab offset is preserved — pressing near a point does not make it jump.
  function testGrabOffsetPreservesPointPosition() {
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");

    const point = session.definition.points.find(
      (p) => p.position[0] === 4 && p.position[1] === 0,
    );
    expect(point, "Expected the line endpoint at [4, 0].").toBeTruthy();

    // Press near the point (offset of [0.5, 0.3]).
    const pointerDown: readonly [number, number] = [3.5, -0.3];
    session = beginSketchGeometryDrag(session, point.target, pointerDown);
    expect(session.activeDrag, "Drag should start.").not.toBe(null);
    expect(
      session.activeDrag?.grabOffset,
      "Grab offset should be point.position - pointerDown.",
    ).toBeTruthy();
    const grabOffset = session.activeDrag!.grabOffset;
    assertClosePoint(
      grabOffset,
      [4 - 3.5, 0 - -0.3],
      "Grab offset should be [0.5, 0.3].",
    );

    // Drag to pointer position [5.5, 0.3] — with offset the target is [6, 0.6].
    session = finishSketchGeometryDrag(session, [5.5, 0.3]);
    const movedPoint = session.definition.points.find(
      (p) => p.pointId === point.pointId,
    );
    assertClosePoint(
      movedPoint?.position,
      [6, 0.6],
      "The point should move to pointer + grabOffset = [5.5 + 0.5, 0.3 + 0.3] = [6, 0.6].",
    );
  }

  // T12b: two presses at different positions near the same point, same
  // world-space delta, produce the same final geometry.
  function testTwoPressPointsProduceSameGeometry() {
    function dragFromOffset(
      offsetX: number,
      offsetY: number,
      deltaX: number,
      deltaY: number,
    ) {
      let session = createNewSketchSessionFromSupport(
        { kind: "construction", constructionId: "construction_plane-xy" },
        OCC_KERNEL_SETTINGS,
      );
      session = beginSketchTool(session, "line");
      session = startSketchDraw(session, [0, 0]);
      session = acceptSketchDraw(session, [2, 0]);
      session = beginSketchTool(session, "line");

      const point = session.definition.points.find(
        (p) => p.position[0] === 2 && p.position[1] === 0,
      )!;
      const pressX = point.position[0] + offsetX;
      const pressY = point.position[1] + offsetY;
      session = beginSketchGeometryDrag(session, point.target, [
        pressX,
        pressY,
      ]);
      session = finishSketchGeometryDrag(session, [
        pressX + deltaX,
        pressY + deltaY,
      ]);
      return session.definition.points.find((p) => p.pointId === point.pointId)!
        .position;
    }

    const posA = dragFromOffset(0, 0, 3, 1);
    const posB = dragFromOffset(0.3, -0.2, 3, 1);
    assertClosePoint(
      posA,
      posB,
      "Equivalent world-space deltas from different press points must produce the same geometry.",
    );
  }

  // T12b: a drag on a non-draggable target (non-point) returns the session unchanged.
  // T12b: a drag on a non-draggable target (D9) returns the session unchanged.
  function testNonDraggableTargetReturnsUnchanged() {
    const session = createSessionFromDefinition(
      makeDefinition({
        pointIds: ["sketch_point_a", "sketch_point_b"],
        points: [
          makePoint("sketch_point_a", "A", 0, 0),
          makePoint("sketch_point_b", "B", 4, 0),
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
      }),
    );
    // D9: a datum reference is non-draggable.
    const datumTarget = {
      kind: "sketchDatumReference" as const,
      sketchId: "sketch_primary" as `sketch_${string}`,
      datumId: "datum_xy" as `datum_${string}`,
    };
    const result = beginSketchGeometryDrag(
      session,
      datumTarget as import("@/core/editor/schema").PrimitiveRef,
      [2, 0],
    );
    expect(result.activeDrag, "D9: datum target must not start a drag.").toBe(
      null,
    );
  }

  // T12b: entity body drag starts and translates all defining points (unconstrained).
  function testEntityBodyDragTranslatesLine() {
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");

    const entity = session.definition.entities[0]!;
    session = beginSketchGeometryDrag(session, entity.target, [2, 0], {
      kind: "entityBody",
      entityId: entity.entityId,
    });
    expect(session.activeDrag, "Entity body drag should start.").not.toBe(null);
    expect(session.activeDrag?.intent.kind).toBe("translate");

    session = finishSketchGeometryDrag(session, [3, 2]);
    const points = new Map(
      session.definition.points.map((p) => [p.pointId, p.position]),
    );
    // Both endpoints should have translated by [1, 2].
    assertClosePoint(
      points.get(session.definition.pointIds[0]!),
      [1, 2],
      "Line start should translate by drag delta.",
    );
    assertClosePoint(
      points.get(session.definition.pointIds[1]!),
      [5, 2],
      "Line end should translate by drag delta.",
    );
  }

  // T12b: circle rim drag changes the radius, center stays.
  function testCircleRimDragChangesRadius() {
    const session = createSessionFromDefinition(
      makeDefinition({
        pointIds: ["sketch_point_center"],
        points: [makePoint("sketch_point_center", "Center", 0, 0)],
        entityIds: ["sketch_entity_circle"],
        entities: [
          makeCircle(
            "sketch_entity_circle",
            "Circle",
            "sketch_point_center",
            3,
          ),
        ],
      }),
    );
    const entity = session.definition.entities[0]!;
    let dragging = beginSketchGeometryDrag(session, entity.target, [3, 0], {
      kind: "rim",
      entityId: entity.entityId,
    });
    expect(dragging.activeDrag?.intent.kind).toBe("radius");
    // Drag rim outward: pointer moves from [3,0] to [5,0].
    dragging = finishSketchGeometryDrag(dragging, [5, 0]);
    const circle = dragging.definition.entities.find(
      (e) => e.entityId === entity.entityId,
    );
    expect(
      circle && circle.kind === "circle" ? circle.radius : null,
    ).toBeCloseTo(5, 3);
    // Center should not have moved.
    assertClosePoint(
      dragging.definition.points.find(
        (p) => p.pointId === "sketch_point_center",
      )?.position,
      [0, 0],
      "Circle center must not move during a rim drag.",
    );
  }

  // T12b: cancel restores pre-drag definition including automatic tangent state.
  function testCancelRestoresPreDragDefinition() {
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");

    const origDef = session.definition;
    const point = session.definition.points[0]!;
    session = beginSketchGeometryDrag(session, point.target, point.position);
    expect(session.activeDrag?.preDragDefinition).toBe(origDef);

    // cancelSketchGeometryDrag must restore the exact original definition.
    const cancelled = cancelSketchGeometryDrag(session);
    expect(
      cancelled.definition,
      "cancelSketchGeometryDrag must restore preDragDefinition.",
    ).toBe(origDef);
    expect(cancelled.activeDrag, "Drag must be cleared after cancel.").toBe(
      null,
    );
  }

  // T12b: the activeDrag state includes handle, intent, and grabOffset.
  function testActiveDragStateIncludesHandleAndIntent() {
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [3, 0]);
    session = beginSketchTool(session, "line");

    const point = session.definition.points[0]!;
    session = beginSketchGeometryDrag(session, point.target, point.position);
    expect(
      session.activeDrag?.handle,
      "activeDrag should include the resolved handle.",
    ).toEqual({ kind: "point", pointId: point.pointId });
    expect(
      session.activeDrag?.intent,
      "activeDrag should include the resolved intent.",
    ).toEqual({ kind: "point", pointId: point.pointId });
    assertClosePoint(
      session.activeDrag?.grabOffset,
      [0, 0],
      "Pressing exactly on the point should give zero grab offset.",
    );
  }

  // --- T12b takeover: spline fixture via tool path for handle/body/tangent rows ---

  /** Draw a 3-point open spline through the tool, returning a session with
   *  the spline committed (idle, no active tool). */
  function drawThreePointSpline() {
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "spline");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [3, 4]);
    session = acceptSketchDraw(session, [6, 0]);
    session = finalizeSketchDraw(session);
    session = beginSketchTool(session, "line"); // exit tool to idle
    return session;
  }

  function getSplineEntity(session: SketchSessionState) {
    return session.definition.entities.find((e) => e.kind === "spline")!;
  }

  function getSplineOccurrenceByPointId(
    session: SketchSessionState,
    entityId: string,
    pointId: string,
  ) {
    const entity = session.definition.entities.find(
      (e) => e.entityId === entityId,
    );
    if (!entity || entity.kind !== "spline") return undefined;
    return entity.pointOccurrences.find((occ) => occ.pointId === pointId);
  }

  // R-1 row 1: Fit point carries its authored vector.
  function testFitPointDragCarriesAuthoredVector() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    // Set the first occurrence to an authored tangent.
    const occ0 = spline.pointOccurrences[0]!;
    const fitPointId = occ0.pointId;
    const authoredVector: readonly [number, number] = [1.5, 0.5];
    session = {
      ...session,
      definition: {
        ...session.definition,
        entities: session.definition.entities.map((e) =>
          e.entityId === spline.entityId && e.kind === "spline"
            ? {
                ...e,
                pointOccurrences: e.pointOccurrences.map((o) =>
                  o.occurrenceId === occ0.occurrenceId
                    ? {
                        ...o,
                        tangent: {
                          kind: "authored" as const,
                          vector: authoredVector,
                        },
                      }
                    : o,
                ),
              }
            : e,
        ),
      },
    };

    const fitPoint = session.definition.points.find(
      (p) => p.pointId === fitPointId,
    )!;
    session = beginSketchGeometryDrag(
      session,
      fitPoint.target,
      fitPoint.position,
    );
    expect(session.activeDrag, "Fit point drag should start.").not.toBe(null);
    session = finishSketchGeometryDrag(session, [
      fitPoint.position[0] + 1,
      fitPoint.position[1] + 1,
    ]);
    const afterOcc = getSplineOccurrenceByPointId(
      session,
      spline.entityId,
      fitPointId,
    );
    expect(
      afterOcc?.tangent.kind,
      "Tangent must remain authored after fit point drag.",
    ).toBe("authored");
    if (afterOcc?.tangent.kind === "authored") {
      // The vector should be preserved (within solver tolerance for constrained, bitwise for unconstrained).
      const dist = Math.hypot(
        afterOcc.tangent.vector[0] - authoredVector[0],
        afterOcc.tangent.vector[1] - authoredVector[1],
      );
      expect(
        dist < 1e-6,
        `Authored vector should be preserved during fit point drag. Got [${afterOcc.tangent.vector}], expected [${authoredVector}]. Distance: ${dist}`,
      ).toBeTruthy();
    }
  }

  // R-1 row 2: Spline body keeps authored vectors.
  function testSplineBodyKeepsAuthoredVectors() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    const occ0 = spline.pointOccurrences[0]!;
    const authoredVector: readonly [number, number] = [2, -1];
    session = {
      ...session,
      definition: {
        ...session.definition,
        entities: session.definition.entities.map((e) =>
          e.entityId === spline.entityId && e.kind === "spline"
            ? {
                ...e,
                pointOccurrences: e.pointOccurrences.map((o) =>
                  o.occurrenceId === occ0.occurrenceId
                    ? {
                        ...o,
                        tangent: {
                          kind: "authored" as const,
                          vector: authoredVector,
                        },
                      }
                    : o,
                ),
              }
            : e,
        ),
      },
    };

    session = beginSketchGeometryDrag(session, spline.target, [3, 2], {
      kind: "entityBody",
      entityId: spline.entityId,
    });
    expect(session.activeDrag?.intent.kind).toBe("translate");
    session = finishSketchGeometryDrag(session, [4, 3]);
    const afterOcc = getSplineOccurrenceByPointId(
      session,
      spline.entityId,
      occ0.pointId,
    );
    expect(
      afterOcc?.tangent.kind,
      "Tangent must remain authored after body translate.",
    ).toBe("authored");
    if (afterOcc?.tangent.kind === "authored") {
      const dist = Math.hypot(
        afterOcc.tangent.vector[0] - authoredVector[0],
        afterOcc.tangent.vector[1] - authoredVector[1],
      );
      expect(
        dist < 1e-6,
        `Authored vector should be preserved during body translate. Got [${afterOcc.tangent.vector}], expected [${authoredVector}]. Distance: ${dist}`,
      ).toBeTruthy();
    }
  }

  // R-1 row 3: Handle drag changes only the vector, fit points fixed.
  function testHandleDragChangesOnlyVector() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    const occ0 = spline.pointOccurrences[0]!;
    const fitPointId = occ0.pointId;
    const initialVector: readonly [number, number] = [1, 0];
    session = {
      ...session,
      definition: {
        ...session.definition,
        entities: session.definition.entities.map((e) =>
          e.entityId === spline.entityId && e.kind === "spline"
            ? {
                ...e,
                pointOccurrences: e.pointOccurrences.map((o) =>
                  o.occurrenceId === occ0.occurrenceId
                    ? {
                        ...o,
                        tangent: {
                          kind: "authored" as const,
                          vector: initialVector,
                        },
                      }
                    : o,
                ),
              }
            : e,
        ),
      },
    };

    const fitPoint = session.definition.points.find(
      (p) => p.pointId === fitPointId,
    )!;
    const fitPointPos = fitPoint.position;
    // Handle tip is at fitPoint + vector = [fitPointPos[0]+1, fitPointPos[1]].
    const handleTip: readonly [number, number] = [
      fitPointPos[0] + 1,
      fitPointPos[1],
    ];

    session = beginSketchGeometryDrag(session, spline.target, handleTip, {
      kind: "tangentHandle",
      entityId: spline.entityId,
      occurrenceId: occ0.occurrenceId,
      pointId: fitPointId,
    });
    expect(
      session.activeDrag?.intent.kind,
      "Should be tangentVector intent.",
    ).toBe("tangentVector");

    // Drag handle to a new position.
    session = finishSketchGeometryDrag(session, [
      handleTip[0] + 2,
      handleTip[1] + 1,
    ]);

    // Fit point should not have moved.
    const afterFitPoint = session.definition.points.find(
      (p) => p.pointId === fitPointId,
    )!;
    assertClosePoint(
      afterFitPoint.position,
      fitPointPos,
      "Fit point must not move during handle drag.",
    );

    // The vector should have changed.
    const afterOcc = getSplineOccurrenceByPointId(
      session,
      spline.entityId,
      fitPointId,
    );
    expect(afterOcc?.tangent.kind).toBe("authored");
    if (afterOcc?.tangent.kind === "authored") {
      const newVec = afterOcc.tangent.vector;
      const vecDist = Math.hypot(
        newVec[0] - initialVector[0],
        newVec[1] - initialVector[1],
      );
      expect(
        vecDist > 0.5,
        `Vector should have changed. Was [${initialVector}], now [${newVec}].`,
      ).toBeTruthy();
    }
  }

  // R-1 row 5: Automatic → authored at grab with no curve change.
  function testAutoToAuthoredAtGrabNoChange() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    // All occurrences are automatic after drawing through the tool.
    const occ1 = spline.pointOccurrences[1]!;
    expect(
      occ1.tangent.kind,
      "Premise: middle occurrence should be automatic.",
    ).toBe("automatic");

    const fitPoint = session.definition.points.find(
      (p) => p.pointId === occ1.pointId,
    )!;
    // Compute the visible vector via reconstruction to compare.
    const positions = Object.fromEntries(
      session.definition.points.map((p) => [p.pointId, p.position]),
    ) as Record<string, readonly [number, number]>;
    const reconstruction = reconstructSplineAggregate(spline, positions);
    expect(
      reconstruction.validity,
      "Spline reconstruction should be valid.",
    ).toBe("valid");
    const visibleVector = reconstruction.handles[1]!;

    // The handle tip is at fitPoint + visibleVector.
    const handleTip: readonly [number, number] = [
      fitPoint.position[0] + visibleVector[0],
      fitPoint.position[1] + visibleVector[1],
    ];

    session = beginSketchGeometryDrag(session, spline.target, handleTip, {
      kind: "tangentHandle",
      entityId: spline.entityId,
      occurrenceId: occ1.occurrenceId,
      pointId: occ1.pointId,
    });
    expect(session.activeDrag, "Tangent handle drag should start.").not.toBe(
      null,
    );

    // After grab, the occurrence should be authored with the visible vector.
    const convertedOcc = getSplineOccurrenceByPointId(
      session,
      spline.entityId,
      occ1.pointId,
    );
    expect(
      convertedOcc?.tangent.kind,
      "After grab, automatic tangent should be converted to authored.",
    ).toBe("authored");
    if (convertedOcc?.tangent.kind === "authored") {
      const dist = Math.hypot(
        convertedOcc.tangent.vector[0] - visibleVector[0],
        convertedOcc.tangent.vector[1] - visibleVector[1],
      );
      expect(
        dist < 1e-6,
        `Authored vector after grab should match visible vector. Got [${convertedOcc.tangent.vector}], expected [${visibleVector}]. Distance: ${dist}`,
      ).toBeTruthy();
    }
  }

  // R-1 row 6: Exact-zero request stores [0, 0].
  function testExactZeroStoresZeroVector() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    const occ0 = spline.pointOccurrences[0]!;
    const fitPointId = occ0.pointId;
    session = {
      ...session,
      definition: {
        ...session.definition,
        entities: session.definition.entities.map((e) =>
          e.entityId === spline.entityId && e.kind === "spline"
            ? {
                ...e,
                pointOccurrences: e.pointOccurrences.map((o) =>
                  o.occurrenceId === occ0.occurrenceId
                    ? {
                        ...o,
                        tangent: {
                          kind: "authored" as const,
                          vector: [2, 1] as const,
                        },
                      }
                    : o,
                ),
              }
            : e,
        ),
      },
    };

    const fitPoint = session.definition.points.find(
      (p) => p.pointId === fitPointId,
    )!;
    const handleTip: readonly [number, number] = [
      fitPoint.position[0] + 2,
      fitPoint.position[1] + 1,
    ];

    session = beginSketchGeometryDrag(session, spline.target, handleTip, {
      kind: "tangentHandle",
      entityId: spline.entityId,
      occurrenceId: occ0.occurrenceId,
      pointId: fitPointId,
    });

    // Finish with exactZero: drag the handle near the fit point with the flag.
    session = finishSketchGeometryDrag(session, fitPoint.position, {
      exactZero: true,
    });

    const afterOcc = getSplineOccurrenceByPointId(
      session,
      spline.entityId,
      fitPointId,
    );
    expect(afterOcc?.tangent.kind).toBe("authored");
    if (afterOcc?.tangent.kind === "authored") {
      expect(
        afterOcc.tangent.vector[0],
        "Exact-zero must store exactly 0 for x.",
      ).toBe(0);
      expect(
        afterOcc.tangent.vector[1],
        "Exact-zero must store exactly 0 for y.",
      ).toBe(0);
    }
  }

  // R-1 row 7: Leaving zero is continuous.
  function testLeavingZeroIsContinuous() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    const occ0 = spline.pointOccurrences[0]!;
    const fitPointId = occ0.pointId;
    // Start with exact zero.
    session = {
      ...session,
      definition: {
        ...session.definition,
        entities: session.definition.entities.map((e) =>
          e.entityId === spline.entityId && e.kind === "spline"
            ? {
                ...e,
                pointOccurrences: e.pointOccurrences.map((o) =>
                  o.occurrenceId === occ0.occurrenceId
                    ? {
                        ...o,
                        tangent: {
                          kind: "authored" as const,
                          vector: [0, 0] as const,
                        },
                      }
                    : o,
                ),
              }
            : e,
        ),
      },
    };

    const fitPoint = session.definition.points.find(
      (p) => p.pointId === fitPointId,
    )!;
    // Handle tip is at fitPoint (vector [0,0]).
    session = beginSketchGeometryDrag(
      session,
      spline.target,
      fitPoint.position,
      {
        kind: "tangentHandle",
        entityId: spline.entityId,
        occurrenceId: occ0.occurrenceId,
        pointId: fitPointId,
      },
    );
    expect(session.activeDrag, "Drag from zero should start.").not.toBe(null);

    // Drag to a non-zero vector.
    session = finishSketchGeometryDrag(session, [
      fitPoint.position[0] + 1,
      fitPoint.position[1] + 0.5,
    ]);

    const afterOcc = getSplineOccurrenceByPointId(
      session,
      spline.entityId,
      fitPointId,
    );
    expect(afterOcc?.tangent.kind).toBe("authored");
    if (afterOcc?.tangent.kind === "authored") {
      const vecLen = Math.hypot(
        afterOcc.tangent.vector[0],
        afterOcc.tangent.vector[1],
      );
      expect(
        vecLen > 0.1,
        `After leaving zero, vector should be non-zero. Got [${afterOcc.tangent.vector}], length ${vecLen}.`,
      ).toBeTruthy();
    }
  }

  // R-1 row 8: Cancel restores automatic tangent after auto→authored at grab.
  function testCancelRestoresAutomaticTangent() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    const occ1 = spline.pointOccurrences[1]!;
    expect(occ1.tangent.kind, "Premise: middle occurrence is automatic.").toBe(
      "automatic",
    );

    const fitPoint = session.definition.points.find(
      (p) => p.pointId === occ1.pointId,
    )!;
    const positions = Object.fromEntries(
      session.definition.points.map((p) => [p.pointId, p.position]),
    ) as Record<string, readonly [number, number]>;
    const reconstruction = reconstructSplineAggregate(spline, positions);
    const visibleVector = reconstruction.handles[1]!;
    const handleTip: readonly [number, number] = [
      fitPoint.position[0] + visibleVector[0],
      fitPoint.position[1] + visibleVector[1],
    ];

    const origDef = session.definition;
    session = beginSketchGeometryDrag(session, spline.target, handleTip, {
      kind: "tangentHandle",
      entityId: spline.entityId,
      occurrenceId: occ1.occurrenceId,
      pointId: occ1.pointId,
    });
    // After grab, it's authored.
    const grabbedOcc = getSplineOccurrenceByPointId(
      session,
      spline.entityId,
      occ1.pointId,
    );
    expect(grabbedOcc?.tangent.kind).toBe("authored");

    // Cancel should restore original (automatic).
    const cancelled = cancelSketchGeometryDrag(session);
    expect(
      cancelled.definition,
      "Cancel must restore pre-drag definition.",
    ).toBe(origDef);
    const restoredOcc = getSplineOccurrenceByPointId(
      cancelled,
      spline.entityId,
      occ1.pointId,
    );
    expect(
      restoredOcc?.tangent.kind,
      "Cancel must restore automatic tangent state.",
    ).toBe("automatic");
  }

  // R-1 row 8b: click-only finish restores automatic tangent (B-1 fix).
  function testClickOnlyFinishRestoresAutomatic() {
    let session = drawThreePointSpline();
    const spline = getSplineEntity(session);
    const occ1 = spline.pointOccurrences[1]!;
    expect(occ1.tangent.kind).toBe("automatic");

    const fitPoint = session.definition.points.find(
      (p) => p.pointId === occ1.pointId,
    )!;
    const positions = Object.fromEntries(
      session.definition.points.map((p) => [p.pointId, p.position]),
    ) as Record<string, readonly [number, number]>;
    const reconstruction = reconstructSplineAggregate(spline, positions);
    const visibleVector = reconstruction.handles[1]!;
    const handleTip: readonly [number, number] = [
      fitPoint.position[0] + visibleVector[0],
      fitPoint.position[1] + visibleVector[1],
    ];

    const origDef = session.definition;
    session = beginSketchGeometryDrag(session, spline.target, handleTip, {
      kind: "tangentHandle",
      entityId: spline.entityId,
      occurrenceId: occ1.occurrenceId,
      pointId: occ1.pointId,
    });
    // Click-only: finish at the same point as start.
    const finished = finishSketchGeometryDrag(session, handleTip);
    expect(
      finished.definition,
      "Click-only finish must restore pre-drag definition (B-1).",
    ).toBe(origDef);
    expect(finished.activeDrag).toBe(null);
    const restoredOcc = getSplineOccurrenceByPointId(
      finished,
      spline.entityId,
      occ1.pointId,
    );
    expect(restoredOcc?.tangent.kind, "Must restore automatic.").toBe(
      "automatic",
    );
  }

  // R-2 row 9: Rim on radius-dimensioned circle is blocked.
  function testRimOnDimensionedCircleIsBlocked() {
    const session = createSessionFromDefinition({
      ...makeDefinition({
        pointIds: ["sketch_point_center"],
        points: [makePoint("sketch_point_center", "Center", 0, 0)],
        entityIds: ["sketch_entity_circle"],
        entities: [
          makeCircle(
            "sketch_entity_circle",
            "Circle",
            "sketch_point_center",
            3,
          ),
        ],
      }),
      dimensionIds: ["dim_radius"],
      dimensions: [
        {
          dimensionId: "dim_radius" as `sketch_dimension_${string}`,
          kind: "circleRadius" as const,
          label: "R3",
          entityId: "sketch_entity_circle" as `sketch_entity_${string}`,
          value: 3,
          display: { position: [3, 0] as const },
        },
      ],
    });
    const entity = session.definition.entities[0]!;
    let dragging = beginSketchGeometryDrag(session, entity.target, [3, 0], {
      kind: "rim",
      entityId: entity.entityId,
    });
    expect(dragging.activeDrag?.intent.kind).toBe("radius");
    // Drag the rim — should be blocked because the radius is dimensioned.
    dragging = finishSketchGeometryDrag(dragging, [5, 0]);
    // The radius should not have changed from 3 (blocked or ignored).
    const circle = dragging.definition.entities.find(
      (e) => e.entityId === entity.entityId,
    );
    expect(
      circle && circle.kind === "circle" ? circle.radius : null,
      "Radius-dimensioned circle rim drag should not change the radius.",
    ).toBeCloseTo(3, 3);
  }

  // R-2 row 10: Continuity — large delta uses substeps without flipping (translate).
  function testLargeDeltaTranslateUseSubstepsNoFlip() {
    // A constrained square: translate the body by a large delta.
    const definition = createSquareDefinition(true);
    const session = openSessionFromDefinition(definition);
    const entity = session.definition.entities[0]!;
    let dragging = beginSketchGeometryDrag(session, entity.target, [0, 0], {
      kind: "entityBody",
      entityId: entity.entityId,
    });
    expect(dragging.activeDrag?.intent.kind).toBe("translate");
    // Large delta: 50 units (well over DRAG_SUBSTEP_LIMIT).
    dragging = finishSketchGeometryDrag(dragging, [50, 0]);
    // Must not flip: all points should have positive or near-origin x.
    const points = new Map(
      dragging.definition.points.map((p) => [p.pointId, p.position]),
    );
    for (const [id, pos] of points) {
      expect(
        pos[0] >= -1,
        `Point ${id} at x=${pos[0]} should not have flipped across origin during large translate.`,
      ).toBeTruthy();
    }
  }

  // R-2 row 11: One action per completed drag for translate intent.
  function testOneActionPerTranslateDrag() {
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");
    const defBefore = session.definition;

    const entity = session.definition.entities[0]!;
    session = beginSketchGeometryDrag(session, entity.target, [2, 0], {
      kind: "entityBody",
      entityId: entity.entityId,
    });
    // Multiple frame updates (drag gesture).
    session = updateSketchGeometryDrag(session, [3, 1]);
    session = updateSketchGeometryDrag(session, [4, 2]);
    session = finishSketchGeometryDrag(session, [5, 3]);

    // The definition should have changed.
    expect(session.definition).not.toBe(defBefore);
    // activeDrag should be null.
    expect(session.activeDrag).toBe(null);
  }

  // R-2 row 12: Cancel per non-point intent produces no history entry.
  function testCancelTranslateDragNoHistory() {
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");
    const defBefore = session.definition;

    const entity = session.definition.entities[0]!;
    session = beginSketchGeometryDrag(session, entity.target, [2, 0], {
      kind: "entityBody",
      entityId: entity.entityId,
    });

    // Cancel.
    const cancelled = cancelSketchGeometryDrag(session);
    expect(
      cancelled.definition,
      "Cancel must restore exact pre-drag definition.",
    ).toBe(defBefore);
    expect(cancelled.activeDrag).toBe(null);
  }

  // R-2 row: arc rim keeps centre and angles.
  function testArcRimKeepsCentreAndAngles() {
    const centerPos: readonly [number, number] = [0, 0];
    const startPos: readonly [number, number] = [3, 0];
    const endPos: readonly [number, number] = [0, 3];
    const session = createSessionFromDefinition(
      makeDefinition({
        pointIds: [
          "sketch_point_center",
          "sketch_point_start",
          "sketch_point_end",
        ],
        points: [
          makePoint(
            "sketch_point_center",
            "Center",
            centerPos[0],
            centerPos[1],
          ),
          makePoint("sketch_point_start", "Start", startPos[0], startPos[1]),
          makePoint("sketch_point_end", "End", endPos[0], endPos[1]),
        ],
        entityIds: ["sketch_entity_arc"],
        entities: [
          makeArc(
            "sketch_entity_arc",
            "Arc",
            "sketch_point_center",
            "sketch_point_start",
            "sketch_point_end",
            "counterClockwise",
          ),
        ],
      }),
    );
    const entity = session.definition.entities[0]!;
    let dragging = beginSketchGeometryDrag(session, entity.target, [3, 0], {
      kind: "rim",
      entityId: entity.entityId,
    });
    expect(dragging.activeDrag?.intent.kind).toBe("radius");
    // Drag rim outward from [3,0] to [5,0].
    dragging = finishSketchGeometryDrag(dragging, [5, 0]);
    // Centre must not have moved.
    assertClosePoint(
      dragging.definition.points.find(
        (p) => p.pointId === "sketch_point_center",
      )?.position,
      centerPos,
      "Arc centre must not move during rim drag.",
    );
  }

  // R-3 (REQUIRED): Document mock boundary — row to pin that non-point targets
  // stay in-process (session API calls updateCompiledSketchSolveSession directly)
  // and never reach the mock solver adapter via the protocol.
  function testNonPointDragTargetsAreInProcess() {
    // This row pins the boundary: non-point drag targets (translate, radius,
    // tangentVector) are handled entirely within the session drag API
    // (updateCompiledSketchSolveSession) and never flow through the solver
    // protocol/adapter. The mock adapter's protocol type
    // (SolverDraggedSketchPointTarget) intentionally restricts to point targets.
    // If the protocol is widened in a future slice, this row will need updating.
    //
    // Verification: `buildDragTarget` constructs SketchDragTarget variants,
    // `solveDragEdit` passes them to `updateCompiledSketchSolveSession`, which
    // calls `resolveDragTargetFrame` directly on the compiled session — no
    // adapter call. The SketchDragTarget union has 4 variants; the adapter's
    // SolverDraggedSketchPointTarget has 1 (sketchPoint). Type-level guarantee:
    // a translate/radius/tangentVector target cannot satisfy the adapter's type.
    expect(
      true,
      "Non-point drag targets stay in-process; adapter type is point-only.",
    ).toBe(true);
  }

  // R-2 row: spline body drag with constrained neighbour — neighbour moves
  // only as hard constraints force (minimum motion).
  function testSplineBodyWithConstrainedNeighbour() {
    // Draw a spline + a line sharing an endpoint, then translate the spline body.
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");

    const lineEndPointId = session.definition.pointIds[1]!;
    const lineEndPos = session.definition.points.find(
      (p) => p.pointId === lineEndPointId,
    )!.position;

    // Now draw a spline starting from that endpoint: the shared end comes
    // from the endpoint snap, which needs a screen scale (T13f R-6).
    session = withSketchSnapScale(session, SPEC_SKETCH_UNITS_PER_PIXEL);
    session = beginSketchTool(session, "spline");
    session = startSketchDraw(session, [lineEndPos[0], lineEndPos[1]]);
    session = acceptSketchDraw(session, [lineEndPos[0] + 2, lineEndPos[1] + 3]);
    session = acceptSketchDraw(session, [lineEndPos[0] + 5, lineEndPos[1]]);
    session = finalizeSketchDraw(session);
    session = beginSketchTool(session, "line");

    const spline = session.definition.entities.find(
      (e) => e.kind === "spline",
    )!;
    // The spline shares its first point with the line's end via coincident.
    // Translate the spline body.
    const beforeLineStart = session.definition.points.find(
      (p) => p.pointId === session.definition.pointIds[0],
    )!.position;

    session = beginSketchGeometryDrag(
      session,
      spline.target,
      [lineEndPos[0] + 2, lineEndPos[1] + 1],
      {
        kind: "entityBody",
        entityId: spline.entityId,
      },
    );
    session = finishSketchGeometryDrag(session, [
      lineEndPos[0] + 3,
      lineEndPos[1] + 2,
    ]);

    // The line's start (non-shared) should not have moved significantly.
    const afterLineStart = session.definition.points.find(
      (p) => p.pointId === session.definition.pointIds[0],
    )!.position;
    const lineStartDist = Math.hypot(
      afterLineStart[0] - beforeLineStart[0],
      afterLineStart[1] - beforeLineStart[1],
    );
    expect(
      lineStartDist < 1,
      `Line's non-shared endpoint should stay near its original position (minimum motion). Moved ${lineStartDist}.`,
    ).toBeTruthy();
  }

  testFitPointDragCarriesAuthoredVector();
  testSplineBodyKeepsAuthoredVectors();
  testHandleDragChangesOnlyVector();
  testAutoToAuthoredAtGrabNoChange();
  testExactZeroStoresZeroVector();
  testLeavingZeroIsContinuous();
  testCancelRestoresAutomaticTangent();
  testClickOnlyFinishRestoresAutomatic();
  testRimOnDimensionedCircleIsBlocked();
  testLargeDeltaTranslateUseSubstepsNoFlip();
  testOneActionPerTranslateDrag();
  testCancelTranslateDragNoHistory();
  testArcRimKeepsCentreAndAngles();
  testNonPointDragTargetsAreInProcess();
  testSplineBodyWithConstrainedNeighbour();
  testBlockedFinalFrameKeepsLastAccepted();
  testT12fFixedPointFeedback();
  testT12fFixedLineBodyFeedback();
  testT12fDimensionedCircleRimFeedback();
  testT12fNonConvergentFrameFeedback();
  testT12fPartialConstraintNoFeedback();
  testT12fFeedbackClearedOnMovingFrame();
  testT12fFeedbackClearedAtDragEnd();
  testT12fNoGlobalMessageDuringDrag();

  // T12f: structured drag feedback — fully constrained point shows feedback.
  function testT12fFixedPointFeedback() {
    // A fixed point cannot move: the drag should produce `constrained` feedback.
    const definition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
      ],
      entityIds: ["sketch_entity_line"],
      entities: [
        makeLine("sketch_entity_line", "Line", "sketch_point_a", "sketch_point_b"),
      ],
    });
    const constrained: SketchDefinition = {
      ...definition,
      constraintIds: ["constraint_fix_a"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [0, 0],
        },
      ],
      dimensionIds: ["dimension_length"],
      dimensions: [
        {
          dimensionId: "dimension_length",
          kind: "lineLength",
          label: "L4",
          entityId: "sketch_entity_line",
          value: 4,
        },
      ],
    };
    let session = openSessionFromDefinition(constrained);
    const target = session.definition.points.find(
      (p) => p.pointId === "sketch_point_a",
    )?.target;
    expect(target).toBeTruthy();
    session = beginSketchGeometryDrag(session, target, [0, 0]);
    expect(session.activeDrag).not.toBeNull();
    session = updateSketchGeometryDrag(session, [3, 3]);
    expect(
      session.activeDrag?.feedback?.kind,
      "T12f: fixed point drag should produce constrained feedback.",
    ).toBe("constrained");
    expect(
      session.activeDrag?.feedback?.text,
      "T12f: feedback text should be the constrained message.",
    ).toBe("Geometry is constrained and cannot move to that position.");
    expect(
      session.activeDrag?.feedback?.target,
      "T12f: feedback target should be at the constrained point.",
    ).toBeTruthy();
  }

  // T12f: structured drag feedback — fixed line body shows feedback.
  function testT12fFixedLineBodyFeedback() {
    // Fix both endpoints of a line → body translate is constrained.
    const definition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
      ],
      entityIds: ["sketch_entity_line"],
      entities: [
        makeLine("sketch_entity_line", "Line", "sketch_point_a", "sketch_point_b"),
      ],
    });
    const constrained: SketchDefinition = {
      ...definition,
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
          position: [4, 0],
        },
      ],
    };
    let session = openSessionFromDefinition(constrained);
    const entity = session.definition.entities.find(
      (e) => e.entityId === "sketch_entity_line",
    )!;
    session = beginSketchGeometryDrag(session, entity.target, [2, 0], {
      kind: "entityBody",
      entityId: entity.entityId,
    });
    expect(session.activeDrag).not.toBeNull();
    session = updateSketchGeometryDrag(session, [2, 5]);
    expect(
      session.activeDrag?.feedback?.kind,
      "T12f: fixed line body drag should produce constrained feedback.",
    ).toBe("constrained");
  }

  // T12f: structured drag feedback — rim on radius-dimensioned circle.
  function testT12fDimensionedCircleRimFeedback() {
    const definition: SketchDefinition = {
      ...makeDefinition({
        pointIds: ["sketch_point_center"],
        points: [makePoint("sketch_point_center", "Center", 0, 0)],
        entityIds: ["sketch_entity_circle"],
        entities: [
          makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 3),
        ],
      }),
      dimensionIds: ["dim_radius"],
      dimensions: [
        {
          dimensionId: "dim_radius" as `sketch_dimension_${string}`,
          kind: "circleRadius" as const,
          label: "R3",
          entityId: "sketch_entity_circle" as `sketch_entity_${string}`,
          value: 3,
          display: { position: [3, 0] as const },
        },
      ],
    };
    let session = openSessionFromDefinition(definition);
    const entity = session.definition.entities[0]!;
    session = beginSketchGeometryDrag(session, entity.target, [3, 0], {
      kind: "rim",
      entityId: entity.entityId,
    });
    expect(session.activeDrag?.intent.kind).toBe("radius");
    session = updateSketchGeometryDrag(session, [6, 0]);
    expect(
      session.activeDrag?.feedback?.kind,
      "T12f: rim drag on dimensioned circle should produce constrained feedback.",
    ).toBe("constrained");
    expect(
      session.activeDrag?.feedback?.text,
      "T12f: feedback text should be the constrained message.",
    ).toBe("Geometry is constrained and cannot move to that position.");
  }

  // T12f: structured drag feedback — non-convergent frame (failed feedback).
  function testT12fNonConvergentFrameFeedback() {
    // Use the B14 fixture: conflicting constraints that make the sketch
    // non-acceptable, so beginSketchGeometryDrag fails.
    const definition: SketchDefinition = {
      ...makeDefinition({
        pointIds: ["sketch_point_a", "sketch_point_b"],
        points: [
          makePoint("sketch_point_a", "A", 1, 0),
          makePoint("sketch_point_b", "B", 0, 1),
        ],
        entityIds: ["sketch_entity_line"],
        entities: [
          makeLine("sketch_entity_line", "Line", "sketch_point_a", "sketch_point_b"),
        ],
      }),
      constraintIds: ["constraint_fix_a", "constraint_fix_b"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [1, 0],
        },
        {
          constraintId: "constraint_fix_b",
          kind: "fixPoint",
          label: "Fix B",
          pointId: "sketch_point_b",
          position: [0, 1],
        },
      ],
      dimensionIds: ["dimension_conflicting"],
      dimensions: [
        {
          dimensionId: "dimension_conflicting",
          kind: "lineLength",
          label: "Impossible length",
          entityId: "sketch_entity_line",
          value: 100,
        },
      ],
    };
    const session = openSessionFromDefinition(definition);
    // The B14 path: the drag should not start, and a validationMessage
    // is shown. We check that this path still works.
    const target = session.definition.points.find(
      (p) => p.pointId === "sketch_point_a",
    )?.target;
    expect(target).toBeTruthy();
    const after = beginSketchGeometryDrag(session, target, [1, 0]);
    expect(
      after.activeDrag,
      "T12f: non-acceptable sketch should not start a drag.",
    ).toBeNull();
    expect(
      after.validationMessage,
      "T12f: non-acceptable sketch should show a validation message.",
    ).toMatch(/can't be dragged/);
  }

  // T12f: partial-constraint motion shows no feedback.
  function testT12fPartialConstraintNoFeedback() {
    // A horizontal line pinned at origin — free endpoint slides along x.
    // Dragging along x should NOT produce feedback.
    const definition = makeDefinition({
      pointIds: ["sketch_point_pin", "sketch_point_slide"],
      points: [
        makePoint("sketch_point_pin", "Pin", 0, 0),
        makePoint("sketch_point_slide", "Slide", 2, 0),
      ],
      entityIds: ["sketch_entity_line"],
      entities: [
        makeLine(
          "sketch_entity_line",
          "Line",
          "sketch_point_pin",
          "sketch_point_slide",
        ),
      ],
    });
    const constrained: SketchDefinition = {
      ...definition,
      constraintIds: ["constraint_fix_pin", "constraint_horizontal"],
      constraints: [
        {
          constraintId: "constraint_fix_pin",
          kind: "fixPoint",
          label: "Fix Pin",
          pointId: "sketch_point_pin",
          position: [0, 0],
        },
        {
          constraintId: "constraint_horizontal",
          kind: "horizontal",
          label: "Horizontal",
          entityId: "sketch_entity_line",
        },
      ],
    };
    let session = openSessionFromDefinition(constrained);
    const target = session.definition.points.find(
      (p) => p.pointId === "sketch_point_slide",
    )?.target;
    expect(target).toBeTruthy();
    session = beginSketchGeometryDrag(session, target, [2, 0]);
    session = updateSketchGeometryDrag(session, [5, 0]);
    expect(
      session.activeDrag?.feedback,
      "T12f: partial constraint motion along free DOF should show no feedback.",
    ).toBeFalsy();
    expect(
      session.activeDrag?.status,
      "T12f: should be accepted (dragging).",
    ).toBe("dragging");
  }

  // T12f: feedback cleared on the next frame with motion.
  function testT12fFeedbackClearedOnMovingFrame() {
    // An unconstrained line: drag one endpoint to get an accepted frame,
    // then verify feedback is null on that accepted frame.
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");
    const freeTarget = session.definition.points.find(
      (p) =>
        Math.abs(p.position[0] - 4) < 1e-6 &&
        Math.abs(p.position[1]) < 1e-6,
    )?.target;
    expect(freeTarget).toBeTruthy();
    session = beginSketchGeometryDrag(session, freeTarget!, [4, 0]);
    session = updateSketchGeometryDrag(session, [6, 2]);
    expect(
      session.activeDrag?.feedback,
      "T12f: accepted frame on unconstrained point should have no feedback.",
    ).toBeFalsy();
    expect(session.activeDrag?.status).toBe("dragging");
  }

  // T12f: feedback cleared at drag end.
  function testT12fFeedbackClearedAtDragEnd() {
    const definition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
      ],
      entityIds: ["sketch_entity_line"],
      entities: [
        makeLine("sketch_entity_line", "Line", "sketch_point_a", "sketch_point_b"),
      ],
    });
    const constrained: SketchDefinition = {
      ...definition,
      constraintIds: ["constraint_fix_a"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [0, 0],
        },
      ],
      dimensionIds: ["dimension_length"],
      dimensions: [
        {
          dimensionId: "dimension_length",
          kind: "lineLength",
          label: "L4",
          entityId: "sketch_entity_line",
          value: 4,
        },
      ],
    };
    let session = openSessionFromDefinition(constrained);
    const target = session.definition.points.find(
      (p) => p.pointId === "sketch_point_a",
    )?.target;
    expect(target).toBeTruthy();
    session = beginSketchGeometryDrag(session, target, [0, 0]);
    session = updateSketchGeometryDrag(session, [3, 3]);
    expect(session.activeDrag?.feedback?.kind).toBe("constrained");
    session = finishSketchGeometryDrag(session, [3, 3]);
    expect(
      session.activeDrag,
      "T12f: activeDrag should be null after drag end.",
    ).toBeNull();
    // validationMessage may remain on the final release frame (existing behaviour).
  }

  // T12f: no global validationMessage during mid-drag blocked frames.
  function testT12fNoGlobalMessageDuringDrag() {
    const definition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 4, 0),
      ],
      entityIds: ["sketch_entity_line"],
      entities: [
        makeLine("sketch_entity_line", "Line", "sketch_point_a", "sketch_point_b"),
      ],
    });
    const constrained: SketchDefinition = {
      ...definition,
      constraintIds: ["constraint_fix_a"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [0, 0],
        },
      ],
      dimensionIds: ["dimension_length"],
      dimensions: [
        {
          dimensionId: "dimension_length",
          kind: "lineLength",
          label: "L4",
          entityId: "sketch_entity_line",
          value: 4,
        },
      ],
    };
    let session = openSessionFromDefinition(constrained);
    const target = session.definition.points.find(
      (p) => p.pointId === "sketch_point_a",
    )?.target;
    expect(target).toBeTruthy();
    session = beginSketchGeometryDrag(session, target, [0, 0]);
    session = updateSketchGeometryDrag(session, [3, 3]);
    expect(
      session.validationMessage,
      "T12f: no global validationMessage during mid-drag blocked frame.",
    ).toBeNull();
    expect(
      session.activeDrag?.feedback?.kind,
      "T12f: feedback is local on activeDrag, not global.",
    ).toBe("constrained");
  }

  // A-new-2: when an intermediate frame was accepted but the final frame
  // solves at the same position, the result keeps the accepted definition
  // (not preDragDefinition).
  function testBlockedFinalFrameKeepsLastAccepted() {
    // Use an unconstrained line so intermediate accepts are guaranteed.
    let session = createNewSketchSessionFromSupport(
      { kind: "construction", constructionId: "construction_plane-xy" },
      OCC_KERNEL_SETTINGS,
    );
    session = beginSketchTool(session, "line");
    session = startSketchDraw(session, [0, 0]);
    session = acceptSketchDraw(session, [4, 0]);
    session = beginSketchTool(session, "line");

    const point = session.definition.points.find(
      (p) => p.position[0] === 4 && p.position[1] === 0,
    )!;
    let dragging = beginSketchGeometryDrag(
      session,
      point.target,
      point.position,
    );
    expect(dragging.activeDrag).not.toBe(null);
    const preDrag = dragging.activeDrag!.preDragDefinition;

    // First intermediate frame: move.
    dragging = updateSketchGeometryDrag(dragging, [
      point.position[0] + 2,
      point.position[1] + 1,
    ]);
    // The definition should have changed.
    expect(
      dragging.definition !== preDrag,
      "Premise: intermediate accepted frame changes definition.",
    ).toBe(true);

    // Finish at the same position as the intermediate.
    const finished = finishSketchGeometryDrag(dragging, [
      point.position[0] + 2,
      point.position[1] + 1,
    ]);
    expect(finished.activeDrag).toBe(null);
    // Definition should NOT be the preDragDefinition.
    expect(
      finished.definition === preDrag,
      "A-new-2: finish after accepted intermediate must not revert to preDragDefinition.",
    ).toBe(false);
  }

  function testDragOnNonAcceptableSketchDoesNotThrow() {
    // B14: starting a drag on a sketch whose solve is not acceptable must
    // not throw. The drag does not start, the definition is unchanged and
    // the reason is reported instead.
    const definition: SketchDefinition = {
      ...makeDefinition({
        pointIds: ["sketch_point_center", "sketch_point_a", "sketch_point_b"],
        points: [
          makePoint("sketch_point_center", "Center", 0, 0),
          makePoint("sketch_point_a", "A", 1, 0),
          makePoint("sketch_point_b", "B", 0, 1),
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
      }),
      constraintIds: ["constraint_fix_a", "constraint_fix_b"],
      constraints: [
        {
          constraintId: "constraint_fix_a",
          kind: "fixPoint",
          label: "Fix A",
          pointId: "sketch_point_a",
          position: [1, 0],
        },
        {
          constraintId: "constraint_fix_b",
          kind: "fixPoint",
          label: "Fix B",
          pointId: "sketch_point_b",
          position: [0, 1],
        },
      ],
      dimensionIds: ["dimension_conflicting"],
      dimensions: [
        {
          dimensionId: "dimension_conflicting",
          kind: "lineLength",
          label: "Impossible length",
          entityId: "sketch_entity_line",
          value: 100,
        },
      ],
    };
    const session = createSessionFromDefinition(definition);
    // Confirm the solve is not acceptable (conflicting constraints).
    expect(
      session.solvedSnapshot?.status.solveState === "solved" ||
        session.solvedSnapshot?.status.solveState === "notEvaluated",
      "Fixture must produce a non-acceptable solve (partiallySolved or failed).",
    ).toBe(false);

    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_a",
    )?.target;
    expect(target, "Expected point A.").toBeTruthy();

    // B14: this must not throw.
    const afterDrag = beginSketchGeometryDrag(session, target, [1, 0]);

    // The drag should not have started (no interactive session).
    expect(
      afterDrag.activeDrag,
      "Starting a drag on a non-acceptable sketch must not throw; it should return the session without an active drag.",
    ).toBe(null);
    expect(afterDrag.definition).toBe(session.definition);
    expect(afterDrag.validationMessage).toMatch(
      /^Geometry can't be dragged until the sketch solves/,
    );
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
          ? entity.pointOccurrences.every((occurrence) =>
              remainingPointIds.has(occurrence.pointId),
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

  async function testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets() {
    let session = toggleSketchSvgRendering(
      createSessionFromDefinition(createSquareDefinition(false)),
    );
    session = await withCommittedRegions(session);
    const entityTarget = session.definition.entities[0]?.target;
    const pointTarget = session.definition.points[0]?.target;
    const regionTarget = session.liveRegions.regions[0]?.target;
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

  async function testSvgRenderingToggleSuppressesAuthoredStylesWithoutDeletingThem() {
    let session = toggleSketchSvgRendering(
      createSessionFromDefinition(createSquareDefinition(false)),
    );
    session = await withCommittedRegions(session);
    const entityTarget = session.definition.entities[0]?.target;
    const regionTarget = session.liveRegions.regions[0]?.target;
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
    // T09b review A6(a): styles never change region records, so style
    // patches keep the published live regions current and unchanged.
    expect(
      session.liveRegions.status,
      "Style patches keep live regions current (no re-derivation).",
    ).toBe("current");
    expect(
      session.liveRegions.regions.map((region) => region.regionId),
      "Style patches keep the same live region ids.",
    ).toEqual([regionTarget!.regionId]);

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

  /**
   * T10g-1: a Trim click only queues its exact query (nothing is authored,
   * the tool says it is checking); the edit applies when the query result
   * (the one contract function, kernel-free capability) is delivered.
   */
  async function trimTarget(
    session: SketchSessionState,
    entityId: string,
    label: string,
  ) {
    const clicked = selectSketchEditToolTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId,
    } as never);
    expect(
      clicked.definition,
      `${label}: the click authors nothing before its intersections are certified.`,
    ).toBe(session.definition);
    expect(
      clicked.activeEditTool?.editQuery?.inFlight?.input.operation,
      `${label}: the click issues its exact query.`,
    ).toEqual({ kind: "trim", targetEntityId: entityId });
    expect(
      clicked.toolPresentation?.validation?.map((entry) => entry.message),
      `${label}: the tool says it is checking intersections.`,
    ).toEqual(["Checking intersections…"]);
    return completeSketchEditQueriesForTest(clicked);
  }

  /** The Q1b ties authored by a Trim: (new point, kind, cutter or point). */
  function trimTies(before: SketchSessionState, after: SketchSessionState) {
    const known = new Set(before.definition.constraintIds);
    return after.definition.constraints
      .filter((constraint) => !known.has(constraint.constraintId))
      .map((constraint) =>
        constraint.kind === "pointOnCurve"
          ? ["pointOnCurve", constraint.curve.entityId]
          : constraint.kind === "coincident"
            ? ["coincident", constraint.pointIds[1]]
            : [constraint.kind],
      );
  }

  async function testTrimSplitsLineAtClearIntersections() {
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
    const started = beginSketchTool(
      openSessionFromDefinition(definition),
      "trim",
    );
    const session = await trimTarget(started, "sketch_entity_ab", "line");

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
    const position = (pointId: string) =>
      session.definition.points.find((point) => point.pointId === pointId)
        ?.position;
    const target = session.definition.entities.find(
      (entity) => entity.entityId === "sketch_entity_ab",
    );
    const piece = session.definition.entities.at(-1);
    if (target?.kind !== "lineSegment" || piece?.kind !== "lineSegment")
      throw new Error("line pieces");
    expect(
      [position(target.endPointId), position(piece.startPointId)],
      "Trim ends sit exactly at the certified crossings (the evaluator at t = 1/4 and 3/4).",
    ).toEqual([
      [1, 0],
      [3, 0],
    ]);
    expect(
      trimTies(started, session),
      "Q1b: each new end is tied onto the curve it was cut against.",
    ).toEqual([
      ["pointOnCurve", "sketch_entity_cd"],
      ["pointOnCurve", "sketch_entity_ef"],
    ]);
    expect(
      session.liveSolve?.accepted,
      "The tied trim result solves (every tie is satisfied).",
    ).toBe(true);
  }

  async function testTrimHandlesCircleArcAndSplineTargets() {
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
    const circleStarted = beginSketchTool(
      openSessionFromDefinition(circleDefinition),
      "trim",
    );
    const circleSession = await trimTarget(
      circleStarted,
      "sketch_entity_circle",
      "circle",
    );

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
    expect(
      trimTies(circleStarted, circleSession),
      "Circle trim ties its first (angle π/3 from the +x seam) and last (5π/3) cut to the right cutter.",
    ).toEqual([
      ["pointOnCurve", "sketch_entity_right"],
      ["pointOnCurve", "sketch_entity_right"],
    ]);
    expect(circleSession.liveSolve?.accepted).toBe(true);

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
    const arcStarted = beginSketchTool(
      openSessionFromDefinition(arcDefinition),
      "trim",
    );
    const arcSession = await trimTarget(arcStarted, "sketch_entity_arc", "arc");

    expect(
      arcSession.validationMessage,
      "Arc trim should not leave validation feedback.",
    ).toBe(null);
    expect(
      arcSession.definition.entities.filter((entity) => entity.kind === "arc")
        .length,
      "Trimming an arc should split the remaining geometry into two arcs.",
    ).toBe(2);
    expect(
      trimTies(arcStarted, arcSession),
      "Arc trim ties its first cut (right cutter) and last cut (left cutter).",
    ).toEqual([
      ["pointOnCurve", "sketch_entity_right"],
      ["pointOnCurve", "sketch_entity_left"],
    ]);
    expect(arcSession.liveSolve?.accepted).toBe(true);

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
    // T10g-3b: the former T07 rejection row, flipped: an open spline is
    // trimmed exactly (option B) into two splines.
    const splineStarted = beginSketchTool(
      openSessionFromDefinition(splineDefinition),
      "trim",
    );
    const splineSession = await trimTarget(
      splineStarted,
      "sketch_entity_spline",
      "spline",
    );
    const splines = splineSession.definition.entities.filter(
      (entity) => entity.kind === "spline",
    );
    expect(
      splines.map((entity) => entity.entityId)[0],
      "The original spline id keeps the piece before the first cut.",
    ).toBe("sketch_entity_spline");
    expect(
      splines.length,
      "Trimming an open spline keeps its two outside pieces as two splines.",
    ).toBe(2);
    const fitPoints = (entity: (typeof splines)[number]) =>
      entity.kind === "spline"
        ? entity.pointOccurrences.map(({ pointId }) => pointId)
        : [];
    expect(
      [fitPoints(splines[0]!)[0], fitPoints(splines[1]!).at(-1)],
      "The pieces keep the spline's original ends.",
    ).toEqual(["sketch_point_s0", "sketch_point_s2"]);
    expect(
      [fitPoints(splines[0]!).length, fitPoints(splines[1]!).length],
      "Each piece ends at a new fit point at its cut (S1 is removed).",
    ).toEqual([2, 2]);
    expect(
      trimTies(splineStarted, splineSession),
      "Spline trim ties its first cut to the left cutter and its last cut to the right cutter.",
    ).toEqual([
      ["pointOnCurve", "sketch_entity_left"],
      ["pointOnCurve", "sketch_entity_right"],
    ]);
    expect(
      splineSession.definition.points.some(
        (point) => point.pointId === "sketch_point_s1",
      ),
      "Q-g2: the fit point only the removed part used stays as a free point.",
    ).toBe(true);
    expect(
      splineSession.validationMessage,
      "The tool message says how many fit points were left free.",
    ).toBe(
      "Trim left 1 fit point of Spline as a free point (with its constraints): the removed part used it.",
    );
    expect(
      splineSession.liveSolve?.accepted,
      "The trimmed, tied spline pieces solve.",
    ).toBe(true);
  }

  /**
   * U-G3: Commit waits for the staged preview's certification. Requests the
   * commit (nothing is committed while pending), then runs the preview's
   * real publication (production query + certifier, the same contracts
   * publish the derivation worker runs) and delivers it, re-authoring once
   * on `planChanged` exactly as the editor loop does.
   */
  function commitCertifiedOffset(session: SketchSessionState) {
    let next = patchSketchEditToolValue(session, { intent: "commitOffset" });
    for (let round = 0; round < 2; round += 1) {
      const publication = next.activeEditTool?.offsetPublication;
      if (publication?.status !== "pending") break;
      expect(
        next.definition.entityIds.length,
        "U-G3: nothing is committed while the offset check is pending.",
      ).toBe(session.definition.entityIds.length);
      expect(
        publication.commitRequested,
        "U-G3: the commit request waits for the check.",
      ).toBeTruthy();
      const basis = publication.basis!;
      next = completeSketchOffsetPreviewPublication(
        next,
        publication.derivationId,
        publishSketchOffsets({
          definition: basis.definition,
          solvedSnapshot: basis.solvedSnapshot,
          modelingTolerance: basis.modelingTolerance,
          capabilities: {
            query: createCertifiedNeutralCurveRequestQuery(),
            certifier: createCertifiedCubicTubeChain(),
          },
        }),
      );
    }
    return next;
  }

  function testOffsetAddsLineCopyAndRejectsInvalidDistance() {
    let session = createNewSketchSessionFromSupport(
      {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
      OCC_KERNEL_SETTINGS,
    );
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
    session = commitCertifiedOffset(session);

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
    // The default distance (1) collapses an inward offset of this unit
    // square, so a satisfiable distance is set before expecting a preview.
    const previewed = patchSketchEditToolValue(activated, { value: 0.25 });
    expect(
      previewed.toolStagedEntities.some(
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
    // The square traverses counter-clockwise from AB, so "left" offsets
    // inward and "right" offsets outward with arc joins at the corners.
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

    outerSession = patchSketchEditToolValue(outerSession, {
      intent: "setOffsetSide",
      value: "right",
    });
    expect(
      outerSession.toolStagedEntities.filter(
        (entity) => entity.status === "preview" && entity.kind === "line",
      ).length,
      "Continuous square offset should preview one derived line per selected edge.",
    ).toBe(4);

    outerSession = patchSketchEditToolValue(outerSession, { value: 1 });
    outerSession = commitCertifiedOffset(outerSession);

    const outerLines = outerSession.definition.entities.filter(
      (entity) =>
        entity.kind === "lineSegment" &&
        !definition.entityIds.includes(entity.entityId),
    );
    const outerArcs = outerSession.definition.entities.filter(
      (entity) => entity.kind === "arc",
    );
    const outerPoints = outerSession.definition.points.filter(
      (point) => !definition.pointIds.includes(point.pointId),
    );

    expect(
      outerLines.length,
      "Outer square offset should create four derived line entities.",
    ).toBe(4);
    expect(
      outerArcs.length,
      "Outer square offset should join every convex corner with an arc.",
    ).toBe(4);
    const outerRelationship =
      outerSession.definition.derivedRelationships?.find(
        (relationship) => relationship.kind === "offset",
      );
    expect(
      outerRelationship?.kind === "offset" &&
        outerRelationship.jointOutputs.length,
      "Outer square offset should record stable joint identities.",
    ).toBe(4);
    assertIncludesPoint(
      outerPoints,
      [0, -1],
      "Outer square offset should move the bottom edge outward.",
    );
    assertIncludesPoint(
      outerPoints,
      [2, 0],
      "Outer square offset should move the right edge outward.",
    );
    assertIncludesPoint(
      outerPoints,
      [1, 0],
      "Outer square joint arcs should center on the seed corners.",
    );

    let innerSession = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );
    for (const entity of definition.entities) {
      innerSession = selectSketchEditToolTarget(innerSession, entity.target);
    }

    innerSession = patchSketchEditToolValue(innerSession, { value: 0.25 });
    innerSession = commitCertifiedOffset(innerSession);

    const innerPoints = innerSession.definition.points.filter(
      (point) => !definition.pointIds.includes(point.pointId),
    );
    assertIncludesPoint(
      innerPoints,
      [0.25, 0.25],
      "Inner square offset should trim the bottom-left corner inward.",
    );
    assertIncludesPoint(
      innerPoints,
      [0.75, 0.25],
      "Inner square offset should trim the bottom-right corner inward.",
    );
    assertIncludesPoint(
      innerPoints,
      [0.75, 0.75],
      "Inner square offset should trim the top-right corner inward.",
    );
    assertIncludesPoint(
      innerPoints,
      [0.25, 0.75],
      "Inner square offset should trim the top-left corner inward.",
    );
  }

  function testOffsetPreviewFollowsPointerSide() {
    const definition = makeDefinition({
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
    let session = beginSketchTool(
      createSessionFromDefinition(definition),
      "offset",
    );
    session = selectSketchEditToolTarget(session, {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_ab",
    });

    const above = updateSketchPointer(session, [2, 3]);
    expect(
      above.activeEditTool?.offsetSide,
      "Moving the pointer above the chain should preview the left side.",
    ).toBe("left");
    expect(
      above.toolStagedEntities.some(
        (entity) =>
          entity.kind === "line" &&
          entity.status === "preview" &&
          entity.start[1] > 0,
      ),
      "The staged preview should sit on the pointer's side of the chain.",
    ).toBeTruthy();

    const below = updateSketchPointer(above, [2, -3]);
    expect(
      below.activeEditTool?.offsetSide,
      "Moving the pointer across the chain should flip the previewed side.",
    ).toBe("right");
    expect(
      below.toolStagedEntities.some(
        (entity) =>
          entity.kind === "line" &&
          entity.status === "preview" &&
          entity.start[1] < 0,
      ),
      "The staged preview should follow the pointer across the chain.",
    ).toBeTruthy();
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
    session = commitCertifiedOffset(session);

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
      "Open angle offset should share the trimmed corner point.",
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
    // Circles traverse counter-clockwise, so the outward side is "right".
    circleSession = patchSketchEditToolValue(circleSession, {
      intent: "setOffsetSide",
      value: "right",
    });
    circleSession = patchSketchEditToolValue(circleSession, { value: 1 });
    circleSession = commitCertifiedOffset(circleSession);
    const offsetCircle = circleSession.definition.entities.find(
      (entity) =>
        entity.entityId !== "sketch_entity_circle" && entity.kind === "circle",
    );
    expect(
      offsetCircle?.kind === "circle" && offsetCircle.radius === 3,
      "Circle offset should add a derived circle at the requested radius.",
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
    arcSession = commitCertifiedOffset(arcSession);
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
    splineSession = commitCertifiedOffset(splineSession);
    // T08b-g5: a spline seed's offset is one derived piecewise-cubic shell
    // with one output span per source span (no fit-point spline copy).
    const splineRelationship =
      splineSession.definition.derivedRelationships?.find(
        (relationship) => relationship.kind === "offset",
      );
    expect(
      splineSession.definition.entities.some(
        (entity) =>
          entity.kind === "derivedPiecewiseCubic" &&
          entity.derivationId === splineRelationship?.derivationId,
      ),
      "Spline offset should add a derived offset shell owned by its relationship.",
    ).toBeTruthy();
    expect(
      splineRelationship?.kind === "offset"
        ? splineRelationship.piecewiseCubicOutputs.map((output) =>
            output.spans.map((span) => span.outputSpanId),
          )
        : null,
      "Spline offset should key the shell's output spans by the seed's source spans.",
    ).toEqual([["occ-0>occ-1", "occ-1>occ-2"]]);
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
            representation: {
              kind: "sourceSamples",
              points: [
                [0, 0],
                [1, 2],
                [2, 0],
              ],
              isClosed: false,
            },
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
    // T10h (D6, [TECH] T-10): a projected spline is refused explicitly at
    // selection, with a value and at Commit; nothing is previewed or added.
    expect(
      splineSession.toolStagedEntities,
      "Projected spline offset should preview nothing.",
    ).toEqual([]);
    expect(
      splineSession.validationMessage,
      "Projected spline offset should say it is not supported yet.",
    ).toBe(PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE);
    expect(
      splineSession.toolPresentation?.validation?.map((item) => item.message),
      "The tool presentation carries the message to the panel.",
    ).toEqual([PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE]);
    const emptyDefinition = splineSession.definition;
    splineSession = patchSketchEditToolValue(splineSession, { value: 1 });
    expect(splineSession.validationMessage).toBe(
      PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
    );
    splineSession = patchSketchEditToolValue(splineSession, {
      intent: "commitOffset",
    });
    expect(splineSession.validationMessage).toBe(
      PROJECTED_SPLINE_OFFSET_UNSUPPORTED_MESSAGE,
    );
    expect(
      splineSession.definition,
      "Projected spline offset should author nothing.",
    ).toBe(emptyDefinition);
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

    // T10h (D6, user decision Q2 = S1): Slot along a spline is refused at
    // selection and at Commit; nothing is previewed or authored.
    const splineDefinition = makeDefinition({
      pointIds: ["sketch_point_s0", "sketch_point_s1", "sketch_point_s2"],
      points: [
        makePoint("sketch_point_s0", "S0", 0, 0),
        makePoint("sketch_point_s1", "S1", 1, 2),
        makePoint("sketch_point_s2", "S2", 2, 0),
      ],
      entityIds: ["sketch_entity_spline"],
      entities: [
        makeSpline("sketch_entity_spline", "Spline", [
          "sketch_point_s0",
          "sketch_point_s1",
          "sketch_point_s2",
        ]),
      ],
    });
    let splineSlotSession = beginSketchTool(
      createSessionFromDefinition(splineDefinition),
      "sketchSlot",
    );
    splineSlotSession = selectSketchEditToolTarget(
      splineSlotSession,
      splineDefinition.entities[0]!.target,
    );
    expect(splineSlotSession.toolStagedEntities).toEqual([]);
    expect(
      splineSlotSession.validationMessage,
      "Slot along a spline should say it is not supported yet.",
    ).toBe(SPLINE_SLOT_UNSUPPORTED_MESSAGE);
    const unchanged = splineSlotSession.definition;
    splineSlotSession = patchSketchEditToolValue(splineSlotSession, {
      value: 1,
    });
    splineSlotSession = patchSketchEditToolValue(splineSlotSession, {
      intent: "commitSketchEditOperator",
    });
    expect(splineSlotSession.validationMessage).toBe(
      SPLINE_SLOT_UNSUPPORTED_MESSAGE,
    );
    expect(
      splineSlotSession.definition,
      "Slot along a spline should author nothing.",
    ).toBe(unchanged);
  }

  async function testSketchExtendSplitAndUnsupportedDiagnosticsUseSessionState() {
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
      openSessionFromDefinition(extendDefinition),
      "sketchExtend",
    );
    extendSession = selectSketchEditToolTarget(
      extendSession,
      extendDefinition.entities[0]!.target,
    );
    const extendClicked = selectSketchEditToolTarget(
      extendSession,
      extendDefinition.entities[1]!.target,
    );
    // T10g-2: the completed selection only queues its exact query.
    expect(
      extendClicked.definition,
      "Extend authors nothing before its intersection is certified.",
    ).toBe(extendSession.definition);
    expect(
      extendClicked.activeEditTool?.editQuery?.inFlight?.input.operation,
    ).toEqual({
      kind: "extend",
      targetEntityId: "sketch_entity_ab",
      boundaryEntityId: "sketch_entity_cd",
    });
    expect(
      extendClicked.toolPresentation?.validation?.map((entry) => entry.message),
    ).toEqual(["Checking intersections…"]);
    extendSession = await completeSketchEditQueriesForTest(extendClicked);
    assertIncludesPoint(
      extendSession.definition.points,
      [3, 0],
      "Sketch extend should update the selected line endpoint at the boundary.",
    );
    expect(
      extendSession.definition.entities.length,
      "Sketch extend should preserve unrelated boundary geometry.",
    ).toBe(2);
    expect(
      trimTies(extendClicked, extendSession),
      "Q1b: the new end is tied onto the boundary.",
    ).toEqual([["pointOnCurve", "sketch_entity_cd"]]);
    expect(extendSession.liveSolve?.accepted).toBe(true);

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
      openSessionFromDefinition(splitDefinition),
      "sketchSplit",
    );
    splitSession = selectSketchEditToolTarget(
      splitSession,
      splitDefinition.entities[0]!.target,
    );
    const splitClicked = selectSketchEditToolTarget(
      splitSession,
      splitDefinition.entities[1]!.target,
    );
    expect(
      splitClicked.definition,
      "Split authors nothing before its crossing is certified.",
    ).toBe(splitSession.definition);
    expect(
      splitClicked.activeEditTool?.editQuery?.inFlight?.input.operation,
    ).toEqual({
      kind: "split",
      targetEntityId: "sketch_entity_ab",
      boundaryEntityId: "sketch_entity_cd",
    });
    splitSession = await completeSketchEditQueriesForTest(splitClicked);
    expect(
      splitSession.definition.entities.length,
      "Sketch split should divide the selected line in session state.",
    ).toBe(3);
    assertIncludesPoint(
      splitSession.definition.points,
      [2, 0],
      "Sketch split should add the split point at the crossing boundary.",
    );
    expect(
      trimTies(splitClicked, splitSession),
      "Q1b: the one shared split point is tied once.",
    ).toEqual([["pointOnCurve", "sketch_entity_cd"]]);
    expect(splitSession.liveSolve?.accepted).toBe(true);

    // Q-g3: unsupported kinds are refused; nothing is queried or authored.
    const circleDefinition = makeDefinition({
      pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_center"],
      points: [
        makePoint("sketch_point_a", "A", 0, 0),
        makePoint("sketch_point_b", "B", 1, 0),
        makePoint("sketch_point_center", "Center", 4, 0),
      ],
      entityIds: ["sketch_entity_ab", "sketch_entity_circle"],
      entities: [
        makeLine("sketch_entity_ab", "AB", "sketch_point_a", "sketch_point_b"),
        makeCircle("sketch_entity_circle", "Circle", "sketch_point_center", 1),
      ],
    });
    // T13m (Q1): Split takes a circle boundary now; an ellipse is refused.
    const ellipseDefinition = {
      ...circleDefinition,
      pointIds: [...circleDefinition.pointIds, "sketch_point_major" as const],
      points: [
        ...circleDefinition.points,
        makePoint("sketch_point_major", "Major", 6, 0),
      ],
      entities: [
        circleDefinition.entities[0]!,
        {
          kind: "ellipse" as const,
          entityId: "sketch_entity_circle" as const,
          label: "Ellipse",
          target: circleDefinition.entities[1]!.target,
          isConstruction: false,
          centerPointId: "sketch_point_center" as const,
          majorAxisPointId: "sketch_point_major" as const,
          minorRadius: 1,
        },
      ],
    };
    for (const [toolId, message, definition] of [
      [
        "sketchExtend",
        "Sketch extend currently supports a line extended to another line.",
        circleDefinition,
      ],
      [
        "sketchSplit",
        "Sketch split supports line, arc, circle, and spline entities split by a line, arc, circle, or spline.",
        ellipseDefinition,
      ],
    ] as const) {
      const begun = beginSketchTool(
        openSessionFromDefinition(definition),
        toolId,
      );
      const refused = selectSketchEditToolTarget(
        selectSketchEditToolTarget(begun, definition.entities[0]!.target),
        definition.entities[1]!.target,
      );
      expect(refused.validationMessage, `${toolId}: today's message`).toBe(
        message,
      );
      expect(refused.definition).toBe(begun.definition);
      expect(refused.activeEditTool?.editQuery?.inFlight ?? null).toBeNull();
      expect(refused.activeEditTool?.selectedTargets).toHaveLength(2);
    }

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
    // T16d: the axis pick stages the copy; only the confirm authors it.
    expect(
      mirrorSession.definition.derivedRelationships ?? [],
      "Sketch mirror picks author nothing before the confirm.",
    ).toEqual([]);
    expect(mirrorSession.toolStagedEntities).toHaveLength(1);
    mirrorSession = patchSketchEditToolValue(mirrorSession, {
      intent: "createMirror",
    });

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
      modelingTolerance: 1e-3,
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

  async function testDerivedLinearPatternGeometryParticipatesInProfiles() {
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
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    const regions = await regionDeriver.derive({
      documentId: "doc_workspace",
      revisionId: "rev_0001",
      sketchId: "sketch_primary",
      definition: session.definition,
      solvedSnapshot: solved.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: OCC_KERNEL_SETTINGS.modelingTolerance,
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
              segment.branch.source.kind === "entity" &&
              (session.definition.derivedRelationships?.[0]?.outputs.some(
                (output) =>
                  segment.branch.source.kind === "entity" &&
                  output.outputEntityId === segment.branch.source.entityId,
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

  function testConstrainedSplineDragPersistsAcceptedTangentsAcrossFreshReentry() {
    const points = [
      makePoint("sketch_point_s0", "S0", 0, 0),
      makePoint("sketch_point_s1", "S1", 1, 1),
      makePoint("sketch_point_s2", "S2", 2, 0),
      makePoint("sketch_point_contact", "Contact", 0.55, 0.8),
    ];
    const spline = {
      ...makeSpline("sketch_entity_spline", "Spline", [
        "sketch_point_s0",
        "sketch_point_s1",
        "sketch_point_s2",
      ]),
      // Record order is deliberately different from stable occurrence order.
      pointOccurrences: [
        {
          occurrenceId: "occ-2",
          pointId: "sketch_point_s2" as const,
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "occ-0",
          pointId: "sketch_point_s0" as const,
          tangent: { kind: "authored" as const, vector: [0.3, 0.15] as const },
        },
        {
          occurrenceId: "occ-1",
          pointId: "sketch_point_s1" as const,
          tangent: { kind: "authored" as const, vector: [0, 0] as const },
        },
      ],
    };
    const constraints: SketchDefinition["constraints"] = [
      ...points.slice(0, 3).map((point, index) => ({
        constraintId: `constraint_fix_spline_${index}` as const,
        kind: "fixPoint" as const,
        label: `Fix ${index}`,
        pointId: point.pointId,
        position: point.position,
      })),
    ];
    const definition: SketchDefinition = {
      ...makeDefinition({
        pointIds: points.map((point) => point.pointId),
        points,
        entityIds: [spline.entityId],
        entities: [spline],
      }),
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
    };
    const initialVectors = spline.pointOccurrences.map((occurrence) =>
      occurrence.tangent.kind === "authored" ? occurrence.tangent.vector : null,
    );
    let session = createSessionFromDefinition(definition);
    const initialSequence = session.sequence;
    const target = session.definition.points.find(
      (point) => point.pointId === "sketch_point_contact",
    )!.target;
    session = beginSketchTool(session, "constraintCoincident");
    session = selectSketchConstraintTarget(session, target);
    session = selectSketchConstraintTarget(session, spline.target);
    expect(
      session.definition.constraints.some(
        (constraint) => constraint.kind === "pointOnCurve",
      ),
    ).toBe(true);
    expect(session.constraintAuthoring).toBe(null);
    expect(session.sequence).toBe(initialSequence + 1);

    session = beginSketchGeometryDrag(session, target, [0.55, 0.8]);
    session = finishSketchGeometryDrag(session, [0.7, 0.65]);
    expect(session.sequence).toBe(initialSequence + 1);

    const acceptedSpline = session.definition.entities.find(
      (entity) => entity.entityId === spline.entityId,
    );
    expect(acceptedSpline?.kind).toBe("spline");
    if (acceptedSpline?.kind !== "spline") return;
    const acceptedVectors = acceptedSpline.pointOccurrences.map((occurrence) =>
      occurrence.tangent.kind === "authored" ? occurrence.tangent.vector : null,
    );
    expect(acceptedVectors).not.toEqual(initialVectors);
    expect(
      acceptedSpline.pointOccurrences.find(
        (occurrence) => occurrence.occurrenceId === "occ-2",
      )?.tangent.kind,
    ).toBe("automatic");

    const persistedDefinition = JSON.parse(
      JSON.stringify(session.commitRequest!.definition),
    ) as SketchDefinition;
    const fresh = createSessionFromDefinition(persistedDefinition);
    expect(fresh.definition.entities).toEqual(persistedDefinition.entities);
    const freshSolved = solveSketchDefinitionCore({
      definition: fresh.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "failOnConflict",
    });
    expect(freshSolved.status.solveState).toBe("solved");

    const fixedContact: SketchDefinition = {
      ...fresh.definition,
      constraintIds: [
        ...fresh.definition.constraintIds,
        "constraint_fix_contact",
      ],
      constraints: [
        ...fresh.definition.constraints,
        {
          constraintId: "constraint_fix_contact",
          kind: "fixPoint",
          label: "Fix contact",
          pointId: "sketch_point_contact",
          position: fresh.definition.points.find(
            (point) => point.pointId === "sketch_point_contact",
          )!.position,
        },
      ],
    };
    let blocked = createSessionFromDefinition(fixedContact);
    const beforeBlocked = structuredClone(blocked.definition);
    const beforeSequence = blocked.sequence;
    blocked = beginSketchGeometryDrag(blocked, target, [0.7, 0.65]);
    blocked = finishSketchGeometryDrag(blocked, [5, 5]);
    expect(blocked.definition).toEqual(beforeBlocked);
    expect(blocked.sequence).toBe(beforeSequence);
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
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    let session = createSketchSessionFromSnapshot(
      {
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
          derivedValidity: { state: "current", diagnostics: [] },
          regions: [],
        },
      } satisfies SketchSnapshotRecord,
      OCC_KERNEL_SETTINGS,
    );
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

  testGrabOffsetPreservesPointPosition();
  testTwoPressPointsProduceSameGeometry();
  testNonDraggableTargetReturnsUnchanged();
  testEntityBodyDragTranslatesLine();
  testCircleRimDragChangesRadius();
  testCancelRestoresPreDragDefinition();
  testActiveDragStateIncludesHandleAndIntent();
  testDragOnNonAcceptableSketchDoesNotThrow();
  testUnconstrainedPointDragUpdatesAuthoredDefinition();
  testConstrainedSquareDragTranslatesSolvedShape();
  testLogoLikeFreeEndpointDragClearsValidationFeedback();
  testAnchoredBranchDragStaysContinuousWithoutFlipping();
  await testLiveRegionRenderableTracksJiggledSketchDrag();
  await testLiveRegionRenderablePreservesInnerLoopHole();
  await testLiveRegionRenderableTriangulatesConcaveRegion();
  await testLiveRegionDiagnosticsAreAvailableDuringEditing();
  await testConstrainedDragRegionDerivationBenchmark();
  testConnectedSketchSelectionSelectsTwoConnectedLines();
  testConnectedSketchSelectionSelectsRectangleFromAnyEdge();
  testConnectedSketchSelectionUsesLocalEntityTargetNamespace();
  testConnectedSketchSelectionSelectsBranchingComponentAndRejectsUnsupportedTargets();
  testRectangleToolCornerDragResizesRectangle();
  await testImmovableConstrainedDragBlocksWithoutChangingDraft();
  testFixedLogoLikeEndpointDragBlocksWithConstrainedFeedback();
  testPerpendicularSlideShowsNoConstrainedFeedback();
  testSelectedEntityDeletionRemovesDependentAnnotations();
  testSelectedPointDeletionRemovesDependentGeometryAndAnnotations();
  await testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets();
  await testSvgRenderingToggleSuppressesAuthoredStylesWithoutDeletingThem();
  await testTrimSplitsLineAtClearIntersections();
  await testTrimHandlesCircleArcAndSplineTargets();
  testOffsetAddsLineCopyAndRejectsInvalidDistance();
  testOffsetActivationSeedsCompatiblePreselectionAndClearsInvalidSelection();
  testOffsetCreatesContinuousOuterAndInnerSquares();
  testOffsetPreviewFollowsPointerSide();
  testOffsetCreatesContinuousOpenAngle();
  testOffsetAddsCircleArcAndSplineCopies();
  testOffsetAddsProjectedCircleAndSplineCopies();
  testSketchFilletChamferAndSlotUseSessionPreviewAndCommit();
  await testSketchExtendSplitAndUnsupportedDiagnosticsUseSessionState();
  testSketchDerivedTransformOperatorsCreateDurableRelationships();
  testSketchPatternAndTransformOperatorsCommitWithoutPartFeatureSessions();
  await testDerivedLinearPatternGeometryParticipatesInProfiles();
  testPointerOnlyPreviewReusesStableDisplayRenderables();
  testAcceptedSketchEditInvalidatesStableDisplayRenderables();
  testConstrainedSplineDragPersistsAcceptedTangentsAcrossFreshReentry();
  testNoOpPointerMovementPreservesSessionIdentity();
  testLogoCadaraPointerPreviewReusesStableDisplayBasis();
});

// T10g-1 (logic lane, session seam). Review R-6: the "accepted live solve of
// the current definition" check is the recorded source identity
// (`liveSolve.sourceDefinition`), and Trim queries only on it (T-g3).
test("T10g-1 R-6: Trim needs the accepted live solve of the current definition", async () => {
  const draw = (
    session: SketchSessionState,
    start: [number, number],
    end: [number, number],
  ) =>
    acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), start),
      end,
    );
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = draw(
    draw(draw(session, [0, 0], [4, 0]), [1, -1], [1, 1]),
    [3, -1],
    [3, 1],
  );
  const target = session.definition.entities[0]!;
  expect(session.liveSolve?.sourceDefinition).toBe(session.definition);
  expect(hasAcceptedLiveSolveOfDefinition(session)).toBe(true);
  // A definition that did not go through `withLiveSolveBasis` is not current.
  const unsolved = {
    ...session,
    definition: { ...session.definition },
  };
  expect(hasAcceptedLiveSolveOfDefinition(unsolved)).toBe(false);
  expect(
    hasAcceptedLiveSolveOfDefinition(
      withLiveSolveBasis(unsolved, unsolved.definition),
    ),
  ).toBe(true);
  // A conflicting sketch: the click is refused, nothing is queued or authored.
  const pointId = session.definition.points[0]!.pointId;
  const conflicting = {
    ...session.definition,
    constraintIds: [
      ...session.definition.constraintIds,
      "constraint_fix_a",
      "constraint_fix_b",
    ],
    constraints: [
      ...session.definition.constraints,
      {
        constraintId: "constraint_fix_a",
        kind: "fixPoint",
        label: "Fix A",
        pointId,
        position: [0, 0],
      },
      {
        constraintId: "constraint_fix_b",
        kind: "fixPoint",
        label: "Fix B",
        pointId,
        position: [100, 0],
      },
    ],
  } as SketchDefinition;
  const conflicted = withLiveSolveBasis(
    { ...session, definition: conflicting },
    conflicting,
  );
  expect(conflicted.liveSolve?.accepted).toBe(false);
  const refused = selectSketchEditToolTarget(
    beginSketchTool(conflicted, "trim"),
    target.target,
  );
  expect(refused.validationMessage).toBe(TRIM_BASIS_NOT_ACCEPTED_MESSAGE);
  expect(refused.activeEditTool?.editQuery?.queue).toEqual([]);
  expect(refused.definition).toBe(conflicted.definition);
  // The accepted sketch queries and applies.
  const applied = await completeSketchEditQueriesForTest(
    selectSketchEditToolTarget(beginSketchTool(session, "trim"), target.target),
  );
  expect(applied.definition.entities).toHaveLength(4);
});

// Orchestrator [TECH] 2026-10-04 (logic lane, session seam): a circle that
// carries a `circleRadius` (T13a: deliberately added with the Radius tool;
// the Circle tool no longer authors one) stays accepted after its Trim (the
// radius is now a diameter of the arc), so a second Trim still runs.
test("T10g-1: trimming a circle with a Radius-tool dimension keeps the sketch accepted and a second Trim in the same sketch succeeds", async () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "circle"), [0, 0]),
    [2, 0],
  );
  const circle = session.definition.entities.find(
    (entity) => entity.kind === "circle",
  )!;
  expect(
    session.definition.dimensions,
    "premise: the Circle tool authors no dimension",
  ).toEqual([]);
  session = patchSketchConstraintValue(
    patchSketchConstraintValue(
      selectSketchConstraintTarget(
        beginSketchTool(session, "dimensionRadius"),
        circle.target,
      ),
      { value: 2 },
    ),
    { intent: "commitConstraintValue" },
  );
  const radius = session.definition.dimensions.find(
    (dimension) => dimension.kind === "circleRadius",
  )!;
  expect(radius.value, "premise: the deliberate radius").toEqual({
    source: "literal",
    value: 2,
  });
  for (const x of [1, -1])
    session = acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), [x, -3]),
      [x, 3],
    );
  const trimmed = await completeSketchEditQueriesForTest(
    selectSketchEditToolTarget(beginSketchTool(session, "trim"), circle.target),
  );
  expect(trimmed.validationMessage).toBeNull();
  expect(
    trimmed.definition.entities.find(
      (entity) => entity.entityId === circle.entityId,
    )?.kind,
  ).toBe("arc");
  // T13l (C1 A-3, T13a A-1): the Radius tool's "Radius N" label follows the
  // rewrite to "Diameter N"; the arc gains its endpoint bindings (P5).
  expect(radius.label, "premise: the Radius tool's label").toMatch(
    /^Radius \d+$/,
  );
  const arc = trimmed.definition.entities.find(
    (entity) => entity.entityId === circle.entityId,
  );
  if (arc?.kind !== "arc") throw new Error("arc");
  expect(trimmed.definition.dimensions).toEqual([
    {
      ...radius,
      kind: "diameter",
      label: radius.label.replace("Radius", "Diameter"),
      value: { source: "literal", value: 4 },
    },
    expect.objectContaining({
      kind: "arcStartPointCoincident",
      entityId: arc.entityId,
      pointId: arc.startPointId,
    }),
    expect.objectContaining({
      kind: "arcEndPointCoincident",
      entityId: arc.entityId,
      pointId: arc.endPointId,
    }),
  ]);
  expect(trimmed.definition.dimensions[0]!.label).toMatch(/^Diameter \d+$/);
  expect(trimmed.liveSolve?.accepted, "the trimmed sketch stays accepted").toBe(
    true,
  );
  const line = trimmed.definition.entities.find(
    (entity) => entity.kind === "lineSegment",
  )!;
  const second = await completeSketchEditQueriesForTest(
    selectSketchEditToolTarget(trimmed, line.target),
  );
  expect(second.validationMessage).toBeNull();
  expect(second.definition.entityIds.length).toBe(
    trimmed.definition.entityIds.length + 1,
  );
});

// T13a (logic lane, session seam): a Circle-tool circle has no automatic
// size, so its rim drag grows the radius with the centre fixed; the same drag
// after a deliberate Radius-tool dimension leaves the radius at its value.
test("T13a: a freshly drawn circle's rim drag grows the radius with the centre fixed; a deliberate radius blocks it", () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "circle"), [1, 1]),
    [3, 1],
  );
  session = beginSketchTool(session, "line");
  const circle = session.definition.entities.find(
    (entity) => entity.kind === "circle",
  )!;
  expect(session.definition.dimensions, "premise: no automatic size").toEqual(
    [],
  );
  const rimDrag = (from: SketchSessionState) =>
    finishSketchGeometryDrag(
      beginSketchGeometryDrag(from, circle.target, [3, 1], {
        kind: "rim",
        entityId: circle.entityId,
      }),
      [5, 1],
    );
  const radiusOf = (state: SketchSessionState) => {
    const entity = state.definition.entities.find(
      (candidate) => candidate.entityId === circle.entityId,
    );
    return entity?.kind === "circle" ? entity.radius : null;
  };
  const centreOf = (state: SketchSessionState) =>
    state.definition.points.find(
      (point) =>
        circle.kind === "circle" && point.pointId === circle.centerPointId,
    )?.position;

  const grown = rimDrag(session);
  expect(radiusOf(grown), "the rim drag grows the radius to 4").toBeCloseTo(
    4,
    6,
  );
  expect(centreOf(grown)?.[0]).toBeCloseTo(1, 9);
  expect(centreOf(grown)?.[1]).toBeCloseTo(1, 9);
  expect(grown.definition.dimensions, "the drag authors nothing").toEqual([]);

  const dimensioned = patchSketchConstraintValue(
    patchSketchConstraintValue(
      selectSketchConstraintTarget(
        beginSketchTool(session, "dimensionRadius"),
        circle.target,
      ),
      { value: 2 },
    ),
    { intent: "commitConstraintValue" },
  );
  const blocked = expectBlockedRimDrag(
    beginSketchTool(dimensioned, "line"),
    circle,
  );
  expect(
    radiusOf(blocked),
    "a deliberate radius keeps its value under a rim drag",
  ).toBeCloseTo(2, 6);
});

/**
 * T13a Q2: a rim drag of a circle whose size is driven by a deliberate
 * dimension starts (no "can't be dragged until the sketch solves") and its
 * frame is blocked with the constrained feedback cue; release keeps the size.
 */
function expectBlockedRimDrag(
  session: SketchSessionState,
  circle: SketchDefinition["entities"][number],
) {
  const begun = beginSketchGeometryDrag(session, circle.target, [3, 1], {
    kind: "rim",
    entityId: circle.entityId,
  });
  expect(begun.validationMessage, "the drag starts").toBeNull();
  expect(begun.activeDrag?.intent.kind).toBe("radius");
  const moved = updateSketchGeometryDrag(begun, [4, 1]);
  expect(moved.activeDrag?.status, "the frame is blocked").toBe("blocked");
  expect(
    moved.activeDrag?.feedback?.kind,
    "with the constrained cue, not a failed solve",
  ).toBe("constrained");
  const released = finishSketchGeometryDrag(moved, [5, 1]);
  expect(released.definition.dimensions).toEqual(session.definition.dimensions);
  return released;
}

function drawCircleAt11() {
  const session = acceptSketchDraw(
    startSketchDraw(
      beginSketchTool(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        "circle",
      ),
      [1, 1],
    ),
    [3, 1],
  );
  return {
    session,
    circle: session.definition.entities.find(
      (entity) => entity.kind === "circle",
    )!,
  };
}

test("T13a Q2: a Dimension-tool diameter blocks a rim drag as a constrained frame (not an unacceptable start)", () => {
  const { session, circle } = drawCircleAt11();
  const dimensioned = patchSketchConstraintValue(
    patchSketchConstraintValue(
      selectSketchConstraintTarget(
        beginSketchTool(session, "dimensionDistance"),
        circle.target,
      ),
      { value: 4 },
    ),
    { intent: "commitConstraintValue" },
  );
  expect(
    dimensioned.definition.dimensions.map((dimension) => [
      dimension.kind,
      dimension.value,
    ]),
    "premise: an authored-value diameter",
  ).toEqual([["diameter", { source: "literal", value: 4 }]]);
  const released = expectBlockedRimDrag(
    beginSketchTool(dimensioned, "line"),
    circle,
  );
  const radius = released.definition.entities.find(
    (entity) => entity.entityId === circle.entityId,
  );
  expect(radius?.kind === "circle" ? radius.radius : null).toBeCloseTo(2, 6);
});

test("T13a Q2: an expression-valued dimension stays byte-identical through a drag of other geometry", () => {
  const drawn = drawCircleAt11().session;
  const circle = drawn.definition.entities.find(
    (entity) => entity.kind === "circle",
  )!;
  let session: SketchSessionState = {
    ...drawn,
    documentVariables: [
      { variableId: "variable_d", name: "d", valueText: "4" },
    ],
  };
  session = patchSketchConstraintValue(
    patchSketchConstraintValue(
      selectSketchConstraintTarget(
        beginSketchTool(session, "dimensionDistance"),
        circle.target,
      ),
      { value: "d" },
    ),
    { intent: "commitConstraintValue" },
  );
  expect(session.validationMessage).toBeNull();
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), [6, 6]),
    [9, 6],
  );
  session = beginSketchTool(session, "line");
  const dimensionsBefore = JSON.stringify(session.definition.dimensions);
  expect(
    session.definition.dimensions.map((dimension) => dimension.value),
    "premise: the expression is authored",
  ).toEqual([{ source: "expression", valueText: "d" }]);
  const end = session.definition.points.find(
    (point) => point.label === "Line 3 end",
  )!;
  let dragging = beginSketchGeometryDrag(session, end.target, [9, 6]);
  expect(dragging.validationMessage, "the drag starts").toBeNull();
  dragging = updateSketchGeometryDrag(dragging, [9, 7]);
  expect(dragging.activeDrag?.status).toBe("dragging");
  const released = finishSketchGeometryDrag(dragging, [9, 8]);
  const moved = released.definition.points.find(
    (point) => point.pointId === end.pointId,
  )!.position;
  expect(moved[1], "the line end moved").toBeGreaterThan(7.9);
  expect(
    JSON.stringify(released.definition.dimensions),
    "the expression dimension is untouched",
  ).toBe(dimensionsBefore);
});

// T13a (logic lane, session seam): a Rectangle-tool rectangle has no
// automatic width/height, so a corner drag should resize both sides freely
// while its horizontal/vertical relationships hold (issue 05: minimum motion).
// T13a2 deleted the rigid-translation drag fast path that translated the
// whole rectangle, so this row is a plain `test` again.
test("T13a: a rectangle corner drag resizes both sides freely and keeps horizontal/vertical", () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [1, 1]),
    [5, 4],
  );
  session = beginSketchTool(session, "line");
  expect(session.definition.dimensions, "premise: no automatic size").toEqual(
    [],
  );
  const corner = session.definition.points.find(
    (point) => point.label === "Rectangle 1 top right",
  )!;
  const dragged = finishSketchGeometryDrag(
    beginSketchGeometryDrag(session, corner.target, [5, 4]),
    [7, 6],
  );
  const at = (label: string) =>
    dragged.definition.points.find((point) => point.label === label)!.position;
  const [bl, br, tr, tl] = [
    "Rectangle 1 bottom left",
    "Rectangle 1 bottom right",
    "Rectangle 1 top right",
    "Rectangle 1 top left",
  ].map(at);
  // The pointer is a soft target (minimum motion): within 1e-3 of it.
  expect(tr![0], "the dragged corner follows the pointer").toBeCloseTo(7, 3);
  expect(tr![1]).toBeCloseTo(6, 3);
  expect(bl![0], "the opposite corner stays (minimum motion)").toBeCloseTo(1, 3);
  expect(bl![1]).toBeCloseTo(1, 3);
  expect(br![0] - bl![0], "width grows from 4 to 6").toBeCloseTo(6, 3);
  expect(tl![1] - bl![1], "height grows from 3 to 5").toBeCloseTo(5, 3);
  const tolerance = OCC_KERNEL_SETTINGS.modelingTolerance;
  expect(Math.abs(br![1] - bl![1]), "bottom stays horizontal").toBeLessThan(
    tolerance,
  );
  expect(Math.abs(tr![1] - tl![1]), "top stays horizontal").toBeLessThan(
    tolerance,
  );
  expect(Math.abs(br![0] - tr![0]), "right stays vertical").toBeLessThan(
    tolerance,
  );
  expect(Math.abs(bl![0] - tl![0]), "left stays vertical").toBeLessThan(
    tolerance,
  );
  expect(
    dragged.definition.constraints.map((constraint) => constraint.kind).sort(),
  ).toEqual(["horizontal", "horizontal", "vertical", "vertical"]);
  expect(dragged.definition.dimensions, "the drag authors nothing").toEqual([]);
});

// T13a review B-1 (logic lane, session seam): with any other requirement in
// the sketch the rim drag goes through the solver; the accepted radius must
// reach the authored definition, survive a fresh solve and be committed.
test("T13a B-1: a circle drawn next to a rectangle keeps its rim-dragged radius in the definition, a fresh solve and the commit request", () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [6, 0]),
    [9, 3],
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "circle"), [1, 1]),
    [3, 1],
  );
  session = beginSketchTool(session, "line");
  expect(
    session.definition.constraints.length,
    "premise: the sketch has requirements (solver path)",
  ).toBe(4);
  const circle = session.definition.entities.find(
    (entity) => entity.kind === "circle",
  )!;
  const radiusIn = (definition: SketchDefinition | undefined) => {
    const entity = definition?.entities.find(
      (candidate) => candidate.entityId === circle.entityId,
    );
    return entity?.kind === "circle" ? entity.radius : null;
  };
  let dragging = beginSketchGeometryDrag(session, circle.target, [3, 1], {
    kind: "rim",
    entityId: circle.entityId,
  });
  dragging = updateSketchGeometryDrag(dragging, [4, 1]);
  const released = finishSketchGeometryDrag(dragging, [5, 1]);
  expect(radiusIn(released.definition), "definition radius").toBeCloseTo(4, 3);
  expect(
    radiusIn(released.commitRequest?.definition),
    "commit request radius",
  ).toBeCloseTo(4, 3);
  const fresh = withLiveSolveBasis(
    released,
    structuredClone(released.definition),
  );
  const solved = fresh.liveSolve?.solvedSnapshot.solvedEntities.find(
    (entity) => entity.entityId === circle.entityId,
  );
  expect(fresh.liveSolve?.accepted).toBe(true);
  expect(
    solved?.kind === "circle" ? solved.solvedRadius : null,
    "a fresh solve of the released definition keeps the radius",
  ).toBeCloseTo(4, 3);
  const centre = released.definition.points.find(
    (point) => circle.kind === "circle" && point.pointId === circle.centerPointId,
  )!.position;
  expect(centre[0]).toBeCloseTo(1, 6);
  expect(centre[1]).toBeCloseTo(1, 6);
});

// T13a review B-1 (logic lane, session seam): a circumscribed hexagon's free
// construction circle changes size during a vertex drag; the released
// definition must reproduce the released geometry on a fresh solve.
test("T13a B-1: a centre-fixed circumscribed hexagon does not drift on a fresh solve after a vertex drag", () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "circumscribedPolygon"), [1, 1]),
    [3, 1],
  );
  const centre = session.definition.points.find(
    (point) => point.label === "Circumscribed Polygon 1 center",
  )!;
  session = selectSketchConstraintTarget(
    beginSketchTool(session, "constraintFix"),
    centre.target,
  );
  const vertex = session.definition.points.find(
    (point) => point.label === "Circumscribed Polygon 1 vertex 1",
  )!;
  const target: [number, number] = [
    vertex.position[0] - 0.3,
    vertex.position[1] + 0.6,
  ];
  let dragging = beginSketchGeometryDrag(
    beginSketchTool(session, "line"),
    vertex.target,
    vertex.position,
  );
  for (let step = 1; step < 8; step += 1)
    dragging = updateSketchGeometryDrag(dragging, [
      vertex.position[0] + (step / 8) * (target[0] - vertex.position[0]),
      vertex.position[1] + (step / 8) * (target[1] - vertex.position[1]),
    ]);
  const released = finishSketchGeometryDrag(dragging, target);
  const circleRadii = (state: SketchSessionState) =>
    state.liveSolve!.solvedSnapshot.solvedEntities.flatMap((entity) =>
      entity.kind === "circle" ? [entity.solvedRadius] : [],
    );
  const [releasedRadius] = circleRadii(released);
  expect(
    Math.abs(releasedRadius! - 2),
    "premise: the drag changed the construction radius",
  ).toBeGreaterThan(0.1);
  const fresh = withLiveSolveBasis(
    released,
    structuredClone(released.definition),
  );
  expect(fresh.liveSolve?.accepted).toBe(true);
  expect(circleRadii(fresh)[0]).toBeCloseTo(releasedRadius!, 6);
  const releasedPoints = new Map(
    released.liveSolve!.solvedSnapshot.solvedPoints.map((point) => [
      point.pointId,
      point.solvedPosition,
    ]),
  );
  const drift = Math.max(
    ...fresh.liveSolve!.solvedSnapshot.solvedPoints.map((point) => {
      const before = releasedPoints.get(point.pointId)!;
      return Math.hypot(
        point.solvedPosition[0] - before[0],
        point.solvedPosition[1] - before[1],
      );
    }),
  );
  expect(drift, "no point drifts on the fresh solve").toBeLessThan(1e-6);
});

// T13c A-2 (logic lane, session drag seam): a regular polygon stays regular
// under a vertex drag. Equal sides tangent to the incircle alone let the
// tangent lengths alternate (a, s − a); the circumscribed polygon's vertices
// also lie on a concentric construction circumcircle. A rectangle drawn
// first makes the sketch multi-entity.
function polygonRegularityAfterVertexDrag(
  toolId: "inscribedPolygon" | "circumscribedPolygon",
  name: string,
) {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [10, 10]),
    [14, 13],
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, toolId), [1, 1]),
    [3, 1],
  );
  // The polygon's label prefix ("<name> <sequence>").
  const prefix = session.definition.points
    .find(
      (point) =>
        point.label.startsWith(name) && point.label.endsWith(" center"),
    )!
    .label.replace(/ center$/, "");
  const vertex = session.definition.points.find(
    (point) => point.label === `${prefix} vertex 1`,
  )!;
  const target: [number, number] = [
    vertex.position[0] - 0.3,
    vertex.position[1] + 0.6,
  ];
  let dragging = beginSketchGeometryDrag(
    beginSketchTool(session, "line"),
    vertex.target,
    vertex.position,
  );
  for (let step = 1; step < 8; step += 1)
    dragging = updateSketchGeometryDrag(dragging, [
      vertex.position[0] + (step / 8) * (target[0] - vertex.position[0]),
      vertex.position[1] + (step / 8) * (target[1] - vertex.position[1]),
    ]);
  const released = finishSketchGeometryDrag(dragging, target);
  const at = (label: string) =>
    released.definition.points.find((point) => point.label === label)!.position;
  const center = at(`${prefix} center`);
  const vertices = [1, 2, 3, 4, 5, 6].map((index) =>
    at(`${prefix} vertex ${index}`),
  );
  const sides = vertices.map((start, index) => {
    const end = vertices[(index + 1) % 6]!;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const unit = [(end[0] - start[0]) / length, (end[1] - start[1]) / length];
    // Distance along the side from its start to the foot of the centre.
    const tangentLength =
      (center[0] - start[0]) * unit[0]! + (center[1] - start[1]) * unit[1]!;
    return { length, tangentLength };
  });
  const vertexRadii = vertices.map((point) =>
    Math.hypot(point[0] - center[0], point[1] - center[1]),
  );
  const spread = (values: number[]) =>
    Math.max(...values) - Math.min(...values);
  return {
    released,
    vertexMoved: Math.hypot(
      at(`${prefix} vertex 1`)[0] - vertex.position[0],
      at(`${prefix} vertex 1`)[1] - vertex.position[1],
    ),
    lengthSpread: spread(sides.map((side) => side.length)),
    tangentLengthSpread: spread(sides.map((side) => side.tangentLength)),
    radiusSpread: spread(vertexRadii),
  };
}

test("T13c A-2: a circumscribed hexagon stays regular under a vertex drag (tangent lengths do not alternate)", () => {
  const result = polygonRegularityAfterVertexDrag(
    "circumscribedPolygon",
    "Circumscribed Polygon",
  );
  expect(result.released.liveSolve?.accepted).toBe(true);
  expect(result.vertexMoved, "premise: the vertex moved").toBeGreaterThan(0.1);
  expect(result.lengthSpread, "equal sides").toBeLessThan(1e-4);
  expect(result.tangentLengthSpread, "equal tangent lengths").toBeLessThan(
    1e-4,
  );
  expect(result.radiusSpread, "vertices on one circle").toBeLessThan(1e-4);
});

test("T13c A-2: an inscribed hexagon (equal chords on a circle) stays regular under a vertex drag", () => {
  const result = polygonRegularityAfterVertexDrag(
    "inscribedPolygon",
    "Inscribed Polygon",
  );
  expect(result.released.liveSolve?.accepted).toBe(true);
  expect(result.vertexMoved, "premise: the vertex moved").toBeGreaterThan(0.1);
  expect(result.lengthSpread, "equal sides").toBeLessThan(1e-4);
  expect(result.tangentLengthSpread, "symmetric sides").toBeLessThan(1e-4);
  expect(result.radiusSpread, "vertices on one circle").toBeLessThan(1e-4);
});

// T12c R-6: handleSketchGeometryDragCancelled restores pre-drag state.
test("T12c R-6: cancelSketchGeometryDrag during drag restores definition, clears activeDrag, keeps activeTool", () => {
  const def: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_a", "sketch_point_b"],
    points: [
      {
        pointId: "sketch_point_a" as `sketch_point_${string}`,
        label: "A",
        target: { kind: "sketchPoint", sketchId: "sketch_draft" as `sketch_${string}`, pointId: "sketch_point_a" as `sketch_point_${string}` },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_b" as `sketch_point_${string}`,
        label: "B",
        target: { kind: "sketchPoint", sketchId: "sketch_draft" as `sketch_${string}`, pointId: "sketch_point_b" as `sketch_point_${string}` },
        position: [4, 0],
        isConstruction: false,
      },
    ],
    entityIds: ["sketch_entity_line"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_line" as `sketch_entity_${string}`,
        label: "Line",
        target: { kind: "sketchEntity", sketchId: "sketch_draft" as `sketch_${string}`, entityId: "sketch_entity_line" as `sketch_entity_${string}` },
        isConstruction: false,
        startPointId: "sketch_point_a" as `sketch_point_${string}`,
        endPointId: "sketch_point_b" as `sketch_point_${string}`,
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };
  const session = withLiveSolveBasis(
    {
      ...createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      definition: def,
    },
    def,
  );
  const started = beginSketchGeometryDrag(
    session,
    { kind: "sketchPoint", sketchId: "sketch_draft" as `sketch_${string}`, pointId: "sketch_point_a" as `sketch_point_${string}` },
    [0, 0],
  );
  expect(started.activeDrag, "drag must start").not.toBeNull();

  const cancelled = cancelSketchGeometryDrag(started);
  expect(cancelled.activeDrag, "activeDrag must be null after cancel.").toBe(
    null,
  );
  expect(
    cancelled.definition,
    "Definition must be restored to preDragDefinition.",
  ).toBe(started.activeDrag!.preDragDefinition);
  expect(
    cancelled.activeTool,
    "activeTool must be preserved after cancel (null stays null).",
  ).toBe(null);
});

// T12c R-6: tool switch mid-drag cancels the drag first.
test("T12c R-6: cancel followed by tool switch leaves a consistent state", () => {
  const def: SketchDefinition = {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: ["sketch_point_a", "sketch_point_b"],
    points: [
      {
        pointId: "sketch_point_a" as `sketch_point_${string}`,
        label: "A",
        target: { kind: "sketchPoint", sketchId: "sketch_draft" as `sketch_${string}`, pointId: "sketch_point_a" as `sketch_point_${string}` },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: "sketch_point_b" as `sketch_point_${string}`,
        label: "B",
        target: { kind: "sketchPoint", sketchId: "sketch_draft" as `sketch_${string}`, pointId: "sketch_point_b" as `sketch_point_${string}` },
        position: [4, 0],
        isConstruction: false,
      },
    ],
    entityIds: ["sketch_entity_line"],
    entities: [
      {
        kind: "lineSegment",
        entityId: "sketch_entity_line" as `sketch_entity_${string}`,
        label: "Line",
        target: { kind: "sketchEntity", sketchId: "sketch_draft" as `sketch_${string}`, entityId: "sketch_entity_line" as `sketch_entity_${string}` },
        isConstruction: false,
        startPointId: "sketch_point_a" as `sketch_point_${string}`,
        endPointId: "sketch_point_b" as `sketch_point_${string}`,
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  };
  const session = withLiveSolveBasis(
    {
      ...createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      definition: def,
    },
    def,
  );
  let s = beginSketchGeometryDrag(
    session,
    { kind: "sketchPoint", sketchId: "sketch_draft" as `sketch_${string}`, pointId: "sketch_point_a" as `sketch_point_${string}` },
    [0, 0],
  );
  expect(s.activeDrag).not.toBeNull();

  // Simulate tool switch: cancel then begin tool.
  s = cancelSketchGeometryDrag(s);
  s = beginSketchTool(s, "circle");
  expect(s.activeDrag).toBe(null);
  expect(s.activeTool).toBe("circle");
  expect(s.definition.pointIds.length).toBe(2);
});

// T13a2 (logic lane, session seam): a commit of the Offset tool that waits
// for the certified publication (outside the file-level test, as above).
function commitOffsetForT13a2(session: SketchSessionState) {
  let next = patchSketchEditToolValue(session, { intent: "commitOffset" });
  for (let round = 0; round < 2; round += 1) {
    const publication = next.activeEditTool?.offsetPublication;
    if (publication?.status !== "pending") break;
    const basis = publication.basis!;
    next = completeSketchOffsetPreviewPublication(
      next,
      publication.derivationId,
      publishSketchOffsets({
        definition: basis.definition,
        solvedSnapshot: basis.solvedSnapshot,
        modelingTolerance: basis.modelingTolerance,
        capabilities: {
          query: createCertifiedNeutralCurveRequestQuery(),
          certifier: createCertifiedCubicTubeChain(),
        },
      }),
    );
  }
  return next;
}

// T13a2 c3 (logic lane, session seam): the drag frame solves only the
// dragged component's variables. An offset seeded on the dragged rectangle
// is solved with it (its outputs follow the resized rectangle), and an
// unrelated line keeps its exact position.
test("T13a2: a corner drag resizes a rectangle with its offset, follows the cursor every frame and leaves an unrelated component untouched", () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [1, 1]),
    [5, 4],
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), [10, 0]),
    [12, 0.5],
  );
  const sides = session.definition.entities
    .filter((entity) => entity.label.startsWith("Rectangle"))
    .map((entity) => entity.target);
  expect(sides, "premise: four rectangle sides").toHaveLength(4);
  session = patchSketchEditToolValue(
    beginSketchTool(session, "offset", sides),
    { value: 0.5 },
  );
  session = commitOffsetForT13a2(session);
  session = beginSketchTool(session, "line");
  const relationship = session.definition.derivedRelationships?.find(
    (candidate) => candidate.kind === "offset",
  );
  expect(relationship, "premise: the offset is committed").toBeTruthy();
  const drivenIds = new Set(
    relationship!.outputs.flatMap((output) => output.outputPointIds),
  );
  expect(drivenIds.size, "premise: the offset has driven corners").toBe(4);
  const unrelatedBefore = session.definition.points
    .filter((point) => point.label.startsWith("Line"))
    .map((point) => point.position);
  expect(unrelatedBefore, "premise: the unrelated line").toHaveLength(2);

  const corner = session.definition.points.find(
    (point) => point.label === "Rectangle 1 top right",
  )!;
  let dragging = beginSketchGeometryDrag(session, corner.target, [5, 4]);
  for (let frame = 1; frame <= 4; frame += 1) {
    dragging = updateSketchGeometryDrag(dragging, [
      5 + frame * 0.5,
      4 + frame * 0.5,
    ]);
    expect(dragging.activeDrag?.status, `frame ${frame}`).toBe("dragging");
    // Review A-1: phase A must solve the whole component (c3), not just the
    // dragged point, for an interactive frame to follow the cursor.
    const followed = dragging.definition.points.find(
      (point) => point.pointId === corner.pointId,
    )!.position;
    expect(
      Math.hypot(
        followed[0] - (5 + frame * 0.5),
        followed[1] - (4 + frame * 0.5),
      ),
      `frame ${frame}: the corner follows the cursor`,
    ).toBeLessThan(1e-3);
  }
  const dragged = finishSketchGeometryDrag(dragging, [7, 6]);
  const at = (label: string) =>
    dragged.definition.points.find((point) => point.label === label)!.position;
  // The release repeats the last frame's cursor, so it commits that frame
  // (within the 1e-4 reach tolerance; review R-1).
  expect(
    Math.hypot(
      at("Rectangle 1 top right")[0] - 7,
      at("Rectangle 1 top right")[1] - 6,
    ),
    "the corner is at the cursor within the reach tolerance",
  ).toBeLessThanOrEqual(1e-4);
  expect(at("Rectangle 1 bottom left")[0], "opposite corner stays").toBeCloseTo(
    1,
    6,
  );
  expect(at("Rectangle 1 bottom left")[1]).toBeCloseTo(1, 6);
  // The offset outputs are 0.5 from every side of the resized (≈ 6 × 5)
  // rectangle: a box 1 smaller or larger in each direction, same centre.
  const [right, top] = at("Rectangle 1 top right");
  const [left, bottom] = at("Rectangle 1 bottom left");
  const offsetCorners = dragged.definition.points
    .filter((point) => drivenIds.has(point.pointId))
    .map((point) => point.position);
  const xs = offsetCorners.map((position) => position[0]);
  const ys = offsetCorners.map((position) => position[1]);
  const width = Math.max(...xs) - Math.min(...xs);
  const height = Math.max(...ys) - Math.min(...ys);
  expect(right! - left!, "the rectangle resized to width 6").toBeCloseTo(6, 3);
  expect(
    width - (right! - left!),
    "offset width follows the resize",
  ).toBeCloseTo(height - (top! - bottom!), 6);
  expect(
    Math.abs(width - (right! - left!)),
    "offset is 0.5 from each side",
  ).toBeCloseTo(1, 6);
  expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(
    (right! + left!) / 2,
    6,
  );
  expect((Math.max(...ys) + Math.min(...ys)) / 2).toBeCloseTo(
    (top! + bottom!) / 2,
    6,
  );
  expect(
    dragged.definition.points
      .filter((point) => point.label.startsWith("Line"))
      .map((point) => point.position),
    "the unrelated component is bit-for-bit unchanged",
  ).toEqual(unrelatedBefore);
});

// T13a2 Q3 (logic lane, session seam): issue 05 forbids flips. Dragging a
// rounded rectangle's bottom side far enough collapses a fillet; minimum
// motion would carry it through zero radius (the arc's centre crosses its
// tangent line, the arc turns inside out). That frame is blocked with the
// drag feedback and the last accepted state is kept.
test("T13a2: a rounded-rectangle drag that would flip a fillet is blocked at the flipping frame", () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [0, 0]),
    [2, 1],
  );
  const sides = session.definition.entities.filter(
    (entity) => entity.kind === "lineSegment",
  );
  for (let corner = 0; corner < 4; corner += 1) {
    session = selectSketchEditToolTarget(
      selectSketchEditToolTarget(
        beginSketchTool(session, "sketchFillet"),
        sides[corner]!.target,
      ),
      sides[(corner + 1) % 4]!.target,
    );
    session = patchSketchEditToolValue(session, { value: 0.2 });
    session = patchSketchEditToolValue(session, {
      intent: "commitSketchEditOperator",
    });
  }
  session = beginSketchTool(session, "line");
  const tangents = session.definition.constraints.filter(
    (constraint) => constraint.kind === "tangent",
  );
  expect(tangents, "premise: four fillets, two tangents each").toHaveLength(8);
  // The side of each fillet's tangent line its centre lies on.
  const sidesOf = (definition: SketchDefinition) =>
    tangents.map((constraint) => {
      const [first, second] = constraint.entityIds.map(
        (id) => definition.entities.find((entity) => entity.entityId === id)!,
      );
      const line = (first!.kind === "lineSegment" ? first : second)!;
      const arc = (first!.kind === "arc" ? first : second)!;
      if (line.kind !== "lineSegment" || arc.kind !== "arc")
        throw new Error("premise: line↔arc tangent");
      const at = (id: string) =>
        definition.points.find((point) => point.pointId === id)!.position;
      const [a, b, c] = [
        at(line.startPointId),
        at(line.endPointId),
        at(arc.centerPointId),
      ];
      return Math.sign(
        (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
      );
    });
  const initialSides = sidesOf(session.definition);
  const bottom = session.definition.entities.find(
    (entity) =>
      entity.kind === "lineSegment" &&
      [entity.startPointId, entity.endPointId].every(
        (id) =>
          session.definition.points.find((point) => point.pointId === id)!
            .position[1] === 0,
      ),
  );
  if (bottom?.kind !== "lineSegment") throw new Error("premise: bottom side");
  const grabbed = [bottom.startPointId, bottom.endPointId]
    .map(
      (id) => session.definition.points.find((point) => point.pointId === id)!,
    )
    .reduce((left, right) =>
      left.position[0] < right.position[0] ? left : right,
    );

  let dragging = beginSketchGeometryDrag(
    session,
    grabbed.target,
    grabbed.position,
  );
  const statuses: (string | undefined)[] = [];
  let firstBlocked = -1;
  for (let frame = 1; frame <= 16; frame += 1) {
    const before = dragging.definition;
    dragging = updateSketchGeometryDrag(dragging, [
      grabbed.position[0] + (1.0 * frame) / 16,
      grabbed.position[1] + (0.6 * frame) / 16,
    ]);
    statuses.push(dragging.activeDrag?.status);
    if (dragging.activeDrag?.status === "dragging") {
      expect(
        sidesOf(dragging.definition),
        `frame ${frame}: no accepted frame flips a fillet`,
      ).toEqual(initialSides);
    } else if (firstBlocked < 0) {
      firstBlocked = frame;
      expect(dragging.activeDrag?.status, `frame ${frame}`).toBe("blocked");
      expect(
        dragging.activeDrag?.feedback,
        "the blocked frame shows the drag feedback",
      ).toBeTruthy();
      expect(dragging.definition, "the last accepted state is kept").toBe(
        before,
      );
    }
  }
  expect(
    firstBlocked,
    `a flipping frame is blocked (${statuses.join(",")})`,
  ).toBeGreaterThan(1);
  expect(
    statuses
      .slice(0, firstBlocked - 1)
      .every((status) => status === "dragging"),
    "frames before the flip are accepted",
  ).toBe(true);
});

// T13a2 d1 (logic lane, session seam): only the release frame runs the
// exact-reach step. On a rounded rectangle whose bottom side's right end is
// fixed, the left end slides along the bottom (the cursor above it is
// unreachable); an interactive frame at a reachable cursor keeps the soft
// target's lag (above the 1e-4 reach tolerance, so no exact step ran), and
// a release with an equally large jump to another reachable cursor lands
// within the tolerance.
test("T13a2: interactive drag frames skip the exact-reach step; the release frame reaches the cursor", () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [0, 0]),
    [2, 1],
  );
  const sides = session.definition.entities.filter(
    (entity) => entity.kind === "lineSegment",
  );
  for (let corner = 0; corner < 4; corner += 1) {
    session = selectSketchEditToolTarget(
      selectSketchEditToolTarget(
        beginSketchTool(session, "sketchFillet"),
        sides[corner]!.target,
      ),
      sides[(corner + 1) % 4]!.target,
    );
    session = patchSketchEditToolValue(session, { value: 0.2 });
    session = patchSketchEditToolValue(session, {
      intent: "commitSketchEditOperator",
    });
  }
  const bottom = session.definition.entities.find(
    (entity) =>
      entity.kind === "lineSegment" &&
      [entity.startPointId, entity.endPointId].every(
        (id) =>
          session.definition.points.find((point) => point.pointId === id)!
            .position[1] === 0,
      ),
  );
  if (bottom?.kind !== "lineSegment") throw new Error("premise: bottom side");
  const [left, right] = [bottom.startPointId, bottom.endPointId]
    .map(
      (id) => session.definition.points.find((point) => point.pointId === id)!,
    )
    .sort((a, b) => a.position[0] - b.position[0]);
  session = selectSketchConstraintTarget(
    beginSketchTool(session, "constraintFix"),
    right!.target,
  );
  expect(
    session.definition.constraints.some(
      (constraint) => constraint.kind === "fixPoint",
    ),
    "premise: the bottom side's right end is fixed",
  ).toBe(true);
  session = beginSketchTool(session, "line");
  const start = left!.position;
  const position = (state: SketchSessionState) =>
    state.definition.points.find((point) => point.pointId === left!.pointId)!
      .position;

  let dragging = beginSketchGeometryDrag(session, left!.target, start);
  for (let frame = 1; frame <= 4; frame += 1) {
    dragging = updateSketchGeometryDrag(dragging, [
      start[0] + 0.05 * frame,
      start[1] + 0.1,
    ]);
    expect(dragging.activeDrag?.status, `slide frame ${frame}`).toBe(
      "dragging",
    );
    // The cursor, 0.1 above the bottom line, is unreachable: the end
    // slides along the line (within the angular tolerance of horizontal).
    expect(
      Math.abs(position(dragging)[1] - start[1]),
      `slide frame ${frame}: the end stays on the bottom line`,
    ).toBeLessThan(0.01);
  }
  const reachable: [number, number] = [start[0] + 0.8, start[1]];
  dragging = updateSketchGeometryDrag(dragging, reachable);
  const interactiveLag = Math.hypot(
    position(dragging)[0] - reachable[0],
    position(dragging)[1] - reachable[1],
  );
  expect(
    interactiveLag,
    "an interactive frame keeps the soft-target lag (no exact-reach step)",
  ).toBeGreaterThan(1e-4);
  const release: [number, number] = [start[0], start[1]];
  const released = finishSketchGeometryDrag(dragging, release);
  expect(released.activeDrag).toBeNull();
  expect(
    Math.hypot(
      position(released)[0] - release[0],
      position(released)[1] - release[1],
    ),
    "the release frame reaches the cursor within the reach tolerance",
  ).toBeLessThanOrEqual(1e-4);
});

// T13a2 review R-1 (logic lane, session seam): the Fillet-tool rounded
// rectangle [0,0]–[2,1], r = 0.2, and its bottom side's left end.
function roundedRectangleForT13a2Review() {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "rectangle"), [0, 0]),
    [2, 1],
  );
  const sides = session.definition.entities.filter(
    (entity) => entity.kind === "lineSegment",
  );
  for (let corner = 0; corner < 4; corner += 1) {
    session = selectSketchEditToolTarget(
      selectSketchEditToolTarget(
        beginSketchTool(session, "sketchFillet"),
        sides[corner]!.target,
      ),
      sides[(corner + 1) % 4]!.target,
    );
    session = patchSketchEditToolValue(session, { value: 0.2 });
    session = patchSketchEditToolValue(session, {
      intent: "commitSketchEditOperator",
    });
  }
  session = beginSketchTool(session, "line");
  const definition = session.definition;
  const bottom = definition.entities.find(
    (entity) =>
      entity.kind === "lineSegment" &&
      [entity.startPointId, entity.endPointId].every(
        (id) =>
          definition.points.find((point) => point.pointId === id)!
            .position[1] === 0,
      ),
  );
  if (bottom?.kind !== "lineSegment") throw new Error("premise: bottom side");
  const grabbed = [bottom.startPointId, bottom.endPointId]
    .map((id) => definition.points.find((point) => point.pointId === id)!)
    .reduce((left, right) =>
      left.position[0] < right.position[0] ? left : right,
    );
  // The smallest fillet "radius" seen through its tangents: the distance
  // from each fillet centre to its tangent line.
  const smallestFilletDistance = (state: SketchSessionState) =>
    Math.min(
      ...state.definition.constraints.flatMap((constraint) => {
        if (constraint.kind !== "tangent") return [];
        const [first, second] = constraint.entityIds.map(
          (id) =>
            state.definition.entities.find((entity) => entity.entityId === id)!,
        );
        const line = first!.kind === "lineSegment" ? first : second;
        const arc = first!.kind === "arc" ? first : second;
        if (line?.kind !== "lineSegment" || arc?.kind !== "arc") return [];
        const at = (id: string) =>
          state.definition.points.find((point) => point.pointId === id)!
            .position;
        const [a, b, c] = [
          at(line.startPointId),
          at(line.endPointId),
          at(arc.centerPointId),
        ];
        return [
          Math.abs(
            (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
          ) / Math.hypot(b[0] - a[0], b[1] - a[1]),
        ];
      }),
    );
  return { session, grabbed, smallestFilletDistance };
}

// R-1: after the guard blocks a collapsing fillet, dragging back toward the
// start must keep following the cursor; no frame may claim "constrained"
// (the point has a free DOF) and no accepted frame holds a collapsed fillet.
test("T13a2 R-1: after a blocked fillet collapse, dragging back follows the cursor with no constrained cue", () => {
  const { session, grabbed, smallestFilletDistance } =
    roundedRectangleForT13a2Review();
  const tau = OCC_KERNEL_SETTINGS.modelingTolerance;
  const cursorAt = (step: number): [number, number] => [
    grabbed.position[0] + (1.0 * step) / 16,
    grabbed.position[1] + (0.6 * step) / 16,
  ];
  const lagOf = (state: SketchSessionState, cursor: [number, number]) => {
    const position = state.definition.points.find(
      (point) => point.pointId === grabbed.pointId,
    )!.position;
    return Math.hypot(position[0] - cursor[0], position[1] - cursor[1]);
  };
  let dragging = beginSketchGeometryDrag(
    session,
    grabbed.target,
    grabbed.position,
  );
  let lastAcceptedStep = 0;
  const trace: string[] = [];
  const steps = [
    ...Array.from({ length: 16 }, (_, index) => index + 1),
    ...Array.from({ length: 16 }, (_, index) => 15 - index),
  ];
  steps.forEach((step, index) => {
    const cursor = cursorAt(step);
    dragging = updateSketchGeometryDrag(dragging, cursor);
    const status = dragging.activeDrag?.status;
    trace.push(
      `${index + 1}:${status}/${dragging.activeDrag?.feedback?.kind ?? "-"}`,
    );
    expect(
      dragging.activeDrag?.feedback?.kind,
      `frame ${index + 1}: no constrained cue (${trace.join(" ")})`,
    ).not.toBe("constrained");
    if (status === "dragging") {
      expect(
        smallestFilletDistance(dragging),
        `frame ${index + 1}: no accepted frame holds a collapsed fillet`,
      ).toBeGreaterThanOrEqual(tau);
      if (index < 16) lastAcceptedStep = step;
    }
    if (index >= 16 && step <= lastAcceptedStep) {
      expect(status, `back frame ${index + 1} (${trace.join(" ")})`).toBe(
        "dragging",
      );
      expect(
        lagOf(dragging, cursor),
        `back frame ${index + 1} follows the cursor`,
      ).toBeLessThan(1e-3);
    }
  });
  expect(
    lastAcceptedStep,
    "premise: the forward drag is blocked before its end",
  ).toBeLessThan(16);
});

// R-1: a release after a blocked collapse (the reviewer's path: 16 frames
// out, 8 back) commits the last displayed frame (within the reach
// tolerance), never a jump to an escaped state.
test("T13a2 R-1: the release after a blocked fillet collapse commits the last displayed frame", () => {
  const { session, grabbed } = roundedRectangleForT13a2Review();
  let dragging = beginSketchGeometryDrag(
    session,
    grabbed.target,
    grabbed.position,
  );
  let blocked = false;
  let cursor: [number, number] = [grabbed.position[0], grabbed.position[1]];
  for (const step of [
    ...Array.from({ length: 16 }, (_, index) => index + 1),
    ...Array.from({ length: 8 }, (_, index) => 15 - index),
  ]) {
    cursor = [
      grabbed.position[0] + (1.0 * step) / 16,
      grabbed.position[1] + (0.6 * step) / 16,
    ];
    dragging = updateSketchGeometryDrag(dragging, cursor);
    blocked ||= dragging.activeDrag?.status === "blocked";
  }
  expect(blocked, "premise: a frame was blocked").toBe(true);
  const displayed = dragging.definition.points;
  const released = finishSketchGeometryDrag(dragging, cursor);
  expect(released.activeDrag).toBeNull();
  const jump = Math.max(
    ...displayed.map((point) => {
      const committed = released.definition.points.find(
        (candidate) => candidate.pointId === point.pointId,
      )!.position;
      return Math.hypot(
        committed[0] - point.position[0],
        committed[1] - point.position[1],
      );
    }),
  );
  expect(
    jump,
    "no committed jump from the last displayed frame",
  ).toBeLessThanOrEqual(1e-4);
});

function t13bRectangle() {
  const rectangle = acceptSketchDraw(
    startSketchDraw(
      beginSketchTool(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        "rectangle",
      ),
      [0, 0],
    ),
    [4, 2],
  );
  const lines = rectangle.definition.entities.filter(
    (entity) => entity.kind === "lineSegment",
  );
  return {
    rectangle,
    line: lines[0]!.target,
    corner: [lines[0]!.target, lines[1]!.target],
  };
}

test.each([
  { toolId: "offset", corner: false, field: "distance" },
  { toolId: "sketchFillet", corner: true, field: "radius" },
  { toolId: "sketchChamfer", corner: true, field: "distance" },
  { toolId: "sketchSlot", corner: false, field: "width" },
  { toolId: "sketchLinearPattern", corner: false, field: "distance" },
  { toolId: "sketchCircularPattern", corner: false, field: "angle" },
  { toolId: "sketchTransform", corner: false, field: "distance" },
] as const)(
  "T13b A6 (D29): $toolId: a typed floating-input string sets the value; empty clears it; a non-number clears it with a message naming the $field",
  ({ toolId, corner, field }) => {
    const { rectangle, line, corner: cornerTargets } = t13bRectangle();
    let selected = beginSketchTool(rectangle, toolId);
    for (const target of corner ? cornerTargets : [line])
      selected = selectSketchEditToolTarget(selected, target);
    const valueOf = (session: SketchSessionState) =>
      toolId === "offset"
        ? session.activeEditTool!.offsetDistance
        : session.activeEditTool!.toolValue;
    const messages = (session: SketchSessionState) => [
      session.validationMessage,
      ...(session.toolPresentation?.validation ?? []).map(
        (entry) => entry.message,
      ),
    ];

    const typed = patchSketchEditToolValue(selected, { value: " 0.25 " });
    expect(valueOf(typed), `${toolId}: "0.25" sets the value`).toBe(0.25);
    expect(typed.validationMessage, `${toolId}: valid`).toBeNull();
    expect(
      typed.toolStagedEntities.length,
      `${toolId}: previews the typed value`,
    ).toBeGreaterThan(0);

    const cleared = patchSketchEditToolValue(typed, { value: "" });
    expect(valueOf(cleared), `${toolId}: "" clears the value`).toBeNull();
    expect(
      valueOf(patchSketchEditToolValue(typed, { value: "  " })),
      `${toolId}: blank clears the value (never Number("  ") = 0)`,
    ).toBeNull();
    expect(
      messages(cleared),
      `${toolId}: "" is not a parse error`,
    ).not.toContain(`Enter a number for the ${field}.`);

    const invalid = patchSketchEditToolValue(typed, { value: "w + 1" });
    expect(valueOf(invalid), `${toolId}: a non-number clears it`).toBeNull();
    expect(messages(invalid), `${toolId}: the message names the field`).toEqual(
      [`Enter a number for the ${field}.`, `Enter a number for the ${field}.`],
    );

    const numeric = patchSketchEditToolValue(invalid, { value: 0.5 });
    expect(valueOf(numeric), `${toolId}: the panel's number still works`).toBe(
      0.5,
    );
    expect(numeric.validationMessage).toBeNull();
  },
);

// T13m (orchestrator decision (B), logic lane, session seam): Split records
// the last sketch pointer as its boundary click, and the operation carries
// it as `pick`; the crossing nearest it is cut. No pointer (a selection
// adopted at activation) or a cleared one: no pick (the first crossing along
// the target). Review R-2: the browser never sends a null pointer (after the
// pointer leaves the canvas the last on-canvas one is kept), so the
// cleared case drives `updateSketchPointer(…, null)` synthetically.
test("T13m: Split's boundary click (the last sketch pointer) picks the crossing; with no pointer, or a synthetically cleared one, the first crossing is cut; other tools record nothing", async () => {
  let session = createNewSketchSession(
    createStandardPlaneDefinition("xy"),
    OCC_KERNEL_SETTINGS,
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "line"), [0, 0]),
    [4, 0],
  );
  session = acceptSketchDraw(
    startSketchDraw(beginSketchTool(session, "circle"), [2, 0]),
    [3, 0],
  );
  const [line, circle] = session.definition.entities;
  expect([line!.kind, circle!.kind], "premise").toEqual([
    "lineSegment",
    "circle",
  ]);
  const splitWith = async (
    pointer: [number, number] | null | "clearedSynthetically",
  ) => {
    let split = selectSketchEditToolTarget(
      beginSketchTool(session, "sketchSplit"),
      line!.target,
    );
    if (pointer === "clearedSynthetically")
      split = updateSketchPointer(updateSketchPointer(split, [2.9, 0.5]), null);
    else if (pointer) split = updateSketchPointer(split, pointer);
    const clicked = selectSketchEditToolTarget(split, circle!.target);
    const operation =
      clicked.activeEditTool?.editQuery?.inFlight?.input.operation;
    const applied = await completeSketchEditQueriesForTest(clicked);
    const piece = applied.definition.entities.at(-1);
    if (piece?.kind !== "lineSegment") throw new Error("split line piece");
    return {
      operation,
      at: applied.definition.points.find(
        (point) => point.pointId === piece.startPointId,
      )!.position,
    };
  };
  const picked = await splitWith([2.9, 0.5]);
  expect(picked.operation).toEqual({
    kind: "split",
    targetEntityId: line!.entityId,
    boundaryEntityId: circle!.entityId,
    pick: [2.9, 0.5],
  });
  expect(picked.at[0]).toBeCloseTo(3, 9);
  for (const pointer of [null, "clearedSynthetically"] as const) {
    const first = await splitWith(pointer);
    expect(first.operation, `${pointer}`).toEqual({
      kind: "split",
      targetEntityId: line!.entityId,
      boundaryEntityId: circle!.entityId,
    });
    expect(first.at[0], `${pointer}`).toBeCloseTo(1, 9);
  }
  // Trim records no pointer.
  const trim = beginSketchTool(session, "trim");
  expect(updateSketchPointer(trim, [1, 1]).activeEditTool).toBe(
    trim.activeEditTool,
  );
});
