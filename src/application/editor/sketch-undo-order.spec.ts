/**
 * T17f (B6, T17-8′; T17b0 P-4). Logic lane; seam: the authored-action owner
 * (`SketchAuthoredActions`) around the real reducer on an entered session
 * (`createSketchActionOwnerFixture`). Undo of a Delete restores the removed
 * entity, its point and its dimension at their positions (base: last), and
 * Undo/Redo output equals the pre-action definition with `undefined`-valued
 * keys dropped (`style: undefined` is not authored data). The rows compare
 * the raw definition arrays, not the order-blind encoded state.
 */
import { describe, expect, test } from "vitest";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import {
  eid,
  entityRef,
  seedDefinition,
} from "@/domain/editor/sketch-mirror.fixtures";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/definition-authoring";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/core/modeling/opencascade-kernel-seed";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";

/** The seed with three dimensions; `ab` and `ar` carry `style: undefined` as Trim/Split outputs do. */
function definition(): SketchDefinition {
  const base = seedDefinition();
  const dimensions = [
    ["ab", "lineLength", Math.hypot(2, 1)],
    ["c", "diameter", 2],
    ["ar", "diameter", 2],
  ].map(([id, kind, value]) => ({
    dimensionId: `dimension_${String(id)}`,
    kind,
    label: `${String(id)} ${String(kind)}`,
    entityId: eid(String(id)),
    value,
  }));
  return {
    ...base,
    entities: base.entities.map((entity) =>
      entity.entityId === eid("ab") || entity.entityId === eid("ar")
        ? { ...entity, style: undefined }
        : entity,
    ),
    dimensions,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
  } as unknown as SketchDefinition;
}

/** Raw arrays in definition order, with `undefined`-valued keys dropped. */
const raw = (definition: SketchDefinition) =>
  JSON.parse(
    JSON.stringify({
      entities: definition.entities,
      entityIds: definition.entityIds,
      points: definition.points,
      pointIds: definition.pointIds,
      constraints: definition.constraints,
      constraintIds: definition.constraintIds,
      dimensions: definition.dimensions,
      dimensionIds: definition.dimensionIds,
    }),
  ) as unknown;

describe("T17f B6: Undo of a Delete restores record positions", () => {
  test("delete the middle circle (its centre point and diameter are mid-list too): Undo, Redo, Undo give the raw arrays back in order", async () => {
    const f = await createSketchActionOwnerFixture(
      rebuildSessionForDefinition(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        { definition: definition() },
      ),
    );
    const before = raw(f.session.definition);
    expect(f.session.definition.entityIds.indexOf(eid("c")), "premise").toBe(1);
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, eid("c")),
    });
    f.dispatch({ type: "sketch.annotationDeleteRequested" });
    await f.settle();
    expect(f.undoLabels()).toEqual(["Delete Sketch Item"]);
    const deleted = raw(f.session.definition);
    expect(
      f.session.definition.entityIds,
      "premise: the circle is deleted",
    ).not.toContain(eid("c"));
    expect(
      f.session.definition.dimensionIds,
      "premise: with its diameter",
    ).toEqual(["dimension_ab", "dimension_ar"]);

    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expect(raw(f.session.definition), "Undo").toEqual(before);
    expect(f.session.definition.entityIds.slice(0, 3)).toEqual([
      eid("ab"),
      eid("c"),
      eid("s"),
    ]);

    f.dispatch({ type: "history.redoRequested" });
    await f.settle();
    expect(raw(f.session.definition), "Redo").toEqual(deleted);

    f.dispatch({ type: "history.undoRequested" });
    await f.settle();
    expect(raw(f.session.definition), "Undo after Redo").toEqual(before);
  });
});
