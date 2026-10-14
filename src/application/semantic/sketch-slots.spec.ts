import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("creates a line slot with shared bound semicircles and preserves its seed and history", async () => {
  const f = await createSketchWorkflow();
  try {
    const before = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const target = before.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const slotted = await f.execute({
      operation: "sketch.geometry.build",
      kind: "slot",
      targets: [target],
      width: 4,
      draft: before.discovery!.state.draft,
      intent: "fulfill",
    });
    const sketch = slotted.discovery!.sketch!;
    expect(sketch.entities).toHaveLength(5);
    expect(sketch.entities[0]).toEqual(before.discovery!.sketch!.entities[0]);
    const sides = sketch.entities
      .slice(1)
      .filter((e) => e.kind === "lineSegment");
    expect(
      sides.map((e) =>
        e.pointIds.map(
          (id) => sketch.points.find((p) => p.pointId === id)!.position,
        ),
      ),
    ).toEqual([
      [
        [0, 2],
        [10, 2],
      ],
      [
        [10, -2],
        [0, -2],
      ],
    ]);
    const arcs = sketch.entities.filter((e) => e.kind === "arc");
    expect(arcs).toHaveLength(2);
    expect(arcs.map((e) => e.radius)).toEqual([2, 2]);
    expect(arcs.map((e) => e.pointIds[2])).toEqual([
      before.discovery!.sketch!.entities[0]!.pointIds[1],
      before.discovery!.sketch!.entities[0]!.pointIds[0],
    ]);
    expect(sketch.requirements).toHaveLength(4);
    expect(sketch.constraints.filter((c) => c.kind === "tangent")).toHaveLength(
      4,
    );
    expect(slotted.completion.geometry.kind).toBe("current");
    expect(slotted.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: slotted.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities).toEqual(
      before.discovery!.sketch!.entities,
    );
    expect(undone.discovery!.sketch!.requirements).toEqual(
      before.discovery!.sketch!.requirements,
    );
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities).toEqual(sketch.entities);
    const cleaned = await f.execute({
      operation: "sketch.construction.set",
      target,
      construction: true,
      draft: redone.discovery!.state.draft,
      intent: "fulfill",
    });
    expect(cleaned.discovery!.sketch!.profiles).toHaveLength(1);
    const published = await f.execute({
      operation: "sketch.publish",
      draft: cleaned.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(published.discovery!.sketch!.entities).toEqual(
      cleaned.discovery!.sketch!.entities,
    );
    expect(published.discovery!.sketch!.requirements).toEqual(
      sketch.requirements,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("creates an arc slot with radial caps and exact inner and outer quarter arcs", async () => {
  const f = await createSketchWorkflow();
  try {
    const before = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "centerPointArc",
        center: [0, 0],
        start: [5, 0],
        end: [0, 5],
      },
      construction: false,
      intent: "fulfill",
    });
    const target = before.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const slotted = await f.execute({
      operation: "sketch.geometry.build",
      kind: "slot",
      targets: [target],
      width: 2,
      draft: before.discovery!.state.draft,
      intent: "fulfill",
    });
    const sketch = slotted.discovery!.sketch!;
    expect(sketch.entities).toHaveLength(5);
    expect(sketch.entities[0]).toEqual(before.discovery!.sketch!.entities[0]);
    expect(
      sketch.entities.filter((e) => e.kind === "arc").map((e) => e.radius),
    ).toEqual([5, 6, 4]);
    const caps = sketch.entities.filter((e) => e.kind === "lineSegment");
    expect(
      caps.map((e) =>
        e.pointIds.map(
          (id) => sketch.points.find((p) => p.pointId === id)!.position,
        ),
      ),
    ).toEqual([
      [
        [0, 6],
        [0, 4],
      ],
      [
        [4, 0],
        [6, 0],
      ],
    ]);
    expect(sketch.requirements).toHaveLength(
      before.discovery!.sketch!.requirements.length + 4,
    );
    expect(slotted.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    const cleaned = await f.execute({
      operation: "sketch.construction.set",
      target,
      construction: true,
      draft: slotted.discovery!.state.draft,
      intent: "fulfill",
    });
    expect(cleaned.discovery!.sketch!.profiles).toHaveLength(1);
    expect(cleaned.completion.geometry.kind).toBe("current");
  } finally {
    await f.close();
  }
}, 60000);

it("creates closed-line slots as two joined offset loops while keeping the original seed", async () => {
  const f = await createSketchWorkflow();
  try {
    const before = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 10] },
      construction: false,
      intent: "fulfill",
    });
    const targets = before
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    const slotted = await f.execute({
      operation: "sketch.geometry.build",
      kind: "slot",
      targets,
      width: 2,
      draft: before.discovery!.state.draft,
      intent: "fulfill",
    });
    const sketch = slotted.discovery!.sketch!;
    expect(sketch.entities).toHaveLength(12);
    expect(sketch.entities.slice(0, 4)).toEqual(
      before.discovery!.sketch!.entities,
    );
    const added = sketch.points.slice(before.discovery!.sketch!.points.length);
    expect(
      added.map((p) => p.position).sort((a, b) => a[0] - b[0] || a[1] - b[1]),
    ).toEqual([
      [-1, -1],
      [-1, 11],
      [1, 1],
      [1, 9],
      [9, 1],
      [9, 9],
      [11, -1],
      [11, 11],
    ]);
    expect(sketch.constraints).toEqual(before.discovery!.sketch!.constraints);
    expect(slotted.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    for (const target of targets)
      await f.execute({
        operation: "sketch.construction.set",
        target,
        construction: true,
        draft: f.current().discovery!.state.draft,
        intent: "fulfill",
      });
    expect(f.current().discovery!.sketch!.profiles).toHaveLength(2);
    expect(f.current().completion.geometry.kind).toBe("current");
  } finally {
    await f.close();
  }
}, 60000);
