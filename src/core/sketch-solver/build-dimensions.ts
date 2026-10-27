import { isReferenceDimension } from "@/contracts/sketch/schema";
import type { BuildContext } from "./build-context";
import {
  buildArcStartPointCoincidentDimension,
  buildCircleRadiusDimension,
  buildDiameterDimension,
} from "./build-curve-dimensions";
import {
  buildLineAngleDimension,
  buildLineDistanceDimension,
  buildLineLengthDimension,
  buildLinePointDistanceDimension,
} from "./build-line-dimensions";
import {
  buildDistanceDimension,
  buildHorizontalDistanceDimension,
  buildPointDatumDistanceDimension,
} from "./build-point-dimensions";
import { getDrivingDimensionValue } from "./solver-geometry";
export function buildDimensions(context: BuildContext): void {
  const { definition } = context;
  for (const dimension of definition.dimensions) {
    // A reference dimension measures its targets and compiles no residual.
    if (isReferenceDimension(dimension)) {
      continue;
    }
    const drivingValue = getDrivingDimensionValue(dimension);
    if (buildDistanceDimension(context, dimension, drivingValue)) continue;
    if (buildHorizontalDistanceDimension(context, dimension, drivingValue))
      continue;
    if (buildCircleRadiusDimension(context, dimension, drivingValue)) continue;
    if (buildDiameterDimension(context, dimension, drivingValue)) continue;
    if (buildPointDatumDistanceDimension(context, dimension, drivingValue))
      continue;
    if (buildLineLengthDimension(context, dimension, drivingValue)) continue;
    if (buildLineDistanceDimension(context, dimension, drivingValue)) continue;
    if (buildLinePointDistanceDimension(context, dimension, drivingValue))
      continue;
    if (buildLineAngleDimension(context, dimension, drivingValue)) continue;
    if (buildArcStartPointCoincidentDimension(context, dimension)) continue;
  }
}
