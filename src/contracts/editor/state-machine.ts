import type { ToolId } from '@/domain/tools/tool-registry'
import type { ToolbarMode } from '@/domain/tools/schema'
import { isRegisteredSketchToolId } from '@/domain/sketch-tools/registry'
import { isRegisteredSketchConstraintToolId } from '@/domain/sketch-constraints/registry'
import { isRegisteredSketchEditToolId } from '@/domain/sketch-edit-tools/registry'
import {
  applySelectionToFeatureEditSession,
  adoptCompatibleFeatureSelection,
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
import type {
  FeatureEditorFormField,
  FeatureEditorFormSchema,
} from '@/domain/feature-authoring/form-schema'
import {
  acceptSketchDraw,
  adoptCompatibleSketchEditToolTargets,
  beginSketchAnnotationEdit,
  beginSketchGeometryDrag,
  beginSketchTool,
  clearActiveSketchTool,
  deleteSelectedSketchAnnotation,
  deleteSelectedSketchGeometry,
  deleteSketchReferenceTarget,
  finishSketchGeometryDrag,
  focusSketchStyleTool,
  getActiveSketchStyleToolId,
  getConnectedSketchEntitySelectionTargets,
  getNextSketchHistoryCursor,
  getPreviousSketchHistoryCursor,
  getSketchSessionPreviewLabel,
  isEditableSketchGeometrySelection,
  moveSketchHistoryCursor,
  patchSketchConstraintValue,
  patchSketchDimensionAnnotationPlacement,
  patchSketchDrawingToolValue,
  patchSketchEditToolValue,
  patchSketchStyleValue,
  pinSketchConstraintPreview,
  selectSketchEditTarget,
  selectSketchEditToolTarget,
  selectSketchAnnotation,
  selectSketchConstraintTarget,
  shouldDeferSketchConstraintPreviewPinToSelection,
  selectSketchReferenceTarget,
  shouldPinSketchConstraintPreviewBeforeSelection,
  startSketchDraw,
  toggleSketchConstructionTarget,
  toggleSketchSvgRendering,
  updateSketchGeometryDrag,
  updateSketchConstraintHover,
  updateSketchEditToolHover,
  updateSketchStyleFocusTarget,
  updateSketchReferenceProjection,
  updateSketchPointer,
  type SketchSessionState,
  type SketchHistoryCursor,
} from '@/domain/editor/sketch-session'
import { openSketchSessionFromSelection } from '@/domain/editor/sketch-session-controller'
import {
  createSectionViewSession,
  flipSectionViewRetainedSide,
  type SectionViewSession,
  type Vec3,
} from '@/domain/section-view/session'
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
  sketchReferenceSelectionFilter,
  type CommandPreview,
  type PrimitiveRef,
  type SelectionFilter,
  type SelectionTargetCatalog,
} from '@/domain/editor/schema'
import { getImportProviderById } from '@/domain/import/provider-registry'
import { resolveMeasureSelectionCandidate } from '@/domain/measure/measurement'
import { buildSelectionTargetCatalog } from '@/domain/modeling/document-snapshot-view'
import {
  getDocumentHistoryCursorBeforeTarget,
  getDocumentHistoryCursorIndex,
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
  isValidDocumentHistoryCursor,
  type DocumentHistoryOrderEntry,
} from '@/domain/modeling/document-history'
import type {
  DocumentFeatureCursor,
  DocumentSnapshot,
  ModelingDiagnostic,
  SnapshotMutationBasis,
} from '@/contracts/modeling/schema'
import type { ImportReviewEnvelope } from '@/contracts/import/review'
import type { ResolvedImportSource } from '@/contracts/import/source'
import { isFeatureScopedModelingDiagnostic } from '@/contracts/modeling/diagnostics'
import type { RenderableEntityRecord } from '@/contracts/render/schema'
import type { DurableRef } from '@/contracts/shared/references'
import type { SketchPlaneDefinition, SketchPlaneSupportRef } from '@/contracts/shared/sketch-plane'
import type {
  CommandSessionId,
  DocumentId,
  FeatureId,
  RequestId,
  RevisionId,
} from '@/contracts/shared/ids'
import type { ProjectedSketchReferenceRecord } from '@/contracts/solver/schema'
import { SOLVER_SCHEMA_VERSION } from '@/contracts/solver/schema'
import {
  appErrorToModelingDiagnostic,
  normalizeUnknownError,
  type AppError,
  type AppErrorContextEntry,
  type AppResultAsync,
} from '@/contracts/errors'

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

export interface EditSessionCursorContext {
  /** Committed sketch or feature being edited through rollback-aware re-entry. */
  target: DocumentHistoryOrderEntry
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
  snapshot: DocumentSnapshot
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
  snapshot: DocumentSnapshot
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
  | ViewportHoveredEvent
  | ViewportHoverClearedEvent
  | ViewportSelectionRequestedEvent
  | SketchConnectedSelectionRequestedEvent
  | SelectionClearedEvent
  | AuthoringReopenRequestedEvent
  | SketchPointerMovedEvent
  | SketchPointerReleasedEvent
  | SketchGeometryDragStartedEvent
  | SketchGeometryDragMovedEvent
  | SketchGeometryDragEndedEvent
  | SketchToolPatchedEvent
  | SketchActiveToolClearedEvent
  | SketchHistoryCursorRequestedEvent
  | DocumentHistoryCursorRequestedEvent
  | HistoryUndoRequestedEvent
  | HistoryRedoRequestedEvent
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
      type: 'sketch.projectReferences'
      requestId: RequestId
      commandSessionId: CommandSessionId
      documentId: DocumentId
      baseRevisionId: RevisionId
      session: SketchSessionState
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

function nextCommandSessionId(state: EditorState, toolId: ToolId) {
  return `command_${toolId}-${state.nextCommandSequence}` as CommandSessionId
}

function nextRequestId(state: EditorState, scope: string) {
  return `request_${scope}-${state.nextRequestSequence}` as RequestId
}

const EDITOR_SKETCH_REFERENCE_PROJECTION_TOLERANCES = {
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

  if (effect.type === 'sketch.commit' || effect.type === 'sketch.projectReferences') {
    context.push({ key: 'sketchId', value: effect.session.sketchId })
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

function getAppErrorContextValue(appError: AppError, key: string) {
  return appError.context.find((entry) => entry.key === key)?.value
}

function getAppErrorRevisionId(appError: AppError, key: string): RevisionId | undefined {
  const value = getAppErrorContextValue(appError, key)

  return typeof value === 'string' && value.startsWith('rev_') ? value as RevisionId : undefined
}

function getAppErrorDiagnosticCode(appError: AppError) {
  const value = getAppErrorContextValue(appError, 'diagnosticCode')

  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function isModelingMutationError(appError: AppError) {
  return appError.code === 'modeling/diagnostic' || appError.code === 'modeling/revision-rejected'
}

function modelingMutationErrorToDiagnostic(appError: AppError, target?: DurableRef | null): ModelingDiagnostic {
  return appErrorToModelingDiagnostic(appError, {
    target,
    code: getAppErrorDiagnosticCode(appError),
  })
}

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
    baseRepositoryHeads?: readonly string[]
    session: SketchSessionState
  }): Promise<{
    revisionId: RevisionId
    accepted: boolean
    diagnostics: ModelingDiagnostic[]
    actualRevisionId?: RevisionId
    errorContext?: AppErrorContextEntry[]
  } | null>
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
    pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
    editSessionCursorContext: state.editSessionCursorContext,
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

function withActivationSelection<TState extends EditorState>(
  state: TState,
  selection: readonly PrimitiveRef[],
): TState {
  return {
    ...state,
    selection: [...selection],
    hoverTarget: selection[selection.length - 1] ?? null,
  }
}

function adoptOrderedSelection(
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

function adoptSelectionForFilter(
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

function createSelectionPreview(state: EditorState, filter: SelectionFilter | null): CommandPreview | null {
  return createSelectionPreviewForSelection(state.selection, filter)
}

function createSelectionPreviewForSelection(
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

function createImportSelectionPreview(
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

function createImportingState(
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

function createSectionViewEditingState(
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

function getActiveReferencePickerField(state: FeatureEditorState) {
  if (!state.activeReferencePickerFieldId) {
    return null
  }

  const field = getFeatureEditorFormField(state.session, state.activeReferencePickerFieldId)
  return field?.kind === 'referencePicker' || field?.kind === 'referenceCollection'
    ? field
    : null
}

function findFormFieldById(
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

function getImportSessionFormField(
  session: ImportSessionState,
  fieldId: string,
) {
  return findFormFieldById(session.formSchema, fieldId)
}

function getImportSelectionFields(session: ImportSessionState) {
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

function getDefaultImportSelectionField(session: ImportSessionState) {
  const visibleFields = getImportSelectionFields(session).filter((field) => !field.hidden)
  return visibleFields.length === 1 ? visibleFields[0] : null
}

function getActiveImportReferencePickerField(state: ImportEditorState) {
  if (!state.activeReferencePickerFieldId) {
    return null
  }

  const field = getImportSessionFormField(state.session, state.activeReferencePickerFieldId)
  return field?.kind === 'referencePicker' || field?.kind === 'referenceCollection'
    ? field
    : null
}

function createImportViewportSelectionPatch(
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

function createPreviewFailedDiagnostics(
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

function getDurableDiagnosticTarget(target: PrimitiveRef | null): DurableRef | null {
  if (!target || target.kind === 'projectedReferenceGeometry' || target.kind === 'sketchExternalReference') {
    return null
  }

  return target
}

function emitSnapshotFetch(
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

function getSnapshotMutationBasis(state: EditorState): SnapshotMutationBasis | null {
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

function hasPendingDocumentCursorRefresh(state: EditorState) {
  return state.pendingHistoryCursorRequestId !== null || state.pendingSnapshotRequestId !== null
}

function isRefreshableDocumentCursorConflict(event: Extract<EditorEvent, { type: 'effect.documentCursorMoved' }>) {
  return event.actualRevisionId !== undefined
    || event.diagnostics.some((diagnostic) =>
      diagnostic.code === 'repository-head-conflict' || diagnostic.detail?.kind === 'revisionConflict',
    )
}

function emitDocumentCursorMove(
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

function emitEditSessionCursorRestore(state: EditorState): EditorTransitionResult {
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

function createEditSessionCursorContext(
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

function emitSketchReferenceProjection(state: SketchEditorState, session: SketchSessionState): EditorTransitionResult {
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

function hasFeatureScopedError(snapshot: DocumentSnapshot) {
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

function updateStateDocumentSnapshot(state: EditorState, snapshot: DocumentSnapshot): EditorState {
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

function isFeatureTool(toolId: ToolId): toolId is Extract<ToolId, 'extrude' | 'revolve' | 'fillet' | 'shell' | 'plane' | 'sweep' | 'loft' | 'chamfer' | 'thicken' | 'combine' | 'split' | 'deleteSolid' | 'mirror' | 'transform'> {
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

function isPassiveSketchTool(toolId: ToolId): toolId is Extract<ToolId, 'fill' | 'stroke'> {
  return toolId === 'fill'
    || toolId === 'stroke'
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
      if (event.toolId === 'undo') {
        return transitionEditorState(state, { type: 'history.undoRequested' })
      }

      if (event.toolId === 'redo') {
        return transitionEditorState(state, { type: 'history.redoRequested' })
      }

      if (event.toolId === 'import') {
        return {
          state,
          effects: [],
        }
      }

      if (event.toolId === 'finishSketch' && state.kind === 'editingSketch') {
        return emitSketchCommit(state)
      }

      if (event.toolId === 'svgRendering' && state.kind === 'editingSketch') {
        const session = toggleSketchSvgRendering(state.session)

        return {
          state: {
            ...state,
            mode: 'sketch',
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

      if (
        state.kind === 'editingSketch' &&
        isRegisteredSketchEditToolId(event.toolId)
      ) {
        const adoptedSelection = adoptCompatibleSketchEditToolTargets(
          state.session,
          event.toolId,
          state.selection,
        )
        const activationState = withActivationSelection(state, adoptedSelection)
        const session = beginSketchTool(
          activationState.session,
          event.toolId,
          adoptedSelection,
        )

        return {
          state: {
            ...activationState,
            mode: 'sketch',
            selectionFilter: getDefaultSelectionFilterForMode('sketch'),
            command: {
              ...activationState.command,
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

      if (
        state.kind === 'editingSketch' &&
        (
          isRegisteredSketchToolId(event.toolId)
          || isRegisteredSketchConstraintToolId(event.toolId)
          || event.toolId === 'dimension'
          || event.toolId === 'construction'
          || event.toolId === 'projectReference'
        )
      ) {
        const session = beginSketchTool(
          state.session,
          event.toolId === 'dimension' ? 'dimensionDistance' : event.toolId,
        )

        return {
          state: {
            ...state,
            mode: 'sketch',
            selectionFilter: event.toolId === 'projectReference'
              ? sketchReferenceSelectionFilter
              : getDefaultSelectionFilterForMode('sketch'),
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

      if (state.kind === 'editingSketch' && isPassiveSketchTool(event.toolId)) {
        const session = focusSketchStyleTool(state.session, state.selection, event.toolId)

        return {
          state: {
            ...state,
            mode: 'sketch',
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

      if (event.toolId === 'sketch') {
        const adoptedSelection = adoptSelectionForFilter(
          state.selection,
          sketchStartSelectionFilter,
          state.selectionCatalog,
        )
        const nextState = createCommandState(
          withActivationSelection(state, adoptedSelection),
          event.toolId,
          state.mode,
          sketchStartSelectionFilter,
          createSelectionPreview(withActivationSelection(state, adoptedSelection), sketchStartSelectionFilter),
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
          if (selectedTarget.kind === 'sketch') {
            const cursorContext = createEditSessionCursorContext(state.snapshot, {
              kind: 'sketch',
              sketchId: selectedTarget.sketchId,
            })

            if (!cursorContext) {
              return {
                state: withPreview(nextState, {
                  kind: 'selection',
                  label: `Sketch ${selectedTarget.sketchId} is not in document history.`,
                  target: selectedTarget,
                }),
                effects: [],
              }
            }

            return emitDocumentCursorMove(
              {
                ...nextState,
                editSessionCursorContext: cursorContext,
                preview: {
                  kind: 'selection',
                  label: `Rolling back before sketch ${selectedTarget.sketchId}`,
                  target: selectedTarget,
                },
              },
              cursorContext.rollbackCursor,
              true,
            )
          }

          return emitSketchOpen(nextState, [selectedTarget])
        }

        return {
          state: nextState,
          effects: [],
        }
      }

      if (event.toolId === 'sectionView') {
        const selectionFilter = getSelectionFilterForCommand(event.toolId, 'part')

        return {
          state: createCommandState(
            state,
            event.toolId,
            'part',
            selectionFilter,
            createSelectionPreview(state, selectionFilter),
          ),
          effects: [],
        }
      }

      if (event.toolId === 'measure') {
        const selectionFilter = getSelectionFilterForCommand(event.toolId, 'part')

        return {
          state: createCommandState(
            state,
            event.toolId,
            'part',
            selectionFilter,
            createSelectionPreview(state, selectionFilter),
          ),
          effects: [],
        }
      }

      if (isFeatureTool(event.toolId)) {
        const selectionFilter = getSelectionFilterForFeatureType(event.toolId)
        const activationSelection =
          state.selection.length === 1 && state.selection[0]?.kind === 'feature'
            ? state.selection
            : adoptCompatibleFeatureSelection(event.toolId, state.selection)
        const activationState = withActivationSelection(state, activationSelection)
        const nextState = createCommandState(
          activationState,
          event.toolId,
          'part',
          selectionFilter,
          createSelectionPreview(activationState, selectionFilter),
        )

        const selectedTarget = nextState.selection[0] ?? null

        if (selectedTarget?.kind === 'feature') {
          const cursorContext = createEditSessionCursorContext(state.snapshot, {
            kind: 'feature',
            featureId: selectedTarget.featureId,
          })

          if (!cursorContext) {
            return {
              state: withPreview(nextState, {
                kind: 'selection',
                label: `Feature ${selectedTarget.featureId} is not in document history.`,
                target: selectedTarget,
              }),
              effects: [],
            }
          }

          return emitDocumentCursorMove(
            {
              ...nextState,
              editSessionCursorContext: cursorContext,
              preview: {
                kind: 'selection',
                label: `Rolling back before feature ${selectedTarget.featureId}`,
                target: selectedTarget,
              },
            },
            cursorContext.rollbackCursor,
            true,
          )
        }

        const session = createFeatureEditSession({
          featureType: event.toolId,
          selectedTargets: nextState.selection,
        })

        return emitFeaturePreview(createFeatureEditingState(nextState, nextState.command, session))
      }

      const mode =
        event.toolId === 'line'
          || event.toolId === 'rectangle'
          || event.toolId === 'circle'
          || event.toolId === 'construction'
          || event.toolId === 'projectReference'
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
    case 'history.undoRequested': {
      if (!getEditorHistoryAvailability(state).canUndo) {
        return {
          state,
          effects: [],
        }
      }

      if (state.kind === 'editingSketch') {
        const cursor = getPreviousSketchHistoryCursor(state.session)
        if (!cursor) {
          return {
            state,
            effects: [],
          }
        }

        const session = moveSketchHistoryCursor(state.session, cursor)

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

      return {
        state,
        effects: [],
      }
    }
    case 'history.redoRequested': {
      if (!getEditorHistoryAvailability(state).canRedo) {
        return {
          state,
          effects: [],
        }
      }

      if (state.kind === 'editingSketch') {
        const cursor = getNextSketchHistoryCursor(state.session)
        if (!cursor) {
          return {
            state,
            effects: [],
          }
        }

        const session = moveSketchHistoryCursor(state.session, cursor)

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

      return {
        state,
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

      if (state.editSessionCursorContext?.phase === 'active') {
        return emitEditSessionCursorRestore(
          toIdleState(state, state.kind === 'editingSketch' ? 'part' : state.mode),
        )
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
    case 'import.fileSelected':
      return {
        state: createImportingState(state, event.session),
        effects: [],
      }
    case 'import.providerSelected':
      return {
        state,
        effects: [],
      }
    case 'import.selectionPatched': {
      if (state.kind !== 'importing') {
        return {
          state,
          effects: [],
        }
      }

      const provider = getImportProviderById(state.session.providerId)
      if (!provider) {
        return {
          state,
          effects: [],
        }
      }

      const nextSelections = provider.applySelectionPatch(
        state.session.review,
        state.session.selections,
        event.patch,
      )
      const nextSession = {
        ...state.session,
        selections: nextSelections,
        formSchema: provider.getReviewFormSchema(state.session.review, nextSelections),
      }

      return {
        state: {
          ...state,
          session: nextSession,
          preview: createImportSelectionPreview(nextSession, 'Selected'),
          command: {
            ...state.command,
            phase: 'collecting',
          },
        },
        effects: [],
      }
    }
    case 'import.commitRequested':
      if (state.kind !== 'importing') {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          command: {
            ...state.command,
            phase: 'awaitingEffect',
          },
        },
        effects: [],
      }
    case 'import.cancelled':
      if (state.kind !== 'importing') {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: toIdleState(state, 'part'),
        effects: [],
      }
    case 'import.committed':
      if (state.kind !== 'importing') {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: toIdleState(state, 'part'),
        effects: [],
      }
    case 'import.failed':
      if (state.kind !== 'importing') {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          session: {
            ...state.session,
            diagnostics: event.diagnostics,
          },
          command: {
            ...state.command,
            phase: 'editing',
          },
          preview: createImportSelectionPreview(state.session, 'Import failed'),
        },
        effects: [],
      }
    case 'section.offsetUpdated':
      if (
        state.kind !== 'inspectingSection'
        || state.command.commandSessionId !== event.commandSessionId
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          section: {
            ...state.section,
            offset: event.offset,
          },
          command: {
            ...state.command,
            phase: 'editing',
          },
        },
        effects: [],
      }
    case 'section.flipRequested':
      if (
        state.kind !== 'inspectingSection'
        || state.command.commandSessionId !== event.commandSessionId
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          section: {
            ...state.section,
            retainedSide: flipSectionViewRetainedSide(state.section.retainedSide),
          },
          command: {
            ...state.command,
            phase: 'editing',
          },
        },
        effects: [],
      }
    case 'section.cleared':
      if (
        state.kind !== 'inspectingSection'
        || state.command.commandSessionId !== event.commandSessionId
      ) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: toIdleState(state, 'part'),
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

      if (state.kind === 'editingSketch' && state.session.activeEditTool) {
        const session = updateSketchEditToolHover(state.session, null)

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
                : state.kind === 'importing'
                  ? createImportSelectionPreview(state.session)
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

      if (state.kind === 'editingSketch' && state.session.activeEditTool) {
        const session = updateSketchEditToolHover(state.session, event.target)

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
    case 'selection.cleared': {
      if (state.kind === 'editingSketch' && state.session.constraintAuthoring) {
        const session = updateSketchConstraintHover(state.session, null)

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

      if (state.kind === 'editingSketch' && state.session.activeEditTool) {
        const session = updateSketchEditToolHover(state.session, null)

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

      if (state.kind === 'editingSketch' && getActiveSketchStyleToolId(state.session)) {
        const session = updateSketchStyleFocusTarget(state.session, [])

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

      const clearedState = {
        ...state,
        selection: [],
        hoverTarget: null,
      }

      return {
        state: withPreview(
          clearedState,
          state.kind === 'editingSketch'
            ? {
                kind: 'sketch',
                label: getSketchSessionPreviewLabel(state.session),
                target: state.session.planeTarget,
              }
            : state.kind === 'selectionCommand'
              ? createSelectionPreview(clearedState, state.selectionFilter)
              : state.kind === 'editingFeature'
                ? createFeatureSelectionPreview(state.session)
                : state.kind === 'importing'
                  ? createImportSelectionPreview(state.session)
                : state.preview,
        ),
        effects: [],
      }
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

      if (state.kind === 'selectionCommand' && state.command.toolId === 'sectionView') {
        if (
          (event.target.kind !== 'construction' && event.target.kind !== 'face' && event.target.kind !== 'region')
          || !event.cameraPosition
        ) {
          return {
            state: withPreview(state, {
              kind: 'selection',
              label: 'Section view requires a viewport-picked planar face, closed region, or construction plane.',
              target: state.selection[0] ?? null,
            }),
            effects: [],
          }
        }

        const section = createSectionViewSession({
          snapshot: state.snapshot,
          seed: event.target,
          cameraPosition: event.cameraPosition,
        })

        if (!section) {
          return {
            state: withPreview(state, {
              kind: 'selection',
              label: 'Selected target does not resolve to a usable section plane.',
              target: event.target,
            }),
            effects: [],
          }
        }

        return {
          state: createSectionViewEditingState(state, section),
          effects: [],
        }
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

      if (state.kind === 'importing') {
        const activeReferenceField = getActiveImportReferencePickerField(state)
          ?? getDefaultImportSelectionField(state.session)
        const nextPatch = createImportViewportSelectionPatch(state, activeReferenceField, event.target)
        const provider = getImportProviderById(state.session.providerId)

        if (!provider || !nextPatch) {
          return {
            state,
            effects: [],
          }
        }

        const nextSelections = provider.applySelectionPatch(
          state.session.review,
          state.session.selections,
          nextPatch,
        )
        const nextSession = {
          ...state.session,
          selections: nextSelections,
          formSchema: provider.getReviewFormSchema(state.session.review, nextSelections),
        }

        return {
          state: {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
            session: nextSession,
            selectionFilter:
              activeReferenceField?.kind === 'referencePicker'
                ? getDefaultSelectionFilterForMode('part')
                : state.selectionFilter,
            command: {
              ...state.command,
              phase: activeReferenceField?.kind === 'referencePicker' ? 'editing' : 'collecting',
            },
            preview: createImportSelectionPreview(nextSession, 'Selected'),
            activeReferencePickerFieldId:
              activeReferenceField?.kind === 'referencePicker'
                ? null
                : activeReferenceField?.id ?? state.activeReferencePickerFieldId,
          },
          effects: [],
        }
      }

      if (state.kind === 'editingSketch' && getActiveSketchStyleToolId(state.session)) {
        const nextSelection = [event.target]
        const session = updateSketchStyleFocusTarget(state.session, nextSelection)

        return {
          state: {
            ...state,
            selection: nextSelection,
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

      if (state.kind === 'editingSketch' && state.session.constructionTargetPicking) {
        const session = toggleSketchConstructionTarget(state.session, event.target)

        return {
          state: {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
            session,
            command: {
              ...state.command,
              toolId: session.activeTool ?? 'sketch',
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

      if (state.kind === 'editingSketch' && state.session.referenceTargetPicking) {
        const session = selectSketchReferenceTarget(state.session, event.target)
        const nextState: SketchEditorState = {
          ...state,
          selection: [event.target],
          hoverTarget: event.target,
          selectionFilter: session.referenceTargetPicking
            ? sketchReferenceSelectionFilter
            : getDefaultSelectionFilterForMode('sketch'),
          session,
          command: {
            ...state.command,
            toolId: session.activeTool ?? 'sketch',
            phase: 'editing',
          },
          preview: {
            kind: 'sketch',
            label: getSketchSessionPreviewLabel(session),
            target: session.planeTarget,
          },
        }

        return emitSketchReferenceProjection(nextState, session)
      }

      if (state.kind === 'editingSketch' && state.session.activeEditTool) {
        const session = selectSketchEditToolTarget(state.session, event.target)

        return {
          state: {
            ...state,
            selection: [event.target],
            hoverTarget: event.target,
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

      if (
        state.kind === 'editingSketch'
        && shouldPinSketchConstraintPreviewBeforeSelection(state.session)
      ) {
        const session = pinSketchConstraintPreview(
          state.session,
          state.session.constraintAuthoring?.pointer ?? null,
        )

        return {
          state: {
            ...state,
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

      if (state.kind === 'inspectingSection') {
        return {
          state,
          effects: [],
        }
      }

      if (state.kind === 'selectionCommand' && state.command.toolId === 'measure') {
        const candidate = resolveMeasureSelectionCandidate(state.snapshot, state.selection, event.target)

        if (!candidate.accepted) {
          return {
            state: withPreview(state, {
              kind: 'selection',
              label: candidate.reason ?? getSelectionFilterRejectionLabel(state.selectionFilter, event.target),
              target: state.selection[0] ?? null,
            }),
            effects: [],
          }
        }

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
    case 'sketch.connectedSelectionRequested': {
      if (
        state.kind !== 'editingSketch'
        || !(
          state.session.activeTool === null
          || (state.session.status === 'idle' && isRegisteredSketchToolId(state.session.activeTool))
        )
        || state.session.constructionTargetPicking
        || state.session.referenceTargetPicking
        || state.session.constraintAuthoring
        || state.session.activeEditTool
        || state.session.activeStyleFocus
      ) {
        return {
          state,
          effects: [],
        }
      }

      const targets = getConnectedSketchEntitySelectionTargets(state.session, event.target)

      if (targets.length === 0) {
        return {
          state,
          effects: [],
        }
      }

      return {
        state: {
          ...state,
          selection: targets,
          hoverTarget: event.target,
          preview: {
            kind: 'sketch',
            label: getSketchSessionPreviewLabel(state.session),
            target: state.session.planeTarget,
          },
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
        const cursorContext = createEditSessionCursorContext(state.snapshot, {
          kind: 'sketch',
          sketchId: event.target.sketchId,
        })

        if (!cursorContext) {
          return {
            state: withPreview(nextState, {
              kind: 'selection',
              label: `Sketch ${event.target.sketchId} is not in document history.`,
              target: event.target,
            }),
            effects: [],
          }
        }

        return emitDocumentCursorMove(
          {
            ...nextState,
            selection: [event.target],
            hoverTarget: event.target,
            editSessionCursorContext: cursorContext,
            preview: {
              kind: 'selection',
              label: `Rolling back before sketch ${event.target.sketchId}`,
              target: event.target,
            },
          },
          cursorContext.rollbackCursor,
          true,
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
      const cursorContext = createEditSessionCursorContext(state.snapshot, {
        kind: 'feature',
        featureId: event.target.featureId,
      })

      if (!cursorContext) {
        return {
          state: withPreview(nextState, {
            kind: 'selection',
            label: `Feature ${event.target.featureId} is not in document history.`,
            target: event.target,
          }),
          effects: [],
        }
      }

      return emitDocumentCursorMove(
        {
          ...nextState,
          selection: [event.target],
          hoverTarget: event.target,
          editSessionCursorContext: cursorContext,
          preview: {
            kind: 'selection',
            label: `Rolling back before feature ${event.target.featureId}`,
            target: event.target,
          },
        },
        cursorContext.rollbackCursor,
        true,
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
            ? shouldDeferSketchConstraintPreviewPinToSelection(state.session, event.target)
              ? state.session
              : pinSketchConstraintPreview(state.session, point)
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

      if (event.patch.intent === 'setDimensionAnnotationPlacement') {
        const session = patchSketchDimensionAnnotationPlacement(state.session, event.patch)

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

      if (state.session.activeEditTool) {
        const session = patchSketchEditToolValue(state.session, event.patch)

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

      if (
        event.patch.intent === 'setToolSetting'
        && state.session.activeTool
        && isRegisteredSketchToolId(state.session.activeTool)
      ) {
        const session = patchSketchDrawingToolValue(state.session, event.patch)

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

      {
        const session = patchSketchStyleValue(state.session, state.selection, event.patch)

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
    case 'document.historyCursorRequested':
      if (
        state.kind !== 'idle' ||
        !state.snapshot ||
        hasPendingDocumentCursorRefresh(state) ||
        !isValidDocumentHistoryCursor(state.snapshot.presentation.documentHistory, event.cursor) ||
        getDocumentHistoryCursorIndex(state.snapshot.presentation.documentHistory, event.cursor)
          === getDocumentHistoryCursorIndex(state.snapshot.presentation.documentHistory, state.snapshot.document.cursor)
      ) {
        return {
          state,
          effects: [],
        }
      }

      return emitDocumentCursorMove(state, event.cursor, false)
    case 'sketch.annotationDeleteRequested':
      if (state.kind !== 'editingSketch') {
        return {
          state,
          effects: [],
        }
      }

      {
        const selected = state.selection[0] ?? null
        const referenceTarget = selected
          && (selected.kind === 'projectedReferenceGeometry' || selected.kind === 'sketchExternalReference')
          ? selected
          : null
        const session = referenceTarget
          ? deleteSketchReferenceTarget(state.session, referenceTarget)
          : isEditableSketchGeometrySelection(state.session, state.selection)
            ? deleteSelectedSketchGeometry(state.session, state.selection)
            : deleteSelectedSketchAnnotation(state.session)
        const nextState: SketchEditorState = {
          ...state,
          selection: [],
          hoverTarget: null,
          session,
          preview: {
            kind: 'sketch',
            label: getSketchSessionPreviewLabel(session),
            target: session.planeTarget,
          },
        }

        return referenceTarget
          ? emitSketchReferenceProjection(nextState, session)
          : { state: nextState, effects: [] }
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
      if (state.kind !== 'editingFeature' && state.kind !== 'importing') {
        return {
          state,
          effects: [],
        }
      }

      const field = state.kind === 'editingFeature'
        ? getFeatureEditorFormField(state.session, event.fieldId)
        : getImportSessionFormField(state.session, event.fieldId)

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
      if (
        (state.kind !== 'editingFeature' && state.kind !== 'importing')
        || !state.activeReferencePickerFieldId
      ) {
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
          selectionFilter:
            state.kind === 'editingFeature'
              ? getSelectionFilterForFeatureType(state.session.featureType)
              : getDefaultSelectionFilterForMode('part'),
          preview:
            state.kind === 'editingFeature'
              ? createFeatureSelectionPreview(state.session)
              : createImportSelectionPreview(state.session),
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
    case 'document.snapshotLoaded':
      return {
        state: updateStateDocumentSnapshot(state, event.snapshot),
        effects: [],
      }
    case 'effect.documentCursorMoved': {
      if (
        state.pendingHistoryCursorRequestId !== event.requestId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      if (!event.accepted) {
        const message =
          event.diagnostics[0]?.message ??
          `Document history cursor move rejected due to revision conflict (${event.actualRevisionId ?? 'unknown'}).`
        const nextState = withPreview(
          {
            ...state,
            pendingHistoryCursorRequestId: null,
          },
          {
            kind: 'selection',
            label: message,
            target: state.selection[0] ?? null,
          },
        )

        return isRefreshableDocumentCursorConflict(event)
          ? emitSnapshotFetch(nextState, null)
          : { state: nextState, effects: [] }
      }

      return emitSnapshotFetch(
        {
          ...state,
          document: {
            ...state.document,
            revisionId: event.revisionId,
          },
          pendingHistoryCursorRequestId: null,
          editSessionCursorContext: state.editSessionCursorContext
            ? {
                ...state.editSessionCursorContext,
                phase: state.editSessionCursorContext.phase === 'rollingBack'
                  ? 'opening'
                  : state.editSessionCursorContext.phase,
              }
            : null,
          preview: null,
        },
        null,
      )
    }
    case 'effect.documentCursorMoveFailed':
      if (
        state.pendingHistoryCursorRequestId !== event.requestId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
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
            pendingHistoryCursorRequestId: null,
          },
          {
            kind: 'selection',
            label: event.message,
            target: state.selection[0] ?? null,
          },
        ),
        effects: [],
      }
    case 'effect.snapshotLoaded':
      if (state.pendingSnapshotRequestId !== event.payload.requestId) {
        return {
          state,
          effects: [],
        }
      }

      {
        const updatedState = updateStateDocument(state, event.payload)
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
            return emitSketchOpen(
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

      {
        const nextState: SketchEditorState = {
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
          pendingHistoryCursorRequestId: state.pendingHistoryCursorRequestId,
          editSessionCursorContext: state.editSessionCursorContext,
          command: {
            ...state.command,
            phase: 'editing',
          },
          session: event.session,
          pendingCommitRequestId: null,
          pendingProjectionRequestId: null,
        }

        return emitSketchReferenceProjection(nextState, event.session)
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

        if (state.editSessionCursorContext?.phase === 'active') {
          return emitSnapshotFetch(
            {
              ...idleState,
              editSessionCursorContext: {
                ...state.editSessionCursorContext,
                phase: 'restorePending',
              },
            },
            state.command.commandSessionId,
            {
              preserveRenderRecordsOnFeatureDiagnostics: event.diagnostics.some((diagnostic) =>
                diagnostic.severity === 'error' && isFeatureScopedModelingDiagnostic(diagnostic),
              ),
            },
          )
        }

        const refresh = emitSnapshotFetch(
          withPreview(
            idleState,
            {
              kind: 'selection',
              label: `Committed feature ${event.featureId}`,
              target: { kind: 'feature', featureId: event.featureId },
            },
          ),
          state.command.commandSessionId,
          {
            preserveRenderRecordsOnFeatureDiagnostics: event.diagnostics.some((diagnostic) =>
              diagnostic.severity === 'error' && isFeatureScopedModelingDiagnostic(diagnostic),
            ),
          },
        )

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
                  target: getDurableDiagnosticTarget(getFeaturePrimarySelectionTarget(state.session)),
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
        const message =
          event.diagnostics[0]?.message ??
          `Sketch commit rejected due to revision conflict (${event.actualRevisionId ?? 'unknown'}).`
        const nextState: SketchEditorState = {
          ...state,
          document: event.actualRevisionId
            ? {
                ...state.document,
                revisionId: event.actualRevisionId,
              }
            : state.document,
          pendingCommitRequestId: null,
          command: {
            ...state.command,
            phase: 'editing',
          },
          preview: {
            kind: 'sketch',
            label: message,
            target: state.session.planeTarget,
          },
          session: {
            ...state.session,
            validationMessage: message,
          },
        }

        return event.actualRevisionId
          ? emitSnapshotFetch(nextState, state.command.commandSessionId)
          : { state: nextState, effects: [] }
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

        if (state.editSessionCursorContext?.phase === 'active') {
          return emitSnapshotFetch(
            {
              ...idleState,
              editSessionCursorContext: {
                ...state.editSessionCursorContext,
                phase: 'restorePending',
              },
            },
            state.command.commandSessionId,
          )
        }

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
          session: {
            ...state.session,
            validationMessage: event.message,
          },
        },
        effects: [],
      }
    case 'effect.sketchReferencesProjected':
      if (
        state.kind !== 'editingSketch' ||
        state.pendingProjectionRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
        !eventMatchesDocument(state, event.documentId, event.baseRevisionId)
      ) {
        return {
          state,
          effects: [],
        }
      }

      {
        const session = updateSketchReferenceProjection(
          state.session,
          event.projectedReferences,
          event.diagnostics,
        )

        return {
          state: {
            ...state,
            pendingProjectionRequestId: null,
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
    case 'effect.sketchReferenceProjectionFailed':
      if (
        state.kind !== 'editingSketch' ||
        state.pendingProjectionRequestId !== event.requestId ||
        state.command.commandSessionId !== event.commandSessionId ||
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
          pendingProjectionRequestId: null,
          preview: {
            kind: 'sketch',
            label: event.message,
            target: state.session.planeTarget,
          },
          session: {
            ...state.session,
            validationMessage: event.message,
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
            preserveRenderRecordsOnFeatureDiagnostics: effect.preserveRenderRecordsOnFeatureDiagnostics,
          },
        }
      } catch (error: unknown) {
        return createEditorEffectFailureEvent(effect, error, 'Snapshot refresh failed.')
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
        return createEditorEffectFailureEvent(effect, error, 'Sketch session could not be opened.')
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
        return createEditorEffectFailureEvent(effect, error, 'Feature session hydration failed.')
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
        return createEditorEffectFailureEvent(effect, error, 'Feature preview failed.')
      }
    }
    case 'feature.commit': {
      try {
        const result = await runtime.commitFeature({
          baseRevisionId: effect.baseRevisionId,
          baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
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
          errorContext: result.errorContext,
        }
      } catch (error: unknown) {
        return createEditorEffectFailureEvent(effect, error, 'Feature commit failed.')
      }
    }
    case 'sketch.commit': {
      try {
        const result = await runtime.commitSketch({
          requestId: effect.requestId,
          baseRevisionId: effect.baseRevisionId,
          baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
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
          errorContext: result.errorContext,
        }
      } catch (error: unknown) {
        return createEditorEffectFailureEvent(effect, error, 'Sketch commit failed.')
      }
    }
    case 'sketch.projectReferences': {
      try {
        const result = await runtime.projectSketchReferences({
          requestId: effect.requestId,
          documentId: effect.documentId,
          baseRevisionId: effect.baseRevisionId,
          session: effect.session,
        })

        return {
          type: 'effect.sketchReferencesProjected',
          requestId: effect.requestId,
          documentId: effect.documentId,
          commandSessionId: effect.commandSessionId,
          baseRevisionId: effect.baseRevisionId,
          projectedReferences: result.projectedReferences,
          diagnostics: result.diagnostics,
        }
      } catch (error: unknown) {
        return createEditorEffectFailureEvent(effect, error, 'Sketch reference projection failed.')
      }
    }
    case 'document.moveHistoryCursor': {
      try {
        if (!runtime.setDocumentCursor) {
          throw new Error('Document history cursor mutation runtime is not available.')
        }

        const result = await runtime.setDocumentCursor({
          baseRevisionId: effect.baseRevisionId,
          baseRepositoryHeads: effect.mutationBasis.baseRepositoryHeads,
          cursor: effect.cursor,
          transient: effect.transient,
        })

        return {
          type: 'effect.documentCursorMoved',
          requestId: effect.requestId,
          documentId: effect.documentId,
          baseRevisionId: effect.baseRevisionId,
          revisionId: result.revisionId,
          accepted: result.accepted,
          diagnostics: result.diagnostics,
          actualRevisionId: result.actualRevisionId,
          errorContext: result.errorContext,
        }
      } catch (error: unknown) {
        return createEditorEffectFailureEvent(effect, error, 'Document history cursor move failed.')
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
  projectSketchExternalReferences(input: {
    solverSchemaVersion: typeof SOLVER_SCHEMA_VERSION
    requestId: RequestId
    revisionId: RevisionId
    sketchId: NonNullable<SketchSessionState['sketchId']>
    plane: SketchPlaneDefinition['frame']
    tolerances: typeof EDITOR_SKETCH_REFERENCE_PROJECTION_TOLERANCES
    references: {
      referenceId: SketchSessionState['definition']['referenceIds'][number]
      reference: SketchSessionState['definition']['references'][number]
    }[]
  }): Promise<{
    projectedReferences: ProjectedSketchReferenceRecord[]
    diagnostics: ProjectedSketchReferenceRecord['diagnostics']
  }>
  sketchSolver: {
    createCommitCorrelation(requestId: RequestId): {
      requestId: RequestId
      projectionRequestId: RequestId
      validationRequestId: RequestId
      solveRequestId: RequestId
      regionRequestId: RequestId
    }
    projectExternalReferences(input: {
      solverSchemaVersion: typeof SOLVER_SCHEMA_VERSION
      requestId: RequestId
      documentId: DocumentId
      revisionId: RevisionId
      sketchId: NonNullable<SketchSessionState['sketchId']>
      plane: SketchPlaneDefinition['frame']
      tolerances: typeof EDITOR_SKETCH_REFERENCE_PROJECTION_TOLERANCES
      references: {
        referenceId: SketchSessionState['definition']['referenceIds'][number]
        reference: SketchSessionState['definition']['references'][number]
      }[]
    }): Promise<{
      projectedReferences: ProjectedSketchReferenceRecord[]
      diagnostics: ProjectedSketchReferenceRecord['diagnostics']
    }>
  } | null
  commitSketch: (input: {
    requestId: RequestId
    baseRevisionId: RevisionId
    baseRepositoryHeads?: readonly string[]
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
  }) => AppResultAsync<{
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
    baseRepositoryHeads?: readonly string[]
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>
  }) => AppResultAsync<{
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
    baseRepositoryHeads?: readonly string[]
    definition: NonNullable<ReturnType<typeof buildFeatureDefinition>>
    featureId: FeatureId
  }) => AppResultAsync<{
    revisionId: RevisionId
    featureId: FeatureId
    revisionState:
      | { kind: 'accepted' }
      | { kind: 'conflict'; actualRevisionId: RevisionId }
      | { kind: 'rejected'; reasonCode: string }
    diagnostics: ModelingDiagnostic[]
  }>
  setFeatureCursor: (input: {
    baseRevisionId: RevisionId
    baseRepositoryHeads?: readonly string[]
    cursor: DocumentFeatureCursor
    persistHistory?: boolean
  }) => AppResultAsync<{
    revisionId: RevisionId
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
        baseRepositoryHeads: input.baseRepositoryHeads,
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

      if (result.isErr()) {
        if (!isModelingMutationError(result.error)) {
          throw result.error
        }

        const actualRevisionId = getAppErrorRevisionId(result.error, 'actualRevisionId')

        return {
          revisionId: actualRevisionId ?? input.baseRevisionId,
          accepted: false,
          diagnostics: [modelingMutationErrorToDiagnostic(result.error, getDurableDiagnosticTarget(input.session.planeTarget))],
          actualRevisionId,
          errorContext: result.error.context,
        }
      }

      return {
        revisionId: result.value.revisionId,
        accepted: true,
        diagnostics: result.value.diagnostics,
      }
    },
    async projectSketchReferences(input) {
      const sketchId = input.session.sketchId ?? ('sketch_draft' as NonNullable<SketchSessionState['sketchId']>)

      return modelingService.projectSketchExternalReferences({
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: input.requestId,
        revisionId: input.baseRevisionId,
        sketchId,
        plane: input.session.plane.frame,
        tolerances: EDITOR_SKETCH_REFERENCE_PROJECTION_TOLERANCES,
        references: input.session.definition.references.map((reference) => ({
          referenceId: reference.referenceId,
          reference,
        })),
      })
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
        baseRepositoryHeads: input.baseRepositoryHeads,
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

      if (result.isErr()) {
        if (!isModelingMutationError(result.error)) {
          throw result.error
        }

        const actualRevisionId = getAppErrorRevisionId(result.error, 'actualRevisionId')

        return {
          revisionId: actualRevisionId ?? input.baseRevisionId,
          featureId: input.featureSession.featureId ?? ('feature_rejected' as FeatureId),
          accepted: false,
          diagnostics: [
            modelingMutationErrorToDiagnostic(
              result.error,
              getDurableDiagnosticTarget(getFeaturePrimarySelectionTarget(input.featureSession)),
            ),
          ],
          actualRevisionId,
          errorContext: result.error.context,
        }
      }

      return {
        revisionId: result.value.revisionId,
        featureId: result.value.featureId,
        accepted: true,
        diagnostics: result.value.diagnostics,
      }
    },
    async setDocumentCursor(input) {
      const result = await modelingService.setFeatureCursor({
        baseRevisionId: input.baseRevisionId,
        baseRepositoryHeads: input.baseRepositoryHeads,
        cursor: input.cursor,
        persistHistory: input.transient ? false : undefined,
      })

      if (result.isErr()) {
        if (!isModelingMutationError(result.error)) {
          throw result.error
        }

        const actualRevisionId = getAppErrorRevisionId(result.error, 'actualRevisionId')

        return {
          revisionId: actualRevisionId ?? input.baseRevisionId,
          accepted: false,
          diagnostics: [modelingMutationErrorToDiagnostic(result.error)],
          actualRevisionId,
          errorContext: result.error.context,
        }
      }

      return {
        revisionId: result.value.revisionId,
        accepted: true,
        diagnostics: result.value.diagnostics,
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
  /** Active import session, or null when no import review session is open. */
  activeImportSession: ImportSessionState | null
  /** Active form reference picker field id, or null when no field is collecting selections. */
  activeReferencePickerFieldId: string | null
  /** Active sketch session, or null when not editing a sketch. */
  sketchSession: SketchSessionState | null
  /** Active temporary section-view session, or null when inactive. */
  activeSectionView?: SectionViewSession | null
  /** Last loaded document snapshot owned by the machine. */
  snapshot: DocumentSnapshot | null
  /** Most recent accepted preview renderables, or null when none are active. */
  previewRenderables: RenderableEntityRecord[] | null
  /** Availability of toolbar history actions in the active editor context. */
  history: EditorHistoryAvailability
}

export interface EditorHistoryAvailability {
  canUndo: boolean
  canRedo: boolean
}

export function getEditorHistoryAvailability(state: EditorState): EditorHistoryAvailability {
  if (state.kind === 'editingSketch') {
    if (state.pendingCommitRequestId !== null) {
      return { canUndo: false, canRedo: false }
    }

    return {
      canUndo: getPreviousSketchHistoryCursor(state.session) !== null,
      canRedo: getNextSketchHistoryCursor(state.session) !== null,
    }
  }

  if (
    state.kind !== 'idle'
  ) {
    return { canUndo: false, canRedo: false }
  }

  if (hasPendingDocumentCursorRefresh(state)) {
    return { canUndo: false, canRedo: false }
  }

  return {
    canUndo: state.snapshot ? getPreviousDocumentHistoryCursor(state.snapshot) !== null : false,
    canRedo: state.snapshot ? getNextDocumentHistoryCursor(state.snapshot) !== null : false,
  }
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
    activeImportSession: state.kind === 'importing' ? state.session : null,
    activeReferencePickerFieldId:
      state.kind === 'editingFeature' || state.kind === 'importing'
        ? state.activeReferencePickerFieldId
        : null,
    sketchSession: state.kind === 'editingSketch' ? state.session : null,
    activeSectionView: state.kind === 'inspectingSection' ? state.section : null,
    snapshot: state.snapshot,
    previewRenderables: state.previewRenderables,
    history: getEditorHistoryAvailability(state),
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
