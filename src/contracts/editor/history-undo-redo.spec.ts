import { test } from 'bun:test'

import {
  getEditorHistoryAvailability,
  initialEditorState,
  transitionEditorState,
  type EditorState,
  type SketchEditorState,
} from '@/contracts/editor/state-machine'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
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

  async function testIdleDocumentHistoryDoesNotUseTimelineCursor() {
    const { state } = await createLoadedIdleState()

    assert(!getEditorHistoryAvailability(state).canUndo, 'Idle editor runtime should not expose timeline cursor undo.')
    assert(!getEditorHistoryAvailability(state).canRedo, 'Idle editor runtime should not expose timeline cursor redo.')
    assert(
      transitionEditorState(state, { type: 'history.undoRequested' }).state === state,
      'Idle editor runtime undo should not move the document timeline cursor.',
    )
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
  await testIdleDocumentHistoryDoesNotUseTimelineCursor()
  testFeatureEditingDoesNotExposeHistory()
})
