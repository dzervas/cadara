import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";

it("resolves sketch edit labels through public discoveries and keeps stdout clean", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-geometry-"));
  try {
    const operations = [
      {
        operation: "document.create",
        label: "Geometry",
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
        primitive: { kind: "line", start: [1, 2], end: [4, 5] },
        construction: false,
        intent: "fulfill",
        as: "point",
      },
      {
        operation: "sketch.geometry.update",
        basis: { alias: "point" },
        draft: { alias: "point" },
        edit: {
          kind: "point",
          target: { alias: "point", label: "Line 1 end" },
          position: [12, 9],
        },
        intent: "fulfill",
        as: "edited",
      },
      {
        operation: "sketch.label.set",
        basis: { alias: "edited" },
        draft: { alias: "edited" },
        target: { alias: "edited", label: "Line 1 end" },
        label: "Datum point",
        as: "labeled",
        intent: "fulfill",
      },
      {
        operation: "sketch.construction.set",
        basis: { alias: "labeled" },
        draft: { alias: "labeled" },
        target: { alias: "labeled", label: "Datum point" },
        construction: true,
        intent: "fulfill",
        as: "construction",
      },
      {
        operation: "sketch.geometry.delete",
        basis: { alias: "construction" },
        draft: { alias: "construction" },
        targets: [{ alias: "construction", label: "Datum point" }],
        intent: "fulfill",
        as: "deleted",
      },
      {
        operation: "history.undo",
        basis: { alias: "deleted" },
        draft: { alias: "deleted" },
        as: "restored",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "restored" },
        draft: { alias: "restored" },
        requireProfiles: false,
      },
    ].map((command, index) => ({
      version: 1,
      commandId: `geometry-${index}`,
      ...command,
    }));
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    const output = await promisify(execFile)(
      "bun",
      [cliEntry(), "document", "recipe", path],
      { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
    ).catch((error: unknown) => {
      const failed = error as { stdout?: string; stderr?: string };
      throw new Error(
        JSON.stringify({ stdout: failed.stdout, stderr: failed.stderr }),
      );
    });
    const results: SemanticResult[] = JSON.parse(output.stdout).results;
    expect(results).toHaveLength(9);
    expect(results.every((r) => r.outcome.kind === "completed")).toBe(true);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      operations.map((o) => o.commandId),
    );
    expect(results[3]!.discovery!.sketch!.points[1]!.position).toEqual([12, 9]);
    expect(results[6]!.discovery!.sketch!.points).toEqual([]);
    expect(results[8]!.discovery!.sketch!.points[1]!.pointId).toBe(
      results[2]!.discovery!.sketch!.points[1]!.pointId,
    );
    expect(results[8]!.discovery!.sketch!.points[1]!.construction).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
