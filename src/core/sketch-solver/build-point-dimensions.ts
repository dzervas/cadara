import type { NumericDimensionDefinition as DimensionDefinition } from "@/contracts/sketch/schema";
import { createNumericalScalarConstraint } from "./analytic-residuals";
import { dual, dual2 } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import { resolveSketchDatumPoint } from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import {
  addPointGradient,
  getPoint,
  length,
  subtract,
  zeroVector,
} from "./solver-geometry";

export function buildDistanceDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (dimension.kind === "distance") {
    const left = pointRecords.get(dimension.pointIds[0]);
    const right = pointRecords.get(dimension.pointIds[1]);
    if (!left || !right) {
      return true;
    }

    scalarConstraints.push({
      id: dimension.dimensionId,
      targetKind: "dimension",
      evaluateComponentJacobian: componentJacobian(
        pIdx(left, right),
        (columns) => {
          const delta = dual2.sub(
            pointDual(columns, right),
            pointDual(columns, left),
          );
          return [
            dual.sub(
              dimension.axis === "aligned"
                ? dual2.length(delta)
                : delta[dimension.axis === "horizontal" ? 0 : 1],
              columns.constant(drivingValue),
            ),
          ];
        },
      ),
      evaluateComponents(values) {
        const delta = subtract(getPoint(values, right), getPoint(values, left));
        return [
          (dimension.axis === "aligned"
            ? length(delta)
            : delta[dimension.axis === "horizontal" ? 0 : 1]) - drivingValue,
        ];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const a = getPoint(values, left);
        const b = getPoint(values, right);
        const delta =
          dimension.axis === "aligned" ? subtract(a, b) : subtract(b, a);

        if (dimension.axis === "aligned") {
          const current = length(delta);
          if (current < DEGENERATE_NORM_EPSILON) {
            return {
              residual: 0.5 * drivingValue * drivingValue,
              gradient,
            };
          }
          const err = current - drivingValue;
          const coeffX = (err * delta[0]) / current;
          const coeffY = (err * delta[1]) / current;
          addPointGradient(gradient, left, coeffX, coeffY);
          addPointGradient(gradient, right, -coeffX, -coeffY);
          return { residual: 0.5 * err * err, gradient };
        }

        const index = dimension.axis === "horizontal" ? 0 : 1;
        const err = delta[index] - drivingValue;
        if (index === 0) {
          addPointGradient(gradient, left, -err, 0);
          addPointGradient(gradient, right, err, 0);
        } else {
          addPointGradient(gradient, left, 0, -err);
          addPointGradient(gradient, right, 0, err);
        }
        return { residual: 0.5 * err * err, gradient };
      },
    });
    return true;
  }
  return false;
}

export function buildHorizontalDistanceDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (
    dimension.kind === "horizontalDistance" ||
    dimension.kind === "verticalDistance"
  ) {
    const left = pointRecords.get(dimension.pointIds[0]);
    const right = pointRecords.get(dimension.pointIds[1]);
    if (!left || !right) {
      return true;
    }

    scalarConstraints.push({
      id: dimension.dimensionId,
      targetKind: "dimension",
      evaluateComponentJacobian: componentJacobian(
        pIdx(left, right),
        (columns) => [
          dual.sub(
            dual2.sub(pointDual(columns, right), pointDual(columns, left))[
              dimension.kind === "horizontalDistance" ? 0 : 1
            ],
            columns.constant(drivingValue),
          ),
        ],
      ),
      evaluateComponents(values) {
        const delta = subtract(getPoint(values, right), getPoint(values, left));
        return [
          delta[dimension.kind === "horizontalDistance" ? 0 : 1] - drivingValue,
        ];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const a = getPoint(values, left);
        const b = getPoint(values, right);
        const delta = subtract(b, a);
        const err =
          (dimension.kind === "horizontalDistance" ? delta[0] : delta[1]) -
          drivingValue;
        if (dimension.kind === "horizontalDistance") {
          addPointGradient(gradient, left, -err, 0);
          addPointGradient(gradient, right, err, 0);
        } else {
          addPointGradient(gradient, left, 0, -err);
          addPointGradient(gradient, right, 0, err);
        }
        return { residual: 0.5 * err * err, gradient };
      },
    });
    return true;
  }
  return false;
}

export function buildPointDatumDistanceDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    initialValues,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (dimension.kind === "pointDatumDistance") {
    const point = pointRecords.get(dimension.point.pointId);
    const datumPoint = resolveSketchDatumPoint(dimension.datum.datum);
    if (!point || !datumPoint) {
      return true;
    }

    // Axis distances are displayed as magnitudes, but a rebuild must retain
    // the point's side of the datum. An absolute residual lets optimizer
    // trials cross the datum and converge on the opposite, equally valid root.
    const initialPoint = getPoint(initialValues, point);
    const horizontalSide = initialPoint[0] < datumPoint[0] ? -1 : 1;
    const verticalSide = initialPoint[1] < datumPoint[1] ? -1 : 1;
    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: dimension.dimensionId,
        targetKind: "dimension",
        parameterCount,
        affectedVariableIndices: pIdx(point),
        evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) => {
          const delta = dual2.sub(
            pointDual(columns, point),
            columns.constant2(datumPoint),
          );
          if (drivingValue === 0)
            return dimension.axis === "aligned"
              ? delta
              : [delta[dimension.axis === "horizontal" ? 0 : 1]];
          return [
            dual.sub(
              dimension.axis === "aligned"
                ? dual2.length(delta)
                : dual.abs(delta[dimension.axis === "horizontal" ? 0 : 1]),
              columns.constant(drivingValue),
            ),
          ];
        }),
        evaluateComponents(values) {
          const delta = subtract(getPoint(values, point), datumPoint);
          if (drivingValue === 0)
            return dimension.axis === "aligned"
              ? delta
              : [delta[dimension.axis === "horizontal" ? 0 : 1]];
          return [
            (dimension.axis === "aligned"
              ? length(delta)
              : Math.abs(delta[dimension.axis === "horizontal" ? 0 : 1])) -
              drivingValue,
          ];
        },
        evaluateResidual(values) {
          const localPoint = getPoint(values, point);
          if (dimension.axis === "horizontal") {
            return (
              horizontalSide * (localPoint[0] - datumPoint[0]) - drivingValue
            );
          }

          if (dimension.axis === "vertical") {
            return (
              verticalSide * (localPoint[1] - datumPoint[1]) - drivingValue
            );
          }

          return length(subtract(localPoint, datumPoint)) - drivingValue;
        },
      }),
    );
    return true;
  }
  return false;
}
