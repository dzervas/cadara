import { buildSystem } from "./build-system";
import {
  buildCompiledComponentData,
  createSketchSolveCompatibilityKey,
  createStableHash,
} from "./compile-components";
import {
  COINCIDENT_SPLINE_SPAN_CODE,
  degenerateSplineSpanDragRecovery,
} from "./degenerate-spline-recovery";
import {
  findProjectedGeometry,
  resolveSketchDatumPoint,
} from "./projected-geometry";
import { DEFAULT_SKETCH_DRAG_STEP } from "./solve-types";
import type {
  SketchCoreValidationResult,
  SketchDragStep,
  SketchSolveStrategy,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import {
  cloneValues,
  getDrivingDimensionValue,
  getPoint,
  length,
  subtract,
} from "./solver-geometry";
import type { SketchCompiledSolveProgram } from "./system-types";
import { validateDefinition } from "./validate-definition";
import type { SketchPointId } from "@/contracts/shared/ids";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import type {
  ConstraintDefinition,
  NumericSketchDefinition as SketchDefinition,
  SketchPoint2D,
  SolvedOffsetFramePlanRecord,
} from "@/contracts/sketch/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceRecord,
  SolverPartialSolvePolicy,
} from "@/contracts/solver/schema";

export function resolvePointConstraintTarget(
  constraint: ConstraintDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): { pointId: SketchPointId; target: SketchPoint2D } | null {
  if (constraint.kind === "fixPoint") {
    return { pointId: constraint.pointId, target: constraint.position };
  }

  if (constraint.kind !== "coincidentProjectedPoint") {
    return null;
  }

  const target =
    constraint.projectedPoint.kind === "projectedGeometry"
      ? (() => {
          const projected = findProjectedGeometry(
            projectedReferences,
            constraint.projectedPoint.reference,
          );
          return projected?.kind === "point" ? projected.position : null;
        })()
      : resolveSketchDatumPoint(constraint.projectedPoint.datum);

  return target ? { pointId: constraint.point.pointId, target } : null;
}

export function preconditionValuesForPointAnchors(
  program: SketchCompiledSolveProgram,
  initialValues: Float64Array,
): Float64Array {
  const values = cloneValues(initialValues);
  let translated = false;

  for (const component of program.components) {
    const deltas = program.definition.constraints.flatMap((constraint) => {
      const resolved = resolvePointConstraintTarget(
        constraint,
        program.projectedReferences,
      );
      if (!resolved || !component.pointIds.includes(resolved.pointId)) {
        return [];
      }

      const point = program.system.pointRecords.get(resolved.pointId);
      return point ? [subtract(resolved.target, getPoint(values, point))] : [];
    });

    const dimensionDeltas = program.definition.dimensions.flatMap(
      (dimension) => {
        if (
          dimension.kind !== "pointDatumDistance" ||
          isReferenceDimension(dimension) ||
          dimension.axis === "aligned" ||
          !component.pointIds.includes(dimension.point.pointId)
        ) {
          return [];
        }
        const point = program.system.pointRecords.get(dimension.point.pointId);
        const datum = resolveSketchDatumPoint(dimension.datum.datum);
        if (!point || !datum) return [];
        const axis = dimension.axis === "horizontal" ? 0 : 1;
        const current = getPoint(values, point)[axis] - datum[axis];
        // Keep the absolute-distance branch and move the whole component before
        // solving, rather than letting a distant centre target fold its polygon.
        const target = (current < 0 ? -1 : 1) * getDrivingDimensionValue(dimension);
        return [{ axis, delta: target - current }];
      },
    );

    let first: SketchPoint2D;
    if (dimensionDeltas.length > 0) {
      const translation: [number, number] = [0, 0];
      for (const axis of [0, 1] as const) {
        const candidates = [
          ...deltas.map((delta) => delta[axis]),
          ...dimensionDeltas
            .filter((delta) => delta.axis === axis)
            .map((delta) => delta.delta),
        ];
        const candidate = candidates[0];
        if (
          candidate !== undefined &&
          candidates.every(
            (delta) =>
              Math.abs(delta - candidate) <= program.tolerances.coincidence,
          )
        ) {
          translation[axis] = candidate;
        }
      }
      first = translation;
    } else {
      const anchor = deltas[0];
      if (
        !anchor ||
        deltas.some(
          (delta) =>
            length(subtract(delta, anchor)) > program.tolerances.coincidence,
        )
      ) {
        continue;
      }
      first = anchor;
    }

    if (length(first) <= program.tolerances.coincidence) {
      continue;
    }

    for (const pointId of component.pointIds) {
      const point = program.system.pointRecords.get(pointId);
      if (!point) {
        continue;
      }
      values[point.baseIndex] += first[0];
      values[point.baseIndex + 1] += first[1];
      translated = true;
    }
  }

  return translated ? values : initialValues;
}

/** τ is an explicit document setting ([TECH] G12): never a default. */
export function assertSolveModelingTolerance(modelingTolerance: unknown) {
  if (
    typeof modelingTolerance !== "number" ||
    !Number.isFinite(modelingTolerance) ||
    modelingTolerance <= 0
  )
    throw new RangeError(
      `A sketch solve requires the document modelingTolerance as a positive finite number; received ${String(modelingTolerance)}.`,
    );
}

export function compileSketchSolveProgram(input: {
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  /** The document's settings.modelingTolerance ([TECH] G12). */
  modelingTolerance: number;
  /** [TECH] G3/G17 offset plan hints (the last publication or a `planChanged` hint). */
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
  partialSolvePolicy: SolverPartialSolvePolicy;
  strategy?: SketchSolveStrategy;
  /**
   * cadara-p4r5.2: the drag frames' step (default "penalty", or the test-only
   * environment override, see `SketchDragStep`). Not part of the
   * compatibility key and not carried over when a session recompiles its
   * program: a recompiled program takes the process default (only specs
   * pass it explicitly).
   */
  dragStep?: SketchDragStep;
  /**
   * T17c5: the point a drag moves. A spline whose only authored errors are
   * coincident spans at this point, not joined by Coincident constraints,
   * is judged at each solve's values (the drag may separate them).
   */
  degenerateSplineSpanDragPointId?: SketchPointId;
}): SketchCompiledSolveProgram {
  assertSolveModelingTolerance(input.modelingTolerance);
  const projectedReferences = input.projectedReferences ?? [];
  const derived = evaluateSketchDerivations({
    definition: input.definition,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
  });
  const definition = derived.definition;
  const authoredValidation = validateDefinition(
    definition,
    input.tolerances,
    projectedReferences,
  );
  const degenerateSplineSpanRecovery = degenerateSplineSpanDragRecovery(
    definition,
    authoredValidation,
    input.degenerateSplineSpanDragPointId,
  );
  // T17c5: the recovered splines' coincident spans leave the authored
  // validation; `materializeSolveResult` judges them at the solve's values.
  const validationDiagnostics = authoredValidation.diagnostics.filter(
    (diagnostic) =>
      diagnostic.code !== COINCIDENT_SPLINE_SPAN_CODE ||
      diagnostic.target?.kind !== "entity" ||
      !degenerateSplineSpanRecovery.splineIds.has(diagnostic.target.entityId),
  );
  const validation: SketchCoreValidationResult = {
    isValid: validationDiagnostics.every(
      (diagnostic) => diagnostic.severity !== "error",
    ),
    diagnostics: validationDiagnostics,
  };
  const system = buildSystem(definition, {
    dragTarget: null,
    projectedReferences,
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
  });
  const strategy = input.strategy ?? "bfgs";
  const compatibilityKey = createSketchSolveCompatibilityKey({
    definition,
    projectedReferences,
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
    partialSolvePolicy: input.partialSolvePolicy,
    strategy,
  });
  const { components, equationMetadata } = buildCompiledComponentData(
    system,
    definition,
  );

  return {
    programId: `compiled_sketch_solve_${createStableHash(compatibilityKey)}`,
    compatibilityKey,
    definition,
    projectedReferences,
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
    partialSolvePolicy: input.partialSolvePolicy,
    strategy,
    ...((input.dragStep ?? DEFAULT_SKETCH_DRAG_STEP) === "constrained"
      ? { dragStep: "constrained" as const }
      : {}),
    diagnostics: derived.diagnostics,
    validation,
    degenerateSplineSpanRecovery,
    system,
    components,
    equationMetadata,
  };
}

export function isCompiledSketchSolveProgramCompatible(
  program: SketchCompiledSolveProgram,
  input: {
    definition: SketchDefinition;
    projectedReferences?: readonly ProjectedSketchReferenceRecord[];
    tolerances: SketchSolveTolerancePolicy;
    modelingTolerance: number;
    offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
    partialSolvePolicy?: SolverPartialSolvePolicy;
    strategy?: SketchSolveStrategy;
  },
) {
  const projectedReferences = input.projectedReferences ?? [];
  const derived = evaluateSketchDerivations({
    definition: input.definition,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
  });
  const strategy = input.strategy ?? program.strategy;
  const compatibilityKey = createSketchSolveCompatibilityKey({
    definition: derived.definition,
    projectedReferences,
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
    partialSolvePolicy: input.partialSolvePolicy ?? program.partialSolvePolicy,
    strategy,
  });
  return compatibilityKey === program.compatibilityKey;
}
