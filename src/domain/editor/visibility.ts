import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import { getPrimitiveRefKey, type PrimitiveRef } from "@/core/editor/schema";
import { OCC_KERNEL_CONSTRUCTION_IDS } from "@/domain/modeling/opencascade-kernel-seed";

export interface WorkbenchVisibilityState {
  autoHiddenSketchTargetKeys: Record<string, boolean>;
  sketchEditingOriginPlaneTargetKeys: Record<string, boolean>;
  effectiveHiddenTargetKeys: Record<string, boolean>;
}

export interface ToggleWorkbenchTargetVisibilityInput {
  target: PrimitiveRef;
  explicitHiddenTargetKeys: Record<string, boolean>;
  explicitlyShownAutoHiddenTargetKeys: Record<string, boolean>;
  effectiveHiddenTargetKeys: Record<string, boolean>;
  autoHiddenSketchTargetKeys: Record<string, boolean>;
}

export interface ToggleWorkbenchTargetVisibilityResult {
  explicitHiddenTargetKeys: Record<string, boolean>;
  explicitlyShownAutoHiddenTargetKeys: Record<string, boolean>;
}

export function getAutoHiddenSketchTargetKeys(
  snapshot: WorkspaceSnapshot | null,
): Record<string, boolean> {
  if (!snapshot) {
    return {};
  }

  return Object.fromEntries(
    snapshot.presentation.entities
      .filter(
        (entity) =>
          entity.target.kind === "sketch" &&
          entity.consumedByFeatureIds.length > 0,
      )
      .map((entity) => [getPrimitiveRefKey(entity.target), true]),
  );
}

export function getSketchEditingOriginPlaneTargetKeys(
  isSketchEditing: boolean,
): Record<string, boolean> {
  if (!isSketchEditing) {
    return {};
  }

  return Object.fromEntries(
    Object.values(OCC_KERNEL_CONSTRUCTION_IDS).map((constructionId) => [
      getPrimitiveRefKey({ kind: "construction", constructionId }),
      true,
    ]),
  );
}

export function reconcileVisibilityIntentKeys(
  targetKeys: Record<string, boolean>,
  allowedTargetKeys: ReadonlySet<string>,
) {
  return Object.fromEntries(
    Object.entries(targetKeys).filter(
      ([key, enabled]) => enabled && allowedTargetKeys.has(key),
    ),
  );
}

export function getWorkbenchVisibilityState(input: {
  snapshot: WorkspaceSnapshot | null;
  explicitHiddenTargetKeys: Record<string, boolean>;
  explicitlyShownAutoHiddenTargetKeys: Record<string, boolean>;
  isSketchEditing?: boolean;
}): WorkbenchVisibilityState {
  const autoHiddenSketchTargetKeys = getAutoHiddenSketchTargetKeys(
    input.snapshot,
  );
  const sketchEditingOriginPlaneTargetKeys =
    getSketchEditingOriginPlaneTargetKeys(input.isSketchEditing === true);
  const effectiveHiddenTargetKeys = { ...input.explicitHiddenTargetKeys };

  for (const key of Object.keys({
    ...autoHiddenSketchTargetKeys,
    ...sketchEditingOriginPlaneTargetKeys,
  })) {
    if (input.explicitlyShownAutoHiddenTargetKeys[key] === true) {
      continue;
    }

    effectiveHiddenTargetKeys[key] = true;
  }

  return {
    autoHiddenSketchTargetKeys,
    sketchEditingOriginPlaneTargetKeys,
    effectiveHiddenTargetKeys,
  };
}

export function toggleWorkbenchTargetVisibility(
  input: ToggleWorkbenchTargetVisibilityInput,
): ToggleWorkbenchTargetVisibilityResult {
  const targetKey = getPrimitiveRefKey(input.target);
  const isAutoHiddenSketch =
    input.autoHiddenSketchTargetKeys[targetKey] === true;
  const isEffectivelyHidden =
    input.effectiveHiddenTargetKeys[targetKey] === true;
  const nextExplicitHiddenTargetKeys = { ...input.explicitHiddenTargetKeys };
  const nextShownAutoHiddenTargetKeys = {
    ...input.explicitlyShownAutoHiddenTargetKeys,
  };

  if (isAutoHiddenSketch) {
    delete nextExplicitHiddenTargetKeys[targetKey];

    if (isEffectivelyHidden) {
      nextShownAutoHiddenTargetKeys[targetKey] = true;
    } else {
      delete nextShownAutoHiddenTargetKeys[targetKey];
    }

    return {
      explicitHiddenTargetKeys: nextExplicitHiddenTargetKeys,
      explicitlyShownAutoHiddenTargetKeys: nextShownAutoHiddenTargetKeys,
    };
  }

  delete nextShownAutoHiddenTargetKeys[targetKey];

  if (isEffectivelyHidden) {
    delete nextExplicitHiddenTargetKeys[targetKey];
  } else {
    nextExplicitHiddenTargetKeys[targetKey] = true;
  }

  return {
    explicitHiddenTargetKeys: nextExplicitHiddenTargetKeys,
    explicitlyShownAutoHiddenTargetKeys: nextShownAutoHiddenTargetKeys,
  };
}
