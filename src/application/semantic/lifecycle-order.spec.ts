import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("independent features reorder through production validation and keep their actual solids", async () => {
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const profile = {
      kind: "region",
      sketchId: sketch.sketchId,
      regionId: sketch.profiles[0]!.regionId,
    };
    const first = await w.execute({
      operation: "extrude.create",
      profile,
      depth: 7,
      intent: "fulfill",
    });
    const a = first.discovery!.model!.features[0]!.featureId;
    const second = await w.execute({
      operation: "extrude.create",
      profile,
      depth: 3,
      intent: "fulfill",
    });
    const b = second.discovery!.model!.features[1]!.featureId;
    const reordered = await w.execute({
      operation: "feature.reorder",
      featureId: b,
      beforeFeatureId: a,
      intent: "fulfill",
    });
    expect(
      reordered.discovery!.model!.features.map((f) => f.featureId),
    ).toEqual([b, a]);
    expect(
      reordered
        .discovery!.model!.bodies.map((b) => b.bounds!.max[2])
        .sort((a, b) => a! - b!),
    ).toEqual([3, 7]);
    expect(reordered.completion.persistence.kind).toBe("committed");
    const ordered = await w.execute({
      operation: "timeline.reorder",
      item: { kind: "feature", featureId: a },
      beforeItem: { kind: "feature", featureId: b },
      intent: "fulfill",
    });
    expect(ordered.discovery!.model!.features.map((f) => f.featureId)).toEqual([
      a,
      b,
    ]);
    expect(
      ordered.discovery!.model!.timeline!.map((row) => row.target),
    ).toEqual([
      { kind: "sketch", sketchId: sketch.sketchId },
      { kind: "feature", featureId: a },
      { kind: "feature", featureId: b },
    ]);
    expect(
      ordered
        .discovery!.model!.bodies.map((b) => b.bounds!.max[2])
        .sort((a, b) => a! - b!),
    ).toEqual([3, 7]);
    for (const input of [
      {
        operation: "feature.suppression.set",
        featureId: "feature_absent",
        suppressed: true,
      },
      { operation: "feature.delete", featureId: "feature_absent" },
      {
        operation: "feature.reorder",
        featureId: a,
        beforeFeatureId: "feature_absent",
      },
      { operation: "body.rename", bodyId: "body_absent", label: "Absent" },
      {
        operation: "target.delete",
        target: { kind: "sketch", sketchId: "sketch_absent" },
      },
      {
        operation: "target.delete",
        target: {
          kind: "region",
          sketchId: sketch.sketchId,
          regionId: sketch.profiles[0]!.regionId,
        },
      },
      {
        operation: "timeline.cursor.set",
        cursor: { kind: "feature", featureId: "feature_absent" },
      },
      {
        operation: "timeline.reorder",
        item: { kind: "feature", featureId: a },
        beforeItem: { kind: "sketch", sketchId: sketch.sketchId },
      },
    ]) {
      const before = w.current().discovery!;
      const refused = await w.run({ ...input, intent: "fulfill" });
      expect(refused.outcome.kind, JSON.stringify(refused)).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
      expect(refused.completion.persistence.kind).toBe("not-required");
      const inspected = await w.execute({ operation: "document.inspect" });
      expect(inspected.discovery!.state).toEqual(before.state);
      expect(inspected.discovery!.history).toEqual(before.history);
      expect(inspected.discovery!.model).toEqual(before.model);
    }
  } finally {
    await w.close();
  }
}, 180_000);
