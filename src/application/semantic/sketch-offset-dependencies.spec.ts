import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("removing an upstream offset breaks its dependent relationship without exposing last-good profiles", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const first = await w.execute({
      operation: "sketch.offset.create",
      draft: source.discovery!.state.draft,
      targets: [
        source.discovery!.references.find(
          (r) => r.target.kind === "sketchEntity",
        )!.target,
      ],
      distance: 2,
      side: "right",
      intent: "fulfill",
    });
    const firstOffset = first.discovery!.sketch!.offsets[0]!;
    const output = first.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === firstOffset.outputEntityIds[0],
    )!.target;
    const second = await w.execute({
      operation: "sketch.offset.create",
      draft: first.discovery!.state.draft,
      targets: [output],
      distance: 1,
      side: "right",
      intent: "fulfill",
    });
    expect(
      second.discovery!.sketch!.offsets.map(
        (r) => r.currentGeometry![0]!.radius,
      ),
    ).toEqual([7, 8]);
    const removed = await w.execute({
      operation: "sketch.offset.remove",
      draft: second.discovery!.state.draft,
      derivationId: firstOffset.derivationId,
      intent: "author-invalid",
    });
    expect(removed.discovery!.sketch!.offsets).toHaveLength(1);
    expect(removed.discovery!.sketch!.offsets[0]!.health.kind).toBe("broken");
    expect(removed.discovery!.sketch!.offsets[0]!.currentGeometry).toBeNull();
    expect(removed.discovery!.sketch!.profiles).toHaveLength(1); // Only the independent source circle remains usable.
    expect(
      removed.discovery!.sketch!.entities.some(
        (e) => e.entityId === firstOffset.outputEntityIds[0],
      ),
    ).toBe(false);
    expect(removed.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Remove Offset",
    );
    const undo = await w.execute({
      operation: "history.undo",
      draft: removed.discovery!.state.draft,
    });
    expect(
      undo.discovery!.sketch!.offsets.find(
        (r) => r.derivationId === firstOffset.derivationId,
      )!.currentGeometry![0]!.radius,
    ).toBe(7);
    expect(
      undo.discovery!.sketch!.offsets.find(
        (r) =>
          r.derivationId === second.discovery!.sketch!.offsets[1]!.derivationId,
      )!.currentGeometry![0]!.radius,
    ).toBe(8);
    expect(undo.discovery!.sketch!.profiles).toHaveLength(3);
  } finally {
    await w.close();
  }
}, 120_000);

test("offset seed and distance refusals leave geometry and authored actions unchanged", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const target = source.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity",
    )!.target;
    for (const input of [
      { targets: [], distance: 1 },
      { targets: [target, target], distance: 1 },
      { targets: [target], distance: 0 },
      { targets: [target], distance: -1 },
      { targets: [target], distance: 6 },
      { targets: [{ ...target, sketchId: "sketch_foreign" }], distance: 1 },
    ]) {
      const result = await w.run({
        operation: "sketch.offset.create",
        draft: source.discovery!.state.draft,
        side: "left",
        intent: "fulfill",
        ...input,
      });
      expect(result.outcome.kind).toBe("rejected");
      expect(result.completion.live.kind).toBe("unchanged");
      const inspect = await w.execute({
        operation: "sketch.inspect",
        draft: source.discovery!.state.draft,
      });
      expect(inspect.discovery!.sketch!.entities).toEqual(
        source.discovery!.sketch!.entities,
      );
      expect(inspect.discovery!.history!.undoEntries!).toEqual(
        source.discovery!.history!.undoEntries!,
      );
    }
    const offset = await w.execute({
      operation: "sketch.offset.create",
      draft: source.discovery!.state.draft,
      targets: [target],
      distance: 1,
      side: "right",
      intent: "fulfill",
    });
    const stale = await w.run({
      operation: "sketch.offset.create",
      draft: source.discovery!.state.draft,
      targets: [target],
      distance: 1,
      side: "right",
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    const inspect = await w.execute({
      operation: "sketch.inspect",
      draft: offset.discovery!.state.draft,
    });
    expect(inspect.discovery!.sketch!.offsets).toEqual(
      offset.discovery!.sketch!.offsets,
    );
  } finally {
    await w.close();
  }
}, 120_000);
