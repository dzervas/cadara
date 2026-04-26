import type { DocumentSnapshot } from '@/contracts/modeling/schema'
import { getPrimitiveRefKey, type PrimitiveRef } from '@/domain/editor/schema'

export interface WorkbenchVisibilityState {
  autoHiddenSketchTargetKeys: Record<string, boolean>
  effectiveHiddenTargetKeys: Record<string, boolean>
}

export interface ToggleWorkbenchTargetVisibilityInput {
  target: PrimitiveRef
  explicitHiddenTargetKeys: Record<string, boolean>
  explicitlyShownAutoHiddenTargetKeys: Record<string, boolean>
  effectiveHiddenTargetKeys: Record<string, boolean>
  autoHiddenSketchTargetKeys: Record<string, boolean>
}

export interface ToggleWorkbenchTargetVisibilityResult {
  explicitHiddenTargetKeys: Record<string, boolean>
  explicitlyShownAutoHiddenTargetKeys: Record<string, boolean>
}

export function getAutoHiddenSketchTargetKeys(snapshot: DocumentSnapshot | null): Record<string, boolean> {
  if (!snapshot) {
    return {}
  }

  return Object.fromEntries(
    snapshot.presentation.entities
      .filter((entity) => entity.target.kind === 'sketch' && entity.consumedByFeatureIds.length > 0)
      .map((entity) => [getPrimitiveRefKey(entity.target), true]),
  )
}

export function reconcileVisibilityIntentKeys(
  targetKeys: Record<string, boolean>,
  allowedTargetKeys: ReadonlySet<string>,
) {
  return Object.fromEntries(
    Object.entries(targetKeys).filter(([key, enabled]) => enabled && allowedTargetKeys.has(key)),
  )
}

export function getWorkbenchVisibilityState(input: {
  snapshot: DocumentSnapshot | null
  explicitHiddenTargetKeys: Record<string, boolean>
  explicitlyShownAutoHiddenTargetKeys: Record<string, boolean>
}): WorkbenchVisibilityState {
  const autoHiddenSketchTargetKeys = getAutoHiddenSketchTargetKeys(input.snapshot)
  const effectiveHiddenTargetKeys = { ...input.explicitHiddenTargetKeys }

  for (const key of Object.keys(autoHiddenSketchTargetKeys)) {
    if (input.explicitlyShownAutoHiddenTargetKeys[key] === true) {
      continue
    }

    effectiveHiddenTargetKeys[key] = true
  }

  return {
    autoHiddenSketchTargetKeys,
    effectiveHiddenTargetKeys,
  }
}

export function toggleWorkbenchTargetVisibility(
  input: ToggleWorkbenchTargetVisibilityInput,
): ToggleWorkbenchTargetVisibilityResult {
  const targetKey = getPrimitiveRefKey(input.target)
  const isAutoHiddenSketch = input.autoHiddenSketchTargetKeys[targetKey] === true
  const isEffectivelyHidden = input.effectiveHiddenTargetKeys[targetKey] === true
  const nextExplicitHiddenTargetKeys = { ...input.explicitHiddenTargetKeys }
  const nextShownAutoHiddenTargetKeys = { ...input.explicitlyShownAutoHiddenTargetKeys }

  if (isAutoHiddenSketch) {
    delete nextExplicitHiddenTargetKeys[targetKey]

    if (isEffectivelyHidden) {
      nextShownAutoHiddenTargetKeys[targetKey] = true
    } else {
      delete nextShownAutoHiddenTargetKeys[targetKey]
    }

    return {
      explicitHiddenTargetKeys: nextExplicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys: nextShownAutoHiddenTargetKeys,
    }
  }

  delete nextShownAutoHiddenTargetKeys[targetKey]

  if (isEffectivelyHidden) {
    delete nextExplicitHiddenTargetKeys[targetKey]
  } else {
    nextExplicitHiddenTargetKeys[targetKey] = true
  }

  return {
    explicitHiddenTargetKeys: nextExplicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys: nextShownAutoHiddenTargetKeys,
  }
}
