import { test, expect } from "vitest";

import {
  formatShortcut,
  isModifierOnlyShortcutEvent,
  normalizeShortcut,
  parseShortcut,
  serializeShortcut,
  shortcutFromKeyboardEvent,
} from "@/core/shortcuts/shortcut-grammar";

test("src/core/shortcuts/shortcut-grammar.spec.ts", () => {
  const chord = parseShortcut("mod+shift+z");
  expect(chord.chords.length, "Modifier shortcuts should parse as one chord.").toBe(1);
  expect(
    serializeShortcut(chord),
    "Shortcut parser should normalize modifier order and key casing.",
  ).toBe("mod+shift+z");

  const sequence = parseShortcut("g>f");
  expect(sequence.chords.length, "Sequences should parse as ordered chord lists.").toBe(2);
  expect(serializeShortcut(sequence), "Sequences should preserve ordered keys.").toBe("g>f");
  expect(normalizeShortcut("Esc"), "Aliases should normalize to event.key values.").toBe("escape");
  expect(
    normalizeShortcut("control+del"),
    "Modifier and key aliases should normalize.",
  ).toBe("ctrl+delete");

  expect(
    formatShortcut("mod+z", { platform: "mac" }),
    "Mac formatting should display a Command-style modifier label.",
  ).toBe("Cmd+Z");
  expect(
    formatShortcut("mod+z", { platform: "windows" }),
    "Non-Mac formatting should display Ctrl for mod.",
  ).toBe("Ctrl+Z");
  expect(
    formatShortcut("g>f", { platform: "windows" }),
    "Sequence formatting should preserve ordered sequence steps.",
  ).toBe("G > F");

  expect(
    serializeShortcut(
        shortcutFromKeyboardEvent(
          { key: "Z", ctrlKey: true },
          { platform: "windows" },
        )!,
      ),
    "Keyboard events should normalize from logical event.key and platform modifiers.",
  ).toBe("mod+z");
});

test("shortcutFromKeyboardEvent rejects keydown events without a usable shortcut key", () => {
  for (const event of [
    { key: undefined },
    { key: "" },
    { key: "Unidentified" },
    { key: "Process" },
    { key: "Dead" },
    { key: "a", isComposing: true },
  ]) {
    expect(
      shortcutFromKeyboardEvent(event, { platform: "windows" }),
      `Keydown ${JSON.stringify(event)} has no shortcut key.`,
    ).toBeNull();
    expect(
      isModifierOnlyShortcutEvent(event),
      `Keydown ${JSON.stringify(event)} is not a modifier-only event.`,
    ).toBe(false);
  }
  expect(
    isModifierOnlyShortcutEvent({ key: "Shift", shiftKey: true }),
    "Modifier keydowns should still be recognised.",
  ).toBe(true);
  expect(
    () => parseShortcut("ctrl+"),
    "Authored shortcut parse failures must still throw.",
  ).toThrow();
});
