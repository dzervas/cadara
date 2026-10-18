import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

it("a real Bun recipe moves an arc center with production body semantics and undoes one completed action", async () => {
  const primitive = {
    kind: "centerPointArc",
    center: [0, 0],
    start: [3, 0],
    end: [0, 3],
  };
  // Discover the selector publicly instead of guessing a generated identity.
  const f = await createSketchWorkflow();
  let label: string;
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive,
      construction: false,
      intent: "fulfill",
    });
    label = created.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchPoint" &&
        r.target.pointId === created.discovery!.sketch!.points[0]!.pointId,
    )!.label;
  } finally {
    await f.close();
  }
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-sketch-move-"));
  try {
    const commands = [
      {
        operation: "document.create",
        label: "Movement",
        basis: null,
        as: "document",
      },
      {
        operation: "sketch.begin",
        basis: { alias: "document" },
        plane: "xy",
        as: "draft",
      },
      {
        operation: "sketch.author",
        basis: { alias: "draft" },
        draft: { alias: "draft" },
        primitive,
        construction: false,
        intent: "fulfill",
        as: "arc",
      },
      {
        operation: "sketch.geometry.update",
        basis: { alias: "arc" },
        draft: { alias: "arc" },
        edit: {
          kind: "point",
          target: { alias: "arc", label },
          position: [10, 5],
        },
        intent: "fulfill",
        as: "moved",
      },
      {
        operation: "history.undo",
        basis: { alias: "moved" },
        draft: { alias: "moved" },
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
        requireProfiles: false,
      },
    ].map((command, i) => ({ version: 1, commandId: `move-${i}`, ...command }));
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations: commands }));
    const output = await promisify(execFile)(
      "bun",
      [cliEntry(), "document", "recipe", path],
      { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
    );
    const results: SemanticResult[] = JSON.parse(output.stdout).results;
    expect(results).toHaveLength(commands.length);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      commands.map((c) => c.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    for (const result of [results[3]!, results[5]!, results[6]!]) {
      for (const [i, expected] of [
        [10, 5],
        [13, 5],
        [10, 8],
      ].entries()) {
        expect(result.discovery!.sketch!.points[i]!.position[0]).toBeCloseTo(
          expected[0]!,
          3,
        );
        expect(result.discovery!.sketch!.points[i]!.position[1]).toBeCloseTo(
          expected[1]!,
          3,
        );
      }
      expect(result.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(3, 3);
    }
    expect(results[3]!.discovery!.history!.undoEntries).toHaveLength(
      results[2]!.discovery!.history!.undoEntries!.length + 1,
    );
    expect(results[4]!.discovery!.sketch!.points).toEqual(
      results[2]!.discovery!.sketch!.points,
    );
    expect(results[6]!.discovery!.sketch!.entities[0]!.entityId).toBe(
      results[2]!.discovery!.sketch!.entities[0]!.entityId,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);
