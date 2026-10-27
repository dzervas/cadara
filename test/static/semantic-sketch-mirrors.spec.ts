import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("browser and explicit mirrors share canonical creation, candidate repair, health and removal owners", () => {
  const editing = ["src/core/editor/sketch-session/geometry-deletion.ts", "src/core/editor/sketch-session/offset-editing.ts", "src/core/editor/sketch-session/edit-geometry-operations.ts", "src/core/editor/sketch-session/point-merge.ts", "src/core/editor/sketch-session/mirror-editing.ts", "src/core/editor/sketch-session/edit-queries.ts", "src/core/editor/sketch-session/edit-tool-interaction.ts", "src/core/editor/sketch-session/geometry-drag.ts", "src/core/editor/sketch-session/drag-solve.ts"].map(read).join("\n");
  expect(editing.match(/getSketchMirrorResult\(session,/g)).toHaveLength(2);
  expect(editing.match(/operatorKind: "mirror"/g)).toHaveLength(1);
  expect(editing).toContain("offsetEditInputGate(session, entityIds");
  expect(editing).toContain(
    "completeSketchEditOperation(session, getSketchMirrorResult",
  );
  const actions = read("src/core/editor/sketch-session/mirror-actions.ts");
  expect(actions.match(/getSketchMirrorRepairCandidate\(/g)).toHaveLength(1);
  expect(actions).toContain(
    "completeSketchMirrorRepair(session, tool.repair, picked, true)",
  );
  expect(actions).toContain("getSketchMirrorActionEntries(session, selection)");
  expect(actions).toContain(
    "removeMirrorRelationship(session.definition, derivationId)",
  );
  const reducer = read("src/core/editor/state-machine/reducer-sketch.ts");
  for (const owner of [
    "createSketchMirror",
    "completeSketchMirrorRepair",
    "applySketchMirrorRemoval",
  ])
    expect(reducer).toContain(`${owner}(state.session,`);
  expect(read("src/infrastructure/modeling/semantic-sketch-port.ts")).toContain(
    "getSketchMirrorActionEntries(s)",
  );
});

it("mirror clients do not reflect geometry, emulate gestures or fork the reciprocal solver", () => {
  for (const path of [
    "src/cli/commands/document-recipes.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ]) {
    const source = read(path);
    expect(source).not.toMatch(
      /reflectAcrossLine\(|createSketchDerivedTransformContribution\(|replaceMirror(?:Line|Original)\(|solveCompiledSketchProgram\(|solveDragEdit\(/,
    );
    expect(source).not.toMatch(
      /type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
  }
  const moves = read("src/core/editor/sketch-session/geometry-actions.ts");
  expect(moves).toContain("resolveSketchDragIntent(session.definition");
  expect(moves).toContain("prepareSketchTangentEditDefinition(");
  expect(moves).toContain("solveDragEdit(");
});
