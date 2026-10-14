import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("a declared tangent line and arc chain offsets with one shared join identity", async () => {
  const w = await createSketchWorkflow();
  try {
    const line = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [-5, 0], end: [0, 0] },
      construction: false,
      intent: "fulfill",
    });
    const lineEntity = line.discovery!.sketch!.entities[0]!;
    const arc = await w.execute({
      operation: "sketch.author",
      draft: line.discovery!.state.draft,
      primitive: {
        kind: "centerPointArc",
        center: [0, 5],
        start: [0, 0],
        end: [5, 5],
      },
      construction: false,
      intent: "fulfill",
    });
    const arcEntity = arc.discovery!.sketch!.entities[1]!;
    const refs = arc.discovery!.references;
    const shared = await w.execute({
      operation: "sketch.geometry.update",
      draft: arc.discovery!.state.draft,
      edit: {
        kind: "mergePoints",
        target: refs.find(
          (r) =>
            r.target.kind === "sketchPoint" &&
            r.target.pointId === arcEntity.pointIds[0],
        )!.target,
        destination: refs.find(
          (r) =>
            r.target.kind === "sketchPoint" &&
            r.target.pointId === lineEntity.pointIds[1],
        )!.target,
      },
      intent: "fulfill",
    });
    const targets = shared
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    const offset = await w.execute({
      operation: "sketch.offset.create",
      draft: shared.discovery!.state.draft,
      targets,
      distance: 1,
      side: "left",
      intent: "fulfill",
    });
    const geometry = offset.discovery!.sketch!.offsets[0]!.currentGeometry!;
    expect(geometry).toHaveLength(2);
    const straight = geometry.find((e) => e.kind === "lineSegment")!;
    const curved = geometry.find((e) => e.kind === "arc")!;
    expect(straight.points.map((p) => p.position)).toEqual([
      [-5, 1],
      [0, 1],
    ]);
    expect(curved.points.map((p) => p.position)).toEqual([
      [0, 1],
      [4, 5],
      [0, 5],
    ]);
    expect(curved.radius).toBe(4);
    expect(straight.points[1]!.pointId).toBe(curved.points[0]!.pointId);
    expect(offset.discovery!.sketch!.offsets[0]!.health.kind).toBe("healthy");
    expect(offset.discovery!.sketch!.profiles).toHaveLength(0);
  } finally {
    await w.close();
  }
}, 120_000);
