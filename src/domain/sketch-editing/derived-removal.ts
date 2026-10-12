/**
 * T16a ([TECH] T16-1) / T17c ([TECH] T17-5, issue 15 "Invalid state and
 * recovery"): the explicit removal write set of a derived relationship
 * (mirror, offset), shared by "Remove Mirror" and "Remove Offset". The only
 * kind-specific part is which records a relationship outputs
 * (`relationshipOutputs`); the sweep and the requirement rule are
 * ordinary Delete semantics, nothing cascades.
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

export interface DerivedRelationshipRemoval {
  /** The definition without the relationship and its write set. */
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

/** The removable kinds. */
export type RemovableDerivedKind = Extract<
  SketchDerivationDefinition["kind"],
  "mirror" | "offset"
>;

/**
 * The records relationship outputs: its output entities and the points it
 * recorded for them. An offset also owns its joint arcs (with the joint
 * centres and the adjacent outputs' ends they reuse) and its spline
 * shells, whose terminal driven points no entity references ([TECH] G18).
 */
function relationshipOutputs(relationship: SketchDerivationDefinition): {
  entityIds: SketchEntityId[];
  pointIds: SketchPointId[];
} {
  const entityIds = relationship.outputs.map((output) => output.outputEntityId);
  const pointIds = relationship.outputs.flatMap(
    (output) => output.outputPointIds,
  );
  if (relationship.kind !== "offset") return { entityIds, pointIds };
  return {
    entityIds: [
      ...entityIds,
      ...relationship.jointOutputs.map((joint) => joint.outputEntityId),
      ...relationship.piecewiseCubicOutputs.map(
        (shell) => shell.outputEntityId,
      ),
    ],
    pointIds: [
      ...pointIds,
      ...relationship.jointOutputs.flatMap((joint) => [
        joint.centerPointId,
        joint.startPointId,
        joint.endPointId,
      ]),
      ...relationship.piecewiseCubicOutputs.flatMap((shell) => [
        shell.startPointId,
        shell.endPointId,
      ]),
    ],
  };
}

/**
 * Removes relationship `derivationId` of `kind` with its write set: the
 * relationship; its output entities that still exist; their output points
 * (an offset's shell terminals included, which no entity references, G18)
 * no remaining entity references (an output point shared by two outputs or
 * reused by a user entity stays while referenced); the constraints and
 * dimensions that name removed geometry. Seeds and every other
 * relationship are untouched: nothing cascades, nothing is retargeted.
 * Works whatever the relationship's health. Null when the definition has
 * no such relationship.
 */
export function removeDerivedRelationship(
  definition: SketchDefinition,
  derivationId: string,
  kind: RemovableDerivedKind,
): DerivedRelationshipRemoval | null {
  const relationship = definition.derivedRelationships?.find(
    (candidate) =>
      candidate.kind === kind && candidate.derivationId === derivationId,
  );
  if (!relationship) return null;

  const outputs = relationshipOutputs(relationship);
  const outputEntityIds = new Set(outputs.entityIds);
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
    ...outputs.pointIds,
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
