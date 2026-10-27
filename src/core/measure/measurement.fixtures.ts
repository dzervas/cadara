import type {
  WorkspaceSnapshot,
  SnapshotEntityRecord,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { createStandardPlaneDefinition } from "@/core/modeling/opencascade-kernel-seed";
import { lineLoopSegmentsForTest } from "@/contracts/sketch/region-record.fixtures";
import type {
  EdgeId,
  FaceId,
  SketchEntityId,
  SketchPointId,
  VertexId,
} from "@/contracts/shared/ids";
import type {
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { reconstructSplineAggregate } from "@/contracts/sketch/spline-geometry";
import { getPrimitiveRefLabel } from "@/core/editor/schema";

/** The fixture's authored spline (its solved record reconstructs it from the authored points). */
const MEASUREMENT_SPLINE: Extract<SketchEntityDefinition, { kind: "spline" }> =
  {
    kind: "spline",
    entityId: "sketch_entity_spline_primary",
    label: "Spline 1",
    target: {
      kind: "sketchEntity",
      sketchId: "sketch_measure",
      entityId: "sketch_entity_spline_primary",
    },
    isConstruction: false,
    pointOccurrenceIds: ["occ-a", "occ-b", "occ-c"],
    pointOccurrences: [
      {
        occurrenceId: "occ-a",
        pointId: "sketch_point_spline_a",
        tangent: { kind: "automatic" },
      },
      {
        occurrenceId: "occ-b",
        pointId: "sketch_point_spline_b",
        tangent: { kind: "automatic" },
      },
      {
        occurrenceId: "occ-c",
        pointId: "sketch_point_spline_c",
        tangent: { kind: "automatic" },
      },
    ],
    closure: "open",
    interpolationPolicy: "centripetal-mean-arm-v1",
  };

/** The fixture spline's authored fit points. */
const MEASUREMENT_SPLINE_POINTS = {
  sketch_point_spline_a: [16, 0],
  sketch_point_spline_b: [17.5, 2],
  sketch_point_spline_c: [19, 0],
} satisfies Record<SketchPointId, SketchPoint2D>;

/**
 * The measurement specs' shared workspace snapshot: body "Body A" (faces,
 * edges, a vertex) and sketch "sketch_measure" (line, circle, arc, spline,
 * region, points).
 */
export function createMeasurementSnapshotForTest(): WorkspaceSnapshot {
  const plane = createStandardPlaneDefinition("xy");
  const entities: SnapshotEntityRecord[] = [
    createEntity(
      "body_measure",
      "Body A",
      { kind: "body", bodyId: "body_measure" },
      ["body"],
    ),
    createEntity(
      "face_top",
      "Top face",
      { kind: "face", bodyId: "body_measure", faceId: "face_top" },
      ["face", "planarFace"],
    ),
    createEntity(
      "face_bottom",
      "Bottom face",
      { kind: "face", bodyId: "body_measure", faceId: "face_bottom" },
      ["face"],
    ),
    createEntity(
      "edge_top_front",
      "Top front edge",
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" },
      ["edge"],
    ),
    createEntity(
      "edge_top_back",
      "Top back edge",
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_back" },
      ["edge"],
    ),
    createEntity(
      "edge_top_left",
      "Top left edge",
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_left" },
      ["edge"],
    ),
    createEntity(
      "vertex_top_front_left",
      "Top front left vertex",
      {
        kind: "vertex",
        bodyId: "body_measure",
        vertexId: "vertex_top_front_left",
      },
      ["vertex"],
    ),
    createEntity(
      "region_measure",
      "Profile region",
      {
        kind: "region",
        sketchId: "sketch_measure",
        regionId: "region_measure",
      },
      ["face"],
    ),
    createEntity(
      "sketch_entity_line_bottom",
      "Rectangle bottom",
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_line_bottom",
      },
      ["sketchEntity"],
    ),
    createEntity(
      "sketch_entity_circle_primary",
      "Circle 1",
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_circle_primary",
      },
      ["sketchEntity"],
    ),
    createEntity(
      "sketch_entity_arc_primary",
      "Arc 1",
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_arc_primary",
      },
      ["sketchEntity"],
    ),
    createEntity(
      "sketch_entity_spline_primary",
      "Spline 1",
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "sketch_entity_spline_primary",
      },
      ["sketchEntity"],
    ),
  ];

  const renderRecords: RenderableEntityRecord[] = [
    createFaceRenderable("face_top", [
      [0, 0, 5],
      [4, 0, 5],
      [4, 3, 5],
      [0, 3, 5],
    ]),
    createFaceRenderable(
      "face_bottom",
      [
        [0, 0, 0],
        [4, 0, 0],
        [4, 3, 0],
        [0, 3, 0],
      ],
      false,
    ),
    createVerticalFaceRenderable("face_front", [
      [0, 0, 0],
      [4, 0, 0],
      [4, 0, 5],
      [0, 0, 5],
    ]),
    createVerticalFaceRenderable("face_back", [
      [0, 3, 0],
      [4, 3, 0],
      [4, 3, 5],
      [0, 3, 5],
    ]),
    createVerticalFaceRenderable("face_left", [
      [0, 0, 0],
      [0, 3, 0],
      [0, 3, 5],
      [0, 0, 5],
    ]),
    createVerticalFaceRenderable("face_right", [
      [4, 0, 0],
      [4, 3, 0],
      [4, 3, 5],
      [4, 0, 5],
    ]),
    createEdgeRenderable("edge_top_front", [
      [0, 0, 5],
      [4, 0, 5],
    ]),
    createEdgeRenderable("edge_top_back", [
      [0, 3, 5],
      [4, 3, 5],
    ]),
    createEdgeRenderable("edge_top_left", [
      [0, 0, 5],
      [0, 3, 5],
    ]),
    createVertexRenderable("vertex_top_front_left", [0, 0, 5]),
  ];

  const sketch: SketchSnapshotRecord = {
    ownerDocumentId: "doc_measure",
    ownerRevisionId: "rev_measure",
    ownerFeatureId: null,
    ownerSketchId: "sketch_measure",
    ownerBodyId: null,
    sketchId: "sketch_measure",
    label: "Measure Sketch",
    plane,
    sketch: {
      ownerDocumentId: "doc_measure",
      ownerRevisionId: "rev_measure",
      ownerFeatureId: null,
      ownerSketchId: "sketch_measure",
      ownerBodyId: null,
      sketchId: "sketch_measure",
      label: "Measure Sketch",
      planeSupport: plane.support,
      definition: {
        schemaVersion: "sketch-definition/v1alpha2",
        referenceIds: ["ref_projected_circle"],
        references: [],
        pointIds: [
          "sketch_point_rect_a",
          "sketch_point_rect_b",
          "sketch_point_rect_c",
          "sketch_point_rect_d",
          "sketch_point_circle_center",
          "sketch_point_arc_center",
          "sketch_point_arc_start",
          "sketch_point_arc_end",
          "sketch_point_spline_a",
          "sketch_point_spline_b",
          "sketch_point_spline_c",
          "sketch_point_probe",
          "sketch_point_arc_probe",
        ],
        points: [
          createPoint("sketch_point_rect_a", [0, 0]),
          createPoint("sketch_point_rect_b", [4, 0]),
          createPoint("sketch_point_rect_c", [4, 3]),
          createPoint("sketch_point_rect_d", [0, 3]),
          createPoint("sketch_point_circle_center", [8, 1.5]),
          createPoint("sketch_point_arc_center", [12, 1.5]),
          createPoint("sketch_point_arc_start", [13, 1.5]),
          createPoint("sketch_point_arc_end", [12, 2.5]),
          createPoint("sketch_point_spline_a", [16, 0]),
          createPoint("sketch_point_spline_b", [17.5, 2]),
          createPoint("sketch_point_spline_c", [19, 0]),
          createPoint("sketch_point_probe", [16.4, 1.3]),
          createPoint("sketch_point_arc_probe", [13.8, 0.4]),
        ],
        entityIds: [
          "sketch_entity_line_bottom",
          "sketch_entity_line_right",
          "sketch_entity_line_top",
          "sketch_entity_line_left",
          "sketch_entity_circle_primary",
          "sketch_entity_arc_primary",
          "sketch_entity_arc_clockwise",
          "sketch_entity_spline_primary",
        ],
        entities: [
          {
            kind: "lineSegment",
            entityId: "sketch_entity_line_bottom",
            label: "Rectangle bottom",
            target: {
              kind: "sketchEntity",
              sketchId: "sketch_measure",
              entityId: "sketch_entity_line_bottom",
            },
            isConstruction: false,
            startPointId: "sketch_point_rect_a",
            endPointId: "sketch_point_rect_b",
          },
          createLine(
            "sketch_entity_line_right",
            "sketch_point_rect_b",
            "sketch_point_rect_c",
          ),
          createLine(
            "sketch_entity_line_top",
            "sketch_point_rect_c",
            "sketch_point_rect_d",
          ),
          createLine(
            "sketch_entity_line_left",
            "sketch_point_rect_d",
            "sketch_point_rect_a",
          ),
          {
            kind: "circle",
            entityId: "sketch_entity_circle_primary",
            label: "Circle 1",
            target: {
              kind: "sketchEntity",
              sketchId: "sketch_measure",
              entityId: "sketch_entity_circle_primary",
            },
            isConstruction: false,
            centerPointId: "sketch_point_circle_center",
            radius: 1.25,
          },
          {
            kind: "arc",
            entityId: "sketch_entity_arc_primary",
            label: "Arc 1",
            target: {
              kind: "sketchEntity",
              sketchId: "sketch_measure",
              entityId: "sketch_entity_arc_primary",
            },
            isConstruction: false,
            centerPointId: "sketch_point_arc_center",
            startPointId: "sketch_point_arc_start",
            endPointId: "sketch_point_arc_end",
            sweepDirection: "counterClockwise",
          },
          {
            // The same quarter arc authored clockwise (review A-3).
            kind: "arc",
            entityId: "sketch_entity_arc_clockwise",
            label: "Arc CW",
            target: {
              kind: "sketchEntity",
              sketchId: "sketch_measure",
              entityId: "sketch_entity_arc_clockwise",
            },
            isConstruction: false,
            centerPointId: "sketch_point_arc_center",
            startPointId: "sketch_point_arc_end",
            endPointId: "sketch_point_arc_start",
            sweepDirection: "clockwise",
          },
          MEASUREMENT_SPLINE,
        ],
        constraintIds: [],
        constraints: [],
        dimensionIds: [],
        dimensions: [],
      },
      solvedSnapshot: {
        schemaVersion: "solved-sketch/v1alpha2",
        status: { solveState: "solved", constraintState: "underConstrained" },
        // The region's boundary lines, as solved (T10e: regions resolve
        // against the record's own solved pair).
        solvedEntities: [
          createSolvedLine("sketch_entity_line_bottom", [0, 0], [4, 0]),
          createSolvedLine("sketch_entity_line_right", [4, 0], [4, 3]),
          createSolvedLine("sketch_entity_line_top", [4, 3], [0, 3]),
          createSolvedLine("sketch_entity_line_left", [0, 3], [0, 0]),
          {
            entityId: "sketch_entity_spline_primary",
            kind: "spline",
            reconstruction: reconstructSplineAggregate(
              MEASUREMENT_SPLINE,
              MEASUREMENT_SPLINE_POINTS,
            ),
          },
        ],
        solvedPoints: [],
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      derivedValidity: { state: "current", diagnostics: [] },
      projectedReferences: [
        {
          referenceId: "ref_projected_circle",
          status: "projected",
          diagnostics: [],
          geometry: [
            {
              geometryId: "projected_geometry_circle",
              kind: "circle",
              centerPosition: [22, 1.5],
              radius: 1,
            },
          ],
        },
      ],
      regions: [
        {
          regionId: "region_measure",
          signature: "measurement-rectangle",
          ownerDocumentId: "doc_measure",
          ownerRevisionId: "rev_measure",
          ownerFeatureId: null,
          ownerSketchId: "sketch_measure",
          ownerBodyId: null,
          label: "Profile region",
          target: {
            kind: "region",
            sketchId: "sketch_measure",
            regionId: "region_measure",
          },
          sourceSketch: { kind: "sketch", sketchId: "sketch_measure" },
          isClosed: true,
          loops: [
            {
              loopId: "region_loop_outer",
              role: "outer",
              orientation: "counterClockwise",
              isClosed: true,
              segments: lineLoopSegmentsForTest(
                [
                  { pointId: "sketch_point_rect_a", position: [0, 0] },
                  { pointId: "sketch_point_rect_b", position: [4, 0] },
                  { pointId: "sketch_point_rect_c", position: [4, 3] },
                  { pointId: "sketch_point_rect_d", position: [0, 3] },
                ],
                [
                  "sketch_entity_line_bottom",
                  "sketch_entity_line_right",
                  "sketch_entity_line_top",
                  "sketch_entity_line_left",
                ],
              ),
            },
          ],
        },
      ],
    },
  };

  const snapshot = {
    provenance: null,
    document: {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: "doc_measure",
      name: "Measurement fixture",
      revisionId: "rev_measure",
      settings: {
        linearUnit: "millimeter" as const,
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.0001,
      },
      capabilities: {
        supportedFeatureKinds: ["extrude"],
        previewableFeatureKinds: ["extrude"],
        supportedProfileKinds: ["region", "face"],
        supportsFaceBackedSketchPlanes: true,
        supportsDurableTopologyNaming: true,
      },
      featureTree: [],
      objects: [],
      features: [],
      cursor: { kind: "empty" as const },
      sketches: [sketch],
      bodies: [
        {
          ownerDocumentId: "doc_measure",
          ownerRevisionId: "rev_measure",
          ownerFeatureId: "feature_body",
          ownerSketchId: null,
          ownerBodyId: "body_measure",
          bodyId: "body_measure",
          label: "Body A",
          bodyKind: "solid",
          appearance: { kind: "palette", slot: 0 },
          topology: {
            faceIds: [
              "face_top",
              "face_bottom",
              "face_front",
              "face_back",
              "face_left",
              "face_right",
            ],
            edgeIds: ["edge_top_front", "edge_top_back", "edge_top_left"],
            vertexIds: ["vertex_top_front_left"],
          },
        },
      ],
      constructions: [],
      variables: [],
      entities,
      references: [],
      diagnostics: [],
      render: {
        schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
        records: renderRecords,
      },
    },
    presentation: {
      featureTree: [],
      objects: [],
      documentHistory: [],
      entities,
    },
  } satisfies WorkspaceSnapshot;

  return snapshot;
}

function createEntity(
  id: string,
  label: string,
  target: SnapshotEntityRecord["target"],
  selectionSemantics: SnapshotEntityRecord["selectionSemantics"],
): SnapshotEntityRecord {
  return {
    ownerDocumentId: "doc_measure",
    ownerRevisionId: "rev_measure",
    ownerFeatureId: null,
    ownerSketchId: "sketchId" in target ? target.sketchId : null,
    ownerBodyId: "bodyId" in target ? target.bodyId : null,
    id: `snapshot_entity_${id}`,
    label,
    target,
    relatedTargets: [],
    contributingFeatureIds: [],
    consumedByFeatureIds: [],
    selectionSemantics,
  };
}

function createLine(
  entityId: SketchEntityId,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
): Extract<SketchEntityDefinition, { kind: "lineSegment" }> {
  return {
    kind: "lineSegment" as const,
    entityId,
    label: entityId,
    target: {
      kind: "sketchEntity" as const,
      sketchId: "sketch_measure",
      entityId,
    },
    isConstruction: false,
    startPointId,
    endPointId,
  };
}

function createSolvedLine(
  entityId: SketchEntityId,
  startPosition: readonly [number, number],
  endPosition: readonly [number, number],
): Extract<
  SolvedSketchSnapshot["solvedEntities"][number],
  { kind: "lineSegment" }
> {
  return {
    entityId,
    kind: "lineSegment" as const,
    startPosition,
    endPosition,
  };
}

function createPoint(
  pointId: SketchPointId,
  position: SketchPoint2D,
): SketchPointDefinition {
  return {
    pointId,
    label: pointId,
    target: {
      kind: "sketchPoint" as const,
      sketchId: "sketch_measure",
      pointId,
    },
    position,
    isConstruction: false,
  };
}

function createFaceRenderable(
  faceId: FaceId,
  points: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
  top = true,
): RenderableEntityRecord {
  return {
    id: `renderable_${faceId}`,
    label: faceId,
    ownerBodyId: "body_measure",
    ownerFeatureId: "feature_body",
    binding: {
      pickId: `pick_${faceId}`,
      pickPriority: 10,
      target: { kind: "face", bodyId: "body_measure", faceId },
      topology: "face",
      semanticClass: top ? "planarFace" : "bodyFace",
    },
    geometry: {
      kind: "mesh",
      vertexPositions: [...points],
      vertexNormals: null,
      triangleIndices: [
        [0, 1, 2],
        [0, 2, 3],
      ],
    },
  };
}

function createVerticalFaceRenderable(
  faceId: FaceId,
  points: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
    readonly [number, number, number],
  ],
): RenderableEntityRecord {
  return createFaceRenderable(faceId, points, false);
}

function createEdgeRenderable(
  edgeId: EdgeId,
  points: readonly [
    readonly [number, number, number],
    readonly [number, number, number],
  ],
): RenderableEntityRecord {
  return {
    id: `renderable_${edgeId}`,
    label: edgeId,
    ownerBodyId: "body_measure",
    ownerFeatureId: "feature_body",
    binding: {
      pickId: `pick_${edgeId}`,
      pickPriority: 5,
      target: { kind: "edge", bodyId: "body_measure", edgeId },
      topology: "edge",
      semanticClass: "featureEdge",
    },
    geometry: {
      kind: "polyline",
      points: [...points],
      isClosed: false,
    },
  };
}

function createVertexRenderable(
  vertexId: VertexId,
  position: readonly [number, number, number],
): RenderableEntityRecord {
  return {
    id: `renderable_${vertexId}`,
    label: vertexId,
    ownerBodyId: "body_measure",
    ownerFeatureId: "feature_body",
    binding: {
      pickId: `pick_${vertexId}`,
      pickPriority: 4,
      target: { kind: "vertex", bodyId: "body_measure", vertexId },
      topology: "vertex",
      semanticClass: "featureVertex",
    },
    geometry: {
      kind: "marker",
      position,
      displayRadius: 0.12,
    },
  };
}

/**
 * The shared snapshot with every presentation label replaced by its target's
 * durable id, as OCC presentation labels embed topology ids ("<body>
 * <faceId>"): a readout that names targets by presentation label shows ids.
 */
export function createIdLabelledMeasurementSnapshotForTest(): WorkspaceSnapshot {
  const snapshot = createMeasurementSnapshotForTest();
  return {
    ...snapshot,
    presentation: {
      ...snapshot.presentation,
      entities: snapshot.presentation.entities.map((entity) => ({
        ...entity,
        label: getPrimitiveRefLabel(entity.target),
      })),
    },
  };
}
