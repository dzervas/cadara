import { test } from 'bun:test'

import {
  cancelCoalescedSketchGeometryDragMove,
  createViewportBvhSceneKey,
  scheduleCoalescedSketchGeometryDragMove,
} from '@/components/cad/three-cad-viewport-helpers'

test('src/components/cad/three-cad-viewport.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function testDragMovesCoalesceToLatestPoint() {
    const pendingPointRef = { current: null as readonly [number, number] | null }
    const pendingFrameIdRef = { current: null as number | null }
    const frameCallbacks = new Map<number, FrameRequestCallback>()
    const movedPoints: readonly [number, number][] = []
    let nextFrameId = 1

    const schedule = (point: readonly [number, number]) => scheduleCoalescedSketchGeometryDragMove({
      point,
      pendingPointRef,
      pendingFrameIdRef,
      requestFrame: (callback) => {
        const frameId = nextFrameId
        nextFrameId += 1
        frameCallbacks.set(frameId, callback)
        return frameId
      },
      isDragActive: () => true,
      onMove: (latestPoint) => movedPoints.push(latestPoint),
    })

    schedule([1, 1])
    schedule([2, 2])
    schedule([3, 3])

    assert(frameCallbacks.size === 1, 'Drag scheduler should request one frame for multiple pending moves.')
    frameCallbacks.get(1)?.(0)

    assert(movedPoints.length === 1, 'Drag scheduler should dispatch once per frame.')
    assert(movedPoints[0]?.[0] === 3 && movedPoints[0]?.[1] === 3, 'Drag scheduler should dispatch the latest point.')
  }

  function testDragMoveCancellationDropsPendingFrame() {
    const pendingPointRef = { current: null as readonly [number, number] | null }
    const pendingFrameIdRef = { current: null as number | null }
    const frameCallbacks = new Map<number, FrameRequestCallback>()
    const cancelledFrames: number[] = []
    const movedPoints: readonly [number, number][] = []

    scheduleCoalescedSketchGeometryDragMove({
      point: [4, 5],
      pendingPointRef,
      pendingFrameIdRef,
      requestFrame: (callback) => {
        frameCallbacks.set(7, callback)
        return 7
      },
      isDragActive: () => true,
      onMove: (latestPoint) => movedPoints.push(latestPoint),
    })
    cancelCoalescedSketchGeometryDragMove({
      pendingPointRef,
      pendingFrameIdRef,
      cancelFrame: (frameId) => cancelledFrames.push(frameId),
    })
    frameCallbacks.get(7)?.(0)

    assert(cancelledFrames[0] === 7, 'Drag cancellation should cancel the pending frame.')
    assert(pendingFrameIdRef.current === null, 'Drag cancellation should clear the pending frame id.')
    assert(pendingPointRef.current === null, 'Drag cancellation should clear the pending point.')
    assert(movedPoints.length === 0, 'Cancelled drag frame should not dispatch a stale move.')
  }

  function testSketchBvhKeyIgnoresPositionalPolylineUpdates() {
    const renderable = {
      id: 'renderable_sketch_line_0',
      label: 'Line',
      geometry: {
        kind: 'polyline',
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        isClosed: false,
      },
      target: { kind: 'sketchEntity', sketchId: 'sketch_primary', entityId: 'sketch_entity_ab' },
      linePattern: 'solid',
      role: 'local',
    } as const
    const movedRenderable = {
      ...renderable,
      geometry: {
        ...renderable.geometry,
        points: [
          [3, 4, 0],
          [5, 4, 0],
        ],
      },
    } as const
    const dashedRenderable = {
      ...movedRenderable,
      linePattern: 'dashed',
    } as const

    assert(
      createViewportBvhSceneKey([], [renderable]) === createViewportBvhSceneKey([], [movedRenderable]),
      'Sketch BVH key should stay stable for positional-only polyline updates.',
    )
    assert(
      createViewportBvhSceneKey([], [movedRenderable]) !== createViewportBvhSceneKey([], [dashedRenderable]),
      'Sketch BVH key should change when structural line styling changes.',
    )
  }

  testDragMovesCoalesceToLatestPoint()
  testDragMoveCancellationDropsPendingFrame()
  testSketchBvhKeyIgnoresPositionalPolylineUpdates()
})
