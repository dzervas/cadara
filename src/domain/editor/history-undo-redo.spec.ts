import { test, expect } from "vitest";

import {
  getEditorHistoryAvailability,
  initialEditorState,
  transitionEditorState,
  type EditorState,
} from "@/domain/editor/state-machine";
import { buildSelectionTargetCatalog } from "@/domain/modeling/document-snapshot-view";
import { getPreviousDocumentHistoryCursor } from "@/domain/modeling/document-history";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

test("src/contracts/editor/history-undo-redo.spec.ts", async () => {
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

  await testIdleDocumentHistoryAvailabilityAndCursorRequest();
  testFeatureEditingDoesNotExposeHistory();
});
