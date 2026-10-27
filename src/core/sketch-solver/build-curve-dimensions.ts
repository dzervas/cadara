import type { NumericDimensionDefinition as DimensionDefinition } from "@/contracts/sketch/schema";
import { createNumericalScalarConstraint } from "./analytic-residuals";
import { dual, dual2 } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import {
  add,
  addPointGradient,
  getArcParameters,
  getCircleRadius,
  getPoint,
  subtract,
  zeroVector,
} from "./solver-geometry";

export function buildCircleRadiusDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    definition,
    entityStates,
    scalarConstraints,
    parameterCount,
    eIdx,
    componentJacobian,
  } = context;
  if (dimension.kind === "circleRadius") {
    const entity = definition.entities.find(
      (candidate) => candidate.entityId === dimension.entityId,
    );
    if (!entity || entity.kind !== "circle") {
      return true;
    }

    scalarConstraints.push({
      id: dimension.dimensionId,
      targetKind: "dimension",
      evaluateComponentJacobian: componentJacobian(
        eIdx(entity.entityId),
        (columns) => {
          const state = entityStates.get(entity.entityId);
          return [
            dual.sub(
              state?.kind === "circle"
                ? columns.variable(state.baseIndex)
                : columns.constant(entity.radius),
              columns.constant(drivingValue),
            ),
          ];
        },
      ),
      evaluateComponents(values) {
        const state = entityStates.get(entity.entityId);
        return [
          (state?.kind === "circle"
            ? getCircleRadius(values, state)
            : entity.radius) - drivingValue,
        ];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const circleState = entityStates.get(entity.entityId);
        if (!circleState || circleState.kind !== "circle") {
          const err = entity.radius - drivingValue;
          return { residual: 0.5 * err * err, gradient };
        }

        const err = getCircleRadius(values, circleState) - drivingValue;
        gradient[circleState.baseIndex] = err;
        return { residual: 0.5 * err * err, gradient };
      },
    });
    return true;
  }
  return false;
}

export function buildDiameterDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
  drivingValue: number,
): boolean {
  const {
    definition,
    scalarConstraints,
    parameterCount,
    getLocalCircleLike,
    entityIdx,
    componentJacobian,
    localCircleLikeDual,
  } = context;
  if (dimension.kind === "diameter") {
    const entity = definition.entities.find(
      (candidate) => candidate.entityId === dimension.entityId,
    );
    if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
      return true;
    }

    scalarConstraints.push(
      createNumericalScalarConstraint({
        id: dimension.dimensionId,
        targetKind: "dimension",
        parameterCount,
        affectedVariableIndices: entityIdx(entity.entityId),
        evaluateComponentJacobian: componentJacobian(
          entityIdx(entity.entityId),
          (columns) => {
            const circleLike = localCircleLikeDual(columns, entity);
            return [
              circleLike
                ? dual.sub(
                    dual.scale(circleLike.radius, 2),
                    columns.constant(drivingValue),
                  )
                : columns.constant(drivingValue),
            ];
          },
        ),
        evaluateResidual(values) {
          const circleLike = getLocalCircleLike(values, entity);
          return circleLike
            ? circleLike.radius * 2 - drivingValue
            : drivingValue;
        },
      }),
    );
    return true;
  }
  return false;
}

export function buildArcStartPointCoincidentDimension(
  context: BuildContext,
  dimension: DimensionDefinition,
): boolean {
  const {
    pointRecords,
    entityStates,
    scalarConstraints,
    parameterCount,
    arcEntityMap,
    pIdx,
    eIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (
    dimension.kind === "arcStartPointCoincident" ||
    dimension.kind === "arcEndPointCoincident"
  ) {
    const arc = arcEntityMap.get(dimension.entityId);
    const arcState = entityStates.get(dimension.entityId);
    const point = pointRecords.get(dimension.pointId);
    const center = arc ? pointRecords.get(arc.centerPointId) : null;
    if (!arc || !arcState || arcState.kind !== "arc" || !point || !center) {
      return true;
    }

    scalarConstraints.push({
      id: dimension.dimensionId,
      targetKind: "dimension",
      evaluateComponentJacobian: componentJacobian(
        [...pIdx(center, point), ...eIdx(arc.entityId)],
        (columns) => {
          const radius = columns.variable(arcState.baseIndex);
          const angle = columns.variable(
            arcState.baseIndex +
              (dimension.kind === "arcStartPointCoincident" ? 1 : 2),
          );
          const centerDual = pointDual(columns, center);
          return dual2.sub(
            [
              dual.add(centerDual[0], dual.mul(radius, dual.cos(angle))),
              dual.add(centerDual[1], dual.mul(radius, dual.sin(angle))),
            ],
            pointDual(columns, point),
          );
        },
      ),
      evaluateComponents(values) {
        const { radius, startAngle, endAngle } = getArcParameters(
          values,
          arcState,
        );
        const angle =
          dimension.kind === "arcStartPointCoincident" ? startAngle : endAngle;
        return subtract(
          add(getPoint(values, center), [
            radius * Math.cos(angle),
            radius * Math.sin(angle),
          ]),
          getPoint(values, point),
        );
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const centerPos = getPoint(values, center);
        const pointPos = getPoint(values, point);
        const { radius, startAngle, endAngle } = getArcParameters(
          values,
          arcState,
        );
        const angle =
          dimension.kind === "arcStartPointCoincident" ? startAngle : endAngle;
        const arcPoint = add(centerPos, [
          radius * Math.cos(angle),
          radius * Math.sin(angle),
        ]);
        const delta = subtract(arcPoint, pointPos);
        const gx = delta[0];
        const gy = delta[1];
        addPointGradient(gradient, center, gx, gy);
        addPointGradient(gradient, point, -gx, -gy);
        gradient[arcState.baseIndex] +=
          gx * Math.cos(angle) + gy * Math.sin(angle);
        const angleGradient =
          gx * (-radius * Math.sin(angle)) + gy * (radius * Math.cos(angle));
        gradient[
          arcState.baseIndex +
            (dimension.kind === "arcStartPointCoincident" ? 1 : 2)
        ] += angleGradient;
        return {
          residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
          gradient,
        };
      },
    });
  }
  return false;
}
