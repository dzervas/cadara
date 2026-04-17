import { useContext } from 'react'

import { ToolActionContext } from '@/hooks/tool-action-context'
import type { ToolId } from '@/domain/tools/tool-registry'
import type { ToolTriggerMetadata } from '@/domain/tools/schema'
import { useEditorState } from '@/hooks/use-editor-state'
import { isRegisteredSketchToolId } from '@/domain/sketch-tools/registry'
import { isRegisteredSketchConstraintToolId } from '@/domain/sketch-constraints/registry'

export function useToolActionBus() {
  const context = useContext(ToolActionContext)

  if (!context) {
    throw new Error('useToolActionBus must be used inside ToolActionProvider.')
  }

  return context.actionBus
}

export function useToolActions() {
  const context = useContext(ToolActionContext)
  const {
    machineState,
    dispatch,
  } = useEditorState()

  if (!context) {
    throw new Error('useToolActions must be used inside ToolActionProvider.')
  }

  return {
    triggerTool(toolId: ToolId, metadata: ToolTriggerMetadata) {
      if (toolId === 'undo') {
        if (machineState.kind === 'editingSketch') {
          dispatch({ type: 'history.undoRequested' })
        }
        context.actionBus.triggerTool(toolId, machineState.mode, metadata)
        return
      }

      if (toolId === 'redo') {
        if (machineState.kind === 'editingSketch') {
          dispatch({ type: 'history.redoRequested' })
        }
        context.actionBus.triggerTool(toolId, machineState.mode, metadata)
        return
      }

      const nextMode =
        toolId === 'sketch'
          ? 'part'
          : isRegisteredSketchToolId(toolId) || isRegisteredSketchConstraintToolId(toolId) || toolId === 'construction' || toolId === 'finishSketch'
            ? 'sketch'
            : machineState.mode

      dispatch({
        type: 'tool.activated',
        toolId,
      })

      context.actionBus.triggerTool(toolId, nextMode, metadata)
    },
  }
}
