import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("refuses degenerate advanced inputs even for author-invalid without changing the private draft", async () => {
  const f = await createSketchWorkflow();
  try {
    const before = f.current().discovery!;
    const primitives = [
      {
        kind: "ellipse",
        points: [
          [0, 0],
          [5, 0],
          [3, 0],
        ],
      },
      {
        kind: "ellipticalArc",
        points: [
          [0, 0],
          [5, 0],
          [0, 3],
          [5, 0],
          [5, 0],
        ],
      },
      {
        kind: "conic",
        points: [
          [0, 0],
          [0, 0],
          [4, 0],
        ],
      },
      {
        kind: "bezierCurve",
        controlPoints: [
          [0, 0],
          [1, 2],
          [1, 2],
          [4, 0],
        ],
      },
      {
        kind: "controlPointSpline",
        controlPoints: [
          [0, 0],
          [1, 2],
          [1, 2],
          [4, 0],
        ],
      },
      { kind: "spline", fitPoints: [] },
      { kind: "spline", fitPoints: [[0, 0]] },
      {
        kind: "spline",
        fitPoints: [
          [0, 0],
          [0, 0],
          [4, 0],
        ],
      },
      {
        kind: "profileText",
        anchor: [0, 0],
        heightPoint: [3, 0],
        text: "  ",
        horizontalAlign: "left",
        verticalAlign: "baseline",
      },
      {
        kind: "profileText",
        anchor: [0, 0],
        heightPoint: [0, 0],
        text: "A",
        horizontalAlign: "left",
        verticalAlign: "baseline",
      },
    ];
    for (const primitive of primitives)
      for (const intent of ["fulfill", "author-invalid"]) {
        const refused = await f.run({
          operation: "sketch.author",
          draft: before.state.draft,
          primitive,
          construction: false,
          intent,
        });
        expect(refused.outcome, JSON.stringify(refused)).toEqual({
          kind: "rejected",
          reasonCode: "invalid-primitive",
        });
        expect(refused.completion.live.kind).toBe("unchanged");
        expect(refused.diagnostics.length).toBeGreaterThan(0);
        const inspected = await f.execute({
          operation: "sketch.inspect",
          draft: before.state.draft,
        });
        expect(inspected.discovery!.sketch!.entities).toEqual([]);
        expect(inspected.discovery!.sketch!.points).toEqual([]);
        expect(inspected.discovery!.state.draft).toEqual(before.state.draft);
      }
  } finally {
    await f.close();
  }
}, 30000);

it("refuses unsupported short-spline closure and foreign destination references without application", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [0, 0],
          [4, 3],
          [8, 0],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const source = created.discovery!.references.find(
      (r) => r.label === "Spline 1 point 3",
    )!.target;
    const destination = created.discovery!.references.find(
      (r) => r.label === "Spline 1 point 1",
    )!.target;
    if (destination.kind !== "sketchPoint")
      throw new Error("Missing destination");
    const refused = await f.run({
      operation: "sketch.geometry.update",
      draft: created.discovery!.state.draft,
      edit: { kind: "mergePoints", target: source, destination },
      intent: "fulfill",
    });
    expect(refused.outcome.kind).toBe("rejected");
    expect(refused.completion.live.kind).toBe("unchanged");
    expect(
      refused.diagnostics.some((d) =>
        d.message.includes("at least 4 fit points"),
      ),
    ).toBe(true);
    const foreign = await f.run({
      operation: "sketch.geometry.update",
      draft: created.discovery!.state.draft,
      edit: {
        kind: "mergePoints",
        target: source,
        destination: { ...destination, sketchId: "sketch_foreign" },
      },
      intent: "fulfill",
    });
    expect(foreign.outcome).toEqual({
      kind: "rejected",
      reasonCode: "sketch-target-unavailable",
    });
    const inspected = await f.execute({
      operation: "sketch.inspect",
      draft: created.discovery!.state.draft,
    });
    expect(inspected.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [4, 3],
      [8, 0],
    ]);
    expect(inspected.discovery!.state.draft).toEqual(
      created.discovery!.state.draft,
    );
  } finally {
    await f.close();
  }
}, 30000);
