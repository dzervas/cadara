import { buildSystem } from "./build-system";
import {
  assertSolveModelingTolerance,
  compileSketchSolveProgram,
} from "./compile-program";
import { buildDimensionStatuses } from "./dimension-statuses";
import { solveCompiledSketchProgram } from "./solve-compiled-program";
import type {
  SketchCoreSolveResult,
  SketchCoreValidationResult,
  SketchDraggedPointSolveResult,
  SketchDraggedPointTarget,
  SketchSolveStrategy,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import { makeDiagnostic } from "./solver-geometry";
import { createCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import { validateDefinition } from "./validate-definition";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import type {
  DimensionStatusRecord,
  NumericSketchDefinition as SketchDefinition,
  SolvedOffsetFramePlanRecord,
} from "@/contracts/sketch/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceRecord,
  SolverPartialSolvePolicy,
} from "@/contracts/solver/schema";

// (removed) connectPoints / collectTranslationComponent /
// trySolveDraggedPointAsComponentTranslation: the standalone rigid-translation
// fallback with its own targetDistance-based acceptance model was retired by
// minimum-motion-sketch-drag. Interactive drag solving
// (updateCompiledSketchSolveSession) is now the single authority; its
// translation fast path was deleted too (T13a2): a rigid component translates
// because translation is its minimum-motion solution.

export function solveSketchDefinitionCore(input: {
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  modelingTolerance: number;
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
  partialSolvePolicy: SolverPartialSolvePolicy;
  strategy?: SketchSolveStrategy;
}): SketchCoreSolveResult {
  return solveCompiledSketchProgram(compileSketchSolveProgram(input));
}

export function solveSketchDefinitionWithDraggedPointTarget(input: {
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  dragTarget: SketchDraggedPointTarget;
  tolerances: SketchSolveTolerancePolicy;
  modelingTolerance: number;
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
  partialSolvePolicy: SolverPartialSolvePolicy;
  strategy?: SketchSolveStrategy;
  targetTolerance?: number;
}): SketchDraggedPointSolveResult {
  if (
    !input.definition.points.some(
      (point) => point.pointId === input.dragTarget.pointId,
    )
  ) {
    return {
      kind: "blocked",
      reason: "missingPoint",
      solvedSnapshot: null,
      diagnostics: [
        makeDiagnostic(
          "drag-target-missing-point",
          "error",
          `Dragged point ${input.dragTarget.pointId} does not exist in the sketch definition.`,
          { kind: "point", pointId: input.dragTarget.pointId },
        ),
      ],
    };
  }

  const program = compileSketchSolveProgram({
    definition: input.definition,
    projectedReferences: input.projectedReferences,
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
    partialSolvePolicy: input.partialSolvePolicy,
    strategy: input.strategy,
  });
  const session = createCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_stateless_drag",
    program,
  });
  const targetTolerance = input.targetTolerance ?? input.tolerances.coincidence;
  const interactive = updateCompiledSketchSolveSession(
    session,
    input.dragTarget,
    targetTolerance,
  );

  // The interactive session is the single authority for drag results
  // (minimum-motion-sketch-drag). It already returns `solved` for every
  // satisfiable sketch (sliding to the closest feasible position; a rigid
  // component translates as its minimum-motion solution) and reserves `blocked` for
  // non-convergent/invalid frames. No separate translation fallback with its own
  // acceptance model runs here — that invisible second mechanism was removed.
  return interactive;
}

export function validateSketchDefinitionCore(input: {
  definition: SketchDefinition;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  /** The document's settings.modelingTolerance ([TECH] G12). */
  modelingTolerance: number;
}): SketchCoreValidationResult {
  assertSolveModelingTolerance(input.modelingTolerance);
  const derived = evaluateSketchDerivations({
    definition: input.definition,
    modelingTolerance: input.modelingTolerance,
  });
  const validation = validateDefinition(
    derived.definition,
    input.tolerances,
    input.projectedReferences ?? [],
  );
  // T15b: a failed mirror (or unresolved) relationship is an explicit error.
  const derivationDiagnostics = [
    ...derived.diagnostics,
    ...derived.derivedFailures.map((failure) => failure.diagnostic),
  ];
  return {
    isValid:
      derivationDiagnostics.every((entry) => entry.severity !== "error") &&
      validation.isValid,
    diagnostics: [...derivationDiagnostics, ...validation.diagnostics],
  };
}

/**
 * T13d (D10): the `driven` status of each reference dimension measured at the
 * definition's authored positions, with the core solver's measurement and
 * conventions. The mock solver adapter (which does not solve) reports these
 * for parity.
 */
export function measureReferenceDimensionsAtAuthoredPositions(input: {
  definition: SketchDefinition;
  projectedReferences: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  modelingTolerance: number;
}): DimensionStatusRecord[] {
  const dimensions = input.definition.dimensions.filter((dimension) =>
    isReferenceDimension(dimension),
  );
  if (dimensions.length === 0) {
    return [];
  }
  const definition = { ...input.definition, dimensions };
  const system = buildSystem(definition, {
    projectedReferences: input.projectedReferences,
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
  });
  return buildDimensionStatuses(
    definition,
    system.pointRecords,
    system.entityStates,
    system.initialValues,
    new Map(),
    input.tolerances,
    input.projectedReferences,
  );
}
