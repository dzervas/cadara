import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

it("browser and semantic movement share handle intent, tangent preparation and constrained solve owners", () => {
  const browser = read("src/domain/editor/sketch-session/editing.ts");
  const semantic = read("src/domain/editor/sketch-session/geometry-actions.ts");
  for (const source of [browser, semantic]) {
    expect(source).toContain("resolveHandleFromTarget(");
    expect(source).toContain("resolveSketchDragIntent(");
    expect(source).toContain("prepareSketchTangentEditDefinition(");
    expect(source).toContain("solveDragEdit(");
  }
  const point = semantic.slice(
    semantic.indexOf('case "point":'),
    semantic.indexOf('case "translate":'),
  );
  expect(point).toContain(
    "resolveSketchDragIntent(session.definition, handle)",
  );
  expect(point).not.toMatch(/intent\s*=\s*\{\s*kind:\s*["']point/);
  expect(semantic).not.toMatch(
    /compileSketchSolveProgram|startCompiledSketchSolveSession|applyPointPositionsToDefinition|applySolvedSketchToDefinition/,
  );
  expect(browser).toContain("detectConstrainedMovementFeedback(");
  expect(browser).toContain("updateCompiledSketchSolveSession(");
});

it("terminal movement routes through the public operation and authored reducer without gesture choreography", () => {
  const adapter = read("src/infrastructure/modeling/semantic-sketch-port.ts");
  expect(adapter).toContain('command.operation === "sketch.geometry.update"');
  expect(adapter).toContain('type: "sketch.geometryUpdated", edit');
  expect(read("src/core/editor/state-machine/reducer-sketch.ts")).toContain(
    "updateSketchGeometry(",
  );
  expect(read("src/application/editor/sketch-authored-actions.ts")).toContain(
    '"Edit Sketch Geometry"',
  );
  const cli = read("src/cli/commands/document-recipes.ts");
  for (const source of [adapter, cli]) {
    expect(source).not.toMatch(
      /\.pointer(?:Move|Release)\(|type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
    expect(source).not.toMatch(
      /solveDragEdit\(|updateCompiledSketchSolveSession\(|applyPointPositionsToDefinition\(/,
    );
  }
});
