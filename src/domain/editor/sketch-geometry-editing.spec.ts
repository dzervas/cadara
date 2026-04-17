import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  finishSketchGeometryDrag,
  startSketchDraw,
  acceptSketchDraw,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'

test('src/domain/editor/sketch-geometry-editing.spec.ts', () => {
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

  function createSessionFromDefinition(definition: SketchDefinition) {
    const plane = createStandardPlaneDefinition('xy')
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })

    return createSketchSessionFromSnapshot({
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
  }

  function testUnconstrainedPointDragUpdatesAuthoredDefinition() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [1, 0])

    const point = session.definition.points[0]
    assert(point, 'Expected authored point from line creation.')
    session = beginSketchGeometryDrag(session, point.target, point.position)
    assert(session.activeTool === null, 'Dragging an existing point should clear an idle drawing tool.')
    session = finishSketchGeometryDrag(session, [2, 3])

    const movedPoint = session.definition.points.find((entry) => entry.pointId === point.pointId)
    assertClosePoint(movedPoint?.position, [2, 3], 'Unconstrained drag should update the authored point.')
    assertClosePoint(
      session.commitRequest?.definition.points.find((entry) => entry.pointId === point.pointId)?.position,
      [2, 3],
      'Unconstrained drag should prepare the authored commit mutation.',
    )
  }

  function testConstrainedSquareDragTranslatesSolvedShape() {
    let session = createSessionFromDefinition(createSquareDefinition(false))
    const target = session.definition.points.find((point) => point.pointId === 'sketch_point_b')?.target
    assert(target, 'Expected square vertex B.')

    session = beginSketchGeometryDrag(session, target, [1, 0])
    session = finishSketchGeometryDrag(session, [4, 3])

    const points = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    assertClosePoint(points.get('sketch_point_a'), [3, 3], 'Dragging free square vertex should translate A.')
    assertClosePoint(points.get('sketch_point_b'), [4, 3], 'Dragging free square vertex should honor B target.')
    assertClosePoint(points.get('sketch_point_c'), [4, 4], 'Dragging free square vertex should translate C.')
    assertClosePoint(points.get('sketch_point_d'), [3, 4], 'Dragging free square vertex should translate D.')
    assert(session.validationMessage === null, 'Valid constrained drag should not leave blocked feedback.')
  }

  function testRectangleToolDragTranslatesWholeRectangle() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'rectangle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 3])

    const target = session.definition.points.find((point) =>
      point.pointId === 'sketch_point_1_rect-bottom-left',
    )?.target
    assert(target, 'Expected rectangle bottom-left vertex.')

    session = beginSketchGeometryDrag(session, target, [0, 0])
    session = finishSketchGeometryDrag(session, [2, 2])

    const points = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    assertClosePoint(points.get('sketch_point_1_rect-bottom-left'), [2, 2], 'Dragging rectangle corner should translate bottom left.')
    assertClosePoint(points.get('sketch_point_1_rect-bottom-right'), [6, 2], 'Dragging rectangle corner should translate bottom right.')
    assertClosePoint(points.get('sketch_point_1_rect-top-right'), [6, 5], 'Dragging rectangle corner should translate top right.')
    assertClosePoint(points.get('sketch_point_1_rect-top-left'), [2, 5], 'Dragging rectangle corner should translate top left.')
    assert(session.validationMessage === null, 'Translatable rectangle drag should not leave blocked feedback.')
  }

  function testImmovableConstrainedDragBlocksWithoutChangingDraft() {
    let session = createSessionFromDefinition(createSquareDefinition(true))
    const before = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    const target = session.definition.points.find((point) => point.pointId === 'sketch_point_a')?.target
    assert(target, 'Expected fixed square vertex A.')

    session = beginSketchGeometryDrag(session, target, [0, 0])
    session = finishSketchGeometryDrag(session, [2, 2])

    const after = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    assertClosePoint(after.get('sketch_point_a'), before.get('sketch_point_a')!, 'Blocked drag should leave A unchanged.')
    assertClosePoint(after.get('sketch_point_b'), before.get('sketch_point_b')!, 'Blocked drag should leave B unchanged.')
    assert(
      session.validationMessage === 'Geometry is constrained and cannot move to that position.',
      'Blocked drag should leave visible constrained-movement feedback.',
    )
  }

  testUnconstrainedPointDragUpdatesAuthoredDefinition()
  testConstrainedSquareDragTranslatesSolvedShape()
  testRectangleToolDragTranslatesWholeRectangle()
  testImmovableConstrainedDragBlocksWithoutChangingDraft()
})
