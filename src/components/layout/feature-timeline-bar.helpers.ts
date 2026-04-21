import type { DocumentFeatureCursor, DocumentHistoryItemRecord, DocumentHistoryOrderEntry } from '@/contracts/modeling/schema'
import {
  createDocumentHistoryOrder,
  getDocumentHistoryCursorIndex,
  getDocumentHistoryOrderEntryKey,
  reorderDocumentHistoryOrder,
} from '@/domain/modeling/document-history'

export const TIMELINE_CURSOR_GLYPH = '↕'

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
