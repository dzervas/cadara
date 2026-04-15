import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { SketchConstraintAnnotations } from '@/components/cad/sketch-constraint-annotations'
import { SketchFloatingInput } from '@/components/cad/sketch-floating-input'
import { ThreeCadViewport } from '@/components/cad/three-cad-viewport'
import { SketchToolOverlays } from '@/components/cad/sketch-tool-overlays'
import { SketchToolPanel } from '@/components/cad/sketch-tool-panel'
import { FeatureInspector } from '@/components/layout/feature-inspector'
import { FeatureSidebar } from '@/components/layout/feature-sidebar'
import { FeatureTimelineBar } from '@/components/layout/feature-timeline-bar'
import { WorkbenchInspectorOverlay } from '@/components/layout/workbench-inspector-overlay'
import { WorkspaceToolbar } from '@/components/layout/workspace-toolbar'
import { WorkbenchStateDebugger, type WorkbenchStateDebuggerModel } from '@/components/layout/workbench-state-debugger'
import { composeViewportRenderables } from '@/app/viewport-renderables'
import type { DocumentFeatureCursor } from '@/contracts/modeling/schema'
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
  const [restoreMessage, setRestoreMessage] = useState<string | null>(null)
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
    () => selection.filter((target) => !visibleHiddenTargetKeys[getPrimitiveRefKey(target)]),
    [selection, visibleHiddenTargetKeys],
  )
  const visibleHoverTarget =
    hoverTarget && !visibleHiddenTargetKeys[getPrimitiveRefKey(hoverTarget)] ? hoverTarget : null

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

    if (nextHidden && hoverTarget && primitiveRefEquals(hoverTarget, target)) {
      dispatch({ type: 'viewport.hoverCleared' })
    }
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
        setRestoreMessage(result.diagnostics[0]?.message ?? 'Feature cursor rollback failed.')
        return
      }

      dispatch({ type: 'document.refreshRequested' })
    }).catch((error: unknown) => {
      setRestoreMessage(error instanceof Error ? error.message : 'Feature cursor rollback failed.')
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
    <div className="flex h-screen min-h-screen flex-col bg-[var(--cad-background)] text-[var(--cad-foreground)]">
      <WorkspaceToolbar />
      <div ref={shellFrameRef} className="flex min-h-0 flex-1">
        <div className="relative min-h-0 shrink-0" style={{ width: leftSidebarWidth }}>
          <FeatureSidebar
            snapshot={snapshot}
            hiddenTargetKeys={visibleHiddenTargetKeys}
            onSelectTarget={handleViewportSelect}
            onToggleTargetVisibility={handleTargetVisibilityToggle}
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
          <main className="relative min-h-0 flex-1 overflow-hidden border-l border-[var(--cad-border)] bg-[radial-gradient(circle_at_top,_rgba(79,104,140,0.12),_transparent_36%),linear-gradient(180deg,_rgba(14,18,24,0.96),_rgba(8,11,16,1))]">
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
              <div className="absolute right-4 top-4 max-w-sm rounded-lg border border-[var(--cad-border-strong)] bg-[rgba(8,12,17,0.95)] p-3 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]">
                <div className="font-medium">History restore failed</div>
                <div className="mt-1 text-[var(--cad-muted-foreground)]">{restoreMessage}</div>
                <button
                  className="mt-3 rounded-md border border-[var(--cad-border-strong)] px-2 py-1 text-[var(--cad-foreground)]"
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
          <FeatureTimelineBar
            snapshot={snapshot}
            visibleSelection={visibleSelection}
            onSelectTarget={handleViewportSelect}
            onReopenTarget={handleNavigationReopen}
            onCursorRequested={handleTimelineCursorRequested}
          />
        </div>
      </div>
    </div>
  )
}
