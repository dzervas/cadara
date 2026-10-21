import { mkdtemp, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import {
  createSketchWorkflow,
  labels,
} from "../../../test/helpers/semantic-sketch-workflow";
import { createSketchActionOwnerFixture } from "@/application/editor/sketch-action-owner.fixtures";
import { offsetSession } from "@/domain/editor/sketch-offset.fixtures";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";

test("offset distance edits preserve expression bindings, stable copies, one-action history and native save/reopen", async () => {
  const w = await createSketchWorkflow();
  const directory = await mkdtemp("/tmp/opencode/offset-edit-");
  try {
    await w.execute({ operation: "sketch.discard", draft: w.draft() });
    const added = await w.execute({
      operation: "variable.add",
      name: "depth",
      valueText: "1",
      intent: "fulfill",
    });
    const variableId = added.discovery!.variables![0]!.variableId;
    await w.execute({ operation: "sketch.begin", plane: "xy" });
    const source = await w.author({
      kind: "circle",
      center: [0, 0],
      radius: 10,
    });
    const created = await w.execute({
      operation: "sketch.offset.create",
      draft: w.draft(),
      targets: [w.ref(source.discovery!.sketch!.entities[0]!.entityId)],
      distance: 1,
      side: "left",
      intent: "fulfill",
    });
    const original = created.discovery!.sketch!.offsets[0]!;
    const edit = (value: number | string) =>
      w.execute({
        operation: "sketch.offset.update",
        draft: w.draft(),
        derivationId: original.derivationId,
        value,
        intent: "fulfill",
      });
    const current = () => w.current().discovery!.sketch!.offsets[0]!;
    const expectOffset = (distance: unknown, radius: number) => {
      expect(current().distance).toEqual(distance);
      expect(current().derivationId).toBe(original.derivationId);
      expect(current().outputEntityIds).toEqual(original.outputEntityIds);
      expect(
        current().currentGeometry![0]!.points.map((p) => p.pointId),
      ).toEqual(original.currentGeometry![0]!.points.map((p) => p.pointId));
      expect(current().currentGeometry![0]!.radius).toBeCloseTo(radius, 7);
    };
    const numeric = await edit(3);
    expectOffset({ source: "literal", value: 3 }, 7);
    expect(labels(numeric).undo.length).toBe(labels(created).undo.length + 1);
    const expression = { source: "expression", valueText: "2*depth" };
    const bound = await edit("2*depth");
    expectOffset(expression, 8);
    expect(labels(bound).undo.length).toBe(labels(numeric).undo.length + 1);
    await w.execute({ operation: "history.undo", draft: w.draft() });
    expectOffset({ source: "literal", value: 3 }, 7);
    await w.execute({ operation: "history.redo", draft: w.draft() });
    expectOffset(expression, 8);
    const published = await w.execute({
      operation: "sketch.publish",
      draft: w.draft(),
      requireProfiles: true,
    });
    const sketchId = published.discovery!.sketch!.sketchId;
    await w.execute({
      operation: "variable.update",
      variableId,
      name: "depth",
      valueText: "2",
      intent: "fulfill",
    });
    await w.execute({ operation: "sketch.open", sketchId });
    expectOffset(expression, 6);
    await w.execute({
      operation: "sketch.publish",
      draft: w.draft(),
      requireProfiles: true,
    });
    const path = resolve(directory, "bound.cadara");
    await w.execute({ operation: "document.save", path });
    await w.execute({ operation: "document.open", basis: null, path });
    await w.execute({ operation: "sketch.open", sketchId });
    expectOffset(expression, 6);
    await edit("depth");
    expectOffset({ source: "expression", valueText: "depth" }, 8);
    await w.execute({
      operation: "sketch.publish",
      draft: w.draft(),
      requireProfiles: true,
    });
    await w.execute({
      operation: "variable.update",
      variableId,
      name: "depth",
      valueText: "3",
      intent: "fulfill",
    });
    await w.execute({ operation: "sketch.open", sketchId });
    expectOffset({ source: "expression", valueText: "depth" }, 7);
  } finally {
    await w.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 120_000);

test("the offset panel's open/type/cancel records no authored action; Save records one", async () => {
  const { session, relationship } = offsetSession("circle");
  const f = await createSketchActionOwnerFixture(session);
  const before = f.session.definition;
  const undo = f.undoLabels();
  const patch = (patch: Record<string, unknown>) =>
    f.dispatch({ type: "sketch.toolPatched", patch });
  patch({
    intent: "editOffsetDistance",
    derivationId: relationship.derivationId,
  });
  patch({ value: "2*depth" });
  patch({ intent: "cancelAnnotationValue" });
  await f.settle();
  expect(f.session.definition).toEqual(before);
  expect(f.undoLabels()).toEqual(undo);
  patch({
    intent: "editOffsetDistance",
    derivationId: relationship.derivationId,
  });
  patch({ value: 0.25 });
  patch({ intent: "commitAnnotationValue" });
  await f.settle();
  expect(f.undoLabels()).toHaveLength(undo.length + 1);
  expect(f.session.activeAnnotationEdit).toBeNull();
  expect(f.session.definition.derivedRelationships).toEqual([
    { ...relationship, distance: { source: "literal", value: 0.25 } },
  ]);
});

test("invalid distance edits retain the offset with structured diagnostics and undo back to certified copies", async () => {
  const w = await createSketchWorkflow();
  try {
    const source = await w.author({
      kind: "circle",
      center: [0, 0],
      radius: 5,
    });
    const created = await w.execute({
      operation: "sketch.offset.create",
      draft: w.draft(),
      targets: [w.ref(source.discovery!.sketch!.entities[0]!.entityId)],
      distance: 1,
      side: "left",
      intent: "fulfill",
    });
    const original = created.discovery!.sketch!.offsets[0]!;
    for (const [value, code] of [
      ["unknownDepth", OFFSET_DIAGNOSTIC_CODES.unresolvedDistance],
      ["2*", OFFSET_DIAGNOSTIC_CODES.unresolvedDistance],
      [6, OFFSET_DIAGNOSTIC_CODES.arcCollapse],
    ] as const) {
      const invalid = await w.run({
        operation: "sketch.offset.update",
        draft: w.draft(),
        derivationId: original.derivationId,
        value,
        intent: "author-invalid",
      });
      // Existing offset publication keeps the independent source region usable;
      // failure of the relationship is explicit, not whole-sketch invalidity.
      expect(invalid.outcome.kind, JSON.stringify(invalid)).toBe("completed");
      expect(invalid.discovery!.sketch!.profiles).toHaveLength(1);
      expect(invalid.diagnostics.map((d) => d.code)).toContain(code);
      expect(invalid.discovery!.sketch!.offsets).toHaveLength(1);
      expect(invalid.discovery!.sketch!.offsets[0]).toMatchObject({
        derivationId: original.derivationId,
        outputEntityIds: original.outputEntityIds,
        currentGeometry: null,
        health: { kind: "broken" },
      });
      expect(labels(invalid).undo.length).toBe(labels(created).undo.length + 1);
      const undone = await w.execute({
        operation: "history.undo",
        draft: w.draft(),
      });
      expect(undone.discovery!.sketch!.offsets).toEqual([original]);
    }
    for (const input of [
      { value: " " },
      { value: 2, derivationId: "missing-offset" },
    ]) {
      const draft = w.draft();
      const refused = await w.run({
        operation: "sketch.offset.update",
        draft,
        derivationId: original.derivationId,
        intent: "fulfill",
        ...input,
      });
      expect(refused.outcome.kind).toBe("rejected");
      expect(refused.completion.live.kind).toBe("unchanged");
      const inspected = await w.execute({
        operation: "sketch.inspect",
        draft,
      });
      expect(inspected.discovery!.sketch!.offsets).toEqual([original]);
      expect(labels(inspected).undo).toEqual(labels(created).undo);
    }
  } finally {
    await w.close();
  }
}, 120_000);
