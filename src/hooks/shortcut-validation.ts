import type { ShortcutCommandRegistry } from '@/domain/shortcuts/commands'
import {
  createEffectiveKeymap,
  detectShortcutConflicts,
  type ShortcutConflict,
  type ShortcutProfileOverrides,
} from '@/domain/shortcuts/keymap'

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
