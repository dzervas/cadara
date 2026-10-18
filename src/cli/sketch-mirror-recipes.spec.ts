import { expect, test } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

async function createMirrorRecipeProcess() {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-mirror-"));
  return {
    async invoke(operations: Record<string, unknown>[]) {
      const path = resolve(dir, "recipe.json");
      await writeFile(path, JSON.stringify({ version: 1, operations }));
      try {
        return {
          code: 0,
          ...(await promisify(execFile)(
            "bun",
            [cliEntry(), "document", "recipe", path],
            { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
          )),
        };
      } catch (error) {
        return error as { code: number; stdout: string; stderr: string };
      }
    },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}

test("real Bun recipes create, repair and remove discovered mirrors with exact alias failure policy", async () => {
  const primitive = { kind: "circle", center: [4, 3], radius: 2 };
  const w = await createSketchWorkflow();
  let label: string;
  let mirrorLabel: string;
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive,
      construction: false,
      intent: "fulfill",
    });
    const seed = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!;
    label = seed.label;
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [seed.target],
      axis: source.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch Y axis",
      )!.target,
      intent: "fulfill",
    });
    mirrorLabel = mirrored.discovery!.sketch!.mirrors[0]!.label;
  } finally {
    await w.close();
  }
  const process = await createMirrorRecipeProcess();
  const { invoke } = process;
  const commands: Record<string, unknown>[] = [
    {
      operation: "document.create",
      label: "Mirrors",
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
      operation: "sketch.mirror.create",
      basis: { alias: "circle" },
      draft: { alias: "circle" },
      targets: [{ alias: "circle", label }],
      axis: { alias: "circle", label: "Sketch Y axis" },
      intent: "fulfill",
      as: "mirror",
    },
    {
      operation: "sketch.mirror.repair",
      basis: { alias: "mirror" },
      draft: { alias: "mirror" },
      derivationId: { alias: "mirror", label: mirrorLabel },
      repair: {
        kind: "axis",
        target: { alias: "mirror", label: "Sketch X axis" },
      },
      intent: "fulfill",
      as: "repaired",
    },
    {
      operation: "sketch.mirror.remove",
      basis: { alias: "repaired" },
      draft: { alias: "repaired" },
      derivationId: { alias: "repaired", label: mirrorLabel },
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
      operation: "sketch.publish",
      basis: { alias: "restored" },
      draft: { alias: "restored" },
      requireProfiles: true,
    },
  ].map((c, i) => ({ version: 1, commandId: `mirror-${i}`, ...c }));
  try {
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
    expect(
      results[3]!.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position,
    ).toEqual([-4, 3]);
    expect(
      results[4]!.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position,
    ).toEqual([4, -3]);
    expect(results[3]!.discovery!.history!.undoEntries!).toHaveLength(
      results[2]!.discovery!.history!.undoEntries!.length + 1,
    );
    expect(results[5]!.discovery!.sketch!.profiles).toHaveLength(1);
    expect(results[6]!.discovery!.sketch!.mirrors[0]!.derivationId).toBe(
      results[3]!.discovery!.sketch!.mirrors[0]!.derivationId,
    );
    expect(results[7]!.discovery!.sketch!.profiles).toHaveLength(2);
    for (const [index, replacement] of [
      [3, { axis: { alias: "circle", label: "absent axis" } }],
      [4, { derivationId: { alias: "mirror", label: "absent relationship" } }],
      [
        4,
        {
          repair: {
            kind: "axis",
            target: { alias: "mirror", label: "absent repair axis" },
          },
        },
      ],
      [
        5,
        {
          derivationId: {
            alias: "repaired",
            label: "absent removal relationship",
          },
        },
      ],
    ] as const) {
      const altered = commands.map((c, i) =>
        i === index ? { ...c, ...replacement } : c,
      );
      const failure = await invoke(altered);
      expect(failure.code).toBe(1);
      const output = JSON.parse(failure.stdout);
      expect(output.results).toHaveLength(index);
      expect(output.unexecuted).toEqual(
        commands.slice(index).map((c) => c.commandId),
      );
    }
    for (const [index, replacement] of [
      [3, { axis: { alias: "unknown", label: "Sketch Y axis" } }],
      [4, { derivationId: { alias: "unknown", label: mirrorLabel } }],
      [
        4,
        {
          repair: {
            kind: "axis",
            target: { alias: "unknown", label: "Sketch X axis" },
          },
        },
      ],
    ] as const) {
      const failure = await invoke(
        commands.map((c, i) => (i === index ? { ...c, ...replacement } : c)),
      );
      expect(failure.code).toBe(2);
      expect(failure.stdout).toBe("");
    }
  } finally {
    await process.close();
  }
}, 180_000);

test("Bun original repair resolves both replacement and output aliases without retargeting the copy", async () => {
  const w = await createSketchWorkflow();
  const primitive = { kind: "circle", center: [4, 3], radius: 2 };
  const replacement = { kind: "circle", center: [10, 5], radius: 3 };
  let seedLabel: string;
  let copyLabel: string;
  let mirrorLabel: string;
  let replacementLabel: string;
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive,
      construction: false,
      intent: "fulfill",
    });
    const seed = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!;
    seedLabel = seed.label;
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [seed.target],
      axis: source.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch Y axis",
      )!.target,
      intent: "fulfill",
    });
    const mirror = mirrored.discovery!.sketch!.mirrors[0]!;
    mirrorLabel = mirror.label;
    copyLabel = mirrored.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === mirror.outputEntityIds[0],
    )!.label;
    const next = await w.execute({
      operation: "sketch.author",
      draft: mirrored.discovery!.state.draft,
      primitive: replacement,
      construction: false,
      intent: "fulfill",
    });
    replacementLabel = next.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === next.discovery!.sketch!.entities.at(-1)!.entityId,
    )!.label;
  } finally {
    await w.close();
  }
  const commands: Record<string, unknown>[] = [
    {
      operation: "document.create",
      label: "Repair originals",
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
      operation: "sketch.mirror.create",
      basis: { alias: "circle" },
      draft: { alias: "circle" },
      targets: [{ alias: "circle", label: seedLabel }],
      axis: { alias: "circle", label: "Sketch Y axis" },
      intent: "fulfill",
      as: "mirror",
    },
    {
      operation: "sketch.author",
      basis: { alias: "mirror" },
      draft: { alias: "mirror" },
      primitive: replacement,
      construction: false,
      intent: "fulfill",
      as: "replacement",
    },
    {
      operation: "sketch.mirror.repair",
      basis: { alias: "replacement" },
      draft: { alias: "replacement" },
      derivationId: { alias: "replacement", label: mirrorLabel },
      repair: {
        kind: "original",
        target: { alias: "replacement", label: replacementLabel },
        output: { alias: "replacement", label: copyLabel },
      },
      intent: "fulfill",
      as: "repaired",
    },
    {
      operation: "sketch.publish",
      basis: { alias: "repaired" },
      draft: { alias: "repaired" },
      requireProfiles: true,
    },
  ].map((c, i) => ({ version: 1, commandId: `original-${i}`, ...c }));
  const process = await createMirrorRecipeProcess();
  try {
    const success = await process.invoke(commands);
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
    const original = results[3]!.discovery!.sketch!.mirrors[0]!;
    const repaired = results[5]!.discovery!.sketch!.mirrors[0]!;
    expect(repaired.derivationId).toBe(original.derivationId);
    expect(repaired.outputEntityIds).toEqual(original.outputEntityIds);
    expect(repaired.currentGeometry![0]!.points[0]!.position).toEqual([-10, 5]);
    expect(repaired.currentGeometry![0]!.radius).toBe(3);
    expect(results[6]!.discovery!.sketch!.profiles).toHaveLength(3);
    for (const key of ["target", "output"] as const) {
      for (const unknown of [false, true]) {
        const changed = commands.map((c, i) =>
          i === 5
            ? {
                ...c,
                repair: {
                  ...(c.repair as Record<string, unknown>),
                  [key]: {
                    alias: unknown ? "unknown" : "replacement",
                    label: "absent",
                  },
                },
              }
            : c,
        );
        const failure = await process.invoke(changed);
        expect(failure.code).toBe(unknown ? 2 : 1);
        if (unknown) expect(failure.stdout).toBe("");
        else {
          const output = JSON.parse(failure.stdout);
          expect(output.results).toHaveLength(5);
          expect(output.unexecuted).toEqual(
            commands.slice(5).map((c) => c.commandId),
          );
        }
      }
    }
  } finally {
    await process.close();
  }
}, 180_000);
