import type { ToolId } from '@/core/tools/tool-registry'
import type { ToolbarMode } from '@/core/tools/schema'
import type { FeatureEditSessionState } from '@/domain/editor/feature-editing'
import type { FeatureDraftPatch } from '@/domain/editor/feature-editing'
import type {
  FeatureEditorFormSchema,
} from '@/core/feature-authoring/form-schema'
import type {
  SketchSpecialModeHandleRef,
  SketchSpecialModeId,
  SketchSpecialModePanelAction,
} from '@/core/sketch-special-modes/schema'
import type {
  CommandPreview,
  PrimitiveRef,
  SelectionFilter,
  SelectionTargetCatalog,
} from '@/core/editor/schema'
import type { SectionViewSession, Vec3 } from '@/core/section-view/session'
import type {
  SketchSessionState,
  SketchHistoryCursor,
} from '@/domain/editor/sketch-session'
import type { SketchPlaneEditSessionState } from '@/domain/editor/sketch-plane-editing'
import type {
  DocumentFeatureCursor,
  WorkspaceSnapshot,
  ModelingDiagnostic,
  SnapshotMutationBasis,
} from '@/contracts/modeling/schema'
import type { ReferenceImagePayload } from '@/contracts/reference-image/schema'
import type { ImportReviewEnvelope } from '@/contracts/import/review'
import type { ResolvedImportSource } from '@/contracts/import/source'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type {
  CommandSessionId,
  DocumentId,
  FeatureId,
  RequestId,
  RevisionId,
  SketchAuthoringOperationId,
} from '@/contracts/shared/ids'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import type {
  AppErrorContextEntry,
} from '@/contracts/errors'
import type { DocumentHistoryOrderEntry } from '@/domain/modeling/document-history'

export type EditorCommandToolId = ToolId | 'sketchPlaneEdit'

/**
 * Visible command metadata derived from the active machine state.
 * The command session ID is deterministic so event replay reaches the same state.
 */
export interface EditorActiveCommand {
  /** Stable editor-owned correlation ID for the active command session. */
  commandSessionId: CommandSessionId
  /** Tool that opened the active command session. */
  toolId: EditorCommandToolId
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

export interface EditSessionCursorContext {
  /** Committed sketch or feature being edited through rollback-aware re-entry. */
  target: DocumentHistoryOrderEntry
  /** Editor workflow that should resume after the rollback refresh completes. */
  sessionKind: 'sketchAuthoring' | 'featureEdit' | 'sketchPlaneEdit'
  /** Document cursor immediately before the committed item being edited. */
  rollbackCursor: DocumentFeatureCursor
  /** Exact document cursor that was active before edit entry. */
  restoreCursor: DocumentFeatureCursor
  /** Cursor lifecycle phase used to sequence rollback, edit opening, and restoration. */
  phase: 'rollingBack' | 'opening' | 'active' | 'restorePending' | 'restoring'
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
  snapshot: WorkspaceSnapshot | null
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
  /** Document history cursor mutation currently in flight, or null when no history move is pending. */
  pendingHistoryCursorRequestId: RequestId | null
  /** Cursor rollback/restore context for an active committed-item edit session. */
  editSessionCursorContext: EditSessionCursorContext | null
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
  /** Explicit correlation ID for an in-flight sketch reference projection request. */
  pendingProjectionRequestId: RequestId | null
  /** Explicit correlation ID for an in-flight sketch reference-image import request. */
  pendingImportRequestId: RequestId | null
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

export interface SketchPlaneEditorState extends EditorStateBase {
  kind: 'editingSketchPlane'
  command: EditorActiveCommand
  session: SketchPlaneEditSessionState
  activeReferencePickerFieldId: string | null
  pendingCommitRequestId: RequestId | null
}

export interface ImportSessionState {
  providerId: string
  resolvedSource: ResolvedImportSource
  review: ImportReviewEnvelope<unknown>
  selections: unknown
  formSchema: FeatureEditorFormSchema
  diagnostics: ModelingDiagnostic[]
}

export interface ImportEditorState extends EditorStateBase {
  kind: 'importing'
  command: EditorActiveCommand
  session: ImportSessionState
  activeReferencePickerFieldId: string | null
}

/**
 * Active temporary section-view inspection state.
 * The editor owns the accepted planar seed, section plane, and retained-side state.
 */
export interface SectionViewEditorState extends EditorStateBase {
  kind: 'inspectingSection'
  command: EditorActiveCommand
  section: SectionViewSession
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
  | SketchPlaneEditorState
  | ImportEditorState
  | SectionViewEditorState

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
  snapshot: WorkspaceSnapshot
  /** Derived selection catalog built from `snapshot` for command filtering. */
  selectionCatalog: SelectionTargetCatalog
  /** Keep prior viewport render records when this snapshot contains repairable feature errors. */
  preserveRenderRecordsOnFeatureDiagnostics?: boolean
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

/** Applies a snapshot already accepted by a modeling action without another fetch round-trip. */
export interface DocumentSnapshotLoadedEvent {
  type: 'document.snapshotLoaded'
  /** Full typed snapshot payload to load into the editor runtime. */
  snapshot: WorkspaceSnapshot
}

/** Replaces the active document basis through an explicit whole-document handoff. */
export interface DocumentReplacedEvent {
  type: 'document.replaced'
  /** Full typed snapshot payload that becomes the next authoritative document basis. */
  snapshot: WorkspaceSnapshot
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
  /** Current viewport camera position when the selection came from the viewport. */
  cameraPosition?: Vec3
}

/** Requests connected local sketch-entity selection from a viewport double-click. */
export interface SketchConnectedSelectionRequestedEvent {
  type: 'sketch.connectedSelectionRequested'
  /** Sketch entity target that seeds the connected-component selection. */
  target: PrimitiveRef
}

/** Clears the current editor-owned selection and hover target. */
export interface SelectionClearedEvent {
  type: 'selection.cleared'
}

/** Reopens committed feature or sketch authoring directly from a navigation surface. */
export interface AuthoringReopenRequestedEvent {
  type: 'authoring.reopenRequested'
  /** Durable target that should reopen in place. */
  target: PrimitiveRef
  /** Tool flow to use for the reopen request. */
  toolId: ToolId
}

export interface SketchPlaneEditRequestedEvent {
  type: 'sketchPlaneEdit.requested'
  target: Extract<PrimitiveRef, { kind: 'sketch' }>
}

export interface SketchPlaneEditPatchedEvent {
  type: 'sketchPlaneEdit.patched'
  patch: FeatureDraftPatch
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
  /** Durable target under the release point, when the viewport could resolve one. */
  target?: PrimitiveRef | null
}

export interface SketchReferenceImagePayloadsPickedEvent {
  type: 'sketch.referenceImagePayloadsPicked'
  payloads: readonly ReferenceImagePayload[] | null
  message?: string
}

export interface SketchSpecialModeEnteredEvent {
  type: 'sketch.specialModeEntered'
  modeId: SketchSpecialModeId
  operationId: SketchAuthoringOperationId
  payload?: Record<string, unknown>
}

export interface SketchSpecialModePanelActionInvokedEvent {
  type: 'sketch.specialModePanelActionInvoked'
  action: SketchSpecialModePanelAction
}

export interface SketchSpecialModeClickRequestedEvent {
  type: 'sketch.specialModeClickRequested'
  point: readonly [number, number]
  target?: PrimitiveRef | null
}

export interface SketchSpecialModeDoubleClickRequestedEvent {
  type: 'sketch.specialModeDoubleClickRequested'
  point: readonly [number, number]
  target?: PrimitiveRef | null
}

export interface SketchSpecialModeDragStartedEvent {
  type: 'sketch.specialModeDragStarted'
  handle: SketchSpecialModeHandleRef
  point: readonly [number, number]
}

export interface SketchSpecialModeDragMovedEvent {
  type: 'sketch.specialModeDragMoved'
  handle: SketchSpecialModeHandleRef
  point: readonly [number, number]
}

export interface SketchSpecialModeDragEndedEvent {
  type: 'sketch.specialModeDragEnded'
  handle: SketchSpecialModeHandleRef
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

/** Moves the document-level authored history cursor through the editor runtime. */
export interface DocumentHistoryCursorRequestedEvent {
  type: 'document.historyCursorRequested'
  /** Cursor position requested by document timeline, undo, or redo UI. */
  cursor: DocumentFeatureCursor
}

/** Requests an undo step in the active authored history context. */
export interface HistoryUndoRequestedEvent {
  type: 'history.undoRequested'
}

/** Requests a redo step in the active authored history context. */
export interface HistoryRedoRequestedEvent {
  type: 'history.redoRequested'
}

/** Replaces the active sketch draft with a repository-backed durable-history state. */
export interface SketchDraftHistoryRestoredEvent {
  type: 'sketch.draftHistoryRestored'
  session: SketchSessionState
}

/** Deletes a targeted sketch-local authoring-operation row from history. */
export interface SketchHistoryOperationDeleteRequestedEvent {
  type: 'sketch.historyOperationDeleteRequested'
  /** Durable sketch-local operation identity targeted by the history-row menu. */
  operationId: SketchAuthoringOperationId
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

export interface ImportFileSelectedEvent {
  type: 'import.fileSelected'
  session: ImportSessionState
}

export interface ImportProviderSelectedEvent {
  type: 'import.providerSelected'
  providerId: string
}

export interface ImportSelectionPatchedEvent {
  type: 'import.selectionPatched'
  patch: Record<string, unknown>
}

export interface ImportCommitRequestedEvent {
  type: 'import.commitRequested'
}

export interface ImportCancelledEvent {
  type: 'import.cancelled'
}

export interface ImportCommittedEvent {
  type: 'import.committed'
}

export interface ImportFailedEvent {
  type: 'import.failed'
  diagnostics: ModelingDiagnostic[]
}

/** Updates the active section plane offset along its normal. */
export interface SectionOffsetUpdatedEvent {
  type: 'section.offsetUpdated'
  commandSessionId: CommandSessionId
  offset: number
}

/** Flips which half-space is retained for the active section. */
export interface SectionFlipRequestedEvent {
  type: 'section.flipRequested'
  commandSessionId: CommandSessionId
}

/** Clears the active section-view session. */
export interface SectionClearedEvent {
  type: 'section.cleared'
  commandSessionId: CommandSessionId
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
  | DocumentSnapshotLoadedEvent
  | DocumentReplacedEvent
  | ViewportHoveredEvent
  | ViewportHoverClearedEvent
  | ViewportSelectionRequestedEvent
  | SketchConnectedSelectionRequestedEvent
  | SelectionClearedEvent
  | AuthoringReopenRequestedEvent
  | SketchPlaneEditRequestedEvent
  | SketchPlaneEditPatchedEvent
  | SketchPointerMovedEvent
  | SketchPointerReleasedEvent
  | SketchReferenceImagePayloadsPickedEvent
  | SketchSpecialModeEnteredEvent
  | SketchSpecialModePanelActionInvokedEvent
  | SketchSpecialModeClickRequestedEvent
  | SketchSpecialModeDoubleClickRequestedEvent
  | SketchSpecialModeDragStartedEvent
  | SketchSpecialModeDragMovedEvent
  | SketchSpecialModeDragEndedEvent
  | SketchGeometryDragStartedEvent
  | SketchGeometryDragMovedEvent
  | SketchGeometryDragEndedEvent
  | SketchToolPatchedEvent
  | SketchActiveToolClearedEvent
  | SketchHistoryCursorRequestedEvent
  | DocumentHistoryCursorRequestedEvent
  | HistoryUndoRequestedEvent
  | HistoryRedoRequestedEvent
  | SketchDraftHistoryRestoredEvent
  | SketchHistoryOperationDeleteRequestedEvent
  | SketchAnnotationDeleteRequestedEvent
  | SketchAnnotationEditRequestedEvent
  | FormFeaturePatchedEvent
  | FormReferencePickerActivatedEvent
  | FormReferencePickerCancelledEvent
  | ImportFileSelectedEvent
  | ImportProviderSelectedEvent
  | ImportSelectionPatchedEvent
  | ImportCommitRequestedEvent
  | ImportCancelledEvent
  | ImportCommittedEvent
  | ImportFailedEvent
  | SectionOffsetUpdatedEvent
  | SectionFlipRequestedEvent
  | SectionClearedEvent
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
      /** Structured error context preserved when `accepted` is false. */
      errorContext?: AppErrorContextEntry[]
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
      /** Structured error context preserved when `accepted` is false. */
      errorContext?: AppErrorContextEntry[]
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
  | {
      type: 'effect.sketchPlaneCommitted'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      revisionId: RevisionId
      accepted: boolean
      diagnostics: ModelingDiagnostic[]
      actualRevisionId?: RevisionId
      errorContext?: AppErrorContextEntry[]
    }
  | {
      type: 'effect.sketchPlaneCommitFailed'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      message: string
    }
  | {
      type: 'effect.sketchReferencesProjected'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      projectedReferences: ProjectedSketchReferenceRecord[]
      diagnostics: ProjectedSketchReferenceRecord['diagnostics']
    }
  | {
      type: 'effect.sketchReferenceProjectionFailed'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      message: string
    }
  | {
      type: 'effect.sketchReferenceImageImportCompleted'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      status: 'cancelled' | 'committed'
      revisionId: RevisionId
      snapshot?: WorkspaceSnapshot
      selectionCatalog?: SelectionTargetCatalog
      session?: SketchSessionState
      importedCount?: number
    }
  | {
      type: 'effect.sketchReferenceImageImportFailed'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      message: string
    }
  | {
      type: 'effect.sketchSpecialModeEffectCompleted'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      effectId: string
      payload: Record<string, unknown>
    }
  | {
      type: 'effect.sketchSpecialModeEffectFailed'
      requestId: RequestId
      documentId: DocumentId
      commandSessionId: CommandSessionId
      baseRevisionId: RevisionId
      effectId: string
      message: string
    }
  | {
      type: 'effect.documentCursorMoved'
      /** Effect request being completed by this document history cursor mutation. */
      requestId: RequestId
      /** Durable document identity for the cursor mutation result. */
      documentId: DocumentId
      /** Base revision used when the cursor mutation was issued. */
      baseRevisionId: RevisionId
      /** Revision returned by the backend after processing the cursor mutation. */
      revisionId: RevisionId
      /** Whether the cursor mutation was accepted against `baseRevisionId`. */
      accepted: boolean
      /** Fresh snapshot after the accepted cursor move, when the runtime can provide it immediately. */
      snapshot?: WorkspaceSnapshot
      /** Machine-readable diagnostics returned by the mutation. */
      diagnostics: ModelingDiagnostic[]
      /** Actual revision encountered when `accepted` is false due to conflict. */
      actualRevisionId?: RevisionId
      /** Structured error context preserved when `accepted` is false. */
      errorContext?: AppErrorContextEntry[]
    }
  | {
      type: 'effect.documentCursorMoveFailed'
      /** Effect request that failed during document history cursor mutation. */
      requestId: RequestId
      /** Durable document identity for the failed cursor mutation request. */
      documentId: DocumentId
      /** Base revision used when the cursor mutation was issued. */
      baseRevisionId: RevisionId
      /** Human-readable failure summary for this cursor mutation request. */
      message: string
    }

export type SketchEvent = Extract<
  EditorEvent,
  | { type: `sketch.${string}` }
  | { type: 'tool.activated' }
  | { type: 'command.cancelled' }
  | { type: 'command.commitRequested' }
  | { type: 'history.undoRequested' }
  | { type: 'history.redoRequested' }
>

export type FeatureEvent = Extract<
  EditorEvent,
  | { type: `form.${string}` }
  | { type: 'command.cancelled' }
  | { type: 'command.commitRequested' }
>

export type SketchPlaneEvent = Extract<
  EditorEvent,
  | { type: `sketchPlaneEdit.${string}` }
  | { type: 'form.referencePickerActivated' }
  | { type: 'form.referencePickerCancelled' }
  | { type: 'command.cancelled' }
  | { type: 'command.commitRequested' }
>

export type ImportEvent = Extract<
  EditorEvent,
  | { type: `import.${string}` }
  | { type: 'form.referencePickerActivated' }
  | { type: 'form.referencePickerCancelled' }
  | { type: 'command.cancelled' }
>

export type ImportWorkflowEvent = Exclude<ImportEvent, { type: 'import.fileSelected' }>

export type SectionEvent = Extract<
  EditorEvent,
  | { type: `section.${string}` }
  | { type: 'command.cancelled' }
>

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
      /** Keep prior viewport render records when this snapshot contains repairable feature errors. */
      preserveRenderRecordsOnFeatureDiagnostics?: boolean
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
      /** Snapshot basis that owns repository freshness for this mutation. */
      mutationBasis: SnapshotMutationBasis
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
      /** Snapshot basis that owns repository freshness for this mutation. */
      mutationBasis: SnapshotMutationBasis
      /** Sketch session snapshot captured when the commit request was emitted. */
      session: SketchSessionState
    }
  | {
      type: 'sketchPlane.commit'
      requestId: RequestId
      commandSessionId: CommandSessionId
      documentId: DocumentId
      baseRevisionId: RevisionId
      mutationBasis: SnapshotMutationBasis
      session: SketchPlaneEditSessionState
    }
  | {
      type: 'sketch.projectReferences'
      requestId: RequestId
      commandSessionId: CommandSessionId
      documentId: DocumentId
      baseRevisionId: RevisionId
      session: SketchSessionState
    }
  | {
      type: 'sketch.importReferenceImages'
      requestId: RequestId
      commandSessionId: CommandSessionId
      documentId: DocumentId
      baseRevisionId: RevisionId
      mutationBasis: SnapshotMutationBasis
      session: SketchSessionState
      payloads: readonly ReferenceImagePayload[]
    }
  | {
      type: 'sketch.specialModeEffect'
      requestId: RequestId
      commandSessionId: CommandSessionId
      documentId: DocumentId
      baseRevisionId: RevisionId
      modeId: SketchSpecialModeId
      effectId: string
      kind: string
      payload: Record<string, unknown>
    }
  | {
      type: 'document.moveHistoryCursor'
      /** Editor-owned correlation ID for this document history cursor mutation. */
      requestId: RequestId
      /** Durable document identity against which the cursor move was requested. */
      documentId: DocumentId
      /** Base revision against which the cursor mutation must be applied. */
      baseRevisionId: RevisionId
      /** Snapshot basis that owns repository freshness for this mutation. */
      mutationBasis: SnapshotMutationBasis
      /** Target document history cursor. */
      cursor: DocumentFeatureCursor
      /** True when this cursor move is editor-session orchestration and should not be persisted as history. */
      transient?: boolean
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

/**
 * Minimal runtime services required to execute Phase 1 editor effects.
 * Implementations must preserve request ordering semantics and must feed
 * completions back into the editor only through typed `EditorEvent` values.
 */
export interface EditorEffectRuntime {
  /** Fetches the latest typed snapshot for the active document. */
  getCurrentDocumentSnapshot(): Promise<WorkspaceSnapshot>
  /** Commits the active sketch session against a base revision. */
  commitSketch(input: {
    requestId: RequestId
    baseRevisionId: RevisionId
    baseRepositoryHeads?: readonly string[]
    session: SketchSessionState
  }): Promise<{
    revisionId: RevisionId
    accepted: boolean
    diagnostics: ModelingDiagnostic[]
    actualRevisionId?: RevisionId
    errorContext?: AppErrorContextEntry[]
  } | null>
  /** Recommits a committed sketch with an updated support-plane definition. */
  commitSketchPlane(input: {
    requestId: RequestId
    baseRevisionId: RevisionId
    baseRepositoryHeads?: readonly string[]
    session: SketchPlaneEditSessionState
  }): Promise<{
    revisionId: RevisionId
    accepted: boolean
    diagnostics: ModelingDiagnostic[]
    actualRevisionId?: RevisionId
    errorContext?: AppErrorContextEntry[]
  }>
  /** Projects authored external sketch references for active sketch display. */
  projectSketchReferences(input: {
    requestId: RequestId
    documentId: DocumentId
    baseRevisionId: RevisionId
    session: SketchSessionState
  }): Promise<{
    projectedReferences: ProjectedSketchReferenceRecord[]
    diagnostics: ProjectedSketchReferenceRecord['diagnostics']
  }>
  /** Imports one or more reference images into the active sketch workflow. */
  importSketchReferenceImages?(input: {
    requestId: RequestId
    documentId: DocumentId
    commandSessionId: CommandSessionId
    baseRevisionId: RevisionId
    baseRepositoryHeads?: readonly string[]
    session: SketchSessionState
    payloads: readonly ReferenceImagePayload[]
  }): Promise<{
    status: 'cancelled' | 'committed'
    revisionId: RevisionId
    snapshot?: WorkspaceSnapshot
    selectionCatalog?: SelectionTargetCatalog
    session?: SketchSessionState
    importedCount?: number
  }>
  /** Runs asynchronous work requested by an active sketch special editor mode. */
  runSketchSpecialModeEffect?(input: {
    requestId: RequestId
    documentId: DocumentId
    commandSessionId: CommandSessionId
    baseRevisionId: RevisionId
    modeId: SketchSpecialModeId
    effectId: string
    kind: string
    payload: Record<string, unknown>
  }): Promise<{
    effectId: string
    payload: Record<string, unknown>
  }>
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
    baseRepositoryHeads?: readonly string[]
    featureSession: FeatureEditSessionState
  }): Promise<{
    revisionId: RevisionId
    featureId: FeatureId
    accepted: boolean
    diagnostics: ModelingDiagnostic[]
    actualRevisionId?: RevisionId
    errorContext?: AppErrorContextEntry[]
  }>
  /** Moves the committed document history cursor against a base revision. */
  setDocumentCursor?(input: {
    baseRevisionId: RevisionId
    baseRepositoryHeads?: readonly string[]
    cursor: DocumentFeatureCursor
    transient?: boolean
  }): Promise<{
    revisionId: RevisionId
    accepted: boolean
    diagnostics: ModelingDiagnostic[]
    actualRevisionId?: RevisionId
    errorContext?: AppErrorContextEntry[]
  }>
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
  /** Active committed-sketch plane edit session, or null when inactive. */
  activeSketchPlaneEditSession?: SketchPlaneEditSessionState | null
  /** Active import session, or null when no import review session is open. */
  activeImportSession: ImportSessionState | null
  /** Active form reference picker field id, or null when no field is collecting selections. */
  activeReferencePickerFieldId: string | null
  /** Active sketch session, or null when not editing a sketch. */
  sketchSession: SketchSessionState | null
  /** Active temporary section-view session, or null when inactive. */
  activeSectionView?: SectionViewSession | null
  /** Last loaded document snapshot owned by the machine. */
  snapshot: WorkspaceSnapshot | null
  /** Most recent accepted preview renderables, or null when none are active. */
  previewRenderables: RenderableEntityRecord[] | null
  /** Availability of toolbar history actions in the active editor context. */
  history: EditorHistoryAvailability
}

export interface EditorHistoryAvailability {
  canUndo: boolean
  canRedo: boolean
}
