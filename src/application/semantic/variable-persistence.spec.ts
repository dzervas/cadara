import { expect, test } from "vitest";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Failure injection is confined to the repository boundary, never the modeling runtime.
class VariableWriteRepository extends MemoryDocumentRepository {
  failure: "receipt" | "throw" | null = null;
  override async mutate(
    input: Parameters<MemoryDocumentRepository["mutate"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    const failure = this.failure;
    this.failure = null;
    if (failure === "throw")
      throw new Error("variable write threw before receipt");
    const written = await super.mutate(input);
    if (failure !== "receipt" || !written.ok) return written;
    return {
      ok: false,
      status: {
        kind: "failed",
        documentId: input.documentId,
        diagnostic: {
          reasonCode: "write-failed",
          message: "variable persistence failed",
        },
      },
      appliedLive: { document: written.document, metadata: written.metadata },
    };
  }
}

for (const failure of ["receipt", "throw"] as const) {
  test(`variable ${failure} failure cannot claim committed persistence or hide applied state`, async () => {
    let repository: VariableWriteRepository;
    const w = await createSketchWorkflow({
      createRepository: (assets) =>
        (repository = new VariableWriteRepository([], assets)),
    });
    try {
      await w.execute({
        operation: "sketch.discard",
        draft: w.current().discovery!.state.draft,
      });
      const added = await w.execute({
        operation: "variable.add",
        name: "size",
        valueText: "3",
        intent: "fulfill",
      });
      const variableId = added.discovery!.variables![0]!.variableId;
      repository!.failure = failure;
      const result = await w.run({
        operation: "variable.update",
        variableId,
        name: "size",
        valueText: "8",
        intent: "fulfill",
      });
      expect(result.outcome.kind, JSON.stringify(result)).toBe("failed");
      expect(result.completion.persistence.kind, JSON.stringify(result)).toBe(
        "failed",
      );
      expect(result.completion.live.kind).toBe("applied");
      expect(
        result.diagnostics.some((d) =>
          d.message.includes(
            failure === "receipt"
              ? "variable persistence failed"
              : "variable write threw before receipt",
          ),
        ),
      ).toBe(true);
      const inspected = await w.execute({ operation: "document.inspect" });
      expect(inspected.discovery!.state).toEqual(result.completion.live.state);
      expect(inspected.discovery!.variables![0]).toMatchObject({
        variableId,
        name: "size",
        valueText: "8",
      });
    } finally {
      await w.close();
    }
  }, 180_000);
}
