import type { SketchEntityId } from "@/contracts/shared/ids";
import type {
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
} from "@/contracts/sketch/schema";
import type { SketchPointId } from "@/contracts/shared/ids";
import { orderedSplinePointIds } from "@/contracts/sketch/spline-geometry";

/**
 * Shared 2D offset mathematics for the sketch layer.
 *
 * Consumed by both the offset derivation recompute (contracts) and the
 * sketch edit operators (domain: offset tool authoring, slot tool), so this
 * module must stay free of domain/application imports.
 *
 * Semantics:
 * - The chain traversal is anchored to the first seed curve's natural
 *   direction (line start->end, arc start->end along its sweep, spline
 *   first->last fit point). A positive distance offsets to the left of that
 *   traversal; the anchor keeps the side stable across seed edits.
 * - Lines, circles, and arcs offset in closed form. Splines offset by
 *   tolerance-bounded approximation (see OFFSET_SPLINE_RELATIVE_TOLERANCE).
 * - Adjacent segments join by trim/extend at their analytic intersection when
 *   the corner turns toward the offset side, and by an arc join centered on
 *   the shared seed vertex (radius |distance|) otherwise. Joints where a
 *   spline needs trimming snap both endpoints to their shared midpoint as a
 *   documented v1 approximation.
 */

export const OFFSET_DIAGNOSTIC_CODES = {
  arcCollapse: "derived-offset-arc-collapse",
  splineFitFailure: "derived-offset-spline-fit-failure",
  selfIntersection: "derived-offset-self-intersection",
  disconnectedChain: "derived-offset-disconnected-chain",
  unsupportedSeed: "derived-offset-unsupported-seed",
  unresolvedDistance: "derived-offset-unresolved-distance",
  jointUnsatisfied: "derived-offset-joint-unsatisfied",
  derivativeUnavailable: "derived-offset-derivative-unavailable",
} as const;

export type OffsetDiagnosticCode =
  (typeof OFFSET_DIAGNOSTIC_CODES)[keyof typeof OFFSET_DIAGNOSTIC_CODES];

/**
 * Spline offsets must stay within this fraction of |distance| of the true
 * offset. Refinement doubles the fit-point count until the deviation
 * conforms or OFFSET_SPLINE_MAX_FIT_POINTS is reached.
 */
export const OFFSET_SPLINE_RELATIVE_TOLERANCE = 0.01;
export const OFFSET_SPLINE_MAX_FIT_POINTS = 64;
export const OFFSET_SPLINE_MIN_FIT_POINTS = 3;

const EPSILON = 1e-6;

export type OffsetSeedCurve =
  | {
      kind: "lineSegment";
      seedEntityId: SketchEntityId;
      start: SketchPoint2D;
      end: SketchPoint2D;
    }
  | {
      kind: "circle";
      seedEntityId: SketchEntityId;
      center: SketchPoint2D;
      radius: number;
    }
  | {
      kind: "arc";
      seedEntityId: SketchEntityId;
      center: SketchPoint2D;
      start: SketchPoint2D;
      end: SketchPoint2D;
      sweepDirection: "clockwise" | "counterClockwise";
    }
  | {
      kind: "spline";
      seedEntityId: SketchEntityId;
      points: readonly SketchPoint2D[];
    };

/** Derived geometry per seed segment, expressed in the seed's natural order. */
export type OffsetSegmentGeometry =
  | {
      kind: "lineSegment";
      seedEntityId: SketchEntityId;
      start: SketchPoint2D;
      end: SketchPoint2D;
    }
  | {
      kind: "circle";
      seedEntityId: SketchEntityId;
      center: SketchPoint2D;
      radius: number;
    }
  | {
      kind: "arc";
      seedEntityId: SketchEntityId;
      center: SketchPoint2D;
      start: SketchPoint2D;
      end: SketchPoint2D;
      sweepDirection: "clockwise" | "counterClockwise";
    }
  | {
      kind: "spline";
      seedEntityId: SketchEntityId;
      points: readonly SketchPoint2D[];
    };

export interface OffsetJointGeometry {
  firstSeedEntityId: SketchEntityId;
  secondSeedEntityId: SketchEntityId;
  center: SketchPoint2D;
  start: SketchPoint2D;
  end: SketchPoint2D;
  sweepDirection: "clockwise" | "counterClockwise";
}

export interface OffsetChainOrderEntry {
  seedEntityId: SketchEntityId;
  /** True when the chain traverses this seed against its natural direction. */
  reversed: boolean;
}

export interface OffsetChainSuccess {
  ok: true;
  closed: boolean;
  order: readonly OffsetChainOrderEntry[];
  segments: readonly OffsetSegmentGeometry[];
  joints: readonly OffsetJointGeometry[];
}

export interface OffsetChainFailure {
  ok: false;
  code: OffsetDiagnosticCode;
  message: string;
  seedEntityId: SketchEntityId | null;
}

export type OffsetChainResult = OffsetChainSuccess | OffsetChainFailure;

export type OffsetSeedCurveVariation =
  | {
      kind: "lineSegment";
      start: SketchPoint2D;
      end: SketchPoint2D;
    }
  | {
      kind: "circle";
      center: SketchPoint2D;
      radius: number;
    }
  | {
      kind: "arc";
      center: SketchPoint2D;
      start: SketchPoint2D;
      end: SketchPoint2D;
    }
  | {
      kind: "spline";
      points: readonly SketchPoint2D[];
    };

export type OffsetSegmentVariation =
  | {
      kind: "lineSegment";
      seedEntityId: SketchEntityId;
      start: SketchPoint2D;
      end: SketchPoint2D;
    }
  | {
      kind: "circle";
      seedEntityId: SketchEntityId;
      center: SketchPoint2D;
      radius: number;
    }
  | {
      kind: "arc";
      seedEntityId: SketchEntityId;
      center: SketchPoint2D;
      start: SketchPoint2D;
      end: SketchPoint2D;
      radius: number;
    };

export interface OffsetJointVariation {
  firstSeedEntityId: SketchEntityId;
  secondSeedEntityId: SketchEntityId;
  center: SketchPoint2D;
  start: SketchPoint2D;
  end: SketchPoint2D;
}

export type OffsetChainJvpResult =
  | {
      ok: true;
      segments: readonly OffsetSegmentVariation[];
      joints: readonly OffsetJointVariation[];
    }
  | OffsetChainFailure;

function add(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]];
}

function subtract(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]];
}

function scale(vector: SketchPoint2D, scalar: number): SketchPoint2D {
  return [vector[0] * scalar, vector[1] * scalar];
}

function dot(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[0] + left[1] * right[1];
}

function cross(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[1] - left[1] * right[0];
}

function distanceBetween(left: SketchPoint2D, right: SketchPoint2D) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function pointsAlmostEqual(left: SketchPoint2D, right: SketchPoint2D) {
  return distanceBetween(left, right) <= EPSILON;
}

function normalize(vector: SketchPoint2D): SketchPoint2D | null {
  const length = Math.hypot(vector[0], vector[1]);
  return length <= EPSILON ? null : [vector[0] / length, vector[1] / length];
}

function leftNormal(vector: SketchPoint2D): SketchPoint2D | null {
  const unit = normalize(vector);
  return unit ? [-unit[1], unit[0]] : null;
}

function midpoint(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2];
}

function normalizedDifferential(
  vector: SketchPoint2D,
  differential: SketchPoint2D,
): SketchPoint2D | null {
  const unit = normalize(vector);
  const magnitude = Math.hypot(vector[0], vector[1]);
  if (!unit || magnitude <= EPSILON) return null;
  const along = dot(unit, differential);
  return [
    (differential[0] - unit[0] * along) / magnitude,
    (differential[1] - unit[1] * along) / magnitude,
  ];
}

function solveDifferentialSystem(
  firstRow: SketchPoint2D,
  secondRow: SketchPoint2D,
  firstValue: number,
  secondValue: number,
): SketchPoint2D | null {
  const determinant = cross(firstRow, secondRow);
  if (Math.abs(determinant) <= EPSILON) return null;
  return [
    (firstValue * secondRow[1] - firstRow[1] * secondValue) / determinant,
    (firstRow[0] * secondValue - firstValue * secondRow[0]) / determinant,
  ];
}

function lineCircleIntersectionDifferential(input: {
  intersection: SketchPoint2D;
  lineStart: SketchPoint2D;
  lineEnd: SketchPoint2D;
  center: SketchPoint2D;
  radius: number;
  lineStartVariation: SketchPoint2D;
  lineEndVariation: SketchPoint2D;
  centerVariation: SketchPoint2D;
  radiusVariation: number;
}): SketchPoint2D | null {
  const direction = subtract(input.lineEnd, input.lineStart);
  const directionVariation = subtract(
    input.lineEndVariation,
    input.lineStartVariation,
  );
  const fromStart = subtract(input.intersection, input.lineStart);
  const radial = subtract(input.intersection, input.center);
  return solveDifferentialSystem(
    [-direction[1], direction[0]],
    radial,
    cross(direction, input.lineStartVariation) -
      cross(directionVariation, fromStart),
    dot(radial, input.centerVariation) + input.radius * input.radiusVariation,
  );
}

function circleCircleIntersectionDifferential(input: {
  intersection: SketchPoint2D;
  firstCenter: SketchPoint2D;
  firstRadius: number;
  secondCenter: SketchPoint2D;
  secondRadius: number;
  firstCenterVariation: SketchPoint2D;
  firstRadiusVariation: number;
  secondCenterVariation: SketchPoint2D;
  secondRadiusVariation: number;
}): SketchPoint2D | null {
  const firstRadial = subtract(input.intersection, input.firstCenter);
  const secondRadial = subtract(input.intersection, input.secondCenter);
  return solveDifferentialSystem(
    firstRadial,
    secondRadial,
    dot(firstRadial, input.firstCenterVariation) +
      input.firstRadius * input.firstRadiusVariation,
    dot(secondRadial, input.secondCenterVariation) +
      input.secondRadius * input.secondRadiusVariation,
  );
}

function lineIntersectionDifferential(input: {
  start: SketchPoint2D;
  end: SketchPoint2D;
  otherStart: SketchPoint2D;
  otherEnd: SketchPoint2D;
  startVariation: SketchPoint2D;
  endVariation: SketchPoint2D;
  otherStartVariation: SketchPoint2D;
  otherEndVariation: SketchPoint2D;
}): SketchPoint2D | null {
  const direction = subtract(input.end, input.start);
  const otherDirection = subtract(input.otherEnd, input.otherStart);
  const directionVariation = subtract(input.endVariation, input.startVariation);
  const otherDirectionVariation = subtract(
    input.otherEndVariation,
    input.otherStartVariation,
  );
  const separation = subtract(input.otherStart, input.start);
  const separationVariation = subtract(
    input.otherStartVariation,
    input.startVariation,
  );
  const denominator = cross(direction, otherDirection);
  if (Math.abs(denominator) <= EPSILON) return null;
  const numerator = cross(separation, otherDirection);
  const denominatorVariation =
    cross(directionVariation, otherDirection) +
    cross(direction, otherDirectionVariation);
  const numeratorVariation =
    cross(separationVariation, otherDirection) +
    cross(separation, otherDirectionVariation);
  const parameter = numerator / denominator;
  const parameterVariation =
    (numeratorVariation * denominator - numerator * denominatorVariation) /
    (denominator * denominator);
  return add(
    input.startVariation,
    add(
      scale(directionVariation, parameter),
      scale(direction, parameterVariation),
    ),
  );
}

/** Offsets both endpoints of a line to the left of start->end by `distance`. */
export function offsetLinePoints(
  start: SketchPoint2D,
  end: SketchPoint2D,
  distance: number,
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  const normal = leftNormal(subtract(end, start));
  if (!normal) {
    return null;
  }

  const offset = scale(normal, distance);
  return { start: add(start, offset), end: add(end, offset) };
}

/** Repositions `point` on the ray from `center` through `point` at `radius`. */
export function scalePointFromCenter(
  center: SketchPoint2D,
  point: SketchPoint2D,
  radius: number,
): SketchPoint2D | null {
  const direction = normalize(subtract(point, center));
  return direction ? add(center, scale(direction, radius)) : null;
}

/**
 * Displaces every polyline point along the local left normal (averaged from
 * its neighbor directions) by `distance`. Positive is left of traversal.
 */
export function offsetPolylinePoints(
  points: readonly SketchPoint2D[],
  distance: number,
): SketchPoint2D[] {
  return points.map((point, index) => {
    const previous = points[Math.max(0, index - 1)]!;
    const next = points[Math.min(points.length - 1, index + 1)]!;
    const normal = leftNormal(subtract(next, previous));
    return normal ? add(point, scale(normal, distance)) : point;
  });
}

export function offsetSeedCurveFromEntity(
  entity: SketchEntityDefinition,
  getPointPosition: (pointId: SketchPointId) => SketchPoint2D | null,
): OffsetSeedCurve | null {
  switch (entity.kind) {
    case "lineSegment": {
      const start = getPointPosition(entity.startPointId);
      const end = getPointPosition(entity.endPointId);
      return start && end
        ? { kind: "lineSegment", seedEntityId: entity.entityId, start, end }
        : null;
    }
    case "circle": {
      const center = getPointPosition(entity.centerPointId);
      return center
        ? {
            kind: "circle",
            seedEntityId: entity.entityId,
            center,
            radius: entity.radius,
          }
        : null;
    }
    case "arc": {
      const center = getPointPosition(entity.centerPointId);
      const start = getPointPosition(entity.startPointId);
      const end = getPointPosition(entity.endPointId);
      return center && start && end
        ? {
            kind: "arc",
            seedEntityId: entity.entityId,
            center,
            start,
            end,
            sweepDirection: entity.sweepDirection,
          }
        : null;
    }
    case "spline": {
      const points = orderedSplinePointIds(entity).map((pointId) =>
        getPointPosition(pointId),
      );
      return points.every((point): point is SketchPoint2D => point !== null) &&
        points.length >= 3
        ? { kind: "spline", seedEntityId: entity.entityId, points }
        : null;
    }
    default:
      return null;
  }
}

type SweepDirection = "clockwise" | "counterClockwise";

function flipSweep(sweep: SweepDirection): SweepDirection {
  return sweep === "clockwise" ? "counterClockwise" : "clockwise";
}

function angleOf(center: SketchPoint2D, point: SketchPoint2D) {
  return Math.atan2(point[1] - center[1], point[0] - center[0]);
}

function arcSweepAngle(
  center: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweep: SweepDirection,
) {
  const fullTurn = Math.PI * 2;
  const startAngle = angleOf(center, start);
  const endAngle = angleOf(center, end);
  const delta =
    sweep === "counterClockwise"
      ? endAngle - startAngle
      : startAngle - endAngle;
  return ((delta % fullTurn) + fullTurn) % fullTurn;
}

function sampleArcPoints(
  center: SketchPoint2D,
  radius: number,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweep: SweepDirection,
  sampleCount: number,
): SketchPoint2D[] {
  const startAngle = angleOf(center, start);
  const sweepAngle = arcSweepAngle(center, start, end, sweep);
  const direction = sweep === "counterClockwise" ? 1 : -1;
  return Array.from({ length: sampleCount + 1 }, (_, index) => {
    const angle = startAngle + direction * sweepAngle * (index / sampleCount);
    return [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
    ] as const;
  });
}

/** Unit tangent along the traversal direction at an arc endpoint. */
function arcTangentAt(
  center: SketchPoint2D,
  point: SketchPoint2D,
  sweep: SweepDirection,
): SketchPoint2D | null {
  const radial = normalize(subtract(point, center));
  if (!radial) {
    return null;
  }

  return sweep === "counterClockwise"
    ? [-radial[1], radial[0]]
    : [radial[1], -radial[0]];
}

function infiniteLineIntersection(
  start: SketchPoint2D,
  end: SketchPoint2D,
  otherStart: SketchPoint2D,
  otherEnd: SketchPoint2D,
): SketchPoint2D | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const otherDx = otherEnd[0] - otherStart[0];
  const otherDy = otherEnd[1] - otherStart[1];
  const denominator = dx * otherDy - dy * otherDx;
  if (Math.abs(denominator) <= EPSILON) {
    return null;
  }

  const offsetX = otherStart[0] - start[0];
  const offsetY = otherStart[1] - start[1];
  const t = (offsetX * otherDy - offsetY * otherDx) / denominator;
  return [start[0] + dx * t, start[1] + dy * t];
}

function lineCircleIntersections(
  lineStart: SketchPoint2D,
  lineEnd: SketchPoint2D,
  center: SketchPoint2D,
  radius: number,
): SketchPoint2D[] {
  const direction = normalize(subtract(lineEnd, lineStart));
  if (!direction) {
    return [];
  }

  const toCenter = subtract(center, lineStart);
  const projection = dot(toCenter, direction);
  const closest = add(lineStart, scale(direction, projection));
  const offsetSquared = radius * radius - distanceBetween(closest, center) ** 2;
  if (offsetSquared < -EPSILON) {
    return [];
  }

  const half = Math.sqrt(Math.max(0, offsetSquared));
  if (half <= EPSILON) {
    return [closest];
  }

  return [
    add(closest, scale(direction, half)),
    add(closest, scale(direction, -half)),
  ];
}

function circleCircleIntersections(
  firstCenter: SketchPoint2D,
  firstRadius: number,
  secondCenter: SketchPoint2D,
  secondRadius: number,
): SketchPoint2D[] {
  const between = distanceBetween(firstCenter, secondCenter);
  if (
    between <= EPSILON ||
    between > firstRadius + secondRadius + EPSILON ||
    between < Math.abs(firstRadius - secondRadius) - EPSILON
  ) {
    return [];
  }

  const along =
    (firstRadius * firstRadius -
      secondRadius * secondRadius +
      between * between) /
    (2 * between);
  const acrossSquared = firstRadius * firstRadius - along * along;
  const direction = normalize(subtract(secondCenter, firstCenter))!;
  const base = add(firstCenter, scale(direction, along));
  const across = Math.sqrt(Math.max(0, acrossSquared));
  if (across <= EPSILON) {
    return [base];
  }

  const normal: SketchPoint2D = [-direction[1], direction[0]];
  return [add(base, scale(normal, across)), add(base, scale(normal, -across))];
}

function nearestPoint(
  candidates: readonly SketchPoint2D[],
  reference: SketchPoint2D,
): SketchPoint2D | null {
  let best: SketchPoint2D | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const candidateDistance = distanceBetween(candidate, reference);
    if (candidateDistance < bestDistance) {
      best = candidate;
      bestDistance = candidateDistance;
    }
  }
  return best;
}

function pointToPolylineDistance(
  point: SketchPoint2D,
  polyline: readonly SketchPoint2D[],
) {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index + 1 < polyline.length; index += 1) {
    const start = polyline[index]!;
    const end = polyline[index + 1]!;
    const direction = subtract(end, start);
    const lengthSquared = dot(direction, direction);
    const t =
      lengthSquared <= EPSILON * EPSILON
        ? 0
        : Math.max(
            0,
            Math.min(1, dot(subtract(point, start), direction) / lengthSquared),
          );
    const closest = add(start, scale(direction, t));
    best = Math.min(best, distanceBetween(point, closest));
  }
  return best;
}

interface SplineOffsetSuccess {
  ok: true;
  points: SketchPoint2D[];
}

interface SplineOffsetFailure {
  ok: false;
  maxDeviation: number;
}

/**
 * Offsets a spline (interpreted through its fit-point polyline) by building
 * the exact offset (per-segment translation plus vertex arcs/trims) and
 * refitting through curvature-adaptive fit points: starting from the offset
 * endpoints, the exact vertex farthest from the fit polyline is inserted
 * until the deviation conforms or the refinement bound is reached, which
 * concentrates fit points where the offset curves. `targetPointCount`, when
 * given, freezes the output fit-point count so recompute preserves stable
 * point identities; otherwise the count refines adaptively up to
 * OFFSET_SPLINE_MAX_FIT_POINTS.
 */
export function offsetSplineFitPoints(input: {
  points: readonly SketchPoint2D[];
  distance: number;
  targetPointCount?: number;
}): SplineOffsetSuccess | SplineOffsetFailure {
  const exact = buildExactPolylineOffset(input.points, input.distance);
  if (!exact || exact.length < 2) {
    return { ok: false, maxDeviation: Number.POSITIVE_INFINITY };
  }

  const tolerance = Math.max(
    Math.abs(input.distance) * OFFSET_SPLINE_RELATIVE_TOLERANCE,
    1e-9,
  );
  const cap =
    input.targetPointCount !== undefined
      ? Math.max(OFFSET_SPLINE_MIN_FIT_POINTS, input.targetPointCount)
      : OFFSET_SPLINE_MAX_FIT_POINTS;

  const chosen = [0, exact.length - 1];
  const chosenSet = new Set(chosen);
  const worstRemaining = () => {
    const fit = chosen.map((index) => exact[index]!);
    let worstIndex = -1;
    let worstDistance = 0;
    for (let index = 1; index < exact.length - 1; index += 1) {
      if (chosenSet.has(index)) {
        continue;
      }
      const deviation = pointToPolylineDistance(exact[index]!, fit);
      if (deviation > worstDistance) {
        worstDistance = deviation;
        worstIndex = index;
      }
    }
    return { worstIndex, worstDistance };
  };

  for (;;) {
    const { worstIndex, worstDistance } = worstRemaining();
    const wantsMore =
      input.targetPointCount !== undefined
        ? chosen.length < cap
        : worstDistance > tolerance && chosen.length < cap;
    if (!wantsMore || worstIndex < 0) {
      if (worstDistance > tolerance) {
        return { ok: false, maxDeviation: worstDistance };
      }
      break;
    }

    const insertAt = chosen.findIndex((index) => index > worstIndex);
    chosen.splice(insertAt === -1 ? chosen.length : insertAt, 0, worstIndex);
    chosenSet.add(worstIndex);
  }

  const points = chosen.map((index) => exact[index]!);
  const required =
    input.targetPointCount !== undefined
      ? cap
      : Math.max(OFFSET_SPLINE_MIN_FIT_POINTS, points.length);
  while (points.length < required) {
    // Pad by splitting the longest fit span at its midpoint; the midpoint
    // lies on the fit polyline so the shape and deviation are unchanged.
    let longest = -1;
    let at = 0;
    for (let index = 0; index + 1 < points.length; index += 1) {
      const length = distanceBetween(points[index]!, points[index + 1]!);
      if (length > longest) {
        longest = length;
        at = index;
      }
    }
    points.splice(at + 1, 0, midpoint(points[at]!, points[at + 1]!));
  }

  return { ok: true, points };
}

function buildExactPolylineOffset(
  points: readonly SketchPoint2D[],
  distance: number,
): SketchPoint2D[] | null {
  const cleaned: SketchPoint2D[] = [];
  for (const point of points) {
    if (
      cleaned.length === 0 ||
      !pointsAlmostEqual(cleaned[cleaned.length - 1]!, point)
    ) {
      cleaned.push(point);
    }
  }

  if (cleaned.length < 2) {
    return null;
  }

  const segments = Array.from({ length: cleaned.length - 1 }, (_, index) => {
    const start = cleaned[index]!;
    const end = cleaned[index + 1]!;
    const normal = leftNormal(subtract(end, start))!;
    const offset = scale(normal, distance);
    return {
      direction: normalize(subtract(end, start))!,
      offsetStart: add(start, offset),
      offsetEnd: add(end, offset),
    };
  });

  const result: SketchPoint2D[] = [segments[0]!.offsetStart];
  for (let index = 1; index < segments.length; index += 1) {
    const previous = segments[index - 1]!;
    const current = segments[index]!;
    const vertex = cleaned[index]!;
    const turn = cross(previous.direction, current.direction);

    if (Math.abs(turn) <= EPSILON) {
      result.push(midpoint(previous.offsetEnd, current.offsetStart));
      continue;
    }

    if (turn * distance > 0) {
      result.push(
        infiniteLineIntersection(
          previous.offsetStart,
          previous.offsetEnd,
          current.offsetStart,
          current.offsetEnd,
        ) ?? midpoint(previous.offsetEnd, current.offsetStart),
      );
      continue;
    }

    const sweep: SweepDirection =
      cross(
        subtract(previous.offsetEnd, vertex),
        subtract(current.offsetStart, vertex),
      ) >= 0
        ? "counterClockwise"
        : "clockwise";
    const sampleCount = Math.max(
      2,
      Math.ceil(
        arcSweepAngle(vertex, previous.offsetEnd, current.offsetStart, sweep) /
          (Math.PI / 16),
      ),
    );
    result.push(
      ...sampleArcPoints(
        vertex,
        Math.abs(distance),
        previous.offsetEnd,
        current.offsetStart,
        sweep,
        sampleCount,
      ),
    );
  }

  result.push(segments[segments.length - 1]!.offsetEnd);
  return result;
}

type WorkSegment =
  | {
      kind: "lineSegment";
      seedEntityId: SketchEntityId;
      reversed: boolean;
      rawStart: SketchPoint2D;
      rawEnd: SketchPoint2D;
      start: SketchPoint2D;
      end: SketchPoint2D;
      startTangent: SketchPoint2D;
      endTangent: SketchPoint2D;
    }
  | {
      kind: "arc";
      seedEntityId: SketchEntityId;
      reversed: boolean;
      center: SketchPoint2D;
      radius: number;
      start: SketchPoint2D;
      end: SketchPoint2D;
      sweep: SweepDirection;
    }
  | {
      kind: "spline";
      seedEntityId: SketchEntityId;
      reversed: boolean;
      points: SketchPoint2D[];
    };

function segmentTraversalStart(segment: WorkSegment): SketchPoint2D {
  return segment.kind === "spline" ? segment.points[0]! : segment.start;
}

function segmentTraversalEnd(segment: WorkSegment): SketchPoint2D {
  return segment.kind === "spline"
    ? segment.points[segment.points.length - 1]!
    : segment.end;
}

function setSegmentTraversalStart(segment: WorkSegment, point: SketchPoint2D) {
  if (segment.kind === "spline") {
    segment.points[0] = point;
  } else {
    segment.start = point;
  }
}

function setSegmentTraversalEnd(segment: WorkSegment, point: SketchPoint2D) {
  if (segment.kind === "spline") {
    segment.points[segment.points.length - 1] = point;
  } else {
    segment.end = point;
  }
}

function segmentStartTangent(segment: WorkSegment): SketchPoint2D | null {
  switch (segment.kind) {
    case "lineSegment":
      return segment.startTangent;
    case "arc":
      return arcTangentAt(segment.center, segment.start, segment.sweep);
    case "spline": {
      for (let index = 1; index < segment.points.length; index += 1) {
        const direction = normalize(
          subtract(segment.points[index]!, segment.points[0]!),
        );
        if (direction) {
          return direction;
        }
      }
      return null;
    }
  }
}

function segmentEndTangent(segment: WorkSegment): SketchPoint2D | null {
  switch (segment.kind) {
    case "lineSegment":
      return segment.endTangent;
    case "arc":
      return arcTangentAt(segment.center, segment.end, segment.sweep);
    case "spline": {
      const last = segment.points[segment.points.length - 1]!;
      for (let index = segment.points.length - 2; index >= 0; index -= 1) {
        const direction = normalize(subtract(last, segment.points[index]!));
        if (direction) {
          return direction;
        }
      }
      return null;
    }
  }
}

interface ChainNode {
  position: SketchPoint2D;
  incident: number[];
}

interface TraversalEntry {
  curveIndex: number;
  reversed: boolean;
}

function curveEndpoints(
  curve: Exclude<OffsetSeedCurve, { kind: "circle" }>,
): readonly [SketchPoint2D, SketchPoint2D] {
  switch (curve.kind) {
    case "lineSegment":
    case "arc":
      return [curve.start, curve.end];
    case "spline":
      return [curve.points[0]!, curve.points[curve.points.length - 1]!];
  }
}

function buildTraversal(
  curves: readonly Exclude<OffsetSeedCurve, { kind: "circle" }>[],
):
  | { ok: true; entries: TraversalEntry[]; closed: boolean }
  | { ok: false; message: string; seedEntityId: SketchEntityId | null } {
  const nodes: ChainNode[] = [];
  const endpointNodes: [number, number][] = [];

  const findOrCreateNode = (point: SketchPoint2D) => {
    const existing = nodes.findIndex((node) =>
      pointsAlmostEqual(node.position, point),
    );
    if (existing >= 0) {
      return existing;
    }
    nodes.push({ position: point, incident: [] });
    return nodes.length - 1;
  };

  for (const [index, curve] of curves.entries()) {
    const [start, end] = curveEndpoints(curve);
    if (pointsAlmostEqual(start, end) && curve.kind !== "spline") {
      return {
        ok: false,
        message: "Offset seed segment is too short.",
        seedEntityId: curve.seedEntityId,
      };
    }

    const startNode = findOrCreateNode(start);
    const endNode = findOrCreateNode(end);
    endpointNodes.push([startNode, endNode]);
    nodes[startNode]!.incident.push(index);
    if (endNode !== startNode) {
      nodes[endNode]!.incident.push(index);
    }
  }

  if (nodes.some((node) => node.incident.length > 2)) {
    return {
      ok: false,
      message: "Offset selection must form a simple connected chain.",
      seedEntityId: null,
    };
  }

  const openEnds = nodes.filter((node) => node.incident.length === 1);
  const closed =
    openEnds.length === 0 ||
    (curves.length === 1 && endpointNodes[0]![0] === endpointNodes[0]![1]);
  if (!closed && openEnds.length !== 2) {
    return {
      ok: false,
      message: "Offset selection must form a single connected chain.",
      seedEntityId: null,
    };
  }

  const [firstStartNode, firstEndNode] = endpointNodes[0]!;
  const entries: TraversalEntry[] = [{ curveIndex: 0, reversed: false }];
  const used = new Set([0]);
  let cursor = firstEndNode;

  while (used.size < curves.length) {
    const nextIndex = nodes[cursor]!.incident.find(
      (candidate) => !used.has(candidate),
    );
    if (nextIndex === undefined) {
      break;
    }

    const [nextStart, nextEnd] = endpointNodes[nextIndex]!;
    entries.push({ curveIndex: nextIndex, reversed: nextStart !== cursor });
    used.add(nextIndex);
    cursor = nextStart === cursor ? nextEnd : nextStart;
  }

  if (used.size < curves.length && !closed) {
    // The first curve may sit mid-chain; extend backwards from its start.
    const prefix: TraversalEntry[] = [];
    let backCursor = firstStartNode;
    for (;;) {
      const previousIndex = nodes[backCursor]!.incident.find(
        (candidate) => !used.has(candidate),
      );
      if (previousIndex === undefined) {
        break;
      }

      const [previousStart, previousEnd] = endpointNodes[previousIndex]!;
      prefix.unshift({
        curveIndex: previousIndex,
        reversed: previousEnd !== backCursor,
      });
      used.add(previousIndex);
      backCursor = previousStart === backCursor ? previousEnd : previousStart;
    }
    entries.unshift(...prefix);
  }

  if (used.size < curves.length) {
    return {
      ok: false,
      message: "Offset selection must form a single connected chain.",
      seedEntityId: null,
    };
  }

  if (closed && cursor !== firstStartNode) {
    return {
      ok: false,
      message: "Offset selection must form a single connected loop.",
      seedEntityId: null,
    };
  }

  return { ok: true, entries, closed };
}

function failure(
  code: OffsetDiagnosticCode,
  message: string,
  seedEntityId: SketchEntityId | null = null,
): OffsetChainFailure {
  return { ok: false, code, message, seedEntityId };
}

/**
 * Computes the derived offset geometry for a connected seed chain.
 *
 * `splineFitPointCounts` freezes per-spline output fit-point counts so a
 * recompute maps onto previously committed stable point identities; omit it
 * when authoring so counts refine adaptively.
 */
export function computeOffsetChain(input: {
  curves: readonly OffsetSeedCurve[];
  distance: number;
  splineFitPointCounts?: ReadonlyMap<SketchEntityId, number>;
}): OffsetChainResult {
  const { curves, distance } = input;
  if (curves.length === 0) {
    return failure(
      OFFSET_DIAGNOSTIC_CODES.disconnectedChain,
      "Offset needs at least one seed segment.",
    );
  }

  if (!Number.isFinite(distance) || Math.abs(distance) <= EPSILON) {
    return failure(
      OFFSET_DIAGNOSTIC_CODES.unresolvedDistance,
      "Offset distance must be a non-zero finite number.",
    );
  }

  const circles = curves.filter((curve) => curve.kind === "circle");
  if (circles.length > 0) {
    if (curves.length > 1) {
      return failure(
        OFFSET_DIAGNOSTIC_CODES.disconnectedChain,
        "A circle cannot join an offset chain with other segments.",
        circles[0]!.seedEntityId,
      );
    }

    const circle = circles[0]!;
    // Circles traverse counter-clockwise, so a positive (left) distance
    // points toward the center and shrinks the radius.
    const radius = circle.radius - distance;
    if (radius <= EPSILON) {
      return failure(
        OFFSET_DIAGNOSTIC_CODES.arcCollapse,
        "Offset distance collapses the circle radius.",
        circle.seedEntityId,
      );
    }

    return {
      ok: true,
      closed: true,
      order: [{ seedEntityId: circle.seedEntityId, reversed: false }],
      segments: [
        {
          kind: "circle",
          seedEntityId: circle.seedEntityId,
          center: circle.center,
          radius,
        },
      ],
      joints: [],
    };
  }

  const openCurves = curves as readonly Exclude<
    OffsetSeedCurve,
    { kind: "circle" }
  >[];
  const traversal = buildTraversal(openCurves);
  if (!traversal.ok) {
    return failure(
      OFFSET_DIAGNOSTIC_CODES.disconnectedChain,
      traversal.message,
      traversal.seedEntityId,
    );
  }

  const workSegments: WorkSegment[] = [];
  for (const entry of traversal.entries) {
    const curve = openCurves[entry.curveIndex]!;
    const work = offsetWorkSegment(
      curve,
      entry.reversed,
      distance,
      input.splineFitPointCounts?.get(curve.seedEntityId),
    );
    if ("code" in work) {
      return work;
    }
    workSegments.push(work);
  }

  const joints: OffsetJointGeometry[] = [];
  const jointCount = traversal.closed
    ? workSegments.length
    : workSegments.length - 1;
  for (let index = 0; index < jointCount; index += 1) {
    const first = workSegments[index]!;
    const second = workSegments[(index + 1) % workSegments.length]!;
    const seedVertex = segmentSharedSeedVertex(
      openCurves[traversal.entries[index]!.curveIndex]!,
      traversal.entries[index]!.reversed,
    );
    const joint = resolveJoint(first, second, seedVertex, distance);
    if (!joint.ok) {
      return joint.failure;
    }
    if (joint.arc) {
      joints.push(joint.arc);
    }
  }

  for (const segment of workSegments) {
    if (
      segment.kind === "lineSegment" &&
      dot(
        subtract(segment.end, segment.start),
        subtract(segment.rawEnd, segment.rawStart),
      ) <= EPSILON
    ) {
      return failure(
        OFFSET_DIAGNOSTIC_CODES.selfIntersection,
        "Offset distance inverts a trimmed segment.",
        segment.seedEntityId,
      );
    }
  }

  const crossing = findChainSelfIntersection(workSegments, traversal.closed);
  if (crossing) {
    return failure(
      OFFSET_DIAGNOSTIC_CODES.selfIntersection,
      "Offset result intersects itself at the requested distance.",
      crossing,
    );
  }

  const segments = workSegments.map((segment): OffsetSegmentGeometry => {
    switch (segment.kind) {
      case "lineSegment":
        return {
          kind: "lineSegment",
          seedEntityId: segment.seedEntityId,
          start: segment.reversed ? segment.end : segment.start,
          end: segment.reversed ? segment.start : segment.end,
        };
      case "arc":
        return {
          kind: "arc",
          seedEntityId: segment.seedEntityId,
          center: segment.center,
          start: segment.reversed ? segment.end : segment.start,
          end: segment.reversed ? segment.start : segment.end,
          sweepDirection: segment.reversed
            ? flipSweep(segment.sweep)
            : segment.sweep,
        };
      case "spline":
        return {
          kind: "spline",
          seedEntityId: segment.seedEntityId,
          points: segment.reversed
            ? [...segment.points].reverse()
            : segment.points,
        };
    }
  });

  return {
    ok: true,
    closed: traversal.closed,
    order: traversal.entries.map((entry) => ({
      seedEntityId: openCurves[entry.curveIndex]!.seedEntityId,
      reversed: entry.reversed,
    })),
    segments,
    joints,
  };
}

/**
 * Evaluates the analytic directional derivative of `computeOffsetChain` while
 * retaining its resolved topology. This bounded owner supports exact
 * line/circle/arc segments, line-line trim intersections, and committed arc
 * joins. Spline offsets are intentionally rejected here: the current spline
 * offset is a fit-point-polyline approximation, not the authoritative neutral
 * cubic spline geometry, so it cannot become solver derivative authority.
 */
export function computeOffsetChainJvp(input: {
  curves: readonly OffsetSeedCurve[];
  curveVariations: readonly OffsetSeedCurveVariation[];
  distance: number;
  distanceVariation?: number;
  splineFitPointCounts?: ReadonlyMap<SketchEntityId, number>;
}): OffsetChainJvpResult {
  if (input.curves.length !== input.curveVariations.length) {
    return failure(
      OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
      "Offset derivative inputs do not match the seed chain.",
    );
  }
  if (input.curves.some((curve) => curve.kind === "spline")) {
    return failure(
      OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
      "Spline offset derivatives require the authoritative neutral-cubic offset owner.",
      input.curves.find((curve) => curve.kind === "spline")!.seedEntityId,
    );
  }
  const primal = computeOffsetChain(input);
  if (!primal.ok) return primal;

  const distanceVariation = input.distanceVariation ?? 0;
  const variationBySeed = new Map<SketchEntityId, OffsetSeedCurveVariation>();
  input.curves.forEach((curve, index) => {
    variationBySeed.set(curve.seedEntityId, input.curveVariations[index]!);
  });
  const reversedBySeed = new Map(
    primal.order.map((entry) => [entry.seedEntityId, entry.reversed] as const),
  );
  const segmentVariations: OffsetSegmentVariation[] = [];

  for (const segment of primal.segments) {
    const curve = input.curves.find(
      (candidate) => candidate.seedEntityId === segment.seedEntityId,
    );
    const variation = variationBySeed.get(segment.seedEntityId);
    if (!curve || !variation || curve.kind !== variation.kind) {
      return failure(
        OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
        "Offset derivative seed geometry is inconsistent.",
        segment.seedEntityId,
      );
    }
    const reversed = reversedBySeed.get(segment.seedEntityId) ?? false;
    const effectiveDistance = reversed ? -input.distance : input.distance;
    const effectiveDistanceVariation = reversed
      ? -distanceVariation
      : distanceVariation;

    if (
      curve.kind === "lineSegment" &&
      variation.kind === "lineSegment" &&
      segment.kind === "lineSegment"
    ) {
      const direction = subtract(curve.end, curve.start);
      const directionVariation = subtract(variation.end, variation.start);
      const unit = normalize(direction);
      const unitVariation = normalizedDifferential(
        direction,
        directionVariation,
      );
      if (!unit || !unitVariation) {
        return failure(
          OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
          "Offset line derivative is singular.",
          curve.seedEntityId,
        );
      }
      const normal: SketchPoint2D = [-unit[1], unit[0]];
      const normalVariation: SketchPoint2D = [
        -unitVariation[1],
        unitVariation[0],
      ];
      const offsetVariation = add(
        scale(normalVariation, effectiveDistance),
        scale(normal, effectiveDistanceVariation),
      );
      segmentVariations.push({
        kind: "lineSegment",
        seedEntityId: curve.seedEntityId,
        start: add(variation.start, offsetVariation),
        end: add(variation.end, offsetVariation),
      });
      continue;
    }

    if (
      curve.kind === "circle" &&
      variation.kind === "circle" &&
      segment.kind === "circle"
    ) {
      segmentVariations.push({
        kind: "circle",
        seedEntityId: curve.seedEntityId,
        center: variation.center,
        radius: variation.radius - distanceVariation,
      });
      continue;
    }

    if (
      curve.kind === "arc" &&
      variation.kind === "arc" &&
      segment.kind === "arc"
    ) {
      const startRelative = subtract(curve.start, curve.center);
      const startRelativeVariation = subtract(
        variation.start,
        variation.center,
      );
      const startUnit = normalize(startRelative);
      const startUnitVariation = normalizedDifferential(
        startRelative,
        startRelativeVariation,
      );
      const endRelative = subtract(curve.end, curve.center);
      const endRelativeVariation = subtract(variation.end, variation.center);
      const endUnit = normalize(endRelative);
      const endUnitVariation = normalizedDifferential(
        endRelative,
        endRelativeVariation,
      );
      if (!startUnit || !startUnitVariation || !endUnit || !endUnitVariation) {
        return failure(
          OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
          "Offset arc derivative is singular.",
          curve.seedEntityId,
        );
      }
      const radius = Math.hypot(startRelative[0], startRelative[1]);
      const radiusVariation = dot(startUnit, startRelativeVariation);
      const traversalSweep = reversed
        ? flipSweep(curve.sweepDirection)
        : curve.sweepDirection;
      const sign = traversalSweep === "counterClockwise" ? -1 : 1;
      const shifted = radius + sign * input.distance;
      const shiftedVariation = radiusVariation + sign * distanceVariation;
      const endpointVariation = (
        unit: SketchPoint2D,
        unitVariation: SketchPoint2D,
      ): SketchPoint2D =>
        add(
          variation.center,
          add(scale(unitVariation, shifted), scale(unit, shiftedVariation)),
        );
      segmentVariations.push({
        kind: "arc",
        seedEntityId: curve.seedEntityId,
        center: variation.center,
        start: endpointVariation(startUnit, startUnitVariation),
        end: endpointVariation(endUnit, endUnitVariation),
        radius: shiftedVariation,
      });
      continue;
    }

    return failure(
      OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
      "Offset derivative output no longer matches its seed geometry.",
      segment.seedEntityId,
    );
  }

  const segmentVariationBySeed = new Map(
    segmentVariations.map(
      (segment) => [segment.seedEntityId, segment] as const,
    ),
  );
  const rawSegmentVariationBySeed = new Map(
    segmentVariations.map(
      (segment) =>
        [
          segment.seedEntityId,
          segment.kind === "lineSegment"
            ? {
                ...segment,
                start: [...segment.start] as SketchPoint2D,
                end: [...segment.end] as SketchPoint2D,
              }
            : segment,
        ] as const,
    ),
  );
  const segmentBySeed = new Map(
    primal.segments.map((segment) => [segment.seedEntityId, segment] as const),
  );
  const rawSegmentBySeed = new Map<SketchEntityId, OffsetSegmentGeometry>();
  for (const curve of input.curves) {
    const reversed = reversedBySeed.get(curve.seedEntityId) ?? false;
    const effective = reversed ? -input.distance : input.distance;
    if (curve.kind === "lineSegment") {
      const offset = offsetLinePoints(curve.start, curve.end, effective);
      if (offset) {
        rawSegmentBySeed.set(curve.seedEntityId, {
          kind: "lineSegment",
          seedEntityId: curve.seedEntityId,
          ...offset,
        });
      }
    } else if (curve.kind === "arc") {
      const traversalSweep = reversed
        ? flipSweep(curve.sweepDirection)
        : curve.sweepDirection;
      const radius = distanceBetween(curve.center, curve.start);
      const shifted =
        traversalSweep === "counterClockwise"
          ? radius - input.distance
          : radius + input.distance;
      const start = scalePointFromCenter(curve.center, curve.start, shifted);
      const end = scalePointFromCenter(curve.center, curve.end, shifted);
      if (start && end) {
        rawSegmentBySeed.set(curve.seedEntityId, {
          kind: "arc",
          seedEntityId: curve.seedEntityId,
          center: curve.center,
          start,
          end,
          sweepDirection: curve.sweepDirection,
        });
      }
    }
  }
  const traversalEndpoint = (
    segment: Exclude<OffsetSegmentGeometry, { kind: "circle" | "spline" }>,
    reversed: boolean,
    endpoint: "start" | "end",
  ) =>
    endpoint === "start"
      ? reversed
        ? segment.end
        : segment.start
      : reversed
        ? segment.start
        : segment.end;
  const variationEndpoint = (
    segment: Exclude<OffsetSegmentVariation, { kind: "circle" }>,
    reversed: boolean,
    endpoint: "start" | "end",
  ) =>
    endpoint === "start"
      ? reversed
        ? segment.end
        : segment.start
      : reversed
        ? segment.start
        : segment.end;
  const setVariationEndpoint = (
    segment: Exclude<OffsetSegmentVariation, { kind: "circle" }>,
    reversed: boolean,
    endpoint: "start" | "end",
    value: SketchPoint2D,
  ) => {
    const naturalEndpoint = reversed
      ? endpoint === "start"
        ? "end"
        : "start"
      : endpoint;
    segment[naturalEndpoint] = value;
  };
  const jointPairs = new Set(
    primal.joints.map(
      (joint) => `${joint.firstSeedEntityId}\u0000${joint.secondSeedEntityId}`,
    ),
  );
  const adjacentCount =
    primal.order.length === 1
      ? 0
      : primal.closed
        ? primal.order.length
        : primal.order.length - 1;
  for (let index = 0; index < adjacentCount; index += 1) {
    const firstOrder = primal.order[index]!;
    const secondOrder = primal.order[(index + 1) % primal.order.length]!;
    if (
      jointPairs.has(
        `${firstOrder.seedEntityId}\u0000${secondOrder.seedEntityId}`,
      )
    ) {
      continue;
    }
    const first = segmentBySeed.get(firstOrder.seedEntityId);
    const second = segmentBySeed.get(secondOrder.seedEntityId);
    const firstRaw = rawSegmentBySeed.get(firstOrder.seedEntityId);
    const secondRaw = rawSegmentBySeed.get(secondOrder.seedEntityId);
    const firstVariation = segmentVariationBySeed.get(firstOrder.seedEntityId);
    const secondVariation = segmentVariationBySeed.get(
      secondOrder.seedEntityId,
    );
    const firstRawVariation = rawSegmentVariationBySeed.get(
      firstOrder.seedEntityId,
    );
    const secondRawVariation = rawSegmentVariationBySeed.get(
      secondOrder.seedEntityId,
    );
    if (
      !first ||
      !second ||
      first.kind === "circle" ||
      first.kind === "spline" ||
      second.kind === "circle" ||
      second.kind === "spline" ||
      !firstRaw ||
      firstRaw.kind === "circle" ||
      firstRaw.kind === "spline" ||
      !secondRaw ||
      secondRaw.kind === "circle" ||
      secondRaw.kind === "spline" ||
      !firstVariation ||
      firstVariation.kind === "circle" ||
      !secondVariation ||
      secondVariation.kind === "circle" ||
      !firstRawVariation ||
      firstRawVariation.kind === "circle" ||
      !secondRawVariation ||
      secondRawVariation.kind === "circle"
    ) {
      return failure(
        OFFSET_DIAGNOSTIC_CODES.derivativeUnavailable,
        "Offset adjacency derivative topology is unsupported.",
        firstOrder.seedEntityId,
      );
    }
    const firstRawEnd = traversalEndpoint(firstRaw, firstOrder.reversed, "end");
    const secondRawStart = traversalEndpoint(
      secondRaw,
      secondOrder.reversed,
      "start",
    );
    let reconciledVariation: SketchPoint2D | null;
    if (pointsAlmostEqual(firstRawEnd, secondRawStart)) {
      reconciledVariation = variationEndpoint(
        firstRawVariation,
        firstOrder.reversed,
        "end",
      );
    } else {
      const intersection = traversalEndpoint(first, firstOrder.reversed, "end");
      if (firstRaw.kind === "lineSegment" && secondRaw.kind === "lineSegment") {
        reconciledVariation = lineIntersectionDifferential({
          start: firstRaw.start,
          end: firstRaw.end,
          otherStart: secondRaw.start,
          otherEnd: secondRaw.end,
          startVariation: firstRawVariation.start,
          endVariation: firstRawVariation.end,
          otherStartVariation: secondRawVariation.start,
          otherEndVariation: secondRawVariation.end,
        });
      } else if (
        firstRaw.kind === "lineSegment" &&
        secondRaw.kind === "arc" &&
        firstRawVariation.kind === "lineSegment" &&
        secondRawVariation.kind === "arc"
      ) {
        reconciledVariation = lineCircleIntersectionDifferential({
          intersection,
          lineStart: firstRaw.start,
          lineEnd: firstRaw.end,
          center: secondRaw.center,
          radius: distanceBetween(secondRaw.center, secondRaw.start),
          lineStartVariation: firstRawVariation.start,
          lineEndVariation: firstRawVariation.end,
          centerVariation: secondRawVariation.center,
          radiusVariation: secondRawVariation.radius,
        });
      } else if (
        firstRaw.kind === "arc" &&
        secondRaw.kind === "lineSegment" &&
        firstRawVariation.kind === "arc" &&
        secondRawVariation.kind === "lineSegment"
      ) {
        reconciledVariation = lineCircleIntersectionDifferential({
          intersection,
          lineStart: secondRaw.start,
          lineEnd: secondRaw.end,
          center: firstRaw.center,
          radius: distanceBetween(firstRaw.center, firstRaw.start),
          lineStartVariation: secondRawVariation.start,
          lineEndVariation: secondRawVariation.end,
          centerVariation: firstRawVariation.center,
          radiusVariation: firstRawVariation.radius,
        });
      } else if (
        firstRaw.kind === "arc" &&
        secondRaw.kind === "arc" &&
        firstRawVariation.kind === "arc" &&
        secondRawVariation.kind === "arc"
      ) {
        reconciledVariation = circleCircleIntersectionDifferential({
          intersection,
          firstCenter: firstRaw.center,
          firstRadius: distanceBetween(firstRaw.center, firstRaw.start),
          secondCenter: secondRaw.center,
          secondRadius: distanceBetween(secondRaw.center, secondRaw.start),
          firstCenterVariation: firstRawVariation.center,
          firstRadiusVariation: firstRawVariation.radius,
          secondCenterVariation: secondRawVariation.center,
          secondRadiusVariation: secondRawVariation.radius,
        });
      } else {
        reconciledVariation = null;
      }
    }
    if (!reconciledVariation) {
      return failure(
        OFFSET_DIAGNOSTIC_CODES.derivativeUnavailable,
        "Offset adjacency derivative is singular for the resolved topology.",
        firstOrder.seedEntityId,
      );
    }
    setVariationEndpoint(
      firstVariation,
      firstOrder.reversed,
      "end",
      reconciledVariation,
    );
    setVariationEndpoint(
      secondVariation,
      secondOrder.reversed,
      "start",
      reconciledVariation,
    );
  }

  const jointVariations: OffsetJointVariation[] = [];
  for (const joint of primal.joints) {
    const firstOrder = primal.order.find(
      (entry) => entry.seedEntityId === joint.firstSeedEntityId,
    );
    const firstIndex = firstOrder ? primal.order.indexOf(firstOrder) : -1;
    const firstCurve = input.curves.find(
      (curve) => curve.seedEntityId === joint.firstSeedEntityId,
    );
    const firstCurveVariation = variationBySeed.get(joint.firstSeedEntityId);
    const firstSegmentVariation = segmentVariationBySeed.get(
      joint.firstSeedEntityId,
    );
    const secondSegmentVariation = segmentVariationBySeed.get(
      joint.secondSeedEntityId,
    );
    if (
      firstIndex < 0 ||
      !firstCurve ||
      firstCurve.kind === "circle" ||
      !firstCurveVariation ||
      firstCurveVariation.kind === "circle" ||
      firstCurveVariation.kind === "spline" ||
      !firstSegmentVariation ||
      !secondSegmentVariation ||
      firstSegmentVariation.kind === "circle" ||
      secondSegmentVariation.kind === "circle"
    ) {
      return failure(
        OFFSET_DIAGNOSTIC_CODES.jointUnsatisfied,
        "Offset joint derivative topology is unsupported.",
        joint.firstSeedEntityId,
      );
    }
    const center = firstOrder!.reversed
      ? firstCurveVariation.start
      : firstCurveVariation.end;
    const start = firstOrder!.reversed
      ? firstSegmentVariation.start
      : firstSegmentVariation.end;
    const secondOrder = primal.order[(firstIndex + 1) % primal.order.length]!;
    const end = secondOrder.reversed
      ? secondSegmentVariation.end
      : secondSegmentVariation.start;
    jointVariations.push({
      firstSeedEntityId: joint.firstSeedEntityId,
      secondSeedEntityId: joint.secondSeedEntityId,
      center,
      start,
      end,
    });
  }

  return { ok: true, segments: segmentVariations, joints: jointVariations };
}

function segmentSharedSeedVertex(
  curve: Exclude<OffsetSeedCurve, { kind: "circle" }>,
  reversed: boolean,
): SketchPoint2D {
  const [start, end] = curveEndpoints(curve);
  return reversed ? start : end;
}

function offsetWorkSegment(
  curve: Exclude<OffsetSeedCurve, { kind: "circle" }>,
  reversed: boolean,
  distance: number,
  splineFitPointCount: number | undefined,
): WorkSegment | OffsetChainFailure {
  // Traversing a curve against its natural direction flips which side is
  // "left", so the effective distance flips with it.
  const effective = reversed ? -distance : distance;

  switch (curve.kind) {
    case "lineSegment": {
      const offset = offsetLinePoints(curve.start, curve.end, effective);
      if (!offset) {
        return failure(
          OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
          "Offset seed segment is too short.",
          curve.seedEntityId,
        );
      }

      const [start, end] = reversed
        ? [offset.end, offset.start]
        : [offset.start, offset.end];
      const tangent = normalize(subtract(end, start))!;
      return {
        kind: "lineSegment",
        seedEntityId: curve.seedEntityId,
        reversed,
        rawStart: start,
        rawEnd: end,
        start,
        end,
        startTangent: tangent,
        endTangent: tangent,
      };
    }
    case "arc": {
      const radius = distanceBetween(curve.center, curve.start);
      const traversalSweep = reversed
        ? flipSweep(curve.sweepDirection)
        : curve.sweepDirection;
      // Left of counter-clockwise travel points toward the center, so ccw
      // travel shrinks the radius by the chain-level distance and cw grows it.
      const shifted =
        traversalSweep === "counterClockwise"
          ? radius - distance
          : radius + distance;
      if (shifted <= EPSILON) {
        return failure(
          OFFSET_DIAGNOSTIC_CODES.arcCollapse,
          "Offset distance collapses the arc radius.",
          curve.seedEntityId,
        );
      }

      const start = scalePointFromCenter(curve.center, curve.start, shifted);
      const end = scalePointFromCenter(curve.center, curve.end, shifted);
      if (!start || !end) {
        return failure(
          OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
          "Offset seed arc has degenerate geometry.",
          curve.seedEntityId,
        );
      }

      return {
        kind: "arc",
        seedEntityId: curve.seedEntityId,
        reversed,
        center: curve.center,
        radius: shifted,
        start: reversed ? end : start,
        end: reversed ? start : end,
        sweep: traversalSweep,
      };
    }
    case "spline": {
      const traversalPoints = reversed
        ? [...curve.points].reverse()
        : [...curve.points];
      const offset = offsetSplineFitPoints({
        points: traversalPoints,
        distance,
        targetPointCount: splineFitPointCount,
      });
      if (!offset.ok) {
        return failure(
          OFFSET_DIAGNOSTIC_CODES.splineFitFailure,
          "Offset spline approximation exceeds the supported tolerance.",
          curve.seedEntityId,
        );
      }

      return {
        kind: "spline",
        seedEntityId: curve.seedEntityId,
        reversed,
        points: offset.points,
      };
    }
  }
}

function resolveJoint(
  first: WorkSegment,
  second: WorkSegment,
  seedVertex: SketchPoint2D,
  distance: number,
):
  | { ok: true; arc: OffsetJointGeometry | null }
  | { ok: false; failure: OffsetChainFailure } {
  const endA = segmentTraversalEnd(first);
  const startB = segmentTraversalStart(second);

  if (pointsAlmostEqual(endA, startB)) {
    setSegmentTraversalStart(second, endA);
    return { ok: true, arc: null };
  }

  const tangentA = segmentEndTangent(first);
  const tangentB = segmentStartTangent(second);
  if (!tangentA || !tangentB) {
    return {
      ok: false,
      failure: failure(
        OFFSET_DIAGNOSTIC_CODES.unsupportedSeed,
        "Offset joint has degenerate tangents.",
        first.seedEntityId,
      ),
    };
  }

  const turn = cross(tangentA, tangentB);
  if (turn * distance > EPSILON) {
    const intersection = trimIntersection(
      first,
      second,
      midpoint(endA, startB),
    );
    if (intersection) {
      setSegmentTraversalEnd(first, intersection);
      setSegmentTraversalStart(second, intersection);
      return { ok: true, arc: null };
    }
  }

  const sweep: SweepDirection =
    cross(subtract(endA, seedVertex), subtract(startB, seedVertex)) >= 0
      ? "counterClockwise"
      : "clockwise";
  return {
    ok: true,
    arc: {
      firstSeedEntityId: first.seedEntityId,
      secondSeedEntityId: second.seedEntityId,
      center: seedVertex,
      start: endA,
      end: startB,
      sweepDirection: sweep,
    },
  };
}

function trimIntersection(
  first: WorkSegment,
  second: WorkSegment,
  reference: SketchPoint2D,
): SketchPoint2D | null {
  if (first.kind === "spline" || second.kind === "spline") {
    // Trimming a fitted spline would reparameterize its stable fit points;
    // approximate the inside corner by snapping to the shared midpoint.
    return reference;
  }

  if (first.kind === "lineSegment" && second.kind === "lineSegment") {
    return infiniteLineIntersection(
      first.start,
      first.end,
      second.start,
      second.end,
    );
  }

  if (first.kind === "lineSegment" && second.kind === "arc") {
    return nearestPoint(
      lineCircleIntersections(
        first.start,
        first.end,
        second.center,
        second.radius,
      ),
      reference,
    );
  }

  if (first.kind === "arc" && second.kind === "lineSegment") {
    return nearestPoint(
      lineCircleIntersections(
        second.start,
        second.end,
        first.center,
        first.radius,
      ),
      reference,
    );
  }

  if (first.kind === "arc" && second.kind === "arc") {
    return nearestPoint(
      circleCircleIntersections(
        first.center,
        first.radius,
        second.center,
        second.radius,
      ),
      reference,
    );
  }

  return null;
}

function segmentSamplePolyline(segment: WorkSegment): SketchPoint2D[] {
  switch (segment.kind) {
    case "lineSegment":
      return [segment.start, segment.end];
    case "arc":
      return sampleArcPoints(
        segment.center,
        segment.radius,
        segment.start,
        segment.end,
        segment.sweep,
        16,
      );
    case "spline":
      return [...segment.points];
  }
}

function segmentsCross(
  first: readonly SketchPoint2D[],
  second: readonly SketchPoint2D[],
) {
  for (let i = 0; i + 1 < first.length; i += 1) {
    for (let j = 0; j + 1 < second.length; j += 1) {
      if (
        strictSegmentIntersection(
          first[i]!,
          first[i + 1]!,
          second[j]!,
          second[j + 1]!,
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function strictSegmentIntersection(
  aStart: SketchPoint2D,
  aEnd: SketchPoint2D,
  bStart: SketchPoint2D,
  bEnd: SketchPoint2D,
) {
  const dx = aEnd[0] - aStart[0];
  const dy = aEnd[1] - aStart[1];
  const otherDx = bEnd[0] - bStart[0];
  const otherDy = bEnd[1] - bStart[1];
  const denominator = dx * otherDy - dy * otherDx;
  if (Math.abs(denominator) <= EPSILON) {
    return false;
  }

  const offsetX = bStart[0] - aStart[0];
  const offsetY = bStart[1] - aStart[1];
  const t = (offsetX * otherDy - offsetY * otherDx) / denominator;
  const u = (offsetX * dy - offsetY * dx) / denominator;
  const margin = 1e-4;
  return t > margin && t < 1 - margin && u > margin && u < 1 - margin;
}

function findChainSelfIntersection(
  segments: readonly WorkSegment[],
  closed: boolean,
): SketchEntityId | null {
  if (segments.length < 3) {
    return null;
  }

  const polylines = segments.map((segment) => segmentSamplePolyline(segment));
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 2; j < segments.length; j += 1) {
      if (closed && i === 0 && j === segments.length - 1) {
        continue;
      }
      if (segmentsCross(polylines[i]!, polylines[j]!)) {
        return segments[i]!.seedEntityId;
      }
    }
  }
  return null;
}

/**
 * Convenience for consumers holding a point-definition map instead of a
 * position lookup.
 */
export function pointPositionLookup(
  pointById: ReadonlyMap<SketchPointId, SketchPointDefinition>,
): (pointId: SketchPointId) => SketchPoint2D | null {
  return (pointId) => pointById.get(pointId)?.position ?? null;
}

function seedCurveSamplePolyline(
  curve: Exclude<OffsetSeedCurve, { kind: "circle" }>,
  reversed: boolean,
): SketchPoint2D[] {
  const natural = (() => {
    switch (curve.kind) {
      case "lineSegment":
        return [curve.start, curve.end];
      case "arc":
        return sampleArcPoints(
          curve.center,
          distanceBetween(curve.center, curve.start),
          curve.start,
          curve.end,
          curve.sweepDirection,
          16,
        );
      case "spline":
        return [...curve.points];
    }
  })();
  return reversed ? natural.reverse() : natural;
}

/**
 * Reports which side of the seed chain a pointer sits on, relative to the
 * same anchored traversal `computeOffsetChain` uses, so pointer-driven
 * previews and committed relationships agree on side semantics. Returns null
 * when the selection does not form a chain or the pointer sits on the chain.
 */
export function offsetSideForPoint(input: {
  curves: readonly OffsetSeedCurve[];
  point: SketchPoint2D;
}): "left" | "right" | null {
  if (input.curves.length === 0) {
    return null;
  }

  const circle = input.curves.find((curve) => curve.kind === "circle");
  if (circle) {
    if (input.curves.length > 1 || circle.kind !== "circle") {
      return null;
    }
    // Circles traverse counter-clockwise, so inside the circle is left.
    const separation = distanceBetween(input.point, circle.center);
    if (Math.abs(separation - circle.radius) <= EPSILON) {
      return null;
    }
    return separation < circle.radius ? "left" : "right";
  }

  const openCurves = input.curves as readonly Exclude<
    OffsetSeedCurve,
    { kind: "circle" }
  >[];
  const traversal = buildTraversal(openCurves);
  if (!traversal.ok) {
    return null;
  }

  let bestDistance = Number.POSITIVE_INFINITY;
  let bestCross = 0;
  for (const entry of traversal.entries) {
    const polyline = seedCurveSamplePolyline(
      openCurves[entry.curveIndex]!,
      entry.reversed,
    );
    for (let index = 0; index + 1 < polyline.length; index += 1) {
      const start = polyline[index]!;
      const end = polyline[index + 1]!;
      const direction = subtract(end, start);
      const lengthSquared = dot(direction, direction);
      if (lengthSquared <= EPSILON * EPSILON) {
        continue;
      }

      const t = Math.max(
        0,
        Math.min(
          1,
          dot(subtract(input.point, start), direction) / lengthSquared,
        ),
      );
      const closest = add(start, scale(direction, t));
      const separation = distanceBetween(input.point, closest);
      if (separation < bestDistance) {
        bestDistance = separation;
        bestCross = cross(direction, subtract(input.point, start));
      }
    }
  }

  if (!Number.isFinite(bestDistance) || Math.abs(bestCross) <= EPSILON) {
    return null;
  }
  return bestCross > 0 ? "left" : "right";
}
