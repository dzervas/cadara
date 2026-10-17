import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("removing an upstream mirror blocks dependent profiles; replacing the missing original repairs the same copy", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const seed = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const first = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [seed],
      axis: source.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch Y axis",
      )!.target,
      intent: "fulfill",
    });
    const upstream = first.discovery!.sketch!.mirrors[0]!;
    const upstreamCopy = first.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === upstream.outputEntityIds[0],
    )!.target;
    const second = await w.execute({
      operation: "sketch.mirror.create",
      draft: first.discovery!.state.draft,
      targets: [upstreamCopy],
      axis: first.discovery!.sketch!.operands.find(
        (r) => r.label === "Sketch X axis",
      )!.target,
      intent: "fulfill",
    });
    const downstream = second.discovery!.sketch!.mirrors[1]!;
    expect(downstream.currentGeometry![0]!.points[0]!.position).toEqual([
      -4, -3,
    ]);
    expect(second.discovery!.sketch!.profiles).toHaveLength(3);
    const replacement = await w.execute({
      operation: "sketch.author",
      draft: second.discovery!.state.draft,
      primitive: { kind: "circle", center: [10, 5], radius: 3 },
      construction: false,
      intent: "fulfill",
    });
    const newSeedId = replacement.discovery!.sketch!.entities.at(-1)!.entityId;
    const newSeed = replacement.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" && r.target.entityId === newSeedId,
    )!.target;
    const downstreamCopy = replacement.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === downstream.outputEntityIds[0],
    )!.target;
    const loop = await w.run({
      operation: "sketch.mirror.repair",
      draft: replacement.discovery!.state.draft,
      derivationId: upstream.derivationId,
      repair: {
        kind: "original",
        output: upstreamCopy,
        target: downstreamCopy,
      },
      intent: "fulfill",
    });
    expect(loop.outcome.kind).toBe("rejected");
    expect(loop.completion.live.kind).toBe("unchanged");
    const removed = await w.run({
      operation: "sketch.mirror.remove",
      draft: replacement.discovery!.state.draft,
      derivationId: upstream.derivationId,
      intent: "author-invalid",
    });
    expect(removed.outcome.kind).toBe("accepted-invalid");
    expect(removed.discovery!.sketch!.mirrors).toHaveLength(1);
    expect(removed.discovery!.sketch!.mirrors[0]!.brokenReason).not.toBeNull();
    expect(removed.discovery!.sketch!.mirrors[0]!.currentGeometry).toBeNull();
    expect(removed.discovery!.sketch!.profiles).toHaveLength(0);
    const repaired = await w.execute({
      operation: "sketch.mirror.repair",
      draft: removed.discovery!.state.draft,
      derivationId: downstream.derivationId,
      repair: { kind: "original", output: downstreamCopy, target: newSeed },
      intent: "fulfill",
    });
    expect(repaired.discovery!.sketch!.mirrors[0]!.derivationId).toBe(
      downstream.derivationId,
    );
    expect(repaired.discovery!.sketch!.mirrors[0]!.outputEntityIds).toEqual(
      downstream.outputEntityIds,
    );
    expect(
      repaired.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position,
    ).toEqual([10, -5]);
    expect(
      repaired.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.radius,
    ).toBe(3);
    expect(repaired.discovery!.sketch!.profiles).toHaveLength(3);
    expect(repaired.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Replace Mirror Original",
    );
    const undoRepair = await w.run({
      operation: "history.undo",
      draft: repaired.discovery!.state.draft,
    });
    expect(undoRepair.discovery!.sketch!.profiles).toHaveLength(0);
    const undoRemoval = await w.execute({
      operation: "history.undo",
      draft: undoRepair.discovery!.state.draft,
    });
    expect(undoRemoval.discovery!.sketch!.profiles).toHaveLength(4);
    expect(
      undoRemoval.discovery!.sketch!.mirrors.map((r) => r.derivationId).sort(),
    ).toEqual([upstream.derivationId, downstream.derivationId].sort());
  } finally {
    await w.close();
  }
}, 120_000);

test("copy movement preserves an explicit line axis; explicitly moving that axis updates the same reflected copy", async () => {
  const w = await createSketchWorkflow();
  try {
    const line = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "line", start: [0, -10], end: [0, 10] },
      construction: true,
      intent: "fulfill",
    });
    const axis = line.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    const axisPoints = line.discovery!.sketch!.points;
    const circle = await w.execute({
      operation: "sketch.author",
      draft: line.discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const seed = circle.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === circle.discovery!.sketch!.entities[1]!.entityId,
    )!.target;
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: circle.discovery!.state.draft,
      targets: [seed],
      axis,
      intent: "fulfill",
    });
    const relationship = mirrored.discovery!.sketch!.mirrors[0]!;
    const copy = mirrored.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === relationship.outputEntityIds[0],
    )!.target;
    const moved = await w.execute({
      operation: "sketch.geometry.update",
      draft: mirrored.discovery!.state.draft,
      edit: { kind: "translate", target: copy, delta: [-2, 1] },
      intent: "fulfill",
    });
    expect(moved.discovery!.sketch!.points.slice(0, 2)).toEqual(axisPoints);
    expect(
      moved.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position[0],
    ).toBeCloseTo(-6, 3);
    const movedAxis = await w.execute({
      operation: "sketch.geometry.update",
      draft: moved.discovery!.state.draft,
      edit: { kind: "translate", target: axis, delta: [1, 0] },
      intent: "fulfill",
    });
    for (const point of movedAxis.discovery!.sketch!.points.slice(0, 2))
      expect(point.position[0]).toBeCloseTo(1, 3);
    expect(
      movedAxis.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position[0],
    ).toBeCloseTo(-4, 2);
    expect(
      movedAxis.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position[1],
    ).toBeCloseTo(4, 3);
    expect(movedAxis.discovery!.sketch!.mirrors[0]!.outputEntityIds).toEqual(
      relationship.outputEntityIds,
    );
    expect(movedAxis.discovery!.sketch!.profiles).toHaveLength(2);
  } finally {
    await w.close();
  }
}, 120_000);
