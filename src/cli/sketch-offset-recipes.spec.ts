import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

test("a real Bun recipe certifies a durable offset, publishes it and preserves alias failure policy", async () => {
  const primitive = { kind: "circle", center: [0, 0], radius: 5 };
  const w = await createSketchWorkflow();
  let label: string;
  let offsetLabel: string;
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive,
      construction: false,
      intent: "fulfill",
    });
    label = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.label;
    const offset = await w.execute({
      operation: "sketch.offset.create",
      draft: source.discovery!.state.draft,
      targets: [
        source.discovery!.references.find(
          (r) => r.target.kind === "sketchEntity",
        )!.target,
      ],
      distance: 2,
      side: "right",
      intent: "fulfill",
    });
    offsetLabel = offset.discovery!.sketch!.offsets[0]!.label;
  } finally {
    await w.close();
  }
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-offset-"));
  const invoke = async (commands: Record<string, unknown>[]) => {
    const path = resolve(directory, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations: commands }));
    try {
      const result = await promisify(execFile)(
        "bun",
        ["src/cli/main.ts", "document", "recipe", path],
        { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
      );
      return { code: 0, ...result };
    } catch (error) {
      const failure = error as { code: number; stdout: string; stderr: string };
      return failure;
    }
  };
  try {
    const commands = [
      {
        operation: "document.create",
        label: "Offsets",
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
        as: "circle",
      },
      {
        operation: "sketch.offset.create",
        basis: { alias: "circle" },
        draft: { alias: "circle" },
        targets: [{ alias: "circle", label }],
        distance: 2,
        side: "right",
        intent: "fulfill",
        as: "offset",
      },
      {
        operation: "sketch.offset.remove",
        basis: { alias: "offset" },
        draft: { alias: "offset" },
        derivationId: { alias: "offset", label: offsetLabel },
        intent: "fulfill",
        as: "removed",
      },
      {
        operation: "history.undo",
        basis: { alias: "removed" },
        draft: { alias: "removed" },
        as: "restored",
      },
      {
        operation: "history.redo",
        basis: { alias: "restored" },
        draft: { alias: "restored" },
        as: "removedAgain",
      },
      {
        operation: "history.undo",
        basis: { alias: "removedAgain" },
        draft: { alias: "removedAgain" },
        as: "restoredAgain",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "restoredAgain" },
        draft: { alias: "restoredAgain" },
        requireProfiles: true,
      },
    ].map((command, i) => ({
      version: 1,
      commandId: `offset-${i}`,
      ...command,
    }));
    const success = await invoke(commands);
    expect(success.code, success.stderr).toBe(0);
    const results: SemanticResult[] = JSON.parse(success.stdout).results;
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      commands.map((c) => c.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    const offset = results[3]!;
    expect(
      offset.discovery!.sketch!.offsets[0]!.currentGeometry![0]!.radius,
    ).toBe(7);
    expect(offset.discovery!.sketch!.offsets[0]!.health.kind).toBe("healthy");
    expect(offset.discovery!.sketch!.profiles).toHaveLength(2);
    expect(offset.discovery!.history!.undoEntries!).toHaveLength(
      results[2]!.discovery!.history!.undoEntries!.length + 1,
    );
    expect(results[4]!.discovery!.sketch!.offsets).toEqual([]);
    expect(results[4]!.discovery!.sketch!.profiles).toHaveLength(1);
    expect(results[5]!.discovery!.sketch!.offsets[0]!.derivationId).toBe(
      offset.discovery!.sketch!.offsets[0]!.derivationId,
    );
    expect(
      results[5]!.discovery!.sketch!.offsets[0]!.currentGeometry![0]!.radius,
    ).toBe(7);
    expect(results[6]!.discovery!.sketch!.offsets).toEqual([]);
    expect(
      results[7]!.discovery!.sketch!.offsets[0]!.currentGeometry![0]!.radius,
    ).toBe(7);
    const missing = commands.map((c) =>
      c.operation === "sketch.offset.create"
        ? { ...c, targets: [{ alias: "circle", label: "missing-offset-seed" }] }
        : c,
    );
    const refused = await invoke(missing);
    expect(refused.code).toBe(1);
    const prefix = JSON.parse(refused.stdout);
    expect(prefix.results).toHaveLength(3);
    expect(prefix.unexecuted).toEqual(
      commands.slice(3).map((c) => c.commandId),
    );
    const unknown = commands.map((c) =>
      c.operation === "sketch.offset.create"
        ? { ...c, targets: [{ alias: "unknown", label }] }
        : c,
    );
    const usage = await invoke(unknown);
    expect(usage.code).toBe(2);
    expect(usage.stdout).toBe("");
    const missingRelationship = await invoke(
      commands.map((c) =>
        c.operation === "sketch.offset.remove"
          ? { ...c, derivationId: { alias: "offset", label: "missing-offset" } }
          : c,
      ),
    );
    expect(missingRelationship.code).toBe(1);
    const removalPrefix = JSON.parse(missingRelationship.stdout);
    expect(removalPrefix.results).toHaveLength(4);
    expect(removalPrefix.unexecuted).toEqual(
      commands.slice(4).map((c) => c.commandId),
    );
    const unknownRelationship = await invoke(
      commands.map((c) =>
        c.operation === "sketch.offset.remove"
          ? { ...c, derivationId: { alias: "unknown", label: offsetLabel } }
          : c,
      ),
    );
    expect(unknownRelationship.code).toBe(2);
    expect(unknownRelationship.stdout).toBe("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
