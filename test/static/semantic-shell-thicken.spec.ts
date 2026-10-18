import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
test("shell and thicken reuse browser preparation and production mutation, not copied offset/boolean geometry", () => {
  for (const family of ["shell", "thicken"]) {
    const owner = read(`src/core/feature-authoring/features/${family}.ts`);
    expect(owner).toContain(`${family}AuthoringDefinition.buildDefinition(`);
    expect(owner).toContain(`${family}AuthoringDefinition.hydrateDraft({`);
    const mutation = read(
      "src/infrastructure/modeling/semantic-extrude-port.ts",
    );
    expect(mutation).toContain(
      `prepare${family[0]!.toUpperCase() + family.slice(1)}FeatureDefinition(command.parameters)`,
    );
    expect(mutation).toContain("input.service.createFeature(base)");
    expect(mutation).toContain("input.service.updateFeature({");
    expect(mutation).toContain("observePersistence:");
    expect(mutation).not.toMatch(
      /executeShellFeature|executeThickenFeature|MakeThickSolid|BRepOffset|applyBooleanPolicy|repository\.mutate/,
    );
  }
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("sdk.execute(operation.command,");
  expect(cli).not.toMatch(
    /prepareShellFeatureDefinition|prepareThickenFeatureDefinition|createFeature\(|updateFeature\(|BRepOffset/,
  );
});
