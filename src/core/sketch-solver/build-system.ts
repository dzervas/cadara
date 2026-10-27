import type { ArcDual } from "./analytic-residuals";
import {
  arcSweepMarginsDual,
  arcSweepViolationDual,
  closestPointResidualDuals,
  componentJacobianOver,
  createNumericalScalarConstraint,
  lineAngleRadiansDual,
  lineNormalDirectionResidualDual,
  lineParallelResidualDual,
  localArcDataDual,
  localCircleTangencyContactsDual,
  midpointDual,
  nearestPointOnArcSweepDual,
  pointLineSignedDistanceDual,
  projectedArcDataDual,
  unitVectorDual,
} from "./analytic-residuals";
import {
  getLocalCircleLikeGeometry,
  localArcData,
  localArcSweepViolation,
  localCircleTangencyContacts,
  nearestPointOnLocalArcSweep,
  splineArcEndpointTangency,
} from "./arc-geometry";
import { dual, dual2, dualColumns } from "./automatic-differentiation";
import type { Dual, Dual2, DualColumns } from "./automatic-differentiation";
import {
  structuralEquationVariableIndexMap,
  uniqueSortedIndices,
} from "./compile-components";
import { getEntityPoints } from "./entity-points";
import {
  lineAngleRadians,
  lineNormalDirectionResidual,
  lineParallelResidual,
  linesParallelWithinTolerance,
  localCollinearComponents,
  localCollinearResidual,
  pointLineSignedDistance,
  resolveLineDimensionOperand,
  resolveLocalLineOperand,
  resolvePointDimensionOperand,
  resolveReadOnlyLineOperand,
} from "./line-residuals";
import {
  createDerivedParameterProjection,
  midpoint,
  splineTangentStateKey,
} from "./parameter-projection";
import {
  findProjectedGeometry,
  nearestPointOnProjectedArcSweep,
  pointProjectedArcDistance,
  projectedArcData,
  projectedArcSweepViolation,
  projectedCircleLikeGeometry,
  resolveSketchDatumLine,
  resolveSketchDatumPoint,
  unitVector,
} from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import {
  add,
  addPointGradient,
  dot2,
  getArcParameters,
  getCircleRadius,
  getDrivingDimensionValue,
  getPoint,
  halfSquaredDistanceWithSaturation,
  length,
  subtract,
  zeroVector,
} from "./solver-geometry";
import type {
  BuildSystemOptions,
  BuildSystemResult,
  OffsetRequirementBlocker,
  ScalarConstraintEvaluation,
  ScalarConstraintRecord,
  SolverEntityState,
  SolverInequalityRecord,
  SolverOrientedTangencyRecord,
  SolverPointRecord,
  SplineTangentState,
} from "./system-types";
import type {
  ConstraintId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { offsetRecordDerivatives } from "@/contracts/sketch/derived-geometry";
import {
  localQueryDomain,
  offsetFrameCurveResidual,
} from "@/contracts/sketch/offset-derivation-frame";
import type { OffsetFrameVariation } from "@/contracts/sketch/offset-derivation-frame";
import type {
  ConstraintDefinition,
  NumericDimensionDefinition as DimensionDefinition,
  LocalCollinearTargetOperand,
  NumericSketchDefinition as SketchDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";
import {
  closestSplineSpanLocation,
  evaluateSplineSpan,
  orderedSplineOccurrences,
  reconstructSplineAggregate,
} from "@/contracts/sketch/spline-geometry";
import type { SplinePoles } from "@/contracts/sketch/spline-geometry";
import type { ProjectedSketchReferenceGeometry } from "@/contracts/solver/schema";

export function buildSystem(
  definition: SketchDefinition,
  options: BuildSystemOptions,
): BuildSystemResult {
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
      if (parameterProjection.failedAtSolveStart(shell.derivationId))
        return blocked("failed");
      const record = parameterProjection
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
        const record = parameterProjection
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
        const record = parameterProjection
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
  for (const entity of definition.entities) {
    if (entity.kind !== "arc" || !offsetSeedArcIds.has(entity.entityId)) {
      continue;
    }
    const center = pointRecords.get(entity.centerPointId);
    const start = pointRecords.get(entity.startPointId);
    const end = pointRecords.get(entity.endPointId);
    if (!center || !start || !end) continue;

    scalarConstraints.push({
      id: `constraint_internal_arc_common_radius_${entity.entityId}` as ConstraintId,
      targetKind: "constraint",
      structuralVariableIndices: pIdx(center, start, end),
      evaluateComponentJacobian: componentJacobian(
        pIdx(center, start, end),
        (columns) => {
          const origin = pointDual(columns, center);
          return [
            dual.sub(
              dual2.length(dual2.sub(pointDual(columns, end), origin)),
              dual2.length(dual2.sub(pointDual(columns, start), origin)),
            ),
          ];
        },
      ),
      evaluateComponents(values) {
        const origin = getPoint(values, center);
        return [
          length(subtract(getPoint(values, end), origin)) -
            length(subtract(getPoint(values, start), origin)),
        ];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const centerPosition = getPoint(values, center);
        const startOffset = subtract(getPoint(values, start), centerPosition);
        const endOffset = subtract(getPoint(values, end), centerPosition);
        const startRadius = length(startOffset);
        const endRadius = length(endOffset);
        if (
          startRadius <= DEGENERATE_NORM_EPSILON ||
          endRadius <= DEGENERATE_NORM_EPSILON
        ) {
          return { residual: Number.POSITIVE_INFINITY, gradient };
        }
        const delta = endRadius - startRadius;
        const startUnit: SketchPoint2D = [
          startOffset[0] / startRadius,
          startOffset[1] / startRadius,
        ];
        const endUnit: SketchPoint2D = [
          endOffset[0] / endRadius,
          endOffset[1] / endRadius,
        ];
        addPointGradient(
          gradient,
          center,
          delta * (startUnit[0] - endUnit[0]),
          delta * (startUnit[1] - endUnit[1]),
        );
        addPointGradient(
          gradient,
          start,
          -delta * startUnit[0],
          -delta * startUnit[1],
        );
        addPointGradient(gradient, end, delta * endUnit[0], delta * endUnit[1]);
        return { residual: 0.5 * delta * delta, gradient };
      },
    });
  }

  for (const constraint of definition.constraints) {
    if (constraint.kind === "equalOffset") {
      if (
        constraint.pairs.some(
          (pair) => pair.seedEntityId === pair.offsetEntityId,
        )
      ) {
        continue;
      }
      const pairLines = constraint.pairs.map((pair) => ({
        pair,
        seed: lineEntityMap.get(pair.seedEntityId),
        offset: lineEntityMap.get(pair.offsetEntityId),
      }));
      if (pairLines.some(({ seed, offset }) => !seed || !offset)) {
        continue;
      }

      const records = pairLines.map(({ pair, seed, offset }) => ({
        pair,
        seedStart: pointRecords.get(seed!.startPointId),
        seedEnd: pointRecords.get(seed!.endPointId),
        offsetStart: pointRecords.get(offset!.startPointId),
        offsetEnd: pointRecords.get(offset!.endPointId),
      }));
      if (
        records.some(
          ({ seedStart, seedEnd, offsetStart, offsetEnd }) =>
            !seedStart || !seedEnd || !offsetStart || !offsetEnd,
        )
      ) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(
          records.flatMap((record) =>
            pIdx(
              record.seedStart,
              record.seedEnd,
              record.offsetStart,
              record.offsetEnd,
            ),
          ),
          (columns) => {
            const pairs = records.map((record) => {
              const seedStart = pointDual(columns, record.seedStart!);
              const seedEnd = pointDual(columns, record.seedEnd!);
              const offsetStart = pointDual(columns, record.offsetStart!);
              const offsetEnd = pointDual(columns, record.offsetEnd!);
              const seedUnit = unitVectorDual(seedStart, seedEnd);
              const offsetUnit = unitVectorDual(offsetStart, offsetEnd);
              if (!seedUnit || !offsetUnit) return infiniteDuals(columns, 2);
              return [
                dual2.cross(seedUnit, offsetUnit),
                dual.scale(
                  dual2.dot(
                    [dual.neg(seedUnit[1]), seedUnit[0]],
                    dual2.sub(offsetStart, seedStart),
                  ),
                  record.pair.side === "left" ? 1 : -1,
                ),
              ];
            });
            return [
              pairs[0]![0]!,
              pairs[1]![0]!,
              dual.sub(pairs[0]![1]!, pairs[1]![1]!),
            ];
          },
        ),
        evaluateComponents(values) {
          const pairs = records.map((record) => {
            const seedStart = getPoint(values, record.seedStart!);
            const seedEnd = getPoint(values, record.seedEnd!);
            const offsetStart = getPoint(values, record.offsetStart!);
            const offsetEnd = getPoint(values, record.offsetEnd!);
            const seedUnit = unitVector(seedStart, seedEnd);
            const offsetUnit = unitVector(offsetStart, offsetEnd);
            if (!seedUnit || !offsetUnit) return [Infinity, Infinity];
            return [
              seedUnit[0] * offsetUnit[1] - seedUnit[1] * offsetUnit[0],
              (record.pair.side === "left" ? 1 : -1) *
                dot2(
                  [-seedUnit[1], seedUnit[0]],
                  subtract(offsetStart, seedStart),
                ),
            ];
          });
          return [pairs[0]![0]!, pairs[1]![0]!, pairs[0]![1]! - pairs[1]![1]!];
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const evaluations = records.map((record) => {
            const seedStart = record.seedStart!;
            const seedEnd = record.seedEnd!;
            const offsetStart = record.offsetStart!;
            const offsetEnd = record.offsetEnd!;
            const seedVector = subtract(
              getPoint(values, seedEnd),
              getPoint(values, seedStart),
            );
            const offsetVector = subtract(
              getPoint(values, offsetEnd),
              getPoint(values, offsetStart),
            );
            const seedLength = length(seedVector);
            const offsetLength = length(offsetVector);
            if (
              !Number.isFinite(seedLength) ||
              !Number.isFinite(offsetLength) ||
              seedLength < DEGENERATE_NORM_EPSILON ||
              offsetLength < DEGENERATE_NORM_EPSILON
            ) {
              return null;
            }

            const seedUnit: SketchPoint2D = [
              seedVector[0] / seedLength,
              seedVector[1] / seedLength,
            ];
            const offsetUnit: SketchPoint2D = [
              offsetVector[0] / offsetLength,
              offsetVector[1] / offsetLength,
            ];
            const seedNormal: SketchPoint2D = [-seedUnit[1], seedUnit[0]];
            const side = record.pair.side === "left" ? 1 : -1;
            const startDelta = subtract(
              getPoint(values, offsetStart),
              getPoint(values, seedStart),
            );
            const distance = side * dot2(seedNormal, startDelta);

            const seedUnitJacobian = [
              [
                (1 - seedUnit[0] * seedUnit[0]) / seedLength,
                -(seedUnit[0] * seedUnit[1]) / seedLength,
              ],
              [
                -(seedUnit[0] * seedUnit[1]) / seedLength,
                (1 - seedUnit[1] * seedUnit[1]) / seedLength,
              ],
            ] as const;
            const offsetUnitJacobian = [
              [
                (1 - offsetUnit[0] * offsetUnit[0]) / offsetLength,
                -(offsetUnit[0] * offsetUnit[1]) / offsetLength,
              ],
              [
                -(offsetUnit[0] * offsetUnit[1]) / offsetLength,
                (1 - offsetUnit[1] * offsetUnit[1]) / offsetLength,
              ],
            ] as const;

            const parallel =
              seedUnit[0] * offsetUnit[1] - seedUnit[1] * offsetUnit[0];
            const parallelSeedUnitGradient: SketchPoint2D = [
              offsetUnit[1],
              -offsetUnit[0],
            ];
            const parallelOffsetUnitGradient: SketchPoint2D = [
              -seedUnit[1],
              seedUnit[0],
            ];
            const parallelSeedVectorGradient: SketchPoint2D = [
              parallelSeedUnitGradient[0] * seedUnitJacobian[0][0] +
                parallelSeedUnitGradient[1] * seedUnitJacobian[1][0],
              parallelSeedUnitGradient[0] * seedUnitJacobian[0][1] +
                parallelSeedUnitGradient[1] * seedUnitJacobian[1][1],
            ];
            const parallelOffsetVectorGradient: SketchPoint2D = [
              parallelOffsetUnitGradient[0] * offsetUnitJacobian[0][0] +
                parallelOffsetUnitGradient[1] * offsetUnitJacobian[1][0],
              parallelOffsetUnitGradient[0] * offsetUnitJacobian[0][1] +
                parallelOffsetUnitGradient[1] * offsetUnitJacobian[1][1],
            ];

            const rotatedDelta: SketchPoint2D = [startDelta[1], -startDelta[0]];
            const distanceSeedVectorGradient: SketchPoint2D = [
              side *
                (seedUnitJacobian[0][0] * rotatedDelta[0] +
                  seedUnitJacobian[0][1] * rotatedDelta[1]),
              side *
                (seedUnitJacobian[1][0] * rotatedDelta[0] +
                  seedUnitJacobian[1][1] * rotatedDelta[1]),
            ];
            const distanceDeltaGradient: SketchPoint2D = [
              side * seedNormal[0],
              side * seedNormal[1],
            ];

            return {
              distance,
              parallel,
              seedStart,
              seedEnd,
              offsetStart,
              offsetEnd,
              parallelSeedVectorGradient,
              parallelOffsetVectorGradient,
              distanceSeedVectorGradient,
              distanceDeltaGradient,
            };
          });

          const first = evaluations[0];
          const second = evaluations[1];
          if (!first || !second) {
            return { residual: Number.POSITIVE_INFINITY, gradient };
          }

          for (const evaluation of evaluations as [
            NonNullable<typeof first>,
            NonNullable<typeof second>,
          ]) {
            addPointGradient(
              gradient,
              evaluation.seedStart,
              -evaluation.parallel * evaluation.parallelSeedVectorGradient[0],
              -evaluation.parallel * evaluation.parallelSeedVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.seedEnd,
              evaluation.parallel * evaluation.parallelSeedVectorGradient[0],
              evaluation.parallel * evaluation.parallelSeedVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.offsetStart,
              -evaluation.parallel * evaluation.parallelOffsetVectorGradient[0],
              -evaluation.parallel * evaluation.parallelOffsetVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.offsetEnd,
              evaluation.parallel * evaluation.parallelOffsetVectorGradient[0],
              evaluation.parallel * evaluation.parallelOffsetVectorGradient[1],
            );
          }

          const distanceDelta = first.distance - second.distance;
          const distanceScales = [distanceDelta, -distanceDelta] as const;
          evaluations.forEach((evaluation, index) => {
            if (!evaluation) return;
            const scale = distanceScales[index]!;
            addPointGradient(
              gradient,
              evaluation.seedStart,
              scale *
                (-evaluation.distanceSeedVectorGradient[0] -
                  evaluation.distanceDeltaGradient[0]),
              scale *
                (-evaluation.distanceSeedVectorGradient[1] -
                  evaluation.distanceDeltaGradient[1]),
            );
            addPointGradient(
              gradient,
              evaluation.seedEnd,
              scale * evaluation.distanceSeedVectorGradient[0],
              scale * evaluation.distanceSeedVectorGradient[1],
            );
            addPointGradient(
              gradient,
              evaluation.offsetStart,
              scale * evaluation.distanceDeltaGradient[0],
              scale * evaluation.distanceDeltaGradient[1],
            );
          });

          return {
            residual:
              0.5 *
              (first.parallel * first.parallel +
                second.parallel * second.parallel +
                distanceDelta * distanceDelta),
            gradient,
          };
        },
      });
      continue;
    }

    if (constraint.kind === "coincident") {
      const left = pointRecords.get(constraint.pointIds[0]);
      const right = pointRecords.get(constraint.pointIds[1]);
      if (!left || !right) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(
          pIdx(left, right),
          (columns) =>
            dual2.sub(pointDual(columns, left), pointDual(columns, right)),
        ),
        evaluateComponents(values) {
          return subtract(getPoint(values, left), getPoint(values, right));
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, left);
          const b = getPoint(values, right);
          const delta = subtract(a, b);
          addPointGradient(gradient, left, delta[0], delta[1]);
          addPointGradient(gradient, right, -delta[0], -delta[1]);
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
      continue;
    }

    if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
      const line = lineEntityMap.get(constraint.entityId);
      if (!line) {
        continue;
      }
      const start = pointRecords.get(line.startPointId);
      const end = pointRecords.get(line.endPointId);
      if (!start || !end) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(
          pIdx(start, end),
          (columns) => [
            dual2.sub(pointDual(columns, end), pointDual(columns, start))[
              constraint.kind === "horizontal" ? 1 : 0
            ],
          ],
        ),
        evaluateComponents(values) {
          const delta = subtract(
            getPoint(values, end),
            getPoint(values, start),
          );
          return [delta[constraint.kind === "horizontal" ? 1 : 0]];
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, start);
          const b = getPoint(values, end);
          if (constraint.kind === "horizontal") {
            const dy = b[1] - a[1];
            addPointGradient(gradient, start, 0, -dy);
            addPointGradient(gradient, end, 0, dy);
            return { residual: 0.5 * dy * dy, gradient };
          }

          const dx = b[0] - a[0];
          addPointGradient(gradient, start, -dx, 0);
          addPointGradient(gradient, end, dx, 0);
          return { residual: 0.5 * dx * dx, gradient };
        },
      });
      continue;
    }

    if (constraint.kind === "fixPoint") {
      const point = pointRecords.get(constraint.pointId);
      if (!point) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
          dual2.sub(
            pointDual(columns, point),
            columns.constant2(constraint.position),
          ),
        ),
        evaluateComponents(values) {
          return subtract(getPoint(values, point), constraint.position);
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const actual = getPoint(values, point);
          const delta = subtract(actual, constraint.position);
          addPointGradient(gradient, point, delta[0], delta[1]);
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
      continue;
    }

    if (constraint.kind === "angle") {
      const point1 = pointRecords.get(constraint.pointIds[0]);
      const point2 = pointRecords.get(constraint.pointIds[1]);
      const middle = pointRecords.get(constraint.pointIds[2]);
      if (!point1 || !point2 || !middle) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(
          pIdx(point1, point2, middle),
          (columns) => {
            const a = dual2.sub(
              pointDual(columns, point1),
              pointDual(columns, middle),
            );
            const b = dual2.sub(
              pointDual(columns, point2),
              pointDual(columns, middle),
            );
            const lengths = dual.mul(dual2.length(a), dual2.length(b));
            if (
              constraint.valueRadians === 0 ||
              constraint.valueRadians === Math.PI
            )
              return [dual.div(dual2.cross(a, b), lengths)];
            return [
              dual.sub(
                dual.acosClamped(dual.div(dual2.dot(a, b), lengths)),
                columns.constant(constraint.valueRadians),
              ),
            ];
          },
        ),
        evaluateComponents(values) {
          const a = subtract(
            getPoint(values, point1),
            getPoint(values, middle),
          );
          const b = subtract(
            getPoint(values, point2),
            getPoint(values, middle),
          );
          // acos is even at 0 and pi; its central difference there vanishes.
          // The signed sine has the same local zero set and retains the angular row.
          if (
            constraint.valueRadians === 0 ||
            constraint.valueRadians === Math.PI
          )
            return [(a[0] * b[1] - a[1] * b[0]) / (length(a) * length(b))];
          return [
            Math.acos(
              Math.max(-1, Math.min(1, dot2(a, b) / (length(a) * length(b)))),
            ) - constraint.valueRadians,
          ];
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const p1 = getPoint(values, point1);
          const p2 = getPoint(values, point2);
          const pm = getPoint(values, middle);
          const d1 = subtract(p1, pm);
          const d2 = subtract(p2, pm);
          const norm1 = length(d1);
          const norm2 = length(d2);
          if (
            norm1 < DEGENERATE_NORM_EPSILON ||
            norm2 < DEGENERATE_NORM_EPSILON
          ) {
            return {
              residual: 0.5 * constraint.valueRadians * constraint.valueRadians,
              gradient,
            };
          }

          const dotValue = d1[0] * d2[0] + d1[1] * d2[1];
          const cosTheta = Math.max(
            -1,
            Math.min(1, dotValue / (norm1 * norm2)),
          );
          const theta = Math.acos(cosTheta);
          const lossGradient = theta - constraint.valueRadians;
          const denom = Math.sqrt(Math.max(1e-12, 1 - cosTheta * cosTheta));
          const gradThetaFromCos = -1 / denom;

          const gradCosFromD1X =
            d2[0] / (norm1 * norm2) -
            (dotValue * d1[0]) / (norm1 * norm1 * norm1 * norm2);
          const gradCosFromD1Y =
            d2[1] / (norm1 * norm2) -
            (dotValue * d1[1]) / (norm1 * norm1 * norm1 * norm2);
          const gradCosFromD2X =
            d1[0] / (norm1 * norm2) -
            (dotValue * d2[0]) / (norm1 * norm2 * norm2 * norm2);
          const gradCosFromD2Y =
            d1[1] / (norm1 * norm2) -
            (dotValue * d2[1]) / (norm1 * norm2 * norm2 * norm2);

          const scaleFactor = lossGradient * gradThetaFromCos;
          addPointGradient(
            gradient,
            point1,
            scaleFactor * gradCosFromD1X,
            scaleFactor * gradCosFromD1Y,
          );
          addPointGradient(
            gradient,
            point2,
            scaleFactor * gradCosFromD2X,
            scaleFactor * gradCosFromD2Y,
          );
          addPointGradient(
            gradient,
            middle,
            -scaleFactor * (gradCosFromD1X + gradCosFromD2X),
            -scaleFactor * (gradCosFromD1Y + gradCosFromD2Y),
          );
          const residual = 0.5 * lossGradient * lossGradient;
          return { residual, gradient };
        },
      });
      continue;
    }

    if (constraint.kind === "equalLength") {
      const a = entityStates.get(constraint.entityIds[0]);
      const b = entityStates.get(constraint.entityIds[1]);
      if (a?.kind === "circle" && b?.kind === "circle") {
        scalarConstraints.push({
          id: constraint.constraintId,
          targetKind: "constraint",
          evaluateComponentJacobian: componentJacobian(
            [a.baseIndex, b.baseIndex],
            (columns) => [
              dual.sub(
                columns.variable(a.baseIndex),
                columns.variable(b.baseIndex),
              ),
            ],
          ),
          evaluateComponents(values) {
            return [getCircleRadius(values, a) - getCircleRadius(values, b)];
          },
          evaluate(values) {
            const gradient = zeroVector(parameterCount);
            const difference =
              getCircleRadius(values, a) - getCircleRadius(values, b);
            gradient[a.baseIndex] += difference;
            gradient[b.baseIndex] -= difference;
            return { residual: 0.5 * difference * difference, gradient };
          },
        });
        continue;
      }
    }

    if (
      constraint.kind === "parallel" ||
      constraint.kind === "perpendicular" ||
      constraint.kind === "equalLength"
    ) {
      const lineA = lineEntityMap.get(constraint.entityIds[0]);
      const lineB = lineEntityMap.get(constraint.entityIds[1]);
      if (!lineA || !lineB) {
        continue;
      }
      const a0 = pointRecords.get(lineA.startPointId);
      const a1 = pointRecords.get(lineA.endPointId);
      const b0 = pointRecords.get(lineB.startPointId);
      const b1 = pointRecords.get(lineB.endPointId);
      if (!a0 || !a1 || !b0 || !b1) {
        continue;
      }

      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(
          pIdx(a0, a1, b0, b1),
          (columns) => {
            const da = dual2.sub(
              pointDual(columns, a1),
              pointDual(columns, a0),
            );
            const db = dual2.sub(
              pointDual(columns, b1),
              pointDual(columns, b0),
            );
            const na = dual2.length(da),
              nb = dual2.length(db);
            if (constraint.kind === "equalLength") return [dual.sub(na, nb)];
            return [
              dual.div(
                constraint.kind === "parallel"
                  ? dual2.cross(da, db)
                  : dual2.dot(da, db),
                dual.mul(na, nb),
              ),
            ];
          },
        ),
        evaluateComponents(values) {
          const da = subtract(getPoint(values, a1), getPoint(values, a0));
          const db = subtract(getPoint(values, b1), getPoint(values, b0));
          const na = length(da),
            nb = length(db);
          if (constraint.kind === "equalLength") return [na - nb];
          return [
            constraint.kind === "parallel"
              ? (da[0] * db[1] - da[1] * db[0]) / (na * nb)
              : dot2(da, db) / (na * nb),
          ];
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const pa0 = getPoint(values, a0);
          const pa1 = getPoint(values, a1);
          const pb0 = getPoint(values, b0);
          const pb1 = getPoint(values, b1);
          const da = subtract(pa1, pa0);
          const db = subtract(pb1, pb0);
          const na = length(da);
          const nb = length(db);
          if (na < DEGENERATE_NORM_EPSILON || nb < DEGENERATE_NORM_EPSILON) {
            return { residual: 0, gradient };
          }

          if (constraint.kind === "equalLength") {
            const diff = na - nb;
            const dNa = [da[0] / na, da[1] / na] as const;
            const dNb = [db[0] / nb, db[1] / nb] as const;
            addPointGradient(gradient, a0, -diff * dNa[0], -diff * dNa[1]);
            addPointGradient(gradient, a1, diff * dNa[0], diff * dNa[1]);
            addPointGradient(gradient, b0, diff * dNb[0], diff * dNb[1]);
            addPointGradient(gradient, b1, -diff * dNb[0], -diff * dNb[1]);
            return { residual: 0.5 * diff * diff, gradient };
          }

          const ua = [da[0] / na, da[1] / na] as const;
          const ub = [db[0] / nb, db[1] / nb] as const;
          const residualValue =
            constraint.kind === "parallel"
              ? ua[0] * ub[1] - ua[1] * ub[0]
              : ua[0] * ub[0] + ua[1] * ub[1];

          const hA = [
            [
              1 / na - (da[0] * da[0]) / (na * na * na),
              -(da[0] * da[1]) / (na * na * na),
            ],
            [
              -(da[0] * da[1]) / (na * na * na),
              1 / na - (da[1] * da[1]) / (na * na * na),
            ],
          ] as const;
          const hB = [
            [
              1 / nb - (db[0] * db[0]) / (nb * nb * nb),
              -(db[0] * db[1]) / (nb * nb * nb),
            ],
            [
              -(db[0] * db[1]) / (nb * nb * nb),
              1 / nb - (db[1] * db[1]) / (nb * nb * nb),
            ],
          ] as const;

          const gradResidualUa =
            constraint.kind === "parallel"
              ? ([ub[1], -ub[0]] as const)
              : ([ub[0], ub[1]] as const);
          const gradResidualUb =
            constraint.kind === "parallel"
              ? ([-ua[1], ua[0]] as const)
              : ([ua[0], ua[1]] as const);

          const gradResidualDa = [
            gradResidualUa[0] * hA[0][0] + gradResidualUa[1] * hA[1][0],
            gradResidualUa[0] * hA[0][1] + gradResidualUa[1] * hA[1][1],
          ] as const;
          const gradResidualDb = [
            gradResidualUb[0] * hB[0][0] + gradResidualUb[1] * hB[1][0],
            gradResidualUb[0] * hB[0][1] + gradResidualUb[1] * hB[1][1],
          ] as const;

          addPointGradient(
            gradient,
            a0,
            -residualValue * gradResidualDa[0],
            -residualValue * gradResidualDa[1],
          );
          addPointGradient(
            gradient,
            a1,
            residualValue * gradResidualDa[0],
            residualValue * gradResidualDa[1],
          );
          addPointGradient(
            gradient,
            b0,
            -residualValue * gradResidualDb[0],
            -residualValue * gradResidualDb[1],
          );
          addPointGradient(
            gradient,
            b1,
            residualValue * gradResidualDb[0],
            residualValue * gradResidualDb[1],
          );
          return { residual: 0.5 * residualValue * residualValue, gradient };
        },
      });
    }

    if (constraint.kind === "coincidentProjectedPoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const targetPoint =
        constraint.projectedPoint.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedPoint.reference,
              );
              return projected?.kind === "point" ? projected.position : null;
            })()
          : resolveSketchDatumPoint(constraint.projectedPoint.datum);

      if (!point || !targetPoint) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(point),
          evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
            dual2.sub(
              pointDual(columns, point),
              columns.constant2(targetPoint),
            ),
          ),
          evaluateComponents(values) {
            return subtract(getPoint(values, point), targetPoint);
          },
          evaluateResidual(values) {
            return length(subtract(getPoint(values, point), targetPoint));
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "pointOnProjectedCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const projected =
        constraint.projectedCurve.kind === "projectedGeometry"
          ? findProjectedGeometry(
              options.projectedReferences ?? [],
              constraint.projectedCurve.reference,
            )
          : null;
      const datumLine =
        constraint.projectedCurve.kind === "sketchDatum"
          ? resolveSketchDatumLine(constraint.projectedCurve.datum)
          : null;

      if (
        !point || (!projected && !datumLine) || projected?.kind === "point" ||
        (projected?.kind === "spline" && projected.representation.kind === "sourceSamples")
      ) {
        continue;
      }

      if (
        projected?.kind === "spline" &&
        projected.representation.kind === "neutralCubicSpans"
      ) {
        const projectedSpans = projected.representation.spans;
        scalarConstraints.push({
          id: constraint.constraintId,
          targetKind: "constraint",
          evaluateComponentJacobian(values) {
            const columns = dualColumns(values, pIdx(point));
            const position = getPoint(values, point);
            const closest = closestSplineSpanLocation(position, projectedSpans);
            if (!closest)
              return columns.jacobian(
                infiniteDuals(columns, 2),
                parameterCount,
              );
            const evaluated = evaluateSplineSpan(
              projectedSpans[closest.spanIndex]!,
              { kind: "local", value: closest.u },
            );
            return columns.jacobian(
              closestPointResidualDuals({
                residual: subtract(position, evaluated.position),
                atDomainEnd: closest.u === 0 || closest.u === 1,
                first: evaluated.first,
                second: evaluated.second,
                columns: 2,
                dPoint: (column) => (column === 0 ? [1, 0] : [0, 1]),
                dCurve: () => [0, 0],
                dFirst: () => [0, 0],
              }),
              parameterCount,
            );
          },
          evaluateComponents(values) {
            const position = getPoint(values, point);
            const closest = closestSplineSpanLocation(position, projectedSpans);
            if (!closest) return [Infinity, Infinity];
            const evaluated = evaluateSplineSpan(
              projectedSpans[closest.spanIndex]!,
              { kind: "local", value: closest.u },
            );
            return subtract(position, evaluated.position);
          },

          evaluate(values) {
            const gradient = zeroVector(parameterCount);
            const position = getPoint(values, point);
            const closest = closestSplineSpanLocation(position, projectedSpans);
            if (!closest)
              return { residual: Number.POSITIVE_INFINITY, gradient };
            const evaluated = evaluateSplineSpan(
              projectedSpans[closest.spanIndex]!,
              { kind: "local", value: closest.u },
            );
            const delta = subtract(position, evaluated.position);
            addPointGradient(gradient, point, delta[0], delta[1]);
            return {
              residual: halfSquaredDistanceWithSaturation(
                closest.distanceSquared,
              ),
              gradient,
            };
          },
        });
      } else {
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: pIdx(point),
            evaluateComponentJacobian: componentJacobian(
              pIdx(point),
              (columns) =>
                projected
                  ? projectedCurveComponentsDual(
                      pointDual(columns, point),
                      projected,
                    )
                  : [
                      pointLineSignedDistanceDual(
                        pointDual(columns, point),
                        columns.constant2(datumLine!.start),
                        columns.constant2(datumLine!.end),
                      ),
                    ],
            ),
            evaluateComponents(values) {
              return projected
                ? projectedCurveComponents(getPoint(values, point), projected)
                : [
                    pointLineSignedDistance(
                      getPoint(values, point),
                      datumLine!.start,
                      datumLine!.end,
                    ),
                  ];
            },
            evaluateResidual(values) {
              return projected
                ? pointOnProjectedCurveResidual(
                    getPoint(values, point),
                    projected,
                  )
                : Math.abs(
                    pointLineSignedDistance(
                      getPoint(values, point),
                      datumLine!.start,
                      datumLine!.end,
                    ),
                  );
            },
          }),
        );
      }
      continue;
    }

    if (constraint.kind === "midpoint") {
      const point = pointRecords.get(constraint.point.pointId);
      const line = lineEntityMap.get(constraint.line.entityId);
      const start = line ? pointRecords.get(line.startPointId) : null;
      const end = line ? pointRecords.get(line.endPointId) : null;

      if (!point || !line || !start || !end) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(point, start, end),
          evaluateComponentJacobian: componentJacobian(
            pIdx(point, start, end),
            (columns) =>
              dual2.sub(
                pointDual(columns, point),
                midpointDual(
                  pointDual(columns, start),
                  pointDual(columns, end),
                ),
              ),
          ),
          evaluateComponents(values) {
            return subtract(
              getPoint(values, point),
              midpoint(getPoint(values, start), getPoint(values, end)),
            );
          },
          evaluateResidual(values) {
            const target = midpoint(
              getPoint(values, start),
              getPoint(values, end),
            );
            return length(subtract(getPoint(values, point), target));
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "midpointProjectedLine") {
      const point = pointRecords.get(constraint.point.pointId);
      const projectedLine =
        constraint.projectedLine.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedLine.reference,
              );
              return projected?.kind === "lineSegment"
                ? { start: projected.startPosition, end: projected.endPosition }
                : null;
            })()
          : resolveSketchDatumLine(constraint.projectedLine.datum);

      if (!point || !projectedLine) {
        continue;
      }

      const target = midpoint(projectedLine.start, projectedLine.end);
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(point),
          evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
            dual2.sub(pointDual(columns, point), columns.constant2(target)),
          ),
          evaluateComponents(values) {
            return subtract(getPoint(values, point), target);
          },
          evaluateResidual(values) {
            return length(subtract(getPoint(values, point), target));
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "pointOnCurve") {
      const point = pointRecords.get(constraint.point.pointId);
      const curve = definition.entities.find(
        (entity) => entity.entityId === constraint.curve.entityId,
      );

      if (point && curve?.kind === "derivedPiecewiseCubic") {
        scalarConstraints.push(
          createShellPointConstraint(constraint, point, curve),
        );
        continue;
      }

      if (
        !point ||
        !curve ||
        (curve.kind !== "lineSegment" &&
          curve.kind !== "circle" &&
          curve.kind !== "arc" &&
          curve.kind !== "spline")
      ) {
        continue;
      }

      scalarConstraints.push(
        curve.kind === "spline"
          ? createSplinePointConstraint(constraint, point, curve)
          : createNumericalScalarConstraint({
              id: constraint.constraintId,
              targetKind: "constraint",
              parameterCount,
              affectedVariableIndices: [
                ...pIdx(point),
                ...entityIdx(curve.entityId),
              ],
              evaluateComponentJacobian: componentJacobian(
                [...pIdx(point), ...entityIdx(curve.entityId)],
                (columns) => localCurveComponentsDual(columns, point, curve),
              ),
              evaluateComponents(values) {
                return localCurveComponents(values, point, curve);
              },
              evaluateResidual(values) {
                return pointOnLocalCurveResidual(values, point, curve);
              },
            }),
      );
      continue;
    }

    if (constraint.kind === "collinear") {
      if (
        (constraint.target.kind === "localEntity" &&
          !lineEntityMap.has(constraint.target.entityId)) ||
        (constraint.target.kind === "localPoint" &&
          !pointRecords.has(constraint.target.pointId))
      ) {
        continue;
      }
      const referenceLine = lineEntityMap.get(constraint.line.entityId);
      if (!referenceLine) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...lineIdx(constraint.line.entityId),
            ...collinearTargetIdx(constraint.target),
          ],
          evaluateComponentJacobian: componentJacobian(
            [
              ...lineIdx(constraint.line.entityId),
              ...collinearTargetIdx(constraint.target),
            ],
            (columns) => {
              const line = localLineDual(columns, constraint.line.entityId);
              return line
                ? localCollinearComponentsDual(columns, constraint.target, line)
                : infiniteDuals(columns, 2);
            },
          ),
          evaluateComponents(values) {
            const line = resolveLocalLineOperand(
              values,
              constraint.line,
              lineEntityMap,
              pointRecords,
            );
            return line
              ? localCollinearComponents(
                  values,
                  constraint.target,
                  line,
                  lineEntityMap,
                  pointRecords,
                )
              : [Infinity, Infinity];
          },
          evaluateResidual(values) {
            const line = resolveLocalLineOperand(
              values,
              constraint.line,
              lineEntityMap,
              pointRecords,
            );
            if (!line || !unitVector(line.start, line.end)) {
              return Number.POSITIVE_INFINITY;
            }

            return localCollinearResidual(
              values,
              constraint.target,
              line,
              lineEntityMap,
              pointRecords,
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "collinearProjectedLine") {
      if (
        (constraint.target.kind === "localEntity" &&
          !lineEntityMap.has(constraint.target.entityId)) ||
        (constraint.target.kind === "localPoint" &&
          !pointRecords.has(constraint.target.pointId))
      ) {
        continue;
      }
      const projectedLine = resolveReadOnlyLineOperand(
        constraint.projectedLine,
        options.projectedReferences ?? [],
      );
      if (!projectedLine) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: collinearTargetIdx(constraint.target),
          evaluateComponentJacobian: componentJacobian(
            collinearTargetIdx(constraint.target),
            (columns) =>
              localCollinearComponentsDual(
                columns,
                constraint.target,
                constantLineDual(columns, projectedLine),
              ),
          ),
          evaluateComponents(values) {
            return localCollinearComponents(
              values,
              constraint.target,
              projectedLine,
              lineEntityMap,
              pointRecords,
            );
          },
          evaluateResidual(values) {
            if (!unitVector(projectedLine.start, projectedLine.end)) {
              return Number.POSITIVE_INFINITY;
            }

            return localCollinearResidual(
              values,
              constraint.target,
              projectedLine,
              lineEntityMap,
              pointRecords,
            );
          },
        }),
      );
      continue;
    }

    if (
      constraint.kind === "parallelProjectedLine" ||
      constraint.kind === "perpendicularProjectedLine"
    ) {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projectedLine =
        constraint.projectedLine.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedLine.reference,
              );
              return projected?.kind === "lineSegment"
                ? { start: projected.startPosition, end: projected.endPosition }
                : null;
            })()
          : resolveSketchDatumLine(constraint.projectedLine.datum);
      if (!line || !projectedLine) {
        continue;
      }

      const start = pointRecords.get(line.startPointId);
      const end = pointRecords.get(line.endPointId);
      const projectedUnit = unitVector(projectedLine.start, projectedLine.end);
      if (!start || !end || !projectedUnit) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(start, end),
          evaluateComponentJacobian: componentJacobian(
            pIdx(start, end),
            (columns) => {
              const localUnit = unitVectorDual(
                pointDual(columns, start),
                pointDual(columns, end),
              );
              if (!localUnit) return [columns.constant(0)];
              const projected = columns.constant2(projectedUnit);
              return [
                constraint.kind === "parallelProjectedLine"
                  ? dual2.cross(localUnit, projected)
                  : dual2.dot(localUnit, projected),
              ];
            },
          ),
          evaluateResidual(values) {
            const startPoint = getPoint(values, start);
            const endPoint = getPoint(values, end);
            const localUnit = unitVector(startPoint, endPoint);

            if (!localUnit) {
              return 0;
            }

            return constraint.kind === "parallelProjectedLine"
              ? localUnit[0] * projectedUnit[1] -
                  localUnit[1] * projectedUnit[0]
              : localUnit[0] * projectedUnit[0] +
                  localUnit[1] * projectedUnit[1];
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "tangentProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      );
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      if (!entity || !projectedCircle) {
        continue;
      }

      const createTangentResidual = (
        tangentResidual: number,
        projectedContactPoint: SketchPoint2D,
      ) => {
        if (projected?.kind !== "arc") {
          return tangentResidual;
        }

        const arcViolation = projectedArcSweepViolation(
          projectedContactPoint,
          projected,
        );
        return Math.sqrt(
          tangentResidual * tangentResidual + arcViolation * arcViolation,
        );
      };

      const projectedTangentComponents = (
        residual: number,
        contact: SketchPoint2D,
      ) => [
        residual,
        ...(projected?.kind === "arc"
          ? [projectedArcSweepViolation(contact, projected)]
          : []),
      ];
      const projectedTangentComponentsDual = (
        residual: Dual,
        contact: Dual2,
      ) => [
        residual,
        ...(projected?.kind === "arc"
          ? [
              arcSweepViolationDual(
                contact,
                projectedArcDataDual(residual, projected),
              ),
            ]
          : []),
      ];
      const projectedTangentHinge =
        projected?.kind === "arc" ? { hingeComponentIndices: [1] } : {};
      const projectedArcSweepInequalities = (
        support: readonly number[],
        tangency: (columns: DualColumns) => { contact: Dual2 } | null,
      ) => {
        if (projected?.kind === "arc")
          addArcSweepInequalities(
            constraint.constraintId,
            1,
            null,
            support,
            (columns) => {
              const contact = tangency(columns)?.contact;
              return contact
                ? { contact, arc: projectedArcDataDual(contact[0], projected) }
                : null;
            },
          );
      };
      // The circle and arc rows below: a local circle-like tangent to the
      // projected circle.
      const circleTangencyDual = (
        columns: DualColumns,
        localCenter: Dual2,
        radius: Dual,
      ) => {
        const projectedCenter = columns.constant2(projectedCircle.center);
        const projectedRadius = columns.constant(projectedCircle.radius);
        const centerOffset = dual2.sub(localCenter, projectedCenter);
        const centerDistance = dual2.length(centerOffset);
        const direction: Dual2 =
          centerDistance.value > DEGENERATE_NORM_EPSILON
            ? [
                dual.div(centerOffset[0], centerDistance),
                dual.div(centerOffset[1], centerDistance),
              ]
            : [columns.constant(1), columns.constant(0)];
        const targetDistance =
          constraint.relation === "external"
            ? dual.add(radius, projectedRadius)
            : dual.abs(dual.sub(radius, projectedRadius));
        const contactDirection: Dual2 =
          constraint.relation === "external"
            ? direction
            : [dual.neg(direction[0]), dual.neg(direction[1])];
        return {
          residual: dual.sub(centerDistance, targetDistance),
          contact: [
            dual.add(
              projectedCenter[0],
              dual.mul(contactDirection[0], projectedRadius),
            ),
            dual.add(
              projectedCenter[1],
              dual.mul(contactDirection[1], projectedRadius),
            ),
          ] as Dual2,
        };
      };

      if (entity.kind === "lineSegment") {
        const start = pointRecords.get(entity.startPointId);
        const end = pointRecords.get(entity.endPointId);
        if (!start || !end) {
          continue;
        }
        const lineTangencyDual = (columns: DualColumns) => {
          const startPoint = pointDual(columns, start);
          const endPoint = pointDual(columns, end);
          const unit = unitVectorDual(startPoint, endPoint);
          if (!unit) return null;
          const center = columns.constant2(projectedCircle.center);
          const signedDistance = pointLineSignedDistanceDual(
            center,
            startPoint,
            endPoint,
          );
          return {
            residual: dual.sub(
              dual.abs(signedDistance),
              columns.constant(projectedCircle.radius),
            ),
            contact: [
              dual.sub(center[0], dual.mul(signedDistance, unit[1])),
              dual.sub(center[1], dual.mul(signedDistance, dual.neg(unit[0]))),
            ] as Dual2,
          };
        };
        projectedArcSweepInequalities(pIdx(start, end), lineTangencyDual);

        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: pIdx(start, end),
            evaluateComponentJacobian: componentJacobian(
              pIdx(start, end),
              (columns) => {
                const tangency = lineTangencyDual(columns);
                return tangency
                  ? projectedTangentComponentsDual(
                      tangency.residual,
                      tangency.contact,
                    )
                  : [columns.constant(0)];
              },
            ),
            ...projectedTangentHinge,
            evaluateComponents(values) {
              const startPoint = getPoint(values, start);
              const endPoint = getPoint(values, end);
              const unit = unitVector(startPoint, endPoint);
              if (!unit) {
                return [0];
              }

              const signedDistance = pointLineSignedDistance(
                projectedCircle.center,
                startPoint,
                endPoint,
              );
              const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] - signedDistance * lineNormal[0],
                projectedCircle.center[1] - signedDistance * lineNormal[1],
              ];
              return projectedTangentComponents(
                Math.abs(signedDistance) - projectedCircle.radius,
                contactPoint,
              );
            },
            evaluateResidual(values) {
              const startPoint = getPoint(values, start);
              const endPoint = getPoint(values, end);
              const unit = unitVector(startPoint, endPoint);
              if (!unit) {
                return 0;
              }

              const signedDistance = pointLineSignedDistance(
                projectedCircle.center,
                startPoint,
                endPoint,
              );
              const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] - signedDistance * lineNormal[0],
                projectedCircle.center[1] - signedDistance * lineNormal[1],
              ];
              return createTangentResidual(
                Math.abs(signedDistance) - projectedCircle.radius,
                contactPoint,
              );
            },
          }),
        );
        continue;
      }

      if (entity.kind === "circle") {
        const localCircleTangencyDual = (columns: DualColumns) => {
          const localCircle = localCircleLikeDual(columns, entity);
          return localCircle
            ? circleTangencyDual(
                columns,
                localCircle.center,
                localCircle.radius,
              )
            : null;
        };
        projectedArcSweepInequalities(
          entityIdx(entity.entityId),
          localCircleTangencyDual,
        );
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: entityIdx(entity.entityId),
            evaluateComponentJacobian: componentJacobian(
              entityIdx(entity.entityId),
              (columns) => {
                const tangency = localCircleTangencyDual(columns);
                return tangency
                  ? projectedTangentComponentsDual(
                      tangency.residual,
                      tangency.contact,
                    )
                  : [columns.constant(0)];
              },
            ),
            ...projectedTangentHinge,
            evaluateComponents(values) {
              const localCircle = getLocalCircleLike(values, entity);
              if (!localCircle) {
                return [0];
              }

              const localCenter = localCircle.center;
              const centerOffset = subtract(
                localCenter,
                projectedCircle.center,
              );
              const centerDistance = length(centerOffset);
              const direction: SketchPoint2D =
                centerDistance > DEGENERATE_NORM_EPSILON
                  ? [
                      centerOffset[0] / centerDistance,
                      centerOffset[1] / centerDistance,
                    ]
                  : [1, 0];
              const targetDistance =
                constraint.relation === "external"
                  ? localCircle.radius + projectedCircle.radius
                  : Math.abs(localCircle.radius - projectedCircle.radius);
              const contactDirection =
                constraint.relation === "external"
                  ? direction
                  : ([-direction[0], -direction[1]] as const);
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] +
                  contactDirection[0] * projectedCircle.radius,
                projectedCircle.center[1] +
                  contactDirection[1] * projectedCircle.radius,
              ];
              return projectedTangentComponents(
                centerDistance - targetDistance,
                contactPoint,
              );
            },
            evaluateResidual(values) {
              const localCircle = getLocalCircleLike(values, entity);
              if (!localCircle) {
                return 0;
              }

              const localCenter = localCircle.center;
              const centerOffset = subtract(
                localCenter,
                projectedCircle.center,
              );
              const centerDistance = length(centerOffset);
              const direction: SketchPoint2D =
                centerDistance > DEGENERATE_NORM_EPSILON
                  ? [
                      centerOffset[0] / centerDistance,
                      centerOffset[1] / centerDistance,
                    ]
                  : [1, 0];
              const targetDistance =
                constraint.relation === "external"
                  ? localCircle.radius + projectedCircle.radius
                  : Math.abs(localCircle.radius - projectedCircle.radius);
              const contactDirection =
                constraint.relation === "external"
                  ? direction
                  : ([-direction[0], -direction[1]] as const);
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] +
                  contactDirection[0] * projectedCircle.radius,
                projectedCircle.center[1] +
                  contactDirection[1] * projectedCircle.radius,
              ];
              return createTangentResidual(
                centerDistance - targetDistance,
                contactPoint,
              );
            },
          }),
        );
        continue;
      }

      if (entity.kind === "arc") {
        const center = pointRecords.get(entity.centerPointId);
        const arcState = entityStates.get(entity.entityId);
        if (!center || !arcState || arcState.kind !== "arc") {
          continue;
        }
        const arcTangencyDual = (columns: DualColumns) =>
          circleTangencyDual(
            columns,
            pointDual(columns, center),
            columns.variable(arcState.baseIndex),
          );
        projectedArcSweepInequalities(
          [...pIdx(center), ...eIdx(entity.entityId)],
          arcTangencyDual,
        );

        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: [
              ...pIdx(center),
              ...eIdx(entity.entityId),
            ],
            evaluateComponentJacobian: componentJacobian(
              [...pIdx(center), ...eIdx(entity.entityId)],
              (columns) => {
                const tangency = arcTangencyDual(columns);
                return projectedTangentComponentsDual(
                  tangency.residual,
                  tangency.contact,
                );
              },
            ),
            ...projectedTangentHinge,
            evaluateComponents(values) {
              const { radius } = getArcParameters(values, arcState);
              const localCenter = getPoint(values, center);
              const centerOffset = subtract(
                localCenter,
                projectedCircle.center,
              );
              const centerDistance = length(centerOffset);
              const direction: SketchPoint2D =
                centerDistance > DEGENERATE_NORM_EPSILON
                  ? [
                      centerOffset[0] / centerDistance,
                      centerOffset[1] / centerDistance,
                    ]
                  : [1, 0];
              const targetDistance =
                constraint.relation === "external"
                  ? radius + projectedCircle.radius
                  : Math.abs(radius - projectedCircle.radius);
              const contactDirection =
                constraint.relation === "external"
                  ? direction
                  : ([-direction[0], -direction[1]] as const);
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] +
                  contactDirection[0] * projectedCircle.radius,
                projectedCircle.center[1] +
                  contactDirection[1] * projectedCircle.radius,
              ];
              return projectedTangentComponents(
                centerDistance - targetDistance,
                contactPoint,
              );
            },
            evaluateResidual(values) {
              const { radius } = getArcParameters(values, arcState);
              const localCenter = getPoint(values, center);
              const centerOffset = subtract(
                localCenter,
                projectedCircle.center,
              );
              const centerDistance = length(centerOffset);
              const direction: SketchPoint2D =
                centerDistance > DEGENERATE_NORM_EPSILON
                  ? [
                      centerOffset[0] / centerDistance,
                      centerOffset[1] / centerDistance,
                    ]
                  : [1, 0];
              const targetDistance =
                constraint.relation === "external"
                  ? radius + projectedCircle.radius
                  : Math.abs(radius - projectedCircle.radius);
              const contactDirection =
                constraint.relation === "external"
                  ? direction
                  : ([-direction[0], -direction[1]] as const);
              const contactPoint: SketchPoint2D = [
                projectedCircle.center[0] +
                  contactDirection[0] * projectedCircle.radius,
                projectedCircle.center[1] +
                  contactDirection[1] * projectedCircle.radius,
              ];
              return createTangentResidual(
                centerDistance - targetDistance,
                contactPoint,
              );
            },
          }),
        );
      }
    }

    if (constraint.kind === "tangent") {
      const first = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[0],
      );
      const second = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[1],
      );
      if (!first || !second) {
        continue;
      }

      const endpointPair = splineArcEndpointTangency(definition, first, second);
      if (endpointPair) {
        const { spline, arc, atStart } = endpointPair;
        scalarConstraints.push(createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [...entityIdx(spline.entityId), ...entityIdx(arc.entityId)],
          evaluateComponentJacobian: componentJacobian(
            [...entityIdx(spline.entityId), ...entityIdx(arc.entityId)],
            (columns) => {
              const poles = splineSpanPoleDuals(columns, spline, (spans) =>
                atStart ? spans[0] : spans.at(-1),
              );
              const circle = localCircleLikeDual(columns, arc);
              if (!poles || !circle)
                return [columns.constant(Number.POSITIVE_INFINITY)];
              const point = atStart ? poles[0]! : poles[3]!;
              const adjacent = atStart ? poles[1]! : poles[2]!;
              const tangent = dual2.sub(point, adjacent);
              const magnitude = dual2.length(tangent);
              return [
                magnitude.value > 1e-10
                  ? dual.div(
                      dual2.dot(dual2.sub(point, circle.center), tangent),
                      magnitude,
                    )
                  : columns.constant(Number.POSITIVE_INFINITY),
              ];
            },
          ),
          evaluateResidual(values) {
            const geometry = reconstructCurrentSpline(values, spline);
            const span = atStart ? geometry.spans[0] : geometry.spans.at(-1);
            const circle = getLocalCircleLike(values, arc);
            if (!span || !circle) return Number.POSITIVE_INFINITY;
            const point = atStart ? span.poles[0] : span.poles[3];
            const adjacent = atStart ? span.poles[1] : span.poles[2];
            const tangent = subtract(point, adjacent);
            const magnitude = length(tangent);
            return magnitude > 1e-10
              ? dot2(subtract(point, circle.center), tangent) / magnitude
              : Number.POSITIVE_INFINITY;
          },
        }));
        continue;
      }

      const line =
        first.kind === "lineSegment"
          ? first
          : second.kind === "lineSegment"
            ? second
            : null;
      const curve = first === line ? second : first;

      if (line && (curve.kind === "circle" || curve.kind === "arc")) {
        const start = pointRecords.get(line.startPointId);
        const end = pointRecords.get(line.endPointId);
        if (!start || !end) {
          continue;
        }
        const lineCurveTangencyDual = (columns: DualColumns) => {
          const circleLike = localCircleLikeDual(columns, curve);
          if (!circleLike) return null;
          const startPoint = pointDual(columns, start);
          const endPoint = pointDual(columns, end);
          const unit = unitVectorDual(startPoint, endPoint);
          if (!unit) return null;
          const signedDistance = pointLineSignedDistanceDual(
            circleLike.center,
            startPoint,
            endPoint,
          );
          const contactPoint: Dual2 = [
            dual.sub(circleLike.center[0], dual.mul(signedDistance, unit[1])),
            dual.sub(
              circleLike.center[1],
              dual.mul(signedDistance, dual.neg(unit[0])),
            ),
          ];
          return { circleLike, signedDistance, contactPoint, unit };
        };
        if (curve.kind === "arc")
          addArcSweepInequalities(
            constraint.constraintId,
            1,
            curve.entityId,
            [...pIdx(start, end), ...entityIdx(curve.entityId)],
            (columns) => {
              const tangency = lineCurveTangencyDual(columns);
              return tangency?.circleLike.arc
                ? {
                    contact: tangency.contactPoint,
                    arc: tangency.circleLike.arc,
                  }
                : null;
            },
          );
        // cadara-p4r5.2: where the oriented row's contact is the arc start (it
        // defines the point-defined arc's radius, so |d| − r is second order
        // there), the oriented component (s − c)·u is component 0 of this
        // row's loss. An end contact keeps |d| − r (already first order).
        let radiusContact: {
          contact: SolverPointRecord;
          center: SolverPointRecord;
        } | null = null;
        if (curve.kind === "arc" && offsetSeedArcIds.has(curve.entityId)) {
          const contactPointId = [curve.startPointId, curve.endPointId].find(
            (pointId) =>
              sameLocation(pointId, line.startPointId) ||
              sameLocation(pointId, line.endPointId),
          );
          const contact = contactPointId && pointRecords.get(contactPointId);
          const center = pointRecords.get(curve.centerPointId);
          if (contactPointId === curve.startPointId && contact && center)
            radiusContact = { contact, center };
          if (contactPointId && contact && center)
            orientedTangencyRows.push({
              record: {
                id: `orientedTangency_${constraint.constraintId}`,
                requirementId: constraint.constraintId,
                arcEntityId: curve.entityId,
                contactPointId,
              },
              support: pIdx(start, end, contact, center),
              component: (columns) => {
                const unit = unitVectorDual(
                  pointDual(columns, start),
                  pointDual(columns, end),
                );
                return unit
                  ? dual2.dot(
                      dual2.sub(
                        pointDual(columns, contact),
                        pointDual(columns, center),
                      ),
                      unit,
                    )
                  : columns.fromColumns(
                      Number.NaN,
                      columns.support.map(() => Number.NaN),
                    );
              },
            });
        }

        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: [
              ...pIdx(start, end),
              ...entityIdx(curve.entityId),
            ],
            evaluateComponentJacobian: componentJacobian(
              [...pIdx(start, end), ...entityIdx(curve.entityId)],
              (columns) => {
                const tangency = lineCurveTangencyDual(columns);
                if (!tangency) return [columns.constant(0)];
                const { circleLike, signedDistance, contactPoint, unit } =
                  tangency;
                return [
                  radiusContact
                    ? dual2.dot(
                        dual2.sub(
                          pointDual(columns, radiusContact.contact),
                          pointDual(columns, radiusContact.center),
                        ),
                        unit,
                      )
                    : dual.sub(dual.abs(signedDistance), circleLike.radius),
                  circleLike.arc
                    ? arcSweepViolationDual(contactPoint, circleLike.arc)
                    : columns.constant(0),
                ];
              },
            ),
            ...(curve.kind === "arc" ? { hingeComponentIndices: [1] } : {}),
            evaluateComponents(values) {
              const circleLike = getLocalCircleLike(values, curve);
              if (!circleLike) {
                return [0];
              }

              const startPoint = getPoint(values, start);
              const endPoint = getPoint(values, end);
              const unit = unitVector(startPoint, endPoint);
              if (!unit) {
                return [0];
              }

              const signedDistance = pointLineSignedDistance(
                circleLike.center,
                startPoint,
                endPoint,
              );
              const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
              const contactPoint: SketchPoint2D = [
                circleLike.center[0] - signedDistance * lineNormal[0],
                circleLike.center[1] - signedDistance * lineNormal[1],
              ];
              const tangentResidual = radiusContact
                ? dot2(
                    subtract(
                      getPoint(values, radiusContact.contact),
                      getPoint(values, radiusContact.center),
                    ),
                    unit,
                  )
                : Math.abs(signedDistance) - circleLike.radius;
              const arcViolation = circleLike.arc
                ? localArcSweepViolation(contactPoint, circleLike.arc)
                : 0;
              return [tangentResidual, arcViolation];
            },
            evaluateResidual(values) {
              const circleLike = getLocalCircleLike(values, curve);
              if (!circleLike) {
                return 0;
              }

              const startPoint = getPoint(values, start);
              const endPoint = getPoint(values, end);
              const unit = unitVector(startPoint, endPoint);
              if (!unit) {
                return 0;
              }

              const signedDistance = pointLineSignedDistance(
                circleLike.center,
                startPoint,
                endPoint,
              );
              const lineNormal: SketchPoint2D = [unit[1], -unit[0]];
              const contactPoint: SketchPoint2D = [
                circleLike.center[0] - signedDistance * lineNormal[0],
                circleLike.center[1] - signedDistance * lineNormal[1],
              ];
              const tangentResidual = radiusContact
                ? dot2(
                    subtract(
                      getPoint(values, radiusContact.contact),
                      getPoint(values, radiusContact.center),
                    ),
                    unit,
                  )
                : Math.abs(signedDistance) - circleLike.radius;
              const arcViolation = circleLike.arc
                ? localArcSweepViolation(contactPoint, circleLike.arc)
                : 0;
              return Math.sqrt(
                tangentResidual * tangentResidual + arcViolation * arcViolation,
              );
            },
          }),
        );
        continue;
      }

      if (
        (first.kind === "circle" || first.kind === "arc") &&
        (second.kind === "circle" || second.kind === "arc")
      ) {
        const pairSupport = [
          ...entityIdx(first.entityId),
          ...entityIdx(second.entityId),
        ];
        const circlePairTangencyDual = (columns: DualColumns) => {
          const firstCircle = localCircleLikeDual(columns, first);
          const secondCircle = localCircleLikeDual(columns, second);
          if (!firstCircle || !secondCircle) return null;
          const [firstContact, secondContact] = localCircleTangencyContactsDual(
            firstCircle,
            secondCircle,
            constraint.relation,
          );
          return {
            firstCircle,
            secondCircle,
            centerDistance: dual2.length(
              dual2.sub(firstCircle.center, secondCircle.center),
            ),
            firstContact,
            secondContact,
          };
        };
        for (const [index, entity] of [first, second].entries())
          if (entity.kind === "arc")
            addArcSweepInequalities(
              constraint.constraintId,
              index + 1,
              entity.entityId,
              pairSupport,
              (columns) => {
                const tangency = circlePairTangencyDual(columns);
                const circle =
                  index === 0 ? tangency?.firstCircle : tangency?.secondCircle;
                return tangency && circle?.arc
                  ? {
                      contact:
                        index === 0
                          ? tangency.firstContact
                          : tangency.secondContact,
                      arc: circle.arc,
                    }
                  : null;
              },
            );
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: constraint.constraintId,
            targetKind: "constraint",
            parameterCount,
            affectedVariableIndices: [
              ...entityIdx(first.entityId),
              ...entityIdx(second.entityId),
            ],
            evaluateComponentJacobian: componentJacobian(
              pairSupport,
              (columns) => {
                const tangency = circlePairTangencyDual(columns);
                if (!tangency) return [columns.constant(0)];
                const {
                  firstCircle,
                  secondCircle,
                  centerDistance,
                  firstContact,
                  secondContact,
                } = tangency;
                const targetDistance =
                  constraint.relation === "external"
                    ? dual.add(firstCircle.radius, secondCircle.radius)
                    : dual.abs(
                        dual.sub(firstCircle.radius, secondCircle.radius),
                      );
                return [
                  dual.sub(centerDistance, targetDistance),
                  firstCircle.arc
                    ? arcSweepViolationDual(firstContact, firstCircle.arc)
                    : columns.constant(0),
                  secondCircle.arc
                    ? arcSweepViolationDual(secondContact, secondCircle.arc)
                    : columns.constant(0),
                ];
              },
            ),
            hingeComponentIndices: [first, second].flatMap((entity, index) =>
              entity.kind === "arc" ? [index + 1] : [],
            ),
            evaluateComponents(values) {
              const firstCircle = getLocalCircleLike(values, first);
              const secondCircle = getLocalCircleLike(values, second);
              if (!firstCircle || !secondCircle) {
                return [0];
              }

              const centerDistance = length(
                subtract(firstCircle.center, secondCircle.center),
              );
              const targetDistance =
                constraint.relation === "external"
                  ? firstCircle.radius + secondCircle.radius
                  : Math.abs(firstCircle.radius - secondCircle.radius);
              const tangentResidual = centerDistance - targetDistance;
              const [firstContact, secondContact] = localCircleTangencyContacts(
                firstCircle,
                secondCircle,
                constraint.relation,
              );
              const firstArcViolation = firstCircle.arc
                ? localArcSweepViolation(firstContact, firstCircle.arc)
                : 0;
              const secondArcViolation = secondCircle.arc
                ? localArcSweepViolation(secondContact, secondCircle.arc)
                : 0;
              return [tangentResidual, firstArcViolation, secondArcViolation];
            },
            evaluateResidual(values) {
              const firstCircle = getLocalCircleLike(values, first);
              const secondCircle = getLocalCircleLike(values, second);
              if (!firstCircle || !secondCircle) {
                return 0;
              }

              const centerDistance = length(
                subtract(firstCircle.center, secondCircle.center),
              );
              const targetDistance =
                constraint.relation === "external"
                  ? firstCircle.radius + secondCircle.radius
                  : Math.abs(firstCircle.radius - secondCircle.radius);
              const tangentResidual = centerDistance - targetDistance;
              const [firstContact, secondContact] = localCircleTangencyContacts(
                firstCircle,
                secondCircle,
                constraint.relation,
              );
              const firstArcViolation = firstCircle.arc
                ? localArcSweepViolation(firstContact, firstCircle.arc)
                : 0;
              const secondArcViolation = secondCircle.arc
                ? localArcSweepViolation(secondContact, secondCircle.arc)
                : 0;
              return Math.sqrt(
                tangentResidual * tangentResidual +
                  firstArcViolation * firstArcViolation +
                  secondArcViolation * secondArcViolation,
              );
            },
          }),
        );
        continue;
      }
    }

    if (constraint.kind === "concentric") {
      const first = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[0],
      );
      const second = definition.entities.find(
        (entity) => entity.entityId === constraint.entityIds[1],
      );
      if (
        !first ||
        !second ||
        (first.kind !== "circle" && first.kind !== "arc") ||
        (second.kind !== "circle" && second.kind !== "arc")
      ) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...entityIdx(first.entityId),
            ...entityIdx(second.entityId),
          ],
          evaluateComponentJacobian: componentJacobian(
            [...entityIdx(first.entityId), ...entityIdx(second.entityId)],
            (columns) => {
              const a = localCircleLikeDual(columns, first),
                b = localCircleLikeDual(columns, second);
              return a && b
                ? dual2.sub(a.center, b.center)
                : infiniteDuals(columns, 2);
            },
          ),
          evaluateComponents(values) {
            const a = getLocalCircleLike(values, first),
              b = getLocalCircleLike(values, second);
            return a && b ? subtract(a.center, b.center) : [Infinity, Infinity];
          },
          evaluateResidual(values) {
            const firstCircle = getLocalCircleLike(values, first);
            const secondCircle = getLocalCircleLike(values, second);
            return firstCircle && secondCircle
              ? length(subtract(firstCircle.center, secondCircle.center))
              : 0;
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "concentricProjectedCurve") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      );
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      if (
        !entity ||
        !projectedCircle ||
        (entity.kind !== "circle" && entity.kind !== "arc")
      ) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: entityIdx(entity.entityId),
          evaluateComponentJacobian: componentJacobian(
            entityIdx(entity.entityId),
            (columns) => {
              const circle = localCircleLikeDual(columns, entity);
              return circle
                ? dual2.sub(
                    circle.center,
                    columns.constant2(projectedCircle.center),
                  )
                : infiniteDuals(columns, 2);
            },
          ),
          evaluateComponents(values) {
            const circle = getLocalCircleLike(values, entity);
            return circle
              ? subtract(circle.center, projectedCircle.center)
              : [Infinity, Infinity];
          },
          evaluateResidual(values) {
            const localCircle = getLocalCircleLike(values, entity);
            return localCircle
              ? length(subtract(localCircle.center, projectedCircle.center))
              : 0;
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "normal") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const curve = definition.entities.find(
        (candidate) => candidate.entityId === constraint.curve.entityId,
      );
      const point = pointRecords.get(constraint.point.pointId);
      if (
        !line ||
        !curve ||
        !point ||
        (curve.kind !== "circle" && curve.kind !== "arc")
      ) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [
            ...pIdx(point),
            ...lineIdx(line.entityId),
            ...entityIdx(curve.entityId),
          ],
          evaluateComponentJacobian: componentJacobian(
            [
              ...pIdx(point),
              ...lineIdx(line.entityId),
              ...entityIdx(curve.entityId),
            ],
            (columns) => {
              const circle = localCircleLikeDual(columns, curve);
              const contact = pointDual(columns, point);
              return circle
                ? [
                    ...localCurveComponentsDual(columns, point, curve),
                    normalResidualDual(columns, line, contact, circle.center),
                    lineContactResidualDual(columns, line, contact),
                  ]
                : infiniteDuals(columns, 1);
            },
          ),
          evaluateComponents(values) {
            const circle = getLocalCircleLike(values, curve);
            const contact = getPoint(values, point);
            return circle
              ? [
                  ...localCurveComponents(values, point, curve),
                  normalResidual(values, line, contact, circle.center),
                  lineContactResidual(values, line, contact),
                ]
              : [Infinity];
          },
          evaluateResidual(values) {
            const circleLike = getLocalCircleLike(values, curve);
            if (!circleLike) {
              return 0;
            }

            const contactPoint = getPoint(values, point);
            const curveResidual = pointOnLocalCurveResidual(
              values,
              point,
              curve,
            );
            const directionResidual = normalResidual(
              values,
              line,
              contactPoint,
              circleLike.center,
            );
            const contactResidual = lineContactResidual(
              values,
              line,
              contactPoint,
            );
            return Math.sqrt(
              curveResidual * curveResidual +
                directionResidual * directionResidual +
                contactResidual * contactResidual,
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "normalProjectedCurve") {
      const line = lineEntityMap.get(constraint.line.entityId);
      const projected = findProjectedGeometry(
        options.projectedReferences ?? [],
        constraint.projectedCurve.reference,
      );
      const projectedCircle = projected
        ? projectedCircleLikeGeometry(projected)
        : null;
      const point = pointRecords.get(constraint.point.pointId);
      if (!line || !projected || !projectedCircle || !point) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: [...pIdx(point), ...lineIdx(line.entityId)],
          evaluateComponentJacobian: componentJacobian(
            [...pIdx(point), ...lineIdx(line.entityId)],
            (columns) => {
              const contact = pointDual(columns, point);
              return [
                ...projectedCurveComponentsDual(contact, projected),
                normalResidualDual(
                  columns,
                  line,
                  contact,
                  columns.constant2(projectedCircle.center),
                ),
                lineContactResidualDual(columns, line, contact),
              ];
            },
          ),
          evaluateComponents(values) {
            const contact = getPoint(values, point);
            return [
              ...projectedCurveComponents(contact, projected),
              normalResidual(values, line, contact, projectedCircle.center),
              lineContactResidual(values, line, contact),
            ];
          },
          evaluateResidual(values) {
            const contactPoint = getPoint(values, point);
            const curveResidual = pointOnProjectedCurveResidual(
              contactPoint,
              projected,
            );
            const directionResidual = normalResidual(
              values,
              line,
              contactPoint,
              projectedCircle.center,
            );
            const contactResidual = lineContactResidual(
              values,
              line,
              contactPoint,
            );
            return Math.sqrt(
              curveResidual * curveResidual +
                directionResidual * directionResidual +
                contactResidual * contactResidual,
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "symmetric") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const axis = lineEntityMap.get(constraint.axis.entityId);
      const axisStart = axis ? pointRecords.get(axis.startPointId) : null;
      const axisEnd = axis ? pointRecords.get(axis.endPointId) : null;
      if (!first || !second || !axis || !axisStart || !axisEnd) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(first, second, axisStart, axisEnd),
          evaluateComponentJacobian: componentJacobian(
            pIdx(first, second, axisStart, axisEnd),
            (columns) =>
              symmetryComponentsDual(
                pointDual(columns, first),
                pointDual(columns, second),
                pointDual(columns, axisStart),
                pointDual(columns, axisEnd),
              ),
          ),
          evaluateComponents(values) {
            return symmetryComponents(
              getPoint(values, first),
              getPoint(values, second),
              getPoint(values, axisStart),
              getPoint(values, axisEnd),
            );
          },
          evaluateResidual(values) {
            return symmetricResidual(
              getPoint(values, first),
              getPoint(values, second),
              getPoint(values, axisStart),
              getPoint(values, axisEnd),
            );
          },
        }),
      );
      continue;
    }

    if (constraint.kind === "symmetricProjectedLine") {
      const first = pointRecords.get(constraint.pointIds[0]);
      const second = pointRecords.get(constraint.pointIds[1]);
      const projectedLine =
        constraint.projectedLine.kind === "projectedGeometry"
          ? (() => {
              const projected = findProjectedGeometry(
                options.projectedReferences ?? [],
                constraint.projectedLine.reference,
              );
              return projected?.kind === "lineSegment"
                ? { start: projected.startPosition, end: projected.endPosition }
                : null;
            })()
          : resolveSketchDatumLine(constraint.projectedLine.datum);
      if (!first || !second || !projectedLine) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: constraint.constraintId,
          targetKind: "constraint",
          parameterCount,
          affectedVariableIndices: pIdx(first, second),
          evaluateComponentJacobian: componentJacobian(
            pIdx(first, second),
            (columns) =>
              symmetryComponentsDual(
                pointDual(columns, first),
                pointDual(columns, second),
                columns.constant2(projectedLine.start),
                columns.constant2(projectedLine.end),
              ),
          ),
          evaluateComponents(values) {
            return symmetryComponents(
              getPoint(values, first),
              getPoint(values, second),
              projectedLine.start,
              projectedLine.end,
            );
          },
          evaluateResidual(values) {
            return symmetricResidual(
              getPoint(values, first),
              getPoint(values, second),
              projectedLine.start,
              projectedLine.end,
            );
          },
        }),
      );
      continue;
    }
  }

  for (const dimension of definition.dimensions) {
    // T13d (D10): a reference dimension measures its targets and compiles no
    // residual, so it never drives (or over-constrains) the solve.
    if (isReferenceDimension(dimension)) {
      continue;
    }
    const drivingValue = getDrivingDimensionValue(dimension);
    if (dimension.kind === "distance") {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (!left || !right) {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluateComponentJacobian: componentJacobian(
          pIdx(left, right),
          (columns) => {
            const delta = dual2.sub(
              pointDual(columns, right),
              pointDual(columns, left),
            );
            return [
              dual.sub(
                dimension.axis === "aligned"
                  ? dual2.length(delta)
                  : delta[dimension.axis === "horizontal" ? 0 : 1],
                columns.constant(drivingValue),
              ),
            ];
          },
        ),
        evaluateComponents(values) {
          const delta = subtract(
            getPoint(values, right),
            getPoint(values, left),
          );
          return [
            (dimension.axis === "aligned"
              ? length(delta)
              : delta[dimension.axis === "horizontal" ? 0 : 1]) - drivingValue,
          ];
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, left);
          const b = getPoint(values, right);
          const delta =
            dimension.axis === "aligned" ? subtract(a, b) : subtract(b, a);

          if (dimension.axis === "aligned") {
            const current = length(delta);
            if (current < DEGENERATE_NORM_EPSILON) {
              return {
                residual: 0.5 * drivingValue * drivingValue,
                gradient,
              };
            }
            const err = current - drivingValue;
            const coeffX = (err * delta[0]) / current;
            const coeffY = (err * delta[1]) / current;
            addPointGradient(gradient, left, coeffX, coeffY);
            addPointGradient(gradient, right, -coeffX, -coeffY);
            return { residual: 0.5 * err * err, gradient };
          }

          const index = dimension.axis === "horizontal" ? 0 : 1;
          const err = delta[index] - drivingValue;
          if (index === 0) {
            addPointGradient(gradient, left, -err, 0);
            addPointGradient(gradient, right, err, 0);
          } else {
            addPointGradient(gradient, left, 0, -err);
            addPointGradient(gradient, right, 0, err);
          }
          return { residual: 0.5 * err * err, gradient };
        },
      });
      continue;
    }

    if (
      dimension.kind === "horizontalDistance" ||
      dimension.kind === "verticalDistance"
    ) {
      const left = pointRecords.get(dimension.pointIds[0]);
      const right = pointRecords.get(dimension.pointIds[1]);
      if (!left || !right) {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluateComponentJacobian: componentJacobian(
          pIdx(left, right),
          (columns) => [
            dual.sub(
              dual2.sub(pointDual(columns, right), pointDual(columns, left))[
                dimension.kind === "horizontalDistance" ? 0 : 1
              ],
              columns.constant(drivingValue),
            ),
          ],
        ),
        evaluateComponents(values) {
          const delta = subtract(
            getPoint(values, right),
            getPoint(values, left),
          );
          return [
            delta[dimension.kind === "horizontalDistance" ? 0 : 1] -
              drivingValue,
          ];
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const a = getPoint(values, left);
          const b = getPoint(values, right);
          const delta = subtract(b, a);
          const err =
            (dimension.kind === "horizontalDistance" ? delta[0] : delta[1]) -
            drivingValue;
          if (dimension.kind === "horizontalDistance") {
            addPointGradient(gradient, left, -err, 0);
            addPointGradient(gradient, right, err, 0);
          } else {
            addPointGradient(gradient, left, 0, -err);
            addPointGradient(gradient, right, 0, err);
          }
          return { residual: 0.5 * err * err, gradient };
        },
      });
      continue;
    }

    if (dimension.kind === "circleRadius") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === dimension.entityId,
      );
      if (!entity || entity.kind !== "circle") {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluateComponentJacobian: componentJacobian(
          eIdx(entity.entityId),
          (columns) => {
            const state = entityStates.get(entity.entityId);
            return [
              dual.sub(
                state?.kind === "circle"
                  ? columns.variable(state.baseIndex)
                  : columns.constant(entity.radius),
                columns.constant(drivingValue),
              ),
            ];
          },
        ),
        evaluateComponents(values) {
          const state = entityStates.get(entity.entityId);
          return [
            (state?.kind === "circle"
              ? getCircleRadius(values, state)
              : entity.radius) - drivingValue,
          ];
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const circleState = entityStates.get(entity.entityId);
          if (!circleState || circleState.kind !== "circle") {
            const err = entity.radius - drivingValue;
            return { residual: 0.5 * err * err, gradient };
          }

          const err = getCircleRadius(values, circleState) - drivingValue;
          gradient[circleState.baseIndex] = err;
          return { residual: 0.5 * err * err, gradient };
        },
      });
      continue;
    }

    if (dimension.kind === "diameter") {
      const entity = definition.entities.find(
        (candidate) => candidate.entityId === dimension.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc")) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: entityIdx(entity.entityId),
          evaluateComponentJacobian: componentJacobian(
            entityIdx(entity.entityId),
            (columns) => {
              const circleLike = localCircleLikeDual(columns, entity);
              return [
                circleLike
                  ? dual.sub(
                      dual.scale(circleLike.radius, 2),
                      columns.constant(drivingValue),
                    )
                  : columns.constant(drivingValue),
              ];
            },
          ),
          evaluateResidual(values) {
            const circleLike = getLocalCircleLike(values, entity);
            return circleLike
              ? circleLike.radius * 2 - drivingValue
              : drivingValue;
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "pointDatumDistance") {
      const point = pointRecords.get(dimension.point.pointId);
      const datumPoint = resolveSketchDatumPoint(dimension.datum.datum);
      if (!point || !datumPoint) {
        continue;
      }

      // Axis distances are displayed as magnitudes, but a rebuild must retain
      // the point's side of the datum. An absolute residual lets optimizer
      // trials cross the datum and converge on the opposite, equally valid root.
      const initialPoint = getPoint(initialValues, point);
      const horizontalSide = initialPoint[0] < datumPoint[0] ? -1 : 1;
      const verticalSide = initialPoint[1] < datumPoint[1] ? -1 : 1;
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: pIdx(point),
          evaluateComponentJacobian: componentJacobian(
            pIdx(point),
            (columns) => {
              const delta = dual2.sub(
                pointDual(columns, point),
                columns.constant2(datumPoint),
              );
              if (drivingValue === 0)
                return dimension.axis === "aligned"
                  ? delta
                  : [delta[dimension.axis === "horizontal" ? 0 : 1]];
              return [
                dual.sub(
                  dimension.axis === "aligned"
                    ? dual2.length(delta)
                    : dual.abs(delta[dimension.axis === "horizontal" ? 0 : 1]),
                  columns.constant(drivingValue),
                ),
              ];
            },
          ),
          evaluateComponents(values) {
            const delta = subtract(getPoint(values, point), datumPoint);
            if (drivingValue === 0)
              return dimension.axis === "aligned"
                ? delta
                : [delta[dimension.axis === "horizontal" ? 0 : 1]];
            return [
              (dimension.axis === "aligned"
                ? length(delta)
                : Math.abs(delta[dimension.axis === "horizontal" ? 0 : 1])) -
                drivingValue,
            ];
          },
          evaluateResidual(values) {
            const localPoint = getPoint(values, point);
            if (dimension.axis === "horizontal") {
              return (
                horizontalSide * (localPoint[0] - datumPoint[0]) - drivingValue
              );
            }

            if (dimension.axis === "vertical") {
              return (
                verticalSide * (localPoint[1] - datumPoint[1]) - drivingValue
              );
            }

            return length(subtract(localPoint, datumPoint)) - drivingValue;
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "lineLength") {
      const entity = lineEntityMap.get(dimension.entityId);
      const start = entity ? pointRecords.get(entity.startPointId) : null;
      const end = entity ? pointRecords.get(entity.endPointId) : null;
      if (!start || !end) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: pIdx(start, end),
          evaluateComponentJacobian: componentJacobian(
            pIdx(start, end),
            (columns) => [
              dual.sub(
                dual2.length(
                  dual2.sub(pointDual(columns, end), pointDual(columns, start)),
                ),
                columns.constant(drivingValue),
              ),
            ],
          ),
          evaluateResidual(values) {
            return (
              length(subtract(getPoint(values, end), getPoint(values, start))) -
              drivingValue
            );
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "lineDistance") {
      const initialFirst = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      const initialSecond = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      if (
        !initialFirst ||
        !initialSecond ||
        !linesParallelWithinTolerance(
          initialFirst,
          initialSecond,
          options.tolerances,
        )
      ) {
        continue;
      }

      // Keep the distance and its parallel-line prerequisite smooth during
      // iteration. A thresholded penalty traps valid edits at the boundary as
      // unconstrained trial steps temporarily rotate the initially parallel lines.
      for (const component of ["parallel", "distance"] as const) {
        scalarConstraints.push(
          createNumericalScalarConstraint({
            id: dimension.dimensionId,
            targetKind: "dimension",
            parameterCount,
            affectedVariableIndices: [
              ...lineDimOperandIdx(dimension.lines[0]),
              ...lineDimOperandIdx(dimension.lines[1]),
            ],
            evaluateComponentJacobian: componentJacobian(
              [
                ...lineDimOperandIdx(dimension.lines[0]),
                ...lineDimOperandIdx(dimension.lines[1]),
              ],
              (columns) => {
                const first = lineDimensionOperandDual(
                  columns,
                  dimension.lines[0],
                );
                const second = lineDimensionOperandDual(
                  columns,
                  dimension.lines[1],
                );
                if (!first || !second) return infiniteDuals(columns, 1);
                if (component === "parallel")
                  return [
                    lineParallelResidualDual(
                      first.start,
                      first.end,
                      second.start,
                      second.end,
                    ),
                  ];
                const distance = pointLineSignedDistanceDual(
                  second.start,
                  first.start,
                  first.end,
                );
                return [
                  dual.sub(
                    drivingValue === 0 ? distance : dual.abs(distance),
                    columns.constant(drivingValue),
                  ),
                ];
              },
            ),
            evaluateComponents(values) {
              const first = resolveLineDimensionOperand(
                values,
                dimension.lines[0],
                lineEntityMap,
                pointRecords,
                options.projectedReferences ?? [],
              );
              const second = resolveLineDimensionOperand(
                values,
                dimension.lines[1],
                lineEntityMap,
                pointRecords,
                options.projectedReferences ?? [],
              );
              if (!first || !second) return [Infinity];
              if (component === "parallel")
                return [
                  lineParallelResidual(
                    first.start,
                    first.end,
                    second.start,
                    second.end,
                  ),
                ];
              const distance = pointLineSignedDistance(
                second.start,
                first.start,
                first.end,
              );
              return [
                (drivingValue === 0 ? distance : Math.abs(distance)) -
                  drivingValue,
              ];
            },
            evaluateResidual(values) {
              const first = resolveLineDimensionOperand(
                values,
                dimension.lines[0],
                lineEntityMap,
                pointRecords,
                options.projectedReferences ?? [],
              );
              const second = resolveLineDimensionOperand(
                values,
                dimension.lines[1],
                lineEntityMap,
                pointRecords,
                options.projectedReferences ?? [],
              );
              if (!first || !second) return drivingValue;
              return component === "parallel"
                ? lineParallelResidual(
                    first.start,
                    first.end,
                    second.start,
                    second.end,
                  )
                : Math.abs(
                    pointLineSignedDistance(
                      second.start,
                      first.start,
                      first.end,
                    ),
                  ) - drivingValue;
            },
          }),
        );
      }
      continue;
    }

    if (dimension.kind === "linePointDistance") {
      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: [
            ...lineDimOperandIdx(dimension.line),
            ...pointDimOperandIdx(dimension.point),
          ],
          evaluateComponentJacobian: componentJacobian(
            [
              ...lineDimOperandIdx(dimension.line),
              ...pointDimOperandIdx(dimension.point),
            ],
            (columns) => {
              const line = lineDimensionOperandDual(columns, dimension.line);
              const point = pointDimensionOperandDual(columns, dimension.point);
              if (!line || !point) return infiniteDuals(columns, 1);
              const distance = pointLineSignedDistanceDual(
                point,
                line.start,
                line.end,
              );
              return [
                dual.sub(
                  drivingValue === 0 ? distance : dual.abs(distance),
                  columns.constant(drivingValue),
                ),
              ];
            },
          ),
          evaluateComponents(values) {
            const line = resolveLineDimensionOperand(
              values,
              dimension.line,
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            const point = resolvePointDimensionOperand(
              values,
              dimension.point,
              pointRecords,
              options.projectedReferences ?? [],
            );
            if (!line || !point) return [Infinity];
            const distance = pointLineSignedDistance(
              point,
              line.start,
              line.end,
            );
            return [
              (drivingValue === 0 ? distance : Math.abs(distance)) -
                drivingValue,
            ];
          },
          evaluateResidual(values) {
            const line = resolveLineDimensionOperand(
              values,
              dimension.line,
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            const point = resolvePointDimensionOperand(
              values,
              dimension.point,
              pointRecords,
              options.projectedReferences ?? [],
            );
            return line && point
              ? Math.abs(pointLineSignedDistance(point, line.start, line.end)) -
                  drivingValue
              : drivingValue;
          },
        }),
      );
      continue;
    }

    if (dimension.kind === "lineAngle") {
      const initialFirst = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[0],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      const initialSecond = resolveLineDimensionOperand(
        initialValues,
        dimension.lines[1],
        lineEntityMap,
        pointRecords,
        options.projectedReferences ?? [],
      );
      const initialAngle =
        initialFirst && initialSecond
          ? lineAngleRadians(
              initialFirst.start,
              initialFirst.end,
              initialSecond.start,
              initialSecond.end,
            )
          : null;
      if (initialAngle === null || initialAngle <= DEGENERATE_NORM_EPSILON) {
        continue;
      }

      scalarConstraints.push(
        createNumericalScalarConstraint({
          id: dimension.dimensionId,
          targetKind: "dimension",
          parameterCount,
          affectedVariableIndices: [
            ...lineDimOperandIdx(dimension.lines[0]),
            ...lineDimOperandIdx(dimension.lines[1]),
          ],
          evaluateComponentJacobian: componentJacobian(
            [
              ...lineDimOperandIdx(dimension.lines[0]),
              ...lineDimOperandIdx(dimension.lines[1]),
            ],
            (columns) => {
              const first = lineDimensionOperandDual(
                columns,
                dimension.lines[0],
              );
              const second = lineDimensionOperandDual(
                columns,
                dimension.lines[1],
              );
              const angle =
                first && second
                  ? lineAngleRadiansDual(
                      first.start,
                      first.end,
                      second.start,
                      second.end,
                    )
                  : null;
              return [
                angle === null || angle.value <= DEGENERATE_NORM_EPSILON
                  ? columns.constant(drivingValue)
                  : dual.sub(angle, columns.constant(drivingValue)),
              ];
            },
          ),
          evaluateResidual(values) {
            const first = resolveLineDimensionOperand(
              values,
              dimension.lines[0],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            const second = resolveLineDimensionOperand(
              values,
              dimension.lines[1],
              lineEntityMap,
              pointRecords,
              options.projectedReferences ?? [],
            );
            if (!first || !second) {
              return drivingValue;
            }

            const angle = lineAngleRadians(
              first.start,
              first.end,
              second.start,
              second.end,
            );
            if (angle === null || angle <= DEGENERATE_NORM_EPSILON) {
              return drivingValue;
            }

            return angle - drivingValue;
          },
        }),
      );
      continue;
    }

    if (
      dimension.kind === "arcStartPointCoincident" ||
      dimension.kind === "arcEndPointCoincident"
    ) {
      const arc = arcEntityMap.get(dimension.entityId);
      const arcState = entityStates.get(dimension.entityId);
      const point = pointRecords.get(dimension.pointId);
      const center = arc ? pointRecords.get(arc.centerPointId) : null;
      if (!arc || !arcState || arcState.kind !== "arc" || !point || !center) {
        continue;
      }

      scalarConstraints.push({
        id: dimension.dimensionId,
        targetKind: "dimension",
        evaluateComponentJacobian: componentJacobian(
          [...pIdx(center, point), ...eIdx(arc.entityId)],
          (columns) => {
            const radius = columns.variable(arcState.baseIndex);
            const angle = columns.variable(
              arcState.baseIndex +
                (dimension.kind === "arcStartPointCoincident" ? 1 : 2),
            );
            const centerDual = pointDual(columns, center);
            return dual2.sub(
              [
                dual.add(centerDual[0], dual.mul(radius, dual.cos(angle))),
                dual.add(centerDual[1], dual.mul(radius, dual.sin(angle))),
              ],
              pointDual(columns, point),
            );
          },
        ),
        evaluateComponents(values) {
          const { radius, startAngle, endAngle } = getArcParameters(
            values,
            arcState,
          );
          const angle =
            dimension.kind === "arcStartPointCoincident"
              ? startAngle
              : endAngle;
          return subtract(
            add(getPoint(values, center), [
              radius * Math.cos(angle),
              radius * Math.sin(angle),
            ]),
            getPoint(values, point),
          );
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const centerPos = getPoint(values, center);
          const pointPos = getPoint(values, point);
          const { radius, startAngle, endAngle } = getArcParameters(
            values,
            arcState,
          );
          const angle =
            dimension.kind === "arcStartPointCoincident"
              ? startAngle
              : endAngle;
          const arcPoint = add(centerPos, [
            radius * Math.cos(angle),
            radius * Math.sin(angle),
          ]);
          const delta = subtract(arcPoint, pointPos);
          const gx = delta[0];
          const gy = delta[1];
          addPointGradient(gradient, center, gx, gy);
          addPointGradient(gradient, point, -gx, -gy);
          gradient[arcState.baseIndex] +=
            gx * Math.cos(angle) + gy * Math.sin(angle);
          const angleGradient =
            gx * (-radius * Math.sin(angle)) + gy * (radius * Math.cos(angle));
          gradient[
            arcState.baseIndex +
              (dimension.kind === "arcStartPointCoincident" ? 1 : 2)
          ] += angleGradient;
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
    }
  }

  if (options.dragTarget) {
    const point = pointRecords.get(options.dragTarget.pointId);

    if (point) {
      scalarConstraints.push({
        id: `constraint_drag_target_${options.dragTarget.pointId}` as ConstraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
          dual2.sub(
            pointDual(columns, point),
            columns.constant2(options.dragTarget!.position),
          ),
        ),
        evaluateComponents(values) {
          return subtract(
            getPoint(values, point),
            options.dragTarget!.position,
          );
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const actual = getPoint(values, point);
          const delta = subtract(actual, options.dragTarget!.position);
          addPointGradient(gradient, point, delta[0], delta[1]);
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
    }
  }

  const parameterProjection = createDerivedParameterProjection({
    definition,
    parameterCount,
    pointRecords,
    entityStates,
    splineTangentStates,
    modelingTolerance: options.modelingTolerance,
    offsetPlans: options.offsetPlans,
  });

  for (const entity of definition.entities) {
    const state = entityStates.get(entity.entityId);
    const tau = options.modelingTolerance;
    if (entity.kind === "lineSegment") {
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (start && end)
        inequalityRows.push({
          record: {
            id: `segmentLength_${entity.entityId}`,
            kind: "segmentLength",
            entityId: entity.entityId,
          },
          support: pIdx(start, end),
          inequality: (columns) =>
            dual.sub(
              dual2.length(
                dual2.sub(pointDual(columns, end), pointDual(columns, start)),
              ),
              columns.constant(tau),
            ),
        });
    } else if (state?.kind === "circle" || state?.kind === "arc") {
      inequalityRows.push({
        record: {
          id: `radius_${entity.entityId}`,
          kind: "radius",
          entityId: entity.entityId,
        },
        support: [state.baseIndex],
        inequality: (columns) =>
          dual.sub(columns.variable(state.baseIndex), columns.constant(tau)),
      });
    }
  }
  const inequalities = inequalityRows.map(
    ({ record, support, inequality }): SolverInequalityRecord => ({
      ...record,
      variableIndices: parameterProjection.projectVariableIndices(support),
      evaluate: parameterProjection.wrapComponentJacobian(
        componentJacobian(support, (columns) => [inequality(columns)]),
        support,
      ),
    }),
  );

  const orientedTangencies = orientedTangencyRows.map(
    ({ record, support, component }): SolverOrientedTangencyRecord => ({
      ...record,
      variableIndices: parameterProjection.projectVariableIndices(support),
      evaluate: parameterProjection.wrapComponentJacobian(
        componentJacobian(support, (columns) => [component(columns)]),
        support,
      ),
    }),
  );

  const shellSourceVariables = new Map<SketchEntityId, readonly number[]>();
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "offset") continue;
    const sources = uniqueSortedIndices(
      relationship.seedEntityIds.flatMap(entityIdx),
    );
    for (const output of relationship.piecewiseCubicOutputs)
      shellSourceVariables.set(output.outputEntityId, sources);
  }
  const system: BuildSystemResult = {
    parameterCount,
    initialValues: parameterProjection.projectValues(initialValues),
    pointRecords,
    entityStates,
    splineTangentStates,
    parameterProjection,
    scalarConstraints,
    shellSourceVariables,
    inequalities,
    orientedTangencies,
  };
  const structuralVariables = structuralEquationVariableIndexMap(
    system,
    definition,
  );
  system.scalarConstraints = scalarConstraints.map((constraint) => {
    const variables =
      structuralVariables.get(constraint.id) ??
      constraint.structuralVariableIndices;
    return parameterProjection.wrapConstraint(
      constraint,
      variables && variables.length > 0 ? variables : undefined,
    );
  });
  return system;
}
