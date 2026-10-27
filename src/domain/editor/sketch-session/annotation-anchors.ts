import type {
  ConstraintDefinition,
  DimensionDefinition,
  ProjectedSketchGeometryRef,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import type { SketchAnnotationGlyphKind, SketchSessionState } from "./types";
import type {
  SketchId,
  SketchPointId,
  SketchEntityId,
} from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createSketchPointRef,
  createSketchEntityRef,
} from "./session-definition";
import {
  createReferencePrimitiveRef,
  createCollinearTargetPrimitiveRef,
  createProjectedPrimitiveRef,
  createOffsetAnnotationAnchor,
  getAveragePointPosition,
  getPointPosition,
  getEntityAnchor,
  getAverageEntityAnchor,
  getAverageSketchPoint,
  getReferenceGeometryAnchor,
  getCollinearTargetAnchor,
  getReferenceLineGeometry,
  getReferencePointGeometry,
  getEntityAnchorPointId,
} from "./annotation-reference-geometry";
import type { SketchToolAnchorDescriptor } from "@/core/sketch-tools/editor-schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { getSketchSessionSolvedSnapshot } from "./session-live-solve";
import {
  createPlacedPointDimensionLine,
  getPointDatumDistanceGeometry,
  getCircleLikeGeometry,
  createPlacedCircleDimensionLine,
  getLineSegmentGeometry,
  createPlacedLineLength,
  getSketchLineIntersection,
  getSketchLineDirectionFromCenter,
  getSketchAngleLabelPoint,
} from "./annotation-geometry";
import {
  getDimensionLabelPoint,
  createPlacedParallelLineDistance,
  createPlacedLinePointDistance,
} from "@/core/sketch-constraints/registry";

export function getConstraintGlyphKind(
  constraint: ConstraintDefinition,
): SketchAnnotationGlyphKind {
  switch (constraint.kind) {
    case "coincident":
      return "constraintCoincident";
    case "collinear":
    case "collinearProjectedLine":
      return "constraintCollinear";
    case "parallel":
    case "equalOffset":
      return "constraintParallel";
    case "equalLength":
      return "constraintEqual";
    case "horizontal":
      return "constraintHorizontal";
    case "vertical":
      return "constraintVertical";
    case "fixPoint":
      return "constraintFixed";
    case "angle":
      return "constraintAngle";
    case "perpendicular":
    case "perpendicularProjectedLine":
      return "constraintPerpendicular";
    case "tangentProjectedCurve":
    case "tangent":
      return "constraintTangent";
    case "midpoint":
    case "midpointProjectedLine":
      return "constraintMidpoint";
    case "normal":
    case "normalProjectedCurve":
      return "constraintNormal";
    case "symmetric":
    case "symmetricProjectedLine":
      return "constraintSymmetric";
    case "pointOnProjectedCurve":
    case "pointOnCurve":
      return "constraintPierce";
    case "coincidentProjectedPoint":
      return "constraintCoincident";
    case "parallelProjectedLine":
      return "constraintParallel";
    case "concentric":
    case "concentricProjectedCurve":
      return "constraintConcentric";
  }
}

export function getDimensionGlyphKind(
  dimension: DimensionDefinition,
): SketchAnnotationGlyphKind {
  switch (dimension.kind) {
    case "distance":
    case "pointDatumDistance":
      if (dimension.axis === "horizontal") {
        return "dimensionHorizontal";
      }

      if (dimension.axis === "vertical") {
        return "dimensionVertical";
      }

      return "dimensionDistance";
    case "horizontalDistance":
      return "dimensionHorizontal";
    case "verticalDistance":
      return "dimensionVertical";
    case "circleRadius":
    case "diameter":
      return "dimensionRadius";
    case "lineLength":
    case "lineDistance":
    case "linePointDistance":
      return "dimensionDistance";
    case "lineAngle":
      return "dimensionAngle";
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return "constraintCoincident";
  }
}

export function getConstraintAffectedGeometryRefs(
  sketchId: SketchId,
  constraint: ConstraintDefinition,
): readonly PrimitiveRef[] {
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return constraint.pointIds.map((pointId) =>
        createSketchPointRef(sketchId, pointId),
      );
    case "fixPoint":
      return [createSketchPointRef(sketchId, constraint.pointId)];
    case "horizontal":
    case "vertical":
      return [createSketchEntityRef(sketchId, constraint.entityId)];
    case "equalOffset":
      return constraint.pairs.flatMap((pair) => [
        createSketchEntityRef(sketchId, pair.seedEntityId),
        createSketchEntityRef(sketchId, pair.offsetEntityId),
      ]);
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "tangent":
    case "concentric":
      return constraint.entityIds.map((entityId) =>
        createSketchEntityRef(sketchId, entityId),
      );
    case "midpoint":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
      ];
    case "midpointProjectedLine":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "pointOnCurve":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ];
    case "collinear":
      return [
        createCollinearTargetPrimitiveRef(sketchId, constraint.target),
        createSketchEntityRef(sketchId, constraint.line.entityId),
      ];
    case "collinearProjectedLine":
      return [
        createCollinearTargetPrimitiveRef(sketchId, constraint.target),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "normal":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createSketchEntityRef(sketchId, constraint.curve.entityId),
      ];
    case "normalProjectedCurve":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
    case "symmetric":
      return [
        ...constraint.pointIds.map((pointId) =>
          createSketchPointRef(sketchId, pointId),
        ),
        createSketchEntityRef(sketchId, constraint.axis.entityId),
      ];
    case "symmetricProjectedLine":
      return [
        ...constraint.pointIds.map((pointId) =>
          createSketchPointRef(sketchId, pointId),
        ),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "coincidentProjectedPoint":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedPoint, sketchId)!,
      ];
    case "pointOnProjectedCurve":
      return [
        createSketchPointRef(sketchId, constraint.point.pointId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return [
        createSketchEntityRef(sketchId, constraint.line.entityId),
        createReferencePrimitiveRef(constraint.projectedLine, sketchId)!,
      ];
    case "tangentProjectedCurve":
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
    case "concentricProjectedCurve":
      return [
        createSketchEntityRef(sketchId, constraint.curve.entityId),
        createReferencePrimitiveRef(constraint.projectedCurve, sketchId)!,
      ];
  }
}

export function getDimensionAffectedGeometryRefs(
  sketchId: SketchId,
  dimension: DimensionDefinition,
): readonly PrimitiveRef[] {
  const operandRef = (operand: {
    kind: string;
    pointId?: SketchPointId;
    entityId?: SketchEntityId;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  }): PrimitiveRef | null => {
    if (operand.kind === "localPoint" && operand.pointId) {
      return createSketchPointRef(sketchId, operand.pointId);
    }

    if (operand.kind === "localEntity" && operand.entityId) {
      return createSketchEntityRef(sketchId, operand.entityId);
    }

    if (operand.kind === "projectedGeometry" && operand.reference) {
      return createProjectedPrimitiveRef(operand.reference);
    }

    if (operand.kind === "sketchDatum" && operand.datum) {
      return {
        kind: "sketchDatumReference",
        sketchId,
        datumId: operand.datum,
        geometryKind: operand.datum === "origin" ? "point" : "lineSegment",
      };
    }

    return null;
  };

  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance":
      return dimension.pointIds.map((pointId) =>
        createSketchPointRef(sketchId, pointId),
      );
    case "pointDatumDistance":
      return [
        createSketchPointRef(sketchId, dimension.point.pointId),
        createReferencePrimitiveRef(dimension.datum, sketchId)!,
      ];
    case "circleRadius":
    case "diameter":
      return [createSketchEntityRef(sketchId, dimension.entityId)];
    case "lineLength":
      return [createSketchEntityRef(sketchId, dimension.entityId)];
    case "lineDistance":
    case "lineAngle":
      return dimension.lines
        .map(operandRef)
        .filter((ref): ref is PrimitiveRef => ref !== null);
    case "linePointDistance":
      return [operandRef(dimension.line), operandRef(dimension.point)].filter(
        (ref): ref is PrimitiveRef => ref !== null,
      );
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return [
        createSketchEntityRef(sketchId, dimension.entityId),
        createSketchPointRef(sketchId, dimension.pointId),
      ];
  }
}

export function createConstraintAnnotationAnchor(
  session: SketchSessionState,
  constraint: ConstraintDefinition,
): SketchToolAnchorDescriptor {
  const definition = session.definition;
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return createOffsetAnnotationAnchor(
        getAveragePointPosition(definition, constraint.pointIds),
      );
    case "fixPoint":
      return createOffsetAnnotationAnchor(
        getPointPosition(definition, constraint.pointId),
      );
    case "horizontal":
    case "vertical":
      return createOffsetAnnotationAnchor(
        getEntityAnchor(definition, constraint.entityId),
      );
    case "equalOffset":
      return createOffsetAnnotationAnchor(
        getAverageEntityAnchor(
          definition,
          constraint.pairs.flatMap((pair) => [
            pair.seedEntityId,
            pair.offsetEntityId,
          ]),
        ),
      );
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "tangent":
    case "concentric":
      return createOffsetAnnotationAnchor(
        getAverageEntityAnchor(definition, constraint.entityIds),
      );
    case "midpoint":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(definition, constraint.line.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "midpointProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "pointOnCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(
              definition,
              constraint.curve.entityId,
              getSketchSessionSolvedSnapshot(session),
            ),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "collinear":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getCollinearTargetAnchor(definition, constraint.target),
            getEntityAnchor(definition, constraint.line.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "collinearProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getCollinearTargetAnchor(definition, constraint.target),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "normal":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(definition, constraint.line.entityId),
            getEntityAnchor(definition, constraint.curve.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "normalProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getEntityAnchor(definition, constraint.line.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "symmetric":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getAveragePointPosition(definition, constraint.pointIds),
            getEntityAnchor(definition, constraint.axis.entityId),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "symmetricProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getAveragePointPosition(definition, constraint.pointIds),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "coincidentProjectedPoint":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getReferenceGeometryAnchor(session, constraint.projectedPoint),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "pointOnProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getPointPosition(definition, constraint.point.pointId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getEntityAnchor(definition, constraint.line.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedLine),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "tangentProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getEntityAnchor(definition, constraint.curve.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
    case "concentricProjectedCurve":
      return createOffsetAnnotationAnchor(
        getAverageSketchPoint(
          [
            getEntityAnchor(definition, constraint.curve.entityId),
            getReferenceGeometryAnchor(session, constraint.projectedCurve),
          ].filter((point): point is SketchPoint => point !== null),
        ),
      );
  }
}

export function createDimensionAnnotationAnchor(
  session: SketchSessionState,
  definition: SketchDefinition,
  dimension: DimensionDefinition,
): SketchToolAnchorDescriptor {
  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance": {
      const first = getPointPosition(definition, dimension.pointIds[0]);
      const second = getPointPosition(definition, dimension.pointIds[1]);
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const axis =
        dimension.kind === "distance"
          ? dimension.axis
          : dimension.kind === "horizontalDistance"
            ? "horizontal"
            : "vertical";
      const line = createPlacedPointDimensionLine(
        first,
        second,
        axis,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getDimensionLabelPoint(line, dimension.annotationPlacement),
        offset: { x: 0, y: -18 },
      };
    }
    case "pointDatumDistance": {
      const measured = getPointDatumDistanceGeometry(
        definition,
        session,
        dimension,
      );
      if (!measured) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const line = createPlacedPointDimensionLine(
        measured.point,
        measured.datum,
        dimension.axis,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getDimensionLabelPoint(line, dimension.annotationPlacement),
        offset: { x: 0, y: -18 },
      };
    }
    case "circleRadius":
    case "diameter": {
      const circle = getCircleLikeGeometry(definition, dimension.entityId);
      if (!circle) {
        return createOffsetAnnotationAnchor(
          getEntityAnchor(definition, dimension.entityId),
          { x: 22, y: -22 },
        );
      }

      return {
        kind: "sketchPoint",
        point: getDimensionLabelPoint(
          createPlacedCircleDimensionLine(
            circle,
            dimension.kind,
            dimension.annotationPlacement,
          ),
          dimension.annotationPlacement,
          1,
        ),
        offset: { x: 16, y: -16 },
      };
    }
    case "lineLength": {
      const lineGeometry = getLineSegmentGeometry(
        definition,
        dimension.entityId,
      );
      if (!lineGeometry) {
        return createOffsetAnnotationAnchor(
          getEntityAnchor(definition, dimension.entityId),
          { x: 0, y: -28 },
        );
      }

      const line = createPlacedLineLength(
        lineGeometry,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getDimensionLabelPoint(line, dimension.annotationPlacement),
        offset: { x: 0, y: -18 },
      };
    }
    case "lineDistance": {
      const first = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[0],
      );
      const second = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[1],
      );
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const line = createPlacedParallelLineDistance(
        first,
        second,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getDimensionLabelPoint(line, dimension.annotationPlacement),
        offset: { x: 0, y: -18 },
      };
    }
    case "linePointDistance": {
      const lineGeometry = getReferenceLineGeometry(
        definition,
        session,
        dimension.line,
      );
      const point = getReferencePointGeometry(
        definition,
        session,
        dimension.point,
      );
      if (!lineGeometry || !point) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const line = createPlacedLinePointDistance(
        lineGeometry,
        point,
        dimension.annotationPlacement,
      );
      return {
        kind: "sketchPoint",
        point: getDimensionLabelPoint(line, dimension.annotationPlacement),
        offset: { x: 0, y: -18 },
      };
    }
    case "lineAngle": {
      const first = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[0],
      );
      const second = getReferenceLineGeometry(
        definition,
        session,
        dimension.lines[1],
      );
      if (!first || !second) {
        return createOffsetAnnotationAnchor(null, { x: 0, y: -28 });
      }

      const center = getSketchLineIntersection(first, second) ?? first.start;
      const firstVector = getSketchLineDirectionFromCenter(first, center);
      const secondVector = getSketchLineDirectionFromCenter(second, center);
      const radius = dimension.annotationPlacement?.radius ?? 1;
      const side = dimension.annotationPlacement?.side ?? "minor";
      return {
        kind: "sketchPoint",
        point: getSketchAngleLabelPoint(
          center,
          firstVector,
          secondVector,
          radius,
          side,
        ),
        offset: { x: 12, y: -12 },
      };
    }
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return createOffsetAnnotationAnchor(
        getAveragePointPosition(
          definition,
          [
            getEntityAnchorPointId(definition, dimension.entityId),
            dimension.pointId,
          ].filter((pointId): pointId is SketchPointId => Boolean(pointId)),
        ),
      );
  }
}
