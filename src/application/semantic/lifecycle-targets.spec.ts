import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

for (const afterUndo of [false, true])
  test(`deleting a native body uses the production delete-solid feature (after undo: ${afterUndo})`, async () => {
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
      const solid = await w.execute({
        operation: "extrude.create",
        profile: {
          kind: "region",
          sketchId: sketch.sketchId,
          regionId: sketch.profiles[0]!.regionId,
        },
        depth: 7,
        intent: "fulfill",
      });
      const bodyId = solid.discovery!.model!.bodies[0]!.bodyId;
      if (afterUndo) {
        await w.execute({
          operation: "feature.delete",
          featureId: solid.discovery!.model!.features[0]!.featureId,
          intent: "fulfill",
        });
        const restored = await w.execute({
          operation: "history.undo",
          draft: null,
        });
        expect(restored.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
          2, 2, 7,
        ]);
      }
      const removed = await w.execute({
        operation: "target.delete",
        target: { kind: "body", bodyId },
        intent: "fulfill",
      });
      expect(removed.discovery!.model!.bodies).toEqual([]);
      expect(removed.discovery!.model!.features.map((f) => f.kind)).toEqual([
        "extrude",
        "deleteSolid",
      ]);
      expect(removed.completion.persistence.kind).toBe("committed");
      const featureId = solid.discovery!.model!.features[0]!.featureId;
      const tail = removed.discovery!.model!.features[1]!.featureId;
      const rollback = await w.execute({
        operation: "timeline.cursor.set",
        cursor: { kind: "feature", featureId },
        intent: "fulfill",
      });
      expect(
        rollback.discovery!.model!.features.map((f) => f.featureId),
      ).toEqual([featureId, tail]);
      expect(rollback.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
        2, 2, 7,
      ]);
      expect(rollback.discovery!.model!.cursor).toEqual({
        kind: "feature",
        featureId,
      });
      const beforeFeatures = await w.execute({
        operation: "timeline.cursor.set",
        cursor: { kind: "sketch", sketchId: sketch.sketchId },
        intent: "fulfill",
      });
      expect(beforeFeatures.discovery!.model!.features).toHaveLength(2);
      expect(beforeFeatures.discovery!.model!.bodies).toEqual([]);
      const forward = await w.execute({
        operation: "timeline.cursor.set",
        cursor: { kind: "feature", featureId: tail },
        intent: "fulfill",
      });
      expect(forward.discovery!.model!.features).toHaveLength(2);
      expect(forward.discovery!.model!.bodies).toEqual([]);
    } finally {
      await w.close();
    }
  }, 180_000);
