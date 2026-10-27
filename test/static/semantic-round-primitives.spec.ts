import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");
it("round semantic authoring consumes browser contribution validation instead of reconstructing primitives", () => {
  const preparation = read("src/core/sketch-tools/semantic-primitive.ts");
  for (const name of [
    "validateThreePointCircle",
    "validateThreePointArc",
    "validateCenterPointArc",
    "validateTangentArc",
  ])
    expect(preparation).toContain(`${name}(points)`);
  expect(preparation).not.toMatch(
    /create(?:Circle|Arc|Line|Point)(?:Entity|Definition)\(/,
  );
  expect(preparation).not.toMatch(
    /getCircumcircleFromPoints\(|getTangentArcCircle\(|createRegularPolygonVertices\(/,
  );
  const owner = ["src/domain/editor/sketch-session/edit-tool-activation.ts", "src/domain/editor/sketch-session/drawing-tool-lifecycle.ts", "src/domain/editor/sketch-session/drawing-pointer.ts", "src/domain/editor/sketch-session/reference-authoring.ts", "src/domain/editor/sketch-session/drawing-commit.ts", "src/domain/editor/sketch-session/tool-presentation.ts"].map(read).join("\n");
  expect(owner).toContain("sketchPrimitiveContributionInput(primitive)");
  expect(owner).toContain(
    'primitive.kind === "tangentArc" ? primitive.source?.entityId ?? null : null',
  );
});
it("browser and semantic tangent-source restrictions share a pure owner and clients do not emulate gestures", () => {
  for (const file of [
    "src/domain/sketch-inference/placement-inference.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ])
    expect(read(file)).toContain("canUseTangentArcSourceAtPoint(");
  for (const file of [
    "src/cli/commands/document-recipes.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
    "src/core/sketch-tools/semantic-primitive.ts",
  ]) {
    expect(read(file)).not.toMatch(
      /\.pointer(?:Move|Release)\(|type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
    expect(read(file)).not.toMatch(/createCommitContribution\(/);
  }
});
