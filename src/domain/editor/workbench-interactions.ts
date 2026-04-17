import type {
  AuthoringReopenRequestedEvent,
  EditorEvent,
  EditorViewState,
} from '@/contracts/editor/state-machine'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import { getRegisteredFeatureAuthoringDefinitions } from '@/domain/feature-authoring/registry'
import {
  isSketchConstructionSelected,
  type SketchAuthoringToolId,
  type SketchSessionStatus,
} from '@/domain/editor/sketch-session'
import { isRegisteredSketchConstraintToolId } from '@/domain/sketch-constraints/registry'

export function getNavigationReopenRequest(
  snapshot: DocumentSnapshot | null,
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
  state: Pick<EditorViewState, 'activeCommand' | 'activeReferencePickerFieldId' | 'sketchSession'>,
): EditorEvent | null {
  if (state.activeReferencePickerFieldId) {
    return { type: 'form.referencePickerCancelled' }
  }

  if (state.sketchSession?.activeTool || (state.sketchSession && isSketchConstructionSelected(state.sketchSession))) {
    return { type: 'sketch.activeToolCleared' }
  }

  if (state.sketchSession && state.activeCommand) {
    return {
      type: 'command.cancelled',
      commandSessionId: state.activeCommand.commandSessionId,
    }
  }

  return null
}

export function shouldViewportClickRequestSelection(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
) {
  return activeSketchTool == null || activeSketchTool === 'construction' || isRegisteredSketchConstraintToolId(activeSketchTool)
}

export function shouldViewportStartSketchGeometryDrag(
  activeSketchTool: SketchAuthoringToolId | null | undefined,
  sketchStatus: SketchSessionStatus | null | undefined,
) {
  if (sketchStatus === 'drawing') {
    return false
  }

  return activeSketchTool == null || (activeSketchTool !== 'construction' && !isRegisteredSketchConstraintToolId(activeSketchTool))
}
