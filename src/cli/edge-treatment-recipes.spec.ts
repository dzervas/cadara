import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real production Bun recipes resolve durable edge and feature aliases for fillet/chamfer updates and report alias failures", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-edge-treatment-"));
  const alias = (alias: string) => ({ alias });
  const prefix: Record<string, unknown>[] = [
    {
      operation: "document.create",
      label: "Edge treatments",
      basis: null,
      as: "part",
    },
    {
      operation: "sketch.begin",
      basis: alias("part"),
      plane: "xy",
      as: "draft",
    },
    {
      operation: "sketch.author",
      basis: alias("draft"),
      draft: alias("draft"),
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
      as: "rectangle",
    },
    {
      operation: "sketch.publish",
      basis: alias("rectangle"),
      draft: alias("rectangle"),
      requireProfiles: true,
      as: "published",
    },
    {
      operation: "extrude.create",
      basis: alias("published"),
      profile: { alias: "published", label: "Outer region" },
      depth: 10,
      intent: "fulfill",
      as: "solid",
    },
  ];
  async function invoke(commands: readonly Record<string, unknown>[]) {
    const path = resolve(dir, "recipe.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        operations: commands.map((c, i) => ({
          version: 1,
          commandId: `edges-${i}`,
          ...c,
        })),
      }),
    );
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
    const seed = await invoke(prefix);
    expect(seed.code, seed.stderr + seed.stdout).toBe(0);
    const discovered: SemanticResult = JSON.parse(seed.stdout).results[4];
    const edge = discovered.discovery!.model!.bodies[0]!.topology!.find(
      (s) =>
        s.entityClass === "edge" &&
        s.boundingBox &&
        Math.abs(s.boundingBox.high[0]) < 1e-5 &&
        Math.abs(s.boundingBox.high[1]) < 1e-5 &&
        s.boundingBox.high[2] - s.boundingBox.low[2] > 9.99,
    )!.reference;
    const label = discovered.discovery!.references.find(
      (r) => JSON.stringify(r.target) === JSON.stringify(edge),
    )!.label;
    const target = { alias: "solid", label };
    const participants = [{ role: "edge", targets: [target] }];
    const commands = [
      ...prefix,
      {
        operation: "fillet.create",
        basis: alias("solid"),
        parameters: {
          edgeTargets: [target],
          radius: { source: "literal", value: 1 },
        },
        intent: "fulfill",
        as: "rounded",
      },
      {
        operation: "fillet.update",
        basis: alias("rounded"),
        featureId: { alias: "rounded", label: "Fillet 1" },
        parameters: {
          edgeTargets: [target],
          radius: { source: "literal", value: 2 },
        },
        intent: "fulfill",
        as: "updated",
      },
      {
        operation: "feature.delete",
        basis: alias("updated"),
        featureId: { alias: "updated", label: "Fillet 1" },
        intent: "fulfill",
        as: "restored",
      },
      {
        operation: "chamfer.create",
        basis: alias("restored"),
        parameters: {
          participants,
          options: { widthForm: "twoOffsets", distance1: 1, distance2: 2 },
        },
        intent: "fulfill",
        as: "beveled",
      },
      {
        operation: "chamfer.update",
        basis: alias("beveled"),
        featureId: { alias: "beveled", label: "Chamfer 1" },
        parameters: {
          participants,
          options: { widthForm: "offsetAngle", distance: 2, angle: 45 },
        },
        intent: "fulfill",
      },
    ];
    const success = await invoke(commands);
    expect(success.code, success.stderr + success.stdout).toBe(0);
    const output = JSON.parse(success.stdout);
    expect(output.cleanup.kind).toBe("closed");
    expect(output.unexecuted).toEqual([]);
    const results: SemanticResult[] = output.results;
    expect(results).toHaveLength(commands.length);
    results.forEach((r, i) => {
      expect(r.correlation.commandId).toBe(`edges-${i}`);
      expect(r.outcome.kind).toBe("completed");
      expect(validateSemanticResult(r.correlation, r).success).toBe(true);
    });
    for (const [index, radius] of [
      [5, 1],
      [6, 2],
    ] as const) {
      const cylinder = results[
        index
      ]!.discovery!.model!.bodies[0]!.topology!.find(
        (s) => s.entityClass === "face" && s.geometryType === "cylinder",
      )!;
      expect(cylinder.definingData!.radius).toBeCloseTo(radius, 5);
    }
    for (const [index, offsets] of [
      [8, [1, 2]],
      [9, [2, 2]],
    ] as const) {
      const bevel = results[index]!.discovery!.model!.bodies[0]!.topology!.find(
        (s) =>
          s.entityClass === "face" &&
          s.geometryType === "plane" &&
          Math.abs((s.definingData!.normal as number[])[0]!) > 1e-5 &&
          Math.abs((s.definingData!.normal as number[])[1]!) > 1e-5,
      )!;
      const spans = [0, 1]
        .map((i) => bevel.boundingBox!.high[i]! - bevel.boundingBox!.low[i]!)
        .sort((a, b) => a - b);
      spans.forEach((n, i) => expect(n).toBeCloseTo(offsets[i]!, 5));
    }
    const missing = await invoke(
      commands.map((c, i) =>
        i === 5
          ? {
              ...c,
              parameters: {
                edgeTargets: [{ alias: "solid", label: "Missing edge" }],
                radius: { source: "literal", value: 1 },
              },
            }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.results).toHaveLength(5);
    expect(failed.unexecuted).toEqual([
      "edges-5",
      "edges-6",
      "edges-7",
      "edges-8",
      "edges-9",
    ]);
    expect(failed.cleanup.kind).toBe("closed");
    const unknown = await invoke(
      commands.map((c, i) =>
        i === 5
          ? {
              ...c,
              parameters: {
                edgeTargets: [{ alias: "unknown", label }],
                radius: { source: "literal", value: 1 },
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
