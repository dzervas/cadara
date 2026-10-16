import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
test("semantic replay reuses canonical production normalization and exact mutation, not a CLI history interpreter", () => {
  expect(read("src/contracts/semantic/schema.ts")).toContain(
    'import("@/contracts/modeling/feature-replay").FeatureReplayFeatureParameters',
  );
  const mutation = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(mutation).toContain("definition = normalizeFeatureDefinition({");
  expect(mutation).toContain('kind: "featureReplay"');
  expect(mutation).toContain("input.service.createFeature(base)");
  expect(mutation).toContain("input.service.updateFeature({");
  expect(mutation).toContain("observePersistence:");
  expect(mutation).not.toMatch(
    /executeFeatureReplayFeature|buildExtrudeFeatureShape|applyBooleanPolicy|gp_Trsf/,
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("opened.session.execute(validated.data)");
  expect(cli).not.toMatch(
    /replaySource|localTransforms|authoredFeatures|normalizeFeatureDefinition|buildExtrudeFeatureShape|gp_Trsf/,
  );
  const helpers = read("src/domain/modeling/modeling-service/helpers.ts");
  expect(
    helpers.match(
      /definition: normalizeFeatureDefinition\(input.definition\)/g,
    )!.length,
  ).toBeGreaterThanOrEqual(2);
});
