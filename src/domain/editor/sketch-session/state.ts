import type {
  SketchPlaneKey,
  SketchPoint,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  SketchPlaneDefinition,
  SketchPlaneSupportRef,
} from "@/contracts/shared/sketch-plane";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchAuthoringOperation,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { type PrimitiveRef } from "@/core/editor/schema";
import {
  createStandardPlaneDefinition,
  deriveStandardPlaneKeyFromConstructionId,
} from "@/domain/modeling/opencascade-kernel-seed";
import { buildReferenceImageAnchorProjectedReferences } from "@/domain/reference-image-calibration/export/references";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import { mapSketchPointToWorkspaceWorld } from "@/core/workspace/sketch-plane-mapping";
import type {
  SketchConstraintDisplayState,
  SketchHistoryCursor,
  SketchSessionState,
} from "./types";
import {
  cloneDefinition,
  createEmptyDefinition,
  createSketchConstraintRef,
  createSketchDimensionRef,
  createSketchEntityRef,
  createSketchOperationRef,
  createSketchPointRef,
  filterSketchDefinitionThroughCursor,
  getEntityPointIds,
  getHistorySequence,
  getNextDefinitionSequence,
  getSessionSketchId,
  getSketchHistoryOperationForCursor,
  mapDefinitionEntityToDraftEntity,
  rebuildSessionForDefinition,
  sketchHistoryCursorsEqual,
} from "./internals";
import {
  buildCommitRequest,
  createTailSketchHistoryCursor,
  getSketchHistoryCursorForIndex,
  getSketchHistoryCursorIndex,
  getSketchHistoryItems,
} from "./history";
import {
  getSelectedReferenceImageOperationIds,
  getSelectedSketchGeometryIds,
} from "./selection";

export function derivePlaneKeyFromTarget(
  target: SketchPlaneSupportRef,
): SketchPlaneKey | null {
  if (target.kind !== "construction") {
    return null;
  }

  return deriveStandardPlaneKeyFromConstructionId(target.constructionId);
}

export function normalizeSketchConstraintDisplayState(
  status: SolvedSketchSnapshot["status"],
  affectedTargetCount: number,
): SketchConstraintDisplayState {
  if (
    status.constraintState === "overConstrained" ||
    status.constraintState === "inconsistent" ||
    (status.solveState !== "solved" && affectedTargetCount > 0)
  ) {
    return "overconstrained";
  }

  if (status.constraintState === "wellConstrained") {
    return "constrained";
  }

  return "underconstrained";
}

export function getAuthoringOperationHistoryTarget(
  sketchId: SketchId,
  operation: SketchAuthoringOperation,
): PrimitiveRef | null {
  if (operation.kind === "referenceImage") {
    return createSketchOperationRef(sketchId, operation.operationId);
  }

  const target = [
    ...(operation.targets.created ?? []),
    ...(operation.targets.edited ?? []),
    ...(operation.targets.removed ?? []),
  ].find(
    (entry) =>
      entry.kind === "operation" ||
      entry.kind === "entity" ||
      entry.kind === "point" ||
      entry.kind === "constraint" ||
      entry.kind === "dimension",
  );

  if (!target) {
    return null;
  }

  switch (target.kind) {
    case "operation":
      return createSketchOperationRef(sketchId, target.operationId);
    case "point":
      return createSketchPointRef(sketchId, target.pointId);
    case "entity":
      return createSketchEntityRef(sketchId, target.entityId);
    case "constraint":
      return createSketchConstraintRef(sketchId, target.constraintId);
    case "dimension":
      return createSketchDimensionRef(sketchId, target.dimensionId);
  }
}

export function getPreviousSketchHistoryCursor(
  session: SketchSessionState,
): SketchHistoryCursor | null {
  const operation = getSketchHistoryOperationForCursor(
    session,
    session.historyCursor,
  );
  if (operation) {
    return operation.beforeCursor;
  }

  const items = getSketchHistoryItems(session.fullDefinition);
  const cursorIndex = getSketchHistoryCursorIndex(items, session.historyCursor);

  if (session.historyCursor.kind !== "empty" && cursorIndex < 0) {
    return null;
  }

  if (cursorIndex <= -1) {
    return null;
  }

  const currentSequence = getHistorySequence(items[cursorIndex]?.id ?? "");
  let previousIndex = cursorIndex - 1;
  while (
    previousIndex >= 0 &&
    getHistorySequence(items[previousIndex]?.id ?? "") === currentSequence
  ) {
    previousIndex -= 1;
  }

  return getSketchHistoryCursorForIndex(items, previousIndex);
}

export function getNextSketchHistoryCursor(
  session: SketchSessionState,
): SketchHistoryCursor | null {
  const operation = session.historyOperations.find((entry) =>
    sketchHistoryCursorsEqual(entry.beforeCursor, session.historyCursor),
  );

  if (operation) {
    return { kind: "item", itemId: operation.itemId };
  }

  const items = getSketchHistoryItems(session.fullDefinition);
  const cursorIndex = getSketchHistoryCursorIndex(items, session.historyCursor);

  if (session.historyCursor.kind !== "empty" && cursorIndex < 0) {
    return null;
  }

  const nextIndex = cursorIndex + 1;
  if (nextIndex >= items.length) {
    return null;
  }

  const nextSequence = getHistorySequence(items[nextIndex]?.id ?? "");
  let sequenceTailIndex = nextIndex;
  while (
    sequenceTailIndex + 1 < items.length &&
    getHistorySequence(items[sequenceTailIndex + 1]?.id ?? "") === nextSequence
  ) {
    sequenceTailIndex += 1;
  }

  return getSketchHistoryCursorForIndex(items, sequenceTailIndex);
}

export function createSketchSessionFromSnapshot(
  sketch: SketchSnapshotRecord,
): SketchSessionState {
  const sketchId = sketch.sketchId;
  const fullDefinition = cloneDefinition(sketch.sketch.definition);
  const historyCursor = createTailSketchHistoryCursor(fullDefinition);
  const definition = filterSketchDefinitionThroughCursor(
    fullDefinition,
    historyCursor,
  );
  const planeKey = sketch.plane.key ?? null;
  const projectedReferences =
    buildReferenceImageAnchorProjectedReferences(definition);

  return {
    sketchId,
    sketchLabel: sketch.label,
    plane: sketch.plane,
    planeTarget: sketch.plane.support,
    planeKey,
    toolStagedEntities: [],
    definition,
    fullDefinition,
    historyCursor,
    historyOperations: [],
    activeTool: null,
    status: "idle",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeSpecialMode: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
    sequence: getNextDefinitionSequence(sketch.sketch.definition),
    solvedRegions: [...sketch.sketch.regions],
    projectedReferences,
    projectionDiagnostics: [],
    commitRequest: buildCommitRequest({
      sketchId,
      sketchLabel: sketch.label,
      plane: sketch.plane,
      definition,
    }),
    validationMessage: null,
  };
}

export function createNewSketchSession(
  plane: SketchPlaneDefinition,
): SketchSessionState {
  const planeKey = plane.key;
  const definition = createEmptyDefinition();

  return {
    sketchId: null,
    sketchLabel: "Sketch Draft",
    plane,
    planeTarget: plane.support,
    planeKey,
    toolStagedEntities: [],
    definition,
    fullDefinition: cloneDefinition(definition),
    historyCursor: { kind: "empty" },
    historyOperations: [],
    activeTool: null,
    status: "idle",
    constructionTargetPicking: false,
    referenceTargetPicking: false,
    constructionModifierActive: false,
    pointerDownPoint: null,
    livePoint: null,
    toolPlacedPoints: [],
    toolSettings: {},
    toolPresentation: null,
    constraintAuthoring: null,
    activeAnnotationEdit: null,
    selectedAnnotation: null,
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeSpecialMode: null,
    activeDrag: null,
    activeSnap: null,
    drawStartSnap: null,
    sequence: 0,
    solvedRegions: [],
    projectedReferences: [],
    projectionDiagnostics: [],
    commitRequest: null,
    validationMessage: null,
  };
}

export function deriveSketchDisplayEntities(
  session: SketchSessionState,
): readonly SketchDraftEntity[] {
  const sketchId = getSessionSketchId(session);
  const displayDefinition = evaluateSketchDerivations(
    session.definition,
  ).definition;
  const acceptedEntities = displayDefinition.entities.flatMap((entity) =>
    mapDefinitionEntityToDraftEntity(
      sketchId,
      displayDefinition.points,
      entity,
    ),
  );

  return session.toolStagedEntities.length === 0
    ? acceptedEntities
    : [...acceptedEntities, ...session.toolStagedEntities];
}

export function createNewSketchSessionFromSupport(
  planeTarget: SketchPlaneSupportRef,
): SketchSessionState {
  const planeKey = derivePlaneKeyFromTarget(planeTarget);
  const plane =
    planeTarget.kind === "construction" && planeKey
      ? createStandardPlaneDefinition(planeKey)
      : {
          support: planeTarget,
          frame: createStandardPlaneDefinition("xy").frame,
          key: planeKey,
        };

  return createNewSketchSession(plane);
}

export function moveSketchHistoryCursor(
  session: SketchSessionState,
  cursor: SketchHistoryCursor,
): SketchSessionState {
  const operation = getSketchHistoryOperationForCursor(session, cursor);
  if (operation) {
    return rebuildSessionForDefinition(session, {
      definition: operation.afterDefinition,
      fullDefinition: operation.afterDefinition,
      historyCursor: cursor,
      historyOperations: session.historyOperations,
    });
  }

  const redoSourceOperation = session.historyOperations.find((entry) =>
    sketchHistoryCursorsEqual(entry.beforeCursor, cursor),
  );
  const fullDefinition =
    redoSourceOperation?.beforeDefinition ?? session.fullDefinition;
  const items = getSketchHistoryItems(fullDefinition);
  const normalizedCursor =
    cursor.kind === "empty" || items.some((item) => item.id === cursor.itemId)
      ? cursor
      : createTailSketchHistoryCursor(fullDefinition);
  const definition = filterSketchDefinitionThroughCursor(
    fullDefinition,
    normalizedCursor,
  );

  return rebuildSessionForDefinition(session, {
    definition,
    fullDefinition,
    historyCursor: normalizedCursor,
    historyOperations: session.historyOperations,
  });
}

export function isEditableSketchGeometrySelection(
  session: SketchSessionState,
  targets: readonly PrimitiveRef[],
) {
  return (
    getSelectedSketchGeometryIds(session, targets) !== null ||
    getSelectedReferenceImageOperationIds(session, targets).length > 0
  );
}

export function getConnectedSketchEntitySelectionTargets(
  session: SketchSessionState,
  target: PrimitiveRef,
): PrimitiveRef[] {
  if (target.kind !== "sketchEntity") {
    return [];
  }

  const seedEntity = session.definition.entities.find(
    (entity) => entity.kind !== "point" && entity.entityId === target.entityId,
  );

  if (!seedEntity || seedEntity.target.sketchId !== target.sketchId) {
    return [];
  }

  const entityIdsByPointId = new Map<SketchPointId, SketchEntityId[]>();
  const pointIdsByEntityId = new Map<
    SketchEntityId,
    readonly SketchPointId[]
  >();
  const targetsByEntityId = new Map<
    SketchEntityId,
    Extract<PrimitiveRef, { kind: "sketchEntity" }>
  >();

  for (const entity of session.definition.entities) {
    if (entity.kind === "point") {
      continue;
    }

    const pointIds = getEntityPointIds(entity);
    pointIdsByEntityId.set(entity.entityId, pointIds);
    targetsByEntityId.set(entity.entityId, entity.target);

    for (const pointId of pointIds) {
      const entityIds = entityIdsByPointId.get(pointId);
      if (entityIds) {
        entityIds.push(entity.entityId);
      } else {
        entityIdsByPointId.set(pointId, [entity.entityId]);
      }
    }
  }

  const visitedEntityIds = new Set<SketchEntityId>();
  const pendingEntityIds: SketchEntityId[] = [seedEntity.entityId];

  while (pendingEntityIds.length > 0) {
    const entityId = pendingEntityIds.pop();

    if (!entityId || visitedEntityIds.has(entityId)) {
      continue;
    }

    visitedEntityIds.add(entityId);

    for (const pointId of pointIdsByEntityId.get(entityId) ?? []) {
      for (const connectedEntityId of entityIdsByPointId.get(pointId) ?? []) {
        if (!visitedEntityIds.has(connectedEntityId)) {
          pendingEntityIds.push(connectedEntityId);
        }
      }
    }
  }

  return session.definition.entityIds
    .filter((entityId) => visitedEntityIds.has(entityId))
    .map((entityId) => targetsByEntityId.get(entityId))
    .filter(
      (entity): entity is Extract<PrimitiveRef, { kind: "sketchEntity" }> =>
        entity !== undefined,
    );
}

export function constraintReferencesSketchGeometry(
  constraint: ConstraintDefinition,
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return constraint.pointIds.some((pointId) =>
        deletedPointIds.has(pointId),
      );
    case "horizontal":
    case "vertical":
      return deletedEntityIds.has(constraint.entityId);
    case "coincidentProjectedPoint":
    case "pointOnProjectedCurve":
    case "midpointProjectedLine":
      return deletedPointIds.has(constraint.point.pointId);
    case "midpoint":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.line.entityId)
      );
    case "pointOnCurve":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.curve.entityId)
      );
    case "collinear":
      return (
        operandReferencesSketchGeometry(
          constraint.target,
          deletedPointIds,
          deletedEntityIds,
        ) || deletedEntityIds.has(constraint.line.entityId)
      );
    case "collinearProjectedLine":
      return operandReferencesSketchGeometry(
        constraint.target,
        deletedPointIds,
        deletedEntityIds,
      );
    case "normal":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.line.entityId) ||
        deletedEntityIds.has(constraint.curve.entityId)
      );
    case "normalProjectedCurve":
      return (
        deletedPointIds.has(constraint.point.pointId) ||
        deletedEntityIds.has(constraint.line.entityId)
      );
    case "symmetric":
      return (
        constraint.pointIds.some((pointId) => deletedPointIds.has(pointId)) ||
        deletedEntityIds.has(constraint.axis.entityId)
      );
    case "symmetricProjectedLine":
      return constraint.pointIds.some((pointId) =>
        deletedPointIds.has(pointId),
      );
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return deletedEntityIds.has(constraint.line.entityId);
    case "tangentProjectedCurve":
    case "concentricProjectedCurve":
      return deletedEntityIds.has(constraint.curve.entityId);
    case "tangent":
    case "concentric":
    case "parallel":
    case "perpendicular":
    case "equalLength":
      return constraint.entityIds.some((entityId) =>
        deletedEntityIds.has(entityId),
      );
    case "fixPoint":
      return deletedPointIds.has(constraint.pointId);
  }
}

function operandReferencesSketchGeometry(
  operand: { kind: string; pointId?: SketchPointId; entityId?: SketchEntityId },
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  return (
    (operand.kind === "localPoint" &&
      operand.pointId !== undefined &&
      deletedPointIds.has(operand.pointId)) ||
    (operand.kind === "localEntity" &&
      operand.entityId !== undefined &&
      deletedEntityIds.has(operand.entityId))
  );
}

export function dimensionReferencesSketchGeometry(
  dimension: DimensionDefinition,
  deletedPointIds: ReadonlySet<SketchPointId>,
  deletedEntityIds: ReadonlySet<SketchEntityId>,
) {
  const operandReferencesDeletedGeometry = (operand: {
    kind: string;
    pointId?: SketchPointId;
    entityId?: SketchEntityId;
  }) =>
    (operand.kind === "localPoint" &&
      operand.pointId !== undefined &&
      deletedPointIds.has(operand.pointId)) ||
    (operand.kind === "localEntity" &&
      operand.entityId !== undefined &&
      deletedEntityIds.has(operand.entityId));

  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance":
      return dimension.pointIds.some((pointId) => deletedPointIds.has(pointId));
    case "pointDatumDistance":
      return deletedPointIds.has(dimension.point.pointId);
    case "circleRadius":
    case "diameter":
      return deletedEntityIds.has(dimension.entityId);
    case "lineLength":
      return deletedEntityIds.has(dimension.entityId);
    case "lineDistance":
    case "lineAngle":
      return dimension.lines.some(operandReferencesDeletedGeometry);
    case "linePointDistance":
      return (
        operandReferencesDeletedGeometry(dimension.line) ||
        operandReferencesDeletedGeometry(dimension.point)
      );
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return (
        deletedEntityIds.has(dimension.entityId) ||
        deletedPointIds.has(dimension.pointId)
      );
  }
}

export function isSketchConstructionSelected(session: SketchSessionState) {
  return (
    session.constructionTargetPicking || session.constructionModifierActive
  );
}

export function isSketchReferenceToolSelected(session: SketchSessionState) {
  return session.referenceTargetPicking;
}

export function mapSketchPointToWorld(
  plane: SketchPlaneDefinition,
  point: SketchPoint,
): readonly [number, number, number] {
  return mapSketchPointToWorkspaceWorld(plane, point);
}
