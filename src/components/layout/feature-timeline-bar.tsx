import { Layers3 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { DocumentFeatureCursor, DocumentSnapshot, FeatureSnapshotRecord } from '@/contracts/modeling/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  getPrimitiveRefKey,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import { useEditorState } from '@/hooks/use-editor-state'
import {
  getNearestTimelineAnchorIndex,
  getTimelineCursorAriaLabel,
  getTimelineCursorIndex,
  TIMELINE_CURSOR_GLYPH,
} from '@/components/layout/feature-timeline-bar.helpers'

interface FeatureTimelineBarProps {
  snapshot: DocumentSnapshot | null
  onSelectTarget: (target: PrimitiveRef) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onCursorRequested?: (cursor: DocumentFeatureCursor) => void
  visibleSelection: PrimitiveRef[]
}

function getFeatureDescription(feature: FeatureSnapshotRecord) {
  return `${feature.definition.kind} feature`
}

export function FeatureTimelineBar({
  snapshot,
  onSelectTarget,
  onReopenTarget,
  onCursorRequested,
  visibleSelection,
}: FeatureTimelineBarProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState()
  const features = useMemo(() => snapshot?.document.features ?? [], [snapshot])
  const cursor = snapshot?.document.cursor ?? { kind: 'empty' as const }
  const cursorIndex = getTimelineCursorIndex(features, cursor)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const anchorRefs = useRef<Array<HTMLDivElement | null>>([])
  const [dragCursorIndex, setDragCursorIndex] = useState<number | null>(null)
  const activeCursorIndex = dragCursorIndex ?? cursorIndex
  const anchorElements = useMemo(
    () => Array.from({ length: features.length + 1 }, (_, index) => index),
    [features.length],
  )
  const getPositionCursor = useCallback((index: number): DocumentFeatureCursor => {
    if (index < 0) {
      return { kind: 'empty' }
    }

    const feature = features[index]
    return feature ? { kind: 'feature', featureId: feature.featureId } : { kind: 'empty' }
  }, [features])

  useEffect(() => {
    if (dragCursorIndex === null) {
      return
    }

    const getAnchorCenterXs = () => anchorRefs.current
      .map((anchor) => {
        if (!anchor) {
          return null
        }

        const rect = anchor.getBoundingClientRect()
        return rect.left + rect.width / 2
      })
      .filter((value): value is number => value !== null)

    const handlePointerMove = (event: PointerEvent) => {
      const nearestIndex = getNearestTimelineAnchorIndex(getAnchorCenterXs(), event.clientX)
      if (nearestIndex >= -1) {
        setDragCursorIndex(nearestIndex)
      }
    }

    const handlePointerUp = () => {
      setDragCursorIndex((current) => {
        if (current !== null && current !== cursorIndex) {
          onCursorRequested?.(getPositionCursor(current))
        }

        return null
      })
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [cursorIndex, dragCursorIndex, getPositionCursor, onCursorRequested])

  useEffect(() => {
    const handle = handleRef.current
    const anchor = anchorRefs.current[activeCursorIndex + 1]
    const track = trackRef.current

    if (!handle) {
      return
    }

    if (!anchor || !track) {
      handle.style.opacity = '0'
      handle.style.transform = 'translate(-50%, -50%)'
      return
    }

    const updateHandleLeft = () => {
      handle.style.left = `${anchor.offsetLeft + anchor.offsetWidth / 2}px`
      handle.style.opacity = '1'
      handle.style.transform = 'translate(-50%, -50%)'
    }

    updateHandleLeft()
    window.addEventListener('resize', updateHandleLeft)

    return () => {
      window.removeEventListener('resize', updateHandleLeft)
    }
  }, [activeCursorIndex, features.length])

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const nearestIndex = getNearestTimelineAnchorIndex(
      anchorRefs.current
        .map((anchor) => {
          if (!anchor) {
            return null
          }

          const rect = anchor.getBoundingClientRect()
          return rect.left + rect.width / 2
        })
        .filter((value): value is number => value !== null),
      event.clientX,
    )

    setDragCursorIndex(nearestIndex >= -1 ? nearestIndex : cursorIndex)
  }

  return (
    <TooltipProvider delayDuration={100}>
      <section
        className="flex min-h-[56px] shrink-0 items-center gap-3 border-t border-[var(--cad-border)] bg-[rgba(10,14,20,0.96)] px-3 py-2"
        aria-label="Feature timeline"
      >
        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="overflow-x-auto overflow-y-hidden">
            <div ref={trackRef} className="relative flex min-h-12 min-w-max items-center gap-1 pr-6">
              <button
                ref={handleRef}
                type="button"
                className={`absolute top-1/2 z-10 flex h-10 w-7 items-center justify-center rounded-full border text-sm text-[var(--cad-foreground)] shadow-[0_10px_24px_rgba(0,0,0,0.26)] transition ${
                  dragCursorIndex === null
                    ? 'border-[var(--cad-border-strong)] bg-[rgba(14,18,25,0.92)]'
                    : 'border-[var(--cad-accent)] bg-[rgba(22,32,46,0.96)]'
                }`}
                style={{ opacity: 0, transform: 'translate(-50%, -50%)' }}
                aria-label={getTimelineCursorAriaLabel(features, activeCursorIndex)}
                aria-current={dragCursorIndex === null ? 'step' : undefined}
                aria-grabbed={dragCursorIndex !== null}
                onPointerDown={handlePointerDown}
              >
                <span aria-hidden="true" className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2 bg-[var(--cad-border-strong)]" />
                <span aria-hidden="true" className="relative text-[12px] leading-none text-[var(--cad-accent)]">
                  {TIMELINE_CURSOR_GLYPH}
                </span>
              </button>
              {features.length === 0 ? (
                <>
                  <div
                    ref={(element) => {
                      anchorRefs.current[0] = element
                    }}
                    className="h-8 w-6 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="flex h-8 items-center rounded-md border border-dashed border-[var(--cad-border)] px-3 text-xs text-[var(--cad-muted-foreground)]">
                    Empty timeline
                  </span>
                </>
              ) : null}
              {features.length > 0
                ? anchorElements.map((anchorIndex) => {
                    const feature = features[anchorIndex]
                    const target = feature ? { kind: 'feature' as const, featureId: feature.featureId } : null
                    const targetKey = target ? getPrimitiveRefKey(target) : null
                    const isSelected =
                      targetKey !== null
                        ? visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
                        : false
                    const isAllowed =
                      target
                        ? selectionFilterAllowsTarget(selectionFilter, selection, target, selectionCatalog)
                        : false
                    const isAfterCursor = feature ? anchorIndex > cursorIndex : false

                    return (
                      <div key={`segment-${anchorIndex}`} className="flex h-10 items-center">
                        <div
                          ref={(element) => {
                            anchorRefs.current[anchorIndex] = element
                          }}
                          className="flex h-8 w-6 shrink-0 items-center justify-center"
                          aria-hidden="true"
                        >
                          <span className="h-5 w-px rounded-full bg-[var(--cad-border-strong)]" />
                        </div>
                        {feature ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!isAllowed) {
                                    return
                                  }

                                  onSelectTarget(target!)
                                }}
                                onDoubleClick={() => onReopenTarget(target!)}
                                className={`flex h-8 w-8 items-center justify-center rounded-md border text-[var(--cad-foreground)] transition hover:border-[var(--cad-border-strong)] hover:bg-[var(--cad-surface-elevated)] ${
                                  isSelected
                                    ? 'border-[var(--cad-border-strong)] bg-[var(--cad-surface-elevated)]'
                                    : 'border-transparent bg-transparent'
                                } ${isAfterCursor ? 'opacity-45' : ''} ${!isAllowed ? 'cursor-not-allowed' : ''}`}
                                aria-label={`Select ${feature.label}. Double-click to reopen.`}
                                aria-disabled={!isAllowed}
                                title="Double-click to reopen authoring in place"
                              >
                                <Layers3 className="h-4 w-4" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="max-w-56">
                                <div className="font-medium">{feature.label}</div>
                                <div className="text-[var(--cad-muted-foreground)]">{getFeatureDescription(feature)}</div>
                                {isAfterCursor ? (
                                  <div className="text-[var(--cad-muted-foreground)]">After current cursor</div>
                                ) : null}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        ) : null}
                      </div>
                    )
                  })
                : null}
            </div>
          </div>
        </div>
      </section>
    </TooltipProvider>
  )
}
