import type {
  EditorEvent,
  EditorViewState,
} from "@/domain/editor/state-machine";
import {
  computeSketchCloseSplineState,
  isEditableSketchGeometrySelection,
} from "@/core/editor/sketch-session";
import {
  getEnterEvent,
  getEscapeEvent,
} from "@/domain/editor/workbench-interactions";
import {
  getToolCommandId,
  type ShortcutScope,
} from "@/core/shortcuts/commands";
import { toolDefinitions } from "@/core/tools/tool-registry";
import type { WorkbenchCommandHandlers } from "@/hooks/workbench-command-context";
import type { ShortcutCommandHandlers } from "@/hooks/shortcut-provider";

export interface WorkbenchShortcutHandlerOptions {
  activeCommand: EditorViewState["activeCommand"];
  activeReferencePickerFieldId: EditorViewState["activeReferencePickerFieldId"];
  canRedo?: boolean;
  canUndo?: boolean;
  dispatch: (event: EditorEvent) => void;
  focusSearch?: () => void;
  mode: EditorViewState["mode"];
  requestRedo?: () => void;
  requestUndo?: () => void;
  selection: EditorViewState["selection"];
  sketchSession: EditorViewState["sketchSession"];
  /** T14c: a retained annotation context is Escape's second stage. */
  annotationContext?: EditorViewState["annotationContext"];
  activateTool: WorkbenchCommandHandlers["activateTool"];
}

export function getWorkbenchShortcutActiveScopes(
  mode: EditorViewState["mode"],
): readonly ShortcutScope[] {
  return ["global", mode];
}

export function createWorkbenchShortcutCommandHandlers({
  activeCommand,
  activeReferencePickerFieldId,
  canRedo = true,
  canUndo = true,
  dispatch,
  focusSearch = focusWorkbenchSearch,
  mode,
  requestRedo,
  requestUndo,
  selection,
  sketchSession,
  annotationContext = null,
  activateTool,
}: WorkbenchShortcutHandlerOptions): ShortcutCommandHandlers {
  const commandHandlers: ShortcutCommandHandlers = {
    "editor.cancel": {
      execute: () => {
        const escapeEvent = getEscapeEvent({
          activeCommand,
          activeReferencePickerFieldId,
          selection,
          sketchSession,
          annotationContext,
        });

        if (escapeEvent) {
          dispatch(escapeEvent);
        }
      },
      isEnabled: () =>
        getEscapeEvent({
          activeCommand,
          activeReferencePickerFieldId,
          selection,
          sketchSession,
          annotationContext,
        }) !== null,
    },
    // Enabled only when it applies, so an unused Enter keeps its native
    // behaviour; when it applies the resolver consumes it, so a focused
    // toolbar button is not activated too (review A-5(a)). Enter on any other
    // button, a menu item (the pick chooser, a toolbar dropdown) or in a
    // dialog is that control's own (T11g review V-1, T11h review A-3).
    "editor.confirm": {
      execute: () => {
        const enterEvent = getEnterEvent({ sketchSession });

        if (enterEvent) {
          dispatch(enterEvent);
        }
      },
      isEnabled: (target) =>
        !isNativeEnterTarget(target) &&
        getEnterEvent({ sketchSession }) !== null,
    },
    "editor.redo": {
      execute: () => {
        requestRedo?.();
      },
      isEnabled: () => canRedo,
    },
    "editor.undo": {
      execute: () => {
        requestUndo?.();
      },
      isEnabled: () => canUndo,
    },
    "editor.deleteSelection": {
      execute: () => dispatch({ type: "sketch.annotationDeleteRequested" }),
      isEnabled: () =>
        sketchSession !== null &&
        (selection[0]?.kind === "constraint" ||
          selection[0]?.kind === "dimension" ||
          selection[0]?.kind === "projectedReferenceGeometry" ||
          selection[0]?.kind === "sketchExternalReference" ||
          isEditableSketchGeometrySelection(sketchSession, selection)),
    },
    "editor.focusSearch": {
      execute: focusSearch,
      isEnabled: () => true,
    },
  };

  // T12e: tangent selection-context commands (no default shortcut, sketch scope).
  // A2: disabled during drags, active tools, annotation editing, and when
  // neither tangent action is enabled for the current selection.
  const tangentCommandEnabled = () =>
    sketchSession !== null &&
    mode === "sketch" &&
    !sketchSession.activeDrag &&
    !sketchSession.activeTool &&
    !sketchSession.activeAnnotationEdit;
  commandHandlers["sketch.resetTangentToAutomatic"] = {
    execute: () =>
      dispatch({
        type: "sketch.toolPatched",
        patch: { intent: "resetTangentToAutomatic" },
      }),
    isEnabled: tangentCommandEnabled,
  };
  commandHandlers["sketch.setTangentToZero"] = {
    execute: () =>
      dispatch({
        type: "sketch.toolPatched",
        patch: { intent: "setTangentToZero" },
      }),
    isEnabled: tangentCommandEnabled,
  };

  // T17c2 ([TECH] T17-16): Close spline (no default shortcut, sketch scope),
  // enabled exactly when the panel's Close spline is.
  commandHandlers["sketch.closeSpline"] = {
    execute: () =>
      dispatch({
        type: "sketch.toolPatched",
        patch: { intent: "closeSpline" },
      }),
    isEnabled: () =>
      sketchSession !== null &&
      mode === "sketch" &&
      computeSketchCloseSplineState(sketchSession, selection)?.refusal === null,
  };

  for (const tool of toolDefinitions) {
    commandHandlers[getToolCommandId(tool.id)] = {
      execute: () => {
        void activateTool(tool.id, { source: "shortcut" });
      },
      isEnabled: () =>
        (tool.modes as readonly (typeof mode)[]).includes(mode) &&
        (tool.id !== "finishSketch" || sketchSession !== null) &&
        (tool.id !== "sketch" || sketchSession === null),
    };
  }

  return commandHandlers;
}

function isNativeEnterTarget(target: EventTarget | null | undefined) {
  const element = target as {
    closest?: (selector: string) => unknown;
  } | null;
  if (typeof element?.closest !== "function") {
    return false;
  }

  return (
    element.closest('[role="menu"], [role="dialog"]') !== null ||
    (element.closest('button, [role="button"]') !== null &&
      element.closest('[role="toolbar"]') === null)
  );
}

function focusWorkbenchSearch() {
  if (typeof document === "undefined") {
    return;
  }

  const searchInput = document.querySelector<HTMLInputElement>(
    'input[data-workbench-command="editor.focusSearch"], [data-workbench-command="editor.focusSearch"] input',
  );
  searchInput?.focus();
}
