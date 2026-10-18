import type {
  ConstraintDefinition,
  ConstraintStatusRecord,
  NumericDimensionDefinition as DimensionDefinition,
  DimensionDefinition as AuthoredDimensionDefinition,
  DimensionStatusRecord,
  LocalCollinearTargetOperand,
  ProjectedSketchGeometryRef,
  NumericSketchDefinition as SketchDefinition,
  SketchCurveConstraintOperand,
  NumericSketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPointConstraintOperand,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedOffsetFramePlanRecord,
  SolvedSketchDerivedCubicSpan,
  SolvedSketchEntityGeometryRecord,
  SolvedSketchSnapshot,
  SolvedSketchStatus,
} from "@/contracts/sketch/schema";
import {
  isAcceptedConstraintStatus,
  isReferenceDimension,
  SOLVED_SKETCH_SCHEMA_VERSION,
} from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivations,
  offsetRecordDerivatives,
  pointDefinedArcVariables,
  prepareSketchDerivationPullback,
  solvedOffsetFramePlans,
  solvedOffsetShellSpans,
  type SketchDerivationEvaluationResult,
  type SketchDerivationVariation,
  type SketchDerivedEntityVariation,
} from "@/contracts/sketch/derived-geometry";
import { offsetFrameCurveResidual } from "@/contracts/sketch/offset-derivation-frame";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import { isOffsetPublicationSolveAccepted } from "@/contracts/sketch/offset-publication";
import { declaredJoinClasses } from "@/contracts/sketch/region-extraction";
import {
  closestSplineSpanLocation,
  evaluateSplineSpan,
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
  SolverPartialSolvePolicy,
} from "@/contracts/solver/schema";
import type {
  ConstraintId,
  DimensionId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";

export interface SketchSolveTolerancePolicy {
  coincidence: number;
  angleRadians: number;
  minimumSegmentLength: number;
}

export interface SketchCoreSolveResult {
  status: SolvedSketchStatus;
  solvedSnapshot: SolvedSketchSnapshot;
  diagnostics: SketchSolveDiagnostic[];
}

export type SketchSolveStrategy =
  | "bfgs"
  /**
   * T13e (D11 as amended by review B-1): the BFGS stage of "bfgs" without its
   * Gauss–Newton fallback. Only the redundancy probe's trials use it; the
   * acceptance check and the rebuild retry are unchanged.
   */
  | "bfgsWithoutFallback"
  | "gradientDescent"
  | "gaussNewton"
  | "levenbergMarquardt";

export interface SketchDraggedPointTarget {
  kind: "sketchPoint";
  pointId: SketchPointId;
  position: SketchPoint2D;
}

export interface SketchDragTranslateTarget {
  kind: "sketchTranslate";
  pointIds: readonly SketchPointId[];
  delta: SketchPoint2D;
}

export interface SketchDragRadiusTarget {
  kind: "sketchRadius";
  entityId: SketchEntityId;
  targetRadius: number;
}

export interface SketchDragTangentVectorTarget {
  kind: "sketchTangentVector";
  entityId: SketchEntityId;
  occurrenceId: string;
  targetVector: SketchPoint2D;
  /**
   * When true, store the vector as exactly [0, 0] regardless of the soft
   * target's achieved value. The solver fixes both tangent variables at 0
   * for this frame. A later frame with exactZero=false and a non-zero
   * target leaves zero continuously through substeps.
   */
  exactZero?: boolean;
}

export type SketchDragTarget =
  | SketchDraggedPointTarget
  | SketchDragTranslateTarget
  | SketchDragRadiusTarget
  | SketchDragTangentVectorTarget;

export type SketchDraggedPointSolveResult =
  | {
      kind: "solved";
      solvedSnapshot: SolvedSketchSnapshot;
      diagnostics: SketchSolveDiagnostic[];
    }
  | {
      kind: "blocked";
      reason: "missingPoint" | "unsatisfied" | "nonConvergent" | "staleSession";
      solvedSnapshot: SolvedSketchSnapshot | null;
      diagnostics: SketchSolveDiagnostic[];
    };

export interface SketchCoreValidationResult {
  isValid: boolean;
  diagnostics: SketchSolveDiagnostic[];
}

export interface SketchScalarConstraintEvaluationForTest {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  residual: number;
  gradient: Float64Array;
}

type PointState = {
  kind: "point";
  pointId: SketchPointId;
  label: string;
  baseIndex: number;
};

type CircleState = {
  kind: "circle";
  entityId: SketchEntityId;
  baseIndex: number;
};

type ArcState = {
  kind: "arc";
  entityId: SketchEntityId;
  baseIndex: number;
};

type SplineTangentState = {
  kind: "splineTangent";
  entityId: SketchEntityId;
  occurrenceId: string;
  occurrenceIndex: number;
  baseIndex: number;
};

type SolverEntityState = PointState | CircleState | ArcState;

type ScalarConstraintEvaluation = {
  residual: number;
  gradient: Float64Array;
};

type ScalarConstraintRecord = {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  evaluate(values: Float64Array): ScalarConstraintEvaluation;
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
type OffsetRequirementBlocker = {
  derivationId: string;
  reason: "failed" | "failedDuringSolve" | "derivativeUnavailable";
};

type ConstraintEvaluationRecord = {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  residual: number;
  gradient: Float64Array;
};

type SolverPointRecord = {
  pointId: SketchPointId;
  initial: SketchPoint2D;
  baseIndex: number;
};

type SolverParameterProjection = {
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

type BuildSystemResult = {
  parameterCount: number;
  initialValues: Float64Array;
  pointRecords: Map<SketchPointId, SolverPointRecord>;
  entityStates: Map<SketchEntityId, SolverEntityState>;
  splineTangentStates: Map<string, SplineTangentState>;
  parameterProjection: SolverParameterProjection;
  scalarConstraints: ScalarConstraintRecord[];
  /** Per derived shell: the variables of its owning offset's seeds (its curve's support). */
  shellSourceVariables: ReadonlyMap<SketchEntityId, readonly number[]>;
};

interface BuildSystemOptions {
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

const WOLFE_C1 = 1e-4;
const WOLFE_C2 = 0.9;
const LINE_SEARCH_MAX_ITERATIONS = 15;
const SOLVED_LOSS_THRESHOLD = 1e-8;
const BFGS_MIN_LOSS = 1e-12;
const DEGENERATE_NORM_EPSILON = 1e-6;
const EQUATION_SUPPORT_PERTURBATION = 1e-3;
const EQUATION_SUPPORT_LOSS_EPSILON = 1e-18;
// Interactive drag tuning (minimum-motion-sketch-drag).
// DRAG_MINIMUM_MOTION_EPSILON is the uniform previous-frame anchoring weight
// (policy 1); it must stay far below the drag-target weight so a reachable
// cursor is still reached, while remaining large enough to break under-
// constrained null spaces. DRAG_* substep bounds keep large per-frame cursor
// deltas continuous by subdividing them (D3) instead of teleporting past
// singularities, with the last accepted frame as the lag fallback.
const DRAG_MINIMUM_MOTION_EPSILON = 1e-6;
// The soft cursor objective is weighted BELOW the hard constraints (weight 1) so
// that authored constraints keep geometry on their manifold during a drag frame
// (it slides along remaining DOF) instead of being pulled off it or through a
// singularity, while staying far above the minimum-motion epsilon so a reachable
// cursor is still reached.
const DRAG_TARGET_WEIGHT = 1e-2;
const DRAG_MAX_SUBSTEPS = 8;
const DRAG_SUBSTEP_LIMIT = 4;

function cloneValues(values: Float64Array) {
  return new Float64Array(values);
}

function makeDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic["severity"],
  message: string,
  target: SketchSolveDiagnostic["target"],
): SketchSolveDiagnostic {
  return { code, severity, message, target };
}

/**
 * T13c (D7): one `solver-requirement-unsatisfied` warning per requirement
 * whose status is `unsatisfied`, targeted at that constraint or dimension, so
 * the reason is geometry-linked and recomputed with every solve (incl. after
 * reopen). Shared with the mock solver adapter (A-7 parity).
 */
export function unsatisfiedRequirementDiagnostics(
  definition: Pick<SketchDefinition, "constraints" | "dimensions">,
  constraintStatuses: readonly ConstraintStatusRecord[],
  dimensionStatuses: readonly DimensionStatusRecord[],
): SketchSolveDiagnostic[] {
  const constraintLabels = new Map(
    definition.constraints.map((constraint) => [
      constraint.constraintId,
      constraint.label,
    ]),
  );
  const dimensionLabels = new Map(
    definition.dimensions.map((dimension) => [
      dimension.dimensionId,
      dimension.label,
    ]),
  );
  return [
    ...constraintStatuses.flatMap((entry) =>
      entry.status === "unsatisfied"
        ? [
            makeDiagnostic(
              "solver-requirement-unsatisfied",
              "warning",
              `${constraintLabels.get(entry.constraintId) ?? entry.constraintId} is not satisfied within its authored tolerance.`,
              { kind: "constraint", constraintId: entry.constraintId },
            ),
          ]
        : [],
    ),
    ...dimensionStatuses.flatMap((entry) =>
      entry.status === "unsatisfied"
        ? [
            makeDiagnostic(
              "solver-requirement-unsatisfied",
              "warning",
              `${dimensionLabels.get(entry.dimensionId) ?? entry.dimensionId} is not satisfied within its authored tolerance.`,
              { kind: "dimension", dimensionId: entry.dimensionId },
            ),
          ]
        : [],
    ),
  ];
}

/**
 * T13d (D9): a driving dimension's numeric value (references never reach
 * here; the binding kinds have none). A driving dimension without one breaks
 * the validated contract, so it throws instead of solving with NaN.
 */
function getDrivingDimensionValue(dimension: DimensionDefinition): number {
  if (
    dimension.kind === "arcStartPointCoincident" ||
    dimension.kind === "arcEndPointCoincident"
  ) {
    return 0;
  }
  // T17p2 (F-2): a reference keeps its authored (unresolved) value.
  if (isReferenceDimension(dimension)) {
    throw new Error(
      `Reference dimension ${dimension.dimensionId} has no driving value.`,
    );
  }
  const value =
    "valueRadians" in dimension
      ? dimension.valueRadians
      : "value" in dimension
        ? dimension.value
        : undefined;
  if (value === undefined) {
    throw new Error(`Driving dimension ${dimension.dimensionId} has no value.`);
  }
  return value;
}

/**
 * T13d (D10): one info diagnostic per reference dimension whose measured
 * quantity is undefined (e.g. a line distance between non-parallel lines).
 * Never a warning or error: a reference never counts against the solve.
 * Shared with the mock solver adapter (parity).
 */
export function undefinedReferenceDimensionDiagnostics(
  definition: Pick<SketchDefinition, "dimensions">,
  dimensionStatuses: readonly DimensionStatusRecord[],
): SketchSolveDiagnostic[] {
  const labels = new Map(
    definition.dimensions.map((dimension) => [
      dimension.dimensionId,
      dimension.label,
    ]),
  );
  return dimensionStatuses.flatMap((entry) =>
    entry.status === "driven" && entry.solvedValue === null
      ? [
          makeDiagnostic(
            "reference-dimension-undefined",
            "info",
            `${labels.get(entry.dimensionId) ?? entry.dimensionId} has no measurable value for its current geometry.`,
            { kind: "dimension", dimensionId: entry.dimensionId },
          ),
        ]
      : [],
  );
}

function zeroVector(length: number) {
  return new Float64Array(length);
}

// Scalar residuals are half-squared errors (0.5·r²), so this is |r| ≤ tolerance.
function isConstraintResidualWithinTolerance(
  residual: number,
  tolerance: number,
) {
  return residual <= 0.5 * tolerance * tolerance;
}

function addScaled(target: Float64Array, scale: number, source: Float64Array) {
  for (let index = 0; index < target.length; index += 1) {
    target[index] += scale * source[index]!;
  }
}

function dot(left: Float64Array, right: Float64Array) {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) {
    value += left[index]! * right[index]!;
  }
  return value;
}

function halfSquaredDistanceWithSaturation(distanceSquared: number) {
  if (distanceSquared === 0 || !Number.isFinite(distanceSquared)) {
    return 0.5 * distanceSquared;
  }
  return Math.max(Number.MIN_VALUE, 0.5 * distanceSquared);
}

function euclideanNorm(values: Float64Array) {
  return Math.sqrt(dot(values, values));
}

function uniformNorm(values: Float64Array) {
  let value = 0;
  for (let index = 0; index < values.length; index += 1) {
    value = Math.max(value, Math.abs(values[index]!));
  }
  return value;
}

function getPoint(
  values: Float64Array,
  point: SolverPointRecord,
): SketchPoint2D {
  return [values[point.baseIndex]!, values[point.baseIndex + 1]!] as const;
}

function getArcParameters(values: Float64Array, arc: ArcState) {
  return {
    radius: values[arc.baseIndex]!,
    startAngle: values[arc.baseIndex + 1]!,
    endAngle: values[arc.baseIndex + 2]!,
  };
}

function getCircleRadius(values: Float64Array, circle: CircleState) {
  return values[circle.baseIndex]!;
}

function subtract(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]];
}

function add(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]];
}

function length(point: SketchPoint2D) {
  return Math.hypot(point[0], point[1]);
}

function dot2(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[0] + left[1] * right[1];
}

function addPointGradient(
  gradient: Float64Array,
  point: SolverPointRecord,
  x: number,
  y: number,
) {
  gradient[point.baseIndex] += x;
  gradient[point.baseIndex + 1] += y;
}

function projectedKindForConstraintRef(
  kind: NonNullable<ProjectedSketchGeometryRef["kind"]>,
) {
  switch (kind) {
    case "projectedPoint":
      return "point";
    case "projectedLineSegment":
      return "lineSegment";
    case "projectedCircle":
      return "circle";
    case "projectedArc":
      return "arc";
    case "projectedSpline":
      return "spline";
  }
}

function findProjectedGeometry(
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  reference: ProjectedSketchGeometryRef & {
    kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
  },
): ProjectedSketchReferenceGeometry | null {
  const projectedReference = projectedReferences.find(
    (entry) => entry.referenceId === reference.referenceId,
  );

  if (!projectedReference || projectedReference.status !== "projected") {
    return null;
  }

  const expectedKind = projectedKindForConstraintRef(reference.kind);
  return (
    projectedReference.geometry.find(
      (geometry) =>
        geometry.geometryId === reference.geometryId &&
        geometry.kind === expectedKind,
    ) ?? null
  );
}

function resolveSketchDatumPoint(
  datum: "origin" | "xAxis" | "yAxis",
): SketchPoint2D | null {
  return datum === "origin" ? [0, 0] : null;
}

function resolveSketchDatumLine(
  datum: "origin" | "xAxis" | "yAxis",
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  switch (datum) {
    case "xAxis":
      return { start: [-1, 0], end: [1, 0] };
    case "yAxis":
      return { start: [0, -1], end: [0, 1] };
    case "origin":
      return null;
  }
}

function projectedCircleLikeGeometry(
  geometry: ProjectedSketchReferenceGeometry,
): { center: SketchPoint2D; radius: number } | null {
  if (geometry.kind === "circle") {
    return { center: geometry.centerPosition, radius: geometry.radius };
  }

  if (geometry.kind === "arc") {
    return {
      center: geometry.centerPosition,
      radius: length(subtract(geometry.startPosition, geometry.centerPosition)),
    };
  }

  return null;
}

function normalizeAngleRadians(angle: number) {
  const fullTurn = Math.PI * 2;
  return ((angle % fullTurn) + fullTurn) % fullTurn;
}

function arcSweepOffset(
  angle: number,
  startAngle: number,
  direction: Extract<
    ProjectedSketchReferenceGeometry,
    { kind: "arc" }
  >["sweepDirection"],
) {
  return direction === "counterClockwise"
    ? normalizeAngleRadians(angle - startAngle)
    : normalizeAngleRadians(startAngle - angle);
}

function projectedArcData(
  geometry: Extract<ProjectedSketchReferenceGeometry, { kind: "arc" }>,
) {
  const startOffset = subtract(geometry.startPosition, geometry.centerPosition);
  const endOffset = subtract(geometry.endPosition, geometry.centerPosition);
  const radius = length(startOffset);
  const startAngle = Math.atan2(startOffset[1], startOffset[0]);
  const endAngle = Math.atan2(endOffset[1], endOffset[0]);
  const sweep = arcSweepOffset(endAngle, startAngle, geometry.sweepDirection);

  return {
    center: geometry.centerPosition,
    radius,
    startAngle,
    endAngle,
    sweep,
    sweepDirection: geometry.sweepDirection,
    startPosition: geometry.startPosition,
    endPosition: geometry.endPosition,
  };
}

function isAngleOnProjectedArc(
  angle: number,
  arc: ReturnType<typeof projectedArcData>,
) {
  return (
    arcSweepOffset(angle, arc.startAngle, arc.sweepDirection) <=
    arc.sweep + 1e-9
  );
}

function nearestPointOnProjectedArcSweep(
  point: SketchPoint2D,
  arc: ReturnType<typeof projectedArcData>,
): SketchPoint2D {
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnProjectedArc(angle, arc)) {
    return [
      arc.center[0] + Math.cos(angle) * arc.radius,
      arc.center[1] + Math.sin(angle) * arc.radius,
    ];
  }

  return length(subtract(point, arc.startPosition)) <=
    length(subtract(point, arc.endPosition))
    ? arc.startPosition
    : arc.endPosition;
}

function pointProjectedArcDistance(
  point: SketchPoint2D,
  geometry: Extract<ProjectedSketchReferenceGeometry, { kind: "arc" }>,
) {
  const arc = projectedArcData(geometry);
  return length(subtract(point, nearestPointOnProjectedArcSweep(point, arc)));
}

function projectedArcSweepViolation(
  point: SketchPoint2D,
  geometry: Extract<ProjectedSketchReferenceGeometry, { kind: "arc" }>,
) {
  const arc = projectedArcData(geometry);
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnProjectedArc(angle, arc)) {
    return 0;
  }

  const circlePoint: SketchPoint2D = [
    arc.center[0] + Math.cos(angle) * arc.radius,
    arc.center[1] + Math.sin(angle) * arc.radius,
  ];
  return Math.min(
    length(subtract(circlePoint, arc.startPosition)),
    length(subtract(circlePoint, arc.endPosition)),
  );
}

function unitVector(
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D | null {
  const delta = subtract(end, start);
  const norm = length(delta);

  return norm < DEGENERATE_NORM_EPSILON
    ? null
    : [delta[0] / norm, delta[1] / norm];
}

// Sine of the angle between a line and the radial direction at the contact.
function lineNormalDirectionResidual(
  lineStart: SketchPoint2D,
  lineEnd: SketchPoint2D,
  contactPoint: SketchPoint2D,
  center: SketchPoint2D,
) {
  const lineUnit = unitVector(lineStart, lineEnd);
  const radialUnit = unitVector(center, contactPoint);
  if (!lineUnit || !radialUnit) {
    return 0;
  }

  return lineUnit[0] * radialUnit[1] - lineUnit[1] * radialUnit[0];
}

function pointLineSignedDistance(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
) {
  const unit = unitVector(start, end);

  if (!unit) {
    return 0;
  }

  const delta = subtract(point, start);
  return delta[0] * unit[1] - delta[1] * unit[0];
}

function lineParallelResidual(
  firstStart: SketchPoint2D,
  firstEnd: SketchPoint2D,
  secondStart: SketchPoint2D,
  secondEnd: SketchPoint2D,
) {
  const firstUnit = unitVector(firstStart, firstEnd);
  const secondUnit = unitVector(secondStart, secondEnd);

  if (!firstUnit || !secondUnit) {
    return Number.POSITIVE_INFINITY;
  }

  return firstUnit[0] * secondUnit[1] - firstUnit[1] * secondUnit[0];
}

/**
 * Line-distance prerequisite: both operands are parallel (or antiparallel)
 * within the policy's angular tolerance. Degenerate operands never qualify.
 */
function linesParallelWithinTolerance(
  first: { start: SketchPoint2D; end: SketchPoint2D },
  second: { start: SketchPoint2D; end: SketchPoint2D },
  tolerance: SketchSolveTolerancePolicy,
) {
  const residual = lineParallelResidual(
    first.start,
    first.end,
    second.start,
    second.end,
  );
  return (
    Number.isFinite(residual) &&
    Math.asin(Math.min(1, Math.abs(residual))) <= tolerance.angleRadians
  );
}

function lineAngleRadians(
  firstStart: SketchPoint2D,
  firstEnd: SketchPoint2D,
  secondStart: SketchPoint2D,
  secondEnd: SketchPoint2D,
) {
  const firstDelta = subtract(firstEnd, firstStart);
  const secondDelta = subtract(secondEnd, secondStart);
  const denominator =
    firstDelta[0] * secondDelta[1] - firstDelta[1] * secondDelta[0];
  const center: SketchPoint2D | null =
    Math.abs(denominator) <= DEGENERATE_NORM_EPSILON
      ? null
      : (() => {
          const delta = subtract(secondStart, firstStart);
          const t =
            (delta[0] * secondDelta[1] - delta[1] * secondDelta[0]) /
            denominator;
          return [
            firstStart[0] + firstDelta[0] * t,
            firstStart[1] + firstDelta[1] * t,
          ];
        })();
  const firstUnit = lineAngleDirectionFromCenter(firstStart, firstEnd, center);
  const secondUnit = lineAngleDirectionFromCenter(
    secondStart,
    secondEnd,
    center,
  );

  if (!firstUnit || !secondUnit) {
    return null;
  }

  const dot = Math.max(
    -1,
    Math.min(1, firstUnit[0] * secondUnit[0] + firstUnit[1] * secondUnit[1]),
  );
  return Math.acos(dot);
}

function lineAngleDirectionFromCenter(
  start: SketchPoint2D,
  end: SketchPoint2D,
  center: SketchPoint2D | null,
): SketchPoint2D | null {
  const lineUnit = unitVector(start, end);
  if (!lineUnit) {
    return null;
  }

  if (!center) {
    return lineUnit;
  }

  const midpoint: SketchPoint2D = [
    (start[0] + end[0]) * 0.5,
    (start[1] + end[1]) * 0.5,
  ];
  const towardMidpoint = unitVector(center, midpoint);
  if (!towardMidpoint) {
    return lineUnit;
  }

  const dot = towardMidpoint[0] * lineUnit[0] + towardMidpoint[1] * lineUnit[1];
  return dot >= 0 ? lineUnit : [-lineUnit[0], -lineUnit[1]];
}

function resolveLineDimensionOperand(
  values: Float64Array,
  operand: Extract<
    DimensionDefinition,
    { kind: "lineDistance" }
  >["lines"][number],
  lineEntityMap: Map<
    SketchEntityId,
    Extract<SketchEntityDefinition, { kind: "lineSegment" }>
  >,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  if (operand.kind === "sketchDatum") {
    return resolveSketchDatumLine(operand.datum);
  }

  if (operand.kind === "projectedGeometry") {
    const projected = findProjectedGeometry(
      projectedReferences,
      operand.reference,
    );
    return projected?.kind === "lineSegment"
      ? { start: projected.startPosition, end: projected.endPosition }
      : null;
  }

  const line = lineEntityMap.get(operand.entityId);
  const start = line ? pointRecords.get(line.startPointId) : null;
  const end = line ? pointRecords.get(line.endPointId) : null;

  return start && end
    ? { start: getPoint(values, start), end: getPoint(values, end) }
    : null;
}

function resolveLocalLineOperand(
  values: Float64Array,
  operand: { entityId: SketchEntityId },
  lineEntityMap: Map<
    SketchEntityId,
    Extract<SketchEntityDefinition, { kind: "lineSegment" }>
  >,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  const line = lineEntityMap.get(operand.entityId);
  const start = line ? pointRecords.get(line.startPointId) : null;
  const end = line ? pointRecords.get(line.endPointId) : null;

  return start && end
    ? { start: getPoint(values, start), end: getPoint(values, end) }
    : null;
}

function resolveReadOnlyLineOperand(
  operand: {
    kind: string;
    reference?: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    };
    datum?: "origin" | "xAxis" | "yAxis";
  },
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): { start: SketchPoint2D; end: SketchPoint2D } | null {
  if (operand.kind === "projectedGeometry" && operand.reference) {
    const projected = findProjectedGeometry(
      projectedReferences,
      operand.reference,
    );
    return projected?.kind === "lineSegment"
      ? { start: projected.startPosition, end: projected.endPosition }
      : null;
  }

  if (operand.kind === "sketchDatum" && operand.datum) {
    return resolveSketchDatumLine(operand.datum);
  }

  return null;
}

function localCollinearResidual(
  values: Float64Array,
  target: LocalCollinearTargetOperand,
  referenceLine: { start: SketchPoint2D; end: SketchPoint2D },
  lineEntityMap: Map<
    SketchEntityId,
    Extract<SketchEntityDefinition, { kind: "lineSegment" }>
  >,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
) {
  if (target.kind === "localPoint") {
    const point = pointRecords.get(target.pointId);
    return point
      ? Math.abs(
          pointLineSignedDistance(
            getPoint(values, point),
            referenceLine.start,
            referenceLine.end,
          ),
        )
      : 0;
  }

  const targetLine = resolveLocalLineOperand(
    values,
    target,
    lineEntityMap,
    pointRecords,
  );
  if (!targetLine) {
    return 0;
  }

  const startDistance = pointLineSignedDistance(
    targetLine.start,
    referenceLine.start,
    referenceLine.end,
  );
  const endDistance = pointLineSignedDistance(
    targetLine.end,
    referenceLine.start,
    referenceLine.end,
  );
  return Math.sqrt(startDistance * startDistance + endDistance * endDistance);
}

function resolvePointDimensionOperand(
  values: Float64Array,
  operand: Extract<DimensionDefinition, { kind: "linePointDistance" }>["point"],
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): SketchPoint2D | null {
  if (operand.kind === "sketchDatum") {
    return resolveSketchDatumPoint(operand.datum);
  }

  if (operand.kind === "projectedGeometry") {
    const projected = findProjectedGeometry(
      projectedReferences,
      operand.reference,
    );
    return projected?.kind === "point" ? projected.position : null;
  }

  const point = pointRecords.get(operand.pointId);
  return point ? getPoint(values, point) : null;
}

function splineTangentStateKey(entityId: SketchEntityId, occurrenceId: string) {
  return `${entityId}\u0000${occurrenceId}`;
}

function midpoint(start: SketchPoint2D, end: SketchPoint2D): SketchPoint2D {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
}

function createDerivedParameterProjection(input: {
  definition: SketchDefinition;
  parameterCount: number;
  pointRecords: Map<SketchPointId, SolverPointRecord>;
  entityStates: Map<SketchEntityId, SolverEntityState>;
  splineTangentStates: Map<string, SplineTangentState>;
  modelingTolerance: number;
  offsetPlans: readonly SolvedOffsetFramePlanRecord[] | undefined;
}): SolverParameterProjection {
  const {
    definition,
    parameterCount,
    pointRecords,
    entityStates,
    splineTangentStates,
    modelingTolerance,
    offsetPlans,
  } = input;
  if ((definition.derivedRelationships?.length ?? 0) === 0) {
    return {
      projectValues: cloneValues,
      projectionDiagnostics: () => [],
      derivationEvaluation: () => null,
      projectVariableIndices: (variableIndices) =>
        uniqueSortedIndices(variableIndices),
      authorityVariableIndices: Array.from(
        { length: parameterCount },
        (_, index) => index,
      ),
      wrapConstraint: (constraint) => constraint,
      relationshipFailuresAt: () => new Set(),
      withBlockedRelationships: (_blocked, run) => run(),
      failedAtSolveStart: () => false,
    };
  }

  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const dependenciesByDrivenIndex = new Map<number, Set<number>>();
  const pointDefinedArcEntityIds = new Set<SketchEntityId>();
  const pointIndices = (pointId: SketchPointId) => {
    const point = pointRecords.get(pointId);
    return point ? [point.baseIndex, point.baseIndex + 1] : [];
  };
  const entityIndices = (entityId: SketchEntityId) => {
    const state = entityStates.get(entityId);
    if (!state || state.kind === "point") return [];
    return state.kind === "circle"
      ? [state.baseIndex]
      : [state.baseIndex, state.baseIndex + 1, state.baseIndex + 2];
  };
  const derivedEntitySeedIndices = (entityId: SketchEntityId) =>
    entityById.get(entityId)?.kind === "circle" ? entityIndices(entityId) : [];
  const splineTangentIndices = (entity: SketchEntityDefinition) =>
    entity.kind === "spline"
      ? (orderedSplineOccurrences(entity) ?? []).flatMap((occurrence) => {
          const state = splineTangentStates.get(
            splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
          );
          return state ? [state.baseIndex, state.baseIndex + 1] : [];
        })
      : [];
  const mirrorAxisIndices = (
    relationship: NumericSketchDerivationDefinition,
  ) => {
    // A sketch datum axis is fixed: it has no variables (T15b, T-7).
    if (
      relationship.kind !== "mirror" ||
      relationship.mirrorReference.kind !== "lineEntity"
    )
      return [];
    const axis = entityById.get(relationship.mirrorReference.entityId);
    return axis ? getEntityPoints(axis).flatMap(pointIndices) : [];
  };
  const setDrivenDependencies = (
    drivenIndices: readonly number[],
    dependencyIndices: readonly number[],
  ) => {
    for (const drivenIndex of drivenIndices) {
      dependenciesByDrivenIndex.set(drivenIndex, new Set(dependencyIndices));
    }
  };

  // [TECH] G16′: the driven indices of each offset relationship's outputs;
  // T15b (T-16): and of every other relationship's (a failed mirror or an
  // unresolved relationship holds them).
  const relationshipDrivenIndices = new Map<string, Set<number>>();
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "offset") {
      relationshipDrivenIndices.set(
        relationship.derivationId,
        new Set(
          relationship.outputs.flatMap((output) => {
            const target = entityById.get(output.outputEntityId);
            return [
              ...output.outputPointIds.flatMap(pointIndices),
              ...entityIndices(output.outputEntityId),
              ...(target ? splineTangentIndices(target) : []),
            ];
          }),
        ),
      );
      continue;
    }
    relationshipDrivenIndices.set(
      relationship.derivationId,
      new Set([
        ...relationship.outputs.flatMap((output) => [
          ...output.outputPointIds.flatMap(pointIndices),
          ...entityIndices(output.outputEntityId),
        ]),
        ...relationship.piecewiseCubicOutputs.flatMap((output) => [
          ...pointIndices(output.startPointId),
          ...pointIndices(output.endPointId),
        ]),
        ...relationship.jointOutputs.flatMap((output) => [
          ...pointIndices(output.centerPointId),
          ...pointIndices(output.startPointId),
          ...pointIndices(output.endPointId),
          ...entityIndices(output.outputEntityId),
        ]),
      ]),
    );
  }
  for (const relationship of definition.derivedRelationships ?? []) {
    const axisIndices = mirrorAxisIndices(relationship);
    const offsetSeedIndices =
      relationship.kind === "offset"
        ? relationship.seedEntityIds.flatMap((entityId) => {
            const entity = entityById.get(entityId);
            if (entity?.kind === "arc") {
              pointDefinedArcEntityIds.add(entity.entityId);
              setDrivenDependencies(
                entityIndices(entity.entityId),
                getEntityPoints(entity).flatMap(pointIndices),
              );
            }
            return entity
              ? [
                  ...getEntityPoints(entity).flatMap(pointIndices),
                  ...derivedEntitySeedIndices(entityId),
                  // T08b-g5: the frame JVP moves offsets with the seed's
                  // authored tangents too (the legacy omission).
                  ...splineTangentIndices(entity),
                ]
              : [];
          })
        : [];
    for (const output of relationship.outputs) {
      const seed = entityById.get(output.seedEntityId);
      const target = entityById.get(output.outputEntityId);
      // T17o (C2, [TECH] T17-12′, documented only): the empty-map fallback
      // to the seed's defining points registers driven-dependency edges
      // (the authority graph) and accepts nothing. Pattern and transform
      // outputs need it. A mirror also reaches it, but a mirror with an
      // empty seed map fails `derived-mirror-map-stale` first (evaluation,
      // `checkMirrorOutputMap`), so its outputs are held and never
      // consumed through these edges (T15 close-out audit §2).
      const seedPointIds =
        output.seedPointIds.length > 0
          ? output.seedPointIds
          : seed
            ? getEntityPoints(seed)
            : [];
      output.outputPointIds.forEach((outputPointId, index) => {
        setDrivenDependencies(
          pointIndices(outputPointId),
          relationship.kind === "offset"
            ? offsetSeedIndices
            : [...pointIndices(seedPointIds[index]!), ...axisIndices],
        );
      });
      setDrivenDependencies(
        entityIndices(output.outputEntityId),
        relationship.kind === "offset"
          ? offsetSeedIndices
          : [
              // R-4: a mirror output arc's slots follow the seed arc's.
              ...(relationship.kind === "mirror"
                ? entityIndices(output.seedEntityId)
                : derivedEntitySeedIndices(output.seedEntityId)),
              ...seedPointIds.flatMap(pointIndices),
              ...axisIndices,
            ],
      );

      if (seed?.kind !== "spline" || target?.kind !== "spline") continue;
      const seedOccurrences = orderedSplineOccurrences(seed) ?? [];
      const outputOccurrences = orderedSplineOccurrences(target) ?? [];
      outputOccurrences.forEach((occurrence, index) => {
        const outputState = splineTangentStates.get(
          splineTangentStateKey(target.entityId, occurrence.occurrenceId),
        );
        const seedOccurrence = seedOccurrences[index];
        const seedState = seedOccurrence
          ? splineTangentStates.get(
              splineTangentStateKey(seed.entityId, seedOccurrence.occurrenceId),
            )
          : undefined;
        if (!outputState) return;
        setDrivenDependencies(
          [outputState.baseIndex, outputState.baseIndex + 1],
          !seedState
            ? []
            : [seedState.baseIndex, seedState.baseIndex + 1, ...axisIndices],
        );
      });
    }
    if (relationship.kind === "offset") {
      // A derived shell allocates no variables: only its driven terminal
      // points are solver state (D2).
      relationship.piecewiseCubicOutputs.forEach((output) =>
        setDrivenDependencies(
          [
            ...pointIndices(output.startPointId),
            ...pointIndices(output.endPointId),
          ],
          offsetSeedIndices,
        ),
      );
      relationship.jointOutputs.forEach((output) =>
        setDrivenDependencies(
          [
            ...pointIndices(output.centerPointId),
            ...pointIndices(output.startPointId),
            ...pointIndices(output.endPointId),
            ...entityIndices(output.outputEntityId),
          ],
          offsetSeedIndices,
        ),
      );
    }
  }

  const resolveAuthority = (
    variableIndex: number,
    visiting = new Set<number>(),
  ): number[] => {
    const dependencies = dependenciesByDrivenIndex.get(variableIndex);
    if (!dependencies) return [variableIndex];
    if (visiting.has(variableIndex)) return [];
    const nextVisiting = new Set(visiting).add(variableIndex);
    return uniqueSortedIndices(
      [...dependencies].flatMap((dependency) =>
        resolveAuthority(dependency, nextVisiting),
      ),
    );
  };
  /**
   * [TECH] G16′: the relationships (in definition order) whose outputs a
   * requirement on `variableIndices` names, directly or through a derived
   * output that depends on them (a mirror of an offset output). Only those
   * failing ever block it (offsets since G16′, mirrors since T15b).
   */
  const relationshipsNamedBy = (variableIndices: readonly number[]) => {
    const reached = new Set<number>();
    const pending = [...variableIndices];
    while (pending.length > 0) {
      const index = pending.pop()!;
      const dependencies = dependenciesByDrivenIndex.get(index);
      if (!dependencies || reached.has(index)) continue;
      reached.add(index);
      pending.push(...dependencies);
    }
    return [...relationshipDrivenIndices].flatMap(([derivationId, indices]) =>
      [...indices].some((index) => reached.has(index)) ? [derivationId] : [],
    );
  };
  const projectVariableIndices = (variableIndices: readonly number[]) =>
    uniqueSortedIndices(
      variableIndices.flatMap((index) => resolveAuthority(index)),
    );
  const authorityVariableIndices = Array.from(
    { length: parameterCount },
    (_, index) => index,
  ).filter((index) => !dependenciesByDrivenIndex.has(index));

  const pointDefinitionIndexById = new Map(
    definition.points.map((point, index) => [point.pointId, index]),
  );
  const drivenPointRecords = [...pointRecords.values()].flatMap((record) => {
    if (
      !dependenciesByDrivenIndex.has(record.baseIndex) &&
      !dependenciesByDrivenIndex.has(record.baseIndex + 1)
    ) {
      return [];
    }
    const definitionIndex = pointDefinitionIndexById.get(record.pointId);
    return definitionIndex === undefined ? [] : [{ record, definitionIndex }];
  });
  const entityDefinitionIndexById = new Map(
    definition.entities.map((entity, index) => [entity.entityId, index]),
  );
  const drivenEntityStates = [...entityStates.values()].flatMap((state) => {
    if (state.kind === "point") return [];
    const indices = entityIndices(state.entityId);
    if (!indices.some((index) => dependenciesByDrivenIndex.has(index))) {
      return [];
    }
    const entityIndex = entityDefinitionIndexById.get(state.entityId);
    return entityIndex === undefined ? [] : [{ state, entityIndex }];
  });
  const drivenTangentStates = [...splineTangentStates.values()].flatMap(
    (state) => {
      if (
        !dependenciesByDrivenIndex.has(state.baseIndex) &&
        !dependenciesByDrivenIndex.has(state.baseIndex + 1)
      ) {
        return [];
      }
      const entityIndex = entityDefinitionIndexById.get(state.entityId);
      const entity =
        entityIndex === undefined
          ? undefined
          : definition.entities[entityIndex];
      if (entity?.kind !== "spline") return [];
      const occurrenceIndex = entity.pointOccurrences.findIndex(
        (occurrence) => occurrence.occurrenceId === state.occurrenceId,
      );
      return occurrenceIndex < 0
        ? []
        : [{ state, entityIndex: entityIndex!, occurrenceIndex }];
    },
  );

  let cachedInput: Float64Array | null = null;
  let cachedValues: Float64Array | null = null;
  let cachedPullback: ReturnType<
    typeof prepareSketchDerivationPullback
  > | null = null;
  let cachedDiagnostics: readonly SketchSolveDiagnostic[] = [];
  let cachedEvaluation: SketchDerivationEvaluationResult | null = null;
  // [TECH] G16‴: the current solve's blocked set (see `withBlockedRelationships`).
  let startFailedOffsets: ReadonlySet<string> = new Set();
  // R-4: the arcs whose solver slots are authority (a mirror output arc
  // reflects its seed's slots; a driven point-defined arc has none).
  const authorityArcStates = [...entityStates.values()].flatMap((state) =>
    state.kind === "arc" &&
    !entityIndices(state.entityId).some((index) =>
      dependenciesByDrivenIndex.has(index),
    )
      ? [state]
      : [],
  );
  const project = (
    values: Float64Array,
    validationIndices?: readonly number[],
  ) => {
    if (
      cachedInput &&
      cachedValues &&
      cachedPullback &&
      (validationIndices
        ? validationIndices.every(
            (index) => cachedInput![index] === values[index],
          )
        : cachedInput.every((value, index) => value === values[index]))
    ) {
      return {
        values: cachedValues,
        pullback: cachedPullback,
        diagnostics: cachedDiagnostics,
        evaluation: cachedEvaluation!,
      };
    }

    const solverDefinition: SketchDefinition = {
      ...definition,
      points: definition.points.map((point) => {
        const record = pointRecords.get(point.pointId);
        return record
          ? { ...point, position: getPoint(values, record) }
          : point;
      }),
      entities: definition.entities.map((entity) => {
        const state = entityStates.get(entity.entityId);
        if (entity.kind === "circle" && state?.kind === "circle") {
          return { ...entity, radius: getCircleRadius(values, state) };
        }
        if (entity.kind !== "spline") return entity;
        return {
          ...entity,
          pointOccurrences: entity.pointOccurrences.map((occurrence) => {
            if (occurrence.tangent.kind !== "authored") return occurrence;
            const tangentState = splineTangentStates.get(
              splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
            );
            return tangentState
              ? {
                  ...occurrence,
                  tangent: {
                    kind: "authored" as const,
                    vector: [
                      values[tangentState.baseIndex]!,
                      values[tangentState.baseIndex + 1]!,
                    ] as const,
                  },
                }
              : occurrence;
          }),
        };
      }),
    };
    const derivationEvaluation = evaluateSketchDerivations({
      definition: solverDefinition,
      modelingTolerance,
      offsetPlans,
      withDerivatives: true,
      arcVariables: new Map(
        authorityArcStates.map((state) => [
          state.entityId,
          {
            radius: values[state.baseIndex]!,
            startAngle: values[state.baseIndex + 1]!,
            endAngle: values[state.baseIndex + 2]!,
          },
        ]),
      ),
    });
    const evaluated = derivationEvaluation.definition;
    const projected = cloneValues(values);
    for (const { record, definitionIndex } of drivenPointRecords) {
      const point = evaluated.points[definitionIndex]!;
      projected[record.baseIndex] = point.position[0];
      projected[record.baseIndex + 1] = point.position[1];
    }
    for (const { state, entityIndex } of drivenEntityStates) {
      const entity = evaluated.entities[entityIndex];
      if (state.kind === "circle" && entity?.kind === "circle") {
        projected[state.baseIndex] = entity.radius;
      } else if (state.kind === "arc" && entity?.kind === "arc") {
        // R-4: a mirror output arc reflects its seed arc's variables.
        const mirrored = derivationEvaluation.mirrorArcVariables.get(
          entity.entityId,
        );
        const center = evaluated.points.find(
          (point) => point.pointId === entity.centerPointId,
        )?.position;
        const start = evaluated.points.find(
          (point) => point.pointId === entity.startPointId,
        )?.position;
        const end = evaluated.points.find(
          (point) => point.pointId === entity.endPointId,
        )?.position;
        // R-g3: otherwise the one point-defined arc support formula.
        const arc =
          mirrored ??
          (center && start && end
            ? pointDefinedArcVariables(
                center,
                start,
                end,
                entity.sweepDirection,
              )
            : null);
        if (arc) {
          projected[state.baseIndex] = arc.radius;
          projected[state.baseIndex + 1] = arc.startAngle;
          projected[state.baseIndex + 2] = arc.endAngle;
        }
      }
    }
    for (const { state, entityIndex, occurrenceIndex } of drivenTangentStates) {
      const entity = evaluated.entities[entityIndex];
      if (entity?.kind !== "spline") continue;
      const occurrence = entity.pointOccurrences[occurrenceIndex];
      if (occurrence?.tangent.kind !== "authored") continue;
      projected[state.baseIndex] = occurrence.tangent.vector[0];
      projected[state.baseIndex + 1] = occurrence.tangent.vector[1];
    }

    const pullback = prepareSketchDerivationPullback(derivationEvaluation);
    cachedInput = cloneValues(values);
    cachedValues = projected;
    cachedPullback = pullback;
    cachedDiagnostics = derivationEvaluation.diagnostics;
    cachedEvaluation = derivationEvaluation;
    return {
      values: projected,
      pullback,
      diagnostics: cachedDiagnostics,
      evaluation: derivationEvaluation,
    };
  };

  return {
    projectValues: (values) => cloneValues(project(values).values),
    projectionDiagnostics: (values) => [...project(values).diagnostics],
    derivationEvaluation: (values) => project(values).evaluation,
    projectVariableIndices,
    authorityVariableIndices,
    relationshipFailuresAt: (values) => {
      const { evaluation } = project(values);
      return new Set(
        [...evaluation.offsetFailures, ...evaluation.derivedFailures].map(
          (failure) => failure.derivationId,
        ),
      );
    },
    withBlockedRelationships: (blocked, run) => {
      const previous = startFailedOffsets;
      startFailedOffsets = blocked;
      try {
        return run();
      } finally {
        startFailedOffsets = previous;
      }
    },
    failedAtSolveStart: (derivationId) => startFailedOffsets.has(derivationId),
    wrapConstraint: (constraint, variableIndices) => {
      const support = variableIndices ? new Set(variableIndices) : null;
      const projectedSupport = variableIndices
        ? projectVariableIndices(variableIndices)
        : [];
      const projectionValidationIndices =
        projectedSupport.length > 0 ? projectedSupport : undefined;
      const relevantDrivenPointRecords = support
        ? drivenPointRecords.filter(
            ({ record }) =>
              support.has(record.baseIndex) ||
              support.has(record.baseIndex + 1),
          )
        : drivenPointRecords;
      const relevantDrivenEntityStates = support
        ? drivenEntityStates.filter(({ state }) =>
            entityIndices(state.entityId).some((index) => support.has(index)),
          )
        : drivenEntityStates;
      const relevantDrivenTangentStates = support
        ? drivenTangentStates.filter(
            ({ state }) =>
              support.has(state.baseIndex) || support.has(state.baseIndex + 1),
          )
        : drivenTangentStates;
      if (
        relevantDrivenPointRecords.length === 0 &&
        relevantDrivenEntityStates.length === 0 &&
        relevantDrivenTangentStates.length === 0
      ) {
        return constraint;
      }
      const blockingOffsets = variableIndices
        ? relationshipsNamedBy(variableIndices)
        : [];
      const blocked = (
        blockers: readonly OffsetRequirementBlocker[],
      ): {
        result: ScalarConstraintEvaluation;
        blockers: readonly OffsetRequirementBlocker[];
      } => ({
        result: { residual: 0, gradient: zeroVector(parameterCount) },
        blockers,
      });

      const evaluateScoped = (
        values: Float64Array,
      ): {
        result: ScalarConstraintEvaluation;
        blockers: readonly OffsetRequirementBlocker[];
      } => {
        const projected = project(values, projectionValidationIndices);
        // [TECH] G16′/G16‴: a requirement naming an output of a
        // relationship outside the solve's blocked set that fails at this
        // iterate (its outputs are frozen) is unbounded, so stepping into
        // a failure that appears mid-solve is never a reward.
        const failedDuringSolve = blockingOffsets.filter(
          (derivationId) =>
            !startFailedOffsets.has(derivationId) &&
            [
              ...projected.evaluation.offsetFailures,
              ...projected.evaluation.derivedFailures,
            ].some((failure) => failure.derivationId === derivationId),
        );
        // [TECH] G16⁗ (re-review A-1): a relationship of the blocked set
        // holds the requirement blocked for the whole solve, also where it
        // builds again, so its real residual appearing there is never a
        // barrier that rewards staying failed.
        const failed = blockingOffsets.filter((derivationId) =>
          startFailedOffsets.has(derivationId),
        );
        if (failedDuringSolve.length > 0)
          return {
            result: {
              residual: Number.POSITIVE_INFINITY,
              gradient: zeroVector(parameterCount),
            },
            blockers: failedDuringSolve.map((derivationId) => ({
              derivationId,
              reason: "failedDuringSolve" as const,
            })),
          };
        if (failed.length > 0)
          return blocked(
            failed.map((derivationId) => ({
              derivationId,
              reason: "failed" as const,
            })),
          );
        const evaluated = constraint.evaluate(projected.values);
        const pointCotangent: Partial<Record<SketchPointId, SketchPoint2D>> =
          {};
        const entityCotangent: Partial<
          Record<SketchEntityId, SketchDerivedEntityVariation>
        > = {};
        const tangentCotangent: Partial<
          Record<SketchEntityId, Record<string, SketchPoint2D>>
        > = {};
        let hasDrivenCotangent = false;
        const addPointCotangent = (
          pointId: SketchPointId,
          value: SketchPoint2D,
        ) => {
          const current = pointCotangent[pointId] ?? [0, 0];
          pointCotangent[pointId] = [
            current[0] + value[0],
            current[1] + value[1],
          ];
        };
        for (const { record } of relevantDrivenPointRecords) {
          const x = evaluated.gradient[record.baseIndex]!;
          const y = evaluated.gradient[record.baseIndex + 1]!;
          if (x === 0 && y === 0) continue;
          addPointCotangent(record.pointId, [x, y]);
          hasDrivenCotangent = true;
        }
        for (const { state } of relevantDrivenEntityStates) {
          if (state.kind === "circle") {
            const radius = evaluated.gradient[state.baseIndex]!;
            if (radius !== 0) {
              entityCotangent[state.entityId] = { kind: "circle", radius };
              hasDrivenCotangent = true;
            }
            continue;
          }

          const radius = evaluated.gradient[state.baseIndex]!;
          const startAngle = evaluated.gradient[state.baseIndex + 1]!;
          const endAngle = evaluated.gradient[state.baseIndex + 2]!;
          if (radius === 0 && startAngle === 0 && endAngle === 0) continue;
          const entity = entityById.get(state.entityId);
          if (
            entity?.kind === "arc" &&
            pointDefinedArcEntityIds.has(entity.entityId)
          ) {
            const centerRecord = pointRecords.get(entity.centerPointId);
            const startRecord = pointRecords.get(entity.startPointId);
            const endRecord = pointRecords.get(entity.endPointId);
            if (!centerRecord || !startRecord || !endRecord) continue;
            const center = getPoint(projected.values, centerRecord);
            const start = getPoint(projected.values, startRecord);
            const end = getPoint(projected.values, endRecord);
            const startOffset = subtract(start, center);
            const endOffset = subtract(end, center);
            const startLengthSquared =
              startOffset[0] ** 2 + startOffset[1] ** 2;
            const endLengthSquared = endOffset[0] ** 2 + endOffset[1] ** 2;
            if (
              startLengthSquared <= DEGENERATE_NORM_EPSILON ** 2 ||
              endLengthSquared <= DEGENERATE_NORM_EPSILON ** 2
            ) {
              continue;
            }
            const startCotangent: SketchPoint2D = [
              (radius * startOffset[0]) / Math.sqrt(startLengthSquared) -
                (startAngle * startOffset[1]) / startLengthSquared,
              (radius * startOffset[1]) / Math.sqrt(startLengthSquared) +
                (startAngle * startOffset[0]) / startLengthSquared,
            ];
            const endCotangent: SketchPoint2D = [
              (-endAngle * endOffset[1]) / endLengthSquared,
              (endAngle * endOffset[0]) / endLengthSquared,
            ];
            addPointCotangent(entity.startPointId, startCotangent);
            addPointCotangent(entity.endPointId, endCotangent);
            addPointCotangent(entity.centerPointId, [
              -startCotangent[0] - endCotangent[0],
              -startCotangent[1] - endCotangent[1],
            ]);
          } else {
            entityCotangent[state.entityId] = {
              kind: "arc",
              radius,
              startAngle,
              endAngle,
            };
          }
          hasDrivenCotangent = true;
        }
        for (const { state } of relevantDrivenTangentStates) {
          const x = evaluated.gradient[state.baseIndex]!;
          const y = evaluated.gradient[state.baseIndex + 1]!;
          if (x === 0 && y === 0) continue;
          const entity = tangentCotangent[state.entityId] ?? {};
          entity[state.occurrenceId] = [x, y];
          tangentCotangent[state.entityId] = entity;
          hasDrivenCotangent = true;
        }
        if (!hasDrivenCotangent) return { result: evaluated, blockers: [] };

        const gradient = evaluated.gradient.slice();
        for (const { record } of relevantDrivenPointRecords) {
          gradient[record.baseIndex] = 0;
          gradient[record.baseIndex + 1] = 0;
        }
        for (const { state } of relevantDrivenEntityStates) {
          for (const index of entityIndices(state.entityId)) {
            gradient[index] = 0;
          }
        }
        for (const { state } of relevantDrivenTangentStates) {
          gradient[state.baseIndex] = 0;
          gradient[state.baseIndex + 1] = 0;
        }
        const cotangent: SketchDerivationVariation = {
          points: pointCotangent,
          entities: entityCotangent,
          splineTangents: tangentCotangent,
        };
        const pulled = projected.pullback(cotangent);
        // Review A4: a singular offset derivative is never zero motion.
        // [TECH] G16‴ (review R1): the requirement keeps its real residual
        // (its status follows it); only its gradient through the offset is
        // dropped, and it is reported with a targeted warning.
        if (pulled.derivativeUnavailable)
          return {
            result: { residual: evaluated.residual, gradient },
            blockers: pulled.derivativeUnavailable.map((derivationId) => ({
              derivationId,
              reason: "derivativeUnavailable" as const,
            })),
          };
        for (const [pointId, value] of Object.entries(pulled.points ?? {})) {
          const record = pointRecords.get(pointId as SketchPointId);
          if (!record || !value) continue;
          gradient[record.baseIndex] += value[0];
          gradient[record.baseIndex + 1] += value[1];
        }
        for (const [entityId, value] of Object.entries(pulled.entities ?? {})) {
          const state = entityStates.get(entityId as SketchEntityId);
          if (!state || !value || state.kind !== value.kind) continue;
          gradient[state.baseIndex] += value.radius;
          if (state.kind === "arc" && value.kind === "arc") {
            gradient[state.baseIndex + 1] += value.startAngle;
            gradient[state.baseIndex + 2] += value.endAngle;
          }
        }
        for (const [entityId, occurrences] of Object.entries(
          pulled.splineTangents ?? {},
        )) {
          for (const [occurrenceId, value] of Object.entries(
            occurrences ?? {},
          )) {
            const state = splineTangentStates.get(
              splineTangentStateKey(entityId as SketchEntityId, occurrenceId),
            );
            if (!state || !value) continue;
            gradient[state.baseIndex] += value[0];
            gradient[state.baseIndex + 1] += value[1];
          }
        }
        return {
          result: { residual: evaluated.residual, gradient },
          blockers: [],
        };
      };

      const innerBlockers = constraint.offsetBlockers;
      return {
        ...constraint,
        evaluate: (values) => evaluateScoped(values).result,
        ...(blockingOffsets.length > 0 || innerBlockers
          ? {
              offsetBlockers: (values: Float64Array) => {
                const own = evaluateScoped(values).blockers;
                return own.length > 0 || !innerBlockers
                  ? own
                  : innerBlockers(
                      project(values, projectionValidationIndices).values,
                    );
              },
            }
          : {}),
      };
    },
  };
}

/** O25: endpoint tangency is defined by the declared join, not a nearest
 * interior point that could jump to another spline span during a solve. */
function splineArcEndpointTangency(
  definition: SketchDefinition,
  first: SketchEntityDefinition | undefined,
  second: SketchEntityDefinition | undefined,
) {
  const spline = first?.kind === "spline" ? first : second?.kind === "spline" ? second : null;
  const arc = first?.kind === "arc" ? first : second?.kind === "arc" ? second : null;
  if (!spline || !arc || spline.closure !== "open") return null;
  const occurrences = orderedSplineOccurrences(spline);
  if (!occurrences?.length) return null;
  for (const [atStart, occurrence] of [[true, occurrences[0]!], [false, occurrences.at(-1)!]] as const) {
    for (const arcPointId of [arc.startPointId, arc.endPointId]) {
      const joined = occurrence.pointId === arcPointId || definition.constraints.some(c =>
        c.kind === "coincident" && c.pointIds.includes(occurrence.pointId) && c.pointIds.includes(arcPointId));
      if (joined) return { spline, arc, atStart };
    }
  }
  return null;
}

function isAdvancedSketchEntity(entity: SketchEntityDefinition) {
  return (
    entity.kind === "ellipse" ||
    entity.kind === "ellipticalArc" ||
    entity.kind === "conic" ||
    entity.kind === "bezierCurve" ||
    entity.kind === "profileText"
  );
}

function localArcData(input: {
  center: SketchPoint2D;
  radius: number;
  startAngle: number;
  endAngle: number;
  sweepDirection: Extract<
    SketchEntityDefinition,
    { kind: "arc" }
  >["sweepDirection"];
}) {
  const sweep = arcSweepOffset(
    input.endAngle,
    input.startAngle,
    input.sweepDirection,
  );
  const startPosition: SketchPoint2D = [
    input.center[0] + Math.cos(input.startAngle) * input.radius,
    input.center[1] + Math.sin(input.startAngle) * input.radius,
  ];
  const endPosition: SketchPoint2D = [
    input.center[0] + Math.cos(input.endAngle) * input.radius,
    input.center[1] + Math.sin(input.endAngle) * input.radius,
  ];

  return {
    center: input.center,
    radius: input.radius,
    startAngle: input.startAngle,
    endAngle: input.endAngle,
    sweep,
    sweepDirection: input.sweepDirection,
    startPosition,
    endPosition,
  };
}

function isAngleOnLocalArc(
  angle: number,
  arc: ReturnType<typeof localArcData>,
) {
  return (
    arcSweepOffset(angle, arc.startAngle, arc.sweepDirection) <=
    arc.sweep + 1e-9
  );
}

function nearestPointOnLocalArcSweep(
  point: SketchPoint2D,
  arc: ReturnType<typeof localArcData>,
): SketchPoint2D {
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnLocalArc(angle, arc)) {
    return [
      arc.center[0] + Math.cos(angle) * arc.radius,
      arc.center[1] + Math.sin(angle) * arc.radius,
    ];
  }

  return length(subtract(point, arc.startPosition)) <=
    length(subtract(point, arc.endPosition))
    ? arc.startPosition
    : arc.endPosition;
}

function localArcSweepViolation(
  point: SketchPoint2D,
  arc: ReturnType<typeof localArcData>,
) {
  const offset = subtract(point, arc.center);
  const offsetLength = length(offset);
  const angle =
    offsetLength > DEGENERATE_NORM_EPSILON
      ? Math.atan2(offset[1], offset[0])
      : arc.startAngle;

  if (isAngleOnLocalArc(angle, arc)) {
    return 0;
  }

  const circlePoint: SketchPoint2D = [
    arc.center[0] + Math.cos(angle) * arc.radius,
    arc.center[1] + Math.sin(angle) * arc.radius,
  ];
  return Math.min(
    length(subtract(circlePoint, arc.startPosition)),
    length(subtract(circlePoint, arc.endPosition)),
  );
}

function getLocalCircleLikeGeometry(
  values: Float64Array,
  entity: SketchEntityDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
): {
  center: SketchPoint2D;
  radius: number;
  arc?: ReturnType<typeof localArcData>;
} | null {
  if (entity.kind === "circle") {
    const center = pointRecords.get(entity.centerPointId);
    const circleState = entityStates.get(entity.entityId);
    return center
      ? {
          center: getPoint(values, center),
          radius:
            circleState?.kind === "circle"
              ? getCircleRadius(values, circleState)
              : entity.radius,
        }
      : null;
  }

  if (entity.kind === "arc") {
    const center = pointRecords.get(entity.centerPointId);
    const arcState = entityStates.get(entity.entityId);
    if (!center || !arcState || arcState.kind !== "arc") {
      return null;
    }

    const { radius, startAngle, endAngle } = getArcParameters(values, arcState);
    const arc = localArcData({
      center: getPoint(values, center),
      radius,
      startAngle,
      endAngle,
      sweepDirection: entity.sweepDirection,
    });
    return { center: arc.center, radius: arc.radius, arc };
  }

  return null;
}

function localCircleTangencyContacts(
  first: { center: SketchPoint2D; radius: number },
  second: { center: SketchPoint2D; radius: number },
  relation: "external" | "internal",
): [SketchPoint2D, SketchPoint2D] {
  const centerDelta = subtract(second.center, first.center);
  const centerDistance = length(centerDelta);
  const direction: SketchPoint2D =
    centerDistance > DEGENERATE_NORM_EPSILON
      ? [centerDelta[0] / centerDistance, centerDelta[1] / centerDistance]
      : [1, 0];

  if (relation === "external") {
    return [
      [
        first.center[0] + direction[0] * first.radius,
        first.center[1] + direction[1] * first.radius,
      ],
      [
        second.center[0] - direction[0] * second.radius,
        second.center[1] - direction[1] * second.radius,
      ],
    ];
  }

  const contactSign = first.radius >= second.radius ? 1 : -1;
  return [
    [
      first.center[0] + direction[0] * first.radius * contactSign,
      first.center[1] + direction[1] * first.radius * contactSign,
    ],
    [
      second.center[0] + direction[0] * second.radius * contactSign,
      second.center[1] + direction[1] * second.radius * contactSign,
    ],
  ];
}

function createNumericalScalarConstraint(input: {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  parameterCount: number;
  affectedVariableIndices?: readonly number[];
  evaluateResidual(values: Float64Array): number;
}): ScalarConstraintRecord {
  const indices = input.affectedVariableIndices;
  return {
    id: input.id,
    targetKind: input.targetKind,
    evaluate(values) {
      const residualValue = input.evaluateResidual(values);
      const gradient = zeroVector(input.parameterCount);
      const step = 1e-6;
      const loopIndices = indices ?? values;

      for (let i = 0; i < loopIndices.length; i += 1) {
        const index = indices ? indices[i]! : i;
        const saved = values[index]!;
        values[index] = saved + step;
        const nextLoss = 0.5 * input.evaluateResidual(values) ** 2;
        values[index] = saved - step;
        const previousLoss = 0.5 * input.evaluateResidual(values) ** 2;
        values[index] = saved;
        gradient[index] = (nextLoss - previousLoss) / (2 * step);
      }

      return { residual: 0.5 * residualValue * residualValue, gradient };
    },
  };
}

function buildSystem(
  definition: SketchDefinition,
  options: BuildSystemOptions,
): BuildSystemResult {
  const pointRecords = new Map<SketchPointId, SolverPointRecord>();
  const entityStates = new Map<SketchEntityId, SolverEntityState>();
  const splineTangentStates = new Map<string, SplineTangentState>();
  const scalarConstraints: ScalarConstraintRecord[] = [];
  let parameterCount = 0;
  for (const point of definition.points) {
    pointRecords.set(point.pointId, {
      pointId: point.pointId,
      initial: point.position,
      baseIndex: parameterCount,
    });
    parameterCount += 2;
  }

  for (const entity of definition.entities) {
    if (entity.kind === "circle") {
      entityStates.set(entity.entityId, {
        kind: "circle",
        entityId: entity.entityId,
        baseIndex: parameterCount,
      });
      parameterCount += 1;
      continue;
    }

    if (entity.kind === "arc") {
      const center = pointRecords.get(entity.centerPointId);
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (!center || !start || !end) {
        continue;
      }

      const centerPos = center.initial;
      const startVector = subtract(start.initial, centerPos);
      const endVector = subtract(end.initial, centerPos);
      entityStates.set(entity.entityId, {
        kind: "arc",
        entityId: entity.entityId,
        baseIndex: parameterCount,
      });
      parameterCount += 3;

      void startVector;
      void endVector;
    }
  }

  for (const entity of definition.entities) {
    if (entity.kind !== "spline") continue;
    const occurrences = orderedSplineOccurrences(entity);
    if (!occurrences) continue;
    occurrences.forEach((occurrence, occurrenceIndex) => {
      if (occurrence.tangent.kind !== "authored") return;
      splineTangentStates.set(
        splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
        {
          kind: "splineTangent",
          entityId: entity.entityId,
          occurrenceId: occurrence.occurrenceId,
          occurrenceIndex,
          baseIndex: parameterCount,
        },
      );
      parameterCount += 2;
    });
  }

  const initialValues = new Float64Array(parameterCount);
  for (const record of pointRecords.values()) {
    initialValues[record.baseIndex] = record.initial[0];
    initialValues[record.baseIndex + 1] = record.initial[1];
  }

  for (const entity of definition.entities) {
    if (entity.kind === "spline") {
      const occurrences = orderedSplineOccurrences(entity) ?? [];
      for (const occurrence of occurrences) {
        if (occurrence.tangent.kind !== "authored") continue;
        const state = splineTangentStates.get(
          splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
        );
        if (!state) continue;
        initialValues[state.baseIndex] = occurrence.tangent.vector[0];
        initialValues[state.baseIndex + 1] = occurrence.tangent.vector[1];
      }
      continue;
    }

    if (entity.kind === "circle") {
      const circleState = entityStates.get(entity.entityId);
      if (circleState?.kind === "circle") {
        initialValues[circleState.baseIndex] = entity.radius;
      }
      continue;
    }

    if (entity.kind !== "arc") {
      continue;
    }
    const arcState = entityStates.get(entity.entityId);
    const center = pointRecords.get(entity.centerPointId);
    const start = pointRecords.get(entity.startPointId);
    const end = pointRecords.get(entity.endPointId);
    if (!arcState || arcState.kind !== "arc" || !center || !start || !end) {
      continue;
    }

    const centerPos = center.initial;
    const startOffset = subtract(start.initial, centerPos);
    const endOffset = subtract(end.initial, centerPos);
    initialValues[arcState.baseIndex] = Math.max(length(startOffset), 1e-9);
    initialValues[arcState.baseIndex + 1] = Math.atan2(
      startOffset[1],
      startOffset[0],
    );
    initialValues[arcState.baseIndex + 2] = Math.atan2(
      endOffset[1],
      endOffset[0],
    );
  }

  const lineEntityMap = new Map(
    definition.entities
      .filter(
        (
          entity,
        ): entity is Extract<SketchEntityDefinition, { kind: "lineSegment" }> =>
          entity.kind === "lineSegment",
      )
      .map((entity) => [entity.entityId, entity]),
  );
  const arcEntityMap = new Map(
    definition.entities
      .filter(
        (entity): entity is Extract<SketchEntityDefinition, { kind: "arc" }> =>
          entity.kind === "arc",
      )
      .map((entity) => [entity.entityId, entity]),
  );

  const getLocalCircleLike = (
    values: Float64Array,
    entity: SketchEntityDefinition,
  ): {
    center: SketchPoint2D;
    radius: number;
    arc?: ReturnType<typeof localArcData>;
  } | null =>
    getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates);

  const currentSplineAggregate = (
    values: Float64Array,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
  ) => ({
    ...entity,
    pointOccurrences: entity.pointOccurrences.map((occurrence) => {
      if (occurrence.tangent.kind !== "authored") return occurrence;
      const state = splineTangentStates.get(
        splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
      );
      return state
        ? {
            ...occurrence,
            tangent: {
              kind: "authored" as const,
              vector: [
                values[state.baseIndex]!,
                values[state.baseIndex + 1]!,
              ] as const,
            },
          }
        : occurrence;
    }),
  });

  // Only the spline's own occurrence points: `resolveSplineAggregate` reads
  // nothing else, and building every sketch point per reconstruction was 44%
  // of the spline constraints' reconstruction time (cadara-b3k.26).
  const currentSplinePositions = (
    values: Float64Array,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
  ) => {
    const positions: Record<SketchPointId, SketchPoint2D> = {};
    for (const occurrence of entity.pointOccurrences) {
      const record = pointRecords.get(occurrence.pointId);
      if (record) positions[occurrence.pointId] = getPoint(values, record);
    }
    return positions;
  };

  const reconstructCurrentSpline = (
    values: Float64Array,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
    variation: Parameters<typeof reconstructSplineAggregate>[2] = {},
  ) =>
    reconstructSplineAggregate(
      currentSplineAggregate(values, entity),
      currentSplinePositions(values, entity),
      variation,
    );

  const closestSplineLocation = (
    position: SketchPoint2D,
    geometry: ReturnType<typeof reconstructSplineAggregate>,
  ) =>
    geometry.validity === "valid"
      ? closestSplineSpanLocation(position, geometry.spans)
      : null;

  const splineVariationForVariable = (
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
    variableIndex: number,
  ) => {
    for (const occurrence of orderedSplineOccurrences(entity) ?? []) {
      const state = splineTangentStates.get(
        splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
      );
      if (!state) continue;
      if (variableIndex === state.baseIndex)
        return { tangents: { [state.occurrenceIndex]: [1, 0] as const } };
      if (variableIndex === state.baseIndex + 1)
        return { tangents: { [state.occurrenceIndex]: [0, 1] as const } };
    }
    for (const occurrence of orderedSplineOccurrences(entity) ?? []) {
      const point = pointRecords.get(occurrence.pointId);
      if (!point) continue;
      if (variableIndex === point.baseIndex)
        return { points: { [occurrence.pointId]: [1, 0] as const } };
      if (variableIndex === point.baseIndex + 1)
        return { points: { [occurrence.pointId]: [0, 1] as const } };
    }
    return {};
  };

  const createSplinePointConstraint = (
    constraint: Extract<ConstraintDefinition, { kind: "pointOnCurve" }>,
    point: SolverPointRecord,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
  ): ScalarConstraintRecord => {
    const affectedVariableIndices = uniqueSortedIndices([
      ...pIdx(point),
      ...entityIdx(entity.entityId),
    ]);
    return {
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const position = getPoint(values, point);
        // One aggregate and one position map for the base reconstruction and
        // every directional variation below (1 + N reconstructions per call).
        const aggregate = currentSplineAggregate(values, entity);
        const positions = currentSplinePositions(values, entity);
        const geometry = reconstructSplineAggregate(aggregate, positions);
        const closest = closestSplineLocation(position, geometry);
        if (!closest || geometry.validity !== "valid") {
          return { residual: Number.POSITIVE_INFINITY, gradient };
        }
        const span = geometry.spans[closest.spanIndex]!;
        const evaluated = evaluateSplineSpan(span, {
          kind: "local",
          value: closest.u,
        });
        const delta = subtract(evaluated.position, position);
        for (const variableIndex of affectedVariableIndices) {
          const varied = reconstructSplineAggregate(
            aggregate,
            positions,
            splineVariationForVariable(entity, variableIndex),
          );
          if (varied.validity !== "valid") continue;
          const differential = evaluateSplineSpan(
            varied.spans[closest.spanIndex]!,
            { kind: "local", value: closest.u },
          ).differential.position;
          const targetDerivative: SketchPoint2D =
            variableIndex === point.baseIndex
              ? [1, 0]
              : variableIndex === point.baseIndex + 1
                ? [0, 1]
                : [0, 0];
          gradient[variableIndex] = dot2(
            delta,
            subtract(differential, targetDerivative),
          );
        }
        return {
          residual: halfSquaredDistanceWithSaturation(closest.distanceSquared),
          gradient,
        };
      },
    };
  };

  /**
   * T08b-g5 (U-G2): point-on-curve on a derived shell, the frame's
   * `offsetFrameCurveResidual` r = P − C(leaf, u) with the closest point
   * restricted to the drawn (query) domain and the location held fixed for
   * the gradient: ∂/∂P = r and ∂/∂source = r·∂r/∂source, pulled back
   * through the solve frame onto seed points, authored tangents and circle
   * radii. A relationship whose frame failed has no curve: the residual is
   * unbounded and its projection diagnostic explains why.
   */
  const createShellPointConstraint = (
    constraint: Extract<ConstraintDefinition, { kind: "pointOnCurve" }>,
    point: SolverPointRecord,
    shell: Extract<SketchEntityDefinition, { kind: "derivedPiecewiseCubic" }>,
  ): ScalarConstraintRecord => {
    // [TECH] G16′/G16‴: a failed relationship has no curve. The
    // requirement is blocked (reported, never silently satisfied) when the
    // relationship already failed at the solve's start, and unbounded when
    // the failure appears mid-solve (never a reward). Without a closest
    // point on the drawn domain there is no residual either: unbounded.
    // [TECH] G16⁗: a relationship of the blocked set holds it blocked for
    // the whole solve, also where it builds again.
    const scoped = (
      values: Float64Array,
    ): {
      result: ScalarConstraintEvaluation;
      blockers: readonly OffsetRequirementBlocker[];
    } => {
      const gradient = zeroVector(parameterCount);
      const blocked = (reason: OffsetRequirementBlocker["reason"]) => ({
        result: {
          residual: reason === "failed" ? 0 : Number.POSITIVE_INFINITY,
          gradient,
        },
        blockers: [{ derivationId: shell.derivationId, reason }],
      });
      if (parameterProjection.failedAtSolveStart(shell.derivationId))
        return blocked("failed");
      const record = parameterProjection
        .derivationEvaluation(values)
        ?.offsetFrames.find(
          (candidate) => candidate.derivationId === shell.derivationId,
        );
      const output = record?.outputs.shells.find(
        (candidate) => candidate.entityId === shell.entityId,
      );
      if (!record || !output) return blocked("failedDuringSolve");
      const result = offsetFrameCurveResidual({
        frame: record.frame,
        derivatives: offsetRecordDerivatives(record),
        seedEntityId: output.seed,
        point: getPoint(values, point),
      });
      if ("code" in result) return blocked("derivativeUnavailable");
      const [rx, ry] = result.value;
      gradient[point.baseIndex] += rx;
      gradient[point.baseIndex + 1] += ry;
      const [sx, sy] = result.gradient.source;
      for (const [pointId, value] of Object.entries(sx.points ?? {})) {
        const record = pointRecords.get(pointId as SketchPointId);
        const other = sy.points?.[pointId] ?? [0, 0];
        if (!record) continue;
        gradient[record.baseIndex] += rx * value[0] + ry * other[0];
        gradient[record.baseIndex + 1] += rx * value[1] + ry * other[1];
      }
      for (const [entityId, occurrences] of Object.entries(
        sx.splineTangents ?? {},
      ))
        for (const [occurrenceId, value] of Object.entries(occurrences)) {
          const state = splineTangentStates.get(
            splineTangentStateKey(entityId as SketchEntityId, occurrenceId),
          );
          const other = sy.splineTangents?.[entityId]?.[occurrenceId] ?? [0, 0];
          if (!state) continue;
          gradient[state.baseIndex] += rx * value[0] + ry * other[0];
          gradient[state.baseIndex + 1] += rx * value[1] + ry * other[1];
        }
      for (const [entityId, value] of Object.entries(sx.circleRadii ?? {})) {
        const state = entityStates.get(entityId as SketchEntityId);
        if (state?.kind !== "circle") continue;
        gradient[state.baseIndex] +=
          rx * value + ry * (sy.circleRadii?.[entityId] ?? 0);
      }
      return {
        result: {
          residual: halfSquaredDistanceWithSaturation(rx * rx + ry * ry),
          gradient,
        },
        blockers: [],
      };
    };
    return {
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluate: (values) => scoped(values).result,
      offsetBlockers: (values) => scoped(values).blockers,
    };
  };

  const pointOnLocalCurveResidual = (
    values: Float64Array,
    point: SolverPointRecord,
    entity: SketchEntityDefinition,
  ) => {
    const position = getPoint(values, point);

    if (entity.kind === "lineSegment") {
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      return start && end
        ? pointLineSignedDistance(
            position,
            getPoint(values, start),
            getPoint(values, end),
          )
        : 0;
    }

    const circleLike = getLocalCircleLike(values, entity);
    if (!circleLike) {
      return 0;
    }

    if (circleLike.arc) {
      return length(
        subtract(
          position,
          nearestPointOnLocalArcSweep(position, circleLike.arc),
        ),
      );
    }

    return length(subtract(position, circleLike.center)) - circleLike.radius;
  };

  const pointOnProjectedCurveResidual = (
    position: SketchPoint2D,
    projected: ProjectedSketchReferenceGeometry,
  ) => {
    if (projected.kind === "lineSegment") {
      return pointLineSignedDistance(
        position,
        projected.startPosition,
        projected.endPosition,
      );
    }

    if (projected.kind === "arc") {
      return pointProjectedArcDistance(position, projected);
    }

    if (projected.kind === "spline") {
      if (projected.representation.kind === "sourceSamples")
        return Number.POSITIVE_INFINITY;
      const closest = closestSplineSpanLocation(
        position,
        projected.representation.spans,
      );
      if (!closest) return Number.POSITIVE_INFINITY;
      const evaluated = evaluateSplineSpan(
        projected.representation.spans[closest.spanIndex]!,
        { kind: "local", value: closest.u },
      );
      return length(subtract(evaluated.position, position));
    }

    const circleLike = projectedCircleLikeGeometry(projected);
    return circleLike
      ? length(subtract(position, circleLike.center)) - circleLike.radius
      : 0;
  };

  const normalResidual = (
    values: Float64Array,
    line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
    contactPoint: SketchPoint2D,
    center: SketchPoint2D,
  ) => {
    const start = pointRecords.get(line.startPointId);
    const end = pointRecords.get(line.endPointId);
    if (!start || !end) {
      return 0;
    }

    return lineNormalDirectionResidual(
      getPoint(values, start),
      getPoint(values, end),
      contactPoint,
      center,
    );
  };

  const lineContactResidual = (
    values: Float64Array,
    line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
    contactPoint: SketchPoint2D,
  ) => {
    const start = pointRecords.get(line.startPointId);
    const end = pointRecords.get(line.endPointId);
    return start && end
      ? pointLineSignedDistance(
          contactPoint,
          getPoint(values, start),
          getPoint(values, end),
        )
      : 0;
  };

  const symmetricResidual = (
    firstPoint: SketchPoint2D,
    secondPoint: SketchPoint2D,
    axisStart: SketchPoint2D,
    axisEnd: SketchPoint2D,
  ) => {
    const axisUnit = unitVector(axisStart, axisEnd);
    if (!axisUnit) {
      return 0;
    }

    const center = midpoint(firstPoint, secondPoint);
    const axisDistance = pointLineSignedDistance(center, axisStart, axisEnd);
    const pairVector = subtract(secondPoint, firstPoint);
    const axisProjection = dot2(pairVector, axisUnit);
    return Math.sqrt(
      axisDistance * axisDistance + axisProjection * axisProjection,
    );
  };

  const pIdx = (...points: (SolverPointRecord | null | undefined)[]) =>
    points.flatMap((p) => (p ? [p.baseIndex, p.baseIndex + 1] : []));

  const eIdx = (entityId: SketchEntityId) => {
    const state = entityStates.get(entityId);
    if (!state || state.kind === "point") return [];
    if (state.kind === "circle") return [state.baseIndex];
    return [state.baseIndex, state.baseIndex + 1, state.baseIndex + 2];
  };

  const lineIdx = (entityId: SketchEntityId) => {
    const line = lineEntityMap.get(entityId);
    if (!line) return [];
    return pIdx(
      pointRecords.get(line.startPointId),
      pointRecords.get(line.endPointId),
    );
  };

  const entityIdx = (entityId: SketchEntityId) => {
    const entity = definition.entities.find((e) => e.entityId === entityId);
    if (!entity) return [];
    const tangentIndices =
      entity.kind === "spline"
        ? (orderedSplineOccurrences(entity) ?? []).flatMap((occurrence) => {
            const state = splineTangentStates.get(
              splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
            );
            return state ? [state.baseIndex, state.baseIndex + 1] : [];
          })
        : [];
    return uniqueSortedIndices([
      ...getEntityPoints(entity).flatMap((pid) => pIdx(pointRecords.get(pid))),
      ...eIdx(entityId),
      ...tangentIndices,
    ]);
  };

  const collinearTargetIdx = (target: LocalCollinearTargetOperand) => {
    if (target.kind === "localPoint")
      return pIdx(pointRecords.get(target.pointId));
    return lineIdx(target.entityId);
  };

  const lineDimOperandIdx = (
    operand: Extract<
      DimensionDefinition,
      { kind: "lineDistance" }
    >["lines"][number],
  ) => {
    if (operand.kind === "localEntity") return lineIdx(operand.entityId);
    return [];
  };

  const pointDimOperandIdx = (
    operand: Extract<
      DimensionDefinition,
      { kind: "linePointDistance" }
    >["point"],
  ) => {
    if (operand.kind === "localPoint")
      return pIdx(pointRecords.get(operand.pointId));
    return [];
  };

  const offsetSeedArcIds = new Set(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset" ? relationship.seedEntityIds : [],
    ),
  );
  for (const entity of definition.entities) {
    if (entity.kind !== "arc" || !offsetSeedArcIds.has(entity.entityId)) {
      continue;
    }
    const center = pointRecords.get(entity.centerPointId);
    const start = pointRecords.get(entity.startPointId);
    const end = pointRecords.get(entity.endPointId);
    if (!center || !start || !end) continue;

    scalarConstraints.push({
      id: `constraint_internal_arc_common_radius_${entity.entityId}` as ConstraintId,
      targetKind: "constraint",
      structuralVariableIndices: pIdx(center, start, end),
      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const centerPosition = getPoint(values, center);
        const startOffset = subtract(getPoint(values, start), centerPosition);
        const endOffset = subtract(getPoint(values, end), centerPosition);
        const startRadius = length(startOffset);
        const endRadius = length(endOffset);
        if (
          startRadius <= DEGENERATE_NORM_EPSILON ||
          endRadius <= DEGENERATE_NORM_EPSILON
        ) {
          return { residual: Number.POSITIVE_INFINITY, gradient };
        }
        const delta = endRadius - startRadius;
        const startUnit: SketchPoint2D = [
          startOffset[0] / startRadius,
          startOffset[1] / startRadius,
        ];
        const endUnit: SketchPoint2D = [
          endOffset[0] / endRadius,
          endOffset[1] / endRadius,
        ];
        addPointGradient(
          gradient,
          center,
          delta * (startUnit[0] - endUnit[0]),
          delta * (startUnit[1] - endUnit[1]),
        );
        addPointGradient(
          gradient,
          start,
          -delta * startUnit[0],
          -delta * startUnit[1],
        );
        addPointGradient(gradient, end, delta * endUnit[0], delta * endUnit[1]);
        return { residual: 0.5 * delta * delta, gradient };
      },
    });
  }

  for (const constraint of definition.constraints) {
    if (constraint.kind === "equalOffset") {
      if (
        constraint.pairs.some(
          (pair) => pair.seedEntityId === pair.offsetEntityId,
        )
      ) {
        continue;
      }
      const pairLines = constraint.pairs.map((pair) => ({
        pair,
        seed: lineEntityMap.get(pair.seedEntityId),
        offset: lineEntityMap.get(pair.offsetEntityId),
      }));
      if (pairLines.some(({ seed, offset }) => !seed || !offset)) {
        continue;
      }

      const records = pairLines.map(({ pair, seed, offset }) => ({
        pair,
        seedStart: pointRecords.get(seed!.startPointId),
        seedEnd: pointRecords.get(seed!.endPointId),
        offsetStart: pointRecords.get(offset!.startPointId),
        offsetEnd: pointRecords.get(offset!.endPointId),
      }));
      if (
        records.some(
          ({ seedStart, seedEnd, offsetStart, offsetEnd }) =>
            !seedStart || !seedEnd || !offsetStart || !offsetEnd,
        )
      ) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const evaluations = records.map((record) => {
            const seedStart = record.seedStart!;
            const seedEnd = record.seedEnd!;
            const offsetStart = record.offsetStart!;
            const offsetEnd = record.offsetEnd!;
            const seedVector = subtract(
              getPoint(values, seedEnd),
              getPoint(values, seedStart),
            );
            const offsetVector = subtract(
              getPoint(values, offsetEnd),
              getPoint(values, offsetStart),
            );
            const seedLength = length(seedVector);
            const offsetLength = length(offsetVector);
            if (
              !Number.isFinite(seedLength) ||
              !Number.isFinite(offsetLength) ||
              seedLength < DEGENERATE_NORM_EPSILON ||
              offsetLength < DEGENERATE_NORM_EPSILON
            ) {
              return null;
            }

            const seedUnit: SketchPoint2D = [
              seedVector[0] / seedLength,
              seedVector[1] / seedLength,
            ];
            const offsetUnit: SketchPoint2D = [
              offsetVector[0] / offsetLength,
              offsetVector[1] / offsetLength,
            ];
            const seedNormal: SketchPoint2D = [-seedUnit[1], seedUnit[0]];
            const side = record.pair.side === "left" ? 1 : -1;
            const startDelta = subtract(
              getPoint(values, offsetStart),
              getPoint(values, seedStart),
            );
            const distance = side * dot2(seedNormal, startDelta);

            const seedUnitJacobian = [
              [
                (1 - seedUnit[0] * seedUnit[0]) / seedLength,
                -(seedUnit[0] * seedUnit[1]) / seedLength,
              ],
              [
                -(seedUnit[0] * seedUnit[1]) / seedLength,
                (1 - seedUnit[1] * seedUnit[1]) / seedLength,
              ],
            ] as const;
            const offsetUnitJacobian = [
              [
                (1 - offsetUnit[0] * offsetUnit[0]) / offsetLength,
                -(offsetUnit[0] * offsetUnit[1]) / offsetLength,
              ],
              [
                -(offsetUnit[0] * offsetUnit[1]) / offsetLength,
                (1 - offsetUnit[1] * offsetUnit[1]) / offsetLength,
              ],
            ] as const;

            const parallel =
              seedUnit[0] * offsetUnit[1] - seedUnit[1] * offsetUnit[0];
            const parallelSeedUnitGradient: SketchPoint2D = [
              offsetUnit[1],
              -offsetUnit[0],
            ];
            const parallelOffsetUnitGradient: SketchPoint2D = [
              -seedUnit[1],
              seedUnit[0],
            ];
            const parallelSeedVectorGradient: SketchPoint2D = [
              parallelSeedUnitGradient[0] * seedUnitJacobian[0][0] +
                parallelSeedUnitGradient[1] * seedUnitJacobian[1][0],
              parallelSeedUnitGradient[0] * seedUnitJacobian[0][1] +
                parallelSeedUnitGradient[1] * seedUnitJacobian[1][1],
            ];
            const parallelOffsetVectorGradient: SketchPoint2D = [
              parallelOffsetUnitGradient[0] * offsetUnitJacobian[0][0] +
                parallelOffsetUnitGradient[1] * offsetUnitJacobian[1][0],
              parallelOffsetUnitGradient[0] * offsetUnitJacobian[0][1] +
                parallelOffsetUnitGradient[1] * offsetUnitJacobian[1][1],
            ];

            const rotatedDelta: SketchPoint2D = [startDelta[1], -startDelta[0]];
            const distanceSeedVectorGradient: SketchPoint2D = [
              side *
                (seedUnitJacobian[0][0] * rotatedDelta[0] +
                  seedUnitJacobian[0][1] * rotatedDelta[1]),
              side *
                (seedUnitJacobian[1][0] * rotatedDelta[0] +
                  seedUnitJacobian[1][1] * rotatedDelta[1]),
            ];
            const distanceDeltaGradient: SketchPoint2D = [
              side * seedNormal[0],
              side * seedNormal[1],
            ];

            return {
              distance,
              parallel,
              seedStart,
              seedEnd,
              offsetStart,
              offsetEnd,
              parallelSeedVectorGradient,
              parallelOffsetVectorGradient,
              distanceSeedVectorGradient,
              distanceDeltaGradient,
            };
          });

          const first = evaluations[0];
          const second = evaluations[1];
          if (!first || !second) {
            return { residual: Number.POSITIVE_INFINITY, gradient };
          }

          for (const evaluation of evaluations as [
            NonNullable<typeof first>,
            NonNullable<typeof second>,
          ]) {
            addPointGradient(
              gradient,
              evaluation.seedStart,
              -evaluation.parallel * evaluation.parallelSeedVectorGradient[0],
              -evaluation.parallel * evaluation.parallelSeedVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.seedEnd,
              evaluation.parallel * evaluation.parallelSeedVectorGradient[0],
              evaluation.parallel * evaluation.parallelSeedVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.offsetStart,
              -evaluation.parallel * evaluation.parallelOffsetVectorGradient[0],
              -evaluation.parallel * evaluation.parallelOffsetVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.offsetEnd,
              evaluation.parallel * evaluation.parallelOffsetVectorGradient[0],
              evaluation.parallel * evaluation.parallelOffsetVectorGradient[1],
            );
          }

          const distanceDelta = first.distance - second.distance;
          const distanceScales = [distanceDelta, -distanceDelta] as const;
          evaluations.forEach((evaluation, index) => {
            if (!evaluation) return;
            const scale = distanceScales[index]!;
            addPointGradient(
              gradient,
              evaluation.seedStart,
              scale *
                (-evaluation.distanceSeedVectorGradient[0] -
                  evaluation.distanceDeltaGradient[0]),
              scale *
                (-evaluation.distanceSeedVectorGradient[1] -
                  evaluation.distanceDeltaGradient[1]),
            );
            addPointGradient(
              gradient,
              evaluation.seedEnd,
              scale * evaluation.distanceSeedVectorGradient[0],
              scale * evaluation.distanceSeedVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.offsetStart,
              scale * evaluation.distanceDeltaGradient[0],
              scale * evaluation.distanceDeltaGradient[1],
            );
          });

          return {
            residual:
              0.5 *
              (first.parallel * first.parallel +
                second.parallel * second.parallel +
                distanceDelta * distanceDelta),
            gradient,
          };
        },
      });
      continue;
    }

    if (constraint.kind === "coincident") {
      const left = pointRecords.get(constraint.pointIds[0]);
      const right = pointRecords.get(constraint.pointIds[1]);
      if (!left || !right) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, left);
          const b = getPoint(values, right);
          const delta = subtract(a, b);
          addPointGradient(gradient, left, delta[0], delta[1]);
          addPointGradient(gradient, right, -delta[0], -delta[1]);
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
      continue;
    }

    if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
      const line = lineEntityMap.get(constraint.entityId);
      if (!line) {
        continue;
      }
      const start = pointRecords.get(line.startPointId);
      const end = pointRecords.get(line.endPointId);
      if (!start || !end) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, start);
          const b = getPoint(values, end);
          if (constraint.kind === "horizontal") {
            const dy = b[1] - a[1];
            addPointGradient(gradient, start, 0, -dy);
            addPointGradient(gradient, end, 0, dy);
            return { residual: 0.5 * dy * dy, gradient };
          }

          const dx = b[0] - a[0];
          addPointGradient(gradient, start, -dx, 0);
          addPointGradient(gradient, end, dx, 0);
          return { residual: 0.5 * dx * dx, gradient };
        },
      });
      continue;
    }

    if (constraint.kind === "fixPoint") {
      const point = pointRecords.get(constraint.pointId);
      if (!point) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const actual = getPoint(values, point);
          const delta = subtract(actual, constraint.position);
          addPointGradient(gradient, point, delta[0], delta[1]);
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
      continue;
    }

    if (constraint.kind === "angle") {
      const point1 = pointRecords.get(constraint.pointIds[0]);
      const point2 = pointRecords.get(constraint.pointIds[1]);
      const middle = pointRecords.get(constraint.pointIds[2]);
      if (!point1 || !point2 || !middle) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const p1 = getPoint(values, point1);
          const p2 = getPoint(values, point2);
          const pm = getPoint(values, middle);
          const d1 = subtract(p1, pm);
          const d2 = subtract(p2, pm);
          const norm1 = length(d1);
          const norm2 = length(d2);
          if (
            norm1 < DEGENERATE_NORM_EPSILON ||
            norm2 < DEGENERATE_NORM_EPSILON
          ) {
            return {
              residual: 0.5 * constraint.valueRadians * constraint.valueRadians,
              gradient,
            };
          }

          const dotValue = d1[0] * d2[0] + d1[1] * d2[1];
          const cosTheta = Math.max(
            -1,
            Math.min(1, dotValue / (norm1 * norm2)),
          );
          const theta = Math.acos(cosTheta);
          const lossGradient = theta - constraint.valueRadians;
          const denom = Math.sqrt(Math.max(1e-12, 1 - cosTheta * cosTheta));
          const gradThetaFromCos = -1 / denom;

          const gradCosFromD1X =
            d2[0] / (norm1 * norm2) -
            (dotValue * d1[0]) / (norm1 * norm1 * norm1 * norm2);
          const gradCosFromD1Y =
            d2[1] / (norm1 * norm2) -
            (dotValue * d1[1]) / (norm1 * norm1 * norm1 * norm2);
          const gradCosFromD2X =
            d1[0] / (norm1 * norm2) -
            (dotValue * d2[0]) / (norm1 * norm2 * norm2 * norm2);
          const gradCosFromD2Y =
            d1[1] / (norm1 * norm2) -
            (dotValue * d2[1]) / (norm1 * norm2 * norm2 * norm2);

          const scaleFactor = lossGradient * gradThetaFromCos;
          addPointGradient(
            gradient,
            point1,
            scaleFactor * gradCosFromD1X,
            scaleFactor * gradCosFromD1Y,
          );
          addPointGradient(
            gradient,
            point2,
            scaleFactor * gradCosFromD2X,
            scaleFactor * gradCosFromD2Y,
          );
          addPointGradient(
            gradient,
            middle,
            -scaleFactor * (gradCosFromD1X + gradCosFromD2X),
            -scaleFactor * (gradCosFromD1Y + gradCosFromD2Y),
          );
          const residual = 0.5 * lossGradient * lossGradient;
          return { residual, gradient };
        },
      });
      continue;
    }

    if (
      constraint.kind === "parallel" ||
      constraint.kind === "perpendicular" ||
      constraint.kind === "equalLength"
    ) {
      const lineA = lineEntityMap.get(constraint.entityIds[0]);
      const lineB = lineEntityMap.get(constraint.entityIds[1]);
      if (!lineA || !lineB) {
        continue;
      }
      const a0 = pointRecords.get(lineA.startPointId);
      const a1 = pointRecords.get(lineA.endPointId);
      const b0 = pointRecords.get(lineB.startPointId);
      const b1 = pointRecords.get(lineB.endPointId);
      if (!a0 || !a1 || !b0 || !b1) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const pa0 = getPoint(values, a0);
          const pa1 = getPoint(values, a1);
          const pb0 = getPoint(values, b0);
          const pb1 = getPoint(values, b1);
          const da = subtract(pa1, pa0);
          const db = subtract(pb1, pb0);
          const na = length(da);
          const nb = length(db);
          if (na < DEGENERATE_NORM_EPSILON || nb < DEGENERATE_NORM_EPSILON) {
            return { residual: 0, gradient };
          }

          if (constraint.kind === "equalLength") {
            const diff = na - nb;
            const dNa = [da[0] / na, da[1] / na] as const;
            const dNb = [db[0] / nb, db[1] / nb] as const;
            addPointGradient(gradient, a0, -diff * dNa[0], -diff * dNa[1]);
            addPointGradient(gradient, a1, diff * dNa[0], diff * dNa[1]);
            addPointGradient(gradient, b0, diff * dNb[0], diff * dNb[1]);
            addPointGradient(gradient, b1, -diff * dNb[0], -diff * dNb[1]);
            return { residual: 0.5 * diff * diff, gradient };
          }

          const ua = [da[0] / na, da[1] / na] as const;
          const ub = [db[0] / nb, db[1] / nb] as const;
          const residualValue =
            constraint.kind === "parallel"
              ? ua[0] * ub[1] - ua[1] * ub[0]
              : ua[0] * ub[0] + ua[1] * ub[1];

          const hA = [
            [
              1 / na - (da[0] * da[0]) / (na * na * na),
              -(da[0] * da[1]) / (na * na * na),
            ],
            [
              -(da[0] * da[1]) / (na * na * na),
              1 / na - (da[1] * da[1]) / (na * na * na),
            ],
          ] as const;
          const hB = [
            [
              1 / nb - (db[0] * db[0]) / (nb * nb * nb),
              -(db[0] * db[1]) / (nb * nb * nb),
            ],
            [
              -(db[0] * db[1]) / (nb * nb * nb),
              1 / nb - (db[1] * db[1]) / (nb * nb * nb),
            ],
          ] as const;

          const gradResidualUa =
            constraint.kind === "parallel"
              ? ([ub[1], -ub[0]] as const)
              : ([ub[0], ub[1]] as const);
          const gradResidualUb =
            constraint.kind === "parallel"
              ? ([-ua[1], ua[0]] as const)
              : ([ua[0], ua[1]] as const);

          const gradResidualDa = [
            gradResidualUa[0] * hA[0][0] + gradResidualUa[1] * hA[1][0],
            gradResidualUa[0] * hA[0][1] + gradResidualUa[1] * hA[1][1],
          ] as const;
          const gradResidualDb = [
            gradResidualUb[0] * hB[0][0] + gradResidualUb[1] * hB[1][0],
            gradResidualUb[0] * hB[0][1] + gradResidualUb[1] * hB[1][1],
          ] as const;

          addPointGradient(
            gradient,
            a0,
            -residualValue * gradResidualDa[0],
            -residualValue * gradResidualDa[1],
          );
          addPointGradient(
            gradient,
            a1,
            residualValue * gradResidualDa[0],
            residualValue * gradResidualDa[1],
          );
          addPointGradient(
            gradient,
            b0,
            -residualValue * gradResidualDb[0],
            -residualValue * gradResidualDb[1],
          );
          addPointGradient(
            gradient,
            b1,
            residualValue * gradResidualDb[0],
            residualValue * gradResidualDb[1],
          );
          return { residual: 0.5 * residualValue * residualValue, gradient };
        },
      });
    }

    if (constraint.kind === "coincidentProjectedPoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const targetPoint =
        constraint.projectedPoint.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedPoint.reference,
              );
              return projected?.kind === "point" ? projected.position : null;
            })()
          : resolveSketchDatumPoint(constraint.projectedPoint.datum);

      if (!point || !targetPoint) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(point),
          evaluateResidual(values) {
            return length(subtract(getPoint(values, point), targetPoint));
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "pointOnProjectedCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedCurve.kind === "projectedGeometry"
          ? findProjectedGeometry(
              options.projectedReferences ?? [],
              constraint.projectedCurve.reference,
            )
          : null;
      const datumLine =
        constraint.projectedCurve.kind === "sketchDatum"
          ? resolveSketchDatumLine(constraint.projectedCurve.datum)
          : null;

      if (!point || (!projected && !datumLine)) {
        continue;
      }

      if (
        projected?.kind === "spline" &&
        projected.representation.kind === "neutralCubicSpans"
      ) {
        const projectedSpans = projected.representation.spans;
        scalarConstraints.push({
          id: constraint.constraintId,
          targetKind: "constraint",
          evaluate(values) {
            const gradient = zeroVector(parameterCount);
            const position = getPoint(values, point);
            const closest = closestSplineSpanLocation(position, projectedSpans);
            if (!closest)
              return { residual: Number.POSITIVE_INFINITY, gradient };
            const evaluated = evaluateSplineSpan(
              projectedSpans[closest.spanIndex]!,
              { kind: "local", value: closest.u },
            );
            const delta = subtract(position, evaluated.position);
            addPointGradient(gradient, point, delta[0], delta[1]);
            return {
              residual: halfSquaredDistanceWithSaturation(
                closest.distanceSquared,
              ),
              gradient,
            };
          },
        });
      } else {
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: pIdx(point),
            evaluateResidual(values) {
              return projected
                ? pointOnProjectedCurveResidual(
                    getPoint(values, point),
                    projected,
                  )
                : Math.abs(
                    pointLineSignedDistance(
                      getPoint(values, point),
                      datumLine!.start,
                      datumLine!.end,
                    ),
                  );
            },
          }),
        );
      }
      continue;
    }

    if (constraint.kind === "midpoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const line = lineEntityMap.get(constraint.line.entityId);
      const start = line ? pointRecords.get(line.startPointId) : null;
      const end = line ? pointRecords.get(line.endPointId) : null;

      if (!point || !line || !start || !end) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(point, start, end),
          evaluateResidual(values) {
            const target = midpoint(
              getPoint(values, start),
              getPoint(values, end),
            );
            return length(subtract(getPoint(values, point), target));
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "midpointProjectedLine") {
      const point = pointRecords.get(constraint.point.pointId);
      const projectedLine =
        constraint.projectedLine.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedLine.reference,
              );
              return projected?.kind === "lineSegment"
                ? { start: projected.startPosition, end: projected.endPosition }
                : null;
            })()
          : resolveSketchDatumLine(constraint.projectedLine.datum);

      if (!point || !projectedLine) {
        continue;
      }

      const target = midpoint(projectedLine.start, projectedLine.end);
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(point),
          evaluateResidual(values) {
            return length(subtract(getPoint(values, point), target));
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "pointOnCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const curve = definition.entities.find(
        (entity) => entity.entityId === constraint.curve.entityId,
      );

      if (point && curve?.kind === "derivedPiecewiseCubic") {
        scalarConstraints.push(
          createShellPointConstraint(constraint, point, curve),
        );
        continue;
      }

      if (
        !point ||
        !curve ||
        (curve.kind !== "lineSegment" &&
          curve.kind !== "circle" &&
          curve.kind !== "arc" &&
          curve.kind !== "spline")
      ) {
        continue;
      }

      scalarConstraints.push(
        curve.kind === "spline"
          ? createSplinePointConstraint(constraint, point, curve)
          : createNumericalScalarConstraint({
              id: constraint.constraintId,
              targetKind: "constraint",
              parameterCount,
              affectedVariableIndices: [
                ...pIdx(point),
                ...entityIdx(curve.entityId),
              ],
              evaluateResidual(values) {
                return pointOnLocalCurveResidual(values, point, curve);
              },
            }),
      );
      continue;
    }

    if (constraint.kind === "collinear") {
      const referenceLine = lineEntityMap.get(constraint.line.entityId);
      if (!referenceLine) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...lineIdx(constraint.line.entityId),
            ...collinearTargetIdx(constraint.target),
          ],
          evaluateResidual(values) {
            const line = resolveLocalLineOperand(
              values,
              constraint.line,
              lineEntityMap,
              pointRecords,
            );
            if (!line || !unitVector(line.start, line.end)) {
              return Number.POSITIVE_INFINITY;
            }

            return localCollinearResidual(
              values,
              constraint.target,
              line,
              lineEntityMap,
              pointRecords,
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "collinearProjectedLine") {
      const projectedLine = resolveReadOnlyLineOperand(
        constraint.projectedLine,
        options.projectedReferences ?? [],
      );
      if (!projectedLine) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: collinearTargetIdx(constraint.target),
          evaluateResidual(values) {
            if (!unitVector(projectedLine.start, projectedLine.end)) {
              return Number.POSITIVE_INFINITY;
            }

            return localCollinearResidual(
              values,
              constraint.target,
              projectedLine,
              lineEntityMap,
              pointRecords,
            );
          },
        }),
      );
      continue;
    }

    if (
      constraint.kind === "parallelProjectedLine" ||
      constraint.kind === "perpendicularProjectedLine"
    ) {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projectedLine =
        constraint.projectedLine.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedLine.reference,
              );
              return projected?.kind === "lineSegment"
                ? { start: projected.startPosition, end: projected.endPosition }
                : null;
            })()
          : resolveSketchDatumLine(constraint.projectedLine.datum);
      if (!line || !projectedLine) {
        continue;
      }

      const start = pointRecords.get(line.startPointId);
      const end = pointRecords.get(line.endPointId);
      const projectedUnit = unitVector(projectedLine.start, projectedLine.end);
      if (!start || !end || !projectedUnit) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(start, end),
          evaluateResidual(values) {
            const startPoint = getPoint(values, start);
            const endPoint = getPoint(values, end);
            const localUnit = unitVector(startPoint, endPoint);

            if (!localUnit) {
              return 0;
            }

            return constraint.kind === "parallelProjectedLine"
              ? localUnit[0] * projectedUnit[1] -
                  localUnit[1] * projectedUnit[0]
              : localUnit[0] * projectedUnit[0] +
                  localUnit[1] * projectedUnit[1];
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "tangentProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      );
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      if (!entity || !projectedCircle) {
        continue;
      }

      const createTangentResidual = (
        tangentResidual: number,
        projectedContactPoint: SketchPoint2D,
      ) => {
        if (projected?.kind !== "arc") {
          return tangentResidual;
        }

        const arcViolation = projectedArcSweepViolation(
          projectedContactPoint,
          projected,
        );
        return Math.sqrt(
          tangentResidual * tangentResidual + arcViolation * arcViolation,
        );
      };

      if (entity.kind === "lineSegment") {
        const start = pointRecords.get(entity.startPointId);
        const end = pointRecords.get(entity.endPointId);
        if (!start || !end) {
          continue;
        }

        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: pIdx(start, end),
            evaluateResidual(values) {
              const startPoint = getPoint(values, start);
              const endPoint = getPoint(values, end);
              const unit = unitVector(startPoint, endPoint);
              if (!unit) {
                return 0;
              }

              const signedDistance = pointLineSignedDistance(
                projectedCircle.center,
                startPoint,
                endPoint,
              );
              const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] - signedDistance * lineNormal[0],
                projectedCircle.center[1] - signedDistance * lineNormal[1],
              ];
              return createTangentResidual(
                Math.abs(signedDistance) - projectedCircle.radius,
                contactPoint,
              );
            },
          }),
        );
        continue;
      }

      if (entity.kind === "circle") {
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: entityIdx(entity.entityId),
            evaluateResidual(values) {
              const localCircle = getLocalCircleLike(values, entity);
              if (!localCircle) {
                return 0;
              }

              const localCenter = localCircle.center;
              const centerOffset = subtract(
                localCenter,
                projectedCircle.center,
              );
              const centerDistance = length(centerOffset);
              const direction: SketchPoint2D =
                centerDistance > DEGENERATE_NORM_EPSILON
                  ? [
                      centerOffset[0] / centerDistance,
                      centerOffset[1] / centerDistance,
                    ]
                  : [1, 0];
              const targetDistance =
                constraint.relation === "external"
                  ? localCircle.radius + projectedCircle.radius
                  : Math.abs(localCircle.radius - projectedCircle.radius);
              const contactDirection =
                constraint.relation === "external"
                  ? direction
                  : ([-direction[0], -direction[1]] as const);
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] +
                  contactDirection[0] * projectedCircle.radius,
                projectedCircle.center[1] +
                  contactDirection[1] * projectedCircle.radius,
              ];
              return createTangentResidual(
                centerDistance - targetDistance,
                contactPoint,
              );
            },
          }),
        );
        continue;
      }

      if (entity.kind === "arc") {
        const center = pointRecords.get(entity.centerPointId);
        const arcState = entityStates.get(entity.entityId);
        if (!center || !arcState || arcState.kind !== "arc") {
          continue;
        }

        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: [
              ...pIdx(center),
              ...eIdx(entity.entityId),
            ],
            evaluateResidual(values) {
              const { radius } = getArcParameters(values, arcState);
              const localCenter = getPoint(values, center);
              const centerOffset = subtract(
                localCenter,
                projectedCircle.center,
              );
              const centerDistance = length(centerOffset);
              const direction: SketchPoint2D =
                centerDistance > DEGENERATE_NORM_EPSILON
                  ? [
                      centerOffset[0] / centerDistance,
                      centerOffset[1] / centerDistance,
                    ]
                  : [1, 0];
              const targetDistance =
                constraint.relation === "external"
                  ? radius + projectedCircle.radius
                  : Math.abs(radius - projectedCircle.radius);
              const contactDirection =
                constraint.relation === "external"
                  ? direction
                  : ([-direction[0], -direction[1]] as const);
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] +
                  contactDirection[0] * projectedCircle.radius,
                projectedCircle.center[1] +
                  contactDirection[1] * projectedCircle.radius,
              ];
              return createTangentResidual(
                centerDistance - targetDistance,
                contactPoint,
              );
            },
          }),
        );
      }
    }

    if (constraint.kind === "tangent") {
      const first = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[0],
      );
      const second = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[1],
      );
      if (!first || !second) {
        continue;
      }

      const endpointPair = splineArcEndpointTangency(definition, first, second);
      if (endpointPair) {
        const { spline, arc, atStart } = endpointPair;
        scalarConstraints.push(createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [...entityIdx(spline.entityId), ...entityIdx(arc.entityId)],
          evaluateResidual(values) {
            const geometry = reconstructCurrentSpline(values, spline);
            const span = atStart ? geometry.spans[0] : geometry.spans.at(-1);
            const circle = getLocalCircleLike(values, arc);
            if (!span || !circle) return Number.POSITIVE_INFINITY;
            const point = atStart ? span.poles[0] : span.poles[3];
            const adjacent = atStart ? span.poles[1] : span.poles[2];
            const tangent = subtract(point, adjacent);
            const magnitude = length(tangent);
            return magnitude > 1e-10
              ? dot2(subtract(point, circle.center), tangent) / magnitude
              : Number.POSITIVE_INFINITY;
          },
        }));
        continue;
      }

      const line =
        first.kind === "lineSegment"
          ? first
          : second.kind === "lineSegment"
            ? second
            : null;
      const curve = first === line ? second : first;

      if (line && (curve.kind === "circle" || curve.kind === "arc")) {
        const start = pointRecords.get(line.startPointId);
        const end = pointRecords.get(line.endPointId);
        if (!start || !end) {
          continue;
        }

        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: [
              ...pIdx(start, end),
              ...entityIdx(curve.entityId),
            ],
            evaluateResidual(values) {
              const circleLike = getLocalCircleLike(values, curve);
              if (!circleLike) {
                return 0;
              }

              const startPoint = getPoint(values, start);
              const endPoint = getPoint(values, end);
              const unit = unitVector(startPoint, endPoint);
              if (!unit) {
                return 0;
              }

              const signedDistance = pointLineSignedDistance(
                circleLike.center,
                startPoint,
                endPoint,
              );
              const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
              const contactPoint: SketchPoint2D = [
                circleLike.center[0] - signedDistance * lineNormal[0],
                circleLike.center[1] - signedDistance * lineNormal[1],
              ];
              const tangentResidual =
                Math.abs(signedDistance) - circleLike.radius;
              const arcViolation = circleLike.arc
                ? localArcSweepViolation(contactPoint, circleLike.arc)
                : 0;
              return Math.sqrt(
                tangentResidual * tangentResidual + arcViolation * arcViolation,
              );
            },
          }),
        );
        continue;
      }

      if (
        (first.kind === "circle" || first.kind === "arc") &&
        (second.kind === "circle" || second.kind === "arc")
      ) {
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: [
              ...entityIdx(first.entityId),
              ...entityIdx(second.entityId),
            ],
            evaluateResidual(values) {
              const firstCircle = getLocalCircleLike(values, first);
              const secondCircle = getLocalCircleLike(values, second);
              if (!firstCircle || !secondCircle) {
                return 0;
              }

              const centerDistance = length(
                subtract(firstCircle.center, secondCircle.center),
              );
              const targetDistance =
                constraint.relation === "external"
                  ? firstCircle.radius + secondCircle.radius
                  : Math.abs(firstCircle.radius - secondCircle.radius);
              const tangentResidual = centerDistance - targetDistance;
              const [firstContact, secondContact] = localCircleTangencyContacts(
                firstCircle,
                secondCircle,
                constraint.relation,
              );
              const firstArcViolation = firstCircle.arc
                ? localArcSweepViolation(firstContact, firstCircle.arc)
                : 0;
              const secondArcViolation = secondCircle.arc
                ? localArcSweepViolation(secondContact, secondCircle.arc)
                : 0;
              return Math.sqrt(
                tangentResidual * tangentResidual +
                  firstArcViolation * firstArcViolation +
                  secondArcViolation * secondArcViolation,
              );
            },
          }),
        );
        continue;
      }
    }

    if (constraint.kind === "concentric") {
      const first = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[0],
      );
      const second = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[1],
      );
      if (
        !first ||
        !second ||
        (first.kind !== "circle" && first.kind !== "arc") ||
        (second.kind !== "circle" && second.kind !== "arc")
      ) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...entityIdx(first.entityId),
            ...entityIdx(second.entityId),
          ],
          evaluateResidual(values) {
            const firstCircle = getLocalCircleLike(values, first);
            const secondCircle = getLocalCircleLike(values, second);
            return firstCircle && secondCircle
              ? length(subtract(firstCircle.center, secondCircle.center))
              : 0;
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "concentricProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      );
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      if (
        !entity ||
        !projectedCircle ||
        (entity.kind !== "circle" && entity.kind !== "arc")
      ) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: entityIdx(entity.entityId),
          evaluateResidual(values) {
            const localCircle = getLocalCircleLike(values, entity);
            return localCircle
              ? length(subtract(localCircle.center, projectedCircle.center))
              : 0;
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "normal") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const curve = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const point = pointRecords.get(constraint.point.pointId);
      if (
        !line ||
        !curve ||
        !point ||
        (curve.kind !== "circle" && curve.kind !== "arc")
      ) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...pIdx(point),
            ...lineIdx(line.entityId),
            ...entityIdx(curve.entityId),
          ],
          evaluateResidual(values) {
            const circleLike = getLocalCircleLike(values, curve);
            if (!circleLike) {
              return 0;
            }

            const contactPoint = getPoint(values, point);
            const curveResidual = pointOnLocalCurveResidual(
              values,
              point,
              curve,
            );
            const directionResidual = normalResidual(
              values,
              line,
              contactPoint,
              circleLike.center,
            );
            const contactResidual = lineContactResidual(
              values,
              line,
              contactPoint,
            );
            return Math.sqrt(
              curveResidual * curveResidual +
                directionResidual * directionResidual +
                contactResidual * contactResidual,
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "normalProjectedCurve") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      );
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      const point = pointRecords.get(constraint.point.pointId);
      if (!line || !projected || !projectedCircle || !point) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [...pIdx(point), ...lineIdx(line.entityId)],
          evaluateResidual(values) {
            const contactPoint = getPoint(values, point);
            const curveResidual = pointOnProjectedCurveResidual(
              contactPoint,
              projected,
            );
            const directionResidual = normalResidual(
              values,
              line,
              contactPoint,
              projectedCircle.center,
            );
            const contactResidual = lineContactResidual(
              values,
              line,
              contactPoint,
            );
            return Math.sqrt(
              curveResidual * curveResidual +
                directionResidual * directionResidual +
                contactResidual * contactResidual,
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "symmetric") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const axis = lineEntityMap.get(constraint.axis.entityId);
      const axisStart = axis ? pointRecords.get(axis.startPointId) : null;
      const axisEnd = axis ? pointRecords.get(axis.endPointId) : null;
      if (!first || !second || !axis || !axisStart || !axisEnd) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(first, second, axisStart, axisEnd),
          evaluateResidual(values) {
            return symmetricResidual(
              getPoint(values, first),
              getPoint(values, second),
              getPoint(values, axisStart),
              getPoint(values, axisEnd),
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "symmetricProjectedLine") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const projectedLine =
        constraint.projectedLine.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedLine.reference,
              );
              return projected?.kind === "lineSegment"
                ? { start: projected.startPosition, end: projected.endPosition }
                : null;
            })()
          : resolveSketchDatumLine(constraint.projectedLine.datum);
      if (!first || !second || !projectedLine) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(first, second),
          evaluateResidual(values) {
            return symmetricResidual(
              getPoint(values, first),
              getPoint(values, second),
              projectedLine.start,
              projectedLine.end,
            );
          },
        }),
      );
      continue;
    }
  }

  for (const dimension of definition.dimensions) {
    // T13d (D10): a reference dimension measures its targets and compiles no
    // residual, so it never drives (or over-constrains) the solve.
    if (isReferenceDimension(dimension)) {
      continue;
    }
    const drivingValue = getDrivingDimensionValue(dimension);
    if (dimension.kind === "distance") {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (!left || !right) {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, left);
          const b = getPoint(values, right);
          const delta =
            dimension.axis === "aligned" ? subtract(a, b) : subtract(b, a);

          if (dimension.axis === "aligned") {
            const current = length(delta);
            if (current < DEGENERATE_NORM_EPSILON) {
              return {
                residual: 0.5 * drivingValue * drivingValue,
                gradient,
              };
            }
            const err = current - drivingValue;
            const coeffX = (err * delta[0]) / current;
            const coeffY = (err * delta[1]) / current;
            addPointGradient(gradient, left, coeffX, coeffY);
            addPointGradient(gradient, right, -coeffX, -coeffY);
            return { residual: 0.5 * err * err, gradient };
          }

          const index = dimension.axis === "horizontal" ? 0 : 1;
          const err = delta[index] - drivingValue;
          if (index === 0) {
            addPointGradient(gradient, left, -err, 0);
            addPointGradient(gradient, right, err, 0);
          } else {
            addPointGradient(gradient, left, 0, -err);
            addPointGradient(gradient, right, 0, err);
          }
          return { residual: 0.5 * err * err, gradient };
        },
      });
      continue;
    }

    if (
      dimension.kind === "horizontalDistance" ||
      dimension.kind === "verticalDistance"
    ) {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (!left || !right) {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, left);
          const b = getPoint(values, right);
          const delta = subtract(b, a);
          const err =
            (dimension.kind === "horizontalDistance" ? delta[0] : delta[1]) -
            drivingValue;
          if (dimension.kind === "horizontalDistance") {
            addPointGradient(gradient, left, -err, 0);
            addPointGradient(gradient, right, err, 0);
          } else {
            addPointGradient(gradient, left, 0, -err);
            addPointGradient(gradient, right, 0, err);
          }
          return { residual: 0.5 * err * err, gradient };
        },
      });
      continue;
    }

    if (dimension.kind === "circleRadius") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === dimension.entityId,
      );
      if (!entity || entity.kind !== "circle") {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const circleState = entityStates.get(entity.entityId);
          if (!circleState || circleState.kind !== "circle") {
            const err = entity.radius - drivingValue;
            return { residual: 0.5 * err * err, gradient };
          }

          const err = getCircleRadius(values, circleState) - drivingValue;
          gradient[circleState.baseIndex] = err;
          return { residual: 0.5 * err * err, gradient };
        },
      });
      continue;
    }

    if (dimension.kind === "diameter") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === dimension.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: entityIdx(entity.entityId),
          evaluateResidual(values) {
            const circleLike = getLocalCircleLike(values, entity);
            return circleLike
              ? circleLike.radius * 2 - drivingValue
              : drivingValue;
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "pointDatumDistance") {
      const point = pointRecords.get(dimension.point.pointId);
      const datumPoint = resolveSketchDatumPoint(dimension.datum.datum);
      if (!point || !datumPoint) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: pIdx(point),
          evaluateResidual(values) {
            const localPoint = getPoint(values, point);
            if (dimension.axis === "horizontal") {
              return Math.abs(localPoint[0] - datumPoint[0]) - drivingValue;
            }

            if (dimension.axis === "vertical") {
              return Math.abs(localPoint[1] - datumPoint[1]) - drivingValue;
            }

            return length(subtract(localPoint, datumPoint)) - drivingValue;
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "lineLength") {
      const entity = lineEntityMap.get(dimension.entityId);
      const start = entity ? pointRecords.get(entity.startPointId) : null;
      const end = entity ? pointRecords.get(entity.endPointId) : null;
      if (!start || !end) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: pIdx(start, end),
          evaluateResidual(values) {
            return (
              length(subtract(getPoint(values, end), getPoint(values, start))) -
              drivingValue
            );
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "lineDistance") {
      const initialFirst = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      const initialSecond = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      if (
        !initialFirst ||
        !initialSecond ||
        !linesParallelWithinTolerance(
          initialFirst,
          initialSecond,
          options.tolerances,
        )
      ) {
        continue;
      }

      // Keep the distance and its parallel-line prerequisite smooth during
      // iteration. A thresholded penalty traps valid edits at the boundary as
      // unconstrained trial steps temporarily rotate the initially parallel lines.
      for (const component of ["parallel", "distance"] as const) {
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: dimension.dimensionId,
            targetKind: "dimension",
            parameterCount,
            affectedVariableIndices: [
              ...lineDimOperandIdx(dimension.lines[0]),
              ...lineDimOperandIdx(dimension.lines[1]),
            ],
            evaluateResidual(values) {
              const first = resolveLineDimensionOperand(
                values,
                dimension.lines[0],
                lineEntityMap,
                pointRecords,
                options.projectedReferences ?? [],
              );
              const second = resolveLineDimensionOperand(
                values,
                dimension.lines[1],
                lineEntityMap,
                pointRecords,
                options.projectedReferences ?? [],
              );
              if (!first || !second) return drivingValue;
              return component === "parallel"
                ? lineParallelResidual(
                    first.start,
                    first.end,
                    second.start,
                    second.end,
                  )
                : Math.abs(
                    pointLineSignedDistance(
                      second.start,
                      first.start,
                      first.end,
                    ),
                  ) - drivingValue;
            },
          }),
        );
      }
      continue;
    }

    if (dimension.kind === "linePointDistance") {
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: [
            ...lineDimOperandIdx(dimension.line),
            ...pointDimOperandIdx(dimension.point),
          ],
          evaluateResidual(values) {
            const line = resolveLineDimensionOperand(
              values,
              dimension.line,
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            const point = resolvePointDimensionOperand(
              values,
              dimension.point,
              pointRecords,
              options.projectedReferences ?? [],
            );
            return line && point
              ? Math.abs(pointLineSignedDistance(point, line.start, line.end)) -
                  drivingValue
              : drivingValue;
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "lineAngle") {
      const initialFirst = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      const initialSecond = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      const initialAngle =
        initialFirst && initialSecond
          ? lineAngleRadians(
              initialFirst.start,
              initialFirst.end,
              initialSecond.start,
              initialSecond.end,
            )
          : null;
      if (initialAngle === null || initialAngle <= DEGENERATE_NORM_EPSILON) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: [
            ...lineDimOperandIdx(dimension.lines[0]),
            ...lineDimOperandIdx(dimension.lines[1]),
          ],
          evaluateResidual(values) {
            const first = resolveLineDimensionOperand(
              values,
              dimension.lines[0],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            const second = resolveLineDimensionOperand(
              values,
              dimension.lines[1],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            if (!first || !second) {
              return drivingValue;
            }

            const angle = lineAngleRadians(
              first.start,
              first.end,
              second.start,
              second.end,
            );
            if (angle === null || angle <= DEGENERATE_NORM_EPSILON) {
              return drivingValue;
            }

            return angle - drivingValue;
          },
        }),
      );
      continue;
    }

    if (
      dimension.kind === "arcStartPointCoincident" ||
      dimension.kind === "arcEndPointCoincident"
    ) {
      const arc = arcEntityMap.get(dimension.entityId);
      const arcState = entityStates.get(dimension.entityId);
      const point = pointRecords.get(dimension.pointId);
      const center = arc ? pointRecords.get(arc.centerPointId) : null;
      if (!arc || !arcState || arcState.kind !== "arc" || !point || !center) {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const centerPos = getPoint(values, center);
          const pointPos = getPoint(values, point);
          const { radius, startAngle, endAngle } = getArcParameters(
            values,
            arcState,
          );
          const angle =
            dimension.kind === "arcStartPointCoincident"
              ? startAngle
              : endAngle;
          const arcPoint = add(centerPos, [
            radius * Math.cos(angle),
            radius * Math.sin(angle),
          ]);
          const delta = subtract(arcPoint, pointPos);
          const gx = delta[0];
          const gy = delta[1];
          addPointGradient(gradient, center, gx, gy);
          addPointGradient(gradient, point, -gx, -gy);
          gradient[arcState.baseIndex] +=
            gx * Math.cos(angle) + gy * Math.sin(angle);
          const angleGradient =
            gx * (-radius * Math.sin(angle)) + gy * (radius * Math.cos(angle));
          gradient[
            arcState.baseIndex +
              (dimension.kind === "arcStartPointCoincident" ? 1 : 2)
          ] += angleGradient;
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
    }
  }

  if (options.dragTarget) {
    const point = pointRecords.get(options.dragTarget.pointId);

    if (point) {
      scalarConstraints.push({
        id: `constraint_drag_target_${options.dragTarget.pointId}` as ConstraintId,
        targetKind: "constraint",
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const actual = getPoint(values, point);
          const delta = subtract(actual, options.dragTarget!.position);
          addPointGradient(gradient, point, delta[0], delta[1]);
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
    }
  }

  const parameterProjection = createDerivedParameterProjection({
    definition,
    parameterCount,
    pointRecords,
    entityStates,
    splineTangentStates,
    modelingTolerance: options.modelingTolerance,
    offsetPlans: options.offsetPlans,
  });

  const shellSourceVariables = new Map<SketchEntityId, readonly number[]>();
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "offset") continue;
    const sources = uniqueSortedIndices(
      relationship.seedEntityIds.flatMap(entityIdx),
    );
    for (const output of relationship.piecewiseCubicOutputs)
      shellSourceVariables.set(output.outputEntityId, sources);
  }
  const system: BuildSystemResult = {
    parameterCount,
    initialValues: parameterProjection.projectValues(initialValues),
    pointRecords,
    entityStates,
    splineTangentStates,
    parameterProjection,
    scalarConstraints,
    shellSourceVariables,
  };
  const structuralVariables = structuralEquationVariableIndexMap(
    system,
    definition,
  );
  system.scalarConstraints = scalarConstraints.map((constraint) => {
    const variables =
      structuralVariables.get(constraint.id) ??
      constraint.structuralVariableIndices;
    return parameterProjection.wrapConstraint(
      constraint,
      variables && variables.length > 0 ? variables : undefined,
    );
  });
  return system;
}

/**
 * T17c3 (issue 08: a degenerate span is reported, its profiles blocked):
 * the one label-based text of a spline span between two consecutive fit
 * points at the same place (`spanIndex` of its reconstruction; the last
 * span of a smooth closure wraps to the first fit point).
 */
export function describeDegenerateSplineSpan(
  spline: Extract<SketchEntityDefinition, { kind: "spline" }>,
  spanIndex: number,
  pointLabel: (pointId: string) => string | undefined,
): string {
  const occurrences = orderedSplineOccurrences(spline) ?? [];
  const [first, second] = [spanIndex, spanIndex + 1].map((index) => {
    const pointId = occurrences[index % occurrences.length]?.pointId ?? "";
    return pointLabel(pointId) ?? pointId;
  });
  return `${spline.label} has two consecutive fit points at the same place (${first} and ${second}); the sketch's profiles are blocked. Undo, or drag one of them apart (delete the Coincident between them first, if there is one).`;
}

const COINCIDENT_SPLINE_SPAN_CODE = "invalid-spline-coincident-points";

/** T17c5: the splines a drag recovers, and the seed points of each span's ends. */
interface DegenerateSplineSpanRecovery {
  splineIds: ReadonlySet<SketchEntityId>;
  /**
   * The two ends of every recovered span, as authored and mapped to their
   * seed points (review RR-1: a join on either pair holds the span).
   */
  spanEnds: readonly (readonly [SketchPointId, SketchPointId])[];
}

const NO_DEGENERATE_SPLINE_SPAN_RECOVERY: DegenerateSplineSpanRecovery = {
  splineIds: new Set(),
  spanEnds: [],
};

/**
 * T17c5 (issue 08 :107, recovery by dragging): the splines whose
 * coincident-span validation a drag of `dragPointId` re-judges at each
 * solve's values instead of the authored positions, when those spans are
 * the definition's only authored errors. A spline qualifies when every
 * coincident span of its authored reconstruction has the dragged point as
 * one end, both read through the mirror/pattern/transform outputs back to
 * their seed points (review R-1: a copy of the seed span is the same span,
 * moved by the same drag). Whether a declared join holds the two ends
 * together is decided on the start's solve
 * (`isDegenerateSplineSpanRecoveryStart`).
 */
function degenerateSplineSpanDragRecovery(
  definition: SketchDefinition,
  validation: SketchCoreValidationResult,
  dragPointId: SketchPointId | undefined,
): DegenerateSplineSpanRecovery {
  const flagged = new Set(
    validation.diagnostics.flatMap((diagnostic) =>
      diagnostic.code === COINCIDENT_SPLINE_SPAN_CODE &&
      diagnostic.target?.kind === "entity"
        ? [diagnostic.target.entityId]
        : [],
    ),
  );
  if (
    !dragPointId ||
    flagged.size === 0 ||
    validation.diagnostics.some(
      (diagnostic) =>
        diagnostic.severity === "error" &&
        diagnostic.code !== COINCIDENT_SPLINE_SPAN_CODE,
    )
  )
    return NO_DEGENERATE_SPLINE_SPAN_RECOVERY;
  const seedPoint = new Map<SketchPointId, SketchPointId>();
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind === "offset") continue;
    for (const output of relationship.outputs)
      output.outputPointIds.forEach((pointId, index) => {
        const seed = output.seedPointIds[index];
        if (seed !== undefined && seed !== pointId)
          seedPoint.set(pointId, seed);
      });
  }
  const seedOf = (pointId: SketchPointId): SketchPointId => {
    const seed = seedPoint.get(pointId);
    return seed === undefined ? pointId : seedOf(seed);
  };
  const dragged = seedOf(dragPointId);
  const positions = Object.fromEntries(
    definition.points.map((point) => [point.pointId, point.position]),
  ) as Record<SketchPointId, SketchPoint2D>;
  const splineIds = new Set<SketchEntityId>();
  const spanEnds: (readonly [SketchPointId, SketchPointId])[] = [];
  for (const entity of definition.entities) {
    if (entity.kind !== "spline" || !flagged.has(entity.entityId)) continue;
    const occurrences = orderedSplineOccurrences(entity) ?? [];
    const ends = reconstructSplineAggregate(entity, positions).diagnostics.map(
      (span) => {
        if (span.code !== "coincident-points" || span.spanIndex === undefined)
          return null;
        const first = occurrences[span.spanIndex]?.pointId;
        const second =
          occurrences[(span.spanIndex + 1) % occurrences.length]?.pointId;
        if (first === undefined || second === undefined) return null;
        const pair = [seedOf(first), seedOf(second)] as const;
        return pair.includes(dragged) ? [[first, second] as const, pair] : null;
      },
    );
    if (ends.length === 0 || ends.some((pair) => pair === null)) continue;
    splineIds.add(entity.entityId);
    spanEnds.push(
      ...(ends as (readonly [SketchPointId, SketchPointId])[][]).flat(),
    );
  }
  return { splineIds, spanEnds };
}

/**
 * T17c5: the coincident-span errors of the recovered splines at a solve's
 * values (the authored check's own text, judged on the solved
 * reconstruction).
 */
function recoveredSplineSpanDiagnostics(
  program: SketchCompiledSolveProgram,
  solvedEntities: readonly SolvedSketchEntityGeometryRecord[],
): SketchSolveDiagnostic[] {
  const { splineIds } = program.degenerateSplineSpanRecovery;
  if (splineIds.size === 0) return [];
  return solvedEntities.flatMap((solved) => {
    const entity = program.definition.entities.find(
      (candidate) => candidate.entityId === solved.entityId,
    );
    if (
      solved.kind !== "spline" ||
      entity?.kind !== "spline" ||
      !splineIds.has(entity.entityId)
    )
      return [];
    return solved.reconstruction.diagnostics.flatMap((diagnostic) =>
      diagnostic.code === "coincident-points" &&
      diagnostic.spanIndex !== undefined
        ? [
            makeDiagnostic(
              COINCIDENT_SPLINE_SPAN_CODE,
              "error",
              describeDegenerateSplineSpan(
                entity,
                diagnostic.spanIndex,
                (pointId) =>
                  program.definition.points.find(
                    (point) => point.pointId === pointId,
                  )?.label,
              ),
              { kind: "entity", entityId: entity.entityId },
            ),
          ]
        : [],
    );
  });
}

function validateDefinition(
  definition: SketchDefinition,
  tolerances: SketchSolveTolerancePolicy,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
): SketchCoreValidationResult {
  const diagnostics: SketchSolveDiagnostic[] = [];
  const authoredStyleIds = definition.styleIds ?? [];
  const authoredStyles = definition.styles ?? [];
  const pointIds = new Set<SketchPointId>();
  const entityIds = new Set<SketchEntityId>();
  const constraintIds = new Set<ConstraintId>();
  const dimensionIds = new Set<DimensionId>();
  const referenceIds = new Set<ReferenceId>();
  const styleIds = new Set<(typeof authoredStyleIds)[number]>();
  const offsetOutputLineIds = new Set<SketchEntityId>(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? relationship.outputs.map((output) => output.outputEntityId)
        : [],
    ),
  );
  const collectRecordMap = <Id extends string, Record>(
    records: readonly Record[],
    getId: (record: Record) => Id,
    duplicateCode: string,
    message: (id: Id) => string,
  ) => {
    const map = new Map<Id, Record>();
    for (const record of records) {
      const id = getId(record);
      if (map.has(id)) {
        diagnostics.push(
          makeDiagnostic(duplicateCode, "error", message(id), null),
        );
        continue;
      }
      map.set(id, record);
    }
    return map;
  };
  const pointMap = collectRecordMap(
    definition.points,
    (point) => point.pointId,
    "duplicate-point-record",
    (pointId) => `Point record ${pointId} appears more than once.`,
  );
  const entityMap = collectRecordMap(
    definition.entities,
    (entity) => entity.entityId,
    "duplicate-entity-record",
    (entityId) => `Entity record ${entityId} appears more than once.`,
  );
  const constraintMap = collectRecordMap(
    definition.constraints,
    (constraint) => constraint.constraintId,
    "duplicate-constraint-record",
    (constraintId) =>
      `Constraint record ${constraintId} appears more than once.`,
  );
  const dimensionMap = collectRecordMap(
    definition.dimensions,
    (dimension) => dimension.dimensionId,
    "duplicate-dimension-record",
    (dimensionId) => `Dimension record ${dimensionId} appears more than once.`,
  );
  const referenceMap = collectRecordMap(
    definition.references,
    (reference) => reference.referenceId,
    "duplicate-reference-record",
    (referenceId) => `Reference record ${referenceId} appears more than once.`,
  );
  const styleMap = collectRecordMap(
    authoredStyles,
    (style) => style.styleId,
    "duplicate-style-record",
    (styleId) => `Style record ${styleId} appears more than once.`,
  );
  // T17e (B2): requirements are named by label in every user text, never by id.
  const constraintName = (constraintId: ConstraintId) =>
    `‘${constraintMap.get(constraintId)?.label ?? "?"}’`;
  const dimensionName = (dimensionId: DimensionId) =>
    `‘${dimensionMap.get(dimensionId)?.label ?? "?"}’`;
  const projectedTargetExists = (
    reference: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    },
  ) => findProjectedGeometry(projectedReferences, reference) !== null;
  const validateDatumConstraintTarget = (
    constraintId: ConstraintId,
    datum: "origin" | "xAxis" | "yAxis",
    expectedKinds: readonly ("origin" | "axis")[],
  ) => {
    const actualKind = datum === "origin" ? "origin" : "axis";
    if (!expectedKinds.includes(actualKind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-datum-constraint-target-kind",
          "error",
          `${constraintName(constraintId)} targets datum ${datum}, which is not valid for this relationship.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
  };
  const validateProjectedTarget = (
    constraintId: ConstraintId,
    reference: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    },
    expectedKinds: readonly NonNullable<ProjectedSketchGeometryRef["kind"]>[],
  ) => {
    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-constraint-reference",
          "error",
          `${constraintName(constraintId)} targets a reference that no longer exists.`,
          { kind: "constraint", constraintId },
        ),
      );
      return;
    }

    if (!expectedKinds.includes(reference.kind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-projected-constraint-target-kind",
          "error",
          `${constraintName(constraintId)} targets ${reference.kind}, which is not valid for this relationship.`,
          { kind: "constraint", constraintId },
        ),
      );
      return;
    }

    if (!projectedTargetExists(reference)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-constraint-target",
          "error",
          `${constraintName(constraintId)} targets projected geometry that is not available.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
  };
  const validateDatumDimensionTarget = (
    dimensionId: DimensionId,
    datum: "origin" | "xAxis" | "yAxis",
    expectedKinds: readonly ("origin" | "axis")[],
  ) => {
    const actualKind = datum === "origin" ? "origin" : "axis";
    if (!expectedKinds.includes(actualKind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-datum-dimension-target-kind",
          "error",
          `${dimensionName(dimensionId)} targets datum ${datum}, which is not valid for this dimension.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
  };
  const validateProjectedDimensionTarget = (
    dimensionId: DimensionId,
    reference: ProjectedSketchGeometryRef & {
      kind: NonNullable<ProjectedSketchGeometryRef["kind"]>;
    },
    expectedKinds: readonly NonNullable<ProjectedSketchGeometryRef["kind"]>[],
  ) => {
    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-dimension-reference",
          "error",
          `${dimensionName(dimensionId)} targets a reference that no longer exists.`,
          { kind: "dimension", dimensionId },
        ),
      );
      return;
    }

    if (!expectedKinds.includes(reference.kind)) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-projected-dimension-target-kind",
          "error",
          `${dimensionName(dimensionId)} targets ${reference.kind}, which is not valid for this dimension.`,
          { kind: "dimension", dimensionId },
        ),
      );
      return;
    }

    if (!projectedTargetExists(reference)) {
      diagnostics.push(
        makeDiagnostic(
          "missing-projected-dimension-target",
          "error",
          `${dimensionName(dimensionId)} targets projected geometry that is not available.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
  };

  for (const pointId of definition.pointIds) {
    if (pointIds.has(pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-point-id",
          "error",
          `Point ${pointId} appears more than once.`,
          { kind: "point", pointId },
        ),
      );
    }
    pointIds.add(pointId);
  }

  for (const entityId of definition.entityIds) {
    if (entityIds.has(entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-entity-id",
          "error",
          `Entity ${entityId} appears more than once.`,
          { kind: "entity", entityId },
        ),
      );
    }
    entityIds.add(entityId);
  }

  for (const constraintId of definition.constraintIds) {
    if (constraintIds.has(constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-constraint-id",
          "error",
          `Constraint ${constraintId} appears more than once.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
    constraintIds.add(constraintId);
  }

  for (const dimensionId of definition.dimensionIds) {
    if (dimensionIds.has(dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-dimension-id",
          "error",
          `Dimension ${dimensionId} appears more than once.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
    dimensionIds.add(dimensionId);
  }

  for (const referenceId of definition.referenceIds) {
    if (referenceIds.has(referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-reference-id",
          "error",
          `Reference ${referenceId} appears more than once.`,
          null,
        ),
      );
    }
    referenceIds.add(referenceId);
  }

  for (const styleId of authoredStyleIds) {
    if (styleIds.has(styleId)) {
      diagnostics.push(
        makeDiagnostic(
          "duplicate-style-id",
          "error",
          `Style ${styleId} appears more than once.`,
          null,
        ),
      );
    }
    styleIds.add(styleId);
  }

  for (const entity of definition.entities) {
    if (!entityIds.has(entity.entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "entity-missing-from-order",
          "error",
          `Entity ${entity.entityId} is not listed in entityIds.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }

    if (entity.kind === "lineSegment") {
      const start = pointMap.get(entity.startPointId);
      const end = pointMap.get(entity.endPointId);
      if (!start || !end) {
        diagnostics.push(
          makeDiagnostic(
            "missing-line-endpoint",
            "error",
            `‘${entity.label}’ references an endpoint that no longer exists.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (
        // T10i (C5, [TECH] T-11): an offset relationship's line output is
        // relationship-owned; its solve frame fails it below τ
        // (`derived-offset-output-degenerate`, [TECH] G16′).
        !offsetOutputLineIds.has(entity.entityId) &&
        length(subtract(start.position, end.position)) <
          tolerances.minimumSegmentLength
      ) {
        diagnostics.push(
          makeDiagnostic(
            "degenerate-line-segment",
            "error",
            `‘${entity.label}’ is shorter than the minimum segment length tolerance.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }

    if (entity.kind === "circle" && entity.radius <= 0) {
      diagnostics.push(
        makeDiagnostic(
          "invalid-circle-radius",
          "error",
          `‘${entity.label}’ must have a radius greater than zero.`,
          { kind: "entity", entityId: entity.entityId },
        ),
      );
    }

    if (entity.kind === "spline") {
      const occurrences = orderedSplineOccurrences(entity);
      if (!occurrences || occurrences.length < 2) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-spline-point-occurrences",
            "error",
            `‘${entity.label}’ requires at least two ordered point occurrences.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (occurrences.some(({ pointId }) => !pointMap.has(pointId))) {
        diagnostics.push(
          makeDiagnostic(
            "missing-spline-fit-point",
            "error",
            `‘${entity.label}’ references a fit point that no longer exists.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else {
        const reconstruction = reconstructSplineAggregate(
          entity,
          Object.fromEntries(
            [...pointMap.entries()].map(([pointId, point]) => [
              pointId,
              point.position,
            ]),
          ),
        );
        for (const diagnostic of reconstruction.diagnostics) {
          diagnostics.push(
            makeDiagnostic(
              `invalid-spline-${diagnostic.code}`,
              "error",
              diagnostic.code === "coincident-points" &&
                diagnostic.spanIndex !== undefined
                ? describeDegenerateSplineSpan(
                    entity,
                    diagnostic.spanIndex,
                    (pointId) => pointMap.get(pointId as SketchPointId)?.label,
                  )
                : `‘${entity.label}’ reconstruction is invalid: ${diagnostic.code}.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
      }
    }

    if (entity.kind === "ellipse") {
      const center = pointMap.get(entity.centerPointId);
      const major = pointMap.get(entity.majorAxisPointId);
      if (!center || !major) {
        diagnostics.push(
          makeDiagnostic(
            "missing-ellipse-defining-point",
            "error",
            `‘${entity.label}’ references a defining point that no longer exists.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (
        length(subtract(center.position, major.position)) <
        tolerances.minimumSegmentLength
      ) {
        diagnostics.push(
          makeDiagnostic(
            "degenerate-ellipse-major-axis",
            "error",
            `‘${entity.label}’ major radius is shorter than the minimum segment length tolerance.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.minorRadius <= 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-ellipse-minor-radius",
            "error",
            `‘${entity.label}’ minor radius must be greater than zero.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }

    if (entity.kind === "ellipticalArc") {
      const center = pointMap.get(entity.centerPointId);
      const major = pointMap.get(entity.majorAxisPointId);
      const start = pointMap.get(entity.startPointId);
      const end = pointMap.get(entity.endPointId);
      if (!center || !major || !start || !end) {
        diagnostics.push(
          makeDiagnostic(
            "missing-elliptical-arc-defining-point",
            "error",
            `‘${entity.label}’ references a defining point that no longer exists.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else {
        if (
          length(subtract(center.position, major.position)) <
          tolerances.minimumSegmentLength
        ) {
          diagnostics.push(
            makeDiagnostic(
              "degenerate-elliptical-arc-major-axis",
              "error",
              `‘${entity.label}’ major radius is shorter than the minimum segment length tolerance.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
        if (
          length(subtract(start.position, end.position)) <
          tolerances.minimumSegmentLength
        ) {
          diagnostics.push(
            makeDiagnostic(
              "degenerate-elliptical-arc-endpoints",
              "error",
              `‘${entity.label}’ start and end points are coincident.`,
              { kind: "entity", entityId: entity.entityId },
            ),
          );
        }
      }
      if (entity.minorRadius <= 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-elliptical-arc-minor-radius",
            "error",
            `‘${entity.label}’ minor radius must be greater than zero.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }

    if (entity.kind === "conic") {
      const pointIds = [
        entity.startPointId,
        entity.controlPointId,
        entity.endPointId,
      ];
      const uniquePointIds = new Set(pointIds);
      if (uniquePointIds.size !== pointIds.length) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-conic-defining-points",
            "error",
            `‘${entity.label}’ requires three distinct defining points.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (pointIds.some((pointId) => !pointMap.has(pointId))) {
        diagnostics.push(
          makeDiagnostic(
            "missing-conic-defining-point",
            "error",
            `‘${entity.label}’ references a defining point that no longer exists.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.rho <= 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-conic-rho",
            "error",
            `‘${entity.label}’ rho must be greater than zero.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }

    if (entity.kind === "bezierCurve") {
      const expectedPointCount = entity.degree + 1;
      const uniquePointIds = new Set(entity.controlPointIds);
      if (
        entity.controlPointIds.length !== expectedPointCount ||
        uniquePointIds.size !== entity.controlPointIds.length
      ) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-bezier-control-points",
            "error",
            `‘${entity.label}’ requires ${expectedPointCount} distinct control points.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (
        entity.controlPointIds.some((pointId) => !pointMap.has(pointId))
      ) {
        diagnostics.push(
          makeDiagnostic(
            "missing-bezier-control-point",
            "error",
            `‘${entity.label}’ references a control point that no longer exists.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }

    if (entity.kind === "profileText") {
      if (!pointMap.has(entity.anchorPointId)) {
        diagnostics.push(
          makeDiagnostic(
            "missing-profile-text-anchor",
            "error",
            `‘${entity.label}’ references an anchor point that no longer exists.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.text.trim().length === 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-profile-text-content",
            "error",
            `‘${entity.label}’ must contain text.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.height <= 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-profile-text-height",
            "error",
            `‘${entity.label}’ height must be greater than zero.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
    }
  }

  for (const point of definition.points) {
    if (!pointIds.has(point.pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "point-missing-from-order",
          "error",
          `Point ${point.pointId} is not listed in pointIds.`,
          { kind: "point", pointId: point.pointId },
        ),
      );
    }
  }

  for (const pointId of definition.pointIds) {
    if (!pointMap.has(pointId)) {
      diagnostics.push(
        makeDiagnostic(
          "point-missing-from-records",
          "error",
          `pointIds references missing point ${pointId}.`,
          { kind: "point", pointId },
        ),
      );
    }
  }

  for (const entityId of definition.entityIds) {
    if (!entityMap.has(entityId)) {
      diagnostics.push(
        makeDiagnostic(
          "entity-missing-from-records",
          "error",
          `entityIds references missing entity ${entityId}.`,
          { kind: "entity", entityId },
        ),
      );
    }
  }

  for (const constraint of definition.constraints) {
    if (!constraintIds.has(constraint.constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "constraint-missing-from-order",
          "error",
          `Constraint ${constraint.constraintId} is not listed in constraintIds.`,
          { kind: "constraint", constraintId: constraint.constraintId },
        ),
      );
    }

    switch (constraint.kind) {
      case "coincident":
        if (
          !pointMap.has(constraint.pointIds[0]) ||
          !pointMap.has(constraint.pointIds[1])
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-coincident-point",
              "error",
              `‘${constraint.label}’ references a point that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "horizontal":
      case "vertical":
        if (!entityMap.has(constraint.entityId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-constrained-entity",
              "error",
              `‘${constraint.label}’ references geometry that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "fixPoint":
        if (!pointMap.has(constraint.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-fix-point",
              "error",
              `‘${constraint.label}’ references a point that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "angle":
        if (!constraint.pointIds.every((pointId) => pointMap.has(pointId))) {
          diagnostics.push(
            makeDiagnostic(
              "missing-angle-point",
              "error",
              `‘${constraint.label}’ references a point that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "equalOffset": {
        const pairEntities = constraint.pairs.flatMap((pair) => [
          entityMap.get(pair.seedEntityId),
          entityMap.get(pair.offsetEntityId),
        ]);
        const hasInvalidOperands =
          pairEntities.some((entity) => entity?.kind !== "lineSegment") ||
          constraint.pairs.some(
            (pair) => pair.seedEntityId === pair.offsetEntityId,
          );
        if (hasInvalidOperands) {
          diagnostics.push(
            makeDiagnostic(
              "invalid-equal-offset-line-pair",
              "error",
              `‘${constraint.label}’ requires two distinct seed/offset line pairs.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (
          pairEntities.some((entity) => {
            if (entity?.kind !== "lineSegment") return false;
            const start = pointMap.get(entity.startPointId);
            const end = pointMap.get(entity.endPointId);
            return (
              start !== undefined &&
              end !== undefined &&
              !Number.isFinite(
                length(subtract(start.position, end.position)),
              )
            );
          })
        ) {
          diagnostics.push(
            makeDiagnostic(
              "non-finite-equal-offset-geometry",
              "error",
              `‘${constraint.label}’ cannot evaluate non-finite line geometry.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "parallel":
      case "perpendicular":
      case "equalLength":
        if (
          !constraint.entityIds.every((entityId) => entityMap.has(entityId))
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-two-line-entity",
              "error",
              `‘${constraint.label}’ references geometry that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      case "coincidentProjectedPoint":
        if (!pointMap.has(constraint.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-coincident-point",
              "error",
              `‘${constraint.label}’ references a point that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (constraint.projectedPoint.kind === "projectedGeometry") {
          validateProjectedTarget(
            constraint.constraintId,
            constraint.projectedPoint.reference,
            ["projectedPoint"],
          );
        } else {
          validateDatumConstraintTarget(
            constraint.constraintId,
            constraint.projectedPoint.datum,
            ["origin"],
          );
        }
        break;
      case "midpoint": {
        const entity = entityMap.get(constraint.line.entityId);
        if (
          !pointMap.has(constraint.point.pointId) ||
          !entity ||
          entity.kind !== "lineSegment"
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-midpoint-target",
              "error",
              `‘${constraint.label}’ references a point or line that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "midpointProjectedLine":
        if (!pointMap.has(constraint.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-midpoint-point",
              "error",
              `‘${constraint.label}’ references a point that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (constraint.projectedLine.kind === "projectedGeometry") {
          validateProjectedTarget(
            constraint.constraintId,
            constraint.projectedLine.reference,
            ["projectedLineSegment"],
          );
        } else {
          validateDatumConstraintTarget(
            constraint.constraintId,
            constraint.projectedLine.datum,
            ["axis"],
          );
        }
        break;
      case "pointOnCurve": {
        const entity = entityMap.get(constraint.curve.entityId);
        if (!pointMap.has(constraint.point.pointId) || !entity) {
          diagnostics.push(
            makeDiagnostic(
              "missing-point-on-curve-target",
              "error",
              `‘${constraint.label}’ references a point or curve that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `‘${constraint.label}’ targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (
          entity.kind !== "lineSegment" &&
          entity.kind !== "circle" &&
          entity.kind !== "arc" &&
          entity.kind !== "spline" &&
          entity.kind !== "derivedPiecewiseCubic"
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-point-on-curve-target",
              "error",
              `‘${constraint.label}’ references a point or curve that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "collinear": {
        const targetEntity =
          constraint.target.kind === "localEntity"
            ? entityMap.get(constraint.target.entityId)
            : null;
        const reference = entityMap.get(constraint.line.entityId);
        if (
          (constraint.target.kind === "localPoint" &&
            !pointMap.has(constraint.target.pointId)) ||
          (constraint.target.kind === "localEntity" &&
            targetEntity?.kind !== "lineSegment") ||
          reference?.kind !== "lineSegment"
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-collinear-target",
              "error",
              `‘${constraint.label}’ references a collinear target that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "collinearProjectedLine": {
        const targetEntity =
          constraint.target.kind === "localEntity"
            ? entityMap.get(constraint.target.entityId)
            : null;
        if (
          (constraint.target.kind === "localPoint" &&
            !pointMap.has(constraint.target.pointId)) ||
          (constraint.target.kind === "localEntity" &&
            targetEntity?.kind !== "lineSegment")
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-collinear-local-target",
              "error",
              `‘${constraint.label}’ references a collinear target that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (constraint.projectedLine.kind === "projectedGeometry") {
          validateProjectedTarget(
            constraint.constraintId,
            constraint.projectedLine.reference,
            ["projectedLineSegment"],
          );
        } else {
          validateDatumConstraintTarget(
            constraint.constraintId,
            constraint.projectedLine.datum,
            ["axis"],
          );
        }
        break;
      }
      case "pointOnProjectedCurve":
        if (!pointMap.has(constraint.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-point-on-projected-curve-point",
              "error",
              `‘${constraint.label}’ references a point that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (constraint.projectedCurve.kind === "projectedGeometry") {
          validateProjectedTarget(
            constraint.constraintId,
            constraint.projectedCurve.reference,
            [
              "projectedLineSegment",
              "projectedCircle",
              "projectedArc",
              "projectedSpline",
            ],
          );
          const projected = findProjectedGeometry(
            projectedReferences,
            constraint.projectedCurve.reference,
          );
          if (
            projected?.kind === "spline" &&
            projected.representation.kind === "sourceSamples"
          ) {
            diagnostics.push(
              makeDiagnostic(
                "unsupported-projected-spline-samples",
                "error",
                `‘${constraint.label}’ targets sampled projected spline geometry, which is display-only and cannot define an exact solver constraint.`,
                { kind: "constraint", constraintId: constraint.constraintId },
              ),
            );
          }
        } else {
          validateDatumConstraintTarget(
            constraint.constraintId,
            constraint.projectedCurve.datum,
            ["axis"],
          );
        }
        break;
      case "parallelProjectedLine":
      case "perpendicularProjectedLine": {
        const entity = entityMap.get(constraint.line.entityId);
        if (!entity || entity.kind !== "lineSegment") {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-line-local-entity",
              "error",
              `‘${constraint.label}’ references a line that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (constraint.projectedLine.kind === "projectedGeometry") {
          validateProjectedTarget(
            constraint.constraintId,
            constraint.projectedLine.reference,
            ["projectedLineSegment"],
          );
        } else {
          validateDatumConstraintTarget(
            constraint.constraintId,
            constraint.projectedLine.datum,
            ["axis"],
          );
        }
        break;
      }
      case "tangentProjectedCurve": {
        const entity = entityMap.get(constraint.curve.entityId);
        if (!entity) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-tangent-local-curve",
              "error",
              `‘${constraint.label}’ references a curve that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `‘${constraint.label}’ targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (
          entity.kind !== "lineSegment" &&
          entity.kind !== "circle" &&
          entity.kind !== "arc"
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-tangent-local-curve",
              "error",
              `‘${constraint.label}’ references a curve that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedCurve.reference,
          ["projectedCircle", "projectedArc"],
        );
        break;
      }
      case "tangent": {
        const entities = constraint.entityIds.map((entityId) =>
          entityMap.get(entityId),
        );
        if (
          entities.some((entity) => entity && isAdvancedSketchEntity(entity))
        ) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `‘${constraint.label}’ targets an advanced sketch entity that is not supported by the current solver constraint set.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (
          !splineArcEndpointTangency(definition, entities[0], entities[1]) &&
          !entities.every(
            (entity) =>
              entity &&
              (entity.kind === "lineSegment" ||
                entity.kind === "circle" ||
                entity.kind === "arc"),
          )
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-tangent-entity",
              "error",
              `‘${constraint.label}’ references a curve that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "concentric": {
        const entities = constraint.entityIds.map((entityId) =>
          entityMap.get(entityId),
        );
        if (
          entities.some((entity) => entity && isAdvancedSketchEntity(entity))
        ) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `‘${constraint.label}’ targets an advanced sketch entity that is not supported by the current solver constraint set.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (
          !entities.every(
            (entity) =>
              entity && (entity.kind === "circle" || entity.kind === "arc"),
          )
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-concentric-entity",
              "error",
              `‘${constraint.label}’ references a circle or arc that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "concentricProjectedCurve": {
        const entity = entityMap.get(constraint.curve.entityId);
        if (!entity) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-concentric-local-curve",
              "error",
              `‘${constraint.label}’ references a circle or arc that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `‘${constraint.label}’ targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (entity.kind !== "circle" && entity.kind !== "arc") {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-concentric-local-curve",
              "error",
              `‘${constraint.label}’ references a circle or arc that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedCurve.reference,
          ["projectedCircle", "projectedArc"],
        );
        break;
      }
      case "normal": {
        const line = entityMap.get(constraint.line.entityId);
        const curve = entityMap.get(constraint.curve.entityId);
        if (
          !pointMap.has(constraint.point.pointId) ||
          !line ||
          line.kind !== "lineSegment" ||
          !curve ||
          isAdvancedSketchEntity(curve) ||
          (curve.kind !== "circle" && curve.kind !== "arc")
        ) {
          diagnostics.push(
            makeDiagnostic(
              curve && isAdvancedSketchEntity(curve)
                ? "unsupported-solver-entity-constraint"
                : "missing-normal-target",
              "error",
              curve && isAdvancedSketchEntity(curve)
                ? `‘${constraint.label}’ targets ${curve.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`
                : `‘${constraint.label}’ references a normal target that no longer exists or is not supported.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "normalProjectedCurve": {
        const line = entityMap.get(constraint.line.entityId);
        if (
          !pointMap.has(constraint.point.pointId) ||
          !line ||
          line.kind !== "lineSegment"
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-normal-local-target",
              "error",
              `‘${constraint.label}’ references a normal line or point that no longer exists.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        validateProjectedTarget(
          constraint.constraintId,
          constraint.projectedCurve.reference,
          ["projectedCircle", "projectedArc"],
        );
        break;
      }
      case "symmetric": {
        const axis = entityMap.get(constraint.axis.entityId);
        if (
          !constraint.pointIds.every((pointId) => pointMap.has(pointId)) ||
          !axis ||
          axis.kind !== "lineSegment"
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-symmetric-target",
              "error",
              `‘${constraint.label}’ references points or a symmetry axis that no longer exist.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        break;
      }
      case "symmetricProjectedLine":
        if (!constraint.pointIds.every((pointId) => pointMap.has(pointId))) {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-symmetric-point",
              "error",
              `‘${constraint.label}’ references symmetric points that no longer exist.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        }
        if (constraint.projectedLine.kind === "projectedGeometry") {
          validateProjectedTarget(
            constraint.constraintId,
            constraint.projectedLine.reference,
            ["projectedLineSegment"],
          );
        } else {
          validateDatumConstraintTarget(
            constraint.constraintId,
            constraint.projectedLine.datum,
            ["axis"],
          );
        }
        break;
    }
  }

  for (const constraintId of definition.constraintIds) {
    if (!constraintMap.has(constraintId)) {
      diagnostics.push(
        makeDiagnostic(
          "constraint-missing-from-records",
          "error",
          `constraintIds references missing constraint ${constraintId}.`,
          { kind: "constraint", constraintId },
        ),
      );
    }
  }

  for (const dimension of definition.dimensions) {
    if (!dimensionIds.has(dimension.dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "dimension-missing-from-order",
          "error",
          `Dimension ${dimension.dimensionId} is not listed in dimensionIds.`,
          { kind: "dimension", dimensionId: dimension.dimensionId },
        ),
      );
    }

    switch (dimension.kind) {
      case "distance":
      case "horizontalDistance":
      case "verticalDistance":
        if (!dimension.pointIds.every((pointId) => pointMap.has(pointId))) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-point",
              "error",
              `‘${dimension.label}’ references a point that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "pointDatumDistance":
        if (!pointMap.has(dimension.point.pointId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-point",
              "error",
              `‘${dimension.label}’ references a point that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        validateDatumDimensionTarget(
          dimension.dimensionId,
          dimension.datum.datum,
          ["origin"],
        );
        break;
      case "circleRadius":
        if (!entityMap.has(dimension.entityId)) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `‘${dimension.label}’ references geometry that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      case "diameter": {
        const entity = entityMap.get(dimension.entityId);
        if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `‘${dimension.label}’ references a circle or arc that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      }
      case "lineLength": {
        const entity = entityMap.get(dimension.entityId);
        if (!entity || entity.kind !== "lineSegment") {
          diagnostics.push(
            makeDiagnostic(
              "missing-dimension-entity",
              "error",
              `‘${dimension.label}’ references a line that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
      }
      case "lineDistance":
      case "lineAngle":
        for (const line of dimension.lines) {
          if (line.kind === "localEntity") {
            const entity = entityMap.get(line.entityId);
            if (!entity || entity.kind !== "lineSegment") {
              diagnostics.push(
                makeDiagnostic(
                  "missing-dimension-entity",
                  "error",
                  `‘${dimension.label}’ references a line that no longer exists.`,
                  { kind: "dimension", dimensionId: dimension.dimensionId },
                ),
              );
            }
          } else if (line.kind === "sketchDatum") {
            validateDatumDimensionTarget(dimension.dimensionId, line.datum, [
              "axis",
            ]);
          } else {
            validateProjectedDimensionTarget(
              dimension.dimensionId,
              line.reference,
              ["projectedLineSegment"],
            );
          }
        }
        break;
      case "linePointDistance":
        if (dimension.line.kind === "localEntity") {
          const entity = entityMap.get(dimension.line.entityId);
          if (!entity || entity.kind !== "lineSegment") {
            diagnostics.push(
              makeDiagnostic(
                "missing-dimension-entity",
                "error",
                `‘${dimension.label}’ references a line that no longer exists.`,
                { kind: "dimension", dimensionId: dimension.dimensionId },
              ),
            );
          }
        } else if (dimension.line.kind === "sketchDatum") {
          validateDatumDimensionTarget(
            dimension.dimensionId,
            dimension.line.datum,
            ["axis"],
          );
        } else {
          validateProjectedDimensionTarget(
            dimension.dimensionId,
            dimension.line.reference,
            ["projectedLineSegment"],
          );
        }
        if (dimension.point.kind === "localPoint") {
          if (!pointMap.has(dimension.point.pointId)) {
            diagnostics.push(
              makeDiagnostic(
                "missing-dimension-point",
                "error",
                `‘${dimension.label}’ references a point that no longer exists.`,
                { kind: "dimension", dimensionId: dimension.dimensionId },
              ),
            );
          }
        } else if (dimension.point.kind === "sketchDatum") {
          validateDatumDimensionTarget(
            dimension.dimensionId,
            dimension.point.datum,
            ["origin"],
          );
        } else {
          validateProjectedDimensionTarget(
            dimension.dimensionId,
            dimension.point.reference,
            ["projectedPoint"],
          );
        }
        break;
      case "arcStartPointCoincident":
      case "arcEndPointCoincident":
        if (
          !entityMap.has(dimension.entityId) ||
          !pointMap.has(dimension.pointId)
        ) {
          diagnostics.push(
            makeDiagnostic(
              "missing-arc-endpoint-reference",
              "error",
              `‘${dimension.label}’ references an arc or point that no longer exists.`,
              { kind: "dimension", dimensionId: dimension.dimensionId },
            ),
          );
        }
        break;
    }
  }

  for (const dimensionId of definition.dimensionIds) {
    if (!dimensionMap.has(dimensionId)) {
      diagnostics.push(
        makeDiagnostic(
          "dimension-missing-from-records",
          "error",
          `dimensionIds references missing dimension ${dimensionId}.`,
          { kind: "dimension", dimensionId },
        ),
      );
    }
  }

  for (const reference of definition.references) {
    if (!referenceIds.has(reference.referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "reference-missing-from-order",
          "error",
          `Reference ${reference.referenceId} is not listed in referenceIds.`,
          null,
        ),
      );
    }
  }

  for (const referenceId of definition.referenceIds) {
    if (!referenceMap.has(referenceId)) {
      diagnostics.push(
        makeDiagnostic(
          "reference-missing-from-records",
          "error",
          `referenceIds references missing reference ${referenceId}.`,
          null,
        ),
      );
    }
  }

  for (const style of authoredStyles) {
    if (!styleIds.has(style.styleId)) {
      diagnostics.push(
        makeDiagnostic(
          "style-missing-from-order",
          "error",
          `Style ${style.styleId} is not listed in styleIds.`,
          null,
        ),
      );
    }
  }

  for (const styleId of authoredStyleIds) {
    if (!styleMap.has(styleId)) {
      diagnostics.push(
        makeDiagnostic(
          "style-missing-from-records",
          "error",
          `styleIds references missing style ${styleId}.`,
          null,
        ),
      );
    }
  }

  diagnostics.push(...derivedShellRequirementDiagnostics(definition));

  return {
    isValid: diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
    diagnostics,
  };
}

/** Explicit diagnostic of a requirement a derived shell does not support yet (U-G2). */
export const DERIVED_SHELL_REQUIREMENT_UNSUPPORTED =
  "derived-offset-shell-requirement-unsupported";

/**
 * [TECH] G16′ (U-G9): a requirement naming an output of an offset
 * relationship that failed (or whose derivative is unavailable) at this
 * solve. Its status is `blocked` ([TECH] G16″: it does not count against
 * the sketch's status) with this targeted warning (the relationship carries
 * the error), and it contributes
 * nothing to the solve: stale held outputs never drive the rest.
 */
export const OFFSET_REQUIREMENT_BLOCKED = "derived-offset-requirement-blocked";

/** Every entity ID one constraint or dimension operand names (`entityId` / `entityIds`). */
function referencedEntityIds(value: unknown, into: Set<string>) {
  if (Array.isArray(value)) {
    for (const item of value) referencedEntityIds(item, into);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value)) {
    if (key === "entityId" && typeof item === "string") into.add(item);
    else if (key === "entityIds" && Array.isArray(item))
      for (const id of item)
        if (typeof id === "string") into.add(id);
        else referencedEntityIds(item, into);
  }
}

/**
 * U-G2: a derived piecewise-cubic offset shell supports only `pointOnCurve`
 * with the shell as its curve. Every other constraint or dimension naming a
 * shell is an explicit error (never silently ignored).
 */
function derivedShellRequirementDiagnostics(
  definition: SketchDefinition,
): SketchSolveDiagnostic[] {
  const shellIds = new Set<string>(
    definition.entities
      .filter((entity) => entity.kind === "derivedPiecewiseCubic")
      .map((entity) => entity.entityId),
  );
  if (shellIds.size === 0) return [];
  const diagnostics: SketchSolveDiagnostic[] = [];
  const labels = new Map<string, string>(
    definition.entities.map((entity) => [entity.entityId, entity.label]),
  );
  const check = (
    record: ConstraintDefinition | DimensionDefinition,
    target: SketchSolveDiagnostic["target"],
  ) => {
    const named = new Set<string>();
    referencedEntityIds(record, named);
    const shell = [...named].find((entityId) => shellIds.has(entityId));
    if (!shell) return;
    if (
      record.kind === "pointOnCurve" &&
      "curve" in record &&
      record.curve.entityId === shell &&
      named.size === 1
    )
      return;
    diagnostics.push(
      makeDiagnostic(
        DERIVED_SHELL_REQUIREMENT_UNSUPPORTED,
        "error",
        `‘${record.label}’ uses the offset spline curve ‘${labels.get(shell) ?? "?"}’ as a ${record.kind} target; only point-on-curve is supported on an offset spline curve for now.`,
        target,
      ),
    );
  };
  for (const constraint of definition.constraints)
    check(constraint, {
      kind: "constraint",
      constraintId: constraint.constraintId,
    });
  for (const dimension of definition.dimensions)
    check(dimension, {
      kind: "dimension",
      dimensionId: dimension.dimensionId,
    });
  return diagnostics;
}

function evaluateLoss(
  values: Float64Array,
  constraints: ScalarConstraintRecord[],
): {
  loss: number;
  gradient: Float64Array;
  perConstraint: Map<string, number>;
  evaluations: ConstraintEvaluationRecord[];
} {
  const perConstraint = new Map<string, number>();
  const gradient = zeroVector(values.length);
  const evaluations: ConstraintEvaluationRecord[] = [];
  let loss = 0;
  if (solverWorkTrace) solverWorkTrace.lossEvaluations += 1;

  for (const constraint of constraints) {
    const evaluation = constraint.evaluate(values);
    loss += evaluation.residual;
    addScaled(gradient, 1, evaluation.gradient);
    perConstraint.set(constraint.id, evaluation.residual);
    evaluations.push({
      id: constraint.id,
      targetKind: constraint.targetKind,
      residual: evaluation.residual,
      gradient: evaluation.gradient,
    });
  }

  return { loss, gradient, perConstraint, evaluations };
}

function identityMatrix(size: number) {
  const matrix = Array.from({ length: size }, (_, rowIndex) => {
    const row = new Float64Array(size);
    row[rowIndex] = 1;
    return row;
  });
  return matrix;
}

function multiplyMatrixVector(matrix: Float64Array[], vector: Float64Array) {
  const result = zeroVector(matrix.length);
  for (let row = 0; row < matrix.length; row += 1) {
    result[row] = dot(matrix[row]!, vector);
  }
  return result;
}

function outer(left: Float64Array, right: Float64Array) {
  const matrix = Array.from({ length: left.length }, () =>
    zeroVector(right.length),
  );
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < right.length; column += 1) {
      matrix[row]![column] = left[row]! * right[column]!;
    }
  }
  return matrix;
}

function addScaledMatrix(
  target: Float64Array[],
  scale: number,
  source: Float64Array[],
) {
  for (let row = 0; row < target.length; row += 1) {
    for (let column = 0; column < target[row]!.length; column += 1) {
      target[row]![column] += scale * source[row]![column]!;
    }
  }
}

/**
 * `current` is the caller's evaluation at `values` (cadara-b3k.26): every
 * caller keeps `state` in step with `values`, so re-evaluating the loss here
 * was one redundant `evaluateLoss` per iteration (39% of all evaluations in
 * the drag-frame profile) that returned the same numbers.
 */
function lineSearchWolfe(
  values: Float64Array,
  direction: Float64Array,
  current: { loss: number; gradient: Float64Array },
  constraints: ScalarConstraintRecord[],
) {
  const slope = dot(current.gradient, direction);
  if (slope >= 0) {
    return null;
  }
  let alpha = 1;
  const initial = current;
  if (solverWorkTrace) solverWorkTrace.lineSearches += 1;
  for (
    let iteration = 0;
    iteration < LINE_SEARCH_MAX_ITERATIONS;
    iteration += 1
  ) {
    const candidate = cloneValues(values);
    addScaled(candidate, alpha, direction);
    if (solverWorkTrace) solverWorkTrace.lineSearchTrials += 1;
    const next = evaluateLoss(candidate, constraints);
    if (next.loss <= initial.loss + WOLFE_C1 * alpha * slope) {
      const curvature = dot(next.gradient, direction);
      if (curvature >= WOLFE_C2 * slope) {
        return { alpha, nextValues: candidate, next };
      }
      alpha *= 1.5;
    } else {
      alpha *= 0.5;
    }
  }
  return null;
}

function solveBfgs(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
) {
  const { values, loss, perConstraint } = solveBfgsOver(
    initialValues,
    constraints,
  );
  return { values, loss, perConstraint };
}

/**
 * BFGS over `variableIndices` (every index by default); the other indices
 * keep their initial values and their gradient is not part of the stop test. T13a2 (c3): restricting to a set outside of
 * which every constraint's gradient is zero leaves the iterates unchanged
 * (the identity start keeps those coordinates decoupled), and
 * `initialInverseHessian` only changes the path: the objective, the stop
 * test and a reset to the identity on a failed line search are the same.
 */
function solveBfgsOver(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  options: {
    variableIndices?: readonly number[];
    initialInverseHessian?: Float64Array[] | null;
  } = {},
) {
  const indices =
    options.variableIndices ??
    Array.from({ length: initialValues.length }, (_, index) => index);
  const dimension = indices.length;
  const restrict = (full: Float64Array) => {
    const restricted = zeroVector(dimension);
    for (let index = 0; index < dimension; index += 1) {
      restricted[index] = full[indices[index]!]!;
    }
    return restricted;
  };
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);
  let gradient = restrict(state.gradient);
  let inverseHessian =
    options.initialInverseHessian?.length === dimension
      ? options.initialInverseHessian.map((row) => cloneValues(row))
      : identityMatrix(dimension);
  let recentlyReset = false;

  for (let iteration = 0; iteration < 1000; iteration += 1) {
    // The stop test reads the gradient over the solved variables only:
    // a held (e.g. pinned) variable's gradient cannot be reduced.
    if (state.loss < BFGS_MIN_LOSS || uniformNorm(gradient) < 1e-8) {
      break;
    }

    const searchDirection = multiplyMatrixVector(inverseHessian, gradient);
    const fullDirection = zeroVector(values.length);
    for (let index = 0; index < dimension; index += 1) {
      searchDirection[index] = -searchDirection[index]!;
      fullDirection[indices[index]!] = searchDirection[index]!;
    }

    const step = lineSearchWolfe(values, fullDirection, state, constraints);
    if (!step) {
      if (recentlyReset) {
        break;
      }
      inverseHessian = identityMatrix(dimension);
      recentlyReset = true;
      continue;
    }
    recentlyReset = false;

    const s = cloneValues(searchDirection);
    for (let index = 0; index < s.length; index += 1) {
      s[index] *= step.alpha;
    }

    const nextGradient = restrict(step.next.gradient);
    const y = cloneValues(nextGradient);
    addScaled(y, -1, gradient);
    let sDotY = dot(s, y);
    if (Math.abs(sDotY) < 1e-16) {
      sDotY += 1e-6;
    }

    const hy = multiplyMatrixVector(inverseHessian, y);
    const factor = (sDotY + dot(y, hy)) / (sDotY * sDotY);
    addScaledMatrix(inverseHessian, factor, outer(s, s));
    addScaledMatrix(inverseHessian, -1 / sDotY, outer(hy, s));
    addScaledMatrix(inverseHessian, -1 / sDotY, outer(s, hy));

    values = step.nextValues;
    state = step.next;
    gradient = nextGradient;
  }

  return {
    values,
    loss: state.loss,
    perConstraint: state.perConstraint,
    inverseHessian,
  };
}

function solveGradientDescent(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
) {
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);

  for (let iteration = 0; iteration < 10000; iteration += 1) {
    if (state.loss < 1e-14 || euclideanNorm(state.gradient) < 1e-10) {
      break;
    }

    const direction = cloneValues(state.gradient);
    for (let index = 0; index < direction.length; index += 1) {
      direction[index] = -direction[index]!;
    }

    const step = lineSearchWolfe(values, direction, state, constraints);
    if (!step) {
      break;
    }

    values = step.nextValues;
    state = step.next;
  }

  return { values, loss: state.loss, perConstraint: state.perConstraint };
}

function transpose(matrix: Float64Array[]) {
  const rows = matrix.length;
  const columns = matrix[0]?.length ?? 0;
  const result = Array.from({ length: columns }, () => zeroVector(rows));
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      result[column]![row] = matrix[row]![column]!;
    }
  }
  return result;
}

function multiplyMatrices(left: Float64Array[], right: Float64Array[]) {
  const result = Array.from({ length: left.length }, () =>
    zeroVector(right[0]?.length ?? 0),
  );
  for (let row = 0; row < left.length; row += 1) {
    for (let column = 0; column < (right[0]?.length ?? 0); column += 1) {
      let value = 0;
      for (let inner = 0; inner < right.length; inner += 1) {
        value += left[row]![inner]! * right[inner]![column]!;
      }
      result[row]![column] = value;
    }
  }
  return result;
}

function addDiagonal(matrix: Float64Array[], value: number) {
  const result = matrix.map((row) => cloneValues(row));
  for (let index = 0; index < result.length; index += 1) {
    result[index]![index] += value;
  }
  return result;
}

function symmetricPseudoInverse(matrix: Float64Array[], epsilon: number) {
  const size = matrix.length;
  const eigenvectors = identityMatrix(size);
  const diagonalized = matrix.map((row) => cloneValues(row));
  const maxIterations = Math.max(1, size * size * 25);

  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    let maxOffDiagonal = 0;
    let pivotRow = 0;
    let pivotColumn = 0;

    for (let row = 0; row < size; row += 1) {
      for (let column = row + 1; column < size; column += 1) {
        const value = Math.abs(diagonalized[row]![column]!);
        if (value > maxOffDiagonal) {
          maxOffDiagonal = value;
          pivotRow = row;
          pivotColumn = column;
        }
      }
    }

    if (maxOffDiagonal < 1e-12) {
      break;
    }

    const app = diagonalized[pivotRow]![pivotRow]!;
    const aqq = diagonalized[pivotColumn]![pivotColumn]!;
    const apq = diagonalized[pivotRow]![pivotColumn]!;
    const angle = 0.5 * Math.atan2(2 * apq, aqq - app);
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);

    for (let index = 0; index < size; index += 1) {
      if (index === pivotRow || index === pivotColumn) {
        continue;
      }

      const aip = diagonalized[index]![pivotRow]!;
      const aiq = diagonalized[index]![pivotColumn]!;
      const nextAip = cosine * aip - sine * aiq;
      const nextAiq = sine * aip + cosine * aiq;
      diagonalized[index]![pivotRow] = nextAip;
      diagonalized[pivotRow]![index] = nextAip;
      diagonalized[index]![pivotColumn] = nextAiq;
      diagonalized[pivotColumn]![index] = nextAiq;
    }

    diagonalized[pivotRow]![pivotRow] =
      cosine * cosine * app - 2 * sine * cosine * apq + sine * sine * aqq;
    diagonalized[pivotColumn]![pivotColumn] =
      sine * sine * app + 2 * sine * cosine * apq + cosine * cosine * aqq;
    diagonalized[pivotRow]![pivotColumn] = 0;
    diagonalized[pivotColumn]![pivotRow] = 0;

    for (let index = 0; index < size; index += 1) {
      const vip = eigenvectors[index]![pivotRow]!;
      const viq = eigenvectors[index]![pivotColumn]!;
      eigenvectors[index]![pivotRow] = cosine * vip - sine * viq;
      eigenvectors[index]![pivotColumn] = sine * vip + cosine * viq;
    }
  }

  const result = Array.from({ length: size }, () => zeroVector(size));
  for (let index = 0; index < size; index += 1) {
    const eigenvalue = diagonalized[index]![index]!;
    if (Math.abs(eigenvalue) <= epsilon) {
      continue;
    }
    const scale = 1 / eigenvalue;
    for (let row = 0; row < size; row += 1) {
      for (let column = 0; column < size; column += 1) {
        result[row]![column] +=
          scale * eigenvectors[row]![index]! * eigenvectors[column]![index]!;
      }
    }
  }

  return result;
}

/**
 * T13e2 (C2): solves A·x = b for a symmetric positive semidefinite A by a
 * Cholesky factorization with diagonal pivoting, P·A·Pᵀ = L·Lᵀ, that stops
 * at pivots ≤ `epsilon`·(largest pivot) (rank-revealing). The variables
 * beyond the numerical rank get 0, so the result is a basic solution of the
 * retained block (not the minimum-norm one the pseudo-inverse gives); for a
 * right-hand side in the range of A it solves A·x = b up to rounding (review
 * B-1: the Schur update keeps the trailing block symmetric, because a later
 * pivot swap reads either triangle). O(n³/3), where the classic Jacobi
 * pseudo-inverse is about O(n⁴).
 */
function solvePivotedCholesky(
  matrix: Float64Array[],
  rhs: Float64Array,
  epsilon: number,
) {
  const size = rhs.length;
  const factor = matrix.map((row) => cloneValues(row));
  const order = Array.from({ length: size }, (_, index) => index);
  let rank = 0;
  let largestPivot = 0;
  for (let step = 0; step < size; step += 1) {
    let best = step;
    for (let index = step + 1; index < size; index += 1) {
      if (
        factor[order[index]!]![order[index]!]! >
        factor[order[best]!]![order[best]!]!
      )
        best = index;
    }
    [order[step], order[best]] = [order[best]!, order[step]!];
    const pivotIndex = order[step]!;
    const pivot = factor[pivotIndex]![pivotIndex]!;
    if (step === 0) largestPivot = pivot;
    if (!(pivot > 0) || pivot <= epsilon * largestPivot) break;
    const root = Math.sqrt(pivot);
    factor[pivotIndex]![pivotIndex] = root;
    for (let index = step + 1; index < size; index += 1)
      factor[order[index]!]![pivotIndex] =
        factor[order[index]!]![pivotIndex]! / root;
    for (let column = step + 1; column < size; column += 1) {
      const columnIndex = order[column]!;
      const scale = factor[columnIndex]![pivotIndex]!;
      if (scale === 0) continue;
      for (let row = column; row < size; row += 1) {
        const rowIndex = order[row]!;
        const updated =
          factor[rowIndex]![columnIndex]! -
          factor[rowIndex]![pivotIndex]! * scale;
        factor[rowIndex]![columnIndex] = updated;
        factor[columnIndex]![rowIndex] = updated;
      }
    }
    rank += 1;
  }
  const forward = new Float64Array(rank);
  for (let step = 0; step < rank; step += 1) {
    let sum = rhs[order[step]!]!;
    for (let inner = 0; inner < step; inner += 1)
      sum -= factor[order[step]!]![order[inner]!]! * forward[inner]!;
    forward[step] = sum / factor[order[step]!]![order[step]!]!;
  }
  const solution = zeroVector(size);
  for (let step = rank - 1; step >= 0; step -= 1) {
    let sum = forward[step]!;
    for (let inner = step + 1; inner < rank; inner += 1)
      sum -= factor[order[inner]!]![order[step]!]! * solution[order[inner]!]!;
    solution[order[step]!] = sum / factor[order[step]!]![order[step]!]!;
  }
  return solution;
}

/** T13e2 (review B-1): the fallback's linear solve, for a reference check. */
export function solvePivotedCholeskyForTest(
  matrix: readonly (readonly number[])[],
  rhs: readonly number[],
  epsilon: number,
): number[] {
  return Array.from(
    solvePivotedCholesky(
      matrix.map((row) => Float64Array.from(row)),
      Float64Array.from(rhs),
      epsilon,
    ),
  );
}

/** T13e2 (C2): JᵀJ accumulated from each row's nonzeros (the rows are sparse). */
function sparseNormalMatrix(jacobian: readonly Float64Array[], size: number) {
  const normal = Array.from({ length: size }, () => zeroVector(size));
  for (const row of jacobian) {
    const nonzero: number[] = [];
    for (let index = 0; index < size; index += 1)
      if (row[index] !== 0) nonzero.push(index);
    for (const first of nonzero)
      for (const second of nonzero)
        normal[first]![second] += row[first]! * row[second]!;
  }
  return normal;
}

function solveGaussNewtonLike(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  options: {
    maxIterations: number;
    minLoss: number;
    stepSize: number;
    damping: number;
    pseudoInverseEpsilon: number;
    /**
     * T13e2 (C2): how the damped normal equations are solved. The
     * Gauss–Newton fallback uses the pivoted Cholesky; the explicit
     * strategies keep the Jacobi pseudo-inverse.
     */
    linearSolve?: "pseudoInverse" | "pivotedCholesky";
    /**
     * T13e2 (C1): only a strict loss decrease is progress (the fallback). An
     * equal loss is otherwise accepted, so a stalled inconsistent system runs
     * to `maxIterations`; the explicit strategies keep that behaviour.
     */
    strictDecrease?: boolean;
    /**
     * T13e2 (review A-1): the fallback's goal is an accepted result, so it
     * stops at the first accepted iterate instead of polishing a rescue to
     * `minLoss` or the iteration cap.
     */
    stopWhenAccepted?: (solved: SolvedSystemValues) => boolean;
  },
) {
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);
  const startLoss = state.loss;
  const cholesky = options.linearSolve === "pivotedCholesky";
  let iterations = 0;

  for (
    let iteration = 0;
    iteration < options.maxIterations && state.loss > options.minLoss;
    iteration += 1
  ) {
    iterations += 1;
    const jacobian = state.evaluations.map((evaluation) =>
      cloneValues(evaluation.gradient),
    );
    const losses = new Float64Array(
      state.evaluations.map((evaluation) => evaluation.residual),
    );
    const jT = transpose(jacobian);
    const normal = cholesky
      ? sparseNormalMatrix(jacobian, values.length)
      : multiplyMatrices(jT, jacobian);
    const normalWithDamping = addDiagonal(
      normal,
      options.damping + options.pseudoInverseEpsilon,
    );
    const rhs = multiplyMatrixVector(jT, losses);
    const delta = cholesky
      ? solvePivotedCholesky(
          normalWithDamping,
          rhs,
          options.pseudoInverseEpsilon,
        )
      : multiplyMatrixVector(
          symmetricPseudoInverse(
            normalWithDamping,
            options.pseudoInverseEpsilon,
          ),
          rhs,
        );

    if (!Array.from(delta).every(Number.isFinite)) {
      break;
    }

    let accepted = false;
    let stepScale = options.stepSize;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const nextValues = cloneValues(values);
      addScaled(nextValues, -stepScale, delta);
      if (!Array.from(nextValues).every(Number.isFinite)) {
        stepScale *= 0.5;
        continue;
      }

      const nextState = evaluateLoss(nextValues, constraints);
      if (
        Number.isFinite(nextState.loss) &&
        (options.strictDecrease
          ? nextState.loss < state.loss
          : nextState.loss <= state.loss)
      ) {
        values = nextValues;
        state = nextState;
        accepted = true;
        break;
      }
      stepScale *= 0.5;
    }

    if (
      !accepted ||
      options.stopWhenAccepted?.({
        values,
        loss: state.loss,
        perConstraint: state.perConstraint,
      })
    ) {
      break;
    }
  }

  return {
    values,
    loss: state.loss,
    perConstraint: state.perConstraint,
    iterations,
    startLoss,
  };
}

type SolvedSystemValues = ReturnType<typeof solveBfgs>;

/** T13e2: one Gauss–Newton fallback run, as recorded by `traceSketchSolverForTest`. */
export interface SketchGaussNewtonFallbackTrace {
  /** BFGS was already accepted, so no Gauss–Newton ran (C3). */
  skipped: boolean;
  /** BFGS's end loss. */
  bfgsLoss: number;
  /**
   * The loss Gauss–Newton evaluated at its own start values (C1: equal to
   * `bfgsLoss`, since it continues from BFGS's end values); null if skipped.
   */
  startLoss: number | null;
  /** Gauss–Newton iterations, including a final one without progress. */
  iterations: number;
  linearSolve: "pseudoInverse" | "pivotedCholesky";
}

let gaussNewtonFallbackTrace: SketchGaussNewtonFallbackTrace[] | null = null;

/**
 * cadara-b3k.26: deterministic work counters of one traced run, so specs
 * can pin solver work without timing it. `lossEvaluations` counts every
 * `evaluateLoss`; `lineSearches` every Wolfe line search and
 * `lineSearchTrials` the candidate evaluations inside them. A line search
 * evaluates only its trial points (the start is the caller's current
 * state), so `lossEvaluations − lineSearchTrials` counts the evaluations
 * outside Wolfe searches (solver starts, candidate judging, Gauss–Newton
 * candidates), never one per BFGS iteration.
 */
export interface SketchSolverWorkTrace {
  lossEvaluations: number;
  lineSearches: number;
  lineSearchTrials: number;
}

let solverWorkTrace: SketchSolverWorkTrace | null = null;

/**
 * T13e2: runs `run` and returns the Gauss–Newton fallback runs it made, so
 * specs can pin the fallback's behaviour without timing it; with the
 * cadara-b3k.26 work counters.
 */
export function traceSketchSolverForTest<T>(run: () => T): {
  result: T;
  gaussNewtonFallbacks: SketchGaussNewtonFallbackTrace[];
  work: SketchSolverWorkTrace;
} {
  const previous = gaussNewtonFallbackTrace;
  const previousWork = solverWorkTrace;
  const trace: SketchGaussNewtonFallbackTrace[] = [];
  const work: SketchSolverWorkTrace = {
    lossEvaluations: 0,
    lineSearches: 0,
    lineSearchTrials: 0,
  };
  gaussNewtonFallbackTrace = trace;
  solverWorkTrace = work;
  try {
    return { result: run(), gaussNewtonFallbacks: trace, work };
  } finally {
    gaussNewtonFallbackTrace = previous;
    solverWorkTrace = previousWork;
  }
}

/**
 * BFGS, then (when it is not accepted) Gauss–Newton as a polish or saddle
 * escape. T13e2:
 * - C3: an accepted BFGS result is returned as is. Without an acceptance
 *   callback (drag phase B) a low loss stands for acceptance, as before.
 * - C1: Gauss–Newton continues from BFGS's end values, not from the start:
 *   restarted from the start it re-solved the whole problem on the
 *   half-squared rows (hundreds of iterations on an inconsistent sketch)
 *   and never beat BFGS there.
 * - C2: its normal equations are solved by a pivoted Cholesky.
 * - Review A-1: with an acceptance callback it stops at the first accepted
 *   iterate (a rescue no longer polishes to the 1000-iteration cap).
 */
function solveBfgsWithGaussNewtonFallback(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  isAccepted?: (solved: SolvedSystemValues) => boolean,
) {
  const bfgs = solveBfgs(initialValues, constraints);
  // A low total loss is not acceptance: each requirement is judged against
  // its own document tolerance, which can be tighter than this threshold.
  if (isAccepted ? isAccepted(bfgs) : bfgs.loss < SOLVED_LOSS_THRESHOLD) {
    gaussNewtonFallbackTrace?.push({
      skipped: true,
      bfgsLoss: bfgs.loss,
      startLoss: null,
      iterations: 0,
      linearSolve: "pivotedCholesky",
    });
    return bfgs;
  }

  const gaussNewton = solveGaussNewtonLike(bfgs.values, constraints, {
    maxIterations: 1000,
    minLoss: 1e-14,
    stepSize: 1,
    damping: 0,
    pseudoInverseEpsilon: 1e-12,
    linearSolve: "pivotedCholesky",
    strictDecrease: true,
    ...(isAccepted ? { stopWhenAccepted: isAccepted } : {}),
  });
  gaussNewtonFallbackTrace?.push({
    skipped: false,
    bfgsLoss: bfgs.loss,
    startLoss: gaussNewton.startLoss,
    iterations: gaussNewton.iterations,
    linearSolve: "pivotedCholesky",
  });
  return gaussNewton.loss < bfgs.loss ? gaussNewton : bfgs;
}

function solveSystemValues(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  strategy: SketchSolveStrategy,
  /** Absent (drag phase B): a low loss stands for acceptance. */
  isAccepted?: (solved: SolvedSystemValues) => boolean,
) {
  return strategy === "gradientDescent"
    ? solveGradientDescent(initialValues, constraints)
    : strategy === "gaussNewton"
      ? solveGaussNewtonLike(initialValues, constraints, {
          maxIterations: 500,
          minLoss: 1e-8,
          stepSize: 1,
          damping: 0,
          pseudoInverseEpsilon: 1e-6,
        })
      : strategy === "levenbergMarquardt"
        ? solveGaussNewtonLike(initialValues, constraints, {
            maxIterations: 1000,
            minLoss: 1e-10,
            stepSize: 0.1,
            damping: 1e-5,
            pseudoInverseEpsilon: 1e-6,
          })
        : strategy === "bfgsWithoutFallback"
          ? solveBfgs(initialValues, constraints)
          : solveBfgsWithGaussNewtonFallback(
              initialValues,
              constraints,
              isAccepted,
            );
}

function createStableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function createSketchSolveCompatibilityKey(input: {
  definition: SketchDefinition;
  projectedReferences: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  modelingTolerance: number;
  offsetPlans: readonly SolvedOffsetFramePlanRecord[] | undefined;
  partialSolvePolicy: SolverPartialSolvePolicy;
  strategy: SketchSolveStrategy;
}) {
  const structuralDefinition = {
    schemaVersion: input.definition.schemaVersion,
    referenceIds: input.definition.referenceIds,
    references: input.definition.references,
    pointIds: input.definition.pointIds,
    entityIds: input.definition.entityIds,
    entities: input.definition.entities,
    constraintIds: input.definition.constraintIds,
    constraints: input.definition.constraints,
    dimensionIds: input.definition.dimensionIds,
    dimensions: input.definition.dimensions,
    derivedRelationships: input.definition.derivedRelationships,
  };
  return JSON.stringify({
    definition: structuralDefinition,
    projectedReferences: input.projectedReferences.map((reference) => ({
      referenceId: reference.referenceId,
      status: reference.status,
      geometry: reference.geometry,
    })),
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans ?? null,
    partialSolvePolicy: input.partialSolvePolicy,
    strategy: input.strategy,
  });
}

class VariableUnionFind {
  private readonly parents: number[];

  constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parents[index]!;
    if (parent === index) {
      return index;
    }
    const root = this.find(parent);
    this.parents[index] = root;
    return root;
  }

  union(left: number, right: number) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parents[rightRoot] = leftRoot;
    }
  }
}

function nonZeroGradientIndices(gradient: Float64Array) {
  const indices: number[] = [];
  for (let index = 0; index < gradient.length; index += 1) {
    if (Math.abs(gradient[index]!) > 1e-12) {
      indices.push(index);
    }
  }
  return indices;
}

function uniqueSortedIndices(indices: Iterable<number>) {
  return Array.from(new Set(indices)).sort((left, right) => left - right);
}

function pointVariableIndices(point: SolverPointRecord | null | undefined) {
  return point ? [point.baseIndex, point.baseIndex + 1] : [];
}

function entityVariableIndices(
  entity: SketchEntityDefinition | null | undefined,
  system: BuildSystemResult,
) {
  if (!entity) {
    return [];
  }

  if (entity.kind === "derivedPiecewiseCubic")
    return [...(system.shellSourceVariables.get(entity.entityId) ?? [])];
  const pointIndices = getEntityPoints(entity).flatMap((pointId) =>
    pointVariableIndices(system.pointRecords.get(pointId)),
  );
  const entityState = system.entityStates.get(entity.entityId);
  const stateIndices =
    entityState && entityState.kind !== "point"
      ? entityState.kind === "circle"
        ? [entityState.baseIndex]
        : [
            entityState.baseIndex,
            entityState.baseIndex + 1,
            entityState.baseIndex + 2,
          ]
      : [];
  const tangentIndices =
    entity.kind === "spline"
      ? (orderedSplineOccurrences(entity) ?? []).flatMap((occurrence) => {
          const state = system.splineTangentStates.get(
            splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
          );
          return state ? [state.baseIndex, state.baseIndex + 1] : [];
        })
      : [];

  return uniqueSortedIndices([
    ...pointIndices,
    ...stateIndices,
    ...tangentIndices,
  ]);
}

function curveOperandVariableIndices(
  operand: SketchCurveConstraintOperand,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  return operand.kind === "localEntity"
    ? entityVariableIndices(entityById.get(operand.entityId), system)
    : [];
}

function pointOperandVariableIndices(
  operand: SketchPointConstraintOperand,
  system: BuildSystemResult,
) {
  return operand.kind === "localPoint"
    ? pointVariableIndices(system.pointRecords.get(operand.pointId))
    : [];
}

function collinearTargetVariableIndices(
  operand: LocalCollinearTargetOperand,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  return operand.kind === "localPoint"
    ? pointVariableIndices(system.pointRecords.get(operand.pointId))
    : entityVariableIndices(entityById.get(operand.entityId), system);
}

function structuralConstraintVariableIndices(
  constraint: ConstraintDefinition,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return uniqueSortedIndices(
        constraint.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
      );
    case "horizontal":
    case "vertical":
      return entityVariableIndices(entityById.get(constraint.entityId), system);
    case "fixPoint":
      return pointVariableIndices(system.pointRecords.get(constraint.pointId));
    case "equalOffset":
      return uniqueSortedIndices(
        constraint.pairs.flatMap((pair) => [
          ...entityVariableIndices(entityById.get(pair.seedEntityId), system),
          ...entityVariableIndices(entityById.get(pair.offsetEntityId), system),
        ]),
      );
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "tangent":
    case "concentric":
      return uniqueSortedIndices(
        constraint.entityIds.flatMap((entityId) =>
          entityVariableIndices(entityById.get(entityId), system),
        ),
      );
    case "coincidentProjectedPoint":
    case "pointOnProjectedCurve":
    case "midpointProjectedLine":
      return pointVariableIndices(
        system.pointRecords.get(constraint.point.pointId),
      );
    case "midpoint":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
      ]);
    case "pointOnCurve":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.curve.entityId),
          system,
        ),
      ]);
    case "collinear":
      return uniqueSortedIndices([
        ...collinearTargetVariableIndices(
          constraint.target,
          entityById,
          system,
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
      ]);
    case "collinearProjectedLine":
      return collinearTargetVariableIndices(
        constraint.target,
        entityById,
        system,
      );
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return entityVariableIndices(
        entityById.get(constraint.line.entityId),
        system,
      );
    case "tangentProjectedCurve":
    case "concentricProjectedCurve":
      return entityVariableIndices(
        entityById.get(constraint.curve.entityId),
        system,
      );
    case "normal":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
        ...entityVariableIndices(
          entityById.get(constraint.curve.entityId),
          system,
        ),
      ]);
    case "normalProjectedCurve":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
      ]);
    case "symmetric":
      return uniqueSortedIndices([
        ...constraint.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.axis.entityId),
          system,
        ),
      ]);
    case "symmetricProjectedLine":
      return uniqueSortedIndices(
        constraint.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
      );
  }
}

function structuralDimensionVariableIndices(
  dimension: DimensionDefinition,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance":
      return uniqueSortedIndices(
        dimension.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
      );
    case "pointDatumDistance":
      return pointVariableIndices(
        system.pointRecords.get(dimension.point.pointId),
      );
    case "circleRadius":
    case "diameter":
    case "lineLength":
      return entityVariableIndices(entityById.get(dimension.entityId), system);
    case "lineDistance":
    case "lineAngle":
      return uniqueSortedIndices(
        dimension.lines.flatMap((operand) =>
          curveOperandVariableIndices(operand, entityById, system),
        ),
      );
    case "linePointDistance":
      return uniqueSortedIndices([
        ...curveOperandVariableIndices(dimension.line, entityById, system),
        ...pointOperandVariableIndices(dimension.point, system),
      ]);
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return uniqueSortedIndices([
        ...entityVariableIndices(entityById.get(dimension.entityId), system),
        ...pointVariableIndices(system.pointRecords.get(dimension.pointId)),
      ]);
  }
}

function structuralEquationVariableIndexMap(
  system: BuildSystemResult,
  definition: SketchDefinition,
) {
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const variablesById = new Map<ConstraintId | DimensionId, number[]>();

  for (const constraint of definition.constraints) {
    variablesById.set(
      constraint.constraintId,
      structuralConstraintVariableIndices(constraint, entityById, system),
    );
  }

  for (const dimension of definition.dimensions) {
    variablesById.set(
      dimension.dimensionId,
      structuralDimensionVariableIndices(dimension, entityById, system),
    );
  }

  return variablesById;
}

function perturbedEquationVariableIndices(
  constraint: ScalarConstraintRecord,
  values: Float64Array,
) {
  const base = constraint.evaluate(values);
  const indices = new Set(nonZeroGradientIndices(base.gradient));

  for (let index = 0; index < values.length; index += 1) {
    const step = Math.max(
      EQUATION_SUPPORT_PERTURBATION,
      Math.abs(values[index]!) * 1e-6,
    );
    const plus = cloneValues(values);
    const minus = cloneValues(values);
    plus[index] += step;
    minus[index] -= step;

    const plusLoss = constraint.evaluate(plus).residual;
    const minusLoss = constraint.evaluate(minus).residual;
    if (
      Number.isFinite(plusLoss) &&
      Number.isFinite(minusLoss) &&
      Math.max(
        Math.abs(plusLoss - base.residual),
        Math.abs(minusLoss - base.residual),
      ) > EQUATION_SUPPORT_LOSS_EPSILON
    ) {
      indices.add(index);
    }
  }

  return uniqueSortedIndices(indices);
}

function buildCompiledComponentData(
  system: BuildSystemResult,
  definition: SketchDefinition,
): {
  components: SketchCompiledSolveComponent[];
  equationMetadata: SketchCompiledEquationMetadata[];
} {
  const unionFind = new VariableUnionFind(system.parameterCount);
  const structuralVariables = structuralEquationVariableIndexMap(
    system,
    definition,
  );
  const equationVariables = system.scalarConstraints.map((constraint) => {
    const variables =
      structuralVariables.get(constraint.id) ??
      constraint.structuralVariableIndices;
    return system.parameterProjection.projectVariableIndices(
      variables && variables.length > 0
        ? variables
        : perturbedEquationVariableIndices(constraint, system.initialValues),
    );
  });

  for (const point of system.pointRecords.values()) {
    const variables = system.parameterProjection.projectVariableIndices([
      point.baseIndex,
      point.baseIndex + 1,
    ]);
    const [first, ...rest] = variables;
    if (first !== undefined) {
      for (const next of rest) unionFind.union(first, next);
    }
  }

  for (const entity of definition.entities) {
    const variables = system.parameterProjection.projectVariableIndices(
      entityVariableIndices(entity, system),
    );
    const [first, ...rest] = variables;
    if (first === undefined) {
      continue;
    }
    for (const next of rest) {
      unionFind.union(first, next);
    }
  }

  for (const variables of equationVariables) {
    const [first, ...rest] = variables;
    if (first === undefined) {
      continue;
    }
    for (const next of rest) {
      unionFind.union(first, next);
    }
  }

  const variablesByRoot = new Map<number, number[]>();
  for (const index of system.parameterProjection.authorityVariableIndices) {
    const root = unionFind.find(index);
    const variables = variablesByRoot.get(root) ?? [];
    variables.push(index);
    variablesByRoot.set(root, variables);
  }

  const rootToComponentId = new Map<number, number>();
  const componentEntries = Array.from(variablesByRoot.entries()).map(
    ([root, variableIndices], componentId) => {
      rootToComponentId.set(root, componentId);
      return { root, componentId, variableIndices };
    },
  );
  const equationIndicesByComponent = new Map<number, number[]>();
  const equationMetadata: SketchCompiledEquationMetadata[] = [];

  equationVariables.forEach((variableIndices, equationIndex) => {
    const constraint = system.scalarConstraints[equationIndex]!;
    const componentId =
      variableIndices[0] === undefined
        ? 0
        : (rootToComponentId.get(unionFind.find(variableIndices[0])) ?? 0);
    const equationIndices = equationIndicesByComponent.get(componentId) ?? [];
    equationIndices.push(equationIndex);
    equationIndicesByComponent.set(componentId, equationIndices);
    equationMetadata.push({
      equationIndex,
      id: constraint.id,
      targetKind: constraint.targetKind,
      variableIndices,
      componentId,
    });
  });

  const pointIdsByComponent = new Map<number, SketchPointId[]>();
  for (const point of system.pointRecords.values()) {
    const authority = system.parameterProjection.projectVariableIndices([
      point.baseIndex,
      point.baseIndex + 1,
    ]);
    const first = authority[0];
    if (first === undefined) continue;
    const componentId = rootToComponentId.get(unionFind.find(first));
    if (componentId === undefined) continue;
    const pointIds = pointIdsByComponent.get(componentId) ?? [];
    pointIds.push(point.pointId);
    pointIdsByComponent.set(componentId, pointIds);
  }

  const entityIdsByComponent = new Map<number, SketchEntityId[]>();
  for (const entity of definition.entities) {
    const authority = system.parameterProjection.projectVariableIndices(
      entityVariableIndices(entity, system),
    );
    const first = authority[0];
    if (first === undefined) continue;
    const componentId = rootToComponentId.get(unionFind.find(first));
    if (componentId === undefined) continue;
    const entityIds = entityIdsByComponent.get(componentId) ?? [];
    entityIds.push(entity.entityId);
    entityIdsByComponent.set(componentId, entityIds);
  }

  const components = componentEntries.map(
    ({ componentId, variableIndices }) => ({
      componentId,
      variableIndices,
      equationIndices: equationIndicesByComponent.get(componentId) ?? [],
      pointIds: pointIdsByComponent.get(componentId) ?? [],
      entityIds: entityIdsByComponent.get(componentId) ?? [],
    }),
  );

  return { components, equationMetadata };
}

function resolvePointConstraintTarget(
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

function preconditionValuesForPointAnchors(
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

    if (deltas.length === 0) {
      continue;
    }

    const first = deltas[0]!;
    if (
      deltas.some(
        (delta) =>
          length(subtract(delta, first)) > program.tolerances.coincidence,
      )
    ) {
      continue;
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
function assertSolveModelingTolerance(modelingTolerance: unknown) {
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

function seedSolveValuesFromSnapshot(
  program: SketchCompiledSolveProgram,
  solvedSnapshot: SolvedSketchSnapshot | null | undefined,
) {
  const values = cloneValues(program.system.initialValues);
  if (!solvedSnapshot) {
    return { values, warmStarted: false };
  }

  let seeded = false;
  for (const point of solvedSnapshot.solvedPoints) {
    const record = program.system.pointRecords.get(point.pointId);
    if (!record) {
      continue;
    }
    values[record.baseIndex] = point.solvedPosition[0];
    values[record.baseIndex + 1] = point.solvedPosition[1];
    seeded = true;
  }

  for (const entity of solvedSnapshot.solvedEntities) {
    const state = program.system.entityStates.get(entity.entityId);
    if (!state) {
      continue;
    }
    if (state.kind === "circle" && entity.kind === "circle") {
      values[state.baseIndex] = entity.solvedRadius;
      seeded = true;
    }
    if (state.kind === "arc" && entity.kind === "arc") {
      values[state.baseIndex] = length(
        subtract(entity.startPosition, entity.centerPosition),
      );
      values[state.baseIndex + 1] = Math.atan2(
        entity.startPosition[1] - entity.centerPosition[1],
        entity.startPosition[0] - entity.centerPosition[0],
      );
      values[state.baseIndex + 2] = Math.atan2(
        entity.endPosition[1] - entity.centerPosition[1],
        entity.endPosition[0] - entity.centerPosition[0],
      );
      seeded = true;
    }
    if (
      entity.kind === "spline" &&
      entity.reconstruction.validity === "valid"
    ) {
      const reconstruction = entity.reconstruction;
      const authored = program.definition.entities.find(
        (candidate) =>
          candidate.entityId === entity.entityId && candidate.kind === "spline",
      );
      if (authored?.kind === "spline") {
        (orderedSplineOccurrences(authored) ?? []).forEach(
          (occurrence, occurrenceIndex) => {
            if (occurrence.tangent.kind !== "authored") return;
            const tangentState = program.system.splineTangentStates.get(
              splineTangentStateKey(authored.entityId, occurrence.occurrenceId),
            );
            const handle = reconstruction.handles[occurrenceIndex];
            if (!tangentState || !handle) return;
            values[tangentState.baseIndex] = handle[0];
            values[tangentState.baseIndex + 1] = handle[1];
            seeded = true;
          },
        );
      }
    }
  }

  return { values, warmStarted: seeded };
}

function offsetArcCommonCircleDiagnostics(
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

function materializeSolveResult(
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
  if (!program.validation.isValid || !geometryValid) {
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
      constraintState: "wellConstrained",
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

/** [TECH] G16′: authored requirement id → the offset relationships blocking it at `values`. */
function offsetBlockedRequirements(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
): ReadonlyMap<
  ConstraintId | DimensionId,
  readonly OffsetRequirementBlocker[]
> {
  const blocked = new Map<
    ConstraintId | DimensionId,
    OffsetRequirementBlocker[]
  >();
  for (const record of program.system.scalarConstraints) {
    if (!record.offsetBlockers) continue;
    const blockers = record.offsetBlockers(values);
    if (blockers.length === 0) continue;
    const entry = blocked.get(record.id) ?? [];
    for (const blocker of blockers)
      if (
        !entry.some(
          (known) =>
            known.derivationId === blocker.derivationId &&
            known.reason === blocker.reason,
        )
      )
        entry.push(blocker);
    blocked.set(record.id, entry);
  }
  return blocked;
}

/**
 * [TECH] G16‴: the status an offset relationship forces on a requirement
 * naming its outputs, or null when its own residual decides (none, or only
 * a singular derivative: review R1). A failure that appeared during the
 * solve is `unsatisfied`; one already present at the start is `blocked`.
 */
function offsetRequirementStatus(
  blockers: readonly OffsetRequirementBlocker[] | undefined,
): "blocked" | "unsatisfied" | null {
  if (blockers?.some((blocker) => blocker.reason === "failedDuringSolve"))
    return "unsatisfied";
  if (blockers?.some((blocker) => blocker.reason === "failed"))
    return "blocked";
  return null;
}

/**
 * The targeted warnings of the requirements naming offset outputs, in
 * definition order: one `derived-offset-requirement-blocked` per blocked
 * requirement and one `derived-offset-derivative-unavailable` per
 * requirement solved without its gradient through a singular offset (review
 * R1). A requirement that is unsatisfied because its relationship failed
 * during the solve gets the ordinary unsatisfied reporting; the
 * relationship reports its own failure.
 */
function blockedRequirementDiagnostics(
  definition: SketchDefinition,
  blocked: ReadonlyMap<
    ConstraintId | DimensionId,
    readonly OffsetRequirementBlocker[]
  >,
): SketchSolveDiagnostic[] {
  if (blocked.size === 0) return [];
  const relationshipLabels = new Map(
    (definition.derivedRelationships ?? []).map((relationship) => [
      relationship.derivationId,
      relationship.label,
    ]),
  );
  const targeted = (
    label: string,
    id: string,
    target: SketchSolveDiagnostic["target"],
  ): SketchSolveDiagnostic[] => {
    const blockers = blocked.get(id as ConstraintId | DimensionId) ?? [];
    // T17e (B2): the requirement and its offsets by label, never by id.
    const ids = (reason: OffsetRequirementBlocker["reason"]) =>
      blockers
        .filter((blocker) => blocker.reason === reason)
        .map(
          (blocker) =>
            `‘${relationshipLabels.get(blocker.derivationId) ?? "?"}’`,
        )
        .join(", ");
    const status = offsetRequirementStatus(blockers);
    const singular = ids("derivativeUnavailable");
    return [
      ...(status === "blocked"
        ? [
            makeDiagnostic(
              OFFSET_REQUIREMENT_BLOCKED,
              "warning",
              `‘${label}’ names a curve of offset ${ids("failed")} (its solve frame failed, so its curves are held); it is blocked and not solved until the offset evaluates again.`,
              target,
            ),
          ]
        : []),
      ...(status === null && singular
        ? [
            makeDiagnostic(
              OFFSET_DIAGNOSTIC_CODES.derivativeUnavailable,
              "warning",
              `‘${label}’ names a curve of offset ${singular}, whose derivative is unavailable at this solve (a singular joint); it is solved without its gradient through the offset.`,
              target,
            ),
          ]
        : []),
    ];
  };
  return [
    ...definition.constraints.flatMap((constraint) =>
      targeted(constraint.label, constraint.constraintId, {
        kind: "constraint",
        constraintId: constraint.constraintId,
      }),
    ),
    ...definition.dimensions.flatMap((dimension) =>
      targeted(dimension.label, dimension.dimensionId, {
        kind: "dimension",
        dimensionId: dimension.dimensionId,
      }),
    ),
  ];
}

/**
 * [TECH] G16′: the one relationship-scoped diagnostic of each failed offset
 * relationship (its evaluation failure), in definition order.
 */
function offsetRelationshipDiagnostics(
  definition: SketchDefinition,
  evaluation: SketchDerivationEvaluationResult | null,
): SketchSolveDiagnostic[] {
  const failures = evaluation?.offsetFailures ?? [];
  return (definition.derivedRelationships ?? []).flatMap((relationship) => {
    if (relationship.kind !== "offset") return [];
    const failure = failures.find(
      (candidate) => candidate.derivationId === relationship.derivationId,
    );
    return failure ? [failure.diagnostic] : [];
  });
}

/**
 * [TECH] G16⁗: the relationships of the current solve's blocked set that a
 * requirement names and that build at `values` (their requirements were
 * held blocked, so their real residuals are still unknown).
 */
function rebuiltBlockedOffsets(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
): ReadonlySet<string> {
  const failing =
    program.system.parameterProjection.relationshipFailuresAt(values);
  const rebuilt = new Set<string>();
  for (const blockers of offsetBlockedRequirements(program, values).values())
    for (const blocker of blockers)
      if (blocker.reason === "failed" && !failing.has(blocker.derivationId))
        rebuilt.add(blocker.derivationId);
  return rebuilt;
}

/**
 * [TECH] G16‴ + G16⁗: one solve from `startValues` with at most one
 * re-solve on rebuild.
 * - The blocked set is the offset relationships failing at `startValues`,
 *   decided once. A requirement naming one of them is held blocked for the
 *   whole solve, also at iterates where it builds again (re-review A-1:
 *   its real residual appearing there would reward staying failed).
 * - If a held relationship that a requirement names builds at the end
 *   values, the first result is re-evaluated there with those
 *   relationships out of the blocked set (their requirements use real
 *   residuals). If that is accepted, it is the result (the solver's own
 *   acceptance: a re-solve cannot be better). Otherwise the problem is
 *   re-solved exactly once from the end values with the reduced set, where
 *   a mid-solve failure is unbounded as in any solve.
 * - The re-solve is judged the same way (a held relationship building at
 *   its end values is re-evaluated, never re-solved again) and replaces
 *   the first result only when it is accepted.
 * Without a failure at the start this is the one plain solve.
 */
function solveWithRebuildRetry<T>(input: {
  program: SketchCompiledSolveProgram;
  startValues: Float64Array;
  solve: () => T;
  retry: (from: Float64Array) => T;
  valuesOf: (result: T) => Float64Array | null;
  reevaluate: (values: Float64Array) => T;
  isAccepted: (result: T) => boolean;
}): T {
  const projection = input.program.system.parameterProjection;
  const run = (blocked: ReadonlySet<string>, solve: () => T) =>
    projection.withBlockedRelationships(blocked, () => {
      const result = solve();
      const values = blocked.size > 0 ? input.valuesOf(result) : null;
      return {
        result,
        values,
        rebuilt: values
          ? rebuiltBlockedOffsets(input.program, values)
          : new Set<string>(),
      };
    });
  const without = (
    blocked: ReadonlySet<string>,
    rebuilt: ReadonlySet<string>,
  ): ReadonlySet<string> =>
    new Set([...blocked].filter((derivationId) => !rebuilt.has(derivationId)));
  const judged = (
    blocked: ReadonlySet<string>,
    solved: ReturnType<typeof run>,
  ) =>
    solved.rebuilt.size === 0
      ? solved.result
      : projection.withBlockedRelationships(
          without(blocked, solved.rebuilt),
          () => input.reevaluate(solved.values!),
        );

  const blockedAtStart = projection.relationshipFailuresAt(input.startValues);
  const first = run(blockedAtStart, input.solve);
  if (first.rebuilt.size === 0) return first.result;
  const kept = judged(blockedAtStart, first);
  if (input.isAccepted(kept)) return kept;
  const blocked = without(blockedAtStart, first.rebuilt);
  const retried = judged(
    blocked,
    run(blocked, () => input.retry(first.values!)),
  );
  return input.isAccepted(retried) ? retried : kept;
}

/**
 * One batch solve of `program` from `startValues` (no rebuild handling).
 *
 * T13e2 (B4): a rejected result is re-solved with the drag minimum-motion
 * term anchored at the start (`createMinimumMotionAnchorConstraint`,
 * `DRAG_MINIMUM_MOTION_EPSILON`), and that result is reported. An
 * inconsistent system has no exact solution, and the plain least-squares
 * descent can slide towards an unattained infimum (kilometres along a
 * line's extension); the anchored solve is the nearest compromise. Only the
 * components holding an unsatisfied requirement (or a degenerate solved
 * line) are re-solved, from their start values; every other component keeps
 * its plain solution, so a consistent part that needs a large move is not
 * pulled back by the anchor. The anchor only changes rejected results (it
 * may also find an accepted one near the start). Statuses are judged on the
 * hard requirements alone. A solve whose start already has a failing offset
 * relationship is left to the [TECH] G16‴/G16⁗ blocked-set and rebuild
 * handling, unchanged. Only the normal `"bfgs"` strategy re-solves: the
 * explicit Gauss–Newton/Levenberg–Marquardt/gradient strategies keep their
 * own result (the re-solve is a BFGS solve), and the redundancy probe's
 * `"bfgsWithoutFallback"` trials only need the verdict, which is never
 * displayed or stored (the re-solve would double the cost of a rejected
 * trial).
 */
function solveProgramValues(
  program: SketchCompiledSolveProgram,
  startValues: Float64Array,
  /**
   * T15c (axis preference): `frozen` variables are excluded from the solved
   * set (stage 1); `components` restricts the solve, and its B4 re-solve,
   * to those components' equations, every other variable keeping its start
   * value (stage 2). Absent: the whole system, as before.
   */
  stage: {
    frozen?: ReadonlySet<number>;
    components?: readonly SketchCompiledSolveComponent[];
  } = {},
) {
  const frozen = stage.frozen ?? NO_FROZEN_VARIABLES;
  const scope = stage.components;
  // A restricted solve reports its loss over every equation.
  const judged = (candidate: SolvedSystemValues): SolvedSystemValues => {
    if (!scope) return candidate;
    const state = evaluateLoss(
      candidate.values,
      program.system.scalarConstraints,
    );
    return {
      values: candidate.values,
      loss: state.loss,
      perConstraint: state.perConstraint,
    };
  };
  const solved = judged(
    solveSystemValues(
      startValues,
      withFrozenVariables(
        scope
          ? scope.flatMap((component) =>
              component.equationIndices.map(
                (equationIndex) =>
                  program.system.scalarConstraints[equationIndex]!,
              ),
            )
          : program.system.scalarConstraints,
        frozen,
      ),
      program.strategy,
      (candidate) => isAcceptableSolvedValues(program, judged(candidate)),
    ),
  );
  const plain = {
    solved,
    result: materializeSolveResult(program, solved.values, solved),
  };
  const snapshot = plain.result.solvedSnapshot;
  if (
    isAcceptableSolvedSnapshot(snapshot) ||
    program.strategy !== "bfgs" ||
    // T15b (review A6): any relationship failing at the start (offset or mirror).
    program.system.parameterProjection.relationshipFailuresAt(startValues)
      .size > 0
  ) {
    return plain;
  }
  const unsatisfiedIds = new Set<string>([
    ...snapshot.constraintStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.constraintId] : [],
    ),
    ...snapshot.dimensionStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.dimensionId] : [],
    ),
  ]);
  const degenerateVariables = new Set(
    snapshot.diagnostics.flatMap((diagnostic) => {
      if (
        diagnostic.code !== "degenerate-solved-line-segment" ||
        diagnostic.target?.kind !== "entity"
      )
        return [];
      const entityId = diagnostic.target.entityId;
      const line = program.definition.entities.find(
        (entity) => entity.entityId === entityId,
      );
      return line?.kind === "lineSegment"
        ? [line.startPointId, line.endPointId].flatMap((pointId) =>
            pointVariableIndices(program.system.pointRecords.get(pointId)),
          )
        : [];
    }),
  );
  const conflicted = (scope ?? program.components).filter(
    (component) =>
      component.equationIndices.some((equationIndex) =>
        unsatisfiedIds.has(program.system.scalarConstraints[equationIndex]!.id),
      ) ||
      component.variableIndices.some((index) => degenerateVariables.has(index)),
  );
  if (conflicted.length === 0) {
    return plain;
  }
  const variableIndices = uniqueSortedIndices(
    conflicted.flatMap((component) =>
      component.variableIndices.filter((index) => !frozen.has(index)),
    ),
  );
  const anchor = createMinimumMotionAnchorConstraint({
    id: "constraint_commit_minimum_motion" as ConstraintId,
    parameterCount: program.system.parameterCount,
    anchorValues: startValues,
    variableIndices,
    weight: DRAG_MINIMUM_MOTION_EPSILON,
    parameterProjection: program.system.parameterProjection,
  });
  const restart = cloneValues(solved.values);
  for (const index of variableIndices) restart[index] = startValues[index]!;
  const anchoredValues = solveBfgsOver(
    restart,
    [
      ...conflicted.flatMap((component) =>
        component.equationIndices.map(
          (equationIndex) => program.system.scalarConstraints[equationIndex]!,
        ),
      ),
      anchor,
    ],
    { variableIndices },
  ).values;
  const state = evaluateLoss(anchoredValues, program.system.scalarConstraints);
  const anchored: SolvedSystemValues = {
    values: anchoredValues,
    loss: state.loss,
    perConstraint: state.perConstraint,
  };
  return {
    solved: anchored,
    result: materializeSolveResult(program, anchored.values, anchored),
  };
}

/** [TECH] G16⁗: a batch or session solve result re-materialized at `values`. */
function reevaluateProgramValues(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
) {
  const state = evaluateLoss(values, program.system.scalarConstraints);
  const solved: SolvedSystemValues = {
    values: cloneValues(values),
    loss: state.loss,
    perConstraint: state.perConstraint,
  };
  return {
    solved,
    result: materializeSolveResult(program, solved.values, solved),
  };
}

const NO_FROZEN_VARIABLES: ReadonlySet<number> = new Set();

/**
 * T15c: `constraints` with the `frozen` variables excluded from the solved
 * set: their gradient entries are zero, so no strategy moves them (BFGS,
 * Gauss–Newton and gradient descent all step along the gradient's span).
 * Residuals, and so statuses and acceptance, are unchanged.
 */
function withFrozenVariables(
  constraints: ScalarConstraintRecord[],
  frozen: ReadonlySet<number>,
): ScalarConstraintRecord[] {
  if (frozen.size === 0) return constraints;
  const indices = [...frozen];
  return constraints.map((constraint) => ({
    ...constraint,
    evaluate(values) {
      const evaluation = constraint.evaluate(values);
      if (indices.every((index) => evaluation.gradient[index] === 0))
        return evaluation;
      const gradient = evaluation.gradient.slice();
      for (const index of indices) gradient[index] = 0;
      return { ...evaluation, gradient };
    },
  }));
}

/** T15c: one mirror's line axis: its points, their variables and their authority. */
type MirrorAxisVariables = {
  pointIds: readonly SketchPointId[];
  variables: readonly number[];
  authority: readonly number[];
};

const mirrorAxisVariablesByProgram = new WeakMap<
  SketchCompiledSolveProgram,
  readonly MirrorAxisVariables[]
>();

/**
 * T15c: the line axes of the program's mirror relationships. A sketch datum
 * axis has no variables (fixed by construction), and a missing or non-line
 * axis (a failed mirror) has nothing to preserve.
 */
function mirrorAxisVariables(
  program: SketchCompiledSolveProgram,
): readonly MirrorAxisVariables[] {
  const cached = mirrorAxisVariablesByProgram.get(program);
  if (cached) return cached;
  const entities = new Map(
    program.definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const axes = (program.definition.derivedRelationships ?? []).flatMap(
    (relationship) => {
      if (
        relationship.kind !== "mirror" ||
        relationship.mirrorReference.kind !== "lineEntity"
      )
        return [];
      const axis = entities.get(relationship.mirrorReference.entityId);
      if (axis?.kind !== "lineSegment") return [];
      const pointIds = [axis.startPointId, axis.endPointId];
      const variables = pointIds.flatMap((pointId) =>
        pointVariableIndices(program.system.pointRecords.get(pointId)),
      );
      return [
        {
          pointIds,
          variables,
          authority:
            program.system.parameterProjection.projectVariableIndices(
              variables,
            ),
        },
      ];
    },
  );
  mirrorAxisVariablesByProgram.set(program, axes);
  return axes;
}

const mirrorSourcePointsByProgram = new WeakMap<
  SketchCompiledSolveProgram,
  ReadonlyMap<SketchPointId, SketchPointId>
>();

/**
 * T15c (review R-1b): a mirror output point's source: its seed point,
 * followed through chains (a mirror of a mirror output) to the first point
 * that is not a mirror output. Bounded by the number of mirror outputs, so a
 * malformed cycle stops (T15b fails it explicitly elsewhere).
 */
function mirrorSourcePoint(
  program: SketchCompiledSolveProgram,
  pointId: SketchPointId,
): SketchPointId {
  let seeds = mirrorSourcePointsByProgram.get(program);
  if (!seeds) {
    const entries = new Map<SketchPointId, SketchPointId>();
    for (const relationship of program.definition.derivedRelationships ?? []) {
      if (relationship.kind !== "mirror") continue;
      for (const output of relationship.outputs)
        output.outputPointIds.forEach((outputPointId, index) => {
          const seedPointId = output.seedPointIds[index];
          if (seedPointId) entries.set(outputPointId, seedPointId);
        });
    }
    seeds = entries;
    mirrorSourcePointsByProgram.set(program, seeds);
  }
  let source = pointId;
  for (let step = 0; step < seeds.size && seeds.has(source); step += 1)
    source = seeds.get(source)!;
  return source;
}

/**
 * T15c (issue 15, [TECH] T-6 + R-7; review R-1): the axis authority
 * variables a drag frame keeps fixed in its first stage: every mirror axis in
 * the dragged component (a chain's upstream axes included: their authority
 * is in the component through the projection), except an axis the drag
 * requests to move. A drag requests an axis when the dragged points, or the
 * mirror source of a dragged copy (`mirrorSourcePoint`), meet the axis's
 * points: its endpoints and every point in their declared-join class (a
 * shared point, or a satisfied `coincident` in the last accepted frame,
 * `declaredJoinClasses`: blocked or unsatisfied ones do not join), those
 * points' variables or their authority (the source of a derived axis, also
 * through a chain). Empty without a line axis in the component.
 */
function dragFrozenAxisVariables(
  program: SketchCompiledSolveProgram,
  snapshot: SolvedSketchSnapshot,
  component: SketchCompiledSolveComponent | null,
  draggedVariableIndices: readonly number[],
): ReadonlySet<number> {
  const axes = mirrorAxisVariables(program);
  if (axes.length === 0) return NO_FROZEN_VARIABLES;
  const inComponent = component ? new Set(component.variableIndices) : null;
  const variablesOf = (pointId: SketchPointId) =>
    pointVariableIndices(program.system.pointRecords.get(pointId));
  const draggedSet = new Set(draggedVariableIndices);
  const draggedPoints = program.definition.points.filter((point) =>
    variablesOf(point.pointId).some((index) => draggedSet.has(index)),
  );
  const dragged = new Set([
    ...draggedVariableIndices,
    ...draggedPoints.flatMap((point) =>
      variablesOf(mirrorSourcePoint(program, point.pointId)),
    ),
  ]);
  const classes = declaredJoinClasses(program.definition, snapshot);
  const frozen = new Set<number>();
  for (const axis of axes) {
    if (inComponent && !axis.authority.some((index) => inComponent.has(index)))
      continue;
    const roots = new Set(
      axis.pointIds.map((pointId) => classes.find(pointId)),
    );
    const joined = program.definition.points.flatMap((point) =>
      roots.has(classes.find(point.pointId)) ? variablesOf(point.pointId) : [],
    );
    if (
      [
        ...axis.variables,
        ...axis.authority,
        ...joined,
        ...program.system.parameterProjection.projectVariableIndices(joined),
      ].some((index) => dragged.has(index))
    )
      continue;
    for (const index of axis.authority) frozen.add(index);
  }
  return frozen;
}

/**
 * T15c: the components among those holding a `frozen` variable that a
 * rejected stage-1 batch result cannot be accepted in: an unsatisfied
 * requirement or a rejecting error (not tolerated by the start-state rule)
 * targets them. A rejection that cannot be attributed to a component
 * releases every such component (today's solve for all of them).
 */
function rejectedAxisComponents(
  program: SketchCompiledSolveProgram,
  snapshot: SolvedSketchSnapshot,
  frozen: ReadonlySet<number>,
) {
  const holding = program.components.filter((component) =>
    component.variableIndices.some((index) => frozen.has(index)),
  );
  const unsatisfied = new Set<string>([
    ...snapshot.constraintStatuses.flatMap((entry) =>
      isAcceptedConstraintStatus(entry.status) ? [] : [entry.constraintId],
    ),
    ...snapshot.dimensionStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.dimensionId] : [],
    ),
  ]);
  const names = (component: SketchCompiledSolveComponent, id: string) =>
    component.equationIndices.some(
      (equationIndex) =>
        program.system.scalarConstraints[equationIndex]!.id === id,
    );
  const targets = (
    component: SketchCompiledSolveComponent,
    target: SketchSolveDiagnostic["target"],
  ) => {
    switch (target?.kind) {
      case "entity":
        return component.entityIds.includes(target.entityId);
      case "point":
        return component.pointIds.includes(target.pointId);
      case "constraint":
        return names(component, target.constraintId);
      case "dimension":
        return names(component, target.dimensionId);
      default:
        return false;
    }
  };
  const tolerated = startFailedDerivedDiagnostics.get(snapshot);
  const rejecting = snapshot.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "error" && !tolerated?.has(diagnostic),
  );
  const rejected = new Set(
    program.components.filter(
      (component) =>
        [...unsatisfied].some((id) => names(component, id)) ||
        rejecting.some((diagnostic) => targets(component, diagnostic.target)),
    ),
  );
  const unattributed =
    rejected.size === 0 ||
    rejecting.some(
      (diagnostic) =>
        !program.components.some((component) =>
          targets(component, diagnostic.target),
        ),
    );
  return unattributed
    ? holding
    : holding.filter((component) => rejected.has(component));
}

/**
 * T15c (issue 15: "preserve the axis unless requirements force it to
 * move"; [TECH] T-6 + R-7): a batch solve (commit, live solve, session
 * start, Undo/Redo/reopen; B4 inside each stage) in two stages.
 * - Stage 1: the solve with every mirror line axis's authority variables
 *   frozen. Kept whenever it is accepted.
 * - Stage 2, only for the components holding an axis whose stage-1 result
 *   is not accepted (component-local): today's unrestricted solve of those
 *   components' equations from their start values; every other component
 *   keeps its stage-1 values. It is reported whether or not it is accepted
 *   (a rejected result is today's rejected result for those components).
 * A sketch without a mirror line axis runs the unchanged single solve.
 */
function solveProgramValuesPreferringAxes(
  program: SketchCompiledSolveProgram,
  startValues: Float64Array,
) {
  const axes = mirrorAxisVariables(program);
  if (axes.length === 0) return solveProgramValues(program, startValues);
  const frozen = new Set(axes.flatMap((axis) => axis.authority));
  const preferred = solveProgramValues(program, startValues, { frozen });
  const snapshot = preferred.result.solvedSnapshot;
  if (isAcceptableSolvedSnapshot(snapshot)) return preferred;
  const rejected = rejectedAxisComponents(program, snapshot, frozen);
  if (rejected.length === 0) return preferred;
  const restart = cloneValues(preferred.solved.values);
  for (const component of rejected)
    for (const index of component.variableIndices)
      restart[index] = startValues[index]!;
  return solveProgramValues(program, restart, { components: rejected });
}

export function solveCompiledSketchProgram(
  program: SketchCompiledSolveProgram,
  initialValues: Float64Array = program.system.initialValues,
): SketchCoreSolveResult {
  const preconditionedValues = preconditionValuesForPointAnchors(
    program,
    initialValues,
  );
  // [TECH] G16‴/G16⁗: the blocked set is decided on the solve's start
  // state, with one re-solve when a blocked offset builds at the end.
  return solveWithRebuildRetry({
    program,
    startValues: preconditionedValues,
    solve: () =>
      solveProgramValuesPreferringAxes(program, preconditionedValues),
    retry: (from) => solveProgramValuesPreferringAxes(program, from),
    valuesOf: (solved) => solved.solved.values,
    reevaluate: (values) => reevaluateProgramValues(program, values),
    isAccepted: (solved) =>
      isAcceptableSolvedSnapshot(solved.result.solvedSnapshot),
  }).result;
}

function isAcceptableSolvedValues(
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
const startFailedDerivedDiagnostics = new WeakMap<
  SolvedSketchSnapshot,
  ReadonlySet<SketchSolveDiagnostic>
>();

/** Whether a materialized solve result carries an error the start-state rule does not tolerate. */
function hasRejectingError(snapshot: SolvedSketchSnapshot) {
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
function isDegenerateSplineSpanRecoveryStart(
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

function isAcceptableSolvedSnapshot(snapshot: SolvedSketchSnapshot) {
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

function hasOnlyFiniteNumericGeometry(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(hasOnlyFiniteNumericGeometry);
  if (value && typeof value === "object") {
    return Object.values(value).every(hasOnlyFiniteNumericGeometry);
  }
  return true;
}

function solvedSnapshotStructurallyCoversProgram(
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
  const solvedIsAcceptable = isAcceptableSolvedSnapshot(
    solved.solvedSnapshot,
  );
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

// Drag solution selection policy (see openspec/changes/minimum-motion-sketch-drag):
//
// Policy 1 (adopted): the drag target is a soft objective and every non-dragged
// free point gets a weak UNIFORM previous-frame anchoring term
// (epsilon * ||p_i - p_i_prevFrame||^2, epsilon << drag weight). Under-constrained
// null spaces then resolve to the minimum-motion solution: nothing moves unless a
// hard constraint forces it, and forced motion is minimal.
//
// Policy 2 (considered, not implemented): weight each anchoring term by
// constraint-graph distance from the dragged point, making nearby geometry
// cheaper to move so linkages "swing" rather than stretch. Feels more physical
// but adds a tunable and mild unpredictability; revisit only if user feedback
// shows policy 1 reads as too "stiff". The per-point weight would replace the
// uniform epsilon where the anchoring residuals are constructed.
function createDragTargetConstraint(
  system: BuildSystemResult,
  dragTarget: SketchDraggedPointTarget,
  weight = 1,
): ScalarConstraintRecord | null {
  const point = system.pointRecords.get(dragTarget.pointId);
  if (!point) {
    return null;
  }

  return system.parameterProjection.wrapConstraint(
    {
      id: `constraint_drag_target_${dragTarget.pointId}` as ConstraintId,
      targetKind: "constraint",
      evaluate(values) {
        const gradient = zeroVector(system.parameterCount);
        const actual = getPoint(values, point);
        const delta = subtract(actual, dragTarget.position);
        addPointGradient(gradient, point, weight * delta[0], weight * delta[1]);
        return {
          residual: 0.5 * weight * (delta[0] * delta[0] + delta[1] * delta[1]),
          gradient,
        };
      },
    },
    [point.baseIndex, point.baseIndex + 1],
  );
}

/**
 * T12b: create a soft radius-targeting constraint for circle/arc rim drag.
 * Returns null when the entity is missing or has no radius variable.
 */
function createDragRadiusConstraint(
  system: BuildSystemResult,
  entityId: SketchEntityId,
  targetRadius: number,
  weight = 1,
): ScalarConstraintRecord | null {
  const entityState = system.entityStates.get(entityId);
  if (!entityState) return null;
  if (entityState.kind !== "circle" && entityState.kind !== "arc") return null;
  const radiusIndex = entityState.baseIndex;
  return system.parameterProjection.wrapConstraint(
    {
      id: `constraint_drag_radius_${entityId}` as ConstraintId,
      targetKind: "constraint",
      evaluate(values) {
        const gradient = zeroVector(system.parameterCount);
        const actual = values[radiusIndex]!;
        const delta = actual - targetRadius;
        gradient[radiusIndex] += weight * delta;
        return { residual: 0.5 * weight * delta * delta, gradient };
      },
    },
    [radiusIndex],
  );
}

/**
 * T12b: create a soft tangent-vector-targeting constraint for handle drag.
 * Returns null when the tangent state is missing.
 */
function createDragTangentVectorConstraint(
  system: BuildSystemResult,
  entityId: SketchEntityId,
  occurrenceId: string,
  targetVector: SketchPoint2D,
  weight = 1,
): ScalarConstraintRecord | null {
  const tangentState = system.splineTangentStates.get(
    splineTangentStateKey(entityId, occurrenceId),
  );
  if (!tangentState) return null;
  const bx = tangentState.baseIndex;
  const by = tangentState.baseIndex + 1;
  return system.parameterProjection.wrapConstraint(
    {
      id: `constraint_drag_tangent_${entityId}_${occurrenceId}` as ConstraintId,
      targetKind: "constraint",
      evaluate(values) {
        const gradient = zeroVector(system.parameterCount);
        const dx = values[bx]! - targetVector[0];
        const dy = values[by]! - targetVector[1];
        gradient[bx] += weight * dx;
        gradient[by] += weight * dy;
        return { residual: 0.5 * weight * (dx * dx + dy * dy), gradient };
      },
    },
    [bx, by],
  );
}

/**
 * T12b: resolve a SketchDragTarget into soft constraints, dragged variable
 * indices, and the component to scope the solve. Called within the substep
 * loop so each substep's interpolated target is captured. `startValues` is the
 * projected parameter array at the beginning of the substep loop (translate
 * needs the current point positions to apply the shared delta).
 */
function resolveDragTargetFrame(
  program: SketchCompiledSolveProgram,
  target: SketchDragTarget,
  startValues: Float64Array,
  weight: number,
): {
  constraints: ScalarConstraintRecord[];
  draggedVariableIndices: number[];
  component: SketchCompiledSolveComponent | null;
} | null {
  const system = program.system;
  switch (target.kind) {
    case "sketchPoint": {
      const constraint = createDragTargetConstraint(system, target, weight);
      if (!constraint) return null;
      const point = system.pointRecords.get(target.pointId)!;
      return {
        constraints: [constraint],
        draggedVariableIndices: [point.baseIndex, point.baseIndex + 1],
        component: findComponentForPoint(program, target.pointId),
      };
    }
    case "sketchTranslate": {
      const constraints: ScalarConstraintRecord[] = [];
      const draggedVariableIndices: number[] = [];
      let component: SketchCompiledSolveComponent | null = null;
      for (const pointId of target.pointIds) {
        const point = system.pointRecords.get(pointId);
        if (!point) continue;
        // Current position from session.values, not point.initial
        const currentPos = getPoint(startValues, point);
        const targetPos: SketchPoint2D = [
          currentPos[0] + target.delta[0],
          currentPos[1] + target.delta[1],
        ];
        const c = createDragTargetConstraint(
          system,
          { kind: "sketchPoint", pointId, position: targetPos },
          weight,
        );
        if (c) constraints.push(c);
        draggedVariableIndices.push(point.baseIndex, point.baseIndex + 1);
        if (!component) component = findComponentForPoint(program, pointId);
      }
      if (constraints.length === 0) return null;
      return { constraints, draggedVariableIndices, component };
    }
    case "sketchRadius": {
      const constraint = createDragRadiusConstraint(
        system,
        target.entityId,
        target.targetRadius,
        weight,
      );
      if (!constraint) return null;
      const entityState = system.entityStates.get(target.entityId)!;
      return {
        constraints: [constraint],
        draggedVariableIndices: [entityState.baseIndex],
        component: findComponentForEntity(program, target.entityId),
      };
    }
    case "sketchTangentVector": {
      const tangentState = system.splineTangentStates.get(
        splineTangentStateKey(target.entityId, target.occurrenceId),
      );
      if (!tangentState) return null;

      // Exact-zero request: fix both tangent variables at 0 as hard constraints
      // so the accepted frame stores exactly [0, 0] regardless of soft targets.
      if (target.exactZero) {
        const bx = tangentState.baseIndex;
        const by = tangentState.baseIndex + 1;
        const hardZeroX = system.parameterProjection.wrapConstraint(
          {
            id: `constraint_drag_tangent_zero_x_${target.entityId}_${target.occurrenceId}` as ConstraintId,
            targetKind: "constraint",
            evaluate(values) {
              const gradient = zeroVector(system.parameterCount);
              const v = values[bx]!;
              gradient[bx] += v;
              return { residual: 0.5 * v * v, gradient };
            },
          },
          [bx],
        );
        const hardZeroY = system.parameterProjection.wrapConstraint(
          {
            id: `constraint_drag_tangent_zero_y_${target.entityId}_${target.occurrenceId}` as ConstraintId,
            targetKind: "constraint",
            evaluate(values) {
              const gradient = zeroVector(system.parameterCount);
              const v = values[by]!;
              gradient[by] += v;
              return { residual: 0.5 * v * v, gradient };
            },
          },
          [by],
        );
        return {
          constraints: [hardZeroX, hardZeroY],
          draggedVariableIndices: [bx, by],
          component: findComponentForEntity(program, target.entityId),
        };
      }

      const constraint = createDragTangentVectorConstraint(
        system,
        target.entityId,
        target.occurrenceId,
        target.targetVector,
        weight,
      );
      if (!constraint) return null;
      return {
        constraints: [constraint],
        draggedVariableIndices: [
          tangentState.baseIndex,
          tangentState.baseIndex + 1,
        ],
        component: findComponentForEntity(program, target.entityId),
      };
    }
  }
}

function findComponentForEntity(
  program: SketchCompiledSolveProgram,
  entityId: SketchEntityId,
) {
  return (
    program.components.find((component) =>
      component.entityIds.includes(entityId),
    ) ?? null
  );
}

function findComponentForPoint(
  program: SketchCompiledSolveProgram,
  pointId: SketchPointId,
) {
  return (
    program.components.find((component) =>
      component.pointIds.includes(pointId),
    ) ?? null
  );
}

/**
 * T13a2 (issue 05, Q3): the guarded arc quantities of one frame, each a
 * signed value whose sign is the arc's orientation and whose magnitude is
 * its radius:
 * - `radius:<arc>`: an arc's radius variable where it is an authority
 *   variable (radius through zero mirrors the arc);
 * - `side:<tangent>`: for a line↔arc tangent, the signed distance from the
 *   line to the arc's centre; the centre is a radius away from the line, so
 *   the side changes only through radius zero (the arc turns inside out,
 *   e.g. a collapsing fillet). A point-defined arc's radius is a distance
 *   (never negative), so this is its radius-through-zero signal.
 * The minor/major sweep (start×end about the centre) is deliberately not
 * guarded: it changes on a legitimate sweep through 180° and is noise on a
 * semicircle.
 */
function guardedArcQuantities(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
  snapshot: SolvedSketchSnapshot,
) {
  const signs = new Map<string, number>();
  const authority = new Set(
    program.system.parameterProjection.authorityVariableIndices,
  );
  for (const state of program.system.entityStates.values()) {
    if (state.kind === "arc" && authority.has(state.baseIndex)) {
      signs.set(`radius:${state.entityId}`, values[state.baseIndex]!);
    }
  }
  const points = new Map(
    snapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
  );
  const arcCenters = new Map(
    snapshot.solvedEntities.flatMap((entity) =>
      entity.kind === "arc" ? [[entity.entityId, entity.centerPosition]] : [],
    ),
  );
  const entities = new Map(
    program.definition.entities.map((entity) => [entity.entityId, entity]),
  );
  for (const constraint of program.definition.constraints) {
    if (constraint.kind !== "tangent") continue;
    const [first, second] = constraint.entityIds.map((id) => entities.get(id));
    const line =
      first?.kind === "lineSegment"
        ? first
        : second?.kind === "lineSegment"
          ? second
          : null;
    const arc =
      first?.kind === "arc" ? first : second?.kind === "arc" ? second : null;
    if (!line || !arc) continue;
    const center = arcCenters.get(arc.entityId);
    const start = points.get(line.startPointId);
    const end = points.get(line.endPointId);
    if (!center || !start || !end) continue;
    signs.set(
      `side:${constraint.constraintId}`,
      pointLineSignedDistance(center, start, end),
    );
  }
  return signs;
}

/**
 * Whether a frame flips or collapses a guarded arc relative to the last
 * accepted frame (issue 05: no flips):
 * - **flip**: exact sign comparison, no tolerance. A previous sign of 0 is
 *   not compared (nothing to preserve); a next sign of 0 differs from a
 *   previous ±1 and is a flip, e.g. a tangent line shortened through zero
 *   length or a centre landing exactly on its tangent line.
 * - **collapse** (review R-1): a magnitude (radius) falling below the
 *   document modeling tolerance τ, the degenerate boundary (the same rule
 *   as "no piece shorter than τ"). Minimum motion otherwise parks an arc at
 *   radius ≈ 0, where the tangent residual's gradient degenerates and
 *   later frames cannot leave it. It applies only when the previous
 *   accepted magnitude was at least τ, so a sketch that already holds such
 *   an arc is not frozen: that arc is then only flip-guarded.
 */
function guardedArcFlippedOrCollapsed(input: {
  program: SketchCompiledSolveProgram;
  previous: { values: Float64Array; snapshot: SolvedSketchSnapshot };
  next: { values: Float64Array; snapshot: SolvedSketchSnapshot };
}) {
  const tau = input.program.modelingTolerance;
  const previous = guardedArcQuantities(
    input.program,
    input.previous.values,
    input.previous.snapshot,
  );
  const next = guardedArcQuantities(
    input.program,
    input.next.values,
    input.next.snapshot,
  );
  return [...previous].some(([key, before]) => {
    const after = next.get(key);
    if (after === undefined) return false;
    const flipped =
      Math.sign(before) !== 0 && Math.sign(after) !== Math.sign(before);
    const collapsed = Math.abs(before) >= tau && Math.abs(after) < tau;
    return flipped || collapsed;
  });
}

function createDraggedPointAcceptance(input: {
  session: SketchCompiledSolveSession;
  values: Float64Array;
  materialized: SketchCoreSolveResult;
}) {
  const program = input.session.program;
  const constraintsSatisfied =
    input.materialized.solvedSnapshot.constraintStatuses.every((status) =>
      isAcceptedConstraintStatus(status.status),
    );
  const dimensionsSatisfied =
    input.materialized.solvedSnapshot.dimensionStatuses.every(
      (status) => status.status !== "unsatisfied",
    );
  // T15b (T-16): a derived failure already present at the frame's start is tolerated.
  const derivationsValid = !hasRejectingError(
    input.materialized.solvedSnapshot,
  );
  // D1 (minimum-motion-sketch-drag): the cursor is a SOFT objective and is never
  // part of frame acceptance. A frame is accepted whenever the authored (hard)
  // constraints and dimensions are satisfied within tolerance, regardless of how
  // close the dragged point reached the cursor. `targetDistance` is intentionally
  // dropped from acceptance so a feasible-but-lagging frame is `solved`, not
  // `blocked`; `blocked` is reserved for invalid/non-convergent solves.
  // T13a2 (issue 05, no flips): a frame that flips or collapses a guarded
  // arc relative to the last accepted frame is not accepted either.
  const accepted =
    program.validation.isValid &&
    derivationsValid &&
    constraintsSatisfied &&
    dimensionsSatisfied &&
    !guardedArcFlippedOrCollapsed({
      program,
      previous: {
        values: input.session.values,
        snapshot: input.session.lastAcceptedSnapshot,
      },
      next: {
        values: input.values,
        snapshot: input.materialized.solvedSnapshot,
      },
    });

  return { accepted };
}

/**
 * [TECH] G16′: an accepted frame's values with every driven index set to
 * its accepted (projected) value, so an offset relationship that fails in a
 * later frame holds the last accepted frame's outputs, not the drag start's.
 * Authority indices are unchanged, and a driven raw value is never read
 * while its relationship evaluates, so nothing changes without a failure.
 */
function heldDrivenValues(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
) {
  return program.system.parameterProjection.projectValues(values);
}

/** One drag frame's candidate values, materialized, and whether the frame accepts them. */
type DraggedPointCandidate = {
  accepted: boolean;
  values: Float64Array;
  materialized: SketchCoreSolveResult;
  /** T13a2 (c3): phase A's curvature estimate, kept when the frame is accepted. */
  curvature?: SketchDragCurvature;
};

/** T13a2 (c3): a BFGS inverse Hessian over one drag problem's variables. */
type SketchDragCurvature = { key: string; inverseHessian: Float64Array[] };

/** [TECH] G16⁗: a drag frame's candidate re-materialized and re-judged at `values`. */
function reevaluateDraggedPointCandidate(
  session: SketchCompiledSolveSession,
  values: Float64Array,
): DraggedPointCandidate {
  const { materialized } = materializeDraggedPointCandidate(session, values);
  return {
    accepted: createDraggedPointAcceptance({
      session,
      values,
      materialized,
    }).accepted,
    values,
    materialized,
  };
}

/**
 * [TECH] G16‴/G16⁗: one drag frame toward `dragTarget`, a solve whose start
 * state is the last accepted frame (`session.values`): its blocked set is
 * decided there, with one re-solve (from the frame's end values) when a
 * blocked offset builds at the end. `interactive` is a session update's
 * frame (not a DOF probe): a preview frame (`null` tolerance) reuses the
 * curvature (T13a2 c3), a frame with a tolerance (the release, a single
 * solver call) runs the exact-reach step (d1) instead. The session is not
 * mutated.
 */
function solveDraggedPointFrameWithRebuild(input: {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragTarget: SketchDraggedPointTarget;
  interactive?: { targetTolerance: number | null };
}): DraggedPointCandidate | null {
  const { session, component, dragTarget, interactive } = input;
  return solveWithRebuildRetry<DraggedPointCandidate | null>({
    program: session.program,
    startValues: session.values,
    solve: () =>
      solveDraggedPointFrame({
        session,
        component,
        dragTarget,
        exactReachTolerance: interactive?.targetTolerance ?? undefined,
        reuseCurvature: interactive?.targetTolerance === null,
        repeatsAcceptedFrame:
          interactive !== undefined &&
          session.lastPointDragTarget?.pointId === dragTarget.pointId &&
          session.lastPointDragTarget.position[0] === dragTarget.position[0] &&
          session.lastPointDragTarget.position[1] === dragTarget.position[1],
      }),
    retry: (from) =>
      solveDraggedPointFrame({
        session,
        component,
        dragTarget,
        startValues: from,
        exactReachTolerance: interactive?.targetTolerance ?? undefined,
      }),
    valuesOf: (candidate) => candidate?.values ?? null,
    reevaluate: (values) => reevaluateDraggedPointCandidate(session, values),
    isAccepted: (candidate) => candidate?.accepted === true,
  });
}

function materializeDraggedPointCandidate(
  session: SketchCompiledSolveSession,
  values: Float64Array,
) {
  const state = evaluateLoss(values, session.program.system.scalarConstraints);
  const materialized = materializeSolveResult(session.program, values, {
    values: cloneValues(values),
    loss: state.loss,
    perConstraint: state.perConstraint,
  });
  return { state, materialized };
}

function acceptDraggedPointCandidate(
  session: SketchCompiledSolveSession,
  values: Float64Array,
  materialized: SketchCoreSolveResult,
  curvature?: SketchDragCurvature,
): SketchDraggedPointSolveResult {
  session.values = heldDrivenValues(session.program, values);
  session.lastAcceptedSnapshot = materialized.solvedSnapshot;
  session.dragCurvature = curvature;
  session.lastPointDragTarget = undefined;
  return {
    kind: "solved",
    solvedSnapshot: materialized.solvedSnapshot,
    diagnostics: materialized.diagnostics,
  };
}

// D2 (minimum-motion-sketch-drag): uniform previous-frame anchoring residual.
// For every non-dragged free variable in the affected component this adds a weak
// quadratic term (0.5 * weight * (v - anchor)^2, weight << drag weight) so that
// under-constrained null spaces resolve to the minimum-motion solution: nothing
// moves unless a hard constraint forces it, and forced motion is minimal.
//
// Policy 2 (considered, not implemented) would replace the single uniform
// `weight` here with a per-index weight derived from constraint-graph distance to
// the dragged point. See the policy note above createDragTargetConstraint.
function createMinimumMotionAnchorConstraint(input: {
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

// D1/D2/D4: solve a single continuous drag frame for one cursor position.
//
// Phase A minimizes the hard constraints together with the soft drag objective
// and the uniform minimum-motion term (anchored to the previous accepted frame).
// If the hard constraints are satisfied, the frame is accepted directly (this is
// the feasible/reachable case, including rigid translation).
//
// Phase B (the sliding case) projects the phase-A candidate back onto the
// hard-constraint manifold by minimizing displacement FROM the phase-A position,
// with no drag term. This settles the dragged point at the closest feasible
// position instead of returning a compromise that violates authored constraints.
// Neither phase seeds or accepts reflected/discontinuous branches (D4): the frame
// is solved purely by continuous iteration from the previous accepted values.
//
// T13a2, with the BFGS strategy:
// - c2: phase A runs BFGS without the Gauss–Newton fallback. Phase A's loss
//   includes the soft cursor and anchor terms, so a converged frame can sit
//   above SOLVED_LOSS_THRESHOLD and wrongly trigger the fallback; acceptance
//   and phase B (which keeps the fallback, hard constraints only) judge it.
// - c3: phase A solves only the component's (authority) variables. Every
//   phase-A term's gradient is supported there: the component is the union
//   of its equations' projected supports, and an offset/derived output is
//   projected onto its seeds' authority variables, so relationships seeded in
//   the component are solved with it. Outside it the gradient is zero, so
//   the iterates equal the full solve's, and other components keep their
//   previous values (only `affectedVariables` are copied back, as before):
//   the restriction is bit-identical to the full solve. An interactive
//   preview frame also reuses the previous accepted frame's inverse
//   Hessian for the same drag problem (25–30 % faster frames). That keeps
//   the objective, stop test and acceptance but changes the path, and with
//   the 1e-6 anchor under the 1e-8 gradient stop the accepted frame moves
//   by O(1e-3) on fillet/offset outlines (path dependence within the
//   existing stop accuracy; accepted under D1 by the orchestrator). The
//   release frame starts from the identity, so the committed state does
//   not depend on the reuse path.
// - d1: when a session update with a reach tolerance (the release frame of
//   an editor drag, or a single solver call) has an accepted frame that
//   leaves the dragged point off the cursor (T17c6: any nonzero lag; a
//   driven mirror-output target: farther than `targetTolerance`), the point
//   is pinned at the cursor and the other component variables are
//   projected onto the hard constraints from that frame; the result
//   replaces the frame only if the frame acceptance accepts it.

const mirrorOutputVariablesByProgram = new WeakMap<
  SketchCompiledSolveProgram,
  ReadonlySet<number>
>();

/**
 * T15c: whether `index` is a mirror output point's (driven) slot. Other
 * driven outputs (offset, pattern, transform) are one-way (T12 D9) and keep
 * today's release frame.
 */
function isMirrorOutputVariable(
  program: SketchCompiledSolveProgram,
  index: number,
) {
  let variables = mirrorOutputVariablesByProgram.get(program);
  if (!variables) {
    variables = new Set(
      (program.definition.derivedRelationships ?? []).flatMap((relationship) =>
        relationship.kind === "mirror"
          ? relationship.outputs.flatMap((output) =>
              output.outputPointIds.flatMap((pointId) =>
                pointVariableIndices(program.system.pointRecords.get(pointId)),
              ),
            )
          : [],
      ),
    );
    mirrorOutputVariablesByProgram.set(program, variables);
  }
  return variables.has(index);
}

type DragFrameInput = {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragConstraints: ScalarConstraintRecord[];
  draggedVariableIndices: number[];
  constraintLabel: string;
  startValues?: Float64Array;
  /**
   * T13a2 (d1): the cursor and the existing target tolerance. T15c: `pin`
   * is the drag target as a hard (weight 1) wrapped requirement, used when
   * the dragged point is driven (a mirror output).
   */
  exactReach?: {
    position: SketchPoint2D;
    targetTolerance: number;
    pin: ScalarConstraintRecord;
  };
  /** T13a2 (c3): reuse the session's curvature for this drag problem. */
  reuseCurvature?: boolean;
  /**
   * T13a2 (review R-1): the target is the last accepted frame's; that frame
   * is this frame's solution (a re-solve only re-walks the path), so only
   * the exact-reach step runs on it.
   */
  repeatsAcceptedFrame?: boolean;
};

/**
 * T12b: generalized drag frame solver that accepts pre-resolved constraints
 * and dragged variable indices. All drag target types (point, translate,
 * radius, tangent vector) reduce to this common frame solver.
 *
 * T15c (issue 15 axis preference; [TECH] T-6 + R-7, A-1): stage 1 is the
 * frame solve with the frozen mirror axes (`dragFrozenAxisVariables`)
 * excluded from the solved set; the drag target stays a requirement on its
 * own (possibly driven) slots, never a pre-reflected target. It is kept
 * whenever the frame accepts it, however far the cursor lags (the cursor is
 * a soft objective, D1). Only a stage-1 frame that is not accepted runs
 * stage 2, today's unrestricted frame, kept only if accepted (otherwise the
 * caller keeps the last accepted frame). Without a frozen axis the frame is
 * the unchanged single stage.
 */
function solveDragFrameGeneral(
  input: DragFrameInput,
): DraggedPointCandidate | null {
  const frozen = dragFrozenAxisVariables(
    input.session.program,
    input.session.lastAcceptedSnapshot,
    input.component,
    input.draggedVariableIndices,
  );
  const preferred = solveDragFrameStage(input, frozen);
  if (frozen.size === 0 || preferred === null || preferred.accepted)
    return preferred;
  return solveDragFrameStage(input, NO_FROZEN_VARIABLES);
}

/**
 * One stage of a drag frame: the T12b/T13a2 frame solve over the
 * component's variables minus `frozen` (phases A and B and the d1 step).
 * T13a2 (c3) curvature is keyed by the frozen set too, so a stage reuses
 * only its own stage's inverse Hessian (a different variable set or
 * objective restarts from the identity).
 */
function solveDragFrameStage(
  input: DragFrameInput,
  frozen: ReadonlySet<number>,
): DraggedPointCandidate | null {
  const { session, component } = input;
  const program = session.program;
  const parameterCount = program.system.parameterCount;
  const bfgs = program.strategy === "bfgs";

  const componentConstraintSet = new Set(component?.equationIndices ?? []);
  const hardConstraints = program.system.scalarConstraints.filter((_, index) =>
    component ? componentConstraintSet.has(index) : true,
  );
  const affectedVariables = Array.from(
    component?.variableIndices ??
      Array.from({ length: parameterCount }, (_, index) => index),
  );
  const solvedVariables =
    frozen.size === 0
      ? affectedVariables
      : affectedVariables.filter((index) => !frozen.has(index));
  const solvedHardConstraints = withFrozenVariables(hardConstraints, frozen);
  const draggedSet = new Set(input.draggedVariableIndices);
  const nonDraggedVariableIndices = solvedVariables.filter(
    (index) => !draggedSet.has(index),
  );

  const previousFrame = cloneValues(session.values);
  const candidateOf = (solved: Float64Array) => {
    const candidate = cloneValues(session.values);
    for (const index of affectedVariables) {
      candidate[index] = solved[index]!;
    }
    return candidate;
  };
  const judge = (values: Float64Array) =>
    reevaluateDraggedPointCandidate(session, values);
  const exactReach = (candidate: DraggedPointCandidate) => {
    if (!bfgs || !input.exactReach || !candidate.accepted) return candidate;
    const [x, y] = input.draggedVariableIndices;
    const { position, targetTolerance, pin } = input.exactReach;
    if (
      x !== undefined &&
      y !== undefined &&
      isMirrorOutputVariable(program, x) &&
      isMirrorOutputVariable(program, y)
    ) {
      // T15c (T13a2 d1 for a driven target, a mirror output point):
      // pinning its slots is overwritten by the projection, so the target
      // is pinned as a hard requirement on them and the stage's variables
      // (frozen axes stay) are projected from the frame; kept only if
      // accepted and within the reach tolerance.
      const lagOf = (values: Float64Array) => {
        const projected =
          program.system.parameterProjection.projectValues(values);
        return Math.hypot(
          projected[x]! - position[0],
          projected[y]! - position[1],
        );
      };
      if (lagOf(candidate.values) <= targetTolerance) return candidate;
      const projected = solveBfgsOver(
        cloneValues(candidate.values),
        [...hardConstraints, pin],
        { variableIndices: solvedVariables },
      );
      const reached = judge(candidateOf(projected.values));
      return reached.accepted && lagOf(reached.values) <= targetTolerance
        ? { ...reached, curvature: candidate.curvature }
        : candidate;
    }
    const affected = new Set(affectedVariables);
    if (
      x === undefined ||
      y === undefined ||
      !affected.has(x) ||
      !affected.has(y)
    )
      return candidate;
    const lag = Math.hypot(
      candidate.values[x]! - position[0],
      candidate.values[y]! - position[1],
    );
    // T17c6 (D-3): any nonzero lag runs the step, not only a lag above
    // the reach tolerance, so a reachable release (a fit point dropped on
    // its neighbour) lands exactly at the cursor, not ~1e-15–1e-6 away.
    if (lag === 0) return candidate;
    const pinned = cloneValues(candidate.values);
    pinned[x] = position[0];
    pinned[y] = position[1];
    const projected = solveBfgsOver(pinned, hardConstraints, {
      variableIndices: nonDraggedVariableIndices,
    });
    const reached = judge(candidateOf(projected.values));
    return reached.accepted
      ? { ...reached, curvature: candidate.curvature }
      : candidate;
  };

  if (input.repeatsAcceptedFrame && input.startValues === undefined) {
    return exactReach({
      ...judge(cloneValues(session.values)),
      curvature: session.dragCurvature,
    });
  }

  // Phase A: hard constraints + soft cursor target + uniform minimum motion.
  const phaseAConstraints: ScalarConstraintRecord[] = [
    ...hardConstraints,
    ...input.dragConstraints,
    createMinimumMotionAnchorConstraint({
      id: `constraint_drag_minimum_motion_${input.constraintLabel}` as ConstraintId,
      parameterCount,
      anchorValues: previousFrame,
      variableIndices: nonDraggedVariableIndices,
      weight: DRAG_MINIMUM_MOTION_EPSILON,
      parameterProjection: program.system.parameterProjection,
    }),
  ];
  const curvatureKey = `${input.constraintLabel}|${component?.componentId ?? "all"}|${input.draggedVariableIndices.join(",")}${frozen.size === 0 ? "" : `|frozen:${[...frozen].join(",")}`}`;
  const reuse =
    input.reuseCurvature === true && input.startValues === undefined;
  let curvature: SketchDragCurvature | undefined;
  let solvedA: Float64Array;
  if (bfgs) {
    const solved = solveBfgsOver(
      cloneValues(input.startValues ?? session.values),
      phaseAConstraints,
      {
        variableIndices: solvedVariables,
        initialInverseHessian:
          reuse && session.dragCurvature?.key === curvatureKey
            ? session.dragCurvature.inverseHessian
            : null,
      },
    );
    solvedA = solved.values;
    curvature = reuse
      ? { key: curvatureKey, inverseHessian: solved.inverseHessian }
      : undefined;
  } else {
    solvedA = solveSystemValues(
      cloneValues(input.startValues ?? session.values),
      withFrozenVariables(phaseAConstraints, frozen),
      program.strategy,
    ).values;
  }
  const candidateA = judge(candidateOf(solvedA));
  if (candidateA.accepted) {
    return exactReach({ ...candidateA, curvature });
  }

  // Phase B: project the phase-A candidate onto the hard-constraint manifold.
  const phaseBConstraints: ScalarConstraintRecord[] = [
    ...solvedHardConstraints,
  ];
  const solvedB = solveSystemValues(
    cloneValues(candidateA.values),
    phaseBConstraints,
    program.strategy,
  );
  return exactReach({ ...judge(candidateOf(solvedB.values)), curvature });
}

function solveDraggedPointFrame(input: {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragTarget: SketchDraggedPointTarget;
  startValues?: Float64Array;
  exactReachTolerance?: number;
  reuseCurvature?: boolean;
  repeatsAcceptedFrame?: boolean;
}): DraggedPointCandidate | null {
  const { session, component, dragTarget } = input;
  const constraint = createDragTargetConstraint(
    session.program.system,
    dragTarget,
    DRAG_TARGET_WEIGHT,
  );
  if (!constraint) return null;
  const draggedRecord = session.program.system.pointRecords.get(
    dragTarget.pointId,
  );
  const draggedVariableIndices = draggedRecord
    ? [draggedRecord.baseIndex, draggedRecord.baseIndex + 1]
    : [];
  return solveDragFrameGeneral({
    session,
    component,
    dragConstraints: [constraint],
    draggedVariableIndices,
    constraintLabel: dragTarget.pointId,
    startValues: input.startValues,
    exactReach:
      input.exactReachTolerance === undefined
        ? undefined
        : {
            position: dragTarget.position,
            targetTolerance: input.exactReachTolerance,
            // T15c: the existing point is resolved above, so never null.
            pin: createDragTargetConstraint(
              session.program.system,
              dragTarget,
            )!,
          },
    reuseCurvature: input.reuseCurvature,
    repeatsAcceptedFrame: input.repeatsAcceptedFrame,
  });
}

/**
 * T12b: generalized frame solve with rebuild retry for any drag target type.
 */
function solveDragFrameGeneralWithRebuild(input: {
  session: SketchCompiledSolveSession;
  resolved: NonNullable<ReturnType<typeof resolveDragTargetFrame>>;
  constraintLabel: string;
  reuseCurvature: boolean;
}): DraggedPointCandidate | null {
  const { session, resolved, constraintLabel } = input;
  return solveWithRebuildRetry<DraggedPointCandidate | null>({
    program: session.program,
    startValues: session.values,
    solve: () =>
      solveDragFrameGeneral({
        session,
        component: resolved.component,
        dragConstraints: resolved.constraints,
        draggedVariableIndices: resolved.draggedVariableIndices,
        constraintLabel,
        reuseCurvature: input.reuseCurvature,
      }),
    retry: (from) =>
      solveDragFrameGeneral({
        session,
        component: resolved.component,
        dragConstraints: resolved.constraints,
        draggedVariableIndices: resolved.draggedVariableIndices,
        constraintLabel,
        startValues: from,
      }),
    valuesOf: (candidate) => candidate?.values ?? null,
    reevaluate: (values) => reevaluateDraggedPointCandidate(session, values),
    isAccepted: (candidate) => candidate?.accepted === true,
  });
}

// D6 (minimum-motion-sketch-drag): decide constrained-movement feedback from the
// grabbed target's available degrees of freedom, not from cursor reachability.
// The dragged point has a free DOF iff it can be moved in SOME direction while
// the hard constraints stay satisfied. We probe the four axis directions with
// tiny throwaway drag frames (no session mutation): in 2D any non-degenerate DOF
// line has a component along +x or +y, so an axis probe that moves the point
// proves mobility. A fully constrained target moves in none of them.
const DRAG_DOF_PROBE_DISTANCE = 1e-2;
const DRAG_DOF_PROBE_MOVE_FRACTION = 0.25;
export function sketchDraggedPointHasFreeDof(
  session: SketchCompiledSolveSession,
  pointId: SketchPointId,
): boolean {
  if (session.disposed) {
    return false;
  }
  const record = session.program.system.pointRecords.get(pointId);
  if (!record) {
    return false;
  }
  const component = findComponentForPoint(session.program, pointId);
  const current = getPoint(
    session.program.system.parameterProjection.projectValues(session.values),
    record,
  );
  const probe = DRAG_DOF_PROBE_DISTANCE;
  const moveThreshold = probe * DRAG_DOF_PROBE_MOVE_FRACTION;
  const directions: readonly SketchPoint2D[] = [
    [probe, 0],
    [-probe, 0],
    [0, probe],
    [0, -probe],
  ];
  for (const direction of directions) {
    // [TECH] G16‴: each probe frame is a solve from the session's values.
    const frame = solveDraggedPointFrameWithRebuild({
      session,
      component,
      dragTarget: {
        kind: "sketchPoint",
        pointId,
        position: [current[0] + direction[0], current[1] + direction[1]],
      },
    });
    if (!frame || !frame.accepted) {
      continue;
    }
    if (
      length(
        subtract(
          getPoint(
            session.program.system.parameterProjection.projectValues(
              frame.values,
            ),
            record,
          ),
          current,
        ),
      ) > moveThreshold
    ) {
      return true;
    }
  }
  return false;
}

/**
 * One drag update. `targetTolerance` is the exact-reach (T13a2 d1)
 * tolerance of a point drag. `null` marks an interactive preview frame: it
 * skips the exact-reach step and reuses the previous frame's curvature
 * (c3). A frame with a tolerance (the release frame, a single solver call)
 * starts from the identity curvature and runs the exact-reach step, so the
 * committed state carries no reuse path dependence (review R-1/R-3).
 */
export function updateCompiledSketchSolveSession(
  session: SketchCompiledSolveSession,
  dragTarget: SketchDragTarget,
  targetTolerance: number | null = session.program.tolerances.coincidence,
): SketchDraggedPointSolveResult {
  if (session.disposed) {
    return {
      kind: "blocked",
      reason: "staleSession",
      solvedSnapshot: session.lastAcceptedSnapshot,
      diagnostics: [
        makeDiagnostic(
          "stale-interactive-solve-session",
          "error",
          `Interactive solve session ${session.sessionId} has been disposed.`,
          dragTargetDiagnosticTarget(dragTarget),
        ),
      ],
    };
  }

  // Validate the target references exist in the program.
  const validationError = validateDragTarget(session, dragTarget);
  if (validationError) return validationError;

  // Compute the substep distance from the motion metric of this target type.
  const motion = dragTargetMotion(session, dragTarget);
  if (!motion) {
    return {
      kind: "blocked",
      reason: "missingPoint",
      solvedSnapshot: session.lastAcceptedSnapshot,
      diagnostics: [
        makeDiagnostic(
          "drag-target-missing-point",
          "error",
          "Drag target references a missing solver element.",
          dragTargetDiagnosticTarget(dragTarget),
        ),
      ],
    };
  }

  const substeps = Math.max(
    1,
    Math.min(DRAG_MAX_SUBSTEPS, Math.ceil(motion.distance / DRAG_SUBSTEP_LIMIT)),
  );

  const projectedValues =
    session.program.system.parameterProjection.projectValues(session.values);

  let lastAccepted: SketchCoreSolveResult | null = null;

  for (let step = 1; step <= substeps; step += 1) {
    const fraction = step / substeps;
    const stepTarget = interpolateDragTarget(dragTarget, motion, fraction);

    if (stepTarget.kind === "sketchPoint") {
      // Point path: the minimum-motion frame solve with the exact-reach
      // step (T13a2 d1; whole-component translation is never shortcut).
      const component = findComponentForPoint(
        session.program,
        stepTarget.pointId,
      );
      const frame = solveDraggedPointFrameWithRebuild({
        session,
        component,
        dragTarget: stepTarget,
        interactive: { targetTolerance },
      });
      if (frame && frame.accepted) {
        acceptDraggedPointCandidate(
          session,
          frame.values,
          frame.materialized,
          frame.curvature,
        );
        session.lastPointDragTarget = stepTarget;
        lastAccepted = frame.materialized;
        continue;
      }
      if (!lastAccepted) {
        return blockedDragResult(session, frame, dragTarget);
      }
      break;
    }

    // Generalized path for translate/radius/tangent targets.
    const resolved = resolveDragTargetFrame(
      session.program,
      stepTarget,
      projectedValues,
      DRAG_TARGET_WEIGHT,
    );
    if (!resolved) {
      if (!lastAccepted) {
        return blockedDragResult(session, null, dragTarget);
      }
      break;
    }

    const solvedFrame = solveDragFrameGeneralWithRebuild({
      session,
      resolved,
      constraintLabel: dragTargetLabel(dragTarget),
      reuseCurvature: targetTolerance === null,
    });
    const frame =
      stepTarget.kind === "sketchTangentVector" && stepTarget.exactZero
        ? exactZeroTangentFrame(session, resolved, solvedFrame)
        : solvedFrame;
    if (frame && frame.accepted) {
      acceptDraggedPointCandidate(
        session,
        frame.values,
        frame.materialized,
        frame.curvature,
      );
      lastAccepted = frame.materialized;
      continue;
    }
    if (!lastAccepted) {
      return blockedDragResult(session, frame, dragTarget);
    }
    break;
  }

  return {
    kind: "solved",
    solvedSnapshot: session.lastAcceptedSnapshot,
    diagnostics:
      lastAccepted?.diagnostics ?? session.lastAcceptedSnapshot.diagnostics,
  };
}

// --- Helpers for the generalized updateCompiledSketchSolveSession ---

/**
 * T17i: the exact-zero pin is a penalty (½ v²), so its frame converges to
 * the solver tolerance (≈ 1e-7 after a run of capture frames), not to the
 * exactly [0, 0] the target promises (T12d D4). Like the point exact-reach
 * step (T13a2 d1), the pinned tangent slots are set to exactly 0 and the
 * candidate is re-judged; it is kept only if still accepted. A rejected
 * zeroed candidate silently keeps the solver's near-zero vector (as d1
 * keeps its unpinned candidate); no fixture reaches that branch.
 */
function exactZeroTangentFrame(
  session: SketchCompiledSolveSession,
  resolved: NonNullable<ReturnType<typeof resolveDragTargetFrame>>,
  frame: DraggedPointCandidate | null,
): DraggedPointCandidate | null {
  if (!frame?.accepted) return frame;
  if (
    resolved.draggedVariableIndices.every((index) => frame.values[index] === 0)
  )
    return frame;
  const values = cloneValues(frame.values);
  for (const index of resolved.draggedVariableIndices) values[index] = 0;
  const zeroed = reevaluateDraggedPointCandidate(session, values);
  return zeroed.accepted ? { ...zeroed, curvature: frame.curvature } : frame;
}

function dragTargetDiagnosticTarget(
  target: SketchDragTarget,
): { kind: "point"; pointId: SketchPointId } | { kind: "entity"; entityId: SketchEntityId } {
  switch (target.kind) {
    case "sketchPoint":
      return { kind: "point", pointId: target.pointId };
    case "sketchTranslate":
      return { kind: "point", pointId: target.pointIds[0]! as SketchPointId };
    case "sketchRadius":
      return { kind: "entity", entityId: target.entityId };
    case "sketchTangentVector":
      return { kind: "entity", entityId: target.entityId };
  }
}

function dragTargetLabel(target: SketchDragTarget): string {
  switch (target.kind) {
    case "sketchPoint":
      return target.pointId;
    case "sketchTranslate":
      return `translate_${target.pointIds[0]}`;
    case "sketchRadius":
      return `radius_${target.entityId}`;
    case "sketchTangentVector":
      return `tangent_${target.entityId}_${target.occurrenceId}`;
  }
}

function validateDragTarget(
  session: SketchCompiledSolveSession,
  target: SketchDragTarget,
): SketchDraggedPointSolveResult | null {
  switch (target.kind) {
    case "sketchPoint": {
      if (
        !session.program.definition.points.some(
          (p) => p.pointId === target.pointId,
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
              `Dragged point ${target.pointId} does not exist in the sketch definition.`,
              { kind: "point", pointId: target.pointId },
            ),
          ],
        };
      }
      if (!target.position.every(Number.isFinite)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Dragged point frame contains a non-finite target and cannot be solved.",
              { kind: "point", pointId: target.pointId },
            ),
          ],
        };
      }
      if (!session.program.system.pointRecords.get(target.pointId)) {
        return {
          kind: "blocked",
          reason: "missingPoint",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-missing-point",
              "error",
              `Dragged point ${target.pointId} does not exist in the compiled solve program.`,
              { kind: "point", pointId: target.pointId },
            ),
          ],
        };
      }
      return null;
    }
    case "sketchTranslate": {
      if (!target.delta.every(Number.isFinite)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Translate drag frame contains a non-finite delta and cannot be solved.",
              { kind: "point", pointId: target.pointIds[0]! as SketchPointId },
            ),
          ],
        };
      }
      return null;
    }
    case "sketchRadius": {
      if (!Number.isFinite(target.targetRadius)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Radius drag frame contains a non-finite target and cannot be solved.",
              { kind: "entity", entityId: target.entityId },
            ),
          ],
        };
      }
      return null;
    }
    case "sketchTangentVector": {
      if (!target.targetVector.every(Number.isFinite)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Tangent vector drag frame contains a non-finite target and cannot be solved.",
              { kind: "entity", entityId: target.entityId },
            ),
          ],
        };
      }
      return null;
    }
  }
}

/** T12b: motion metric for substep subdivision. */
type DragTargetMotion = {
  distance: number;
  startPosition?: SketchPoint2D;
  totalDelta?: SketchPoint2D;
  startRadius?: number;
  totalRadiusDelta?: number;
  startVector?: SketchPoint2D;
  totalVectorDelta?: SketchPoint2D;
};

function dragTargetMotion(
  session: SketchCompiledSolveSession,
  target: SketchDragTarget,
): DragTargetMotion | null {
  const system = session.program.system;
  const projectedValues = system.parameterProjection.projectValues(
    session.values,
  );
  switch (target.kind) {
    case "sketchPoint": {
      const record = system.pointRecords.get(target.pointId);
      if (!record) return null;
      const startPosition = getPoint(projectedValues, record);
      const totalDelta = subtract(target.position, startPosition);
      return { distance: length(totalDelta), startPosition, totalDelta };
    }
    case "sketchTranslate": {
      return { distance: length(target.delta), totalDelta: target.delta };
    }
    case "sketchRadius": {
      const entityState = system.entityStates.get(target.entityId);
      if (!entityState) return null;
      const startRadius = projectedValues[entityState.baseIndex]!;
      const totalRadiusDelta = target.targetRadius - startRadius;
      return {
        distance: Math.abs(totalRadiusDelta),
        startRadius,
        totalRadiusDelta,
      };
    }
    case "sketchTangentVector": {
      const tangentState = system.splineTangentStates.get(
        splineTangentStateKey(
          target.entityId,
          target.occurrenceId,
        ),
      );
      if (!tangentState) return null;
      const startVector: SketchPoint2D = [
        projectedValues[tangentState.baseIndex]!,
        projectedValues[tangentState.baseIndex + 1]!,
      ];
      const totalVectorDelta = subtract(target.targetVector, startVector);
      return {
        distance: length(totalVectorDelta),
        startVector,
        totalVectorDelta,
      };
    }
  }
}

/** T12b: interpolate a drag target to a substep fraction. */
function interpolateDragTarget(
  target: SketchDragTarget,
  motion: DragTargetMotion,
  fraction: number,
): SketchDragTarget {
  switch (target.kind) {
    case "sketchPoint":
      return {
        kind: "sketchPoint",
        pointId: target.pointId,
        position: [
          motion.startPosition![0] + motion.totalDelta![0] * fraction,
          motion.startPosition![1] + motion.totalDelta![1] * fraction,
        ],
      };
    case "sketchTranslate":
      return {
        kind: "sketchTranslate",
        pointIds: target.pointIds,
        delta: [
          motion.totalDelta![0] * fraction,
          motion.totalDelta![1] * fraction,
        ],
      };
    case "sketchRadius":
      return {
        kind: "sketchRadius",
        entityId: target.entityId,
        targetRadius:
          motion.startRadius! + motion.totalRadiusDelta! * fraction,
      };
    case "sketchTangentVector":
      return {
        kind: "sketchTangentVector",
        entityId: target.entityId,
        occurrenceId: target.occurrenceId,
        targetVector: [
          motion.startVector![0] + motion.totalVectorDelta![0] * fraction,
          motion.startVector![1] + motion.totalVectorDelta![1] * fraction,
        ],
        exactZero: target.exactZero,
      };
  }
}

function blockedDragResult(
  session: SketchCompiledSolveSession,
  frame: DraggedPointCandidate | null,
  target: SketchDragTarget,
): SketchDraggedPointSolveResult {
  return {
    kind: "blocked",
    reason: "nonConvergent",
    solvedSnapshot: session.lastAcceptedSnapshot,
    diagnostics: [
      ...(frame?.materialized.diagnostics ?? []),
      makeDiagnostic(
        "drag-target-nonconvergent",
        "warning",
        "Dragged point frame could not converge to a valid constrained solution.",
        dragTargetDiagnosticTarget(target),
      ),
    ],
  };
}

function buildSolvedEntities(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  splineTangentStates: Map<string, SplineTangentState>,
  values: Float64Array,
  shellSpans: ReadonlyMap<SketchEntityId, SolvedSketchDerivedCubicSpan[]>,
): SolvedSketchEntityGeometryRecord[] {
  const solved: SolvedSketchEntityGeometryRecord[] = [];
  const pointDefinedArcEntityIds = new Set(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? relationship.seedEntityIds.filter(
            (entityId) =>
              definition.entities.find((entity) => entity.entityId === entityId)
                ?.kind === "arc",
          )
        : [],
    ),
  );
  for (const entity of definition.entities) {
    if (entity.kind === "derivedPiecewiseCubic") {
      // [TECH] G7: the solve frame is uncertified; only publish certifies.
      // A failed relationship has no spans (its diagnostic is in the solve).
      solved.push({
        entityId: entity.entityId,
        kind: "derivedPiecewiseCubic",
        publication: "provisional",
        spans: shellSpans.get(entity.entityId) ?? [],
      });
      continue;
    }

    if (entity.kind === "point") {
      const point = pointRecords.get(entity.pointId);
      if (point) {
        solved.push({
          entityId: entity.entityId,
          kind: "point",
          solvedPosition: getPoint(values, point),
        });
      }
      continue;
    }

    if (entity.kind === "lineSegment") {
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (start && end) {
        solved.push({
          entityId: entity.entityId,
          kind: "lineSegment",
          startPosition: getPoint(values, start),
          endPosition: getPoint(values, end),
        });
      }
      continue;
    }

    if (entity.kind === "circle") {
      const center = pointRecords.get(entity.centerPointId);
      const circleState = entityStates.get(entity.entityId);
      if (center) {
        solved.push({
          entityId: entity.entityId,
          kind: "circle",
          centerPosition: getPoint(values, center),
          solvedRadius:
            circleState?.kind === "circle"
              ? getCircleRadius(values, circleState)
              : entity.radius,
        });
      }
      continue;
    }

    if (entity.kind === "spline") {
      const positions = Object.fromEntries(
        [...pointRecords.entries()].map(([pointId, point]) => [
          pointId,
          getPoint(values, point),
        ]),
      ) as Record<SketchPointId, SketchPoint2D>;
      const currentEntity = {
        ...entity,
        pointOccurrences: entity.pointOccurrences.map((occurrence) => {
          if (occurrence.tangent.kind !== "authored") return occurrence;
          const state = splineTangentStates.get(
            splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
          );
          return state
            ? {
                ...occurrence,
                tangent: {
                  kind: "authored" as const,
                  vector: [
                    values[state.baseIndex]!,
                    values[state.baseIndex + 1]!,
                  ] as const,
                },
              }
            : occurrence;
        }),
      };
      solved.push({
        entityId: entity.entityId,
        kind: "spline",
        reconstruction: reconstructSplineAggregate(currentEntity, positions),
      });
      continue;
    }

    if (entity.kind === "ellipse") {
      const center = pointRecords.get(entity.centerPointId);
      const major = pointRecords.get(entity.majorAxisPointId);
      if (center && major) {
        solved.push({
          entityId: entity.entityId,
          kind: "ellipse",
          centerPosition: getPoint(values, center),
          majorAxisEndpointPosition: getPoint(values, major),
          minorRadius: entity.minorRadius,
        });
      }
      continue;
    }

    if (entity.kind === "ellipticalArc") {
      const center = pointRecords.get(entity.centerPointId);
      const major = pointRecords.get(entity.majorAxisPointId);
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (center && major && start && end) {
        solved.push({
          entityId: entity.entityId,
          kind: "ellipticalArc",
          centerPosition: getPoint(values, center),
          majorAxisEndpointPosition: getPoint(values, major),
          startPosition: getPoint(values, start),
          endPosition: getPoint(values, end),
          minorRadius: entity.minorRadius,
          sweepDirection: entity.sweepDirection,
        });
      }
      continue;
    }

    if (entity.kind === "conic") {
      const start = pointRecords.get(entity.startPointId);
      const control = pointRecords.get(entity.controlPointId);
      const end = pointRecords.get(entity.endPointId);
      if (start && control && end) {
        solved.push({
          entityId: entity.entityId,
          kind: "conic",
          startPosition: getPoint(values, start),
          controlPosition: getPoint(values, control),
          endPosition: getPoint(values, end),
          rho: entity.rho,
        });
      }
      continue;
    }

    if (entity.kind === "bezierCurve") {
      const controlPoints = entity.controlPointIds.flatMap((pointId) => {
        const point = pointRecords.get(pointId);
        return point ? [getPoint(values, point)] : [];
      });
      if (controlPoints.length === entity.controlPointIds.length) {
        solved.push({
          entityId: entity.entityId,
          kind: "bezierCurve",
          controlPoints,
          degree: entity.degree,
        });
      }
      continue;
    }

    if (entity.kind === "profileText") {
      const anchor = pointRecords.get(entity.anchorPointId);
      if (anchor) {
        solved.push({
          entityId: entity.entityId,
          kind: "profileText",
          anchorPosition: getPoint(values, anchor),
          text: entity.text,
          height: entity.height,
          rotationRadians: entity.rotationRadians,
          horizontalAlign: entity.horizontalAlign,
          verticalAlign: entity.verticalAlign,
        });
      }
      continue;
    }

    const center = pointRecords.get(entity.centerPointId);
    const start = pointRecords.get(entity.startPointId);
    const end = pointRecords.get(entity.endPointId);
    const arcState = entityStates.get(entity.entityId);
    if (!center || !start || !end || !arcState || arcState.kind !== "arc") {
      continue;
    }
    const centerPos = getPoint(values, center);
    const pointDefined = pointDefinedArcEntityIds.has(entity.entityId);
    const { radius, startAngle, endAngle } = getArcParameters(values, arcState);
    const startPosition = pointDefined
      ? getPoint(values, start)
      : add(centerPos, [
          radius * Math.cos(startAngle),
          radius * Math.sin(startAngle),
        ]);
    const endPosition = pointDefined
      ? getPoint(values, end)
      : add(centerPos, [
          radius * Math.cos(endAngle),
          radius * Math.sin(endAngle),
        ]);
    solved.push({
      entityId: entity.entityId,
      kind: "arc",
      centerPosition: centerPos,
      startPosition,
      endPosition,
      sweepDirection: entity.sweepDirection,
    });
  }
  return solved;
}

/**
 * T13e2 (B1): per local line, how far beyond its segment the requirements
 * rely on its infinite extension (0 when every use lies on the segment).
 * An orientation requirement on that line must keep its positional effect
 * over that lever within the coincidence tolerance (see
 * `orientationLeverWithinTolerance`); otherwise a conflict is absorbed by a
 * tilt that is tiny at the segment but large at a far contact, and the solve
 * slides kilometres along the extension.
 *
 * The uses: a line ↔ circle/arc tangency (local or projected curve: the
 * centre's foot), point-on-line, collinear (the target point, or the
 * target line's endpoints), normal to a local or projected curve
 * (its centre and the contact point), symmetric about a line (both
 * points) and the line-point distance dimension (the point); each is
 * pinned by a far-basin row. Projected and datum lines are fixed, so only
 * local lines carry a lever; the midpoint constraint uses the segment
 * itself. Line distance and equal offset are not sources (no solve reaches
 * a far basin through their own measurement, T13e2 re-review evidence);
 * their parallel prerequisites are judged over the lever the lines get
 * from the other uses.
 */
function lineExtensionLevers(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
): ReadonlyMap<SketchEntityId, number> {
  const levers = new Map<SketchEntityId, number>();
  const lineEntityMap = new Map(
    definition.entities.flatMap((entity) =>
      entity.kind === "lineSegment" ? [[entity.entityId, entity] as const] : [],
    ),
  );
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity] as const),
  );
  const pointAt = (pointId: SketchPointId) => {
    const record = pointRecords.get(pointId);
    return record ? getPoint(values, record) : null;
  };
  const linePoints = (entityId: SketchEntityId) => {
    const line = lineEntityMap.get(entityId);
    const start = line && pointAt(line.startPointId);
    const end = line && pointAt(line.endPointId);
    return start && end ? ([start, end] as const) : null;
  };
  const relyOn = (entityId: SketchEntityId, point: SketchPoint2D | null) => {
    const segment = linePoints(entityId);
    if (!segment || !point) return;
    const [start, end] = segment;
    const segmentLength = length(subtract(end, start));
    if (!(segmentLength > 0)) return;
    const along =
      ((point[0] - start[0]) * (end[0] - start[0]) +
        (point[1] - start[1]) * (end[1] - start[1])) /
      segmentLength;
    const beyond = Math.max(0, -along, along - segmentLength);
    if (beyond > (levers.get(entityId) ?? 0)) levers.set(entityId, beyond);
  };
  const relyOnLine = (entityId: SketchEntityId, otherId: SketchEntityId) => {
    for (const point of linePoints(otherId) ?? []) relyOn(entityId, point);
  };
  const localCenter = (entityId: SketchEntityId) => {
    const entity = entityById.get(entityId);
    return entity
      ? (getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates)
          ?.center ?? null)
      : null;
  };
  const projectedCenter = (
    reference: Parameters<typeof findProjectedGeometry>[1],
  ) => {
    const projected = findProjectedGeometry(projectedReferences, reference);
    return projected
      ? (projectedCircleLikeGeometry(projected)?.center ?? null)
      : null;
  };

  for (const constraint of definition.constraints) {
    switch (constraint.kind) {
      case "tangent": {
        const [first, second] = constraint.entityIds;
        if (lineEntityMap.has(first)) relyOn(first, localCenter(second));
        if (lineEntityMap.has(second)) relyOn(second, localCenter(first));
        break;
      }
      case "tangentProjectedCurve":
        relyOn(
          constraint.curve.entityId,
          projectedCenter(constraint.projectedCurve.reference),
        );
        break;
      case "pointOnCurve":
        relyOn(constraint.curve.entityId, pointAt(constraint.point.pointId));
        break;
      case "collinear":
        if (constraint.target.kind === "localPoint") {
          relyOn(constraint.line.entityId, pointAt(constraint.target.pointId));
        } else {
          // The residual reads the line's extension at the target's
          // endpoints, never the target's extension.
          relyOnLine(constraint.line.entityId, constraint.target.entityId);
        }
        break;
      case "normal":
        relyOn(
          constraint.line.entityId,
          localCenter(constraint.curve.entityId),
        );
        relyOn(constraint.line.entityId, pointAt(constraint.point.pointId));
        break;
      case "normalProjectedCurve":
        relyOn(
          constraint.line.entityId,
          projectedCenter(constraint.projectedCurve.reference),
        );
        relyOn(constraint.line.entityId, pointAt(constraint.point.pointId));
        break;
      case "symmetric":
        for (const pointId of constraint.pointIds)
          relyOn(constraint.axis.entityId, pointAt(pointId));
        break;
      default:
        break;
    }
  }
  for (const dimension of definition.dimensions) {
    if (dimension.kind === "linePointDistance") {
      if (dimension.line.kind === "localEntity")
        relyOn(
          dimension.line.entityId,
          resolvePointDimensionOperand(
            values,
            dimension.point,
            pointRecords,
            projectedReferences,
          ),
        );
    }
  }
  return levers;
}

/**
 * T13e2 (B1): an orientation requirement's angular deviation, carried over
 * the lever of its lines' extensions, stays within the coincidence
 * tolerance. Always true without a lever.
 */
function orientationLeverWithinTolerance(
  deviation: number,
  lever: number,
  tolerance: SketchSolveTolerancePolicy,
) {
  return lever <= 0 || deviation * lever <= tolerance.coincidence;
}

/**
 * T13e2 (A1, B1): a horizontal/vertical line is judged by its endpoint
 * offset (|Δ| ≤ coincidence, as before), by its direction (asin(|Δ|/ℓ) ≤
 * angleRadians, the tolerance parallel and perpendicular use; a positional
 * check alone lets a line about τ long take any direction) and over the
 * lever of its extension (|Δ|/ℓ·(ℓ + lever) ≤ coincidence).
 */
function axisAlignedLineWithinTolerance(
  kind: "horizontal" | "vertical",
  start: SketchPoint2D,
  end: SketchPoint2D,
  lever: number,
  tolerance: SketchSolveTolerancePolicy,
) {
  const offset = Math.abs(
    kind === "horizontal" ? end[1] - start[1] : end[0] - start[0],
  );
  const lineLength = length(subtract(end, start));
  if (!(lineLength > 0)) return false;
  const sine = Math.min(1, offset / lineLength);
  return (
    offset <= tolerance.coincidence &&
    Math.asin(sine) <= tolerance.angleRadians &&
    sine * (lineLength + lever) <= tolerance.coincidence
  );
}

function buildConstraintStatuses(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  tolerance: SketchSolveTolerancePolicy,
  perConstraint: Map<string, number>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
  levers: ReadonlyMap<SketchEntityId, number> = new Map(),
): ConstraintStatusRecord[] {
  const lineEntityMap = new Map(
    definition.entities
      .filter(
        (
          entity,
        ): entity is Extract<SketchEntityDefinition, { kind: "lineSegment" }> =>
          entity.kind === "lineSegment",
      )
      .map((entity) => [entity.entityId, entity]),
  );

  return definition.constraints.map((constraint) => {
    let status: ConstraintStatusRecord["status"] = "satisfied";
    const residual = perConstraint.get(constraint.constraintId) ?? 0;
    const residualTolerance =
      constraint.kind === "parallel" ||
      constraint.kind === "perpendicular" ||
      constraint.kind === "angle" ||
      constraint.kind === "parallelProjectedLine" ||
      constraint.kind === "perpendicularProjectedLine"
        ? tolerance.angleRadians
        : tolerance.coincidence;
    // The normal residual is 0.5·(curve² + direction² + contact²); its
    // dimensionless direction sine is judged against the angle and the two
    // length terms against the coincidence tolerance.
    const isNormalWithinTolerance = (
      line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
      point: SolverPointRecord,
      center: SketchPoint2D,
    ) => {
      const start = pointRecords.get(line.startPointId);
      const end = pointRecords.get(line.endPointId);
      const direction =
        start && end
          ? lineNormalDirectionResidual(
              getPoint(values, start),
              getPoint(values, end),
              getPoint(values, point),
              center,
            )
          : 0;
      const directionResidual = 0.5 * direction * direction;
      return (
        isConstraintResidualWithinTolerance(
          directionResidual,
          tolerance.angleRadians,
        ) &&
        isConstraintResidualWithinTolerance(
          residual - directionResidual,
          tolerance.coincidence,
        )
      );
    };

    if (constraint.kind === "equalOffset") {
      const pairPrimitives = constraint.pairs.map((pair) => {
        if (pair.seedEntityId === pair.offsetEntityId) return null;
        const seed = lineEntityMap.get(pair.seedEntityId);
        const offset = lineEntityMap.get(pair.offsetEntityId);
        if (!seed || !offset) return null;
        const seedStart = pointRecords.get(seed.startPointId);
        const seedEnd = pointRecords.get(seed.endPointId);
        const offsetStart = pointRecords.get(offset.startPointId);
        const offsetEnd = pointRecords.get(offset.endPointId);
        if (!seedStart || !seedEnd || !offsetStart || !offsetEnd) return null;

        const seedVector = subtract(
          getPoint(values, seedEnd),
          getPoint(values, seedStart),
        );
        const offsetVector = subtract(
          getPoint(values, offsetEnd),
          getPoint(values, offsetStart),
        );
        const seedLength = length(seedVector);
        const offsetLength = length(offsetVector);
        if (
          !Number.isFinite(seedLength) ||
          !Number.isFinite(offsetLength) ||
          seedLength < DEGENERATE_NORM_EPSILON ||
          offsetLength < DEGENERATE_NORM_EPSILON
        ) {
          return null;
        }
        const seedUnit: SketchPoint2D = [
          seedVector[0] / seedLength,
          seedVector[1] / seedLength,
        ];
        const offsetUnit: SketchPoint2D = [
          offsetVector[0] / offsetLength,
          offsetVector[1] / offsetLength,
        ];
        const side = pair.side === "left" ? 1 : -1;
        const signedDistance =
          side *
          dot2(
            [-seedUnit[1], seedUnit[0]],
            subtract(
              getPoint(values, offsetStart),
              getPoint(values, seedStart),
            ),
          );
        const parallel =
          seedUnit[0] * offsetUnit[1] - seedUnit[1] * offsetUnit[0];
        return { parallel, signedDistance };
      });
      const first = pairPrimitives[0];
      const second = pairPrimitives[1];
      if (!first || !second) {
        status = "conflicting";
      } else {
        const firstAngularError = Math.asin(
          Math.min(1, Math.abs(first.parallel)),
        );
        const secondAngularError = Math.asin(
          Math.min(1, Math.abs(second.parallel)),
        );
        status =
          Number.isFinite(firstAngularError) &&
          Number.isFinite(secondAngularError) &&
          Number.isFinite(first.signedDistance) &&
          Number.isFinite(second.signedDistance) &&
          firstAngularError <= tolerance.angleRadians &&
          secondAngularError <= tolerance.angleRadians &&
          // T13e2 (re-review RR-1): each pair's parallelism is an
          // orientation requirement, judged over its lines' lever.
          constraint.pairs.every((pair, index) =>
            orientationLeverWithinTolerance(
              index === 0 ? firstAngularError : secondAngularError,
              Math.max(
                levers.get(pair.seedEntityId) ?? 0,
                levers.get(pair.offsetEntityId) ?? 0,
              ),
              tolerance,
            ),
          ) &&
          Math.abs(first.signedDistance - second.signedDistance) <=
            tolerance.coincidence
            ? "satisfied"
            : "unsatisfied";
      }
    } else if (
      constraint.kind === "horizontal" ||
      constraint.kind === "vertical"
    ) {
      const entity = lineEntityMap.get(constraint.entityId);
      if (!entity) {
        status = "conflicting";
      } else {
        const start = pointRecords.get(entity.startPointId);
        const end = pointRecords.get(entity.endPointId);
        if (!start || !end) {
          status = "conflicting";
        } else {
          status = axisAlignedLineWithinTolerance(
            constraint.kind,
            getPoint(values, start),
            getPoint(values, end),
            levers.get(constraint.entityId) ?? 0,
            tolerance,
          )
            ? "satisfied"
            : "unsatisfied";
        }
      }
    } else if (constraint.kind === "midpoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const line = lineEntityMap.get(constraint.line.entityId);
      status =
        point && line
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "midpointProjectedLine") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        point &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "pointOnCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      status =
        point &&
        entity &&
        (entity.kind === "lineSegment" ||
          entity.kind === "circle" ||
          entity.kind === "arc" ||
          entity.kind === "spline" ||
          entity.kind === "derivedPiecewiseCubic")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "collinear") {
      const targetValid =
        constraint.target.kind === "localPoint"
          ? pointRecords.has(constraint.target.pointId)
          : lineEntityMap.has(constraint.target.entityId);
      const line = lineEntityMap.get(constraint.line.entityId);
      status =
        targetValid && line
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "collinearProjectedLine") {
      const targetValid =
        constraint.target.kind === "localPoint"
          ? pointRecords.has(constraint.target.pointId)
          : lineEntityMap.has(constraint.target.entityId);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        targetValid &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "coincidentProjectedPoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedPoint.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedPoint.reference,
            )
          : null;
      status =
        point &&
        (projected?.kind === "point" ||
          constraint.projectedPoint.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "pointOnProjectedCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedCurve.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedCurve.reference,
            )
          : null;
      status =
        point &&
        (projected !== null || constraint.projectedCurve.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (
      constraint.kind === "parallelProjectedLine" ||
      constraint.kind === "perpendicularProjectedLine"
    ) {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        line &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "tangentProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        projectedReferences,
        constraint.projectedCurve.reference,
      );
      status =
        entity &&
        (entity.kind === "lineSegment" ||
          entity.kind === "circle" ||
          entity.kind === "arc") &&
        projected &&
        projectedCircleLikeGeometry(projected) !== null
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "tangent") {
      const entities = constraint.entityIds.map((entityId) =>
        definition.entities.find(
          (candidate) => candidate.entityId === entityId,
        ),
      );
      status = (splineArcEndpointTangency(definition, entities[0], entities[1]) || entities.every(
        (entity) =>
          entity &&
          (entity.kind === "lineSegment" ||
            entity.kind === "circle" ||
            entity.kind === "arc"),
      ))
        ? isConstraintResidualWithinTolerance(residual, residualTolerance)
          ? "satisfied"
          : "unsatisfied"
        : "conflicting";
    } else if (constraint.kind === "concentric") {
      const entities = constraint.entityIds.map((entityId) =>
        definition.entities.find(
          (candidate) => candidate.entityId === entityId,
        ),
      );
      status = entities.every(
        (entity) =>
          entity && (entity.kind === "circle" || entity.kind === "arc"),
      )
        ? isConstraintResidualWithinTolerance(residual, residualTolerance)
          ? "satisfied"
          : "unsatisfied"
        : "conflicting";
    } else if (constraint.kind === "concentricProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        projectedReferences,
        constraint.projectedCurve.reference,
      );
      status =
        entity &&
        (entity.kind === "circle" || entity.kind === "arc") &&
        projected &&
        projectedCircleLikeGeometry(projected) !== null
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "normal") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const curve = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const point = pointRecords.get(constraint.point.pointId);
      const circleLike =
        curve && (curve.kind === "circle" || curve.kind === "arc")
          ? getLocalCircleLikeGeometry(
              values,
              curve,
              pointRecords,
              entityStates,
            )
          : null;
      status =
        line && point && circleLike
          ? isNormalWithinTolerance(line, point, circleLike.center)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "normalProjectedCurve") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projected = findProjectedGeometry(
        projectedReferences,
        constraint.projectedCurve.reference,
      );
      const point = pointRecords.get(constraint.point.pointId);
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      status =
        line && point && projectedCircle
          ? isNormalWithinTolerance(line, point, projectedCircle.center)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "symmetric") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const axis = lineEntityMap.get(constraint.axis.entityId);
      status =
        first && second && axis
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (constraint.kind === "symmetricProjectedLine") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const projected =
        constraint.projectedLine.kind === "projectedGeometry"
          ? findProjectedGeometry(
              projectedReferences,
              constraint.projectedLine.reference,
            )
          : null;
      status =
        first &&
        second &&
        (projected?.kind === "lineSegment" ||
          constraint.projectedLine.kind === "sketchDatum")
          ? isConstraintResidualWithinTolerance(residual, residualTolerance)
            ? "satisfied"
            : "unsatisfied"
          : "conflicting";
    } else if (
      !isConstraintResidualWithinTolerance(residual, residualTolerance)
    ) {
      status = "unsatisfied";
    }

    // T13e2 (B1): a relative orientation over its lines' extension lever.
    const leverLineIds =
      constraint.kind === "parallel" || constraint.kind === "perpendicular"
        ? constraint.entityIds
        : constraint.kind === "parallelProjectedLine" ||
            constraint.kind === "perpendicularProjectedLine"
          ? [constraint.line.entityId]
          : [];
    if (
      status === "satisfied" &&
      !orientationLeverWithinTolerance(
        Math.asin(Math.min(1, Math.sqrt(2 * residual))),
        Math.max(0, ...leverLineIds.map((id) => levers.get(id) ?? 0)),
        tolerance,
      )
    ) {
      status = "unsatisfied";
    }

    return {
      constraintId: constraint.constraintId,
      status,
    };
  });
}

function buildDimensionStatuses(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  perConstraint: Map<string, number>,
  tolerance: SketchSolveTolerancePolicy,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
  levers: ReadonlyMap<SketchEntityId, number> = new Map(),
): DimensionStatusRecord[] {
  const entityMap = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const lineEntityMap = new Map(
    definition.entities
      .filter(
        (
          entity,
        ): entity is Extract<SketchEntityDefinition, { kind: "lineSegment" }> =>
          entity.kind === "lineSegment",
      )
      .map((entity) => [entity.entityId, entity]),
  );

  return definition.dimensions.map((dimension) => {
    let solvedValue: number | null = null;
    let orientationOverLever = false;
    if (dimension.kind === "distance") {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (left && right) {
        const delta =
          dimension.axis === "aligned"
            ? subtract(getPoint(values, left), getPoint(values, right))
            : subtract(getPoint(values, right), getPoint(values, left));
        solvedValue =
          dimension.axis === "aligned"
            ? length(delta)
            : dimension.axis === "horizontal"
              ? delta[0]
              : delta[1];
      }
    } else if (
      dimension.kind === "horizontalDistance" ||
      dimension.kind === "verticalDistance"
    ) {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (left && right) {
        const delta = subtract(getPoint(values, right), getPoint(values, left));
        solvedValue =
          dimension.kind === "horizontalDistance" ? delta[0] : delta[1];
      }
    } else if (dimension.kind === "circleRadius") {
      const entity = entityMap.get(dimension.entityId);
      const circleLike = entity
        ? getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates)
        : null;
      solvedValue =
        entity?.kind === "circle" ? (circleLike?.radius ?? null) : null;
    } else if (dimension.kind === "diameter") {
      const entity = entityMap.get(dimension.entityId);
      const circleLike = entity
        ? getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates)
        : null;
      solvedValue = circleLike ? circleLike.radius * 2 : null;
    } else if (dimension.kind === "lineLength") {
      const entity = lineEntityMap.get(dimension.entityId);
      const start = entity ? pointRecords.get(entity.startPointId) : null;
      const end = entity ? pointRecords.get(entity.endPointId) : null;
      solvedValue =
        start && end
          ? length(subtract(getPoint(values, end), getPoint(values, start)))
          : null;
    } else if (dimension.kind === "pointDatumDistance") {
      const point = pointRecords.get(dimension.point.pointId);
      const datumPoint = resolveSketchDatumPoint(dimension.datum.datum);
      if (point && datumPoint) {
        const localPoint = getPoint(values, point);
        solvedValue =
          dimension.axis === "horizontal"
            ? Math.abs(localPoint[0] - datumPoint[0])
            : dimension.axis === "vertical"
              ? Math.abs(localPoint[1] - datumPoint[1])
              : length(subtract(localPoint, datumPoint));
      } else {
        solvedValue = null;
      }
    } else if (dimension.kind === "lineDistance") {
      const first = resolveLineDimensionOperand(
        values,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const second = resolveLineDimensionOperand(
        values,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      solvedValue =
        first &&
        second &&
        linesParallelWithinTolerance(first, second, tolerance)
          ? Math.abs(
              pointLineSignedDistance(second.start, first.start, first.end),
            )
          : null;
      // T13e2 (re-review RR-2): its parallel prerequisite is an orientation
      // requirement too, judged over its lines' extension lever.
      if (first && second && solvedValue !== null)
        orientationOverLever = !orientationLeverWithinTolerance(
          Math.asin(
            Math.min(
              1,
              Math.abs(
                lineParallelResidual(
                  first.start,
                  first.end,
                  second.start,
                  second.end,
                ),
              ),
            ),
          ),
          Math.max(
            0,
            ...dimension.lines.map((operand) =>
              operand.kind === "localEntity"
                ? (levers.get(operand.entityId) ?? 0)
                : 0,
            ),
          ),
          tolerance,
        );
    } else if (dimension.kind === "linePointDistance") {
      const line = resolveLineDimensionOperand(
        values,
        dimension.line,
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const point = resolvePointDimensionOperand(
        values,
        dimension.point,
        pointRecords,
        projectedReferences,
      );
      solvedValue =
        line && point
          ? Math.abs(pointLineSignedDistance(point, line.start, line.end))
          : null;
    } else if (dimension.kind === "lineAngle") {
      const first = resolveLineDimensionOperand(
        values,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const second = resolveLineDimensionOperand(
        values,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        projectedReferences,
      );
      const angle =
        first && second
          ? lineAngleRadians(first.start, first.end, second.start, second.end)
          : null;
      solvedValue =
        angle !== null && angle > DEGENERATE_NORM_EPSILON ? angle : null;
    } else {
      const state = entityStates.get(dimension.entityId);
      solvedValue = state?.kind === "arc" ? 0 : null;
    }

    // T13d (D10): a reference dimension only reports its measured quantity.
    if (isReferenceDimension(dimension)) {
      return {
        dimensionId: dimension.dimensionId,
        status: "driven" as const,
        solvedValue,
      };
    }

    const residualTolerance =
      dimension.kind === "lineAngle"
        ? tolerance.angleRadians
        : tolerance.coincidence;
    // Line-distance and line-angle admission is judged at the initial values,
    // so a dimension that never entered the solver must not read as zero error.
    return {
      dimensionId: dimension.dimensionId,
      status:
        solvedValue === null ||
        !perConstraint.has(dimension.dimensionId) ||
        !isConstraintResidualWithinTolerance(
          perConstraint.get(dimension.dimensionId) ?? 0,
          residualTolerance,
        ) ||
        orientationOverLever ||
        // T13e2 (B1): an angle over its lines' extension lever.
        (dimension.kind === "lineAngle" &&
          !orientationLeverWithinTolerance(
            Math.sqrt(2 * (perConstraint.get(dimension.dimensionId) ?? 0)),
            Math.max(
              0,
              ...dimension.lines.map((operand) =>
                operand.kind === "localEntity"
                  ? (levers.get(operand.entityId) ?? 0)
                  : 0,
              ),
            ),
            tolerance,
          ))
          ? "unsatisfied"
          : "driving",
      solvedValue,
    };
  });
}

// getLineEntityPoints / getCollinearTargetPointIds were only used by the removed
// rigid-translation fallback cluster and were deleted with it.

function getEntityPoints(
  entity: SketchEntityDefinition,
): readonly SketchPointId[] {
  switch (entity.kind) {
    case "point":
      return [entity.pointId];
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "circle":
      return [entity.centerPointId];
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId];
    case "spline":
      return (
        orderedSplineOccurrences(entity)?.map(({ pointId }) => pointId) ?? []
      );
    case "ellipse":
      return [entity.centerPointId, entity.majorAxisPointId];
    case "ellipticalArc":
      return [
        entity.centerPointId,
        entity.majorAxisPointId,
        entity.startPointId,
        entity.endPointId,
      ];
    case "conic":
      return [entity.startPointId, entity.controlPointId, entity.endPointId];
    case "bezierCurve":
      return entity.controlPointIds;
    case "profileText":
      return [entity.anchorPointId];
    case "derivedPiecewiseCubic":
      return [];
  }
}

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

/**
 * T13e (D11): the verdict of the determined-quantity probe for a candidate
 * dimension. `unmeasurable` when the quantity has no measured value or no
 * residual row at the current positions (e.g. a line distance between
 * non-parallel lines); the caller then treats it as independent.
 */
export type SketchDimensionRedundancyProbe =
  | {
      kind: "determined" | "independent";
      /** m: the solver's measurement (signed for h/v point pairs). */
      measuredValue: number;
      /** δ in the quantity's unit (mm, or radians for a line angle). */
      delta: number;
      /** The trial values solved, in order (the probe stops at the first accepted). */
      trialValues: readonly number[];
      /** The strategy the trials were solved with (review B-1: no GN fallback). */
      trialStrategy: SketchSolveStrategy;
    }
  | { kind: "unmeasurable" };

/**
 * T13e (D11, review R-2): the assumed gain A in the step-size heuristic
 * δ = A·(τ_c + Σ_i t_i), the sum over every other requirement row in the
 * candidate's solve component (t_i is the row's tolerance in the
 * candidate's unit). To first order a determined quantity f obeys
 * f − m = Σ_i a_i·r_i over the existing rows' residual values r_i, so a
 * trial f = m ± δ can be accepted only if δ ≤ τ_c + Σ_i |a_i|·t_i. The rule
 * exceeds that when every |a_i| ≤ A (chains of equal lengths, h/v rows and
 * point pairs have |a_i| = 1, radius ↔ diameter 2). It is a heuristic, not a
 * bound: a redundancy through larger gains (a thin rectangle's width from its
 * height and diagonal, |a_i| ≈ 10) can read independent, which is benign (a
 * consistent redundant driving dimension). See T13e.md.
 */
const REDUNDANCY_PROBE_GAIN_BOUND = 2;

/**
 * T13e (review R-2): the probe's step stays within this fraction of |m|
 * (but never below the rule's single-row step A·2·τ_c), so a trial never
 * reshapes the sketch far from its current state. A probe step size, not a
 * product tolerance; a capped δ can only miss a redundancy (benign).
 */
const REDUNDANCY_PROBE_RELATIVE_STEP = 0.1;

/** Constraint kinds judged (wholly or partly) against the angle tolerance. */
const ANGULAR_TOLERANCE_CONSTRAINT_KINDS: ReadonlySet<
  ConstraintDefinition["kind"]
> = new Set([
  "parallel",
  "perpendicular",
  "angle",
  "parallelProjectedLine",
  "perpendicularProjectedLine",
  "normal",
  "normalProjectedCurve",
  "equalOffset",
]);

/** Constraint kinds with no length-tolerance part. */
const ANGLE_ONLY_CONSTRAINT_KINDS: ReadonlySet<ConstraintDefinition["kind"]> =
  new Set([
    "parallel",
    "perpendicular",
    "angle",
    "parallelProjectedLine",
    "perpendicularProjectedLine",
  ]);

/**
 * T17p2 (F-2): the probe's candidate is the editor's authored dimension (or
 * a resolved one); only its kind and targets matter, each trial replaces its
 * value.
 */
type RedundancyCandidate = DimensionDefinition | AuthoredDimensionDefinition;

function withCandidateDimension(
  definition: SketchDefinition,
  candidate: RedundancyCandidate,
  value: number,
): SketchDefinition {
  const driving =
    candidate.kind === "lineAngle"
      ? { ...candidate, valueRadians: value }
      : { ...candidate, value };
  delete (driving as { reference?: true }).reference;
  return {
    ...definition,
    dimensionIds: [...definition.dimensionIds, candidate.dimensionId],
    dimensions: [...definition.dimensions, driving as DimensionDefinition],
  };
}

/** The quantity's domain: signed point-pair components are unbounded. */
function isRedundancyTrialValueInDomain(
  candidate: RedundancyCandidate,
  value: number,
) {
  if (candidate.kind === "lineAngle") return value > 0 && value < Math.PI;
  if (
    candidate.kind === "horizontalDistance" ||
    candidate.kind === "verticalDistance" ||
    (candidate.kind === "distance" && candidate.axis !== "aligned")
  ) {
    return Number.isFinite(value);
  }
  return value > 0;
}

/**
 * T13e (D11): is the candidate dimension's quantity already determined by
 * the existing requirements? Trial-solves the definition plus the candidate
 * as a driving dimension at m + δ and m − δ (m measured at the definition's
 * positions) with the document tolerances and the normal acceptance check
 * and rebuild retry. The trials run the BFGS stage only, without the
 * Gauss–Newton fallback (D11 as amended by review B-1: an inconsistent trial
 * otherwise costs tens of seconds); that can only add false "determined"
 * verdicts, which are visible and switchable. If no trial is accepted with
 * the candidate satisfied, the quantity is determined; otherwise it is
 * independent. "Determined" always rests on at least one in-domain trial
 * that was solved and rejected; with none, the quantity is `unmeasurable`.
 *
 * Trial values (review R-1): a length whose m − δ ≤ 0 tries m + δ and
 * m + 2δ; a signed point-pair component tries m ± δ; a line angle tries
 * m + min(δ, (π − m)/2) and m − min(δ, m/2), so both stay in (0, π).
 *
 * δ is a first-order heuristic from the document tolerances and the
 * candidate's solve component (review R-2), never a new tolerance:
 *   lengths: δ_rule = A·(τ·(1 + K_len) + τ_ang·S·K_ang)
 *   angles:  δ_rule = A·(τ_ang·(1 + K_ang) + (τ/ℓ)·K_len)
 *   δ = min(δ_rule, max(0.1·|m|, A·2·τ_c))
 * where K_len / K_ang count the other rows of the component judged against
 * the coincidence / angle tolerance, S is the component's extent (the lever
 * that turns an angular residual into a displacement), ℓ the shorter line of
 * the angle (the lever that turns a displacement into a rotation) and τ_c
 * the candidate's own tolerance.
 */
export function probeSketchDimensionRedundancy(input: {
  definition: SketchDefinition;
  candidate: RedundancyCandidate;
  projectedReferences?: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  modelingTolerance: number;
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
}): SketchDimensionRedundancyProbe {
  const { candidate, tolerances } = input;
  if (
    candidate.kind === "arcStartPointCoincident" ||
    candidate.kind === "arcEndPointCoincident"
  ) {
    return { kind: "unmeasurable" };
  }
  const trialStrategy: SketchSolveStrategy = "bfgsWithoutFallback";
  const compile = (value: number) =>
    compileSketchSolveProgram({
      definition: withCandidateDimension(input.definition, candidate, value),
      projectedReferences: input.projectedReferences,
      tolerances,
      modelingTolerance: input.modelingTolerance,
      offsetPlans: input.offsetPlans,
      partialSolvePolicy: "bestEffort",
      strategy: trialStrategy,
    });

  // m and the candidate's component come from one compile at the positions.
  const measuring = compile(0);
  const { system } = measuring;
  const measuredValue = buildDimensionStatuses(
    measuring.definition,
    system.pointRecords,
    system.entityStates,
    system.initialValues,
    new Map(),
    tolerances,
    measuring.projectedReferences,
  ).find((status) => status.dimensionId === candidate.dimensionId)?.solvedValue;
  const candidateEquation = measuring.equationMetadata.find(
    (entry) => entry.id === candidate.dimensionId,
  );
  const component = measuring.components.find(
    (entry) => entry.componentId === candidateEquation?.componentId,
  );
  if (
    measuredValue === null ||
    measuredValue === undefined ||
    !Number.isFinite(measuredValue) ||
    !candidateEquation ||
    !component
  ) {
    return { kind: "unmeasurable" };
  }

  const constraintKinds = new Map(
    measuring.definition.constraints.map((constraint) => [
      constraint.constraintId as string,
      constraint.kind,
    ]),
  );
  const dimensionKinds = new Map(
    measuring.definition.dimensions.map((dimension) => [
      dimension.dimensionId as string,
      dimension.kind,
    ]),
  );
  let lengthRows = 0;
  let angleRows = 0;
  for (const equationIndex of component.equationIndices) {
    const equation = measuring.equationMetadata[equationIndex]!;
    if (equation.id === candidate.dimensionId) continue;
    if (equation.targetKind === "dimension") {
      if (dimensionKinds.get(equation.id) === "lineAngle") angleRows += 1;
      else lengthRows += 1;
      continue;
    }
    const kind = constraintKinds.get(equation.id);
    if (kind && ANGULAR_TOLERANCE_CONSTRAINT_KINDS.has(kind)) angleRows += 1;
    if (!kind || !ANGLE_ONLY_CONSTRAINT_KINDS.has(kind)) lengthRows += 1;
  }

  const componentPoints = component.pointIds.flatMap((pointId) => {
    const record = system.pointRecords.get(pointId);
    return record ? [getPoint(system.initialValues, record)] : [];
  });
  const extent =
    componentPoints.length === 0
      ? 0
      : Math.hypot(
          Math.max(...componentPoints.map((point) => point[0])) -
            Math.min(...componentPoints.map((point) => point[0])),
          Math.max(...componentPoints.map((point) => point[1])) -
            Math.min(...componentPoints.map((point) => point[1])),
        );
  let ruleDelta: number;
  if (candidate.kind === "lineAngle") {
    const lineEntityMap = new Map(
      measuring.definition.entities.flatMap((entity) =>
        entity.kind === "lineSegment" ? [[entity.entityId, entity]] : [],
      ),
    );
    const lever = Math.min(
      ...candidate.lines.map((operand) => {
        const line = resolveLineDimensionOperand(
          system.initialValues,
          operand,
          lineEntityMap,
          system.pointRecords,
          measuring.projectedReferences,
        );
        return line ? length(subtract(line.end, line.start)) : Infinity;
      }),
    );
    ruleDelta =
      REDUNDANCY_PROBE_GAIN_BOUND *
      (tolerances.angleRadians * (1 + angleRows) +
        (Number.isFinite(lever) && lever > 0
          ? (tolerances.coincidence / lever) * lengthRows
          : 0));
  } else {
    ruleDelta =
      REDUNDANCY_PROBE_GAIN_BOUND *
      (tolerances.coincidence * (1 + lengthRows) +
        tolerances.angleRadians * extent * angleRows);
  }
  const ownTolerance =
    candidate.kind === "lineAngle"
      ? tolerances.angleRadians
      : tolerances.coincidence;
  const delta = Math.min(
    ruleDelta,
    Math.max(
      REDUNDANCY_PROBE_RELATIVE_STEP * Math.abs(measuredValue),
      REDUNDANCY_PROBE_GAIN_BOUND * 2 * ownTolerance,
    ),
  );

  const trialValues =
    candidate.kind === "lineAngle"
      ? [
          measuredValue + Math.min(delta, (Math.PI - measuredValue) / 2),
          measuredValue - Math.min(delta, measuredValue / 2),
        ]
      : isRedundancyTrialValueInDomain(candidate, measuredValue - delta)
        ? [measuredValue + delta, measuredValue - delta]
        : [measuredValue + delta, measuredValue + 2 * delta];
  const tried: number[] = [];
  for (const value of trialValues) {
    if (!isRedundancyTrialValueInDomain(candidate, value)) continue;
    tried.push(value);
    const solved = solveCompiledSketchProgram(compile(value)).solvedSnapshot;
    if (
      isAcceptableSolvedSnapshot(solved) &&
      solved.dimensionStatuses.some(
        (status) =>
          status.dimensionId === candidate.dimensionId &&
          status.status === "driving",
      )
    ) {
      return {
        kind: "independent",
        measuredValue,
        delta,
        trialValues: tried,
        trialStrategy: measuring.strategy,
      };
    }
  }
  // R-1: never "determined" without a solved, rejected in-domain trial.
  return tried.length === 0
    ? { kind: "unmeasurable" }
    : {
        kind: "determined",
        measuredValue,
        delta,
        trialValues: tried,
        trialStrategy: measuring.strategy,
      };
}

export function getSketchSolveInitialValuesForTest(
  definition: SketchDefinition,
  tolerances: SketchSolveTolerancePolicy,
  modelingTolerance: number,
) {
  return buildSystem(definition, { tolerances, modelingTolerance })
    .initialValues;
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
