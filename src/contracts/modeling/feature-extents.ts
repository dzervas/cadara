import type {
  ExtrudeEndCondition,
  ExtrudeFeatureExtent,
  ExtrudeFeatureParameters,
  RevolveEndCondition,
  RevolveFeatureExtent,
  RevolveFeatureParameters,
} from "@/contracts/modeling/schema";

export function getExtrudeFeatureExtent(
  parameters: ExtrudeFeatureParameters,
): ExtrudeFeatureExtent {
  return parameters.extent;
}

export function getRevolveFeatureExtent(
  parameters: RevolveFeatureParameters,
): RevolveFeatureExtent {
  return parameters.extent;
}

export type SurfaceExtrudeGeneratedSideFaceEndRole =
  | "one-side-end"
  | "combined-ends";

/**
 * The surface-prism provenance role is determined solely by the authored
 * surface extrude extent, including when that extent originated in an import.
 */
export function getSurfaceExtrudeGeneratedSideFaceEndRole(input: {
  resultBodyType: ExtrudeFeatureParameters["resultBodyType"];
  extent: Pick<ExtrudeFeatureExtent, "mode">;
}): SurfaceExtrudeGeneratedSideFaceEndRole | null {
  if (input.resultBodyType !== "surface") return null;
  return input.extent.mode === "oneSide" ? "one-side-end" : "combined-ends";
}

export function getExtrudeExtentEnds(
  extent: ExtrudeFeatureExtent,
): readonly ExtrudeEndCondition[] {
  switch (extent.mode) {
    case "oneSide":
    case "symmetric":
      return [extent.end];
    case "twoSide":
      return [extent.firstEnd, extent.secondEnd];
  }
}

export function getRevolveExtentEnds(
  extent: RevolveFeatureExtent,
): readonly RevolveEndCondition[] {
  switch (extent.mode) {
    case "oneSide":
    case "symmetric":
      return [extent.end];
    case "twoSide":
      return [extent.firstEnd, extent.secondEnd];
  }
}
