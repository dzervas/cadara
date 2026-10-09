import type { SketchAnnotationDescriptor } from "@/domain/editor/sketch-session";
import { getToolIconSrc } from "@/core/tools/tool-icons";
import { getSketchRenderingPaletteToken } from "@/components/cad/sketch-rendering-palette";

/**
 * The glyph and tone of a sketch annotation, shared by the viewport layer
 * and the T14e Constraints list.
 */
export function getAnnotationConstraintColor(
  annotation: SketchAnnotationDescriptor,
) {
  if (annotation.constraintDisplay?.isAffectedOverconstraint) {
    return `var(${getSketchRenderingPaletteToken("overconstrained")})`;
  }

  // T13d (D12): a reference dimension only measures; it reads muted.
  if (annotation.reference) {
    return "var(--cad-muted-foreground)";
  }

  if (annotation.constraintDisplay?.state === "constrained") {
    return `var(${getSketchRenderingPaletteToken("constrained")})`;
  }

  return `var(${getSketchRenderingPaletteToken("underconstrained")})`;
}

export function getAnnotationGlyphIconSrc(
  glyphKind: SketchAnnotationDescriptor["glyphKind"],
) {
  switch (glyphKind) {
    case "constraintCoincident":
      return getToolIconSrc("constraintCoincident");
    case "constraintCollinear":
      return getToolIconSrc("constraintCollinear");
    case "constraintParallel":
      return getToolIconSrc("constraintParallel");
    case "constraintEqual":
      return getToolIconSrc("constraintEqual");
    case "constraintHorizontal":
      return getToolIconSrc("constraintHorizontal");
    case "constraintVertical":
      return getToolIconSrc("constraintVertical");
    case "constraintFixed":
      return getToolIconSrc("constraintFix");
    case "constraintAngle":
      return "/icons/drawing-angular-dim-line-to-line.svg";
    case "constraintPerpendicular":
      return "/icons/sketch-perpendicular.svg";
    case "constraintTangent":
      return "/icons/sketch-tangent.svg";
    case "constraintConcentric":
      return getToolIconSrc("constraintConcentric");
    case "constraintMidpoint":
      return getToolIconSrc("constraintMidpoint");
    case "constraintNormal":
      return getToolIconSrc("constraintNormal");
    case "constraintPierce":
      return getToolIconSrc("constraintPierce");
    case "constraintSymmetric":
      return getToolIconSrc("constraintSymmetric");
    case "dimensionDistance":
      return getToolIconSrc("dimension");
    case "dimensionHorizontal":
      return getToolIconSrc("dimension");
    case "dimensionVertical":
      return getToolIconSrc("dimension");
    case "dimensionRadius":
      return getToolIconSrc("dimension");
    case "dimensionAngle":
      return "/icons/drawing-angular-dim-line-to-line.svg";
  }
}
