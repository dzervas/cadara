import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
import type { FeatureId } from '@/contracts/shared/ids'
import {
  getModelingDiagnosticRepairMessage,
  isFeatureScopedModelingDiagnostic,
} from '@/contracts/modeling/diagnostics'
import type { PrimitiveRef } from '@/domain/editor/schema'
import {
  getPrimitiveRefKey,
  selectionFilterAllowsTarget,
} from '@/domain/editor/schema'
import {
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
  type SketchHistoryCursor,
  type SketchHistoryItem,
  type SketchSessionState,
} from '@/domain/editor/sketch-session'
import { useEditorState } from '@/hooks/use-editor-state'
import {
  getDocumentHistoryMenuEntryDescriptors,
  getNearestTimelineAnchorIndex,
  getTimelineCursorAriaLabel,
  getTimelineCursorIndex,
  resolveTimelineReorderDrop,
} from '@/components/layout/feature-timeline-bar.helpers'
import {
  getDocumentHistoryCursorForIndex,
} from '@/domain/modeling/document-history'
import {
  getDocumentHistoryItemToolIcon,
  getSketchHistoryItemToolIcon,
} from '@/domain/tools/tool-icon-resolvers'

type FeatureHistoryItem = Extract<DocumentHistoryItemRecord, { kind: 'feature' }>

interface FeatureTimelineBarProps {
  snapshot: DocumentSnapshot | null
  historyHighlightFeatureIds: readonly FeatureId[]
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

interface SketchHistoryTimelineBarProps {
  session: SketchSessionState
  visibleSelection: PrimitiveRef[]
  onSelectTarget: (target: PrimitiveRef) => void
  onCursorRequested?: (cursor: SketchHistoryCursor) => void
}

interface HistoryTimelineVisualItem {
  id: string
  label: string
  icon: ReactNode
  menuItems: WorkbenchContextMenuEntry[]
  ariaLabel: string
  title: string
  isSelected: boolean
  isAllowed: boolean
  isAfterCursor: boolean
  isAtCursor: boolean
  isDragging?: boolean
  isHighlighted?: boolean
  errorMessage?: string | null
  dataFeatureError?: string
  dataDerivedHighlighted?: string
  dataHistoryFeatureId?: string
  dataDeleteSupported?: string
  dataRepairGuidance?: string
  onClick: () => void
  onDoubleClick?: () => void
  onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void
}

interface HistoryTimelineSurfaceProps {
  ariaLabel: string
  dataHistoryKind: 'document' | 'sketch'
  emptyLabel: string
  items: readonly HistoryTimelineVisualItem[]
  cursorIndex: number
  cursorDisabled?: boolean
  onCursorRequested?: (index: number) => void
  getCursorAriaLabel: (index: number) => string
  reorderDisabled?: boolean
  itemRefs: React.MutableRefObject<Array<HTMLDivElement | null>>
  trackRef: React.MutableRefObject<HTMLDivElement | null>
}

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

interface TimelineSlotRect {
  left: number
  right: number
  width: number
  center: number
}

const ITEM_REORDER_DRAG_THRESHOLD_PX = 6
const REPAIR_TOOLTIP_OFFSET_PX = 16

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

function getSketchHistoryIcon(kind: SketchHistoryItem['kind']) {
  switch (kind) {
    case 'operation':
      return <WorkbenchIcon name="history" className="h-4 w-4" />
    case 'entity':
      return <WorkbenchIcon name="pencilRuler" className="h-4 w-4" />
    case 'constraint':
      return <WorkbenchIcon name="slider" className="h-4 w-4" />
    case 'dimension':
      return <WorkbenchIcon name="ruler" className="h-4 w-4" />
  }
}

function getTimelineSlotRects(
  itemRefs: React.MutableRefObject<Array<HTMLDivElement | null>>,
  track: HTMLDivElement | null,
) {
  if (!track) {
    return []
  }

  const trackRect = track.getBoundingClientRect()

  return itemRefs.current
    .map((item) => {
      if (!item) {
        return null
      }

      const rect = item.getBoundingClientRect()
      return {
        left: rect.left - trackRect.left,
        right: rect.right - trackRect.left,
        width: rect.width,
        center: rect.left - trackRect.left + rect.width / 2,
      } satisfies TimelineSlotRect
    })
    .filter((value): value is TimelineSlotRect => value !== null)
}

function getTimelineReorderBoundaryXs(slotRects: readonly TimelineSlotRect[]) {
  if (slotRects.length === 0) {
    return []
  }

  const boundaries = [Math.max(0, slotRects[0]!.left - 14)]

  for (let index = 0; index < slotRects.length - 1; index += 1) {
    boundaries.push((slotRects[index]!.center + slotRects[index + 1]!.center) / 2)
  }

  boundaries.push(slotRects[slotRects.length - 1]!.right + 14)
  return boundaries
}

function getTimelineCursorPositions(slotRects: readonly TimelineSlotRect[]) {
  if (slotRects.length === 0) {
    return []
  }

  return [
    Math.max(0, slotRects[0]!.left - 14),
    ...slotRects.map((slot) => slot.center),
  ]
}

function getTrackRelativeClientX(track: HTMLDivElement | null, pointerClientX: number) {
  if (!track) {
    return pointerClientX
  }

  return pointerClientX - track.getBoundingClientRect().left
}

function HistoryTimelineSurface({
  ariaLabel,
  dataHistoryKind,
  emptyLabel,
  items,
  cursorIndex,
  cursorDisabled = false,
  onCursorRequested,
  getCursorAriaLabel,
  reorderDisabled = false,
  itemRefs,
  trackRef,
}: HistoryTimelineSurfaceProps) {
  const tooltipId = useId()
  const scrollerRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<HTMLButtonElement | null>(null)
  const dragPointerIdRef = useRef<number | null>(null)
  const [dragCursorIndex, setDragCursorIndex] = useState<number | null>(null)
  const [repairTooltip, setRepairTooltip] = useState<RepairTooltipState | null>(null)
  const activeCursorIndex = dragCursorIndex ?? cursorIndex

  const getSlotRects = useCallback(
    () => getTimelineSlotRects(itemRefs, trackRef.current),
    [itemRefs, trackRef],
  )

  const resolveNearestCursorIndex = useCallback((pointerClientX: number) => {
    return getNearestTimelineAnchorIndex(
      getTimelineCursorPositions(getSlotRects()),
      getTrackRelativeClientX(trackRef.current, pointerClientX),
    )
  }, [getSlotRects, trackRef])

  const updateHandlePosition = useCallback((index: number) => {
    const handle = handleRef.current
    const track = trackRef.current
    const positions = getTimelineCursorPositions(getSlotRects())
    if (!handle || !track) {
      return
    }

    const nextLeft = positions[index + 1]
    if (nextLeft === undefined) {
      handle.style.opacity = '0'
      track.style.setProperty('--timeline-cursor-left', '0px')
      track.style.setProperty('--timeline-cursor-opacity', '0')
      return
    }

    handle.style.opacity = '1'
    track.style.setProperty('--timeline-cursor-left', `${nextLeft}px`)
    track.style.setProperty('--timeline-cursor-opacity', '1')
  }, [getSlotRects, trackRef])

  useEffect(() => {
    updateHandlePosition(activeCursorIndex)
    const scroller = scrollerRef.current

    const handleResize = () => {
      updateHandlePosition(activeCursorIndex)
    }
    const handleScroll = () => {
      updateHandlePosition(activeCursorIndex)
    }

    window.addEventListener('resize', handleResize)
    scroller?.addEventListener('scroll', handleScroll)
    return () => {
      window.removeEventListener('resize', handleResize)
      scroller?.removeEventListener('scroll', handleScroll)
    }
  }, [activeCursorIndex, updateHandlePosition, items.length])

  const handleWindowPointerMove = useCallback((event: PointerEvent) => {
    if (cursorDisabled || dragPointerIdRef.current !== event.pointerId) {
      return
    }

    const nearestIndex = resolveNearestCursorIndex(event.clientX)
    if (nearestIndex >= -1) {
      setDragCursorIndex(nearestIndex)
    }
  }, [cursorDisabled, resolveNearestCursorIndex])

  function handleWindowPointerUp(event: PointerEvent) {
    if (dragPointerIdRef.current !== event.pointerId) {
      return
    }

    dragPointerIdRef.current = null
    const handle = handleRef.current
    if (handle && handle.hasPointerCapture(event.pointerId)) {
      handle.releasePointerCapture(event.pointerId)
    }

    window.removeEventListener('pointermove', handleWindowPointerMove)
    window.removeEventListener('pointerup', handleWindowPointerUp)
    window.removeEventListener('pointercancel', handleWindowPointerUp)

    setDragCursorIndex((current) => {
      if (!cursorDisabled && current !== null && current !== cursorIndex) {
        onCursorRequested?.(current)
      }

      return null
    })
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (cursorDisabled) {
      return
    }

    event.preventDefault()
    dragPointerIdRef.current = event.pointerId
    event.currentTarget.setPointerCapture(event.pointerId)
    window.addEventListener('pointermove', handleWindowPointerMove)
    window.addEventListener('pointerup', handleWindowPointerUp)
    window.addEventListener('pointercancel', handleWindowPointerUp)
    const nearestIndex = resolveNearestCursorIndex(event.clientX)
    setDragCursorIndex(nearestIndex >= -1 ? nearestIndex : cursorIndex)
  }

  const showRepairTooltip = (element: HTMLElement, message: string | null | undefined) => {
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
      className="pointer-events-auto relative shrink-0 overflow-visible rounded-[8px] px-4 pt-3"
      style={{
        backgroundColor: 'var(--workbench-shell-overlay-strong)',
        boxShadow: 'var(--workbench-shell-elevation-timeline)',
        margin: '0 16px 16px 16px',
      }}
      aria-label={ariaLabel}
      data-history-kind={dataHistoryKind}
      data-reorder-disabled={reorderDisabled ? 'true' : undefined}
    >
      {repairTooltip && typeof document !== 'undefined' ? createPortal(
        <span
          id={tooltipId}
          role="tooltip"
          className="pointer-events-none fixed z-[2147483647] w-max max-w-72 -translate-x-1/2 -translate-y-full whitespace-normal rounded px-2 py-1 text-center text-[11px] leading-4"
          style={{
            left: repairTooltip.left,
            top: repairTooltip.top,
            backgroundColor: 'var(--workbench-shell-danger-surface)',
            boxShadow: 'var(--workbench-panel-shadow)',
            color: 'var(--workbench-shell-danger-text)',
          }}
        >
          {repairTooltip.message}
        </span>,
        document.body,
      ) : null}

      <div className="min-w-0 overflow-hidden">
        <div ref={scrollerRef} className="overflow-x-auto overflow-y-hidden">
          <div ref={trackRef} className="relative min-w-full w-max">
            {items.length === 0 ? (
              <span
                className="mb-2 flex h-7 items-center rounded-[4px] px-3 text-xs"
                style={{
                  background: 'var(--workbench-shell-overlay-soft)',
                  color: 'var(--mantine-color-dark-2)',
                }}
              >
                {emptyLabel}
              </span>
            ) : (
              <div className="flex items-center gap-1.5 pb-2">
                {items.map((item, index) => (
                  <div
                    key={item.id}
                    ref={(element) => {
                      itemRefs.current[index] = element
                    }}
                    className="shrink-0"
                    data-anchor-index={index}
                  >
                    <WorkbenchContextMenu label={`${item.label} actions`} items={item.menuItems}>
                      <button
                        type="button"
                        onPointerDown={item.onPointerDown}
                        onClick={item.onClick}
                        onDoubleClick={item.onDoubleClick}
                        className={`relative flex h-7 shrink-0 items-center gap-1.5 rounded-[4px] pl-2 pr-2.5 text-[11px] transition ${
                          item.isAfterCursor ? 'opacity-45' : ''
                        } ${item.isDragging ? 'opacity-70' : ''} ${!item.isAllowed ? 'cursor-not-allowed' : ''}`}
                        style={{
                          backgroundColor: item.errorMessage
                            ? 'var(--workbench-shell-danger-surface)'
                            : item.isSelected || item.isHighlighted
                              ? 'var(--workbench-shell-accent-surface)'
                              : item.isAtCursor
                                ? 'var(--workbench-shell-control-surface)'
                                : 'transparent',
                          boxShadow: item.errorMessage
                            ? 'inset 0 0 0 1px var(--workbench-shell-danger-border)'
                            : item.isSelected || item.isHighlighted
                              ? 'inset 0 0 0 1px var(--workbench-shell-accent-border)'
                              : 'none',
                          color: item.errorMessage
                            ? 'var(--workbench-shell-danger-text)'
                            : item.isSelected || item.isHighlighted
                              ? 'var(--workbench-shell-accent)'
                              : 'var(--workbench-shell-text)',
                        }}
                        aria-label={item.ariaLabel}
                        aria-grabbed={item.isDragging}
                        aria-disabled={!item.isAllowed}
                        title={item.title}
                        data-feature-error={item.dataFeatureError}
                        data-derived-highlighted={item.dataDerivedHighlighted}
                        data-history-feature-id={item.dataHistoryFeatureId}
                        data-delete-supported={item.dataDeleteSupported}
                        data-repair-guidance={item.dataRepairGuidance}
                        aria-describedby={item.errorMessage ? tooltipId : undefined}
                        onMouseEnter={(event) => showRepairTooltip(event.currentTarget, item.errorMessage)}
                        onMouseLeave={() => setRepairTooltip(null)}
                        onFocus={(event) => showRepairTooltip(event.currentTarget, item.errorMessage)}
                        onBlur={() => setRepairTooltip(null)}
                      >
                        {item.icon}
                        <span className="max-w-[9ch] truncate text-[11px]">
                          {item.label}
                        </span>
                      </button>
                    </WorkbenchContextMenu>
                  </div>
                ))}
              </div>
            )}

            {items.length > 0 ? (
              <div
                className="relative h-5 mb-2 select-none"
                style={{
                  cursor: cursorDisabled ? 'default' : (dragCursorIndex !== null ? 'grabbing' : 'grab'),
                  touchAction: 'none',
                }}
              >
                <div
                  className="absolute left-0 right-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                  style={{
                    background: 'var(--workbench-shell-scrubber-track)',
                    boxShadow: 'var(--workbench-shell-scrubber-track-glow)',
                  }}
                />
                <div
                  className="absolute left-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full"
                  style={{
                    width: 'var(--timeline-cursor-left, 0px)',
                    opacity: 'var(--timeline-cursor-opacity, 0)',
                    background: 'color-mix(in oklch, var(--workbench-shell-accent) 35%, transparent)',
                    boxShadow: 'var(--workbench-shell-scrubber-track-glow)',
                  }}
                />
                <button
                  ref={handleRef}
                  type="button"
                  className={`absolute top-1/2 z-10 h-[18px] w-[18px] rounded-full border-2 transition left-[max(9px,var(--timeline-cursor-left,0px))] ${
                    dragCursorIndex === null && !cursorDisabled ? 'hover:[--timeline-thumb-scale:1.08]' : ''
                  }`}
                  aria-label={getCursorAriaLabel(activeCursorIndex)}
                  aria-current={dragCursorIndex === null ? 'step' : undefined}
                  aria-grabbed={dragCursorIndex !== null}
                  aria-disabled={cursorDisabled}
                  onPointerDown={handlePointerDown}
                  style={{
                    transform: `translate(-50%, -50%) scale(var(--timeline-thumb-scale, ${dragCursorIndex !== null ? 1.18 : 1}))`,
                    transition: 'box-shadow 160ms ease, transform 120ms cubic-bezier(.2,.7,.3,1)',
                    backgroundColor: 'var(--workbench-shell-overlay-strong)',
                    borderColor: 'var(--workbench-shell-accent)',
                    boxShadow: dragCursorIndex !== null
                      ? 'var(--workbench-shell-scrubber-glow)'
                      : 'var(--workbench-shell-scrubber-ring)',
                    opacity: 0,
                    touchAction: 'none',
                    cursor: cursorDisabled ? 'default' : (dragCursorIndex !== null ? 'grabbing' : 'grab'),
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}

export function FeatureTimelineBar({
  snapshot,
  historyHighlightFeatureIds,
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
  const historyHighlightFeatureIdSet = useMemo(
    () => new Set(historyHighlightFeatureIds),
    [historyHighlightFeatureIds],
  )
  const diagnosticsByFeatureId = useMemo(
    () => getFeatureDiagnosticsById(snapshot?.document.diagnostics ?? []),
    [snapshot],
  )
  const cursor = snapshot?.document.cursor ?? { kind: 'empty' as const }
  const cursorIndex = getTimelineCursorIndex(historyItems, cursor)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [itemDragState, setItemDragState] = useState<ItemDragState | null>(null)
  const suppressNextItemClickRef = useRef(false)
  const documentCursorActionsDisabled = cursorDisabled || !onCursorRequested
  const getPositionCursor = useCallback((index: number): DocumentFeatureCursor => {
    return getDocumentHistoryCursorForIndex(historyItems, index)
  }, [historyItems])

  useEffect(() => {
    if (!itemDragState) {
      return
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerId !== itemDragState.pointerId || reorderDisabled) {
        return
      }

      const distance = Math.hypot(event.clientX - itemDragState.startX, event.clientY - itemDragState.startY)
      const active = itemDragState.active || distance >= ITEM_REORDER_DRAG_THRESHOLD_PX
      if (!active) {
        return
      }

      const nearestIndex = getNearestTimelineAnchorIndex(
        getTimelineReorderBoundaryXs(getTimelineSlotRects(itemRefs, trackRef.current)),
        getTrackRelativeClientX(trackRef.current, event.clientX),
      )

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

  const handleItemPointerDown = useCallback((
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
  }, [reorderDisabled])

  const visualItems = useMemo<HistoryTimelineVisualItem[]>(() => historyItems.map((item, index) => {
    const target = item.target
    const itemToolIcon = getDocumentHistoryItemToolIcon(item, snapshot?.document.features ?? [])
    const targetKey = getPrimitiveRefKey(target)
    const isSelected = visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
    const isAllowed = selectionFilterAllowsTarget(selectionFilter, selection, target, selectionCatalog)
    const isAfterCursor = index > cursorIndex
    const isAtCursor = index === cursorIndex
    const isDraggingItem = itemDragState?.active && itemDragState.item.id === item.id
    const isHistoryHighlighted = item.kind === 'feature'
      && historyHighlightFeatureIdSet.has(item.featureId)
    const itemFeatureDiagnostics = item.kind === 'feature'
      ? diagnosticsByFeatureId.get(item.featureId) ?? []
      : []
    const primaryFeatureDiagnostic = itemFeatureDiagnostics[0] ?? null
    const repairMessage = primaryFeatureDiagnostic
      ? getModelingDiagnosticRepairMessage(primaryFeatureDiagnostic)
      : null
    const menuItems: WorkbenchContextMenuEntry[] = getDocumentHistoryMenuEntryDescriptors({
      item,
      cursorDisabled: documentCursorActionsDisabled,
      cursorIndex,
      historyLength: historyItems.length,
    }).map((entry) => {
      switch (entry.id) {
        case 'edit':
          return {
            kind: 'item' as const,
            id: entry.id,
            label: entry.label,
            commandId: 'context.edit' as const,
            icon: <WorkbenchIcon name="edit" className="h-3.5 w-3.5" />,
            onSelect: () => onReopenTarget(item.target),
          }
        case 'rename':
          return {
            kind: 'item' as const,
            id: entry.id,
            label: entry.label,
            commandId: 'context.rename' as const,
            icon: <WorkbenchIcon name="type" className="h-3.5 w-3.5" />,
            onSelect: () => onRenameItem(item),
          }
        case 'suppress':
          return {
            kind: 'item' as const,
            id: entry.id,
            label: entry.label,
            commandId: 'context.suppress' as const,
            icon: <WorkbenchIcon name="ban" className="h-3.5 w-3.5" />,
            onSelect: () => item.kind === 'feature' ? onSuppressFeature(item) : undefined,
          }
        case 'roll-history-here':
          return {
            kind: 'item' as const,
            id: entry.id,
            label: entry.label,
            commandId: 'context.rollCursorHere' as const,
            icon: <WorkbenchIcon name="history" className="h-3.5 w-3.5" />,
            disabled: entry.disabled,
            onSelect: () => onCursorRequested?.(getPositionCursor(index)),
          }
        case 'roll-to-end':
          return {
            kind: 'item' as const,
            id: entry.id,
            label: entry.label,
            icon: <WorkbenchIcon name="history" className="h-3.5 w-3.5" />,
            disabled: entry.disabled,
            onSelect: () => onCursorRequested?.(getPositionCursor(historyItems.length - 1)),
          }
        case 'destructive-divider':
          return {
            kind: 'divider' as const,
            id: entry.id,
          }
        case 'delete':
          return {
            kind: 'item' as const,
            id: entry.id,
            label: entry.label,
            commandId: 'context.delete' as const,
            icon: <WorkbenchIcon name="trash" className="h-3.5 w-3.5" />,
            danger: true,
            onSelect: () => onDeleteItem(item),
          }
      }
    })

    return {
      id: item.id,
      label: item.label,
      icon: itemToolIcon ? (
        <ToolIcon icon={itemToolIcon} className="h-3.5 w-3.5" />
      ) : item.kind === 'sketch' ? (
        <WorkbenchIcon name="pencilRuler" className="h-3.5 w-3.5" />
      ) : (
        <WorkbenchIcon name="layers" className="h-3.5 w-3.5" />
      ),
      menuItems,
      ariaLabel: primaryFeatureDiagnostic
        ? `Repair ${item.label}. ${repairMessage}`
        : `Select ${item.label}. Double-click to reopen.`,
      title: primaryFeatureDiagnostic
        ? repairMessage ?? getHistoryItemDescription(item)
        : `${getHistoryItemDescription(item)}. Double-click to reopen authoring in place`,
      isSelected,
      isAllowed,
      isAfterCursor,
      isAtCursor,
      isDragging: isDraggingItem,
      isHighlighted: isHistoryHighlighted,
      errorMessage: repairMessage,
      dataFeatureError: primaryFeatureDiagnostic ? 'true' : undefined,
      dataDerivedHighlighted: isHistoryHighlighted ? 'true' : undefined,
      dataHistoryFeatureId: item.kind === 'feature' ? item.featureId : undefined,
      dataDeleteSupported: 'true',
      dataRepairGuidance: primaryFeatureDiagnostic ? repairMessage ?? undefined : undefined,
      onPointerDown: (event) => handleItemPointerDown(event, item, index),
      onClick: () => {
        if (suppressNextItemClickRef.current) {
          suppressNextItemClickRef.current = false
          return
        }

        if (primaryFeatureDiagnostic) {
          onReopenTarget(target)
          return
        }

        if (!isAllowed) {
          return
        }

        onSelectTarget(target)
      },
      onDoubleClick: () => onReopenTarget(target),
    }
  }), [
    cursorIndex,
    diagnosticsByFeatureId,
    documentCursorActionsDisabled,
    getPositionCursor,
    historyHighlightFeatureIdSet,
    historyItems,
    handleItemPointerDown,
    itemDragState,
    onCursorRequested,
    onDeleteItem,
    onRenameItem,
    onReopenTarget,
    onSelectTarget,
    onSuppressFeature,
    selection,
    selectionCatalog,
    selectionFilter,
    snapshot,
    visibleSelection,
  ])

  return (
    <HistoryTimelineSurface
      ariaLabel="Feature timeline"
      dataHistoryKind="document"
      emptyLabel="Empty timeline"
      items={visualItems}
      cursorIndex={cursorIndex}
      cursorDisabled={cursorDisabled}
      onCursorRequested={(index) => onCursorRequested?.(getPositionCursor(index))}
      getCursorAriaLabel={(index) => getTimelineCursorAriaLabel(historyItems, index)}
      reorderDisabled={reorderDisabled}
      itemRefs={itemRefs}
      trackRef={trackRef}
    />
  )
}

export function SketchHistoryTimelineBar({
  session,
  visibleSelection,
  onSelectTarget,
  onCursorRequested,
}: SketchHistoryTimelineBarProps) {
  const {
    state: { selection, selectionFilter, selectionCatalog },
    dispatch,
  } = useEditorState()
  const items = getSketchHistoryItems(session.fullDefinition)
  const cursorIndex = getSketchHistoryCursorIndex(items, session.historyCursor)
  const itemRefs = useRef<Array<HTMLDivElement | null>>([])
  const trackRef = useRef<HTMLDivElement | null>(null)

  const visualItems = useMemo<HistoryTimelineVisualItem[]>(() => items.map((item, index) => {
    const targetKey = item.target ? getPrimitiveRefKey(item.target) : null
    const isSelected = targetKey !== null && visibleSelection.some((entry) => getPrimitiveRefKey(entry) === targetKey)
    const isAllowed = item.target !== null && selectionFilterAllowsTarget(selectionFilter, selection, item.target, selectionCatalog)
    const isAfterCursor = index > cursorIndex
    const isAtCursor = index === cursorIndex
    const itemToolIcon = getSketchHistoryItemToolIcon(item, session.fullDefinition)
    const description =
      item.kind === 'operation'
        ? 'Sketch operation'
        : item.kind === 'entity' ? 'Sketch entity' : item.kind === 'constraint' ? 'Sketch constraint' : 'Sketch dimension'
    const menuItems: WorkbenchContextMenuEntry[] = [
      {
        kind: 'item',
        id: 'select',
        label: 'Select',
        commandId: 'context.selectTarget',
        icon: <WorkbenchIcon name="mousePointer" className="h-3.5 w-3.5" />,
        disabled: !isAllowed,
        onSelect: () => {
          if (item.target) {
            onSelectTarget(item.target)
          }
        },
      },
      {
        kind: 'item',
        id: 'move-cursor-here',
        label: 'Move cursor here',
        commandId: 'context.rollCursorHere',
        icon: <WorkbenchIcon name="history" className="h-3.5 w-3.5" />,
        onSelect: () => onCursorRequested?.(getSketchHistoryCursorForIndex(items, index)),
      },
      {
        kind: 'divider',
        id: 'destructive-divider',
      },
      {
        kind: 'item',
        id: 'delete',
        label: 'Delete',
        commandId: 'context.delete',
        icon: <WorkbenchIcon name="trash" className="h-3.5 w-3.5" />,
        disabled: item.target === null,
        danger: true,
        onSelect: () => {
          if (item.kind !== 'operation' || !item.target) {
            return
          }

          dispatch({ type: 'sketch.historyOperationDeleteRequested', operationId: item.operation.operationId })
        },
      },
    ]

    return {
      id: item.id,
      label: item.label,
      icon: itemToolIcon
        ? <ToolIcon icon={itemToolIcon} className="h-3.5 w-3.5" />
        : getSketchHistoryIcon(item.kind),
      menuItems,
      ariaLabel: `Select ${item.label}. Double-click to move sketch history cursor.`,
      title: `${description}${isAfterCursor ? '. After current cursor' : ''}. Double-click to move sketch history cursor.`,
      isSelected,
      isAllowed,
      isAfterCursor,
      isAtCursor,
      dataDeleteSupported: item.target ? 'true' : undefined,
      onClick: () => {
        if (!isAllowed || !item.target) {
          return
        }

        onSelectTarget(item.target)
      },
      onDoubleClick: () => onCursorRequested?.(getSketchHistoryCursorForIndex(items, index)),
    }
  }), [
    cursorIndex,
    dispatch,
    items,
    onCursorRequested,
    onSelectTarget,
    selection,
    selectionCatalog,
    selectionFilter,
    session.fullDefinition,
    visibleSelection,
  ])

  return (
    <HistoryTimelineSurface
      ariaLabel="Sketch history"
      dataHistoryKind="sketch"
      emptyLabel="Empty sketch history"
      items={visualItems}
      cursorIndex={cursorIndex}
      cursorDisabled={!onCursorRequested}
      onCursorRequested={(index) => onCursorRequested?.(getSketchHistoryCursorForIndex(items, index))}
      getCursorAriaLabel={(index) => {
        if (items.length === 0) {
          return 'Timeline cursor at empty sketch history'
        }

        if (index < 0) {
          return 'Timeline cursor before first sketch history item'
        }

        const item = items[index]
        return item
          ? `Timeline cursor at ${item.label}`
          : 'Timeline cursor before first sketch history item'
      }}
      itemRefs={itemRefs}
      trackRef={trackRef}
    />
  )
}
