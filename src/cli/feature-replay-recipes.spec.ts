import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { expectReplayGeometry } from "../../test/helpers/semantic-feature-replay";

test("real production Bun resolves source, construction and exact boolean body aliases for nested replay and updates", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-feature-replay-"));
  const a = (alias: string) => ({ alias });
  const prefix: Record<string, unknown>[] = [
    { operation: "document.create", label: "Replay", basis: null, as: "part" },
    { operation: "sketch.begin", plane: "xy", basis: a("part"), as: "draft" },
    {
      operation: "sketch.author",
      basis: a("draft"),
      draft: a("draft"),
      primitive: { kind: "rectangle", start: [-20, -10], end: [20, 10] },
      construction: false,
      intent: "fulfill",
      as: "rect",
    },
    {
      operation: "sketch.publish",
      basis: a("rect"),
      draft: a("rect"),
      requireProfiles: true,
      as: "profile",
    },
    {
      operation: "extrude.create",
      basis: a("profile"),
      profile: { alias: "profile", label: "Outer region" },
      depth: 5,
      intent: "fulfill",
      as: "base",
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
          commandId: `replay-${i}`,
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
    const base: SemanticResult = JSON.parse(probe.stdout).results.at(-1);
    const bodyLabel = base.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.label;
    const planeLabel = base.discovery!.references.find(
      (r) =>
        r.target.kind === "construction" &&
        r.target.constructionId === "construction_plane-yz",
    )!.label;
    const source: Record<string, unknown>[] = [
      ...prefix,
      {
        operation: "sketch.begin",
        plane: "xy",
        basis: a("base"),
        as: "toolDraft",
      },
      {
        operation: "sketch.author",
        basis: a("toolDraft"),
        draft: a("toolDraft"),
        primitive: { kind: "rectangle", start: [2, 2], end: [4, 4] },
        construction: false,
        intent: "fulfill",
        as: "toolRect",
      },
      {
        operation: "sketch.author",
        basis: a("toolRect"),
        draft: a("toolRect"),
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
        parameters: {
          resultBodyType: "solid",
          profiles: [{ alias: "toolProfile", label: "Loop region 2" }],
          startExtent: {
            kind: "blindOffset",
            distance: literal(5),
            direction: "positive",
          },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", distance: literal(3), direction: "positive" },
          },
          operation: literal("join"),
          booleanScope: {
            kind: "targetBody",
            bodyId: { alias: "base", label: bodyLabel },
          },
        },
        intent: "fulfill",
        as: "source",
      },
    ];
    const parameters = {
      sourceFeatureIds: [{ alias: "source", label: "Extrude 2" }],
      transform: {
        kind: "linear",
        direction: { alias: "base", label: planeLabel },
        instanceCount: literal(3),
        spacing: literal(7),
        oppositeDirection: literal(false),
      },
    };
    const linear = {
      operation: "featureReplay.create",
      basis: a("source"),
      parameters,
      intent: "fulfill",
      as: "linear",
    };
    const replayProbe = await invoke([...source, linear]);
    expect(replayProbe.code, replayProbe.stderr + replayProbe.stdout).toBe(0);
    const replay: SemanticResult = JSON.parse(replayProbe.stdout).results.at(
      -1,
    );
    expectReplayGeometry(replay, "join", [
      [2, 4],
      [9, 11],
      [16, 18],
    ]);
    const replayLabel = replay.discovery!.model!.features.at(-1)!.label;
    const commands = [
      ...source,
      linear,
      {
        operation: "featureReplay.create",
        basis: a("linear"),
        parameters: {
          sourceFeatureIds: [{ alias: "linear", label: replayLabel }],
          transform: {
            kind: "mirror",
            plane: { alias: "base", label: planeLabel },
          },
        },
        intent: "fulfill",
        as: "nested",
      },
      {
        operation: "feature.delete",
        basis: a("nested"),
        featureId: { alias: "nested", label: "FeatureReplay 2" },
        intent: "fulfill",
        as: "restored",
      },
      {
        operation: "featureReplay.update",
        basis: a("restored"),
        featureId: { alias: "linear", label: replayLabel },
        parameters: {
          ...parameters,
          transform: {
            ...parameters.transform,
            instanceCount: literal(2),
            spacing: { source: "expression", valueText: "9" },
            oppositeDirection: literal(true),
          },
        },
        intent: "fulfill",
        as: "updated",
      },
    ];
    const complete = await invoke(commands);
    expect(complete.code, complete.stderr + complete.stdout).toBe(0);
    const envelope = JSON.parse(complete.stdout);
    expect(envelope.cleanup.kind).toBe("closed");
    expect(envelope.results).toHaveLength(commands.length);
    for (const [i, r] of (envelope.results as SemanticResult[]).entries()) {
      expect(r.correlation.commandId).toBe(`replay-${i}`);
      expect(validateSemanticResult(r.correlation, r).success).toBe(true);
      expect(r.outcome.kind).toBe("completed");
    }
    expectReplayGeometry(envelope.results[source.length + 1], "join", [
      [2, 4],
      [9, 11],
      [16, 18],
      [-11, -9],
      [-18, -16],
    ]);
    expectReplayGeometry(envelope.results.at(-1), "join", [
      [2, 4],
      [-7, -5],
    ]);
    const missing = await invoke([
      ...source,
      {
        ...linear,
        parameters: {
          ...parameters,
          sourceFeatureIds: [{ alias: "source", label: "Missing source" }],
        },
      },
      { operation: "document.inspect", basis: a("source") },
    ]);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).results).toHaveLength(source.length);
    expect(JSON.parse(missing.stdout).cleanup.kind).toBe("closed");
    const unknown = await invoke([
      ...source,
      {
        ...linear,
        parameters: {
          ...parameters,
          sourceFeatureIds: [{ alias: "unknown", label: "Extrude 2" }],
        },
      },
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
