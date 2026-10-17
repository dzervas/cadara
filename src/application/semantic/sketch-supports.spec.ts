import { describe, expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

describe("semantic existing sketch supports", () => {
  it("starts on an explicit existing construction support and preserves its frame", async () => {
    const w = await createSketchWorkflow();
    try {
      await w.execute({
        operation: "sketch.discard",
        draft: w.current().discovery!.state.draft,
      });
      const result = await w.execute({
        operation: "sketch.begin",
        support: {
          kind: "construction",
          constructionId: "construction_plane-yz",
        },
      });
      expect(result.discovery!.sketch!.plane).toBe("yz");
      expect(result.discovery!.sketch!.support).toEqual({
        support: {
          kind: "construction",
          constructionId: "construction_plane-yz",
        },
        key: "yz",
        frame: {
          origin: [0, 0, 0],
          xAxis: [0, 1, 0],
          yAxis: [0, 0, 1],
          normal: [1, 0, 0],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      });
      const authored = await w.execute({
        operation: "sketch.author",
        draft: result.discovery!.state.draft,
        primitive: { kind: "circle", center: [4, 3], radius: 2 },
        construction: false,
        intent: "fulfill",
      });
      expect(authored.discovery!.sketch!.profiles).toHaveLength(1);
      const published = await w.execute({
        operation: "sketch.publish",
        draft: authored.discovery!.state.draft,
        requireProfiles: true,
      });
      const reopened = await w.execute({
        operation: "sketch.open",
        sketchId: published.discovery!.sketch!.sketchId,
      });
      expect(reopened.discovery!.sketch!.support).toEqual(
        result.discovery!.sketch!.support,
      );
      expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
    } finally {
      await w.close();
    }
  }, 180_000);

  it("reassigns a committed sketch through production plane editing and restores it through document undo", async () => {
    const w = await createSketchWorkflow();
    try {
      const authored = await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive: { kind: "circle", center: [4, 3], radius: 2 },
        construction: false,
        intent: "fulfill",
      });
      const published = await w.execute({
        operation: "sketch.publish",
        draft: authored.discovery!.state.draft,
        requireProfiles: true,
      });
      const sketchId = published.discovery!.sketch!.sketchId!;
      const changed = await w.execute({
        operation: "sketch.support.reassign",
        sketchId,
        support: {
          kind: "construction",
          constructionId: "construction_plane-xz",
        },
      });
      expect(changed.completion.persistence.kind).toBe("committed");
      expect(changed.discovery!.state.revisionId).not.toBe(
        published.discovery!.state.revisionId,
      );
      const reopened = await w.execute({ operation: "sketch.open", sketchId });
      expect(reopened.discovery!.sketch!.plane).toBe("xz");
      expect(reopened.discovery!.sketch!.support!.frame.normal).toEqual([
        0, -1, 0,
      ]);
      expect(reopened.discovery!.sketch!.entities[0]!.entityId).toBe(
        published.discovery!.sketch!.entities[0]!.entityId,
      );
      expect(reopened.discovery!.sketch!.points[0]!.position).toEqual([4, 3]);
      expect(reopened.discovery!.sketch!.profiles).toHaveLength(1);
      await w.execute({
        operation: "sketch.discard",
        draft: reopened.discovery!.state.draft,
      });
      await w.execute({ operation: "history.undo", draft: null });
      const undone = await w.execute({ operation: "sketch.open", sketchId });
      expect(undone.discovery!.sketch!.plane).toBe("xy");
    } finally {
      await w.close();
    }
  }, 180_000);
});
