import { test, expect } from "vitest";

import type { ShortcutCommandDefinition } from "@/core/shortcuts/commands";
import { createShortcutCommandRegistry } from "@/core/shortcuts/commands";
import { createEffectiveKeymap } from "@/core/shortcuts/keymap";
import { createShortcutResolver } from "@/core/shortcuts/resolver";

test("src/core/shortcuts/resolver.spec.ts", () => {
  const commands = [
    {
      id: "editor.undo",
      label: "Undo",
      category: "History",
      scope: "global",
      defaultShortcuts: ["u"],
      customizable: true,
    },
    {
      id: "editor.cancel",
      label: "Cancel",
      category: "Editor",
      scope: "sketch",
      defaultShortcuts: ["u"],
      customizable: true,
    },
    {
      id: "editor.redo",
      label: "Redo",
      category: "History",
      scope: "global",
      defaultShortcuts: ["g>f"],
      customizable: true,
    },
    {
      id: "editor.deleteSelection",
      label: "Delete",
      category: "Editor",
      scope: "global",
      defaultShortcuts: ["delete"],
      customizable: true,
    },
  ] as const satisfies readonly ShortcutCommandDefinition[];
  const registry = createShortcutCommandRegistry(commands);
  const keymap = createEffectiveKeymap(registry);
  const executed: string[] = [];
  const resolver = createShortcutResolver(registry, keymap);

  resolver.handleKeyDown(
    { key: "u" },
    {
      activeScopes: ["global", "sketch"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => true,
    },
  );
  expect(
    executed.at(-1),
    "Resolver should dispatch the higher-priority scoped command.",
  ).toBe("editor.cancel");

  resolver.handleKeyDown(
    { key: "Delete", target: { input: true } as unknown as EventTarget },
    {
      activeScopes: ["global"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => true,
      isTextEditingTarget: (target) => target !== undefined && target !== null,
    },
  );
  expect(
    executed.every((commandId) => commandId !== "editor.deleteSelection"),
    "Resolver should ignore guarded shortcuts from text-editing targets.",
  ).toBeTruthy();

  resolver.handleKeyDown(
    { key: "u" },
    {
      activeScopes: ["global"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => false,
    },
  );
  expect(
    executed.filter((commandId) => commandId === "editor.undo").length,
    "Resolver should not execute disabled commands.",
  ).toBe(0);

  resolver.handleKeyDown(
    { key: "g" },
    {
      activeScopes: ["global"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => true,
    },
  );
  resolver.handleKeyDown(
    { key: "f" },
    {
      activeScopes: ["global"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => true,
    },
  );
  expect(
    executed.at(-1),
    "Resolver should track and dispatch multi-key sequences.",
  ).toBe("editor.redo");

  let textPrefixPrevented = false;
  const textPrefixResult = resolver.handleKeyDown(
    {
      key: "g",
      target: { input: true } as unknown as EventTarget,
      preventDefault: () => {
        textPrefixPrevented = true;
      },
    },
    {
      activeScopes: ["global"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => true,
      isTextEditingTarget: (target) => target !== undefined && target !== null,
    },
  );
  expect(
    textPrefixResult.handled &&
      !textPrefixResult.pendingSequence &&
      !textPrefixPrevented,
    "Resolver should not reserve sequence prefixes from text-editing targets.",
  ).toBeFalsy();

  let disabledPrefixPrevented = false;
  const disabledPrefixResult = resolver.handleKeyDown(
    {
      key: "g",
      preventDefault: () => {
        disabledPrefixPrevented = true;
      },
    },
    {
      activeScopes: ["global"],
      executeCommand: (command) => executed.push(command.id),
      isCommandEnabled: () => false,
    },
  );
  expect(
    disabledPrefixResult.handled &&
      !disabledPrefixResult.pendingSequence &&
      !disabledPrefixPrevented,
    "Resolver should not reserve sequence prefixes when matching sequence commands are disabled.",
  ).toBeFalsy();
});
