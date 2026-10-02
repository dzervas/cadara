import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
  SketchSolveDiagnostic,
  SolvedOffsetFramePlanRecord,
  SolvedSketchDerivedCubicSpan,
} from "@/contracts/sketch/schema";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  orderedSplineOccurrences,
  orderedSplinePointIds,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import { getAuthoredLiteralValue } from "@/contracts/modeling/authored-values";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import {
  prepareOffsetFrameDerivatives,
  solveOffsetFrame,
  type OffsetFrameCotangent,
  type OffsetFrameDerivatives,
  type OffsetFramePlan,
  type OffsetFrameRelationship,
  type OffsetSolveFrame,
} from "@/contracts/sketch/offset-derivation-frame";
import {
  mapOffsetFrameOutputs,
  offsetFrameCircleRadius,
  offsetFrameEntityCotangent,
  offsetFrameEntityJvp,
  offsetFramePointCotangent,
  offsetFramePointJvp,
  offsetFramePointValue,
  offsetFrameRelationshipOf,
  offsetFrameShellSpans,
  type OffsetFrameEntityDatum,
  type OffsetFrameOutputMap,
  type OffsetFramePointDatum,
} from "@/contracts/sketch/offset-derivation-outputs";

/** Explicit diagnostic: a derived shell used as a mirror/pattern/transform seed (U-G2). */
export const DERIVED_SHELL_SEED_UNSUPPORTED =
  "derived-offset-shell-seed-unsupported";

/** One derivation evaluation input: the definition iterate, τ and the offset plan hints. */
export interface SketchDerivationInput {
  readonly definition: SketchDefinition;
  /** The document's settings.modelingTolerance ([TECH] G12); never a default. */
  readonly modelingTolerance: number;
  /**
   * [TECH] G3/G17 per-relationship plan hints (the last publication, a
   * prior solved snapshot's `offsetFramePlans`, or a `planChanged` hint),
   * passed to `solveOffsetFrame` unchanged. Absent: the SEL first choice.
   */
  readonly offsetPlans?: readonly SolvedOffsetFramePlanRecord[];
  /**
   * T08b-g5 (the solver projection only): the offset solve frames' own owner
   * calls carry the source basis, so the pullback needs no second owner
   * call. Geometry is byte-identical either way.
   */
  readonly withDerivatives?: boolean;
}

/** τ and the offset plan hints of one derivation evaluation (callers thread them with a definition). */
export type SketchDerivationSettings = Omit<
  SketchDerivationInput,
  "definition" | "withDerivatives"
>;

/** The evaluated solve frame of one offset relationship and its output map. */
export interface OffsetDerivationFrameRecord {
  readonly derivationId: string;
  readonly relationship: OffsetFrameRelationship;
  /** The definition iterate the frame was solved on (its derivatives rebuild from it). */
  readonly definition: Pick<
    SketchDefinition,
    "points" | "entities" | "constraints"
  >;
  readonly frame: OffsetSolveFrame;
  readonly outputs: OffsetFrameOutputMap;
}

/** One offset relationship whose evaluation failed at this iterate (G16′). */
export interface OffsetDerivationFailure {
  readonly derivationId: string;
  /** Its one source-linked diagnostic (the solve frame's own, or the relationship's). */
  readonly diagnostic: SketchSolveDiagnostic;
}

export interface SketchDerivationEvaluationResult {
  definition: SketchDefinition;
  /** Sketch-scoped diagnostics (never an offset relationship's failure, G16′). */
  diagnostics: SketchSolveDiagnostic[];
  readonly modelingTolerance: number;
  /** Every offset relationship whose solve frame evaluated, in relationship order. */
  readonly offsetFrames: readonly OffsetDerivationFrameRecord[];
  /**
   * [TECH] G16′ (U-G9): every offset relationship that failed at this
   * iterate, in relationship order. A failure is relationship-scoped: the
   * relationship's outputs keep the iterate's values (frozen) and it is in
   * neither `offsetFrames` nor `diagnostics`.
   */
  readonly offsetFailures: readonly OffsetDerivationFailure[];
}

type TransformPoint = (point: SketchPoint2D) => SketchPoint2D;
type TransformVector = (vector: SplineVector) => SplineVector;

interface RelationshipTransform {
  point: TransformPoint;
  vector: TransformVector;
  pointDifferential: (
    point: SketchPoint2D,
    differential: SketchPoint2D,
  ) => SketchPoint2D;
  vectorDifferential: (
    vector: SplineVector,
    differential: SplineVector,
  ) => SplineVector;
}

export type SketchDerivedEntityVariation =
  | { kind: "circle"; radius: number }
  | {
      kind: "arc";
      radius: number;
      startAngle: number;
      endAngle: number;
    };

export interface SketchDerivationVariation {
  points?: Readonly<Partial<Record<SketchPointId, SketchPoint2D>>>;
  entities?: Readonly<
    Partial<Record<SketchEntityId, SketchDerivedEntityVariation>>
  >;
  splineTangents?: Readonly<
    Partial<Record<SketchEntityId, Readonly<Record<string, SplineVector>>>>
  >;
}

export interface SketchDerivationJvp {
  points: Readonly<Record<SketchPointId, SketchPoint2D>>;
  entities: Readonly<
    Partial<Record<SketchEntityId, SketchDerivedEntityVariation>>
  >;
  splineTangents: Readonly<
    Partial<Record<SketchEntityId, Readonly<Record<string, SplineVector>>>>
  >;
  /**
   * Offset relationships whose frame derivative is unavailable at this
   * iterate (`derivativeUnavailable`: a singular joint). Their outputs claim
   * no first-order motion; this is not zero motion, so consumers must not
   * treat it as such. Absent when every derivative is available.
   */
  derivativeUnavailable?: readonly string[];
}

/** A pullback, with the offset relationships it could not pull through (review A4). */
export type SketchDerivationPullbackResult = SketchDerivationVariation & {
  /** As `SketchDerivationJvp.derivativeUnavailable`: the gradient is incomplete, never zero. */
  derivativeUnavailable?: readonly string[];
};

export type SketchDerivationPullback = (
  cotangent: SketchDerivationVariation,
) => SketchDerivationPullbackResult;

const EPSILON = 1e-9;

function diagnostic(
  code: string,
  severity: SketchSolveDiagnostic["severity"],
  message: string,
  target: SketchSolveDiagnostic["target"],
): SketchSolveDiagnostic {
  return { code, severity, message, target };
}

function getEntityPointIds(
  entity: SketchEntityDefinition,
): readonly SketchPointId[] {
  switch (entity.kind) {
    case "lineSegment":
      return [entity.startPointId, entity.endPointId];
    case "point":
      return [entity.pointId];
    case "circle":
      return [entity.centerPointId];
    case "arc":
      return [entity.centerPointId, entity.startPointId, entity.endPointId];
    case "spline":
      return orderedSplinePointIds(entity);
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
    case "derivedPiecewiseCubic":
      return [];
  }
}

function supportsDerivedEntity(entity: SketchEntityDefinition) {
  return (
    entity.kind === "lineSegment" ||
    entity.kind === "point" ||
    entity.kind === "circle" ||
    entity.kind === "arc" ||
    entity.kind === "spline"
  );
}

function rotateAround(
  point: SketchPoint2D,
  origin: SketchPoint2D,
  angle: number,
  scale = 1,
): SketchPoint2D {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = (point[0] - origin[0]) * scale;
  const y = (point[1] - origin[1]) * scale;

  return [origin[0] + x * cos - y * sin, origin[1] + x * sin + y * cos];
}

function reflectAcrossLine(
  point: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D | null {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared <= EPSILON) {
    return null;
  }

  const t =
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / lengthSquared;
  const projection: SketchPoint2D = [start[0] + t * dx, start[1] + t * dy];

  return [projection[0] * 2 - point[0], projection[1] * 2 - point[1]];
}

function getMirrorTransform(
  relationship: Extract<SketchDerivationDefinition, { kind: "mirror" }>,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  pointById: Map<SketchPointId, SketchPointDefinition>,
  diagnostics: SketchSolveDiagnostic[],
  pointVariation?: Readonly<Record<SketchPointId, SketchPoint2D>>,
): RelationshipTransform | null {
  const axis = entityById.get(relationship.mirrorReference.entityId);
  if (!axis || axis.kind !== "lineSegment") {
    diagnostics.push(
      diagnostic(
        "derived-transform-missing-mirror-axis",
        "error",
        `Mirror relationship ${relationship.derivationId} references a missing or unsupported axis.`,
        axis ? { kind: "entity", entityId: axis.entityId } : null,
      ),
    );
    return null;
  }

  const start = pointById.get(axis.startPointId);
  const end = pointById.get(axis.endPointId);
  if (!start || !end) {
    diagnostics.push(
      diagnostic(
        "derived-transform-unsatisfied-mirror-axis",
        "error",
        `Mirror relationship ${relationship.derivationId} cannot resolve its axis points.`,
        { kind: "entity", entityId: axis.entityId },
      ),
    );
    return null;
  }

  const dx = end.position[0] - start.position[0];
  const dy = end.position[1] - start.position[1];
  const lengthSquared = dx * dx + dy * dy;
  const dStart = pointVariation?.[start.pointId] ?? ([0, 0] as const);
  const dEnd = pointVariation?.[end.pointId] ?? ([0, 0] as const);
  const dAxis: SketchPoint2D = [dEnd[0] - dStart[0], dEnd[1] - dStart[1]];
  const dLengthSquared = 2 * (dx * dAxis[0] + dy * dAxis[1]);
  const differentiateReflection = (
    value: SketchPoint2D,
    differential: SketchPoint2D,
    relativeToStart: boolean,
  ): SketchPoint2D => {
    const relative: SketchPoint2D = relativeToStart
      ? [value[0] - start.position[0], value[1] - start.position[1]]
      : value;
    const dRelative: SketchPoint2D = relativeToStart
      ? [differential[0] - dStart[0], differential[1] - dStart[1]]
      : differential;
    const numerator = relative[0] * dx + relative[1] * dy;
    const dNumerator =
      dRelative[0] * dx +
      dRelative[1] * dy +
      relative[0] * dAxis[0] +
      relative[1] * dAxis[1];
    const scale = numerator / lengthSquared;
    const dScale =
      (dNumerator * lengthSquared - numerator * dLengthSquared) /
      (lengthSquared * lengthSquared);
    const originDifferential: SketchPoint2D = relativeToStart
      ? [2 * dStart[0], 2 * dStart[1]]
      : [0, 0];
    return [
      originDifferential[0] +
        2 * (dScale * dx + scale * dAxis[0]) -
        differential[0],
      originDifferential[1] +
        2 * (dScale * dy + scale * dAxis[1]) -
        differential[1],
    ];
  };
  return {
    point: (point) => {
      const reflected = reflectAcrossLine(point, start.position, end.position);
      return reflected ?? point;
    },
    vector: (vector) => {
      const projectionScale = (vector[0] * dx + vector[1] * dy) / lengthSquared;
      return [
        2 * projectionScale * dx - vector[0],
        2 * projectionScale * dy - vector[1],
      ];
    },
    pointDifferential: (point, differential) =>
      differentiateReflection(point, differential, true),
    vectorDifferential: (vector, differential) =>
      differentiateReflection(vector, differential, false),
  };
}

function rotateVector(
  vector: SplineVector,
  angle: number,
  scale = 1,
): SplineVector {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    scale * (vector[0] * cos - vector[1] * sin),
    scale * (vector[0] * sin + vector[1] * cos),
  ];
}

function getRelationshipTransform(
  relationship: SketchDerivationDefinition,
  entityById: Map<SketchEntityId, SketchEntityDefinition>,
  pointById: Map<SketchPointId, SketchPointDefinition>,
  instanceIndex: number,
  diagnostics: SketchSolveDiagnostic[],
  pointVariation?: Readonly<Record<SketchPointId, SketchPoint2D>>,
): RelationshipTransform | null {
  switch (relationship.kind) {
    case "offset":
      // Offset relationships recompute per-segment geometry rather than a
      // point transform; they are evaluated by evaluateOffsetRelationship.
      return null;
    case "mirror":
      return getMirrorTransform(
        relationship,
        entityById,
        pointById,
        diagnostics,
        pointVariation,
      );
    case "linearPattern":
      return {
        point: (point) => [
          point[0] + relationship.vector[0] * instanceIndex,
          point[1] + relationship.vector[1] * instanceIndex,
        ],
        vector: (vector) => vector,
        pointDifferential: (_point, differential) => differential,
        vectorDifferential: (_vector, differential) => differential,
      };
    case "circularPattern": {
      const angle = relationship.angleRadians * instanceIndex;
      return {
        point: (point) => rotateAround(point, relationship.center, angle),
        vector: (vector) => rotateVector(vector, angle),
        pointDifferential: (_point, differential) =>
          rotateVector(differential, angle),
        vectorDifferential: (_vector, differential) =>
          rotateVector(differential, angle),
      };
    }
    case "transform":
      return {
        point: (point) => {
          const rotated = rotateAround(
            point,
            relationship.origin,
            relationship.rotationRadians,
            relationship.scale,
          );
          return [
            rotated[0] + relationship.translation[0],
            rotated[1] + relationship.translation[1],
          ];
        },
        vector: (vector) =>
          rotateVector(
            vector,
            relationship.rotationRadians,
            relationship.scale,
          ),
        pointDifferential: (_point, differential) =>
          rotateVector(
            differential,
            relationship.rotationRadians,
            relationship.scale,
          ),
        vectorDifferential: (_vector, differential) =>
          rotateVector(
            differential,
            relationship.rotationRadians,
            relationship.scale,
          ),
      };
  }
}

function transformedEntity(
  relationship: SketchDerivationDefinition,
  seed: SketchEntityDefinition,
  output: SketchEntityDefinition,
  transformVector: TransformVector,
): SketchEntityDefinition {
  if (seed.kind === "circle" && output.kind === "circle") {
    return {
      ...output,
      radius:
        relationship.kind === "transform"
          ? seed.radius * Math.abs(relationship.scale)
          : seed.radius,
    };
  }

  if (seed.kind === "arc" && output.kind === "arc") {
    return {
      ...output,
      sweepDirection:
        relationship.kind === "mirror"
          ? seed.sweepDirection === "clockwise"
            ? "counterClockwise"
            : "clockwise"
          : seed.sweepDirection,
    };
  }

  if (seed.kind === "spline" && output.kind === "spline") {
    const seedOccurrences = orderedSplineOccurrences(seed);
    const outputOccurrences = orderedSplineOccurrences(output);
    if (
      seedOccurrences &&
      outputOccurrences &&
      seedOccurrences.length === outputOccurrences.length
    ) {
      return {
        ...output,
        closure: seed.closure,
        interpolationPolicy: seed.interpolationPolicy,
        pointOccurrences: outputOccurrences.map((occurrence, index) => {
          const tangent = seedOccurrences[index]!.tangent;
          return {
            ...occurrence,
            tangent:
              tangent.kind === "authored"
                ? { kind: "authored", vector: transformVector(tangent.vector) }
                : tangent,
          };
        }),
      };
    }
  }

  return output;
}

const ZERO_VECTOR: SketchPoint2D = [0, 0];

function circleLikeVariationFromPoints(
  entity: Extract<SketchEntityDefinition, { kind: "arc" }>,
  pointById: Map<SketchPointId, SketchPointDefinition>,
  pointVariations: Readonly<Record<SketchPointId, SketchPoint2D>>,
): SketchDerivedEntityVariation | null {
  const center = pointById.get(entity.centerPointId)?.position;
  const start = pointById.get(entity.startPointId)?.position;
  const end = pointById.get(entity.endPointId)?.position;
  if (!center || !start || !end) return null;
  const centerVariation = pointVariations[entity.centerPointId] ?? ZERO_VECTOR;
  const startVariation = pointVariations[entity.startPointId] ?? ZERO_VECTOR;
  const endVariation = pointVariations[entity.endPointId] ?? ZERO_VECTOR;
  const startRelative: SketchPoint2D = [
    start[0] - center[0],
    start[1] - center[1],
  ];
  const endRelative: SketchPoint2D = [end[0] - center[0], end[1] - center[1]];
  const startDifferential: SketchPoint2D = [
    startVariation[0] - centerVariation[0],
    startVariation[1] - centerVariation[1],
  ];
  const endDifferential: SketchPoint2D = [
    endVariation[0] - centerVariation[0],
    endVariation[1] - centerVariation[1],
  ];
  const startLengthSquared = startRelative[0] ** 2 + startRelative[1] ** 2;
  const endLengthSquared = endRelative[0] ** 2 + endRelative[1] ** 2;
  if (startLengthSquared <= EPSILON || endLengthSquared <= EPSILON) return null;
  return {
    kind: "arc",
    radius:
      (startRelative[0] * startDifferential[0] +
        startRelative[1] * startDifferential[1]) /
      Math.sqrt(startLengthSquared),
    startAngle:
      (startRelative[0] * startDifferential[1] -
        startRelative[1] * startDifferential[0]) /
      startLengthSquared,
    endAngle:
      (endRelative[0] * endDifferential[1] -
        endRelative[1] * endDifferential[0]) /
      endLengthSquared,
  };
}

/** Applies exact directional derivatives of supported one-way derivations. */
export function evaluateSketchDerivationJvp(
  evaluation: SketchDerivationEvaluationResult,
  variation: SketchDerivationVariation,
): SketchDerivationJvp {
  const evaluatedDefinition = evaluation.definition;
  const offsetRecords = new Map(
    evaluation.offsetFrames.map((record) => [record.derivationId, record]),
  );
  const pointById = new Map(
    evaluatedDefinition.points.map((point) => [point.pointId, point]),
  );
  const entityById = new Map(
    evaluatedDefinition.entities.map((entity) => [entity.entityId, entity]),
  );
  const points = Object.fromEntries(
    evaluatedDefinition.points.map((point) => [
      point.pointId,
      variation.points?.[point.pointId] ?? ZERO_VECTOR,
    ]),
  ) as Record<SketchPointId, SketchPoint2D>;
  const entities: Partial<
    Record<SketchEntityId, SketchDerivedEntityVariation>
  > = { ...variation.entities };
  const splineTangents: Partial<
    Record<SketchEntityId, Record<string, SplineVector>>
  > = {};
  const derivativeUnavailable: string[] = [];

  for (const entity of evaluatedDefinition.entities) {
    if (entity.kind !== "spline") continue;
    const input = variation.splineTangents?.[entity.entityId];
    splineTangents[entity.entityId] = Object.fromEntries(
      (orderedSplineOccurrences(entity) ?? []).map((occurrence) => [
        occurrence.occurrenceId,
        input?.[occurrence.occurrenceId] ?? ZERO_VECTOR,
      ]),
    );
  }

  for (const relationship of evaluatedDefinition.derivedRelationships ?? []) {
    if (relationship.kind === "offset") {
      const record = offsetRecords.get(relationship.derivationId);
      // A failed relationship has no frame: its diagnostic already makes
      // the solve unaccepted, and its outputs keep their last state.
      if (!record) continue;
      const circleRadii: Record<string, number> = {};
      const seedTangents: Record<
        string,
        Readonly<Record<string, SplineVector>>
      > = {};
      for (const seedEntityId of relationship.seedEntityIds) {
        const seedVariation = entities[seedEntityId];
        if (seedVariation?.kind === "circle")
          circleRadii[seedEntityId] = seedVariation.radius;
        const tangents = splineTangents[seedEntityId];
        if (tangents) seedTangents[seedEntityId] = tangents;
      }
      const result = offsetRecordDerivatives(record).jvp([
        { points, splineTangents: seedTangents, circleRadii },
      ])[0]!;
      const jvp = "ok" in result ? null : result;
      // `derivativeUnavailable` (a singular joint, measure zero in the
      // solver's iterates): no first-order motion is claimed, and the
      // result says so explicitly.
      if (!jvp) derivativeUnavailable.push(relationship.derivationId);
      for (const [pointId, datum] of record.outputs.points)
        points[pointId] = jvp ? offsetFramePointJvp(jvp, datum) : ZERO_VECTOR;
      for (const [entityId, datum] of record.outputs.entities) {
        const entityJvp = jvp ? offsetFrameEntityJvp(jvp, datum) : null;
        if (entityJvp) entities[entityId] = entityJvp;
      }
      continue;
    }

    for (const output of relationship.outputs) {
      const seed = entityById.get(output.seedEntityId);
      const target = entityById.get(output.outputEntityId);
      if (
        !seed ||
        !target ||
        !supportsDerivedEntity(seed) ||
        seed.kind !== target.kind
      )
        continue;
      const seedPointIds =
        output.seedPointIds.length > 0
          ? output.seedPointIds
          : getEntityPointIds(seed);
      if (seedPointIds.length !== output.outputPointIds.length) continue;
      const transform = getRelationshipTransform(
        relationship,
        entityById,
        pointById,
        output.instanceIndex,
        [],
        points,
      );
      if (!transform) continue;

      for (let index = 0; index < seedPointIds.length; index += 1) {
        const seedPointId = seedPointIds[index]!;
        const outputPointId = output.outputPointIds[index]!;
        const seedPoint = pointById.get(seedPointId);
        if (!seedPoint) continue;
        points[outputPointId] = transform.pointDifferential(
          seedPoint.position,
          points[seedPointId] ?? ZERO_VECTOR,
        );
      }

      if (seed.kind === "circle" && target.kind === "circle") {
        const seedVariation = entities[seed.entityId];
        entities[target.entityId] = {
          kind: "circle",
          radius:
            (seedVariation?.kind === "circle" ? seedVariation.radius : 0) *
            (relationship.kind === "transform"
              ? Math.abs(relationship.scale)
              : 1),
        };
      } else if (seed.kind === "arc" && target.kind === "arc") {
        const targetVariation = circleLikeVariationFromPoints(
          target,
          pointById,
          points,
        );
        if (targetVariation) entities[target.entityId] = targetVariation;
      }

      if (seed.kind === "spline" && target.kind === "spline") {
        const seedOccurrences = orderedSplineOccurrences(seed) ?? [];
        const outputOccurrences = orderedSplineOccurrences(target) ?? [];
        if (seedOccurrences.length !== outputOccurrences.length) continue;
        const seedVariations = splineTangents[seed.entityId] ?? {};
        const outputVariations = splineTangents[target.entityId] ?? {};
        outputOccurrences.forEach((occurrence, index) => {
          const seedOccurrence = seedOccurrences[index]!;
          if (seedOccurrence.tangent.kind !== "authored") return;
          outputVariations[occurrence.occurrenceId] =
            transform.vectorDifferential(
              seedOccurrence.tangent.vector,
              seedVariations[seedOccurrence.occurrenceId] ?? ZERO_VECTOR,
            );
        });
        splineTangents[target.entityId] = outputVariations;
      }
    }
  }

  return {
    points,
    entities,
    splineTangents,
    ...(derivativeUnavailable.length > 0 ? { derivativeUnavailable } : {}),
  };
}

/**
 * Prepares a sparse reverse-mode derivative for an already evaluated derivation
 * frame. Only relationships upstream of the supplied cotangent are visited;
 * point/entity lookup data is shared by every residual evaluated in the frame.
 * Offset outputs are pulled back through their solve frame's fixed-topology
 * map (`prepareOffsetFrameDerivatives`, one cached basis per frame): seed
 * points, seed authored tangents and seed circle radii. No finite
 * differences.
 */
export function prepareSketchDerivationPullback(
  evaluation: SketchDerivationEvaluationResult,
): SketchDerivationPullback {
  const definition = evaluation.definition;
  const pointById = new Map(
    definition.points.map((point) => [point.pointId, point]),
  );
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  type PointProducer =
    | {
        kind: "offset";
        record: OffsetDerivationFrameRecord;
        datum: OffsetFramePointDatum;
      }
    | {
        kind: "transform";
        relationship: Exclude<SketchDerivationDefinition, { kind: "offset" }>;
        instanceIndex: number;
        seedPointId: SketchPointId;
      };
  interface TangentProducer {
    relationship: Exclude<SketchDerivationDefinition, { kind: "offset" }>;
    instanceIndex: number;
    seedEntityId: SketchEntityId;
    seedOccurrenceId: string;
  }
  const pointProducers = new Map<SketchPointId, PointProducer>();
  const entityProducers = new Set<SketchEntityId>();
  const offsetEntityProducers = new Map<
    SketchEntityId,
    { record: OffsetDerivationFrameRecord; datum: OffsetFrameEntityDatum }
  >();
  const tangentProducers = new Map<string, TangentProducer>();
  const tangentKey = (entityId: SketchEntityId, occurrenceId: string) =>
    `${entityId}\u0000${occurrenceId}`;

  for (const record of evaluation.offsetFrames) {
    for (const [pointId, datum] of record.outputs.points)
      pointProducers.set(pointId, { kind: "offset", record, datum });
    for (const [entityId, datum] of record.outputs.entities)
      offsetEntityProducers.set(entityId, { record, datum });
  }
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind === "offset") continue;
    for (const output of relationship.outputs) {
      const target = entityById.get(output.outputEntityId);
      entityProducers.add(output.outputEntityId);
      const seed = entityById.get(output.seedEntityId);
      if (
        !seed ||
        !target ||
        !supportsDerivedEntity(seed) ||
        seed.kind !== target.kind
      ) {
        continue;
      }
      const seedPointIds =
        output.seedPointIds.length > 0
          ? output.seedPointIds
          : getEntityPointIds(seed);
      if (seedPointIds.length !== output.outputPointIds.length) continue;
      output.outputPointIds.forEach((pointId, index) =>
        pointProducers.set(pointId, {
          kind: "transform",
          relationship,
          instanceIndex: output.instanceIndex,
          seedPointId: seedPointIds[index]!,
        }),
      );

      if (seed.kind !== "spline" || target.kind !== "spline") continue;
      const seedOccurrences = orderedSplineOccurrences(seed) ?? [];
      const outputOccurrences = orderedSplineOccurrences(target) ?? [];
      if (seedOccurrences.length !== outputOccurrences.length) continue;
      outputOccurrences.forEach((occurrence, index) => {
        const seedOccurrence = seedOccurrences[index]!;
        if (seedOccurrence.tangent.kind !== "authored") return;
        tangentProducers.set(
          tangentKey(target.entityId, occurrence.occurrenceId),
          {
            relationship,
            instanceIndex: output.instanceIndex,
            seedEntityId: seed.entityId,
            seedOccurrenceId: seedOccurrence.occurrenceId,
          },
        );
      });
    }
  }

  const axisPointIds = (
    relationship: Exclude<SketchDerivationDefinition, { kind: "offset" }>,
  ): readonly SketchPointId[] => {
    if (relationship.kind !== "mirror") return [];
    const axis = entityById.get(relationship.mirrorReference.entityId);
    return axis?.kind === "lineSegment"
      ? [axis.startPointId, axis.endPointId]
      : [];
  };
  const dotPoint = (first: SketchPoint2D, second: SketchPoint2D) =>
    first[0] * second[0] + first[1] * second[1];
  const isZero = (value: SketchPoint2D) => value[0] === 0 && value[1] === 0;

  return (cotangent) => {
    const points: Partial<Record<SketchPointId, SketchPoint2D>> = {};
    const entities: Partial<
      Record<SketchEntityId, SketchDerivedEntityVariation>
    > = {};
    const splineTangents: Partial<
      Record<SketchEntityId, Record<string, SplineVector>>
    > = {};
    const derivativeUnavailable = new Set<string>();
    const jvpOf = (variation: SketchDerivationVariation) => {
      const jvp = evaluateSketchDerivationJvp(evaluation, variation);
      for (const id of jvp.derivativeUnavailable ?? [])
        derivativeUnavailable.add(id);
      return jvp;
    };
    const addPoint = (pointId: SketchPointId, value: SketchPoint2D) => {
      if (isZero(value)) return;
      const current = points[pointId] ?? ZERO_VECTOR;
      points[pointId] = [current[0] + value[0], current[1] + value[1]];
    };
    const addEntity = (
      entityId: SketchEntityId,
      value: SketchDerivedEntityVariation,
    ) => {
      const current = entities[entityId];
      if (value.kind === "circle") {
        entities[entityId] = {
          kind: "circle",
          radius:
            (current?.kind === "circle" ? current.radius : 0) + value.radius,
        };
        return;
      }
      entities[entityId] = {
        kind: "arc",
        radius: (current?.kind === "arc" ? current.radius : 0) + value.radius,
        startAngle:
          (current?.kind === "arc" ? current.startAngle : 0) + value.startAngle,
        endAngle:
          (current?.kind === "arc" ? current.endAngle : 0) + value.endAngle,
      };
    };
    const addTangent = (
      entityId: SketchEntityId,
      occurrenceId: string,
      value: SplineVector,
    ) => {
      if (isZero(value)) return;
      const entity = splineTangents[entityId] ?? {};
      const current = entity[occurrenceId] ?? ZERO_VECTOR;
      entity[occurrenceId] = [current[0] + value[0], current[1] + value[1]];
      splineTangents[entityId] = entity;
    };
    /** Pulls one frame cotangent back onto the relationship's seeds. */
    const pullOffset = (
      record: OffsetDerivationFrameRecord,
      frameCotangent: OffsetFrameCotangent,
      visiting: ReadonlySet<SketchPointId>,
    ) => {
      const pulled = offsetRecordDerivatives(record).pullback(frameCotangent);
      // `derivativeUnavailable` (a singular joint): reported, never zero.
      if ("ok" in pulled) {
        derivativeUnavailable.add(record.derivationId);
        return;
      }
      for (const [pointId, value] of Object.entries(pulled.points ?? {}))
        pullPoint(pointId as SketchPointId, value, visiting);
      for (const [entityId, occurrences] of Object.entries(
        pulled.splineTangents ?? {},
      ))
        for (const [occurrenceId, value] of Object.entries(occurrences))
          pullTangent(
            entityId as SketchEntityId,
            occurrenceId,
            value,
            new Set(),
          );
      for (const [entityId, radius] of Object.entries(pulled.circleRadii ?? {}))
        if (radius !== 0)
          addEntity(entityId as SketchEntityId, { kind: "circle", radius });
    };
    const pullPoint = (
      pointId: SketchPointId,
      value: SketchPoint2D,
      visiting: ReadonlySet<SketchPointId>,
    ) => {
      if (isZero(value)) return;
      const producer = pointProducers.get(pointId);
      if (!producer) {
        addPoint(pointId, value);
        return;
      }
      if (visiting.has(pointId)) return;
      const nextVisiting = new Set(visiting).add(pointId);
      if (producer.kind === "offset") {
        pullOffset(
          producer.record,
          offsetFramePointCotangent(producer.datum, value),
          nextVisiting,
        );
        return;
      }
      const seedPoint = pointById.get(producer.seedPointId);
      if (!seedPoint) return;
      const dependencies = [
        producer.seedPointId,
        ...axisPointIds(producer.relationship),
      ].filter((dependency, index, all) => all.indexOf(dependency) === index);
      for (const dependency of dependencies) {
        const pulled: [number, number] = [0, 0];
        for (let component = 0; component < 2; component += 1) {
          const basis: SketchPoint2D = component === 0 ? [1, 0] : [0, 1];
          const transform = getRelationshipTransform(
            producer.relationship,
            entityById,
            pointById,
            producer.instanceIndex,
            [],
            { [dependency]: basis } as Readonly<
              Record<SketchPointId, SketchPoint2D>
            >,
          );
          if (!transform) continue;
          const differential = transform.pointDifferential(
            seedPoint.position,
            dependency === producer.seedPointId ? basis : ZERO_VECTOR,
          );
          pulled[component] = dotPoint(value, differential);
        }
        pullPoint(dependency, pulled, nextVisiting);
      }
    };
    const pullTangent = (
      entityId: SketchEntityId,
      occurrenceId: string,
      value: SplineVector,
      visiting: ReadonlySet<string>,
    ) => {
      if (isZero(value)) return;
      const key = tangentKey(entityId, occurrenceId);
      const producer = tangentProducers.get(key);
      if (!producer) {
        addTangent(entityId, occurrenceId, value);
        return;
      }
      if (visiting.has(key)) return;
      const seed = entityById.get(producer.seedEntityId);
      if (seed?.kind !== "spline") return;
      const seedOccurrence = (orderedSplineOccurrences(seed) ?? []).find(
        (occurrence) => occurrence.occurrenceId === producer.seedOccurrenceId,
      );
      if (!seedOccurrence || seedOccurrence.tangent.kind !== "authored") return;
      const nextVisiting = new Set(visiting).add(key);
      const pulledSeed: [number, number] = [0, 0];
      for (let component = 0; component < 2; component += 1) {
        const basis: SplineVector = component === 0 ? [1, 0] : [0, 1];
        const transform = getRelationshipTransform(
          producer.relationship,
          entityById,
          pointById,
          producer.instanceIndex,
          [],
        );
        if (!transform) continue;
        pulledSeed[component] = dotPoint(
          value,
          transform.vectorDifferential(seedOccurrence.tangent.vector, basis),
        );
      }
      pullTangent(
        producer.seedEntityId,
        producer.seedOccurrenceId,
        pulledSeed,
        nextVisiting,
      );
      for (const axisPointId of axisPointIds(producer.relationship)) {
        const pulledAxis: [number, number] = [0, 0];
        for (let component = 0; component < 2; component += 1) {
          const basis: SketchPoint2D = component === 0 ? [1, 0] : [0, 1];
          const transform = getRelationshipTransform(
            producer.relationship,
            entityById,
            pointById,
            producer.instanceIndex,
            [],
            { [axisPointId]: basis } as Readonly<
              Record<SketchPointId, SketchPoint2D>
            >,
          );
          if (!transform) continue;
          pulledAxis[component] = dotPoint(
            value,
            transform.vectorDifferential(
              seedOccurrence.tangent.vector,
              ZERO_VECTOR,
            ),
          );
        }
        pullPoint(axisPointId, pulledAxis, new Set());
      }
    };

    for (const [pointId, value] of Object.entries(cotangent.points ?? {})) {
      if (value) pullPoint(pointId as SketchPointId, value, new Set());
    }
    for (const [outputEntityId, value] of Object.entries(
      cotangent.entities ?? {},
    )) {
      if (!value) continue;
      const offsetProducer = offsetEntityProducers.get(
        outputEntityId as SketchEntityId,
      );
      if (offsetProducer) {
        const frameCotangent = offsetFrameEntityCotangent(
          offsetProducer.datum,
          value,
        );
        if (frameCotangent)
          pullOffset(offsetProducer.record, frameCotangent, new Set());
        continue;
      }
      if (!entityProducers.has(outputEntityId as SketchEntityId)) {
        addEntity(outputEntityId as SketchEntityId, value);
        continue;
      }
      const scalarDot = (
        variation: SketchDerivedEntityVariation | undefined,
      ) => {
        if (!variation || variation.kind !== value.kind) return 0;
        return value.kind === "circle" && variation.kind === "circle"
          ? value.radius * variation.radius
          : value.kind === "arc" && variation.kind === "arc"
            ? value.radius * variation.radius +
              value.startAngle * variation.startAngle +
              value.endAngle * variation.endAngle
            : 0;
      };
      for (const point of definition.points) {
        if (pointProducers.has(point.pointId)) continue;
        const pulled: [number, number] = [0, 0];
        for (let component = 0; component < 2; component += 1) {
          const basis: SketchPoint2D = component === 0 ? [1, 0] : [0, 1];
          pulled[component] = scalarDot(
            jvpOf({
              points: { [point.pointId]: basis },
            }).entities[outputEntityId as SketchEntityId],
          );
        }
        addPoint(point.pointId, pulled);
      }
      for (const entity of definition.entities) {
        if (
          entity.kind !== "circle" ||
          entityProducers.has(entity.entityId) ||
          offsetEntityProducers.has(entity.entityId)
        ) {
          continue;
        }
        const radius = scalarDot(
          jvpOf({
            entities: {
              [entity.entityId]: { kind: "circle", radius: 1 },
            },
          }).entities[outputEntityId as SketchEntityId],
        );
        if (radius !== 0) {
          addEntity(entity.entityId, { kind: "circle", radius });
        }
      }
    }
    for (const [entityId, occurrences] of Object.entries(
      cotangent.splineTangents ?? {},
    )) {
      for (const [occurrenceId, value] of Object.entries(occurrences ?? {})) {
        pullTangent(entityId as SketchEntityId, occurrenceId, value, new Set());
      }
    }
    return {
      points,
      entities,
      splineTangents,
      ...(derivativeUnavailable.size > 0
        ? { derivativeUnavailable: [...derivativeUnavailable] }
        : {}),
    };
  };
}

/**
 * Evaluates one offset relationship's solve frame ([TECH] G3/G4: the
 * certifier-free `solveOffsetFrame`, run with the relationship's plan hint)
 * and writes its published data onto the authored outputs. All updates are
 * collected before any is applied, so a failing relationship keeps its
 * outputs in their last state (frozen); its failure is relationship-scoped
 * ([TECH] G16′): reported in `failures`, never a sketch diagnostic.
 */
function evaluateOffsetRelationship(
  relationship: Extract<SketchDerivationDefinition, { kind: "offset" }>,
  iterate: Pick<SketchDefinition, "points" | "entities" | "constraints">,
  context: {
    readonly modelingTolerance: number;
    readonly plan: OffsetFramePlan | undefined;
    readonly withDerivatives: boolean;
    readonly entityById: ReadonlyMap<SketchEntityId, SketchEntityDefinition>;
    readonly failures: OffsetDerivationFailure[];
    readonly replacePoint: (
      pointId: SketchPointId,
      position: SketchPoint2D,
    ) => void;
    readonly replaceEntity: (entity: SketchEntityDefinition) => void;
  },
): OffsetDerivationFrameRecord | null {
  const fail = (
    code: string,
    message: string,
    entityId: SketchEntityId | null = relationship.seedEntityIds[0] ?? null,
  ) => {
    context.failures.push({
      derivationId: relationship.derivationId,
      diagnostic: diagnostic(
        code,
        "error",
        `Offset relationship ${relationship.derivationId}: ${message}`,
        entityId ? { kind: "entity", entityId } : null,
      ),
    });
    return null;
  };

  const distance = getAuthoredLiteralValue<number>(relationship.distance);
  if (typeof distance !== "number" || !Number.isFinite(distance))
    return fail(
      OFFSET_DIAGNOSTIC_CODES.unresolvedDistance,
      "distance is unresolved; resolve expressions before evaluating derivations.",
      null,
    );
  const frameRelationship = offsetFrameRelationshipOf(
    relationship,
    distance,
    iterate,
  );
  if (!frameRelationship)
    return fail(
      OFFSET_DIAGNOSTIC_CODES.topologyChanged,
      "an authored joint arc no longer joins adjacent seeds of the chain.",
    );
  const frame = solveOffsetFrame(
    {
      relationship: frameRelationship,
      definition: iterate,
      modelingTolerance: context.modelingTolerance,
      withSourceBasis: context.withDerivatives,
    },
    context.plan,
  );
  if (!frame.ok) {
    context.failures.push({
      derivationId: relationship.derivationId,
      diagnostic: frame.diagnostic,
    });
    return null;
  }
  const outputs = mapOffsetFrameOutputs(
    relationship,
    frame,
    (entityId) => context.entityById.get(entityId)?.kind,
  );
  if (typeof outputs === "string")
    return fail(OFFSET_DIAGNOSTIC_CODES.topologyChanged, outputs);

  for (const [pointId, datum] of outputs.points)
    context.replacePoint(pointId, offsetFramePointValue(frame, datum));
  for (const [entityId, datum] of outputs.entities) {
    const entity = context.entityById.get(entityId);
    if (datum.kind === "circle" && entity?.kind === "circle")
      context.replaceEntity({
        ...entity,
        radius: offsetFrameCircleRadius(frame, datum.seed),
      });
    const sweep = outputs.sweeps.get(entityId);
    if (entity?.kind === "arc" && sweep && entity.sweepDirection !== sweep)
      context.replaceEntity({ ...entity, sweepDirection: sweep });
  }
  return {
    derivationId: relationship.derivationId,
    relationship: frameRelationship,
    definition: iterate,
    frame,
    outputs,
  };
}

const offsetDerivatives = new WeakMap<
  OffsetDerivationFrameRecord,
  OffsetFrameDerivatives
>();

/** The (cached, one per frame) fixed-topology derivatives of one offset frame record. */
export function offsetRecordDerivatives(
  record: OffsetDerivationFrameRecord,
): OffsetFrameDerivatives {
  let derivatives = offsetDerivatives.get(record);
  if (!derivatives) {
    derivatives = prepareOffsetFrameDerivatives(
      {
        relationship: record.relationship,
        definition: record.definition,
        modelingTolerance: record.frame.modelingTolerance,
      },
      record.frame,
    );
    offsetDerivatives.set(record, derivatives);
  }
  return derivatives;
}

/** [TECH] G17: the plan every evaluated offset frame ran (solved revision data). */
export function solvedOffsetFramePlans(
  evaluation: SketchDerivationEvaluationResult,
): SolvedOffsetFramePlanRecord[] {
  return evaluation.offsetFrames.map((record) => ({
    derivationId: record.derivationId,
    plan: record.frame.plan,
  }));
}

/** The provisional solved spans of every evaluated shell, by shell entity id. */
export function solvedOffsetShellSpans(
  evaluation: SketchDerivationEvaluationResult,
): ReadonlyMap<SketchEntityId, SolvedSketchDerivedCubicSpan[]> {
  const spans = new Map<SketchEntityId, SolvedSketchDerivedCubicSpan[]>();
  for (const record of evaluation.offsetFrames)
    for (const shell of record.outputs.shells)
      spans.set(shell.entityId, offsetFrameShellSpans(record.frame, shell));
  return spans;
}

let cachedDerivationInput: SketchDerivationInput | null = null;
let cachedDerivationResult: SketchDerivationEvaluationResult | null = null;

/**
 * Evaluates every derived relationship of one definition iterate. Offsets
 * run their certifier-free solve frame at the document modeling tolerance τ
 * with the given per-relationship plan hint ([TECH] G3/G17); there is no
 * default τ. Memoized on (definition identity, τ, plan-hint identity).
 */
export function evaluateSketchDerivations(
  input: SketchDerivationInput,
): SketchDerivationEvaluationResult {
  const { definition, modelingTolerance, offsetPlans } = input;
  const withDerivatives = input.withDerivatives === true;
  if (
    cachedDerivationInput &&
    cachedDerivationResult &&
    cachedDerivationInput.definition === definition &&
    cachedDerivationInput.modelingTolerance === modelingTolerance &&
    cachedDerivationInput.offsetPlans === offsetPlans &&
    (cachedDerivationInput.withDerivatives === true) === withDerivatives
  ) {
    return cachedDerivationResult;
  }

  const relationships = definition.derivedRelationships ?? [];
  if (relationships.length === 0) {
    cachedDerivationInput = input;
    cachedDerivationResult = {
      definition,
      diagnostics: [],
      modelingTolerance,
      offsetFrames: [],
      offsetFailures: [],
    };
    return cachedDerivationResult;
  }

  const diagnostics: SketchSolveDiagnostic[] = [];
  const offsetFrames: OffsetDerivationFrameRecord[] = [];
  const offsetFailures: OffsetDerivationFailure[] = [];
  const pointById = new Map<SketchPointId, SketchPointDefinition>();
  const pointIndicesById = new Map<SketchPointId, number[]>();
  definition.points.forEach((point, index) => {
    pointById.set(point.pointId, point);
    const indices = pointIndicesById.get(point.pointId) ?? [];
    indices.push(index);
    pointIndicesById.set(point.pointId, indices);
  });
  const entityById = new Map<SketchEntityId, SketchEntityDefinition>();
  const entityIndicesById = new Map<SketchEntityId, number[]>();
  definition.entities.forEach((entity, index) => {
    entityById.set(entity.entityId, entity);
    const indices = entityIndicesById.get(entity.entityId) ?? [];
    indices.push(index);
    entityIndicesById.set(entity.entityId, indices);
  });
  const nextPoints = [...definition.points];
  const nextEntities = [...definition.entities];

  const replacePoint = (pointId: SketchPointId, position: SketchPoint2D) => {
    const current = pointById.get(pointId);
    if (!current) {
      return;
    }

    const next = { ...current, position };
    pointById.set(pointId, next);
    for (const index of pointIndicesById.get(pointId) ?? []) {
      nextPoints[index] = next;
    }
  };

  const replaceEntity = (entity: SketchEntityDefinition) => {
    entityById.set(entity.entityId, entity);
    for (const index of entityIndicesById.get(entity.entityId) ?? []) {
      nextEntities[index] = entity;
    }
  };

  for (const relationship of relationships) {
    if (relationship.kind === "offset") {
      const record = evaluateOffsetRelationship(
        relationship,
        {
          points: [...nextPoints],
          entities: [...nextEntities],
          constraints: definition.constraints,
        },
        {
          modelingTolerance,
          withDerivatives,
          plan: offsetPlans?.find(
            (entry) => entry.derivationId === relationship.derivationId,
          )?.plan,
          entityById,
          failures: offsetFailures,
          replacePoint,
          replaceEntity,
        },
      );
      if (record) offsetFrames.push(record);
      continue;
    }

    for (const output of relationship.outputs) {
      const seed = entityById.get(output.seedEntityId);
      const target = entityById.get(output.outputEntityId);
      if (!seed) {
        diagnostics.push(
          diagnostic(
            "derived-transform-missing-seed",
            "error",
            `Derived relationship ${relationship.derivationId} references missing seed entity ${output.seedEntityId}.`,
            { kind: "entity", entityId: output.seedEntityId },
          ),
        );
        continue;
      }

      if (!target) {
        diagnostics.push(
          diagnostic(
            "derived-transform-missing-output",
            "error",
            `Derived relationship ${relationship.derivationId} references missing output entity ${output.outputEntityId}.`,
            { kind: "entity", entityId: output.seedEntityId },
          ),
        );
        continue;
      }

      if (seed.kind === "derivedPiecewiseCubic") {
        // U-G2: a derived shell is never the seed of a derived operator.
        diagnostics.push(
          diagnostic(
            DERIVED_SHELL_SEED_UNSUPPORTED,
            "error",
            `Derived relationship ${relationship.derivationId} uses the derived offset curve ${seed.entityId} as a seed; mirroring, patterning or transforming an offset spline curve is not supported yet.`,
            { kind: "entity", entityId: seed.entityId },
          ),
        );
        continue;
      }

      if (!supportsDerivedEntity(seed) || seed.kind !== target.kind) {
        diagnostics.push(
          diagnostic(
            "derived-transform-unsupported-entity",
            "warning",
            `${seed.kind} ${seed.entityId} is valid sketch geometry, but this derived transform evaluator does not support it yet.`,
            { kind: "entity", entityId: seed.entityId },
          ),
        );
        continue;
      }

      const seedPointIds =
        output.seedPointIds.length > 0
          ? output.seedPointIds
          : getEntityPointIds(seed);
      if (seedPointIds.length !== output.outputPointIds.length) {
        diagnostics.push(
          diagnostic(
            "derived-transform-output-map-invalid",
            "error",
            `Derived relationship ${relationship.derivationId} has mismatched seed and output point maps.`,
            { kind: "entity", entityId: output.outputEntityId },
          ),
        );
        continue;
      }

      const transform = getRelationshipTransform(
        relationship,
        entityById,
        pointById,
        output.instanceIndex,
        diagnostics,
      );
      if (!transform) {
        continue;
      }

      for (let index = 0; index < seedPointIds.length; index += 1) {
        const seedPointId = seedPointIds[index]!;
        const outputPointId = output.outputPointIds[index]!;
        const seedPoint = pointById.get(seedPointId);
        const outputPoint = pointById.get(outputPointId);

        if (!seedPoint || !outputPoint) {
          diagnostics.push(
            diagnostic(
              "derived-transform-unsatisfied-point-map",
              "error",
              `Derived relationship ${relationship.derivationId} cannot resolve point map ${seedPointId} -> ${outputPointId}.`,
              { kind: "entity", entityId: output.outputEntityId },
            ),
          );
          continue;
        }

        replacePoint(outputPointId, transform.point(seedPoint.position));
      }

      replaceEntity(
        transformedEntity(relationship, seed, target, transform.vector),
      );
    }
  }

  const result: SketchDerivationEvaluationResult = {
    definition: {
      ...definition,
      points: nextPoints,
      entities: nextEntities,
    },
    diagnostics,
    modelingTolerance,
    offsetFrames,
    offsetFailures,
  };
  cachedDerivationInput = input;
  cachedDerivationResult = result;
  return result;
}
