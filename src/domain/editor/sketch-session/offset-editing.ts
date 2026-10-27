import type {
  SketchSessionState,
  SketchEditToolState,
  SketchOffsetPreviewPublication,
} from "./types";
import type { SketchEntityId, SketchId } from "@/contracts/shared/ids";
import {
  nonAcceptedDerivedOutputs,
  brokenDerivedInputMessage,
  uncertifiedOffsetInputMessage,
} from "@/contracts/sketch/offset-publication";
import {
  SKETCH_NOT_SOLVED_YET,
  hasAcceptedLiveSolveOfDefinition,
  withLiveSolveBasis,
  getSketchSessionPreviewBasis,
} from "./session-live-solve";
import {
  createOffsetContribution,
  createSketchOffsetDerivationContribution,
  offsetSideForSketchPoint,
  offsetCurveDescriptorFromProjectedGeometry,
} from "@/domain/sketch-editing/operations";
import type {
  SketchEditOperationResult,
  OffsetCurveDescriptor,
} from "@/domain/sketch-editing/operations";
import type { OffsetFramePlan } from "@/contracts/sketch/offset-derivation-frame";
import type { PrimitiveRef } from "@/core/editor/schema";
import {
  createSessionCommitFactories,
  getSessionSketchId,
  rebuildSessionCommitRequest,
} from "./tool-authoring";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import { applySolvedSketchToDefinition } from "./definition-patches";
import { getSketchSessionDerivationSettings } from "./session-definition";
import { buildSketchEditToolPresentation } from "./edit-tool-activation";
import { applySketchContribution } from "./definition-authoring";
import type { SketchOffsetPublicationRecord } from "@/contracts/solver/schema";
import type { SketchPoint } from "@/contracts/modeling/schema";
import { getSelectedSketchEntityIds } from "./edit-geometry-operations";

/**
 * T10i (C3, T10 review A8): an edit tool refused an input that is a
 * non-accepted offset output (the G19 predicate, with its G16‴ closure over
 * mirror/pattern/transform copies), parallel to the feature-input code
 * `feature-input-offset-not-certified` ([TECH] G19c).
 */
export const NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE =
  "edit-input-offset-not-certified";

/**
 * T16c ([TECH] T16-7): an edit tool refused an input held by a broken
 * (failed) mirror, pattern or transform relationship (directly or through
 * a copy of its outputs).
 */
const FAILED_DERIVED_EDIT_INPUT_CODE = "edit-input-derived-failed";

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
 * - also `pending` before the session has a live solve (T17g3: an opened
 *   session, review G-1): nothing is decided yet, so no offset output is
 *   accepted and the input is still being checked.
 * - otherwise it is decided: `edit-input-offset-not-certified`, with the
 *   G19a snapshot rule (no `certifiedOffsetDerivationIds` accepts no offset
 *   output).
 * A derived offset shell is skipped: it is never an edit input (U-G2), and
 * each edit refuses it with that permanent message.
 * T16c ([TECH] T16-7): an input held by a broken relationship (owner
 * reason `derivedFailed`) is refused with `edit-input-derived-failed` and
 * the label-based text. The pending variant is offset-only: a failed
 * relationship makes regions unavailable at once (T15b O-1), so no round
 * is pending, and its failure is decided, not being checked.
 */
export function offsetEditInputGate(
  session: SketchSessionState,
  entityIds: readonly SketchEntityId[],
  use: string,
): { readonly pending: boolean; readonly message: string } | null {
  if (entityIds.length === 0) return null;
  const { liveSolve } = session;
  const nonAccepted = nonAcceptedDerivedOutputs(
    session.definition,
    liveSolve?.solvedSnapshot ?? SKETCH_NOT_SOLVED_YET,
  );
  const shells = new Set(
    session.definition.entities.flatMap((entity) =>
      entity.kind === "derivedPiecewiseCubic" ? [entity.entityId] : [],
    ),
  );
  const pending =
    liveSolve === null || session.liveRegions.status === "pending";
  for (const entityId of entityIds) {
    const owner = nonAccepted.get(entityId);
    if (!owner || shells.has(entityId)) continue;
    if (owner.reason === "derivedFailed")
      return {
        pending: false,
        message: `${FAILED_DERIVED_EDIT_INPUT_CODE}: ${brokenDerivedInputMessage(
          session.definition,
          { entityId },
          owner,
          `it can't be used as ${use}`,
        )}`,
      };
    return pending
      ? {
          pending,
          message: uncertifiedOffsetInputMessage(
            session.definition,
            { entityId },
            owner,
            `it can be used as ${use}`,
            true,
          ),
        }
      : {
          pending,
          message: `${NON_ACCEPTED_OFFSET_EDIT_INPUT_CODE}: ${uncertifiedOffsetInputMessage(
            session.definition,
            { entityId },
            owner,
            `it can't be used as ${use}`,
          )}`,
        };
  }
  return null;
}

export function refusedEditOperation(message: string): SketchEditOperationResult {
  return {
    valid: false,
    message,
    definition: null,
    contribution: null,
    previewEntities: [],
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

  return getSketchOffsetResult(session, sketchEntityTargets.map((target) => target.entityId), activeEditTool.offsetDistance, activeEditTool.offsetSide, plan);
}

/** Explicit durable offset preparation, also used by the browser preview. */
function getSketchOffsetResult(
  session: SketchSessionState,
  seedEntityIds: readonly SketchEntityId[],
  distance: number | null,
  side: "left" | "right",
  plan?: OffsetFramePlan,
): SketchEditOperationResult {
  const nextSequence = session.sequence + 1;
  const sketchId = getSessionSketchId(session);
  // T10i (C3): an offset seed (direct, or a G16‴ copy of one) must be
  // accepted geometry.
  const gate = offsetEditInputGate(session, seedEntityIds, "an offset seed");
  if (gate) return refusedEditOperation(gate.message);

  return createSketchOffsetDerivationContribution({
    definition: offsetSeedDefinition(session),
    entityIds: seedEntityIds,
    distance,
    side,
    sequence: nextSequence,
    factories: createSessionCommitFactories(nextSequence, sketchId),
    modelingTolerance: session.modelingTolerance,
    documentVariables: session.documentVariables,
    ...(plan ? { plan } : {}),
  });
}

/**
 * T13b (B2, D28): the definition an Offset is created on. With an accepted
 * live solve of the current definition, the authored definition at that
 * solve's solved positions (radii, spline handles): the geometry the user
 * sees and the edit-query tools (Trim, Extend, Split) query, so the
 * preview's frame is the one its committed solve rebuilds. Otherwise the
 * authored definition, and the preview's own solve refuses as before
 * (U-G1). Only the contribution reads it; the commit adds that to the
 * authored definition.
 */
function offsetSeedDefinition(session: SketchSessionState): SketchDefinition {
  return session.liveSolve && hasAcceptedLiveSolveOfDefinition(session)
    ? applySolvedSketchToDefinition(
        session.definition,
        session.liveSolve.solvedSnapshot,
        getSketchSessionDerivationSettings(session),
      )
    : session.definition;
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
  const basis = getOffsetContributionBasis(session, preview.contribution, replan);
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

export function withoutOffsetPublication(
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
export function commitOffsetContribution(
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
  const committed = applySketchOffsetContribution(session, contribution);
  const tool = withoutOffsetPublication(activeEditTool);
  const nextEditTool = {
    ...tool,
    selectedTarget: null,
    selectedTargets: [],
  };

  return {
    ...committed,
    activeEditTool: nextEditTool,
    toolStagedEntities: [],
    toolPresentation: buildSketchEditToolPresentation(nextEditTool),
  };
}

/** Applies only a contribution whose publication the caller has certified. */
function applySketchOffsetContribution(
  session: SketchSessionState,
  contribution: NonNullable<SketchEditOperationResult["contribution"]>,
): SketchSessionState {
  const history = applySketchContribution(session, contribution);
  return withLiveSolveBasis({ ...session, definition: history.definition, sequence: session.sequence + 1, commitRequest: rebuildSessionCommitRequest(session, history.definition), validationMessage: null }, history.definition);
}

function getOffsetContributionBasis(
  session: SketchSessionState,
  contribution: NonNullable<SketchEditOperationResult["contribution"]>,
  plan?: OffsetFramePlan,
) {
  const relationship = contribution.derivedRelationships?.find(r => r.kind === "offset");
  if (!relationship) throw new Error("An offset publication must own a durable relationship.");
  return getSketchSessionPreviewBasis(plan ? { ...session, offsetPlans: [...(session.offsetPlans ?? []), { derivationId: relationship.derivationId, plan }] } : session, applySketchContribution(session, contribution).definition);
}

export function prepareSketchOffset(
  session: SketchSessionState,
  entityIds: readonly SketchEntityId[],
  distance: number,
  side: "left" | "right",
  plan?: OffsetFramePlan,
) {
  if (new Set(entityIds).size !== entityIds.length || !Number.isFinite(distance)) return { message: "Offset requires distinct seeds and a finite positive distance." };
  const result = getSketchOffsetResult(session, entityIds, distance, side, plan);
  const contribution = result.contribution;
  if (!result.valid || !contribution) return { message: result.message ?? "Offset could not be prepared." };
  const relationship = contribution.derivedRelationships?.find(r => r.kind === "offset");
  if (!relationship) throw new Error("A durable offset must have an offset relationship.");
  const basis = getOffsetContributionBasis(session, contribution, plan);
  if (!basis) return { message: OFFSET_PREVIEW_UNACCEPTED_MESSAGE };
  return { definition: session.definition, generation: session.liveRegions.generation, contribution, derivationId: relationship.derivationId, basis };
}

export function completeSketchOffset(
  session: SketchSessionState,
  prepared: Exclude<ReturnType<typeof prepareSketchOffset>, { message: string }>,
  record: SketchOffsetPublicationRecord,
): SketchSessionState {
  if (session.definition !== prepared.definition || session.liveRegions.generation !== prepared.generation) return { ...session, validationMessage: "Offset source changed while its geometry was being checked." };
  if (record.derivationId !== prepared.derivationId || record.status !== "certified") return { ...session, validationMessage: record.diagnostic?.message ?? "Offset geometry is not certified." };
  const gate = offsetEditInputGate(session, prepared.contribution.derivedRelationships!.flatMap(r => r.kind === "offset" ? r.seedEntityIds : []), "an offset seed");
  if (gate) return { ...session, validationMessage: gate.message };
  return applySketchOffsetContribution(record.plan ? { ...session, offsetPlans: [...(session.offsetPlans ?? []), { derivationId: prepared.derivationId, plan: record.plan }] } : session, prepared.contribution);
}

export function withOffsetPublication(
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
    definition: offsetSeedDefinition(session),
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
    toolPresentation: buildSketchEditToolPresentation(
      nextEditTool,
      preview.message,
      preview.previewEntities,
    ),
  };
}

function getOffsetCurveForProjectedTarget(
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

/**
 * T17f (T17c4 review A-2): whether Enter is the Offset's Create: the tool
 * has a selection, as its Create popup does. Create (and so Enter) commits a
 * certified preview, waits for one still being checked, or shows a refusal.
 */
export function isSketchOffsetConfirmable(session: SketchSessionState) {
  const tool = session.activeEditTool;
  return tool?.toolId === "offset" && tool.selectedTargets.length > 0;
}
