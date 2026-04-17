import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { PrimitiveRef } from '@/domain/editor/schema'

export interface ObjectExportModalState {
  target: PrimitiveRef
  label: string
  baseRevisionId: DocumentSnapshot['document']['revisionId']
}

export function createObjectExportModalState(
  snapshot: DocumentSnapshot | null,
  target: PrimitiveRef,
  label: string,
): ObjectExportModalState | null {
  if (!snapshot) {
    return null
  }

  return {
    target,
    label,
    baseRevisionId: snapshot.document.revisionId,
  }
}

export function createObjectDeletePlaceholderMessage(label: string) {
  return `Delete for ${label} is not implemented yet.`
}
