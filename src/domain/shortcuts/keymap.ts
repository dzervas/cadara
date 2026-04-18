import type {
  ShortcutCommandDefinition,
  ShortcutCommandId,
  ShortcutCommandRegistry,
  ShortcutScope,
} from '@/domain/shortcuts/commands'
import {
  normalizeShortcut,
  parseShortcut,
  serializeShortcut,
  shortcutStartsWith,
  shortcutsEqual,
  type ShortcutSequence,
} from '@/domain/shortcuts/shortcut-grammar'

export interface ShortcutBinding {
  commandId: ShortcutCommandId
  scope: ShortcutScope
  shortcut: ShortcutSequence
  source: 'default' | 'profile'
}

export type EffectiveShortcutMap = ReadonlyMap<ShortcutCommandId, readonly ShortcutSequence[]>

export interface ShortcutProfileOverride {
  shortcuts: readonly string[]
}

export type ShortcutProfileOverrides = Partial<Record<ShortcutCommandId, ShortcutProfileOverride>>

export type ShortcutConflictKind = 'duplicate' | 'prefix'

export interface ShortcutConflict {
  kind: ShortcutConflictKind
  shortcut: string
  commandIds: readonly ShortcutCommandId[]
  scopes: readonly ShortcutScope[]
}

const scopePriority: Record<ShortcutScope, number> = {
  global: 0,
  part: 10,
  sketch: 10,
  'focused-panel': 20,
  'active-tool': 30,
  modal: 40,
}

export function createDefaultKeymap(
  registry: ShortcutCommandRegistry,
): EffectiveShortcutMap {
  return new Map(
    [...registry.values()].map((command) => [
      command.id,
      parseShortcutList(command.defaultShortcuts),
    ]),
  )
}

export function createEffectiveKeymap(
  registry: ShortcutCommandRegistry,
  overrides: ShortcutProfileOverrides = {},
): EffectiveShortcutMap {
  return new Map(
    [...registry.values()].map((command) => {
      const override = overrides[command.id]
      const shortcuts = override ? override.shortcuts : command.defaultShortcuts

      return [
        command.id,
        parseShortcutList(shortcuts),
      ]
    }),
  )
}

export function getPrimaryShortcut(
  keymap: EffectiveShortcutMap,
  commandId: ShortcutCommandId,
) {
  return keymap.get(commandId)?.[0] ?? null
}

export function collectShortcutBindings(
  registry: ShortcutCommandRegistry,
  keymap: EffectiveShortcutMap,
) {
  const bindings: ShortcutBinding[] = []

  for (const command of registry.values()) {
    const shortcuts = keymap.get(command.id) ?? []
    for (const shortcut of shortcuts) {
      bindings.push({
        commandId: command.id,
        scope: command.scope,
        shortcut,
        source: command.defaultShortcuts.some((defaultShortcut) => normalizeShortcut(defaultShortcut) === serializeShortcut(shortcut))
          ? 'default'
          : 'profile',
      })
    }
  }

  return bindings
}

export function detectShortcutConflicts(
  registry: ShortcutCommandRegistry,
  keymap: EffectiveShortcutMap,
) {
  const bindings = collectShortcutBindings(registry, keymap)
  const conflicts: ShortcutConflict[] = []

  for (let index = 0; index < bindings.length; index += 1) {
    const left = bindings[index]!

    for (let otherIndex = index + 1; otherIndex < bindings.length; otherIndex += 1) {
      const right = bindings[otherIndex]!

      if (!scopesOverlap(left.scope, right.scope)) {
        continue
      }

      if (shortcutsEqual(left.shortcut, right.shortcut)) {
        conflicts.push({
          kind: 'duplicate',
          shortcut: serializeShortcut(left.shortcut),
          commandIds: [left.commandId, right.commandId],
          scopes: [left.scope, right.scope],
        })
        continue
      }

      if (shortcutStartsWith(left.shortcut, right.shortcut) || shortcutStartsWith(right.shortcut, left.shortcut)) {
        conflicts.push({
          kind: 'prefix',
          shortcut: shortcutStartsWith(left.shortcut, right.shortcut)
            ? serializeShortcut(right.shortcut)
            : serializeShortcut(left.shortcut),
          commandIds: [left.commandId, right.commandId],
          scopes: [left.scope, right.scope],
        })
      }
    }
  }

  return conflicts
}

export function scopesOverlap(left: ShortcutScope, right: ShortcutScope) {
  return left === right || left === 'global' || right === 'global' || left === 'modal' || right === 'modal'
}

export function getScopePriority(scope: ShortcutScope) {
  return scopePriority[scope]
}

export function isCommandInActiveScopes(
  command: ShortcutCommandDefinition,
  activeScopes: readonly ShortcutScope[],
) {
  return command.scope === 'global' || activeScopes.includes(command.scope)
}

function parseShortcutList(shortcuts: readonly string[]) {
  return shortcuts.map(parseShortcut)
}
