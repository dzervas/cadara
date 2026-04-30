import type { WorkbenchStateDebuggerModel } from '@/components/layout/workbench-state-debugger'
import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import type { EditorEvent } from '@/domain/editor/state-machine'
import {
  getPrimitiveRefKey,
  getPrimitiveRefLabel,
  selectionFilterAllowsTarget,
  type PrimitiveRef,
  type SelectionFilter,
  type SelectionTargetCatalog,
} from '@/core/editor/schema'

interface CadTestStateWindow {
  __cadTestState?: WorkbenchStateDebuggerModel
}

export function syncCadTestState(
  state: WorkbenchStateDebuggerModel,
  targetWindow: CadTestStateWindow = window,
) {
  targetWindow.__cadTestState = state
}

export function resolveCadTestTarget(
  snapshot: DocumentSnapshot | null,
  targetId: string,
): PrimitiveRef | null {
  const entities = snapshot?.presentation.entities ?? []

  return entities.find((entity) => {
    const target = entity.target

    return getPrimitiveRefLabel(target) === targetId || getPrimitiveRefKey(target) === targetId
  })?.target ?? null
}

export function dispatchCadTestSelection(input: {
  targetId: string
  snapshot: DocumentSnapshot | null
  selection: PrimitiveRef[]
  selectionFilter: SelectionFilter | null
  selectionCatalog: SelectionTargetCatalog | null
  dispatch: (event: EditorEvent) => void
}) {
  const target = resolveCadTestTarget(input.snapshot, input.targetId)

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
