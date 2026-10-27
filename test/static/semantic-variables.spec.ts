import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("variable commands retain shared production validation and dependent rebuild ownership", () => {
  const port = read("src/infrastructure/modeling/semantic-variable-port.ts");
  expect(port).toContain("input.service.addDocumentVariable(common)");
  expect(port).toContain("input.service.updateDocumentVariable(");
  expect(port).toContain("observePersistence:");
  expect(port).toContain(
    "result.rebuildResult.revisionId === state.revisionId",
  );
  expect(read("src/workbench/document/document-owner.ts")).toContain(
    "modelingService.updateDocumentVariable(",
  );
  const adapter = read("src/domain/modeling/opencascade-kernel-adapter.ts");
  expect(adapter).toContain(
    "evaluateDocumentVariableExpressions(candidateVariables)",
  );
  expect(adapter).toContain(
    "await this.restoreAuthoredModelDocumentOnMainThread(",
  );
});

it("browser and semantic expression preparation stay shared without another evaluator or terminal semantics", () => {
  const annotations = ["src/domain/editor/sketch-session/annotation-editing.ts", "src/domain/editor/sketch-session/annotation-style.ts", "src/domain/editor/sketch-session/annotation-edit-presentation.ts", "src/domain/editor/sketch-session/annotation-selection.ts", "src/domain/editor/sketch-session/annotation-descriptors.ts", "src/domain/editor/sketch-session/annotation-anchors.ts", "src/domain/editor/sketch-session/dimension-overlays.ts", "src/domain/editor/sketch-session/annotation-geometry.ts", "src/domain/editor/sketch-session/annotation-reference-geometry.ts", "src/domain/editor/sketch-session/annotation-labels.ts"].map(read).join("\n");
  expect(annotations).toContain(
    "const pendingValue = normalizeConstraintValue(value)",
  );
  expect(annotations).toContain("pendingValue: normalizeConstraintValue(");
  const extrude = read("src/infrastructure/modeling/semantic-extrude-port.ts");
  expect(extrude).toContain(
    "createFeatureEditorPatchFromExpression(depthField, command.depth)",
  );
  expect(read("src/core/feature-authoring/form-adapter.ts")).toContain(
    "export function createFeatureEditorPatchFromExpression(",
  );
  for (const path of [
    "src/cli/commands/document-recipes.ts",
    "src/infrastructure/modeling/semantic-variable-port.ts",
    "src/infrastructure/modeling/semantic-extrude-port.ts",
  ]) {
    expect(read(path)).not.toMatch(
      /mathjs|math\.(?:parse|evaluate)|new Function|eval\(/,
    );
  }
  expect(read("src/cli/commands/document-recipes.ts")).not.toMatch(
    /evaluateDocumentVariableExpressions|resolveFeatureDefinitionValues|normalizeConstraintValue|restoreAuthoredModelDocument/,
  );
});
