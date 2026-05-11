import type { SketchPoint } from "@/contracts/modeling/schema";
import { distanceBetween } from "@/core/sketch-tools/shared";

export const SKETCH_TOOL_EPSILON = 0.0001;

export interface CircleFromPoints {
  center: SketchPoint;
  radius: number;
}

export function addPoints(left: SketchPoint, right: SketchPoint): SketchPoint {
  return [left[0] + right[0], left[1] + right[1]];
}

export function subtractPoints(
  left: SketchPoint,
  right: SketchPoint,
): SketchPoint {
  return [left[0] - right[0], left[1] - right[1]];
}

export function scalePoint(point: SketchPoint, scalar: number): SketchPoint {
  return [point[0] * scalar, point[1] * scalar];
}

export function dotPoints(left: SketchPoint, right: SketchPoint) {
  return left[0] * right[0] + left[1] * right[1];
}

export function crossPoints(left: SketchPoint, right: SketchPoint) {
  return left[0] * right[1] - left[1] * right[0];
}

export function perpendicularLeft(point: SketchPoint): SketchPoint {
  return [-point[1], point[0]];
}

export function normalizePoint(point: SketchPoint): SketchPoint | null {
  const length = Math.hypot(point[0], point[1]);

  if (length <= SKETCH_TOOL_EPSILON) {
    return null;
  }

  return [point[0] / length, point[1] / length];
}

export function pointsDistinct(left: SketchPoint, right: SketchPoint) {
  return distanceBetween(left, right) > SKETCH_TOOL_EPSILON;
}

export function mirrorPointAcrossCenter(
  center: SketchPoint,
  point: SketchPoint,
): SketchPoint {
  return [center[0] * 2 - point[0], center[1] * 2 - point[1]];
}

export function getAxisAlignedRectangleCorners(
  center: SketchPoint,
  corner: SketchPoint,
) {
  const opposite = mirrorPointAcrossCenter(center, corner);
  const bottomLeft: SketchPoint = [
    Math.min(corner[0], opposite[0]),
    Math.min(corner[1], opposite[1]),
  ];
  const topRight: SketchPoint = [
    Math.max(corner[0], opposite[0]),
    Math.max(corner[1], opposite[1]),
  ];
  const bottomRight: SketchPoint = [topRight[0], bottomLeft[1]];
  const topLeft: SketchPoint = [bottomLeft[0], topRight[1]];

  return { bottomLeft, bottomRight, topRight, topLeft, center };
}

export function getAlignedRectangleCorners(
  first: SketchPoint,
  second: SketchPoint,
  third: SketchPoint,
) {
  const edge = subtractPoints(second, first);
  const normal = normalizePoint(perpendicularLeft(edge));

  if (!normal) {
    return null;
  }

  const height = dotPoints(subtractPoints(third, second), normal);
  const offset = scalePoint(normal, height);
  const fourth = addPoints(first, offset);
  const thirdCorner = addPoints(second, offset);

  return {
    first,
    second,
    third: thirdCorner,
    fourth,
    width: distanceBetween(first, second),
    height: Math.abs(height),
  };
}

export function getCircumcircleFromPoints(
  first: SketchPoint,
  second: SketchPoint,
  third: SketchPoint,
): CircleFromPoints | null {
  const determinant =
    2 *
    (first[0] * (second[1] - third[1]) +
      second[0] * (third[1] - first[1]) +
      third[0] * (first[1] - second[1]));

  if (Math.abs(determinant) <= SKETCH_TOOL_EPSILON) {
    return null;
  }

  const firstLength = first[0] ** 2 + first[1] ** 2;
  const secondLength = second[0] ** 2 + second[1] ** 2;
  const thirdLength = third[0] ** 2 + third[1] ** 2;
  const center: SketchPoint = [
    (firstLength * (second[1] - third[1]) +
      secondLength * (third[1] - first[1]) +
      thirdLength * (first[1] - second[1])) /
      determinant,
    (firstLength * (third[0] - second[0]) +
      secondLength * (first[0] - third[0]) +
      thirdLength * (second[0] - first[0])) /
      determinant,
  ];

  return {
    center,
    radius: distanceBetween(center, first),
  };
}

export function getTangentArcCircle(
  start: SketchPoint,
  tangentPoint: SketchPoint,
  end: SketchPoint,
):
  | (CircleFromPoints & { sweepDirection: "clockwise" | "counterClockwise" })
  | null {
  const tangent = normalizePoint(subtractPoints(tangentPoint, start));
  if (!tangent || !pointsDistinct(start, end)) {
    return null;
  }

  const normal = perpendicularLeft(tangent);
  const chord = subtractPoints(end, start);
  const denominator = 2 * dotPoints(normal, chord);
  if (Math.abs(denominator) <= SKETCH_TOOL_EPSILON) {
    return null;
  }

  const center = addPoints(
    start,
    scalePoint(normal, dotPoints(chord, chord) / denominator),
  );
  const radiusVector = subtractPoints(start, center);
  const ccwTangent = perpendicularLeft(radiusVector);
  const clockwiseTangent = scalePoint(ccwTangent, -1);
  const sweepDirection =
    dotPoints(ccwTangent, tangent) >= dotPoints(clockwiseTangent, tangent)
      ? "counterClockwise"
      : "clockwise";

  return {
    center,
    radius: distanceBetween(center, start),
    sweepDirection,
  };
}

export function getArcSweepDirectionThroughPoint(
  center: SketchPoint,
  start: SketchPoint,
  through: SketchPoint,
  end: SketchPoint,
): "clockwise" | "counterClockwise" {
  const startAngle = angleFromCenter(center, start);
  const throughAngle = angleFromCenter(center, through);
  const endAngle = angleFromCenter(center, end);
  const ccwToThrough = positiveAngleDelta(startAngle, throughAngle);
  const ccwToEnd = positiveAngleDelta(startAngle, endAngle);

  return ccwToThrough <= ccwToEnd ? "counterClockwise" : "clockwise";
}

export function sampleArcPoints(
  center: SketchPoint,
  start: SketchPoint,
  end: SketchPoint,
  sweepDirection: "clockwise" | "counterClockwise",
  segmentCount = 32,
): SketchPoint[] {
  const startAngle = angleFromCenter(center, start);
  const endAngle = angleFromCenter(center, end);
  const radius = distanceBetween(center, start);
  const sweep =
    sweepDirection === "counterClockwise"
      ? positiveAngleDelta(startAngle, endAngle)
      : -positiveAngleDelta(endAngle, startAngle);

  return Array.from({ length: segmentCount + 1 }, (_, index) => {
    const angle = startAngle + (sweep * index) / segmentCount;
    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ] satisfies SketchPoint;
  });
}

export function createRegularPolygonVertices(input: {
  center: SketchPoint;
  radius: number;
  sideCount: number;
  startAngle?: number;
}) {
  const startAngle = input.startAngle ?? -Math.PI / 2;

  return Array.from({ length: input.sideCount }, (_, index) => {
    const angle = startAngle + (Math.PI * 2 * index) / input.sideCount;
    return [
      input.center[0] + Math.cos(angle) * input.radius,
      input.center[1] + Math.sin(angle) * input.radius,
    ] satisfies SketchPoint;
  });
}

function angleFromCenter(center: SketchPoint, point: SketchPoint) {
  return Math.atan2(point[1] - center[1], point[0] - center[0]);
}

function positiveAngleDelta(start: number, end: number) {
  const delta = (end - start) % (Math.PI * 2);
  return delta < 0 ? delta + Math.PI * 2 : delta;
}
