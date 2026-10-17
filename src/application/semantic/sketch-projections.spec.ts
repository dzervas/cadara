import { expectNoInternalIds } from "@/contracts/sketch/user-text.fixtures";
import { expect, test } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { createSketchWorkflow } from "../../../test/helpers/semantic-sketch-workflow";

test("projects an existing sketch circle as read-only geometry with owned history and publication", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const published = await w.execute({
      operation: "sketch.publish",
      draft: source.discovery!.state.draft,
      requireProfiles: true,
    });
    const sourceSketchId = published.discovery!.sketch!.sketchId!;
    const sourceEntityId = published.discovery!.sketch!.entities[0]!.entityId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const projected = await w.execute({
      operation: "sketch.reference.add",
      draft: w.current().discovery!.state.draft,
      target: {
        kind: "sketchEntity",
        sketchId: sourceSketchId,
        entityId: sourceEntityId,
      },
      intent: "fulfill",
    });
    const reference = projected.discovery!.sketch!.references![0]!;
    expect(reference.projection!.status).toBe("projected");
    expect(reference.projection!.geometry).toEqual([
      expect.objectContaining({
        kind: "circle",
        centerPosition: [4, 3],
        radius: 2,
      }),
    ]);
    expect(reference.revisionId).toBe(published.discovery!.state.revisionId);
    expect(projected.discovery!.sketch!.entities).toHaveLength(0);
    expect(
      projected.discovery!.sketch!.operands.filter(
        (o) => o.target.kind === "projectedReferenceGeometry",
      ),
    ).toHaveLength(1);
    const operands = projected.discovery!.sketch!.operands.filter(
      (o) => o.target.kind === "projectedReferenceGeometry",
    );
    expectNoInternalIds(
      operands.map((o) => o.label),
      [
        reference.definition.referenceId,
        ...reference.projection!.geometry.map((g) => g.geometryId),
      ],
    );
    expect(operands[0]!.label).toContain(reference.definition.label);
    expect(operands[0]!.target).toEqual({
      kind: "projectedReferenceGeometry",
      referenceId: reference.definition.referenceId,
      geometryId: reference.projection!.geometry[0]!.geometryId,
      geometryKind: "circle",
    });
    expect(projected.discovery!.history!.undoEntries!.at(-1)!.label).toBe(
      "Reference",
    );
    const undone = await w.execute({
      operation: "history.undo",
      draft: projected.discovery!.state.draft,
    });
    expect(undone.discovery!.sketch!.references).toHaveLength(0);
    const restored = await w.execute({
      operation: "history.redo",
      draft: undone.discovery!.state.draft,
    });
    expect(
      restored.discovery!.sketch!.references![0]!.definition.referenceId,
    ).toBe(reference.definition.referenceId);
    expect(
      restored.discovery!.sketch!.references![0]!.projection!.geometry,
    ).toEqual(reference.projection!.geometry);
  } finally {
    await w.close();
  }
}, 180_000);

test("refreshes projected source geometry after a committed edit without inventing unsupported sizing", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "cadara-projections-"));
  const w = await createSketchWorkflow();
  try {
    const circle = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "circle", center: [4, 3], radius: 2 },
      construction: false,
      intent: "fulfill",
    });
    const source = await w.execute({
      operation: "sketch.publish",
      draft: circle.discovery!.state.draft,
      requireProfiles: true,
    });
    const sourceSketchId = source.discovery!.sketch!.sketchId!;
    const entityId = source.discovery!.sketch!.entities[0]!.entityId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const point = await w.execute({
      operation: "sketch.author",
      draft: w.current().discovery!.state.draft,
      primitive: { kind: "point", position: [9, 9] },
      construction: false,
      intent: "fulfill",
    });
    const projection = await w.execute({
      operation: "sketch.reference.add",
      draft: point.discovery!.state.draft,
      target: { kind: "sketchEntity", sketchId: sourceSketchId, entityId },
      intent: "fulfill",
    });
    const operand = projection.discovery!.sketch!.operands.find(
      (o) => o.target.kind === "projectedReferenceGeometry",
    )!.target;
    const unsupportedDiameter = await w.run({
      operation: "sketch.requirement.add",
      draft: projection.discovery!.state.draft,
      tool: "dimensionDistance",
      targets: [operand],
      mode: "reference",
      value: null,
      intent: "fulfill",
    });
    expect(unsupportedDiameter.outcome.kind).toBe("rejected");
    const center = await w.execute({
      operation: "sketch.reference.add",
      draft: projection.discovery!.state.draft,
      target: {
        kind: "sketchPoint",
        sketchId: sourceSketchId,
        pointId: source.discovery!.sketch!.points[0]!.pointId,
      },
      intent: "fulfill",
    });
    const projectedPoint = center.discovery!.sketch!.operands.find(
      (o) =>
        o.target.kind === "projectedReferenceGeometry" &&
        o.target.geometryKind === "point",
    )!.target;
    const localPoint = center.discovery!.references.find(
      (r) =>
        r.target.kind === "sketchPoint" &&
        r.target.pointId === point.discovery!.sketch!.points[0]!.pointId,
    )!.target;
    const unsupportedSizing = await w.run({
      operation: "sketch.requirement.add",
      draft: center.discovery!.state.draft,
      tool: "dimensionHorizontal",
      targets: [localPoint, projectedPoint],
      mode: "reference",
      value: null,
      intent: "fulfill",
    });
    expect(unsupportedSizing.outcome.kind).toBe("rejected");
    const referenceId =
      center.discovery!.sketch!.references![0]!.definition.referenceId;
    const target = await w.execute({
      operation: "sketch.publish",
      draft: center.discovery!.state.draft,
      requireProfiles: false,
    });
    const targetSketchId = target.discovery!.sketch!.sketchId!;
    const reopened = await w.execute({
      operation: "sketch.open",
      sketchId: sourceSketchId,
    });
    const changed = await w.execute({
      operation: "sketch.geometry.update",
      draft: reopened.discovery!.state.draft,
      edit: {
        kind: "radius",
        target: { kind: "sketchEntity", sketchId: sourceSketchId, entityId },
        radius: 5,
      },
      intent: "fulfill",
    });
    const moved = await w.execute({
      operation: "sketch.geometry.update",
      draft: changed.discovery!.state.draft,
      edit: {
        kind: "point",
        target: {
          kind: "sketchPoint",
          sketchId: sourceSketchId,
          pointId: source.discovery!.sketch!.points[0]!.pointId,
        },
        position: [6, 3],
      },
      intent: "fulfill",
    });
    const republished = await w.execute({
      operation: "sketch.publish",
      draft: moved.discovery!.state.draft,
      requireProfiles: true,
    });
    const refreshed = await w.execute({
      operation: "sketch.open",
      sketchId: targetSketchId,
    });
    const reference = refreshed.discovery!.sketch!.references![0]!;
    expect(reference.definition.referenceId).toBe(referenceId);
    // Opening the older target restores its production cursor and advances the projection revision.
    expect(reference.revisionId).toBe(refreshed.discovery!.state.revisionId);
    expect(reference.revisionId).not.toBe(source.discovery!.state.revisionId);
    expect(republished.completion.persistence.kind).toBe("committed");
    expect(reference.projection!.status).toBe("projected");
    expect(reference.projection!.geometry).toEqual([
      expect.objectContaining({
        kind: "circle",
        centerPosition: [6, 3],
        radius: 5,
      }),
    ]);
    expect(
      refreshed.discovery!.sketch!.references![1]!.projection!.geometry,
    ).toEqual([expect.objectContaining({ kind: "point", position: [6, 3] })]);
    expect(refreshed.discovery!.sketch!.measurements).toHaveLength(0);
    expect(refreshed.discovery!.sketch!.entities).toHaveLength(1);
    await w.execute({
      operation: "sketch.discard",
      draft: refreshed.discovery!.state.draft,
    });
    const path = resolve(directory, "projections.cadara");
    const saved = await w.execute({ operation: "document.save", path });
    expect(saved.completion.file.kind).toBe("written");
    await w.execute({ operation: "document.open", basis: null, path });
    const fromFile = await w.execute({
      operation: "sketch.open",
      sketchId: targetSketchId,
    });
    expect(
      fromFile.discovery!.sketch!.references![0]!.definition.referenceId,
    ).toBe(referenceId);
    expect(
      fromFile.discovery!.sketch!.references![0]!.projection!.geometry,
    ).toEqual([
      expect.objectContaining({
        kind: "circle",
        centerPosition: [6, 3],
        radius: 5,
      }),
    ]);
    expect(fromFile.discovery!.sketch!.points[0]!.position).toEqual([9, 9]);
    expect(fromFile.discovery!.sketch!.support!.frame).toEqual(
      refreshed.discovery!.sketch!.support!.frame,
    );
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 180_000);
