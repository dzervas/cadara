import { test } from 'bun:test'

import { ResultAsync, type AppError } from '@/contracts/errors'
import type { DocumentId, RequestId, RevisionId } from '@/contracts/shared/ids'
import { expectTrue } from '@/testing/expect.spec'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSessionFromSupport,
  getSketchHistoryCursorForIndex,
  getSketchHistoryItems,
  moveSketchHistoryCursor,
  startSketchDraw,
} from '@/domain/editor/sketch-session'
import { createModelingServiceEditorEffectRuntime } from './effect-registry'

test('src/application/editor/effect-registry.spec.ts commits the full sketch definition even when the visible history cursor is rolled back', async () => {
  function addLine(
    session: ReturnType<typeof createNewSketchSessionFromSupport>,
    start: readonly [number, number],
    end: readonly [number, number],
  ) {
    const withTool = beginSketchTool(session, 'line')
    return acceptSketchDraw(startSketchDraw(withTool, start), end)
  }

  let session = createNewSketchSessionFromSupport({ kind: 'construction', constructionId: 'construction_plane-xy' })
  session = addLine(session, [0, 0], [1, 0])
  session = addLine(session, [0, 1], [1, 1])

  const fullItems = getSketchHistoryItems(session.fullDefinition)
  const rolledBackSession = moveSketchHistoryCursor(session, getSketchHistoryCursorForIndex(fullItems, 0))
  let committedEntityCount = 0

  const runtime = createModelingServiceEditorEffectRuntime({
    async getCurrentDocumentSnapshot() {
      throw new Error('Snapshot fetch is not used by commit routing coverage.')
    },
    async projectSketchExternalReferences() {
      return { projectedReferences: [], diagnostics: [] }
    },
    sketchSolver: null,
    commitSketch(input) {
      committedEntityCount = input.definition.entityIds.length
      return ResultAsync.fromPromise(Promise.resolve({
        revisionId: 'rev_0002' as RevisionId,
        revisionState: { kind: 'accepted' as const },
        diagnostics: [],
      }), (error) => error as AppError)
    },
    evaluatePreview() {
      throw new Error('Feature preview is not used by commit routing coverage.')
    },
    createFeature() {
      throw new Error('Feature create is not used by commit routing coverage.')
    },
    updateFeature() {
      throw new Error('Feature update is not used by commit routing coverage.')
    },
    setFeatureCursor() {
      throw new Error('Feature cursor is not used by commit routing coverage.')
    },
  })

  expectTrue(
    rolledBackSession.definition.entityIds.length === 1 && rolledBackSession.fullDefinition.entityIds.length === 2,
    'The fixture should distinguish the visible rollback definition from the durable full sketch definition.',
  )

  const result = await runtime.commitSketch({
    requestId: 'request_commit_full_sketch' as RequestId,
    baseRevisionId: 'rev_0001' as RevisionId,
    baseRepositoryHeads: [],
    documentId: 'doc_fixture' as DocumentId,
    commandSessionId: 'command_sketch_fixture',
    session: rolledBackSession,
  })

  expectTrue(result?.accepted === true, 'Rolled-back sketch commit coverage should accept through the fake modeling service.')
  expectTrue(committedEntityCount === 2, 'Sketch commits must preserve full history tail geometry when the cursor is only rolled back for viewing.')
})
