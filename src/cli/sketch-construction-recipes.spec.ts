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

it("real Bun recipes construct corners and slots, preserve history, and enforce 0/1/2 failure policy", async () => {
  const rectangle = { kind: "rectangle", start: [0, 0], end: [10, 10] };
  const line = { kind: "line", start: [20, 0], end: [30, 0] };
  const f = await createSketchWorkflow();
  let labels: string[];
  let lineLabel: string;
  try {
    const authored = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: rectangle,
      construction: false,
      intent: "fulfill",
    });
    labels = authored
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .slice(0, 2)
      .map((r) => r.label);
    // Match the actual preceding recipe actions so label sequence discovery is exact.
    const targets = authored
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .slice(0, 2)
      .map((r) => r.target);
    await f.execute({
      operation: "sketch.geometry.build",
      kind: "fillet",
      targets,
      radius: 2,
      draft: f.current().discovery!.state.draft,
      intent: "fulfill",
    });
    await f.execute({
      operation: "history.undo",
      draft: f.current().discovery!.state.draft,
    });
    await f.execute({
      operation: "sketch.geometry.build",
      kind: "chamfer",
      targets,
      distance: 3,
      draft: f.current().discovery!.state.draft,
      intent: "fulfill",
    });
    await f.execute({
      operation: "history.undo",
      draft: f.current().discovery!.state.draft,
    });
    const seeded = await f.execute({
      operation: "sketch.author",
      primitive: line,
      construction: false,
      draft: f.current().discovery!.state.draft,
      intent: "fulfill",
    });
    lineLabel = seeded
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.label;
  } finally {
    await f.close();
  }
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-construction-"));
  try {
    const operations = [
      {
        operation: "document.create",
        label: "Corners and slots",
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
        primitive: rectangle,
        construction: false,
        intent: "fulfill",
        as: "rectangle",
      },
      {
        operation: "sketch.geometry.build",
        basis: { alias: "rectangle" },
        draft: { alias: "rectangle" },
        kind: "fillet",
        targets: labels.map((label) => ({ alias: "rectangle", label })),
        radius: 2,
        intent: "fulfill",
        as: "rounded",
      },
      {
        operation: "history.undo",
        basis: { alias: "rounded" },
        draft: { alias: "rounded" },
        as: "restored",
      },
      {
        operation: "sketch.geometry.build",
        basis: { alias: "restored" },
        draft: { alias: "restored" },
        kind: "chamfer",
        targets: labels.map((label) => ({ alias: "rectangle", label })),
        distance: 3,
        intent: "fulfill",
        as: "beveled",
      },
      {
        operation: "history.undo",
        basis: { alias: "beveled" },
        draft: { alias: "beveled" },
        as: "restoredAgain",
      },
      {
        operation: "sketch.author",
        basis: { alias: "restoredAgain" },
        draft: { alias: "restoredAgain" },
        primitive: line,
        construction: false,
        intent: "fulfill",
        as: "seed",
      },
      {
        operation: "sketch.geometry.build",
        basis: { alias: "seed" },
        draft: { alias: "seed" },
        kind: "slot",
        targets: [{ alias: "seed", label: lineLabel }],
        width: 4,
        intent: "fulfill",
        as: "slotted",
      },
      {
        operation: "sketch.construction.set",
        basis: { alias: "slotted" },
        draft: { alias: "slotted" },
        target: { alias: "seed", label: lineLabel },
        construction: true,
        intent: "fulfill",
        as: "cleaned",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "cleaned" },
        draft: { alias: "cleaned" },
        requireProfiles: true,
      },
    ].map((command, i) => ({
      version: 1,
      commandId: `construction-${i}`,
      ...command,
    }));
    const path = resolve(directory, "recipe.json");
    async function run(rows: unknown[]) {
      await writeFile(path, JSON.stringify({ version: 1, operations: rows }));
      return promisify(execFile)(
        "bun",
        [cliEntry(), "document", "recipe", path],
        { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
      );
    }
    const output = await run(operations);
    const envelope = JSON.parse(output.stdout);
    const results: SemanticResult[] = envelope.results;
    expect(envelope.unexecuted).toEqual([]);
    expect(results).toHaveLength(operations.length);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      operations.map((c) => c.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    const rounded = results[3]!.discovery!.sketch!;
    const arc = rounded.entities.find((e) => e.kind === "arc")!;
    expect(arc.radius).toBeCloseTo(2, 6);
    expect(
      arc.pointIds
        .map((id) => rounded.points.find((p) => p.pointId === id)!.position)
        .map((p) => p.map((v) => Math.round(v * 1e6) / 1e6)),
    ).toEqual([
      [8, 0],
      [10, 2],
      [8, 2],
    ]);
    const beveled = results[5]!.discovery!.sketch!;
    expect(
      beveled.entities
        .at(-1)!
        .pointIds.map(
          (id) => beveled.points.find((p) => p.pointId === id)!.position,
        ),
    ).toEqual([
      [7, 0],
      [10, 3],
    ]);
    for (const i of [4, 6])
      expect(results[i]!.discovery!.sketch!.entities).toEqual(
        results[2]!.discovery!.sketch!.entities,
      );
    const slotted = results[8]!.discovery!.sketch!;
    const side = slotted.entities.find((e) =>
      e.pointIds.every((id) =>
        slotted.points.some((p) => p.pointId === id && p.position[1] === 2),
      ),
    )!;
    expect(
      side.pointIds.map(
        (id) => slotted.points.find((p) => p.pointId === id)!.position,
      ),
    ).toEqual([
      [20, 2],
      [30, 2],
    ]);
    expect(
      slotted.entities.filter((e) => e.kind === "arc").map((e) => e.radius),
    ).toEqual([2, 2]);
    for (const [changed, prior] of [
      [3, 2],
      [5, 4],
      [8, 7],
    ])
      expect(results[changed!]!.discovery!.history!.undoEntries).toHaveLength(
        results[prior!]!.discovery!.history!.undoEntries!.length + 1,
      );
    expect(results[10]!.discovery!.sketch!.profiles).toHaveLength(2);
    expect(results[10]!.discovery!.sketch!.entities).toEqual(
      results[9]!.discovery!.sketch!.entities,
    );
    const missing = await run(
      operations.map((c) =>
        c.operation === "sketch.geometry.build" && c.kind === "fillet"
          ? {
              ...c,
              targets: [
                { alias: "rectangle", label: labels[0] },
                { alias: "rectangle", label: "Missing line" },
              ],
            }
          : c,
      ),
    ).then(
      () => {
        throw new Error("Expected command failure");
      },
      (error) => error as { code: number; stdout: string; stderr: string },
    );
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(
      failed.results.map((r: SemanticResult) => r.correlation.commandId),
    ).toEqual(operations.slice(0, 3).map((c) => c.commandId));
    expect(failed.unexecuted).toEqual(
      operations.slice(3).map((c) => c.commandId),
    );
    expect(missing.stderr).toContain("missing or ambiguous");
    const unknown = await run(
      operations.map((c) =>
        c.operation === "sketch.geometry.build" && c.kind === "fillet"
          ? {
              ...c,
              targets: [
                { alias: "unknown", label: labels[0] },
                { alias: "rectangle", label: labels[1] },
              ],
            }
          : c,
      ),
    ).then(
      () => {
        throw new Error("Expected usage failure");
      },
      (error) => error as { code: number; stdout: string; stderr: string },
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toContain("Unknown or ambiguous target alias");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
