import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("explicit and browser intersection edits share accepted-basis preparation, exact-result gates and mutation builders", () => {
  const session = ["src/core/editor/sketch-session/geometry-deletion.ts", "src/core/editor/sketch-session/offset-editing.ts", "src/core/editor/sketch-session/edit-geometry-operations.ts", "src/core/editor/sketch-session/point-merge.ts", "src/core/editor/sketch-session/mirror-editing.ts", "src/core/editor/sketch-session/edit-queries.ts", "src/core/editor/sketch-session/edit-tool-interaction.ts", "src/core/editor/sketch-session/geometry-drag.ts", "src/core/editor/sketch-session/drag-solve.ts"].map(read).join("\n");
  expect(
    session.match(/sketchEditIntersectionInput\(session, operation\)/g)!.length,
  ).toBeGreaterThanOrEqual(2);
  expect(session).toContain(
    "const completed = completeSketchIntersectionEdit(session, inFlight, result)",
  );
  for (const builder of [
    "createSketchTrimMutation",
    "createSketchExtendMutation",
    "createSketchSplitMutation",
  ]) {
    expect(session).toContain(`${builder}(`);
    expect(session.match(new RegExp(`${builder}\\(`, "g"))).toHaveLength(1);
  }
  expect(session).toContain("session.definition !== basis.definition");
  expect(session).toContain(
    "session.liveSolve?.solvedSnapshot !== basis.input.solvedSnapshot",
  );
  expect(session).toContain("mirrorEditRefusal(");
  expect(session).toContain("offsetEditInputGate(");
  const adapter = read("src/infrastructure/modeling/semantic-sketch-port.ts");
  expect(adapter).toContain("prepareSketchIntersectionEdit(");
  expect(adapter).toContain("requireQuerySketchEditIntersectionsResponse(");
  expect(adapter).toContain("answer.requestId !== requestId");
  expect(read("src/core/editor/state-machine/reducer-sketch.ts")).toContain(
    "completeSketchIntersectionEdit(",
  );
});

it("terminal intersection edits neither activate browser tools nor own intersection/mutation algorithms", () => {
  for (const path of [
    "src/infrastructure/modeling/semantic-sketch-port.ts",
    "src/cli/commands/document-recipes.ts",
  ]) {
    const source = read(path);
    expect(source).not.toMatch(
      /type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
    expect(source).not.toMatch(
      /createSketch(?:Trim|Split|Extend)Mutation\(|evaluateNeutralCurve\(|queryNeutralCurvePair\(|infiniteLineIntersection\(/,
    );
  }
});
