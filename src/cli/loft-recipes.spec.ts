import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { assertLoftInterior } from "../../test/helpers/semantic-loft-geometry";

test("production Bun loft recipes resolve ordered profile/path/feature aliases and inspect native interiors", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-lofts-"));
  const a = (alias: string) => ({ alias });
  const prefix: Record<string, unknown>[] = [
    { operation: "document.create", label: "Loft", basis: null, as: "part" },
    { operation: "sketch.begin", plane: "xy", basis: a("part"), as: "draft" },
    {
      operation: "sketch.author",
      basis: a("draft"),
      draft: a("draft"),
      primitive: { kind: "rectangle", start: [-1, -1], end: [1, 1] },
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
      operation: "sketch.begin",
      plane: "xy",
      basis: a("profile"),
      as: "toolDraft",
    },
    {
      operation: "sketch.author",
      basis: a("toolDraft"),
      draft: a("toolDraft"),
      primitive: { kind: "rectangle", start: [-2, -2], end: [2, 2] },
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
      as: "separateRegion",
    },
    {
      operation: "sketch.publish",
      basis: a("separateRegion"),
      draft: a("separateRegion"),
      requireProfiles: true,
      as: "toolProfile",
    },
  ];
  // The second sketch has a separate larger region so its intended tool has
  // the unique Loop region 2 label; Outer region is deliberately ambiguous.
  async function invoke(commands: readonly Record<string, unknown>[]) {
    const path = resolve(dir, "recipe.json");
    await writeFile(
      path,
      JSON.stringify({
        version: 1,
        operations: commands.map((c, i) => ({
          version: 1,
          commandId: `lofts-${i}`,
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
    prefix.push({
      operation: "extrude.create",
      basis: a("toolProfile"),
      profile: { alias: "toolProfile", label: "Loop region 2" },
      depth: 10,
      intent: "fulfill",
      as: "tool",
    });
    const probe = await invoke(prefix);
    expect(probe.code, probe.stderr + probe.stdout).toBe(0);
    const discovered: SemanticResult = JSON.parse(probe.stdout).results.at(-1);
    const topology = discovered.discovery!.model!.bodies[0]!.topology!;
    const edge = topology.find(
      (t) =>
        t.entityClass === "edge" &&
        t.geometryType === "line" &&
        t.boundingBox!.high[2] - t.boundingBox!.low[2] > 9.99,
    )!.reference;
    const face = topology.find(
      (t) =>
        t.entityClass === "face" &&
        t.boundingBox &&
        Math.abs(t.boundingBox.low[2] - 10) < 1e-5 &&
        Math.abs(t.boundingBox.high[2] - 10) < 1e-5,
    )!.reference;
    const label = (target: typeof edge) =>
      discovered.discovery!.references.find(
        (r) => JSON.stringify(r.target) === JSON.stringify(target),
      )!.label;
    const profiles = {
      role: "profile",
      targets: [
        { alias: "profile", label: "Outer region" },
        { alias: "tool", label: label(face) },
      ],
    };
    const path = {
      role: "path",
      targets: [{ alias: "tool", label: label(edge) }],
    };
    const commands = [
      ...prefix,
      {
        operation: "loft.create",
        basis: a("tool"),
        parameters: { participants: [profiles] },
        intent: "fulfill",
        as: "lofted",
      },
      {
        operation: "loft.update",
        basis: a("lofted"),
        featureId: { alias: "lofted", label: "Loft 1" },
        parameters: {
          participants: [profiles, path],
          options: { path: { sectionCount: 3 } },
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
      expect(result.correlation.commandId).toBe(`lofts-${i}`);
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    assertLoftInterior(output.results[9], 5, 1.5);
    for (const z of [2.5, 5, 7.5]) assertLoftInterior(output.results[10], z, 1);
    const missing = await invoke([
      ...prefix,
      {
        ...commands[9],
        parameters: {
          participants: [
            {
              role: "profile",
              targets: [
                { alias: "profile", label: "Missing region" },
                profiles.targets[1],
              ],
            },
          ],
        },
      },
      commands[10]!,
    ]);
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.results).toHaveLength(prefix.length);
    expect(failed.unexecuted).toEqual(["lofts-9", "lofts-10"]);
    expect(failed.cleanup.kind).toBe("closed");
    const unknown = await invoke([
      ...prefix,
      {
        ...commands[9],
        parameters: {
          participants: [
            {
              role: "profile",
              targets: [
                { alias: "unknown", label: "Outer region" },
                profiles.targets[1],
              ],
            },
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
