import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import { prepareCombineFeatureDefinition } from "@/core/feature-authoring/features/combine";
import { prepareSplitFeatureDefinition } from "@/core/feature-authoring/features/split";
import { prepareDeleteSolidFeatureDefinition } from "@/core/feature-authoring/features/delete-solid";

const body = (id: `body_${string}`) => ({ kind: "body" as const, bodyId: id });
const participants = [
  { role: "targetBody" as const, targets: [body("body_a")] },
  { role: "toolBody" as const, targets: [body("body_b")] },
];
test("shared body preparation preserves literal retention and refuses lossy roles, duplicate bodies and unsupported intent", () => {
  for (const keepTools of [undefined, false, true]) {
    const options = keepTools === undefined ? undefined : { keepTools };
    expect(
      prepareCombineFeatureDefinition({
        participants,
        operationIntent: { source: "literal", value: "add" },
        options,
      })!.parameters.options,
    ).toEqual(options);
    expect(
      prepareSplitFeatureDefinition({ participants, options })!.parameters
        .options,
    ).toEqual(options);
  }
  expect(
    prepareCombineFeatureDefinition({
      participants,
      operationIntent: { source: "expression", valueText: '"add"' },
    }),
  ).toBeNull();
  for (const bad of [
    [...participants, participants[0]!],
    [participants[0]!],
    [
      participants[0]!,
      { role: "toolBody" as const, targets: participants[0]!.targets },
    ],
    [
      {
        role: "targetBody" as const,
        targets: [body("body_a"), body("body_a")],
      },
      participants[1]!,
    ],
  ]) {
    expect(
      prepareCombineFeatureDefinition({
        participants: bad,
        operationIntent: { source: "literal", value: "subtract" },
      }),
    ).toBeNull();
    expect(prepareSplitFeatureDefinition({ participants: bad })).toBeNull();
  }
  expect(
    prepareDeleteSolidFeatureDefinition({
      participants: [{ role: "body", targets: [] }],
    }),
  ).toBeNull();
});

async function boxes() {
  const w = await createSketchWorkflow();
  try {
    async function box(start: number) {
      await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive: {
          kind: "rectangle",
          start: [start, 0],
          end: [start + 10, 10],
        },
        construction: false,
        intent: "fulfill",
      });
      const p = await w.execute({
        operation: "sketch.publish",
        draft: w.current().discovery!.state.draft,
        requireProfiles: true,
      });
      const s = p.discovery!.sketch!;
      const result = await w.execute({
        operation: "extrude.create",
        profile: {
          kind: "region",
          sketchId: s.sketchId!,
          regionId: s.profiles[0]!.regionId,
        },
        depth: 10,
        intent: "fulfill",
      });
      const target =
        result.discovery!.model!.features.at(-1)!.producedTargets[0]!;
      if (target.kind !== "body")
        throw new Error("Extrusion did not produce a body");
      return target;
    }
    const a = await box(0);
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const b = await box(5);
    return {
      ...w,
      a,
      b,
      addBox: async (start: number) => {
        await w.execute({ operation: "sketch.begin", plane: "xy" });
        return box(start);
      },
      parameters: {
        participants: [
          { role: "targetBody", targets: [a] },
          { role: "toolBody", targets: [b] },
        ],
      },
    };
  } catch (error) {
    await w.close();
    throw error;
  }
}

test("native combine variants and updates preserve target identity, exact bounds and retention", async () => {
  const w = await boxes();
  try {
    for (const [operation, low, high] of [
      ["add", 0, 15],
      ["subtract", 0, 5],
      ["intersect", 5, 10],
    ] as const) {
      const r = await w.execute({
        operation: "combine.create",
        parameters: {
          ...w.parameters,
          operationIntent: { source: "literal", value: operation },
          options: { keepTools: true },
        },
        intent: "fulfill",
      });
      const f = r.discovery!.model!.features.at(-1)!;
      expect(f.producedTargets).toContainEqual(w.a);
      const result = r.discovery!.model!.bodies.find(
        (b) => b.bodyId === w.a.bodyId,
      )!;
      expect(result.bounds!.min).toEqual([low, 0, 0]);
      expect(result.bounds!.max).toEqual([high, 10, 10]);
      // Native fusion retains coplanar face subdivisions. Every exact face must
      // lie on one of the six independently expected exterior box planes.
      const faces = result.topology!.filter((t) => t.entityClass === "face");
      expect(faces.length).toBeGreaterThanOrEqual(6);
      for (const face of faces) {
        expect(face.geometryType).toBe("plane");
        expect(
          [0, 1, 2].some((axis) => {
            const lo = face.boundingBox!.low[axis]!;
            const hi = face.boundingBox!.high[axis]!;
            return (
              Math.abs(lo - hi) < 1e-5 &&
              [axis === 0 ? low : 0, axis === 0 ? high : 10].some(
                (v) => Math.abs(lo - v) < 1e-5,
              )
            );
          }),
        ).toBe(true);
      }
      expect(
        r.discovery!.model!.bodies.some((b) => b.bodyId === w.b.bodyId),
      ).toBe(true);
      const updated = await w.execute({
        operation: "combine.update",
        featureId: f.featureId,
        parameters: {
          ...w.parameters,
          operationIntent: { source: "literal", value: operation },
          options: { keepTools: false },
        },
        intent: "fulfill",
      });
      expect(updated.discovery!.model!.features.at(-1)!.featureId).toBe(
        f.featureId,
      );
      expect(updated.discovery!.model!.bodies).toHaveLength(1);
      expect(
        updated.discovery!.references.some(
          (r) => JSON.stringify(r.target) === JSON.stringify(w.b),
        ),
      ).toBe(false);
      await w.execute({
        operation: "feature.delete",
        featureId: f.featureId,
        intent: "fulfill",
      });
      expect(w.current().discovery!.model!.bodies).toHaveLength(2);
    }
    const distant = await w.addBox(30);
    const empty = await w.run({
      operation: "combine.create",
      parameters: {
        participants: [
          { role: "targetBody", targets: [w.a] },
          { role: "toolBody", targets: [distant] },
        ],
        operationIntent: { source: "literal", value: "intersect" },
      },
      intent: "fulfill",
    });
    expect(empty.outcome.kind).toBe("rejected");
    expect(empty.completion.live.kind).toBe("unchanged");
    expect(empty.discovery!.model!.bodies).toHaveLength(3);
  } finally {
    await w.close();
  }
}, 180000);

test("native split replaces target with independently bounded solids and preserves default tool retention", async () => {
  const w = await boxes();
  try {
    const r = await w.execute({
      operation: "split.create",
      parameters: w.parameters,
      intent: "fulfill",
    });
    const f = r.discovery!.model!.features.at(-1)!;
    expect(f.producedTargets).toHaveLength(2);
    expect(f.producedTargets).not.toContainEqual(w.a);
    expect(
      r.discovery!.model!.bodies.some((b) => b.bodyId === w.a.bodyId),
    ).toBe(false);
    expect(
      r.discovery!.references.some(
        (r) => r.target.kind === "body" && r.target.bodyId === w.a.bodyId,
      ),
    ).toBe(false);
    const outputs = r.discovery!.model!.bodies.filter((b) =>
      f.producedTargets.some((t) => t.kind === "body" && t.bodyId === b.bodyId),
    );
    expect(outputs.map((b) => [b.bounds!.min, b.bounds!.max]).sort()).toEqual([
      [
        [0, 0, 0],
        [5, 10, 10],
      ],
      [
        [5, 0, 0],
        [10, 10, 10],
      ],
    ]);
    const updated = await w.execute({
      operation: "split.update",
      featureId: f.featureId,
      parameters: { ...w.parameters, options: { keepTools: false } },
      intent: "fulfill",
    });
    expect(updated.discovery!.model!.bodies).toHaveLength(2);
    expect(updated.discovery!.model!.features.at(-1)!.featureId).toBe(
      f.featureId,
    );
  } finally {
    await w.close();
  }
}, 180000);

test("Delete Solid is authored history with empty output, stable updates, restoration and truthful missing-target failures", async () => {
  const w = await boxes();
  try {
    const parameters = { participants: [{ role: "body", targets: [w.a] }] };
    const r = await w.execute({
      operation: "deleteSolid.create",
      parameters,
      intent: "fulfill",
    });
    const f = r.discovery!.model!.features.at(-1)!;
    expect(f.kind).toBe("deleteSolid");
    expect(f.producedTargets).toEqual([]);
    expect(r.discovery!.model!.bodies.map((b) => b.bodyId)).toEqual([
      w.b.bodyId,
    ]);
    await w.execute({
      operation: "deleteSolid.update",
      featureId: f.featureId,
      parameters,
      intent: "fulfill",
    });
    await w.execute({
      operation: "deleteSolid.update",
      featureId: f.featureId,
      parameters: { participants: [{ role: "body", targets: [w.a, w.b] }] },
      intent: "fulfill",
    });
    expect(w.current().discovery!.model!.bodies).toEqual([]);
    await w.execute({
      operation: "feature.delete",
      featureId: f.featureId,
      intent: "fulfill",
    });
    expect(w.current().discovery!.model!.bodies).toHaveLength(2);
    const failed = await w.run({
      operation: "deleteSolid.create",
      parameters: {
        participants: [{ role: "body", targets: [body("body_missing")] }],
      },
      intent: "fulfill",
    });
    expect(failed.outcome.kind).toBe("rejected");
    expect(failed.completion.live.kind).toBe("unchanged");
    const good = await w.execute({
      operation: "deleteSolid.create",
      parameters,
      intent: "fulfill",
    });
    const deletion = good.discovery!.model!.features.at(-1)!;
    const producer = good.discovery!.model!.features.find(
      (f) =>
        f.kind === "extrude" &&
        f.producedTargets.some(
          (t) => t.kind === "body" && t.bodyId === w.a.bodyId,
        ),
    )!;
    await w.run({
      operation: "feature.delete",
      featureId: producer.featureId,
      intent: "author-invalid",
    });
    const broken = await w.run({
      operation: "deleteSolid.update",
      featureId: deletion.featureId,
      parameters,
      intent: "fulfill",
    });
    // Native Delete Solid does not classify body operands as repairable
    // consumed-target dependencies. Its unsupported-body refusal is unchanged,
    // even for a formerly valid target; never fabricate applied/failed receipts.
    expect(broken.outcome.kind, JSON.stringify(broken)).toBe("rejected");
    expect(broken.completion.live.kind).toBe("unchanged");
    expect(broken.completion.geometry.kind).not.toBe("current");
    const repaired = await w.execute({
      operation: "deleteSolid.update",
      featureId: deletion.featureId,
      parameters: { participants: [{ role: "body", targets: [w.b] }] },
      intent: "fulfill",
    });
    expect(repaired.discovery!.model!.bodies).toHaveLength(0);
    const invalid = await w.run({
      operation: "deleteSolid.update",
      featureId: deletion.featureId,
      parameters,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("rejected");
    expect(invalid.completion.live.kind).toBe("unchanged");
  } finally {
    await w.close();
  }
}, 180000);

test("Delete Solid beyond the rollback cursor cannot claim another feature's deletion as its own execution", async () => {
  const w = await boxes();
  try {
    const first = await w.execute({
      operation: "deleteSolid.create",
      parameters: { participants: [{ role: "body", targets: [w.a] }] },
      intent: "fulfill",
    });
    const firstId = first.discovery!.model!.features.at(-1)!.featureId;
    const second = await w.execute({
      operation: "deleteSolid.create",
      parameters: { participants: [{ role: "body", targets: [w.b] }] },
      intent: "fulfill",
    });
    const secondId = second.discovery!.model!.features.at(-1)!.featureId;
    await w.execute({
      operation: "timeline.cursor.set",
      cursor: { kind: "feature", featureId: firstId },
      intent: "fulfill",
    });
    const skipped = await w.run({
      operation: "deleteSolid.update",
      featureId: secondId,
      parameters: { participants: [{ role: "body", targets: [w.a] }] },
      intent: "fulfill",
    });
    expect(skipped.outcome.kind).toBe("failed");
    expect(skipped.completion.geometry.kind).toBe("failed");
    expect(skipped.discovery!.model!.bodies.map((b) => b.bodyId)).toEqual([
      w.b.bodyId,
    ]);
    expect(
      skipped.discovery!.references.some(
        (r) => r.target.kind === "body" && r.target.bodyId === w.a.bodyId,
      ),
    ).toBe(false);
    const editable = await w.run({
      operation: "deleteSolid.update",
      featureId: secondId,
      parameters: { participants: [{ role: "body", targets: [w.a] }] },
      intent: "author-invalid",
    });
    expect(editable.outcome.kind).toBe("accepted-invalid");
    expect(editable.completion.geometry.kind).toBe("invalid-editable");
  } finally {
    await w.close();
  }
}, 180000);

test("multiple combine target/tool sets follow first-target fusion and per-target cuts/intersections", async () => {
  const w = await boxes();
  try {
    const second = await w.addBox(2);
    const tool = await w.addBox(6);
    const participants = [
      { role: "targetBody", targets: [w.a, second] },
      { role: "toolBody", targets: [w.b, tool] },
    ];
    for (const [operation, expected] of [
      ["add", [[0, 16]]],
      [
        "subtract",
        [
          [0, 5],
          [2, 5],
        ],
      ],
      [
        "intersect",
        [
          [6, 10],
          [6, 12],
        ],
      ],
    ] as const) {
      const r = await w.execute({
        operation: "combine.create",
        parameters: {
          participants,
          operationIntent: { source: "literal", value: operation },
          options: { keepTools: true },
        },
        intent: "fulfill",
      });
      const feature = r.discovery!.model!.features.at(-1)!;
      const outputs = r.discovery!.model!.bodies.filter((b) =>
        feature.producedTargets.some(
          (t) => t.kind === "body" && t.bodyId === b.bodyId,
        ),
      );
      expect(
        outputs.map((b) => [b.bounds!.min[0], b.bounds!.max[0]]).sort(),
      ).toEqual(expected);
      expect(feature.producedTargets).toContainEqual(w.a);
      if (operation === "add") {
        expect(r.discovery!.model!.bodies).toHaveLength(3);
        expect(
          r.discovery!.references.some(
            (r) => JSON.stringify(r.target) === JSON.stringify(second),
          ),
        ).toBe(false);
      } else expect(feature.producedTargets).toContainEqual(second);
      await w.execute({
        operation: "feature.delete",
        featureId: feature.featureId,
        intent: "fulfill",
      });
      expect(w.current().discovery!.model!.bodies).toHaveLength(4);
    }
  } finally {
    await w.close();
  }
}, 180000);

test("sheet tools split a solid but are refused as solid targets, combine tools and Delete Solid operands", async () => {
  const w = await boxes();
  try {
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [5, -5], end: [5, 15] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: false,
    });
    const sketch = published.discovery!.sketch!;
    const sheetResult = await w.execute({
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
          end: {
            kind: "blind",
            distance: { source: "literal", value: 10 },
            direction: "positive",
          },
        },
      },
      intent: "fulfill",
    });
    const sheet =
      sheetResult.discovery!.model!.features.at(-1)!.producedTargets[0]!;
    const participants = [
      { role: "targetBody", targets: [w.a] },
      { role: "toolBody", targets: [sheet] },
    ];
    const split = await w.execute({
      operation: "split.create",
      parameters: { participants },
      intent: "fulfill",
    });
    const f = split.discovery!.model!.features.at(-1)!;
    expect(f.producedTargets).toHaveLength(2);
    const outputs = split.discovery!.model!.bodies.filter((b) =>
      f.producedTargets.some((t) => t.kind === "body" && t.bodyId === b.bodyId),
    );
    expect(outputs.map((b) => [b.bounds!.min, b.bounds!.max]).sort()).toEqual([
      [
        [0, 0, 0],
        [5, 10, 10],
      ],
      [
        [5, 0, 0],
        [10, 10, 10],
      ],
    ]);
    expect(split.discovery!.model!.bodies.some((b) => b.kind === "sheet")).toBe(
      true,
    );
    await w.execute({
      operation: "split.update",
      featureId: f.featureId,
      parameters: { participants, options: { keepTools: false } },
      intent: "fulfill",
    });
    expect(
      w.current().discovery!.model!.bodies.some((b) => b.kind === "sheet"),
    ).toBe(false);
    await w.execute({
      operation: "feature.delete",
      featureId: f.featureId,
      intent: "fulfill",
    });
    for (const command of [
      {
        operation: "combine.create",
        parameters: {
          participants,
          operationIntent: { source: "literal", value: "add" },
        },
      },
      {
        operation: "split.create",
        parameters: {
          participants: [
            { role: "targetBody", targets: [sheet] },
            { role: "toolBody", targets: [w.a] },
          ],
        },
      },
      {
        operation: "deleteSolid.create",
        parameters: { participants: [{ role: "body", targets: [sheet] }] },
      },
    ]) {
      const result = await w.run({ ...command, intent: "fulfill" });
      expect(result.outcome.kind).not.toBe("completed");
      expect(result.completion.geometry.kind).not.toBe("current");
      if (result.completion.live.kind === "applied")
        await w.execute({
          operation: "feature.delete",
          featureId: result.discovery!.model!.features.at(-1)!.featureId,
          intent: "fulfill",
        });
    }
  } finally {
    await w.close();
  }
}, 180000);
