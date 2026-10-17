import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

test("planes share browser frame preparation, invariant ownership and exact production mutation", () => {
  expect(read("src/contracts/semantic/schema.ts")).toContain(
    'import("@/contracts/modeling/schema").PlaneFeatureParameters',
  );
  const shared = read("src/core/feature-authoring/features/plane.ts");
  expect(shared).toContain("planeAuthoringDefinition.buildDefinition(");
  expect(shared).toContain("planeAuthoringDefinition.hydrateDraft({");
  expect(shared).toContain(
    "validateSketchPlaneFrameInvariants(draft.explicitFrame)",
  );
  const adapter = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(adapter).toContain(
    "preparePlaneFeatureDefinition(command.parameters)",
  );
  expect(adapter).toContain("input.service.createFeature(base)");
  expect(adapter).toContain("input.service.updateFeature({");
  expect(adapter).toContain("observePersistence:");
  expect(adapter).not.toMatch(
    /repository\.(?:mutate|initialize)|executePlaneFeature|cross\(|Math\.hypot/,
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  expect(cli).toContain("opened.session.execute(validated.data)");
  expect(cli).not.toMatch(
    /preparePlaneFeatureDefinition|createFeature\(|updateFeature\(|validateSketchPlaneFrameInvariants/,
  );
});
