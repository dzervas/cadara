import * as THREE from 'three'

import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'

export type ViewportProjectionMode = 'orthographic' | 'perspective'
export type ViewportCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera

export interface ViewportCameraFrame {
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
  orthographicZoom?: number
}

export interface ViewportRenderableFitFrame {
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
  radius: number
  distance: number
  orthographicZoom?: number
}

export const DEFAULT_VIEWPORT_PROJECTION_MODE: ViewportProjectionMode = 'orthographic'

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(14, -16, 28)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 4)
const DEFAULT_CAMERA_UP = new THREE.Vector3(0, 0, 1)
const ORTHOGRAPHIC_FRUSTUM_HEIGHT = 32
const FIT_PADDING_FACTOR = 1.18
const MIN_FIT_HALF_EXTENT = 1
const MIN_FIT_CAMERA_DISTANCE = 8

export function createViewportCamera(mode: ViewportProjectionMode, aspect: number): ViewportCamera {
  const camera = mode === 'orthographic'
    ? new THREE.OrthographicCamera(0, 0, 0, 0, 0.1, 1000)
    : new THREE.PerspectiveCamera(45, 1, 0.1, 1000)

  updateViewportCameraAspect(camera, aspect)
  applyViewportCameraFrameToCamera(camera, getDefaultViewportCameraFrame())

  return camera
}

export function updateViewportCameraAspect(camera: ViewportCamera, aspect: number) {
  const safeAspect = aspect > 0 ? aspect : 1

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = safeAspect
  } else {
    const halfHeight = ORTHOGRAPHIC_FRUSTUM_HEIGHT / 2
    const halfWidth = halfHeight * safeAspect
    camera.left = -halfWidth
    camera.right = halfWidth
    camera.top = halfHeight
    camera.bottom = -halfHeight
  }

  camera.updateProjectionMatrix()
}

export function getViewportCameraProjectionMode(camera: ViewportCamera): ViewportProjectionMode {
  return camera instanceof THREE.OrthographicCamera ? 'orthographic' : 'perspective'
}

export function getDefaultViewportCameraFrame(): ViewportCameraFrame {
  return {
    position: DEFAULT_CAMERA_POSITION.clone(),
    target: DEFAULT_CAMERA_TARGET.clone(),
    up: DEFAULT_CAMERA_UP.clone(),
  }
}

export function captureViewportCameraFrame(
  camera: ViewportCamera,
  controls: ViewportCameraControls,
): ViewportCameraFrame {
  return {
    position: camera.position.clone(),
    target: controls.target.clone(),
    up: camera.up.clone(),
  }
}

export function applyViewportCameraFrame(
  camera: ViewportCamera,
  controls: ViewportCameraControls,
  frame: ViewportCameraFrame,
) {
  applyViewportCameraFrameToCamera(camera, frame)
  if (camera instanceof THREE.OrthographicCamera && frame.orthographicZoom) {
    camera.zoom = frame.orthographicZoom
    camera.updateProjectionMatrix()
  }
  controls.target.copy(frame.target)
  controls.update()
}

export function applyViewportCameraFrameToCamera(
  camera: ViewportCamera,
  frame: ViewportCameraFrame,
) {
  camera.up.copy(frame.up)
  camera.position.copy(frame.position)
  camera.lookAt(frame.target)
  camera.updateMatrixWorld()
}

export function applyViewportRenderableFitFrame(input: {
  camera: ViewportCamera
  controls: ViewportCameraControls
  renderables: readonly RenderableEntityRecord[]
}) {
  const frame = computeViewportRenderableFitFrame(input)
  if (!frame) {
    return false
  }

  input.camera.up.copy(frame.up)
  input.camera.position.copy(frame.position)
  input.camera.near = 0.1
  input.camera.far = Math.max(1000, frame.distance + frame.radius * 4)

  if (input.camera instanceof THREE.OrthographicCamera && frame.orthographicZoom) {
    input.camera.zoom = frame.orthographicZoom
  }

  input.camera.updateProjectionMatrix()
  input.controls.target.copy(frame.target)
  input.camera.lookAt(frame.target)
  input.camera.updateMatrixWorld()
  input.controls.update()
  return true
}

export function computeViewportRenderableFitFrame(input: {
  camera: ViewportCamera
  controls: ViewportCameraControls
  renderables: readonly RenderableEntityRecord[]
}): ViewportRenderableFitFrame | null {
  const points = collectBodyRenderablePoints(input.renderables)
  if (points.length === 0) {
    return null
  }

  const bounds = new THREE.Box3().setFromPoints(points)
  if (bounds.isEmpty()) {
    return null
  }

  const target = bounds.getCenter(new THREE.Vector3())
  const radius = Math.max(...points.map((point) => point.distanceTo(target)), MIN_FIT_HALF_EXTENT)
  let direction = input.camera.position.clone().sub(input.controls.target)
  if (direction.lengthSq() < 1e-6) {
    direction = DEFAULT_CAMERA_POSITION.clone().sub(DEFAULT_CAMERA_TARGET)
  }
  direction.normalize()

  input.camera.updateMatrixWorld()
  const rightAxis = new THREE.Vector3(1, 0, 0).applyQuaternion(input.camera.quaternion).normalize()
  const upAxis = input.camera.up.clone().normalize()
  const projected = points.map((point) => {
    const delta = point.clone().sub(target)
    return {
      x: delta.dot(rightAxis),
      y: delta.dot(upAxis),
    }
  })
  const minX = Math.min(...projected.map((point) => point.x))
  const maxX = Math.max(...projected.map((point) => point.x))
  const minY = Math.min(...projected.map((point) => point.y))
  const maxY = Math.max(...projected.map((point) => point.y))
  const halfWidth = Math.max((maxX - minX) / 2, MIN_FIT_HALF_EXTENT) * FIT_PADDING_FACTOR
  const halfHeight = Math.max((maxY - minY) / 2, MIN_FIT_HALF_EXTENT) * FIT_PADDING_FACTOR

  if (input.camera instanceof THREE.OrthographicCamera) {
    const halfFrustumWidth = Math.max((input.camera.right - input.camera.left) / 2, MIN_FIT_HALF_EXTENT)
    const halfFrustumHeight = Math.max((input.camera.top - input.camera.bottom) / 2, MIN_FIT_HALF_EXTENT)
    const orthographicZoom = Math.max(
      Math.min(halfFrustumWidth / halfWidth, halfFrustumHeight / halfHeight),
      0.0001,
    )
    const distance = Math.max(input.camera.position.distanceTo(input.controls.target), radius * 2, MIN_FIT_CAMERA_DISTANCE)

    return {
      target,
      position: target.clone().addScaledVector(direction, distance),
      up: input.camera.up.clone(),
      radius,
      distance,
      orthographicZoom,
    }
  }

  const fovRadians = THREE.MathUtils.degToRad(input.camera.fov)
  const safeAspect = input.camera.aspect > 0 ? input.camera.aspect : 1
  const fitHeightDistance = halfHeight / Math.tan(fovRadians / 2)
  const fitWidthDistance = halfWidth / (Math.tan(fovRadians / 2) * safeAspect)
  const distance = Math.max(fitHeightDistance, fitWidthDistance, radius * 2, MIN_FIT_CAMERA_DISTANCE)

  return {
    target,
    position: target.clone().addScaledVector(direction, distance),
    up: input.camera.up.clone(),
    radius,
    distance,
  }
}

function collectBodyRenderablePoints(renderables: readonly RenderableEntityRecord[]) {
  const points: THREE.Vector3[] = []

  for (const renderable of renderables) {
    if (!renderable.ownerBodyId) {
      continue
    }

    switch (renderable.geometry.kind) {
      case 'mesh':
        points.push(...renderable.geometry.vertexPositions.map(toVector3))
        break
      case 'polyline':
        points.push(...renderable.geometry.points.map(toVector3))
        break
      case 'marker':
        points.push(toVector3(renderable.geometry.position))
        break
    }
  }

  return points
}

function toVector3(point: readonly [number, number, number]) {
  return new THREE.Vector3(point[0], point[1], point[2])
}
