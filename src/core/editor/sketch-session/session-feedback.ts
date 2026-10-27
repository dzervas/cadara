import type { SketchSessionState } from "./types";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import type {
  DimensionDefinition,
  ConstraintDefinition,
} from "@/contracts/sketch/schema";
import { correspondingMirrorDimensions } from "@/contracts/sketch/mirror-requirements";
import type { MirrorDimensionCorrespondence } from "@/contracts/sketch/mirror-requirements";
import {
  getSketchSessionDerivedValidity,
  getSketchDegenerateSplineSpans,
} from "./session-live-solve";
import {
  isExpressionAuthoredValue,
  getAuthoredLiteralValue,
} from "@/contracts/modeling/authored-values";
import type { MaybeAuthoredValue } from "@/contracts/modeling/authored-values";

/**
 * T16f ([TECH] T16-11, review R-7e): the relationships the session's live
 * solve failed (T16b's gate). Null without a live solve: mirror health is
 * unknown, so no dimension routes and no geometry links.
 */
export function getSketchSessionMirrorHealth(
  session: Pick<SketchSessionState, "liveSolve">,
): ReadonlySet<string> | null {
  const snapshot = session.liveSolve?.solvedSnapshot;
  return snapshot ? new Set(snapshot.failedDerivationIds ?? []) : null;
}

/**
 * T16f ([TECH] T16-11/T16-12): the driving dimensions that size the same
 * mirrored quantity as `dimension` through healthy mirrors, the tie-break
 * (definition order) first; none without a live solve.
 */
export function getSketchSessionSharedMirrorDimensions(
  session: Pick<SketchSessionState, "definition" | "liveSolve">,
  dimension: DimensionDefinition,
): readonly MirrorDimensionCorrespondence[] {
  const health = getSketchSessionMirrorHealth(session);
  return health
    ? correspondingMirrorDimensions(session.definition, dimension, health)
    : [];
}

/**
 * T16f ([TECH] T16-12, review A-9): every domain commit that would author a
 * second driving record of one mirrored quantity is refused with this text.
 */
export function sharedMirrorDriverRefusal(
  driver: MirrorDimensionCorrespondence,
): string {
  return `Already driven by ${driver.dimension.label} (${describeSharedMirrorPath(driver.mirrors)}); edit that dimension instead.`;
}

/** T16f: "mirror ‘a’", or "mirrors ‘a’ and ‘b’" along a chain (each named once). */
export function describeSharedMirrorPath(
  mirrors: MirrorDimensionCorrespondence["mirrors"],
): string {
  // A shortest path may pass a mirror twice (T16f review R-1): named once.
  const names = [...new Set(mirrors.map((mirror) => `‘${mirror.label}’`))];
  return names.length === 1
    ? `mirror ${names[0]}`
    : `mirrors ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * T13c (D7, review R-2): the one invalid-sketch feedback text: the conflict
 * explanation when requirements are unsatisfied, else the first non-info
 * diagnostic of the session's derived validity; T17c3: a degenerate spline
 * span is named before a first diagnostic that is only a warning (the solve
 * reports it as an error only when the authored definition is re-solved).
 * Used after commits, Undo/Redo, reopen (projection re-basing) and by the
 * preview label, so every path shows the same text for the same invalid
 * state.
 */
export function getSketchSessionInvalidFeedback(
  session: SketchSessionState,
  subjectIds: readonly string[] = [],
  commitCausedInvalidity = false,
): string | null {
  // T17e (O-1): a requirement naming geometry that no longer exists (a peer
  // merge keeps it, never retargeted) is explained as that, by label, not
  // as an unsatisfiable value. Review R-1: it is not a value conflict, so
  // it never joins the conflict list, and a conflict the user's own change
  // (`subjectIds`) caused is still explained first.
  const missing = (session.liveSolve?.solvedSnapshot.diagnostics ?? []).flatMap(
    (diagnostic) => {
      if (
        diagnostic.severity !== "error" ||
        !diagnostic.code.startsWith("missing-")
      )
        return [];
      const target = diagnostic.target;
      const id =
        target?.kind === "constraint"
          ? target.constraintId
          : target?.kind === "dimension"
            ? target.dimensionId
            : null;
      const label = id
        ? [...session.definition.constraints, ...session.definition.dimensions]
            .map((requirement) =>
              "dimensionId" in requirement
                ? ([requirement.dimensionId, requirement.label] as const)
                : ([requirement.constraintId, requirement.label] as const),
            )
            .find(([candidate]) => candidate === id)?.[1]
        : undefined;
      return id && label !== undefined
        ? [{ id: id as string, label, message: diagnostic.message }]
        : [];
    },
  );
  const conflict = describeSketchSessionUnsatisfiedRequirements(
    session,
    subjectIds,
    commitCausedInvalidity,
    new Set(missing.map((entry) => entry.id)),
  );
  // A value conflict left by the user's own change (any subject that is
  // not itself a missing reference) is explained first.
  const subjectConflict = subjectIds.some(
    (id) => !missing.some((entry) => entry.id === id),
  );
  if (conflict && (subjectConflict || missing.length === 0)) return conflict;
  if (missing.length > 0) {
    // Review R-2: the recovery names the requirement(s), never "it".
    const labels = [...new Set(missing.map((entry) => `‘${entry.label}’`))];
    const named =
      labels.length === 1
        ? labels[0]
        : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
    return `${missing[0]!.message} The sketch is invalid; profiles from it are blocked. Delete ${named}, or Undo.`;
  }
  const first = getSketchSessionDerivedValidity(session).diagnostics.find(
    (diagnostic) => diagnostic.severity !== "info",
  );
  const live = session.liveSolve;
  return (
    (first?.severity === "error" ? first.message : undefined) ??
    (live
      ? getSketchDegenerateSplineSpans(live.definition, live.solvedSnapshot)[0]
          ?.message
      : undefined) ??
    first?.message ??
    null
  );
}

/**
 * T13c (D7): the conflict explanation of the session's live solve, naming
 * every requirement whose status is `unsatisfied` (never `constraintState`,
 * review A-1). `subjectIds` are the requirements the user just authored or
 * edited; an unsatisfied subject is named first, as the one that
 * conflicts. When `commitCausedInvalidity` (the sketch was accepted before
 * the commit), every subject is named first even if it reads satisfied
 * (T13e2: a conflict can leave the just-committed requirement satisfied and
 * its residual on the others, e.g. a corner angle against Horizontal and
 * Vertical); a commit into an already-invalid sketch never blames a
 * satisfied subject (review R-1). Null when no requirement is unsatisfied.
 */
export function describeSketchSessionUnsatisfiedRequirements(
  session: Pick<SketchSessionState, "definition" | "liveSolve">,
  subjectIds: readonly string[] = [],
  commitCausedInvalidity = false,
  /** T17e (review R-1): requirements naming removed geometry (no value conflict). */
  excludedIds: ReadonlySet<string> = new Set(),
): string | null {
  const snapshot = session.liveSolve?.solvedSnapshot;
  if (!snapshot) {
    return null;
  }
  const unsatisfiedIds = new Set<string>(
    [
      ...snapshot.constraintStatuses.flatMap((entry) =>
        entry.status === "unsatisfied" ? [entry.constraintId] : [],
      ),
      ...snapshot.dimensionStatuses.flatMap((entry) =>
        entry.status === "unsatisfied" ? [entry.dimensionId] : [],
      ),
    ].filter((id) => !excludedIds.has(id)),
  );
  if (unsatisfiedIds.size === 0) {
    return null;
  }
  const named = [
    ...session.definition.constraints.map((constraint) => ({
      id: constraint.constraintId as string,
      text: formatSketchRequirement(constraint),
    })),
    ...session.definition.dimensions.map((dimension) => ({
      id: dimension.dimensionId as string,
      text: formatSketchRequirement(dimension),
    })),
  ];
  const subjects = named.filter(
    (requirement) =>
      subjectIds.includes(requirement.id) &&
      (commitCausedInvalidity || unsatisfiedIds.has(requirement.id)),
  );
  const others = named.filter(
    (requirement) =>
      unsatisfiedIds.has(requirement.id) &&
      !subjectIds.includes(requirement.id),
  );
  const requirements = [...subjects, ...others];
  if (requirements.length === 0) {
    return null;
  }
  // T16f ([TECH] T16-13): two driving dimensions that size one mirrored
  // shape (a persisted duplicate) are explained as such.
  if (requirements.length === 2) {
    const [first, second] = requirements as [
      (typeof requirements)[number],
      (typeof requirements)[number],
    ];
    const dimension = session.definition.dimensions.find(
      (entry) => entry.dimensionId === first.id,
    );
    const shared = dimension
      ? getSketchSessionSharedMirrorDimensions(session, dimension).find(
          (entry) => entry.dimension.dimensionId === second.id,
        )
      : undefined;
    if (shared) {
      return `${first.text} and ${second.text} size the same mirrored shape (${describeSharedMirrorPath(shared.mirrors)}), so they conflict. The sketch is invalid; profiles from it are blocked. Change or delete one, make one a reference, or Undo.`;
    }
  }
  const list = (entries: typeof requirements) =>
    entries.map((entry) => entry.text).join(", ");
  const statement =
    requirements.length === 1
      ? `${requirements[0]!.text} cannot be satisfied.`
      : subjects.length > 0 && others.length > 0
        ? `${list(subjects)} ${subjects.length === 1 ? "conflicts" : "conflict"} with ${list(others)}.`
        : `${list(requirements)} conflict.`;
  return `${statement} The sketch is invalid; profiles from it are blocked. Change or delete ${requirements.length === 1 ? "it" : "one of them"}, or Undo.`;
}

function formatSketchRequirement(
  requirement: ConstraintDefinition | DimensionDefinition,
): string {
  const value =
    "dimensionId" in requirement
      ? requirement.kind === "arcStartPointCoincident" ||
        requirement.kind === "arcEndPointCoincident" ||
        isReferenceDimension(requirement)
        ? null
        : requirement.kind === "lineAngle"
          ? formatRequirementValue(requirement.valueRadians, "deg")
          : formatRequirementValue(requirement.value, "mm")
      : requirement.kind === "angle"
        ? formatRequirementValue(requirement.valueRadians, "deg")
        : null;
  return value === null ? requirement.label : `${requirement.label} (${value})`;
}

function formatRequirementValue(
  value: MaybeAuthoredValue<number> | undefined,
  unit: "mm" | "deg",
): string {
  if (value === undefined) {
    return "?";
  }
  if (isExpressionAuthoredValue(value)) {
    return value.valueText;
  }
  const literal = getAuthoredLiteralValue(value);
  if (literal === null) {
    return "?";
  }
  const display = unit === "deg" ? (literal * 180) / Math.PI : literal;
  const rounded = Number(display.toFixed(3));
  return unit === "deg" ? `${rounded}°` : `${rounded} mm`;
}
