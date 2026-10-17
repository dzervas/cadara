import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

test("real Bun resolves explicit support, reassignment and external source aliases with clean JSON and failure policy", async () => {
  const w = await createSketchWorkflow();
  let circleLabel: string;
  let sketchLabel: string;
  try {
    const authored = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: authored.discovery!.state.draft,
      requireProfiles: true,
    });
    circleLabel = published.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.label;
    sketchLabel = published.discovery!.references.find(
      (r) => r.target.kind === "sketch",
    )!.label;
  } finally {
    await w.close();
  }
  const commands: Record<string, unknown>[] = [
    {
      operation: "document.create",
      basis: null,
      label: "Supports",
      as: "document",
    },
    {
      operation: "sketch.begin",
      basis: { alias: "document" },
      support: { alias: "document", label: "Front Plane" },
      as: "draft",
    },
    {
      operation: "sketch.author",
      basis: { alias: "draft" },
      draft: { alias: "draft" },
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
      as: "circle",
    },
    {
      operation: "sketch.publish",
      basis: { alias: "circle" },
      draft: { alias: "circle" },
      requireProfiles: true,
      as: "source",
    },
    {
      operation: "sketch.support.reassign",
      basis: { alias: "source" },
      sketchId: { alias: "source", label: sketchLabel },
      support: { alias: "source", label: "Top Plane" },
      as: "reassigned",
    },
    {
      operation: "sketch.begin",
      basis: { alias: "reassigned" },
      support: { alias: "reassigned", label: "Top Plane" },
      as: "target",
    },
    {
      operation: "sketch.reference.add",
      basis: { alias: "target" },
      draft: { alias: "target" },
      target: { alias: "source", label: circleLabel },
      intent: "fulfill",
      as: "projected",
    },
    {
      operation: "sketch.author",
      basis: { alias: "projected" },
      draft: { alias: "projected" },
      primitive: { kind: "point", position: [9, 9] },
      construction: false,
      intent: "fulfill",
      as: "point",
    },
    {
      operation: "sketch.publish",
      basis: { alias: "point" },
      draft: { alias: "point" },
      requireProfiles: false,
    },
  ].map((c, i) => ({ version: 1, commandId: `support-${i}`, ...c }));
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-support-"));
  async function invoke(operations: Record<string, unknown>[]) {
    const path = resolve(dir, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    try {
      return {
        code: 0,
        ...(await promisify(execFile)(
          "bun",
          ["src/cli/main.ts", "document", "recipe", path],
          { cwd: resolve(import.meta.dirname, "../.."), timeout: 90_000 },
        )),
      };
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string };
    }
  }
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
    expect(results[1]!.discovery!.sketch!.plane).toBe("xz");
    expect(results[4]!.completion.persistence.kind).toBe("committed");
    expect(results[5]!.discovery!.sketch!.plane).toBe("xy");
    expect(
      results[6]!.discovery!.sketch!.references![0]!.projection!.geometry,
    ).toEqual([
      expect.objectContaining({
        kind: "circle",
        centerPosition: [4, 3],
        radius: 2,
      }),
    ]);
    const missing = await invoke(
      commands.map((c, i) =>
        i === 6
          ? { ...c, target: { alias: "source", label: "absent source" } }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).results).toHaveLength(6);
    expect(JSON.parse(missing.stdout).unexecuted).toEqual(
      commands.slice(6).map((c) => c.commandId),
    );
    for (const index of [1, 4, 5, 6]) {
      const unknown = await invoke(
        commands.map((c, i) =>
          i === index
            ? {
                ...c,
                [index === 6 ? "target" : "support"]: {
                  alias: "unknown",
                  label: "Top Plane",
                },
              }
            : c,
        ),
      );
      expect(unknown.code).toBe(2);
      expect(unknown.stdout).toBe("");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
