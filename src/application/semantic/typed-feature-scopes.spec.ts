import { expect, it } from "vitest";
import {
  createReplayWorkflow,
  expectReplayGeometry,
  replayLinear,
} from "../../../test/helpers/semantic-feature-replay";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";

it("consumes discovered bodies in nested boolean scopes and features in replay source lists", async () => {
  const w = await createReplayWorkflow("join");
  try {
    const source = w
      .current()
      .discovery!.references.find(
        ({ target }) =>
          target.kind === "feature" && target.featureId === w.sourceFeatureId,
      )!.target;
    for (const booleanScope of [
      { kind: "targetBodies", bodyIds: [w.target] },
      { kind: "targetBody", bodyId: w.target },
    ]) {
      const updated = await w.execute({
        operation: "extrude.update",
        featureId: source,
        intent: "fulfill",
        parameters: {
          resultBodyType: "solid",
          profiles: [w.profile],
          startExtent: {
            kind: "blindOffset",
            distance: literal(5),
            direction: "positive",
          },
          extent: {
            mode: "oneSide",
            end: { kind: "blind", direction: "positive", distance: literal(3) },
          },
          operation: literal("join"),
          booleanScope,
        },
      });
      expect(updated.discovery!.model!.bodies).toHaveLength(1);
    }
    const replayed = await w.execute({
      operation: "featureReplay.create",
      intent: "fulfill",
      parameters: { sourceFeatureIds: [source], transform: replayLinear },
    });
    expectReplayGeometry(replayed, "join", [
      [2, 4],
      [9, 11],
      [16, 18],
    ]);
  } finally {
    await w.close();
  }
});
