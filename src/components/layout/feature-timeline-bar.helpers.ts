import type { DocumentFeatureCursor, DocumentHistoryItemRecord } from '@/contracts/modeling/schema'
import {
  getDocumentHistoryCursorIndex,
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
