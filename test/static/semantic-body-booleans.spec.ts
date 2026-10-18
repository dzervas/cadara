import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
test("body booleans share browser preparation and production mutation, never CLI geometry or body-array editing", () => {
  for (const [file, name] of [
    ["combine", "combine"],
    ["split", "split"],
    ["delete-solid", "deleteSolid"],
  ]) {
    const source = read(`src/core/feature-authoring/features/${file}.ts`);
    expect(source).toContain(`${name}AuthoringDefinition.buildDefinition(`);
    expect(source).toContain(`${name}AuthoringDefinition.hydrateDraft({`);
    expect(source).toContain("hasExactBodyParticipants(parameters");
  }
  for (const file of ["combine", "split"]) {
    const source = read(`src/core/feature-authoring/features/${file}.ts`);
    expect(source).toContain("options: { keepTools: draft.keepTools }");
    expect(source).toContain("feature.parameters.options?.keepTools");
  }
  const mutation = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  for (const name of ["Combine", "Split", "DeleteSolid"])
    expect(mutation).toContain(
      `prepare${name}FeatureDefinition(command.parameters)`,
    );
  expect(mutation).toContain("input.service.createFeature(base)");
  expect(mutation).toContain("input.service.updateFeature({");
  expect(mutation).toContain("observePersistence:");
  expect(mutation).toContain("r.invalidation !== null");
  expect(mutation).not.toMatch(
    /executeCombineFeature|executeSplitFeature|executeDeleteSolidFeature|BRepAlgo|repository\.mutate/,
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("sdk.execute(operation.command,");
  expect(cli).not.toMatch(
    /prepareCombineFeatureDefinition|executeCombineFeature|executeSplitFeature|executeDeleteSolidFeature|BRepAlgo/,
  );
});
