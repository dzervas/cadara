import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";

export interface SketchScalarConstraintEvaluationForTest {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  residual: number;
  gradient: Float64Array;
}
import { buildSystem } from "./build-system";
import { resolveDragTargetFrame } from "./drag-target-frame";
import { createMinimumMotionAnchorConstraint } from "./minimum-motion-anchor";
import type {
  SketchDragTarget,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import type { SketchCompiledSolveProgram } from "./system-types";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

export function getSketchSolveInitialValuesForTest(
  definition: SketchDefinition,
  tolerances: SketchSolveTolerancePolicy,
  modelingTolerance: number,
) {
  return buildSystem(definition, { tolerances, modelingTolerance })
    .initialValues;
}

/**
 * cadara-p4r5.1: the drag-frame rows `resolveDragTargetFrame` builds for
 * `target` at `values`, a minimum-motion anchor over
 * `anchorVariableIndices`, and the `dragTarget` row `buildSystem` compiles
 * for a point target, each with the authority variables it reads (for the
 * Jacobian conformance spec).
 */
export function dragFrameRowsForTest(input: {
  program: SketchCompiledSolveProgram;
  target: SketchDragTarget;
  values: Float64Array;
  anchorVariableIndices: readonly number[];
}) {
  const { program, target, values } = input;
  const { system } = program;
  const projection = system.parameterProjection;
  const frame = resolveDragTargetFrame(program, target, values, 1);
  if (!frame) throw new Error(`No drag frame for ${target.kind}.`);
  const rows = [
    ...frame.constraints.map((record) => ({
      record,
      variableIndices: projection.projectVariableIndices(
        frame.draggedVariableIndices,
      ),
    })),
    {
      record: createMinimumMotionAnchorConstraint({
        id: "constraint_minimum_motion_anchor_test" as ConstraintId,
        parameterCount: system.parameterCount,
        anchorValues: values,
        variableIndices: input.anchorVariableIndices,
        weight: 1e-3,
        parameterProjection: projection,
      }),
      variableIndices: projection.projectVariableIndices(
        input.anchorVariableIndices,
      ),
    },
  ];
  if (target.kind !== "sketchPoint") return rows;
  const dragTargetId = `constraint_drag_target_${target.pointId}`;
  const compiled = buildSystem(program.definition, {
    dragTarget: target,
    projectedReferences: program.projectedReferences,
    tolerances: program.tolerances,
    modelingTolerance: program.modelingTolerance,
    offsetPlans: program.offsetPlans,
  }).scalarConstraints.find((record) => record.id === dragTargetId);
  if (!compiled) throw new Error(`No ${dragTargetId} row.`);
  return [
    ...rows,
    {
      record: compiled,
      variableIndices: projection.projectVariableIndices(
        frame.draggedVariableIndices,
      ),
    },
  ];
}

export function evaluateSketchScalarConstraintForTest(input: {
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  constraintId: ConstraintId | DimensionId;
  values: Float64Array;
  tolerances: SketchSolveTolerancePolicy;
  modelingTolerance: number;
}): SketchScalarConstraintEvaluationForTest {
  const system = buildSystem(input.definition, {
    projectedReferences: input.projectedReferences ?? [],
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
  });
  const constraint = system.scalarConstraints.find(
    (candidate) => candidate.id === input.constraintId,
  );
  if (!constraint) {
    throw new Error(`Unknown scalar constraint ${input.constraintId}.`);
  }
  const evaluation = constraint.evaluate(input.values);
  return {
    id: constraint.id,
    targetKind: constraint.targetKind,
    residual: evaluation.residual,
    gradient: evaluation.gradient,
  };
}
