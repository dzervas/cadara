import { expect, test } from "vitest";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import { normalizeFeatureDefinition } from "@/domain/modeling/modeling-service/normalization";
import { FEATURE_REPLAY_FEATURE_SCHEMA_VERSION } from "@/contracts/shared/versioning";
import {
  createReplayWorkflow,
  expectReplayGeometry,
  replayLinear,
  replayX,
} from "../../../test/helpers/semantic-feature-replay";

for (const operation of ["join", "cut"] as const)
  test(`production ${operation} replay preserves target lineage, nests local before mirror, and updates exact operations`, async () => {
    const w = await createReplayWorkflow(operation);
    try {
      const parameters = {
        sourceFeatureIds: [w.sourceFeatureId],
        transform: replayLinear,
      };
      const replay = await w.execute({
        operation: "featureReplay.create",
        parameters,
        intent: "fulfill",
      });
      expectReplayGeometry(replay, operation, [
        [2, 4],
        [9, 11],
        [16, 18],
      ]);
      const model = replay.discovery!.model!;
      expect(model.bodies[0]!.bodyId).toBe(w.target.bodyId);
      const replayId = model.features.at(-1)!.featureId;
      expect(model.features.at(-1)!.producedTargets).toEqual([w.target]);
      expect(
        replay.discovery!.references.some(
          (r) => r.target.kind === "feature" && r.target.featureId === replayId,
        ),
      ).toBe(true);
      expect(
        replay.discovery!.references.some(
          (r) =>
            r.target.kind === "body" && r.target.bodyId === w.target.bodyId,
        ),
      ).toBe(true);
      const nested = await w.execute({
        operation: "featureReplay.create",
        parameters: {
          sourceFeatureIds: [replayId],
          transform: { kind: "mirror", plane: replayX },
        },
        intent: "fulfill",
      });
      expectReplayGeometry(nested, operation, [
        [2, 4],
        [9, 11],
        [16, 18],
        [-11, -9],
        [-18, -16],
      ]);
      const nestedId = nested.discovery!.model!.features.at(-1)!.featureId;
      const updated = await w.execute({
        operation: "featureReplay.update",
        featureId: nestedId,
        parameters: {
          sourceFeatureIds: [w.sourceFeatureId],
          transform: { kind: "mirror", plane: replayX },
        },
        intent: "fulfill",
      });
      expect(updated.discovery!.model!.features.at(-1)!.featureId).toBe(
        nestedId,
      );
      expectReplayGeometry(updated, operation, [
        [2, 4],
        [9, 11],
        [16, 18],
        [-4, -2],
      ]);
      await w.execute({
        operation: "feature.delete",
        featureId: nestedId,
        intent: "fulfill",
      });
      const reduced = await w.execute({
        operation: "featureReplay.update",
        featureId: replayId,
        parameters: {
          ...parameters,
          transform: {
            ...replayLinear,
            instanceCount: literal(2),
            spacing: { source: "expression", valueText: "9" },
            oppositeDirection: literal(true),
          },
        },
        intent: "fulfill",
      });
      expect(reduced.discovery!.model!.features.at(-1)!.featureId).toBe(
        replayId,
      );
      expectReplayGeometry(reduced, operation, [
        [2, 4],
        [-7, -5],
      ]);
    } finally {
      await w.close();
    }
  }, 180000);

test("ordered additive and subtractive sources replay operation deltas, not final bodies", async () => {
  const w = await createReplayWorkflow("join");
  try {
    const cut = await w.execute({
      operation: "extrude.create",
      intent: "fulfill",
      parameters: {
        resultBodyType: "solid",
        profiles: [w.profile],
        startExtent: {
          kind: "blindOffset",
          distance: literal(7),
          direction: "positive",
        },
        extent: {
          mode: "oneSide",
          end: { kind: "blind", direction: "positive", distance: literal(1) },
        },
        operation: literal("cut"),
        booleanScope: { kind: "targetBody", bodyId: w.target.bodyId },
      },
    });
    const cutId = cut.discovery!.model!.features.at(-1)!.featureId;
    const parameters = {
      sourceFeatureIds: [w.sourceFeatureId, cutId],
      transform: { ...replayLinear, instanceCount: literal(2) },
    };
    const ordered = await w.execute({
      operation: "featureReplay.create",
      parameters,
      intent: "fulfill",
    });
    const replayId = ordered.discovery!.model!.features.at(-1)!.featureId;
    function tops(result: typeof ordered, shiftedHeight: number) {
      const faces = result.discovery!.model!.bodies[0]!.topology!.filter(
        (t) =>
          t.entityClass === "face" &&
          t.boundingBox!.low[2] > 5 &&
          Math.abs(t.boundingBox!.high[2] - t.boundingBox!.low[2]) < 1e-5,
      );
      expect(faces).toHaveLength(2);
      for (const [x, z] of [
        [2, 7],
        [9, shiftedHeight],
      ])
        expect(
          faces.some((f) => {
            const b = f.boundingBox!;
            return (
              Math.abs(b.low[0] - x!) < 1e-5 &&
              Math.abs(b.high[0] - x! - 2) < 1e-5 &&
              Math.abs(b.low[1] - 2) < 1e-5 &&
              Math.abs(b.high[1] - 4) < 1e-5 &&
              Math.abs(b.low[2] - z!) < 1e-5
            );
          }),
        ).toBe(true);
    }
    tops(ordered, 7);
    const reversed = await w.execute({
      operation: "featureReplay.update",
      featureId: replayId,
      parameters: {
        ...parameters,
        sourceFeatureIds: [cutId, w.sourceFeatureId],
      },
      intent: "fulfill",
    });
    tops(reversed, 8);
    expect(reversed.discovery!.model!.features.at(-1)!.featureId).toBe(
      replayId,
    );
    expect(reversed.discovery!.model!.features.at(-1)!.producedTargets).toEqual(
      [w.target],
    );
  } finally {
    await w.close();
  }
}, 180000);

test("shared production replay normalization keeps ordering and refuses duplicate sources and unresolved boolean transforms", () => {
  const definition = {
    kind: "featureReplay",
    featureTypeVersion: FEATURE_REPLAY_FEATURE_SCHEMA_VERSION,
    parameters: {
      sourceFeatureIds: ["feature_second", "feature_first"],
      transform: replayLinear,
    },
  };
  expect(normalizeFeatureDefinition(definition)).toEqual(definition);
  for (const sourceFeatureIds of [[], ["feature_first", "feature_first"]])
    expect(() =>
      normalizeFeatureDefinition({
        ...definition,
        parameters: { ...definition.parameters, sourceFeatureIds },
      }),
    ).toThrow();
  expect(() =>
    normalizeFeatureDefinition({
      ...definition,
      parameters: {
        ...definition.parameters,
        transform: {
          ...replayLinear,
          oppositeDirection: { source: "expression", valueText: "true" },
        },
      },
    }),
  ).toThrow("invalid values");
});

test("invalid replay sources, transforms, stale basis and downstream rebuilds never certify old geometry", async () => {
  const w = await createReplayWorkflow("join");
  try {
    const state = w.current().discovery!.state;
    const baseFeatureId = w.current().discovery!.model!.features[0]!.featureId;
    for (const transform of [
      { ...replayLinear, instanceCount: literal(1) },
      { ...replayLinear, spacing: literal(0) },
      { ...replayLinear, instanceCount: literal(2.5) },
    ]) {
      const r = await w.run({
        operation: "featureReplay.create",
        parameters: { sourceFeatureIds: [w.sourceFeatureId], transform },
        intent: "fulfill",
      });
      expect(r.outcome.kind).not.toBe("completed");
      expect(r.completion.live.kind).toBe("unchanged");
      expect(r.completion.live.state?.revisionId).toBe(state.revisionId);
    }
    const duplicate = await w.run({
      operation: "featureReplay.create",
      parameters: {
        sourceFeatureIds: [w.sourceFeatureId, w.sourceFeatureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    expect(duplicate.outcome.kind).toBe("rejected");
    const unsupported = await w.run({
      operation: "featureReplay.create",
      parameters: {
        sourceFeatureIds: [baseFeatureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    expect(unsupported.outcome.kind).toBe("rejected");
    expect(unsupported.completion.live.kind).toBe("unchanged");
    const plane = await w.execute({
      operation: "plane.create",
      parameters: { mode: "coplanar", reference: { target: replayX } },
      intent: "fulfill",
    });
    const planeFeature = plane.discovery!.model!.features.at(-1)!;
    const formerPlane = planeFeature.producedTargets[0]!;
    const wrongKind = await w.run({
      operation: "featureReplay.create",
      parameters: {
        sourceFeatureIds: [planeFeature.featureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    expect(wrongKind.outcome.kind).toBe("rejected");
    expect(wrongKind.completion.live.kind).toBe("unchanged");
    const deletedPlane = await w.execute({
      operation: "feature.delete",
      featureId: planeFeature.featureId,
      intent: "fulfill",
    });
    expect(
      deletedPlane.discovery!.references.some(
        (r) => JSON.stringify(r.target) === JSON.stringify(formerPlane),
      ),
    ).toBe(false);
    const good = await w.execute({
      operation: "featureReplay.create",
      parameters: {
        sourceFeatureIds: [w.sourceFeatureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    const id = good.discovery!.model!.features.at(-1)!.featureId;
    const stale = await w.run({
      operation: "featureReplay.update",
      basis: {
        documentId: state.documentId,
        revisionId: state.revisionId,
        repositoryHeads: state.repositoryHeads,
      },
      featureId: id,
      parameters: {
        sourceFeatureIds: [w.sourceFeatureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    const absentPlane = await w.run({
      operation: "featureReplay.update",
      featureId: id,
      parameters: {
        sourceFeatureIds: [w.sourceFeatureId],
        transform: {
          kind: "mirror",
          plane: formerPlane,
        },
      },
      intent: "fulfill",
    });
    expect(absentPlane.outcome.kind).toBe("failed");
    expect(absentPlane.completion.geometry.kind).toBe("failed");
    expect(absentPlane.completion.live.kind).toBe("applied");
    await w.execute({
      operation: "featureReplay.update",
      featureId: id,
      parameters: {
        sourceFeatureIds: [w.sourceFeatureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    const missing = {
      sourceFeatureIds: ["feature_missing"],
      transform: replayLinear,
    };
    const failed = await w.run({
      operation: "featureReplay.update",
      featureId: id,
      parameters: missing,
      intent: "fulfill",
    });
    expect(failed.outcome.kind, JSON.stringify(failed)).toBe("failed");
    expect(failed.completion.live.kind).toBe("applied");
    expect(failed.completion.persistence.kind).toBe("committed");
    expect(failed.completion.geometry.kind).toBe("failed");
    expect(
      failed.discovery!.model!.bodies.every(
        (b) => b.bounds === null && b.topology === null,
      ),
    ).toBe(true);
    const repaired = await w.execute({
      operation: "featureReplay.update",
      featureId: id,
      parameters: {
        sourceFeatureIds: [w.sourceFeatureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    expectReplayGeometry(repaired, "join", [
      [2, 4],
      [9, 11],
      [16, 18],
    ]);
    const invalid = await w.run({
      operation: "featureReplay.update",
      featureId: id,
      parameters: missing,
      intent: "author-invalid",
    });
    expect(invalid.outcome.kind).toBe("accepted-invalid");
    expect(invalid.completion.geometry.kind).toBe("invalid-editable");
    await w.execute({
      operation: "featureReplay.update",
      featureId: id,
      parameters: {
        sourceFeatureIds: [w.sourceFeatureId],
        transform: replayLinear,
      },
      intent: "fulfill",
    });
    const removed = await w.run({
      operation: "feature.delete",
      featureId: w.sourceFeatureId,
      intent: "fulfill",
    });
    expect(removed.outcome.kind).toBe("failed");
    expect(removed.completion.live.kind).toBe("applied");
    expect(removed.completion.persistence.kind).toBe("committed");
    expect(removed.completion.geometry.kind).toBe("failed");
    expect(
      removed.discovery!.references.some(
        (r) =>
          r.target.kind === "feature" &&
          r.target.featureId === w.sourceFeatureId,
      ),
    ).toBe(false);
    expect(
      removed.discovery!.model!.bodies.every(
        (b) => b.bounds === null && b.topology === null,
      ),
    ).toBe(true);
  } finally {
    await w.close();
  }
}, 180000);
