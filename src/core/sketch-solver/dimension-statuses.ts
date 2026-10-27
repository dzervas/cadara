import { getLocalCircleLikeGeometry } from "./arc-geometry";
import { orientationLeverWithinTolerance } from "./constraint-statuses";
import {
  lineAngleRadians,
  lineParallelResidual,
  linesParallelWithinTolerance,
  pointLineSignedDistance,
  resolveLineDimensionOperand,
  resolvePointDimensionOperand,
} from "./line-residuals";
import { resolveSketchDatumPoint } from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import type { SketchSolveTolerancePolicy } from "./solve-types";
import {
  getPoint,
  isConstraintResidualWithinTolerance,
  length,
  subtract,
} from "./solver-geometry";
import type { SolverEntityState, SolverPointRecord } from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  DimensionStatusRecord,
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

export function buildDimensionStatuses(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  perConstraint: Map<string, number>,
  tolerance: SketchSolveTolerancePolicy,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
  levers: ReadonlyMap<SketchEntityId, number> = new Map(),
): DimensionStatusRecord[] {
  const entityMap = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
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

  return definition.dimensions.map((dimension) => {
    let solvedValue: number | null = null;
    let orientationOverLever = false;
    if (dimension.kind === "distance") {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (left && right) {
        const delta =
          dimension.axis === "aligned"
            ? subtract(getPoint(values, left), getPoint(values, right))
            : subtract(getPoint(values, right), getPoint(values, left));
        solvedValue =
          dimension.axis === "aligned"
            ? length(delta)
            : dimension.axis === "horizontal"
              ? delta[0]
              : delta[1];
      }
    } else if (
      dimension.kind === "horizontalDistance" ||
      dimension.kind === "verticalDistance"
    ) {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (left && right) {
        const delta = subtract(getPoint(values, right), getPoint(values, left));
        solvedValue =
          dimension.kind === "horizontalDistance" ? delta[0] : delta[1];
      }
    } else if (dimension.kind === "circleRadius") {
      const entity = entityMap.get(dimension.entityId);
      const circleLike = entity
        ? getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates)
        : null;
      solvedValue =
        entity?.kind === "circle" ? (circleLike?.radius ?? null) : null;
    } else if (dimension.kind === "diameter") {
      const entity = entityMap.get(dimension.entityId);
      const circleLike = entity
        ? getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates)
        : null;
      solvedValue = circleLike ? circleLike.radius * 2 : null;
    } else if (dimension.kind === "lineLength") {
      const entity = lineEntityMap.get(dimension.entityId);
      const start = entity ? pointRecords.get(entity.startPointId) : null;
      const end = entity ? pointRecords.get(entity.endPointId) : null;
      solvedValue =
        start && end
          ? length(subtract(getPoint(values, end), getPoint(values, start)))
          : null;
    } else if (dimension.kind === "pointDatumDistance") {
      const point = pointRecords.get(dimension.point.pointId);
      const datumPoint = resolveSketchDatumPoint(dimension.datum.datum);
      if (point && datumPoint) {
        const localPoint = getPoint(values, point);
        solvedValue =
          dimension.axis === "horizontal"
            ? Math.abs(localPoint[0] - datumPoint[0])
            : dimension.axis === "vertical"
              ? Math.abs(localPoint[1] - datumPoint[1])
              : length(subtract(localPoint, datumPoint));
      } else {
        solvedValue = null;
      }
    } else if (dimension.kind === "lineDistance") {
      const first = resolveLineDimensionOperand(
        values,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const second = resolveLineDimensionOperand(
        values,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      solvedValue =
        first &&
        second &&
        linesParallelWithinTolerance(first, second, tolerance)
          ? Math.abs(
              pointLineSignedDistance(second.start, first.start, first.end),
            )
          : null;
      // T13e2 (re-review RR-2): its parallel prerequisite is an orientation
      // requirement too, judged over its lines' extension lever.
      if (first && second && solvedValue !== null)
        orientationOverLever = !orientationLeverWithinTolerance(
          Math.asin(
            Math.min(
              1,
              Math.abs(
                lineParallelResidual(
                  first.start,
                  first.end,
                  second.start,
                  second.end,
                ),
              ),
            ),
          ),
          Math.max(
            0,
            ...dimension.lines.map((operand) =>
              operand.kind === "localEntity"
                ? (levers.get(operand.entityId) ?? 0)
                : 0,
            ),
          ),
          tolerance,
        );
    } else if (dimension.kind === "linePointDistance") {
      const line = resolveLineDimensionOperand(
        values,
        dimension.line,
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const point = resolvePointDimensionOperand(
        values,
        dimension.point,
        pointRecords,
        projectedReferences,
      );
      solvedValue =
        line && point
          ? Math.abs(pointLineSignedDistance(point, line.start, line.end))
          : null;
    } else if (dimension.kind === "lineAngle") {
      const first = resolveLineDimensionOperand(
        values,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const second = resolveLineDimensionOperand(
        values,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const angle =
        first && second
          ? lineAngleRadians(first.start, first.end, second.start, second.end)
          : null;
      solvedValue =
        angle !== null && angle > DEGENERATE_NORM_EPSILON ? angle : null;
    } else {
      const state = entityStates.get(dimension.entityId);
      solvedValue = state?.kind === "arc" ? 0 : null;
    }

    // T13d (D10): a reference dimension only reports its measured quantity.
    if (isReferenceDimension(dimension)) {
      return {
        dimensionId: dimension.dimensionId,
        status: "driven" as const,
        solvedValue,
      };
    }

    const residualTolerance =
      dimension.kind === "lineAngle"
        ? tolerance.angleRadians
        : tolerance.coincidence;
    // Line-distance and line-angle admission is judged at the initial values,
    // so a dimension that never entered the solver must not read as zero error.
    return {
      dimensionId: dimension.dimensionId,
      status:
        solvedValue === null ||
        !perConstraint.has(dimension.dimensionId) ||
        !isConstraintResidualWithinTolerance(
          perConstraint.get(dimension.dimensionId) ?? 0,
          residualTolerance,
        ) ||
        orientationOverLever ||
        // T13e2 (B1): an angle over its lines' extension lever.
        (dimension.kind === "lineAngle" &&
          !orientationLeverWithinTolerance(
            Math.sqrt(2 * (perConstraint.get(dimension.dimensionId) ?? 0)),
            Math.max(
              0,
              ...dimension.lines.map((operand) =>
                operand.kind === "localEntity"
                  ? (levers.get(operand.entityId) ?? 0)
                  : 0,
              ),
            ),
            tolerance,
          ))
          ? "unsatisfied"
          : "driving",
      solvedValue,
    };
  });
}
