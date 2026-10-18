import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
const exec = promisify(execFile);

it("runs an exact-profile extrusion and depth edit through Bun recipe aliases", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-extrusion-"));
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
        operation: "sketch.publish",
        basis: { alias: "rectangle" },
        draft: { alias: "rectangle" },
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
    const bounds = results[5]!.discovery!.model!.bodies[0]!.bounds!;
    expect(bounds.max[0]! - bounds.min[0]!).toBeCloseTo(20, 6);
    expect(bounds.max[1]! - bounds.min[1]!).toBeCloseTo(10, 6);
    expect(bounds.max[2]! - bounds.min[2]!).toBeCloseTo(12, 6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);

it.each(["missing", "ambiguous"] as const)(
  "refuses a %s profile selector rather than choosing by list order",
  async (kind) => {
    const directory = await mkdtemp(
      resolve(tmpdir(), "cadara-extrusion-refused-"),
    );
    try {
      const operations = [
        {
          operation: "document.create",
          label: "Plate",
          basis: null,
          as: "part",
        },
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
          operation: "sketch.publish",
          basis: { alias: "rectangle" },
          draft: { alias: "rectangle" },
          requireProfiles: true,
          as: kind === "ambiguous" ? "first" : "published",
        },
        ...(kind === "ambiguous"
          ? [
              {
                operation: "sketch.begin",
                basis: { alias: "first" },
                plane: "xy",
                as: "secondDraft",
              },
              {
                operation: "sketch.author",
                basis: { alias: "secondDraft" },
                draft: { alias: "secondDraft" },
                primitive: { kind: "rectangle", start: [40, 0], end: [60, 10] },
                construction: false,
                intent: "fulfill",
                as: "second",
              },
              {
                operation: "sketch.publish",
                basis: { alias: "second" },
                draft: { alias: "second" },
                requireProfiles: true,
                as: "published",
              },
            ]
          : []),
        {
          operation: "extrude.create",
          basis: { alias: "published" },
          profile: {
            alias: "published",
            label: kind === "ambiguous" ? "Outer region" : "Missing region",
          },
          depth: 7,
          intent: "fulfill",
        },
      ].map((command, index) => ({
        version: 1,
        commandId: `command-${index}`,
        ...command,
      }));
      const path = resolve(directory, "recipe.json");
      await writeFile(path, JSON.stringify({ version: 1, operations }));
      const failure = await exec(
        "bun",
        [cliEntry(), "document", "recipe", path],
        { cwd: resolve(import.meta.dirname, "../.."), timeout: 90000 },
      ).then(
        () => {
          throw new Error("Expected command failure");
        },
        (error) => error as { code: number; stdout: string; stderr: string },
      );
      expect(failure.code).toBe(1);
      expect(failure.stderr).toContain(
        "Profile target alias is missing or ambiguous.",
      );
      const receipt = JSON.parse(failure.stdout);
      expect(receipt.results).toHaveLength(operations.length - 1);
      expect(
        receipt.results.every(
          (r: SemanticResult) => r.outcome.kind === "completed",
        ),
      ).toBe(true);
      expect(receipt.results.at(-1).discovery.model.bodies).toEqual([]);
      if (kind === "ambiguous")
        expect(
          receipt.results
            .at(-1)
            .discovery.references.filter(
              (r: { label: string; target: { kind: string } }) =>
                r.label === "Outer region" && r.target.kind === "region",
            ),
        ).toHaveLength(2);
      expect(receipt.unexecuted).toEqual([operations.at(-1)!.commandId]);
      expect(receipt.cleanup.resourcesReleased).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  120000,
);
