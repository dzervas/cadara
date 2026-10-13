import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";

it("runs ordinary spline authoring and explicit closure by discovered labels with clean correlated JSON", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-advanced-recipe-"));
  try {
    const operations = [
      {
        operation: "document.create",
        label: "Curves",
        basis: null,
        as: "part",
      },
      {
        operation: "sketch.begin",
        basis: { alias: "part" },
        plane: "xy",
        as: "draft",
      },
      {
        operation: "sketch.author",
        basis: { alias: "draft" },
        draft: { alias: "draft" },
        primitive: {
          kind: "spline",
          fitPoints: [
            [0, 0],
            [4, 0],
            [2, 3],
            [0.02, 0.01],
          ],
        },
        construction: false,
        intent: "fulfill",
        as: "curve",
      },
      {
        operation: "sketch.geometry.update",
        basis: { alias: "curve" },
        draft: { alias: "curve" },
        edit: {
          kind: "mergePoints",
          target: { alias: "curve", label: "Spline 1 point 4" },
          destination: { alias: "curve", label: "Spline 1 point 1" },
        },
        intent: "fulfill",
        as: "closed",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "closed" },
        draft: { alias: "closed" },
        requireProfiles: true,
      },
    ].map((command, index) => ({
      version: 1,
      commandId: `advanced-${index}`,
      ...command,
    }));
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    const output = await promisify(execFile)(
      "bun",
      ["src/cli/main.ts", "document", "recipe", path],
      { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
    ).catch((error: unknown) => {
      const failed = error as { stdout?: string; stderr?: string };
      throw new Error(
        JSON.stringify({ stdout: failed.stdout, stderr: failed.stderr }),
      );
    });
    const results: SemanticResult[] = JSON.parse(output.stdout).results;
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      operations.map((o) => o.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    expect(results[2]!.discovery!.sketch!.profiles).toEqual([]);
    expect(
      results[3]!.discovery!.sketch!.points.map((p) => p.position),
    ).toEqual([
      [0, 0],
      [4, 0],
      [2, 3],
    ]);
    expect(results[3]!.discovery!.sketch!.profiles).toHaveLength(1);
    expect(results[4]!.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);

it("refuses missing merge destinations and unknown aliases before later commands", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-merge-refusal-"));
  try {
    const operations = [
      {
        operation: "document.create",
        label: "Curves",
        basis: null,
        as: "part",
      },
      {
        operation: "sketch.begin",
        basis: { alias: "part" },
        plane: "xy",
        as: "draft",
      },
      {
        operation: "sketch.author",
        basis: { alias: "draft" },
        draft: { alias: "draft" },
        primitive: {
          kind: "spline",
          fitPoints: [
            [0, 0],
            [4, 0],
            [2, 3],
            [0.02, 0.01],
          ],
        },
        construction: false,
        intent: "fulfill",
        as: "curve",
      },
      {
        operation: "sketch.geometry.update",
        basis: { alias: "curve" },
        draft: { alias: "curve" },
        edit: {
          kind: "mergePoints",
          target: { alias: "curve", label: "Spline 1 point 4" },
          destination: { alias: "curve", label: "Missing point" },
        },
        intent: "fulfill",
        as: "closed",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "closed" },
        draft: { alias: "closed" },
        requireProfiles: true,
      },
    ].map((command, index) => ({
      version: 1,
      commandId: `merge-refusal-${index}`,
      ...command,
    }));
    const path = resolve(directory, "recipe.json");
    const run = async (recipe: unknown) => {
      await writeFile(path, JSON.stringify(recipe));
      return promisify(execFile)(
        "bun",
        ["src/cli/main.ts", "document", "recipe", path],
        {
          cwd: resolve(import.meta.dirname, "../.."),
          timeout: 90_000,
        },
      ).then(
        () => {
          throw new Error("Expected refusal.");
        },
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
    };
    const missing = await run({ version: 1, operations });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("missing or ambiguous");
    const envelope = JSON.parse(missing.stdout);
    expect(
      envelope.results.map((r: SemanticResult) => r.correlation.commandId),
    ).toEqual(["merge-refusal-0", "merge-refusal-1", "merge-refusal-2"]);
    expect(envelope.unexecuted).toEqual(["merge-refusal-3", "merge-refusal-4"]);
    for (const field of ["target", "destination"] as const) {
      const unknown = await run({
        version: 1,
        operations: operations.map((o) =>
          o.operation === "sketch.geometry.update"
            ? {
                ...o,
                edit: {
                  ...o.edit,
                  [field]: { alias: "unknown", label: "Missing point" },
                },
              }
            : o,
        ),
      });
      expect(unknown.code).toBe(2);
      expect(unknown.stdout).toBe("");
      expect(unknown.stderr).toContain("Unknown or ambiguous target alias");
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
