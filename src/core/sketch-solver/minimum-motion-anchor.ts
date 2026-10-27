import { componentJacobianOver } from "./analytic-residuals";
import { dual } from "./automatic-differentiation";
import { zeroVector } from "./solver-geometry";
import type {
  ScalarConstraintRecord,
  SolverParameterProjection,
} from "./system-types";
import type { ConstraintId } from "@/contracts/shared/ids";

// D2 (minimum-motion-sketch-drag): uniform previous-frame anchoring residual.
// For every non-dragged free variable in the affected component this adds a weak
// quadratic term (0.5 * weight * (v - anchor)^2, weight << drag weight) so that
// under-constrained null spaces resolve to the minimum-motion solution: nothing
// moves unless a hard constraint forces it, and forced motion is minimal.
//
// Policy 2 (considered, not implemented) would replace the single uniform
// `weight` here with a per-index weight derived from constraint-graph distance to
// the dragged point. See the policy note above createDragTargetConstraint.
export function createMinimumMotionAnchorConstraint(input: {
  id: ConstraintId;
  parameterCount: number;
  anchorValues: Float64Array;
  variableIndices: readonly number[];
  weight: number;
  parameterProjection: SolverParameterProjection;
}): ScalarConstraintRecord {
  const indices = input.parameterProjection.projectVariableIndices(
    input.variableIndices,
  );
  return input.parameterProjection.wrapConstraint(
    {
      id: input.id,
      targetKind: "constraint",
      evaluateComponents(values) {
        return indices.map(
          (index) =>
            Math.sqrt(input.weight) *
            (values[index]! - input.anchorValues[index]!),
        );
      },
      evaluateComponentJacobian: componentJacobianOver(
        input.parameterCount,
        indices,
        (columns) =>
          indices.map((index) =>
            dual.scale(
              dual.sub(
                columns.variable(index),
                columns.constant(input.anchorValues[index]!),
              ),
              Math.sqrt(input.weight),
            ),
          ),
      ),
      evaluate(values) {
        const gradient = zeroVector(input.parameterCount);
        let residual = 0;
        for (const index of indices) {
          const delta = values[index]! - input.anchorValues[index]!;
          residual += 0.5 * input.weight * delta * delta;
          gradient[index] += input.weight * delta;
        }
        return { residual, gradient };
      },
    },
    indices,
  );
}
