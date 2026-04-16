import { test } from 'bun:test'
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  SKETCH_SCHEMA_VERSION,
  type RegionBoundarySegmentRecord,
  type RegionRecord,
  type SketchDefinition,
  type SketchRecord,
} from '@/contracts/sketch/schema'
import type {
  ConstructionId,
  RegionLoopId,
  RegionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import { buildRegionProfileFace } from '@/domain/modeling/occ/sketch-profile'
import { getDefaultOpenCascadeInstance } from '@/domain/modeling/occ/runtime'

test('src/domain/modeling/occ/sketch-profile.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function assertClose(actual: number, expected: number, tolerance: number, message: string) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}: expected ${expected}, got ${actual}.`)
    }
  }

  function createSketchPlane(): SketchPlaneDefinition {
    return {
      support: {
        kind: 'construction',
        constructionId: 'construction_plane-xy' as ConstructionId,
      },
      frame: {
        origin: [0, 0, 0],
        xAxis: [1, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      key: 'xy',
    }
  }

  function pointId(name: string) {
    return `sketch_point_${name}` as SketchPointId
  }

  function entityId(name: string) {
    return `sketch_entity_${name}` as SketchEntityId
  }

  function regionId(name: string) {
    return `region_${name}` as RegionId
  }

  function loopId(name: string) {
    return `region_loop_${name}` as RegionLoopId
  }

  function createSketchDefinition(
    sketchId: SketchId,
    points: Array<{ id: SketchPointId; position: readonly [number, number] }>,
    entities: SketchDefinition['entities'],
  ): SketchDefinition {
    return {
      schemaVersion: SKETCH_SCHEMA_VERSION,
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.id),
      points: points.map((point) => ({
        pointId: point.id,
        label: point.id,
        target: { kind: 'sketchPoint', sketchId, pointId: point.id },
        position: point.position,
        isConstruction: false,
      })),
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    }
  }

  function createSketchRecord(
    sketchId: SketchId,
    definition: SketchDefinition,
    solvedEntities: SketchRecord['solvedSnapshot']['solvedEntities'],
    solvedPoints: SketchRecord['solvedSnapshot']['solvedPoints'] = [],
  ): SketchRecord {
    return {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      sketchId,
      label: sketchId,
      planeSupport: {
        kind: 'construction',
        constructionId: 'construction_plane-xy' as ConstructionId,
      },
      definition,
      solvedSnapshot: {
        schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
        status: {
          solveState: 'solved',
          constraintState: 'wellConstrained',
        },
        solvedEntities,
        solvedPoints,
        constraintStatuses: [],
        dimensionStatuses: [],
        diagnostics: [],
      },
      regions: [],
    }
  }

  function createRegion(
    sketchId: SketchId,
    name: string,
    loops: RegionRecord['loops'],
  ): RegionRecord {
    return {
      ownerDocumentId: 'doc_workspace',
      ownerRevisionId: 'rev_0001',
      ownerFeatureId: null,
      ownerSketchId: sketchId,
      ownerBodyId: null,
      regionId: regionId(name),
      label: name,
      target: {
        kind: 'region',
        sketchId,
        regionId: regionId(name),
      },
      sourceSketch: {
        kind: 'sketch',
        sketchId,
      },
      loops,
      isClosed: true,
    }
  }

  async function faceArea(face: object) {
    const oc = await getDefaultOpenCascadeInstance()
    const props = new oc.GProp_GProps_1()

    oc.BRepGProp.SurfaceProperties_1(face as InstanceType<typeof oc.TopoDS_Face>, props, false, false)
    return props.Mass()
  }

  async function testRectangleProfileBuildsExpectedArea() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createSketchPlane()
    const sketchId = 'sketch_phase3_rectangle' as SketchId
    const points = [
      { id: pointId('bottom_left'), position: [0, 0] as const },
      { id: pointId('bottom_right'), position: [4, 0] as const },
      { id: pointId('top_right'), position: [4, 3] as const },
      { id: pointId('top_left'), position: [0, 3] as const },
    ]
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: 'lineSegment',
        entityId: entityId('bottom'),
        label: 'bottom',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('bottom') },
        isConstruction: false,
        startPointId: pointId('bottom_left'),
        endPointId: pointId('bottom_right'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId('right'),
        label: 'right',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('right') },
        isConstruction: false,
        startPointId: pointId('bottom_right'),
        endPointId: pointId('top_right'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId('top'),
        label: 'top',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('top') },
        isConstruction: false,
        startPointId: pointId('top_right'),
        endPointId: pointId('top_left'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId('left'),
        label: 'left',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('left') },
        isConstruction: false,
        startPointId: pointId('top_left'),
        endPointId: pointId('bottom_left'),
      },
    ])
    const sketch = createSketchRecord(sketchId, definition, [
      { kind: 'lineSegment', entityId: entityId('bottom'), startPosition: [0, 0], endPosition: [4, 0] },
      { kind: 'lineSegment', entityId: entityId('right'), startPosition: [4, 0], endPosition: [4, 3] },
      { kind: 'lineSegment', entityId: entityId('top'), startPosition: [4, 3], endPosition: [0, 3] },
      { kind: 'lineSegment', entityId: entityId('left'), startPosition: [0, 3], endPosition: [0, 0] },
    ])
    const region = createRegion(sketchId, 'rectangle', [
      {
        loopId: loopId('rectangle_outer'),
        role: 'outer',
        orientation: 'counterClockwise',
        segments: [
          { source: { kind: 'entity', entityId: entityId('bottom') }, startPointId: pointId('bottom_left'), endPointId: pointId('bottom_right') },
          { source: { kind: 'entity', entityId: entityId('right') }, startPointId: pointId('bottom_right'), endPointId: pointId('top_right') },
          { source: { kind: 'entity', entityId: entityId('top') }, startPointId: pointId('top_right'), endPointId: pointId('top_left') },
          { source: { kind: 'entity', entityId: entityId('left') }, startPointId: pointId('top_left'), endPointId: pointId('bottom_left') },
        ],
        boundaryPointIds: points.map((point) => point.id),
        isClosed: true,
      },
    ])

    const profile = buildRegionProfileFace(oc, { plane, sketch }, region)
    assertClose(await faceArea(profile.face), 12, 1e-6, 'Rectangle profile should build the expected area')
  }

  async function testCircleProfileUsesSolvedCenterOffset() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createSketchPlane()
    const sketchId = 'sketch_phase3_circle' as SketchId
    const points = [{ id: pointId('circle_center'), position: [10, 20] as const }]
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: 'circle',
        entityId: entityId('circle'),
        label: 'circle',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('circle') },
        isConstruction: false,
        centerPointId: pointId('circle_center'),
        radius: 2,
      },
    ])
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: 'circle',
        entityId: entityId('circle'),
        centerPosition: [10, 20],
        solvedRadius: 2,
      },
    ])
    const region = createRegion(sketchId, 'circle', [
      {
        loopId: loopId('circle_outer'),
        role: 'outer',
        orientation: 'counterClockwise',
        segments: [
          {
            source: { kind: 'entity', entityId: entityId('circle') },
            startPointId: null,
            endPointId: null,
          },
        ],
        boundaryPointIds: [],
        isClosed: true,
      },
    ])

    const profile = buildRegionProfileFace(oc, { plane, sketch }, region)
    assertClose(await faceArea(profile.face), Math.PI * 4, 1e-5, 'Circle profile should build with the solved center and radius')
  }

  async function testArcProfileRespectsReversedLoopTraversal() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createSketchPlane()
    const sketchId = 'sketch_phase3_arc' as SketchId
    const points = [
      { id: pointId('arc_center'), position: [0, 0] as const },
      { id: pointId('arc_left'), position: [-1, 0] as const },
      { id: pointId('arc_right'), position: [1, 0] as const },
    ]
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: 'arc',
        entityId: entityId('upper_arc'),
        label: 'upper arc',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('upper_arc') },
        isConstruction: false,
        centerPointId: pointId('arc_center'),
        startPointId: pointId('arc_left'),
        endPointId: pointId('arc_right'),
        sweepDirection: 'clockwise',
      },
      {
        kind: 'lineSegment',
        entityId: entityId('diameter'),
        label: 'diameter',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('diameter') },
        isConstruction: false,
        startPointId: pointId('arc_left'),
        endPointId: pointId('arc_right'),
      },
    ])
    const sketch = createSketchRecord(sketchId, definition, [
      {
        kind: 'arc',
        entityId: entityId('upper_arc'),
        centerPosition: [0, 0],
        startPosition: [-1, 0],
        endPosition: [1, 0],
        sweepDirection: 'clockwise',
      },
      {
        kind: 'lineSegment',
        entityId: entityId('diameter'),
        startPosition: [-1, 0],
        endPosition: [1, 0],
      },
    ])
    const region = createRegion(sketchId, 'arc_cap', [
      {
        loopId: loopId('arc_outer'),
        role: 'outer',
        orientation: 'counterClockwise',
        segments: [
          {
            source: { kind: 'entity', entityId: entityId('upper_arc') },
            startPointId: pointId('arc_right'),
            endPointId: pointId('arc_left'),
          },
          {
            source: { kind: 'entity', entityId: entityId('diameter') },
            startPointId: pointId('arc_left'),
            endPointId: pointId('arc_right'),
          },
        ],
        boundaryPointIds: [pointId('arc_right'), pointId('arc_left')],
        isClosed: true,
      },
    ])

    const profile = buildRegionProfileFace(oc, { plane, sketch }, region)
    assertClose(await faceArea(profile.face), Math.PI / 2, 1e-5, 'Arc profile should support reversed loop traversal via boundary point IDs')
  }

  async function testInnerLoopHoleReducesFaceArea() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createSketchPlane()
    const sketchId = 'sketch_phase3_hole' as SketchId
    const points = [
      { id: pointId('outer_bl'), position: [0, 0] as const },
      { id: pointId('outer_br'), position: [6, 0] as const },
      { id: pointId('outer_tr'), position: [6, 6] as const },
      { id: pointId('outer_tl'), position: [0, 6] as const },
      { id: pointId('inner_bl'), position: [2, 2] as const },
      { id: pointId('inner_br'), position: [4, 2] as const },
      { id: pointId('inner_tr'), position: [4, 4] as const },
      { id: pointId('inner_tl'), position: [2, 4] as const },
    ]
    const outerNames = ['outer_bottom', 'outer_right', 'outer_top', 'outer_left'] as const
    const innerNames = ['inner_bottom', 'inner_right', 'inner_top', 'inner_left'] as const
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: 'lineSegment',
        entityId: entityId(outerNames[0]),
        label: outerNames[0],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(outerNames[0]) },
        isConstruction: false,
        startPointId: pointId('outer_bl'),
        endPointId: pointId('outer_br'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId(outerNames[1]),
        label: outerNames[1],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(outerNames[1]) },
        isConstruction: false,
        startPointId: pointId('outer_br'),
        endPointId: pointId('outer_tr'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId(outerNames[2]),
        label: outerNames[2],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(outerNames[2]) },
        isConstruction: false,
        startPointId: pointId('outer_tr'),
        endPointId: pointId('outer_tl'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId(outerNames[3]),
        label: outerNames[3],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(outerNames[3]) },
        isConstruction: false,
        startPointId: pointId('outer_tl'),
        endPointId: pointId('outer_bl'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId(innerNames[0]),
        label: innerNames[0],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(innerNames[0]) },
        isConstruction: false,
        startPointId: pointId('inner_bl'),
        endPointId: pointId('inner_br'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId(innerNames[1]),
        label: innerNames[1],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(innerNames[1]) },
        isConstruction: false,
        startPointId: pointId('inner_br'),
        endPointId: pointId('inner_tr'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId(innerNames[2]),
        label: innerNames[2],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(innerNames[2]) },
        isConstruction: false,
        startPointId: pointId('inner_tr'),
        endPointId: pointId('inner_tl'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId(innerNames[3]),
        label: innerNames[3],
        target: { kind: 'sketchEntity', sketchId, entityId: entityId(innerNames[3]) },
        isConstruction: false,
        startPointId: pointId('inner_tl'),
        endPointId: pointId('inner_bl'),
      },
    ])
    const sketch = createSketchRecord(sketchId, definition, [
      { kind: 'lineSegment', entityId: entityId(outerNames[0]), startPosition: [0, 0], endPosition: [6, 0] },
      { kind: 'lineSegment', entityId: entityId(outerNames[1]), startPosition: [6, 0], endPosition: [6, 6] },
      { kind: 'lineSegment', entityId: entityId(outerNames[2]), startPosition: [6, 6], endPosition: [0, 6] },
      { kind: 'lineSegment', entityId: entityId(outerNames[3]), startPosition: [0, 6], endPosition: [0, 0] },
      { kind: 'lineSegment', entityId: entityId(innerNames[0]), startPosition: [2, 2], endPosition: [4, 2] },
      { kind: 'lineSegment', entityId: entityId(innerNames[1]), startPosition: [4, 2], endPosition: [4, 4] },
      { kind: 'lineSegment', entityId: entityId(innerNames[2]), startPosition: [4, 4], endPosition: [2, 4] },
      { kind: 'lineSegment', entityId: entityId(innerNames[3]), startPosition: [2, 4], endPosition: [2, 2] },
    ])
    const segment = (name: string, start: string, end: string): RegionBoundarySegmentRecord => ({
      source: { kind: 'entity', entityId: entityId(name) },
      startPointId: pointId(start),
      endPointId: pointId(end),
    })
    const region = createRegion(sketchId, 'holed_rectangle', [
      {
        loopId: loopId('outer'),
        role: 'outer',
        orientation: 'counterClockwise',
        segments: [
          segment('outer_bottom', 'outer_bl', 'outer_br'),
          segment('outer_right', 'outer_br', 'outer_tr'),
          segment('outer_top', 'outer_tr', 'outer_tl'),
          segment('outer_left', 'outer_tl', 'outer_bl'),
        ],
        boundaryPointIds: [pointId('outer_bl'), pointId('outer_br'), pointId('outer_tr'), pointId('outer_tl')],
        isClosed: true,
      },
      {
        loopId: loopId('inner'),
        role: 'inner',
        orientation: 'clockwise',
        segments: [
          segment('inner_left', 'inner_bl', 'inner_tl'),
          segment('inner_top', 'inner_tl', 'inner_tr'),
          segment('inner_right', 'inner_tr', 'inner_br'),
          segment('inner_bottom', 'inner_br', 'inner_bl'),
        ],
        boundaryPointIds: [pointId('inner_bl'), pointId('inner_tl'), pointId('inner_tr'), pointId('inner_br')],
        isClosed: true,
      },
    ])

    const profile = buildRegionProfileFace(oc, { plane, sketch }, region)
    assertClose(await faceArea(profile.face), 32, 1e-5, 'Inner loops should subtract hole area from the outer face')
  }

  async function testCircleNestedInRectangleBuildsBothCells() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createSketchPlane()
    const sketchId = 'sketch_phase3_circle_cell' as SketchId
    const points = [
      { id: pointId('outer_bl'), position: [0, 0] as const },
      { id: pointId('outer_br'), position: [6, 0] as const },
      { id: pointId('outer_tr'), position: [6, 6] as const },
      { id: pointId('outer_tl'), position: [0, 6] as const },
      { id: pointId('circle_center'), position: [3, 3] as const },
    ]
    const definition = createSketchDefinition(sketchId, points, [
      {
        kind: 'lineSegment',
        entityId: entityId('outer_bottom'),
        label: 'outer_bottom',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('outer_bottom') },
        isConstruction: false,
        startPointId: pointId('outer_bl'),
        endPointId: pointId('outer_br'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId('outer_right'),
        label: 'outer_right',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('outer_right') },
        isConstruction: false,
        startPointId: pointId('outer_br'),
        endPointId: pointId('outer_tr'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId('outer_top'),
        label: 'outer_top',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('outer_top') },
        isConstruction: false,
        startPointId: pointId('outer_tr'),
        endPointId: pointId('outer_tl'),
      },
      {
        kind: 'lineSegment',
        entityId: entityId('outer_left'),
        label: 'outer_left',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('outer_left') },
        isConstruction: false,
        startPointId: pointId('outer_tl'),
        endPointId: pointId('outer_bl'),
      },
      {
        kind: 'circle',
        entityId: entityId('circle'),
        label: 'circle',
        target: { kind: 'sketchEntity', sketchId, entityId: entityId('circle') },
        isConstruction: false,
        centerPointId: pointId('circle_center'),
        radius: 1,
      },
    ])
    const sketch = createSketchRecord(sketchId, definition, [
      { kind: 'lineSegment', entityId: entityId('outer_bottom'), startPosition: [0, 0], endPosition: [6, 0] },
      { kind: 'lineSegment', entityId: entityId('outer_right'), startPosition: [6, 0], endPosition: [6, 6] },
      { kind: 'lineSegment', entityId: entityId('outer_top'), startPosition: [6, 6], endPosition: [0, 6] },
      { kind: 'lineSegment', entityId: entityId('outer_left'), startPosition: [0, 6], endPosition: [0, 0] },
      { kind: 'circle', entityId: entityId('circle'), centerPosition: [3, 3], solvedRadius: 1 },
    ])
    const segment = (name: string, start: string, end: string): RegionBoundarySegmentRecord => ({
      source: { kind: 'entity', entityId: entityId(name) },
      startPointId: pointId(start),
      endPointId: pointId(end),
    })
    const circleSegment: RegionBoundarySegmentRecord = {
      source: { kind: 'entity', entityId: entityId('circle') },
      startPointId: null,
      endPointId: null,
    }
    const outerCell = createRegion(sketchId, 'outer_with_circle_hole', [
      {
        loopId: loopId('outer'),
        role: 'outer',
        orientation: 'counterClockwise',
        segments: [
          segment('outer_bottom', 'outer_bl', 'outer_br'),
          segment('outer_right', 'outer_br', 'outer_tr'),
          segment('outer_top', 'outer_tr', 'outer_tl'),
          segment('outer_left', 'outer_tl', 'outer_bl'),
        ],
        boundaryPointIds: [pointId('outer_bl'), pointId('outer_br'), pointId('outer_tr'), pointId('outer_tl')],
        isClosed: true,
      },
      {
        loopId: loopId('circle_hole'),
        role: 'inner',
        orientation: 'clockwise',
        segments: [circleSegment],
        boundaryPointIds: [],
        isClosed: true,
      },
    ])
    const innerCell = createRegion(sketchId, 'inner_circle', [
      {
        loopId: loopId('circle_outer'),
        role: 'outer',
        orientation: 'counterClockwise',
        segments: [circleSegment],
        boundaryPointIds: [],
        isClosed: true,
      },
    ])

    const outerProfile = buildRegionProfileFace(oc, { plane, sketch }, outerCell)
    const innerProfile = buildRegionProfileFace(oc, { plane, sketch }, innerCell)

    assertClose(await faceArea(outerProfile.face), 36 - Math.PI, 1e-5, 'Outer cell should subtract the circular inner loop')
    assertClose(await faceArea(innerProfile.face), Math.PI, 1e-5, 'Inner circle cell should build as an independent profile')
  }

  async function testRejectsMultipleOuterLoops() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createSketchPlane()
    const sketchId = 'sketch_phase3_multiple_outer' as SketchId
    const definition = createSketchDefinition(sketchId, [], [])
    const sketch = createSketchRecord(sketchId, definition, [])
    const outerLoop = {
      loopId: loopId('outer_a'),
      role: 'outer' as const,
      orientation: 'counterClockwise' as const,
      segments: [],
      boundaryPointIds: [],
      isClosed: true,
    }
    const region = createRegion(sketchId, 'bad_region', [outerLoop, { ...outerLoop, loopId: loopId('outer_b') }])

    let thrownMessage: string | null = null

    try {
      buildRegionProfileFace(oc, { plane, sketch }, region)
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }

    assert(
      thrownMessage === `Region ${region.regionId} must contain exactly one outer loop.`,
      'Malformed regions with multiple outer loops must be rejected explicitly.',
    )
  }

  await testRectangleProfileBuildsExpectedArea()
  await testCircleProfileUsesSolvedCenterOffset()
  await testArcProfileRespectsReversedLoopTraversal()
  await testInnerLoopHoleReducesFaceArea()
  await testCircleNestedInRectangleBuildsBothCells()
  await testRejectsMultipleOuterLoops()

  console.log('OCC phase 3 sketch profile tests passed.')
})
