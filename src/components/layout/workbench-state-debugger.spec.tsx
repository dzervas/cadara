import { test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  WorkbenchStateDebugger,
  type WorkbenchStateDebuggerModel,
} from '@/components/layout/workbench-state-debugger'

test('src/components/layout/workbench-state-debugger.spec.tsx', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function createDebuggerModel(): WorkbenchStateDebuggerModel {
    return {
      activeMode: 'part',
      machineState: 'editingFeature',
      command: 'extrude',
      phase: 'editing',
      selectionCount: 2,
      selectionTargets: 'sketch_1.region_profile, body_1',
      revision: 'rev_12',
      snapshotDiagnosticsCount: 1,
      sketchSession: '4 entities staged',
      sketchPlane: 'XY',
      featureSession: 'create:extrude:dirty',
      previewState: 'Draft extrude profile',
      selectionFilterLabel: 'Extrude profiles, planar faces, or boolean bodies',
      activeTargetRule: 'Join, cut, and intersect require one explicit target body.',
      hoverTarget: 'none',
      requirements: [
        {
          id: 'extrude-profile',
          label: 'Extrude seed',
          description: 'Extrude accepts one explicit derived sketch region or one planar face.',
          slotCount: 1,
        },
        {
          id: 'extrude-boolean-target',
          label: 'Boolean target',
          description: 'Join, cut, and intersect require one explicit target body.',
          slotCount: 2,
        },
      ],
      selectionDetail: {
        label: 'Profile region',
        kindLabel: 'Region',
        ownerLabel: 'Sketch 1',
        relatedLabels: ['Extrude 1'],
        targetLabel: 'sketch_1.region_profile',
      },
    }
  }

  const expandedMarkup = renderToStaticMarkup(<WorkbenchStateDebugger state={createDebuggerModel()} />)
  assert(expandedMarkup.includes('State Debugger'), 'Debugger should render its title.')
  assert(expandedMarkup.includes('Active mode'), 'Expanded debugger should render active mode.')
  assert(expandedMarkup.includes('editingFeature'), 'Expanded debugger should render machine state.')
  assert(expandedMarkup.includes('Draft extrude profile'), 'Expanded debugger should render preview state.')
  assert(
    expandedMarkup.includes('Extrude profiles, planar faces, or boolean bodies'),
    'Expanded debugger should render selection filter label.',
  )
  assert(expandedMarkup.includes('sketch_1.region_profile, body_1'), 'Expanded debugger should render selected targets.')
  assert(
    expandedMarkup.includes('Join, cut, and intersect require one explicit target body.'),
    'Expanded debugger should render selection requirement descriptions.',
  )
  assert(expandedMarkup.includes('(2 slots)'), 'Expanded debugger should render selection requirement slot counts.')
  assert(expandedMarkup.includes('Profile region'), 'Expanded debugger should render selection detail.')

  const collapsedMarkup = renderToStaticMarkup(
    <WorkbenchStateDebugger state={createDebuggerModel()} defaultExpanded={false} />,
  )
  assert(collapsedMarkup.includes('aria-expanded="false"'), 'Collapsed debugger should expose collapsed state.')
  assert(collapsedMarkup.includes('State Debugger'), 'Collapsed debugger should retain an expand affordance.')
  assert(!collapsedMarkup.includes('Active mode'), 'Collapsed debugger should hide detailed rows.')
  assert(!collapsedMarkup.includes('Boolean target'), 'Collapsed debugger should hide requirement rows.')
})
