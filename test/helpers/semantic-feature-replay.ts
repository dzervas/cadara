import { expect } from "vitest";
import { createSketchWorkflow } from "./semantic-sketch-workflow";
import { createLiteralAuthoredValue as literal } from "@/contracts/modeling/authored-values";
import type { SemanticResult } from "@/contracts/semantic/schema";

export const replayX = {
  kind: "construction",
  constructionId: "construction_plane-yz",
} as const;
export const replayLinear = {
  kind: "linear",
  direction: replayX,
  instanceCount: literal(3),
  spacing: literal(7),
  oppositeDirection: literal(false),
} as const;

export async function createReplayWorkflow(operation: "join" | "cut") {
  const w = await createSketchWorkflow();
  try {
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [-20, -10], end: [20, 10] },
      construction: false,
      intent: "fulfill",
    });
    const baseProfile = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const s = baseProfile.discovery!.sketch!;
    const base = await w.execute({
      operation: "extrude.create",
      profile: {
        kind: "region",
        sketchId: s.sketchId!,
        regionId: s.profiles[0]!.regionId,
      },
      depth: 5,
      intent: "fulfill",
    });
    const target = base.discovery!.model!.features.at(-1)!.producedTargets[0]!;
    if (target.kind !== "body") throw new Error("Expected base solid");
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "rectangle", start: [2, 2], end: [4, 4] },
      construction: false,
      intent: "fulfill",
    });
    const tool = await w.execute({
      operation: "sketch.publish",
      draft: w.current().discovery!.state.draft,
      requireProfiles: true,
    });
    const sketch = tool.discovery!.sketch!;
    const source = await w.execute({
      operation: "extrude.create",
      intent: "fulfill",
      parameters: {
        resultBodyType: "solid",
        profiles: [
          {
            kind: "region",
            sketchId: sketch.sketchId!,
            regionId: sketch.profiles[0]!.regionId,
          },
        ],
        startExtent:
          operation === "join"
            ? {
                kind: "blindOffset",
                distance: literal(5),
                direction: "positive",
              }
            : { kind: "profilePlane" },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: literal(operation === "join" ? 3 : 5),
          },
        },
        operation: literal(operation),
        booleanScope: { kind: "targetBody", bodyId: target.bodyId },
      },
    });
    return {
      ...w,
      target,
      profile: {
        kind: "region",
        sketchId: sketch.sketchId!,
        regionId: sketch.profiles[0]!.regionId,
      } as const,
      sourceFeatureId: source.discovery!.model!.features.at(-1)!.featureId,
    };
  } catch (error) {
    await w.close();
    throw error;
  }
}

/** Check native operation faces, not the unchanged base envelope/body count. */
export function expectReplayGeometry(
  result: SemanticResult,
  operation: "join" | "cut",
  intervals: readonly (readonly [number, number])[],
) {
  expect(result.outcome.kind, JSON.stringify(result.diagnostics)).toBe(
    "completed",
  );
  const bodies = result.discovery!.model!.bodies;
  expect(bodies).toHaveLength(1);
  const faces = bodies[0]!.topology!.filter((t) => t.entityClass === "face");
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-5;
  if (operation === "join") {
    const tops = faces.filter(
      (f) => near(f.boundingBox!.low[2], 8) && near(f.boundingBox!.high[2], 8),
    );
    expect(tops).toHaveLength(intervals.length);
    for (const [low, high] of intervals)
      expect(
        tops.some((f) => {
          const b = f.boundingBox!;
          return (
            near(b.low[0], low) &&
            near(b.high[0], high) &&
            near(b.low[1], 2) &&
            near(b.high[1], 4)
          );
        }),
        JSON.stringify({ low, high, tops }),
      ).toBe(true);
  }
  const walls = faces.filter((f) => {
    const b = f.boundingBox!;
    return (
      near(b.low[2], operation === "join" ? 5 : 0) &&
      near(b.high[2], operation === "join" ? 8 : 5) &&
      b.low[1] >= 2 - 1e-5 &&
      b.high[1] <= 4 + 1e-5
    );
  });
  expect(walls).toHaveLength(4 * intervals.length);
  for (const [low, high] of intervals) {
    // Four exact vertical walls per additive tool or through-cut.
    const expected = [
      [
        [low, 2],
        [low, 4],
      ],
      [
        [high, 2],
        [high, 4],
      ],
      [
        [low, 2],
        [high, 2],
      ],
      [
        [low, 4],
        [high, 4],
      ],
    ];
    for (const [lo, hi] of expected)
      expect(
        faces.some((f) => {
          const b = f.boundingBox!;
          return (
            f.geometryType === "plane" &&
            near(b.low[0], lo![0]!) &&
            near(b.low[1], lo![1]!) &&
            near(b.high[0], hi![0]!) &&
            near(b.high[1], hi![1]!) &&
            near(b.low[2], operation === "join" ? 5 : 0) &&
            near(b.high[2], operation === "join" ? 8 : 5)
          );
        }),
        JSON.stringify({ lo, hi, faces }),
      ).toBe(true);
  }
}
