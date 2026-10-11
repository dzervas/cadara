import type {
  RegionRecord,
  SketchDerivedValidity,
  SketchRecord,
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";

function diagnosticKey(diagnostic: SketchSolveDiagnostic) {
  return `${diagnostic.code}|${diagnostic.severity}|${diagnostic.message}|${JSON.stringify(diagnostic.target)}`;
}

export function mergeSketchSolveDiagnostics(
  ...groups: readonly (readonly SketchSolveDiagnostic[])[]
): SketchSolveDiagnostic[] {
  const seen = new Set<string>();
  return groups.flatMap((group) =>
    group.filter((diagnostic) => {
      const key = diagnosticKey(diagnostic);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  );
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

export function getConsumableSketchRegions(
  sketch: Pick<SketchRecord, "derivedValidity" | "regions">,
): readonly RegionRecord[] {
  return sketch.derivedValidity.state === "current" ? sketch.regions : [];
}

export function isSketchProfileOutputCurrent(
  validity: SketchDerivedValidity,
): boolean {
  return validity.state === "current";
}
