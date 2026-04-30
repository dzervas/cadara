import type { ShortcutCommandRegistry } from '@/core/shortcuts/commands'
import {
  createEffectiveKeymap,
  detectShortcutConflicts,
  type ShortcutConflict,
  type ShortcutProfileOverrides,
} from '@/core/shortcuts/keymap'

export interface ShortcutOverrideUpdateValidation {
  conflicts: readonly ShortcutConflict[]
  nextOverrides: ShortcutProfileOverrides | null
}

export function validateShortcutOverrideUpdate(
  registry: ShortcutCommandRegistry,
  nextOverrides: ShortcutProfileOverrides,
): ShortcutOverrideUpdateValidation {
  const conflicts = detectShortcutConflicts(registry, createEffectiveKeymap(registry, nextOverrides))

  return {
    conflicts,
    nextOverrides: conflicts.length === 0 ? nextOverrides : null,
  }
}
