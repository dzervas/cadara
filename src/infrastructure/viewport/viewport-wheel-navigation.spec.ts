import { expect, test } from "vitest";
import { OrthographicCamera, PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three-stdlib";
import {
  attachViewportWheelNavigation,
  viewportPanOffset,
} from "./viewport-wheel-navigation";

for (const projection of ["perspective", "orthographic"] as const) {
  test(`${projection} pan preserves screen-pixel distance including orthographic zoom`, () => {
    const camera =
      projection === "perspective"
        ? new PerspectiveCamera(60, 2, 0.1, 1000)
        : new OrthographicCamera(-20, 20, 10, -10, 0.1, 1000);
    camera.position.set(0, 0, 40);
    camera.zoom = projection === "orthographic" ? 4 : 1;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const point = new Vector3().project(camera);
    const offset = viewportPanOffset(camera, new Vector3(), 1000, 500, 24, -36);
    camera.position.add(offset);
    camera.updateMatrixWorld();
    const moved = new Vector3().project(camera).sub(point);
    expect(moved.x * 500).toBeCloseTo(24);
    expect(-moved.y * 250).toBeCloseTo(-36);
  });
}

test("adapter claims touchpad wheels once, starts navigation, and leaves Mouse untouched", () => {
  const element = new EventTarget() as HTMLElement;
  Object.defineProperties(element, {
    clientWidth: { value: 1000 },
    clientHeight: { value: 500 },
  });
  const camera = new OrthographicCamera(-20, 20, 10, -10);
  camera.position.z = 40;
  const controls = new OrbitControls(camera);
  let starts = 0;
  let nativeWheels = 0;
  const native = () => nativeWheels++;
  element.addEventListener("wheel", native);
  // Node's EventTarget does not implement capture ordering; install capture first.
  element.removeEventListener("wheel", native);
  let dispose = attachViewportWheelNavigation(
    controls,
    element,
    "mouse",
    () => starts++,
  );
  element.addEventListener("wheel", native);
  const wheel = () => {
    const event = new Event("wheel", { cancelable: true });
    Object.assign(event, {
      deltaX: 12,
      deltaY: 20,
      deltaMode: 0,
      ctrlKey: false,
      metaKey: false,
      shiftKey: false,
    });
    element.dispatchEvent(event);
    return event;
  };
  expect(wheel().defaultPrevented).toBe(false);
  expect(starts).toBe(0);
  expect(nativeWheels).toBe(1);
  dispose();
  element.removeEventListener("wheel", native);
  dispose = attachViewportWheelNavigation(
    controls,
    element,
    "touchpad",
    () => starts++,
  );
  element.addEventListener("wheel", native);
  expect(wheel().defaultPrevented).toBe(true);
  expect(starts).toBe(1);
  expect(nativeWheels).toBe(1);
  expect(controls.target.length()).toBeGreaterThan(0);
  dispose();
  expect(wheel().defaultPrevented).toBe(false);
});
