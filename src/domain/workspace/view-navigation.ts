import * as THREE from 'three'
import type { ViewportCameraControls } from '@/domain/workspace/viewport-camera-controls'

interface SnapCameraToVectorOptions {
  camera: THREE.PerspectiveCamera
  controls: ViewportCameraControls
  direction: THREE.Vector3
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
