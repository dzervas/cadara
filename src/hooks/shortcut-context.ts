import { createContext } from 'react'

import type {
  ShortcutCommandDefinition,
  ShortcutCommandId,
  ShortcutCommandRegistry,
  ShortcutScope,
} from '@/domain/shortcuts/commands'
import type {
  EffectiveShortcutMap,
  ShortcutConflict,
  ShortcutProfileOverrides,
} from '@/domain/shortcuts/keymap'
import type { ShortcutSequence } from '@/domain/shortcuts/shortcut-grammar'

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
