import { test, expect } from "vitest";
import {
  getEditorViewState,
  initialEditorState,
} from "@/domain/editor/state-machine";
import { createNewSketchSession } from "@/domain/editor/sketch-session";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";

import {
  getEnterEvent,
  getEscapeEvent,
  getNavigationReopenRequest,
  getViewportCanvasClickIntent,
  resolveSketchDragTarget,
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
        ...createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        activeTool: "line",
      },
    });

    expect(
      event?.type,
      "Escape should cancel reference pickers before any broader authoring state.",
    ).toBe("form.referencePickerCancelled");
  }

  function escapeWithSketchTool(
    activeTool: NonNullable<
      Parameters<typeof getEscapeEvent>[0]["sketchSession"]
    >["activeTool"],
  ) {
    return getEscapeEvent({
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      activeReferencePickerFieldId: null,
      selection: [{ kind: "body", bodyId: "body_a" }],
      sketchSession: {
        ...createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
        activeTool,
      },
    });
  }

  function testEscapeClearsActiveSketchToolBeforeExitingSketch() {
    // T11g (T11-D10): a drawing tool takes Escape in steps
    // (`escapeSketchDrawing`: chain end, finalize, cancel, exit), still before
    // anything that would leave the sketch or clear the selection.
    for (const drawingTool of ["line", "circle", "point", "spline"] as const) {
      expect(
        escapeWithSketchTool(drawingTool)?.type,
        `Escape with ${drawingTool} should request the next drawing-tool Escape step before exiting sketch mode.`,
      ).toBe("sketch.escapeRequested");
    }

    // Edit, constraint and target-picking tools keep the single-Escape exit.
    for (const otherTool of [
      "trim",
      "constraintCoincident",
      "construction",
      "projectReference",
    ] as const) {
      expect(
        escapeWithSketchTool(otherTool)?.type,
        `Escape should clear the active ${otherTool} tool before exiting sketch mode.`,
      ).toBe("sketch.activeToolCleared");
    }
  }

  function testEnterIsOnlyConsumedWhenADrawingStepApplies() {
    const session = createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    );
    // T11h/T11i make the chain end and spline finalize reachable; before
    // that no drawing state gives Enter a step.
    for (const sketchSession of [
      null,
      session,
      { ...session, activeTool: "line" as const },
      { ...session, activeTool: "circle" as const, status: "drawing" as const },
      { ...session, activeTool: "trim" as const },
    ]) {
      expect(
        getEnterEvent({ sketchSession }),
        "Enter is not consumed when there is no chain or viable spline draft.",
      ).toBe(null);
    }
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
        ...createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
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
        ...createNewSketchSession(
          createStandardPlaneDefinition("xy"),
          OCC_KERNEL_SETTINGS,
        ),
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

  // T12c: Escape during an active drag cancels the drag before anything else.
  function testEscapeDuringActiveDragCancelsDrag() {
    const session = createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    );
    const sessionWithDrag = {
      ...session,
      activeTool: "line" as const,
      activeDrag: {
        target: {
          kind: "sketchPoint" as const,
          sketchId: "sketch_draft" as const,
          pointId: "sketch_point_1" as const,
        },
        handle: {
          kind: "point" as const,
          pointId: "sketch_point_1" as `sketch_point_${string}`,
        },
        intent: {
          kind: "point" as const,
          pointId: "sketch_point_1" as `sketch_point_${string}`,
        },
        preDragDefinition: session.definition,
        startPoint: [0, 0] as const,
        currentPoint: [1, 1] as const,
        grabOffset: [0, 0] as const,
        status: "dragging" as const,
        message: null,
        interactiveSolveSession: null,
      },
    };

    const event = getEscapeEvent({
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      activeReferencePickerFieldId: null,
      selection: [],
      sketchSession: sessionWithDrag,
    });

    expect(
      event?.type,
      "Escape during active drag should cancel the drag, not take a drawing step.",
    ).toBe("sketch.geometryDragCancelled");
  }

  // T12c: Escape during drag beats reference picker cancellation.
  function testEscapeDuringDragBeatsReferencePicker() {
    const session = createNewSketchSession(
      createStandardPlaneDefinition("xy"),
      OCC_KERNEL_SETTINGS,
    );
    const sessionWithDrag = {
      ...session,
      activeDrag: {
        target: {
          kind: "sketchPoint" as const,
          sketchId: "sketch_draft" as const,
          pointId: "sketch_point_1" as const,
        },
        handle: {
          kind: "point" as const,
          pointId: "sketch_point_1" as `sketch_point_${string}`,
        },
        intent: {
          kind: "point" as const,
          pointId: "sketch_point_1" as `sketch_point_${string}`,
        },
        preDragDefinition: session.definition,
        startPoint: [0, 0] as const,
        currentPoint: [1, 1] as const,
        grabOffset: [0, 0] as const,
        status: "dragging" as const,
        message: null,
        interactiveSolveSession: null,
      },
    };

    const event = getEscapeEvent({
      activeCommand: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      activeReferencePickerFieldId: "some-field",
      selection: [],
      sketchSession: sessionWithDrag,
    });

    expect(
      event?.type,
      "Escape during active drag takes priority over reference picker cancellation.",
    ).toBe("sketch.geometryDragCancelled");
  }

  // T12c R-5: D3 drag target resolution.
  function testD3SelectionInStackIsDragged() {
    const lineEntity = {
      kind: "sketchEntity" as const,
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_line" as `sketch_entity_${string}`,
    };
    const pointA = {
      kind: "sketchPoint" as const,
      sketchId: "sketch_primary" as `sketch_${string}`,
      pointId: "sketch_point_a" as `sketch_point_${string}`,
    };
    const def: import("@/contracts/sketch/schema").SketchDefinition = {
      schemaVersion: "sketch-definition/v1alpha2",
      referenceIds: [],
      references: [],
      pointIds: ["sketch_point_a", "sketch_point_b"],
      points: [
        {
          pointId: "sketch_point_a" as `sketch_point_${string}`,
          label: "A",
          target: pointA,
          position: [0, 0],
          isConstruction: false,
        },
        {
          pointId: "sketch_point_b" as `sketch_point_${string}`,
          label: "B",
          target: {
            kind: "sketchPoint" as const,
            sketchId: "sketch_primary" as `sketch_${string}`,
            pointId: "sketch_point_b" as `sketch_point_${string}`,
          },
          position: [4, 0],
          isConstruction: false,
        },
      ],
      entityIds: ["sketch_entity_line"],
      entities: [
        {
          kind: "lineSegment",
          entityId: "sketch_entity_line" as `sketch_entity_${string}`,
          label: "Line",
          target: lineEntity,
          isConstruction: false,
          startPointId: "sketch_point_a" as `sketch_point_${string}`,
          endPointId: "sketch_point_b" as `sketch_point_${string}`,
        },
      ],
      constraintIds: [],
      constraints: [],
      dimensionIds: [],
      dimensions: [],
    };
    const stack = [{ target: lineEntity }, { target: pointA }];

    // No selection: stack[0] (line entity) is dragged.
    expect(
      resolveSketchDragTarget(stack, [], def),
      "With no selection, stack[0] should be dragged.",
    ).toEqual(lineEntity);

    // Selection contains pointA (in stack): pointA is dragged.
    expect(
      resolveSketchDragTarget(stack, [pointA], def),
      "Selected entry in stack should be dragged.",
    ).toEqual(pointA);

    // Selection contains lineEntity (also in stack): lineEntity is dragged.
    expect(
      resolveSketchDragTarget(stack, [lineEntity], def),
      "Selected entity in stack should be dragged.",
    ).toEqual(lineEntity);

    // Selection contains something not in the stack: stack[0] is used.
    const otherPoint = {
      kind: "sketchPoint" as const,
      sketchId: "sketch_primary" as `sketch_${string}`,
      pointId: "sketch_point_other" as `sketch_point_${string}`,
    };
    expect(
      resolveSketchDragTarget(stack, [otherPoint], def),
      "Selection not in stack falls back to stack[0].",
    ).toEqual(lineEntity);

    // Empty stack: null.
    expect(
      resolveSketchDragTarget([], [pointA], def),
      "Empty stack returns null.",
    ).toBe(null);

    // Stack with only a non-draggable entry: null.
    const derivedEntity = {
      kind: "sketchEntity" as const,
      sketchId: "sketch_primary" as `sketch_${string}`,
      entityId: "sketch_entity_derived" as `sketch_entity_${string}`,
    };
    const defWithDerived: import("@/contracts/sketch/schema").SketchDefinition =
      {
        ...def,
        entityIds: ["sketch_entity_derived"],
        entities: [
          {
            kind: "derivedPiecewiseCubic",
            entityId: "sketch_entity_derived" as `sketch_entity_${string}`,
            label: "Derived",
            target: derivedEntity,
            isConstruction: false,
            relationshipId:
              "derived_relationship_x" as `derived_relationship_${string}`,
          } as import("@/contracts/sketch/schema").SketchEntityDefinition,
        ],
      };
    expect(
      resolveSketchDragTarget([{ target: derivedEntity }], [], defWithDerived),
      "Non-draggable stack[0] returns null.",
    ).toBe(null);
  }

  testFeatureReopenIntentUsesCommittedFeatureKind();
  testSketchReopenIntentUsesSketchFlow();
  testEscapePrefersReferencePickerCancellation();
  testEscapeClearsActiveSketchToolBeforeExitingSketch();
  testEnterIsOnlyConsumedWhenADrawingStepApplies();
  testEscapeClearsActiveSketchStyleFocus();
  testEscapeDoesNothingWhenSketchIsIdle();
  testEscapeClearsSelectionWhenNoInteractionHandlesIt();
  testViewportDoubleClickConnectedSelectionRoutingOnlyUsesIdleSketchEntities();
  testViewportClickSelectionRoutingAllowsConstraintsOnly();
  testViewportCanvasClickIntentClearsOnlyEmptyClicks();
  testViewportSketchGeometryDragCanInterruptIdleDrawingTools();
  testEscapeDuringActiveDragCancelsDrag();
  testEscapeDuringDragBeatsReferencePicker();
  testD3SelectionInStackIsDragged();
});
