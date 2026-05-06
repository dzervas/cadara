import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
  isCompiledSketchSolveProgramCompatible,
  solveSketchDefinitionCore,
  solveSketchDefinitionWithDraggedPointTarget,
  updateCompiledSketchSolveSession,
  validateSketchDefinitionCore,
  type SketchSolveStrategy,
} from '@/contracts/sketch/solver-core'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { ConstraintId, DimensionId } from '@/contracts/shared/ids'

test('src/contracts/sketch/solver-core.spec.ts', async () => {  function assertClose(actual: number, expected: number, tolerance: number, message: string) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message} Expected ${expected}, received ${actual}.`)
    }
  }

  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  } as const

  function makePoint(pointId: string, label: string, x: number, y: number) {
    return {
      pointId: pointId as `sketch_point_${string}`,
      label,
      target: { kind: 'sketchPoint', sketchId: 'sketch_primary', pointId: pointId as `sketch_point_${string}` } as const,
      position: [x, y] as const,
      isConstruction: false,
    }
  }

  function makeLine(entityId: string, label: string, startPointId: string, endPointId: string) {
    return {
      kind: 'lineSegment' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction: false,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
    }
  }

  function makeArc(
    entityId: string,
    label: string,
    centerPointId: string,
    startPointId: string,
    endPointId: string,
  ) {
    return {
      kind: 'arc' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction: false,
      centerPointId: centerPointId as `sketch_point_${string}`,
      startPointId: startPointId as `sketch_point_${string}`,
      endPointId: endPointId as `sketch_point_${string}`,
      sweepDirection: 'counterClockwise' as const,
    }
  }

  function makeCircle(entityId: string, label: string, centerPointId: string, radius: number) {
    return {
      kind: 'circle' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction: false,
      centerPointId: centerPointId as `sketch_point_${string}`,
      radius,
    }
  }

  function cloneValues(values: Float64Array) {
    return new Float64Array(values)
  }

  function assertGradientMatchesFiniteDifference(
    definition: SketchDefinition,
    constraintId: ConstraintId | DimensionId,
    tolerance: number,
    epsilon = 1e-6,
  ) {
    const baseValues = getSketchSolveInitialValuesForTest(definition)
    const analytical = evaluateSketchScalarConstraintForTest({
      definition,
      constraintId,
      values: baseValues,
    })

    const numerical = new Float64Array(baseValues.length)
    for (let index = 0; index < baseValues.length; index += 1) {
      const plus = cloneValues(baseValues)
      plus[index] += epsilon
      const minus = cloneValues(baseValues)
      minus[index] -= epsilon
      const next = evaluateSketchScalarConstraintForTest({
        definition,
        constraintId,
        values: plus,
      })
      const previous = evaluateSketchScalarConstraintForTest({
        definition,
        constraintId,
        values: minus,
      })
      numerical[index] = (next.residual - previous.residual) / (2 * epsilon)
    }

    let squaredError = 0
    for (let index = 0; index < analytical.gradient.length; index += 1) {
      const delta = analytical.gradient[index]! - numerical[index]!
      squaredError += delta * delta
    }
    const error = Math.sqrt(squaredError)
    expectTrue(
      error < tolerance,
      `Gradient mismatch for ${constraintId}. Error ${error} exceeds tolerance ${tolerance}.`,
    )
  }

  function assertRotatedRectangleMatchesIsotopeBranches(
    solved: ReturnType<typeof solveSketchDefinitionCore>,
    strategy: SketchSolveStrategy,
    tolerance: number,
  ) {
    const coords = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    const a = coords.get('sketch_point_a')
    const b = coords.get('sketch_point_b')
    const c = coords.get('sketch_point_c')
    const d = coords.get('sketch_point_d')
    const reference = coords.get('sketch_point_reference')
    expectTrue(a && b && c && d && reference, `Expected solved rotated-rectangle anchors for ${strategy}.`)

    const sqrt2 = Math.sqrt(2)
    const halfSqrt2 = sqrt2 / 2
    const matches = (point: readonly [number, number], expected: readonly [number, number]) =>
      Math.hypot(point[0] - expected[0], point[1] - expected[1]) < tolerance

    expectTrue(matches(reference, [1, 0]), `Reference point should remain fixed for ${strategy}.`)
    expectTrue(matches(a, [0, 0]), `A should remain at origin for ${strategy}.`)

    if (b[1] < 0) {
      expectTrue(matches(b, [sqrt2, -sqrt2]), `B should match isotope below-axis branch for ${strategy}.`)
      if (c[1] < b[1]) {
        expectTrue(matches(c, [-halfSqrt2, -5 * halfSqrt2]), `C should match isotope down-left branch for ${strategy}.`)
        expectTrue(matches(d, [-3 * halfSqrt2, -3 * halfSqrt2]), `D should match isotope down-left branch for ${strategy}.`)
        return
      }

      expectTrue(matches(c, [5 * halfSqrt2, halfSqrt2]), `C should match isotope up-right branch for ${strategy}.`)
      expectTrue(matches(d, [3 * halfSqrt2, 3 * halfSqrt2]), `D should match isotope up-right branch for ${strategy}.`)
      return
    }

    expectTrue(matches(b, [sqrt2, sqrt2]), `B should match isotope above-axis branch for ${strategy}.`)
    if (c[1] > b[1]) {
      expectTrue(matches(c, [-halfSqrt2, 5 * halfSqrt2]), `C should match isotope up-left branch for ${strategy}.`)
      expectTrue(matches(d, [-3 * halfSqrt2, 3 * halfSqrt2]), `D should match isotope up-left branch for ${strategy}.`)
      return
    }

    expectTrue(matches(c, [5 * halfSqrt2, -halfSqrt2]), `C should match isotope down-right branch for ${strategy}.`)
    expectTrue(matches(d, [3 * halfSqrt2, -3 * halfSqrt2]), `D should match isotope down-right branch for ${strategy}.`)
  }

  function createLogoReferenceImageAnchorFixture(): SketchDefinition {
    const anchor1 = 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1'
    const anchor2 = 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2'
    const line6End = 'sketch_point_6_line-end'
    const line8End = 'sketch_point_8_line-end'
    const line12End = 'sketch_point_12_line-end'
    const line13End = 'sketch_point_13_line-end'
    const line19End = 'sketch_point_19_line-end'
    const line21End = 'sketch_point_21_line-end'

    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        anchor1,
        anchor2,
        line6End,
        line8End,
        line12End,
        line13End,
        line19End,
        line21End,
      ],
      points: [
        makePoint(anchor1, 'Anchor 1', 29.110404607012146, 1.2961566959965458),
        makePoint(anchor2, 'Anchor 2', 29.110404607076696, 21.296156697438256),
        makePoint(line6End, 'Line 6 end', 45.53114365977362, 5.6960804368925855),
        makePoint(line8End, 'Line 8 end', 61.50591820712896, -0.11826201065457728),
        makePoint(line12End, 'Line 12 end', 45.53114365781939, 25.69608044881377),
        makePoint(line13End, 'Line 13 end', 61.505918203348486, 19.881737991355145),
        makePoint(line19End, 'Line 19 end', 61.5059182072414, -0.11826201028785953),
        makePoint(line21End, 'Line 21 end', 45.08517915454362, -4.518185748524435),
      ],
      entityIds: [
        'sketch_entity_3_line',
        'sketch_entity_6_line',
        'sketch_entity_8_line',
        'sketch_entity_12_line',
        'sketch_entity_13_line',
        'sketch_entity_19_line',
        'sketch_entity_21_line',
        'sketch_entity_22_line',
      ],
      entities: [
        makeLine('sketch_entity_3_line', 'Line 3', anchor1, anchor2),
        makeLine('sketch_entity_6_line', 'Line 6', anchor1, line6End),
        makeLine('sketch_entity_8_line', 'Line 8', line6End, line8End),
        makeLine('sketch_entity_12_line', 'Line 12', anchor2, line12End),
        makeLine('sketch_entity_13_line', 'Line 13', line12End, line13End),
        makeLine('sketch_entity_19_line', 'Line 19', line13End, line19End),
        makeLine('sketch_entity_21_line', 'Line 21', anchor1, line21End),
        makeLine('sketch_entity_22_line', 'Line 22', line21End, line19End),
      ],
      constraintIds: [
        'constraint_4_vertical',
        'constraint_11_equal',
        'constraint_15_equal',
        'constraint_16_parallel',
        'constraint_17_parallel',
        'constraint_18_equal',
        'constraint_20_coincident',
        'constraint_23_equal',
        'constraint_24_equal',
        'constraint_25_equal',
      ],
      constraints: [
        {
          constraintId: 'constraint_4_vertical',
          kind: 'vertical',
          label: 'Line 3 vertical',
          entityId: 'sketch_entity_3_line',
        },
        {
          constraintId: 'constraint_11_equal',
          kind: 'equalLength',
          label: 'Lines 6 and 8 equal',
          entityIds: ['sketch_entity_6_line', 'sketch_entity_8_line'],
        },
        {
          constraintId: 'constraint_15_equal',
          kind: 'equalLength',
          label: 'Lines 12 and 6 equal',
          entityIds: ['sketch_entity_12_line', 'sketch_entity_6_line'],
        },
        {
          constraintId: 'constraint_16_parallel',
          kind: 'parallel',
          label: 'Lines 12 and 6 parallel',
          entityIds: ['sketch_entity_12_line', 'sketch_entity_6_line'],
        },
        {
          constraintId: 'constraint_17_parallel',
          kind: 'parallel',
          label: 'Lines 13 and 8 parallel',
          entityIds: ['sketch_entity_13_line', 'sketch_entity_8_line'],
        },
        {
          constraintId: 'constraint_18_equal',
          kind: 'equalLength',
          label: 'Lines 12 and 13 equal',
          entityIds: ['sketch_entity_12_line', 'sketch_entity_13_line'],
        },
        {
          constraintId: 'constraint_20_coincident',
          kind: 'coincident',
          label: 'Line 19 end coincident with Line 8 end',
          pointIds: [line19End, line8End],
        },
        {
          constraintId: 'constraint_23_equal',
          kind: 'equalLength',
          label: 'Lines 22 and 6 equal',
          entityIds: ['sketch_entity_22_line', 'sketch_entity_6_line'],
        },
        {
          constraintId: 'constraint_24_equal',
          kind: 'equalLength',
          label: 'Lines 21 and 8 equal',
          entityIds: ['sketch_entity_21_line', 'sketch_entity_8_line'],
        },
        {
          constraintId: 'constraint_25_equal',
          kind: 'equalLength',
          label: 'Lines 19 and 3 equal',
          entityIds: ['sketch_entity_19_line', 'sketch_entity_3_line'],
        },
      ],
      dimensionIds: [
        'dimension_5_line-length',
        'dimension_7_line-angle',
        'dimension_10_line-angle',
        'dimension_26_line-length',
      ],
      dimensions: [
        {
          dimensionId: 'dimension_5_line-length',
          kind: 'lineLength',
          label: 'Line 3 length',
          entityId: 'sketch_entity_3_line',
          value: 20,
        },
        {
          dimensionId: 'dimension_7_line-angle',
          kind: 'lineAngle',
          label: 'Line 6 angle from Line 3',
          lines: [
            { kind: 'localEntity', entityId: 'sketch_entity_3_line' },
            { kind: 'localEntity', entityId: 'sketch_entity_6_line' },
          ],
          valueRadians: 1.3089969389957472,
        },
        {
          dimensionId: 'dimension_10_line-angle',
          kind: 'lineAngle',
          label: 'Line 8 angle from Line 6',
          lines: [
            { kind: 'localEntity', entityId: 'sketch_entity_8_line' },
            { kind: 'localEntity', entityId: 'sketch_entity_6_line' },
          ],
          valueRadians: 2.5307274153917776,
        },
        {
          dimensionId: 'dimension_26_line-length',
          kind: 'lineLength',
          label: 'Line 6 length',
          entityId: 'sketch_entity_6_line',
          value: 17,
        },
      ],
    }
  }

  function createCollinearDefinition(input: {
    points: readonly ReturnType<typeof makePoint>[]
    lines: readonly ReturnType<typeof makeLine>[]
    constraints: SketchDefinition['constraints']
    references?: SketchDefinition['references']
  }): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: input.references?.map((reference) => reference.referenceId) ?? [],
      references: input.references ?? [],
      pointIds: input.points.map((point) => point.pointId),
      points: input.points,
      entityIds: input.lines.map((line) => line.entityId),
      entities: input.lines,
      constraintIds: input.constraints.map((constraint) => constraint.constraintId),
      constraints: input.constraints,
      dimensionIds: [],
      dimensions: [],
      derivedRelationshipIds: [],
      derivedRelationships: [],
      styles: [],
      styleIds: [],
    }
  }

  async function testCollinearSolvesLocalLinesAndPointsAgainstInfiniteGeometry() {
    const lineDefinition = createCollinearDefinition({
      points: [
        makePoint('sketch_point_a0', 'A0', 0, 0),
        makePoint('sketch_point_a1', 'A1', 10, 0),
        makePoint('sketch_point_b0', 'B0', 20, 5),
        makePoint('sketch_point_b1', 'B1', 30, 5),
      ],
      lines: [
        makeLine('sketch_entity_a', 'Reference', 'sketch_point_a0', 'sketch_point_a1'),
        makeLine('sketch_entity_b', 'Driven', 'sketch_point_b0', 'sketch_point_b1'),
      ],
      constraints: [
        { constraintId: 'constraint_fix_a0', kind: 'fixPoint', label: 'Fix A0', pointId: 'sketch_point_a0', position: [0, 0] },
        { constraintId: 'constraint_fix_a1', kind: 'fixPoint', label: 'Fix A1', pointId: 'sketch_point_a1', position: [10, 0] },
        {
          constraintId: 'constraint_collinear_lines',
          kind: 'collinear',
          label: 'Collinear lines',
          target: { kind: 'localEntity', entityId: 'sketch_entity_b' },
          line: { kind: 'localEntity', entityId: 'sketch_entity_a' },
        },
      ],
    })
    const lineSolved = solveSketchDefinitionCore({ definition: lineDefinition, tolerances, partialSolvePolicy: 'bestEffort' })
    const linePoints = new Map(lineSolved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    assertClose(linePoints.get('sketch_point_b0')?.[1] ?? Number.NaN, 0, 1e-4, 'Non-overlapping driven line start should solve onto the reference infinite line.')
    assertClose(linePoints.get('sketch_point_b1')?.[1] ?? Number.NaN, 0, 1e-4, 'Non-overlapping driven line end should solve onto the reference infinite line.')
    expectTrue(
      lineSolved.solvedSnapshot.constraintStatuses.find((status) => status.constraintId === 'constraint_collinear_lines')?.status === 'satisfied',
      'Line-line Collinear should report satisfied after solving.',
    )

    const pointDefinition = createCollinearDefinition({
      points: [
        makePoint('sketch_point_a0', 'A0', 0, 0),
        makePoint('sketch_point_a1', 'A1', 1, 0),
        makePoint('sketch_point_p', 'P', 3, 5),
      ],
      lines: [makeLine('sketch_entity_a', 'Reference', 'sketch_point_a0', 'sketch_point_a1')],
      constraints: [
        { constraintId: 'constraint_fix_a0', kind: 'fixPoint', label: 'Fix A0', pointId: 'sketch_point_a0', position: [0, 0] },
        { constraintId: 'constraint_fix_a1', kind: 'fixPoint', label: 'Fix A1', pointId: 'sketch_point_a1', position: [1, 0] },
        {
          constraintId: 'constraint_collinear_point',
          kind: 'collinear',
          label: 'Collinear point',
          target: { kind: 'localPoint', pointId: 'sketch_point_p' },
          line: { kind: 'localEntity', entityId: 'sketch_entity_a' },
        },
      ],
    })
    const pointSolved = solveSketchDefinitionCore({ definition: pointDefinition, tolerances, partialSolvePolicy: 'bestEffort' })
    const solvedPoint = pointSolved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_p')
    assertClose(solvedPoint?.solvedPosition[1] ?? Number.NaN, 0, 1e-4, 'Point-line Collinear should solve onto the reference infinite line.')
    expectTrue(
      pointSolved.solvedSnapshot.constraintStatuses.find((status) => status.constraintId === 'constraint_collinear_point')?.status === 'satisfied',
      'Point-line Collinear should report satisfied for a point that lies on the infinite line outside the finite segment span.',
    )
  }

  async function testCollinearSolvesAgainstProjectedLineWithoutMovingReference() {
    const definition = createCollinearDefinition({
      points: [
        makePoint('sketch_point_a0', 'A0', 0, 5),
        makePoint('sketch_point_a1', 'A1', 10, 6),
      ],
      lines: [makeLine('sketch_entity_a', 'Driven', 'sketch_point_a0', 'sketch_point_a1')],
      references: [{
        referenceId: 'ref_collinear',
        kind: 'modelReference',
        label: 'Projected line',
        source: { kind: 'edge', bodyId: 'body_1', edgeId: 'edge_1' },
        projectionMode: 'projectAlongPlaneNormal',
      }],
      constraints: [{
        constraintId: 'constraint_collinear_projected',
        kind: 'collinearProjectedLine',
        label: 'Collinear projected',
        target: { kind: 'localEntity', entityId: 'sketch_entity_a' },
        projectedLine: {
          kind: 'projectedGeometry',
          reference: {
            kind: 'projectedLineSegment',
            referenceId: 'ref_collinear',
            geometryId: 'projected_geometry_line',
          },
        },
      }],
    })
    const projectedReferences = [{
      referenceId: 'ref_collinear',
      status: 'projected' as const,
      geometry: [{
        geometryId: 'projected_geometry_line' as const,
        kind: 'lineSegment' as const,
        startPosition: [0, 2] as const,
        endPosition: [10, 2] as const,
      }],
      diagnostics: [],
    }]
    const solved = solveSketchDefinitionCore({ definition, projectedReferences, tolerances, partialSolvePolicy: 'bestEffort' })
    const points = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    assertClose(points.get('sketch_point_a0')?.[1] ?? Number.NaN, 2, 1e-4, 'Projected-line Collinear should move the local line start onto the read-only line.')
    assertClose(points.get('sketch_point_a1')?.[1] ?? Number.NaN, 2, 1e-4, 'Projected-line Collinear should move the local line end onto the read-only line.')
    expectTrue(
      solved.solvedSnapshot.constraintStatuses.find((status) => status.constraintId === 'constraint_collinear_projected')?.status === 'satisfied',
      'Projected-line Collinear should report satisfied when the editable line reaches the projected line.',
    )
  }

  async function testCollinearValidationReportsMissingAndDegenerateTargets() {
    const missing = createCollinearDefinition({
      points: [
        makePoint('sketch_point_a0', 'A0', 0, 0),
        makePoint('sketch_point_a1', 'A1', 10, 0),
      ],
      lines: [makeLine('sketch_entity_a', 'Reference', 'sketch_point_a0', 'sketch_point_a1')],
      constraints: [{
        constraintId: 'constraint_collinear_missing',
        kind: 'collinear',
        label: 'Missing collinear',
        target: { kind: 'localPoint', pointId: 'sketch_point_missing' },
        line: { kind: 'localEntity', entityId: 'sketch_entity_a' },
      }],
    })
    const missingValidation = validateSketchDefinitionCore({ definition: missing, tolerances })
    expectTrue(
      missingValidation.diagnostics.some((diagnostic) => diagnostic.code === 'missing-collinear-target'),
      'Collinear validation should report missing local operands.',
    )

    const degenerate = createCollinearDefinition({
      points: [
        makePoint('sketch_point_a0', 'A0', 0, 0),
        makePoint('sketch_point_a1', 'A1', 0, 0),
        makePoint('sketch_point_p', 'P', 1, 1),
      ],
      lines: [makeLine('sketch_entity_a', 'Degenerate', 'sketch_point_a0', 'sketch_point_a1')],
      constraints: [{
        constraintId: 'constraint_collinear_degenerate',
        kind: 'collinear',
        label: 'Degenerate collinear',
        target: { kind: 'localPoint', pointId: 'sketch_point_p' },
        line: { kind: 'localEntity', entityId: 'sketch_entity_a' },
      }],
    })
    const degenerateValidation = validateSketchDefinitionCore({ definition: degenerate, tolerances })
    expectTrue(
      degenerateValidation.diagnostics.some((diagnostic) => diagnostic.code === 'degenerate-line-segment'),
      'Degenerate Collinear reference lines should surface a solver validation diagnostic instead of fallback geometry.',
    )
  }

  async function testFixPoint() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a'],
      points: [makePoint('sketch_point_a', 'A', 1, 0)],
      entityIds: [],
      entities: [],
      constraintIds: ['constraint_fix_a'],
      constraints: [{
        constraintId: 'constraint_fix_a',
        kind: 'fixPoint',
        label: 'Fix A',
        pointId: 'sketch_point_a',
        position: [1, 1],
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })

    const point = solved.solvedSnapshot.solvedPoints[0]
    expectTrue(point !== undefined, 'Expected one solved point.')
    expectTrue(Math.abs(point.solvedPosition[0] - 1) < 1e-6, 'Fix point should preserve x.')
    expectTrue(Math.abs(point.solvedPosition[1] - 1) < 1e-6, 'Fix point should solve y to 1.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_fix_a', 1e-6)
  }

  async function testEuclideanDistance() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 1, 0),
        makePoint('sketch_point_b', 'B', 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_distance'],
      dimensions: [{
        dimensionId: 'dimension_distance',
        kind: 'distance',
        label: 'Distance',
        axis: 'aligned',
        pointIds: ['sketch_point_a', 'sketch_point_b'],
        value: 3,
      }],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })

    const [a, b] = solved.solvedSnapshot.solvedPoints
    expectTrue(a !== undefined && b !== undefined, 'Expected solved point pair.')
    const distance = Math.hypot(
      a.solvedPosition[0] - b.solvedPosition[0],
      a.solvedPosition[1] - b.solvedPosition[1],
    )
    expectTrue(Math.abs(distance - 3) < 1e-4, 'Aligned distance should solve to 3.')
    assertGradientMatchesFiniteDifference(definition, 'dimension_distance', 1e-6)
  }

  async function testHorizontalDistance() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 1, 0),
        makePoint('sketch_point_b', 'B', 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_horizontal_distance'],
      dimensions: [{
        dimensionId: 'dimension_horizontal_distance',
        kind: 'horizontalDistance',
        label: 'Horizontal distance',
        pointIds: ['sketch_point_a', 'sketch_point_b'],
        value: -3,
      }],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })

    const [a, b] = solved.solvedSnapshot.solvedPoints
    expectTrue(a !== undefined && b !== undefined, 'Expected solved point pair.')
    expectTrue(Math.abs((b.solvedPosition[0] - a.solvedPosition[0]) + 3) < 1e-4, 'Horizontal distance should solve to -3.')
    assertGradientMatchesFiniteDifference(definition, 'dimension_horizontal_distance', 1e-6)
  }

  async function testVerticalDistance() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 1, 0),
        makePoint('sketch_point_b', 'B', 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_vertical_distance'],
      dimensions: [{
        dimensionId: 'dimension_vertical_distance',
        kind: 'verticalDistance',
        label: 'Vertical distance',
        pointIds: ['sketch_point_a', 'sketch_point_b'],
        value: 3,
      }],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })

    const [a, b] = solved.solvedSnapshot.solvedPoints
    expectTrue(a !== undefined && b !== undefined, 'Expected solved point pair.')
    expectTrue(Math.abs((b.solvedPosition[1] - a.solvedPosition[1]) - 3) < 1e-4, 'Vertical distance should solve to 3.')
    assertGradientMatchesFiniteDifference(definition, 'dimension_vertical_distance', 1e-6)
  }

  async function testExpandedDimensionStatuses() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_circle_center',
        'sketch_point_arc_center',
        'sketch_point_arc_start',
        'sketch_point_arc_end',
        'sketch_point_l1a',
        'sketch_point_l1b',
        'sketch_point_l2a',
        'sketch_point_l2b',
        'sketch_point_l3a',
        'sketch_point_l3b',
        'sketch_point_free',
      ],
      points: [
        makePoint('sketch_point_circle_center', 'Circle center', 0, 0),
        makePoint('sketch_point_arc_center', 'Arc center', 20, 0),
        makePoint('sketch_point_arc_start', 'Arc start', 25, 0),
        makePoint('sketch_point_arc_end', 'Arc end', 20, 5),
        makePoint('sketch_point_l1a', 'L1A', 0, 0),
        makePoint('sketch_point_l1b', 'L1B', 10, 0),
        makePoint('sketch_point_l2a', 'L2A', 0, 4),
        makePoint('sketch_point_l2b', 'L2B', 10, 4),
        makePoint('sketch_point_l3a', 'L3A', 0, 0),
        makePoint('sketch_point_l3b', 'L3B', 0, 10),
        makePoint('sketch_point_free', 'Free point', 5, 3),
      ],
      entityIds: [
        'sketch_entity_circle',
        'sketch_entity_arc',
        'sketch_entity_l1',
        'sketch_entity_l2',
        'sketch_entity_l3',
      ],
      entities: [
        makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_circle_center', 5),
        makeArc('sketch_entity_arc', 'Arc', 'sketch_point_arc_center', 'sketch_point_arc_start', 'sketch_point_arc_end'),
        makeLine('sketch_entity_l1', 'Line 1', 'sketch_point_l1a', 'sketch_point_l1b'),
        makeLine('sketch_entity_l2', 'Line 2', 'sketch_point_l2a', 'sketch_point_l2b'),
        makeLine('sketch_entity_l3', 'Line 3', 'sketch_point_l3a', 'sketch_point_l3b'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [
        'dimension_diameter_circle',
        'dimension_diameter_arc',
        'dimension_line_distance',
        'dimension_line_point',
        'dimension_line_angle',
        'dimension_invalid_line_distance',
      ],
      dimensions: [
        {
          dimensionId: 'dimension_diameter_circle',
          kind: 'diameter',
          label: 'Circle diameter',
          entityId: 'sketch_entity_circle',
          value: 10,
        },
        {
          dimensionId: 'dimension_diameter_arc',
          kind: 'diameter',
          label: 'Arc diameter',
          entityId: 'sketch_entity_arc',
          value: 10,
        },
        {
          dimensionId: 'dimension_line_distance',
          kind: 'lineDistance',
          label: 'Line distance',
          lines: [
            { kind: 'localEntity', entityId: 'sketch_entity_l1' },
            { kind: 'localEntity', entityId: 'sketch_entity_l2' },
          ],
          value: 4,
        },
        {
          dimensionId: 'dimension_line_point',
          kind: 'linePointDistance',
          label: 'Line point',
          line: { kind: 'localEntity', entityId: 'sketch_entity_l1' },
          point: { kind: 'localPoint', pointId: 'sketch_point_free' },
          value: 3,
        },
        {
          dimensionId: 'dimension_line_angle',
          kind: 'lineAngle',
          label: 'Line angle',
          lines: [
            { kind: 'localEntity', entityId: 'sketch_entity_l1' },
            { kind: 'localEntity', entityId: 'sketch_entity_l3' },
          ],
          valueRadians: Math.PI / 2,
        },
        {
          dimensionId: 'dimension_invalid_line_distance',
          kind: 'lineDistance',
          label: 'Invalid line distance',
          lines: [
            { kind: 'localEntity', entityId: 'sketch_entity_l1' },
            { kind: 'localEntity', entityId: 'sketch_entity_l3' },
          ],
          value: 2,
        },
      ],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const statusById = new Map(solved.solvedSnapshot.dimensionStatuses.map((status) => [status.dimensionId, status]))
    assertClose(statusById.get('dimension_diameter_circle')?.solvedValue ?? 0, 10, 1e-6, 'Circle diameter should report solved diameter.')
    assertClose(statusById.get('dimension_diameter_arc')?.solvedValue ?? 0, 10, 1e-4, 'Arc diameter should report solved diameter.')
    assertClose(statusById.get('dimension_line_distance')?.solvedValue ?? 0, 4, 1e-4, 'Line distance should report perpendicular distance.')
    assertClose(statusById.get('dimension_line_point')?.solvedValue ?? 0, 3, 1e-4, 'Line-point dimension should report perpendicular distance.')
    assertClose(statusById.get('dimension_line_angle')?.solvedValue ?? 0, Math.PI / 2, 1e-4, 'Line angle should report enclosed angle.')
    expectTrue(
      statusById.get('dimension_invalid_line_distance')?.status === 'unsatisfied',
      'A line distance dimension between non-parallel lines should remain unsatisfied instead of becoming an angle dimension.',
    )
  }

  async function testAxisQualifiedDistance() {
    const horizontal: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 1, 0),
        makePoint('sketch_point_b', 'B', 0, 1),
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_axis_horizontal'],
      dimensions: [{
        dimensionId: 'dimension_axis_horizontal',
        kind: 'distance',
        label: 'Width',
        axis: 'horizontal',
        pointIds: ['sketch_point_a', 'sketch_point_b'],
        value: 3,
      }],
    }
    const vertical: SketchDefinition = {
      ...horizontal,
      dimensionIds: ['dimension_axis_vertical'],
      dimensions: [{
        dimensionId: 'dimension_axis_vertical',
        kind: 'distance',
        label: 'Height',
        axis: 'vertical',
        pointIds: ['sketch_point_a', 'sketch_point_b'],
        value: 4,
      }],
    }

    const solvedHorizontal = solveSketchDefinitionCore({
      definition: horizontal,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const [horizontalA, horizontalB] = solvedHorizontal.solvedSnapshot.solvedPoints
    expectTrue(horizontalA !== undefined && horizontalB !== undefined, 'Expected solved horizontal point pair.')
    assertClose(
      horizontalB.solvedPosition[0] - horizontalA.solvedPosition[0],
      3,
      1e-4,
      'Axis-qualified horizontal distance should solve to 3.',
    )
    assertGradientMatchesFiniteDifference(horizontal, 'dimension_axis_horizontal', 1e-6)

    const solvedVertical = solveSketchDefinitionCore({
      definition: vertical,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const [verticalA, verticalB] = solvedVertical.solvedSnapshot.solvedPoints
    expectTrue(verticalA !== undefined && verticalB !== undefined, 'Expected solved vertical point pair.')
    assertClose(
      verticalB.solvedPosition[1] - verticalA.solvedPosition[1],
      4,
      1e-4,
      'Axis-qualified vertical distance should solve to 4.',
    )
    assertGradientMatchesFiniteDifference(vertical, 'dimension_axis_vertical', 1e-6)
  }

  async function testObtuseLineAngleDimension() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 0, 10),
        makePoint('sketch_point_c', 'C', 7, 14),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
      ],
      constraintIds: ['constraint_fix_a', 'constraint_fix_b'],
      constraints: [
        {
          constraintId: 'constraint_fix_a',
          kind: 'fixPoint',
          label: 'Fix A',
          pointId: 'sketch_point_a',
          position: [0, 0],
        },
        {
          constraintId: 'constraint_fix_b',
          kind: 'fixPoint',
          label: 'Fix B',
          pointId: 'sketch_point_b',
          position: [0, 10],
        },
      ],
      dimensionIds: ['dimension_bc_length', 'dimension_obtuse_angle'],
      dimensions: [
        {
          dimensionId: 'dimension_bc_length',
          kind: 'lineLength',
          label: 'BC length',
          entityId: 'sketch_entity_bc',
          value: 10,
        },
        {
          dimensionId: 'dimension_obtuse_angle',
          kind: 'lineAngle',
          label: 'Obtuse angle',
          lines: [
            { kind: 'localEntity', entityId: 'sketch_entity_ab' },
            { kind: 'localEntity', entityId: 'sketch_entity_bc' },
          ],
          valueRadians: (120 * Math.PI) / 180,
        },
      ],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'failOnConflict' })
    const pointC = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_c')
    const angleStatus = solved.solvedSnapshot.dimensionStatuses.find((status) => status.dimensionId === 'dimension_obtuse_angle')

    expectTrue(solved.status.solveState === 'solved', 'Obtuse line-angle dimensions should remain solvable.')
    expectTrue(solved.status.constraintState !== 'overConstrained', 'Obtuse line-angle dimensions should not be classified as over-constrained.')
    expectTrue(pointC, 'Expected solved endpoint for the obtuse-angle fixture.')
    assertClose(pointC.solvedPosition[0], 8.660254037844387, 1e-4, 'Obtuse line-angle solve should place the free endpoint on the expected branch.')
    assertClose(pointC.solvedPosition[1], 15, 1e-4, 'Obtuse line-angle solve should preserve the requested line length.')
    assertClose(angleStatus?.solvedValue ?? 0, (120 * Math.PI) / 180, 1e-4, 'Obtuse line-angle dimensions should report their solved angle in radians.')
  }

  async function testHorizontalLine() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 3, 4),
        makePoint('sketch_point_b', 'B', 5, 6),
      ],
      entityIds: ['sketch_entity_line'],
      entities: [makeLine('sketch_entity_line', 'Line', 'sketch_point_a', 'sketch_point_b')],
      constraintIds: ['constraint_horizontal'],
      constraints: [{
        constraintId: 'constraint_horizontal',
        kind: 'horizontal',
        label: 'Horizontal',
        entityId: 'sketch_entity_line',
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const [a, b] = solved.solvedSnapshot.solvedPoints
    expectTrue(a !== undefined && b !== undefined, 'Expected solved line endpoints.')
    expectTrue(Math.abs(b.solvedPosition[1] - a.solvedPosition[1]) < 1e-6, 'Horizontal line should end with zero y delta.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_horizontal', 1e-6)
  }

  async function testVerticalLine() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 3, 4),
        makePoint('sketch_point_b', 'B', 5, 6),
      ],
      entityIds: ['sketch_entity_line'],
      entities: [makeLine('sketch_entity_line', 'Line', 'sketch_point_a', 'sketch_point_b')],
      constraintIds: ['constraint_vertical'],
      constraints: [{
        constraintId: 'constraint_vertical',
        kind: 'vertical',
        label: 'Vertical',
        entityId: 'sketch_entity_line',
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const [a, b] = solved.solvedSnapshot.solvedPoints
    expectTrue(a !== undefined && b !== undefined, 'Expected solved line endpoints.')
    expectTrue(Math.abs(b.solvedPosition[0] - a.solvedPosition[0]) < 1e-6, 'Vertical line should end with zero x delta.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_vertical', 1e-6)
  }

  async function testAngleBetweenPoints() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_m'],
      points: [
        makePoint('sketch_point_a', 'A', 1, 0),
        makePoint('sketch_point_b', 'B', 0, 1),
        makePoint('sketch_point_m', 'M', 0, 0),
      ],
      entityIds: [],
      entities: [],
      constraintIds: ['constraint_angle'],
      constraints: [{
        constraintId: 'constraint_angle',
        kind: 'angle',
        label: 'Angle',
        pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_m'],
        valueRadians: Math.PI / 4,
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const pointA = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_a')
    const pointB = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_b')
    const pointM = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_m')
    expectTrue(pointA && pointB && pointM, 'Expected solved angle points.')
    const d1x = pointA.solvedPosition[0] - pointM.solvedPosition[0]
    const d1y = pointA.solvedPosition[1] - pointM.solvedPosition[1]
    const d2x = pointB.solvedPosition[0] - pointM.solvedPosition[0]
    const d2y = pointB.solvedPosition[1] - pointM.solvedPosition[1]
    const angle = Math.acos(
      Math.max(-1, Math.min(1, (d1x * d2x + d1y * d2y) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)))),
    )
    expectTrue(Math.abs(angle - Math.PI / 4) < 1e-4, 'Angle should solve to PI/4.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_angle', 1e-6)
  }

  async function testAngleBetweenPointsSpecificCase() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_m'],
      points: [
        makePoint('sketch_point_a', 'A', 0.7805516932908316, -0.00782612334736288),
        makePoint('sketch_point_b', 'B', 1.22103191002294, 0.004601914768224987),
        makePoint('sketch_point_m', 'M', 0.013589691730458502, -0.10039941813640837),
      ],
      entityIds: [],
      entities: [],
      constraintIds: ['constraint_angle_specific'],
      constraints: [{
        constraintId: 'constraint_angle_specific',
        kind: 'angle',
        label: 'Specific angle case',
        pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_m'],
        valueRadians: Math.PI / 2,
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const pointA = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_a')
    const pointB = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_b')
    const pointM = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === 'sketch_point_m')
    expectTrue(pointA && pointB && pointM, 'Expected solved points for specific angle case.')
    const d1x = pointA.solvedPosition[0] - pointM.solvedPosition[0]
    const d1y = pointA.solvedPosition[1] - pointM.solvedPosition[1]
    const d2x = pointB.solvedPosition[0] - pointM.solvedPosition[0]
    const d2y = pointB.solvedPosition[1] - pointM.solvedPosition[1]
    const angle = Math.acos(
      Math.max(-1, Math.min(1, (d1x * d2x + d1y * d2y) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)))),
    )
    expectTrue(Math.abs(angle - Math.PI / 2) < 1e-3, 'Specific angle case should solve to PI/2.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_angle_specific', 1e-4)
  }

  async function testEqualLength() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_a1',
        'sketch_point_a2',
        'sketch_point_b1',
        'sketch_point_b2',
      ],
      points: [
        makePoint('sketch_point_a1', 'A1', 3, 4),
        makePoint('sketch_point_a2', 'A2', 5, 6),
        makePoint('sketch_point_b1', 'B1', 0, 4),
        makePoint('sketch_point_b2', 'B2', 10, 6),
      ],
      entityIds: ['sketch_entity_a', 'sketch_entity_b'],
      entities: [
        makeLine('sketch_entity_a', 'Line A', 'sketch_point_a1', 'sketch_point_a2'),
        makeLine('sketch_entity_b', 'Line B', 'sketch_point_b1', 'sketch_point_b2'),
      ],
      constraintIds: ['constraint_equal_length'],
      constraints: [{
        constraintId: 'constraint_equal_length',
        kind: 'equalLength',
        label: 'Equal length',
        entityIds: ['sketch_entity_a', 'sketch_entity_b'],
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const points = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    const lenA = Math.hypot(
      points.get('sketch_point_a2')![0] - points.get('sketch_point_a1')![0],
      points.get('sketch_point_a2')![1] - points.get('sketch_point_a1')![1],
    )
    const lenB = Math.hypot(
      points.get('sketch_point_b2')![0] - points.get('sketch_point_b1')![0],
      points.get('sketch_point_b2')![1] - points.get('sketch_point_b1')![1],
    )
    expectTrue(Math.abs(lenA - lenB) < 1e-4, 'Equal-length constraint should equalize solved line lengths.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_equal_length', 1e-6)
  }

  async function testParallelLines() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_a1',
        'sketch_point_a2',
        'sketch_point_b1',
        'sketch_point_b2',
      ],
      points: [
        makePoint('sketch_point_a1', 'A1', 3, 4),
        makePoint('sketch_point_a2', 'A2', 5, 6),
        makePoint('sketch_point_b1', 'B1', 0, 4),
        makePoint('sketch_point_b2', 'B2', 5, 6),
      ],
      entityIds: ['sketch_entity_a', 'sketch_entity_b'],
      entities: [
        makeLine('sketch_entity_a', 'Line A', 'sketch_point_a1', 'sketch_point_a2'),
        makeLine('sketch_entity_b', 'Line B', 'sketch_point_b1', 'sketch_point_b2'),
      ],
      constraintIds: ['constraint_parallel'],
      constraints: [{
        constraintId: 'constraint_parallel',
        kind: 'parallel',
        label: 'Parallel',
        entityIds: ['sketch_entity_a', 'sketch_entity_b'],
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const points = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    const ax = points.get('sketch_point_a2')![0] - points.get('sketch_point_a1')![0]
    const ay = points.get('sketch_point_a2')![1] - points.get('sketch_point_a1')![1]
    const bx = points.get('sketch_point_b2')![0] - points.get('sketch_point_b1')![0]
    const by = points.get('sketch_point_b2')![1] - points.get('sketch_point_b1')![1]
    const cross = ax * by - ay * bx
    expectTrue(Math.abs(cross) < 1e-4, 'Parallel constraint should drive the line cross product to zero.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_parallel', 1e-6)
  }

  async function testPerpendicularLines() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_a1',
        'sketch_point_a2',
        'sketch_point_b1',
        'sketch_point_b2',
      ],
      points: [
        makePoint('sketch_point_a1', 'A1', 3, 4),
        makePoint('sketch_point_a2', 'A2', 5, 6),
        makePoint('sketch_point_b1', 'B1', 0, 4),
        makePoint('sketch_point_b2', 'B2', 5, 6),
      ],
      entityIds: ['sketch_entity_a', 'sketch_entity_b'],
      entities: [
        makeLine('sketch_entity_a', 'Line A', 'sketch_point_a1', 'sketch_point_a2'),
        makeLine('sketch_entity_b', 'Line B', 'sketch_point_b1', 'sketch_point_b2'),
      ],
      constraintIds: ['constraint_perpendicular'],
      constraints: [{
        constraintId: 'constraint_perpendicular',
        kind: 'perpendicular',
        label: 'Perpendicular',
        entityIds: ['sketch_entity_a', 'sketch_entity_b'],
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const points = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    const ax = points.get('sketch_point_a2')![0] - points.get('sketch_point_a1')![0]
    const ay = points.get('sketch_point_a2')![1] - points.get('sketch_point_a1')![1]
    const bx = points.get('sketch_point_b2')![0] - points.get('sketch_point_b1')![0]
    const by = points.get('sketch_point_b2')![1] - points.get('sketch_point_b1')![1]
    const dot = ax * bx + ay * by
    expectTrue(Math.abs(dot) < 1e-2, 'Perpendicular constraint should drive the line dot product near zero.')
    assertGradientMatchesFiniteDifference(definition, 'constraint_perpendicular', 1e-6)
  }

  async function testArcStartPointCoincident() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_center',
        'sketch_point_arc_start',
        'sketch_point_arc_end',
        'sketch_point_line_start',
        'sketch_point_line_end',
      ],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
        makePoint('sketch_point_arc_start', 'Arc start', 1, 0),
        makePoint('sketch_point_arc_end', 'Arc end', -1, 0),
        makePoint('sketch_point_line_start', 'Line start', 3, 4),
        makePoint('sketch_point_line_end', 'Line end', 5, 6),
      ],
      entityIds: ['sketch_entity_arc', 'sketch_entity_line'],
      entities: [
        makeArc(
          'sketch_entity_arc',
          'Arc',
          'sketch_point_center',
          'sketch_point_arc_start',
          'sketch_point_arc_end',
        ),
        makeLine('sketch_entity_line', 'Line', 'sketch_point_line_start', 'sketch_point_line_end'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_arc_start_coincident'],
      dimensions: [{
        dimensionId: 'dimension_arc_start_coincident',
        kind: 'arcStartPointCoincident',
        label: 'Arc start coincident',
        entityId: 'sketch_entity_arc',
        pointId: 'sketch_point_line_end',
      }],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const arc = solved.solvedSnapshot.solvedEntities.find((entity) => entity.entityId === 'sketch_entity_arc')
    const point = solved.solvedSnapshot.solvedPoints.find((entry) => entry.pointId === 'sketch_point_line_end')
    expectTrue(arc?.kind === 'arc' && point, 'Expected solved arc and endpoint point.')
    expectTrue(
      Math.hypot(arc.startPosition[0] - point.solvedPosition[0], arc.startPosition[1] - point.solvedPosition[1]) < 1e-4,
      'Arc start coincidence should match the referenced point.',
    )
    assertGradientMatchesFiniteDifference(definition, 'dimension_arc_start_coincident', 1e-5)
  }

  async function testArcEndPointCoincident() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_center',
        'sketch_point_arc_start',
        'sketch_point_arc_end',
        'sketch_point_line_start',
        'sketch_point_line_end',
      ],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
        makePoint('sketch_point_arc_start', 'Arc start', 1, 0),
        makePoint('sketch_point_arc_end', 'Arc end', -1, 0),
        makePoint('sketch_point_line_start', 'Line start', 3, 4),
        makePoint('sketch_point_line_end', 'Line end', 5, 6),
      ],
      entityIds: ['sketch_entity_arc', 'sketch_entity_line'],
      entities: [
        makeArc(
          'sketch_entity_arc',
          'Arc',
          'sketch_point_center',
          'sketch_point_arc_start',
          'sketch_point_arc_end',
        ),
        makeLine('sketch_entity_line', 'Line', 'sketch_point_line_start', 'sketch_point_line_end'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_arc_end_coincident'],
      dimensions: [{
        dimensionId: 'dimension_arc_end_coincident',
        kind: 'arcEndPointCoincident',
        label: 'Arc end coincident',
        entityId: 'sketch_entity_arc',
        pointId: 'sketch_point_line_start',
      }],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const arc = solved.solvedSnapshot.solvedEntities.find((entity) => entity.entityId === 'sketch_entity_arc')
    const point = solved.solvedSnapshot.solvedPoints.find((entry) => entry.pointId === 'sketch_point_line_start')
    expectTrue(arc?.kind === 'arc' && point, 'Expected solved arc and endpoint point.')
    expectTrue(
      Math.hypot(arc.endPosition[0] - point.solvedPosition[0], arc.endPosition[1] - point.solvedPosition[1]) < 1e-4,
      'Arc end coincidence should match the referenced point.',
    )
    assertGradientMatchesFiniteDifference(definition, 'dimension_arc_end_coincident', 1e-5)
  }

  async function testAxisAlignedRectangle() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 0.2, 0),
        makePoint('sketch_point_c', 'C', 0.2, 0.2),
        makePoint('sketch_point_d', 'D', 0, 0.2),
      ],
      entityIds: [
        'sketch_entity_line_a',
        'sketch_entity_line_b',
        'sketch_entity_line_c',
        'sketch_entity_line_d',
      ],
      entities: [
        makeLine('sketch_entity_line_a', 'A-B', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_line_b', 'B-C', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_line_c', 'C-D', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_line_d', 'D-A', 'sketch_point_d', 'sketch_point_a'),
      ],
      constraintIds: [
        'constraint_fix_a',
        'constraint_horizontal_a',
        'constraint_horizontal_c',
        'constraint_vertical_b',
        'constraint_vertical_d',
      ],
      constraints: [
        {
          constraintId: 'constraint_fix_a',
          kind: 'fixPoint',
          label: 'Fix A',
          pointId: 'sketch_point_a',
          position: [0, 0],
        },
        {
          constraintId: 'constraint_horizontal_a',
          kind: 'horizontal',
          label: 'Horizontal A',
          entityId: 'sketch_entity_line_a',
        },
        {
          constraintId: 'constraint_horizontal_c',
          kind: 'horizontal',
          label: 'Horizontal C',
          entityId: 'sketch_entity_line_c',
        },
        {
          constraintId: 'constraint_vertical_b',
          kind: 'vertical',
          label: 'Vertical B',
          entityId: 'sketch_entity_line_b',
        },
        {
          constraintId: 'constraint_vertical_d',
          kind: 'vertical',
          label: 'Vertical D',
          entityId: 'sketch_entity_line_d',
        },
      ],
      dimensionIds: ['dimension_width', 'dimension_height'],
      dimensions: [
        {
          dimensionId: 'dimension_width',
          kind: 'horizontalDistance',
          label: 'Width',
          pointIds: ['sketch_point_a', 'sketch_point_b'],
          value: 2,
        },
        {
          dimensionId: 'dimension_height',
          kind: 'verticalDistance',
          label: 'Height',
          pointIds: ['sketch_point_a', 'sketch_point_d'],
          value: 3,
        },
      ],
    }

    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const coords = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    expectTrue(coords.has('sketch_point_a'), 'Expected A.')
    expectTrue(coords.has('sketch_point_b'), 'Expected B.')
    expectTrue(coords.has('sketch_point_c'), 'Expected C.')
    expectTrue(coords.has('sketch_point_d'), 'Expected D.')
    const a = coords.get('sketch_point_a')!
    const b = coords.get('sketch_point_b')!
    const c = coords.get('sketch_point_c')!
    const d = coords.get('sketch_point_d')!
    expectTrue(Math.hypot(a[0] - 0, a[1] - 0) < 1e-5, 'A should solve to origin.')
    expectTrue(Math.hypot(b[0] - 2, b[1] - 0) < 1e-4, 'B should solve to (2,0).')
    expectTrue(Math.hypot(c[0] - 2, c[1] - 3) < 1e-4, 'C should solve to (2,3).')
    expectTrue(Math.hypot(d[0] - 0, d[1] - 3) < 1e-4, 'D should solve to (0,3).')
  }

  async function testRotatedRectangle() {
    await assertRotatedRectangleSolvesWithStrategy('bfgs', {
      expectedSolveState: 'solved',
      branchTolerance: 1e-5,
      dimensionTolerance: 1e-4,
    })
  }

  async function testProjectedDatumConstraintSeedsLogoReferenceImageAnchorTranslation() {
    const anchor2 = 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2'
    const baseDefinition = createLogoReferenceImageAnchorFixture()
    const anchoredDefinition: SketchDefinition = {
      ...baseDefinition,
      constraintIds: [
        ...baseDefinition.constraintIds,
        'constraint_reference_image_anchor_2_origin',
      ],
      constraints: [
        ...baseDefinition.constraints,
        {
          constraintId: 'constraint_reference_image_anchor_2_origin',
          kind: 'coincidentProjectedPoint',
          label: 'Anchor 2 at origin',
          point: {
            kind: 'localPoint',
            pointId: anchor2,
          },
          projectedPoint: {
            kind: 'sketchDatum',
            datum: 'origin',
          },
        },
      ],
    }

    const solved = solveSketchDefinitionCore({
      definition: anchoredDefinition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
      strategy: 'bfgs',
    })
    const anchor = solved.solvedSnapshot.solvedPoints.find((point) => point.pointId === anchor2)

    expectTrue(solved.status.solveState === 'solved', 'Logo-like anchor-to-origin constraint should solve.')
    expectTrue(anchor !== undefined, 'Expected solved reference image anchor.')
    assertClose(anchor.solvedPosition[0], 0, 1e-5, 'Reference image anchor should solve to origin x.')
    assertClose(anchor.solvedPosition[1], 0, 1e-5, 'Reference image anchor should solve to origin y.')
    expectTrue(
      solved.solvedSnapshot.constraintStatuses.every((status) => status.status === 'satisfied'),
      'All logo-like fixture constraints should remain satisfied after anchor-to-origin solve.',
    )
    expectTrue(
      solved.solvedSnapshot.dimensionStatuses.every((status) => status.status !== 'unsatisfied'),
      'All logo-like fixture dimensions should remain satisfied after anchor-to-origin solve.',
    )
  }

  async function assertRotatedRectangleSolvesWithStrategy(
    strategy: SketchSolveStrategy,
    options: {
      expectedSolveState: 'solved' | 'partiallySolved'
      branchTolerance: number
      dimensionTolerance: number
    },
  ) {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_a',
        'sketch_point_b',
        'sketch_point_c',
        'sketch_point_d',
        'sketch_point_reference',
      ],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0.1),
        makePoint('sketch_point_b', 'B', 0.3, 0),
        makePoint('sketch_point_c', 'C', 0.3, 0.3),
        makePoint('sketch_point_d', 'D', 0.1, 0.3),
        makePoint('sketch_point_reference', 'R', 1, 0),
      ],
      entityIds: [
        'sketch_entity_line_a',
        'sketch_entity_line_b',
        'sketch_entity_line_c',
        'sketch_entity_line_d',
      ],
      entities: [
        makeLine('sketch_entity_line_a', 'A-B', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_line_b', 'B-C', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_line_c', 'C-D', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_line_d', 'D-A', 'sketch_point_d', 'sketch_point_a'),
      ],
      constraintIds: [
        'constraint_fix_a',
        'constraint_fix_reference',
        'constraint_perpendicular_ab',
        'constraint_perpendicular_bc',
        'constraint_perpendicular_cd',
        'constraint_angle',
      ],
      constraints: [
        {
          constraintId: 'constraint_fix_a',
          kind: 'fixPoint',
          label: 'Fix A',
          pointId: 'sketch_point_a',
          position: [0, 0],
        },
        {
          constraintId: 'constraint_fix_reference',
          kind: 'fixPoint',
          label: 'Fix reference',
          pointId: 'sketch_point_reference',
          position: [1, 0],
        },
        {
          constraintId: 'constraint_perpendicular_ab',
          kind: 'perpendicular',
          label: 'AB perpendicular BC',
          entityIds: ['sketch_entity_line_a', 'sketch_entity_line_b'],
        },
        {
          constraintId: 'constraint_perpendicular_bc',
          kind: 'perpendicular',
          label: 'BC perpendicular CD',
          entityIds: ['sketch_entity_line_b', 'sketch_entity_line_c'],
        },
        {
          constraintId: 'constraint_perpendicular_cd',
          kind: 'perpendicular',
          label: 'CD perpendicular DA',
          entityIds: ['sketch_entity_line_c', 'sketch_entity_line_d'],
        },
        {
          constraintId: 'constraint_angle',
          kind: 'angle',
          label: 'Reference angle',
          pointIds: ['sketch_point_reference', 'sketch_point_b', 'sketch_point_a'],
          valueRadians: Math.PI / 4,
        },
      ],
      dimensionIds: ['dimension_ab', 'dimension_ad'],
      dimensions: [
        {
          dimensionId: 'dimension_ab',
          kind: 'distance',
          label: 'AB',
          axis: 'aligned',
          pointIds: ['sketch_point_a', 'sketch_point_b'],
          value: 2,
        },
        {
          dimensionId: 'dimension_ad',
          kind: 'distance',
          label: 'AD',
          axis: 'aligned',
          pointIds: ['sketch_point_a', 'sketch_point_d'],
          value: 3,
        },
      ],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
      strategy,
    })
    const coords = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    const a = coords.get('sketch_point_a')
    const b = coords.get('sketch_point_b')
    const d = coords.get('sketch_point_d')
    const reference = coords.get('sketch_point_reference')
    expectTrue(a && b && d && reference, `Expected solved rotated-rectangle anchors for ${strategy}.`)
    expectTrue(
      solved.status.solveState === options.expectedSolveState,
      `Rotated rectangle should report ${options.expectedSolveState} for ${strategy}.`,
    )
    assertRotatedRectangleMatchesIsotopeBranches(solved, strategy, options.branchTolerance)
    assertClose(
      Math.hypot(b[0] - a[0], b[1] - a[1]),
      2,
      options.dimensionTolerance,
      `AB should solve to length 2 for ${strategy}.`,
    )
    assertClose(
      Math.hypot(d[0] - a[0], d[1] - a[1]),
      3,
      options.dimensionTolerance,
      `AD should solve to length 3 for ${strategy}.`,
    )
  }

  async function testRotatedRectangleGradientDescent() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 0.2, 0),
        makePoint('sketch_point_c', 'C', 0.2, 0.2),
        makePoint('sketch_point_d', 'D', 0, 0.2),
      ],
      entityIds: [
        'sketch_entity_line_a',
        'sketch_entity_line_b',
        'sketch_entity_line_c',
        'sketch_entity_line_d',
      ],
      entities: [
        makeLine('sketch_entity_line_a', 'A-B', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_line_b', 'B-C', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_line_c', 'C-D', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_line_d', 'D-A', 'sketch_point_d', 'sketch_point_a'),
      ],
      constraintIds: [
        'constraint_fix_a',
        'constraint_horizontal_a',
        'constraint_horizontal_c',
        'constraint_vertical_b',
        'constraint_vertical_d',
      ],
      constraints: [
        {
          constraintId: 'constraint_fix_a',
          kind: 'fixPoint',
          label: 'Fix A',
          pointId: 'sketch_point_a',
          position: [0, 0],
        },
        {
          constraintId: 'constraint_horizontal_a',
          kind: 'horizontal',
          label: 'Horizontal A',
          entityId: 'sketch_entity_line_a',
        },
        {
          constraintId: 'constraint_horizontal_c',
          kind: 'horizontal',
          label: 'Horizontal C',
          entityId: 'sketch_entity_line_c',
        },
        {
          constraintId: 'constraint_vertical_b',
          kind: 'vertical',
          label: 'Vertical B',
          entityId: 'sketch_entity_line_b',
        },
        {
          constraintId: 'constraint_vertical_d',
          kind: 'vertical',
          label: 'Vertical D',
          entityId: 'sketch_entity_line_d',
        },
      ],
      dimensionIds: ['dimension_width', 'dimension_height'],
      dimensions: [
        {
          dimensionId: 'dimension_width',
          kind: 'horizontalDistance',
          label: 'Width',
          pointIds: ['sketch_point_a', 'sketch_point_b'],
          value: 2,
        },
        {
          dimensionId: 'dimension_height',
          kind: 'verticalDistance',
          label: 'Height',
          pointIds: ['sketch_point_a', 'sketch_point_d'],
          value: 3,
        },
      ],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
      strategy: 'gradientDescent',
    })
    const coords = new Map(solved.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    const a = coords.get('sketch_point_a')
    const b = coords.get('sketch_point_b')
    const c = coords.get('sketch_point_c')
    const d = coords.get('sketch_point_d')
    expectTrue(a && b && c && d, 'Expected solved axis-aligned rectangle anchors for gradient descent.')
    expectTrue(solved.status.solveState === 'solved', 'Gradient descent should solve the axis-aligned rectangle fixture.')
    expectTrue(Math.hypot(a[0] - 0, a[1] - 0) < 1e-5, 'Gradient descent should keep A at the origin.')
    expectTrue(Math.hypot(b[0] - 2, b[1] - 0) < 1e-4, 'Gradient descent should solve B to (2,0).')
    expectTrue(Math.hypot(c[0] - 2, c[1] - 3) < 1e-4, 'Gradient descent should solve C to (2,3).')
    expectTrue(Math.hypot(d[0] - 0, d[1] - 3) < 1e-4, 'Gradient descent should solve D to (0,3).')
  }

  async function testRotatedRectangleGaussNewton() {
    await assertRotatedRectangleSolvesWithStrategy('gaussNewton', {
      expectedSolveState: 'partiallySolved',
      branchTolerance: 1e-1,
      dimensionTolerance: 1e-1,
    })
  }

  async function testRotatedRectangleLevenbergMarquardt() {
    await assertRotatedRectangleSolvesWithStrategy('levenbergMarquardt', {
      expectedSolveState: 'partiallySolved',
      branchTolerance: 1e-1,
      dimensionTolerance: 1e-1,
    })
  }

  async function testValidationRejectsDegenerateLine() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 0, 0),
      ],
      entityIds: ['sketch_entity_line'],
      entities: [makeLine('sketch_entity_line', 'Line', 'sketch_point_a', 'sketch_point_b')],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const validation = validateSketchDefinitionCore({ definition, tolerances })
    expectTrue(!validation.isValid, 'Degenerate line should fail validation.')
  }

  async function testValidationRejectsPointIdsWithoutRecords() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_missing'],
      points: [makePoint('sketch_point_a', 'A', 0, 0)],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const validation = validateSketchDefinitionCore({ definition, tolerances })
    expectTrue(
      validation.diagnostics.some((diagnostic) => diagnostic.code === 'point-missing-from-records'),
      'Validation should reject point ids that do not have backing records.',
    )
  }

  async function testValidationRejectsMissingConstraintReferences() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a'],
      points: [makePoint('sketch_point_a', 'A', 0, 0)],
      entityIds: [],
      entities: [],
      constraintIds: ['constraint_missing_fix_point'],
      constraints: [{
        constraintId: 'constraint_missing_fix_point',
        kind: 'fixPoint',
        label: 'Broken fix point',
        pointId: 'sketch_point_b',
        position: [0, 0],
      }],
      dimensionIds: [],
      dimensions: [],
    }

    const validation = validateSketchDefinitionCore({ definition, tolerances })
    expectTrue(
      validation.diagnostics.some((diagnostic) => diagnostic.code === 'missing-fix-point'),
      'Validation should reject constraints that reference missing points.',
    )
  }

  async function testValidationRejectsDuplicatePointRecords() {
    const duplicate = makePoint('sketch_point_duplicate', 'Duplicate', 0, 0)
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_duplicate'],
      points: [
        duplicate,
        {
          ...duplicate,
          position: [10, 0],
        },
      ],
      entityIds: [],
      entities: [],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const validation = validateSketchDefinitionCore({ definition, tolerances })
    expectTrue(!validation.isValid, 'Validation should reject duplicate point records even when pointIds is unique.')
    expectTrue(
      validation.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-point-record'),
      'Validation should emit duplicate-point-record for duplicate point records.',
    )
  }

  async function testValidationRejectsDuplicateEntityRecords() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 1, 0),
        makePoint('sketch_point_c', 'C', 0, 1),
      ],
      entityIds: ['sketch_entity_duplicate'],
      entities: [
        makeLine('sketch_entity_duplicate', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_duplicate', 'AC', 'sketch_point_a', 'sketch_point_c'),
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }

    const validation = validateSketchDefinitionCore({ definition, tolerances })
    expectTrue(!validation.isValid, 'Validation should reject duplicate entity records even when entityIds is unique.')
    expectTrue(
      validation.diagnostics.some((diagnostic) => diagnostic.code === 'duplicate-entity-record'),
      'Validation should emit duplicate-entity-record for duplicate entity records.',
    )
  }

  async function testCircleRadiusDimensionDrivesSolvedCircleRadius() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_center'],
      points: [makePoint('sketch_point_center', 'Center', 0, 0)],
      entityIds: ['sketch_entity_circle'],
      entities: [makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 1)],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_circle_radius'],
      dimensions: [{
        dimensionId: 'dimension_circle_radius',
        kind: 'circleRadius',
        label: 'Radius 2',
        entityId: 'sketch_entity_circle',
        value: 2,
      }],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const solvedCircle = solved.solvedSnapshot.solvedEntities.find((entity) =>
      entity.entityId === 'sketch_entity_circle' && entity.kind === 'circle',
    )
    const dimensionStatus = solved.solvedSnapshot.dimensionStatuses.find((status) =>
      status.dimensionId === 'dimension_circle_radius',
    )

    expectTrue(solved.status.solveState === 'solved', 'Circle radius dimension should keep the solve in a solved state.')
    expectTrue(!!solvedCircle, 'Circle radius dimension should produce solved circle geometry.')
    expectTrue(
      solvedCircle?.kind === 'circle' && Math.abs(solvedCircle.solvedRadius - 2) < 1e-4,
      'Circle radius dimension should drive the solved circle radius to the dimension value.',
    )
    expectTrue(dimensionStatus?.status === 'driving', 'Circle radius dimension should report driving status once satisfied.')
    expectTrue(
      dimensionStatus !== undefined && dimensionStatus.solvedValue !== null && Math.abs(dimensionStatus.solvedValue - 2) < 1e-4,
      'Circle radius dimension status should report the solved radius value.',
    )
  }

  async function testCircleDiameterDimensionDrivesSolvedCircleRadius() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_center'],
      points: [makePoint('sketch_point_center', 'Center', 0, 0)],
      entityIds: ['sketch_entity_circle'],
      entities: [makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 1)],
      constraintIds: [],
      constraints: [],
      dimensionIds: ['dimension_circle_diameter'],
      dimensions: [{
        dimensionId: 'dimension_circle_diameter',
        kind: 'diameter',
        label: 'Diameter 6',
        entityId: 'sketch_entity_circle',
        value: 6,
      }],
    }

    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const solvedCircle = solved.solvedSnapshot.solvedEntities.find((entity) =>
      entity.entityId === 'sketch_entity_circle' && entity.kind === 'circle',
    )
    const dimensionStatus = solved.solvedSnapshot.dimensionStatuses.find((status) =>
      status.dimensionId === 'dimension_circle_diameter',
    )

    expectTrue(solved.status.solveState === 'solved', 'Circle diameter dimension should keep the solve in a solved state.')
    expectTrue(!!solvedCircle, 'Circle diameter dimension should produce solved circle geometry.')
    expectTrue(
      solvedCircle?.kind === 'circle' && Math.abs(solvedCircle.solvedRadius - 3) < 1e-4,
      'Circle diameter dimension should drive the solved circle radius to half of the diameter value.',
    )
    expectTrue(dimensionStatus?.status === 'driving', 'Circle diameter dimension should report driving status once satisfied.')
    expectTrue(
      dimensionStatus !== undefined && dimensionStatus.solvedValue !== null && Math.abs(dimensionStatus.solvedValue - 6) < 1e-4,
      'Circle diameter dimension status should report the solved diameter value.',
    )
  }

  function createIndependentLineComponentsDefinition(): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 1, 0),
        makePoint('sketch_point_c', 'C', 10, 0),
        makePoint('sketch_point_d', 'D', 11, 0),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_cd'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
      ],
      constraintIds: ['constraint_ab_horizontal', 'constraint_cd_horizontal'],
      constraints: [
        {
          constraintId: 'constraint_ab_horizontal',
          kind: 'horizontal',
          label: 'AB horizontal',
          entityId: 'sketch_entity_ab',
        },
        {
          constraintId: 'constraint_cd_horizontal',
          kind: 'horizontal',
          label: 'CD horizontal',
          entityId: 'sketch_entity_cd',
        },
      ],
      dimensionIds: ['dimension_ab_length', 'dimension_cd_length'],
      dimensions: [
        {
          dimensionId: 'dimension_ab_length',
          kind: 'lineLength',
          label: 'AB length',
          entityId: 'sketch_entity_ab',
          value: 1,
        },
        {
          dimensionId: 'dimension_cd_length',
          kind: 'lineLength',
          label: 'CD length',
          entityId: 'sketch_entity_cd',
          value: 1,
        },
      ],
    }
  }

  async function testCompiledSolveProgramReuseAndInvalidation() {
    const definition = createIndependentLineComponentsDefinition()
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const numericEdit: SketchDefinition = {
      ...definition,
      points: definition.points.map((point) =>
        point.pointId === 'sketch_point_a' ? { ...point, position: [0.25, 0] as const } : point,
      ),
    }

    expectTrue(program.components.length === 2, 'Compiled program should partition independent line components.')
    expectTrue(
      isCompiledSketchSolveProgramCompatible(program, {
        definition: numericEdit,
        tolerances,
      }),
      'Compiled program should remain compatible across authored point numeric edits.',
    )
    expectTrue(
      !isCompiledSketchSolveProgramCompatible(program, {
        definition,
        tolerances: { ...tolerances, coincidence: 1e-5 },
      }),
      'Compiled program should invalidate when tolerance policy changes.',
    )
    expectTrue(
      solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' }).status.solveState === 'solved',
      'Full solve should route through the compiled-program path and remain solved.',
    )
  }

  async function testInteractiveSessionWarmStartStaleRejectionAndComponentIsolation() {
    const definition = createIndependentLineComponentsDefinition()
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const session = createCompiledSketchSolveSession({
      sessionId: 'interactive_sketch_solve_core_spec',
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    })
    expectTrue(session.warmStarted, 'Interactive sessions should warm-start from compatible solved snapshots.')

    const result = updateCompiledSketchSolveSession(session, {
      kind: 'sketchPoint',
      pointId: 'sketch_point_b',
      position: [2, 0],
    }, 1e-4)
    expectTrue(result.kind === 'solved', 'Interactive update should accept a translatable constrained component.')
    const points = new Map(result.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    assertClose(points.get('sketch_point_c')?.[0] ?? Number.NaN, 10, 1e-6, 'Unaffected component point C should remain stable.')
    assertClose(points.get('sketch_point_d')?.[0] ?? Number.NaN, 11, 1e-6, 'Unaffected component point D should remain stable.')

    session.disposed = true
    const stale = updateCompiledSketchSolveSession(session, {
      kind: 'sketchPoint',
      pointId: 'sketch_point_b',
      position: [3, 0],
    })
    expectTrue(
      stale.kind === 'blocked' && stale.reason === 'staleSession' && stale.diagnostics.some((diagnostic) => diagnostic.code === 'stale-interactive-solve-session'),
      'Disposed interactive sessions should reject later updates with a stale-session diagnostic.',
    )
  }

  async function testCompiledInteractiveDragKeepsInitiallyCoincidentPointsTogether() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 0, 0),
      ],
      entityIds: [],
      entities: [],
      constraintIds: ['constraint_ab_coincident'],
      constraints: [
        {
          constraintId: 'constraint_ab_coincident',
          kind: 'coincident',
          label: 'A coincident B',
          pointIds: ['sketch_point_a', 'sketch_point_b'],
        },
      ],
      dimensionIds: [],
      dimensions: [],
    }
    const dragTarget = {
      kind: 'sketchPoint',
      pointId: 'sketch_point_a',
      position: [2, 3],
    } as const

    const stateless = solveSketchDefinitionWithDraggedPointTarget({
      definition,
      dragTarget,
      tolerances,
      partialSolvePolicy: 'bestEffort',
      targetTolerance: 1e-4,
    })
    expectTrue(stateless.kind === 'solved', 'Stateless dragged solve should accept initially coincident points.')

    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const session = createCompiledSketchSolveSession({
      sessionId: 'interactive_sketch_solve_coincident_core_spec',
      program,
      priorSolvedSnapshot: solveSketchDefinitionCore({
        definition,
        tolerances,
        partialSolvePolicy: 'bestEffort',
      }).solvedSnapshot,
    })
    const compiled = updateCompiledSketchSolveSession(session, dragTarget, 1e-4)

    expectTrue(compiled.kind === 'solved', 'Compiled interactive update should accept initially coincident points.')
    const points = new Map(compiled.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    assertClose(points.get('sketch_point_a')?.[0] ?? Number.NaN, 2, 1e-4, 'Dragged point A should reach the target x position.')
    assertClose(points.get('sketch_point_a')?.[1] ?? Number.NaN, 3, 1e-4, 'Dragged point A should reach the target y position.')
    assertClose(points.get('sketch_point_b')?.[0] ?? Number.NaN, 2, 1e-4, 'Coincident point B should move with A on x.')
    assertClose(points.get('sketch_point_b')?.[1] ?? Number.NaN, 3, 1e-4, 'Coincident point B should move with A on y.')
  }

  async function testCompiledInteractiveDragTranslatesRigidRectangle() {
    const definition: SketchDefinition = {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 2, 0),
        makePoint('sketch_point_c', 'C', 2, 3),
        makePoint('sketch_point_d', 'D', 0, 3),
      ],
      entityIds: [
        'sketch_entity_line_a',
        'sketch_entity_line_b',
        'sketch_entity_line_c',
        'sketch_entity_line_d',
      ],
      entities: [
        makeLine('sketch_entity_line_a', 'A-B', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_line_b', 'B-C', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_line_c', 'C-D', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_line_d', 'D-A', 'sketch_point_d', 'sketch_point_a'),
      ],
      constraintIds: [
        'constraint_horizontal_a',
        'constraint_horizontal_c',
        'constraint_vertical_b',
        'constraint_vertical_d',
      ],
      constraints: [
        {
          constraintId: 'constraint_horizontal_a',
          kind: 'horizontal',
          label: 'Horizontal A',
          entityId: 'sketch_entity_line_a',
        },
        {
          constraintId: 'constraint_horizontal_c',
          kind: 'horizontal',
          label: 'Horizontal C',
          entityId: 'sketch_entity_line_c',
        },
        {
          constraintId: 'constraint_vertical_b',
          kind: 'vertical',
          label: 'Vertical B',
          entityId: 'sketch_entity_line_b',
        },
        {
          constraintId: 'constraint_vertical_d',
          kind: 'vertical',
          label: 'Vertical D',
          entityId: 'sketch_entity_line_d',
        },
      ],
      dimensionIds: ['dimension_width', 'dimension_height'],
      dimensions: [
        {
          dimensionId: 'dimension_width',
          kind: 'horizontalDistance',
          label: 'Width',
          pointIds: ['sketch_point_a', 'sketch_point_b'],
          value: 2,
        },
        {
          dimensionId: 'dimension_height',
          kind: 'verticalDistance',
          label: 'Height',
          pointIds: ['sketch_point_a', 'sketch_point_d'],
          value: 3,
        },
      ],
    }
    const solved = solveSketchDefinitionCore({ definition, tolerances, partialSolvePolicy: 'bestEffort' })
    const program = compileSketchSolveProgram({
      definition,
      tolerances,
      partialSolvePolicy: 'bestEffort',
    })
    const session = createCompiledSketchSolveSession({
      sessionId: 'interactive_sketch_solve_rectangle_translate_core_spec',
      program,
      priorSolvedSnapshot: solved.solvedSnapshot,
    })
    const result = updateCompiledSketchSolveSession(session, {
      kind: 'sketchPoint',
      pointId: 'sketch_point_b',
      position: [7, 11],
    }, 1e-4)

    expectTrue(result.kind === 'solved', 'Interactive update should accept rigid rectangle translation.')
    const points = new Map(result.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    assertClose(points.get('sketch_point_a')?.[0] ?? Number.NaN, 5, 1e-4, 'Point A should translate on x.')
    assertClose(points.get('sketch_point_a')?.[1] ?? Number.NaN, 11, 1e-4, 'Point A should translate on y.')
    assertClose(points.get('sketch_point_b')?.[0] ?? Number.NaN, 7, 1e-4, 'Point B should reach target x.')
    assertClose(points.get('sketch_point_b')?.[1] ?? Number.NaN, 11, 1e-4, 'Point B should reach target y.')
    assertClose(points.get('sketch_point_c')?.[0] ?? Number.NaN, 7, 1e-4, 'Point C should translate on x.')
    assertClose(points.get('sketch_point_c')?.[1] ?? Number.NaN, 14, 1e-4, 'Point C should translate on y.')
    assertClose(points.get('sketch_point_d')?.[0] ?? Number.NaN, 5, 1e-4, 'Point D should translate on x.')
    assertClose(points.get('sketch_point_d')?.[1] ?? Number.NaN, 14, 1e-4, 'Point D should translate on y.')
  }

  async function run() {
    await testFixPoint()
    await testEuclideanDistance()
    await testHorizontalDistance()
    await testVerticalDistance()
    await testExpandedDimensionStatuses()
    await testAxisQualifiedDistance()
    await testObtuseLineAngleDimension()
    await testHorizontalLine()
    await testVerticalLine()
    await testAngleBetweenPoints()
    await testAngleBetweenPointsSpecificCase()
    await testEqualLength()
    await testParallelLines()
    await testPerpendicularLines()
    await testCollinearSolvesLocalLinesAndPointsAgainstInfiniteGeometry()
    await testCollinearSolvesAgainstProjectedLineWithoutMovingReference()
    await testCollinearValidationReportsMissingAndDegenerateTargets()
    await testArcStartPointCoincident()
    await testArcEndPointCoincident()
    await testAxisAlignedRectangle()
    await testProjectedDatumConstraintSeedsLogoReferenceImageAnchorTranslation()
    await testRotatedRectangle()
    await testRotatedRectangleGradientDescent()
    await testRotatedRectangleGaussNewton()
    await testRotatedRectangleLevenbergMarquardt()
    await testValidationRejectsDegenerateLine()
    await testValidationRejectsPointIdsWithoutRecords()
    await testValidationRejectsMissingConstraintReferences()
    await testValidationRejectsDuplicatePointRecords()
    await testValidationRejectsDuplicateEntityRecords()
    await testCircleRadiusDimensionDrivesSolvedCircleRadius()
    await testCircleDiameterDimensionDrivesSolvedCircleRadius()
    await testCompiledSolveProgramReuseAndInvalidation()
    await testInteractiveSessionWarmStartStaleRejectionAndComponentIsolation()
    await testCompiledInteractiveDragKeepsInitiallyCoincidentPointsTogether()
    await testCompiledInteractiveDragTranslatesRigidRectangle()
  }

  run().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
})
