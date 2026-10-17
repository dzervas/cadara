import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("a durable circle offset is certified, follows its source and is one undoable action", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [0, 0], radius: 5 },
      construction: false,
      intent: "fulfill",
    });
    const entity = source.discovery!.sketch!.entities[0]!;
    const target = source.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchEntity" &&
        r.target.entityId === entity.entityId,
    )!.target;
    const offset = await w.execute({
      operation: "sketch.offset.create",
      draft: source.discovery!.state.draft,
      targets: [target],
      distance: 2,
      side: "right",
      intent: "fulfill",
    });
    expect(offset.discovery!.sketch!.entities.map((e) => e.radius)).toEqual([
      5, 7,
    ]);
    expect(offset.discovery!.sketch!.offsets).toHaveLength(1);
    expect(offset.discovery!.sketch!.offsets[0]!.health.kind).toBe("healthy");
    expect(offset.discovery!.sketch!.profiles).toHaveLength(2);
    const receipt = offset.completion.geometry;
    if (receipt.kind === "not-required")
      throw new Error("Expected offset geometry completion.");
    expect(receipt.kind).toBe("current");
    expect(receipt.derivation!.generation).toBe(
      offset.discovery!.state.draft!.generation,
    );
    expect(receipt.solve!.generation).toBe(receipt.derivation!.generation);
    expect(offset.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Commit Offset",
    );
    const moved = await w.execute({
      operation: "sketch.geometry.update",
      draft: offset.discovery!.state.draft,
      edit: { kind: "radius", target, radius: 8 },
      intent: "fulfill",
    });
    expect(moved.discovery!.sketch!.entities.map((e) => e.radius)).toEqual([
      8, 7,
    ]); // Authored output placeholder is not solved geometry.
    expect(
      moved.discovery!.sketch!.offsets[0]!.currentGeometry!.map(
        (e) => e.radius,
      ),
    ).toEqual([10]);
    expect(moved.discovery!.sketch!.offsets[0]!.derivationId).toBe(
      offset.discovery!.sketch!.offsets[0]!.derivationId,
    );
    const undo = await w.execute({
      operation: "history.undo",
      draft: moved.discovery!.state.draft,
    });
    expect(undo.discovery!.sketch!.entities.map((e) => e.radius)).toEqual([
      5, 7,
    ]);
    const undoneOffset = await w.execute({
      operation: "history.undo",
      draft: undo.discovery!.state.draft,
    });
    expect(
      undoneOffset.discovery!.sketch!.entities.map((e) => e.radius),
    ).toEqual([5]);
    const redo = await w.execute({
      operation: "history.redo",
      draft: undoneOffset.discovery!.state.draft,
    });
    expect(redo.discovery!.sketch!.entities.map((e) => e.radius)).toEqual([
      5, 7,
    ]);
    expect(redo.discovery!.sketch!.offsets[0]!.derivationId).toBe(
      offset.discovery!.sketch!.offsets[0]!.derivationId,
    );
    const outputId = redo.discovery!.sketch!.offsets[0]!.outputEntityIds[0];
    const output = redo.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity" && r.target.entityId === outputId,
    )!.target;
    const sized = await w.execute({
      operation: "sketch.requirement.add",
      draft: redo.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [output],
      mode: "driving",
      value: 9,
      intent: "fulfill",
    });
    expect(
      sized.discovery!.sketch!.offsets[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(9, 7);
    expect(sized.discovery!.sketch!.offsets[0]!.distance).toEqual({
      source: "literal",
      value: -2,
    });
    const dimensionId = sized.discovery!.sketch!.requirements[0]!.dimensionId;
    const changed = await w.execute({
      operation: "sketch.dimension.update",
      draft: sized.discovery!.state.draft,
      dimensionId,
      value: 12,
      intent: "fulfill",
    });
    expect(
      changed.discovery!.sketch!.offsets[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(12, 7);
    expect(changed.discovery!.sketch!.requirements[0]!.dimensionId).toBe(
      dimensionId,
    );
  } finally {
    await w.close();
  }
}, 120_000);
