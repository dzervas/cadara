import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real Bun shell/thicken recipes resolve current body/face aliases, update geometry, and retain exact alias failure policy", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-shell-thicken-"));
  const a = (alias: string) => ({ alias });
  const lit = <T>(value: T) => ({ source: "literal", value });
  const prefix: Record<string, unknown>[] = [
    {
      operation: "document.create",
      label: "Shell thicken",
      basis: null,
      as: "part",
    },
    { operation: "sketch.begin", plane: "xy", basis: a("part"), as: "draft" },
    {
      operation: "sketch.author",
      basis: a("draft"),
      draft: a("draft"),
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
      as: "rectangle",
    },
    {
      operation: "sketch.publish",
      basis: a("rectangle"),
      draft: a("rectangle"),
      requireProfiles: true,
      as: "published",
    },
    {
      operation: "extrude.create",
      basis: a("published"),
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
          commandId: `shell-${i}`,
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
    const body = discovered.discovery!.model!.bodies[0]!;
    const top = body.topology!.find(
      (t) =>
        t.entityClass === "face" &&
        t.boundingBox &&
        Math.abs(t.boundingBox.low[2] - 10) < 1e-5,
    )!.reference;
    const face = {
      alias: "solid",
      label: discovered.discovery!.references.find(
        (r) => JSON.stringify(r.target) === JSON.stringify(top),
      )!.label,
    };
    const bodyTarget = {
      alias: "solid",
      label: discovered.discovery!.references.find(
        (r) => r.target.kind === "body" && r.target.bodyId === body.bodyId,
      )!.label,
    };
    const shell = {
      mode: "closedHollow",
      bodyTarget,
      faceTargets: [],
      direction: "inside",
      thickness: lit(1),
      operation: lit("newBody"),
      booleanScope: { kind: "standalone" },
    };
    const thicken = {
      participants: [{ role: "face", targets: [face] }],
      options: {
        thickness: lit(1),
        side: lit("oneSide"),
        direction: "positive",
      },
    };
    const commands = [
      ...prefix,
      {
        operation: "shell.create",
        basis: a("solid"),
        parameters: shell,
        intent: "fulfill",
        as: "hollow",
      },
      {
        operation: "shell.update",
        basis: a("hollow"),
        featureId: { alias: "hollow", label: "Shell 1" },
        parameters: { ...shell, thickness: lit(2) },
        intent: "fulfill",
        as: "updated",
      },
      {
        operation: "feature.delete",
        basis: a("updated"),
        featureId: { alias: "updated", label: "Shell 1" },
        intent: "fulfill",
        as: "restored",
      },
      {
        operation: "thicken.create",
        basis: a("restored"),
        parameters: thicken,
        intent: "fulfill",
        as: "thick",
      },
      {
        operation: "thicken.update",
        basis: a("thick"),
        featureId: { alias: "thick", label: "Thicken 1" },
        parameters: {
          ...thicken,
          options: { ...thicken.options, thickness: lit(3) },
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
      expect(result.correlation.commandId).toBe(`shell-${i}`);
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
      expect(result.outcome.kind).toBe("completed");
    }
    const cavity: SemanticResult = output.results[6];
    const inner = cavity.discovery!.model!.bodies[0]!.topology!.filter(
      (t) => t.entityClass === "face" && t.geometryType === "plane",
    );
    expect(inner).toHaveLength(12);
    expect(
      inner.some(
        (t) =>
          Math.abs((t.definingData!.normal as number[])[0]!) > 0.999 &&
          Math.abs(t.boundingBox!.low[0] - 2) < 1e-5 &&
          Math.abs(t.boundingBox!.high[0] - 2) < 1e-5,
      ),
    ).toBe(true);
    const final: SemanticResult = output.results[9];
    expect(
      final
        .discovery!.model!.bodies.flatMap((b) => b.topology ?? [])
        .some(
          (t) =>
            t.entityClass === "face" &&
            t.geometryType === "plane" &&
            Math.abs((t.definingData!.normal as number[])[2]!) > 0.999 &&
            Math.abs(t.boundingBox!.low[2] - 13) < 1e-5 &&
            Math.abs(t.boundingBox!.high[2] - 13) < 1e-5,
        ),
    ).toBe(true);
    const missing = await invoke([
      ...prefix,
      {
        ...commands[5],
        parameters: {
          ...shell,
          bodyTarget: { alias: "solid", label: "missing body" },
        },
      },
      commands[6]!,
    ]);
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.cleanup.kind).toBe("closed");
    expect(failed.results).toHaveLength(prefix.length);
    const unknown = await invoke([
      ...prefix,
      {
        ...commands[5],
        parameters: {
          ...shell,
          bodyTarget: { alias: "unknown", label: bodyTarget.label },
        },
      },
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
