import type { SketchPlaneFrame } from "@/contracts/shared/sketch-plane";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

export type Vec3 = readonly [number, number, number];

export function scale(vector: Vec3, scalar: number): Vec3 {
  return [vector[0] * scalar, vector[1] * scalar, vector[2] * scalar];
}

export function add(left: Vec3, right: Vec3): Vec3 {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function subtract(left: Vec3, right: Vec3): Vec3 {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function dot(left: Vec3, right: Vec3) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function cross(left: Vec3, right: Vec3): Vec3 {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0],
  ];
}

export function magnitude(vector: Vec3) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function normalize(vector: Vec3): Vec3 {
  const length = magnitude(vector);

  if (length === 0) {
    throw new Error("Cannot normalize a zero-length vector.");
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function negate(vector: Vec3): Vec3 {
  return [-vector[0], -vector[1], -vector[2]];
}

export function mapSketchPointToWorld(
  frame: SketchPlaneFrame,
  point: SketchPoint2D,
): Vec3 {
  return add(
    frame.origin,
    add(scale(frame.xAxis, point[0]), scale(frame.yAxis, point[1])),
  );
}

export function mapWorldPointToSketch(
  frame: SketchPlaneFrame,
  point: Vec3,
): SketchPoint2D {
  const relative = subtract(point, frame.origin);
  return [dot(relative, frame.xAxis), dot(relative, frame.yAxis)];
}
