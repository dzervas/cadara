import { createContext } from 'react'

import type {
  ShortcutCommandDefinition,
  ShortcutCommandId,
  ShortcutCommandRegistry,
  ShortcutScope,
} from '@/core/shortcuts/commands'
import type {
  EffectiveShortcutMap,
  ShortcutConflict,
  ShortcutProfileOverrides,
} from '@/core/shortcuts/keymap'
import type { ShortcutSequence } from '@/core/shortcuts/shortcut-grammar'

export interface ShortcutContextValue {
  activeScopes: readonly ShortcutScope[]
  commands: readonly ShortcutCommandDefinition[]
  effectiveKeymap: EffectiveShortcutMap
  getPrimaryShortcut: (commandId: ShortcutCommandId) => ShortcutSequence | null
  registry: ShortcutCommandRegistry
  overrides: ShortcutProfileOverrides
  setCommandShortcuts: (commandId: ShortcutCommandId, shortcuts: readonly string[]) => readonly ShortcutConflict[]
  disableCommandShortcuts: (commandId: ShortcutCommandId) => void
  resetCommandShortcuts: (commandId: ShortcutCommandId) => readonly ShortcutConflict[]
  resetAllShortcuts: () => void
  getConflictsForOverrides: (overrides: ShortcutProfileOverrides) => readonly ShortcutConflict[]
}

export const ShortcutContext = createContext<ShortcutContextValue | null>(null)
