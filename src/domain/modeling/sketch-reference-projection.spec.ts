import { test } from 'bun:test'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import { CONTRACT_VERSION, RENDER_EXPORT_SCHEMA_VERSION, SNAPSHOT_SCHEMA_VERSION } from '@/contracts/shared/versioning'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import { projectSketchExternalReferencesFromSnapshot } from './sketch-reference-projection'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function createSnapshotWithEdge(points: readonly (readonly [number, number, number])[], isClosed: boolean): WorkspaceSnapshot {
  const document = {
    contractVersion: CONTRACT_VERSION,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    documentId: 'doc_projection',
    revisionId: 'rev_projection',
    settings: {
      linearUnit: 'millimeter' as const,
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
    cursor: { kind: 'empty' as const },
    sketches: [],
    bodies: [],
    constructions: [],
    variables: [],
    entities: [],
    references: [],
    diagnostics: [],
    render: {
      schemaVersion: RENDER_EXPORT_SCHEMA_VERSION,
      records: [{
        id: 'render_edge',
        label: 'Projected edge',
        ownerBodyId: 'body_projection',
        ownerFeatureId: 'feature_projection',
        binding: {
          pickId: 'pick_edge',
          pickPriority: 10,
          target: {
            kind: 'edge' as const,
            bodyId: 'body_projection',
            edgeId: 'edge_projected',
          },
          topology: 'edge' as const,
          semanticClass: 'featureEdge' as const,
        },
        geometry: {
          kind: 'polyline' as const,
          points,
          isClosed,
        },
      }],
    },
  }

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
  } as WorkspaceSnapshot
}

function projectEdge(points: readonly (readonly [number, number, number])[], isClosed: boolean) {
  return projectSketchExternalReferencesFromSnapshot(
    createSnapshotWithEdge(points, isClosed),
    {
      contractVersion: CONTRACT_VERSION,
      solverSchemaVersion: SOLVER_SCHEMA_VERSION,
      requestId: 'request_project_edge',
      documentId: 'doc_projection',
      revisionId: 'rev_projection',
      sketchId: 'sketch_projection',
      plane: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      references: [{
        referenceId: 'ref_projected_edge',
        reference: {
          referenceId: 'ref_projected_edge',
          kind: 'modelReference',
          label: 'Projected edge',
          source: {
            kind: 'edge',
            bodyId: 'body_projection',
            edgeId: 'edge_projected',
          },
          projectionMode: 'projectAlongPlaneNormal',
        },
      }],
    },
  )
}

test('model edge projection classifies supported projected geometry generically', () => {
  const line = projectEdge([
    [0, 0, 0],
    [0, 0, 0],
    [2, 0, 0],
  ], false).projectedReferences[0]?.geometry[0]
  assert(line?.kind === 'lineSegment', 'Open collinear model edges should project as line segments.')

  const circle = projectEdge([
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, -1, 0],
  ], true).projectedReferences[0]?.geometry[0]
  assert(circle?.kind === 'circle', 'Closed circular model edges should project as circles.')
  assert(Math.abs(circle.radius - 1) < 1e-6, 'Projected circle should preserve the source radius.')

  const arc = projectEdge([
    [1, 0, 0],
    [Math.SQRT1_2, Math.SQRT1_2, 0],
    [0, 1, 0],
  ], false).projectedReferences[0]?.geometry[0]
  assert(arc?.kind === 'arc', 'Open circular model edges should project as arcs.')
  assert(arc.sweepDirection === 'counterClockwise', 'Projected arc should preserve sweep direction.')
})

test('model edge projection handles closed edge sampling variants without misclassifying unsupported curves', () => {
  const repeatedEndpointCircle = projectEdge([
    [1, 0, 0],
    [0, 1, 0],
    [-1, 0, 0],
    [0, -1, 0],
    [1, 0, 0],
  ], true).projectedReferences[0]
  assert(repeatedEndpointCircle?.status === 'projected', 'Closed circular model edges with repeated endpoints should project.')
  assert(repeatedEndpointCircle.geometry[0]?.kind === 'circle', 'Repeated endpoint circles should project as circles.')

  const inferredClosedCircle = projectEdge([
    [2, 0, 0],
    [0, 2, 0],
    [-2, 0, 0],
    [0, -2, 0],
    [2, 0, 0],
  ], false).projectedReferences[0]?.geometry[0]
  assert(inferredClosedCircle?.kind === 'circle', 'Repeated endpoints should infer closed circular model edges.')

  const spline = projectEdge([
    [0, 0, 0],
    [2, 0, 0],
    [2, 1, 0],
    [0, 2, 0],
    [0, 0, 0],
  ], true).projectedReferences[0]
  const splineGeometry = spline?.geometry[0]
  assert(spline?.status === 'projected', 'Non-line and non-circular model edges should still project as freeform curves.')
  assert(splineGeometry?.kind === 'spline', 'Freeform model edges should project as splines.')
  assert(splineGeometry.isClosed, 'Projected freeform curves should preserve closed sampling.')
})
