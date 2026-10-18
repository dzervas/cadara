import { expect, test } from "vitest";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("a face-supported boss follows its plate after an upstream variable changes", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({ operation: "sketch.discard", draft: w.draft() });
    const variable = await w.execute({
      operation: "variable.add",
      name: "thickness",
      valueText: "6",
      intent: "fulfill",
    });
    const variableId = variable.discovery!.variables![0]!.variableId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.author({ kind: "rectangle", start: [-30, -30], end: [30, 30] });
    const plateSketch = await w.execute({
      operation: "sketch.publish",
      draft: w.draft(),
      requireProfiles: true,
    });
    const plateProfile = plateSketch.discovery!.sketch!;
    const plate = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: plateProfile.sketchId,
        regionId: plateProfile.profiles[0]!.regionId,
      },
      depth: "thickness",
      intent: "fulfill",
    });
    expect(plate.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [-30, -30, 0],
      max: [30, 30, 6],
    });
    // Discover the top face through its public support frame, not topology order.
    const faces = plate.discovery!.references.filter(
      (r) => r.target.kind === "face",
    );
    for (const face of faces) {
      const opened = await w.execute({
        operation: "sketch.begin",
        support: face.target,
      });
      const frame = opened.discovery!.sketch!.support!.frame;
      if (frame.normal[2] > 0.99 && Math.abs(frame.origin[2] - 6) < 1e-6) break;
      await w.execute({ operation: "sketch.discard", draft: w.draft() });
    }
    const support = w.current().discovery!.sketch!.support!;
    expect(support.support.kind).toBe("face");
    expect(support.frame.normal[2]).toBeCloseTo(1, 8);
    expect(support.frame.origin[2]).toBeCloseTo(6, 8);
    // Place the circle at world (0, 0, 6), independent of the native local axes.
    const { origin, xAxis, yAxis } = support.frame;
    const delta = [-origin[0], -origin[1], 6 - origin[2]];
    const center = [xAxis, yAxis].map((axis) =>
      axis.reduce((sum, component, i) => sum + component * delta[i]!, 0),
    );
    await w.author({ kind: "circle", center, radius: 10 });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.draft(),
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const boss = await w.execute({
      operation: "extrude.create",
      parameters: {
        resultBodyType: "solid",
        profiles: [
          {
            kind: "region",
            sketchId: sketch.sketchId,
            regionId: sketch.profiles[0]!.regionId,
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: literal(5) },
        },
        operation: literal("join"),
        booleanScope: {
          kind: "targetBody",
          bodyId: plate.discovery!.model!.bodies[0]!.bodyId,
        },
      },
      intent: "fulfill",
    });
    expect(boss.discovery!.model!.bodies).toHaveLength(1);
    expect(boss.discovery!.model!.bodies[0]!.bounds!.max[2]).toBeCloseTo(11, 6);
    await w.execute({
      operation: "variable.update",
      variableId,
      name: "thickness",
      valueText: "3 + 3",
      intent: "fulfill",
    });
    const unchanged = await w.execute({
      operation: "sketch.open",
      sketchId: sketch.sketchId,
    });
    expect(unchanged.discovery!.sketch!.support!.frame).toEqual(support.frame);
    await w.execute({ operation: "sketch.discard", draft: w.draft() });
    const rebuilt = await w.execute({
      operation: "variable.update",
      variableId,
      name: "thickness",
      valueText: "10",
      intent: "fulfill",
    });
    expect(rebuilt.completion.live.kind).toBe("applied");
    expect(rebuilt.completion.geometry).toMatchObject({
      kind: "current",
      rebuildRevisionId: rebuilt.discovery!.state.revisionId,
    });
    expect(rebuilt.discovery!.model!.bodies).toHaveLength(1);
    expect(rebuilt.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [-30, -30, 0],
      max: [30, 30, 15],
    });
  } finally {
    await w.close();
  }
}, 180_000);
