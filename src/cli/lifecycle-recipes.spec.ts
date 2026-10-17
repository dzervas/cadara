import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

test("real Bun lifecycle recipes resolve feature, body and timeline aliases and retain native lifecycle state", async () => {
  const w = await createSketchWorkflow();
  let regionLabel: string;
  let featureLabel: string;
  let bodyLabel: string;
  let sketchLabel: string;
  let deletionLabel: string;
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    regionLabel = published.discovery!.references.find(
      (r) => r.target.kind === "region",
    )!.label;
    sketchLabel = published.discovery!.references.find(
      (r) => r.target.kind === "sketch",
    )!.label;
    const sketch = published.discovery!.sketch!;
    const solid = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 7,
      intent: "fulfill",
    });
    featureLabel = solid.discovery!.model!.features[0]!.label;
    const body = solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!;
    bodyLabel = body.label;
    const deleted = await w.execute({
      operation: "target.delete",
      target: body.target,
      intent: "fulfill",
    });
    deletionLabel = deleted.discovery!.model!.features.find(
      (f) => f.kind === "deleteSolid",
    )!.label;
  } finally {
    await w.close();
  }
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-lifecycle-recipes-"));
  const target = (alias: string, label: string) => ({ alias, label });
  const basis = (alias: string) => ({ alias });
  const commands: Record<string, unknown>[] = [
    {
      operation: "document.create",
      basis: null,
      label: "Lifecycle",
      as: "doc",
    },
    {
      operation: "sketch.begin",
      basis: basis("doc"),
      plane: "xy",
      as: "draft",
    },
    {
      operation: "sketch.author",
      basis: basis("draft"),
      draft: basis("draft"),
      primitive: { kind: "circle", center: [0, 0], radius: 2 },
      construction: false,
      intent: "fulfill",
      as: "circle",
    },
    {
      operation: "sketch.publish",
      basis: basis("circle"),
      draft: basis("circle"),
      requireProfiles: true,
      as: "published",
    },
    {
      operation: "extrude.create",
      basis: basis("published"),
      profile: target("published", regionLabel),
      depth: 7,
      intent: "fulfill",
      as: "solid",
    },
    {
      operation: "body.rename",
      basis: basis("solid"),
      bodyId: target("solid", bodyLabel),
      label: "Sleeve",
      intent: "fulfill",
      as: "renamed",
    },
    {
      operation: "feature.suppression.set",
      basis: basis("renamed"),
      featureId: target("solid", featureLabel),
      suppressed: true,
      intent: "fulfill",
      as: "suppressed",
    },
    {
      operation: "document.save",
      basis: basis("suppressed"),
      path: resolve(dir, "suppressed.cadara"),
      as: "saved",
    },
    {
      operation: "document.open",
      basis: null,
      path: resolve(dir, "suppressed.cadara"),
      as: "opened",
    },
    {
      operation: "feature.suppression.set",
      basis: basis("opened"),
      featureId: target("opened", featureLabel),
      suppressed: false,
      intent: "fulfill",
      as: "restored",
    },
    {
      operation: "timeline.cursor.set",
      basis: basis("restored"),
      cursor: target("published", sketchLabel),
      intent: "fulfill",
      as: "rolled",
    },
    {
      operation: "document.save",
      basis: basis("rolled"),
      path: resolve(dir, "cursor.cadara"),
    },
    {
      operation: "document.open",
      basis: null,
      path: resolve(dir, "cursor.cadara"),
      as: "cursorOpened",
    },
    {
      operation: "timeline.cursor.set",
      basis: basis("cursorOpened"),
      cursor: target("opened", featureLabel),
      intent: "fulfill",
      as: "tail",
    },
    {
      operation: "feature.reorder",
      basis: basis("tail"),
      featureId: target("opened", featureLabel),
      beforeFeatureId: null,
      intent: "fulfill",
      as: "ordered",
    },
    {
      operation: "timeline.reorder",
      basis: basis("ordered"),
      item: target("opened", featureLabel),
      beforeItem: null,
      intent: "fulfill",
      as: "timeline",
    },
    {
      operation: "target.delete",
      basis: basis("timeline"),
      target: target("tail", "Sleeve"),
      intent: "fulfill",
      as: "deleted",
    },
    {
      operation: "feature.delete",
      basis: basis("deleted"),
      featureId: target("deleted", deletionLabel),
      intent: "fulfill",
      as: "removed",
    },
    { operation: "document.inspect", basis: basis("removed") },
  ].map((c, i) => ({ version: 1, commandId: `lifecycle-${i}`, ...c }));
  async function invoke(operations: Record<string, unknown>[]) {
    const path = resolve(dir, "recipe.json");
    await writeFile(path, JSON.stringify({ version: 1, operations }));
    try {
      return {
        code: 0,
        ...(await promisify(execFile)(
          "bun",
          ["src/cli/main.ts", "document", "recipe", path],
          {
            cwd: resolve(import.meta.dirname, "../.."),
            timeout: 90_000,
            env: { ...process.env, NODE_ENV: "production", TEST: "false" },
          },
        )),
      };
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string };
    }
  }
  try {
    const success = await invoke(commands);
    expect(success.code, success.stderr + success.stdout).toBe(0);
    const output = JSON.parse(success.stdout);
    const results: SemanticResult[] = output.results;
    expect(output.cleanup.kind).toBe("closed");
    expect(output.unexecuted).toEqual([]);
    expect(results.map((r) => r.correlation.commandId)).toEqual(
      commands.map((c) => c.commandId),
    );
    for (const result of results) {
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    for (const i of [6, 8]) {
      expect(results[i]!.discovery!.model!.features[0]!.suppressed).toBe(true);
      expect(results[i]!.discovery!.model!.bodies).toEqual([]);
    }
    for (const i of [9, 13]) {
      expect(results[i]!.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
        2, 2, 7,
      ]);
      expect(
        results[i]!.discovery!.references.some(
          (r) => r.label === "Sleeve" && r.target.kind === "body",
        ),
      ).toBe(true);
    }
    expect(results[12]!.discovery!.model!.cursor).toEqual(
      results[10]!.discovery!.model!.cursor,
    );
    expect(results[12]!.discovery!.model!.bodies).toEqual([]);
    expect(results[12]!.discovery!.model!.features).toHaveLength(1);
    expect(results[16]!.discovery!.model!.bodies).toEqual([]);
    expect(results[18]!.discovery!.model!.features.map((f) => f.kind)).toEqual([
      "extrude",
    ]);
    expect(results[18]!.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      2, 2, 7,
    ]);
    const missing = await invoke(
      commands.map((c, i) =>
        i === 5 ? { ...c, bodyId: target("solid", "missing") } : c,
      ),
    );
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.results).toHaveLength(5);
    expect(failed.unexecuted).toEqual(
      commands.slice(5).map((c) => c.commandId),
    );
    expect(failed.cleanup.kind).toBe("closed");
    const unknown = await invoke(
      commands.map((c, i) =>
        i === 5 ? { ...c, bodyId: target("unknown", bodyLabel) } : c,
      ),
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
