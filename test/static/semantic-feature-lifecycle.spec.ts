import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const read = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../..", path), "utf8");

it("semantic lifecycle commands use the shared production lifecycle and persistence owners", () => {
  const source = read(
    "src/infrastructure/modeling/semantic-feature-lifecycle-port.ts",
  );
  for (const method of [
    "setFeatureSuppression",
    "deleteFeature",
    "reorderFeature",
    "renameBody",
    "setBodyAppearance",
    "deleteTarget",
    "setFeatureCursor",
    "reorderDocumentHistory",
  ]) {
    expect(source).toContain(`input.service.${method}(`);
  }
  expect(source).toContain("observePersistence:");
  expect(source).toContain(
    "result.rebuildResult.revisionId === state.revisionId",
  );
  expect(source).toContain("requireDurableRef");
  expect(source).toContain("semanticSketchesCurrent(input.loop.getState().snapshot, state.revisionId)");
  expect(read("src/infrastructure/modeling/semantic-variable-port.ts")).toContain("semanticSketchesCurrent(snapshot, state.revisionId)");
  expect(source).not.toMatch(
    /repository\.(?:mutate|initialize)|applyCollaborativeWrites|history\.(?:undo|redo)|dispatch\(|restoreAuthoredModelDocument/,
  );
});

it("recipe lifecycle aliases do not own modeling, topology or author-history algorithms", () => {
  const source = read("src/cli/commands/document-recipes.ts");
  expect(read("src/application/semantic/sdk.ts")).toContain("validateSemanticCommand(command)");
  expect(source).toContain("sdk.execute(operation.command,");
  expect(source).not.toMatch(
    /setFeatureSuppression\(|reorderDocumentHistory\(|setFeatureCursor\(|repository\.(?:mutate|initialize)|applyCollaborativeWrites|topologyLineage|restoreAuthoredModelDocument/,
  );
});
