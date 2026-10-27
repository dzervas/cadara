import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  DimensionLineAnnotationPlacement,
  SketchDefinition,
  DimensionAnnotationPlacement,
  DimensionDefinition,
} from "@/contracts/sketch/schema";
import type { SketchEntityId } from "@/contracts/shared/ids";
import {
  getPointPosition,
  getReferencePointGeometry,
} from "./annotation-reference-geometry";
import type { SketchSessionState } from "./types";
import { withDimensionLabelPosition } from "@/core/sketch-constraints/registry";

function getSketchMidpoint(
  first: SketchPoint,
  second: SketchPoint,
): SketchPoint {
  return [(first[0] + second[0]) / 2, (first[1] + second[1]) / 2];
}

function normalizeSketchVector(vector: SketchPoint): SketchPoint {
  const length = Math.hypot(vector[0], vector[1]);
  return length <= 1e-6 ? [1, 0] : [vector[0] / length, vector[1] / length];
}

function projectPointOntoLineSegment(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
): SketchPoint {
  const vector: SketchPoint = [
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ];
  const lengthSquared = vector[0] * vector[0] + vector[1] * vector[1];

  if (lengthSquared <= 1e-9) {
    return line.start;
  }

  const offset: SketchPoint = [
    point[0] - line.start[0],
    point[1] - line.start[1],
  ];
  const ratio = Math.max(
    0,
    Math.min(
      1,
      (offset[0] * vector[0] + offset[1] * vector[1]) / lengthSquared,
    ),
  );

  return [line.start[0] + vector[0] * ratio, line.start[1] + vector[1] * ratio];
}

export function createAngleWitnessLines(
  id: string,
  first: { start: SketchPoint; end: SketchPoint },
  second: { start: SketchPoint; end: SketchPoint },
  start: SketchPoint,
  end: SketchPoint,
) {
  return [
    createAngleWitnessLine(`${id}-witness-a`, first, start),
    createAngleWitnessLine(`${id}-witness-b`, second, end),
  ].filter((line): line is NonNullable<typeof line> => line !== null);
}

function createAngleWitnessLine(
  id: string,
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
) {
  const anchor = projectPointOntoLineSegment(line, point);

  return Math.hypot(point[0] - anchor[0], point[1] - anchor[1]) <= 1e-6
    ? null
    : {
        id,
        label: "Witness",
        start: anchor,
        end: point,
      };
}

function getSketchCrossProduct(first: SketchPoint, second: SketchPoint) {
  return first[0] * second[1] - first[1] * second[0];
}

export function getSketchLineIntersection(
  first: { start: SketchPoint; end: SketchPoint },
  second: { start: SketchPoint; end: SketchPoint },
): SketchPoint | null {
  const firstVector: SketchPoint = [
    first.end[0] - first.start[0],
    first.end[1] - first.start[1],
  ];
  const secondVector: SketchPoint = [
    second.end[0] - second.start[0],
    second.end[1] - second.start[1],
  ];
  const denominator = getSketchCrossProduct(firstVector, secondVector);

  if (Math.abs(denominator) <= 1e-9) {
    return null;
  }

  const delta: SketchPoint = [
    second.start[0] - first.start[0],
    second.start[1] - first.start[1],
  ];
  const t = getSketchCrossProduct(delta, secondVector) / denominator;

  return [
    first.start[0] + firstVector[0] * t,
    first.start[1] + firstVector[1] * t,
  ];
}

export function getSketchLineDirectionFromCenter(
  line: { start: SketchPoint; end: SketchPoint },
  center: SketchPoint,
): SketchPoint {
  const midpoint = getSketchMidpoint(line.start, line.end);
  const towardMidpoint = normalizeSketchVector([
    midpoint[0] - center[0],
    midpoint[1] - center[1],
  ]);
  const lineUnit = normalizeSketchVector([
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ]);
  const dot = towardMidpoint[0] * lineUnit[0] + towardMidpoint[1] * lineUnit[1];

  return dot >= 0 ? lineUnit : [-lineUnit[0], -lineUnit[1]];
}

function normalizeSketchSignedAngleDelta(delta: number) {
  if (delta > Math.PI) {
    return delta - Math.PI * 2;
  }

  if (delta < -Math.PI) {
    return delta + Math.PI * 2;
  }

  return delta;
}

function normalizeSketchPositiveAngleDelta(delta: number) {
  const normalized = delta % (Math.PI * 2);
  return normalized < 0 ? normalized + Math.PI * 2 : normalized;
}

export function getSketchAngleArcSide(input: {
  center: SketchPoint;
  startVector: SketchPoint;
  endVector: SketchPoint;
  point: SketchPoint;
}): "minor" | "major" {
  const startAngle = Math.atan2(input.startVector[1], input.startVector[0]);
  const endAngle = Math.atan2(input.endVector[1], input.endVector[0]);
  const pointAngle = Math.atan2(
    input.point[1] - input.center[1],
    input.point[0] - input.center[0],
  );
  const minorDelta = normalizeSketchSignedAngleDelta(endAngle - startAngle);
  const minorSweep = Math.abs(minorDelta);

  if (minorSweep <= 1e-9) {
    return "minor";
  }

  const pointSweep =
    minorDelta >= 0
      ? normalizeSketchPositiveAngleDelta(pointAngle - startAngle)
      : normalizeSketchPositiveAngleDelta(startAngle - pointAngle);

  return pointSweep <= minorSweep ? "minor" : "major";
}

export function getSketchAngleLabelPoint(
  center: SketchPoint,
  firstVector: SketchPoint,
  secondVector: SketchPoint,
  radius: number,
  side: "minor" | "major",
): SketchPoint {
  const labelDirection = normalizeSketchVector(
    side === "major"
      ? [
          -(firstVector[0] + secondVector[0]),
          -(firstVector[1] + secondVector[1]),
        ]
      : [firstVector[0] + secondVector[0], firstVector[1] + secondVector[1]],
  );

  return [
    center[0] + labelDirection[0] * radius,
    center[1] + labelDirection[1] * radius,
  ];
}

function getPointPairAnnotationPlacementFromPoint(
  first: SketchPoint,
  second: SketchPoint,
  axis: "aligned" | "horizontal" | "vertical",
  point: SketchPoint,
): DimensionLineAnnotationPlacement {
  if (axis === "horizontal") {
    return { kind: "dimensionLine", offset: point[1] - first[1] };
  }

  if (axis === "vertical") {
    return { kind: "dimensionLine", offset: point[0] - first[0] };
  }

  const axisVector = normalizeSketchVector([
    second[0] - first[0],
    second[1] - first[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  return {
    kind: "dimensionLine",
    offset:
      (point[0] - first[0]) * normal[0] + (point[1] - first[1]) * normal[1],
  };
}

export function getLineAnnotationPlacementFromPoint(
  line: { start: SketchPoint; end: SketchPoint },
  point: SketchPoint,
): DimensionLineAnnotationPlacement {
  return {
    kind: "dimensionLine",
    offset: getSketchLineSignedDistance(point, line),
  };
}

function getSketchLineSignedDistance(
  point: SketchPoint,
  line: { start: SketchPoint; end: SketchPoint },
) {
  const axisVector = normalizeSketchVector([
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  return (
    (point[0] - line.start[0]) * normal[0] +
    (point[1] - line.start[1]) * normal[1]
  );
}

export function getLineSegmentGeometry(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): { start: SketchPoint; end: SketchPoint } | null {
  const entity = definition.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (!entity || entity.kind !== "lineSegment") {
    return null;
  }

  const start = getPointPosition(definition, entity.startPointId);
  const end = getPointPosition(definition, entity.endPointId);
  return start && end ? { start, end } : null;
}

export function getCircleLikeGeometry(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): { center: SketchPoint; radius: number } | null {
  const entity = definition.entities.find(
    (candidate) => candidate.entityId === entityId,
  );
  if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
    return null;
  }

  const center = getPointPosition(definition, entity.centerPointId);
  if (!center) {
    return null;
  }

  if (entity.kind === "circle") {
    return { center, radius: entity.radius };
  }

  const start = getPointPosition(definition, entity.startPointId);
  return start
    ? { center, radius: Math.hypot(start[0] - center[0], start[1] - center[1]) }
    : null;
}

export function createPlacedPointDimensionLine(
  first: SketchPoint,
  second: SketchPoint,
  axis: "aligned" | "horizontal" | "vertical",
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint } {
  if (axis === "horizontal") {
    const y =
      first[1] + (placement?.kind === "dimensionLine" ? placement.offset : -1);
    return { start: [first[0], y], end: [second[0], y] };
  }

  if (axis === "vertical") {
    const x =
      first[0] + (placement?.kind === "dimensionLine" ? placement.offset : 1);
    return { start: [x, first[1]], end: [x, second[1]] };
  }

  const axisVector = normalizeSketchVector([
    second[0] - first[0],
    second[1] - first[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  const offset = placement?.kind === "dimensionLine" ? placement.offset : 0;
  return {
    start: [first[0] + normal[0] * offset, first[1] + normal[1] * offset],
    end: [second[0] + normal[0] * offset, second[1] + normal[1] * offset],
  };
}

/**
 * cadara-bmy0: a radius runs from the centre and a diameter from the opposite
 * rim to the rim at the placement's angle (its label's default end).
 */
export function createPlacedCircleDimensionLine(
  circle: { center: SketchPoint; radius: number },
  kind: "circleRadius" | "diameter",
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint } {
  const angle =
    placement?.kind === "dimensionLine" ? (placement.angleRadians ?? 0) : 0;
  const direction: SketchPoint = [Math.cos(angle), Math.sin(angle)];
  return {
    start:
      kind === "diameter"
        ? [
            circle.center[0] - direction[0] * circle.radius,
            circle.center[1] - direction[1] * circle.radius,
          ]
        : circle.center,
    end: [
      circle.center[0] + direction[0] * circle.radius,
      circle.center[1] + direction[1] * circle.radius,
    ],
  };
}

/**
 * cadara-bmy0: a point-to-datum distance's two measured features: the point
 * and the datum's point nearest it (the origin, or the point's perpendicular
 * foot on an axis datum).
 */
export function getPointDatumDistanceGeometry(
  definition: SketchDefinition,
  session: SketchSessionState,
  dimension: Extract<DimensionDefinition, { kind: "pointDatumDistance" }>,
): { point: SketchPoint; datum: SketchPoint } | null {
  const point = getReferencePointGeometry(definition, session, dimension.point);
  if (!point) {
    return null;
  }
  switch (dimension.datum.datum) {
    case "origin":
      return { point, datum: [0, 0] };
    case "xAxis":
      return { point, datum: [point[0], 0] };
    case "yAxis":
      return { point, datum: [0, point[1]] };
  }
}

/** cadara-bmy0: the point-pair placement whose label sits at `point`. */
export function inferPointPairLabelPlacement(
  first: SketchPoint,
  second: SketchPoint,
  axis: "aligned" | "horizontal" | "vertical",
  point: SketchPoint,
): DimensionLineAnnotationPlacement {
  const placement = getPointPairAnnotationPlacementFromPoint(
    first,
    second,
    axis,
    point,
  );
  return withDimensionLabelPosition(
    placement,
    createPlacedPointDimensionLine(first, second, axis, placement),
    point,
  );
}

export function createPlacedLineLength(
  line: { start: SketchPoint; end: SketchPoint },
  placement: DimensionAnnotationPlacement | undefined,
): { start: SketchPoint; end: SketchPoint; offset: number } {
  const axisVector = normalizeSketchVector([
    line.end[0] - line.start[0],
    line.end[1] - line.start[1],
  ]);
  const normal: SketchPoint = [-axisVector[1], axisVector[0]];
  const offset = placement?.kind === "dimensionLine" ? placement.offset : 0;

  return {
    start: [
      line.start[0] + normal[0] * offset,
      line.start[1] + normal[1] * offset,
    ],
    end: [line.end[0] + normal[0] * offset, line.end[1] + normal[1] * offset],
    offset,
  };
}
