import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("projects real solid vertices and edges along the normal while face boundaries require coplanarity", async () => {
  const w = await createSketchWorkflow();
  try {
    const rectangle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [10, 8] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: rectangle.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const solid = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 6,
      intent: "fulfill",
    });
    const targets = solid.discovery!.references.filter((r) =>
      ["vertex", "edge", "face"].includes(r.target.kind),
    );
    const counts = { vertex: [0, 0], edge: [0, 0], face: [0, 0] };
    const points: number[][] = [];
    const edgeLengths: number[] = [];
    for (const { target } of targets) {
      if (
        target.kind !== "vertex" &&
        target.kind !== "edge" &&
        target.kind !== "face"
      )
        throw new Error("Unexpected topology target");
      const opened = await w.execute({
        operation: "sketch.begin",
        plane: "xy",
      });
      const result = await w.run({
        operation: "sketch.reference.add",
        draft: opened.discovery!.state.draft,
        target,
        intent: "fulfill",
      });
      const reference = result.discovery!.sketch!.references![0]!;
      const projection = reference.projection!;
      expect(reference.revisionId).toBe(result.discovery!.state.revisionId);
      if (projection.status === "projected") {
        counts[target.kind][0]!++;
        expect(result.outcome.kind).toBe("completed");
        if (target.kind === "vertex") {
          expect(projection.geometry).toHaveLength(1);
          const point = projection.geometry[0]!;
          expect(point.kind).toBe("point");
          if (point.kind === "point") points.push([...point.position]);
        } else {
          expect(projection.geometry).toHaveLength(
            target.kind === "edge" ? 1 : 4,
          );
          for (const line of projection.geometry) {
            expect(line.kind).toBe("lineSegment");
            if (line.kind === "lineSegment") {
              const length = Math.hypot(
                line.endPosition[0] - line.startPosition[0],
                line.endPosition[1] - line.startPosition[1],
              );
              expect([8, 10]).toContain(length);
              if (target.kind === "edge") edgeLengths.push(length);
            }
          }
        }
      } else {
        counts[target.kind][1]!++;
        expect(projection.status, JSON.stringify({ target, projection })).toBe(
          target.kind === "edge" ? "unsupportedSource" : "outOfPlane",
        );
        expect(projection.geometry).toHaveLength(0);
        expect(result.outcome.kind).toBe("failed");
        expect(result.completion.geometry.kind).not.toBe("current");
      }
      expect(result.discovery!.sketch!.entities).toHaveLength(0);
      await w.execute({
        operation: "sketch.discard",
        draft: result.discovery!.state.draft,
      });
    }
    expect(counts).toEqual({ vertex: [8, 0], edge: [8, 4], face: [1, 5] });
    expect(points).toEqual(
      expect.arrayContaining([
        [0, 0],
        [10, 0],
        [0, 8],
        [10, 8],
      ]),
    );
    expect(edgeLengths.sort((a, b) => a - b)).toEqual([
      8, 8, 8, 8, 10, 10, 10, 10,
    ]);
  } finally {
    await w.close();
  }
}, 180_000);
