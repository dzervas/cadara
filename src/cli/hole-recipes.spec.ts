import { expect, test } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real production Bun holes use discovered location/body aliases and preserve geometry, completion and failure exits", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-holes-"));
  const a = (alias: string) => ({ alias });
  const prefix: Record<string, unknown>[] = [
    { operation: "document.create", label: "Holes", basis: null, as: "part" },
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
      operation: "sketch.author",
      basis: a("rectangle"),
      draft: a("rectangle"),
      primitive: { kind: "point", position: [10, 5] },
      construction: false,
      intent: "fulfill",
      as: "center",
    },
    {
      operation: "sketch.publish",
      basis: a("center"),
      draft: a("center"),
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
          commandId: `holes-${i}`,
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
    const seeded: SemanticResult[] = JSON.parse(probe.stdout).results;
    const published = seeded[4]!.discovery!;
    const point = published.sketch!.points.find(
      (p) => p.position[0] === 10 && p.position[1] === 5,
    )!;
    const location = {
      alias: "published",
      label: published.references.find(
        (r) =>
          r.target.kind === "sketchPoint" && r.target.pointId === point.pointId,
      )!.label,
    };
    const solid = seeded[5]!.discovery!;
    const body = {
      alias: "solid",
      label: solid.references.find(
        (r) =>
          r.target.kind === "body" &&
          r.target.bodyId === solid.model!.bodies[0]!.bodyId,
      )!.label,
    };
    const participants = [
      { role: "location", targets: [location] },
      { role: "body", targets: [body] },
    ];
    const commands = [
      ...prefix,
      {
        operation: "hole.create",
        basis: a("solid"),
        parameters: {
          participants,
          options: { mainDiameter: 2, termination: "blind", depth: 6 },
        },
        intent: "fulfill",
        as: "bored",
      },
      {
        operation: "hole.update",
        basis: a("bored"),
        featureId: { alias: "bored", label: "Hole 1" },
        parameters: {
          participants,
          options: {
            style: "counterbore",
            mainDiameter: 2,
            termination: "throughAll",
            counterboreDiameter: 4,
            counterboreDepth: 2,
          },
        },
        intent: "fulfill",
        as: "stepped",
      },
      {
        operation: "hole.update",
        basis: a("stepped"),
        featureId: { alias: "stepped", label: "Hole 1" },
        parameters: {
          participants,
          options: {
            style: "countersink",
            mainDiameter: 2,
            termination: "throughAll",
            countersinkDiameter: 6,
            countersinkAngleDegrees: 90,
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
      expect(result.correlation.commandId).toBe(`holes-${i}`);
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    const faces = (i: number) =>
      (
        output.results[i] as SemanticResult
      ).discovery!.model!.bodies[0]!.topology!.filter(
        (t) => t.entityClass === "face",
      );
    const first = faces(6).find((t) => t.geometryType === "cylinder")!;
    expect(first.definingData!.radius).toBeCloseTo(1, 5);
    expect(first.boundingBox!.low[2]).toBeCloseTo(0, 5);
    expect(first.boundingBox!.high[2]).toBeCloseTo(6, 5);
    const recess = faces(7).find(
      (t) =>
        t.geometryType === "cylinder" &&
        Math.abs(Number(t.definingData!.radius) - 2) < 1e-5,
    )!;
    expect(recess.boundingBox!.low[2]).toBeCloseTo(0, 5);
    expect(recess.boundingBox!.high[2]).toBeCloseTo(2, 5);
    const cone = faces(8).find((t) => t.geometryType === "cone")!;
    expect(
      Math.abs(
        Math.abs(Number(cone.definingData!.semiAngleRadians)) - Math.PI / 4,
      ),
    ).toBeLessThanOrEqual(0.0001);
    expect(cone.boundingBox!.high[0] - cone.boundingBox!.low[0]).toBeCloseTo(
      6,
      3,
    );
    const missing = await invoke([
      ...prefix,
      {
        ...commands[6],
        parameters: {
          participants: [
            {
              role: "location",
              targets: [{ alias: "published", label: "Missing point" }],
            },
            participants[1],
          ],
          options: { mainDiameter: 2, termination: "throughAll" },
        },
      },
      commands[7]!,
    ]);
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.cleanup.kind).toBe("closed");
    expect(failed.results).toHaveLength(prefix.length);
    expect(failed.unexecuted).toEqual(["holes-6", "holes-7"]);
    const unknown = await invoke([
      ...prefix,
      {
        ...commands[6],
        parameters: {
          participants: [
            {
              role: "location",
              targets: [{ alias: "unknown", label: location.label }],
            },
            participants[1],
          ],
          options: { mainDiameter: 2, termination: "throughAll" },
        },
      },
    ]);
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
