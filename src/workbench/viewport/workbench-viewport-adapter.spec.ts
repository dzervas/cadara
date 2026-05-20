import { expect, test } from "vitest";

import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createWorkbenchViewportCommands,
  createWorkbenchViewportIntentHandler,
  createWorkbenchViewportModel,
} from "@/workbench/viewport/workbench-viewport-adapter";
import { getLatestViewportFitViewRequestId } from "@/workbench/viewport/viewport-boundary";

test("workbench viewport adapter exposes typed model and command ports", () => {
  const target: PrimitiveRef = { kind: "body", bodyId: "body_1" };
  const model = createWorkbenchViewportModel({
    activeSectionView: null,
    hoverTarget: target,
    measurementWitnesses: [],
    renderables: [],
    sketchDisplayRenderables: [],
    sketchAnnotations: [],
    selection: [target],
    sketchToolPresentation: null,
    specialModePresentation: null,
    hasNonEmptyCommittedGeometry: false,
    mode: "part",
    selectionFilter: null,
    selectionCatalog: null,
    sketchSession: null,
    isEditorRenderIdle: true,
    acceptsSpecialModeTarget: () => true,
  });

  expect(model.hoverTarget).toBe(target);
  expect(model.interaction.mode).toBe("part");
  expect(model.interaction.isEditorRenderIdle).toBe(true);
  expect(model.capabilities.acceptsSpecialModeTarget).toBeTypeOf("function");
  expect(
    getLatestViewportFitViewRequestId(
      createWorkbenchViewportCommands({ fitViewRequestId: 7 }),
    ),
  ).toBe(7);
});

test("workbench viewport adapter routes typed intents to editor events and commands", () => {
  const target: PrimitiveRef = { kind: "body", bodyId: "body_1" };
  const calls: string[] = [];
  const dispatched: unknown[] = [];
  const handler = createWorkbenchViewportIntentHandler({
    dispatch(event) {
      dispatched.push(event);
    },
    onHover(receivedTarget) {
      calls.push(`hover:${receivedTarget.kind}`);
    },
    onSelect(receivedTarget, cameraPosition) {
      calls.push(`select:${receivedTarget.kind}:${cameraPosition?.join(",")}`);
    },
    onConnectedSketchSelect() {
      calls.push("connected");
    },
    onDeselect() {
      calls.push("deselect");
    },
    onClearHover() {
      calls.push("clear-hover");
    },
    onSketchMove(point) {
      calls.push(`sketch-move:${point.join(",")}`);
    },
    onSketchRelease() {
      calls.push("sketch-release");
    },
    onSketchGeometryDragStart() {
      calls.push("geometry-start");
    },
    onSketchGeometryDragMove() {
      calls.push("geometry-move");
    },
    onSketchGeometryDragEnd() {
      calls.push("geometry-end");
    },
    onSpecialModeClick() {
      calls.push("special-click");
    },
    onSpecialModeDoubleClick() {
      calls.push("special-double-click");
    },
    onSpecialModeDragStart() {
      calls.push("special-start");
    },
    onSpecialModeDragMove() {
      calls.push("special-move");
    },
    onSpecialModeDragEnd() {
      calls.push("special-end");
    },
    onSectionOffsetChange(offset) {
      calls.push(`section-offset:${offset}`);
    },
    onSectionFlip() {
      calls.push("section-flip");
    },
    onSectionClear() {
      calls.push("section-clear");
    },
    onLodTierChange(tierId) {
      calls.push(`lod:${tierId}`);
    },
    onCanvasCreated() {
      calls.push("canvas");
    },
    onFirstNonEmptyGeometryFrame() {
      calls.push("first-frame");
    },
  });

  handler({
    type: "selected",
    target,
    cameraPosition: [1, 2, 3],
  });
  handler({
    type: "annotationEditRequested",
    target: {
      kind: "dimension",
      sketchId: "sketch_1",
      dimensionId: "dimension_1",
    } as PrimitiveRef & { kind: "dimension" },
  });
  handler({ type: "sketchToolPatched", patch: { radius: 12 } });
  handler({ type: "sectionOffsetChanged", offset: 3 });
  handler({ type: "lodTierChanged", tierId: "fine" });
  handler({ type: "canvasCreated" });

  expect(calls).toEqual([
    "select:body:1,2,3",
    "section-offset:3",
    "lod:fine",
    "canvas",
  ]);
  expect(dispatched).toEqual([
    {
      type: "sketch.annotationEditRequested",
      target: {
        kind: "dimension",
        sketchId: "sketch_1",
        dimensionId: "dimension_1",
      },
    },
    { type: "sketch.toolPatched", patch: { radius: 12 } },
  ]);
});
