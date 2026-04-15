import { test } from 'bun:test'
import { strict as assert } from 'node:assert'

import * as THREE from 'three'

import {
  VIEW_NAVIGATION_PRESETS,
  getViewNavigationDirection,
  snapCameraToPreset,
  snapCameraToVector,
} from '@/domain/workspace/view-navigation'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'

test('src/domain/workspace/view-navigation.spec.ts', async () => {
  function approx(actual: number, expected: number, epsilon = 1e-6) {
    assert(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`)
  }

  function approxVector(actual: THREE.Vector3, expected: THREE.Vector3, epsilon = 1e-6) {
    approx(actual.x, expected.x, epsilon)
    approx(actual.y, expected.y, epsilon)
    approx(actual.z, expected.z, epsilon)
  }

  {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(14, -16, 28)

    let updateCalls = 0
    const controls: ViewportCameraControls = {
      target: new THREE.Vector3(0, 0, 4),
      update: () => {
        updateCalls += 1
      },
    }

    snapCameraToVector({
      camera,
      controls,
      direction: new THREE.Vector3(0, 0, 1),
    })

    approxVector(camera.position, new THREE.Vector3(0, 0, 36.0624390837628))
    approxVector(controls.target, new THREE.Vector3(0, 0, 4))
    assert.equal(updateCalls, 1, 'Camera snapping should request a control update exactly once.')
  }

  {
    assert.equal(VIEW_NAVIGATION_PRESETS.front.label, 'Front')
    assert.equal(VIEW_NAVIGATION_PRESETS.back.kind, 'face')
    assert.equal(VIEW_NAVIGATION_PRESETS.frontRightTop.kind, 'corner')

    approxVector(getViewNavigationDirection('frontRightTop'), new THREE.Vector3(1, -1, 1))
  }

  {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(-10, 8, 14)

    let updateCalls = 0
    const controls: ViewportCameraControls = {
      target: new THREE.Vector3(2, -3, 1),
      update: () => {
        updateCalls += 1
      },
    }

    snapCameraToPreset({
      camera,
      controls,
      presetId: 'front',
    })

    const expectedDistance = Math.max(
      new THREE.Vector3(-10, 8, 14).distanceTo(new THREE.Vector3(2, -3, 1)),
      12,
    )

    approxVector(
      camera.position,
      new THREE.Vector3(2, -3, 1).add(new THREE.Vector3(0, -1, 0).multiplyScalar(expectedDistance)),
    )
    assert.equal(updateCalls, 1, 'Preset face snaps should reuse the shared snap path.')
  }

  {
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000)
    camera.position.set(18, -4, 20)

    let updateCalls = 0
    const controls: ViewportCameraControls = {
      target: new THREE.Vector3(1, 2, 3),
      update: () => {
        updateCalls += 1
      },
    }

    const expectedDistance = Math.max(camera.position.distanceTo(controls.target), 12)
    const expectedDirection = new THREE.Vector3(1, -1, 1).normalize().multiplyScalar(expectedDistance)

    snapCameraToPreset({
      camera,
      controls,
      presetId: 'frontRightTop',
    })

    approxVector(camera.position, controls.target.clone().add(expectedDirection))
    assert.equal(updateCalls, 1, 'Corner presets should snap through the same shared helper.')
  }
})
