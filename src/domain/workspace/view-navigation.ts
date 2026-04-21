import * as THREE from 'three'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'
import type { ViewportCamera } from '@/domain/workspace/viewport-projection'

export type ViewNavigationFacePresetId =
  | 'front'
  | 'back'
  | 'right'
  | 'left'
  | 'top'
  | 'bottom'

export type ViewNavigationCornerPresetId =
  | 'frontRightTop'
  | 'frontLeftTop'
  | 'backRightTop'
  | 'backLeftTop'
  | 'frontRightBottom'
  | 'frontLeftBottom'
  | 'backRightBottom'
  | 'backLeftBottom'

export type ViewNavigationPresetId = ViewNavigationFacePresetId | ViewNavigationCornerPresetId

interface ViewNavigationPreset {
  kind: 'face' | 'corner'
  label?: string
  direction: readonly [number, number, number]
}

interface SnapCameraToVectorOptions {
  camera: ViewportCamera
  controls: ViewportCameraControls
  direction: THREE.Vector3
}

interface SnapCameraToPresetOptions {
  camera: ViewportCamera
  controls: ViewportCameraControls
  presetId: ViewNavigationPresetId
}

export const VIEW_NAVIGATION_PRESETS: Record<ViewNavigationPresetId, ViewNavigationPreset> = {
  front: { kind: 'face', label: 'Front', direction: [0, -1, 0] },
  back: { kind: 'face', label: 'Back', direction: [0, 1, 0] },
  right: { kind: 'face', label: 'Right', direction: [1, 0, 0] },
  left: { kind: 'face', label: 'Left', direction: [-1, 0, 0] },
  top: { kind: 'face', label: 'Top', direction: [0, 0, 1] },
  bottom: { kind: 'face', label: 'Bottom', direction: [0, 0, -1] },
  frontRightTop: { kind: 'corner', direction: [1, -1, 1] },
  frontLeftTop: { kind: 'corner', direction: [-1, -1, 1] },
  backRightTop: { kind: 'corner', direction: [1, 1, 1] },
  backLeftTop: { kind: 'corner', direction: [-1, 1, 1] },
  frontRightBottom: { kind: 'corner', direction: [1, -1, -1] },
  frontLeftBottom: { kind: 'corner', direction: [-1, -1, -1] },
  backRightBottom: { kind: 'corner', direction: [1, 1, -1] },
  backLeftBottom: { kind: 'corner', direction: [-1, 1, -1] },
}

export function getViewNavigationDirection(presetId: ViewNavigationPresetId) {
  const [x, y, z] = VIEW_NAVIGATION_PRESETS[presetId].direction
  return new THREE.Vector3(x, y, z)
}

export function snapCameraToVector({
  camera,
  controls,
  direction,
}: SnapCameraToVectorOptions) {
  const normalizedDirection = direction.clone().normalize()
  const distance = Math.max(camera.position.distanceTo(controls.target), 12)

  camera.position.copy(controls.target.clone().add(normalizedDirection.multiplyScalar(distance)))
  camera.lookAt(controls.target)
  controls.update()
}

export function snapCameraToPreset({
  camera,
  controls,
  presetId,
}: SnapCameraToPresetOptions) {
  snapCameraToVector({
    camera,
    controls,
    direction: getViewNavigationDirection(presetId),
  })
}
