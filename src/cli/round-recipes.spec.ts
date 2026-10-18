import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";

it("runs circle and tangent-source authoring by discovered labels with clean correlated JSON and real native bounds", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-round-recipe-"));
  try {
    const operations = [
      { operation: "document.create", label: "Round", basis: null, as: "part" },
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
        primitive: { kind: "circle", center: [20, 20], radius: 3 },
        construction: false,
        intent: "fulfill",
        as: "circle",
      },
      {
        operation: "sketch.author",
        basis: { alias: "circle" },
        draft: { alias: "circle" },
        primitive: { kind: "line", start: [-3, 0], end: [0, 0] },
        construction: false,
        intent: "fulfill",
        as: "source",
      },
      {
        operation: "sketch.author",
        basis: { alias: "source" },
        draft: { alias: "source" },
        primitive: {
          kind: "tangentArc",
          start: [0, 0],
          direction: [1, 0],
          end: [3, 3],
          source: { alias: "source", label: "Line 2" },
        },
        construction: true,
        intent: "fulfill",
        as: "arc",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "arc" },
        draft: { alias: "arc" },
        requireProfiles: true,
        as: "published",
      },
      {
        operation: "extrude.create",
        basis: { alias: "published" },
        profile: { alias: "published", label: "Outer region" },
        depth: 4,
        intent: "fulfill",
      },
    ].map((command, index) => ({
      version: 1,
      commandId: `round-${index}`,
      ...command,
    }));
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    const output = await promisify(execFile)(
      "bun",
      [cliEntry(), "document", "recipe", path],
      { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
    ).catch((error: unknown) => {
      const failed = error as { stdout?: string; stderr?: string };
      throw new Error(
        JSON.stringify({ stdout: failed.stdout, stderr: failed.stderr }),
      );
    });
    const results: SemanticResult[] = JSON.parse(output.stdout).results;
    expect(results).toHaveLength(7);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      operations.map((o) => o.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    expect(
      results[4]!.discovery!.references.filter(
        (r) => r.target.kind === "constraint",
      ),
    ).toHaveLength(2);
    expect(results[6]!.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [17, 17, 0],
      max: [23, 23, 4],
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);

it("refuses unknown and missing tangent-source aliases without inventing a source or executing later commands", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-round-refusal-"));
  try {
    const operations = [
      { operation: "document.create", label: "Round", basis: null, as: "part" },
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
          kind: "tangentArc",
          start: [0, 0],
          direction: [1, 0],
          end: [3, 3],
          source: { alias: "draft", label: "Missing curve" },
        },
        construction: false,
        intent: "fulfill",
        as: "arc",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "arc" },
        draft: { alias: "arc" },
        requireProfiles: false,
      },
    ].map((command, index) => ({
      version: 1,
      commandId: `refusal-${index}`,
      ...command,
    }));
    const path = resolve(directory, "recipe.json");
    const run = async (recipe: unknown) => {
      await writeFile(path, JSON.stringify(recipe));
      return promisify(execFile)(
        "bun",
        [cliEntry(), "document", "recipe", path],
        { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
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
    ).toEqual(["refusal-0", "refusal-1"]);
    expect(envelope.unexecuted).toEqual(["refusal-2", "refusal-3"]);
    const unknown = await run({
      version: 1,
      operations: operations.map((o) =>
        o.operation === "sketch.author"
          ? {
              ...o,
              primitive: {
                ...o.primitive,
                source: { alias: "unknown", label: "Missing curve" },
              },
            }
          : o,
      ),
    });
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toContain("Unknown or ambiguous target alias");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
