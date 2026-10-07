import * as THREE from "three";

import { SKETCH_CURVE_PICK_GRAZING_SINE } from "@/components/cad/three-cad-viewport-pick-candidates";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  mapWorldPointToWorkspaceSketch,
  type SketchPlaneFrameInput,
} from "@/core/workspace/sketch-plane-mapping";

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const plane = new THREE.Plane();
const hit = new THREE.Vector3();

/**
 * Sketch units per screen pixel at a client point (T13-D13), so snapping can
 * use screen-pixel tolerances: the client point ±1 px horizontally and
 * vertically, projected onto the sketch plane. Under a tilted perspective a
 * 1 px circle covers an ellipse of the sketch; the result is the radius of
 * the equal-area circle (the geometric mean of the two half-spans), so on
 * screen a snap radius is √(1/cos θ) wider across the tilt θ than along it
 * (≈ 2× at 75°, 3.4× at 85°). Null (no snapping) when a ray misses the
 * plane, when the pointer ray meets the plane at less than the pick
 * module's 1° grazing floor (where the scale grows without bound), or when
 * the scale is not finite and positive.
 */
export function computeSketchUnitsPerPixel(input: {
  camera: THREE.Camera;
  viewportRect: Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">;
  plane: SketchPlaneFrameInput;
  clientX: number;
  clientY: number;
}): number | null {
  const frame = "frame" in input.plane ? input.plane.frame : input.plane;
  plane.setFromNormalAndCoplanarPoint(
    new THREE.Vector3(...frame.normal),
    new THREE.Vector3(...frame.origin),
  );
  const project = (dx: number, dy: number): SketchPoint2D | null => {
    pointer.set(
      ((input.clientX + dx - input.viewportRect.left) /
        input.viewportRect.width) *
        2 -
        1,
      -(
        (input.clientY + dy - input.viewportRect.top) /
        input.viewportRect.height
      ) *
        2 +
        1,
    );
    raycaster.setFromCamera(pointer, input.camera);
    return raycaster.ray.intersectPlane(plane, hit)
      ? mapWorldPointToWorkspaceSketch(input.plane, [hit.x, hit.y, hit.z])
      : null;
  };
  // The grazing floor, judged on the pointer's own ray.
  if (project(0, 0) === null) {
    return null;
  }
  const normal = new THREE.Vector3(...frame.normal);
  if (
    Math.abs(raycaster.ray.direction.dot(normal)) <
    SKETCH_CURVE_PICK_GRAZING_SINE
  ) {
    return null;
  }

  const left = project(-1, 0);
  const right = project(1, 0);
  const up = project(0, -1);
  const down = project(0, 1);

  if (!left || !right || !up || !down) {
    return null;
  }

  const scale = Math.sqrt(
    (Math.hypot(right[0] - left[0], right[1] - left[1]) / 2) *
      (Math.hypot(down[0] - up[0], down[1] - up[1]) / 2),
  );

  return Number.isFinite(scale) && scale > 0 ? scale : null;
}
