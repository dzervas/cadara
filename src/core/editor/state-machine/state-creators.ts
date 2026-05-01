import type { ToolId } from '@/core/tools/tool-registry'
import type { ToolbarMode } from '@/core/tools/schema'
import type { SectionViewSession } from '@/core/section-view/session'
import {
  defaultSelectionFilter,
  getDefaultSelectionFilterForMode,
  primitiveRefEquals,
  type CommandPreview,
  type PrimitiveRef,
  type SelectionFilter,
} from '@/core/editor/schema'
import {
  getSelectionFilterForFeatureType,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import {
  getSketchSessionPreviewLabel,
  updateSketchReferenceProjection,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import type { EditorExtensionDependencies } from './dependencies'
import { getDefaultImportSelectionField } from './form-traversal'
import { advanceCursorPhase } from './cursor-lifecycle'
import {
  createFeatureSelectionPreview,
  createImportSelectionPreview,
  createSelectionPreviewForSelection,
} from './selection-helpers'
import { nextCommandSessionId, nextRequestId } from './utility-helpers'
import type {
  EditorActiveCommand,
  EditorState,
  EditorTransitionResult,
  FeatureEditorState,
  IdleEditorState,
  ImportEditorState,
  ImportSessionState,
  SectionViewEditorState,
  SelectionCommandEditorState,
  SketchEditorState,
} from './types'

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

export const initialEditorState = createInitialState()

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
    editSessionCursorContext:
      state.editSessionCursorContext
        ? advanceCursorPhase(state.editSessionCursorContext, 'sessionOpened')
        : null,
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

export function createImportingState(
  state: EditorState,
  session: ImportSessionState,
  dependencies: EditorExtensionDependencies,
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
      : createImportSelectionPreview(session, dependencies),
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
    editSessionCursorContext:
      state.editSessionCursorContext
        ? advanceCursorPhase(state.editSessionCursorContext, 'sessionOpened')
        : null,
    command: {
      ...state.command,
      phase: 'editing',
    },
    session,
    pendingCommitRequestId: null,
    pendingProjectionRequestId: null,
    pendingImportRequestId: null,
  }

  if (
    session.definition.references.length === 0
    || state.document.documentId === null
    || state.document.revisionId === null
  ) {
    return {
      state: {
        ...nextState,
        session: updateSketchReferenceProjection(session, [], []),
        pendingProjectionRequestId: null,
      },
      effects: [],
    }
  }

  const requestId = nextRequestId(state, 'sketch-reference-projection')

  return {
    state: {
      ...nextState,
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
