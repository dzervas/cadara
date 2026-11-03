export interface NumberInputDraft {
  accepted: number | null;
  text: string | number;
  editing: boolean;
}

type NumberInputDraftAction =
  | { type: "focus" }
  | { type: "edit"; text: string | number }
  | { type: "accept"; value: number | null }
  | { type: "finish" };

export function createNumberInputDraft(value: number | null): NumberInputDraft {
  return { accepted: value, text: value ?? "", editing: false };
}

export function reduceNumberInputDraft(
  state: NumberInputDraft,
  action: NumberInputDraftAction,
): NumberInputDraft {
  switch (action.type) {
    case "focus":
      return { ...state, editing: true };
    case "edit":
      return { ...state, text: action.text };
    case "accept":
      return {
        ...state,
        accepted: action.value,
        text: state.editing ? state.text : (action.value ?? ""),
      };
    case "finish":
      // A rejected or normalized commit may leave the accepted value unchanged.
      return { ...state, editing: false, text: state.accepted ?? "" };
  }
}

/**
 * Whether a draft's resolved value must be handed to the consumer: only when
 * it differs from `sent`, the value the consumer last received (its accepted
 * value, or an earlier draft). Typing therefore drives a preview and its
 * validation live, while blur and Enter after an unchanged or already sent
 * draft, and focus merely passing through the field, send nothing.
 */
export function shouldSendNumberInput(
  resolved: number | null,
  sent: number | null,
): boolean {
  return resolved !== sent;
}

export function resolveNumberInputCommit(
  text: string | number,
  options: {
    min?: number | string;
    max?: number | string;
    clampBehavior?: "strict" | "blur" | "none";
  },
): number | null {
  let number =
    typeof text === "string" && text.trim() === "" ? NaN : Number(text);
  if (options.clampBehavior !== "none") {
    if (typeof options.min === "number") number = Math.max(options.min, number);
    if (typeof options.max === "number") number = Math.min(options.max, number);
  }
  return Number.isFinite(number) ? number : null;
}
