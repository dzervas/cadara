import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("moves an arc center as the production whole-entity intent instead of deforming its endpoints", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "centerPointArc",
        center: [0, 0],
        start: [3, 0],
        end: [0, 3],
      },
      construction: false,
      intent: "fulfill",
    });
    const center = created.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchPoint" &&
        r.target.pointId === created.discovery!.sketch!.points[0]!.pointId,
    )!.target;
    const moved = await f.execute({
      operation: "sketch.geometry.update",
      draft: created.discovery!.state.draft,
      edit: { kind: "point", target: center, position: [10, 5] },
      intent: "fulfill",
    });
    const positions = moved.discovery!.sketch!.points.map((p) => p.position);
    for (const [i, expected] of [
      [10, 5],
      [13, 5],
      [10, 8],
    ].entries()) {
      expect(positions[i]![0]).toBeCloseTo(expected[0]!, 3);
      expect(positions[i]![1]).toBeCloseTo(expected[1]!, 3);
    }
    expect(moved.discovery!.sketch!.entities[0]!.radius).toBeCloseTo(3, 3);
    expect(moved.discovery!.history!.undoEntries).toHaveLength(
      created.discovery!.history!.undoEntries!.length + 1,
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: moved.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.points).toEqual(
      created.discovery!.sketch!.points,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("refuses fixed point and body movement without changing geometry or action history, then moves after removing the requirement", async () => {
  const f = await createSketchWorkflow();
  try {
    const line = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const target = line.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const fixed = await f.execute({
      operation: "sketch.requirement.add",
      draft: line.discovery!.state.draft,
      tool: "constraintFix",
      targets: [target],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    const endpoint = fixed.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchPoint" &&
        r.target.pointId === fixed.discovery!.sketch!.points[1]!.pointId,
    )!.target;
    for (const edit of [
      { kind: "point", target: endpoint, position: [15, 5] },
      { kind: "translate", target, delta: [5, 7] },
    ]) {
      const refused = await f.run({
        operation: "sketch.geometry.update",
        draft: f.current().completion.live.state!.draft,
        edit,
        intent: "fulfill",
      });
      expect(refused.outcome).toEqual({
        kind: "rejected",
        reasonCode: "sketch-edit-refused",
      });
      expect(refused.completion.live.kind).toBe("unchanged");
      expect(refused.diagnostics.some((d) => d.message.length > 0)).toBe(true);
    }
    const inspected = await f.execute({
      operation: "sketch.inspect",
      draft: f.current().completion.live.state!.draft,
    });
    expect(inspected.discovery!.sketch!.points).toEqual(
      fixed.discovery!.sketch!.points,
    );
    expect(inspected.discovery!.history).toEqual(fixed.discovery!.history);
    // Fixing a line authors one fixed-point requirement for each endpoint.
    const requirements = fixed
      .discovery!.references.filter((r) => r.target.kind === "constraint")
      .map((r) => r.target);
    expect(requirements).toHaveLength(2);
    const freed = await f.execute({
      operation: "sketch.requirement.remove",
      draft: inspected.discovery!.state.draft,
      targets: requirements,
      intent: "fulfill",
    });
    const moved = await f.execute({
      operation: "sketch.geometry.update",
      draft: freed.discovery!.state.draft,
      edit: { kind: "translate", target, delta: [5, 7] },
      intent: "fulfill",
    });
    expect(moved.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [5, 7],
      [15, 7],
    ]);
    expect(moved.discovery!.history!.undoEntries).toHaveLength(
      freed.discovery!.history!.undoEntries!.length + 1,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("translates a dimensioned line body through the solver while retaining its driving length and identities", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const target = created.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const dimensioned = await f.execute({
      operation: "sketch.requirement.add",
      draft: created.discovery!.state.draft,
      tool: "dimensionDistance",
      targets: [target],
      mode: "driving",
      value: 10,
      intent: "fulfill",
    });
    const moved = await f.execute({
      operation: "sketch.geometry.update",
      draft: dimensioned.discovery!.state.draft,
      edit: { kind: "translate", target, delta: [5, 7] },
      intent: "fulfill",
    });
    for (const [i, expected] of [
      [5, 7],
      [15, 7],
    ].entries()) {
      expect(moved.discovery!.sketch!.points[i]!.position[0]).toBeCloseTo(
        expected[0]!,
        4,
      );
      expect(moved.discovery!.sketch!.points[i]!.position[1]).toBeCloseTo(
        expected[1]!,
        4,
      );
      expect(moved.discovery!.sketch!.points[i]!.pointId).toBe(
        created.discovery!.sketch!.points[i]!.pointId,
      );
    }
    expect(moved.discovery!.sketch!.requirements).toMatchObject([
      {
        dimensionId:
          dimensioned.discovery!.sketch!.requirements[0]!.dimensionId,
        value: 10,
      },
    ]);
    expect(moved.discovery!.sketch!.requirements[0]!.measuredValue).toBeCloseTo(
      10,
      4,
    );
    expect(moved.discovery!.history!.undoEntries).toHaveLength(
      dimensioned.discovery!.history!.undoEntries!.length + 1,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("keeps fit points distinct from authored tangent vectors and undoes each completed edit independently", async () => {
  const f = await createSketchWorkflow();
  try {
    const created = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [0, 0],
          [4, 3],
          [8, 0],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const entity = created.discovery!.sketch!.entities[0]!;
    const occurrence = entity.tangents![1]!;
    const entityRef = created.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    if (entityRef.kind !== "sketchEntity")
      throw new Error("Missing spline entity");
    const target = {
      kind: "sketchTangentHandle",
      sketchId: entityRef.sketchId,
      entityId: entity.entityId,
      pointId: occurrence.pointId,
      occurrenceId: occurrence.occurrenceId,
    };
    const tangent = await f.execute({
      operation: "sketch.geometry.update",
      draft: created.discovery!.state.draft,
      edit: { kind: "tangent", target, vector: [2, 0] },
      intent: "fulfill",
    });
    expect(tangent.discovery!.sketch!.points).toEqual(
      created.discovery!.sketch!.points,
    );
    expect(
      tangent.discovery!.sketch!.entities[0]!.tangents![1]!.vector,
    ).toEqual([2, 0]);
    expect(tangent.discovery!.history!.undoEntries).toHaveLength(
      created.discovery!.history!.undoEntries!.length + 1,
    );
    const fitTarget = created.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchPoint" &&
        r.target.pointId === occurrence.pointId,
    )!.target;
    const fit = await f.execute({
      operation: "sketch.geometry.update",
      draft: tangent.discovery!.state.draft,
      edit: { kind: "point", target: fitTarget, position: [4, 5] },
      intent: "fulfill",
    });
    expect(fit.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [0, 0],
      [4, 5],
      [8, 0],
    ]);
    expect(fit.discovery!.sketch!.entities[0]!.tangents![1]!.vector).toEqual([
      2, 0,
    ]);
    expect(fit.discovery!.history!.undoEntries).toHaveLength(
      tangent.discovery!.history!.undoEntries!.length + 1,
    );
    const undoneFit = await f.execute({
      operation: "history.undo",
      draft: fit.discovery!.state.draft,
    });
    expect(undoneFit.discovery!.sketch).toEqual(tangent.discovery!.sketch);
    const undoneTangent = await f.execute({
      operation: "history.undo",
      draft: undoneFit.discovery!.state.draft,
    });
    expect(undoneTangent.discovery!.sketch).toEqual(created.discovery!.sketch);
    await f.execute({
      operation: "history.redo",
      draft: undoneTangent.discovery!.state.draft,
    });
    const zero = await f.execute({
      operation: "sketch.geometry.update",
      draft: f.current().discovery!.state.draft,
      edit: { kind: "tangent", target, vector: [0, 0] },
      intent: "fulfill",
    });
    expect(zero.discovery!.sketch!.entities[0]!.tangents![1]!.vector).toEqual([
      0, 0,
    ]);
    expect(zero.discovery!.sketch!.points).toEqual(
      created.discovery!.sketch!.points,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("moves a constrained endpoint with minimum motion, not a rigid body translation, as one completed action", async () => {
  const f = await createSketchWorkflow();
  try {
    const line = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, 0], end: [10, 0] },
      construction: false,
      intent: "fulfill",
    });
    const target = line.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const horizontal = await f.execute({
      operation: "sketch.requirement.add",
      draft: line.discovery!.state.draft,
      tool: "constraintHorizontal",
      targets: [target],
      mode: "driving",
      value: null,
      intent: "fulfill",
    });
    const unrelated = await f.execute({
      operation: "sketch.author",
      draft: horizontal.discovery!.state.draft,
      primitive: { kind: "point", position: [30, 40] },
      construction: true,
      intent: "fulfill",
    });
    const endpoint = unrelated.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchPoint" &&
        r.target.pointId === line.discovery!.sketch!.points[1]!.pointId,
    )!.target;
    const before = unrelated.discovery!.history!.undoEntries!.length;
    const moved = await f.execute({
      operation: "sketch.geometry.update",
      draft: unrelated.discovery!.state.draft,
      edit: { kind: "point", target: endpoint, position: [15, 5] },
      intent: "fulfill",
    });
    const positions = moved.discovery!.sketch!.points.map((p) => p.position);
    expect(positions[0]![0]).toBeCloseTo(0, 4);
    expect(positions[1]![0]).toBeCloseTo(15, 4);
    expect(positions[0]![1]).toBeCloseTo(positions[1]![1], 4);
    expect(positions[1]![1]).toBeCloseTo(5, 4);
    expect(positions[2]).toEqual([30, 40]);
    expect(moved.discovery!.sketch!.constraints[0]!.status).toBe("satisfied");
    expect(moved.discovery!.history!.undoEntries).toHaveLength(before + 1);
    expect(moved.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Edit Sketch Geometry",
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: moved.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.points).toEqual(
      unrelated.discovery!.sketch!.points,
    );
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.points).toEqual(
      moved.discovery!.sketch!.points,
    );
  } finally {
    await f.close();
  }
}, 60000);
