import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real production Bun recipes create and edit canonical sheet extents with exact profile aliases and shell failure policy", async () => {
  const w = await createSketchWorkflow();
  let label: string;
  try {
    const line = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: line.discovery!.state.draft,
      requireProfiles: false,
    });
    label = published.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.label;
  } finally {
    await w.close();
  }
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-extrusion-variants-"));
  const basis = (alias: string) => ({ alias });
  const profile = { alias: "published", label };
  const parameters = {
    resultBodyType: "surface",
    profiles: [profile],
    startExtent: {
      kind: "blindOffset",
      distance: { source: "literal", value: 2 },
      direction: "positive",
    },
    extent: {
      mode: "oneSide",
      end: {
        kind: "blind",
        direction: "positive",
        distance: { source: "literal", value: 5 },
      },
    },
  };
  const commands = [
    { operation: "document.create", label: "Sheet", basis: null, as: "part" },
    {
      operation: "sketch.begin",
      basis: basis("part"),
      plane: "xy",
      as: "draft",
    },
    {
      operation: "sketch.author",
      basis: basis("draft"),
      draft: basis("draft"),
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
      as: "line",
    },
    {
      operation: "sketch.publish",
      basis: basis("line"),
      draft: basis("line"),
      requireProfiles: false,
      as: "published",
    },
    {
      operation: "extrude.create",
      basis: basis("published"),
      parameters,
      intent: "fulfill",
      as: "sheet",
    },
    {
      operation: "extrude.update",
      basis: basis("sheet"),
      featureId: { alias: "sheet", label: "Extrude 1" },
      parameters: {
        ...parameters,
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: { source: "literal", value: 9 },
          },
        },
      },
      intent: "fulfill",
    },
  ].map((command, i) => ({
    version: 1,
    commandId: `variant-${i}`,
    ...command,
  }));
  async function invoke(operations: readonly Record<string, unknown>[]) {
    const path = resolve(dir, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    try {
      return {
        code: 0,
        ...(await promisify(execFile)(
          "bun",
          ["src/cli/main.ts", "document", "recipe", path],
          {
            cwd: resolve(import.meta.dirname, "../.."),
            timeout: 90000,
            env: { ...process.env, NODE_ENV: "production", TEST: "false" },
          },
        )),
      };
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string };
    }
  }
  try {
    const success = await invoke(commands);
    expect(success.code, success.stderr + success.stdout).toBe(0);
    const output = JSON.parse(success.stdout);
    expect(output.cleanup.kind).toBe("closed");
    expect(output.unexecuted).toEqual([]);
    const results: SemanticResult[] = output.results;
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      commands.map((c) => c.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    expect(results[4]!.discovery!.model!.bodies[0]).toMatchObject({
      kind: "sheet",
      bounds: { min: [0, 0, 2], max: [10, 0, 7] },
    });
    expect(results[5]!.discovery!.model!.bodies[0]).toMatchObject({
      kind: "sheet",
      bounds: { min: [0, 0, 2], max: [10, 0, 11] },
    });
    const missing = await invoke(
      commands.map((c, i) =>
        i === 4
          ? {
              ...c,
              parameters: {
                ...parameters,
                profiles: [{ alias: "published", label: "Missing curve" }],
              },
            }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    const failure = JSON.parse(missing.stdout);
    expect(failure.results).toHaveLength(4);
    expect(failure.unexecuted).toEqual(["variant-4", "variant-5"]);
    expect(failure.cleanup.kind).toBe("closed");
    const unknown = await invoke(
      commands.map((c, i) =>
        i === 4
          ? {
              ...c,
              parameters: {
                ...parameters,
                profiles: [{ alias: "unknown", label }],
              },
            }
          : c,
      ),
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
