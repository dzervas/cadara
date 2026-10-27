import { createMemoryOperationHistoryStore } from "@/domain/modeling/modeling-history-persistence";
import { enterSketchSession } from "@/domain/editor/sketch-entry.fixtures";
import { expect, it } from "vitest";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import { authorSketchPrimitive } from "@/domain/editor/sketch-session/drawing-commit";
import { createNewSketchSession } from "@/domain/editor/sketch-session/state";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createModelingService } from "./service";
import { createAuthoredModelDocumentFromSnapshot } from "@/contracts/modeling/authored-document";
import { createSketchPublicationFailureFixture } from "./sketch-publication.fixtures";

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

it.each([false, true])(
  "a post-write restore failure preserves the publication receipt and recovers without another write (appliedLive=%s)",
  async (appliedLive) => {
    const { service, repository, receipts } =
      createSketchPublicationFailureFixture(appliedLive);
    try {
      const before = createAuthoredModelDocumentFromSnapshot(
        await service.getCurrentDocumentSnapshot(),
      );
      const sketch = before.sketches[0]!;
      const definition = structuredClone(sketch.definition);
      definition.points[0] = { ...definition.points[0]!, position: [41, 17] };
      const result = await service.commitSketch({
        baseRevisionId: before.revisionId,
        sketchId: sketch.sketchId,
        sketchLabel: sketch.label,
        plane: sketch.plane,
        definition,
        solverCorrelation: {
          requestId: "request_restore_failure",
          projectionRequestId: "request_restore_failure:project",
          validationRequestId: "request_restore_failure:validate",
          solveRequestId: "request_restore_failure:solve",
          regionRequestId: "request_restore_failure:regions",
        },
        publicationBase: {
          actionContextId: sketch.sketchId,
          expectedSketch: sketch,
        },
      });
      expect(
        result.isOk(),
        "The authored write committed even though its runtime restore failed.",
      ).toBe(true);
      if (result.isErr()) throw result.error;
      expect(result.value.revisionState.kind).toBe("accepted");
      expect(result.value.sketchId).toBe(sketch.sketchId);
      expect(result.value.revisionId).not.toBe(before.revisionId);
      expect(result.value.durabilityPending ?? false).toBe(appliedLive);
      expect(result.value.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "sketch-publication-restore-failed",
          message: expect.stringContaining(
            "Injected post-publication restore failure",
          ),
        }),
      );
      const receipt = receipts[0]!;
      const written = receipt.ok
        ? receipt.document
        : receipt.appliedLive!.document;
      expect(result.value.revisionId).toBe(written.revisionId);
      const recovered = await service.getCurrentDocumentSnapshot();
      expect(recovered.document.revisionId).toBe(written.revisionId);
      expect(
        recovered.document.sketches[0]!.sketch.definition.points[0]!.position,
      ).toEqual([41, 17]);
      expect(recovered.document.diagnostics).toContainEqual(
        expect.objectContaining({ code: "sketch-publication-restore-failed" }),
      );
      expect(receipts).toHaveLength(1);
      const stored = await repository.load({
        documentId: before.documentId,
        seedDocument: before,
      });
      expect(stored.ok && stored.document.revisionId).toBe(written.revisionId);
      expect(
        (await repository.getDurableHistoryAvailability(before.documentId))
          .undoEntries,
      ).toHaveLength(1);
    } finally {
      service.dispose();
    }
  },
);

it("cursor restoration clears acknowledged replay history without dropping the committed point", async () => {
  const adapter = new MockKernelAdapter();
  const repository = new MemoryDocumentRepository();
  const history = createMemoryOperationHistoryStore();
  const service = createModelingService(adapter, {
    currentDocumentId: "doc_workspace",
    documentRepository: repository,
    documentRepositoryPersistence: "background",
    operationHistoryStore: history,
  });
  try {
    const before = await service.getCurrentDocumentSnapshot();
    const session = authorSketchPrimitive(
      enterSketchSession(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
      ),
      { kind: "line", start: [1, 1], end: [6, 2.5] },
      false,
    );
    const pointId = session.definition.points.at(-1)!.pointId;
    const committed = await service.commitSketch({
      baseRevisionId: before.document.revisionId,
      sketchId: null,
      sketchLabel: "Edited outline",
      plane: session.plane,
      definition: session.definition,
      solverCorrelation: {
        requestId: "request_cursor_publish",
        projectionRequestId: "request_cursor_projection",
        validationRequestId: "request_cursor_validation",
        solveRequestId: "request_cursor_solve",
        regionRequestId: "request_cursor_regions",
      },
      publicationBase: {
        actionContextId: session.actionContextId,
        expectedSketch: null,
      },
    });
    if (committed.isErr()) throw committed.error;
    expect(committed.value.revisionState.kind).toBe("accepted");
    const pending = history.load();
    expect(pending.ok && pending.payload?.entries.at(-1)?.kind).toBe(
      "commitSketch",
    );
    const cursor = await service.setFeatureCursor({
      baseRevisionId: committed.value.revisionId,
      cursor: before.document.cursor,
      persistHistory: false,
    });
    if (cursor.isErr()) throw cursor.error;
    expect(cursor.value.revisionState.kind).toBe("accepted");
    await service.waitForPersistence();
    expect(history.load()).toEqual({ ok: true, payload: null });
    const stored = await repository.load({
      documentId: "doc_workspace",
      seedDocument: await adapter.exportAuthoredModelDocument("doc_workspace"),
    });
    if (!stored.ok) throw new Error("Expected persisted publication");
    expect(
      stored.document.sketches
        .find((s) => s.sketchId === committed.value.sketchId)!
        .definition.points.find((p) => p.pointId === pointId)!.position,
    ).toEqual([6, 2.5]);
    expect(stored.document.cursor).toEqual(before.document.cursor);
  } finally {
    service.dispose();
  }
});
