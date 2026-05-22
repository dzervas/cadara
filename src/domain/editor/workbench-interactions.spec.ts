import { test, expect } from "vitest";
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

    expect(
      event?.type,
      "Feature double-click should emit a reopen event.",
    ).toBe("authoring.reopenRequested");
    expect(
      event.toolId,
      "Feature double-click should reopen through the committed feature tool.",
    ).toBe("extrude");
  }

  function testSketchReopenIntentUsesSketchFlow() {
    const event = getNavigationReopenRequest(snapshot, {
      kind: "sketch",
      sketchId: "sketch_primary",
    });

    expect(event?.type, "Sketch double-click should emit a reopen event.").toBe(
      "authoring.reopenRequested",
    );
    expect(
      event.toolId,
      "Sketch double-click should reopen through the sketch flow.",
    ).toBe("sketch");
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

    expect(
      event?.type,
      "Escape should cancel reference pickers before any broader authoring state.",
    ).toBe("form.referencePickerCancelled");
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

    expect(
      event?.type,
      "Escape should clear the active sketch tool before exiting sketch mode.",
    ).toBe("sketch.activeToolCleared");
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

    expect(
      event?.type,
      "Escape should clear active sketch style focus before clearing selection.",
    ).toBe("sketch.activeToolCleared");
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

    expect(event, "Escape should not finish an idle sketch session.").toBe(
      null,
    );
  }

  function testEscapeClearsSelectionWhenNoInteractionHandlesIt() {
    const event = getEscapeEvent({
      activeCommand: null,
      activeReferencePickerFieldId: null,
      selection: [{ kind: "body", bodyId: "body_a" }],
      sketchSession: null,
    });

    expect(
      event?.type,
      "Escape should clear selection when no active interaction handles it.",
    ).toBe("selection.cleared");
  }

  function testViewportDoubleClickConnectedSelectionRoutingOnlyUsesIdleSketchEntities() {
    const sketchEntityTarget = {
      kind: "sketchEntity",
      sketchId: "sketch_primary",
      entityId: "sketch_entity_ab",
    } as const;

    expect(
      shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: null,
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "Idle sketch entity double-clicks should route to connected selection.",
    ).toBeTruthy();
    expect(
      shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: "rectangle",
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "Idle drawing tools should allow connected selection after accepting a shape.",
    ).toBeTruthy();
    expect(
      shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: "line",
        sketchStatus: "drawing",
        target: sketchEntityTarget,
      }),
      "In-progress drawing tools should keep their existing click routing.",
    ).toBeFalsy();
    expect(
      shouldViewportDoubleClickRequestConnectedSketchSelection({
        activeSketchTool: "dimensionDistance",
        sketchStatus: "collectingTargets",
        target: sketchEntityTarget,
      }),
      "Active constraint tools should keep target routing instead of connected selection.",
    ).toBeFalsy();
    expect(
      shouldViewportDoubleClickRequestConnectedSketchSelection({
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
    ).toBeFalsy();
    expect(
      shouldViewportClickEventRequestConnectedSketchSelection({
        activeSketchTool: null,
        clickDetail: 1,
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "Ordinary click events should not route to connected selection.",
    ).toBeFalsy();
    expect(
      shouldViewportClickEventRequestConnectedSketchSelection({
        activeSketchTool: null,
        clickDetail: 2,
        sketchStatus: "idle",
        target: sketchEntityTarget,
      }),
      "The second click event in a double-click sequence should route to connected selection without waiting for a separate dblclick event.",
    ).toBeTruthy();
  }

  function testViewportClickSelectionRoutingAllowsConstraintsOnly() {
    expect(
      shouldViewportClickRequestSelection(null),
      "Viewport clicks should request selection when no sketch tool is active.",
    ).toBeTruthy();
    expect(
      shouldViewportClickRequestSelection("constraintCoincident"),
      "Viewport clicks should request selection while a constraint tool is active.",
    ).toBeTruthy();
    expect(
      shouldViewportClickRequestSelection("construction"),
      "Viewport clicks should request selection while Construction is picking an existing sketch target.",
    ).toBeTruthy();
    expect(
      shouldViewportClickRequestSelection("trim"),
      "Viewport clicks should request selection while Trim is picking an existing sketch target.",
    ).toBeTruthy();
    expect(
      shouldViewportClickRequestSelection("offset"),
      "Viewport clicks should request selection while Offset is picking an existing sketch target.",
    ).toBeTruthy();
    expect(
      shouldViewportClickRequestSelection("line"),
      "Viewport clicks should keep drawing tools on the pointer construction path.",
    ).toBeFalsy();
  }

  function testViewportCanvasClickIntentClearsOnlyEmptyClicks() {
    expect(
      getViewportCanvasClickIntent({
        activeSketchTool: null,
        hasResolvedTarget: false,
      }),
      "Empty viewport clicks should clear selection when no sketch tool is active.",
    ).toBe("clearSelection");
    expect(
      getViewportCanvasClickIntent({
        activeSketchTool: "line",
        hasResolvedTarget: false,
      }),
      "Empty viewport clicks should clear selection even while a drawing tool is active.",
    ).toBe("clearSelection");
    expect(
      getViewportCanvasClickIntent({
        activeSketchTool: "line",
        hasResolvedTarget: true,
        isBackgroundDatumTarget: true,
        selectionFilterKind: "sketchSession",
      }),
      "Background datum plane hits should behave like empty clicks while drawing tools are active.",
    ).toBe("clearSelection");
    expect(
      getViewportCanvasClickIntent({
        activeSketchTool: null,
        hasResolvedTarget: true,
      }),
      "Target clicks should continue through normal selection routing when selection clicks are allowed.",
    ).toBe("selectTarget");
    expect(
      getViewportCanvasClickIntent({
        activeSketchTool: null,
        hasResolvedTarget: true,
        isBackgroundDatumTarget: true,
        selectionFilterKind: "sketchStart",
      }),
      "Sketch-start selection should still allow selecting background datum planes.",
    ).toBe("selectTarget");
    expect(
      getViewportCanvasClickIntent({
        activeSketchTool: "line",
        hasResolvedTarget: true,
      }),
      "Target clicks should preserve drawing-tool routing when selection clicks are not allowed.",
    ).toBe("ignore");
    expect(
      getViewportCanvasClickIntent({
        activeSketchTool: "trim",
        hasResolvedTarget: true,
      }),
      "Trim target clicks should route through selection so sketch entities can be edited.",
    ).toBe("selectTarget");
  }

  function testViewportSketchGeometryDragCanInterruptIdleDrawingTools() {
    expect(
      shouldViewportStartSketchGeometryDrag(null, "idle"),
      "Viewport sketch geometry drags should start when no sketch tool is active.",
    ).toBeTruthy();
    expect(
      shouldViewportStartSketchGeometryDrag("line", "idle"),
      "Idle drawing tools should allow dragged sketch vertices to interrupt placement.",
    ).toBeTruthy();
    expect(
      shouldViewportStartSketchGeometryDrag("line", "drawing"),
      "Viewport sketch geometry drags should not interrupt an in-progress drawing gesture.",
    ).toBeFalsy();
    expect(
      shouldViewportStartSketchGeometryDrag(
        "constraintCoincident",
        "collectingTargets",
      ),
      "Viewport sketch geometry drags should not interrupt constraint target collection.",
    ).toBeFalsy();
    expect(
      shouldViewportStartSketchGeometryDrag(
        "construction",
        "collectingTargets",
      ),
      "Viewport sketch geometry drags should not interrupt Construction target-picking.",
    ).toBeFalsy();
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
