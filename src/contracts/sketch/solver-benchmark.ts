import type { AuthoredSketchRecord } from '@/contracts/modeling/authored-document'
import type { DimensionDefinition, SketchDefinition, SketchPoint2D } from '@/contracts/sketch/schema'
import { deriveSketchRegionsCore } from '@/contracts/sketch/region-extraction'
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  solveSketchDefinitionCore,
  updateCompiledSketchSolveSession,
} from '@/contracts/sketch/solver-core'
import type { ConstraintId, ConstructionId, DimensionId, SketchEntityId, SketchId, SketchPointId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition, SketchPlaneKey } from '@/contracts/shared/sketch-plane'

export interface SketchSolverBenchmarkFixture {
  name: string
  description: string
  sketch: AuthoredSketchRecord
  expectedAnnotationCount: number
  expectedRegionCount: number
  expectedDiagnosticCount: number
  interactiveDragTarget?: {
    pointId: SketchPointId
    position: SketchPoint2D
    targetTolerance?: number
  }
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
  fullSolveMs: number
  interactiveDragFrameMs: number
  interactiveDragAccepted: boolean
}

export const SKETCH_SOLVER_BENCHMARK_TOLERANCES = {
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

function makeLineLengthDimension(
  name: string,
  entityId: SketchEntityId,
  value: number,
) {
  return {
    dimensionId: createDimensionId(name),
    kind: 'lineLength',
    label: `Line length ${name}`,
    entityId,
    value,
  } satisfies DimensionDefinition
}

function makeLineAngleDimension(
  name: string,
  lines: readonly [
    { kind: 'localEntity'; entityId: SketchEntityId },
    { kind: 'localEntity'; entityId: SketchEntityId },
  ],
  valueRadians: number,
) {
  return {
    dimensionId: createDimensionId(name),
    kind: 'lineAngle',
    label: `Line angle ${name}`,
    lines,
    valueRadians,
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
  expectedDiagnosticCount = 0,
): SketchSolverBenchmarkFixture {
  return {
    name,
    description,
    sketch,
    expectedAnnotationCount: countSolverAnnotations(sketch.definition),
    expectedRegionCount,
    expectedDiagnosticCount,
  }
}

export function createSquareFixture(): SketchSolverBenchmarkFixture {
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

export function createGridFixture(
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

function createConstraintChainFixture(name: string, segmentCount: number): SketchSolverBenchmarkFixture {
  const sketchId = `sketch_benchmark_${name.replaceAll('-', '_')}` as SketchId
  const points: SketchDefinition['points'] = []
  const entities: SketchDefinition['entities'] = []
  const constraints: SketchDefinition['constraints'] = []
  const dimensions: SketchDefinition['dimensions'] = []

  for (let index = 0; index <= segmentCount; index += 1) {
    points.push(makePoint(sketchId, `${name}_p${index}`, `P${index}`, [index, index % 2 === 0 ? 0 : 0.02]))
  }

  for (let index = 0; index < segmentCount; index += 1) {
    const line = makeLine(
      sketchId,
      `${name}_s${index}`,
      `S${index}`,
      createPointId(`${name}_p${index}`),
      createPointId(`${name}_p${index + 1}`),
    )
    entities.push(line)
    constraints.push(makeHorizontalConstraint(`${name}_h${index}`, line.entityId))
    dimensions.push({
      dimensionId: createDimensionId(`${name}_l${index}`),
      kind: 'lineLength',
      label: `Length ${index}`,
      entityId: line.entityId,
      value: 1,
    })
  }

  return makeFixture(
    name,
    `${segmentCount * 2} solver annotation open-chain sketch.`,
    makeAuthoredSketchRecord(sketchId, `Benchmark ${name}`, makeDefinition({
      points,
      entities,
      constraints,
      dimensions,
    })),
    0,
    points.length,
  )
}

function createIndependentComponentFixture(): SketchSolverBenchmarkFixture {
  const first = createConstraintChainFixture('independent-a', 5).sketch.definition
  const second = createConstraintChainFixture('independent-b', 5).sketch.definition
  const sketchId = 'sketch_benchmark_independent_components' as SketchId
  const offsetSecondPoints = second.points.map((point) => ({
    ...point,
    target: { kind: 'sketchPoint' as const, sketchId, pointId: point.pointId },
    position: [point.position[0] + 20, point.position[1]] as const,
  }))
  return makeFixture(
    'independent-components',
    'Two independent constrained chains for affected-component drag timing.',
    makeAuthoredSketchRecord(sketchId, 'Benchmark independent components', makeDefinition({
      points: [
        ...first.points.map((point) => ({
          ...point,
          target: { kind: 'sketchPoint' as const, sketchId, pointId: point.pointId },
        })),
        ...offsetSecondPoints,
      ],
      entities: [
        ...first.entities.map((entity) => ({ ...entity, target: { kind: 'sketchEntity' as const, sketchId, entityId: entity.entityId } })),
        ...second.entities.map((entity) => ({ ...entity, target: { kind: 'sketchEntity' as const, sketchId, entityId: entity.entityId } })),
      ],
      constraints: [...first.constraints, ...second.constraints],
      dimensions: [...first.dimensions, ...second.dimensions],
    })),
    0,
    first.points.length + second.points.length,
  )
}

function createThreeBranchFallbackFixture(): SketchSolverBenchmarkFixture {
  const sketchId = 'sketch_benchmark_three_branch_fallback' as SketchId
  const anchor1 = makePoint(sketchId, 'branch_anchor_1', 'Anchor 1', [-6.45492548301263e-11, -20.00000000144171])
  const anchor2 = makePoint(sketchId, 'branch_anchor_2', 'Anchor 2', [0, 0])
  const p6 = makePoint(sketchId, 'branch_p6', 'P6', [16.420739052696923, -15.60007626054567])
  const p8 = makePoint(sketchId, 'branch_p8', 'P8', [32.39551360005226, -21.414418708092832])
  const p12 = makePoint(sketchId, 'branch_p12', 'P12', [16.420739050742696, 4.399923751375514])
  const p13 = makePoint(sketchId, 'branch_p13', 'P13', [32.39551359627179, -1.4144187060831115])
  const p19 = makePoint(sketchId, 'branch_p19', 'P19', [32.395513600164705, -21.414418707726117])
  const p21 = makePoint(sketchId, 'branch_p21', 'P21', [15.974774547466922, -25.81434244596269])
  const line3 = makeLine(sketchId, 'branch_l3', 'L3', anchor1.pointId, anchor2.pointId)
  const line6 = makeLine(sketchId, 'branch_l6', 'L6', anchor1.pointId, p6.pointId)
  const line8 = makeLine(sketchId, 'branch_l8', 'L8', p6.pointId, p8.pointId)
  const line12 = makeLine(sketchId, 'branch_l12', 'L12', anchor2.pointId, p12.pointId)
  const line13 = makeLine(sketchId, 'branch_l13', 'L13', p12.pointId, p13.pointId)
  const line19 = makeLine(sketchId, 'branch_l19', 'L19', p13.pointId, p19.pointId)
  const line21 = makeLine(sketchId, 'branch_l21', 'L21', anchor1.pointId, p21.pointId)
  const line22 = makeLine(sketchId, 'branch_l22', 'L22', p21.pointId, p19.pointId)

  const fixture = makeFixture(
    'three-branch-drag-fallback',
    'Logo-like anchored drag that times the local branch plus two bounded alternate branch orientations.',
    makeAuthoredSketchRecord(sketchId, 'Benchmark three-branch fallback', makeDefinition({
      points: [anchor1, anchor2, p6, p8, p12, p13, p19, p21],
      entities: [line3, line6, line8, line12, line13, line19, line21, line22],
      constraints: [
        makeVerticalConstraint('branch_l3_vertical', line3.entityId),
        {
          constraintId: createConstraintId('branch_l6_l8_equal'),
          kind: 'equalLength',
          label: 'L6 L8 equal',
          entityIds: [line6.entityId, line8.entityId],
        },
        {
          constraintId: createConstraintId('branch_l12_l6_equal'),
          kind: 'equalLength',
          label: 'L12 L6 equal',
          entityIds: [line12.entityId, line6.entityId],
        },
        {
          constraintId: createConstraintId('branch_l12_l6_parallel'),
          kind: 'parallel',
          label: 'L12 L6 parallel',
          entityIds: [line12.entityId, line6.entityId],
        },
        {
          constraintId: createConstraintId('branch_l13_l8_parallel'),
          kind: 'parallel',
          label: 'L13 L8 parallel',
          entityIds: [line13.entityId, line8.entityId],
        },
        {
          constraintId: createConstraintId('branch_l12_l13_equal'),
          kind: 'equalLength',
          label: 'L12 L13 equal',
          entityIds: [line12.entityId, line13.entityId],
        },
        {
          constraintId: createConstraintId('branch_p19_p8_coincident'),
          kind: 'coincident',
          label: 'P19 P8 coincident',
          pointIds: [p19.pointId, p8.pointId],
        },
        {
          constraintId: createConstraintId('branch_l22_l6_equal'),
          kind: 'equalLength',
          label: 'L22 L6 equal',
          entityIds: [line22.entityId, line6.entityId],
        },
        {
          constraintId: createConstraintId('branch_l21_l8_equal'),
          kind: 'equalLength',
          label: 'L21 L8 equal',
          entityIds: [line21.entityId, line8.entityId],
        },
        {
          constraintId: createConstraintId('branch_l19_l3_equal'),
          kind: 'equalLength',
          label: 'L19 L3 equal',
          entityIds: [line19.entityId, line3.entityId],
        },
        {
          constraintId: createConstraintId('branch_anchor_origin'),
          kind: 'coincidentProjectedPoint',
          label: 'Anchor 2 at origin',
          point: {
            kind: 'localPoint',
            pointId: anchor2.pointId,
          },
          projectedPoint: {
            kind: 'sketchDatum',
            datum: 'origin',
          },
        },
      ],
      dimensions: [
        makeLineLengthDimension('branch_l3_length', line3.entityId, 20),
        makeLineAngleDimension('branch_l6_from_l3', [
          { kind: 'localEntity', entityId: line3.entityId },
          { kind: 'localEntity', entityId: line6.entityId },
        ], 1.3089969389957472),
        makeLineAngleDimension('branch_l8_from_l6', [
          { kind: 'localEntity', entityId: line8.entityId },
          { kind: 'localEntity', entityId: line6.entityId },
        ], 2.5307274153917776),
        makeLineLengthDimension('branch_l6_length', line6.entityId, 17),
      ],
    })),
    2,
  )

  return {
    ...fixture,
    interactiveDragTarget: {
      pointId: anchor1.pointId,
      position: [5, 25],
      targetTolerance: 1e-4,
    },
  }
}

export const SKETCH_SOLVER_BENCHMARK_FIXTURES: readonly SketchSolverBenchmarkFixture[] = [
  createConstraintChainFixture('constraints-10', 5),
  createConstraintChainFixture('constraints-50', 25),
  createConstraintChainFixture('constraints-150', 75),
  createIndependentComponentFixture(),
  createThreeBranchFallbackFixture(),
]

export function countSolverAnnotations(definition: SketchDefinition) {
  return definition.constraintIds.length + definition.dimensionIds.length
}

export function evaluateSketchSolverBenchmarkFixture(
  fixture: SketchSolverBenchmarkFixture,
): SketchSolverBenchmarkEvaluation {
  const definition = fixture.sketch.definition
  const fullSolveStartedAt = performance.now()
  const solved = solveSketchDefinitionCore({
    definition,
    tolerances: SKETCH_SOLVER_BENCHMARK_TOLERANCES,
    partialSolvePolicy: 'bestEffort',
  })
  const fullSolveMs = performance.now() - fullSolveStartedAt
  const extracted = deriveSketchRegionsCore({
    documentId: 'doc_benchmark',
    revisionId: 'rev_benchmark',
    sketchId: fixture.sketch.sketchId,
    definition,
    solvedSnapshot: solved.solvedSnapshot,
  })
  const dragPoint = fixture.interactiveDragTarget
    ? definition.points.find((point) => point.pointId === fixture.interactiveDragTarget?.pointId)
    : definition.points[1] ?? definition.points[0]
  const interactiveStartedAt = performance.now()
  const program = compileSketchSolveProgram({
    definition,
    tolerances: SKETCH_SOLVER_BENCHMARK_TOLERANCES,
    partialSolvePolicy: 'bestEffort',
  })
  const session = createCompiledSketchSolveSession({
    sessionId: `interactive_sketch_solve_benchmark_${fixture.name.replaceAll('-', '_')}`,
    program,
    priorSolvedSnapshot: solved.solvedSnapshot,
  })
  const dragResult = dragPoint
    ? updateCompiledSketchSolveSession(session, {
        kind: 'sketchPoint',
        pointId: dragPoint.pointId,
        position: fixture.interactiveDragTarget?.position ?? [dragPoint.position[0] + 0.05, dragPoint.position[1]],
      }, fixture.interactiveDragTarget?.targetTolerance ?? 0.1)
    : null
  const interactiveDragFrameMs = performance.now() - interactiveStartedAt

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
    fullSolveMs,
    interactiveDragFrameMs,
    interactiveDragAccepted: dragResult?.kind === 'solved',
  }
}
