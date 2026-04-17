import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import {
  getEditorViewState,
  initialEditorState,
} from '@/contracts/editor/state-machine'
import { createNewSketchSession } from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createToolActionBus } from '@/domain/tools/tool-action-bus'
import { EditorContext } from '@/hooks/editor-context'
import { ToolActionProvider } from '@/hooks/tool-action-provider'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/workspace-toolbar.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const toolbarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
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
      </EditorContext.Provider>
    </MantineProvider>,
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

  const sketchToolbarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider
        value={{
          machineState: initialEditorState,
          state: {
            ...getEditorViewState(initialEditorState),
            mode: 'sketch',
            activeCommand: {
              commandSessionId: 'command_sketch-1',
              toolId: 'line',
              phase: 'editing',
            },
            sketchSession: createNewSketchSession(createStandardPlaneDefinition('xy')),
          },
          dispatch: () => undefined,
        }}
      >
        <ToolActionProvider actionBus={createToolActionBus()}>
          <WorkspaceToolbar />
        </ToolActionProvider>
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(
    sketchToolbarMarkup.includes('aria-label="Finish Sketch"'),
    'Toolbar should render Finish Sketch while a sketch session is active.',
  )
  assert(
    sketchToolbarMarkup.includes('/icons/sketch-line-segment.svg') &&
      sketchToolbarMarkup.includes('/icons/sketch-dimension.svg') &&
      sketchToolbarMarkup.includes('/icons/sketch-construction.svg'),
    'Sketch toolbar buttons and dropdown triggers should keep local SVG icons.',
  )
  assert(
    sketchToolbarMarkup.includes('var(--workbench-shell-success-surface)') &&
      sketchToolbarMarkup.includes('var(--workbench-shell-success-border)'),
    'Finish Sketch should use the semantic success treatment from the shared workbench theme.',
  )

  const constructionSession = {
    ...createNewSketchSession(createStandardPlaneDefinition('xy')),
    constructionModifierActive: true,
  }
  const constructionToolbarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider
        value={{
          machineState: initialEditorState,
          state: {
            ...getEditorViewState(initialEditorState),
            mode: 'sketch',
            activeCommand: {
              commandSessionId: 'command_sketch-1',
              toolId: 'line',
              phase: 'editing',
            },
            sketchSession: constructionSession,
          },
          dispatch: () => undefined,
        }}
      >
        <ToolActionProvider actionBus={createToolActionBus()}>
          <WorkspaceToolbar />
        </ToolActionProvider>
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(
    constructionToolbarMarkup.includes('aria-label="Construction"') &&
      constructionToolbarMarkup.includes('aria-pressed="true"'),
    'Construction should render selected while acting as a sketch modifier.',
  )
})
