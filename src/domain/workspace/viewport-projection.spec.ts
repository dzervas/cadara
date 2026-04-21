import { test } from 'bun:test'
import { strict as assert } from 'node:assert'

import * as THREE from 'three'

import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'
import {
  DEFAULT_VIEWPORT_PROJECTION_MODE,
  applyViewportCameraFrame,
  captureViewportCameraFrame,
  createViewportCamera,
  getDefaultViewportCameraFrame,
  getViewportCameraProjectionMode,
} from '@/domain/workspace/viewport-projection'

test('src/domain/workspace/viewport-projection.spec.ts', () => {
  function approx(actual: number, expected: number, epsilon = 1e-6) {
    assert(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`)
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

  {
    const camera = createViewportCamera(DEFAULT_VIEWPORT_PROJECTION_MODE, 16 / 9)

    assert(camera instanceof THREE.OrthographicCamera, 'Viewport projection should default to orthographic.')
    assert.equal(getViewportCameraProjectionMode(camera), 'orthographic')
    approxVector(camera.position, new THREE.Vector3(14, -16, 28))
  }

  {
    const orthographicCamera = createViewportCamera('orthographic', 16 / 9)
    const perspectiveCamera = createViewportCamera('perspective', 16 / 9)
    const controls = createControls(new THREE.Vector3(-2, 3, 5))

    orthographicCamera.position.set(6, -7, 18)
    orthographicCamera.up.set(0, 0, 1)
    orthographicCamera.lookAt(controls.target)

    const frame = captureViewportCameraFrame(orthographicCamera, controls)
    applyViewportCameraFrame(perspectiveCamera, controls, frame)

    assert.equal(getViewportCameraProjectionMode(perspectiveCamera), 'perspective')
    approxVector(perspectiveCamera.position, new THREE.Vector3(6, -7, 18))
    approxVector(controls.target, new THREE.Vector3(-2, 3, 5))
    approxVector(perspectiveCamera.up, new THREE.Vector3(0, 0, 1))
  }

  {
    const frame = getDefaultViewportCameraFrame()

    approxVector(frame.target, new THREE.Vector3(0, 0, 4))
    approxVector(frame.up, new THREE.Vector3(0, 0, 1))
  }
})
