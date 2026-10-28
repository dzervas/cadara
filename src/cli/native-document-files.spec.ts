import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import { expect, it } from "vitest";
import { cliEntry } from "../../test/helpers/cli-recipe-process";
import { createHeadlessSessionFactory } from "@/composition/headless";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import type { AuthoredModelDocument } from "@/contracts/modeling/authored-document";
import { createDeterministicGeometryAsset } from "@/core/modeling/geometry-asset-test-helpers";
import {
  encodeGeometryAssetData,
  type BakedMeshGeometryAssetData,
  type GeometryAssetRecord,
} from "@/contracts/modeling/geometry-assets";
import { hashGeometryAssetBytes } from "@/core/modeling/geometry-asset-store";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/contracts/modeling/document-repository";
import { BAKED_BODY_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";

const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "../..");

it("rejects malformed native input without changing the live document and reports missing files", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-native-invalid-"));
  const opened = await createHeadlessSessionFactory().open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const path = resolve(directory, "invalid.cadara");
    await writeFile(path, "{not JSON");
    const invalid = await opened.session.execute({
      version: 1,
      commandId: "invalid",
      operation: "document.open",
      path,
      basis: null,
    });
    expect(invalid.outcome).toEqual({
      kind: "rejected",
      reasonCode: "native-document-invalid",
    });
    expect(invalid.completion.live).toEqual({
      kind: "unchanged",
      state: opened.initialization.state,
    });
    expect(
      (
        await opened.session.execute({
          version: 1,
          commandId: "fixture",
          operation: "document.save",
          path,
          basis: opened.initialization.state,
        })
      ).outcome.kind,
    ).toBe("completed");
    const unsupportedDocument = JSON.parse(await readFile(path, "utf8"));
    unsupportedDocument.schemaVersion = "authored-model-document/v999";
    await writeFile(path, JSON.stringify(unsupportedDocument));
    const unsupported = await opened.session.execute({
      version: 1,
      commandId: "unsupported",
      operation: "document.open",
      path,
      basis: null,
    });
    expect(unsupported.outcome).toEqual({
      kind: "rejected",
      reasonCode: "native-document-invalid",
    });
    expect(
      unsupported.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "document-import-unsupported-schema-version",
      ),
    ).toBe(true);
    expect(unsupported.completion.live.state).toEqual(
      opened.initialization.state,
    );
    const missing = await opened.session.execute({
      version: 1,
      commandId: "missing",
      operation: "document.open",
      path: resolve(directory, "missing.cadara"),
      basis: null,
    });
    expect(missing.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(missing.completion.live.state).toEqual(opened.initialization.state);
  } finally {
    await opened.session.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);

it("invalidates earlier bases after rename and reopening the same native file", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-native-basis-"));
  const opened = await createHeadlessSessionFactory().open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const renamed = await opened.session.execute({
      version: 1,
      commandId: "rename",
      operation: "document.rename",
      label: "Renamed",
      basis: opened.initialization.state,
    });
    expect(renamed.outcome.kind).toBe("completed");
    expect(renamed.discovery!.state.revisionId).not.toBe(
      opened.initialization.state.revisionId,
    );
    expect(
      (
        await opened.session.execute({
          version: 1,
          commandId: "old-initial",
          operation: "document.inspect",
          basis: opened.initialization.state,
        })
      ).outcome.kind,
    ).toBe("conflicted");
    const path = resolve(directory, "same.cadara");
    expect(
      (
        await opened.session.execute({
          version: 1,
          commandId: "save",
          operation: "document.save",
          path,
          basis: renamed.discovery!.state,
        })
      ).outcome.kind,
    ).toBe("completed");
    const reopened = await opened.session.execute({
      version: 1,
      commandId: "open",
      operation: "document.open",
      path,
      basis: null,
    });
    expect(reopened.outcome.kind).toBe("completed");
    expect(reopened.discovery!.state.revisionId).not.toBe(
      renamed.discovery!.state.revisionId,
    );
    expect(
      (
        await opened.session.execute({
          version: 1,
          commandId: "old-renamed",
          operation: "document.inspect",
          basis: renamed.discovery!.state,
        })
      ).outcome.kind,
    ).toBe("conflicted");
    expect(reopened.discovery?.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
  } finally {
    await opened.session.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);

it("does not forge a persistence receipt when native save preparation throws before observation", async () => {
  class ThrowingRepository extends MemoryDocumentRepository {
    override async mutate(): Promise<DocumentRepositoryMutationResult> {
      throw new Error("Save preparation boundary failed");
    }
  }
  const opened = await createHeadlessSessionFactory({
    createRepository: (assets) => new ThrowingRepository([], assets),
  }).open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const failed = await opened.session.execute({
      version: 1,
      commandId: "save",
      operation: "document.save",
      path: "unused-output",
      basis: opened.initialization.state,
    });
    expect(failed.outcome).toEqual({ kind: "failed", failures: ["execution"] });
    expect(failed.completion.persistence.kind).toBe("not-required");
    expect(failed.completion.file.kind).toBe("not-required");
    expect(failed.completion.live).toEqual({
      kind: "unchanged",
      state: opened.initialization.state,
    });
    expect(
      failed.diagnostics.some(
        (diagnostic) =>
          diagnostic.message === "Save preparation boundary failed",
      ),
    ).toBe(true);
  } finally {
    await opened.session.close();
  }
}, 90000);

it("reports a native repository failure without inventing applied-live evidence", async () => {
  class FailingRepository extends MemoryDocumentRepository {
    override async mutate(
      input: Parameters<MemoryDocumentRepository["mutate"]>[0],
    ): Promise<DocumentRepositoryMutationResult> {
      return {
        ok: false,
        status: {
          kind: "failed",
          documentId: input.documentId,
          diagnostic: {
            reasonCode: "storage-write-failed",
            message: "Injected pre-apply storage failure",
          },
        },
      };
    }
  }
  const opened = await createHeadlessSessionFactory({
    createRepository: (assets) => new FailingRepository([], assets),
  }).open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const failed = await opened.session.execute({
      version: 1,
      commandId: "rename",
      operation: "document.rename",
      label: "Not applied",
      basis: opened.initialization.state,
    });
    expect(failed.outcome).toEqual({
      kind: "failed",
      failures: ["persistence"],
    });
    expect(failed.completion.live).toEqual({
      kind: "unchanged",
      state: opened.initialization.state,
    });
    expect(failed.completion.persistence.kind).toBe("failed");
    const inspected = await opened.session.execute({
      version: 1,
      commandId: "inspect",
      operation: "document.inspect",
      basis: opened.initialization.state,
    });
    expect(inspected.outcome.kind).toBe("completed");
    expect(inspected.discovery?.document?.label).not.toBe("Not applied");
  } finally {
    await opened.session.close();
  }
}, 90000);

it("retains applied-live native rename evidence when its repository write fails", async () => {
  class FailingRepository extends MemoryDocumentRepository {
    override async mutate(
      input: Parameters<MemoryDocumentRepository["mutate"]>[0],
    ): Promise<DocumentRepositoryMutationResult> {
      const applied = await super.mutate(input);
      if (!applied.ok) return applied;
      return {
        ok: false,
        appliedLive: applied,
        status: {
          kind: "failed",
          documentId: input.documentId,
          diagnostic: {
            reasonCode: "storage-write-failed",
            message: "Injected durable storage failure",
          },
        },
      };
    }
  }
  const opened = await createHeadlessSessionFactory({
    createRepository: (assets) => new FailingRepository([], assets),
  }).open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const failed = await opened.session.execute({
      version: 1,
      commandId: "rename",
      operation: "document.rename",
      label: "Applied despite storage failure",
      basis: opened.initialization.state,
    });
    expect(failed.outcome).toEqual({
      kind: "failed",
      failures: ["persistence"],
    });
    expect(failed.completion.live.kind).toBe("applied");
    expect(failed.completion.persistence.kind).toBe("failed");
    expect(failed.discovery?.document?.label).toBe(
      "Applied despite storage failure",
    );
    expect(
      failed.diagnostics.some((diagnostic) =>
        diagnostic.message.includes("Injected durable storage failure"),
      ),
    ).toBe(true);
  } finally {
    await opened.session.close();
  }
}, 90000);

it("awaits the filesystem boundary and preserves late partial-write failure evidence", async () => {
  let finish!: (value: {
    kind: "failed";
    bytesWritten: number;
    diagnostics: [];
  }) => void;
  let start!: () => void;
  const started = new Promise<void>((resolve) => {
    start = resolve;
  });
  const write = new Promise<{
    kind: "failed";
    bytesWritten: number;
    diagnostics: [];
  }>((resolve) => {
    finish = resolve;
  });
  let writes = 0;
  const opened = await createHeadlessSessionFactory({
    nativeFileIO: {
      read: async () => {
        throw new Error("unused");
      },
      write: async () => {
        if (++writes > 1) throw new Error("Late filesystem rejection");
        start();
        return write;
      },
    },
  }).open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    let settled = false;
    const pending = opened.session.execute({
      version: 1,
      commandId: "save",
      operation: "document.save",
      path: "opaque-output",
      basis: opened.initialization.state,
    });
    void pending.then(() => {
      settled = true;
    });
    await Promise.race([started, pending]);
    expect(settled).toBe(false);
    finish({ kind: "failed", bytesWritten: 19, diagnostics: [] });
    const failed = await pending;
    expect(failed.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(failed.completion.file).toMatchObject({
      kind: "failed",
      bytesWritten: 19,
    });
    expect(failed.completion.live).toEqual({
      kind: "unchanged",
      state: opened.initialization.state,
    });
    expect(failed.completion.persistence.kind).toBe("committed");
    const rejectedWrite = await opened.session.execute({
      version: 1,
      commandId: "late-rejection",
      operation: "document.save",
      path: "opaque-output",
      basis: opened.initialization.state,
    });
    expect(rejectedWrite.outcome).toEqual({
      kind: "failed",
      failures: ["file"],
    });
    expect(rejectedWrite.completion.persistence.kind).toBe("committed");
    expect(rejectedWrite.completion.file.kind).toBe("failed");
    expect(
      rejectedWrite.diagnostics.some(
        (diagnostic) => diagnostic.message === "Late filesystem rejection",
      ),
    ).toBe(true);
  } finally {
    finish({ kind: "failed", bytesWritten: 19, diagnostics: [] });
    await opened.session.close();
  }
}, 90000);

it("reports filesystem write failures without hiding the current document or claiming rollback", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-native-write-"));
  const opened = await createHeadlessSessionFactory().open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  try {
    const created = await opened.session.execute({
      version: 1,
      commandId: "create",
      operation: "document.create",
      label: "Still live",
      basis: null,
    });
    expect(created.outcome.kind).toBe("completed");
    const unchanged = await opened.session.execute({
      version: 1,
      commandId: "same-label",
      operation: "document.rename",
      label: "Still live",
      basis: created.discovery!.state,
    });
    expect(unchanged.outcome).toEqual({
      kind: "completed",
      change: "unchanged",
    });
    expect(unchanged.completion.persistence.kind).toBe("not-required");
    const failed = await opened.session.execute({
      version: 1,
      commandId: "write-directory",
      operation: "document.save",
      path: directory,
      basis: created.discovery!.state,
    });
    expect(failed.outcome).toEqual({ kind: "failed", failures: ["file"] });
    expect(failed.completion.persistence.kind).toBe("committed");
    expect(failed.completion.file).toMatchObject({
      kind: "failed",
      bytesWritten: 0,
      path: directory,
    });
    expect(failed.completion.live).toEqual({
      kind: "unchanged",
      state: created.discovery!.state,
    });
    expect(failed.discovery?.document?.label).toBe("Still live");
    const path = resolve(directory, "retry.cadara");
    const retry = await opened.session.execute({
      version: 1,
      commandId: "retry",
      operation: "document.save",
      path,
      basis: created.discovery!.state,
    });
    expect(retry.outcome.kind).toBe("completed");
    expect(JSON.parse(await readFile(path, "utf8")).name).toBe("Still live");
  } finally {
    await opened.session.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 90000);

it("retains authored units, tolerance and neutral geometry through native save and fresh reopen; refuses missing assets", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-native-assets-"));
  const factory = createHeadlessSessionFactory();
  const opened = await factory.open();
  expect(opened.kind).toBe("ready");
  if (opened.kind !== "ready") throw new Error(JSON.stringify(opened));
  let active = opened.session;
  try {
    const path = resolve(directory, "asset.cadara");
    const seed = await active.execute({
      version: 1,
      commandId: "seed",
      operation: "document.save",
      path,
      basis: opened.initialization.state,
    });
    expect(seed.outcome.kind).toBe("completed");
    const document = JSON.parse(
      await readFile(path, "utf8"),
    ) as AuthoredModelDocument;
    const asset = await createDeterministicGeometryAsset({
      ownerFeatureIds: ["feature_cube"],
    });
    document.name = "Retained cube";
    document.settings.modelingTolerance = 0.0000123;
    document.settings.angularToleranceRadians = 0.0000456;
    const mesh: BakedMeshGeometryAssetData = {
      kind: "bakedMeshGeometry",
      schemaVersion: "baked-mesh-geometry/v1alpha1",
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 1, 0],
        [0, 1, 0],
        [0, 0, 1],
        [1, 0, 1],
        [1, 1, 1],
        [0, 1, 1],
      ],
      indices: [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
      ],
      components: [
        { sourceComponentKey: "cube", indexStart: 0, indexCount: 12 },
      ],
    };
    const meshBytes = encodeGeometryAssetData(mesh);
    const meshAsset: GeometryAssetRecord = {
      ...asset.asset,
      assetId: "asset_cube_mesh",
      format: "baked-mesh",
      hash: await hashGeometryAssetBytes(meshBytes),
      byteLength: meshBytes.byteLength,
      mediaType: "application/vnd.cadara-baked-mesh+json",
      data: mesh,
    };
    document.assets.records = [asset.asset, meshAsset];
    document.features = [
      {
        featureId: "feature_cube",
        label: "Cube",
        suppressed: false,
        definition: {
          kind: "bakedBody",
          featureTypeVersion: BAKED_BODY_FEATURE_SCHEMA_VERSION,
          parameters: {
            assetId: meshAsset.assetId,
            format: "baked-mesh",
            hash: meshAsset.hash,
            byteLength: meshAsset.byteLength,
            label: "Cube",
            provenance: { source: "fileImport" },
            replacement: { kind: "append" },
          },
        },
      },
    ];
    document.featureOrder = ["feature_cube"];
    document.cursor = { kind: "feature", featureId: "feature_cube" };
    document.historyOrder = [{ kind: "feature", featureId: "feature_cube" }];
    await writeFile(path, JSON.stringify(document));
    const restored = await active.execute({
      version: 1,
      commandId: "restore",
      operation: "document.open",
      path,
      basis: null,
    });
    expect(restored.outcome.kind, JSON.stringify(restored)).toBe("completed");
    expect(restored.completion.geometry.kind).toBe("current");
    expect(
      restored.discovery?.references.some(
        (reference) => reference.target.kind === "body",
      ),
    ).toBe(true);
    const basis = restored.discovery!.state;
    const renamed = await active.execute({
      version: 1,
      commandId: "rename",
      operation: "document.rename",
      label: "Retained renamed cube",
      basis,
    });
    expect(renamed.outcome.kind).toBe("completed");
    const saved = await active.execute({
      version: 1,
      commandId: "save",
      operation: "document.save",
      path,
      basis: renamed.discovery!.state,
    });
    expect(saved.outcome.kind, JSON.stringify(saved)).toBe("completed");
    await active.close();
    const fresh = await factory.open();
    expect(fresh.kind).toBe("ready");
    if (fresh.kind !== "ready") throw new Error(JSON.stringify(fresh));
    active = fresh.session;
    const reopened = await active.execute({
      version: 1,
      commandId: "reopen",
      operation: "document.open",
      path,
      basis: null,
    });
    expect(reopened.outcome.kind, JSON.stringify(reopened)).toBe("completed");
    expect(reopened.discovery).toMatchObject({
      document: { label: "Retained renamed cube" },
      history: { canUndo: false, canRedo: false },
    });
    expect(
      reopened.discovery?.references.some(
        (reference) => reference.target.kind === "body",
      ),
    ).toBe(true);
    expect(reopened.discovery!.state.documentId).not.toBe(basis.documentId);
    expect(
      reopened
        .discovery!.references.filter(
          (reference) => reference.target.kind === "body",
        )
        .map((reference) => reference.target),
    ).toEqual(
      restored
        .discovery!.references.filter(
          (reference) => reference.target.kind === "body",
        )
        .map((reference) => reference.target),
    );
    const roundtrip = resolve(directory, "roundtrip.cadara");
    expect(
      (
        await active.execute({
          version: 1,
          commandId: "roundtrip",
          operation: "document.save",
          path: roundtrip,
          basis: reopened.discovery!.state,
        })
      ).outcome.kind,
    ).toBe("completed");
    const retained = JSON.parse(
      await readFile(roundtrip, "utf8"),
    ) as AuthoredModelDocument;
    expect(retained.settings).toEqual({
      linearUnit: "millimeter",
      modelingTolerance: 0.0000123,
      angularToleranceRadians: 0.0000456,
    });
    expect(retained.assets.records).toEqual([asset.asset, meshAsset]);
    expect(retained.features[0]?.definition).toEqual(
      document.features[0]?.definition,
    );
    const missing = structuredClone(retained);
    missing.assets.records = [];
    missing.features[0]!.label = "Imported housing";
    await writeFile(path, JSON.stringify(missing));
    const failed = await active.execute({
      version: 1,
      commandId: "missing-asset",
      operation: "document.open",
      path,
      basis: null,
    });
    expect(failed.outcome.kind).not.toBe("completed");
    expect(failed.diagnostics.length).toBeGreaterThan(0);
    expectNoInternalIds(
      failed.diagnostics.map((d) => d.message),
      ["feature_cube", meshAsset.assetId],
    );
    expect(
      failed.diagnostics.some((d) => d.message.includes("Imported housing")),
    ).toBe(true);
    expect(failed.diagnostics).toContainEqual(
      expect.objectContaining({
        target: { kind: "feature", featureId: "feature_cube" },
      }),
    );
    expect(failed.completion.live.kind).toBe("unchanged");
    const current = await active.execute({
      version: 1,
      commandId: "still-current",
      operation: "document.inspect",
      basis: reopened.discovery!.state,
    });
    expect(current.discovery?.document?.label).toBe("Retained renamed cube");
    expect(
      current.discovery?.references.some(
        (reference) => reference.target.kind === "body",
      ),
    ).toBe(true);
    // The format structurally permits this reference, but the production
    // baked-body materializer does not support cadara-brep. Do not fake support.
    const unavailable = structuredClone(retained);
    const definition = unavailable.features[0]!.definition;
    if (definition.kind !== "bakedBody")
      throw new Error("Expected baked-body fixture");
    definition.parameters = {
      ...definition.parameters,
      assetId: asset.asset.assetId,
      format: asset.asset.format,
      hash: asset.asset.hash,
      byteLength: asset.asset.byteLength,
    };
    await writeFile(path, JSON.stringify(unavailable));
    const invalidGeometry = await active.execute({
      version: 1,
      commandId: "unavailable-geometry",
      operation: "document.open",
      path,
      basis: null,
    });
    expect(invalidGeometry.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(invalidGeometry.completion.live.kind).toBe("applied");
    expect(invalidGeometry.completion.persistence.kind).toBe("committed");
    expect(invalidGeometry.completion.geometry.kind).toBe("failed");
    expect(
      invalidGeometry.diagnostics.some(
        (diagnostic) => diagnostic.code === "baked-body-formatInvalid",
      ),
    ).toBe(true);
  } finally {
    await active.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 180000);

it("renames, saves and reopens a native document in a fresh production editing context", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-native-"));
  try {
    const path = resolve(directory, "part.cadara");
    const recipe = resolve(directory, "recipe.json");
    await writeFile(
      recipe,
      JSON.stringify({
        version: 1,
        operations: [
          {
            version: 1,
            commandId: "create",
            operation: "document.create",
            label: "Original",
            basis: null,
            as: "original",
          },
          {
            version: 1,
            commandId: "rename",
            operation: "document.rename",
            label: "Bracket",
            basis: { alias: "original" },
            as: "renamed",
          },
          {
            version: 1,
            commandId: "save",
            operation: "document.save",
            path,
            basis: { alias: "renamed" },
          },
        ],
      }),
    );
    const first = JSON.parse(
      (
        await exec("bun", [cliEntry(), "document", "recipe", recipe], {
          cwd: root,
          timeout: 60000,
        })
      ).stdout,
    );
    expect(
      first.results.map((r: { outcome: { kind: string } }) => r.outcome.kind),
    ).toEqual(["completed", "completed", "completed"]);
    expect(first.results[2].completion.file).toMatchObject({
      kind: "written",
      path,
    });
    expect(first.results[2].completion.file.bytesWritten).toBeGreaterThan(0);
    await writeFile(
      recipe,
      JSON.stringify({
        version: 1,
        operations: [
          {
            version: 1,
            commandId: "open",
            operation: "document.open",
            path,
            basis: null,
            as: "opened",
          },
          {
            version: 1,
            commandId: "inspect",
            operation: "document.inspect",
            basis: { alias: "opened" },
          },
        ],
      }),
    );
    const second = JSON.parse(
      (
        await exec("bun", [cliEntry(), "document", "recipe", recipe], {
          cwd: root,
          timeout: 60000,
        })
      ).stdout,
    );
    expect(second.results[0].outcome.kind).toBe("completed");
    expect(second.results[1].discovery.document.label).toBe("Bracket");
    expect(second.results[1].discovery.history).toMatchObject({
      canUndo: false,
      canRedo: false,
    });
    expect(second.results[1].discovery.state.documentId).not.toBe(
      first.results[0].discovery.state.documentId,
    );
    expect(second.cleanup).toMatchObject({
      kind: "closed",
      resourcesReleased: true,
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 120000);
