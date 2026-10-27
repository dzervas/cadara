import type { ComponentJacobian } from "./automatic-differentiation";
import { uniqueSortedIndices } from "./compile-components";
import { getEntityPoints } from "./entity-points";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import {
  cloneValues,
  getCircleRadius,
  getPoint,
  subtract,
  zeroVector,
} from "./solver-geometry";
import type {
  OffsetRequirementBlocker,
  ScalarConstraintEvaluation,
  SolverEntityState,
  SolverParameterProjection,
  SolverPointRecord,
  SplineTangentState,
} from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  evaluateSketchDerivations,
  pointDefinedArcVariables,
  prepareSketchDerivationPullback,
} from "@/contracts/sketch/derived-geometry";
import type {
  SketchDerivationEvaluationResult,
  SketchDerivationVariation,
  SketchDerivedEntityVariation,
} from "@/contracts/sketch/derived-geometry";
import type {
  NumericSketchDerivationDefinition,
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
  SolvedOffsetFramePlanRecord,
} from "@/contracts/sketch/schema";
import { orderedSplineOccurrences } from "@/contracts/sketch/spline-geometry";

export function splineTangentStateKey(entityId: SketchEntityId, occurrenceId: string) {
  return `${entityId}\u0000${occurrenceId}`;
}

export function midpoint(start: SketchPoint2D, end: SketchPoint2D): SketchPoint2D {
  return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
}

export function createDerivedParameterProjection(input: {
  definition: SketchDefinition;
  parameterCount: number;
  pointRecords: Map<SketchPointId, SolverPointRecord>;
  entityStates: Map<SketchEntityId, SolverEntityState>;
  splineTangentStates: Map<string, SplineTangentState>;
  modelingTolerance: number;
  offsetPlans: readonly SolvedOffsetFramePlanRecord[] | undefined;
}): SolverParameterProjection {
  const {
    definition,
    parameterCount,
    pointRecords,
    entityStates,
    splineTangentStates,
    modelingTolerance,
    offsetPlans,
  } = input;
  if ((definition.derivedRelationships?.length ?? 0) === 0) {
    return {
      projectValues: cloneValues,
      projectionDiagnostics: () => [],
      derivationEvaluation: () => null,
      projectVariableIndices: (variableIndices) =>
        uniqueSortedIndices(variableIndices),
      authorityVariableIndices: Array.from(
        { length: parameterCount },
        (_, index) => index,
      ),
      wrapConstraint: (constraint) => constraint,
      wrapComponentJacobian: (evaluate) => evaluate,
      relationshipFailuresAt: () => new Set(),
      withBlockedRelationships: (_blocked, run) => run(),
      failedAtSolveStart: () => false,
    };
  }

  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const dependenciesByDrivenIndex = new Map<number, Set<number>>();
  const pointDefinedArcEntityIds = new Set<SketchEntityId>();
  const pointIndices = (pointId: SketchPointId) => {
    const point = pointRecords.get(pointId);
    return point ? [point.baseIndex, point.baseIndex + 1] : [];
  };
  const entityIndices = (entityId: SketchEntityId) => {
    const state = entityStates.get(entityId);
    if (!state || state.kind === "point") return [];
    return state.kind === "circle"
      ? [state.baseIndex]
      : [state.baseIndex, state.baseIndex + 1, state.baseIndex + 2];
  };
  const derivedEntitySeedIndices = (entityId: SketchEntityId) =>
    entityById.get(entityId)?.kind === "circle" ? entityIndices(entityId) : [];
  const splineTangentIndices = (entity: SketchEntityDefinition) =>
    entity.kind === "spline"
      ? (orderedSplineOccurrences(entity) ?? []).flatMap((occurrence) => {
          const state = splineTangentStates.get(
            splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
          );
          return state ? [state.baseIndex, state.baseIndex + 1] : [];
        })
      : [];
  const mirrorAxisIndices = (
    relationship: NumericSketchDerivationDefinition,
  ) => {
    // A sketch datum axis is fixed: it has no variables (T15b, T-7).
    if (
      relationship.kind !== "mirror" ||
      relationship.mirrorReference.kind !== "lineEntity"
    )
      return [];
    const axis = entityById.get(relationship.mirrorReference.entityId);
    return axis ? getEntityPoints(axis).flatMap(pointIndices) : [];
  };
  const setDrivenDependencies = (
    drivenIndices: readonly number[],
    dependencyIndices: readonly number[],
  ) => {
    for (const drivenIndex of drivenIndices) {
      dependenciesByDrivenIndex.set(drivenIndex, new Set(dependencyIndices));
    }
  };

  // [TECH] G16′: the driven indices of each offset relationship's outputs;
  // T15b (T-16): and of every other relationship's (a failed mirror or an
  // unresolved relationship holds them).
  const relationshipDrivenIndices = new Map<string, Set<number>>();
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "offset") {
      relationshipDrivenIndices.set(
        relationship.derivationId,
        new Set(
          relationship.outputs.flatMap((output) => {
            const target = entityById.get(output.outputEntityId);
            return [
              ...output.outputPointIds.flatMap(pointIndices),
              ...entityIndices(output.outputEntityId),
              ...(target ? splineTangentIndices(target) : []),
            ];
          }),
        ),
      );
      continue;
    }
    relationshipDrivenIndices.set(
      relationship.derivationId,
      new Set([
        ...relationship.outputs.flatMap((output) => [
          ...output.outputPointIds.flatMap(pointIndices),
          ...entityIndices(output.outputEntityId),
        ]),
        ...relationship.piecewiseCubicOutputs.flatMap((output) => [
          ...pointIndices(output.startPointId),
          ...pointIndices(output.endPointId),
        ]),
        ...relationship.jointOutputs.flatMap((output) => [
          ...pointIndices(output.centerPointId),
          ...pointIndices(output.startPointId),
          ...pointIndices(output.endPointId),
          ...entityIndices(output.outputEntityId),
        ]),
      ]),
    );
  }
  for (const relationship of definition.derivedRelationships ?? []) {
    const axisIndices = mirrorAxisIndices(relationship);
    const offsetSeedIndices =
      relationship.kind === "offset"
        ? relationship.seedEntityIds.flatMap((entityId) => {
            const entity = entityById.get(entityId);
            if (entity?.kind === "arc") {
              pointDefinedArcEntityIds.add(entity.entityId);
              setDrivenDependencies(
                entityIndices(entity.entityId),
                getEntityPoints(entity).flatMap(pointIndices),
              );
            }
            return entity
              ? [
                  ...getEntityPoints(entity).flatMap(pointIndices),
                  ...derivedEntitySeedIndices(entityId),
                  // T08b-g5: the frame JVP moves offsets with the seed's
                  // authored tangents too (the legacy omission).
                  ...splineTangentIndices(entity),
                ]
              : [];
          })
        : [];
    for (const output of relationship.outputs) {
      const seed = entityById.get(output.seedEntityId);
      const target = entityById.get(output.outputEntityId);
      // T17o (C2, [TECH] T17-12′, documented only): the empty-map fallback
      // to the seed's defining points registers driven-dependency edges
      // (the authority graph) and accepts nothing. Pattern and transform
      // outputs need it. A mirror also reaches it, but a mirror with an
      // empty seed map fails `derived-mirror-map-stale` first (evaluation,
      // `checkMirrorOutputMap`), so its outputs are held and never
      // consumed through these edges (T15 close-out audit §2).
      const seedPointIds =
        output.seedPointIds.length > 0
          ? output.seedPointIds
          : seed
            ? getEntityPoints(seed)
            : [];
      output.outputPointIds.forEach((outputPointId, index) => {
        setDrivenDependencies(
          pointIndices(outputPointId),
          relationship.kind === "offset"
            ? offsetSeedIndices
            : [...pointIndices(seedPointIds[index]!), ...axisIndices],
        );
      });
      setDrivenDependencies(
        entityIndices(output.outputEntityId),
        relationship.kind === "offset"
          ? offsetSeedIndices
          : [
              // R-4: a mirror output arc's slots follow the seed arc's.
              ...(relationship.kind === "mirror"
                ? entityIndices(output.seedEntityId)
                : derivedEntitySeedIndices(output.seedEntityId)),
              ...seedPointIds.flatMap(pointIndices),
              ...axisIndices,
            ],
      );

      if (seed?.kind !== "spline" || target?.kind !== "spline") continue;
      const seedOccurrences = orderedSplineOccurrences(seed) ?? [];
      const outputOccurrences = orderedSplineOccurrences(target) ?? [];
      outputOccurrences.forEach((occurrence, index) => {
        const outputState = splineTangentStates.get(
          splineTangentStateKey(target.entityId, occurrence.occurrenceId),
        );
        const seedOccurrence = seedOccurrences[index];
        const seedState = seedOccurrence
          ? splineTangentStates.get(
              splineTangentStateKey(seed.entityId, seedOccurrence.occurrenceId),
            )
          : undefined;
        if (!outputState) return;
        setDrivenDependencies(
          [outputState.baseIndex, outputState.baseIndex + 1],
          !seedState
            ? []
            : [seedState.baseIndex, seedState.baseIndex + 1, ...axisIndices],
        );
      });
    }
    if (relationship.kind === "offset") {
      // A derived shell allocates no variables: only its driven terminal
      // points are solver state (D2).
      relationship.piecewiseCubicOutputs.forEach((output) =>
        setDrivenDependencies(
          [
            ...pointIndices(output.startPointId),
            ...pointIndices(output.endPointId),
          ],
          offsetSeedIndices,
        ),
      );
      relationship.jointOutputs.forEach((output) =>
        setDrivenDependencies(
          [
            ...pointIndices(output.centerPointId),
            ...pointIndices(output.startPointId),
            ...pointIndices(output.endPointId),
            ...entityIndices(output.outputEntityId),
          ],
          offsetSeedIndices,
        ),
      );
    }
  }

  const resolveAuthority = (
    variableIndex: number,
    visiting = new Set<number>(),
  ): number[] => {
    const dependencies = dependenciesByDrivenIndex.get(variableIndex);
    if (!dependencies) return [variableIndex];
    if (visiting.has(variableIndex)) return [];
    const nextVisiting = new Set(visiting).add(variableIndex);
    return uniqueSortedIndices(
      [...dependencies].flatMap((dependency) =>
        resolveAuthority(dependency, nextVisiting),
      ),
    );
  };
  /**
   * [TECH] G16′: the relationships (in definition order) whose outputs a
   * requirement on `variableIndices` names, directly or through a derived
   * output that depends on them (a mirror of an offset output). Only those
   * failing ever block it (offsets since G16′, mirrors since T15b).
   */
  const relationshipsNamedBy = (variableIndices: readonly number[]) => {
    const reached = new Set<number>();
    const pending = [...variableIndices];
    while (pending.length > 0) {
      const index = pending.pop()!;
      const dependencies = dependenciesByDrivenIndex.get(index);
      if (!dependencies || reached.has(index)) continue;
      reached.add(index);
      pending.push(...dependencies);
    }
    return [...relationshipDrivenIndices].flatMap(([derivationId, indices]) =>
      [...indices].some((index) => reached.has(index)) ? [derivationId] : [],
    );
  };
  const projectVariableIndices = (variableIndices: readonly number[]) =>
    uniqueSortedIndices(
      variableIndices.flatMap((index) => resolveAuthority(index)),
    );
  const authorityVariableIndices = Array.from(
    { length: parameterCount },
    (_, index) => index,
  ).filter((index) => !dependenciesByDrivenIndex.has(index));

  const pointDefinitionIndexById = new Map(
    definition.points.map((point, index) => [point.pointId, index]),
  );
  const drivenPointRecords = [...pointRecords.values()].flatMap((record) => {
    if (
      !dependenciesByDrivenIndex.has(record.baseIndex) &&
      !dependenciesByDrivenIndex.has(record.baseIndex + 1)
    ) {
      return [];
    }
    const definitionIndex = pointDefinitionIndexById.get(record.pointId);
    return definitionIndex === undefined ? [] : [{ record, definitionIndex }];
  });
  const entityDefinitionIndexById = new Map(
    definition.entities.map((entity, index) => [entity.entityId, index]),
  );
  const drivenEntityStates = [...entityStates.values()].flatMap((state) => {
    if (state.kind === "point") return [];
    const indices = entityIndices(state.entityId);
    if (!indices.some((index) => dependenciesByDrivenIndex.has(index))) {
      return [];
    }
    const entityIndex = entityDefinitionIndexById.get(state.entityId);
    return entityIndex === undefined ? [] : [{ state, entityIndex }];
  });
  const drivenTangentStates = [...splineTangentStates.values()].flatMap(
    (state) => {
      if (
        !dependenciesByDrivenIndex.has(state.baseIndex) &&
        !dependenciesByDrivenIndex.has(state.baseIndex + 1)
      ) {
        return [];
      }
      const entityIndex = entityDefinitionIndexById.get(state.entityId);
      const entity =
        entityIndex === undefined
          ? undefined
          : definition.entities[entityIndex];
      if (entity?.kind !== "spline") return [];
      const occurrenceIndex = entity.pointOccurrences.findIndex(
        (occurrence) => occurrence.occurrenceId === state.occurrenceId,
      );
      return occurrenceIndex < 0
        ? []
        : [{ state, entityIndex: entityIndex!, occurrenceIndex }];
    },
  );

  let cachedInput: Float64Array | null = null;
  let cachedValues: Float64Array | null = null;
  let cachedPullback: ReturnType<
    typeof prepareSketchDerivationPullback
  > | null = null;
  let cachedDiagnostics: readonly SketchSolveDiagnostic[] = [];
  let cachedEvaluation: SketchDerivationEvaluationResult | null = null;
  // [TECH] G16‴: the current solve's blocked set (see `withBlockedRelationships`).
  let startFailedOffsets: ReadonlySet<string> = new Set();
  // R-4: the arcs whose solver slots are authority (a mirror output arc
  // reflects its seed's slots; a driven point-defined arc has none).
  const authorityArcStates = [...entityStates.values()].flatMap((state) =>
    state.kind === "arc" &&
    !entityIndices(state.entityId).some((index) =>
      dependenciesByDrivenIndex.has(index),
    )
      ? [state]
      : [],
  );
  const project = (
    values: Float64Array,
    validationIndices?: readonly number[],
  ) => {
    if (
      cachedInput &&
      cachedValues &&
      cachedPullback &&
      (validationIndices
        ? validationIndices.every(
            (index) => cachedInput![index] === values[index],
          )
        : cachedInput.every((value, index) => value === values[index]))
    ) {
      return {
        values: cachedValues,
        pullback: cachedPullback,
        diagnostics: cachedDiagnostics,
        evaluation: cachedEvaluation!,
      };
    }

    const solverDefinition: SketchDefinition = {
      ...definition,
      points: definition.points.map((point) => {
        const record = pointRecords.get(point.pointId);
        return record
          ? { ...point, position: getPoint(values, record) }
          : point;
      }),
      entities: definition.entities.map((entity) => {
        const state = entityStates.get(entity.entityId);
        if (entity.kind === "circle" && state?.kind === "circle") {
          return { ...entity, radius: getCircleRadius(values, state) };
        }
        if (entity.kind !== "spline") return entity;
        return {
          ...entity,
          pointOccurrences: entity.pointOccurrences.map((occurrence) => {
            if (occurrence.tangent.kind !== "authored") return occurrence;
            const tangentState = splineTangentStates.get(
              splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
            );
            return tangentState
              ? {
                  ...occurrence,
                  tangent: {
                    kind: "authored" as const,
                    vector: [
                      values[tangentState.baseIndex]!,
                      values[tangentState.baseIndex + 1]!,
                    ] as const,
                  },
                }
              : occurrence;
          }),
        };
      }),
    };
    const derivationEvaluation = evaluateSketchDerivations({
      definition: solverDefinition,
      modelingTolerance,
      offsetPlans,
      withDerivatives: true,
      arcVariables: new Map(
        authorityArcStates.map((state) => [
          state.entityId,
          {
            radius: values[state.baseIndex]!,
            startAngle: values[state.baseIndex + 1]!,
            endAngle: values[state.baseIndex + 2]!,
          },
        ]),
      ),
    });
    const evaluated = derivationEvaluation.definition;
    const projected = cloneValues(values);
    for (const { record, definitionIndex } of drivenPointRecords) {
      const point = evaluated.points[definitionIndex]!;
      projected[record.baseIndex] = point.position[0];
      projected[record.baseIndex + 1] = point.position[1];
    }
    for (const { state, entityIndex } of drivenEntityStates) {
      const entity = evaluated.entities[entityIndex];
      if (state.kind === "circle" && entity?.kind === "circle") {
        projected[state.baseIndex] = entity.radius;
      } else if (state.kind === "arc" && entity?.kind === "arc") {
        // R-4: a mirror output arc reflects its seed arc's variables.
        const mirrored = derivationEvaluation.mirrorArcVariables.get(
          entity.entityId,
        );
        const center = evaluated.points.find(
          (point) => point.pointId === entity.centerPointId,
        )?.position;
        const start = evaluated.points.find(
          (point) => point.pointId === entity.startPointId,
        )?.position;
        const end = evaluated.points.find(
          (point) => point.pointId === entity.endPointId,
        )?.position;
        // R-g3: otherwise the one point-defined arc support formula.
        const arc =
          mirrored ??
          (center && start && end
            ? pointDefinedArcVariables(
                center,
                start,
                end,
                entity.sweepDirection,
              )
            : null);
        if (arc) {
          projected[state.baseIndex] = arc.radius;
          projected[state.baseIndex + 1] = arc.startAngle;
          projected[state.baseIndex + 2] = arc.endAngle;
        }
      }
    }
    for (const { state, entityIndex, occurrenceIndex } of drivenTangentStates) {
      const entity = evaluated.entities[entityIndex];
      if (entity?.kind !== "spline") continue;
      const occurrence = entity.pointOccurrences[occurrenceIndex];
      if (occurrence?.tangent.kind !== "authored") continue;
      projected[state.baseIndex] = occurrence.tangent.vector[0];
      projected[state.baseIndex + 1] = occurrence.tangent.vector[1];
    }

    const pullback = prepareSketchDerivationPullback(derivationEvaluation);
    cachedInput = cloneValues(values);
    cachedValues = projected;
    cachedPullback = pullback;
    cachedDiagnostics = derivationEvaluation.diagnostics;
    cachedEvaluation = derivationEvaluation;
    return {
      values: projected,
      pullback,
      diagnostics: cachedDiagnostics,
      evaluation: derivationEvaluation,
    };
  };

  /**
   * The driven states a row on `variableIndices` reads (every driven state
   * without them); null when it reads none, so its row needs no projection.
   */
  const drivenScope = (variableIndices: readonly number[] | undefined) => {
    const support = variableIndices ? new Set(variableIndices) : null;
    const projectedSupport = variableIndices
      ? projectVariableIndices(variableIndices)
      : [];
    const points = support
      ? drivenPointRecords.filter(
          ({ record }) =>
            support.has(record.baseIndex) || support.has(record.baseIndex + 1),
        )
      : drivenPointRecords;
    const entities = support
      ? drivenEntityStates.filter(({ state }) =>
          entityIndices(state.entityId).some((index) => support.has(index)),
        )
      : drivenEntityStates;
    const tangents = support
      ? drivenTangentStates.filter(
          ({ state }) =>
            support.has(state.baseIndex) || support.has(state.baseIndex + 1),
        )
      : drivenTangentStates;
    if (points.length === 0 && entities.length === 0 && tangents.length === 0)
      return null;
    return {
      projectionValidationIndices:
        projectedSupport.length > 0 ? projectedSupport : undefined,
      points,
      entities,
      tangents,
    };
  };
  /**
   * The pullback of one row gradient (or Jacobian row) at a projected
   * iterate onto the authority variables; null when it has no driven
   * cotangent (the gradient is already on authority variables).
   */
  const pullBackGradient = (
    scope: NonNullable<ReturnType<typeof drivenScope>>,
    projected: ReturnType<typeof project>,
    inputGradient: Float64Array,
  ): {
    gradient: Float64Array;
    derivativeUnavailable?: readonly string[];
  } | null => {
    const pointCotangent: Partial<Record<SketchPointId, SketchPoint2D>> = {};
    const entityCotangent: Partial<
      Record<SketchEntityId, SketchDerivedEntityVariation>
    > = {};
    const tangentCotangent: Partial<
      Record<SketchEntityId, Record<string, SketchPoint2D>>
    > = {};
    let hasDrivenCotangent = false;
    const addPointCotangent = (
      pointId: SketchPointId,
      value: SketchPoint2D,
    ) => {
      const current = pointCotangent[pointId] ?? [0, 0];
      pointCotangent[pointId] = [current[0] + value[0], current[1] + value[1]];
    };
    for (const { record } of scope.points) {
      const x = inputGradient[record.baseIndex]!;
      const y = inputGradient[record.baseIndex + 1]!;
      if (x === 0 && y === 0) continue;
      addPointCotangent(record.pointId, [x, y]);
      hasDrivenCotangent = true;
    }
    for (const { state } of scope.entities) {
      if (state.kind === "circle") {
        const radius = inputGradient[state.baseIndex]!;
        if (radius !== 0) {
          entityCotangent[state.entityId] = { kind: "circle", radius };
          hasDrivenCotangent = true;
        }
        continue;
      }

      const radius = inputGradient[state.baseIndex]!;
      const startAngle = inputGradient[state.baseIndex + 1]!;
      const endAngle = inputGradient[state.baseIndex + 2]!;
      if (radius === 0 && startAngle === 0 && endAngle === 0) continue;
      const entity = entityById.get(state.entityId);
      if (
        entity?.kind === "arc" &&
        pointDefinedArcEntityIds.has(entity.entityId)
      ) {
        const centerRecord = pointRecords.get(entity.centerPointId);
        const startRecord = pointRecords.get(entity.startPointId);
        const endRecord = pointRecords.get(entity.endPointId);
        if (!centerRecord || !startRecord || !endRecord) continue;
        const center = getPoint(projected.values, centerRecord);
        const start = getPoint(projected.values, startRecord);
        const end = getPoint(projected.values, endRecord);
        const startOffset = subtract(start, center);
        const endOffset = subtract(end, center);
        const startLengthSquared = startOffset[0] ** 2 + startOffset[1] ** 2;
        const endLengthSquared = endOffset[0] ** 2 + endOffset[1] ** 2;
        if (
          startLengthSquared <= DEGENERATE_NORM_EPSILON ** 2 ||
          endLengthSquared <= DEGENERATE_NORM_EPSILON ** 2
        ) {
          continue;
        }
        const startCotangent: SketchPoint2D = [
          (radius * startOffset[0]) / Math.sqrt(startLengthSquared) -
            (startAngle * startOffset[1]) / startLengthSquared,
          (radius * startOffset[1]) / Math.sqrt(startLengthSquared) +
            (startAngle * startOffset[0]) / startLengthSquared,
        ];
        const endCotangent: SketchPoint2D = [
          (-endAngle * endOffset[1]) / endLengthSquared,
          (endAngle * endOffset[0]) / endLengthSquared,
        ];
        addPointCotangent(entity.startPointId, startCotangent);
        addPointCotangent(entity.endPointId, endCotangent);
        addPointCotangent(entity.centerPointId, [
          -startCotangent[0] - endCotangent[0],
          -startCotangent[1] - endCotangent[1],
        ]);
      } else {
        entityCotangent[state.entityId] = {
          kind: "arc",
          radius,
          startAngle,
          endAngle,
        };
      }
      hasDrivenCotangent = true;
    }
    for (const { state } of scope.tangents) {
      const x = inputGradient[state.baseIndex]!;
      const y = inputGradient[state.baseIndex + 1]!;
      if (x === 0 && y === 0) continue;
      const entity = tangentCotangent[state.entityId] ?? {};
      entity[state.occurrenceId] = [x, y];
      tangentCotangent[state.entityId] = entity;
      hasDrivenCotangent = true;
    }
    if (!hasDrivenCotangent) return null;

    const gradient = inputGradient.slice();
    for (const { record } of scope.points) {
      gradient[record.baseIndex] = 0;
      gradient[record.baseIndex + 1] = 0;
    }
    for (const { state } of scope.entities) {
      for (const index of entityIndices(state.entityId)) {
        gradient[index] = 0;
      }
    }
    for (const { state } of scope.tangents) {
      gradient[state.baseIndex] = 0;
      gradient[state.baseIndex + 1] = 0;
    }
    const cotangent: SketchDerivationVariation = {
      points: pointCotangent,
      entities: entityCotangent,
      splineTangents: tangentCotangent,
    };
    const pulled = projected.pullback(cotangent);
    // Review A4: a singular offset derivative is never zero motion
    // (`wrapConstraint` keeps the requirement's residual and warns).
    if (pulled.derivativeUnavailable)
      return {
        gradient,
        derivativeUnavailable: pulled.derivativeUnavailable,
      };
    for (const [pointId, value] of Object.entries(pulled.points ?? {})) {
      const record = pointRecords.get(pointId as SketchPointId);
      if (!record || !value) continue;
      gradient[record.baseIndex] += value[0];
      gradient[record.baseIndex + 1] += value[1];
    }
    for (const [entityId, value] of Object.entries(pulled.entities ?? {})) {
      const state = entityStates.get(entityId as SketchEntityId);
      if (!state || !value || state.kind !== value.kind) continue;
      gradient[state.baseIndex] += value.radius;
      if (state.kind === "arc" && value.kind === "arc") {
        gradient[state.baseIndex + 1] += value.startAngle;
        gradient[state.baseIndex + 2] += value.endAngle;
      }
    }
    for (const [entityId, occurrences] of Object.entries(
      pulled.splineTangents ?? {},
    )) {
      for (const [occurrenceId, value] of Object.entries(occurrences ?? {})) {
        const state = splineTangentStates.get(
          splineTangentStateKey(entityId as SketchEntityId, occurrenceId),
        );
        if (!state || !value) continue;
        gradient[state.baseIndex] += value[0];
        gradient[state.baseIndex + 1] += value[1];
      }
    }
    return { gradient };
  };

  /**
   * A row's Jacobian pulled back onto the authority variables. Where
   * `wrapConstraint` would block the row or drop its gradient (a named
   * relationship failed, or its pullback is singular), the rows are NaN and
   * `unavailable` says why: never a zero row that reads as a valid one.
   */
  const pullBackComponentJacobian =
    (
      evaluate: (values: Float64Array) => ComponentJacobian,
      scope: NonNullable<ReturnType<typeof drivenScope>>,
      blockingOffsets: readonly string[],
    ) =>
    (values: Float64Array): ComponentJacobian => {
      const projected = project(values, scope.projectionValidationIndices);
      const inner = evaluate(projected.values);
      const failing = new Set(
        [
          ...projected.evaluation.offsetFailures,
          ...projected.evaluation.derivedFailures,
        ].map((failure) => failure.derivationId),
      );
      const unavailable = new Map<string, OffsetRequirementBlocker>(
        (inner.unavailable ?? []).map((entry) => [entry.derivationId, entry]),
      );
      for (const derivationId of blockingOffsets)
        if (startFailedOffsets.has(derivationId))
          unavailable.set(derivationId, { derivationId, reason: "failed" });
        else if (failing.has(derivationId))
          unavailable.set(derivationId, {
            derivationId,
            reason: "failedDuringSolve",
          });
      const rows =
        unavailable.size > 0
          ? []
          : inner.rows.map((row) => {
              const pulled = pullBackGradient(scope, projected, row);
              for (const derivationId of pulled?.derivativeUnavailable ?? [])
                unavailable.set(derivationId, {
                  derivationId,
                  reason: "derivativeUnavailable",
                });
              return pulled?.gradient ?? row;
            });
      if (unavailable.size === 0) return { components: inner.components, rows };
      return {
        components: inner.components,
        rows: inner.rows.map(() =>
          new Float64Array(parameterCount).fill(Number.NaN),
        ),
        unavailable: [...unavailable.values()],
      };
    };

  return {
    projectValues: (values) => cloneValues(project(values).values),
    projectionDiagnostics: (values) => [...project(values).diagnostics],
    derivationEvaluation: (values) => project(values).evaluation,
    projectVariableIndices,
    authorityVariableIndices,
    relationshipFailuresAt: (values) => {
      const { evaluation } = project(values);
      return new Set(
        [...evaluation.offsetFailures, ...evaluation.derivedFailures].map(
          (failure) => failure.derivationId,
        ),
      );
    },
    withBlockedRelationships: (blocked, run) => {
      const previous = startFailedOffsets;
      startFailedOffsets = blocked;
      try {
        return run();
      } finally {
        startFailedOffsets = previous;
      }
    },
    failedAtSolveStart: (derivationId) => startFailedOffsets.has(derivationId),
    wrapComponentJacobian: (evaluate, variableIndices) => {
      const scope = drivenScope(variableIndices);
      return scope
        ? pullBackComponentJacobian(
            evaluate,
            scope,
            variableIndices ? relationshipsNamedBy(variableIndices) : [],
          )
        : evaluate;
    },
    wrapConstraint: (constraint, variableIndices) => {
      const scope = drivenScope(variableIndices);
      if (!scope) return constraint;
      const { projectionValidationIndices } = scope;
      const blockingOffsets = variableIndices
        ? relationshipsNamedBy(variableIndices)
        : [];
      const blocked = (
        blockers: readonly OffsetRequirementBlocker[],
      ): {
        result: ScalarConstraintEvaluation;
        blockers: readonly OffsetRequirementBlocker[];
      } => ({
        result: { residual: 0, gradient: zeroVector(parameterCount) },
        blockers,
      });

      const evaluateScoped = (
        values: Float64Array,
      ): {
        result: ScalarConstraintEvaluation;
        blockers: readonly OffsetRequirementBlocker[];
      } => {
        const projected = project(values, projectionValidationIndices);
        // [TECH] G16′/G16‴: a requirement naming an output of a
        // relationship outside the solve's blocked set that fails at this
        // iterate (its outputs are frozen) is unbounded, so stepping into
        // a failure that appears mid-solve is never a reward.
        const failedDuringSolve = blockingOffsets.filter(
          (derivationId) =>
            !startFailedOffsets.has(derivationId) &&
            [
              ...projected.evaluation.offsetFailures,
              ...projected.evaluation.derivedFailures,
            ].some((failure) => failure.derivationId === derivationId),
        );
        // [TECH] G16⁗ (re-review A-1): a relationship of the blocked set
        // holds the requirement blocked for the whole solve, also where it
        // builds again, so its real residual appearing there is never a
        // barrier that rewards staying failed.
        const failed = blockingOffsets.filter((derivationId) =>
          startFailedOffsets.has(derivationId),
        );
        if (failedDuringSolve.length > 0)
          return {
            result: {
              residual: Number.POSITIVE_INFINITY,
              gradient: zeroVector(parameterCount),
            },
            blockers: failedDuringSolve.map((derivationId) => ({
              derivationId,
              reason: "failedDuringSolve" as const,
            })),
          };
        if (failed.length > 0)
          return blocked(
            failed.map((derivationId) => ({
              derivationId,
              reason: "failed" as const,
            })),
          );
        const evaluated = constraint.evaluate(projected.values);
        const pulled = pullBackGradient(scope, projected, evaluated.gradient);
        if (!pulled) return { result: evaluated, blockers: [] };
        // Review A4: a singular offset derivative is never zero motion.
        // [TECH] G16‴ (review R1): the requirement keeps its real residual
        // (its status follows it); only its gradient through the offset is
        // dropped, and it is reported with a targeted warning.
        if (pulled.derivativeUnavailable)
          return {
            result: { residual: evaluated.residual, gradient: pulled.gradient },
            blockers: pulled.derivativeUnavailable.map((derivationId) => ({
              derivationId,
              reason: "derivativeUnavailable" as const,
            })),
          };
        return {
          result: { residual: evaluated.residual, gradient: pulled.gradient },
          blockers: [],
        };
      };

      const innerBlockers = constraint.offsetBlockers;
      return {
        ...constraint,
        evaluate: (values) => evaluateScoped(values).result,
        evaluateComponents: (values) =>
          constraint.evaluateComponents(
            project(values, projectionValidationIndices).values,
          ),
        evaluateComponentJacobian: pullBackComponentJacobian(
          constraint.evaluateComponentJacobian,
          scope,
          blockingOffsets,
        ),
        ...(blockingOffsets.length > 0 || innerBlockers
          ? {
              offsetBlockers: (values: Float64Array) => {
                const own = evaluateScoped(values).blockers;
                return own.length > 0 || !innerBlockers
                  ? own
                  : innerBlockers(
                      project(values, projectionValidationIndices).values,
                    );
              },
            }
          : {}),
      };
    },
  };
}
