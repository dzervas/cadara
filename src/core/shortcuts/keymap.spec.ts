import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { ShortcutCommandDefinition } from '@/core/shortcuts/commands'
import { createShortcutCommandRegistry } from '@/core/shortcuts/commands'
import {
  createEffectiveKeymap,
  detectShortcutConflicts,
  getPrimaryShortcut,
} from '@/core/shortcuts/keymap'
import { serializeShortcut } from '@/core/shortcuts/shortcut-grammar'

test('src/core/shortcuts/keymap.spec.ts', () => {
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
      defaultShortcuts: ['mod+shift+z'],
      customizable: true,
    },
    {
      id: 'editor.cancel',
      label: 'Cancel',
      category: 'Editor',
      scope: 'global',
      defaultShortcuts: ['escape'],
      customizable: true,
    },
  ] as const satisfies readonly ShortcutCommandDefinition[]
  const registry = createShortcutCommandRegistry(commands)
  const defaults = createEffectiveKeymap(registry)

  expectTrue(
    serializeShortcut(getPrimaryShortcut(defaults, 'editor.undo')!) === 'mod+z',
    'Effective keymaps should use default shortcuts without profile overrides.',
  )

  const remapped = createEffectiveKeymap(registry, {
    'editor.undo': { shortcuts: ['u'] },
    'editor.cancel': { shortcuts: [] },
  })
  expectTrue(
    serializeShortcut(getPrimaryShortcut(remapped, 'editor.undo')!) === 'u',
    'Profile overrides should replace default shortcuts.',
  )
  expectTrue(
    getPrimaryShortcut(remapped, 'editor.cancel') === null,
    'An empty profile shortcut list should disable a command shortcut.',
  )

  const duplicate = createEffectiveKeymap(registry, {
    'editor.redo': { shortcuts: ['mod+z'] },
  })
  expectTrue(
    detectShortcutConflicts(registry, duplicate).some((conflict) => conflict.kind === 'duplicate'),
    'Duplicate shortcuts in overlapping scopes should be reported.',
  )

  const prefix = createEffectiveKeymap(registry, {
    'editor.cancel': { shortcuts: ['g'] },
    'editor.redo': { shortcuts: ['g>f'] },
  })
  expectTrue(
    detectShortcutConflicts(registry, prefix).some((conflict) => conflict.kind === 'prefix'),
    'Same-scope prefix sequence ambiguity should be reported.',
  )
})
