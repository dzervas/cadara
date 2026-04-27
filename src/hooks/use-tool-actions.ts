import { ToolActionContext } from '@/hooks/tool-action-context'
import { createRequiredContextHook } from '@/hooks/create-required-context-hook'
import type { ToolId } from '@/domain/tools/tool-registry'
import type { ToolTriggerMetadata } from '@/domain/tools/schema'
import { useEditorState } from '@/hooks/use-editor-state'
import { isRegisteredSketchToolId } from '@/domain/sketch-tools/registry'
import { isRegisteredSketchConstraintToolId } from '@/domain/sketch-constraints/registry'
import { isRegisteredSketchEditToolId } from '@/domain/sketch-edit-tools/registry'
import { supportedReferenceImageFileTypes } from '@/domain/reference-image/raster'
import { showOpenImportFilePicker } from '@/lib/import-file-picker'
import { readReferenceImagePayload } from '@/app/sketch-image-import-flow'

const useRequiredToolActionContext = createRequiredContextHook(
  ToolActionContext,
  'useToolActionContext',
  'ToolActionProvider',
)

export function useToolActionBus() {
  return useRequiredToolActionContext().actionBus
}

export function useToolActions() {
  const { actionBus } = useRequiredToolActionContext()
  const {
    machineState,
    dispatch,
  } = useEditorState()
  const canImportReferenceImage =
    machineState.kind === 'editingSketch'
    || (machineState.kind === 'selectionCommand' && machineState.command.toolId === 'sketch')

  return {
    async triggerTool(toolId: ToolId, metadata: ToolTriggerMetadata) {
      if (toolId === 'undo') {
        if (machineState.kind === 'editingSketch') {
          dispatch({ type: 'history.undoRequested' })
        }
        actionBus.triggerTool(toolId, machineState.mode, metadata)
        return
      }

      if (toolId === 'redo') {
        if (machineState.kind === 'editingSketch') {
          dispatch({ type: 'history.redoRequested' })
        }
        actionBus.triggerTool(toolId, machineState.mode, metadata)
        return
      }

      if (toolId === 'import') {
        actionBus.triggerTool(toolId, machineState.mode, metadata)
        return
      }

      if (toolId === 'importImage') {
        if (!canImportReferenceImage) {
          actionBus.triggerTool(toolId, machineState.mode, metadata)
          return
        }

        dispatch({
          type: 'tool.activated',
          toolId,
        })
        actionBus.triggerTool(toolId, machineState.mode, metadata)

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

      const nextMode =
        toolId === 'sketch'
          ? 'part'
          : isRegisteredSketchToolId(toolId)
            || isRegisteredSketchConstraintToolId(toolId)
            || isRegisteredSketchEditToolId(toolId)
            || toolId === 'dimension'
            || toolId === 'construction'
            || toolId === 'projectReference'
            || toolId === 'svgRendering'
            || toolId === 'finishSketch'
            ? 'sketch'
            : machineState.mode

      dispatch({
        type: 'tool.activated',
        toolId,
      })

      actionBus.triggerTool(toolId, nextMode, metadata)
    },
  }
}
