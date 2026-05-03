import { useContext } from 'react'

import { ToolActionContext } from '@/hooks/tool-action-context'
import { createRequiredContextHook } from '@/hooks/create-required-context-hook'
import type { ToolId } from '@/core/tools/tool-registry'
import type { ToolTriggerMetadata } from '@/core/tools/schema'
import { useEditorState } from '@/hooks/use-editor-state'
import {
  getToolCommandBehavior,
  resolveToolActivationMode,
} from '@/core/tools/activation-policy'
import { supportedReferenceImageFileTypes } from '@/domain/reference-image/raster'
import { readReferenceImagePayload } from '@/domain/reference-image/import-flow'
import { WorkbenchCommandContext } from '@/hooks/workbench-command-context'
import type { WorkbenchCommandHandlers } from '@/hooks/workbench-command-context'
import { showOpenImportFilePicker } from '@/lib/import-file-picker'

const useRequiredToolActionContext = createRequiredContextHook(
  ToolActionContext,
  'useToolActionContext',
  'ToolActionProvider',
)

export function useToolActionBus() {
  return useRequiredToolActionContext().actionBus
}

type ToolActionCommandHandlers = Pick<
  WorkbenchCommandHandlers,
  'requestPartImport' | 'requestRedo' | 'requestUndo'
>

interface ToolActionsOptions {
  commandHandlers?: ToolActionCommandHandlers | null
}

export function useToolActions(options: ToolActionsOptions = {}) {
  const { actionBus } = useRequiredToolActionContext()
  const contextCommandHandlers = useContext(WorkbenchCommandContext)
  const commandHandlers = options.commandHandlers ?? contextCommandHandlers
  const {
    machineState,
    dispatch,
  } = useEditorState()
  const canImportReferenceImage =
    machineState.kind === 'editingSketch'
    || (machineState.kind === 'selectionCommand' && machineState.command.toolId === 'sketch')

  return {
    async triggerTool(toolId: ToolId, metadata: ToolTriggerMetadata) {
      const activationMode = resolveToolActivationMode(toolId, machineState.mode)
      const commandBehavior = getToolCommandBehavior(toolId)

      if (commandBehavior === 'undo') {
        if (commandHandlers) {
          commandHandlers.requestUndo()
        } else if (machineState.kind === 'editingSketch') {
          dispatch({ type: 'history.undoRequested' })
        }
        actionBus.triggerTool(toolId, activationMode, metadata)
        return
      }

      if (commandBehavior === 'redo') {
        if (commandHandlers) {
          commandHandlers.requestRedo()
        } else if (machineState.kind === 'editingSketch') {
          dispatch({ type: 'history.redoRequested' })
        }
        actionBus.triggerTool(toolId, activationMode, metadata)
        return
      }

      if (commandBehavior === 'partImport') {
        if (commandHandlers) {
          void commandHandlers.requestPartImport()
        }
        actionBus.triggerTool(toolId, activationMode, metadata)
        return
      }

      if (commandBehavior === 'sketchReferenceImageImport') {
        if (!canImportReferenceImage) {
          actionBus.triggerTool(toolId, activationMode, metadata)
          return
        }

        dispatch({
          type: 'tool.activated',
          toolId,
        })
        actionBus.triggerTool(toolId, activationMode, metadata)

        const pickerResult = await showOpenImportFilePicker({
          acceptedFileTypes: supportedReferenceImageFileTypes,
          multiple: true,
        })

        if (!pickerResult.ok) {
          dispatch({
            type: 'sketch.referenceImagePayloadsPicked',
            payloads: null,
            message: pickerResult.reason === 'failed' ? 'Reference-image selection failed.' : undefined,
          })
          return
        }

        try {
          const payloads = await Promise.all(pickerResult.files.map((file) => readReferenceImagePayload(file)))
          dispatch({
            type: 'sketch.referenceImagePayloadsPicked',
            payloads,
          })
        } catch (error: unknown) {
          dispatch({
            type: 'sketch.referenceImagePayloadsPicked',
            payloads: null,
            message: error instanceof Error ? error.message : 'Reference-image import failed.',
          })
        }
        return
      }

      dispatch({
        type: 'tool.activated',
        toolId,
      })

      actionBus.triggerTool(toolId, activationMode, metadata)
    },
  }
}
