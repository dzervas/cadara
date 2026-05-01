import type {
  AuthoringReopenRequestedEvent,
  EditorEvent,
  EditorViewState,
} from '@/domain/editor/state-machine'
import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { PrimitiveRef, SelectionFilter } from '@/core/editor/schema'
import { getRegisteredFeatureAuthoringDefinitions } from '@/core/feature-authoring/registry'
import {
  getActiveSketchStyleToolId,
  isSketchConstructionSelected,
  type SketchAuthoringToolId,
  type SketchSessionStatus,
} from '@/domain/editor/sketch-session'
import { isRegisteredSketchEditToolId } from '@/core/sketch-edit-tools/registry'
import { isRegisteredSketchConstraintToolId } from '@/core/sketch-constraints/registry'
import { isRegisteredSketchToolId } from '@/core/sketch-tools/registry'

export function getNavigationReopenRequest(
  snapshot: WorkspaceSnapshot | null,
  target: PrimitiveRef,
): AuthoringReopenRequestedEvent | null {
  if (target.kind === 'sketch') {
    return {
      type: 'authoring.reopenRequested',
      target,
      toolId: 'sketch',
    }
  }

  if (target.kind !== 'feature' || !snapshot) {
    return null
  }

  const feature = snapshot.document.features.find((entry) => entry.featureId === target.featureId)

  if (!feature) {
    return null
  }

  const featureDefinition = getRegisteredFeatureAuthoringDefinitions().find(
    (entry) => entry.metadata.toolId === feature.definition.kind,
  )

  if (!featureDefinition) {
    return null
  }

  return {
    type: 'authoring.reopenRequested',
    target,
    toolId: featureDefinition.metadata.toolId,
  }
}

export function getEscapeEvent(
  state: Pick<EditorViewState, 'activeCommand' | 'activeReferencePickerFieldId' | 'selection' | 'sketchSession'>,
): EditorEvent | null {
  if (state.activeReferencePickerFieldId) {
    return { type: 'form.referencePickerCancelled' }
  }

  if (
    state.sketchSession?.activeTool
    || (state.sketchSession && isSketchConstructionSelected(state.sketchSession))
    || (state.sketchSession && getActiveSketchStyleToolId(state.sketchSession))
  ) {
    return { type: 'sketch.activeToolCleared' }
  }

  if (!state.sketchSession && state.activeCommand) {
    return {
      type: 'command.cancelled',
      commandSessionId: state.activeCommand.commandSessionId,
    }
  }

  if (state.selection.length > 0) {
    return { type: 'selection.cleared' }
  }

  return null
}

export function shouldViewportClickRequestSelection(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
) {
  return activeSketchTool == null
    || activeSketchTool === 'construction'
    || activeSketchTool === 'projectReference'
    || isRegisteredSketchEditToolId(activeSketchTool)
    || isRegisteredSketchConstraintToolId(activeSketchTool)
}

export function shouldViewportStartSketchGeometryDrag(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
  sketchStatus: SketchSessionStatus | null | undefined,
) {
  if (sketchStatus !== 'idle') {
    return false
  }

  return activeSketchTool == null || isRegisteredSketchToolId(activeSketchTool)
}

export function shouldViewportDoubleClickRequestConnectedSketchSelection({
  activeSketchTool,
  sketchStatus,
  target,
}: {
  activeSketchTool: SketchAuthoringToolId | null | undefined
  sketchStatus: SketchSessionStatus | null | undefined
  target: PrimitiveRef | null
}) {
  if (target?.kind !== 'sketchEntity') {
    return false
  }

  return activeSketchTool == null
    || (sketchStatus === 'idle' && isRegisteredSketchToolId(activeSketchTool))
}

export function shouldViewportClickEventRequestConnectedSketchSelection({
  activeSketchTool,
  clickDetail,
  sketchStatus,
  target,
}: {
  activeSketchTool: SketchAuthoringToolId | null | undefined
  clickDetail: number
  sketchStatus: SketchSessionStatus | null | undefined
  target: PrimitiveRef | null
}) {
  return clickDetail > 1
    && shouldViewportDoubleClickRequestConnectedSketchSelection({
      activeSketchTool,
      sketchStatus,
      target,
    })
}

export type ViewportCanvasClickIntent = 'clearSelection' | 'ignore' | 'selectTarget'

export function getViewportCanvasClickIntent({
  activeSketchTool,
  hasResolvedTarget,
  isBackgroundDatumTarget = false,
  selectionFilterKind = null,
}: {
  activeSketchTool: SketchAuthoringToolId | null | undefined
  hasResolvedTarget: boolean
  isBackgroundDatumTarget?: boolean
  selectionFilterKind?: SelectionFilter['kind'] | null
}): ViewportCanvasClickIntent {
  if (
    !hasResolvedTarget
    || (isBackgroundDatumTarget && shouldTreatBackgroundDatumClickAsEmpty(activeSketchTool, selectionFilterKind))
  ) {
    return 'clearSelection'
  }

  return shouldViewportClickRequestSelection(activeSketchTool) ? 'selectTarget' : 'ignore'
}

function shouldTreatBackgroundDatumClickAsEmpty(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
  selectionFilterKind: SelectionFilter['kind'] | null,
) {
  if (selectionFilterKind === 'sketchStart' || selectionFilterKind === 'planeReferences') {
    return false
  }

  return activeSketchTool !== 'construction'
}
