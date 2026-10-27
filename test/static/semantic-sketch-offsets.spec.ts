import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

test("browser and explicit offsets share canonical construction, expression-resolved certification basis and authored application", () => {
  const owner = ["src/core/editor/sketch-session/geometry-deletion.ts", "src/core/editor/sketch-session/offset-editing.ts", "src/core/editor/sketch-session/edit-geometry-operations.ts", "src/core/editor/sketch-session/point-merge.ts", "src/core/editor/sketch-session/mirror-editing.ts", "src/core/editor/sketch-session/edit-queries.ts", "src/core/editor/sketch-session/edit-tool-interaction.ts", "src/core/editor/sketch-session/geometry-drag.ts", "src/core/editor/sketch-session/drag-solve.ts"].map(read).join("\n");
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
  const basis = ["src/core/editor/sketch-session/session-definition.ts", "src/core/editor/sketch-session/session-live-solve.ts", "src/core/editor/sketch-session/draft-entity-geometry.ts", "src/core/editor/sketch-session/definition-authoring.ts", "src/core/editor/sketch-session/session-feedback.ts", "src/core/editor/sketch-session/tool-placement.ts", "src/core/editor/sketch-session/tool-authoring.ts"].map(read).join("\n");
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
  expect(client).toContain('from "@/application/semantic/sdk"');
  expect(read("src/application/semantic/sdk.ts")).toContain("resolveSemanticCommand(input,");
  expect(client).toContain("sdk.execute(operation.command,");
  for (const source of [
    read("src/cli/commands/document-recipes.ts"),
    [
      "src/core/editor/sketch-session/geometry-deletion.ts",
      "src/core/editor/sketch-session/offset-editing.ts",
      "src/core/editor/sketch-session/edit-geometry-operations.ts",
      "src/core/editor/sketch-session/point-merge.ts",
      "src/core/editor/sketch-session/mirror-editing.ts",
      "src/core/editor/sketch-session/edit-queries.ts",
      "src/core/editor/sketch-session/edit-tool-interaction.ts",
      "src/core/editor/sketch-session/geometry-drag.ts",
      "src/core/editor/sketch-session/drag-solve.ts",
    ]
      .map(read)
      .join("\n"),
    read("src/infrastructure/modeling/semantic-sketch-port.ts"),
  ]) {
    expect(source).not.toContain("TargetAlias");
    expect(source).not.toContain("aliases.get(");
    expect(source).not.toContain("function resolveLabelled");
  }
});
