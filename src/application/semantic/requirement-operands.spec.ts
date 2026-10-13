import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it.each(["dimensionDistance", "dimensionHorizontal", "dimensionVertical"])(
  "preserves %s datum origin operands and discovers read-only operands",
  async (tool) => {
    const f = await createSketchWorkflow();
    try {
      const created = await f.execute({
        operation: "sketch.author",
        draft: f.current().discovery!.state.draft,
        primitive: { kind: "point", position: [3, 4] },
        construction: false,
        intent: "fulfill",
      });
      const target = created.discovery!.references.find(
        (r) => r.target.kind === "sketchPoint",
      )!.target;
      const origin = created.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch origin",
      )!.target;
      const added = await f.execute({
        operation: "sketch.requirement.add",
        draft: created.discovery!.state.draft,
        tool,
        targets: [target, origin],
        mode: "driving",
        value: 10,
        intent: "fulfill",
      });
      expect(added.discovery!.sketch!.requirements[0]).toMatchObject({
        kind: "pointDatumDistance",
        value: 10,
      });
      expect(
        added.discovery!.sketch!.requirements[0]!.measuredValue,
      ).toBeCloseTo(10, 6);
      const [x, y] = added.discovery!.sketch!.points[0]!.position;
      expect(
        tool === "dimensionHorizontal"
          ? Math.abs(x)
          : tool === "dimensionVertical"
            ? Math.abs(y)
            : Math.hypot(x, y),
      ).toBeCloseTo(10, 6);
    } finally {
      await f.close();
    }
  },
  60000,
);

it("uses a datum axis as a read-only parallel operand and refuses absent projected geometry unchanged", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 2] },
      construction: false,
      intent: "fulfill",
    });
    const target = created.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const axis = created.discovery!.sketch!.operands.find(
      (r) => r.label === "Sketch X axis",
    )!.target;
    const added = await f.execute({
      operation: "sketch.requirement.add",
      draft: created.discovery!.state.draft,
      tool: "constraintParallel",
      targets: [target, axis],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    expect(added.discovery!.sketch!.constraints).toMatchObject([
      { kind: "parallelProjectedLine", status: "satisfied" },
    ]);
    const positions = added.discovery!.sketch!.points.map((p) => p.position);
    // Parallelism is angular; assert the declared document tolerance rather than an arbitrary coordinate rounding.
    expect(
      Math.abs(
        Math.atan2(
          positions[1]![1] - positions[0]![1],
          positions[1]![0] - positions[0]![0],
        ),
      ),
    ).toBeLessThanOrEqual(added.discovery!.settings!.angularToleranceRadians);
    const refused = await f.run({
      operation: "sketch.requirement.add",
      draft: added.discovery!.state.draft,
      tool: "constraintParallel",
      targets: [
        target,
        {
          kind: "projectedReferenceGeometry",
          referenceId: "ref_missing",
          geometryId: "projected_geometry_missing",
          geometryKind: "lineSegment",
        },
      ],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    expect(refused.outcome.kind).toBe("rejected");
    expect(refused.completion.live.kind).toBe("unchanged");
    const inspected = await f.execute({
      operation: "sketch.inspect",
      draft: added.discovery!.state.draft,
    });
    expect(inspected.discovery!.sketch!.points.map((p) => p.position)).toEqual(
      positions,
    );
    expect(inspected.discovery!.sketch!.constraints).toEqual(
      added.discovery!.sketch!.constraints,
    );
  } finally {
    await f.close();
  }
}, 60000);
