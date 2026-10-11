/**
 * T16a ([TECH] T16-2, R-2, R-3): the Mirror selection-context panel state
 * and the "Remove Mirror" session action.
 *
 * The panel lists the mirrors the selection takes part in (a seed, a copy
 * (held copies included) or the axis line), then every other broken
 * mirror of the sketch, whatever the selection (an empty one included),
 * so every message that points at the Mirror panel points at something
 * visible.
 *
 * T16b (T16a review A-1): which mirrors are broken comes from the live
 * solve's sketch-wide profile gate (`sketchProfileGateFailures`), so the
 * panel and the profile gate agree; the owner's evaluation of the session
 * definition gives only the reason text, and the broken set when there is
 * no live solve yet (re-entry before the first solve). A mirror seeded on
 * an offset spline curve (U-G2, malformed data only) is not in the gate
 * (its diagnostic gates the sketch by severity) and is listed as broken too.
 */
import {
  DERIVED_SHELL_SEED_UNSUPPORTED,
  evaluateSketchDerivations,
} from "@/contracts/sketch/derived-geometry";
import { sketchProfileGateFailures } from "@/contracts/sketch/derived-validity";
import {
  isReferenceDimension,
  type ConstraintDefinition,
} from "@/contracts/sketch/schema";
import {
  resolveMirrorCounterpart,
  type DerivedRelationshipFailureReason,
  type MirrorCorrespondenceRef,
  type MirrorRelationship,
} from "@/contracts/sketch/mirror-requirements";
import type { PrimitiveRef } from "@/core/editor/schema";
import { removeMirrorRelationship } from "@/domain/sketch-editing/mirror-repair";
import type { SketchSessionState } from "./types";
import {
  getSessionSketchId,
  getSketchSessionDerivationSettings,
  rebuildSessionForDefinition,
} from "./internals";

export interface SketchMirrorActionEntry {
  derivationId: string;
  label: string;
  /** Null when healthy, else the short reason it is broken. */
  brokenReason: string | null;
  /** Copies (existing output entities) Remove deletes. */
  copyCount: number;
  /** Constraints and dimensions on the copies Remove deletes. */
  requirementCount: number;
  /**
   * Of those, the ones that currently size the originals: driving
   * requirements (every constraint, every non-reference dimension) of a
   * healthy mirror, whose copy variables are the seed's and the axis's
   * through the coupled solve, except constraints the mirror makes always
   * true (equal length between a copy and its own seed). Zero for a broken
   * mirror (its copies are held, so they drive nothing).
   */
  sizingRequirementCount: number;
  /** Labels of the relationships Remove leaves broken (they read a copy). */
  brokenDownstreamLabels: string[];
}

export interface SketchMirrorActionState {
  entries: SketchMirrorActionEntry[];
}

/**
 * The Mirror panel state: participants of the selection first (definition
 * order), then every other broken mirror. Null when there is nothing to
 * list, or while a drag, a tool, a special mode or an annotation edit owns
 * the panel slot.
 */
export function computeSketchMirrorActionState(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
): SketchMirrorActionState | null {
  if (
    session.activeDrag ||
    session.activeSpecialMode ||
    session.activeTool ||
    session.activeAnnotationEdit
  )
    return null;
  const definition = session.definition;
  const mirrors = (definition.derivedRelationships ?? []).filter(
    (relationship): relationship is MirrorRelationship =>
      relationship.kind === "mirror",
  );
  if (mirrors.length === 0) return null;

  const participantIds = selectedMirrorIds(session, selection);
  // The owner's evaluation, through the evaluation seam the solve uses
  // (one failure per relationship, unresolved order included).
  const settings = getSketchSessionDerivationSettings(session);
  const evaluation = evaluateSketchDerivations({ definition, ...settings });
  const reasons = new Map(
    evaluation.derivedFailures.map((failure) => [
      failure.derivationId,
      failure.reason,
    ]),
  );
  const liveSnapshot = session.liveSolve?.solvedSnapshot;
  const broken = new Set(
    liveSnapshot ? sketchProfileGateFailures(liveSnapshot) : reasons.keys(),
  );
  // The live solve failed a mirror the authored positions do not (it failed
  // during the solve, e.g. a dimension shrank its axis below τ): its reason
  // is the owner's at the solved positions.
  if (liveSnapshot && [...broken].some((id) => !reasons.has(id))) {
    const solved = new Map(
      liveSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    for (const failure of evaluateSketchDerivations({
      definition: {
        ...definition,
        points: definition.points.map((point) => {
          const position = solved.get(point.pointId);
          return position ? { ...point, position } : point;
        }),
      },
      ...settings,
    }).derivedFailures)
      if (!reasons.has(failure.derivationId))
        reasons.set(failure.derivationId, failure.reason);
  }
  const shellSeeds = new Set(
    evaluation.diagnostics.flatMap((diagnostic) =>
      diagnostic.code === DERIVED_SHELL_SEED_UNSUPPORTED &&
      diagnostic.target?.kind === "entity"
        ? [diagnostic.target.entityId as string]
        : [],
    ),
  );
  const entries = mirrors.map((relationship) => ({
    relationship,
    brokenReason: broken.has(relationship.derivationId)
      ? mirrorBrokenReason(reasons.get(relationship.derivationId))
      : relationship.outputs.some((output) =>
            shellSeeds.has(output.seedEntityId),
          )
        ? "original is an offset spline curve"
        : null,
  }));
  const listed = [
    ...entries.filter(({ relationship }) =>
      participantIds.has(relationship.derivationId),
    ),
    ...entries.filter(
      ({ relationship, brokenReason }) =>
        brokenReason !== null && !participantIds.has(relationship.derivationId),
    ),
  ];
  if (listed.length === 0) return null;
  return {
    entries: listed.map(({ relationship, brokenReason }) => {
      const removal = removeMirrorRelationship(
        definition,
        relationship.derivationId,
      )!;
      const driving =
        removal.removedConstraints.filter(
          (constraint) => !holdsByMirror(relationship, constraint),
        ).length +
        removal.removedDimensions.filter(
          (dimension) => !isReferenceDimension(dimension),
        ).length;
      return {
        derivationId: relationship.derivationId,
        label: relationship.label,
        brokenReason,
        copyCount: removal.removedEntityIds.size,
        requirementCount:
          removal.removedConstraints.length + removal.removedDimensions.length,
        sizingRequirementCount: brokenReason === null ? driving : 0,
        brokenDownstreamLabels: removal.brokenDownstream.map(
          (downstream) => downstream.label,
        ),
      };
    }),
  };
}

/**
 * "Remove Mirror" ([TECH] T16-1): the mirror's write set
 * (`removeMirrorRelationship`) as one authored candidate, re-solved from
 * the current positions. The same session when the mirror is gone.
 */
export function applySketchMirrorRemoval(
  session: SketchSessionState,
  derivationId: string,
): SketchSessionState {
  const removal = removeMirrorRelationship(session.definition, derivationId);
  return removal
    ? rebuildSessionForDefinition(session, { definition: removal.definition })
    : session;
}

/** Mirrors a selected seed, copy (held included) or axis line takes part in. */
function selectedMirrorIds(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
) {
  const sketchId = getSessionSketchId(session);
  const ids = new Set<string>();
  for (const ref of selection) {
    let mirrorRef: MirrorCorrespondenceRef | null = null;
    if (ref.kind === "sketchEntity" && ref.sketchId === sketchId) {
      mirrorRef = { kind: "entity", entityId: ref.entityId };
      for (const relationship of session.definition.derivedRelationships ?? [])
        if (
          relationship.kind === "mirror" &&
          relationship.mirrorReference.kind === "lineEntity" &&
          relationship.mirrorReference.entityId === ref.entityId
        )
          ids.add(relationship.derivationId);
    } else if (ref.kind === "sketchPoint" && ref.sketchId === sketchId)
      mirrorRef = { kind: "point", pointId: ref.pointId };
    else if (ref.kind === "sketchTangentHandle" && ref.sketchId === sketchId)
      mirrorRef = {
        kind: "splineOccurrence",
        entityId: ref.entityId,
        occurrenceId: ref.occurrenceId,
      };
    if (!mirrorRef) continue;
    for (const step of resolveMirrorCounterpart(session.definition, mirrorRef))
      ids.add(step.relationshipId);
  }
  return ids;
}

/**
 * Whether the mirror alone makes `constraint` true: equal length between a
 * copy line and its own seed (a reflection keeps lengths), so it sizes
 * nothing. (No equal-radius constraint kind exists.)
 */
function holdsByMirror(
  relationship: MirrorRelationship,
  constraint: ConstraintDefinition,
) {
  return (
    constraint.kind === "equalLength" &&
    relationship.outputs.some(
      (output) =>
        constraint.entityIds.includes(output.seedEntityId) &&
        constraint.entityIds.includes(output.outputEntityId),
    )
  );
}

/**
 * A broken mirror's reason in a few words, from the owner's failure (the
 * same classification as its message). Without one, the generic reason.
 */
function mirrorBrokenReason(
  reason: DerivedRelationshipFailureReason | undefined,
): string {
  switch (reason) {
    case "dependencyLoop":
    case "dependsOnLoop":
      return "dependency loop";
    case "axisMissing":
      return "mirror line missing";
    case "axisDegenerate":
      return "mirror line too short";
    case "seedMissing":
      return "original deleted";
    case "copyMissing":
      return "copy deleted";
    case "mapMismatch":
      return "geometry no longer matches";
    case undefined:
      return "cannot be solved";
  }
}
