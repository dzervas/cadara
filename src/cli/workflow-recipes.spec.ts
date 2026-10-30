import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cliEntry,
  execCliTestProcess,
} from "../../test/helpers/cli-recipe-process";
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  rename,
  readdir,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
const exec = execCliTestProcess;

const root = resolve(import.meta.dirname, "../..");

function createRecipeProcess(
  directory: string,
  runtime: { entry: string; cwd: string },
  signal: AbortSignal,
) {
  const recipe = join(directory, "recipe.json");
  const invocation = [runtime.entry, "document", "recipe", recipe];
  const options = {
    cwd: runtime.cwd,
    timeout: 90000,
    encoding: "utf8" as const,
    signal,
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
      if (typeof failed.code !== "number") throw error;
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
    const envelope = JSON.parse(stdout);
    expect(envelope.cleanup).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
    });
    const results: SemanticResult[] = envelope.results;
    expect(envelope.unexecuted).toEqual(
      operations.slice(results.length).map((operation) => operation.commandId),
    );
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

it("runs the source entry with real OCC and clean correlated recipe output", async ({ signal }) => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-source-cli-"));
  try {
    // Only entry compatibility needs the expensive source transform. Workflow
    // semantics below run against the same release bundle used by the CLI suite.
    const example = JSON.parse(
      await readFile(join(root, "src/cli/examples/plate.json"), "utf8"),
    );
    const inputs = example.operations as Record<string, unknown>[];
    for (const input of inputs)
      if (input.operation === "document.save")
        input.path = join(directory, "plate.cadara");
    const recipe = join(directory, "recipe.json");
    await writeFile(recipe, JSON.stringify(example));
    // Source startup resolves bunfig's Typia preload from the repository cwd.
    const { stdout, stderr } = await exec(
      "bun",
      [join(root, "src/cli/main.ts"), "document", "recipe", recipe],
      { cwd: root, encoding: "utf8", timeout: 90000, signal },
    );
    expect(stderr).toBe("");
    const envelope = JSON.parse(stdout);
    expect(envelope.results).toHaveLength(inputs.length);
    expect(envelope.unexecuted).toEqual([]);
    expect(envelope.cleanup).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
    });
    const results = envelope.results as SemanticResult[];
    for (const [index, result] of results.entries()) {
      expect(result.correlation.commandId).toBe(inputs[index].commandId);
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(true);
    }
    const bounds = results.at(-1)!.discovery!.model!.bodies[0]!.bounds!;
    for (const [axis, value] of [20, 10, 7].entries())
      expect(bounds.max[axis]! - bounds.min[axis]!).toBeCloseTo(value, 5);
    expect(
      (await readFile(join(directory, "plate.cadara"))).length,
    ).toBeGreaterThan(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

describe.each(["bundle", "extracted package"])(
  "%s release workflow",
  (mode) => {
    let packageDirectory: string | undefined;
    const runtime = { entry: "", cwd: root };
    beforeAll(async () => {
      runtime.entry = cliEntry();
      if (mode === "bundle") return;
      packageDirectory = await mkdtemp(join(tmpdir(), "cadara-cli-release-"));
      // Archive the production build already created by global setup. Rebuilding
      // it here would duplicate the transform/type emission under test-worker load.
      const staging = dirname(cliEntry());
      const extracted = join(packageDirectory, "extracted");
      await exec("tar", [
        "-czf",
        join(packageDirectory, "cli.tar.gz"),
        "-C",
        staging,
        ".",
      ], { encoding: "utf8", timeout: 10000 });
      await mkdir(extracted);
      await exec("tar", [
        "-xzf",
        join(packageDirectory, "cli.tar.gz"),
        "-C",
        extracted,
      ], { encoding: "utf8", timeout: 10000 });
      expect((await readdir(extracted)).filter((name) => !/^chunk-.*\.js$/.test(name)).sort()).toEqual([
        "COVERAGE.md",
        "LICENSE.md",
        "PART-OPERATIONS.md",
        "README.md",
        "SDK.md",
        "SKETCH-OPERATIONS.md",
        "examples",
        "main.js",
        "occ",
        "package.json",
        "sdk.js",
        "types",
      ]);
      expect((await readdir(join(extracted, "occ"))).sort()).toEqual([
        "cadara-occ.js",
        "cadara-occ.wasm",
      ]);
      for (const asset of ["cadara-occ.js", "cadara-occ.wasm"]) {
        const digest = async (path: string) =>
          createHash("sha256")
            .update(await readFile(path))
            .digest("hex");
        expect(await digest(join(extracted, "occ", asset))).toBe(
          await digest(join(root, "public", asset)),
        );
      }
      expect(
        JSON.parse(await readFile(join(extracted, "package.json"), "utf8")),
      ).toMatchObject({
        name: "cadara-cli",
        bin: { cadara: "./main.js" },
      });
      runtime.entry = join(extracted, "main.js");
      runtime.cwd = packageDirectory;
    }, 90000);
    afterAll(async () => {
      if (packageDirectory)
        await rm(packageDirectory, { recursive: true, force: true });
    });

    it("replays the dimensioned workflow in real Bun processes with correlated JSON and exit code 0", async ({ signal }) => {
      const directory = await mkdtemp(
        join(tmpdir(), "cadara-workflow-recipe-"),
      );
      const native = join(directory, "plate.cadara");
      const output = join(directory, "plate.step");
      const run = createRecipeProcess(directory, runtime, signal);
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
          {
            operation: "document.save",
            basis: { alias: "solid" },
            path: native,
          },
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
          {
            operation: "document.open",
            basis: null,
            path: native,
            as: "opened",
          },
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
          {
            operation: "document.save",
            basis: { alias: "redone" },
            path: native,
          },
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
        // Body names now match their owning feature's human label. Export
        // aliases must filter by provider-supported kind, not reject that
        // legitimate feature/body name collision as ambiguous.
        expect(
          edited[5]!.discovery!.references.some(
            (reference) =>
              reference.target.kind === "feature" &&
              reference.label === body.label,
          ),
        ).toBe(true);
        const reopened = await run([
          {
            operation: "document.open",
            basis: null,
            path: native,
            as: "opened",
          },
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

    it("real Bun failure and usage exits preserve clean correlated output and stop before the next recipe action", async ({ signal }) => {
      const directory = await mkdtemp(join(tmpdir(), "cadara-workflow-exits-"));
      const run = createRecipeProcess(directory, runtime, signal);
      try {
        const failure = await run(
          [
            {
              operation: "document.create",
              label: "Fresh process",
              basis: null,
              as: "opened",
            },
            {
              operation: "history.undo",
              basis: { alias: "opened" },
              draft: null,
            },
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

    if (mode === "extracted package")
      it("runs shipped examples and refuses missing packaged assets without a fallback", async ({ signal }) => {
        const extracted = resolve(runtime.entry, "..");
        const invocation = [runtime.entry, "document", "recipe"];
        const options = {
          cwd: runtime.cwd,
          timeout: 90000,
          encoding: "utf8" as const,
          signal,
        };
        const plateDocuments: string[] = [];
        for (const name of ["plate", "plate", "sketch", "scoped-profiles"]) {
          const output = await exec(
            "bun",
            [...invocation, join(extracted, "examples", `${name}.json`)],
            options,
          );
          const envelope = JSON.parse(output.stdout);
          expect(
            envelope.results.every(
              (result: SemanticResult) =>
                result.outcome.kind === "completed" &&
                validateSemanticResult(result.correlation, result).success,
            ),
          ).toBe(true);
          expect(envelope.cleanup).toMatchObject({
            kind: "closed",
            resourcesReleased: true,
          });
          if (name === "plate") {
            plateDocuments.push(
              (envelope.results[0] as SemanticResult).discovery!.state
                .documentId,
            );
            const bounds = (envelope.results.at(-1) as SemanticResult)
              .discovery!.model!.bodies[0]!.bounds!;
            for (const [axis, value] of [20, 10, 7].entries())
              expect(bounds.max[axis]! - bounds.min[axis]!).toBeCloseTo(
                value,
                5,
              );
          }
        }
        expect(plateDocuments[0]).not.toBe(plateDocuments[1]);
        for (const name of ["cadara-occ.js", "cadara-occ.wasm"]) {
          const asset = join(extracted, "occ", name);
          await rename(asset, `${asset}.missing`);
          try {
            const help = await exec("bun", [...invocation, "--help"], options);
            expect(help.stdout).toContain("Usage: cadara document recipe");
            expect(help.stderr).toBe("");
            const invalid = join(runtime.cwd, "invalid.json");
            await writeFile(
              invalid,
              JSON.stringify({
                version: 1,
                operations: [{ operation: "bogus" }],
              }),
            );
            await expect(
              exec("bun", [...invocation, invalid], options),
            ).rejects.toMatchObject({ code: 2, stdout: "" });
            const failure = await exec(
              "bun",
              [...invocation, join(extracted, "examples", "plate.json")],
              options,
            ).then(
              () => {
                throw new Error(
                  "Missing production asset unexpectedly initialized",
                );
              },
              (error: { code: number; stdout: string; stderr: string }) =>
                error,
            );
            expect(failure.code).toBe(1);
            expect(failure.stderr).toContain("Document initialization failed.");
            const envelope = JSON.parse(failure.stdout);
            expect(envelope.results).toEqual([]);
            expect(envelope.initialization.kind).toBe("failed");
            expect(envelope.initialization.diagnostics.length).toBeGreaterThan(
              0,
            );
            expect(envelope.initialization.cleanup).toMatchObject({
              kind: "closed",
              resourcesReleased: true,
            });
          } finally {
            await rename(`${asset}.missing`, asset);
          }
        }
      }, 180000);
  },
);
