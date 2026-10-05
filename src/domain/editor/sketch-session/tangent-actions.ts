/**
 * T12e: tangent reset-to-automatic and set-to-zero selection-context actions.
 *
 * These act on the selected tangent handle(s) and/or selected fit point(s)
 * of a spline (a fit point maps to its occurrence(s)), resetting authored
 * tangents to automatic or setting them to explicit [0, 0].
 *
 * Each invocation is one authored action ("Reset Tangent" / "Zero Tangent")
 * through the completed-intent boundary. No-op records nothing.
 */

import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchEntityDefinition,
} from "@/contracts/sketch/schema";
import type { SplinePointOccurrence } from "@/contracts/sketch/spline-geometry";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";
import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchSessionState } from "./types";
import {
  getSessionSketchId,
  rebuildSessionCommitRequest,
  withLiveSolveBasis,
} from "./internals";

// ── Target resolution ────────────────────────────────────────────────────

export interface TangentActionTarget {
  entityId: SketchEntityId;
  occurrenceId: string;
}

/**
 * Resolve the set of tangent action targets from the current selection.
 *
 * A `sketchTangentHandle` maps directly to its occurrence.
 * A `sketchPoint` maps to every occurrence in every spline that uses that point.
 */
export function resolveTangentActionTargets(
  selection: readonly PrimitiveRef[],
  definition: SketchDefinition,
  sketchId: string,
): TangentActionTarget[] {
  const targets: TangentActionTarget[] = [];
  const seen = new Set<string>();

  for (const ref of selection) {
    if (ref.kind === "sketchTangentHandle" && ref.sketchId === sketchId) {
      const key = `${ref.entityId}:${ref.occurrenceId}`;
      if (!seen.has(key)) {
        seen.add(key);
        targets.push({
          entityId: ref.entityId as SketchEntityId,
          occurrenceId: ref.occurrenceId,
        });
      }
    } else if (ref.kind === "sketchPoint" && ref.sketchId === sketchId) {
      // Map the selected fit point to its occurrence(s) in every spline.
      for (const entity of definition.entities) {
        if (entity.kind !== "spline") continue;
        const ordered = orderedSplineOccurrences(entity);
        if (!ordered) continue;
        for (const occ of ordered) {
          if (occ.pointId === ref.pointId) {
            const key = `${entity.entityId}:${occ.occurrenceId}`;
            if (!seen.has(key)) {
              seen.add(key);
              targets.push({
                entityId: entity.entityId,
                occurrenceId: occ.occurrenceId,
              });
            }
          }
        }
      }
    }
  }

  return targets;
}

// ── Enabled-state rules ──────────────────────────────────────────────────

/**
 * "Reset tangent to automatic" is enabled when at least one target is
 * currently authored (i.e. not automatic).
 */
export function isResetTangentEnabled(
  targets: readonly TangentActionTarget[],
  definition: SketchDefinition,
): boolean {
  return targets.some((target) => {
    const occ = findOccurrence(definition, target);
    return occ !== null && occ.tangent.kind === "authored";
  });
}

/**
 * "Set tangent to zero" is enabled when at least one target is not already
 * exactly [0, 0].
 */
export function isSetTangentToZeroEnabled(
  targets: readonly TangentActionTarget[],
  definition: SketchDefinition,
): boolean {
  return targets.some((target) => {
    const occ = findOccurrence(definition, target);
    if (!occ) return false;
    if (occ.tangent.kind === "automatic") return true;
    return occ.tangent.vector[0] !== 0 || occ.tangent.vector[1] !== 0;
  });
}

// ── Edits ────────────────────────────────────────────────────────────────

/**
 * Reset all targets to automatic. Returns the mutated definition, or the
 * same reference when nothing changes (no-op).
 */
export function resetTangentsToAutomatic(
  definition: SketchDefinition,
  targets: readonly TangentActionTarget[],
): SketchDefinition {
  return patchTangents(definition, targets, () => ({
    kind: "automatic" as const,
  }));
}

/**
 * Set all targets to authored [0, 0]. Returns the mutated definition, or
 * the same reference when nothing changes (no-op).
 */
export function setTangentsToZero(
  definition: SketchDefinition,
  targets: readonly TangentActionTarget[],
): SketchDefinition {
  return patchTangents(definition, targets, () => ({
    kind: "authored" as const,
    vector: [0, 0] as readonly [number, number],
  }));
}

// ── Presentation state ──────────────────────────────────────────────────

export interface SketchTangentActionState {
  /** Whether any targets exist (controls visibility of the panel). */
  visible: boolean;
  resetEnabled: boolean;
  zeroEnabled: boolean;
}

/**
 * Compute the tangent action presentation state for the given session and
 * editor selection. Returns null when no eligible targets exist.
 */
export function computeSketchTangentActionState(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
): SketchTangentActionState | null {
  // Don't show tangent actions during a drag, drawing, special mode, or
  // annotation edit (A3: annotation edit replaces the selection, making
  // tangent targets unreachable, but exclude it explicitly for clarity).
  if (
    session.activeDrag ||
    session.activeSpecialMode ||
    session.activeTool ||
    session.activeAnnotationEdit
  ) {
    return null;
  }

  const sketchId = getSessionSketchId(session);
  const targets = resolveTangentActionTargets(
    selection,
    session.definition,
    sketchId,
  );
  if (targets.length === 0) return null;

  return {
    visible: true,
    resetEnabled: isResetTangentEnabled(targets, session.definition),
    zeroEnabled: isSetTangentToZeroEnabled(targets, session.definition),
  };
}

// ── Session-level action ─────────────────────────────────────────────────

/**
 * Apply a tangent action ("Reset Tangent" / "Zero Tangent") to the current
 * session given the editor selection. Returns the same session when nothing
 * changes (no-op — the authored action boundary records nothing).
 */
export function applyTangentAction(
  session: SketchSessionState,
  selection: readonly PrimitiveRef[],
  intent: "resetTangentToAutomatic" | "setTangentToZero",
): SketchSessionState {
  const sketchId = getSessionSketchId(session);
  const targets = resolveTangentActionTargets(
    selection,
    session.definition,
    sketchId,
  );
  if (targets.length === 0) return session;

  const nextDefinition =
    intent === "resetTangentToAutomatic"
      ? resetTangentsToAutomatic(session.definition, targets)
      : setTangentsToZero(session.definition, targets);

  // Identity check: if nothing changed, no-op.
  if (nextDefinition === session.definition) return session;

  return withLiveSolveBasis(
    {
      ...session,
      definition: nextDefinition,
      commitRequest: rebuildSessionCommitRequest(session, nextDefinition),
      validationMessage: null,
    },
    nextDefinition,
  );
}

// ── Internals ────────────────────────────────────────────────────────────

function findOccurrence(
  definition: SketchDefinition,
  target: TangentActionTarget,
): SplinePointOccurrence<SketchPointId> | null {
  const entity = definition.entities.find(
    (e) => e.entityId === target.entityId,
  );
  if (!entity || entity.kind !== "spline") return null;
  const ordered = orderedSplineOccurrences(entity);
  if (!ordered) return null;
  return (
    ordered.find((occ) => occ.occurrenceId === target.occurrenceId) ?? null
  );
}

/**
 * Apply a tangent patch to every listed target. Returns the same definition
 * reference when nothing would change (the caller uses identity to detect
 * no-ops).
 */
function patchTangents(
  definition: SketchDefinition,
  targets: readonly TangentActionTarget[],
  makeTangent: () => SplinePointOccurrence["tangent"],
): SketchDefinition {
  const targetMap = new Map<string, Set<string>>();
  for (const t of targets) {
    let set = targetMap.get(t.entityId);
    if (!set) {
      set = new Set();
      targetMap.set(t.entityId, set);
    }
    set.add(t.occurrenceId);
  }

  let changed = false;
  const entities = definition.entities.map(
    (entity: SketchEntityDefinition): SketchEntityDefinition => {
      if (entity.kind !== "spline") return entity;
      const occSet = targetMap.get(entity.entityId);
      if (!occSet) return entity;
      let entityChanged = false;
      const pointOccurrences = entity.pointOccurrences.map((occ) => {
        if (!occSet.has(occ.occurrenceId)) return occ;
        const newTangent = makeTangent();
        // Check identity: don't create a new object when nothing changes.
        if (
          occ.tangent.kind === newTangent.kind &&
          (occ.tangent.kind === "automatic" ||
            (occ.tangent.kind === "authored" &&
              newTangent.kind === "authored" &&
              occ.tangent.vector[0] === newTangent.vector[0] &&
              occ.tangent.vector[1] === newTangent.vector[1]))
        ) {
          return occ;
        }
        entityChanged = true;
        return { ...occ, tangent: newTangent };
      });
      if (!entityChanged) return entity;
      changed = true;
      return { ...entity, pointOccurrences };
    },
  );

  if (!changed) return definition;
  return { ...definition, entities };
}
