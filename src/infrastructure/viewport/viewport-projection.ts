import * as THREE from 'three'

import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { ViewportCameraControls } from '@/infrastructure/viewport/viewport-camera-controls'

export type ViewportProjectionMode = 'orthographic' | 'perspective'
export type ViewportCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera

export interface ViewportCameraFrame {
  projectionMode: ViewportProjectionMode
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
  cameraDistance: number
  perspectiveDistance: number
  orthographicZoom: number
}

export interface ViewportRenderableFitFrame extends ViewportCameraFrame {
  radius: number
  distance: number
}

export const DEFAULT_VIEWPORT_PROJECTION_MODE: ViewportProjectionMode = 'orthographic'

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(14, -16, 28)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 4)
const DEFAULT_CAMERA_UP = new THREE.Vector3(0, 0, 1)
const DEFAULT_PERSPECTIVE_CAMERA_FOV = 45
const ORTHOGRAPHIC_FRUSTUM_HEIGHT = 32
const FIT_PADDING_FACTOR = 1.18
const MIN_FIT_HALF_EXTENT = 1
const MIN_FIT_CAMERA_DISTANCE = 8
const MIN_CAMERA_DISTANCE = 0.0001
const DEFAULT_CAMERA_NEAR = 0.1
const MIN_CAMERA_FAR = 1000
const MIN_ORTHOGRAPHIC_ZOOM = 0.0001
const ORTHOGRAPHIC_CLIP_PADDING_FACTOR = 2
const PERSPECTIVE_CLIP_PADDING_FACTOR = 8

export function createViewportCamera(mode: ViewportProjectionMode, aspect: number): ViewportCamera {
  const camera = mode === 'orthographic'
    ? new THREE.OrthographicCamera(0, 0, 0, 0, DEFAULT_CAMERA_NEAR, MIN_CAMERA_FAR)
    : new THREE.PerspectiveCamera(DEFAULT_PERSPECTIVE_CAMERA_FOV, 1, DEFAULT_CAMERA_NEAR, MIN_CAMERA_FAR)

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
  const cameraDistance = DEFAULT_CAMERA_POSITION.distanceTo(DEFAULT_CAMERA_TARGET)

  return {
    projectionMode: DEFAULT_VIEWPORT_PROJECTION_MODE,
    position: DEFAULT_CAMERA_POSITION.clone(),
    target: DEFAULT_CAMERA_TARGET.clone(),
    up: DEFAULT_CAMERA_UP.clone(),
    cameraDistance,
    perspectiveDistance: cameraDistance,
    orthographicZoom: 1,
  }
}

export function captureViewportCameraFrame(
  camera: ViewportCamera,
  controls: ViewportCameraControls,
): ViewportCameraFrame {
  return createViewportCameraFrame({
    camera,
    position: camera.position,
    target: controls.target,
    up: camera.up,
  })
}

export function applyViewportCameraFrame(
  camera: ViewportCamera,
  controls: ViewportCameraControls,
  frame: ViewportCameraFrame,
) {
  applyViewportCameraFrameToCamera(camera, frame)
  controls.target.copy(frame.target)
  controls.update()
}

export function applyViewportCameraFrameToCamera(
  camera: ViewportCamera,
  frame: ViewportCameraFrame,
) {
  const direction = getViewportCameraFrameDirection(frame)
  const cameraDistance = camera instanceof THREE.PerspectiveCamera
    ? frame.perspectiveDistance
    : frame.cameraDistance

  camera.up.copy(frame.up)
  camera.position.copy(frame.target).addScaledVector(direction, cameraDistance)
  if (camera instanceof THREE.OrthographicCamera) {
    camera.zoom = frame.orthographicZoom
  }
  camera.lookAt(frame.target)
  updateViewportCameraClipping(camera, frame.target)
  camera.updateMatrixWorld()
}

export function updateViewportCameraClipping(
  camera: ViewportCamera,
  target: THREE.Vector3 = DEFAULT_CAMERA_TARGET,
) {
  const targetDistance = Math.max(camera.position.distanceTo(target), MIN_CAMERA_DISTANCE)

  if (camera instanceof THREE.OrthographicCamera) {
    const safeZoom = Math.max(camera.zoom, MIN_ORTHOGRAPHIC_ZOOM)
    const halfWidth = Math.abs(camera.right - camera.left) / (2 * safeZoom)
    const halfHeight = Math.abs(camera.top - camera.bottom) / (2 * safeZoom)
    const visibleRadius = Math.hypot(halfWidth, halfHeight)
    const clipExtent = Math.max(
      MIN_CAMERA_FAR,
      targetDistance + visibleRadius * ORTHOGRAPHIC_CLIP_PADDING_FACTOR,
    )

    camera.near = -clipExtent
    camera.far = clipExtent
    camera.updateProjectionMatrix()
    return
  }

  camera.near = DEFAULT_CAMERA_NEAR
  camera.far = Math.max(MIN_CAMERA_FAR, targetDistance * PERSPECTIVE_CLIP_PADDING_FACTOR)
  camera.updateProjectionMatrix()
}

export function cloneViewportCameraFrame(frame: ViewportCameraFrame): ViewportCameraFrame {
  return {
    projectionMode: frame.projectionMode,
    position: frame.position.clone(),
    target: frame.target.clone(),
    up: frame.up.clone(),
    cameraDistance: frame.cameraDistance,
    perspectiveDistance: frame.perspectiveDistance,
    orthographicZoom: frame.orthographicZoom,
  }
}

export function interpolateViewportCameraFrame(
  fromFrame: ViewportCameraFrame,
  toFrame: ViewportCameraFrame,
  alpha: number,
): ViewportCameraFrame {
  const clampedAlpha = THREE.MathUtils.clamp(alpha, 0, 1)
  const up = fromFrame.up.clone().lerp(toFrame.up, clampedAlpha)
  if (up.lengthSq() < 1e-8) {
    up.copy(toFrame.up)
  }
  up.normalize()

  return {
    projectionMode: toFrame.projectionMode,
    position: fromFrame.position.clone().lerp(toFrame.position, clampedAlpha),
    target: fromFrame.target.clone().lerp(toFrame.target, clampedAlpha),
    up,
    cameraDistance: THREE.MathUtils.lerp(fromFrame.cameraDistance, toFrame.cameraDistance, clampedAlpha),
    perspectiveDistance: THREE.MathUtils.lerp(fromFrame.perspectiveDistance, toFrame.perspectiveDistance, clampedAlpha),
    orthographicZoom: THREE.MathUtils.lerp(fromFrame.orthographicZoom, toFrame.orthographicZoom, clampedAlpha),
  }
}

export function createViewportCameraFrame(input: {
  camera: ViewportCamera
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
  orthographicZoom?: number
  perspectiveDistance?: number
}): ViewportCameraFrame {
  const position = input.position.clone()
  const target = input.target.clone()
  const cameraDistance = Math.max(position.distanceTo(target), MIN_CAMERA_DISTANCE)
  const projectionMode = getViewportCameraProjectionMode(input.camera)
  const orthographicZoom = input.orthographicZoom
    ?? (input.camera instanceof THREE.OrthographicCamera
      ? Math.max(input.camera.zoom, MIN_ORTHOGRAPHIC_ZOOM)
      : computeOrthographicZoomForPerspectiveDistance({
          perspectiveDistance: cameraDistance,
          fovDegrees: input.camera.fov,
        }))
  const perspectiveDistance = input.perspectiveDistance
    ?? (input.camera instanceof THREE.PerspectiveCamera
      ? cameraDistance
      : computePerspectiveDistanceForOrthographicZoom({
          orthographicZoom,
          fovDegrees: DEFAULT_PERSPECTIVE_CAMERA_FOV,
        }))

  return {
    projectionMode,
    position,
    target,
    up: input.up.clone().normalize(),
    cameraDistance,
    perspectiveDistance,
    orthographicZoom,
  }
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
  if (input.camera instanceof THREE.OrthographicCamera) {
    input.camera.zoom = frame.orthographicZoom
  }

  updateViewportCameraClipping(input.camera, frame.target)
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
      MIN_ORTHOGRAPHIC_ZOOM,
    )
    const distance = Math.max(input.camera.position.distanceTo(input.controls.target), radius * 2, MIN_FIT_CAMERA_DISTANCE)

    return Object.assign(
      createViewportCameraFrame({
        camera: input.camera,
        target,
        position: target.clone().addScaledVector(direction, distance),
        up: input.camera.up,
        orthographicZoom,
      }),
      {
        radius,
        distance,
      },
    )
  }

  const fovRadians = THREE.MathUtils.degToRad(input.camera.fov)
  const safeAspect = input.camera.aspect > 0 ? input.camera.aspect : 1
  const fitHeightDistance = halfHeight / Math.tan(fovRadians / 2)
  const fitWidthDistance = halfWidth / (Math.tan(fovRadians / 2) * safeAspect)
  const distance = Math.max(fitHeightDistance, fitWidthDistance, radius * 2, MIN_FIT_CAMERA_DISTANCE)

  return Object.assign(
    createViewportCameraFrame({
      camera: input.camera,
      target,
      position: target.clone().addScaledVector(direction, distance),
      up: input.camera.up,
    }),
    {
      radius,
      distance,
    },
  )
}

function getViewportCameraFrameDirection(frame: ViewportCameraFrame) {
  const direction = frame.position.clone().sub(frame.target)

  if (direction.lengthSq() < 1e-8) {
    return DEFAULT_CAMERA_POSITION.clone().sub(DEFAULT_CAMERA_TARGET).normalize()
  }

  return direction.normalize()
}

function computeOrthographicZoomForPerspectiveDistance(input: {
  perspectiveDistance: number
  fovDegrees: number
}) {
  const visibleHeight = 2 * Math.max(input.perspectiveDistance, MIN_CAMERA_DISTANCE) * Math.tan(
    THREE.MathUtils.degToRad(input.fovDegrees) / 2,
  )

  return Math.max(ORTHOGRAPHIC_FRUSTUM_HEIGHT / Math.max(visibleHeight, MIN_CAMERA_DISTANCE), MIN_ORTHOGRAPHIC_ZOOM)
}

function computePerspectiveDistanceForOrthographicZoom(input: {
  orthographicZoom: number
  fovDegrees: number
}) {
  const safeZoom = Math.max(input.orthographicZoom, MIN_ORTHOGRAPHIC_ZOOM)
  const visibleHeight = ORTHOGRAPHIC_FRUSTUM_HEIGHT / safeZoom

  return Math.max(
    visibleHeight / (2 * Math.tan(THREE.MathUtils.degToRad(input.fovDegrees) / 2)),
    MIN_CAMERA_DISTANCE,
  )
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
