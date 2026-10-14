import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("uses real planar solid faces as support without replacing the native frame", async () => {
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
    expect(solid.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [0, 0, 0],
      max: [10, 8, 6],
    });
    const faces = solid.discovery!.references.filter(
      (r) => r.target.kind === "face",
    );
    expect(faces).toHaveLength(6);
    const normalDirections: number[][] = [];
    for (const face of faces) {
      const opened = await w.execute({
        operation: "sketch.begin",
        support: face.target,
      });
      const support = opened.discovery!.sketch!.support!;
      expect(support.support).toEqual(face.target);
      expect(support.key).toBeNull();
      expect(opened.discovery!.sketch!.plane).toBeNull();
      expect(support.frame.linearUnit).toBe("documentLength");
      expect(support.frame.handedness).toBe("rightHanded");
      const { origin, normal, xAxis, yAxis } = support.frame;
      for (const axis of [normal, xAxis, yAxis])
        expect(Math.hypot(...axis)).toBeCloseTo(1, 8);
      expect(
        xAxis[0] * yAxis[0] + xAxis[1] * yAxis[1] + xAxis[2] * yAxis[2],
      ).toBeCloseTo(0, 8);
      const dim = normal.findIndex((value) => Math.abs(value) > 0.9);
      expect(dim).not.toBe(-1);
      expect(origin[dim]).toBeCloseTo(
        normal[dim]! > 0 ? [10, 8, 6][dim]! : 0,
        8,
      );
      normalDirections.push(normal.map((n) => Math.round(n) || 0));
      const circle = await w.execute({
        operation: "sketch.author",
        draft: opened.discovery!.state.draft,
        primitive: { kind: "circle", center: [2, 2], radius: 1 },
        construction: false,
        intent: "fulfill",
      });
      expect(circle.discovery!.sketch!.profiles).toHaveLength(1);
      await w.execute({
        operation: "sketch.discard",
        draft: circle.discovery!.state.draft,
      });
    }
    expect(normalDirections).toEqual(
      expect.arrayContaining([
        [1, 0, 0],
        [-1, 0, 0],
        [0, 1, 0],
        [0, -1, 0],
        [0, 0, 1],
        [0, 0, -1],
      ]),
    );
    const refused = await w.run({
      operation: "sketch.begin",
      support: { kind: "construction", constructionId: "construction_missing" },
    });
    expect(refused.outcome).toEqual({
      kind: "rejected",
      reasonCode: "sketch-support-unavailable",
    });
    expect(refused.completion.live.kind).toBe("unchanged");
  } finally {
    await w.close();
  }
}, 180_000);

test("refuses a cylindrical face and a missing face without replacing support rules", async () => {
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
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
    const faces = solid.discovery!.references.filter(
      (r) => r.target.kind === "face",
    );
    expect(faces).toHaveLength(3);
    let accepted = 0;
    let refused = 0;
    for (const face of faces) {
      const result = await w.run({
        operation: "sketch.begin",
        support: face.target,
      });
      if (result.outcome.kind === "completed") {
        accepted++;
        expect(result.discovery!.sketch!.support!.support).toEqual(face.target);
        await w.execute({
          operation: "sketch.discard",
          draft: result.discovery!.state.draft,
        });
      } else {
        refused++;
        expect(result.outcome).toEqual({
          kind: "rejected",
          reasonCode: "sketch-support-unavailable",
        });
        expect(result.completion.live.kind).toBe("unchanged");
      }
    }
    expect(accepted).toBe(2);
    expect(refused).toBe(1);
    const missing = await w.run({
      operation: "sketch.begin",
      support: {
        kind: "face",
        bodyId: solid.discovery!.model!.bodies[0]!.bodyId,
        faceId: "face_absent",
      },
    });
    expect(missing.outcome).toEqual({
      kind: "rejected",
      reasonCode: "sketch-support-unavailable",
    });
    expect(missing.completion.live.kind).toBe("unchanged");
  } finally {
    await w.close();
  }
}, 180_000);
