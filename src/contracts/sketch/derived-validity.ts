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
    diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return { state: invalid ? "invalid" : "current", diagnostics };
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
