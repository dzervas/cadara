import { arcSweepOffset } from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import {
  getArcParameters,
  getCircleRadius,
  getPoint,
  length,
  subtract,
} from "./solver-geometry";
import type { SolverEntityState, SolverPointRecord } from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";

/** O25: endpoint tangency is defined by the declared join, not a nearest
 * interior point that could jump to another spline span during a solve. */
export function splineArcEndpointTangency(
  definition: SketchDefinition,
  first: SketchEntityDefinition | undefined,
  second: SketchEntityDefinition | undefined,
) {
  const spline = first?.kind === "spline" ? first : second?.kind === "spline" ? second : null;
  const arc = first?.kind === "arc" ? first : second?.kind === "arc" ? second : null;
  if (!spline || !arc || spline.closure !== "open") return null;
  const occurrences = orderedSplineOccurrences(spline);
  if (!occurrences?.length) return null;
  for (const [atStart, occurrence] of [[true, occurrences[0]!], [false, occurrences.at(-1)!]] as const) {
    for (const arcPointId of [arc.startPointId, arc.endPointId]) {
      const joined = occurrence.pointId === arcPointId || definition.constraints.some(c =>
        c.kind === "coincident" && c.pointIds.includes(occurrence.pointId) && c.pointIds.includes(arcPointId));
      if (joined) return { spline, arc, atStart };
    }
  }
  return null;
}

export function isAdvancedSketchEntity(entity: SketchEntityDefinition) {
  return (
    entity.kind === "ellipse" ||
    entity.kind === "ellipticalArc" ||
    entity.kind === "conic" ||
    entity.kind === "bezierCurve" ||
    entity.kind === "profileText"
  );
}

export function localArcData(input: {
  center: SketchPoint2D;
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepDirection: Extract<
    SketchEntityDefinition,
    { kind: "arc" }
  >["sweepDirection"];
}) {
  const sweep = arcSweepOffset(
    input.endAngle,
    input.startAngle,
    input.sweepDirection,
  );
  const startPosition: SketchPoint2D = [
    input.center[0] + Math.cos(input.startAngle) * input.radius,
    input.center[1] + Math.sin(input.startAngle) * input.radius,
  ];
  const endPosition: SketchPoint2D = [
    input.center[0] + Math.cos(input.endAngle) * input.radius,
    input.center[1] + Math.sin(input.endAngle) * input.radius,
  ];

  return {
    center: input.center,
    radius: input.radius,
    startAngle: input.startAngle,
    endAngle: input.endAngle,
    sweep,
    sweepDirection: input.sweepDirection,
    startPosition,
    endPosition,
  };
}

export function isAngleOnLocalArc(
  angle: number,
  arc: ReturnType<typeof localArcData>,
) {
  return (
    arcSweepOffset(angle, arc.startAngle, arc.sweepDirection) <=
    arc.sweep + 1e-9
  );
}

export function nearestPointOnLocalArcSweep(
  point: SketchPoint2D,
  arc: ReturnType<typeof localArcData>,
): SketchPoint2D {
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnLocalArc(angle, arc)) {
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

export function localArcSweepViolation(
  point: SketchPoint2D,
  arc: ReturnType<typeof localArcData>,
) {
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnLocalArc(angle, arc)) {
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

export function getLocalCircleLikeGeometry(
  values: Float64Array,
  entity: SketchEntityDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
): {
  center: SketchPoint2D;
  radius: number;
  arc?: ReturnType<typeof localArcData>;
} | null {
  if (entity.kind === "circle") {
    const center = pointRecords.get(entity.centerPointId);
    const circleState = entityStates.get(entity.entityId);
    return center
      ? {
          center: getPoint(values, center),
          radius:
            circleState?.kind === "circle"
              ? getCircleRadius(values, circleState)
              : entity.radius,
        }
      : null;
  }

  if (entity.kind === "arc") {
    const center = pointRecords.get(entity.centerPointId);
    const arcState = entityStates.get(entity.entityId);
    if (!center || !arcState || arcState.kind !== "arc") {
      return null;
    }

    const { radius, startAngle, endAngle } = getArcParameters(values, arcState);
    const arc = localArcData({
      center: getPoint(values, center),
      radius,
      startAngle,
      endAngle,
      sweepDirection: entity.sweepDirection,
    });
    return { center: arc.center, radius: arc.radius, arc };
  }

  return null;
}

export function localCircleTangencyContacts(
  first: { center: SketchPoint2D; radius: number },
  second: { center: SketchPoint2D; radius: number },
  relation: "external" | "internal",
): [SketchPoint2D, SketchPoint2D] {
  const centerDelta = subtract(second.center, first.center);
  const centerDistance = length(centerDelta);
  const direction: SketchPoint2D =
    centerDistance > DEGENERATE_NORM_EPSILON
      ? [centerDelta[0] / centerDistance, centerDelta[1] / centerDistance]
      : [1, 0];

  if (relation === "external") {
    return [
      [
        first.center[0] + direction[0] * first.radius,
        first.center[1] + direction[1] * first.radius,
      ],
      [
        second.center[0] - direction[0] * second.radius,
        second.center[1] - direction[1] * second.radius,
      ],
    ];
  }

  const contactSign = first.radius >= second.radius ? 1 : -1;
  return [
    [
      first.center[0] + direction[0] * first.radius * contactSign,
      first.center[1] + direction[1] * first.radius * contactSign,
    ],
    [
      second.center[0] + direction[0] * second.radius * contactSign,
      second.center[1] + direction[1] * second.radius * contactSign,
    ],
  ];
}
