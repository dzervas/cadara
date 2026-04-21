import { test } from 'bun:test'

test('src/app/cad-workbench-history-routing.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const source = await Bun.file(new URL('./cad-workbench.tsx', import.meta.url)).text()

  assert(
    !source.includes('modelingService.setFeatureCursor'),
    'Workbench document history UI should not call modelingService.setFeatureCursor directly.',
  )
  assert(
    source.includes("type: 'document.historyCursorRequested'"),
    'Workbench document history UI should dispatch editor cursor requests.',
  )
  assert(
    source.includes("kind: 'reorderDocumentHistory'"),
    'Accepted document history reorders should create workbench undo entries.',
  )
  assert(
    source.includes('modelingService.reorderDocumentHistory'),
    'Workbench reorder undo and redo should apply through the modeling service.',
  )
  assert(
    source.includes("operation: 'Reorder document history'") && source.includes('onError: (error) => showWorkbenchError(error.message)'),
    'Rejected document history reorders should surface through the workbench error notification path.',
  )
  assert(
    source.includes("type: 'document.snapshotLoaded'"),
    'Accepted document history reorders should apply the loaded snapshot directly for immediate UI updates.',
  )
  assert(
    source.includes('sketchSessionRef.current || isUndoRedoRunning'),
    'Workbench undo/redo should keep sketch-local history priority while sketch editing is active.',
  )
})
