import type { ShortcutCommandId } from "@/core/shortcuts/commands";
import { formatShortcut } from "@/core/shortcuts/shortcut-grammar";

export interface ShortcutSettingsState {
  recordingCommandId: ShortcutCommandId | null;
  recordingSteps: readonly string[];
  conflictMessage: string | null;
}

export function createInitialShortcutSettingsState(): ShortcutSettingsState {
  return {
    recordingCommandId: null,
    recordingSteps: [],
    conflictMessage: null,
  };
}

export function startShortcutRecording(
  state: ShortcutSettingsState,
  commandId: ShortcutCommandId,
): ShortcutSettingsState {
  return {
    ...state,
    recordingCommandId: commandId,
    recordingSteps: [],
    conflictMessage: null,
  };
}

export function appendShortcutRecordingStep(
  state: ShortcutSettingsState,
  step: string,
): ShortcutSettingsState {
  if (!state.recordingCommandId) {
    return state;
  }

  return {
    ...state,
    recordingSteps: [...state.recordingSteps, step],
  };
}

export function cancelShortcutRecording(): ShortcutSettingsState {
  return createInitialShortcutSettingsState();
}

export function getPendingRecordedShortcut(state: ShortcutSettingsState) {
  return state.recordingSteps.length > 0
    ? state.recordingSteps.join(">")
    : null;
}

export function completeShortcutRecording(
  state: ShortcutSettingsState,
  conflicts: readonly { commandIds: readonly string[] }[],
): ShortcutSettingsState {
  if (conflicts.length > 0) {
    return setShortcutConflictState(state, conflicts);
  }

  return createInitialShortcutSettingsState();
}

export function setShortcutConflictState(
  state: ShortcutSettingsState,
  conflicts: readonly { commandIds: readonly string[] }[],
): ShortcutSettingsState {
  return {
    ...state,
    conflictMessage:
      conflicts.length > 0 ? getShortcutConflictMessage(conflicts) : null,
  };
}

export function getShortcutSettingsDisplayLabel({
  isRecording,
  recordingSteps,
  shortcutLabel,
}: {
  isRecording: boolean;
  recordingSteps: readonly string[];
  shortcutLabel: string | null;
}) {
  if (isRecording) {
    return (
      recordingSteps.map((step) => formatShortcut(step)).join(" > ") ||
      "Recording"
    );
  }

  return shortcutLabel ?? "Unassigned";
}

export function getShortcutConflictMessage(
  conflicts: readonly { commandIds: readonly string[] }[],
) {
  return `Conflict with ${conflicts[0]!.commandIds.join(", ")}.`;
}
