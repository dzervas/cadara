import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("non-tail support reassignment restores the final cursor and preserves later independent sketches", async () => {
  const w = await createSketchWorkflow();
  try {
    const first = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const source = await w.execute({
      operation: "sketch.publish",
      draft: first.discovery!.state.draft,
      requireProfiles: true,
    });
    const sourceId = source.discovery!.sketch!.sketchId!;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const later = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [12, 9], radius: 3 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: later.discovery!.state.draft,
      requireProfiles: true,
    });
    const laterId = published.discovery!.sketch!.sketchId!;
    const unchanged = await w.execute({
      operation: "sketch.support.reassign",
      sketchId: sourceId,
      support: {
        kind: "construction",
        constructionId: "construction_plane-xy",
      },
    });
    // The support is unchanged, but the real rollback/restoration writes advance the basis.
    expect(unchanged.outcome).toEqual({ kind: "completed", change: "changed" });
    expect(unchanged.completion.persistence.kind).toBe("committed");
    expect(
      unchanged.discovery!.references.some(
        (r) => r.target.kind === "sketch" && r.target.sketchId === laterId,
      ),
    ).toBe(true);
    expect(unchanged.discovery!.history!.undoEntries).toEqual(
      published.discovery!.history!.undoEntries,
    );
    const changed = await w.execute({
      operation: "sketch.support.reassign",
      sketchId: sourceId,
      support: {
        kind: "construction",
        constructionId: "construction_plane-xz",
      },
    });
    expect(changed.completion.persistence.kind).toBe("committed");
    expect(changed.completion.handoff.kind).toBe("current");
    expect(changed.completion.live.state).toEqual(changed.discovery!.state);
    expect(
      changed.discovery!.references.some(
        (r) => r.target.kind === "sketch" && r.target.sketchId === laterId,
      ),
    ).toBe(true);
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: laterId,
    });
    expect(reopened.discovery!.sketch!.plane).toBe("xy");
    expect(reopened.discovery!.sketch!.points[0]!.position).toEqual([12, 9]);
    expect(reopened.discovery!.sketch!.entities[0]!.radius).toBe(3);
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await w.close();
  }
}, 180_000);

test("a sketch cannot use its own downstream face as support and the rollback restores the solid", async () => {
  const w = await createSketchWorkflow();
  try {
    const rectangle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 8] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: rectangle.discovery!.state.draft,
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
      depth: 6,
      intent: "fulfill",
    });
    const face = solid.discovery!.references.find(
      (r) => r.target.kind === "face",
    )!.target;
    const result = await w.run({
      operation: "sketch.support.reassign",
      sketchId: sketch.sketchId,
      support: face,
    });
    expect(result.outcome.kind).toBe("failed");
    expect(result.completion.live.kind).toBe("applied");
    expect(result.completion.persistence.kind).toBe("committed");
    expect(result.completion.handoff.kind).toBe("current");
    expect(
      result.diagnostics.some(
        (d) => d.message.includes("support") && d.message.includes("cursor"),
      ),
    ).toBe(true);
    expect(result.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [0, 0, 0],
      max: [10, 8, 6],
    });
    expect(result.discovery!.history!.undoEntries).toEqual(
      solid.discovery!.history!.undoEntries,
    );
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: sketch.sketchId,
    });
    expect(reopened.discovery!.sketch!.plane).toBe("xy");
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await w.close();
  }
}, 180_000);
