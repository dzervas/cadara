import type { ConstraintDefinition } from "@/contracts/sketch/schema";
import { createNumericalScalarConstraint } from "./analytic-residuals";
import { dual2 } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import {
  findProjectedGeometry,
  projectedCircleLikeGeometry,
  resolveSketchDatumLine,
} from "./projected-geometry";
import { getPoint, length, subtract } from "./solver-geometry";

export function buildConcentricConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    definition,
    scalarConstraints,
    parameterCount,
    getLocalCircleLike,
    entityIdx,
    componentJacobian,
    infiniteDuals,
    localCircleLikeDual,
  } = context;
  if (constraint.kind === "concentric") {
    const first = definition.entities.find(
      (entity) => entity.entityId === constraint.entityIds[0],
    );
    const second = definition.entities.find(
      (entity) => entity.entityId === constraint.entityIds[1],
    );
    if (
      !first ||
      !second ||
      (first.kind !== "circle" && first.kind !== "arc") ||
      (second.kind !== "circle" && second.kind !== "arc")
    ) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: [
          ...entityIdx(first.entityId),
          ...entityIdx(second.entityId),
        ],
        evaluateComponentJacobian: componentJacobian(
          [...entityIdx(first.entityId), ...entityIdx(second.entityId)],
          (columns) => {
            const a = localCircleLikeDual(columns, first),
              b = localCircleLikeDual(columns, second);
            return a && b
              ? dual2.sub(a.center, b.center)
              : infiniteDuals(columns, 2);
          },
        ),
        evaluateComponents(values) {
          const a = getLocalCircleLike(values, first),
            b = getLocalCircleLike(values, second);
          return a && b ? subtract(a.center, b.center) : [Infinity, Infinity];
        },
        evaluateResidual(values) {
          const firstCircle = getLocalCircleLike(values, first);
          const secondCircle = getLocalCircleLike(values, second);
          return firstCircle && secondCircle
            ? length(subtract(firstCircle.center, secondCircle.center))
            : 0;
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildConcentricProjectedCurveConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    definition,
    options,
    scalarConstraints,
    parameterCount,
    getLocalCircleLike,
    entityIdx,
    componentJacobian,
    infiniteDuals,
    localCircleLikeDual,
  } = context;
  if (constraint.kind === "concentricProjectedCurve") {
    const entity = definition.entities.find(
      (candidate) => candidate.entityId === constraint.curve.entityId,
    );
    const projected = findProjectedGeometry(
      options.projectedReferences ?? [],
      constraint.projectedCurve.reference,
    );
    const projectedCircle = projected
      ? projectedCircleLikeGeometry(projected)
      : null;
    if (
      !entity ||
      !projectedCircle ||
      (entity.kind !== "circle" && entity.kind !== "arc")
    ) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: entityIdx(entity.entityId),
        evaluateComponentJacobian: componentJacobian(
          entityIdx(entity.entityId),
          (columns) => {
            const circle = localCircleLikeDual(columns, entity);
            return circle
              ? dual2.sub(
                  circle.center,
                  columns.constant2(projectedCircle.center),
                )
              : infiniteDuals(columns, 2);
          },
        ),
        evaluateComponents(values) {
          const circle = getLocalCircleLike(values, entity);
          return circle
            ? subtract(circle.center, projectedCircle.center)
            : [Infinity, Infinity];
        },
        evaluateResidual(values) {
          const localCircle = getLocalCircleLike(values, entity);
          return localCircle
            ? length(subtract(localCircle.center, projectedCircle.center))
            : 0;
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildNormalConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    definition,
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    getLocalCircleLike,
    pointOnLocalCurveResidual,
    localCurveComponents,
    normalResidual,
    lineContactResidual,
    pIdx,
    lineIdx,
    entityIdx,
    componentJacobian,
    pointDual,
    infiniteDuals,
    localCircleLikeDual,
    localCurveComponentsDual,
    normalResidualDual,
    lineContactResidualDual,
  } = context;
  if (constraint.kind === "normal") {
    const line = lineEntityMap.get(constraint.line.entityId);
    const curve = definition.entities.find(
      (candidate) => candidate.entityId === constraint.curve.entityId,
    );
    const point = pointRecords.get(constraint.point.pointId);
    if (
      !line ||
      !curve ||
      !point ||
      (curve.kind !== "circle" && curve.kind !== "arc")
    ) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: [
          ...pIdx(point),
          ...lineIdx(line.entityId),
          ...entityIdx(curve.entityId),
        ],
        evaluateComponentJacobian: componentJacobian(
          [
            ...pIdx(point),
            ...lineIdx(line.entityId),
            ...entityIdx(curve.entityId),
          ],
          (columns) => {
            const circle = localCircleLikeDual(columns, curve);
            const contact = pointDual(columns, point);
            return circle
              ? [
                  ...localCurveComponentsDual(columns, point, curve),
                  normalResidualDual(columns, line, contact, circle.center),
                  lineContactResidualDual(columns, line, contact),
                ]
              : infiniteDuals(columns, 1);
          },
        ),
        evaluateComponents(values) {
          const circle = getLocalCircleLike(values, curve);
          const contact = getPoint(values, point);
          return circle
            ? [
                ...localCurveComponents(values, point, curve),
                normalResidual(values, line, contact, circle.center),
                lineContactResidual(values, line, contact),
              ]
            : [Infinity];
        },
        evaluateResidual(values) {
          const circleLike = getLocalCircleLike(values, curve);
          if (!circleLike) {
            return 0;
          }

          const contactPoint = getPoint(values, point);
          const curveResidual = pointOnLocalCurveResidual(values, point, curve);
          const directionResidual = normalResidual(
            values,
            line,
            contactPoint,
            circleLike.center,
          );
          const contactResidual = lineContactResidual(
            values,
            line,
            contactPoint,
          );
          return Math.sqrt(
            curveResidual * curveResidual +
              directionResidual * directionResidual +
              contactResidual * contactResidual,
          );
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildNormalProjectedCurveConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    pointOnProjectedCurveResidual,
    projectedCurveComponents,
    normalResidual,
    lineContactResidual,
    pIdx,
    lineIdx,
    componentJacobian,
    pointDual,
    projectedCurveComponentsDual,
    normalResidualDual,
    lineContactResidualDual,
  } = context;
  if (constraint.kind === "normalProjectedCurve") {
    const line = lineEntityMap.get(constraint.line.entityId);
    const projected = findProjectedGeometry(
      options.projectedReferences ?? [],
      constraint.projectedCurve.reference,
    );
    const projectedCircle = projected
      ? projectedCircleLikeGeometry(projected)
      : null;
    const point = pointRecords.get(constraint.point.pointId);
    if (!line || !projected || !projectedCircle || !point) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: [...pIdx(point), ...lineIdx(line.entityId)],
        evaluateComponentJacobian: componentJacobian(
          [...pIdx(point), ...lineIdx(line.entityId)],
          (columns) => {
            const contact = pointDual(columns, point);
            return [
              ...projectedCurveComponentsDual(contact, projected),
              normalResidualDual(
                columns,
                line,
                contact,
                columns.constant2(projectedCircle.center),
              ),
              lineContactResidualDual(columns, line, contact),
            ];
          },
        ),
        evaluateComponents(values) {
          const contact = getPoint(values, point);
          return [
            ...projectedCurveComponents(contact, projected),
            normalResidual(values, line, contact, projectedCircle.center),
            lineContactResidual(values, line, contact),
          ];
        },
        evaluateResidual(values) {
          const contactPoint = getPoint(values, point);
          const curveResidual = pointOnProjectedCurveResidual(
            contactPoint,
            projected,
          );
          const directionResidual = normalResidual(
            values,
            line,
            contactPoint,
            projectedCircle.center,
          );
          const contactResidual = lineContactResidual(
            values,
            line,
            contactPoint,
          );
          return Math.sqrt(
            curveResidual * curveResidual +
              directionResidual * directionResidual +
              contactResidual * contactResidual,
          );
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildSymmetricConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    symmetryComponents,
    symmetricResidual,
    pIdx,
    componentJacobian,
    pointDual,
    symmetryComponentsDual,
  } = context;
  if (constraint.kind === "symmetric") {
    const first = pointRecords.get(constraint.pointIds[0]);
    const second = pointRecords.get(constraint.pointIds[1]);
    const axis = lineEntityMap.get(constraint.axis.entityId);
    const axisStart = axis ? pointRecords.get(axis.startPointId) : null;
    const axisEnd = axis ? pointRecords.get(axis.endPointId) : null;
    if (!first || !second || !axis || !axisStart || !axisEnd) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: pIdx(first, second, axisStart, axisEnd),
        evaluateComponentJacobian: componentJacobian(
          pIdx(first, second, axisStart, axisEnd),
          (columns) =>
            symmetryComponentsDual(
              pointDual(columns, first),
              pointDual(columns, second),
              pointDual(columns, axisStart),
              pointDual(columns, axisEnd),
            ),
        ),
        evaluateComponents(values) {
          return symmetryComponents(
            getPoint(values, first),
            getPoint(values, second),
            getPoint(values, axisStart),
            getPoint(values, axisEnd),
          );
        },
        evaluateResidual(values) {
          return symmetricResidual(
            getPoint(values, first),
            getPoint(values, second),
            getPoint(values, axisStart),
            getPoint(values, axisEnd),
          );
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildSymmetricProjectedLineConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    options,
    pointRecords,
    scalarConstraints,
    parameterCount,
    symmetryComponents,
    symmetricResidual,
    pIdx,
    componentJacobian,
    pointDual,
    symmetryComponentsDual,
  } = context;
  if (constraint.kind === "symmetricProjectedLine") {
    const first = pointRecords.get(constraint.pointIds[0]);
    const second = pointRecords.get(constraint.pointIds[1]);
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
    if (!first || !second || !projectedLine) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: constraint.constraintId,
        targetKind: "constraint",
        parameterCount,
        affectedVariableIndices: pIdx(first, second),
        evaluateComponentJacobian: componentJacobian(
          pIdx(first, second),
          (columns) =>
            symmetryComponentsDual(
              pointDual(columns, first),
              pointDual(columns, second),
              columns.constant2(projectedLine.start),
              columns.constant2(projectedLine.end),
            ),
        ),
        evaluateComponents(values) {
          return symmetryComponents(
            getPoint(values, first),
            getPoint(values, second),
            projectedLine.start,
            projectedLine.end,
          );
        },
        evaluateResidual(values) {
          return symmetricResidual(
            getPoint(values, first),
            getPoint(values, second),
            projectedLine.start,
            projectedLine.end,
          );
        },
      }),
    );
    return true;
  }
  return false;
}
