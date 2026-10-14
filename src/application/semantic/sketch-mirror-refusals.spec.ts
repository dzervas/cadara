import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("mirror creation and repair reject unavailable, repeated, unsupported and cyclic operands without authoring", async () => {
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
      (r) => r.label === "Sketch Y axis",
    )!.target;
    const origin = source.discovery!.sketch!.operands.find(
      (r) => r.label === "Sketch origin",
    )!.target;
    for (const input of [
      { targets: [], axis },
      { targets: [seed, seed], axis },
      { targets: [seed], axis: seed },
      { targets: [seed], axis: origin },
      { targets: [{ ...seed, sketchId: "sketch_foreign" }], axis },
      { targets: [seed], axis: { ...axis, sketchId: "sketch_foreign" } },
      { targets: [seed], axis: { ...axis, geometryKind: "point" } },
    ]) {
      const refused = await w.run({
        operation: "sketch.mirror.create",
        draft: source.discovery!.state.draft,
        intent: "fulfill",
        ...input,
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
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
    const mirrored = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
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
    for (const input of [
      { derivationId: "absent", repair: { kind: "axis", target: axis } },
      {
        derivationId: relationship.derivationId,
        repair: { kind: "axis", target: axis },
      },
      {
        derivationId: relationship.derivationId,
        repair: { kind: "axis", target: seed },
      },
      {
        derivationId: relationship.derivationId,
        repair: { kind: "original", output: copy, target: copy },
      },
      {
        derivationId: relationship.derivationId,
        repair: { kind: "original", output: copy, target: seed },
      },
      {
        derivationId: relationship.derivationId,
        repair: { kind: "original", output: seed, target: copy },
      },
      {
        derivationId: relationship.derivationId,
        repair: {
          kind: "axis",
          target: { ...axis, sketchId: "sketch_foreign" },
        },
      },
      {
        derivationId: relationship.derivationId,
        repair: { kind: "axis", target: { ...axis, geometryKind: "point" } },
      },
    ]) {
      const refused = await w.run({
        operation: "sketch.mirror.repair",
        draft: mirrored.discovery!.state.draft,
        intent: "fulfill",
        ...input,
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
      const inspect = await w.execute({
        operation: "sketch.inspect",
        draft: mirrored.discovery!.state.draft,
      });
      expect(inspect.discovery!.sketch!.mirrors).toEqual(
        mirrored.discovery!.sketch!.mirrors,
      );
      expect(inspect.discovery!.history!.undoEntries!).toEqual(
        mirrored.discovery!.history!.undoEntries!,
      );
    }
    const stale = await w.run({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [seed],
      axis,
      intent: "fulfill",
    });
    expect(stale.outcome.kind).toBe("conflicted");
    const absent = await w.run({
      operation: "sketch.mirror.remove",
      draft: mirrored.discovery!.state.draft,
      derivationId: "absent",
      intent: "fulfill",
    });
    expect(absent.outcome.kind).toBe("rejected");
    expect(absent.completion.live.kind).toBe("unchanged");
  } finally {
    await w.close();
  }
}, 120_000);
