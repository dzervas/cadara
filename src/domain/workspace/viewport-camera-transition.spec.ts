import { test } from 'bun:test'
import { strict as assert } from 'node:assert'

import * as THREE from 'three'

import { createViewportCameraTransitionController } from '@/domain/workspace/viewport-camera-transition'
import type { ViewportCameraFrame } from '@/domain/workspace/viewport-projection'

test('src/domain/workspace/viewport-camera-transition.spec.ts', () => {
  function createFrame(input: {
    position: readonly [number, number, number]
    target?: readonly [number, number, number]
    projectionMode?: 'orthographic' | 'perspective'
    orthographicZoom?: number
  }): ViewportCameraFrame {
    const target = new THREE.Vector3(...(input.target ?? [0, 0, 0]))
    const position = new THREE.Vector3(...input.position)
    const cameraDistance = position.distanceTo(target)

    return {
      projectionMode: input.projectionMode ?? 'orthographic',
      position,
      target,
      up: new THREE.Vector3(0, 0, 1),
      cameraDistance,
      perspectiveDistance: cameraDistance,
      orthographicZoom: input.orthographicZoom ?? 1,
    }
  }

  function approx(actual: number, expected: number, epsilon = 1e-6) {
    assert(Math.abs(actual - expected) <= epsilon, `Expected ${actual} to be within ${epsilon} of ${expected}`)
  }

  {
    const controller = createViewportCameraTransitionController()
    const startFrame = createFrame({ position: [0, -10, 10], orthographicZoom: 1 })
    const endFrame = createFrame({ position: [10, 0, 10], orthographicZoom: 2 })

    controller.start({
      fromFrame: startFrame,
      toFrame: endFrame,
      durationMs: 200,
    })

    const firstStep = controller.advance(100)
    assert(firstStep, 'Advancing an active transition should return an interpolated frame.')
    assert(firstStep.completed === false, 'Halfway through the duration the transition should still be active.')
    assert(firstStep.frame.position.x > 0, 'Interpolation should move the camera toward the target frame.')
    assert(firstStep.frame.orthographicZoom > 1, 'Interpolation should blend projection-specific state.')

    const finalStep = controller.advance(100)
    assert(finalStep?.completed === true, 'Advancing to the full duration should complete the transition.')
    approx(finalStep?.frame.position.x ?? 0, 10)
    assert(controller.isActive() === false, 'Completed transitions should clear active controller state.')
  }

  {
    const controller = createViewportCameraTransitionController()
    const originalTarget = createFrame({ position: [0, -12, 12] })
    const retargeted = createFrame({
      position: [12, 0, 12],
      projectionMode: 'perspective',
      orthographicZoom: 0.8,
    })

    controller.start({
      fromFrame: createFrame({ position: [0, 0, 12] }),
      toFrame: originalTarget,
      durationMs: 300,
    })
    const inFlight = controller.advance(120)
    assert(inFlight, 'In-flight transitions should yield an intermediate frame.')

    controller.start({
      fromFrame: inFlight.frame,
      toFrame: retargeted,
      durationMs: 180,
    })

    assert.equal(controller.getTargetFrame()?.projectionMode, 'perspective')
    const completed = controller.advance(180)
    assert(completed?.completed === true, 'Retargeting should let the latest request win.')
    approx(completed?.frame.position.x ?? 0, 12)
  }

  {
    const controller = createViewportCameraTransitionController()
    controller.start({
      fromFrame: createFrame({ position: [0, -8, 8] }),
      toFrame: createFrame({ position: [0, 8, 8] }),
      durationMs: 250,
    })

    controller.cancel()
    assert(controller.advance(16) === null, 'Cancelling should drop any pending transition work.')
    assert(controller.isActive() === false, 'Cancelling should clear active controller state.')
  }
})
