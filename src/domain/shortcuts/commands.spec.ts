import { test } from 'bun:test'

import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
  getToolCommandId,
} from '@/core/shortcuts/commands'

test('src/domain/shortcuts/commands.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const registry = createShortcutCommandRegistry()

  assert(
    registry.get(getToolCommandId('line'))?.label === 'Line',
    'Tool commands should derive labels from tool definitions.',
  )
  assert(
    registry.get(getToolCommandId('line'))?.scope === 'sketch',
    'Tool commands should derive sketch scope from tool modes.',
  )
  assert(
    registry.get('editor.cancel')?.defaultShortcuts.includes('escape'),
    'Non-tool editor commands should be declared independently from tools.',
  )
  assert(
    getShortcutCommandDefinitions().some((command) => command.id === 'context.rename'),
    'Context menu actions should be addressable as commands for shortcut reference coverage.',
  )
})
