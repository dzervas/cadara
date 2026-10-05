import type { PrimitiveRef } from "@/core/editor/schema";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import { orderedSplinePointIds } from "@/contracts/sketch/spline-geometry";

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
 * - everything in D9 (derived outputs, driven points, non-accepted G19
 *   outputs, construction planes, reference/projected geometry, datums,
 *   regions, images, annotations) → null
 */
export function resolveHandleFromTarget(
  definition: SketchDefinition,
  target: PrimitiveRef,
): SketchDragHandle | null {
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
