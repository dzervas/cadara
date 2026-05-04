import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import { getNextToolSearchHighlightIndex } from '@/components/layout/workspace-toolbar.a11y'
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

test('src/components/layout/workspace-toolbar.spec.tsx', async () => {  function getToolMarkup(markup: string, toolId: string) {
    const toolIdIndex = markup.indexOf(`data-tool-id="${toolId}"`)
    expectTrue(toolIdIndex >= 0, `Expected ${toolId} tool markup to exist.`)

    const start = markup.lastIndexOf('<button', toolIdIndex)
    expectTrue(start >= 0, `Expected ${toolId} tool button markup to exist.`)

    const end = markup.indexOf('</button>', toolIdIndex)
    return end >= 0 ? markup.slice(start, end) : markup.slice(start)
  }

  function getDropdownTriggerMarkup(markup: string, toolId: string) {
    const triggerIndex = markup.indexOf(`data-tool-dropdown-trigger="${toolId}"`)
    expectTrue(triggerIndex >= 0, `Expected ${toolId} dropdown trigger markup to exist.`)

    const start = markup.lastIndexOf('<button', triggerIndex)
    expectTrue(start >= 0, `Expected ${toolId} dropdown trigger button markup to exist.`)

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

  expectTrue(toolbarMarkup.includes('Search tools'), 'Toolbar should keep the tool search input.')
  expectTrue(
    toolbarMarkup.includes('role="combobox"')
      && toolbarMarkup.includes('aria-autocomplete="list"')
      && toolbarMarkup.includes('aria-expanded="false"'),
    'Toolbar search should expose collapsed combobox semantics before any results are shown.',
  )
  expectTrue(
    toolbarMarkup.includes('aria-label="File"')
      && toolbarMarkup.indexOf('aria-label="File"') < toolbarMarkup.indexOf('data-tool-id="undo"'),
    'Toolbar should render the file menu trigger (the spark logo) before the CAD tool sections.',
  )
  expectTrue(
    toolbarMarkup.includes('min-w-0'),
    'Toolbar tool cluster row should be allowed to shrink so the absolute floating bar does not widen the workbench shell.',
  )
  expectTrue(
    toolbarMarkup.includes('data-toolbar-responsive-rows="1"'),
    'Toolbar should advertise its measured responsive row count so browser coverage can guard narrow-width spillover.',
  )
  expectTrue(
    toolbarMarkup.includes('role="toolbar"') && toolbarMarkup.includes('aria-label="CAD tools"'),
    'Toolbar tool groups should be wrapped in an explicit toolbar landmark.',
  )
  expectTrue(
    toolbarMarkup.includes('/icons/extrude.svg'),
    'Toolbar should render standard tool buttons with local SVG assets.',
  )
  expectTrue(
    toolbarMarkup.includes('data-tool-id="import"')
      && toolbarMarkup.includes('aria-label="Import"')
      && toolbarMarkup.includes('/icons/import-part.svg'),
    'Toolbar should expose import as a real icon-only tool in part mode.',
  )
  expectTrue(
    toolbarMarkup.includes('/icons/linear-pattern.svg'),
    'Toolbar should render dropdown-backed tool triggers with local SVG assets.',
  )
  expectTrue(
    toolbarMarkup.includes('aria-label="Extrude"'),
    'Toolbar buttons should expose concise accessibility labels based on the tool name.',
  )
  expectTrue(
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

  expectTrue(
    reportBugToolbarMarkup.includes('aria-label="Report bug"')
      && reportBugToolbarMarkup.includes('type="button"')
      && reportBugToolbarMarkup.includes('/icons/bug.svg'),
    'Toolbar should render the report-bug action as an icon-only button with local asset and accessible label.',
  )
  expectTrue(
    toolbarMarkup.includes('data-tool-id="undo"')
      && toolbarMarkup.includes('data-tool-id="redo"')
      && getToolMarkup(toolbarMarkup, 'undo').includes('data-disabled="true"')
      && getToolMarkup(toolbarMarkup, 'redo').includes('data-disabled="true"'),
    'Undo and redo should render disabled when no history step is available.',
  )
  expectTrue(
    getToolMarkup(toolbarMarkup, 'undo').includes('opacity:0.46')
      && getToolMarkup(toolbarMarkup, 'redo').includes('opacity:0.46'),
    'Disabled undo and redo buttons should render with a visibly muted toolbar treatment.',
  )
  expectTrue(!toolbarMarkup.includes('Filter:'), 'Toolbar should not duplicate the selection filter debugger readout.')
  expectTrue(!toolbarMarkup.includes('Requirement:'), 'Toolbar should not duplicate the requirement debugger readout.')
  expectTrue(!toolbarMarkup.includes('Slots:'), 'Toolbar should not duplicate the slot-count debugger readout.')

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

  expectTrue(
    sketchToolbarMarkup.includes('aria-label="Finish Sketch"'),
    'Toolbar should render Finish Sketch while a sketch session is active.',
  )
  expectTrue(
    sketchToolbarMarkup.includes('/icons/sketch-line-segment.svg')
      && sketchToolbarMarkup.includes('/icons/sketch-dimension.svg')
      && sketchToolbarMarkup.includes('/icons/sketch-construction.svg')
      && sketchToolbarMarkup.includes('/icons/eye_open.svg')
      && sketchToolbarMarkup.includes('/icons/svg-fill.svg')
      && sketchToolbarMarkup.includes('/icons/svg-stroke.svg'),
    'Sketch toolbar buttons and dropdown triggers should keep local SVG icons.',
  )
  expectTrue(
    sketchToolbarMarkup.includes('data-tool-id="svgRendering"')
      && sketchToolbarMarkup.includes('data-tool-id="fill"')
      && sketchToolbarMarkup.includes('data-tool-id="stroke"')
      && !sketchToolbarMarkup.includes('data-tool-id="fillType"')
      && !sketchToolbarMarkup.includes('data-tool-id="strokeOptions"'),
    'Sketch toolbar should include the SVG rendering toggle and only Fill/Stroke SVG style tools.',
  )
  expectTrue(
    !getDropdownTriggerMarkup(sketchToolbarMarkup, 'line').includes('border-left'),
    'Sketch dropdown tools should not render a divider between the tool icon and dropdown affordance.',
  )
  expectTrue(
    !getToolMarkup(sketchToolbarMarkup, 'fill').includes('data-disabled="true"')
      && !getToolMarkup(sketchToolbarMarkup, 'stroke').includes('data-disabled="true"'),
    'SVG style toolbar controls should stay available without a target so activation can show target guidance.',
  )
  expectTrue(
    sketchToolbarMarkup.includes('var(--workbench-shell-success-surface)')
      && sketchToolbarMarkup.includes('var(--workbench-shell-success-border)'),
    'Finish Sketch should use the semantic success treatment from the shared workbench theme.',
  )

  let styledSession = createNewSketchSession(createStandardPlaneDefinition('xy'))
  styledSession = beginSketchTool(styledSession, 'line')
  styledSession = startSketchDraw(styledSession, [0, 0])
  styledSession = acceptSketchDraw(styledSession, [4, 0])
  const styleTarget = styledSession.definition.entities[0]?.target
  expectTrue(styleTarget, 'Toolbar style availability fixture should create a local sketch entity.')
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

  expectTrue(
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

  expectTrue(
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

  expectTrue(
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

  expectTrue(
    getToolMarkup(historyToolbarMarkup, 'redo').includes('data-disabled="true"'),
    'Redo should render disabled when no redo step is available.',
  )
  expectTrue(
    !getToolMarkup(historyToolbarMarkup, 'undo').includes('data-disabled="true"'),
    'Undo should render enabled when an undo step is available.',
  )
  expectTrue(
    getNextToolSearchHighlightIndex(-1, 'ArrowDown', 4) === 0
      && getNextToolSearchHighlightIndex(0, 'ArrowUp', 4) === 0
      && getNextToolSearchHighlightIndex(1, 'End', 4) === 3
      && getNextToolSearchHighlightIndex(3, 'Home', 4) === 0
      && getNextToolSearchHighlightIndex(0, 'Escape', 4) === null,
    'Toolbar search keyboard navigation should clamp within the result set and ignore unrelated keys.',
  )
})
