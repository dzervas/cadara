import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { SketchConstraintAnnotations } from '@/components/cad/sketch-constraint-annotations'
import { SketchFloatingInput } from '@/components/cad/sketch-floating-input'
import { ThreeCadViewport } from '@/components/cad/three-cad-viewport'
import { SketchToolOverlays } from '@/components/cad/sketch-tool-overlays'
import { SketchToolPanel } from '@/components/cad/sketch-tool-panel'
import { FeatureInspector } from '@/components/layout/feature-inspector'
import { FeatureSidebar } from '@/components/layout/feature-sidebar'
import { HistoryTimelineShell } from '@/components/layout/history-timeline-shell'
import { WorkbenchInspectorOverlay } from '@/components/layout/workbench-inspector-overlay'
import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import { WorkbenchStateDebugger, type WorkbenchStateDebuggerModel } from '@/components/layout/workbench-state-debugger'
import { composeViewportRenderables, isTargetHidden } from '@/app/viewport-renderables'
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  DocumentVariableRecord,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
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
  getEscapeEvent,
  getNavigationReopenRequest,
} from '@/domain/editor/workbench-interactions'
import {
  getFeatureSnapshot,
  getSelectionDetail,
} from '@/domain/modeling/document-snapshot-view'
import { installConsoleLoggingSubscribers } from '@/domain/tools/console-logging'
import { useEditorState } from '@/hooks/use-editor-state'
import { useFeatureEditing } from '@/hooks/use-feature-editing'
import { useModelingService } from '@/hooks/use-modeling-service'
import { useToolActionBus } from '@/hooks/use-tool-actions'
import {
  clampWorkbenchSidebarWidth,
  DEFAULT_LEFT_SIDEBAR_WIDTH,
  getWorkbenchSidebarWidthFromPointer,
} from '@/app/workbench-shell-layout'

type FeatureHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'feature' }>
type SketchHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'sketch' }>

export function CadWorkbench() {
  const actionBus = useToolActionBus()
  const modelingService = useModelingService()
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
    },
    dispatch,
  } = useEditorState()
  const snapshot = machineState.snapshot
  const previewRenderables = machineState.previewRenderables
  const [hiddenTargetKeys, setHiddenTargetKeys] = useState<Record<string, boolean>>({})
  const [objectLabelOverrides, setObjectLabelOverrides] = useState<Record<string, string>>({})
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
  const [workbenchStatusMessage, setWorkbenchStatusMessage] = useState<string | null>(null)
  const [leftSidebarWidth, setLeftSidebarWidth] = useState(DEFAULT_LEFT_SIDEBAR_WIDTH)
  const shellFrameRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => installConsoleLoggingSubscribers(actionBus), [actionBus])

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
    const escapeEvent = getEscapeEvent({
      activeCommand,
      activeReferencePickerFieldId,
      sketchSession,
    })

    if (!escapeEvent) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      dispatch(escapeEvent)
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeCommand, activeReferencePickerFieldId, dispatch, sketchSession])

  useEffect(() => {
    if (!sketchSession) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return
      }

      if (selection[0]?.kind !== 'constraint' && selection[0]?.kind !== 'dimension') {
        return
      }

      event.preventDefault()
      dispatch({ type: 'sketch.annotationDeleteRequested' })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dispatch, selection, sketchSession])

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
  }

  const handleViewportHover = (target: PrimitiveRef) => {
    dispatch({ type: 'viewport.hovered', target })
  }

  const handleViewportSelect = (target: PrimitiveRef) => {
    dispatch({ type: 'viewport.selectionRequested', target })
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

  const handleObjectDeletePlaceholder = (_target: PrimitiveRef, label: string) => {
    showPlaceholderStatus(`Delete for ${label} is not implemented yet.`)
  }

  const handleObjectExportPlaceholder = (_target: PrimitiveRef, label: string) => {
    showPlaceholderStatus(`Export for ${label} is not implemented yet.`)
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

    void modelingService.addDocumentVariable({
      baseRevisionId: snapshot.document.revisionId,
      name: `var${snapshot.document.variables.length + 1}`,
      valueText: '0',
    }).then((result) => {
      if (result.revisionState.kind !== 'accepted') {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? 'Add variable failed.')
        return
      }

      dispatch({ type: 'document.refreshRequested' })
    }).catch((error: unknown) => {
      setWorkbenchStatusMessage(error instanceof Error ? error.message : 'Add variable failed.')
    })
  }

  const handleVariableUpdate = (
    variable: DocumentVariableRecord,
    next: Pick<DocumentVariableRecord, 'name' | 'valueText'>,
  ) => {
    if (!snapshot) {
      return
    }

    void modelingService.updateDocumentVariable({
      baseRevisionId: snapshot.document.revisionId,
      variableId: variable.variableId,
      name: next.name,
      valueText: next.valueText,
    }).then((result) => {
      if (result.revisionState.kind !== 'accepted') {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? `Update ${variable.name || variable.variableId} failed.`)
        return
      }

      dispatch({ type: 'document.refreshRequested' })
    }).catch((error: unknown) => {
      setWorkbenchStatusMessage(error instanceof Error ? error.message : `Update ${variable.name || variable.variableId} failed.`)
    })
  }

  const handleFeatureDelete = (item: FeatureHistoryItem) => {
    if (!snapshot) {
      return
    }

    void modelingService.deleteFeature({
      baseRevisionId: snapshot.document.revisionId,
      featureId: item.featureId,
    }).then((result) => {
      if (result.revisionState.kind !== 'accepted') {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? `Delete ${item.label} failed.`)
        return
      }

      setWorkbenchStatusMessage(`Deleted ${item.label}.`)
      dispatch({ type: 'document.refreshRequested' })
    }).catch((error: unknown) => {
      setWorkbenchStatusMessage(error instanceof Error ? error.message : `Delete ${item.label} failed.`)
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

    void modelingService.commitSketch({
      baseRevisionId: snapshot.document.revisionId,
      solverCorrelation: null,
      sketchId: sketch.sketchId,
      sketchLabel: nextLabel,
      plane: sketch.plane,
      planeTarget: sketch.planeTarget,
      planeKey: sketch.planeKey,
      definition: sketch.sketch.definition,
    }).then((result) => {
      if (result.revisionState.kind !== 'accepted') {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? `Rename ${item.label} failed.`)
        return
      }

      setWorkbenchStatusMessage(`Renamed ${item.label} to ${nextLabel}.`)
      dispatch({ type: 'document.refreshRequested' })
    }).catch((error: unknown) => {
      setWorkbenchStatusMessage(error instanceof Error ? error.message : `Rename ${item.label} failed.`)
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

    void modelingService.updateFeature({
      baseRevisionId: snapshot.document.revisionId,
      featureId: feature.featureId,
      featureLabel: nextLabel,
      definition: feature.definition,
    }).then((result) => {
      if (result.revisionState.kind !== 'accepted') {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? `Rename ${item.label} failed.`)
        return
      }

      setWorkbenchStatusMessage(`Renamed ${item.label} to ${nextLabel}.`)
      dispatch({ type: 'document.refreshRequested' })
    }).catch((error: unknown) => {
      setWorkbenchStatusMessage(error instanceof Error ? error.message : `Rename ${item.label} failed.`)
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

      void modelingService.renameBody({
        baseRevisionId: snapshot.document.revisionId,
        bodyId: target.bodyId,
        bodyLabel: nextLabel,
      }).then((result) => {
        if (result.revisionState.kind !== 'accepted') {
          setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? `Rename ${label} failed.`)
          return
        }

        setObjectLabelOverrides((current) => {
          const next = { ...current }
          delete next[getPrimitiveRefKey(target)]
          return next
        })
        setWorkbenchStatusMessage(`Renamed ${label} to ${nextLabel}.`)
        dispatch({ type: 'document.refreshRequested' })
      }).catch((error: unknown) => {
        setWorkbenchStatusMessage(error instanceof Error ? error.message : `Rename ${label} failed.`)
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
    if (!snapshot) {
      return
    }

    void modelingService.setFeatureCursor({
      baseRevisionId: snapshot.document.revisionId,
      cursor,
    }).then((result) => {
      if (result.revisionState.kind !== 'accepted') {
        setWorkbenchStatusMessage(result.diagnostics[0]?.message ?? 'Feature cursor rollback failed.')
        return
      }

      dispatch({ type: 'document.refreshRequested' })
    }).catch((error: unknown) => {
      setWorkbenchStatusMessage(error instanceof Error ? error.message : 'Feature cursor rollback failed.')
    })
  }

  const handleSketchMove = (point: readonly [number, number]) => {
    dispatch({ type: 'sketch.pointerMoved', point })
  }

  const handleSketchRelease = (point: readonly [number, number]) => {
    dispatch({ type: 'sketch.pointerReleased', point })
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

  return (
    <div className="flex h-screen min-h-screen flex-col overflow-hidden bg-[var(--cad-background)] text-[var(--cad-foreground)]">
      <WorkspaceToolbar />
      <div ref={shellFrameRef} className="flex min-h-0 flex-1 overflow-hidden">
        <div className="relative min-h-0 shrink-0 overflow-hidden" style={{ width: leftSidebarWidth }}>
          <FeatureSidebar
            snapshot={snapshot}
            hiddenTargetKeys={visibleHiddenTargetKeys}
            objectLabelOverrides={objectLabelOverrides}
            onAddVariable={handleVariableAdd}
            onInspectDiagnostic={handleDiagnosticInspectPlaceholder}
            onObjectDelete={handleObjectDeletePlaceholder}
            onObjectExport={handleObjectExportPlaceholder}
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
        <div className="flex min-h-0 flex-1 flex-col">
          <main className="relative min-h-0 flex-1 overflow-hidden border-l border-[var(--cad-border)] bg-[var(--workbench-viewport-background)]">
            <ThreeCadViewport
              renderables={viewportRenderables.documentRenderables}
              sketchDisplayRenderables={viewportRenderables.sketchDisplayRenderables}
              hoverTarget={visibleHoverTarget}
              onHover={handleViewportHover}
              onSelect={handleViewportSelect}
              onClearHover={handleViewportHoverClear}
              onSketchMove={handleSketchMove}
              onSketchRelease={handleSketchRelease}
              selection={visibleSelection}
            />
            <SketchToolPanel
              schema={sketchToolPresentation}
              onPatch={(patch) => dispatch({ type: 'sketch.toolPatched', patch })}
            />
            <SketchFloatingInput
              descriptor={sketchToolPresentation?.floatingInput}
              onPatch={(patch) => dispatch({ type: 'sketch.toolPatched', patch })}
            />
            <SketchToolOverlays schema={sketchToolPresentation} />
            <SketchConstraintAnnotations
              annotations={sketchAnnotations}
              selectedAnnotation={sketchSession?.selectedAnnotation ?? null}
              onSelect={(target) => dispatch({ type: 'viewport.selectionRequested', target })}
            />
            {restoreMessage ? (
              <div className="absolute right-4 top-4 max-w-sm rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-3 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]">
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
                className="absolute right-4 z-20 max-w-sm rounded-lg border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] p-3 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]"
                style={{ top: restoreMessage ? 136 : 16 }}
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
          </main>
          <HistoryTimelineShell
            snapshot={snapshot}
            sketchSession={sketchSession}
            visibleSelection={visibleSelection}
            onSelectTarget={handleShellSelect}
            onReopenTarget={handleNavigationReopen}
            onDocumentCursorRequested={handleTimelineCursorRequested}
            onSketchCursorRequested={(cursor) => dispatch({ type: 'sketch.historyCursorRequested', cursor })}
            onDeleteFeature={handleFeatureDelete}
            onRenameDocumentItem={handleDocumentHistoryRename}
            onSuppressFeature={handleFeatureSuppressPlaceholder}
          />
        </div>
      </div>
    </div>
  )
}
