import type { PrimitiveRef } from "@/core/editor/schema";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { orderedSplinePointIds } from "@/contracts/sketch/spline-geometry";
import {
  nonAcceptedDerivedOutputPoints,
  nonAcceptedDerivedOutputs,
} from "@/contracts/sketch/offset-publication";

/**
 * D9′ (T15d): the acceptance a drag target is judged against, the G19 fields
 * of the session's live (or display) solve. Null: no solve yet, which
 * accepts no offset output and knows of no failed mirror (G19a).
 */
export type SketchDragAcceptance = Pick<
  SolvedSketchSnapshot,
  "solvedEntities" | "certifiedOffsetDerivationIds" | "failedDerivationIds"
>;

const NO_SOLVE: SketchDragAcceptance = { solvedEntities: [] };

/**
 * Whether any of `entityIds`, or a mirror seed upstream of it, is an output
 * of a pattern, transform or offset relationship. Bounded: every entity is
 * visited once.
 */
function readsOneWayOutput(
  relationships: NonNullable<SketchDefinition["derivedRelationships"]>,
  entityIds: readonly SketchEntityId[],
): boolean {
  const visited = new Set<SketchEntityId>();
  const pending = [...entityIds];
  for (let entityId = pending.pop(); entityId; entityId = pending.pop()) {
    if (visited.has(entityId)) continue;
    visited.add(entityId);
    for (const relationship of relationships) {
      const output = relationship.outputs.find(
        (candidate) => candidate.outputEntityId === entityId,
      );
      if (relationship.kind === "mirror") {
        if (output) pending.push(output.seedEntityId);
        continue;
      }
      if (
        output ||
        (relationship.kind === "offset" &&
          [
            ...relationship.jointOutputs,
            ...relationship.piecewiseCubicOutputs,
          ].some((candidate) => candidate.outputEntityId === entityId))
      )
        return true;
    }
  }
  return false;
}

/**
 * D9′ ([TECH] T-10, review A-2): whether a sketch point or entity is driven
 * by a derived relationship and cannot start a drag. Pattern, transform and
 * offset outputs (and their driven points: output points, joint points,
 * shell terminals) are one-way. Mirror outputs are draggable (the coupled
 * solve moves the seed), unless G19 non-accepted (a failed (held) mirror's
 * copy, or a copy of a non-accepted offset output) or (review A-1) the
 * mirror image of a one-way output, directly or through a mirror chain.
 */
function isNonDraggableDerivedTarget(
  definition: SketchDefinition,
  acceptance: SketchDragAcceptance | null,
  target: { pointId: SketchPointId } | { entityId: SketchEntityId },
): boolean {
  const relationships = definition.derivedRelationships ?? [];
  if (relationships.length === 0) return false;
  const isPoint = "pointId" in target;
  const driven = relationships.find((relationship) => {
    const outputs = isPoint
      ? relationship.outputs.some((output) =>
          output.outputPointIds.includes(target.pointId),
        )
      : relationship.outputs.some(
          (output) => output.outputEntityId === target.entityId,
        );
    if (outputs) return true;
    if (relationship.kind !== "offset") return false;
    return isPoint
      ? relationship.jointOutputs.some(
          (joint) =>
            joint.startPointId === target.pointId ||
            joint.endPointId === target.pointId ||
            joint.centerPointId === target.pointId,
        ) ||
          relationship.piecewiseCubicOutputs.some(
            (shell) =>
              shell.startPointId === target.pointId ||
              shell.endPointId === target.pointId,
          )
      : relationship.jointOutputs.some(
          (joint) => joint.outputEntityId === target.entityId,
        ) ||
          relationship.piecewiseCubicOutputs.some(
            (shell) => shell.outputEntityId === target.entityId,
          );
  });
  if (!driven) return false;
  if (driven.kind !== "mirror") return true;
  // T15d review A-1 (decided): the copy of a one-way output (directly or
  // through a mirror chain) is one-way too, so it is no drag target either.
  const seeds = driven.outputs
    .filter((output) =>
      isPoint
        ? output.outputPointIds.includes(target.pointId)
        : output.outputEntityId === target.entityId,
    )
    .map((output) => output.seedEntityId);
  if (readsOneWayOutput(relationships, seeds)) return true;
  const snapshot = acceptance ?? NO_SOLVE;
  return isPoint
    ? nonAcceptedDerivedOutputPoints(definition, snapshot).has(target.pointId)
    : nonAcceptedDerivedOutputs(definition, snapshot).has(target.entityId);
}

/**
 * Deterministic per-handle drag intent contract (minimum-motion-sketch-drag, D5).
 *
 * The drag intent is derived purely from WHICH handle the user grabbed, so the
 * same grab always requests the same kind of movement regardless of solver
 * internals. Rigid whole-component translation is no longer a point-drag
 * outcome; it is the explicit meaning of an entity-body grab (and of a
 * circle/arc center grab).
 */
export type SketchDragHandle =
  | { kind: "point"; pointId: SketchPointId }
  | { kind: "entityBody"; entityId: SketchEntityId }
  | { kind: "rim"; entityId: SketchEntityId }
  | { kind: "center"; entityId: SketchEntityId }
  | {
      kind: "tangentHandle";
      entityId: SketchEntityId;
      occurrenceId: string;
      pointId: SketchPointId;
    };

export type SketchDragIntent =
  /** Soft-target only the grabbed point. Connected entities stretch/rotate. */
  | { kind: "point"; pointId: SketchPointId }
  /** Apply an identical translation soft-target to all listed defining points. */
  | { kind: "translate"; pointIds: readonly SketchPointId[] }
  /** Soft-target the radius value of a circle or arc; the center is untouched. */
  | { kind: "radius"; entityId: SketchEntityId }
  /** Soft-target only the tangent vector variables; fit points are anchored. */
  | {
      kind: "tangentVector";
      entityId: SketchEntityId;
      occurrenceId: string;
      pointId: SketchPointId;
    };

/**
 * The defining points of an entity — the points an entity-body drag translates
 * as a rigid group.
 */
export function getSketchEntityDefiningPointIds(
  definition: SketchDefinition,
  entityId: SketchEntityId,
): readonly SketchPointId[] {
  const entity = definition.entities.find(
    (entry) => entry.entityId === entityId,
  );
  if (!entity) {
    return [];
  }

  switch (entity.kind) {
    case "point":
      return [entity.pointId];
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "circle":
      return [entity.centerPointId];
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId];
    case "spline":
      return orderedSplinePointIds(entity);
    case "ellipse":
      return [entity.centerPointId, entity.majorAxisPointId];
    case "ellipticalArc":
      return [
        entity.centerPointId,
        entity.majorAxisPointId,
        entity.startPointId,
        entity.endPointId,
      ];
    case "conic":
      return [entity.startPointId, entity.controlPointId, entity.endPointId];
    case "bezierCurve":
      return entity.controlPointIds;
    case "profileText":
      return [entity.anchorPointId];
    // A derived shell has no defining points: dragging it never moves seeds.
    case "derivedPiecewiseCubic":
      return [];
  }
}

/**
 * D10 handle resolution: map a PrimitiveRef + definition to the correct
 * drag handle.
 *
 * - line or spline curve → entityBody
 * - circle or arc curve → rim (radius)
 * - sketch point that is the centre of exactly one circle/arc → center
 * - any other authored sketch point (incl. spline fit points) → point
 * - construction sketch curves follow the same rules
 * - everything in D9′ (pattern/transform/offset outputs and their driven
 *   points, non-accepted G19 outputs incl. failed mirrors' copies,
 *   construction planes, reference/projected geometry, datums, regions,
 *   images, annotations) → null; mirror outputs resolve like authored
 *   geometry (T15d)
 */
export function resolveHandleFromTarget(
  definition: SketchDefinition,
  target: PrimitiveRef,
  acceptance: SketchDragAcceptance | null,
): SketchDragHandle | null {
  if (
    (target.kind === "sketchPoint" ||
      target.kind === "sketchEntity" ||
      target.kind === "sketchTangentHandle") &&
    isNonDraggableDerivedTarget(
      definition,
      acceptance,
      target.kind === "sketchPoint"
        ? { pointId: target.pointId }
        : { entityId: target.entityId as SketchEntityId },
    )
  ) {
    return null;
  }
  if (target.kind === "sketchPoint") {
    // Check if this point is the centre of exactly one circle or arc.
    const centreEntities = definition.entities.filter(
      (entity) =>
        (entity.kind === "circle" || entity.kind === "arc") &&
        entity.centerPointId === target.pointId,
    );
    if (centreEntities.length === 1) {
      return { kind: "center", entityId: centreEntities[0]!.entityId };
    }
    return { kind: "point", pointId: target.pointId };
  }
  if (target.kind === "sketchTangentHandle") {
    const entity = definition.entities.find(
      (entry) => entry.entityId === target.entityId,
    );
    if (!entity || entity.kind !== "spline") return null;
    const occurrence = entity.pointOccurrences.find(
      (occ) => occ.occurrenceId === target.occurrenceId,
    );
    if (!occurrence) return null;
    return {
      kind: "tangentHandle",
      entityId: target.entityId,
      occurrenceId: target.occurrenceId,
      pointId: target.pointId,
    };
  }
  if (target.kind === "sketchEntity") {
    const entity = definition.entities.find(
      (entry) => entry.entityId === target.entityId,
    );
    if (!entity) {
      return null;
    }
    // Derived shells have no defining points: not draggable.
    if (entity.kind === "derivedPiecewiseCubic") {
      return null;
    }
    // Circle and arc bodies → rim (radius).
    if (entity.kind === "circle" || entity.kind === "arc") {
      return { kind: "rim", entityId: entity.entityId };
    }
    // All other entity bodies (line, spline, ellipse, conic, bezier, etc.).
    return { kind: "entityBody", entityId: entity.entityId };
  }
  return null;
}

/**
 * Maps a grabbed handle onto its deterministic drag intent.
 *
 * - point handle → target only that point (endpoints stretch/rotate their line)
 * - entity-body handle → identical translation target on all defining points
 * - circle/arc rim handle → radius target (center gets no drag target)
 * - circle/arc center handle → translation intent for the whole entity
 */
export function resolveSketchDragIntent(
  definition: SketchDefinition,
  handle: SketchDragHandle,
): SketchDragIntent | null {
  switch (handle.kind) {
    case "point":
      return { kind: "point", pointId: handle.pointId };
    case "entityBody": {
      const pointIds = getSketchEntityDefiningPointIds(
        definition,
        handle.entityId,
      );
      return pointIds.length > 0 ? { kind: "translate", pointIds } : null;
    }
    case "rim": {
      const entity = definition.entities.find(
        (entry) => entry.entityId === handle.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
        return null;
      }
      return { kind: "radius", entityId: handle.entityId };
    }
    case "center": {
      const entity = definition.entities.find(
        (entry) => entry.entityId === handle.entityId,
      );
      if (
        !entity ||
        (entity.kind !== "circle" &&
          entity.kind !== "arc" &&
          entity.kind !== "ellipse" &&
          entity.kind !== "ellipticalArc")
      ) {
        return null;
      }
      // Center drag is a whole-entity translation intent. For a circle the
      // center is the only defining point, but an arc/ellipse also has
      // endpoints/axis points that must translate rigidly with it (translating
      // the center alone would deform the arc rather than move it).
      return {
        kind: "translate",
        pointIds: getSketchEntityDefiningPointIds(definition, handle.entityId),
      };
    }
    case "tangentHandle": {
      const entity = definition.entities.find(
        (entry) => entry.entityId === handle.entityId,
      );
      if (!entity || entity.kind !== "spline") {
        return null;
      }
      const occurrence = entity.pointOccurrences.find(
        (occ) => occ.occurrenceId === handle.occurrenceId,
      );
      if (!occurrence) {
        return null;
      }
      return {
        kind: "tangentVector",
        entityId: handle.entityId,
        occurrenceId: handle.occurrenceId,
        pointId: handle.pointId,
      };
    }
  }
}
