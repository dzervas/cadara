import { expect, test } from "vitest";
import { validateFeatureDefinition } from "./runtime-schema";
import { serializeAuthoredDocumentJson } from "./authored-document-serialization";
import { deriveRegionBoundaryIdentity } from "@/contracts/sketch/region-boundary-identity";
import { deriveImportRegionBoundaryIdentity } from "@/contracts/import/region-boundary-identity";
import type { RegionRecord } from "@/contracts/sketch/schema";
import type { FeatureDefinition } from "./schema";

const legacy: FeatureDefinition = {
  kind: "extrude",
  featureTypeVersion: "feature-type/extrude/v1alpha2",
  parameters: {
    resultBodyType: "solid",
    profiles: [
      { kind: "region", sketchId: "sketch_test", regionId: "region_test" },
    ],
    startExtent: { kind: "profilePlane" },
    extent: {
      mode: "oneSide",
      end: {
        kind: "blind",
        direction: "positive",
        distance: { source: "literal", value: 5 },
      },
    },
    operation: { source: "literal", value: "newBody" },
    booleanScope: { kind: "standalone" },
  },
};
const selector = {
  kind: "interiorPoint",
  point: [1, 2],
  expectedBoundaryIdentity: "import-region-boundary/v1:[]",
};
const definition = (value: unknown) => ({
  ...legacy,
  parameters: {
    ...legacy.parameters,
    profiles: [{ ...legacy.parameters.profiles[0], selector: value }],
  },
});

test("exact native FeatureDefinition validator accepts legacy and enriched refs and refuses unsupported selector payloads", () => {
  expect(validateFeatureDefinition(legacy).success).toBe(true);
  const enriched = definition(selector);
  expect(validateFeatureDefinition(enriched).success).toBe(true);
  for (const candidate of [legacy, enriched]) {
    const restored = JSON.parse(serializeAuthoredDocumentJson(candidate));
    expect(validateFeatureDefinition(restored).success).toBe(true);
    expect(restored).toEqual(candidate);
  }
  for (const value of [
    { ...selector, expectedBoundaryIdentity: "import-region-boundary/v2:[]" },
    { ...selector, expectedBoundaryIdentity: undefined },
    { ...selector, point: [Infinity, 2] },
    { ...selector, point: [NaN, 2] },
    { ...selector, point: [1] },
    { ...selector, actionIndex: 0 },
    { ...selector, source: { consumerFeatureId: "import-only" } },
  ])
    expect(validateFeatureDefinition(definition(value)).success).toBe(false);
});

test("shared boundary contract retains the importer v1 byte encoding", () => {
  const region = {
    regionId: "region_test" as const,
    isClosed: true,
    loops: [],
  } as unknown as RegionRecord;
  expect(deriveRegionBoundaryIdentity(region, [region])).toBe(
    "import-region-boundary/v1:[]",
  );
  expect(deriveImportRegionBoundaryIdentity(region, [region])).toBe(
    deriveRegionBoundaryIdentity(region, [region]),
  );
});
