import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { expectTrue } from '@/testing/expect.spec'
import { createToolActionBus } from '@/core/tools/tool-action-bus'
import type { ToolId } from '@/core/tools/tool-registry'
import type { ToolTriggerMetadata } from '@/core/tools/schema'
import {
  getEditorViewState,
  initialEditorState,
  type EditorEvent,
} from '@/domain/editor/state-machine'
import { EditorContext } from '@/hooks/editor-context'
import { ToolActionContext } from '@/hooks/tool-action-context'
import { useToolActions } from '@/hooks/use-tool-actions'

test('useToolActions routes same-component undo and redo handlers before WorkbenchCommandProvider is rendered', async () => {
  const actionBus = createToolActionBus()
  const dispatched: EditorEvent[] = []
  const triggeredTools: ToolId[] = []
  let requestUndoCount = 0
  let requestRedoCount = 0
  let triggerTool: ((toolId: ToolId, metadata: ToolTriggerMetadata) => Promise<void>) | null = null

  actionBus.subscribeToTool('undo', (event) => {
    triggeredTools.push(event.toolId)
  })
  actionBus.subscribeToTool('redo', (event) => {
    triggeredTools.push(event.toolId)
  })

  function CaptureToolActions() {
    triggerTool = useToolActions({
      commandHandlers: {
        requestPartImport() {
          throw new Error('Undo/redo regression coverage should not request part import.')
        },
        requestRedo() {
          requestRedoCount += 1
        },
        requestUndo() {
          requestUndoCount += 1
        },
      },
    }).triggerTool
    return null
  }

  renderToStaticMarkup(
    <ToolActionContext.Provider value={{ actionBus }}>
      <EditorContext.Provider
        value={{
          dispatch: (event) => {
            dispatched.push(event)
          },
          getRuntimeTrace: () => ({ events: [] }) as never,
          machineState: initialEditorState,
          state: getEditorViewState(initialEditorState),
        }}
      >
        <CaptureToolActions />
      </EditorContext.Provider>
    </ToolActionContext.Provider>,
  )

  expectTrue(triggerTool !== null, 'Tool action capture should expose the trigger function.')
  if (!triggerTool) {
    throw new Error('Tool action capture should expose the trigger function.')
  }
  await triggerTool('undo', { source: 'toolbar' })
  await triggerTool('redo', { source: 'toolbar' })

  expectTrue(
    requestUndoCount === 1 && requestRedoCount === 1,
    'Toolbar undo and redo should route through the explicit workbench command handlers.',
  )
  expectTrue(
    dispatched.every((event) => event.type !== 'history.undoRequested' && event.type !== 'history.redoRequested'),
    'Toolbar undo and redo must not fall back to legacy editor history events when durable handlers are supplied.',
  )
  expectTrue(
    JSON.stringify(triggeredTools) === JSON.stringify(['undo', 'redo']),
    'Undo and redo toolbar activations should still publish tool action bus events.',
  )
})
