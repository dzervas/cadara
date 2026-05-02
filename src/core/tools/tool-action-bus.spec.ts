import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import { createToolActionBus } from '@/core/tools/tool-action-bus'

test('src/core/tools/tool-action-bus.spec.ts', () => {
  const actionBus = createToolActionBus()
  let observedSource: string | null = null
  const unsubscribe = actionBus.subscribeToTool('line', (event) => {
    observedSource = event.source
  })

  actionBus.triggerTool('line', 'sketch', { source: 'shortcut' })
  unsubscribe()

  expectTrue(observedSource === 'shortcut', 'Tool action events should preserve shortcut source metadata.')
})
