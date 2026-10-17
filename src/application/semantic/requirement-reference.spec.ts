import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("changes a driving requirement to a non-driving measurement and restores it through the shared numeric edit", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const target = created.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const added = await f.execute({
      operation: "sketch.requirement.add",
      draft: created.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [target],
      mode: "driving",
      value: 8,
      intent: "fulfill",
    });
    const dimensionId = added.discovery!.sketch!.requirements[0]!.dimensionId;
    const reference = await f.execute({
      operation: "sketch.dimension.reference",
      draft: added.discovery!.state.draft,
      dimensionId,
      intent: "fulfill",
    });
    expect(reference.discovery!.sketch!.requirements).toEqual([]);
    expect(reference.discovery!.sketch!.measurements).toMatchObject([
      { dimensionId, kind: "circleRadius", measuredValue: 8 },
    ]);
    const unsupported = await f.run({
      operation: "sketch.requirement.add",
      draft: reference.discovery!.state.draft,
      tool: "constraintFix",
      targets: [target],
      mode: "reference",
      value: null,
      intent: "fulfill",
    });
    expect(unsupported.outcome.kind).toBe("rejected");
    const unchanged = await f.execute({
      operation: "sketch.dimension.reference",
      draft: reference.discovery!.state.draft,
      dimensionId,
      intent: "fulfill",
    });
    expect(unchanged.outcome).toEqual({
      kind: "completed",
      change: "unchanged",
    });
    expect(unchanged.discovery!.history).toEqual(reference.discovery!.history);
    expect(unchanged.discovery!.sketch).toEqual(reference.discovery!.sketch);
    const moved = await f.execute({
      operation: "sketch.geometry.update",
      draft: reference.discovery!.state.draft,
      edit: { kind: "radius", target, radius: 12 },
      intent: "fulfill",
    });
    expect(moved.discovery!.sketch!.measurements[0]!.measuredValue).toBeCloseTo(
      12,
      6,
    );
    const restored = await f.execute({
      operation: "sketch.dimension.update",
      draft: moved.discovery!.state.draft,
      dimensionId,
      value: 10,
      intent: "fulfill",
    });
    expect(restored.discovery!.sketch!.measurements).toEqual([]);
    expect(restored.discovery!.sketch!.requirements[0]).toMatchObject({
      dimensionId,
      value: 10,
      measuredValue: 10,
    });
    expect(restored.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(10, 6);
  } finally {
    await f.close();
  }
}, 60000);

it("refuses conversion of structural arc endpoint bindings to reference measurements", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
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
    const dimensionId = created.discovery!.sketch!.requirements.find(
      (r) => r.kind === "arcStartPointCoincident",
    )!.dimensionId;
    const refused = await f.run({
      operation: "sketch.dimension.reference",
      draft: created.discovery!.state.draft,
      dimensionId,
      intent: "author-invalid",
    });
    expect(refused.outcome.kind).toBe("rejected");
    expect(refused.completion.live.kind).toBe("unchanged");
    expect(
      refused.diagnostics.some((d) =>
        d.message.includes("reference measurement"),
      ),
    ).toBe(true);
    const inspected = await f.execute({
      operation: "sketch.inspect",
      draft: created.discovery!.state.draft,
    });
    expect(inspected.discovery!.sketch).toEqual(created.discovery!.sketch);
  } finally {
    await f.close();
  }
}, 60000);
