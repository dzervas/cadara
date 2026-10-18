import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
test("lofts reuse canonical options, browser hydration/build and exact production mutation", () => {
  const owner = read("src/core/feature-authoring/features/loft.ts");
  expect(owner).toContain("loftAuthoringDefinition.buildDefinition(");
  expect(owner).toContain("loftAuthoringDefinition.hydrateDraft({");
  expect(owner).toContain("LoftFeatureParameters");
  expect(read("src/contracts/modeling/advanced-solid.ts")).toContain(
    'Pick<LoftAdvancedOptions, "path">',
  );
  const mutation = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(mutation).toContain(
    "prepareLoftFeatureDefinition(command.parameters)",
  );
  expect(mutation).toContain("input.service.createFeature(base)");
  expect(mutation).toContain("input.service.updateFeature({");
  expect(mutation).toContain("observePersistence:");
  expect(mutation).not.toMatch(
    /executeLoftFeature|BRepOffsetAPI|transformLoftSectionWire|repository\.mutate/,
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("sdk.execute(operation.command,");
  expect(cli).not.toMatch(
    /prepareLoftFeatureDefinition|executeLoftFeature|BRepOffsetAPI|addPathDrivenLoftSections/,
  );
  const signatures = read("src/domain/modeling/occ/topology-signatures.ts");
  expect(signatures).toContain('case "bSpline":');
  expect(signatures).not.toMatch(/BRepAdaptor|BRepOffsetAPI|sectionCount/);
});
