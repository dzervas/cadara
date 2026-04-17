import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import {
  solveSketchDefinitionWithDraggedPointTarget,
} from '@/contracts/sketch/solver-core'

test('src/contracts/sketch/solver-drag-target.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function assertClosePoint(
    actual: readonly [number, number] | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    assert(actual, `${message} Missing point.`)
    const distance = Math.hypot(actual[0] - expected[0], actual[1] - expected[1])
    assert(distance < 1e-4, `${message} Expected ${expected.join(', ')}, received ${actual.join(', ')}.`)
  }

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

  function createSquareDefinition(withFixedOrigin: boolean): SketchDefinition {
    const constraints = [
      ...(withFixedOrigin
        ? [{
            constraintId: 'constraint_fix_a' as const,
            kind: 'fixPoint' as const,
            label: 'Fix A',
            pointId: 'sketch_point_a' as const,
            position: [0, 0] as const,
          }]
        : []),
      {
        constraintId: 'constraint_horizontal_ab' as const,
        kind: 'horizontal' as const,
        label: 'AB horizontal',
        entityId: 'sketch_entity_ab' as const,
      },
      {
        constraintId: 'constraint_horizontal_cd' as const,
        kind: 'horizontal' as const,
        label: 'CD horizontal',
        entityId: 'sketch_entity_cd' as const,
      },
      {
        constraintId: 'constraint_vertical_bc' as const,
        kind: 'vertical' as const,
        label: 'BC vertical',
        entityId: 'sketch_entity_bc' as const,
      },
      {
        constraintId: 'constraint_vertical_da' as const,
        kind: 'vertical' as const,
        label: 'DA vertical',
        entityId: 'sketch_entity_da' as const,
      },
    ]

    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 1, 0),
        makePoint('sketch_point_c', 'C', 1, 1),
        makePoint('sketch_point_d', 'D', 0, 1),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc', 'sketch_entity_cd', 'sketch_entity_da'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_da', 'DA', 'sketch_point_d', 'sketch_point_a'),
      ],
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: ['dimension_width', 'dimension_height'],
      dimensions: [
        {
          dimensionId: 'dimension_width',
          kind: 'horizontalDistance',
          label: 'Width',
          pointIds: ['sketch_point_a', 'sketch_point_b'],
          value: 1,
        },
        {
          dimensionId: 'dimension_height',
          kind: 'verticalDistance',
          label: 'Height',
          pointIds: ['sketch_point_a', 'sketch_point_d'],
          value: 1,
        },
      ],
    }
  }

  function createRectangleToolDefinition(): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_rect_bottom_left',
        'sketch_point_rect_bottom_right',
        'sketch_point_rect_top_right',
        'sketch_point_rect_top_left',
      ],
      points: [
        makePoint('sketch_point_rect_bottom_left', 'Bottom left', 0, 0),
        makePoint('sketch_point_rect_bottom_right', 'Bottom right', 4, 0),
        makePoint('sketch_point_rect_top_right', 'Top right', 4, 3),
        makePoint('sketch_point_rect_top_left', 'Top left', 0, 3),
      ],
      entityIds: [
        'sketch_entity_rect_bottom',
        'sketch_entity_rect_right',
        'sketch_entity_rect_top',
        'sketch_entity_rect_left',
      ],
      entities: [
        makeLine('sketch_entity_rect_bottom', 'Bottom', 'sketch_point_rect_bottom_left', 'sketch_point_rect_bottom_right'),
        makeLine('sketch_entity_rect_right', 'Right', 'sketch_point_rect_bottom_right', 'sketch_point_rect_top_right'),
        makeLine('sketch_entity_rect_top', 'Top', 'sketch_point_rect_top_right', 'sketch_point_rect_top_left'),
        makeLine('sketch_entity_rect_left', 'Left', 'sketch_point_rect_top_left', 'sketch_point_rect_bottom_left'),
      ],
      constraintIds: [
        'constraint_rect_bottom_horizontal',
        'constraint_rect_top_horizontal',
        'constraint_rect_right_vertical',
        'constraint_rect_left_vertical',
      ],
      constraints: [
        {
          constraintId: 'constraint_rect_bottom_horizontal' as const,
          kind: 'horizontal',
          label: 'Bottom horizontal',
          entityId: 'sketch_entity_rect_bottom' as const,
        },
        {
          constraintId: 'constraint_rect_top_horizontal' as const,
          kind: 'horizontal',
          label: 'Top horizontal',
          entityId: 'sketch_entity_rect_top' as const,
        },
        {
          constraintId: 'constraint_rect_right_vertical' as const,
          kind: 'vertical',
          label: 'Right vertical',
          entityId: 'sketch_entity_rect_right' as const,
        },
        {
          constraintId: 'constraint_rect_left_vertical' as const,
          kind: 'vertical',
          label: 'Left vertical',
          entityId: 'sketch_entity_rect_left' as const,
        },
      ],
      dimensionIds: ['dimension_rect_width', 'dimension_rect_height'],
      dimensions: [
        {
          dimensionId: 'dimension_rect_width' as const,
          kind: 'distance',
          label: 'Width',
          axis: 'horizontal',
          pointIds: ['sketch_point_rect_bottom_left', 'sketch_point_rect_bottom_right'],
          value: 4,
        },
        {
          dimensionId: 'dimension_rect_height' as const,
          kind: 'distance',
          label: 'Height',
          axis: 'vertical',
          pointIds: ['sketch_point_rect_bottom_left', 'sketch_point_rect_top_left'],
          value: 3,
        },
      ],
    }
  }

  const tolerances = {
    coincidence: 1e-6,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-6,
  } as const

  function testDraggedPointSolvesFreeSquareTranslation() {
    const result = solveSketchDefinitionWithDraggedPointTarget({
      definition: createSquareDefinition(false),
      dragTarget: {
        kind: 'sketchPoint',
        pointId: 'sketch_point_b',
        position: [4, 3],
      },
      tolerances,
      partialSolvePolicy: 'failOnConflict',
      targetTolerance: 1e-4,
    })

    assert(result.kind === 'solved', 'Dragged-point solver should accept a free square translation.')
    const points = new Map(result.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    assertClosePoint(points.get('sketch_point_a'), [3, 3], 'Dragged-point solve should translate A.')
    assertClosePoint(points.get('sketch_point_b'), [4, 3], 'Dragged-point solve should honor the target point.')
    assertClosePoint(points.get('sketch_point_c'), [4, 4], 'Dragged-point solve should translate C.')
    assertClosePoint(points.get('sketch_point_d'), [3, 4], 'Dragged-point solve should translate D.')
  }

  function testDraggedPointSolvesRectangleToolTranslation() {
    const definition = createRectangleToolDefinition()
    const delta = [2, 2] as const

    for (const point of definition.points) {
      const result = solveSketchDefinitionWithDraggedPointTarget({
        definition,
        dragTarget: {
          kind: 'sketchPoint',
          pointId: point.pointId,
          position: [point.position[0] + delta[0], point.position[1] + delta[1]],
        },
        tolerances,
        partialSolvePolicy: 'failOnConflict',
        targetTolerance: 1e-4,
      })

      assert(result.kind === 'solved', `Dragged-point solver should translate rectangle when dragging ${point.pointId}.`)
      const points = new Map(result.solvedSnapshot.solvedPoints.map((entry) => [entry.pointId, entry.solvedPosition]))
      assertClosePoint(points.get('sketch_point_rect_bottom_left'), [2, 2], 'Rectangle translation should move bottom left.')
      assertClosePoint(points.get('sketch_point_rect_bottom_right'), [6, 2], 'Rectangle translation should move bottom right.')
      assertClosePoint(points.get('sketch_point_rect_top_right'), [6, 5], 'Rectangle translation should move top right.')
      assertClosePoint(points.get('sketch_point_rect_top_left'), [2, 5], 'Rectangle translation should move top left.')
    }
  }

  function testDraggedPointBlocksFixedGeometry() {
    const result = solveSketchDefinitionWithDraggedPointTarget({
      definition: createSquareDefinition(true),
      dragTarget: {
        kind: 'sketchPoint',
        pointId: 'sketch_point_a',
        position: [2, 2],
      },
      tolerances,
      partialSolvePolicy: 'failOnConflict',
      targetTolerance: 1e-4,
    })

    assert(result.kind === 'blocked', 'Dragged-point solver should block an unsatisfied fixed-point drag.')
    assert(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'drag-target-unsatisfied'),
      'Blocked dragged-point solve should report a machine-readable diagnostic.',
    )
  }

  testDraggedPointSolvesFreeSquareTranslation()
  testDraggedPointSolvesRectangleToolTranslation()
  testDraggedPointBlocksFixedGeometry()
})
