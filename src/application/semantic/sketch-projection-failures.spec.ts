import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("an out-of-plane external circle cannot certify an empty target sketch as current", async () => {
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const source = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    const target = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const opened = await w.execute({ operation: "sketch.begin", plane: "yz" });
    const projected = await w.run({
      operation: "sketch.reference.add",
      draft: opened.discovery!.state.draft,
      target,
      intent: "fulfill",
    });
    expect(
      projected.discovery!.sketch!.references![0]!.projection!.status,
    ).toBe("outOfPlane");
    expect(projected.outcome.kind).toBe("failed");
    expect(projected.completion.geometry.kind).not.toBe("current");
    expect(projected.diagnostics.length).toBeGreaterThan(0);
    expect(
      projected.discovery!.sketch!.operands.filter(
        (o) => o.target.kind === "projectedReferenceGeometry",
      ),
    ).toHaveLength(0);
    expect(projected.discovery!.sketch!.profiles).toHaveLength(0);
    const undone = await w.execute({
      operation: "history.undo",
      draft: projected.discovery!.state.draft,
    });
    const invalid = await w.run({
      operation: "sketch.reference.add",
      draft: undone.discovery!.state.draft,
      target,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("accepted-invalid");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
    expect(invalid.discovery!.sketch!.references![0]!.projection!.status).toBe(
      "outOfPlane",
    );
    expect(invalid.discovery!.sketch!.profiles).toHaveLength(0);
  } finally {
    await w.close();
  }
}, 180_000);

test("a deleted external source produces missing-source diagnostics rather than retaining old projected geometry", async () => {
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const source = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    const sourceId = source.discovery!.sketch!.sketchId!;
    const entity = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const local = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "point", position: [9, 9] },
      construction: false,
      intent: "fulfill",
    });
    const projected = await w.execute({
      operation: "sketch.reference.add",
      draft: local.discovery!.state.draft,
      target: entity,
      intent: "fulfill",
    });
    const referenceId =
      projected.discovery!.sketch!.references![0]!.definition.referenceId;
    const target = await w.execute({
      operation: "sketch.publish",
      draft: projected.discovery!.state.draft,
      requireProfiles: false,
    });
    const opened = await w.execute({
      operation: "sketch.open",
      sketchId: sourceId,
    });
    const deleted = await w.execute({
      operation: "sketch.geometry.delete",
      draft: opened.discovery!.state.draft,
      targets: [entity],
      intent: "fulfill",
    });
    await w.run({
      operation: "sketch.publish",
      draft: deleted.discovery!.state.draft,
      requireProfiles: false,
    });
    const refreshed = await w.run({
      operation: "sketch.open",
      sketchId: target.discovery!.sketch!.sketchId,
    });
    expect(refreshed.outcome.kind).toBe("failed");
    const reference = refreshed.discovery!.sketch!.references![0]!;
    expect(reference.definition.referenceId).toBe(referenceId);
    expect(reference.projection!.status).toBe("missingSource");
    expect(reference.projection!.geometry).toHaveLength(0);
    expect(
      refreshed.discovery!.sketch!.operands.filter(
        (o) => o.target.kind === "projectedReferenceGeometry",
      ),
    ).toHaveLength(0);
    expect(
      refreshed.diagnostics.some(
        (d) =>
          d.code.includes("missing") || d.code.includes("external-reference"),
      ),
    ).toBe(true);
    const republished = await w.run({
      operation: "sketch.publish",
      draft: refreshed.discovery!.state.draft,
      requireProfiles: false,
    });
    expect(republished.outcome.kind).toBe("failed");
    expect(republished.completion.geometry.kind).not.toBe("current");
    const sameSupport = await w.run({
      operation: "sketch.support.reassign",
      sketchId: target.discovery!.sketch!.sketchId,
      support: {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
    });
    expect(sameSupport.outcome.kind).toBe("failed");
    expect(sameSupport.completion.geometry.kind).not.toBe("current");
    expect(
      sameSupport.diagnostics.some((d) =>
        d.message.includes("Failed required barriers"),
      ),
    ).toBe(false);
  } finally {
    await w.close();
  }
}, 180_000);
