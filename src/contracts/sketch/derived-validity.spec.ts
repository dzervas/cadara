import { describe, expect, test } from "vitest";

import {
  deriveCommittedSketchValidity,
  deriveSketchValidity,
  getConsumableSketchRegions,
  mergeSketchSolveDiagnostics,
  SKETCH_VALIDATION_FAILED,
  sketchProfileGateFailures,
} from "@/contracts/sketch/derived-validity";
import { DERIVED_SHELL_SEED_UNSUPPORTED } from "@/contracts/sketch/derived-geometry";
import type { RegionRecord, SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import type { SketchEntityId } from "@/contracts/shared/ids";

const solved: SolvedSketchSnapshot = {
  schemaVersion: "solved-sketch/v1alpha2",
  status: { solveState: "solved", constraintState: "underConstrained" },
  solvedEntities: [],
  solvedPoints: [],
  constraintStatuses: [],
  dimensionStatuses: [],
  diagnostics: [],
};

// Lane: logic. Seam: exported derived-validity/profile-capability contract.
test("derived validity distinguishes current, invalid, and stale output and gates profile consumption", () => {
  const current = deriveSketchValidity({ solvedSnapshot: solved });
  const invalid = deriveSketchValidity({
    solvedSnapshot: solved,
    diagnostics: [
      {
        code: "missing-geometry",
        severity: "error",
        message: "A referenced entity is missing.",
        target: null,
      },
    ],
  });
  const stale = deriveSketchValidity({
    solvedSnapshot: solved,
    freshness: "stale",
  });
  const region = { regionId: "region_test" } as unknown as RegionRecord;

  expect(current.state).toBe("current");
  expect(invalid.state).toBe("invalid");
  expect(stale.state).toBe("stale");
  expect(
    getConsumableSketchRegions({ derivedValidity: current, regions: [region] }),
  ).toEqual([region]);
  expect(
    getConsumableSketchRegions({ derivedValidity: invalid, regions: [region] }),
  ).toEqual([]);
  expect(
    getConsumableSketchRegions({ derivedValidity: stale, regions: [region] }),
  ).toEqual([]);
});

// T16b ([TECH] T16-4): the sketch-wide profile gate is one predicate over the
// snapshot's failed (held) derived relationships, added to the severity rule.
describe("T16b: the sketch-wide profile gate", () => {
  const region = { regionId: "region_test" } as unknown as RegionRecord;
  const warning = {
    code: "derived-mirror-axis-missing",
    severity: "warning" as const,
    message: "Mirror ‘mirror 1’ is broken: its mirror line was deleted.",
    target: null,
  };

  test("a failed relationship blocks the sketch's profiles whatever its diagnostics' severity (warning only, or none)", () => {
    for (const diagnostics of [[warning], []]) {
      const snapshot = {
        ...solved,
        diagnostics,
        failedDerivationIds: ["derivation_mirror"],
      };
      expect(sketchProfileGateFailures(snapshot)).toEqual([
        "derivation_mirror",
      ]);
      const validity = deriveSketchValidity({ solvedSnapshot: snapshot });
      expect(
        validity.state,
        `failed id with ${diagnostics.length ? "only a warning" : "no diagnostic"}: invalid`,
      ).toBe("invalid");
      expect(
        getConsumableSketchRegions({
          derivedValidity: validity,
          regions: [region],
        }),
      ).toEqual([]);
    }
    expect(
      deriveSketchValidity({
        solvedSnapshot: { ...solved, diagnostics: [warning] },
      }).state,
      "control: the same warning without a failed relationship stays current",
    ).toBe("current");
    expect(sketchProfileGateFailures(solved)).toEqual([]);
  });

  test("the severity rule stays: a mirror seeded on an offset spline curve (U-G2, malformed, not a failed id) is invalid by its error", () => {
    const snapshot = {
      ...solved,
      diagnostics: [
        {
          code: DERIVED_SHELL_SEED_UNSUPPORTED,
          severity: "error" as const,
          message: "Shell seed.",
          target: null,
        },
      ],
    };
    expect(sketchProfileGateFailures(snapshot)).toEqual([]);
    expect(deriveSketchValidity({ solvedSnapshot: snapshot }).state).toBe(
      "invalid",
    );
  });

  test("stale freshness still wins (the gate does not turn stale output into invalid)", () => {
    expect(
      deriveSketchValidity({
        solvedSnapshot: {
          ...solved,
          failedDerivationIds: ["derivation_mirror"],
        },
        freshness: "stale",
      }).state,
    ).toBe("stale");
  });
});

test("partial nonconvergence is invalid while an ordinary solved underconstrained sketch is current", () => {
  expect(
    deriveSketchValidity({
      solvedSnapshot: {
        ...solved,
        status: {
          solveState: "partiallySolved",
          constraintState: "underConstrained",
        },
        diagnostics: [
          {
            code: "solver-residual-too-large",
            severity: "warning",
            message: "Sketch solve ended with residual 25.",
            target: null,
          },
        ],
      },
    }).state,
  ).toBe("invalid");
  expect(deriveSketchValidity({ solvedSnapshot: solved }).state).toBe("current");
});

// T17d (B5, [TECH] T17-7; logic lane, seam: the one committed-sketch
// validity derivation both adapters' Finish and restore call). Identical
// diagnostics — same code, target and message — are one (T16c A-5: a
// pattern output with several missing points repeats one text), at the
// first position, with the most severe severity; `sketch-validation-failed`
// comes from the validation outcome only; the stored snapshot carries the
// sketch's diagnostics and the validity adds the relationship-scoped offset
// ones. Red on base: no such function (each path merged its own lists).
describe("T17d B5: one committed-sketch validity derivation", () => {
  const pointMap = {
    code: "derived-transform-unsatisfied-point-map",
    severity: "error" as const,
    message:
      "Linear pattern ‘linearPattern 91’ is broken: its geometry no longer matches (copy ‘ab linearPattern’ of ‘ab’). Profiles from this sketch are blocked. Undo to recover.",
    target: {
      kind: "entity" as const,
      entityId: "sketch_entity_copy" as SketchEntityId,
    },
  };
  const offset = {
    code: "derived-offset-seed-not-certified",
    severity: "error" as const,
    message: "Offset ‘offset 1’ can't be certified.",
    target: null,
  };

  test("identical diagnostics are one, at the first position, with the most severe severity", () => {
    const repeatedWarning = { ...pointMap, severity: "warning" as const };
    const other = { ...pointMap, target: null };
    expect(
      mergeSketchSolveDiagnostics(
        [repeatedWarning, other],
        [pointMap, pointMap, other],
      ),
    ).toEqual([pointMap, other]);
  });

  test("Finish and restore inputs give one result: duplicates once, sketch-validation-failed from the validation only, offset diagnostics only in the validity", () => {
    const derive = (validationIsValid: boolean) =>
      deriveCommittedSketchValidity({
        kind: "solved",
        solvedSnapshot: { ...solved, diagnostics: [pointMap, pointMap] },
        validationIsValid,
        diagnostics: [[], [], [pointMap, pointMap], []],
        offsetDiagnostics: [offset],
      });
    const invalid = derive(false);
    expect(invalid.solvedSnapshot.diagnostics).toEqual([
      pointMap,
      SKETCH_VALIDATION_FAILED,
    ]);
    expect(invalid.derivedValidity).toEqual({
      state: "invalid",
      diagnostics: [pointMap, SKETCH_VALIDATION_FAILED, offset],
    });
    expect(derive(true).solvedSnapshot.diagnostics).toEqual([pointMap]);
    // Unresolved authored values: no solve ran and no validation failed.
    const unresolved = deriveCommittedSketchValidity({
      kind: "unresolvedValues",
      diagnostics: [pointMap, pointMap],
    });
    expect(unresolved.solvedSnapshot.status).toEqual({
      solveState: "failed",
      constraintState: "inconsistent",
    });
    expect(unresolved.derivedValidity).toEqual({
      state: "invalid",
      diagnostics: [pointMap],
    });
    expect(unresolved.solvedSnapshot.diagnostics).toEqual([pointMap]);
  });
});
