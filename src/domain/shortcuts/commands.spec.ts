import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
  getToolCommandId,
} from '@/core/shortcuts/commands'

test('src/domain/shortcuts/commands.spec.ts', () => {  const registry = createShortcutCommandRegistry()

  expectTrue(
    registry.get(getToolCommandId('line'))?.label === 'Line',
    'Tool commands should derive labels from tool definitions.',
  )
  expectTrue(
    registry.get(getToolCommandId('line'))?.scope === 'sketch',
    'Tool commands should derive sketch scope from tool modes.',
  )
  expectTrue(
    registry.get('editor.cancel')?.defaultShortcuts.includes('escape'),
    'Non-tool editor commands should be declared independently from tools.',
  )
  expectTrue(
    getShortcutCommandDefinitions().some((command) => command.id === 'context.rename'),
    'Context menu actions should be addressable as commands for shortcut reference coverage.',
  )
})
