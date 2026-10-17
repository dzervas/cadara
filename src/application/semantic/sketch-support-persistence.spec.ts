import { expect, test } from "vitest";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Only the persistence boundary fails; all modeling, cursor and projection work stays native.
class FailedSupportRepository extends MemoryDocumentRepository {
  failNextWrite = false;
  throwNextWrite = false;
  override async mutate(
    input: Parameters<MemoryDocumentRepository["mutate"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    if (this.throwNextWrite) {
      this.throwNextWrite = false;
      throw new Error("support write threw before receipt");
    }
    const written = await super.mutate(input);
    if (!this.failNextWrite || !written.ok) return written;
    this.failNextWrite = false;
    return {
      ok: false,
      status: {
        kind: "failed",
        documentId: input.documentId,
        diagnostic: {
          reasonCode: "write-failed",
          message: "support persistence failed",
        },
      },
      appliedLive: { document: written.document, metadata: written.metadata },
    };
  }
}

test("a failed support write reports its actual applied basis and never claims committed persistence", async () => {
  let repository: FailedSupportRepository;
  const w = await createSketchWorkflow({
    createRepository: (assets) =>
      (repository = new FailedSupportRepository([], assets)),
  });
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    repository!.failNextWrite = true;
    const result = await w.run({
      operation: "sketch.support.reassign",
      sketchId: published.discovery!.sketch!.sketchId,
      support: {
        kind: "construction",
        constructionId: "construction_plane-xz",
      },
    });
    expect(result.outcome.kind).toBe("failed");
    expect(result.completion.persistence.kind).toBe("failed");
    expect(result.completion.live.kind).toBe("applied");
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("support persistence failed"),
      ),
    ).toBe(true);
    expect(result.completion.live.state!.revisionId).not.toBe(
      published.discovery!.state.revisionId,
    );
    const inspected = await w.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.state).toEqual(result.completion.live.state);
    // The service retains the failed persistence status; inspecting actual live geometry is still possible.
    const reopened = await w.run({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(reopened.completion.persistence.kind).toBe("failed");
    expect(reopened.discovery!.sketch!.plane).toBe("xz");
    expect(reopened.discovery!.sketch!.points[0]!.position).toEqual([4, 3]);
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await w.close();
  }
}, 180_000);

test("a support write that throws without a receipt cannot be reported as committed", async () => {
  let repository: FailedSupportRepository;
  const w = await createSketchWorkflow({
    createRepository: (assets) =>
      (repository = new FailedSupportRepository([], assets)),
  });
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    repository!.throwNextWrite = true;
    const result = await w.run({
      operation: "sketch.support.reassign",
      sketchId: published.discovery!.sketch!.sketchId,
      support: {
        kind: "construction",
        constructionId: "construction_plane-xz",
      },
    });
    expect(result.outcome.kind).toBe("failed");
    expect(result.completion.persistence.kind).toBe("failed");
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("support write threw before receipt"),
      ),
    ).toBe(true);
    expect(
      result.diagnostics.some((d) =>
        d.message.includes("All observed barrier failures"),
      ),
    ).toBe(false);
    if (result.outcome.kind === "failed")
      expect(result.outcome.failures).toContain("geometry");
  } finally {
    await w.close();
  }
}, 180_000);
