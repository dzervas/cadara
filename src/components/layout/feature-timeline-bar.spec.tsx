import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { FeatureSidebar } from '@/components/layout/feature-sidebar'
import { FeatureTimelineBar } from '@/components/layout/feature-timeline-bar'
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
        existingSketchKeys: [],
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
          visibleSelection={[]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(!sidebarMarkup.includes('Feature Tree'), 'Sidebar should not render the feature tree section.')
  assert(sidebarMarkup.includes('Parts &amp; Objects'), 'Sidebar should keep the parts and objects section.')
  assert(sidebarMarkup.includes('Snapshot References'), 'Sidebar should keep snapshot references.')
  assert(sidebarMarkup.includes('Document Diagnostics'), 'Sidebar should keep document diagnostics.')
  assert(
    sidebarMarkup.includes('hover:bg-[var(--workbench-shell-accent-surface)]'),
    'Sidebar object rows should highlight across the full row container with the shared workbench accent surface.',
  )

  const hiddenObjectMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <EditorContext.Provider value={editorValue}>
        <FeatureSidebar
          snapshot={snapshot}
          hiddenTargetKeys={{ [getPrimitiveRefKey(snapshot.presentation.objects[0]!.target)]: true }}
          visibleSelection={[]}
          onSelectTarget={() => undefined}
          onReopenTarget={() => undefined}
          onToggleTargetVisibility={() => undefined}
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
        />
      </EditorContext.Provider>
    </MantineProvider>,
  )

  assert(timelineMarkup.includes('aria-label="Feature timeline"'), 'Timeline should expose a region label.')
  assert(timelineMarkup.includes('aria-label="Select Extrude 1. Double-click to reopen."'), 'Timeline should expose feature selection labels.')
  assert(timelineMarkup.includes('aria-current="step"'), 'Timeline should expose the current cursor position.')
  assert(!timelineMarkup.includes('>Extrude 1</button>'), 'Timeline feature controls should be icon-only.')
  assert(
    timelineMarkup.includes('aria-label="Timeline cursor') && timelineMarkup.includes(TIMELINE_CURSOR_GLYPH),
    'Timeline should render a draggable cursor handle with the requested glyph.',
  )
  assert(!timelineMarkup.includes('Hide Fillet 1') && !timelineMarkup.includes('Show Fillet 1'), 'Timeline should not render per-feature hide controls.')
  assert(
    getNearestTimelineAnchorIndex([100, 160, 220, 280], 208) === 1,
    'Timeline cursor dragging should snap to the nearest earlier valid anchor when dragged near it.',
  )
  assert(
    getNearestTimelineAnchorIndex([100, 160, 220, 280], 266) === 2,
    'Timeline cursor dragging should snap to the nearest later valid anchor when dragged near it.',
  )
})
