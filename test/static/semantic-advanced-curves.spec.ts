import { expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(resolve(root, file), "utf8");

it("advanced semantic inputs reuse browser contribution validators and the ordinary spline reconstruction owner", () => {
  const semantic = read("src/core/sketch-tools/semantic-primitive.ts");
  expect(semantic).toContain("tool.validateContribution?.(points, settings)");
  expect(read("src/core/sketch-tools/tools/advanced-curves.ts")).toContain(
    "validateContribution(points, settings)",
  );
  expect(read("src/core/sketch-tools/tools/spline.ts")).toContain(
    "validateContribution: validateSpline",
  );
  expect(read("src/core/sketch-tools/tools/spline.ts")).toContain(
    "reconstructSplineAggregate(",
  );
  expect(semantic).not.toMatch(
    /sample(?:Ellipse|EllipticalArc|Conic|Bezier)|reconstructSpline|create\w+Entity\(/,
  );
  const owner = ["src/core/editor/sketch-session/edit-tool-activation.ts", "src/core/editor/sketch-session/drawing-tool-lifecycle.ts", "src/core/editor/sketch-session/drawing-pointer.ts", "src/core/editor/sketch-session/reference-authoring.ts", "src/core/editor/sketch-session/drawing-commit.ts", "src/core/editor/sketch-session/tool-presentation.ts"].map(read).join("\n");
  expect(owner).toContain("sketchPrimitiveContributionInput(primitive)");
  expect(owner).toContain("prepareSketchContribution(");
});

it("browser and semantic closure reuse the same explicit point merge and do not emulate gestures", () => {
  for (const source of [
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
    read("src/core/editor/sketch-session/geometry-actions.ts"),
  ])
    expect(source).toContain("prepareSketchPointMerge(");
  expect(["src/core/editor/sketch-session/geometry-deletion.ts", "src/core/editor/sketch-session/offset-editing.ts", "src/core/editor/sketch-session/edit-geometry-operations.ts", "src/core/editor/sketch-session/point-merge.ts", "src/core/editor/sketch-session/mirror-editing.ts", "src/core/editor/sketch-session/edit-queries.ts", "src/core/editor/sketch-session/edit-tool-interaction.ts", "src/core/editor/sketch-session/geometry-drag.ts", "src/core/editor/sketch-session/drag-solve.ts"].map(read).join("\n")).toContain(
    "createSketchMergePointsMutation(",
  );
  for (const file of [
    "src/core/sketch-tools/semantic-primitive.ts",
    "src/cli/commands/document-recipes.ts",
    "src/infrastructure/modeling/semantic-sketch-port.ts",
  ]) {
    expect(read(file)).not.toMatch(
      /\.pointer(?:Move|Release)\(|type:\s*["'](?:tool\.activated|sketch\.pointer)/,
    );
    expect(read(file)).not.toMatch(/createCommitContribution\(/);
  }
});
