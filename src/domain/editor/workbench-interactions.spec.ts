import { test } from "bun:test";
import { expectTrue } from "@/testing/expect.spec";
import {
  getEditorViewState,
  initialEditorState,
} from "@/domain/editor/state-machine";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";

import {
  getEscapeEvent,
  getNavigationReopenRequest,
  getViewportCanvasClickIntent,
  shouldViewportClickEventRequestConnectedSketchSelection,
  shouldViewportDoubleClickRequestConnectedSketchSelection,
  shouldViewportClickRequestSelection,
  shouldViewportStartSketchGeometryDrag,
} from "./workbench-interactions";

test("src/domain/editor/workbench-interactions.spec.ts", async () => {
  const adapter = new MockKernelAdapter();
  const response = await adapter.getDocumentSnapshot({
    contractVersion: "modeling-contract/v1alpha1",
    documentId: "doc_workspace",
  });
  const snapshot = response.snapshot;

  function testFeatureReopenIntentUsesCommittedFeatureKind() {
    const event = getNavigationReopenRequest(snapshot, {
      kind: "feature",
      featureId: "feature_extrude-1",
    });

    expectTrue(
      event?.type === "authoring.reopenRequested",
      "Feature double-click should emit a reopen event.",
    );
    expectTrue(
      event.toolId === "extrude",
      "Feature double-click should reopen through the committed feature tool.",
    );
  }

  function testSketchReopenIntentUsesSketchFlow() {
    const event = getNavigationReopenRequest(snapshot, {
      kind: "sketch",
      sketchId: "sketch_primary",
    });

    expectTrue(
      event?.type === "authoring.reopenRequested",
      "Sketch double-click should emit a reopen event.",
    );
    expectTrue(
      event.toolId === "sketch",
      "Sketch double-click should reopen through the sketch flow.",
    );
  }

  function testEscapePrefersReferencePickerCancellation() {
    const event = getEscapeEvent({
      ...getEditorViewState(initialEditorState),
      activeCommand: {
        commandSessionId: "command_shell-1",
        toolId: "shell",
        phase: "editing",
      },
      activeReferencePickerFieldId: "shell-faces",
      selection: [{ kind: "body", bodyId: "body_a" }],
      sketchSession: {
        ...createNewSketchSession(createStandardPlaneDefinition("xy")),
        activeTool: "line",
      },
    });

    expectTrue(
      event?.type === "form.referencePickerCancelled",
      "Escape should cancel reference pickers before any broader authoring state.",
    );
  }

  function testEscapeClearsActiveSketchToolBeforeExitingSketch() {
    const event = getEscapeEvent({
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "line",
        phase: "editing",
      },
      activeReferencePickerFieldId: null,
      selection: [{ kind: "body", bodyId: "body_a" }],
      sketchSession: {
        ...createNewSketchSession(createStandardPlaneDefinition("xy")),
        activeTool: "line",
      },
    });

    expectTrue(
      event?.type === "sketch.activeToolCleared",
      "Escape should clear the active sketch tool before exiting sketch mode.",
    );
  }

  function testEscapeClearsActiveSketchStyleFocus() {
    const event = getEscapeEvent({
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      activeReferencePickerFieldId: null,
      selection: [
        {
          kind: "sketchEntity",
          sketchId: "sketch_draft",
          entityId: "sketch_entity_1",
        },
      ],
      sketchSession: {
        ...createNewSketchSession(createStandardPlaneDefinition("xy")),
        activeTool: null,
        activeStyleFocus: {
          toolId: "stroke",
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_draft",
            entityId: "sketch_entity_1",
          },
        },
      },
    });

    expectTrue(
      event?.type === "sketch.activeToolCleared",
      "Escape should clear active sketch style focus before clearing selection.",
    );
  }

  function testEscapeDoesNothingWhenSketchIsIdle() {
    const event = getEscapeEvent({
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      activeReferencePickerFieldId: null,
      selection: [],
      sketchSession: {
        ...createNewSketchSession(createStandardPlaneDefinition("xy")),
        activeTool: null,
      },
    });

    expectTrue(
      event === null,
      "Escape should not finish an idle sketch session.",
    );
  }

  function testEscapeClearsSelectionWhenNoInteractionHandlesIt() {
    const event = getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: [{ kind: "body", bodyId: "body_a" }],
      sketchSession: null,
    });

    expectTrue(
      event?.type === "selection.cleared",
      "Escape should clear selection when no active interaction handles it.",
    );
  }

  function testViewportDoubleClickConnectedSelectionRoutingOnlyUsesIdleSketchEntities() {
    const sketchEntityTarget = {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_ab",
    } as const;

    expectTrue(
      shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: null,
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "Idle sketch entity double-clicks should route to connected selection.",
    );
    expectTrue(
      shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: "rectangle",
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "Idle drawing tools should allow connected selection after accepting a shape.",
    );
    expectTrue(
      !shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: "line",
        sketchStatus: "drawing",
        target: sketchEntityTarget,
      }),
      "In-progress drawing tools should keep their existing click routing.",
    );
    expectTrue(
      !shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: "dimensionDistance",
        sketchStatus: "collectingTargets",
        target: sketchEntityTarget,
      }),
      "Active constraint tools should keep target routing instead of connected selection.",
    );
    expectTrue(
      !shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: null,
        sketchStatus: "idle",
        target: {
          kind: "projectedReferenceGeometry",
          referenceId: "ref_projected",
          geometryId: "projected_geometry_line",
          geometryKind: "lineSegment",
        },
      }),
      "Projected reference geometry should not route to connected local selection.",
    );
    expectTrue(
      !shouldViewportClickEventRequestConnectedSketchSelection({
        activeSketchTool: null,
        clickDetail: 1,
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "Ordinary click events should not route to connected selection.",
    );
    expectTrue(
      shouldViewportClickEventRequestConnectedSketchSelection({
        activeSketchTool: null,
        clickDetail: 2,
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "The second click event in a double-click sequence should route to connected selection without waiting for a separate dblclick event.",
    );
  }

  function testViewportClickSelectionRoutingAllowsConstraintsOnly() {
    expectTrue(
      shouldViewportClickRequestSelection(null),
      "Viewport clicks should request selection when no sketch tool is active.",
    );
    expectTrue(
      shouldViewportClickRequestSelection("constraintCoincident"),
      "Viewport clicks should request selection while a constraint tool is active.",
    );
    expectTrue(
      shouldViewportClickRequestSelection("construction"),
      "Viewport clicks should request selection while Construction is picking an existing sketch target.",
    );
    expectTrue(
      shouldViewportClickRequestSelection("trim"),
      "Viewport clicks should request selection while Trim is picking an existing sketch target.",
    );
    expectTrue(
      shouldViewportClickRequestSelection("offset"),
      "Viewport clicks should request selection while Offset is picking an existing sketch target.",
    );
    expectTrue(
      !shouldViewportClickRequestSelection("line"),
      "Viewport clicks should keep drawing tools on the pointer construction path.",
    );
  }

  function testViewportCanvasClickIntentClearsOnlyEmptyClicks() {
    expectTrue(
      getViewportCanvasClickIntent({
        activeSketchTool: null,
        hasResolvedTarget: false,
      }) === "clearSelection",
      "Empty viewport clicks should clear selection when no sketch tool is active.",
    );
    expectTrue(
      getViewportCanvasClickIntent({
        activeSketchTool: "line",
        hasResolvedTarget: false,
      }) === "clearSelection",
      "Empty viewport clicks should clear selection even while a drawing tool is active.",
    );
    expectTrue(
      getViewportCanvasClickIntent({
        activeSketchTool: "line",
        hasResolvedTarget: true,
        isBackgroundDatumTarget: true,
        selectionFilterKind: "sketchSession",
      }) === "clearSelection",
      "Background datum plane hits should behave like empty clicks while drawing tools are active.",
    );
    expectTrue(
      getViewportCanvasClickIntent({
        activeSketchTool: null,
        hasResolvedTarget: true,
      }) === "selectTarget",
      "Target clicks should continue through normal selection routing when selection clicks are allowed.",
    );
    expectTrue(
      getViewportCanvasClickIntent({
        activeSketchTool: null,
        hasResolvedTarget: true,
        isBackgroundDatumTarget: true,
        selectionFilterKind: "sketchStart",
      }) === "selectTarget",
      "Sketch-start selection should still allow selecting background datum planes.",
    );
    expectTrue(
      getViewportCanvasClickIntent({
        activeSketchTool: "line",
        hasResolvedTarget: true,
      }) === "ignore",
      "Target clicks should preserve drawing-tool routing when selection clicks are not allowed.",
    );
    expectTrue(
      getViewportCanvasClickIntent({
        activeSketchTool: "trim",
        hasResolvedTarget: true,
      }) === "selectTarget",
      "Trim target clicks should route through selection so sketch entities can be edited.",
    );
  }

  function testViewportSketchGeometryDragCanInterruptIdleDrawingTools() {
    expectTrue(
      shouldViewportStartSketchGeometryDrag(null, "idle"),
      "Viewport sketch geometry drags should start when no sketch tool is active.",
    );
    expectTrue(
      shouldViewportStartSketchGeometryDrag("line", "idle"),
      "Idle drawing tools should allow dragged sketch vertices to interrupt placement.",
    );
    expectTrue(
      !shouldViewportStartSketchGeometryDrag("line", "drawing"),
      "Viewport sketch geometry drags should not interrupt an in-progress drawing gesture.",
    );
    expectTrue(
      !shouldViewportStartSketchGeometryDrag(
        "constraintCoincident",
        "collectingTargets",
      ),
      "Viewport sketch geometry drags should not interrupt constraint target collection.",
    );
    expectTrue(
      !shouldViewportStartSketchGeometryDrag(
        "construction",
        "collectingTargets",
      ),
      "Viewport sketch geometry drags should not interrupt Construction target-picking.",
    );
  }

  testFeatureReopenIntentUsesCommittedFeatureKind();
  testSketchReopenIntentUsesSketchFlow();
  testEscapePrefersReferencePickerCancellation();
  testEscapeClearsActiveSketchToolBeforeExitingSketch();
  testEscapeClearsActiveSketchStyleFocus();
  testEscapeDoesNothingWhenSketchIsIdle();
  testEscapeClearsSelectionWhenNoInteractionHandlesIt();
  testViewportDoubleClickConnectedSelectionRoutingOnlyUsesIdleSketchEntities();
  testViewportClickSelectionRoutingAllowsConstraintsOnly();
  testViewportCanvasClickIntentClearsOnlyEmptyClicks();
  testViewportSketchGeometryDragCanInterruptIdleDrawingTools();
});
