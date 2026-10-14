import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import { createSketchWorkflow } from "../../test/helpers/semantic-sketch-workflow";

test("actual Bun style/image recipes use discovered aliases, retain raster bytes and enforce 0/1/2 failure policy", async () => {
  const primitive = { kind: "circle", center: [4, 3], radius: 2 };
  const w = await createSketchWorkflow();
  let circleLabel: string;
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive,
      construction: false,
      intent: "fulfill",
    });
    circleLabel = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.label;
  } finally {
    await w.close();
  }
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-style-images-"));
  const path = resolve(dir, "reference.png");
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jK1kAAAAASUVORK5CYII=";
  await writeFile(path, Buffer.from(png, "base64"));
  const commands: Record<string, unknown>[] = [
    {
      operation: "document.create",
      label: "Images",
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
      operation: "sketch.style.patch",
      basis: { alias: "circle" },
      draft: { alias: "circle" },
      targets: [{ alias: "circle", label: circleLabel }],
      patch: { field: "strokeWidth", value: 3 },
      intent: "fulfill",
      as: "styled",
    },
    {
      operation: "sketch.image.add",
      basis: { alias: "styled" },
      draft: { alias: "styled" },
      path,
      intent: "fulfill",
      as: "image",
    },
    {
      operation: "sketch.image.update",
      basis: { alias: "image" },
      draft: { alias: "image" },
      target: { alias: "image", label: "reference.png" },
      edit: {
        kind: "placement",
        placement: {
          center: [10, 20],
          width: 80,
          height: 40,
          rotationRadians: 0,
        },
      },
      intent: "fulfill",
      as: "placed",
    },
    {
      operation: "sketch.image.replace",
      basis: { alias: "placed" },
      draft: { alias: "placed" },
      target: { alias: "image", label: "reference.png" },
      path,
      intent: "fulfill",
      as: "replaced",
    },
    {
      operation: "sketch.image.remove",
      basis: { alias: "replaced" },
      draft: { alias: "replaced" },
      target: { alias: "replaced", label: "reference.png" },
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
  ].map((c, i) => ({ version: 1, commandId: `style-image-${i}`, ...c }));
  async function invoke(operations: Record<string, unknown>[]) {
    const recipe = resolve(dir, "recipe.json");
    await writeFile(recipe, JSON.stringify({ version: 1, operations }));
    try {
      return {
        code: 0,
        ...(await promisify(execFile)(
          "bun",
          ["src/cli/main.ts", "document", "recipe", recipe],
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
    expect(results[3]!.discovery!.sketch!.entities[0]!.style).toEqual({
      strokeWidth: 3,
    });
    expect(
      results[5]!.discovery!.sketch!.referenceImages![0]!.ownedState.placement,
    ).toEqual({ center: [10, 20], width: 80, height: 40, rotationRadians: 0 });
    expect(results[7]!.discovery!.sketch!.referenceImages).toEqual([]);
    expect(
      results[8]!.discovery!.sketch!.referenceImages![0]!.operationId,
    ).toBe(results[4]!.discovery!.sketch!.referenceImages![0]!.operationId);
    expect(
      results[9]!.discovery!.sketch!.referenceImages![0]!.ownedState.image
        .base64Data,
    ).toBe(png);
    expect(results[9]!.discovery!.sketch!.profiles).toHaveLength(1);
    const missing = await invoke(
      commands.map((c, i) =>
        i === 5
          ? { ...c, target: { alias: "image", label: "absent image" } }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    const output = JSON.parse(missing.stdout);
    expect(output.results).toHaveLength(5);
    expect(output.unexecuted).toEqual(
      commands.slice(5).map((c) => c.commandId),
    );
    for (const index of [3, 5, 6, 7]) {
      const unknown = await invoke(
        commands.map((c, i) =>
          i === index
            ? index === 3
              ? { ...c, targets: [{ alias: "unknown", label: circleLabel }] }
              : { ...c, target: { alias: "unknown", label: "reference.png" } }
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
