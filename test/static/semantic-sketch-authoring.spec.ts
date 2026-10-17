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
it("browser and semantic primitive authoring share contribution factories and solve preparation", () => {
  const file = "src/domain/editor/sketch-session/tools.ts";
  for (const name of ["commitSketchDraw", "authorSketchPrimitive"]) {
    const source = body(file, name);
    expect(source).toContain("prepareSketchContribution(");
    expect(source).not.toContain("createCommitContribution(");
    expect(source).not.toContain("withLiveSolveBasis(");
  }
  const preparation = body(file, "prepareSketchContribution");
  expect(preparation).toContain("createSessionCommitFactories(");
  expect(preparation).toContain("createCommitContribution(");
  expect(preparation).toContain("withLiveSolveBasis(");
  expect(preparation).not.toContain("createPointDefinition(");
});
it("browser and semantic geometry edits share solving, deletion and construction owners", () => {
  const tools = "src/domain/editor/sketch-session/tools.ts";
  expect(body(tools, "toggleSketchConstructionTarget")).toContain("setSketchConstructionTarget(");
  expect(body(tools, "setSketchConstructionTarget")).toContain("toggleConstructionTargetInDefinition(");
  expect(body("src/domain/editor/sketch-session/geometry-actions.ts", "updateSketchGeometry")).toContain("solveDragEdit(");
  expect(body("src/domain/editor/sketch-session/editing.ts", "applySketchGeometryDrag")).toContain("solveDragEdit(");
  expect(body("src/domain/editor/sketch-session/editing.ts", "beginSketchGeometryDrag")).toContain("prepareSketchTangentEditDefinition(");
  expect(body("src/domain/editor/sketch-session/geometry-actions.ts", "updateSketchGeometry")).toContain("prepareSketchTangentEditDefinition(");
  const reducer = readFileSync(resolve(root, "src/core/editor/state-machine/reducer-sketch.ts"), "utf8");
  expect(reducer).toContain("deleteSelectedSketchGeometry(state.session, event.targets)");
  expect(body("src/core/editor/state-machine/transitions-sketch.ts", "handleSketchAnnotationDeleteRequested")).toContain("deleteSelectedSketchGeometry(state.session, state.selection)");
  const adapter = readFileSync(resolve(root, "src/infrastructure/modeling/semantic-sketch-port.ts"), "utf8");
  expect(adapter).not.toMatch(/type:\s*["'](?:tool\.activated|sketch\.(?:pointer|geometryDrag))/);
  expect(adapter).not.toContain("solveDragEdit(");
  expect(adapter).not.toContain("deleteSelectedSketchGeometry(");
});
it("semantic publication attaches the existing authored owner basis by emitted intent, not a Finish gesture", () => {
  const source = readFileSync(
    resolve(root, "src/application/editor/sketch-authored-actions.ts"),
    "utf8",
  );
  expect(source).toContain(
    'result.effects.some((effect) => effect.type === "sketch.commit")',
  );
  const adapter = readFileSync(
    resolve(root, "src/infrastructure/modeling/semantic-sketch-port.ts"),
    "utf8",
  );
  expect(adapter).not.toMatch(
    /type:\s*["'](?:tool\.activated|sketch\.pointer)/,
  );
  expect(adapter).not.toContain("authorSketchPrimitive(");
});
