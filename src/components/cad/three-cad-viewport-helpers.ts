import * as THREE from 'three'

import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
} from '@/domain/editor/schema'
import { getBoundTarget } from '@/domain/workspace/render-picking'
import type { ViewportRenderableRecord } from '@/domain/workspace/viewport-renderables'

interface MutableRef<T> {
  current: T
}

interface ViewportSize {
  width: number
  height: number
}

interface RenderIdleSample {
  delta: number
  isEditorIdle: boolean
  sceneKey: string
}

export function scheduleCoalescedSketchGeometryDragMove(input: {
  point: readonly [number, number]
  pendingPointRef: MutableRef<readonly [number, number] | null>
  pendingFrameIdRef: MutableRef<number | null>
  requestFrame: (callback: FrameRequestCallback) => number
  isDragActive: () => boolean
  onMove: (point: readonly [number, number]) => void
}) {
  input.pendingPointRef.current = input.point

  if (input.pendingFrameIdRef.current !== null) {
    return
  }

  input.pendingFrameIdRef.current = input.requestFrame(() => {
    input.pendingFrameIdRef.current = null
    const point = input.pendingPointRef.current
    input.pendingPointRef.current = null

    if (point && input.isDragActive()) {
      input.onMove(point)
    }
  })
}

export function cancelCoalescedSketchGeometryDragMove(input: {
  pendingPointRef: MutableRef<readonly [number, number] | null>
  pendingFrameIdRef: MutableRef<number | null>
  cancelFrame: (frameId: number) => void
}) {
  if (input.pendingFrameIdRef.current !== null) {
    input.cancelFrame(input.pendingFrameIdRef.current)
  }

  input.pendingFrameIdRef.current = null
  input.pendingPointRef.current = null
}

export function createViewportBvhSceneKey(
  renderables: readonly ViewportRenderableRecord[],
  sketchDisplayRenderables: readonly SketchSessionDisplayRenderable[],
) {
  return [
    ...renderables.map(({ origin, renderable }) => {
      return `${origin}:${renderable.id}:${renderable.binding.pickId}:${getGeometryToken(renderable.geometry)}`
    }),
    ...sketchDisplayRenderables.map((renderable) => {
      return [
        'sketch',
        renderable.id,
        renderable.linePattern,
        renderable.semanticClass ?? 'default',
        renderable.target ? JSON.stringify(renderable.target) : 'none',
        getSketchStructuralGeometryToken(renderable.geometry),
      ].join(':')
    }),
  ].join('|')
}

export function projectSceneTargetCentroidToViewport(input: {
  root: THREE.Object3D | null
  camera: THREE.Camera | null
  objectId: string
  viewport: ViewportSize
}) {
  if (!input.root || !input.camera || input.viewport.width <= 0 || input.viewport.height <= 0) {
    return null
  }

  const targetBox = new THREE.Box3()
  let foundTarget = false

  input.root.traverse((object) => {
    const target = getBoundTarget(object)

    if (!target) {
      return
    }

    const matchesTarget =
      object.name === input.objectId
      || getPrimitiveRefLabel(target) === input.objectId
      || getPrimitiveRefKey(target) === input.objectId

    if (!matchesTarget) {
      return
    }

    const objectBox = new THREE.Box3().setFromObject(object)
    if (objectBox.isEmpty()) {
      return
    }

    targetBox.union(objectBox)
    foundTarget = true
  })

  if (!foundTarget || targetBox.isEmpty()) {
    return null
  }

  input.camera.updateMatrixWorld()
  const centroid = targetBox.getCenter(new THREE.Vector3())
  const projected = centroid.project(input.camera)

  if (
    projected.x < -1
    || projected.x > 1
    || projected.y < -1
    || projected.y > 1
    || projected.z < -1
    || projected.z > 1
  ) {
    return null
  }

  return {
    x: ((projected.x + 1) / 2) * input.viewport.width,
    y: ((1 - projected.y) / 2) * input.viewport.height,
  }
}

export function createRenderIdleTracker(options: {
  maxStableDelta?: number
  requiredStableFrames?: number
} = {}) {
  const maxStableDelta = options.maxStableDelta ?? 0.5
  const requiredStableFrames = options.requiredStableFrames ?? 3
  let stableFrameCount = 0
  let lastSceneKey: string | null = null

  return {
    update(sample: RenderIdleSample) {
      const sceneChanged = lastSceneKey !== null && lastSceneKey !== sample.sceneKey
      const visuallyStable = sample.delta <= maxStableDelta && !sceneChanged

      lastSceneKey = sample.sceneKey

      if (!sample.isEditorIdle || !visuallyStable) {
        stableFrameCount = 0
        return false
      }

      stableFrameCount += 1
      return stableFrameCount >= requiredStableFrames
    },
  }
}

export function getSketchStructuralGeometryToken(geometry: SketchSessionDisplayRenderable['geometry']) {
  switch (geometry.kind) {
    case 'mesh':
      return `mesh:${geometry.vertexPositions.length}:${geometry.triangleIndices.length}`
    case 'polyline':
      return `polyline:${geometry.isClosed ? 'closed' : 'open'}:${geometry.points.length}`
    case 'marker':
      return `marker:${geometry.displayRadius}`
  }
}

function getGeometryToken(
  geometry: ViewportRenderableRecord['renderable']['geometry'] | SketchSessionDisplayRenderable['geometry'],
) {
  switch (geometry.kind) {
    case 'mesh':
      return [
        'mesh',
        geometry.vertexPositions.flat().join(','),
        geometry.triangleIndices.flat().join(','),
        geometry.vertexNormals ? geometry.vertexNormals.flat().join(',') : 'auto-normals',
      ].join(':')
    case 'polyline':
      return [
        'polyline',
        geometry.points.flat().join(','),
        geometry.isClosed ? 'closed' : 'open',
      ].join(':')
    case 'marker':
      return [
        'marker',
        geometry.position.join(','),
        geometry.displayRadius,
      ].join(':')
  }
}
