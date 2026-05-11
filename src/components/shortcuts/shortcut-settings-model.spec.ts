import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
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

  expectTrue(
    getShortcutSettingsDisplayLabel({
      isRecording: state.recordingCommandId === "editor.focusSearch",
      recordingSteps: state.recordingSteps,
      shortcutLabel: "Ctrl+K",
    }) === "G > F",
    "Recording display should update immediately while a replacement sequence is being edited.",
  );

  const recordedShortcut = getPendingRecordedShortcut(state);
  expectTrue(
    recordedShortcut === "g>f",
    "Recorded steps should serialize to the profile override format.",
  );

  const editValidation = validateShortcutOverrideUpdate(
    registry,
    setCommandShortcutOverride(overrides, "editor.focusSearch", [
      recordedShortcut,
    ]),
  );
  expectTrue(
    editValidation.nextOverrides !== null,
    "Valid edited shortcuts should be accepted.",
  );
  overrides = editValidation.nextOverrides;
  state = completeShortcutRecording(state, editValidation.conflicts);

  expectTrue(
    state.recordingCommandId === null,
    "Saving a valid shortcut should exit recording mode.",
  );
  expectTrue(
    getReferenceShortcutLabel(registry, overrides, "editor.focusSearch") ===
      "G > F",
    "Reference display should use the edited shortcut immediately.",
  );

  state = startShortcutRecording(state, "editor.focusSearch");
  state = appendShortcutRecordingStep(state, "mod+z");

  const conflictValidation = validateShortcutOverrideUpdate(
    registry,
    setCommandShortcutOverride(overrides, "editor.focusSearch", [
      getPendingRecordedShortcut(state)!,
    ]),
  );
  expectTrue(
    conflictValidation.nextOverrides === null,
    "Conflicting shortcuts should not produce savable overrides.",
  );
  state = completeShortcutRecording(state, conflictValidation.conflicts);

  expectTrue(
    state.conflictMessage === "Conflict with editor.undo, editor.focusSearch.",
    "Conflicting edits should expose the ambiguous commands.",
  );
  expectTrue(
    state.recordingCommandId === "editor.focusSearch",
    "Conflicting edits should keep recording active so the user can correct the shortcut.",
  );
  expectTrue(
    getReferenceShortcutLabel(registry, overrides, "editor.focusSearch") ===
      "G > F",
    "Invalid conflicting edits should not replace the current display shortcut.",
  );

  overrides = disableCommandShortcut(overrides, "editor.focusSearch");
  expectTrue(
    getPrimaryShortcut(
      createEffectiveKeymap(registry, overrides),
      "editor.focusSearch",
    ) === null,
    "Disabling should remove the effective shortcut.",
  );
  expectTrue(
    getShortcutSettingsDisplayLabel({
      isRecording: false,
      recordingSteps: [],
      shortcutLabel: getReferenceShortcutLabel(
        registry,
        overrides,
        "editor.focusSearch",
      ),
    }) === "Unassigned",
    "Disabled shortcuts should display as unassigned immediately.",
  );
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
