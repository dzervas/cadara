import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("an ordinary curved spline offsets through native certification with driven terminal identities", async () => {
  const w = await createSketchWorkflow();
  try {
    let source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [0, 0],
          [5, 3],
          [10, 0],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const seed = source.discovery!.sketch!.entities[0]!;
    const sketchId = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    if (!("sketchId" in sketchId))
      throw new Error("Expected owned sketch entity.");
    for (const tangent of [seed.tangents![0]!, seed.tangents!.at(-1)!]) {
      source = await w.execute({
        operation: "sketch.geometry.update",
        draft: source.discovery!.state.draft,
        edit: {
          kind: "tangent",
          target: {
            kind: "sketchTangentHandle",
            sketchId: sketchId.sketchId,
            entityId: seed.entityId,
            occurrenceId: tangent.occurrenceId,
            pointId: tangent.pointId,
          },
          vector: [5, 0],
        },
        intent: "fulfill",
      });
    }
    const result = await w.execute({
      operation: "sketch.offset.create",
      draft: source.discovery!.state.draft,
      targets: [sketchId],
      distance: 1,
      side: "left",
      intent: "fulfill",
    });
    const offset = result.discovery!.sketch!.offsets[0]!;
    expect(offset.health.kind).toBe("healthy");
    expect(offset.currentGeometry).toHaveLength(1);
    expect(offset.currentGeometry![0]!.kind).toBe("derivedPiecewiseCubic");
    const spans = offset.currentGeometry![0]!.cubicSpans!;
    expect(spans.length).toBeGreaterThan(0);
    // The symmetric source passes through [5,3] with a horizontal tangent;
    // its left unit normal puts the offset's corresponding join at [5,4].
    expect(
      spans.some((span) =>
        [span.poles[0], span.poles[3]].some(
          ([x, y]) => Math.abs(x - 5) < 1e-7 && Math.abs(y - 4) < 1e-7,
        ),
      ),
    ).toBe(true);
    const ends = offset.currentGeometry![0]!.points;
    expect(ends).toHaveLength(2);
    expect(ends[0]!.position[0]).toBeCloseTo(0, 8);
    expect(ends[0]!.position[1]).toBeCloseTo(1, 8);
    expect(ends[1]!.position[0]).toBeCloseTo(10, 8);
    expect(ends[1]!.position[1]).toBeCloseTo(1, 8);
    expect(result.discovery!.sketch!.profiles).toHaveLength(0);
    const target = result.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === offset.outputEntityIds[0],
    )!.target;
    const refused = await w.run({
      operation: "sketch.offset.create",
      draft: result.discovery!.state.draft,
      targets: [target],
      distance: 1,
      side: "left",
      intent: "fulfill",
    });
    expect(refused.outcome.kind).toBe("rejected");
    expect(refused.diagnostics[0]!.message).toContain("cannot be offset again");
  } finally {
    await w.close();
  }
}, 180_000);
