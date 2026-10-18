import { expect, test } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("production Bun body aliases author combine, split and Delete Solid history with exact failure policy", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-body-booleans-"));
  const a = (alias: string) => ({ alias });
  const prefix: Record<string, unknown>[] = [
    { operation: "document.create", label: "Bodies", basis: null, as: "part" },
    { operation: "sketch.begin", plane: "xy", basis: a("part"), as: "draft" },
    {
      operation: "sketch.author",
      basis: a("draft"),
      draft: a("draft"),
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 10] },
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
      as: "first",
    },
    {
      operation: "sketch.begin",
      plane: "xy",
      basis: a("first"),
      as: "toolDraft",
    },
    {
      operation: "sketch.author",
      basis: a("toolDraft"),
      draft: a("toolDraft"),
      primitive: { kind: "rectangle", start: [5, 0], end: [15, 10] },
      construction: false,
      intent: "fulfill",
      as: "toolRectangle",
    },
    {
      operation: "sketch.author",
      basis: a("toolRectangle"),
      draft: a("toolRectangle"),
      primitive: { kind: "rectangle", start: [100, 100], end: [120, 120] },
      construction: false,
      intent: "fulfill",
      as: "separate",
    },
    {
      operation: "sketch.publish",
      basis: a("separate"),
      draft: a("separate"),
      requireProfiles: true,
      as: "toolProfile",
    },
    {
      operation: "extrude.create",
      basis: a("toolProfile"),
      profile: { alias: "toolProfile", label: "Loop region 2" },
      depth: 10,
      intent: "fulfill",
      as: "both",
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
          commandId: `bodies-${i}`,
          ...c,
        })),
      }),
    );
    try {
      return {
        code: 0,
        ...(await promisify(execFile)(
          "bun",
          [cliEntry(), "document", "recipe", path],
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
    const discovered: SemanticResult = JSON.parse(probe.stdout).results.at(-1);
    const bodies = discovered.discovery!.model!.bodies;
    const target = bodies.find((b) => b.bounds!.min[0] === 0)!;
    const tool = bodies.find((b) => b.bounds!.min[0] === 5)!;
    const label = (id: string) =>
      discovered.discovery!.references.find(
        (r) => r.target.kind === "body" && r.target.bodyId === id,
      )!.label;
    const parameters = {
      participants: [
        {
          role: "targetBody",
          targets: [{ alias: "both", label: label(target.bodyId) }],
        },
        {
          role: "toolBody",
          targets: [{ alias: "both", label: label(tool.bodyId) }],
        },
      ],
    };
    const commands: Record<string, unknown>[] = [
      ...prefix,
      {
        operation: "combine.create",
        basis: a("both"),
        parameters: {
          ...parameters,
          operationIntent: { source: "literal", value: "subtract" },
          options: { keepTools: true },
        },
        intent: "fulfill",
        as: "combined",
      },
      {
        operation: "combine.update",
        basis: a("combined"),
        featureId: { alias: "combined", label: "Combine 1" },
        parameters: {
          ...parameters,
          operationIntent: { source: "literal", value: "intersect" },
          options: { keepTools: false },
        },
        intent: "fulfill",
        as: "updated",
      },
      {
        operation: "feature.delete",
        basis: a("updated"),
        featureId: { alias: "combined", label: "Combine 1" },
        intent: "fulfill",
        as: "restored",
      },
      {
        operation: "split.create",
        basis: a("restored"),
        parameters,
        intent: "fulfill",
        as: "split",
      },
      {
        operation: "feature.delete",
        basis: a("split"),
        featureId: { alias: "split", label: "Split 1" },
        intent: "fulfill",
        as: "restoredAgain",
      },
      {
        operation: "deleteSolid.create",
        basis: a("restoredAgain"),
        parameters: {
          participants: [
            { role: "body", targets: parameters.participants[0]!.targets },
          ],
        },
        intent: "fulfill",
        as: "deleted",
      },
      {
        operation: "deleteSolid.update",
        basis: a("deleted"),
        featureId: { alias: "deleted", label: "DeleteSolid 1" },
        parameters: {
          participants: [
            {
              role: "body",
              targets: parameters.participants.flatMap((p) => p.targets),
            },
          ],
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
      expect(result.correlation.commandId).toBe(`bodies-${i}`);
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    const combined: SemanticResult = output.results[10];
    expect(
      combined.discovery!.model!.bodies.find((b) => b.bounds!.min[0] === 0)!
        .bounds,
    ).toEqual({ min: [0, 0, 0], max: [5, 10, 10] });
    const updated: SemanticResult = output.results[11];
    expect(updated.discovery!.model!.bodies.map((b) => b.bounds)).toEqual([
      { min: [5, 0, 0], max: [10, 10, 10] },
    ]);
    const split: SemanticResult = output.results[13];
    const f = split.discovery!.model!.features.at(-1)!;
    expect(f.producedTargets).toHaveLength(2);
    expect(
      split
        .discovery!.model!.bodies.filter((b) =>
          f.producedTargets.some(
            (t) => t.kind === "body" && t.bodyId === b.bodyId,
          ),
        )
        .map((b) => b.bounds)
        .sort((a, b) => a!.min[0]! - b!.min[0]!),
    ).toEqual([
      { min: [0, 0, 0], max: [5, 10, 10] },
      { min: [5, 0, 0], max: [10, 10, 10] },
    ]);
    expect(output.results[16].discovery.model.bodies).toEqual([]);
    expect(
      output.results[16].discovery.model.features.at(-1).producedTargets,
    ).toEqual([]);
    const bad = {
      ...commands[10],
      parameters: {
        ...parameters,
        operationIntent: { source: "literal", value: "subtract" },
        participants: [
          {
            role: "targetBody",
            targets: [{ alias: "both", label: "Missing body" }],
          },
          parameters.participants[1],
        ],
      },
    };
    const missing = await invoke([...prefix, bad, commands[11]!]);
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.results).toHaveLength(prefix.length);
    expect(failed.unexecuted).toEqual(["bodies-10", "bodies-11"]);
    expect(failed.cleanup.kind).toBe("closed");
    const unknown = await invoke([
      ...prefix,
      {
        ...bad,
        parameters: {
          ...parameters,
          operationIntent: { source: "literal", value: "subtract" },
          participants: [
            {
              role: "targetBody",
              targets: [{ alias: "unknown", label: "Body" }],
            },
            parameters.participants[1],
          ],
        },
      },
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
