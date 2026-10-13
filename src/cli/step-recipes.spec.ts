import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SemanticResult } from "@/contracts/semantic/schema";
const exec = promisify(execFile);

it("a real Bun recipe resolves the solid target and keeps native STEP progress out of JSON stdout", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-step-recipe-"));
  try {
    const output = join(directory, "plate.step");
    const commands = [
      {
        operation: "document.create",
        label: "Plate",
        basis: null,
        as: "document",
      },
      {
        operation: "sketch.begin",
        plane: "xy",
        basis: { alias: "document" },
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
        operation: "document.save",
        basis: { alias: "solid" },
        path: join(directory, "plate.cadara"),
      },
    ].map((command, index) => ({
      version: 1,
      commandId: `export-${index}`,
      ...command,
    }));
    const recipe = join(directory, "recipe.json");
    await writeFile(
      recipe,
      JSON.stringify({ version: 1, operations: commands }),
    );
    const invocation = ["src/cli/main.ts", "document", "recipe", recipe];
    const options = {
      cwd: resolve(import.meta.dirname, "../.."),
      timeout: 90000,
    };
    const authored = await exec("bun", invocation, options);
    const initial: SemanticResult[] = JSON.parse(authored.stdout).results;
    expect(initial.map((result) => result.outcome.kind)).toEqual(
      Array(6).fill("completed"),
    );
    const body = initial[4]!.discovery!.references.find(
      (reference) => reference.target.kind === "body",
    )!;
    await writeFile(
      recipe,
      JSON.stringify({
        version: 1,
        operations: [
          {
            version: 1,
            commandId: "open",
            operation: "document.open",
            basis: null,
            path: join(directory, "plate.cadara"),
            as: "opened",
          },
          {
            version: 1,
            commandId: "step",
            operation: "export.step",
            basis: { alias: "opened" },
            target: { alias: "opened", label: body.label },
            options: { schema: "AP242", unit: "millimeter" },
            path: output,
          },
        ],
      }),
    );
    const process = await exec("bun", invocation, options);
    const results: SemanticResult[] = JSON.parse(process.stdout).results;
    expect(results.map((result) => result.outcome.kind)).toEqual([
      "completed",
      "completed",
    ]);
    expect(results[1]!.correlation.family).toBe("export");
    const text = await readFile(output, "utf8");
    expect(text).toContain("MANIFOLD_SOLID_BREP");
    expect(text).toContain("AP242");
    expect(results[1]!.completion.file).toMatchObject({
      kind: "written",
      path: output,
      bytesWritten: Buffer.byteLength(text),
    });
    expect(process.stderr).not.toContain("Unhandled");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
