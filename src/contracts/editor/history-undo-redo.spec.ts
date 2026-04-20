import { test } from 'bun:test'

import {
  getEditorHistoryAvailability,
  initialEditorState,
  transitionEditorState,
  type EditorState,
  type SketchEditorState,
} from '@/contracts/editor/state-machine'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import { getPreviousDocumentHistoryCursor } from '@/domain/modeling/document-history'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  startSketchDraw,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'

test('src/contracts/editor/history-undo-redo.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function addLine(
    session: ReturnType<typeof createNewSketchSession>,
    start: readonly [number, number],
    end: readonly [number, number],
  ) {
    return acceptSketchDraw(startSketchDraw(beginSketchTool(session, 'line'), start), end)
  }

  function createEditingSketchState(): SketchEditorState {
    let session = createNewSketchSession(createStandardPlaneDefinition('xy'))
    session = addLine(session, [0, 0], [1, 0])
    session = addLine(session, [0, 1], [1, 1])

    return {
      ...initialEditorState,
      kind: 'editingSketch',
      mode: 'sketch',
      document: {
        documentId: 'doc_workspace',
        revisionId: 'rev_1',
      },
      command: {
        commandSessionId: 'command_sketch-1',
        toolId: 'sketch',
        phase: 'editing',
      },
      session,
      pendingCommitRequestId: null,
    }
  }

  async function createLoadedIdleState() {
    const adapter = new MockKernelAdapter()
    const snapshot = (await adapter.getDocumentSnapshot({
      contractVersion: 'modeling-contract/v1alpha1',
      documentId: 'doc_workspace',
    })).snapshot
    const boot = transitionEditorState(initialEditorState, { type: 'session.started' })
    const fetchEffect = boot.effects[0]
    assert(fetchEffect?.type === 'document.fetchSnapshot', 'Session start should request a snapshot.')

    const loaded = transitionEditorState(boot.state, {
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: fetchEffect.requestId,
        documentId: snapshot.documentId,
        revisionId: snapshot.revisionId,
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
      },
    })

    assert(loaded.state.kind === 'idle', 'Loaded state should be idle.')
    return { state: loaded.state, snapshot }
  }

  async function testSketchUndoRedo() {
    const state = createEditingSketchState()

    assert(getEditorHistoryAvailability(state).canUndo, 'Sketch undo should be available after authoring two items.')
    assert(!getEditorHistoryAvailability(state).canRedo, 'Sketch redo should be unavailable at the history tail.')

    const undone = transitionEditorState(state, { type: 'history.undoRequested' })
    assert(undone.effects.length === 0, 'Sketch undo should not emit document cursor effects.')
    assert(undone.state.kind === 'editingSketch', 'Sketch undo should keep the sketch session active.')
    assert(undone.state.session.definition.entityIds.length === 1, 'Sketch undo should hide after-cursor geometry.')
    assert(getEditorHistoryAvailability(undone.state).canRedo, 'Sketch redo should become available after undo.')

    const redone = transitionEditorState(undone.state, { type: 'tool.activated', toolId: 'redo' })
    assert(redone.effects.length === 0, 'Sketch redo should not emit document cursor effects.')
    assert(redone.state.kind === 'editingSketch', 'Sketch redo should keep the sketch session active.')
    assert(redone.state.session.definition.entityIds.length === 2, 'Sketch redo should restore visible geometry through the cursor.')
  }

  function testSketchGeometryDeletionUndoRestoresDependentConstraints() {
    const state = createEditingSketchState()
    const entityId = state.session.definition.entityIds[0]
    const dependentConstraintId = state.session.definition.constraints.find((constraint) =>
      'entityId' in constraint && constraint.entityId === entityId,
    )?.constraintId
    assert(entityId, 'Deletion undo fixture should create an entity.')
    assert(dependentConstraintId, 'Deletion undo fixture should create a dependent constraint.')

    const deleted = transitionEditorState({
      ...state,
      selection: [{
        kind: 'sketchEntity',
        sketchId: 'sketch_draft',
        entityId,
      }],
      hoverTarget: {
        kind: 'sketchEntity',
        sketchId: 'sketch_draft',
        entityId,
      },
    }, { type: 'sketch.annotationDeleteRequested' })

    assert(deleted.state.kind === 'editingSketch', 'Geometry deletion should keep the sketch session active.')
    assert(!deleted.state.session.definition.entityIds.includes(entityId), 'Geometry deletion should remove the selected entity.')
    assert(
      !deleted.state.session.definition.constraintIds.includes(dependentConstraintId),
      'Geometry deletion should remove dependent constraints.',
    )
    assert(deleted.state.selection.length === 0, 'Geometry deletion should clear selection.')
    assert(deleted.state.hoverTarget === null, 'Geometry deletion should clear hover state.')

    const undone = transitionEditorState(deleted.state, { type: 'tool.activated', toolId: 'undo' })
    assert(undone.effects.length === 0, 'Sketch deletion undo should remain sketch-local.')
    assert(undone.state.kind === 'editingSketch', 'Sketch deletion undo should keep the sketch session active.')
    assert(
      undone.state.session.definition.entityIds.includes(entityId),
      'One toolbar Undo activation should restore deleted geometry.',
    )
    assert(
      undone.state.session.definition.constraintIds.includes(dependentConstraintId),
      'One toolbar Undo activation should restore dependent constraints.',
    )
  }

  async function testIdleDocumentHistoryAvailabilityAndCursorRequest() {
    const { state, snapshot } = await createLoadedIdleState()
    const previousCursor = getPreviousDocumentHistoryCursor(snapshot)
    assert(previousCursor, 'Loaded document fixture should have a previous document cursor.')

    assert(getEditorHistoryAvailability(state).canUndo, 'Idle editor runtime should expose document cursor undo.')
    assert(!getEditorHistoryAvailability(state).canRedo, 'Idle editor runtime should disable redo at the document tail.')

    const requested = transitionEditorState(state, {
      type: 'document.historyCursorRequested',
      cursor: previousCursor,
    })

    assert(requested.effects.length === 1, 'Document cursor requests should emit one runtime effect.')
    assert(requested.effects[0]?.type === 'document.moveHistoryCursor', 'Document cursor requests should use the editor cursor effect.')
    assert(
      requested.state.pendingHistoryCursorRequestId === requested.effects[0]?.requestId,
      'Document cursor requests should mark the cursor mutation pending.',
    )
    assert(
      !getEditorHistoryAvailability(requested.state).canUndo && !getEditorHistoryAvailability(requested.state).canRedo,
      'Pending cursor mutations should disable document history availability.',
    )

    const duplicate = transitionEditorState(requested.state, {
      type: 'document.historyCursorRequested',
      cursor: previousCursor,
    })
    assert(duplicate.effects.length === 0, 'A second cursor move should not be emitted while the first is pending.')
  }

  function testFeatureEditingDoesNotExposeHistory() {
    const state: EditorState = {
      ...initialEditorState,
      kind: 'selectionCommand',
      command: {
        commandSessionId: 'command_extrude-1',
        toolId: 'extrude',
        phase: 'armed',
      },
      pendingRequestId: null,
    }

    assert(!getEditorHistoryAvailability(state).canUndo, 'Selection commands should not expose undo.')
    assert(!getEditorHistoryAvailability(state).canRedo, 'Selection commands should not expose redo.')
    assert(
      transitionEditorState(state, { type: 'history.undoRequested' }).state === state,
      'Unavailable undo should leave selection command state unchanged.',
    )
  }

  await testSketchUndoRedo()
  testSketchGeometryDeletionUndoRestoresDependentConstraints()
  await testIdleDocumentHistoryAvailabilityAndCursorRequest()
  testFeatureEditingDoesNotExposeHistory()
})
