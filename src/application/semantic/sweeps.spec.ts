import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";
import type { SweepFeatureParameters } from "@/contracts/modeling/advanced-solid";
import { prepareSweepFeatureDefinition } from "@/core/feature-authoring/features/sweep";

async function sweepWorkflow() {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [-1, -0.5], end: [1, 0.5] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const s = published.discovery!.sketch!;
    const profile = {
      kind: "region" as const,
      sketchId: s.sketchId!,
      regionId: s.profiles[0]!.regionId,
    };
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 0], end: [1, 1] },
      construction: false,
      intent: "fulfill",
    });
    const base = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const t = base.discovery!.sketch!;
    const solid = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: t.sketchId,
        regionId: t.profiles[0]!.regionId,
      },
      depth: 10,
      intent: "fulfill",
    });
    const tool = solid.discovery!.model!.bodies[0]!;
    const edge = tool.topology!.find(
      (t) =>
        t.entityClass === "edge" &&
        t.boundingBox &&
        Math.abs(t.boundingBox.low[0]) < 1e-5 &&
        Math.abs(t.boundingBox.high[0]) < 1e-5 &&
        Math.abs(t.boundingBox.low[1]) < 1e-5 &&
        Math.abs(t.boundingBox.high[1]) < 1e-5 &&
        t.boundingBox.high[2] - t.boundingBox.low[2] > 9.99,
    )!.reference;
    expect(edge.kind).toBe("edge");
    const face = tool.topology!.find(
      (t) =>
        t.entityClass === "face" &&
        t.geometryType === "plane" &&
        Math.abs((t.definingData!.normal as number[])[2]!) > 0.99,
    )!.reference;
    expect(face.kind).toBe("face");
    const participants = [
      { role: "profile", targets: [profile] },
      { role: "path", targets: [edge] },
    ] as SweepFeatureParameters["participants"];
    return { ...w, participants, edge, face, toolId: tool.bodyId };
  } catch (error) {
    await w.close();
    throw error;
  }
}

function produced(result: SemanticResult) {
  const model = result.discovery!.model!;
  const feature = model.features.find((f) => f.kind === "sweep")!;
  const body = feature.producedTargets.find((t) => t.kind === "body")!;
  if (body.kind !== "body") throw new Error("Sweep did not produce a body");
  return model.bodies.find((b) => b.bodyId === body.bodyId)!;
}
function assertEndVertices(
  result: SemanticResult,
  angle: number,
  scale: number,
) {
  const body = produced(result);
  const vertices = body.topology!.filter((t) => t.entityClass === "vertex");
  // Independent rectangle corners transformed about the selected path axis.
  // Inspect the produced body, never the retained path-tool box.
  for (const z of [0, 10])
    for (const x of [-1, 1])
      for (const y of [-0.5, 0.5]) {
        const a = z === 0 ? 0 : angle;
        const k = z === 0 ? 1 : scale;
        const expected = [
          k * (x * Math.cos(a) - y * Math.sin(a)),
          k * (x * Math.sin(a) + y * Math.cos(a)),
          z,
        ];
        expect(
          vertices.some(
            (t) =>
              t.boundingBox &&
              expected.every(
                (v, i) => Math.abs(t.boundingBox!.low[i]! - v) < 1e-5,
              ),
          ),
          JSON.stringify({ expected, vertices }),
        ).toBe(true);
      }
  expect(vertices).toHaveLength(8);
  expect(result.completion.geometry.kind).toBe("current");
  expect(result.completion.persistence.kind).toBe("committed");
}
const defaults: SweepFeatureParameters["options"] = {
  profileControl: "none",
  twist: { type: "none" },
  endScale: 1,
};

test("shared sweep preparation preserves canonical controls and refuses lossy hydration", () => {
  const participants = [
    {
      role: "profile",
      targets: [
        {
          kind: "region",
          sketchId: "sketch_profile",
          regionId: "region_profile",
        },
      ],
    },
    {
      role: "path",
      targets: [{ kind: "edge", bodyId: "body_tool", edgeId: "edge_path" }],
    },
  ] as const;
  const definition = prepareSweepFeatureDefinition({
    participants,
    options: {
      ...defaults,
      twist: {
        type: "angle",
        angle: { source: "literal", value: Math.PI / 6 },
      },
    },
  })!;
  expect(definition.parameters.options).toEqual({
    profileControl: { source: "literal", value: "none" },
    twist: { type: "angle", angle: { source: "literal", value: Math.PI / 6 } },
    endScale: { source: "literal", value: 1 },
  });
  for (const parameters of [
    { participants, options: { ...defaults, profileControl: "bogus" } },
    {
      participants,
      options: {
        ...defaults,
        profileControl: { source: "expression", valueText: "control" },
      },
    },
    { participants, options: { ...defaults, twist: { type: "bogus" } } },
    { participants: [...participants, participants[1]], options: defaults },
    {
      participants: [...participants, { role: "unknown", targets: [] }],
      options: defaults,
    },
    {
      participants: [
        participants[0],
        {
          role: "path",
          targets: [...participants[1].targets, ...participants[1].targets],
        },
      ],
      options: defaults,
    },
    {
      participants: [
        ...participants,
        { role: "lockProfileDirection", targets: participants[1].targets },
      ],
      options: defaults,
    },
  ])
    expect(prepareSweepFeatureDefinition(parameters as never)).toBeNull();
});

test("production sweep updates use endpoint twist/scale geometry and actual supported profile controls", async () => {
  const w = await sweepWorkflow();
  try {
    let featureId: string | undefined;
    const variants: {
      options: SweepFeatureParameters["options"];
      angle: number;
      scale: number;
      lock?: "face" | "direction";
    }[] = [
      { options: defaults, angle: 0, scale: 1 },
      {
        options: { ...defaults, twist: { type: "angle", angle: Math.PI / 6 } },
        angle: Math.PI / 6,
        scale: 1,
      },
      {
        options: { ...defaults, twist: { type: "turns", turns: 1 / 12 } },
        angle: Math.PI / 6,
        scale: 1,
      },
      {
        options: { ...defaults, twist: { type: "pitch", pitch: 120 } },
        angle: Math.PI / 6,
        scale: 1,
      },
      { options: { ...defaults, endScale: 2 }, angle: 0, scale: 2 },
      {
        options: {
          ...defaults,
          endScale: { source: "expression", valueText: "2" },
          twist: {
            type: "angle",
            angle: { source: "expression", valueText: "pi / 6" },
          },
        },
        angle: Math.PI / 6,
        scale: 2,
      },
      {
        options: {
          ...defaults,
          endScale: 1.5,
          twist: { type: "angle", angle: -Math.PI / 6 },
        },
        angle: -Math.PI / 6,
        scale: 1.5,
      },
      {
        options: { ...defaults, profileControl: "lockProfileDirection" },
        angle: 0,
        scale: 1,
        lock: "direction",
      },
      {
        options: { ...defaults, profileControl: "lockProfileFaces" },
        angle: 0,
        scale: 1,
        lock: "face",
      },
    ];
    for (const v of variants) {
      const participants = [
        ...w.participants,
        ...(v.lock
          ? [
              {
                role:
                  v.lock === "face"
                    ? "lockProfileFace"
                    : "lockProfileDirection",
                targets: [v.lock === "face" ? w.face : w.edge],
              },
            ]
          : []),
      ];
      const result = await w.execute({
        operation: featureId ? "sweep.update" : "sweep.create",
        ...(featureId ? { featureId } : {}),
        parameters: { participants, options: v.options },
        intent: "fulfill",
      });
      const feature = result.discovery!.model!.features.find(
        (f) => f.kind === "sweep",
      )!;
      if (featureId) expect(feature.featureId).toBe(featureId);
      featureId = feature.featureId;
      expect(produced(result).bodyId).not.toBe(w.toolId);
      assertEndVertices(result, v.angle, v.scale);
    }
  } finally {
    expect((await w.close()).kind).toBe("closed");
  }
}, 180000);

test("curved sketch paths independently expose native orientation behavior", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [-1, -0.5], end: [1, 0.5] },
      construction: false,
      intent: "fulfill",
    });
    const profileResult = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const s = profileResult.discovery!.sketch!;
    const profile = {
      kind: "region",
      sketchId: s.sketchId!,
      regionId: s.profiles[0]!.regionId,
    };
    await w.execute({ operation: "sketch.begin", plane: "yz" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: {
        kind: "threePointArc",
        points: [
          [0, 0],
          [10 - Math.sqrt(50), Math.sqrt(50)],
          [10, 10],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const pathResult = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: false,
    });
    const ps = pathResult.discovery!.sketch!;
    const path = {
      kind: "sketchEntity",
      sketchId: ps.sketchId!,
      entityId: ps.entities.find((e) => e.kind === "arc")!.entityId,
    };
    // A diagonal fixed binormal differs from the default planar Frenet frame.
    // Use an actual construction and an actual planar solid face with that normal.
    const q = Math.SQRT1_2;
    const plane = await w.execute({
      operation: "plane.create",
      parameters: {
        mode: "explicitFrame",
        frame: {
          origin: [30, 30, 30],
          xAxis: [0, 1, 0],
          yAxis: [-q, 0, q],
          normal: [q, 0, q],
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
      primitive: { kind: "rectangle", start: [0, 0], end: [2, 1] },
      construction: false,
      intent: "fulfill",
    });
    const lockProfile = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const ls = lockProfile.discovery!.sketch!;
    const lockSolid = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: ls.sketchId!,
        regionId: ls.profiles[0]!.regionId,
      },
      depth: 1,
      intent: "fulfill",
    });
    const lockFace = lockSolid.discovery!.model!.bodies[0]!.topology!.find(
      (t) =>
        t.entityClass === "face" &&
        t.geometryType === "plane" &&
        Math.abs(Math.abs((t.definingData!.normal as number[])[0]!) - q) <
          1e-5 &&
        Math.abs(Math.abs((t.definingData!.normal as number[])[2]!) - q) <
          1e-5 &&
        (t.definingData!.normal as number[])[0]! *
          (t.definingData!.normal as number[])[2]! >
          0.49,
    )!.reference;
    let featureId: string | undefined;
    for (const control of [
      "none",
      "lockProfileDirection",
      "lockProfileFaces",
      "keepProfileOrientation",
    ] as const) {
      const before = w.current().completion.live.state;
      if (control === "keepProfileOrientation") {
        const refused = await w.run({
          operation: "sweep.update",
          featureId,
          parameters: {
            participants: [
              { role: "profile", targets: [profile] },
              { role: "path", targets: [path] },
            ],
            options: { ...defaults, profileControl: control },
          },
          intent: "fulfill",
        });
        expect(refused.outcome.kind).toBe("rejected");
        expect(refused.completion.live).toEqual({
          kind: "unchanged",
          state: before,
        });
        continue;
      }
      const result = await w.execute({
        operation: featureId ? "sweep.update" : "sweep.create",
        ...(featureId ? { featureId } : {}),
        parameters: {
          participants: [
            { role: "profile", targets: [profile] },
            { role: "path", targets: [path] },
            ...(control === "lockProfileDirection"
              ? [
                  {
                    role: "lockProfileDirection",
                    targets: [
                      {
                        kind: "construction",
                        constructionId: construction.constructionId,
                      },
                    ],
                  },
                ]
              : control === "lockProfileFaces"
                ? [{ role: "lockProfileFace", targets: [lockFace] }]
                : []),
          ],
          options: { ...defaults, profileControl: control },
        },
        intent: "fulfill",
      });
      featureId = result.discovery!.model!.features.find(
        (f) => f.kind === "sweep",
      )!.featureId;
      const vertices = produced(result).topology!.filter(
        (t) => t.entityClass === "vertex",
      );
      for (const x of [-1, 1])
        for (const y of [-0.5, 0.5]) {
          // The locked native trihedron keeps the supplied diagonal binormal:
          // a -90° rotation about [q,0,q], not re-projection onto the tangent plane.
          const expected =
            control === "none"
              ? [x, 10, 10 + y]
              : [x / 2 + y * q, 10 - x * q, 10 + x / 2 - y * q];
          expect(
            vertices.some((t) =>
              expected.every(
                (v, i) => Math.abs(t.boundingBox!.low[i]! - v) < 1e-5,
              ),
            ),
            JSON.stringify({ control, expected, vertices }),
          ).toBe(true);
        }
    }
  } finally {
    await w.close();
  }
}, 180000);

test("ordinary sketch-entity sweeps use exact paths and advanced controls refuse non-durable paths", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [-1, -0.5], end: [1, 0.5] },
      construction: false,
      intent: "fulfill",
    });
    const profileResult = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = profileResult.discovery!.sketch!;
    const profile = {
      kind: "region",
      sketchId: sketch.sketchId!,
      regionId: sketch.profiles[0]!.regionId,
    };
    await w.execute({ operation: "sketch.begin", plane: "yz" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [0, 10] },
      construction: false,
      intent: "fulfill",
    });
    const pathResult = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: false,
    });
    const pathSketch = pathResult.discovery!.sketch!;
    const path = {
      kind: "sketchEntity",
      sketchId: pathSketch.sketchId!,
      entityId: pathSketch.entities[0]!.entityId,
    };
    const participants = [
      { role: "profile", targets: [profile] },
      { role: "path", targets: [path] },
    ];
    const ordinary = await w.execute({
      operation: "sweep.create",
      parameters: { participants, options: defaults },
      intent: "fulfill",
    });
    assertEndVertices(ordinary, 0, 1);
    const featureId = ordinary.discovery!.model!.features.find(
      (f) => f.kind === "sweep",
    )!.featureId;
    for (const options of [
      { ...defaults, endScale: 2 },
      { ...defaults, twist: { type: "angle", angle: Math.PI / 6 } },
    ]) {
      const before = w.current().completion.live.state;
      const refused = await w.run({
        operation: "sweep.update",
        featureId,
        parameters: { participants, options },
        intent: "fulfill",
      });
      expect(refused.outcome.kind, JSON.stringify(refused)).toBe("rejected");
      expect(refused.completion.live).toEqual({
        kind: "unchanged",
        state: before,
      });
    }
    const missingProfile = await w.run({
      operation: "sweep.update",
      featureId,
      parameters: {
        participants: [
          {
            role: "profile",
            targets: [{ ...profile, regionId: "region_missing" }],
          },
          participants[1],
        ],
        options: defaults,
      },
      intent: "fulfill",
    });
    expect(missingProfile.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(missingProfile.completion.live.kind).toBe("applied");
    expect(missingProfile.completion.persistence.kind).toBe("committed");
  } finally {
    await w.close();
  }
}, 180000);

test("sweep unsupported inputs stay unchanged and missing current path produces truthful failed-editable output", async () => {
  const w = await sweepWorkflow();
  try {
    for (const parameters of [
      {
        participants: [
          ...w.participants,
          { role: "guideCurve", targets: [w.edge] },
        ],
        options: defaults,
      },
      {
        participants: [
          ...w.participants,
          { role: "targetBody", targets: [{ kind: "body", bodyId: w.toolId }] },
        ],
        options: defaults,
        operationIntent: { source: "literal", value: "add" },
      },
      {
        participants: [
          ...w.participants,
          { role: "lockProfileDirection", targets: [w.edge] },
        ],
        options: {
          ...defaults,
          profileControl: "lockProfileDirection",
          endScale: 2,
        },
      },
      { participants: w.participants, options: { ...defaults, endScale: 0 } },
    ]) {
      const before = w.current().completion.live.state;
      const result = await w.run({
        operation: "sweep.create",
        parameters,
        intent: "fulfill",
      });
      expect(result.outcome.kind, JSON.stringify(result)).toBe("rejected");
      expect(result.completion.live).toEqual({
        kind: "unchanged",
        state: before,
      });
    }
    const good = await w.execute({
      operation: "sweep.create",
      parameters: { participants: w.participants, options: defaults },
      intent: "fulfill",
    });
    const featureId = good.discovery!.model!.features.find(
      (f) => f.kind === "sweep",
    )!.featureId;
    const participants = [
      w.participants[0],
      {
        role: "path",
        targets: [{ kind: "edge", bodyId: w.toolId, edgeId: "edge_missing" }],
      },
    ];
    const bad = await w.run({
      operation: "sweep.update",
      featureId,
      parameters: { participants, options: defaults },
      intent: "fulfill",
    });
    expect(bad.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
    expect(bad.completion.live.kind).toBe("applied");
    expect(bad.completion.persistence.kind).toBe("committed");
    expect(bad.completion.geometry.kind).toBe("failed");
    const repaired = await w.execute({
      operation: "sweep.update",
      featureId,
      parameters: { participants: w.participants, options: defaults },
      intent: "fulfill",
    });
    assertEndVertices(repaired, 0, 1);
    const invalid = await w.run({
      operation: "sweep.update",
      featureId,
      parameters: { participants, options: defaults },
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("accepted-invalid");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
  } finally {
    await w.close();
  }
}, 180000);
