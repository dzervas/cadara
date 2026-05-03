import type { DocumentHistoryOrderEntry } from '@/contracts/modeling/schema'
import {
  getDocumentHistoryOrderEntryKey,
  reorderDocumentHistoryOrder,
} from '@/domain/modeling/document-history'

export interface DocumentHistoryOrderRestoreMove {
  item: DocumentHistoryOrderEntry
  beforeItem: DocumentHistoryOrderEntry | null
}

export function documentHistoryOrdersEqual(
  left: readonly DocumentHistoryOrderEntry[],
  right: readonly DocumentHistoryOrderEntry[],
) {
  return left.length === right.length
    && left.every((entry, index) => getDocumentHistoryOrderEntryKey(entry) === getDocumentHistoryOrderEntryKey(right[index]!))
}

export function getDocumentHistoryOrderRestoreMoves(
  currentOrder: readonly DocumentHistoryOrderEntry[],
  nextOrder: readonly DocumentHistoryOrderEntry[],
): DocumentHistoryOrderRestoreMove[] | null {
  if (documentHistoryOrdersEqual(currentOrder, nextOrder)) {
    return []
  }

  for (let index = 0; index < nextOrder.length; index += 1) {
    const item = nextOrder[index]!
    const beforeItem = nextOrder[index + 1] ?? null
    const updatedOrder = reorderDocumentHistoryOrder(currentOrder, item, beforeItem)
    if (updatedOrder && documentHistoryOrdersEqual(updatedOrder, nextOrder)) {
      return [{ item, beforeItem }]
    }
  }

  return null
}
