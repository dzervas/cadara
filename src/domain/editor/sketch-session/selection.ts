import type {
  SketchAuthoringOperationId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchAuthoringOperation } from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import { collectActiveReferenceImageOperations } from "@/domain/reference-image/operations";
import type {
  SketchHistoryCursor,
  SketchHistoryItem,
  SketchSessionState,
} from "./types";

export function getSelectedSketchGeometryIds(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  const sketchId = session.sketchId ?? ("sketch_draft" as const);
  const selectedPointIds = new Set<SketchPointId>();
  const selectedEntityIds = new Set<SketchEntityId>();

  for (const target of targets) {
    if (target.kind === "sketchPoint" && target.sketchId === sketchId) {
      selectedPointIds.add(target.pointId);
    }

    if (target.kind === "sketchEntity" && target.sketchId === sketchId) {
      selectedEntityIds.add(target.entityId);
    }
  }

  const existingPointIds = new Set(session.definition.pointIds);
  const existingEntityIds = new Set(session.definition.entityIds);
  const pointIds = new Set(
    [...selectedPointIds].filter((pointId) => existingPointIds.has(pointId)),
  );
  const entityIds = new Set(
    [...selectedEntityIds].filter((entityId) =>
      existingEntityIds.has(entityId),
    ),
  );

  if (pointIds.size === 0 && entityIds.size === 0) {
    return null;
  }

  return { pointIds, entityIds };
}

export function getSelectedReferenceImageOperationIds(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  const sketchId = session.sketchId ?? ("sketch_draft" as const);
  const activeOperationIds = new Set(
    collectActiveReferenceImageOperations(session.definition).map(
      ({ operation }) => operation.operationId,
    ),
  );

  return targets.flatMap((target) =>
    target.kind === "sketchOperation" &&
    target.sketchId === sketchId &&
    activeOperationIds.has(target.operationId)
      ? [target.operationId]
      : [],
  );
}

export function getOperationOwnedStateTargetIds(
  operation: SketchAuthoringOperation,
) {
  return [
    ...(operation.targets.edited ?? []),
    ...(operation.targets.removed ?? []),
  ].flatMap((target) =>
    target.kind === "operation" ? [target.operationId] : [],
  );
}

export function pruneDirectOperationDependents(
  operations: readonly SketchAuthoringOperation[],
  removedOperationIds: ReadonlySet<SketchAuthoringOperationId>,
) {
  const pendingRemovedIds = new Set(removedOperationIds);
  let remainingOperations = [...operations];
  let pruned = true;

  while (pruned) {
    pruned = false;
    remainingOperations = remainingOperations.filter((operation) => {
      const operationTargetIds = getOperationOwnedStateTargetIds(operation);
      if (
        operationTargetIds.length === 0 ||
        !operationTargetIds.every((targetOperationId) =>
          pendingRemovedIds.has(targetOperationId),
        )
      ) {
        return true;
      }

      pendingRemovedIds.add(operation.operationId);
      pruned = true;
      return false;
    });
  }

  return remainingOperations;
}

export function repairSketchHistoryCursorAfterOperationRemoval(
  previousItems: readonly SketchHistoryItem[],
  previousCursor: SketchHistoryCursor,
  remainingOperationIds: ReadonlySet<SketchAuthoringOperationId>,
): SketchHistoryCursor {
  if (previousCursor.kind === "empty") {
    return previousCursor;
  }

  const currentIndex = previousItems.findIndex(
    (item) => item.id === previousCursor.itemId,
  );
  if (currentIndex < 0) {
    return { kind: "empty" };
  }

  for (let index = currentIndex; index >= 0; index -= 1) {
    const item = previousItems[index];
    if (!item) {
      continue;
    }

    if (item.kind !== "operation" || remainingOperationIds.has(item.id)) {
      return { kind: "item", itemId: item.id };
    }
  }

  return { kind: "empty" };
}
