import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import {
  formatShortcut,
  normalizeShortcut,
  parseShortcut,
  serializeShortcut,
  shortcutFromKeyboardEvent,
} from '@/core/shortcuts/shortcut-grammar'

test('src/core/shortcuts/shortcut-grammar.spec.ts', () => {
  const chord = parseShortcut('mod+shift+z')
  expectTrue(chord.chords.length === 1, 'Modifier shortcuts should parse as one chord.')
  expectTrue(
    serializeShortcut(chord) === 'mod+shift+z',
    'Shortcut parser should normalize modifier order and key casing.',
  )

  const sequence = parseShortcut('g>f')
  expectTrue(sequence.chords.length === 2, 'Sequences should parse as ordered chord lists.')
  expectTrue(serializeShortcut(sequence) === 'g>f', 'Sequences should preserve ordered keys.')
  expectTrue(normalizeShortcut('Esc') === 'escape', 'Aliases should normalize to event.key values.')
  expectTrue(normalizeShortcut('control+del') === 'ctrl+delete', 'Modifier and key aliases should normalize.')

  expectTrue(
    formatShortcut('mod+z', { platform: 'mac' }) === 'Cmd+Z',
    'Mac formatting should display a Command-style modifier label.',
  )
  expectTrue(
    formatShortcut('mod+z', { platform: 'windows' }) === 'Ctrl+Z',
    'Non-Mac formatting should display Ctrl for mod.',
  )
  expectTrue(
    formatShortcut('g>f', { platform: 'windows' }) === 'G > F',
    'Sequence formatting should preserve ordered sequence steps.',
  )

  expectTrue(
    serializeShortcut(shortcutFromKeyboardEvent({ key: 'Z', ctrlKey: true }, { platform: 'windows' })) === 'mod+z',
    'Keyboard events should normalize from logical event.key and platform modifiers.',
  )
})
