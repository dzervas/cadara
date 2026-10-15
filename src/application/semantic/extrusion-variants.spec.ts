import { expect, test } from "vitest";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("canonical extrusion parameters preserve symmetric geometry, explicit starts and two-sided updates", async () => {
  const w = await createSketchWorkflow();
  try {
    const rectangle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: rectangle.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const profiles = [
      {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      },
    ];
    const created = await w.execute({
      operation: "extrude.create",
      intent: "fulfill",
      parameters: {
        resultBodyType: "solid",
        profiles,
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "symmetric",
          end: { kind: "blind", direction: "positive", distance: literal(4) },
        },
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
    });
    const body = created.discovery!.model!.bodies[0]!;
    expect(body.kind).toBe("solid");
    expect(body.bounds!.min).toEqual([0, 0, -4]);
    expect(body.bounds!.max).toEqual([20, 10, 4]);
    const updated = await w.execute({
      operation: "extrude.update",
      featureId: created.discovery!.model!.features[0]!.featureId,
      intent: "fulfill",
      parameters: {
        resultBodyType: "solid",
        profiles,
        startExtent: {
          kind: "blindOffset",
          distance: literal(3),
          direction: "positive",
        },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: literal(7) },
        },
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
    });
    expect(updated.discovery!.model!.bodies[0]!.bounds!.min).toEqual([0, 0, 3]);
    expect(updated.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      20, 10, 10,
    ]);
    const depthEdited = await w.execute({
      operation: "extrude.update",
      featureId: updated.discovery!.model!.features[0]!.featureId,
      depth: 9,
      intent: "fulfill",
    });
    expect(depthEdited.discovery!.model!.bodies[0]!.bounds!.min).toEqual([
      0, 0, 3,
    ]);
    expect(depthEdited.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      20, 10, 12,
    ]);
    const twoSided = await w.execute({
      operation: "extrude.update",
      featureId: updated.discovery!.model!.features[0]!.featureId,
      intent: "fulfill",
      parameters: {
        resultBodyType: "solid",
        profiles,
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "twoSide",
          firstEnd: {
            kind: "blind",
            direction: "positive",
            distance: literal(7),
          },
          secondEnd: {
            kind: "blind",
            direction: "negative",
            distance: literal(2),
          },
        },
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
    });
    expect(twoSided.discovery!.model!.bodies[0]!.bounds!.min).toEqual([
      0, 0, -2,
    ]);
    expect(twoSided.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      20, 10, 7,
    ]);
  } finally {
    await w.close();
  }
}, 60000);

test("an exact authored sketch point determines the start plane and another point determines the termination", async () => {
  const w = await createSketchWorkflow();
  try {
    const rectangle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: rectangle.discovery!.state.draft,
      requireProfiles: true,
    });
    const profile = {
      kind: "region",
      sketchId: published.discovery!.sketch!.sketchId,
      regionId: published.discovery!.sketch!.profiles[0]!.regionId,
    };
    await w.execute({ operation: "sketch.begin", plane: "yz" });
    const line = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 3], end: [1, 10] },
      construction: false,
      intent: "fulfill",
    });
    const points = await w.execute({
      operation: "sketch.publish",
      draft: line.discovery!.state.draft,
      requireProfiles: false,
    });
    const sketch = points.discovery!.sketch!;
    const start = {
      kind: "sketchPoint",
      sketchId: sketch.sketchId,
      pointId: sketch.points.find((p) => p.position[1] === 3)!.pointId,
    };
    const end = {
      kind: "sketchPoint",
      sketchId: sketch.sketchId,
      pointId: sketch.points.find((p) => p.position[1] === 10)!.pointId,
    };
    const extruded = await w.execute({
      operation: "extrude.create",
      parameters: {
        resultBodyType: "solid",
        profiles: [profile],
        startExtent: { kind: "sketchPointOffset", target: start },
        extent: {
          mode: "oneSide",
          end: { kind: "upToVertex", direction: "positive", target: end },
        },
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
      intent: "fulfill",
    });
    expect(extruded.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [0, 0, 3],
      max: [20, 10, 10],
    });
  } finally {
    await w.close();
  }
}, 60000);
