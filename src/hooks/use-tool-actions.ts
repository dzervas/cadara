import { ToolActionContext } from '@/hooks/tool-action-context'
import { createRequiredContextHook } from '@/hooks/create-required-context-hook'
import type { ToolId } from '@/domain/tools/tool-registry'
import type { ToolTriggerMetadata } from '@/domain/tools/schema'
import { useEditorState } from '@/hooks/use-editor-state'
import { isRegisteredSketchToolId } from '@/domain/sketch-tools/registry'
import { isRegisteredSketchConstraintToolId } from '@/domain/sketch-constraints/registry'
import { isRegisteredSketchEditToolId } from '@/domain/sketch-edit-tools/registry'

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

  return {
    triggerTool(toolId: ToolId, metadata: ToolTriggerMetadata) {
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
