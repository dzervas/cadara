import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("splits a line at an explicit boundary crossing as one reversible completed action", async () => {
  const f = await createSketchWorkflow();
  try {
    const line = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const target = line.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const boundary = await f.execute({
      operation: "sketch.author",
      draft: line.discovery!.state.draft,
      primitive: { kind: "line", start: [4, -5], end: [4, 5] },
      construction: true,
      intent: "fulfill",
    });
    const cutter = boundary
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const split = await f.execute({
      operation: "sketch.geometry.update",
      draft: boundary.discovery!.state.draft,
      edit: { kind: "split", target, boundary: cutter, pick: [4, 0] },
      intent: "fulfill",
    });
    expect(split.completion.geometry.kind).toBe("current");
    if (split.completion.geometry.kind === "not-required")
      throw new Error("Missing geometry receipt");
    expect(split.completion.geometry.editQuery).toEqual({
      requestId: expect.stringMatching(/^request_semantic-edit-/),
      generation: boundary.discovery!.state.draft!.generation,
    });
    expect(split.completion.geometry.solve).toEqual({
      kind: "synchronous",
      generation: split.discovery!.state.draft!.generation,
    });
    expect(split.completion.geometry.derivation).toEqual({
      requestId: expect.any(String),
      generation: split.discovery!.state.draft!.generation,
    });
    const sketch = split.discovery!.sketch!;
    const lines = sketch.entities.filter((e) => !e.construction);
    expect(lines).toHaveLength(2);
    expect(lines.every((e) => e.kind === "lineSegment")).toBe(true);
    const endpoints = lines.map((e) =>
      e.pointIds.map(
        (id) => sketch.points.find((p) => p.pointId === id)!.position,
      ),
    );
    expect(endpoints).toEqual([
      [
        [0, 0],
        [4, 0],
      ],
      [
        [4, 0],
        [10, 0],
      ],
    ]);
    expect(lines[0]!.pointIds[1]).toBe(lines[1]!.pointIds[0]);
    expect(split.discovery!.history!.undoEntries).toHaveLength(
      boundary.discovery!.history!.undoEntries!.length + 1,
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: split.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities).toEqual(
      boundary.discovery!.sketch!.entities,
    );
    expect(undone.discovery!.sketch!.points).toEqual(
      boundary.discovery!.sketch!.points,
    );
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities).toEqual(
      split.discovery!.sketch!.entities,
    );
    expect(redone.discovery!.sketch!.points).toEqual(
      split.discovery!.sketch!.points,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("trims the middle of a line between the outermost crossings and extends a line to its explicit boundary", async () => {
  const f = await createSketchWorkflow();
  try {
    const line = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const target = line.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    for (const x of [3, 7])
      await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "line", start: [x, -5], end: [x, 5] },
        construction: true,
        intent: "fulfill",
      });
    const before = f.current();
    const trimmed = await f.execute({
      operation: "sketch.geometry.update",
      draft: before.discovery!.state.draft,
      edit: { kind: "trim", target },
      intent: "fulfill",
    });
    const s = trimmed.discovery!.sketch!;
    expect(
      s.entities
        .filter((e) => !e.construction)
        .map((e) =>
          e.pointIds.map(
            (id) => s.points.find((p) => p.pointId === id)!.position,
          ),
        ),
    ).toEqual([
      [
        [0, 0],
        [3, 0],
      ],
      [
        [7, 0],
        [10, 0],
      ],
    ]);
    expect(s.entities[0]!.entityId).toBe(
      line.discovery!.sketch!.entities[0]!.entityId,
    );
    expect(trimmed.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    const restored = await f.execute({
      operation: "history.undo",
      draft: trimmed.discovery!.state.draft,
    });
    expect(restored.discovery!.sketch!.entities).toEqual(
      before.discovery!.sketch!.entities,
    );
    const boundary = await f.execute({
      operation: "sketch.author",
      draft: restored.discovery!.state.draft,
      primitive: { kind: "line", start: [15, -5], end: [15, 5] },
      construction: true,
      intent: "fulfill",
    });
    const cutter = boundary
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const extended = await f.execute({
      operation: "sketch.geometry.update",
      draft: boundary.discovery!.state.draft,
      edit: { kind: "extend", target, boundary: cutter },
      intent: "fulfill",
    });
    const e = extended.discovery!.sketch!;
    expect(
      e.entities[0]!.pointIds.map(
        (id) => e.points.find((p) => p.pointId === id)!.position,
      ),
    ).toEqual([
      [0, 0],
      [15, 0],
    ]);
    expect(e.entities[0]!.entityId).toBe(
      line.discovery!.sketch!.entities[0]!.entityId,
    );
    expect(extended.discovery!.history!.undoEntries).toHaveLength(
      boundary.discovery!.history!.undoEntries!.length + 1,
    );
  } finally {
    await f.close();
  }
}, 60000);
