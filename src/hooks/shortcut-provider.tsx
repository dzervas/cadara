import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from "react";

import type {
  ShortcutCommandDefinition,
  ShortcutCommandId,
  ShortcutCommandRegistry,
  ShortcutScope,
} from "@/core/shortcuts/commands";
import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
} from "@/core/shortcuts/commands";
import {
  createEffectiveKeymap,
  detectShortcutConflicts,
  getPrimaryShortcut,
  type ShortcutProfileOverrides,
} from "@/core/shortcuts/keymap";
import {
  createLocalShortcutProfileRepository,
  disableCommandShortcut,
  pruneUnknownShortcutOverrides,
  resetAllShortcutOverrides,
  resetCommandShortcut,
  setCommandShortcutOverride,
  type ShortcutProfileRepository,
} from "@/core/shortcuts/profile-repository";
import { createShortcutResolver } from "@/core/shortcuts/resolver";
import { ShortcutContext } from "@/hooks/shortcut-context";
import { isTextEditingTarget } from "@/hooks/shortcut-targets";
import { validateShortcutOverrideUpdate } from "@/hooks/shortcut-validation";

export interface ShortcutCommandHandler {
  execute: () => void;
  isEnabled?: () => boolean;
}

export type ShortcutCommandHandlers = Partial<
  Record<ShortcutCommandId, ShortcutCommandHandler>
>;

interface ShortcutProviderProps extends PropsWithChildren {
  activeScopes: readonly ShortcutScope[];
  commandHandlers?: ShortcutCommandHandlers;
  commands?: readonly ShortcutCommandDefinition[];
  repository?: ShortcutProfileRepository | null;
}

const defaultShortcutCommands = getShortcutCommandDefinitions();

export function ShortcutProvider({
  activeScopes,
  children,
  commandHandlers = {},
  commands = defaultShortcutCommands,
  repository,
}: ShortcutProviderProps) {
  const registry = useMemo(
    () => createShortcutCommandRegistry(commands),
    [commands],
  );
  const resolvedRepository = useMemo(
    () =>
      repository === undefined
        ? createDefaultShortcutProfileRepository()
        : repository,
    [repository],
  );
  const [overrides, setOverrides] = useState<ShortcutProfileOverrides>({});
  const effectiveKeymap = useMemo(
    () => createEffectiveKeymap(registry, overrides),
    [overrides, registry],
  );
  const resolver = useMemo(
    () => createShortcutResolver(registry, effectiveKeymap),
    [effectiveKeymap, registry],
  );

  useEffect(() => {
    let disposed = false;

    void resolvedRepository?.load().then((loadedOverrides) => {
      if (disposed) {
        return;
      }

      const nextOverrides = pruneUnknownShortcutOverrides(
        loadedOverrides,
        registry,
      );
      setOverrides((current) =>
        shortcutProfileOverridesEqual(current, nextOverrides)
          ? current
          : nextOverrides,
      );
    });

    return () => {
      disposed = true;
    };
  }, [registry, resolvedRepository]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      resolver.handleKeyDown(event, {
        activeScopes,
        executeCommand: (command) => commandHandlers[command.id]?.execute(),
        isCommandEnabled: (command) =>
          commandHandlers[command.id]?.isEnabled?.() ??
          Boolean(commandHandlers[command.id]),
        isTextEditingTarget,
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeScopes, commandHandlers, resolver]);

  const saveOverrides = useCallback(
    (nextOverrides: ShortcutProfileOverrides) => {
      setOverrides(nextOverrides);
      void resolvedRepository?.save(nextOverrides);
    },
    [resolvedRepository],
  );

  const getConflictsForOverrides = useCallback(
    (nextOverrides: ShortcutProfileOverrides) =>
      detectShortcutConflicts(
        registry,
        createEffectiveKeymap(registry, nextOverrides),
      ),
    [registry],
  );

  const value = useMemo(
    () => ({
      activeScopes,
      commands,
      effectiveKeymap,
      getPrimaryShortcut: (commandId: ShortcutCommandId) =>
        getPrimaryShortcut(effectiveKeymap, commandId),
      registry: registry as ShortcutCommandRegistry,
      overrides,
      setCommandShortcuts: (
        commandId: ShortcutCommandId,
        shortcuts: readonly string[],
      ) => {
        const nextOverrides = setCommandShortcutOverride(
          overrides,
          commandId,
          shortcuts,
        );
        const result = validateShortcutOverrideUpdate(registry, nextOverrides);
        if (result.nextOverrides) {
          saveOverrides(result.nextOverrides);
        }
        return result.conflicts;
      },
      disableCommandShortcuts: (commandId: ShortcutCommandId) => {
        saveOverrides(disableCommandShortcut(overrides, commandId));
      },
      resetCommandShortcuts: (commandId: ShortcutCommandId) => {
        const result = validateShortcutOverrideUpdate(
          registry,
          resetCommandShortcut(overrides, commandId),
        );
        if (result.nextOverrides) {
          saveOverrides(result.nextOverrides);
        }
        return result.conflicts;
      },
      resetAllShortcuts: () => {
        saveOverrides(resetAllShortcutOverrides());
      },
      getConflictsForOverrides,
    }),
    [
      activeScopes,
      commands,
      effectiveKeymap,
      getConflictsForOverrides,
      overrides,
      registry,
      saveOverrides,
    ],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
    </ShortcutContext.Provider>
  );
}

function createDefaultShortcutProfileRepository() {
  if (typeof window === "undefined") {
    return null;
  }

  return createLocalShortcutProfileRepository(window.localStorage);
}

function shortcutProfileOverridesEqual(
  left: ShortcutProfileOverrides,
  right: ShortcutProfileOverrides,
) {
  const leftEntries = Object.entries(left);
  const rightEntries = Object.entries(right);

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([commandId, leftOverride]) => {
    const rightOverride = right[commandId as ShortcutCommandId];
    if (
      !rightOverride ||
      leftOverride.shortcuts.length !== rightOverride.shortcuts.length
    ) {
      return false;
    }

    return leftOverride.shortcuts.every(
      (shortcut, index) => shortcut === rightOverride.shortcuts[index],
    );
  });
}
