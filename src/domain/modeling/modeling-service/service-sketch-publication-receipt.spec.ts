import { expect, it } from "vitest";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import { authorSketchPrimitive } from "@/domain/editor/sketch-session/tools";
import { createNewSketchSession } from "@/domain/editor/sketch-session/state";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createModelingService } from "./service";

// Logic seam: exact repository publication observation, not geometric conformance.
class FailedPublicationRepository extends MemoryDocumentRepository {
  override async mutate(
    input: Parameters<MemoryDocumentRepository["mutate"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    const written = await super.mutate(input);
    if (!written.ok || input.label !== "Publish Sketch") return written;
    return {
      ok: false,
      status: {
        kind: "failed",
        documentId: input.documentId,
        diagnostic: {
          reasonCode: "write-failed",
          message: "publication flush failed",
        },
      },
      appliedLive: { document: written.document, metadata: written.metadata },
    };
  }
}
it("observes the failed publication transaction with its actual applied live sketch, despite a fulfilled drain", async () => {
  const repository = new FailedPublicationRepository();
  const service = createModelingService(new MockKernelAdapter(), {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
  });
  try {
    const snapshot = await service.getCurrentDocumentSnapshot();
    const session = authorSketchPrimitive(
      createNewSketchSession(
        createStandardPlaneDefinition("xy"),
        OCC_KERNEL_SETTINGS,
      ),
      { kind: "line", start: [0, 0], end: [10, 0] },
      false,
    );
    let observed: DocumentRepositoryMutationResult | undefined;
    const committed = await service.commitSketch({
      baseRevisionId: snapshot.document.revisionId,
      baseRepositoryHeads: snapshot.provenance!.repositoryHeads,
      sketchId: null,
      sketchLabel: "Publication",
      plane: session.plane,
      definition: session.definition,
      solverCorrelation: {
        requestId: "request_publish",
        projectionRequestId: "request_projection",
        validationRequestId: "request_validation",
        solveRequestId: "request_solve",
        regionRequestId: "request_regions",
      },
      publicationBase: {
        actionContextId: session.actionContextId,
        expectedSketch: null,
      },
      observePublication: (receipt) => {
        observed = receipt;
      },
    });
    expect(
      committed.isOk(),
      committed.isErr() ? JSON.stringify(committed.error) : "",
    ).toBe(true);
    if (committed.isErr()) throw committed.error;
    expect(committed.value.durabilityPending).toBe(true);
    expect(observed).toMatchObject({
      ok: false,
      appliedLive: {
        document: {
          sketches: [{ label: "Sketch 1" }, { label: "Publication" }],
        },
      },
    });
    await service.waitForPersistence();
    expect(observed).toMatchObject({ ok: false });
    expect(
      (await service.getCurrentDocumentSnapshot()).document.sketches.map(
        (s) => s.label,
      ),
    ).toEqual(["Sketch 1", "Publication"]);
  } finally {
    service.dispose();
  }
});
