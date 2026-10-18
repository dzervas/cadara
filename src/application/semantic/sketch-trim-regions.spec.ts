import { expect, it } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

// Migrated from e2e/sketch-trim.spec.ts: Trim as one labelled private action,
// its Undo/Redo, and the regions the final derivation publishes. The browser
// row's hover-pick only chose the target; the trim interval is the production
// query's (first to last crossing), which the session runs unchanged.

type Workflow = Awaited<ReturnType<typeof createSketchWorkflow>>;

function lastEntityRef(f: Workflow) {
  return f
    .current()
    .discovery!.references.filter((r) => r.target.kind === "sketchEntity")
    .at(-1)!.target;
}

it("trims a spline arch between two crossing lines into two spline pieces as one 'Trim' action, replays it with Undo/Redo, and leaves the two outer regions", async () => {
  const f = await createSketchWorkflow();
  try {
    await f.author({
      kind: "spline",
      fitPoints: [
        [-20, 0],
        [0, 20],
        [20, 0],
      ],
    });
    const arch = lastEntityRef(f);
    const archId = f.current().discovery!.sketch!.entities[0]!.entityId;
    await f.author({ kind: "line", start: [20, 0], end: [-20, 0] });
    // Share the arch's end identities, as the browser's endpoint snap does.
    const ref = (label: string) =>
      f.current().discovery!.references.find((r) => r.label === label)!.target;
    for (const [target, destination] of [
      ["Line 2 start", "Spline 1 point 3"],
      ["Line 2 end", "Spline 1 point 1"],
    ])
      await f.execute({
        operation: "sketch.geometry.update",
        draft: f.draft(),
        edit: {
          kind: "mergePoints",
          target: ref(target),
          destination: ref(destination),
        },
        intent: "fulfill",
      });
    for (const x of [-10, 10])
      await f.author({ kind: "line", start: [x, -5], end: [x, 25] });
    const before = f.current();
    expect(before.discovery!.sketch!.entities).toHaveLength(4);
    expect(
      before.discovery!.sketch!.profiles,
      "Two lines crossing the closed arch make three regions.",
    ).toHaveLength(3);

    const trimmed = await f.execute({
      operation: "sketch.geometry.update",
      draft: before.discovery!.state.draft,
      edit: { kind: "trim", target: arch },
      intent: "fulfill",
    });
    const sketch = trimmed.discovery!.sketch!;
    const at = (id: string) =>
      sketch.points.find((p) => p.pointId === id)!.position;
    const splines = sketch.entities.filter((e) => e.kind === "spline");
    expect(sketch.entities).toHaveLength(5);
    expect(splines).toHaveLength(2);
    expect(splines[0]!.entityId).toBe(archId);
    // The kept pieces run from the arch's ends to the two crossings.
    const ends = splines.map((e) => [
      at(e.pointIds[0]!),
      at(e.pointIds.at(-1)!),
    ]);
    expect(ends[0]![0]).toEqual([-20, 0]);
    expect(ends[0]![1]![0]).toBeCloseTo(-10, 6);
    expect(ends[1]![0]![0]).toBeCloseTo(10, 6);
    expect(ends[1]![1]).toEqual([20, 0]);
    expect(ends[0]![1]![1]).toBeGreaterThan(0);
    expect(ends[1]![0]![1]).toBeCloseTo(ends[0]![1]![1], 6);
    expect(trimmed.discovery!.history!.undoEntries!.at(-1)!.label).toBe("Trim");
    expect(trimmed.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    expect(
      sketch.profiles,
      "After the Trim the middle region lost its arch; the two outer ones remain.",
    ).toHaveLength(2);

    const undone = await f.execute({
      operation: "history.undo",
      draft: trimmed.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities).toEqual(
      before.discovery!.sketch!.entities,
    );
    expect(undone.discovery!.sketch!.profiles).toHaveLength(3);
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities).toEqual(sketch.entities);
    expect(redone.discovery!.sketch!.points).toEqual(sketch.points);
    expect(redone.discovery!.sketch!.profiles).toHaveLength(2);

    const published = await f.execute({
      operation: "sketch.publish",
      draft: redone.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(published.discovery!.sketch!.profiles).toHaveLength(2);
  } finally {
    await f.close();
  }
}, 30000);

it("trims a line crossing a rectangle down to its two outside pieces as one 'Trim' action, replays it with Undo/Redo, and leaves the rectangle one region", async () => {
  const f = await createSketchWorkflow();
  try {
    await f.author({ kind: "rectangle", start: [0, 0], end: [20, 10] });
    await f.author({ kind: "line", start: [15, -5], end: [15, 15] });
    const crossing = lastEntityRef(f);
    const crossingId = f.current().discovery!.sketch!.entities.at(-1)!.entityId;
    const before = f.current();
    expect(before.discovery!.sketch!.entities).toHaveLength(5);
    expect(
      before.discovery!.sketch!.profiles,
      "The crossing line splits the rectangle in two.",
    ).toHaveLength(2);

    const trimmed = await f.execute({
      operation: "sketch.geometry.update",
      draft: before.discovery!.state.draft,
      edit: { kind: "trim", target: crossing },
      intent: "fulfill",
    });
    const sketch = trimmed.discovery!.sketch!;
    const at = (id: string) =>
      sketch.points.find((p) => p.pointId === id)!.position;
    expect(sketch.entities).toHaveLength(6);
    const pieces = sketch.entities.slice(4);
    expect(pieces[0]!.entityId).toBe(crossingId);
    expect(pieces.map((e) => e.pointIds.map(at))).toEqual([
      [
        [15, -5],
        [15, 0],
      ],
      [
        [15, 10],
        [15, 15],
      ],
    ]);
    expect(trimmed.discovery!.history!.undoEntries!.at(-1)!.label).toBe("Trim");
    expect(trimmed.discovery!.history!.undoEntries).toHaveLength(
      before.discovery!.history!.undoEntries!.length + 1,
    );
    expect(
      sketch.profiles,
      "After the Trim the rectangle is one region.",
    ).toHaveLength(1);

    const undone = await f.execute({
      operation: "history.undo",
      draft: trimmed.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.entities).toEqual(
      before.discovery!.sketch!.entities,
    );
    expect(undone.discovery!.sketch!.profiles).toHaveLength(2);
    const redone = await f.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(redone.discovery!.sketch!.entities).toEqual(sketch.entities);
    expect(redone.discovery!.sketch!.points).toEqual(sketch.points);
    expect(redone.discovery!.sketch!.profiles).toHaveLength(1);

    const published = await f.execute({
      operation: "sketch.publish",
      draft: redone.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(published.discovery!.sketch!.profiles).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 30000);
