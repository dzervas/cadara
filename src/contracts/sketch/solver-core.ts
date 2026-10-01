import type {
  ConstraintDefinition,
  ConstraintStatusRecord,
  NumericDimensionDefinition as DimensionDefinition,
  DimensionStatusRecord,
  LocalCollinearTargetOperand,
  ProjectedSketchGeometryRef,
  NumericSketchDefinition as SketchDefinition,
  SketchCurveConstraintOperand,
  SketchDerivationDefinition,
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
import { SOLVED_SKETCH_SCHEMA_VERSION } from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivations,
  offsetRecordDerivatives,
  prepareSketchDerivationPullback,
  solvedOffsetFramePlans,
  solvedOffsetShellSpans,
  type SketchDerivationEvaluationResult,
  type SketchDerivationVariation,
  type SketchDerivedEntityVariation,
} from "@/contracts/sketch/derived-geometry";
import { offsetFrameCurveResidual } from "@/contracts/sketch/offset-derivation-frame";
import { canonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";
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
  | "gradientDescent"
  | "gaussNewton"
  | "levenbergMarquardt";

export interface SketchDraggedPointTarget {
  kind: "sketchPoint";
  pointId: SketchPointId;
  position: SketchPoint2D;
}

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
  const mirrorAxisIndices = (relationship: SketchDerivationDefinition) => {
    if (relationship.kind !== "mirror") return [];
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
              ...derivedEntitySeedIndices(output.seedEntityId),
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
        const center = evaluated.points.find(
          (point) => point.pointId === entity.centerPointId,
        )?.position;
        const start = evaluated.points.find(
          (point) => point.pointId === entity.startPointId,
        )?.position;
        const end = evaluated.points.find(
          (point) => point.pointId === entity.endPointId,
        )?.position;
        if (center && start && end) {
          const startOffset = subtract(start, center);
          const endOffset = subtract(end, center);
          // R-g3: the one point-defined arc support formula.
          projected[state.baseIndex] = canonicalArcSupport(
            center,
            start,
            end,
            entity.sweepDirection,
          ).radius;
          projected[state.baseIndex + 1] = Math.atan2(
            startOffset[1],
            startOffset[0],
          );
          projected[state.baseIndex + 2] = Math.atan2(
            endOffset[1],
            endOffset[0],
          );
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

      return {
        ...constraint,
        evaluate(values) {
          const projected = project(values, projectionValidationIndices);
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
          if (!hasDrivenCotangent) return evaluated;

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
          // Review A4: a singular offset derivative is never zero motion;
          // like the shell residual, the requirement is unbounded here.
          if (pulled.derivativeUnavailable)
            return { residual: Number.POSITIVE_INFINITY, gradient };
          for (const [pointId, value] of Object.entries(pulled.points ?? {})) {
            const record = pointRecords.get(pointId as SketchPointId);
            if (!record || !value) continue;
            gradient[record.baseIndex] += value[0];
            gradient[record.baseIndex + 1] += value[1];
          }
          for (const [entityId, value] of Object.entries(
            pulled.entities ?? {},
          )) {
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
          return { residual: evaluated.residual, gradient };
        },
      };
    },
  };
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

  const currentSplinePositions = (values: Float64Array) =>
    Object.fromEntries(
      [...pointRecords.entries()].map(([pointId, record]) => [
        pointId,
        getPoint(values, record),
      ]),
    ) as Record<SketchPointId, SketchPoint2D>;

  const reconstructCurrentSpline = (
    values: Float64Array,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
    variation: Parameters<typeof reconstructSplineAggregate>[2] = {},
  ) =>
    reconstructSplineAggregate(
      currentSplineAggregate(values, entity),
      currentSplinePositions(values),
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
        const geometry = reconstructCurrentSpline(values, entity);
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
          const varied = reconstructCurrentSpline(
            values,
            entity,
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
  ): ScalarConstraintRecord => ({
    id: constraint.constraintId,
    targetKind: "constraint",
    evaluate(values) {
      const gradient = zeroVector(parameterCount);
      const record = parameterProjection
        .derivationEvaluation(values)
        ?.offsetFrames.find(
          (candidate) => candidate.derivationId === shell.derivationId,
        );
      const output = record?.outputs.shells.find(
        (candidate) => candidate.entityId === shell.entityId,
      );
      if (!record || !output)
        return { residual: Number.POSITIVE_INFINITY, gradient };
      const result = offsetFrameCurveResidual({
        frame: record.frame,
        derivatives: offsetRecordDerivatives(record),
        seedEntityId: output.seed,
        point: getPoint(values, point),
      });
      if ("code" in result)
        return { residual: Number.POSITIVE_INFINITY, gradient };
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
        residual: halfSquaredDistanceWithSaturation(rx * rx + ry * ry),
        gradient,
      };
    },
  });

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
                residual: 0.5 * dimension.value * dimension.value,
                gradient,
              };
            }
            const err = current - dimension.value;
            const coeffX = (err * delta[0]) / current;
            const coeffY = (err * delta[1]) / current;
            addPointGradient(gradient, left, coeffX, coeffY);
            addPointGradient(gradient, right, -coeffX, -coeffY);
            return { residual: 0.5 * err * err, gradient };
          }

          const index = dimension.axis === "horizontal" ? 0 : 1;
          const err = delta[index] - dimension.value;
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
            dimension.value;
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
            const err = entity.radius - dimension.value;
            return { residual: 0.5 * err * err, gradient };
          }

          const err = getCircleRadius(values, circleState) - dimension.value;
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
              ? circleLike.radius * 2 - dimension.value
              : dimension.value;
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
              return Math.abs(localPoint[0] - datumPoint[0]) - dimension.value;
            }

            if (dimension.axis === "vertical") {
              return Math.abs(localPoint[1] - datumPoint[1]) - dimension.value;
            }

            return length(subtract(localPoint, datumPoint)) - dimension.value;
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
              dimension.value
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
              if (!first || !second) return dimension.value;
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
                  ) - dimension.value;
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
                  dimension.value
              : dimension.value;
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
              return dimension.valueRadians;
            }

            const angle = lineAngleRadians(
              first.start,
              first.end,
              second.start,
              second.end,
            );
            if (angle === null || angle <= DEGENERATE_NORM_EPSILON) {
              return dimension.valueRadians;
            }

            return angle - dimension.valueRadians;
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
          `Constraint ${constraintId} targets datum ${datum}, which is not valid for this relationship.`,
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
          `Constraint ${constraintId} targets missing reference ${reference.referenceId}.`,
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
          `Constraint ${constraintId} targets ${reference.kind}, which is not valid for this relationship.`,
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
          `Constraint ${constraintId} targets projected geometry ${reference.referenceId}.${reference.geometryId}, but no valid projected geometry was provided.`,
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
          `Dimension ${dimensionId} targets datum ${datum}, which is not valid for this dimension.`,
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
          `Dimension ${dimensionId} targets missing reference ${reference.referenceId}.`,
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
          `Dimension ${dimensionId} targets ${reference.kind}, which is not valid for this dimension.`,
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
          `Dimension ${dimensionId} targets projected geometry ${reference.referenceId}.${reference.geometryId}, but no valid projected geometry was provided.`,
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
            `Line ${entity.entityId} references a missing endpoint.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (
        length(subtract(start.position, end.position)) <
        tolerances.minimumSegmentLength
      ) {
        diagnostics.push(
          makeDiagnostic(
            "degenerate-line-segment",
            "error",
            `Line ${entity.entityId} is shorter than the minimum segment length tolerance.`,
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
          `Circle ${entity.entityId} must have a radius greater than zero.`,
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
            `Spline ${entity.entityId} requires at least two ordered point occurrences.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (occurrences.some(({ pointId }) => !pointMap.has(pointId))) {
        diagnostics.push(
          makeDiagnostic(
            "missing-spline-fit-point",
            "error",
            `Spline ${entity.entityId} references a missing fit point.`,
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
              `Spline ${entity.entityId} reconstruction is invalid: ${diagnostic.code}.`,
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
            `Ellipse ${entity.entityId} references a missing defining point.`,
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
            `Ellipse ${entity.entityId} major radius is shorter than the minimum segment length tolerance.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.minorRadius <= 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-ellipse-minor-radius",
            "error",
            `Ellipse ${entity.entityId} minor radius must be greater than zero.`,
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
            `Elliptical arc ${entity.entityId} references a missing defining point.`,
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
              `Elliptical arc ${entity.entityId} major radius is shorter than the minimum segment length tolerance.`,
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
              `Elliptical arc ${entity.entityId} start and end points are coincident.`,
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
            `Elliptical arc ${entity.entityId} minor radius must be greater than zero.`,
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
            `Conic ${entity.entityId} requires three distinct defining points.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      } else if (pointIds.some((pointId) => !pointMap.has(pointId))) {
        diagnostics.push(
          makeDiagnostic(
            "missing-conic-defining-point",
            "error",
            `Conic ${entity.entityId} references a missing defining point.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.rho <= 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-conic-rho",
            "error",
            `Conic ${entity.entityId} rho must be greater than zero.`,
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
            `Bezier curve ${entity.entityId} requires ${expectedPointCount} distinct control points.`,
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
            `Bezier curve ${entity.entityId} references a missing control point.`,
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
            `Profile text ${entity.entityId} references a missing anchor point.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.text.trim().length === 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-profile-text-content",
            "error",
            `Profile text ${entity.entityId} must contain text.`,
            { kind: "entity", entityId: entity.entityId },
          ),
        );
      }
      if (entity.height <= 0) {
        diagnostics.push(
          makeDiagnostic(
            "invalid-profile-text-height",
            "error",
            `Profile text ${entity.entityId} height must be greater than zero.`,
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
              `Constraint ${constraint.constraintId} references a missing point.`,
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
              `Constraint ${constraint.constraintId} references a missing entity.`,
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
              `Constraint ${constraint.constraintId} references a missing point.`,
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
              `Constraint ${constraint.constraintId} references a missing point.`,
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
              `Constraint ${constraint.constraintId} requires two distinct seed/offset line pairs.`,
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
              `Constraint ${constraint.constraintId} cannot evaluate non-finite line geometry.`,
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
              `Constraint ${constraint.constraintId} references a missing entity.`,
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
              `Constraint ${constraint.constraintId} references a missing point.`,
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
              `Constraint ${constraint.constraintId} references a missing point or line.`,
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
              `Constraint ${constraint.constraintId} references a missing point.`,
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
              `Constraint ${constraint.constraintId} references a missing point or curve.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `Constraint ${constraint.constraintId} targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
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
              `Constraint ${constraint.constraintId} references a missing point or curve.`,
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
              `Constraint ${constraint.constraintId} references a missing or unsupported collinear target.`,
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
              `Constraint ${constraint.constraintId} references a missing or unsupported local collinear target.`,
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
              `Constraint ${constraint.constraintId} references a missing point.`,
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
                `Constraint ${constraint.constraintId} targets sampled projected spline geometry, which is display-only and cannot define an exact solver constraint.`,
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
              `Constraint ${constraint.constraintId} references a missing or unsupported line entity.`,
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
              `Constraint ${constraint.constraintId} references a missing or unsupported local curve.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `Constraint ${constraint.constraintId} targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
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
              `Constraint ${constraint.constraintId} references a missing or unsupported local curve.`,
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
              `Constraint ${constraint.constraintId} targets an advanced sketch entity that is not supported by the current solver constraint set.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (
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
              `Constraint ${constraint.constraintId} references a missing or unsupported curve.`,
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
              `Constraint ${constraint.constraintId} targets an advanced sketch entity that is not supported by the current solver constraint set.`,
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
              `Constraint ${constraint.constraintId} references a missing or unsupported circle/arc.`,
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
              `Constraint ${constraint.constraintId} references a missing or unsupported local circle/arc.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (isAdvancedSketchEntity(entity)) {
          diagnostics.push(
            makeDiagnostic(
              "unsupported-solver-entity-constraint",
              "error",
              `Constraint ${constraint.constraintId} targets ${entity.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`,
              { kind: "constraint", constraintId: constraint.constraintId },
            ),
          );
        } else if (entity.kind !== "circle" && entity.kind !== "arc") {
          diagnostics.push(
            makeDiagnostic(
              "missing-projected-concentric-local-curve",
              "error",
              `Constraint ${constraint.constraintId} references a missing or unsupported local circle/arc.`,
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
                ? `Constraint ${constraint.constraintId} targets ${curve.kind}, which is valid sketch geometry but is not supported by the current solver constraint set.`
                : `Constraint ${constraint.constraintId} references a missing or unsupported normal target.`,
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
              `Constraint ${constraint.constraintId} references a missing normal line or point.`,
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
              `Constraint ${constraint.constraintId} references missing points or symmetry axis.`,
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
              `Constraint ${constraint.constraintId} references missing symmetric points.`,
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
              `Dimension ${dimension.dimensionId} references a missing point.`,
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
              `Dimension ${dimension.dimensionId} references a missing point.`,
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
              `Dimension ${dimension.dimensionId} references a missing entity.`,
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
              `Dimension ${dimension.dimensionId} references a missing circle or arc.`,
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
              `Dimension ${dimension.dimensionId} references a missing line.`,
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
                  `Dimension ${dimension.dimensionId} references a missing line.`,
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
                `Dimension ${dimension.dimensionId} references a missing line.`,
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
                `Dimension ${dimension.dimensionId} references a missing point.`,
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
              `Dimension ${dimension.dimensionId} references missing arc or point data.`,
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
  const check = (
    record: ConstraintDefinition | DimensionDefinition,
    target: SketchSolveDiagnostic["target"],
    id: string,
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
        `${id} uses the offset spline curve ${shell} as a ${record.kind} target; only point-on-curve is supported on an offset spline curve for now.`,
        target,
      ),
    );
  };
  for (const constraint of definition.constraints)
    check(
      constraint,
      { kind: "constraint", constraintId: constraint.constraintId },
      `Constraint ${constraint.constraintId}`,
    );
  for (const dimension of definition.dimensions)
    check(
      dimension,
      { kind: "dimension", dimensionId: dimension.dimensionId },
      `Dimension ${dimension.dimensionId}`,
    );
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

function lineSearchWolfe(
  values: Float64Array,
  direction: Float64Array,
  gradient: Float64Array,
  constraints: ScalarConstraintRecord[],
) {
  const slope = dot(gradient, direction);
  if (slope >= 0) {
    return null;
  }
  let alpha = 1;
  const initial = evaluateLoss(values, constraints);
  for (
    let iteration = 0;
    iteration < LINE_SEARCH_MAX_ITERATIONS;
    iteration += 1
  ) {
    const candidate = cloneValues(values);
    addScaled(candidate, alpha, direction);
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
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);
  const dimension = values.length;
  let inverseHessian = identityMatrix(dimension);
  let recentlyReset = false;

  for (let iteration = 0; iteration < 1000; iteration += 1) {
    if (state.loss < BFGS_MIN_LOSS || uniformNorm(state.gradient) < 1e-8) {
      break;
    }

    const searchDirection = multiplyMatrixVector(
      inverseHessian,
      state.gradient,
    );
    for (let index = 0; index < searchDirection.length; index += 1) {
      searchDirection[index] = -searchDirection[index]!;
    }

    const step = lineSearchWolfe(
      values,
      searchDirection,
      state.gradient,
      constraints,
    );
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

    const y = cloneValues(step.next.gradient);
    addScaled(y, -1, state.gradient);
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
  }

  return { values, loss: state.loss, perConstraint: state.perConstraint };
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

    const step = lineSearchWolfe(
      values,
      direction,
      state.gradient,
      constraints,
    );
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

function solveGaussNewtonLike(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  options: {
    maxIterations: number;
    minLoss: number;
    stepSize: number;
    damping: number;
    pseudoInverseEpsilon: number;
  },
) {
  let values = cloneValues(initialValues);
  let state = evaluateLoss(values, constraints);

  for (
    let iteration = 0;
    iteration < options.maxIterations && state.loss > options.minLoss;
    iteration += 1
  ) {
    const jacobian = state.evaluations.map((evaluation) =>
      cloneValues(evaluation.gradient),
    );
    const losses = new Float64Array(
      state.evaluations.map((evaluation) => evaluation.residual),
    );
    const jT = transpose(jacobian);
    const normal = multiplyMatrices(jT, jacobian);
    const normalWithDamping = addDiagonal(
      normal,
      options.damping + options.pseudoInverseEpsilon,
    );
    const rhs = multiplyMatrixVector(jT, losses);
    const delta = multiplyMatrixVector(
      symmetricPseudoInverse(normalWithDamping, options.pseudoInverseEpsilon),
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
      if (Number.isFinite(nextState.loss) && nextState.loss <= state.loss) {
        values = nextValues;
        state = nextState;
        accepted = true;
        break;
      }
      stepScale *= 0.5;
    }

    if (!accepted) {
      break;
    }
  }

  return { values, loss: state.loss, perConstraint: state.perConstraint };
}

type SolvedSystemValues = ReturnType<typeof solveBfgs>;

function solveBfgsWithGaussNewtonFallback(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  isAccepted: (solved: SolvedSystemValues) => boolean,
) {
  const bfgs = solveBfgs(initialValues, constraints);
  // A low total loss is not acceptance: each requirement is judged against
  // its own document tolerance, which can be tighter than this threshold.
  if (bfgs.loss < SOLVED_LOSS_THRESHOLD && isAccepted(bfgs)) {
    return bfgs;
  }

  const gaussNewton = solveGaussNewtonLike(initialValues, constraints, {
    maxIterations: 1000,
    minLoss: 1e-14,
    stepSize: 1,
    damping: 0,
    pseudoInverseEpsilon: 1e-12,
  });
  return gaussNewton.loss < bfgs.loss ? gaussNewton : bfgs;
}

function solveSystemValues(
  initialValues: Float64Array,
  constraints: ScalarConstraintRecord[],
  strategy: SketchSolveStrategy,
  isAccepted: (solved: SolvedSystemValues) => boolean = () => true,
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
}): SketchCompiledSolveProgram {
  assertSolveModelingTolerance(input.modelingTolerance);
  const projectedReferences = input.projectedReferences ?? [];
  const derived = evaluateSketchDerivations({
    definition: input.definition,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans,
  });
  const definition = derived.definition;
  const validation = validateDefinition(
    definition,
    input.tolerances,
    projectedReferences,
  );
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
        `Offset source arc ${entity.entityId} has endpoint radii ${startRadius} and ${endRadius}; radial gap ${radialGap} exceeds coincidence tolerance ${program.tolerances.coincidence}.`,
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
  const diagnostics = [
    ...program.diagnostics,
    ...program.validation.diagnostics,
    ...projectionDiagnostics,
    ...commonCircleDiagnostics,
  ];
  const evaluation =
    program.system.parameterProjection.derivationEvaluation(values);
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

  const constraintStatuses = buildConstraintStatuses(
    definition,
    program.system.pointRecords,
    program.system.entityStates,
    projectedValues,
    program.tolerances,
    solved.perConstraint,
    program.projectedReferences,
  );
  const dimensionStatuses = buildDimensionStatuses(
    definition,
    program.system.pointRecords,
    program.system.entityStates,
    projectedValues,
    solved.perConstraint,
    program.tolerances,
    program.projectedReferences,
  );
  const geometryValid = ![
    ...projectionDiagnostics,
    ...commonCircleDiagnostics,
  ].some((diagnostic) => diagnostic.severity === "error");
  const requirementsSatisfied =
    geometryValid &&
    constraintStatuses.every((entry) => entry.status === "satisfied") &&
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
      diagnostics.push(
        makeDiagnostic(
          "solver-requirement-unsatisfied",
          "warning",
          "Sketch solve ended with one or more requirements outside their authored tolerance.",
          null,
        ),
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
  };

  return {
    status,
    solvedSnapshot,
    diagnostics,
  };
}

export function solveCompiledSketchProgram(
  program: SketchCompiledSolveProgram,
  initialValues: Float64Array = program.system.initialValues,
): SketchCoreSolveResult {
  const preconditionedValues = preconditionValuesForPointAnchors(
    program,
    initialValues,
  );
  const solved = solveSystemValues(
    preconditionedValues,
    program.system.scalarConstraints,
    program.strategy,
    (candidate) => isAcceptableSolvedValues(program, candidate),
  );
  return materializeSolveResult(program, solved.values, solved);
}

function isAcceptableSolvedValues(
  program: SketchCompiledSolveProgram,
  solved: SolvedSystemValues,
) {
  return isAcceptableSolvedSnapshot(
    materializeSolveResult(program, solved.values, solved).solvedSnapshot,
  );
}

function isAcceptableSolvedSnapshot(snapshot: SolvedSketchSnapshot) {
  return (
    snapshot.status.solveState !== "failed" &&
    snapshot.constraintStatuses.every(
      (status) => status.status === "satisfied",
    ) &&
    snapshot.dimensionStatuses.every(
      (status) => status.status !== "unsatisfied",
    ) &&
    !snapshot.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
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
    program.definition.constraints.every(
      (constraint) =>
        constraintStatuses.get(constraint.constraintId)?.status ===
        "satisfied",
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
  const seeded = seedSolveValuesFromSnapshot(
    input.program,
    input.priorSolvedSnapshot,
  );
  const initialValues = preconditionValuesForPointAnchors(
    input.program,
    seeded.values,
  );
  const initialState = evaluateLoss(
    initialValues,
    input.program.system.scalarConstraints,
  );
  const initialCommonCircleValid =
    offsetArcCommonCircleDiagnostics(
      input.program,
      input.program.system.parameterProjection.projectValues(initialValues),
    ).length === 0;
  const isAccepted = (candidate: SolvedSystemValues) =>
    isAcceptableSolvedValues(input.program, candidate);
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
  // Skip the solve only when the start already meets every requirement; a
  // low total loss can still leave one outside its document tolerance.
  const solvedValues =
    initialCandidate && isAccepted(initialCandidate)
      ? initialCandidate
      : solveSystemValues(
          initialValues,
          input.program.system.scalarConstraints,
          input.program.strategy,
          isAccepted,
        );
  const solved = materializeSolveResult(
    input.program,
    solvedValues.values,
    solvedValues,
  );
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
  if (!solvedIsAcceptable && !priorIsAcceptable) {
    const commonCircleDiagnostic = solved.diagnostics.find(
      (diagnostic) =>
        diagnostic.code === "offset-arc-common-circle-unsatisfied",
    );
    if (commonCircleDiagnostic) {
      throw new Error(
        `Cannot initialize ${input.sessionId} without a valid common-circle snapshot: ${commonCircleDiagnostic.message}`,
      );
    }
    const errorDiagnostic = solved.diagnostics.find(
      (diagnostic) => diagnostic.severity === "error",
    );
    throw new Error(
      `Cannot initialize ${input.sessionId} without an acceptable solved snapshot${
        errorDiagnostic
          ? `: ${errorDiagnostic.code}: ${errorDiagnostic.message}`
          : "."
      }`,
    );
  }
  return {
    sessionId: input.sessionId,
    program: input.program,
    values: cloneValues(
      solvedIsAcceptable ? solvedValues.values : seeded.values,
    ),
    lastAcceptedSnapshot: solvedIsAcceptable
      ? solved.solvedSnapshot
      : input.priorSolvedSnapshot!,
    disposed: false,
    warmStarted: seeded.warmStarted,
  };
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

function tryTranslateDraggedComponent(
  session: SketchCompiledSolveSession,
  component: SketchCompiledSolveComponent | null,
  dragTarget: SketchDraggedPointTarget,
  targetTolerance: number,
): SketchDraggedPointSolveResult | null {
  if (!component || component.pointIds.length === 0) {
    return null;
  }

  const draggedPoint = session.program.system.pointRecords.get(
    dragTarget.pointId,
  );
  if (!draggedPoint) {
    return null;
  }

  const currentValues =
    session.program.system.parameterProjection.projectValues(session.values);
  const delta = subtract(
    dragTarget.position,
    getPoint(currentValues, draggedPoint),
  );
  const candidateValues = cloneValues(session.values);

  for (const pointId of component.pointIds) {
    const point = session.program.system.pointRecords.get(pointId);
    if (!point) {
      continue;
    }
    candidateValues[point.baseIndex] += delta[0];
    candidateValues[point.baseIndex + 1] += delta[1];
  }

  const fullState = evaluateLoss(
    candidateValues,
    session.program.system.scalarConstraints,
  );
  if (fullState.loss >= SOLVED_LOSS_THRESHOLD) {
    return null;
  }

  const materialized = materializeSolveResult(
    session.program,
    candidateValues,
    {
      values: candidateValues,
      loss: fullState.loss,
      perConstraint: fullState.perConstraint,
    },
  );
  const solvedPoint = materialized.solvedSnapshot.solvedPoints.find(
    (point) => point.pointId === dragTarget.pointId,
  );
  const targetDistance = solvedPoint
    ? length(subtract(solvedPoint.solvedPosition, dragTarget.position))
    : Number.POSITIVE_INFINITY;
  const constraintsSatisfied =
    materialized.solvedSnapshot.constraintStatuses.every(
      (status) => status.status === "satisfied",
    );
  const dimensionsSatisfied =
    materialized.solvedSnapshot.dimensionStatuses.every(
      (status) => status.status !== "unsatisfied",
    );
  const derivationsValid = !materialized.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );

  if (
    session.program.validation.isValid &&
    derivationsValid &&
    targetDistance <= targetTolerance &&
    constraintsSatisfied &&
    dimensionsSatisfied
  ) {
    session.values = candidateValues;
    session.lastAcceptedSnapshot = materialized.solvedSnapshot;
    return {
      kind: "solved",
      solvedSnapshot: materialized.solvedSnapshot,
      diagnostics: materialized.diagnostics,
    };
  }

  return null;
}

function createDraggedPointAcceptance(input: {
  program: SketchCompiledSolveProgram;
  materialized: SketchCoreSolveResult;
}) {
  const constraintsSatisfied =
    input.materialized.solvedSnapshot.constraintStatuses.every(
      (status) => status.status === "satisfied",
    );
  const dimensionsSatisfied =
    input.materialized.solvedSnapshot.dimensionStatuses.every(
      (status) => status.status !== "unsatisfied",
    );
  const derivationsValid = !input.materialized.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error",
  );
  // D1 (minimum-motion-sketch-drag): the cursor is a SOFT objective and is never
  // part of frame acceptance. A frame is accepted whenever the authored (hard)
  // constraints and dimensions are satisfied within tolerance, regardless of how
  // close the dragged point reached the cursor. `targetDistance` is intentionally
  // dropped from acceptance so a feasible-but-lagging frame is `solved`, not
  // `blocked`; `blocked` is reserved for invalid/non-convergent solves.
  const accepted =
    input.program.validation.isValid &&
    derivationsValid &&
    constraintsSatisfied &&
    dimensionsSatisfied;

  return { accepted };
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
): SketchDraggedPointSolveResult {
  session.values = values;
  session.lastAcceptedSnapshot = materialized.solvedSnapshot;
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
function solveDraggedPointFrame(input: {
  session: SketchCompiledSolveSession;
  component: SketchCompiledSolveComponent | null;
  dragTarget: SketchDraggedPointTarget;
}): {
  accepted: boolean;
  values: Float64Array;
  materialized: SketchCoreSolveResult;
} | null {
  const { session, component, dragTarget } = input;
  const program = session.program;
  const parameterCount = program.system.parameterCount;

  const dragConstraint = createDragTargetConstraint(
    program.system,
    dragTarget,
    DRAG_TARGET_WEIGHT,
  );
  if (!dragConstraint) {
    return null;
  }

  const componentConstraintSet = new Set(component?.equationIndices ?? []);
  const hardConstraints = program.system.scalarConstraints.filter((_, index) =>
    component ? componentConstraintSet.has(index) : true,
  );
  const affectedVariables = Array.from(
    component?.variableIndices ??
      Array.from({ length: parameterCount }, (_, index) => index),
  );
  const draggedRecord = program.system.pointRecords.get(dragTarget.pointId);
  const draggedVariableIndices = draggedRecord
    ? [draggedRecord.baseIndex, draggedRecord.baseIndex + 1]
    : [];
  const nonDraggedVariableIndices = affectedVariables.filter(
    (index) => !draggedVariableIndices.includes(index),
  );

  const previousFrame = cloneValues(session.values);

  // Phase A: hard constraints + soft cursor target + uniform minimum motion.
  const phaseAConstraints: ScalarConstraintRecord[] = [
    ...hardConstraints,
    dragConstraint,
    createMinimumMotionAnchorConstraint({
      id: `constraint_drag_minimum_motion_${dragTarget.pointId}` as ConstraintId,
      parameterCount,
      anchorValues: previousFrame,
      variableIndices: nonDraggedVariableIndices,
      weight: DRAG_MINIMUM_MOTION_EPSILON,
      parameterProjection: program.system.parameterProjection,
    }),
  ];
  const solvedA = solveSystemValues(
    cloneValues(session.values),
    phaseAConstraints,
    program.strategy,
  );
  const candidateA = cloneValues(session.values);
  for (const index of affectedVariables) {
    candidateA[index] = solvedA.values[index]!;
  }
  const evalA = materializeDraggedPointCandidate(session, candidateA);
  if (
    createDraggedPointAcceptance({ program, materialized: evalA.materialized })
      .accepted
  ) {
    return {
      accepted: true,
      values: candidateA,
      materialized: evalA.materialized,
    };
  }

  // Phase B: project the phase-A candidate onto the hard-constraint manifold by
  // solving the hard constraints ALONE, warm-started from the phase-A
  // (cursor-pulled) position. Continuous local convergence from that warm start
  // settles at the nearest feasible configuration, so the dragged point lands at
  // the closest feasible position instead of the phase-A compromise that
  // violates authored constraints. No anchor term is used here: a penalty anchor
  // would bias the solution off the constraint manifold by more than tolerance;
  // the warm start alone supplies the minimum-motion projection.
  const phaseBConstraints: ScalarConstraintRecord[] = [...hardConstraints];
  const solvedB = solveSystemValues(
    cloneValues(candidateA),
    phaseBConstraints,
    program.strategy,
  );
  const candidateB = cloneValues(session.values);
  for (const index of affectedVariables) {
    candidateB[index] = solvedB.values[index]!;
  }
  const evalB = materializeDraggedPointCandidate(session, candidateB);
  return {
    accepted: createDraggedPointAcceptance({
      program,
      materialized: evalB.materialized,
    }).accepted,
    values: candidateB,
    materialized: evalB.materialized,
  };
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
    const frame = solveDraggedPointFrame({
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

export function updateCompiledSketchSolveSession(
  session: SketchCompiledSolveSession,
  dragTarget: SketchDraggedPointTarget,
  targetTolerance = session.program.tolerances.coincidence,
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
          { kind: "point", pointId: dragTarget.pointId },
        ),
      ],
    };
  }

  if (
    !session.program.definition.points.some(
      (point) => point.pointId === dragTarget.pointId,
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
          `Dragged point ${dragTarget.pointId} does not exist in the sketch definition.`,
          { kind: "point", pointId: dragTarget.pointId },
        ),
      ],
    };
  }

  if (!dragTarget.position.every(Number.isFinite)) {
    return {
      kind: "blocked",
      reason: "nonConvergent",
      solvedSnapshot: session.lastAcceptedSnapshot,
      diagnostics: [
        makeDiagnostic(
          "drag-target-nonconvergent",
          "warning",
          "Dragged point frame contains a non-finite target and cannot be solved.",
          { kind: "point", pointId: dragTarget.pointId },
        ),
      ],
    };
  }

  const component = findComponentForPoint(session.program, dragTarget.pointId);
  const draggedRecord = session.program.system.pointRecords.get(
    dragTarget.pointId,
  );
  if (!draggedRecord) {
    return {
      kind: "blocked",
      reason: "missingPoint",
      solvedSnapshot: session.lastAcceptedSnapshot,
      diagnostics: [
        makeDiagnostic(
          "drag-target-missing-point",
          "error",
          `Dragged point ${dragTarget.pointId} does not exist in the compiled solve program.`,
          { kind: "point", pointId: dragTarget.pointId },
        ),
      ],
    };
  }

  // D3 (minimum-motion-sketch-drag): subdivide large cursor deltas into bounded
  // substeps solved continuously from the previous accepted frame, so the
  // solution tracks the constraint manifold instead of teleporting past
  // singularities. A non-convergent substep keeps the last accepted frame
  // (geometry lags the cursor) rather than escalating to a discontinuous search.
  const startPosition = getPoint(
    session.program.system.parameterProjection.projectValues(session.values),
    draggedRecord,
  );
  const totalDelta = subtract(dragTarget.position, startPosition);
  const distance = length(totalDelta);
  const substeps = Math.max(
    1,
    Math.min(DRAG_MAX_SUBSTEPS, Math.ceil(distance / DRAG_SUBSTEP_LIMIT)),
  );

  let lastAccepted: SketchCoreSolveResult | null = null;

  for (let step = 1; step <= substeps; step += 1) {
    const fraction = step / substeps;
    const stepTarget: SketchDraggedPointTarget = {
      kind: "sketchPoint",
      pointId: dragTarget.pointId,
      position: [
        startPosition[0] + totalDelta[0] * fraction,
        startPosition[1] + totalDelta[1] * fraction,
      ],
    };

    // Rigid-translation fast path (D5): a verified optimization only. It succeeds
    // exclusively when translating the whole component satisfies every authored
    // constraint, i.e. the component is internally rigid and translation is the
    // minimum-motion solution, so its result equals the general solve.
    const translated = tryTranslateDraggedComponent(
      session,
      component,
      stepTarget,
      targetTolerance,
    );
    if (translated && translated.kind === "solved") {
      lastAccepted = {
        status: translated.solvedSnapshot.status,
        solvedSnapshot: translated.solvedSnapshot,
        diagnostics: translated.diagnostics,
      };
      continue;
    }

    const frame = solveDraggedPointFrame({
      session,
      component,
      dragTarget: stepTarget,
    });
    if (frame && frame.accepted) {
      acceptDraggedPointCandidate(session, frame.values, frame.materialized);
      lastAccepted = frame.materialized;
      continue;
    }

    // Non-convergent substep: keep the last accepted frame and stop advancing.
    // The last accepted values (never the failed candidate) are preserved so the
    // reported snapshot is always a valid continuous frame (D3).
    if (!lastAccepted) {
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
            { kind: "point", pointId: dragTarget.pointId },
          ),
        ],
      };
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

function buildConstraintStatuses(
  definition: SketchDefinition,
  pointRecords: Map<SketchPointId, SolverPointRecord>,
  entityStates: Map<SketchEntityId, SolverEntityState>,
  values: Float64Array,
  tolerance: SketchSolveTolerancePolicy,
  perConstraint: Map<string, number>,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
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
          status = isConstraintResidualWithinTolerance(
            residual,
            residualTolerance,
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
      status = entities.every(
        (entity) =>
          entity &&
          (entity.kind === "lineSegment" ||
            entity.kind === "circle" ||
            entity.kind === "arc"),
      )
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
        )
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
// (updateCompiledSketchSolveSession) is now the single authority; rigid
// translation survives only as its internal verified fast path.

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
  // satisfiable sketch (sliding to the closest feasible position, or translating
  // rigid components via its verified fast path) and reserves `blocked` for
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
  return {
    isValid:
      derived.diagnostics.every((entry) => entry.severity !== "error") &&
      validation.isValid,
    diagnostics: [...derived.diagnostics, ...validation.diagnostics],
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
