import { OFFSET_REQUIREMENT_BLOCKED } from "./derived-requirement-diagnostics";
import { makeDiagnostic } from "./solver-geometry";
import type {
  OffsetRequirementBlocker,
  SketchCompiledSolveProgram,
} from "./system-types";
import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";
import type { SketchDerivationEvaluationResult } from "@/contracts/sketch/derived-geometry";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";

/** [TECH] G16′: authored requirement id → the offset relationships blocking it at `values`. */
export function offsetBlockedRequirements(
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
export function offsetRequirementStatus(
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
export function blockedRequirementDiagnostics(
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
export function offsetRelationshipDiagnostics(
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
export function rebuiltBlockedOffsets(
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
