import type {
  ConstraintDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import {
  arcSweepViolationDual,
  createNumericalScalarConstraint,
  pointLineSignedDistanceDual,
  projectedArcDataDual,
  unitVectorDual,
} from "./analytic-residuals";
import type { Dual, Dual2, DualColumns } from "./automatic-differentiation";
import { dual, dual2 } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import { pointLineSignedDistance } from "./line-residuals";
import {
  findProjectedGeometry,
  projectedArcSweepViolation,
  projectedCircleLikeGeometry,
  unitVector,
} from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import {
  getArcParameters,
  getPoint,
  length,
  subtract,
} from "./solver-geometry";

export function buildTangentProjectedCurveConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    definition,
    options,
    pointRecords,
    entityStates,
    scalarConstraints,
    parameterCount,
    getLocalCircleLike,
    pIdx,
    eIdx,
    entityIdx,
    componentJacobian,
    pointDual,
    localCircleLikeDual,
    addArcSweepInequalities,
  } = context;
  if (constraint.kind === "tangentProjectedCurve") {
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
    if (!entity || !projectedCircle) {
      return true;
    }

    const createTangentResidual = (
      tangentResidual: number,
      projectedContactPoint: SketchPoint2D,
    ) => {
      if (projected?.kind !== "arc") {
        return tangentResidual;
      }

      const arcViolation = projectedArcSweepViolation(
        projectedContactPoint,
        projected,
      );
      return Math.sqrt(
        tangentResidual * tangentResidual + arcViolation * arcViolation,
      );
    };

    const projectedTangentComponents = (
      residual: number,
      contact: SketchPoint2D,
    ) => [
      residual,
      ...(projected?.kind === "arc"
        ? [projectedArcSweepViolation(contact, projected)]
        : []),
    ];
    const projectedTangentComponentsDual = (residual: Dual, contact: Dual2) => [
      residual,
      ...(projected?.kind === "arc"
        ? [
            arcSweepViolationDual(
              contact,
              projectedArcDataDual(residual, projected),
            ),
          ]
        : []),
    ];
    const projectedTangentHinge =
      projected?.kind === "arc" ? { hingeComponentIndices: [1] } : {};
    const projectedArcSweepInequalities = (
      support: readonly number[],
      tangency: (columns: DualColumns) => { contact: Dual2 } | null,
    ) => {
      if (projected?.kind === "arc")
        addArcSweepInequalities(
          constraint.constraintId,
          1,
          null,
          support,
          (columns) => {
            const contact = tangency(columns)?.contact;
            return contact
              ? { contact, arc: projectedArcDataDual(contact[0], projected) }
              : null;
          },
        );
    };
    // The circle and arc rows below: a local circle-like tangent to the
    // projected circle.
    const circleTangencyDual = (
      columns: DualColumns,
      localCenter: Dual2,
      radius: Dual,
    ) => {
      const projectedCenter = columns.constant2(projectedCircle.center);
      const projectedRadius = columns.constant(projectedCircle.radius);
      const centerOffset = dual2.sub(localCenter, projectedCenter);
      const centerDistance = dual2.length(centerOffset);
      const direction: Dual2 =
        centerDistance.value > DEGENERATE_NORM_EPSILON
          ? [
              dual.div(centerOffset[0], centerDistance),
              dual.div(centerOffset[1], centerDistance),
            ]
          : [columns.constant(1), columns.constant(0)];
      const targetDistance =
        constraint.relation === "external"
          ? dual.add(radius, projectedRadius)
          : dual.abs(dual.sub(radius, projectedRadius));
      const contactDirection: Dual2 =
        constraint.relation === "external"
          ? direction
          : [dual.neg(direction[0]), dual.neg(direction[1])];
      return {
        residual: dual.sub(centerDistance, targetDistance),
        contact: [
          dual.add(
            projectedCenter[0],
            dual.mul(contactDirection[0], projectedRadius),
          ),
          dual.add(
            projectedCenter[1],
            dual.mul(contactDirection[1], projectedRadius),
          ),
        ] as Dual2,
      };
    };

    if (entity.kind === "lineSegment") {
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (!start || !end) {
        return true;
      }
      const lineTangencyDual = (columns: DualColumns) => {
        const startPoint = pointDual(columns, start);
        const endPoint = pointDual(columns, end);
        const unit = unitVectorDual(startPoint, endPoint);
        if (!unit) return null;
        const center = columns.constant2(projectedCircle.center);
        const signedDistance = pointLineSignedDistanceDual(
          center,
          startPoint,
          endPoint,
        );
        return {
          residual: dual.sub(
            dual.abs(signedDistance),
            columns.constant(projectedCircle.radius),
          ),
          contact: [
            dual.sub(center[0], dual.mul(signedDistance, unit[1])),
            dual.sub(center[1], dual.mul(signedDistance, dual.neg(unit[0]))),
          ] as Dual2,
        };
      };
      projectedArcSweepInequalities(pIdx(start, end), lineTangencyDual);

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(start, end),
          evaluateComponentJacobian: componentJacobian(
            pIdx(start, end),
            (columns) => {
              const tangency = lineTangencyDual(columns);
              return tangency
                ? projectedTangentComponentsDual(
                    tangency.residual,
                    tangency.contact,
                  )
                : [columns.constant(0)];
            },
          ),
          ...projectedTangentHinge,
          evaluateComponents(values) {
            const startPoint = getPoint(values, start);
            const endPoint = getPoint(values, end);
            const unit = unitVector(startPoint, endPoint);
            if (!unit) {
              return [0];
            }

            const signedDistance = pointLineSignedDistance(
              projectedCircle.center,
              startPoint,
              endPoint,
            );
            const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] - signedDistance * lineNormal[0],
              projectedCircle.center[1] - signedDistance * lineNormal[1],
            ];
            return projectedTangentComponents(
              Math.abs(signedDistance) - projectedCircle.radius,
              contactPoint,
            );
          },
          evaluateResidual(values) {
            const startPoint = getPoint(values, start);
            const endPoint = getPoint(values, end);
            const unit = unitVector(startPoint, endPoint);
            if (!unit) {
              return 0;
            }

            const signedDistance = pointLineSignedDistance(
              projectedCircle.center,
              startPoint,
              endPoint,
            );
            const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] - signedDistance * lineNormal[0],
              projectedCircle.center[1] - signedDistance * lineNormal[1],
            ];
            return createTangentResidual(
              Math.abs(signedDistance) - projectedCircle.radius,
              contactPoint,
            );
          },
        }),
      );
      return true;
    }

    if (entity.kind === "circle") {
      const localCircleTangencyDual = (columns: DualColumns) => {
        const localCircle = localCircleLikeDual(columns, entity);
        return localCircle
          ? circleTangencyDual(columns, localCircle.center, localCircle.radius)
          : null;
      };
      projectedArcSweepInequalities(
        entityIdx(entity.entityId),
        localCircleTangencyDual,
      );
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: entityIdx(entity.entityId),
          evaluateComponentJacobian: componentJacobian(
            entityIdx(entity.entityId),
            (columns) => {
              const tangency = localCircleTangencyDual(columns);
              return tangency
                ? projectedTangentComponentsDual(
                    tangency.residual,
                    tangency.contact,
                  )
                : [columns.constant(0)];
            },
          ),
          ...projectedTangentHinge,
          evaluateComponents(values) {
            const localCircle = getLocalCircleLike(values, entity);
            if (!localCircle) {
              return [0];
            }

            const localCenter = localCircle.center;
            const centerOffset = subtract(localCenter, projectedCircle.center);
            const centerDistance = length(centerOffset);
            const direction: SketchPoint2D =
              centerDistance > DEGENERATE_NORM_EPSILON
                ? [
                    centerOffset[0] / centerDistance,
                    centerOffset[1] / centerDistance,
                  ]
                : [1, 0];
            const targetDistance =
              constraint.relation === "external"
                ? localCircle.radius + projectedCircle.radius
                : Math.abs(localCircle.radius - projectedCircle.radius);
            const contactDirection =
              constraint.relation === "external"
                ? direction
                : ([-direction[0], -direction[1]] as const);
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] +
                contactDirection[0] * projectedCircle.radius,
              projectedCircle.center[1] +
                contactDirection[1] * projectedCircle.radius,
            ];
            return projectedTangentComponents(
              centerDistance - targetDistance,
              contactPoint,
            );
          },
          evaluateResidual(values) {
            const localCircle = getLocalCircleLike(values, entity);
            if (!localCircle) {
              return 0;
            }

            const localCenter = localCircle.center;
            const centerOffset = subtract(localCenter, projectedCircle.center);
            const centerDistance = length(centerOffset);
            const direction: SketchPoint2D =
              centerDistance > DEGENERATE_NORM_EPSILON
                ? [
                    centerOffset[0] / centerDistance,
                    centerOffset[1] / centerDistance,
                  ]
                : [1, 0];
            const targetDistance =
              constraint.relation === "external"
                ? localCircle.radius + projectedCircle.radius
                : Math.abs(localCircle.radius - projectedCircle.radius);
            const contactDirection =
              constraint.relation === "external"
                ? direction
                : ([-direction[0], -direction[1]] as const);
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] +
                contactDirection[0] * projectedCircle.radius,
              projectedCircle.center[1] +
                contactDirection[1] * projectedCircle.radius,
            ];
            return createTangentResidual(
              centerDistance - targetDistance,
              contactPoint,
            );
          },
        }),
      );
      return true;
    }

    if (entity.kind === "arc") {
      const center = pointRecords.get(entity.centerPointId);
      const arcState = entityStates.get(entity.entityId);
      if (!center || !arcState || arcState.kind !== "arc") {
        return true;
      }
      const arcTangencyDual = (columns: DualColumns) =>
        circleTangencyDual(
          columns,
          pointDual(columns, center),
          columns.variable(arcState.baseIndex),
        );
      projectedArcSweepInequalities(
        [...pIdx(center), ...eIdx(entity.entityId)],
        arcTangencyDual,
      );

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [...pIdx(center), ...eIdx(entity.entityId)],
          evaluateComponentJacobian: componentJacobian(
            [...pIdx(center), ...eIdx(entity.entityId)],
            (columns) => {
              const tangency = arcTangencyDual(columns);
              return projectedTangentComponentsDual(
                tangency.residual,
                tangency.contact,
              );
            },
          ),
          ...projectedTangentHinge,
          evaluateComponents(values) {
            const { radius } = getArcParameters(values, arcState);
            const localCenter = getPoint(values, center);
            const centerOffset = subtract(localCenter, projectedCircle.center);
            const centerDistance = length(centerOffset);
            const direction: SketchPoint2D =
              centerDistance > DEGENERATE_NORM_EPSILON
                ? [
                    centerOffset[0] / centerDistance,
                    centerOffset[1] / centerDistance,
                  ]
                : [1, 0];
            const targetDistance =
              constraint.relation === "external"
                ? radius + projectedCircle.radius
                : Math.abs(radius - projectedCircle.radius);
            const contactDirection =
              constraint.relation === "external"
                ? direction
                : ([-direction[0], -direction[1]] as const);
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] +
                contactDirection[0] * projectedCircle.radius,
              projectedCircle.center[1] +
                contactDirection[1] * projectedCircle.radius,
            ];
            return projectedTangentComponents(
              centerDistance - targetDistance,
              contactPoint,
            );
          },
          evaluateResidual(values) {
            const { radius } = getArcParameters(values, arcState);
            const localCenter = getPoint(values, center);
            const centerOffset = subtract(localCenter, projectedCircle.center);
            const centerDistance = length(centerOffset);
            const direction: SketchPoint2D =
              centerDistance > DEGENERATE_NORM_EPSILON
                ? [
                    centerOffset[0] / centerDistance,
                    centerOffset[1] / centerDistance,
                  ]
                : [1, 0];
            const targetDistance =
              constraint.relation === "external"
                ? radius + projectedCircle.radius
                : Math.abs(radius - projectedCircle.radius);
            const contactDirection =
              constraint.relation === "external"
                ? direction
                : ([-direction[0], -direction[1]] as const);
            const contactPoint: SketchPoint2D = [
              projectedCircle.center[0] +
                contactDirection[0] * projectedCircle.radius,
              projectedCircle.center[1] +
                contactDirection[1] * projectedCircle.radius,
            ];
            return createTangentResidual(
              centerDistance - targetDistance,
              contactPoint,
            );
          },
        }),
      );
    }
  }
  return false;
}
