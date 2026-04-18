import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { WorkbenchContextMenu, type WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'
import type { DocumentFeatureCursor, DocumentHistoryItemRecord, DocumentSnapshot } from '@/contracts/modeling/schema'
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
import { getDocumentHistoryCursorForIndex } from '@/domain/modeling/document-history'

type FeatureHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'feature' }>

interface FeatureTimelineBarProps {
  snapshot: DocumentSnapshot | null
  onSelectTarget: (target: PrimitiveRef) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onCursorRequested?: (cursor: DocumentFeatureCursor) => void
  onDeleteFeature: (item: FeatureHistoryItem) => void
  onRenameItem: (item: DocumentHistoryItemRecord) => void
  onSuppressFeature: (item: FeatureHistoryItem) => void
  visibleSelection: PrimitiveRef[]
}

function getHistoryItemDescription(item: DocumentHistoryItemRecord) {
  return item.description
}

export function FeatureTimelineBar({
  snapshot,
  onSelectTarget,
  onReopenTarget,
  onCursorRequested,
  onDeleteFeature,
  onRenameItem,
  onSuppressFeature,
  visibleSelection,
}: FeatureTimelineBarProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState()
  const historyItems = useMemo(() => snapshot?.presentation.documentHistory ?? [], [snapshot])
  const cursor = snapshot?.document.cursor ?? { kind: 'empty' as const }
  const cursorIndex = getTimelineCursorIndex(historyItems, cursor)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const anchorRefs = useRef<Array<HTMLDivElement | null>>([])
  const [dragCursorIndex, setDragCursorIndex] = useState<number | null>(null)
  const activeCursorIndex = dragCursorIndex ?? cursorIndex
  const anchorElements = useMemo(
    () => Array.from({ length: historyItems.length + 1 }, (_, index) => index),
    [historyItems.length],
  )
  const getPositionCursor = useCallback((index: number): DocumentFeatureCursor => {
    return getDocumentHistoryCursorForIndex(historyItems, index)
  }, [historyItems])

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
  }, [activeCursorIndex, historyItems.length])

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
    <section
      className="flex min-h-[56px] shrink-0 items-center gap-3 border-t px-3 py-2"
      style={{
        backgroundColor: 'var(--workbench-shell-overlay-strong)',
        borderColor: 'var(--workbench-shell-border)',
      }}
      aria-label="Feature timeline"
    >
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="overflow-x-auto overflow-y-hidden">
          <div ref={trackRef} className="relative flex min-h-12 min-w-max items-center gap-1 pr-6">
            <button
              ref={handleRef}
              type="button"
              className="absolute top-1/2 z-10 flex h-10 w-7 items-center justify-center rounded-full border text-sm transition"
              style={{
                backgroundColor:
                  dragCursorIndex === null
                    ? 'var(--workbench-shell-control-surface)'
                    : 'var(--workbench-shell-overlay)',
                borderColor:
                  dragCursorIndex === null
                    ? 'var(--workbench-shell-border-strong)'
                    : 'var(--workbench-shell-accent)',
                boxShadow: 'var(--workbench-panel-shadow)',
                color: 'var(--workbench-shell-text)',
                opacity: 0,
                transform: 'translate(-50%, -50%)',
              }}
              aria-label={getTimelineCursorAriaLabel(historyItems, activeCursorIndex)}
              aria-current={dragCursorIndex === null ? 'step' : undefined}
              aria-grabbed={dragCursorIndex !== null}
              onPointerDown={handlePointerDown}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-1 left-1/2 w-px -translate-x-1/2"
                style={{ backgroundColor: 'var(--mantine-color-dark-4)' }}
              />
              <span
                aria-hidden="true"
                className="relative text-[12px] leading-none"
                style={{ color: 'var(--mantine-color-workbench-4)' }}
              >
                {TIMELINE_CURSOR_GLYPH}
              </span>
            </button>
            {historyItems.length === 0 ? (
              <>
                <div
                  ref={(element) => {
                    anchorRefs.current[0] = element
                  }}
                  className="h-8 w-6 shrink-0"
                  aria-hidden="true"
                />
                <span
                  className="flex h-8 items-center rounded-md border border-dashed px-3 text-xs"
                  style={{
                    borderColor: 'var(--mantine-color-dark-5)',
                    color: 'var(--mantine-color-dark-2)',
                  }}
                >
                  Empty timeline
                </span>
              </>
            ) : null}
            {historyItems.length > 0
              ? anchorElements.map((anchorIndex) => {
                  const item = historyItems[anchorIndex]
                  const target = item?.target ?? null
                  const targetKey = target ? getPrimitiveRefKey(target) : null
                  const isSelected =
                    targetKey !== null
                      ? visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
                      : false
                  const isAllowed =
                    target
                      ? selectionFilterAllowsTarget(selectionFilter, selection, target, selectionCatalog)
                      : false
                  const isAfterCursor = item ? anchorIndex > cursorIndex : false
                  const menuItems: WorkbenchContextMenuEntry[] = item ? [
                    {
                      kind: 'item',
                      id: 'edit',
                      label: 'Edit',
                      commandId: 'context.edit' as const,
                      icon: <WorkbenchIcon name="edit" className="h-3.5 w-3.5" />,
                      onSelect: () => onReopenTarget(item.target),
                    },
                    {
                      kind: 'item',
                      id: 'rename',
                      label: 'Rename',
                      commandId: 'context.rename' as const,
                      icon: <WorkbenchIcon name="type" className="h-3.5 w-3.5" />,
                      onSelect: () => onRenameItem(item),
                    },
                    ...(item.kind === 'feature' ? [
                      {
                        kind: 'item' as const,
                        id: 'suppress',
                        label: 'Suppress',
                        commandId: 'context.suppress' as const,
                        icon: <WorkbenchIcon name="ban" className="h-3.5 w-3.5" />,
                        onSelect: () => onSuppressFeature(item),
                      },
                    ] : []),
                    {
                      kind: 'item',
                      id: 'roll-cursor-here',
                      label: 'Roll cursor here',
                      commandId: 'context.rollCursorHere' as const,
                      icon: <WorkbenchIcon name="history" className="h-3.5 w-3.5" />,
                      onSelect: () => onCursorRequested?.(getPositionCursor(anchorIndex)),
                    },
                    ...(item.kind === 'feature' ? [
                      {
                        kind: 'divider' as const,
                        id: 'feature-destructive-divider',
                      },
                      {
                        kind: 'item' as const,
                        id: 'delete',
                        label: 'Delete',
                        commandId: 'context.delete' as const,
                        icon: <WorkbenchIcon name="trash" className="h-3.5 w-3.5" />,
                        danger: true,
                        onSelect: () => onDeleteFeature(item),
                      },
                    ] : []),
                  ] : []

                  return (
                    <div key={`segment-${anchorIndex}`} className="flex h-10 items-center">
                      <div
                        ref={(element) => {
                          anchorRefs.current[anchorIndex] = element
                        }}
                        className="flex h-8 w-6 shrink-0 items-center justify-center"
                        aria-hidden="true"
                      >
                        <span
                          className="h-5 w-px rounded-full"
                          style={{ backgroundColor: 'var(--mantine-color-dark-4)' }}
                        />
                      </div>
                      {item ? (
                        <WorkbenchContextMenu label={`${item.label} actions`} items={menuItems}>
                          <button
                            type="button"
                            onClick={() => {
                              if (!isAllowed) {
                                return
                              }

                              onSelectTarget(target!)
                            }}
                            onDoubleClick={() => onReopenTarget(target!)}
                            className={`flex h-8 w-8 items-center justify-center rounded-md border transition ${
                              isAfterCursor ? 'opacity-45' : ''
                            } ${!isAllowed ? 'cursor-not-allowed' : ''}`}
                            style={{
                              backgroundColor: isSelected
                                ? 'var(--workbench-shell-accent-surface)'
                                : 'transparent',
                              borderColor: isSelected
                                ? 'var(--workbench-shell-border-strong)'
                                : 'transparent',
                              color: 'var(--workbench-shell-text)',
                            }}
                            aria-label={`Select ${item.label}. Double-click to reopen.`}
                            aria-disabled={!isAllowed}
                            title={`${getHistoryItemDescription(item)}. Double-click to reopen authoring in place`}
                          >
                            {item.kind === 'sketch' ? (
                              <WorkbenchIcon name="pencilRuler" className="h-4 w-4" />
                            ) : (
                              <WorkbenchIcon name="layers" className="h-4 w-4" />
                            )}
                          </button>
                        </WorkbenchContextMenu>
                      ) : null}
                    </div>
                  )
                })
              : null}
          </div>
        </div>
      </div>
    </section>
  )
}
