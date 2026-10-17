import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("explicit and browser patterns/transforms share the builder, input gate and actual commit/publication owners", () => {
  const editing = read("src/domain/editor/sketch-session/editing.ts");
  for (const kind of ["linearPattern", "circularPattern", "transform"])
    expect(editing).toContain(
      `getSketchDerivationResult(session, "${kind}", entityIds, activeEditTool.toolValue)`,
    );
  expect(editing).toContain("operatorKind: kind");
  expect(editing).toContain(
    "completeSketchEditOperation(session, getSketchDerivationResult(",
  );
  expect(editing).toContain("offsetEditInputGate(session, entityIds");
  expect(read("src/core/editor/state-machine/reducer-sketch.ts")).toContain(
    "createSketchDerivation(state.session, event.input)",
  );
  const port = read("src/infrastructure/modeling/semantic-sketch-port.ts");
  expect(port).toContain('type: "sketch.derivationCreated"');
  expect(port).toContain(
    "solvedPairDefinition(s.liveSolve!.definition, s.liveSolve!.solvedSnapshot)",
  );
  expect(port.match(/currentDerivedOutputGeometry\(s,/g)).toHaveLength(2);
  expect(port).toContain("dispatchAndSettle(");
  expect(port).toContain('type: "sketch.publishRequested"');
});

it("derivation clients neither create records/transform algorithms nor emulate gestures/solving", () => {
  for (const path of [
    "src/cli/commands/document-recipes.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ]) {
    expect(read(path)).not.toMatch(
      /createSketchDerivedTransformContribution\(|evaluateSketchDerivations\(|createRelationship\(|transformSketchPoint\(|solveDragEdit\(|solveCompiledSketchProgram\(/,
    );
    expect(read(path)).not.toMatch(
      /type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
  }
});
