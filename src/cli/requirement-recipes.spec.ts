import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";

it("runs constraint, datum dimension, reference conversion and removal aliases through the real Bun CLI", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "cadara-requirement-recipe-"),
  );
  try {
    const alias = (name: string) => ({ alias: name });
    const target = (name: string, label: string) => ({ alias: name, label });
    const operations = [
      {
        operation: "document.create",
        label: "Requirements",
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
        primitive: { kind: "line", start: [3, 4], end: [4, 4] },
        construction: false,
        intent: "fulfill",
        as: "point",
      },
      {
        operation: "sketch.requirement.add",
        basis: alias("point"),
        draft: alias("point"),
        tool: "dimensionDistance",
        targets: [
          target("point", "Line 1 start"),
          target("point", "Sketch origin"),
        ],
        mode: "driving",
        value: 10,
        intent: "fulfill",
        as: "dimension",
      },
      {
        operation: "sketch.dimension.reference",
        basis: alias("dimension"),
        draft: alias("dimension"),
        dimensionId: target("dimension", "Distance 2"),
        intent: "fulfill",
        as: "reference",
      },
      {
        operation: "sketch.requirement.add",
        basis: alias("reference"),
        draft: alias("reference"),
        tool: "constraintFix",
        targets: [target("reference", "Line 1 start")],
        mode: "driving",
        value: null,
        intent: "fulfill",
        as: "fixed",
      },
      {
        operation: "sketch.requirement.remove",
        basis: alias("fixed"),
        draft: alias("fixed"),
        targets: [target("fixed", "Fix 3")],
        intent: "fulfill",
        as: "removed",
      },
      {
        operation: "sketch.publish",
        basis: alias("removed"),
        draft: alias("removed"),
        requireProfiles: false,
      },
    ].map((o, i) => ({ version: 1, commandId: `requirement-${i}`, ...o }));
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    const output = await promisify(execFile)(
      "bun",
      ["src/cli/main.ts", "document", "recipe", path],
      { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
    ).catch((error: unknown) => {
      const failed = error as { stdout?: string; stderr?: string };
      throw new Error(JSON.stringify(failed));
    });
    const results: SemanticResult[] = JSON.parse(output.stdout).results;
    expect(results).toHaveLength(8);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      operations.map((o) => o.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    expect(results[3]!.discovery!.sketch!.requirements).toMatchObject([
      { kind: "pointDatumDistance", value: 10 },
    ]);
    expect(
      results[3]!.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(10, 6);
    expect(results[3]!.discovery!.sketch!.requirements).toHaveLength(1);
    const [x, y] = results[3]!.discovery!.sketch!.points[0]!.position;
    expect(Math.hypot(x, y)).toBeCloseTo(10, 6);
    expect(results[4]!.discovery!.sketch!.requirements).toEqual([]);
    expect(results[4]!.discovery!.sketch!.measurements).toMatchObject([
      { kind: "pointDatumDistance" },
    ]);
    expect(
      results[4]!.discovery!.sketch!.measurements[0]!.measuredValue,
    ).toBeCloseTo(10, 6);
    expect(results[4]!.discovery!.sketch!.measurements).toHaveLength(1);
    expect(results[5]!.discovery!.sketch!.constraints).toMatchObject([
      { kind: "fixPoint", status: "satisfied" },
    ]);
    expect(results[6]!.discovery!.sketch!.constraints).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);

it("refuses ambiguous or missing requirement labels and unknown aliases before later operations", async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), "cadara-requirement-refusal-"),
  );
  try {
    const operations = [
      {
        operation: "document.create",
        label: "Refusals",
        basis: null,
        as: "part",
      },
      {
        operation: "sketch.begin",
        basis: { alias: "part" },
        plane: "xy",
        as: "draft",
      },
      {
        operation: "sketch.author",
        basis: { alias: "draft" },
        draft: { alias: "draft" },
        primitive: { kind: "point", position: [3, 4] },
        construction: false,
        intent: "fulfill",
        as: "point",
      },
      {
        operation: "sketch.requirement.add",
        basis: { alias: "point" },
        draft: { alias: "point" },
        tool: "constraintFix",
        targets: [{ alias: "point", label: "Point 1" }],
        mode: "driving",
        value: null,
        intent: "fulfill",
        as: "fixed",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "fixed" },
        draft: { alias: "fixed" },
        requireProfiles: false,
      },
    ].map((o, i) => ({ version: 1, commandId: `refusal-${i}`, ...o }));
    const path = resolve(directory, "recipe.json");
    for (const selection of [
      { alias: "point", label: "Point 1" },
      { alias: "point", label: "Missing" },
      { alias: "unknown", label: "Point 1" },
    ]) {
      await writeFile(
        path,
        JSON.stringify({
          version: 1,
          operations: operations.map((o) =>
            o.operation === "sketch.requirement.add"
              ? { ...o, targets: [selection] }
              : o,
          ),
        }),
      );
      const failed = await promisify(execFile)(
        "bun",
        ["src/cli/main.ts", "document", "recipe", path],
        { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
      ).then(
        () => {
          throw new Error("Expected refusal.");
        },
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
      expect(failed.code).toBe(selection.alias === "unknown" ? 2 : 1);
      if (selection.alias === "unknown") {
        expect(failed.stdout).toBe("");
        expect(failed.stderr).toContain("Unknown or ambiguous target alias");
      } else {
        const output = JSON.parse(failed.stdout);
        expect(
          output.results.map((r: SemanticResult) => r.correlation.commandId),
        ).toEqual(["refusal-0", "refusal-1", "refusal-2"]);
        expect(output.unexecuted).toEqual(["refusal-3", "refusal-4"]);
        expect(failed.stderr).toContain("missing or ambiguous");
      }
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
