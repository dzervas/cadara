import { getCurrentPlatform } from "@/infrastructure/shortcuts/platform";
import { useMemo, type KeyboardEvent } from "react";

import { createShortcutCommandRegistry } from "@/core/shortcuts/commands";
import { createShortcutResolver } from "@/core/shortcuts/resolver";
import { isTextEditingTarget } from "@/hooks/shortcut-targets";
import { useShortcuts } from "@/hooks/use-shortcuts";

/** Resolve the existing customizable command only while its row has focus. */
export function useRowRenameShortcut() {
  const { commands, effectiveKeymap } = useShortcuts();
  const resolver = useMemo(
    () =>
      createShortcutResolver(
        createShortcutCommandRegistry(
          commands.filter((command) => command.id === "context.rename"),
        ),
        effectiveKeymap,
      ),
    [commands, effectiveKeymap],
  );
  return (event: KeyboardEvent<HTMLElement>, onRename: () => void) => {
    resolver.handleKeyDown(event, {
      platform: getCurrentPlatform(),
      activeScopes: ["focused-panel"],
      executeCommand: onRename,
      isTextEditingTarget,
    });
  };
}
