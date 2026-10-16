import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real Bun revolves resolve profile/axis/feature aliases, update native sheets and preserve JSON and exit policy", async () => {
  const w = await createSketchWorkflow();
  let profileLabel: string;
  let axisLabel: string;
  const primitives = [
    { kind: "line", start: [2, 0], end: [2, 10] },
    { kind: "line", start: [0, 0], end: [0, 10] },
  ];
  try {
    for (const [i, primitive] of primitives.entries())
      await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive,
        construction: i === 1,
        intent: "fulfill",
      });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: false,
    });
    const sketch = published.discovery!.sketch!;
    function label(construction: boolean) {
      const entityId = sketch.entities.find(
        (e) => e.construction === construction,
      )!.entityId;
      return published.discovery!.references.find(
        (r) =>
          r.target.kind === "sketchEntity" && r.target.entityId === entityId,
      )!.label;
    }
    profileLabel = label(false);
    axisLabel = label(true);
  } finally {
    await w.close();
  }
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-revolve-"));
  const basis = (alias: string) => ({ alias });
  const parameters = {
    resultBodyType: "surface",
    profiles: [{ alias: "published", label: profileLabel }],
    axis: { alias: "published", label: axisLabel },
    startAngle: { source: "literal", value: 0 },
    extent: { mode: "oneSide", end: { kind: "full" } },
  };
  const commands = [
    { operation: "document.create", label: "Revolve", basis: null, as: "part" },
    {
      operation: "sketch.begin",
      basis: basis("part"),
      plane: "xy",
      as: "draft",
    },
    ...primitives.map((primitive, i) => ({
      operation: "sketch.author",
      basis: basis(i === 0 ? "draft" : "curve"),
      draft: basis(i === 0 ? "draft" : "curve"),
      primitive,
      construction: i === 1,
      intent: "fulfill",
      as: i === 0 ? "curve" : "axis",
    })),
    {
      operation: "sketch.publish",
      basis: basis("axis"),
      draft: basis("axis"),
      requireProfiles: false,
      as: "published",
    },
    {
      operation: "revolve.create",
      basis: basis("published"),
      parameters,
      intent: "fulfill",
      as: "sheet",
    },
    {
      operation: "revolve.update",
      basis: basis("sheet"),
      featureId: { alias: "sheet", label: "Revolve 1" },
      parameters: {
        ...parameters,
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "clockwise",
            angle: { source: "literal", value: Math.PI / 2 },
          },
        },
      },
      intent: "fulfill",
    },
  ].map((command, i) => ({
    version: 1,
    commandId: `revolve-${i}`,
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
    const full = results[5]!.discovery!.model!.bodies[0]!;
    const quarter = results[6]!.discovery!.model!.bodies[0]!;
    expect(full.kind).toBe("sheet");
    expect(quarter.kind).toBe("sheet");
    for (const [i, value] of [-2, 0, -2].entries())
      expect(full.bounds!.min[i]).toBeCloseTo(value, 5);
    for (const [i, value] of [2, 10, 2].entries())
      expect(full.bounds!.max[i]).toBeCloseTo(value, 5);
    for (const value of quarter.bounds!.min) expect(value).toBeCloseTo(0, 5);
    for (const [i, value] of [2, 10, 2].entries())
      expect(quarter.bounds!.max[i]).toBeCloseTo(value, 5);
    const missing = await invoke(
      commands.map((c, i) =>
        i === 5
          ? {
              ...c,
              parameters: {
                ...parameters,
                axis: { alias: "published", label: "Missing axis" },
              },
            }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    const failure = JSON.parse(missing.stdout);
    expect(failure.results).toHaveLength(5);
    expect(failure.unexecuted).toEqual(["revolve-5", "revolve-6"]);
    expect(failure.cleanup.kind).toBe("closed");
    const unknown = await invoke(
      commands.map((c, i) =>
        i === 5
          ? {
              ...c,
              parameters: {
                ...parameters,
                axis: { alias: "unknown", label: axisLabel },
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
