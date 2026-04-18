import { test } from 'bun:test'

import {
  formatShortcut,
  normalizeShortcut,
  parseShortcut,
  serializeShortcut,
  shortcutFromKeyboardEvent,
} from '@/domain/shortcuts/shortcut-grammar'

test('src/domain/shortcuts/shortcut-grammar.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  const chord = parseShortcut('mod+shift+z')
  assert(chord.chords.length === 1, 'Modifier shortcuts should parse as one chord.')
  assert(
    serializeShortcut(chord) === 'mod+shift+z',
    'Shortcut parser should normalize modifier order and key casing.',
  )

  const sequence = parseShortcut('g>f')
  assert(sequence.chords.length === 2, 'Sequences should parse as ordered chord lists.')
  assert(serializeShortcut(sequence) === 'g>f', 'Sequences should preserve ordered keys.')
  assert(normalizeShortcut('Esc') === 'escape', 'Aliases should normalize to event.key values.')
  assert(normalizeShortcut('control+del') === 'ctrl+delete', 'Modifier and key aliases should normalize.')

  assert(
    formatShortcut('mod+z', { platform: 'mac' }) === 'Cmd+Z',
    'Mac formatting should display a Command-style modifier label.',
  )
  assert(
    formatShortcut('mod+z', { platform: 'windows' }) === 'Ctrl+Z',
    'Non-Mac formatting should display Ctrl for mod.',
  )
  assert(
    formatShortcut('g>f', { platform: 'windows' }) === 'G > F',
    'Sequence formatting should preserve ordered sequence steps.',
  )

  assert(
    serializeShortcut(shortcutFromKeyboardEvent({ key: 'Z', ctrlKey: true }, { platform: 'windows' })) === 'mod+z',
    'Keyboard events should normalize from logical event.key and platform modifiers.',
  )
})
