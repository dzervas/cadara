import { test } from 'bun:test'
import { MantineProvider } from '@mantine/core'
import { renderToStaticMarkup } from 'react-dom/server'

import { ShortcutHint } from '@/components/shortcuts/shortcut-hint'
import { getRecordedShortcutStep } from '@/components/shortcuts/shortcut-recording'
import { ShortcutSettings } from '@/components/shortcuts/shortcut-settings'
import { createShortcutCommandRegistry } from '@/domain/shortcuts/commands'
import type { ShortcutCommandDefinition } from '@/domain/shortcuts/commands'
import { createEffectiveKeymap } from '@/domain/shortcuts/keymap'
import { ShortcutContext } from '@/hooks/shortcut-context'
import { workbenchTheme } from '@/theme/workbench-theme'

test('src/components/shortcuts/shortcut-hint.spec.tsx', () => {
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
      defaultShortcuts: ['g>f'],
      customizable: true,
    },
    {
      id: 'editor.cancel',
      label: 'Cancel',
      category: 'Editor',
      scope: 'global',
      defaultShortcuts: [],
      customizable: true,
    },
  ] as const satisfies readonly ShortcutCommandDefinition[]
  const registry = createShortcutCommandRegistry(commands)
  const effectiveKeymap = createEffectiveKeymap(registry, {
    'editor.cancel': { shortcuts: [] },
  })
  const context = {
    activeScopes: ['global' as const],
    commands,
    effectiveKeymap,
    getPrimaryShortcut: (commandId: ShortcutCommandDefinition['id']) => effectiveKeymap.get(commandId)?.[0] ?? null,
    registry,
    overrides: {},
    setCommandShortcuts: () => [],
    disableCommandShortcuts: () => undefined,
    resetCommandShortcuts: () => [],
    resetAllShortcuts: () => undefined,
    getConflictsForOverrides: () => [],
  }

  const assignedMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ShortcutContext.Provider value={context}>
        <ShortcutHint commandId="editor.undo" />
      </ShortcutContext.Provider>
    </MantineProvider>,
  )
  assert(assignedMarkup.includes('Ctrl+Z'), 'Shortcut hints should render assigned shortcut labels.')

  const sequenceMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ShortcutContext.Provider value={context}>
        <ShortcutHint commandId="editor.redo" />
      </ShortcutContext.Provider>
    </MantineProvider>,
  )
  assert(sequenceMarkup.includes('G &gt; F'), 'Shortcut hints should render sequence shortcut labels.')

  const unassignedMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ShortcutContext.Provider value={context}>
        <ShortcutHint commandId="editor.cancel" />
      </ShortcutContext.Provider>
    </MantineProvider>,
  )
  assert(!unassignedMarkup.includes('data-shortcut-hint'), 'Unassigned shortcut hints should render nothing.')

  const settingsMarkup = renderToStaticMarkup(
    <MantineProvider theme={workbenchTheme} defaultColorScheme="dark">
      <ShortcutContext.Provider value={context}>
        <ShortcutSettings />
      </ShortcutContext.Provider>
    </MantineProvider>,
  )
  assert(settingsMarkup.includes('History'), 'Shortcut settings should group commands by registry category.')
  assert(settingsMarkup.includes('Unassigned'), 'Shortcut settings should show disabled shortcuts as unassigned.')
  assert(
    getRecordedShortcutStep({ key: 'Control', ctrlKey: true }) === null,
    'Shortcut recording should ignore modifier-only keydown events.',
  )
  assert(
    getRecordedShortcutStep({ key: 'Z', ctrlKey: true }) === 'mod+z',
    'Shortcut recording should still capture modified non-modifier keys.',
  )
  assert(
    getRecordedShortcutStep({ key: '+' }) === null,
    'Shortcut recording should ignore the plus separator key.',
  )
  assert(
    getRecordedShortcutStep({ key: '>' }) === null,
    'Shortcut recording should ignore the sequence separator key.',
  )
})
