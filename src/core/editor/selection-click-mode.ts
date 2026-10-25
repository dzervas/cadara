import type { SelectionRequestMode } from "@/core/editor/state-machine/types";

/**
 * How a plain viewport click combines with the selection (cadara-h026.1),
 * a user setting kept with the shortcut profile:
 * - `additive` (default, as Onshape): a click adds the pick, or removes it
 *   when already selected; Shift does the same.
 * - `shiftToAdd`: a click replaces the selection; Shift (or Ctrl/Cmd)
 *   toggles the pick in or out.
 */
export type SelectionClickMode = "additive" | "shiftToAdd";

export const DEFAULT_SELECTION_CLICK_MODE: SelectionClickMode = "additive";

export interface SelectionClickModifiers {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}

/** The request mode of a single selecting click in a multi-selection context. */
export function getSelectionClickRequestMode(
  clickMode: SelectionClickMode,
  modifiers: SelectionClickModifiers,
): Extract<SelectionRequestMode, "replace" | "toggle"> {
  return clickMode === "additive" ||
    modifiers.shiftKey ||
    modifiers.ctrlKey ||
    modifiers.metaKey
    ? "toggle"
    : "replace";
}

/** How a sketch marquee combines with the selection: as a click would. */
export function getSelectionMarqueeMode(
  clickMode: SelectionClickMode,
  modifiers: SelectionClickModifiers,
): "replace" | "add" {
  return getSelectionClickRequestMode(clickMode, modifiers) === "toggle"
    ? "add"
    : "replace";
}

export function parseSelectionClickMode(
  value: string | null,
): SelectionClickMode {
  return value === "shiftToAdd" ? "shiftToAdd" : DEFAULT_SELECTION_CLICK_MODE;
}

