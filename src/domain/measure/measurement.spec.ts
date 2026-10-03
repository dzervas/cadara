import { test, expect } from "vitest";

import type {
  WorkspaceSnapshot,
  SnapshotEntityRecord,
} from "@/contracts/modeling/schema";
import type { RenderableEntityRecord } from "@/contracts/render/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  deriveMeasurementViewModel,
  isMeasureSelectableTarget,
  resolveMeasureSelectionCandidate,
} from "@/domain/measure/measurement";
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";
import { lineLoopSegmentsForTest } from "@/contracts/sketch/region-record.fixtures";
import {
  reconstructSplineAggregate,
  type SplinePoles,
} from "@/contracts/sketch/spline-geometry";

test("src/domain/measure/measurement.spec.ts", () => {
  function createMeasurementSnapshot(): WorkspaceSnapshot {
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
        "line_bottom",
        "Rectangle bottom",
        {
          kind: "sketchEntity",
          sketchId: "sketch_measure",
          entityId: "line_bottom",
        },
        ["sketchEntity"],
      ),
      createEntity(
        "circle_primary",
        "Circle 1",
        {
          kind: "sketchEntity",
          sketchId: "sketch_measure",
          entityId: "circle_primary",
        },
        ["sketchEntity"],
      ),
      createEntity(
        "arc_primary",
        "Arc 1",
        {
          kind: "sketchEntity",
          sketchId: "sketch_measure",
          entityId: "arc_primary",
        },
        ["sketchEntity"],
      ),
      createEntity(
        "spline_primary",
        "Spline 1",
        {
          kind: "sketchEntity",
          sketchId: "sketch_measure",
          entityId: "spline_primary",
        },
        ["sketchEntity"],
      ),
      createEntity(
        "projected_circle",
        "Projected circle",
        {
          kind: "projectedReferenceGeometry",
          referenceId: "reference_projected_circle",
          geometryId: "projected_circle",
          geometryKind: "circle",
        },
        ["projectedReferenceGeometry"],
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

    const sketch = {
      ownerDocumentId: "doc_measure",
      ownerRevisionId: "rev_measure",
      ownerFeatureId: null,
      ownerSketchId: "sketch_measure",
      ownerBodyId: null,
      sketchId: "sketch_measure",
      label: "Measure Sketch",
      plane,
      planeTarget: plane.support,
      planeKey: "xy" as const,
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
          referenceIds: ["reference_projected_circle"],
          references: [],
          pointIds: [
            "point_rect_a",
            "point_rect_b",
            "point_rect_c",
            "point_rect_d",
            "point_circle_center",
            "point_arc_center",
            "point_arc_start",
            "point_arc_end",
            "point_spline_a",
            "point_spline_b",
            "point_spline_c",
            "point_probe",
            "point_arc_probe",
          ],
          points: [
            createPoint("point_rect_a", [0, 0]),
            createPoint("point_rect_b", [4, 0]),
            createPoint("point_rect_c", [4, 3]),
            createPoint("point_rect_d", [0, 3]),
            createPoint("point_circle_center", [8, 1.5]),
            createPoint("point_arc_center", [12, 1.5]),
            createPoint("point_arc_start", [13, 1.5]),
            createPoint("point_arc_end", [12, 2.5]),
            createPoint("point_spline_a", [16, 0]),
            createPoint("point_spline_b", [17.5, 2]),
            createPoint("point_spline_c", [19, 0]),
            createPoint("point_probe", [16.4, 1.3]),
            createPoint("point_arc_probe", [13.8, 0.4]),
          ],
          entityIds: [
            "line_bottom",
            "line_right",
            "line_top",
            "line_left",
            "circle_primary",
            "arc_primary",
            "arc_clockwise",
            "spline_primary",
          ],
          entities: [
            {
              kind: "lineSegment",
              entityId: "line_bottom",
              label: "Rectangle bottom",
              target: {
                kind: "sketchEntity",
                sketchId: "sketch_measure",
                entityId: "line_bottom",
              },
              isConstruction: false,
              startPointId: "point_rect_a",
              endPointId: "point_rect_b",
            },
            createLine("line_right", "point_rect_b", "point_rect_c"),
            createLine("line_top", "point_rect_c", "point_rect_d"),
            createLine("line_left", "point_rect_d", "point_rect_a"),
            {
              kind: "circle",
              entityId: "circle_primary",
              label: "Circle 1",
              target: {
                kind: "sketchEntity",
                sketchId: "sketch_measure",
                entityId: "circle_primary",
              },
              isConstruction: false,
              centerPointId: "point_circle_center",
              radius: 1.25,
            },
            {
              kind: "arc",
              entityId: "arc_primary",
              label: "Arc 1",
              target: {
                kind: "sketchEntity",
                sketchId: "sketch_measure",
                entityId: "arc_primary",
              },
              isConstruction: false,
              centerPointId: "point_arc_center",
              startPointId: "point_arc_start",
              endPointId: "point_arc_end",
              sweepDirection: "counterClockwise",
            },
            {
              // The same quarter arc authored clockwise (review A-3).
              kind: "arc",
              entityId: "arc_clockwise",
              label: "Arc CW",
              target: {
                kind: "sketchEntity",
                sketchId: "sketch_measure",
                entityId: "arc_clockwise",
              },
              isConstruction: false,
              centerPointId: "point_arc_center",
              startPointId: "point_arc_end",
              endPointId: "point_arc_start",
              sweepDirection: "clockwise",
            },
            {
              kind: "spline",
              entityId: "spline_primary",
              label: "Spline 1",
              target: {
                kind: "sketchEntity",
                sketchId: "sketch_measure",
                entityId: "spline_primary",
              },
              isConstruction: false,
              pointOccurrenceIds: ["occ-a", "occ-b", "occ-c"],
              pointOccurrences: [
                {
                  occurrenceId: "occ-a",
                  pointId: "point_spline_a",
                  tangent: { kind: "automatic" },
                },
                {
                  occurrenceId: "occ-b",
                  pointId: "point_spline_b",
                  tangent: { kind: "automatic" },
                },
                {
                  occurrenceId: "occ-c",
                  pointId: "point_spline_c",
                  tangent: { kind: "automatic" },
                },
              ],
              closure: "open",
              interpolationPolicy: "centripetal-mean-arm-v1",
            },
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
            createSolvedLine("line_bottom", [0, 0], [4, 0]),
            createSolvedLine("line_right", [4, 0], [4, 3]),
            createSolvedLine("line_top", [4, 3], [0, 3]),
            createSolvedLine("line_left", [0, 3], [0, 0]),
          ],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [],
        },
        derivedValidity: { state: "current", diagnostics: [] },
        projectedReferences: [
          {
            referenceId: "reference_projected_circle",
            status: "projected",
            diagnostics: [],
            geometry: [
              {
                geometryId: "projected_circle",
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
                loopId: "loop_outer",
                role: "outer",
                segments: lineLoopSegmentsForTest(
                  [
                    { pointId: "point_rect_a", position: [0, 0] },
                    { pointId: "point_rect_b", position: [4, 0] },
                    { pointId: "point_rect_c", position: [4, 3] },
                    { pointId: "point_rect_d", position: [0, 3] },
                  ] as never,
                  [
                    "line_bottom",
                    "line_right",
                    "line_top",
                    "line_left",
                  ] as never,
                ),
              },
            ],
          },
        ],
      },
    };

    const snapshot = {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: "doc_measure",
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
      documentHistory: [],
      sketches: [sketch],
      features: [],
      cursor: { kind: "empty" as const },
      bodies: [
        {
          ownerDocumentId: "doc_measure",
          ownerRevisionId: "rev_measure",
          ownerFeatureId: "feature_body",
          ownerSketchId: null,
          ownerBodyId: "body_measure",
          bodyId: "body_measure",
          label: "Body A",
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
      document: {
        contractVersion: CONTRACT_VERSION,
        schemaVersion: SNAPSHOT_SCHEMA_VERSION,
        documentId: "doc_measure",
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
    target: PrimitiveRef,
    selectionSemantics: SnapshotEntityRecord["selectionSemantics"],
  ): SnapshotEntityRecord {
    return {
      ownerDocumentId: "doc_measure",
      ownerRevisionId: "rev_measure",
      ownerFeatureId: null,
      ownerSketchId:
        "sketchId" in target || target.kind === "region"
          ? target.sketchId
          : null,
      ownerBodyId: "bodyId" in target ? target.bodyId : null,
      id,
      label,
      target,
      relatedTargets: [],
      contributingFeatureIds: [],
      consumedByFeatureIds: [],
      selectionSemantics,
    };
  }

  function createLine(
    entityId: string,
    startPointId: string,
    endPointId: string,
  ) {
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
    entityId: string,
    startPosition: readonly [number, number],
    endPosition: readonly [number, number],
  ) {
    return {
      entityId,
      kind: "lineSegment" as const,
      startPosition,
      endPosition,
    };
  }

  function createPoint(pointId: string, position: readonly [number, number]) {
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
    faceId: string,
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
    faceId: string,
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
    edgeId: string,
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
    vertexId: string,
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

  const snapshot = createMeasurementSnapshot();

  const lineMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "line_bottom",
      },
    ],
    snapshot,
  });
  expect(
    lineMeasurement?.rows.some(
      (row) => row.label === "Length" && row.value === "4 mm",
    ),
    "Line measurement should expose intrinsic edge length.",
  ).toBeTruthy();

  const circleMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "circle_primary",
      },
    ],
    snapshot,
  });
  expect(
    circleMeasurement?.rows.some(
      (row) => row.label === "Radius" && row.value === "1.25 mm",
    ),
    "Circle measurement should expose radius.",
  ).toBeTruthy();
  expect(
    circleMeasurement?.rows.some(
      (row) => row.label === "Diameter" && row.value === "2.5 mm",
    ),
    "Circle measurement should expose diameter.",
  ).toBeTruthy();
  expect(
    circleMeasurement?.rows.some((row) => row.label === "Circumference"),
    "Circle measurement should expose circumference.",
  ).toBeTruthy();

  const arcMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "arc_primary",
      },
    ],
    snapshot,
  });
  expect(
    arcMeasurement?.rows.some(
      (row) => row.label === "Sweep" && row.value === "90 deg",
    ),
    "Arc measurement should expose sweep angle.",
  ).toBeTruthy();
  expect(
    arcMeasurement?.rows.some(
      (row) => row.label === "Arc Length" && row.value === "1.57 mm",
    ),
    "Arc measurement should expose arc length.",
  ).toBeTruthy();

  const splineMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "spline_primary",
      },
    ],
    snapshot,
  });
  expect(
    splineMeasurement?.rows.some(
      (row) => row.label === "Closed" && row.value === "No",
    ),
    "Spline measurement should expose authored closure.",
  ).toBeTruthy();
  expect(
    splineMeasurement?.rows.some(
      (row) => row.label === "Fit Points" && row.value === "3",
    ),
    "Spline measurement should expose fit-point metadata.",
  ).toBeTruthy();

  const regionMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "region",
        sketchId: "sketch_measure",
        regionId: "region_measure",
      },
    ],
    snapshot,
  });
  expect(
    regionMeasurement?.rows.some(
      (row) => row.label === "Area" && row.value === "12 mm²",
    ),
    "Region measurement should expose profile area.",
  ).toBeTruthy();
  expect(
    regionMeasurement?.rows.some(
      (row) => row.label === "Perimeter" && row.value === "14 mm",
    ),
    "Region measurement should expose profile perimeter.",
  ).toBeTruthy();

  const faceMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [{ kind: "face", bodyId: "body_measure", faceId: "face_top" }],
    snapshot,
  });
  expect(
    faceMeasurement?.rows.some(
      (row) => row.label === "Area" && row.value === "12 mm²",
    ),
    "Face measurement should expose surface area.",
  ).toBeTruthy();
  expect(
    faceMeasurement?.rows.some(
      (row) => row.label === "Perimeter" && row.value === "14 mm",
    ),
    "Face measurement should expose perimeter.",
  ).toBeTruthy();

  const bodyMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [{ kind: "body", bodyId: "body_measure" }],
    snapshot,
  });
  expect(
    bodyMeasurement?.rows.some(
      (row) => row.label === "Surface Area" && row.value === "94 mm²",
    ),
    "Body measurement should expose surface area when every face mesh is available.",
  ).toBeTruthy();
  expect(
    bodyMeasurement?.rows.some(
      (row) => row.label === "Volume" && row.value === "60 mm³",
    ),
    "Body measurement should expose solid volume when the body shell closes.",
  ).toBeTruthy();

  const pairMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "vertex",
        bodyId: "body_measure",
        vertexId: "vertex_top_front_left",
      },
      { kind: "face", bodyId: "body_measure", faceId: "face_bottom" },
    ],
    snapshot,
  });
  expect(
    pairMeasurement?.rows.length === 1 &&
      pairMeasurement.rows[0]?.value === "5 mm",
    "Supported pairwise measurements should expose minimum distance only.",
  ).toBeTruthy();
  expect(
    pairMeasurement?.witnesses.length,
    "Pairwise measurements should retain a witness segment with endpoint markers.",
  ).toBe(3);

  const parallelEdgeMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" },
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_back" },
    ],
    snapshot,
  });
  expect(
    parallelEdgeMeasurement?.rows.some(
      (row) => row.label === "Distance" && row.value === "3 mm",
    ),
    "Parallel edge measurements should expose perpendicular spacing between the two selected edges.",
  ).toBeTruthy();
  expect(
    parallelEdgeMeasurement?.rows.some(
      (row) => row.label === "Angle" && row.value === "0 deg",
    ),
    "Parallel edge measurements should expose zero angle for parallel line-like edges.",
  ).toBeTruthy();
  expect(
    parallelEdgeMeasurement?.witnesses.length,
    "Parallel edge measurements should keep both edge highlights plus a single connector line.",
  ).toBe(3);
  expect(
    parallelEdgeMeasurement?.witnesses.every(
      (witness) => witness.kind !== "marker",
    ),
    "Curve-to-curve pairwise measurements should not add endpoint markers that read like vertex selection.",
  ).toBeTruthy();
  const parallelConnector = parallelEdgeMeasurement?.witnesses.find((witness) =>
    witness.id.includes(":distance"),
  );
  expect(
    parallelConnector?.kind === "polyline" &&
      JSON.stringify(parallelConnector.points) ===
        JSON.stringify([
          [2, 0, 5],
          [2, 3, 5],
        ]),
    "Parallel edge connectors should anchor at representative mid-span closest points rather than arbitrary segment starts.",
  ).toBeTruthy();

  const touchingEdgeMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" },
      { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_left" },
    ],
    snapshot,
  });
  expect(
    touchingEdgeMeasurement?.rows.some(
      (row) => row.label === "Distance" && row.value === "0 mm",
    ),
    "Intersecting edge measurements should still report zero minimum distance.",
  ).toBeTruthy();
  expect(
    touchingEdgeMeasurement?.rows.some(
      (row) => row.label === "Angle" && row.value === "90 deg",
    ),
    "Intersecting perpendicular edge measurements should also expose the line-to-line angle.",
  ).toBeTruthy();
  expect(
    touchingEdgeMeasurement?.witnesses.length,
    "Zero-distance edge measurements should keep only the two selected edge highlights.",
  ).toBe(2);
  expect(
    touchingEdgeMeasurement?.witnesses.every(
      (witness) =>
        witness.kind === "polyline" && !witness.id.includes(":distance"),
    ),
    "Zero-distance edge measurements should omit collapsed connector and marker feedback.",
  ).toBeTruthy();

  const projectedMeasurement = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "projectedReferenceGeometry",
        referenceId: "reference_projected_circle",
        geometryId: "projected_circle",
        geometryKind: "circle",
      },
    ],
    snapshot,
  });
  expect(
    projectedMeasurement?.rows.some(
      (row) => row.label === "Radius" && row.value === "1 mm",
    ),
    "Projected circles should expose single-target circular properties.",
  ).toBeTruthy();

  expect(
    isMeasureSelectableTarget(snapshot, {
      kind: "sketchEntity",
      sketchId: "sketch_measure",
      entityId: "arc_primary",
    }),
    "Supported sketch arcs should be accepted by the measure selection filter.",
  ).toBeTruthy();

  const pairCandidate = resolveMeasureSelectionCandidate(
    snapshot,
    [
      {
        kind: "vertex",
        bodyId: "body_measure",
        vertexId: "vertex_top_front_left",
      },
    ],
    { kind: "face", bodyId: "body_measure", faceId: "face_bottom" },
  );
  expect(
    pairCandidate.accepted && pairCandidate.nextSelection.length === 2,
    "Compatible measure targets should build a pair.",
  ).toBeTruthy();

  // T10e (plan §2.3): point ↔ curve distance is exact on the curve; the
  // closest point is checked against an independent minimisation (own
  // Bernstein evaluator, dense grid plus golden section), far tighter than
  // the 48-segment tessellation's chord error.
  const splineEntity =
    snapshot.document.sketches[0]!.sketch.definition.entities.find(
      (entity) => entity.entityId === "spline_primary",
    )!;
  const splinePositions = Object.fromEntries(
    snapshot.document.sketches[0]!.sketch.definition.points.map((point) => [
      point.pointId,
      point.position,
    ]),
  );
  const probe = [16.4, 1.3] as const;
  const oracle = closestOnCubicsOracle(
    probe,
    reconstructSplineAggregate(
      splineEntity as Extract<typeof splineEntity, { kind: "spline" }>,
      splinePositions,
    ).spans.map((span) => span.poles),
  );
  const pointToSpline = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "sketchPoint",
        sketchId: "sketch_measure",
        pointId: "point_probe",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "spline_primary",
      },
    ],
    snapshot,
  });
  const connector = pointToSpline?.witnesses.find((witness) =>
    witness.id.endsWith(":distance"),
  );
  expect(connector?.kind, "Point ↔ spline keeps its connector.").toBe(
    "polyline",
  );
  const onCurve = (connector as { points: readonly number[][] }).points[1]!;
  // The distance is stationary at the minimum, so it is compared tightly and
  // the location (determined only to about √ε along the curve) loosely.
  expect(
    Math.abs(
      Math.hypot(onCurve[0]! - probe[0], onCurve[1]! - probe[1]) -
        Math.hypot(oracle[0] - probe[0], oracle[1] - probe[1]),
    ),
    "The point ↔ spline distance is the exact closest distance.",
  ).toBeLessThan(1e-13);
  expect(
    Math.hypot(onCurve[0]! - oracle[0], onCurve[1]! - oracle[1]),
    "The point ↔ spline witness ends at the exact closest point of the spline.",
  ).toBeLessThan(1e-7);
  expect(
    pointToSpline?.rows.find((row) => row.label === "Distance")?.value,
    "An exact point ↔ curve distance is not marked approximate.",
  ).toBe(
    `${Math.hypot(oracle[0] - probe[0], oracle[1] - probe[1]).toFixed(2)} mm`,
  );

  const splineToLine = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "spline_primary",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "line_bottom",
      },
    ],
    snapshot,
  });
  expect(
    splineToLine?.rows.find((row) => row.label === "Distance")?.value,
    "A curve ↔ curve distance on a tessellated spline is labelled approximate (T-6, R7).",
  ).toMatch(/^≈ /);

  // Review A-3: a probe outside a clockwise arc's sweep measures to the
  // nearer arc end, not to the unclamped circle (1.11 mm here).
  const pointToArc = deriveMeasurementViewModel({
    activeToolId: "measure",
    selection: [
      {
        kind: "sketchPoint",
        sketchId: "sketch_measure",
        pointId: "point_arc_probe",
      },
      {
        kind: "sketchEntity",
        sketchId: "sketch_measure",
        entityId: "arc_clockwise",
      },
    ],
    snapshot,
  });
  expect(
    pointToArc?.rows.find((row) => row.label === "Distance")?.value,
    "Point ↔ clockwise arc clamps to the nearer arc end (√(0.8² + 1.1²)).",
  ).toBe(`${Math.hypot(0.8, 1.1).toFixed(2)} mm`);
  const arcConnector = pointToArc?.witnesses.find((witness) =>
    witness.id.endsWith(":distance"),
  ) as { points: readonly number[][] } | undefined;
  expect(
    arcConnector?.points[1],
    "The witness ends at the arc's end point.",
  ).toEqual([13, 1.5, 0]);

  const replacementCandidate = resolveMeasureSelectionCandidate(
    snapshot,
    [{ kind: "body", bodyId: "body_measure" }],
    { kind: "edge", bodyId: "body_measure", edgeId: "edge_top_front" },
  );
  expect(
    replacementCandidate.accepted &&
      replacementCandidate.nextSelection.length === 1 &&
      replacementCandidate.nextSelection[0]?.kind === "edge",
    "Unsupported second targets should replace the prior selection with a fresh measurement seed.",
  ).toBeTruthy();
});

/** Independent closest point on cubic spans: dense grid, then golden section. */
function closestOnCubicsOracle(
  point: readonly [number, number],
  spans: readonly SplinePoles[],
): readonly [number, number] {
  const at = ([p0, p1, p2, p3]: SplinePoles, u: number) => {
    const v = 1 - u;
    const [b0, b1, b2, b3] = [
      v * v * v,
      3 * u * v * v,
      3 * u * u * v,
      u * u * u,
    ];
    return [
      b0 * p0[0] + b1 * p1[0] + b2 * p2[0] + b3 * p3[0],
      b0 * p0[1] + b1 * p1[1] + b2 * p2[1] + b3 * p3[1],
    ] as const;
  };
  const gap = (poles: SplinePoles, u: number) => {
    const [x, y] = at(poles, u);
    return Math.hypot(x - point[0], y - point[1]);
  };
  let best = { poles: spans[0]!, u: 0, d: Infinity };
  for (const poles of spans)
    for (let k = 0; k <= 20000; k += 1) {
      const d = gap(poles, k / 20000);
      if (d < best.d) best = { poles, u: k / 20000, d };
    }
  let [lo, hi] = [Math.max(0, best.u - 1e-4), Math.min(1, best.u + 1e-4)];
  const ratio = (Math.sqrt(5) - 1) / 2;
  for (let step = 0; step < 200; step += 1) {
    const a = hi - ratio * (hi - lo);
    const b = lo + ratio * (hi - lo);
    if (gap(best.poles, a) < gap(best.poles, b)) hi = b;
    else lo = a;
  }
  return at(best.poles, (lo + hi) / 2);
}
