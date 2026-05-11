import {
  isModifierOnlyShortcutEvent,
  serializeShortcut,
  shortcutFromKeyboardEvent,
  type KeyboardShortcutEvent,
} from "@/core/shortcuts/shortcut-grammar";

export function getRecordedShortcutStep(event: KeyboardShortcutEvent) {
  if (isModifierOnlyShortcutEvent(event)) {
    return null;
  }

  const shortcut = shortcutFromKeyboardEvent(event);
  const key = shortcut.chords[0]?.key;

  if (key === "+" || key === ">") {
    return null;
  }

  return serializeShortcut(shortcut);
}
