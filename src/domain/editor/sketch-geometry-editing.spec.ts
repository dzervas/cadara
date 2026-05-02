import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { SketchDefinition } from '@/contracts/sketch/schema'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type { SketchSnapshotRecord } from '@/contracts/modeling/schema'
import {
  beginSketchGeometryDrag,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  createSketchSessionFromSnapshot,
  deleteSelectedSketchGeometry,
  deriveSketchDisplayEntities,
  finishSketchGeometryDrag,
  getConnectedSketchEntitySelectionTargets,
  getSketchSessionRegionDiagnostics,
  getSketchSessionDisplayRenderables,
  isSketchSvgRenderingEnabled,
  patchSketchStyleValue,
  patchSketchEditToolValue,
  selectSketchEditToolTarget,
  startSketchDraw,
  toggleSketchSvgRendering,
  updateSketchGeometryDrag,
  acceptSketchDraw,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { solveSketchDefinitionCore } from '@/contracts/sketch/solver-core'
import { deriveSketchRegionsCore } from '@/contracts/sketch/region-extraction'
import { toolDefinitions } from '@/core/tools/tool-registry'

test('src/domain/editor/sketch-geometry-editing.spec.ts', () => {  function assertClosePoint(
    actual: readonly [number, number] | undefined,
    expected: readonly [number, number],
    message: string,
  ) {
    expectTrue(actual, `${message} Missing point.`)
    const distance = Math.hypot(actual[0] - expected[0], actual[1] - expected[1])
    expectTrue(distance < 1e-4, `${message} Expected ${expected.join(', ')}, received ${actual.join(', ')}.`)
  }

  function assertIncludesPoint(
    points: readonly { position: readonly [number, number] }[],
    expected: readonly [number, number],
    message: string,
  ) {
    expectTrue(
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

  function deriveRegionsForDefinition(definition: SketchDefinition) {
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })

    return deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition,
      solvedSnapshot: solved.solvedSnapshot,
    }).regions
  }

  function getRegionRenderableBounds(session: ReturnType<typeof createSessionFromDefinition>) {
    const regionRenderable = getSketchSessionDisplayRenderables(session).find((renderable) =>
      renderable.target?.kind === 'region',
    )
    expectTrue(regionRenderable, 'Expected live region renderable.')
    expectTrue(regionRenderable.geometry.kind === 'mesh', 'Live region renderable should use mesh geometry.')

    const xs = regionRenderable.geometry.vertexPositions.map((point) => point[0])
    const ys = regionRenderable.geometry.vertexPositions.map((point) => point[1])
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    }
  }

  function getLiveRegionMesh(session: ReturnType<typeof createSessionFromDefinition>) {
    const regionRenderable = getSketchSessionDisplayRenderables(session).find((renderable) =>
      renderable.target?.kind === 'region',
    )
    expectTrue(regionRenderable, 'Expected live region renderable.')
    expectTrue(regionRenderable.geometry.kind === 'mesh', 'Live region renderable should use mesh geometry.')
    return regionRenderable.geometry
  }

  function getTriangleArea(points: readonly [number, number, number][], triangle: readonly [number, number, number]) {
    const a = points[triangle[0]]!
    const b = points[triangle[1]]!
    const c = points[triangle[2]]!
    return Math.abs(((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2)
  }

  function getMeshArea(geometry: ReturnType<typeof getLiveRegionMesh>) {
    return geometry.triangleIndices.reduce((area, triangle) => area + getTriangleArea(geometry.vertexPositions, triangle), 0)
  }

  function getConnectedEntityIds(session: ReturnType<typeof createSessionFromDefinition>, entityId: string) {
    return getConnectedSketchEntitySelectionTargets(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: entityId as `sketch_entity_${string}`,
    }).map((target) => target.entityId)
  }

  function testConnectedSketchSelectionSelectsTwoConnectedLines() {
    const definition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d', 'sketch_point_e'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 1, 0),
        makePoint('sketch_point_c', 'C', 2, 0),
        makePoint('sketch_point_d', 'D', 10, 0),
        makePoint('sketch_point_e', 'E', 11, 0),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_bc', 'sketch_entity_de'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_de', 'DE', 'sketch_point_d', 'sketch_point_e'),
      ],
    })
    const selectedEntityIds = getConnectedEntityIds(createSessionFromDefinition(definition), 'sketch_entity_ab')

    expectTrue(
      selectedEntityIds.join(',') === 'sketch_entity_ab,sketch_entity_bc',
      'Connected selection should select the two local entities joined by a shared endpoint.',
    )
  }

  function testConnectedSketchSelectionSelectsRectangleFromAnyEdge() {
    const session = createSessionFromDefinition(createSquareDefinition(false))
    const expected = 'sketch_entity_ab,sketch_entity_bc,sketch_entity_cd,sketch_entity_da'

    for (const entityId of session.definition.entityIds) {
      expectTrue(
        getConnectedEntityIds(session, entityId).join(',') === expected,
        `Connected rectangle selection from ${entityId} should select all four edges.`,
      )
    }
  }

  function testConnectedSketchSelectionUsesLocalEntityTargetNamespace() {
    const session = {
      ...createSessionFromDefinition(createSquareDefinition(false)),
      sketchId: 'sketch_draft' as const,
    }

    const selectedEntityIds = getConnectedSketchEntitySelectionTargets(session, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_ab',
    }).map((selectedTarget) => selectedTarget.entityId)

    expectTrue(
      selectedEntityIds.join(',') === 'sketch_entity_ab,sketch_entity_bc,sketch_entity_cd,sketch_entity_da',
      'Connected selection should follow the local entity target sketch id even when the session sketch id differs.',
    )
    expectTrue(
      getConnectedSketchEntitySelectionTargets(session, {
        kind: 'sketchEntity',
        sketchId: 'sketch_other' as const,
        entityId: 'sketch_entity_ab',
      }).length === 0,
      'Connected selection should still reject sketch entities from a different target namespace.',
    )
  }

  function testConnectedSketchSelectionSelectsBranchingComponentAndRejectsUnsupportedTargets() {
    const definition = makeDefinition({
      pointIds: ['sketch_point_center', 'sketch_point_left', 'sketch_point_right', 'sketch_point_top', 'sketch_point_far'],
      points: [
        makePoint('sketch_point_center', 'Center', 0, 0),
        makePoint('sketch_point_left', 'Left', -1, 0),
        makePoint('sketch_point_right', 'Right', 1, 0),
        makePoint('sketch_point_top', 'Top', 0, 1),
        makePoint('sketch_point_far', 'Far', 5, 5),
      ],
      entityIds: ['sketch_entity_left', 'sketch_entity_right', 'sketch_entity_top', 'sketch_entity_point'],
      entities: [
        makeLine('sketch_entity_left', 'Left', 'sketch_point_left', 'sketch_point_center'),
        makeLine('sketch_entity_right', 'Right', 'sketch_point_center', 'sketch_point_right'),
        makeLine('sketch_entity_top', 'Top', 'sketch_point_center', 'sketch_point_top'),
        {
          kind: 'point',
          entityId: 'sketch_entity_point',
          label: 'Point entity',
          target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_point' },
          isConstruction: false,
          pointId: 'sketch_point_far',
        },
      ],
    })
    const session = createSessionFromDefinition(definition)

    expectTrue(
      getConnectedEntityIds(session, 'sketch_entity_right').join(',') ===
        'sketch_entity_left,sketch_entity_right,sketch_entity_top',
      'Connected selection should select every entity in a branching component.',
    )
    expectTrue(
      getConnectedSketchEntitySelectionTargets(session, {
        kind: 'projectedReferenceGeometry',
        referenceId: 'ref_projected' as const,
        geometryId: 'projected_geometry_line' as const,
        geometryKind: 'lineSegment',
      }).length === 0,
      'Projected reference geometry should not expand through connected local geometry selection.',
    )
    expectTrue(
      getConnectedSketchEntitySelectionTargets(session, {
        kind: 'sketchPoint',
        sketchId: 'sketch_primary',
        pointId: 'sketch_point_center',
      }).length === 0,
      'Sketch points should not expand through connected local geometry selection.',
    )
    expectTrue(
      getConnectedEntityIds(session, 'sketch_entity_point').length === 0,
      'Point entities should not expand through connected local geometry selection.',
    )
  }

  function testUnconstrainedPointDragUpdatesAuthoredDefinition() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'line')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [1, 0])

    const point = session.definition.points[0]
    expectTrue(point, 'Expected authored point from line creation.')
    session = beginSketchGeometryDrag(session, point.target, point.position)
    expectTrue(session.activeTool === null, 'Dragging an existing point should clear an idle drawing tool.')
    session = finishSketchGeometryDrag(session, [2, 3])

    const movedPoint = session.definition.points.find((entry) => entry.pointId === point.pointId)
    assertClosePoint(movedPoint?.position, [2, 3], 'Unconstrained drag should update the authored point.')
    const movedDisplayLine = deriveSketchDisplayEntities(session).find((entity) => entity.kind === 'line')
    expectTrue(movedDisplayLine?.kind === 'line', 'Edited line should remain visible as a display line.')
    const movedDisplayEndpoint = [movedDisplayLine.start, movedDisplayLine.end].find((endpoint) =>
      Math.hypot(endpoint[0] - 2, endpoint[1] - 3) < 1e-4,
    )
    assertClosePoint(movedDisplayEndpoint, [2, 3], 'Edited line display should derive from the updated sketch definition.')
    expectTrue(
      !(movedDisplayLine.start[0] === 0 && movedDisplayLine.start[1] === 0)
        && !(movedDisplayLine.end[0] === 0 && movedDisplayLine.end[1] === 0),
      'Edited line display should not include stale pre-drag point geometry.',
    )
    assertClosePoint(
      session.commitRequest?.definition.points.find((entry) => entry.pointId === point.pointId)?.position,
      [2, 3],
      'Unconstrained drag should prepare the authored commit mutation.',
    )
  }

  function testConstrainedSquareDragTranslatesSolvedShape() {
    let session = createSessionFromDefinition(createSquareDefinition(false))
    const target = session.definition.points.find((point) => point.pointId === 'sketch_point_b')?.target
    expectTrue(target, 'Expected square vertex B.')

    session = beginSketchGeometryDrag(session, target, [1, 0])
    session = finishSketchGeometryDrag(session, [4, 3])

    const points = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    assertClosePoint(points.get('sketch_point_a'), [3, 3], 'Dragging free square vertex should translate A.')
    assertClosePoint(points.get('sketch_point_b'), [4, 3], 'Dragging free square vertex should honor B target.')
    assertClosePoint(points.get('sketch_point_c'), [4, 4], 'Dragging free square vertex should translate C.')
    assertClosePoint(points.get('sketch_point_d'), [3, 4], 'Dragging free square vertex should translate D.')
    expectTrue(session.validationMessage === null, 'Valid constrained drag should not leave blocked feedback.')
  }

  function testLiveRegionRenderableTracksJiggledSketchDrag() {
    let session = createSessionFromDefinition(createSquareDefinition(false))
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    }
    const target = session.definition.points.find((point) => point.pointId === 'sketch_point_b')?.target
    expectTrue(target, 'Expected square vertex B.')

    const initialBounds = getRegionRenderableBounds(session)
    const initialRegionId = session.solvedRegions[0]?.regionId
    expectTrue(initialRegionId, 'Initial square should derive a live region id.')
    assertClosePoint([initialBounds.minX, initialBounds.minY], [0, 0], 'Initial live region should start at the square origin.')
    assertClosePoint([initialBounds.maxX, initialBounds.maxY], [1, 1], 'Initial live region should match the square extents.')

    session = beginSketchGeometryDrag(session, target, [1, 0])
    session = finishSketchGeometryDrag(session, [4, 3])

    expectTrue(session.solvedRegions.length === 1, 'Dragging the square should keep one live derived region.')
    expectTrue(
      session.solvedRegions[0]?.regionId === initialRegionId,
      'Dragging the square should keep the live region identity stable.',
    )

    const movedBounds = getRegionRenderableBounds(session)
    assertClosePoint([movedBounds.minX, movedBounds.minY], [3, 3], 'Jiggled live region should move with the sketch.')
    assertClosePoint([movedBounds.maxX, movedBounds.maxY], [4, 4], 'Jiggled live region should keep the solved square extents.')
  }

  function testLiveRegionRenderablePreservesInnerLoopHole() {
    const definition = makeDefinition({
      pointIds: [
        'sketch_point_a',
        'sketch_point_b',
        'sketch_point_c',
        'sketch_point_d',
        'sketch_point_e',
        'sketch_point_f',
        'sketch_point_g',
        'sketch_point_h',
      ],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 8, 0),
        makePoint('sketch_point_c', 'C', 8, 8),
        makePoint('sketch_point_d', 'D', 0, 8),
        makePoint('sketch_point_e', 'E', 2, 2),
        makePoint('sketch_point_f', 'F', 6, 2),
        makePoint('sketch_point_g', 'G', 6, 6),
        makePoint('sketch_point_h', 'H', 2, 6),
      ],
      entityIds: [
        'sketch_entity_ab',
        'sketch_entity_bc',
        'sketch_entity_cd',
        'sketch_entity_da',
        'sketch_entity_ef',
        'sketch_entity_fg',
        'sketch_entity_gh',
        'sketch_entity_he',
      ],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_da', 'DA', 'sketch_point_d', 'sketch_point_a'),
        makeLine('sketch_entity_ef', 'EF', 'sketch_point_e', 'sketch_point_f'),
        makeLine('sketch_entity_fg', 'FG', 'sketch_point_f', 'sketch_point_g'),
        makeLine('sketch_entity_gh', 'GH', 'sketch_point_g', 'sketch_point_h'),
        makeLine('sketch_entity_he', 'HE', 'sketch_point_h', 'sketch_point_e'),
      ],
    })
    let session = createSessionFromDefinition(definition)
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    }

    const geometry = getLiveRegionMesh(session)
    expectTrue(geometry.triangleIndices.length > 0, 'Holed live region should render a triangulated mesh.')
    expectTrue(Math.abs(getMeshArea(geometry) - 48) < 1e-6, 'Holed live region mesh should subtract the inner loop area.')
  }

  function testLiveRegionRenderableTriangulatesConcaveRegion() {
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
        makePoint('sketch_point_c', 'C', 4, 1),
        makePoint('sketch_point_d', 'D', 1, 1),
        makePoint('sketch_point_e', 'E', 1, 4),
        makePoint('sketch_point_f', 'F', 0, 4),
      ],
      entityIds: [
        'sketch_entity_ab',
        'sketch_entity_bc',
        'sketch_entity_cd',
        'sketch_entity_de',
        'sketch_entity_ef',
        'sketch_entity_fa',
      ],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_bc', 'BC', 'sketch_point_b', 'sketch_point_c'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
        makeLine('sketch_entity_de', 'DE', 'sketch_point_d', 'sketch_point_e'),
        makeLine('sketch_entity_ef', 'EF', 'sketch_point_e', 'sketch_point_f'),
        makeLine('sketch_entity_fa', 'FA', 'sketch_point_f', 'sketch_point_a'),
      ],
    })
    let session = createSessionFromDefinition(definition)
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    }

    const geometry = getLiveRegionMesh(session)
    expectTrue(geometry.triangleIndices.length === 4, 'Six-point concave live region should triangulate into four triangles.')
    expectTrue(Math.abs(getMeshArea(geometry) - 7) < 1e-6, 'Concave live region mesh should preserve polygon area without fan overlap.')
  }

  function testLiveRegionDiagnosticsAreAvailableDuringEditing() {
    const definition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 2, 0),
      ],
      entityIds: ['sketch_entity_open'],
      entities: [
        makeLine('sketch_entity_open', 'Open', 'sketch_point_a', 'sketch_point_b'),
      ],
    })
    let session = createSessionFromDefinition(definition)
    const target = session.definition.points.find((point) => point.pointId === 'sketch_point_b')?.target
    expectTrue(target, 'Expected open segment endpoint.')
    session = beginSketchGeometryDrag(session, target, [2, 0])
    session = updateSketchGeometryDrag(session, [2.25, 0])

    expectTrue(
      getSketchSessionRegionDiagnostics(session).some((diagnostic) => diagnostic.code === 'profile-open-segment'),
      'Live region diagnostics should be available to viewport feedback while editing.',
    )
  }

  function testConstrainedDragRegionDerivationBenchmark() {
    const definition = createSquareDefinition(false)
    let session = createSessionFromDefinition(definition)
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    }
    const target = session.definition.points.find((point) => point.pointId === 'sketch_point_b')?.target
    expectTrue(target, 'Expected square vertex B.')

    session = beginSketchGeometryDrag(session, target, [1, 0])
    const frameCount = 30
    const startedAt = performance.now()
    for (let index = 0; index < frameCount; index += 1) {
      const t = index / (frameCount - 1)
      session = updateSketchGeometryDrag(session, [1 + t * 3, t * 2])
      expectTrue(session.solvedRegions.length === 1, 'Drag-frame region derivation should keep the constrained square profile live.')
    }
    const elapsed = performance.now() - startedAt
    expectTrue(
      elapsed < 1_500,
      `Constrained drag live-region benchmark should stay responsive; ${frameCount} frames took ${elapsed.toFixed(1)}ms.`,
    )
  }

  function testRectangleToolDragTranslatesWholeRectangle() {
    let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
    session = beginSketchTool(session, 'rectangle')
    session = startSketchDraw(session, [0, 0])
    session = acceptSketchDraw(session, [4, 3])

    const target = session.definition.points.find((point) =>
      point.pointId === 'sketch_point_1_rect-bottom-left',
    )?.target
    expectTrue(target, 'Expected rectangle bottom-left vertex.')

    session = beginSketchGeometryDrag(session, target, [0, 0])
    session = finishSketchGeometryDrag(session, [2, 2])

    const points = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    assertClosePoint(points.get('sketch_point_1_rect-bottom-left'), [2, 2], 'Dragging rectangle corner should translate bottom left.')
    assertClosePoint(points.get('sketch_point_1_rect-bottom-right'), [6, 2], 'Dragging rectangle corner should translate bottom right.')
    assertClosePoint(points.get('sketch_point_1_rect-top-right'), [6, 5], 'Dragging rectangle corner should translate top right.')
    assertClosePoint(points.get('sketch_point_1_rect-top-left'), [2, 5], 'Dragging rectangle corner should translate top left.')
    expectTrue(session.validationMessage === null, 'Translatable rectangle drag should not leave blocked feedback.')
  }

  function testImmovableConstrainedDragBlocksWithoutChangingDraft() {
    let session = createSessionFromDefinition(createSquareDefinition(true))
    const before = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    const target = session.definition.points.find((point) => point.pointId === 'sketch_point_a')?.target
    expectTrue(target, 'Expected fixed square vertex A.')

    session = beginSketchGeometryDrag(session, target, [0, 0])
    session = finishSketchGeometryDrag(session, [2, 2])

    const after = new Map(session.definition.points.map((point) => [point.pointId, point.position]))
    assertClosePoint(after.get('sketch_point_a'), before.get('sketch_point_a')!, 'Blocked drag should leave A unchanged.')
    assertClosePoint(after.get('sketch_point_b'), before.get('sketch_point_b')!, 'Blocked drag should leave B unchanged.')
    expectTrue(
      session.validationMessage === 'Geometry is constrained and cannot move to that position.',
      'Blocked drag should leave visible constrained-movement feedback.',
    )
  }

  function testSelectedEntityDeletionRemovesDependentAnnotations() {
    const session = createSessionFromDefinition({
      ...makeDefinition({
        pointIds: ['sketch_point_center', 'sketch_point_a', 'sketch_point_b'],
        points: [
          makePoint('sketch_point_center', 'Center', 0, 0),
          makePoint('sketch_point_a', 'A', 2, 0),
          makePoint('sketch_point_b', 'B', 4, 0),
        ],
        entityIds: ['sketch_entity_circle', 'sketch_entity_ab'],
        entities: [
          makeCircle('sketch_entity_circle', 'Circle', 'sketch_point_center', 1),
          makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        ],
      }),
      constraintIds: ['constraint_horizontal_ab'],
      constraints: [{
        constraintId: 'constraint_horizontal_ab',
        kind: 'horizontal',
        label: 'AB horizontal',
        entityId: 'sketch_entity_ab',
      }],
      dimensionIds: ['dimension_radius', 'dimension_width'],
      dimensions: [
        {
          dimensionId: 'dimension_radius',
          kind: 'circleRadius',
          label: 'Radius',
          entityId: 'sketch_entity_circle',
          value: 1,
        },
        {
          dimensionId: 'dimension_width',
          kind: 'horizontalDistance',
          label: 'Width',
          pointIds: ['sketch_point_a', 'sketch_point_b'],
          value: 2,
        },
      ],
    })
    const deleted = deleteSelectedSketchGeometry(session, [{
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_circle',
    }])

    expectTrue(!deleted.definition.entityIds.includes('sketch_entity_circle'), 'Entity deletion should remove the selected entity.')
    expectTrue(
      deleted.definition.constraintIds.includes('constraint_horizontal_ab'),
      'Entity deletion should preserve unrelated entity constraints.',
    )
    expectTrue(
      !deleted.definition.dimensionIds.includes('dimension_radius'),
      'Entity deletion should remove dimensions that reference the deleted entity.',
    )
    expectTrue(
      deleted.definition.dimensionIds.includes('dimension_width'),
      'Entity deletion should preserve unrelated dimensions.',
    )
    expectTrue(
      deleted.commitRequest?.definition.entityIds.includes('sketch_entity_circle') === false,
      'Entity deletion should rebuild the commit request without deleted geometry.',
    )
    expectTrue(
      !deriveSketchDisplayEntities(deleted).some((entity) => entity.entityId === 'sketch_entity_circle'),
      'Entity deletion should remove deleted accepted geometry from derived display entities.',
    )
  }

  function testSelectedPointDeletionRemovesDependentGeometryAndAnnotations() {
    const session = createSessionFromDefinition(createSquareDefinition(true))
    const deleted = deleteSelectedSketchGeometry(session, [{
      kind: 'sketchPoint',
      sketchId: 'sketch_primary',
      pointId: 'sketch_point_a',
    }])

    expectTrue(!deleted.definition.pointIds.includes('sketch_point_a'), 'Point deletion should remove the selected point.')
    expectTrue(
      !deleted.definition.entityIds.includes('sketch_entity_ab') && !deleted.definition.entityIds.includes('sketch_entity_da'),
      'Point deletion should remove local entities that reference the deleted point.',
    )
    expectTrue(
      !deleted.definition.constraintIds.includes('constraint_fix_a'),
      'Point deletion should remove point constraints that reference the deleted point.',
    )
    expectTrue(
      deleted.definition.constraintIds.includes('constraint_vertical_bc'),
      'Point deletion should preserve unrelated constraints.',
    )
    expectTrue(
      !deleted.definition.dimensionIds.includes('dimension_width') && !deleted.definition.dimensionIds.includes('dimension_height'),
      'Point deletion should remove dimensions that reference deleted point ids.',
    )
    const remainingPointIds = new Set(deleted.definition.pointIds)
    expectTrue(
      deleted.definition.entities.every((entity) =>
        entity.kind === 'spline'
          ? entity.fitPointIds.every((pointId) => remainingPointIds.has(pointId))
          : entity.kind === 'circle'
            ? remainingPointIds.has(entity.centerPointId)
            : entity.kind === 'point'
              ? remainingPointIds.has(entity.pointId)
              : entity.kind === 'arc'
                ? remainingPointIds.has(entity.centerPointId)
                  && remainingPointIds.has(entity.startPointId)
                  && remainingPointIds.has(entity.endPointId)
                : remainingPointIds.has(entity.startPointId) && remainingPointIds.has(entity.endPointId),
      ),
      'Point deletion should not leave entities with dangling point references.',
    )
    expectTrue(
      !deriveSketchDisplayEntities(deleted).some((entity) => entity.entityId === 'sketch_entity_ab' || entity.entityId === 'sketch_entity_da'),
      'Point deletion should remove dependent accepted geometry from derived display entities.',
    )
  }

  function testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets() {
    let session = createSessionFromDefinition(createSquareDefinition(false))
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    }
    const entityTarget = session.definition.entities[0]?.target
    const pointTarget = session.definition.points[0]?.target
    const regionTarget = session.solvedRegions[0]?.target
    expectTrue(entityTarget && pointTarget && regionTarget, 'Style patch fixture should create local edge, point, and region targets.')
    const before = structuredClone(session.commitRequest?.definition)

    session = patchSketchStyleValue(
      session,
      [{ kind: 'edge', bodyId: 'body_a', edgeId: 'edge_a' }],
      { intent: 'patchSketchStyle', field: 'fillColor', value: '#00ffff' },
    )

    expectTrue(
      JSON.stringify(session.commitRequest?.definition) === JSON.stringify(before),
      'Style patch should ignore non-local targets such as external model geometry refs.',
    )

    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'fillMode', value: 'solid' },
    )
    expectTrue(
      (session.definition.styles?.length ?? 0) === 0,
      'Fill style patch should reject sketch edge/entity targets without mutating style records.',
    )

    session = patchSketchStyleValue(
      session,
      [regionTarget],
      { intent: 'patchSketchStyle', field: 'fillMode', value: 'gradient' },
    )
    session = patchSketchStyleValue(
      session,
      [regionTarget],
      { intent: 'patchSketchStyle', field: 'gradientStartColor', value: '#00ffff' },
    )
    const regionStyle = session.definition.styles?.find((style) =>
      style.target.kind === 'region' && style.target.regionId === regionTarget.regionId,
    )
    expectTrue(
      regionStyle?.fill.kind === 'gradient' &&
        regionStyle.fill.gradient.startColor === '#00ffff',
      'Fill style patch should author a region-scoped style record for selected live regions.',
    )

    session = patchSketchStyleValue(
      session,
      [regionTarget],
      { intent: 'patchSketchStyle', field: 'strokeWidth', value: 4 },
    )
    expectTrue(
      session.definition.entities[0]?.style === undefined,
      'Stroke style patch should reject region targets without mutating entity stroke fields.',
    )

    session = patchSketchStyleValue(
      session,
      [pointTarget],
      { intent: 'patchSketchStyle', field: 'strokeWidth', value: 4 },
    )
    expectTrue(
      session.definition.entities[0]?.style === undefined,
      'Stroke style patch should reject point targets without mutating entity stroke fields.',
    )

    session = patchSketchStyleValue(
      session,
      [entityTarget],
      { intent: 'patchSketchStyle', field: 'strokeWidth', value: 2.5 },
    )
    expectTrue(
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

    expectTrue(
      session.definition.entities[0]?.style?.strokeWidth === 2.5,
      'Local style patch should update the selected sketch entity style in session definition.',
    )
    expectTrue(
      getSketchSessionDisplayRenderables(session).find((entry) =>
        entry.target?.kind === 'sketchEntity' && entry.target.entityId === entityTarget.entityId,
      )?.strokeStyle?.width === 2.5,
      'Explicitly enabled local stroke fields should render through sketch display metadata.',
    )
    expectTrue(
      session.commitRequest?.definition.styles?.some((style) =>
        style.target.kind === 'region' &&
          style.target.regionId === regionTarget.regionId &&
          style.fill.kind === 'gradient',
      ),
      'Region fill style patch should rebuild the durable commit request payload.',
    )
    expectTrue(
      session.definition.entities[0]?.style?.strokeMiterLimit === 7,
      'Local style patch should update miter limit in session definition.',
    )
    expectTrue(
      session.definition.entities[0]?.style?.strokeDashSize === 0.6 &&
        session.definition.entities[0]?.style?.strokeGapSize === 0.25,
      'Local style patch should update dash fields in session definition.',
    )
    expectTrue(
      session.commitRequest?.definition.entities[0]?.style?.strokeWidth === 2.5 &&
        session.commitRequest.definition.entities[0]?.style?.strokeEnabled === true &&
        session.commitRequest.definition.entities[0]?.style?.strokeDashSize === 0.6,
      'Local style patch should rebuild commit request using the updated sketch definition.',
    )
  }

  function testSvgRenderingToggleSuppressesAuthoredStylesWithoutDeletingThem() {
    let session = createSessionFromDefinition(createSquareDefinition(false))
    session = {
      ...session,
      solvedRegions: deriveRegionsForDefinition(session.definition),
    }
    const entityTarget = session.definition.entities[0]?.target
    const regionTarget = session.solvedRegions[0]?.target
    expectTrue(entityTarget && regionTarget, 'SVG rendering fixture should expose edge and region targets.')

    session = patchSketchStyleValue(session, [regionTarget], {
      intent: 'patchSketchStyle',
      field: 'fillMode',
      value: 'solid',
    })
    session = patchSketchStyleValue(session, [regionTarget], {
      intent: 'patchSketchStyle',
      field: 'fillColor',
      value: '#00ffff',
    })
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: 'patchSketchStyle',
      field: 'strokeEnabled',
      value: true,
    })
    session = patchSketchStyleValue(session, [entityTarget], {
      intent: 'patchSketchStyle',
      field: 'strokeWidth',
      value: 2,
    })

    const styledRenderables = getSketchSessionDisplayRenderables(session)
    expectTrue(
      styledRenderables.some((entry) => entry.target?.kind === 'region' && entry.paintStyle) &&
        styledRenderables.some((entry) => entry.target?.kind === 'sketchEntity' && entry.strokeStyle?.width === 2),
      'SVG rendering enabled should expose authored fill and stroke display metadata.',
    )

    const disabled = toggleSketchSvgRendering(session)
    expectTrue(!isSketchSvgRenderingEnabled(disabled), 'SVG rendering toggle should persist disabled state on the sketch.')
    expectTrue(
      disabled.definition.styles?.length === session.definition.styles?.length &&
        disabled.definition.entities[0]?.style?.strokeWidth === 2,
      'Disabling SVG rendering should not delete authored region or edge style data.',
    )
    expectTrue(
      getSketchSessionDisplayRenderables(disabled).every((entry) => !entry.paintStyle && !entry.strokeStyle),
      'SVG rendering disabled should suppress authored fill and stroke display metadata.',
    )

    const restored = toggleSketchSvgRendering(disabled)
    const restoredRenderables = getSketchSessionDisplayRenderables(restored)
    expectTrue(
      restoredRenderables.some((entry) => entry.target?.kind === 'region' && entry.paintStyle) &&
        restoredRenderables.some((entry) => entry.target?.kind === 'sketchEntity' && entry.strokeStyle?.width === 2),
      'Re-enabling SVG rendering should restore visuals from persisted style data.',
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

    expectTrue(session.validationMessage === null, 'Accepted trim should not leave validation feedback.')
    expectTrue(session.definition.entityIds.includes('sketch_entity_ab'), 'Trim should preserve the selected line entity id.')
    expectTrue(session.definition.entityIds.length === 4, 'Trim should add one split segment for the remaining geometry.')
    expectTrue(session.commitRequest?.definition.entityIds.length === 4, 'Trim should rebuild the sketch commit request.')
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
    expectTrue(trimmedCircle?.kind === 'arc', 'Trimming a circle should preserve the selected id as an authored arc.')
    expectTrue(circleSession.validationMessage === null, 'Circle trim should not leave validation feedback.')

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

    expectTrue(arcSession.validationMessage === null, 'Arc trim should not leave validation feedback.')
    expectTrue(
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

    expectTrue(splineSession.validationMessage === null, 'Spline trim should not leave validation feedback.')
    expectTrue(
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
    expectTrue(lineTarget, 'Offset fixture should create a line target.')

    session = beginSketchTool(session, 'offset')
    session = selectSketchEditToolTarget(session, lineTarget)
    expectTrue(session.toolStagedEntities.some((entity) => entity.status === 'preview'), 'Offset selection should stage preview geometry.')
    expectTrue(
      deriveSketchDisplayEntities(session).some((entity) => entity.status === 'preview'),
      'Offset preview should appear in derived display entities while staged.',
    )

    session = patchSketchEditToolValue(session, { value: 0 })
    const beforeInvalidCommit = session.definition.entityIds.length
    session = patchSketchEditToolValue(session, { intent: 'commitOffset' })

    expectTrue(session.definition.entityIds.length === beforeInvalidCommit, 'Invalid offset should not mutate the sketch draft.')
    expectTrue(session.validationMessage === 'Offset distance must be greater than zero.', 'Invalid offset should report validation feedback.')

    session = patchSketchEditToolValue(session, { value: 1 })
    session = patchSketchEditToolValue(session, { intent: 'commitOffset' })

    expectTrue(session.definition.entityIds.length === 2, 'Valid offset should add one offset line.')
    expectTrue(session.commitRequest?.definition.entityIds.length === 2, 'Valid offset should rebuild the sketch commit request.')
    expectTrue(session.toolStagedEntities.length === 0, 'Committed offset should clear staged preview geometry.')
    expectTrue(
      deriveSketchDisplayEntities(session).every((entity) => entity.status === 'accepted'),
      'Committed offset display entities should be accepted definition-derived geometry only.',
    )
  }

  function testOffsetActivationSeedsCompatiblePreselectionAndClearsInvalidSelection() {
    const definition = createSquareDefinition(false)
    const selectedTargets = definition.entities.slice(0, 2).map((entity) => entity.target)
    const activated = beginSketchTool(createSessionFromDefinition(definition), 'offset', selectedTargets)

    expectTrue(activated.activeEditTool?.toolId === 'offset', 'Offset activation should open the offset edit tool.')
    expectTrue(
      activated.activeEditTool?.selectedTargets.length === selectedTargets.length,
      'Offset activation should seed compatible preselected targets into the edit tool state.',
    )
    expectTrue(
      activated.toolStagedEntities.some((entity) => entity.status === 'preview'),
      'Offset activation should build preview geometry from compatible preselection.',
    )

    const cleared = beginSketchTool(createSessionFromDefinition(definition), 'offset', [
      definition.points[0]!.target,
    ])

    expectTrue(
      cleared.activeEditTool?.selectedTargets.length === 0,
      'Offset activation should clear incompatible preselected targets instead of carrying them into the edit tool.',
    )
    expectTrue(cleared.toolStagedEntities.length === 0, 'Cleared offset activation should not leave preview geometry behind.')
  }

  function testOffsetCreatesContinuousOuterAndInnerSquares() {
    const definition = createSquareDefinition(false)
    let outerSession = beginSketchTool(createSessionFromDefinition(definition), 'offset')

    for (const entity of definition.entities) {
      outerSession = selectSketchEditToolTarget(outerSession, entity.target)
    }

    expectTrue(outerSession.activeEditTool?.selectedTargets.length === 4, 'Offset should collect multiple selected square edges.')
    expectTrue(
      outerSession.toolStagedEntities.filter((entity) => entity.status === 'preview' && entity.kind === 'line').length === 4,
      'Continuous square offset should preview one joined line per selected edge.',
    )

    outerSession = patchSketchEditToolValue(outerSession, { value: 1 })
    outerSession = patchSketchEditToolValue(outerSession, { intent: 'commitOffset' })

    const outerLines = outerSession.definition.entities.filter((entity) =>
      entity.kind === 'lineSegment' && !definition.entityIds.includes(entity.entityId),
    )
    const outerPoints = outerSession.definition.points.filter((point) => !definition.pointIds.includes(point.pointId))

    expectTrue(outerLines.length === 4, 'Outer square offset should create four joined line entities.')
    expectTrue(outerPoints.length === 4, 'Outer square offset should create four joined corner points.')
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

    expectTrue(offsetLines.length === 2, 'Open angle offset should create one joined line per selected edge.')
    expectTrue(offsetPoints.length === 3, 'Open angle offset should share the mitered corner point.')
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
    expectTrue(offsetCircle?.kind === 'circle' && offsetCircle.radius === 3, 'Circle offset should add a copied circle at the requested radius.')

    let arcSession = beginSketchTool(createSessionFromDefinition(definition), 'offset')
    arcSession = selectSketchEditToolTarget(arcSession, {
      kind: 'sketchEntity',
      sketchId: 'sketch_primary',
      entityId: 'sketch_entity_arc',
    })
    arcSession = patchSketchEditToolValue(arcSession, { value: 1 })
    arcSession = patchSketchEditToolValue(arcSession, { intent: 'commitOffset' })
    expectTrue(
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
    expectTrue(
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
    expectTrue(circleSession.toolStagedEntities.some((entity) => entity.status === 'preview' && entity.kind === 'circle'), 'Projected circle offset should preview a circle.')
    circleSession = patchSketchEditToolValue(circleSession, { value: 1 })
    circleSession = patchSketchEditToolValue(circleSession, { intent: 'commitOffset' })
    const offsetCircle = circleSession.definition.entities.find((entity) => entity.kind === 'circle')
    expectTrue(offsetCircle?.kind === 'circle' && offsetCircle.radius === 3, 'Projected circle offset should create a sketch-owned circle.')

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
    expectTrue(splineSession.toolStagedEntities.some((entity) => entity.status === 'preview' && entity.kind === 'spline'), 'Projected spline offset should preview a spline.')
    splineSession = patchSketchEditToolValue(splineSession, { value: 1 })
    splineSession = patchSketchEditToolValue(splineSession, { intent: 'commitOffset' })
    expectTrue(
      splineSession.definition.entities.some((entity) => entity.kind === 'spline'),
      'Projected spline offset should create a sketch-owned spline.',
    )
  }

  function testSketchFilletChamferAndSlotUseSessionPreviewAndCommit() {
    const cornerDefinition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 4, 0),
        makePoint('sketch_point_c', 'C', 0, 4),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_ac'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_ac', 'AC', 'sketch_point_a', 'sketch_point_c'),
      ],
    })

    let filletSession = beginSketchTool(createSessionFromDefinition(cornerDefinition), 'sketchFillet')
    filletSession = selectSketchEditToolTarget(filletSession, cornerDefinition.entities[0]!.target)
    filletSession = selectSketchEditToolTarget(filletSession, cornerDefinition.entities[1]!.target)
    expectTrue(filletSession.toolStagedEntities.length > 0, 'Sketch fillet should preview supported adjacent line edits.')
    filletSession = patchSketchEditToolValue(filletSession, { value: 1 })
    filletSession = patchSketchEditToolValue(filletSession, { intent: 'commitSketchEditOperator' })
    expectTrue(
      filletSession.definition.entities.some((entity) => entity.kind === 'arc'),
      'Sketch fillet should commit durable arc geometry through the session.',
    )
    expectTrue(filletSession.activeTool === 'sketchFillet', 'Sketch fillet should keep the active sketch session open.')

    let chamferSession = beginSketchTool(createSessionFromDefinition(cornerDefinition), 'sketchChamfer')
    chamferSession = selectSketchEditToolTarget(chamferSession, cornerDefinition.entities[0]!.target)
    chamferSession = selectSketchEditToolTarget(chamferSession, cornerDefinition.entities[1]!.target)
    chamferSession = patchSketchEditToolValue(chamferSession, { value: 1 })
    chamferSession = patchSketchEditToolValue(chamferSession, { intent: 'commitSketchEditOperator' })
    expectTrue(chamferSession.definition.entities.length === 3, 'Sketch chamfer should add one durable chamfer segment.')

    const lineDefinition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 4, 0),
      ],
      entityIds: ['sketch_entity_ab'],
      entities: [makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b')],
    })
    let slotSession = beginSketchTool(createSessionFromDefinition(lineDefinition), 'sketchSlot')
    slotSession = selectSketchEditToolTarget(slotSession, lineDefinition.entities[0]!.target)
    expectTrue(slotSession.toolStagedEntities.length > 0, 'Sketch slot should preview slot boundary geometry.')
    slotSession = patchSketchEditToolValue(slotSession, { value: 2 })
    slotSession = patchSketchEditToolValue(slotSession, { intent: 'commitSketchEditOperator' })
    expectTrue(
      slotSession.definition.entities.filter((entity) => entity.kind === 'arc').length === 2,
      'Sketch slot around a line should commit rounded end arcs.',
    )
  }

  function testSketchExtendSplitAndUnsupportedDiagnosticsUseSessionState() {
    const extendDefinition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 1, 0),
        makePoint('sketch_point_c', 'C', 3, -1),
        makePoint('sketch_point_d', 'D', 3, 1),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_cd'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
      ],
    })
    let extendSession = beginSketchTool(createSessionFromDefinition(extendDefinition), 'sketchExtend')
    extendSession = selectSketchEditToolTarget(extendSession, extendDefinition.entities[0]!.target)
    extendSession = selectSketchEditToolTarget(extendSession, extendDefinition.entities[1]!.target)
    assertIncludesPoint(extendSession.definition.points, [3, 0], 'Sketch extend should update the selected line endpoint at the boundary.')
    expectTrue(extendSession.definition.entities.length === 2, 'Sketch extend should preserve unrelated boundary geometry.')

    const splitDefinition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_c', 'sketch_point_d'],
      points: [
        makePoint('sketch_point_a', 'A', 0, 0),
        makePoint('sketch_point_b', 'B', 4, 0),
        makePoint('sketch_point_c', 'C', 2, -1),
        makePoint('sketch_point_d', 'D', 2, 1),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_cd'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_cd', 'CD', 'sketch_point_c', 'sketch_point_d'),
      ],
    })
    let splitSession = beginSketchTool(createSessionFromDefinition(splitDefinition), 'sketchSplit')
    splitSession = selectSketchEditToolTarget(splitSession, splitDefinition.entities[0]!.target)
    splitSession = selectSketchEditToolTarget(splitSession, splitDefinition.entities[1]!.target)
    expectTrue(splitSession.definition.entities.length === 3, 'Sketch split should divide the selected line in session state.')
    assertIncludesPoint(splitSession.definition.points, [2, 0], 'Sketch split should add the split point at the crossing boundary.')

    let unsupportedSession = beginSketchTool(createSessionFromDefinition(splitDefinition), 'sketchFillet')
    unsupportedSession = selectSketchEditToolTarget(unsupportedSession, splitDefinition.entities[0]!.target)
    unsupportedSession = selectSketchEditToolTarget(unsupportedSession, splitDefinition.entities[1]!.target)
    expectTrue(
      unsupportedSession.validationMessage === 'Sketch fillet needs two lines that share a corner.',
      'Sketch edit operators should report unsupported valid combinations without mutating.',
    )
    expectTrue(unsupportedSession.definition.entities.length === splitDefinition.entities.length, 'Unsupported fillet should not change the sketch definition.')
  }

  function testSketchDerivedTransformOperatorsCreateDurableRelationships() {
    const definition = makeDefinition({
      pointIds: ['sketch_point_a', 'sketch_point_b', 'sketch_point_axis_a', 'sketch_point_axis_b'],
      points: [
        makePoint('sketch_point_a', 'A', 1, 1),
        makePoint('sketch_point_b', 'B', 2, 1),
        makePoint('sketch_point_axis_a', 'Axis A', -1, 0),
        makePoint('sketch_point_axis_b', 'Axis B', 3, 0),
      ],
      entityIds: ['sketch_entity_ab', 'sketch_entity_axis'],
      entities: [
        makeLine('sketch_entity_ab', 'AB', 'sketch_point_a', 'sketch_point_b'),
        makeLine('sketch_entity_axis', 'Axis', 'sketch_point_axis_a', 'sketch_point_axis_b'),
      ],
    })

    let mirrorSession = beginSketchTool(createSessionFromDefinition(definition), 'sketchMirror')
    expectTrue(mirrorSession.activeTool === 'sketchMirror', 'Sketch mirror should activate a sketch-local edit workflow.')
    mirrorSession = selectSketchEditToolTarget(mirrorSession, definition.entities[0]!.target)
    mirrorSession = selectSketchEditToolTarget(mirrorSession, definition.entities[1]!.target)

    const mirrorRelationship = mirrorSession.definition.derivedRelationships?.[0]
    expectTrue(mirrorRelationship?.kind === 'mirror', 'Sketch mirror should persist a mirror relationship.')
    expectTrue(mirrorRelationship.seedEntityIds[0] === 'sketch_entity_ab', 'Mirror relationship should keep the selected seed entity.')
    const mirroredPointId = mirrorRelationship.outputs[0]?.outputPointIds[0]
    const mirroredPoint = mirrorSession.definition.points.find((point) => point.pointId === mirroredPointId)
    assertClosePoint(mirroredPoint?.position, [1, -1], 'Mirror relationship should evaluate output points from the mirror axis.')

    const editedSeed = {
      ...mirrorSession.definition,
      points: mirrorSession.definition.points.map((point) =>
        point.pointId === 'sketch_point_a' ? { ...point, position: [1, 2] as const } : point,
      ),
    }
    const solvedEdited = solveSketchDefinitionCore({
      definition: editedSeed,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })
    const updatedDerivedPoint = solvedEdited.solvedSnapshot.solvedPoints.find((point) => point.pointId === mirroredPointId)
    assertClosePoint(updatedDerivedPoint?.solvedPosition, [1, -2], 'Derived output should update when a supported seed point changes.')

    const renderable = getSketchSessionDisplayRenderables(mirrorSession).find((entry) =>
      entry.target?.kind === 'sketchEntity' && entry.target.entityId === mirrorRelationship.outputs[0]?.outputEntityId
    )
    expectTrue(renderable, 'Derived sketch geometry should render with a stable sketch entity target.')
  }

  function testSketchPatternAndTransformOperatorsCommitWithoutPartFeatureSessions() {
    const definition = createSquareDefinition(false)
    const sketchToolIds = ['sketchLinearPattern', 'sketchCircularPattern', 'sketchTransform'] as const

    for (const toolId of sketchToolIds) {
      expectTrue(
        toolDefinitions.some((tool) => tool.id === toolId && tool.modes.includes('sketch')),
        `${toolId} should be registered as a sketch-mode toolbar tool.`,
      )
      expectTrue(
        !toolDefinitions.some((tool) => tool.id === toolId && tool.modes.includes('part')),
        `${toolId} should remain distinct from part-mode feature tools.`,
      )

      let session = beginSketchTool(createSessionFromDefinition(definition), toolId)
      expectTrue(session.activeTool === toolId, `${toolId} should keep the active sketch session open.`)
      for (const entity of definition.entities) {
        session = selectSketchEditToolTarget(session, entity.target)
      }
      session = patchSketchEditToolValue(session, { value: toolId === 'sketchCircularPattern' ? Math.PI : 2 })
      session = patchSketchEditToolValue(session, { intent: 'commitSketchEditOperator' })

      const relationship = session.definition.derivedRelationships?.[0]
      expectTrue(relationship, `${toolId} should persist a derived relationship.`)
      expectTrue(session.definition.entities.length === definition.entities.length * 2, `${toolId} should add addressable derived output entities.`)
      expectTrue(session.commitRequest?.definition.derivedRelationships?.length === 1, `${toolId} commit payload should persist the relationship.`)
    }
  }

  function testDerivedLinearPatternGeometryParticipatesInProfiles() {
    const definition = createSquareDefinition(false)
    let session = beginSketchTool(createSessionFromDefinition(definition), 'sketchLinearPattern')
    for (const entity of definition.entities) {
      session = selectSketchEditToolTarget(session, entity.target)
    }
    session = patchSketchEditToolValue(session, { value: 3 })
    session = patchSketchEditToolValue(session, { intent: 'commitSketchEditOperator' })

    const solved = solveSketchDefinitionCore({
      definition: session.definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: 'bestEffort',
    })
    const regions = deriveSketchRegionsCore({
      documentId: 'doc_workspace',
      revisionId: 'rev_0001',
      sketchId: 'sketch_primary',
      definition: session.definition,
      solvedSnapshot: solved.solvedSnapshot,
    })

    expectTrue(regions.regions.length >= 2, 'Derived pattern output should participate in profile extraction when it forms a closed loop.')
    expectTrue(
      regions.regions.some((region) =>
        region.loops.some((loop) =>
          loop.segments.some((segment) =>
            segment.source.kind === 'entity'
            && (session.definition.derivedRelationships?.[0]?.outputs.some((output) => output.outputEntityId === segment.source.entityId) ?? false)
          )
        )
      ),
      'At least one extracted profile should reference derived output entities without detaching them.',
    )
  }

  testUnconstrainedPointDragUpdatesAuthoredDefinition()
  testConstrainedSquareDragTranslatesSolvedShape()
  testLiveRegionRenderableTracksJiggledSketchDrag()
  testLiveRegionRenderablePreservesInnerLoopHole()
  testLiveRegionRenderableTriangulatesConcaveRegion()
  testLiveRegionDiagnosticsAreAvailableDuringEditing()
  testConstrainedDragRegionDerivationBenchmark()
  testConnectedSketchSelectionSelectsTwoConnectedLines()
  testConnectedSketchSelectionSelectsRectangleFromAnyEdge()
  testConnectedSketchSelectionUsesLocalEntityTargetNamespace()
  testConnectedSketchSelectionSelectsBranchingComponentAndRejectsUnsupportedTargets()
  testRectangleToolDragTranslatesWholeRectangle()
  testImmovableConstrainedDragBlocksWithoutChangingDraft()
  testSelectedEntityDeletionRemovesDependentAnnotations()
  testSelectedPointDeletionRemovesDependentGeometryAndAnnotations()
  testLocalSketchStylePatchUpdatesCommitRequestAndIgnoresExternalTargets()
  testSvgRenderingToggleSuppressesAuthoredStylesWithoutDeletingThem()
  testTrimSplitsLineAtClearIntersections()
  testTrimHandlesCircleArcAndSplineTargets()
  testOffsetAddsLineCopyAndRejectsInvalidDistance()
  testOffsetActivationSeedsCompatiblePreselectionAndClearsInvalidSelection()
  testOffsetCreatesContinuousOuterAndInnerSquares()
  testOffsetCreatesContinuousOpenAngle()
  testOffsetAddsCircleArcAndSplineCopies()
  testOffsetAddsProjectedCircleAndSplineCopies()
  testSketchFilletChamferAndSlotUseSessionPreviewAndCommit()
  testSketchExtendSplitAndUnsupportedDiagnosticsUseSessionState()
  testSketchDerivedTransformOperatorsCreateDurableRelationships()
  testSketchPatternAndTransformOperatorsCommitWithoutPartFeatureSessions()
  testDerivedLinearPatternGeometryParticipatesInProfiles()
})
