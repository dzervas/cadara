import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'

import { ToolIcon } from '@/components/ui/tool-icon'
import { WorkbenchIcon } from '@/components/ui/workbench-icon'
import { WorkbenchContextMenu, type WorkbenchContextMenuEntry } from '@/components/layout/workbench-context-menu'
import type {
  DocumentFeatureCursor,
  DocumentHistoryItemRecord,
  DocumentHistoryOrderEntry,
  DocumentSnapshot,
  ModelingDiagnostic,
} from '@/contracts/modeling/schema'
import {
  getModelingDiagnosticRepairMessage,
  isFeatureScopedModelingDiagnostic,
} from '@/contracts/modeling/diagnostics'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  getPrimitiveRefKey,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import { useEditorState } from '@/hooks/use-editor-state'
import {
  getNearestTimelineAnchorIndex,
  resolveTimelineReorderDrop,
  getTimelineCursorAriaLabel,
  getTimelineCursorIndex,
  TIMELINE_CURSOR_GLYPH,
} from '@/components/layout/feature-timeline-bar.helpers'
import {
  getDocumentHistoryCursorForIndex,
} from '@/domain/modeling/document-history'
import { getDocumentHistoryItemToolIcon } from '@/domain/tools/tool-icon-resolvers'

type FeatureHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'feature' }>

interface FeatureTimelineBarProps {
  snapshot: DocumentSnapshot | null
  onSelectTarget: (target: PrimitiveRef) => void
  onReopenTarget: (target: PrimitiveRef) => void
  onCursorRequested?: (cursor: DocumentFeatureCursor) => void
  cursorDisabled?: boolean
  onReorderItem?: (item: DocumentHistoryOrderEntry, beforeItem: DocumentHistoryOrderEntry | null) => void
  reorderDisabled?: boolean
  onDeleteItem: (item: DocumentHistoryItemRecord) => void
  onRenameItem: (item: DocumentHistoryItemRecord) => void
  onSuppressFeature: (item: FeatureHistoryItem) => void
  visibleSelection: PrimitiveRef[]
}

function getHistoryItemDescription(item: DocumentHistoryItemRecord) {
  return item.description
}

function getFeatureDiagnosticsById(diagnostics: readonly ModelingDiagnostic[]) {
  const byFeatureId = new Map<FeatureHistoryItem['featureId'], ModelingDiagnostic[]>()

  for (const diagnostic of diagnostics) {
    if (!isFeatureScopedModelingDiagnostic(diagnostic)) {
      continue
    }

    byFeatureId.set(diagnostic.featureId, [
      ...(byFeatureId.get(diagnostic.featureId) ?? []),
      diagnostic,
    ])
  }

  return byFeatureId
}

const ITEM_REORDER_DRAG_THRESHOLD_PX = 6
const REPAIR_TOOLTIP_OFFSET_PX = 16

interface ItemDragState {
  item: DocumentHistoryItemRecord
  pointerId: number
  startX: number
  startY: number
  dropCursorIndex: number
  active: boolean
}

interface RepairTooltipState {
  left: number
  top: number
  message: string
}

export function FeatureTimelineBar({
  snapshot,
  onSelectTarget,
  onReopenTarget,
  onCursorRequested,
  cursorDisabled = false,
  onReorderItem,
  reorderDisabled = false,
  onDeleteItem,
  onRenameItem,
  onSuppressFeature,
  visibleSelection,
}: FeatureTimelineBarProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
  } = useEditorState()
  const historyItems = useMemo(() => snapshot?.presentation.documentHistory ?? [], [snapshot])
  const diagnosticsByFeatureId = useMemo(
    () => getFeatureDiagnosticsById(snapshot?.document.diagnostics ?? []),
    [snapshot],
  )
  const cursor = snapshot?.document.cursor ?? { kind: 'empty' as const }
  const cursorIndex = getTimelineCursorIndex(historyItems, cursor)
  const tooltipId = useId()
  const trackRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const anchorRefs = useRef<Array<HTMLDivElement | null>>([])
  const [dragCursorIndex, setDragCursorIndex] = useState<number | null>(null)
  const [itemDragState, setItemDragState] = useState<ItemDragState | null>(null)
  const [repairTooltip, setRepairTooltip] = useState<RepairTooltipState | null>(null)
  const suppressNextItemClickRef = useRef(false)
  const activeCursorIndex = dragCursorIndex ?? cursorIndex
  const anchorElements = useMemo(
    () => Array.from({ length: historyItems.length + 1 }, (_, index) => index),
    [historyItems.length],
  )
  const getPositionCursor = useCallback((index: number): DocumentFeatureCursor => {
    return getDocumentHistoryCursorForIndex(historyItems, index)
  }, [historyItems])

  useEffect(() => {
    if (!itemDragState) {
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
      if (event.pointerId !== itemDragState.pointerId || reorderDisabled) {
        return
      }

      const distance = Math.hypot(event.clientX - itemDragState.startX, event.clientY - itemDragState.startY)
      const active = itemDragState.active || distance >= ITEM_REORDER_DRAG_THRESHOLD_PX
      if (!active) {
        return
      }

      const nearestIndex = getNearestTimelineAnchorIndex(getAnchorCenterXs(), event.clientX)
      setItemDragState((current) => current && current.pointerId === event.pointerId
        ? {
            ...current,
            active: true,
            dropCursorIndex: nearestIndex >= -1 ? nearestIndex : current.dropCursorIndex,
          }
        : current)
    }

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== itemDragState.pointerId) {
        return
      }

      setItemDragState((current) => {
        if (!current) {
          return null
        }

        if (current.active) {
          suppressNextItemClickRef.current = true
        }

        if (current.active && !reorderDisabled) {
          const drop = resolveTimelineReorderDrop(historyItems, current.item, current.dropCursorIndex)
          if (drop) {
            onReorderItem?.(drop.item, drop.beforeItem)
          }
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
  }, [historyItems, itemDragState, onReorderItem, reorderDisabled])

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
      if (cursorDisabled) {
        return
      }

      const nearestIndex = getNearestTimelineAnchorIndex(getAnchorCenterXs(), event.clientX)
      if (nearestIndex >= -1) {
        setDragCursorIndex(nearestIndex)
      }
    }

    const handlePointerUp = () => {
      setDragCursorIndex((current) => {
        if (!cursorDisabled && current !== null && current !== cursorIndex) {
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
  }, [cursorDisabled, cursorIndex, dragCursorIndex, getPositionCursor, onCursorRequested])

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
    if (cursorDisabled) {
      return
    }

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

  const handleItemPointerDown = (
    event: ReactPointerEvent<HTMLButtonElement>,
    item: DocumentHistoryItemRecord,
    anchorIndex: number,
  ) => {
    if (event.button !== 0 || reorderDisabled) {
      return
    }

    setItemDragState({
      item,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dropCursorIndex: anchorIndex - 1,
      active: false,
    })
  }

  const showRepairTooltip = (element: HTMLElement, message: string | null) => {
    if (!message) {
      setRepairTooltip(null)
      return
    }

    const elementRect = element.getBoundingClientRect()
    setRepairTooltip({
      left: elementRect.left + elementRect.width / 2,
      top: elementRect.top - REPAIR_TOOLTIP_OFFSET_PX,
      message,
    })
  }

  return (
    <section
      className="relative flex min-h-[56px] shrink-0 items-center gap-3 overflow-visible border-t px-3 py-2"
      style={{
        backgroundColor: 'var(--workbench-shell-overlay-strong)',
        borderColor: 'var(--workbench-shell-border)',
      }}
      aria-label="Feature timeline"
      data-reorder-disabled={reorderDisabled ? 'true' : undefined}
    >
      {repairTooltip && typeof document !== 'undefined' ? createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[2147483647] w-max max-w-72 -translate-x-1/2 -translate-y-full whitespace-normal rounded border px-2 py-1 text-center text-[11px] leading-4 shadow-[var(--workbench-panel-shadow)]"
          style={{
            left: repairTooltip.left,
            top: repairTooltip.top,
            backgroundColor: 'var(--workbench-shell-danger-surface)',
            borderColor: 'var(--workbench-shell-danger-border)',
            color: 'var(--workbench-shell-danger-text)',
          }}
        >
          {repairTooltip.message}
        </span>,
        document.body,
      ) : null}
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="overflow-x-auto overflow-y-hidden">
          <div ref={trackRef} className="relative flex min-h-14 min-w-max items-center gap-1 pr-6">
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
              aria-disabled={cursorDisabled}
              disabled={cursorDisabled}
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
                  const itemToolIcon = item
                    ? getDocumentHistoryItemToolIcon(item, snapshot?.document.features ?? [])
                    : null
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
                  const isDraggingItem = itemDragState?.active && itemDragState.item.id === item?.id
                  const itemFeatureDiagnostics = item?.kind === 'feature'
                    ? diagnosticsByFeatureId.get(item.featureId) ?? []
                    : []
                  const primaryFeatureDiagnostic = itemFeatureDiagnostics[0] ?? null
                  const repairMessage = primaryFeatureDiagnostic
                    ? getModelingDiagnosticRepairMessage(primaryFeatureDiagnostic)
                    : null
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
                      disabled: cursorDisabled,
                      onSelect: () => onCursorRequested?.(getPositionCursor(anchorIndex)),
                    },
                    {
                      kind: 'divider' as const,
                      id: 'destructive-divider',
                    },
                    {
                      kind: 'item' as const,
                      id: 'delete',
                      label: 'Delete',
                      commandId: 'context.delete' as const,
                      icon: <WorkbenchIcon name="trash" className="h-3.5 w-3.5" />,
                      danger: true,
                      onSelect: () => onDeleteItem(item),
                    },
                  ] : []

                  return (
                    <div key={`segment-${anchorIndex}`} className="flex h-14 items-center">
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
                            onPointerDown={(event) => handleItemPointerDown(event, item, anchorIndex)}
                            onClick={() => {
                              if (suppressNextItemClickRef.current) {
                                suppressNextItemClickRef.current = false
                                return
                              }

                              if (primaryFeatureDiagnostic) {
                                onReopenTarget(target!)
                                return
                              }

                              if (!isAllowed) {
                                return
                              }

                              onSelectTarget(target!)
                            }}
                            onDoubleClick={() => onReopenTarget(target!)}
                            className={`relative flex h-8 w-8 items-center justify-center rounded-md border transition ${
                              isAfterCursor ? 'opacity-45' : ''
                            } ${isDraggingItem ? 'opacity-70' : ''
                            } ${!isAllowed ? 'cursor-not-allowed' : ''}`}
                            style={{
                              backgroundColor: primaryFeatureDiagnostic
                                ? 'var(--workbench-shell-danger-surface)'
                                : isSelected
                                ? 'var(--workbench-shell-accent-surface)'
                                : 'transparent',
                              borderColor: primaryFeatureDiagnostic
                                ? 'var(--workbench-shell-danger-border)'
                                : isSelected
                                ? 'var(--workbench-shell-border-strong)'
                                : 'transparent',
                              color: primaryFeatureDiagnostic
                                ? 'var(--workbench-shell-danger-text)'
                                : 'var(--workbench-shell-text)',
                            }}
                            aria-label={primaryFeatureDiagnostic
                              ? `Repair ${item.label}. ${repairMessage}`
                              : `Select ${item.label}. Double-click to reopen.`}
                            aria-disabled={!isAllowed}
                            aria-grabbed={isDraggingItem}
                            title={primaryFeatureDiagnostic
                              ? repairMessage ?? getHistoryItemDescription(item)
                              : `${getHistoryItemDescription(item)}. Double-click to reopen authoring in place`}
                            data-feature-error={primaryFeatureDiagnostic ? 'true' : undefined}
                            data-delete-supported="true"
                            data-repair-guidance={primaryFeatureDiagnostic ? repairMessage ?? undefined : undefined}
                            aria-describedby={primaryFeatureDiagnostic ? tooltipId : undefined}
                            onMouseEnter={(event) => showRepairTooltip(event.currentTarget, repairMessage)}
                            onMouseLeave={() => setRepairTooltip(null)}
                            onFocus={(event) => showRepairTooltip(event.currentTarget, repairMessage)}
                            onBlur={() => setRepairTooltip(null)}
                          >
                            {itemToolIcon ? (
                              <ToolIcon icon={itemToolIcon} className="h-4 w-4" />
                            ) : item.kind === 'sketch' ? (
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
