import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

it("browser and semantic corner/slot construction share canonical builders, gates and solve-basis handoff", () => {
  const source = ["src/domain/editor/sketch-session/geometry-deletion.ts", "src/domain/editor/sketch-session/offset-editing.ts", "src/domain/editor/sketch-session/edit-geometry-operations.ts", "src/domain/editor/sketch-session/point-merge.ts", "src/domain/editor/sketch-session/mirror-editing.ts", "src/domain/editor/sketch-session/edit-queries.ts", "src/domain/editor/sketch-session/edit-tool-interaction.ts", "src/domain/editor/sketch-session/geometry-drag.ts", "src/domain/editor/sketch-session/drag-solve.ts"].map(read).join("\n");
  // cadara-h026.2: Fillet and Chamfer build through the per-corner builder.
  for (const builder of [
    "createSketchCornersMutation",
    "createSketchSlotContribution",
  ])
    expect(source.match(new RegExp(`${builder}\\(`, "g"))).toHaveLength(1);
  expect(source.match(/getSketchCornerSlotResult\(session,/g)).toHaveLength(4);
  expect(source.match(/completeSketchEditOperation\(session,/g)).toHaveLength(
    4, // Corner/slot, browser confirmation, explicit mirror and derivation creation.
  );
  expect(source).toContain("offsetEditInputGate(session, input.entityIds");
  expect(source).toContain("applySketchEditOperationResult(session, result)");
  expect(source).toContain("withLiveSolveBasis(");
  expect(read("src/core/editor/state-machine/reducer-sketch.ts")).toContain(
    "buildSketchGeometry(state.session, event.input)",
  );
  expect(read("src/infrastructure/modeling/semantic-sketch-port.ts")).toContain(
    'type: "sketch.geometryBuilt"',
  );
});

it("terminal construction owns neither corner algorithms nor browser gestures", () => {
  for (const path of [
    "src/infrastructure/modeling/semantic-sketch-port.ts",
    "src/cli/commands/document-recipes.ts",
  ]) {
    const source = read(path);
    expect(source).not.toMatch(
      /createSketch(?:FilletMutation|ChamferMutation|SlotContribution)\(|findSharedLineCorner\(|offsetLinePoints\(|primitiveArcRelationships\(/,
    );
    expect(source).not.toMatch(
      /type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
  }
});
