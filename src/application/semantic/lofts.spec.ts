import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import {
  assertLoftInterior,
  loftBody,
  loftInterior,
} from "../../../test/helpers/semantic-loft-geometry";
import { prepareLoftFeatureDefinition } from "@/core/feature-authoring/features/loft";
import type { LoftFeatureParameters } from "@/contracts/modeling/advanced-solid";

async function loftWorkflow() {
  const w = await createSketchWorkflow();
  try {
    async function rectangle(size: number) {
      await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive: {
          kind: "rectangle",
          start: [-size, -size],
          end: [size, size],
        },
        construction: false,
        intent: "fulfill",
      });
      return w.execute({
        operation: "sketch.publish",
        draft: w.current().discovery!.state.draft,
        requireProfiles: true,
      });
    }
    const start = (await rectangle(1)).discovery!.sketch!;
    const profile = {
      kind: "region" as const,
      sketchId: start.sketchId!,
      regionId: start.profiles[0]!.regionId,
    };
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const end = (await rectangle(2)).discovery!.sketch!;
    const seed = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: end.sketchId!,
        regionId: end.profiles[0]!.regionId,
      },
      depth: 10,
      intent: "fulfill",
    });
    const tool = seed.discovery!.model!.bodies[0]!;
    const face = tool.topology!.find(
      (t) =>
        t.entityClass === "face" &&
        t.geometryType === "plane" &&
        Math.abs(t.boundingBox!.low[2] - 10) < 1e-5 &&
        Math.abs(t.boundingBox!.high[2] - 10) < 1e-5,
    )!.reference;
    const edge = tool.topology!.find(
      (t) =>
        t.entityClass === "edge" &&
        t.geometryType === "line" &&
        t.boundingBox!.high[2] - t.boundingBox!.low[2] > 9.99,
    )!.reference;
    if (face.kind !== "face" || edge.kind !== "edge")
      throw new Error("Missing native loft inputs");
    const profiles: LoftFeatureParameters["participants"][number] = {
      role: "profile",
      targets: [profile, face],
    };
    const path: LoftFeatureParameters["participants"][number] = {
      role: "path",
      targets: [edge],
    };
    return { ...w, profiles, path, profile, face, edge, toolId: tool.bodyId };
  } catch (error) {
    await w.close();
    throw error;
  }
}

const profiles = {
  role: "profile",
  targets: [
    { kind: "region", sketchId: "sketch_a", regionId: "region_a" },
    { kind: "region", sketchId: "sketch_b", regionId: "region_b" },
  ],
} as const;
const path = {
  role: "path",
  targets: [{ kind: "edge", bodyId: "body_a", edgeId: "edge_a" }],
} as const;

test("shared loft preparation preserves explicit order and authored path count, refusing loss and inert settings", () => {
  const definition = prepareLoftFeatureDefinition({
    participants: [profiles, path],
    options: {
      path: { sectionCount: { source: "expression", valueText: "3" } },
    },
  })!;
  expect(
    definition.parameters.participants.find((p) => p.role === "profile")!
      .targets,
  ).toEqual(profiles.targets);
  expect(definition.parameters.options!.path).toEqual({
    sectionCount: { source: "expression", valueText: "3" },
  });
  expect(
    prepareLoftFeatureDefinition({ participants: [profiles, path] })!.parameters
      .options!.path,
  ).toEqual({ sectionCount: { source: "literal", value: 5 } });
  for (const parameters of [
    { participants: [profiles, profiles] },
    {
      participants: [
        profiles,
        { ...path, targets: [...path.targets, ...path.targets] },
      ],
    },
    { participants: [profiles], options: { path: { sectionCount: 3 } } },
    {
      participants: [profiles],
      operationIntent: { source: "literal", value: "add" },
    },
    {
      participants: [profiles],
      operationIntent: { source: "expression", valueText: "create" },
    },
    { participants: [profiles], options: { guideContinuity: "none" } },
    {
      participants: [profiles],
      options: {
        profileConditions: {
          startCondition: "normal",
          endCondition: "none",
          startMagnitude: 2,
        },
      },
    },
    { participants: [profiles], options: { matchConnections: [] } },
    { participants: [profiles, { role: "guideCurve", targets: path.targets }] },
    { participants: [profiles, { role: "targetBody", targets: [] }] },
    { participants: [{ ...profiles, targets: [profiles.targets[0]] }] },
    {
      participants: [
        { ...profiles, targets: [...profiles.targets, profiles.targets[0]] },
        path,
      ],
    },
    {
      participants: [
        profiles,
        {
          role: "path",
          targets: [
            {
              kind: "sketchEntity",
              sketchId: "sketch_a",
              entityId: "entity_a",
            },
          ],
        },
      ],
    },
    ...[0, -1, 1.5].map((sectionCount) => ({
      participants: [profiles, path],
      options: { path: { sectionCount } },
    })),
  ])
    expect(
      prepareLoftFeatureDefinition(parameters as never),
      JSON.stringify(parameters),
    ).toBeNull();
});

test("production loft updates preserve order and prove actual path interior sections independently", async () => {
  const w = await loftWorkflow();
  try {
    const ordinary = await w.execute({
      operation: "loft.create",
      parameters: { participants: [w.profiles] },
      intent: "fulfill",
    });
    const featureId = ordinary.discovery!.model!.features.find(
      (f) => f.kind === "loft",
    )!.featureId;
    const body = loftBody(ordinary);
    expect(body.bodyId).not.toBe(w.toolId);
    const vertices = body.topology!.filter((t) => t.entityClass === "vertex");
    expect(vertices).toHaveLength(8);
    for (const [z, k] of [
      [0, 1],
      [10, 2],
    ])
      for (const x of [-k!, k!])
        for (const y of [-k!, k!])
          expect(
            vertices.some((t) =>
              [x, y, z].every(
                (v, i) => Math.abs(v! - t.boundingBox!.low[i]!) < 1e-5,
              ),
            ),
          ).toBe(true);
    assertLoftInterior(ordinary, 5, 1.5);
    for (const count of [1, 3, 5]) {
      const result = await w.execute({
        operation: "loft.update",
        featureId,
        parameters: {
          participants: [w.profiles, w.path],
          options: {
            path: {
              sectionCount:
                count === 3 ? { source: "expression", valueText: "3" } : count,
            },
          },
        },
        intent: "fulfill",
      });
      expect(
        result.discovery!.model!.features.find((f) => f.kind === "loft")!
          .featureId,
      ).toBe(featureId);
      // Each actual intermediate start-wire copy has half-width 1, NOT the
      // ordinary frustum's 1+z/10. Counts alter the interior, not the caps.
      for (let i = 1; i <= count; i++)
        assertLoftInterior(result, (10 * i) / (count + 1), 1);
      if (count === 1)
        for (const point of loftInterior(result, 7.5)) {
          expect(Math.abs(point[0]!)).toBeGreaterThan(1.1);
          expect(Math.abs(point[0]!)).toBeLessThan(1.6);
        }
    }
    // Removing the path restores the ordinary frustum. Reverse ordinary
    // section order explicitly; shared preparation must not sort the request.
    const reversed = {
      role: "profile",
      targets: [...w.profiles.targets].reverse(),
    };
    const result = await w.execute({
      operation: "loft.update",
      featureId,
      parameters: { participants: [reversed] },
      intent: "fulfill",
    });
    expect(
      result.discovery!.model!.features.find((f) => f.kind === "loft")!
        .featureId,
    ).toBe(featureId);
    assertLoftInterior(result, 5, 1.5);
    expect(
      prepareLoftFeatureDefinition({
        participants: [reversed],
      } as LoftFeatureParameters)!.parameters.participants.find(
        (p) => p.role === "profile",
      )!.targets,
    ).toEqual(reversed.targets);
  } finally {
    expect((await w.close()).kind).toBe("closed");
  }
}, 180000);

test("loft refusals leave state unchanged and missing profiles retain strict failed-editable truth", async () => {
  const w = await loftWorkflow();
  try {
    const good = await w.execute({
      operation: "loft.create",
      parameters: { participants: [w.profiles] },
      intent: "fulfill",
    });
    const featureId = good.discovery!.model!.features.find(
      (f) => f.kind === "loft",
    )!.featureId;
    for (const parameters of [
      {
        participants: [w.profiles, w.path],
        operationIntent: { source: "literal", value: "subtract" },
      },
      { participants: [w.profiles], options: { path: { sectionCount: 2 } } },
      {
        participants: [w.profiles, w.path],
        options: { path: { sectionCount: 0 } },
      },
    ]) {
      const result = await w.run({
        operation: "loft.update",
        featureId,
        parameters,
        intent: "fulfill",
      });
      expect(result.outcome.kind).toBe("rejected");
      expect(result.completion.live.kind).toBe("unchanged");
    }
    const missing = { ...w.profile, regionId: "region_missing" };
    const invalid = {
      participants: [{ role: "profile", targets: [missing, w.face] }],
    };
    const failed = await w.run({
      operation: "loft.update",
      featureId,
      parameters: invalid,
      intent: "fulfill",
    });
    expect(failed.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
    expect(failed.completion.live.kind).toBe("applied");
    expect(failed.completion.persistence.kind).toBe("committed");
    expect(failed.completion.geometry.kind).toBe("failed");
    await w.execute({
      operation: "loft.update",
      featureId,
      parameters: { participants: [w.profiles] },
      intent: "fulfill",
    });
    const editable = await w.run({
      operation: "loft.update",
      featureId,
      parameters: invalid,
      intent: "author-invalid",
    });
    expect(editable.outcome.kind).toBe("accepted-invalid");
    expect(editable.completion.geometry.kind).toBe("invalid-editable");
    await w.execute({
      operation: "loft.update",
      featureId,
      parameters: { participants: [w.profiles] },
      intent: "fulfill",
    });
    await w.execute({ operation: "sketch.open", sketchId: w.profile.sketchId });
    const entityId = w.current().discovery!.sketch!.entities[0]!.entityId;
    await w.execute({
      operation: "sketch.geometry.delete",
      draft: w.current().discovery!.state.draft,
      targets: [
        { kind: "sketchEntity", sketchId: w.profile.sketchId, entityId },
      ],
      intent: "fulfill",
    });
    const published = await w.run({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: false,
    });
    expect(
      published.discovery!.references.some(
        (r) => JSON.stringify(r.target) === JSON.stringify(w.profile),
      ),
    ).toBe(false);
    const stale = await w.run({
      operation: "loft.update",
      featureId,
      parameters: { participants: [w.profiles] },
      intent: "fulfill",
    });
    expect(stale.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
    expect(stale.completion.live.kind).toBe("applied");
    expect(stale.completion.persistence.kind).toBe("committed");
    expect(stale.completion.geometry.kind).toBe("failed");
    expect(
      stale.discovery!.model!.bodies.every((b) => b.topology === null),
    ).toBe(true);
  } finally {
    expect((await w.close()).kind).toBe("closed");
  }
}, 180000);

test("ordinary loft consumes three ordered current sections while path loft refuses a third profile", async () => {
  const w = await loftWorkflow();
  try {
    const plane = await w.execute({
      operation: "plane.create",
      parameters: {
        mode: "explicitFrame",
        frame: {
          origin: [0, 0, 5],
          xAxis: [1, 0, 0],
          yAxis: [0, 1, 0],
          normal: [0, 0, 1],
          linearUnit: "documentLength",
          handedness: "rightHanded",
        },
      },
      intent: "fulfill",
    });
    const construction = plane.discovery!.model!.constructions!.find(
      (c) => c.ownerFeatureId !== null,
    )!;
    await w.execute({
      operation: "sketch.begin",
      support: {
        kind: "construction",
        constructionId: construction.constructionId,
      },
    });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [-0.5, -0.5], end: [0.5, 0.5] },
      construction: false,
      intent: "fulfill",
    });
    const middle = (
      await w.execute({
        operation: "sketch.publish",
        draft: w.current().discovery!.state.draft,
        requireProfiles: true,
      })
    ).discovery!.sketch!;
    const participants = [
      {
        role: "profile",
        targets: [
          w.profile,
          {
            kind: "region",
            sketchId: middle.sketchId!,
            regionId: middle.profiles[0]!.regionId,
          },
          w.face,
        ],
      },
    ];
    const result = await w.execute({
      operation: "loft.create",
      parameters: { participants },
      intent: "fulfill",
    });
    assertLoftInterior(result, 5, 0.5);
    const featureId = result.discovery!.model!.features.find(
      (f) => f.kind === "loft",
    )!.featureId;
    const refused = await w.run({
      operation: "loft.update",
      featureId,
      parameters: { participants: [...participants, w.path] },
      intent: "fulfill",
    });
    expect(refused.outcome.kind).toBe("rejected");
    expect(refused.completion.live.kind).toBe("unchanged");
  } finally {
    expect((await w.close()).kind).toBe("closed");
  }
}, 180000);

test("native loft refuses current curved solid edges and current regions with inner loops", async () => {
  const w = await loftWorkflow();
  try {
    const filleted = await w.execute({
      operation: "fillet.create",
      parameters: {
        edgeTargets: [w.edge],
        radius: { source: "literal", value: 0.5 },
      },
      intent: "fulfill",
    });
    const tool = filleted.discovery!.model!.bodies[0]!;
    const curve = tool.topology!.find(
      (t) => t.entityClass === "edge" && t.geometryType === "circle",
    )!.reference;
    const top = tool.topology!.find(
      (t) =>
        t.entityClass === "face" &&
        t.geometryType === "plane" &&
        Math.abs(t.boundingBox!.low[2] - 10) < 1e-5 &&
        Math.abs(t.boundingBox!.high[2] - 10) < 1e-5,
    )!.reference;
    const curved = await w.run({
      operation: "loft.create",
      parameters: {
        participants: [
          { role: "profile", targets: [w.profile, top] },
          { role: "path", targets: [curve] },
        ],
      },
      intent: "fulfill",
    });
    expect(curved.outcome.kind, JSON.stringify(curved)).toBe("rejected");
    expect(curved.completion.live.kind).toBe("unchanged");
    await w.execute({ operation: "sketch.open", sketchId: w.profile.sketchId });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 0.25 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    const region = published.discovery!.references.find(
      (r) =>
        r.target.kind === "region" &&
        r.target.sketchId === w.profile.sketchId &&
        r.label === "Outer region",
    )!.target;
    expect(sketch.profiles.length).toBeGreaterThan(0);
    const inner = await w.run({
      operation: "loft.create",
      parameters: {
        participants: [{ role: "profile", targets: [region, top] }],
      },
      intent: "fulfill",
    });
    expect(inner.outcome.kind, JSON.stringify(inner)).toBe("rejected");
    expect(inner.completion.live.kind).toBe("unchanged");
    expect(
      inner.diagnostics.some((d) => d.message.includes("inner loops")),
    ).toBe(true);
  } finally {
    expect((await w.close()).kind).toBe("closed");
  }
}, 180000);
