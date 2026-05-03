import type {
  PersistedSketchDraftSession,
  PersistedSketchHistoryCursor,
  PersistedSketchHistoryOperation,
} from '@/contracts/modeling/durable-history'
import type { SketchSessionState } from './types'
import { updateSketchReferenceProjection } from './references'

export function persistSketchDraftSession(
  session: SketchSessionState,
): PersistedSketchDraftSession {
  return {
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: structuredClone(session.plane),
    definition: structuredClone(session.definition),
    fullDefinition: structuredClone(session.fullDefinition),
    historyCursor: structuredClone(session.historyCursor) as PersistedSketchHistoryCursor,
    historyOperations: structuredClone(session.historyOperations) as PersistedSketchHistoryOperation[],
    sequence: session.sequence,
    commitRequest: structuredClone(session.commitRequest),
  }
}

export function restorePersistedSketchDraftSession(
  session: PersistedSketchDraftSession,
): SketchSessionState {
  const restored: SketchSessionState = {
    sketchId: session.sketchId,
    sketchLabel: session.sketchLabel,
    plane: structuredClone(session.plane),
    planeTarget: structuredClone(session.plane.support),
    planeKey: session.plane.key ?? null,
    toolStagedEntities: [],
    definition: structuredClone(session.definition),
    fullDefinition: structuredClone(session.fullDefinition),
    historyCursor: structuredClone(session.historyCursor),
    historyOperations: structuredClone(session.historyOperations),
    activeTool: null,
    status: 'idle',
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeSpecialMode: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
    sequence: session.sequence,
    solvedRegions: [],
    projectedReferences: [],
    projectionDiagnostics: [],
    commitRequest: structuredClone(session.commitRequest),
    validationMessage: null,
  }

  return updateSketchReferenceProjection(restored, [], [])
}

