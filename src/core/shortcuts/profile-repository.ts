import type {
  ShortcutCommandId,
  ShortcutCommandRegistry,
} from '@/core/shortcuts/commands'
import type { ShortcutProfileOverrides } from '@/core/shortcuts/keymap'

export interface ShortcutProfileRepository {
  load(): Promise<ShortcutProfileOverrides>
  save(overrides: ShortcutProfileOverrides): Promise<void>
}

export interface ShortcutStorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export const shortcutProfileStorageKey = 'cadara.shortcutProfile.v1'

export function createLocalShortcutProfileRepository(
  storage: ShortcutStorageLike,
  key = shortcutProfileStorageKey,
): ShortcutProfileRepository {
  return {
    async load() {
      const raw = storage.getItem(key)
      if (!raw) {
        return {}
      }

      return parseShortcutProfileOverrides(raw)
    },
    async save(overrides) {
      if (Object.keys(overrides).length === 0) {
        storage.removeItem(key)
        return
      }

      storage.setItem(key, JSON.stringify(overrides))
    },
  }
}

export function createMemoryShortcutProfileRepository(
  initialOverrides: ShortcutProfileOverrides = {},
): ShortcutProfileRepository {
  let current = initialOverrides

  return {
    async load() {
      return current
    },
    async save(overrides) {
      current = overrides
    },
  }
}

export function setCommandShortcutOverride(
  overrides: ShortcutProfileOverrides,
  commandId: ShortcutCommandId,
  shortcuts: readonly string[],
): ShortcutProfileOverrides {
  return {
    ...overrides,
    [commandId]: { shortcuts },
  }
}

export function disableCommandShortcut(
  overrides: ShortcutProfileOverrides,
  commandId: ShortcutCommandId,
) {
  return setCommandShortcutOverride(overrides, commandId, [])
}

export function resetCommandShortcut(
  overrides: ShortcutProfileOverrides,
  commandId: ShortcutCommandId,
): ShortcutProfileOverrides {
  const next = { ...overrides }
  delete next[commandId]
  return next
}

export function resetAllShortcutOverrides(): ShortcutProfileOverrides {
  return {}
}

export function pruneUnknownShortcutOverrides(
  overrides: ShortcutProfileOverrides,
  registry: ShortcutCommandRegistry,
) {
  const next: ShortcutProfileOverrides = {}

  for (const [commandId, override] of Object.entries(overrides) as Array<[ShortcutCommandId, { shortcuts: readonly string[] }]>) {
    if (registry.has(commandId)) {
      next[commandId] = override
    }
  }

  return next
}

function parseShortcutProfileOverrides(raw: string): ShortcutProfileOverrides {
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {}
    }

    const overrides: ShortcutProfileOverrides = {}
    for (const [commandId, override] of Object.entries(value)) {
      if (!override || typeof override !== 'object' || Array.isArray(override)) {
        continue
      }

      const shortcuts = (override as { shortcuts?: unknown }).shortcuts
      if (!Array.isArray(shortcuts) || !shortcuts.every((shortcut) => typeof shortcut === 'string')) {
        continue
      }

      overrides[commandId as ShortcutCommandId] = { shortcuts }
    }

    return overrides
  } catch {
    return {}
  }
}
