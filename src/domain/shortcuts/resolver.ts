import type {
  ShortcutCommandDefinition,
  ShortcutCommandId,
  ShortcutCommandRegistry,
  ShortcutScope,
} from '@/domain/shortcuts/commands'
import {
  collectShortcutBindings,
  getScopePriority,
  isCommandInActiveScopes,
  type EffectiveShortcutMap,
  type ShortcutBinding,
} from '@/domain/shortcuts/keymap'
import {
  serializeShortcut,
  shortcutFromKeyboardEvent,
  shortcutStartsWith,
  shortcutsEqual,
  type KeyboardShortcutEvent,
  type ShortcutSequence,
} from '@/domain/shortcuts/shortcut-grammar'

export interface ShortcutResolverEvent extends KeyboardShortcutEvent {
  target?: EventTarget | null
  defaultPrevented?: boolean
  preventDefault?: () => void
}

export interface ShortcutResolverOptions {
  activeScopes: readonly ShortcutScope[]
  executeCommand: (command: ShortcutCommandDefinition) => void
  isCommandEnabled?: (command: ShortcutCommandDefinition) => boolean
  isTextEditingTarget?: (target: EventTarget | null | undefined) => boolean
  platform?: 'mac' | 'windows' | 'linux'
}

export interface ShortcutResolverResult {
  handled: boolean
  commandId: ShortcutCommandId | null
  pendingSequence: boolean
}

export class ShortcutResolver {
  private pendingSequence: ShortcutSequence | null = null
  private readonly registry: ShortcutCommandRegistry
  private readonly keymap: EffectiveShortcutMap

  constructor(
    registry: ShortcutCommandRegistry,
    keymap: EffectiveShortcutMap,
  ) {
    this.registry = registry
    this.keymap = keymap
  }

  handleKeyDown(
    event: ShortcutResolverEvent,
    options: ShortcutResolverOptions,
  ): ShortcutResolverResult {
    if (event.defaultPrevented) {
      this.clearSequence()
      return { handled: false, commandId: null, pendingSequence: false }
    }

    const chord = shortcutFromKeyboardEvent(event, { platform: options.platform })
    const candidate = this.pendingSequence
      ? { chords: [...this.pendingSequence.chords, ...chord.chords] }
      : chord
    const result = this.resolveCandidate(candidate, event, options)

    if (result.handled || result.pendingSequence) {
      event.preventDefault?.()
    }

    return result
  }

  clearSequence() {
    this.pendingSequence = null
  }

  private resolveCandidate(
    candidate: ShortcutSequence,
    event: ShortcutResolverEvent,
    options: ShortcutResolverOptions,
  ): ShortcutResolverResult {
    const matches = this.getMatchingBindings(candidate, options)
    const prefixes = this.getPrefixBindings(candidate, options)
      .filter((binding) => this.canUseBinding(binding, event, options))

    if (matches.length > 0 && prefixes.length === 0) {
      const binding = matches[0]!
      const command = this.registry.get(binding.commandId)

      this.clearSequence()

      if (!command || !this.canExecuteCommand(command, event, options)) {
        return { handled: false, commandId: null, pendingSequence: false }
      }

      options.executeCommand(command)
      return { handled: true, commandId: command.id, pendingSequence: false }
    }

    if (prefixes.length > 0) {
      this.pendingSequence = candidate
      return { handled: true, commandId: null, pendingSequence: true }
    }

    if (candidate.chords.length > 1) {
      this.clearSequence()
      return this.resolveCandidate(
        { chords: [candidate.chords[candidate.chords.length - 1]!] },
        event,
        options,
      )
    }

    this.clearSequence()
    return { handled: false, commandId: null, pendingSequence: false }
  }

  private getMatchingBindings(
    candidate: ShortcutSequence,
    options: Pick<ShortcutResolverOptions, 'activeScopes'>,
  ) {
    return this.getActiveBindings(options)
      .filter((binding) => shortcutsEqual(binding.shortcut, candidate))
      .sort((left, right) => getScopePriority(right.scope) - getScopePriority(left.scope))
  }

  private getPrefixBindings(
    candidate: ShortcutSequence,
    options: Pick<ShortcutResolverOptions, 'activeScopes'>,
  ) {
    return this.getActiveBindings(options)
      .filter((binding) => shortcutStartsWith(binding.shortcut, candidate))
      .sort((left, right) => getScopePriority(right.scope) - getScopePriority(left.scope))
  }

  private getActiveBindings(
    options: Pick<ShortcutResolverOptions, 'activeScopes'>,
  ): ShortcutBinding[] {
    return collectShortcutBindings(this.registry, this.keymap).filter((binding) => {
      const command = this.registry.get(binding.commandId)
      return command ? isCommandInActiveScopes(command, options.activeScopes) : false
    })
  }

  private canExecuteCommand(
    command: ShortcutCommandDefinition,
    event: ShortcutResolverEvent,
    options: ShortcutResolverOptions,
  ) {
    if (!command.allowTextEditingTargets && options.isTextEditingTarget?.(event.target)) {
      return false
    }

    return options.isCommandEnabled?.(command) ?? true
  }

  private canUseBinding(
    binding: ShortcutBinding,
    event: ShortcutResolverEvent,
    options: ShortcutResolverOptions,
  ) {
    const command = this.registry.get(binding.commandId)
    return command ? this.canExecuteCommand(command, event, options) : false
  }
}

export function createShortcutResolver(
  registry: ShortcutCommandRegistry,
  keymap: EffectiveShortcutMap,
) {
  return new ShortcutResolver(registry, keymap)
}

export function getShortcutSequenceKey(shortcut: ShortcutSequence) {
  return serializeShortcut(shortcut)
}
