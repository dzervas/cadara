import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("a datum mirror couples edits on either side and is one undoable authored action", async () => {
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
    const axis = source.discovery!.sketch!.operands.find(
      (r) =>
        r.target.kind === "sketchDatumReference" &&
        r.target.datumId === "yAxis",
    )!.target;
    const mirror = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [seed],
      axis,
      intent: "fulfill",
    });
    expect(mirror.discovery!.sketch!.entities).toHaveLength(2);
    expect(mirror.discovery!.sketch!.profiles).toHaveLength(2);
    const circles = mirror.discovery!.sketch!.entities;
    const positions = () =>
      w.current().discovery!.sketch!.points.map((p) => p.position);
    expect(positions()).toEqual([
      [4, 3],
      [-4, 3],
    ]);
    expect(mirror.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Mirror",
    );
    const copy = mirror.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === circles[1]!.entityId,
    )!.target;
    const edited = await w.execute({
      operation: "sketch.geometry.update",
      draft: mirror.discovery!.state.draft,
      edit: { kind: "translate", target: copy, delta: [-2, 1] },
      intent: "fulfill",
    });
    // Drag destinations are soft minimum-motion targets; reflection is a hard coupling.
    expect(positions()[0]![0]).toBeCloseTo(6, 3);
    expect(positions()[0]![1]).toBeCloseTo(4, 3);
    expect(positions()[1]![0]).toBeCloseTo(-6, 3);
    expect(positions()[1]![1]).toBeCloseTo(4, 3);
    expect(positions()[1]![0]).toBe(-positions()[0]![0]);
    expect(positions()[1]![1]).toBe(positions()[0]![1]);
    const undoEdit = await w.execute({
      operation: "history.undo",
      draft: edited.discovery!.state.draft,
    });
    expect(positions()).toEqual([
      [4, 3],
      [-4, 3],
    ]);
    const undoMirror = await w.execute({
      operation: "history.undo",
      draft: undoEdit.discovery!.state.draft,
    });
    expect(undoMirror.discovery!.sketch!.entities).toHaveLength(1);
    const redo = await w.execute({
      operation: "history.redo",
      draft: undoMirror.discovery!.state.draft,
    });
    expect(redo.discovery!.sketch!.entities.map((e) => e.entityId)).toEqual(
      circles.map((e) => e.entityId),
    );
    const receipt = redo.completion.geometry;
    if (receipt.kind === "not-required")
      throw new Error("Expected mirror geometry completion.");
    expect(receipt.kind).toBe("current");
    expect(receipt.solve!.generation).toBe(
      redo.discovery!.state.draft!.generation,
    );
    expect(receipt.derivation!.generation).toBe(receipt.solve!.generation);
    const sourceMoved = await w.execute({
      operation: "sketch.geometry.update",
      draft: redo.discovery!.state.draft,
      edit: { kind: "translate", target: seed, delta: [1, 2] },
      intent: "fulfill",
    });
    expect(positions()[0]![0]).toBeCloseTo(5, 3);
    expect(positions()[0]![1]).toBeCloseTo(5, 3);
    const reflected =
      sourceMoved.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points[0]!
        .position;
    expect(reflected[0]).toBeCloseTo(-5, 3);
    expect(reflected[1]).toBeCloseTo(5, 3);
    expect(sourceMoved.discovery!.sketch!.profiles).toHaveLength(2);
  } finally {
    await w.close();
  }
}, 120_000);
