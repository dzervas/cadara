import {
  buildFeatureDefinition,
  createCommitMissingInputsDiagnostics,
  createPreviewMissingInputsDiagnostics,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import {
  updateSketchReferenceProjection,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import {
  buildSketchPlaneCommitRequest,
  hasSketchPlaneEditChanges,
} from '@/domain/editor/sketch-plane-editing'
import {
  getSketchSpecialModeSelectionFilter,
  resolveSketchSpecialModeEffectRequest,
} from '@/core/sketch-special-modes/presentation'
import { getDefaultSelectionFilterForMode } from '@/core/editor/schema'
import type { DocumentFeatureCursor, SnapshotMutationBasis } from '@/contracts/modeling/schema'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import type { CommandSessionId } from '@/contracts/shared/ids'
import type { FeatureId, RequestId } from '@/contracts/shared/ids'
import type { EditorExtensionDependencies } from './dependencies'
import { advanceCursorPhase } from './cursor-lifecycle'
import { hasPendingDocumentCursorRefresh } from './document-helpers'
import { nextRequestId } from './utility-helpers'
import { toIdleState, withPreview } from './state-creators'
import type {
  EditorState,
  EditorTransitionResult,
  FeatureEditorState,
  SelectionCommandEditorState,
  SketchEditorState,
  SketchPlaneEditorState,
} from './types'

export function emitSnapshotFetch(
  state: EditorState,
  commandSessionId: CommandSessionId | null,
  options: { preserveRenderRecordsOnFeatureDiagnostics?: boolean } = {},
): EditorTransitionResult {
  const requestId = nextRequestId(state, 'snapshot')

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingSnapshotRequestId: requestId,
    },
    effects: [
      {
        type: 'document.fetchSnapshot',
        requestId,
        documentId: state.document.documentId,
        revisionId: state.document.revisionId,
        commandSessionId,
        preserveRenderRecordsOnFeatureDiagnostics: options.preserveRenderRecordsOnFeatureDiagnostics,
      },
    ],
  }
}

export function getSnapshotMutationBasis(state: EditorState): SnapshotMutationBasis | null {
  const baseRevisionId = state.document.revisionId
  if (baseRevisionId === null) {
    return null
  }

  const repositoryHeads =
    state.snapshot?.document.revisionId === baseRevisionId
      ? state.snapshot.provenance?.repositoryHeads
      : undefined

  return repositoryHeads
    ? { baseRevisionId, baseRepositoryHeads: [...repositoryHeads] }
    : { baseRevisionId }
}

export function emitDocumentCursorMove(
  state: EditorState,
  cursor: DocumentFeatureCursor,
  transient: boolean,
): EditorTransitionResult {
  const mutationBasis = getSnapshotMutationBasis(state)
  if (state.document.documentId === null || mutationBasis === null || hasPendingDocumentCursorRefresh(state)) {
    return {
      state,
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'document-cursor')

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingHistoryCursorRequestId: requestId,
    },
    effects: [
      {
        type: 'document.moveHistoryCursor',
        requestId,
        documentId: state.document.documentId,
        baseRevisionId: mutationBasis.baseRevisionId,
        mutationBasis,
        cursor,
        transient,
      },
    ],
  }
}

export function emitEditSessionCursorRestore(state: EditorState): EditorTransitionResult {
  const context = state.editSessionCursorContext

  if (!context) {
    return {
      state,
      effects: [],
    }
  }

  const restoreContext =
    context.phase === 'active'
      ? advanceCursorPhase(context, 'commitCompleted') ?? context
      : context
  const restoringContext = advanceCursorPhase(restoreContext, 'restoreStarted')

  return emitDocumentCursorMove(
    withPreview(
      {
        ...state,
        editSessionCursorContext: restoringContext,
      },
      {
        kind: 'selection',
        label: 'Restoring document cursor',
        target: state.selection[0] ?? null,
      },
    ),
    context.restoreCursor,
    true,
  )
}

export function emitFeaturePreview(state: FeatureEditorState): EditorTransitionResult {
  if (state.document.revisionId === null) {
    return {
      state,
      effects: [],
    }
  }

  if (state.document.documentId === null) {
    return {
      state,
      effects: [],
    }
  }

  const definition = buildFeatureDefinition(state.session)

  if (!definition) {
    return {
      state: {
        ...state,
        pendingPreviewRequestId: null,
        session: {
          ...state.session,
          status: 'idle',
          diagnostics: createPreviewMissingInputsDiagnostics(state.session),
        },
      },
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'feature-preview')
  const draftSession: FeatureEditSessionState = {
    ...state.session,
    status: 'previewing',
    diagnostics: [],
  }

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingPreviewRequestId: requestId,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      session: draftSession,
    },
    effects: [
      {
        type: 'feature.evaluatePreview',
        requestId,
        commandSessionId: state.command.commandSessionId,
        documentId: state.document.documentId,
        baseRevisionId: state.document.revisionId,
        featureSession: draftSession,
      },
    ],
  }
}

export function emitFeatureCommit(state: FeatureEditorState): EditorTransitionResult {
  const mutationBasis = getSnapshotMutationBasis(state)
  if (mutationBasis === null) {
    return {
      state,
      effects: [],
    }
  }

  if (state.document.documentId === null) {
    return {
      state,
      effects: [],
    }
  }

  const definition = buildFeatureDefinition(state.session)

  if (!definition) {
    return {
      state: {
        ...state,
        session: {
          ...state.session,
          status: 'idle',
          diagnostics: createCommitMissingInputsDiagnostics(state.session),
        },
      },
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'feature-commit')
  const draftSession: FeatureEditSessionState = {
    ...state.session,
    status: 'submitting',
  }

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingCommitRequestId: requestId,
      pendingPreviewRequestId: null,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      session: draftSession,
    },
    effects: [
      {
        type: 'feature.commit',
        requestId,
        commandSessionId: state.command.commandSessionId,
        documentId: state.document.documentId,
        baseRevisionId: mutationBasis.baseRevisionId,
        mutationBasis,
        featureSession: draftSession,
      },
    ],
  }
}

export function emitSketchPlaneCommit(state: SketchPlaneEditorState): EditorTransitionResult {
  const mutationBasis = getSnapshotMutationBasis(state)
  if (
    mutationBasis === null
    || state.document.documentId === null
    || !hasSketchPlaneEditChanges(state.session)
    || !buildSketchPlaneCommitRequest(state.session)
  ) {
    return {
      state,
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'sketch-plane-commit')
  const draftSession = {
    ...state.session,
    status: 'submitting' as const,
  }

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingCommitRequestId: requestId,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      session: draftSession,
    },
    effects: [
      {
        type: 'sketchPlane.commit',
        requestId,
        commandSessionId: state.command.commandSessionId,
        documentId: state.document.documentId,
        baseRevisionId: mutationBasis.baseRevisionId,
        mutationBasis,
        session: draftSession,
      },
    ],
  }
}

export function emitSketchOpen(
  state: SelectionCommandEditorState,
  selection: readonly import('@/core/editor/schema').PrimitiveRef[],
): EditorTransitionResult {
  if (state.document.documentId === null || state.document.revisionId === null) {
    return {
      state: withPreview(state, {
        kind: 'selection',
        label: 'Sketch session requires a loaded document snapshot.',
        target: selection[0] ?? null,
      }),
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'sketch-open')

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingRequestId: requestId,
      selection: [...selection],
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      preview: {
        kind: 'selection',
        label: 'Opening sketch session',
        target: selection[0] ?? null,
      },
    },
    effects: [
      {
        type: 'sketch.openSession',
        requestId,
        commandSessionId: state.command.commandSessionId,
        selection,
        documentId: state.document.documentId,
        revisionId: state.document.revisionId,
      },
    ],
  }
}

export function emitFeatureHydration(
  state: SelectionCommandEditorState,
  selectedFeatureId: FeatureId,
): EditorTransitionResult {
  if (state.document.documentId === null || state.document.revisionId === null) {
    return {
      state: withPreview(state, {
        kind: 'selection',
        label: 'Feature editing requires a loaded document snapshot.',
        target: state.selection[0] ?? null,
      }),
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'feature-hydrate')

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingRequestId: requestId,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      preview: {
        kind: 'selection',
        label: `Opening feature ${selectedFeatureId}`,
        target: state.selection[0] ?? null,
      },
    },
    effects: [
      {
        type: 'feature.hydrateFromSelection',
        requestId,
        commandSessionId: state.command.commandSessionId,
        documentId: state.document.documentId,
        revisionId: state.document.revisionId,
        selectedFeatureId,
      },
    ],
  }
}

export function emitSketchCommit(state: SketchEditorState): EditorTransitionResult {
  const mutationBasis = getSnapshotMutationBasis(state)
  if (!state.session.commitRequest || mutationBasis === null) {
    if (state.editSessionCursorContext?.phase === 'active') {
      return emitEditSessionCursorRestore(toIdleState(state, 'part'))
    }

    return {
      state: toIdleState(state, 'part'),
      effects: [],
    }
  }

  if (state.document.documentId === null) {
    return {
      state,
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'sketch-commit')

  return {
    state: {
      ...state,
      mode: 'sketch',
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingCommitRequestId: requestId,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      preview: {
        kind: 'sketch',
        label: 'Committing accepted sketch geometry',
        target: state.session.planeTarget,
      },
    },
    effects: [
      {
        type: 'sketch.commit',
        requestId,
        commandSessionId: state.command.commandSessionId,
        documentId: state.document.documentId,
        baseRevisionId: mutationBasis.baseRevisionId,
        mutationBasis,
        session: state.session,
      },
    ],
  }
}

export function emitSketchReferenceProjection(state: SketchEditorState, session: SketchSessionState): EditorTransitionResult {
  if (
    session.definition.references.length === 0
    || state.document.documentId === null
    || state.document.revisionId === null
  ) {
    return {
      state: {
        ...state,
        session: updateSketchReferenceProjection(session, [], []),
        pendingProjectionRequestId: null,
      },
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'sketch-reference-projection')

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      session,
      pendingProjectionRequestId: requestId,
    },
    effects: [
      {
        type: 'sketch.projectReferences',
        requestId,
        commandSessionId: state.command.commandSessionId,
        documentId: state.document.documentId,
        baseRevisionId: state.document.revisionId,
        session,
      },
    ],
  }
}

export function emitSketchReferenceImageImportWithPayloads(
  state: SketchEditorState,
  payloads: readonly ReferenceImagePayload[],
): EditorTransitionResult {
  const mutationBasis = getSnapshotMutationBasis(state)

  if (
    state.document.documentId === null
    || state.document.revisionId === null
    || mutationBasis === null
    || payloads.length === 0
  ) {
    return {
      state,
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'sketch-reference-image-import')

  return {
    state: {
      ...state,
      nextRequestSequence: state.nextRequestSequence + 1,
      pendingImportRequestId: requestId,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      preview: {
        kind: 'sketch',
        label: 'Import reference images',
        target: state.session.planeTarget,
      },
    },
    effects: [{
      type: 'sketch.importReferenceImages',
      requestId,
      commandSessionId: state.command.commandSessionId,
      documentId: state.document.documentId,
      baseRevisionId: state.document.revisionId,
      mutationBasis,
      session: state.session,
      payloads: [...payloads],
    }],
  }
}

export function emitSketchSpecialModeEffect(
  state: SketchEditorState,
  session: SketchSessionState,
  requestId: RequestId,
  dependencies: EditorExtensionDependencies,
): EditorTransitionResult {
  const effect = resolveSketchSpecialModeEffectRequest(session)

  if (
    !effect
    || session.activeSpecialMode?.pendingEffect?.requestId !== requestId
    || state.document.documentId === null
    || state.document.revisionId === null
  ) {
    return {
      state: {
        ...state,
        session,
        selectionFilter:
          getSketchSpecialModeSelectionFilter(session, dependencies.sketchSpecialModes)
          ?? getDefaultSelectionFilterForMode('sketch'),
        command: {
          ...state.command,
          phase: 'editing',
        },
      },
      effects: [],
    }
  }

  return {
    state: {
      ...state,
      session,
      selectionFilter:
        getSketchSpecialModeSelectionFilter(session, dependencies.sketchSpecialModes)
        ?? getDefaultSelectionFilterForMode('sketch'),
      nextRequestSequence: state.nextRequestSequence + 1,
      command: {
        ...state.command,
        phase: 'awaitingEffect',
      },
      preview: {
        kind: 'sketch',
        label: `Running ${effect.effectId}`,
        target: state.session.planeTarget,
      },
    },
    effects: [
      {
        type: 'sketch.specialModeEffect',
        requestId,
        commandSessionId: state.command.commandSessionId,
        documentId: state.document.documentId,
        baseRevisionId: state.document.revisionId,
        modeId: session.activeSpecialMode?.modeId ?? 'unknown',
        effectId: effect.effectId,
        kind: effect.kind,
        payload: effect.payload,
      },
    ],
  }
}
