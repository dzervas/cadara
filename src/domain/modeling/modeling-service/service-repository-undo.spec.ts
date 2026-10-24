// Logic lane; seam: the modeling service over a memory document repository.
// cadara-xkg applies Undo/Redo of body labels and colours in place; a feature
// label has no in-place kernel operation, and the kernel may refuse the
// in-place operation, so both still restore the whole authored document.
import { expect, it, vi } from "vitest";
import { createMemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createModelingService } from "./service";

const documentId = "doc_workspace";

it("undoing a feature relabel restores the authored document", async () => {
  const adapter = new MockKernelAdapter();
  const repository = createMemoryDocumentRepository();
  const service = createModelingService(adapter, {
    currentDocumentId: documentId,
    documentRepository: repository,
  });
  try {
    const initial = await service.getCurrentDocumentSnapshot();
    const feature = initial.document.features[0]!;
    const relabelled = await service.updateFeature({
      baseRevisionId: initial.document.revisionId,
      featureId: feature.featureId,
      featureLabel: "Relabelled",
      definition: feature.definition,
    });
    expect(relabelled.isOk() && relabelled.value.revisionState.kind).toBe(
      "accepted",
    );
    await service.waitForPersistence();
    const restore = vi.spyOn(adapter, "restoreAuthoredModelDocument");

    const undone = await repository.undoDurableHistory(documentId);
    expect(undone?.ok).toBe(true);
    const current = await service.getCurrentDocumentSnapshot();
    expect(current.document.features[0]!.label).toBe(feature.label);
    expect(restore).toHaveBeenCalledTimes(1);
  } finally {
    service.dispose();
  }
});

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
