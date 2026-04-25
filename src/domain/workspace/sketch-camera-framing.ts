import * as THREE from 'three'

import type { SketchPlaneDefinition } from '@/contracts/shared/sketch-plane'
import type { SketchSessionDisplayRenderable } from '@/domain/editor/sketch-session'
import {
  createViewportCameraFrame,
  type ViewportCamera,
  type ViewportCameraFrame,
} from '@/domain/workspace/viewport-projection'

const DEFAULT_HALF_EXTENT = 10
const MIN_HALF_EXTENT = 1
const FRAME_PADDING_FACTOR = 1.15
const MIN_CAMERA_DISTANCE = 8

interface ComputeSketchCameraFrameInput {
  camera: ViewportCamera
  plane: SketchPlaneDefinition
  renderables: SketchSessionDisplayRenderable[]
}

export function computeSketchCameraFrame({
  camera,
  plane,
  renderables,
}: ComputeSketchCameraFrameInput): ViewportCameraFrame {
  const origin = toVector3(plane.frame.origin)
  const xAxis = toVector3(plane.frame.xAxis).normalize()
  const yAxis = toVector3(plane.frame.yAxis).normalize()
  const normal = toVector3(plane.frame.normal).normalize()

  const projected = collectRenderableWorldPoints(renderables).map((point) => {
    const delta = point.clone().sub(origin)

    return {
      x: delta.dot(xAxis),
      y: delta.dot(yAxis),
    }
  })

  if (projected.length === 0) {
    projected.push(
      { x: -DEFAULT_HALF_EXTENT, y: -DEFAULT_HALF_EXTENT },
      { x: -DEFAULT_HALF_EXTENT, y: DEFAULT_HALF_EXTENT },
      { x: DEFAULT_HALF_EXTENT, y: -DEFAULT_HALF_EXTENT },
      { x: DEFAULT_HALF_EXTENT, y: DEFAULT_HALF_EXTENT },
    )
  }

  let minX = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  for (const point of projected) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  const centerX = (minX + maxX) / 2
  const centerY = (minY + maxY) / 2
  const halfWidth = Math.max((maxX - minX) / 2, MIN_HALF_EXTENT) * FRAME_PADDING_FACTOR
  const halfHeight = Math.max((maxY - minY) / 2, MIN_HALF_EXTENT) * FRAME_PADDING_FACTOR

  const target = origin
    .clone()
    .addScaledVector(xAxis, centerX)
    .addScaledVector(yAxis, centerY)

  if (camera instanceof THREE.OrthographicCamera) {
    const halfFrustumWidth = Math.max((camera.right - camera.left) / 2, MIN_HALF_EXTENT)
    const halfFrustumHeight = Math.max((camera.top - camera.bottom) / 2, MIN_HALF_EXTENT)
    const orthographicZoom = Math.max(
      Math.min(halfFrustumWidth / halfWidth, halfFrustumHeight / halfHeight),
      0.01,
    )
    const distance = Math.max(camera.position.distanceTo(target), MIN_CAMERA_DISTANCE)

    return createViewportCameraFrame({
      camera,
      target,
      position: target.clone().addScaledVector(normal, distance),
      up: yAxis,
      orthographicZoom,
    })
  }

  const fovRadians = THREE.MathUtils.degToRad(camera.fov)
  const safeAspect = camera.aspect > 0 ? camera.aspect : 1
  const fitHeightDistance = halfHeight / Math.tan(fovRadians / 2)
  const fitWidthDistance = halfWidth / (Math.tan(fovRadians / 2) * safeAspect)
  const distance = Math.max(fitHeightDistance, fitWidthDistance, MIN_CAMERA_DISTANCE)

  const position = target.clone().addScaledVector(normal, distance)

  return createViewportCameraFrame({
    camera,
    target,
    position,
    up: yAxis,
  })
}

function collectRenderableWorldPoints(renderables: SketchSessionDisplayRenderable[]): THREE.Vector3[] {
  const points: THREE.Vector3[] = []

  for (const renderable of renderables) {
    if (renderable.geometry.kind === 'marker') {
      points.push(toVector3(renderable.geometry.position))
      continue
    }

    if (renderable.geometry.kind === 'polyline') {
      points.push(...renderable.geometry.points.map((point) => toVector3(point)))
    }
  }

  return points
}

function toVector3(value: readonly [number, number, number]) {
  return new THREE.Vector3(value[0], value[1], value[2])
}
