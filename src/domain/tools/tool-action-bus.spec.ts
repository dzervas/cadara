import { test } from 'bun:test'

import { createToolActionBus } from '@/domain/tools/tool-action-bus'

test('src/domain/tools/tool-action-bus.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const actionBus = createToolActionBus()
  let observedSource: string | null = null
  const unsubscribe = actionBus.subscribeToTool('line', (event) => {
    observedSource = event.source
  })

  actionBus.triggerTool('line', 'sketch', { source: 'shortcut' })
  unsubscribe()

  assert(observedSource === 'shortcut', 'Tool action events should preserve shortcut source metadata.')
})
