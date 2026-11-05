import type { ComponentJacobian } from "./automatic-differentiation";
import type { ConstrainedStepRow } from "./constrained-minimum-motion";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveProgram,
} from "./system-types";

/** Restate hard-row hinge components as inequalities, retaining program order. */
export function constrainedStepRows(
  program: SketchCompiledSolveProgram,
  hardRows: readonly ScalarConstraintRecord[],
  excludeBlockedRequirementsAt?: Float64Array,
): {
  equalities: ConstrainedStepRow[];
  inequalities: ((values: Float64Array) => ComponentJacobian)[];
} {
  // Drag treats the solve's blocked requirements as inactive. Batch retains
  // them: their unavailable pullbacks select the descent fallback, which owns
  // recovery across an offset domain boundary.
  const activeRows = excludeBlockedRequirementsAt
    ? hardRows.filter(
        (row) =>
          !row
            .offsetBlockers?.(excludeBlockedRequirementsAt)
            .some(
              (blocker) =>
                blocker.reason === "failed" &&
                program.system.parameterProjection.failedAtSolveStart(
                  blocker.derivationId,
                ),
            ),
      )
    : hardRows;
  const restated = program.system.inequalities.filter((inequality) =>
    activeRows.some(
      (row) =>
        row.id === inequality.requirement?.id &&
        row.hingeComponentIndices?.includes(
          inequality.requirement.componentIndex,
        ),
    ),
  );
  return {
    equalities: activeRows.map((row) => ({
      evaluate: (values) => row.evaluateComponentJacobian(values),
      excludedComponents: restated.flatMap((inequality) =>
        inequality.requirement!.id === row.id
          ? [inequality.requirement!.componentIndex]
          : [],
      ),
    })),
    inequalities: restated.map(
      (inequality) => (values: Float64Array) => inequality.evaluate(values),
    ),
  };
}
