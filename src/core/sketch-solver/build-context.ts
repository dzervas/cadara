import type {
  ConstraintId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { offsetRecordDerivatives } from "@/contracts/sketch/derived-geometry";
import type { OffsetFrameVariation } from "@/contracts/sketch/offset-derivation-frame";
import {
  localQueryDomain,
  offsetFrameCurveResidual,
} from "@/contracts/sketch/offset-derivation-frame";
import type {
  ConstraintDefinition,
  NumericDimensionDefinition as DimensionDefinition,
  LocalCollinearTargetOperand,
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type { SplinePoles } from "@/contracts/sketch/spline-geometry";
import {
  closestSplineSpanLocation,
  evaluateSplineSpan,
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import type { ProjectedSketchReferenceGeometry } from "@/contracts/solver/schema";
import type { ArcDual } from "./analytic-residuals";
import {
  arcSweepMarginsDual,
  closestPointResidualDuals,
  componentJacobianOver,
  lineNormalDirectionResidualDual,
  localArcDataDual,
  midpointDual,
  nearestPointOnArcSweepDual,
  pointLineSignedDistanceDual,
  projectedArcDataDual,
  unitVectorDual,
} from "./analytic-residuals";
import {
  getLocalCircleLikeGeometry,
  localArcData,
  nearestPointOnLocalArcSweep,
} from "./arc-geometry";
import type { Dual, Dual2, DualColumns } from "./automatic-differentiation";
import { dual, dual2, dualColumns } from "./automatic-differentiation";
import { uniqueSortedIndices } from "./compile-components";
import { getEntityPoints } from "./entity-points";
import {
  lineNormalDirectionResidual,
  pointLineSignedDistance,
  resolveLineDimensionOperand,
  resolvePointDimensionOperand,
} from "./line-residuals";
import {
  createDerivedParameterProjection,
  midpoint,
  splineTangentStateKey,
} from "./parameter-projection";
import {
  nearestPointOnProjectedArcSweep,
  pointProjectedArcDistance,
  projectedArcData,
  projectedCircleLikeGeometry,
  unitVector,
} from "./projected-geometry";
import {
  dot2,
  getPoint,
  halfSquaredDistanceWithSaturation,
  length,
  subtract,
  zeroVector,
} from "./solver-geometry";
import type {
  BuildSystemOptions,
  OffsetRequirementBlocker,
  ScalarConstraintEvaluation,
  ScalarConstraintRecord,
  SolverEntityState,
  SolverInequalityRecord,
  SolverOrientedTangencyRecord,
  SolverPointRecord,
  SplineTangentState,
} from "./system-types";
export type BuildContext = ReturnType<typeof createBuildContext>;

export function createBuildContext(
  definition: SketchDefinition,
  options: BuildSystemOptions,
  getParameterProjection: () => ReturnType<
    typeof createDerivedParameterProjection
  >,
) {
  const pointRecords = new Map<SketchPointId, SolverPointRecord>();
  const entityStates = new Map<SketchEntityId, SolverEntityState>();
  const splineTangentStates = new Map<string, SplineTangentState>();
  const scalarConstraints: ScalarConstraintRecord[] = [];
  let parameterCount = 0;
  for (const point of definition.points) {
    pointRecords.set(point.pointId, {
      pointId: point.pointId,
      initial: point.position,
      baseIndex: parameterCount,
    });
    parameterCount += 2;
  }

  for (const entity of definition.entities) {
    if (entity.kind === "circle") {
      entityStates.set(entity.entityId, {
        kind: "circle",
        entityId: entity.entityId,
        baseIndex: parameterCount,
      });
      parameterCount += 1;
      continue;
    }

    if (entity.kind === "arc") {
      const center = pointRecords.get(entity.centerPointId);
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (!center || !start || !end) {
        continue;
      }

      const centerPos = center.initial;
      const startVector = subtract(start.initial, centerPos);
      const endVector = subtract(end.initial, centerPos);
      entityStates.set(entity.entityId, {
        kind: "arc",
        entityId: entity.entityId,
        baseIndex: parameterCount,
      });
      parameterCount += 3;

      void startVector;
      void endVector;
    }
  }

  for (const entity of definition.entities) {
    if (entity.kind !== "spline") continue;
    const occurrences = orderedSplineOccurrences(entity);
    if (!occurrences) continue;
    occurrences.forEach((occurrence, occurrenceIndex) => {
      if (occurrence.tangent.kind !== "authored") return;
      splineTangentStates.set(
        splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
        {
          kind: "splineTangent",
          entityId: entity.entityId,
          occurrenceId: occurrence.occurrenceId,
          occurrenceIndex,
          baseIndex: parameterCount,
        },
      );
      parameterCount += 2;
    });
  }

  const initialValues = new Float64Array(parameterCount);
  for (const record of pointRecords.values()) {
    initialValues[record.baseIndex] = record.initial[0];
    initialValues[record.baseIndex + 1] = record.initial[1];
  }

  for (const entity of definition.entities) {
    if (entity.kind === "spline") {
      const occurrences = orderedSplineOccurrences(entity) ?? [];
      for (const occurrence of occurrences) {
        if (occurrence.tangent.kind !== "authored") continue;
        const state = splineTangentStates.get(
          splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
        );
        if (!state) continue;
        initialValues[state.baseIndex] = occurrence.tangent.vector[0];
        initialValues[state.baseIndex + 1] = occurrence.tangent.vector[1];
      }
      continue;
    }

    if (entity.kind === "circle") {
      const circleState = entityStates.get(entity.entityId);
      if (circleState?.kind === "circle") {
        initialValues[circleState.baseIndex] = entity.radius;
      }
      continue;
    }

    if (entity.kind !== "arc") {
      continue;
    }
    const arcState = entityStates.get(entity.entityId);
    const center = pointRecords.get(entity.centerPointId);
    const start = pointRecords.get(entity.startPointId);
    const end = pointRecords.get(entity.endPointId);
    if (!arcState || arcState.kind !== "arc" || !center || !start || !end) {
      continue;
    }

    const centerPos = center.initial;
    const startOffset = subtract(start.initial, centerPos);
    const endOffset = subtract(end.initial, centerPos);
    initialValues[arcState.baseIndex] = Math.max(length(startOffset), 1e-9);
    initialValues[arcState.baseIndex + 1] = Math.atan2(
      startOffset[1],
      startOffset[0],
    );
    initialValues[arcState.baseIndex + 2] = Math.atan2(
      endOffset[1],
      endOffset[0],
    );
  }

  const lineEntityMap = new Map(
    definition.entities
      .filter(
        (
          entity,
        ): entity is Extract<SketchEntityDefinition, { kind: "lineSegment" }> =>
          entity.kind === "lineSegment",
      )
      .map((entity) => [entity.entityId, entity]),
  );
  const arcEntityMap = new Map(
    definition.entities
      .filter(
        (entity): entity is Extract<SketchEntityDefinition, { kind: "arc" }> =>
          entity.kind === "arc",
      )
      .map((entity) => [entity.entityId, entity]),
  );

  const getLocalCircleLike = (
    values: Float64Array,
    entity: SketchEntityDefinition,
  ): {
    center: SketchPoint2D;
    radius: number;
    arc?: ReturnType<typeof localArcData>;
  } | null =>
    getLocalCircleLikeGeometry(values, entity, pointRecords, entityStates);

  const currentSplineAggregate = (
    values: Float64Array,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
  ) => ({
    ...entity,
    pointOccurrences: entity.pointOccurrences.map((occurrence) => {
      if (occurrence.tangent.kind !== "authored") return occurrence;
      const state = splineTangentStates.get(
        splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
      );
      return state
        ? {
            ...occurrence,
            tangent: {
              kind: "authored" as const,
              vector: [
                values[state.baseIndex]!,
                values[state.baseIndex + 1]!,
              ] as const,
            },
          }
        : occurrence;
    }),
  });

  // Only the spline's own occurrence points: `resolveSplineAggregate` reads
  // nothing else, and building every sketch point per reconstruction was 44%
  // of the spline constraints' reconstruction time (cadara-b3k.26).
  const currentSplinePositions = (
    values: Float64Array,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
  ) => {
    const positions: Record<SketchPointId, SketchPoint2D> = {};
    for (const occurrence of entity.pointOccurrences) {
      const record = pointRecords.get(occurrence.pointId);
      if (record) positions[occurrence.pointId] = getPoint(values, record);
    }
    return positions;
  };

  const reconstructCurrentSpline = (
    values: Float64Array,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
    variation: Parameters<typeof reconstructSplineAggregate>[2] = {},
  ) =>
    reconstructSplineAggregate(
      currentSplineAggregate(values, entity),
      currentSplinePositions(values, entity),
      variation,
    );

  const closestSplineLocation = (
    position: SketchPoint2D,
    geometry: ReturnType<typeof reconstructSplineAggregate>,
  ) =>
    geometry.validity === "valid"
      ? closestSplineSpanLocation(position, geometry.spans)
      : null;

  const splineVariationForVariable = (
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
    variableIndex: number,
  ) => {
    for (const occurrence of orderedSplineOccurrences(entity) ?? []) {
      const state = splineTangentStates.get(
        splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
      );
      if (!state) continue;
      if (variableIndex === state.baseIndex)
        return { tangents: { [state.occurrenceIndex]: [1, 0] as const } };
      if (variableIndex === state.baseIndex + 1)
        return { tangents: { [state.occurrenceIndex]: [0, 1] as const } };
    }
    for (const occurrence of orderedSplineOccurrences(entity) ?? []) {
      const point = pointRecords.get(occurrence.pointId);
      if (!point) continue;
      if (variableIndex === point.baseIndex)
        return { points: { [occurrence.pointId]: [1, 0] as const } };
      if (variableIndex === point.baseIndex + 1)
        return { points: { [occurrence.pointId]: [0, 1] as const } };
    }
    return {};
  };

  const createSplinePointConstraint = (
    constraint: Extract<ConstraintDefinition, { kind: "pointOnCurve" }>,
    point: SolverPointRecord,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
  ): ScalarConstraintRecord => {
    const affectedVariableIndices = uniqueSortedIndices([
      ...pIdx(point),
      ...entityIdx(entity.entityId),
    ]);
    return {
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluateComponents(values) {
        const position = getPoint(values, point);
        const geometry = reconstructCurrentSpline(values, entity);
        const closest = closestSplineLocation(position, geometry);
        if (!closest || geometry.validity !== "valid")
          return [Infinity, Infinity];
        const evaluated = evaluateSplineSpan(
          geometry.spans[closest.spanIndex]!,
          { kind: "local", value: closest.u },
        );
        return subtract(position, evaluated.position);
      },
      evaluateComponentJacobian(values) {
        const columns = dualColumns(values, affectedVariableIndices);
        const position = getPoint(values, point);
        const aggregate = currentSplineAggregate(values, entity);
        const positions = currentSplinePositions(values, entity);
        const geometry = reconstructSplineAggregate(aggregate, positions);
        const closest = closestSplineLocation(position, geometry);
        if (!closest || geometry.validity !== "valid")
          return columns.jacobian(infiniteDuals(columns, 2), parameterCount);
        const location = { kind: "local", value: closest.u } as const;
        const evaluated = evaluateSplineSpan(
          geometry.spans[closest.spanIndex]!,
          location,
        );
        const variations = columns.support.map((variableIndex) => {
          const varied = reconstructSplineAggregate(
            aggregate,
            positions,
            splineVariationForVariable(entity, variableIndex),
          );
          return varied.validity === "valid"
            ? evaluateSplineSpan(varied.spans[closest.spanIndex]!, location)
                .differential
            : null;
        });
        return columns.jacobian(
          closestPointResidualDuals({
            residual: subtract(position, evaluated.position),
            atDomainEnd: closest.u === 0 || closest.u === 1,
            first: evaluated.first,
            second: evaluated.second,
            columns: columns.support.length,
            dPoint: (column) =>
              columns.support[column] === point.baseIndex
                ? [1, 0]
                : columns.support[column] === point.baseIndex + 1
                  ? [0, 1]
                  : [0, 0],
            dCurve: (column) => variations[column]?.position ?? [0, 0],
            dFirst: (column) => variations[column]?.first ?? [0, 0],
          }),
          parameterCount,
        );
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const position = getPoint(values, point);
        // One aggregate and one position map for the base reconstruction and
        // every directional variation below (1 + N reconstructions per call).
        const aggregate = currentSplineAggregate(values, entity);
        const positions = currentSplinePositions(values, entity);
        const geometry = reconstructSplineAggregate(aggregate, positions);
        const closest = closestSplineLocation(position, geometry);
        if (!closest || geometry.validity !== "valid") {
          return { residual: Number.POSITIVE_INFINITY, gradient };
        }
        const span = geometry.spans[closest.spanIndex]!;
        const evaluated = evaluateSplineSpan(span, {
          kind: "local",
          value: closest.u,
        });
        const delta = subtract(evaluated.position, position);
        for (const variableIndex of affectedVariableIndices) {
          const varied = reconstructSplineAggregate(
            aggregate,
            positions,
            splineVariationForVariable(entity, variableIndex),
          );
          if (varied.validity !== "valid") continue;
          const differential = evaluateSplineSpan(
            varied.spans[closest.spanIndex]!,
            { kind: "local", value: closest.u },
          ).differential.position;
          const targetDerivative: SketchPoint2D =
            variableIndex === point.baseIndex
              ? [1, 0]
              : variableIndex === point.baseIndex + 1
                ? [0, 1]
                : [0, 0];
          gradient[variableIndex] = dot2(
            delta,
            subtract(differential, targetDerivative),
          );
        }
        return {
          residual: halfSquaredDistanceWithSaturation(closest.distanceSquared),
          gradient,
        };
      },
    };
  };

  /**
   * T08b-g5 (U-G2): point-on-curve on a derived shell, the frame's
   * `offsetFrameCurveResidual` r = P − C(leaf, u) with the closest point
   * restricted to the drawn (query) domain and the location held fixed for
   * the gradient: ∂/∂P = r and ∂/∂source = r·∂r/∂source, pulled back
   * through the solve frame onto seed points, authored tangents and circle
   * radii. A relationship whose frame failed has no curve: the residual is
   * unbounded and its projection diagnostic explains why.
   */
  const createShellPointConstraint = (
    constraint: Extract<ConstraintDefinition, { kind: "pointOnCurve" }>,
    point: SolverPointRecord,
    shell: Extract<SketchEntityDefinition, { kind: "derivedPiecewiseCubic" }>,
  ): ScalarConstraintRecord => {
    // [TECH] G16′/G16‴: a failed relationship has no curve. The
    // requirement is blocked (reported, never silently satisfied) when the
    // relationship already failed at the solve's start, and unbounded when
    // the failure appears mid-solve (never a reward). Without a closest
    // point on the drawn domain there is no residual either: unbounded.
    // [TECH] G16⁗: a relationship of the blocked set holds it blocked for
    // the whole solve, also where it builds again.
    const scoped = (
      values: Float64Array,
    ): {
      result: ScalarConstraintEvaluation;
      blockers: readonly OffsetRequirementBlocker[];
    } => {
      const gradient = zeroVector(parameterCount);
      const blocked = (reason: OffsetRequirementBlocker["reason"]) => ({
        result: {
          residual: reason === "failed" ? 0 : Number.POSITIVE_INFINITY,
          gradient,
        },
        blockers: [{ derivationId: shell.derivationId, reason }],
      });
      if (getParameterProjection().failedAtSolveStart(shell.derivationId))
        return blocked("failed");
      const record = getParameterProjection()
        .derivationEvaluation(values)
        ?.offsetFrames.find(
          (candidate) => candidate.derivationId === shell.derivationId,
        );
      const output = record?.outputs.shells.find(
        (candidate) => candidate.entityId === shell.entityId,
      );
      if (!record || !output) return blocked("failedDuringSolve");
      const result = offsetFrameCurveResidual({
        frame: record.frame,
        derivatives: offsetRecordDerivatives(record),
        seedEntityId: output.seed,
        point: getPoint(values, point),
      });
      if ("code" in result) return blocked("derivativeUnavailable");
      const [rx, ry] = result.value;
      gradient[point.baseIndex] += rx;
      gradient[point.baseIndex + 1] += ry;
      const [sx, sy] = result.gradient.source;
      for (const [pointId, value] of Object.entries(sx.points ?? {})) {
        const record = pointRecords.get(pointId as SketchPointId);
        const other = sy.points?.[pointId] ?? [0, 0];
        if (!record) continue;
        gradient[record.baseIndex] += rx * value[0] + ry * other[0];
        gradient[record.baseIndex + 1] += rx * value[1] + ry * other[1];
      }
      for (const [entityId, occurrences] of Object.entries(
        sx.splineTangents ?? {},
      ))
        for (const [occurrenceId, value] of Object.entries(occurrences)) {
          const state = splineTangentStates.get(
            splineTangentStateKey(entityId as SketchEntityId, occurrenceId),
          );
          const other = sy.splineTangents?.[entityId]?.[occurrenceId] ?? [0, 0];
          if (!state) continue;
          gradient[state.baseIndex] += rx * value[0] + ry * other[0];
          gradient[state.baseIndex + 1] += rx * value[1] + ry * other[1];
        }
      for (const [entityId, value] of Object.entries(sx.circleRadii ?? {})) {
        const state = entityStates.get(entityId as SketchEntityId);
        if (state?.kind !== "circle") continue;
        gradient[state.baseIndex] +=
          rx * value + ry * (sy.circleRadii?.[entityId] ?? 0);
      }
      return {
        result: {
          residual: halfSquaredDistanceWithSaturation(rx * rx + ry * ry),
          gradient,
        },
        blockers: [],
      };
    };
    return {
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluate: (values) => scoped(values).result,
      evaluateComponents(values) {
        const record = getParameterProjection()
          .derivationEvaluation(values)
          ?.offsetFrames.find(
            (candidate) => candidate.derivationId === shell.derivationId,
          );
        const output = record?.outputs.shells.find(
          (candidate) => candidate.entityId === shell.entityId,
        );
        if (!record || !output) return [Infinity, Infinity];
        const result = offsetFrameCurveResidual({
          frame: record.frame,
          derivatives: offsetRecordDerivatives(record),
          seedEntityId: output.seed,
          point: getPoint(values, point),
        });
        return "code" in result ? [Infinity, Infinity] : result.value;
      },
      evaluateComponentJacobian(values) {
        const rows = [zeroVector(parameterCount), zeroVector(parameterCount)];
        const record = getParameterProjection()
          .derivationEvaluation(values)
          ?.offsetFrames.find(
            (candidate) => candidate.derivationId === shell.derivationId,
          );
        const output = record?.outputs.shells.find(
          (candidate) => candidate.entityId === shell.entityId,
        );
        if (!record || !output)
          return { components: [Infinity, Infinity], rows };
        const derivatives = offsetRecordDerivatives(record);
        const result = offsetFrameCurveResidual({
          frame: record.frame,
          derivatives,
          seedEntityId: output.seed,
          point: getPoint(values, point),
        });
        if ("code" in result) return { components: [Infinity, Infinity], rows };
        const addVariation = (
          row: Float64Array,
          variation: OffsetFrameVariation,
        ) => {
          for (const [pointId, value] of Object.entries(
            variation.points ?? {},
          )) {
            const source = pointRecords.get(pointId as SketchPointId);
            if (!source) continue;
            row[source.baseIndex] += value[0];
            row[source.baseIndex + 1] += value[1];
          }
          for (const [entityId, occurrences] of Object.entries(
            variation.splineTangents ?? {},
          ))
            for (const [occurrenceId, value] of Object.entries(occurrences)) {
              const state = splineTangentStates.get(
                splineTangentStateKey(entityId as SketchEntityId, occurrenceId),
              );
              if (!state) continue;
              row[state.baseIndex] += value[0];
              row[state.baseIndex + 1] += value[1];
            }
          for (const [entityId, value] of Object.entries(
            variation.circleRadii ?? {},
          )) {
            const state = entityStates.get(entityId as SketchEntityId);
            if (state?.kind === "circle") row[state.baseIndex] += value;
          }
        };
        // ∂r/∂x with the location (leaf, u) held, as `evaluate` uses it.
        result.gradient.point.forEach((pointRow, axis) => {
          rows[axis]![point.baseIndex] += pointRow[0];
          rows[axis]![point.baseIndex + 1] += pointRow[1];
          addVariation(rows[axis]!, result.gradient.source[axis]!);
        });
        // The location moves too (`closestPointResidualDuals`): with
        // D = C′·C′ − r·C″, du = (∂r·C′ + r·∂C′) / D and dr = ∂r − C′·du;
        // r·∂C′ is the pullback of the pole cotangent r·Bᵢ′(u).
        const { leaf: leafIndex, u } = result.location;
        const leaf = record.frame.cubics.get(output.seed)![leafIndex]!;
        const curve = evaluateSplineSpan(
          {
            interval: leaf.sourceDomain,
            poles: leaf.span.poles,
            differential: {
              interval: [0, 0],
              poles: [
                [0, 0],
                [0, 0],
                [0, 0],
                [0, 0],
              ],
            },
          },
          { kind: "local", value: u },
        );
        const residual = result.value;
        const first = curve.first;
        if (
          localQueryDomain(leaf).includes(u) &&
          Math.abs(dot2(residual, first)) >
            1e-3 * length(residual) * length(first)
        )
          return { components: residual, rows };
        const v = 1 - u;
        const basisDerivatives = [
          -3 * v * v,
          3 * v * v - 6 * u * v,
          6 * u * v - 3 * u * u,
          3 * u * u,
        ];
        const cotangentLeaves: { poles: SplinePoles }[] = [];
        cotangentLeaves[leafIndex] = {
          poles: basisDerivatives.map((weight) => [
            residual[0] * weight,
            residual[1] * weight,
          ]) as unknown as SplinePoles,
        };
        const firstVariation = derivatives.pullback({
          cubics: new Map([[output.seed, cotangentLeaves]]),
        });
        const du = zeroVector(parameterCount);
        for (let index = 0; index < parameterCount; index += 1)
          du[index] = rows[0]![index]! * first[0] + rows[1]![index]! * first[1];
        if (!("ok" in firstVariation)) addVariation(du, firstVariation);
        const curvature = dot2(first, first) - dot2(residual, curve.second);
        for (let index = 0; index < parameterCount; index += 1) {
          const step = du[index]! / curvature;
          rows[0]![index] -= first[0] * step;
          rows[1]![index] -= first[1] * step;
        }
        return { components: residual, rows };
      },
      offsetBlockers: (values) => scoped(values).blockers,
    };
  };

  const pointOnLocalCurveResidual = (
    values: Float64Array,
    point: SolverPointRecord,
    entity: SketchEntityDefinition,
  ) => {
    const position = getPoint(values, point);

    if (entity.kind === "lineSegment") {
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      return start && end
        ? pointLineSignedDistance(
            position,
            getPoint(values, start),
            getPoint(values, end),
          )
        : 0;
    }

    const circleLike = getLocalCircleLike(values, entity);
    if (!circleLike) {
      return 0;
    }

    if (circleLike.arc) {
      return length(
        subtract(
          position,
          nearestPointOnLocalArcSweep(position, circleLike.arc),
        ),
      );
    }

    return length(subtract(position, circleLike.center)) - circleLike.radius;
  };

  const pointOnProjectedCurveResidual = (
    position: SketchPoint2D,
    projected: ProjectedSketchReferenceGeometry,
  ) => {
    if (projected.kind === "lineSegment") {
      return pointLineSignedDistance(
        position,
        projected.startPosition,
        projected.endPosition,
      );
    }

    if (projected.kind === "arc") {
      return pointProjectedArcDistance(position, projected);
    }

    if (projected.kind === "spline") {
      if (projected.representation.kind === "sourceSamples")
        return Number.POSITIVE_INFINITY;
      const closest = closestSplineSpanLocation(
        position,
        projected.representation.spans,
      );
      if (!closest) return Number.POSITIVE_INFINITY;
      const evaluated = evaluateSplineSpan(
        projected.representation.spans[closest.spanIndex]!,
        { kind: "local", value: closest.u },
      );
      return length(subtract(evaluated.position, position));
    }

    const circleLike = projectedCircleLikeGeometry(projected);
    return circleLike
      ? length(subtract(position, circleLike.center)) - circleLike.radius
      : 0;
  };

  const localCurveComponents = (
    values: Float64Array,
    point: SolverPointRecord,
    entity: SketchEntityDefinition,
  ): readonly number[] => {
    const position = getPoint(values, point);
    const circle = getLocalCircleLike(values, entity);
    return circle?.arc
      ? subtract(position, nearestPointOnLocalArcSweep(position, circle.arc))
      : [pointOnLocalCurveResidual(values, point, entity)];
  };
  const projectedCurveComponents = (
    position: SketchPoint2D,
    projected: ProjectedSketchReferenceGeometry,
  ): readonly number[] =>
    projected.kind === "arc"
      ? subtract(
          position,
          nearestPointOnProjectedArcSweep(
            position,
            projectedArcData(projected),
          ),
        )
      : [pointOnProjectedCurveResidual(position, projected)];
  const symmetryComponents = (
    first: SketchPoint2D,
    second: SketchPoint2D,
    start: SketchPoint2D,
    end: SketchPoint2D,
  ) => {
    const unit = unitVector(start, end);
    return unit
      ? [
          pointLineSignedDistance(midpoint(first, second), start, end),
          dot2(subtract(second, first), unit),
        ]
      : [Infinity, Infinity];
  };

  const normalResidual = (
    values: Float64Array,
    line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
    contactPoint: SketchPoint2D,
    center: SketchPoint2D,
  ) => {
    const start = pointRecords.get(line.startPointId);
    const end = pointRecords.get(line.endPointId);
    if (!start || !end) {
      return 0;
    }

    return lineNormalDirectionResidual(
      getPoint(values, start),
      getPoint(values, end),
      contactPoint,
      center,
    );
  };

  const lineContactResidual = (
    values: Float64Array,
    line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
    contactPoint: SketchPoint2D,
  ) => {
    const start = pointRecords.get(line.startPointId);
    const end = pointRecords.get(line.endPointId);
    return start && end
      ? pointLineSignedDistance(
          contactPoint,
          getPoint(values, start),
          getPoint(values, end),
        )
      : 0;
  };

  const symmetricResidual = (
    firstPoint: SketchPoint2D,
    secondPoint: SketchPoint2D,
    axisStart: SketchPoint2D,
    axisEnd: SketchPoint2D,
  ) => {
    const axisUnit = unitVector(axisStart, axisEnd);
    if (!axisUnit) {
      return 0;
    }

    const center = midpoint(firstPoint, secondPoint);
    const axisDistance = pointLineSignedDistance(center, axisStart, axisEnd);
    const pairVector = subtract(secondPoint, firstPoint);
    const axisProjection = dot2(pairVector, axisUnit);
    return Math.sqrt(
      axisDistance * axisDistance + axisProjection * axisProjection,
    );
  };

  const pIdx = (...points: (SolverPointRecord | null | undefined)[]) =>
    points.flatMap((p) => (p ? [p.baseIndex, p.baseIndex + 1] : []));

  const eIdx = (entityId: SketchEntityId) => {
    const state = entityStates.get(entityId);
    if (!state || state.kind === "point") return [];
    if (state.kind === "circle") return [state.baseIndex];
    return [state.baseIndex, state.baseIndex + 1, state.baseIndex + 2];
  };

  const lineIdx = (entityId: SketchEntityId) => {
    const line = lineEntityMap.get(entityId);
    if (!line) return [];
    return pIdx(
      pointRecords.get(line.startPointId),
      pointRecords.get(line.endPointId),
    );
  };

  const entityIdx = (entityId: SketchEntityId) => {
    const entity = definition.entities.find((e) => e.entityId === entityId);
    if (!entity) return [];
    const tangentIndices =
      entity.kind === "spline"
        ? (orderedSplineOccurrences(entity) ?? []).flatMap((occurrence) => {
            const state = splineTangentStates.get(
              splineTangentStateKey(entity.entityId, occurrence.occurrenceId),
            );
            return state ? [state.baseIndex, state.baseIndex + 1] : [];
          })
        : [];
    return uniqueSortedIndices([
      ...getEntityPoints(entity).flatMap((pid) => pIdx(pointRecords.get(pid))),
      ...eIdx(entityId),
      ...tangentIndices,
    ]);
  };

  const collinearTargetIdx = (target: LocalCollinearTargetOperand) => {
    if (target.kind === "localPoint")
      return pIdx(pointRecords.get(target.pointId));
    return lineIdx(target.entityId);
  };

  const lineDimOperandIdx = (
    operand: Extract<
      DimensionDefinition,
      { kind: "lineDistance" }
    >["lines"][number],
  ) => {
    if (operand.kind === "localEntity") return lineIdx(operand.entityId);
    return [];
  };

  const pointDimOperandIdx = (
    operand: Extract<
      DimensionDefinition,
      { kind: "linePointDistance" }
    >["point"],
  ) => {
    if (operand.kind === "localPoint")
      return pIdx(pointRecords.get(operand.pointId));
    return [];
  };

  // cadara-p4r5.1: analytic component Jacobians. Each row's
  // `evaluateComponentJacobian` is the dual twin of its `evaluateComponents`
  // over the row's support (the variables those components read).
  const componentJacobian = (
    support: readonly number[],
    components: (columns: DualColumns) => readonly Dual[],
  ) => componentJacobianOver(parameterCount, support, components);
  const pointDual = (columns: DualColumns, point: SolverPointRecord) =>
    columns.point(point.baseIndex);
  const infiniteDuals = (columns: DualColumns, count: number) =>
    Array.from({ length: count }, () =>
      columns.constant(Number.POSITIVE_INFINITY),
    );
  const constantLineDual = (
    columns: DualColumns,
    line: { start: SketchPoint2D; end: SketchPoint2D },
  ) => ({
    start: columns.constant2(line.start),
    end: columns.constant2(line.end),
  });
  const localLineDual = (columns: DualColumns, entityId: SketchEntityId) => {
    const line = lineEntityMap.get(entityId);
    const start = line ? pointRecords.get(line.startPointId) : null;
    const end = line ? pointRecords.get(line.endPointId) : null;
    return start && end
      ? { start: pointDual(columns, start), end: pointDual(columns, end) }
      : null;
  };
  const lineDimensionOperandDual = (
    columns: DualColumns,
    operand: Extract<
      DimensionDefinition,
      { kind: "lineDistance" }
    >["lines"][number],
  ) => {
    if (operand.kind === "localEntity")
      return localLineDual(columns, operand.entityId);
    const line = resolveLineDimensionOperand(
      columns.values,
      operand,
      lineEntityMap,
      pointRecords,
      options.projectedReferences ?? [],
    );
    return line ? constantLineDual(columns, line) : null;
  };
  const pointDimensionOperandDual = (
    columns: DualColumns,
    operand: Extract<
      DimensionDefinition,
      { kind: "linePointDistance" }
    >["point"],
  ): Dual2 | null => {
    if (operand.kind === "localPoint") {
      const point = pointRecords.get(operand.pointId);
      return point ? pointDual(columns, point) : null;
    }
    const point = resolvePointDimensionOperand(
      columns.values,
      operand,
      pointRecords,
      options.projectedReferences ?? [],
    );
    return point ? columns.constant2(point) : null;
  };
  const localCircleLikeDual = (
    columns: DualColumns,
    entity: SketchEntityDefinition,
  ): { center: Dual2; radius: Dual; arc?: ArcDual } | null => {
    const center =
      entity.kind === "circle" || entity.kind === "arc"
        ? pointRecords.get(entity.centerPointId)
        : undefined;
    const state = entityStates.get(entity.entityId);
    if (entity.kind === "circle")
      return center
        ? {
            center: pointDual(columns, center),
            radius:
              state?.kind === "circle"
                ? columns.variable(state.baseIndex)
                : columns.constant(entity.radius),
          }
        : null;
    if (entity.kind !== "arc" || !center || state?.kind !== "arc") return null;
    const arc = localArcDataDual({
      center: pointDual(columns, center),
      radius: columns.variable(state.baseIndex),
      startAngle: columns.variable(state.baseIndex + 1),
      endAngle: columns.variable(state.baseIndex + 2),
      sweepDirection: entity.sweepDirection,
    });
    return { center: arc.center, radius: arc.radius, arc };
  };
  const pointOnLocalCurveResidualDual = (
    columns: DualColumns,
    point: SolverPointRecord,
    entity: SketchEntityDefinition,
  ): Dual => {
    const position = pointDual(columns, point);
    if (entity.kind === "lineSegment") {
      const line = localLineDual(columns, entity.entityId);
      return line
        ? pointLineSignedDistanceDual(position, line.start, line.end)
        : columns.constant(0);
    }
    const circleLike = localCircleLikeDual(columns, entity);
    if (!circleLike) return columns.constant(0);
    if (circleLike.arc)
      return dual2.length(
        dual2.sub(
          position,
          nearestPointOnArcSweepDual(position, circleLike.arc),
        ),
      );
    return dual.sub(
      dual2.length(dual2.sub(position, circleLike.center)),
      circleLike.radius,
    );
  };
  const localCurveComponentsDual = (
    columns: DualColumns,
    point: SolverPointRecord,
    entity: SketchEntityDefinition,
  ): readonly Dual[] => {
    const position = pointDual(columns, point);
    const circle = localCircleLikeDual(columns, entity);
    return circle?.arc
      ? dual2.sub(position, nearestPointOnArcSweepDual(position, circle.arc))
      : [pointOnLocalCurveResidualDual(columns, point, entity)];
  };
  // A projected spline never reaches these two (its point-on-curve row has
  // its own Jacobian; normal rows need a projected circle or arc).
  const pointOnProjectedCurveResidualDual = (
    position: Dual2,
    projected: ProjectedSketchReferenceGeometry,
  ): Dual => {
    if (projected.kind === "lineSegment")
      return pointLineSignedDistanceDual(
        position,
        [
          dual.constantLike(position[0], projected.startPosition[0]),
          dual.constantLike(position[0], projected.startPosition[1]),
        ],
        [
          dual.constantLike(position[0], projected.endPosition[0]),
          dual.constantLike(position[0], projected.endPosition[1]),
        ],
      );
    if (projected.kind === "arc")
      return dual2.length(
        dual2.sub(
          position,
          nearestPointOnArcSweepDual(
            position,
            projectedArcDataDual(position[0], projected),
          ),
        ),
      );
    const circleLike = projectedCircleLikeGeometry(projected);
    return circleLike
      ? dual.sub(
          dual2.length(
            dual2.sub(position, [
              dual.constantLike(position[0], circleLike.center[0]),
              dual.constantLike(position[0], circleLike.center[1]),
            ]),
          ),
          dual.constantLike(position[0], circleLike.radius),
        )
      : dual.constantLike(position[0], 0);
  };
  const projectedCurveComponentsDual = (
    position: Dual2,
    projected: ProjectedSketchReferenceGeometry,
  ): readonly Dual[] =>
    projected.kind === "arc"
      ? dual2.sub(
          position,
          nearestPointOnArcSweepDual(
            position,
            projectedArcDataDual(position[0], projected),
          ),
        )
      : [pointOnProjectedCurveResidualDual(position, projected)];
  const symmetryComponentsDual = (
    first: Dual2,
    second: Dual2,
    start: Dual2,
    end: Dual2,
  ): readonly Dual[] => {
    const unit = unitVectorDual(start, end);
    return unit
      ? [
          pointLineSignedDistanceDual(midpointDual(first, second), start, end),
          dual2.dot(dual2.sub(second, first), unit),
        ]
      : [
          dual.constantLike(first[0], Number.POSITIVE_INFINITY),
          dual.constantLike(first[0], Number.POSITIVE_INFINITY),
        ];
  };
  const normalResidualDual = (
    columns: DualColumns,
    line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
    contactPoint: Dual2,
    center: Dual2,
  ) => {
    const local = localLineDual(columns, line.entityId);
    return local
      ? lineNormalDirectionResidualDual(
          local.start,
          local.end,
          contactPoint,
          center,
        )
      : columns.constant(0);
  };
  const lineContactResidualDual = (
    columns: DualColumns,
    line: Extract<SketchEntityDefinition, { kind: "lineSegment" }>,
    contactPoint: Dual2,
  ) => {
    const local = localLineDual(columns, line.entityId);
    return local
      ? pointLineSignedDistanceDual(contactPoint, local.start, local.end)
      : columns.constant(0);
  };
  const localCollinearComponentsDual = (
    columns: DualColumns,
    target: LocalCollinearTargetOperand,
    reference: { start: Dual2; end: Dual2 },
  ): readonly Dual[] => {
    if (target.kind === "localPoint") {
      const point = pointRecords.get(target.pointId);
      return [
        point
          ? pointLineSignedDistanceDual(
              pointDual(columns, point),
              reference.start,
              reference.end,
            )
          : columns.constant(Number.POSITIVE_INFINITY),
      ];
    }
    const line = localLineDual(columns, target.entityId);
    return line
      ? [
          pointLineSignedDistanceDual(
            line.start,
            reference.start,
            reference.end,
          ),
          pointLineSignedDistanceDual(line.end, reference.start, reference.end),
        ]
      : infiniteDuals(columns, 2);
  };
  /** The poles of one span of a spline, with their derivatives per column. */
  const splineSpanPoleDuals = (
    columns: DualColumns,
    entity: Extract<SketchEntityDefinition, { kind: "spline" }>,
    selectSpan: (
      spans: ReturnType<typeof reconstructSplineAggregate>["spans"],
    ) =>
      | ReturnType<typeof reconstructSplineAggregate>["spans"][number]
      | undefined,
  ): Dual2[] | null => {
    const aggregate = currentSplineAggregate(columns.values, entity);
    const positions = currentSplinePositions(columns.values, entity);
    const span = selectSpan(
      reconstructSplineAggregate(aggregate, positions).spans,
    );
    if (!span) return null;
    const varied = columns.support.map((index) =>
      selectSpan(
        reconstructSplineAggregate(
          aggregate,
          positions,
          splineVariationForVariable(entity, index),
        ).spans,
      ),
    );
    return span.poles.map(
      (pole, poleIndex) =>
        ([0, 1] as const).map((axis) =>
          columns.fromColumns(
            pole[axis],
            varied.map(
              (variedSpan) =>
                variedSpan?.differential.poles[poleIndex]![axis] ?? 0,
            ),
          ),
        ) as unknown as Dual2,
    );
  };

  // cadara-p4r5.1: the explicit inequality rows (data only), wrapped through
  // the projection once it exists.
  const inequalityRows: {
    record: Omit<SolverInequalityRecord, "evaluate" | "variableIndices">;
    support: readonly number[];
    inequality(columns: DualColumns): Dual;
  }[] = [];
  const addArcSweepInequalities = (
    requirementId: ConstraintId,
    componentIndex: number,
    entityId: SketchEntityId | null,
    support: readonly number[],
    contactOnArc: (
      columns: DualColumns,
    ) => { contact: Dual2; arc: ArcDual } | null,
  ) => {
    for (const [side, kind] of [
      [0, "arcSweepStart"],
      [1, "arcSweepEnd"],
    ] as const)
      inequalityRows.push({
        record: {
          id: `${kind}_${requirementId}_${componentIndex}`,
          kind,
          entityId,
          requirement: { id: requirementId, componentIndex },
        },
        support,
        inequality: (columns) => {
          const located = contactOnArc(columns);
          return located
            ? arcSweepMarginsDual(located.contact, located.arc)[side]
            : columns.fromColumns(
                Number.NaN,
                columns.support.map(() => Number.NaN),
              );
        },
      });
  };

  const offsetSeedArcIds = new Set(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "offset" ? relationship.seedEntityIds : [],
    ),
  );
  // cadara-p4r5.1: the first-order tangency rows (data only), wrapped
  // through the projection once it exists.
  const orientedTangencyRows: {
    record: Omit<SolverOrientedTangencyRecord, "evaluate" | "variableIndices">;
    support: readonly number[];
    component(columns: DualColumns): Dual;
  }[] = [];
  // Each point's class under the coincident constraints (transitively).
  const coincidentClasses = new Map<
    SketchPointId,
    ReadonlySet<SketchPointId>
  >();
  for (const constraint of definition.constraints) {
    if (constraint.kind !== "coincident") continue;
    const joined = new Set(
      constraint.pointIds.flatMap((pointId) => [
        ...(coincidentClasses.get(pointId) ?? [pointId]),
      ]),
    );
    for (const pointId of joined) coincidentClasses.set(pointId, joined);
  }
  const sameLocation = (first: SketchPointId, second: SketchPointId) =>
    first === second || coincidentClasses.get(first)?.has(second) === true;
  return {
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    pIdx,
    componentJacobian,
    pointDual,
    infiniteDuals,
    entityStates,
    options,
    pointOnProjectedCurveResidual,
    projectedCurveComponents,
    projectedCurveComponentsDual,
    definition,
    createSplinePointConstraint,
    createShellPointConstraint,
    pointOnLocalCurveResidual,
    localCurveComponents,
    entityIdx,
    localCurveComponentsDual,
    lineIdx,
    collinearTargetIdx,
    localLineDual,
    localCollinearComponentsDual,
    constantLineDual,
    getLocalCircleLike,
    eIdx,
    localCircleLikeDual,
    addArcSweepInequalities,
    reconstructCurrentSpline,
    splineSpanPoleDuals,
    offsetSeedArcIds,
    orientedTangencyRows,
    sameLocation,
    normalResidual,
    lineContactResidual,
    normalResidualDual,
    lineContactResidualDual,
    symmetryComponents,
    symmetricResidual,
    symmetryComponentsDual,
    initialValues,
    arcEntityMap,
    lineDimOperandIdx,
    pointDimOperandIdx,
    lineDimensionOperandDual,
    pointDimensionOperandDual,
    splineTangentStates,
    inequalityRows,
  };
}
