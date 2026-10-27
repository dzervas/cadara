import * as THREE from "three";
import { expect, test } from "vitest";

import { computeSketchUnitsPerPixel } from "@/components/cad/sketch-snap-scale";
import { createStandardPlaneDefinition } from "@/core/modeling/opencascade-kernel-seed";

// Lane: UI (docs/testing.md). Seam: `computeSketchUnitsPerPixel`, the pure
// viewport helper that gives sketch pointer events their screen scale
// (T13-D13): the client point ±1 px projected onto the sketch plane.

const RECT = { left: 100, top: 50, width: 800, height: 600 };
const CENTER = { clientX: 500, clientY: 350 };
const XY = createStandardPlaneDefinition("xy");

function topDownCamera(distance: number) {
  const camera = new THREE.PerspectiveCamera(50, RECT.width / RECT.height);
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

test("a top-down perspective view: units per pixel is the view height over the pixel height, linear in the camera distance", () => {
  const scales = [10, 40].map((distance) => {
    const scale = computeSketchUnitsPerPixel({
      camera: topDownCamera(distance),
      viewportRect: RECT,
      plane: XY,
      ...CENTER,
    });
    const viewHeight = 2 * distance * Math.tan(THREE.MathUtils.degToRad(25));
    expect(scale, `distance ${distance}`).toBeCloseTo(
      viewHeight / RECT.height,
      9,
    );
    return scale!;
  });
  expect(scales[1]! / scales[0]!, "4× the distance, 4× the scale").toBeCloseTo(
    4,
    9,
  );
});

test("an orthographic view: units per pixel follows the zoom, not the camera distance", () => {
  const scaleAt = (zoom: number, distance: number) => {
    const camera = new THREE.OrthographicCamera(-8, 8, 6, -6, 0.1, 1000);
    camera.zoom = zoom;
    camera.position.set(0, 0, distance);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return computeSketchUnitsPerPixel({
      camera,
      viewportRect: RECT,
      plane: XY,
      clientX: 180,
      clientY: 90,
    });
  };
  expect(scaleAt(1, 10)).toBeCloseTo(12 / RECT.height, 9);
  expect(scaleAt(1, 300)).toBeCloseTo(12 / RECT.height, 9);
  expect(scaleAt(4, 10)).toBeCloseTo(3 / RECT.height, 9);
});

test("a tilted view uses the equal-area radius of the projected pixel; a pointer above the horizon has no scale", () => {
  const TILT = THREE.MathUtils.degToRad(75);
  const camera = new THREE.PerspectiveCamera(50, RECT.width / RECT.height);
  // 75° from the plane normal, looking at the origin.
  camera.position.set(0, -20 * Math.sin(TILT), 20 * Math.cos(TILT));
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const scale = computeSketchUnitsPerPixel({
    camera,
    viewportRect: RECT,
    plane: XY,
    ...CENTER,
  })!;
  const topDown = computeSketchUnitsPerPixel({
    camera: topDownCamera(20),
    viewportRect: RECT,
    plane: XY,
    ...CENTER,
  })!;
  // At the view centre the image is stretched by 1/cos 75° along the tilt
  // only: the equal-area radius is √(1/cos 75°) × the top-down scale.
  expect(scale / topDown).toBeCloseTo(Math.sqrt(1 / Math.cos(TILT)), 3);

  expect(
    computeSketchUnitsPerPixel({
      camera,
      viewportRect: RECT,
      plane: XY,
      clientX: CENTER.clientX,
      clientY: RECT.top + 1,
    }),
    "the top row (100° from the normal) looks above the horizon",
  ).toBe(null);
});

test("a sketch plane off the origin and off the XY orientation measures in its own frame", () => {
  const xz = createStandardPlaneDefinition("xz");
  const camera = new THREE.PerspectiveCamera(50, RECT.width / RECT.height);
  // Looking along the XZ plane's normal from 10 units away.
  const normal = new THREE.Vector3(...xz.frame.normal);
  camera.position.copy(normal.clone().multiplyScalar(10));
  camera.up.set(...xz.frame.yAxis);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  expect(
    computeSketchUnitsPerPixel({
      camera,
      viewportRect: RECT,
      plane: xz,
      ...CENTER,
    }),
  ).toBeCloseTo(topDownScale(10), 9);
});

function topDownScale(distance: number) {
  return (2 * distance * Math.tan(THREE.MathUtils.degToRad(25))) / RECT.height;
}

test("below the pick module's 1° grazing floor there is no scale (no snapping); just above it the scale is finite", () => {
  const tilt = THREE.MathUtils.degToRad(75);
  const camera = new THREE.PerspectiveCamera(50, RECT.width / RECT.height);
  camera.position.set(0, -20 * Math.sin(tilt), 20 * Math.cos(tilt));
  camera.up.set(0, 0, 1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  // The view axis is 15° below the horizon; a row whose ray is `elevation`
  // below the horizon sits (15° − elevation) above the view centre.
  const rowAt = (elevationDeg: number) =>
    CENTER.clientY -
    (RECT.height / 2) *
      (Math.tan(THREE.MathUtils.degToRad(15 - elevationDeg)) /
        Math.tan(THREE.MathUtils.degToRad(25)));
  const at = (elevationDeg: number) =>
    computeSketchUnitsPerPixel({
      camera,
      viewportRect: RECT,
      plane: XY,
      clientX: CENTER.clientX,
      clientY: rowAt(elevationDeg),
    });
  expect(at(0.9), "0.9° below the horizon: no scale").toBe(null);
  const above = at(1.1);
  expect(above, "1.1° below the horizon: a scale").not.toBe(null);
  expect(Number.isFinite(above!) && above! > 0).toBe(true);
});
