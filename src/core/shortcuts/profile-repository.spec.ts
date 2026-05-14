import { test, expect } from "vitest";

import {
  createLocalShortcutProfileRepository,
  disableCommandShortcut,
  resetAllShortcutOverrides,
  resetCommandShortcut,
  setCommandShortcutOverride,
  type ShortcutStorageLike,
} from "@/core/shortcuts/profile-repository";

test("src/core/shortcuts/profile-repository.spec.ts", async () => {
  const values = new Map<string, string>();
  const storage: ShortcutStorageLike = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => {
      values.delete(key);
    },
  };
  const repository = createLocalShortcutProfileRepository(
    storage,
    "test-shortcuts",
  );

  expect(
    Object.keys(await repository.load()).length,
    "Profile repository should load empty overrides by default.",
  ).toBe(0);

  const remapped = setCommandShortcutOverride({}, "editor.undo", ["u"]);
  await repository.save(remapped);
  expect(
    (await repository.load())["editor.undo"]?.shortcuts[0],
    "Profile repository should persist shortcut overrides.",
  ).toBe("u");

  const disabled = disableCommandShortcut(remapped, "editor.undo");
  await repository.save(disabled);
  expect(
    (await repository.load())["editor.undo"]?.shortcuts.length,
    "Profile repository should preserve empty shortcut lists as disabled overrides.",
  ).toBe(0);

  await repository.save(resetCommandShortcut(disabled, "editor.undo"));
  expect(
    Object.keys(await repository.load()).length,
    "Resetting a command should remove its override so defaults apply.",
  ).toBe(0);

  await repository.save(resetAllShortcutOverrides());
  expect(values.size, "Reset all should clear stored shortcut overrides.").toBe(0);
});
