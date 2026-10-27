import { compileSketchSolveProgram } from "./compile-program";
import { buildDimensionStatuses } from "./dimension-statuses";
import { resolveLineDimensionOperand } from "./line-residuals";
import { solveCompiledSketchProgram } from "./solve-compiled-program";
import type {
  SketchSolveStrategy,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import { getPoint, length, subtract } from "./solver-geometry";
import { isAcceptableSolvedSnapshot } from "./start-session";
import type {
  DimensionDefinition as AuthoredDimensionDefinition,
  ConstraintDefinition,
  NumericDimensionDefinition as DimensionDefinition,
  NumericSketchDefinition as SketchDefinition,
  SolvedOffsetFramePlanRecord,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceRecord } from "@/contracts/solver/schema";

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
export const REDUNDANCY_PROBE_GAIN_BOUND = 2;

/**
 * T13e (review R-2): the probe's step stays within this fraction of |m|
 * (but never below the rule's single-row step A·2·τ_c), so a trial never
 * reshapes the sketch far from its current state. A probe step size, not a
 * product tolerance; a capped δ can only miss a redundancy (benign).
 */
export const REDUNDANCY_PROBE_RELATIVE_STEP = 0.1;

/** Constraint kinds judged (wholly or partly) against the angle tolerance. */
export const ANGULAR_TOLERANCE_CONSTRAINT_KINDS: ReadonlySet<
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
export const ANGLE_ONLY_CONSTRAINT_KINDS: ReadonlySet<ConstraintDefinition["kind"]> =
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
export type RedundancyCandidate = DimensionDefinition | AuthoredDimensionDefinition;

export function withCandidateDimension(
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
export function isRedundancyTrialValueInDomain(
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
