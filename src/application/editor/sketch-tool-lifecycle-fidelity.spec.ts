/**
 * T17f (B7 leftovers; T17c4 Offset Enter). Logic lane; seam: the
 * authored-action owner (`SketchAuthoredActions`) around the real reducer on
 * entered sessions (`createSketchActionOwnerFixture`), with the workbench's
 * Enter route (`getEnterEvent`).
 * - An annotation click that drops an open annotation edit drops its popup
 *   too (T16f review; base: the presentation and `awaitingValue` stayed).
 * - Undo that ends a Mirror repair leaves the command on the sketch (T16e
 *   A-4; base: `command.toolId` stayed "sketchMirror").
 * - Enter is the Offset's Create (T17c4 review A-2; base: not consumed):
 *   while the preview is being checked it waits as Create does, then
 *   commits one "Commit Offset".
 */
import { describe, expect, test } from "vitest";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { DimensionId } from "@/contracts/shared/ids";
import {
  acceptSketchDraw,
  beginSketchTool,
  clearActiveSketchTool,
  createNewSketchSession,
  finalizeSketchDraw,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import { rebuildSessionForDefinition } from "@/domain/editor/sketch-session/internals";
import {
  eid,
  entityRef,
  seedDefinition,
} from "@/domain/editor/sketch-mirror.fixtures";
import { getEnterEvent } from "@/domain/editor/workbench-interactions";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import { createSketchActionOwnerFixture } from "./sketch-action-owner.fixtures";

const seeded = (definition: SketchDefinition = seedDefinition()) =>
  rebuildSessionForDefinition(
    createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    ),
    { definition },
  );

function withDimensions(): SketchDefinition {
  const base = seedDefinition();
  const dimensions = [
    ["ab", "lineLength", Math.hypot(2, 1)],
    ["c", "diameter", 2],
  ].map(([id, kind, value]) => ({
    dimensionId: `dimension_${String(id)}`,
    kind,
    label: `${String(id)} ${String(kind)}`,
    entityId: eid(String(id)),
    value,
  }));
  return {
    ...base,
    dimensions,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
  } as unknown as SketchDefinition;
}

describe("T17f: tool lifecycle leftovers", () => {
  test("clicking another annotation while an annotation's value popup is open drops the popup with the edit", async () => {
    const f = await createSketchActionOwnerFixture(seeded(withDimensions()));
    const dimension = (id: string) => ({
      kind: "dimension" as const,
      sketchId: f.session.sketchId ?? "sketch_draft",
      dimensionId: id as DimensionId,
    });
    f.dispatch({
      type: "sketch.annotationEditRequested",
      target: dimension("dimension_ab"),
    });
    expect(f.session.activeAnnotationEdit, "premise: editing").not.toBe(null);
    expect(f.session.status).toBe("awaitingValue");
    expect(f.session.toolPresentation?.floatingInput).toBeTruthy();
    f.dispatch({
      type: "viewport.selectionRequested",
      target: dimension("dimension_c"),
    });
    expect(f.state.selection).toEqual([dimension("dimension_c")]);
    expect(f.session.activeAnnotationEdit).toBe(null);
    expect(f.session.status).toBe("idle");
    expect(f.session.toolPresentation, "no leftover popup").toBe(null);
    expect(f.undoLabels(), "no action").toEqual([]);
  });

  test("Undo that removes the mirror under an armed repair ends it and the command is the sketch again", async () => {
    const f = await createSketchActionOwnerFixture(seeded());
    f.dispatch({ type: "tool.activated", toolId: "sketchMirror" });
    for (const id of ["c", "axis"])
      f.dispatch({
        type: "viewport.selectionRequested",
        target: entityRef(f.session, eid(id)),
      });
    f.dispatch(getEnterEvent({ sketchSession: f.session })!);
    expect(f.undoLabels()).toEqual(["Mirror"]);
    f.dispatch({ type: "sketch.activeToolCleared" });
    const derivationId =
      f.session.definition.derivedRelationships![0]!.derivationId;
    f.dispatch({
      type: "sketch.toolPatched",
      patch: { intent: "startMirrorRepair", derivationId },
    });
    expect(f.session.activeEditTool?.repair, "premise: armed").toBeTruthy();
    expect(f.state.command.toolId).toBe("sketchMirror");
    f.dispatch({ type: "history.undoRequested" });
    expect(f.session.definition.derivedRelationships ?? []).toEqual([]);
    expect(f.session.activeEditTool).toBe(null);
    expect(f.state.command).toMatchObject({
      toolId: "sketch",
      phase: "editing",
    });
  });

  test("Enter on an Offset with a selection is its Create: it waits for the preview's check, then one 'Commit Offset'", async () => {
    let drawn = startSketchDraw(
      beginSketchTool(
        createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        "spline",
      ),
      [0, 0],
    );
    for (const point of [
      [1, 0.6],
      [2, -0.4],
    ] as const)
      drawn = acceptSketchDraw(drawn, point);
    const f = await createSketchActionOwnerFixture(
      clearActiveSketchTool(finalizeSketchDraw(drawn)),
    );
    const seed = f.session.definition.entities[0]!;
    f.dispatch({ type: "tool.activated", toolId: "offset" });
    expect(getEnterEvent({ sketchSession: f.session }), "no pick").toBe(null);
    f.dispatch({
      type: "viewport.selectionRequested",
      target: entityRef(f.session, seed.entityId),
    });
    f.dispatch({ type: "sketch.toolPatched", patch: { value: 0.2 } });
    const enter = getEnterEvent({ sketchSession: f.session });
    expect(enter, "the popup's Create").toEqual({
      type: "sketch.toolPatched",
      patch: f.session.toolPresentation?.floatingInput?.submitAction.patch,
    });
    f.dispatch(enter!);
    expect(
      f.session.activeEditTool?.offsetPublication,
      "Enter waits for the preview's certification, as Create does",
    ).toMatchObject({ status: "pending", commitRequested: true });
    expect(f.undoLabels()).toEqual([]);
    await f.settle();
    expect(
      f.session.definition.derivedRelationships?.map((entry) => entry.kind),
    ).toEqual(["offset"]);
    expect(f.undoLabels()).toEqual(["Commit Offset"]);
  }, 60_000);
});
