import { test } from "bun:test";

import { expectTrue } from "@/testing/expect.spec";
import type {
  EditorEvent,
  EditorViewState,
} from "@/domain/editor/state-machine";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createWorkbenchShortcutCommandHandlers,
  getWorkbenchShortcutActiveScopes,
} from "@/app/workbench/commands/workbench-shortcuts";
import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
} from "@/core/shortcuts/commands";
import { createEffectiveKeymap } from "@/core/shortcuts/keymap";
import {
  createShortcutResolver,
  type ShortcutResolverEvent,
} from "@/core/shortcuts/resolver";
import { createToolActionBus } from "@/core/tools/tool-action-bus";
import type { ToolId } from "@/core/tools/tool-registry";
import { isTextEditingTarget } from "@/hooks/shortcut-targets";

test("src/app/workbench-shortcuts.spec.ts", () => {
  const deleteFixture = createFixture({
    mode: "sketch",
    selection: [
      {
        kind: "dimension",
        sketchId: "sketch_a",
        dimensionId: "dimension_a",
      } as PrimitiveRef,
    ],
    sketchSession: createSketchSession(),
  });

  const deleteResult = deleteFixture.press({ key: "Delete" });
  expectTrue(
    deleteResult.commandId === "editor.deleteSelection",
    "Delete should resolve the annotation delete command.",
  );
  expectTrue(
    deleteFixture.dispatchedEvents.at(-1)?.type ===
      "sketch.annotationDeleteRequested",
    "Delete shortcut should dispatch the annotation delete event.",
  );

  const backspaceFixture = createFixture({
    mode: "sketch",
    selection: [
      {
        kind: "constraint",
        sketchId: "sketch_a",
        constraintId: "constraint_a",
      } as PrimitiveRef,
    ],
    sketchSession: createSketchSession(),
  });

  const backspaceResult = backspaceFixture.press({ key: "Backspace" });
  expectTrue(
    backspaceResult.commandId === "editor.deleteSelection",
    "Backspace should resolve the annotation delete command.",
  );
  expectTrue(
    backspaceFixture.dispatchedEvents.at(-1)?.type ===
      "sketch.annotationDeleteRequested",
    "Backspace shortcut should dispatch the annotation delete event.",
  );

  const deleteGeometryFixture = createFixture({
    mode: "sketch",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: "sketch_entity_1",
      } as PrimitiveRef,
    ],
    sketchSession: createSketchSession(),
  });

  const deleteGeometryResult = deleteGeometryFixture.press({ key: "Delete" });
  expectTrue(
    deleteGeometryResult.commandId === "editor.deleteSelection",
    "Delete should resolve for selected sketch geometry.",
  );
  expectTrue(
    deleteGeometryFixture.dispatchedEvents.at(-1)?.type ===
      "sketch.annotationDeleteRequested",
    "Delete shortcut should dispatch the shared delete-selection event for sketch geometry.",
  );

  const backspacePointFixture = createFixture({
    mode: "sketch",
    selection: [
      {
        kind: "sketchPoint",
        sketchId: "sketch_draft",
        pointId: "sketch_point_1",
      } as PrimitiveRef,
    ],
    sketchSession: createSketchSession(),
  });

  const backspacePointResult = backspacePointFixture.press({
    key: "Backspace",
  });
  expectTrue(
    backspacePointResult.commandId === "editor.deleteSelection",
    "Backspace should resolve for selected sketch points.",
  );
  expectTrue(
    backspacePointFixture.dispatchedEvents.at(-1)?.type ===
      "sketch.annotationDeleteRequested",
    "Backspace shortcut should dispatch the shared delete-selection event for sketch points.",
  );

  const sketchFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });

  const lineResult = sketchFixture.press({ key: "l" });
  expectTrue(
    lineResult.commandId === "tool.line",
    "Line shortcut should resolve to the Line tool command in sketch mode.",
  );
  expectTrue(
    sketchFixture.triggeredToolIds.at(-1) === "line",
    "Line shortcut should trigger the Line tool.",
  );
  expectTrue(
    sketchFixture.observedLineSource === "shortcut",
    "Line shortcut should route shortcut source metadata.",
  );

  const escapeFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession("line"),
  });

  const escapeResult = escapeFixture.press({ key: "Escape" });
  expectTrue(
    escapeResult.commandId === "editor.cancel",
    "Escape should resolve to the workbench cancel command.",
  );
  expectTrue(
    escapeFixture.dispatchedEvents.at(-1)?.type === "sketch.activeToolCleared",
    "Escape should dispatch the sketch active-tool clear event when a sketch tool is active.",
  );

  const escapeStyleFocusFixture = createFixture({
    mode: "sketch",
    selection: [
      {
        kind: "sketchEntity",
        sketchId: "sketch_draft",
        entityId: "sketch_entity_1",
      } as PrimitiveRef,
    ],
    sketchSession: createSketchSession(null, "stroke"),
  });

  const escapeStyleFocusResult = escapeStyleFocusFixture.press({
    key: "Escape",
  });
  expectTrue(
    escapeStyleFocusResult.commandId === "editor.cancel",
    "Escape should resolve to cancel while a sketch style tool is focused.",
  );
  expectTrue(
    escapeStyleFocusFixture.dispatchedEvents.at(-1)?.type ===
      "sketch.activeToolCleared",
    "Escape should dispatch sketch active-tool clear before clearing selection while a style tool is focused.",
  );

  const escapeSelectionFixture = createFixture({
    mode: "part",
    selection: [{ kind: "body", bodyId: "body_a" } as PrimitiveRef],
  });

  const escapeSelectionResult = escapeSelectionFixture.press({ key: "Escape" });
  expectTrue(
    escapeSelectionResult.commandId === "editor.cancel",
    "Escape should resolve to cancel for selection clearing.",
  );
  expectTrue(
    escapeSelectionFixture.dispatchedEvents.at(-1)?.type ===
      "selection.cleared",
    "Escape should dispatch selection clearing when no higher-priority interaction handles it.",
  );

  const finishSketchFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });

  const finishSketchResult = finishSketchFixture.press({
    key: "Enter",
    shiftKey: true,
  });
  expectTrue(
    finishSketchResult.commandId === "tool.finishSketch",
    "Shift+Enter should resolve to Finish Sketch.",
  );
  expectTrue(
    finishSketchFixture.triggeredToolIds.at(-1) === "finishSketch",
    "Finish Sketch shortcut should trigger the finishSketch tool.",
  );

  const undoFixture = createFixture({ canUndo: true, mode: "part" });
  const undoResult = undoFixture.press({ ctrlKey: true, key: "z" });
  expectTrue(
    undoResult.commandId === "editor.undo",
    "Ctrl+Z should resolve to Undo.",
  );
  expectTrue(
    undoFixture.undoRequests === 1,
    "Undo shortcut should reuse the shared history entrypoint.",
  );

  const redoFixture = createFixture({ canRedo: true, mode: "part" });
  const redoResult = redoFixture.press({ ctrlKey: true, key: "y" });
  expectTrue(
    redoResult.commandId === "editor.redo",
    "Ctrl+Y should resolve to Redo.",
  );
  expectTrue(
    redoFixture.redoRequests === 1,
    "Redo shortcut should reuse the shared history entrypoint.",
  );

  const guardedInputFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });
  let inputPrevented = false;
  const inputResult = guardedInputFixture.press({
    key: "l",
    target: createTextTarget({ tagName: "input" }),
    preventDefault: () => {
      inputPrevented = true;
    },
  });
  expectTrue(
    !inputResult.handled && !inputPrevented,
    "Printable tool shortcuts should not be handled from inputs.",
  );
  expectTrue(
    guardedInputFixture.triggeredToolIds.length === 0,
    "Input guard should prevent Line activation.",
  );

  const guardedContentEditableFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });
  const contentEditableResult = guardedContentEditableFixture.press({
    key: "l",
    target: createTextTarget({ isContentEditable: true }),
  });
  expectTrue(
    !contentEditableResult.handled,
    "Printable tool shortcuts should not be handled from contenteditable targets.",
  );
  expectTrue(
    guardedContentEditableFixture.triggeredToolIds.length === 0,
    "Contenteditable guard should prevent Line activation.",
  );

  const partModeFixture = createFixture({ mode: "part" });
  const partLineResult = partModeFixture.press({ key: "l" });
  expectTrue(
    partLineResult.commandId === null,
    "Sketch tool shortcuts should not resolve in part mode.",
  );
  expectTrue(
    partModeFixture.triggeredToolIds.length === 0,
    "Part mode should not trigger sketch-only tools.",
  );

  const sketchModeFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });
  const sketchExtrudeResult = sketchModeFixture.press({ key: "e" });
  expectTrue(
    sketchExtrudeResult.commandId === null,
    "Part tool shortcuts should not resolve in sketch mode.",
  );
  expectTrue(
    sketchModeFixture.triggeredToolIds.length === 0,
    "Sketch mode should not trigger part-only tools.",
  );
});

interface FixtureOptions {
  canRedo?: boolean;
  canUndo?: boolean;
  mode: EditorViewState["mode"];
  selection?: EditorViewState["selection"];
  sketchSession?: EditorViewState["sketchSession"];
}

function createFixture({
  canRedo = true,
  canUndo = true,
  mode,
  selection = [],
  sketchSession = null,
}: FixtureOptions) {
  const actionBus = createToolActionBus();
  const dispatchedEvents: EditorEvent[] = [];
  let redoRequests = 0;
  const triggeredToolIds: ToolId[] = [];
  let undoRequests = 0;
  let observedLineSource: string | null = null;

  actionBus.subscribeToTool("line", (event) => {
    observedLineSource = event.source;
  });

  const commandHandlers = createWorkbenchShortcutCommandHandlers({
    activeCommand: null,
    activeReferencePickerFieldId: null,
    activateTool: (toolId, metadata) => {
      triggeredToolIds.push(toolId);
      actionBus.triggerTool(toolId, mode, metadata);
    },
    canRedo,
    canUndo,
    dispatch: (event) => {
      dispatchedEvents.push(event);
    },
    mode,
    requestRedo: () => {
      redoRequests += 1;
    },
    requestUndo: () => {
      undoRequests += 1;
    },
    selection,
    sketchSession,
  });
  const registry = createShortcutCommandRegistry(
    getShortcutCommandDefinitions(),
  );
  const resolver = createShortcutResolver(
    registry,
    createEffectiveKeymap(registry),
  );

  return {
    get dispatchedEvents() {
      return dispatchedEvents;
    },
    get observedLineSource() {
      return observedLineSource;
    },
    get redoRequests() {
      return redoRequests;
    },
    press(event: ShortcutResolverEvent) {
      return resolver.handleKeyDown(event, {
        activeScopes: getWorkbenchShortcutActiveScopes(mode),
        executeCommand: (command) => commandHandlers[command.id]?.execute(),
        isCommandEnabled: (command) =>
          commandHandlers[command.id]?.isEnabled?.() ??
          Boolean(commandHandlers[command.id]),
        isTextEditingTarget,
        platform: "windows",
      });
    },
    triggeredToolIds,
    get undoRequests() {
      return undoRequests;
    },
  };
}

function createSketchSession(
  activeTool: NonNullable<
    EditorViewState["sketchSession"]
  >["activeTool"] = null,
  styleToolId: "stroke" | null = null,
) {
  return {
    sketchId: null,
    definition: {
      pointIds: ["sketch_point_1"],
      entityIds: ["sketch_entity_1"],
    },
    activeTool,
    activeStyleFocus: styleToolId
      ? {
          toolId: styleToolId,
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_draft",
            entityId: "sketch_entity_1",
          },
        }
      : null,
  } as EditorViewState["sketchSession"];
}

function createTextTarget(target: {
  isContentEditable?: true;
  tagName?: string;
}) {
  return target as EventTarget;
}
