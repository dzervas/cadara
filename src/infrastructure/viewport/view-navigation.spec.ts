import { expect, test } from 'bun:test'

import * as THREE from 'three'

import {
  VIEW_NAVIGATION_PRESETS,
  getViewNavigationDirection,
  snapCameraToPreset,
  snapCameraToVector,
} from '@/infrastructure/viewport/view-navigation'
import type { ViewportCameraControls } from '@/infrastructure/viewport/viewport-camera-controls'
import { getViewportCameraProjectionMode } from '@/infrastructure/viewport/viewport-projection'

test('src/infrastructure/viewport/view-navigation.spec.ts', async () => {
  function approx(actual: number, expected: number, epsilon = 1e-6) {
    expect(Math.abs(actual - expected)).toBeLessThanOrEqual(epsilon)
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
    expect(updateCalls).toBe(1)
  }

  {
    expect(VIEW_NAVIGATION_PRESETS.front.label).toBe('Front')
    expect(VIEW_NAVIGATION_PRESETS.back.kind).toBe('face')
    expect(VIEW_NAVIGATION_PRESETS.frontRightTop.kind).toBe('corner')

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
    expect(updateCalls).toBe(1)
  }

  {
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 1000)
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

    expect(getViewportCameraProjectionMode(camera)).toBe('orthographic')
    approxVector(camera.position, controls.target.clone().add(expectedDirection))
    expect(updateCalls).toBe(1)
  }
})
