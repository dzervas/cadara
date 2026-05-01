import { beforeEach, mock, test } from 'bun:test'

import { createAppError, createTestErrorReporter, err, ok } from '@/contracts/errors'

import {
  createHookTestHarness,
  flushMicrotasks,
} from './workbench/controllers/controller-test-harness'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

const hookHarness = createHookTestHarness()
const actualReactModule = await import('react')
const actualWorkbenchDocumentOwnerModule = await import('@/hooks/use-workbench-document-owner')
mock.module('react', () => hookHarness.reactModule)
mock.module('@/hooks/use-workbench-document-owner', () => ({
  useWorkbenchDocumentOwner() {
    return {
      async reorderDocumentHistory() {
        throw new Error('Tests should inject documentOwner directly.')
      },
      async updateDocumentVariable() {
        throw new Error('Tests should inject documentOwner directly.')
      },
    }
  },
}))

const { useWorkbenchHistory } = await import('./workbench/controllers/use-workbench-history')
mock.module('react', () => actualReactModule)
mock.module('@/hooks/use-workbench-document-owner', () => actualWorkbenchDocumentOwnerModule)

beforeEach(() => {
  hookHarness.reset()
})

function makeHistoryItem(kind: 'feature' | 'sketch', id: string, label = id) {
  return kind === 'feature'
    ? {
        description: 'feature',
        featureId: id,
        id: `document_history_item_feature_${id}`,
        kind,
        label,
        sketchId: null,
        target: { featureId: id, kind },
      }
    : {
        description: 'sketch',
        featureId: null,
        id: `document_history_item_sketch_${id}`,
        kind,
        label,
        sketchId: id,
        target: { kind, sketchId: id },
      }
}

function makeSnapshot(input?: {
  cursor?: { kind: 'empty' } | { kind: 'feature'; featureId: string } | { kind: 'sketch'; sketchId: string }
  documentHistory?: ReturnType<typeof makeHistoryItem>[]
  revisionId?: string
  variables?: Array<{ variableId: string; name: string; valueText: string }>
}) {
  const documentHistory = input?.documentHistory ?? []
  const revisionId = input?.revisionId ?? 'rev_history_1'
  return {
    document: {
      cursor: input?.cursor ?? { kind: 'empty' as const },
      revisionId,
      variables: input?.variables ?? [],
    },
    presentation: {
      documentHistory,
    },
  } as never
}

test('useWorkbenchHistory gives sketch sessions undo and redo priority', () => {
  const dispatched: unknown[] = []

  const controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Sketch undo should not call document reorder.')
          },
          async updateDocumentVariable() {
            throw new Error('Sketch undo should not call variable mutation.')
          },
        },
      },
      dispatch(event) {
        dispatched.push(event)
      },
      errorReporter: createTestErrorReporter(),
      history: { canRedo: true, canUndo: true },
      setInvalidVariableValueMessages() {
        throw new Error('Sketch undo should not touch variable validation messages.')
      },
      showWorkbenchError() {
        throw new Error('Sketch undo should not surface a document error.')
      },
      sketchSession: { id: 'active-sketch' },
      snapshot: makeSnapshot(),
    }),
  )

  controller.requestUndo()
  controller.requestRedo()

  assert(
    JSON.stringify(dispatched) === JSON.stringify([
      { type: 'history.undoRequested' },
      { type: 'history.redoRequested' },
    ]),
    'Active sketch sessions should consume undo and redo before document-level history runs.',
  )
})

test('useWorkbenchHistory falls back to document history cursors when local stacks are empty', () => {
  const dispatched: unknown[] = []
  const snapshot = makeSnapshot({
    cursor: { featureId: 'feature_b', kind: 'feature' },
    documentHistory: [
      makeHistoryItem('sketch', 'sketch_a'),
      makeHistoryItem('feature', 'feature_b'),
      makeHistoryItem('feature', 'feature_c'),
    ],
  })

  const controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Cursor fallback should not reorder history.')
          },
          async updateDocumentVariable() {
            throw new Error('Cursor fallback should not mutate variables.')
          },
        },
      },
      dispatch(event) {
        dispatched.push(event)
      },
      errorReporter: createTestErrorReporter(),
      history: { canRedo: true, canUndo: true },
      setInvalidVariableValueMessages() {
        throw new Error('Cursor fallback should not touch variable validation messages.')
      },
      showWorkbenchError() {
        throw new Error('Cursor fallback should not surface a document error.')
      },
      sketchSession: null,
      snapshot,
    }),
  )

  controller.requestUndo()
  controller.requestRedo()

  assert(dispatched.length === 2, 'Cursor fallback should dispatch one undo cursor request and one redo cursor request.')
  assert(
    (dispatched[0] as { type: string; cursor: { kind: string; sketchId?: string } }).type === 'document.historyCursorRequested'
      && (dispatched[0] as { type: string; cursor: { kind: string; sketchId?: string } }).cursor.kind === 'sketch'
      && (dispatched[0] as { type: string; cursor: { kind: string; sketchId?: string } }).cursor.sketchId === 'sketch_a',
    'Undo cursor fallback should target the previous document-history row.',
  )
  assert(
    (dispatched[1] as { type: string; cursor: { kind: string; featureId?: string } }).type === 'document.historyCursorRequested'
      && (dispatched[1] as { type: string; cursor: { kind: string; featureId?: string } }).cursor.kind === 'feature'
      && (dispatched[1] as { type: string; cursor: { kind: string; featureId?: string } }).cursor.featureId === 'feature_c',
    'Redo cursor fallback should target the next document-history row.',
  )
})

test('useWorkbenchHistory updates variables through the document owner and tracks undo and redo state', async () => {
  const reporter = createTestErrorReporter()
  const ownerCalls: unknown[] = []
  const shownErrors: string[] = []
  let invalidVariableMessages: Record<string, string> = { width: 'stale error' }
  let currentSnapshot = makeSnapshot({
    variables: [{ name: 'Width', valueText: '10 mm', variableId: 'width' }],
  })

  const setInvalidVariableValueMessages = (
    updater: Record<string, string> | ((current: Record<string, string>) => Record<string, string>),
  ) => {
    invalidVariableMessages = updater instanceof Function ? updater(invalidVariableMessages) : updater
  }

  let controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Variable updates should not reorder document history.')
          },
          async updateDocumentVariable(variableId, next, options) {
            ownerCalls.push({ next, options, variableId })
            currentSnapshot = makeSnapshot({
              revisionId: `rev_history_${ownerCalls.length + 1}`,
              variables: [{ name: next.name, valueText: next.valueText, variableId }],
            })
            return ok({
              mutation: { revisionState: { kind: 'accepted' }, diagnostics: [] },
              snapshot: currentSnapshot,
            })
          },
        },
      },
      dispatch() {
        throw new Error('Variable updates should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages,
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )

  controller.handleVariableUpdate(
    { name: 'Width', valueText: '10 mm', variableId: 'width' } as never,
    { name: 'Width', valueText: '20 mm' },
  )

  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Variable updates should not reorder document history.')
          },
          async updateDocumentVariable(variableId, next, options) {
            ownerCalls.push({ next, options, variableId })
            currentSnapshot = makeSnapshot({
              revisionId: `rev_history_${ownerCalls.length + 1}`,
              variables: [{ name: next.name, valueText: next.valueText, variableId }],
            })
            return ok({
              mutation: { revisionState: { kind: 'accepted' }, diagnostics: [] },
              snapshot: currentSnapshot,
            })
          },
        },
      },
      dispatch() {
        throw new Error('Variable updates should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages,
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )
  await hookHarness.flushEffects()

  assert(ownerCalls.length === 1, 'Variable updates should route through the document owner exactly once.')
  assert(
    ownerCalls[0] && (ownerCalls[0] as { options: { operation: string } }).options.operation === 'Update Width',
    'Variable updates should preserve the user-facing operation label when calling the document owner.',
  )
  assert(
    Object.keys(invalidVariableMessages).length === 0,
    'Successful variable updates should clear any prior invalid-value message for that variable.',
  )
  assert(
    controller.toolbarHistoryAvailability.canUndo && !controller.toolbarHistoryAvailability.canRedo,
    'Successful variable updates should create a local undo entry and clear any redo history.',
  )

  controller.requestUndo()
  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Variable updates should not reorder document history.')
          },
          async updateDocumentVariable(variableId, next, options) {
            ownerCalls.push({ next, options, variableId })
            currentSnapshot = makeSnapshot({
              revisionId: `rev_history_${ownerCalls.length + 1}`,
              variables: [{ name: next.name, valueText: next.valueText, variableId }],
            })
            return ok({
              mutation: { revisionState: { kind: 'accepted' }, diagnostics: [] },
              snapshot: currentSnapshot,
            })
          },
        },
      },
      dispatch() {
        throw new Error('Variable updates should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages,
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )
  await hookHarness.flushEffects()

  assert(
    ownerCalls[1] && (ownerCalls[1] as { next: { valueText: string }; options: { operation: string } }).next.valueText === '10 mm'
      && (ownerCalls[1] as { next: { valueText: string }; options: { operation: string } }).options.operation === 'Undo Width',
    'Undo should restore the prior variable value through the document owner seam.',
  )
  assert(
    !controller.toolbarHistoryAvailability.canUndo && controller.toolbarHistoryAvailability.canRedo,
    'Undoing the local variable edit should move the workbench entry onto the redo stack.',
  )

  controller.requestRedo()
  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Variable updates should not reorder document history.')
          },
          async updateDocumentVariable(variableId, next, options) {
            ownerCalls.push({ next, options, variableId })
            currentSnapshot = makeSnapshot({
              revisionId: `rev_history_${ownerCalls.length + 1}`,
              variables: [{ name: next.name, valueText: next.valueText, variableId }],
            })
            return ok({
              mutation: { revisionState: { kind: 'accepted' }, diagnostics: [] },
              snapshot: currentSnapshot,
            })
          },
        },
      },
      dispatch() {
        throw new Error('Variable updates should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages,
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )
  await hookHarness.flushEffects()

  assert(
    ownerCalls[2] && (ownerCalls[2] as { next: { valueText: string }; options: { operation: string } }).next.valueText === '20 mm'
      && (ownerCalls[2] as { next: { valueText: string }; options: { operation: string } }).options.operation === 'Redo Width',
    'Redo should reapply the edited variable value through the document owner seam.',
  )
  assert(
    controller.toolbarHistoryAvailability.canUndo && !controller.toolbarHistoryAvailability.canRedo,
    'Redo should move the entry back onto the undo stack.',
  )
  assert(shownErrors.length === 0, 'Successful variable updates and undo/redo should not show workbench errors.')
})

test('useWorkbenchHistory surfaces invalid variable updates without creating an undo entry', async () => {
  const reporter = createTestErrorReporter()
  const shownErrors: string[] = []
  let invalidVariableMessages: Record<string, string> = {}

  const controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Variable update failures should not reorder document history.')
          },
          async updateDocumentVariable() {
            return err(createAppError({
              code: 'workbench/action-failed',
              context: [],
              message: 'Width must reference an existing variable.',
            }))
          },
        },
      },
      dispatch() {
        throw new Error('Variable update failures should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages(
        updater: Record<string, string> | ((current: Record<string, string>) => Record<string, string>),
      ) {
        invalidVariableMessages = updater instanceof Function ? updater(invalidVariableMessages) : updater
      },
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: makeSnapshot({
        variables: [{ name: 'Width', valueText: '10 mm', variableId: 'width' }],
      }),
    }),
  )

  controller.handleVariableUpdate(
    { name: 'Width', valueText: '10 mm', variableId: 'width' } as never,
    { name: 'Width', valueText: 'missingRef' },
  )

  await flushMicrotasks()

  assert(
    invalidVariableMessages.width === 'Width must reference an existing variable.',
    'Rejected variable updates should set the invalid-value message for the edited variable.',
  )
  assert(
    JSON.stringify(shownErrors) === JSON.stringify(['Width must reference an existing variable.']),
    'Rejected variable updates should surface the same human-readable error in the workbench.',
  )
  assert(
    !controller.toolbarHistoryAvailability.canUndo && !controller.toolbarHistoryAvailability.canRedo,
    'Rejected variable updates should not create a local undo or redo entry.',
  )
})

test('useWorkbenchHistory reorders document history through the document owner and restores it with undo and redo', async () => {
  const reporter = createTestErrorReporter()
  const shownErrors: string[] = []
  const reorderCalls: unknown[] = []
  const currentSnapshot = makeSnapshot({
    documentHistory: [
      makeHistoryItem('feature', 'feature_a', 'Feature A'),
      makeHistoryItem('feature', 'feature_b', 'Feature B'),
    ],
  })

  const documentOwner = {
    async reorderDocumentHistory(item: { featureId: string }, beforeItem: { featureId: string } | null, options: unknown) {
      reorderCalls.push({ beforeItem, item, options })
      const nextOrder = beforeItem?.featureId === 'feature_a'
        ? [
            makeHistoryItem('feature', 'feature_b', 'Feature B'),
            makeHistoryItem('feature', 'feature_a', 'Feature A'),
          ]
        : [
            makeHistoryItem('feature', 'feature_a', 'Feature A'),
            makeHistoryItem('feature', 'feature_b', 'Feature B'),
          ]
      ;(currentSnapshot as { presentation: { documentHistory: unknown[] } }).presentation.documentHistory = nextOrder
      ;(currentSnapshot as { document: { revisionId: string } }).document.revisionId = `rev_history_reorder_${reorderCalls.length + 1}`
      return ok({
        mutation: { revisionState: { kind: 'accepted' }, diagnostics: [] },
        snapshot: currentSnapshot,
      })
    },
    async updateDocumentVariable() {
      throw new Error('History reorder should not update variables.')
    },
  }

  let controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner,
      },
      dispatch() {
        throw new Error('History reorder should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages() {
        throw new Error('History reorder should not touch variable validation messages.')
      },
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )

  controller.handleDocumentHistoryReorder(
    { featureId: 'feature_b', kind: 'feature' } as never,
    { featureId: 'feature_a', kind: 'feature' } as never,
  )

  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner,
      },
      dispatch() {
        throw new Error('History reorder should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages() {
        throw new Error('History reorder should not touch variable validation messages.')
      },
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )
  await hookHarness.flushEffects()

  assert(
    reorderCalls[0] && (reorderCalls[0] as { item: { featureId: string }; beforeItem: { featureId: string } | null }).item.featureId === 'feature_b',
    'The initial reorder should be delegated to the document owner with the requested move.',
  )
  assert(
    controller.toolbarHistoryAvailability.canUndo && !controller.toolbarHistoryAvailability.canRedo,
    'A successful document history reorder should create a local undo entry.',
  )

  controller.requestUndo()
  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner,
      },
      dispatch() {
        throw new Error('History reorder undo should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages() {
        throw new Error('History reorder undo should not touch variable validation messages.')
      },
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )
  await hookHarness.flushEffects()

  assert(
    reorderCalls[1]
      && (reorderCalls[1] as { item: { featureId: string }; beforeItem: { featureId: string } | null }).item.featureId === 'feature_a'
      && (reorderCalls[1] as { item: { featureId: string }; beforeItem: { featureId: string } | null }).beforeItem?.featureId === 'feature_b',
    'Undo should restore the previous history order through the document owner seam.',
  )
  assert(
    !controller.toolbarHistoryAvailability.canUndo && controller.toolbarHistoryAvailability.canRedo,
    'Undoing the reorder should move the entry onto the redo stack.',
  )

  controller.requestRedo()
  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner,
      },
      dispatch() {
        throw new Error('History reorder redo should not dispatch editor events.')
      },
      errorReporter: reporter,
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages() {
        throw new Error('History reorder redo should not touch variable validation messages.')
      },
      showWorkbenchError(message) {
        shownErrors.push(message)
      },
      sketchSession: null,
      snapshot: currentSnapshot,
    }),
  )
  await hookHarness.flushEffects()

  assert(
    reorderCalls[2]
      && (reorderCalls[2] as { item: { featureId: string }; beforeItem: { featureId: string } | null }).item.featureId === 'feature_b'
      && (reorderCalls[2] as { item: { featureId: string }; beforeItem: { featureId: string } | null }).beforeItem?.featureId === 'feature_a',
    'Redo should reapply the reordered history through the document owner seam.',
  )
  assert(
    controller.toolbarHistoryAvailability.canUndo && !controller.toolbarHistoryAvailability.canRedo,
    'Redo should move the history entry back onto the undo stack.',
  )
  assert(shownErrors.length === 0, 'Accepted history reorders and their undo/redo flow should not surface workbench errors.')
})
