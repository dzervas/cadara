import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("circular patterns rotate about the production origin and derived transforms create copies rather than direct moves", async () => {
  for (const kind of ["circularPattern", "transform"] as const) {
    const w = await createSketchWorkflow();
    try {
      const source = await w.execute({
        operation: "sketch.author",
        draft: w.current().discovery!.state.draft,
        primitive: { kind: "circle", center: [4, 3], radius: 2 },
        construction: false,
        intent: "fulfill",
      });
      const target = source.discovery!.references.find(
        (r) => r.target.kind === "sketchEntity",
      )!.target;
      const created = await w.execute({
        operation: "sketch.derivation.create",
        draft: source.discovery!.state.draft,
        kind,
        targets: [target],
        value: kind === "circularPattern" ? Math.PI / 2 : 10,
        intent: "fulfill",
      });
      const d = created.discovery!.sketch!.derivations[0]!;
      expect(d.definition.kind).toBe(kind);
      expect(created.discovery!.sketch!.entities).toHaveLength(2);
      expect(created.discovery!.sketch!.points[0]!.position).toEqual([4, 3]);
      const p = d.currentGeometry![0]!.points[0]!.position;
      expect(p[0]).toBeCloseTo(kind === "circularPattern" ? -3 : 14, 7);
      expect(p[1]).toBeCloseTo(kind === "circularPattern" ? 4 : 3, 7);
      expect(d.currentGeometry![0]!.radius).toBe(2);
      expect(created.discovery!.sketch!.profiles).toHaveLength(2);
      expect(d.definition.outputs[0]!.instanceIndex).toBe(1);
      const sized = await w.execute({
        operation: "sketch.geometry.update",
        draft: created.discovery!.state.draft,
        edit: { kind: "radius", target, radius: 3 },
        intent: "fulfill",
      });
      expect(
        sized.discovery!.sketch!.derivations[0]!.currentGeometry![0]!.radius,
      ).toBeCloseTo(3, 7);
      expect(sized.discovery!.sketch!.derivations[0]!.definition).toEqual(
        d.definition,
      );
      const undo = await w.execute({
        operation: "history.undo",
        draft: sized.discovery!.state.draft,
      });
      const undoCreation = await w.execute({
        operation: "history.undo",
        draft: undo.discovery!.state.draft,
      });
      expect(undoCreation.discovery!.sketch!.derivations).toHaveLength(0);
      expect(undoCreation.discovery!.sketch!.entities).toHaveLength(1);
      const redo = await w.execute({
        operation: "history.redo",
        draft: undoCreation.discovery!.state.draft,
      });
      expect(redo.discovery!.sketch!.derivations[0]!.definition).toEqual(
        d.definition,
      );
      const geometry = redo.completion.geometry;
      if (geometry.kind === "not-required")
        throw new Error("Expected correlated geometry.");
      expect(geometry.kind).toBe("current");
      expect(geometry.derivation!.generation).toBe(
        redo.discovery!.state.draft!.generation,
      );
      expect(geometry.solve!.generation).toBe(geometry.derivation!.generation);
    } finally {
      await w.close();
    }
  }
}, 120_000);

test("derived chains follow source movement and deletion blocks profile consumption instead of serving last-good geometry", async () => {
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
      operation: "sketch.derivation.create",
      draft: source.discovery!.state.draft,
      kind: "linearPattern",
      targets: [seed],
      value: 10,
      intent: "fulfill",
    });
    const copyId =
      first.discovery!.sketch!.derivations[0]!.definition.outputs[0]!
        .outputEntityId;
    const copy = first.discovery!.references.find(
      (r) => r.target.kind === "sketchEntity" && r.target.entityId === copyId,
    )!.target;
    const second = await w.execute({
      operation: "sketch.derivation.create",
      draft: first.discovery!.state.draft,
      kind: "transform",
      targets: [copy],
      value: 10,
      intent: "fulfill",
    });
    expect(
      second.discovery!.sketch!.derivations[1]!.currentGeometry![0]!.points[0]!
        .position,
    ).toEqual([24, 3]);
    expect(second.discovery!.sketch!.profiles).toHaveLength(3);
    const moved = await w.execute({
      operation: "sketch.geometry.update",
      draft: second.discovery!.state.draft,
      edit: { kind: "translate", target: seed, delta: [1, 2] },
      intent: "fulfill",
    });
    expect(
      moved.discovery!.sketch!.derivations[1]!.currentGeometry![0]!.points[0]!
        .position[0],
    ).toBeCloseTo(25, 3);
    expect(
      moved.discovery!.sketch!.derivations[1]!.currentGeometry![0]!.points[0]!
        .position[1],
    ).toBeCloseTo(5, 3);
    const deleted = await w.run({
      operation: "sketch.geometry.delete",
      draft: moved.discovery!.state.draft,
      targets: [seed],
      intent: "author-invalid",
    });
    expect(deleted.outcome.kind).toBe("accepted-invalid");
    expect(deleted.discovery!.sketch!.profiles).toHaveLength(0);
    expect(deleted.discovery!.sketch!.derivations).toHaveLength(2);
    expect(
      deleted.discovery!.sketch!.derivations.every(
        (d) => d.currentGeometry === null,
      ),
    ).toBe(true);
    expect(deleted.discovery!.sketch!.validity.state).toBe("invalid"); // Missing pattern seeds invalidate the solve; failedDerivationIds is the narrower profile-gate list.
    const published = await w.run({
      operation: "sketch.publish",
      draft: deleted.discovery!.state.draft,
      requireProfiles: true,
    });
    expect(published.outcome.kind).toBe("rejected");
    expect(published.completion.live.kind).toBe("unchanged");
    const undo = await w.execute({
      operation: "history.undo",
      draft: deleted.discovery!.state.draft,
    });
    expect(undo.discovery!.sketch!.profiles).toHaveLength(3);
    expect(
      undo.discovery!.sketch!.derivations.map((d) => d.definition.derivationId),
    ).toEqual(
      second.discovery!.sketch!.derivations.map(
        (d) => d.definition.derivationId,
      ),
    );
  } finally {
    await w.close();
  }
}, 120_000);
