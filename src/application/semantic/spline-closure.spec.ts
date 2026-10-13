import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("closes an ordinary spline by merging owned end identities, not coincident coordinates, and restores it with private undo", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [0, 0],
          [4, 0],
          [2, 3],
          [0.02, 0.01],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    expect(created.discovery!.sketch!.profiles).toEqual([]);
    const source = created.discovery!.references.find(
      (r) => r.label === "Spline 1 point 4",
    )!.target;
    const destination = created.discovery!.references.find(
      (r) => r.label === "Spline 1 point 1",
    )!.target;
    const closed = await f.execute({
      operation: "sketch.geometry.update",
      draft: created.discovery!.state.draft,
      edit: { kind: "mergePoints", target: source, destination },
      intent: "fulfill",
    });
    const sketch = closed.discovery!.sketch!;
    expect(sketch.entities[0]!.closure).toBe("positional");
    expect(sketch.points.map((p) => p.position)).toEqual([
      [0, 0],
      [4, 0],
      [2, 3],
    ]);
    expect(sketch.entities[0]!.pointIds).toEqual([
      sketch.points[0]!.pointId,
      sketch.points[1]!.pointId,
      sketch.points[2]!.pointId,
      sketch.points[0]!.pointId,
    ]);
    expect(sketch.entities[0]!.entityId).toBe(
      created.discovery!.sketch!.entities[0]!.entityId,
    );
    expect(sketch.profiles).toHaveLength(1);
    const undone = await f.execute({
      operation: "history.undo",
      draft: closed.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [4, 0],
      [2, 3],
      [0.02, 0.01],
    ]);
    expect(undone.discovery!.sketch!.profiles).toEqual([]);
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.profiles).toHaveLength(1);
    const published = await f.execute({
      operation: "sketch.publish",
      draft: redone.discovery!.state.draft,
      requireProfiles: true,
    });
    const reopened = await f.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(reopened.discovery!.sketch!.entities[0]!.pointIds).toEqual(
      sketch.entities[0]!.pointIds,
    );
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 30000);
