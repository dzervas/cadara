import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("completed semantic requirements and browser commits share target resolution, contribution construction and solve preparation", () => {
  const owner = read("src/core/editor/sketch-session/constraints.ts");
  expect(owner).toContain("export function authorSketchRequirement(");
  expect(owner).toContain("resolveSketchConstraintTarget(input.tool,");
  expect(owner).toContain("return prepareSketchConstraintCommit(session, {");
  expect(owner).toContain(
    "return prepareSketchConstraintCommit(session).session;",
  );
  expect(owner).toContain("return authorSketchRequirement(session, {");
  expect(owner).not.toMatch(/argv|stdout|stderr|recipe|exitCode/);
  const reducer = read("src/core/editor/state-machine/reducer-sketch.ts");
  expect(reducer).toContain(
    "authorSketchRequirement(state.session, event.input)",
  );
  expect(reducer).toContain(
    "deleteSelectedSketchAnnotation(session, [target])",
  );
  const annotations = ["src/core/editor/sketch-session/annotation-editing.ts", "src/core/editor/sketch-session/annotation-style.ts", "src/core/editor/sketch-session/annotation-edit-presentation.ts", "src/core/editor/sketch-session/annotation-selection.ts", "src/core/editor/sketch-session/annotation-descriptors.ts", "src/core/editor/sketch-session/annotation-anchors.ts", "src/core/editor/sketch-session/dimension-overlays.ts", "src/core/editor/sketch-session/annotation-geometry.ts", "src/core/editor/sketch-session/annotation-reference-geometry.ts", "src/core/editor/sketch-session/annotation-labels.ts"].map(read).join("\n");
  expect(annotations).toContain(
    "return makeSketchAnnotationReference(session, edit)",
  );
  for (const path of [
    "src/cli/commands/document-recipes.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ]) {
    expect(read(path)).not.toMatch(
      /createCommitContribution\(|solveSketchDefinitionCore\(|type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
  }
});
