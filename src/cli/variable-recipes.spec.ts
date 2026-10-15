import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

test("real Bun variable recipes resolve discovered identities, rebuild expressions and enforce failure/usage exits", async () => {
  const w = await createSketchWorkflow();
  let regionLabel: string;
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const pub = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    regionLabel = pub.discovery!.references.find(
      (r) => r.target.kind === "region",
    )!.label;
  } finally {
    await w.close();
  }
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-variable-recipes-"));
  const commands: Record<string, unknown>[] = [
    {
      operation: "document.create",
      basis: null,
      label: "Variables",
      as: "doc",
    },
    {
      operation: "variable.add",
      basis: { alias: "doc" },
      name: "height",
      valueText: "3 + 4",
      intent: "fulfill",
      as: "height",
    },
    {
      operation: "sketch.begin",
      basis: { alias: "height" },
      plane: "xy",
      as: "draft",
    },
    {
      operation: "sketch.author",
      basis: { alias: "draft" },
      draft: { alias: "draft" },
      primitive: { kind: "circle", center: [0, 0], radius: 2 },
      construction: false,
      intent: "fulfill",
      as: "circle",
    },
    {
      operation: "sketch.publish",
      basis: { alias: "circle" },
      draft: { alias: "circle" },
      requireProfiles: true,
      as: "published",
    },
    {
      operation: "extrude.create",
      basis: { alias: "published" },
      profile: { alias: "published", label: regionLabel },
      depth: "height",
      intent: "fulfill",
      as: "solid",
    },
    {
      operation: "variable.update",
      basis: { alias: "solid" },
      variableId: { alias: "height", label: "height" },
      name: "height",
      valueText: "9",
      intent: "fulfill",
      as: "rebuilt",
    },
    { operation: "document.inspect", basis: { alias: "rebuilt" } },
  ].map((c, i) => ({ version: 1, commandId: `variable-${i}`, ...c }));
  async function invoke(operations: Record<string, unknown>[]) {
    const path = resolve(dir, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    try {
      return {
        code: 0,
        ...(await promisify(execFile)(
          "bun",
          ["src/cli/main.ts", "document", "recipe", path],
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
    expect(results[5]!.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      2, 2, 7,
    ]);
    expect(results[6]!.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      2, 2, 9,
    ]);
    expect(results[7]!.discovery!.variables![0]!.variableId).toBe(
      results[1]!.discovery!.variables![0]!.variableId,
    );
    const missing = await invoke(
      commands.map((c, i) =>
        i === 6
          ? { ...c, variableId: { alias: "height", label: "missing" } }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    const output = JSON.parse(missing.stdout);
    expect(output.results).toHaveLength(6);
    expect(output.unexecuted).toEqual(
      commands.slice(6).map((c) => c.commandId),
    );
    const unknown = await invoke(
      commands.map((c, i) =>
        i === 6
          ? { ...c, variableId: { alias: "unknown", label: "height" } }
          : c,
      ),
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
