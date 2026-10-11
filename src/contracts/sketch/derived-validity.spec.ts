import { describe, expect, test } from "vitest";

import {
  deriveSketchValidity,
  getConsumableSketchRegions,
  sketchProfileGateFailures,
} from "@/contracts/sketch/derived-validity";
import { DERIVED_SHELL_SEED_UNSUPPORTED } from "@/contracts/sketch/derived-geometry";
import type { RegionRecord, SolvedSketchSnapshot } from "@/contracts/sketch/schema";

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
  const region = { regionId: "region_test" } as RegionRecord;

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
  const region = { regionId: "region_test" } as RegionRecord;
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
