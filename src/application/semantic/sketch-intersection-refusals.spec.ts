import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("uses an explicit crossing pick rather than traversal order when a boundary has two crossings", async () => {
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
      primitive: { kind: "circle", center: [5, 0], radius: 2 },
      construction: true,
      intent: "fulfill",
    });
    const cutter = boundary
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const split = await f.execute({
      operation: "sketch.geometry.update",
      draft: boundary.discovery!.state.draft,
      edit: { kind: "split", target, boundary: cutter, pick: [7, 0] },
      intent: "fulfill",
    });
    const s = split.discovery!.sketch!;
    const end = s.points.find(
      (p) => p.pointId === s.entities[0]!.pointIds[1],
    )!.position;
    expect(end[0]).toBeCloseTo(7, 4);
    expect(end[1]).toBeCloseTo(0, 4);
    expect(s.entities.filter((e) => !e.construction)).toHaveLength(2);
    const restored = await f.execute({
      operation: "history.undo",
      draft: split.discovery!.state.draft,
    });
    const ambiguous = await f.run({
      operation: "sketch.geometry.update",
      draft: restored.discovery!.state.draft,
      edit: { kind: "split", target, boundary: cutter, pick: [5, 0] },
      intent: "fulfill",
    });
    expect(ambiguous.outcome).toEqual({
      kind: "rejected",
      reasonCode: "sketch-edit-refused",
    });
    expect(
      ambiguous.diagnostics.some((d) => d.message.includes("equally near")),
    ).toBe(true);
    const inspected = await f.execute({
      operation: "sketch.inspect",
      draft: ambiguous.completion.live.state!.draft,
    });
    expect(inspected.discovery!.sketch!.entities).toEqual(
      restored.discovery!.sketch!.entities,
    );
    expect(inspected.discovery!.history).toEqual(restored.discovery!.history);
  } finally {
    await f.close();
  }
}, 60000);

it("refuses stale, foreign, unsupported and no-crossing edits without authoring an action", async () => {
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
      primitive: { kind: "line", start: [0, 5], end: [10, 5] },
      construction: true,
      intent: "fulfill",
    });
    const cutter = boundary
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const stale = await f.run({
      operation: "sketch.geometry.update",
      draft: line.discovery!.state.draft,
      edit: { kind: "split", target, boundary: cutter, pick: [4, 0] },
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    for (const edit of [
      { kind: "split", target, boundary: cutter, pick: [4, 0] },
      { kind: "extend", target, boundary: cutter },
      { kind: "trim", target },
      {
        kind: "split",
        target,
        boundary: { ...cutter, sketchId: "sketch_foreign" },
        pick: [4, 0],
      },
    ]) {
      const refused = await f.run({
        operation: "sketch.geometry.update",
        draft: f.current().completion.live.state!.draft,
        edit,
        intent: "fulfill",
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
      const inspected = await f.execute({
        operation: "sketch.inspect",
        draft: refused.completion.live.state!.draft,
      });
      expect(inspected.discovery!.sketch!.entities).toEqual(
        boundary.discovery!.sketch!.entities,
      );
      expect(inspected.discovery!.sketch!.points).toEqual(
        boundary.discovery!.sketch!.points,
      );
      expect(inspected.discovery!.history).toEqual(boundary.discovery!.history);
    }
    const circle = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [30, 0], radius: 3 },
      construction: false,
      intent: "fulfill",
    });
    const circleTarget = circle
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const refused = await f.run({
      operation: "sketch.geometry.update",
      draft: circle.discovery!.state.draft,
      edit: { kind: "extend", target: circleTarget, boundary: cutter },
      intent: "fulfill",
    });
    expect(refused.outcome).toEqual({
      kind: "rejected",
      reasonCode: "sketch-edit-refused",
    });
    expect(refused.diagnostics.some((d) => d.message.includes("line"))).toBe(
      true,
    );
    const inspected = await f.execute({
      operation: "sketch.inspect",
      draft: refused.completion.live.state!.draft,
    });
    expect(inspected.discovery!.history).toEqual(circle.discovery!.history);
  } finally {
    await f.close();
  }
}, 60000);
