import { test, expect } from "vitest";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { SketchDerivedValidity } from "@/contracts/sketch/schema";
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from "@/contracts/shared/versioning";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { projectSketchExternalReferencesFromSnapshot } from "./sketch-reference-projection";

function createSnapshotWithEdge(
  points: readonly (readonly [number, number, number])[],
  isClosed: boolean,
): WorkspaceSnapshot {
  const document = {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    documentId: "doc_projection",
    revisionId: "rev_projection",
    settings: {
      linearUnit: "millimeter" as const,
      modelingTolerance: 1e-6,
      angularToleranceRadians: 1e-6,
    },
    capabilities: {
      supportedFeatureKinds: [],
      previewableFeatureKinds: [],
      supportedProfileKinds: [],
      supportsFaceBackedSketchPlanes: true,
      supportsDurableTopologyNaming: true,
    },
    featureTree: [],
    objects: [],
    features: [],
    cursor: { kind: "empty" as const },
    sketches: [],
    bodies: [],
    constructions: [],
    variables: [],
    entities: [],
    references: [],
    diagnostics: [],
    render: {
      schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
      records: [
        {
          id: "render_edge",
          label: "Projected edge",
          ownerBodyId: "body_projection",
          ownerFeatureId: "feature_projection",
          binding: {
            pickId: "pick_edge",
            pickPriority: 10,
            target: {
              kind: "edge" as const,
              bodyId: "body_projection",
              edgeId: "edge_projected",
            },
            topology: "edge" as const,
            semanticClass: "featureEdge" as const,
          },
          geometry: {
            kind: "polyline" as const,
            points,
            isClosed,
          },
        },
      ],
    },
  };

  return {
    document,
    presentation: {
      featureTree: [],
      objects: [],
      documentHistory: [],
      entities: [],
    },
    provenance: null,
    ...document,
    documentHistory: [],
  } as WorkspaceSnapshot;
}

function projectEdge(
  points: readonly (readonly [number, number, number])[],
  isClosed: boolean,
) {
  return projectSketchExternalReferencesFromSnapshot(
    createSnapshotWithEdge(points, isClosed),
    {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: "request_project_edge",
      documentId: "doc_projection",
      revisionId: "rev_projection",
      sketchId: "sketch_projection",
      plane: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      references: [
        {
          referenceId: "ref_projected_edge",
          reference: {
            referenceId: "ref_projected_edge",
            kind: "modelReference",
            label: "Projected edge",
            source: {
              kind: "edge",
              bodyId: "body_projection",
              edgeId: "edge_projected",
            },
            projectionMode: "projectAlongPlaneNormal",
          },
        },
      ],
    },
  );
}

test("model edge projection classifies supported projected geometry generically", () => {
  const line = projectEdge(
    [
      [0, 0, 0],
      [0, 0, 0],
      [2, 0, 0],
    ],
    false,
  ).projectedReferences[0]?.geometry[0];
  expect(
    line?.kind,
    "Open collinear model edges should project as line segments.",
  ).toBe("lineSegment");

  const circle = projectEdge(
    [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [0, -1, 0],
    ],
    true,
  ).projectedReferences[0]?.geometry[0];
  expect(
    circle?.kind,
    "Closed circular model edges should project as circles.",
  ).toBe("circle");
  expect(
    Math.abs(circle.radius - 1) < 1e-6,
    "Projected circle should preserve the source radius.",
  ).toBeTruthy();

  const arc = projectEdge(
    [
      [1, 0, 0],
      [Math.SQRT1_2, Math.SQRT1_2, 0],
      [0, 1, 0],
    ],
    false,
  ).projectedReferences[0]?.geometry[0];
  expect(arc?.kind, "Open circular model edges should project as arcs.").toBe(
    "arc",
  );
  expect(
    arc.sweepDirection,
    "Projected arc should preserve sweep direction.",
  ).toBe("counterClockwise");
});

function projectAuthoredSpline(derivedValidity: SketchDerivedValidity) {
  const snapshot = createSnapshotWithEdge([], false);
  snapshot.document.cursor = { kind: "sketch", sketchId: "sketch_source" };
  snapshot.presentation.documentHistory = [
    {
      id: "history_sketch_source",
      label: "Source sketch",
      description: "Source sketch",
      kind: "sketch",
      target: { kind: "sketch", sketchId: "sketch_source" },
      sketchId: "sketch_source",
      featureId: null,
    },
  ];
  snapshot.document.sketches.push({
    documentId: "doc_projection",
    revisionId: "rev_projection",
    sketchId: "sketch_source",
    label: "Source sketch",
    plane: {
      support: {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
      frame: {
        origin: [0, 0, 0],
        xAxis: [0, -1, 0],
        yAxis: [-1, 0, 0],
        normal: [0, 0, -1],
        linearUnit: "documentLength",
        handedness: "rightHanded",
      },
    },
    sketch: {
      documentId: "doc_projection",
      revisionId: "rev_projection",
      sketchId: "sketch_source",
      label: "Source sketch",
      planeSupport: {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
      definition: {
        schemaVersion: "sketch-definition/v1alpha1",
        referenceIds: [],
        references: [],
        pointIds: ["sketch_point_start", "sketch_point_end"],
        points: [
          {
            pointId: "sketch_point_start",
            label: "Start",
            target: {
              kind: "sketchPoint",
              sketchId: "sketch_source",
              pointId: "sketch_point_start",
            },
            position: [0, 0],
            isConstruction: false,
          },
          {
            pointId: "sketch_point_end",
            label: "End",
            target: {
              kind: "sketchPoint",
              sketchId: "sketch_source",
              pointId: "sketch_point_end",
            },
            position: [20, 20],
            isConstruction: false,
          },
        ],
        entityIds: ["sketch_entity_spline"],
        entities: [
          {
            kind: "spline",
            entityId: "sketch_entity_spline",
            label: "Spline",
            target: {
              kind: "sketchEntity",
              sketchId: "sketch_source",
              entityId: "sketch_entity_spline",
            },
            isConstruction: false,
            pointOccurrenceIds: ["occ-start", "occ-end"],
            pointOccurrences: [
              {
                occurrenceId: "occ-start",
                pointId: "sketch_point_start",
                tangent: { kind: "authored", vector: [1, 0] },
              },
              {
                occurrenceId: "occ-end",
                pointId: "sketch_point_end",
                tangent: { kind: "authored", vector: [1, 0] },
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
        status: { solveState: "solved", degreesOfFreedom: 4 },
        solvedPoints: [
          { pointId: "sketch_point_start", solvedPosition: [0, 0] },
          { pointId: "sketch_point_end", solvedPosition: [2, 0] },
        ],
        diagnostics: [],
      },
      derivedValidity,
      regions: [],
    },
  } as unknown as WorkspaceSnapshot["document"]["sketches"][number]);

  return projectSketchExternalReferencesFromSnapshot(snapshot, {
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: "request_project_spline",
    documentId: "doc_projection",
    revisionId: "rev_projection",
    sketchId: "sketch_projection",
    plane: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      linearUnit: "documentLength",
      handedness: "rightHanded",
    },
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    references: [
      {
        referenceId: "ref_projected_spline",
        reference: {
          referenceId: "ref_projected_spline",
          kind: "sketchReference",
          label: "Projected spline",
          source: {
            kind: "sketchEntity",
            sketchId: "sketch_source",
            entityId: "sketch_entity_spline",
          },
        },
      },
    ],
  });
}

test("authored spline projection transforms source-owner spans into an opposite-normal destination frame", () => {
  const projected = projectAuthoredSpline({ state: "current", diagnostics: [] })
    .projectedReferences[0];
  const geometry = projected?.geometry[0];
  expect(projected?.status).toBe("projected");
  expect(
    geometry?.kind === "spline" &&
      geometry.representation.kind === "neutralCubicSpans"
      ? geometry.representation.spans[0]?.poles
      : null,
    "Projection must transform source-reconstructed poles, including authored tangent vectors, without reconstructing in the destination metric.",
  ).toEqual([
    [0, 0],
    [0, -1],
    [0, -1],
    [0, -2],
  ]);
});

test("sketch projection explicitly rejects invalid and stale source derived output", () => {
  for (const state of ["invalid", "stale"] as const) {
    const projected = projectAuthoredSpline({ state, diagnostics: [] })
      .projectedReferences[0];
    expect(projected?.status).toBe("unsupportedSource");
    expect(projected?.geometry).toEqual([]);
    expect(projected?.diagnostics[0]?.code).toBe(
      "projection-source-derived-output-not-current",
    );
  }
});

test("model edge projection handles closed edge sampling variants without misclassifying unsupported curves", () => {
  const repeatedEndpointCircle = projectEdge(
    [
      [1, 0, 0],
      [0, 1, 0],
      [-1, 0, 0],
      [0, -1, 0],
      [1, 0, 0],
    ],
    true,
  ).projectedReferences[0];
  expect(
    repeatedEndpointCircle?.status,
    "Closed circular model edges with repeated endpoints should project.",
  ).toBe("projected");
  expect(
    repeatedEndpointCircle.geometry[0]?.kind,
    "Repeated endpoint circles should project as circles.",
  ).toBe("circle");

  const inferredClosedCircle = projectEdge(
    [
      [2, 0, 0],
      [0, 2, 0],
      [-2, 0, 0],
      [0, -2, 0],
      [2, 0, 0],
    ],
    false,
  ).projectedReferences[0]?.geometry[0];
  expect(
    inferredClosedCircle?.kind,
    "Repeated endpoints should infer closed circular model edges.",
  ).toBe("circle");

  const spline = projectEdge(
    [
      [0, 0, 0],
      [2, 0, 0],
      [2, 1, 0],
      [0, 2, 0],
      [0, 0, 0],
    ],
    true,
  ).projectedReferences[0];
  const splineGeometry = spline?.geometry[0];
  expect(
    spline?.status,
    "Non-line and non-circular model edges should still project as freeform curves.",
  ).toBe("projected");
  expect(
    splineGeometry?.kind,
    "Freeform model edges should project as splines.",
  ).toBe("spline");
  expect(
    splineGeometry?.kind === "spline" &&
      splineGeometry.representation.kind === "sourceSamples" &&
      splineGeometry.representation.isClosed,
    "Projected freeform curves should preserve explicit source sampling without becoming ordinary splines.",
  ).toBeTruthy();
});
