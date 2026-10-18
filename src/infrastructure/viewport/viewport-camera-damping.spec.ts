import { expect, test } from "vitest";
import { OrbitControls } from "three-stdlib";

import { flushViewportCameraDamping } from "@/infrastructure/viewport/viewport-camera-damping";
import {
  captureViewportCameraFrame,
  createViewportCamera,
} from "@/infrastructure/viewport/viewport-projection";

for (const mode of ["orthographic", "perspective"] as const) {
  test(`test readiness drains a real ${mode} pan tail without rendering frames`, () => {
    const camera = createViewportCamera(mode, 16 / 9);
    camera.zoom = 6.23;
    camera.updateProjectionMatrix();
    const controls = new OrbitControls(camera);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    const keys = new EventTarget();
    controls.domElement = {
      clientWidth: 1440,
      clientHeight: 960,
    } as HTMLElement;
    controls.listenToKeyEvents(keys as HTMLElement);
    try {
      // Exercise OrbitControls' public keyboard-pan input, which accumulates
      // the same internal panOffset as the E2E helper's middle-button drag.
      for (let press = 0; press < 40; press += 1) {
        const event = new Event("keydown", { cancelable: true });
        Object.defineProperty(event, "code", { value: "ArrowLeft" });
        keys.dispatchEvent(event);
      }
      const before = camera.position.clone();
      controls.update();
      expect(camera.position.distanceTo(before)).toBeGreaterThan(0.001);

      expect(flushViewportCameraDamping(camera, controls)).toBe(true);
      const settled = captureViewportCameraFrame(camera, controls);
      for (let frame = 0; frame < 60; frame += 1) controls.update();
      const after = captureViewportCameraFrame(camera, controls);
      expect(after.position.distanceTo(settled.position)).toBeLessThan(1e-8);
      expect(after.target.distanceTo(settled.target)).toBeLessThan(1e-8);
      expect(after.orthographicZoom).toBeCloseTo(settled.orthographicZoom, 10);
      expect(controls.enableDamping).toBe(true);
      expect(controls.dampingFactor).toBe(0.08);
    } finally {
      controls.stopListenToKeyEvents();
    }
  });
}

test("test readiness reports a continuously moving camera instead of masking it", () => {
  const camera = createViewportCamera("orthographic", 16 / 9);
  const controls = new OrbitControls(camera);
  let updates = 0;
  controls.update = () => {
    updates += 1;
    camera.position.x += 1;
    return true;
  };
  expect(flushViewportCameraDamping(camera, controls)).toBe(false);
  expect(updates).toBe(600);
});
