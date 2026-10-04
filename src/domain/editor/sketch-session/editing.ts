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
  createSketchTrimMutation,
  trimTargetRefusal,
} from "@/domain/sketch-editing/operations";
import type { SketchEditIntersectionResult } from "@/contracts/sketch/edit-intersections";
import type { OffsetFramePlan } from "@/contracts/sketch/offset-derivation-frame";
import { nonAcceptedOffsetOutputs } from "@/contracts/sketch/offset-publication";
import type { SketchOffsetPublicationRecord } from "@/contracts/solver/schema";
import type {
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
  // also at commit, which recomputes this result.
  if (activeEditTool.toolId !== "trim" && activeEditTool.toolId !== "offset") {
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

/**
 * T10i review R-1: re-evaluates the active edit tool's current selection
 * after an offset publication round settles (the editor applies it to
 * every live-region result, published or failed), so a "still being
 * checked" input clears or becomes its decided refusal without reselection.
 * Only the preview, message and presentation change: nothing is applied
 * (no Extend/Split/Mirror auto-apply, no Commit). An Offset with a staged
 * check keeps it (its own completion re-checks the seeds); one without
 * (refused or still checking) re-stages its preview, whose check the
 * editor loop then emits. Trim keeps no selection: its queued clicks are
 * advanced instead (T10g-1, review R-1: a click deferred while the round
 * was pending is queried now).
 */
export function refreshSketchEditToolAfterOffsetRound(
  session: SketchSessionState,
): SketchSessionState {
  const tool = session.activeEditTool;
  if (tool?.toolId === "trim") return advanceSketchTrimQueue(session);
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

export const TRIM_CHECKING_MESSAGE = "Checking intersections…";
export const TRIM_STALE_MESSAGE =
  "Trim was not applied: the sketch changed while its intersections were being checked. Click again.";
export const TRIM_BASIS_NOT_ACCEPTED_MESSAGE =
  "Trim needs a solved sketch; resolve the conflicting constraints first.";

/** The Trim tool with `editQuery`; `message` is shown (else "Checking…" while clicks wait). */
function withTrimQuery(
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
      message ?? (editQuery.queue.length > 0 ? TRIM_CHECKING_MESSAGE : null),
    ),
  };
}

/**
 * T10g-1 (design §2.7): a Trim click. Target kind and the accepted live
 * solve of the current definition are checked now (a session without a live
 * solve, e.g. just reopened, establishes it first); C3 refuses a decided
 * non-accepted target and defers a pending one (review R-1). The click is
 * queued with its target's identity (R-5); nothing is authored until its
 * exact intersections arrive.
 */
function queueSketchTrimClick(
  session: SketchSessionState,
  tool: SketchEditToolState,
  targetEntityId: SketchEntityId,
): SketchSessionState {
  const entity = session.definition.entities.find(
    (candidate) => candidate.entityId === targetEntityId,
  );
  if (!entity) return session;
  const editQuery = tool.editQuery ?? { queue: [], inFlight: null };
  const based = session.liveSolve
    ? session
    : withLiveSolveBasis(session, session.definition);
  const gate = offsetEditInputGate(based, [targetEntityId], "a Trim target");
  const refusal =
    trimTargetRefusal(entity) ??
    (hasAcceptedLiveSolveOfDefinition(based)
      ? null
      : TRIM_BASIS_NOT_ACCEPTED_MESSAGE) ??
    (gate && !gate.pending ? gate.message : null);
  if (refusal) return withTrimQuery(based, editQuery, refusal);
  return advanceSketchTrimQueue(
    withTrimQuery(
      based,
      { ...editQuery, queue: [...editQuery.queue, { targetEntityId, entity }] },
      null,
    ),
  );
}

/**
 * T10g-1: issues the head click's query when nothing is in flight. A head
 * whose target changed since its click is dropped as stale (R-5). The query
 * runs on the accepted live solve of the current definition only (R-6);
 * with offset relationships it waits while the publication round is pending
 * (R-1: the basis must say which offset outputs are accepted), and so does
 * a target whose C3 gate is still pending. Unchanged when nothing waits.
 */
export function advanceSketchTrimQueue(
  session: SketchSessionState,
  initialMessage: string | null = null,
): SketchSessionState {
  const editQuery = session.activeEditTool?.editQuery;
  if (session.activeEditTool?.toolId !== "trim" || !editQuery) return session;
  if (editQuery.inFlight || (editQuery.queue.length === 0 && !initialMessage))
    return session;
  let message = initialMessage;
  const queue = [...editQuery.queue];
  for (;;) {
    const head = queue[0];
    if (!head) return withTrimQuery(session, { ...editQuery, queue }, message);
    const current = session.definition.entities.find(
      (entity) => entity.entityId === head.targetEntityId,
    );
    const gate = offsetEditInputGate(
      session,
      [head.targetEntityId],
      "a Trim target",
    );
    const refusal =
      current !== head.entity
        ? TRIM_STALE_MESSAGE
        : !hasAcceptedLiveSolveOfDefinition(session)
          ? TRIM_BASIS_NOT_ACCEPTED_MESSAGE
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
      return withTrimQuery(
        session,
        { ...editQuery, queue },
        message ?? gate?.message ?? null,
      );
    const liveSolve = session.liveSolve!;
    return withTrimQuery(
      session,
      {
        queue,
        inFlight: {
          // Review R-1: unique across tool activations (a new Trim after
          // Esc starts a fresh queue), so a result of a cancelled query
          // never matches a later click's query.
          queryId: `trim-query-${crypto.randomUUID()}`,
          definition: session.definition,
          generation: session.liveRegions.generation,
          input: {
            definition: liveSolve.definition,
            solvedSnapshot: liveSolve.solvedSnapshot,
            projectedReferences: liveSolve.projectedReferences,
            modelingTolerance: session.modelingTolerance,
            operation: { kind: "trim", targetEntityId: head.targetEntityId },
          },
        },
      },
      message,
    );
  }
}

/**
 * T10g-1 (design §2.7/§2.8): the exact intersections of the in-flight
 * Trim query `queryId` (ignored unless it is still the one in flight).
 * - The definition changed meanwhile (an edit, Undo/Redo): discarded with
 *   the stale message.
 * - Only the live solve changed (a re-solve, a publication: a new
 *   generation or snapshot, review A-4): queried again for the head.
 * - Otherwise a failure shows its message, and a verified result applies as
 *   one authored edit, after C3 over target, cut cutters and the
 *   non-accepted outputs near the target (T-g5); the next click follows.
 */
export function completeSketchTrimQuery(
  session: SketchSessionState,
  queryId: string,
  result: SketchEditIntersectionResult,
): SketchSessionState {
  const editQuery = session.activeEditTool?.editQuery;
  const inFlight = editQuery?.inFlight;
  if (
    session.activeEditTool?.toolId !== "trim" ||
    inFlight?.queryId !== queryId
  )
    return session;
  const cleared = { ...editQuery!, inFlight: null };
  const popped = { ...cleared, queue: cleared.queue.slice(1) };
  if (session.definition !== inFlight.definition)
    return advanceSketchTrimQueue(
      withTrimQuery(session, popped, null),
      TRIM_STALE_MESSAGE,
    );
  if (
    session.liveRegions.generation !== inFlight.generation ||
    session.liveSolve?.solvedSnapshot !== inFlight.input.solvedSnapshot
  )
    return advanceSketchTrimQueue(withTrimQuery(session, cleared, null));
  const targetEntityId = inFlight.input.operation.targetEntityId;
  const gate = offsetEditInputGate(
    session,
    [
      targetEntityId,
      ...(result.kind === "verified"
        ? [result.cuts[0]!, result.cuts.at(-1)!].flatMap((cut) =>
            cut.cutters.map((cutter) => cutter.entityId),
          )
        : []),
      ...result.nonAcceptedNearTarget,
    ],
    "a Trim input",
  );
  if (gate?.pending)
    return advanceSketchTrimQueue(withTrimQuery(session, cleared, null));
  if (gate)
    return advanceSketchTrimQueue(
      withTrimQuery(session, popped, null),
      gate.message,
    );
  if (result.kind === "failed")
    return advanceSketchTrimQueue(
      withTrimQuery(session, popped, null),
      result.message,
    );
  const nextSequence = session.sequence + 1;
  const sketchId = session.sketchId ?? ("sketch_draft" as SketchId);
  const mutation = createSketchTrimMutation({
    definition: session.definition,
    targetEntityId,
    intersections: result,
    factories: createSessionCommitFactories(nextSequence, sketchId),
  });
  if (!mutation.changed)
    return advanceSketchTrimQueue(
      withTrimQuery(session, popped, null),
      mutation.message,
    );
  const applied = withLiveSolveBasis(
    {
      ...withTrimQuery(session, popped, null),
      definition: mutation.definition,
      toolStagedEntities: [],
      sequence: nextSequence,
      commitRequest: rebuildSessionCommitRequest(session, mutation.definition),
      activeEditTarget: null,
      activeDrag: null,
    },
    mutation.definition,
  );
  return advanceSketchTrimQueue(applied);
}

/** T10g-1: the in-flight Trim query failed (a real error): nothing is applied. */
export function failSketchTrimQuery(
  session: SketchSessionState,
  queryId: string,
  message: string,
): SketchSessionState {
  const editQuery = session.activeEditTool?.editQuery;
  if (
    session.activeEditTool?.toolId !== "trim" ||
    editQuery?.inFlight?.queryId !== queryId
  )
    return session;
  return advanceSketchTrimQueue(
    withTrimQuery(
      session,
      { ...editQuery, inFlight: null, queue: editQuery.queue.slice(1) },
      null,
    ),
    `Trim failed: ${message}`,
  );
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
    return queueSketchTrimClick(session, activeEditTool, target.entityId);
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
