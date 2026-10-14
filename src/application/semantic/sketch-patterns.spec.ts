import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("a durable linear sketch pattern follows seed edits and survives history and publication", async () => {
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
    const patterned = await w.execute({
      operation: "sketch.derivation.create",
      draft: source.discovery!.state.draft,
      kind: "linearPattern",
      targets: [seed],
      value: 10,
      intent: "fulfill",
    });
    const relationship = patterned.discovery!.sketch!.derivations[0]!;
    expect(relationship.definition.kind).toBe("linearPattern");
    expect(relationship.currentGeometry![0]!.points[0]!.position).toEqual([
      14, 3,
    ]);
    expect(relationship.currentGeometry![0]!.radius).toBe(2);
    expect(patterned.discovery!.sketch!.profiles).toHaveLength(2);
    expect(patterned.discovery!.history!.undoEntries!).toHaveLength(
      source.discovery!.history!.undoEntries!.length + 1,
    );
    expect(patterned.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Sketch Linear Pattern",
    );
    const moved = await w.execute({
      operation: "sketch.geometry.update",
      draft: patterned.discovery!.state.draft,
      edit: { kind: "translate", target: seed, delta: [1, 2] },
      intent: "fulfill",
    });
    expect(
      moved.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.points[0]!
        .position[0],
    ).toBeCloseTo(15, 3);
    expect(
      moved.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.points[0]!
        .position[1],
    ).toBeCloseTo(5, 3);
    expect(
      moved.discovery!.sketch!.derivations[0]!.definition.derivationId,
    ).toBe(relationship.definition.derivationId);
    const undo = await w.execute({
      operation: "history.undo",
      draft: moved.discovery!.state.draft,
    });
    expect(
      undo.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.points[0]!
        .position,
    ).toEqual([14, 3]);
    const published = await w.execute({
      operation: "sketch.publish",
      draft: undo.discovery!.state.draft,
      requireProfiles: true,
    });
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: published.discovery!.sketch!.sketchId,
    });
    expect(reopened.discovery!.sketch!.derivations[0]!.definition).toEqual(
      relationship.definition,
    );
    expect(
      reopened.discovery!.sketch!.derivations[0]!.currentGeometry![0]!
        .points[0]!.position,
    ).toEqual([14, 3]);
    expect(reopened.discovery!.sketch!.profiles).toHaveLength(2);
  } finally {
    await w.close();
  }
}, 120_000);

test("source driving requirements update durable pattern outputs without replacing relationships", async () => {
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
    const patterned = await w.execute({
      operation: "sketch.derivation.create",
      draft: source.discovery!.state.draft,
      kind: "linearPattern",
      targets: [seed],
      value: 10,
      intent: "fulfill",
    });
    const definition = patterned.discovery!.sketch!.derivations[0]!.definition;
    const sized = await w.execute({
      operation: "sketch.requirement.add",
      draft: patterned.discovery!.state.draft,
      tool: "dimensionRadius",
      targets: [seed],
      mode: "driving",
      value: 3,
      intent: "fulfill",
    });
    expect(
      sized.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(3, 7);
    const dimensionId = sized.discovery!.sketch!.requirements[0]!.dimensionId;
    const changed = await w.execute({
      operation: "sketch.dimension.update",
      draft: sized.discovery!.state.draft,
      dimensionId,
      value: 4,
      intent: "fulfill",
    });
    expect(
      changed.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(4, 7);
    expect(changed.discovery!.sketch!.derivations[0]!.definition).toEqual(
      definition,
    );
    expect(changed.discovery!.sketch!.requirements[0]!.dimensionId).toBe(
      dimensionId,
    );
    expect(changed.discovery!.sketch!.profiles).toHaveLength(2);
    const undo = await w.execute({
      operation: "history.undo",
      draft: changed.discovery!.state.draft,
    });
    expect(
      undo.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.radius,
    ).toBeCloseTo(3, 7);
  } finally {
    await w.close();
  }
}, 120_000);
