import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("browser and semantic support/reference commands share native resolution, reference authoring and projection completion", () => {
  const runtime = read("src/application/editor/effect-registry.ts");
  expect(runtime).toContain("openSketchSessionFromSelection(");
  expect(runtime).toContain("buildSketchPlaneCommitRequest(input.session)");
  expect(runtime).toContain(
    "modelingService.projectSketchExternalReferences({",
  );
  const tools = ["src/core/editor/sketch-session/edit-tool-activation.ts", "src/core/editor/sketch-session/drawing-tool-lifecycle.ts", "src/core/editor/sketch-session/drawing-pointer.ts", "src/core/editor/sketch-session/reference-authoring.ts", "src/core/editor/sketch-session/drawing-commit.ts", "src/core/editor/sketch-session/tool-presentation.ts"].map(read).join("\n");
  expect(tools).toContain(
    "session.referenceTargetPicking ? authorSketchReference(session, target) : session",
  );
  expect(tools).toContain(
    "appendReferenceDefinition(session.definition, reference)",
  );
  const reducer = read("src/core/editor/state-machine/reducer-sketch.ts");
  expect(reducer).toContain(
    "authorSketchReference(state.session, event.target)",
  );
  expect(reducer).toContain(
    "emitSketchReferenceProjection(createSketchPreviewState(state, session), session)",
  );
  for (const path of [
    "src/core/editor/state-machine/reducer-root.ts",
    "src/core/editor/state-machine/transitions-viewport.ts",
  ])
    expect(read(path)).toContain("applySelectionToSketchPlaneEditSession(");
  expect(read("src/infrastructure/modeling/semantic-sketch-port.ts")).toContain(
    "canStartSketchFromTarget(",
  );
});

it("projection runtime failure clears stale operands without replacing the established solve basis", () => {
  const transitions = read(
    "src/core/editor/state-machine/transitions-effects.ts",
  );
  const failure = transitions.slice(
    transitions.indexOf(
      "export function handleEffectSketchReferenceProjectionFailed(",
    ),
    transitions.indexOf("function isPendingSketchRegionResult("),
  );
  expect(failure).toContain("projectedReferences: []");
  expect(failure).toContain("projection-runtime-failed");
  expect(failure).not.toContain("updateSketchReferenceProjection(");
  expect(failure).not.toContain("liveSolve:");
});

it("clients do not invent planes/projections or simulate viewport targets to create references", () => {
  for (const path of [
    "src/cli/commands/document-recipes.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ]) {
    const source = read(path);
    expect(source).not.toMatch(
      /createFaceBackedSketchPlane\(|createSketchPlaneFrameFromFaceMesh\(|createReferenceDefinition\(|appendReferenceDefinition\(/,
    );
    expect(source).not.toMatch(
      /type:\s*["'](?:tool\.activated|viewport\.|sketch\.pointer)/,
    );
    expect(source).not.toContain("referenceTargetPicking: true");
  }
});
