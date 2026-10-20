import { expect, test } from "vitest";
import { makeSketchFixture, addRectangle } from "./region-extraction.fixtures";
import { createSketchArrangementDeriver } from "./region-extraction";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { deriveRegionBoundaryIdentity } from "./region-boundary-identity";
import { resolveRegionProfile, type RegionSelector } from "./region-selector";

async function rectangle(width: number, translate = 0) {
  const fixture = makeSketchFixture();
  addRectangle(fixture, "box", [translate, 0, translate + width, 10]);
  const result = await createSketchArrangementDeriver(
    createCertifiedNeutralCurveQueryCapabilityForTest(),
  ).derive(fixture.build());
  expect(result.regions).toHaveLength(1);
  return result.regions;
}

test("real re-derivation reverses source orientation and shifts IDs without losing boundary intent or requiring old point containment", async () => {
  const before = await rectangle(20);
  const after = await rectangle(-30, -100);
  expect(after[0]!.regionId).not.toBe(before[0]!.regionId);
  const selector: RegionSelector = {
    kind: "interiorPoint",
    point: [10, 5],
    expectedBoundaryIdentity: deriveRegionBoundaryIdentity(before[0]!, before),
  };
  expect(deriveRegionBoundaryIdentity(after[0]!, after)).toBe(
    selector.expectedBoundaryIdentity,
  );
  const ref = {
    sketchId: "sketch_arrangement" as const,
    regionId: before[0]!.regionId,
    selector,
  };
  const current = {
    regions: after,
    derivedValidity: { state: "current" as const, diagnostics: [] },
  };
  expect(resolveRegionProfile(current, ref)).toEqual({
    ok: true,
    region: after[0],
  });
  expect(
    resolveRegionProfile(current, {
      sketchId: ref.sketchId,
      regionId: after[0]!.regionId,
    }),
  ).toEqual({ ok: true, region: after[0] });
  for (const selector of [
    { ...ref.selector, point: [NaN, 0] },
    { ...ref.selector, point: [0] },
    {
      ...ref.selector,
      expectedBoundaryIdentity: "import-region-boundary/v2:[]",
    },
  ])
    expect(
      resolveRegionProfile(current, {
        ...ref,
        selector: selector as RegionSelector,
      }),
    ).toMatchObject({ ok: false, failure: { reason: "identity-mismatch" } });
  expect(
    resolveRegionProfile(current, { ...ref, selector: undefined }),
  ).toMatchObject({ ok: false, failure: { reason: "missing" } });
  expect(
    resolveRegionProfile(
      {
        ...current,
        regions: [...after, { ...after[0]!, regionId: before[0]!.regionId }],
      },
      ref,
    ),
  ).toMatchObject({ ok: false, failure: { reason: "ambiguous" } });
  expect(
    resolveRegionProfile(current, {
      ...ref,
      regionId: after[0]!.regionId,
      selector: {
        ...selector,
        point: [-115, 5], // inside the live rectangle: containment is not proof
        expectedBoundaryIdentity: "import-region-boundary/v1:wrong",
      },
    }),
  ).toMatchObject({ ok: false, failure: { reason: "identity-mismatch" } });
  expect(resolveRegionProfile({ ...current, regions: [] }, ref)).toMatchObject({
    ok: false,
    failure: { reason: "missing" },
  });
  for (const state of ["stale", "invalid"] as const) {
    expect(
      resolveRegionProfile(
        { ...current, derivedValidity: { state, diagnostics: [] } },
        ref,
      ),
    ).toMatchObject({ ok: false, code: "profile-region-sketch-not-current" });
  }
});

test("real split and hole topology edits fail closed rather than choosing one nearby cell", async () => {
  const before = await rectangle(20);
  const ref = {
    sketchId: "sketch_arrangement" as const,
    regionId: before[0]!.regionId,
    selector: {
      kind: "interiorPoint" as const,
      point: [2, 5] as [number, number],
      expectedBoundaryIdentity: deriveRegionBoundaryIdentity(
        before[0]!,
        before,
      ),
    },
  };
  for (const edit of ["split", "hole"] as const) {
    const fixture = makeSketchFixture();
    addRectangle(fixture, "box", [0, 0, 20, 10]);
    if (edit === "split") {
      fixture.point("cutA", 10, -1);
      fixture.point("cutB", 10, 11);
      fixture.line("cut", "cutA", "cutB");
    } else addRectangle(fixture, "hole", [5, 2, 15, 8]);
    const result = await createSketchArrangementDeriver(
      createCertifiedNeutralCurveQueryCapabilityForTest(),
    ).derive(fixture.build());
    expect(result.regions.length).toBeGreaterThan(0);
    expect(
      resolveRegionProfile(
        {
          regions: result.regions,
          derivedValidity: { state: "current", diagnostics: [] },
        },
        ref,
      ),
    ).toMatchObject({ ok: false, failure: { reason: "identity-mismatch" } });
  }
});
