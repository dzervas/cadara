import { useContext } from "react";

import type { ShortcutCommandId } from "@/core/shortcuts/commands";
import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
} from "@/core/shortcuts/commands";
import {
  createEffectiveKeymap,
  getPrimaryShortcut,
} from "@/core/shortcuts/keymap";
import { ShortcutContext } from "@/hooks/shortcut-context";

const defaultCommands = getShortcutCommandDefinitions();
const defaultRegistry = createShortcutCommandRegistry(defaultCommands);
const defaultEffectiveKeymap = createEffectiveKeymap(defaultRegistry);

export function useShortcuts() {
  const context = useContext(ShortcutContext);

  if (context) {
    return context;
  }

  return {
    activeScopes: ["global"] as const,
    commands: defaultCommands,
    effectiveKeymap: defaultEffectiveKeymap,
    getPrimaryShortcut: (commandId: ShortcutCommandId) =>
      getPrimaryShortcut(defaultEffectiveKeymap, commandId),
    registry: defaultRegistry,
    overrides: {},
    setCommandShortcuts: () => [],
    disableCommandShortcuts: () => undefined,
    resetCommandShortcuts: () => [],
    resetAllShortcuts: () => undefined,
    getConflictsForOverrides: () => [],
  };
}

export function useShortcutDisplay(commandId: ShortcutCommandId) {
  return useShortcuts().getPrimaryShortcut(commandId);
}
