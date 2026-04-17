import type { SketchDefinition } from '@/contracts/sketch/schema'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'

export interface SketchSolverBenchmarkResult {
  fixture: string
  constraintCount: number
  pointCount: number
  elapsedMs: number
  solveState: string
  constraintState: string
}

const BENCHMARK_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const

export const SKETCH_SOLVER_BENCHMARK_CONSTRAINT_COUNTS = [10, 50, 150] as const

function createHorizontalLineBenchmarkDefinition(constraintCount: number): SketchDefinition {
  const points: SketchDefinition['points'] = []
  const entities: SketchDefinition['entities'] = []
  const constraints: SketchDefinition['constraints'] = []

  for (let index = 0; index < constraintCount; index += 1) {
    const startPointId = `sketch_point_${index}_start` as const
    const endPointId = `sketch_point_${index}_end` as const
    const entityId = `sketch_entity_${index}_line` as const
    const y = index * 0.2

    points.push(
      {
        pointId: startPointId,
        label: `P${index} start`,
        target: { kind: 'sketchPoint', sketchId: 'sketch_benchmark', pointId: startPointId },
        position: [0, y],
        isConstruction: false,
      },
      {
        pointId: endPointId,
        label: `P${index} end`,
        target: { kind: 'sketchPoint', sketchId: 'sketch_benchmark', pointId: endPointId },
        position: [1, y + 0.05],
        isConstruction: false,
      },
    )
    entities.push({
      kind: 'lineSegment',
      entityId,
      label: `Line ${index}`,
      target: { kind: 'sketchEntity', sketchId: 'sketch_benchmark', entityId },
      isConstruction: false,
      startPointId,
      endPointId,
    })
    constraints.push({
      constraintId: `constraint_${index}_horizontal` as const,
      kind: 'horizontal',
      label: `Horizontal ${index}`,
      entityId,
    })
  }

  return {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: entities.map((entity) => entity.entityId),
    entities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: [],
    dimensions: [],
  }
}

export function runSketchSolverBenchmark(): SketchSolverBenchmarkResult[] {
  return SKETCH_SOLVER_BENCHMARK_CONSTRAINT_COUNTS.map((constraintCount) => {
    const definition = createHorizontalLineBenchmarkDefinition(constraintCount)
    const startedAt = performance.now()
    const result = solveSketchDefinitionCore({
      definition,
      tolerances: BENCHMARK_TOLERANCES,
      partialSolvePolicy: 'bestEffort',
    })
    const elapsedMs = performance.now() - startedAt

    return {
      fixture: `${constraintCount}-horizontal-lines`,
      constraintCount,
      pointCount: definition.pointIds.length,
      elapsedMs,
      solveState: result.status.solveState,
      constraintState: result.status.constraintState,
    }
  })
}
