import { beforeEach, mock, test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createAppError, createTestErrorReporter, err, ok } from '@/contracts/errors'
import type { DurableHistoryService } from '@/application/workbench/durable-history'

import {
  createHookTestHarness,
  flushMicrotasks,
} from './workbench/controllers/controller-test-harness'

const hookHarness = createHookTestHarness()
const actualReactModule = await import('react')
const actualWorkbenchDocumentOwnerModule = await import('@/hooks/use-workbench-document-owner')
let currentDurableHistory: DurableHistoryService = createDurableHistoryStub()

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
mock.module('@/hooks/use-durable-history', () => ({
  useDurableHistory() {
    return currentDurableHistory
  },
}))

const { useWorkbenchHistory } = await import('./workbench/controllers/use-workbench-history')
mock.module('react', () => actualReactModule)
mock.module('@/hooks/use-workbench-document-owner', () => actualWorkbenchDocumentOwnerModule)

beforeEach(() => {
  hookHarness.reset()
  currentDurableHistory = createDurableHistoryStub()
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
  documentId?: string
  revisionId?: string
  variables?: Array<{ variableId: string; name: string; valueText: string }>
}) {
  const documentHistory = input?.documentHistory ?? []
  const revisionId = input?.revisionId ?? 'rev_history_1'
  return {
    document: {
      cursor: input?.cursor ?? { kind: 'empty' as const },
      documentId: input?.documentId ?? 'doc_workspace',
      revisionId,
      variables: input?.variables ?? [],
    },
    presentation: {
      documentHistory,
    },
  } as never
}

test('useWorkbenchHistory routes sketch undo and redo through the durable history service', async () => {
  const dispatched: unknown[] = []
  currentDurableHistory = createDurableHistoryStub({
    async getAvailability() {
      return { canUndo: true, canRedo: true }
    },
    async undo() {
      return {
        context: 'sketch',
        session: { sketchId: 'sketch_restored_undo' } as never,
        availability: { canUndo: false, canRedo: true },
      }
    },
    async redo() {
      return {
        context: 'sketch',
        session: { sketchId: 'sketch_restored_redo' } as never,
        availability: { canUndo: true, canRedo: false },
      }
    },
  })

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
      sketchSession: { sketchId: 'sketch_active' } as never,
      snapshot: makeSnapshot(),
    }),
  )

  controller.requestUndo()
  controller.requestRedo()
  await flushMicrotasks()

  expectTrue(
    JSON.stringify(dispatched) === JSON.stringify([
      { type: 'sketch.draftHistoryRestored', session: { sketchId: 'sketch_restored_undo' } },
      { type: 'sketch.draftHistoryRestored', session: { sketchId: 'sketch_restored_redo' } },
    ]),
    'Sketch undo and redo should restore draft sessions through the durable history coordinator.',
  )
})

test('useWorkbenchHistory routes document undo and redo through the durable history service', async () => {
  const dispatched: unknown[] = []
  const undoSnapshot = makeSnapshot({ revisionId: 'rev_history_undo' })
  const redoSnapshot = makeSnapshot({ revisionId: 'rev_history_redo' })
  currentDurableHistory = createDurableHistoryStub({
    async getAvailability() {
      return { canUndo: true, canRedo: true }
    },
    async undo() {
      return {
        context: 'document',
        snapshot: undoSnapshot,
        availability: { canUndo: false, canRedo: true },
      }
    },
    async redo() {
      return {
        context: 'document',
        snapshot: redoSnapshot,
        availability: { canUndo: true, canRedo: false },
      }
    },
  })

  const controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Document undo should not reorder document history directly.')
          },
          async updateDocumentVariable() {
            throw new Error('Document undo should not mutate variables directly.')
          },
        },
      },
      dispatch(event) {
        dispatched.push(event)
      },
      errorReporter: createTestErrorReporter(),
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages() {
        throw new Error('Document undo should not touch variable validation messages.')
      },
      showWorkbenchError() {
        throw new Error('Document undo should not surface a document error.')
      },
      sketchSession: null,
      snapshot: makeSnapshot(),
    }),
  )

  controller.requestUndo()
  controller.requestRedo()
  await flushMicrotasks()

  expectTrue(
    JSON.stringify(dispatched) === JSON.stringify([
      { type: 'document.replaced', snapshot: undoSnapshot },
      { type: 'document.replaced', snapshot: redoSnapshot },
    ]),
    'Document undo and redo should replace the active snapshot through the durable history coordinator.',
  )
})

test('useWorkbenchHistory derives sketch toolbar availability from the durable history service', async () => {
  currentDurableHistory = createDurableHistoryStub({
    async getAvailability() {
      return { canUndo: true, canRedo: false }
    },
    getSketchDraftKey() {
      return 'sketch:sketch_active'
    },
  })

  let controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Sketch availability should not reorder document history.')
          },
          async updateDocumentVariable() {
            throw new Error('Sketch availability should not update variables.')
          },
        },
      },
      dispatch() {
        throw new Error('Sketch availability should not dispatch editor events.')
      },
      errorReporter: createTestErrorReporter(),
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages() {
        throw new Error('Sketch availability should not touch variable validation messages.')
      },
      showWorkbenchError() {
        throw new Error('Sketch availability should not surface workbench errors.')
      },
      sketchSession: { sketchId: 'sketch_active' } as never,
      snapshot: makeSnapshot(),
    }),
  )

  await hookHarness.flushEffects()
  await flushMicrotasks()
  controller = hookHarness.render(() =>
    useWorkbenchHistory({
      deps: {
        documentOwner: {
          async reorderDocumentHistory() {
            throw new Error('Sketch availability should not reorder document history.')
          },
          async updateDocumentVariable() {
            throw new Error('Sketch availability should not update variables.')
          },
        },
      },
      dispatch() {
        throw new Error('Sketch availability should not dispatch editor events.')
      },
      errorReporter: createTestErrorReporter(),
      history: { canRedo: false, canUndo: false },
      setInvalidVariableValueMessages() {
        throw new Error('Sketch availability should not touch variable validation messages.')
      },
      showWorkbenchError() {
        throw new Error('Sketch availability should not surface workbench errors.')
      },
      sketchSession: { sketchId: 'sketch_active' } as never,
      snapshot: makeSnapshot(),
    }),
  )

  expectTrue(
    controller.toolbarHistoryAvailability.canUndo && !controller.toolbarHistoryAvailability.canRedo,
    'Active sketch toolbar availability should come from the durable-history coordinator, not the legacy sketch cursor availability.',
  )
})

test('useWorkbenchHistory updates variables through the document owner and reflects durable-history availability', async () => {
  const reporter = createTestErrorReporter()
  const ownerCalls: unknown[] = []
  const availabilityRequests: string[] = []
  const shownErrors: string[] = []
  let invalidVariableMessages: Record<string, string> = { width: 'stale error' }
  let currentSnapshot = makeSnapshot({
    variables: [{ name: 'Width', valueText: '10 mm', variableId: 'width' }],
  })
  currentDurableHistory = createDurableHistoryStub({
    async getAvailability(input) {
      availabilityRequests.push(currentSnapshot.document.revisionId)
      return input.documentId === 'doc_workspace' && currentSnapshot.document.revisionId === 'rev_history_2'
        ? { canUndo: true, canRedo: false }
        : { canUndo: false, canRedo: false }
    },
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
              revisionId: 'rev_history_2',
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
              revisionId: 'rev_history_3',
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
  await flushMicrotasks()

  expectTrue(ownerCalls.length === 1, 'Variable updates should route through the document owner exactly once.')
  expectTrue(
    ownerCalls[0] && (ownerCalls[0] as { options: { operation: string } }).options.operation === 'Update Width',
    'Variable updates should preserve the user-facing operation label when calling the document owner.',
  )
  expectTrue(
    Object.keys(invalidVariableMessages).length === 0,
    'Successful variable updates should clear any prior invalid-value message for that variable.',
  )
  expectTrue(
    availabilityRequests.includes('rev_history_2'),
    'Variable updates should trigger a durable-history availability refresh after the accepted document mutation.',
  )
  expectTrue(shownErrors.length === 0, 'Successful variable updates should not surface workbench errors.')
})

test('useWorkbenchHistory surfaces invalid variable updates without changing durable-history availability', async () => {
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

  await hookHarness.flushEffects()
  controller.handleVariableUpdate(
    { name: 'Width', valueText: '10 mm', variableId: 'width' } as never,
    { name: 'Width', valueText: 'missingRef' },
  )

  await flushMicrotasks()

  expectTrue(
    invalidVariableMessages.width === 'Width must reference an existing variable.',
    'Rejected variable updates should set the invalid-value message for the edited variable.',
  )
  expectTrue(
    JSON.stringify(shownErrors) === JSON.stringify(['Width must reference an existing variable.']),
    'Rejected variable updates should surface the same human-readable error in the workbench.',
  )
  expectTrue(
    !controller.toolbarHistoryAvailability.canUndo && !controller.toolbarHistoryAvailability.canRedo,
    'Rejected variable updates should not change durable-history availability.',
  )
})

test('useWorkbenchHistory reorders document history through the document owner and reflects durable-history availability', async () => {
  const reporter = createTestErrorReporter()
  const availabilityRequests: string[] = []
  const shownErrors: string[] = []
  const reorderCalls: unknown[] = []
  const currentSnapshot = makeSnapshot({
    documentHistory: [
      makeHistoryItem('feature', 'feature_a', 'Feature A'),
      makeHistoryItem('feature', 'feature_b', 'Feature B'),
    ],
  })
  currentDurableHistory = createDurableHistoryStub({
    async getAvailability() {
      availabilityRequests.push(currentSnapshot.document.revisionId)
      return currentSnapshot.document.revisionId === 'rev_history_reorder_2'
        ? { canUndo: true, canRedo: false }
        : { canUndo: false, canRedo: false }
    },
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

  await hookHarness.flushEffects()
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
  await flushMicrotasks()

  expectTrue(
    reorderCalls[0] && (reorderCalls[0] as { item: { featureId: string } }).item.featureId === 'feature_b',
    'Document history reorder should be delegated to the document owner with the requested move.',
  )
  expectTrue(
    availabilityRequests.includes('rev_history_reorder_2'),
    'Accepted history reorders should trigger a durable-history availability refresh from the repository-backed coordinator.',
  )
  expectTrue(shownErrors.length === 0, 'Accepted history reorders should not surface workbench errors.')
})

function createDurableHistoryStub(
  overrides: Partial<DurableHistoryService> = {},
): DurableHistoryService {
  return {
    async getAvailability() {
      return { canUndo: false, canRedo: false }
    },
    async undo() {
      return null
    },
    async redo() {
      return null
    },
    async restoreSketchDraft() {
      return null
    },
    async syncSketchDraft() {
      return { canUndo: false, canRedo: false }
    },
    async clearSketchDraft() {
      return undefined
    },
    getSketchDraftKey() {
      return 'draft-key'
    },
    ...overrides,
  }
}
