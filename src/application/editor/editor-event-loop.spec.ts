import { test } from 'bun:test'

import type { EditorEffect, EditorEffectRuntime, EditorEvent, EditorState } from '@/domain/editor/state-machine'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import { createSeedDocumentSnapshot } from '@/domain/modeling/modeling-test-fixtures'
import { createTestErrorReporter } from '@/contracts/errors'
import { createEditorEventLoop } from './editor-event-loop'

function createRuntime(snapshot: Awaited<ReturnType<typeof createSeedDocumentSnapshot>>): EditorEffectRuntime {
  return {
    async getCurrentDocumentSnapshot() {
      return snapshot
    },
    async commitSketch() {
      return null
    },
    async evaluatePreview() {
      throw new Error('Feature preview is not used by this test.')
    },
    async commitFeature() {
      throw new Error('Feature commit is not used by this test.')
    },
  }
}

function waitForState(
  loop: ReturnType<typeof createEditorEventLoop>,
  predicate: (state: EditorState) => boolean,
): Promise<EditorState> {
  const current = loop.getState()

  if (predicate(current)) {
    return Promise.resolve(current)
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      subscription.unsubscribe()
      reject(new Error('Timed out waiting for editor event loop state.'))
    }, 2_000)
    const subscription = loop.subscribe((state) => {
      if (!predicate(state)) {
        return
      }

      clearTimeout(timeoutId)
      subscription.unsubscribe()
      resolve(state)
    })
  })
}

function waitForCondition(predicate: () => boolean): Promise<void> {
  if (predicate()) {
    return Promise.resolve()
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      clearInterval(intervalId)
      reject(new Error('Timed out waiting for condition.'))
    }, 2_000)
    const intervalId = setInterval(() => {
      if (!predicate()) {
        return
      }

      clearTimeout(timeoutId)
      clearInterval(intervalId)
      resolve()
    }, 0)
  })
}

test('src/application/editor/editor-event-loop.spec.ts bootstraps through start()', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  let snapshotCallCount = 0
  const loop = createEditorEventLoop({
    ...createRuntime(snapshot),
    async getCurrentDocumentSnapshot() {
      snapshotCallCount += 1
      return snapshot
    },
  })

  loop.start()

  const state = await waitForState(loop, (candidate) => candidate.document.revisionId !== null)

  assert(snapshotCallCount === 1, 'Starting the loop should dispatch session.started and fetch the initial snapshot once.')
  assert(state.document.documentId === snapshot.document.documentId, 'Starting the loop should hydrate the document id.')
  assert(state.document.revisionId === snapshot.document.revisionId, 'Starting the loop should hydrate the revision id.')

  loop.stop()
})

test('src/application/editor/editor-event-loop.spec.ts dispatches synchronous events and supports unsubscribe', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  const loop = createEditorEventLoop(createRuntime(snapshot))
  let notifications = 0
  const subscription = loop.subscribe(() => {
    notifications += 1
  })

  loop.start()
  await waitForState(loop, (candidate) => candidate.document.revisionId !== null)

  const importedSnapshot = structuredClone(snapshot)
  importedSnapshot.document.revisionId = 'rev_imported'
  importedSnapshot.document.revisionId = 'rev_imported'

  loop.dispatch({ type: 'document.snapshotLoaded', snapshot: importedSnapshot })

  assert(loop.getState().document.revisionId === 'rev_imported', 'Dispatch should route direct editor events through the reducer immediately.')
  assert(notifications > 0, 'Subscribers should be notified after transitions.')

  const beforeUnsubscribe = notifications
  subscription.unsubscribe()
  loop.dispatch({ type: 'selection.cleared' })

  assert(notifications === beforeUnsubscribe, 'Unsubscribed listeners should stop receiving state updates.')

  loop.stop()
})

test('src/application/editor/editor-event-loop.spec.ts executes effects serially in FIFO order', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  const startedEffects: EditorEffect[] = []
  const resolvers: Array<(event: EditorEvent) => void> = []
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) => {
      startedEffects.push(effect)

      return new Promise<EditorEvent>((resolve) => {
        resolvers.push(resolve)
      })
    },
  )

  loop.start()
  loop.dispatch({ type: 'document.refreshRequested' })

  assert(startedEffects.length === 1, 'Only the first queued effect should start while it is in flight.')

  const firstEffect = startedEffects[0]
  assert(firstEffect?.type === 'document.fetchSnapshot', 'Session bootstrap should enqueue a snapshot fetch effect.')
  resolvers[0]?.({
    type: 'effect.snapshotLoaded',
    payload: {
      requestId: firstEffect.requestId,
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  })

  await waitForCondition(() => startedEffects.length === 2)

  assert(startedEffects.length === 2, 'The next queued effect should start only after the prior effect completes.')
  assert(startedEffects[1]?.type === 'document.fetchSnapshot', 'Queued effects should preserve FIFO ordering.')

  const secondEffect = startedEffects[1]
  if (secondEffect) {
    resolvers[1]?.({
      type: 'effect.snapshotLoaded',
      payload: {
        requestId: secondEffect.requestId,
        documentId: snapshot.document.documentId,
        revisionId: snapshot.document.revisionId,
        snapshot,
        selectionCatalog: buildSelectionTargetCatalog(snapshot),
        preserveRenderRecordsOnFeatureDiagnostics: false,
      },
    })
  }

  await waitForState(loop, (candidate) => candidate.pendingSnapshotRequestId === null)
  loop.stop()
})

test('src/application/editor/editor-event-loop.spec.ts reports escaped effect errors and continues with failure events', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  const reporter = createTestErrorReporter()
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    reporter,
    async () => {
      throw new Error('Editor event loop invocation escaped.')
    },
  )

  loop.start()

  const state = await waitForState(loop, (candidate) => candidate.pendingSnapshotRequestId === null)

  assert(reporter.reports.length === 1, 'Escaped effect failures should be reported through the configured error reporter.')
  assert(reporter.reports[0]?.error.code === 'editor/invocation-failed', 'Escaped effect failures should use the invocation failure code.')
  assert(state.preview?.kind === 'selection', 'Escaped effect failures should re-enter the reducer as visible failure state.')

  loop.stop()
})

test('src/application/editor/editor-event-loop.spec.ts stop() discards queued and in-flight effect results', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  let resolveEffect: ((event: EditorEvent) => void) | null = null
  let inFlightRequestId: EditorEffect['requestId'] | null = null
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) => new Promise<EditorEvent>((resolve) => {
      inFlightRequestId = effect.requestId
      resolveEffect = resolve
    }),
  )

  loop.start()
  await waitForState(loop, (candidate) => candidate.pendingSnapshotRequestId !== null)

  loop.stop()
  resolveEffect?.({
    type: 'effect.snapshotLoaded',
    payload: {
      requestId: inFlightRequestId ?? ('request_snapshot_after_stop' as EditorEffect['requestId']),
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  })
  await new Promise((resolve) => setTimeout(resolve, 0))

  assert(loop.getState().document.revisionId === null, 'Stopping the loop should ignore in-flight effect completions.')
})

test('src/application/editor/editor-event-loop.spec.ts restart() resumes draining after stop during an in-flight effect', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const snapshot = await createSeedDocumentSnapshot()
  const startedEffects: EditorEffect[] = []
  const resolvers: Array<(event: EditorEvent) => void> = []
  const loop = createEditorEventLoop(
    createRuntime(snapshot),
    createTestErrorReporter(),
    async (effect) => {
      startedEffects.push(effect)
      return new Promise<EditorEvent>((resolve) => {
        resolvers.push(resolve)
      })
    },
  )

  loop.start()
  await waitForState(loop, (candidate) => candidate.pendingSnapshotRequestId !== null)

  loop.stop()
  loop.start()

  assert(
    startedEffects.length === 1,
    'Restart should queue a new bootstrap effect even while the previous drain is still in flight.',
  )

  resolvers[0]?.({
    type: 'effect.snapshotLoaded',
    payload: {
      requestId: startedEffects[0]?.requestId ?? ('request_snapshot_stale' as EditorEffect['requestId']),
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  })

  await waitForCondition(() => startedEffects.length === 2)

  const restartedEffect = startedEffects[1]
  assert(restartedEffect?.type === 'document.fetchSnapshot', 'Restart should resume draining the new bootstrap snapshot effect.')

  resolvers[1]?.({
    type: 'effect.snapshotLoaded',
    payload: {
      requestId: restartedEffect.requestId,
      documentId: snapshot.document.documentId,
      revisionId: snapshot.document.revisionId,
      snapshot,
      selectionCatalog: buildSelectionTargetCatalog(snapshot),
      preserveRenderRecordsOnFeatureDiagnostics: false,
    },
  })

  const state = await waitForState(loop, (candidate) => candidate.document.revisionId !== null)

  assert(state.document.revisionId === snapshot.document.revisionId, 'Restarted drains should still deliver the snapshot into loop state.')
  loop.stop()
})
