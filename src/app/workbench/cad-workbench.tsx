import { useEffect, useMemo, useRef, useState } from 'react'
import { Loader } from '@mantine/core'
import { appVersion, gitCommit } from 'virtual:cadara-build-metadata'

import { ThreeCadViewport } from '@/components/cad/three-cad-viewport'
import { SketchSpecialModePanel } from '@/components/cad/sketch-special-mode-panel'
import { SketchToolPanel } from '@/components/cad/sketch-tool-panel'
import { FeatureInspector } from '@/components/layout/feature-inspector'
import { ImportInspector } from '@/components/layout/import-inspector'
import { FeatureSidebar } from '@/components/layout/feature-sidebar'
import { HistoryTimelineShell } from '@/components/layout/history-timeline-shell'
import { MeasurementPanel } from '@/components/layout/measurement-panel'
import { DocumentExportModal } from '@/components/layout/document-export-modal'
import { WorkbenchInspectorOverlay } from '@/components/layout/workbench-inspector-overlay'
import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import { WorkbenchStateDebugger, type WorkbenchStateDebuggerModel } from '@/components/layout/workbench-state-debugger'
import { WorkbenchNotification } from '@/components/layout/workbench-notification'
import { isInitialOccRenderPending } from '@/app/workbench/initial-occ-render-state'
import { composeViewportRenderables, isTargetHidden } from '@/app/workbench/shell/viewport-renderables'
import {
  createObjectExportModalState,
  type ObjectExportModalState,
} from '@/domain/export/object-export-state'
import {
  dispatchCadTestSelection,
  syncCadTestState,
} from '@/app/workbench/cad-test-bridge'
import {
  createNewWorkbenchDocument,
  exportWorkbenchDocument,
  importWorkbenchDocumentFile,
  openWorkbenchLocalFile,
  saveWorkbenchLocalFile,
} from '@/app/workbench/document/workbench-document-actions'
import { useWorkbenchHistory } from '@/app/workbench/controllers/use-workbench-history'
import { useWorkbenchLocalFileSync } from '@/app/workbench/controllers/use-workbench-local-file-sync'
import { useWorkbenchNotifications } from '@/app/workbench/controllers/use-workbench-notifications'
import { useWorkbenchPartImport } from '@/app/workbench/controllers/use-workbench-part-import'
import { useWorkbenchSidebarResize } from '@/app/workbench/controllers/use-workbench-sidebar-resize'
import { useWorkbenchViewportEvents } from '@/app/workbench/controllers/use-workbench-viewport-events'
import {
  runWorkbenchAction,
} from '@/app/workbench/shared/workbench-action'
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import { createAppError, errorContext, ok } from '@/contracts/errors'
import {
  getSketchAnnotationDescriptors,
  getSketchToolPresentation,
  getSketchSessionRegionDiagnostics,
} from '@/domain/editor/sketch-session'
import {
  getSketchSpecialModePanel,
  getSketchSpecialModeViewportPresentation,
} from '@/domain/sketch-special-modes/presentation'
import {
  getPrimitiveRefLabel,
  getPrimitiveRefKey,
  isDurablePrimitiveRef,
  primitiveRefEquals,
  type PrimitiveRef,
} from '@/domain/editor/schema'
import {
  getAutoHiddenSketchTargetKeys,
  getWorkbenchVisibilityState,
  reconcileVisibilityIntentKeys,
  toggleWorkbenchTargetVisibility,
} from '@/domain/editor/visibility'
import {
  getFeatureSnapshot,
  getSelectionDetail,
  getTargetContributingFeatureIds,
} from '@/domain/modeling/document-snapshot-view'
import { deriveMeasurementViewModel } from '@/domain/measure/measurement'
import { createTopologyDebugSummary } from '@/domain/modeling/topology-debug'
import { installConsoleLoggingSubscribers } from '@/domain/tools/console-logging'
import { useEditorState } from '@/hooks/use-editor-state'
import { useErrorReporter } from '@/hooks/use-error-reporter'
import { useFeatureEditing } from '@/hooks/use-feature-editing'
import { useWorkbenchDocumentOwner } from '@/hooks/use-workbench-document-owner'
import { useModelingService } from '@/hooks/use-modeling-service'
import { useRuntimeExtensionRegistry } from '@/hooks/use-runtime-extension-registry'
import { WorkbenchCommandProvider } from '@/hooks/workbench-command-provider'
import { ShortcutProvider } from '@/hooks/shortcut-provider'
import { useToolActionBus, useToolActions } from '@/hooks/use-tool-actions'
import { downloadDocumentExportResult } from '@/lib/download-export'
import {
  createWorkbenchShortcutCommandHandlers,
  getWorkbenchShortcutActiveScopes,
} from '@/app/workbench/commands/workbench-shortcuts'
import {
  WORKBENCH_STATUS_TOP_PX,
  WORKBENCH_STATUS_TOP_WITH_RESTORE_PX,
  getWorkbenchNotificationRightOffsetPx,
} from '@/components/cad/viewport-overlay-layout'
import {
  DEFAULT_LEFT_SIDEBAR_WIDTH,
} from '@/app/workbench/shell/workbench-shell-layout'
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

type FeatureHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'feature' }>
type SketchHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'sketch' }>

export function CadWorkbench() {
  const actionBus = useToolActionBus()
  const { triggerTool } = useToolActions()
  const modelingService = useModelingService()
  const { sketchSpecialModes } = useRuntimeExtensionRegistry()
  const documentOwner = useWorkbenchDocumentOwner()
  const errorReporter = useErrorReporter()
  const {
    machineState,
    state: {
      activeCommand,
      activeSectionView,
      selection,
      hoverTarget,
      sketchSession,
      activeEditSession,
      activeImportSession,
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
  const [rawExplicitHiddenTargetKeys, setRawExplicitHiddenTargetKeys] = useState<Record<string, boolean>>({})
  const [rawExplicitlyShownAutoHiddenTargetKeys, setRawExplicitlyShownAutoHiddenTargetKeys] = useState<Record<string, boolean>>({})
  const [objectLabelOverrides, setObjectLabelOverrides] = useState<Record<string, string>>({})
  const [invalidVariableValueMessages, setInvalidVariableValueMessages] = useState<Record<string, string>>({})
  const [objectExportModal, setObjectExportModal] = useState<ObjectExportModalState | null>(null)
  const [viewportFitRequestId, setViewportFitRequestId] = useState(0)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
  const shellFrameRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef(snapshot)
  const notificationRightOffset = getWorkbenchNotificationRightOffsetPx({ reserveViewCube: true })
  // TODO: Replace with the cloud-save capability flag when cloud persistence is implemented.
  const cloudSaveEnabled = false
  const {
    reportDocumentFileActionFailure,
    restoreMessage,
    setRestoreMessage,
    setWorkbenchStatusNotification,
    showWorkbenchError,
    showWorkbenchInfo,
    workbenchStatusNotification,
  } = useWorkbenchNotifications({
    errorReporter,
    modelingService,
  })

  useEffect(() => installConsoleLoggingSubscribers(actionBus), [actionBus])

  useEffect(() => {
    snapshotRef.current = snapshot
  }, [snapshot])

  useEffect(() => {
    if (typeof window === 'undefined' || !snapshot) {
      return
    }

    window.__cadOccPerf = {
      warmupStatus: 'idle',
      ...window.__cadOccPerf,
      firstSnapshotReadyAt: window.__cadOccPerf?.firstSnapshotReadyAt ?? performance.now(),
    }
  }, [snapshot])

  useEffect(() => {
    if (typeof window === 'undefined' || !shouldEnableOccPerfBridge()) {
      return
    }

    window.__cadMeasureOccMutation = async () => {
      const currentSnapshot = snapshotRef.current
      if (!currentSnapshot) {
        return null
      }

      const startedAt = performance.now()
      const result = await modelingService.addDocumentVariable({
        baseRevisionId: currentSnapshot.document.revisionId,
        name: `__cad_occ_perf_${Date.now()}`,
        valueText: '1',
      })
      const elapsedMs = performance.now() - startedAt

      window.__cadOccPerf = {
        warmupStatus: 'idle',
        ...window.__cadOccPerf,
        lastMutationLatencyMs: elapsedMs,
      }

      return result.match(
        (value) => ({
          elapsedMs,
          revisionId: value.revisionId,
          accepted: value.revisionState.kind === 'accepted',
        }),
        () => ({
          elapsedMs,
          revisionId: currentSnapshot.document.revisionId,
          accepted: false,
        }),
      )
    }

    return () => {
      delete window.__cadMeasureOccMutation
    }
  }, [modelingService])
  const {
    localFileSyncEnabled,
  } = useWorkbenchLocalFileSync({
    modelingService,
    reportDocumentFileActionFailure,
    showWorkbenchError,
    showWorkbenchInfo,
  })
  const showBrowserStorageWarning = !localFileSyncEnabled && !cloudSaveEnabled


  const visibleObjectTargetKeys = useMemo(
    () => new Set((snapshot?.presentation.objects ?? []).map((item) => getPrimitiveRefKey(item.target))),
    [snapshot],
  )
  const explicitHiddenTargetKeys = useMemo(
    () => reconcileVisibilityIntentKeys(rawExplicitHiddenTargetKeys, visibleObjectTargetKeys),
    [rawExplicitHiddenTargetKeys, visibleObjectTargetKeys],
  )
  const autoHiddenSketchTargetKeys = useMemo(() => getAutoHiddenSketchTargetKeys(snapshot), [snapshot])
  const allowedAutoHiddenTargetKeys = useMemo(
    () => new Set(Object.keys(autoHiddenSketchTargetKeys)),
    [autoHiddenSketchTargetKeys],
  )
  const explicitlyShownAutoHiddenTargetKeys = useMemo(
    () => reconcileVisibilityIntentKeys(rawExplicitlyShownAutoHiddenTargetKeys, allowedAutoHiddenTargetKeys),
    [allowedAutoHiddenTargetKeys, rawExplicitlyShownAutoHiddenTargetKeys],
  )

  const effectiveHiddenTargetKeys = useMemo(
    () => getWorkbenchVisibilityState({
      snapshot,
      explicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys,
    }).effectiveHiddenTargetKeys,
    [explicitHiddenTargetKeys, explicitlyShownAutoHiddenTargetKeys, snapshot],
  )

  const visibleSelection = useMemo(
    () => selection.filter((target) => !isTargetHidden(target, effectiveHiddenTargetKeys)),
    [effectiveHiddenTargetKeys, selection],
  )
  const historyHighlightFeatureIds = useMemo(
    () => snapshot ? getTargetContributingFeatureIds(snapshot, visibleSelection[0] ?? null) : [],
    [snapshot, visibleSelection],
  )
  const visibleHoverTarget =
    hoverTarget && !isTargetHidden(hoverTarget, effectiveHiddenTargetKeys) ? hoverTarget : null

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
  const {
    commitImportSession,
    requestPartImport,
  } = useWorkbenchPartImport({
    activeEditSession,
    activeImportSession,
    dispatch,
    modelingService,
    showWorkbenchError,
    showWorkbenchInfo,
    snapshot,
  })
  const {
    handleDocumentHistoryReorder,
    handleVariableUpdate,
    isDocumentHistoryReorderRunning,
    isUndoRedoRunning,
    requestRedo,
    requestUndo,
    resetHistoryState,
    toolbarHistoryAvailability,
  } = useWorkbenchHistory({
    dispatch,
    errorReporter,
    history,
    setInvalidVariableValueMessages,
    showWorkbenchError,
    sketchSession,
    snapshot,
  })
  const {
    handleNavigationReopen,
    handleSectionClear,
    handleSectionFlip,
    handleSectionOffsetChange,
    handleShellSelect,
    handleSketchGeometryDragEnd,
    handleSketchGeometryDragMove,
    handleSketchGeometryDragStart,
    handleSketchMove,
    handleSketchRelease,
    handleSketchSpecialModeClick,
    handleSketchSpecialModeDoubleClick,
    handleSketchSpecialModeDragEnd,
    handleSketchSpecialModeDragMove,
    handleSketchSpecialModeDragStart,
    handleViewportConnectedSketchSelect,
    handleViewportDeselect,
    handleViewportHover,
    handleViewportHoverClear,
    handleViewportLodTierChange,
    handleViewportSelect,
  } = useWorkbenchViewportEvents({
    activeCommand,
    dispatch,
    modelingService,
    snapshot,
  })
  const { handleSidebarResizeStart } = useWorkbenchSidebarResize({
    setLeftSidebarWidth,
    shellFrameRef,
  })

  const viewportRenderables = useMemo(
    () => {
      return composeViewportRenderables({
        snapshotRenderables: snapshot?.document.render.records ?? [],
        snapshotSketches: snapshot?.document.sketches ?? [],
        previewRenderables,
        sketchSession,
        hiddenTargetKeys: effectiveHiddenTargetKeys,
      })
    },
    [effectiveHiddenTargetKeys, previewRenderables, sketchSession, snapshot],
  )
  const sketchToolPresentation = sketchSession ? getSketchToolPresentation(sketchSession) : null
  const sketchSpecialModePanel = sketchSession ? getSketchSpecialModePanel(sketchSession, sketchSpecialModes) : null
  const sketchSpecialModeViewportPresentation =
    sketchSession ? getSketchSpecialModeViewportPresentation(sketchSession, sketchSpecialModes) : null
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
    sectionOffset: activeSectionView?.offset ?? null,
    sectionRetainedSide: activeSectionView?.retainedSide ?? null,
  }
  const measurementViewModel = useMemo(
    () => deriveMeasurementViewModel({
      activeToolId: activeCommand?.toolId ?? null,
      selection: visibleSelection,
      snapshot,
    }),
    [activeCommand?.toolId, snapshot, visibleSelection],
  )

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

  const handleTargetVisibilityToggle = (target: PrimitiveRef) => {
    const nextVisibility = toggleWorkbenchTargetVisibility({
      target,
      explicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys,
      effectiveHiddenTargetKeys,
      autoHiddenSketchTargetKeys,
    })
    const nextEffectiveHiddenTargetKeys = getWorkbenchVisibilityState({
      snapshot,
      explicitHiddenTargetKeys: nextVisibility.explicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys: nextVisibility.explicitlyShownAutoHiddenTargetKeys,
    }).effectiveHiddenTargetKeys

    setRawExplicitHiddenTargetKeys(nextVisibility.explicitHiddenTargetKeys)
    setRawExplicitlyShownAutoHiddenTargetKeys(nextVisibility.explicitlyShownAutoHiddenTargetKeys)

    if (
      nextEffectiveHiddenTargetKeys[getPrimitiveRefKey(target)] === true
      && hoverTarget
      && (
        primitiveRefEquals(hoverTarget, target)
        || isTargetHidden(hoverTarget, nextEffectiveHiddenTargetKeys)
      )
    ) {
      dispatch({ type: 'viewport.hoverCleared' })
    }
  }

  const showPlaceholderStatus = (message: string) => {
    showWorkbenchInfo(message)
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
      action: () => documentOwner.deleteTarget(target, {
        operation: `Delete ${label}`,
        fallbackMessage: `Delete ${label} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'target', value: getPrimitiveRefKey(target) },
        ],
      }),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      showWorkbenchInfo(`Deleted ${label}.`)
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
      action: () => documentOwner.addDocumentVariable({
        operation: 'Add variable',
        fallbackMessage: 'Add variable failed.',
        context: [{ key: 'baseRevisionId', value: snapshot.document.revisionId }],
      }),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
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

    void runWorkbenchAction({
      operation: `Rename ${item.label}`,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'sketchId', value: item.sketchId },
      ],
      action: () => documentOwner.renameTarget({ kind: 'sketch', sketchId: item.sketchId }, nextLabel, {
        operation: `Rename ${item.label}`,
        fallbackMessage: `Rename ${item.label} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'sketchId', value: item.sketchId },
        ],
      }),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      showWorkbenchInfo(`Renamed ${item.label} to ${nextLabel}.`)
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

    void runWorkbenchAction({
      operation: `Rename ${item.label}`,
      reporter: errorReporter,
      context: [
        { key: 'baseRevisionId', value: snapshot.document.revisionId },
        { key: 'featureId', value: item.featureId },
      ],
      action: () => documentOwner.renameTarget({ kind: 'feature', featureId: item.featureId }, nextLabel, {
        operation: `Rename ${item.label}`,
        fallbackMessage: `Rename ${item.label} failed.`,
        context: [
          { key: 'baseRevisionId', value: snapshot.document.revisionId },
          { key: 'featureId', value: item.featureId },
        ],
      }),
      mapSuccess: (result) => ok(result),
      onError: (error) => showWorkbenchError(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      showWorkbenchInfo(`Renamed ${item.label} to ${nextLabel}.`)
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
        action: () => documentOwner.renameTarget(target, nextLabel, {
          operation: `Rename ${label}`,
          fallbackMessage: `Rename ${label} failed.`,
          context: [
            { key: 'baseRevisionId', value: snapshot.document.revisionId },
            { key: 'bodyId', value: target.bodyId },
          ],
        }),
        mapSuccess: (result) => ok(result),
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

  const shortcutActiveScopes = useMemo(
    () => getWorkbenchShortcutActiveScopes(mode),
    [mode],
  )
  const shortcutCommandHandlers = createWorkbenchShortcutCommandHandlers({
    activeCommand,
    activeReferencePickerFieldId,
    activateTool: triggerTool,
    canRedo: toolbarHistoryAvailability.canRedo,
    canUndo: toolbarHistoryAvailability.canUndo,
    dispatch,
    mode,
    requestRedo,
    requestUndo,
    selection,
    sketchSession,
  })

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

  const replaceAfterDocumentFileAction = async (
    message: string,
    options: { fitView?: boolean } = {},
  ): Promise<void> => {
    setRawExplicitHiddenTargetKeys({})
    setRawExplicitlyShownAutoHiddenTargetKeys({})
    setObjectLabelOverrides({})
    resetHistoryState()
    try {
      await documentOwner.replaceActiveDocumentBasis()
      if (options.fitView) {
        setViewportFitRequestId((current) => current + 1)
      }
      showWorkbenchInfo(message)
    } catch (error: unknown) {
      reportDocumentFileActionFailure('workbench.file.replace', 'Document replacement failed.', error)
    }
  }

  const handleNewDocument = async () => {
    await createNewWorkbenchDocument({
      modelingService,
      replaceAfterDocumentFileAction,
      showWorkbenchError,
      reportDocumentFileActionFailure,
    })
  }

  const handleImportDocument = async (file: File) => {
    await importWorkbenchDocumentFile({
      file,
      modelingService,
      replaceAfterDocumentFileAction,
      showWorkbenchError,
      reportDocumentFileActionFailure,
    })
  }

  const handleOpenLocalFile = async () => {
    await openWorkbenchLocalFile({
      modelingService,
      replaceAfterDocumentFileAction,
      reportDocumentFileActionFailure,
      showWorkbenchError,
    })
  }

  const handleSaveLocalFile = async () => {
    await saveWorkbenchLocalFile({
      modelingService,
      reportDocumentFileActionFailure,
      showWorkbenchError,
      showWorkbenchInfo,
    })
  }

  const handleExportDocument = async () => {
    await exportWorkbenchDocument({
      modelingService,
      reportDocumentFileActionFailure,
      showWorkbenchInfo,
    })
  }

  return (
    <WorkbenchCommandProvider
      handlers={{
        activateTool: triggerTool,
        requestUndo,
        requestRedo,
        requestPartImport,
      }}
    >
      <ShortcutProvider activeScopes={shortcutActiveScopes} commandHandlers={shortcutCommandHandlers}>
      <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-[var(--cad-background)] text-[var(--cad-foreground)]">
      <WorkspaceToolbar
        historyAvailability={toolbarHistoryAvailability}
        showBrowserStorageWarning={showBrowserStorageWarning}
        onNewDocument={handleNewDocument}
        onOpenLocalFile={handleOpenLocalFile}
        onSaveLocalFile={handleSaveLocalFile}
        onImportDocument={handleImportDocument}
        onExportDocument={handleExportDocument}
        onReportBug={handleReportBug}
        onDownloadBugReportState={handleDownloadBugReportState}
      />
      <div ref={shellFrameRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 shrink-0 overflow-hidden" style={{ width: leftSidebarWidth }}>
          <FeatureSidebar
            snapshot={snapshot}
            hiddenTargetKeys={effectiveHiddenTargetKeys}
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
              activeSectionView={activeSectionView ?? null}
              hoverTarget={visibleHoverTarget}
              measurementWitnesses={measurementViewModel?.witnesses ?? []}
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
              onSpecialModeClick={handleSketchSpecialModeClick}
              onSpecialModeDoubleClick={handleSketchSpecialModeDoubleClick}
              onSpecialModeDragStart={handleSketchSpecialModeDragStart}
              onSpecialModeDragMove={handleSketchSpecialModeDragMove}
              onSpecialModeDragEnd={handleSketchSpecialModeDragEnd}
              onSectionOffsetChange={handleSectionOffsetChange}
              onSectionFlip={handleSectionFlip}
              onSectionClear={handleSectionClear}
              onSketchToolPatch={(patch) => dispatch({ type: 'sketch.toolPatched', patch })}
              onLodTierChange={handleViewportLodTierChange}
              selection={visibleSelection}
              sketchToolPresentation={sketchToolPresentation}
              specialModePresentation={sketchSpecialModeViewportPresentation}
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
            <SketchSpecialModePanel
              schema={sketchSpecialModePanel}
              onAction={(action) => dispatch({ type: 'sketch.specialModePanelActionInvoked', action })}
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
            {activeImportSession ? (
              <WorkbenchInspectorOverlay>
                <ImportInspector onCommit={() => void commitImportSession()} />
              </WorkbenchInspectorOverlay>
            ) : activeEditSession ? (
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
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-3">
              <div className="flex items-end gap-3 px-4">
                <WorkbenchStateDebugger state={debuggerState} />
                <MeasurementPanel measurement={measurementViewModel} />
              </div>
              <HistoryTimelineShell
                snapshot={snapshot}
                sketchSession={sketchSession}
                historyHighlightFeatureIds={historyHighlightFeatureIds}
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
          </main>
        </div>
      </div>
      </div>
      </ShortcutProvider>
    </WorkbenchCommandProvider>
  )
}

function shouldEnableOccPerfBridge() {
  if (typeof window === 'undefined') {
    return false
  }

  return import.meta.env.DEV || new URLSearchParams(window.location.search).has('cadPerfMode')
}
