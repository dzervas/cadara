import { test } from 'bun:test'

import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  finishSketchGeometryDrag,
  getSketchSessionDisplayRenderables,
  patchSketchStyleValue,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
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

  function assertIncludesPoint(
    points: readonly { position: readonly [number, number] }[],
    expected: readonly [number, number],
    message: string,
  ) {
    assert(
      points.some((point) => Math.hypot(point.position[0] - expected[0], point.position[1] - expected[1]) < 1e-4),
      `${message} Missing ${expected.join(', ')}.`,
    )
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

  function makeArc(
    entityId: string,
    label: string,
    centerPointId: string,
    startPointId: string,
    endPointId: string,
    sweepDirection: 'clockwise' | 'counterClockwise' = 'counterClockwise',
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
      sweepDirection,
    }
  }

  function makeSpline(entityId: string, label: string, fitPointIds: readonly string[]) {
    return {
      kind: 'spline' as const,
      entityId: entityId as `sketch_entity_${string}`,
      label,
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: entityId as `sketch_entity_${string}` } as const,
      isConstruction: false,
      fitPointIds: fitPointIds.map((pointId) => pointId as `sketch_point_${string}`),
      degree: 2 as const,
    }
  }

  function makeDefinition(input: {
    pointIds: readonly string[]
    points: SketchDefinition['points']
    entityIds: readonly string[]
    entities: SketchDefinition['entities']
  }): SketchDefinition {
    return {
      schemaVersion: 'sketch-definition/v1alpha1',
      referenceIds: [],
      references: [],
      pointIds: input.pointIds as `sketch_point_${string}`[],
      points: input.points,
      entityIds: input.entityIds as `sketch_entity_${string}`[],
      entities: input.entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
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

  function testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [3, 0])

    const entityTarget = session.definition.entities[0]?.target
    assert(entityTarget, 'Style patch fixture should create a local sketch entity target.')
    const before = session.commitRequest?.definition.entities[0]

    session = patchSketchStyleValue(
      session,
      [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_a' }],
      { intent: 'patchSketchStyle', field: 'fillColor', value: '#00ffff' },
    )

    assert(
      session.commitRequest?.definition.entities[0] === before,
      'Style patch should ignore non-local targets such as external model geometry refs.',
    )

    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'strokeWidth', value: 2.5 },
    )
    assert(
      getSketchSessionDisplayRenderables(session).find((entry) =>
        entry.target?.kind === 'sketchEntity' && entry.target.entityId === entityTarget.entityId,
      )?.strokeStyle === undefined,
      'Stroke fields should not render until stroke styling is explicitly enabled.',
    )
    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'strokeEnabled', value: true },
    )
    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'fillMode', value: 'gradient' },
    )
    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'gradientStartColor', value: '#00ffff' },
    )
    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'strokeMiterLimit', value: 7 },
    )
    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'strokeDashSize', value: 0.6 },
    )
    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'strokeGapSize', value: 0.25 },
    )

    assert(
      session.definition.entities[0]?.style?.strokeWidth === 2.5,
      'Local style patch should update the selected sketch entity style in session definition.',
    )
    assert(
      getSketchSessionDisplayRenderables(session).find((entry) =>
        entry.target?.kind === 'sketchEntity' && entry.target.entityId === entityTarget.entityId,
      )?.strokeStyle?.width === 2.5,
      'Explicitly enabled local stroke fields should render through sketch display metadata.',
    )
    assert(
      session.definition.entities[0]?.style?.fillMode === 'gradient',
      'Local style patch should update fill mode in session definition.',
    )
    assert(
      session.definition.entities[0]?.style?.strokeMiterLimit === 7,
      'Local style patch should update miter limit in session definition.',
    )
    assert(
      session.definition.entities[0]?.style?.strokeDashSize === 0.6 &&
        session.definition.entities[0]?.style?.strokeGapSize === 0.25,
      'Local style patch should update dash fields in session definition.',
    )
    assert(
      session.commitRequest?.definition.entities[0]?.style?.strokeWidth === 2.5 &&
        session.commitRequest.definition.entities[0]?.style?.strokeEnabled === true &&
        session.commitRequest.definition.entities[0]?.style?.strokeDashSize === 0.6,
      'Local style patch should rebuild commit request using the updated sketch definition.',
    )
  }

  function testTrimSplitsLineAtClearIntersections() {
    const definition = makeDefinition({
      pointIds: [
        'sketch_point_a',
        'sketch_point_b',
        'sketch_point_c',
        'sketch_point_d',
        'sketch_point_e',
        'sketch_point_f',
      ],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 4, 0),
        makePoint('sketch_point_c', 'C', 1, -1),
        makePoint('sketch_point_d', 'D', 1, 1),
        makePoint('sketch_point_e', 'E', 3, -1),
        makePoint('sketch_point_f', 'F', 3, 1),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_cd', 'sketch_entity_ef'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_ef', 'EF', 'sketch_point_e', 'sketch_point_f'),
      ],
    })
    let session = beginSketchTool(createSessionFromDefinition(definition), 'trim')
    session = selectSketchEditToolTarget(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_ab',
    })

    assert(session.validationMessage === null, 'Accepted trim should not leave validation feedback.')
    assert(session.definition.entityIds.includes('sketch_entity_ab'), 'Trim should preserve the selected line entity id.')
    assert(session.definition.entityIds.length === 4, 'Trim should add one split segment for the remaining geometry.')
    assert(session.commitRequest?.definition.entityIds.length === 4, 'Trim should rebuild the sketch commit request.')
  }

  function testTrimHandlesCircleArcAndSplineTargets() {
    const circleDefinition = makeDefinition({
      pointIds: ['sketch_point_center', 'sketch_point_l0', 'sketch_point_l1', 'sketch_point_r0', 'sketch_point_r1'],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
        makePoint('sketch_point_l0', 'L0', -1, -3),
        makePoint('sketch_point_l1', 'L1', -1, 3),
        makePoint('sketch_point_r0', 'R0', 1, -3),
        makePoint('sketch_point_r1', 'R1', 1, 3),
      ],
      entityIds: ['sketch_entity_circle', 'sketch_entity_left', 'sketch_entity_right'],
      entities: [
        makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 2),
        makeLine('sketch_entity_left', 'Left cutter', 'sketch_point_l0', 'sketch_point_l1'),
        makeLine('sketch_entity_right', 'Right cutter', 'sketch_point_r0', 'sketch_point_r1'),
      ],
    })
    let circleSession = beginSketchTool(createSessionFromDefinition(circleDefinition), 'trim')
    circleSession = selectSketchEditToolTarget(circleSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_circle',
    })

    const trimmedCircle = circleSession.definition.entities.find((entity) => entity.entityId === 'sketch_entity_circle')
    assert(trimmedCircle?.kind === 'arc', 'Trimming a circle should preserve the selected id as an authored arc.')
    assert(circleSession.validationMessage === null, 'Circle trim should not leave validation feedback.')

    const arcDefinition = makeDefinition({
      pointIds: [
        'sketch_point_center',
        'sketch_point_start',
        'sketch_point_end',
        'sketch_point_l0',
        'sketch_point_l1',
        'sketch_point_r0',
        'sketch_point_r1',
      ],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
        makePoint('sketch_point_start', 'Start', 2, 0),
        makePoint('sketch_point_end', 'End', -2, 0),
        makePoint('sketch_point_l0', 'L0', -1, 0),
        makePoint('sketch_point_l1', 'L1', -1, 3),
        makePoint('sketch_point_r0', 'R0', 1, 0),
        makePoint('sketch_point_r1', 'R1', 3, 3),
      ],
      entityIds: ['sketch_entity_arc', 'sketch_entity_left', 'sketch_entity_right'],
      entities: [
        makeArc('sketch_entity_arc', 'Arc', 'sketch_point_center', 'sketch_point_start', 'sketch_point_end'),
        makeLine('sketch_entity_left', 'Left cutter', 'sketch_point_l0', 'sketch_point_l1'),
        makeLine('sketch_entity_right', 'Right cutter', 'sketch_point_r0', 'sketch_point_r1'),
      ],
    })
    let arcSession = beginSketchTool(createSessionFromDefinition(arcDefinition), 'trim')
    arcSession = selectSketchEditToolTarget(arcSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_arc',
    })

    assert(arcSession.validationMessage === null, 'Arc trim should not leave validation feedback.')
    assert(
      arcSession.definition.entities.filter((entity) => entity.kind === 'arc').length === 2,
      'Trimming an arc should split the remaining geometry into two arcs.',
    )

    const splineDefinition = makeDefinition({
      pointIds: ['sketch_point_s0', 'sketch_point_s1', 'sketch_point_s2', 'sketch_point_l0', 'sketch_point_l1', 'sketch_point_r0', 'sketch_point_r1'],
      points: [
        makePoint('sketch_point_s0', 'S0', 0, 0),
        makePoint('sketch_point_s1', 'S1', 2, 3),
        makePoint('sketch_point_s2', 'S2', 4, 0),
        makePoint('sketch_point_l0', 'L0', 1, -1),
        makePoint('sketch_point_l1', 'L1', 1, 3),
        makePoint('sketch_point_r0', 'R0', 3, -1),
        makePoint('sketch_point_r1', 'R1', 3, 3),
      ],
      entityIds: ['sketch_entity_spline', 'sketch_entity_left', 'sketch_entity_right'],
      entities: [
        makeSpline('sketch_entity_spline', 'Spline', ['sketch_point_s0', 'sketch_point_s1', 'sketch_point_s2']),
        makeLine('sketch_entity_left', 'Left cutter', 'sketch_point_l0', 'sketch_point_l1'),
        makeLine('sketch_entity_right', 'Right cutter', 'sketch_point_r0', 'sketch_point_r1'),
      ],
    })
    let splineSession = beginSketchTool(createSessionFromDefinition(splineDefinition), 'trim')
    splineSession = selectSketchEditToolTarget(splineSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_spline',
    })

    assert(splineSession.validationMessage === null, 'Spline trim should not leave validation feedback.')
    assert(
      splineSession.definition.entities.filter((entity) => entity.kind === 'spline').length === 2,
      'Trimming a spline should split the remaining geometry into two spline entities.',
    )
  }

  function testOffsetAddsLineCopyAndRejectsInvalidDistance() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [2, 0])
    const lineTarget = session.definition.entities[0]?.target
    assert(lineTarget, 'Offset fixture should create a line target.')

    session = beginSketchTool(session, 'offset')
    session = selectSketchEditToolTarget(session, lineTarget)
    assert(session.entities.some((entity) => entity.status === 'preview'), 'Offset selection should stage preview geometry.')

    session = patchSketchEditToolValue(session, { value: 0 })
    const beforeInvalidCommit = session.definition.entityIds.length
    session = patchSketchEditToolValue(session, { intent: 'commitOffset' })

    assert(session.definition.entityIds.length === beforeInvalidCommit, 'Invalid offset should not mutate the sketch draft.')
    assert(session.validationMessage === 'Offset distance must be greater than zero.', 'Invalid offset should report validation feedback.')

    session = patchSketchEditToolValue(session, { value: 1 })
    session = patchSketchEditToolValue(session, { intent: 'commitOffset' })

    assert(session.definition.entityIds.length === 2, 'Valid offset should add one offset line.')
    assert(session.commitRequest?.definition.entityIds.length === 2, 'Valid offset should rebuild the sketch commit request.')
  }

  function testOffsetCreatesContinuousOuterAndInnerSquares() {
    const definition = createSquareDefinition(false)
    let outerSession = beginSketchTool(createSessionFromDefinition(definition), 'offset')

    for (const entity of definition.entities) {
      outerSession = selectSketchEditToolTarget(outerSession, entity.target)
    }

    assert(outerSession.activeEditTool?.selectedTargets.length === 4, 'Offset should collect multiple selected square edges.')
    assert(
      outerSession.entities.filter((entity) => entity.status === 'preview' && entity.kind === 'line').length === 4,
      'Continuous square offset should preview one joined line per selected edge.',
    )

    outerSession = patchSketchEditToolValue(outerSession, { value: 1 })
    outerSession = patchSketchEditToolValue(outerSession, { intent: 'commitOffset' })

    const outerLines = outerSession.definition.entities.filter((entity) =>
      entity.kind === 'lineSegment' && !definition.entityIds.includes(entity.entityId),
    )
    const outerPoints = outerSession.definition.points.filter((point) => !definition.pointIds.includes(point.pointId))

    assert(outerLines.length === 4, 'Outer square offset should create four joined line entities.')
    assert(outerPoints.length === 4, 'Outer square offset should create four joined corner points.')
    assertIncludesPoint(outerPoints, [-1, -1], 'Outer square offset should extend the bottom-left corner.')
    assertIncludesPoint(outerPoints, [2, -1], 'Outer square offset should extend the bottom-right corner.')
    assertIncludesPoint(outerPoints, [2, 2], 'Outer square offset should extend the top-right corner.')
    assertIncludesPoint(outerPoints, [-1, 2], 'Outer square offset should extend the top-left corner.')

    let innerSession = beginSketchTool(createSessionFromDefinition(definition), 'offset')
    for (const entity of definition.entities) {
      innerSession = selectSketchEditToolTarget(innerSession, entity.target)
    }

    innerSession = patchSketchEditToolValue(innerSession, { intent: 'setOffsetSide', value: 'right' })
    innerSession = patchSketchEditToolValue(innerSession, { value: 0.25 })
    innerSession = patchSketchEditToolValue(innerSession, { intent: 'commitOffset' })

    const innerPoints = innerSession.definition.points.filter((point) => !definition.pointIds.includes(point.pointId))
    assertIncludesPoint(innerPoints, [0.25, 0.25], 'Inner square offset should miter the bottom-left corner inward.')
    assertIncludesPoint(innerPoints, [0.75, 0.25], 'Inner square offset should miter the bottom-right corner inward.')
    assertIncludesPoint(innerPoints, [0.75, 0.75], 'Inner square offset should miter the top-right corner inward.')
    assertIncludesPoint(innerPoints, [0.25, 0.75], 'Inner square offset should miter the top-left corner inward.')
  }

  function testOffsetCreatesContinuousOpenAngle() {
    const definition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 2, 0),
        makePoint('sketch_point_c', 'C', 2, 2),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
      ],
    })
    let session = beginSketchTool(createSessionFromDefinition(definition), 'offset')
    for (const entity of definition.entities) {
      session = selectSketchEditToolTarget(session, entity.target)
    }

    session = patchSketchEditToolValue(session, { value: 1 })
    session = patchSketchEditToolValue(session, { intent: 'commitOffset' })

    const offsetLines = session.definition.entities.filter((entity) =>
      entity.kind === 'lineSegment' && !definition.entityIds.includes(entity.entityId),
    )
    const offsetPoints = session.definition.points.filter((point) => !definition.pointIds.includes(point.pointId))

    assert(offsetLines.length === 2, 'Open angle offset should create one joined line per selected edge.')
    assert(offsetPoints.length === 3, 'Open angle offset should share the mitered corner point.')
    assertIncludesPoint(offsetPoints, [0, 1], 'Open angle offset should keep the first open endpoint offset.')
    assertIncludesPoint(offsetPoints, [1, 1], 'Open angle offset should intersect adjacent offset lines at the corner.')
    assertIncludesPoint(offsetPoints, [1, 2], 'Open angle offset should keep the last open endpoint offset.')
  }

  function testOffsetAddsCircleArcAndSplineCopies() {
    const definition = makeDefinition({
      pointIds: [
        'sketch_point_center',
        'sketch_point_arc_start',
        'sketch_point_arc_end',
        'sketch_point_s0',
        'sketch_point_s1',
        'sketch_point_s2',
      ],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
        makePoint('sketch_point_arc_start', 'Arc start', 2, 0),
        makePoint('sketch_point_arc_end', 'Arc end', 0, 2),
        makePoint('sketch_point_s0', 'S0', 0, 0),
        makePoint('sketch_point_s1', 'S1', 1, 2),
        makePoint('sketch_point_s2', 'S2', 2, 0),
      ],
      entityIds: ['sketch_entity_circle', 'sketch_entity_arc', 'sketch_entity_spline'],
      entities: [
        makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 2),
        makeArc('sketch_entity_arc', 'Arc', 'sketch_point_center', 'sketch_point_arc_start', 'sketch_point_arc_end'),
        makeSpline('sketch_entity_spline', 'Spline', ['sketch_point_s0', 'sketch_point_s1', 'sketch_point_s2']),
      ],
    })

    let circleSession = beginSketchTool(createSessionFromDefinition(definition), 'offset')
    circleSession = selectSketchEditToolTarget(circleSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_circle',
    })
    circleSession = patchSketchEditToolValue(circleSession, { value: 1 })
    circleSession = patchSketchEditToolValue(circleSession, { intent: 'commitOffset' })
    const offsetCircle = circleSession.definition.entities.find((entity) =>
      entity.entityId !== 'sketch_entity_circle' && entity.kind === 'circle',
    )
    assert(offsetCircle?.kind === 'circle' && offsetCircle.radius === 3, 'Circle offset should add a copied circle at the requested radius.')

    let arcSession = beginSketchTool(createSessionFromDefinition(definition), 'offset')
    arcSession = selectSketchEditToolTarget(arcSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_arc',
    })
    arcSession = patchSketchEditToolValue(arcSession, { value: 1 })
    arcSession = patchSketchEditToolValue(arcSession, { intent: 'commitOffset' })
    assert(
      arcSession.definition.entities.some((entity) => entity.entityId !== 'sketch_entity_arc' && entity.kind === 'arc'),
      'Arc offset should add a copied arc entity.',
    )

    let splineSession = beginSketchTool(createSessionFromDefinition(definition), 'offset')
    splineSession = selectSketchEditToolTarget(splineSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_spline',
    })
    splineSession = patchSketchEditToolValue(splineSession, { value: 1 })
    splineSession = patchSketchEditToolValue(splineSession, { intent: 'commitOffset' })
    assert(
      splineSession.definition.entities.some((entity) => entity.entityId !== 'sketch_entity_spline' && entity.kind === 'spline'),
      'Spline offset should add a copied spline entity.',
    )
  }

  function testOffsetAddsProjectedCircleAndSplineCopies() {
    const projectedReferences: ProjectedSketchReferenceRecord[] = [{
      referenceId: 'ref_projected_curves',
      status: 'projected',
      geometry: [
        {
          geometryId: 'projected_geometry_circle',
          kind: 'circle',
          centerPosition: [0, 0],
          radius: 2,
        },
        {
          geometryId: 'projected_geometry_spline',
          kind: 'spline',
          fitPoints: [[0, 0], [1, 2], [2, 0]],
          degree: 2,
          isClosed: false,
        },
      ],
      diagnostics: [],
    }]

    let circleSession = beginSketchTool({
      ...createSessionFromDefinition(makeDefinition({ pointIds: [], points: [], entityIds: [], entities: [] })),
      projectedReferences,
    }, 'offset')
    circleSession = selectSketchEditToolTarget(circleSession, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_projected_curves',
      geometryId: 'projected_geometry_circle',
      geometryKind: 'circle',
    })
    assert(circleSession.entities.some((entity) => entity.status === 'preview' && entity.kind === 'circle'), 'Projected circle offset should preview a circle.')
    circleSession = patchSketchEditToolValue(circleSession, { value: 1 })
    circleSession = patchSketchEditToolValue(circleSession, { intent: 'commitOffset' })
    const offsetCircle = circleSession.definition.entities.find((entity) => entity.kind === 'circle')
    assert(offsetCircle?.kind === 'circle' && offsetCircle.radius === 3, 'Projected circle offset should create a sketch-owned circle.')

    let splineSession = beginSketchTool({
      ...createSessionFromDefinition(makeDefinition({ pointIds: [], points: [], entityIds: [], entities: [] })),
      projectedReferences,
    }, 'offset')
    splineSession = selectSketchEditToolTarget(splineSession, {
      kind: 'projectedReferenceGeometry',
      referenceId: 'ref_projected_curves',
      geometryId: 'projected_geometry_spline',
      geometryKind: 'spline',
    })
    assert(splineSession.entities.some((entity) => entity.status === 'preview' && entity.kind === 'spline'), 'Projected spline offset should preview a spline.')
    splineSession = patchSketchEditToolValue(splineSession, { value: 1 })
    splineSession = patchSketchEditToolValue(splineSession, { intent: 'commitOffset' })
    assert(
      splineSession.definition.entities.some((entity) => entity.kind === 'spline'),
      'Projected spline offset should create a sketch-owned spline.',
    )
  }

  testUnconstrainedPointDragUpdatesAuthoredDefinition()
  testConstrainedSquareDragTranslatesSolvedShape()
  testRectangleToolDragTranslatesWholeRectangle()
  testImmovableConstrainedDragBlocksWithoutChangingDraft()
  testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets()
  testTrimSplitsLineAtClearIntersections()
  testTrimHandlesCircleArcAndSplineTargets()
  testOffsetAddsLineCopyAndRejectsInvalidDistance()
  testOffsetCreatesContinuousOuterAndInnerSquares()
  testOffsetCreatesContinuousOpenAngle()
  testOffsetAddsCircleArcAndSplineCopies()
  testOffsetAddsProjectedCircleAndSplineCopies()
})
