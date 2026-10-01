import type { SketchDerivationSettings } from "@/contracts/sketch/derived-geometry";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  sketchDraggedPointHasFreeDof,
  solveSketchDefinitionWithDraggedPointTarget,
  updateCompiledSketchSolveSession,
  type SketchCompiledSolveSession,
} from "@/contracts/sketch/solver-core";
import type {
  ProjectedSketchReferenceRecord,
  SolverTolerancePolicy,
} from "@/contracts/solver/schema";
import { type PrimitiveRef, primitiveRefEquals } from "@/core/editor/schema";
import { collectActiveReferenceImageOperations } from "@/domain/reference-image/operations";
import { getSketchEditToolDefinition } from "@/core/sketch-edit-tools/registry";
import {
  type OffsetCurveDescriptor,
  type SketchEditOperationResult,
  createOffsetContribution,
  createSketchChamferMutation,
  createSketchDerivedTransformContribution,
  createSketchExtendMutation,
  createSketchFilletMutation,
  createSketchOffsetDerivationContribution,
  createSketchSlotContribution,
  createSketchSplitMutation,
  offsetCurveDescriptorFromProjectedGeometry,
  offsetSideForSketchPoint,
  trimLineSegmentAtIntersections,
} from "@/domain/sketch-editing/operations";
import type { OffsetFramePlan } from "@/contracts/sketch/offset-derivation-frame";
import type { SketchOffsetPublicationRecord } from "@/contracts/solver/schema";
import type {
  SketchEditToolState,
  SketchOffsetPreviewPublication,
  SketchSessionState,
} from "./types";
import {
  CONSTRAINED_DRAG_BLOCKED_MESSAGE,
  CONSTRAINED_DRAG_MOVE_FRACTION,
  CONSTRAINED_DRAG_REQUEST_EPSILON,
  applySketchContribution,
  cloneDefinition,
  createArcEntityDefinition,
  createEntityId,
  createLineEntityDefinition,
  createPointDefinition,
  createPointId,
  createSessionCommitFactories,
  createSplineEntityDefinition,
  withLiveSolveBasis,
  getEntityPointIds,
  isDrawingSketchTool,
  rebuildSessionCommitRequest,
  rebuildSessionForDefinition,
  getSketchSessionDerivationSettings,
  getSketchSessionPreviewBasis,
} from "./internals";
import { updateReferenceImageOperationStates } from "./references";
import {
  constraintReferencesSketchGeometry,
  dimensionReferencesSketchGeometry,
} from "./state";
import {
  buildSketchEditToolPresentation,
  selectSketchEditTarget,
} from "./tools";
import {
  applyPointPositionsToDefinition,
  applySolvedSketchToDefinition,
} from "./definition-patches";

import {
  getSelectedReferenceImageOperationIds,
  getSelectedSketchGeometryIds,
} from "./selection";

/** Explicit rejection of deleting a derived offset shell on its own. */
export const DERIVED_SHELL_DELETE_MESSAGE =
  "An offset spline curve is part of its offset and cannot be deleted on its own.";

/** Explicit rejection of deleting a derived offset shell's driven end point on its own. */
export const DERIVED_SHELL_POINT_DELETE_MESSAGE =
  "An offset spline curve's end point is part of its offset and cannot be deleted on its own.";

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
      activeSnap: null,
      drawStartSnap: null,
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
    activeSnap: null,
    drawStartSnap: null,
    sequence: rebuiltSession.sequence,
  };
}

export function getOffsetPreview(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
  plan?: OffsetFramePlan,
): SketchEditOperationResult {
  const selectedTargets = activeEditTool.selectedTargets;
  const sketchEntityTargets = selectedTargets.filter(
    (target): target is Extract<PrimitiveRef, { kind: "sketchEntity" }> =>
      target.kind === "sketchEntity",
  );
  const projectedTarget =
    selectedTargets.length === 1 &&
    selectedTargets[0]?.kind === "projectedReferenceGeometry"
      ? selectedTargets[0]
      : null;
  const projectedCurve = projectedTarget
    ? getOffsetCurveForProjectedTarget(session, projectedTarget)
    : null;
  const nextSequence = session.sequence + 1;
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);

  if (projectedCurve) {
    // Projected reference geometry cannot be a derivation master yet, so it
    // keeps the static one-shot offset path.
    const staticResult = createOffsetContribution({
      definition: session.definition,
      entityIds: [],
      curve: projectedCurve,
      distance: activeEditTool.offsetDistance,
      side: activeEditTool.offsetSide,
      sequence: nextSequence,
      factories: createSessionCommitFactories(nextSequence, sketchId),
    });
    return {
      valid: staticResult.valid,
      message: staticResult.message,
      definition: null,
      contribution: staticResult.contribution,
      previewEntities: staticResult.previewEntities,
    };
  }

  return createSketchOffsetDerivationContribution({
    definition: session.definition,
    entityIds: sketchEntityTargets.map((target) => target.entityId),
    distance: activeEditTool.offsetDistance,
    side: activeEditTool.offsetSide,
    sequence: nextSequence,
    factories: createSessionCommitFactories(nextSequence, sketchId),
    modelingTolerance: session.modelingTolerance,
    ...(plan ? { plan } : {}),
  });
}

const OFFSET_PREVIEW_UNACCEPTED_MESSAGE =
  "The offset can be checked only when every sketch constraint is solved.";
const OFFSET_PREVIEW_PENDING_MESSAGE = "Checking the offset…";

/**
 * U-G3 / [TECH] G11: attaches the staged preview's publication to the edit
 * tool. A derived-offset preview starts `pending` (its background publish is
 * emitted by the editor loop) or `failed` when its solve is not accepted
 * (U-G1); a static or invalid preview has none.
 */
export function stageOffsetPreviewPublication(
  session: SketchSessionState,
  tool: SketchEditToolState,
  preview: SketchEditOperationResult,
  /** [TECH] G3/G17: the certifier's hint the preview was re-authored with. */
  replan?: OffsetFramePlan,
): SketchEditToolState {
  const relationship = preview.valid
    ? preview.contribution?.derivedRelationships?.find(
        (candidate) => candidate.kind === "offset",
      )
    : undefined;
  const rest = withoutOffsetPublication(tool);
  if (!relationship || !preview.contribution) return rest;
  // The re-solve runs the hint unchanged (keyed by the re-authored
  // relationship), so a second disagreement fails closed in publish.
  const basis = getSketchSessionPreviewBasis(
    replan
      ? {
          ...session,
          offsetPlans: [
            ...(session.offsetPlans ?? []),
            { derivationId: relationship.derivationId, plan: replan },
          ],
        }
      : session,
    applySketchContribution(session, preview.contribution).definition,
  );
  const offsetPublication: SketchOffsetPreviewPublication = {
    derivationId: relationship.derivationId,
    contribution: preview.contribution,
    basis,
    status: basis ? "pending" : "failed",
    message: basis ? null : OFFSET_PREVIEW_UNACCEPTED_MESSAGE,
    commitRequested: false,
    replanned: replan !== undefined,
  };
  return { ...rest, offsetPublication };
}

function withoutOffsetPublication(
  tool: SketchEditToolState,
): SketchEditToolState {
  const next = { ...tool };
  delete next.offsetPublication;
  return next;
}

/** Commits a certified (or static) offset contribution. */
function commitOffsetContribution(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
  contribution: NonNullable<SketchEditOperationResult["contribution"]>,
): SketchSessionState {
  const nextSequence = session.sequence + 1;
  const history = applySketchContribution(session, contribution);
  const tool = withoutOffsetPublication(activeEditTool);
  const nextEditTool = {
    ...tool,
    selectedTarget: null,
    selectedTargets: [],
  };

  return withLiveSolveBasis(
    {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      definition: history.definition,
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, history.definition),
      validationMessage: null,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    },
    history.definition,
  );
}

function withOffsetPublication(
  session: SketchSessionState,
  tool: SketchEditToolState,
  publication: SketchOffsetPreviewPublication,
): SketchSessionState {
  const nextEditTool = { ...tool, offsetPublication: publication };
  const message =
    publication.status === "failed"
      ? publication.message
      : publication.status === "pending" && publication.commitRequested
        ? OFFSET_PREVIEW_PENDING_MESSAGE
        : null;
  return {
    ...session,
    activeEditTool: nextEditTool,
    validationMessage: publication.status === "failed" ? message : null,
    toolPresentation: buildSketchEditToolPresentation(
      nextEditTool,
      message,
      session.toolStagedEntities,
    ),
  };
}

/**
 * U-G3 / [TECH] G3/G11: applies the background publication of the staged
 * preview `derivationId` (ignored unless it is still the pending one).
 * `certified` commits it if Commit was requested; `planChanged` re-authors
 * the preview ONCE with the certifier's hint (unchanged) and checks again;
 * anything else fails: nothing is committed and the error stays on the
 * preview.
 */
export function completeSketchOffsetPreviewPublication(
  session: SketchSessionState,
  derivationId: string,
  publications: readonly SketchOffsetPublicationRecord[],
): SketchSessionState {
  const tool = session.activeEditTool;
  const publication = tool?.offsetPublication;
  if (
    !tool ||
    !publication ||
    publication.derivationId !== derivationId ||
    publication.status !== "pending"
  )
    return session;
  const record = publications.find(
    (candidate) => candidate.derivationId === derivationId,
  );
  if (record?.status === "certified")
    return publication.commitRequested
      ? commitOffsetContribution(
          // The published plan seeds the committed relationship's solves
          // (G17), so the live solve reproduces the certified frame.
          record.plan
            ? {
                ...session,
                offsetPlans: [
                  ...(session.offsetPlans ?? []),
                  { derivationId, plan: record.plan },
                ],
              }
            : session,
          tool,
          publication.contribution,
        )
      : withOffsetPublication(session, tool, {
          ...publication,
          status: "certified",
        });
  if (
    record?.status === "planChanged" &&
    record.plan &&
    !publication.replanned
  ) {
    const preview = getOffsetPreview(session, tool, record.plan);
    const staged = stageOffsetPreviewPublication(
      session,
      tool,
      preview,
      record.plan,
    );
    const next = staged.offsetPublication;
    return {
      ...session,
      activeEditTool: next
        ? {
            ...staged,
            offsetPublication: {
              ...next,
              commitRequested: publication.commitRequested,
            },
          }
        : staged,
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(
        staged,
        preview.valid ? null : preview.message,
        preview.previewEntities,
      ),
    };
  }
  return withOffsetPublication(session, tool, {
    ...publication,
    status: "failed",
    commitRequested: false,
    message:
      record?.diagnostic?.message ??
      (record?.status === "planChanged"
        ? "The certified corner plan does not match the offset preview."
        : "The offset could not be checked."),
  });
}

/**
 * Follows the pointer across the selected chain so the staged offset preview
 * lands on the pointer's side before commit.
 */
export function updateSketchOffsetPointer(
  session: SketchSessionState,
  point: SketchPoint | null,
): SketchSessionState {
  const activeEditTool = session.activeEditTool;
  if (!activeEditTool || activeEditTool.toolId !== "offset" || !point) {
    return session;
  }

  const entityIds = getSelectedSketchEntityIds(activeEditTool);
  if (entityIds.length === 0) {
    return session;
  }

  // [TECH] G9: the side on the declared (N2) traversal of the exact sources.
  const side = offsetSideForSketchPoint({
    definition: session.definition,
    entityIds,
    point,
  });
  if (!side || side === activeEditTool.offsetSide) {
    return session;
  }

  const sideEditTool = { ...activeEditTool, offsetSide: side };
  const preview = getOffsetPreview(session, sideEditTool);
  const nextEditTool = stageOffsetPreviewPublication(
    session,
    sideEditTool,
    preview,
  );
  return {
    ...session,
    activeEditTool: nextEditTool,
    toolStagedEntities: preview.previewEntities,
    validationMessage: preview.valid ? null : preview.message,
    toolPresentation: buildSketchEditToolPresentation(
      nextEditTool,
      preview.message,
      preview.previewEntities,
    ),
  };
}

export function getOffsetCurveForProjectedTarget(
  session: SketchSessionState,
  target: Extract<PrimitiveRef, { kind: "projectedReferenceGeometry" }>,
): OffsetCurveDescriptor | null {
  const projectedReference = session.projectedReferences.find(
    (entry) => entry.referenceId === target.referenceId,
  );
  if (!projectedReference || projectedReference.status !== "projected") {
    return null;
  }

  const geometry = projectedReference.geometry.find(
    (entry) =>
      entry.geometryId === target.geometryId &&
      entry.kind === target.geometryKind,
  );
  return geometry ? offsetCurveDescriptorFromProjectedGeometry(geometry) : null;
}

export function getSelectedSketchEntityIds(
  activeEditTool: SketchEditToolState,
): SketchEntityId[] {
  return activeEditTool.selectedTargets
    .filter(
      (target): target is Extract<PrimitiveRef, { kind: "sketchEntity" }> =>
        target.kind === "sketchEntity",
    )
    .map((target) => target.entityId);
}

export function getSketchEditOperatorResult(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
): SketchEditOperationResult {
  const entityIds = getSelectedSketchEntityIds(activeEditTool);
  const nextSequence = session.sequence + 1;
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const factories = createSessionCommitFactories(nextSequence, sketchId);

  switch (activeEditTool.toolId) {
    case "sketchFillet":
      return createSketchFilletMutation({
        definition: session.definition,
        entityIds,
        radius: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      });
    case "sketchChamfer":
      return createSketchChamferMutation({
        definition: session.definition,
        entityIds,
        distance: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      });
    case "sketchExtend":
      return createSketchExtendMutation({
        definition: session.definition,
        entityIds,
        sequence: nextSequence,
        factories,
      });
    case "sketchSplit":
      return createSketchSplitMutation({
        definition: session.definition,
        entityIds,
        sequence: nextSequence,
        factories,
      });
    case "sketchSlot":
      return createSketchSlotContribution({
        definition: session.definition,
        entityIds,
        width: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
      });
    case "sketchMirror":
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: "mirror",
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
        modelingTolerance: session.modelingTolerance,
      });
    case "sketchLinearPattern":
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: "linearPattern",
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
        modelingTolerance: session.modelingTolerance,
      });
    case "sketchCircularPattern":
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: "circularPattern",
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
        modelingTolerance: session.modelingTolerance,
      });
    case "sketchTransform":
      return createSketchDerivedTransformContribution({
        definition: session.definition,
        operatorKind: "transform",
        entityIds,
        value: activeEditTool.toolValue,
        sequence: nextSequence,
        factories,
        modelingTolerance: session.modelingTolerance,
      });
    case "trim":
    case "offset":
      return {
        valid: false,
        message: null,
        definition: null,
        contribution: null,
        previewEntities: [],
      };
  }
}

export function applySketchEditOperationResult(
  session: SketchSessionState,
  result: SketchEditOperationResult,
) {
  const nextSequence = session.sequence + 1;
  if (result.definition) {
    return {
      definition: result.definition,
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, result.definition),
    };
  }

  if (result.contribution) {
    const history = applySketchContribution(session, result.contribution);
    return {
      definition: history.definition,
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, history.definition),
    };
  }

  return null;
}

export function updateSketchEditToolHover(
  session: SketchSessionState,
  target: PrimitiveRef | null,
): SketchSessionState {
  if (!session.activeEditTool) {
    return session;
  }

  const activeEditTool = {
    ...session.activeEditTool,
    hoverTarget: target,
  };
  const preview =
    activeEditTool.toolId === "offset"
      ? getOffsetPreview(session, activeEditTool)
      : activeEditTool.toolId === "trim"
        ? null
        : getSketchEditOperatorResult(session, activeEditTool);

  return {
    ...session,
    activeEditTool,
    toolPresentation: buildSketchEditToolPresentation(
      activeEditTool,
      session.validationMessage,
      preview?.previewEntities ?? [],
    ),
  };
}

export function selectSketchEditToolTarget(
  session: SketchSessionState,
  target: PrimitiveRef,
): SketchSessionState {
  const activeEditTool = session.activeEditTool;
  if (!activeEditTool) {
    return session;
  }

  if (activeEditTool.toolId === "trim") {
    if (target.kind !== "sketchEntity") {
      return session;
    }

    const nextSequence = session.sequence + 1;
    const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
    const result = trimLineSegmentAtIntersections({
      definition: session.definition,
      entityId: target.entityId,
      nextPointId: (suffix) => createPointId(nextSequence, suffix),
      nextEntityId: (suffix) => createEntityId(nextSequence, suffix),
      createPoint: (label, pointId, position) =>
        createPointDefinition(sketchId, pointId, label, position, false),
      createLine: (label, entityId, startPointId, endPointId) =>
        createLineEntityDefinition(
          sketchId,
          entityId,
          label,
          startPointId,
          endPointId,
          false,
        ),
      createArc: (
        label,
        entityId,
        centerPointId,
        startPointId,
        endPointId,
        sweepDirection,
      ) =>
        createArcEntityDefinition(
          sketchId,
          entityId,
          label,
          centerPointId,
          startPointId,
          endPointId,
          sweepDirection,
          false,
        ),
      createSpline: (label, entityId, fitPointIds) =>
        createSplineEntityDefinition(
          sketchId,
          entityId,
          label,
          fitPointIds,
          false,
        ),
    });

    if (!result.changed) {
      return {
        ...session,
        validationMessage: result.message,
        toolPresentation: buildSketchEditToolPresentation(
          activeEditTool,
          result.message,
        ),
      };
    }

    return withLiveSolveBasis(
      {
        ...session,
        definition: result.definition,
        toolStagedEntities: [],
        sequence: nextSequence,
        validationMessage: null,
        commitRequest: rebuildSessionCommitRequest(session, result.definition),
        toolPresentation: buildSketchEditToolPresentation(activeEditTool),
        activeEditTarget: null,
        activeDrag: null,
      },
      result.definition,
    );
  }

  if (
    activeEditTool.toolId === "offset" &&
    target.kind !== "sketchEntity" &&
    target.kind !== "projectedReferenceGeometry"
  ) {
    return session;
  }

  if (activeEditTool.toolId === "offset") {
    const nextSelectedTargets = activeEditTool.selectedTargets.some(
      (selected) => primitiveRefEquals(selected, target),
    )
      ? activeEditTool.selectedTargets.filter(
          (selected) => !primitiveRefEquals(selected, target),
        )
      : [...activeEditTool.selectedTargets, target];
    const nextEditTool = {
      ...activeEditTool,
      selectedTarget: nextSelectedTargets[0] ?? null,
      selectedTargets: nextSelectedTargets,
      hoverTarget: null,
    };
    const preview = getOffsetPreview(session, nextEditTool);
    const stagedEditTool = stageOffsetPreviewPublication(
      session,
      nextEditTool,
      preview,
    );

    return {
      ...session,
      activeEditTool: stagedEditTool,
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(
        nextEditTool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }

  if (target.kind !== "sketchEntity") {
    const message = getSketchEditToolDefinition(activeEditTool.toolId).metadata
      .validationMessages.unsupportedTarget;
    return {
      ...session,
      validationMessage: message,
      toolPresentation: buildSketchEditToolPresentation(
        activeEditTool,
        message,
      ),
    };
  }

  const metadata = getSketchEditToolDefinition(activeEditTool.toolId).metadata;
  const isSelected = activeEditTool.selectedTargets.some((selected) =>
    primitiveRefEquals(selected, target),
  );
  const nextSelectedTargets = isSelected
    ? activeEditTool.selectedTargets.filter(
        (selected) => !primitiveRefEquals(selected, target),
      )
    : metadata.selection.allowsMultiple ||
        activeEditTool.selectedTargets.length < metadata.selection.requiredCount
      ? [...activeEditTool.selectedTargets, target]
      : [...activeEditTool.selectedTargets.slice(1), target];
  const nextEditTool = {
    ...activeEditTool,
    selectedTarget: nextSelectedTargets[0] ?? null,
    selectedTargets: nextSelectedTargets,
    hoverTarget: null,
  };
  const preview = getSketchEditOperatorResult(session, nextEditTool);

  if (
    (nextEditTool.toolId === "sketchExtend" ||
      nextEditTool.toolId === "sketchSplit" ||
      nextEditTool.toolId === "sketchMirror") &&
    nextSelectedTargets.length >= metadata.selection.requiredCount &&
    preview.valid
  ) {
    const applied = applySketchEditOperationResult(session, preview);
    if (applied) {
      const resetEditTool = {
        ...nextEditTool,
        selectedTarget: null,
        selectedTargets: [],
      };
      return withLiveSolveBasis(
        {
          ...session,
          ...applied,
          activeEditTool: resetEditTool,
          toolStagedEntities: [],
          validationMessage: null,
          toolPresentation: buildSketchEditToolPresentation(resetEditTool),
          activeEditTarget: null,
          activeDrag: null,
        },
        applied.definition,
      );
    }
  }

  return {
    ...session,
    activeEditTool: nextEditTool,
    toolStagedEntities: preview.previewEntities,
    validationMessage: preview.valid ? null : preview.message,
    toolPresentation: buildSketchEditToolPresentation(
      nextEditTool,
      preview.message,
      preview.previewEntities,
    ),
  };
}

export function patchSketchEditToolValue(
  session: SketchSessionState,
  patch: Record<string, unknown>,
): SketchSessionState {
  const activeEditTool = session.activeEditTool;
  if (!activeEditTool) {
    return session;
  }

  if (activeEditTool.toolId !== "offset") {
    return patchSketchEditOperatorValue(session, activeEditTool, patch);
  }

  if (patch.intent === "cancelOffset") {
    const tool = withoutOffsetPublication(activeEditTool);
    const nextEditTool = {
      ...tool,
      selectedTarget: null,
      selectedTargets: [],
    };

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      validationMessage: null,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    };
  }

  if ("value" in patch && patch.intent !== "commitOffset") {
    const nextEditTool = {
      ...activeEditTool,
      offsetDistance:
        patch.intent === "setOffsetSide"
          ? activeEditTool.offsetDistance
          : typeof patch.value === "number"
            ? patch.value
            : null,
      offsetSide:
        patch.intent === "setOffsetSide" &&
        (patch.value === "left" || patch.value === "right")
          ? patch.value
          : activeEditTool.offsetSide,
    };
    const preview = getOffsetPreview(session, nextEditTool);
    const stagedEditTool = stageOffsetPreviewPublication(
      session,
      nextEditTool,
      preview,
    );

    return {
      ...session,
      activeEditTool: stagedEditTool,
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(
        nextEditTool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }

  if (patch.intent !== "commitOffset") {
    return session;
  }

  // U-G3: a derived offset commits only its certified preview, exactly.
  const staged = activeEditTool.offsetPublication;
  if (staged) {
    if (staged.status === "certified")
      return commitOffsetContribution(
        session,
        activeEditTool,
        staged.contribution,
      );
    return withOffsetPublication(session, activeEditTool, {
      ...staged,
      commitRequested: staged.status === "pending",
    });
  }

  const preview = getOffsetPreview(session, activeEditTool);
  if (!preview.valid || !preview.contribution) {
    return {
      ...session,
      validationMessage: preview.message,
      toolPresentation: buildSketchEditToolPresentation(
        activeEditTool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }

  const stagedEditTool = stageOffsetPreviewPublication(
    session,
    activeEditTool,
    preview,
  );
  if (stagedEditTool.offsetPublication)
    return withOffsetPublication(
      { ...session, toolStagedEntities: preview.previewEntities },
      stagedEditTool,
      {
        ...stagedEditTool.offsetPublication,
        commitRequested: stagedEditTool.offsetPublication.status === "pending",
      },
    );
  // The static one-shot projected offset (D6) has no derivation to certify.
  return commitOffsetContribution(
    session,
    activeEditTool,
    preview.contribution,
  );
}

export function patchSketchEditOperatorValue(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
  patch: Record<string, unknown>,
): SketchSessionState {
  if (patch.intent === "cancelSketchEditOperator") {
    const nextEditTool = {
      ...activeEditTool,
      selectedTarget: null,
      selectedTargets: [],
    };

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      validationMessage: null,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
    };
  }

  if ("value" in patch && patch.intent !== "commitSketchEditOperator") {
    const nextEditTool = {
      ...activeEditTool,
      toolValue: typeof patch.value === "number" ? patch.value : null,
    };
    const preview = getSketchEditOperatorResult(session, nextEditTool);

    return {
      ...session,
      activeEditTool: nextEditTool,
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(
        nextEditTool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }

  if (patch.intent !== "commitSketchEditOperator") {
    return session;
  }

  const preview = getSketchEditOperatorResult(session, activeEditTool);
  if (!preview.valid) {
    return {
      ...session,
      validationMessage: preview.message,
      toolPresentation: buildSketchEditToolPresentation(
        activeEditTool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }

  const applied = applySketchEditOperationResult(session, preview);
  if (!applied) {
    return session;
  }

  const nextEditTool = {
    ...activeEditTool,
    selectedTarget: null,
    selectedTargets: [],
  };

  return withLiveSolveBasis(
    {
      ...session,
      ...applied,
      activeEditTool: nextEditTool,
      toolStagedEntities: [],
      validationMessage: null,
      toolPresentation: buildSketchEditToolPresentation(nextEditTool),
      activeEditTarget: null,
      activeDrag: null,
    },
    applied.definition,
  );
}

export function beginSketchGeometryDrag(
  session: SketchSessionState,
  target: PrimitiveRef,
  point: SketchPoint,
): SketchSessionState {
  if (
    target.kind !== "sketchPoint" ||
    session.status === "drawing" ||
    (session.activeTool !== null && !isDrawingSketchTool(session.activeTool))
  ) {
    return session;
  }

  const selected = selectSketchEditTarget(session, target);

  if (
    !selected.activeEditTarget ||
    selected.activeEditTarget.pointId !== target.pointId
  ) {
    return session;
  }

  return {
    ...selected,
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
    toolStagedEntities: [],
    activeDrag: {
      target,
      startPoint: point,
      currentPoint: point,
      status: "dragging",
      message: null,
      interactiveSolveSession: createInteractiveSolveSessionForDrag(
        selected.definition,
        selected.projectedReferences,
        selected.solverTolerances,
        getSketchSessionDerivationSettings(selected),
        target.pointId,
      ),
    },
    validationMessage: null,
  };
}

export function updateSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  return applySketchGeometryDrag(session, point, false);
}

export function finishSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  const interactiveSolveSession = session.activeDrag.interactiveSolveSession;
  const updated = applySketchGeometryDrag(session, point, true);
  if (interactiveSolveSession) {
    interactiveSolveSession.disposed = true;
  }

  return {
    ...updated,
    activeDrag: null,
  };
}

export function applySketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  complete: boolean,
): SketchSessionState {
  const drag = session.activeDrag;

  if (!drag) {
    return session;
  }
  if (
    point[0] === drag.startPoint[0] &&
    point[1] === drag.startPoint[1] &&
    drag.currentPoint[0] === drag.startPoint[0] &&
    drag.currentPoint[1] === drag.startPoint[1]
  ) {
    return session;
  }

  const edit = solveDraggedPointEdit(
    session.definition,
    session.projectedReferences,
    session.solverTolerances,
    getSketchSessionDerivationSettings(session),
    drag.target.pointId,
    point,
    drag.interactiveSolveSession,
  );

  if (edit.kind === "blocked") {
    return {
      ...session,
      activeDrag: complete
        ? null
        : {
            ...drag,
            currentPoint: point,
            status: "blocked",
            message: edit.message,
          },
      validationMessage: edit.message,
    };
  }

  const definition = edit.definition;

  // Every accepted frame is a new live solve basis; regions stay stale while
  // the drag is active and are derived once it completes (no active drag).
  return withLiveSolveBasis(
    {
      ...session,
      definition,
      toolStagedEntities: [],
      activeDrag: complete
        ? null
        : {
            ...drag,
            currentPoint: point,
            status: "dragging",
            message: null,
            interactiveSolveSession: edit.interactiveSolveSession,
          },
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
    edit.solvedSnapshot,
  );
}

export function solveDraggedPointEdit(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: SketchDerivationSettings,
  pointId: SketchPointId,
  position: SketchPoint,
  interactiveSolveSession: SketchCompiledSolveSession | null = null,
):
  | {
      kind: "accepted";
      definition: SketchDefinition;
      solvedSnapshot?: SolvedSketchSnapshot;
      interactiveSolveSession: SketchCompiledSolveSession | null;
    }
  | { kind: "blocked"; message: string } {
  if (!definition.points.some((point) => point.pointId === pointId)) {
    return { kind: "blocked", message: "Sketch point is no longer editable." };
  }

  if (
    definition.constraints.length === 0 &&
    definition.dimensions.length === 0
  ) {
    return {
      kind: "accepted",
      definition: applyPointPositionsToDefinition(
        definition,
        [{ pointId, position }],
        derivation,
      ),
      interactiveSolveSession: null,
    };
  }

  const solveSession =
    interactiveSolveSession ??
    createInteractiveSolveSessionForDrag(
      definition,
      projectedReferences,
      tolerances,
      derivation,
      pointId,
    );
  const solved = solveSession
    ? updateCompiledSketchSolveSession(
        solveSession,
        {
          kind: "sketchPoint",
          pointId,
          position,
        },
        1e-4,
      )
    : solveSketchDefinitionWithDraggedPointTarget({
        definition,
        projectedReferences,
        dragTarget: {
          kind: "sketchPoint",
          pointId,
          position,
        },
        tolerances,
        ...derivation,
        partialSolvePolicy: "failOnConflict",
        targetTolerance: 1e-4,
      });

  if (solved.kind !== "solved") {
    return { kind: "blocked", message: CONSTRAINED_DRAG_BLOCKED_MESSAGE };
  }

  // D6 (minimum-motion-sketch-drag): constrained-movement feedback follows the
  // grabbed target's available degrees of freedom, not cursor reachability. If
  // the target clearly moved it plainly has a free DOF, so there is no feedback.
  // If it barely moved despite a real requested motion, it is either fully
  // constrained (no DOF -> no-op with feedback, draft untouched) or merely lagged
  // because the pointer pulled across its remaining DOF (still successful, no
  // feedback). We distinguish the two by probing the target's actual mobility in
  // the solver rather than by the pull direction.
  const draggedSolvedPoint = solved.solvedSnapshot.solvedPoints.find(
    (point) => point.pointId === pointId,
  );
  const previousPosition = definition.points.find(
    (point) => point.pointId === pointId,
  )?.position;
  if (draggedSolvedPoint && previousPosition) {
    const requestedDistance = Math.hypot(
      position[0] - previousPosition[0],
      position[1] - previousPosition[1],
    );
    const movedDistance = Math.hypot(
      draggedSolvedPoint.solvedPosition[0] - previousPosition[0],
      draggedSolvedPoint.solvedPosition[1] - previousPosition[1],
    );
    const barelyMoved =
      requestedDistance > CONSTRAINED_DRAG_REQUEST_EPSILON &&
      movedDistance < requestedDistance * CONSTRAINED_DRAG_MOVE_FRACTION;
    if (
      barelyMoved &&
      solveSession !== null &&
      !sketchDraggedPointHasFreeDof(solveSession, pointId)
    ) {
      return { kind: "blocked", message: CONSTRAINED_DRAG_BLOCKED_MESSAGE };
    }
  }

  return {
    kind: "accepted",
    definition: applySolvedSketchToDefinition(
      definition,
      solved.solvedSnapshot,
      derivation,
    ),
    solvedSnapshot: solved.solvedSnapshot,
    interactiveSolveSession: solveSession,
  };
}

function createInteractiveSolveSessionForDrag(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: SketchDerivationSettings,
  pointId: SketchPointId,
): SketchCompiledSolveSession | null {
  if (
    !definition.points.some((point) => point.pointId === pointId) ||
    (definition.constraints.length === 0 && definition.dimensions.length === 0)
  ) {
    return null;
  }

  const program = compileSketchSolveProgram({
    definition,
    projectedReferences,
    tolerances,
    ...derivation,
    partialSolvePolicy: "failOnConflict",
  });
  return createCompiledSketchSolveSession({
    sessionId: `interactive_sketch_solve_drag_${pointId}`,
    program,
  });
}
