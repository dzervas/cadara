import { expect, it } from "vitest";
import { SketchAuthoredActions } from "@/application/editor/sketch-authored-actions";
import type { NativeDocumentFileIO } from "@/application/semantic/document-port";
import type { SemanticState } from "@/contracts/semantic/schema";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "@/domain/modeling/modeling-service";
import { createRebuiltTopologyLineage } from "@/domain/modeling/modeling-test-fixtures";
import { createNativeDocumentFiles } from "./native-document-files";

// Logic adapter-conformance seam: the native-file save guard over the
// production service and memory repository; only the asynchronous kernel
// boundary and disk IO are fakes.

/** Like the production kernel, a body rename rebuilds native lineage: one
 * fallback source key is replaced and keyed records are exported in a new order. */
class RebuildingLineageAdapter extends MockKernelAdapter {
  private rebuilt = false;
  override async exportAuthoredModelDocument(
    ...args: Parameters<MockKernelAdapter["exportAuthoredModelDocument"]>
  ) {
    const document = await super.exportAuthoredModelDocument(...args);
    const lineage = createRebuiltTopologyLineage(document);
    return {
      ...document,
      topologyLineage: this.rebuilt ? lineage.rebuilt : lineage.original,
    };
  }
  override async renameBody(
    ...args: Parameters<MockKernelAdapter["renameBody"]>
  ) {
    const response = await super.renameBody(...args);
    if (response.revisionState.kind === "accepted") this.rebuilt = true;
    return response;
  }
}

/** `receipt` may replace the save synchronization receipt the service observes. */
async function renamedBodyFixture(
  receipt?: (
    observed: DocumentRepositoryMutationResult,
    renamed: DocumentRepositoryMutationResult,
  ) => DocumentRepositoryMutationResult,
) {
  let renamed: DocumentRepositoryMutationResult | undefined;
  class Repository extends MemoryDocumentRepository {
    override async mutate(
      input: Parameters<MemoryDocumentRepository["mutate"]>[0],
    ) {
      const observed = await super.mutate(input);
      return renamed && receipt && input.document === input.expected
        ? receipt(observed, renamed)
        : observed;
    }
  }
  const adapter = new RebuildingLineageAdapter();
  // As after a native open: the repository holds the exported keyed lineage.
  const repository = new Repository([
    await adapter.exportAuthoredModelDocument("doc_workspace"),
  ]);
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  const written = new Map<string, string>();
  const files: NativeDocumentFileIO = {
    read: async (path) => written.get(path)!,
    write: async (path, text) => {
      written.set(path, text);
      return { kind: "written", bytesWritten: text.length, diagnostics: [] };
    },
  };
  const state = (
    revisionId: SemanticState["revisionId"],
    heads: readonly string[],
  ): SemanticState => ({
    documentId: "doc_workspace",
    revisionId,
    repositoryHeads: [...heads],
    editingContext: { kind: "document" },
    draft: null,
  });
  const nativeFiles = createNativeDocumentFiles({
    service,
    files,
    sketchActions: new SketchAuthoredActions(),
    state,
  });
  const before = await service.getCurrentDocumentSnapshot();
  const bodyId = before.document.bodies[0]!.bodyId;
  const result = await service.renameBody({
    baseRevisionId: before.document.revisionId,
    bodyId,
    // An existing label still rebuilds, as in the bracket reproduction.
    bodyLabel: before.document.bodies[0]!.label,
    observePersistence: (value) => {
      renamed = value;
    },
  });
  if (result.isErr()) throw new Error(result.error.message);
  if (!renamed?.ok)
    throw new Error(`Expected a committed rename: ${JSON.stringify(renamed)}`);
  const accepted = state(renamed.document.revisionId, renamed.metadata.heads);
  return { service, repository, nativeFiles, written, accepted, bodyId };
}

it("saves a metadata-only body rename whose rebuild changed keyed lineage, twice, without new heads or history", async () => {
  const { service, repository, nativeFiles, written, accepted } =
    await renamedBodyFixture();
  try {
    const live = await service.getCurrentDocumentSnapshot();
    expect(live.document.revisionId).toBe(accepted.revisionId);
    expect(
      live.provenance?.repositoryHeads,
      "the accepted rename is certified by its own repository write",
    ).toEqual(accepted.repositoryHeads);
    for (const path of ["first.cadara", "second.cadara"]) {
      const saved = await nativeFiles.save({
        commandId: path,
        path,
        state: accepted,
      });
      expect(saved.diagnostics).toEqual([]);
      expect(saved.persistence).toMatchObject({
        kind: "committed",
        state: accepted,
      });
      expect(saved.file).toMatchObject({ kind: "written", path });
      const payload = JSON.parse(written.get(path)!);
      expect(payload.revisionId).toBe(accepted.revisionId);
      expect(
        payload.topologyLineage[1].outputs[0].sourceTargets.map(
          (source: { sourceKey: string }) => source.sourceKey,
        ),
      ).toEqual(["source:fallback:g9", "source:a", "source:b"]);
    }
    expect(repository.getMetadata("doc_workspace").heads).toEqual(
      accepted.repositoryHeads,
    );
    await repository.undoDurableHistory("doc_workspace");
    expect(
      await repository.getDurableHistoryAvailability("doc_workspace"),
      "saving added no authored history after the rename",
    ).toMatchObject({ canUndo: false });
  } finally {
    service.dispose();
  }
});

it.each<
  [
    string,
    (
      observed: DocumentRepositoryMutationResult,
      renamed: DocumentRepositoryMutationResult,
    ) => DocumentRepositoryMutationResult,
  ]
>([
  [
    "a stale receipt for another stored revision",
    (_, renamed) => {
      if (!renamed.ok) throw new Error("Expected a rename receipt");
      return {
        ...renamed,
        document: { ...renamed.document, revisionId: "rev_0000" },
      };
    },
  ],
  [
    "a foreign receipt",
    (observed) => {
      if (!observed.ok) throw new Error("Expected a synchronization receipt");
      return {
        ...observed,
        metadata: {
          ...observed.metadata,
          actorId: "foreign",
          heads: ["memory:foreign:1"],
        },
      };
    },
  ],
  [
    "a failed receipt",
    (observed) => ({
      ok: false,
      status: {
        kind: "failed",
        documentId: observed.ok
          ? observed.document.documentId
          : "doc_workspace",
        diagnostic: {
          reasonCode: "storage-write-failed",
          message: "Injected failure",
        },
      },
    }),
  ],
])("does not write a file for %s", async (_, receipt) => {
  const { service, nativeFiles, written, accepted } =
    await renamedBodyFixture(receipt);
  try {
    const saved = await nativeFiles.save({
      commandId: "save",
      path: "rejected.cadara",
      state: accepted,
    });
    expect(saved.file).toEqual({ kind: "not-required" });
    expect(saved.persistence.kind).toBe("failed");
    expect(written.has("rejected.cadara")).toBe(false);
  } finally {
    service.dispose();
  }
});

it("does not write a file without a repository receipt", async () => {
  const service = createModelingService(new RebuildingLineageAdapter(), {
    currentDocumentId: "doc_workspace",
  });
  const written: string[] = [];
  const nativeFiles = createNativeDocumentFiles({
    service,
    sketchActions: new SketchAuthoredActions(),
    state: () => {
      throw new Error("No state is accepted here");
    },
    files: {
      read: async () => "",
      write: async (path) => {
        written.push(path);
        return { kind: "written", bytesWritten: 1, diagnostics: [] };
      },
    },
  });
  try {
    const live = await service.getCurrentDocumentSnapshot();
    const saved = await nativeFiles.save({
      commandId: "save",
      path: "unreceipted.cadara",
      state: {
        documentId: "doc_workspace",
        revisionId: live.document.revisionId,
        repositoryHeads: [],
        editingContext: { kind: "document" },
        draft: null,
      },
    });
    expect(saved.file).toEqual({ kind: "not-required" });
    expect(saved.persistence.kind).toBe("failed");
    expect(written).toEqual([]);
  } finally {
    service.dispose();
  }
});
