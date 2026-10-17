import { expect, test } from "vitest";
import { invokeCliRecipe } from "../../test/helpers/cli-recipe-process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real production Bun recipes create and update body copies through exact body, construction and feature aliases", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-body-copies-"));
  const a = (alias: string) => ({ alias });
  const prefix: Record<string, unknown>[] = [
    { operation: "document.create", label: "Copies", basis: null, as: "part" },
    { operation: "sketch.begin", plane: "xy", basis: a("part"), as: "draft" },
    {
      operation: "sketch.author",
      basis: a("draft"),
      draft: a("draft"),
      primitive: { kind: "rectangle", start: [0, 1], end: [2, 4] },
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
      depth: 5,
      intent: "fulfill",
      as: "seed",
    },
  ];
  function invoke(commands: readonly Record<string, unknown>[]) {
    return invokeCliRecipe(
      dir,
      commands.map((c, i) => ({ version: 1, commandId: `copies-${i}`, ...c })),
      {
        cwd: resolve(import.meta.dirname, "../.."),
        timeout: 90000,
        env: { ...process.env, NODE_ENV: "production", TEST: "false" },
      },
    );
  }
  try {
    const probe = await invoke(prefix);
    expect(probe.code, probe.stderr + probe.stdout).toBe(0);
    const d: SemanticResult = JSON.parse(probe.stdout).results.at(-1);
    const references = d.discovery!.references;
    const body = references.find((r) => r.target.kind === "body")!;
    const plane = references.find(
      (r) =>
        r.target.kind === "construction" &&
        r.target.constructionId === "construction_plane-xy",
    )!;
    const target = { alias: "seed", label: body.label };
    const reference = { alias: "seed", label: plane.label };
    const seed = { role: "body", targets: [target] };
    const commands: Record<string, unknown>[] = [...prefix];
    function add(
      operation: string,
      basis: string,
      parameters: unknown,
      as: string,
      featureId?: unknown,
    ) {
      commands.push({
        operation,
        basis: a(basis),
        parameters,
        intent: "fulfill",
        as,
        ...(featureId ? { featureId } : {}),
      });
    }
    function remove(basis: string, label: string, as: string) {
      commands.push({
        operation: "feature.delete",
        basis: a(basis),
        featureId: { alias: basis, label },
        intent: "fulfill",
        as,
      });
    }
    const mirror = {
      participants: [seed, { role: "plane", targets: [reference] }],
      options: { copy: true },
    };
    add("mirror.create", "seed", mirror, "mirror");
    add(
      "mirror.update",
      "mirror",
      {
        ...mirror,
        participants: [
          ...mirror.participants,
          { role: "targetBody", targets: [target] },
        ],
        operationIntent: { source: "literal", value: "add" },
      },
      "merged",
      { alias: "mirror", label: "Mirror 1" },
    );
    remove("merged", "Mirror 1", "restored");
    add(
      "transform.create",
      "restored",
      {
        participants: [seed, { role: "axis", targets: [reference] }],
        options: { transformType: "rotation", angle: 90 },
      },
      "rotated",
    );
    add(
      "transform.update",
      "rotated",
      { participants: [seed], options: { vector: [3, -2, 7] } },
      "translated",
      { alias: "rotated", label: "Transform 1" },
    );
    remove("translated", "Transform 1", "restored2");
    const linear = {
      participants: [seed, { role: "direction", targets: [reference] }],
      options: { instanceCount: 3, spacing: 7, oppositeDirection: false },
    };
    add("linearPattern.create", "restored2", linear, "linear");
    add(
      "linearPattern.update",
      "linear",
      {
        ...linear,
        options: {
          ...linear.options,
          instanceCount: 2,
          oppositeDirection: true,
        },
      },
      "linearUpdated",
      { alias: "linear", label: "LinearPattern 1" },
    );
    remove("linearUpdated", "LinearPattern 1", "restored3");
    const circular = {
      participants: [seed, { role: "axis", targets: [reference] }],
      options: {
        instanceCount: 3,
        angleDegrees: 180,
        equalSpace: true,
        oppositeDirection: false,
      },
    };
    add("circularPattern.create", "restored3", circular, "circular");
    add(
      "circularPattern.update",
      "circular",
      {
        ...circular,
        options: {
          ...circular.options,
          instanceCount: 2,
          angleDegrees: 90,
          oppositeDirection: true,
        },
      },
      "last",
      { alias: "circular", label: "CircularPattern 1" },
    );
    const run = await invoke(commands);
    expect(run.code, run.stderr + run.stdout).toBe(0);
    const output = JSON.parse(run.stdout);
    const results: SemanticResult[] = output.results;
    expect(output.cleanup.kind).toBe("closed");
    expect(results).toHaveLength(commands.length);
    for (const [i, r] of results.entries()) {
      expect(r.correlation.commandId).toBe(`copies-${i}`);
      expect(r.outcome.kind).toBe("completed");
      expect(validateSemanticResult(r.correlation, r).success).toBe(true);
    }
    const copied = (i: number) => {
      const m = results[i]!.discovery!.model!;
      const ids = m.features.at(-1)!.producedTargets;
      return m.bodies.filter((b) =>
        ids.some((t) => t.kind === "body" && t.bodyId === b.bodyId),
      );
    };
    expect(copied(5)[0]!.bounds).toEqual({ min: [0, 1, -5], max: [2, 4, 0] });
    expect(copied(6)[0]!.bounds).toEqual({ min: [0, 1, -5], max: [2, 4, 5] });
    expect(copied(8)[0]!.bounds!.min[0]).toBeCloseTo(-4, 5);
    expect(copied(8)[0]!.bounds!.max[1]).toBeCloseTo(2, 5);
    expect(copied(9)[0]!.bounds).toEqual({ min: [3, -1, 7], max: [5, 2, 12] });
    expect(copied(11).map((b) => b.bounds)).toEqual([
      { min: [0, 1, 7], max: [2, 4, 12] },
      { min: [0, 1, 14], max: [2, 4, 19] },
    ]);
    expect(copied(12)[0]!.bounds).toEqual({ min: [0, 1, -7], max: [2, 4, -2] });
    expect(copied(14)).toHaveLength(2);
    const last = copied(15)[0]!;
    expect(last.bounds!.min[0]).toBeCloseTo(1, 5);
    expect(last.bounds!.max[0]).toBeCloseTo(4, 5);
    expect(last.bounds!.min[1]).toBeCloseTo(-2, 5);
    expect(last.bounds!.max[1]).toBeCloseTo(0, 5);
    expect(
      last.topology!.filter((t) => t.entityClass === "vertex"),
    ).toHaveLength(8);
    const bad = {
      ...commands[5],
      parameters: {
        ...mirror,
        participants: [
          seed,
          {
            role: "plane",
            targets: [{ alias: "seed", label: "Missing plane" }],
          },
        ],
      },
    };
    const missing = await invoke([...prefix, bad, commands[6]!]);
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.results).toHaveLength(5);
    expect(failed.unexecuted).toEqual(["copies-5", "copies-6"]);
    expect(failed.cleanup.kind).toBe("closed");
    const unknown = await invoke([...prefix, { ...bad, basis: a("unknown") }]);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
