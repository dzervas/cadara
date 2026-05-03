import type { WorkspaceSnapshot } from '@/contracts/modeling/schema'
import type { EditorEvent } from '@/domain/editor/state-machine'
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
  selectionFilterAllowsTarget,
  type PrimitiveRef,
  type SelectionFilter,
  type SelectionTargetCatalog,
} from '@/core/editor/schema'

export function resolveCadaraDebugTarget(
  snapshot: WorkspaceSnapshot | null,
  targetId: string,
): PrimitiveRef | null {
  const entities = snapshot?.presentation.entities ?? []

  return entities.find((entity) => {
    const target = entity.target

    return getPrimitiveRefLabel(target) === targetId || getPrimitiveRefKey(target) === targetId
  })?.target ?? null
}

export function selectCadaraDebugTarget(input: {
  targetId: string
  snapshot: WorkspaceSnapshot | null
  selection: PrimitiveRef[]
  selectionFilter: SelectionFilter | null
  selectionCatalog: SelectionTargetCatalog | null
  dispatch: (event: EditorEvent) => void
}) {
  const target = resolveCadaraDebugTarget(input.snapshot, input.targetId)

  if (
    !target
    || !selectionFilterAllowsTarget(
      input.selectionFilter,
      input.selection,
      target,
      input.selectionCatalog,
    )
  ) {
    return false
  }

  input.dispatch({ type: 'viewport.selectionRequested', target })
  return true
}
