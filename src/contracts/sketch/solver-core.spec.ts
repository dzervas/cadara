import { test } from 'bun:test'
import {
  evaluateSketchScalarConstraintForTest,
  getSketchSolveInitialValuesForTest,
  solveSketchDefinitionCore,
  validateSketchDefinitionCore,
  type SketchSolveStrategy,
} from '@/contracts/sketch/solver-core'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { ConstraintId, DimensionId } from '@/contracts/shared/ids'

test('src/contracts/sketch/solver-core.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function assertClose(actual: number, expected: number, tolerance: number, message: string) {
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
    assert(
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
    assert(a && b && c && d && reference, `Expected solved rotated-rectangle anchors for ${strategy}.`)

    const sqrt2 = Math.sqrt(2)
    const halfSqrt2 = sqrt2 / 2
    const matches = (point: readonly [number, number], expected: readonly [number, number]) =>
      Math.hypot(point[0] - expected[0], point[1] - expected[1]) < tolerance

    assert(matches(reference, [1, 0]), `Reference point should remain fixed for ${strategy}.`)
    assert(matches(a, [0, 0]), `A should remain at origin for ${strategy}.`)

    if (b[1] < 0) {
      assert(matches(b, [sqrt2, -sqrt2]), `B should match isotope below-axis branch for ${strategy}.`)
      if (c[1] < b[1]) {
        assert(matches(c, [-halfSqrt2, -5 * halfSqrt2]), `C should match isotope down-left branch for ${strategy}.`)
        assert(matches(d, [-3 * halfSqrt2, -3 * halfSqrt2]), `D should match isotope down-left branch for ${strategy}.`)
        return
      }

      assert(matches(c, [5 * halfSqrt2, halfSqrt2]), `C should match isotope up-right branch for ${strategy}.`)
      assert(matches(d, [3 * halfSqrt2, 3 * halfSqrt2]), `D should match isotope up-right branch for ${strategy}.`)
      return
    }

    assert(matches(b, [sqrt2, sqrt2]), `B should match isotope above-axis branch for ${strategy}.`)
    if (c[1] > b[1]) {
      assert(matches(c, [-halfSqrt2, 5 * halfSqrt2]), `C should match isotope up-left branch for ${strategy}.`)
      assert(matches(d, [-3 * halfSqrt2, 3 * halfSqrt2]), `D should match isotope up-left branch for ${strategy}.`)
      return
    }

    assert(matches(c, [5 * halfSqrt2, -halfSqrt2]), `C should match isotope down-right branch for ${strategy}.`)
    assert(matches(d, [3 * halfSqrt2, -3 * halfSqrt2]), `D should match isotope down-right branch for ${strategy}.`)
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
    assert(point !== undefined, 'Expected one solved point.')
    assert(Math.abs(point.solvedPosition[0] - 1) < 1e-6, 'Fix point should preserve x.')
    assert(Math.abs(point.solvedPosition[1] - 1) < 1e-6, 'Fix point should solve y to 1.')
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
    assert(a !== undefined && b !== undefined, 'Expected solved point pair.')
    const distance = Math.hypot(
      a.solvedPosition[0] - b.solvedPosition[0],
      a.solvedPosition[1] - b.solvedPosition[1],
    )
    assert(Math.abs(distance - 3) < 1e-4, 'Aligned distance should solve to 3.')
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
    assert(a !== undefined && b !== undefined, 'Expected solved point pair.')
    assert(Math.abs((b.solvedPosition[0] - a.solvedPosition[0]) + 3) < 1e-4, 'Horizontal distance should solve to -3.')
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
    assert(a !== undefined && b !== undefined, 'Expected solved point pair.')
    assert(Math.abs((b.solvedPosition[1] - a.solvedPosition[1]) - 3) < 1e-4, 'Vertical distance should solve to 3.')
    assertGradientMatchesFiniteDifference(definition, 'dimension_vertical_distance', 1e-6)
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
    assert(horizontalA !== undefined && horizontalB !== undefined, 'Expected solved horizontal point pair.')
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
    assert(verticalA !== undefined && verticalB !== undefined, 'Expected solved vertical point pair.')
    assertClose(
      verticalB.solvedPosition[1] - verticalA.solvedPosition[1],
      4,
      1e-4,
      'Axis-qualified vertical distance should solve to 4.',
    )
    assertGradientMatchesFiniteDifference(vertical, 'dimension_axis_vertical', 1e-6)
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
    assert(a !== undefined && b !== undefined, 'Expected solved line endpoints.')
    assert(Math.abs(b.solvedPosition[1] - a.solvedPosition[1]) < 1e-6, 'Horizontal line should end with zero y delta.')
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
    assert(a !== undefined && b !== undefined, 'Expected solved line endpoints.')
    assert(Math.abs(b.solvedPosition[0] - a.solvedPosition[0]) < 1e-6, 'Vertical line should end with zero x delta.')
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
    assert(pointA && pointB && pointM, 'Expected solved angle points.')
    const d1x = pointA.solvedPosition[0] - pointM.solvedPosition[0]
    const d1y = pointA.solvedPosition[1] - pointM.solvedPosition[1]
    const d2x = pointB.solvedPosition[0] - pointM.solvedPosition[0]
    const d2y = pointB.solvedPosition[1] - pointM.solvedPosition[1]
    const angle = Math.acos(
      Math.max(-1, Math.min(1, (d1x * d2x + d1y * d2y) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)))),
    )
    assert(Math.abs(angle - Math.PI / 4) < 1e-4, 'Angle should solve to PI/4.')
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
    assert(pointA && pointB && pointM, 'Expected solved points for specific angle case.')
    const d1x = pointA.solvedPosition[0] - pointM.solvedPosition[0]
    const d1y = pointA.solvedPosition[1] - pointM.solvedPosition[1]
    const d2x = pointB.solvedPosition[0] - pointM.solvedPosition[0]
    const d2y = pointB.solvedPosition[1] - pointM.solvedPosition[1]
    const angle = Math.acos(
      Math.max(-1, Math.min(1, (d1x * d2x + d1y * d2y) / (Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y)))),
    )
    assert(Math.abs(angle - Math.PI / 2) < 1e-3, 'Specific angle case should solve to PI/2.')
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
    assert(Math.abs(lenA - lenB) < 1e-4, 'Equal-length constraint should equalize solved line lengths.')
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
    assert(Math.abs(cross) < 1e-4, 'Parallel constraint should drive the line cross product to zero.')
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
    assert(Math.abs(dot) < 1e-2, 'Perpendicular constraint should drive the line dot product near zero.')
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
    assert(arc?.kind === 'arc' && point, 'Expected solved arc and endpoint point.')
    assert(
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
    assert(arc?.kind === 'arc' && point, 'Expected solved arc and endpoint point.')
    assert(
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
    assert(coords.has('sketch_point_a'), 'Expected A.')
    assert(coords.has('sketch_point_b'), 'Expected B.')
    assert(coords.has('sketch_point_c'), 'Expected C.')
    assert(coords.has('sketch_point_d'), 'Expected D.')
    const a = coords.get('sketch_point_a')!
    const b = coords.get('sketch_point_b')!
    const c = coords.get('sketch_point_c')!
    const d = coords.get('sketch_point_d')!
    assert(Math.hypot(a[0] - 0, a[1] - 0) < 1e-5, 'A should solve to origin.')
    assert(Math.hypot(b[0] - 2, b[1] - 0) < 1e-4, 'B should solve to (2,0).')
    assert(Math.hypot(c[0] - 2, c[1] - 3) < 1e-4, 'C should solve to (2,3).')
    assert(Math.hypot(d[0] - 0, d[1] - 3) < 1e-4, 'D should solve to (0,3).')
  }

  async function testRotatedRectangle() {
    await assertRotatedRectangleSolvesWithStrategy('bfgs', {
      expectedSolveState: 'solved',
      branchTolerance: 1e-5,
      dimensionTolerance: 1e-4,
    })
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
    assert(a && b && d && reference, `Expected solved rotated-rectangle anchors for ${strategy}.`)
    assert(
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
    assert(a && b && c && d, 'Expected solved axis-aligned rectangle anchors for gradient descent.')
    assert(solved.status.solveState === 'solved', 'Gradient descent should solve the axis-aligned rectangle fixture.')
    assert(Math.hypot(a[0] - 0, a[1] - 0) < 1e-5, 'Gradient descent should keep A at the origin.')
    assert(Math.hypot(b[0] - 2, b[1] - 0) < 1e-4, 'Gradient descent should solve B to (2,0).')
    assert(Math.hypot(c[0] - 2, c[1] - 3) < 1e-4, 'Gradient descent should solve C to (2,3).')
    assert(Math.hypot(d[0] - 0, d[1] - 3) < 1e-4, 'Gradient descent should solve D to (0,3).')
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
    assert(!validation.isValid, 'Degenerate line should fail validation.')
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
    assert(
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
    assert(
      validation.diagnostics.some((diagnostic) => diagnostic.code === 'missing-fix-point'),
      'Validation should reject constraints that reference missing points.',
    )
  }

  async function run() {
    await testFixPoint()
    await testEuclideanDistance()
    await testHorizontalDistance()
    await testVerticalDistance()
    await testAxisQualifiedDistance()
    await testHorizontalLine()
    await testVerticalLine()
    await testAngleBetweenPoints()
    await testAngleBetweenPointsSpecificCase()
    await testEqualLength()
    await testParallelLines()
    await testPerpendicularLines()
    await testArcStartPointCoincident()
    await testArcEndPointCoincident()
    await testAxisAlignedRectangle()
    await testRotatedRectangle()
    await testRotatedRectangleGradientDescent()
    await testRotatedRectangleGaussNewton()
    await testRotatedRectangleLevenbergMarquardt()
    await testValidationRejectsDegenerateLine()
    await testValidationRejectsPointIdsWithoutRecords()
    await testValidationRejectsMissingConstraintReferences()
  }

  run().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
})
