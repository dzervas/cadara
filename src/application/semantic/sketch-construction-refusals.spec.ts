import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("refuses infeasible corners, unsupported slot seeds and stale or foreign selections without an action", async () => {
  const f = await createSketchWorkflow();
  try {
    const rectangle = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 10] },
      construction: false,
      intent: "fulfill",
    });
    const lines = rectangle
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    const circle = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [30, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const round = circle
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const spline = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [30, 10],
          [35, 12],
          [40, 10],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const curve = spline
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const before = f.current();
    const cases = [
      { kind: "fillet", radius: 0, targets: lines.slice(0, 2) },
      { kind: "fillet", radius: -1, targets: lines.slice(0, 2) },
      { kind: "fillet", radius: 10, targets: lines.slice(0, 2) },
      { kind: "chamfer", distance: 0, targets: lines.slice(0, 2) },
      { kind: "chamfer", distance: 10, targets: lines.slice(0, 2) },
      { kind: "chamfer", distance: 1, targets: [lines[0], lines[2]] },
      { kind: "fillet", radius: 1, targets: [lines[0]] },
      { kind: "fillet", radius: 1, targets: [lines[0], lines[0]] },
      { kind: "fillet", radius: 1, targets: [lines[0], round] },
      { kind: "slot", width: 0, targets: [lines[0]] },
      { kind: "slot", width: -1, targets: [lines[0]] },
      { kind: "slot", width: 2, targets: [round] },
      { kind: "slot", width: 2, targets: [curve] },
      { kind: "slot", width: 2, targets: lines.slice(0, 2) },
      { kind: "slot", width: 2, targets: [] },
      {
        kind: "fillet",
        radius: 1,
        targets: [{ ...lines[0], sketchId: "sketch_foreign" }, lines[1]],
      },
    ];
    for (const input of cases) {
      const refused = await f.run({
        operation: "sketch.geometry.build",
        ...input,
        draft: before.discovery!.state.draft,
        intent: "fulfill",
      });
      expect(refused.outcome.kind, JSON.stringify(input)).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
      const inspected = await f.execute({
        operation: "sketch.inspect",
        draft: before.discovery!.state.draft,
      });
      expect(inspected.discovery!.sketch).toEqual(before.discovery!.sketch);
      expect(inspected.discovery!.history).toEqual(before.discovery!.history);
    }
    const stale = await f.run({
      operation: "sketch.geometry.build",
      kind: "fillet",
      radius: 1,
      targets: lines.slice(0, 2),
      draft: rectangle.discovery!.state.draft,
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    expect(stale.completion.live.kind).toBe("unchanged");
  } finally {
    await f.close();
  }
}, 60000);

it("refuses a collinear corner and an arc slot whose inner radius would vanish", async () => {
  const f = await createSketchWorkflow();
  try {
    const targets = [];
    for (const [start, end] of [
      [
        [0, 0],
        [10, 0],
      ],
      [
        [10, 0],
        [20, 0],
      ],
    ]) {
      const authored = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "line", start, end },
        construction: false,
        intent: "fulfill",
      });
      targets.push(
        authored
          .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
          .at(-1)!.target,
      );
    }
    const arc = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "centerPointArc",
        center: [30, 0],
        start: [35, 0],
        end: [30, 5],
      },
      construction: false,
      intent: "fulfill",
    });
    const before = f.current();
    for (const input of [
      { kind: "fillet", targets, radius: 1 },
      { kind: "chamfer", targets, distance: 1 },
      {
        kind: "slot",
        targets: [
          arc
            .discovery!.references.filter(
              (r) => r.target.kind === "sketchEntity",
            )
            .at(-1)!.target,
        ],
        width: 10,
      },
    ]) {
      const refused = await f.run({
        operation: "sketch.geometry.build",
        ...input,
        draft: before.discovery!.state.draft,
        intent: "fulfill",
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.diagnostics[0]!.message).toMatch(
        /non-collinear|invalid arc slot/,
      );
      const inspected = await f.execute({
        operation: "sketch.inspect",
        draft: before.discovery!.state.draft,
      });
      expect(inspected.discovery!.sketch).toEqual(before.discovery!.sketch);
      expect(inspected.discovery!.history).toEqual(before.discovery!.history);
    }
  } finally {
    await f.close();
  }
}, 60000);
