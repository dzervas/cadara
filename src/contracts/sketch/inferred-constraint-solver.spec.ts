import { test } from 'bun:test'

import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import type { SketchDefinition } from '@/contracts/sketch/schema'

test('src/contracts/sketch/inferred-constraint-solver.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  } as const

  const definition: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_line_a',
      'sketch_point_line_b',
      'sketch_point_mid',
      'sketch_point_curve',
      'sketch_point_circle_center',
    ],
    points: [
      {
        pointId: 'sketch_point_line_a',
        label: 'Line A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_line_a' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_line_b',
        label: 'Line B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_line_b' },
        position: [4, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_mid',
        label: 'Mid',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_mid' },
        position: [1, 2],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_curve',
        label: 'Curve point',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_curve' },
        position: [2, 3],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_circle_center',
        label: 'Circle center',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_circle_center' },
        position: [7, 3],
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_line', 'sketch_entity_circle'],
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_line',
        label: 'Line',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_line' },
        isConstruction: false,
        startPointId: 'sketch_point_line_a',
        endPointId: 'sketch_point_line_b',
      },
      {
        kind: 'circle',
        entityId: 'sketch_entity_circle',
        label: 'Circle',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_circle' },
        isConstruction: false,
        centerPointId: 'sketch_point_circle_center',
        radius: 2,
      },
    ],
    constraintIds: [
      'constraint_midpoint',
      'constraint_point_on_curve',
      'constraint_fix_line_a',
      'constraint_fix_line_b',
      'constraint_fix_circle_center',
    ],
    constraints: [
      {
        constraintId: 'constraint_midpoint',
        kind: 'midpoint',
        label: 'Midpoint',
        point: { kind: 'localPoint', pointId: 'sketch_point_mid' },
        line: { kind: 'localEntity', entityId: 'sketch_entity_line' },
      },
      {
        constraintId: 'constraint_point_on_curve',
        kind: 'pointOnCurve',
        label: 'Point on circle',
        point: { kind: 'localPoint', pointId: 'sketch_point_curve' },
        curve: { kind: 'localEntity', entityId: 'sketch_entity_circle' },
      },
      {
        constraintId: 'constraint_fix_line_a',
        kind: 'fixPoint',
        label: 'Fix line A',
        pointId: 'sketch_point_line_a',
        position: [0, 0],
      },
      {
        constraintId: 'constraint_fix_line_b',
        kind: 'fixPoint',
        label: 'Fix line B',
        pointId: 'sketch_point_line_b',
        position: [4, 0],
      },
      {
        constraintId: 'constraint_fix_circle_center',
        kind: 'fixPoint',
        label: 'Fix circle center',
        pointId: 'sketch_point_circle_center',
        position: [7, 3],
      },
    ],
    dimensionIds: [],
    dimensions: [],
  }

  const parsed = sketchDefinitionSchema.safeParse(definition)
  assert(parsed.success, 'Runtime schema should accept inferred local constraint variants.')

  const solved = solveSketchDefinitionCore({
    definition,
    tolerances,
    partialSolvePolicy: 'bestEffort',
  })
  const solvedPoints = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
  const mid = solvedPoints.get('sketch_point_mid')
  const curvePoint = solvedPoints.get('sketch_point_curve')
  assert(mid, 'Midpoint solve should return the midpoint target point.')
  assert(curvePoint, 'Point-on-curve solve should return the curve target point.')
  assert(Math.hypot(mid[0] - 2, mid[1]) < 1e-3, 'Midpoint constraint should solve the point to the line midpoint.')
  assert(Math.abs(Math.hypot(curvePoint[0] - 7, curvePoint[1] - 3) - 2) < 1e-3, 'Point-on-curve should solve the point onto the circle.')
  assert(
    solved.solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied'),
    'Solved inferred constraints should report satisfied statuses.',
  )

  const tangentAndConcentric: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_line_tangent_a',
      'sketch_point_line_tangent_b',
      'sketch_point_circle_a_center',
      'sketch_point_circle_b_center',
    ],
    points: [
      {
        pointId: 'sketch_point_line_tangent_a',
        label: 'Tangent A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_line_tangent_a' },
        position: [-3, 2],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_line_tangent_b',
        label: 'Tangent B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_line_tangent_b' },
        position: [3, 2],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_circle_a_center',
        label: 'Circle A center',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_circle_a_center' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_circle_b_center',
        label: 'Circle B center',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_circle_b_center' },
        position: [0, 0],
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_tangent_line', 'sketch_entity_circle_a', 'sketch_entity_circle_b'],
    entities: [
      {
        kind: 'lineSegment',
        entityId: 'sketch_entity_tangent_line',
        label: 'Tangent line',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_tangent_line' },
        isConstruction: false,
        startPointId: 'sketch_point_line_tangent_a',
        endPointId: 'sketch_point_line_tangent_b',
      },
      {
        kind: 'circle',
        entityId: 'sketch_entity_circle_a',
        label: 'Circle A',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_circle_a' },
        isConstruction: false,
        centerPointId: 'sketch_point_circle_a_center',
        radius: 2,
      },
      {
        kind: 'circle',
        entityId: 'sketch_entity_circle_b',
        label: 'Circle B',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_circle_b' },
        isConstruction: false,
        centerPointId: 'sketch_point_circle_b_center',
        radius: 1,
      },
    ],
    constraintIds: ['constraint_tangent', 'constraint_concentric'],
    constraints: [
      {
        constraintId: 'constraint_tangent',
        kind: 'tangent',
        label: 'Tangent',
        entityIds: ['sketch_entity_tangent_line', 'sketch_entity_circle_a'],
        relation: 'external',
      },
      {
        constraintId: 'constraint_concentric',
        kind: 'concentric',
        label: 'Concentric',
        entityIds: ['sketch_entity_circle_a', 'sketch_entity_circle_b'],
      },
    ],
    dimensionIds: [],
    dimensions: [],
  }
  const tangentSolved = solveSketchDefinitionCore({
    definition: tangentAndConcentric,
    tolerances,
    partialSolvePolicy: 'bestEffort',
  })
  assert(
    tangentSolved.solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied'),
    'Already satisfied tangent and concentric constraints should report satisfied statuses.',
  )

  function solveConstraintStatus(definition: SketchDefinition, constraintId: string) {
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })

    return solved.solvedSnapshot.constraintStatuses.find((status) => status.constraintId === constraintId)?.status
  }

  const circleArcOutsideSweep: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_circle_center',
      'sketch_point_arc_center',
      'sketch_point_arc_start',
      'sketch_point_arc_end',
    ],
    points: [
      {
        pointId: 'sketch_point_circle_center',
        label: 'Circle center',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_circle_center' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_arc_center',
        label: 'Arc center',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_arc_center' },
        position: [3, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_arc_start',
        label: 'Arc start',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_arc_start' },
        position: [3, -2],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_arc_end',
        label: 'Arc end',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_arc_end' },
        position: [3, 2],
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_circle', 'sketch_entity_arc'],
    entities: [
      {
        kind: 'circle',
        entityId: 'sketch_entity_circle',
        label: 'Circle',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_circle' },
        isConstruction: false,
        centerPointId: 'sketch_point_circle_center',
        radius: 1,
      },
      {
        kind: 'arc',
        entityId: 'sketch_entity_arc',
        label: 'Arc',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_arc' },
        isConstruction: false,
        centerPointId: 'sketch_point_arc_center',
        startPointId: 'sketch_point_arc_start',
        endPointId: 'sketch_point_arc_end',
        sweepDirection: 'counterClockwise',
      },
    ],
    constraintIds: [
      'constraint_fix_circle_center',
      'constraint_fix_arc_center',
      'constraint_fix_arc_start',
      'constraint_fix_arc_end',
      'constraint_circle_arc_tangent',
    ],
    constraints: [
      {
        constraintId: 'constraint_fix_circle_center',
        kind: 'fixPoint',
        label: 'Fix circle center',
        pointId: 'sketch_point_circle_center',
        position: [0, 0],
      },
      {
        constraintId: 'constraint_fix_arc_center',
        kind: 'fixPoint',
        label: 'Fix arc center',
        pointId: 'sketch_point_arc_center',
        position: [3, 0],
      },
      {
        constraintId: 'constraint_fix_arc_start',
        kind: 'fixPoint',
        label: 'Fix arc start',
        pointId: 'sketch_point_arc_start',
        position: [3, -2],
      },
      {
        constraintId: 'constraint_fix_arc_end',
        kind: 'fixPoint',
        label: 'Fix arc end',
        pointId: 'sketch_point_arc_end',
        position: [3, 2],
      },
      {
        constraintId: 'constraint_circle_arc_tangent',
        kind: 'tangent',
        label: 'Circle to finite arc tangent',
        entityIds: ['sketch_entity_circle', 'sketch_entity_arc'],
        relation: 'external',
      },
    ],
    dimensionIds: ['dimension_arc_start', 'dimension_arc_end'],
    dimensions: [
      {
        dimensionId: 'dimension_arc_start',
        kind: 'arcStartPointCoincident',
        label: 'Arc start',
        entityId: 'sketch_entity_arc',
        pointId: 'sketch_point_arc_start',
      },
      {
        dimensionId: 'dimension_arc_end',
        kind: 'arcEndPointCoincident',
        label: 'Arc end',
        entityId: 'sketch_entity_arc',
        pointId: 'sketch_point_arc_end',
      },
    ],
  }
  assert(
    solveConstraintStatus(circleArcOutsideSweep, 'constraint_circle_arc_tangent') === 'unsatisfied',
    'Circle-to-arc tangent should be unsatisfied when the tangent contact is outside the finite arc sweep.',
  )

  const arcArcOutsideSweep: SketchDefinition = {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: [
      'sketch_point_first_arc_center',
      'sketch_point_first_arc_start',
      'sketch_point_first_arc_end',
      'sketch_point_second_arc_center',
      'sketch_point_second_arc_start',
      'sketch_point_second_arc_end',
    ],
    points: [
      {
        pointId: 'sketch_point_first_arc_center',
        label: 'First arc center',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_first_arc_center' },
        position: [0, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_first_arc_start',
        label: 'First arc start',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_first_arc_start' },
        position: [0, -1],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_first_arc_end',
        label: 'First arc end',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_first_arc_end' },
        position: [0, 1],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_second_arc_center',
        label: 'Second arc center',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_second_arc_center' },
        position: [3, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_second_arc_start',
        label: 'Second arc start',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_second_arc_start' },
        position: [3, -2],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_second_arc_end',
        label: 'Second arc end',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_second_arc_end' },
        position: [3, 2],
        isConstruction: false,
      },
    ],
    entityIds: ['sketch_entity_first_arc', 'sketch_entity_second_arc'],
    entities: [
      {
        kind: 'arc',
        entityId: 'sketch_entity_first_arc',
        label: 'First arc',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_first_arc' },
        isConstruction: false,
        centerPointId: 'sketch_point_first_arc_center',
        startPointId: 'sketch_point_first_arc_start',
        endPointId: 'sketch_point_first_arc_end',
        sweepDirection: 'clockwise',
      },
      {
        kind: 'arc',
        entityId: 'sketch_entity_second_arc',
        label: 'Second arc',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_second_arc' },
        isConstruction: false,
        centerPointId: 'sketch_point_second_arc_center',
        startPointId: 'sketch_point_second_arc_start',
        endPointId: 'sketch_point_second_arc_end',
        sweepDirection: 'counterClockwise',
      },
    ],
    constraintIds: [
      'constraint_fix_first_arc_center',
      'constraint_fix_first_arc_start',
      'constraint_fix_first_arc_end',
      'constraint_fix_second_arc_center',
      'constraint_fix_second_arc_start',
      'constraint_fix_second_arc_end',
      'constraint_arc_arc_tangent',
    ],
    constraints: [
      {
        constraintId: 'constraint_fix_first_arc_center',
        kind: 'fixPoint',
        label: 'Fix first arc center',
        pointId: 'sketch_point_first_arc_center',
        position: [0, 0],
      },
      {
        constraintId: 'constraint_fix_first_arc_start',
        kind: 'fixPoint',
        label: 'Fix first arc start',
        pointId: 'sketch_point_first_arc_start',
        position: [0, -1],
      },
      {
        constraintId: 'constraint_fix_first_arc_end',
        kind: 'fixPoint',
        label: 'Fix first arc end',
        pointId: 'sketch_point_first_arc_end',
        position: [0, 1],
      },
      {
        constraintId: 'constraint_fix_second_arc_center',
        kind: 'fixPoint',
        label: 'Fix second arc center',
        pointId: 'sketch_point_second_arc_center',
        position: [3, 0],
      },
      {
        constraintId: 'constraint_fix_second_arc_start',
        kind: 'fixPoint',
        label: 'Fix second arc start',
        pointId: 'sketch_point_second_arc_start',
        position: [3, -2],
      },
      {
        constraintId: 'constraint_fix_second_arc_end',
        kind: 'fixPoint',
        label: 'Fix second arc end',
        pointId: 'sketch_point_second_arc_end',
        position: [3, 2],
      },
      {
        constraintId: 'constraint_arc_arc_tangent',
        kind: 'tangent',
        label: 'Finite arc tangent',
        entityIds: ['sketch_entity_first_arc', 'sketch_entity_second_arc'],
        relation: 'external',
      },
    ],
    dimensionIds: [
      'dimension_first_arc_start',
      'dimension_first_arc_end',
      'dimension_second_arc_start',
      'dimension_second_arc_end',
    ],
    dimensions: [
      {
        dimensionId: 'dimension_first_arc_start',
        kind: 'arcStartPointCoincident',
        label: 'First arc start',
        entityId: 'sketch_entity_first_arc',
        pointId: 'sketch_point_first_arc_start',
      },
      {
        dimensionId: 'dimension_first_arc_end',
        kind: 'arcEndPointCoincident',
        label: 'First arc end',
        entityId: 'sketch_entity_first_arc',
        pointId: 'sketch_point_first_arc_end',
      },
      {
        dimensionId: 'dimension_second_arc_start',
        kind: 'arcStartPointCoincident',
        label: 'Second arc start',
        entityId: 'sketch_entity_second_arc',
        pointId: 'sketch_point_second_arc_start',
      },
      {
        dimensionId: 'dimension_second_arc_end',
        kind: 'arcEndPointCoincident',
        label: 'Second arc end',
        entityId: 'sketch_entity_second_arc',
        pointId: 'sketch_point_second_arc_end',
      },
    ],
  }
  assert(
    solveConstraintStatus(arcArcOutsideSweep, 'constraint_arc_arc_tangent') === 'unsatisfied',
    'Arc-to-arc tangent should be unsatisfied when either tangent contact is outside a finite arc sweep.',
  )
})
