import {
  chiralityMargin,
  deriveChiralityInvariants,
} from "./constrained-chirality";
import { solveConstrainedMinimumMotionSteps } from "./constrained-minimum-motion";
import type { SolveSteps } from "./solve-steps";
import { solverWorkTrace } from "./solve-tracing";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveProgram,
} from "./system-types";

/**
 * cadara-p4r5.2: one drag stage by the equality-constrained minimum-motion
 * step (`SketchDragStep` "constrained"), on row data only:
 * - equalities: every component of the stage's hard rows, except a component
 *   that an inequality restates (`hingeComponentIndices` with its
 *   `requirement`): that inequality is enforced instead (active set);
 * - objective: the drag goal rows and the minimum-motion anchor.
 * Validity inequalities (segment length, radius) are not enforced: the
 * acceptance judge and its entity guard decide those frames as without the
 * step. Null when the step is unavailable at this frame (counted in the work
 * trace), so the caller runs phases A and B.
 * With a `dragBoundary` policy the row-derived branch invariants of the
 * hard rows at the last accepted frame (`previous`) take part: "park" and
 * "block" enforce them as inequalities, and `boundaryActive` reports whether
 * the step stopped on one that was clear of its boundary at `previous` (the
 * caller refuses such a frame under "block");
 * "resist" adds √w·min(0, g − m) objective rows instead (w the goal weight,
 * m a margin of `RESIST_MARGIN_TOLERANCES` τ).
 */
export function* solveConstrainedDragStage(input: {
  program: SketchCompiledSolveProgram;
  hardConstraints: readonly ScalarConstraintRecord[];
  objective: readonly ScalarConstraintRecord[];
  start: Float64Array;
  previous: Float64Array;
  variables: readonly number[];
}): SolveSteps<{ values: Float64Array; boundaryActive: boolean } | null> {
  const policy = input.program.dragBoundary;
  const margins = policy
    ? deriveChiralityInvariants(
        input.program,
        input.hardConstraints,
        input.previous,
      ).map((invariant) => chiralityMargin(input.program, invariant))
    : [];
  const resistMargin =
    RESIST_MARGIN_TOLERANCES * input.program.modelingTolerance;
  const restated = input.program.system.inequalities.filter((inequality) =>
    input.hardConstraints.some(
      (row) =>
        row.id === inequality.requirement?.id &&
        row.hingeComponentIndices?.includes(
          inequality.requirement.componentIndex,
        ),
    ),
  );
  const result = yield* solveConstrainedMinimumMotionSteps({
    start: input.start,
    variables: input.variables,
    equalities: input.hardConstraints.map((row) => ({
      evaluate: (values) => row.evaluateComponentJacobian(values),
      excludedComponents: restated.flatMap((inequality) =>
        inequality.requirement!.id === row.id
          ? [inequality.requirement!.componentIndex]
          : [],
      ),
    })),
    inequalities: [
      ...restated.map(
        (inequality) => (values: Float64Array) => inequality.evaluate(values),
      ),
      ...(policy === "park" || policy === "block" ? margins : []),
    ],
    objective: [
      ...input.objective.map((row) => ({
        evaluate: (values: Float64Array) =>
          row.evaluateComponentJacobian(values),
      })),
      ...(policy === "resist"
        ? margins.map((margin) => ({
            evaluate: (values: Float64Array) => {
              const { components, rows } = margin(values);
              const inside = components[0]! - resistMargin < 0;
              return {
                components: [
                  inside
                    ? RESIST_WEIGHT_ROOT * (components[0]! - resistMargin)
                    : 0,
                ],
                rows: [
                  rows[0]!.map((entry) =>
                    inside ? RESIST_WEIGHT_ROOT * entry : 0,
                  ),
                ],
              };
            },
          }))
        : []),
    ],
  });
  if (solverWorkTrace) {
    solverWorkTrace.constrainedStepStages += 1;
    solverWorkTrace.constrainedStepRestatedComponents += restated.length;
    if (result.kind === "solved" && result.stop === "rowUnavailable")
      solverWorkTrace.constrainedStepRowUnavailableStops += 1;
    solverWorkTrace.constrainedStepIterations += result.stats.iterations;
    solverWorkTrace.constrainedStepNewtonIterations +=
      result.stats.newtonIterations;
    if (result.kind === "unavailable") {
      if (result.reason === "jacobianUnavailable")
        solverWorkTrace.constrainedStepJacobianUnavailable += 1;
      else solverWorkTrace.constrainedStepStartNotCorrectable += 1;
    }
  }
  if (result.kind !== "solved") return null;
  if (solverWorkTrace)
    solverWorkTrace.constrainedStepBoundaryInvariants += margins.length;
  // Only a margin the step itself brought onto its boundary counts: one
  // already within the tolerance at `previous` (its floor is its height
  // there) sits on it whether or not the step moved that triple.
  const onBoundary = (margin: (typeof margins)[number], values: Float64Array) =>
    margin(values).components[0]! <=
    BOUNDARY_ACTIVE_TOLERANCES * input.program.modelingTolerance;
  const boundaryActive =
    policy === "block" &&
    margins.some(
      (margin) =>
        !onBoundary(margin, input.previous) &&
        onBoundary(margin, result.values),
    );
  return { values: result.values, boundaryActive };
}

/** "resist": the margin (in τ) inside which the objective row acts, and √ of its weight (the drag goal's 1e-2). */
const RESIST_MARGIN_TOLERANCES = 10;
const RESIST_WEIGHT_ROOT = 0.1;
/** "block": a result within this many τ of an invariant's boundary sits on it. */
const BOUNDARY_ACTIVE_TOLERANCES = 1e-6;
