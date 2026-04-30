import { test } from 'bun:test'

test('src/app/cad-workbench-history-routing.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const workbenchSource = await Bun.file(new URL('./workbench/cad-workbench.tsx', import.meta.url)).text()
  const historySource = await Bun.file(new URL('./workbench/controllers/use-workbench-history.ts', import.meta.url)).text()

  assert(
    !workbenchSource.includes('modelingService.setFeatureCursor'),
    'Workbench document history UI should not call modelingService.setFeatureCursor directly.',
  )
  assert(
    workbenchSource.includes('onReopenTarget={handleNavigationReopen}'),
    'Workbench document history UI should route history-row reopen actions through the shared viewport/navigation controller.',
  )
  assert(
    workbenchSource.includes('onDocumentCursorRequested={handleTimelineCursorRequested}'),
    'Workbench document history UI should route history-row cursor actions through the shared timeline cursor request handler.',
  )
  assert(
    workbenchSource.includes("dispatch({ type: 'document.historyCursorRequested', cursor })"),
    'Workbench timeline cursor requests should dispatch the existing editor-owned document cursor event.',
  )
  assert(
    workbenchSource.includes('requestUndo,')
      && workbenchSource.includes('requestRedo,')
      && workbenchSource.includes('activateTool: triggerTool'),
    'Workbench should compose shared history and tool command entrypoints before wiring shortcuts and toolbar surfaces.',
  )
  assert(
    historySource.includes("kind: 'reorderDocumentHistory'"),
    'Accepted document history reorders should create workbench undo entries in the shared history controller.',
  )
  assert(
    historySource.includes('documentOwner.reorderDocumentHistory')
      && !historySource.includes('modelingService.reorderDocumentHistory'),
    'Workbench reorder undo and redo should route through the shared document owner instead of mutating modeling history directly.',
  )
  assert(
    historySource.includes("operation: 'Reorder document history'")
      && historySource.includes('onError: (error) => showWorkbenchError(error.message)'),
    'Rejected document history reorders should surface through the workbench error notification path.',
  )
  assert(
    historySource.includes('result.value.snapshot.presentation.documentHistory')
      && !historySource.includes('applyLoadedSnapshot(nextSnapshot)'),
    'Accepted document history reorders should derive their immediate UI state from the authoritative owner result.',
  )
  assert(
    historySource.includes('sketchSessionRef.current || isUndoRedoRunning'),
    'Workbench undo/redo should keep sketch-local history priority while sketch editing is active.',
  )
})
