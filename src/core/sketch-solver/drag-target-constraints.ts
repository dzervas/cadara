import { componentJacobianOver } from "./analytic-residuals";
import { dual, dual2 } from "./automatic-differentiation";
import { splineTangentStateKey } from "./parameter-projection";
import type { SketchDraggedPointTarget } from "./solve-types";
import {
  addPointGradient,
  getPoint,
  subtract,
  zeroVector,
} from "./solver-geometry";
import type { BuildSystemResult, ScalarConstraintRecord } from "./system-types";
import type { ConstraintId, SketchEntityId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

// Drag solution selection policy (see openspec/changes/minimum-motion-sketch-drag):
//
// Policy 1 (adopted): the drag target is a soft objective and every non-dragged
// free point gets a weak UNIFORM previous-frame anchoring term
// (epsilon * ||p_i - p_i_prevFrame||^2, epsilon << drag weight). Under-constrained
// null spaces then resolve to the minimum-motion solution: nothing moves unless a
// hard constraint forces it, and forced motion is minimal.
//
// Policy 2 (considered, not implemented): weight each anchoring term by
// constraint-graph distance from the dragged point, making nearby geometry
// cheaper to move so linkages "swing" rather than stretch. Feels more physical
// but adds a tunable and mild unpredictability; revisit only if user feedback
// shows policy 1 reads as too "stiff". The per-point weight would replace the
// uniform epsilon where the anchoring residuals are constructed.
export function createDragTargetConstraint(
  system: BuildSystemResult,
  dragTarget: SketchDraggedPointTarget,
  weight = 1,
): ScalarConstraintRecord | null {
  const point = system.pointRecords.get(dragTarget.pointId);
  if (!point) {
    return null;
  }

  return system.parameterProjection.wrapConstraint(
    {
      id: `constraint_drag_target_${dragTarget.pointId}` as ConstraintId,
      targetKind: "constraint",
      evaluateComponents(values) {
        return subtract(getPoint(values, point), dragTarget.position).map(
          (value) => Math.sqrt(weight) * value,
        );
      },
      evaluateComponentJacobian: componentJacobianOver(
        system.parameterCount,
        [point.baseIndex, point.baseIndex + 1],
        (columns) =>
          dual2
            .sub(
              columns.point(point.baseIndex),
              columns.constant2(dragTarget.position),
            )
            .map((value) => dual.scale(value, Math.sqrt(weight))),
      ),
      evaluate(values) {
        const gradient = zeroVector(system.parameterCount);
        const actual = getPoint(values, point);
        const delta = subtract(actual, dragTarget.position);
        addPointGradient(gradient, point, weight * delta[0], weight * delta[1]);
        return {
          residual: 0.5 * weight * (delta[0] * delta[0] + delta[1] * delta[1]),
          gradient,
        };
      },
    },
    [point.baseIndex, point.baseIndex + 1],
  );
}

/**
 * T12b: create a soft radius-targeting constraint for circle/arc rim drag.
 * Returns null when the entity is missing or has no radius variable.
 */
export function createDragRadiusConstraint(
  system: BuildSystemResult,
  entityId: SketchEntityId,
  targetRadius: number,
  weight = 1,
): ScalarConstraintRecord | null {
  const entityState = system.entityStates.get(entityId);
  if (!entityState) return null;
  if (entityState.kind !== "circle" && entityState.kind !== "arc") return null;
  const radiusIndex = entityState.baseIndex;
  return system.parameterProjection.wrapConstraint(
    {
      id: `constraint_drag_radius_${entityId}` as ConstraintId,
      targetKind: "constraint",
      evaluateComponents(values) {
        return [Math.sqrt(weight) * (values[radiusIndex]! - targetRadius)];
      },
      evaluateComponentJacobian: componentJacobianOver(
        system.parameterCount,
        [radiusIndex],
        (columns) => [
          dual.scale(
            dual.sub(
              columns.variable(radiusIndex),
              columns.constant(targetRadius),
            ),
            Math.sqrt(weight),
          ),
        ],
      ),
      evaluate(values) {
        const gradient = zeroVector(system.parameterCount);
        const actual = values[radiusIndex]!;
        const delta = actual - targetRadius;
        gradient[radiusIndex] += weight * delta;
        return { residual: 0.5 * weight * delta * delta, gradient };
      },
    },
    [radiusIndex],
  );
}

/**
 * T12b: create a soft tangent-vector-targeting constraint for handle drag.
 * Returns null when the tangent state is missing.
 */
export function createDragTangentVectorConstraint(
  system: BuildSystemResult,
  entityId: SketchEntityId,
  occurrenceId: string,
  targetVector: SketchPoint2D,
  weight = 1,
): ScalarConstraintRecord | null {
  const tangentState = system.splineTangentStates.get(
    splineTangentStateKey(entityId, occurrenceId),
  );
  if (!tangentState) return null;
  const bx = tangentState.baseIndex;
  const by = tangentState.baseIndex + 1;
  return system.parameterProjection.wrapConstraint(
    {
      id: `constraint_drag_tangent_${entityId}_${occurrenceId}` as ConstraintId,
      targetKind: "constraint",
      evaluateComponents(values) {
        return [
          Math.sqrt(weight) * (values[bx]! - targetVector[0]),
          Math.sqrt(weight) * (values[by]! - targetVector[1]),
        ];
      },
      evaluateComponentJacobian: componentJacobianOver(
        system.parameterCount,
        [bx, by],
        (columns) =>
          dual2
            .sub(columns.point(bx), columns.constant2(targetVector))
            .map((value) => dual.scale(value, Math.sqrt(weight))),
      ),
      evaluate(values) {
        const gradient = zeroVector(system.parameterCount);
        const dx = values[bx]! - targetVector[0];
        const dy = values[by]! - targetVector[1];
        gradient[bx] += weight * dx;
        gradient[by] += weight * dy;
        return { residual: 0.5 * weight * (dx * dx + dy * dy), gradient };
      },
    },
    [bx, by],
  );
}
