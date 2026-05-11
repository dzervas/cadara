import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
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
    expectTrue(
      fetchEffect?.type === "document.fetchSnapshot",
      "Session start should request a snapshot.",
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

    expectTrue(loaded.state.kind === "idle", "Loaded state should be idle.");
    return { state: loaded.state, snapshot };
  }

  async function testSketchUndoRedo() {
    const state = createEditingSketchState();

    expectTrue(
      getEditorHistoryAvailability(state).canUndo,
      "Sketch undo should be available after authoring two items.",
    );
    expectTrue(
      !getEditorHistoryAvailability(state).canRedo,
      "Sketch redo should be unavailable at the history tail.",
    );

    const undone = transitionEditorState(state, {
      type: "history.undoRequested",
    });
    expectTrue(
      undone.effects.length === 0,
      "Sketch undo should not emit document cursor effects.",
    );
    expectTrue(
      undone.state.kind === "editingSketch",
      "Sketch undo should keep the sketch session active.",
    );
    expectTrue(
      undone.state.session.definition.entityIds.length === 1,
      "Sketch undo should hide after-cursor geometry.",
    );
    expectTrue(
      getEditorHistoryAvailability(undone.state).canRedo,
      "Sketch redo should become available after undo.",
    );

    const redone = transitionEditorState(undone.state, {
      type: "tool.activated",
      toolId: "redo",
    });
    expectTrue(
      redone.effects.length === 0,
      "Sketch redo should not emit document cursor effects.",
    );
    expectTrue(
      redone.state.kind === "editingSketch",
      "Sketch redo should keep the sketch session active.",
    );
    expectTrue(
      redone.state.session.definition.entityIds.length === 2,
      "Sketch redo should restore visible geometry through the cursor.",
    );
  }

  function testSketchGeometryDeletionUndoRestoresDependentConstraints() {
    const state = createEditingSketchState();
    const entityId = state.session.definition.entityIds[0];
    const dependentConstraintId = state.session.definition.constraints.find(
      (constraint) =>
        "entityId" in constraint && constraint.entityId === entityId,
    )?.constraintId;
    expectTrue(entityId, "Deletion undo fixture should create an entity.");
    expectTrue(
      dependentConstraintId,
      "Deletion undo fixture should create a dependent constraint.",
    );

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

    expectTrue(
      deleted.state.kind === "editingSketch",
      "Geometry deletion should keep the sketch session active.",
    );
    expectTrue(
      !deleted.state.session.definition.entityIds.includes(entityId),
      "Geometry deletion should remove the selected entity.",
    );
    expectTrue(
      !deleted.state.session.definition.constraintIds.includes(
        dependentConstraintId,
      ),
      "Geometry deletion should remove dependent constraints.",
    );
    expectTrue(
      deleted.state.selection.length === 0,
      "Geometry deletion should clear selection.",
    );
    expectTrue(
      deleted.state.hoverTarget === null,
      "Geometry deletion should clear hover state.",
    );

    const undone = transitionEditorState(deleted.state, {
      type: "tool.activated",
      toolId: "undo",
    });
    expectTrue(
      undone.effects.length === 0,
      "Sketch deletion undo should remain sketch-local.",
    );
    expectTrue(
      undone.state.kind === "editingSketch",
      "Sketch deletion undo should keep the sketch session active.",
    );
    expectTrue(
      undone.state.session.definition.entityIds.includes(entityId),
      "One toolbar Undo activation should restore deleted geometry.",
    );
    expectTrue(
      undone.state.session.definition.constraintIds.includes(
        dependentConstraintId,
      ),
      "One toolbar Undo activation should restore dependent constraints.",
    );
  }

  async function testIdleDocumentHistoryAvailabilityAndCursorRequest() {
    const { state, snapshot } = await createLoadedIdleState();
    const previousCursor = getPreviousDocumentHistoryCursor(snapshot);
    expectTrue(
      previousCursor,
      "Loaded document fixture should have a previous document cursor.",
    );

    expectTrue(
      getEditorHistoryAvailability(state).canUndo,
      "Idle editor runtime should expose document cursor undo.",
    );
    expectTrue(
      !getEditorHistoryAvailability(state).canRedo,
      "Idle editor runtime should disable redo at the document tail.",
    );

    const requested = transitionEditorState(state, {
      type: "document.historyCursorRequested",
      cursor: previousCursor,
    });

    expectTrue(
      requested.effects.length === 1,
      "Document cursor requests should emit one runtime effect.",
    );
    expectTrue(
      requested.effects[0]?.type === "document.moveHistoryCursor",
      "Document cursor requests should use the editor cursor effect.",
    );
    expectTrue(
      requested.state.pendingHistoryCursorRequestId ===
        requested.effects[0]?.requestId,
      "Document cursor requests should mark the cursor mutation pending.",
    );
    expectTrue(
      !getEditorHistoryAvailability(requested.state).canUndo &&
        !getEditorHistoryAvailability(requested.state).canRedo,
      "Pending cursor mutations should disable document history availability.",
    );

    const duplicate = transitionEditorState(requested.state, {
      type: "document.historyCursorRequested",
      cursor: previousCursor,
    });
    expectTrue(
      duplicate.effects.length === 0,
      "A second cursor move should not be emitted while the first is pending.",
    );
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

    expectTrue(
      !getEditorHistoryAvailability(state).canUndo,
      "Selection commands should not expose undo.",
    );
    expectTrue(
      !getEditorHistoryAvailability(state).canRedo,
      "Selection commands should not expose redo.",
    );
    expectTrue(
      transitionEditorState(state, { type: "history.undoRequested" }).state ===
        state,
      "Unavailable undo should leave selection command state unchanged.",
    );
  }

  await testSketchUndoRedo();
  testSketchGeometryDeletionUndoRestoresDependentConstraints();
  await testIdleDocumentHistoryAvailabilityAndCursorRequest();
  testFeatureEditingDoesNotExposeHistory();
});
