import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeatureSidebar } from '@/components/layout/feature-sidebar'
import { FeatureTimelineBar } from '@/components/layout/feature-timeline-bar'
import { HistoryTimelineShell } from '@/components/layout/history-timeline-shell'
import {
  getNearestTimelineAnchorIndex,
  TIMELINE_CURSOR_GLYPH,
} from '@/components/layout/feature-timeline-bar.helpers'
import {
  getEditorViewState,
  initialEditorState,
} from '@/contracts/editor/state-machine'
import { getPrimitiveRefKey } from '@/domain/editor/schema'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'
import { createSketchSessionFromSnapshot } from '@/domain/editor/sketch-session'
import { EditorContext } from '@/hooks/editor-context'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/layout/feature-timeline-bar.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const adapter = new MockKernelAdapter()
  const response = await adapter.getDocumentSnapshot({
    contractVersion: 'modeling-contract/v1alpha1',
    documentId: 'doc_workspace',
  })
  const snapshot = response.snapshot
  const editorValue = {
    machineState: initialEditorState,
    state: {
      ...getEditorViewState(initialEditorState),
      selectionCatalog: {
        selectableTargetKeys: snapshot.presentation.entities.map((entity) => getPrimitiveRefKey(entity.target)),
        existingSketchKeys: snapshot.presentation.entities
          .filter((entity) => entity.selectionSemantics.includes('existingSketch'))
          .map((entity) => getPrimitiveRefKey(entity.target)),
        constructionPlaneKeys: [],
        planarFaceKeys: [],
      },
    },
    dispatch: () => undefined,
  }

  const sidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={snapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{
            [getPrimitiveRefKey(snapshot.presentation.objects[0]!.target)]: 'Renamed Object',
          }}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(!sidebarMarkup.includes('Feature Tree'), 'Sidebar should not render the feature tree section.')
  assert(sidebarMarkup.includes('Parts &amp; Objects'), 'Sidebar should keep the parts and objects section.')
  assert(sidebarMarkup.includes('Renamed Object'), 'Sidebar parts and objects should render rename overrides.')
  assert(sidebarMarkup.includes('Sketch 1'), 'Sidebar parts and objects should include committed sketches.')
  assert(
    sidebarMarkup.includes('Double-click to reopen authoring in place'),
    'Sidebar sketch rows should expose double-click reopen behavior.',
  )
  assert(sidebarMarkup.includes('Variables'), 'Sidebar should render the variables section.')
  assert(!sidebarMarkup.includes('Snapshot References'), 'Sidebar should not render snapshot references as the standard middle section.')
  assert(sidebarMarkup.includes('aria-label="Add variable"'), 'Sidebar variables should expose an add button.')
  assert(sidebarMarkup.includes('Document Diagnostics'), 'Sidebar should keep document diagnostics.')
  assert(sidebarMarkup.includes('aria-haspopup="menu"'), 'Sidebar rows should expose custom context menu affordances.')
  assert(
    sidebarMarkup.includes('hover:bg-[var(--workbench-shell-accent-surface)]'),
    'Sidebar object rows should highlight across the full row container with the shared workbench accent surface.',
  )

  const variableResultSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      variables: [
        { variableId: 'variable_width' as const, name: 'width', valueText: '10 + 2' },
        { variableId: 'variable_depth' as const, name: 'depth', valueText: 'width * 3' },
      ],
    },
    variables: [
      { variableId: 'variable_width' as const, name: 'width', valueText: '10 + 2' },
      { variableId: 'variable_depth' as const, name: 'depth', valueText: 'width * 3' },
    ],
  }
  const variableSidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={variableResultSnapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(variableSidebarMarkup.includes('aria-label="Edit variable variable_width"'), 'Existing variables should expose a double-click row edit control.')
  assert(!variableSidebarMarkup.includes('aria-label="Variable name variable_width"'), 'Existing variables should render read-only rows until edited.')
  assert(variableSidebarMarkup.includes('data-variable-expression="variable_width"') && variableSidebarMarkup.includes('10 + 2'), 'Read-only variable rows should keep the authored expression visible.')
  assert(variableSidebarMarkup.includes('aria-hidden="true" class="shrink-0 text-[12px] leading-4 text-[var(--mantine-color-dark-3)]">=</span>'), 'Read-only variable rows should separate expressions and results with an equals sign.')
  assert(variableSidebarMarkup.includes('font-mono') && variableSidebarMarkup.includes('>12</span>'), 'Variable expression results should render in a monospace value chip.')
  assert(variableSidebarMarkup.includes('inline-block max-w-full shrink-0 truncate rounded border px-2 py-1 text-right font-mono'), 'Variable expression results should size to their text instead of using a fixed minimum width.')
  assert(variableSidebarMarkup.includes('var(--workbench-shell-success-surface)'), 'Successful variable results should use the shared success background.')
  assert(variableSidebarMarkup.includes('data-result-state="success"'), 'Successful variable results should expose success state metadata.')

  const invalidVariableSidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={variableResultSnapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueMessages={{ variable_width: 'Width expression failed.' }}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(invalidVariableSidebarMarkup.includes('>???</span>'), 'Invalid variable results should render the placeholder result.')
  assert(invalidVariableSidebarMarkup.includes('data-result-state="error"'), 'Invalid variable results should expose error state metadata.')
  assert(invalidVariableSidebarMarkup.includes('var(--workbench-shell-danger-text)'), 'Invalid variable results should use the shared danger color.')
  assert(invalidVariableSidebarMarkup.includes('Variable result error: Width expression failed.'), 'Invalid variable results should expose the same error message used by the persistent tooltip.')
  assert(invalidVariableSidebarMarkup.includes('data-invalid-value="true"'), 'Runtime invalid variable state should render danger styling.')

  const blankVariableSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      variables: [
        { variableId: 'variable_depth' as const, name: 'depth', valueText: '' },
      ],
    },
    variables: [
      { variableId: 'variable_depth' as const, name: 'depth', valueText: '' },
    ],
  }
  const blankVariableSidebarMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={blankVariableSnapshot}
          hiddenTargetKeys={{}}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(blankVariableSidebarMarkup.includes('aria-label="Variable name variable_depth"'), 'New blank variables should render name text inputs.')
  assert(blankVariableSidebarMarkup.includes('aria-label="Variable value variable_depth"'), 'New blank variables should render value text inputs.')

  const hiddenObjectMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={snapshot}
          hiddenTargetKeys={{ [getPrimitiveRefKey(snapshot.presentation.objects[0]!.target)]: true }}
          invalidVariableValueIds={{}}
          objectLabelOverrides={{}}
          visibleSelection={[]}
          onAddVariable={() => undefined}
          onInspectDiagnostic={() => undefined}
          onObjectDelete={() => undefined}
          onObjectExport={() => undefined}
          onRenameTarget={() => undefined}
          onReopenTarget={() => undefined}
          onSelectTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
          onUpdateVariable={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(
    !hiddenObjectMarkup.includes('>Hidden<'),
    'Hidden sidebar objects should not render a separate hidden status label.',
  )

  const timelineMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureTimelineBar
          snapshot={snapshot}
          visibleSelection={[{ kind: 'feature', featureId: 'feature_extrude-1' }]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onCursorRequested={() => undefined}
          onDeleteFeature={() => undefined}
          onRenameItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(timelineMarkup.includes('aria-label="Feature timeline"'), 'Timeline should expose a region label.')
  assert(timelineMarkup.includes('aria-label="Select Sketch 1. Double-click to reopen."'), 'Timeline should expose committed sketch selection labels.')
  assert(timelineMarkup.includes('aria-label="Select Extrude 1. Double-click to reopen."'), 'Timeline should expose feature selection labels.')
  assert(timelineMarkup.includes('aria-current="step"'), 'Timeline should expose the current cursor position.')
  assert(!timelineMarkup.includes('>Extrude 1</button>'), 'Timeline feature controls should be icon-only.')
  assert(
    timelineMarkup.includes('aria-label="Timeline cursor') && timelineMarkup.includes(TIMELINE_CURSOR_GLYPH),
    'Timeline should render a draggable cursor handle with the requested glyph.',
  )
  assert(timelineMarkup.includes('aria-haspopup="menu"'), 'Timeline history items should expose custom context menu affordances.')
  assert(!timelineMarkup.includes('Hide Fillet 1') && !timelineMarkup.includes('Show Fillet 1'), 'Timeline should not render per-feature hide controls.')
  assert(
    getNearestTimelineAnchorIndex([100, 160, 220, 280], 208) === 1,
    'Timeline cursor dragging should snap to the nearest earlier valid anchor when dragged near it.',
  )
  assert(
    getNearestTimelineAnchorIndex([100, 160, 220, 280], 266) === 2,
    'Timeline cursor dragging should snap to the nearest later valid anchor when dragged near it.',
  )

  const sketchCursorSnapshot = {
    ...snapshot,
    document: {
      ...snapshot.document,
      cursor: { kind: 'sketch' as const, sketchId: 'sketch_primary' as const },
    },
    cursor: { kind: 'sketch' as const, sketchId: 'sketch_primary' as const },
  }
  const sketchCursorMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureTimelineBar
          snapshot={sketchCursorSnapshot}
          visibleSelection={[{ kind: 'sketch', sketchId: 'sketch_primary' }]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onCursorRequested={() => undefined}
          onDeleteFeature={() => undefined}
          onRenameItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(
    sketchCursorMarkup.includes('opacity-45'),
    'Timeline should mark feature items after a sketch cursor as after the current cursor.',
  )

  const sketchSession = createSketchSessionFromSnapshot(snapshot.document.sketches[0]!)
  const sketchHistoryMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <HistoryTimelineShell
          snapshot={snapshot}
          sketchSession={sketchSession}
          visibleSelection={[]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onDocumentCursorRequested={() => undefined}
          onSketchCursorRequested={() => undefined}
          onDeleteFeature={() => undefined}
          onRenameDocumentItem={() => undefined}
          onSuppressFeature={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(sketchHistoryMarkup.includes('data-history-mode="sketch"'), 'History shell should switch to sketch mode during sketch edit sessions.')
  assert(sketchHistoryMarkup.includes('aria-label="Sketch history"'), 'Sketch edit sessions should render sketch-local history.')
  assert(sketchHistoryMarkup.includes('aria-haspopup="menu"'), 'Sketch history items should expose custom context menu affordances.')
  assert(
    sketchHistoryMarkup.includes('data-transition-state="leaving-down"'),
    'Document history should expose a reduced-motion-friendly leaving state while sketch history is active.',
  )
})
