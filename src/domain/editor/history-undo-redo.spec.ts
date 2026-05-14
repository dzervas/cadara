import { test, expect } from "vitest";

import {
  getEditorHistoryAvailability,
  initialEditorState,
  transitionEditorState,
  type EditorState,
  type SketchEditorState,
} from "@/domain/editor/state-machine";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import { getPreviousDocumentHistoryCursor } from "@/domain/modeling/document-history";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  startSketchDraw,
} from "@/domain/editor/sketch-session";
import { createStandardPlaneDefinition } from "@/domain/modeling/opencascade-kernel-seed";

test("src/contracts/editor/history-undo-redo.spec.ts", async () => {
  function addLine(
    session: ReturnType<typeof createNewSketchSession>,
    start: readonly [number, number],
    end: readonly [number, number],
  ) {
    return acceptSketchDraw(
      startSketchDraw(beginSketchTool(session, "line"), start),
      end,
    );
  }

  function createEditingSketchState(): SketchEditorState {
    let session = createNewSketchSession(createStandardPlaneDefinition("xy"));
    session = addLine(session, [0, 0], [1, 0]);
    session = addLine(session, [0, 1], [1, 1]);

    return {
      ...initialEditorState,
      kind: "editingSketch",
      mode: "sketch",
      document: {
        documentId: "doc_workspace",
        revisionId: "rev_1",
      },
      command: {
        commandSessionId: "command_sketch-1",
        toolId: "sketch",
        phase: "editing",
      },
      session,
      pendingCommitRequestId: null,
    };
  }

  async function createLoadedIdleState() {
    const adapter = new MockKernelAdapter();
    const snapshot = (
      await adapter.getDocumentSnapshot({
        contractVersion: "modeling-contract/v1alpha1",
        documentId: "doc_workspace",
      })
    ).snapshot;
    const boot = transitionEditorState(initialEditorState, {
      type: "session.started",
    });
    const fetchEffect = boot.effects[0];
    expect(fetchEffect?.type, "Session start should request a snapshot.").toBe(
      "document.fetchSnapshot",
    );

    const loaded = transitionEditorState(boot.state, {
      type: "effect.snapshotLoaded",
      payload: {
        requestId: fetchEffect.requestId,
        documentId: snapshot.document.documentId,
        revisionId: snapshot.document.revisionId,
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
    });

    expect(loaded.state.kind, "Loaded state should be idle.").toBe("idle");
    return { state: loaded.state, snapshot };
  }

  async function testSketchUndoRedo() {
    const state = createEditingSketchState();

    expect(
      getEditorHistoryAvailability(state).canUndo,
      "Sketch undo should be available after authoring two items.",
    ).toBeTruthy();
    expect(
      getEditorHistoryAvailability(state).canRedo,
      "Sketch redo should be unavailable at the history tail.",
    ).toBeFalsy();

    const undone = transitionEditorState(state, {
      type: "history.undoRequested",
    });
    expect(
      undone.effects.length,
      "Sketch undo should not emit document cursor effects.",
    ).toBe(0);
    expect(
      undone.state.kind,
      "Sketch undo should keep the sketch session active.",
    ).toBe("editingSketch");
    expect(
      undone.state.session.definition.entityIds.length,
      "Sketch undo should hide after-cursor geometry.",
    ).toBe(1);
    expect(
      getEditorHistoryAvailability(undone.state).canRedo,
      "Sketch redo should become available after undo.",
    ).toBeTruthy();

    const redone = transitionEditorState(undone.state, {
      type: "tool.activated",
      toolId: "redo",
    });
    expect(
      redone.effects.length,
      "Sketch redo should not emit document cursor effects.",
    ).toBe(0);
    expect(
      redone.state.kind,
      "Sketch redo should keep the sketch session active.",
    ).toBe("editingSketch");
    expect(
      redone.state.session.definition.entityIds.length,
      "Sketch redo should restore visible geometry through the cursor.",
    ).toBe(2);
  }

  function testSketchGeometryDeletionUndoRestoresDependentConstraints() {
    const state = createEditingSketchState();
    const entityId = state.session.definition.entityIds[0];
    const dependentConstraintId = state.session.definition.constraints.find(
      (constraint) =>
        "entityId" in constraint && constraint.entityId === entityId,
    )?.constraintId;
    expect(
      entityId,
      "Deletion undo fixture should create an entity.",
    ).toBeTruthy();
    expect(
      dependentConstraintId,
      "Deletion undo fixture should create a dependent constraint.",
    ).toBeTruthy();

    const deleted = transitionEditorState(
      {
        ...state,
        selection: [
          {
            kind: "sketchEntity",
            sketchId: "sketch_draft",
            entityId,
          },
        ],
        hoverTarget: {
          kind: "sketchEntity",
          sketchId: "sketch_draft",
          entityId,
        },
      },
      { type: "sketch.annotationDeleteRequested" },
    );

    expect(
      deleted.state.kind,
      "Geometry deletion should keep the sketch session active.",
    ).toBe("editingSketch");
    expect(
      deleted.state.session.definition.entityIds.includes(entityId),
      "Geometry deletion should remove the selected entity.",
    ).toBeFalsy();
    expect(
      deleted.state.session.definition.constraintIds.includes(
        dependentConstraintId,
      ),
      "Geometry deletion should remove dependent constraints.",
    ).toBeFalsy();
    expect(
      deleted.state.selection.length,
      "Geometry deletion should clear selection.",
    ).toBe(0);
    expect(
      deleted.state.hoverTarget,
      "Geometry deletion should clear hover state.",
    ).toBe(null);

    const undone = transitionEditorState(deleted.state, {
      type: "tool.activated",
      toolId: "undo",
    });
    expect(
      undone.effects.length,
      "Sketch deletion undo should remain sketch-local.",
    ).toBe(0);
    expect(
      undone.state.kind,
      "Sketch deletion undo should keep the sketch session active.",
    ).toBe("editingSketch");
    expect(
      undone.state.session.definition.entityIds.includes(entityId),
      "One toolbar Undo activation should restore deleted geometry.",
    ).toBeTruthy();
    expect(
      undone.state.session.definition.constraintIds.includes(
        dependentConstraintId,
      ),
      "One toolbar Undo activation should restore dependent constraints.",
    ).toBeTruthy();
  }

  async function testIdleDocumentHistoryAvailabilityAndCursorRequest() {
    const { state, snapshot } = await createLoadedIdleState();
    const previousCursor = getPreviousDocumentHistoryCursor(snapshot);
    expect(
      previousCursor,
      "Loaded document fixture should have a previous document cursor.",
    ).toBeTruthy();

    expect(
      getEditorHistoryAvailability(state).canUndo,
      "Idle editor runtime should expose document cursor undo.",
    ).toBeTruthy();
    expect(
      getEditorHistoryAvailability(state).canRedo,
      "Idle editor runtime should disable redo at the document tail.",
    ).toBeFalsy();

    const requested = transitionEditorState(state, {
      type: "document.historyCursorRequested",
      cursor: previousCursor,
    });

    expect(
      requested.effects.length,
      "Document cursor requests should emit one runtime effect.",
    ).toBe(1);
    expect(
      requested.effects[0]?.type,
      "Document cursor requests should use the editor cursor effect.",
    ).toBe("document.moveHistoryCursor");
    expect(
      requested.state.pendingHistoryCursorRequestId,
      "Document cursor requests should mark the cursor mutation pending.",
    ).toBe(requested.effects[0]?.requestId);
    expect(
      getEditorHistoryAvailability(requested.state).canUndo &&
        !getEditorHistoryAvailability(requested.state).canRedo,
      "Pending cursor mutations should disable document history availability.",
    ).toBeFalsy();

    const duplicate = transitionEditorState(requested.state, {
      type: "document.historyCursorRequested",
      cursor: previousCursor,
    });
    expect(
      duplicate.effects.length,
      "A second cursor move should not be emitted while the first is pending.",
    ).toBe(0);
  }

  function testFeatureEditingDoesNotExposeHistory() {
    const state: EditorState = {
      ...initialEditorState,
      kind: "selectionCommand",
      command: {
        commandSessionId: "command_extrude-1",
        toolId: "extrude",
        phase: "armed",
      },
      pendingRequestId: null,
    };

    expect(
      getEditorHistoryAvailability(state).canUndo,
      "Selection commands should not expose undo.",
    ).toBeFalsy();
    expect(
      getEditorHistoryAvailability(state).canRedo,
      "Selection commands should not expose redo.",
    ).toBeFalsy();
    expect(
      transitionEditorState(state, { type: "history.undoRequested" }).state,
      "Unavailable undo should leave selection command state unchanged.",
    ).toBe(state);
  }

  await testSketchUndoRedo();
  testSketchGeometryDeletionUndoRestoresDependentConstraints();
  await testIdleDocumentHistoryAvailabilityAndCursorRequest();
  testFeatureEditingDoesNotExposeHistory();
});
