import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { SolvedSketchSnapshot } from '@/contracts/sketch/schema'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import {
  createSketchSessionFromSnapshot,
  getSketchConstraintDisplayForTarget,
  getSketchConstraintDisplaySummary,
  getSketchSessionDisplayRenderables,
  normalizeSketchConstraintDisplayState,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

test('src/domain/editor/sketch-session-style.spec.ts', () => {  const definition = {
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
        stroke: {
          color: '#ff8844',
          opacity: 0.63,
          width: 2.5,
          lineCap: 'butt',
          lineJoin: 'bevel',
          miterLimit: 5,
          dashSize: 0.8,
          gapSize: 0.3,
        },
      },
    ],
    constraintIds: [],
    constraints: [],
    dimensionIds: [],
    dimensions: [],
    svgRenderingEnabled: true,
  } as SketchDefinition & {
    styles: Array<{
      styleId: string
      paint: { color: string; opacity: number }
      stroke: {
        color: string
        opacity: number
        width: number
        lineCap: 'butt'
        lineJoin: 'bevel'
        miterLimit: number
        dashSize: number
        gapSize: number
      }
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
  expectTrue(lineRenderable, 'Sketch line display renderable should exist.')
  expectTrue(lineRenderable.target?.kind === 'sketchEntity', 'Styled renderables should preserve selection/picking target bindings.')
  expectTrue(lineRenderable.linePattern === 'solid', 'Style metadata should not alter construction/line-pattern state.')
  expectTrue(lineRenderable.paintStyle?.color === 0x3366ff, 'Paint style color should resolve from persisted style records.')
  expectTrue(lineRenderable.paintStyle?.opacity === 0.42, 'Paint style opacity should resolve from persisted style records.')
  expectTrue(lineRenderable.strokeStyle?.color === 0xff8844, 'Stroke style color should resolve from persisted style records.')
  expectTrue(lineRenderable.strokeStyle?.opacity === 0.63, 'Stroke style opacity should resolve from persisted style records.')
  expectTrue(lineRenderable.strokeStyle?.width === 2.5, 'Stroke style width should resolve from persisted style records.')
  expectTrue(lineRenderable.strokeStyle?.lineCap === 'butt', 'Persisted stroke cap should resolve through display renderables.')
  expectTrue(lineRenderable.strokeStyle?.lineJoin === 'bevel', 'Persisted stroke join should resolve through display renderables.')
  expectTrue(lineRenderable.strokeStyle?.miterLimit === 5, 'Persisted stroke miter limit should resolve through display renderables.')
  expectTrue(lineRenderable.strokeStyle?.dashSize === 0.8, 'Stroke dash size should resolve from persisted style records.')
  expectTrue(lineRenderable.strokeStyle?.gapSize === 0.3, 'Stroke gap size should resolve from persisted style records.')

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
  expectTrue(localLineRenderable?.paintStyle?.color === 0x111111, 'Local gradient fill should render with the documented fill-color fallback.')
  expectTrue(localLineRenderable.strokeStyle?.color === 0x33ffaa, 'Local stroke color should render from inline style metadata.')
  expectTrue(localLineRenderable.strokeStyle?.lineCap === 'square', 'Local stroke cap should remain available to display helpers.')
  expectTrue(localLineRenderable.strokeStyle?.lineJoin === 'miter', 'Local stroke join should remain available to display helpers.')
  expectTrue(localLineRenderable.strokeStyle?.miterLimit === 7, 'Local stroke miter limit should remain available to display helpers.')
  expectTrue(localLineRenderable.strokeStyle?.dashSize === 0.45, 'Local stroke dash size should render from inline style metadata.')
  expectTrue(localLineRenderable.strokeStyle?.gapSize === 0.15, 'Local stroke gap size should render from inline style metadata.')

  const regionDefinition = {
    ...definition,
    pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
    points: [
      definition.points[0]!,
      definition.points[1]!,
      {
        pointId: 'sketch_point_c',
        label: 'C',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_c' },
        position: [0, 4],
        isConstruction: false,
      },
    ],
    entityIds: [],
    entities: [],
    styles: [
      {
        styleId: 'style_region_gradient',
        label: 'Region gradient',
        target: { kind: 'region', regionId: 'region_primary' },
        fill: {
          kind: 'gradient',
          gradient: {
            kind: 'linear',
            angleRadians: Math.PI / 3,
            startColor: '#2266ff',
            startOpacity: 0.21,
            endColor: '#ffaa33',
            endOpacity: 0.74,
          },
        },
        stroke: {
          color: '#1188aa',
          opacity: 0.52,
          width: 4,
          lineCap: 'square',
          lineJoin: 'miter',
          miterLimit: 9,
          dashSize: 1.25,
          gapSize: 0.5,
        },
      },
    ],
  } as SketchDefinition
  const regionSolved = solveSketchDefinitionCore({
    definition: regionDefinition,
    tolerances: {
      coincidence: 1e-6,
      angleRadians: 1e-6,
      minimumSegmentLength: 1e-6,
    },
    partialSolvePolicy: 'bestEffort',
  })
  const regionSession = {
    ...createSketchSessionFromSnapshot({
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
        definition: regionDefinition,
        solvedSnapshot: regionSolved.solvedSnapshot,
        regions: [{
          ownerDocumentId: 'doc_workspace',
          ownerRevisionId: 'rev_0001',
          ownerFeatureId: null,
          ownerSketchId: 'sketch_primary',
          ownerBodyId: null,
          regionId: 'region_primary',
          label: 'Primary region',
          target: { kind: 'region', sketchId: 'sketch_primary', regionId: 'region_primary' },
          sourceSketch: { kind: 'sketch', sketchId: 'sketch_primary' },
          loops: [{
            role: 'outer',
            segments: [],
            boundaryPointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
            isClosed: true,
          }],
          isClosed: true,
        }],
      },
    } satisfies SketchSnapshotRecord),
    definition: regionDefinition,
  }
  const regionRenderable = getSketchSessionDisplayRenderables(regionSession).find((entry) => entry.semanticClass === 'region')
  expectTrue(regionRenderable?.paintStyle?.kind === 'linearGradient', 'Region style records should preserve gradient fill metadata through display renderables.')
  expectTrue(
    regionRenderable.paintStyle.startColor === 0x2266ff
      && regionRenderable.paintStyle.startOpacity === 0.21
      && regionRenderable.paintStyle.endColor === 0xffaa33
      && regionRenderable.paintStyle.endOpacity === 0.74
      && regionRenderable.paintStyle.angleRadians === Math.PI / 3,
    'Region gradient display metadata should preserve colors, opacities, and angle.',
  )
  expectTrue(regionRenderable.strokeStyle?.lineCap === 'square', 'Region style record stroke cap should reach display renderables.')
  expectTrue(regionRenderable.strokeStyle.lineJoin === 'miter', 'Region style record stroke join should reach display renderables.')
  expectTrue(regionRenderable.strokeStyle.miterLimit === 9, 'Region style record miter limit should reach display renderables.')
  expectTrue(
    regionRenderable.strokeStyle.dashSize === 1.25 && regionRenderable.strokeStyle.gapSize === 0.5,
    'Region style record dash and gap should reach display renderables.',
  )

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
  expectTrue(
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
  expectTrue(pointRenderable?.strokeStyle?.color === 0xdd44aa, 'Point marker renderables should resolve enabled local stroke style.')

  expectTrue(
    normalizeSketchConstraintDisplayState({ solveState: 'solved', constraintState: 'wellConstrained' }, 0) === 'constrained',
    'Well constrained solver status should normalize to constrained display state.',
  )
  expectTrue(
    normalizeSketchConstraintDisplayState({ solveState: 'solved', constraintState: 'unknown' }, 0) === 'underconstrained',
    'Unknown solver constrainedness should normalize to underconstrained display state.',
  )
  expectTrue(
    normalizeSketchConstraintDisplayState({ solveState: 'solved', constraintState: 'inconsistent' }, 0) === 'overconstrained',
    'Inconsistent solver constrainedness should normalize to overconstrained display state.',
  )
  expectTrue(
    normalizeSketchConstraintDisplayState({ solveState: 'partiallySolved', constraintState: 'underConstrained' }, 1) === 'overconstrained',
    'Partial solves with known affected geometry should normalize to overconstrained display state.',
  )

  const constrainedDefinition = {
    ...definition,
    constraintIds: ['constraint_horizontal'],
    constraints: [{
      kind: 'horizontal',
      constraintId: 'constraint_horizontal',
      label: 'Horizontal',
      entityId: 'sketch_entity_ab',
    }],
  } as SketchDefinition
  const unsatisfiedSnapshot: SolvedSketchSnapshot = {
    schemaVersion: 'solved-sketch/v1alpha1',
    status: { solveState: 'partiallySolved', constraintState: 'underConstrained' },
    solvedEntities: [],
    solvedPoints: [],
    constraintStatuses: [{ constraintId: 'constraint_horizontal', status: 'unsatisfied' }],
    dimensionStatuses: [],
    diagnostics: [],
  }
  const displaySummary = getSketchConstraintDisplaySummary({
    sketchId: 'sketch_primary',
    definition: constrainedDefinition,
    solvedSnapshot: unsatisfiedSnapshot,
  })
  expectTrue(displaySummary.state === 'overconstrained', 'Unsatisfied partial solve display summary should be overconstrained.')
  expectTrue(
    getSketchConstraintDisplayForTarget(
      { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_ab' },
      displaySummary,
    ).isAffectedOverconstraint,
    'Unsatisfied constraints should mark only their affected sketch geometry targets.',
  )
  expectTrue(
    !getSketchConstraintDisplayForTarget(
      { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
      displaySummary,
    ).isAffectedOverconstraint,
    'Unaffected geometry should not receive overconstraint diagnostics.',
  )
})
