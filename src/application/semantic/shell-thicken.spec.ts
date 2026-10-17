import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { prepareShellFeatureDefinition } from "@/core/feature-authoring/features/shell";
import { prepareThickenFeatureDefinition } from "@/core/feature-authoring/features/thicken";

const literal = <T>(value: T) => ({ source: "literal" as const, value });
async function workflow(surface = false) {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: surface
        ? { kind: "line", start: [0, 0], end: [20, 0] }
        : { kind: "rectangle", start: [0, 0], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: !surface,
    });
    const sketch = published.discovery!.sketch!;
    const profile = {
      kind: "region",
      sketchId: sketch.sketchId,
      regionId: sketch.profiles[0]?.regionId,
    };
    await w.execute(
      surface
        ? {
            operation: "extrude.create",
            intent: "fulfill",
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
                  distance: literal(10),
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
    return w;
  } catch (error) {
    await w.close();
    throw error;
  }
}
function planes(result: SemanticResult) {
  return result
    .discovery!.model!.bodies.flatMap((b) => b.topology ?? [])
    .filter((t) => t.entityClass === "face" && t.geometryType === "plane");
}
function assertPlane(result: SemanticResult, axis: number, coordinate: number) {
  expect(
    planes(result).some((p) => {
      const n = p.definingData?.normal as number[] | undefined;
      return (
        n &&
        Math.abs(n[axis]!) > 0.99999 &&
        p.boundingBox &&
        Math.abs(p.boundingBox.low[axis]! - coordinate) < 1e-5 &&
        Math.abs(p.boundingBox.high[axis]! - coordinate) < 1e-5
      );
    }),
    `Expected native plane ${axis}=${coordinate}: ${JSON.stringify(planes(result))}`,
  ).toBe(true);
}
function shellParameters(
  w: Awaited<ReturnType<typeof workflow>>,
  mode: "openFaces" | "closedHollow" | "offsetAllFaces",
  thickness = 1,
) {
  const body = w.current().discovery!.model!.bodies[0]!;
  const face = body.topology!.find(
    (t) =>
      t.entityClass === "face" &&
      t.boundingBox &&
      Math.abs(t.boundingBox.low[2] - 10) < 1e-5,
  )!.reference;
  expect(face.kind).toBe("face");
  return {
    bodyTarget: { kind: "body", bodyId: body.bodyId },
    mode,
    faceTargets: mode === "openFaces" ? [face] : [],
    direction: "inside",
    thickness: literal(thickness),
    operation: literal("newBody"),
    booleanScope: { kind: "standalone" },
  };
}

test("whole-body shell replaces the source and updates independently inspected cavity/offset planes", async () => {
  for (const mode of ["closedHollow", "offsetAllFaces"] as const) {
    const w = await workflow();
    try {
      const parameters = shellParameters(w, mode);
      const bodyId = w.current().discovery!.model!.bodies[0]!.bodyId;
      const created = await w.execute({
        operation: "shell.create",
        parameters,
        intent: "fulfill",
      });
      expect(created.discovery!.model!.bodies.map((b) => b.bodyId)).toEqual([
        bodyId,
      ]);
      for (const [axis, coordinates] of [
        [0, [1, 19]],
        [1, [1, 9]],
        [2, [1, 9]],
      ] as const)
        for (const c of coordinates) assertPlane(created, axis, c);
      if (mode === "closedHollow") {
        assertPlane(created, 0, 0);
        assertPlane(created, 0, 20);
        expect(planes(created)).toHaveLength(12);
      } else expect(planes(created)).toHaveLength(6);
      const featureId = created.discovery!.model!.features.find(
        (f) => f.kind === "shell",
      )!.featureId;
      const updated = await w.execute({
        operation: "shell.update",
        featureId,
        parameters: { ...parameters, thickness: literal(2) },
        intent: "fulfill",
      });
      assertPlane(updated, 0, 2);
      assertPlane(updated, 0, 18);
      expect(
        updated.discovery!.model!.features.find((f) => f.kind === "shell")!
          .featureId,
      ).toBe(featureId);
      expect(updated.completion.geometry.kind).toBe("current");
      expect(updated.completion.persistence.kind).toBe("committed");
      if (mode === "offsetAllFaces") {
        const outside = await w.execute({
          operation: "shell.update",
          featureId,
          parameters: { ...parameters, direction: "outside" },
          intent: "fulfill",
        });
        assertPlane(outside, 0, -1);
        assertPlane(outside, 0, 21);
        assertPlane(outside, 1, -1);
        assertPlane(outside, 1, 11);
        assertPlane(outside, 2, -1);
        assertPlane(outside, 2, 11);
        expect(outside.discovery!.model!.bodies).toHaveLength(1);
        expect(
          outside.discovery!.model!.bodies[0]!.topology!.some(
            (t) => t.entityClass === "face" && t.geometryType === "cylinder",
          ),
        ).toBe(true);
      }
    } finally {
      await w.close();
    }
  }
}, 180000);

test("open-face shell retains source for standalone output and honors an explicit self-intersection scope", async () => {
  const w = await workflow();
  try {
    const parameters = shellParameters(w, "openFaces");
    const created = await w.execute({
      operation: "shell.create",
      parameters,
      intent: "fulfill",
    });
    expect(created.discovery!.model!.bodies).toHaveLength(2);
    assertPlane(created, 0, 1);
    assertPlane(created, 0, 19);
    assertPlane(created, 2, 1);
    const featureId = created.discovery!.model!.features.find(
      (f) => f.kind === "shell",
    )!.featureId;
    const updated = await w.execute({
      operation: "shell.update",
      featureId,
      parameters: {
        ...parameters,
        thickness: literal(2),
        operation: literal("intersect"),
        booleanScope: {
          kind: "targetBody",
          bodyId: parameters.bodyTarget.bodyId,
        },
      },
      intent: "fulfill",
    });
    expect(updated.discovery!.model!.bodies).toHaveLength(1);
    assertPlane(updated, 0, 2);
    assertPlane(updated, 0, 18);
    assertPlane(updated, 2, 2);
  } finally {
    await w.close();
  }
}, 180000);

test("thicken sheet direction and total symmetric band preserve native plane geometry across updates", async () => {
  const w = await workflow(true);
  try {
    const source = w.current().discovery!.model!.bodies[0]!;
    expect(source.kind).toBe("sheet");
    const normal = (
      source.topology!.find((t) => t.entityClass === "face")!.definingData!
        .normal as number[]
    )[1]!;
    expect(Math.abs(normal)).toBeCloseTo(1, 5);
    const parameters = {
      participants: [
        { role: "face", targets: [{ kind: "body", bodyId: source.bodyId }] },
      ],
      options: {
        thickness: literal(2),
        side: literal("oneSide"),
        direction: "positive",
      },
    };
    const created = await w.execute({
      operation: "thicken.create",
      parameters,
      intent: "fulfill",
    });
    expect(
      created.discovery!.model!.bodies.filter((b) => b.kind === "solid"),
    ).toHaveLength(1);
    assertPlane(created, 1, 0);
    assertPlane(created, 1, 2 * normal);
    const featureId = created.discovery!.model!.features.find(
      (f) => f.kind === "thicken",
    )!.featureId;
    const negative = await w.execute({
      operation: "thicken.update",
      featureId,
      parameters: {
        ...parameters,
        options: {
          ...parameters.options,
          direction: "negative",
          thickness: literal(3),
        },
      },
      intent: "fulfill",
    });
    assertPlane(negative, 1, -3 * normal);
    const symmetric = await w.execute({
      operation: "thicken.update",
      featureId,
      parameters: {
        ...parameters,
        options: {
          ...parameters.options,
          side: literal("symmetric"),
          thickness: literal(4),
        },
      },
      intent: "fulfill",
    });
    assertPlane(symmetric, 1, -2);
    assertPlane(symmetric, 1, 2);
    expect(
      symmetric.discovery!.model!.features.find((f) => f.kind === "thicken")!
        .featureId,
    ).toBe(featureId);
    expect(symmetric.completion.persistence.kind).toBe("committed");
  } finally {
    await w.close();
  }
}, 180000);

test("thicken face output and scoped add/intersect/subtract use explicit bodies; bad references never fulfill", async () => {
  const w = await workflow();
  try {
    const body = w.current().discovery!.model!.bodies[0]!;
    const face = body.topology!.find(
      (t) =>
        t.entityClass === "face" &&
        t.boundingBox &&
        Math.abs(t.boundingBox.low[2] - 10) < 1e-5,
    )!.reference;
    const parameters = {
      participants: [{ role: "face", targets: [face] }],
      options: {
        thickness: literal(2),
        side: literal("oneSide"),
        direction: "positive",
      },
    };
    const created = await w.execute({
      operation: "thicken.create",
      parameters,
      intent: "fulfill",
    });
    assertPlane(created, 2, 0);
    assertPlane(created, 2, 12);
    const featureId = created.discovery!.model!.features.find(
      (f) => f.kind === "thicken",
    )!.featureId;
    const scoped = {
      ...parameters,
      participants: [
        ...parameters.participants,
        {
          role: "targetBody",
          targets: [{ kind: "body", bodyId: body.bodyId }],
        },
      ],
    };
    const added = await w.execute({
      operation: "thicken.update",
      featureId,
      parameters: {
        ...scoped,
        operationIntent: literal("add"),
        options: { ...parameters.options, direction: "negative" },
      },
      intent: "fulfill",
    });
    expect(added.discovery!.model!.bodies).toHaveLength(1);
    expect(added.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [0, 0, 0],
      max: [20, 10, 10],
    });
    assertPlane(added, 2, 0);
    assertPlane(added, 2, 10);
    for (const operationIntent of ["intersect", "subtract"]) {
      const result = await w.execute({
        operation: "thicken.update",
        featureId,
        parameters: {
          ...scoped,
          operationIntent: literal(operationIntent),
          options: { ...parameters.options, direction: "negative" },
        },
        intent: "fulfill",
      });
      assertPlane(result, 2, 8);
      assertPlane(result, 2, operationIntent === "intersect" ? 10 : 0);
    }
    const bad = await w.run({
      operation: "thicken.update",
      featureId,
      parameters: {
        ...scoped,
        operationIntent: literal("add"),
        participants: [
          parameters.participants[0],
          {
            role: "targetBody",
            targets: [{ kind: "body", bodyId: "body_missing" }],
          },
        ],
      },
      intent: "fulfill",
    });
    expect(bad.outcome.kind).not.toBe("completed");
    const prior = w.current().completion.live.state;
    for (const thickness of [0, -1]) {
      const result = await w.run({
        operation: "thicken.update",
        featureId,
        parameters: {
          ...parameters,
          options: { ...parameters.options, thickness: literal(thickness) },
        },
        intent: "fulfill",
      });
      expect(result.outcome.kind).toBe("rejected");
      expect(result.completion.live.state).toEqual(prior);
    }
  } finally {
    await w.close();
  }
}, 180000);

test("shell invalid thickness/references and missing boolean targets do not claim successful output", async () => {
  const w = await workflow();
  try {
    const parameters = shellParameters(w, "closedHollow");
    const open = shellParameters(w, "openFaces");
    for (const patch of [
      {
        ...open,
        operation: literal("cut"),
        booleanScope: { kind: "standalone" },
      },
      { thickness: literal(0) },
      { thickness: literal(-1) },
      {
        mode: "closedHollow",
        operation: literal("cut"),
        booleanScope: {
          kind: "targetBody",
          bodyId: parameters.bodyTarget.bodyId,
        },
      },
      { mode: "openFaces", faceTargets: [] },
    ]) {
      const before = w.current().completion.live.state;
      const result = await w.run({
        operation: "shell.create",
        parameters: { ...parameters, ...patch },
        intent: "fulfill",
      });
      expect(result.outcome.kind).not.toBe("completed");
      expect(result.completion.live.state).toEqual(before);
    }
    const created = await w.execute({
      operation: "shell.create",
      parameters,
      intent: "fulfill",
    });
    const featureId = created.discovery!.model!.features.find(
      (f) => f.kind === "shell",
    )!.featureId;
    const bad = await w.run({
      operation: "shell.update",
      featureId,
      parameters: {
        ...parameters,
        bodyTarget: { kind: "body", bodyId: "body_missing" },
      },
      intent: "fulfill",
    });
    expect(bad.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
    expect(bad.completion.live.kind).toBe("applied");
    expect(bad.completion.persistence.kind).toBe("committed");
    expect(bad.completion.geometry.kind).toBe("failed");
    const repaired = await w.execute({
      operation: "shell.update",
      featureId,
      parameters,
      intent: "fulfill",
    });
    assertPlane(repaired, 0, 1);
    const invalid = await w.run({
      operation: "shell.update",
      featureId,
      parameters: {
        ...parameters,
        bodyTarget: { kind: "body", bodyId: "body_missing" },
      },
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("accepted-invalid");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
  } finally {
    await w.close();
  }
}, 180000);

test("direct scoped thicken add retains the target volume", async () => {
  const w = await workflow();
  try {
    const body = w.current().discovery!.model!.bodies[0]!;
    const face = body.topology!.find(
      (t) =>
        t.entityClass === "face" &&
        t.boundingBox &&
        Math.abs(t.boundingBox.low[2] - 10) < 1e-5,
    )!.reference;
    const parameters = {
      participants: [
        { role: "face", targets: [face] },
        {
          role: "targetBody",
          targets: [{ kind: "body", bodyId: body.bodyId }],
        },
      ],
      operationIntent: literal("add"),
      options: {
        thickness: literal(2),
        side: literal("oneSide"),
        direction: "positive",
      },
    };
    expect(
      prepareThickenFeatureDefinition(parameters as never)!.parameters
        .operationIntent,
    ).toEqual(literal("add"));
    const added = await w.execute({
      operation: "thicken.create",
      parameters,
      intent: "fulfill",
    });
    expect(added.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [0, 0, 0],
      max: [20, 10, 12],
    });
    assertPlane(added, 2, 0);
    assertPlane(added, 2, 12);
  } finally {
    await w.close();
  }
}, 180000);

test("thicken refuses solid-body sources and reports missing faces as applied invalid geometry, not fulfillment", async () => {
  const w = await workflow();
  try {
    const body = w.current().discovery!.model!.bodies[0]!;
    const before = w.current().completion.live.state;
    const options = {
      thickness: literal(1),
      side: literal("oneSide"),
      direction: "positive",
    };
    const solidSource = await w.run({
      operation: "thicken.create",
      parameters: {
        participants: [
          { role: "face", targets: [{ kind: "body", bodyId: body.bodyId }] },
        ],
        options,
      },
      intent: "fulfill",
    });
    expect(solidSource.outcome.kind).toBe("rejected");
    expect(solidSource.completion.live.state).toEqual(before);
    const missingParameters = {
      participants: [
        {
          role: "face",
          targets: [
            { kind: "face", bodyId: body.bodyId, faceId: "face_missing" },
          ],
        },
      ],
      options,
    };
    const missing = await w.run({
      operation: "thicken.create",
      parameters: missingParameters,
      intent: "fulfill",
    });
    expect(missing.outcome).toEqual({ kind: "failed", failures: ["geometry"] });
    expect(missing.completion.live.kind).toBe("applied");
    expect(missing.completion.persistence.kind).toBe("committed");
    expect(missing.completion.geometry.kind).toBe("failed");
    const featureId = missing.discovery!.model!.features.find(
      (f) => f.kind === "thicken",
    )!.featureId;
    const invalid = await w.run({
      operation: "thicken.update",
      featureId,
      parameters: missingParameters,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("accepted-invalid");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
  } finally {
    await w.close();
  }
}, 180000);

test("canonical preparation refuses mixed/multiple sheets and whole-body boolean intent without coercion", () => {
  const body = { kind: "body" as const, bodyId: "body_source" as const };
  const face = {
    kind: "face" as const,
    bodyId: body.bodyId,
    faceId: "face_top" as const,
  };
  const parameters = {
    participants: [
      { role: "face" as const, targets: [body] as const },
    ] as const,
    options: {
      thickness: literal(1),
      side: literal("symmetric" as const),
      direction: "negative" as const,
    },
  };
  const prepared = prepareThickenFeatureDefinition(parameters)!;
  expect(prepared.parameters.options).toEqual(parameters.options);
  for (const participants of [
    [{ role: "face", targets: [body, body] }],
    [{ role: "face", targets: [body, face] }],
    [
      { role: "face", targets: [face] },
      { role: "path", targets: [body] },
    ],
    [
      { role: "face", targets: [face] },
      { role: "face", targets: [face] },
    ],
  ])
    expect(
      prepareThickenFeatureDefinition({ ...parameters, participants } as never),
    ).toBeNull();
  for (const mode of ["closedHollow", "offsetAllFaces"] as const) {
    const shell = {
      mode,
      bodyTarget: body,
      faceTargets: [],
      thickness: literal(1),
      direction: "inside",
      operation: literal("intersect"),
      booleanScope: { kind: "targetBody", bodyId: body.bodyId },
    };
    expect(prepareShellFeatureDefinition(shell as never)).toBeNull();
    expect(
      prepareShellFeatureDefinition({
        ...shell,
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
        direction: "outside",
        mode: "closedHollow",
      } as never),
    ).toBeNull();
  }
});
