import type { ComponentJacobian } from "./automatic-differentiation";
import type { DegenerateSplineSpanRecovery } from "./degenerate-spline-recovery";
import type { SketchDragCurvature } from "./drag-candidates";
import type {
  SketchCoreValidationResult,
  SketchDraggedPointTarget,
  SketchSolveStrategy,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import type {
  ConstraintId,
  DimensionId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchDerivationEvaluationResult } from "@/contracts/sketch/derived-geometry";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedOffsetFramePlanRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceRecord,
  SolverPartialSolvePolicy,
} from "@/contracts/solver/schema";

export type PointState = {
  kind: "point";
  pointId: SketchPointId;
  label: string;
  baseIndex: number;
};

export type CircleState = {
  kind: "circle";
  entityId: SketchEntityId;
  baseIndex: number;
};

export type ArcState = {
  kind: "arc";
  entityId: SketchEntityId;
  baseIndex: number;
};

export type SplineTangentState = {
  kind: "splineTangent";
  entityId: SketchEntityId;
  occurrenceId: string;
  occurrenceIndex: number;
  baseIndex: number;
};

export type SolverEntityState = PointState | CircleState | ArcState;

export type ScalarConstraintEvaluation = {
  residual: number;
  gradient: Float64Array;
};

export type ScalarConstraintRecord = {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  evaluate(values: Float64Array): ScalarConstraintEvaluation;
  /** Unsquared geometric equations; unlike the loss gradient, these retain rank at satisfaction. */
  evaluateComponents(values: Float64Array): readonly number[];
  /**
   * cadara-p4r5.1: `evaluateComponents` with its analytic first-order
   * Jacobian (a piecewise component differentiates the branch active at
   * `values`). `evaluate` keeps the loss path; only the constrained drag
   * step (`SketchDragStep`, cadara-p4r5.2) reads it.
   */
  evaluateComponentJacobian(values: Float64Array): ComponentJacobian;
  /**
   * cadara-p4r5.1: the components that are arc-sweep hinges (0 inside the
   * sweep). `BuildSystemResult.inequalities` states each one explicitly.
   */
  hingeComponentIndices?: readonly number[];
  /**
   * The variables of an internal record (no authored constraint or
   * dimension to derive them from structurally). Without it the record is
   * projected on every evaluation and its support is found by perturbation,
   * one full derivation evaluation per variable.
   */
  structuralVariableIndices?: readonly number[];
  /**
   * [TECH] G16′/G16‴: the offset relationships whose outputs this
   * requirement names and that do not evaluate normally at `values` (see
   * `OffsetRequirementBlocker`). Absent when the requirement names no offset
   * output.
   */
  offsetBlockers?(values: Float64Array): readonly OffsetRequirementBlocker[];
};

/**
 * One offset relationship affecting a requirement at an iterate.
 * - `failed` ([TECH] G16′/G16‴/G16⁗): it is in the solve's blocked set (it
 *   failed at the solve's start state); the requirement is held blocked for
 *   the whole solve (residual 0, gradient 0), even at iterates where the
 *   relationship builds, and reported `blocked` when it still fails at the
 *   end (never silently satisfied). One that builds at the end is
 *   re-evaluated and re-solved once (`solveWithRebuildRetry`).
 * - `failedDuringSolve` ([TECH] G16‴): it built at the start but fails
 *   here; the requirement is unbounded (`+∞`, never a reward) and, if that
 *   holds at the final values, reported `unsatisfied`.
 * - `derivativeUnavailable` (review R1): the frame built but the pullback is
 *   singular; the requirement keeps its real residual, only its gradient
 *   through the offset is dropped, and it carries a targeted warning.
 */
export type OffsetRequirementBlocker = NonNullable<
  ComponentJacobian["unavailable"]
>[number];

export type ConstraintEvaluationRecord = {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  residual: number;
  gradient: Float64Array;
};

export type SolverPointRecord = {
  pointId: SketchPointId;
  initial: SketchPoint2D;
  baseIndex: number;
};

export type SolverParameterProjection = {
  projectValues(values: Float64Array): Float64Array;
  projectionDiagnostics(values: Float64Array): readonly SketchSolveDiagnostic[];
  /** The derivation evaluation of one iterate (null without derived relationships). */
  derivationEvaluation(
    values: Float64Array,
  ): SketchDerivationEvaluationResult | null;
  projectVariableIndices(variableIndices: readonly number[]): number[];
  authorityVariableIndices: readonly number[];
  wrapConstraint(
    constraint: ScalarConstraintRecord,
    variableIndices?: readonly number[],
  ): ScalarConstraintRecord;
  /**
   * cadara-p4r5.1: a component Jacobian on projected values, pulled back onto
   * the authority variables (as `wrapConstraint` pulls back a gradient).
   */
  wrapComponentJacobian(
    evaluate: (values: Float64Array) => ComponentJacobian,
    variableIndices?: readonly number[],
  ): (values: Float64Array) => ComponentJacobian;
  /**
   * [TECH] G16‴ + T15b (T-16): the relationships failing at `values`: the
   * offset failures and the derived (mirror, unresolved) failures.
   */
  relationshipFailuresAt(values: Float64Array): ReadonlySet<string>;
  /**
   * [TECH] G16‴/G16⁗: runs one solve whose blocked set is `blocked` (the
   * relationships failing at its start state, see
   * `solveWithRebuildRetry`); it is decided once, never per iterate.
   * Outside any solve it is empty.
   */
  withBlockedRelationships<T>(blocked: ReadonlySet<string>, run: () => T): T;
  /**
   * [TECH] G16‴/G16⁗: whether `derivationId` is in the current solve's
   * blocked set: the failures at the solve's start, or, in the one
   * re-solve of `solveWithRebuildRetry`, F \ R (not the re-solve's own
   * start failures). The name predates the re-solve.
   */
  failedAtSolveStart(derivationId: string): boolean;
};

export type BuildSystemResult = {
  parameterCount: number;
  initialValues: Float64Array;
  pointRecords: Map<SketchPointId, SolverPointRecord>;
  entityStates: Map<SketchEntityId, SolverEntityState>;
  splineTangentStates: Map<string, SplineTangentState>;
  parameterProjection: SolverParameterProjection;
  scalarConstraints: ScalarConstraintRecord[];
  /** Per derived shell: the variables of its owning offset's seeds (its curve's support). */
  shellSourceVariables: ReadonlyMap<SketchEntityId, readonly number[]>;
  /** cadara-p4r5.1: explicit inequalities g(x) ≥ 0, data only (no solve enforces them). */
  inequalities: readonly SolverInequalityRecord[];
  /**
   * cadara-p4r5.1: first-order line↔arc tangency rows. cadara-p4r5.2: a
   * start-contact row is also component 0 of its requirement's loss.
   */
  orientedTangencies: readonly SolverOrientedTangencyRecord[];
};

/**
 * cadara-p4r5.1: one explicit inequality g(x) ≥ 0 with its analytic gradient
 * (`evaluate` returns one component). Data only: no solve reads it yet.
 * - `segmentLength`: |end − start| − τ of a line segment;
 * - `radius`: r − τ of a circle or arc (a point-defined arc's radius is its
 *   driven slot, |start − centre|, through the projection);
 * - `arcSweepStart` / `arcSweepEnd`: a requirement's contact point inside
 *   its arc's sweep (`arcSweepMarginsDual`), the explicit form of that
 *   requirement's hinge component `requirement.componentIndex`. Where the
 *   contact cannot be located (a degenerate line or arc) the margin and its
 *   gradient are NaN: undefined, never an active constraint with a zero
 *   gradient.
 * τ is the document's modeling tolerance. A row reading a failed or
 * singular derived relationship carries `unavailable` (see
 * `ComponentJacobian`).
 */
/**
 * cadara-p4r5.1: the first-order form of a line↔arc tangency. For a tangent between a line
 * and a point-defined arc (an offset seed) whose contact is an arc endpoint
 * s at a line endpoint (the same point id, or joined by coincident
 * constraints), the component is (s − c)·u, with c the arc centre and u the
 * line's unit direction. With s on the line and r = |s − c|,
 * r² = d² + ((s − c)·u)², so it is zero exactly where the requirement's
 * |d| − r is. r = |s − c| holds identically when s is the arc start (it
 * defines a point-defined arc's radius): there |d| − r ≈ −((s − c)·u)²/(2r)
 * is second order (so is σ·d − r, since σ·d ≤ |d| ≤ r) and only this row
 * keeps rank. At the arc end it holds through the internal common-radius
 * row, and |d| − r is already first order.
 * cadara-p4r5.2: so a start-contact record's component is also component 0
 * of its requirement's loss (bitwise); an end-contact record stays data
 * only (on T18 swapping it would move the accepted state by about 2e-3).
 */
export type SolverOrientedTangencyRecord = {
  id: string;
  /** The tangent constraint whose component 0 (|d| − r) it restates. */
  requirementId: ConstraintId;
  arcEntityId: SketchEntityId;
  /** The arc endpoint s. */
  contactPointId: SketchPointId;
  /** The authority variables it reads. */
  variableIndices: readonly number[];
  evaluate(values: Float64Array): ComponentJacobian;
};

export type SolverInequalityRecord = {
  id: string;
  kind: "segmentLength" | "radius" | "arcSweepStart" | "arcSweepEnd";
  /** The entity whose validity it states, or the arc of a sweep margin (local or projected). */
  entityId: SketchEntityId | null;
  requirement?: { id: ConstraintId | DimensionId; componentIndex: number };
  /** The authority variables it reads. */
  variableIndices: readonly number[];
  evaluate(values: Float64Array): ComponentJacobian;
};

export interface BuildSystemOptions {
  dragTarget?: SketchDraggedPointTarget | null;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  /** The document's settings.modelingTolerance ([TECH] G12): offset solve frames need τ. */
  modelingTolerance: number;
  /** [TECH] G3/G17 offset plan hints, passed to every solve frame unchanged. */
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
}

export interface SketchCompiledSolveComponent {
  componentId: number;
  variableIndices: readonly number[];
  equationIndices: readonly number[];
  pointIds: readonly SketchPointId[];
  entityIds: readonly SketchEntityId[];
}

export interface SketchCompiledEquationMetadata {
  equationIndex: number;
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  variableIndices: readonly number[];
  componentId: number;
}

export interface SketchCompiledSolveProgram {
  programId: `compiled_sketch_solve_${string}`;
  compatibilityKey: string;
  definition: SketchDefinition;
  projectedReferences: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  /** The document's settings.modelingTolerance ([TECH] G12). */
  modelingTolerance: number;
  /** The offset plan hints this program's solve frames run ([TECH] G3/G17). */
  offsetPlans: readonly SolvedOffsetFramePlanRecord[] | undefined;
  partialSolvePolicy: SolverPartialSolvePolicy;
  strategy: SketchSolveStrategy;
  /**
   * cadara-p4r5.2: set (to "constrained") only when the drag step is not the
   * default "penalty" (`SketchDragStep`).
   */
  dragStep?: "constrained";
  diagnostics: readonly SketchSolveDiagnostic[];
  validation: SketchCoreValidationResult;
  /**
   * T17c5: the splines whose coincident-span check is judged at each
   * solve's values instead of in `validation` (a drag's recovery).
   */
  degenerateSplineSpanRecovery: DegenerateSplineSpanRecovery;
  system: BuildSystemResult;
  components: readonly SketchCompiledSolveComponent[];
  equationMetadata: readonly SketchCompiledEquationMetadata[];
}

export interface SketchCompiledSolveSession {
  sessionId: `interactive_sketch_solve_${string}`;
  program: SketchCompiledSolveProgram;
  values: Float64Array;
  lastAcceptedSnapshot: SolvedSketchSnapshot;
  disposed: boolean;
  warmStarted: boolean;
  /** T13a2 (c3): the last accepted drag frame's curvature estimate. */
  dragCurvature?: SketchDragCurvature;
  /** T13a2 (review R-1): the last accepted point-drag frame's target. */
  lastPointDragTarget?: SketchDraggedPointTarget;
}
