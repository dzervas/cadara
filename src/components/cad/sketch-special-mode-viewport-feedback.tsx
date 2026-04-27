import type { PointerEvent as ReactPointerEvent } from 'react'

import {
  getSketchSpecialModeOverlayProjectionId,
  getSketchSpecialModeOverlayTone,
  getSketchSpecialModeSegmentProjectionId,
  type SketchSpecialModeFeedbackProjection,
} from '@/components/cad/sketch-special-mode-feedback-model'
import type {
  SketchSpecialModeHandleRef,
  SketchSpecialModeViewportPresentation,
} from '@/domain/sketch-special-modes/schema'

interface SketchSpecialModeViewportFeedbackProps {
  presentation: SketchSpecialModeViewportPresentation | null
  projections: readonly SketchSpecialModeFeedbackProjection[]
  onHandleDragStart?: (handle: SketchSpecialModeHandleRef, clientX: number, clientY: number) => void
  onHandleDragMove?: (handle: SketchSpecialModeHandleRef, clientX: number, clientY: number) => void
  onHandleDragEnd?: (handle: SketchSpecialModeHandleRef, clientX: number, clientY: number) => void
}

export function SketchSpecialModeViewportFeedback({
  presentation,
  projections,
  onHandleDragStart,
  onHandleDragMove,
  onHandleDragEnd,
}: SketchSpecialModeViewportFeedbackProps) {
  if (!presentation) {
    return null
  }

  const projectionById = new Map(projections.map((projection) => [projection.id, projection]))
  const overlays = presentation.overlays ?? []
  const hasStatus = (presentation.prompts?.length ?? 0) > 0 || (presentation.diagnostics?.length ?? 0) > 0

  const dragCallbacks = {
    onStart(handle: SketchSpecialModeHandleRef, event: ReactPointerEvent<SVGCircleElement>) {
      event.preventDefault()
      event.stopPropagation()
      event.currentTarget.dataset.sketchSpecialHandleDragging = 'true'
      event.currentTarget.setPointerCapture(event.pointerId)
      onHandleDragStart?.(handle, event.clientX, event.clientY)
    },
    onMove(handle: SketchSpecialModeHandleRef, event: ReactPointerEvent<SVGCircleElement>) {
      if (event.currentTarget.dataset.sketchSpecialHandleDragging !== 'true') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onHandleDragMove?.(handle, event.clientX, event.clientY)
    },
    onEnd(handle: SketchSpecialModeHandleRef, event: ReactPointerEvent<SVGCircleElement>) {
      if (event.currentTarget.dataset.sketchSpecialHandleDragging !== 'true') {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      onHandleDragEnd?.(handle, event.clientX, event.clientY)
      delete event.currentTarget.dataset.sketchSpecialHandleDragging
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
  }

  return (
    <>
      {hasStatus ? (
        <div className="pointer-events-none absolute right-4 top-4 z-20 flex max-w-sm items-end gap-2">
          {presentation.prompts?.map((prompt) => (
            <div
              key={prompt.id}
              className="rounded-md border border-[var(--cad-border-strong)] bg-[var(--cad-surface-overlay)] px-3 py-2 text-xs text-[var(--cad-foreground)] shadow-[var(--cad-panel-shadow)]"
            >
              {prompt.text}
            </div>
          ))}
          {presentation.diagnostics?.map((diagnostic) => (
            <div
              key={diagnostic.id}
              className="rounded-md border border-[var(--workbench-shell-danger-border)] bg-[var(--workbench-shell-danger-surface)] px-3 py-2 text-xs text-[var(--workbench-shell-danger-text)] shadow-[var(--cad-panel-shadow)]"
            >
              {diagnostic.message}
            </div>
          ))}
        </div>
      ) : null}
      <div className="pointer-events-none absolute inset-0 z-10">
        <svg aria-hidden="true" className="absolute inset-0 h-full w-full overflow-visible">
          {overlays.map((overlay) => {
            if (overlay.kind !== 'segment') {
              return null
            }

            const start = projectionById.get(getSketchSpecialModeSegmentProjectionId(overlay.id, 'start'))
            const end = projectionById.get(getSketchSpecialModeSegmentProjectionId(overlay.id, 'end'))

            if (!start || !end) {
              return null
            }

            const stroke = getToneStroke(overlay.tone ?? 'neutral')

            return (
              <line
                key={overlay.id}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={stroke}
                strokeDasharray={overlay.dashed ? '4 4' : undefined}
                strokeWidth="1.5"
              />
            )
          })}
          {overlays.map((overlay) => {
            if (overlay.kind !== 'handle') {
              return null
            }

            const projection = projectionById.get(getSketchSpecialModeOverlayProjectionId(overlay.id))
            if (!projection) {
              return null
            }

            return (
              <circle
                key={overlay.id}
                cx={projection.x}
                cy={projection.y}
                r="7"
                fill="var(--workbench-shell-overlay-strong)"
                stroke={getToneStroke(getSketchSpecialModeOverlayTone(overlay))}
                strokeWidth="2"
                className={overlay.draggable ? 'pointer-events-auto cursor-grab' : 'pointer-events-none'}
                onPointerDown={overlay.draggable ? (event) => dragCallbacks.onStart(overlay.handle, event) : undefined}
                onPointerMove={overlay.draggable ? (event) => dragCallbacks.onMove(overlay.handle, event) : undefined}
                onPointerUp={overlay.draggable ? (event) => dragCallbacks.onEnd(overlay.handle, event) : undefined}
                onPointerCancel={overlay.draggable ? (event) => dragCallbacks.onEnd(overlay.handle, event) : undefined}
              />
            )
          })}
        </svg>
        {overlays.map((overlay) => {
          if (overlay.kind !== 'badge' && overlay.kind !== 'diagnostic' && overlay.kind !== 'handle') {
            return null
          }

          const projection = projectionById.get(getSketchSpecialModeOverlayProjectionId(overlay.id))
          if (!projection) {
            return null
          }

          const label = overlay.kind === 'diagnostic' ? overlay.message : overlay.label

          return (
            <div
              key={overlay.id}
              className={getOverlayClassName(overlay.kind, getSketchSpecialModeOverlayTone(overlay))}
              style={{
                left: projection.x,
                top: projection.y,
                transform: 'translate(-50%, calc(-100% - 12px))',
              }}
            >
              {label}
            </div>
          )
        })}
      </div>
    </>
  )
}

function getToneStroke(tone: 'neutral' | 'success' | 'warning') {
  if (tone === 'success') {
    return 'var(--workbench-shell-success-text)'
  }

  if (tone === 'warning') {
    return 'var(--workbench-shell-danger-text)'
  }

  return 'var(--workbench-shell-accent)'
}

function getOverlayClassName(
  kind: 'badge' | 'diagnostic' | 'handle',
  tone: 'neutral' | 'success' | 'warning',
) {
  const palette =
    tone === 'success'
      ? 'border-[var(--workbench-shell-success-text)] text-[var(--workbench-shell-success-text)]'
      : tone === 'warning'
        ? 'border-[var(--workbench-shell-danger-border)] text-[var(--workbench-shell-danger-text)]'
        : 'border-[var(--cad-border-strong)] text-[var(--cad-foreground)]'

  return `pointer-events-none absolute max-w-[220px] whitespace-nowrap rounded border bg-[var(--cad-surface-overlay)] px-2 py-1 text-[11px] leading-none shadow-[var(--cad-panel-shadow)] ${palette}`
    + (kind === 'diagnostic' ? ' font-medium' : '')
}
