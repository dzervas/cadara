import type {
  ConstraintDefinition,
  DimensionDefinition,
  LocalCollinearTargetOperand,
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPointConstraintOperand,
  SketchReferenceImageRecord,
} from "@/contracts/sketch/schema";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";
import { mirrorEditRefusal } from "./operations";
import type {
  ConstraintId,
  DimensionId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";

/**
 * T13j (D25): explicit endpoint merge. The second pick (destination) keeps
 * its id and authored position; the first (source) is deleted and every
 * reference to it follows the destination. No connecting segment, no
 * coincident substitute, no tolerance: a merged point is authored
 * connectivity (a declared join).
 */

function unreachable(value: never): never {
  throw new Error(`Unhandled merge reference kind: ${JSON.stringify(value)}`);
}

/**
 * Every reference to point `from` in `definition` retargeted to `to`. One
 * exhaustive, `never`-checked switch per reference-holding record kind
 * (entities incl. spline point occurrences and profile-text anchors, every
 * constraint and dimension kind, derived relationships' seed/output point
 * ids, reference-image ownership and calibration anchors). Point records
 * themselves are untouched (the caller decides what happens to `from`).
 */
export function retargetSketchPointReferences(
  definition: SketchDefinition,
  from: SketchPointId,
  to: SketchPointId,
): SketchDefinition {
  const p = (pointId: SketchPointId) => (pointId === from ? to : pointId);
  const pair = (
    pointIds: readonly [SketchPointId, SketchPointId],
  ): readonly [SketchPointId, SketchPointId] => [
    p(pointIds[0]),
    p(pointIds[1]),
  ];
  const pointOperand = <TOperand extends SketchPointConstraintOperand>(
    operand: TOperand,
  ): TOperand =>
    operand.kind === "localPoint"
      ? { ...operand, pointId: p(operand.pointId) }
      : operand;
  const collinearTarget = (
    operand: LocalCollinearTargetOperand,
  ): LocalCollinearTargetOperand =>
    operand.kind === "localPoint"
      ? { ...operand, pointId: p(operand.pointId) }
      : operand;

  const entity = (record: SketchEntityDefinition): SketchEntityDefinition => {
    switch (record.kind) {
      case "lineSegment":
        return {
          ...record,
          startPointId: p(record.startPointId),
          endPointId: p(record.endPointId),
        };
      case "point":
        return { ...record, pointId: p(record.pointId) };
      case "circle":
        return { ...record, centerPointId: p(record.centerPointId) };
      case "arc":
        return {
          ...record,
          centerPointId: p(record.centerPointId),
          startPointId: p(record.startPointId),
          endPointId: p(record.endPointId),
        };
      case "spline":
        return {
          ...record,
          pointOccurrences: record.pointOccurrences.map((occurrence) => ({
            ...occurrence,
            pointId: p(occurrence.pointId),
          })),
        };
      case "ellipse":
        return {
          ...record,
          centerPointId: p(record.centerPointId),
          majorAxisPointId: p(record.majorAxisPointId),
        };
      case "ellipticalArc":
        return {
          ...record,
          centerPointId: p(record.centerPointId),
          majorAxisPointId: p(record.majorAxisPointId),
          startPointId: p(record.startPointId),
          endPointId: p(record.endPointId),
        };
      case "conic":
        return {
          ...record,
          startPointId: p(record.startPointId),
          controlPointId: p(record.controlPointId),
          endPointId: p(record.endPointId),
        };
      case "bezierCurve":
        return { ...record, controlPointIds: record.controlPointIds.map(p) };
      case "profileText":
        return { ...record, anchorPointId: p(record.anchorPointId) };
      case "derivedPiecewiseCubic":
        // A shell owns no points; its terminals are relationship outputs.
        return record;
      default:
        return unreachable(record);
    }
  };

  const constraint = (record: ConstraintDefinition): ConstraintDefinition => {
    switch (record.kind) {
      case "coincident":
        return { ...record, pointIds: pair(record.pointIds) };
      case "angle":
        return {
          ...record,
          pointIds: [
            p(record.pointIds[0]),
            p(record.pointIds[1]),
            p(record.pointIds[2]),
          ],
        };
      case "symmetric":
      case "symmetricProjectedLine":
        return { ...record, pointIds: pair(record.pointIds) };
      case "fixPoint":
        return { ...record, pointId: p(record.pointId) };
      case "coincidentProjectedPoint":
      case "pointOnProjectedCurve":
      case "midpoint":
      case "midpointProjectedLine":
      case "pointOnCurve":
      case "normal":
      case "normalProjectedCurve":
        return { ...record, point: pointOperand(record.point) };
      case "collinear":
      case "collinearProjectedLine":
        return { ...record, target: collinearTarget(record.target) };
      // Entity-only kinds: no point reference.
      case "horizontal":
      case "vertical":
      case "parallelProjectedLine":
      case "perpendicularProjectedLine":
      case "tangentProjectedCurve":
      case "tangent":
      case "concentric":
      case "concentricProjectedCurve":
      case "parallel":
      case "perpendicular":
      case "equalLength":
      case "equalOffset":
        return record;
      default:
        return unreachable(record);
    }
  };

  const dimension = (record: DimensionDefinition): DimensionDefinition => {
    switch (record.kind) {
      case "distance":
      case "horizontalDistance":
      case "verticalDistance":
        return { ...record, pointIds: pair(record.pointIds) };
      case "pointDatumDistance":
        return { ...record, point: pointOperand(record.point) };
      case "linePointDistance":
        return { ...record, point: pointOperand(record.point) };
      case "arcStartPointCoincident":
      case "arcEndPointCoincident":
        return { ...record, pointId: p(record.pointId) };
      // Entity-only kinds: no point reference.
      case "circleRadius":
      case "diameter":
      case "lineLength":
      case "lineDistance":
      case "lineAngle":
        return record;
      default:
        return unreachable(record);
    }
  };

  const relationship = (
    record: SketchDerivationDefinition,
  ): SketchDerivationDefinition => {
    const outputs = record.outputs.map((output) => ({
      ...output,
      seedPointIds: output.seedPointIds.map(p),
      outputPointIds: output.outputPointIds.map(p),
    }));
    switch (record.kind) {
      case "mirror":
      case "linearPattern":
      case "circularPattern":
      case "transform":
        return { ...record, outputs };
      case "offset":
        return {
          ...record,
          outputs,
          jointOutputs: record.jointOutputs.map((joint) => ({
            ...joint,
            centerPointId: p(joint.centerPointId),
            startPointId: p(joint.startPointId),
            endPointId: p(joint.endPointId),
          })),
          piecewiseCubicOutputs: record.piecewiseCubicOutputs.map((output) => ({
            ...output,
            startPointId: p(output.startPointId),
            endPointId: p(output.endPointId),
          })),
        };
      default:
        return unreachable(record);
    }
  };

  const referenceImage = (
    record: SketchReferenceImageRecord,
  ): SketchReferenceImageRecord => {
    const calibration = record.ownedState.calibration;
    return {
      ...record,
      ownedPointIds: record.ownedPointIds.map(p),
      ownedState: calibration
        ? {
            ...record.ownedState,
            calibration: {
              ...calibration,
              anchors: calibration.anchors.map((anchor) => ({
                ...anchor,
                pointId:
                  anchor.pointId === from ? (to as string) : anchor.pointId,
              })),
            },
          }
        : record.ownedState,
    };
  };

  return {
    ...definition,
    entities: definition.entities.map(entity),
    constraints: definition.constraints.map(constraint),
    dimensions: definition.dimensions.map(dimension),
    ...(definition.derivedRelationships
      ? {
          derivedRelationships:
            definition.derivedRelationships.map(relationship),
        }
      : {}),
    ...(definition.referenceImages
      ? { referenceImages: definition.referenceImages.map(referenceImage) }
      : {}),
  };
}

type PointRole =
  | { kind: "end"; entity: SketchEntityDefinition }
  | { kind: "point" }
  | { kind: "centre"; entity: SketchEntityDefinition }
  | { kind: "interiorFit"; entity: SketchEntityDefinition }
  | { kind: "control"; entity: SketchEntityDefinition }
  | { kind: "anchor"; entity: SketchEntityDefinition };

/** The role each point plays in one entity (exhaustive over entity kinds). */
function entityPointRoles(
  entity: SketchEntityDefinition,
): readonly (readonly [SketchPointId, PointRole])[] {
  const end = { kind: "end", entity } as const;
  const centre = { kind: "centre", entity } as const;
  const control = { kind: "control", entity } as const;
  switch (entity.kind) {
    case "lineSegment":
      return [
        [entity.startPointId, end],
        [entity.endPointId, end],
      ];
    case "point":
      return [[entity.pointId, { kind: "point" }]];
    case "circle":
      return [[entity.centerPointId, centre]];
    case "arc":
      return [
        [entity.startPointId, end],
        [entity.endPointId, end],
        [entity.centerPointId, centre],
      ];
    case "spline": {
      const occurrences = orderedSplineOccurrences(entity) ?? [];
      return occurrences.map((occurrence, index) => [
        occurrence.pointId,
        entity.closure === "open" &&
        (index === 0 || index === occurrences.length - 1)
          ? end
          : { kind: "interiorFit", entity },
      ]);
    }
    case "ellipse":
      return [
        [entity.centerPointId, centre],
        [entity.majorAxisPointId, control],
      ];
    case "ellipticalArc":
      return [
        [entity.startPointId, end],
        [entity.endPointId, end],
        [entity.centerPointId, centre],
        [entity.majorAxisPointId, control],
      ];
    case "conic":
      return [
        [entity.startPointId, end],
        [entity.endPointId, end],
        [entity.controlPointId, control],
      ];
    case "bezierCurve":
      return entity.controlPointIds.map((pointId, index, all) => [
        pointId,
        index === 0 || index === all.length - 1 ? end : control,
      ]);
    case "profileText":
      return [[entity.anchorPointId, { kind: "anchor", entity }]];
    case "derivedPiecewiseCubic":
      return [];
    default:
      return unreachable(entity);
  }
}

function pointRoles(definition: SketchDefinition, pointId: SketchPointId) {
  return definition.entities.flatMap((entity) =>
    entityPointRoles(entity)
      .filter(([id]) => id === pointId)
      .map(([, role]) => role),
  );
}

/** G18: points driven by a derived relationship (outputs, joint centres, shell terminals). */
function drivenPointOwner(
  definition: SketchDefinition,
  pointId: SketchPointId,
): SketchDerivationDefinition | null {
  return (
    (definition.derivedRelationships ?? []).find(
      (relationship) =>
        relationship.outputs.some((output) =>
          output.outputPointIds.includes(pointId),
        ) ||
        (relationship.kind === "offset" &&
          (relationship.jointOutputs.some(
            (joint) =>
              joint.centerPointId === pointId ||
              joint.startPointId === pointId ||
              joint.endPointId === pointId,
          ) ||
            relationship.piecewiseCubicOutputs.some(
              (output) =>
                output.startPointId === pointId ||
                output.endPointId === pointId,
            ))),
    ) ?? null
  );
}

/** R-4: the local points a relationship reads (its seeds' points, seed point ids, a mirror axis's points). */
function relationshipReferencedPointIds(
  definition: SketchDefinition,
  relationship: SketchDerivationDefinition,
) {
  const entityIds = new Set<SketchEntityId>(relationship.seedEntityIds);
  // A sketch datum axis has no local points (T15b).
  if (
    relationship.kind === "mirror" &&
    relationship.mirrorReference.kind === "lineEntity"
  )
    entityIds.add(relationship.mirrorReference.entityId);
  return new Set<SketchPointId>([
    ...definition.entities
      .filter((entity) => entityIds.has(entity.entityId))
      .flatMap((entity) => entityPointRoles(entity).map(([id]) => id)),
    ...relationship.outputs.flatMap((output) => output.seedPointIds),
  ]);
}

const RELATIONSHIP_KIND_NAMES: Record<
  SketchDerivationDefinition["kind"],
  string
> = {
  offset: "offset",
  mirror: "mirror",
  linearPattern: "linear pattern",
  circularPattern: "circular pattern",
  transform: "transform",
};

/** The refusal of one point as a merge input, or null when it is mergeable. */
export function getSketchMergePointRefusal(
  definition: SketchDefinition,
  pointId: SketchPointId,
): string | null {
  const point = definition.points.find((record) => record.pointId === pointId);
  if (!point) return "Merge Points needs a local sketch point.";
  const label = point.label;
  const driven = drivenPointOwner(definition, pointId);
  // T15d ([TECH] T-11): a mirror's seed points are not mergeable either,
  // so a mirrored copy's point names the mirror and its removal.
  if (driven)
    return driven.kind === "mirror"
      ? `${label} is driven by mirror ${driven.label}; remove the mirror first to merge it.`
      : `${label} is driven by ${RELATIONSHIP_KIND_NAMES[driven.kind]} ${driven.label}; it cannot be merged (merge its seed points instead).`;
  const image = definition.referenceImages?.find((record) =>
    record.ownedPointIds.includes(pointId),
  );
  if (image)
    return `${label} belongs to reference image ${image.label}; it cannot be merged.`;
  const roles = pointRoles(definition, pointId);
  for (const role of roles) {
    switch (role.kind) {
      case "centre":
        return `${label} is the centre of ${role.entity.label}; centres are not merged. Use Concentric or Coincident instead.`;
      case "interiorFit":
        return `${label} is an interior fit point of ${role.entity.label}; only the ends of an open spline can be merged.`;
      case "control":
        return `${label} is a control point of ${role.entity.label}; only curve ends and points can be merged.`;
      case "anchor":
        return `${label} is the anchor of ${role.entity.label}; only curve ends and points can be merged.`;
      case "end":
      case "point":
        break;
    }
  }
  return roles.length === 0
    ? `${label} is not a curve end or a point; it cannot be merged.`
    : null;
}

export const MERGE_POINTS_SAME_POINT_MESSAGE =
  "Pick two different points: a point cannot be merged into itself.";
export const MERGE_POINTS_NON_LOCAL_MESSAGE =
  "Projected and datum points are not local sketch points; they cannot be merged.";

export type SketchMergePointsResult =
  | { valid: false; message: string }
  | {
      valid: true;
      definition: SketchDefinition;
      /** The `coincident` constraints between exactly {source, destination}, now part of the merge. */
      absorbedConstraintIds: readonly ConstraintId[];
      /** The open spline whose own ends were merged (R-5 positional closure). */
      closedSplineEntityId: SketchEntityId | null;
      /** Retained requirements that referenced the source (now the destination). */
      retargetedRequirementIds: readonly (ConstraintId | DimensionId)[];
    };

/** Constraints/dimensions referencing `pointId` (detected by retargeting it). */
function requirementIdsReferencing(
  definition: SketchDefinition,
  pointId: SketchPointId,
): (ConstraintId | DimensionId)[] {
  const probe = "sketch_point_merge-probe" as SketchPointId;
  const retargeted = retargetSketchPointReferences(definition, pointId, probe);
  const changed = (before: unknown, after: unknown) =>
    JSON.stringify(before) !== JSON.stringify(after);
  return [
    ...definition.constraints.flatMap((constraint, index) =>
      changed(constraint, retargeted.constraints[index])
        ? [constraint.constraintId]
        : [],
    ),
    ...definition.dimensions.flatMap((dimension, index) =>
      changed(dimension, retargeted.dimensions[index])
        ? [dimension.dimensionId]
        : [],
    ),
  ];
}

/**
 * T13j (D25, R-4, R-5): merge `sourcePointId` into `destinationPointId`.
 * Refusals are explicit; a valid merge deletes the source record, retargets
 * every reference, absorbs only `coincident` constraints between exactly the
 * pair, and closes an open spline positionally when its own ends merge. No
 * solve gate: conflicts are retained for the normal commit solve to report.
 */
export function createSketchMergePointsMutation(input: {
  definition: SketchDefinition;
  sourcePointId: SketchPointId;
  destinationPointId: SketchPointId;
}): SketchMergePointsResult {
  const { definition, sourcePointId: source } = input;
  const destination = input.destinationPointId;
  const refuse = (message: string) => ({ valid: false as const, message });
  if (source === destination) return refuse(MERGE_POINTS_SAME_POINT_MESSAGE);
  const refusal =
    getSketchMergePointRefusal(definition, source) ??
    getSketchMergePointRefusal(definition, destination);
  if (refusal) return refuse(refusal);

  let closedSplineEntityId: SketchEntityId | null = null;
  for (const entity of definition.entities) {
    const ends = entityPointRoles(entity)
      .filter(([, role]) => role.kind === "end")
      .map(([id]) => id);
    if (!ends.includes(source) || !ends.includes(destination)) continue;
    // A spline's own ends close it positionally (R-5); any other curve's
    // own ends would collapse or degenerate it (review R-1).
    if (entity.kind !== "spline")
      return refuse(
        `Both points are ends of ${entity.label}; merging them would collapse it.`,
      );
    // Below 4 fit points the closure is an out-and-back curve that bounds
    // nothing (review R-4.3).
    if (entity.pointOccurrences.length < 4)
      return refuse(
        `${entity.label} needs at least 4 fit points to close by merging its ends.`,
      );
    closedSplineEntityId = entity.entityId;
  }

  for (const relationship of definition.derivedRelationships ?? []) {
    const referenced = relationshipReferencedPointIds(definition, relationship);
    if (referenced.has(source) && referenced.has(destination))
      return refuse(
        `Both points are used by ${RELATIONSHIP_KIND_NAMES[relationship.kind]} ${relationship.label}; merging them would leave its copies looking joined but not joined. Delete the ${RELATIONSHIP_KIND_NAMES[relationship.kind]} first, or merge other points.`,
      );
  }
  // T15d ([TECH] T-11, after the R-4 pair refusals, T-13): a point of a
  // mirror seed (either side; outputs are refused above as driven) would
  // leave the mirror's point map stale.
  const mirrorRefusal = mirrorEditRefusal(
    definition,
    [
      { kind: "point", pointId: source },
      { kind: "point", pointId: destination },
    ],
    "merge",
  );
  if (mirrorRefusal) return refuse(mirrorRefusal);

  const absorbedConstraintIds = definition.constraints.flatMap((constraint) =>
    constraint.kind === "coincident" &&
    constraint.pointIds.includes(source) &&
    constraint.pointIds.includes(destination)
      ? [constraint.constraintId]
      : [],
  );
  const absorbed = new Set<ConstraintId>(absorbedConstraintIds);
  const retained = {
    ...definition,
    constraintIds: definition.constraintIds.filter((id) => !absorbed.has(id)),
    constraints: definition.constraints.filter(
      (constraint) => !absorbed.has(constraint.constraintId),
    ),
  };
  const retargetedRequirementIds = requirementIdsReferencing(retained, source);
  const retargeted = retargetSketchPointReferences(
    retained,
    source,
    destination,
  );
  return {
    valid: true,
    definition: {
      ...retargeted,
      pointIds: retargeted.pointIds.filter((id) => id !== source),
      points: retargeted.points.filter((point) => point.pointId !== source),
      entities: retargeted.entities.map((entity) =>
        entity.entityId === closedSplineEntityId && entity.kind === "spline"
          ? { ...entity, closure: "positional" }
          : entity,
      ),
    },
    absorbedConstraintIds,
    closedSplineEntityId,
    retargetedRequirementIds,
  };
}
