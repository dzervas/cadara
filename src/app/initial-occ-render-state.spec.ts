import { test } from 'bun:test'

import { isInitialOccRenderPending } from '@/app/workbench/initial-occ-render-state'

test('src/app/initial-occ-render-state.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  assert(
    isInitialOccRenderPending({ snapshot: null }) === true,
    'The viewport should show initial OCC render progress before the first workspace snapshot.',
  )
  assert(
    isInitialOccRenderPending({ snapshot: { revisionId: 'rev_0001' } }) === false,
    'The viewport loading state should clear after the first workspace snapshot is ready.',
  )
})
