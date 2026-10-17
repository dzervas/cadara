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
 * definition gives only the reason text. Without a live solve (an opened
 * session, T17g3) nothing is listed. A mirror seeded on
 * an offset spline curve (U-G2, malformed data only) is not in the gate
 * (its diagnostic gates the sketch by severity) and is listed as broken too.
 */
import { DERIVED_SHELL_SEED_UNSUPPORTED } from "@/contracts/sketch/derived-geometry";
import { evaluateAuthoredSketchDerivations } from "@/domain/modeling/sketch-dimension-expressions";
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
import type { SketchEntityId } from "@/contracts/shared/ids";
import type { PrimitiveRef } from "@/core/editor/schema";
import { removeMirrorRelationship } from "@/domain/sketch-editing/mirror-repair";
import type { SketchMirrorRepairState, SketchSessionState } from "./types";
import {
  getSketchMirrorRepairCandidate,
  leaveSketchMirrorRepair,
  restageSketchMirrorRepair,
} from "./editing";
import { beginSketchTool, clearActiveSketchTool } from "./tools";
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
  /**
   * T16e: the copy "Replace original…" targets (one output): a selected
   * copy, else (review A-3) the first existing copy whose original was
   * deleted, else the existing copy of a selected original. Null: no such
   * copy (the button is not shown).
   */
  replaceOriginalOutputId: SketchEntityId | null;
}

export interface SketchMirrorActionState {
  entries: SketchMirrorActionEntry[];
}

/**
 * The Mirror panel state: participants of the selection first (definition
 * order), then every other broken mirror. Null when there is nothing to
 * list, while a drag, a tool, a special mode or an annotation edit owns
 * the panel slot, or before the session's live solve (T17g3: mirror health
 * is not known yet, so nothing is listed as healthy or broken).
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
  const participantIds = selectedMirrorIds(session, selection);
  const entries = getSketchMirrorActionEntries(session, selection);
  const listed = [
    ...entries.filter(entry => participantIds.has(entry.derivationId)),
    ...entries.filter(entry => entry.brokenReason !== null && !participantIds.has(entry.derivationId)),
  ];
  return listed.length ? { entries: listed } : null;
}

/** All relationship health and removal consequences, independent of panel visibility. */
export function getSketchMirrorActionEntries(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[] = [],
): SketchMirrorActionEntry[] {
  const definition = session.definition;
  const mirrors = (definition.derivedRelationships ?? []).filter(
    (relationship): relationship is MirrorRelationship =>
      relationship.kind === "mirror",
  );
  if (mirrors.length === 0) return [];
  const liveSnapshot = session.liveSolve?.solvedSnapshot;
  if (!liveSnapshot) return [];
  // The owner's evaluation, through the evaluation seam the solve uses
  // (one failure per relationship, unresolved order included).
  const settings = getSketchSessionDerivationSettings(session);
  const evaluation = evaluateAuthoredSketchDerivations({
    definition,
    ...settings,
  });
  const reasons = new Map(
    evaluation.derivedFailures.map((failure) => [
      failure.derivationId,
      failure.reason,
    ]),
  );
  const broken = new Set(sketchProfileGateFailures(liveSnapshot));
  // The live solve failed a mirror the authored positions do not (it failed
  // during the solve, e.g. a dimension shrank its axis below τ): its reason
  // is the owner's at the solved positions.
  if ([...broken].some((id) => !reasons.has(id))) {
    const solved = new Map(
      liveSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    for (const failure of evaluateAuthoredSketchDerivations({
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
  const selectedEntityIds = new Set(
    selection.flatMap((ref) =>
      ref.kind === "sketchEntity" &&
      ref.sketchId === getSessionSketchId(session)
        ? [ref.entityId as string]
        : [],
    ),
  );
  const entityIds = new Set(
    definition.entities.map((entity) => entity.entityId as string),
  );
  return entries.map(({ relationship, brokenReason }) => {
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
        replaceOriginalOutputId: replaceOriginalOutputId(
          relationship,
          selectedEntityIds,
          entityIds,
        ),
      };
    });
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

/** T16e: the one copy "Replace original…" targets (see the entry field). */
function replaceOriginalOutputId(
  relationship: MirrorRelationship,
  selectedEntityIds: ReadonlySet<string>,
  entityIds: ReadonlySet<string>,
): SketchEntityId | null {
  const existing = relationship.outputs.filter((output) =>
    entityIds.has(output.outputEntityId),
  );
  return (
    (
      existing.find((output) => selectedEntityIds.has(output.outputEntityId)) ??
      existing.find((output) => !entityIds.has(output.seedEntityId)) ??
      existing.find((output) => selectedEntityIds.has(output.seedEntityId))
    )?.outputEntityId ?? null
  );
}

/**
 * T16e ([TECH] T16-9): the Mirror panel's Replace mirror line… / Replace
 * original… enter the Mirror tool's repair sub-state (no new tool id) for
 * mirror `derivationId`: its line, or the original of copy
 * `outputEntityId`. `returnSelection` (the editor selection) comes back on
 * Cancel/Escape. The same session when the mirror or the copy is gone.
 */
export function beginSketchMirrorRepair(
  session: SketchSessionState,
  derivationId: string,
  target: SketchMirrorRepairState["target"],
  returnSelection: readonly PrimitiveRef[],
): SketchSessionState {
  const relationship = session.definition.derivedRelationships?.find(
    (candidate) => candidate.derivationId === derivationId,
  );
  if (
    relationship?.kind !== "mirror" ||
    (target !== "axis" &&
      !relationship.outputs.some(
        (output) => output.outputEntityId === target.outputEntityId,
      )) ||
    (target !== "axis" &&
      !session.definition.entities.some(
        (entity) => entity.entityId === target.outputEntityId,
      ))
  )
    return session;
  const armed = beginSketchTool(session, "sketchMirror");
  return restageSketchMirrorRepair({
    ...armed,
    activeEditTool: {
      ...armed.activeEditTool!,
      repair: {
        derivationId,
        target,
        returnSelection: [...returnSelection],
      },
    },
  });
}

/** T16e: Cancel/Escape of a repair: no action, the panel state back (review R-2: its message too). */
export function cancelSketchMirrorRepair(
  session: SketchSessionState,
): SketchSessionState {
  return session.activeEditTool?.repair
    ? leaveSketchMirrorRepair(session)
    : session;
}

/**
 * T16e: Confirm (popup Replace, Enter) of a repair: the picked candidate,
 * re-judged on the current definition, as one authored candidate solved
 * from the current positions (the solve the pick staged), the tool left.
 * The same session when nothing valid is picked.
 */
export function applySketchMirrorRepair(
  session: SketchSessionState,
): SketchSessionState {
  const tool = session.activeEditTool;
  const picked = tool?.selectedTargets[0];
  if (!tool?.repair || !picked) return session;
  return completeSketchMirrorRepair(session, tool.repair, picked, true);
}

/** Explicit repair and browser confirmation apply the same judged candidate. */
export function completeSketchMirrorRepair(
  session: SketchSessionState,
  repair: SketchMirrorRepairState,
  target: PrimitiveRef,
  clearTool = false,
): SketchSessionState {
  const candidate = getSketchMirrorRepairCandidate(session, repair, target);
  return candidate.ok
    ? rebuildSessionForDefinition(clearTool ? clearActiveSketchTool(session) : session, { definition: candidate.definition })
    : clearTool ? session : { ...session, validationMessage: candidate.message };
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
