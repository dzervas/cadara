import { test } from 'bun:test'
import { strict as assert } from 'node:assert'

import * as THREE from 'three'

import { snapCameraToVector } from '@/domain/workspace/view-navigation'
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
})
