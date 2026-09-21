import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";

import type { PrimitiveRef } from "@/core/editor/schema";
import { collectActiveReferenceImageOperations } from "@/domain/reference-image/operations";
import type { SketchSessionState } from "./types";

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
