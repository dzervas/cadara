import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");
test("body operations share browser preparation, native capabilities and exact mutation, not CLI transforms", () => {
  for (const [file, name] of [
    ["mirror", "mirror"],
    ["transform", "transform"],
    ["linear-pattern", "linearPattern"],
    ["circular-pattern", "circularPattern"],
  ]) {
    const source = read(`src/core/feature-authoring/features/${file}.ts`);
    expect(source).toContain(`${name}AuthoringDefinition.buildDefinition(`);
    expect(source).toContain(`${name}AuthoringDefinition.hydrateDraft({`);
    expect(source).toContain("hasExactBodyOperationParticipants(parameters");
  }
  const mutation = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  for (const name of [
    "Mirror",
    "Transform",
    "LinearPattern",
    "CircularPattern",
  ])
    expect(mutation).toContain(
      `prepare${name}FeatureDefinition(command.parameters)`,
    );
  expect(mutation).toContain("input.service.createFeature(base)");
  expect(mutation).toContain("input.service.updateFeature({");
  expect(mutation).toContain("observePersistence:");
  expect(mutation).not.toMatch(
    /executeMirrorFeature|executeTransformFeature|executeLinearPatternFeature|BRepBuilder|gp_Trsf/,
  );
  expect(
    read("src/infrastructure/modeling/semantic-model-inspection.ts"),
  ).toContain("capabilities: snapshot.document.capabilities");
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("sdk.execute(operation.command,");
  expect(cli).not.toMatch(
    /OCC_KERNEL_CAPABILITIES|supportedFeatureKinds|previewableFeatureKinds|gp_Trsf|Math\.cos|prepareMirrorFeatureDefinition/,
  );
});
