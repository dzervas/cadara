import { expect, test } from "vitest";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("extrudes an open curve into a measured sheet and preserves its open boundaries across extent edits", async () => {
  const w = await createSketchWorkflow();
  try {
    const line = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: line.discovery!.state.draft,
      requireProfiles: false,
    });
    const sketch = published.discovery!.sketch!;
    const profiles = [
      {
        kind: "sketchEntity",
        sketchId: sketch.sketchId,
        entityId: sketch.entities[0]!.entityId,
      },
    ];
    const parameters = {
      resultBodyType: "surface",
      profiles,
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: { kind: "blind", direction: "positive", distance: literal(5) },
      },
    };
    const created = await w.execute({
      operation: "extrude.create",
      parameters,
      intent: "fulfill",
    });
    expect(created.discovery!.model!.bodies).toHaveLength(1);
    expect(created.discovery!.model!.bodies[0]).toMatchObject({
      kind: "sheet",
      bounds: { min: [0, 0, 0], max: [10, 0, 5] },
    });
    const featureId = created.discovery!.model!.features[0]!.featureId;
    const symmetric = await w.execute({
      operation: "extrude.update",
      featureId,
      parameters: {
        ...parameters,
        extent: {
          mode: "symmetric",
          end: { kind: "blind", direction: "positive", distance: literal(3) },
        },
      },
      intent: "fulfill",
    });
    expect(symmetric.discovery!.model!.bodies[0]).toMatchObject({
      kind: "sheet",
      bounds: { min: [0, 0, -3], max: [10, 0, 3] },
    });
    const twoSide = await w.execute({
      operation: "extrude.update",
      featureId,
      parameters: {
        ...parameters,
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
      },
      intent: "fulfill",
    });
    expect(twoSide.discovery!.model!.bodies[0]).toMatchObject({
      kind: "sheet",
      bounds: { min: [0, 0, -2], max: [10, 0, 7] },
    });
    const depth = await w.execute({
      operation: "extrude.update",
      featureId,
      depth: 9,
      intent: "fulfill",
    });
    expect(depth.discovery!.model!.bodies[0]).toMatchObject({
      kind: "sheet",
      bounds: { min: [0, 0, -2], max: [10, 0, 9] },
    });
    const invalidDraft = await w.run({
      operation: "extrude.update",
      featureId,
      parameters: {
        ...parameters,
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: literal(5),
            draftAngle: literal(0.1),
          },
        },
      },
      intent: "fulfill",
    });
    expect(invalidDraft.outcome).toEqual({
      kind: "rejected",
      reasonCode: "extrude-incomplete",
    });
    expect(invalidDraft.completion.live).toEqual({
      kind: "unchanged",
      state: depth.discovery!.state,
    });
    const inspected = await w.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.model!.bodies).toEqual(
      depth.discovery!.model!.bodies,
    );
    const unsupported = await w.run({
      operation: "extrude.update",
      featureId,
      parameters: {
        ...parameters,
        extent: {
          mode: "oneSide",
          end: { kind: "upToNext", direction: "positive" },
        },
      },
      intent: "fulfill",
    });
    expect(unsupported.outcome.kind, JSON.stringify(unsupported)).toBe(
      "rejected",
    );
    expect(unsupported.completion.live.kind).toBe("unchanged");
    expect(unsupported.diagnostics.map((d) => d.message).join(" ")).toContain(
      "up-to-next",
    );
  } finally {
    await w.close();
  }
}, 60000);
