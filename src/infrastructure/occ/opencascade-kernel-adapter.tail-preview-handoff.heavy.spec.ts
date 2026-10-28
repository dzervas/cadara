// Logic lane, heavy tier (docs/testing.md): the production OCC adapter
// (`public/cadara-occ`) on the landing enclosure. Seam: evaluatePreview then
// createFeature of a new extrude at the history tail, counting feature
// executions; the committed session must equal a cold open of its export
// with exact topology tokens.
import { readFile } from "node:fs/promises";
import { expect, test, vi } from "vitest";

// Counts feature executions without retaining their (large) arguments.
const featureRuns = vi.hoisted(() => ({ count: 0 }));
vi.mock("@/infrastructure/occ/features", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/infrastructure/occ/features")>();
  return {
    ...actual,
    executeOccFeature: (
      ...args: Parameters<typeof actual.executeOccFeature>
    ) => {
      featureRuns.count += 1;
      return actual.executeOccFeature(...args);
    },
  };
});

import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import type { FeatureDefinition } from "@/contracts/modeling/schema";
import { enrichExtrudeRegionProfiles } from "@/core/modeling/region-profile-selection";

import {
  expectColdEquivalent,
  open,
} from "../../../test/helpers/occ-history-prefix-reuse-session";

const loadEnclosure = async () =>
  JSON.parse(
    await readFile(
      new URL(
        "../../../landing/examples/enclosure/model.cadara",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as AuthoredModelDocument;

// A preview of a new feature at the history tail evaluates the record its
// create commits, with the region selectors the modeling service adds to that
// create, so the create of the previewed definition adopts the preview's
// evaluation and runs no feature (on the enclosure a join of the tail extrude
// took as long again as its preview). A create of anything else runs it.
test.each([
  ["the previewed definition", 1],
  ["another depth", 2],
] as const)(
  "a create of %s after a tail extrude preview on the landing enclosure runs the feature %i time(s) in all and equals a cold open (cadara-dx2k.7)",
  async (_committed, runs) => {
    const source = await loadEnclosure();
    const session = await open(source);
    try {
      const bosses = source.features.find(
        (feature) => feature.featureId === "feature_extrude-3",
      )!.definition;
      const bossSketch = source.sketches.find((sketch) =>
        JSON.stringify(bosses).includes(`"${sketch.sketchId}"`),
      )!;
      const sketchId = await session.commitSketch({
        label: "Tail bosses",
        plane: bossSketch.plane,
        definition: bossSketch.definition,
      });
      const regionIds = (await session.snapshot()).document.sketches
        .find((sketch) => sketch.sketchId === sketchId)!
        .sketch.regions.filter((region) => region.isClosed)
        .map((region) => region.regionId);
      const extrude = (distance: number) => {
        const definition = structuredClone(bosses) as unknown as {
          parameters: {
            operation: unknown;
            profiles: unknown[];
            extent: { end: { distance: unknown } };
          };
        };
        definition.parameters.profiles = regionIds.map((regionId) => ({
          kind: "region",
          sketchId,
          regionId,
        }));
        definition.parameters.extent.end.distance = {
          source: "literal",
          value: distance,
        };
        return definition as unknown as FeatureDefinition;
      };
      expect(
        [
          regionIds.length,
          (bosses.parameters as { operation: unknown }).operation,
        ],
        "premise: the tail extrude joins the bosses' regions to the shell",
      ).toEqual([4, { source: "literal", value: "join" }]);

      featureRuns.count = 0;
      const preview = await session.preview(extrude(4), null);
      expect(
        preview.diagnostics.filter(({ severity }) => severity === "error"),
        "premise: the tail extrude previews cleanly",
      ).toEqual([]);
      expect(
        preview.render.records.length,
        "premise: the preview renders the feature",
      ).toBeGreaterThan(0);
      // The modeling service enriches a create's region profiles from the
      // document snapshot it reads.
      const committed = enrichExtrudeRegionProfiles(
        extrude(runs === 1 ? 4 : 5),
        (await session.snapshot()).document.sketches,
      );
      await session.create(committed);
      expect(featureRuns.count, "the preview and the create").toBe(runs);
      await expectColdEquivalent(
        session,
        await session.exported(),
        "committed tail extrude",
        "exact",
      );
    } finally {
      session.adapter.dispose();
    }
  },
  900_000,
);
