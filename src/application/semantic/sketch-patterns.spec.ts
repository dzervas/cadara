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

for (const kind of ["linearPattern", "circularPattern", "transform"] as const) {
  for (const primitiveKind of ["circle", "arc", "spline"] as const) {
    const editKind = primitiveKind === "spline" ? "tangent" : "radius";
    test(`${kind} source ${primitiveKind} ${editKind} edits refresh copies and validity in one undoable action`, async () => {
      const w = await createSketchWorkflow();
      try {
        // Authored arcs bind their endpoints and take the solved path,
        // rather than the unconstrained circle/spline write fast path.
        const source = await w.author(
          primitiveKind === "circle"
            ? { kind: "circle", center: [4, 3], radius: 2 }
            : primitiveKind === "arc"
              ? {
                  kind: "centerPointArc",
                  center: [4, 3],
                  start: [6, 3],
                  end: [4, 5],
                }
              : {
                  kind: "spline",
                  fitPoints: [[0, 0], [4, 3], [8, 0]],
                },
        );
        const seed = source.discovery!.sketch!.entities[0]!;
        const created = await w.execute({
          operation: "sketch.derivation.create",
          draft: w.draft(),
          kind,
          targets: [w.ref(seed.entityId)],
          value: kind === "circularPattern" ? Math.PI / 2 : 10,
          intent: "fulfill",
        });
        const relationship = created.discovery!.sketch!.derivations[0]!;
        const occurrence = seed.tangents?.[1];
        const changed = await w.execute({
          operation: "sketch.geometry.update",
          draft: w.draft(),
          edit:
            editKind === "radius"
              ? { kind: "radius", target: w.ref(seed.entityId), radius: 3 }
              : {
                  kind: "tangent",
                  target: {
                    kind: "sketchTangentHandle",
                    sketchId: created.discovery!.sketch!.sketchId,
                    entityId: seed.entityId,
                    pointId: occurrence!.pointId,
                    occurrenceId: occurrence!.occurrenceId,
                  },
                  vector: [2, 1],
                },
          intent: "fulfill",
        });
        expect(changed.discovery!.history!.undoEntries).toHaveLength(
          created.discovery!.history!.undoEntries!.length + 1,
        );
        const current = changed.discovery!.sketch!;
        expect(current.derivations[0]!.definition).toEqual(
          relationship.definition,
        );
        expect(current.validity.state).toBe("current");
        if (editKind === "radius") {
          const radius = current.derivations[0]!.currentGeometry![0]!.radius!;
          expect(radius).toBeCloseTo(
            current.entities.find((e) => e.entityId === seed.entityId)!.radius!,
            9,
          );
          // Document modeling tolerance; arc radius edits solve.
          expect(Math.abs(radius - 3)).toBeLessThan(0.001);
          if (primitiveKind === "circle")
            expect(current.profiles).toHaveLength(2);
        } else {
          const copy = current.entities.find(
            (e) => e.entityId === relationship.definition.outputs[0]!.outputEntityId,
          )!;
          const vector = copy.tangents![1]!.vector!;
          expect(vector[0]).toBeCloseTo(kind === "circularPattern" ? -1 : 2, 9);
          expect(vector[1]).toBeCloseTo(kind === "circularPattern" ? 2 : 1, 9);
        }
        const undo = await w.execute({
          operation: "history.undo",
          draft: w.draft(),
        });
        expect(undo.discovery!.sketch!.entities).toEqual(
          created.discovery!.sketch!.entities,
        );
        expect(undo.discovery!.sketch!.derivations).toEqual(
          created.discovery!.sketch!.derivations,
        );
        expect(undo.discovery!.history!.undoEntries).toHaveLength(
          created.discovery!.history!.undoEntries!.length,
        );
        const redo = await w.execute({
          operation: "history.redo",
          draft: w.draft(),
        });
        expect(redo.discovery!.sketch!.entities).toEqual(current.entities);
        expect(redo.discovery!.sketch!.derivations).toEqual(current.derivations);
        expect(redo.discovery!.sketch!.validity.state).toBe("current");
      } finally {
        await w.close();
      }
    }, 120_000);
  }
}

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
