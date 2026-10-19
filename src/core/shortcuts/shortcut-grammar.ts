export type ShortcutModifier = "alt" | "ctrl" | "meta" | "mod" | "shift";

export interface ShortcutChord {
  key: string;
  modifiers: readonly ShortcutModifier[];
}

export interface ShortcutSequence {
  chords: readonly ShortcutChord[];
}

export interface ShortcutFormatOptions {
  platform?: "mac" | "windows" | "linux";
}

export interface KeyboardShortcutEvent {
  /**
   * Optional because window keydown listeners also receive trusted events
   * without one (Chrome autofill dispatches a plain `Event`, Sentry CADARA-16).
   */
  key?: string;
  isComposing?: boolean;
  altKey?: boolean;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
}

const modifierOrder: readonly ShortcutModifier[] = [
  "mod",
  "ctrl",
  "meta",
  "alt",
  "shift",
];
const modifierAliases: Record<string, ShortcutModifier | undefined> = {
  alt: "alt",
  cmd: "meta",
  command: "meta",
  control: "ctrl",
  ctrl: "ctrl",
  meta: "meta",
  mod: "mod",
  option: "alt",
  shift: "shift",
};

const keyAliases: Record<string, string | undefined> = {
  arrowdown: "arrowdown",
  arrowleft: "arrowleft",
  arrowright: "arrowright",
  arrowup: "arrowup",
  backspace: "backspace",
  del: "delete",
  delete: "delete",
  down: "arrowdown",
  enter: "enter",
  esc: "escape",
  escape: "escape",
  left: "arrowleft",
  return: "enter",
  right: "arrowright",
  space: "space",
  spacebar: "space",
  tab: "tab",
  up: "arrowup",
};

const displayKeyLabels: Record<string, string | undefined> = {
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  arrowup: "Up",
  backspace: "Backspace",
  delete: "Delete",
  enter: "Enter",
  escape: "Esc",
  space: "Space",
  tab: "Tab",
};

function normalizeToken(token: string) {
  return token.trim().toLowerCase();
}

function normalizeKey(key: string) {
  const normalized = normalizeToken(key);
  return keyAliases[normalized] ?? normalized;
}

/** `event.key` placeholders for keys that carry no logical key (UI Events). */
const unsupportedEventKeys = new Set(["Dead", "Process", "Unidentified"]);

function getShortcutEventKey(event: KeyboardShortcutEvent) {
  if (
    event.isComposing ||
    typeof event.key !== "string" ||
    event.key === "" ||
    unsupportedEventKeys.has(event.key)
  ) {
    return null;
  }

  return event.key;
}

function sortModifiers(modifiers: Iterable<ShortcutModifier>) {
  const modifierSet = new Set(modifiers);
  return modifierOrder.filter((modifier) => modifierSet.has(modifier));
}

export function parseShortcut(input: string): ShortcutSequence {
  const chordInputs = input
    .split(">")
    .map((part) => part.trim())
    .filter(Boolean);

  if (chordInputs.length === 0) {
    throw new Error("Shortcut must contain at least one key.");
  }

  return {
    chords: chordInputs.map((chordInput) => {
      const tokens = chordInput
        .split("+")
        .map((token) => token.trim())
        .filter(Boolean);

      if (tokens.length === 0) {
        throw new Error(`Shortcut chord "${chordInput}" must contain a key.`);
      }

      const modifiers: ShortcutModifier[] = [];
      let key: string | null = null;

      for (const token of tokens) {
        const normalized = normalizeToken(token);
        const modifier = modifierAliases[normalized];

        if (modifier) {
          modifiers.push(modifier);
          continue;
        }

        if (key) {
          throw new Error(
            `Shortcut chord "${chordInput}" contains more than one key.`,
          );
        }

        key = normalizeKey(token);
      }

      if (!key) {
        throw new Error(
          `Shortcut chord "${chordInput}" must contain a non-modifier key.`,
        );
      }

      return {
        key,
        modifiers: sortModifiers(modifiers),
      };
    }),
  };
}

export function normalizeShortcut(input: string | ShortcutSequence) {
  return serializeShortcut(
    typeof input === "string" ? parseShortcut(input) : input,
  );
}

export function serializeShortcut(shortcut: ShortcutSequence) {
  return shortcut.chords.map(serializeChord).join(">");
}

export function serializeChord(chord: ShortcutChord) {
  return [...sortModifiers(chord.modifiers), chord.key].join("+");
}

export function shortcutFromKeyboardEvent(
  event: KeyboardShortcutEvent,
  options: ShortcutFormatOptions = {},
): ShortcutSequence | null {
  const eventKey = getShortcutEventKey(event);
  if (eventKey === null) {
    return null;
  }

  const platform = options.platform ?? getCurrentPlatform();
  const key = normalizeKey(eventKey);
  const modifiers: ShortcutModifier[] = [];

  if (event.altKey) {
    modifiers.push("alt");
  }
  if (event.shiftKey) {
    modifiers.push("shift");
  }

  if (platform === "mac") {
    if (event.metaKey) {
      modifiers.push("mod");
    }
    if (event.ctrlKey) {
      modifiers.push("ctrl");
    }
  } else {
    if (event.ctrlKey) {
      modifiers.push("mod");
    }
    if (event.metaKey) {
      modifiers.push("meta");
    }
  }

  return {
    chords: [
      {
        key,
        modifiers: sortModifiers(modifiers),
      },
    ],
  };
}

export function isModifierOnlyShortcutEvent(event: KeyboardShortcutEvent) {
  const eventKey = getShortcutEventKey(event);
  return (
    eventKey !== null && modifierAliases[normalizeToken(eventKey)] !== undefined
  );
}

export function formatShortcut(
  shortcut: string | ShortcutSequence,
  options: ShortcutFormatOptions = {},
) {
  const sequence =
    typeof shortcut === "string" ? parseShortcut(shortcut) : shortcut;
  return sequence.chords
    .map((chord) => formatChord(chord, options))
    .join(" > ");
}

export function formatChord(
  chord: ShortcutChord,
  options: ShortcutFormatOptions = {},
) {
  const platform = options.platform ?? getCurrentPlatform();
  const parts: string[] = chord.modifiers.map((modifier) =>
    formatModifier(modifier, platform),
  );
  parts.push(formatKey(chord.key));
  return parts.join("+");
}

export function isPrintableShortcut(shortcut: ShortcutSequence) {
  if (shortcut.chords.length !== 1) {
    return false;
  }

  const [chord] = shortcut.chords;
  return chord.modifiers.length === 0 && chord.key.length === 1;
}

export function shortcutsEqual(
  left: ShortcutSequence,
  right: ShortcutSequence,
) {
  return serializeShortcut(left) === serializeShortcut(right);
}

export function shortcutStartsWith(
  shortcut: ShortcutSequence,
  prefix: ShortcutSequence,
) {
  if (prefix.chords.length >= shortcut.chords.length) {
    return false;
  }

  return prefix.chords.every(
    (chord, index) =>
      serializeChord(chord) === serializeChord(shortcut.chords[index]!),
  );
}

function formatModifier(
  modifier: ShortcutModifier,
  platform: "mac" | "windows" | "linux",
) {
  if (modifier === "mod") {
    return platform === "mac" ? "Cmd" : "Ctrl";
  }

  switch (modifier) {
    case "alt":
      return platform === "mac" ? "Option" : "Alt";
    case "ctrl":
      return "Ctrl";
    case "meta":
      return platform === "mac" ? "Cmd" : "Meta";
    case "shift":
      return "Shift";
  }
}

function formatKey(key: string) {
  const label = displayKeyLabels[key];
  if (label) {
    return label;
  }

  if (key.length === 1) {
    return key.toUpperCase();
  }

  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function getCurrentPlatform(): "mac" | "windows" | "linux" {
  if (typeof navigator === "undefined") {
    return "windows";
  }

  return /mac/i.test(navigator.platform) ? "mac" : "windows";
}
