import { DERIVED_FAILURE_CODES } from "@/contracts/sketch/mirror-requirements";
import {
  SOLVED_SKETCH_SCHEMA_VERSION,
  type RegionRecord,
  type SketchDerivedValidity,
  type SketchRecord,
  type SketchSolveDiagnostic,
  type SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";

/** T17d (B5, [TECH] T17-7): identical diagnostics are one (code, target, message). */
function diagnosticKey(diagnostic: SketchSolveDiagnostic) {
  return `${diagnostic.code}|${diagnostic.message}|${JSON.stringify(diagnostic.target)}`;
}

const SEVERITY_RANK: Record<SketchSolveDiagnostic["severity"], number> = {
  info: 0,
  warning: 1,
  error: 2,
};

/**
 * The diagnostics of `groups` in order, each identical diagnostic (same
 * code, target and message) once, at its first position and with the most
 * severe severity any copy had (a repeat never lowers validity).
 */
export function mergeSketchSolveDiagnostics(
  ...groups: readonly (readonly SketchSolveDiagnostic[])[]
): SketchSolveDiagnostic[] {
  const merged = new Map<string, SketchSolveDiagnostic>();
  for (const diagnostic of groups.flat()) {
    const key = diagnosticKey(diagnostic);
    const kept = merged.get(key);
    if (!kept) merged.set(key, diagnostic);
    else if (SEVERITY_RANK[diagnostic.severity] > SEVERITY_RANK[kept.severity])
      merged.set(key, { ...kept, severity: diagnostic.severity });
  }
  return [...merged.values()];
}

/**
 * T16b ([TECH] T16-4, issue 15 "Invalid state and recovery"): the
 * sketch-wide profile gate. The derived relationships the solve failed and
 * holds (a broken mirror, or a mirror, pattern or transform whose dependency
 * order is unresolved): while any exists, no profile of the sketch is
 * consumable, whatever their diagnostics' severity. Unrelated sketches are
 * unaffected; an offset failure stays relationship-scoped (U-G5) and is
 * never listed here.
 */
export function sketchProfileGateFailures(
  solvedSnapshot: Pick<SolvedSketchSnapshot, "failedDerivationIds">,
): readonly string[] {
  return solvedSnapshot.failedDerivationIds ?? [];
}

export function deriveSketchValidity(input: {
  solvedSnapshot: SolvedSketchSnapshot;
  diagnostics?: readonly SketchSolveDiagnostic[];
  freshness?: "current" | "stale";
}): SketchDerivedValidity {
  const diagnostics = mergeSketchSolveDiagnostics(
    input.solvedSnapshot.diagnostics,
    input.diagnostics ?? [],
  );
  if (input.freshness === "stale") {
    return { state: "stale", diagnostics };
  }

  const solveState = input.solvedSnapshot.status.solveState;
  const invalid =
    solveState === "failed" ||
    solveState === "notEvaluated" ||
    solveState === "partiallySolved" ||
    sketchProfileGateFailures(input.solvedSnapshot).length > 0 ||
    diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return { state: invalid ? "invalid" : "current", diagnostics };
}

/** The sketch's requirements did not validate (missing or unresolved operands). */
export const SKETCH_VALIDATION_FAILED: SketchSolveDiagnostic = {
  code: "sketch-validation-failed",
  severity: "error",
  message: "The authored sketch has invalid or unresolved requirements.",
  target: null,
};

/**
 * What a committed sketch's derivation produced: either its authored values
 * did not resolve (no solve ran), or it was validated, solved and its
 * regions derived (`diagnostics`: projection, validation, solve and region
 * diagnostics, in that order).
 */
export type CommittedSketchDerivation =
  | {
      readonly kind: "unresolvedValues";
      readonly diagnostics: readonly SketchSolveDiagnostic[];
    }
  | {
      readonly kind: "solved";
      readonly solvedSnapshot: SolvedSketchSnapshot;
      readonly validationIsValid: boolean;
      readonly diagnostics: readonly (readonly SketchSolveDiagnostic[])[];
      /** [TECH] G16: relationship-scoped offset diagnostics. */
      readonly offsetDiagnostics: readonly SketchSolveDiagnostic[];
    };

/**
 * T17d (B5, [TECH] T17-7; issue 03 "Round trips": restoration provides
 * equivalent validity and diagnostics): the one derivation of a committed
 * sketch record's solved snapshot and validity. Finish (commit) and every
 * restore or rebuild of both adapters call it with the same inputs, so
 * `sketch-validation-failed` and every other diagnostic agree after Finish
 * → export → restore. The stored snapshot's diagnostics are the sketch's
 * own (deduplicated, `mergeSketchSolveDiagnostics`); the relationship-scoped
 * offset diagnostics are only in the validity ([TECH] G16).
 */
export function deriveCommittedSketchValidity(
  derivation: CommittedSketchDerivation,
): {
  readonly solvedSnapshot: SolvedSketchSnapshot;
  readonly derivedValidity: SketchDerivedValidity;
} {
  const solved =
    derivation.kind === "solved"
      ? derivation.solvedSnapshot
      : {
          schemaVersion: SOLVED_SKETCH_SCHEMA_VERSION,
          status: {
            solveState: "failed" as const,
            constraintState: "inconsistent" as const,
          },
          solvedEntities: [],
          solvedPoints: [],
          constraintStatuses: [],
          dimensionStatuses: [],
          diagnostics: [...derivation.diagnostics],
        };
  const sketchValidity = deriveSketchValidity({
    solvedSnapshot: solved,
    diagnostics:
      derivation.kind === "solved"
        ? mergeSketchSolveDiagnostics(
            ...derivation.diagnostics,
            derivation.validationIsValid ? [] : [SKETCH_VALIDATION_FAILED],
          )
        : [],
  });
  return {
    solvedSnapshot: { ...solved, diagnostics: sketchValidity.diagnostics },
    derivedValidity: withRelationshipScopedDiagnostics(
      sketchValidity,
      derivation.kind === "solved" ? derivation.offsetDiagnostics : [],
    ),
  };
}

/**
 * [TECH] G5/G16: adds relationship-scoped offset publication diagnostics to a
 * sketch's validity for display. They never change its state: a failing
 * offset relationship makes only its own outputs non-consumable.
 */
export function withRelationshipScopedDiagnostics(
  validity: SketchDerivedValidity,
  diagnostics: readonly SketchSolveDiagnostic[],
): SketchDerivedValidity {
  return diagnostics.length === 0
    ? validity
    : {
        ...validity,
        diagnostics: mergeSketchSolveDiagnostics(
          validity.diagnostics,
          diagnostics,
        ),
      };
}

/**
 * T17d (B3; issue 03: stale or invalid output is never consumed as current;
 * specification "Minimum failure feedback"): why a committed sketch's
 * derived output is not current, for the consumers that refuse it (vector
 * export, cross-sketch projection) or mark what they read (measurement).
 * `brokenRelationships`: the sketch-wide gate holds; the explanation is
 * then its failed relationships' own label-based messages (what broke and
 * how to repair it), else a label-free explanation of the state. Never an
 * id. Null when the sketch is current.
 */
export function sketchNotCurrentExplanation(
  sketch: Pick<SketchRecord, "derivedValidity" | "solvedSnapshot">,
): {
  readonly state: "invalid" | "stale";
  readonly brokenRelationships: boolean;
  readonly explanation: string;
} | null {
  const { derivedValidity, solvedSnapshot } = sketch;
  if (derivedValidity.state === "current") return null;
  if (derivedValidity.state === "stale")
    return {
      state: "stale",
      brokenRelationships: false,
      explanation: "Its geometry was not solved for this revision.",
    };
  const broken =
    sketchProfileGateFailures(solvedSnapshot).length === 0
      ? []
      : derivedValidity.diagnostics.flatMap((diagnostic) =>
          diagnostic.severity === "error" &&
          DERIVED_FAILURE_CODES.has(diagnostic.code)
            ? [diagnostic.message]
            : [],
        );
  // T17e (T17d review A-1): the explanation names the cause: no solve ran,
  // the solve was not accepted, or an accepted solve with errors (from
  // projection, validation or regions).
  const { status, constraintStatuses, dimensionStatuses } = solvedSnapshot;
  const solveAccepted =
    status.solveState === "solved" &&
    constraintStatuses.every((entry) => entry.status !== "unsatisfied") &&
    dimensionStatuses.every((entry) => entry.status !== "unsatisfied");
  return {
    state: "invalid",
    brokenRelationships: broken.length > 0,
    explanation:
      broken.length > 0
        ? broken.join(" ")
        : status.solveState === "notEvaluated"
          ? "It has not been solved, so its geometry is not current. Edit the sketch to solve it, or Undo."
          : solveAccepted
            ? "It has errors, so its geometry is not current. Edit the sketch to see them, then correct it, or Undo."
            : "Its last solve was not accepted, so its geometry is not current. Edit the sketch to see why, then correct it, or Undo.",
  };
}

export function getConsumableSketchRegions(
  sketch: Pick<SketchRecord, "derivedValidity" | "regions">,
): readonly RegionRecord[] {
  return sketch.derivedValidity.state === "current" ? sketch.regions : [];
}
