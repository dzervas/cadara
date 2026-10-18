import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("browser and explicit offsets share canonical construction, expression-resolved certification basis and authored application", () => {
  const owner = read("src/domain/editor/sketch-session/editing.ts");
  expect(
    owner.match(/createSketchOffsetDerivationContribution\(/g),
  ).toHaveLength(1);
  expect(owner).toContain(
    "getSketchOffsetResult(session, sketchEntityTargets.map",
  );
  expect(owner).toContain(
    "getSketchOffsetResult(session, entityIds, distance, side, plan)",
  );
  expect(owner).toContain(
    "getOffsetContributionBasis(session, preview.contribution, replan)",
  );
  expect(owner).toContain(
    "getOffsetContributionBasis(session, contribution, plan)",
  );
  expect(owner).toContain(
    "applySketchOffsetContribution(session, contribution)",
  );
  expect(owner).toContain('record.status !== "certified"');
  expect(owner).toContain("session.definition !== prepared.definition");
  expect(owner).toContain(
    "session.liveRegions.generation !== prepared.generation",
  );
  const basis = read("src/domain/editor/sketch-session/internals.ts");
  expect(basis).toContain("resolveSketchDefinitionForSolve(");
  expect(basis).toContain("isOffsetPublicationSolveAccepted(solvedSnapshot)");
  const adapter = read("src/infrastructure/modeling/semantic-sketch-port.ts");
  expect(adapter).toContain(
    "createModelingServiceEditorEffectRuntime(input.service)",
  );
  expect(adapter).toContain('derivationLane: "offsetPreview"');
  expect(adapter).toContain('type: "sketch.offsetCompleted"');
  expect(read("src/application/editor/effect-registry.ts")).toContain(
    "requireSketchOffsetPublications(",
  );
  expect(read("src/core/editor/state-machine/reducer-sketch.ts")).toContain(
    "completeSketchOffset(state.session, event.prepared, event.record)",
  );
});

test("offset CLI and semantic adapter own neither offset algorithms, uncertified geometry nor pointer choreography", () => {
  for (const path of [
    "src/infrastructure/modeling/semantic-sketch-port.ts",
    "src/application/semantic/target-resolution.ts",
    "src/cli/commands/document-recipes.ts",
  ]) {
    const source = read(path);
    expect(source).not.toMatch(
      /createSketchOffsetDerivationContribution\(|solveOffsetFrame\(|publishOffsetFrame\(|offsetLinePoints\(/,
    );
    expect(source).not.toMatch(
      /type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
  }
  const discovery = read("src/infrastructure/modeling/semantic-sketch-port.ts");
  expect(discovery).toContain(
    "certifiedOffsetDerivationIds?.includes(relationship.derivationId)",
  );
  expect(discovery).toContain(
    "solvedPairDefinition(session.liveSolve!.definition",
  );
  expect(discovery).not.toContain("getSketchSessionDisplayDefinition(");
});

test("relationship label aliases delegate to the application resolver, not terminal or offset owners", () => {
  const client = read("src/cli/commands/document-recipes.ts");
  // The terminal still validates encoding before opening the model.
  expect(client).toContain(
    'validateTarget(command.derivationId, "derivation_validation")',
  );
  expect(client).toContain('from "@/application/semantic/target-resolution"');
  expect(client).toContain("resolveSemanticCommand(operation.command,");
  for (const path of [
    "src/cli/commands/document-recipes.ts",
    "src/domain/editor/sketch-session/editing.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ]) {
    expect(read(path)).not.toContain("TargetAlias");
    expect(read(path)).not.toContain("aliases.get(");
    expect(read(path)).not.toContain("function resolveLabelled");
  }
});
