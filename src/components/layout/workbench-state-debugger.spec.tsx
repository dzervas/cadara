import { test } from 'bun:test'
import { expectTrue } from '@/testing/expect.spec'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  WorkbenchStateDebugger,
  type WorkbenchStateDebuggerModel,
} from '@/components/layout/workbench-state-debugger'

test('src/components/layout/workbench-state-debugger.spec.tsx', async () => {  function createDebuggerModel(): WorkbenchStateDebuggerModel {
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
      selectableTargets: ['sketch_1.region_profile', 'body_1'],
      featureIds: ['feature_extrude-1'],
      previewDiagnostics: 'No diagnostics reported for the current preview.',
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
      topologyDebug: {
        bodyCount: 1,
        liveTopologyReferences: 26,
        invalidatedTopologyReferences: 2,
        bodies: [
          {
            bodyId: 'body_1',
            label: 'Body 1',
            faces: 6,
            edges: 12,
            vertices: 8,
            liveReferences: 26,
            invalidatedReferences: 2,
          },
        ],
        invalidations: [
          {
            reason: 'occ-topology-ambiguous',
            count: 2,
            examples: ['body_1.face_old', 'body_1.edge_old'],
          },
        ],
      },
    }
  }

  const expandedMarkup = renderToStaticMarkup(
    <WorkbenchStateDebugger state={createDebuggerModel()} defaultExpanded />,
  )
  expectTrue(expandedMarkup.includes('State Debugger'), 'Debugger should render its title.')
  expectTrue(expandedMarkup.includes('Active mode'), 'Expanded debugger should render active mode.')
  expectTrue(expandedMarkup.includes('editingFeature'), 'Expanded debugger should render machine state.')
  expectTrue(expandedMarkup.includes('Draft extrude profile'), 'Expanded debugger should render preview state.')
  expectTrue(
    expandedMarkup.includes('Extrude profiles, planar faces, or boolean bodies'),
    'Expanded debugger should render selection filter label.',
  )
  expectTrue(expandedMarkup.includes('sketch_1.region_profile, body_1'), 'Expanded debugger should render selected targets.')
  expectTrue(
    expandedMarkup.includes('Join, cut, and intersect require one explicit target body.'),
    'Expanded debugger should render selection requirement descriptions.',
  )
  expectTrue(expandedMarkup.includes('(2 slots)'), 'Expanded debugger should render selection requirement slot counts.')
  expectTrue(expandedMarkup.includes('Profile region'), 'Expanded debugger should render selection detail.')
  expectTrue(expandedMarkup.includes('Topology naming'), 'Expanded debugger should include the hidden topology debug section.')
  expectTrue(expandedMarkup.includes('occ-topology-ambiguous'), 'Topology debug section should render invalidation reasons.')

  const collapsedMarkup = renderToStaticMarkup(<WorkbenchStateDebugger state={createDebuggerModel()} />)
  expectTrue(collapsedMarkup.includes('aria-expanded="false"'), 'Collapsed debugger should expose collapsed state.')
  expectTrue(collapsedMarkup.includes('State Debugger'), 'Collapsed debugger should retain an expand affordance.')
  expectTrue(!collapsedMarkup.includes('Active mode'), 'Collapsed debugger should hide detailed rows.')
  expectTrue(!collapsedMarkup.includes('Boolean target'), 'Collapsed debugger should hide requirement rows.')
  expectTrue(!collapsedMarkup.includes('Topology naming'), 'Collapsed debugger should hide topology debug rows.')
})
