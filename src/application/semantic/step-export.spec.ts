import { expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateSemanticCommand,
  validateSemanticResult,
} from "@/contracts/semantic/runtime-schema";
import { createPlateWorkflow } from "../../../test/helpers/semantic-workflow";

it("exports a current real solid through the STEP provider and writes complete Part21 bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "cadara-step-"));
  const fixture = await createPlateWorkflow();
  try {
    const state = fixture.solid.discovery!.state;
    const target = fixture.solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const bounds = fixture.solid.discovery!.model!.bodies[0]!.bounds!;
    for (const [axis, size] of [20, 10, 7].entries())
      expect(bounds.max[axis]! - bounds.min[axis]!).toBeCloseTo(size, 5);
    for (const schema of ["AP242", "AP214", "AP203"]) {
      const path = join(directory, `${schema}.step`);
      const result = await fixture.run({
        operation: "export.step",
        target,
        options: { schema, unit: "millimeter" },
        path,
      });
      expect(result.outcome.kind, JSON.stringify(result)).toBe("completed");
      expect(validateSemanticResult(result.correlation, result).success).toBe(
        true,
      );
      expect(result.correlation.family).toBe("export");
      expect(
        validateSemanticResult(result.correlation, {
          ...result,
          completion: {
            ...result.completion,
            geometry: { kind: "not-required" },
          },
        }).success,
      ).toBe(false);
      expect(
        validateSemanticResult(result.correlation, {
          ...result,
          completion: { ...result.completion, file: { kind: "not-required" } },
        }).success,
      ).toBe(false);
      expect(result.completion.live).toEqual({ kind: "unchanged", state });
      expect(result.completion.persistence.kind).toBe("not-required");
      const text = await readFile(path, "utf8");
      expect(text).toMatch(/^ISO-10303-21;/);
      expect(text).toContain("HEADER;");
      expect(text).toContain("FILE_SCHEMA");
      expect(text).toContain("END-ISO-10303-21;");
      expect(text).toMatch(/SI_UNIT\(\.MILLI\.,\.METRE\.\)/);
      expect(text).toContain("MANIFOLD_SOLID_BREP");
      expect(text).toContain(
        schema === "AP242"
          ? "AP242"
          : schema === "AP214"
            ? "AUTOMOTIVE_DESIGN"
            : "CONFIG_CONTROL_DESIGN",
      );
      expect(result.completion.file).toMatchObject({
        kind: "written",
        path,
        bytesWritten: Buffer.byteLength(text),
        state,
      });
    }
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 60000);

it("abort and close await a delayed partial STEP write and retain its failure separately from current geometry", async () => {
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fixture = await createPlateWorkflow({
    nativeFileIO: {
      read: async () => {
        throw new Error("No input file requested");
      },
      write: async () => {
        start();
        await pending;
        return {
          kind: "failed",
          bytesWritten: 23,
          diagnostics: [
            {
              code: "disk-full",
              severity: "error",
              message: "Partial write",
              target: null,
              detail: null,
            },
          ],
        };
      },
    },
  });
  try {
    const state = fixture.solid.discovery!.state;
    const target = fixture.solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const controller = new AbortController();
    let settled = false;
    const executing = fixture.session
      .execute(
        {
          version: 1,
          commandId: "delayed-export",
          operation: "export.step",
          basis: state,
          target,
          options: { schema: "AP242", unit: "millimeter" },
          path: "partial.step",
        },
        { signal: controller.signal },
      )
      .then((result) => {
        settled = true;
        return result;
      });
    await started;
    controller.abort();
    let closed = false;
    const closing = fixture.close().then((result) => {
      closed = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(closed).toBe(false);
    release();
    const result = await executing;
    expect(result.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(result.completion.file).toMatchObject({
      kind: "failed",
      bytesWritten: 23,
      state,
    });
    expect(result.completion.live).toEqual({ kind: "unchanged", state });
    expect(result.completion.geometry.kind).toBe("current");
    expect(result.completion.persistence.kind).toBe("not-required");
    expect(validateSemanticResult(result.correlation, result).success).toBe(
      true,
    );
    const cleanup = await closing;
    expect(cleanup.kind).toBe("closed");
    expect(cleanup.settled).toEqual([result]);
  } finally {
    release();
    await fixture.close();
  }
}, 60000);

it("refuses invalid STEP options, unsupported or missing targets and stale bases without writing", async () => {
  let writes = 0;
  const fixture = await createPlateWorkflow({
    nativeFileIO: {
      read: async () => "",
      write: async () => {
        writes++;
        throw new Error("Refused exports cannot write");
      },
    },
  });
  try {
    const basis = fixture.solid.discovery!.state;
    const target = fixture.solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const input = {
      version: 1,
      commandId: "option-contract",
      operation: "export.step",
      basis: {
        documentId: basis.documentId,
        revisionId: basis.revisionId,
        repositoryHeads: basis.repositoryHeads,
      },
      target,
      path: "never.step",
      options: { schema: "AP242", unit: "millimeter" },
    };
    expect(validateSemanticCommand(input).success).toBe(true);
    for (const options of [
      { schema: "AP999", unit: "millimeter" },
      { schema: "AP242", unit: "inch" },
    ]) {
      expect(validateSemanticCommand({ ...input, options }).success).toBe(
        false,
      );
      const result = await fixture.run({
        operation: "export.step",
        target,
        options,
        path: "never.step",
      });
      expect(result.outcome).toEqual({
        kind: "rejected",
        reasonCode: "invalid-step-options",
      });
    }
    const unsupported = await fixture.run({
      operation: "export.step",
      target: {
        kind: "sketch",
        sketchId: fixture.published.discovery!.sketch!.sketchId,
      },
      options: input.options,
      path: input.path,
    });
    expect(unsupported.outcome).toEqual({
      kind: "rejected",
      reasonCode: "export-incompatible-target",
    });
    const missing = await fixture.run({
      operation: "export.step",
      target: { kind: "body", bodyId: "body_missing" },
      options: input.options,
      path: input.path,
    });
    expect(missing.outcome).toEqual({
      kind: "rejected",
      reasonCode: "occ-export-missing-body",
    });
    const stale = await fixture.run({
      operation: "export.step",
      basis: fixture.published.discovery!.state,
      target,
      options: input.options,
      path: input.path,
    });
    expect(stale.outcome.kind).toBe("conflicted");
    for (const result of [unsupported, missing, stale]) {
      expect(result.completion.live.kind).toBe("unchanged");
      expect(result.completion.file.kind).toBe("not-required");
      const checked = validateSemanticResult(result.correlation, result);
      expect(checked.success, JSON.stringify(checked)).toBe(true);
    }
    expect(writes).toBe(0);
  } finally {
    await fixture.close();
  }
}, 60000);

it("a thrown STEP output write is an explicit failed file receipt, not successful geometry persistence", async () => {
  const fixture = await createPlateWorkflow({
    nativeFileIO: {
      read: async () => "",
      write: async () => {
        throw new Error("Output directory denied");
      },
    },
  });
  try {
    const target = fixture.solid.discovery!.references.find(
      (r) => r.target.kind === "body",
    )!.target;
    const result = await fixture.run({
      operation: "export.step",
      target,
      options: { schema: "AP242", unit: "millimeter" },
      path: "denied.step",
    });
    expect(result.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(result.completion.file).toMatchObject({
      kind: "failed",
      bytesWritten: 0,
      path: "denied.step",
    });
    expect(result.completion.persistence.kind).toBe("not-required");
    expect(result.completion.live.kind).toBe("unchanged");
    expect(result.completion.geometry.kind).toBe("current");
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("Output directory denied"),
      ),
    ).toBe(true);
    expect(validateSemanticResult(result.correlation, result).success).toBe(
      true,
    );
  } finally {
    await fixture.close();
  }
}, 60000);
