import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { prepareMirrorFeatureDefinition } from "@/core/feature-authoring/features/mirror";
import { prepareTransformFeatureDefinition } from "@/core/feature-authoring/features/transform";
import { prepareLinearPatternFeatureDefinition } from "@/core/feature-authoring/features/linear-pattern";
import { prepareCircularPatternFeatureDefinition } from "@/core/feature-authoring/features/circular-pattern";

const xy = {
  kind: "construction",
  constructionId: "construction_plane-xy",
} as const;
const yz = {
  kind: "construction",
  constructionId: "construction_plane-yz",
} as const;
const seed = { kind: "body", bodyId: "body_seed" } as const;
const bodyParticipants = [{ role: "body", targets: [seed] }] as const;

test("shared body preparation preserves supported inputs and refuses hydration losses", () => {
  const mirror = {
    participants: [...bodyParticipants, { role: "plane", targets: [yz] }],
    options: { copy: true },
  } as const;
  expect(prepareMirrorFeatureDefinition(mirror)).not.toBeNull();
  const merged = prepareMirrorFeatureDefinition({
    ...mirror,
    participants: [
      ...mirror.participants,
      { role: "targetBody", targets: [seed] },
    ],
    operationIntent: { source: "literal", value: "add" },
  });
  expect(merged!.parameters.operationIntent).toEqual({
    source: "literal",
    value: "add",
  });
  expect(
    merged!.parameters.participants.find((p) => p.role === "targetBody")!
      .targets,
  ).toEqual([seed]);
  expect(
    prepareMirrorFeatureDefinition({ ...mirror, options: { copy: false } }),
  ).toBeNull();
  expect(
    prepareMirrorFeatureDefinition({
      ...mirror,
      participants: [
        ...mirror.participants,
        { role: "targetBody", targets: [seed] },
      ],
    }),
  ).toBeNull();
  const vector = {
    participants: bodyParticipants,
    options: { vector: [1, 2, 3] },
  } as const;
  expect(prepareTransformFeatureDefinition(vector)!.parameters.options).toEqual(
    vector.options,
  );
  for (const v of [
    [0, 0, 0],
    [1, Infinity, 0],
  ] as const)
    expect(
      prepareTransformFeatureDefinition({ ...vector, options: { vector: v } }),
    ).toBeNull();
  expect(
    prepareTransformFeatureDefinition({
      ...vector,
      participants: [
        ...bodyParticipants,
        { role: "transformReference", targets: [xy] },
      ],
    }),
  ).toBeNull();
  const linear = {
    participants: [...bodyParticipants, { role: "direction", targets: [yz] }],
    options: { instanceCount: 3, spacing: 7, oppositeDirection: true },
  } as const;
  const circular = {
    participants: [...bodyParticipants, { role: "axis", targets: [xy] }],
    options: {
      instanceCount: 3,
      angleDegrees: 180,
      equalSpace: true,
      oppositeDirection: false,
    },
  } as const;
  for (const [definition, options] of [
    [prepareLinearPatternFeatureDefinition(linear), linear.options],
    [prepareCircularPatternFeatureDefinition(circular), circular.options],
  ] as const)
    expect(definition!.parameters.options).toEqual(
      Object.fromEntries(
        Object.entries(options).map(([k, value]) => [
          k,
          { source: "literal", value },
        ]),
      ),
    );
  expect(
    prepareLinearPatternFeatureDefinition({
      ...linear,
      participants: [...linear.participants, linear.participants[0]],
    }),
  ).toBeNull();
  expect(
    prepareCircularPatternFeatureDefinition({
      ...circular,
      participants: [
        { role: "body", targets: [seed, seed] },
        circular.participants[1],
      ],
    }),
  ).toBeNull();
});

async function box() {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [0, 1], end: [2, 4] },
      construction: false,
      intent: "fulfill",
    });
    const p = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const s = p.discovery!.sketch!;
    const r = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: s.sketchId!,
        regionId: s.profiles[0]!.regionId,
      },
      depth: 5,
      intent: "fulfill",
    });
    const target = r.discovery!.model!.features.at(-1)!.producedTargets[0]!;
    if (target.kind !== "body") throw new Error("Expected solid seed");
    return { ...w, target, body: { role: "body", targets: [target] } };
  } catch (error) {
    await w.close();
    throw error;
  }
}
function outputs(r: SemanticResult) {
  const m = r.discovery!.model!;
  const ids = m.features.at(-1)!.producedTargets;
  return m.bodies.filter((b) =>
    ids.some((t) => t.kind === "body" && t.bodyId === b.bodyId),
  );
}
function vertices(
  b: NonNullable<
    NonNullable<SemanticResult["discovery"]>["model"]
  >["bodies"][number],
  transform: (p: number[]) => number[],
) {
  const actual = b.topology!.filter((t) => t.entityClass === "vertex");
  expect(actual).toHaveLength(8);
  for (const x of [0, 2])
    for (const y of [1, 4])
      for (const z of [0, 5]) {
        const expected = transform([x, y, z]);
        expect(
          actual.some((t) =>
            expected.every(
              (v, i) => Math.abs(t.boundingBox!.low[i]! - v) < 1e-5,
            ),
          ),
          JSON.stringify({ expected, actual }),
        ).toBe(true);
      }
}
async function remove(w: Awaited<ReturnType<typeof box>>) {
  const f = w.current().discovery!.model!.features.at(-1)!;
  await w.execute({
    operation: "feature.delete",
    featureId: f.featureId,
    intent: "fulfill",
  });
}

test("native mirrors copy or merge the exact seed and update plane references without losing identity", async () => {
  const w = await box();
  try {
    const parameters = {
      participants: [w.body, { role: "plane", targets: [yz] }],
      options: { copy: true },
    };
    const copy = await w.execute({
      operation: "mirror.create",
      parameters,
      intent: "fulfill",
    });
    expect(
      copy.discovery!.model!.capabilities!.supportedFeatureKinds,
    ).toContain("mirror");
    expect(
      copy.discovery!.model!.capabilities!.previewableFeatureKinds,
    ).not.toContain("mirror");
    expect(outputs(copy)).toHaveLength(1);
    expect(outputs(copy)[0]!.bodyId).not.toBe(w.target.bodyId);
    vertices(outputs(copy)[0]!, ([x, y, z]) => [-x!, y!, z!]);
    vertices(
      copy.discovery!.model!.bodies.find((b) => b.bodyId === w.target.bodyId)!,
      (p) => p,
    );
    const featureId = copy.discovery!.model!.features.at(-1)!.featureId;
    const updated = await w.execute({
      operation: "mirror.update",
      featureId,
      parameters: {
        ...parameters,
        participants: [w.body, { role: "plane", targets: [xy] }],
      },
      intent: "fulfill",
    });
    expect(updated.discovery!.model!.features.at(-1)!.featureId).toBe(
      featureId,
    );
    vertices(outputs(updated)[0]!, ([x, y, z]) => [x!, y!, -z!]);
    await remove(w);
    const merge = await w.execute({
      operation: "mirror.create",
      parameters: {
        ...parameters,
        participants: [
          ...parameters.participants,
          { role: "targetBody", targets: [w.target] },
        ],
        operationIntent: { source: "literal", value: "add" },
      },
      intent: "fulfill",
    });
    expect(merge.discovery!.model!.bodies).toHaveLength(1);
    expect(outputs(merge)[0]!.bodyId).toBe(w.target.bodyId);
    expect(outputs(merge)[0]!.bounds).toEqual({
      min: [-2, 1, 0],
      max: [2, 4, 5],
    });
    const face = outputs(merge)[0]!.topology!.filter(
      (t) => t.entityClass === "face",
    );
    expect(face.length).toBeGreaterThanOrEqual(6);
    for (const f of face) {
      expect(f.geometryType).toBe("plane");
      expect(
        [
          [-2, 2],
          [1, 4],
          [0, 5],
        ].some(
          (limits, axis) =>
            Math.abs(f.boundingBox!.low[axis]! - f.boundingBox!.high[axis]!) <
              1e-5 &&
            limits.some((v) => Math.abs(f.boundingBox!.low[axis]! - v) < 1e-5),
        ),
      ).toBe(true);
    }
  } finally {
    await w.close();
  }
}, 180000);

test("native translations and rotations preserve seed identity and exact current geometry", async () => {
  const w = await box();
  try {
    for (const [options, reference, transform] of [
      [
        { vector: [3, -2, 7] },
        null,
        ([x, y, z]: number[]) => [x! + 3, y! - 2, z! + 7],
      ],
      [
        {
          distance: { source: "expression", valueText: "7" },
          direction: "negative",
        },
        { role: "transformReference", targets: [xy] },
        ([x, y, z]: number[]) => [x!, y!, z! - 7],
      ],
      [
        { transformType: "rotation", angle: 90 },
        { role: "axis", targets: [xy] },
        ([x, y, z]: number[]) => [-y!, x!, z!],
      ],
    ] as const) {
      const r = await w.execute({
        operation: "transform.create",
        parameters: {
          participants: [w.body, ...(reference ? [reference] : [])],
          options,
        },
        intent: "fulfill",
      });
      expect(r.discovery!.model!.bodies).toHaveLength(1);
      expect(outputs(r)[0]!.bodyId).toBe(w.target.bodyId);
      vertices(outputs(r)[0]!, transform);
      expect(r.discovery!.model!.capabilities!.supportedFeatureKinds).toContain(
        "transform",
      );
      expect(
        r.discovery!.model!.capabilities!.previewableFeatureKinds,
      ).not.toContain("transform");
      const featureId = r.discovery!.model!.features.at(-1)!.featureId;
      const u = await w.execute({
        operation: "transform.update",
        featureId,
        parameters: { participants: [w.body], options: { vector: [-1, 2, 3] } },
        intent: "fulfill",
      });
      expect(u.discovery!.model!.features.at(-1)!.featureId).toBe(featureId);
      vertices(outputs(u)[0]!, ([x, y, z]) => [x! - 1, y! + 2, z! + 3]);
      await remove(w);
    }
  } finally {
    await w.close();
  }
}, 180000);

test("current planar faces, linear edges and sketch lines drive the same native body operations", async () => {
  const w = await box();
  try {
    const native = w.current().discovery!.model!.bodies[0]!.topology!;
    const top = native.find(
      (t) =>
        t.entityClass === "face" &&
        t.geometryType === "plane" &&
        Math.abs(t.boundingBox!.low[2] - 5) < 1e-5 &&
        Math.abs(t.boundingBox!.high[2] - 5) < 1e-5,
    )!.reference;
    const edge = native.find(
      (t) =>
        t.entityClass === "edge" &&
        t.geometryType === "line" &&
        Math.abs(t.boundingBox!.low[0]) < 1e-5 &&
        Math.abs(t.boundingBox!.high[0]) < 1e-5 &&
        Math.abs(t.boundingBox!.low[1] - 1) < 1e-5 &&
        Math.abs(t.boundingBox!.high[1] - 1) < 1e-5 &&
        t.boundingBox!.high[2] - t.boundingBox!.low[2] > 4.9,
    )!.reference;
    const mirror = await w.execute({
      operation: "mirror.create",
      parameters: {
        participants: [w.body, { role: "plane", targets: [top] }],
        options: { copy: true },
      },
      intent: "fulfill",
    });
    vertices(outputs(mirror)[0]!, ([x, y, z]) => [x!, y!, 10 - z!]);
    await remove(w);
    const moved = await w.execute({
      operation: "transform.create",
      parameters: {
        participants: [w.body, { role: "transformReference", targets: [top] }],
        options: { distance: 3 },
      },
      intent: "fulfill",
    });
    vertices(outputs(moved)[0]!, ([x, y, z]) => [x!, y!, z! + 3]);
    await remove(w);
    const rotated = await w.execute({
      operation: "transform.create",
      parameters: {
        participants: [w.body, { role: "axis", targets: [edge] }],
        options: { transformType: "rotation", angle: 90 },
      },
      intent: "fulfill",
    });
    vertices(outputs(rotated)[0]!, ([x, y, z]) => [1 - y!, 1 + x!, z!]);
    await remove(w);
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [0, 10] },
      construction: true,
      intent: "fulfill",
    });
    const sketch = w.current().discovery!.sketch!;
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: false,
    });
    const line = {
      kind: "sketchEntity",
      sketchId: published.discovery!.sketch!.sketchId!,
      entityId: sketch.entities[0]!.entityId,
    };
    const sketchRotated = await w.execute({
      operation: "transform.create",
      parameters: {
        participants: [w.body, { role: "axis", targets: [line] }],
        options: { transformType: "rotation", angle: 90 },
      },
      intent: "fulfill",
    });
    vertices(outputs(sketchRotated)[0]!, ([x, y, z]) => [z!, y!, -x!]);
    await remove(w);
    const patterned = await w.execute({
      operation: "linearPattern.create",
      parameters: {
        participants: [w.body, { role: "direction", targets: [line] }],
        options: { instanceCount: 2, spacing: 7, oppositeDirection: false },
      },
      intent: "fulfill",
    });
    vertices(outputs(patterned)[0]!, ([x, y, z]) => [x!, y! + 7, z!]);
    await remove(w);
    const circular = await w.execute({
      operation: "circularPattern.create",
      parameters: {
        participants: [w.body, { role: "axis", targets: [line] }],
        options: {
          instanceCount: 2,
          angleDegrees: 90,
          equalSpace: false,
          oppositeDirection: false,
        },
      },
      intent: "fulfill",
    });
    vertices(outputs(circular)[0]!, ([x, y, z]) => [z!, y!, -x!]);
  } finally {
    await w.close();
  }
}, 180000);

test("invalid axes, scopes and formerly valid references never certify last-good body geometry", async () => {
  const w = await box();
  try {
    const original = w.current().discovery!.state;
    for (const c of [
      {
        operation: "mirror.create",
        parameters: {
          participants: [
            w.body,
            { role: "plane", targets: [xy] },
            {
              role: "targetBody",
              targets: [{ kind: "body", bodyId: "body_other" }],
            },
          ],
          operationIntent: { source: "literal", value: "add" },
          options: { copy: true },
        },
      },
      {
        operation: "transform.create",
        parameters: { participants: [w.body], options: { vector: [0, 0, 0] } },
      },
      {
        operation: "linearPattern.create",
        parameters: {
          participants: [w.body, { role: "direction", targets: [xy] }],
          options: { instanceCount: 1, spacing: 2, oppositeDirection: false },
        },
      },
      {
        operation: "circularPattern.create",
        parameters: {
          participants: [w.body, { role: "axis", targets: [xy] }],
          options: {
            instanceCount: 2,
            angleDegrees: 0,
            equalSpace: true,
            oppositeDirection: false,
          },
        },
      },
    ]) {
      const r = await w.run({ ...c, intent: "fulfill" });
      expect(r.outcome.kind).toBe("rejected");
      expect(r.completion.live.kind).toBe("unchanged");
      expect(r.completion.live.state?.revisionId).toBe(original.revisionId);
    }
    const plane = await w.execute({
      operation: "plane.create",
      parameters: { mode: "coplanar", reference: { target: xy } },
      intent: "fulfill",
    });
    const f = plane.discovery!.model!.features.at(-1)!;
    const axis = f.producedTargets[0]!;
    await remove(w);
    expect(
      w
        .current()
        .discovery!.references.some(
          (r) => JSON.stringify(r.target) === JSON.stringify(axis),
        ),
    ).toBe(false);
    const parameters = {
      participants: [w.body, { role: "axis", targets: [axis] }],
      options: { transformType: "rotation", angle: 90 },
    };
    const failed = await w.run({
      operation: "transform.create",
      parameters,
      intent: "fulfill",
    });
    expect(failed.outcome.kind).toBe("failed");
    expect(failed.completion.live.kind).toBe("applied");
    expect(failed.completion.persistence.kind).toBe("committed");
    expect(failed.completion.geometry.kind).toBe("failed");
    expect(
      failed.discovery!.model!.bodies.every(
        (b) => b.bounds === null && b.topology === null,
      ),
    ).toBe(true);
    const id = failed.discovery!.model!.features.at(-1)!.featureId;
    const repaired = await w.execute({
      operation: "transform.update",
      featureId: id,
      parameters: {
        ...parameters,
        participants: [w.body, { role: "axis", targets: [xy] }],
      },
      intent: "fulfill",
    });
    vertices(outputs(repaired)[0]!, ([x, y, z]) => [-y!, x!, z!]);
    const invalid = await w.run({
      operation: "transform.update",
      featureId: id,
      parameters,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("accepted-invalid");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
    expect(invalid.completion.persistence.kind).toBe("committed");
  } finally {
    await w.close();
  }
}, 180000);

test("native copy patterns preserve seeds and produce independently expected instances and updates", async () => {
  const w = await box();
  try {
    for (const oppositeDirection of [false, true]) {
      const linear = await w.execute({
        operation: "linearPattern.create",
        parameters: {
          participants: [w.body, { role: "direction", targets: [yz] }],
          options: { instanceCount: 3, spacing: 7, oppositeDirection },
        },
        intent: "fulfill",
      });
      const produced = outputs(linear);
      expect(produced).toHaveLength(2);
      produced.forEach((b, i) =>
        vertices(b, ([x, y, z]) => [
          x! + (oppositeDirection ? -1 : 1) * 7 * (i + 1),
          y!,
          z!,
        ]),
      );
      vertices(
        linear.discovery!.model!.bodies.find(
          (b) => b.bodyId === w.target.bodyId,
        )!,
        (p) => p,
      );
      const id = linear.discovery!.model!.features.at(-1)!.featureId;
      const updated = await w.execute({
        operation: "linearPattern.update",
        featureId: id,
        parameters: {
          participants: [w.body, { role: "direction", targets: [yz] }],
          options: {
            instanceCount: 2,
            spacing: { source: "expression", valueText: "9" },
            oppositeDirection,
          },
        },
        intent: "fulfill",
      });
      expect(outputs(updated)).toHaveLength(1);
      vertices(outputs(updated)[0]!, ([x, y, z]) => [
        x! + (oppositeDirection ? -9 : 9),
        y!,
        z!,
      ]);
      await remove(w);
      for (const [angleDegrees, equalSpace, step] of [
        [360, true, 120],
        [180, true, 90],
        [45, false, 45],
      ] as const) {
        const parameters = {
          participants: [w.body, { role: "axis", targets: [xy] }],
          options: {
            instanceCount: 3,
            angleDegrees,
            equalSpace,
            oppositeDirection,
          },
        };
        const r = await w.execute({
          operation: "circularPattern.create",
          parameters,
          intent: "fulfill",
        });
        expect(outputs(r)).toHaveLength(2);
        outputs(r).forEach((b, i) =>
          vertices(b, ([x, y, z]) => {
            const a =
              ((i + 1) * step * (oppositeDirection ? -1 : 1) * Math.PI) / 180;
            return [
              x! * Math.cos(a) - y! * Math.sin(a),
              x! * Math.sin(a) + y! * Math.cos(a),
              z!,
            ];
          }),
        );
        const u = await w.execute({
          operation: "circularPattern.update",
          featureId: r.discovery!.model!.features.at(-1)!.featureId,
          parameters: {
            ...parameters,
            options: {
              ...parameters.options,
              instanceCount: 2,
              angleDegrees: 90,
              equalSpace: false,
            },
          },
          intent: "fulfill",
        });
        expect(outputs(u)).toHaveLength(1);
        vertices(outputs(u)[0]!, ([x, y, z]) =>
          oppositeDirection ? [y!, -x!, z!] : [-y!, x!, z!],
        );
        vertices(
          u.discovery!.model!.bodies.find((b) => b.bodyId === w.target.bodyId)!,
          (p) => p,
        );
        await remove(w);
      }
    }
  } finally {
    await w.close();
  }
}, 180000);
