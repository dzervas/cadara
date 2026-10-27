import {
  findProjectedGeometry,
  resolveSketchDatumLine,
  resolveSketchDatumPoint,
  unitVector,
} from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import type { SketchSolveTolerancePolicy } from "./solve-types";
import { getPoint, subtract } from "./solver-geometry";
import type { SolverPointRecord } from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  NumericDimensionDefinition as DimensionDefinition,
  LocalCollinearTargetOperand,
  ProjectedSketchGeometryRef,
  SketchEntityDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

// Sine of the angle between a line and the radial direction at the contact.
export function lineNormalDirectionResidual(
  lineStart: SketchPoint2D,
  lineEnd: SketchPoint2D,
  contactPoint: SketchPoint2D,
  center: SketchPoint2D,
) {
  const lineUnit = unitVector(lineStart, lineEnd);
  const radialUnit = unitVector(center, contactPoint);
  if (!lineUnit || !radialUnit) {
    return 0;
  }

  return lineUnit[0] * radialUnit[1] - lineUnit[1] * radialUnit[0];
}

export function pointLineSignedDistance(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
) {
  const unit = unitVector(start, end);

  if (!unit) {
    return 0;
  }

  const delta = subtract(point, start);
  return delta[0] * unit[1] - delta[1] * unit[0];
}

export function lineParallelResidual(
  firstStart: SketchPoint2D,
  firstEnd: SketchPoint2D,
  secondStart: SketchPoint2D,
  secondEnd: SketchPoint2D,
) {
  const firstUnit = unitVector(firstStart, firstEnd);
  const secondUnit = unitVector(secondStart, secondEnd);

  if (!firstUnit || !secondUnit) {
    return Number.POSITIVE_INFINITY;
  }

  return firstUnit[0] * secondUnit[1] - firstUnit[1] * secondUnit[0];
}

/**
 * Line-distance prerequisite: both operands are parallel (or antiparallel)
 * within the policy's angular tolerance. Degenerate operands never qualify.
 */
export function linesParallelWithinTolerance(
  first: { start: SketchPoint2D; end: SketchPoint2D },
  second: { start: SketchPoint2D; end: SketchPoint2D },
  tolerance: SketchSolveTolerancePolicy,
) {
  const residual = lineParallelResidual(
    first.start,
    first.end,
    second.start,
    second.end,
  );
  return (
    Number.isFinite(residual) &&
    Math.asin(Math.min(1, Math.abs(residual))) <= tolerance.angleRadians
  );
}

export function lineAngleRadians(
  firstStart: SketchPoint2D,
  firstEnd: SketchPoint2D,
  secondStart: SketchPoint2D,
  secondEnd: SketchPoint2D,
) {
  const firstDelta = subtract(firstEnd, firstStart);
  const secondDelta = subtract(secondEnd, secondStart);
  const denominator =
    firstDelta[0] * secondDelta[1] - firstDelta[1] * secondDelta[0];
  const center: SketchPoint2D | null =
    Math.abs(denominator) <= DEGENERATE_NORM_EPSILON
      ? null
      : (() => {
          const delta = subtract(secondStart, firstStart);
          const t =
            (delta[0] * secondDelta[1] - delta[1] * secondDelta[0]) /
            denominator;
          return [
            firstStart[0] + firstDelta[0] * t,
            firstStart[1] + firstDelta[1] * t,
          ];
        })();
  const firstUnit = lineAngleDirectionFromCenter(firstStart, firstEnd, center);
  const secondUnit = lineAngleDirectionFromCenter(
    secondStart,
    secondEnd,
    center,
  );

  if (!firstUnit || !secondUnit) {
    return null;
  }

  const dot = Math.max(
    -1,
    Math.min(1, firstUnit[0] * secondUnit[0] + firstUnit[1] * secondUnit[1]),
  );
  return Math.acos(dot);
}

export function lineAngleDirectionFromCenter(
  start: SketchPoint2D,
  end: SketchPoint2D,
  center: SketchPoint2D | null,
): SketchPoint2D | null {
  const lineUnit = unitVector(start, end);
  if (!lineUnit) {
    return null;
  }

  if (!center) {
    return lineUnit;
  }

  const midpoint: SketchPoint2D = [
    (start[0] + end[0]) * 0.5,
    (start[1] + end[1]) * 0.5,
  ];
  const towardMidpoint = unitVector(center, midpoint);
  if (!towardMidpoint) {
    return lineUnit;
  }

  const dot = towardMidpoint[0] * lineUnit[0] + towardMidpoint[1] * lineUnit[1];
  return dot >= 0 ? lineUnit : [-lineUnit[0], -lineUnit[1]];
}

export function resolveLineDimensionOperand(
  values: Float64Array,
  operand: Extract<
    DimensionDefinition,
    { kind: "lineDistance" }
  >["lines"][number],
  lineEntityMap: Map<
    SketchEntityId,
    Extract<SketchEntityDefinition, { kind: "lineSegment" }>
  >,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  if (operand.kind === "sketchDatum") {
    return resolveSketchDatumLine(operand.datum);
  }

  if (operand.kind === "projectedGeometry") {
    const projected = findProjectedGeometry(
      projectedReferences,
      operand.reference,
    );
    return projected?.kind === "lineSegment"
      ? { start: projected.startPosition, end: projected.endPosition }
      : null;
  }

  const line = lineEntityMap.get(operand.entityId);
  const start = line ? pointRecords.get(line.startPointId) : null;
  const end = line ? pointRecords.get(line.endPointId) : null;

  return start && end
    ? { start: getPoint(values, start), end: getPoint(values, end) }
    : null;
}

export function resolveLocalLineOperand(
  values: Float64Array,
  operand: { entityId: SketchEntityId },
  lineEntityMap: Map<
    SketchEntityId,
    Extract<SketchEntityDefinition, { kind: "lineSegment" }>
  >,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  const line = lineEntityMap.get(operand.entityId);
  const start = line ? pointRecords.get(line.startPointId) : null;
  const end = line ? pointRecords.get(line.endPointId) : null;

  return start && end
    ? { start: getPoint(values, start), end: getPoint(values, end) }
    : null;
}

export function resolveReadOnlyLineOperand(
  operand: {
    kind: string;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  if (operand.kind === "projectedGeometry" && operand.reference) {
    const projected = findProjectedGeometry(
      projectedReferences,
      operand.reference,
    );
    return projected?.kind === "lineSegment"
      ? { start: projected.startPosition, end: projected.endPosition }
      : null;
  }

  if (operand.kind === "sketchDatum" && operand.datum) {
    return resolveSketchDatumLine(operand.datum);
  }

  return null;
}

export function localCollinearResidual(
  values: Float64Array,
  target: LocalCollinearTargetOperand,
  referenceLine: { start: SketchPoint2D; end: SketchPoint2D },
  lineEntityMap: Map<
    SketchEntityId,
    Extract<SketchEntityDefinition, { kind: "lineSegment" }>
  >,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
) {
  if (target.kind === "localPoint") {
    const point = pointRecords.get(target.pointId);
    return point
      ? Math.abs(
          pointLineSignedDistance(
            getPoint(values, point),
            referenceLine.start,
            referenceLine.end,
          ),
        )
      : 0;
  }

  const targetLine = resolveLocalLineOperand(
    values,
    target,
    lineEntityMap,
    pointRecords,
  );
  if (!targetLine) {
    return 0;
  }

  const startDistance = pointLineSignedDistance(
    targetLine.start,
    referenceLine.start,
    referenceLine.end,
  );
  const endDistance = pointLineSignedDistance(
    targetLine.end,
    referenceLine.start,
    referenceLine.end,
  );
  return Math.sqrt(startDistance * startDistance + endDistance * endDistance);
}

export function localCollinearComponents(
  values: Float64Array,
  target: LocalCollinearTargetOperand,
  reference: { start: SketchPoint2D; end: SketchPoint2D },
  lines: Map<
    SketchEntityId,
    Extract<SketchEntityDefinition, { kind: "lineSegment" }>
  >,
  points: Map<SketchPointId, SolverPointRecord>,
): readonly number[] {
  if (target.kind === "localPoint") {
    const point = points.get(target.pointId);
    return [
      point
        ? pointLineSignedDistance(
            getPoint(values, point),
            reference.start,
            reference.end,
          )
        : Infinity,
    ];
  }
  const line = resolveLocalLineOperand(values, target, lines, points);
  return line
    ? [
        pointLineSignedDistance(line.start, reference.start, reference.end),
        pointLineSignedDistance(line.end, reference.start, reference.end),
      ]
    : [Infinity, Infinity];
}

export function resolvePointDimensionOperand(
  values: Float64Array,
  operand: Extract<DimensionDefinition, { kind: "linePointDistance" }>["point"],
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchPoint2D | null {
  if (operand.kind === "sketchDatum") {
    return resolveSketchDatumPoint(operand.datum);
  }

  if (operand.kind === "projectedGeometry") {
    const projected = findProjectedGeometry(
      projectedReferences,
      operand.reference,
    );
    return projected?.kind === "point" ? projected.position : null;
  }

  const point = pointRecords.get(operand.pointId);
  return point ? getPoint(values, point) : null;
}
