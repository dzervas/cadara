import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
import { composeViewportRenderables, isTargetHidden } from '@/app/viewport-renderables'
import {
  createObjectDeletePlaceholderMessage,
  createObjectExportModalState,
  type ObjectExportModalState,
} from '@/app/object-export-state'
import {
  requireAcceptedModelingResult,
  runWorkbenchAction,
} from '@/app/workbench-action'
import { getWorkbenchHistoryAvailability } from '@/app/workbench-history'
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  DocumentVariableRecord,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import { createAppError, errorContext, type AppError } from '@/contracts/errors'
import type { EditorHistoryAvailability } from '@/contracts/editor/state-machine'
import {
  getSketchAnnotationDescriptors,
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
      activeReferencePickerFieldId,
      history,
    },
    dispatch,
  } = useEditorState()
  const snapshot = machineState.snapshot
  const previewRenderables = machineState.previewRenderables
  const [hiddenTargetKeys, setHiddenTargetKeys] = useState<Record<string, boolean>>({})
  const [objectLabelOverrides, setObjectLabelOverrides] = useState<Record<string, string>>({})
  const [invalidVariableValueMessages, setInvalidVariableValueMessages] = useState<Record<string, string>>({})
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [workbenchStatusMessage, setWorkbenchStatusMessage] = useState<string | null>(null)
  const [objectExportModal, setObjectExportModal] = useState<ObjectExportModalState | null>(null)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
  const [undoStack, setUndoStack] = useState<WorkbenchUndoEntry[]>([])
  const [redoStack, setRedoStack] = useState<WorkbenchUndoEntry[]>([])
  const [isUndoRedoRunning, setIsUndoRedoRunning] = useState(false)
  const shellFrameRef = useRef<HTMLDivElement | null>(null)
  const snapshotRef = useRef(snapshot)
  const undoStackRef = useRef(undoStack)
  const redoStackRef = useRef(redoStack)
  const sketchSessionRef = useRef(sketchSession)
  const notificationRightOffset = getWorkbenchNotificationRightOffsetPx({ reserveViewCube: true })

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
    setWorkbenchStatusMessage(message)
  }

  const setVariableFailure = (
    variableId: DocumentVariableRecord['variableId'],
    error: AppError,
  ) => {
    setInvalidVariableValueMessages((current) => ({
      ...current,
      [variableId]: error.message,
    }))
    setWorkbenchStatusMessage(error.message)
  }

  const handleObjectDeletePlaceholder = (_target: PrimitiveRef, label: string) => {
    showPlaceholderStatus(createObjectDeletePlaceholderMessage(label))
  }

  const handleObjectExport = (target: PrimitiveRef, label: string) => {
    const nextModalState = createObjectExportModalState(snapshot, target, label)
    if (!nextModalState) {
      return
    }

    setWorkbenchStatusMessage(null)
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
      onError: (error) => setWorkbenchStatusMessage(error.message),
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

  const applyUndoEntry = (entry: WorkbenchUndoEntry, direction: 'undo' | 'redo') => {
    switch (entry.kind) {
      case 'updateVariable':
        return applyVariablePatch(
          entry.variableId,
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
      onError: (error) => setWorkbenchStatusMessage(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      setWorkbenchStatusMessage(`Deleted ${item.label}.`)
      dispatch({ type: 'document.refreshRequested' })
    })
  }

  const requestRenameLabel = (currentLabel: string) => {
    const nextLabel = window.prompt('Rename', currentLabel)?.trim()

    if (nextLabel === undefined) {
      return null
    }

    if (!nextLabel) {
      setWorkbenchStatusMessage('Name cannot be empty.')
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
      setWorkbenchStatusMessage(`Could not find ${item.label}.`)
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
      onError: (error) => setWorkbenchStatusMessage(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      setWorkbenchStatusMessage(`Renamed ${item.label} to ${nextLabel}.`)
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
      setWorkbenchStatusMessage(`Could not find ${item.label}.`)
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
      onError: (error) => setWorkbenchStatusMessage(error.message),
    }).then((result) => {
      if (result.isErr()) {
        return
      }

      setWorkbenchStatusMessage(`Renamed ${item.label} to ${nextLabel}.`)
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
        onError: (error) => setWorkbenchStatusMessage(error.message),
      }).then((result) => {
        if (result.isErr()) {
          return
        }

        setObjectLabelOverrides((current) => {
          const next = { ...current }
          delete next[getPrimitiveRefKey(target)]
          return next
        })
        setWorkbenchStatusMessage(`Renamed ${label} to ${nextLabel}.`)
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
    setWorkbenchStatusMessage(`Renamed ${label} to ${nextLabel}.`)
  }

  const handleTimelineCursorRequested = (cursor: DocumentFeatureCursor) => {
    dispatch({ type: 'document.historyCursorRequested', cursor })
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
        setWorkbenchStatusMessage('GitHub bug report could not be opened. Check popup blocking for this site.')
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
        setWorkbenchStatusMessage('GitHub bug report could not be opened. Check popup blocking for this site.')
      }
    }
  }

  const refreshAfterDocumentFileAction = (message: string) => {
    setHiddenTargetKeys({})
    setObjectLabelOverrides({})
    setUndoStack([])
    setRedoStack([])
    dispatch({ type: 'document.refreshRequested' })
    setWorkbenchStatusMessage(message)
  }

  const reportDocumentFileActionFailure = (source: string, message: string, error: unknown) => {
    setWorkbenchStatusMessage(message)
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
  }

  const handleNewDocument = async () => {
    try {
      const result = await modelingService.createNewDocument()
      if (!result.ok) {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? 'New document could not be created.')
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
      setWorkbenchStatusMessage('Import failed. Select a valid cadara JSON document.')
      return
    }

    try {
      const result = await modelingService.importDocument({ document: payload })
      if (!result.ok) {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? 'Import failed.')
        return
      }

      refreshAfterDocumentFileAction(`Imported ${file.name}.`)
    } catch (error) {
      reportDocumentFileActionFailure('workbench.file.import', 'Import failed.', error)
    }
  }

  const handleExportDocument = async () => {
    try {
      const result = await modelingService.exportCurrentDocument()
      downloadDocumentExportResult(result)
      setWorkbenchStatusMessage(`Exported ${result.filename}.`)
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
              selection={visibleSelection}
              sketchToolPresentation={sketchToolPresentation}
            />
            <SketchToolPanel
              schema={sketchToolPresentation}
              onPatch={(patch) => dispatch({ type: 'sketch.toolPatched', patch })}
            />
            {restoreMessage ? (
              <div
                className="absolute top-4 z-30 max-w-sm rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-3 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]"
                style={{ right: notificationRightOffset }}
              >
                <div className="font-medium">History restore failed</div>
                <div className="mt-1 text-[var(--cad-muted-foreground)]">{restoreMessage}</div>
                <button
                  className="mt-3 rounded-md border border-[var(--cad-border-strong)] bg-[var(--cad-surface)] px-2 py-1 text-[var(--cad-foreground)]"
                  type="button"
                  onClick={() => {
                    modelingService.resetOperationHistory()
                    setRestoreMessage(null)
                  }}
                >
                  Reset stored history
                </button>
              </div>
            ) : null}
            {workbenchStatusMessage ? (
              <div
                role="status"
                className="absolute z-30 max-w-sm rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-3 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]"
                style={{
                  right: notificationRightOffset,
                  top: restoreMessage ? WORKBENCH_STATUS_TOP_WITH_RESTORE_PX : WORKBENCH_STATUS_TOP_PX,
                }}
              >
                <div className="font-medium">Workbench action</div>
                <div className="mt-1 text-[var(--cad-muted-foreground)]">{workbenchStatusMessage}</div>
                <button
                  className="mt-3 rounded-md border border-[var(--cad-border-strong)] bg-[var(--cad-surface)] px-2 py-1 text-[var(--cad-foreground)]"
                  type="button"
                  onClick={() => setWorkbenchStatusMessage(null)}
                >
                  Dismiss
                </button>
              </div>
            ) : null}
            {sketchSession?.validationMessage ? (
              <div
                role="status"
                className="absolute left-4 top-4 z-20 max-w-sm rounded-md border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]"
              >
                {sketchSession.validationMessage}
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
