import { expect, it } from "vitest";
import { createPlateWorkflow } from "../../../test/helpers/semantic-workflow";

it("consumes typed body, feature and sketch selectors and discovers feature/body ownership", async () => {
  const w = await createPlateWorkflow();
  try {
    const solid = w.current().discovery!;
    const body = solid.references.find(
      ({ target }) => target.kind === "body",
    )!.target;
    const feature = solid.references.find(
      ({ target }) => target.kind === "feature",
    )!.target;
    const sketch = solid.references.find(
      ({ target }) => target.kind === "sketch",
    )!.target;
    await w.execute({
      operation: "body.rename",
      bodyId: body,
      label: "Plate",
      intent: "fulfill",
    });
    expect(w.current().discovery!.references).toContainEqual(
      expect.objectContaining({ label: "Plate", target: body, owner: feature }),
    );
    const bodyOnly = await w.execute({
      operation: "document.inspect",
      owner: body,
    });
    expect(bodyOnly.discovery!.references).toContainEqual(
      expect.objectContaining({ target: body }),
    );
    expect(
      bodyOnly.discovery!.references.some(
        ({ target }) => target.kind === "face",
      ),
    ).toBe(true);
    expect(
      bodyOnly.discovery!.references.every(
        (entry) =>
          JSON.stringify(entry.owner) === JSON.stringify(body) ||
          JSON.stringify(entry.target) === JSON.stringify(body),
      ),
    ).toBe(true);
    const featureOnly = await w.execute({
      operation: "document.inspect",
      owner: feature,
    });
    expect(
      featureOnly.discovery!.references.map((entry) => entry.target),
    ).toEqual(expect.arrayContaining([feature, body]));
    expect(
      featureOnly.discovery!.references.some(
        ({ target }) => target.kind === "face",
      ),
    ).toBe(false);
    expect(featureOnly.discovery!.model).toEqual(bodyOnly.discovery!.model);
    const updated = await w.execute({
      operation: "extrude.update",
      featureId: feature,
      depth: 9,
      intent: "fulfill",
    });
    expect(updated.discovery!.model!.bodies[0]!.bounds!.max[2]).toBeCloseTo(
      9,
      6,
    );
    const plane = await w.execute({
      operation: "plane.create",
      intent: "fulfill",
      parameters: {
        mode: "coplanar",
        reference: {
          target: {
            kind: "construction",
            constructionId: "construction_plane-xy",
          },
        },
      },
    });
    const planeFeature = plane.discovery!.references.find(
      ({ target }) =>
        target.kind === "feature" &&
        target.featureId !==
          (feature.kind === "feature" ? feature.featureId : null),
    )!.target;
    expect(plane.discovery!.references).toContainEqual(
      expect.objectContaining({
        target: expect.objectContaining({ kind: "construction" }),
        owner: planeFeature,
      }),
    );
    await w.execute({
      operation: "feature.reorder",
      featureId: planeFeature,
      beforeFeatureId: feature,
      intent: "fulfill",
    });
    expect(
      w.current().discovery!.model!.features.map((entry) => entry.kind),
    ).toEqual(["plane", "extrude"]);
    await w.execute({ operation: "sketch.open", sketchId: sketch });
    expect(w.current().discovery!.sketch!.sketchId).toBe(
      sketch.kind === "sketch" ? sketch.sketchId : null,
    );
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    await w.execute({
      operation: "feature.delete",
      featureId: feature,
      intent: "fulfill",
    });
    expect(w.current().discovery!.model!.bodies).toEqual([]);
  } finally {
    await w.close();
  }
});
