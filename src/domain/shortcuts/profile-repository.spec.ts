import { test } from 'bun:test'

import {
  createLocalShortcutProfileRepository,
  disableCommandShortcut,
  resetAllShortcutOverrides,
  resetCommandShortcut,
  setCommandShortcutOverride,
  type ShortcutStorageLike,
} from '@/core/shortcuts/profile-repository'

test('src/domain/shortcuts/profile-repository.spec.ts', async () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const values = new Map<string, string>()
  const storage: ShortcutStorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key)
    },
  }
  const repository = createLocalShortcutProfileRepository(storage, 'test-shortcuts')

  assert(
    Object.keys(await repository.load()).length === 0,
    'Profile repository should load empty overrides by default.',
  )

  const remapped = setCommandShortcutOverride({}, 'editor.undo', ['u'])
  await repository.save(remapped)
  assert(
    (await repository.load())['editor.undo']?.shortcuts[0] === 'u',
    'Profile repository should persist shortcut overrides.',
  )

  const disabled = disableCommandShortcut(remapped, 'editor.undo')
  await repository.save(disabled)
  assert(
    (await repository.load())['editor.undo']?.shortcuts.length === 0,
    'Profile repository should preserve empty shortcut lists as disabled overrides.',
  )

  await repository.save(resetCommandShortcut(disabled, 'editor.undo'))
  assert(
    Object.keys(await repository.load()).length === 0,
    'Resetting a command should remove its override so defaults apply.',
  )

  await repository.save(resetAllShortcutOverrides())
  assert(values.size === 0, 'Reset all should clear stored shortcut overrides.')
})
