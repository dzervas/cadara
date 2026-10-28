// Logic lane; seam: the modeling service over a memory document repository.
// cadara-xkg applies Undo/Redo of body labels and colours in place, and
// cadara-kv69 feature and sketch labels and the document name; the kernel may
// refuse the in-place operation, which still restores the whole authored
// document.
import { expect, it, vi } from "vitest";
import { createMemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import { createModelingService } from "./service";

const documentId = "doc_workspace";

it.each<
  [
    string,
    (
      service: ReturnType<typeof createModelingService>,
      snapshot: WorkspaceSnapshot,
    ) => Promise<boolean>,
    (snapshot: WorkspaceSnapshot) => string,
  ]
>([
  [
    "a feature relabel",
    async (service, { document }) =>
      (
        await service.renameFeature({
          baseRevisionId: document.revisionId,
          featureId: document.features[0]!.featureId,
          featureLabel: "Relabelled",
        })
      ).isOk(),
    ({ document }) => document.features[0]!.label,
  ],
  [
    "a sketch relabel",
    async (service, { document }) =>
      (
        await service.renameSketch({
          baseRevisionId: document.revisionId,
          sketchId: document.sketches[0]!.sketchId,
          sketchLabel: "Relabelled",
        })
      ).isOk(),
    ({ document }) => document.sketches[0]!.label,
  ],
  [
    "a document rename",
    async (service) =>
      (await service.renameDocument({ name: "Relabelled" })).ok,
    ({ document }) => document.name,
  ],
])(
  "undo and redo of %s apply the label without restoring the authored document",
  async (_, rename, label) => {
    const adapter = new MockKernelAdapter();
    const repository = createMemoryDocumentRepository();
    const service = createModelingService(adapter, {
      currentDocumentId: documentId,
      documentRepository: repository,
    });
    try {
      const initial = await service.getCurrentDocumentSnapshot();
      expect(await rename(service, initial)).toBe(true);
      await service.waitForPersistence();
      expect(label(await service.getCurrentDocumentSnapshot())).toBe(
        "Relabelled",
      );
      const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");

      expect((await repository.undoDurableHistory(documentId))?.ok).toBe(true);
      expect(label(await service.getCurrentDocumentSnapshot())).toBe(
        label(initial),
      );
      expect((await repository.redoDurableHistory(documentId))?.ok).toBe(true);
      expect(label(await service.getCurrentDocumentSnapshot())).toBe(
        "Relabelled",
      );
      expect(restore).not.toHaveBeenCalled();
    } finally {
      service.dispose();
    }
  },
);

it("undoing a body rename the kernel refuses in place restores the authored document", async () => {
  const adapter = new MockKernelAdapter();
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(adapter, {
    currentDocumentId: documentId,
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    const body = initial.document.bodies[0]!;
    const renamed = await service.renameBody({
      baseRevisionId: initial.document.revisionId,
      bodyId: body.bodyId,
      bodyLabel: "Renamed",
    });
    expect(renamed.isOk() && renamed.value.revisionState.kind).toBe("accepted");
    await service.waitForPersistence();
    const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");
    // Stands in for a body the kernel cannot rename in place (e.g. inactive
    // behind the timeline cursor): the mock rejects a missing body.
    const renameBody = adapter.renameBody.bind(adapter);
    const refusedRename = vi
      .spyOn(adapter, "renameBody")
      .mockImplementationOnce((request) =>
        renameBody({ ...request, bodyId: "body_missing" as never }),
      );

    const undone = await repository.undoDurableHistory(documentId);
    expect(undone?.ok).toBe(true);
    const current = await service.getCurrentDocumentSnapshot();
    expect(refusedRename).toHaveBeenCalledTimes(1);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(current.document.bodies[0]!.label).toBe(body.label);
  } finally {
    service.dispose();
  }
});
