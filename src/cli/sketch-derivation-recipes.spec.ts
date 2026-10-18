import { expect, test } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

test("real Bun recipes create all three durable derivations through discovered seed aliases with clean JSON and failure policy", async () => {
  const primitive = { kind: "circle", center: [4, 3], radius: 2 };
  const w = await createSketchWorkflow();
  let label: string;
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive,
      construction: false,
      intent: "fulfill",
    });
    label = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.label;
  } finally {
    await w.close();
  }
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-derivation-"));
  const commands: Record<string, unknown>[] = [
    {
      operation: "document.create",
      label: "Derivations",
      basis: null,
      as: "document",
    },
    {
      operation: "sketch.begin",
      basis: { alias: "document" },
      plane: "xy",
      as: "draft",
    },
    {
      operation: "sketch.author",
      basis: { alias: "draft" },
      draft: { alias: "draft" },
      primitive,
      construction: false,
      intent: "fulfill",
      as: "circle",
    },
    {
      operation: "sketch.derivation.create",
      basis: { alias: "circle" },
      draft: { alias: "circle" },
      kind: "linearPattern",
      targets: [{ alias: "circle", label }],
      value: 10,
      intent: "fulfill",
      as: "linear",
    },
    {
      operation: "sketch.derivation.create",
      basis: { alias: "linear" },
      draft: { alias: "linear" },
      kind: "circularPattern",
      targets: [{ alias: "circle", label }],
      value: Math.PI / 2,
      intent: "fulfill",
      as: "circular",
    },
    {
      operation: "sketch.derivation.create",
      basis: { alias: "circular" },
      draft: { alias: "circular" },
      kind: "transform",
      targets: [{ alias: "circle", label }],
      value: 20,
      intent: "fulfill",
      as: "transformed",
    },
    {
      operation: "sketch.publish",
      basis: { alias: "transformed" },
      draft: { alias: "transformed" },
      requireProfiles: true,
    },
  ].map((c, i) => ({ version: 1, commandId: `derivation-${i}`, ...c }));
  async function invoke(operations: Record<string, unknown>[]) {
    const path = resolve(dir, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    try {
      return {
        code: 0,
        ...(await promisify(execFile)(
          "bun",
          [cliEntry(), "document", "recipe", path],
          { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
        )),
      };
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string };
    }
  }
  try {
    const success = await invoke(commands);
    expect(success.code, success.stderr).toBe(0);
    const results: SemanticResult[] = JSON.parse(success.stdout).results;
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      commands.map((c) => c.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    const ds = results[5]!.discovery!.sketch!.derivations;
    expect(ds.map((d) => d.definition.kind)).toEqual([
      "linearPattern",
      "circularPattern",
      "transform",
    ]);
    for (const [i, position] of [
      [0, [14, 3]],
      [1, [-3, 4]],
      [2, [24, 3]],
    ] as const) {
      expect(ds[i]!.currentGeometry![0]!.points[0]!.position[0]).toBeCloseTo(
        position[0],
        7,
      );
      expect(ds[i]!.currentGeometry![0]!.points[0]!.position[1]).toBeCloseTo(
        position[1],
        7,
      );
      expect(ds[i]!.currentGeometry![0]!.radius).toBe(2);
    }
    expect(results[5]!.discovery!.history!.undoEntries!).toHaveLength(
      results[2]!.discovery!.history!.undoEntries!.length + 3,
    );
    expect(results[6]!.discovery!.sketch!.profiles).toHaveLength(4);
    const missing = await invoke(
      commands.map((c, i) =>
        i === 3
          ? { ...c, targets: [{ alias: "circle", label: "absent seed" }] }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    const output = JSON.parse(missing.stdout);
    expect(output.results).toHaveLength(3);
    expect(output.unexecuted).toEqual(
      commands.slice(3).map((c) => c.commandId),
    );
    for (const index of [3, 4, 5]) {
      const unknown = await invoke(
        commands.map((c, i) =>
          i === index ? { ...c, targets: [{ alias: "unknown", label }] } : c,
        ),
      );
      expect(unknown.code).toBe(2);
      expect(unknown.stdout).toBe("");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
