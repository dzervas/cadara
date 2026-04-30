import { test } from 'bun:test'

import type { ShortcutCommandDefinition } from '@/core/shortcuts/commands'
import { createShortcutCommandRegistry } from '@/core/shortcuts/commands'
import {
  disableCommandShortcut,
  resetCommandShortcut,
  setCommandShortcutOverride,
} from '@/core/shortcuts/profile-repository'
import { validateShortcutOverrideUpdate } from '@/hooks/shortcut-validation'

test('src/hooks/shortcut-provider.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const commands = [
    {
      id: 'editor.undo',
      label: 'Undo',
      category: 'History',
      scope: 'global',
      defaultShortcuts: ['mod+z'],
      customizable: true,
    },
    {
      id: 'editor.redo',
      label: 'Redo',
      category: 'History',
      scope: 'global',
      defaultShortcuts: ['mod+shift+z', 'mod+y'],
      customizable: true,
    },
  ] as const satisfies readonly ShortcutCommandDefinition[]
  const registry = createShortcutCommandRegistry(commands)
  const disabledUndo = disableCommandShortcut({}, 'editor.undo')
  const redoOnUndo = setCommandShortcutOverride(disabledUndo, 'editor.redo', ['mod+z'])

  const remapResult = validateShortcutOverrideUpdate(registry, redoOnUndo)
  assert(remapResult.nextOverrides === redoOnUndo, 'Redo can reuse Undo shortcut while Undo remains disabled.')
  assert(remapResult.conflicts.length === 0, 'Disabled Undo should not conflict with remapped Redo.')

  const resetResult = validateShortcutOverrideUpdate(registry, resetCommandShortcut(redoOnUndo, 'editor.undo'))
  assert(resetResult.nextOverrides === null, 'Resetting Undo should be rejected when it restores a conflict.')
  assert(
    resetResult.conflicts.some(
      (conflict) =>
        conflict.kind === 'duplicate'
        && conflict.commandIds.includes('editor.undo')
        && conflict.commandIds.includes('editor.redo'),
    ),
    'Reset validation should report the Undo/Redo duplicate shortcut conflict.',
  )
})
