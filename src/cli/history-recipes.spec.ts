import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
const exec = promisify(execFile);

it("Bun recipes share private and document history with current aliases and native geometry", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-history-"));
  try {
    const operations = [
      { operation: "document.create", label: "Plate", basis: null, as: "part" },
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
        primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
        construction: false,
        intent: "fulfill",
        as: "rectangle",
      },
      {
        operation: "history.undo",
        basis: { alias: "rectangle" },
        draft: { alias: "rectangle" },
        as: "undone",
      },
      {
        operation: "history.redo",
        basis: { alias: "undone" },
        draft: { alias: "undone" },
        as: "redone",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "redone" },
        draft: { alias: "redone" },
        requireProfiles: true,
        as: "published",
      },
      {
        operation: "extrude.create",
        basis: { alias: "published" },
        profile: { alias: "published", label: "Outer region" },
        depth: 7,
        intent: "fulfill",
        as: "solid",
      },
      {
        operation: "extrude.update",
        basis: { alias: "solid" },
        featureId: { alias: "solid", label: "Extrude 1" },
        depth: 12,
        intent: "fulfill",
        as: "deep",
      },
      {
        operation: "history.undo",
        basis: { alias: "deep" },
        draft: null,
        as: "shallow",
      },
      {
        operation: "history.redo",
        basis: { alias: "shallow" },
        draft: null,
        as: "restored",
      },
      {
        operation: "history.inspect",
        basis: { alias: "restored" },
        draft: null,
      },
    ].map((command, index) => ({
      version: 1,
      commandId: `command-${index}`,
      ...command,
    }));
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    const output = await exec("bun", [cliEntry(), "document", "recipe", path], {
      cwd: resolve(import.meta.dirname, "../.."),
      timeout: 90000,
    });
    const results: SemanticResult[] = JSON.parse(output.stdout).results;
    expect(results.map((r) => r.outcome.kind)).toEqual(
      Array(11).fill("completed"),
    );
    expect(results[3]!.discovery!.sketch!.entities).toHaveLength(0);
    expect(results[4]!.discovery!.sketch!.profiles).toHaveLength(1);
    for (const [index, depth] of [
      [8, 7],
      [9, 12],
    ] as const) {
      const bounds = results[index]!.discovery!.model!.bodies[0]!.bounds!;
      expect(bounds.max[0]! - bounds.min[0]!).toBeCloseTo(20, 6);
      expect(bounds.max[1]! - bounds.min[1]!).toBeCloseTo(10, 6);
      expect(bounds.max[2]! - bounds.min[2]!).toBeCloseTo(depth, 6);
      expect(results[index]!.completion.persistence.kind).toBe("committed");
    }
    expect(results[10]!.completion.live.kind).toBe("unchanged");
    expect(results[10]!.discovery!.history).toMatchObject({
      canUndo: true,
      canRedo: false,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
