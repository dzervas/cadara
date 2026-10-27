import {
  buildConstraintStatuses,
  lineExtensionLevers,
} from "./constraint-statuses";
import { recoveredSplineSpanDiagnostics } from "./degenerate-spline-recovery";
import { buildDimensionStatuses } from "./dimension-statuses";
import {
  blockedRequirementDiagnostics,
  offsetBlockedRequirements,
  offsetRelationshipDiagnostics,
  offsetRequirementStatus,
} from "./offset-requirements";
import { SOLVED_LOSS_THRESHOLD } from "./solve-constants";
import { solveSystemValues } from "./solve-strategies";
import { solverWorkTrace } from "./solve-tracing";
import type { SketchCoreSolveResult } from "./solve-types";
import { buildSolvedEntities } from "./solved-entities";
import {
  cloneValues,
  getPoint,
  length,
  makeDiagnostic,
  subtract,
  undefinedReferenceDimensionDiagnostics,
  unsatisfiedRequirementDiagnostics,
  zeroVector,
} from "./solver-geometry";
import { startFailedDerivedDiagnostics } from "./start-session";
import type { SketchCompiledSolveProgram } from "./system-types";
import {
  solvedOffsetFramePlans,
  solvedOffsetShellSpans,
} from "@/contracts/sketch/derived-geometry";
import { isOffsetPublicationSolveAccepted } from "@/contracts/sketch/offset-publication";
import {
  isAcceptedConstraintStatus,
  SOLVED_SKETCH_SCHEMA_VERSION,
} from "@/contracts/sketch/schema";
import type {
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
  SolvedSketchStatus,
} from "@/contracts/sketch/schema";

export function offsetArcCommonCircleDiagnostics(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
): SketchSolveDiagnostic[] {
  const offsetSeedEntityIds = new Set(
    (program.definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset" ? relationship.seedEntityIds : [],
    ),
  );
  const diagnostics: SketchSolveDiagnostic[] = [];

  for (const entity of program.definition.entities) {
    if (entity.kind !== "arc" || !offsetSeedEntityIds.has(entity.entityId)) {
      continue;
    }
    const center = program.system.pointRecords.get(entity.centerPointId);
    const start = program.system.pointRecords.get(entity.startPointId);
    const end = program.system.pointRecords.get(entity.endPointId);
    if (!center || !start || !end) continue;

    const centerPosition = getPoint(values, center);
    const startRadius = length(subtract(getPoint(values, start), centerPosition));
    const endRadius = length(subtract(getPoint(values, end), centerPosition));
    const radialGap = Math.abs(endRadius - startRadius);
    if (
      Number.isFinite(radialGap) &&
      radialGap <= program.tolerances.coincidence
    ) {
      continue;
    }

    diagnostics.push(
      makeDiagnostic(
        "offset-arc-common-circle-unsatisfied",
        "error",
        `Offset original ‘${entity.label}’ has endpoint radii ${startRadius} and ${endRadius}; radial gap ${radialGap} exceeds coincidence tolerance ${program.tolerances.coincidence}.`,
        { kind: "entity", entityId: entity.entityId },
      ),
    );
  }

  return diagnostics;
}

/** Numerical rank of raw geometric equations, not the vanishing squared-loss gradients. */
export function sketchHasFreeParameters(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
  result: SketchCoreSolveResult,
): boolean {
  if (solverWorkTrace) solverWorkTrace.constrainednessClassifications += 1;
  const blockedIds = new Set<string>([
    ...result.solvedSnapshot.constraintStatuses
      .filter((entry) => entry.status === "blocked")
      .map((entry) => entry.constraintId),
    ...result.solvedSnapshot.dimensionStatuses
      .filter((entry) => entry.status === "blocked")
      .map((entry) => entry.dimensionId),
  ]);
  for (const component of program.components) {
    const variables = component.variableIndices;
    const columns = new Map(variables.map((index, column) => [index, column]));
    const rows: Float64Array[] = [];
    for (const equationIndex of component.equationIndices) {
      const constraint = program.system.scalarConstraints[equationIndex]!;
      if (blockedIds.has(constraint.id)) continue;
      const evaluate = (at: Float64Array) => {
        if (solverWorkTrace) solverWorkTrace.componentResidualEvaluations += 1;
        return constraint.evaluateComponents(at);
      };
      const residuals = evaluate(values);
      const equationRows = residuals.map(() => zeroVector(variables.length));
      const support = program.equationMetadata[equationIndex]!.variableIndices;
      for (const index of support) {
        const column = columns.get(index);
        if (column === undefined) continue;
        const step =
          Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(values[index]!));
        const plus = cloneValues(values),
          minus = cloneValues(values);
        plus[index] += step;
        minus[index] -= step;
        const next = evaluate(plus),
          previous = evaluate(minus);
        for (let row = 0; row < residuals.length; row += 1)
          equationRows[row]![column] =
            (next[row]! - previous[row]!) / (2 * step);
      }
      // Scale each equation block together: independently normalizing a zero
      // component's roundoff would invent a constraint (e.g. point on a curve).
      const scale = Math.max(
        0,
        ...equationRows.map((row) => Math.hypot(...row)),
      );
      if (!Number.isFinite(scale)) return true;
      if (scale === 0) continue;
      for (const row of equationRows) {
        for (let column = 0; column < row.length; column += 1)
          row[column] /= scale;
        rows.push(row);
      }
    }
    if (rows.length < variables.length) return true;
    // Complete pivoting keeps the rank decision independent of equation/point
    // order. The threshold is dimensionless after equation-block normalization,
    // above central-difference roundoff, and does not change solve tolerances.
    const epsilon = 1e-7;
    for (let pivot = 0; pivot < variables.length; pivot += 1) {
      let bestRow = pivot,
        bestColumn = pivot,
        largest = 0;
      for (let row = pivot; row < rows.length; row += 1)
        for (let column = pivot; column < variables.length; column += 1) {
          const magnitude = Math.abs(rows[row]![column]!);
          if (magnitude > largest) {
            largest = magnitude;
            bestRow = row;
            bestColumn = column;
          }
        }
      if (largest <= epsilon) return true;
      [rows[pivot], rows[bestRow]] = [rows[bestRow]!, rows[pivot]!];
      for (const row of rows)
        [row[pivot], row[bestColumn]] = [row[bestColumn]!, row[pivot]!];
      for (let row = pivot + 1; row < rows.length; row += 1) {
        const factor = rows[row]![pivot]! / rows[pivot]![pivot]!;
        for (let column = pivot + 1; column < variables.length; column += 1)
          rows[row]![column] -= factor * rows[pivot]![column]!;
        rows[row]![pivot] = 0;
      }
    }
  }
  return false;
}

export function classifySolvedConstrainedness(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
  result: SketchCoreSolveResult,
) {
  if (result.status.solveState !== "solved") return;
  result.status.constraintState = sketchHasFreeParameters(
    program,
    values,
    result,
  )
    ? "underConstrained"
    : "wellConstrained";
}

export function materializeSolveResult(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
  solved: ReturnType<typeof solveSystemValues>,
): SketchCoreSolveResult {
  const projectionDiagnostics =
    program.system.parameterProjection.projectionDiagnostics(values);
  const definition = program.definition;
  const projectedValues =
    program.system.parameterProjection.projectValues(values);
  const commonCircleDiagnostics = offsetArcCommonCircleDiagnostics(
    program,
    projectedValues,
  );
  // The compile-time derivation diagnostics and the projection's (the same
  // derivations re-evaluated at `values`) repeat every unchanged entry once.
  const compiledDerivationDiagnostics = new Set(
    program.diagnostics.map((diagnostic) => JSON.stringify(diagnostic)),
  );
  const evaluation =
    program.system.parameterProjection.derivationEvaluation(values);
  // T15b ([TECH] T-8/T-16): one error per failed mirror (or unresolved)
  // relationship, always in the snapshot (the sketch is invalid, profiles
  // blocked); its outputs are held. Under the start-state rule a failure
  // already present at the solve's start (its blocked set) neither
  // invalidates the solve nor rejects it; one appearing during it does.
  const derivedFailures = evaluation?.derivedFailures ?? [];
  const derivedFailedDuringSolve = derivedFailures.some(
    (failure) =>
      !program.system.parameterProjection.failedAtSolveStart(
        failure.derivationId,
      ),
  );
  const diagnostics = [
    ...program.diagnostics,
    ...derivedFailures.map((failure) => failure.diagnostic),
    ...program.validation.diagnostics,
    ...projectionDiagnostics.filter(
      (diagnostic) =>
        !compiledDerivationDiagnostics.has(JSON.stringify(diagnostic)),
    ),
    ...commonCircleDiagnostics,
  ];
  const solvedEntities = buildSolvedEntities(
    definition,
    program.system.pointRecords,
    program.system.entityStates,
    program.system.splineTangentStates,
    projectedValues,
    evaluation ? solvedOffsetShellSpans(evaluation) : new Map(),
  );
  const hasOffsets = (definition.derivedRelationships ?? []).some(
    (relationship) => relationship.kind === "offset",
  );
  const solvedPoints = definition.points.flatMap((point) => {
    const record = program.system.pointRecords.get(point.pointId);
    return record
      ? [
          {
            pointId: point.pointId,
            target: point.target,
            solvedPosition: getPoint(projectedValues, record),
          },
        ]
      : [];
  });

  // [TECH] G16′: a requirement naming a failed relationship's outputs is
  // blocked ([TECH] G16″): status `blocked` with a targeted diagnostic,
  // but only when the relationship already failed at the solve's start
  // ([TECH] G16‴); one that failed during the solve is `unsatisfied`.
  const blocked = offsetBlockedRequirements(program, values);
  const levers = lineExtensionLevers(
    definition,
    program.system.pointRecords,
    program.system.entityStates,
    projectedValues,
    program.projectedReferences,
  );
  const constraintStatuses = buildConstraintStatuses(
    definition,
    program.system.pointRecords,
    program.system.entityStates,
    projectedValues,
    program.tolerances,
    solved.perConstraint,
    program.projectedReferences,
    levers,
  ).map((entry) => {
    const status = offsetRequirementStatus(blocked.get(entry.constraintId));
    return status ? { ...entry, status } : entry;
  });
  const dimensionStatuses = buildDimensionStatuses(
    definition,
    program.system.pointRecords,
    program.system.entityStates,
    projectedValues,
    solved.perConstraint,
    program.tolerances,
    program.projectedReferences,
    levers,
  ).map((entry) => {
    const status = offsetRequirementStatus(blocked.get(entry.dimensionId));
    return status ? { ...entry, status } : entry;
  });
  for (const constraint of definition.constraints) {
    if (
      !solved.perConstraint.has(constraint.constraintId) &&
      !blocked.has(constraint.constraintId) &&
      !diagnostics.some((entry) =>
        entry.severity === "error" && entry.target?.kind === "constraint" &&
        entry.target.constraintId === constraint.constraintId,
      )
    ) {
      diagnostics.push(makeDiagnostic(
        "unsupported-constraint-operands", "error",
        `‘${constraint.label}’ has an unsupported operand combination: no solver rows were admitted.`,
        { kind: "constraint", constraintId: constraint.constraintId },
      ));
    }
  }
  diagnostics.push(...blockedRequirementDiagnostics(definition, blocked));
  diagnostics.push(
    ...undefinedReferenceDimensionDiagnostics(definition, dimensionStatuses),
  );

  // B12: flag any solved circle whose radius ended up non-positive.
  const solvedGeometryDiagnostics: SketchSolveDiagnostic[] = [];
  for (const entity of solvedEntities) {
    if (entity.kind === "circle" && entity.solvedRadius <= 0) {
      solvedGeometryDiagnostics.push(
        makeDiagnostic(
          "invalid-solved-circle-radius",
          "error",
          `‘${definition.entities.find((candidate) => candidate.entityId === entity.entityId)?.label ?? "?"}’ solved to a non-positive radius (${entity.solvedRadius}).`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }
  // T13e2 (A2): a solved local line shorter than the minimum segment length
  // is degenerate geometry, as the authored-input check reads it. Offset
  // outputs are relationship-owned (their frame reports them, T10i).
  const offsetOutputLineIds = new Set(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? relationship.outputs.map((output) => output.outputEntityId)
        : [],
    ),
  );
  const authoredDegenerateLineIds = new Set(
    program.validation.diagnostics.flatMap((diagnostic) =>
      diagnostic.code === "degenerate-line-segment" &&
      diagnostic.target?.kind === "entity"
        ? [diagnostic.target.entityId]
        : [],
    ),
  );
  for (const entity of definition.entities) {
    if (
      entity.kind !== "lineSegment" ||
      offsetOutputLineIds.has(entity.entityId) ||
      authoredDegenerateLineIds.has(entity.entityId)
    )
      continue;
    const start = program.system.pointRecords.get(entity.startPointId);
    const end = program.system.pointRecords.get(entity.endPointId);
    if (!start || !end) continue;
    const solvedLength = length(
      subtract(
        getPoint(projectedValues, end),
        getPoint(projectedValues, start),
      ),
    );
    if (solvedLength < program.tolerances.minimumSegmentLength) {
      solvedGeometryDiagnostics.push(
        makeDiagnostic(
          "degenerate-solved-line-segment",
          "error",
          `‘${entity.label}’ solved to length ${solvedLength}, shorter than the minimum segment length tolerance.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }
  }
  solvedGeometryDiagnostics.push(
    ...recoveredSplineSpanDiagnostics(program, solvedEntities),
  );
  diagnostics.push(...solvedGeometryDiagnostics);

  const geometryValid =
    !derivedFailedDuringSolve &&
    ![
      ...projectionDiagnostics,
      ...commonCircleDiagnostics,
      ...solvedGeometryDiagnostics,
    ].some((diagnostic) => diagnostic.severity === "error");
  const requirementsSatisfied =
    geometryValid &&
    // [TECH] G16″: a blocked requirement does not count against the status.
    constraintStatuses.every((entry) =>
      isAcceptedConstraintStatus(entry.status),
    ) &&
    dimensionStatuses.every((entry) => entry.status !== "unsatisfied");

  let status: SolvedSketchStatus;
  if (
    !program.validation.isValid || !geometryValid ||
    diagnostics.some((entry) =>
      entry.code === "unsupported-constraint-operands" && entry.severity === "error",
    )
  ) {
    status = {
      solveState:
        program.partialSolvePolicy === "bestEffort"
          ? "partiallySolved"
          : "failed",
      constraintState: "inconsistent",
    };
  } else if (program.system.scalarConstraints.length === 0) {
    status = {
      solveState: definition.entities.length === 0 ? "notEvaluated" : "solved",
      constraintState:
        definition.entities.length === 0 ? "unknown" : "underConstrained",
    };
  } else if (Number.isFinite(solved.loss) && requirementsSatisfied) {
    // Every hard term is already judged against the document policy by the
    // statuses above; an absolute loss gate would override that policy.
    status = {
      solveState: "solved",
      // Final public results replace this provisional status with the component
      // Jacobian rank. Acceptance checks must not pay for constrainedness.
      constraintState: "underConstrained",
    };
  } else {
    if (!Number.isFinite(solved.loss) || solved.loss >= SOLVED_LOSS_THRESHOLD) {
      diagnostics.push(
        makeDiagnostic(
          "solver-residual-too-large",
          "warning",
          `Sketch solve ended with residual ${solved.loss}.`,
          null,
        ),
      );
    }
    if (!requirementsSatisfied) {
      const targeted = unsatisfiedRequirementDiagnostics(
        definition,
        constraintStatuses,
        dimensionStatuses,
      );
      diagnostics.push(
        ...(targeted.length > 0
          ? targeted
          : [
              makeDiagnostic(
                "solver-requirement-unsatisfied",
                "warning",
                "Sketch solve ended with one or more requirements outside their authored tolerance.",
                null,
              ),
            ]),
      );
    }
    status = {
      solveState:
        program.partialSolvePolicy === "bestEffort"
          ? "partiallySolved"
          : "failed",
      constraintState: "underConstrained",
    };
  }

  const solvedSnapshot: SolvedSketchSnapshot = {
    schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
    status,
    solvedEntities,
    solvedPoints,
    constraintStatuses,
    dimensionStatuses,
    diagnostics,
    ...(hasOffsets && evaluation
      ? { offsetFramePlans: solvedOffsetFramePlans(evaluation) }
      : {}),
    ...(derivedFailures.length > 0
      ? {
          failedDerivationIds: derivedFailures.map(
            (failure) => failure.derivationId,
          ),
          // T17d (B4, [TECH] T17-6): the reasons travel with the failure.
          failedDerivationReasons: Object.fromEntries(
            derivedFailures.map((failure) => [
              failure.derivationId,
              [...failure.reasons],
            ]),
          ),
        }
      : {}),
  };
  const tolerated = new Set<SketchSolveDiagnostic>(
    derivedFailedDuringSolve
      ? []
      : derivedFailures.map((failure) => failure.diagnostic),
  );
  // [TECH] G16′: each failed relationship's one diagnostic is
  // relationship-scoped. An accepted solve never carries it (G16: E1 reads
  // the snapshot); its publication reports it (the frame failure is
  // hint-independent, so publish reproduces it). An unaccepted solve
  // publishes nothing (U-G1), so the snapshot reports it instead.
  if (!isOffsetPublicationSolveAccepted(solvedSnapshot)) {
    // T15b (T-16): unaccepted only through tolerated derived failures, the
    // offset failures are reported but judged as in an accepted solve.
    const onlyTolerated =
      tolerated.size > 0 &&
      isOffsetPublicationSolveAccepted({
        ...solvedSnapshot,
        diagnostics: diagnostics.filter(
          (diagnostic) => !tolerated.has(diagnostic),
        ),
      });
    const offsetDiagnostics = offsetRelationshipDiagnostics(
      definition,
      evaluation,
    );
    diagnostics.push(...offsetDiagnostics);
    if (onlyTolerated)
      for (const diagnostic of offsetDiagnostics) tolerated.add(diagnostic);
  }
  if (tolerated.size > 0)
    startFailedDerivedDiagnostics.set(solvedSnapshot, tolerated);

  return {
    status,
    solvedSnapshot,
    diagnostics,
  };
}
