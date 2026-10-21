import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("feature suppression and restoration rebuild actual geometry and preserve the feature identity", async () => {
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
    const featureId = solid.discovery!.model!.features[0]!.featureId;
    expect(solid.discovery!.model!.bodies[0]!.bounds!.max).toEqual([2, 2, 7]);
    const bodyId = solid.discovery!.model!.bodies[0]!.bodyId;
    const renamed = await w.execute({
      operation: "body.rename",
      bodyId,
      label: "Sleeve",
      intent: "fulfill",
    });
    expect(renamed.discovery!.references).toContainEqual({
      label: "Sleeve",
      target: { kind: "body", bodyId },
      owner: { kind: "feature", featureId },
    });
    expect(renamed.discovery!.model!.bodies[0]!.bounds!.max).toEqual([2, 2, 7]);
    expect(renamed.changedTargets).toEqual([{ kind: "body", bodyId }]);
    const suppressed = await w.execute({
      operation: "feature.suppression.set",
      featureId,
      suppressed: true,
      intent: "fulfill",
    });
    expect(suppressed.completion.persistence.kind).toBe("committed");
    expect(suppressed.completion.geometry.kind).toBe("current");
    expect(
      suppressed.discovery!.model!.features.map((f) => f.featureId),
    ).toEqual([featureId]);
    expect(suppressed.discovery!.model!.bodies).toEqual([]);
    expect(suppressed.discovery!.model!.features[0]!.suppressed).toBe(true);
    const restored = await w.execute({
      operation: "feature.suppression.set",
      featureId,
      suppressed: false,
      intent: "fulfill",
    });
    expect(restored.discovery!.model!.bodies[0]!.bounds!.max).toEqual([
      2, 2, 7,
    ]);
    expect(restored.completion.handoff.kind).toBe("current");
    expect(restored.discovery!.model!.features[0]!.suppressed).toBe(false);
    const inspected = await w.execute({ operation: "document.inspect" });
    expect(inspected.discovery!.state).toEqual(restored.discovery!.state);
    expect(restored.discovery!.references).toContainEqual({
      label: "Sleeve",
      target: { kind: "body", bodyId },
      owner: { kind: "feature", featureId },
    });
    const deleted = await w.execute({
      operation: "feature.delete",
      featureId,
      intent: "fulfill",
    });
    expect(deleted.discovery!.model!.features).toEqual([]);
    expect(deleted.discovery!.model!.bodies).toEqual([]);
    expect(deleted.completion.persistence.kind).toBe("committed");
    expect(deleted.completion.geometry.kind).toBe("current");
    const undone = await w.execute({ operation: "history.undo", draft: null });
    expect(undone.discovery!.model!.bodies[0]!.bounds!.max).toEqual([2, 2, 7]);
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
  } finally {
    await w.close();
  }
}, 180_000);

// cadara-49h: a body rename re-runs no feature; Undo and Redo still restore
// the name on the body and on every reference to it or its faces.
test("undo and redo of a body rename restore its name", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.author({ kind: "circle", center: [0, 0], radius: 2 });
    const sketch = (
      await w.execute({
        operation: "sketch.publish",
        draft: w.draft(),
        requireProfiles: true,
      })
    ).discovery!.sketch!;
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
    /** The names the body and its faces, edges and vertices are listed under. */
    const names = (result: typeof solid) => [
      ...new Set(
        result
          .discovery!.references.filter(
            (reference) =>
              "bodyId" in reference.target &&
              reference.target.bodyId === bodyId,
          )
          .map((reference) =>
            reference.label.replace(
              / (Face |Edge |Vertex )?(face|edge|vertex)_\S+$/,
              "",
            ),
          ),
      ),
    ];
    expect(names(solid)).toEqual(["Extrude 1"]);
    const renamed = await w.execute({
      operation: "body.rename",
      bodyId,
      label: "Sleeve",
      intent: "fulfill",
    });
    expect(names(renamed)).toEqual(["Sleeve"]);
    expect(renamed.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Rename Body",
    );
    const undone = await w.execute({ operation: "history.undo", draft: null });
    expect(names(undone)).toEqual(names(solid));
    const redone = await w.execute({ operation: "history.redo", draft: null });
    expect(names(redone)).toEqual(names(renamed));
  } finally {
    await w.close();
  }
}, 180_000);
