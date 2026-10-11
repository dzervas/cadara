/**
 * Which sketch geometry an entity, constraint or dimension references: the
 * shared helpers of ordinary Delete (`deleteSelectedSketchGeometry`) and
 * mirror removal (`mirror-repair.ts`). Pure, over authored definitions only.
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import { orderedSplinePointIds } from "@/contracts/sketch/spline-geometry";

export function getEntityPointIds(entity: SketchEntityDefinition) {
  switch (entity.kind) {
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "arc":
      return [entity.startPointId, entity.endPointId, entity.centerPointId];
    case "circle":
      return [entity.centerPointId];
    case "point":
      return [entity.pointId];
    case "spline":
      return orderedSplinePointIds(entity);
    case "ellipse":
      return [entity.centerPointId, entity.majorAxisPointId];
    case "ellipticalArc":
      return [
        entity.startPointId,
        entity.endPointId,
        entity.centerPointId,
        entity.majorAxisPointId,
      ];
    case "conic":
      return [entity.startPointId, entity.controlPointId, entity.endPointId];
    case "bezierCurve":
      return entity.controlPointIds;
    case "profileText":
      return [entity.anchorPointId];
    case "derivedPiecewiseCubic":
      // A derived shell owns no points (its driven terminals belong to its
      // offset relationship's outputs).
      return [];
  }
}

export function constraintReferencesSketchGeometry(
  constraint: ConstraintDefinition,
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return constraint.pointIds.some((pointId) =>
        deletedPointIds.has(pointId),
      );
    case "horizontal":
    case "vertical":
      return deletedEntityIds.has(constraint.entityId);
    case "coincidentProjectedPoint":
    case "pointOnProjectedCurve":
    case "midpointProjectedLine":
      return deletedPointIds.has(constraint.point.pointId);
    case "midpoint":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.line.entityId)
      );
    case "pointOnCurve":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.curve.entityId)
      );
    case "collinear":
      return (
        operandReferencesSketchGeometry(
          constraint.target,
          deletedPointIds,
          deletedEntityIds,
        ) || deletedEntityIds.has(constraint.line.entityId)
      );
    case "collinearProjectedLine":
      return operandReferencesSketchGeometry(
        constraint.target,
        deletedPointIds,
        deletedEntityIds,
      );
    case "normal":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.line.entityId) ||
        deletedEntityIds.has(constraint.curve.entityId)
      );
    case "normalProjectedCurve":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.line.entityId)
      );
    case "symmetric":
      return (
        constraint.pointIds.some((pointId) => deletedPointIds.has(pointId)) ||
        deletedEntityIds.has(constraint.axis.entityId)
      );
    case "symmetricProjectedLine":
      return constraint.pointIds.some((pointId) =>
        deletedPointIds.has(pointId),
      );
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return deletedEntityIds.has(constraint.line.entityId);
    case "tangentProjectedCurve":
    case "concentricProjectedCurve":
      return deletedEntityIds.has(constraint.curve.entityId);
    case "equalOffset":
      return constraint.pairs.some(
        (pair) =>
          deletedEntityIds.has(pair.seedEntityId) ||
          deletedEntityIds.has(pair.offsetEntityId),
      );
    case "tangent":
    case "concentric":
    case "parallel":
    case "perpendicular":
    case "equalLength":
      return constraint.entityIds.some((entityId) =>
        deletedEntityIds.has(entityId),
      );
    case "fixPoint":
      return deletedPointIds.has(constraint.pointId);
  }
}

function operandReferencesSketchGeometry(
  operand: { kind: string; pointId?: SketchPointId; entityId?: SketchEntityId },
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  return (
    (operand.kind === "localPoint" &&
      operand.pointId !== undefined &&
      deletedPointIds.has(operand.pointId)) ||
    (operand.kind === "localEntity" &&
      operand.entityId !== undefined &&
      deletedEntityIds.has(operand.entityId))
  );
}

export function dimensionReferencesSketchGeometry(
  dimension: DimensionDefinition,
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  const operandReferencesDeletedGeometry = (operand: {
    kind: string;
    pointId?: SketchPointId;
    entityId?: SketchEntityId;
  }) =>
    (operand.kind === "localPoint" &&
      operand.pointId !== undefined &&
      deletedPointIds.has(operand.pointId)) ||
    (operand.kind === "localEntity" &&
      operand.entityId !== undefined &&
      deletedEntityIds.has(operand.entityId));

  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance":
      return dimension.pointIds.some((pointId) => deletedPointIds.has(pointId));
    case "pointDatumDistance":
      return deletedPointIds.has(dimension.point.pointId);
    case "circleRadius":
    case "diameter":
      return deletedEntityIds.has(dimension.entityId);
    case "lineLength":
      return deletedEntityIds.has(dimension.entityId);
    case "lineDistance":
    case "lineAngle":
      return dimension.lines.some(operandReferencesDeletedGeometry);
    case "linePointDistance":
      return (
        operandReferencesDeletedGeometry(dimension.line) ||
        operandReferencesDeletedGeometry(dimension.point)
      );
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return (
        deletedEntityIds.has(dimension.entityId) ||
        deletedPointIds.has(dimension.pointId)
      );
  }
}
