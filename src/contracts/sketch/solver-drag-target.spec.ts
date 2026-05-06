import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import {
  solveSketchDefinitionWithDraggedPointTarget,
} from '@/contracts/sketch/solver-core'

test('src/contracts/sketch/solver-drag-target.spec.ts', () => {  function assertClosePoint(
    actual: readonly [number, number] | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    expectTrue(actual, `${message} Missing point.`)
    const distance = Math.hypot(actual[0] - expected[0], actual[1] - expected[1])
    expectTrue(distance < 1e-4, `${message} Expected ${expected.join(', ')}, received ${actual.join(', ')}.`)
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

  function createLogoLikeDragDefinition(): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: [
        'sketch_point_1_line-start',
        'sketch_point_1_line-end',
        'sketch_point_2_line-end',
        'sketch_point_3_line-end',
        'sketch_point_4_line-end',
        'sketch_point_5_line-end',
      ],
      points: [
        makePoint('sketch_point_1_line-start', 'Line 1 start', 3.7533016694624166e-7, 0),
        makePoint('sketch_point_1_line-end', 'Line 1 end', -2.5022011129749444e-7, 9.133302219150853),
        makePoint('sketch_point_2_line-end', 'Line 2 end', 8.729451147568751, 16.4148664011001),
        makePoint('sketch_point_3_line-end', 'Line 3 end', 20.868582202662076, 12.173020618432101),
        makePoint('sketch_point_4_line-end', 'Line 4 end', 20.86858224838759, -7.82697899411442),
        makePoint('sketch_point_5_line-end', 'Line 5 end', 10.227407084029718, -4.433639586425089),
      ],
      entityIds: [
        'sketch_entity_1_line',
        'sketch_entity_2_line',
        'sketch_entity_3_line',
        'sketch_entity_4_line',
        'sketch_entity_5_line',
      ],
      entities: [
        makeLine('sketch_entity_1_line', 'Line 1', 'sketch_point_1_line-start', 'sketch_point_1_line-end'),
        makeLine('sketch_entity_2_line', 'Line 2', 'sketch_point_1_line-end', 'sketch_point_2_line-end'),
        makeLine('sketch_entity_3_line', 'Line 3', 'sketch_point_2_line-end', 'sketch_point_3_line-end'),
        makeLine('sketch_entity_4_line', 'Line 4', 'sketch_point_3_line-end', 'sketch_point_4_line-end'),
        makeLine('sketch_entity_5_line', 'Line 5', 'sketch_point_4_line-end', 'sketch_point_5_line-end'),
      ],
      constraintIds: [
        'constraint_1_origin',
        'constraint_1_vertical',
        'constraint_4_vertical',
      ],
      constraints: [
        {
          constraintId: 'constraint_1_origin' as const,
          kind: 'coincidentProjectedPoint',
          label: 'Line 1 start at origin',
          point: {
            kind: 'localPoint',
            pointId: 'sketch_point_1_line-start' as const,
          },
          projectedPoint: {
            kind: 'sketchDatum',
            datum: 'origin',
          },
        },
        {
          constraintId: 'constraint_1_vertical' as const,
          kind: 'vertical',
          label: 'Line 1 vertical',
          entityId: 'sketch_entity_1_line' as const,
        },
        {
          constraintId: 'constraint_4_vertical' as const,
          kind: 'vertical',
          label: 'Line 4 vertical',
          entityId: 'sketch_entity_4_line' as const,
        },
      ],
      dimensionIds: ['dimension_4_length'],
      dimensions: [
        {
          dimensionId: 'dimension_4_length' as const,
          kind: 'lineLength',
          label: 'Line 4 length',
          entityId: 'sketch_entity_4_line' as const,
          value: 20,
        },
      ],
    }
  }

  function createAnchoredLogoFlipDefinition(): SketchDefinition {
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
        makePoint(anchor1, 'Anchor 1', -6.45492548301263e-11, -20.00000000144171),
        makePoint(anchor2, 'Anchor 2', 0, 0),
        makePoint(line6End, 'Line 6 end', 16.420739052696923, -15.60007626054567),
        makePoint(line8End, 'Line 8 end', 32.39551360005226, -21.414418708092832),
        makePoint(line12End, 'Line 12 end', 16.420739050742696, 4.399923751375514),
        makePoint(line13End, 'Line 13 end', 32.39551359627179, -1.4144187060831115),
        makePoint(line19End, 'Line 19 end', 32.395513600164705, -21.414418707726117),
        makePoint(line21End, 'Line 21 end', 15.974774547466922, -25.81434244596269),
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
        'constraint_27_coincident-projected-point',
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
        {
          constraintId: 'constraint_27_coincident-projected-point',
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

    expectTrue(result.kind === 'solved', 'Dragged-point solver should accept a free square translation.')
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

      expectTrue(result.kind === 'solved', `Dragged-point solver should translate rectangle when dragging ${point.pointId}.`)
      const points = new Map(result.solvedSnapshot.solvedPoints.map((entry) => [entry.pointId, entry.solvedPosition]))
      assertClosePoint(points.get('sketch_point_rect_bottom_left'), [2, 2], 'Rectangle translation should move bottom left.')
      assertClosePoint(points.get('sketch_point_rect_bottom_right'), [6, 2], 'Rectangle translation should move bottom right.')
      assertClosePoint(points.get('sketch_point_rect_top_right'), [6, 5], 'Rectangle translation should move top right.')
      assertClosePoint(points.get('sketch_point_rect_top_left'), [2, 5], 'Rectangle translation should move top left.')
    }
  }

  function testDraggedPointSolvesLogoLikeFreeEndpoint() {
    const requestedPosition = [10.386898346172789, -3.3335358542735576] as const
    const result = solveSketchDefinitionWithDraggedPointTarget({
      definition: createLogoLikeDragDefinition(),
      dragTarget: {
        kind: 'sketchPoint',
        pointId: 'sketch_point_5_line-end',
        position: requestedPosition,
      },
      tolerances,
      partialSolvePolicy: 'failOnConflict',
      targetTolerance: 1e-4,
    })

    expectTrue(result.kind === 'solved', 'Dragged-point solver should accept the logo-like free endpoint drag.')
    const points = new Map(result.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
    assertClosePoint(
      points.get('sketch_point_5_line-end'),
      requestedPosition,
      'Logo-like dragged endpoint should reach the requested position.',
    )
  }

  function testDraggedPointFlipsLogoLikeAnchoredComponent() {
    const cases = [
      {
        pointId: 'sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_1',
        cursor: [5, 25],
        expected: [0, 20],
      },
      {
        pointId: 'sketch_point_8_line-end',
        cursor: [-40, 25],
        expected: [-32.39551360005226, 21.414418708092832],
      },
      {
        pointId: 'sketch_point_21_line-end',
        cursor: [-22, 33],
        expected: [-15.974774547466922, 25.81434244596269],
      },
    ] as const

    for (const entry of cases) {
      const result = solveSketchDefinitionWithDraggedPointTarget({
        definition: createAnchoredLogoFlipDefinition(),
        dragTarget: {
          kind: 'sketchPoint',
          pointId: entry.pointId,
          position: entry.cursor,
        },
        tolerances,
        partialSolvePolicy: 'failOnConflict',
        targetTolerance: 1e-4,
      })

      expectTrue(result.kind === 'solved', `Dragged-point solver should accept a logo-like flip from ${entry.pointId}.`)
      const points = new Map(result.solvedSnapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]))
      assertClosePoint(
        points.get(entry.pointId),
        entry.expected,
        'Logo-like dragged point should move to the nearest valid flipped branch.',
      )
      assertClosePoint(
        points.get('sketch_point_sketch_operation_1_reference_image_sketch_operation_1_reference_image_anchor_2'),
        [0, 0],
        'Logo-like origin anchor should stay fixed during the flip.',
      )
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

    expectTrue(result.kind === 'blocked', 'Dragged-point solver should block an unsatisfied fixed-point drag.')
    expectTrue(
      result.diagnostics.some((diagnostic) => diagnostic.code === 'drag-target-unsatisfied'),
      'Blocked dragged-point solve should report a machine-readable diagnostic.',
    )
  }

  testDraggedPointSolvesFreeSquareTranslation()
  testDraggedPointSolvesRectangleToolTranslation()
  testDraggedPointSolvesLogoLikeFreeEndpoint()
  testDraggedPointFlipsLogoLikeAnchoredComponent()
  testDraggedPointBlocksFixedGeometry()
})
