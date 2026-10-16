import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
test("holes reuse shared canonical/browser preparation and native mutation without client-owned cutters", () => {
  const owner = read("src/core/feature-authoring/features/hole.ts");
  expect(owner).toContain("holeAuthoringDefinition.buildDefinition(");
  expect(owner).toContain("holeAuthoringDefinition.hydrateDraft({");
  expect(owner).toContain("HoleFeatureParameters");
  const mutation = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(mutation).toContain(
    "prepareHoleFeatureDefinition(command.parameters)",
  );
  expect(mutation).toContain("input.service.createFeature(base)");
  expect(mutation).toContain("input.service.updateFeature({");
  expect(mutation).toContain("observePersistence:");
  expect(mutation).not.toMatch(
    /executeHoleFeature|makeCountersinkTool|makeCylinder|BRepPrimAPI|repository\.mutate/,
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("opened.session.execute(validated.data)");
  expect(cli).not.toMatch(
    /prepareHoleFeatureDefinition|executeHoleFeature|createFeature\(|updateFeature\(|makeCountersinkTool/,
  );
});
