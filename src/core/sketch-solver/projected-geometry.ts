import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import { length, subtract } from "./solver-geometry";
import type {
  ProjectedSketchGeometryRef,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";

export function projectedKindForConstraintRef(
  kind: NonNullable<ProjectedSketchGeometryRef["kind"]>,
) {
  switch (kind) {
    case "projectedPoint":
      return "point";
    case "projectedLineSegment":
      return "lineSegment";
    case "projectedCircle":
      return "circle";
    case "projectedArc":
      return "arc";
    case "projectedSpline":
      return "spline";
  }
}

export function findProjectedGeometry(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
  },
): ProjectedSketchReferenceGeometry | null {
  const projectedReference = projectedReferences.find(
    (entry) => entry.referenceId === reference.referenceId,
  );

  if (!projectedReference || projectedReference.status !== "projected") {
    return null;
  }

  const expectedKind = projectedKindForConstraintRef(reference.kind);
  return (
    projectedReference.geometry.find(
      (geometry) =>
        geometry.geometryId === reference.geometryId &&
        geometry.kind === expectedKind,
    ) ?? null
  );
}

export function resolveSketchDatumPoint(
  datum: "origin" | "xAxis" | "yAxis",
): SketchPoint2D | null {
  return datum === "origin" ? [0, 0] : null;
}

export function resolveSketchDatumLine(
  datum: "origin" | "xAxis" | "yAxis",
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  switch (datum) {
    case "xAxis":
      return { start: [-1, 0], end: [1, 0] };
    case "yAxis":
      return { start: [0, -1], end: [0, 1] };
    case "origin":
      return null;
  }
}

export function projectedCircleLikeGeometry(
  geometry: ProjectedSketchReferenceGeometry,
): { center: SketchPoint2D; radius: number } | null {
  if (geometry.kind === "circle") {
    return { center: geometry.centerPosition, radius: geometry.radius };
  }

  if (geometry.kind === "arc") {
    return {
      center: geometry.centerPosition,
      radius: length(subtract(geometry.startPosition, geometry.centerPosition)),
    };
  }

  return null;
}

export function normalizeAngleRadians(angle: number) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

export function arcSweepOffset(
  angle: number,
  startAngle: number,
  direction: Extract<
    ProjectedSketchReferenceGeometry,
    { kind: "arc" }
  >["sweepDirection"],
) {
  return direction === "counterClockwise"
    ? normalizeAngleRadians(angle - startAngle)
    : normalizeAngleRadians(startAngle - angle);
}

export function projectedArcData(
  geometry: Extract<ProjectedSketchReferenceGeometry, { kind: "arc" }>,
) {
  const startOffset = subtract(geometry.startPosition, geometry.centerPosition);
  const endOffset = subtract(geometry.endPosition, geometry.centerPosition);
  const radius = length(startOffset);
  const startAngle = Math.atan2(startOffset[1], startOffset[0]);
  const endAngle = Math.atan2(endOffset[1], endOffset[0]);
  const sweep = arcSweepOffset(endAngle, startAngle, geometry.sweepDirection);

  return {
    center: geometry.centerPosition,
    radius,
    startAngle,
    endAngle,
    sweep,
    sweepDirection: geometry.sweepDirection,
    startPosition: geometry.startPosition,
    endPosition: geometry.endPosition,
  };
}

export function isAngleOnProjectedArc(
  angle: number,
  arc: ReturnType<typeof projectedArcData>,
) {
  return (
    arcSweepOffset(angle, arc.startAngle, arc.sweepDirection) <=
    arc.sweep + 1e-9
  );
}

export function nearestPointOnProjectedArcSweep(
  point: SketchPoint2D,
  arc: ReturnType<typeof projectedArcData>,
): SketchPoint2D {
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnProjectedArc(angle, arc)) {
    return [
      arc.center[0] + Math.cos(angle) * arc.radius,
      arc.center[1] + Math.sin(angle) * arc.radius,
    ];
  }

  return length(subtract(point, arc.startPosition)) <=
    length(subtract(point, arc.endPosition))
    ? arc.startPosition
    : arc.endPosition;
}

export function pointProjectedArcDistance(
  point: SketchPoint2D,
  geometry: Extract<ProjectedSketchReferenceGeometry, { kind: "arc" }>,
) {
  const arc = projectedArcData(geometry);
  return length(subtract(point, nearestPointOnProjectedArcSweep(point, arc)));
}

export function projectedArcSweepViolation(
  point: SketchPoint2D,
  geometry: Extract<ProjectedSketchReferenceGeometry, { kind: "arc" }>,
) {
  const arc = projectedArcData(geometry);
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnProjectedArc(angle, arc)) {
    return 0;
  }

  const circlePoint: SketchPoint2D = [
    arc.center[0] + Math.cos(angle) * arc.radius,
    arc.center[1] + Math.sin(angle) * arc.radius,
  ];
  return Math.min(
    length(subtract(circlePoint, arc.startPosition)),
    length(subtract(circlePoint, arc.endPosition)),
  );
}

export function unitVector(
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D | null {
  const delta = subtract(end, start);
  const norm = length(delta);

  return norm < DEGENERATE_NORM_EPSILON
    ? null
    : [delta[0] / norm, delta[1] / norm];
}
