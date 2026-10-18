import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
const exec = promisify(execFile);

it("resolves canonical dimension targets from immutable recipe discoveries, then drives and publishes", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-dimensions-"));
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
        operation: "sketch.dimension.add",
        basis: { alias: "rectangle" },
        draft: { alias: "rectangle" },
        axis: "horizontal",
        points: [
          { alias: "rectangle", label: "Rectangle 1 bottom left" },
          { alias: "rectangle", label: "Rectangle 1 bottom right" },
        ],
        mode: "driving",
        value: 30,
        intent: "fulfill",
        as: "width",
      },
      {
        operation: "sketch.dimension.update",
        basis: { alias: "width" },
        draft: { alias: "width" },
        dimensionId: { alias: "width", label: "Horizontal distance 2" },
        value: 45,
        intent: "fulfill",
        as: "updated",
      },
      {
        operation: "sketch.publish",
        basis: { alias: "updated" },
        draft: { alias: "updated" },
        requireProfiles: true,
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
      Array(6).fill("completed"),
    );
    expect(
      results[4]!.discovery!.sketch!.requirements[0]!.measuredValue,
    ).toBeCloseTo(45, 6);
    expect(results[5]!.discovery!.sketch!.requirements[0]!.dimensionId).toBe(
      results[4]!.discovery!.sketch!.requirements[0]!.dimensionId,
    );
    expect(results[5]!.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
