/**
 * T16a ([TECH] T16-1, issue 15 "Invalid state and recovery"): explicit
 * repair of a mirror relationship. Removal is the only repair here (T16e
 * adds replacement, T17 reuses the write set for offsets).
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
  SketchDerivationDefinition,
} from "@/contracts/sketch/schema";
import {
  constraintReferencesSketchGeometry,
  dimensionReferencesSketchGeometry,
  getEntityPointIds,
} from "./definition-references";

export interface MirrorRemoval {
  /** The definition without the mirror and its write set. */
  readonly definition: SketchDefinition;
  /** Output entities that still existed and were removed. */
  readonly removedEntityIds: ReadonlySet<SketchEntityId>;
  readonly removedPointIds: ReadonlySet<SketchPointId>;
  /** Requirements naming removed geometry (ordinary Delete semantics). */
  readonly removedConstraints: readonly ConstraintDefinition[];
  readonly removedDimensions: readonly DimensionDefinition[];
  /**
   * Other relationships that read removed geometry (seed, seed point or
   * mirror line). They are kept untouched and become explicitly broken.
   */
  readonly brokenDownstream: readonly SketchDerivationDefinition[];
}

/**
 * Removes mirror `derivationId` with its write set: the relationship; its
 * output entities that still exist; their output points no remaining
 * entity references (an output point shared by two outputs or reused by a
 * user entity stays while referenced); the constraints and dimensions that
 * name removed geometry. Seeds, the axis and every other relationship are
 * untouched: nothing cascades, nothing is retargeted. Works whatever the
 * mirror's health (any broken state, an orphan). Null when the definition
 * has no mirror with that id.
 */
export function removeMirrorRelationship(
  definition: SketchDefinition,
  derivationId: string,
): MirrorRemoval | null {
  const relationship = definition.derivedRelationships?.find(
    (candidate) =>
      candidate.kind === "mirror" && candidate.derivationId === derivationId,
  );
  if (!relationship) return null;

  const outputEntityIds = new Set(
    relationship.outputs.map((output) => output.outputEntityId),
  );
  const removedEntities = definition.entities.filter((entity) =>
    outputEntityIds.has(entity.entityId),
  );
  const removedEntityIds = new Set(
    removedEntities.map((entity) => entity.entityId),
  );
  const entities = definition.entities.filter(
    (entity) => !removedEntityIds.has(entity.entityId),
  );
  const referencedPointIds = new Set(entities.flatMap(getEntityPointIds));
  const candidatePointIds = new Set<SketchPointId>([
    ...relationship.outputs.flatMap((output) => output.outputPointIds),
    ...removedEntities.flatMap(getEntityPointIds),
  ]);
  const removedPointIds = new Set(
    definition.pointIds.filter(
      (pointId) =>
        candidatePointIds.has(pointId) && !referencedPointIds.has(pointId),
    ),
  );
  const points = definition.points.filter(
    (point) => !removedPointIds.has(point.pointId),
  );
  const removedConstraints = definition.constraints.filter((constraint) =>
    constraintReferencesSketchGeometry(
      constraint,
      removedPointIds,
      removedEntityIds,
    ),
  );
  const removedDimensions = definition.dimensions.filter((dimension) =>
    dimensionReferencesSketchGeometry(
      dimension,
      removedPointIds,
      removedEntityIds,
    ),
  );
  const constraints = definition.constraints.filter(
    (constraint) => !removedConstraints.includes(constraint),
  );
  const dimensions = definition.dimensions.filter(
    (dimension) => !removedDimensions.includes(dimension),
  );
  const derivedRelationships = definition.derivedRelationships!.filter(
    (candidate) => candidate !== relationship,
  );
  const brokenDownstream = derivedRelationships.filter((candidate) =>
    readsRemovedGeometry(candidate, removedEntityIds, removedPointIds),
  );

  return {
    definition: {
      ...definition,
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: dimensions.map((dimension) => dimension.dimensionId),
      dimensions,
      derivedRelationships,
    },
    removedEntityIds,
    removedPointIds,
    removedConstraints,
    removedDimensions,
    brokenDownstream,
  };
}

/** Whether `relationship` reads a removed entity or point (its seeds, seed points or mirror line). */
function readsRemovedGeometry(
  relationship: SketchDerivationDefinition,
  entityIds: ReadonlySet<SketchEntityId>,
  pointIds: ReadonlySet<SketchPointId>,
) {
  return (
    relationship.seedEntityIds.some((entityId) => entityIds.has(entityId)) ||
    relationship.outputs.some(
      (output) =>
        entityIds.has(output.seedEntityId) ||
        output.seedPointIds.some((pointId) => pointIds.has(pointId)),
    ) ||
    (relationship.kind === "mirror" &&
      relationship.mirrorReference.kind === "lineEntity" &&
      entityIds.has(relationship.mirrorReference.entityId))
  );
}
