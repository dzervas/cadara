import * as THREE from 'three'

import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'

export type ViewportProjectionMode = 'orthographic' | 'perspective'
export type ViewportCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera

export interface ViewportCameraFrame {
  position: THREE.Vector3
  target: THREE.Vector3
  up: THREE.Vector3
}

export const DEFAULT_VIEWPORT_PROJECTION_MODE: ViewportProjectionMode = 'orthographic'

const DEFAULT_CAMERA_POSITION = new THREE.Vector3(14, -16, 28)
const DEFAULT_CAMERA_TARGET = new THREE.Vector3(0, 0, 4)
const DEFAULT_CAMERA_UP = new THREE.Vector3(0, 0, 1)
const ORTHOGRAPHIC_FRUSTUM_HEIGHT = 32

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
