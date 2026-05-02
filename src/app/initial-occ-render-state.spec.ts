import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { isInitialOccRenderPending } from '@/app/workbench/initial-occ-render-state'

test('src/app/initial-occ-render-state.spec.ts', () => {  expectTrue(
    isInitialOccRenderPending({ snapshot: null }) === true,
    'The viewport should show initial OCC render progress before the first workspace snapshot.',
  )
  expectTrue(
    isInitialOccRenderPending({ snapshot: { revisionId: 'rev_0001' } }) === false,
    'The viewport loading state should clear after the first workspace snapshot is ready.',
  )
})
