import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";
import type {
  HoleFeatureParameters,
  HoleStyle,
} from "@/contracts/modeling/advanced-solid";
import { prepareHoleFeatureDefinition } from "@/core/feature-authoring/features/hole";

async function holeWorkflow(reverse = false, sheet = false) {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "point", position: [10, 5] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = published.discovery!.sketch!;
    let location = {
      kind: "sketchPoint" as const,
      sketchId: sketch.sketchId!,
      pointId: sketch.points.find(
        (p) => p.position[0] === 10 && p.position[1] === 5,
      )!.pointId,
    };
    const profile = {
      kind: "region",
      sketchId: sketch.sketchId,
      regionId: sketch.profiles[0]!.regionId,
    };
    const extruded = await w.execute(
      sheet
        ? {
            operation: "extrude.create",
            intent: "fulfill",
            parameters: {
              resultBodyType: "surface",
              profiles: [profile],
              startExtent: { kind: "profilePlane" },
              extent: {
                mode: "oneSide",
                end: {
                  kind: "blind",
                  distance: { source: "literal", value: 10 },
                  direction: "positive",
                },
              },
            },
          }
        : {
            operation: "extrude.create",
            profile,
            depth: 10,
            intent: "fulfill",
          },
    );
    const body = {
      kind: "body" as const,
      bodyId: extruded.discovery!.model!.bodies[0]!.bodyId,
    };
    if (reverse) {
      const frame = extruded.discovery!.model!.constructions!.find(
        (c) => c.constructionId === "construction_plane-xy",
      )!.frame;
      const plane = await w.execute({
        operation: "plane.create",
        parameters: {
          mode: "explicitFrame",
          frame: { ...frame, origin: [0, 0, 10] },
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
        primitive: { kind: "point", position: [10, 5] },
        construction: false,
        intent: "fulfill",
      });
      const top = await w.execute({
        operation: "sketch.publish",
        draft: w.current().discovery!.state.draft,
        requireProfiles: false,
      });
      location = {
        kind: "sketchPoint",
        sketchId: top.discovery!.sketch!.sketchId!,
        pointId: top.discovery!.sketch!.points[0]!.pointId,
      };
    }
    return {
      ...w,
      participants: [
        { role: "location", targets: [location] },
        { role: "body", targets: [body] },
      ] as const,
    };
  } catch (error) {
    await w.close();
    throw error;
  }
}
function options(
  style: HoleStyle,
  termination: "blind" | "throughAll",
  direction: "forward" | "reverse",
): HoleFeatureParameters["options"] {
  const base = {
    mainDiameter: 2,
    direction,
    ...(termination === "blind"
      ? { termination: "blind" as const, depth: 6 }
      : { termination: "throughAll" as const }),
  };
  return style === "counterbore"
    ? { ...base, style, counterboreDiameter: 4, counterboreDepth: 2 }
    : style === "countersink"
      ? { ...base, style, countersinkDiameter: 6, countersinkAngleDegrees: 90 }
      : { ...base, style };
}
function topology(result: SemanticResult) {
  return result.discovery!.model!.bodies[0]!.topology!;
}
function assertCylinder(
  result: SemanticResult,
  radius: number,
  low: number,
  high: number,
) {
  const surface = topology(result).find(
    (t) =>
      t.entityClass === "face" &&
      t.geometryType === "cylinder" &&
      Math.abs(Number(t.definingData?.radius) - radius) < 1e-5,
  )!;
  expect(surface, JSON.stringify(topology(result))).toBeDefined();
  expect(surface.boundingBox!.low[2]).toBeCloseTo(low, 5);
  expect(surface.boundingBox!.high[2]).toBeCloseTo(high, 5);
  const origin = surface.definingData!.axisOrigin as number[];
  expect(origin[0]).toBeCloseTo(10, 5);
  expect(origin[1]).toBeCloseTo(5, 5);
  expect(result.completion.geometry.kind).toBe("current");
  expect(result.completion.persistence.kind).toBe("committed");
}

test("shared hole preparation preserves style/termination values and refuses lossy variants and roles", () => {
  const participants = [
    {
      role: "location",
      targets: [
        {
          kind: "sketchPoint",
          sketchId: "sketch_locations",
          pointId: "sketch_point_center",
        },
      ],
    },
    { role: "body", targets: [{ kind: "body", bodyId: "body_part" }] },
  ] as const;
  for (const style of ["simple", "counterbore", "countersink"] as const)
    for (const termination of ["blind", "throughAll"] as const) {
      const value = options(style, termination, "reverse");
      const definition = prepareHoleFeatureDefinition({
        participants,
        options: value,
      })!;
      expect(definition.parameters.participants).toEqual(participants);
      expect(definition.parameters.options).toEqual(
        Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            { source: "literal", value: v },
          ]),
        ),
      );
    }
  const value = options("simple", "throughAll", "forward");
  for (const patch of [
    { style: { source: "expression", valueText: "variant" } },
    { termination: { source: "expression", valueText: "variant" } },
    { direction: { source: "expression", valueText: "variant" } },
    { depth: 3 },
  ])
    expect(
      prepareHoleFeatureDefinition({
        participants,
        options: { ...value, ...patch },
      } as never),
    ).toBeNull();
  expect(
    prepareHoleFeatureDefinition({
      participants: [...participants, { role: "path", targets: [] }],
      options: value,
    } as never),
  ).toBeNull();
});

test("production holes preserve exact cylindrical/conical geometry through style, direction and termination updates", async () => {
  for (const reverse of [false, true]) {
    const w = await holeWorkflow(reverse);
    try {
      let featureId: string | undefined;
      for (const style of ["simple", "counterbore", "countersink"] as const)
        for (const termination of ["blind", "throughAll"] as const) {
          const parameters = {
            participants: w.participants,
            options: options(
              style,
              termination,
              reverse ? "reverse" : "forward",
            ),
          };
          const result = await w.execute({
            operation: featureId ? "hole.update" : "hole.create",
            ...(featureId ? { featureId } : {}),
            parameters,
            intent: "fulfill",
          });
          const feature = result.discovery!.model!.features.find(
            (f) => f.kind === "hole",
          )!;
          if (featureId) expect(feature.featureId).toBe(featureId);
          else featureId = feature.featureId;
          const entry = style === "simple" ? 0 : 2;
          const end = termination === "blind" ? 6 : 10;
          assertCylinder(
            result,
            1,
            reverse ? 10 - end : entry,
            reverse ? 10 - entry : end,
          );
          if (style === "counterbore")
            assertCylinder(result, 2, reverse ? 8 : 0, reverse ? 10 : 2);
          if (style === "countersink") {
            const cone = topology(result).find(
              (t) => t.entityClass === "face" && t.geometryType === "cone",
            )!;
            expect(cone).toBeDefined();
            expect(
              Math.abs(
                Math.abs(Number(cone.definingData!.semiAngleRadians)) -
                  Math.PI / 4,
              ),
            ).toBeLessThanOrEqual(0.0001);
            expect(cone.boundingBox!.low[2]).toBeCloseTo(reverse ? 8 : 0, 5);
            expect(cone.boundingBox!.high[2]).toBeCloseTo(reverse ? 10 : 2, 5);
            expect(
              cone.boundingBox!.high[0] - cone.boundingBox!.low[0],
            ).toBeCloseTo(6, 3);
          }
          if (termination === "blind")
            expect(
              topology(result).some(
                (t) =>
                  t.entityClass === "face" &&
                  t.geometryType === "plane" &&
                  Math.abs(t.boundingBox!.low[2] - (reverse ? 4 : 6)) < 1e-5 &&
                  Math.abs(t.boundingBox!.high[2] - (reverse ? 4 : 6)) < 1e-5,
              ),
            ).toBe(true);
        }
      const updated = await w.execute({
        operation: "hole.update",
        featureId,
        parameters: {
          participants: w.participants,
          options: {
            mainDiameter: 4,
            termination: "throughAll",
            direction: reverse ? "reverse" : "forward",
          },
        },
        intent: "fulfill",
      });
      assertCylinder(updated, 2, 0, 10);
    } finally {
      await w.close();
    }
  }
}, 180000);

test("deleting a formerly valid authored hole location cannot certify stale hole geometry", async () => {
  const w = await holeWorkflow();
  try {
    const parameters = {
      participants: w.participants,
      options: { mainDiameter: 2, termination: "throughAll" },
    };
    const created = await w.execute({
      operation: "hole.create",
      parameters,
      intent: "fulfill",
    });
    const featureId = created.discovery!.model!.features.find(
      (f) => f.kind === "hole",
    )!.featureId;
    const location = w.participants[0].targets[0];
    await w.execute({ operation: "sketch.open", sketchId: location.sketchId });
    await w.execute({
      operation: "sketch.geometry.delete",
      draft: w.current().discovery!.state.draft,
      targets: [location],
      intent: "fulfill",
    });
    const published = await w.run({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    expect(
      published.discovery!.references.some(
        (r) => JSON.stringify(r.target) === JSON.stringify(location),
      ),
    ).toBe(false);
    const stale = await w.run({
      operation: "hole.update",
      featureId,
      parameters,
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
    await w.close();
  }
}, 180000);

test("hole refusal and invalid-editable results preserve actual mutation/output truth", async () => {
  const w = await holeWorkflow();
  try {
    const before = w.current().completion.live.state;
    for (const value of [
      { mainDiameter: 0, termination: "blind", depth: 6 },
      { mainDiameter: -1, termination: "throughAll" },
      {
        style: "counterbore",
        mainDiameter: 2,
        counterboreDiameter: 1,
        counterboreDepth: 2,
        termination: "blind",
        depth: 6,
      },
      {
        style: "countersink",
        mainDiameter: 2,
        countersinkDiameter: 6,
        countersinkAngleDegrees: 180,
        termination: "blind",
        depth: 6,
      },
    ]) {
      const result = await w.run({
        operation: "hole.create",
        parameters: { participants: w.participants, options: value },
        intent: "fulfill",
      });
      expect(result.outcome.kind).toBe("rejected");
      expect(result.completion.live.state).toEqual(before);
    }
    const parameters = {
      participants: [
        {
          role: "location",
          targets: [
            {
              kind: "sketchPoint",
              sketchId: "sketch_missing",
              pointId: "sketch_point_missing",
            },
          ],
        },
        w.participants[1],
      ],
      options: { mainDiameter: 2, termination: "throughAll" },
    };
    const missing = await w.run({
      operation: "hole.create",
      parameters,
      intent: "fulfill",
    });
    expect(missing.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
    expect(missing.completion.live.kind).toBe("applied");
    expect(missing.completion.persistence.kind).toBe("committed");
    const featureId = missing.discovery!.model!.features.find(
      (f) => f.kind === "hole",
    )!.featureId;
    const repaired = await w.execute({
      operation: "hole.update",
      featureId,
      parameters: { ...parameters, participants: w.participants },
      intent: "fulfill",
    });
    assertCylinder(repaired, 1, 0, 10);
    const invalid = await w.run({
      operation: "hole.update",
      featureId,
      parameters,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("accepted-invalid");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
  } finally {
    await w.close();
  }
  const sheet = await holeWorkflow(false, true);
  try {
    const before = sheet.current().completion.live.state;
    const rejected = await sheet.run({
      operation: "hole.create",
      parameters: {
        participants: sheet.participants,
        options: { mainDiameter: 2, termination: "throughAll" },
      },
      intent: "fulfill",
    });
    expect(rejected.outcome.kind).toBe("rejected");
    expect(rejected.completion.live.state).toEqual(before);
  } finally {
    await sheet.close();
  }
}, 180000);
