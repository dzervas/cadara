import {
  isReferenceDimension,
  requireDrivingDimensionValue,
} from "@/contracts/sketch/schema";
import type {
  ConstraintDefinition,
  DimensionDefinition,
} from "@/contracts/sketch/schema";
import {
  getAuthoredLiteralValue,
  isExpressionAuthoredValue,
  getAuthoredFormText,
} from "@/contracts/modeling/authored-values";
import type { AuthoredValue } from "@/contracts/modeling/authored-values";

export function describeConstraint(constraint: ConstraintDefinition) {
  switch (constraint.kind) {
    case "coincident":
      return "Coincident points";
    case "parallel":
      return "Parallel lines";
    case "equalOffset":
      return "Equal line offsets";
    case "equalLength":
      return "Equal length or radius";
    case "horizontal":
      return "Horizontal line";
    case "vertical":
      return "Vertical line";
    case "fixPoint":
      return "Fixed point";
    case "angle":
      return `${((constraint.valueRadians * 180) / Math.PI).toFixed(1)} deg`;
    case "perpendicular":
      return "Perpendicular lines";
    case "midpoint":
      return "Point at midpoint";
    case "midpointProjectedLine":
      return "Point at projected midpoint";
    case "pointOnCurve":
      return "Point on curve";
    case "collinear":
      return "Collinear";
    case "collinearProjectedLine":
      return "Collinear to projected line";
    case "coincidentProjectedPoint":
      return "Coincident projected point";
    case "pointOnProjectedCurve":
      return "Point on projected curve";
    case "parallelProjectedLine":
      return "Parallel to projected line";
    case "perpendicularProjectedLine":
      return "Perpendicular to projected line";
    case "tangentProjectedCurve":
      return "Tangent to projected curve";
    case "tangent":
      return "Tangent curves";
    case "concentric":
      return "Concentric curves";
    case "concentricProjectedCurve":
      return "Concentric with projected curve";
    case "normal":
      return "Line normal to curve";
    case "normalProjectedCurve":
      return "Line normal to projected curve";
    case "symmetric":
      return "Symmetric points";
    case "symmetricProjectedLine":
      return "Symmetric points about projected line";
  }
}

const CALCULATED_DIMENSION_SYMBOL = "\u0192";

// ƒ denotes an expression-driven value.

/**
 * T17p2 (F-2): the number a dimension-line overlay carries: a driving
 * literal's value; null for a reference or an expression (the overlay's
 * value is a number, never the authored wrapper).
 */
export function dimensionOverlayValue(
  dimension: Exclude<
    DimensionDefinition,
    { kind: "lineAngle" | "arcStartPointCoincident" | "arcEndPointCoincident" }
  >,
): number | null {
  return isReferenceDimension(dimension)
    ? null
    : getAuthoredLiteralValue(
        requireDrivingDimensionValue(dimension, dimension.value),
      );
}

function formatAuthoredDimensionNumber(
  value: AuthoredValue<number>,
  digits: number,
  resolvedValue?: number,
) {
  if (isExpressionAuthoredValue(value)) {
    return resolvedValue === undefined
      ? `${CALCULATED_DIMENSION_SYMBOL} ${getAuthoredFormText(value)}`
      : `${CALCULATED_DIMENSION_SYMBOL} ${resolvedValue.toFixed(digits)}`;
  }

  const literal = getAuthoredLiteralValue(value);
  return literal === null
    ? getAuthoredFormText(value)
    : literal.toFixed(digits);
}

function formatAuthoredDimensionDegrees(
  value: AuthoredValue<number>,
  digits: number,
  resolvedRadians?: number,
) {
  if (isExpressionAuthoredValue(value)) {
    return resolvedRadians === undefined
      ? `${CALCULATED_DIMENSION_SYMBOL} ${getAuthoredFormText(value)}`
      : `${CALCULATED_DIMENSION_SYMBOL} ${((resolvedRadians * 180) / Math.PI).toFixed(digits)}`;
  }

  const literal = getAuthoredLiteralValue(value);
  return literal === null
    ? getAuthoredFormText(value)
    : ((literal * 180) / Math.PI).toFixed(digits);
}

/**
 * T13d (D12): a reference dimension's measured value in parentheses, e.g.
 * "(24.00)" or "(60.0°)"; "(—)" when the quantity is undefined.
 */
function formatReferenceDimensionValue(
  dimension: DimensionDefinition,
  measuredValue: number | null,
) {
  if (measuredValue === null) {
    return "(—)";
  }
  return dimension.kind === "lineAngle"
    ? `(${((measuredValue * 180) / Math.PI).toFixed(1)}°)`
    : `(${Math.abs(measuredValue).toFixed(2)})`;
}

function getDimensionQuantityNoun(dimension: DimensionDefinition) {
  switch (dimension.kind) {
    case "circleRadius":
      return "radius";
    case "diameter":
      return "diameter";
    case "lineLength":
      return "length";
    case "lineAngle":
      return "angle";
    default:
      return "distance";
  }
}

export function describeDimension(
  dimension: DimensionDefinition,
  resolvedValue?: number | null,
) {
  if (isReferenceDimension(dimension)) {
    // Review A-5: the angle's "°" is its unit.
    const unit = dimension.kind === "lineAngle" ? "" : " mm";
    return `${formatReferenceDimensionValue(dimension, resolvedValue ?? null)}${unit} reference ${getDimensionQuantityNoun(dimension)}`;
  }
  const resolved = resolvedValue ?? undefined;
  switch (dimension.kind) {
    case "distance":
    case "pointDatumDistance":
    case "horizontalDistance":
    case "verticalDistance":
    case "circleRadius":
    case "diameter":
    case "lineLength":
    case "lineDistance":
    case "linePointDistance":
      return `${formatAuthoredDimensionNumber(requireDrivingDimensionValue(dimension, dimension.value), 2, resolved)} mm ${getDimensionQuantityNoun(dimension)}`;
    case "lineAngle":
      return `${formatAuthoredDimensionDegrees(requireDrivingDimensionValue(dimension, dimension.valueRadians), 1, resolved)} deg angle`;
    case "arcStartPointCoincident":
      return "Arc start coincident";
    case "arcEndPointCoincident":
      return "Arc end coincident";
  }
}

export function formatDimensionVisibleLabel(
  dimension: DimensionDefinition,
  resolvedValue?: number | null,
) {
  if (isReferenceDimension(dimension)) {
    return formatReferenceDimensionValue(dimension, resolvedValue ?? null);
  }
  const resolved = resolvedValue ?? undefined;
  switch (dimension.kind) {
    case "distance":
    case "pointDatumDistance":
    case "horizontalDistance":
    case "verticalDistance":
    case "circleRadius":
    case "diameter":
    case "lineLength":
    case "lineDistance":
    case "linePointDistance":
      return formatAuthoredDimensionNumber(
        requireDrivingDimensionValue(dimension, dimension.value),
        2,
        resolved,
      );
    case "lineAngle":
      return `${formatAuthoredDimensionDegrees(requireDrivingDimensionValue(dimension, dimension.valueRadians), 1, resolved)}°`;
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return "Coincident";
  }
}
