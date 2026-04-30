import { test } from 'bun:test'

import type { DocumentSnapshot, SnapshotEntityRecord } from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { PrimitiveRef } from '@/core/editor/schema'
import {
  deriveMeasurementViewModel,
  isMeasureSelectableTarget,
  resolveMeasureSelectionCandidate,
} from '@/domain/measure/measurement'
import {
  CONTRACT_VERSION,
  RENDER_EXPORT_SCHEMA_VERSION,
  SNAPSHOT_SCHEMA_VERSION,
} from '@/contracts/shared/versioning'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

test('src/domain/measure/measurement.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createMeasurementSnapshot(): DocumentSnapshot {
    const plane = createStandardPlaneDefinition('xy')
    const entities: SnapshotEntityRecord[] = [
      createEntity('body_measure', 'Body A', { kind: 'body', bodyId: 'body_measure' }, ['body']),
      createEntity('face_top', 'Top face', { kind: 'face', bodyId: 'body_measure', faceId: 'face_top' }, ['face', 'planarFace']),
      createEntity('face_bottom', 'Bottom face', { kind: 'face', bodyId: 'body_measure', faceId: 'face_bottom' }, ['face']),
      createEntity('edge_top_front', 'Top front edge', { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_front' }, ['edge']),
      createEntity('edge_top_back', 'Top back edge', { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_back' }, ['edge']),
      createEntity('edge_top_left', 'Top left edge', { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_left' }, ['edge']),
      createEntity('vertex_top_front_left', 'Top front left vertex', { kind: 'vertex', bodyId: 'body_measure', vertexId: 'vertex_top_front_left' }, ['vertex']),
      createEntity('region_measure', 'Profile region', { kind: 'region', sketchId: 'sketch_measure', regionId: 'region_measure' }, ['face']),
      createEntity('line_bottom', 'Rectangle bottom', { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'line_bottom' }, ['sketchEntity']),
      createEntity('circle_primary', 'Circle 1', { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'circle_primary' }, ['sketchEntity']),
      createEntity('arc_primary', 'Arc 1', { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'arc_primary' }, ['sketchEntity']),
      createEntity('spline_primary', 'Spline 1', { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'spline_primary' }, ['sketchEntity']),
      createEntity('projected_circle', 'Projected circle', { kind: 'projectedReferenceGeometry', referenceId: 'reference_projected_circle', geometryId: 'projected_circle', geometryKind: 'circle' }, ['projectedReferenceGeometry']),
    ]

    const renderRecords: RenderableEntityRecord[] = [
      createFaceRenderable('face_top', [
        [0, 0, 5],
        [4, 0, 5],
        [4, 3, 5],
        [0, 3, 5],
      ]),
      createFaceRenderable('face_bottom', [
        [0, 0, 0],
        [4, 0, 0],
        [4, 3, 0],
        [0, 3, 0],
      ], false),
      createVerticalFaceRenderable('face_front', [
        [0, 0, 0],
        [4, 0, 0],
        [4, 0, 5],
        [0, 0, 5],
      ]),
      createVerticalFaceRenderable('face_back', [
        [0, 3, 0],
        [4, 3, 0],
        [4, 3, 5],
        [0, 3, 5],
      ]),
      createVerticalFaceRenderable('face_left', [
        [0, 0, 0],
        [0, 3, 0],
        [0, 3, 5],
        [0, 0, 5],
      ]),
      createVerticalFaceRenderable('face_right', [
        [4, 0, 0],
        [4, 3, 0],
        [4, 3, 5],
        [4, 0, 5],
      ]),
      createEdgeRenderable('edge_top_front', [[0, 0, 5], [4, 0, 5]]),
      createEdgeRenderable('edge_top_back', [[0, 3, 5], [4, 3, 5]]),
      createEdgeRenderable('edge_top_left', [[0, 0, 5], [0, 3, 5]]),
      createVertexRenderable('vertex_top_front_left', [0, 0, 5]),
    ]

    const sketch = {
      ownerDocumentId: 'doc_measure',
      ownerRevisionId: 'rev_measure',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_measure',
      ownerBodyId: null,
      sketchId: 'sketch_measure',
      label: 'Measure Sketch',
      plane,
      planeTarget: plane.support,
      planeKey: 'xy' as const,
      sketch: {
        ownerDocumentId: 'doc_measure',
        ownerRevisionId: 'rev_measure',
        ownerFeatureId: null,
        ownerSketchId: 'sketch_measure',
        ownerBodyId: null,
        sketchId: 'sketch_measure',
        label: 'Measure Sketch',
        planeSupport: plane.support,
        definition: {
          schemaVersion: 'sketch-definition/v1alpha1',
          referenceIds: ['reference_projected_circle'],
          references: [],
          pointIds: [
            'point_rect_a',
            'point_rect_b',
            'point_rect_c',
            'point_rect_d',
            'point_circle_center',
            'point_arc_center',
            'point_arc_start',
            'point_arc_end',
            'point_spline_a',
            'point_spline_b',
            'point_spline_c',
          ],
          points: [
            createPoint('point_rect_a', [0, 0]),
            createPoint('point_rect_b', [4, 0]),
            createPoint('point_rect_c', [4, 3]),
            createPoint('point_rect_d', [0, 3]),
            createPoint('point_circle_center', [8, 1.5]),
            createPoint('point_arc_center', [12, 1.5]),
            createPoint('point_arc_start', [13, 1.5]),
            createPoint('point_arc_end', [12, 2.5]),
            createPoint('point_spline_a', [16, 0]),
            createPoint('point_spline_b', [17.5, 2]),
            createPoint('point_spline_c', [19, 0]),
          ],
          entityIds: ['line_bottom', 'circle_primary', 'arc_primary', 'spline_primary'],
          entities: [
            {
              kind: 'lineSegment',
              entityId: 'line_bottom',
              label: 'Rectangle bottom',
              target: { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'line_bottom' },
              isConstruction: false,
              startPointId: 'point_rect_a',
              endPointId: 'point_rect_b',
            },
            {
              kind: 'circle',
              entityId: 'circle_primary',
              label: 'Circle 1',
              target: { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'circle_primary' },
              isConstruction: false,
              centerPointId: 'point_circle_center',
              radius: 1.25,
            },
            {
              kind: 'arc',
              entityId: 'arc_primary',
              label: 'Arc 1',
              target: { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'arc_primary' },
              isConstruction: false,
              centerPointId: 'point_arc_center',
              startPointId: 'point_arc_start',
              endPointId: 'point_arc_end',
              sweepDirection: 'counterClockwise',
            },
            {
              kind: 'spline',
              entityId: 'spline_primary',
              label: 'Spline 1',
              target: { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'spline_primary' },
              isConstruction: false,
              fitPointIds: ['point_spline_a', 'point_spline_b', 'point_spline_c'],
              degree: 3,
            },
          ],
          constraintIds: [],
          constraints: [],
          dimensionIds: [],
          dimensions: [],
        },
        solvedSnapshot: {
          schemaVersion: 'solved-sketch/v1alpha1',
          status: { solveState: 'solved', constraintState: 'underConstrained' },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [],
        },
        projectedReferences: [{
          referenceId: 'reference_projected_circle',
          status: 'projected',
          diagnostics: [],
          geometry: [{
            geometryId: 'projected_circle',
            kind: 'circle',
            centerPosition: [22, 1.5],
            radius: 1,
          }],
        }],
        regions: [{
          regionId: 'region_measure',
          label: 'Profile region',
          target: { kind: 'region', sketchId: 'sketch_measure', regionId: 'region_measure' },
          sourceSketch: { kind: 'sketch', sketchId: 'sketch_measure' },
          isClosed: true,
          loops: [{
            loopId: 'loop_outer',
            role: 'outer',
            boundaryPointIds: ['point_rect_a', 'point_rect_b', 'point_rect_c', 'point_rect_d'],
            segments: [],
          }],
        }],
      },
    }

    const snapshot = {
      contractVersion: CONTRACT_VERSION,
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      documentId: 'doc_measure',
      revisionId: 'rev_measure',
      settings: {
        linearUnit: 'millimeter' as const,
        modelingTolerance: 0.001,
        angularToleranceRadians: 0.0001,
      },
      capabilities: {
        supportedFeatureKinds: ['extrude'],
        previewableFeatureKinds: ['extrude'],
        supportedProfileKinds: ['region', 'face'],
        supportsFaceBackedSketchPlanes: true,
        supportsDurableTopologyNaming: true,
      },
      featureTree: [],
      objects: [],
      documentHistory: [],
      sketches: [sketch],
      features: [],
      cursor: { kind: 'empty' as const },
      bodies: [{
        ownerDocumentId: 'doc_measure',
        ownerRevisionId: 'rev_measure',
        ownerFeatureId: 'feature_body',
        ownerSketchId: null,
        ownerBodyId: 'body_measure',
        bodyId: 'body_measure',
        label: 'Body A',
        topology: {
          faceIds: ['face_top', 'face_bottom', 'face_front', 'face_back', 'face_left', 'face_right'],
          edgeIds: ['edge_top_front', 'edge_top_back', 'edge_top_left'],
          vertexIds: ['vertex_top_front_left'],
        },
      }],
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
        documentId: 'doc_measure',
        revisionId: 'rev_measure',
        settings: {
          linearUnit: 'millimeter' as const,
          modelingTolerance: 0.001,
          angularToleranceRadians: 0.0001,
        },
        capabilities: {
          supportedFeatureKinds: ['extrude'],
          previewableFeatureKinds: ['extrude'],
          supportedProfileKinds: ['region', 'face'],
          supportsFaceBackedSketchPlanes: true,
          supportsDurableTopologyNaming: true,
        },
        featureTree: [],
        objects: [],
        features: [],
        cursor: { kind: 'empty' as const },
        sketches: [sketch],
        bodies: [{
          ownerDocumentId: 'doc_measure',
          ownerRevisionId: 'rev_measure',
          ownerFeatureId: 'feature_body',
          ownerSketchId: null,
          ownerBodyId: 'body_measure',
          bodyId: 'body_measure',
          label: 'Body A',
          topology: {
            faceIds: ['face_top', 'face_bottom', 'face_front', 'face_back', 'face_left', 'face_right'],
            edgeIds: ['edge_top_front', 'edge_top_back', 'edge_top_left'],
            vertexIds: ['vertex_top_front_left'],
          },
        }],
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
    } satisfies DocumentSnapshot

    return snapshot
  }

  function createEntity(
    id: string,
    label: string,
    target: PrimitiveRef,
    selectionSemantics: SnapshotEntityRecord['selectionSemantics'],
  ): SnapshotEntityRecord {
    return {
      ownerDocumentId: 'doc_measure',
      ownerRevisionId: 'rev_measure',
      ownerFeatureId: null,
      ownerSketchId: 'sketchId' in target || target.kind === 'region' ? target.sketchId : null,
      ownerBodyId: 'bodyId' in target ? target.bodyId : null,
      id,
      label,
      target,
      relatedTargets: [],
      contributingFeatureIds: [],
      consumedByFeatureIds: [],
      selectionSemantics,
    }
  }

  function createPoint(pointId: string, position: readonly [number, number]) {
    return {
      pointId,
      label: pointId,
      target: { kind: 'sketchPoint' as const, sketchId: 'sketch_measure', pointId },
      position,
      isConstruction: false,
    }
  }

  function createFaceRenderable(faceId: string, points: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]], top = true): RenderableEntityRecord {
    return {
      id: `renderable_${faceId}`,
      label: faceId,
      ownerBodyId: 'body_measure',
      ownerFeatureId: 'feature_body',
      binding: {
        pickId: `pick_${faceId}`,
        pickPriority: 10,
        target: { kind: 'face', bodyId: 'body_measure', faceId },
        topology: 'face',
        semanticClass: top ? 'planarFace' : 'bodyFace',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: [...points],
        vertexNormals: null,
        triangleIndices: [[0, 1, 2], [0, 2, 3]],
      },
    }
  }

  function createVerticalFaceRenderable(faceId: string, points: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]]): RenderableEntityRecord {
    return createFaceRenderable(faceId, points, false)
  }

  function createEdgeRenderable(edgeId: string, points: readonly [readonly [number, number, number], readonly [number, number, number]]): RenderableEntityRecord {
    return {
      id: `renderable_${edgeId}`,
      label: edgeId,
      ownerBodyId: 'body_measure',
      ownerFeatureId: 'feature_body',
      binding: {
        pickId: `pick_${edgeId}`,
        pickPriority: 5,
        target: { kind: 'edge', bodyId: 'body_measure', edgeId },
        topology: 'edge',
        semanticClass: 'featureEdge',
      },
      geometry: {
        kind: 'polyline',
        points: [...points],
        isClosed: false,
      },
    }
  }

  function createVertexRenderable(vertexId: string, position: readonly [number, number, number]): RenderableEntityRecord {
    return {
      id: `renderable_${vertexId}`,
      label: vertexId,
      ownerBodyId: 'body_measure',
      ownerFeatureId: 'feature_body',
      binding: {
        pickId: `pick_${vertexId}`,
        pickPriority: 4,
        target: { kind: 'vertex', bodyId: 'body_measure', vertexId },
        topology: 'vertex',
        semanticClass: 'featureVertex',
      },
      geometry: {
        kind: 'marker',
        position,
        displayRadius: 0.12,
      },
    }
  }

  const snapshot = createMeasurementSnapshot()

  const lineMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{ kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'line_bottom' }],
    snapshot,
  })
  assert(lineMeasurement?.rows.some((row) => row.label === 'Length' && row.value === '4 mm'), 'Line measurement should expose intrinsic edge length.')

  const circleMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{ kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'circle_primary' }],
    snapshot,
  })
  assert(circleMeasurement?.rows.some((row) => row.label === 'Radius' && row.value === '1.25 mm'), 'Circle measurement should expose radius.')
  assert(circleMeasurement?.rows.some((row) => row.label === 'Diameter' && row.value === '2.5 mm'), 'Circle measurement should expose diameter.')
  assert(circleMeasurement?.rows.some((row) => row.label === 'Circumference'), 'Circle measurement should expose circumference.')

  const arcMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{ kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'arc_primary' }],
    snapshot,
  })
  assert(arcMeasurement?.rows.some((row) => row.label === 'Sweep' && row.value === '90 deg'), 'Arc measurement should expose sweep angle.')
  assert(arcMeasurement?.rows.some((row) => row.label === 'Arc Length' && row.value === '1.57 mm'), 'Arc measurement should expose arc length.')

  const splineMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{ kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'spline_primary' }],
    snapshot,
  })
  assert(splineMeasurement?.rows.some((row) => row.label === 'Degree' && row.value === '3'), 'Spline measurement should expose degree when available.')
  assert(splineMeasurement?.rows.some((row) => row.label === 'Fit Points' && row.value === '3'), 'Spline measurement should expose fit-point metadata.')

  const regionMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{ kind: 'region', sketchId: 'sketch_measure', regionId: 'region_measure' }],
    snapshot,
  })
  assert(regionMeasurement?.rows.some((row) => row.label === 'Area' && row.value === '12 mm²'), 'Region measurement should expose profile area.')
  assert(regionMeasurement?.rows.some((row) => row.label === 'Perimeter' && row.value === '14 mm'), 'Region measurement should expose profile perimeter.')

  const faceMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{ kind: 'face', bodyId: 'body_measure', faceId: 'face_top' }],
    snapshot,
  })
  assert(faceMeasurement?.rows.some((row) => row.label === 'Area' && row.value === '12 mm²'), 'Face measurement should expose surface area.')
  assert(faceMeasurement?.rows.some((row) => row.label === 'Perimeter' && row.value === '14 mm'), 'Face measurement should expose perimeter.')

  const bodyMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{ kind: 'body', bodyId: 'body_measure' }],
    snapshot,
  })
  assert(bodyMeasurement?.rows.some((row) => row.label === 'Surface Area' && row.value === '94 mm²'), 'Body measurement should expose surface area when every face mesh is available.')
  assert(bodyMeasurement?.rows.some((row) => row.label === 'Volume' && row.value === '60 mm³'), 'Body measurement should expose solid volume when the body shell closes.')

  const pairMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [
      { kind: 'vertex', bodyId: 'body_measure', vertexId: 'vertex_top_front_left' },
      { kind: 'face', bodyId: 'body_measure', faceId: 'face_bottom' },
    ],
    snapshot,
  })
  assert(pairMeasurement?.rows.length === 1 && pairMeasurement.rows[0]?.value === '5 mm', 'Supported pairwise measurements should expose minimum distance only.')
  assert(pairMeasurement?.witnesses.length === 3, 'Pairwise measurements should retain a witness segment with endpoint markers.')

  const parallelEdgeMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [
      { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_front' },
      { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_back' },
    ],
    snapshot,
  })
  assert(
    parallelEdgeMeasurement?.rows.some((row) => row.label === 'Distance' && row.value === '3 mm'),
    'Parallel edge measurements should expose perpendicular spacing between the two selected edges.',
  )
  assert(
    parallelEdgeMeasurement?.rows.some((row) => row.label === 'Angle' && row.value === '0 deg'),
    'Parallel edge measurements should expose zero angle for parallel line-like edges.',
  )
  assert(
    parallelEdgeMeasurement?.witnesses.length === 3,
    'Parallel edge measurements should keep both edge highlights plus a single connector line.',
  )
  assert(
    parallelEdgeMeasurement?.witnesses.every((witness) => witness.kind !== 'marker'),
    'Curve-to-curve pairwise measurements should not add endpoint markers that read like vertex selection.',
  )
  const parallelConnector = parallelEdgeMeasurement?.witnesses.find((witness) => witness.id.includes(':distance'))
  assert(
    parallelConnector?.kind === 'polyline'
      && JSON.stringify(parallelConnector.points) === JSON.stringify([[2, 0, 5], [2, 3, 5]]),
    'Parallel edge connectors should anchor at representative mid-span closest points rather than arbitrary segment starts.',
  )

  const touchingEdgeMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [
      { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_front' },
      { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_left' },
    ],
    snapshot,
  })
  assert(
    touchingEdgeMeasurement?.rows.some((row) => row.label === 'Distance' && row.value === '0 mm'),
    'Intersecting edge measurements should still report zero minimum distance.',
  )
  assert(
    touchingEdgeMeasurement?.rows.some((row) => row.label === 'Angle' && row.value === '90 deg'),
    'Intersecting perpendicular edge measurements should also expose the line-to-line angle.',
  )
  assert(
    touchingEdgeMeasurement?.witnesses.length === 2,
    'Zero-distance edge measurements should keep only the two selected edge highlights.',
  )
  assert(
    touchingEdgeMeasurement?.witnesses.every((witness) => witness.kind === 'polyline' && !witness.id.includes(':distance')),
    'Zero-distance edge measurements should omit collapsed connector and marker feedback.',
  )

  const projectedMeasurement = deriveMeasurementViewModel({
    activeToolId: 'measure',
    selection: [{
      kind: 'projectedReferenceGeometry',
      referenceId: 'reference_projected_circle',
      geometryId: 'projected_circle',
      geometryKind: 'circle',
    }],
    snapshot,
  })
  assert(projectedMeasurement?.rows.some((row) => row.label === 'Radius' && row.value === '1 mm'), 'Projected circles should expose single-target circular properties.')

  assert(
    isMeasureSelectableTarget(snapshot, { kind: 'sketchEntity', sketchId: 'sketch_measure', entityId: 'arc_primary' }),
    'Supported sketch arcs should be accepted by the measure selection filter.',
  )

  const pairCandidate = resolveMeasureSelectionCandidate(
    snapshot,
    [{ kind: 'vertex', bodyId: 'body_measure', vertexId: 'vertex_top_front_left' }],
    { kind: 'face', bodyId: 'body_measure', faceId: 'face_bottom' },
  )
  assert(pairCandidate.accepted && pairCandidate.nextSelection.length === 2, 'Compatible measure targets should build a pair.')

  const replacementCandidate = resolveMeasureSelectionCandidate(
    snapshot,
    [{ kind: 'body', bodyId: 'body_measure' }],
    { kind: 'edge', bodyId: 'body_measure', edgeId: 'edge_top_front' },
  )
  assert(
    replacementCandidate.accepted
      && replacementCandidate.nextSelection.length === 1
      && replacementCandidate.nextSelection[0]?.kind === 'edge',
    'Unsupported second targets should replace the prior selection with a fresh measurement seed.',
  )
})
