import { expect, test } from "vitest";
import type { SemanticResult } from "@/contracts/semantic/schema";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

function innerPocketEdges(result: SemanticResult) {
  return result.discovery!.model!.bodies[0]!.topology!.filter((s) => {
    const box = s.boundingBox;
    return (
      s.entityClass === "edge" &&
      box &&
      box.high[2] - box.low[2] > 20 &&
      box.low[2] > 1 &&
      Math.abs(box.high[0] - box.low[0]) < 1e-6 &&
      Math.abs(box.high[1] - box.low[1]) < 1e-6
    );
  });
}

test("pocket fillets retain their four inner edges after an upstream width change", async () => {
  const w = await createSketchWorkflow();
  try {
    await w.execute({ operation: "sketch.discard", draft: w.draft() });
    const variable = await w.execute({
      operation: "variable.add",
      name: "width",
      valueText: "60",
      intent: "fulfill",
    });
    const variableId = variable.discovery!.variables!.find(
      (v) => v.name === "width",
    )!.variableId;
    async function rectangle(
      start: [number, number],
      end: [number, number],
      width: string,
    ) {
      await w.execute({ operation: "sketch.begin", plane: "xy" });
      await w.author({ kind: "rectangle", start, end });
      const sketchTarget = w
        .current()
        .discovery!.references.filter(
          (r) => r.label === "Sketch Draft" && r.target.kind === "sketch",
        )
        .at(-1)!.target;
      if (sketchTarget.kind !== "sketch") throw new Error("Missing draft sketch");
      const sketchId = sketchTarget.sketchId;
      function own(label: string) {
        const matches = w
          .current()
          .discovery!.references.filter(
            (r) =>
              r.label === label &&
              "sketchId" in r.target &&
              r.target.sketchId === sketchId,
          );
        expect(matches).toHaveLength(1);
        return matches[0]!.target;
      }
      const dimension = await w.execute({
        operation: "sketch.requirement.add",
        draft: w.draft(),
        tool: "dimensionDistance",
        mode: "driving",
        value: end[0] - start[0],
        targets: [own("Rectangle 1 bottom")],
        intent: "fulfill",
      });
      await w.execute({
        operation: "sketch.dimension.update",
        draft: w.draft(),
        dimensionId:
          dimension.discovery!.sketch!.requirements.at(-1)!.dimensionId,
        value: width,
        intent: "fulfill",
      });
      const origin = w
        .current()
        .discovery!.sketch!.operands.find(
          (r) => r.label === "Sketch origin",
        )!.target;
      if (start[0] === 0 && start[1] === 0) {
        await w.execute({
          operation: "sketch.requirement.add",
          draft: w.draft(),
          tool: "constraintCoincident",
          mode: "driving",
          value: null,
          targets: [own("Rectangle 1 bottom left"), origin],
          intent: "fulfill",
        });
      } else {
        for (const tool of ["dimensionHorizontal", "dimensionVertical"]) {
          await w.execute({
            operation: "sketch.requirement.add",
            draft: w.draft(),
            tool,
            mode: "driving",
            value: 2,
            targets: [origin, own("Rectangle 1 bottom left")],
            intent: "fulfill",
          });
        }
      }
      expect(w.current().discovery!.sketch!.solveStatus.solveState).toBe("solved");
      const published = await w.execute({
        operation: "sketch.publish",
        draft: w.draft(),
        requireProfiles: true,
      });
      const sketch = published.discovery!.sketch!;
      return {
        kind: "region",
        sketchId: sketch.sketchId,
        regionId: sketch.profiles[0]!.regionId,
      };
    }
    const profile = await rectangle([0, 0], [60, 40], "width");
    const solid = await w.execute({
      operation: "extrude.create",
      profile,
      depth: 25,
      intent: "fulfill",
    });
    const bodyId = solid.discovery!.model!.bodies[0]!.bodyId;
    const pocket = await rectangle([2, 2], [58, 38], "width - 4");
    const cut = await w.execute({
      operation: "extrude.create",
      parameters: {
        resultBodyType: "solid",
        profiles: [pocket],
        startExtent: {
          kind: "blindOffset",
          direction: "positive",
          distance: { source: "literal", value: 2 },
        },
        extent: {
          mode: "oneSide",
          end: {
            kind: "blind",
            direction: "positive",
            distance: { source: "literal", value: 23 },
          },
        },
        operation: { source: "literal", value: "cut" },
        booleanScope: { kind: "targetBody", bodyId },
      },
      intent: "fulfill",
    });
    const inner = innerPocketEdges(cut);
    expect(inner).toHaveLength(4);
    const filleted = await w.execute({
      operation: "fillet.create",
      parameters: {
        edgeTargets: inner.map((s) => s.reference),
        radius: { source: "literal", value: 1 },
      },
      intent: "fulfill",
    });
    const rebuilt = await w.execute({
      operation: "variable.update",
      variableId,
      name: "width",
      valueText: "80",
      intent: "fulfill",
    });

    expect(rebuilt.outcome.kind, JSON.stringify(rebuilt.diagnostics)).toBe(
      "completed",
    );
    expect(rebuilt.completion.geometry.kind).toBe("current");
    const body = rebuilt.discovery!.model!.bodies[0]!;
    for (const [index, value] of [0, 0, 0].entries())
      expect(body.bounds!.min[index]).toBeCloseTo(value, 5);
    for (const [index, value] of [80, 40, 25].entries())
      expect(body.bounds!.max[index]).toBeCloseTo(value, 5);
    const rounds = body.topology!.filter(
      (s) => s.entityClass === "face" && s.geometryType === "cylinder",
    );
    expect(rounds).toHaveLength(4);
    for (const round of rounds)
      expect(round.definingData!.radius).toBeCloseTo(1, 6);
    expect(Math.min(...rounds.map((s) => s.boundingBox!.low[0]))).toBeCloseTo(
      2,
      5,
    );
    expect(Math.max(...rounds.map((s) => s.boundingBox!.high[0]))).toBeCloseTo(
      78,
      5,
    );

    // Inspect the cut stage again: the moving right-hand edges must retain
    // their original durable IDs, not freshly minted native geometry IDs.
    const featureId = filleted.discovery!.model!.features.find(
      (f) => f.kind === "fillet",
    )!.featureId;
    const suppressed = await w.execute({
      operation: "feature.suppression.set",
      featureId,
      suppressed: true,
      intent: "fulfill",
    });
    const retained = innerPocketEdges(suppressed);
    expect(retained).toHaveLength(4);
    expect(retained.map((s) => s.reference)).toEqual(
      expect.arrayContaining(inner.map((s) => s.reference)),
    );
    for (const edge of retained) {
      const previous = inner.find(
        (s) => JSON.stringify(s.reference) === JSON.stringify(edge.reference),
      )!;
      const oldX = previous.boundingBox!.low[0];
      expect(edge.boundingBox!.low[0]).toBeCloseTo(oldX > 50 ? 78 : 2, 5);
    }
    const restored = await w.execute({
      operation: "feature.suppression.set",
      featureId,
      suppressed: false,
      intent: "fulfill",
    });
    expect(restored.completion.geometry.kind).toBe("current");
    expect(
      restored.discovery!.model!.bodies[0]!.topology!.filter(
        (s) => s.entityClass === "face" && s.geometryType === "cylinder",
      ),
    ).toHaveLength(4);
  } finally {
    await w.close();
  }
}, 180_000);
