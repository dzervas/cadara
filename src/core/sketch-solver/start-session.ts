import { evaluateLoss } from "./bfgs";
import { preconditionValuesForPointAnchors } from "./compile-program";
import { COINCIDENT_SPLINE_SPAN_CODE } from "./degenerate-spline-recovery";
import {
  classifySolvedConstrainedness,
  materializeSolveResult,
  offsetArcCommonCircleDiagnostics,
} from "./materialize-result";
import { solveProgramValuesPreferringAxes } from "./mirror-axis-preference";
import { seedSolveValuesFromSnapshot } from "./seed-solve-values";
import { SOLVED_LOSS_THRESHOLD } from "./solve-constants";
import {
  reevaluateProgramValues,
  solveWithRebuildRetry,
} from "./solve-program";
import type { SolvedSystemValues } from "./solve-strategies";
import { cloneValues, uniformNorm } from "./solver-geometry";
import type {
  SketchCompiledSolveProgram,
  SketchCompiledSolveSession,
} from "./system-types";
import { declaredJoinClasses } from "@/contracts/sketch/region-extraction";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";
import type {
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";

export function isAcceptableSolvedValues(
  program: SketchCompiledSolveProgram,
  solved: SolvedSystemValues,
) {
  return isAcceptableSolvedSnapshot(
    materializeSolveResult(program, solved.values, solved).solvedSnapshot,
  );
}

/**
 * T15b ([TECH] T-16, the G16‴-style start-state rule): the derived failure
 * diagnostics of a materialized snapshot whose relationships had all
 * already failed at its solve's start. They stay errors in the snapshot
 * (the sketch is invalid) but do not reject the solve or a drag frame. A
 * snapshot not materialized here (a persisted prior) tolerates none.
 */
export const startFailedDerivedDiagnostics = new WeakMap<
  SolvedSketchSnapshot,
  ReadonlySet<SketchSolveDiagnostic>
>();

/** Whether a materialized solve result carries an error the start-state rule does not tolerate. */
export function hasRejectingError(snapshot: SolvedSketchSnapshot) {
  const tolerated = startFailedDerivedDiagnostics.get(snapshot);
  return snapshot.diagnostics.some(
    (diagnostic) =>
      diagnostic.severity === "error" && !tolerated?.has(diagnostic),
  );
}

/**
 * T17c5: a drag program's start that would be acceptable but for the
 * coincident spans of its recovered splines, none of whose two ends a
 * declared join holds together (review R-2: the C4 join classes, i.e.
 * satisfied Coincidents, Coincidents to one datum or projected point,
 * shared ids). A solve keeps a joined pair only within its tolerance, which
 * the exact-zero span rule would read as separated.
 */
export function isDegenerateSplineSpanRecoveryStart(
  program: SketchCompiledSolveProgram,
  snapshot: SolvedSketchSnapshot,
) {
  const { splineIds, spanEnds } = program.degenerateSplineSpanRecovery;
  if (splineIds.size === 0) return false;
  const tolerated = startFailedDerivedDiagnostics.get(snapshot);
  const joins = declaredJoinClasses(program.definition, snapshot);
  return (
    spanEnds.every(
      ([first, second]) => joins.find(first) !== joins.find(second),
    ) &&
    snapshot.constraintStatuses.every((status) =>
      isAcceptedConstraintStatus(status.status),
    ) &&
    snapshot.dimensionStatuses.every(
      (status) => status.status !== "unsatisfied",
    ) &&
    snapshot.diagnostics.every(
      (diagnostic) =>
        diagnostic.severity !== "error" ||
        tolerated?.has(diagnostic) ||
        (diagnostic.code === COINCIDENT_SPLINE_SPAN_CODE &&
          diagnostic.target?.kind === "entity" &&
          splineIds.has(diagnostic.target.entityId)),
    )
  );
}

export function isAcceptableSolvedSnapshot(snapshot: SolvedSketchSnapshot) {
  return (
    snapshot.status.solveState !== "failed" &&
    snapshot.constraintStatuses.every((status) =>
      isAcceptedConstraintStatus(status.status),
    ) &&
    snapshot.dimensionStatuses.every(
      (status) => status.status !== "unsatisfied",
    ) &&
    !hasRejectingError(snapshot)
  );
}

export function hasOnlyFiniteNumericGeometry(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasOnlyFiniteNumericGeometry);
  if (value && typeof value === "object") {
    return Object.values(value).every(hasOnlyFiniteNumericGeometry);
  }
  return true;
}

export function solvedSnapshotStructurallyCoversProgram(
  snapshot: SolvedSketchSnapshot,
  program: SketchCompiledSolveProgram,
) {
  const solvedPoints = new Map(
    snapshot.solvedPoints.map((point) => [point.pointId, point]),
  );
  if (
    solvedPoints.size !== snapshot.solvedPoints.length ||
    !program.definition.points.every((point) => {
      const solved = solvedPoints.get(point.pointId);
      return solved && solved.solvedPosition.every(Number.isFinite);
    })
  ) {
    return false;
  }

  const solvedEntities = new Map(
    snapshot.solvedEntities.map((entity) => [entity.entityId, entity]),
  );
  if (
    solvedEntities.size !== snapshot.solvedEntities.length ||
    !program.definition.entities.every((entity) => {
      const solved = solvedEntities.get(entity.entityId);
      return (
        solved?.kind === entity.kind && hasOnlyFiniteNumericGeometry(solved)
      );
    })
  ) {
    return false;
  }

  const constraintStatuses = new Map(
    snapshot.constraintStatuses.map((status) => [status.constraintId, status]),
  );
  const dimensionStatuses = new Map(
    snapshot.dimensionStatuses.map((status) => [status.dimensionId, status]),
  );
  return (
    program.definition.constraints.every((constraint) =>
      isAcceptedConstraintStatus(
        constraintStatuses.get(constraint.constraintId)?.status ??
          "unsatisfied",
      ),
    ) &&
    program.definition.dimensions.every(
      (dimension) =>
        dimensionStatuses.get(dimension.dimensionId)?.status !== undefined &&
        dimensionStatuses.get(dimension.dimensionId)?.status !== "unsatisfied",
    )
  );
}

export function createCompiledSketchSolveSession(input: {
  sessionId: `interactive_sketch_solve_${string}`;
  program: SketchCompiledSolveProgram;
  priorSolvedSnapshot?: SolvedSketchSnapshot | null;
}): SketchCompiledSolveSession {
  const started = startCompiledSketchSolveSession(input);
  if (started.kind === "unacceptable") {
    throw new Error(
      `Cannot initialize ${input.sessionId} without ${
        started.commonCircle
          ? "a valid common-circle snapshot"
          : "an acceptable solved snapshot"
      }${
        started.diagnostic
          ? `: ${started.commonCircle ? "" : `${started.diagnostic.code}: `}${started.diagnostic.message}`
          : "."
      }`,
    );
  }
  return started.session;
}

/**
 * Non-throwing session start: an unacceptable start (neither the session's
 * own solve nor the prior snapshot is acceptable) is an expected state, e.g.
 * a drag pressed on a sketch with conflicting requirements (T12a, B14).
 */
export function startCompiledSketchSolveSession(input: {
  sessionId: `interactive_sketch_solve_${string}`;
  program: SketchCompiledSolveProgram;
  priorSolvedSnapshot?: SolvedSketchSnapshot | null;
}):
  | { kind: "started"; session: SketchCompiledSolveSession }
  | {
      kind: "unacceptable";
      commonCircle: boolean;
      diagnostic: SketchSolveDiagnostic | null;
    } {
  const seeded = seedSolveValuesFromSnapshot(
    input.program,
    input.priorSolvedSnapshot,
  );
  const initialValues = preconditionValuesForPointAnchors(
    input.program,
    seeded.values,
  );
  // [TECH] G16‴/G16⁗: the blocked set is decided on the session solve's
  // start, with one re-solve when a blocked offset builds at the end.
  const { solved: solvedValues, result: solved } = solveWithRebuildRetry({
    program: input.program,
    startValues: initialValues,
    solve: () => {
      const initialState = evaluateLoss(
        initialValues,
        input.program.system.scalarConstraints,
      );
      const initialCommonCircleValid =
        offsetArcCommonCircleDiagnostics(
          input.program,
          input.program.system.parameterProjection.projectValues(initialValues),
        ).length === 0;
      const initialCandidate =
        initialCommonCircleValid &&
        (initialState.loss < SOLVED_LOSS_THRESHOLD ||
          uniformNorm(initialState.gradient) < 1e-8)
          ? {
              values: cloneValues(initialValues),
              loss: initialState.loss,
              perConstraint: initialState.perConstraint,
            }
          : null;
      // Skip the solve only when the start already meets every
      // requirement; a low total loss can still leave one outside its
      // document tolerance.
      return initialCandidate &&
        isAcceptableSolvedValues(input.program, initialCandidate)
        ? {
            solved: initialCandidate,
            result: materializeSolveResult(
              input.program,
              initialCandidate.values,
              initialCandidate,
            ),
          }
        : solveProgramValuesPreferringAxes(input.program, initialValues);
    },
    retry: (from) => solveProgramValuesPreferringAxes(input.program, from),
    valuesOf: (candidate) => candidate.solved.values,
    reevaluate: (values) => reevaluateProgramValues(input.program, values),
    isAccepted: (candidate) =>
      isAcceptableSolvedSnapshot(candidate.result.solvedSnapshot),
  });
  classifySolvedConstrainedness(input.program, solvedValues.values, solved);
  const solvedIsAcceptable = isAcceptableSolvedSnapshot(solved.solvedSnapshot);
  const priorIsAcceptable =
    input.priorSolvedSnapshot !== null &&
    input.priorSolvedSnapshot !== undefined &&
    isAcceptableSolvedSnapshot(input.priorSolvedSnapshot) &&
    solvedSnapshotStructurallyCoversProgram(
      input.priorSolvedSnapshot,
      input.program,
    ) &&
    offsetArcCommonCircleDiagnostics(
      input.program,
      input.program.system.parameterProjection.projectValues(seeded.values),
    ).length === 0;
  // T17c5: a drag recovering a degenerate spline span starts from a solve
  // whose only rejecting errors are those spans (its snapshot keeps them
  // and its `failed` status); only frames that separate them are accepted.
  const recoveryStart =
    !solvedIsAcceptable &&
    !priorIsAcceptable &&
    isDegenerateSplineSpanRecoveryStart(input.program, solved.solvedSnapshot);
  if (!solvedIsAcceptable && !priorIsAcceptable && !recoveryStart) {
    const commonCircleDiagnostic = solved.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "offset-arc-common-circle-unsatisfied",
    );
    if (commonCircleDiagnostic) {
      return {
        kind: "unacceptable",
        commonCircle: true,
        diagnostic: commonCircleDiagnostic,
      };
    }
    return {
      kind: "unacceptable",
      commonCircle: false,
      diagnostic:
        solved.diagnostics.find(
          (diagnostic) => diagnostic.severity === "error",
        ) ?? null,
    };
  }
  const session: SketchCompiledSolveSession = {
    sessionId: input.sessionId,
    program: input.program,
    values: cloneValues(
      solvedIsAcceptable || recoveryStart ? solvedValues.values : seeded.values,
    ),
    lastAcceptedSnapshot:
      solvedIsAcceptable || recoveryStart
        ? solved.solvedSnapshot
        : input.priorSolvedSnapshot!,
    disposed: false,
    warmStarted: seeded.warmStarted,
  };
  return { kind: "started", session };
}
