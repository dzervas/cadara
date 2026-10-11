import type {
  ModelingDocumentSettings,
  SketchPlaneKey,
  SketchPoint,
  SketchSnapshotRecord,
} from "@/contracts/modeling/schema";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
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
import { createRegionBoundaryBasis } from "@/contracts/sketch/region-boundary-curves";
import { resolveSketchDerivationDistances } from "@/domain/modeling/sketch-dimension-expressions";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";
import { type PrimitiveRef } from "@/core/editor/schema";
import {
  createStandardPlaneDefinition,
  deriveStandardPlaneKeyFromConstructionId,
} from "@/domain/modeling/opencascade-kernel-seed";
import { buildReferenceImageAnchorProjectedReferences } from "@/domain/reference-image-calibration/export/references";
import type { SketchDraftEntity } from "@/core/sketch-tools/definition";
import { mapSketchPointToWorkspaceWorld } from "@/core/workspace/sketch-plane-mapping";
import { getEntityPointIds } from "@/domain/sketch-editing/definition-references";
import type { SketchConstraintDisplayState, SketchSessionState } from "./types";
import {
  cloneDefinition,
  createEmptyDefinition,
  getNextDefinitionSequence,
  getSessionSketchId,
  getSketchSessionDerivationSettings,
  mapDefinitionEntityToDraftEntity,
} from "./internals";
import { buildCommitRequest } from "./history";
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

export function createSketchSessionFromSnapshot(
  sketch: SketchSnapshotRecord,
  settings: ModelingDocumentSettings,
): SketchSessionState {
  const sketchId = sketch.sketchId;
  const fullDefinition = cloneDefinition(sketch.sketch.definition);
  const definition = fullDefinition;
  const planeKey = sketch.plane.key ?? null;
  const imageReferences =
    buildReferenceImageAnchorProjectedReferences(definition);
  const imageReferenceIds = new Set(
    imageReferences.map((reference) => reference.referenceId),
  );
  const projectedReferences = [
    ...(sketch.sketch.projectedReferences ?? []).filter(
      (reference) => !imageReferenceIds.has(reference.referenceId),
    ),
    ...imageReferences,
  ];

  return {
    actionContextId: sketchId,
    sketchId,
    sketchLabel: sketch.label,
    plane: sketch.plane,
    planeTarget: sketch.plane.support,
    planeKey,
    toolStagedEntities: [],
    definition,
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
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeSpecialMode: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
    sequence: getNextDefinitionSequence(sketch.sketch.definition),
    liveSolve: null,
    liveRegions: {
      generation: 0,
      status:
        sketch.sketch.derivedValidity.state === "current"
          ? "current"
          : "unavailable",
      regions: [...sketch.sketch.regions],
      // R2: the record holds its regions with the pair that produced them.
      boundaryBasis:
        sketch.sketch.regions.length > 0
          ? createRegionBoundaryBasis(
              {
                definition: sketch.sketch.definition,
                solvedSnapshot: sketch.sketch.solvedSnapshot,
                projectedReferences: sketch.sketch.projectedReferences ?? [],
              },
              sketch.sketch.regions,
            )
          : null,
      diagnostics: structuredClone(sketch.sketch.derivedValidity.diagnostics),
    },
    projectedReferences,
    projectionDiagnostics: projectedReferences.flatMap(
      (reference) => reference.diagnostics,
    ),
    commitRequest: buildCommitRequest({
      sketchId,
      sketchLabel: sketch.label,
      plane: sketch.plane,
      definition,
    }),
    documentVariables: [],
    solverTolerances: createDocumentSolverTolerances(settings),
    modelingTolerance: settings.modelingTolerance,
    validationMessage:
      sketch.sketch.derivedValidity.state === "current"
        ? null
        : (sketch.sketch.derivedValidity.diagnostics.find(
            (diagnostic) => diagnostic.severity !== "info",
          )?.message ??
          "Sketch profiles are unavailable until the sketch is corrected."),
  };
}

export function createNewSketchSession(
  plane: SketchPlaneDefinition,
  settings: ModelingDocumentSettings,
): SketchSessionState {
  const planeKey = plane.key;
  const definition = createEmptyDefinition();

  return {
    actionContextId: `sketch_${crypto.randomUUID()}` as SketchId,
    sketchId: null,
    sketchLabel: "Sketch Draft",
    plane,
    planeTarget: plane.support,
    planeKey,
    toolStagedEntities: [],
    definition,
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
    activeEditTool: null,
    activeEditTarget: null,
    activeStyleFocus: null,
    activeSpecialMode: null,
    activeDrag: null,
    activeInference: null,
    toolPlacements: [],
    toolStartPointId: null,
    toolTangentSourceEntityId: null,
    sequence: 0,
    liveSolve: null,
    liveRegions: {
      generation: 0,
      status: "current",
      regions: [],
      boundaryBasis: null,
      diagnostics: [],
    },
    projectedReferences: [],
    projectionDiagnostics: [],
    commitRequest: null,
    documentVariables: [],
    solverTolerances: createDocumentSolverTolerances(settings),
    modelingTolerance: settings.modelingTolerance,
    validationMessage: null,
  };
}

export function deriveSketchDisplayEntities(
  session: SketchSessionState,
): readonly SketchDraftEntity[] {
  const sketchId = getSessionSketchId(session);
  const displayDefinition = evaluateSketchDerivations({
    definition: resolveSketchDerivationDistances({
      definition: session.definition,
      variables: session.documentVariables,
    }),
    ...getSketchSessionDerivationSettings(session),
  }).definition;
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
  settings: ModelingDocumentSettings,
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

  return createNewSketchSession(plane, settings);
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
