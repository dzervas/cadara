import { expect, test } from "vitest";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import type { RevolveFeatureParameters } from "@/contracts/modeling/schema";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

async function createRevolveWorkflow(surface = false) {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: surface
        ? { kind: "line", start: [2, 0], end: [2, 10] }
        : { kind: "rectangle", start: [2, 0], end: [4, 10] },
      construction: false,
      intent: "fulfill",
    });
    const line = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [0, 10] },
      construction: true,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: line.discovery!.state.draft,
      requireProfiles: !surface,
    });
    const sketch = published.discovery!.sketch!;
    const axisEntity = sketch.entities.find((e) => e.construction)!;
    const base = {
      axis: {
        kind: "sketchEntity" as const,
        sketchId: sketch.sketchId!,
        entityId: axisEntity.entityId,
      },
      startAngle: literal(0),
      extent: { mode: "oneSide" as const, end: { kind: "full" as const } },
    };
    const parameters: RevolveFeatureParameters = surface
      ? {
          ...base,
          resultBodyType: "surface",
          profiles: [
            {
              kind: "sketchEntity",
              sketchId: sketch.sketchId!,
              entityId: sketch.entities.find((e) => !e.construction)!.entityId,
            },
          ],
        }
      : {
          ...base,
          resultBodyType: "solid",
          profiles: [
            {
              kind: "region",
              sketchId: sketch.sketchId!,
              regionId: sketch.profiles[0]!.regionId,
            },
          ],
          operation: literal("newBody"),
          booleanScope: { kind: "standalone" },
        };
    return { ...w, parameters };
  } catch (error) {
    await w.close();
    throw error;
  }
}
function expectBounds(
  bounds: { min: readonly number[]; max: readonly number[] } | null,
  min: readonly number[],
  max: readonly number[],
) {
  expect(bounds).not.toBeNull();
  for (const [i, value] of min.entries())
    expect(bounds!.min[i]).toBeCloseTo(value, 5);
  for (const [i, value] of max.entries())
    expect(bounds!.max[i]).toBeCloseTo(value, 5);
}

test("canonical revolves create native solids, update direction and expose current topology", async () => {
  const w = await createRevolveWorkflow();
  try {
    const full = await w.execute({
      operation: "revolve.create",
      parameters: w.parameters,
      intent: "fulfill",
    });
    const body = full.discovery!.model!.bodies[0]!;
    expect(body.kind).toBe("solid");
    expectBounds(body.bounds, [-4, 0, -4], [4, 10, 4]);
    expect(
      full.discovery!.references.some((r) => r.target.kind === "face"),
    ).toBe(true);
    const featureId = full.discovery!.model!.features[0]!.featureId;
    for (const direction of ["counterClockwise", "clockwise"] as const) {
      const updated = await w.execute({
        operation: "revolve.update",
        featureId,
        parameters: {
          ...w.parameters,
          extent: {
            mode: "oneSide",
            end: { kind: "blind", angle: literal(Math.PI / 2), direction },
          },
        },
        intent: "fulfill",
      });
      expectBounds(
        updated.discovery!.model!.bodies[0]!.bounds,
        [0, 0, direction === "counterClockwise" ? -4 : 0],
        [4, 10, direction === "counterClockwise" ? 0 : 4],
      );
      expect(updated.completion.geometry.kind).toBe("current");
      expect(updated.discovery!.state.revisionId).not.toBe(
        full.discovery!.state.revisionId,
      );
    }
    const end = {
      kind: "blind",
      direction: "counterClockwise",
      angle: literal(Math.PI / 4),
    };
    const symmetric = await w.execute({
      operation: "revolve.update",
      featureId,
      parameters: { ...w.parameters, extent: { mode: "symmetric", end } },
      intent: "fulfill",
    });
    expectBounds(
      symmetric.discovery!.model!.bodies[0]!.bounds,
      [Math.SQRT2, 0, -2 * Math.SQRT2],
      [4, 10, 0],
    );
    expect(symmetric.discovery!.model!.bodies).toHaveLength(2);
    expectBounds(
      symmetric.discovery!.model!.bodies[1]!.bounds,
      [Math.SQRT2, 0, 0],
      [4, 10, 2 * Math.SQRT2],
    );
    const two = await w.execute({
      operation: "revolve.update",
      featureId,
      parameters: {
        ...w.parameters,
        extent: {
          mode: "twoSide",
          firstEnd: end,
          secondEnd: {
            ...end,
            direction: "clockwise",
            angle: literal(Math.PI / 2),
          },
        },
      },
      intent: "fulfill",
    });
    expectBounds(
      two.discovery!.model!.bodies[0]!.bounds,
      [Math.SQRT2, 0, -2 * Math.SQRT2],
      [4, 10, 0],
    );
    expect(two.discovery!.model!.bodies).toHaveLength(2);
    expectBounds(
      two.discovery!.model!.bodies[1]!.bounds,
      [0, 0, 0],
      [4, 10, 4],
    );
  } finally {
    await w.close();
  }
}, 60000);

test("sheet revolves preserve full, symmetric, two-sided and start-angle geometry through updates", async () => {
  const w = await createRevolveWorkflow(true);
  try {
    const full = await w.execute({
      operation: "revolve.create",
      parameters: w.parameters,
      intent: "fulfill",
    });
    expect(full.discovery!.model!.bodies[0]!.kind).toBe("sheet");
    expectBounds(
      full.discovery!.model!.bodies[0]!.bounds,
      [-2, 0, -2],
      [2, 10, 2],
    );
    const featureId = full.discovery!.model!.features[0]!.featureId;
    const end = {
      kind: "blind",
      direction: "counterClockwise",
      angle: literal(Math.PI / 4),
    };
    const symmetric = await w.execute({
      operation: "revolve.update",
      featureId,
      parameters: { ...w.parameters, extent: { mode: "symmetric", end } },
      intent: "fulfill",
    });
    expectBounds(
      symmetric.discovery!.model!.bodies[0]!.bounds,
      [Math.SQRT2, 0, -Math.SQRT2],
      [2, 10, Math.SQRT2],
    );
    const two = await w.execute({
      operation: "revolve.update",
      featureId,
      parameters: {
        ...w.parameters,
        extent: {
          mode: "twoSide",
          firstEnd: end,
          secondEnd: {
            ...end,
            direction: "clockwise",
            angle: literal(Math.PI / 2),
          },
        },
      },
      intent: "fulfill",
    });
    expectBounds(
      two.discovery!.model!.bodies[0]!.bounds,
      [0, 0, -Math.SQRT2],
      [2, 10, 2],
    );
    const start = await w.execute({
      operation: "revolve.update",
      featureId,
      parameters: {
        ...w.parameters,
        startAngle: literal(Math.PI / 2),
        extent: {
          mode: "oneSide",
          end: { ...end, angle: literal(Math.PI / 2) },
        },
      },
      intent: "fulfill",
    });
    expectBounds(
      start.discovery!.model!.bodies[0]!.bounds,
      [-2, 0, -2],
      [0, 10, 0],
    );
  } finally {
    await w.close();
  }
}, 60000);

test("canonical angular references resolve actual native sheet bodies and faces, including authored offsets", async () => {
  const w = await createRevolveWorkflow();
  try {
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const line = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [0, 10] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: line.discovery!.state.draft,
      requireProfiles: false,
    });
    const sketch = published.discovery!.sketch!;
    const target = await w.execute({
      operation: "extrude.create",
      parameters: {
        resultBodyType: "surface",
        profiles: [
          {
            kind: "sketchEntity",
            sketchId: sketch.sketchId,
            entityId: sketch.entities[0]!.entityId,
          },
        ],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "negative", distance: literal(4) },
        },
      },
      intent: "fulfill",
    });
    const body = target.discovery!.model!.bodies[0]!;
    expectBounds(body.bounds, [0, 0, -4], [0, 10, 0]);
    const face = target.discovery!.references.filter(
      (r) => r.target.kind === "face",
    );
    expect(face).toHaveLength(1);
    for (const end of [
      {
        kind: "upToPart",
        direction: "counterClockwise",
        target: { kind: "body", bodyId: body.bodyId },
      },
      {
        kind: "upToFace",
        direction: "counterClockwise",
        target: face[0]!.target,
      },
      { kind: "upToNext", direction: "counterClockwise" },
    ]) {
      const result = await w.execute({
        operation: "revolve.create",
        parameters: { ...w.parameters, extent: { mode: "oneSide", end } },
        intent: "fulfill",
      });
      expectBounds(
        result.discovery!.model!.bodies.find((b) => b.kind === "solid")!.bounds,
        [0, 0, -4],
        [4, 10, 0],
      );
      await w.execute({
        operation: "feature.delete",
        featureId: result.discovery!.model!.features.find(
          (f) => f.kind === "revolve",
        )!.featureId,
        intent: "fulfill",
      });
    }
    const offset = await w.execute({
      operation: "revolve.create",
      parameters: {
        ...w.parameters,
        extent: {
          mode: "oneSide",
          end: {
            kind: "upToPart",
            direction: "counterClockwise",
            target: { kind: "body", bodyId: body.bodyId },
            offset: { direction: "shorten", angle: literal(Math.PI / 4) },
          },
        },
      },
      intent: "fulfill",
    });
    expectBounds(
      offset.discovery!.model!.bodies.find((b) => b.kind === "solid")!.bounds,
      [Math.SQRT2, 0, -2 * Math.SQRT2],
      [4, 10, 0],
    );
  } finally {
    await w.close();
  }
}, 60000);

test("construction axes, multi-profile groups and unusable extents refuse without changing authored or native state", async () => {
  const w = await createRevolveWorkflow();
  try {
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [5, 0], end: [6, 10] },
      construction: false,
      intent: "fulfill",
    });
    await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const before = w.current().discovery!;
    for (const parameters of [
      {
        ...w.parameters,
        axis: { kind: "construction", constructionId: "construction_plane-xy" },
      },
      {
        ...w.parameters,
        profiles: [
          ...w.parameters.profiles,
          {
            kind: "region",
            sketchId: before.sketch!.sketchId,
            regionId: before.sketch!.profiles[0]!.regionId,
          },
        ],
      },
      {
        ...w.parameters,
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "clockwise", angle: literal(0) },
        },
      },
      {
        ...w.parameters,
        extent: {
          mode: "oneSide",
          end: { kind: "upToNext", direction: "clockwise" },
        },
      },
    ]) {
      const result = await w.run({
        operation: "revolve.create",
        parameters,
        intent: "fulfill",
      });
      expect(result.outcome.kind, JSON.stringify(result)).toBe("rejected");
      expect(result.completion.live.kind).toBe("unchanged");
      expect(result.completion.live.state).toEqual(before.state);
      const inspected = await w.execute({ operation: "document.inspect" });
      expect(inspected.discovery!.model).toEqual(before.model);
    }
    const duplicate = await w.run({
      operation: "revolve.create",
      parameters: {
        ...w.parameters,
        profiles: [...w.parameters.profiles, ...w.parameters.profiles],
      },
      intent: "fulfill",
    });
    expect(duplicate.outcome.kind).toBe("failed");
    expect(
      duplicate.diagnostics.some((d) =>
        d.message.includes("duplicate profile"),
      ),
    ).toBe(true);
    expect(duplicate.completion.live.state).toEqual(before.state);
  } finally {
    await w.close();
  }
}, 60000);

test("unsupported surface combinations retain production refusals and author-invalid is never an implicit success policy", async () => {
  const w = await createRevolveWorkflow(true);
  try {
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [5, 0], end: [6, 10] },
      construction: false,
      intent: "fulfill",
    });
    await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const before = w.current().discovery!;
    const end = {
      kind: "blind",
      direction: "clockwise",
      angle: literal(Math.PI / 2),
    };
    for (const parameters of [
      {
        ...w.parameters,
        extent: { mode: "twoSide", firstEnd: end, secondEnd: end },
      },
      {
        ...w.parameters,
        extent: {
          mode: "twoSide",
          firstEnd: { ...end, angle: literal(Math.PI * 1.5) },
          secondEnd: {
            ...end,
            direction: "counterClockwise",
            angle: literal(Math.PI),
          },
        },
      },
      {
        ...w.parameters,
        profiles: [
          ...w.parameters.profiles,
          {
            kind: "region",
            sketchId: before.sketch!.sketchId,
            regionId: before.sketch!.profiles[0]!.regionId,
          },
        ],
      },
    ]) {
      const refused = await w.run({
        operation: "revolve.create",
        parameters,
        intent: "fulfill",
      });
      expect(refused.outcome.kind, JSON.stringify(refused)).toBe("rejected");
      expect(refused.completion.live.state).toEqual(before.state);
    }
    // Unresolved inputs may be retained by production as invalid authored state;
    // fulfillment must not certify that state as requested geometry.
    const parameters = {
      ...w.parameters,
      profiles: [
        {
          kind: "sketchEntity",
          sketchId: before.sketch!.sketchId,
          entityId: "sketch_entity_missing",
        },
      ],
    };
    const failed = await w.run({
      operation: "revolve.create",
      parameters,
      intent: "fulfill",
    });
    expect(failed.outcome.kind, JSON.stringify(failed)).toBe("failed");
    expect(failed.completion.live.kind).toBe("applied");
    expect(failed.completion.geometry.kind).toBe("failed");
    expect(failed.completion.persistence.kind).toBe("committed");
    const invalid = await w.run({
      operation: "revolve.update",
      featureId: failed.discovery!.model!.features[0]!.featureId,
      parameters,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind, JSON.stringify(invalid)).toBe(
      "accepted-invalid",
    );
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
    const axisFailed = await w.run({
      operation: "revolve.update",
      featureId: failed.discovery!.model!.features[0]!.featureId,
      parameters: {
        ...w.parameters,
        axis: {
          kind: "sketchEntity",
          sketchId: before.sketch!.sketchId,
          entityId: "sketch_entity_missing-axis",
        },
      },
      intent: "fulfill",
    });
    expect(axisFailed.outcome.kind).toBe("failed");
    expect(axisFailed.completion.live.kind).toBe("applied");
    expect(axisFailed.completion.geometry.kind).toBe("failed");
  } finally {
    await w.close();
  }
}, 60000);

test("solid revolve boolean scopes change native output and missing scope cannot fulfill requested geometry", async () => {
  const w = await createRevolveWorkflow();
  try {
    const base = await w.execute({
      operation: "revolve.create",
      parameters: w.parameters,
      intent: "fulfill",
    });
    const target = base.discovery!.model!.bodies[0]!;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [3, 0], end: [4, 10] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const parameters = {
      ...w.parameters,
      resultBodyType: "solid",
      profiles: [
        {
          kind: "region",
          sketchId: published.discovery!.sketch!.sketchId,
          regionId: published.discovery!.sketch!.profiles[0]!.regionId,
        },
      ],
      operation: literal("cut"),
      booleanScope: { kind: "targetBody", bodyId: target.bodyId },
    };
    const cut = await w.execute({
      operation: "revolve.create",
      parameters,
      intent: "fulfill",
    });
    expect(cut.discovery!.model!.bodies).toHaveLength(1);
    expectBounds(
      cut.discovery!.model!.bodies[0]!.bounds,
      [-3, 0, -3],
      [3, 10, 3],
    );
    const invalid = await w.run({
      operation: "revolve.update",
      featureId: cut.discovery!.model!.features.find(
        (f) => f.featureId !== base.discovery!.model!.features[0]!.featureId,
      )!.featureId,
      parameters: {
        ...parameters,
        booleanScope: { kind: "targetBody", bodyId: "body_missing" },
      },
      intent: "fulfill",
    });
    expect(invalid.outcome.kind, JSON.stringify(invalid)).toBe("failed");
    expect(invalid.completion.geometry.kind).toBe("failed");
    expect(invalid.completion.live.kind).toBe("applied");
    expect(invalid.completion.persistence.kind).toBe("committed");
  } finally {
    await w.close();
  }
}, 60000);

test("a closed region can author a genuine sheet without manufacturing solid boolean state", async () => {
  const w = await createRevolveWorkflow();
  try {
    const result = await w.execute({
      operation: "revolve.create",
      parameters: {
        resultBodyType: "surface",
        profiles: w.parameters.profiles,
        axis: w.parameters.axis,
        startAngle: w.parameters.startAngle,
        extent: w.parameters.extent,
      },
      intent: "fulfill",
    });
    expect(result.discovery!.model!.bodies).toHaveLength(1);
    expect(result.discovery!.model!.bodies[0]!.kind).toBe("sheet");
    expectBounds(
      result.discovery!.model!.bodies[0]!.bounds,
      [-4, 0, -4],
      [4, 10, 4],
    );
  } finally {
    await w.close();
  }
}, 60000);
