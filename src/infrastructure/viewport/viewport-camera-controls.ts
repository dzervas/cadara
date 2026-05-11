import * as THREE from "three";

export interface ViewportCameraControls {
  target: THREE.Vector3;
  update: () => void;
  addEventListener: (type: "change", listener: () => void) => void;
  removeEventListener: (type: "change", listener: () => void) => void;
}
