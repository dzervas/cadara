import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

it("a real Bun recipe resolves target and boundary aliases, trims, splits, extends and publishes current results", async () => {
  const f = await createSketchWorkflow();
  const labels: string[] = [];
  try {
    for (const primitive of [
      { kind: "line", start: [0, 0], end: [10, 0] },
      { kind: "line", start: [3, -5], end: [3, 5] },
      { kind: "line", start: [7, -5], end: [7, 5] },
      { kind: "line", start: [15, -5], end: [15, 5] },
    ]) {
      if (labels.length === 3) {
        // Labels follow authored-action sequence, including undo boundaries.
        // Discover with the recipe's actual prior operations, not a guessed label.
        const refs = f
          .current()
          .discovery!.references.filter(
            (r) => r.target.kind === "sketchEntity",
          );
        const target = refs[0]!.target;
        await f.execute({
          operation: "sketch.geometry.update",
          draft: f.current().discovery!.state.draft,
          edit: { kind: "trim", target },
          intent: "fulfill",
        });
        await f.execute({
          operation: "history.undo",
          draft: f.current().discovery!.state.draft,
        });
        await f.execute({
          operation: "sketch.geometry.update",
          draft: f.current().discovery!.state.draft,
          edit: {
            kind: "split",
            target,
            boundary: refs[2]!.target,
            pick: [7, 0],
          },
          intent: "fulfill",
        });
        await f.execute({
          operation: "history.undo",
          draft: f.current().discovery!.state.draft,
        });
      }
      const r = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive,
        construction: labels.length > 0,
        intent: "fulfill",
      });
      labels.push(
        r
          .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
          .at(-1)!.label,
      );
    }
  } finally {
    await f.close();
  }
  const directory = await mkdtemp(
    resolve(tmpdir(), "cadara-sketch-intersections-"),
  );
  try {
    const commands = [
      {
        operation: "document.create",
        label: "Intersections",
        basis: null,
        as: "doc",
      },
      {
        operation: "sketch.begin",
        basis: { alias: "doc" },
        plane: "xy",
        as: "draft",
      },
      {
        operation: "sketch.author",
        basis: { alias: "draft" },
        draft: { alias: "draft" },
        primitive: { kind: "line", start: [0, 0], end: [10, 0] },
        construction: false,
        intent: "fulfill",
        as: "line",
      },
      {
        operation: "sketch.author",
        basis: { alias: "line" },
        draft: { alias: "line" },
        primitive: { kind: "line", start: [3, -5], end: [3, 5] },
        construction: true,
        intent: "fulfill",
        as: "first",
      },
      {
        operation: "sketch.author",
        basis: { alias: "first" },
        draft: { alias: "first" },
        primitive: { kind: "line", start: [7, -5], end: [7, 5] },
        construction: true,
        intent: "fulfill",
        as: "second",
      },
      {
        operation: "sketch.geometry.update",
        basis: { alias: "second" },
        draft: { alias: "second" },
        edit: { kind: "trim", target: { alias: "line", label: labels[0] } },
        intent: "fulfill",
        as: "trimmed",
      },
      {
        operation: "history.undo",
        basis: { alias: "trimmed" },
        draft: { alias: "trimmed" },
        as: "restored",
      },
      {
        operation: "sketch.geometry.update",
        basis: { alias: "restored" },
        draft: { alias: "restored" },
        edit: {
          kind: "split",
          target: { alias: "line", label: labels[0] },
          boundary: { alias: "second", label: labels[2] },
          pick: [7, 0],
        },
        intent: "fulfill",
        as: "split",
      },
      {
        operation: "history.undo",
        basis: { alias: "split" },
        draft: { alias: "split" },
        as: "restoredAgain",
      },
      {
        operation: "sketch.author",
        basis: { alias: "restoredAgain" },
        draft: { alias: "restoredAgain" },
        primitive: { kind: "line", start: [15, -5], end: [15, 5] },
        construction: true,
        intent: "fulfill",
        as: "last",
      },
      {
        operation: "sketch.geometry.update",
        basis: { alias: "last" },
        draft: { alias: "last" },
        edit: {
          kind: "extend",
          target: { alias: "line", label: labels[0] },
          boundary: { alias: "last", label: labels[3] },
        },
        intent: "fulfill",
        as: "extended",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "extended" },
        draft: { alias: "extended" },
        requireProfiles: false,
      },
    ].map((c, i) => ({ version: 1, commandId: `intersection-${i}`, ...c }));
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations: commands }));
    const output = await promisify(execFile)(
      "bun",
      ["src/cli/main.ts", "document", "recipe", path],
      { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
    );
    const results: SemanticResult[] = JSON.parse(output.stdout).results;
    expect(results).toHaveLength(commands.length);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      commands.map((c) => c.commandId),
    );
    for (const r of results) {
      expect(r.outcome.kind).toBe("completed");
      expect(validateSemanticResult(r.correlation, r).success).toBe(true);
    }
    for (const [index, expected] of [
      [
        5,
        [
          [
            [0, 0],
            [3, 0],
          ],
          [
            [7, 0],
            [10, 0],
          ],
        ],
      ],
      [
        7,
        [
          [
            [0, 0],
            [7, 0],
          ],
          [
            [7, 0],
            [10, 0],
          ],
        ],
      ],
      [
        10,
        [
          [
            [0, 0],
            [15, 0],
          ],
        ],
      ],
    ] as const) {
      const r = results[index]!;
      const s = r.discovery!.sketch!;
      expect(
        s.entities
          .filter((e) => !e.construction)
          .map((e) =>
            e.pointIds.map(
              (id) => s.points.find((p) => p.pointId === id)!.position,
            ),
          ),
      ).toEqual(expected);
      expect(r.completion.geometry.kind).toBe("current");
      if (r.completion.geometry.kind === "not-required")
        throw new Error("Missing geometry receipt");
      expect(r.completion.geometry.editQuery!.generation).toBe(
        results[index - 1]!.discovery!.state.draft!.generation,
      );
      expect(r.completion.geometry.derivation!.generation).toBe(
        r.discovery!.state.draft!.generation,
      );
      expect(r.discovery!.history!.undoEntries).toHaveLength(
        results[index - 1]!.discovery!.history!.undoEntries!.length + 1,
      );
    }
    expect(results[6]!.discovery!.sketch!.entities).toEqual(
      results[4]!.discovery!.sketch!.entities,
    );
    expect(results[8]!.discovery!.sketch!.entities).toEqual(
      results[4]!.discovery!.sketch!.entities,
    );
    const refusal = async (boundary: { alias: string; label: string }) => {
      const operations = commands.map((c) =>
        c.operation === "sketch.geometry.update" && c.edit?.kind === "split"
          ? { ...c, edit: { ...c.edit, boundary } }
          : c,
      );
      await writeFile(path, JSON.stringify({ version: 1, operations }));
      return promisify(execFile)(
        "bun",
        ["src/cli/main.ts", "document", "recipe", path],
        { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
      ).then(
        () => {
          throw new Error("Expected boundary refusal.");
        },
        (error: { code: number; stdout: string; stderr: string }) => error,
      );
    };
    const missing = await refusal({
      alias: "second",
      label: "Missing boundary",
    });
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain("missing or ambiguous");
    const envelope = JSON.parse(missing.stdout);
    expect(
      envelope.results.map((r: SemanticResult) => r.correlation.commandId),
    ).toEqual(commands.slice(0, 7).map((c) => c.commandId));
    expect(envelope.unexecuted).toEqual(
      commands.slice(7).map((c) => c.commandId),
    );
    const unknown = await refusal({
      alias: "unknown",
      label: "Missing boundary",
    });
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
    expect(unknown.stderr).toContain("Unknown or ambiguous target alias");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
