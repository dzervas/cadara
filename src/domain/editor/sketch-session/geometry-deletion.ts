import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchPointId } from "@/contracts/shared/ids";
import type { SketchSessionState } from "./types";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  getSelectedReferenceImageOperationIds,
  getSelectedSketchGeometryIds,
} from "./selection";
import {
  constraintReferencesSketchGeometry,
  dimensionReferencesSketchGeometry,
  getEntityPointIds,
} from "@/core/sketch-editing/definition-references";
import { rebuildSessionForDefinition } from "./definition-authoring";
import { cloneDefinition } from "./session-definition";
import { collectActiveReferenceImageOperations } from "@/domain/reference-image/operations";
import { updateReferenceImageOperationStates } from "./references";

/**
 * Explicit rejection of deleting a derived offset shell on its own; T17c
 * ([TECH] T17-5): the text names the removal that exists.
 */
export const DERIVED_SHELL_DELETE_MESSAGE =
  "An offset spline curve is part of its offset and can't be deleted on its own. To remove the whole offset, select it, then Offset → Remove offset.";

/** Explicit rejection of deleting a derived offset shell's driven end point on its own (T17c: names the removal). */
export const DERIVED_SHELL_POINT_DELETE_MESSAGE =
  "An offset spline curve's end point is part of its offset and can't be deleted on its own. To remove the whole offset, select it, then Offset → Remove offset.";

/**
 * The driven terminal points of every derived offset shell. No entity
 * references them (a shell owns no points), so the point sweep must treat
 * them as referenced by their relationship ([TECH] G18).
 */
function shellTerminalPointIds(definition: SketchDefinition) {
  return new Set<SketchPointId>(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset"
        ? relationship.piecewiseCubicOutputs.flatMap((output) => [
            output.startPointId,
            output.endPointId,
          ])
        : [],
    ),
  );
}

export function deleteSelectedSketchGeometry(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
): SketchSessionState {
  const selectedReferenceImageOperationIds =
    getSelectedReferenceImageOperationIds(session, targets);
  let nextSession = session;

  if (selectedReferenceImageOperationIds.length > 0) {
    const removedImages =
      nextSession.definition.referenceImages?.filter((record) =>
        selectedReferenceImageOperationIds.includes(record.operationId),
      ) ?? [];
    const ownedPointIds = new Set(
      removedImages.flatMap((record) => record.ownedPointIds),
    );
    const ownedEntityIds = new Set(
      removedImages.flatMap((record) => record.ownedEntityIds),
    );
    const points = nextSession.definition.points.filter(
      (point) => !ownedPointIds.has(point.pointId),
    );
    const entities = nextSession.definition.entities.filter(
      (entity) => !ownedEntityIds.has(entity.entityId),
    );
    const constraints = nextSession.definition.constraints.filter(
      (constraint) =>
        !constraintReferencesSketchGeometry(
          constraint,
          ownedPointIds,
          ownedEntityIds,
        ),
    );
    const dimensions = nextSession.definition.dimensions.filter(
      (dimension) =>
        !dimensionReferencesSketchGeometry(
          dimension,
          ownedPointIds,
          ownedEntityIds,
        ),
    );
    const definition = {
      ...nextSession.definition,
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
      dimensions,
      referenceImages: nextSession.definition.referenceImages?.filter(
        (record) =>
          !selectedReferenceImageOperationIds.includes(record.operationId),
      ),
    };
    nextSession = rebuildSessionForDefinition(nextSession, { definition });
    nextSession = {
      ...nextSession,
      activeTool: null,
      status: "idle",
      constructionTargetPicking: false,
      referenceTargetPicking: false,
      pointerDownPoint: null,
      livePoint: null,
      toolPlacedPoints: [],
      toolSettings: {},
      toolPresentation: null,
      constraintAuthoring: null,
      activeEditTool: null,
      activeStyleFocus: null,
      activeInference: null,
      toolPlacements: [],
      toolStartPointId: null,
      toolTangentSourceEntityId: null,
      toolChain: null,
      sequence: nextSession.sequence + 1,
    };
  }

  const selected = getSelectedSketchGeometryIds(nextSession, targets);

  if (!selected) {
    return nextSession;
  }

  // T08b-g plan §2.6: a derived offset shell lives and dies with its offset
  // relationship; deleting it alone is rejected before any mutation.
  if (
    nextSession.definition.entities.some(
      (entity) =>
        entity.kind === "derivedPiecewiseCubic" &&
        selected.entityIds.has(entity.entityId),
    )
  ) {
    return {
      ...nextSession,
      validationMessage: DERIVED_SHELL_DELETE_MESSAGE,
    };
  }
  const relationshipOwnedPointIds = shellTerminalPointIds(
    nextSession.definition,
  );
  if ([...selected.pointIds].some((id) => relationshipOwnedPointIds.has(id))) {
    return {
      ...nextSession,
      validationMessage: DERIVED_SHELL_POINT_DELETE_MESSAGE,
    };
  }

  const beforeDefinition = cloneDefinition(nextSession.definition);
  const deletedEntityIds = new Set(selected.entityIds);
  for (const entity of beforeDefinition.entities) {
    if (
      getEntityPointIds(entity).some((pointId) =>
        selected.pointIds.has(pointId),
      )
    ) {
      deletedEntityIds.add(entity.entityId);
    }
  }

  const remainingEntities = beforeDefinition.entities.filter(
    (entity) => !deletedEntityIds.has(entity.entityId),
  );
  const remainingEntityPointIds = new Set([
    ...remainingEntities.flatMap((entity) => getEntityPointIds(entity)),
    ...relationshipOwnedPointIds,
  ]);
  const deletedPointIds = new Set<SketchPointId>(
    beforeDefinition.pointIds.filter(
      (pointId) =>
        selected.pointIds.has(pointId) || !remainingEntityPointIds.has(pointId),
    ),
  );
  const points = beforeDefinition.points.filter(
    (point) => !deletedPointIds.has(point.pointId),
  );
  const constraints = beforeDefinition.constraints.filter(
    (constraint) =>
      !constraintReferencesSketchGeometry(
        constraint,
        deletedPointIds,
        deletedEntityIds,
      ),
  );
  const dimensions = beforeDefinition.dimensions.filter(
    (dimension) =>
      !dimensionReferencesSketchGeometry(
        dimension,
        deletedPointIds,
        deletedEntityIds,
      ),
  );
  const afterDefinition: SketchDefinition = {
    ...beforeDefinition,
    pointIds: points.map((point) => point.pointId),
    points,
    entityIds: remainingEntities.map((entity) => entity.entityId),
    entities: remainingEntities,
    constraintIds: constraints.map((constraint) => constraint.constraintId),
    constraints,
    dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
    dimensions,
    referenceImages: beforeDefinition.referenceImages?.map((record) => ({
      ...record,
      ownedPointIds: record.ownedPointIds.filter(
        (pointId) => !deletedPointIds.has(pointId),
      ),
      ownedEntityIds: record.ownedEntityIds.filter(
        (entityId) => !deletedEntityIds.has(entityId),
      ),
    })),
  };

  let rebuiltSession = rebuildSessionForDefinition(nextSession, {
    definition: afterDefinition,
  });

  const referenceImageBindingUpdates = collectActiveReferenceImageOperations(
    rebuiltSession.definition,
  )
    .map(({ operation: activeOperation, state }) => {
      const calibration = state.calibration;
      if (!calibration) {
        return null;
      }

      const anchors = calibration.anchors.filter(
        (anchor) => !deletedPointIds.has(anchor.pointId as SketchPointId),
      );
      return anchors.length === calibration.anchors.length
        ? null
        : {
            operationId: activeOperation.operationId,
            label: activeOperation.label,
            state: {
              ...state,
              calibration: {
                scaleMode: calibration.scaleMode,
                showExportedAnchorsInSketch:
                  calibration.showExportedAnchorsInSketch,
                anchors,
              },
            },
          };
    })
    .filter((update): update is NonNullable<typeof update> => update !== null);

  if (referenceImageBindingUpdates.length > 0) {
    rebuiltSession = updateReferenceImageOperationStates({
      session: rebuiltSession,
      updates: referenceImageBindingUpdates,
    });
  }

  return {
    ...rebuiltSession,
    activeTool: null,
    status: "idle",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeEditTool: null,
    activeStyleFocus: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
    toolChain: null,
    sequence: rebuiltSession.sequence,
  };
}
