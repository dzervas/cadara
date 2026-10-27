import { getEntityPoints } from "./entity-points";
import { splineTangentStateKey } from "./parameter-projection";
import {
  EQUATION_SUPPORT_LOSS_EPSILON,
  EQUATION_SUPPORT_PERTURBATION,
} from "./solve-constants";
import type {
  SketchSolveStrategy,
  SketchSolveTolerancePolicy,
} from "./solve-types";
import { cloneValues } from "./solver-geometry";
import type {
  BuildSystemResult,
  ScalarConstraintRecord,
  SketchCompiledEquationMetadata,
  SketchCompiledSolveComponent,
  SolverPointRecord,
} from "./system-types";
import type {
  ConstraintId,
  DimensionId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  NumericDimensionDefinition as DimensionDefinition,
  LocalCollinearTargetOperand,
  SketchCurveConstraintOperand,
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
  SketchPointConstraintOperand,
  SolvedOffsetFramePlanRecord,
} from "@/contracts/sketch/schema";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";
import type {
  ProjectedSketchReferenceRecord,
  SolverPartialSolvePolicy,
} from "@/contracts/solver/schema";

export function createStableHash(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createSketchSolveCompatibilityKey(input: {
  definition: SketchDefinition;
  projectedReferences: readonly ProjectedSketchReferenceRecord[];
  tolerances: SketchSolveTolerancePolicy;
  modelingTolerance: number;
  offsetPlans: readonly SolvedOffsetFramePlanRecord[] | undefined;
  partialSolvePolicy: SolverPartialSolvePolicy;
  strategy: SketchSolveStrategy;
}) {
  const structuralDefinition = {
    schemaVersion: input.definition.schemaVersion,
    referenceIds: input.definition.referenceIds,
    references: input.definition.references,
    pointIds: input.definition.pointIds,
    entityIds: input.definition.entityIds,
    entities: input.definition.entities,
    constraintIds: input.definition.constraintIds,
    constraints: input.definition.constraints,
    dimensionIds: input.definition.dimensionIds,
    dimensions: input.definition.dimensions,
    derivedRelationships: input.definition.derivedRelationships,
  };
  return JSON.stringify({
    definition: structuralDefinition,
    projectedReferences: input.projectedReferences.map((reference) => ({
      referenceId: reference.referenceId,
      status: reference.status,
      geometry: reference.geometry,
    })),
    tolerances: input.tolerances,
    modelingTolerance: input.modelingTolerance,
    offsetPlans: input.offsetPlans ?? null,
    partialSolvePolicy: input.partialSolvePolicy,
    strategy: input.strategy,
  });
}

export class VariableUnionFind {
  private readonly parents: number[];

  constructor(size: number) {
    this.parents = Array.from({ length: size }, (_, index) => index);
  }

  find(index: number): number {
    const parent = this.parents[index]!;
    if (parent === index) {
      return index;
    }
    const root = this.find(parent);
    this.parents[index] = root;
    return root;
  }

  union(left: number, right: number) {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot !== rightRoot) {
      this.parents[rightRoot] = leftRoot;
    }
  }
}

export function nonZeroGradientIndices(gradient: Float64Array) {
  const indices: number[] = [];
  for (let index = 0; index < gradient.length; index += 1) {
    if (Math.abs(gradient[index]!) > 1e-12) {
      indices.push(index);
    }
  }
  return indices;
}

export function uniqueSortedIndices(indices: Iterable<number>) {
  return Array.from(new Set(indices)).sort((left, right) => left - right);
}

export function pointVariableIndices(point: SolverPointRecord | null | undefined) {
  return point ? [point.baseIndex, point.baseIndex + 1] : [];
}

export function entityVariableIndices(
  entity: SketchEntityDefinition | null | undefined,
  system: BuildSystemResult,
) {
  if (!entity) {
    return [];
  }

  if (entity.kind === "derivedPiecewiseCubic")
    return [...(system.shellSourceVariables.get(entity.entityId) ?? [])];
  const pointIndices = getEntityPoints(entity).flatMap((pointId) =>
    pointVariableIndices(system.pointRecords.get(pointId)),
  );
  const entityState = system.entityStates.get(entity.entityId);
  const stateIndices =
    entityState && entityState.kind !== "point"
      ? entityState.kind === "circle"
        ? [entityState.baseIndex]
        : [
            entityState.baseIndex,
            entityState.baseIndex + 1,
            entityState.baseIndex + 2,
          ]
      : [];
  const tangentIndices =
    entity.kind === "spline"
      ? (orderedSplineOccurrences(entity) ?? []).flatMap((occurrence) => {
          const state = system.splineTangentStates.get(
            splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
          );
          return state ? [state.baseIndex, state.baseIndex + 1] : [];
        })
      : [];

  return uniqueSortedIndices([
    ...pointIndices,
    ...stateIndices,
    ...tangentIndices,
  ]);
}

export function curveOperandVariableIndices(
  operand: SketchCurveConstraintOperand,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  return operand.kind === "localEntity"
    ? entityVariableIndices(entityById.get(operand.entityId), system)
    : [];
}

export function pointOperandVariableIndices(
  operand: SketchPointConstraintOperand,
  system: BuildSystemResult,
) {
  return operand.kind === "localPoint"
    ? pointVariableIndices(system.pointRecords.get(operand.pointId))
    : [];
}

export function collinearTargetVariableIndices(
  operand: LocalCollinearTargetOperand,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  return operand.kind === "localPoint"
    ? pointVariableIndices(system.pointRecords.get(operand.pointId))
    : entityVariableIndices(entityById.get(operand.entityId), system);
}

export function structuralConstraintVariableIndices(
  constraint: ConstraintDefinition,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  switch (constraint.kind) {
    case "coincident":
    case "angle":
      return uniqueSortedIndices(
        constraint.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
      );
    case "horizontal":
    case "vertical":
      return entityVariableIndices(entityById.get(constraint.entityId), system);
    case "fixPoint":
      return pointVariableIndices(system.pointRecords.get(constraint.pointId));
    case "equalOffset":
      return uniqueSortedIndices(
        constraint.pairs.flatMap((pair) => [
          ...entityVariableIndices(entityById.get(pair.seedEntityId), system),
          ...entityVariableIndices(entityById.get(pair.offsetEntityId), system),
        ]),
      );
    case "parallel":
    case "perpendicular":
    case "equalLength":
    case "tangent":
    case "concentric":
      return uniqueSortedIndices(
        constraint.entityIds.flatMap((entityId) =>
          entityVariableIndices(entityById.get(entityId), system),
        ),
      );
    case "coincidentProjectedPoint":
    case "pointOnProjectedCurve":
    case "midpointProjectedLine":
      return pointVariableIndices(
        system.pointRecords.get(constraint.point.pointId),
      );
    case "midpoint":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
      ]);
    case "pointOnCurve":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.curve.entityId),
          system,
        ),
      ]);
    case "collinear":
      return uniqueSortedIndices([
        ...collinearTargetVariableIndices(
          constraint.target,
          entityById,
          system,
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
      ]);
    case "collinearProjectedLine":
      return collinearTargetVariableIndices(
        constraint.target,
        entityById,
        system,
      );
    case "parallelProjectedLine":
    case "perpendicularProjectedLine":
      return entityVariableIndices(
        entityById.get(constraint.line.entityId),
        system,
      );
    case "tangentProjectedCurve":
    case "concentricProjectedCurve":
      return entityVariableIndices(
        entityById.get(constraint.curve.entityId),
        system,
      );
    case "normal":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
        ...entityVariableIndices(
          entityById.get(constraint.curve.entityId),
          system,
        ),
      ]);
    case "normalProjectedCurve":
      return uniqueSortedIndices([
        ...pointVariableIndices(
          system.pointRecords.get(constraint.point.pointId),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.line.entityId),
          system,
        ),
      ]);
    case "symmetric":
      return uniqueSortedIndices([
        ...constraint.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
        ...entityVariableIndices(
          entityById.get(constraint.axis.entityId),
          system,
        ),
      ]);
    case "symmetricProjectedLine":
      return uniqueSortedIndices(
        constraint.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
      );
  }
}

export function structuralDimensionVariableIndices(
  dimension: DimensionDefinition,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  system: BuildSystemResult,
) {
  switch (dimension.kind) {
    case "distance":
    case "horizontalDistance":
    case "verticalDistance":
      return uniqueSortedIndices(
        dimension.pointIds.flatMap((pointId) =>
          pointVariableIndices(system.pointRecords.get(pointId)),
        ),
      );
    case "pointDatumDistance":
      return pointVariableIndices(
        system.pointRecords.get(dimension.point.pointId),
      );
    case "circleRadius":
    case "diameter":
    case "lineLength":
      return entityVariableIndices(entityById.get(dimension.entityId), system);
    case "lineDistance":
    case "lineAngle":
      return uniqueSortedIndices(
        dimension.lines.flatMap((operand) =>
          curveOperandVariableIndices(operand, entityById, system),
        ),
      );
    case "linePointDistance":
      return uniqueSortedIndices([
        ...curveOperandVariableIndices(dimension.line, entityById, system),
        ...pointOperandVariableIndices(dimension.point, system),
      ]);
    case "arcStartPointCoincident":
    case "arcEndPointCoincident":
      return uniqueSortedIndices([
        ...entityVariableIndices(entityById.get(dimension.entityId), system),
        ...pointVariableIndices(system.pointRecords.get(dimension.pointId)),
      ]);
  }
}

export function structuralEquationVariableIndexMap(
  system: BuildSystemResult,
  definition: SketchDefinition,
) {
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const variablesById = new Map<ConstraintId | DimensionId, number[]>();

  for (const constraint of definition.constraints) {
    variablesById.set(
      constraint.constraintId,
      structuralConstraintVariableIndices(constraint, entityById, system),
    );
  }

  for (const dimension of definition.dimensions) {
    variablesById.set(
      dimension.dimensionId,
      structuralDimensionVariableIndices(dimension, entityById, system),
    );
  }

  return variablesById;
}

export function perturbedEquationVariableIndices(
  constraint: ScalarConstraintRecord,
  values: Float64Array,
) {
  const base = constraint.evaluate(values);
  const indices = new Set(nonZeroGradientIndices(base.gradient));

  for (let index = 0; index < values.length; index += 1) {
    const step = Math.max(
      EQUATION_SUPPORT_PERTURBATION,
      Math.abs(values[index]!) * 1e-6,
    );
    const plus = cloneValues(values);
    const minus = cloneValues(values);
    plus[index] += step;
    minus[index] -= step;

    const plusLoss = constraint.evaluate(plus).residual;
    const minusLoss = constraint.evaluate(minus).residual;
    if (
      Number.isFinite(plusLoss) &&
      Number.isFinite(minusLoss) &&
      Math.max(
        Math.abs(plusLoss - base.residual),
        Math.abs(minusLoss - base.residual),
      ) > EQUATION_SUPPORT_LOSS_EPSILON
    ) {
      indices.add(index);
    }
  }

  return uniqueSortedIndices(indices);
}

export function buildCompiledComponentData(
  system: BuildSystemResult,
  definition: SketchDefinition,
): {
  components: SketchCompiledSolveComponent[];
  equationMetadata: SketchCompiledEquationMetadata[];
} {
  const unionFind = new VariableUnionFind(system.parameterCount);
  const structuralVariables = structuralEquationVariableIndexMap(
    system,
    definition,
  );
  const equationVariables = system.scalarConstraints.map((constraint) => {
    const variables =
      structuralVariables.get(constraint.id) ??
      constraint.structuralVariableIndices;
    return system.parameterProjection.projectVariableIndices(
      variables && variables.length > 0
        ? variables
        : perturbedEquationVariableIndices(constraint, system.initialValues),
    );
  });

  for (const point of system.pointRecords.values()) {
    const variables = system.parameterProjection.projectVariableIndices([
      point.baseIndex,
      point.baseIndex + 1,
    ]);
    const [first, ...rest] = variables;
    if (first !== undefined) {
      for (const next of rest) unionFind.union(first, next);
    }
  }

  for (const entity of definition.entities) {
    const variables = system.parameterProjection.projectVariableIndices(
      entityVariableIndices(entity, system),
    );
    const [first, ...rest] = variables;
    if (first === undefined) {
      continue;
    }
    for (const next of rest) {
      unionFind.union(first, next);
    }
  }

  for (const variables of equationVariables) {
    const [first, ...rest] = variables;
    if (first === undefined) {
      continue;
    }
    for (const next of rest) {
      unionFind.union(first, next);
    }
  }

  const variablesByRoot = new Map<number, number[]>();
  for (const index of system.parameterProjection.authorityVariableIndices) {
    const root = unionFind.find(index);
    const variables = variablesByRoot.get(root) ?? [];
    variables.push(index);
    variablesByRoot.set(root, variables);
  }

  const rootToComponentId = new Map<number, number>();
  const componentEntries = Array.from(variablesByRoot.entries()).map(
    ([root, variableIndices], componentId) => {
      rootToComponentId.set(root, componentId);
      return { root, componentId, variableIndices };
    },
  );
  const equationIndicesByComponent = new Map<number, number[]>();
  const equationMetadata: SketchCompiledEquationMetadata[] = [];

  equationVariables.forEach((variableIndices, equationIndex) => {
    const constraint = system.scalarConstraints[equationIndex]!;
    const componentId =
      variableIndices[0] === undefined
        ? 0
        : (rootToComponentId.get(unionFind.find(variableIndices[0])) ?? 0);
    const equationIndices = equationIndicesByComponent.get(componentId) ?? [];
    equationIndices.push(equationIndex);
    equationIndicesByComponent.set(componentId, equationIndices);
    equationMetadata.push({
      equationIndex,
      id: constraint.id,
      targetKind: constraint.targetKind,
      variableIndices,
      componentId,
    });
  });

  const pointIdsByComponent = new Map<number, SketchPointId[]>();
  for (const point of system.pointRecords.values()) {
    const authority = system.parameterProjection.projectVariableIndices([
      point.baseIndex,
      point.baseIndex + 1,
    ]);
    const first = authority[0];
    if (first === undefined) continue;
    const componentId = rootToComponentId.get(unionFind.find(first));
    if (componentId === undefined) continue;
    const pointIds = pointIdsByComponent.get(componentId) ?? [];
    pointIds.push(point.pointId);
    pointIdsByComponent.set(componentId, pointIds);
  }

  const entityIdsByComponent = new Map<number, SketchEntityId[]>();
  for (const entity of definition.entities) {
    const authority = system.parameterProjection.projectVariableIndices(
      entityVariableIndices(entity, system),
    );
    const first = authority[0];
    if (first === undefined) continue;
    const componentId = rootToComponentId.get(unionFind.find(first));
    if (componentId === undefined) continue;
    const entityIds = entityIdsByComponent.get(componentId) ?? [];
    entityIds.push(entity.entityId);
    entityIdsByComponent.set(componentId, entityIds);
  }

  const components = componentEntries.map(
    ({ componentId, variableIndices }) => ({
      componentId,
      variableIndices,
      equationIndices: equationIndicesByComponent.get(componentId) ?? [],
      pointIds: pointIdsByComponent.get(componentId) ?? [],
      entityIds: entityIdsByComponent.get(componentId) ?? [],
    }),
  );

  return { components, equationMetadata };
}
