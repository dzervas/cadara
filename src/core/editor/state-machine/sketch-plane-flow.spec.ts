import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import {
  getDocumentHistoryCursorBeforeTarget,
} from '@/domain/modeling/document-history'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'
import { hydrateSketchPlaneEditSession } from '@/domain/editor/sketch-plane-editing'

import { emitSketchPlaneCommit } from './effect-emitters'
import { initialEditorState } from './state-creators'
import { transitionEditorState } from './reducer-root'
import type {
  EditorState,
  SketchPlaneEditorState,
} from './types'

function makeLoadedState(snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>): EditorState {
  return {
    ...initialEditorState,
    document: {
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
    },
    snapshot,
    selectionCatalog: buildSelectionTargetCatalog(snapshot),
  }
}

test('sketch-plane-flow.spec.ts requests rollback-aware sketch-plane editing when the committed sketch is behind the current history cursor', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const requested = transitionEditorState(makeLoadedState(snapshot), {
    type: 'sketchPlaneEdit.requested',
    target: { kind: 'sketch', sketchId },
  })
  const expectedRollbackCursor = getDocumentHistoryCursorBeforeTarget(
    snapshot.presentation.documentHistory,
    { kind: 'sketch', sketchId },
  )

  expectTrue(
    requested.state.kind === 'selectionCommand'
      && requested.state.command.toolId === 'sketchPlaneEdit'
      && requested.state.editSessionCursorContext?.sessionKind === 'sketchPlaneEdit'
      && requested.state.editSessionCursorContext.phase === 'rollingBack'
      && requested.effects[0]?.type === 'document.moveHistoryCursor'
      && JSON.stringify(requested.effects[0].cursor) === JSON.stringify(expectedRollbackCursor),
    'Committed sketch-plane edits should reuse the rollback-aware history cursor seam before opening the inspector.',
  )
})

test('sketch-plane-flow.spec.ts opens directly, cancels without mutation, and restores the prior cursor when needed', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const directOpenSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: { kind: 'sketch' as const, sketchId },
    },
  }
  const opened = transitionEditorState(makeLoadedState(directOpenSnapshot), {
    type: 'sketchPlaneEdit.requested',
    target: { kind: 'sketch', sketchId },
  })

  expectTrue(
    opened.state.kind === 'editingSketchPlane'
      && opened.state.command.toolId === 'sketchPlaneEdit'
      && opened.effects.length === 0,
    'Sketch-plane edits should open immediately when the active history cursor is already on the target sketch.',
  )

  const cancelledDirect = opened.state.kind === 'editingSketchPlane'
    ? transitionEditorState(opened.state, {
        type: 'command.cancelled',
        commandSessionId: opened.state.command.commandSessionId,
      })
    : null

  expectTrue(
    cancelledDirect?.state.kind === 'idle'
      && cancelledDirect.effects.length === 0
      && cancelledDirect.state.document.revisionId === snapshot.document.revisionId,
    'Cancelling an unchanged direct sketch-plane edit should leave the loaded document revision untouched.',
  )

  const session = hydrateSketchPlaneEditSession(snapshot, sketchId)
  expectTrue(session, 'Seed snapshot should expose a sketch-plane edit session for restore coverage.')

  const restoringState = session
    ? {
        ...(opened.state as SketchPlaneEditorState),
        session,
        editSessionCursorContext: {
          target: { kind: 'sketch' as const, sketchId },
          sessionKind: 'sketchPlaneEdit' as const,
          rollbackCursor: {
            kind: 'document' as const,
            featureId: null,
          },
          restoreCursor: snapshot.document.cursor,
          phase: 'active' as const,
        },
      }
    : null
  const cancelledWithRestore = restoringState
    ? transitionEditorState(restoringState, {
        type: 'command.cancelled',
        commandSessionId: restoringState.command.commandSessionId,
      })
    : null

  expectTrue(
    cancelledWithRestore?.state.kind === 'idle'
      && cancelledWithRestore.state.editSessionCursorContext?.phase === 'restoring'
      && cancelledWithRestore.effects[0]?.type === 'document.moveHistoryCursor',
    'Cancelling a rollback-opened sketch-plane edit should restore the prior document cursor through the existing restore seam.',
  )
})

test('sketch-plane-flow.spec.ts emits sketch-plane commits only after a plane change and refreshes the accepted snapshot afterward', async () => {
  const snapshot = await createSeedDocumentSnapshot()
  const sketchId = snapshot.document.sketches[0]!.sketchId
  const directOpenSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: { kind: 'sketch' as const, sketchId },
    },
  }
  const opened = transitionEditorState(makeLoadedState(directOpenSnapshot), {
    type: 'sketchPlaneEdit.requested',
    target: { kind: 'sketch', sketchId },
  })

  expectTrue(opened.state.kind === 'editingSketchPlane', 'Sketch-plane commit coverage needs the direct edit session to open.')

  const unchangedCommit = opened.state.kind === 'editingSketchPlane'
    ? emitSketchPlaneCommit(opened.state)
    : null
  expectTrue(
    unchangedCommit?.effects.length === 0,
    'Sketch-plane commits should stay synchronous when the draft still targets the current origin plane.',
  )

  const patched = opened.state.kind === 'editingSketchPlane'
    ? transitionEditorState(opened.state, {
        type: 'sketchPlaneEdit.patched',
        patch: { selectedPlaneKey: 'yz' },
      })
    : null
  const committed = patched?.state.kind === 'editingSketchPlane'
    ? transitionEditorState(patched.state, {
        type: 'command.commitRequested',
        commandSessionId: patched.state.command.commandSessionId,
      })
    : null

  expectTrue(
    committed?.state.kind === 'editingSketchPlane'
      && committed.state.pendingCommitRequestId !== null
      && committed.effects[0]?.type === 'sketchPlane.commit',
    'Sketch-plane commits should issue the dedicated recommit effect once the selected origin plane changes.',
  )

  const accepted = committed?.state.kind === 'editingSketchPlane'
    ? transitionEditorState(committed.state, {
        type: 'effect.sketchPlaneCommitted',
        requestId: committed.state.pendingCommitRequestId!,
        documentId: snapshot.document.documentId,
        commandSessionId: committed.state.command.commandSessionId,
        baseRevisionId: snapshot.document.revisionId,
        revisionId: 'rev_sketch_plane_updated',
        accepted: true,
        diagnostics: [],
      })
    : null

  expectTrue(
    accepted?.state.kind === 'idle'
      && accepted.state.document.revisionId === 'rev_sketch_plane_updated'
      && accepted.effects[0]?.type === 'document.fetchSnapshot',
    'Accepted sketch-plane reassignment should advance the document revision and refresh the rebuilt snapshot through the standard fetch seam.',
  )
})
