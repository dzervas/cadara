import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("mirroring a closed line chain preserves shared corner identities, requirements and native profiles through publication", async () => {
  const w = await createSketchWorkflow();
  try {
    const rectangle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [2, 2], end: [6, 5] },
      construction: false,
      intent: "fulfill",
    });
    const targets = rectangle
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .map((r) => r.target);
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: rectangle.discovery!.state.draft,
      targets: [targets[2], targets[0], targets[3], targets[1]],
      axis: rectangle.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch Y axis",
      )!.target,
      intent: "fulfill",
    });
    const mirror = mirrored.discovery!.sketch!.mirrors[0]!;
    const corners = mirror.currentGeometry!.flatMap((e) => e.points);
    expect(new Set(corners.map((p) => p.pointId)).size).toBe(4);
    expect(
      [...new Set(corners.map((p) => JSON.stringify(p.position)))].sort(),
    ).toEqual(
      [
        [-2, 2],
        [-2, 5],
        [-6, 2],
        [-6, 5],
      ]
        .map((p) => JSON.stringify(p))
        .sort(),
    );
    expect(
      mirrored.discovery!.sketch!.constraints.map((c) => c.constraintId),
    ).toEqual(
      rectangle.discovery!.sketch!.constraints.map((c) => c.constraintId),
    );
    expect(mirrored.discovery!.sketch!.profiles).toHaveLength(2);
    const published = await w.execute({
      operation: "sketch.publish",
      draft: mirrored.discovery!.state.draft,
      requireProfiles: true,
    });
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(reopened.discovery!.sketch!.mirrors[0]!.derivationId).toBe(
      mirror.derivationId,
    );
    expect(reopened.discovery!.sketch!.mirrors[0]!.outputEntityIds).toEqual(
      mirror.outputEntityIds,
    );
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(2);
  } finally {
    await w.close();
  }
}, 120_000);

test("ordinary spline mirror reflects fit points and authored tangent vectors, output tangent edits are reciprocal", async () => {
  const w = await createSketchWorkflow();
  try {
    const spline = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [2, 2],
          [4, 5],
          [8, 2],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const seed = spline.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const entity = spline.discovery!.sketch!.entities[0]!;
    const first = entity.tangents![0]!;
    const authored = await w.execute({
      operation: "sketch.geometry.update",
      draft: spline.discovery!.state.draft,
      edit: {
        kind: "tangent",
        target: {
          kind: "sketchTangentHandle",
          sketchId: "sketchId" in seed ? seed.sketchId : null,
          entityId: entity.entityId,
          occurrenceId: first.occurrenceId,
          pointId: first.pointId,
        },
        vector: [5, 3],
      },
      intent: "fulfill",
    });
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: authored.discovery!.state.draft,
      targets: [seed],
      axis: authored.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch Y axis",
      )!.target,
      intent: "fulfill",
    });
    const copyId = mirrored.discovery!.sketch!.mirrors[0]!.outputEntityIds[0]!;
    expect(
      mirrored.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points.map(
        (p) => p.position,
      ),
    ).toEqual([
      [-2, 2],
      [-4, 5],
      [-8, 2],
    ]);
    const copy = mirrored.discovery!.sketch!.entities.find(
      (e) => e.entityId === copyId,
    )!;
    const copiedFirst = copy.tangents![0]!;
    expect(copiedFirst.vector).toEqual([-5, 3]);
    const edited = await w.execute({
      operation: "sketch.geometry.update",
      draft: mirrored.discovery!.state.draft,
      edit: {
        kind: "tangent",
        target: {
          kind: "sketchTangentHandle",
          sketchId: "sketchId" in seed ? seed.sketchId : null,
          entityId: copyId,
          occurrenceId: copiedFirst.occurrenceId,
          pointId: copiedFirst.pointId,
        },
        vector: [-6, 4],
      },
      intent: "fulfill",
    });
    expect(
      edited.discovery!.sketch!.entities[0]!.tangents![0]!.vector![0],
    ).toBeCloseTo(6, 3);
    expect(
      edited.discovery!.sketch!.entities[0]!.tangents![0]!.vector![1],
    ).toBeCloseTo(4, 3);
    expect(
      edited.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points.map(
        (p) => p.position,
      ),
    ).toEqual([
      [-2, 2],
      [-4, 5],
      [-8, 2],
    ]);
    expect(edited.discovery!.sketch!.profiles).toHaveLength(0);
  } finally {
    await w.close();
  }
}, 120_000);

test("point and bound-arc mirrors expose real reflected geometry without inventing closed profiles", async () => {
  for (const primitive of [
    { kind: "point", position: [4, 3] },
    { kind: "centerPointArc", center: [4, 3], start: [6, 3], end: [4, 5] },
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
      const seed = source.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      const mirrored = await w.execute({
        operation: "sketch.mirror.create",
        draft: source.discovery!.state.draft,
        targets: [seed],
        axis: source.discovery!.sketch!.operands.find(
          (r) => r.label === "Sketch Y axis",
        )!.target,
        intent: "fulfill",
      });
      const output =
        mirrored.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!;
      expect(output.kind).toBe(primitive.kind === "point" ? "point" : "arc");
      expect(output.points.map((p) => p.position)).toEqual(
        primitive.kind === "point"
          ? [[-4, 3]]
          : [
              [-6, 3],
              [-4, 5],
              [-4, 3],
            ],
      );
      if (primitive.kind !== "point") {
        expect(output.radius).toBe(2);
        expect(mirrored.discovery!.sketch!.entities[1]!.sweepDirection).toBe(
          "clockwise",
        );
      }
      expect(mirrored.discovery!.sketch!.profiles).toHaveLength(0);
      const refused = await w.run({
        operation: "sketch.publish",
        draft: mirrored.discovery!.state.draft,
        requireProfiles: true,
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
    } finally {
      await w.close();
    }
  }
}, 120_000);
