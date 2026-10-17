import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../..");
function body(file: string, name: string) {
  const ast = ts.createSourceFile(
    file,
    readFileSync(resolve(root, file), "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const declaration = ast.statements.find(
    (s) => ts.isFunctionDeclaration(s) && s.name?.text === name,
  );
  if (
    !declaration ||
    !ts.isFunctionDeclaration(declaration) ||
    !declaration.body
  )
    throw new Error(`Missing ${name}`);
  return declaration.body.getText(ast);
}

it("browser and semantic dimensions share contribution, reference and solve preparation", () => {
  const file = "src/domain/editor/sketch-session/constraints.ts";
  const legacy = body(file, "authorSketchDimension");
  expect(legacy).toContain("authorSketchRequirement(");
  expect(legacy).not.toContain("solveCommittedConstraintDefinition(");
  expect(legacy).not.toContain("createCommitContribution(");
  for (const name of [
    "commitSketchConstraintAuthoring",
    "authorSketchRequirement",
  ]) {
    const source = body(file, name);
    expect(source).toContain("prepareSketchConstraintCommit(");
    expect(source).not.toContain("solveCommittedConstraintDefinition(");
    expect(source).not.toContain("createCommitContribution(");
  }
  const shared = body(file, "prepareSketchConstraintCommit");
  expect(shared).toContain("createConstraintCommitContribution(");
  expect(shared).toContain("toReferenceDimension(");
  expect(shared).toContain("solveCommittedConstraintDefinition(");
  const annotations = "src/domain/editor/sketch-session/annotations.ts";
  expect(body(annotations, "updateSketchDimensionValue")).toContain(
    "commitSketchAnnotationEditValue(",
  );
  expect(body(annotations, "updateSketchDimensionValue")).not.toContain(
    "withLiveSolveBasis(",
  );
});
