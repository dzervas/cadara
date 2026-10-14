import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("closed line offsets retain their canonical chain, joined identities and current inner profile", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 10] },
      construction: false,
      intent: "fulfill",
    });
    const targets = source
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    const result = await w.execute({
      operation: "sketch.offset.create",
      draft: source.discovery!.state.draft,
      targets: [targets[2], targets[0], targets[3], targets[1]],
      distance: 1,
      side: "left",
      intent: "fulfill",
    });
    const offset = result.discovery!.sketch!.offsets[0]!;
    expect(new Set(offset.seedEntityIds)).toEqual(
      new Set(source.discovery!.sketch!.entities.map((e) => e.entityId)),
    );
    expect(offset.currentGeometry).toHaveLength(4);
    const points = offset.currentGeometry!.flatMap((e) => e.points);
    expect(new Set(points.map((p) => p.pointId)).size).toBe(4);
    expect(
      [...new Set(points.map((p) => JSON.stringify(p.position)))].sort(),
    ).toEqual(["[1,1]", "[1,9]", "[9,1]", "[9,9]"]);
    expect(result.discovery!.sketch!.profiles).toHaveLength(2);
    const published = await w.execute({
      operation: "sketch.publish",
      draft: result.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(published.outcome.kind).toBe("completed");
    const sketch = published.discovery!.references.find(
      (r) => r.target.kind === "sketch",
    )!.target;
    if (sketch.kind !== "sketch") throw new Error("Expected published sketch.");
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: sketch.sketchId,
    });
    expect(reopened.discovery!.sketch!.offsets[0]!.derivationId).toBe(
      offset.derivationId,
    );
    expect(
      reopened.discovery!.sketch!.offsets[0]!.currentGeometry,
    ).toHaveLength(4);
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(2);
  } finally {
    await w.close();
  }
}, 120_000);

test("open line and curved arc offsets expose certified geometry rather than authored placeholders", async () => {
  for (const primitive of [
    { kind: "line", start: [0, 0], end: [10, 0] },
    { kind: "centerPointArc", center: [0, 0], start: [5, 0], end: [0, 5] },
  ]) {
    const w = await createSketchWorkflow();
    try {
      const source = await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive,
        construction: false,
        intent: "fulfill",
      });
      const target = source.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      const result = await w.execute({
        operation: "sketch.offset.create",
        draft: source.discovery!.state.draft,
        targets: [target],
        distance: 1,
        side: "right",
        intent: "fulfill",
      });
      const geometry =
        result.discovery!.sketch!.offsets[0]!.currentGeometry![0]!;
      if (primitive.kind === "line")
        expect(geometry.points.map((p) => p.position)).toEqual([
          [0, -1],
          [10, -1],
        ]);
      else {
        expect(geometry.radius).toBeCloseTo(6, 8);
        expect(geometry.points.map((p) => p.position)).toEqual([
          [6, 0],
          [0, 6],
          [0, 0],
        ]);
      }
      expect(result.discovery!.sketch!.profiles).toHaveLength(0);
      expect(result.discovery!.sketch!.offsets[0]!.health.kind).toBe("healthy");
    } finally {
      await w.close();
    }
  }
}, 120_000);
