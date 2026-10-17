import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real production Bun sweep recipes resolve explicit face/path/feature aliases and preserve geometry and exits", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-sweeps-"));
  const a = (alias: string) => ({ alias });
  const prefix: Record<string, unknown>[] = [
    { operation: "document.create", label: "Sweep", basis: null, as: "part" },
    { operation: "sketch.begin", plane: "xy", basis: a("part"), as: "draft" },
    {
      operation: "sketch.author",
      basis: a("draft"),
      draft: a("draft"),
      primitive: { kind: "rectangle", start: [0, 0], end: [2, 1] },
      construction: false,
      intent: "fulfill",
      as: "rectangle",
    },
    {
      operation: "sketch.publish",
      basis: a("rectangle"),
      draft: a("rectangle"),
      requireProfiles: true,
      as: "profile",
    },
    {
      operation: "extrude.create",
      basis: a("profile"),
      profile: { alias: "profile", label: "Outer region" },
      depth: 10,
      intent: "fulfill",
      as: "tool",
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
          commandId: `sweeps-${i}`,
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
    const probe = await invoke(prefix);
    expect(probe.code, probe.stderr + probe.stdout).toBe(0);
    const seeded: SemanticResult[] = JSON.parse(probe.stdout).results;
    const discovered = seeded[4]!.discovery!;
    const topology = discovered.model!.bodies[0]!.topology!;
    const path = topology.find(
      (t) =>
        t.entityClass === "edge" &&
        t.boundingBox &&
        Math.abs(t.boundingBox.low[0]) < 1e-5 &&
        Math.abs(t.boundingBox.high[0]) < 1e-5 &&
        Math.abs(t.boundingBox.low[1]) < 1e-5 &&
        Math.abs(t.boundingBox.high[1]) < 1e-5 &&
        t.boundingBox.high[2] - t.boundingBox.low[2] > 9.99,
    )!.reference;
    const face = topology.find(
      (t) =>
        t.entityClass === "face" &&
        t.geometryType === "plane" &&
        t.boundingBox &&
        Math.abs(t.boundingBox.low[2]) < 1e-5 &&
        Math.abs(t.boundingBox.high[2]) < 1e-5,
    )!.reference;
    const label = (target: typeof path) =>
      discovered.references.find(
        (r) => JSON.stringify(r.target) === JSON.stringify(target),
      )!.label;
    const edgeLabel = label(path);
    const participants = [
      { role: "profile", targets: [{ alias: "tool", label: label(face) }] },
      { role: "path", targets: [{ alias: "tool", label: edgeLabel }] },
    ];
    const options = {
      profileControl: "none",
      twist: { type: "none" },
      endScale: 1,
    };
    const commands = [
      ...prefix,
      {
        operation: "sweep.create",
        basis: a("tool"),
        parameters: { participants, options },
        intent: "fulfill",
        as: "swept",
      },
      {
        operation: "sweep.update",
        basis: a("swept"),
        featureId: { alias: "swept", label: "Sweep 1" },
        parameters: {
          participants,
          options: {
            ...options,
            twist: { type: "angle", angle: Math.PI / 6 },
            endScale: 2,
          },
        },
        intent: "fulfill",
      },
    ];
    const success = await invoke(commands);
    expect(success.code, success.stderr + success.stdout).toBe(0);
    const output = JSON.parse(success.stdout);
    expect(output.cleanup.kind).toBe("closed");
    expect(output.results).toHaveLength(commands.length);
    for (const [i, result] of (output.results as SemanticResult[]).entries()) {
      expect(result.correlation.commandId).toBe(`sweeps-${i}`);
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    for (const [i, scale, angle] of [
      [5, 1, 0],
      [6, 2, Math.PI / 6],
    ] as const) {
      const result = output.results[i] as SemanticResult;
      const model = result.discovery!.model!;
      const feature = model.features.find((f) => f.kind === "sweep")!;
      const target = feature.producedTargets.find((t) => t.kind === "body")!;
      if (target.kind !== "body") throw new Error("Missing sweep body");
      const body = model.bodies.find((b) => b.bodyId === target.bodyId)!;
      expect(body.bodyId).not.toBe(discovered.model!.bodies[0]!.bodyId);
      const vertices = body.topology!.filter((t) => t.entityClass === "vertex");
      for (const x of [0, 2])
        for (const y of [0, 1]) {
          const expected = [
            scale * (x * Math.cos(angle) - y * Math.sin(angle)),
            scale * (x * Math.sin(angle) + y * Math.cos(angle)),
            10,
          ];
          expect(
            vertices.some((t) =>
              expected.every(
                (v, j) => Math.abs(t.boundingBox!.low[j]! - v) < 1e-5,
              ),
            ),
            JSON.stringify({ expected, vertices }),
          ).toBe(true);
        }
    }
    const missing = await invoke([
      ...prefix,
      {
        ...commands[5],
        parameters: {
          participants: [
            participants[0],
            {
              role: "path",
              targets: [{ alias: "tool", label: "Missing edge" }],
            },
          ],
          options,
        },
      },
      commands[6]!,
    ]);
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.results).toHaveLength(prefix.length);
    expect(failed.unexecuted).toEqual(["sweeps-5", "sweeps-6"]);
    expect(failed.cleanup.kind).toBe("closed");
    const unknown = await invoke([
      ...prefix,
      {
        ...commands[5],
        parameters: {
          participants: [
            participants[0],
            { role: "path", targets: [{ alias: "unknown", label: edgeLabel }] },
          ],
          options,
        },
      },
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
