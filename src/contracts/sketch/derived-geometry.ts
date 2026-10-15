import type {
  DerivableSketchDefinition,
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
  offsetDeletedOutput,
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
import { canonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";
import {
  applyMirrorOutputStructure,
  applyMirrorOutputValues,
  evaluateMirrorRelationship,
  mirrorArcVariablesJvp,
  mirrorArcVariablesVjp,
  mirrorPointJvp,
  mirrorPointVjp,
  mirrorVectorJvp,
  mirrorVectorVjp,
  orderDerivedRelationships,
  RELATIONSHIP_NOUN,
  type MirrorArcVariables,
  type MirrorAxis,
  type MirrorAxisCotangent,
  type MirrorOutputEvaluation,
  type MirrorRelationshipFailure,
} from "@/contracts/sketch/mirror-requirements";

/** Explicit diagnostic: a derived shell used as a mirror/pattern/transform seed (U-G2). */
export const DERIVED_SHELL_SEED_UNSUPPORTED =
  "derived-offset-shell-seed-unsupported";

// T17p2 (F-2): derivation never reads dimensions, so it evaluates the
// authored definition (editor display, commit, creation) and the solver's
// resolved one alike, and returns the kind it was given.
/** One derivation evaluation input: the definition iterate, τ and the offset plan hints. */
export interface SketchDerivationInput<
  TDefinition extends DerivableSketchDefinition = SketchDefinition,
> {
  readonly definition: TDefinition;
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
  /**
   * T15b (R-4, the solver projection only): the solver slots [r, θs, θe] of
   * every arc whose slots are authority (not driven). With them a mirror
   * output arc's variables are the reflection of its seed arc's variables
   * (`MirrorDerivationRecord`), in dependency order. Absent (display,
   * commit, creation, compile): arcs are their mirrored points plus the
   * flipped sweep.
   */
  readonly arcVariables?: ReadonlyMap<SketchEntityId, MirrorArcVariables>;
}

/** τ and the offset plan hints of one derivation evaluation (callers thread them with a definition). */
export type SketchDerivationSettings = Omit<
  SketchDerivationInput,
  "definition" | "withDerivatives" | "arcVariables"
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

/**
 * One mirror relationship evaluated by the owner at this iterate (T15b):
 * its axis and output values, read by the JVP and the pullback.
 */
export interface MirrorDerivationRecord {
  readonly derivationId: string;
  readonly axis: MirrorAxis;
  readonly outputs: readonly MirrorOutputEvaluation[];
  /**
   * Solver path only (`arcVariables` given), per seed arc entity: whether
   * its variables were solver slots or an upstream mirror's output
   * (`variables`), or the point formula of a driven point-defined arc
   * (`points`: offset seeds and outputs, pattern/transform outputs).
   */
  readonly seedArcSources: ReadonlyMap<SketchEntityId, "variables" | "points">;
}

export interface SketchDerivationEvaluationResult<
  TDefinition extends DerivableSketchDefinition = DerivableSketchDefinition,
> {
  definition: TDefinition;
  /**
   * Sketch-scoped diagnostics (never an offset relationship's failure,
   * G16′, nor a mirror or unresolved relationship's failure, T15b).
   */
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
  /**
   * T15b ([TECH] T-8/T-16): every non-offset relationship that failed at
   * this iterate, one failure each, in relationship order: a mirror the
   * owner rejects (missing or degenerate axis, stale map) and any
   * relationship whose dependencies cannot be ordered
   * (`derived-relationship-dependency-unresolved`). Its outputs keep the
   * iterate's values (held); the solver reports the failure as an error
   * and the outputs as non-accepted.
   */
  readonly derivedFailures: readonly MirrorRelationshipFailure[];
  /** Every mirror relationship the owner evaluated, in evaluation order. */
  readonly mirrorFrames: readonly MirrorDerivationRecord[];
  /** Solver path only: the variables of every evaluated mirror output arc. */
  readonly mirrorArcVariables: ReadonlyMap<SketchEntityId, MirrorArcVariables>;
  /** The evaluation (dependency) order of the resolved relationships ([TECH] T-9). */
  readonly relationshipOrder: readonly SketchDerivationDefinition[];
}

/**
 * The solver variables [r, θs, θe] of a point-defined arc: the canonical
 * support radius and the atan2 angles of its end points (the solver's
 * driven-arc projection, R-g3).
 */
export function pointDefinedArcVariables(
  center: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: "clockwise" | "counterClockwise",
): MirrorArcVariables {
  const startOffset: SketchPoint2D = [
    start[0] - center[0],
    start[1] - center[1],
  ];
  const endOffset: SketchPoint2D = [end[0] - center[0], end[1] - center[1]];
  return {
    radius: canonicalArcSupport(center, start, end, sweepDirection).radius,
    startAngle: Math.atan2(startOffset[1], startOffset[0]),
    endAngle: Math.atan2(endOffset[1], endOffset[0]),
  };
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

/** A pattern or transform relationship (offsets and mirrors have their own owners). */
type PointTransformRelationship = Exclude<
  SketchDerivationDefinition,
  { kind: "offset" | "mirror" }
>;

/**
 * The point transform of one pattern/transform instance. Mirrors are owned
 * by `mirror-requirements.ts` (T15b, [TECH] T-2); offsets recompute their
 * geometry in `evaluateOffsetRelationship`.
 */
function getRelationshipTransform(
  relationship: PointTransformRelationship,
  instanceIndex: number,
): RelationshipTransform {
  switch (relationship.kind) {
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
  relationship: PointTransformRelationship,
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
    return { ...output, sweepDirection: seed.sweepDirection };
  }

  if (seed.kind === "spline" && output.kind === "spline") {
    const seedOccurrences = orderedSplineOccurrences(seed);
    const outputOccurrences = orderedSplineOccurrences(output);
    if (
      seedOccurrences &&
      outputOccurrences &&
      seedOccurrences.length === outputOccurrences.length
    ) {
      const copy: Extract<SketchEntityDefinition, { kind: "spline" }> = {
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
      // T10g option B: set from the seed, never inherited from the stale
      // output (A-6). A transform scales chords by |s|, so centripetal
      // parameter lengths by √|s|; the other relationships are isometries.
      const fixed = seed.endSpanParameterLengths;
      if (!fixed) {
        delete copy.endSpanParameterLengths;
        return copy;
      }
      const factor =
        relationship.kind === "transform"
          ? Math.sqrt(Math.abs(relationship.scale))
          : 1;
      copy.endSpanParameterLengths = {
        ...(fixed.start === undefined ? {} : { start: fixed.start * factor }),
        ...(fixed.end === undefined ? {} : { end: fixed.end * factor }),
      };
      return copy;
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

/**
 * The axis variation of a line mirror axis read from a point variation
 * (undefined for a datum axis, which has no variables).
 */
function mirrorAxisVariationOf(
  axis: MirrorAxis,
  points: Readonly<Partial<Record<SketchPointId, SketchPoint2D>>>,
) {
  return axis.kind === "line"
    ? {
        start: points[axis.startPointId] ?? ZERO_VECTOR,
        end: points[axis.endPointId] ?? ZERO_VECTOR,
      }
    : undefined;
}

/**
 * Applies exact directional derivatives of the evaluated derivations, in
 * their evaluation (dependency) order. Mirror outputs use the owner's JVPs
 * (T15b); on the solver path an output arc's variation is the reflection
 * of its seed arc's variable variation (R-4). Failed relationships claim no
 * motion: their outputs are held.
 */
export function evaluateSketchDerivationJvp(
  evaluation: SketchDerivationEvaluationResult,
  variation: SketchDerivationVariation,
): SketchDerivationJvp {
  const evaluatedDefinition = evaluation.definition;
  const offsetRecords = new Map(
    evaluation.offsetFrames.map((record) => [record.derivationId, record]),
  );
  const mirrorRecords = new Map(
    evaluation.mirrorFrames.map((record) => [record.derivationId, record]),
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

  for (const relationship of evaluation.relationshipOrder) {
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

    if (relationship.kind === "mirror") {
      const record = mirrorRecords.get(relationship.derivationId);
      // A failed mirror is held: its outputs claim no motion.
      if (!record) continue;
      const { axis } = record;
      const axisVariation = mirrorAxisVariationOf(axis, points);
      for (const output of record.outputs) {
        for (const point of output.points)
          points[point.outputPointId] = mirrorPointJvp(
            axis,
            pointById.get(point.seedPointId)!.position,
            points[point.seedPointId] ?? ZERO_VECTOR,
            axisVariation,
          );
        const seed = entityById.get(output.seedEntityId)!;
        const target = entityById.get(output.outputEntityId)!;
        if (seed.kind === "circle") {
          const seedVariation = entities[seed.entityId];
          entities[target.entityId] = {
            kind: "circle",
            radius: seedVariation?.kind === "circle" ? seedVariation.radius : 0,
          };
        } else if (seed.kind === "arc" && target.kind === "arc") {
          // R-4: on the solver path from the seed arc's variable variation
          // (a point-defined seed's from its points); else point-based.
          const seedVariation = !output.arc
            ? null
            : record.seedArcSources.get(seed.entityId) === "points"
              ? circleLikeVariationFromPoints(seed, pointById, points)
              : entities[seed.entityId];
          const targetVariation = output.arc
            ? {
                kind: "arc" as const,
                ...mirrorArcVariablesJvp(
                  axis,
                  seedVariation?.kind === "arc"
                    ? seedVariation
                    : { radius: 0, startAngle: 0, endAngle: 0 },
                  axisVariation,
                ),
              }
            : circleLikeVariationFromPoints(target, pointById, points);
          if (targetVariation) entities[target.entityId] = targetVariation;
        } else if (seed.kind === "spline" && target.kind === "spline") {
          const seedVariations = splineTangents[seed.entityId] ?? {};
          const outputVariations = splineTangents[target.entityId] ?? {};
          const seedVectors = new Map(
            (orderedSplineOccurrences(seed) ?? []).flatMap((occurrence) =>
              occurrence.tangent.kind === "authored"
                ? [[occurrence.occurrenceId, occurrence.tangent.vector]]
                : [],
            ),
          );
          for (const tangent of output.tangents)
            outputVariations[tangent.outputOccurrenceId] = mirrorVectorJvp(
              axis,
              seedVectors.get(tangent.seedOccurrenceId)!,
              seedVariations[tangent.seedOccurrenceId] ?? ZERO_VECTOR,
              axisVariation,
            );
          splineTangents[target.entityId] = outputVariations;
        }
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
        output.instanceIndex,
      );

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
 * The transpose of `circleLikeVariationFromPoints`: an arc cotangent
 * (radius, start angle, end angle) on a point-defined arc as cotangents on
 * its centre, start and end points (null where that map is degenerate).
 */
function circleLikeCotangentToPoints(
  entity: Extract<SketchEntityDefinition, { kind: "arc" }>,
  pointById: ReadonlyMap<SketchPointId, SketchPointDefinition>,
  cotangent: MirrorArcVariables,
): ReadonlyMap<SketchPointId, SketchPoint2D> | null {
  const center = pointById.get(entity.centerPointId)?.position;
  const start = pointById.get(entity.startPointId)?.position;
  const end = pointById.get(entity.endPointId)?.position;
  if (!center || !start || !end) return null;
  const startRelative: SketchPoint2D = [
    start[0] - center[0],
    start[1] - center[1],
  ];
  const endRelative: SketchPoint2D = [end[0] - center[0], end[1] - center[1]];
  const startLengthSquared = startRelative[0] ** 2 + startRelative[1] ** 2;
  const endLengthSquared = endRelative[0] ** 2 + endRelative[1] ** 2;
  if (startLengthSquared <= EPSILON || endLengthSquared <= EPSILON) return null;
  const startLength = Math.sqrt(startLengthSquared);
  const startCotangent: SketchPoint2D = [
    (cotangent.radius * startRelative[0]) / startLength -
      (cotangent.startAngle * startRelative[1]) / startLengthSquared,
    (cotangent.radius * startRelative[1]) / startLength +
      (cotangent.startAngle * startRelative[0]) / startLengthSquared,
  ];
  const endCotangent: SketchPoint2D = [
    (-cotangent.endAngle * endRelative[1]) / endLengthSquared,
    (cotangent.endAngle * endRelative[0]) / endLengthSquared,
  ];
  const points = new Map<SketchPointId, SketchPoint2D>();
  const add = (pointId: SketchPointId, value: SketchPoint2D) => {
    const current = points.get(pointId) ?? ZERO_VECTOR;
    points.set(pointId, [current[0] + value[0], current[1] + value[1]]);
  };
  add(entity.startPointId, startCotangent);
  add(entity.endPointId, endCotangent);
  add(entity.centerPointId, [
    -startCotangent[0] - endCotangent[0],
    -startCotangent[1] - endCotangent[1],
  ]);
  return points;
}

/**
 * Prepares a sparse reverse-mode derivative for an already evaluated derivation
 * frame. Only relationships upstream of the supplied cotangent are visited;
 * point/entity lookup data is shared by every residual evaluated in the frame.
 * Offset outputs are pulled back through their solve frame's fixed-topology
 * map (`prepareOffsetFrameDerivatives`, one cached basis per frame): seed
 * points, seed authored tangents and seed circle radii. Mirror outputs are
 * pulled back through the owner's closed-form VJPs (T15b): seed points,
 * authored tangents, circle radii and, on the solver path, the seed arc's
 * variables (R-4), plus both axis endpoints of a line axis. No finite
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
        kind: "mirror";
        record: MirrorDerivationRecord;
        seedPointId: SketchPointId;
      }
    | {
        kind: "transform";
        relationship: PointTransformRelationship;
        instanceIndex: number;
        seedPointId: SketchPointId;
      };
  type TangentProducer =
    | {
        kind: "mirror";
        record: MirrorDerivationRecord;
        seedEntityId: SketchEntityId;
        seedOccurrenceId: string;
      }
    | {
        kind: "transform";
        relationship: PointTransformRelationship;
        instanceIndex: number;
        seedEntityId: SketchEntityId;
        seedOccurrenceId: string;
      };
  const pointProducers = new Map<SketchPointId, PointProducer>();
  const entityProducers = new Set<SketchEntityId>();
  const mirrorEntityProducers = new Map<
    SketchEntityId,
    { record: MirrorDerivationRecord; output: MirrorOutputEvaluation }
  >();
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
  for (const record of evaluation.mirrorFrames)
    for (const output of record.outputs) {
      mirrorEntityProducers.set(output.outputEntityId, { record, output });
      for (const point of output.points)
        pointProducers.set(point.outputPointId, {
          kind: "mirror",
          record,
          seedPointId: point.seedPointId,
        });
      for (const tangent of output.tangents)
        tangentProducers.set(
          tangentKey(output.outputEntityId, tangent.outputOccurrenceId),
          {
            kind: "mirror",
            record,
            seedEntityId: output.seedEntityId,
            seedOccurrenceId: tangent.seedOccurrenceId,
          },
        );
    }
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind === "offset") continue;
    for (const output of relationship.outputs)
      entityProducers.add(output.outputEntityId);
    // Mirrors are registered from their evaluated records (a failed mirror
    // is held: its outputs pull nothing back).
    if (relationship.kind === "mirror") continue;
    for (const output of relationship.outputs) {
      const target = entityById.get(output.outputEntityId);
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
            kind: "transform",
            relationship,
            instanceIndex: output.instanceIndex,
            seedEntityId: seed.entityId,
            seedOccurrenceId: seedOccurrence.occurrenceId,
          },
        );
      });
    }
  }

  const dotPoint = (first: SketchPoint2D, second: SketchPoint2D) =>
    first[0] * second[0] + first[1] * second[1];
  const isZero = (value: SketchPoint2D) => value[0] === 0 && value[1] === 0;
  const authoredSeedVector = (
    seedEntityId: SketchEntityId,
    seedOccurrenceId: string,
  ): SplineVector | null => {
    const seed = entityById.get(seedEntityId);
    if (seed?.kind !== "spline") return null;
    const occurrence = (orderedSplineOccurrences(seed) ?? []).find(
      (candidate) => candidate.occurrenceId === seedOccurrenceId,
    );
    return occurrence?.tangent.kind === "authored"
      ? occurrence.tangent.vector
      : null;
  };

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
    /** A mirror axis cotangent onto its endpoints (none for a datum axis). */
    const pullAxis = (axis: MirrorAxis, value: MirrorAxisCotangent) => {
      if (!value || axis.kind !== "line") return;
      pullPoint(axis.startPointId, value.start, new Set());
      pullPoint(axis.endPointId, value.end, new Set());
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
      if (producer.kind === "mirror") {
        const pulled = mirrorPointVjp(
          producer.record.axis,
          seedPoint.position,
          value,
        );
        pullPoint(producer.seedPointId, pulled.point, nextVisiting);
        pullAxis(producer.record.axis, pulled.axis);
        return;
      }
      const pulled: [number, number] = [0, 0];
      for (let component = 0; component < 2; component += 1) {
        const basis: SketchPoint2D = component === 0 ? [1, 0] : [0, 1];
        const transform = getRelationshipTransform(
          producer.relationship,
          producer.instanceIndex,
        );
        pulled[component] = dotPoint(
          value,
          transform.pointDifferential(seedPoint.position, basis),
        );
      }
      pullPoint(producer.seedPointId, pulled, nextVisiting);
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
      const seedVector = authoredSeedVector(
        producer.seedEntityId,
        producer.seedOccurrenceId,
      );
      if (!seedVector) return;
      const nextVisiting = new Set(visiting).add(key);
      if (producer.kind === "mirror") {
        const pulled = mirrorVectorVjp(producer.record.axis, seedVector, value);
        pullTangent(
          producer.seedEntityId,
          producer.seedOccurrenceId,
          pulled.vector,
          nextVisiting,
        );
        pullAxis(producer.record.axis, pulled.axis);
        return;
      }
      const pulledSeed: [number, number] = [0, 0];
      for (let component = 0; component < 2; component += 1) {
        const basis: SplineVector = component === 0 ? [1, 0] : [0, 1];
        const transform = getRelationshipTransform(
          producer.relationship,
          producer.instanceIndex,
        );
        pulledSeed[component] = dotPoint(
          value,
          transform.vectorDifferential(seedVector, basis),
        );
      }
      pullTangent(
        producer.seedEntityId,
        producer.seedOccurrenceId,
        pulledSeed,
        nextVisiting,
      );
    };
    /** An entity (circle radius / arc variable) cotangent onto its authority. */
    const pullEntity = (
      entityId: SketchEntityId,
      value: SketchDerivedEntityVariation,
    ) => {
      const offsetProducer = offsetEntityProducers.get(entityId);
      if (offsetProducer) {
        const frameCotangent = offsetFrameEntityCotangent(
          offsetProducer.datum,
          value,
        );
        if (frameCotangent)
          pullOffset(offsetProducer.record, frameCotangent, new Set());
        return;
      }
      const mirrorProducer = mirrorEntityProducers.get(entityId);
      if (mirrorProducer) {
        const { record, output } = mirrorProducer;
        if (value.kind === "circle") {
          if (output.circleRadius !== null)
            pullEntity(output.seedEntityId, value);
          return;
        }
        if (output.arc) {
          // R-4: θ′ = 2φ − θ, r′ = r from the seed arc's variables.
          const pulled = mirrorArcVariablesVjp(record.axis, value);
          pullAxis(record.axis, pulled.axis);
          const seed = entityById.get(output.seedEntityId);
          if (
            seed?.kind === "arc" &&
            record.seedArcSources.get(seed.entityId) === "points"
          ) {
            for (const [pointId, pointValue] of circleLikeCotangentToPoints(
              seed,
              pointById,
              pulled.arc,
            ) ?? [])
              pullPoint(pointId, pointValue, new Set());
            return;
          }
          pullEntity(output.seedEntityId, { kind: "arc", ...pulled.arc });
          return;
        }
      }
      if (!entityProducers.has(entityId)) {
        addEntity(entityId, value);
        return;
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
            }).entities[entityId],
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
          }).entities[entityId],
        );
        if (radius !== 0) {
          addEntity(entity.entityId, { kind: "circle", radius });
        }
      }
    };

    for (const [pointId, value] of Object.entries(cotangent.points ?? {})) {
      if (value) pullPoint(pointId as SketchPointId, value, new Set());
    }
    for (const [outputEntityId, value] of Object.entries(
      cotangent.entities ?? {},
    )) {
      if (value) pullEntity(outputEntityId as SketchEntityId, value);
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
        `Offset ‘${relationship.label}’: ${message}`,
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
  // T17c: a deleted output curve is reported by label.
  const deleted = offsetDeletedOutput(
    relationship,
    (entityId) => context.entityById.get(entityId)?.label,
  );
  if (deleted) {
    context.failures.push({
      derivationId: relationship.derivationId,
      diagnostic: diagnostic(
        OFFSET_DIAGNOSTIC_CODES.topologyChanged,
        "error",
        deleted.message,
        { kind: "entity", entityId: deleted.seedEntityId },
      ),
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

let cachedDerivationInput: SketchDerivationInput<DerivableSketchDefinition> | null =
  null;
let cachedDerivationResult: SketchDerivationEvaluationResult | null = null;

/**
 * Evaluates every derived relationship of one definition iterate, in
 * dependency order ([TECH] T-9, `orderDerivedRelationships`): a
 * relationship whose dependencies cannot be ordered fails with
 * `derived-relationship-dependency-unresolved` (an offset as an offset
 * failure, any other kind as a derived failure) and its outputs are held.
 * Offsets run their certifier-free solve frame at the document modeling
 * tolerance τ with the given per-relationship plan hint ([TECH] G3/G17);
 * there is no default τ. Mirrors are evaluated by their owner
 * (`mirror-requirements.ts`, T15b): one failure per relationship, outputs
 * held, never an unchanged point. Memoized on (definition identity, τ,
 * plan-hint identity, arc-variable identity).
 */
export function evaluateSketchDerivations<
  TDefinition extends DerivableSketchDefinition,
>(
  input: SketchDerivationInput<TDefinition>,
): SketchDerivationEvaluationResult<TDefinition> {
  const { definition, modelingTolerance, offsetPlans, arcVariables } = input;
  const withDerivatives = input.withDerivatives === true;
  if (
    cachedDerivationInput &&
    cachedDerivationResult &&
    cachedDerivationInput.definition === definition &&
    cachedDerivationInput.modelingTolerance === modelingTolerance &&
    cachedDerivationInput.offsetPlans === offsetPlans &&
    cachedDerivationInput.arcVariables === arcVariables &&
    (cachedDerivationInput.withDerivatives === true) === withDerivatives
  ) {
    // The cached result's definition derives from the identical cached
    // input definition, so it is of the caller's kind.
    return cachedDerivationResult as SketchDerivationEvaluationResult<TDefinition>;
  }

  const relationships = definition.derivedRelationships ?? [];
  if (relationships.length === 0) {
    const unchanged: SketchDerivationEvaluationResult<TDefinition> = {
      definition,
      diagnostics: [],
      modelingTolerance,
      offsetFrames: [],
      offsetFailures: [],
      derivedFailures: [],
      mirrorFrames: [],
      mirrorArcVariables: new Map(),
      relationshipOrder: [],
    };
    cachedDerivationInput = input;
    cachedDerivationResult = unchanged;
    return unchanged;
  }

  const diagnostics: SketchSolveDiagnostic[] = [];
  const offsetFrames: OffsetDerivationFrameRecord[] = [];
  const offsetFailures: OffsetDerivationFailure[] = [];
  const derivedFailures: MirrorRelationshipFailure[] = [];
  const mirrorFrames: MirrorDerivationRecord[] = [];
  const mirrorArcVariables = new Map<SketchEntityId, MirrorArcVariables>();
  // R-4: the arc variables a mirror seed reads (solver slots, then mirror outputs).
  const arcState = new Map(arcVariables ?? []);
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

  const { order, unresolved } = orderDerivedRelationships(definition);
  const kindById = new Map(
    relationships.map((relationship) => [
      relationship.derivationId,
      relationship.kind,
    ]),
  );
  for (const failure of unresolved)
    (kindById.get(failure.derivationId) === "offset"
      ? offsetFailures
      : derivedFailures
    ).push(failure);

  for (const relationship of order) {
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

    if (relationship.kind === "mirror") {
      // U-G2: a derived shell is never the seed of a derived operator; it
      // is reported before the owner (which would read it as a stale map).
      const outputs = relationship.outputs.filter((output) => {
        const seed = entityById.get(output.seedEntityId);
        if (seed?.kind !== "derivedPiecewiseCubic") return true;
        diagnostics.push(shellSeedDiagnostic(relationship, seed));
        return false;
      });
      const seedArcs = new Map<SketchEntityId, MirrorArcVariables>();
      const seedArcSources = new Map<SketchEntityId, "variables" | "points">();
      if (arcVariables)
        for (const output of outputs) {
          const seed = entityById.get(output.seedEntityId);
          if (seed?.kind !== "arc") continue;
          const known = arcState.get(seed.entityId);
          if (known) {
            seedArcs.set(seed.entityId, known);
            seedArcSources.set(seed.entityId, "variables");
            continue;
          }
          const center = pointById.get(seed.centerPointId)?.position;
          const start = pointById.get(seed.startPointId)?.position;
          const end = pointById.get(seed.endPointId)?.position;
          if (!center || !start || !end) continue;
          seedArcs.set(
            seed.entityId,
            pointDefinedArcVariables(center, start, end, seed.sweepDirection),
          );
          seedArcSources.set(seed.entityId, "points");
        }
      const evaluation = evaluateMirrorRelationship({
        relationship:
          outputs.length === relationship.outputs.length
            ? relationship
            : { ...relationship, outputs },
        geometry: { pointById, entityById },
        modelingTolerance,
        ...(arcVariables ? { arcVariables: seedArcs } : {}),
      });
      if (!evaluation.ok) {
        derivedFailures.push(evaluation.failure);
        continue;
      }
      for (const output of evaluation.outputs) {
        for (const point of output.points)
          replacePoint(point.outputPointId, point.position);
        replaceEntity(
          applyMirrorOutputValues(
            applyMirrorOutputStructure(
              entityById.get(output.outputEntityId)!,
              output,
            ),
            output,
          ),
        );
        if (output.arc) {
          arcState.set(output.outputEntityId, output.arc);
          mirrorArcVariables.set(output.outputEntityId, output.arc);
        }
      }
      mirrorFrames.push({
        derivationId: relationship.derivationId,
        axis: evaluation.axis,
        outputs: evaluation.outputs,
        seedArcSources,
      });
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
            transformFailureMessage(
              relationship,
              target
                ? `the original of ‘${target.label}’ was deleted`
                : "an original and its copy were deleted",
            ),
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
            transformFailureMessage(
              relationship,
              `a copy of ‘${seed.label}’ was deleted`,
            ),
            { kind: "entity", entityId: output.seedEntityId },
          ),
        );
        continue;
      }
      const mismatch = () =>
        transformFailureMessage(
          relationship,
          `its geometry no longer matches (copy ‘${target.label}’ of ‘${seed.label}’)`,
        );

      if (seed.kind === "derivedPiecewiseCubic") {
        diagnostics.push(shellSeedDiagnostic(relationship, seed));
        continue;
      }

      if (!supportsDerivedEntity(seed) || seed.kind !== target.kind) {
        diagnostics.push(
          diagnostic(
            "derived-transform-unsupported-entity",
            "warning",
            `‘${seed.label}’ (${seed.kind}) can't be copied by ${RELATIONSHIP_NOUN[relationship.kind].toLowerCase()} ‘${relationship.label}’ yet; its copy is not updated.`,
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
            mismatch(),
            { kind: "entity", entityId: output.outputEntityId },
          ),
        );
        continue;
      }

      const transform = getRelationshipTransform(
        relationship,
        output.instanceIndex,
      );

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
              mismatch(),
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

  const definitionIndex = new Map(
    relationships.map((relationship, index) => [
      relationship.derivationId,
      index,
    ]),
  );
  const inDefinitionOrder = <T extends { readonly derivationId: string }>(
    records: T[],
  ) =>
    records.sort(
      (first, second) =>
        definitionIndex.get(first.derivationId)! -
        definitionIndex.get(second.derivationId)!,
    );
  const result: SketchDerivationEvaluationResult<TDefinition> = {
    // Only points and entities change; TypeScript cannot see that a spread
    // of a generic definition with them replaced is still `TDefinition`.
    definition: {
      ...definition,
      points: nextPoints,
      entities: nextEntities,
    } as TDefinition,
    diagnostics,
    modelingTolerance,
    offsetFrames: inDefinitionOrder(offsetFrames),
    offsetFailures: inDefinitionOrder(offsetFailures),
    derivedFailures: inDefinitionOrder(derivedFailures),
    mirrorFrames,
    mirrorArcVariables,
    relationshipOrder: order,
  };
  cachedDerivationInput = input;
  cachedDerivationResult = result;
  return result;
}

/**
 * T16c (T16b review A-1, [TECH] T16-5 structure): a pattern or transform
 * output that cannot be evaluated, by the relationship's kind and label
 * (never an id), the surviving counterpart named. The sketch is invalid by
 * this error (profiles blocked); the only recovery command for these
 * relationships is Undo (no removal or replacement exists for them).
 */
function transformFailureMessage(
  relationship: PointTransformRelationship,
  why: string,
): string {
  return `${RELATIONSHIP_NOUN[relationship.kind]} ‘${relationship.label}’ is broken: ${why}. Profiles from this sketch are blocked. Undo to recover.`;
}

/** U-G2: a derived shell used as the seed of a mirror, pattern or transform. */
function shellSeedDiagnostic(
  relationship: Pick<SketchDerivationDefinition, "kind" | "label">,
  seed: SketchEntityDefinition,
): SketchSolveDiagnostic {
  return diagnostic(
    DERIVED_SHELL_SEED_UNSUPPORTED,
    "error",
    `${RELATIONSHIP_NOUN[relationship.kind]} ‘${relationship.label}’ uses the offset spline curve ‘${seed.label}’ as an original; mirroring, patterning or transforming an offset spline curve is not supported yet.`,
    { kind: "entity", entityId: seed.entityId },
  );
}
