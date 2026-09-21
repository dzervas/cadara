import { expect, test } from "vitest";

import {
  deriveSketchValidity,
  getConsumableSketchRegions,
} from "@/contracts/sketch/derived-validity";
import type { RegionRecord, SolvedSketchSnapshot } from "@/contracts/sketch/schema";

const solved: SolvedSketchSnapshot = {
  schemaVersion: "solved-sketch/v1alpha1",
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
