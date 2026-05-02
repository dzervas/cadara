import { expect, test } from 'bun:test'

import * as THREE from 'three'

import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import { computeSketchCameraFrame } from '@/infrastructure/viewport/sketch-camera-framing'

test('src/infrastructure/viewport/sketch-camera-framing.spec.ts', async () => {
  const xyPlane: SketchPlaneDefinition = {
    support: { kind: 'construction', constructionId: 'construction_plane-xy' },
    key: 'xy',
    frame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      normal: [0, 0, 1],
      linearUnit: 'documentLength',
      handedness: 'rightHanded',
    },
  }

  const yzPlane: SketchPlaneDefinition = {
    support: { kind: 'construction', constructionId: 'construction_plane-yz' },
    key: 'yz',
    frame: {
      origin: [0, 0, 0],
      xAxis: [0, 1, 0],
      yAxis: [0, 0, 1],
      normal: [1, 0, 0],
      linearUnit: 'documentLength',
      handedness: 'rightHanded',
    },
  }

  function createCamera() {
    return new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 1000)
  }

  function createOrthographicCamera() {
    const camera = new THREE.OrthographicCamera(-16, 16, 9, -9, 0.1, 1000)
    camera.position.set(0, 0, 24)
    return camera
  }

  function approx(actual: number, expected: number, epsilon = 1e-6) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon)
  }

  function approxVector(actual: THREE.Vector3, expected: THREE.Vector3, epsilon = 1e-6) {
    approx(actual.x, expected.x, epsilon)
    approx(actual.y, expected.y, epsilon)
    approx(actual.z, expected.z, epsilon)
  }

  function createPolylineRenderable(points: readonly (readonly [number, number, number])[]): SketchSessionDisplayRenderable {
    return {
      id: 'renderable_sketch_line_1',
      label: 'Line',
      target: null,
      geometry: {
        kind: 'polyline',
        points,
        isClosed: false,
      },
      linePattern: 'solid',
    }
  }

  function testExistingSketchFitsBoundsAndKeepsPlaneParallelView() {
    const camera = createCamera()
    const renderables = [
      createPolylineRenderable([
        [0, 0, 0],
        [10, 0, 0],
        [10, 5, 0],
        [0, 5, 0],
      ]),
    ]

    const frame = computeSketchCameraFrame({
      camera,
      plane: xyPlane,
      renderables,
    })

    approxVector(frame.target, new THREE.Vector3(5, 2.5, 0))
    approxVector(frame.up, new THREE.Vector3(0, 1, 0))
    expect(frame.position.z > frame.target.z).toBeTruthy()
    approx(frame.position.x, frame.target.x)
    approx(frame.position.y, frame.target.y)
  }

  function testEmptySketchFallsBackToDefaultPlaneExtent() {
    const camera = createCamera()

    const frame = computeSketchCameraFrame({
      camera,
      plane: xyPlane,
      renderables: [],
    })

    approxVector(frame.target, new THREE.Vector3(0, 0, 0))
    expect(frame.position.z > 20).toBeTruthy()
  }

  function testNonXyPlaneUsesStoredAxesForOrientation() {
    const camera = createCamera()
    const renderables = [createPolylineRenderable([[0, 0, 0], [0, 4, 6]])]

    const frame = computeSketchCameraFrame({
      camera,
      plane: yzPlane,
      renderables,
    })

    approxVector(frame.up, new THREE.Vector3(0, 0, 1))
    expect(frame.position.x > frame.target.x).toBeTruthy()
    approx(frame.position.y, frame.target.y)
    approx(frame.position.z, frame.target.z)
  }

  function testOrthographicSketchFitsBoundsWithZoom() {
    const camera = createOrthographicCamera()
    const renderables = [
      createPolylineRenderable([
        [-20, -5, 0],
        [20, -5, 0],
        [20, 5, 0],
        [-20, 5, 0],
      ]),
    ]

    const frame = computeSketchCameraFrame({
      camera,
      plane: xyPlane,
      renderables,
    })

    approxVector(frame.target, new THREE.Vector3(0, 0, 0))
    expect(frame.orthographicZoom !== undefined).toBeTruthy()
    approx(frame.orthographicZoom, 16 / 23)
    expect(frame.position.z > frame.target.z).toBeTruthy()
  }

  testExistingSketchFitsBoundsAndKeepsPlaneParallelView()
  testEmptySketchFallsBackToDefaultPlaneExtent()
  testNonXyPlaneUsesStoredAxesForOrientation()
  testOrthographicSketchFitsBoundsWithZoom()
})
