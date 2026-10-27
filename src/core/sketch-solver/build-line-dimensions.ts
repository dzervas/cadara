import type { NumericDimensionDefinition as DimensionDefinition } from "@/contracts/sketch/schema";
import {
  createNumericalScalarConstraint,
  lineAngleRadiansDual,
  lineParallelResidualDual,
  pointLineSignedDistanceDual,
} from "./analytic-residuals";
import { dual, dual2 } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import {
  lineAngleRadians,
  lineParallelResidual,
  linesParallelWithinTolerance,
  pointLineSignedDistance,
  resolveLineDimensionOperand,
  resolvePointDimensionOperand,
} from "./line-residuals";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import { getPoint, length, subtract } from "./solver-geometry";

export function buildLineLengthDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (dimension.kind === "lineLength") {
    const entity = lineEntityMap.get(dimension.entityId);
    const start = entity ? pointRecords.get(entity.startPointId) : null;
    const end = entity ? pointRecords.get(entity.endPointId) : null;
    if (!start || !end) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: dimension.dimensionId,
        targetKind: "dimension",
        parameterCount,
        affectedVariableIndices: pIdx(start, end),
        evaluateComponentJacobian: componentJacobian(
          pIdx(start, end),
          (columns) => [
            dual.sub(
              dual2.length(
                dual2.sub(pointDual(columns, end), pointDual(columns, start)),
              ),
              columns.constant(drivingValue),
            ),
          ],
        ),
        evaluateResidual(values) {
          return (
            length(subtract(getPoint(values, end), getPoint(values, start))) -
            drivingValue
          );
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildLineDistanceDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    initialValues,
    lineEntityMap,
    lineDimOperandIdx,
    componentJacobian,
    infiniteDuals,
    lineDimensionOperandDual,
  } = context;
  if (dimension.kind === "lineDistance") {
    const initialFirst = resolveLineDimensionOperand(
      initialValues,
      dimension.lines[0],
      lineEntityMap,
      pointRecords,
      options.projectedReferences ?? [],
    );
    const initialSecond = resolveLineDimensionOperand(
      initialValues,
      dimension.lines[1],
      lineEntityMap,
      pointRecords,
      options.projectedReferences ?? [],
    );
    if (
      !initialFirst ||
      !initialSecond ||
      !linesParallelWithinTolerance(
        initialFirst,
        initialSecond,
        options.tolerances,
      )
    ) {
      return true;
    }

    // Keep the distance and its parallel-line prerequisite smooth during
    // iteration. A thresholded penalty traps valid edits at the boundary as
    // unconstrained trial steps temporarily rotate the initially parallel lines.
    for (const component of ["parallel", "distance"] as const) {
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: [
            ...lineDimOperandIdx(dimension.lines[0]),
            ...lineDimOperandIdx(dimension.lines[1]),
          ],
          evaluateComponentJacobian: componentJacobian(
            [
              ...lineDimOperandIdx(dimension.lines[0]),
              ...lineDimOperandIdx(dimension.lines[1]),
            ],
            (columns) => {
              const first = lineDimensionOperandDual(
                columns,
                dimension.lines[0],
              );
              const second = lineDimensionOperandDual(
                columns,
                dimension.lines[1],
              );
              if (!first || !second) return infiniteDuals(columns, 1);
              if (component === "parallel")
                return [
                  lineParallelResidualDual(
                    first.start,
                    first.end,
                    second.start,
                    second.end,
                  ),
                ];
              const distance = pointLineSignedDistanceDual(
                second.start,
                first.start,
                first.end,
              );
              return [
                dual.sub(
                  drivingValue === 0 ? distance : dual.abs(distance),
                  columns.constant(drivingValue),
                ),
              ];
            },
          ),
          evaluateComponents(values) {
            const first = resolveLineDimensionOperand(
              values,
              dimension.lines[0],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            const second = resolveLineDimensionOperand(
              values,
              dimension.lines[1],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            if (!first || !second) return [Infinity];
            if (component === "parallel")
              return [
                lineParallelResidual(
                  first.start,
                  first.end,
                  second.start,
                  second.end,
                ),
              ];
            const distance = pointLineSignedDistance(
              second.start,
              first.start,
              first.end,
            );
            return [
              (drivingValue === 0 ? distance : Math.abs(distance)) -
                drivingValue,
            ];
          },
          evaluateResidual(values) {
            const first = resolveLineDimensionOperand(
              values,
              dimension.lines[0],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            const second = resolveLineDimensionOperand(
              values,
              dimension.lines[1],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            if (!first || !second) return drivingValue;
            return component === "parallel"
              ? lineParallelResidual(
                  first.start,
                  first.end,
                  second.start,
                  second.end,
                )
              : Math.abs(
                  pointLineSignedDistance(second.start, first.start, first.end),
                ) - drivingValue;
          },
        }),
      );
    }
    return true;
  }
  return false;
}

export function buildLinePointDistanceDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    lineDimOperandIdx,
    pointDimOperandIdx,
    componentJacobian,
    infiniteDuals,
    lineDimensionOperandDual,
    pointDimensionOperandDual,
  } = context;
  if (dimension.kind === "linePointDistance") {
    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: dimension.dimensionId,
        targetKind: "dimension",
        parameterCount,
        affectedVariableIndices: [
          ...lineDimOperandIdx(dimension.line),
          ...pointDimOperandIdx(dimension.point),
        ],
        evaluateComponentJacobian: componentJacobian(
          [
            ...lineDimOperandIdx(dimension.line),
            ...pointDimOperandIdx(dimension.point),
          ],
          (columns) => {
            const line = lineDimensionOperandDual(columns, dimension.line);
            const point = pointDimensionOperandDual(columns, dimension.point);
            if (!line || !point) return infiniteDuals(columns, 1);
            const distance = pointLineSignedDistanceDual(
              point,
              line.start,
              line.end,
            );
            return [
              dual.sub(
                drivingValue === 0 ? distance : dual.abs(distance),
                columns.constant(drivingValue),
              ),
            ];
          },
        ),
        evaluateComponents(values) {
          const line = resolveLineDimensionOperand(
            values,
            dimension.line,
            lineEntityMap,
            pointRecords,
            options.projectedReferences ?? [],
          );
          const point = resolvePointDimensionOperand(
            values,
            dimension.point,
            pointRecords,
            options.projectedReferences ?? [],
          );
          if (!line || !point) return [Infinity];
          const distance = pointLineSignedDistance(point, line.start, line.end);
          return [
            (drivingValue === 0 ? distance : Math.abs(distance)) - drivingValue,
          ];
        },
        evaluateResidual(values) {
          const line = resolveLineDimensionOperand(
            values,
            dimension.line,
            lineEntityMap,
            pointRecords,
            options.projectedReferences ?? [],
          );
          const point = resolvePointDimensionOperand(
            values,
            dimension.point,
            pointRecords,
            options.projectedReferences ?? [],
          );
          return line && point
            ? Math.abs(pointLineSignedDistance(point, line.start, line.end)) -
                drivingValue
            : drivingValue;
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildLineAngleDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    initialValues,
    lineEntityMap,
    lineDimOperandIdx,
    componentJacobian,
    lineDimensionOperandDual,
  } = context;
  if (dimension.kind === "lineAngle") {
    const initialFirst = resolveLineDimensionOperand(
      initialValues,
      dimension.lines[0],
      lineEntityMap,
      pointRecords,
      options.projectedReferences ?? [],
    );
    const initialSecond = resolveLineDimensionOperand(
      initialValues,
      dimension.lines[1],
      lineEntityMap,
      pointRecords,
      options.projectedReferences ?? [],
    );
    const initialAngle =
      initialFirst && initialSecond
        ? lineAngleRadians(
            initialFirst.start,
            initialFirst.end,
            initialSecond.start,
            initialSecond.end,
          )
        : null;
    if (initialAngle === null || initialAngle <= DEGENERATE_NORM_EPSILON) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: dimension.dimensionId,
        targetKind: "dimension",
        parameterCount,
        affectedVariableIndices: [
          ...lineDimOperandIdx(dimension.lines[0]),
          ...lineDimOperandIdx(dimension.lines[1]),
        ],
        evaluateComponentJacobian: componentJacobian(
          [
            ...lineDimOperandIdx(dimension.lines[0]),
            ...lineDimOperandIdx(dimension.lines[1]),
          ],
          (columns) => {
            const first = lineDimensionOperandDual(columns, dimension.lines[0]);
            const second = lineDimensionOperandDual(
              columns,
              dimension.lines[1],
            );
            const angle =
              first && second
                ? lineAngleRadiansDual(
                    first.start,
                    first.end,
                    second.start,
                    second.end,
                  )
                : null;
            return [
              angle === null || angle.value <= DEGENERATE_NORM_EPSILON
                ? columns.constant(drivingValue)
                : dual.sub(angle, columns.constant(drivingValue)),
            ];
          },
        ),
        evaluateResidual(values) {
          const first = resolveLineDimensionOperand(
            values,
            dimension.lines[0],
            lineEntityMap,
            pointRecords,
            options.projectedReferences ?? [],
          );
          const second = resolveLineDimensionOperand(
            values,
            dimension.lines[1],
            lineEntityMap,
            pointRecords,
            options.projectedReferences ?? [],
          );
          if (!first || !second) {
            return drivingValue;
          }

          const angle = lineAngleRadians(
            first.start,
            first.end,
            second.start,
            second.end,
          );
          if (angle === null || angle <= DEGENERATE_NORM_EPSILON) {
            return drivingValue;
          }

          return angle - drivingValue;
        },
      }),
    );
    return true;
  }
  return false;
}
