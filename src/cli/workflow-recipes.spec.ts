import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
const exec = promisify(execFile);

function createRecipeProcess(directory: string) {
  const recipe = join(directory, "recipe.json");
  const invocation = ["src/cli/main.ts", "document", "recipe", recipe];
  const options = {
    cwd: resolve(import.meta.dirname, "../.."),
    timeout: 90000,
  };
  let invocationNumber = 0;
  async function run(inputs: readonly Record<string, unknown>[], exitCode = 0) {
    const prefix = `process-${++invocationNumber}`;
    const operations = inputs.map((input, index) => ({
      version: 1,
      commandId: `${prefix}-${index}`,
      ...input,
    }));
    await writeFile(recipe, JSON.stringify({ version: 1, operations }));
    let stdout = "",
      stderr = "",
      code = 0;
    try {
      ({ stdout, stderr } = await exec("bun", invocation, options));
    } catch (error) {
      const failed = error as { code: number; stdout: string; stderr: string };
      code = failed.code;
      stdout = failed.stdout;
      stderr = failed.stderr;
    }
    expect(code, stderr).toBe(exitCode);
    expect(stderr).not.toMatch(/Unhandled|ReferenceError/);
    if (exitCode === 2) {
      expect(stderr.length).toBeGreaterThan(0);
      expect(stdout).toBe("");
      return [];
    }
    const results: SemanticResult[] = JSON.parse(stdout).results;
    for (const [index, result] of results.entries()) {
      expect(result.correlation.commandId).toBe(`${prefix}-${index}`);
      expect(
        validateSemanticResult(result.correlation, result).success,
        JSON.stringify(result),
      ).toBe(true);
    }
    if (exitCode === 0)
      expect(results.map((result) => result.outcome.kind)).toEqual(
        Array(inputs.length).fill("completed"),
      );
    return results;
  }
  return run;
}

it("replays the dimensioned workflow in real Bun processes with correlated JSON and exit code 0", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-workflow-recipe-"));
  const native = join(directory, "plate.cadara");
  const output = join(directory, "plate.step");
  const run = createRecipeProcess(directory);
  function size(result: SemanticResult, width: number) {
    const bounds = result.discovery!.model!.bodies[0]!.bounds!;
    for (const [axis, value] of [width, 10, 7].entries())
      expect(bounds.max[axis]! - bounds.min[axis]!).toBeCloseTo(value, 5);
  }
  const start = [
    {
      operation: "document.create",
      label: "Process plate",
      basis: null,
      as: "document",
    },
    {
      operation: "sketch.begin",
      plane: "xy",
      basis: { alias: "document" },
      as: "draft",
    },
    {
      operation: "sketch.author",
      basis: { alias: "draft" },
      draft: { alias: "draft" },
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
      as: "rectangle",
    },
  ];
  try {
    // Discover labels through the process seam instead of guessing generated IDs.
    const discovered = await run([
      ...start,
      {
        operation: "sketch.publish",
        basis: { alias: "rectangle" },
        draft: { alias: "rectangle" },
        requireProfiles: true,
      },
    ]);
    const probe = discovered[2]!.discovery!;
    const profileLabel = discovered[3]!.discovery!.references.find(
      (reference) => reference.target.kind === "region",
    )!.label;
    const pointLabel = (position: readonly number[]) => {
      const point = probe.sketch!.points.find(
        (point) =>
          point.position[0] === position[0] &&
          point.position[1] === position[1],
      )!;
      return probe.references.find(
        (reference) =>
          reference.target.kind === "sketchPoint" &&
          reference.target.pointId === point.pointId,
      )!.label;
    };
    const initial = await run([
      ...start,
      {
        operation: "sketch.dimension.add",
        basis: { alias: "rectangle" },
        draft: { alias: "rectangle" },
        axis: "horizontal",
        points: [
          { alias: "rectangle", label: pointLabel([0, 0]) },
          { alias: "rectangle", label: pointLabel([20, 0]) },
        ],
        mode: "driving",
        value: 20,
        intent: "fulfill",
        as: "width",
      },
      {
        operation: "sketch.dimension.add",
        basis: { alias: "width" },
        draft: { alias: "width" },
        axis: "vertical",
        points: [
          { alias: "width", label: pointLabel([20, 0]) },
          { alias: "width", label: pointLabel([20, 10]) },
        ],
        mode: "driving",
        value: 10,
        intent: "fulfill",
        as: "dimensions",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "dimensions" },
        draft: { alias: "dimensions" },
        requireProfiles: true,
        as: "published",
      },
      {
        operation: "extrude.create",
        basis: { alias: "published" },
        profile: { alias: "published", label: profileLabel },
        depth: 7,
        intent: "fulfill",
        as: "solid",
      },
      { operation: "document.save", basis: { alias: "solid" }, path: native },
    ]);
    size(initial[6]!, 20);
    const sketch = initial[5]!.discovery!.sketch!;
    const width = sketch.requirements.find(
      (requirement) => requirement.value === 20,
    )!;
    const sketchLabel = initial[6]!.discovery!.references.find(
      (reference) =>
        reference.target.kind === "sketch" &&
        reference.target.sketchId === sketch.sketchId,
    )!.label;
    const edited = await run([
      { operation: "document.open", basis: null, path: native, as: "opened" },
      {
        operation: "sketch.open",
        basis: { alias: "opened" },
        sketchId: { alias: "opened", label: sketchLabel },
        as: "draft",
      },
      {
        operation: "sketch.dimension.update",
        basis: { alias: "draft" },
        draft: { alias: "draft" },
        dimensionId: { alias: "draft", label: width.label },
        value: 35,
        intent: "fulfill",
        as: "updated",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "updated" },
        draft: { alias: "updated" },
        requireProfiles: true,
        as: "changed",
      },
      {
        operation: "history.undo",
        basis: { alias: "changed" },
        draft: null,
        as: "undone",
      },
      {
        operation: "history.redo",
        basis: { alias: "undone" },
        draft: null,
        as: "redone",
      },
      { operation: "document.save", basis: { alias: "redone" }, path: native },
    ]);
    size(edited[3]!, 35);
    size(edited[4]!, 20);
    size(edited[5]!, 35);
    expect(edited[3]!.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Publish Sketch",
    );
    expect(
      edited[3]!.discovery!.sketch!.requirements.find(
        (requirement) => requirement.value === 35,
      )!.dimensionId,
    ).toBe(width.dimensionId);
    const body = edited[5]!.discovery!.references.find(
      (reference) => reference.target.kind === "body",
    )!;
    const reopened = await run([
      { operation: "document.open", basis: null, path: native, as: "opened" },
      {
        operation: "export.step",
        basis: { alias: "opened" },
        target: { alias: "opened", label: body.label },
        options: { schema: "AP242", unit: "millimeter" },
        path: output,
      },
    ]);
    size(reopened[0]!, 35);
    expect(reopened[0]!.discovery!.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
    expect(reopened[0]!.discovery!.references).toEqual(
      edited[5]!.discovery!.references,
    );
    const step = await readFile(output, "utf8");
    expect(step).toContain("MANIFOLD_SOLID_BREP");
    expect(step).toContain("AP242");
    expect(reopened[1]!.completion.file).toMatchObject({
      kind: "written",
      bytesWritten: Buffer.byteLength(step),
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);

it("real Bun failure and usage exits preserve clean correlated output and stop before the next recipe action", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-workflow-exits-"));
  const run = createRecipeProcess(directory);
  try {
    const failure = await run(
      [
        {
          operation: "document.create",
          label: "Fresh process",
          basis: null,
          as: "opened",
        },
        { operation: "history.undo", basis: { alias: "opened" }, draft: null },
        {
          operation: "document.rename",
          basis: { alias: "opened" },
          label: "Must not run",
        },
      ],
      1,
    );
    expect(failure).toHaveLength(2);
    expect(failure[1]!.outcome).toEqual({
      kind: "unavailable",
      capability: "history.undo",
    });
    expect(failure[1]!.completion.live.kind).toBe("unchanged");
    await run(
      [
        {
          operation: "document.create",
          label: "Invalid",
          basis: null,
          unexpected: true,
        },
      ],
      2,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
