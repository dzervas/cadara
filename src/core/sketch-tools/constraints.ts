import type {
  ConstraintDefinition,
  DimensionDefinition,
} from "@/contracts/sketch/schema";
import type {
  ConstraintId,
  DimensionId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";

export function localPointOperand(
  pointId: SketchPointId,
): Extract<ConstraintDefinition, { kind: "midpoint" }>["point"] {
  return { kind: "localPoint", pointId };
}

export function localEntityOperand(
  entityId: SketchEntityId,
): Extract<ConstraintDefinition, { kind: "midpoint" }>["line"] {
  return { kind: "localEntity", entityId };
}

export function createMidpointConstraint(input: {
  constraintId: ConstraintId;
  label: string;
  pointId: SketchPointId;
  lineEntityId: SketchEntityId;
}): ConstraintDefinition {
  return {
    constraintId: input.constraintId,
    kind: "midpoint",
    label: input.label,
    point: localPointOperand(input.pointId),
    line: localEntityOperand(input.lineEntityId),
  };
}

export function createPointOnCurveConstraint(input: {
  constraintId: ConstraintId;
  label: string;
  pointId: SketchPointId;
  curveEntityId: SketchEntityId;
}): ConstraintDefinition {
  return {
    constraintId: input.constraintId,
    kind: "pointOnCurve",
    label: input.label,
    point: localPointOperand(input.pointId),
    curve: localEntityOperand(input.curveEntityId),
  };
}

export function createParallelConstraint(input: {
  constraintId: ConstraintId;
  label: string;
  entityIds: readonly [SketchEntityId, SketchEntityId];
}): ConstraintDefinition {
  return {
    constraintId: input.constraintId,
    kind: "parallel",
    label: input.label,
    entityIds: input.entityIds,
  };
}

export function createPerpendicularConstraint(input: {
  constraintId: ConstraintId;
  label: string;
  entityIds: readonly [SketchEntityId, SketchEntityId];
}): ConstraintDefinition {
  return {
    constraintId: input.constraintId,
    kind: "perpendicular",
    label: input.label,
    entityIds: input.entityIds,
  };
}

export function createEqualLengthConstraint(input: {
  constraintId: ConstraintId;
  label: string;
  entityIds: readonly [SketchEntityId, SketchEntityId];
}): ConstraintDefinition {
  return {
    constraintId: input.constraintId,
    kind: "equalLength",
    label: input.label,
    entityIds: input.entityIds,
  };
}

export function createTangentConstraint(input: {
  constraintId: ConstraintId;
  label: string;
  entityIds: readonly [SketchEntityId, SketchEntityId];
}): ConstraintDefinition {
  return {
    constraintId: input.constraintId,
    kind: "tangent",
    label: input.label,
    entityIds: input.entityIds,
    relation: "external",
  };
}

export function createDistanceDimension(input: {
  dimensionId: DimensionId;
  label: string;
  axis: "aligned" | "horizontal" | "vertical";
  pointIds: readonly [SketchPointId, SketchPointId];
  value: number;
}): DimensionDefinition {
  return {
    dimensionId: input.dimensionId,
    kind: "distance",
    label: input.label,
    axis: input.axis,
    pointIds: input.pointIds,
    value: input.value,
  };
}

export function createCircleRadiusDimension(input: {
  dimensionId: DimensionId;
  label: string;
  entityId: SketchEntityId;
  value: number;
}): DimensionDefinition {
  return {
    dimensionId: input.dimensionId,
    kind: "circleRadius",
    label: input.label,
    entityId: input.entityId,
    value: input.value,
  };
}

export function createArcEndpointDimensions(input: {
  createDimensionId: (suffix: string) => DimensionId;
  labelPrefix: string;
  entityId: SketchEntityId;
  startPointId: SketchPointId;
  endPointId: SketchPointId;
}): DimensionDefinition[] {
  return [
    {
      dimensionId: input.createDimensionId("arc-start"),
      kind: "arcStartPointCoincident",
      label: `${input.labelPrefix} start`,
      entityId: input.entityId,
      pointId: input.startPointId,
    },
    {
      dimensionId: input.createDimensionId("arc-end"),
      kind: "arcEndPointCoincident",
      label: `${input.labelPrefix} end`,
      entityId: input.entityId,
      pointId: input.endPointId,
    },
  ];
}
