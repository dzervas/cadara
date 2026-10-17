import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

test("semantic extrusion reuses canonical parameters and the browser feature builder instead of defining another option model", () => {
  const schema = read("src/contracts/semantic/schema.ts");
  expect(schema).toContain(
    'import("@/contracts/modeling/schema").ExtrudeFeatureParameters',
  );
  const adapter = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(adapter).toContain(
    "prepareExtrudeFeatureDefinition(command.parameters)",
  );
  expect(adapter).toContain("patchFeatureEditSession(draft!, patch)");
  expect(adapter).toContain("input.service.createFeature(base)");
  expect(adapter).toContain("input.service.updateFeature({");
  expect(adapter).toContain("observePersistence:");
  expect(adapter).not.toMatch(
    /repository\.(?:mutate|initialize)|BRepPrimAPI|executeOccFeature|dispatch\(/,
  );
  const owner = read("src/core/feature-authoring/features/extrude.ts");
  expect(owner).toContain("extrudeAuthoringDefinition.buildDefinition(");
  expect(owner).toContain("extrudeAuthoringDefinition.hydrateDraft({");
  expect(owner).toContain("startExtent: parameters.startExtent");
  expect(owner).toContain("startExtent: draft.startExtent");
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("opened.session.execute(validated.data)");
  expect(cli).not.toMatch(
    /prepareExtrudeFeatureDefinition|patchFeatureEditSession|BRepPrimAPI|createFeature\(|updateFeature\(/,
  );
});
