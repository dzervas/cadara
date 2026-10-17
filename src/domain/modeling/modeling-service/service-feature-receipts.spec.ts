import { expect, it } from "vitest";
import { createModelingService } from "./service";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";

// Logic sequencing seam only. Real geometry conformance lives at the semantic boundary.
it.each(["blocking", "background"] as const)(
  "awaits and observes the exact failed feature write in %s mode",
  async (mode) => {
    let start!: () => void, finish!: () => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      finish = resolve;
    });
    class DelayedRepository extends MemoryDocumentRepository {
      override async mutate(
        input: Parameters<MemoryDocumentRepository["mutate"]>[0],
      ): Promise<DocumentRepositoryMutationResult> {
        const written = await super.mutate(input);
        if (!written.ok) return written;
        start();
        await barrier;
        return {
          ok: false,
          status: {
            kind: "failed",
            documentId: input.documentId,
            diagnostic: {
              reasonCode: "write-failed",
              message: "Feature write failed",
            },
          },
          appliedLive: {
            document: written.document,
            metadata: written.metadata,
          },
        };
      }
    }
    const service = createModelingService(new MockKernelAdapter(), {
      currentDocumentId: "doc_workspace",
      documentRepository: new DelayedRepository(),
      documentRepositoryPersistence: mode,
    });
    try {
      const snapshot = await service.getCurrentDocumentSnapshot();
      const definition = snapshot.document.features.find(
        (f) => f.definition.kind === "extrude",
      )!.definition;
      let observed: DocumentRepositoryMutationResult | undefined;
      let settled = false;
      const pending = Promise.resolve(
        service.createFeature({
          baseRevisionId: snapshot.document.revisionId,
          baseRepositoryHeads: snapshot.provenance!.repositoryHeads,
          definition,
          observePersistence: (value) => {
            observed = value;
          },
        }),
      ).then((result) => {
        settled = true;
        return result;
      });
      await started;
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(observed).toBeUndefined();
      finish();
      const result = await pending;
      expect(
        result.isOk(),
        result.isErr() ? JSON.stringify(result.error) : "",
      ).toBe(true);
      if (result.isErr()) throw result.error;
      expect(observed).toMatchObject({
        ok: false,
        appliedLive: { document: { revisionId: result.value.revisionId } },
      });
      await service.waitForPersistence();
      expect(observed).toMatchObject({ ok: false });
    } finally {
      finish();
      await service.waitForPersistence();
      service.dispose();
    }
  },
);
