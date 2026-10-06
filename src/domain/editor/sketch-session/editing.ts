import type { SketchDerivationSettings } from "@/contracts/sketch/derived-geometry";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import {
  resolveHandleFromTarget,
  resolveSketchDragIntent,
  type SketchDragHandle,
  type SketchDragIntent,
} from "./drag-intent";
import {
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import type {
  SketchDefinition,
  SolvedOffsetFramePlanRecord,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  compileSketchSolveProgram,
  startCompiledSketchSolveSession,
  sketchDraggedPointHasFreeDof,
  solveSketchDefinitionWithDraggedPointTarget,
  updateCompiledSketchSolveSession,
  type SketchCompiledSolveSession,
  type SketchDragTarget,
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
  type SketchMutationResult,
  createSketchFilletMutation,
  createSketchOffsetDerivationContribution,
  createSketchSlotContribution,
  createSketchSplitMutation,
  offsetCurveDescriptorFromProjectedGeometry,
  offsetSideForSketchPoint,
  createSketchTrimMutation,
  trimTargetRefusal,
} from "@/domain/sketch-editing/operations";
import {
  EXTEND_TARGET_UNSUPPORTED_MESSAGE,
  SPLIT_TARGET_UNSUPPORTED_MESSAGE,
  type SketchEditIntersectionInput,
  type SketchEditIntersectionResult,
  type SketchEditOperation,
} from "@/contracts/sketch/edit-intersections";
import type { OffsetFramePlan } from "@/contracts/sketch/offset-derivation-frame";
import {
  carriedOffsetPlans,
  nonAcceptedOffsetOutputs,
} from "@/contracts/sketch/offset-publication";
import type { SketchOffsetPublicationRecord } from "@/contracts/solver/schema";
import type {
  SketchDragFeedback,
  SketchEditQueryClick,
  SketchEditQueryState,
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
  createSessionCommitFactories,
  hasAcceptedLiveSolveOfDefinition,
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

/**
 * T10i (C3, T10 review A8): an edit tool refused an input that is a
 * non-accepted offset output (the G19 predicate, with its G16‴ closure over
 * mirror/pattern/transform copies), parallel to the feature-input code
 * `feature-input-offset-not-certified` ([TECH] G19c).
 */
export const NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE =
  "edit-input-offset-not-certified";

/**
 * T10i (C3; review R-1): the gate on an edit's inputs. Null when no input
 * is a non-accepted offset output of the session's live solve; otherwise
 * the targeted message for the first such input, naming its relationship
 * and the edit `use`.
 * - `pending`: the live solve's publication round is still running
 *   (`liveRegions.status === "pending"`), so acceptance is undecidable
 *   (every edit starts a round whose snapshot certifies nothing yet). The
 *   input is not usable yet, the message says it is being checked, and the
 *   tool is re-evaluated when the round completes
 *   (`refreshSketchEditToolAfterOffsetRound`).
 * - otherwise it is decided: `edit-input-offset-not-certified`, with the
 *   G19a snapshot rule (no `certifiedOffsetDerivationIds`, or no live
 *   solve, accepts no offset output).
 * A derived offset shell is skipped: it is never an edit input (U-G2), and
 * each edit refuses it with that permanent message.
 */
export function offsetEditInputGate(
  session: SketchSessionState,
  entityIds: readonly SketchEntityId[],
  use: string,
): { readonly pending: boolean; readonly message: string } | null {
  if (entityIds.length === 0) return null;
  const nonAccepted = nonAcceptedOffsetOutputs(
    session.definition,
    session.liveSolve?.solvedSnapshot ?? { solvedEntities: [] },
  );
  const shells = new Set(
    session.definition.entities.flatMap((entity) =>
      entity.kind === "derivedPiecewiseCubic" ? [entity.entityId] : [],
    ),
  );
  const pending =
    session.liveSolve !== null && session.liveRegions.status === "pending";
  for (const entityId of entityIds) {
    const owner = nonAccepted.get(entityId);
    if (!owner || shells.has(entityId)) continue;
    return pending
      ? {
          pending,
          message: `Sketch entity ${entityId} is an output of offset relationship ${owner.derivationId}, which is still being checked; it can be used as ${use} once the check finishes.`,
        }
      : {
          pending,
          message: `${NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE}: Sketch entity ${entityId} is an output of offset relationship ${owner.derivationId}, which is not certified, so it cannot be used as ${use}.`,
        };
  }
  return null;
}

function refusedEditOperation(message: string): SketchEditOperationResult {
  return {
    valid: false,
    message,
    definition: null,
    contribution: null,
    previewEntities: [],
  };
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
    activeSnap: null,
    drawStartSnap: null,
    toolChain: null,
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

  const seedEntityIds = sketchEntityTargets.map((target) => target.entityId);
  // T10i (C3): an offset seed (direct, or a G16‴ copy of one) must be
  // accepted geometry.
  const gate = offsetEditInputGate(session, seedEntityIds, "an offset seed");
  if (gate) return refusedEditOperation(gate.message);

  return createSketchOffsetDerivationContribution({
    definition: session.definition,
    entityIds: seedEntityIds,
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

/**
 * Commits a certified (or static) offset contribution. T10i (C3): a derived
 * offset's seeds are re-checked against the live solve at this (possibly
 * asynchronous) apply, and nothing is committed unless they are accepted.
 * A seed whose live round is still pending drops the staged check and shows
 * the pending message; the tool re-stages it when the round completes
 * (`refreshSketchEditToolAfterOffsetRound`, review R-1), and Commit is
 * asked again. A seed decided non-accepted fails the preview.
 */
function commitOffsetContribution(
  session: SketchSessionState,
  activeEditTool: SketchEditToolState,
  contribution: NonNullable<SketchEditOperationResult["contribution"]>,
): SketchSessionState {
  const gate = offsetEditInputGate(
    session,
    (contribution.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset" ? relationship.seedEntityIds : [],
    ),
    "an offset seed",
  );
  if (gate) {
    // Only a derived offset has seeds, and it commits from a staged check.
    const publication = activeEditTool.offsetPublication;
    if (!publication)
      throw new Error(
        "A derived offset commit must come from its staged publication.",
      );
    if (gate.pending) {
      const tool = withoutOffsetPublication(activeEditTool);
      return {
        ...session,
        activeEditTool: tool,
        validationMessage: gate.message,
        toolPresentation: buildSketchEditToolPresentation(
          tool,
          gate.message,
          session.toolStagedEntities,
        ),
      };
    }
    return withOffsetPublication(session, activeEditTool, {
      ...publication,
      status: "failed",
      commitRequested: false,
      message: gate.message,
    });
  }
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
  // T10i (C3, review A8): one gate over the operation's full input set (its
  // selected targets, boundaries, sources, references and mirror axis),
  // also at commit, which recomputes this result. The edit-query tools
  // (Trim, Extend, Split) gate their clicks themselves.
  if (
    !isSketchEditQueryTool(activeEditTool.toolId) &&
    activeEditTool.toolId !== "offset"
  ) {
    const gate = offsetEditInputGate(
      session,
      entityIds,
      `a ${getSketchEditToolDefinition(activeEditTool.toolId).metadata.name} input`,
    );
    if (gate) return refusedEditOperation(gate.message);
  }
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
    case "sketchExtend":
    case "sketchSplit":
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

/**
 * T10i review R-1: re-evaluates the active edit tool's current selection
 * after an offset publication round settles (the editor applies it to
 * every live-region result, published or failed), so a "still being
 * checked" input clears or becomes its decided refusal without reselection.
 * Only the preview, message and presentation change: nothing is applied
 * (no Mirror auto-apply, no Commit). An Offset with a staged
 * check keeps it (its own completion re-checks the seeds); one without
 * (refused or still checking) re-stages its preview, whose check the
 * editor loop then emits. The edit-query tools (Trim, Extend, Split)
 * advance their queued clicks instead (T10g-1, review R-1: a click deferred
 * while the round was pending is queried now); an Extend/Split selection
 * still being made only has its message re-evaluated.
 */
export function refreshSketchEditToolAfterOffsetRound(
  session: SketchSessionState,
): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool && isSketchEditQueryTool(tool.toolId)) {
    const advanced = advanceSketchEditQueryQueue(session);
    if (tool.selectedTargets.length === 0) return advanced;
    const message =
      editSelectionMessage(advanced, advanced.activeEditTool!) ??
      advanced.validationMessage;
    return {
      ...advanced,
      validationMessage: message,
      toolPresentation: buildSketchEditToolPresentation(
        advanced.activeEditTool!,
        message,
      ),
    };
  }
  if (!tool || tool.selectedTargets.length === 0) return session;
  if (tool.toolId === "offset") {
    if (tool.offsetPublication) return session;
    const preview = getOffsetPreview(session, tool);
    return {
      ...session,
      activeEditTool: stageOffsetPreviewPublication(session, tool, preview),
      toolStagedEntities: preview.previewEntities,
      validationMessage: preview.valid ? null : preview.message,
      toolPresentation: buildSketchEditToolPresentation(
        tool,
        preview.message,
        preview.previewEntities,
      ),
    };
  }
  const preview = getSketchEditOperatorResult(session, tool);
  return {
    ...session,
    toolStagedEntities: preview.previewEntities,
    validationMessage: preview.valid ? null : preview.message,
    toolPresentation: buildSketchEditToolPresentation(
      tool,
      preview.message,
      preview.previewEntities,
    ),
  };
}

export const SKETCH_EDIT_QUERY_CHECKING_MESSAGE = "Checking intersections…";
export const TRIM_STALE_MESSAGE = editQueryStaleMessage("trim");
export const TRIM_BASIS_NOT_ACCEPTED_MESSAGE =
  editQueryBasisNotAcceptedMessage("trim");

/** The tools whose edits wait for exact edit intersections (T10g-1, T10g-2). */
type SketchEditQueryToolId = "trim" | "sketchExtend" | "sketchSplit";

export function isSketchEditQueryTool(
  toolId: SketchEditToolState["toolId"],
): toolId is SketchEditQueryToolId {
  return (
    toolId === "trim" || toolId === "sketchExtend" || toolId === "sketchSplit"
  );
}

const EDIT_QUERY_KINDS = {
  trim: "trim",
  sketchExtend: "extend",
  sketchSplit: "split",
} as const;

/** "<Tool> was not applied: the sketch changed …" (design §2.9 `edit-stale`). */
export function editQueryStaleMessage(
  kind: SketchEditOperation["kind"],
): string {
  return `${editQueryToolName(kind)} was not applied: the sketch changed while its intersections were being checked. Click again.`;
}

/** "<Tool> needs a solved sketch; …" (design §2.9 `edit-basis-not-accepted`). */
export function editQueryBasisNotAcceptedMessage(
  kind: SketchEditOperation["kind"],
): string {
  return `${editQueryToolName(kind)} needs a solved sketch; resolve the conflicting constraints first.`;
}

function editQueryToolName(kind: SketchEditOperation["kind"]) {
  return kind === "trim" ? "Trim" : kind === "extend" ? "Extend" : "Split";
}

/** The C3 `use` of an edit-query input (Extend/Split keep T10i's wording). */
function editQueryInputUse(toolId: SketchEditQueryToolId, click: boolean) {
  return toolId === "trim"
    ? click
      ? "a Trim target"
      : "a Trim input"
    : `a ${getSketchEditToolDefinition(toolId).metadata.name} input`;
}

/** The edit-query tool with `editQuery`; `message` is shown (else "Checking…" while clicks wait). */
function withEditQuery(
  session: SketchSessionState,
  editQuery: SketchEditQueryState,
  message: string | null,
): SketchSessionState {
  const tool = { ...session.activeEditTool!, editQuery };
  return {
    ...session,
    activeEditTool: tool,
    validationMessage: message,
    toolPresentation: buildSketchEditToolPresentation(
      tool,
      message ??
        (editQuery.queue.length > 0
          ? SKETCH_EDIT_QUERY_CHECKING_MESSAGE
          : null),
    ),
  };
}

/** The click's entity ids: the target, then the Extend/Split boundary. */
function clickEntityIds(click: SketchEditQueryClick) {
  return click.boundary
    ? [click.targetEntityId, click.boundary.entityId]
    : [click.targetEntityId];
}

/**
 * Why a click cannot be queried now, decided before any query runs: the
 * target kind (Trim: `trimTargetRefusal`; Extend/Split: a line and a line,
 * Q-g3), the accepted live solve of the current definition, and a decided
 * C3 refusal of an input (a pending one defers instead, review R-1).
 */
function editQueryClickRefusal(
  session: SketchSessionState,
  toolId: SketchEditQueryToolId,
  click: SketchEditQueryClick,
) {
  const kind = EDIT_QUERY_KINDS[toolId];
  const gate = offsetEditInputGate(
    session,
    clickEntityIds(click),
    editQueryInputUse(toolId, true),
  );
  const kindRefusal =
    toolId === "trim"
      ? trimTargetRefusal(click.entity)
      : click.entity.kind === "lineSegment" &&
          click.boundary?.entity.kind === "lineSegment"
        ? null
        : toolId === "sketchExtend"
          ? EXTEND_TARGET_UNSUPPORTED_MESSAGE
          : SPLIT_TARGET_UNSUPPORTED_MESSAGE;
  return (
    kindRefusal ??
    (hasAcceptedLiveSolveOfDefinition(session)
      ? null
      : editQueryBasisNotAcceptedMessage(kind)) ??
    (gate && !gate.pending ? gate.message : null)
  );
}

/** The click on `targetEntityId` (and an Extend/Split `boundaryEntityId`), or null if gone. */
function editQueryClick(
  session: SketchSessionState,
  targetEntityId: SketchEntityId,
  boundaryEntityId: SketchEntityId | null,
): SketchEditQueryClick | null {
  const find = (entityId: SketchEntityId) =>
    session.definition.entities.find(
      (candidate) => candidate.entityId === entityId,
    );
  const entity = find(targetEntityId);
  const boundary = boundaryEntityId ? find(boundaryEntityId) : null;
  if (!entity || (boundaryEntityId && !boundary)) return null;
  return {
    targetEntityId,
    entity,
    ...(boundary
      ? { boundary: { entityId: boundaryEntityId!, entity: boundary } }
      : {}),
  };
}

/**
 * T10g-1 (design §2.7): a Trim click, or (T10g-2) a completed Extend/Split
 * selection. Target kind and the accepted live solve of the current
 * definition are checked now (every sketch entry establishes a live solve,
 * T11a); C3 refuses a decided non-accepted input
 * and defers a pending one (review R-1). The click is queued with its
 * entities' identities (R-5); nothing is authored until its exact
 * intersections arrive.
 */
function queueSketchEditQueryClick(
  session: SketchSessionState,
  tool: SketchEditToolState,
  click: SketchEditQueryClick,
): SketchSessionState {
  const editQuery = tool.editQuery ?? { queue: [], inFlight: null };
  const refusal = editQueryClickRefusal(
    session,
    tool.toolId as SketchEditQueryToolId,
    click,
  );
  if (refusal) return withEditQuery(session, editQuery, refusal);
  return advanceSketchEditQueryQueue(
    withEditQuery(
      session,
      { ...editQuery, queue: [...editQuery.queue, click] },
      null,
    ),
  );
}

/**
 * T10g-1: issues the head click's query when nothing is in flight (Trim,
 * and T10g-2 Extend/Split). A head whose target or boundary changed since
 * its click is dropped as stale (R-5). The query runs on the accepted live
 * solve of the current definition only (R-6); with offset relationships it
 * waits while the publication round is pending (R-1: the basis must say
 * which offset outputs are accepted), and so does a click whose C3 gate is
 * still pending. Unchanged when nothing waits.
 */
export function advanceSketchEditQueryQueue(
  session: SketchSessionState,
  initialMessage: string | null = null,
): SketchSessionState {
  const tool = session.activeEditTool;
  const editQuery = tool?.editQuery;
  if (!tool || !isSketchEditQueryTool(tool.toolId) || !editQuery)
    return session;
  if (editQuery.inFlight || (editQuery.queue.length === 0 && !initialMessage))
    return session;
  const kind = EDIT_QUERY_KINDS[tool.toolId];
  let message = initialMessage;
  const queue = [...editQuery.queue];
  for (;;) {
    const head = queue[0];
    if (!head) return withEditQuery(session, { ...editQuery, queue }, message);
    const current = (entityId: SketchEntityId) =>
      session.definition.entities.find(
        (entity) => entity.entityId === entityId,
      );
    const gate = offsetEditInputGate(
      session,
      clickEntityIds(head),
      editQueryInputUse(tool.toolId, true),
    );
    const refusal =
      current(head.targetEntityId) !== head.entity ||
      (head.boundary &&
        current(head.boundary.entityId) !== head.boundary.entity)
        ? editQueryStaleMessage(kind)
        : !hasAcceptedLiveSolveOfDefinition(session)
          ? editQueryBasisNotAcceptedMessage(kind)
          : gate && !gate.pending
            ? gate.message
            : null;
    if (refusal) {
      queue.shift();
      message = refusal;
      continue;
    }
    const offsets = (session.definition.derivedRelationships ?? []).some(
      (relationship) => relationship.kind === "offset",
    );
    if (gate || (offsets && session.liveRegions.status === "pending"))
      return withEditQuery(
        session,
        { ...editQuery, queue },
        message ?? gate?.message ?? null,
      );
    const liveSolve = session.liveSolve!;
    const operation: SketchEditOperation = head.boundary
      ? {
          kind: kind as "extend" | "split",
          targetEntityId: head.targetEntityId,
          boundaryEntityId: head.boundary.entityId,
        }
      : { kind: "trim", targetEntityId: head.targetEntityId };
    return withEditQuery(
      session,
      {
        queue,
        inFlight: {
          // Review R-1: unique across tool activations (a new tool after
          // Esc starts a fresh queue), so a result of a cancelled query
          // never matches a later click's query.
          queryId: `${kind}-query-${crypto.randomUUID()}`,
          definition: session.definition,
          generation: session.liveRegions.generation,
          input: {
            definition: liveSolve.definition,
            solvedSnapshot: liveSolve.solvedSnapshot,
            projectedReferences: liveSolve.projectedReferences,
            modelingTolerance: session.modelingTolerance,
            operation,
          },
        },
      },
      message,
    );
  }
}

/**
 * The builder of the in-flight operation (Trim, Extend or Split) on the
 * snapshot its intersections were certified on.
 */
function buildEditQueryMutation(
  session: SketchSessionState,
  input: SketchEditIntersectionInput,
  result: Extract<SketchEditIntersectionResult, { kind: "verified" }>,
  sequence: number,
): SketchMutationResult {
  const { operation } = input;
  const factories = createSessionCommitFactories(
    sequence,
    session.sketchId ?? ("sketch_draft" as SketchId),
  );
  const common = {
    definition: session.definition,
    targetEntityId: operation.targetEntityId,
    intersections: result,
    factories,
  };
  switch (operation.kind) {
    case "trim":
      return createSketchTrimMutation({
        ...common,
        solvedSnapshot: input.solvedSnapshot,
      });
    case "extend":
      return createSketchExtendMutation({ ...common, sequence });
    case "split":
      return createSketchSplitMutation({ ...common, sequence });
  }
}

/**
 * T10g-1 (design §2.7/§2.8), for Trim and (T10g-2) Extend/Split: the exact
 * intersections of the in-flight query `queryId` (ignored unless it is
 * still the one in flight).
 * - The definition changed meanwhile (an edit, Undo/Redo): discarded with
 *   the stale message.
 * - Only the live solve changed (a re-solve, a publication: a new
 *   generation or snapshot, review A-4): queried again for the head.
 * - Otherwise a failure shows its message, and a verified result applies as
 *   one authored edit, after C3 over target, cut cutters (Extend/Split: the
 *   boundary) and the non-accepted outputs near a Trim target (T-g5); the
 *   next click follows.
 */
export function completeSketchEditQuery(
  session: SketchSessionState,
  queryId: string,
  result: SketchEditIntersectionResult,
): SketchSessionState {
  const tool = session.activeEditTool;
  const editQuery = tool?.editQuery;
  const inFlight = editQuery?.inFlight;
  if (
    !tool ||
    !isSketchEditQueryTool(tool.toolId) ||
    inFlight?.queryId !== queryId
  )
    return session;
  const { operation } = inFlight.input;
  const cleared = { ...editQuery!, inFlight: null };
  const popped = { ...cleared, queue: cleared.queue.slice(1) };
  if (session.definition !== inFlight.definition)
    return advanceSketchEditQueryQueue(
      withEditQuery(session, popped, null),
      editQueryStaleMessage(operation.kind),
    );
  if (
    session.liveRegions.generation !== inFlight.generation ||
    session.liveSolve?.solvedSnapshot !== inFlight.input.solvedSnapshot
  )
    return advanceSketchEditQueryQueue(withEditQuery(session, cleared, null));
  const gate = offsetEditInputGate(
    session,
    [
      operation.targetEntityId,
      ...(operation.kind === "trim" ? [] : [operation.boundaryEntityId]),
      ...(result.kind === "verified"
        ? [result.cuts[0]!, result.cuts.at(-1)!].flatMap((cut) =>
            cut.cutters.map((cutter) => cutter.entityId),
          )
        : []),
      ...result.nonAcceptedNearTarget,
    ],
    editQueryInputUse(tool.toolId, false),
  );
  if (gate?.pending)
    return advanceSketchEditQueryQueue(withEditQuery(session, cleared, null));
  if (gate)
    return advanceSketchEditQueryQueue(
      withEditQuery(session, popped, null),
      gate.message,
    );
  if (result.kind === "failed")
    return advanceSketchEditQueryQueue(
      withEditQuery(session, popped, null),
      result.message,
    );
  const nextSequence = session.sequence + 1;
  const mutation = buildEditQueryMutation(
    session,
    inFlight.input,
    result,
    nextSequence,
  );
  if (!mutation.changed)
    return advanceSketchEditQueryQueue(
      withEditQuery(session, popped, null),
      mutation.message,
    );
  const applied = withLiveSolveBasis(
    {
      ...withEditQuery(session, popped, null),
      definition: mutation.definition,
      toolStagedEntities: [],
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, mutation.definition),
      activeEditTarget: null,
      activeDrag: null,
    },
    mutation.definition,
  );
  return advanceSketchEditQueryQueue(
    applied,
    freedFitPointsMessage(
      session.definition,
      mutation.definition,
      operation.targetEntityId,
    ),
  );
}

/**
 * T10g-3b (user decision Q-g2): the fit points of a trimmed spline that no
 * curve uses any more stay as free points with their constraints; the
 * tool message says how many. Null when there are none (every other edit).
 */
function freedFitPointsMessage(
  before: SketchDefinition,
  after: SketchDefinition,
  targetEntityId: SketchEntityId,
) {
  const target = before.entities.find(
    (entity) => entity.entityId === targetEntityId,
  );
  if (target?.kind !== "spline") return null;
  const used = new Set(after.entities.flatMap(getEntityPointIds));
  const freed = new Set(
    getEntityPointIds(target).filter((pointId) => !used.has(pointId)),
  ).size;
  if (freed === 0) return null;
  return freed === 1
    ? `Trim left 1 fit point of ${target.label} as a free point (with its constraints): the removed part used it.`
    : `Trim left ${freed} fit points of ${target.label} as free points (with their constraints): the removed part used them.`;
}

/** T10g-1: the in-flight edit query failed (a real error): nothing is applied. */
export function failSketchEditQuery(
  session: SketchSessionState,
  queryId: string,
  message: string,
): SketchSessionState {
  const tool = session.activeEditTool;
  const editQuery = tool?.editQuery;
  const inFlight = editQuery?.inFlight;
  if (
    !tool ||
    !isSketchEditQueryTool(tool.toolId) ||
    inFlight?.queryId !== queryId
  )
    return session;
  return advanceSketchEditQueryQueue(
    withEditQuery(
      session,
      { ...editQuery!, inFlight: null, queue: editQuery!.queue.slice(1) },
      null,
    ),
    `${editQueryToolName(inFlight.input.operation.kind)} failed: ${message}`,
  );
}

/**
 * C3 over an Extend/Split selection still being made (decided or still
 * being checked), or the refusal of a complete selection; null when none.
 */
function editSelectionMessage(
  session: SketchSessionState,
  tool: SketchEditToolState,
) {
  const entityIds = getSelectedSketchEntityIds(tool);
  if (entityIds.length === 2) {
    const click = editQueryClick(session, entityIds[0]!, entityIds[1]!);
    return click
      ? editQueryClickRefusal(
          session,
          tool.toolId as SketchEditQueryToolId,
          click,
        )
      : null;
  }
  return (
    offsetEditInputGate(
      session,
      entityIds,
      editQueryInputUse(tool.toolId as SketchEditQueryToolId, true),
    )?.message ?? null
  );
}

/**
 * T10g-2: an Extend/Split selection (target, then boundary). A complete one
 * is queued as one click (`queueSketchEditQueryClick`) and the selection
 * restarts; a refused one keeps the selection and shows why. An incomplete
 * one shows its C3 state.
 */
function selectSketchEditQueryTargets(
  session: SketchSessionState,
  tool: SketchEditToolState,
): SketchSessionState {
  const entityIds = getSelectedSketchEntityIds(tool);
  const click =
    entityIds.length === 2
      ? editQueryClick(session, entityIds[0]!, entityIds[1]!)
      : null;
  const message = editSelectionMessage(session, tool);
  if (click && !message) {
    const reset = { ...tool, selectedTarget: null, selectedTargets: [] };
    return queueSketchEditQueryClick(
      { ...session, activeEditTool: reset, toolStagedEntities: [] },
      reset,
      click,
    );
  }
  return {
    ...session,
    activeEditTool: tool,
    toolStagedEntities: [],
    validationMessage: message,
    toolPresentation: buildSketchEditToolPresentation(tool, message),
  };
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
      : isSketchEditQueryTool(activeEditTool.toolId)
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
    const click = editQueryClick(session, target.entityId, null);
    return click
      ? queueSketchEditQueryClick(session, activeEditTool, click)
      : session;
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
  if (isSketchEditQueryTool(nextEditTool.toolId))
    return selectSketchEditQueryTargets(session, nextEditTool);
  const preview = getSketchEditOperatorResult(session, nextEditTool);

  if (
    nextEditTool.toolId === "sketchMirror" &&
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

  // T10g-2: Extend/Split commit a complete selection as its click (an
  // incomplete one, e.g. already queued, commits nothing).
  if (isSketchEditQueryTool(activeEditTool.toolId))
    return getSelectedSketchEntityIds(activeEditTool).length === 2
      ? selectSketchEditQueryTargets(session, activeEditTool)
      : session;

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
  explicitHandle?: SketchDragHandle,
): SketchSessionState {
  // Guards: must be in a compatible state.
  if (
    session.status === "drawing" ||
    (session.activeTool !== null && !isDrawingSketchTool(session.activeTool))
  ) {
    return session;
  }

  // D9: non-draggable targets return unchanged.
  if (
    target.kind !== "sketchPoint" &&
    target.kind !== "sketchEntity" &&
    target.kind !== "sketchTangentHandle"
  ) {
    return session;
  }

  // Resolve the handle from the explicit parameter or from the PrimitiveRef + definition.
  const handle: SketchDragHandle | null =
    explicitHandle ?? resolveHandleFromTarget(session.definition, target);
  if (!handle) {
    return session;
  }

  // Resolve the drag intent.
  const intent = resolveSketchDragIntent(session.definition, handle);
  if (!intent) {
    return session;
  }

  // For point targets, select the edit target (existing behavior).
  let base = session;
  if (target.kind === "sketchPoint") {
    const selected = selectSketchEditTarget(session, target);
    if (
      !selected.activeEditTarget ||
      selected.activeEditTarget.pointId !== target.pointId
    ) {
      return session;
    }
    base = selected;
  }

  // D1: automatic → authored conversion at handle grab.
  // Grabbing an automatic tangent's handle converts it to authored with the
  // visible (mean-arm) vector so the curve does not change at grab, then
  // recompiles the session. Cancel restores the original definition.
  let workingDefinition = base.definition;
  if (intent.kind === "tangentVector" && handle.kind === "tangentHandle") {
    const converted = convertAutomaticTangentToAuthored(
      workingDefinition,
      intent.entityId,
      intent.occurrenceId,
    );
    if (converted) {
      workingDefinition = converted;
    }
  }

  return startDragWithIntent(
    base,
    workingDefinition,
    target,
    handle,
    intent,
    point,
  );
}

// D10 handle resolution is now exported from drag-intent.ts.

/**
 * Convert an automatic tangent to authored using the visible (mean-arm)
 * vector from the spline reconstruction. Returns the mutated definition,
 * or null if the tangent is already authored or the reconstruction fails.
 */
function convertAutomaticTangentToAuthored(
  definition: SketchDefinition,
  entityId: SketchEntityId,
  occurrenceId: string,
): SketchDefinition | null {
  const entity = definition.entities.find((e) => e.entityId === entityId);
  if (!entity || entity.kind !== "spline") return null;
  const ordered = orderedSplineOccurrences(entity);
  if (!ordered) return null;
  const occIndex = ordered.findIndex(
    (occ) => occ.occurrenceId === occurrenceId,
  );
  if (occIndex < 0) return null;
  const occurrence = ordered[occIndex]!;
  if (occurrence.tangent.kind === "authored") return null;

  // Reconstruct the spline to get the visible automatic vector.
  const positions = Object.fromEntries(
    definition.points.map((p) => [p.pointId, p.position]),
  ) as Record<SketchPointId, readonly [number, number]>;
  const reconstruction = reconstructSplineAggregate(entity, positions);
  if (reconstruction.validity !== "valid") return null;
  const visibleVector = reconstruction.handles[occIndex];
  if (!visibleVector) return null;

  // Mutate the definition to convert this occurrence to authored.
  return {
    ...definition,
    entities: definition.entities.map((e) => {
      if (e.entityId !== entityId || e.kind !== "spline") return e;
      return {
        ...e,
        pointOccurrences: e.pointOccurrences.map((occ) =>
          occ.occurrenceId === occurrenceId
            ? {
                ...occ,
                tangent: { kind: "authored" as const, vector: visibleVector },
              }
            : occ,
        ),
      };
    }),
  };
}

/** Start the drag with the resolved intent. */
function startDragWithIntent(
  session: SketchSessionState,
  workingDefinition: SketchDefinition,
  target: PrimitiveRef,
  handle: SketchDragHandle,
  intent: SketchDragIntent,
  pointerDown: SketchPoint,
): SketchSessionState {
  const grabOffset = computeGrabOffset(workingDefinition, intent, pointerDown);

  // B14: a sketch whose requirements are not acceptable has no drag session.
  const started = startInteractiveSolveSessionForDrag(
    workingDefinition,
    session.projectedReferences,
    session.solverTolerances,
    getSketchSessionDerivationSettings(session),
    intent,
    session.offsetPlans,
  );
  if (started.kind === "unacceptable") {
    return { ...session, validationMessage: started.message };
  }
  const interactiveSolveSession = started.session;

  // If the definition was modified (auto→authored conversion), update it.
  const baseSession =
    workingDefinition !== session.definition
      ? { ...session, definition: workingDefinition }
      : session;

  return {
    ...baseSession,
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
      handle,
      intent,
      preDragDefinition: session.definition,
      startPoint: pointerDown,
      currentPoint: pointerDown,
      grabOffset,
      status: "dragging",
      message: null,
      interactiveSolveSession,
    },
    validationMessage: null,
  };
}

/**
 * Compute the grab offset between the pointer-down position and the
 * logical position of the drag target. The offset is applied every frame
 * so the target never jumps to the pointer.
 */
function computeGrabOffset(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  pointerDown: SketchPoint,
): SketchPoint {
  switch (intent.kind) {
    case "point": {
      const pointDef = definition.points.find(
        (p) => p.pointId === intent.pointId,
      );
      if (!pointDef) return [0, 0];
      return [
        pointDef.position[0] - pointerDown[0],
        pointDef.position[1] - pointerDown[1],
      ];
    }
    case "translate": {
      // For body drags, the pointer is the reference for the shared delta.
      // Offset is the first point's position minus the pointer.
      const firstPointDef = definition.points.find(
        (p) => p.pointId === intent.pointIds[0],
      );
      if (!firstPointDef) return [0, 0];
      return [
        firstPointDef.position[0] - pointerDown[0],
        firstPointDef.position[1] - pointerDown[1],
      ];
    }
    case "radius": {
      // A-1: scalar radial offset stored as [radialOffset, 0].
      // targetRadius = |pointer − centre| + radialOffset, so
      // radialOffset = currentRadius − |pointerDown − centre|.
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc"))
        return [0, 0];
      const center = definition.points.find(
        (p) => p.pointId === entity.centerPointId,
      );
      if (!center) return [0, 0];
      const distToPointer = Math.hypot(
        pointerDown[0] - center.position[0],
        pointerDown[1] - center.position[1],
      );
      const currentRadius =
        entity.kind === "circle"
          ? entity.radius
          : Math.hypot(
              definition.points.find((p) => p.pointId === entity.startPointId)!
                .position[0] - center.position[0],
              definition.points.find((p) => p.pointId === entity.startPointId)!
                .position[1] - center.position[1],
            );
      return [currentRadius - distToPointer, 0];
    }
    case "tangentVector": {
      // For handle drags, the offset is the handle tip (fit point + vector)
      // minus the pointer. The definition may already have been converted
      // from automatic to authored at this point.
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || entity.kind !== "spline") return [0, 0];
      const occurrence = entity.pointOccurrences.find(
        (occ) => occ.occurrenceId === intent.occurrenceId,
      );
      if (!occurrence) return [0, 0];
      const fitPoint = definition.points.find(
        (p) => p.pointId === occurrence.pointId,
      );
      if (!fitPoint) return [0, 0];
      if (occurrence.tangent.kind === "authored") {
        const tipX = fitPoint.position[0] + occurrence.tangent.vector[0];
        const tipY = fitPoint.position[1] + occurrence.tangent.vector[1];
        return [tipX - pointerDown[0], tipY - pointerDown[1]];
      }
      // Automatic tangent: compute visible vector from reconstruction.
      const positions = Object.fromEntries(
        definition.points.map((p) => [p.pointId, p.position]),
      ) as Record<SketchPointId, readonly [number, number]>;
      const reconstruction = reconstructSplineAggregate(entity, positions);
      if (reconstruction.validity !== "valid") return [0, 0];
      const ordered = orderedSplineOccurrences(entity);
      if (!ordered) return [0, 0];
      const occIdx = ordered.findIndex(
        (occ) => occ.occurrenceId === intent.occurrenceId,
      );
      if (occIdx < 0) return [0, 0];
      const vec = reconstruction.handles[occIdx]!;
      return [
        fitPoint.position[0] + vec[0] - pointerDown[0],
        fitPoint.position[1] + vec[1] - pointerDown[1],
      ];
    }
  }
}

export function updateSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  options?: { exactZero?: boolean },
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  return applySketchGeometryDrag(session, point, false, options);
}

export function finishSketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  options?: { exactZero?: boolean },
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  const drag = session.activeDrag;
  const updated = applySketchGeometryDrag(session, point, true, options);
  // A gesture with no accepted frame (click-only, or every frame blocked)
  // restores the pre-drag state, undoing an automatic→authored tangent
  // conversion made at grab. Otherwise the last accepted frame is kept.
  if (!drag.acceptedFrame && updated.definition === session.definition) {
    return {
      ...cancelSketchGeometryDrag(session),
      validationMessage: updated.validationMessage,
    };
  }
  if (drag.interactiveSolveSession) {
    drag.interactiveSolveSession.disposed = true;
  }

  return {
    ...updated,
    activeDrag: null,
  };
}

/**
 * Cancel the current drag gesture, restoring the exact pre-drag state
 * (definition including any automatic→authored tangent conversion at grab,
 * live/solved basis consistent with that definition) with no history entry.
 * T12c will wire Escape/pointercancel/tool switch/Finish to this function.
 */
export function cancelSketchGeometryDrag(
  session: SketchSessionState,
): SketchSessionState {
  if (!session.activeDrag) {
    return session;
  }

  const interactiveSolveSession = session.activeDrag.interactiveSolveSession;
  if (interactiveSolveSession) {
    interactiveSolveSession.disposed = true;
  }

  const { preDragDefinition } = session.activeDrag;
  const restored = {
    ...session,
    definition: preDragDefinition,
    activeDrag: null,
  };
  // Without an accepted frame or grab conversion the basis is still current.
  return preDragDefinition === session.definition
    ? restored
    : withLiveSolveBasis(restored, preDragDefinition);
}

export function applySketchGeometryDrag(
  session: SketchSessionState,
  point: SketchPoint,
  complete: boolean,
  options?: { exactZero?: boolean },
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

  // Build the SketchDragTarget from the intent, raw pointer, and grab offset.
  // For most intents, the solver target is pointer + offset (Cartesian).
  // For radius, the offset is a scalar radial offset applied differently.
  const dragTarget = buildDragTarget(
    session.definition,
    drag.intent,
    point,
    drag.grabOffset,
    options?.exactZero,
  );

  const edit = solveDragEdit(
    session.definition,
    session.projectedReferences,
    session.solverTolerances,
    getSketchSessionDerivationSettings(session),
    drag.intent,
    dragTarget,
    drag.interactiveSolveSession,
  );

  if (edit.kind === "blocked") {
    // T12f: carry structured feedback on activeDrag; no global
    // validationMessage during the drag (issue 05: local cue only).
    return {
      ...session,
      activeDrag: complete
        ? null
        : {
            ...drag,
            currentPoint: point,
            status: "blocked",
            message: edit.message,
            feedback: edit.feedback ?? null,
          },
      // Only show validationMessage on the final (release) frame or when
      // the drag is complete, so the cue is the primary drag-time feedback.
      validationMessage: complete ? edit.message : null,
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
            // T12f: clear feedback on an accepted (moving) frame.
            feedback: null,
            acceptedFrame: true,
            interactiveSolveSession: edit.interactiveSolveSession,
          },
      commitRequest: rebuildSessionCommitRequest(session, definition),
      validationMessage: null,
    },
    definition,
    edit.solvedSnapshot,
  );
}

/**
 * T12b: build the solver drag target from the intent, raw pointer position,
 * and grab offset. Every intent maps to one SketchDragTarget variant.
 *
 * For point/translate/tangent intents, the offset is Cartesian:
 *   target = pointer + grabOffset.
 * For radius, the grab offset is a scalar radial offset (A-1):
 *   targetRadius = |pointer − centre| + grabOffset[0].
 */
function buildDragTarget(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  pointer: SketchPoint,
  grabOffset: SketchPoint,
  exactZero?: boolean,
): SketchDragTarget {
  // Cartesian offset for non-radius intents.
  const offsetPoint: SketchPoint = [
    pointer[0] + grabOffset[0],
    pointer[1] + grabOffset[1],
  ];

  switch (intent.kind) {
    case "point":
      return {
        kind: "sketchPoint",
        pointId: intent.pointId,
        position: offsetPoint,
      };
    case "translate": {
      // Delta = offsetPoint minus the first defining point's current position.
      const firstPoint = definition.points.find(
        (p) => p.pointId === intent.pointIds[0],
      );
      const delta: SketchPoint = firstPoint
        ? [
            offsetPoint[0] - firstPoint.position[0],
            offsetPoint[1] - firstPoint.position[1],
          ]
        : [0, 0];
      return {
        kind: "sketchTranslate",
        pointIds: intent.pointIds,
        delta,
      };
    }
    case "radius": {
      // A-1: scalar radial offset. targetRadius = |pointer − centre| + radialOffset.
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
        return {
          kind: "sketchRadius",
          entityId: intent.entityId,
          targetRadius: 1,
        };
      }
      const center = definition.points.find(
        (p) => p.pointId === entity.centerPointId,
      );
      const targetRadius = center
        ? Math.hypot(
            pointer[0] - center.position[0],
            pointer[1] - center.position[1],
          ) + grabOffset[0]
        : 1;
      return {
        kind: "sketchRadius",
        entityId: intent.entityId,
        targetRadius,
      };
    }
    case "tangentVector": {
      // Target vector = offsetPoint minus the fit point's position.
      const fitPoint = definition.points.find(
        (p) => p.pointId === intent.pointId,
      );
      const targetVector: SketchPoint = fitPoint
        ? [
            offsetPoint[0] - fitPoint.position[0],
            offsetPoint[1] - fitPoint.position[1],
          ]
        : [0, 0];
      return {
        kind: "sketchTangentVector",
        entityId: intent.entityId,
        occurrenceId: intent.occurrenceId,
        targetVector: exactZero ? [0, 0] : targetVector,
        exactZero,
      };
    }
  }
}

/** T12f: structured drag edit result with optional feedback cue. */
export type SolveDragEditResult =
  | {
      kind: "accepted";
      definition: SketchDefinition;
      solvedSnapshot?: SolvedSketchSnapshot;
      interactiveSolveSession: SketchCompiledSolveSession | null;
    }
  | {
      kind: "blocked";
      message: string;
      /** T12f: structured feedback for the viewport cue (issue 05). */
      feedback?: SketchDragFeedback;
    };

/**
 * T12b: generalized drag edit that routes every intent through the solver.
 * T12f: every blocked result includes structured feedback for the viewport
 * cue (issue 05) with kind, target position and short diagnostic text.
 */
export function solveDragEdit(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: SketchDerivationSettings,
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  interactiveSolveSession: SketchCompiledSolveSession | null = null,
): SolveDragEditResult {
  // Unconstrained fast path: no constraints or dimensions.
  if (
    definition.constraints.length === 0 &&
    definition.dimensions.length === 0
  ) {
    return applyUnconstrainedDrag(definition, intent, dragTarget, derivation);
  }

  let solveSession = interactiveSolveSession;
  if (!solveSession) {
    const started = startInteractiveSolveSessionForDrag(
      definition,
      projectedReferences,
      tolerances,
      derivation,
      intent,
    );
    if (started.kind === "unacceptable") {
      return {
        kind: "blocked",
        message: started.message,
        feedback: {
          kind: "failed",
          target: dragFeedbackTarget(definition, intent),
          text: "Sketch solve failed.",
        },
      };
    }
    solveSession = started.session;
  }

  const solved = solveSession
    ? updateCompiledSketchSolveSession(solveSession, dragTarget, 1e-4)
    : dragTarget.kind === "sketchPoint"
      ? solveSketchDefinitionWithDraggedPointTarget({
          definition,
          projectedReferences,
          dragTarget,
          tolerances,
          ...derivation,
          partialSolvePolicy: "failOnConflict",
          targetTolerance: 1e-4,
        })
      : {
          kind: "blocked" as const,
          reason: "missingPoint" as const,
          solvedSnapshot: null,
          diagnostics: [],
        };

  if (solved.kind !== "solved") {
    return {
      kind: "blocked",
      message: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
      feedback: {
        kind: "failed",
        target: dragFeedbackTarget(definition, intent),
        text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
      },
    };
  }

  // D6/T12f: constrained-movement feedback for every intent (not just point).
  const constrainedFeedback = detectConstrainedMovementFeedback(
    definition,
    intent,
    dragTarget,
    solved.solvedSnapshot,
    solveSession,
  );
  if (constrainedFeedback) {
    return {
      kind: "blocked",
      message: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
      feedback: constrainedFeedback,
    };
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

/**
 * T12f: detect constrained-movement feedback for every intent type.
 * Returns structured feedback when the drag target barely moved and has no
 * free DOF, or null when the motion is normal (partial constraint with
 * movement toward the pointer).
 */
function detectConstrainedMovementFeedback(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  solvedSnapshot: SolvedSketchSnapshot,
  solveSession: SketchCompiledSolveSession | null,
): SketchDragFeedback | null {
  if (!solveSession) return null;

  switch (intent.kind) {
    case "point": {
      if (dragTarget.kind !== "sketchPoint") return null;
      const solvedPoint = solvedSnapshot.solvedPoints.find(
        (p) => p.pointId === intent.pointId,
      );
      const previousPos = definition.points.find(
        (p) => p.pointId === intent.pointId,
      )?.position;
      if (!solvedPoint || !previousPos) return null;
      const requested = Math.hypot(
        dragTarget.position[0] - previousPos[0],
        dragTarget.position[1] - previousPos[1],
      );
      const moved = Math.hypot(
        solvedPoint.solvedPosition[0] - previousPos[0],
        solvedPoint.solvedPosition[1] - previousPos[1],
      );
      if (
        requested > CONSTRAINED_DRAG_REQUEST_EPSILON &&
        moved < requested * CONSTRAINED_DRAG_MOVE_FRACTION &&
        !sketchDraggedPointHasFreeDof(solveSession, intent.pointId)
      ) {
        return {
          kind: "constrained",
          target: previousPos,
          text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
        };
      }
      return null;
    }
    case "translate": {
      if (dragTarget.kind !== "sketchTranslate") return null;
      const delta = dragTarget.delta;
      const requested = Math.hypot(delta[0], delta[1]);
      if (requested <= CONSTRAINED_DRAG_REQUEST_EPSILON) return null;
      // Check if the first point barely moved.
      const firstPointId = intent.pointIds[0];
      if (!firstPointId) return null;
      const previousPos = definition.points.find(
        (p) => p.pointId === firstPointId,
      )?.position;
      const solvedPoint = solvedSnapshot.solvedPoints.find(
        (p) => p.pointId === firstPointId,
      );
      if (!previousPos || !solvedPoint) return null;
      const moved = Math.hypot(
        solvedPoint.solvedPosition[0] - previousPos[0],
        solvedPoint.solvedPosition[1] - previousPos[1],
      );
      if (
        moved < requested * CONSTRAINED_DRAG_MOVE_FRACTION &&
        !sketchDraggedPointHasFreeDof(solveSession, firstPointId)
      ) {
        return {
          kind: "constrained",
          target: previousPos,
          text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
        };
      }
      return null;
    }
    case "radius": {
      if (dragTarget.kind !== "sketchRadius") return null;
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc"))
        return null;
      const currentRadius = entity.kind === "circle" ? entity.radius : null;
      if (currentRadius === null) return null;
      const requestedDelta = Math.abs(dragTarget.targetRadius - currentRadius);
      const solvedEntity = solvedSnapshot.solvedEntities?.find(
        (e) => e.entityId === intent.entityId,
      );
      const solvedRadius =
        solvedEntity?.kind === "circle"
          ? solvedEntity.solvedRadius
          : currentRadius;
      const movedDelta = Math.abs(solvedRadius - currentRadius);
      if (
        requestedDelta > CONSTRAINED_DRAG_REQUEST_EPSILON &&
        movedDelta < requestedDelta * CONSTRAINED_DRAG_MOVE_FRACTION
      ) {
        // Radius is constrained — show cue at rim position.
        const center = definition.points.find(
          (p) => p.pointId === entity.centerPointId,
        );
        const target: SketchPoint = center
          ? [center.position[0] + currentRadius, center.position[1]]
          : [0, 0];
        return {
          kind: "constrained",
          target,
          text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
        };
      }
      return null;
    }
    case "tangentVector": {
      // Tangent vectors are rarely fully constrained; the solver's acceptance
      // already handles the common cases. Skip constrained-movement feedback
      // for tangent vector intents (no DOF probe available for vectors).
      return null;
    }
  }
}

/**
 * T12f: compute the feedback cue target position from the intent's current
 * geometry position (before the drag frame).
 */
function dragFeedbackTarget(
  definition: SketchDefinition,
  intent: SketchDragIntent,
): SketchPoint {
  switch (intent.kind) {
    case "point": {
      const p = definition.points.find((pt) => pt.pointId === intent.pointId);
      return p?.position ?? [0, 0];
    }
    case "translate": {
      const p = definition.points.find(
        (pt) => pt.pointId === intent.pointIds[0],
      );
      return p?.position ?? [0, 0];
    }
    case "radius": {
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc"))
        return [0, 0];
      const center = definition.points.find(
        (p) => p.pointId === entity.centerPointId,
      );
      const radius = entity.kind === "circle" ? entity.radius : 1;
      return center
        ? [center.position[0] + radius, center.position[1]]
        : [0, 0];
    }
    case "tangentVector": {
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || entity.kind !== "spline") return [0, 0];
      const occ = entity.pointOccurrences.find(
        (o) => o.occurrenceId === intent.occurrenceId,
      );
      if (!occ) return [0, 0];
      const fitPoint = definition.points.find((p) => p.pointId === occ.pointId);
      if (!fitPoint) return [0, 0];
      if (occ.tangent.kind === "authored") {
        return [
          fitPoint.position[0] + occ.tangent.vector[0],
          fitPoint.position[1] + occ.tangent.vector[1],
        ];
      }
      return fitPoint.position;
    }
  }
}

/**
 * Unconstrained fast path: apply the drag target directly to the definition
 * without running the solver.
 */
function applyUnconstrainedDrag(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  derivation: SketchDerivationSettings,
):
  | {
      kind: "accepted";
      definition: SketchDefinition;
      interactiveSolveSession: null;
    }
  | { kind: "blocked"; message: string } {
  switch (intent.kind) {
    case "point": {
      if (dragTarget.kind !== "sketchPoint") break;
      return {
        kind: "accepted",
        definition: applyPointPositionsToDefinition(
          definition,
          [{ pointId: intent.pointId, position: dragTarget.position }],
          derivation,
        ),
        interactiveSolveSession: null,
      };
    }
    case "translate": {
      if (dragTarget.kind !== "sketchTranslate") break;
      const positions = intent.pointIds.map((pointId) => {
        const p = definition.points.find((pt) => pt.pointId === pointId);
        return {
          pointId,
          position: [
            (p?.position[0] ?? 0) + dragTarget.delta[0],
            (p?.position[1] ?? 0) + dragTarget.delta[1],
          ] as SketchPoint,
        };
      });
      return {
        kind: "accepted",
        definition: applyPointPositionsToDefinition(
          definition,
          positions,
          derivation,
        ),
        interactiveSolveSession: null,
      };
    }
    case "radius": {
      if (dragTarget.kind !== "sketchRadius") break;
      return {
        kind: "accepted",
        definition: {
          ...definition,
          entities: definition.entities.map((e) => {
            if (e.entityId !== intent.entityId) return e;
            if (e.kind === "circle")
              return { ...e, radius: Math.max(1e-9, dragTarget.targetRadius) };
            // Arcs: the unconstrained path does not modify arc radius
            // (it's derived from center+endpoints). The solver handles it.
            return e;
          }),
        },
        interactiveSolveSession: null,
      };
    }
    case "tangentVector": {
      if (dragTarget.kind !== "sketchTangentVector") break;
      return {
        kind: "accepted",
        definition: {
          ...definition,
          entities: definition.entities.map((e) => {
            if (e.entityId !== intent.entityId || e.kind !== "spline") return e;
            return {
              ...e,
              pointOccurrences: e.pointOccurrences.map((occ) =>
                occ.occurrenceId === intent.occurrenceId
                  ? {
                      ...occ,
                      tangent: {
                        kind: "authored" as const,
                        vector: dragTarget.targetVector,
                      },
                    }
                  : occ,
              ),
            };
          }),
        },
        interactiveSolveSession: null,
      };
    }
  }
  return { kind: "blocked", message: "Unsupported drag intent." };
}

function startInteractiveSolveSessionForDrag(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: SketchDerivationSettings,
  intent: SketchDragIntent,
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[],
):
  | { kind: "started"; session: SketchCompiledSolveSession | null }
  | { kind: "unacceptable"; message: string } {
  if (
    definition.constraints.length === 0 &&
    definition.dimensions.length === 0
  ) {
    return { kind: "started", session: null };
  }

  const sessionLabel =
    intent.kind === "point"
      ? intent.pointId
      : intent.kind === "translate"
        ? `translate_${intent.pointIds[0]}`
        : intent.kind === "radius"
          ? `radius_${intent.entityId}`
          : `tangent_${intent.entityId}_${intent.occurrenceId}`;

  // B7: apply carriedOffsetPlans for uniformity with other interactive solve
  // session starts (g5a re-review advisory 5).
  const carried = offsetPlans ? carriedOffsetPlans(offsetPlans) : undefined;

  const started = startCompiledSketchSolveSession({
    sessionId: `interactive_sketch_solve_drag_${sessionLabel}`,
    program: compileSketchSolveProgram({
      definition,
      projectedReferences,
      tolerances,
      ...derivation,
      offsetPlans: carried,
      partialSolvePolicy: "failOnConflict",
    }),
  });
  return started.kind === "started"
    ? started
    : {
        kind: "unacceptable",
        message: `Geometry can't be dragged until the sketch solves${
          started.diagnostic ? `: ${started.diagnostic.message}` : "."
        }`,
      };
}
