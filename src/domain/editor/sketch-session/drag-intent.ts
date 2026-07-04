import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";

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
  | { kind: "center"; entityId: SketchEntityId };

export type SketchDragIntent =
  /** Soft-target only the grabbed point. Connected entities stretch/rotate. */
  | { kind: "point"; pointId: SketchPointId }
  /** Apply an identical translation soft-target to all listed defining points. */
  | { kind: "translate"; pointIds: readonly SketchPointId[] }
  /** Soft-target the radius value of a circle or arc; the center is untouched. */
  | { kind: "radius"; entityId: SketchEntityId };

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
      return entity.fitPointIds;
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
  }
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
  }
}
