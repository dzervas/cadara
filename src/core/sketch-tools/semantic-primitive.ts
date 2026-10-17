import type { SemanticSketchPrimitive } from "@/contracts/semantic/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type { SketchToolValidationResult } from "@/core/sketch-tools/definition";
import type { SketchToolControlValue } from "@/core/sketch-tools/editor-schema";
import { getSketchToolDefinition } from "@/core/sketch-tools/registry";
import { validateAlignedRectanglePoints } from "@/core/sketch-tools/tools/aligned-rectangle";
import { validateThreePointCircle } from "@/core/sketch-tools/tools/three-point-circle";
import { validateThreePointArc } from "@/core/sketch-tools/tools/three-point-arc";
import { validateCenterPointArc } from "@/core/sketch-tools/tools/center-point-arc";
import { validateTangentArc } from "@/core/sketch-tools/tools/tangent-arc";

/** Convert semantic values into contribution inputs, never interaction state/events. */
export function sketchPrimitiveContributionInput(
  primitive: SemanticSketchPrimitive,
) {
  let points: readonly SketchPoint[];
  switch (primitive.kind) {
    case "profileText":
      points = [primitive.anchor, primitive.heightPoint];
      break;
    case "bezierCurve":
    case "controlPointSpline":
      points = primitive.controlPoints;
      break;
    case "spline":
      points = primitive.fitPoints;
      break;
    case "point":
      points = [primitive.position];
      break;
    case "circle":
    case "inscribedPolygon":
    case "circumscribedPolygon":
      points = [
        primitive.center,
        [primitive.center[0] + primitive.radius, primitive.center[1]],
      ];
      break;
    case "ellipticalArc":
    case "conic":
    case "ellipse":
    case "threePointCircle":
    case "threePointArc":
      points = primitive.points;
      break;
    case "centerPointArc":
      points = [primitive.center, primitive.start, primitive.end];
      break;
    case "tangentArc":
      points = [
        primitive.start,
        [
          primitive.start[0] + primitive.direction[0],
          primitive.start[1] + primitive.direction[1],
        ],
        primitive.end,
      ];
      break;
    case "alignedRectangle":
      points = [primitive.start, primitive.end, primitive.heightPoint];
      break;
    default:
      points = [primitive.start, primitive.end];
  }
  const settings: Record<string, SketchToolControlValue> = primitive.kind === "profileText"
    ? { text: primitive.text, horizontalAlign: primitive.horizontalAlign, verticalAlign: primitive.verticalAlign }
    : {};
  return {
    start: points[0]!,
    end: points.at(-1)!,
    points,
    settings,
    placements: null,
  };
}

/** Shape validation is the same pure rule the browser tool uses. */
export function validateSketchPrimitive(
  primitive: SemanticSketchPrimitive,
): SketchToolValidationResult {
  const { start, end, points, settings } = sketchPrimitiveContributionInput(primitive);
  if (points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1])))
    return { valid: false, message: "Coordinates must be finite." };
  if (
    "radius" in primitive &&
    (!Number.isFinite(primitive.radius) || primitive.radius <= 0)
  )
    return {
      valid: false,
      message: "Radius must be finite and greater than zero.",
    };
  switch (primitive.kind) {
    case "alignedRectangle":
      return validateAlignedRectanglePoints(points);
    case "threePointCircle":
      return validateThreePointCircle(points);
    case "threePointArc":
      return validateThreePointArc(points);
    case "centerPointArc":
      return validateCenterPointArc(points);
    case "tangentArc":
      return validateTangentArc(points);
    default: {
      const tool = getSketchToolDefinition(primitive.kind);
      return tool.validateContribution?.(points, settings) ?? tool.validate(start, end);
    }
  }
}
