import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Loader } from '@mantine/core'
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
  createObjectDeletePlaceholderMessage,
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
  readLocalFileText,
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
  createFallbackBugReportIssueUrl,
  downloadBugReportDebugArtifact,
  type BugReportArtifactStatus,
} from '@/domain/bug-reporting/report'
import { getBuildModeLabel } from '@/components/layout/build-metadata'
import type { OccTessellationTierId } from '@/domain/modeling/occ/tessellation'

type FeatureHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'feature' }>
type SketchHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'sketch' }>
type DocumentVariablePatch = Pick<DocumentVariableRecord, 'name' | 'valueText'>
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
  const notificationRightOffset = getWorkbenchNotificationRightOffsetPx({ reserveViewCube: true })

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

  const applyLoadedSnapshot = (nextSnapshot: DocumentSnapshot) => {
    snapshotRef.current = nextSnapshot
    dispatch({ type: 'document.snapshotLoaded', snapshot: nextSnapshot })
  }

  useEffect(() => installConsoleLoggingSubscribers(actionBus), [actionBus])

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

  const handleObjectDeletePlaceholder = (_target: PrimitiveRef, label: string) => {
    showPlaceholderStatus(createObjectDeletePlaceholderMessage(label))
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

  const handleFeatureDelete = (item: FeatureHistoryItem) => {
    if (!snapshot) {
      return
    }

    void runWorkbenchAction({
      operation: `Delete ${item.label}`,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'featureId', value: item.featureId },
      ],
      action: () => modelingService.deleteFeature({
        baseRevisionId: snapshot.document.revisionId,
        featureId: item.featureId,
      }),
      mapSuccess: (result) => requireAcceptedModelingResult(result, {
        operation: `Delete ${item.label}`,
        fallbackMessage: `Delete ${item.label} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'featureId', value: item.featureId },
        ],
      }),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      showWorkbenchInfo(`Deleted ${item.label}.`)
      dispatch({ type: 'document.refreshRequested' })
    })
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

  const handleSketchRelease = (point: readonly [number, number]) => {
    dispatch({ type: 'sketch.pointerReleased', point })
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

  const handleReportBug = () => {
    try {
      const result = createBugReportPayload({
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

  const refreshAfterDocumentFileAction = (message: string) => {
    setHiddenTargetKeys({})
    setObjectLabelOverrides({})
    setUndoStack([])
    setRedoStack([])
    dispatch({ type: 'document.refreshRequested' })
    showWorkbenchInfo(message)
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

  const handleImportDocument = async (file: File) => {
    let payload: unknown

    try {
      payload = JSON.parse(await file.text()) as unknown
    } catch {
      showWorkbenchError('Import failed. Select a valid cadara JSON document.')
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
      payload = JSON.parse(await readLocalFileText(pickerResult.handle)) as unknown
    } catch (error: unknown) {
      reportDocumentFileActionFailure('workbench.file.openLocal', 'Open local file failed. Select a valid cadara JSON document.', error)
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
      const writeResult = await writeTextToLocalFileHandle(pickerResult.handle, String(result.payload))
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

  return (
    <ShortcutProvider activeScopes={shortcutActiveScopes} commandHandlers={shortcutCommandHandlers}>
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-[var(--cad-background)] text-[var(--cad-foreground)]">
      <WorkspaceToolbar
        historyAvailability={toolbarHistoryAvailability}
        onNewDocument={handleNewDocument}
        onOpenLocalFile={handleOpenLocalFile}
        onSaveLocalFile={handleSaveLocalFile}
        onImportDocument={handleImportDocument}
        onExportDocument={handleExportDocument}
        onReportBug={handleReportBug}
      />
      <div ref={shellFrameRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 shrink-0 overflow-hidden" style={{ width: leftSidebarWidth }}>
          <FeatureSidebar
            snapshot={snapshot}
            hiddenTargetKeys={visibleHiddenTargetKeys}
            invalidVariableValueMessages={invalidVariableValueMessages}
            objectLabelOverrides={objectLabelOverrides}
            onAddVariable={handleVariableAdd}
            onInspectDiagnostic={handleDiagnosticInspectPlaceholder}
            onObjectDelete={handleObjectDeletePlaceholder}
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
            onDeleteFeature={handleFeatureDelete}
            onRenameDocumentItem={handleDocumentHistoryRename}
            onSuppressFeature={handleFeatureSuppressPlaceholder}
          />
        </div>
      </div>
    </div>
    </ShortcutProvider>
  )
}
