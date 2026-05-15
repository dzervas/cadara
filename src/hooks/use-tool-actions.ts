import { useContext } from "react";

import type { ToolId } from "@/core/tools/tool-registry";
import { useEditorState } from "@/hooks/use-editor-state";
import { getToolCommandBehavior } from "@/core/tools/activation-policy";
import { supportedReferenceImageFileTypes } from "@/domain/reference-image/raster";
import { readReferenceImagePayload } from "@/domain/reference-image/import-flow";
import { WorkbenchCommandContext } from "@/hooks/workbench-command-context";
import type { WorkbenchCommandHandlers } from "@/hooks/workbench-command-context";
import { showOpenImportFilePicker } from "@/lib/import-file-picker";

type ToolActionCommandHandlers = Pick<
  WorkbenchCommandHandlers,
  "requestPartImport" | "requestRedo" | "requestUndo"
>;

interface ToolActionsOptions {
  commandHandlers?: ToolActionCommandHandlers | null;
}

export function useToolActions(options: ToolActionsOptions = {}) {
  const contextCommandHandlers = useContext(WorkbenchCommandContext);
  const commandHandlers = options.commandHandlers ?? contextCommandHandlers;
  const { machineState, dispatch } = useEditorState();
  const canImportReferenceImage =
    machineState.kind === "editingSketch" ||
    (machineState.kind === "selectionCommand" &&
      machineState.command.toolId === "sketch");

  return {
    async triggerTool(toolId: ToolId) {
      const commandBehavior = getToolCommandBehavior(toolId);

      if (commandBehavior === "undo") {
        if (commandHandlers) {
          commandHandlers.requestUndo();
        } else if (machineState.kind === "editingSketch") {
          dispatch({ type: "history.undoRequested" });
        }
        return;
      }

      if (commandBehavior === "redo") {
        if (commandHandlers) {
          commandHandlers.requestRedo();
        } else if (machineState.kind === "editingSketch") {
          dispatch({ type: "history.redoRequested" });
        }
        return;
      }

      if (commandBehavior === "partImport") {
        if (commandHandlers) {
          void commandHandlers.requestPartImport();
        }
        return;
      }

      if (commandBehavior === "sketchReferenceImageImport") {
        if (!canImportReferenceImage) {
          return;
        }

        dispatch({
          type: "tool.activated",
          toolId,
        });

        const pickerResult = await showOpenImportFilePicker({
          acceptedFileTypes: supportedReferenceImageFileTypes,
          multiple: true,
        });

        if (!pickerResult.ok) {
          dispatch({
            type: "sketch.referenceImagePayloadsPicked",
            payloads: null,
            message:
              pickerResult.reason === "failed"
                ? "Reference-image selection failed."
                : undefined,
          });
          return;
        }

        try {
          const payloads = await Promise.all(
            pickerResult.files.map((file) => readReferenceImagePayload(file)),
          );
          dispatch({
            type: "sketch.referenceImagePayloadsPicked",
            payloads,
          });
        } catch (error: unknown) {
          dispatch({
            type: "sketch.referenceImagePayloadsPicked",
            payloads: null,
            message:
              error instanceof Error
                ? error.message
                : "Reference-image import failed.",
          });
        }
        return;
      }

      dispatch({
        type: "tool.activated",
        toolId,
      });
    },
  };
}
