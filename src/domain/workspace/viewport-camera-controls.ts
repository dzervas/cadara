import * as THREE from 'three'

export interface ViewportCameraControls {
  target: THREE.Vector3
  update: () => void
}
