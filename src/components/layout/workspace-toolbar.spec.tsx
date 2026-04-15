import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import {
  getEditorViewState,
  initialEditorState,
} from '@/contracts/editor/state-machine'
import { createToolActionBus } from '@/domain/tools/tool-action-bus'
import { EditorContext } from '@/hooks/editor-context'
import { ToolActionProvider } from '@/hooks/tool-action-provider'

test('src/components/layout/workspace-toolbar.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const toolbarMarkup = renderToStaticMarkup(
    <EditorContext.Provider
      value={{
        machineState: initialEditorState,
        state: getEditorViewState(initialEditorState),
        dispatch: () => undefined,
      }}
    >
      <ToolActionProvider actionBus={createToolActionBus()}>
        <WorkspaceToolbar />
      </ToolActionProvider>
    </EditorContext.Provider>,
  )

  assert(toolbarMarkup.includes('Search tools'), 'Toolbar should keep the tool search input.')
  assert(
    toolbarMarkup.includes('/icons/extrude.svg'),
    'Toolbar should render standard tool buttons with local SVG assets.',
  )
  assert(
    toolbarMarkup.includes('/icons/linear-pattern.svg'),
    'Toolbar should render dropdown-backed tool triggers with local SVG assets.',
  )
  assert(
    toolbarMarkup.includes('aria-label="Extrude"'),
    'Toolbar buttons should expose concise accessibility labels based on the tool name.',
  )
  assert(!toolbarMarkup.includes('Filter:'), 'Toolbar should not duplicate the selection filter debugger readout.')
  assert(!toolbarMarkup.includes('Requirement:'), 'Toolbar should not duplicate the requirement debugger readout.')
  assert(!toolbarMarkup.includes('Slots:'), 'Toolbar should not duplicate the slot-count debugger readout.')
})
