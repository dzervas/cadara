import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

it("splits a dimensioned circle into bound arcs, migrates radius identity to diameter and retains a usable closed profile", async () => {
  const f = await createSketchWorkflow();
  try {
    const circle = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const target = circle.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const dimensioned = await f.execute({
      operation: "sketch.requirement.add",
      draft: circle.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [target],
      mode: "driving",
      value: 5,
      intent: "fulfill",
    });
    const requirement = dimensioned.discovery!.sketch!.requirements[0]!;
    const boundary = await f.execute({
      operation: "sketch.author",
      draft: dimensioned.discovery!.state.draft,
      primitive: { kind: "line", start: [-10, 0], end: [10, 0] },
      construction: true,
      intent: "fulfill",
    });
    const cutter = boundary
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const split = await f.execute({
      operation: "sketch.geometry.update",
      draft: boundary.discovery!.state.draft,
      edit: { kind: "split", target, boundary: cutter, pick: [5, 0] },
      intent: "fulfill",
    });
    const s = split.discovery!.sketch!;
    const arcs = s.entities.filter((e) => e.kind === "arc");
    expect(arcs).toHaveLength(2);
    expect(arcs[0]!.entityId).toBe(
      circle.discovery!.sketch!.entities[0]!.entityId,
    );
    for (const arc of arcs) expect(arc.radius).toBeCloseTo(5, 4);
    const ends = arcs.map((e) =>
      e.pointIds
        .slice(0, 2)
        .map((id) => s.points.find((p) => p.pointId === id)!.position),
    );
    for (const [i, expected] of [
      [
        [5, 0],
        [-5, 0],
      ],
      [
        [-5, 0],
        [5, 0],
      ],
    ].entries()) {
      for (const [j, point] of expected.entries()) {
        expect(ends[i]![j]![0]).toBeCloseTo(point[0]!, 4);
        expect(ends[i]![j]![1]).toBeCloseTo(point[1]!, 4);
      }
    }
    expect(
      s.requirements.find((d) => d.dimensionId === requirement.dimensionId),
    ).toMatchObject({ kind: "diameter", value: 10, measuredValue: 10 });
    expect(
      s.requirements.filter((d) => d.kind === "arcStartPointCoincident"),
    ).toHaveLength(2);
    expect(
      s.requirements.filter((d) => d.kind === "arcEndPointCoincident"),
    ).toHaveLength(2);
    expect(s.profiles).toHaveLength(1);
    expect(split.discovery!.history!.undoEntries).toHaveLength(
      boundary.discovery!.history!.undoEntries!.length + 1,
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: split.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities).toEqual(
      boundary.discovery!.sketch!.entities,
    );
    expect(undone.discovery!.sketch!.requirements).toEqual(
      boundary.discovery!.sketch!.requirements,
    );
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.profiles).toHaveLength(1);
    const published = await f.execute({
      operation: "sketch.publish",
      draft: redone.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(published.completion.live.kind).toBe("applied");
  } finally {
    await f.close();
  }
}, 60000);

it("splits an ordinary spline with an explicit crossing while preserving its original fit-point identities", async () => {
  const f = await createSketchWorkflow();
  try {
    const curve = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [0, 0],
          [3, 0],
          [7, 0],
          [10, 0],
        ],
      },
      construction: false,
      intent: "fulfill",
    });
    const target = curve.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const boundary = await f.execute({
      operation: "sketch.author",
      draft: curve.discovery!.state.draft,
      primitive: { kind: "line", start: [4, -5], end: [4, 5] },
      construction: true,
      intent: "fulfill",
    });
    const cutter = boundary
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const split = await f.execute({
      operation: "sketch.geometry.update",
      draft: boundary.discovery!.state.draft,
      edit: { kind: "split", target, boundary: cutter, pick: [4, 0] },
      intent: "fulfill",
    });
    const s = split.discovery!.sketch!;
    const curves = s.entities.filter((e) => e.kind === "spline");
    expect(curves).toHaveLength(2);
    const ends = curves.map((e) => [e.pointIds[0]!, e.pointIds.at(-1)!]);
    expect(ends[0]![0]).toBe(curve.discovery!.sketch!.entities[0]!.pointIds[0]);
    expect(ends[1]![1]).toBe(
      curve.discovery!.sketch!.entities[0]!.pointIds.at(-1),
    );
    expect(ends[0]![1]).toBe(ends[1]![0]);
    const cut = s.points.find((p) => p.pointId === ends[0]![1])!;
    expect(cut.position[0]).toBeCloseTo(4, 4);
    expect(cut.position[1]).toBeCloseTo(0, 4);
    for (const old of curve.discovery!.sketch!.points)
      expect(s.points.find((p) => p.pointId === old.pointId)).toEqual(old);
    expect(split.discovery!.history!.undoEntries).toHaveLength(
      boundary.discovery!.history!.undoEntries!.length + 1,
    );
    const undone = await f.execute({
      operation: "history.undo",
      draft: split.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities).toEqual(
      boundary.discovery!.sketch!.entities,
    );
  } finally {
    await f.close();
  }
}, 60000);

it("splits a bound quarter arc at [3,4] without changing radius or center, and accepts an ordinary spline boundary", async () => {
  const f = await createSketchWorkflow();
  try {
    const arc = await f.execute({
      operation: "sketch.author",
      draft: f.current().discovery!.state.draft,
      primitive: {
        kind: "centerPointArc",
        center: [0, 0],
        start: [5, 0],
        end: [0, 5],
      },
      construction: false,
      intent: "fulfill",
    });
    const target = arc.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const boundary = await f.execute({
      operation: "sketch.author",
      draft: arc.discovery!.state.draft,
      primitive: {
        kind: "spline",
        fitPoints: [
          [3, -2],
          [3, 0],
          [3, 5],
          [3, 7],
        ],
      },
      construction: true,
      intent: "fulfill",
    });
    const cutter = boundary
      .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
      .at(-1)!.target;
    const split = await f.execute({
      operation: "sketch.geometry.update",
      draft: boundary.discovery!.state.draft,
      edit: { kind: "split", target, boundary: cutter, pick: [3, 4] },
      intent: "fulfill",
    });
    const s = split.discovery!.sketch!;
    const arcs = s.entities.filter((e) => e.kind === "arc");
    expect(arcs).toHaveLength(2);
    const cut = s.points.find(
      (p) => p.pointId === arcs[0]!.pointIds[1],
    )!.position;
    expect(cut[0]).toBeCloseTo(3, 4);
    expect(cut[1]).toBeCloseTo(4, 4);
    expect(arcs[0]!.pointIds[1]).toBe(arcs[1]!.pointIds[0]);
    expect(arcs[0]!.pointIds[2]).toBe(arcs[1]!.pointIds[2]);
    expect(arcs[0]!.pointIds[0]).toBe(
      arc.discovery!.sketch!.entities[0]!.pointIds[0],
    );
    expect(arcs[1]!.pointIds[1]).toBe(
      arc.discovery!.sketch!.entities[0]!.pointIds[1],
    );
    for (const e of arcs) expect(e.radius).toBeCloseTo(5, 4);
    expect(
      s.requirements.filter((d) => d.kind === "arcStartPointCoincident"),
    ).toHaveLength(2);
    expect(
      s.requirements.filter((d) => d.kind === "arcEndPointCoincident"),
    ).toHaveLength(2);
    expect(split.discovery!.history!.undoEntries).toHaveLength(
      boundary.discovery!.history!.undoEntries!.length + 1,
    );
  } finally {
    await f.close();
  }
}, 60000);
