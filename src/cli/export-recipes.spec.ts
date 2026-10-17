import { expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
const exec = promisify(execFile);

it("real Bun exports all provider formats with byte-truthful JSON, exact target aliases and 0/1/2 exit behavior", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-export-recipe-"));
  try {
    const recipe = join(directory, "recipe.json");
    const native = join(directory, "plate.cadara");
    const invocation = ["src/cli/main.ts", "document", "recipe", recipe];
    const options = {
      cwd: resolve(import.meta.dirname, "../.."),
      timeout: 90000,
    };
    const prefix = [
      {
        operation: "document.create",
        label: "Exports",
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
      { operation: "document.save", basis: { alias: "solid" }, path: native },
    ];
    async function save(operations: readonly unknown[]) {
      await writeFile(
        recipe,
        JSON.stringify({
          version: 1,
          operations: operations.map((op, index) => ({
            version: 1,
            commandId: `exports-${index}`,
            ...(op as object),
          })),
        }),
      );
    }
    await save(prefix);
    const authored = JSON.parse(
      (await exec("bun", invocation, options)).stdout,
    );
    expect(authored.results.map((r: SemanticResult) => r.outcome.kind)).toEqual(
      Array(6).fill("completed"),
    );
    const discovered: SemanticResult = authored.results[4];
    const body = discovered.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!;
    const sketch = discovered.discovery!.references.find(
      (r) => r.target.kind === "sketch",
    )!;
    const open = {
      operation: "document.open",
      path: native,
      basis: null,
      as: "opened",
    };
    const meshAccuracy = { chordTolerance: 0.05, angleToleranceRadians: 0.1 };
    const exports = [
      {
        operation: "export.stl",
        options: { meshAccuracy, encoding: "binary" },
        file: "binary.stl",
        label: body.label,
      },
      {
        operation: "export.stl",
        options: { meshAccuracy, encoding: "ascii" },
        file: "ascii.stl",
        label: body.label,
      },
      {
        operation: "export.3mf",
        options: { meshAccuracy, unit: "millimeter", includeMetadata: true },
        file: "plate.3mf",
        label: body.label,
      },
      {
        operation: "export.svg",
        options: {},
        file: "sketch.svg",
        label: sketch.label,
      },
      {
        operation: "export.dxf",
        options: {},
        file: "sketch.dxf",
        label: sketch.label,
      },
    ].map(({ file, label, ...command }) => ({
      ...command,
      basis: { alias: "opened" },
      target: { alias: "opened", label },
      path: join(directory, file),
    }));
    await save([open, ...exports]);
    const success = await exec("bun", invocation, options);
    const envelope = JSON.parse(success.stdout);
    expect(envelope.cleanup.kind).toBe("closed");
    const results: SemanticResult[] = envelope.results;
    expect(results.map((r) => r.outcome.kind)).toEqual(
      Array(6).fill("completed"),
    );
    for (const [index, command] of exports.entries()) {
      const result = results[index + 1]!;
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
      expect(result.completion.file).toMatchObject({
        kind: "written",
        path: command.path,
        bytesWritten: (await readFile(command.path)).length,
      });
      expect(result.completion.persistence.kind).toBe("not-required");
    }
    const binary = await readFile(exports[0]!.path);
    expect(binary.readUInt32LE(80)).toBe(12);
    expect(binary.length).toBe(684);
    expect(await readFile(exports[1]!.path, "utf8")).toContain(
      "vertex 20 10 7",
    );
    expect(
      strFromU8(
        unzipSync(await readFile(exports[2]!.path))["3D/3dmodel.model"]!,
      ),
    ).toContain('<metadata name="Title">');
    expect(await readFile(exports[3]!.path, "utf8")).toContain(
      'width="20mm" height="10mm"',
    );
    expect(await readFile(exports[4]!.path, "utf8")).toContain("0\nLINE\n");
    expect(success.stderr).not.toContain("Unhandled");
    await save([
      open,
      { ...exports[3], target: { alias: "opened", label: body.label } },
      exports[0],
    ]);
    const incompatible = await exec("bun", invocation, options).then(
      (result) => ({ ...result, code: 0 }),
      (error: { code: number; stdout: string }) => error,
    );
    expect(incompatible.code).toBe(1);
    const failed = JSON.parse(incompatible.stdout);
    expect(failed.results).toHaveLength(2);
    expect(failed.results[1].outcome).toEqual({
      kind: "rejected",
      reasonCode: "export-incompatible-target",
    });
    expect(failed.cleanup.kind).toBe("closed");
    await save([
      open,
      { ...exports[0], options: { meshAccuracy, encoding: "unknown" } },
    ]);
    const invalid = await exec("bun", invocation, options).then(
      (result) => ({ ...result, code: 0 }),
      (error: { code: number; stdout: string }) => error,
    );
    expect(invalid.code).toBe(2);
    expect(invalid.stdout).toBe("");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);
