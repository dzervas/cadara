import { expect, it } from "vitest";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import { createModelingService } from "./service";

class FailedReplacementRepository extends MemoryDocumentRepository {
  override async initialize(
    input: Parameters<MemoryDocumentRepository["initialize"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    const written = await super.initialize(input);
    if (!written.ok) return written;
    return {
      ok: false,
      status: {
        kind: "failed",
        documentId: input.documentId,
        diagnostic: {
          reasonCode: "write-failed",
          message: "replacement persistence failed",
        },
      },
      appliedLive: { document: written.document, metadata: written.metadata },
    };
  }
}
it("observes the exact failed replacement transaction and hands off its applied live document", async () => {
  const repository = new FailedReplacementRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    expect((await service.initialize()).kind).not.toBe("failed");
    let transaction: DocumentRepositoryMutationResult | null = null;
    const created = await service.createDocumentTransaction({
      name: "Applied despite write failure",
      observe: (receipt) => {
        transaction = receipt;
      },
    });
    expect(created.ok).toBe(false);
    expect(transaction).toMatchObject({
      ok: false,
      appliedLive: { document: { name: "Applied despite write failure" } },
    });
    expect((await service.getCurrentDocumentSnapshot()).document.name).toBe(
      "Applied despite write failure",
    );
    // A fulfilled old tail remains deliberately insufficient as a success receipt.
    await service.waitForPersistence();
    expect(transaction).toMatchObject({ ok: false });
  } finally {
    service.dispose();
  }
});
