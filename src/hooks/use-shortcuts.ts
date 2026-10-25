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
import {
  DEFAULT_SELECTION_CLICK_MODE,
  type SelectionClickMode,
} from "@/core/editor/selection-click-mode";

const defaultCommands = getShortcutCommandDefinitions();
const defaultRegistry = createShortcutCommandRegistry(defaultCommands);
const defaultEffectiveKeymap = createEffectiveKeymap(defaultRegistry);

export function useShortcuts() {
  const context = useContext(ShortcutContext);

  if (context) {
    return context;
  }

  return {
    pointingDevice: "mouse" as const,
    setPointingDevice: (_scheme: "mouse" | "touchpad") => undefined,
    selectionClickMode: DEFAULT_SELECTION_CLICK_MODE,
    setSelectionClickMode: (_mode: SelectionClickMode) => undefined,
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
