import type { ToolId } from '@/domain/tools/tool-registry'
import type { ToolbarMode } from '@/domain/tools/schema'
import { isRegisteredSketchToolId } from '@/domain/sketch-tools/registry'
import { isRegisteredSketchConstraintToolId } from '@/domain/sketch-constraints/registry'
import {
  applySelectionToFeatureEditSession,
  buildFeatureDefinition,
  createCommitMissingInputsDiagnostics,
  createFeatureEditSession,
  createPreviewMissingInputsDiagnostics,
  getFeatureEditorFormField,
  getFeaturePrimarySelectionTarget,
  getFeatureSessionPreviewLabel,
  getSelectionFilterForFeatureType,
  hydrateFeatureEditSession,
  patchFeatureEditSession,
  type FeatureDraftPatch,
  type FeatureEditSessionState,
} from '@/domain/editor/feature-editing'
import { createFeatureEditorReferenceSelectionPatch } from '@/domain/feature-authoring/form-events'
import {
  acceptSketchDraw,
  beginSketchAnnotationEdit,
  beginSketchGeometryDrag,
  beginSketchTool,
  clearActiveSketchTool,
  deleteSelectedSketchAnnotation,
  finishSketchGeometryDrag,
  getSketchSessionPreviewLabel,
  moveSketchHistoryCursor,
  patchSketchConstraintValue,
  pinSketchConstraintPreview,
  selectSketchEditTarget,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  startSketchDraw,
  updateSketchGeometryDrag,
  updateSketchConstraintHover,
  updateSketchPointer,
  type SketchSessionState,
  type SketchHistoryCursor,
} from '@/domain/editor/sketch-session'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import {
  defaultSelectionFilter,
  getDefaultSelectionFilterForMode,
  getPrimitiveRefKey,
  getSelectionFilterForCommand,
  getSelectionFilterRejectionLabel,
  getSelectionPreviewLabel,
  primitiveRefEquals,
  resolveSelectionCandidate,
  selectionFilterAllowsTarget,
  sketchStartSelectionFilter,
  type CommandPreview,
  type PrimitiveRef,
  type SelectionFilter,
  type SelectionTargetCatalog,
} from '@/domain/editor/schema'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import type {
  DocumentSnapshot,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { SketchPlaneDefinition, SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import type {
  CommandSessionId,
  DocumentId,
  FeatureId,
  RequestId,
  RevisionId,
} from '@/contracts/shared/ids'

/**
 * Visible command metadata derived from the active machine state.
 * The command session ID is deterministic so event replay reaches the same state.
 */
export interface EditorActiveCommand {
  /** Stable editor-owned correlation ID for the active command session. */
  commandSessionId: CommandSessionId
  /** Tool that opened the active command session. */
  toolId: ToolId
  /** Current explicit lifecycle phase for the active command. */
  phase: 'armed' | 'collecting' | 'editing' | 'awaitingEffect'
}

/**
 * Document context tracked by the editor machine.
 * This state is owned by the editor runtime and refreshed only through
 * explicit snapshot result events.
 */
export interface EditorDocumentContext {
  /** Durable document identity for the loaded workspace, if known. */
  documentId: DocumentId | null
  /** Last committed revision known to the editor runtime, if any snapshot has been loaded. */
  revisionId: RevisionId | null
}

interface EditorStateBase {
  /**
   * Current toolbar mode exposed to the UI.
   * This is editor-owned transient state.
   */
  mode: ToolbarMode
  /**
   * Current document identity and revision basis known to the editor.
   * Async effect results must agree with this context before they may mutate state.
   */
  document: EditorDocumentContext
  /**
   * Last committed snapshot loaded into the editor runtime.
   * This snapshot is read-only from the editor perspective and changes only through
   * explicit snapshot result events.
   */
  snapshot: DocumentSnapshot | null
  /**
   * Preview renderables owned by the most recent accepted preview effect.
   * These are transient and must be discarded on draft changes, cancellation, or stale responses.
   */
  previewRenderables: RenderableEntityRecord[] | null
  selection: PrimitiveRef[]
  hoverTarget: PrimitiveRef | null
  selectionFilter: SelectionFilter | null
  selectionCatalog: SelectionTargetCatalog | null
  preview: CommandPreview | null
  /** Monotonic editor-local counter used to allocate deterministic command session IDs. */
  nextCommandSequence: number
  /** Monotonic editor-local counter used to allocate deterministic effect request IDs. */
  nextRequestSequence: number
  /** Snapshot request currently in flight, or null when no refresh is pending. */
  pendingSnapshotRequestId: RequestId | null
}

/**
 * Stable idle editor state with no active command session.
 */
export interface IdleEditorState extends EditorStateBase {
  kind: 'idle'
}

/**
 * Active command state that is still collecting or validating selections.
 */
export interface SelectionCommandEditorState extends EditorStateBase {
  /** Discriminant for the selection-collection command branch. */
  kind: 'selectionCommand'
  /** Active command metadata for this selection workflow. */
  command: EditorActiveCommand
  /**
   * Pending async request spawned from this selection command, such as sketch open
   * or feature-session hydration. Null means no async selection-derived request is outstanding.
   */
  pendingRequestId: RequestId | null
}

/**
 * Active sketch-editing state.
 * The editor owns the transient sketch draft and pending commit correlation.
 */
export interface SketchEditorState extends EditorStateBase {
  /** Discriminant for the sketch-editing branch. */
  kind: 'editingSketch'
  /** Active command metadata for this sketch workflow. */
  command: EditorActiveCommand
  /** Transient editor-owned sketch session and draft geometry. */
  session: SketchSessionState
  /** Explicit correlation ID for an in-flight sketch commit request. */
  pendingCommitRequestId: RequestId | null
}

/**
 * Active feature-editing state.
 * Preview and commit requests are tracked explicitly so stale responses can be ignored.
 */
export interface FeatureEditorState extends EditorStateBase {
  /** Discriminant for the feature-editing branch. */
  kind: 'editingFeature'
  /** Active command metadata for this feature workflow. */
  command: EditorActiveCommand
  /** Transient editor-owned feature session and draft parameters. */
  session: FeatureEditSessionState
  /** Active reference picker form field currently collecting viewport/sidebar selections. */
  activeReferencePickerFieldId: string | null
  /** Explicit correlation ID for an in-flight preview request. */
  pendingPreviewRequestId: RequestId | null
  /** Explicit correlation ID for an in-flight feature commit request. */
  pendingCommitRequestId: RequestId | null
}

/**
 * Canonical Phase 1 editor machine state.
 * Impossible combinations such as an active sketch tool with no sketch session
 * or a preview-ready feature without a feature edit session are unrepresentable.
 */
export type EditorState =
  | IdleEditorState
  | SelectionCommandEditorState
  | SketchEditorState
  | FeatureEditorState

/**
 * Snapshot payload emitted back into the editor runtime after a document refresh.
 */
export interface SnapshotLoadedPayload {
  /** Effect request being completed by this snapshot payload. */
  requestId: RequestId
  /** Durable document identity returned by the snapshot source. */
  documentId: DocumentId
  /** Revision represented by `snapshot`. */
  revisionId: RevisionId
  /** Full typed snapshot payload loaded into the editor runtime. */
  snapshot: DocumentSnapshot
  /** Derived selection catalog built from `snapshot` for command filtering. */
  selectionCatalog: SelectionTargetCatalog
}

/** Bootstraps the editor runtime and requests the initial snapshot load. */
export interface SessionStartedEvent {
  type: 'session.started'
}

/** Activates a toolbar tool and opens the corresponding command workflow. */
export interface ToolActivatedEvent {
  type: 'tool.activated'
  /** Tool selected by the user. */
  toolId: ToolId
}

/** Cancels the specified command session if it is still active. */
export interface CommandCancelledEvent {
  type: 'command.cancelled'
  /** Command session to cancel. */
  commandSessionId: CommandSessionId
}

/** Requests commit for the specified active command session. */
export interface CommandCommitRequestedEvent {
  type: 'command.commitRequested'
  /** Command session requesting commit. */
  commandSessionId: CommandSessionId
}

/** Requests a fresh document snapshot outside an active command flow. */
export interface DocumentRefreshRequestedEvent {
  type: 'document.refreshRequested'
}

/** Reports a viewport hover on a durable selectable target. */
export interface ViewportHoveredEvent {
  type: 'viewport.hovered'
  /** Durable target currently under the pointer. */
  target: PrimitiveRef
}

/** Clears any active viewport hover target. */
export interface ViewportHoverClearedEvent {
  type: 'viewport.hoverCleared'
}

/** Requests selection of a durable target from the viewport or sidebar. */
export interface ViewportSelectionRequestedEvent {
  type: 'viewport.selectionRequested'
  /** Durable target the user is attempting to select. */
  target: PrimitiveRef
}

/** Reopens committed feature or sketch authoring directly from a navigation surface. */
export interface AuthoringReopenRequestedEvent {
  type: 'authoring.reopenRequested'
  /** Durable target that should reopen in place. */
  target: PrimitiveRef
  /** Tool flow to use for the reopen request. */
  toolId: ToolId
}

/** Updates the current sketch pointer position in sketch-plane coordinates. */
export interface SketchPointerMovedEvent {
  type: 'sketch.pointerMoved'
  /** Pointer location in the active sketch plane coordinate frame. */
  point: readonly [number, number]
}

/** Finalizes a sketch pointer release in sketch-plane coordinates. */
export interface SketchPointerReleasedEvent {
  type: 'sketch.pointerReleased'
  /** Release location in the active sketch plane coordinate frame. */
  point: readonly [number, number]
}

/** Starts direct editing of a selectable sketch geometry handle. */
export interface SketchGeometryDragStartedEvent {
  type: 'sketch.geometryDragStarted'
  /** Sketch geometry handle selected for direct editing. */
  target: PrimitiveRef
  /** Pointer location in the active sketch plane coordinate frame. */
  point: readonly [number, number]
}

/** Updates the temporary direct sketch edit target while dragging. */
export interface SketchGeometryDragMovedEvent {
  type: 'sketch.geometryDragMoved'
  /** Pointer location in the active sketch plane coordinate frame. */
  point: readonly [number, number]
}

/** Completes direct sketch geometry editing for the active drag target. */
export interface SketchGeometryDragEndedEvent {
  type: 'sketch.geometryDragEnded'
  /** Release location in the active sketch plane coordinate frame. */
  point: readonly [number, number]
}

/** Applies a generic active sketch-tool draft patch emitted by declarative controls. */
export interface SketchToolPatchedEvent {
  type: 'sketch.toolPatched'
  /** Patch payload declared by the active sketch tool schema control. */
  patch: Record<string, unknown>
}

/** Clears the active sketch tool while leaving the sketch session open. */
export interface SketchActiveToolClearedEvent {
  type: 'sketch.activeToolCleared'
}

/** Moves the active sketch-local history cursor. */
export interface SketchHistoryCursorRequestedEvent {
  type: 'sketch.historyCursorRequested'
  /** Cursor position requested by the sketch-local history view. */
  cursor: SketchHistoryCursor
}

/** Deletes the currently selected committed sketch annotation, if any. */
export interface SketchAnnotationDeleteRequestedEvent {
  type: 'sketch.annotationDeleteRequested'
}

/** Opens the editable value form for a committed sketch annotation, if supported. */
export interface SketchAnnotationEditRequestedEvent {
  type: 'sketch.annotationEditRequested'
  /** Durable committed annotation target requested for editing. */
  target: Extract<PrimitiveRef, { kind: 'constraint' | 'dimension' }>
}

/** Applies a partial edit to the active feature draft parameters. */
export interface FormFeaturePatchedEvent {
  type: 'form.featurePatched'
  /** Partial draft patch owned by the editor form layer. */
  patch: FeatureDraftPatch
}

/** Activates a feature form reference picker by its schema field id. */
export interface FormReferencePickerActivatedEvent {
  type: 'form.referencePickerActivated'
  /** Feature form field id that should receive subsequent viewport/sidebar selections. */
  fieldId: string
}

/** Cancels the currently active feature form reference picker, if any. */
export interface FormReferencePickerCancelledEvent {
  type: 'form.referencePickerCancelled'
}

/** Completes a snapshot fetch with the resulting typed snapshot payload. */
export interface SnapshotLoadedEvent {
  type: 'effect.snapshotLoaded'
  /** Snapshot result payload correlated to the originating request. */
  payload: SnapshotLoadedPayload
}

/** Reports failure for an explicit snapshot fetch request. */
export interface SnapshotFailedEvent {
  type: 'effect.snapshotFailed'
  /** Snapshot request that failed. */
  requestId: RequestId
  /** Durable document identity for the failed snapshot fetch, if known. */
  documentId: DocumentId | null
  /** Base revision used when the snapshot fetch was issued, if any. */
  revisionId: RevisionId | null
  /** Human-readable failure summary for the snapshot fetch. */
  error: string
}

/**
 * Explicit event union that drives every editor transition.
 * UI code dispatches only these events; all async work re-enters the machine
 * through `effect.*` result events.
 */
export type EditorEvent =
  | SessionStartedEvent
  | ToolActivatedEvent
  | CommandCancelledEvent
  | CommandCommitRequestedEvent
  | DocumentRefreshRequestedEvent
  | ViewportHoveredEvent
  | ViewportHoverClearedEvent
  | ViewportSelectionRequestedEvent
  | AuthoringReopenRequestedEvent
  | SketchPointerMovedEvent
  | SketchPointerReleasedEvent
  | SketchGeometryDragStartedEvent
  | SketchGeometryDragMovedEvent
  | SketchGeometryDragEndedEvent
  | SketchToolPatchedEvent
  | SketchActiveToolClearedEvent
  | SketchHistoryCursorRequestedEvent
  | SketchAnnotationDeleteRequestedEvent
  | SketchAnnotationEditRequestedEvent
  | FormFeaturePatchedEvent
  | FormReferencePickerActivatedEvent
  | FormReferencePickerCancelledEvent
  | SnapshotLoadedEvent
  | SnapshotFailedEvent
  | {
      type: 'effect.sketchSessionOpened'
      /** Effect request being completed by this sketch-open result. */
      requestId: RequestId
      /** Durable document identity returned while opening the sketch session. */
      documentId: DocumentId
      /** Revision against which the sketch session was opened. */
      revisionId: RevisionId
      /** Command session that originally requested sketch opening. */
      commandSessionId: CommandSessionId
      /** Sketch session payload opened from the selected durable targets. */
      session: SketchSessionState
    }
  | {
      type: 'effect.sketchSessionOpenFailed'
      /** Effect request that failed while opening a sketch session. */
      requestId: RequestId
      /** Durable document identity for the failed sketch-open attempt. */
      documentId: DocumentId
      /** Revision context used for the failed sketch-open attempt, if known. */
      revisionId: RevisionId | null
      /** Command session that originally requested sketch opening. */
      commandSessionId: CommandSessionId
      /** Human-readable failure summary for the sketch-open attempt. */
      message: string
    }
  | {
      type: 'effect.featureSessionHydrated'
      /** Effect request being completed by this feature-hydration result. */
      requestId: RequestId
      /** Durable document identity returned while hydrating the feature session. */
      documentId: DocumentId
      /** Revision against which the feature session was hydrated. */
      revisionId: RevisionId
      /** Command session that originally requested feature editing. */
      commandSessionId: CommandSessionId
      /** Hydrated feature-editing session derived from the selected feature. */
      session: FeatureEditSessionState
    }
  | {
      type: 'effect.featureSessionHydrationFailed'
      /** Effect request that failed while hydrating a feature session. */
      requestId: RequestId
      /** Durable document identity for the failed hydration attempt. */
      documentId: DocumentId
      /** Revision context used for the failed hydration attempt, if known. */
      revisionId: RevisionId | null
      /** Command session that originally requested feature editing. */
      commandSessionId: CommandSessionId
      /** Human-readable failure summary for the hydration attempt. */
      message: string
    }
  | {
      type: 'effect.featurePreviewCompleted'
      /** Effect request being completed by this preview result. */
      requestId: RequestId
      /** Durable document identity for the preview result. */
      documentId: DocumentId
      /** Command session that originally requested the preview. */
      commandSessionId: CommandSessionId
      /** Base revision used when the preview request was issued. */
      baseRevisionId: RevisionId
      /** Revision that the backend evaluated or compared against for this result. */
      revisionId: RevisionId
      /** True when the backend knows the preview is stale against the active revision. */
      stale: boolean
      /** Machine-readable diagnostics returned by preview evaluation. */
      diagnostics: ModelingDiagnostic[]
      /** Transient renderables returned for viewport preview display. */
      renderables: RenderableEntityRecord[]
    }
  | {
      type: 'effect.featurePreviewFailed'
      /** Effect request that failed during preview evaluation. */
      requestId: RequestId
      /** Durable document identity for the failed preview request. */
      documentId: DocumentId
      /** Command session that originally requested the preview. */
      commandSessionId: CommandSessionId
      /** Base revision used when the preview request was issued. */
      baseRevisionId: RevisionId
      /** Human-readable failure summary for this preview request. */
      message: string
    }
  | {
      type: 'effect.featureCommitted'
      /** Effect request being completed by this feature mutation result. */
      requestId: RequestId
      /** Durable document identity for the feature mutation result. */
      documentId: DocumentId
      /** Command session that originally requested the feature commit. */
      commandSessionId: CommandSessionId
      /** Base revision used when the commit request was issued. */
      baseRevisionId: RevisionId
      /** Revision returned by the backend after processing the mutation. */
      revisionId: RevisionId
      /** Durable feature identity that was created or updated. */
      featureId: FeatureId
      /** Whether the mutation was accepted against `baseRevisionId`. */
      accepted: boolean
      /** Machine-readable diagnostics returned by the mutation. */
      diagnostics: ModelingDiagnostic[]
      /** Actual revision encountered when `accepted` is false due to conflict. */
      actualRevisionId?: RevisionId
    }
  | {
      type: 'effect.featureCommitFailed'
      /** Effect request that failed during feature commit. */
      requestId: RequestId
      /** Durable document identity for the failed feature commit request. */
      documentId: DocumentId
      /** Command session that originally requested the feature commit. */
      commandSessionId: CommandSessionId
      /** Base revision used when the commit request was issued. */
      baseRevisionId: RevisionId
      /** Human-readable failure summary for this feature commit request. */
      message: string
    }
  | {
      type: 'effect.sketchCommitted'
      /** Effect request being completed by this sketch mutation result. */
      requestId: RequestId
      /** Durable document identity for the sketch mutation result. */
      documentId: DocumentId
      /** Command session that originally requested the sketch commit. */
      commandSessionId: CommandSessionId
      /** Base revision used when the sketch commit request was issued. */
      baseRevisionId: RevisionId
      /** Revision returned by the backend after processing the sketch mutation. */
      revisionId: RevisionId
      /** Whether the mutation was accepted against `baseRevisionId`. */
      accepted: boolean
      /** Machine-readable diagnostics returned by the mutation. */
      diagnostics: ModelingDiagnostic[]
      /** Actual revision encountered when `accepted` is false due to conflict. */
      actualRevisionId?: RevisionId
    }
  | {
      type: 'effect.sketchCommitFailed'
      /** Effect request that failed during sketch commit. */
      requestId: RequestId
      /** Durable document identity for the failed sketch commit request. */
      documentId: DocumentId
      /** Command session that originally requested the sketch commit. */
      commandSessionId: CommandSessionId
      /** Base revision used when the sketch commit request was issued. */
      baseRevisionId: RevisionId
      /** Human-readable failure summary for this sketch commit request. */
      message: string
    }

/**
 * Explicit side-effect requests emitted by the pure transition function.
 * The React runtime executes these requests and feeds their results back as events.
 */
export type EditorEffect =
  | {
      type: 'document.fetchSnapshot'
      /** Editor-owned correlation ID for this snapshot fetch. */
      requestId: RequestId
      /** Durable document identity against which the fetch was issued, if known. */
      documentId: DocumentId | null
      /** Base revision known when the fetch was issued, if any. */
      revisionId: RevisionId | null
      /** Command session that triggered the fetch, or null for background/session bootstraps. */
      commandSessionId: CommandSessionId | null
    }
  | {
      type: 'sketch.openSession'
      /** Editor-owned correlation ID for this sketch-open request. */
      requestId: RequestId
      /** Command session that requested sketch opening. */
      commandSessionId: CommandSessionId
      /** Durable targets used to open or resume the sketch session. */
      selection: readonly PrimitiveRef[]
      /** Durable document identity against which the session must be opened. */
      documentId: DocumentId
      /** Base revision that the selection was evaluated against. */
      revisionId: RevisionId
    }
  | {
      type: 'feature.hydrateFromSelection'
      /** Editor-owned correlation ID for this hydration request. */
      requestId: RequestId
      /** Command session that requested feature editing. */
      commandSessionId: CommandSessionId
      /** Durable document identity against which the feature was selected. */
      documentId: DocumentId
      /** Base revision that the selected feature came from. */
      revisionId: RevisionId
      /** Selected durable feature to hydrate into an edit session. */
      selectedFeatureId: FeatureId
    }
  | {
      type: 'feature.evaluatePreview'
      /** Editor-owned correlation ID for this preview request. */
      requestId: RequestId
      /** Command session that owns the preview. */
      commandSessionId: CommandSessionId
      /** Durable document identity against which the preview was requested. */
      documentId: DocumentId
      /** Base revision against which preview evaluation must run. */
      baseRevisionId: RevisionId
      /** Feature session snapshot captured when the preview request was emitted. */
      featureSession: FeatureEditSessionState
    }
  | {
      type: 'feature.commit'
      /** Editor-owned correlation ID for this feature commit request. */
      requestId: RequestId
      /** Command session that owns the feature commit. */
      commandSessionId: CommandSessionId
      /** Durable document identity against which the commit was requested. */
      documentId: DocumentId
      /** Base revision against which the feature mutation must be applied. */
      baseRevisionId: RevisionId
      /** Feature session snapshot captured when the commit request was emitted. */
      featureSession: FeatureEditSessionState
    }
  | {
      type: 'sketch.commit'
      /** Editor-owned correlation ID for this sketch commit request. */
      requestId: RequestId
      /** Command session that owns the sketch commit. */
      commandSessionId: CommandSessionId
      /** Durable document identity against which the sketch commit was requested. */
      documentId: DocumentId
      /** Base revision against which the sketch mutation must be applied. */
      baseRevisionId: RevisionId
      /** Sketch session snapshot captured when the commit request was emitted. */
      session: SketchSessionState
    }

/**
 * Pure transition result containing the next machine state plus any explicit effects.
 */
export interface EditorTransitionResult {
  /** Next deterministic editor machine state after applying the input event. */
  state: EditorState
  /** Explicit side-effects that must run after this pure transition. */
  effects: EditorEffect[]
}

function nextCommandSessionId(state: EditorState, toolId: ToolId) {
  return `command_${toolId}-${state.nextCommandSequence}` as CommandSessionId
}

function nextRequestId(state: EditorState, scope: string) {
  return `request_${scope}-${state.nextRequestSequence}` as RequestId
}

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
  }
}

/**
 * Initial Phase 1 editor machine state.
 */
export const initialEditorState = createInitialState()

/**
 * Minimal runtime services required to execute Phase 1 editor effects.
 * Implementations must preserve request ordering semantics and must feed
 * completions back into the editor only through typed `EditorEvent` values.
 */
export interface EditorEffectRuntime {
  /** Fetches the latest typed snapshot for the active document. */
  getCurrentDocumentSnapshot(): Promise<DocumentSnapshot>
  /** Commits the active sketch session against a base revision. */
  commitSketch(input: {
    requestId: RequestId
    baseRevisionId: RevisionId
    session: SketchSessionState
  }): Promise<{
    revisionId: RevisionId
    accepted: boolean
    diagnostics: ModelingDiagnostic[]
    actualRevisionId?: RevisionId
  } | null>
  /** Evaluates a feature preview against a base revision. */
  evaluatePreview(input: {
    baseRevisionId: RevisionId
    featureSession: FeatureEditSessionState
  }): Promise<{
    revisionId: RevisionId
    stale: boolean
    diagnostics: ModelingDiagnostic[]
    renderables: RenderableEntityRecord[]
  }>
  /** Creates or updates a feature from the active feature session. */
  commitFeature(input: {
    baseRevisionId: RevisionId
    featureSession: FeatureEditSessionState
  }): Promise<{
    revisionId: RevisionId
    featureId: FeatureId
    accepted: boolean
    diagnostics: ModelingDiagnostic[]
    actualRevisionId?: RevisionId
  }>
}

function previewEquals(left: CommandPreview | null, right: CommandPreview | null) {
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

function withPreview<TState extends EditorState>(state: TState, preview: CommandPreview | null): TState {
  if (previewEquals(state.preview, preview)) {
    return state
  }

  return {
    ...state,
    preview,
  }
}

function toIdleState(state: EditorState, mode: ToolbarMode): IdleEditorState {
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
  }
}

function createCommandState(
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
    pendingRequestId: null,
    command: {
      commandSessionId: nextCommandSessionId(state, toolId),
      toolId,
      phase: 'armed',
    },
  }
}

function createSelectionPreview(state: EditorState, filter: SelectionFilter | null): CommandPreview | null {
  if (!filter) {
    return null
  }

  return {
    kind: 'selection',
    label: `Awaiting ${filter.label.toLowerCase()}`,
    target: state.selection[0] ?? null,
  }
}

function createFeatureSelectionPreview(
  session: FeatureEditSessionState,
  prefix = 'Draft',
): CommandPreview {
  return {
    kind: 'selection',
    label: getFeatureSessionPreviewLabel(session, prefix),
    target: getFeaturePrimarySelectionTarget(session),
  }
}

function createFeatureEditingState(
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

function getActiveReferencePickerField(state: FeatureEditorState) {
  if (!state.activeReferencePickerFieldId) {
    return null
  }

  const field = getFeatureEditorFormField(state.session, state.activeReferencePickerFieldId)
  return field?.kind === 'referencePicker' || field?.kind === 'referenceCollection'
    ? field
    : null
}

function createPreviewFailedDiagnostics(
  message: string,
  target: PrimitiveRef | null,
): ModelingDiagnostic[] {
  return [
    {
      code: 'feature-preview-failed',
      severity: 'error',
      message,
      target,
      detail: null,
    },
  ]
}

function emitSnapshotFetch(
  state: EditorState,
  commandSessionId: CommandSessionId | null,
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
      },
    ],
  }
}

function emitFeaturePreview(state: FeatureEditorState): EditorTransitionResult {
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

function emitFeatureCommit(state: FeatureEditorState): EditorTransitionResult {
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
        baseRevisionId: state.document.revisionId,
        featureSession: draftSession,
      },
    ],
  }
}

function emitSketchOpen(
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

function emitFeatureHydration(
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

function emitSketchCommit(state: SketchEditorState): EditorTransitionResult {
  if (!state.session.commitRequest || state.document.revisionId === null) {
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
        baseRevisionId: state.document.revisionId,
        session: state.session,
      },
    ],
  }
}

function deriveSketchPointFromWorld(
  _plane: SketchSessionState['plane'],
  point: readonly [number, number],
) {
  return point
}

function assertSketchPlaneSupport(target: PrimitiveRef): SketchPlaneSupportRef {
  if (target.kind === 'construction' || target.kind === 'face') {
    return target
  }

  throw new Error('Sketch commits require a construction plane or planar face target.')
}

function updateStateDocument(state: EditorState, payload: SnapshotLoadedPayload): EditorState {
  return {
    ...state,
    document: {
      documentId: payload.documentId,
      revisionId: payload.revisionId,
    },
    snapshot: payload.snapshot,
    selectionCatalog: payload.selectionCatalog,
    pendingSnapshotRequestId:
      state.pendingSnapshotRequestId === payload.requestId ? null : state.pendingSnapshotRequestId,
  }
}

function eventMatchesDocument(
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

function eventMatchesOptionalDocument(
  state: EditorState,
  documentId: DocumentId | null,
  revisionId: RevisionId | null,
) {
  if (documentId === null) {
    return true
  }

  return eventMatchesDocument(state, documentId, revisionId)
}

function isFeatureTool(toolId: ToolId): toolId is Extract<ToolId, 'extrude' | 'revolve' | 'fillet' | 'shell' | 'plane' | 'sweep' | 'loft' | 'chamfer' | 'thicken' | 'split' | 'deleteSolid' | 'mirror' | 'transform'> {
  return toolId === 'extrude'
    || toolId === 'revolve'
    || toolId === 'fillet'
    || toolId === 'shell'
    || toolId === 'plane'
    || toolId === 'sweep'
    || toolId === 'loft'
    || toolId === 'chamfer'
    || toolId === 'thicken'
    || toolId === 'split'
    || toolId === 'deleteSolid'
    || toolId === 'mirror'
    || toolId === 'transform'
}

/**
 * Pure editor transition function for Phase 1.
 * The reducer never performs async work directly and emits only typed effect requests.
 */
export function transitionEditorState(state: EditorState, event: EditorEvent): EditorTransitionResult {
  switch (event.type) {
    case 'session.started':
      return emitSnapshotFetch(state, null)
    case 'tool.activated': {
      if (event.toolId === 'finishSketch' && state.kind === 'editingSketch') {
        return emitSketchCommit(state)
      }

      if (
        state.kind === 'editingSketch' &&
        (isRegisteredSketchToolId(event.toolId) || isRegisteredSketchConstraintToolId(event.toolId))
      ) {
        const session = beginSketchTool(state.session, event.toolId)

        return {
          state: {
            ...state,
            mode: 'sketch',
            command: {
              ...state.command,
              toolId: event.toolId,
              phase: 'editing',
            },
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }

      if (event.toolId === 'sketch') {
        const nextState = createCommandState(
          state,
          event.toolId,
          state.mode,
          sketchStartSelectionFilter,
          createSelectionPreview(state, sketchStartSelectionFilter),
        )

        const selectedTarget = nextState.selection[0] ?? null

        if (
          selectedTarget &&
          selectionFilterAllowsTarget(
            sketchStartSelectionFilter,
            [],
            selectedTarget,
            nextState.selectionCatalog,
          )
        ) {
          return emitSketchOpen(nextState, [selectedTarget])
        }

        return {
          state: nextState,
          effects: [],
        }
      }

      if (isFeatureTool(event.toolId)) {
        const selectionFilter = getSelectionFilterForFeatureType(event.toolId)
        const nextState = createCommandState(
          state,
          event.toolId,
          'part',
          selectionFilter,
          createSelectionPreview(state, selectionFilter),
        )

        const selectedTarget = nextState.selection[0] ?? null

        if (selectedTarget?.kind === 'feature') {
          return emitFeatureHydration(nextState, selectedTarget.featureId)
        }

        const session = createFeatureEditSession({
          featureType: event.toolId,
          selectedTarget,
        })

        return emitFeaturePreview(createFeatureEditingState(nextState, nextState.command, session))
      }

      const mode =
        event.toolId === 'line'
          || event.toolId === 'rectangle'
          || event.toolId === 'circle'
          || isRegisteredSketchConstraintToolId(event.toolId)
          ? 'sketch'
          : state.mode
      const filter = getSelectionFilterForCommand(event.toolId, mode)

      return {
        state: createCommandState(
          state,
          event.toolId,
          mode,
          filter,
          createSelectionPreview(state, filter),
        ),
        effects: [],
      }
    }
    case 'command.cancelled': {
      if (state.kind === 'idle') {
        return {
          state,
          effects: [],
        }
      }

      if (state.command.commandSessionId !== event.commandSessionId) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: toIdleState(state, state.kind === 'editingSketch' ? 'part' : state.mode),
        effects: [],
      }
    }
    case 'command.commitRequested':
      if (state.kind === 'editingFeature' && state.command.commandSessionId === event.commandSessionId) {
        return emitFeatureCommit(state)
      }

      return {
        state,
        effects: [],
      }
    case 'viewport.hoverCleared':
      if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
        const session = updateSketchConstraintHover(state.session, null)

        return {
          state: {
            ...state,
            hoverTarget: null,
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }

      return {
        state: withPreview(
          {
            ...state,
            hoverTarget: null,
          },
          state.kind === 'editingSketch'
            ? {
                kind: 'sketch',
                label: getSketchSessionPreviewLabel(state.session),
                target: state.session.planeTarget,
              }
            : state.kind === 'selectionCommand'
              ? createSelectionPreview(state, state.selectionFilter)
              : state.kind === 'editingFeature'
                ? createFeatureSelectionPreview(state.session)
                : state.preview,
        ),
        effects: [],
      }
    case 'viewport.hovered':
      if (
        !selectionFilterAllowsTarget(
          state.selectionFilter,
          state.selection,
          event.target,
          state.selectionCatalog,
        )
      ) {
        return {
          state,
          effects: [],
        }
      }

      if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
        const session = updateSketchConstraintHover(state.session, event.target)

        return {
          state: {
            ...state,
            hoverTarget: event.target,
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }

      return {
        state: withPreview(
          {
            ...state,
            hoverTarget: event.target,
          },
          state.kind === 'selectionCommand'
            ? {
                kind: 'selection',
                label: getSelectionPreviewLabel(state.selectionFilter, event.target, 'hover'),
                target: event.target,
              }
            : state.preview,
        ),
        effects: [],
      }
    case 'viewport.selectionRequested': {
      if (
        !selectionFilterAllowsTarget(
          state.selectionFilter,
          state.selection,
          event.target,
          state.selectionCatalog,
        )
      ) {
        return {
          state: withPreview(state, {
            kind: 'selection',
            label: getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
            target: state.preview?.target ?? null,
          }),
          effects: [],
        }
      }

      if (state.kind === 'selectionCommand' && state.command.toolId === 'sketch') {
        return emitSketchOpen(
          {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
          },
          [event.target],
        )
      }

      if (state.kind === 'editingFeature') {
        const activeReferenceField = getActiveReferencePickerField(state)
        const nextSelection = [event.target]
        const nextSession: FeatureEditSessionState = {
          ...(activeReferenceField
            ? patchFeatureEditSession(
                state.session,
                createFeatureEditorReferenceSelectionPatch(activeReferenceField, event.target),
              )
            : applySelectionToFeatureEditSession(state.session, event.target)),
          status: 'idle',
        }

        return emitFeaturePreview({
          ...state,
          selection: nextSelection,
          hoverTarget: event.target,
          command: {
            ...state.command,
            phase: 'collecting',
          },
          preview: createFeatureSelectionPreview(nextSession, 'Selected'),
          session: nextSession,
          activeReferencePickerFieldId: activeReferenceField?.id ?? state.activeReferencePickerFieldId,
          pendingPreviewRequestId: null,
        })
      }

      if (
        state.kind === 'editingSketch'
        && (event.target.kind === 'constraint' || event.target.kind === 'dimension')
      ) {
        const session = selectSketchAnnotation(state.session, event.target)

        return {
          state: {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }

      if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
        const session = selectSketchConstraintTarget(state.session, event.target)

        return {
          state: {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
            session,
            command: {
              ...state.command,
              phase: 'collecting',
            },
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }

      if (state.kind === 'editingSketch' && event.target.kind === 'sketchPoint') {
        const session = selectSketchEditTarget(state.session, event.target)

        return {
          state: {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }

      const candidate = resolveSelectionCandidate(
        state.selectionFilter,
        state.selection,
        event.target,
        state.selectionCatalog,
      )

      if (!candidate.accepted) {
        return {
          state,
          effects: [],
        }
      }

      if (state.kind === 'selectionCommand') {
        return {
          state: {
            ...state,
            selection: candidate.nextSelection,
            hoverTarget: event.target,
            command: {
              ...state.command,
              phase: 'collecting',
            },
            preview: {
              kind: 'selection',
              label: getSelectionPreviewLabel(state.selectionFilter, event.target, 'select'),
              target: event.target,
            },
          },
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          selection: candidate.nextSelection,
          hoverTarget: event.target,
        },
        effects: [],
      }
    }
    case 'authoring.reopenRequested': {
      if (event.target.kind === 'sketch' && event.toolId === 'sketch') {
        const nextState = createCommandState(
          state,
          'sketch',
          state.mode,
          sketchStartSelectionFilter,
          createSelectionPreview(state, sketchStartSelectionFilter),
        )

        return emitSketchOpen(
          {
            ...nextState,
            selection: [event.target],
            hoverTarget: event.target,
          },
          [event.target],
        )
      }

      if (event.target.kind !== 'feature' || !isFeatureTool(event.toolId)) {
        return {
          state,
          effects: [],
        }
      }

      const selectionFilter = getSelectionFilterForFeatureType(event.toolId)
      const nextState = createCommandState(
        state,
        event.toolId,
        'part',
        selectionFilter,
        createSelectionPreview(state, selectionFilter),
      )

      return emitFeatureHydration(
        {
          ...nextState,
          selection: [event.target],
          hoverTarget: event.target,
        },
        event.target.featureId,
      )
    }
    case 'sketch.geometryDragStarted':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const point = deriveSketchPointFromWorld(state.session.plane, event.point)
        const session = beginSketchGeometryDrag(state.session, event.target, point)

        return {
          state: {
            ...state,
            selection: event.target.kind === 'sketchPoint' ? [event.target] : state.selection,
            hoverTarget: event.target.kind === 'sketchPoint' ? event.target : state.hoverTarget,
            session,
            command: {
              ...state.command,
              phase: 'editing',
            },
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.geometryDragMoved':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = updateSketchGeometryDrag(
          state.session,
          deriveSketchPointFromWorld(state.session.plane, event.point),
        )

        return {
          state: {
            ...state,
            session,
            command: {
              ...state.command,
              phase: 'editing',
            },
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.geometryDragEnded':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = finishSketchGeometryDrag(
          state.session,
          deriveSketchPointFromWorld(state.session.plane, event.point),
        )

        return {
          state: {
            ...state,
            session,
            command: {
              ...state.command,
              phase: 'editing',
            },
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.pointerMoved':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = updateSketchPointer(
          state.session,
          deriveSketchPointFromWorld(state.session.plane, event.point),
        )

        return {
          state: {
            ...state,
            session,
            command: {
              ...state.command,
              phase: session.status === 'drawing' ? 'editing' : 'collecting',
            },
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.pointerReleased':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const point = deriveSketchPointFromWorld(state.session.plane, event.point)
        const session =
          state.session.constraintAuthoring
            ? pinSketchConstraintPreview(state.session, point)
            : state.session.status === 'drawing'
            ? acceptSketchDraw(state.session, point)
            : startSketchDraw(state.session, point)

        return {
          state: {
            ...state,
            session,
            command: {
              ...state.command,
              phase: session.status === 'drawing' ? 'editing' : 'collecting',
            },
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.toolPatched':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      if (state.session.constraintAuthoring || state.session.activeAnnotationEdit) {
        const session = patchSketchConstraintValue(state.session, event.patch)

        return {
          state: {
            ...state,
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          preview: {
            kind: 'sketch',
            label: getSketchSessionPreviewLabel(state.session),
            target: state.session.planeTarget,
          },
        },
        effects: [],
      }
    case 'sketch.activeToolCleared':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = clearActiveSketchTool(state.session)

        return {
          state: {
            ...state,
            selection: [],
            hoverTarget: null,
            session,
            command: {
              ...state.command,
              toolId: 'sketch',
              phase: 'editing',
            },
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.historyCursorRequested':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = moveSketchHistoryCursor(state.session, event.cursor)

        return {
          state: {
            ...state,
            selection: [],
            hoverTarget: null,
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.annotationDeleteRequested':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = deleteSelectedSketchAnnotation(state.session)

        return {
          state: {
            ...state,
            selection: [],
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'sketch.annotationEditRequested':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = beginSketchAnnotationEdit(state.session, event.target)

        return {
          state: {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
            session,
            preview: {
              kind: 'sketch',
              label: getSketchSessionPreviewLabel(session),
              target: session.planeTarget,
            },
          },
          effects: [],
        }
      }
    case 'form.featurePatched': {
      if (state.kind !== 'editingFeature') {
        return {
          state,
          effects: [],
        }
      }

      const nextSession = {
        ...patchFeatureEditSession(state.session, event.patch),
        status: 'idle' as const,
      }

      return emitFeaturePreview({
        ...state,
        session: nextSession,
        pendingPreviewRequestId: null,
        preview: createFeatureSelectionPreview(nextSession),
      })
    }
    case 'form.referencePickerActivated': {
      if (state.kind !== 'editingFeature') {
        return {
          state,
          effects: [],
        }
      }

      const field = getFeatureEditorFormField(state.session, event.fieldId)

      if (field?.kind !== 'referencePicker' && field?.kind !== 'referenceCollection') {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          activeReferencePickerFieldId: field.id,
          selection: [],
          hoverTarget: null,
          selectionFilter: field.picker.selectionFilter,
          preview: createSelectionPreview({ ...state, selection: [] }, field.picker.selectionFilter),
          command: {
            ...state.command,
            phase: 'collecting',
          },
        },
        effects: [],
      }
    }
    case 'form.referencePickerCancelled': {
      if (state.kind !== 'editingFeature' || !state.activeReferencePickerFieldId) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          activeReferencePickerFieldId: null,
          selection: [],
          hoverTarget: null,
          selectionFilter: getSelectionFilterForFeatureType(state.session.featureType),
          preview: createFeatureSelectionPreview(state.session),
          command: {
            ...state.command,
            phase: 'editing',
          },
        },
        effects: [],
      }
    }
    case 'document.refreshRequested':
      return emitSnapshotFetch(state, null)
    case 'effect.snapshotLoaded':
      if (state.pendingSnapshotRequestId !== event.payload.requestId) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: updateStateDocument(state, event.payload),
        effects: [],
      }
    case 'effect.snapshotFailed':
      if (
        state.pendingSnapshotRequestId !== event.requestId ||
        !eventMatchesOptionalDocument(state, event.documentId, event.revisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: withPreview(
          {
            ...state,
            pendingSnapshotRequestId: null,
          },
          {
            kind: 'selection',
            label: event.error,
            target: state.selection[0] ?? null,
          },
        ),
        effects: [],
      }
    case 'effect.sketchSessionOpened':
      if (
        state.kind !== 'selectionCommand' ||
        state.command.toolId !== 'sketch' ||
        state.pendingRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        !eventMatchesDocument(state, event.documentId, event.revisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          kind: 'editingSketch',
          mode: 'sketch',
          document: state.document,
          snapshot: state.snapshot,
          previewRenderables: null,
          selection:
            event.session.sketchId === null
              ? [event.session.planeTarget]
              : [{ kind: 'sketch', sketchId: event.session.sketchId }],
          hoverTarget: null,
          selectionFilter: getDefaultSelectionFilterForMode('sketch'),
          selectionCatalog: state.selectionCatalog,
          preview: {
            kind: 'sketch',
            label: getSketchSessionPreviewLabel(event.session),
            target: event.session.planeTarget,
          },
          nextCommandSequence: state.nextCommandSequence,
          nextRequestSequence: state.nextRequestSequence,
          pendingSnapshotRequestId: state.pendingSnapshotRequestId,
          command: {
            ...state.command,
            phase: 'editing',
          },
          session: event.session,
          pendingCommitRequestId: null,
        },
        effects: [],
      }
    case 'effect.sketchSessionOpenFailed':
      if (
        state.kind !== 'selectionCommand' ||
        state.command.toolId !== 'sketch' ||
        state.pendingRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        !eventMatchesDocument(state, event.documentId, event.revisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: withPreview(
          {
            ...state,
            pendingRequestId: null,
            command: {
              ...state.command,
              phase: 'armed',
            },
          },
          {
            kind: 'selection',
            label: event.message,
            target: state.selection[0] ?? null,
          },
        ),
        effects: [],
      }
    case 'effect.featureSessionHydrated':
      if (
        state.kind !== 'selectionCommand' ||
        !isFeatureTool(state.command.toolId) ||
        state.pendingRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        !eventMatchesDocument(state, event.documentId, event.revisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return emitFeaturePreview(
        createFeatureEditingState(
          {
            ...state,
            pendingRequestId: null,
          },
          state.command,
          event.session,
        ),
      )
    case 'effect.featureSessionHydrationFailed':
      if (
        state.kind !== 'selectionCommand' ||
        !isFeatureTool(state.command.toolId) ||
        state.pendingRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        !eventMatchesDocument(state, event.documentId, event.revisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: withPreview(
          {
            ...state,
            pendingRequestId: null,
          },
          {
            kind: 'selection',
            label: event.message,
            target: state.selection[0] ?? null,
          },
        ),
        effects: [],
      }
    case 'effect.featurePreviewCompleted':
      if (
        state.kind !== 'editingFeature' ||
        state.pendingPreviewRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        state.document.revisionId !== event.baseRevisionId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          pendingPreviewRequestId: null,
          previewRenderables: event.stale ? null : event.renderables,
          command: {
            ...state.command,
            phase: 'editing',
          },
          session: {
            ...state.session,
            status: event.stale ? 'idle' : 'previewReady',
            diagnostics: event.diagnostics,
            lastPreviewRevisionId: event.revisionId,
          },
        },
        effects: [],
      }
    case 'effect.featurePreviewFailed':
      if (
        state.kind !== 'editingFeature' ||
        state.pendingPreviewRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        state.document.revisionId !== event.baseRevisionId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          pendingPreviewRequestId: null,
          previewRenderables: null,
          command: {
            ...state.command,
            phase: 'editing',
          },
          session: {
            ...state.session,
            status: 'idle',
            diagnostics: createPreviewFailedDiagnostics(
              event.message,
              getFeaturePrimarySelectionTarget(state.session),
            ),
          },
        },
        effects: [],
      }
    case 'effect.featureCommitted':
      if (
        state.kind !== 'editingFeature' ||
        state.pendingCommitRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        state.document.revisionId !== event.baseRevisionId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      if (!event.accepted) {
        return {
          state: {
            ...state,
            pendingCommitRequestId: null,
            previewRenderables: null,
            command: {
              ...state.command,
              phase: 'editing',
            },
            session: {
              ...state.session,
              status: 'idle',
              diagnostics: event.diagnostics,
              lastPreviewRevisionId: event.actualRevisionId ?? state.session.lastPreviewRevisionId,
            },
          },
          effects: [],
        }
      }

      {
        const idleState = withPreview(
          toIdleState(
            {
              ...state,
              document: {
                ...state.document,
                revisionId: event.revisionId,
              },
            },
            'part',
          ),
          {
            kind: 'selection',
            label: `Committed feature ${event.featureId}`,
            target: { kind: 'feature', featureId: event.featureId },
          },
        )

        const refresh = emitSnapshotFetch(idleState, state.command.commandSessionId)

        return {
          state: refresh.state,
          effects: refresh.effects,
        }
      }
    case 'effect.featureCommitFailed':
      if (
        state.kind !== 'editingFeature' ||
        state.pendingCommitRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        state.document.revisionId !== event.baseRevisionId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          pendingCommitRequestId: null,
          previewRenderables: null,
          command: {
            ...state.command,
            phase: 'editing',
          },
            session: {
              ...state.session,
              status: 'idle',
              diagnostics: [
                {
                  code: 'feature-commit-failed',
                  severity: 'error',
                  message: event.message,
                  target: getFeaturePrimarySelectionTarget(state.session),
                  detail: null,
                },
              ],
          },
        },
        effects: [],
      }
    case 'effect.sketchCommitted':
      if (
        state.kind !== 'editingSketch' ||
        state.pendingCommitRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        state.document.revisionId !== event.baseRevisionId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      if (!event.accepted) {
        return {
          state: {
            ...state,
            pendingCommitRequestId: null,
            command: {
              ...state.command,
              phase: 'editing',
            },
            preview: {
              kind: 'sketch',
              label:
                event.diagnostics[0]?.message ??
                `Sketch commit rejected due to revision conflict (${event.actualRevisionId ?? 'unknown'}).`,
              target: state.session.planeTarget,
            },
          },
          effects: [],
        }
      }

      {
        const idleState = toIdleState(
          {
            ...state,
            document: {
              ...state.document,
              revisionId: event.revisionId,
            },
          },
          'part',
        )

        const refresh = emitSnapshotFetch(idleState, state.command.commandSessionId)

        return {
          state: refresh.state,
          effects: refresh.effects,
        }
      }
    case 'effect.sketchCommitFailed':
      if (
        state.kind !== 'editingSketch' ||
        state.pendingCommitRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        state.document.revisionId !== event.baseRevisionId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          pendingCommitRequestId: null,
          command: {
            ...state.command,
            phase: 'editing',
          },
          preview: {
            kind: 'sketch',
            label: event.message,
            target: state.session.planeTarget,
          },
        },
        effects: [],
      }
    default:
      return {
        state,
        effects: [],
      }
  }
}

/**
 * Executes one explicit editor effect against the provided runtime and converts
 * the outcome back into a single typed editor event. Callers are responsible for
 * dispatching the returned event back through `transitionEditorState`.
 */
export async function runEditorEffect(
  effect: EditorEffect,
  runtime: EditorEffectRuntime,
): Promise<EditorEvent> {
  switch (effect.type) {
    case 'document.fetchSnapshot': {
      try {
        const snapshot = await runtime.getCurrentDocumentSnapshot()

        return {
          type: 'effect.snapshotLoaded',
          payload: {
            requestId: effect.requestId,
            documentId: snapshot.documentId,
            revisionId: snapshot.revisionId,
            snapshot,
            selectionCatalog: buildSelectionTargetCatalog(snapshot),
          },
        }
      } catch (error: unknown) {
        return {
          type: 'effect.snapshotFailed',
          requestId: effect.requestId,
          documentId: effect.documentId,
          revisionId: effect.revisionId,
          error: error instanceof Error ? error.message : 'Snapshot refresh failed.',
        }
      }
    }
    case 'sketch.openSession': {
      try {
        const snapshot = await runtime.getCurrentDocumentSnapshot()
        const session = openSketchSessionFromSelection(effect.selection.slice(), snapshot)

        if (!session) {
          return {
            type: 'effect.sketchSessionOpenFailed',
            requestId: effect.requestId,
            documentId: snapshot.documentId,
            revisionId: snapshot.revisionId,
            commandSessionId: effect.commandSessionId,
            message: 'Sketch requires an existing sketch, construction plane, or planar face selection.',
          }
        }

        return {
          type: 'effect.sketchSessionOpened',
          requestId: effect.requestId,
          documentId: snapshot.documentId,
          revisionId: snapshot.revisionId,
          commandSessionId: effect.commandSessionId,
          session,
        }
      } catch (error: unknown) {
        return {
          type: 'effect.sketchSessionOpenFailed',
          requestId: effect.requestId,
          documentId: effect.documentId,
          revisionId: effect.revisionId,
          commandSessionId: effect.commandSessionId,
          message: error instanceof Error ? error.message : 'Sketch session could not be opened.',
        }
      }
    }
    case 'feature.hydrateFromSelection': {
      try {
        const snapshot = await runtime.getCurrentDocumentSnapshot()
        const session = hydrateFeatureSessionFromSnapshot(snapshot, effect.selectedFeatureId)

        if (!session) {
          return {
            type: 'effect.featureSessionHydrationFailed',
            requestId: effect.requestId,
            documentId: snapshot.documentId,
            revisionId: snapshot.revisionId,
            commandSessionId: effect.commandSessionId,
            message: `Feature ${effect.selectedFeatureId} cannot be edited in the current feature session flow.`,
          }
        }

        return {
          type: 'effect.featureSessionHydrated',
          requestId: effect.requestId,
          documentId: snapshot.documentId,
          revisionId: snapshot.revisionId,
          commandSessionId: effect.commandSessionId,
          session,
        }
      } catch (error: unknown) {
        return {
          type: 'effect.featureSessionHydrationFailed',
          requestId: effect.requestId,
          documentId: effect.documentId,
          revisionId: effect.revisionId,
          commandSessionId: effect.commandSessionId,
          message: error instanceof Error ? error.message : 'Feature session hydration failed.',
        }
      }
    }
    case 'feature.evaluatePreview': {
      try {
        const result = await runtime.evaluatePreview({
          baseRevisionId: effect.baseRevisionId,
          featureSession: effect.featureSession,
        })

        return {
          type: 'effect.featurePreviewCompleted',
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          revisionId: result.revisionId,
          stale: result.stale,
          diagnostics: result.diagnostics,
          renderables: result.renderables,
        }
      } catch (error: unknown) {
        return {
          type: 'effect.featurePreviewFailed',
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          message: error instanceof Error ? error.message : 'Feature preview failed.',
        }
      }
    }
    case 'feature.commit': {
      try {
        const result = await runtime.commitFeature({
          baseRevisionId: effect.baseRevisionId,
          featureSession: effect.featureSession,
        })

        return {
          type: 'effect.featureCommitted',
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          revisionId: result.revisionId,
          featureId: result.featureId,
          accepted: result.accepted,
          diagnostics: result.diagnostics,
          actualRevisionId: result.actualRevisionId,
        }
      } catch (error: unknown) {
        return {
          type: 'effect.featureCommitFailed',
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          message: error instanceof Error ? error.message : 'Feature commit failed.',
        }
      }
    }
    case 'sketch.commit': {
      try {
        const result = await runtime.commitSketch({
          requestId: effect.requestId,
          baseRevisionId: effect.baseRevisionId,
          session: effect.session,
        })

        if (!result) {
          return {
            type: 'effect.sketchCommitted',
            requestId: effect.requestId,
            documentId: effect.documentId,
            commandSessionId: effect.commandSessionId,
            baseRevisionId: effect.baseRevisionId,
            revisionId: effect.baseRevisionId,
            accepted: true,
            diagnostics: [],
          }
        }

        return {
          type: 'effect.sketchCommitted',
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          revisionId: result.revisionId,
          accepted: result.accepted,
          diagnostics: result.diagnostics,
          actualRevisionId: result.actualRevisionId,
        }
      } catch (error: unknown) {
        return {
          type: 'effect.sketchCommitFailed',
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          message: error instanceof Error ? error.message : 'Sketch commit failed.',
        }
      }
    }
    default:
      return {
        type: 'effect.snapshotFailed',
        requestId: 'request_unreachable',
        documentId: null,
        revisionId: null,
        error: 'Unsupported effect.',
      }
  }
}

/**
 * Creates a minimal effect runtime adapter over the modeling service boundary.
 * This keeps the provider thin while preserving the same explicit effect/event contracts
 * used by replay tests.
 */
export function createModelingServiceEditorEffectRuntime(modelingService: {
  getCurrentDocumentSnapshot(): Promise<DocumentSnapshot>
  sketchSolver: {
    createCommitCorrelation(requestId: RequestId): {
      requestId: RequestId
      projectionRequestId: RequestId
      validationRequestId: RequestId
      solveRequestId: RequestId
      regionRequestId: RequestId
    }
  } | null
  commitSketch: (input: {
    requestId: RequestId
    baseRevisionId: RevisionId
    sketchId: SketchSessionState['commitRequest'] extends null
      ? never
      : NonNullable<SketchSessionState['commitRequest']>['sketchId']
    sketchLabel: SketchSessionState['commitRequest'] extends null
      ? never
      : NonNullable<SketchSessionState['commitRequest']>['sketchLabel']
    plane: SketchPlaneDefinition
    planeTarget: SketchSessionState['commitRequest'] extends null
      ? never
      : NonNullable<SketchSessionState['commitRequest']>['planeTarget']
    planeKey: SketchSessionState['commitRequest'] extends null
      ? never
      : NonNullable<SketchSessionState['commitRequest']>['planeKey']
    definition: SketchSessionState['commitRequest'] extends null
      ? never
      : NonNullable<SketchSessionState['commitRequest']>['definition']
    solverCorrelation: {
      requestId: RequestId
      projectionRequestId: RequestId
      validationRequestId: RequestId
      solveRequestId: RequestId
      regionRequestId: RequestId
    } | null
  }) => Promise<{
    revisionId: RevisionId
    revisionState:
      | { kind: 'accepted' }
      | { kind: 'conflict'; actualRevisionId: RevisionId }
      | { kind: 'rejected'; reasonCode: string }
    diagnostics: ModelingDiagnostic[]
  }>
  evaluatePreview: (input: {
    baseRevisionId: RevisionId
    previewId: FeatureEditSessionState['previewId']
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>
  }) => Promise<{
    revisionId: RevisionId
    stale: boolean
    diagnostics: ModelingDiagnostic[]
    renderables: RenderableEntityRecord[]
  }>
  createFeature: (input: {
    baseRevisionId: RevisionId
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>
  }) => Promise<{
    revisionId: RevisionId
    featureId: FeatureId
    revisionState:
      | { kind: 'accepted' }
      | { kind: 'conflict'; actualRevisionId: RevisionId }
      | { kind: 'rejected'; reasonCode: string }
    diagnostics: ModelingDiagnostic[]
  }>
  updateFeature: (input: {
    baseRevisionId: RevisionId
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>
    featureId: FeatureId
  }) => Promise<{
    revisionId: RevisionId
    featureId: FeatureId
    revisionState:
      | { kind: 'accepted' }
      | { kind: 'conflict'; actualRevisionId: RevisionId }
      | { kind: 'rejected'; reasonCode: string }
    diagnostics: ModelingDiagnostic[]
  }>
}): EditorEffectRuntime {
  return {
    getCurrentDocumentSnapshot: () => modelingService.getCurrentDocumentSnapshot(),
    async commitSketch(input) {
      const result = await modelingService.commitSketch({
        requestId: input.requestId,
        baseRevisionId: input.baseRevisionId,
        sketchId: input.session.commitRequest?.sketchId ?? null,
        sketchLabel: input.session.commitRequest?.sketchLabel ?? input.session.sketchLabel,
        plane: input.session.commitRequest?.plane ?? input.session.plane,
        planeTarget: assertSketchPlaneSupport(input.session.commitRequest?.planeTarget ?? input.session.planeTarget),
        planeKey: input.session.commitRequest?.planeKey ?? input.session.planeKey,
        definition: input.session.commitRequest?.definition ?? input.session.definition,
        solverCorrelation: modelingService.sketchSolver
          ? modelingService.sketchSolver.createCommitCorrelation(input.requestId)
          : null,
      })

      if (!result) {
        return null
      }

      return {
        revisionId: result.revisionId,
        accepted: result.revisionState.kind === 'accepted',
        diagnostics: result.diagnostics,
        actualRevisionId:
          result.revisionState.kind === 'conflict' ? result.revisionState.actualRevisionId : undefined,
      }
    },
    async evaluatePreview(input) {
      const definition = buildFeatureDefinition(input.featureSession)

      if (!definition) {
        throw new Error('Feature preview failed because the draft is incomplete.')
      }

      const result = await modelingService.evaluatePreview({
        baseRevisionId: input.baseRevisionId,
        previewId: input.featureSession.previewId,
        definition,
      })

      return {
        revisionId: result.revisionId,
        stale: result.stale,
        diagnostics: result.diagnostics,
        renderables: result.renderables,
      }
    },
    async commitFeature(input) {
      const definition = buildFeatureDefinition(input.featureSession)

      if (!definition) {
        throw new Error('Feature commit failed because the draft is incomplete.')
      }

      const baseInput = {
        baseRevisionId: input.baseRevisionId,
        definition,
      }

      const result =
        input.featureSession.mode === 'edit' && input.featureSession.featureId
          ? await modelingService.updateFeature({
              ...baseInput,
              featureId: input.featureSession.featureId,
            })
          : await modelingService.createFeature({
              ...baseInput,
            })

      return {
        revisionId: result.revisionId,
        featureId: result.featureId,
        accepted: result.revisionState.kind === 'accepted',
        diagnostics: result.diagnostics,
        actualRevisionId:
          result.revisionState.kind === 'conflict' ? result.revisionState.actualRevisionId : undefined,
      }
    },
  }
}

/**
 * Flattened UI-facing view derived from the machine state.
 * Presentational components should depend on this shape rather than inferring
 * workflow from React-local effects.
 */
export interface EditorViewState {
  /** Current toolbar mode derived from the machine state. */
  mode: ToolbarMode
  /** Active command metadata, or null if the editor is idle. */
  activeCommand: EditorActiveCommand | null
  /** Current durable selection owned by the editor. */
  selection: PrimitiveRef[]
  /** Derived selection catalog used by the UI for affordances and filters. */
  selectionCatalog: SelectionTargetCatalog | null
  /** Active selection filter for the current command context. */
  selectionFilter: SelectionFilter | null
  /** Current hovered durable target, or null when nothing is hovered. */
  hoverTarget: PrimitiveRef | null
  /** Current command or sketch preview message. */
  preview: CommandPreview | null
  /** Active feature edit session, or null when not editing a feature. */
  activeEditSession: FeatureEditSessionState | null
  /** Active feature form reference picker field id, or null when no field is collecting selections. */
  activeReferencePickerFieldId: string | null
  /** Active sketch session, or null when not editing a sketch. */
  sketchSession: SketchSessionState | null
  /** Last loaded document snapshot owned by the machine. */
  snapshot: DocumentSnapshot | null
  /** Most recent accepted preview renderables, or null when none are active. */
  previewRenderables: RenderableEntityRecord[] | null
}

/**
 * Derives the view state exposed to React components from the discriminated machine state.
 */
export function getEditorViewState(state: EditorState): EditorViewState {
  return {
    mode: state.mode,
    activeCommand: state.kind === 'idle' ? null : state.command,
    selection: state.selection,
    selectionCatalog: state.selectionCatalog,
    selectionFilter: state.selectionFilter,
    hoverTarget: state.hoverTarget,
    preview: state.preview,
    activeEditSession: state.kind === 'editingFeature' ? state.session : null,
    activeReferencePickerFieldId: state.kind === 'editingFeature' ? state.activeReferencePickerFieldId : null,
    sketchSession: state.kind === 'editingSketch' ? state.session : null,
    snapshot: state.snapshot,
    previewRenderables: state.previewRenderables,
  }
}

/**
 * Hydrates an extrude feature session from a selected feature snapshot.
 * This helper is used by the effect runtime and intentionally stays pure.
 */
export function hydrateFeatureSessionFromSnapshot(
  snapshot: DocumentSnapshot,
  featureId: FeatureId,
): FeatureEditSessionState | null {
  const feature = snapshot.features.find((entry) => entry.featureId === featureId)

  return feature ? hydrateFeatureEditSession(feature) : null
}

/**
 * Minimal deterministic replay helper used by tests to prove that identical event traces
 * produce identical machine state and effect envelopes.
 */
export function replayEditorEvents(events: readonly EditorEvent[]): EditorTransitionResult {
  let state = initialEditorState
  const effects: EditorEffect[] = []

  for (const event of events) {
    const result = transitionEditorState(state, event)
    state = result.state
    effects.push(...result.effects)
  }

  return { state, effects }
}

/**
 * Executes an event trace end-to-end by running every emitted effect immediately
 * through the provided runtime. This is intended for deterministic runtime-loop tests.
 */
export async function replayEditorEventsWithRuntime(
  events: readonly EditorEvent[],
  runtime: EditorEffectRuntime,
): Promise<EditorTransitionResult> {
  let state = initialEditorState
  const effects: EditorEffect[] = []

  for (const event of events) {
    const initial = transitionEditorState(state, event)
    state = initial.state
    effects.push(...initial.effects)

    let queue = [...initial.effects]

    while (queue.length > 0) {
      const effect = queue.shift()

      if (!effect) {
        break
      }

      const effectEvent = await runEditorEffect(effect, runtime)
      const next = transitionEditorState(state, effectEvent)
      state = next.state
      effects.push(...next.effects)
      queue = [...queue, ...next.effects]
    }
  }

  return { state, effects }
}

/**
 * Stable selection key helper re-exported for runtime/event tests.
 */
export const getEditorSelectionKey = getPrimitiveRefKey
