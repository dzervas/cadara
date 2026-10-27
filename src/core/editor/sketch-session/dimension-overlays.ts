import type { SketchSessionState } from "./types";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchToolOverlayDescriptor } from "@/core/sketch-tools/editor-schema";
import {
  getPointPosition,
  getReferenceLineGeometry,
  getReferencePointGeometry,
} from "./annotation-reference-geometry";
import {
  createPlacedPointDimensionLine,
  getPointDatumDistanceGeometry,
  getCircleLikeGeometry,
  createPlacedCircleDimensionLine,
  getLineSegmentGeometry,
  createPlacedLineLength,
  getSketchLineIntersection,
  getSketchLineDirectionFromCenter,
  createAngleWitnessLines,
  getSketchAngleLabelPoint,
} from "./annotation-geometry";
import {
  extendDimensionLineToLabel,
  getDimensionLabelPoint,
  createPlacedParallelLineDistance,
  createPlacedLinePointDistance,
} from "@/core/sketch-constraints/registry";
import { dimensionOverlayValue } from "./annotation-labels";
import type { SketchPoint } from "@/contracts/modeling/schema";

export function buildCommittedDimensionOverlays(
  session: SketchSessionState,
  definition: SketchDefinition,
): readonly SketchToolOverlayDescriptor[] {
  return definition.dimensions.flatMap(
    (dimension): SketchToolOverlayDescriptor[] => {
      switch (dimension.kind) {
        case "distance":
        case "horizontalDistance":
        case "verticalDistance": {
          const first = getPointPosition(definition, dimension.pointIds[0]);
          const second = getPointPosition(definition, dimension.pointIds[1]);
          if (!first || !second) {
            return [];
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
          const drawn = extendDimensionLineToLabel(
            line,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: axis,
              start: drawn.start,
              end: drawn.end,
              value: dimensionOverlayValue(dimension),
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getDimensionLabelPoint(
                  line,
                  dimension.annotationPlacement,
                ),
                offset: { x: 0, y: -18 },
              },
              extensionLines: [
                {
                  id: `${dimension.dimensionId}-extension-a`,
                  label: "Extension",
                  start: first,
                  end: line.start,
                },
                {
                  id: `${dimension.dimensionId}-extension-b`,
                  label: "Extension",
                  start: second,
                  end: line.end,
                },
              ],
            },
          ];
        }
        case "pointDatumDistance": {
          const measured = getPointDatumDistanceGeometry(
            definition,
            session,
            dimension,
          );
          if (!measured) {
            return [];
          }

          const line = createPlacedPointDimensionLine(
            measured.point,
            measured.datum,
            dimension.axis,
            dimension.annotationPlacement,
          );
          const drawn = extendDimensionLineToLabel(
            line,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: dimension.axis,
              start: drawn.start,
              end: drawn.end,
              value: dimensionOverlayValue(dimension),
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getDimensionLabelPoint(
                  line,
                  dimension.annotationPlacement,
                ),
                offset: { x: 0, y: -18 },
              },
              extensionLines: [
                {
                  id: `${dimension.dimensionId}-extension-a`,
                  label: "Extension",
                  start: measured.point,
                  end: line.start,
                },
                {
                  id: `${dimension.dimensionId}-extension-b`,
                  label: "Extension",
                  start: measured.datum,
                  end: line.end,
                },
              ],
            },
          ];
        }
        case "circleRadius":
        case "diameter": {
          const circle = getCircleLikeGeometry(definition, dimension.entityId);
          if (!circle) {
            return [];
          }

          const line = createPlacedCircleDimensionLine(
            circle,
            dimension.kind,
            dimension.annotationPlacement,
          );
          const drawn = extendDimensionLineToLabel(
            line,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind:
                dimension.kind === "diameter" ? "diameter" : "radius",
              start: drawn.start,
              end: drawn.end,
              value: dimensionOverlayValue(dimension),
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getDimensionLabelPoint(
                  line,
                  dimension.annotationPlacement,
                  1,
                ),
                offset: { x: 16, y: -16 },
              },
            },
          ];
        }
        case "lineLength": {
          const lineGeometry = getLineSegmentGeometry(
            definition,
            dimension.entityId,
          );
          if (!lineGeometry) {
            return [];
          }

          const line = createPlacedLineLength(
            lineGeometry,
            dimension.annotationPlacement,
          );
          const drawn = extendDimensionLineToLabel(
            line,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: "lineLength",
              start: drawn.start,
              end: drawn.end,
              value: dimensionOverlayValue(dimension),
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getDimensionLabelPoint(
                  line,
                  dimension.annotationPlacement,
                ),
                offset: { x: 0, y: -18 },
              },
              extensionLines:
                line.offset === 0
                  ? []
                  : [
                      {
                        id: `${dimension.dimensionId}-extension-a`,
                        label: "Extension",
                        start: lineGeometry.start,
                        end: line.start,
                      },
                      {
                        id: `${dimension.dimensionId}-extension-b`,
                        label: "Extension",
                        start: lineGeometry.end,
                        end: line.end,
                      },
                    ],
            },
          ];
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
            return [];
          }

          const line = createPlacedParallelLineDistance(
            first,
            second,
            dimension.annotationPlacement,
          );
          const drawn = extendDimensionLineToLabel(
            line,
            dimension.annotationPlacement,
          );
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: "lineDistance",
              start: drawn.start,
              end: drawn.end,
              value: dimensionOverlayValue(dimension),
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getDimensionLabelPoint(
                  line,
                  dimension.annotationPlacement,
                ),
                offset: { x: 0, y: -18 },
              },
            },
          ];
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
            return [];
          }

          const line = createPlacedLinePointDistance(
            lineGeometry,
            point,
            dimension.annotationPlacement,
          );
          const drawn = extendDimensionLineToLabel(
            line,
            dimension.annotationPlacement,
          );
          // cadara-bmy0: the foot on the line and the point keep extension
          // lines to the dimension line (as its authoring preview draws).
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "dimensionLine",
              label: dimension.label,
              referenceKind: "pointLineDistance",
              start: drawn.start,
              end: drawn.end,
              value: dimensionOverlayValue(dimension),
              unit: "mm",
              labelAnchor: {
                kind: "sketchPoint",
                point: getDimensionLabelPoint(
                  line,
                  dimension.annotationPlacement,
                ),
                offset: { x: 0, y: -18 },
              },
              extensionLines: [
                {
                  id: `${dimension.dimensionId}-extension-a`,
                  label: "Extension",
                  start: line.foot,
                  end: line.start,
                },
                {
                  id: `${dimension.dimensionId}-extension-b`,
                  label: "Extension",
                  start: point,
                  end: line.end,
                },
              ],
            },
          ];
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
            return [];
          }

          const center =
            getSketchLineIntersection(first, second) ?? first.start;
          const firstVector = getSketchLineDirectionFromCenter(first, center);
          const secondVector = getSketchLineDirectionFromCenter(second, center);
          const radius = dimension.annotationPlacement?.radius ?? 1;
          const side = dimension.annotationPlacement?.side ?? "minor";
          const start: SketchPoint = [
            center[0] + firstVector[0] * radius,
            center[1] + firstVector[1] * radius,
          ];
          const end: SketchPoint = [
            center[0] + secondVector[0] * radius,
            center[1] + secondVector[1] * radius,
          ];
          return [
            {
              id: `${dimension.dimensionId}-overlay`,
              kind: "angleArc",
              label: dimension.label,
              center,
              start,
              end,
              radius,
              side,
              witnessLines: createAngleWitnessLines(
                `${dimension.dimensionId}-overlay`,
                first,
                second,
                start,
                end,
              ),
              labelAnchor: {
                kind: "sketchPoint",
                point: getSketchAngleLabelPoint(
                  center,
                  firstVector,
                  secondVector,
                  radius,
                  side,
                ),
                offset: { x: 12, y: -12 },
              },
            },
          ];
        }
        case "arcStartPointCoincident":
        case "arcEndPointCoincident":
          return [];
      }
    },
  );
}
