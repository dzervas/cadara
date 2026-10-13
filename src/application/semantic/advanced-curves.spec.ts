import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("creates an ellipse using production preparation and reports current native geometry", async () => {
  const f = await createSketchWorkflow();
  try {
    const result = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "ellipse",
        points: [
          [10, 20],
          [15, 20],
          [10, 23],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    expect(result.discovery!.sketch!.entities).toMatchObject([
      { kind: "ellipse", minorRadius: 3 },
    ]);
    expect(result.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [10, 20],
      [15, 20],
    ]);
    expect(result.completion.geometry.kind).toBe("current");
    expect(result.discovery!.sketch!.profiles).toEqual([]);
    expect(
      result.diagnostics.some((d) => d.code === "region-unsupported-curve"),
    ).toBe(true);
    const major = result.discovery!.references.find(
      (r) => r.label === "Ellipse 1 major",
    )!.target;
    const edited = await f.execute({
      operation: "sketch.geometry.update",
      draft: f.current().discovery!.state.draft,
      edit: { kind: "point", target: major, position: [17, 20] },
      intent: "fulfill",
    });
    expect(edited.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [10, 20],
      [17, 20],
    ]);
    expect(edited.discovery!.sketch!.entities[0]!.entityId).toBe(
      result.discovery!.sketch!.entities[0]!.entityId,
    );
    const refused = await f.run({
      operation: "sketch.publish",
      draft: f.current().discovery!.state.draft,
      requireProfiles: true,
    });
    expect(refused.outcome).toEqual({
      kind: "rejected",
      reasonCode: "profiles-unusable",
    });
    expect(refused.completion.live.kind).toBe("unchanged");
    const published = await f.execute({
      operation: "sketch.publish",
      draft: edited.discovery!.state.draft,
      requireProfiles: false,
    });
    const reopened = await f.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(reopened.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [10, 20],
      [17, 20],
    ]);
    expect(reopened.discovery!.sketch!.profiles).toEqual([]);
  } finally {
    await f.close();
  }
}, 30000);

it("creates and edits an ordinary spline through fit points, with distinct tangent handles", async () => {
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
    const sketch = created.discovery!.sketch!;
    expect(sketch.points.map((p) => p.position)).toEqual([
      [0, 0],
      [4, 3],
      [8, 0],
    ]);
    expect(sketch.entities).toMatchObject([
      {
        kind: "spline",
        tangents: [{ vector: null }, { vector: null }, { vector: null }],
      },
    ]);
    expect(sketch.profiles).toEqual([]);
    const fit = created.discovery!.references.find(
      (r) => r.label === "Spline 1 point 2",
    )!.target;
    const moved = await f.execute({
      operation: "sketch.geometry.update",
      draft: f.current().discovery!.state.draft,
      edit: { kind: "point", target: fit, position: [4, 5] },
      intent: "fulfill",
    });
    expect(moved.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [4, 5],
      [8, 0],
    ]);
    const entity = moved.discovery!.sketch!.entities[0]!;
    const occurrence = entity.tangents![1]!;
    const entityRef = moved.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === entity.entityId,
    )!.target;
    if (entityRef.kind !== "sketchEntity")
      throw new Error("Missing spline target");
    const tangent = await f.execute({
      operation: "sketch.geometry.update",
      draft: f.current().discovery!.state.draft,
      edit: {
        kind: "tangent",
        target: {
          kind: "sketchTangentHandle",
          sketchId: entityRef.sketchId,
          entityId: entity.entityId,
          occurrenceId: occurrence.occurrenceId,
          pointId: occurrence.pointId,
        },
        vector: [2, 0],
      },
      intent: "fulfill",
    });
    expect(
      tangent.discovery!.sketch!.entities[0]!.tangents![1]!.vector,
    ).toEqual([2, 0]);
    expect(tangent.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [4, 5],
      [8, 0],
    ]);
  } finally {
    await f.close();
  }
}, 30000);
