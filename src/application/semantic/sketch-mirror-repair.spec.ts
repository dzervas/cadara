import { expect, test } from "vitest";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("explicit mirror axis repair keeps relationship and copy identities, removal is undoable", async () => {
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
    const yAxis = source.discovery!.sketch!.operands.find(
      (r) =>
        r.target.kind === "sketchDatumReference" &&
        r.target.datumId === "yAxis",
    )!.target;
    const created = await w.execute({
      operation: "sketch.mirror.create",
      draft: source.discovery!.state.draft,
      targets: [target],
      axis: yAxis,
      intent: "fulfill",
    });
    const relationship = created.discovery!.sketch!.mirrors[0]!;
    expect(relationship.brokenReason).toBeNull();
    expect(relationship.seedEntityIds).toEqual([
      created.discovery!.sketch!.entities[0]!.entityId,
    ]);
    const xAxis = created.discovery!.sketch!.operands.find(
      (r) =>
        r.target.kind === "sketchDatumReference" &&
        r.target.datumId === "xAxis",
    )!.target;
    const repaired = await w.execute({
      operation: "sketch.mirror.repair",
      draft: created.discovery!.state.draft,
      derivationId: relationship.derivationId,
      repair: { kind: "axis", target: xAxis },
      intent: "fulfill",
    });
    expect(repaired.discovery!.sketch!.mirrors[0]!.derivationId).toBe(
      relationship.derivationId,
    );
    expect(repaired.discovery!.sketch!.mirrors[0]!.outputEntityIds).toEqual(
      relationship.outputEntityIds,
    );
    expect(repaired.discovery!.sketch!.mirrors[0]!.axis).toEqual({
      kind: "sketchDatum",
      datum: "xAxis",
    });
    expect(
      repaired.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points.map(
        (p) => p.position,
      ),
    ).toEqual([[4, -3]]);
    expect(repaired.discovery!.sketch!.points.map((p) => p.position)).toEqual([
      [4, 3],
      [-4, 3],
    ]); // Authored placeholders are not solved outputs.
    expect(repaired.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Replace Mirror Line",
    );
    const removed = await w.execute({
      operation: "sketch.mirror.remove",
      draft: repaired.discovery!.state.draft,
      derivationId: relationship.derivationId,
      intent: "fulfill",
    });
    expect(removed.discovery!.sketch!.mirrors).toHaveLength(0);
    expect(removed.discovery!.sketch!.entities).toHaveLength(1);
    expect(removed.discovery!.sketch!.profiles).toHaveLength(1);
    expect(removed.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Remove Mirror",
    );
    const undo = await w.execute({
      operation: "history.undo",
      draft: removed.discovery!.state.draft,
    });
    expect(undo.discovery!.sketch!.mirrors[0]!.derivationId).toBe(
      relationship.derivationId,
    );
    expect(
      undo.discovery!.sketch!.mirrors[0]!.currentGeometry![0]!.points.map(
        (p) => p.position,
      ),
    ).toEqual([[4, -3]]);
  } finally {
    await w.close();
  }
}, 120_000);
