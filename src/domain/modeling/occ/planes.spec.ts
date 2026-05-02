import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import type { BodyId, ConstructionId, FaceId } from '@/contracts/shared/ids'
import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import {
  buildConstructionPlaneFromPlanarFace,
  getExtrusionNormalForPlanarFace,
} from '@/domain/modeling/occ/sketch-profile'
import {
  extractPlanarFaceData,
  getSignedDistanceToSketchPlane,
  mapSketchPointToWorld,
  mapWorldPointToSketch,
  toGpAx1,
  toGpAx3,
  toGpPlane,
  toGpPnt,
} from '@/domain/modeling/occ/planes'
import { getDefaultOpenCascadeInstance } from '@/domain/modeling/occ/runtime'

test('src/domain/modeling/occ/planes.spec.ts', async () => {  function assertClose(actual: number, expected: number, tolerance: number, message: string) {
    if (Math.abs(actual - expected) > tolerance) {
      throw new Error(`${message}: expected ${expected}, got ${actual}.`)
    }
  }

  function assertVecClose(
    actual: readonly [number, number, number],
    expected: readonly [number, number, number],
    tolerance: number,
    message: string,
  ) {
    assertClose(actual[0], expected[0], tolerance, `${message} (x)`)
    assertClose(actual[1], expected[1], tolerance, `${message} (y)`)
    assertClose(actual[2], expected[2], tolerance, `${message} (z)`)
  }

  function createRotatedSketchPlane(): SketchPlaneDefinition {
    const diagonal = Math.sqrt(0.5)

    return {
      support: {
        kind: 'construction',
        constructionId: 'construction_plane-phase2' as ConstructionId,
      },
      frame: {
        origin: [11, -7, 4],
        xAxis: [1, 0, 0],
        yAxis: [0, diagonal, -diagonal],
        normal: [0, diagonal, diagonal],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      key: null,
    }
  }

  function createPlanarFace(
    oc: Awaited<ReturnType<typeof getDefaultOpenCascadeInstance>>,
    plane: SketchPlaneDefinition,
  ) {
    const polygon = new oc.BRepBuilderAPI_MakePolygon_1()

    for (const point of [
      [-2, -1],
      [3, -1],
      [3, 2],
      [-2, 2],
    ] as const) {
      polygon.Add_1(toGpPnt(oc, mapSketchPointToWorld(plane, point)))
    }

    polygon.Close()
    expectTrue(polygon.IsDone(), 'Expected test polygon to build successfully.')

    const faceBuilder = new oc.BRepBuilderAPI_MakeFace_16(
      toGpPlane(oc, plane),
      polygon.Wire(),
      true,
    )
    expectTrue(faceBuilder.IsDone(), 'Expected test planar face to build successfully.')

    return faceBuilder.Face()
  }

  async function testWorldAndSketchTransformsRoundTrip() {
    const plane = createRotatedSketchPlane()
    const sketchPoint = [2.5, -3.25] as const
    const worldPoint = mapSketchPointToWorld(plane, sketchPoint)
    const recovered = mapWorldPointToSketch(plane, worldPoint)

    assertClose(recovered[0], sketchPoint[0], 1e-9, 'Sketch X should round-trip through world space.')
    assertClose(recovered[1], sketchPoint[1], 1e-9, 'Sketch Y should round-trip through world space.')

    const offsetPoint = [
      worldPoint[0] + plane.frame.normal[0] * 6,
      worldPoint[1] + plane.frame.normal[1] * 6,
      worldPoint[2] + plane.frame.normal[2] * 6,
    ] as const

    assertClose(
      getSignedDistanceToSketchPlane(plane, offsetPoint),
      6,
      1e-9,
      'Signed distance should track displacement along the sketch-plane normal.',
    )
  }

  async function testTransformHelpersRejectInvalidFrames() {
    const invalidPlane: SketchPlaneDefinition = {
      support: {
        kind: 'construction',
        constructionId: 'construction_plane-phase2-invalid' as ConstructionId,
      },
      frame: {
        origin: [0, 0, 0],
        xAxis: [2, 0, 0],
        yAxis: [0, 1, 0],
        normal: [0, 0, 1],
        linearUnit: 'documentLength',
        handedness: 'rightHanded',
      },
      key: null,
    }

    let worldMappingError: string | null = null
    let sketchMappingError: string | null = null
    let distanceError: string | null = null

    try {
      mapSketchPointToWorld(invalidPlane, [1, 2])
    } catch (error) {
      worldMappingError = error instanceof Error ? error.message : String(error)
    }

    try {
      mapWorldPointToSketch(invalidPlane, [1, 2, 3])
    } catch (error) {
      sketchMappingError = error instanceof Error ? error.message : String(error)
    }

    try {
      getSignedDistanceToSketchPlane(invalidPlane, [1, 2, 3])
    } catch (error) {
      distanceError = error instanceof Error ? error.message : String(error)
    }

    expectTrue(
      worldMappingError === 'Sketch plane frame xAxis must be unit length.',
      'World-space mapping must reject invalid sketch-plane frames before producing coordinates.',
    )
    expectTrue(
      sketchMappingError === 'Sketch plane frame xAxis must be unit length.',
      'Sketch-space mapping must reject invalid sketch-plane frames before projecting coordinates.',
    )
    expectTrue(
      distanceError === 'Sketch plane frame xAxis must be unit length.',
      'Signed-distance evaluation must reject invalid sketch-plane frames before returning distances.',
    )
  }

  async function testOccAxisAndPlaneBuildersPreserveFrameData() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createRotatedSketchPlane()
    const axis = toGpAx3(oc, plane)
    const normalAxis = toGpAx1(oc, plane)
    const gpPlane = toGpPlane(oc, plane)

    assertVecClose(
      [axis.Location().X(), axis.Location().Y(), axis.Location().Z()],
      plane.frame.origin,
      1e-9,
      'gp_Ax3 location should preserve the sketch-plane origin',
    )
    assertVecClose(
      [axis.Direction().X(), axis.Direction().Y(), axis.Direction().Z()],
      plane.frame.normal,
      1e-9,
      'gp_Ax3 direction should preserve the sketch-plane normal',
    )
    assertVecClose(
      [axis.XDirection().X(), axis.XDirection().Y(), axis.XDirection().Z()],
      plane.frame.xAxis,
      1e-9,
      'gp_Ax3 x direction should preserve the sketch-plane xAxis',
    )
    assertVecClose(
      [axis.YDirection().X(), axis.YDirection().Y(), axis.YDirection().Z()],
      plane.frame.yAxis,
      1e-9,
      'gp_Ax3 y direction should preserve the sketch-plane yAxis',
    )
    assertVecClose(
      [normalAxis.Location().X(), normalAxis.Location().Y(), normalAxis.Location().Z()],
      plane.frame.origin,
      1e-9,
      'gp_Ax1 location should preserve the sketch-plane origin',
    )
    assertVecClose(
      [normalAxis.Direction().X(), normalAxis.Direction().Y(), normalAxis.Direction().Z()],
      plane.frame.normal,
      1e-9,
      'gp_Ax1 direction should preserve the sketch-plane normal',
    )
    assertVecClose(
      [gpPlane.Position().Location().X(), gpPlane.Position().Location().Y(), gpPlane.Position().Location().Z()],
      plane.frame.origin,
      1e-9,
      'gp_Pln position should preserve the sketch-plane origin',
    )
    assertVecClose(
      [gpPlane.Position().Direction().X(), gpPlane.Position().Direction().Y(), gpPlane.Position().Direction().Z()],
      plane.frame.normal,
      1e-9,
      'gp_Pln position should preserve the sketch-plane normal',
    )
  }

  async function testPlanarFaceExtractionPreservesExplicitFrameData() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createRotatedSketchPlane()
    const face = createPlanarFace(oc, plane)
    const extracted = extractPlanarFaceData(oc, face)

    assertVecClose(extracted.frame.origin, plane.frame.origin, 1e-9, 'Planar-face extraction should preserve plane origin')
    assertVecClose(extracted.frame.normal, plane.frame.normal, 1e-9, 'Planar-face extraction should preserve plane normal')
    assertVecClose(extracted.frame.xAxis, plane.frame.xAxis, 1e-9, 'Planar-face extraction should preserve plane xAxis')
    assertVecClose(extracted.frame.yAxis, plane.frame.yAxis, 1e-9, 'Planar-face extraction should preserve plane yAxis')
  }

  async function testFaceBackedConstructionPlaneHelpersReusePlanarExtraction() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createRotatedSketchPlane()
    const face = createPlanarFace(oc, plane)
    const support = {
      kind: 'face' as const,
      bodyId: 'body_phase2' as BodyId,
      faceId: 'face_phase2' as FaceId,
    }

    const constructionPlane = buildConstructionPlaneFromPlanarFace(oc, face, support.faceId, support)
    const extrusionNormal = getExtrusionNormalForPlanarFace(oc, face, 'positive')

    assertVecClose(constructionPlane.frame.origin, plane.frame.origin, 1e-9, 'Face-backed construction planes should preserve extracted origin')
    assertVecClose(constructionPlane.frame.normal, plane.frame.normal, 1e-9, 'Face-backed construction planes should preserve extracted normal')
    assertVecClose(constructionPlane.frame.xAxis, plane.frame.xAxis, 1e-9, 'Face-backed construction planes should preserve extracted xAxis')
    assertVecClose(constructionPlane.frame.yAxis, plane.frame.yAxis, 1e-9, 'Face-backed construction planes should preserve extracted yAxis')
    assertVecClose(extrusionNormal, plane.frame.normal, 1e-9, 'Face-backed extrusion normals should preserve extracted planar normals')
  }

  async function testPlanarFaceExtractionRejectsNonPlanarFaces() {
    const oc = await getDefaultOpenCascadeInstance()
    const plane = createRotatedSketchPlane()
    const cylinder = new oc.gp_Cylinder_2(
      toGpAx3(oc, plane),
      2,
    )
    const pipeFaceBuilder = new oc.BRepBuilderAPI_MakeFace_10(
      cylinder,
      0,
      Math.PI / 2,
      0,
      5,
    )
    expectTrue(pipeFaceBuilder.IsDone(), 'Expected test cylindrical face to build successfully.')

    let thrownMessage: string | null = null

    try {
      extractPlanarFaceData(oc, pipeFaceBuilder.Face(), 'Expected non-planar rejection.')
    } catch (error) {
      thrownMessage = error instanceof Error ? error.message : String(error)
    }

    expectTrue(
      thrownMessage === 'Expected non-planar rejection.',
      'Planar-face extraction must reject non-planar faces with the supplied error message.',
    )
  }

  await testWorldAndSketchTransformsRoundTrip()
  await testTransformHelpersRejectInvalidFrames()
  await testOccAxisAndPlaneBuildersPreserveFrameData()
  await testPlanarFaceExtractionPreservesExplicitFrameData()
  await testFaceBackedConstructionPlaneHelpersReusePlanarExtraction()
  await testPlanarFaceExtractionRejectsNonPlanarFaces()

  console.log('OCC phase 2 plane and frame tests passed.')
})
