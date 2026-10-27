import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import type { OrbitControls } from "three-stdlib";
import {
  wheelCameraIntent,
  type PointingDeviceScheme,
} from "@/core/workspace/wheel-camera-intent";

export function viewportPanOffset(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3,
  width: number,
  height: number,
  dx: number,
  dy: number,
): Vector3 {
  const verticalSpan =
    camera instanceof PerspectiveCamera
      ? 2 *
        camera.position.distanceTo(target) *
        Math.tan((camera.fov * Math.PI) / 360)
      : (camera.top - camera.bottom) / camera.zoom;
  const horizontalSpan =
    camera instanceof PerspectiveCamera
      ? (verticalSpan * width) / height
      : (camera.right - camera.left) / camera.zoom;
  camera.updateMatrix();
  return new Vector3()
    .setFromMatrixColumn(camera.matrix, 0)
    .multiplyScalar((-dx * horizontalSpan) / width)
    .addScaledVector(
      new Vector3().setFromMatrixColumn(camera.matrix, 1),
      (dy * verticalSpan) / height,
    );
}

export function attachViewportWheelNavigation(
  controls: OrbitControls,
  element: HTMLElement,
  scheme: PointingDeviceScheme,
  onNavigationStart: () => void,
): () => void {
  const onWheel = (event: WheelEvent) => {
    if (!controls.enabled || scheme === "mouse") return;
    const intent = wheelCameraIntent({
      deltaX: event.deltaX,
      deltaY: event.deltaY,
      deltaMode: event.deltaMode,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      shiftKey: event.shiftKey,
      scheme,
    });
    // Capture before OrbitControls' wheel listener so touchpad gestures have one owner.
    event.preventDefault();
    event.stopImmediatePropagation();
    if (intent.kind === "none") return;
    onNavigationStart();
    if (intent.kind === "pan" && controls.enablePan) {
      // OrbitControls' pan is closure-private. Translate its public camera/target
      // together using the same projection math, retaining its sole camera ownership.
      const offset = viewportPanOffset(
        controls.object,
        controls.target,
        element.clientWidth,
        element.clientHeight,
        intent.dx,
        intent.dy,
      );
      controls.object.position.add(offset);
      controls.target.add(offset);
      controls.update();
    } else if (intent.kind === "orbit" && controls.enableRotate) {
      controls.setAzimuthalAngle(
        controls.getAzimuthalAngle() -
          (2 * Math.PI * intent.dx) / element.clientHeight,
      );
      controls.setPolarAngle(
        controls.getPolarAngle() -
          (2 * Math.PI * intent.dy) / element.clientHeight,
      );
    } else if (intent.kind === "zoom" && controls.enableZoom) {
      controls.dollyIn(intent.scale);
    }
  };
  element.addEventListener("wheel", onWheel, { capture: true, passive: false });
  return () => element.removeEventListener("wheel", onWheel, { capture: true });
}
