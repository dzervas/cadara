import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import type { DefinitionValidationContext } from "./definition-validation-context";
import { makeDiagnostic } from "./solver-geometry";
export function validateDimensionRecord(
  context: DefinitionValidationContext,
  dimension: SketchDefinition["dimensions"][number],
): void {
  const {
    diagnostics,
    dimensionIds,
    pointMap,
    entityMap,
    validateDatumDimensionTarget,
    validateProjectedDimensionTarget,
  } = context;

  if (!dimensionIds.has(dimension.dimensionId)) {
    diagnostics.push(
      makeDiagnostic(
        "dimension-missing-from-order",
        "error",
        `Dimension ${dimension.dimensionId} is not listed in dimensionIds.`,
        { kind: "dimension", dimensionId: dimension.dimensionId },
      ),
    );
  }

  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance":
      if (!dimension.pointIds.every((pointId) => pointMap.has(pointId))) {
        diagnostics.push(
          makeDiagnostic(
            "missing-dimension-point",
            "error",
            `‘${dimension.label}’ references a point that no longer exists.`,
            { kind: "dimension", dimensionId: dimension.dimensionId },
          ),
        );
      }
      break;
    case "pointDatumDistance":
      if (!pointMap.has(dimension.point.pointId)) {
        diagnostics.push(
          makeDiagnostic(
            "missing-dimension-point",
            "error",
            `‘${dimension.label}’ references a point that no longer exists.`,
            { kind: "dimension", dimensionId: dimension.dimensionId },
          ),
        );
      }
      validateDatumDimensionTarget(
        dimension.dimensionId,
        dimension.datum.datum,
        ["origin"],
      );
      break;
    case "circleRadius":
      if (!entityMap.has(dimension.entityId)) {
        diagnostics.push(
          makeDiagnostic(
            "missing-dimension-entity",
            "error",
            `‘${dimension.label}’ references geometry that no longer exists.`,
            { kind: "dimension", dimensionId: dimension.dimensionId },
          ),
        );
      }
      break;
    case "diameter": {
      const entity = entityMap.get(dimension.entityId);
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
        diagnostics.push(
          makeDiagnostic(
            "missing-dimension-entity",
            "error",
            `‘${dimension.label}’ references a circle or arc that no longer exists.`,
            { kind: "dimension", dimensionId: dimension.dimensionId },
          ),
        );
      }
      break;
    }
    case "lineLength": {
      const entity = entityMap.get(dimension.entityId);
      if (!entity || entity.kind !== "lineSegment") {
        diagnostics.push(
          makeDiagnostic(
            "missing-dimension-entity",
            "error",
            `‘${dimension.label}’ references a line that no longer exists.`,
            { kind: "dimension", dimensionId: dimension.dimensionId },
          ),
        );
      }
      break;
    }
    case "lineDistance":
    case "lineAngle":
      for (const line of dimension.lines) {
        if (line.kind === "localEntity") {
          const entity = entityMap.get(line.entityId);
          if (!entity || entity.kind !== "lineSegment") {
            diagnostics.push(
              makeDiagnostic(
                "missing-dimension-entity",
                "error",
                `‘${dimension.label}’ references a line that no longer exists.`,
                { kind: "dimension", dimensionId: dimension.dimensionId },
              ),
            );
          }
        } else if (line.kind === "sketchDatum") {
          validateDatumDimensionTarget(dimension.dimensionId, line.datum, [
            "axis",
          ]);
        } else {
          validateProjectedDimensionTarget(
            dimension.dimensionId,
            line.reference,
            ["projectedLineSegment"],
          );
        }
      }
      break;
    case "linePointDistance":
      if (dimension.line.kind === "localEntity") {
        const entity = entityMap.get(dimension.line.entityId);
        if (!entity || entity.kind !== "lineSegment") {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `‘${dimension.label}’ references a line that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
      } else if (dimension.line.kind === "sketchDatum") {
        validateDatumDimensionTarget(
          dimension.dimensionId,
          dimension.line.datum,
          ["axis"],
        );
      } else {
        validateProjectedDimensionTarget(
          dimension.dimensionId,
          dimension.line.reference,
          ["projectedLineSegment"],
        );
      }
      if (dimension.point.kind === "localPoint") {
        if (!pointMap.has(dimension.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-point",
              "error",
              `‘${dimension.label}’ references a point that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
      } else if (dimension.point.kind === "sketchDatum") {
        validateDatumDimensionTarget(
          dimension.dimensionId,
          dimension.point.datum,
          ["origin"],
        );
      } else {
        validateProjectedDimensionTarget(
          dimension.dimensionId,
          dimension.point.reference,
          ["projectedPoint"],
        );
      }
      break;
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      if (
        !entityMap.has(dimension.entityId) ||
        !pointMap.has(dimension.pointId)
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-arc-endpoint-reference",
            "error",
            `‘${dimension.label}’ references an arc or point that no longer exists.`,
            { kind: "dimension", dimensionId: dimension.dimensionId },
          ),
        );
      }
      break;
  }
}
