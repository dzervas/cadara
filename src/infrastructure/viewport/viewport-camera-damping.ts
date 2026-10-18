import type { ViewportCameraControls } from "@/infrastructure/viewport/viewport-camera-controls";
import type { ViewportCamera } from "@/infrastructure/viewport/viewport-projection";

/** Debug-platform operation: consume damping for deterministic test readiness. */
export function flushViewportCameraDamping(
  camera: ViewportCamera,
  controls: ViewportCameraControls,
): boolean {
  const position = camera.position.clone();
  const target = controls.target.clone();
  const epsilonSquared = 1e-20;
  for (let update = 0; update < 600; update += 1) {
    position.copy(camera.position);
    target.copy(controls.target);
    const zoom = camera.zoom;
    controls.update();
    if (
      position.distanceToSquared(camera.position) < epsilonSquared &&
      target.distanceToSquared(controls.target) < epsilonSquared &&
      Math.abs(zoom - camera.zoom) < 1e-10
    ) {
      return true;
    }
  }
  return false;
}
