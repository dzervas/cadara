import type {
  ConstraintDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import {
  arcSweepViolationDual,
  createNumericalScalarConstraint,
  localCircleTangencyContactsDual,
  pointLineSignedDistanceDual,
  unitVectorDual,
} from "./analytic-residuals";
import {
  localArcSweepViolation,
  localCircleTangencyContacts,
  splineArcEndpointTangency,
} from "./arc-geometry";
import type { Dual2, DualColumns } from "./automatic-differentiation";
import { dual, dual2 } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import { pointLineSignedDistance } from "./line-residuals";
import { unitVector } from "./projected-geometry";
import { dot2, getPoint, length, subtract } from "./solver-geometry";
import type { SolverPointRecord } from "./system-types";

export function buildTangentConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    definition,
    pointRecords,
    scalarConstraints,
    parameterCount,
    getLocalCircleLike,
    reconstructCurrentSpline,
    pIdx,
    entityIdx,
    componentJacobian,
    pointDual,
    localCircleLikeDual,
    splineSpanPoleDuals,
    addArcSweepInequalities,
    offsetSeedArcIds,
    orientedTangencyRows,
    sameLocation,
  } = context;
  if (constraint.kind === "tangent") {
    const first = definition.entities.find(
      (entity) => entity.entityId === constraint.entityIds[0],
    );
    const second = definition.entities.find(
      (entity) => entity.entityId === constraint.entityIds[1],
    );
    if (!first || !second) {
      return true;
    }

    const endpointPair = splineArcEndpointTangency(definition, first, second);
    if (endpointPair) {
      const { spline, arc, atStart } = endpointPair;
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...entityIdx(spline.entityId),
            ...entityIdx(arc.entityId),
          ],
          evaluateComponentJacobian: componentJacobian(
            [...entityIdx(spline.entityId), ...entityIdx(arc.entityId)],
            (columns) => {
              const poles = splineSpanPoleDuals(columns, spline, (spans) =>
                atStart ? spans[0] : spans.at(-1),
              );
              const circle = localCircleLikeDual(columns, arc);
              if (!poles || !circle)
                return [columns.constant(Number.POSITIVE_INFINITY)];
              const point = atStart ? poles[0]! : poles[3]!;
              const adjacent = atStart ? poles[1]! : poles[2]!;
              const tangent = dual2.sub(point, adjacent);
              const magnitude = dual2.length(tangent);
              return [
                magnitude.value > 1e-10
                  ? dual.div(
                      dual2.dot(dual2.sub(point, circle.center), tangent),
                      magnitude,
                    )
                  : columns.constant(Number.POSITIVE_INFINITY),
              ];
            },
          ),
          evaluateResidual(values) {
            const geometry = reconstructCurrentSpline(values, spline);
            const span = atStart ? geometry.spans[0] : geometry.spans.at(-1);
            const circle = getLocalCircleLike(values, arc);
            if (!span || !circle) return Number.POSITIVE_INFINITY;
            const point = atStart ? span.poles[0] : span.poles[3];
            const adjacent = atStart ? span.poles[1] : span.poles[2];
            const tangent = subtract(point, adjacent);
            const magnitude = length(tangent);
            return magnitude > 1e-10
              ? dot2(subtract(point, circle.center), tangent) / magnitude
              : Number.POSITIVE_INFINITY;
          },
        }),
      );
      return true;
    }

    const line =
      first.kind === "lineSegment"
        ? first
        : second.kind === "lineSegment"
          ? second
          : null;
    const curve = first === line ? second : first;

    if (line && (curve.kind === "circle" || curve.kind === "arc")) {
      const start = pointRecords.get(line.startPointId);
      const end = pointRecords.get(line.endPointId);
      if (!start || !end) {
        return true;
      }
      const lineCurveTangencyDual = (columns: DualColumns) => {
        const circleLike = localCircleLikeDual(columns, curve);
        if (!circleLike) return null;
        const startPoint = pointDual(columns, start);
        const endPoint = pointDual(columns, end);
        const unit = unitVectorDual(startPoint, endPoint);
        if (!unit) return null;
        const signedDistance = pointLineSignedDistanceDual(
          circleLike.center,
          startPoint,
          endPoint,
        );
        const contactPoint: Dual2 = [
          dual.sub(circleLike.center[0], dual.mul(signedDistance, unit[1])),
          dual.sub(
            circleLike.center[1],
            dual.mul(signedDistance, dual.neg(unit[0])),
          ),
        ];
        return { circleLike, signedDistance, contactPoint, unit };
      };
      if (curve.kind === "arc")
        addArcSweepInequalities(
          constraint.constraintId,
          1,
          curve.entityId,
          [...pIdx(start, end), ...entityIdx(curve.entityId)],
          (columns) => {
            const tangency = lineCurveTangencyDual(columns);
            return tangency?.circleLike.arc
              ? {
                  contact: tangency.contactPoint,
                  arc: tangency.circleLike.arc,
                }
              : null;
          },
        );
      // cadara-p4r5.2: where the oriented row's contact is the arc start (it
      // defines the point-defined arc's radius, so |d| − r is second order
      // there), the oriented component (s − c)·u is component 0 of this
      // row's loss. An end contact keeps |d| − r (already first order).
      let radiusContact: {
        contact: SolverPointRecord;
        center: SolverPointRecord;
      } | null = null;
      if (curve.kind === "arc" && offsetSeedArcIds.has(curve.entityId)) {
        const contactPointId = [curve.startPointId, curve.endPointId].find(
          (pointId) =>
            sameLocation(pointId, line.startPointId) ||
            sameLocation(pointId, line.endPointId),
        );
        const contact = contactPointId && pointRecords.get(contactPointId);
        const center = pointRecords.get(curve.centerPointId);
        if (contactPointId === curve.startPointId && contact && center)
          radiusContact = { contact, center };
        if (contactPointId && contact && center)
          orientedTangencyRows.push({
            record: {
              id: `orientedTangency_${constraint.constraintId}`,
              requirementId: constraint.constraintId,
              arcEntityId: curve.entityId,
              contactPointId,
            },
            support: pIdx(start, end, contact, center),
            component: (columns) => {
              const unit = unitVectorDual(
                pointDual(columns, start),
                pointDual(columns, end),
              );
              return unit
                ? dual2.dot(
                    dual2.sub(
                      pointDual(columns, contact),
                      pointDual(columns, center),
                    ),
                    unit,
                  )
                : columns.fromColumns(
                    Number.NaN,
                    columns.support.map(() => Number.NaN),
                  );
            },
          });
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...pIdx(start, end),
            ...entityIdx(curve.entityId),
          ],
          evaluateComponentJacobian: componentJacobian(
            [...pIdx(start, end), ...entityIdx(curve.entityId)],
            (columns) => {
              const tangency = lineCurveTangencyDual(columns);
              if (!tangency) return [columns.constant(0)];
              const { circleLike, signedDistance, contactPoint, unit } =
                tangency;
              return [
                radiusContact
                  ? dual2.dot(
                      dual2.sub(
                        pointDual(columns, radiusContact.contact),
                        pointDual(columns, radiusContact.center),
                      ),
                      unit,
                    )
                  : dual.sub(dual.abs(signedDistance), circleLike.radius),
                circleLike.arc
                  ? arcSweepViolationDual(contactPoint, circleLike.arc)
                  : columns.constant(0),
              ];
            },
          ),
          ...(curve.kind === "arc" ? { hingeComponentIndices: [1] } : {}),
          evaluateComponents(values) {
            const circleLike = getLocalCircleLike(values, curve);
            if (!circleLike) {
              return [0];
            }

            const startPoint = getPoint(values, start);
            const endPoint = getPoint(values, end);
            const unit = unitVector(startPoint, endPoint);
            if (!unit) {
              return [0];
            }

            const signedDistance = pointLineSignedDistance(
              circleLike.center,
              startPoint,
              endPoint,
            );
            const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
            const contactPoint: SketchPoint2D = [
              circleLike.center[0] - signedDistance * lineNormal[0],
              circleLike.center[1] - signedDistance * lineNormal[1],
            ];
            const tangentResidual = radiusContact
              ? dot2(
                  subtract(
                    getPoint(values, radiusContact.contact),
                    getPoint(values, radiusContact.center),
                  ),
                  unit,
                )
              : Math.abs(signedDistance) - circleLike.radius;
            const arcViolation = circleLike.arc
              ? localArcSweepViolation(contactPoint, circleLike.arc)
              : 0;
            return [tangentResidual, arcViolation];
          },
          evaluateResidual(values) {
            const circleLike = getLocalCircleLike(values, curve);
            if (!circleLike) {
              return 0;
            }

            const startPoint = getPoint(values, start);
            const endPoint = getPoint(values, end);
            const unit = unitVector(startPoint, endPoint);
            if (!unit) {
              return 0;
            }

            const signedDistance = pointLineSignedDistance(
              circleLike.center,
              startPoint,
              endPoint,
            );
            const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
            const contactPoint: SketchPoint2D = [
              circleLike.center[0] - signedDistance * lineNormal[0],
              circleLike.center[1] - signedDistance * lineNormal[1],
            ];
            const tangentResidual = radiusContact
              ? dot2(
                  subtract(
                    getPoint(values, radiusContact.contact),
                    getPoint(values, radiusContact.center),
                  ),
                  unit,
                )
              : Math.abs(signedDistance) - circleLike.radius;
            const arcViolation = circleLike.arc
              ? localArcSweepViolation(contactPoint, circleLike.arc)
              : 0;
            return Math.sqrt(
              tangentResidual * tangentResidual + arcViolation * arcViolation,
            );
          },
        }),
      );
      return true;
    }

    if (
      (first.kind === "circle" || first.kind === "arc") &&
      (second.kind === "circle" || second.kind === "arc")
    ) {
      const pairSupport = [
        ...entityIdx(first.entityId),
        ...entityIdx(second.entityId),
      ];
      const circlePairTangencyDual = (columns: DualColumns) => {
        const firstCircle = localCircleLikeDual(columns, first);
        const secondCircle = localCircleLikeDual(columns, second);
        if (!firstCircle || !secondCircle) return null;
        const [firstContact, secondContact] = localCircleTangencyContactsDual(
          firstCircle,
          secondCircle,
          constraint.relation,
        );
        return {
          firstCircle,
          secondCircle,
          centerDistance: dual2.length(
            dual2.sub(firstCircle.center, secondCircle.center),
          ),
          firstContact,
          secondContact,
        };
      };
      for (const [index, entity] of [first, second].entries())
        if (entity.kind === "arc")
          addArcSweepInequalities(
            constraint.constraintId,
            index + 1,
            entity.entityId,
            pairSupport,
            (columns) => {
              const tangency = circlePairTangencyDual(columns);
              const circle =
                index === 0 ? tangency?.firstCircle : tangency?.secondCircle;
              return tangency && circle?.arc
                ? {
                    contact:
                      index === 0
                        ? tangency.firstContact
                        : tangency.secondContact,
                    arc: circle.arc,
                  }
                : null;
            },
          );
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
            pairSupport,
            (columns) => {
              const tangency = circlePairTangencyDual(columns);
              if (!tangency) return [columns.constant(0)];
              const {
                firstCircle,
                secondCircle,
                centerDistance,
                firstContact,
                secondContact,
              } = tangency;
              const targetDistance =
                constraint.relation === "external"
                  ? dual.add(firstCircle.radius, secondCircle.radius)
                  : dual.abs(dual.sub(firstCircle.radius, secondCircle.radius));
              return [
                dual.sub(centerDistance, targetDistance),
                firstCircle.arc
                  ? arcSweepViolationDual(firstContact, firstCircle.arc)
                  : columns.constant(0),
                secondCircle.arc
                  ? arcSweepViolationDual(secondContact, secondCircle.arc)
                  : columns.constant(0),
              ];
            },
          ),
          hingeComponentIndices: [first, second].flatMap((entity, index) =>
            entity.kind === "arc" ? [index + 1] : [],
          ),
          evaluateComponents(values) {
            const firstCircle = getLocalCircleLike(values, first);
            const secondCircle = getLocalCircleLike(values, second);
            if (!firstCircle || !secondCircle) {
              return [0];
            }

            const centerDistance = length(
              subtract(firstCircle.center, secondCircle.center),
            );
            const targetDistance =
              constraint.relation === "external"
                ? firstCircle.radius + secondCircle.radius
                : Math.abs(firstCircle.radius - secondCircle.radius);
            const tangentResidual = centerDistance - targetDistance;
            const [firstContact, secondContact] = localCircleTangencyContacts(
              firstCircle,
              secondCircle,
              constraint.relation,
            );
            const firstArcViolation = firstCircle.arc
              ? localArcSweepViolation(firstContact, firstCircle.arc)
              : 0;
            const secondArcViolation = secondCircle.arc
              ? localArcSweepViolation(secondContact, secondCircle.arc)
              : 0;
            return [tangentResidual, firstArcViolation, secondArcViolation];
          },
          evaluateResidual(values) {
            const firstCircle = getLocalCircleLike(values, first);
            const secondCircle = getLocalCircleLike(values, second);
            if (!firstCircle || !secondCircle) {
              return 0;
            }

            const centerDistance = length(
              subtract(firstCircle.center, secondCircle.center),
            );
            const targetDistance =
              constraint.relation === "external"
                ? firstCircle.radius + secondCircle.radius
                : Math.abs(firstCircle.radius - secondCircle.radius);
            const tangentResidual = centerDistance - targetDistance;
            const [firstContact, secondContact] = localCircleTangencyContacts(
              firstCircle,
              secondCircle,
              constraint.relation,
            );
            const firstArcViolation = firstCircle.arc
              ? localArcSweepViolation(firstContact, firstCircle.arc)
              : 0;
            const secondArcViolation = secondCircle.arc
              ? localArcSweepViolation(secondContact, secondCircle.arc)
              : 0;
            return Math.sqrt(
              tangentResidual * tangentResidual +
                firstArcViolation * firstArcViolation +
                secondArcViolation * secondArcViolation,
            );
          },
        }),
      );
      return true;
    }
  }
  return false;
}
