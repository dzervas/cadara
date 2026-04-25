import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Alert, Badge, Button, Checkbox, Group, Loader, Modal, Paper, Progress, ScrollArea, Stack, Text } from '@mantine/core'
import { appVersion, gitCommit } from 'virtual:cadara-build-metadata'

import { ThreeCadViewport } from '@/components/cad/three-cad-viewport'
import { SketchToolPanel } from '@/components/cad/sketch-tool-panel'
import { FeatureInspector } from '@/components/layout/feature-inspector'
import { FeatureSidebar } from '@/components/layout/feature-sidebar'
import { HistoryTimelineShell } from '@/components/layout/history-timeline-shell'
import { DocumentExportModal } from '@/components/layout/document-export-modal'
import { WorkbenchInspectorOverlay } from '@/components/layout/workbench-inspector-overlay'
import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import { WorkbenchStateDebugger, type WorkbenchStateDebuggerModel } from '@/components/layout/workbench-state-debugger'
import { WorkbenchNotification } from '@/components/layout/workbench-notification'
import type { WorkbenchNotificationModel } from '@/components/layout/workbench-notification-model'
import { isInitialOccRenderPending } from '@/app/initial-occ-render-state'
import { composeViewportRenderables, isTargetHidden } from '@/app/viewport-renderables'
import {
  createObjectExportModalState,
  type ObjectExportModalState,
} from '@/app/object-export-state'
import {
  dispatchCadTestSelection,
  syncCadTestState,
} from '@/app/cad-test-bridge'
import {
  requireAcceptedModelingResult,
  runWorkbenchAction,
} from '@/app/workbench-action'
import {
  documentHistoryOrdersEqual,
  getDocumentHistoryOrderRestoreMoves,
  getWorkbenchHistoryAvailability,
} from '@/app/workbench-history'
import type {
  DocumentFeatureCursor,
  DocumentHistoryOrderEntry,
  DocumentHistoryItemRecord,
  DocumentSnapshot,
  DocumentVariableRecord,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import type { GeometryAssetBlobInput } from '@/contracts/modeling/geometry-assets'
import type {
  StepImportMaterializationFeatureStatus,
  StepImportMaterializationStatus,
  StepImportReviewResult,
} from '@/contracts/modeling/step-import'
import { createAppError, errorContext, type AppError } from '@/contracts/errors'
import type { EditorHistoryAvailability } from '@/contracts/editor/state-machine'
import {
  getSketchAnnotationDescriptors,
  getSketchSessionRegionDiagnostics,
  getSketchToolPresentation,
} from '@/domain/editor/sketch-session'
import {
  getPrimitiveRefLabel,
  getPrimitiveRefKey,
  isDurablePrimitiveRef,
  primitiveRefEquals,
  type PrimitiveRef,
} from '@/domain/editor/schema'
import {
  getNavigationReopenRequest,
} from '@/domain/editor/workbench-interactions'
import {
  getFeatureSnapshot,
  getSelectionDetail,
} from '@/domain/modeling/document-snapshot-view'
import {
  createDocumentHistoryOrder,
  getNextDocumentHistoryCursor,
  getPreviousDocumentHistoryCursor,
} from '@/domain/modeling/document-history'
import { getStepImportMaterializationStageLabel } from '@/domain/modeling/step-import-materialization'
import { createTopologyDebugSummary } from '@/domain/modeling/topology-debug'
import { installConsoleLoggingSubscribers } from '@/domain/tools/console-logging'
import { useEditorState } from '@/hooks/use-editor-state'
import { useErrorReporter } from '@/hooks/use-error-reporter'
import { useFeatureEditing } from '@/hooks/use-feature-editing'
import { useModelingService } from '@/hooks/use-modeling-service'
import { ShortcutProvider } from '@/hooks/shortcut-provider'
import { useToolActionBus, useToolActions } from '@/hooks/use-tool-actions'
import { downloadDocumentExportResult } from '@/lib/download-export'
import {
  ensureLocalFileWritePermission,
  readCadaraDocumentFile,
  readLocalCadaraDocument,
  showOpenLocalDocumentPicker,
  showSaveLocalDocumentPicker,
  writeTextToLocalFileHandle,
} from '@/lib/local-file-system-access'
import { createLocalFileBindingMetadata } from '@/domain/modeling/local-file-binding-store'
import {
  createWorkbenchShortcutCommandHandlers,
  getWorkbenchShortcutActiveScopes,
} from '@/app/workbench-shortcuts'
import {
  WORKBENCH_STATUS_TOP_PX,
  WORKBENCH_STATUS_TOP_WITH_RESTORE_PX,
  getWorkbenchNotificationRightOffsetPx,
} from '@/components/cad/viewport-overlay-layout'
import {
  clampWorkbenchSidebarWidth,
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  getWorkbenchSidebarWidthFromPointer,
} from '@/app/workbench-shell-layout'
import {
  createBugReportDebugArtifact,
  createBugReportIssueDraft,
  createBugReportPayload,
  createBugReportStateArchive,
  createFallbackBugReportIssueUrl,
  downloadBugReportDebugArtifact,
  type BugReportArtifactStatus,
} from '@/domain/bug-reporting/report'
import { getBuildModeLabel } from '@/components/layout/build-metadata'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'
import type { DocumentSyncWriteStatus } from '@/domain/modeling/document-sync-worker-protocol'
import { getBinaryStlTriangleCount } from '@/domain/modeling/mesh-parser'
import {
  createMeshSizeLimitEvaluation,
  type MeshReconstructionEvaluation,
} from '@/domain/modeling/baked-mesh-geometry'
import type {
  MeshImportReviewWorkerRequest,
  MeshImportReviewWorkerResponse,
} from '@/domain/modeling/mesh-import-review-worker-protocol'
import type { RequestId } from '@/contracts/shared/ids'

type FeatureHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'feature' }>
type SketchHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'sketch' }>
type DocumentVariablePatch = Pick<DocumentVariableRecord, 'name' | 'valueText'>
type StepImportFlowState =
  | { kind: 'idle' }
  | { kind: 'preparing'; fileNames: readonly string[]; label: string }
  | {
    kind: 'review'
    files: readonly { fileName: string; bytes: Uint8Array }[]
    review: StepImportReviewResult
    selectedSolidKeys: readonly string[]
    label: string
  }
type MeshImportFlowState =
  | { kind: 'idle' }
  | {
    kind: 'review'
    fileName: string
    assetInput: GeometryAssetBlobInput | null
    label: string
    warningAccepted: boolean
    reconstruction: MeshReconstructionEvaluation
  }
type MeshImportProgressState = {
  fileName: string
  message: string
  progress: number
  canCancel: boolean
}
type StepImportProgressState = {
  fileName: string
  message: string
  progress: number
}
type WorkbenchUndoEntry =
  | {
      kind: 'updateVariable'
      variableId: DocumentVariableRecord['variableId']
      before: DocumentVariablePatch
      after: DocumentVariablePatch
      label: string
    }
  | {
      kind: 'reorderDocumentHistory'
      before: DocumentHistoryOrderEntry[]
      after: DocumentHistoryOrderEntry[]
      label: string
    }

const PART_IMPORT_FILE_ACCEPT = '.step,.stp,.stl,.3mf,model/step,model/stl,model/3mf'

function isPartImportEnabled() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('cadEnablePartImport') === '1'
}

function isLocalFileSyncEnabledStatus(status: DocumentSyncWriteStatus) {
  return status.kind === 'binding-restored'
    || status.kind === 'syncing'
    || status.kind === 'synced'
    || status.kind === 'persistent-binding-unavailable'
}

function formatMeshReconstructionClassification(classification: MeshReconstructionEvaluation['resultClassification']) {
  switch (classification) {
    case 'analytic':
      return 'analytic'
    case 'facetedFallback':
      return 'faceted fallback'
    case 'rejected':
      return 'rejected'
    case 'meshBodyException':
      return 'mesh body exception'
  }
}

function getMeshImportWarningLabel(reconstruction: MeshReconstructionEvaluation) {
  return reconstruction.resultClassification === 'facetedFallback'
    ? 'I accept the faceted fallback result and understand the original mesh file will not be saved in this document.'
    : 'I understand the original mesh file will not be saved in this document.'
}

function hasStepImportMaterializationTerminalTransition(
  previous: StepImportMaterializationStatus | null,
  next: StepImportMaterializationStatus | null,
) {
  if (previous && !next) {
    return true
  }

  if (!previous || !next) {
    return false
  }

  const previousById = new Map(previous.features.map((feature) => [feature.featureId, feature.state] as const))
  return next.features.some((feature) => {
    const prior = previousById.get(feature.featureId)
    return prior === 'pending' && feature.state !== 'pending'
  })
}

function formatStepImportStageDurations(feature: StepImportMaterializationFeatureStatus) {
  const parts = Object.entries(feature.stageDurationsMs)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0)
    .map(([stage, durationMs]) =>
      `${getStepImportMaterializationStageLabel(stage as StepImportMaterializationFeatureStatus['currentStage'])} ${Math.round(durationMs)}ms`,
    )

  return parts.slice(0, 3).join(' · ')
}

function canUseMeshImportReviewWorker() {
  return typeof Worker !== 'undefined' && typeof URL !== 'undefined'
}

function createMeshImportReviewWorker() {
  return new Worker(new URL('../domain/modeling/mesh-import-review.worker.ts', import.meta.url), { type: 'module' })
}

export function CadWorkbench() {
  const actionBus = useToolActionBus()
  const { triggerTool } = useToolActions()
  const modelingService = useModelingService()
  const errorReporter = useErrorReporter()
  const {
    machineState,
    state: {
      activeCommand,
      selection,
      hoverTarget,
      sketchSession,
      activeEditSession,
      mode,
      preview,
      selectionFilter,
      selectionCatalog,
      activeReferencePickerFieldId,
      history,
    },
    dispatch,
  } = useEditorState()
  const snapshot = machineState.snapshot
  const initialOccRenderPending = isInitialOccRenderPending(machineState)
  const previewRenderables = machineState.previewRenderables
  const [hiddenTargetKeys, setHiddenTargetKeys] = useState<Record<string, boolean>>({})
  const [objectLabelOverrides, setObjectLabelOverrides] = useState<Record<string, string>>({})
  const [invalidVariableValueMessages, setInvalidVariableValueMessages] = useState<Record<string, string>>({})
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [workbenchStatusNotification, setWorkbenchStatusNotification] =
    useState<WorkbenchNotificationModel | null>(null)
  const [objectExportModal, setObjectExportModal] = useState<ObjectExportModalState | null>(null)
  const [viewportFitRequestId, setViewportFitRequestId] = useState(0)
  const [stepImportFlow, setStepImportFlow] = useState<StepImportFlowState>({ kind: 'idle' })
  const [meshImportFlow, setMeshImportFlow] = useState<MeshImportFlowState>({ kind: 'idle' })
  const [meshImportProgress, setMeshImportProgress] = useState<MeshImportProgressState | null>(null)
  const [stepImportProgress, setStepImportProgress] = useState<StepImportProgressState | null>(null)
  const [stepImportMaterializationStatus, setStepImportMaterializationStatus] =
    useState<StepImportMaterializationStatus | null>(() => modelingService.getStepImportMaterializationStatus())
  const [localFileSyncEnabled, setLocalFileSyncEnabled] = useState(false)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
  const [undoStack, setUndoStack] = useState<WorkbenchUndoEntry[]>([])
  const [redoStack, setRedoStack] = useState<WorkbenchUndoEntry[]>([])
  const [isUndoRedoRunning, setIsUndoRedoRunning] = useState(false)
  const [isDocumentHistoryReorderRunning, setIsDocumentHistoryReorderRunning] = useState(false)
  const shellFrameRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef(snapshot)
  const undoStackRef = useRef(undoStack)
  const redoStackRef = useRef(redoStack)
  const sketchSessionRef = useRef(sketchSession)
  const stepImportMaterializationStatusRef = useRef(stepImportMaterializationStatus)
  const partImportInputRef = useRef<HTMLInputElement | null>(null)
  const meshImportFileReaderRef = useRef<FileReader | null>(null)
  const meshImportReviewWorkerRef = useRef<Worker | null>(null)
  const meshImportTaskSequenceRef = useRef(0)
  const notificationRightOffset = getWorkbenchNotificationRightOffsetPx({ reserveViewCube: true })
  // TODO: Replace with the cloud-save capability flag when cloud persistence is implemented.
  const cloudSaveEnabled = false
  const showBrowserStorageWarning = !localFileSyncEnabled && !cloudSaveEnabled
  const partImportEnabled = isPartImportEnabled()

  const showWorkbenchInfo = useCallback((message: string) => {
    setWorkbenchStatusNotification({
      type: 'info',
      title: 'Workbench action',
      message,
    })
  }, [])

  const showWorkbenchError = useCallback((message: string) => {
    setWorkbenchStatusNotification({
      type: 'error',
      title: 'Workbench action failed',
      message,
    })
  }, [])

  const openPartImportPicker = useCallback(() => {
    partImportInputRef.current?.click()
  }, [])

  const cancelMeshImportPreparation = useCallback(() => {
    meshImportTaskSequenceRef.current += 1
    meshImportFileReaderRef.current?.abort()
    meshImportFileReaderRef.current = null
    meshImportReviewWorkerRef.current?.terminate()
    meshImportReviewWorkerRef.current = null
    setMeshImportProgress(null)
  }, [])

  const readMeshImportFileBytes = useCallback((file: File) =>
    new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader()
      meshImportFileReaderRef.current = reader
      const cleanup = () => {
        if (meshImportFileReaderRef.current === reader) {
          meshImportFileReaderRef.current = null
        }
      }

      reader.addEventListener('load', () => {
        cleanup()
        if (!(reader.result instanceof ArrayBuffer)) {
          reject(new Error('Mesh file could not be read.'))
          return
        }

        resolve(new Uint8Array(reader.result))
      })
      reader.addEventListener('error', () => {
        cleanup()
        reject(reader.error ?? new Error('Mesh file could not be read.'))
      })
      reader.addEventListener('abort', () => {
        cleanup()
        reject(new Error('Mesh import cancelled.'))
      })
      reader.readAsArrayBuffer(file)
    }), [])

  const reviewMeshImportWithWorker = useCallback((
    fileName: string,
    bytes: Uint8Array,
    taskSequence: number,
  ) => {
    if (!canUseMeshImportReviewWorker()) {
      return Promise.reject(new Error('Mesh import worker is not available.'))
    }

    meshImportReviewWorkerRef.current?.terminate()
    const worker = createMeshImportReviewWorker()
    meshImportReviewWorkerRef.current = worker
    const requestId = `request_mesh_import_review_${taskSequence}` as RequestId
    const request: MeshImportReviewWorkerRequest = {
      kind: 'reviewMeshImport',
      requestId,
      fileName,
      bytes,
    }

    return new Promise<Extract<MeshImportReviewWorkerResponse, { kind: 'completed' }>['result']>((resolve, reject) => {
      const cleanup = () => {
        worker.removeEventListener('message', handleMessage)
        if (meshImportReviewWorkerRef.current === worker) {
          meshImportReviewWorkerRef.current = null
        }
      }
      const handleMessage = (event: MessageEvent<MeshImportReviewWorkerResponse>) => {
        const message = event.data
        if (message.requestId !== requestId || meshImportTaskSequenceRef.current !== taskSequence) {
          return
        }

        if (message.kind === 'progress') {
          setMeshImportProgress({
            fileName,
            message: message.message,
            progress: message.progress,
            canCancel: true,
          })
          return
        }

        cleanup()
        worker.terminate()

        if (message.kind === 'failure') {
          reject(new Error(message.message))
          return
        }

        resolve(message.result)
      }

      worker.addEventListener('message', handleMessage)
      worker.postMessage(request, [bytes.buffer as ArrayBuffer])
    })
  }, [])

  const applyLoadedSnapshot = useCallback((nextSnapshot: DocumentSnapshot) => {
    snapshotRef.current = nextSnapshot
    dispatch({ type: 'document.snapshotLoaded', snapshot: nextSnapshot })
  }, [dispatch])

  useEffect(() => installConsoleLoggingSubscribers(actionBus), [actionBus])

  useEffect(() => () => {
    meshImportFileReaderRef.current?.abort()
    meshImportReviewWorkerRef.current?.terminate()
  }, [])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    undoStackRef.current = undoStack
  }, [undoStack])

  useEffect(() => {
    redoStackRef.current = redoStack
  }, [redoStack])

  useEffect(() => {
    sketchSessionRef.current = sketchSession
  }, [sketchSession])

  useEffect(() => {
    stepImportMaterializationStatusRef.current = stepImportMaterializationStatus
  }, [stepImportMaterializationStatus])

  useEffect(() => {
    let disposed = false

    void modelingService.getHistoryRestoreState().then((state) => {
      if (disposed) {
        return
      }

      setRestoreMessage(
        state.kind === 'failed'
          ? (state.diagnostics[0]?.message ?? 'Operation history restore failed.')
          : null,
      )
    })

    return () => {
      disposed = true
    }
  }, [modelingService])

  useEffect(() => {
    return modelingService.subscribeToStepImportMaterializationStatus((status) => {
      const previous = stepImportMaterializationStatusRef.current
      stepImportMaterializationStatusRef.current = status
      setStepImportMaterializationStatus(status)

      if (!hasStepImportMaterializationTerminalTransition(previous, status)) {
        return
      }

      void modelingService.getCurrentDocumentSnapshot()
        .then((nextSnapshot) => {
          applyLoadedSnapshot(nextSnapshot)
        })
        .catch((error: unknown) => {
          showWorkbenchError('Document refresh failed.')
          errorReporter.report(
            createAppError({
              code: 'workbench/action-failed',
              message: 'Document refresh failed.',
              context: errorContext('reason', error instanceof Error ? error.message : 'Unknown failure'),
              cause: error,
            }),
            {
              source: 'workbench.file.refreshStepMaterialization',
              visibility: 'user',
            },
          )
        })
    })
  }, [applyLoadedSnapshot, errorReporter, modelingService, showWorkbenchError])

  const visibleHiddenTargetKeys = useMemo(() => {
    if (!snapshot) {
      return hiddenTargetKeys
    }

    const validTargetKeys = new Set([
      ...(snapshot?.presentation.objects ?? []).map((item) => getPrimitiveRefKey(item.target)),
    ])

    return Object.fromEntries(
      Object.entries(hiddenTargetKeys).filter(([key, hidden]) => hidden && validTargetKeys.has(key)),
    )
  }, [hiddenTargetKeys, snapshot])

  const visibleSelection = useMemo(
    () => selection.filter((target) => !isTargetHidden(target, visibleHiddenTargetKeys)),
    [selection, visibleHiddenTargetKeys],
  )
  const visibleHoverTarget =
    hoverTarget && !isTargetHidden(hoverTarget, visibleHiddenTargetKeys) ? hoverTarget : null

  const primarySelection = visibleSelection[0] ?? visibleHoverTarget ?? null
  const selectionDetail =
    snapshot && primarySelection ? getSelectionDetail(snapshot, primarySelection) : null
  const activeFeatureSnapshot =
    snapshot && activeEditSession?.featureId
      ? getFeatureSnapshot(snapshot, activeEditSession.featureId)
      : primarySelection?.kind === 'feature' && snapshot
        ? getFeatureSnapshot(snapshot, primarySelection.featureId)
        : null
  const editableFeatureSnapshot = activeFeatureSnapshot ?? null

  const { commitFeature, cancelFeature } = useFeatureEditing()
  const viewportRenderables = useMemo(
    () => {
      return composeViewportRenderables({
        snapshotRenderables: snapshot?.document.render.records ?? [],
        snapshotSketches: snapshot?.document.sketches ?? [],
        previewRenderables,
        sketchSession,
        hiddenTargetKeys: visibleHiddenTargetKeys,
      })
    },
    [previewRenderables, sketchSession, snapshot, visibleHiddenTargetKeys],
  )
  const sketchToolPresentation = sketchSession ? getSketchToolPresentation(sketchSession) : null
  const sketchAnnotations = sketchSession ? getSketchAnnotationDescriptors(sketchSession) : []
  const sketchRegionDiagnosticMessage = sketchSession
    ? getSketchSessionRegionDiagnostics(sketchSession).find((diagnostic) => diagnostic.severity !== 'info')?.message ?? null
    : null
  const debuggerState: WorkbenchStateDebuggerModel = {
    activeMode: mode,
    machineState: machineState.kind,
    command: activeCommand?.toolId ?? 'none',
    phase: activeCommand?.phase ?? 'idle',
    selectionCount: visibleSelection.length,
    selectionTargets:
      visibleSelection.length > 0
        ? visibleSelection.map((target) => getPrimitiveRefLabel(target)).join(', ')
        : 'Nothing selected',
    revision: snapshot?.document.revisionId ?? 'loading',
    snapshotDiagnosticsCount: snapshot?.document.diagnostics.length ?? 0,
    sketchSession: sketchSession?.commitRequest
      ? `${sketchSession.commitRequest.definition.entityIds.length} entities staged`
      : 'none',
    sketchPlane: sketchSession?.plane.key?.toUpperCase() ?? 'none',
    featureSession: activeEditSession
      ? `${activeEditSession.mode}:${activeEditSession.featureType}:${activeEditSession.status}`
      : 'none',
    previewState: preview?.label ?? 'No active preview',
    selectionFilterLabel: selectionFilter?.label ?? 'No active selection filter',
    activeTargetRule: selectionFilter?.requirements[0]?.description ?? 'No active target rule',
    selectableTargets: snapshot?.presentation.entities.map((entity) => getPrimitiveRefLabel(entity.target)) ?? [],
    featureIds: snapshot?.document.features.map((feature) => feature.featureId) ?? [],
    previewDiagnostics:
      activeEditSession?.diagnostics.map((diagnostic) => `${diagnostic.severity}: ${diagnostic.message}`).join('\n')
      ?? '',
    requirements:
      selectionFilter?.requirements.map((requirement) => ({
        id: requirement.id,
        label: requirement.label,
        description: requirement.description,
        slotCount: requirement.slots.length,
      })) ?? [],
    selectionDetail: {
      label: selectionDetail?.label ?? 'none',
      kindLabel: selectionDetail?.kindLabel ?? 'none',
      ownerLabel: selectionDetail?.ownerLabel ?? 'n/a',
      relatedLabels: selectionDetail?.relatedLabels ?? [],
      targetLabel: primarySelection ? getPrimitiveRefLabel(primarySelection) : 'none',
    },
    hoverTarget: visibleHoverTarget ? getPrimitiveRefLabel(visibleHoverTarget) : 'none',
    topologyDebug: createTopologyDebugSummary(snapshot),
  }

  useEffect(() => {
    if (import.meta.env.DEV) {
      syncCadTestState(debuggerState)
    }
  })

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return
    }

    window.__cadSelectTarget = (targetId: string) => dispatchCadTestSelection({
      targetId,
      snapshot,
      selection,
      selectionFilter,
      selectionCatalog,
      dispatch,
    })

    return () => {
      delete window.__cadSelectTarget
    }
  }, [dispatch, selection, selectionCatalog, selectionFilter, snapshot])

  const toolbarHistoryAvailability: EditorHistoryAvailability = sketchSession
    ? history
    : getWorkbenchHistoryAvailability({
        documentHistory: history,
        undoStackLength: undoStack.length,
        redoStackLength: redoStack.length,
        isUndoRedoRunning,
      })

  const handleViewportHover = (target: PrimitiveRef) => {
    dispatch({ type: 'viewport.hovered', target })
  }

  const handleViewportSelect = (target: PrimitiveRef) => {
    dispatch({ type: 'viewport.selectionRequested', target })
  }

  const handleViewportConnectedSketchSelect = (target: PrimitiveRef) => {
    dispatch({ type: 'sketch.connectedSelectionRequested', target })
  }

  const handleViewportDeselect = () => {
    dispatch({ type: 'selection.cleared' })
  }

  const handleViewportLodTierChange = (tierId: OccTessellationTierId) => {
    if (modelingService.setViewportLodTier(tierId)) {
      dispatch({ type: 'document.refreshRequested' })
    }
  }

  const handleShellSelect = (target: PrimitiveRef) => {
    dispatch({ type: 'viewport.selectionRequested', target })
    dispatch({ type: 'viewport.hoverCleared' })
  }

  const handleNavigationReopen = (target: PrimitiveRef) => {
    const reopenEvent = getNavigationReopenRequest(snapshot, target)

    if (!reopenEvent) {
      return
    }

    dispatch(reopenEvent)
  }

  const handleViewportHoverClear = () => {
    dispatch({ type: 'viewport.hoverCleared' })
  }

  const handleTargetVisibilityToggle = (target: PrimitiveRef) => {
    const targetKey = getPrimitiveRefKey(target)
    const nextHidden = !hiddenTargetKeys[targetKey]

    setHiddenTargetKeys((current) => ({
      ...current,
      [targetKey]: nextHidden,
    }))

    if (
      nextHidden
      && hoverTarget
      && (
        primitiveRefEquals(hoverTarget, target)
        || isTargetHidden(hoverTarget, { ...hiddenTargetKeys, [targetKey]: true })
      )
    ) {
      dispatch({ type: 'viewport.hoverCleared' })
    }
  }

  const showPlaceholderStatus = (message: string) => {
    showWorkbenchInfo(message)
  }

  const setVariableFailure = (
    variableId: DocumentVariableRecord['variableId'],
    error: AppError,
  ) => {
    setInvalidVariableValueMessages((current) => ({
      ...current,
      [variableId]: error.message,
    }))
    showWorkbenchError(error.message)
  }

  const handleDeleteTarget = (target: PrimitiveRef, label: string) => {
    if (!snapshot) {
      return
    }

    if (!isDurablePrimitiveRef(target)) {
      showWorkbenchError(`Delete ${label} failed.`)
      return
    }

    void runWorkbenchAction({
      operation: `Delete ${label}`,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'target', value: getPrimitiveRefKey(target) },
      ],
      action: () => modelingService.deleteTarget({
        baseRevisionId: snapshot.document.revisionId,
        target,
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation: `Delete ${label}`,
        fallbackMessage: `Delete ${label} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'target', value: getPrimitiveRefKey(target) },
        ],
      }),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      showWorkbenchInfo(`Deleted ${label}.`)
      dispatch({ type: 'document.refreshRequested' })
    })
  }

  const handleObjectExport = (target: PrimitiveRef, label: string) => {
    const nextModalState = createObjectExportModalState(snapshot, target, label)
    if (!nextModalState) {
      return
    }

    setWorkbenchStatusNotification(null)
    setObjectExportModal(nextModalState)
  }

  const handleDiagnosticInspectPlaceholder = (diagnostic: ModelingDiagnostic) => {
    showPlaceholderStatus(`Inspect diagnostic ${diagnostic.code} is not implemented yet.`)
  }

  const handleFeatureSuppressPlaceholder = (item: FeatureHistoryItem) => {
    showPlaceholderStatus(`Suppress for ${item.label} is not implemented yet.`)
  }

  const handleVariableAdd = () => {
    if (!snapshot) {
      return
    }

    void runWorkbenchAction({
      operation: 'Add variable',
      reporter: errorReporter,
      context: [{ key: 'baseRevisionId', value: snapshot.document.revisionId }],
      action: () => modelingService.addDocumentVariable({
        baseRevisionId: snapshot.document.revisionId,
        name: `var${snapshot.document.variables.length + 1}`,
        valueText: '0',
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation: 'Add variable',
        fallbackMessage: 'Add variable failed.',
        context: [{ key: 'baseRevisionId', value: snapshot.document.revisionId }],
      }),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isOk()) {
        dispatch({ type: 'document.refreshRequested' })
      }
    })
  }

  const applyVariablePatch = async (
    variableId: DocumentVariableRecord['variableId'],
    next: DocumentVariablePatch,
    failureLabel: string,
  ) => {
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot) {
      return false
    }

    const result = await runWorkbenchAction({
      operation: failureLabel,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: currentSnapshot.document.revisionId },
        { key: 'variableId', value: variableId },
      ],
      action: () => modelingService.updateDocumentVariable({
        baseRevisionId: currentSnapshot.document.revisionId,
        variableId,
        name: next.name,
        valueText: next.valueText,
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation: failureLabel,
        fallbackMessage: `${failureLabel} failed.`,
        context: [
          { key: 'baseRevisionId', value: currentSnapshot.document.revisionId },
          { key: 'variableId', value: variableId },
        ],
      }),
      onError: (error) => setVariableFailure(variableId, error),
    })

    if (result.isOk()) {
      setInvalidVariableValueMessages((current) => {
        const nextMessages = { ...current }
        delete nextMessages[variableId]
        return nextMessages
      })
      dispatch({ type: 'document.refreshRequested' })
      return true
    }

    return false
  }

  const applyDocumentHistoryOrder = async (
    nextOrder: DocumentHistoryOrderEntry[],
    failureLabel: string,
  ) => {
    const currentSnapshot = snapshotRef.current
    if (!currentSnapshot) {
      return false
    }

    const currentOrder = createDocumentHistoryOrder(currentSnapshot.presentation.documentHistory)
    const moves = getDocumentHistoryOrderRestoreMoves(currentOrder, nextOrder)
    if (!moves) {
      return false
    }

    let accepted = true

    for (const move of moves) {
      const latestSnapshot = snapshotRef.current
      if (!latestSnapshot) {
        return false
      }

      const result = await runWorkbenchAction({
        operation: failureLabel,
        reporter: errorReporter,
        context: [{ key: 'baseRevisionId', value: latestSnapshot.document.revisionId }],
        action: () => modelingService.reorderDocumentHistory({
          baseRevisionId: latestSnapshot.document.revisionId,
          item: move.item,
          beforeItem: move.beforeItem,
        }),
        mapSuccess: (result) => requireAcceptedModelingResult(result, {
          operation: failureLabel,
          fallbackMessage: `${failureLabel} failed.`,
          context: [{ key: 'baseRevisionId', value: latestSnapshot.document.revisionId }],
        }),
        onError: (error) => showWorkbenchError(error.message),
      })

      if (result.isErr()) {
        accepted = false
        break
      }

      const refreshedSnapshot = await modelingService.getCurrentDocumentSnapshot()
      applyLoadedSnapshot(refreshedSnapshot)
    }

    const finalOrder = snapshotRef.current
      ? createDocumentHistoryOrder(snapshotRef.current.presentation.documentHistory)
      : currentOrder
    return accepted && documentHistoryOrdersEqual(nextOrder, finalOrder)
  }

  const applyUndoEntry = (entry: WorkbenchUndoEntry, direction: 'undo' | 'redo') => {
    switch (entry.kind) {
      case 'updateVariable':
        return applyVariablePatch(
          entry.variableId,
          direction === 'undo' ? entry.before : entry.after,
          direction === 'undo' ? `Undo ${entry.label}` : `Redo ${entry.label}`,
        )
      case 'reorderDocumentHistory':
        return applyDocumentHistoryOrder(
          direction === 'undo' ? entry.before : entry.after,
          direction === 'undo' ? `Undo ${entry.label}` : `Redo ${entry.label}`,
        )
    }
  }

  const performWorkbenchUndo = async () => {
    if (sketchSessionRef.current || isUndoRedoRunning) {
      return
    }

    const entry = undoStackRef.current.at(-1)
    const documentCursor = entry || !history.canUndo || !snapshotRef.current
      ? null
      : getPreviousDocumentHistoryCursor(snapshotRef.current)
    if (!entry && !documentCursor) {
      return
    }

    if (entry) {
      setIsUndoRedoRunning(true)
      try {
        const accepted = await applyUndoEntry(entry, 'undo')
        if (accepted) {
          setUndoStack((current) => current.slice(0, -1))
          setRedoStack((current) => [...current, entry])
        }
        return
      } finally {
        setIsUndoRedoRunning(false)
      }
    }

    if (documentCursor) {
      dispatch({ type: 'document.historyCursorRequested', cursor: documentCursor })
    }
  }

  const performWorkbenchRedo = async () => {
    if (sketchSessionRef.current || isUndoRedoRunning) {
      return
    }

    const entry = redoStackRef.current.at(-1)
    const documentCursor = entry || !history.canRedo || !snapshotRef.current
      ? null
      : getNextDocumentHistoryCursor(snapshotRef.current)
    if (!entry && !documentCursor) {
      return
    }

    if (entry) {
      setIsUndoRedoRunning(true)
      try {
        const accepted = await applyUndoEntry(entry, 'redo')
        if (accepted) {
          setRedoStack((current) => current.slice(0, -1))
          setUndoStack((current) => [...current, entry])
        }
        return
      } finally {
        setIsUndoRedoRunning(false)
      }
    }

    if (documentCursor) {
      dispatch({ type: 'document.historyCursorRequested', cursor: documentCursor })
    }
  }

  useEffect(() => {
    const unsubscribeUndo = actionBus.subscribeToTool('undo', () => {
      void performWorkbenchUndo()
    })
    const unsubscribeRedo = actionBus.subscribeToTool('redo', () => {
      void performWorkbenchRedo()
    })

    return () => {
      unsubscribeUndo()
      unsubscribeRedo()
    }
  })

  const handleVariableUpdate = (
    variable: DocumentVariableRecord,
    next: DocumentVariablePatch,
  ) => {
    if (!snapshot) {
      return
    }

    const operation = `Update ${variable.name || variable.variableId}`
    void runWorkbenchAction({
      operation,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'variableId', value: variable.variableId },
      ],
      action: () => modelingService.updateDocumentVariable({
        baseRevisionId: snapshot.document.revisionId,
        variableId: variable.variableId,
        name: next.name,
        valueText: next.valueText,
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation,
        fallbackMessage: `${operation} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'variableId', value: variable.variableId },
        ],
      }),
      onError: (error) => setVariableFailure(variable.variableId, error),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      setInvalidVariableValueMessages((current) => {
        const nextMessages = { ...current }
        delete nextMessages[variable.variableId]
        return nextMessages
      })
      setUndoStack((current) => [
        ...current,
        {
          kind: 'updateVariable',
          variableId: variable.variableId,
          before: {
            name: variable.name,
            valueText: variable.valueText,
          },
          after: next,
          label: variable.name || variable.variableId,
        },
      ])
      setRedoStack([])
      dispatch({ type: 'document.refreshRequested' })
    })
  }

  const handleDocumentHistoryDelete = (item: DocumentHistoryItemRecord) => {
    handleDeleteTarget(item.target, item.label)
  }

  const requestRenameLabel = (currentLabel: string) => {
    const nextLabel = window.prompt('Rename', currentLabel)?.trim()

    if (nextLabel === undefined) {
      return null
    }

    if (!nextLabel) {
      showWorkbenchError('Name cannot be empty.')
      return null
    }

    if (nextLabel === currentLabel) {
      return null
    }

    return nextLabel
  }

  const handleSketchRename = (item: SketchHistoryItem | { sketchId: SketchHistoryItem['sketchId']; label: string }) => {
    if (!snapshot) {
      return
    }

    const nextLabel = requestRenameLabel(item.label)
    if (!nextLabel) {
      return
    }

    const sketch = snapshot.document.sketches.find((entry) => entry.sketchId === item.sketchId)
    if (!sketch) {
      showWorkbenchError(`Could not find ${item.label}.`)
      return
    }

    void runWorkbenchAction({
      operation: `Rename ${item.label}`,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'sketchId', value: sketch.sketchId },
      ],
      action: () => modelingService.commitSketch({
        baseRevisionId: snapshot.document.revisionId,
        solverCorrelation: null,
        sketchId: sketch.sketchId,
        sketchLabel: nextLabel,
        plane: sketch.plane,
        planeTarget: sketch.planeTarget,
        planeKey: sketch.planeKey,
        definition: sketch.sketch.definition,
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation: `Rename ${item.label}`,
        fallbackMessage: `Rename ${item.label} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'sketchId', value: sketch.sketchId },
        ],
      }),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      showWorkbenchInfo(`Renamed ${item.label} to ${nextLabel}.`)
      dispatch({ type: 'document.refreshRequested' })
    })
  }

  const handleFeatureRename = (item: FeatureHistoryItem | { featureId: FeatureHistoryItem['featureId']; label: string }) => {
    if (!snapshot) {
      return
    }

    const nextLabel = requestRenameLabel(item.label)
    if (!nextLabel) {
      return
    }

    const feature = snapshot.document.features.find((entry) => entry.featureId === item.featureId)
    if (!feature) {
      showWorkbenchError(`Could not find ${item.label}.`)
      return
    }

    void runWorkbenchAction({
      operation: `Rename ${item.label}`,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'featureId', value: feature.featureId },
      ],
      action: () => modelingService.updateFeature({
        baseRevisionId: snapshot.document.revisionId,
        featureId: feature.featureId,
        featureLabel: nextLabel,
        definition: feature.definition,
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation: `Rename ${item.label}`,
        fallbackMessage: `Rename ${item.label} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'featureId', value: feature.featureId },
        ],
      }),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      showWorkbenchInfo(`Renamed ${item.label} to ${nextLabel}.`)
      dispatch({ type: 'document.refreshRequested' })
    })
  }

  const handleDocumentHistoryRename = (item: DocumentHistoryItemRecord) => {
    if (item.kind === 'sketch') {
      handleSketchRename(item)
      return
    }

    handleFeatureRename(item)
  }

  const handleTargetRename = (target: PrimitiveRef, label: string) => {
    if (target.kind === 'sketch') {
      handleSketchRename({ sketchId: target.sketchId, label })
      return
    }

    if (target.kind === 'feature') {
      handleFeatureRename({ featureId: target.featureId, label })
      return
    }

    if (target.kind === 'body') {
      if (!snapshot) {
        return
      }

      const nextLabel = requestRenameLabel(label)
      if (!nextLabel) {
        return
      }

      void runWorkbenchAction({
        operation: `Rename ${label}`,
        reporter: errorReporter,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'bodyId', value: target.bodyId },
        ],
        action: () => modelingService.renameBody({
          baseRevisionId: snapshot.document.revisionId,
          bodyId: target.bodyId,
          bodyLabel: nextLabel,
        }),
        mapSuccess: (result) => requireAcceptedModelingResult(result, {
          operation: `Rename ${label}`,
          fallbackMessage: `Rename ${label} failed.`,
          context: [
            { key: 'baseRevisionId', value: snapshot.document.revisionId },
            { key: 'bodyId', value: target.bodyId },
          ],
        }),
        onError: (error) => showWorkbenchError(error.message),
      }).then((result) => {
        if (result.isErr()) {
          return
        }

        setObjectLabelOverrides((current) => {
          const next = { ...current }
          delete next[getPrimitiveRefKey(target)]
          return next
        })
        showWorkbenchInfo(`Renamed ${label} to ${nextLabel}.`)
        dispatch({ type: 'document.refreshRequested' })
      })
      return
    }

    const nextLabel = requestRenameLabel(label)
    if (!nextLabel) {
      return
    }

    setObjectLabelOverrides((current) => ({
      ...current,
      [getPrimitiveRefKey(target)]: nextLabel,
    }))
    showWorkbenchInfo(`Renamed ${label} to ${nextLabel}.`)
  }

  const handleTimelineCursorRequested = (cursor: DocumentFeatureCursor) => {
    dispatch({ type: 'document.historyCursorRequested', cursor })
  }

  const handleDocumentHistoryReorder = (
    item: DocumentHistoryOrderEntry,
    beforeItem: DocumentHistoryOrderEntry | null,
  ) => {
    if (!snapshot || isDocumentHistoryReorderRunning) {
      return
    }

    const beforeOrder = createDocumentHistoryOrder(snapshot.presentation.documentHistory)
    setIsDocumentHistoryReorderRunning(true)
    void runWorkbenchAction({
      operation: 'Reorder document history',
      reporter: errorReporter,
      context: [{ key: 'baseRevisionId', value: snapshot.document.revisionId }],
      action: () => modelingService.reorderDocumentHistory({
        baseRevisionId: snapshot.document.revisionId,
        item,
        beforeItem,
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation: 'Reorder document history',
        fallbackMessage: 'Reorder document history failed.',
        context: [{ key: 'baseRevisionId', value: snapshot.document.revisionId }],
      }),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      return modelingService.getCurrentDocumentSnapshot().then((nextSnapshot) => {
        applyLoadedSnapshot(nextSnapshot)
        const afterOrder = createDocumentHistoryOrder(nextSnapshot.presentation.documentHistory)
        if (!documentHistoryOrdersEqual(beforeOrder, afterOrder)) {
          setUndoStack((current) => [
            ...current,
            {
              kind: 'reorderDocumentHistory',
              before: beforeOrder,
              after: afterOrder,
              label: 'document history reorder',
            },
          ])
          setRedoStack([])
        }
      })
    }).finally(() => {
      setIsDocumentHistoryReorderRunning(false)
    })
  }

  const handleSketchMove = (point: readonly [number, number]) => {
    dispatch({ type: 'sketch.pointerMoved', point })
  }

  const handleSketchRelease = (point: readonly [number, number], target?: PrimitiveRef | null) => {
    dispatch({ type: 'sketch.pointerReleased', point, target })
  }

  const handleSketchGeometryDragStart = (target: PrimitiveRef, point: readonly [number, number]) => {
    dispatch({ type: 'sketch.geometryDragStarted', target, point })
  }

  const handleSketchGeometryDragMove = (point: readonly [number, number]) => {
    dispatch({ type: 'sketch.geometryDragMoved', point })
  }

  const handleSketchGeometryDragEnd = (point: readonly [number, number]) => {
    dispatch({ type: 'sketch.geometryDragEnded', point })
  }

  const handleSidebarResizeStart = (event: ReactPointerEvent<HTMLDivElement>) => {
    const container = shellFrameRef.current
    if (!container) {
      return
    }

    event.preventDefault()

    const containerRect = container.getBoundingClientRect()
    const updateSidebarWidth = (pointerClientX: number) => {
      setLeftSidebarWidth((current) => {
        const nextWidth = getWorkbenchSidebarWidthFromPointer(
          pointerClientX,
          containerRect.left,
          containerRect.width,
        )

        return nextWidth === current ? current : nextWidth
      })
    }

    updateSidebarWidth(event.clientX)

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updateSidebarWidth(moveEvent.clientX)
    }

    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }

  useEffect(() => {
    const container = shellFrameRef.current
    if (!container) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      setLeftSidebarWidth((current) =>
        clampWorkbenchSidebarWidth(current, container.getBoundingClientRect().width),
      )
    })

    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [])

  const shortcutActiveScopes = useMemo(
    () => getWorkbenchShortcutActiveScopes(mode),
    [mode],
  )
  const shortcutCommandHandlers = createWorkbenchShortcutCommandHandlers({
    activeCommand,
    activeReferencePickerFieldId,
    dispatch,
    mode,
    selection,
    sketchSession,
    triggerTool,
  })
  shortcutCommandHandlers['editor.undo'] = {
    execute: () => {
      if (sketchSessionRef.current) {
        dispatch({ type: 'history.undoRequested' })
        return
      }

      void performWorkbenchUndo()
    },
    isEnabled: () => toolbarHistoryAvailability.canUndo,
  }
  shortcutCommandHandlers['editor.redo'] = {
    execute: () => {
      if (sketchSessionRef.current) {
        dispatch({ type: 'history.redoRequested' })
        return
      }

      void performWorkbenchRedo()
    },
    isEnabled: () => toolbarHistoryAvailability.canRedo,
  }

  const createCurrentBugReportPayload = () =>
    createBugReportPayload({
      build: {
        version: appVersion,
        commit: gitCommit,
        mode: getBuildModeLabel(import.meta.env.MODE, import.meta.env.DEV),
      },
      editorState: {
        mode,
        activeCommand,
        selection,
        selectionFilter,
        preview,
        activeEditSession,
        activeReferencePickerFieldId,
        sketchSession,
      },
      snapshot,
      storage: window.localStorage,
      environment: {
        navigator: window.navigator,
        window,
        document,
      },
    })

  const handleReportBug = () => {
    try {
      const result = createCurrentBugReportPayload()
      const artifact = createBugReportDebugArtifact(result)
      let artifactStatus: BugReportArtifactStatus = { kind: 'not-needed' }

      if (artifact) {
        try {
          downloadBugReportDebugArtifact(artifact)
          artifactStatus = { kind: 'downloaded', filename: artifact.filename }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Debug artifact could not be downloaded.'
          artifactStatus = {
            kind: 'unavailable',
            filename: artifact.filename,
            reason: message,
          }
          errorReporter.report(
            createAppError({
              code: 'workbench/action-failed',
              message: 'Bug-report debug artifact generation failed.',
              context: errorContext('reason', message),
              cause: error,
            }),
            {
              source: 'workbench.reportBug',
              visibility: 'developer',
            },
          )
        }
      }

      const issueDraft = createBugReportIssueDraft(result, { artifactStatus })
      const opened = window.open(issueDraft.url, '_blank', 'noopener,noreferrer')
      if (!opened) {
        showWorkbenchError('GitHub bug report could not be opened. Check popup blocking for this site.')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bug-report payload generation failed.'
      errorReporter.report(
        createAppError({
          code: 'workbench/action-failed',
          message: 'Bug-report generation failed.',
          context: errorContext('reason', message),
          cause: error,
        }),
        {
          source: 'workbench.reportBug',
          visibility: 'developer',
        },
      )

      const opened = window.open(createFallbackBugReportIssueUrl(error), '_blank', 'noopener,noreferrer')
      if (!opened) {
        showWorkbenchError('GitHub bug report could not be opened. Check popup blocking for this site.')
      }
    }
  }

  const handleDownloadBugReportState = async () => {
    try {
      const archive = await createBugReportStateArchive(createCurrentBugReportPayload(), {
        storage: window.localStorage,
        indexedDB: window.indexedDB,
      })

      downloadBugReportDebugArtifact(archive)
      showWorkbenchInfo(`Downloaded ${archive.filename}.`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Debug state archive could not be downloaded.'
      showWorkbenchError('Debug state download failed.')
      errorReporter.report(
        createAppError({
          code: 'workbench/action-failed',
          message: 'Debug state archive generation failed.',
          context: errorContext('reason', message),
          cause: error,
        }),
        {
          source: 'workbench.downloadBugReportState',
          visibility: 'developer',
        },
      )
    }
  }

  const refreshAfterDocumentFileAction = (message: string, options: { fitView?: boolean } = {}) => {
    setHiddenTargetKeys({})
    setObjectLabelOverrides({})
    setUndoStack([])
    setRedoStack([])
    if (options.fitView) {
      return modelingService.getCurrentDocumentSnapshot().then((nextSnapshot) => {
        applyLoadedSnapshot(nextSnapshot)
        setViewportFitRequestId((current) => current + 1)
        showWorkbenchInfo(message)
      }).catch((error: unknown) => {
        reportDocumentFileActionFailure('workbench.file.refresh', 'Document refresh failed.', error)
      })
      return
    }

    dispatch({ type: 'document.refreshRequested' })
    showWorkbenchInfo(message)
    return Promise.resolve()
  }

  const reportDocumentFileActionFailure = useCallback((source: string, message: string, error: unknown) => {
    showWorkbenchError(message)
    errorReporter.report(
      createAppError({
        code: 'workbench/action-failed',
        message,
        context: errorContext('reason', error instanceof Error ? error.message : 'Unknown failure'),
        cause: error,
      }),
      {
        source,
        visibility: 'user',
      },
    )
  }, [errorReporter, showWorkbenchError])

  const showLocalFileSyncUnsupported = () => {
    showWorkbenchError(
      'Local file sync requires the File System Access API. In Brave, enable brave://flags/#file-system-access-api and relaunch, or use Chrome/Edge.',
    )
  }

  useEffect(() => {
    return modelingService.subscribeToLocalFileSyncStatus((status) => {
      setLocalFileSyncEnabled(isLocalFileSyncEnabledStatus(status))

      switch (status.kind) {
        case 'binding-restored':
          showWorkbenchInfo(`Restored local file sync for ${status.metadata.fileName}.`)
          return
        case 'syncing':
          showWorkbenchInfo(`Syncing ${status.metadata.fileName}.`)
          return
        case 'synced':
          showWorkbenchInfo(`Synced ${status.metadata.fileName}.`)
          return
        case 'persistent-binding-unavailable':
          showWorkbenchInfo(status.message)
          return
        case 'permission-required':
          showWorkbenchError(`Local file sync needs write permission for ${status.metadata.fileName}.`)
          return
        case 'permission-denied':
          showWorkbenchError(status.message)
          return
        case 'failed':
          showWorkbenchError(status.message)
          return
        case 'idle':
          return
      }
    })
  }, [modelingService, showWorkbenchError, showWorkbenchInfo])

  useEffect(() => {
    let disposed = false

    void modelingService.restoreLocalFileBinding().then((metadata) => {
      if (!disposed && metadata) {
        showWorkbenchInfo(`Restored local file sync for ${metadata.fileName}.`)
      }
    }).catch((error: unknown) => {
      if (!disposed) {
        reportDocumentFileActionFailure('workbench.file.restoreLocalBinding', 'Local file sync restore failed.', error)
      }
    })

    return () => {
      disposed = true
    }
  }, [modelingService, reportDocumentFileActionFailure, showWorkbenchInfo])

  const handleNewDocument = async () => {
    try {
      const result = await modelingService.createNewDocument()
      if (!result.ok) {
        showWorkbenchError(result.diagnostics[0]?.message ?? 'New document could not be created.')
        return
      }

      refreshAfterDocumentFileAction('Created a new document.')
    } catch (error) {
      reportDocumentFileActionFailure('workbench.file.new', 'New document failed.', error)
    }
  }

  const createStepImportLabel = (fileName: string) => {
    const baseName = fileName.split(/[\\/]/).pop()?.replace(/\.(?:step|stp)$/i, '').trim()
    return baseName && baseName.length > 0 ? baseName : 'STEP Import'
  }

  const createMeshImportLabel = (fileName: string) => {
    const baseName = fileName.split(/[\\/]/).pop()?.replace(/\.(?:stl|3mf)$/i, '').trim()
    return baseName && baseName.length > 0 ? baseName : 'Mesh Import'
  }

  const getImportFileName = (file: File) => {
    const fileWithRelativePath = file as File & { webkitRelativePath?: string }
    return fileWithRelativePath.webkitRelativePath?.trim() || file.name
  }

  const prepareStepImportFiles = async (files: readonly File[]) => {
    const label = createStepImportLabel(files[0] ? getImportFileName(files[0]) : 'STEP Import')
    setStepImportFlow({ kind: 'preparing', fileNames: files.map(getImportFileName), label })
    const stepFiles = await Promise.all(files.map(async (file) => ({
      fileName: getImportFileName(file),
      bytes: new Uint8Array(await file.arrayBuffer()),
    })))
    const review = await modelingService.prepareStepImportReview({ files: stepFiles })
    setStepImportFlow({
      kind: 'review',
      files: stepFiles,
      review,
      selectedSolidKeys: review.solids.filter((solid) => solid.importable).map((solid) => solid.solidKey),
      label,
    })
  }

  const handleImportDocument = async (file: File) => {
    if (/\.(?:step|stp)$/i.test(file.name)) {
      try {
        await prepareStepImportFiles([file])
      } catch (error) {
        reportDocumentFileActionFailure('workbench.file.prepare-step-import', 'STEP import failed.', error)
      }
      return
    }

    if (/\.(?:stl|3mf)$/i.test(file.name)) {
      const taskSequence = meshImportTaskSequenceRef.current + 1
      meshImportTaskSequenceRef.current = taskSequence
      meshImportReviewWorkerRef.current?.terminate()
      meshImportReviewWorkerRef.current = null
      setMeshImportFlow({ kind: 'idle' })
      setMeshImportProgress({
        fileName: file.name,
        message: 'Reading mesh file',
        progress: 8,
        canCancel: true,
      })
      try {
        if (/\.stl$/i.test(file.name)) {
          const headerBytes = new Uint8Array(await file.slice(0, 84).arrayBuffer())
          if (meshImportTaskSequenceRef.current !== taskSequence) {
            return
          }

          const triangleCount = getBinaryStlTriangleCount({ headerBytes, byteLength: file.size })
          const limitEvaluation = triangleCount === null
            ? null
            : createMeshSizeLimitEvaluation({ triangleCount })
          if (limitEvaluation) {
            setMeshImportProgress(null)
            setMeshImportFlow({
              kind: 'review',
              fileName: file.name,
              assetInput: null,
              label: createMeshImportLabel(file.name),
              warningAccepted: false,
              reconstruction: limitEvaluation,
            })
            return
          }
        }

        setMeshImportProgress({
          fileName: file.name,
          message: 'Loading mesh bytes',
          progress: 15,
          canCancel: true,
        })
        const bytes = await readMeshImportFileBytes(file)
        if (meshImportTaskSequenceRef.current !== taskSequence) {
          return
        }

        const review = await reviewMeshImportWithWorker(file.name, bytes, taskSequence)
        if (meshImportTaskSequenceRef.current !== taskSequence) {
          return
        }

        setMeshImportProgress(null)
        setMeshImportFlow({
          kind: 'review',
          fileName: file.name,
          assetInput: review.assetInput,
          label: createMeshImportLabel(file.name),
          warningAccepted: false,
          reconstruction: review.reconstruction,
        })
      } catch (error) {
        if (meshImportTaskSequenceRef.current === taskSequence) {
          setMeshImportProgress(null)
          showWorkbenchError(error instanceof Error ? error.message : 'Mesh import failed.')
        }
      }
      return
    }

    let payload: unknown

    try {
      payload = await readCadaraDocumentFile(file)
    } catch (error: unknown) {
      const message = error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
        ? 'Import failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
        : 'Import failed. Select a valid cadara JSON document.'
      showWorkbenchError(message)
      return
    }

    try {
      const result = await modelingService.importDocument({ document: payload })
      if (!result.ok) {
        showWorkbenchError(result.diagnostics[0]?.message ?? 'Import failed.')
        return
      }

      refreshAfterDocumentFileAction(`Imported ${file.name}.`)
    } catch (error) {
      reportDocumentFileActionFailure('workbench.file.import', 'Import failed.', error)
    }
  }

  const handlePartImportFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''

    if (files.length === 0) {
      return
    }

    const stepFiles = files.filter((file) => /\.(?:step|stp)$/i.test(getImportFileName(file)))
    const meshFiles = files.filter((file) => /\.(?:stl|3mf)$/i.test(getImportFileName(file)))

    if (stepFiles.length === files.length) {
      void prepareStepImportFiles(stepFiles).catch((error) => {
        reportDocumentFileActionFailure('workbench.file.prepare-step-import', 'STEP import failed.', error)
      })
      return
    }

    if (files.length === 1 && meshFiles.length === 1) {
      void handleImportDocument(files[0]!)
      return
    }

    showWorkbenchError('Import failed. Select STEP files together, or one STL/3MF mesh file.')
  }

  useEffect(() => {
    if (!partImportEnabled) {
      return
    }

    return actionBus.subscribeToTool('importPart', openPartImportPicker)
  }, [actionBus, openPartImportPicker, partImportEnabled])

  const handleStepImportCancel = () => {
    setStepImportFlow({ kind: 'idle' })
  }

  const handleStepImportSolidToggle = (solidKey: string, checked: boolean) => {
    setStepImportFlow((current) => {
      if (current.kind !== 'review') {
        return current
      }

      const selected = new Set(current.selectedSolidKeys)
      if (checked) {
        selected.add(solidKey)
      } else {
        selected.delete(solidKey)
      }

      return { ...current, selectedSolidKeys: [...selected] }
    })
  }

  const handleStepImportSelectAll = (checked: boolean) => {
    setStepImportFlow((current) =>
      current.kind === 'review'
        ? {
            ...current,
            selectedSolidKeys: checked
              ? current.review.solids.filter((solid) => solid.importable).map((solid) => solid.solidKey)
              : [],
          }
        : current,
    )
  }

  const handleMeshImportCancel = () => {
    cancelMeshImportPreparation()
    setMeshImportFlow({ kind: 'idle' })
  }

  const handleMeshImportWarningAcceptedChange = (accepted: boolean) => {
    setMeshImportFlow((current) =>
      current.kind === 'review'
        ? { ...current, warningAccepted: accepted }
        : current,
    )
  }

  const handleStepImportAccept = async () => {
    if (stepImportFlow.kind !== 'review') {
      return
    }

    const review = stepImportFlow
    setStepImportFlow({ kind: 'idle' })
    setStepImportProgress({
      fileName: review.review.rootFileName,
      message: 'Baking Cadara geometry',
      progress: 72,
    })
    try {
      const result = await modelingService.commitPreparedStepImport({
        files: review.files,
        review: review.review,
        selectedSolidKeys: review.selectedSolidKeys,
      })
      if (!result.ok) {
        setStepImportFlow(review)
        setStepImportProgress(null)
        showWorkbenchError(result.diagnostics[0]?.message ?? 'STEP import failed.')
        return
      }

      setStepImportProgress({
        fileName: review.review.rootFileName,
        message: 'Refreshing imported solids',
        progress: 94,
      })
      await refreshAfterDocumentFileAction(`Imported ${review.review.rootFileName}.`, { fitView: true })
      setStepImportProgress(null)
    } catch (error) {
      setStepImportFlow(review)
      setStepImportProgress(null)
      reportDocumentFileActionFailure('workbench.file.import-step', 'STEP import failed.', error)
    }
  }

  const handleMeshImportAccept = async () => {
    if (meshImportFlow.kind !== 'review' || !meshImportFlow.warningAccepted || !meshImportFlow.assetInput) {
      return
    }

    const review = meshImportFlow
    const assetInput = meshImportFlow.assetInput
    setMeshImportFlow({ kind: 'idle' })
    setMeshImportProgress({
      fileName: review.fileName,
      message: 'Committing prepared mesh',
      progress: 92,
      canCancel: false,
    })
    try {
      const result = await modelingService.importPreparedMeshFile({
        fileName: review.fileName,
        assetInput,
      })
      if (!result.ok) {
        setMeshImportFlow(review)
        setMeshImportProgress(null)
        showWorkbenchError(result.diagnostics[0]?.message ?? 'Mesh import failed.')
        return
      }

      setMeshImportProgress(null)
      setHiddenTargetKeys({})
      setObjectLabelOverrides({})
      setUndoStack([])
      setRedoStack([])
      showWorkbenchInfo(`Imported ${review.fileName}. Mesh rebuild will run when the viewport refreshes.`)
    } catch (error) {
      setMeshImportFlow(review)
      setMeshImportProgress(null)
      reportDocumentFileActionFailure('workbench.file.import-mesh', 'Mesh import failed.', error)
    }
  }

  const handleOpenLocalFile = async () => {
    const pickerResult = await showOpenLocalDocumentPicker()
    if (!pickerResult.ok) {
      if (pickerResult.reason === 'cancelled') {
        return
      }
      if (pickerResult.reason === 'unsupported') {
        showLocalFileSyncUnsupported()
        return
      }

      reportDocumentFileActionFailure('workbench.file.openLocal', 'Open local file failed.', pickerResult.error)
      return
    }

    if (!await ensureLocalFileWritePermission(pickerResult.handle)) {
      showWorkbenchError('Local file write permission was denied.')
      return
    }

    let payload: unknown
    try {
      payload = await readLocalCadaraDocument(pickerResult.handle)
    } catch (error: unknown) {
      const message = error instanceof Error && error.message.includes('ZIP-backed .cadara packages are unsupported')
        ? 'Open local file failed. ZIP-backed .cadara packages are no longer supported; select a single JSON .cadara document.'
        : 'Open local file failed. Select a valid cadara JSON document.'
      reportDocumentFileActionFailure('workbench.file.openLocal', message, error)
      return
    }

    try {
      const result = await modelingService.importDocument({ document: payload })
      if (!result.ok) {
        showWorkbenchError(result.diagnostics[0]?.message ?? 'Open local file failed.')
        return
      }

      const binding = await modelingService.bindLocalFile({
        handle: pickerResult.handle,
        metadata: createLocalFileBindingMetadata(modelingService.currentDocumentId, pickerResult.handle),
      })
      if (!binding.ok) {
        showWorkbenchError(binding.diagnostics[0]?.message ?? 'Local file sync target could not be bound.')
        return
      }

      refreshAfterDocumentFileAction(`Opened ${pickerResult.handle.name}. Local file sync is active.`)
    } catch (error: unknown) {
      reportDocumentFileActionFailure('workbench.file.openLocal', 'Open local file failed.', error)
    }
  }

  const handleSaveLocalFile = async () => {
    const pickerResult = await showSaveLocalDocumentPicker()
    if (!pickerResult.ok) {
      if (pickerResult.reason === 'cancelled') {
        return
      }
      if (pickerResult.reason === 'unsupported') {
        showLocalFileSyncUnsupported()
        return
      }

      reportDocumentFileActionFailure('workbench.file.saveLocal', 'Save local file failed.', pickerResult.error)
      return
    }

    try {
      if (!await ensureLocalFileWritePermission(pickerResult.handle)) {
        showWorkbenchError('Local file write permission was denied.')
        return
      }

      const result = await modelingService.exportCurrentDocument()
      const writeResult = await writeTextToLocalFileHandle(pickerResult.handle, result.payload)
      if (!writeResult.ok) {
        if (writeResult.reason === 'permission-denied') {
          showWorkbenchError('Local file write permission was denied.')
          return
        }

        reportDocumentFileActionFailure('workbench.file.saveLocal', 'Save local file failed.', writeResult.error)
        return
      }

      const binding = await modelingService.bindLocalFile({
        handle: pickerResult.handle,
        metadata: createLocalFileBindingMetadata(modelingService.currentDocumentId, pickerResult.handle),
      })
      if (!binding.ok) {
        showWorkbenchError(binding.diagnostics[0]?.message ?? 'Local file sync target could not be bound.')
        return
      }

      showWorkbenchInfo(`Saved ${pickerResult.handle.name}. Local file sync is active.`)
    } catch (error: unknown) {
      reportDocumentFileActionFailure('workbench.file.saveLocal', 'Save local file failed.', error)
    }
  }

  const handleExportDocument = async () => {
    try {
      const result = await modelingService.exportCurrentDocument()
      downloadDocumentExportResult(result)
      showWorkbenchInfo(`Exported ${result.filename}.`)
    } catch (error) {
      reportDocumentFileActionFailure('workbench.file.export', 'Export failed.', error)
    }
  }

  const stepReview = stepImportFlow.kind === 'review' ? stepImportFlow : null
  const stepImportableSolids = stepReview?.review.solids.filter((solid) => solid.importable) ?? []
  const selectedStepSolidKeys = new Set(stepReview?.selectedSolidKeys ?? [])
  const selectedStepSolidCount = stepImportableSolids.filter((solid) => selectedStepSolidKeys.has(solid.solidKey)).length
  const allStepSolidsSelected = stepImportableSolids.length > 0 && selectedStepSolidCount === stepImportableSolids.length
  const someStepSolidsSelected = selectedStepSolidCount > 0 && selectedStepSolidCount < stepImportableSolids.length
  const stepImportDisabled = stepReview
    ? selectedStepSolidCount === 0 || stepReview.review.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    : true
  const activeImportProgress = stepImportProgress
    ? {
        kind: 'step' as const,
        title: 'Importing STEP',
        fileName: stepImportProgress.fileName,
        message: stepImportProgress.message,
        progress: stepImportProgress.progress,
        canCancel: false,
      }
    : meshImportProgress
      ? {
          kind: 'mesh' as const,
          title: 'Importing mesh',
          fileName: meshImportProgress.fileName,
        message: meshImportProgress.message,
        progress: meshImportProgress.progress,
        canCancel: meshImportProgress.canCancel,
      }
      : null
  const activeStepImportMaterializationFeatures = stepImportMaterializationStatus?.features ?? []

  return (
    <ShortcutProvider activeScopes={shortcutActiveScopes} commandHandlers={shortcutCommandHandlers}>
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-[var(--cad-background)] text-[var(--cad-foreground)]">
      <WorkspaceToolbar
        historyAvailability={toolbarHistoryAvailability}
        showBrowserStorageWarning={showBrowserStorageWarning}
        showPartImport={partImportEnabled}
        onNewDocument={handleNewDocument}
        onOpenLocalFile={handleOpenLocalFile}
        onSaveLocalFile={handleSaveLocalFile}
        onImportDocument={handleImportDocument}
        onExportDocument={handleExportDocument}
        onReportBug={handleReportBug}
        onDownloadBugReportState={handleDownloadBugReportState}
      />
      {partImportEnabled ? (
        <input
          ref={partImportInputRef}
          aria-label="Import part file"
          type="file"
          accept={PART_IMPORT_FILE_ACCEPT}
          multiple
          hidden
          onChange={handlePartImportFileChange}
        />
      ) : null}
      <div ref={shellFrameRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 shrink-0 overflow-hidden" style={{ width: leftSidebarWidth }}>
          <FeatureSidebar
            snapshot={snapshot}
            hiddenTargetKeys={visibleHiddenTargetKeys}
            invalidVariableValueMessages={invalidVariableValueMessages}
            objectLabelOverrides={objectLabelOverrides}
            onAddVariable={handleVariableAdd}
            onInspectDiagnostic={handleDiagnosticInspectPlaceholder}
            onObjectDelete={handleDeleteTarget}
            onObjectExport={handleObjectExport}
            onRenameTarget={handleTargetRename}
            onReopenTarget={handleNavigationReopen}
            onSelectTarget={handleShellSelect}
            onToggleTargetVisibility={handleTargetVisibilityToggle}
            onUpdateVariable={handleVariableUpdate}
            visibleSelection={visibleSelection}
          />
          <div
            role="separator"
            aria-label="Resize left sidebar"
            aria-orientation="vertical"
            className="absolute inset-y-0 right-0 z-20 w-3 translate-x-1/2 cursor-col-resize touch-none"
            onPointerDown={handleSidebarResizeStart}
          >
            <div className="mx-auto h-full w-px bg-[var(--cad-border)] transition hover:bg-[var(--cad-accent)]" />
          </div>
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden border-l border-[var(--cad-border)] bg-[var(--workbench-viewport-background)]">
            <ThreeCadViewport
              renderables={viewportRenderables.documentRenderables}
              sketchDisplayRenderables={viewportRenderables.sketchDisplayRenderables}
              sketchAnnotations={sketchAnnotations}
              hoverTarget={visibleHoverTarget}
              onHover={handleViewportHover}
              onSelect={handleViewportSelect}
              onConnectedSketchSelect={handleViewportConnectedSketchSelect}
              onDeselect={handleViewportDeselect}
              onAnnotationEdit={(target) => dispatch({ type: 'sketch.annotationEditRequested', target })}
              onClearHover={handleViewportHoverClear}
              onSketchMove={handleSketchMove}
              onSketchRelease={handleSketchRelease}
              onSketchGeometryDragStart={handleSketchGeometryDragStart}
              onSketchGeometryDragMove={handleSketchGeometryDragMove}
              onSketchGeometryDragEnd={handleSketchGeometryDragEnd}
              onSketchToolPatch={(patch) => dispatch({ type: 'sketch.toolPatched', patch })}
              onLodTierChange={handleViewportLodTierChange}
              selection={visibleSelection}
              sketchToolPresentation={sketchToolPresentation}
              fitViewRequestId={viewportFitRequestId}
            />
            {initialOccRenderPending ? (
              <div
                role="status"
                aria-label="Initial model render pending"
                className="absolute inset-0 z-30 grid place-items-center bg-[var(--workbench-viewport-background)]/85"
              >
                <Loader color="gray" size="lg" />
              </div>
            ) : null}
            <SketchToolPanel
              schema={sketchToolPresentation}
              onPatch={(patch) => dispatch({ type: 'sketch.toolPatched', patch })}
            />
            {restoreMessage ? (
              <WorkbenchNotification
                type="error"
                title="History restore failed"
                message={restoreMessage}
                placement={{
                  kind: 'viewport',
                  right: notificationRightOffset,
                  top: WORKBENCH_STATUS_TOP_PX,
                }}
                action={{
                  label: 'Reset stored history',
                  onClick: () => {
                    modelingService.resetOperationHistory()
                    setRestoreMessage(null)
                  },
                }}
                onDismiss={() => setRestoreMessage(null)}
              />
            ) : null}
            {workbenchStatusNotification ? (
              <WorkbenchNotification
                {...workbenchStatusNotification}
                placement={{
                  kind: 'viewport',
                  right: notificationRightOffset,
                  top: restoreMessage ? WORKBENCH_STATUS_TOP_WITH_RESTORE_PX : WORKBENCH_STATUS_TOP_PX,
                }}
                onDismiss={() => setWorkbenchStatusNotification(null)}
              />
            ) : null}
            {sketchSession?.validationMessage || sketchRegionDiagnosticMessage ? (
              <div
                role="status"
                className="absolute left-4 top-4 z-20 max-w-sm rounded-md border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]"
              >
                {sketchSession?.validationMessage ?? sketchRegionDiagnosticMessage}
              </div>
            ) : null}
            <WorkbenchStateDebugger state={debuggerState} />
            {activeEditSession ? (
              <WorkbenchInspectorOverlay>
                <FeatureInspector
                  featureSnapshot={editableFeatureSnapshot}
                  onPatch={(patch) =>
                    dispatch({ type: 'form.featurePatched', patch })
                  }
                  onCommit={commitFeature}
                  onCancel={cancelFeature}
                />
              </WorkbenchInspectorOverlay>
            ) : null}
            <Modal
              centered
              opened={stepImportFlow.kind !== 'idle'}
              onClose={stepImportFlow.kind === 'preparing' ? () => undefined : handleStepImportCancel}
              title="Import STEP"
              size="lg"
            >
              {stepImportFlow.kind !== 'idle' ? (
                <Stack gap="sm">
                  <Text size="sm" fw={600}>{stepImportFlow.label}</Text>
                  {stepImportFlow.kind === 'preparing' ? (
                    <Group gap="xs">
                      <Loader color="gray" size="sm" />
                      <Text size="sm">Preparing review</Text>
                    </Group>
                  ) : null}
                  {stepImportFlow.kind === 'review' ? (
                    <>
                      <Group gap="xs">
                        <Text size="xs" c="dimmed">{stepImportFlow.review.rootFileName}</Text>
                        <Badge size="xs" variant="outline">{stepImportFlow.files.length} file{stepImportFlow.files.length === 1 ? '' : 's'}</Badge>
                      </Group>
                      {stepImportFlow.review.diagnostics.length > 0 ? (
                        <Stack gap={6}>
                          {stepImportFlow.review.diagnostics.map((diagnostic) => (
                            <Alert
                              key={`${diagnostic.code}-${diagnostic.message}`}
                              color={diagnostic.severity === 'error' ? 'red' : 'yellow'}
                              variant="light"
                              py={6}
                            >
                              <Text size="xs">{diagnostic.message}</Text>
                            </Alert>
                          ))}
                        </Stack>
                      ) : null}
                      <Stack gap={6}>
                        <Checkbox
                          checked={allStepSolidsSelected}
                          indeterminate={someStepSolidsSelected}
                          disabled={stepImportableSolids.length === 0}
                          onChange={(event) => handleStepImportSelectAll(event.currentTarget.checked)}
                          label={`${selectedStepSolidCount}/${stepImportableSolids.length} solids selected`}
                        />
                        <ScrollArea.Autosize mah={260} type="auto">
                          <Stack gap={4}>
                            {stepImportFlow.review.solids.map((solid) => (
                              <Group
                                key={solid.solidKey}
                                justify="space-between"
                                gap="sm"
                                className="rounded border border-[var(--workbench-shell-border)] px-2 py-1"
                              >
                                <Checkbox
                                  checked={selectedStepSolidKeys.has(solid.solidKey)}
                                  disabled={!solid.importable}
                                  onChange={(event) => handleStepImportSolidToggle(solid.solidKey, event.currentTarget.checked)}
                                  label={solid.label}
                                />
                                <Text size="xs" c="dimmed" truncate="end" className="max-w-[220px]">
                                  {solid.sourceFileName}
                                </Text>
                              </Group>
                            ))}
                          </Stack>
                        </ScrollArea.Autosize>
                      </Stack>
                      {selectedStepSolidCount === 0 ? (
                        <Text size="xs" c="red">At least one solid must be selected.</Text>
                      ) : null}
                    </>
                  ) : null}
                  <Group justify="flex-end">
                    <Button variant="subtle" color="gray" onClick={handleStepImportCancel}>
                      Cancel
                    </Button>
                    <Button onClick={handleStepImportAccept} disabled={stepImportFlow.kind !== 'review' || stepImportDisabled}>
                      Import
                    </Button>
                  </Group>
                </Stack>
              ) : null}
            </Modal>
            <Modal
              centered
              opened={meshImportFlow.kind !== 'idle'}
              onClose={handleMeshImportCancel}
              title={(
                <Group gap="xs">
                  <Text span fw={600}>Import Mesh</Text>
                  <Badge size="xs" color="yellow" variant="light">Probably Broken</Badge>
                </Group>
              )}
            >
              {meshImportFlow.kind !== 'idle' ? (
                <Stack gap="sm">
                  <Text size="sm" fw={600}>{meshImportFlow.label}</Text>
                  <Text size="xs" c="dimmed">{meshImportFlow.fileName}</Text>
                  <Stack gap={4}>
                    <Text size="xs">Source: STL or 3MF triangles</Text>
                    <Text size="xs">
                      Result: {formatMeshReconstructionClassification(meshImportFlow.reconstruction.resultClassification)}
                    </Text>
                    <Text size="xs">Source stored: false</Text>
                    <Text size="xs">
                      Settings: {meshImportFlow.reconstruction.settings.qualityPreset};
                      tolerance {meshImportFlow.reconstruction.settings.linearTolerance};
                      mesh body fallback {meshImportFlow.reconstruction.settings.meshBodyFallback}
                    </Text>
                    <Text size="xs">
                      Quality: {meshImportFlow.reconstruction.qualityMetrics.triangleCount} triangles;
                      {` ${meshImportFlow.reconstruction.qualityMetrics.planarRegionCount}`} planar regions;
                      {` ${meshImportFlow.reconstruction.qualityMetrics.cylindricalRegionCount}`} cylindrical regions;
                      confidence {Math.round(meshImportFlow.reconstruction.qualityMetrics.analyticConfidence * 100)}%
                    </Text>
                    <Text size="xs" c="dimmed">
                      Faceted fallback is currently capped at {meshImportFlow.reconstruction.settings.maxFacetedTriangles.toLocaleString()} triangles because persistent mesh bodies are disabled.
                    </Text>
                    {meshImportFlow.reconstruction.resultClassification === 'facetedFallback' ? (
                      <Text size="xs" c="yellow">
                        The saved result will be faceted baked geometry. Re-import the original file to try different reconstruction settings later.
                      </Text>
                    ) : null}
                    {meshImportFlow.reconstruction.resultClassification === 'rejected'
                    || meshImportFlow.reconstruction.resultClassification === 'meshBodyException' ? (
                      <Text size="xs" c="red">
                        {meshImportFlow.reconstruction.rejectionReason ?? 'Mesh reconstruction rejected this source.'}
                      </Text>
                    ) : null}
                  </Stack>
                  <Checkbox
                    checked={meshImportFlow.warningAccepted}
                    onChange={(event) => handleMeshImportWarningAcceptedChange(event.currentTarget.checked)}
                    label={getMeshImportWarningLabel(meshImportFlow.reconstruction)}
                  />
                  <Group justify="flex-end">
                    <Button variant="subtle" color="gray" onClick={handleMeshImportCancel}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleMeshImportAccept}
                      disabled={
                        !meshImportFlow.warningAccepted
                        || !meshImportFlow.assetInput
                        || meshImportFlow.reconstruction.resultClassification === 'rejected'
                        || meshImportFlow.reconstruction.resultClassification === 'meshBodyException'
                      }
                    >
                      Import
                    </Button>
                  </Group>
                </Stack>
              ) : null}
            </Modal>
            {activeImportProgress ? (
              <Paper
                role="status"
                aria-live="polite"
                className="fixed bottom-4 right-4 z-40 w-[min(360px,calc(100vw-32px))] border p-3 text-xs shadow-[var(--cad-panel-shadow)]"
                style={{
                  backgroundColor: 'var(--workbench-notification-surface)',
                  borderColor: 'var(--workbench-shell-border-strong)',
                  color: 'var(--workbench-notification-text)',
                }}
                data-mesh-import-progress={activeImportProgress.kind === 'mesh' ? true : undefined}
                data-step-import-progress={activeImportProgress.kind === 'step' ? true : undefined}
              >
                <Stack gap={8}>
                  <Group justify="space-between" align="flex-start" gap="sm">
                    <Stack gap={2} className="min-w-0">
                      <Text size="xs" fw={600} truncate="end" style={{ color: 'var(--workbench-notification-info-title)' }}>
                        {activeImportProgress.title}
                      </Text>
                      <Text size="xs" truncate="end" style={{ color: 'var(--workbench-notification-text-muted)' }}>
                        {activeImportProgress.fileName}
                      </Text>
                    </Stack>
                    {activeImportProgress.canCancel ? (
                      <Button size="xs" variant="default" onClick={cancelMeshImportPreparation}>
                        Cancel
                      </Button>
                    ) : null}
                  </Group>
                  <Progress
                    value={activeImportProgress.progress}
                    size="sm"
                    color="gray"
                    aria-label={activeImportProgress.kind === 'step' ? 'STEP import progress' : 'Mesh import progress'}
                  />
                  <Text size="xs" style={{ color: 'var(--workbench-notification-text-muted)' }}>
                    {activeImportProgress.message}
                  </Text>
                </Stack>
              </Paper>
            ) : null}
            {activeStepImportMaterializationFeatures.length > 0 ? (
              <Paper
                role="status"
                aria-live="polite"
                className="fixed right-4 z-40 w-[min(400px,calc(100vw-32px))] border p-3 text-xs shadow-[var(--cad-panel-shadow)]"
                style={{
                  bottom: activeImportProgress ? 128 : 16,
                  backgroundColor: 'var(--workbench-notification-surface)',
                  borderColor: 'var(--workbench-shell-border-strong)',
                  color: 'var(--workbench-notification-text)',
                }}
                data-step-import-materialization-status
              >
                <Stack gap={8}>
                  <Group justify="space-between" align="flex-start" gap="sm">
                    <Stack gap={2} className="min-w-0">
                      <Text size="xs" fw={600} style={{ color: 'var(--workbench-notification-info-title)' }}>
                        STEP materialization
                      </Text>
                      <Text size="xs" style={{ color: 'var(--workbench-notification-text-muted)' }}>
                        Persisted faceted presentation is visible while OCC restore continues separately.
                      </Text>
                    </Stack>
                    <Badge
                      size="xs"
                      color={activeStepImportMaterializationFeatures.some((feature) => feature.state === 'failed')
                        ? 'red'
                        : activeStepImportMaterializationFeatures.some((feature) => feature.state === 'degraded')
                          ? 'yellow'
                          : 'blue'}
                      variant="light"
                    >
                      {activeStepImportMaterializationFeatures.some((feature) => feature.state === 'failed')
                        ? 'Failed'
                        : activeStepImportMaterializationFeatures.some((feature) => feature.state === 'degraded')
                          ? 'Degraded'
                          : 'Pending'}
                    </Badge>
                  </Group>
                  {activeStepImportMaterializationFeatures.map((feature) => (
                    <Stack key={feature.featureId} gap={4}>
                      <Group justify="space-between" align="flex-start" gap="sm">
                        <Stack gap={1} className="min-w-0">
                          <Text size="xs" fw={600} truncate="end">
                            {feature.featureLabel}
                          </Text>
                          <Text size="xs" truncate="end" style={{ color: 'var(--workbench-notification-text-muted)' }}>
                            {feature.rootFileName}
                          </Text>
                        </Stack>
                        <Badge
                          size="xs"
                          color={feature.state === 'failed' ? 'red' : feature.state === 'degraded' ? 'yellow' : 'blue'}
                          variant="light"
                        >
                          {feature.state}
                        </Badge>
                      </Group>
                      <Progress
                        value={Math.min((feature.elapsedMs / feature.timeoutMs) * 100, 100)}
                        size="sm"
                        color={feature.state === 'failed' ? 'red' : feature.state === 'degraded' ? 'yellow' : 'blue'}
                        aria-label="STEP materialization background progress"
                      />
                      <Text size="xs" style={{ color: 'var(--workbench-notification-text-muted)' }}>
                        {feature.message}
                      </Text>
                      {formatStepImportStageDurations(feature) ? (
                        <Text size="xs" style={{ color: 'var(--workbench-notification-text-muted)' }}>
                          {formatStepImportStageDurations(feature)}
                        </Text>
                      ) : null}
                    </Stack>
                  ))}
                </Stack>
              </Paper>
            ) : null}
            <DocumentExportModal
              opened={objectExportModal !== null}
              target={objectExportModal}
              exportDocument={(input) => modelingService.exportDocument(input)}
              errorReporter={errorReporter}
              onDownload={downloadDocumentExportResult}
              onClose={() => setObjectExportModal(null)}
            />
          </main>
          <HistoryTimelineShell
            snapshot={snapshot}
            sketchSession={sketchSession}
            visibleSelection={visibleSelection}
            onSelectTarget={handleShellSelect}
            onReopenTarget={handleNavigationReopen}
            onDocumentCursorRequested={handleTimelineCursorRequested}
            documentCursorDisabled={!history.canUndo && !history.canRedo}
            onDocumentHistoryReorder={handleDocumentHistoryReorder}
            documentHistoryReorderDisabled={Boolean(sketchSession) || isDocumentHistoryReorderRunning || isUndoRedoRunning || (!history.canUndo && !history.canRedo)}
            onSketchCursorRequested={(cursor) => dispatch({ type: 'sketch.historyCursorRequested', cursor })}
            onDeleteDocumentItem={handleDocumentHistoryDelete}
            onRenameDocumentItem={handleDocumentHistoryRename}
            onSuppressFeature={handleFeatureSuppressPlaceholder}
          />
        </div>
      </div>
    </div>
    </ShortcutProvider>
  )
}
