import {
  getLocalCircleLikeGeometry,
  splineArcEndpointTangency,
} from "./arc-geometry";
import {
  lineNormalDirectionResidual,
  resolvePointDimensionOperand,
} from "./line-residuals";
import {
  findProjectedGeometry,
  projectedCircleLikeGeometry,
} from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import type { SketchSolveTolerancePolicy } from "./solve-types";
import {
  dot2,
  getPoint,
  isConstraintResidualWithinTolerance,
  length,
  subtract,
} from "./solver-geometry";
import type { SolverEntityState, SolverPointRecord } from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintStatusRecord,
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

/**
 * T13e2 (B1): per local line, how far beyond its segment the requirements
 * rely on its infinite extension (0 when every use lies on the segment).
 * An orientation requirement on that line must keep its positional effect
 * over that lever within the coincidence tolerance (see
 * `orientationLeverWithinTolerance`); otherwise a conflict is absorbed by a
 * tilt that is tiny at the segment but large at a far contact, and the solve
 * slides kilometres along the extension.
 *
 * The uses: a line ↔ circle/arc tangency (local or projected curve: the
 * centre's foot), point-on-line, collinear (the target point, or the
 * target line's endpoints), normal to a local or projected curve
 * (its centre and the contact point), symmetric about a line (both
 * points) and the line-point distance dimension (the point); each is
 * pinned by a far-basin row. Projected and datum lines are fixed, so only
 * local lines carry a lever; the midpoint constraint uses the segment
 * itself. Line distance and equal offset are not sources (no solve reaches
 * a far basin through their own measurement, T13e2 re-review evidence);
 * their parallel prerequisites are judged over the lever the lines get
 * from the other uses.
 */
export function lineExtensionLevers(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): ReadonlyMap<SketchEntityId, number> {
  const levers = new Map<SketchEntityId, number>();
  const lineEntityMap = new Map(
    definition.entities.flatMap((entity) =>
      entity.kind === "lineSegment" ? [[entity.entityId, entity] as const] : [],
    ),
  );
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity] as const),
  );
  const pointAt = (pointId: SketchPointId) => {
    const record = pointRecords.get(pointId);
    return record ? getPoint(values, record) : null;
  };
  const linePoints = (entityId: SketchEntityId) => {
    const line = lineEntityMap.get(entityId);
    const start = line && pointAt(line.startPointId);
    const end = line && pointAt(line.endPointId);
    return start && end ? ([start, end] as const) : null;
  };
  const relyOn = (entityId: SketchEntityId, point: SketchPoint2D | null) => {
    const segment = linePoints(entityId);
    if (!segment || !point) return;
    const [start, end] = segment;
    const segmentLength = length(subtract(end, start));
    if (!(segmentLength > 0)) return;
    const along =
      ((point[0] - start[0]) * (end[0] - start[0]) +
        (point[1] - start[1]) * (end[1] - start[1])) /
      segmentLength;
    const beyond = Math.max(0, -along, along - segmentLength);
    if (beyond > (levers.get(entityId) ?? 0)) levers.set(entityId, beyond);
  };
  const relyOnLine = (entityId: SketchEntityId, otherId: SketchEntityId) => {
    for (const point of linePoints(otherId) ?? []) relyOn(entityId, point);
  };
  const localCenter = (entityId: SketchEntityId) => {
    const entity = entityById.get(entityId);
    return entity
      ? (getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates)
          ?.center ?? null)
      : null;
  };
  const projectedCenter = (
    reference: Parameters<typeof findProjectedGeometry>[1],
  ) => {
    const projected = findProjectedGeometry(projectedReferences, reference);
    return projected
      ? (projectedCircleLikeGeometry(projected)?.center ?? null)
      : null;
  };

  for (const constraint of definition.constraints) {
    switch (constraint.kind) {
      case "tangent": {
        const [first, second] = constraint.entityIds;
        if (lineEntityMap.has(first)) relyOn(first, localCenter(second));
        if (lineEntityMap.has(second)) relyOn(second, localCenter(first));
        break;
      }
      case "tangentProjectedCurve":
        relyOn(
          constraint.curve.entityId,
          projectedCenter(constraint.projectedCurve.reference),
        );
        break;
      case "pointOnCurve":
        relyOn(constraint.curve.entityId, pointAt(constraint.point.pointId));
        break;
      case "collinear":
        if (constraint.target.kind === "localPoint") {
          relyOn(constraint.line.entityId, pointAt(constraint.target.pointId));
        } else {
          // The residual reads the line's extension at the target's
          // endpoints, never the target's extension.
          relyOnLine(constraint.line.entityId, constraint.target.entityId);
        }
        break;
      case "normal":
        relyOn(
          constraint.line.entityId,
          localCenter(constraint.curve.entityId),
        );
        relyOn(constraint.line.entityId, pointAt(constraint.point.pointId));
        break;
      case "normalProjectedCurve":
        relyOn(
          constraint.line.entityId,
          projectedCenter(constraint.projectedCurve.reference),
        );
        relyOn(constraint.line.entityId, pointAt(constraint.point.pointId));
        break;
      case "symmetric":
        for (const pointId of constraint.pointIds)
          relyOn(constraint.axis.entityId, pointAt(pointId));
        break;
      default:
        break;
    }
  }
  for (const dimension of definition.dimensions) {
    if (dimension.kind === "linePointDistance") {
      if (dimension.line.kind === "localEntity")
        relyOn(
          dimension.line.entityId,
          resolvePointDimensionOperand(
            values,
            dimension.point,
            pointRecords,
            projectedReferences,
          ),
        );
    }
  }
  return levers;
}

/**
 * T13e2 (B1): an orientation requirement's angular deviation, carried over
 * the lever of its lines' extensions, stays within the coincidence
 * tolerance. Always true without a lever.
 */
export function orientationLeverWithinTolerance(
  deviation: number,
  lever: number,
  tolerance: SketchSolveTolerancePolicy,
) {
  return lever <= 0 || deviation * lever <= tolerance.coincidence;
}

/**
 * T13e2 (A1, B1): a horizontal/vertical line is judged by its endpoint
 * offset (|Δ| ≤ coincidence, as before), by its direction (asin(|Δ|/ℓ) ≤
 * angleRadians, the tolerance parallel and perpendicular use; a positional
 * check alone lets a line about τ long take any direction) and over the
 * lever of its extension (|Δ|/ℓ·(ℓ + lever) ≤ coincidence).
 */
export function axisAlignedLineWithinTolerance(
  kind: "horizontal" | "vertical",
  start: SketchPoint2D,
  end: SketchPoint2D,
  lever: number,
  tolerance: SketchSolveTolerancePolicy,
) {
  const offset = Math.abs(
    kind === "horizontal" ? end[1] - start[1] : end[0] - start[0],
  );
  const lineLength = length(subtract(end, start));
  if (!(lineLength > 0)) return false;
  const sine = Math.min(1, offset / lineLength);
  return (
    offset <= tolerance.coincidence &&
    Math.asin(sine) <= tolerance.angleRadians &&
    sine * (lineLength + lever) <= tolerance.coincidence
  );
}

export function buildConstraintStatuses(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  tolerance: SketchSolveTolerancePolicy,
  perConstraint: Map<string, number>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
  levers: ReadonlyMap<SketchEntityId, number> = new Map(),
): ConstraintStatusRecord[] {
  const lineEntityMap = new Map(
    definition.entities
      .filter(
        (
          entity,
        ): entity is Extract<SketchEntityDefinition, { kind: "lineSegment" }> =>
          entity.kind === "lineSegment",
      )
      .map((entity) => [entity.entityId, entity]),
  );

  return definition.constraints.map((constraint) => {
    let status: ConstraintStatusRecord["status"] = "satisfied";
    // Missing rows mean unadmitted, never zero error. Derived requirements
    // have their own status owner and apply their blocked override afterwards.
    if (!perConstraint.has(constraint.constraintId)) {
      return { constraintId: constraint.constraintId, status: "conflicting" };
    }
    const residual = perConstraint.get(constraint.constraintId)!;
    const residualTolerance =
      constraint.kind === "parallel" ||
      constraint.kind === "perpendicular" ||
      constraint.kind === "angle" ||
      constraint.kind === "parallelProjectedLine" ||
      constraint.kind === "perpendicularProjectedLine"
        ? tolerance.angleRadians
        : tolerance.coincidence;
    // The normal residual is 0.5·(curve² + direction² + contact²); its
    // dimensionless direction sine is judged against the angle and the two
    // length terms against the coincidence tolerance.
    const isNormalWithinTolerance = (
      line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
      point: SolverPointRecord,
      center: SketchPoint2D,
    ) => {
      const start = pointRecords.get(line.startPointId);
      const end = pointRecords.get(line.endPointId);
      const direction =
        start && end
          ? lineNormalDirectionResidual(
              getPoint(values, start),
              getPoint(values, end),
              getPoint(values, point),
              center,
            )
          : 0;
      const directionResidual = 0.5 * direction * direction;
      return (
        isConstraintResidualWithinTolerance(
          directionResidual,
          tolerance.angleRadians,
        ) &&
        isConstraintResidualWithinTolerance(
          residual - directionResidual,
          tolerance.coincidence,
        )
      );
    };

    if (constraint.kind === "equalOffset") {
      const pairPrimitives = constraint.pairs.map((pair) => {
        if (pair.seedEntityId === pair.offsetEntityId) return null;
        const seed = lineEntityMap.get(pair.seedEntityId);
        const offset = lineEntityMap.get(pair.offsetEntityId);
        if (!seed || !offset) return null;
        const seedStart = pointRecords.get(seed.startPointId);
        const seedEnd = pointRecords.get(seed.endPointId);
        const offsetStart = pointRecords.get(offset.startPointId);
        const offsetEnd = pointRecords.get(offset.endPointId);
        if (!seedStart || !seedEnd || !offsetStart || !offsetEnd) return null;

        const seedVector = subtract(
          getPoint(values, seedEnd),
          getPoint(values, seedStart),
        );
        const offsetVector = subtract(
          getPoint(values, offsetEnd),
          getPoint(values, offsetStart),
        );
        const seedLength = length(seedVector);
        const offsetLength = length(offsetVector);
        if (
          !Number.isFinite(seedLength) ||
          !Number.isFinite(offsetLength) ||
          seedLength < DEGENERATE_NORM_EPSILON ||
          offsetLength < DEGENERATE_NORM_EPSILON
        ) {
          return null;
        }
        const seedUnit: SketchPoint2D = [
          seedVector[0] / seedLength,
          seedVector[1] / seedLength,
        ];
        const offsetUnit: SketchPoint2D = [
          offsetVector[0] / offsetLength,
          offsetVector[1] / offsetLength,
        ];
        const side = pair.side === "left" ? 1 : -1;
        const signedDistance =
          side *
          dot2(
            [-seedUnit[1], seedUnit[0]],
            subtract(
              getPoint(values, offsetStart),
              getPoint(values, seedStart),
            ),
          );
        const parallel =
          seedUnit[0] * offsetUnit[1] - seedUnit[1] * offsetUnit[0];
        return { parallel, signedDistance };
      });
      const first = pairPrimitives[0];
      const second = pairPrimitives[1];
      if (!first || !second) {
        status = "conflicting";
      } else {
        const firstAngularError = Math.asin(
          Math.min(1, Math.abs(first.parallel)),
        );
        const secondAngularError = Math.asin(
          Math.min(1, Math.abs(second.parallel)),
        );
        status =
          Number.isFinite(firstAngularError) &&
          Number.isFinite(secondAngularError) &&
          Number.isFinite(first.signedDistance) &&
          Number.isFinite(second.signedDistance) &&
          firstAngularError <= tolerance.angleRadians &&
          secondAngularError <= tolerance.angleRadians &&
          // T13e2 (re-review RR-1): each pair's parallelism is an
          // orientation requirement, judged over its lines' lever.
          constraint.pairs.every((pair, index) =>
            orientationLeverWithinTolerance(
              index === 0 ? firstAngularError : secondAngularError,
              Math.max(
                levers.get(pair.seedEntityId) ?? 0,
                levers.get(pair.offsetEntityId) ?? 0,
              ),
              tolerance,
            ),
          ) &&
          Math.abs(first.signedDistance - second.signedDistance) <=
            tolerance.coincidence
            ? "satisfied"
            : "unsatisfied";
      }
    } else if (
      constraint.kind === "horizontal" ||
      constraint.kind === "vertical"
    ) {
      const entity = lineEntityMap.get(constraint.entityId);
      if (!entity) {
        status = "conflicting";
      } else {
        const start = pointRecords.get(entity.startPointId);
        const end = pointRecords.get(entity.endPointId);
        if (!start || !end) {
          status = "conflicting";
        } else {
          status = axisAlignedLineWithinTolerance(
            constraint.kind,
            getPoint(values, start),
            getPoint(values, end),
            levers.get(constraint.entityId) ?? 0,
            tolerance,
          )
            ? "satisfied"
            : "unsatisfied";
        }
      }
    } else if (constraint.kind === "midpoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const line = lineEntityMap.get(constraint.line.entityId);
      status =
        point && line
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "midpointProjectedLine") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        point &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "pointOnCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      status =
        point &&
        entity &&
        (entity.kind === "lineSegment" ||
          entity.kind === "circle" ||
          entity.kind === "arc" ||
          entity.kind === "spline" ||
          entity.kind === "derivedPiecewiseCubic")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "collinear") {
      const targetValid =
        constraint.target.kind === "localPoint"
          ? pointRecords.has(constraint.target.pointId)
          : lineEntityMap.has(constraint.target.entityId);
      const line = lineEntityMap.get(constraint.line.entityId);
      status =
        targetValid && line
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "collinearProjectedLine") {
      const targetValid =
        constraint.target.kind === "localPoint"
          ? pointRecords.has(constraint.target.pointId)
          : lineEntityMap.has(constraint.target.entityId);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        targetValid &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "coincidentProjectedPoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedPoint.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedPoint.reference,
            )
          : null;
      status =
        point &&
        (projected?.kind === "point" ||
          constraint.projectedPoint.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "pointOnProjectedCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedCurve.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedCurve.reference,
            )
          : null;
      status =
        point &&
        (projected !== null || constraint.projectedCurve.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (
      constraint.kind === "parallelProjectedLine" ||
      constraint.kind === "perpendicularProjectedLine"
    ) {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        line &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "tangentProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        projectedReferences,
        constraint.projectedCurve.reference,
      );
      status =
        entity &&
        (entity.kind === "lineSegment" ||
          entity.kind === "circle" ||
          entity.kind === "arc") &&
        projected &&
        projectedCircleLikeGeometry(projected) !== null
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "tangent") {
      const entities = constraint.entityIds.map((entityId) =>
        definition.entities.find(
          (candidate) => candidate.entityId === entityId,
        ),
      );
      status = (splineArcEndpointTangency(definition, entities[0], entities[1]) || entities.every(
        (entity) =>
          entity &&
          (entity.kind === "lineSegment" ||
            entity.kind === "circle" ||
            entity.kind === "arc"),
      ))
        ? isConstraintResidualWithinTolerance(residual, residualTolerance)
          ? "satisfied"
          : "unsatisfied"
        : "conflicting";
    } else if (constraint.kind === "concentric") {
      const entities = constraint.entityIds.map((entityId) =>
        definition.entities.find(
          (candidate) => candidate.entityId === entityId,
        ),
      );
      status = entities.every(
        (entity) =>
          entity && (entity.kind === "circle" || entity.kind === "arc"),
      )
        ? isConstraintResidualWithinTolerance(residual, residualTolerance)
          ? "satisfied"
          : "unsatisfied"
        : "conflicting";
    } else if (constraint.kind === "concentricProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        projectedReferences,
        constraint.projectedCurve.reference,
      );
      status =
        entity &&
        (entity.kind === "circle" || entity.kind === "arc") &&
        projected &&
        projectedCircleLikeGeometry(projected) !== null
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "normal") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const curve = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const point = pointRecords.get(constraint.point.pointId);
      const circleLike =
        curve && (curve.kind === "circle" || curve.kind === "arc")
          ? getLocalCircleLikeGeometry(
              values,
              curve,
              pointRecords,
              entityStates,
            )
          : null;
      status =
        line && point && circleLike
          ? isNormalWithinTolerance(line, point, circleLike.center)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "normalProjectedCurve") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projected = findProjectedGeometry(
        projectedReferences,
        constraint.projectedCurve.reference,
      );
      const point = pointRecords.get(constraint.point.pointId);
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      status =
        line && point && projectedCircle
          ? isNormalWithinTolerance(line, point, projectedCircle.center)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "symmetric") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const axis = lineEntityMap.get(constraint.axis.entityId);
      status =
        first && second && axis
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "symmetricProjectedLine") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        first &&
        second &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (
      !isConstraintResidualWithinTolerance(residual, residualTolerance)
    ) {
      status = "unsatisfied";
    }

    // T13e2 (B1): a relative orientation over its lines' extension lever.
    const leverLineIds =
      constraint.kind === "parallel" || constraint.kind === "perpendicular"
        ? constraint.entityIds
        : constraint.kind === "parallelProjectedLine" ||
            constraint.kind === "perpendicularProjectedLine"
          ? [constraint.line.entityId]
          : [];
    if (
      status === "satisfied" &&
      !orientationLeverWithinTolerance(
        Math.asin(Math.min(1, Math.sqrt(2 * residual))),
        Math.max(0, ...leverLineIds.map((id) => levers.get(id) ?? 0)),
        tolerance,
      )
    ) {
      status = "unsatisfied";
    }

    return {
      constraintId: constraint.constraintId,
      status,
    };
  });
}
