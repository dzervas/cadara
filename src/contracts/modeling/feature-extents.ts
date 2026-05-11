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
