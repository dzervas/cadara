import { MockKernelAdapter } from "@/application/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/application/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/contracts/modeling/document-repository";
import { createModelingService } from "./service";
import { SketchConstraintSolverAdapter } from "@/application/solver/sketch-constraint-solver-adapter";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";

/** Fault only after the real repository accepted a publication, never during entry. */
export function createSketchPublicationFailureFixture(appliedLive = false) {
  const adapter = new MockKernelAdapter();
  let restoreFailures = 0;
  const restore = adapter.restoreAuthoredModelDocument.bind(adapter);
  adapter.restoreAuthoredModelDocument = async (...args) => {
    if (restoreFailures > 0) {
      restoreFailures -= 1;
      throw new Error("Injected post-publication restore failure");
    }
    return restore(...args);
  };
  const repository = new MemoryDocumentRepository();
  const receipts: DocumentRepositoryMutationResult[] = [];
  const mutate = repository.mutate.bind(repository);
  repository.mutate = async (input) => {
    const result = await mutate(input);
    if (input.label !== "Publish Sketch" || !result.ok) return result;
    restoreFailures = 1;
    const receipt: DocumentRepositoryMutationResult = appliedLive
      ? {
          ok: false,
          status: {
            kind: "failed",
            documentId: input.documentId,
            diagnostic: { reasonCode: "write-failed", message: "flush failed" },
          },
          appliedLive: { document: result.document, metadata: result.metadata },
        }
      : result;
    receipts.push(receipt);
    return receipt;
  };
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
    sketchSolver: new SketchConstraintSolverAdapter({
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
      documentId: "doc_workspace",
      revisionId: null,
    }),
  });
  return { service, repository, adapter, receipts };
}
