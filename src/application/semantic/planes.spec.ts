import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SketchPlaneFrame } from "@/contracts/shared/sketch-plane";
import {
  planeAuthoringDefinition,
  preparePlaneFeatureDefinition,
} from "@/core/feature-authoring/features/plane";
import { PLANE_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";

const frame: SketchPlaneFrame = {
  linearUnit: "documentLength",
  handedness: "rightHanded",
  origin: [3, 4, 5],
  xAxis: [0, 1, 0],
  yAxis: [0, 0, 1],
  normal: [1, 0, 0],
};
async function planeWorkflow() {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.discard",
      draft: w.current().discovery!.state.draft,
    });
    return w;
  } catch (error) {
    await w.close();
    throw error;
  }
}

test("browser plane hydration preserves canonical frames until an explicit reference replaces them", () => {
  const definition = {
    kind: "plane" as const,
    featureTypeVersion: PLANE_FEATURE_SCHEMA_VERSION,
    parameters: { mode: "explicitFrame" as const, frame },
  };
  const draft = planeAuthoringDefinition.hydrateDraft(definition);
  expect(
    planeAuthoringDefinition.buildDefinition(
      planeAuthoringDefinition.applyPatch(draft, {}),
    ),
  ).toEqual(definition);
  expect(preparePlaneFeatureDefinition(definition.parameters)).toEqual(
    definition,
  );
  const target = {
    kind: "construction" as const,
    constructionId: "construction_plane-xy" as const,
  };
  expect(
    planeAuthoringDefinition.buildDefinition(
      planeAuthoringDefinition.applySelection(draft, target),
    )!.parameters,
  ).toEqual({ mode: "coplanar", reference: { target } });
});

test("production explicit and coplanar planes expose current frames, stable updates and usable sketch support", async () => {
  const w = await planeWorkflow();
  try {
    const created = await w.execute({
      operation: "plane.create",
      parameters: { mode: "explicitFrame", frame },
      intent: "fulfill",
    });
    const feature = created.discovery!.model!.features.find(
      (f) => f.kind === "plane",
    )!;
    const target = feature.producedTargets[0]!;
    expect(target.kind).toBe("construction");
    const plane = created.discovery!.model!.constructions!.find(
      (c) => c.ownerFeatureId === feature.featureId,
    )!;
    expect(plane.frame).toEqual(frame);
    expect(created.completion.geometry.kind).toBe("current");
    expect(created.completion.persistence.kind).toBe("committed");
    expect(
      created.discovery!.references.some(
        (r) =>
          r.target.kind === "construction" &&
          r.target.constructionId === plane.constructionId,
      ),
    ).toBe(true);
    const copied = await w.execute({
      operation: "plane.create",
      parameters: { mode: "coplanar", reference: { target } },
      intent: "fulfill",
    });
    const copyFeature = copied.discovery!.model!.features.find(
      (f) => f.featureId !== feature.featureId,
    )!;
    expect(
      copied.discovery!.model!.constructions!.find(
        (c) => c.ownerFeatureId === copyFeature.featureId,
      )!.frame,
    ).toEqual(frame);
    const moved = { ...frame, origin: [7, 8, 9] };
    const updated = await w.execute({
      operation: "plane.update",
      featureId: feature.featureId,
      parameters: { mode: "explicitFrame", frame: moved },
      intent: "fulfill",
    });
    expect(
      updated.discovery!.model!.constructions!.find(
        (c) => c.constructionId === plane.constructionId,
      )!.frame,
    ).toEqual(moved);
    expect(
      updated.discovery!.model!.constructions!.find(
        (c) => c.ownerFeatureId === copyFeature.featureId,
      )!.frame,
    ).toEqual(moved);
    await w.execute({ operation: "sketch.begin", support: target });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [2, 3] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const extruded = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: sketch.sketchId!,
        regionId: sketch.profiles[0]!.regionId,
      },
      depth: 4,
      intent: "fulfill",
    });
    const bounds = extruded.discovery!.model!.bodies[0]!.bounds!;
    for (const [i, low] of [7, 8, 9].entries())
      expect(bounds.min[i]).toBeCloseTo(low, 5);
    for (const [i, high] of [11, 10, 12].entries())
      expect(bounds.max[i]).toBeCloseTo(high, 5);
    // A real planar face discovered from native output is also a supported seed.
    const face = extruded.discovery!.references.find(
      (r) => r.target.kind === "face",
    )!.target;
    const fromFace = await w.execute({
      operation: "plane.create",
      parameters: { mode: "coplanar", reference: { target: face } },
      intent: "fulfill",
    });
    expect(fromFace.completion.geometry.kind).toBe("current");
  } finally {
    await w.close();
  }
}, 180000);

test("plane refusal never normalizes degenerate or left-handed frames, and missing references cannot fulfill", async () => {
  const w = await planeWorkflow();
  try {
    const before = w.current().discovery!.state;
    for (const invalid of [
      { ...frame, xAxis: [0, 0, 0] },
      { ...frame, normal: [-1, 0, 0] },
    ]) {
      const result = await w.run({
        operation: "plane.create",
        parameters: { mode: "explicitFrame", frame: invalid },
        intent: "fulfill",
      });
      expect(result.outcome.kind).toBe("rejected");
      expect(result.completion.live.kind).toBe("unchanged");
      expect(result.completion.live.state).toEqual(before);
    }
    const missing = await w.run({
      operation: "plane.create",
      parameters: {
        mode: "coplanar",
        reference: {
          target: {
            kind: "construction",
            constructionId: "construction_missing",
          },
        },
      },
      intent: "fulfill",
    });
    expect(missing.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
    expect(missing.completion.live.kind).toBe("applied");
    expect(missing.completion.geometry.kind).toBe("failed");
    expect(missing.completion.persistence.kind).toBe("committed");
    await w.execute({
      operation: "feature.delete",
      featureId: w.current().discovery!.model!.features[0]!.featureId,
      intent: "fulfill",
    });
    const valid = await w.execute({
      operation: "plane.create",
      parameters: { mode: "explicitFrame", frame },
      intent: "fulfill",
    });
    const featureId = valid.discovery!.model!.features[0]!.featureId;
    const failedUpdate = await w.run({
      operation: "plane.update",
      featureId,
      parameters: {
        mode: "coplanar",
        reference: {
          target: {
            kind: "construction",
            constructionId: "construction_missing",
          },
        },
      },
      intent: "fulfill",
    });
    expect(failedUpdate.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(failedUpdate.completion.live.kind).toBe("applied");
    expect(failedUpdate.completion.geometry.kind).toBe("failed");
    expect(failedUpdate.completion.persistence.kind).toBe("committed");
    const deliberate = await w.run({
      operation: "plane.update",
      featureId,
      parameters: {
        mode: "coplanar",
        reference: {
          target: {
            kind: "construction",
            constructionId: "construction_missing",
          },
        },
      },
      intent: "author-invalid",
    });
    expect(deliberate.outcome.kind).toBe("accepted-invalid");
    expect(deliberate.completion.geometry.kind).toBe("invalid-editable");
    expect(deliberate.completion.live.kind).toBe("applied");
  } finally {
    await w.close();
  }
}, 180000);
