import { expect, test } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { validateSemanticResult } from "@/contracts/semantic/runtime-schema";
import type { SemanticResult } from "@/contracts/semantic/schema";

test("real Bun plane recipes discover frames, resolve construction/feature aliases and preserve failure exit truth", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "cadara-planes-"));
  const frame = {
    linearUnit: "documentLength",
    handedness: "rightHanded",
    origin: [3, 4, 5],
    xAxis: [0, 1, 0],
    yAxis: [0, 0, 1],
    normal: [1, 0, 0],
  };
  const moved = { ...frame, origin: [7, 8, 9] };
  const commands = [
    { operation: "document.create", label: "Planes", basis: null, as: "part" },
    {
      operation: "plane.create",
      basis: { alias: "part" },
      parameters: { mode: "explicitFrame", frame },
      intent: "fulfill",
      as: "datum",
    },
    {
      operation: "plane.create",
      basis: { alias: "datum" },
      parameters: {
        mode: "coplanar",
        reference: { target: { alias: "datum", label: "feature_1" } },
      },
      intent: "fulfill",
      as: "copy",
    },
    {
      operation: "plane.update",
      basis: { alias: "copy" },
      featureId: { alias: "datum", label: "Plane 1" },
      parameters: { mode: "explicitFrame", frame: moved },
      intent: "fulfill",
    },
  ].map((c, i) => ({ version: 1, commandId: `plane-${i}`, ...c }));
  async function invoke(operations: readonly Record<string, unknown>[]) {
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
            timeout: 90000,
            env: { ...process.env, NODE_ENV: "production", TEST: "false" },
          },
        )),
      };
    } catch (error) {
      return error as { code: number; stdout: string; stderr: string };
    }
  }
  try {
    // Discover the production construction label rather than inventing an ID policy.
    const initial = await invoke(commands.slice(0, 2));
    expect(initial.code, initial.stderr + initial.stdout).toBe(0);
    const datum: SemanticResult = JSON.parse(initial.stdout).results[1];
    const produced = datum.discovery!.model!.features[0]!.producedTargets[0]!;
    const label = datum.discovery!.references.find(
      (r) =>
        r.target.kind === "construction" &&
        produced.kind === "construction" &&
        r.target.constructionId === produced.constructionId,
    )!.label;
    const complete = commands.map((c, i) =>
      i === 2
        ? {
            ...c,
            parameters: {
              mode: "coplanar",
              reference: { target: { alias: "datum", label } },
            },
          }
        : c,
    );
    const success = await invoke(complete);
    expect(success.code, success.stderr + success.stdout).toBe(0);
    const output = JSON.parse(success.stdout);
    expect(output.cleanup.kind).toBe("closed");
    expect(output.unexecuted).toEqual([]);
    const results: SemanticResult[] = output.results;
    for (const result of results) {
      expect(result.outcome.kind).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
    }
    expect(
      results[1]!.discovery!.model!.constructions!.find(
        (c) => c.ownerFeatureId !== null,
      )!.frame,
    ).toEqual(frame);
    expect(
      results[3]!
        .discovery!.model!.constructions!.filter(
          (c) => c.ownerFeatureId !== null,
        )
        .map((c) => c.frame),
    ).toEqual([moved, moved]);
    const missing = await invoke(
      complete.map((c, i) =>
        i === 2
          ? {
              ...c,
              parameters: {
                mode: "coplanar",
                reference: {
                  target: { alias: "datum", label: "Missing plane" },
                },
              },
            }
          : c,
      ),
    );
    expect(missing.code).toBe(1);
    const failed = JSON.parse(missing.stdout);
    expect(failed.results).toHaveLength(2);
    expect(failed.unexecuted).toEqual(["plane-2", "plane-3"]);
    expect(failed.cleanup.kind).toBe("closed");
    const unknown = await invoke(
      complete.map((c, i) =>
        i === 2
          ? {
              ...c,
              parameters: {
                mode: "coplanar",
                reference: { target: { alias: "unknown", label } },
              },
            }
          : c,
      ),
    );
    expect(unknown.code).toBe(2);
    expect(unknown.stdout).toBe("");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}, 180000);
