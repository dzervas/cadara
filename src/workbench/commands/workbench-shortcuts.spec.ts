import { test, expect } from "vitest";

import type {
  EditorEvent,
  EditorViewState,
} from "@/domain/editor/state-machine";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createWorkbenchShortcutCommandHandlers,
  getWorkbenchShortcutActiveScopes,
} from "@/workbench/commands/workbench-shortcuts";
import {
  createShortcutCommandRegistry,
  getShortcutCommandDefinitions,
} from "@/core/shortcuts/commands";
import { createEffectiveKeymap } from "@/core/shortcuts/keymap";
import {
  createShortcutResolver,
  type ShortcutResolverEvent,
} from "@/core/shortcuts/resolver";
import type { ToolId } from "@/core/tools/tool-registry";
import { isTextEditingTarget } from "@/hooks/shortcut-targets";

test("src/workbench/commands/workbench-shortcuts.spec.ts", () => {
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
  expect(
    deleteResult.commandId,
    "Delete should resolve the annotation delete command.",
  ).toBe("editor.deleteSelection");
  expect(
    deleteFixture.dispatchedEvents.at(-1)?.type,
    "Delete shortcut should dispatch the annotation delete event.",
  ).toBe("sketch.annotationDeleteRequested");

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
  expect(
    backspaceResult.commandId,
    "Backspace should resolve the annotation delete command.",
  ).toBe("editor.deleteSelection");
  expect(
    backspaceFixture.dispatchedEvents.at(-1)?.type,
    "Backspace shortcut should dispatch the annotation delete event.",
  ).toBe("sketch.annotationDeleteRequested");

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
  expect(
    deleteGeometryResult.commandId,
    "Delete should resolve for selected sketch geometry.",
  ).toBe("editor.deleteSelection");
  expect(
    deleteGeometryFixture.dispatchedEvents.at(-1)?.type,
    "Delete shortcut should dispatch the shared delete-selection event for sketch geometry.",
  ).toBe("sketch.annotationDeleteRequested");

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
  expect(
    backspacePointResult.commandId,
    "Backspace should resolve for selected sketch points.",
  ).toBe("editor.deleteSelection");
  expect(
    backspacePointFixture.dispatchedEvents.at(-1)?.type,
    "Backspace shortcut should dispatch the shared delete-selection event for sketch points.",
  ).toBe("sketch.annotationDeleteRequested");

  const sketchFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });

  const lineResult = sketchFixture.press({ key: "l" });
  expect(
    lineResult.commandId,
    "Line shortcut should resolve to the Line tool command in sketch mode.",
  ).toBe("tool.line");
  expect(
    sketchFixture.triggeredToolIds.at(-1),
    "Line shortcut should trigger the Line tool.",
  ).toBe("line");

  const escapeFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession("line"),
  });

  const escapeResult = escapeFixture.press({ key: "Escape" });
  expect(
    escapeResult.commandId,
    "Escape should resolve to the workbench cancel command.",
  ).toBe("editor.cancel");
  expect(
    escapeFixture.dispatchedEvents.at(-1)?.type,
    "Escape should dispatch the drawing-tool Escape step event when a sketch drawing tool is active (T11-D10).",
  ).toBe("sketch.escapeRequested");

  const escapeEditToolFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession("trim"),
  });
  expect(escapeEditToolFixture.press({ key: "Escape" }).commandId).toBe(
    "editor.cancel",
  );
  expect(
    escapeEditToolFixture.dispatchedEvents.at(-1)?.type,
    "Escape should dispatch the sketch active-tool clear event when a sketch edit tool is active.",
  ).toBe("sketch.activeToolCleared");

  // Enter (T11-D10): consumed only when a drawing step applies. Before
  // T11h/T11i nothing applies, so a plain Enter keeps its native behaviour.
  const enterFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession("circle"),
  });
  let enterPrevented = false;
  const enterResult = enterFixture.press({
    key: "Enter",
    target: createToolbarButtonTarget(),
    preventDefault: () => {
      enterPrevented = true;
    },
  });
  expect(
    enterResult.handled || enterPrevented,
    "Enter with nothing to complete should not be consumed.",
  ).toBe(false);
  expect(enterFixture.dispatchedEvents).toEqual([]);
  expect(
    enterFixture.triggeredToolIds,
    "Plain Enter is not a tool shortcut (Shift+Enter is Finish Sketch).",
  ).toEqual([]);

  // Review A-5(a): when Enter applies (an active Line chain, T11h), the
  // resolver consumes it even with a toolbar button focused, so the browser
  // does not also activate the button and restart the armed tool.
  const enterOnButtonFixture = createFixture({
    mode: "sketch",
    sketchSession: createLineChainSession(),
  });
  let buttonEnterPrevented = 0;
  const enterOnButtonResult = enterOnButtonFixture.press({
    key: "Enter",
    target: createToolbarButtonTarget(),
    preventDefault: () => {
      buttonEnterPrevented += 1;
    },
  });
  expect(enterOnButtonResult.commandId).toBe("editor.confirm");
  expect(
    buttonEnterPrevented,
    "An applicable Enter on a focused toolbar button should be prevented once, cancelling the native button activation.",
  ).toBe(1);
  expect(
    enterOnButtonFixture.dispatchedEvents.map((event) => event.type),
    "Enter with an active Line chain dispatches the confirm step (T11h).",
  ).toEqual(["sketch.confirmRequested"]);
  expect(
    enterOnButtonFixture.triggeredToolIds,
    "The shortcut layer should not re-activate the armed tool.",
  ).toEqual([]);

  // T11g review V-1: Enter on a menu item (the pick chooser, a toolbar
  // dropdown) or on a dialog button belongs to that control, even while a
  // chain is active: not consumed, not prevented, nothing dispatched.
  for (const role of ["menu", "dialog"] as const) {
    const enterInOverlayFixture = createFixture({
      mode: "sketch",
      sketchSession: createLineChainSession(),
    });
    let overlayEnterPrevented = false;
    const overlayResult = enterInOverlayFixture.press({
      key: "Enter",
      target: createButtonInsideRoleTarget(role),
      preventDefault: () => {
        overlayEnterPrevented = true;
      },
    });
    expect(
      overlayResult.handled || overlayEnterPrevented,
      `Enter on a button inside [role=${role}] keeps its native activation.`,
    ).toBe(false);
    expect(
      enterInOverlayFixture.dispatchedEvents,
      `Enter inside [role=${role}] must not end the chain.`,
    ).toEqual([]);
  }

  // T11h review A-3: Enter is consumed on a focused toolbar button (above),
  // the canvas and the page body; any other focused button (sidebar,
  // inspector, feature tree) keeps its native Enter.
  for (const [name, target] of [
    ["canvas", createTarget([{ tagName: "CANVAS" }, { tagName: "MAIN" }])],
    ["page body", createTarget([{ tagName: "BODY" }])],
  ] as const) {
    const enterOnSurfaceFixture = createFixture({
      mode: "sketch",
      sketchSession: createLineChainSession(),
    });
    let surfaceEnterPrevented = 0;
    expect(
      enterOnSurfaceFixture.press({
        key: "Enter",
        target,
        preventDefault: () => {
          surfaceEnterPrevented += 1;
        },
      }).commandId,
      `Enter on the ${name} ends the chain.`,
    ).toBe("editor.confirm");
    expect(surfaceEnterPrevented).toBe(1);
    expect(
      enterOnSurfaceFixture.dispatchedEvents.map((event) => event.type),
    ).toEqual(["sketch.confirmRequested"]);
  }
  const enterOnSidebarFixture = createFixture({
    mode: "sketch",
    sketchSession: createLineChainSession(),
  });
  let sidebarEnterPrevented = false;
  const sidebarResult = enterOnSidebarFixture.press({
    key: "Enter",
    target: createTarget([
      { tagName: "BUTTON" },
      { tagName: "LI", role: "treeitem" },
      { tagName: "ASIDE" },
    ]),
    preventDefault: () => {
      sidebarEnterPrevented = true;
    },
  });
  expect(
    sidebarResult.handled || sidebarEnterPrevented,
    "Enter on a focused non-toolbar button keeps its native activation.",
  ).toBe(false);
  expect(
    enterOnSidebarFixture.dispatchedEvents,
    "Enter on a non-toolbar button must not end the chain.",
  ).toEqual([]);

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
  expect(
    escapeStyleFocusResult.commandId,
    "Escape should resolve to cancel while a sketch style tool is focused.",
  ).toBe("editor.cancel");
  expect(
    escapeStyleFocusFixture.dispatchedEvents.at(-1)?.type,
    "Escape should dispatch sketch active-tool clear before clearing selection while a style tool is focused.",
  ).toBe("sketch.activeToolCleared");

  const escapeSelectionFixture = createFixture({
    mode: "part",
    selection: [{ kind: "body", bodyId: "body_a" } as PrimitiveRef],
  });

  const escapeSelectionResult = escapeSelectionFixture.press({ key: "Escape" });
  expect(
    escapeSelectionResult.commandId,
    "Escape should resolve to cancel for selection clearing.",
  ).toBe("editor.cancel");
  expect(
    escapeSelectionFixture.dispatchedEvents.at(-1)?.type,
    "Escape should dispatch selection clearing when no higher-priority interaction handles it.",
  ).toBe("selection.cleared");

  const finishSketchFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });

  const finishSketchResult = finishSketchFixture.press({
    key: "Enter",
    shiftKey: true,
  });
  expect(
    finishSketchResult.commandId,
    "Shift+Enter should resolve to Finish Sketch.",
  ).toBe("tool.finishSketch");
  expect(
    finishSketchFixture.triggeredToolIds.at(-1),
    "Finish Sketch shortcut should trigger the finishSketch tool.",
  ).toBe("finishSketch");

  const undoFixture = createFixture({ canUndo: true, mode: "part" });
  const undoResult = undoFixture.press({ ctrlKey: true, key: "z" });
  expect(undoResult.commandId, "Ctrl+Z should resolve to Undo.").toBe(
    "editor.undo",
  );
  expect(
    undoFixture.undoRequests,
    "Undo shortcut should reuse the shared history entrypoint.",
  ).toBe(1);

  const redoFixture = createFixture({ canRedo: true, mode: "part" });
  const redoResult = redoFixture.press({ ctrlKey: true, key: "y" });
  expect(redoResult.commandId, "Ctrl+Y should resolve to Redo.").toBe(
    "editor.redo",
  );
  expect(
    redoFixture.redoRequests,
    "Redo shortcut should reuse the shared history entrypoint.",
  ).toBe(1);

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
  expect(
    inputResult.handled && !inputPrevented,
    "Printable tool shortcuts should not be handled from inputs.",
  ).toBeFalsy();
  expect(
    guardedInputFixture.triggeredToolIds.length,
    "Input guard should prevent Line activation.",
  ).toBe(0);

  const guardedContentEditableFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });
  const contentEditableResult = guardedContentEditableFixture.press({
    key: "l",
    target: createTextTarget({ isContentEditable: true }),
  });
  expect(
    contentEditableResult.handled,
    "Printable tool shortcuts should not be handled from contenteditable targets.",
  ).toBeFalsy();
  expect(
    guardedContentEditableFixture.triggeredToolIds.length,
    "Contenteditable guard should prevent Line activation.",
  ).toBe(0);

  const partModeFixture = createFixture({ mode: "part" });
  const partLineResult = partModeFixture.press({ key: "l" });
  expect(
    partLineResult.commandId,
    "Sketch tool shortcuts should not resolve in part mode.",
  ).toBe(null);
  expect(
    partModeFixture.triggeredToolIds.length,
    "Part mode should not trigger sketch-only tools.",
  ).toBe(0);

  const sketchModeFixture = createFixture({
    mode: "sketch",
    sketchSession: createSketchSession(),
  });
  const sketchExtrudeResult = sketchModeFixture.press({ key: "e" });
  expect(
    sketchExtrudeResult.commandId,
    "Part tool shortcuts should not resolve in sketch mode.",
  ).toBe(null);
  expect(
    sketchModeFixture.triggeredToolIds.length,
    "Sketch mode should not trigger part-only tools.",
  ).toBe(0);
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
  const dispatchedEvents: EditorEvent[] = [];
  let redoRequests = 0;
  const triggeredToolIds: ToolId[] = [];
  let undoRequests = 0;

  const commandHandlers = createWorkbenchShortcutCommandHandlers({
    activeCommand: null,
    activeReferencePickerFieldId: null,
    activateTool: (toolId, _metadata) => {
      triggeredToolIds.push(toolId);
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
    get redoRequests() {
      return redoRequests;
    },
    press(event: ShortcutResolverEvent) {
      return resolver.handleKeyDown(event, {
        activeScopes: getWorkbenchShortcutActiveScopes(mode),
        executeCommand: (command) => commandHandlers[command.id]?.execute(),
        isCommandEnabled: (command, target) =>
          commandHandlers[command.id]?.isEnabled?.(target) ??
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

/** An armed Line with a committed segment: its chain is active (T11h). */
function createLineChainSession() {
  return {
    ...createSketchSession("line"),
    status: "drawing",
    pointerDownPoint: [10, 0],
    toolChain: {
      start: { pointId: "sketch_point_1", position: [0, 0] },
      segments: [
        {
          entityId: "sketch_entity_1",
          startPointId: "sketch_point_1",
          endPointId: "sketch_point_2",
        },
      ],
    },
  } as EditorViewState["sketchSession"];
}

function createTextTarget(target: {
  isContentEditable?: true;
  tagName?: string;
}) {
  return target as EventTarget;
}

function createToolbarButtonTarget() {
  return createTarget([
    { tagName: "BUTTON" },
    { tagName: "DIV", role: "toolbar" },
  ]);
}

/** A button whose ancestor carries `role`. */
function createButtonInsideRoleTarget(role: "menu" | "dialog") {
  return createTarget([
    { tagName: "BUTTON", role: role === "menu" ? "menuitem" : undefined },
    { tagName: "DIV", role },
  ]);
}

/**
 * A fake element: `path` is the element then its ancestors. `closest`
 * matches tag (`button`) and role (`[role="toolbar"]`) selector lists, like
 * `Element.closest`.
 */
function createTarget(path: readonly { tagName: string; role?: string }[]) {
  return {
    tagName: path[0]!.tagName,
    closest: (selectors: string) =>
      path.find((node) =>
        selectors
          .split(",")
          .map((selector) => selector.trim())
          .some(
            (selector) =>
              selector === node.tagName.toLowerCase() ||
              (node.role !== undefined && selector === `[role="${node.role}"]`),
          ),
      ) ?? null,
  } as unknown as EventTarget;
}
