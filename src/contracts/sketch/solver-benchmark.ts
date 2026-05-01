import type { AuthoredSketchRecord } from '@/contracts/modeling/authored-document'
import type { DimensionDefinition, SketchDefinition, SketchPoint2D } from '@/contracts/sketch/schema'
import { deriveSketchRegionsCore } from '@/contracts/sketch/region-extraction'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import type { ConstraintId, ConstructionId, DimensionId, SketchEntityId, SketchId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition, SketchPlaneKey } from '@/contracts/shared/sketch-plane'

export interface SketchSolverBenchmarkFixture {
  name: string
  description: string
  sketch: AuthoredSketchRecord
  expectedAnnotationCount: number
  expectedRegionCount: number
}

export interface SketchSolverBenchmarkEvaluation {
  fixture: string
  annotationCount: number
  constraintCount: number
  dimensionCount: number
  pointCount: number
  entityCount: number
  regionCount: number
  loopCount: number
  diagnosticCount: number
  solveState: string
  constraintState: string
}

const BENCHMARK_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const

type MutableSketchDefinitionParts = {
  points: SketchDefinition['points']
  entities: SketchDefinition['entities']
  constraints: SketchDefinition['constraints']
  dimensions: SketchDefinition['dimensions']
}

function createPointId(name: string) {
  return `sketch_point_${name}` as SketchPointId
}

function createEntityId(name: string) {
  return `sketch_entity_${name}` as SketchEntityId
}

function createConstraintId(name: string) {
  return `constraint_${name}` as ConstraintId
}

function createDimensionId(name: string) {
  return `dimension_${name}` as DimensionId
}

function makePoint(sketchId: SketchId, name: string, label: string, position: SketchPoint2D) {
  const pointId = createPointId(name)
  return {
    pointId,
    label,
    target: { kind: 'sketchPoint', sketchId, pointId },
    position,
    isConstruction: false,
  } satisfies SketchDefinition['points'][number]
}

function makeLine(
  sketchId: SketchId,
  name: string,
  label: string,
  startPointId: SketchPointId,
  endPointId: SketchPointId,
) {
  const entityId = createEntityId(name)
  return {
    kind: 'lineSegment',
    entityId,
    label,
    target: { kind: 'sketchEntity', sketchId, entityId },
    isConstruction: false,
    startPointId,
    endPointId,
  } satisfies SketchDefinition['entities'][number]
}

function makeHorizontalConstraint(name: string, entityId: SketchEntityId) {
  return {
    constraintId: createConstraintId(name),
    kind: 'horizontal',
    label: `Horizontal ${name}`,
    entityId,
  } satisfies SketchDefinition['constraints'][number]
}

function makeVerticalConstraint(name: string, entityId: SketchEntityId) {
  return {
    constraintId: createConstraintId(name),
    kind: 'vertical',
    label: `Vertical ${name}`,
    entityId,
  } satisfies SketchDefinition['constraints'][number]
}

function makeHorizontalDistanceDimension(
  name: string,
  pointIds: readonly [SketchPointId, SketchPointId],
  value: number,
) {
  return {
    dimensionId: createDimensionId(name),
    kind: 'horizontalDistance',
    label: `Horizontal distance ${name}`,
    pointIds,
    value,
  } satisfies DimensionDefinition
}

function makeVerticalDistanceDimension(
  name: string,
  pointIds: readonly [SketchPointId, SketchPointId],
  value: number,
) {
  return {
    dimensionId: createDimensionId(name),
    kind: 'verticalDistance',
    label: `Vertical distance ${name}`,
    pointIds,
    value,
  } satisfies DimensionDefinition
}

function makeDefinition(parts: MutableSketchDefinitionParts): SketchDefinition {
  return {
    schemaVersion: 'sketch-definition/v1alpha1',
    referenceIds: [],
    references: [],
    pointIds: parts.points.map((point) => point.pointId),
    points: parts.points,
    entityIds: parts.entities.map((entity) => entity.entityId),
    entities: parts.entities,
    constraintIds: parts.constraints.map((constraint) => constraint.constraintId),
    constraints: parts.constraints,
    dimensionIds: parts.dimensions.map((dimension) => dimension.dimensionId),
    dimensions: parts.dimensions,
  }
}

function createBenchmarkPlaneDefinition(planeKey: SketchPlaneKey): SketchPlaneDefinition {
  const constructionIds: Record<SketchPlaneKey, ConstructionId> = {
    xy: 'construction_plane-xy' as ConstructionId,
    yz: 'construction_plane-yz' as ConstructionId,
    xz: 'construction_plane-xz' as ConstructionId,
  }

  switch (planeKey) {
    case 'xy':
      return {
        support: { kind: 'construction', constructionId: constructionIds.xy },
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: 'documentLength',
          handedness: 'rightHanded',
        },
        key: planeKey,
      }
    case 'yz':
      return {
        support: { kind: 'construction', constructionId: constructionIds.yz },
        frame: {
          origin: [0, 0, 0],
          xAxis: [0, 1, 0],
          yAxis: [0, 0, 1],
          normal: [1, 0, 0],
          linearUnit: 'documentLength',
          handedness: 'rightHanded',
        },
        key: planeKey,
      }
    case 'xz':
      return {
        support: { kind: 'construction', constructionId: constructionIds.xz },
        frame: {
          origin: [0, 0, 0],
          xAxis: [1, 0, 0],
          yAxis: [0, 0, 1],
          normal: [0, -1, 0],
          linearUnit: 'documentLength',
          handedness: 'rightHanded',
        },
        key: planeKey,
      }
  }
}

function makeAuthoredSketchRecord(
  sketchId: SketchId,
  label: string,
  definition: SketchDefinition,
): AuthoredSketchRecord {
  const plane = createBenchmarkPlaneDefinition('xy')
  return {
    sketchId,
    label,
    plane,
    definition,
  }
}

function makeFixture(
  name: string,
  description: string,
  sketch: AuthoredSketchRecord,
  expectedRegionCount: number,
): SketchSolverBenchmarkFixture {
  return {
    name,
    description,
    sketch,
    expectedAnnotationCount: countSolverAnnotations(sketch.definition),
    expectedRegionCount,
  }
}

function createSquareFixture(): SketchSolverBenchmarkFixture {
  const sketchId = 'sketch_benchmark_square' as SketchId
  const a = makePoint(sketchId, 'square_a', 'A', [0, 0])
  const b = makePoint(sketchId, 'square_b', 'B', [1, 0.05])
  const c = makePoint(sketchId, 'square_c', 'C', [0.95, 1])
  const d = makePoint(sketchId, 'square_d', 'D', [-0.05, 0.95])
  const points = [a, b, c, d]
  const ab = makeLine(sketchId, 'square_ab', 'AB', a.pointId, b.pointId)
  const bc = makeLine(sketchId, 'square_bc', 'BC', b.pointId, c.pointId)
  const cd = makeLine(sketchId, 'square_cd', 'CD', c.pointId, d.pointId)
  const da = makeLine(sketchId, 'square_da', 'DA', d.pointId, a.pointId)
  const lines = [ab, bc, cd, da]

  const constraints: SketchDefinition['constraints'] = [
    {
      constraintId: createConstraintId('square_fix_a'),
      kind: 'fixPoint',
      label: 'Fix square A',
      pointId: a.pointId,
      position: [0, 0],
    },
    makeHorizontalConstraint('square_ab', ab.entityId),
    makeVerticalConstraint('square_bc', bc.entityId),
    makeHorizontalConstraint('square_cd', cd.entityId),
    makeVerticalConstraint('square_da', da.entityId),
    {
      constraintId: createConstraintId('square_equal_ab_bc'),
      kind: 'equalLength',
      label: 'Square equal sides',
      entityIds: [ab.entityId, bc.entityId],
    },
  ]

  const dimensions: SketchDefinition['dimensions'] = [
    makeHorizontalDistanceDimension('square_width', [a.pointId, b.pointId], 1),
    makeVerticalDistanceDimension('square_height', [a.pointId, d.pointId], 1),
  ]

  return makeFixture(
    'square-8',
    'Single square profile with eight solver-facing annotations.',
    makeAuthoredSketchRecord(sketchId, 'Benchmark square', makeDefinition({
      points,
      entities: lines,
      constraints,
      dimensions,
    })),
    1,
  )
}

function createGridFixture(
  name: string,
  rows: number,
  columns: number,
): SketchSolverBenchmarkFixture {
  const sketchId = `sketch_benchmark_${name.replaceAll('-', '_')}` as SketchId
  const points: SketchDefinition['points'] = []
  const entities: SketchDefinition['entities'] = []
  const constraints: SketchDefinition['constraints'] = []
  const dimensions: SketchDefinition['dimensions'] = []

  const pointIdAt = (row: number, column: number) => createPointId(`${name}_r${row}_c${column}`)

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const x = column + (row % 2) * 0.02
      const y = row + (column % 2) * 0.02
      points.push(makePoint(sketchId, `${name}_r${row}_c${column}`, `R${row} C${column}`, [x, y]))
    }
  }

  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const line = makeLine(
        sketchId,
        `${name}_h${row}_${column}`,
        `H${row}.${column}`,
        pointIdAt(row, column),
        pointIdAt(row, column + 1),
      )
      entities.push(line)
      constraints.push(makeHorizontalConstraint(`${name}_h${row}_${column}`, line.entityId))
    }
  }

  for (let column = 0; column <= columns; column += 1) {
    for (let row = 0; row < rows; row += 1) {
      const line = makeLine(
        sketchId,
        `${name}_v${column}_${row}`,
        `V${column}.${row}`,
        pointIdAt(row, column),
        pointIdAt(row + 1, column),
      )
      entities.push(line)
      constraints.push(makeVerticalConstraint(`${name}_v${column}_${row}`, line.entityId))
    }
  }

  constraints.push({
    constraintId: createConstraintId(`${name}_fix_origin`),
    kind: 'fixPoint',
    label: 'Fix grid origin',
    pointId: pointIdAt(0, 0),
    position: [0, 0],
  })

  for (let column = 0; column < columns; column += 1) {
    dimensions.push(makeHorizontalDistanceDimension(
      `${name}_column_${column}_width`,
      [pointIdAt(0, column), pointIdAt(0, column + 1)],
      1,
    ))
  }

  for (let row = 0; row < rows; row += 1) {
    dimensions.push(makeVerticalDistanceDimension(
      `${name}_row_${row}_height`,
      [pointIdAt(row, 0), pointIdAt(row + 1, 0)],
      1,
    ))
  }

  return makeFixture(
    name,
    `${columns} by ${rows} shared-edge grid profile.`,
    makeAuthoredSketchRecord(sketchId, `Benchmark ${name}`, makeDefinition({
      points,
      entities,
      constraints,
      dimensions,
    })),
    rows * columns,
  )
}

export const SKETCH_SOLVER_BENCHMARK_FIXTURES: readonly SketchSolverBenchmarkFixture[] = [
  createSquareFixture(),
  createGridFixture('grid-25', 3, 2),
  createGridFixture('grid-50', 4, 4),
  createGridFixture('grid-100', 6, 6),
]

export function countSolverAnnotations(definition: SketchDefinition) {
  return definition.constraintIds.length + definition.dimensionIds.length
}

export function evaluateSketchSolverBenchmarkFixture(
  fixture: SketchSolverBenchmarkFixture,
): SketchSolverBenchmarkEvaluation {
  const definition = fixture.sketch.definition
  const solved = solveSketchDefinitionCore({
    definition,
    tolerances: BENCHMARK_TOLERANCES,
    partialSolvePolicy: 'bestEffort',
  })
  const extracted = deriveSketchRegionsCore({
    documentId: 'doc_benchmark',
    revisionId: 'rev_benchmark',
    sketchId: fixture.sketch.sketchId,
    definition,
    solvedSnapshot: solved.solvedSnapshot,
  })

  return {
    fixture: fixture.name,
    annotationCount: countSolverAnnotations(definition),
    constraintCount: definition.constraintIds.length,
    dimensionCount: definition.dimensionIds.length,
    pointCount: definition.pointIds.length,
    entityCount: definition.entityIds.length,
    regionCount: extracted.regions.length,
    loopCount: extracted.regions.reduce((total, region) => total + region.loops.length, 0),
    diagnosticCount: solved.diagnostics.length + extracted.diagnostics.length,
    solveState: solved.status.solveState,
    constraintState: solved.status.constraintState,
  }
}
