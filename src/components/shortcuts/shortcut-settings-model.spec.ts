import { test, expect } from "vitest";

import {
  appendShortcutRecordingStep,
  completeShortcutRecording,
  createInitialShortcutSettingsState,
  getPendingRecordedShortcut,
  getShortcutSettingsDisplayLabel,
  startShortcutRecording,
} from "@/components/shortcuts/shortcut-settings-model";
import {
  createShortcutCommandRegistry,
  type ShortcutCommandDefinition,
  type ShortcutCommandId,
} from "@/core/shortcuts/commands";
import {
  createEffectiveKeymap,
  getPrimaryShortcut,
  type ShortcutProfileOverrides,
} from "@/core/shortcuts/keymap";
import {
  disableCommandShortcut,
  setCommandShortcutOverride,
} from "@/core/shortcuts/profile-repository";
import { createShortcutReferenceGroups } from "@/core/shortcuts/reference";
import { validateShortcutOverrideUpdate } from "@/hooks/shortcut-validation";

test("src/components/shortcuts/shortcut-settings-model.spec.ts", () => {
  const commands = [
    {
      id: "editor.undo",
      label: "Undo",
      category: "History",
      scope: "global",
      defaultShortcuts: ["mod+z"],
      customizable: true,
    },
    {
      id: "editor.focusSearch",
      label: "Focus Tool Search",
      category: "Editor",
      scope: "global",
      defaultShortcuts: ["mod+k"],
      customizable: true,
    },
  ] as const satisfies readonly ShortcutCommandDefinition[];
  const registry = createShortcutCommandRegistry(commands);
  let overrides: ShortcutProfileOverrides = {};
  let state = createInitialShortcutSettingsState();

  state = startShortcutRecording(state, "editor.focusSearch");
  state = appendShortcutRecordingStep(state, "g");
  state = appendShortcutRecordingStep(state, "f");

  expect(
    getShortcutSettingsDisplayLabel({
        isRecording: state.recordingCommandId === "editor.focusSearch",
        recordingSteps: state.recordingSteps,
        shortcutLabel: "Ctrl+K",
      }),
    "Recording display should update immediately while a replacement sequence is being edited.",
  ).toBe("G > F");

  const recordedShortcut = getPendingRecordedShortcut(state);
  expect(
    recordedShortcut,
    "Recorded steps should serialize to the profile override format.",
  ).toBe("g>f");

  const editValidation = validateShortcutOverrideUpdate(
    registry,
    setCommandShortcutOverride(overrides, "editor.focusSearch", [
      recordedShortcut,
    ]),
  );
  expect(editValidation.nextOverrides, "Valid edited shortcuts should be accepted.").not.toBe(null);
  overrides = editValidation.nextOverrides;
  state = completeShortcutRecording(state, editValidation.conflicts);

  expect(state.recordingCommandId, "Saving a valid shortcut should exit recording mode.").toBe(null);
  expect(
    getReferenceShortcutLabel(registry, overrides, "editor.focusSearch"),
    "Reference display should use the edited shortcut immediately.",
  ).toBe("G > F");

  state = startShortcutRecording(state, "editor.focusSearch");
  state = appendShortcutRecordingStep(state, "mod+z");

  const conflictValidation = validateShortcutOverrideUpdate(
    registry,
    setCommandShortcutOverride(overrides, "editor.focusSearch", [
      getPendingRecordedShortcut(state)!,
    ]),
  );
  expect(
    conflictValidation.nextOverrides,
    "Conflicting shortcuts should not produce savable overrides.",
  ).toBe(null);
  state = completeShortcutRecording(state, conflictValidation.conflicts);

  expect(
    state.conflictMessage,
    "Conflicting edits should expose the ambiguous commands.",
  ).toBe("Conflict with editor.undo, editor.focusSearch.");
  expect(
    state.recordingCommandId,
    "Conflicting edits should keep recording active so the user can correct the shortcut.",
  ).toBe("editor.focusSearch");
  expect(
    getReferenceShortcutLabel(registry, overrides, "editor.focusSearch"),
    "Invalid conflicting edits should not replace the current display shortcut.",
  ).toBe("G > F");

  overrides = disableCommandShortcut(overrides, "editor.focusSearch");
  expect(
    getPrimaryShortcut(
        createEffectiveKeymap(registry, overrides),
        "editor.focusSearch",
      ),
    "Disabling should remove the effective shortcut.",
  ).toBe(null);
  expect(
    getShortcutSettingsDisplayLabel({
        isRecording: false,
        recordingSteps: [],
        shortcutLabel: getReferenceShortcutLabel(
          registry,
          overrides,
          "editor.focusSearch",
        ),
      }),
    "Disabled shortcuts should display as unassigned immediately.",
  ).toBe("Unassigned");
});

function getReferenceShortcutLabel(
  registry: ReturnType<typeof createShortcutCommandRegistry>,
  overrides: ShortcutProfileOverrides,
  commandId: ShortcutCommandId,
) {
  const keymap = createEffectiveKeymap(registry, overrides);
  return (
    createShortcutReferenceGroups(registry, keymap)
      .flatMap((group) => group.commands)
      .find(({ command }) => command.id === commandId)?.shortcutLabel ?? null
  );
}
