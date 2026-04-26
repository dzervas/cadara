import { test } from 'bun:test'

import {
  getAutoHiddenSketchTargetKeys,
  getWorkbenchVisibilityState,
  reconcileVisibilityIntentKeys,
  toggleWorkbenchTargetVisibility,
} from '@/domain/editor/visibility'
import { getPrimitiveRefKey } from '@/domain/editor/schema'
import { MockKernelAdapter } from '@/domain/modeling/mock-kernel-adapter'

test('src/domain/editor/visibility.spec.ts', async () => {
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
  const sketchTarget = snapshot.presentation.objects.find(
    (item) => item.target.kind === 'sketch' && item.target.sketchId === 'sketch_primary',
  )?.target

  assert(sketchTarget?.kind === 'sketch', 'Visibility fixture should expose the consumed primary sketch row.')

  const sketchKey = getPrimitiveRefKey(sketchTarget)
  const autoHiddenSketchTargetKeys = getAutoHiddenSketchTargetKeys(snapshot)

  assert(
    autoHiddenSketchTargetKeys[sketchKey] === true,
    'Consumed sketch rows should derive auto-hidden state from snapshot consumption metadata.',
  )

  const initialVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
  })

  assert(
    initialVisibility.effectiveHiddenTargetKeys[sketchKey] === true,
    'Consumed sketch rows should start hidden when no explicit show override exists.',
  )

  const shownOverride = toggleWorkbenchTargetVisibility({
    target: sketchTarget,
    explicitHiddenTargetKeys: {},
    explicitlyShownAutoHiddenTargetKeys: {},
    effectiveHiddenTargetKeys: initialVisibility.effectiveHiddenTargetKeys,
    autoHiddenSketchTargetKeys: initialVisibility.autoHiddenSketchTargetKeys,
  })
  const shownVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: shownOverride.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys: shownOverride.explicitlyShownAutoHiddenTargetKeys,
  })

  assert(
    shownVisibility.effectiveHiddenTargetKeys[sketchKey] !== true,
    'Toggling an auto-hidden sketch should create a session-local show override.',
  )

  const hiddenAgain = toggleWorkbenchTargetVisibility({
    target: sketchTarget,
    explicitHiddenTargetKeys: shownOverride.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys: shownOverride.explicitlyShownAutoHiddenTargetKeys,
    effectiveHiddenTargetKeys: shownVisibility.effectiveHiddenTargetKeys,
    autoHiddenSketchTargetKeys: shownVisibility.autoHiddenSketchTargetKeys,
  })
  const hiddenAgainVisibility = getWorkbenchVisibilityState({
    snapshot,
    explicitHiddenTargetKeys: hiddenAgain.explicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys: hiddenAgain.explicitlyShownAutoHiddenTargetKeys,
  })

  assert(
    hiddenAgainVisibility.effectiveHiddenTargetKeys[sketchKey] === true,
    'Toggling a shown consumed sketch again should fall back to the derived auto-hidden state.',
  )

  const reconciled = reconcileVisibilityIntentKeys(
    {
      [sketchKey]: true,
      'sketch:stale': true,
    },
    new Set([sketchKey]),
  )

  assert(
    reconciled[sketchKey] === true && reconciled['sketch:stale'] !== true,
    'Visibility intent reconciliation should drop stale target keys after snapshot updates.',
  )
})
