import { expect, test } from "vitest";
import { invokeCliRecipe } from "../../test/helpers/cli-recipe-process";
import { mkdtemp, rm } from "node:fs/promises";
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
  function invoke(operations: readonly Record<string, unknown>[]) {
    return invokeCliRecipe(
      dir,
      operations,
      {
        cwd: resolve(import.meta.dirname, "../.."),
        timeout: 90000,
        env: { ...process.env, NODE_ENV: "production", TEST: "false" },
      },
    );
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
    // Alias substitution must preserve unknown siblings for exact validation,
    // not silently turn a requested offset into an unoffset coplanar plane.
    for (const operation of ["plane.create", "plane.update"]) {
      for (const target of [{ alias: "datum", label }, produced]) {
        const malformed = await invoke([
          ...commands.slice(0, 2),
          {
            version: 1,
            commandId: "unknown-reference-field",
            operation,
            basis: { alias: "datum" },
            ...(operation === "plane.update"
              ? { featureId: { alias: "datum", label: "Plane 1" } }
              : {}),
            parameters: {
              mode: "coplanar",
              reference: { target, offset: 123 },
            },
            intent: "fulfill",
          },
        ]);
        expect(malformed.code, malformed.stderr + malformed.stdout).toBe(2);
        expect(malformed.stdout).toBe("");
        const [json, summary] = malformed.stderr.split("\n");
        expect(summary).toContain("Invalid semantic operation: unknown field parameters.reference.offset");
        expect(JSON.parse(json!)).toMatchObject({
          error: { code: "invalid-recipe", commandIndex: 2, commandId: "unknown-reference-field", path: "parameters.reference.offset" },
        });
      }
    }
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
