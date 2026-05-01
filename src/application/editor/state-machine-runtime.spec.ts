import { test } from 'bun:test'

import { runEditorEffect } from '@/application/editor/state-machine-runtime'
import type { EditorEffect, EditorEffectRuntime } from '@/core/editor/state-machine'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'

test('src/application/editor/state-machine-runtime.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  const effect: EditorEffect = {
    type: 'document.fetchSnapshot',
    requestId: 'request_editor_snapshot' as EditorEffect['requestId'],
    documentId: snapshot.documentId,
    revisionId: snapshot.revisionId,
    commandSessionId: null,
    preserveRenderRecordsOnFeatureDiagnostics: true,
  }

  const loaded = await runEditorEffect(effect, {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
  } as EditorEffectRuntime)

  assert(loaded.type === 'effect.snapshotLoaded', 'Snapshot fetch effects should resolve through the snapshot-loaded event seam.')
  assert(
    loaded.type === 'effect.snapshotLoaded'
      && loaded.payload.snapshot === snapshot
      && loaded.payload.documentId === snapshot.documentId
      && loaded.payload.revisionId === snapshot.revisionId
      && loaded.payload.preserveRenderRecordsOnFeatureDiagnostics === true
      && loaded.payload.selectionCatalog.selectableTargetKeys.length > 0,
    'Successful snapshot fetches should hand off the loaded snapshot and derived selection catalog to the editor state machine.',
  )

  const failed = await runEditorEffect(effect, {
    async getCurrentDocumentSnapshot() {
      throw new Error('Repository offline.')
    },
  } as EditorEffectRuntime)

  assert(failed.type === 'effect.snapshotFailed', 'Snapshot fetch failures should re-enter the state machine as typed effect-failure events.')
  assert(
    failed.type === 'effect.snapshotFailed'
      && failed.requestId === effect.requestId
      && failed.documentId === effect.documentId
      && failed.error === 'Repository offline.',
    'Snapshot fetch failures should preserve the request correlation and normalized error message.',
  )
})
