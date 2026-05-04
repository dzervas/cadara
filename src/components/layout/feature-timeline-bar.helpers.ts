import type { DocumentFeatureCursor, DocumentHistoryItemRecord, DocumentHistoryOrderEntry } from '@/contracts/modeling/schema'
import {
  createDocumentHistoryOrder,
  getDocumentHistoryCursorIndex,
  getDocumentHistoryOrderEntryKey,
  reorderDocumentHistoryOrder,
} from '@/domain/modeling/document-history'

export const TIMELINE_CURSOR_GLYPH = '↕'

export type DocumentHistoryMenuEntryDescriptor =
  | {
      kind: 'item'
      id: 'edit' | 'rename' | 'change-sketch-plane' | 'suppress' | 'roll-history-here' | 'roll-to-end' | 'delete'
      label: 'Edit' | 'Rename' | 'Change Sketch Plane' | 'Suppress' | 'Unsuppress' | 'Roll History Here' | 'Roll To End' | 'Delete'
      disabled?: boolean
    }
  | {
      kind: 'divider'
      id: 'destructive-divider'
    }

export function getTimelineCursorIndex(
  items: readonly DocumentHistoryItemRecord[],
  cursor: DocumentFeatureCursor,
) {
  return getDocumentHistoryCursorIndex(items, cursor)
}

export function getNearestTimelineAnchorIndex(
  anchorCenterXs: readonly number[],
  pointerClientX: number,
) {
  if (anchorCenterXs.length === 0) {
    return -1
  }

  let nearestIndex = 0
  let nearestDistance = Math.abs(anchorCenterXs[0]! - pointerClientX)

  for (let index = 1; index < anchorCenterXs.length; index += 1) {
    const distance = Math.abs(anchorCenterXs[index]! - pointerClientX)
    if (distance < nearestDistance) {
      nearestIndex = index
      nearestDistance = distance
    }
  }

  return nearestIndex - 1
}

export function getTimelineCursorAriaLabel(
  items: readonly DocumentHistoryItemRecord[],
  cursorIndex: number,
) {
  if (items.length === 0) {
    return 'Timeline cursor at empty document'
  }

  if (cursorIndex < 0) {
    return 'Timeline cursor before first history item'
  }

  const item = items[cursorIndex]
  return item
    ? `Timeline cursor after ${item.label}`
    : 'Timeline cursor before first history item'
}

export function isDocumentHistoryCursorAtTail(
  items: readonly DocumentHistoryItemRecord[],
  cursorIndex: number,
) {
  return items.length > 0 && cursorIndex === items.length - 1
}

export function isDocumentHistoryCursorIndexAtTail(
  historyLength: number,
  cursorIndex: number,
) {
  return historyLength > 0 && cursorIndex === historyLength - 1
}

export function getDocumentHistoryMenuEntryDescriptors(input: {
  item: DocumentHistoryItemRecord
  cursorDisabled: boolean
  cursorIndex: number
  historyLength: number
  canChangeSketchPlane?: boolean
}): DocumentHistoryMenuEntryDescriptor[] {
  const { item, cursorDisabled, cursorIndex, historyLength, canChangeSketchPlane = false } = input
  const rollToEndDisabled = cursorDisabled || isDocumentHistoryCursorIndexAtTail(historyLength, cursorIndex)

  return [
    {
      kind: 'item',
      id: 'edit',
      label: 'Edit',
    },
    {
      kind: 'item',
      id: 'rename',
      label: 'Rename',
    },
    ...(item.kind === 'sketch' && canChangeSketchPlane
      ? [{
          kind: 'item' as const,
          id: 'change-sketch-plane' as const,
          label: 'Change Sketch Plane' as const,
        }]
      : []),
    ...(item.kind === 'feature'
      ? [{
          kind: 'item' as const,
          id: 'suppress' as const,
          label: item.suppressed ? 'Unsuppress' as const : 'Suppress' as const,
        }]
      : []),
    {
      kind: 'item',
      id: 'roll-history-here',
      label: 'Roll History Here',
      disabled: cursorDisabled,
    },
    {
      kind: 'item',
      id: 'roll-to-end',
      label: 'Roll To End',
      disabled: rollToEndDisabled,
    },
    {
      kind: 'divider',
      id: 'destructive-divider',
    },
    {
      kind: 'item',
      id: 'delete',
      label: 'Delete',
    },
  ]
}

export function getHistoryItemOrderEntry(item: DocumentHistoryItemRecord): DocumentHistoryOrderEntry {
  return item.kind === 'sketch'
    ? { kind: 'sketch', sketchId: item.sketchId }
    : { kind: 'feature', featureId: item.featureId }
}

function historyOrdersEqual(
  left: readonly DocumentHistoryOrderEntry[],
  right: readonly DocumentHistoryOrderEntry[],
) {
  return left.length === right.length
    && left.every((entry, index) => getDocumentHistoryOrderEntryKey(entry) === getDocumentHistoryOrderEntryKey(right[index]!))
}

export function resolveTimelineReorderDrop(
  items: readonly DocumentHistoryItemRecord[],
  movedItem: DocumentHistoryItemRecord,
  dropCursorIndex: number,
): { item: DocumentHistoryOrderEntry; beforeItem: DocumentHistoryOrderEntry | null } | null {
  const item = getHistoryItemOrderEntry(movedItem)
  const beforeItemRecord = items[dropCursorIndex + 1] ?? null
  const beforeItem = beforeItemRecord ? getHistoryItemOrderEntry(beforeItemRecord) : null
  if (beforeItem && getDocumentHistoryOrderEntryKey(beforeItem) === getDocumentHistoryOrderEntryKey(item)) {
    return null
  }

  const currentOrder = createDocumentHistoryOrder(items)
  const nextOrder = reorderDocumentHistoryOrder(currentOrder, item, beforeItem)

  return nextOrder && !historyOrdersEqual(currentOrder, nextOrder)
    ? { item, beforeItem }
    : null
}
