import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import {
  getEditorViewState,
  initialEditorState,
  type EditorViewState,
} from '@/domain/editor/state-machine'
import {
  acceptSketchDraw,
  beginSketchTool,
  createNewSketchSession,
  focusSketchStyleTool,
  startSketchDraw,
} from '@/domain/editor/sketch-session'
import { createStandardPlaneDefinition } from '@/domain/modeling/opencascade-kernel-seed'
import { createToolActionBus } from '@/core/tools/tool-action-bus'
import { EditorContext } from '@/hooks/editor-context'
import { ToolActionProvider } from '@/hooks/tool-action-provider'
import { WorkbenchCommandProvider } from '@/hooks/workbench-command-provider'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/workspace-toolbar.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function getToolMarkup(markup: string, toolId: string) {
    const toolIdIndex = markup.indexOf(`data-tool-id="${toolId}"`)
    assert(toolIdIndex >= 0, `Expected ${toolId} tool markup to exist.`)

    const start = markup.lastIndexOf('<button', toolIdIndex)
    assert(start >= 0, `Expected ${toolId} tool button markup to exist.`)

    const end = markup.indexOf('</button>', toolIdIndex)
    return end >= 0 ? markup.slice(start, end) : markup.slice(start)
  }

  function getDropdownTriggerMarkup(markup: string, toolId: string) {
    const triggerIndex = markup.indexOf(`data-tool-dropdown-trigger="${toolId}"`)
    assert(triggerIndex >= 0, `Expected ${toolId} dropdown trigger markup to exist.`)

    const start = markup.lastIndexOf('<button', triggerIndex)
    assert(start >= 0, `Expected ${toolId} dropdown trigger button markup to exist.`)

    const end = markup.indexOf('</button>', triggerIndex)
    return end >= 0 ? markup.slice(start, end) : markup.slice(start)
  }

  const workbenchHandlers = {
    activateTool: () => undefined,
    requestPartImport: () => undefined,
    requestRedo: () => undefined,
    requestUndo: () => undefined,
  }

  function renderToolbar({
    onReportBug,
    state,
  }: {
    onReportBug?: () => void
    state?: Partial<EditorViewState>
  } = {}) {
    const viewState = {
      ...getEditorViewState(initialEditorState),
      ...state,
    }

    return renderToStaticMarkup(
      <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
        <EditorContext.Provider
          value={{
            machineState: initialEditorState,
            state: viewState,
            dispatch: () => undefined,
          }}
        >
          <ToolActionProvider actionBus={createToolActionBus()}>
            <WorkbenchCommandProvider handlers={workbenchHandlers}>
              <WorkspaceToolbar onReportBug={onReportBug} />
            </WorkbenchCommandProvider>
          </ToolActionProvider>
        </EditorContext.Provider>
      </MantineProvider>,
    )
  }

  const toolbarMarkup = renderToolbar()

  assert(toolbarMarkup.includes('Search tools'), 'Toolbar should keep the tool search input.')
  assert(
    toolbarMarkup.includes('aria-label="File"')
      && toolbarMarkup.indexOf('aria-label="File"') < toolbarMarkup.indexOf('data-tool-id="undo"'),
    'Toolbar should render the document file menu before the CAD tool sections.',
  )
  assert(
    toolbarMarkup.includes('overflow-x-auto')
      && toolbarMarkup.includes('w-max')
      && toolbarMarkup.includes('shrink-0'),
    'Toolbar tools should scroll inside the header instead of widening the workbench shell.',
  )
  assert(
    toolbarMarkup.includes('/icons/extrude.svg'),
    'Toolbar should render standard tool buttons with local SVG assets.',
  )
  assert(
    toolbarMarkup.includes('data-tool-id="import"')
      && toolbarMarkup.includes('aria-label="Import"')
      && toolbarMarkup.includes('/icons/import-part.svg'),
    'Toolbar should expose import as a real icon-only tool in part mode.',
  )
  assert(
    toolbarMarkup.includes('/icons/linear-pattern.svg'),
    'Toolbar should render dropdown-backed tool triggers with local SVG assets.',
  )
  assert(
    toolbarMarkup.includes('aria-label="Extrude"'),
    'Toolbar buttons should expose concise accessibility labels based on the tool name.',
  )
  assert(
    toolbarMarkup.includes('href="https://github.com/dzervas/cadara"')
      && toolbarMarkup.includes('target="_blank"')
      && toolbarMarkup.includes('rel="noreferrer"')
      && toolbarMarkup.includes('aria-label="Open repository on GitHub"')
      && toolbarMarkup.includes('/icons/GitHub-logo.svg'),
    'Toolbar should render a safe GitHub repository link at the end.',
  )

  const reportBugToolbarMarkup = renderToolbar({
    onReportBug: () => undefined,
  })

  assert(
    reportBugToolbarMarkup.includes('aria-label="Report bug"')
      && reportBugToolbarMarkup.includes('type="button"')
      && reportBugToolbarMarkup.includes('/icons/bug.svg'),
    'Toolbar should render the report-bug action as an icon-only button with local asset and accessible label.',
  )
  assert(
    toolbarMarkup.includes('data-tool-id="undo"')
      && toolbarMarkup.includes('data-tool-id="redo"')
      && getToolMarkup(toolbarMarkup, 'undo').includes('data-disabled="true"')
      && getToolMarkup(toolbarMarkup, 'redo').includes('data-disabled="true"'),
    'Undo and redo should render disabled when no history step is available.',
  )
  assert(
    getToolMarkup(toolbarMarkup, 'undo').includes('opacity:0.46')
      && getToolMarkup(toolbarMarkup, 'redo').includes('opacity:0.46'),
    'Disabled undo and redo buttons should render with a visibly muted toolbar treatment.',
  )
  assert(!toolbarMarkup.includes('Filter:'), 'Toolbar should not duplicate the selection filter debugger readout.')
  assert(!toolbarMarkup.includes('Requirement:'), 'Toolbar should not duplicate the requirement debugger readout.')
  assert(!toolbarMarkup.includes('Slots:'), 'Toolbar should not duplicate the slot-count debugger readout.')

  const sketchToolbarMarkup = renderToolbar({
    state: {
      mode: 'sketch',
      activeCommand: {
        commandSessionId: 'command_sketch-1',
        toolId: 'line',
        phase: 'editing',
      },
      sketchSession: createNewSketchSession(createStandardPlaneDefinition('xy')),
    },
  })

  assert(
    sketchToolbarMarkup.includes('aria-label="Finish Sketch"'),
    'Toolbar should render Finish Sketch while a sketch session is active.',
  )
  assert(
    sketchToolbarMarkup.includes('/icons/sketch-line-segment.svg')
      && sketchToolbarMarkup.includes('/icons/sketch-dimension.svg')
      && sketchToolbarMarkup.includes('/icons/sketch-construction.svg')
      && sketchToolbarMarkup.includes('/icons/eye_open.svg')
      && sketchToolbarMarkup.includes('/icons/svg-fill.svg')
      && sketchToolbarMarkup.includes('/icons/svg-stroke.svg'),
    'Sketch toolbar buttons and dropdown triggers should keep local SVG icons.',
  )
  assert(
    sketchToolbarMarkup.includes('data-tool-id="svgRendering"')
      && sketchToolbarMarkup.includes('data-tool-id="fill"')
      && sketchToolbarMarkup.includes('data-tool-id="stroke"')
      && !sketchToolbarMarkup.includes('data-tool-id="fillType"')
      && !sketchToolbarMarkup.includes('data-tool-id="strokeOptions"'),
    'Sketch toolbar should include the SVG rendering toggle and only Fill/Stroke SVG style tools.',
  )
  assert(
    !getDropdownTriggerMarkup(sketchToolbarMarkup, 'line').includes('border-left'),
    'Sketch dropdown tools should not render a divider between the tool icon and dropdown affordance.',
  )
  assert(
    !getToolMarkup(sketchToolbarMarkup, 'fill').includes('data-disabled="true"')
      && !getToolMarkup(sketchToolbarMarkup, 'stroke').includes('data-disabled="true"'),
    'SVG style toolbar controls should stay available without a target so activation can show target guidance.',
  )
  assert(
    sketchToolbarMarkup.includes('var(--workbench-shell-success-surface)')
      && sketchToolbarMarkup.includes('var(--workbench-shell-success-border)'),
    'Finish Sketch should use the semantic success treatment from the shared workbench theme.',
  )

  let styledSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
  styledSession = beginSketchTool(styledSession, 'line')
  styledSession = startSketchDraw(styledSession, [0, 0])
  styledSession = acceptSketchDraw(styledSession, [4, 0])
  const styleTarget = styledSession.definition.entities[0]?.target
  assert(styleTarget, 'Toolbar style availability fixture should create a local sketch entity.')
  styledSession = focusSketchStyleTool(styledSession, [styleTarget], 'stroke')

  const styleTargetToolbarMarkup = renderToolbar({
    state: {
      mode: 'sketch',
      selection: [styleTarget],
      activeCommand: {
        commandSessionId: 'command_sketch-1',
        toolId: 'line',
        phase: 'editing',
      },
      sketchSession: styledSession,
    },
  })

  assert(
    !getToolMarkup(styleTargetToolbarMarkup, 'fill').includes('data-disabled="true"')
      && !getToolMarkup(styleTargetToolbarMarkup, 'stroke').includes('data-disabled="true"')
      && getToolMarkup(styleTargetToolbarMarkup, 'stroke').includes('aria-pressed="true"'),
    'Fill and Stroke should remain available while Stroke shows active for a selected sketch entity.',
  )

  const baseSvgDisabledSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
  const svgDisabledSession = {
    ...baseSvgDisabledSession,
    fullDefinition: {
      ...baseSvgDisabledSession.fullDefinition,
      svgRenderingEnabled: false,
    },
    definition: {
      ...baseSvgDisabledSession.definition,
      svgRenderingEnabled: false,
    },
  }
  const svgDisabledToolbarMarkup = renderToolbar({
    state: {
      mode: 'sketch',
      activeCommand: {
        commandSessionId: 'command_sketch-1',
        toolId: 'line',
        phase: 'editing',
      },
      sketchSession: svgDisabledSession,
    },
  })

  assert(
    getToolMarkup(svgDisabledToolbarMarkup, 'fill').includes('data-disabled="true"')
      && getToolMarkup(svgDisabledToolbarMarkup, 'stroke').includes('data-disabled="true"')
      && !getToolMarkup(svgDisabledToolbarMarkup, 'svgRendering').includes('aria-pressed="true"'),
    'Fill and Stroke should only disable when SVG rendering is off.',
  )

  const constructionSession = {
    ...createNewSketchSession(createStandardPlaneDefinition('xy')),
    constructionModifierActive: true,
  }
  const constructionToolbarMarkup = renderToolbar({
    state: {
      mode: 'sketch',
      activeCommand: {
        commandSessionId: 'command_sketch-1',
        toolId: 'line',
        phase: 'editing',
      },
      sketchSession: constructionSession,
    },
  })

  assert(
    constructionToolbarMarkup.includes('aria-label="Construction"')
      && constructionToolbarMarkup.includes('aria-pressed="true"'),
    'Construction should render selected while acting as a sketch modifier.',
  )

  const historyToolbarMarkup = renderToolbar({
    state: {
      history: {
        canUndo: true,
        canRedo: false,
      },
    },
  })

  assert(
    getToolMarkup(historyToolbarMarkup, 'redo').includes('data-disabled="true"'),
    'Redo should render disabled when no redo step is available.',
  )
  assert(
    !getToolMarkup(historyToolbarMarkup, 'undo').includes('data-disabled="true"'),
    'Undo should render enabled when an undo step is available.',
  )
})
