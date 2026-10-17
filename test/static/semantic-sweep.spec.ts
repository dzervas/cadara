import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
test("sweeps share canonical browser preparation, production mutation and existing native owner", () => {
  const owner = read("src/core/feature-authoring/features/sweep.ts");
  expect(owner).toContain("sweepAuthoringDefinition.buildDefinition(");
  expect(owner).toContain("sweepAuthoringDefinition.hydrateDraft({");
  expect(owner).toContain("SweepFeatureParameters");
  const contracts = read("src/contracts/modeling/advanced-solid.ts");
  expect(contracts).toContain(
    'Pick<SweepAdvancedOptions, "profileControl" | "twist" | "endScale">',
  );
  const mutation = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(mutation).toContain(
    "prepareSweepFeatureDefinition(command.parameters)",
  );
  expect(mutation).toContain("input.service.createFeature(base)");
  expect(mutation).toContain("input.service.updateFeature({");
  expect(mutation).toContain("observePersistence:");
  expect(mutation).not.toMatch(
    /executeSweepFeature|BRepOffsetAPI|buildAdvancedSweepLoftShape|repository\.mutate/,
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("opened.session.execute(validated.data)");
  expect(cli).not.toMatch(
    /prepareSweepFeatureDefinition|executeSweepFeature|BRepOffsetAPI|buildAdvancedSweepLoftShape/,
  );
});
