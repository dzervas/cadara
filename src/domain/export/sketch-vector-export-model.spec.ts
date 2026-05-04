import { test } from 'bun:test'

import type { SketchVectorExportModel } from '@/contracts/export/sketch-vector'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import type { RegionRecord, SketchDefinition, SolvedSketchSnapshot } from '@/contracts/sketch/schema'
import { buildSketchVectorExportModel } from '@/domain/export/sketch-vector-export-model'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { expectTrue } from '@/testing/expect.spec'

test('buildSketchVectorExportModel extracts committed sketch geometry, regions, styles, and diagnostics', () => {
  const modelOrFailure = buildSketchVectorExportModel({
    documentId: 'doc_export',
    revisionId: 'rev_0001',
    sketches: [createSketchSnapshot()],
    target: { kind: 'sketch', sketchId: 'sketch_profile' },
  })

  expectTrue(!('diagnostic' in modelOrFailure), 'Committed sketch targets should resolve to a sketch vector export model.')
  const model = modelOrFailure as SketchVectorExportModel

  expectTrue(model.sketchId === 'sketch_profile', 'The export model should preserve sketch identity.')
  expectTrue(model.revisionId === 'rev_0001', 'The export model should preserve document revision identity.')
  expectTrue(model.units === 'millimeter', 'The export model should declare document units.')
  expectTrue(
    model.entities.some((entity) => entity.kind === 'lineSegment' && entity.style?.stroke?.color === '#ff3366'),
    'Styled sketch line entities should preserve authored stroke style.',
  )
  expectTrue(
    model.entities.some((entity) => entity.kind === 'circle'),
    'Circle entities should be included in the sketch export model.',
  )
  expectTrue(
    model.regions[0]?.style?.fill.kind === 'gradient',
    'Closed regions should carry authored region fill styles for SVG export.',
  )
  expectTrue(
    model.diagnostics.some((diagnostic) => diagnostic.code === 'sketch-vector-unsupported-entity'),
    'Unsupported sketch entity kinds should be reported without dropping supported geometry.',
  )
})

test('buildSketchVectorExportModel exports solved committed geometry for dimensioned rectangles', () => {
  const solvedSnapshot = createSolvedRectangleSnapshot()
  const modelOrFailure = buildSketchVectorExportModel({
    documentId: 'doc_export',
    revisionId: 'rev_0001',
    sketches: [createSketchSnapshot(solvedSnapshot)],
    target: { kind: 'sketch', sketchId: 'sketch_profile' },
  })

  expectTrue(!('diagnostic' in modelOrFailure), 'Committed sketch targets should resolve to a sketch vector export model.')
  const model = modelOrFailure as SketchVectorExportModel
  const redLine = model.entities.find((entity) => entity.kind === 'lineSegment' && entity.entityId === 'entity_ab')
  const rightLine = model.entities.find((entity) => entity.kind === 'lineSegment' && entity.entityId === 'entity_bc')

  expectTrue(
    redLine?.kind === 'lineSegment'
      && redLine.start[0] === 0
      && redLine.start[1] === 0
      && redLine.end[0] === 5.19
      && redLine.end[1] === 0,
    'Sketch export should use solved line positions, not original authored draft positions.',
  )
  expectTrue(
    rightLine?.kind === 'lineSegment'
      && rightLine.start[0] === 5.19
      && rightLine.start[1] === 0
      && rightLine.end[0] === 5.19
      && rightLine.end[1] === 9.48,
    'Dimensioned vertical rectangle export should preserve the solved 5.19 by 9.48 dimensions.',
  )
  expectTrue(redLine.style?.stroke?.color === '#ff3366', 'Solved geometry export should preserve authored red stroke style.')
})

function createSketchSnapshot(solvedSnapshot = createSolvedSnapshot()): SketchSnapshotRecord {
  const definition: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: ['point_a', 'point_b', 'point_c', 'point_d', 'point_center', 'point_major'],
    points: [
      makePoint('point_a', [0, 0]),
      makePoint('point_b', [10, 0]),
      makePoint('point_c', [10, 6]),
      makePoint('point_d', [0, 6]),
      makePoint('point_center', [5, 3]),
      makePoint('point_major', [7, 3]),
    ],
    entityIds: ['entity_ab', 'entity_bc', 'entity_cd', 'entity_da', 'entity_circle', 'entity_ellipse'],
    entities: [
      makeLine('entity_ab', 'point_a', 'point_b', {
        strokeEnabled: true,
        strokeColor: '#ff3366',
        strokeWidth: 2,
      }),
      makeLine('entity_bc', 'point_b', 'point_c'),
      makeLine('entity_cd', 'point_c', 'point_d'),
      makeLine('entity_da', 'point_d', 'point_a'),
      {
        kind: 'circle',
        entityId: 'entity_circle',
        label: 'Circle',
        target: { kind: 'sketchEntity', sketchId: 'sketch_profile', entityId: 'entity_circle' },
        isConstruction: false,
        centerPointId: 'point_center',
        radius: 2,
      },
      {
        kind: 'ellipse',
        entityId: 'entity_ellipse',
        label: 'Ellipse',
        target: { kind: 'sketchEntity', sketchId: 'sketch_profile', entityId: 'entity_ellipse' },
        isConstruction: false,
        centerPointId: 'point_center',
        majorAxisPointId: 'point_major',
        minorRadius: 1,
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    styleIds: ['style_region'],
    styles: [{
      styleId: 'style_region',
      label: 'Region fill',
      target: { kind: 'region', regionId: 'region_square' },
      fill: {
        kind: 'gradient',
        gradient: {
          kind: 'linear',
          angleRadians: Math.PI / 4,
          startColor: '#2266ff',
          startOpacity: 0.25,
          endColor: '#ffcc33',
          endOpacity: 0.75,
        },
      },
      stroke: {
        color: '#111827',
        opacity: 0,
        width: 0,
        lineCap: 'round',
        lineJoin: 'round',
        miterLimit: 4,
      },
    }],
  }
  const plane = createStandardPlaneDefinition('xy')
  const region = createRegion()

  return {
    ownerDocumentId: 'doc_export',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: 'sketch_profile',
    ownerBodyId: null,
    sketchId: 'sketch_profile',
    label: 'Sketch Profile',
    plane,
    sketch: {
      ownerDocumentId: 'doc_export',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_profile',
      ownerBodyId: null,
      sketchId: 'sketch_profile',
      label: 'Sketch Profile',
      planeSupport: plane.support,
      definition,
      solvedSnapshot,
      regions: [region],
    },
  }
}

function createSolvedRectangleSnapshot(): SolvedSketchSnapshot {
  return {
    schemaVersion: 'solved-sketch/v1alpha1',
    status: { solveState: 'solved', constraintState: 'wellConstrained' },
    solvedPoints: [
      { pointId: 'point_a', solvedPosition: [0, 0] },
      { pointId: 'point_b', solvedPosition: [5.19, 0] },
      { pointId: 'point_c', solvedPosition: [5.19, 9.48] },
      { pointId: 'point_d', solvedPosition: [0, 9.48] },
      { pointId: 'point_center', solvedPosition: [2.595, 4.74] },
      { pointId: 'point_major', solvedPosition: [4.595, 4.74] },
    ],
    solvedEntities: [
      { entityId: 'entity_ab', kind: 'lineSegment', startPosition: [0, 0], endPosition: [5.19, 0] },
      { entityId: 'entity_bc', kind: 'lineSegment', startPosition: [5.19, 0], endPosition: [5.19, 9.48] },
      { entityId: 'entity_cd', kind: 'lineSegment', startPosition: [5.19, 9.48], endPosition: [0, 9.48] },
      { entityId: 'entity_da', kind: 'lineSegment', startPosition: [0, 9.48], endPosition: [0, 0] },
      { entityId: 'entity_circle', kind: 'circle', centerPosition: [2.595, 4.74], solvedRadius: 1 },
      {
        entityId: 'entity_ellipse',
        kind: 'ellipse',
        centerPosition: [2.595, 4.74],
        majorAxisEndpointPosition: [4.595, 4.74],
        minorRadius: 1,
      },
    ],
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
  }
}

function makePoint(pointId: string, position: readonly [number, number]) {
  return {
    pointId,
    label: pointId,
    target: { kind: 'sketchPoint' as const, sketchId: 'sketch_profile' as const, pointId },
    position,
    isConstruction: false,
  }
}

function makeLine(
  entityId: string,
  startPointId: string,
  endPointId: string,
  style?: SketchDefinition['entities'][number]['style'],
) {
  return {
    kind: 'lineSegment' as const,
    entityId,
    label: entityId,
    target: { kind: 'sketchEntity' as const, sketchId: 'sketch_profile' as const, entityId },
    isConstruction: false,
    startPointId,
    endPointId,
    style,
  }
}

function createSolvedSnapshot(): SolvedSketchSnapshot {
  return {
    schemaVersion: 'solved-sketch/v1alpha1',
    status: { solveState: 'notEvaluated', constraintState: 'unknown' },
    solvedEntities: [],
    solvedPoints: [],
    constraintStatuses: [],
    dimensionStatuses: [],
    diagnostics: [],
  }
}

function createRegion(): RegionRecord {
  return {
    ownerDocumentId: 'doc_export',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: 'sketch_profile',
    ownerBodyId: null,
    regionId: 'region_square',
    label: 'Square region',
    target: { kind: 'region', sketchId: 'sketch_profile', regionId: 'region_square' },
    sourceSketch: { kind: 'sketch', sketchId: 'sketch_profile' },
    isClosed: true,
    loops: [{
      loopId: 'region_loop_square_outer',
      role: 'outer',
      orientation: 'counterClockwise',
      isClosed: true,
      boundaryPointIds: ['point_a', 'point_b', 'point_c', 'point_d'],
      segments: [
        { source: { kind: 'entity', entityId: 'entity_ab' }, startPointId: 'point_a', endPointId: 'point_b', traversalDirection: 'forward' },
        { source: { kind: 'entity', entityId: 'entity_bc' }, startPointId: 'point_b', endPointId: 'point_c', traversalDirection: 'forward' },
        { source: { kind: 'entity', entityId: 'entity_cd' }, startPointId: 'point_c', endPointId: 'point_d', traversalDirection: 'forward' },
        { source: { kind: 'entity', entityId: 'entity_da' }, startPointId: 'point_d', endPointId: 'point_a', traversalDirection: 'forward' },
      ],
    }],
  }
}
