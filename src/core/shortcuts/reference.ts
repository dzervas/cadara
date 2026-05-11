import type {
  ShortcutCommandDefinition,
  ShortcutCommandRegistry,
} from "@/core/shortcuts/commands";
import {
  getPrimaryShortcut,
  type EffectiveShortcutMap,
} from "@/core/shortcuts/keymap";
import { formatShortcut } from "@/core/shortcuts/shortcut-grammar";

export interface ShortcutReferenceCommand {
  command: ShortcutCommandDefinition;
  shortcutLabel: string | null;
}

export interface ShortcutReferenceGroup {
  category: ShortcutCommandDefinition["category"];
  commands: readonly ShortcutReferenceCommand[];
}

export function createShortcutReferenceGroups(
  registry: ShortcutCommandRegistry,
  keymap: EffectiveShortcutMap,
  options: { platform?: "mac" | "windows" | "linux" } = {},
) {
  const groups = new Map<
    ShortcutCommandDefinition["category"],
    ShortcutReferenceCommand[]
  >();

  for (const command of registry.values()) {
    if (!command.customizable && command.defaultShortcuts.length === 0) {
      continue;
    }

    const primaryShortcut = getPrimaryShortcut(keymap, command.id);
    const commands = groups.get(command.category) ?? [];
    commands.push({
      command,
      shortcutLabel: primaryShortcut
        ? formatShortcut(primaryShortcut, options)
        : null,
    });
    groups.set(command.category, commands);
  }

  return [...groups.entries()]
    .map(([category, commands]) => ({
      category,
      commands: commands.sort((left, right) =>
        left.command.label.localeCompare(right.command.label),
      ),
    }))
    .sort((left, right) => left.category.localeCompare(right.category));
}
