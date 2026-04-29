import type { ToolId } from '@/domain/tools/tool-registry'
import type { ToolbarMode } from '@/domain/tools/schema'
import {
  buildFeatureDefinition,
  createCommitMissingInputsDiagnostics,
  createPreviewMissingInputsDiagnostics,
  getFeatureEditorFormField,
  getFeaturePrimarySelectionTarget,
  getFeatureSessionPreviewLabel,
  getSelectionFilterForFeatureType,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import { createFeatureEditorReferenceSelectionPatch } from '@/domain/feature-authoring/form-events'
import type {
  FeatureEditorFormField,
  FeatureEditorFormSchema,
} from '@/domain/feature-authoring/form-schema'
import {
  getSketchSessionPreviewLabel,
  updateSketchReferenceProjection,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import {
  getSketchSpecialModeSelectionFilter,
  resolveSketchSpecialModeEffectRequest,
} from '@/domain/sketch-special-modes/presentation'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import type { SectionViewSession } from '@/domain/section-view/session'
import {
  defaultSelectionFilter,
  getDefaultSelectionFilterForMode,
  primitiveRefEquals,
  resolveSelectionCandidate,
  type CommandPreview,
  type PrimitiveRef,
  type SelectionFilter,
  type SelectionTargetCatalog,
} from '@/domain/editor/schema'
import { getImportProviderById } from '@/domain/import/provider-registry'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import {
  getDocumentHistoryCursorBeforeTarget,
  type DocumentHistoryOrderEntry,
} from '@/domain/modeling/document-history'
import type {
  DocumentFeatureCursor,
  DocumentSnapshot,
  ModelingDiagnostic,
  SnapshotMutationBasis,
} from '@/contracts/modeling/schema'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import { isFeatureScopedModelingDiagnostic } from '@/contracts/modeling/diagnostics'
import type { DurableRef } from '@/contracts/shared/references'
import type { SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import type {
  CommandSessionId,
  DocumentId,
  FeatureId,
  RequestId,
  RevisionId,
} from '@/contracts/shared/ids'
import {
  appErrorToModelingDiagnostic,
  normalizeUnknownError,
  type AppError,
  type AppErrorContextEntry,
} from '@/contracts/errors'
import type {
  EditorActiveCommand,
  EditorEffect,
  EditorEvent,
  EditorState,
  EditorTransitionResult,
  EditSessionCursorContext,
  FeatureEditorState,
  IdleEditorState,
  ImportEditorState,
  ImportSessionState,
  SectionViewEditorState,
  SelectionCommandEditorState,
  SketchEditorState,
  SnapshotLoadedPayload,
} from './types'

export function nextCommandSessionId(state: EditorState, toolId: ToolId) {
  return `command_${toolId}-${state.nextCommandSequence}` as CommandSessionId
}

export function nextRequestId(state: EditorState, scope: string) {
  return `request_${scope}-${state.nextRequestSequence}` as RequestId
}

export const EDITOR_SKETCH_REFERENCE_PROJECTION_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const

function createInitialState(): EditorState {
  return {
    kind: 'idle',
    mode: 'part',
    document: {
      documentId: null,
      revisionId: null,
    },
    snapshot: null,
    previewRenderables: null,
    selection: [],
    hoverTarget: null,
    selectionFilter: defaultSelectionFilter,
    selectionCatalog: null,
    preview: null,
    nextCommandSequence: 1,
    nextRequestSequence: 1,
    pendingSnapshotRequestId: null,
    pendingHistoryCursorRequestId: null,
    editSessionCursorContext: null,
  }
}

/**
 * Initial Phase 1 editor machine state.
 */
export const initialEditorState = createInitialState()

function getEditorEffectContext(effect: EditorEffect): AppErrorContextEntry[] {
  const context: AppErrorContextEntry[] = [
    { key: 'operation', value: effect.type },
    { key: 'requestId', value: effect.requestId },
  ]

  if ('documentId' in effect) {
    context.push({ key: 'documentId', value: effect.documentId })
  }

  if ('revisionId' in effect) {
    context.push({ key: 'revisionId', value: effect.revisionId })
  }

  if ('baseRevisionId' in effect) {
    context.push({ key: 'baseRevisionId', value: effect.baseRevisionId })
  }

  if ('commandSessionId' in effect) {
    context.push({ key: 'commandSessionId', value: effect.commandSessionId })
  }

  if (effect.type === 'feature.hydrateFromSelection') {
    context.push({ key: 'featureId', value: effect.selectedFeatureId })
  }

  if (effect.type === 'feature.evaluatePreview' || effect.type === 'feature.commit') {
    context.push({ key: 'previewId', value: effect.featureSession.previewId })
    if (effect.featureSession.featureId) {
      context.push({ key: 'featureId', value: effect.featureSession.featureId })
    }
  }

  if (
    effect.type === 'sketch.commit'
    || effect.type === 'sketch.projectReferences'
    || effect.type === 'sketch.importReferenceImages'
  ) {
    context.push({ key: 'sketchId', value: effect.session.sketchId })
  }

  if (effect.type === 'sketch.specialModeEffect') {
    context.push({ key: 'modeId', value: effect.modeId })
    context.push({ key: 'effectId', value: effect.effectId })
    context.push({ key: 'effectKind', value: effect.kind })
  }

  return context
}

export function createEditorEffectFailureEvent(
  effect: EditorEffect,
  error: unknown,
  fallbackMessage: string,
): EditorEvent {
  const appError = normalizeUnknownError(error, {
    code: 'editor/effect-failed',
    fallbackMessage,
    requestId: effect.requestId,
    context: getEditorEffectContext(effect),
  })

  switch (effect.type) {
    case 'document.fetchSnapshot':
      return {
        type: 'effect.snapshotFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        revisionId: effect.revisionId,
        error: appError.message,
      }
    case 'sketch.openSession':
      return {
        type: 'effect.sketchSessionOpenFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        revisionId: effect.revisionId,
        commandSessionId: effect.commandSessionId,
        message: appError.message,
      }
    case 'feature.hydrateFromSelection':
      return {
        type: 'effect.featureSessionHydrationFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        revisionId: effect.revisionId,
        commandSessionId: effect.commandSessionId,
        message: appError.message,
      }
    case 'feature.evaluatePreview':
      return {
        type: 'effect.featurePreviewFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'feature.commit':
      return {
        type: 'effect.featureCommitFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.commit':
      return {
        type: 'effect.sketchCommitFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.projectReferences':
      return {
        type: 'effect.sketchReferenceProjectionFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.importReferenceImages':
      return {
        type: 'effect.sketchReferenceImageImportFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
    case 'sketch.specialModeEffect':
      return {
        type: 'effect.sketchSpecialModeEffectFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        commandSessionId: effect.commandSessionId,
        baseRevisionId: effect.baseRevisionId,
        effectId: effect.effectId,
        message: appError.message,
      }
    case 'document.moveHistoryCursor':
      return {
        type: 'effect.documentCursorMoveFailed',
        requestId: effect.requestId,
        documentId: effect.documentId,
        baseRevisionId: effect.baseRevisionId,
        message: appError.message,
      }
  }
}

export function getAppErrorContextValue(appError: AppError, key: string) {
  return appError.context.find((entry) => entry.key === key)?.value
}

export function getAppErrorRevisionId(appError: AppError, key: string): RevisionId | undefined {
  const value = getAppErrorContextValue(appError, key)

  return typeof value === 'string' && value.startsWith('rev_') ? value as RevisionId : undefined
}

export function getAppErrorDiagnosticCode(appError: AppError) {
  const value = getAppErrorContextValue(appError, 'diagnosticCode')

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function isModelingMutationError(appError: AppError) {
  return appError.code === 'modeling/diagnostic' || appError.code === 'modeling/revision-rejected'
}

export function modelingMutationErrorToDiagnostic(appError: AppError, target?: DurableRef | null): ModelingDiagnostic {
  return appErrorToModelingDiagnostic(appError, {
    target,
    code: getAppErrorDiagnosticCode(appError),
  })
}

export function previewEquals(left: CommandPreview | null, right: CommandPreview | null) {
  if (left === right) {
    return true
  }

  if (!left || !right) {
    return left === right
  }

  const targetsMatch =
    left.target === null || right.target === null
      ? left.target === right.target
      : primitiveRefEquals(left.target, right.target)

  return left.kind === right.kind && left.label === right.label && targetsMatch
}

export function withPreview<TState extends EditorState>(state: TState, preview: CommandPreview | null): TState {
  if (previewEquals(state.preview, preview)) {
    return state
  }

  return {
    ...state,
    preview,
  }
}

export function toIdleState(state: EditorState, mode: ToolbarMode): IdleEditorState {
  return {
    kind: 'idle',
    mode,
    document: state.document,
    snapshot: state.snapshot,
    previewRenderables: null,
    selection: state.selection,
    hoverTarget: state.hoverTarget,
    selectionFilter: getDefaultSelectionFilterForMode(mode),
    selectionCatalog: state.selectionCatalog,
    preview: null,
    nextCommandSequence: state.nextCommandSequence,
    nextRequestSequence: state.nextRequestSequence,
    pendingSnapshotRequestId: state.pendingSnapshotRequestId,
    pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
    editSessionCursorContext: state.editSessionCursorContext,
  }
}

export function createCommandState(
  state: EditorState,
  toolId: ToolId,
  mode: ToolbarMode,
  selectionFilter: SelectionFilter,
  preview: CommandPreview | null,
): SelectionCommandEditorState {
  return {
    kind: 'selectionCommand',
    mode,
    document: state.document,
    snapshot: state.snapshot,
    previewRenderables: null,
    selection: state.selection,
    hoverTarget: state.hoverTarget,
    selectionFilter,
    selectionCatalog: state.selectionCatalog,
    preview,
    nextCommandSequence: state.nextCommandSequence + 1,
    nextRequestSequence: state.nextRequestSequence,
    pendingSnapshotRequestId: state.pendingSnapshotRequestId,
    pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
    editSessionCursorContext: null,
    pendingRequestId: null,
    command: {
      commandSessionId: nextCommandSessionId(state, toolId),
      toolId,
      phase: 'armed',
    },
  }
}

export function withActivationSelection<TState extends EditorState>(
  state: TState,
  selection: readonly PrimitiveRef[],
): TState {
  return {
    ...state,
    selection: [...selection],
    hoverTarget: selection[selection.length - 1] ?? null,
  }
}

export function adoptOrderedSelection(
  currentSelection: readonly PrimitiveRef[],
  tryAppend: (
    adoptedSelection: readonly PrimitiveRef[],
    target: PrimitiveRef,
  ) => PrimitiveRef[] | null,
): PrimitiveRef[] {
  const adoptedSelection: PrimitiveRef[] = []

  for (const target of currentSelection) {
    const nextSelection = tryAppend(adoptedSelection, target)

    if (!nextSelection || nextSelection.length !== adoptedSelection.length + 1) {
      return []
    }

    if (
      adoptedSelection.some((selectedTarget, index) =>
        !primitiveRefEquals(selectedTarget, nextSelection[index]!),
      )
    ) {
      return []
    }

    if (!primitiveRefEquals(nextSelection[adoptedSelection.length]!, target)) {
      return []
    }

    adoptedSelection.push(target)
  }

  return adoptedSelection
}

export function adoptSelectionForFilter(
  currentSelection: readonly PrimitiveRef[],
  selectionFilter: SelectionFilter | null,
  selectionCatalog: SelectionTargetCatalog | null,
): PrimitiveRef[] {
  return adoptOrderedSelection(
    currentSelection,
    (adoptedSelection, target) => {
      const candidate = resolveSelectionCandidate(
        selectionFilter,
        [...adoptedSelection],
        target,
        selectionCatalog,
      )

      return candidate.accepted ? candidate.nextSelection : null
    },
  )
}

export function createSelectionPreview(state: EditorState, filter: SelectionFilter | null): CommandPreview | null {
  return createSelectionPreviewForSelection(state.selection, filter)
}

export function createSelectionPreviewForSelection(
  selection: PrimitiveRef[],
  filter: SelectionFilter | null,
): CommandPreview | null {
  if (!filter) {
    return null
  }

  return {
    kind: 'selection',
    label: `Awaiting ${filter.label.toLowerCase()}`,
    target: selection[0] ?? null,
  }
}

export function createFeatureSelectionPreview(
  session: FeatureEditSessionState,
  prefix = 'Draft',
): CommandPreview {
  return {
    kind: 'selection',
    label: getFeatureSessionPreviewLabel(session, prefix),
    target: getFeaturePrimarySelectionTarget(session),
  }
}

export function createFeatureEditingState(
  state: EditorState,
  command: EditorActiveCommand,
  session: FeatureEditSessionState,
): FeatureEditorState {
  return {
    kind: 'editingFeature',
    mode: state.mode,
    document: state.document,
    snapshot: state.snapshot,
    previewRenderables: state.previewRenderables,
    selection: state.selection,
    hoverTarget: state.hoverTarget,
    selectionFilter: getSelectionFilterForFeatureType(session.featureType),
    selectionCatalog: state.selectionCatalog,
    preview: createFeatureSelectionPreview(session),
    nextCommandSequence: state.nextCommandSequence,
    nextRequestSequence: state.nextRequestSequence,
    pendingSnapshotRequestId: state.pendingSnapshotRequestId,
    pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
    editSessionCursorContext: state.editSessionCursorContext,
    command: {
      ...command,
      phase: 'editing',
    },
    session,
    activeReferencePickerFieldId: null,
    pendingPreviewRequestId: null,
    pendingCommitRequestId: null,
  }
}

export function createImportSelectionPreview(
  session: ImportSessionState,
  prefix = 'Import',
): CommandPreview {
  const provider = getImportProviderById(session.providerId)

  return {
    kind: 'selection',
    label: provider ? `${prefix} ${provider.label}` : `${prefix} session`,
    target: null,
  }
}

export function createImportingState(
  state: EditorState,
  session: ImportSessionState,
): ImportEditorState {
  const defaultReferenceField = getDefaultImportSelectionField(session)
  const selectionFilter = defaultReferenceField?.picker.selectionFilter ?? getDefaultSelectionFilterForMode('part')

  return {
    kind: 'importing',
    mode: 'part',
    document: state.document,
    snapshot: state.snapshot,
    previewRenderables: state.previewRenderables,
    selection: [],
    hoverTarget: null,
    selectionFilter,
    selectionCatalog: state.selectionCatalog,
    preview: defaultReferenceField
      ? createSelectionPreviewForSelection([], selectionFilter)
      : createImportSelectionPreview(session),
    nextCommandSequence: state.nextCommandSequence + 1,
    nextRequestSequence: state.nextRequestSequence,
    pendingSnapshotRequestId: state.pendingSnapshotRequestId,
    pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
    editSessionCursorContext: null,
    command: {
      commandSessionId: nextCommandSessionId(state, 'import'),
      toolId: 'import',
      phase: defaultReferenceField ? 'collecting' : 'editing',
    },
    session,
    activeReferencePickerFieldId: defaultReferenceField?.id ?? null,
  }
}

export function createSectionViewEditingState(
  state: SelectionCommandEditorState,
  section: SectionViewSession,
): SectionViewEditorState {
  return {
    kind: 'inspectingSection',
    mode: 'part',
    document: state.document,
    snapshot: state.snapshot,
    previewRenderables: null,
    selection: [section.seed],
    hoverTarget: section.seed,
    selectionFilter: state.selectionFilter,
    selectionCatalog: state.selectionCatalog,
    preview: {
      kind: 'selection',
      label: 'Section view active',
      target: section.seed,
    },
    nextCommandSequence: state.nextCommandSequence,
    nextRequestSequence: state.nextRequestSequence,
    pendingSnapshotRequestId: state.pendingSnapshotRequestId,
    pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
    editSessionCursorContext: null,
    command: {
      ...state.command,
      phase: 'editing',
    },
    section,
  }
}

export function getActiveReferencePickerField(state: FeatureEditorState) {
  if (!state.activeReferencePickerFieldId) {
    return null
  }

  const field = getFeatureEditorFormField(state.session, state.activeReferencePickerFieldId)
  return field?.kind === 'referencePicker' || field?.kind === 'referenceCollection'
    ? field
    : null
}

export function findFormFieldById(
  schema: FeatureEditorFormSchema,
  fieldId: string,
): FeatureEditorFormField | null {
  for (const section of schema.sections) {
    for (const field of section.fields) {
      const matched = findNestedFormFieldById(field, fieldId)
      if (matched) {
        return matched
      }
    }
  }

  return null
}

function findNestedFormFieldById(
  field: FeatureEditorFormField,
  fieldId: string,
): FeatureEditorFormField | null {
  if (field.id === fieldId) {
    return field
  }

  if (field.kind === 'optionGroup') {
    for (const nestedField of field.fields) {
      const matched = findNestedFormFieldById(nestedField, fieldId)
      if (matched) {
        return matched
      }
    }
  }

  if (field.kind === 'discriminatedOptionGroup') {
    const discriminantMatch = findNestedFormFieldById(field.discriminant, fieldId)
    if (discriminantMatch) {
      return discriminantMatch
    }

    for (const variant of field.variants) {
      for (const nestedField of variant.fields) {
        const matched = findNestedFormFieldById(nestedField, fieldId)
        if (matched) {
          return matched
        }
      }
    }
  }

  return null
}

export function getImportSessionFormField(
  session: ImportSessionState,
  fieldId: string,
) {
  return findFormFieldById(session.formSchema, fieldId)
}

export function getImportSelectionFields(session: ImportSessionState) {
  const fields: Array<Extract<FeatureEditorFormField, { kind: 'referencePicker' | 'referenceCollection' }>> = []

  for (const section of session.formSchema.sections) {
    for (const field of section.fields) {
      collectImportSelectionFields(field, fields)
    }
  }

  return fields
}

function collectImportSelectionFields(
  field: FeatureEditorFormField,
  fields: Array<Extract<FeatureEditorFormField, { kind: 'referencePicker' | 'referenceCollection' }>>,
) {
  if (field.kind === 'referencePicker' || field.kind === 'referenceCollection') {
    fields.push(field)
    return
  }

  if (field.kind === 'optionGroup') {
    for (const nestedField of field.fields) {
      collectImportSelectionFields(nestedField, fields)
    }

    return
  }

  if (field.kind === 'discriminatedOptionGroup') {
    collectImportSelectionFields(field.discriminant, fields)

    for (const variant of field.variants) {
      for (const nestedField of variant.fields) {
        collectImportSelectionFields(nestedField, fields)
      }
    }
  }
}

export function getDefaultImportSelectionField(session: ImportSessionState) {
  const visibleFields = getImportSelectionFields(session).filter((field) => !field.hidden)
  return visibleFields.length === 1 ? visibleFields[0] : null
}

export function getActiveImportReferencePickerField(state: ImportEditorState) {
  if (!state.activeReferencePickerFieldId) {
    return null
  }

  const field = getImportSessionFormField(state.session, state.activeReferencePickerFieldId)
  return field?.kind === 'referencePicker' || field?.kind === 'referenceCollection'
    ? field
    : null
}

export function createImportViewportSelectionPatch(
  state: ImportEditorState,
  field: ReturnType<typeof getActiveImportReferencePickerField>,
  target: PrimitiveRef,
) {
  if (!field) {
    return null
  }

  const patch = createFeatureEditorReferenceSelectionPatch(field, target)

  if (field.kind !== 'referencePicker') {
    return patch
  }

  const sketchSession = state.snapshot
    ? openSketchSessionFromSelection([target], state.snapshot)
    : null

  return {
    ...patch,
    [field.patch.patchKey]: {
      target,
      plane: sketchSession?.plane ?? null,
    },
  }
}

export function createPreviewFailedDiagnostics(
  message: string,
  target: PrimitiveRef | null,
): ModelingDiagnostic[] {
  return [
    {
      code: 'feature-preview-failed',
      severity: 'error',
      message,
      target: getDurableDiagnosticTarget(target),
      detail: null,
    },
  ]
}

export function getDurableDiagnosticTarget(target: PrimitiveRef | null): DurableRef | null {
  if (
    !target
    || target.kind === 'projectedReferenceGeometry'
    || target.kind === 'sketchDatumReference'
    || target.kind === 'sketchExternalReference'
  ) {
    return null
  }

  return target
}

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
    state.snapshot?.revisionId === baseRevisionId
      ? state.snapshot.provenance?.repositoryHeads
      : undefined

  return repositoryHeads
    ? { baseRevisionId, baseRepositoryHeads: [...repositoryHeads] }
    : { baseRevisionId }
}

export function hasPendingDocumentCursorRefresh(state: EditorState) {
  return state.pendingHistoryCursorRequestId !== null || state.pendingSnapshotRequestId !== null
}

export function isRefreshableDocumentCursorConflict(event: Extract<EditorEvent, { type: 'effect.documentCursorMoved' }>) {
  return event.actualRevisionId !== undefined
    || event.diagnostics.some((diagnostic) =>
      diagnostic.code === 'repository-head-conflict' || diagnostic.detail?.kind === 'revisionConflict',
    )
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

  return emitDocumentCursorMove(
    withPreview(
      {
        ...state,
        editSessionCursorContext: {
          ...context,
          phase: 'restoring',
        },
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

export function createEditSessionCursorContext(
  snapshot: DocumentSnapshot | null,
  target: DocumentHistoryOrderEntry,
): EditSessionCursorContext | null {
  if (!snapshot) {
    return null
  }

  const rollbackCursor = getDocumentHistoryCursorBeforeTarget(
    snapshot.presentation.documentHistory,
    target,
  )

  if (!rollbackCursor) {
    return null
  }

  return {
    target,
    rollbackCursor,
    restoreCursor: structuredClone(snapshot.document.cursor),
    phase: 'rollingBack',
  }
}

export function canReopenSketchDirectlyFromCurrentCursor(
  snapshot: DocumentSnapshot | null,
  target: Extract<PrimitiveRef, { kind: 'sketch' }>,
) {
  return snapshot?.document.cursor.kind === 'sketch'
    && snapshot.document.cursor.sketchId === target.sketchId
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

export function emitSketchOpen(
  state: SelectionCommandEditorState,
  selection: readonly PrimitiveRef[],
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
        selectionFilter: getSketchSpecialModeSelectionFilter(session) ?? getDefaultSelectionFilterForMode('sketch'),
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
      selectionFilter: getSketchSpecialModeSelectionFilter(session) ?? getDefaultSelectionFilterForMode('sketch'),
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

export function deriveSketchPointFromWorld(
  _plane: SketchSessionState['plane'],
  point: readonly [number, number],
) {
  return point
}

export function assertSketchPlaneSupport(target: PrimitiveRef): SketchPlaneSupportRef {
  if (target.kind === 'construction' || target.kind === 'face') {
    return target
  }

  throw new Error('Sketch commits require a construction plane or planar face target.')
}

export function updateStateDocument(state: EditorState, payload: SnapshotLoadedPayload): EditorState {
  const snapshot = applyRenderPreservationForFeatureDiagnostics(
    state.snapshot,
    payload.snapshot,
    payload.preserveRenderRecordsOnFeatureDiagnostics === true,
  )

  return {
    ...state,
    document: {
      documentId: payload.documentId,
      revisionId: payload.revisionId,
    },
    snapshot,
    selectionCatalog: payload.selectionCatalog,
    pendingSnapshotRequestId:
      state.pendingSnapshotRequestId === payload.requestId ? null : state.pendingSnapshotRequestId,
  }
}

export function hasFeatureScopedError(snapshot: DocumentSnapshot) {
  return snapshot.document.diagnostics.some((diagnostic) =>
    diagnostic.severity === 'error' && isFeatureScopedModelingDiagnostic(diagnostic),
  )
}

function applyRenderPreservationForFeatureDiagnostics(
  previousSnapshot: DocumentSnapshot | null,
  nextSnapshot: DocumentSnapshot,
  shouldPreserve: boolean,
): DocumentSnapshot {
  if (!shouldPreserve || !previousSnapshot || !hasFeatureScopedError(nextSnapshot)) {
    return nextSnapshot
  }

  const render = {
    ...nextSnapshot.document.render,
    records: previousSnapshot.document.render.records,
  }

  return {
    ...nextSnapshot,
    document: {
      ...nextSnapshot.document,
      render,
    },
    render,
  }
}

export function updateStateDocumentSnapshot(state: EditorState, snapshot: DocumentSnapshot): EditorState {
  return {
    ...state,
    document: {
      documentId: snapshot.documentId,
      revisionId: snapshot.revisionId,
    },
    snapshot,
    selectionCatalog: buildSelectionTargetCatalog(snapshot),
    pendingSnapshotRequestId: null,
  }
}

export function continueAfterSnapshotRefresh(updatedState: EditorState): EditorTransitionResult {
  const cursorContext = updatedState.editSessionCursorContext

  if (cursorContext?.phase === 'opening' && updatedState.kind === 'selectionCommand') {
    const activeState: SelectionCommandEditorState = {
      ...updatedState,
      editSessionCursorContext: {
        ...cursorContext,
        phase: 'active',
      },
    }

    if (cursorContext.target.kind === 'sketch' && activeState.command.toolId === 'sketch') {
      const session = activeState.snapshot
        ? openSketchSessionFromSelection([{ kind: 'sketch', sketchId: cursorContext.target.sketchId }], activeState.snapshot)
        : null

      return session
        ? enterSketchEditing(activeState, session)
        : emitSketchOpen(
            {
              ...activeState,
              selection: [{ kind: 'sketch', sketchId: cursorContext.target.sketchId }],
              hoverTarget: null,
            },
            [{ kind: 'sketch', sketchId: cursorContext.target.sketchId }],
          )
    }

    if (cursorContext.target.kind === 'feature' && isFeatureTool(activeState.command.toolId)) {
      return emitFeatureHydration(
        {
          ...activeState,
          selection: [{ kind: 'feature', featureId: cursorContext.target.featureId }],
          hoverTarget: null,
        },
        cursorContext.target.featureId,
      )
    }
  }

  if (cursorContext?.phase === 'restorePending') {
    return emitEditSessionCursorRestore(updatedState)
  }

  return {
    state: cursorContext?.phase === 'restoring'
      ? {
          ...updatedState,
          editSessionCursorContext: null,
        }
      : updatedState,
    effects: [],
  }
}

export function enterSketchEditing(
  state: SelectionCommandEditorState,
  session: SketchSessionState,
): EditorTransitionResult {
  const nextState: SketchEditorState = {
    kind: 'editingSketch',
    mode: 'sketch',
    document: state.document,
    snapshot: state.snapshot,
    previewRenderables: null,
    selection:
      session.sketchId === null
        ? [session.planeTarget]
        : [{ kind: 'sketch', sketchId: session.sketchId }],
    hoverTarget: null,
    selectionFilter: getDefaultSelectionFilterForMode('sketch'),
    selectionCatalog: state.selectionCatalog,
    preview: {
      kind: 'sketch',
      label: getSketchSessionPreviewLabel(session),
      target: session.planeTarget,
    },
    nextCommandSequence: state.nextCommandSequence,
    nextRequestSequence: state.nextRequestSequence,
    pendingSnapshotRequestId: state.pendingSnapshotRequestId,
    pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
    editSessionCursorContext: state.editSessionCursorContext,
    command: {
      ...state.command,
      phase: 'editing',
    },
    session,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingImportRequestId: null,
  }

  return emitSketchReferenceProjection(nextState, session)
}

export function eventMatchesDocument(
  state: EditorState,
  documentId: DocumentId,
  revisionId: RevisionId | null,
) {
  if (state.document.documentId !== null && state.document.documentId !== documentId) {
    return false
  }

  if (revisionId !== null && state.document.revisionId !== null && state.document.revisionId !== revisionId) {
    return false
  }

  return true
}

export function eventMatchesOptionalDocument(
  state: EditorState,
  documentId: DocumentId | null,
  revisionId: RevisionId | null,
) {
  if (documentId === null) {
    return true
  }

  return eventMatchesDocument(state, documentId, revisionId)
}

export function isFeatureTool(toolId: ToolId): toolId is Extract<ToolId, 'extrude' | 'revolve' | 'fillet' | 'shell' | 'plane' | 'sweep' | 'loft' | 'chamfer' | 'thicken' | 'combine' | 'split' | 'deleteSolid' | 'mirror' | 'transform'> {
  return toolId === 'extrude'
    || toolId === 'revolve'
    || toolId === 'fillet'
    || toolId === 'shell'
    || toolId === 'plane'
    || toolId === 'sweep'
    || toolId === 'loft'
    || toolId === 'chamfer'
    || toolId === 'thicken'
    || toolId === 'combine'
    || toolId === 'split'
    || toolId === 'deleteSolid'
    || toolId === 'mirror'
    || toolId === 'transform'
}

export function isPassiveSketchTool(toolId: ToolId): toolId is Extract<ToolId, 'fill' | 'stroke'> {
  return toolId === 'fill'
    || toolId === 'stroke'
}
