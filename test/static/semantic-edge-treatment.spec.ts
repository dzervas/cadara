import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

test("edge treatments reuse browser preparation and existing native mutation/reference owners", () => {
  for (const family of ["fillet", "chamfer"]) {
    const owner = read(`src/core/feature-authoring/features/${family}.ts`);
    expect(owner).toContain(`${family}AuthoringDefinition.buildDefinition(`);
    expect(owner).toContain(`${family}AuthoringDefinition.hydrateDraft({`);
  }
  const mutation = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(mutation).toContain(
    "prepareFilletFeatureDefinition(command.parameters)",
  );
  expect(mutation).toContain(
    "prepareChamferFeatureDefinition(command.parameters)",
  );
  expect(mutation).toContain("input.service.createFeature(base)");
  expect(mutation).toContain("input.service.updateFeature({");
  expect(mutation).toContain("observePersistence:");
  expect(mutation).not.toMatch(
    /executeFilletFeature|executeChamferFeature|edgesById|TopExp|BRepFilletAPI|repository\.mutate/,
  );
  const inspection = read(
    "src/infrastructure/modeling/semantic-model-inspection.ts",
  );
  expect(inspection).toContain(
    "deriveKernelTopologySignaturesFromExactBrepPayload(",
  );
  expect(inspection).toContain('body.topologyPresentation !== "bodyOnlyMesh"');
  expect(inspection).not.toMatch(/TopExp|edgesById|new .*BRep/);
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("sdk.execute(operation.command,");
  expect(cli).not.toMatch(
    /prepareFilletFeatureDefinition|prepareChamferFeatureDefinition|createFeature\(|updateFeature\(|deriveKernelTopology/,
  );
});
