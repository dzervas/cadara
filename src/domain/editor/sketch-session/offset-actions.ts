/**
 * T17c ([TECH] T17-5): the Offset selection-context panel state and the
 * "Remove Offset" session action (the T16a Mirror panel pattern).
 *
 * The panel lists the offsets the selection takes part in: a selected
 * seed (or one of its points or tangent handles), output curve (line, arc,
 * circle, joint arc or spline shell) or output point (shell terminals and
 * joint points included), in definition order. A seed with several
 * offsets lists each, each with its health (T17c review R-1).
 */
import type { SketchPointId } from "@/contracts/shared/ids";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED } from "@/contracts/sketch/mirror-requirements";
import { offsetDeletedOutput } from "@/contracts/sketch/offset-derivation-outputs";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import { solvedPairDefinition } from "@/contracts/sketch/offset-publication";
import {
  isReferenceDimension,
  type ConstraintDefinition,
  type SketchDerivationDefinition,
} from "@/contracts/sketch/schema";
import type { PrimitiveRef } from "@/core/editor/schema";
import { getEntityPointIds } from "@/domain/sketch-editing/definition-references";
import { removeDerivedRelationship } from "@/domain/sketch-editing/derived-removal";
import type { SketchSessionState } from "./types";
import {
  getSessionSketchId,
  getSketchSessionDerivationSettings,
  rebuildSessionForDefinition,
} from "./internals";

type OffsetRelationship = Extract<
  SketchDerivationDefinition,
  { kind: "offset" }
>;

export interface SketchOffsetActionEntry {
  derivationId: string;
  label: string;
  /**
   * T17c review R-1: the offset's health. `broken`: its owner failure, in a
   * few label-based words (a deleted output names its seed); `checking`:
   * the live publication round is still running.
   */
  health:
    | { readonly kind: "healthy" }
    | { readonly kind: "checking" }
    | { readonly kind: "broken"; readonly reason: string };
  /** Output curves (existing output entities) Remove deletes. */
  outputCount: number;
  /** Constraints and dimensions on the output curves Remove deletes. */
  requirementCount: number;
  /**
   * Of those, the ones that currently size the originals: the driving
   * requirements (every constraint, every non-reference dimension) the
   * live solve did not hold `blocked` ([TECH] G16″: a requirement on an
   * output of a failed offset sizes nothing), except constraints the
   * offset makes always true (parallel between an output line and its own
   * seed, concentric between an output arc or circle and its own seed).
   */
  sizingRequirementCount: number;
  /** Labels of the relationships Remove leaves broken (they read an output). */
  brokenDownstreamLabels: string[];
}

export interface SketchOffsetActionState {
  entries: SketchOffsetActionEntry[];
}

/**
 * The Offset panel state: the offsets the selection takes part in
 * (definition order). Null when there is none, or while a drag, a tool, a
 * special mode or an annotation edit owns the panel slot.
 */
export function computeSketchOffsetActionState(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
): SketchOffsetActionState | null {
  if (
    session.activeDrag ||
    session.activeSpecialMode ||
    session.activeTool ||
    session.activeAnnotationEdit
  )
    return null;
  const definition = session.definition;
  const sketchId = getSessionSketchId(session);
  const entityIds = new Set<string>();
  const pointIds = new Set<string>();
  for (const ref of selection) {
    if (
      (ref.kind === "sketchEntity" || ref.kind === "sketchTangentHandle") &&
      ref.sketchId === sketchId
    )
      entityIds.add(ref.entityId);
    else if (ref.kind === "sketchPoint" && ref.sketchId === sketchId)
      pointIds.add(ref.pointId);
  }
  if (entityIds.size === 0 && pointIds.size === 0) return null;
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId as string, entity]),
  );
  const pointsOf = (entityId: string) => {
    const entity = entityById.get(entityId);
    return entity ? getEntityPointIds(entity) : [];
  };
  const offsets = (definition.derivedRelationships ?? []).filter(
    (relationship): relationship is OffsetRelationship =>
      relationship.kind === "offset" &&
      participates(relationship, entityIds, pointIds, pointsOf),
  );
  if (offsets.length === 0) return null;
  const snapshot = session.liveSolve?.solvedSnapshot;
  const blocked = new Set<string>([
    ...(snapshot?.constraintStatuses ?? []).flatMap((status) =>
      status.status === "blocked" ? [status.constraintId] : [],
    ),
    ...(snapshot?.dimensionStatuses ?? []).flatMap((status) =>
      status.status === "blocked" ? [status.dimensionId] : [],
    ),
  ]);
  const health = offsetHealth(session);
  return {
    entries: offsets.map((relationship) => {
      const removal = removeDerivedRelationship(
        definition,
        relationship.derivationId,
        "offset",
      )!;
      return {
        derivationId: relationship.derivationId,
        label: relationship.label,
        health: health(relationship),
        outputCount: removal.removedEntityIds.size,
        requirementCount:
          removal.removedConstraints.length + removal.removedDimensions.length,
        sizingRequirementCount:
          removal.removedConstraints.filter(
            (constraint) =>
              !blocked.has(constraint.constraintId) &&
              !holdsByOffset(relationship, constraint),
          ).length +
          removal.removedDimensions.filter(
            (dimension) =>
              !blocked.has(dimension.dimensionId) &&
              !isReferenceDimension(dimension),
          ).length,
        brokenDownstreamLabels: removal.brokenDownstream.map(
          (downstream) => downstream.label,
        ),
      };
    }),
  };
}

/**
 * "Remove Offset" ([TECH] T17-5): the offset's write set
 * (`removeDerivedRelationship`) as one authored candidate, re-solved from
 * the current positions. The same session when the offset is gone.
 */
export function applySketchOffsetRemoval(
  session: SketchSessionState,
  derivationId: string,
): SketchSessionState {
  const removal = removeDerivedRelationship(
    session.definition,
    derivationId,
    "offset",
  );
  return removal
    ? rebuildSessionForDefinition(session, { definition: removal.definition })
    : session;
}

/**
 * The health of each offset (T17c review R-1), from the owner: its failure
 * in the evaluation at the live solve's solved positions (the solve frame
 * the solve itself runs), else its live publication round (pending:
 * checking; not certified: the round's failure on one of its seeds).
 */
function offsetHealth(session: SketchSessionState) {
  const live = session.liveSolve;
  // T17o (T17g3 ADV-4): without a live solve nothing is judged yet, as in
  // the Mirror panel; the authored definition is never judged instead.
  if (!live)
    return (): SketchOffsetActionEntry["health"] => ({ kind: "checking" });
  const definition = solvedPairDefinition(live.definition, live.solvedSnapshot);
  const failures = new Map(
    evaluateSketchDerivations({
      definition,
      ...getSketchSessionDerivationSettings(session),
    }).offsetFailures.map((failure) => [
      failure.derivationId,
      failure.diagnostic,
    ]),
  );
  const certified = new Set(
    live.solvedSnapshot.certifiedOffsetDerivationIds ?? [],
  );
  const labels = new Map(
    definition.entities.map((entity) => [
      entity.entityId as string,
      entity.label,
    ]),
  );
  return (
    relationship: OffsetRelationship,
  ): SketchOffsetActionEntry["health"] => {
    const failure = failures.get(relationship.derivationId);
    if (failure) {
      const deleted = offsetDeletedOutput(relationship, (entityId) =>
        labels.get(entityId),
      );
      return {
        kind: "broken",
        reason:
          deleted?.message === failure.message
            ? deleted.reason
            : offsetFailureReason(failure.code),
      };
    }
    if (session.liveRegions.status === "pending") return { kind: "checking" };
    if (certified.has(relationship.derivationId)) return { kind: "healthy" };
    const seeds = new Set<string>(relationship.seedEntityIds);
    const published = (session.offsetPublicationDiagnostics ?? []).find(
      (diagnostic) =>
        diagnostic.target?.kind === "entity" &&
        seeds.has(diagnostic.target.entityId),
    );
    return {
      kind: "broken",
      reason: published
        ? offsetFailureReason(published.code)
        : "its curves could not be checked",
    };
  };
}

/** An offset failure code in a few words (labels only; the full text is the diagnostic's). */
function offsetFailureReason(code: string): string {
  switch (code) {
    case OFFSET_DIAGNOSTIC_CODES.unsupportedSeed:
      return "an original was deleted or can't be offset";
    case OFFSET_DIAGNOSTIC_CODES.disconnectedChain:
      return "its originals are no longer connected";
    case OFFSET_DIAGNOSTIC_CODES.unresolvedDistance:
      return "its distance can't be resolved";
    case OFFSET_DIAGNOSTIC_CODES.arcCollapse:
      return "an arc collapses at this distance";
    case OFFSET_DIAGNOSTIC_CODES.jointUnsatisfied:
      return "two of its curves can't be joined at this distance";
    case OFFSET_DIAGNOSTIC_CODES.outputDegenerate:
      return "a curve would be shorter than the tolerance";
    case OFFSET_DIAGNOSTIC_CODES.topologyChanged:
      return "its originals changed shape";
    case OFFSET_DIAGNOSTIC_CODES.splineJointUnsupported:
      return "a spline joint of this kind isn't supported yet";
    case OFFSET_DIAGNOSTIC_CODES.seedNotCertified:
      return "an original is an offset curve that isn't checked";
    case DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED:
      return "dependency loop";
    default:
      return "its curves could not be checked";
  }
}

/** Whether a selected entity or point is a seed, an output or one of their points. */
function participates(
  relationship: OffsetRelationship,
  entityIds: ReadonlySet<string>,
  pointIds: ReadonlySet<string>,
  pointsOf: (entityId: string) => readonly SketchPointId[],
) {
  const entities = [
    ...relationship.seedEntityIds,
    ...relationship.outputs.map((output) => output.outputEntityId),
    ...relationship.jointOutputs.map((joint) => joint.outputEntityId),
    ...relationship.piecewiseCubicOutputs.map((shell) => shell.outputEntityId),
  ];
  if (entities.some((entityId) => entityIds.has(entityId))) return true;
  if (pointIds.size === 0) return false;
  return [
    ...entities.flatMap(pointsOf),
    ...relationship.outputs.flatMap((output) => output.outputPointIds),
    ...relationship.jointOutputs.flatMap((joint) => [
      joint.centerPointId,
      joint.startPointId,
      joint.endPointId,
    ]),
    ...relationship.piecewiseCubicOutputs.flatMap((shell) => [
      shell.startPointId,
      shell.endPointId,
    ]),
  ].some((pointId) => pointIds.has(pointId));
}

/**
 * Whether the offset alone makes `constraint` true: parallel between an
 * output line and its own seed, or concentric between an output arc or
 * circle and its own seed (an offset keeps directions and centres), so it
 * sizes nothing.
 */
function holdsByOffset(
  relationship: OffsetRelationship,
  constraint: ConstraintDefinition,
) {
  return (
    (constraint.kind === "parallel" || constraint.kind === "concentric") &&
    relationship.outputs.some(
      (output) =>
        constraint.entityIds.includes(output.seedEntityId) &&
        constraint.entityIds.includes(output.outputEntityId),
    )
  );
}
