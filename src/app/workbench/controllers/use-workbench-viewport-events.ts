import { useMemo } from 'react'

import type { EditorEvent, EditorViewState } from '@/contracts/editor/state-machine'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { getNavigationReopenRequest } from '@/domain/editor/workbench-interactions'
import type { SketchSpecialModeHandleRef } from '@/domain/sketch-special-modes/schema'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'
import type { ModelingService } from '@/domain/modeling/modeling-service'

interface WorkbenchViewportEventsInput {
  activeCommand: EditorViewState['activeCommand']
  dispatch: (event: EditorEvent) => void
  modelingService: Pick<ModelingService, 'setViewportLodTier'>
  snapshot: DocumentSnapshot | null
}

export function useWorkbenchViewportEvents({
  activeCommand,
  dispatch,
  modelingService,
  snapshot,
}: WorkbenchViewportEventsInput) {
  return useMemo(() => ({
    handleNavigationReopen(target: PrimitiveRef) {
      const reopenEvent = getNavigationReopenRequest(snapshot, target)

      if (!reopenEvent) {
        return
      }

      dispatch(reopenEvent)
    },
    handleSectionClear() {
      if (!activeCommand) {
        return
      }

      dispatch({
        type: 'section.cleared',
        commandSessionId: activeCommand.commandSessionId,
      })
    },
    handleSectionFlip() {
      if (!activeCommand) {
        return
      }

      dispatch({
        type: 'section.flipRequested',
        commandSessionId: activeCommand.commandSessionId,
      })
    },
    handleSectionOffsetChange(offset: number) {
      if (!activeCommand) {
        return
      }

      dispatch({
        type: 'section.offsetUpdated',
        commandSessionId: activeCommand.commandSessionId,
        offset,
      })
    },
    handleShellSelect(target: PrimitiveRef) {
      dispatch({ type: 'viewport.selectionRequested', target })
      dispatch({ type: 'viewport.hoverCleared' })
    },
    handleSketchGeometryDragEnd(point: readonly [number, number]) {
      dispatch({ type: 'sketch.geometryDragEnded', point })
    },
    handleSketchGeometryDragMove(point: readonly [number, number]) {
      dispatch({ type: 'sketch.geometryDragMoved', point })
    },
    handleSketchGeometryDragStart(target: PrimitiveRef, point: readonly [number, number]) {
      dispatch({ type: 'sketch.geometryDragStarted', target, point })
    },
    handleSketchMove(point: readonly [number, number]) {
      dispatch({ type: 'sketch.pointerMoved', point })
    },
    handleSketchRelease(point: readonly [number, number], target?: PrimitiveRef | null) {
      dispatch({ type: 'sketch.pointerReleased', point, target })
    },
    handleSketchSpecialModeClick(point: readonly [number, number], target?: PrimitiveRef | null) {
      dispatch({ type: 'sketch.specialModeClickRequested', point, target })
    },
    handleSketchSpecialModeDoubleClick(point: readonly [number, number], target?: PrimitiveRef | null) {
      dispatch({ type: 'sketch.specialModeDoubleClickRequested', point, target })
    },
    handleSketchSpecialModeDragEnd(handle: SketchSpecialModeHandleRef, point: readonly [number, number]) {
      dispatch({ type: 'sketch.specialModeDragEnded', handle, point })
    },
    handleSketchSpecialModeDragMove(handle: SketchSpecialModeHandleRef, point: readonly [number, number]) {
      dispatch({ type: 'sketch.specialModeDragMoved', handle, point })
    },
    handleSketchSpecialModeDragStart(handle: SketchSpecialModeHandleRef, point: readonly [number, number]) {
      dispatch({ type: 'sketch.specialModeDragStarted', handle, point })
    },
    handleViewportConnectedSketchSelect(target: PrimitiveRef) {
      dispatch({ type: 'sketch.connectedSelectionRequested', target })
    },
    handleViewportDeselect() {
      dispatch({ type: 'selection.cleared' })
    },
    handleViewportHover(target: PrimitiveRef) {
      dispatch({ type: 'viewport.hovered', target })
    },
    handleViewportHoverClear() {
      dispatch({ type: 'viewport.hoverCleared' })
    },
    handleViewportLodTierChange(tierId: OccTessellationTierId) {
      if (modelingService.setViewportLodTier(tierId)) {
        dispatch({ type: 'document.refreshRequested' })
      }
    },
    handleViewportSelect(target: PrimitiveRef, cameraPosition?: readonly [number, number, number]) {
      dispatch({ type: 'viewport.selectionRequested', target, cameraPosition })
    },
  }), [activeCommand, dispatch, modelingService, snapshot])
}
