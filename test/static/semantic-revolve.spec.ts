import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

test("revolve consumes canonical browser preparation and the existing production feature completion owner", () => {
  expect(read("src/contracts/semantic/schema.ts")).toContain(
    'import("@/contracts/modeling/schema").RevolveFeatureParameters',
  );
  const shared = read("src/core/feature-authoring/features/revolve.ts");
  expect(shared).toContain("revolveAuthoringDefinition.buildDefinition(");
  expect(shared).toContain("revolveAuthoringDefinition.hydrateDraft({");
  const adapter = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(adapter).toContain(
    "prepareRevolveFeatureDefinition(command.parameters)",
  );
  expect(adapter).toContain("input.service.createFeature(base)");
  expect(adapter).toContain("input.service.updateFeature({");
  expect(adapter).toContain("observePersistence:");
  expect(adapter).not.toMatch(
    /repository\.(?:mutate|initialize)|BRepPrimAPI|executeOccFeature|dispatch\(/,
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("sdk.execute(operation.command,");
  expect(cli).not.toMatch(
    /prepareRevolveFeatureDefinition|createFeature\(|updateFeature\(|BRepPrimAPI/,
  );
});
