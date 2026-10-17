import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("trims both adjacent lines even when their coincident corner has distinct authored point identities", async () => {
  const f = await createSketchWorkflow();
  try {
    for (const [start, end] of [
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 0],
        [10, 10],
      ],
    ])
      await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "line", start, end },
        construction: false,
        intent: "fulfill",
      });
    const before = f.current();
    const targets = before
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    expect(before.discovery!.sketch!.entities[0]!.pointIds[1]).not.toBe(
      before.discovery!.sketch!.entities[1]!.pointIds[0],
    );
    for (const input of [
      { kind: "fillet", radius: 2 },
      { kind: "chamfer", distance: 3 },
    ]) {
      const changed = await f.execute({
        operation: "sketch.geometry.build",
        ...input,
        targets,
        draft: f.current().discovery!.state.draft,
        intent: "fulfill",
      });
      const sketch = changed.discovery!.sketch!;
      const corner = sketch.entities[1]!.pointIds.map(
        (id) => sketch.points.find((p) => p.pointId === id)!.position,
      );
      expect(corner[0]![0]).toBeCloseTo(10, 6);
      expect(corner[0]![1]).toBeCloseTo(input.kind === "fillet" ? 2 : 3, 6);
      expect(corner[1]).toEqual([10, 10]);
      expect(sketch.entities[0]!.entityId).toBe(
        before.discovery!.sketch!.entities[0]!.entityId,
      );
      expect(sketch.entities[1]!.entityId).toBe(
        before.discovery!.sketch!.entities[1]!.entityId,
      );
      const undone = await f.execute({
        operation: "history.undo",
        draft: changed.discovery!.state.draft,
      });
      expect(undone.discovery!.sketch!.entities).toEqual(
        before.discovery!.sketch!.entities,
      );
      expect(undone.discovery!.sketch!.points).toEqual(
        before.discovery!.sketch!.points,
      );
    }
  } finally {
    await f.close();
  }
}, 60000);

it("fillets an adjacent rectangle corner through one reversible completed action", async () => {
  const f = await createSketchWorkflow();
  try {
    const rectangle = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 10] },
      construction: false,
      intent: "fulfill",
    });
    const before = await f.execute({
      operation: "sketch.requirement.add",
      draft: rectangle.discovery!.state.draft,
      tool: "dimensionDistance",
      targets: [
        rectangle.discovery!.references.find(
          (r) => r.target.kind === "sketchEntity",
        )!.target,
      ],
      mode: "reference",
      value: null,
      intent: "fulfill",
    });
    const targets = before
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .slice(0, 2)
      .map((r) => r.target);
    const rounded = await f.execute({
      operation: "sketch.geometry.build",
      draft: before.discovery!.state.draft,
      kind: "fillet",
      targets,
      radius: 2,
      intent: "fulfill",
    });
    const sketch = rounded.discovery!.sketch!;
    expect(sketch.entities).toHaveLength(5);
    const arc = sketch.entities.find((e) => e.kind === "arc")!;
    expect(arc.radius!).toBeCloseTo(2, 6);
    const positions = arc.pointIds.map(
      (id) => sketch.points.find((p) => p.pointId === id)!.position,
    );
    expect(positions[0]![0]).toBeCloseTo(8, 6);
    expect(positions[0]![1]).toBeCloseTo(0, 6);
    expect(positions[1]![0]).toBeCloseTo(10, 6);
    expect(positions[1]![1]).toBeCloseTo(2, 6);
    expect(positions[2]![0]).toBeCloseTo(8, 6);
    expect(positions[2]![1]).toBeCloseTo(2, 6);
    expect(sketch.profiles).toHaveLength(1);
    expect(
      sketch.constraints.slice(0, before.discovery!.sketch!.constraints.length),
    ).toEqual(before.discovery!.sketch!.constraints);
    expect(sketch.measurements[0]!.dimensionId).toBe(
      before.discovery!.sketch!.measurements[0]!.dimensionId,
    );
    expect(
      before.discovery!.sketch!.measurements[0]!.measuredValue,
    ).toBeCloseTo(10, 6);
    expect(sketch.measurements[0]!.measuredValue).toBeCloseTo(8, 6);
    expect(sketch.requirements.length).toBeGreaterThan(
      before.discovery!.sketch!.requirements.length,
    );
    expect(rounded.completion.geometry.kind).toBe("current");
    if (rounded.completion.geometry.kind === "not-required")
      throw new Error("Missing geometry receipt");
    expect(rounded.completion.geometry.solve).toEqual({
      kind: "synchronous",
      generation: rounded.discovery!.state.draft!.generation,
    });
    expect(rounded.completion.geometry.derivation).toEqual({
      requestId: expect.any(String),
      generation: rounded.discovery!.state.draft!.generation,
    });
    expect(rounded.discovery!.state.draft!.generation).toBeGreaterThan(
      before.discovery!.state.draft!.generation,
    );
    expect(rounded.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: rounded.discovery!.state.draft,
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
    expect(redone.discovery!.sketch!.requirements).toEqual(sketch.requirements);
  } finally {
    await f.close();
  }
}, 60000);

it("chamfers an adjacent rectangle corner while preserving requirements and publication", async () => {
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
      .slice(0, 2)
      .map((r) => r.target);
    const beveled = await f.execute({
      operation: "sketch.geometry.build",
      draft: before.discovery!.state.draft,
      kind: "chamfer",
      targets,
      distance: 3,
      intent: "fulfill",
    });
    const sketch = beveled.discovery!.sketch!;
    expect(sketch.entities).toHaveLength(5);
    const line = sketch.entities.at(-1)!;
    expect(line.kind).toBe("lineSegment");
    expect(
      line.pointIds.map(
        (id) => sketch.points.find((p) => p.pointId === id)!.position,
      ),
    ).toEqual([
      [7, 0],
      [10, 3],
    ]);
    expect(sketch.requirements).toEqual(before.discovery!.sketch!.requirements);
    expect(sketch.constraints).toEqual(before.discovery!.sketch!.constraints);
    expect(sketch.profiles).toHaveLength(1);
    expect(beveled.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: beveled.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.points).toEqual(
      before.discovery!.sketch!.points,
    );
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities).toEqual(sketch.entities);
    const published = await f.execute({
      operation: "sketch.publish",
      draft: redone.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(published.discovery!.sketch!.entities).toEqual(sketch.entities);
    expect(published.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 60000);
