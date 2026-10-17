import { expect, test } from "vitest";
import { MemoryDocumentRepository } from "@/domain/modeling/memory-document-repository";
import type { DocumentRepositoryMutationResult } from "@/domain/modeling/document-repository";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Only persistence is faulted; the production modeling runtime and geometry remain real.
class LifecycleWriteRepository extends MemoryDocumentRepository {
  failure: "receipt" | "throw" | null = null;
  override async mutate(
    input: Parameters<MemoryDocumentRepository["mutate"]>[0],
  ): Promise<DocumentRepositoryMutationResult> {
    const failure = this.failure;
    this.failure = null;
    if (failure === "throw")
      throw new Error("lifecycle write threw before receipt");
    const written = await super.mutate(input);
    if (failure !== "receipt" || !written.ok) return written;
    return {
      ok: false,
      status: {
        kind: "failed",
        documentId: input.documentId,
        diagnostic: {
          reasonCode: "write-failed",
          message: "lifecycle persistence failed",
        },
      },
      appliedLive: { document: written.document, metadata: written.metadata },
    };
  }
}

for (const failure of ["receipt", "throw"] as const) {
  test(`lifecycle ${failure} failure preserves applied truth without claiming commitment`, async () => {
    let repository: LifecycleWriteRepository;
    const w = await createSketchWorkflow({
      createRepository: (assets) =>
        (repository = new LifecycleWriteRepository([], assets)),
    });
    try {
      const circle = await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive: { kind: "circle", center: [0, 0], radius: 2 },
        construction: false,
        intent: "fulfill",
      });
      const published = await w.execute({
        operation: "sketch.publish",
        draft: circle.discovery!.state.draft,
        requireProfiles: true,
      });
      const sketch = published.discovery!.sketch!;
      const solid = await w.execute({
        operation: "extrude.create",
        profile: {
          kind: "region",
          sketchId: sketch.sketchId,
          regionId: sketch.profiles[0]!.regionId,
        },
        depth: 7,
        intent: "fulfill",
      });
      const featureId = solid.discovery!.model!.features[0]!.featureId;
      repository!.failure = failure;
      const result = await w.run({
        operation: "feature.suppression.set",
        featureId,
        suppressed: true,
        intent: "fulfill",
      });
      expect(result.outcome.kind, JSON.stringify(result)).toBe("failed");
      expect(result.completion.live.kind).toBe("applied");
      expect(result.completion.persistence.kind).toBe("failed");
      expect(
        result.diagnostics.some((d) =>
          d.message.includes(
            failure === "receipt"
              ? "lifecycle persistence failed"
              : "lifecycle write threw before receipt",
          ),
        ),
      ).toBe(true);
      const inspected = await w.execute({ operation: "document.inspect" });
      expect(inspected.discovery!.state).toEqual(result.completion.live.state);
      expect(inspected.discovery!.model!.features[0]).toMatchObject({
        featureId,
        suppressed: true,
      });
      expect(inspected.discovery!.model!.bodies).toEqual([]);
    } finally {
      await w.close();
    }
  }, 180_000);
}

test("lifecycle refuses private contexts and stale bases without changing author history", async () => {
  const w = await createSketchWorkflow();
  try {
    const before = w.current().discovery!;
    const privateResult = await w.run({
      operation: "timeline.cursor.set",
      cursor: { kind: "empty" },
      intent: "fulfill",
    });
    expect(privateResult.outcome.kind).toBe("rejected");
    expect(privateResult.completion.live.kind).toBe("unchanged");
    expect(privateResult.completion.persistence.kind).toBe("not-required");
    const privateState = await w.execute({ operation: "document.inspect" });
    expect(privateState.discovery!.state).toEqual(before.state);
    expect(privateState.discovery!.history).toEqual(before.history);
    await w.execute({ operation: "sketch.discard", draft: before.state.draft });
    const old = w.current().discovery!.state;
    await w.execute({ operation: "document.rename", label: "Advanced" });
    const advanced = w.current().discovery!;
    const stale = await w.run({
      operation: "timeline.cursor.set",
      basis: {
        documentId: old.documentId,
        revisionId: old.revisionId,
        repositoryHeads: old.repositoryHeads,
      },
      cursor: { kind: "empty" },
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    expect(stale.completion.live.kind).toBe("unchanged");
    expect(stale.completion.persistence.kind).toBe("not-required");
    const inspected = await w.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.state).toEqual(advanced.state);
    expect(inspected.discovery!.history).toEqual(advanced.history);
  } finally {
    await w.close();
  }
}, 180_000);

test("lifecycle cannot certify an invalid published sketch merely because no solid exists", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    const variable = await w.execute({
      operation: "variable.add",
      name: "radius",
      valueText: "3",
      intent: "fulfill",
    });
    const variableId = variable.discovery!.variables![0]!.variableId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 3 },
      construction: false,
      intent: "fulfill",
    });
    const target = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const dimension = await w.execute({
      operation: "sketch.requirement.add",
      draft: circle.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [target],
      mode: "driving",
      value: 3,
      intent: "fulfill",
    });
    await w.execute({
      operation: "sketch.dimension.update",
      draft: dimension.discovery!.state.draft,
      dimensionId: dimension.discovery!.sketch!.requirements[0]!.dimensionId,
      value: "radius",
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketchId = published.discovery!.sketch!.sketchId!;
    await w.run({
      operation: "variable.update",
      variableId,
      name: "radius",
      valueText: "-2",
      intent: "fulfill",
    });
    const invalid = await w.run({
      operation: "timeline.cursor.set",
      cursor: { kind: "sketch", sketchId },
      intent: "fulfill",
    });
    expect(invalid.outcome, JSON.stringify(invalid)).toMatchObject({
      kind: "failed",
      failures: expect.arrayContaining(["geometry"]),
    });
    expect(invalid.completion.geometry.kind).toBe("failed");
    expect(invalid.discovery!.model!.bodies).toEqual([]);
    const accepted = await w.run({
      operation: "timeline.cursor.set",
      cursor: { kind: "sketch", sketchId },
      intent: "author-invalid",
    });
    expect(accepted.outcome.kind, JSON.stringify(accepted)).toBe(
      "accepted-invalid",
    );
    expect(accepted.completion.geometry.kind).toBe("invalid-editable");
  } finally {
    await w.close();
  }
}, 180_000);
