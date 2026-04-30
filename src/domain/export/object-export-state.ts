import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { DurableRef } from '@/contracts/shared/references'
import { isDurablePrimitiveRef, type PrimitiveRef } from '@/core/editor/schema'

export interface ObjectExportModalState {
  target: DurableRef
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

  if (!isDurablePrimitiveRef(target)) {
    return null
  }

  return {
    target,
    label,
    baseRevisionId: snapshot.document.revisionId,
  }
}
