import type { SketchAnnotationDescriptor } from "@/domain/editor/sketch-session";
import { getToolIconAssetFileName } from "@/core/tools/tool-icons";
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

export function getAnnotationGlyphIconFileName(
  glyphKind: SketchAnnotationDescriptor["glyphKind"],
) {
  switch (glyphKind) {
    case "constraintCoincident":
      return getToolIconAssetFileName("constraintCoincident");
    case "constraintCollinear":
      return getToolIconAssetFileName("constraintCollinear");
    case "constraintParallel":
      return getToolIconAssetFileName("constraintParallel");
    case "constraintEqual":
      return getToolIconAssetFileName("constraintEqual");
    case "constraintHorizontal":
      return getToolIconAssetFileName("constraintHorizontal");
    case "constraintVertical":
      return getToolIconAssetFileName("constraintVertical");
    case "constraintFixed":
      return getToolIconAssetFileName("constraintFix");
    case "constraintAngle":
      return "annotation-angle.svg";
    case "constraintPerpendicular":
      return getToolIconAssetFileName("constraintPerpendicular");
    case "constraintTangent":
      return getToolIconAssetFileName("constraintTangent");
    case "constraintConcentric":
      return getToolIconAssetFileName("constraintConcentric");
    case "constraintMidpoint":
      return getToolIconAssetFileName("constraintMidpoint");
    case "constraintNormal":
      return getToolIconAssetFileName("constraintNormal");
    case "constraintPierce":
      return getToolIconAssetFileName("constraintPierce");
    case "constraintSymmetric":
      return getToolIconAssetFileName("constraintSymmetric");
    case "dimensionDistance":
      return getToolIconAssetFileName("dimension");
    case "dimensionHorizontal":
      return getToolIconAssetFileName("dimensionHorizontal");
    case "dimensionVertical":
      return getToolIconAssetFileName("dimensionVertical");
    case "dimensionRadius":
      return getToolIconAssetFileName("dimensionRadius");
    case "dimensionAngle":
      return "annotation-angle.svg";
  }
}
