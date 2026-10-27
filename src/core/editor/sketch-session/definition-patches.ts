import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  SketchDefinition,
  SketchPointDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  evaluateAuthoredSketchDerivations,
  type AuthoredSketchDerivationSettings,
} from "@/core/modeling/sketch-dimension-expressions";
import {
  orderDerivedRelationships,
  syncMirrorOutputStructures,
} from "@/contracts/sketch/mirror-requirements";
import {
  cubicSpansPoleBounds,
  orderedSplineOccurrences,
} from "@/contracts/sketch/spline-geometry";
import type { SketchToolAnchorDescriptor } from "@/core/sketch-tools/editor-schema";

export function addAnchorOffset(
  anchor: SketchToolAnchorDescriptor,
  offset: { x: number; y: number },
): SketchToolAnchorDescriptor {
  const currentOffset = anchor.offset ?? { x: 0, y: 0 };

  return {
    ...anchor,
    offset: {
      x: currentOffset.x + offset.x,
      y: currentOffset.y + offset.y,
    },
  };
}

/**
 * The unconstrained drag fast path's write (T12b): the dragged point
 * positions, then every derived relationship re-evaluated. T15d: only for
 * sketches without a mirror relationship (a mirror drag always solves, so
 * its outputs are written from the solve, never re-derived here); pattern,
 * transform and offset outputs still follow their seeds this way.
 */
export function applyPointPositionsToDefinition(
  definition: SketchDefinition,
  positions: readonly Pick<SketchPointDefinition, "pointId" | "position">[],
  derivation: AuthoredSketchDerivationSettings,
): SketchDefinition {
  const positionMap = new Map(
    positions.map((point) => [point.pointId, point.position]),
  );

  if (positionMap.size === 0) {
    return definition;
  }

  const nextDefinition = {
    ...definition,
    points: definition.points.map((point) => {
      const position = positionMap.get(point.pointId);
      return position ? { ...point, position } : point;
    }),
  };

  return evaluateAuthoredSketchDerivations({
    definition: nextDefinition,
    ...derivation,
  }).definition;
}

/**
 * Writes an accepted solve into the authored definition.
 *
 * T15d ([TECH] T-3, review R-1): the snapshot is the only owner of values.
 * Every solved point and circle radius (mirror outputs included) and every
 * authored spline handle (mirror output occurrences included) is written
 * as the snapshot holds it; mirrors are never re-evaluated here. The
 * mirror owner's structural sync (tangent kinds incl. exact zero, sweep,
 * closure, policy, `endSpanParameterLengths`) runs between the two writes,
 * so an output occurrence that became authored takes the snapshot's
 * vector. A failed (held) mirror keeps its stored outputs. Pattern,
 * transform and offset relationships are re-evaluated as before, in
 * dependency order, from the written geometry.
 */
export function applySolvedSketchToDefinition(
  definition: SketchDefinition,
  solvedSnapshot: SolvedSketchSnapshot,
  derivation: AuthoredSketchDerivationSettings,
): SketchDefinition {
  const solvedPointPositions = new Map(
    solvedSnapshot.solvedPoints.map((point) => [
      point.pointId,
      point.solvedPosition,
    ]),
  );
  // A circle's radius is a solver variable (its only one besides the centre
  // point), so the accepted radius is written back like a point position.
  const solvedCircleRadii = new Map(
    solvedSnapshot.solvedEntities.flatMap((entity) =>
      entity.kind === "circle"
        ? [[entity.entityId, entity.solvedRadius] as const]
        : [],
    ),
  );
  const solvedSplines = new Map(
    solvedSnapshot.solvedEntities.flatMap((entity) =>
      entity.kind === "spline" && entity.reconstruction.validity === "valid"
        ? [[entity.entityId, entity.reconstruction] as const]
        : [],
    ),
  );

  const solvedHandles = new Map(
    definition.entities.flatMap((entity) => {
      const reconstruction = solvedSplines.get(entity.entityId);
      const ordered =
        entity.kind === "spline" ? orderedSplineOccurrences(entity) : null;
      return reconstruction && ordered
        ? [
            [
              entity.entityId,
              new Map(
                ordered.map((occurrence, index) => [
                  occurrence.occurrenceId,
                  reconstruction.handles[index],
                ]),
              ),
            ] as const,
          ]
        : [];
    }),
  );

  const positionedDefinition = {
    ...definition,
    points: definition.points.map((point) => {
      const position = solvedPointPositions.get(point.pointId);
      return position ? { ...point, position } : point;
    }),
    entities: definition.entities.map((entity) => {
      if (entity.kind !== "circle") return entity;
      const radius = solvedCircleRadii.get(entity.entityId);
      return radius === undefined ? entity : { ...entity, radius };
    }),
  };
  const structuredDefinition = syncMirrorOutputStructures({
    definition: positionedDefinition,
    modelingTolerance: derivation.modelingTolerance,
    held: new Set(solvedSnapshot.failedDerivationIds ?? []),
  });

  const acceptedDefinition = {
    ...structuredDefinition,
    entities: structuredDefinition.entities.map((entity) => {
      if (entity.kind !== "spline") return entity;
      const solvedByOccurrence = solvedHandles.get(entity.entityId);
      if (!solvedByOccurrence) return entity;
      return {
        ...entity,
        pointOccurrences: entity.pointOccurrences.map((occurrence) => {
          const vector = solvedByOccurrence.get(occurrence.occurrenceId);
          return occurrence.tangent.kind === "authored" && vector
            ? {
                ...occurrence,
                tangent: { kind: "authored" as const, vector },
              }
            : occurrence;
        }),
      };
    }),
  };

  // Only the resolved non-mirror relationships are re-evaluated; an
  // unresolved one stays held as the snapshot holds it.
  const reevaluated = orderDerivedRelationships(definition).order.filter(
    (relationship) => relationship.kind !== "mirror",
  );
  if (reevaluated.length === 0) return acceptedDefinition;
  return {
    ...evaluateAuthoredSketchDerivations({
      definition: {
        ...acceptedDefinition,
        derivedRelationships: reevaluated,
      },
      ...derivation,
    }).definition,
    derivedRelationships: definition.derivedRelationships,
  };
}

export function getSketchDatumGuideExtent(
  definition: SketchDefinition,
  projectedReferences: readonly import("@/contracts/solver/schema").ProjectedSketchReferenceRecord[],
) {
  const localCoordinates = definition.points.flatMap(
    (point: SketchPointDefinition) => [
      Math.abs(point.position[0]),
      Math.abs(point.position[1]),
    ],
  );
  const projectedCoordinates = projectedReferences.flatMap((reference) =>
    reference.geometry.flatMap((geometry) => {
      switch (geometry.kind) {
        case "point":
          return [
            Math.abs(geometry.position[0]),
            Math.abs(geometry.position[1]),
          ];
        case "lineSegment":
          return [
            Math.abs(geometry.startPosition[0]),
            Math.abs(geometry.startPosition[1]),
            Math.abs(geometry.endPosition[0]),
            Math.abs(geometry.endPosition[1]),
          ];
        case "circle":
          return [
            Math.abs(geometry.centerPosition[0]) + geometry.radius,
            Math.abs(geometry.centerPosition[1]) + geometry.radius,
          ];
        case "arc": {
          const radius = Math.hypot(
            geometry.startPosition[0] - geometry.centerPosition[0],
            geometry.startPosition[1] - geometry.centerPosition[1],
          );
          return [
            Math.abs(geometry.centerPosition[0]) + radius,
            Math.abs(geometry.centerPosition[1]) + radius,
          ];
        }
        case "spline": {
          // Exact and conservative: the pole box contains the curve.
          const { representation } = geometry;
          const bounds =
            representation.kind === "neutralCubicSpans"
              ? cubicSpansPoleBounds(representation.spans)
              : null;
          const points: readonly SketchPoint[] =
            representation.kind === "neutralCubicSpans"
              ? bounds
                ? [bounds.min, bounds.max]
                : []
              : representation.points;
          return points.flatMap((point) => [
            Math.abs(point[0]),
            Math.abs(point[1]),
          ]);
        }
      }
    }),
  );
  const maxCoordinate = Math.max(
    0,
    ...localCoordinates,
    ...projectedCoordinates,
  );
  return Math.max(10, maxCoordinate * 1.35 || 10);
}
