import { expect, test } from 'bun:test'

import * as THREE from 'three'

import type { ViewportCameraControls } from '@/infrastructure/viewport/viewport-camera-controls'
import {
  DEFAULT_VIEWPORT_PROJECTION_MODE,
  applyViewportRenderableFitFrame,
  applyViewportCameraFrame,
  captureViewportCameraFrame,
  computeViewportRenderableFitFrame,
  createViewportCamera,
  getDefaultViewportCameraFrame,
  getViewportCameraProjectionMode,
} from '@/infrastructure/viewport/viewport-projection'
import type { RenderableEntityRecord } from '@/contracts/render/schema'

test('src/infrastructure/viewport/viewport-projection.spec.ts', () => {
  function approx(actual: number, expected: number, epsilon = 1e-6) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon)
  }

  function approxVector(actual: THREE.Vector3, expected: THREE.Vector3, epsilon = 1e-6) {
    approx(actual.x, expected.x, epsilon)
    approx(actual.y, expected.y, epsilon)
    approx(actual.z, expected.z, epsilon)
  }

  function createControls(target: THREE.Vector3): ViewportCameraControls {
    return {
      target,
      update: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }
  }

  function createBodyMeshRenderable(points: Array<readonly [number, number, number]>): RenderableEntityRecord {
    return {
      id: 'renderable_body_face',
      label: 'Imported face',
      ownerBodyId: 'body_imported',
      ownerFeatureId: 'feature_extrude-1',
      binding: {
        pickId: 'pick_body_face',
        pickPriority: 20,
        target: { kind: 'face', bodyId: 'body_imported', faceId: 'face_imported_1' },
        topology: 'face',
        semanticClass: 'bodyFace',
      },
      geometry: {
        kind: 'mesh',
        vertexPositions: points,
        vertexNormals: null,
        triangleIndices: [[0, 1, 2]],
      },
    }
  }

  {
    const camera = createViewportCamera(DEFAULT_VIEWPORT_PROJECTION_MODE, 16 / 9)

    expect(camera instanceof THREE.OrthographicCamera).toBeTruthy()
    expect(getViewportCameraProjectionMode(camera)).toBe('orthographic')
    approxVector(camera.position, new THREE.Vector3(14, -16, 28))
  }

  {
    const orthographicCamera = createViewportCamera('orthographic', 16 / 9)
    const perspectiveCamera = createViewportCamera('perspective', 16 / 9)
    const controls = createControls(new THREE.Vector3(-2, 3, 5))

    orthographicCamera.position.set(6, -7, 18)
    orthographicCamera.zoom = 2.5
    orthographicCamera.updateProjectionMatrix()
    orthographicCamera.up.set(0, 0, 1)
    orthographicCamera.lookAt(controls.target)

    const frame = captureViewportCameraFrame(orthographicCamera, controls)
    applyViewportCameraFrame(perspectiveCamera, controls, frame)
    const expectedPerspectiveDistance = (32 / 2.5) / (2 * Math.tan(THREE.MathUtils.degToRad(45) / 2))

    expect(getViewportCameraProjectionMode(perspectiveCamera)).toBe('perspective')
    approxVector(controls.target, new THREE.Vector3(-2, 3, 5))
    approxVector(perspectiveCamera.up, new THREE.Vector3(0, 0, 1))
    expect(frame.orthographicZoom === 2.5).toBeTruthy()
    approx(perspectiveCamera.position.distanceTo(controls.target), expectedPerspectiveDistance)
  }

  {
    const perspectiveCamera = createViewportCamera('perspective', 16 / 9)
    const orthographicCamera = createViewportCamera('orthographic', 16 / 9)
    const controls = createControls(new THREE.Vector3(4, -1, 2))

    perspectiveCamera.position.set(12, -9, 11)
    perspectiveCamera.lookAt(controls.target)

    const frame = captureViewportCameraFrame(perspectiveCamera, controls)
    applyViewportCameraFrame(orthographicCamera, controls, frame)
    const expectedOrthographicZoom = 32 / (
      2 * perspectiveCamera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(45) / 2)
    )

    expect(frame.projectionMode).toBe('perspective')
    approx(orthographicCamera.zoom, expectedOrthographicZoom)
    approxVector(controls.target, new THREE.Vector3(4, -1, 2))
  }

  {
    const frame = getDefaultViewportCameraFrame()

    approxVector(frame.target, new THREE.Vector3(0, 0, 4))
    approxVector(frame.up, new THREE.Vector3(0, 0, 1))
    expect(frame.projectionMode).toBe('orthographic')
    expect(frame.orthographicZoom).toBe(1)
  }

  {
    const camera = createViewportCamera('orthographic', 1)
    const controls = createControls(new THREE.Vector3(0, 0, 4))
    const renderables = [
      createBodyMeshRenderable([
        [1000, 2000, -20],
        [2000, 2000, -20],
        [2000, 3000, 980],
        [1000, 3000, 980],
      ]),
    ]
    const frame = computeViewportRenderableFitFrame({ camera, controls, renderables })

    expect(frame).toBeTruthy()
    approxVector(frame.target, new THREE.Vector3(1500, 2500, 480))
    expect(frame.orthographicZoom < 1).toBeTruthy()

    const applied = applyViewportRenderableFitFrame({ camera, controls, renderables })
    expect(applied).toBeTruthy()
    approxVector(controls.target, new THREE.Vector3(1500, 2500, 480))
    expect(camera.far > 1000).toBeTruthy()
  }
})
