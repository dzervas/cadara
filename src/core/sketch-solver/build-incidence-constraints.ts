import type { ConstraintDefinition } from "@/contracts/sketch/schema";
import {
  closestSplineSpanLocation,
  evaluateSplineSpan,
} from "@/contracts/sketch/spline-geometry";
import {
  closestPointResidualDuals,
  createNumericalScalarConstraint,
  midpointDual,
  pointLineSignedDistanceDual,
  unitVectorDual,
} from "./analytic-residuals";
import { dual2, dualColumns } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import {
  localCollinearComponents,
  localCollinearResidual,
  pointLineSignedDistance,
  resolveLocalLineOperand,
  resolveReadOnlyLineOperand,
} from "./line-residuals";
import { midpoint } from "./parameter-projection";
import {
  findProjectedGeometry,
  resolveSketchDatumLine,
  resolveSketchDatumPoint,
  unitVector,
} from "./projected-geometry";
import {
  addPointGradient,
  getPoint,
  halfSquaredDistanceWithSaturation,
  length,
  subtract,
  zeroVector,
} from "./solver-geometry";

export function buildCoincidentProjectedPointConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (constraint.kind === "coincidentProjectedPoint") {
    const point = pointRecords.get(constraint.point.pointId);
    const targetPoint =
      constraint.projectedPoint.kind === "projectedGeometry"
        ? (() => {
            const projected = findProjectedGeometry(
              options.projectedReferences ?? [],
              constraint.projectedPoint.reference,
            );
            return projected?.kind === "point" ? projected.position : null;
          })()
        : resolveSketchDatumPoint(constraint.projectedPoint.datum);

    if (!point || !targetPoint) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: pIdx(point),
        evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
          dual2.sub(pointDual(columns, point), columns.constant2(targetPoint)),
        ),
        evaluateComponents(values) {
          return subtract(getPoint(values, point), targetPoint);
        },
        evaluateResidual(values) {
          return length(subtract(getPoint(values, point), targetPoint));
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildPointOnProjectedCurveConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    pointOnProjectedCurveResidual,
    projectedCurveComponents,
    pIdx,
    componentJacobian,
    pointDual,
    infiniteDuals,
    projectedCurveComponentsDual,
  } = context;
  if (constraint.kind === "pointOnProjectedCurve") {
    const point = pointRecords.get(constraint.point.pointId);
    const projected =
      constraint.projectedCurve.kind === "projectedGeometry"
        ? findProjectedGeometry(
            options.projectedReferences ?? [],
            constraint.projectedCurve.reference,
          )
        : null;
    const datumLine =
      constraint.projectedCurve.kind === "sketchDatum"
        ? resolveSketchDatumLine(constraint.projectedCurve.datum)
        : null;

    if (
      !point ||
      (!projected && !datumLine) ||
      projected?.kind === "point" ||
      (projected?.kind === "spline" &&
        projected.representation.kind === "sourceSamples")
    ) {
      return true;
    }

    if (
      projected?.kind === "spline" &&
      projected.representation.kind === "neutralCubicSpans"
    ) {
      const projectedSpans = projected.representation.spans;
      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian(values) {
          const columns = dualColumns(values, pIdx(point));
          const position = getPoint(values, point);
          const closest = closestSplineSpanLocation(position, projectedSpans);
          if (!closest)
            return columns.jacobian(infiniteDuals(columns, 2), parameterCount);
          const evaluated = evaluateSplineSpan(
            projectedSpans[closest.spanIndex]!,
            { kind: "local", value: closest.u },
          );
          return columns.jacobian(
            closestPointResidualDuals({
              residual: subtract(position, evaluated.position),
              atDomainEnd: closest.u === 0 || closest.u === 1,
              first: evaluated.first,
              second: evaluated.second,
              columns: 2,
              dPoint: (column) => (column === 0 ? [1, 0] : [0, 1]),
              dCurve: () => [0, 0],
              dFirst: () => [0, 0],
            }),
            parameterCount,
          );
        },
        evaluateComponents(values) {
          const position = getPoint(values, point);
          const closest = closestSplineSpanLocation(position, projectedSpans);
          if (!closest) return [Infinity, Infinity];
          const evaluated = evaluateSplineSpan(
            projectedSpans[closest.spanIndex]!,
            { kind: "local", value: closest.u },
          );
          return subtract(position, evaluated.position);
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const position = getPoint(values, point);
          const closest = closestSplineSpanLocation(position, projectedSpans);
          if (!closest) return { residual: Number.POSITIVE_INFINITY, gradient };
          const evaluated = evaluateSplineSpan(
            projectedSpans[closest.spanIndex]!,
            { kind: "local", value: closest.u },
          );
          const delta = subtract(position, evaluated.position);
          addPointGradient(gradient, point, delta[0], delta[1]);
          return {
            residual: halfSquaredDistanceWithSaturation(
              closest.distanceSquared,
            ),
            gradient,
          };
        },
      });
    } else {
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(point),
          evaluateComponentJacobian: componentJacobian(
            pIdx(point),
            (columns) =>
              projected
                ? projectedCurveComponentsDual(
                    pointDual(columns, point),
                    projected,
                  )
                : [
                    pointLineSignedDistanceDual(
                      pointDual(columns, point),
                      columns.constant2(datumLine!.start),
                      columns.constant2(datumLine!.end),
                    ),
                  ],
          ),
          evaluateComponents(values) {
            return projected
              ? projectedCurveComponents(getPoint(values, point), projected)
              : [
                  pointLineSignedDistance(
                    getPoint(values, point),
                    datumLine!.start,
                    datumLine!.end,
                  ),
                ];
          },
          evaluateResidual(values) {
            return projected
              ? pointOnProjectedCurveResidual(
                  getPoint(values, point),
                  projected,
                )
              : Math.abs(
                  pointLineSignedDistance(
                    getPoint(values, point),
                    datumLine!.start,
                    datumLine!.end,
                  ),
                );
          },
        }),
      );
    }
    return true;
  }
  return false;
}

export function buildMidpointConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
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
  if (constraint.kind === "midpoint") {
    const point = pointRecords.get(constraint.point.pointId);
    const line = lineEntityMap.get(constraint.line.entityId);
    const start = line ? pointRecords.get(line.startPointId) : null;
    const end = line ? pointRecords.get(line.endPointId) : null;

    if (!point || !line || !start || !end) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: pIdx(point, start, end),
        evaluateComponentJacobian: componentJacobian(
          pIdx(point, start, end),
          (columns) =>
            dual2.sub(
              pointDual(columns, point),
              midpointDual(pointDual(columns, start), pointDual(columns, end)),
            ),
        ),
        evaluateComponents(values) {
          return subtract(
            getPoint(values, point),
            midpoint(getPoint(values, start), getPoint(values, end)),
          );
        },
        evaluateResidual(values) {
          const target = midpoint(
            getPoint(values, start),
            getPoint(values, end),
          );
          return length(subtract(getPoint(values, point), target));
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildMidpointProjectedLineConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (constraint.kind === "midpointProjectedLine") {
    const point = pointRecords.get(constraint.point.pointId);
    const projectedLine =
      constraint.projectedLine.kind === "projectedGeometry"
        ? (() => {
            const projected = findProjectedGeometry(
              options.projectedReferences ?? [],
              constraint.projectedLine.reference,
            );
            return projected?.kind === "lineSegment"
              ? { start: projected.startPosition, end: projected.endPosition }
              : null;
          })()
        : resolveSketchDatumLine(constraint.projectedLine.datum);

    if (!point || !projectedLine) {
      return true;
    }

    const target = midpoint(projectedLine.start, projectedLine.end);
    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: pIdx(point),
        evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
          dual2.sub(pointDual(columns, point), columns.constant2(target)),
        ),
        evaluateComponents(values) {
          return subtract(getPoint(values, point), target);
        },
        evaluateResidual(values) {
          return length(subtract(getPoint(values, point), target));
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildPointOnCurveConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    definition,
    pointRecords,
    scalarConstraints,
    parameterCount,
    createSplinePointConstraint,
    createShellPointConstraint,
    pointOnLocalCurveResidual,
    localCurveComponents,
    pIdx,
    entityIdx,
    componentJacobian,
    localCurveComponentsDual,
  } = context;
  if (constraint.kind === "pointOnCurve") {
    const point = pointRecords.get(constraint.point.pointId);
    const curve = definition.entities.find(
      (entity) => entity.entityId === constraint.curve.entityId,
    );

    if (point && curve?.kind === "derivedPiecewiseCubic") {
      scalarConstraints.push(
        createShellPointConstraint(constraint, point, curve),
      );
      return true;
    }

    if (
      !point ||
      !curve ||
      (curve.kind !== "lineSegment" &&
        curve.kind !== "circle" &&
        curve.kind !== "arc" &&
        curve.kind !== "spline")
    ) {
      return true;
    }

    scalarConstraints.push(
      curve.kind === "spline"
        ? createSplinePointConstraint(constraint, point, curve)
        : createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: [
              ...pIdx(point),
              ...entityIdx(curve.entityId),
            ],
            evaluateComponentJacobian: componentJacobian(
              [...pIdx(point), ...entityIdx(curve.entityId)],
              (columns) => localCurveComponentsDual(columns, point, curve),
            ),
            evaluateComponents(values) {
              return localCurveComponents(values, point, curve);
            },
            evaluateResidual(values) {
              return pointOnLocalCurveResidual(values, point, curve);
            },
          }),
    );
    return true;
  }
  return false;
}

export function buildCollinearConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    lineIdx,
    collinearTargetIdx,
    componentJacobian,
    infiniteDuals,
    localLineDual,
    localCollinearComponentsDual,
  } = context;
  if (constraint.kind === "collinear") {
    if (
      (constraint.target.kind === "localEntity" &&
        !lineEntityMap.has(constraint.target.entityId)) ||
      (constraint.target.kind === "localPoint" &&
        !pointRecords.has(constraint.target.pointId))
    ) {
      return true;
    }
    const referenceLine = lineEntityMap.get(constraint.line.entityId);
    if (!referenceLine) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: [
          ...lineIdx(constraint.line.entityId),
          ...collinearTargetIdx(constraint.target),
        ],
        evaluateComponentJacobian: componentJacobian(
          [
            ...lineIdx(constraint.line.entityId),
            ...collinearTargetIdx(constraint.target),
          ],
          (columns) => {
            const line = localLineDual(columns, constraint.line.entityId);
            return line
              ? localCollinearComponentsDual(columns, constraint.target, line)
              : infiniteDuals(columns, 2);
          },
        ),
        evaluateComponents(values) {
          const line = resolveLocalLineOperand(
            values,
            constraint.line,
            lineEntityMap,
            pointRecords,
          );
          return line
            ? localCollinearComponents(
                values,
                constraint.target,
                line,
                lineEntityMap,
                pointRecords,
              )
            : [Infinity, Infinity];
        },
        evaluateResidual(values) {
          const line = resolveLocalLineOperand(
            values,
            constraint.line,
            lineEntityMap,
            pointRecords,
          );
          if (!line || !unitVector(line.start, line.end)) {
            return Number.POSITIVE_INFINITY;
          }

          return localCollinearResidual(
            values,
            constraint.target,
            line,
            lineEntityMap,
            pointRecords,
          );
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildCollinearProjectedLineConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    collinearTargetIdx,
    componentJacobian,
    constantLineDual,
    localCollinearComponentsDual,
  } = context;
  if (constraint.kind === "collinearProjectedLine") {
    if (
      (constraint.target.kind === "localEntity" &&
        !lineEntityMap.has(constraint.target.entityId)) ||
      (constraint.target.kind === "localPoint" &&
        !pointRecords.has(constraint.target.pointId))
    ) {
      return true;
    }
    const projectedLine = resolveReadOnlyLineOperand(
      constraint.projectedLine,
      options.projectedReferences ?? [],
    );
    if (!projectedLine) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: collinearTargetIdx(constraint.target),
        evaluateComponentJacobian: componentJacobian(
          collinearTargetIdx(constraint.target),
          (columns) =>
            localCollinearComponentsDual(
              columns,
              constraint.target,
              constantLineDual(columns, projectedLine),
            ),
        ),
        evaluateComponents(values) {
          return localCollinearComponents(
            values,
            constraint.target,
            projectedLine,
            lineEntityMap,
            pointRecords,
          );
        },
        evaluateResidual(values) {
          if (!unitVector(projectedLine.start, projectedLine.end)) {
            return Number.POSITIVE_INFINITY;
          }

          return localCollinearResidual(
            values,
            constraint.target,
            projectedLine,
            lineEntityMap,
            pointRecords,
          );
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildParallelProjectedLineConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (
    constraint.kind === "parallelProjectedLine" ||
    constraint.kind === "perpendicularProjectedLine"
  ) {
    const line = lineEntityMap.get(constraint.line.entityId);
    const projectedLine =
      constraint.projectedLine.kind === "projectedGeometry"
        ? (() => {
            const projected = findProjectedGeometry(
              options.projectedReferences ?? [],
              constraint.projectedLine.reference,
            );
            return projected?.kind === "lineSegment"
              ? { start: projected.startPosition, end: projected.endPosition }
              : null;
          })()
        : resolveSketchDatumLine(constraint.projectedLine.datum);
    if (!line || !projectedLine) {
      return true;
    }

    const start = pointRecords.get(line.startPointId);
    const end = pointRecords.get(line.endPointId);
    const projectedUnit = unitVector(projectedLine.start, projectedLine.end);
    if (!start || !end || !projectedUnit) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: pIdx(start, end),
        evaluateComponentJacobian: componentJacobian(
          pIdx(start, end),
          (columns) => {
            const localUnit = unitVectorDual(
              pointDual(columns, start),
              pointDual(columns, end),
            );
            if (!localUnit) return [columns.constant(0)];
            const projected = columns.constant2(projectedUnit);
            return [
              constraint.kind === "parallelProjectedLine"
                ? dual2.cross(localUnit, projected)
                : dual2.dot(localUnit, projected),
            ];
          },
        ),
        evaluateResidual(values) {
          const startPoint = getPoint(values, start);
          const endPoint = getPoint(values, end);
          const localUnit = unitVector(startPoint, endPoint);

          if (!localUnit) {
            return 0;
          }

          return constraint.kind === "parallelProjectedLine"
            ? localUnit[0] * projectedUnit[1] - localUnit[1] * projectedUnit[0]
            : localUnit[0] * projectedUnit[0] + localUnit[1] * projectedUnit[1];
        },
      }),
    );
    return true;
  }
  return false;
}
