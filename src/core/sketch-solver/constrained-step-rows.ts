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
): {
  equalities: ConstrainedStepRow[];
  inequalities: ((values: Float64Array) => ComponentJacobian)[];
} {
  const restated = program.system.inequalities.filter((inequality) =>
    hardRows.some(
      (row) =>
        row.id === inequality.requirement?.id &&
        row.hingeComponentIndices?.includes(
          inequality.requirement.componentIndex,
        ),
    ),
  );
  return {
    equalities: hardRows.map((row) => ({
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
