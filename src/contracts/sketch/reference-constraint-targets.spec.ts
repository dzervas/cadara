import { test } from 'bun:test'

import { sketchDefinitionSchema } from '@/contracts/sketch/runtime-schema'
import {
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
} from '@/contracts/sketch/solver-core'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'

test('src/contracts/sketch/reference-constraint-targets.spec.ts', async () => {
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

  function makeBaseDefinition(constraint: SketchDefinition['constraints'][number]): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: ['ref_edge'],
      references: [{
        referenceId: 'ref_edge',
        kind: 'modelReference',
        label: 'Projected edge',
        source: { kind: 'edge', bodyId: 'body_1', edgeId: 'edge_1' },
        projectionMode: 'projectAlongPlaneNormal',
      }],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        {
          pointId: 'sketch_point_a',
          label: 'A',
          target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
          position: [0, 3],
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_b',
          label: 'B',
          target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
          position: [4, 5],
          isConstruction: false,
        },
      ],
      entityIds: ['sketch_entity_line'],
      entities: [{
        kind: 'lineSegment',
        entityId: 'sketch_entity_line',
        label: 'Line',
        target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_line' },
        isConstruction: false,
        startPointId: 'sketch_point_a',
        endPointId: 'sketch_point_b',
      }],
      constraintIds: [constraint.constraintId],
      constraints: [constraint],
      dimensionIds: [],
      dimensions: [],
    }
  }

  const projectedLine: ProjectedSketchReferenceRecord = {
    referenceId: 'ref_edge',
    status: 'projected',
    geometry: [{
      geometryId: 'projected_geometry_line',
      kind: 'lineSegment',
      startPosition: [0, 0],
      endPosition: [10, 0],
    }],
    diagnostics: [],
  }
  const projectedArc: ProjectedSketchReferenceRecord = {
    referenceId: 'ref_edge',
    status: 'projected',
    geometry: [{
      geometryId: 'projected_geometry_arc',
      kind: 'arc',
      centerPosition: [0, 0],
      startPosition: [5, 0],
      endPosition: [0, 5],
      sweepDirection: 'counterClockwise',
    }],
    diagnostics: [],
  }

  const pointOnProjectedLine = makeBaseDefinition({
    constraintId: 'constraint_point_on_projected_geometry_line',
    kind: 'pointOnProjectedCurve',
    label: 'Point on projected line',
    point: { kind: 'localPoint', pointId: 'sketch_point_a' },
    projectedCurve: {
      kind: 'projectedGeometry',
      reference: {
        kind: 'projectedLineSegment',
        referenceId: 'ref_edge',
        geometryId: 'projected_geometry_line',
      },
    },
  })

  const parsed = sketchDefinitionSchema.safeParse(pointOnProjectedLine)
  assert(parsed.success, 'Runtime schema should accept reference-targeted constraint payloads.')

  const solved = solveSketchDefinitionCore({
    definition: pointOnProjectedLine,
    projectedReferences: [projectedLine],
    tolerances,
    partialSolvePolicy: 'bestEffort',
  })
  const solvedPoint = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_a')
  assert(solvedPoint, 'Reference-targeted solve should return the local point.')
  assert(Math.abs(solvedPoint.solvedPosition[1]) < 1e-4, 'Point-on-projected-line should solve local point onto projected line.')
  assert(
    solved.solvedSnapshot.constraintStatuses[0]?.status === 'satisfied',
    'Satisfied reference-targeted constraints should report satisfied status.',
  )

  const invalid = validateSketchDefinitionCore({
    definition: pointOnProjectedLine,
    projectedReferences: [],
    tolerances,
  })
  assert(!invalid.isValid, 'Missing projected target should invalidate the solve request.')
  assert(
    invalid.diagnostics.some((diagnostic) => diagnostic.code === 'missing-projected-constraint-target'),
    'Missing projected target should produce a machine-readable diagnostic.',
  )

  const pointOnProjectedArc = {
    ...makeBaseDefinition({
      constraintId: 'constraint_point_on_projected_geometry_arc',
      kind: 'pointOnProjectedCurve',
      label: 'Point on projected arc',
      point: { kind: 'localPoint', pointId: 'sketch_point_a' },
      projectedCurve: {
        kind: 'projectedGeometry',
        reference: {
          kind: 'projectedArc',
          referenceId: 'ref_edge',
          geometryId: 'projected_geometry_arc',
        },
      },
    }),
    points: [
      {
        pointId: 'sketch_point_a',
        label: 'A',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
        position: [-5, 0],
        isConstruction: false,
      },
      {
        pointId: 'sketch_point_b',
        label: 'B',
        target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
        position: [4, 5],
        isConstruction: false,
      },
    ],
  } satisfies SketchDefinition
  const solvedArcPoint = solveSketchDefinitionCore({
    definition: pointOnProjectedArc,
    projectedReferences: [projectedArc],
    tolerances,
    partialSolvePolicy: 'bestEffort',
  })
  const arcPoint = solvedArcPoint.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_a')
  assert(arcPoint, 'Point-on-projected-arc solve should return the local point.')
  assert(
    Math.min(
      Math.hypot(arcPoint.solvedPosition[0] - 5, arcPoint.solvedPosition[1]),
      Math.hypot(arcPoint.solvedPosition[0], arcPoint.solvedPosition[1] - 5),
    ) < 1e-3,
    'Point-on-projected-arc should solve to the finite arc sweep instead of the full parent circle.',
  )
  assert(
    solvedArcPoint.solvedSnapshot.constraintStatuses[0]?.status === 'satisfied',
    'Point-on-projected-arc should report satisfied when solved onto the finite arc.',
  )

  const perpendicular = solveSketchDefinitionCore({
    definition: makeBaseDefinition({
      constraintId: 'constraint_perpendicular_projected_geometry_line',
      kind: 'perpendicularProjectedLine',
      label: 'Perpendicular projected line',
      line: { kind: 'localEntity', entityId: 'sketch_entity_line' },
      projectedLine: {
        kind: 'projectedGeometry',
        reference: {
          kind: 'projectedLineSegment',
          referenceId: 'ref_edge',
          geometryId: 'projected_geometry_line',
        },
      },
    }),
    projectedReferences: [projectedLine],
    tolerances,
    partialSolvePolicy: 'bestEffort',
  })
  const solvedLine = perpendicular.solvedSnapshot.solvedEntities.find((entity) => entity.entityId === 'sketch_entity_line')
  assert(solvedLine?.kind === 'lineSegment', 'Projected perpendicular solve should return local solved line.')
  assert(
    Math.abs(solvedLine.endPosition[0] - solvedLine.startPosition[0]) < 1e-3,
    'Perpendicular-to-projected-line should solve the local line vertical against a horizontal projected line.',
  )

  const tangentOutsideArc = solveSketchDefinitionCore({
    definition: {
      ...makeBaseDefinition({
        constraintId: 'constraint_tangent_projected_geometry_arc',
        kind: 'tangentProjectedCurve',
        label: 'Tangent projected arc',
        curve: { kind: 'localEntity', entityId: 'sketch_entity_line' },
        projectedCurve: {
          kind: 'projectedGeometry',
          reference: {
            kind: 'projectedArc',
            referenceId: 'ref_edge',
            geometryId: 'projected_geometry_arc',
          },
        },
        relation: 'external',
      }),
      points: [
        {
          pointId: 'sketch_point_a',
          label: 'A',
          target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_a' },
          position: [-5, -10],
          isConstruction: false,
        },
        {
          pointId: 'sketch_point_b',
          label: 'B',
          target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: 'sketch_point_b' },
          position: [-5, 10],
          isConstruction: false,
        },
      ],
      constraintIds: [
        'constraint_tangent_projected_geometry_arc',
        'constraint_fix_tangent_line_start',
        'constraint_fix_tangent_line_end',
      ],
      constraints: [
        {
          constraintId: 'constraint_tangent_projected_geometry_arc',
          kind: 'tangentProjectedCurve',
          label: 'Tangent projected arc',
          curve: { kind: 'localEntity', entityId: 'sketch_entity_line' },
          projectedCurve: {
            kind: 'projectedGeometry',
            reference: {
              kind: 'projectedArc',
              referenceId: 'ref_edge',
              geometryId: 'projected_geometry_arc',
            },
          },
          relation: 'external',
        },
        {
          constraintId: 'constraint_fix_tangent_line_start',
          kind: 'fixPoint',
          label: 'Fix line start',
          pointId: 'sketch_point_a',
          position: [-5, -10],
        },
        {
          constraintId: 'constraint_fix_tangent_line_end',
          kind: 'fixPoint',
          label: 'Fix line end',
          pointId: 'sketch_point_b',
          position: [-5, 10],
        },
      ],
    },
    projectedReferences: [projectedArc],
    tolerances,
    partialSolvePolicy: 'bestEffort',
  })
  const tangentStatus = tangentOutsideArc.solvedSnapshot.constraintStatuses.find(
    (status) => status.constraintId === 'constraint_tangent_projected_geometry_arc',
  )
  assert(
    tangentStatus?.status === 'unsatisfied',
    'Tangent-to-projected-arc should reject tangency points outside the finite arc sweep.',
  )
})
