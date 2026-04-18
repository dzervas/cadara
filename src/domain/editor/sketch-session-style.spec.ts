import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import {
  createSketchSessionFromSnapshot,
  getSketchSessionDisplayRenderables,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

test('src/domain/editor/sketch-session-style.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const definition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: ['sketch_point_a', 'sketch_point_b'],
    points: [
      {
        pointId: 'sketch_point_a',
        label: 'A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_b',
        label: 'B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
        position: [4, 0],
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_ab'],
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_ab',
        label: 'AB',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_ab' },
        isConstruction: false,
        startPointId: 'sketch_point_a',
        endPointId: 'sketch_point_b',
        styleId: 'style_primary',
      },
    ],
    styles: [
      {
        styleId: 'style_primary',
        paint: { color: '#3366ff', opacity: 0.42 },
        stroke: { color: '#ff8844', opacity: 0.63, width: 2.5, dashSize: 0.8, gapSize: 0.3 },
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
  } as SketchDefinition & {
    styles: Array<{
      styleId: string
      paint: { color: string; opacity: number }
      stroke: { color: string; opacity: number; width: number; dashSize: number; gapSize: number }
    }>
  }

  const solved = solveSketchDefinitionCore({
    definition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })
  const plane = createStandardPlaneDefinition('xy')
  const session = createSketchSessionFromSnapshot({
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: 'sketch_primary',
    ownerBodyId: null,
    sketchId: 'sketch_primary',
    label: 'Sketch',
    plane,
    planeTarget: plane.support,
    planeKey: 'xy',
    sketch: {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_primary',
      ownerBodyId: null,
      sketchId: 'sketch_primary',
      label: 'Sketch',
      planeSupport: plane.support,
      definition,
      solvedSnapshot: solved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord)

  const lineRenderable = getSketchSessionDisplayRenderables(session).find((entry) => entry.id.includes('line'))
  assert(lineRenderable, 'Sketch line display renderable should exist.')
  assert(lineRenderable.target?.kind === 'sketchEntity', 'Styled renderables should preserve selection/picking target bindings.')
  assert(lineRenderable.linePattern === 'solid', 'Style metadata should not alter construction/line-pattern state.')
  assert(lineRenderable.paintStyle?.color === 0x3366ff, 'Paint style color should resolve from persisted style records.')
  assert(lineRenderable.paintStyle?.opacity === 0.42, 'Paint style opacity should resolve from persisted style records.')
  assert(lineRenderable.strokeStyle?.color === 0xff8844, 'Stroke style color should resolve from persisted style records.')
  assert(lineRenderable.strokeStyle?.opacity === 0.63, 'Stroke style opacity should resolve from persisted style records.')
  assert(lineRenderable.strokeStyle?.width === 2.5, 'Stroke style width should resolve from persisted style records.')
  assert(lineRenderable.strokeStyle?.dashSize === 0.8, 'Stroke dash size should resolve from persisted style records.')
  assert(lineRenderable.strokeStyle?.gapSize === 0.3, 'Stroke gap size should resolve from persisted style records.')

  const localDefinition = {
    ...definition,
    entities: [
      {
        ...definition.entities[0]!,
        styleId: undefined,
        style: {
          fillMode: 'gradient',
          fillColor: '#111111',
          gradientStartColor: '#2266ff',
          strokeEnabled: true,
          strokeColor: '#33ffaa',
          strokeWidth: 3,
          strokeCap: 'square',
          strokeJoin: 'miter',
          strokeMiterLimit: 7,
          strokeDashSize: 0.45,
          strokeGapSize: 0.15,
        },
      },
    ],
    styleIds: [],
    styles: [],
  } as SketchDefinition & {
    styles: []
  }
  const localSolved = solveSketchDefinitionCore({
    definition: localDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })
  const localSession = createSketchSessionFromSnapshot({
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: 'sketch_primary',
    ownerBodyId: null,
    sketchId: 'sketch_primary',
    label: 'Sketch',
    plane,
    planeTarget: plane.support,
    planeKey: 'xy',
    sketch: {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_primary',
      ownerBodyId: null,
      sketchId: 'sketch_primary',
      label: 'Sketch',
      planeSupport: plane.support,
      definition: localDefinition,
      solvedSnapshot: localSolved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord)

  const localLineRenderable = getSketchSessionDisplayRenderables(localSession).find((entry) => entry.id.includes('line'))
  assert(localLineRenderable?.paintStyle?.color === 0x111111, 'Local gradient fill should render with the documented fill-color fallback.')
  assert(localLineRenderable.strokeStyle?.color === 0x33ffaa, 'Local stroke color should render from inline style metadata.')
  assert(localLineRenderable.strokeStyle?.lineCap === 'square', 'Local stroke cap should remain available to display helpers.')
  assert(localLineRenderable.strokeStyle?.lineJoin === 'miter', 'Local stroke join should remain available to display helpers.')
  assert(localLineRenderable.strokeStyle?.miterLimit === 7, 'Local stroke miter limit should remain available to display helpers.')
  assert(localLineRenderable.strokeStyle?.dashSize === 0.45, 'Local stroke dash size should render from inline style metadata.')
  assert(localLineRenderable.strokeStyle?.gapSize === 0.15, 'Local stroke gap size should render from inline style metadata.')

  const disabledStrokeDefinition = {
    ...localDefinition,
    entities: [
      {
        ...localDefinition.entities[0]!,
        style: {
          strokeColor: '#ff00ff',
          strokeWidth: 6,
        },
      },
    ],
  } as SketchDefinition
  const disabledStrokeSolved = solveSketchDefinitionCore({
    definition: disabledStrokeDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })
  const disabledStrokeSession = createSketchSessionFromSnapshot({
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: 'sketch_primary',
    ownerBodyId: null,
    sketchId: 'sketch_primary',
    label: 'Sketch',
    plane,
    planeTarget: plane.support,
    planeKey: 'xy',
    sketch: {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_primary',
      ownerBodyId: null,
      sketchId: 'sketch_primary',
      label: 'Sketch',
      planeSupport: plane.support,
      definition: disabledStrokeDefinition,
      solvedSnapshot: disabledStrokeSolved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord)
  const disabledStrokeLineRenderable = getSketchSessionDisplayRenderables(disabledStrokeSession).find((entry) => entry.id.includes('line'))
  assert(
    disabledStrokeLineRenderable?.strokeStyle === undefined,
    'Local stroke fields should not render unless stroke styling is explicitly enabled.',
  )

  const pointStyledDefinition = {
    ...localDefinition,
    points: [
      {
        ...localDefinition.points[0]!,
        style: {
          strokeEnabled: true,
          strokeColor: '#dd44aa',
          strokeWidth: 2,
        },
      },
      localDefinition.points[1]!,
    ],
  } as SketchDefinition
  const pointStyledSolved = solveSketchDefinitionCore({
    definition: pointStyledDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })
  const pointStyledSession = createSketchSessionFromSnapshot({
    ownerDocumentId: 'doc_workspace',
    ownerRevisionId: 'rev_0001',
    ownerFeatureId: null,
    ownerSketchId: 'sketch_primary',
    ownerBodyId: null,
    sketchId: 'sketch_primary',
    label: 'Sketch',
    plane,
    planeTarget: plane.support,
    planeKey: 'xy',
    sketch: {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: 'sketch_primary',
      ownerBodyId: null,
      sketchId: 'sketch_primary',
      label: 'Sketch',
      planeSupport: plane.support,
      definition: pointStyledDefinition,
      solvedSnapshot: pointStyledSolved.solvedSnapshot,
      regions: [],
    },
  } satisfies SketchSnapshotRecord)
  const pointRenderable = getSketchSessionDisplayRenderables(pointStyledSession).find((entry) =>
    entry.target?.kind === 'sketchPoint' && entry.target.pointId === 'sketch_point_a',
  )
  assert(pointRenderable?.strokeStyle?.color === 0xdd44aa, 'Point marker renderables should resolve enabled local stroke style.')
})
