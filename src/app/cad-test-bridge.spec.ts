import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  dispatchCadTestSelection,
  resolveCadTestTarget,
  syncCadTestState,
} from '@/app/workbench/cad-test-bridge'
import { defaultSelectionFilter } from '@/core/editor/schema'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { EditorEvent } from '@/domain/editor/state-machine'
import type { WorkbenchStateDebuggerModel } from '@/components/layout/workbench-state-debugger'

test('src/app/cad-test-bridge.spec.ts', () => {  const state: WorkbenchStateDebuggerModel = {
    activeMode: 'part',
    machineState: 'idle',
    command: 'none',
    phase: 'idle',
    selectionCount: 0,
    selectionTargets: 'Nothing selected',
    revision: 'rev_1',
    snapshotDiagnosticsCount: 0,
    sketchSession: 'none',
    sketchPlane: 'none',
    featureSession: 'none',
    previewState: 'No active preview',
    selectionFilterLabel: 'All selectable geometry',
    activeTargetRule: 'No active target rule',
    selectableTargets: ['body_feature_extrude-1'],
    featureIds: [],
    previewDiagnostics: '',
    requirements: [],
    selectionDetail: {
      label: 'none',
      kindLabel: 'none',
      ownerLabel: 'n/a',
      relatedLabels: [],
      targetLabel: 'none',
    },
    hoverTarget: 'none',
    topologyDebug: {
      bodyCount: 0,
      liveTopologyReferences: 0,
      invalidatedTopologyReferences: 0,
      bodies: [],
      invalidations: [],
    },
  }
  const targetWindow: { __cadTestState?: WorkbenchStateDebuggerModel } = {}
  syncCadTestState(state, targetWindow)
  expectTrue(targetWindow.__cadTestState?.revision === 'rev_1', 'State bridge should populate the window model.')

  const snapshot = {
    presentation: {
      entities: [{
        target: { kind: 'body', bodyId: 'body_feature_extrude-1' },
      }],
    },
  } as WorkspaceSnapshot
  const events: EditorEvent[] = []
  const selected = dispatchCadTestSelection({
    targetId: 'body_feature_extrude-1',
    snapshot,
    selection: [],
    selectionFilter: defaultSelectionFilter,
    selectionCatalog: {
      selectableTargetKeys: ['body:body_feature_extrude-1'],
      existingSketchKeys: [],
      constructionPlaneKeys: [],
      planarFaceKeys: [],
    },
    dispatch: (event) => events.push(event),
  })
  const nextState = {
    ...state,
    selectionCount: 1,
    selectionTargets: 'body_feature_extrude-1',
  }
  syncCadTestState(nextState, targetWindow)

  expectTrue(resolveCadTestTarget(snapshot, 'body_feature_extrude-1')?.kind === 'body', 'Bridge should resolve target labels.')
  expectTrue(selected === true, 'Programmatic selection bridge should accept selectable targets.')
  expectTrue(events[0]?.type === 'viewport.selectionRequested', 'Programmatic selection should dispatch through the editor event contract.')
  expectTrue(
    targetWindow.__cadTestState.selectionTargets.includes('body_feature_extrude-1'),
    'Programmatic selection should be reflected in the structured state bridge.',
  )
})
