import { expect, test } from "vitest";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

async function rectangle(
  w: Awaited<ReturnType<typeof createSketchWorkflow>>,
  start: readonly [number, number],
  end: readonly [number, number],
) {
  const authored = await w.execute({
    operation: "sketch.author",
    draft: w.current().discovery!.state.draft,
    primitive: { kind: "rectangle", start, end },
    construction: false,
    intent: "fulfill",
  });
  const published = await w.execute({
    operation: "sketch.publish",
    draft: authored.discovery!.state.draft,
    requireProfiles: true,
  });
  const sketch = published.discovery!.sketch!;
  return {
    kind: "region" as const,
    sketchId: sketch.sketchId!,
    regionId: sketch.profiles[0]!.regionId,
  };
}

test("reference termination and through-all boolean scope use real target geometry and report invalid participants truthfully", async () => {
  const w = await createSketchWorkflow();
  try {
    const profile = await rectangle(w, [0, 0], [20, 10]);
    const base = await w.execute({
      operation: "extrude.create",
      profile,
      depth: 10,
      intent: "fulfill",
    });
    const bodyId = base.discovery!.model!.bodies[0]!.bodyId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const smaller = await rectangle(w, [2, 2], [6, 5]);
    const parameters = {
      resultBodyType: "solid",
      profiles: [smaller],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: {
          kind: "upToPart",
          direction: "positive",
          target: { kind: "body", bodyId },
        },
      },
      operation: literal("newBody"),
      booleanScope: { kind: "standalone" },
    };
    const reference = await w.execute({
      operation: "extrude.create",
      parameters,
      intent: "fulfill",
    });
    const featureId = reference.discovery!.model!.features[1]!.featureId;
    const outputId =
      reference.discovery!.model!.features[1]!.producedTargets.find(
        (t) => t.kind === "body",
      )!;
    expect(
      reference.discovery!.model!.bodies.find(
        (b) => outputId.kind === "body" && b.bodyId === outputId.bodyId,
      )!.bounds,
    ).toEqual({ min: [2, 2, 0], max: [6, 5, 10] });
    const next = await w.execute({
      operation: "extrude.update",
      featureId,
      parameters: {
        ...parameters,
        extent: {
          mode: "oneSide",
          end: { kind: "upToNext", direction: "positive" },
        },
      },
      intent: "fulfill",
    });
    expect(
      next.discovery!.model!.bodies.find(
        (b) => outputId.kind === "body" && b.bodyId === outputId.bodyId,
      )!.bounds,
    ).toEqual({ min: [2, 2, 0], max: [6, 5, 10] });
    const badReference = await w.run({
      operation: "extrude.update",
      featureId,
      parameters: {
        ...parameters,
        extent: {
          mode: "oneSide",
          end: {
            kind: "upToPart",
            direction: "positive",
            target: { kind: "body", bodyId: "body_missing" },
          },
        },
      },
      intent: "fulfill",
    });
    expect(badReference.outcome).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(badReference.completion.live.kind).toBe("applied");
    expect(badReference.completion.persistence.kind).toBe("committed");
    expect(badReference.completion.geometry.kind).toBe("failed");
    expect(
      badReference.discovery!.model!.bodies.every((b) => b.bounds === null),
    ).toBe(true);
    const authoredInvalid = await w.run({
      operation: "extrude.update",
      featureId,
      parameters: {
        ...parameters,
        extent: {
          mode: "oneSide",
          end: {
            kind: "upToPart",
            direction: "positive",
            target: { kind: "body", bodyId: "body_missing_explicit" },
          },
        },
      },
      intent: "author-invalid",
    });
    expect(authoredInvalid.outcome).toEqual({ kind: "accepted-invalid" });
    expect(authoredInvalid.completion.live.kind).toBe("applied");
    expect(authoredInvalid.completion.persistence.kind).toBe("committed");
    expect(authoredInvalid.completion.geometry.kind).toBe("invalid-editable");
    await w.execute({
      operation: "feature.delete",
      featureId,
      intent: "fulfill",
    });
    await w.execute({ operation: "sketch.begin", plane: "yz" });
    const side = await rectangle(w, [0, 0], [5, 10]);
    const cutParameters = {
      resultBodyType: "solid",
      profiles: [side],
      startExtent: { kind: "profilePlane" },
      extent: {
        mode: "oneSide",
        end: { kind: "throughAll", direction: "positive" },
      },
      operation: literal("cut"),
      booleanScope: { kind: "targetBodies", bodyIds: [bodyId] },
    };
    const cut = await w.execute({
      operation: "extrude.create",
      parameters: cutParameters,
      intent: "fulfill",
    });
    expect(cut.discovery!.model!.bodies).toHaveLength(1);
    expect(cut.discovery!.model!.bodies[0]!.bounds).toEqual({
      min: [0, 5, 0],
      max: [20, 10, 10],
    });
    const badScope = await w.run({
      operation: "extrude.update",
      featureId: cut.discovery!.model!.features.at(-1)!.featureId,
      parameters: {
        ...cutParameters,
        booleanScope: { kind: "targetBody", bodyId: "body_missing" },
      },
      intent: "fulfill",
    });
    expect(badScope.outcome, JSON.stringify(badScope)).toEqual({
      kind: "failed",
      failures: ["geometry"],
    });
    expect(badScope.completion.live.kind).toBe("applied");
    expect(badScope.completion.persistence.kind).toBe("committed");
    expect(badScope.completion.geometry.kind).toBe("failed");
    expect(badScope.diagnostics.some((d) => d.severity === "error")).toBe(true);
  } finally {
    await w.close();
  }
}, 60000);

test("up-to-next refuses partial contact instead of treating the first intersecting body as a terminating plane", async () => {
  const w = await createSketchWorkflow();
  try {
    const partial = await rectangle(w, [0, 0], [5, 10]);
    await w.execute({
      operation: "extrude.create",
      profile: partial,
      depth: 10,
      intent: "fulfill",
    });
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const profile = await rectangle(w, [0, 0], [10, 10]);
    const straight = await w.execute({
      operation: "extrude.create",
      profile,
      depth: 7,
      intent: "fulfill",
    });
    const result = await w.run({
      operation: "extrude.update",
      featureId: straight.discovery!.model!.features[1]!.featureId,
      parameters: {
        resultBodyType: "solid",
        profiles: [profile],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: { kind: "upToNext", direction: "positive" },
        },
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
      intent: "fulfill",
    });
    expect(result.outcome, JSON.stringify(result)).toEqual({
      kind: "rejected",
      reasonCode: "advanced-feature-unsupported-kernel-case",
    });
    expect(result.completion.live).toEqual({
      kind: "unchanged",
      state: straight.discovery!.state,
    });
    expect(result.completion.geometry.kind).toBe("not-required");
    expect(result.completion.persistence.kind).toBe("not-required");
    expect(result.diagnostics.map((d) => d.message).join(" ")).toContain(
      "before a complete terminating plane",
    );
    expect(result.discovery!.model!.bodies).toEqual(
      straight.discovery!.model!.bodies,
    );
  } finally {
    await w.close();
  }
}, 60000);

test("a solid draft changes independently expected bounds instead of silently making a straight prism", async () => {
  const w = await createSketchWorkflow();
  try {
    const profile = await rectangle(w, [0, 0], [20, 10]);
    const result = await w.execute({
      operation: "extrude.create",
      parameters: {
        resultBodyType: "solid",
        profiles: [profile],
        startExtent: { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: literal(10),
            draftAngle: literal(-Math.atan(0.1)),
          },
        },
        operation: literal("newBody"),
        booleanScope: { kind: "standalone" },
      },
      intent: "fulfill",
    });
    const bounds = result.discovery!.model!.bodies[0]!.bounds!;
    for (const [index, min, max] of [
      [0, -1, 21],
      [1, -1, 11],
      [2, 0, 10],
    ] as const) {
      expect(bounds.min[index]).toBeCloseTo(min, 5);
      expect(bounds.max[index]).toBeCloseTo(max, 5);
    }
  } finally {
    await w.close();
  }
}, 60000);
