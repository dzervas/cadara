import { makeDiagnostic } from "./solver-geometry";
import type {
  ConstraintDefinition,
  NumericDimensionDefinition as DimensionDefinition,
  NumericSketchDefinition as SketchDefinition,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";

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
export function referencedEntityIds(value: unknown, into: Set<string>) {
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
export function derivedShellRequirementDiagnostics(
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
