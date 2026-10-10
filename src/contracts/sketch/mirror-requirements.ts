/**
 * The single owner of mirror reflection arithmetic (T15a, [TECH] T-2; live
 * since T15b: derivation evaluation, its JVP/pullback and the solver
 * projection call it).
 *
 * A mirror relationship is the internal requirement output = R(seed, axis),
 * imposed by substitution ([TECH] T-1). This module owns:
 * - axis resolution (a straight sketch line or a fixed datum axis) and the
 *   relationship's failure classification (one result per relationship);
 * - the value map (points, circle radius, arc variables, authored spline
 *   tangents) split from the structural sync (R-1);
 * - the analytic JVP and VJP of every value w.r.t. the seed quantities and
 *   the axis endpoints (a datum axis has no variables);
 * - the dependency order of derived relationships of every kind ([TECH] T-9);
 * - the mirror correspondence resolver (A1).
 *
 * The point, vector and point-differential expressions are, operation for
 * operation, those of the deleted `derived-geometry.ts` mirror transform
 * (`reflectAcrossLine`, `getMirrorTransform`), so evaluation results are
 * bitwise unchanged. No tolerance is introduced: the only threshold is the
 * document modeling tolerance τ, passed in.
 */
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";
import {
  orderedSplineOccurrences,
  type SplineClosure,
  type SplineEndSpanParameterLengths,
  type SplineInterpolationPolicy,
  type SplineTangent,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";

/** The explicit mirror failure codes (issue 15 Answer, [TECH] T-5/T-15). */
export const MIRROR_DIAGNOSTIC_CODES = {
  axisMissing: "derived-mirror-axis-missing",
  axisDegenerate: "derived-mirror-axis-degenerate",
  mapStale: "derived-mirror-map-stale",
} as const;

/**
 * [TECH] T-9: a derived relationship of any kind (mirror, pattern,
 * transform, offset) whose dependencies cannot be evaluated before it.
 * Kind-neutral, because the dependency order covers every kind.
 */
export const DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED =
  "derived-relationship-dependency-unresolved";

export type MirrorRelationship = Extract<
  SketchDerivationDefinition,
  { kind: "mirror" }
>;

/**
 * How a mirror names its axis: a persisted reference (a straight sketch
 * line, or a sketch datum axis: the x axis through the origin along [1, 0],
 * the y axis along [0, 1]), or an internal datum axis given as an origin
 * and a unit axis vector (exactly [±1, 0] or [0, ±1]; anything else is a
 * programming error and throws).
 */
export type MirrorAxisReference =
  | MirrorRelationship["mirrorReference"]
  | {
      readonly kind: "datumAxis";
      readonly origin: SketchPoint2D;
      readonly direction: SketchPoint2D;
    };

/** A mirror relationship whose axis may also be an internal datum axis. */
export type MirrorRelationshipInput = Omit<
  MirrorRelationship,
  "mirrorReference"
> & { readonly mirrorReference: MirrorAxisReference };

/**
 * A resolved, non-degenerate axis: the line through `start` along
 * `direction` (end − start for a line; the datum's unit direction).
 */
export type MirrorAxis =
  | {
      readonly kind: "line";
      readonly entityId: SketchEntityId;
      readonly startPointId: SketchPointId;
      readonly endPointId: SketchPointId;
      readonly start: SketchPoint2D;
      readonly direction: SketchPoint2D;
      readonly lengthSquared: number;
    }
  | {
      readonly kind: "datum";
      readonly start: SketchPoint2D;
      readonly direction: SketchPoint2D;
      readonly lengthSquared: number;
    };

/** First-order motion of a line axis's endpoints. */
export interface MirrorAxisVariation {
  readonly start: SketchPoint2D;
  readonly end: SketchPoint2D;
}

/** The solver's arc state [r, θs, θe]; angles are modulo 2π. */
export interface MirrorArcVariables {
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

/** One relationship's single failure. */
export interface MirrorRelationshipFailure {
  readonly derivationId: string;
  readonly diagnostic: SketchSolveDiagnostic;
}

export type MirrorAxisResolution =
  | { readonly ok: true; readonly axis: MirrorAxis }
  | { readonly ok: false; readonly failure: MirrorRelationshipFailure };

const ZERO: SketchPoint2D = [0, 0];

/**
 * The caller's current point and entity lookups (review R-3b): read at
 * every call, never cached, so a caller that updates its maps in place
 * (as `evaluateSketchDerivations` does along a chain) is always current.
 */
export interface MirrorGeometry {
  readonly pointById: ReadonlyMap<SketchPointId, SketchPointDefinition>;
  readonly entityById: ReadonlyMap<SketchEntityId, SketchEntityDefinition>;
}

/** Fresh lookups of a definition's points and entities. */
export function indexMirrorGeometry(
  definition: Pick<SketchDefinition, "points" | "entities">,
): MirrorGeometry {
  return {
    pointById: new Map(
      definition.points.map((point) => [point.pointId, point]),
    ),
    entityById: new Map(
      definition.entities.map((entity) => [entity.entityId, entity]),
    ),
  };
}

function failure(
  derivationId: string,
  code:
    | (typeof MIRROR_DIAGNOSTIC_CODES)[keyof typeof MIRROR_DIAGNOSTIC_CODES]
    | typeof DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED,
  message: string,
  entityId: SketchEntityId | null,
): MirrorRelationshipFailure {
  return {
    derivationId,
    diagnostic: {
      code,
      severity: "error",
      message,
      target: entityId ? { kind: "entity", entityId } : null,
    },
  };
}

/**
 * Resolves and classifies a mirror axis. A missing reference or one that is
 * not a straight sketch line (or has missing endpoints) is
 * `derived-mirror-axis-missing`; an axis shorter than τ (the predicate of
 * production's `degenerate-line-segment`, `length(start − end) < τ`, which
 * also rejects a non-finite length) is `derived-mirror-axis-degenerate`.
 */
export function resolveMirrorAxis(
  derivationId: string,
  reference: MirrorAxisReference,
  geometry: MirrorGeometry,
  modelingTolerance: number,
): MirrorAxisResolution {
  let axis: MirrorAxis;
  if (reference.kind === "sketchDatum")
    return resolveMirrorAxis(
      derivationId,
      {
        kind: "datumAxis",
        origin: [0, 0],
        direction: reference.datum === "xAxis" ? [1, 0] : [0, 1],
      },
      geometry,
      modelingTolerance,
    );
  if (reference.kind === "datumAxis") {
    const [dx, dy] = reference.direction;
    if (Math.abs(dx) + Math.abs(dy) !== 1 || dx * dy !== 0)
      throw new Error(
        `A datum mirror axis direction must be a unit axis vector, got [${dx}, ${dy}].`,
      );
    axis = {
      kind: "datum",
      start: reference.origin,
      direction: reference.direction,
      lengthSquared: dx * dx + dy * dy,
    };
  } else {
    const { pointById, entityById } = geometry;
    const line = entityById.get(reference.entityId);
    const start =
      line?.kind === "lineSegment"
        ? pointById.get(line.startPointId)
        : undefined;
    const end =
      line?.kind === "lineSegment" ? pointById.get(line.endPointId) : undefined;
    if (line?.kind !== "lineSegment" || !start || !end)
      return {
        ok: false,
        failure: failure(
          derivationId,
          MIRROR_DIAGNOSTIC_CODES.axisMissing,
          `Mirror relationship ${derivationId} references a missing axis or one that is not a straight sketch line.`,
          line ? line.entityId : null,
        ),
      };
    const dx = end.position[0] - start.position[0];
    const dy = end.position[1] - start.position[1];
    axis = {
      kind: "line",
      entityId: line.entityId,
      startPointId: line.startPointId,
      endPointId: line.endPointId,
      start: start.position,
      direction: [dx, dy],
      lengthSquared: dx * dx + dy * dy,
    };
  }
  if (!(Math.hypot(axis.direction[0], axis.direction[1]) >= modelingTolerance))
    return {
      ok: false,
      failure: failure(
        derivationId,
        MIRROR_DIAGNOSTIC_CODES.axisDegenerate,
        `Mirror relationship ${derivationId} has a mirror axis shorter than the modeling tolerance.`,
        axis.kind === "line" ? axis.entityId : null,
      ),
    };
  return { ok: true, axis };
}

// ---------------------------------------------------------------- values

/** R(p) = 2·proj(p) − p, the reflection of a point across the axis. */
export function mirrorPoint(
  axis: MirrorAxis,
  point: SketchPoint2D,
): SketchPoint2D {
  const [startX, startY] = axis.start;
  const [dx, dy] = axis.direction;
  const t =
    ((point[0] - startX) * dx + (point[1] - startY) * dy) / axis.lengthSquared;
  const projection: SketchPoint2D = [startX + t * dx, startY + t * dy];
  return [projection[0] * 2 - point[0], projection[1] * 2 - point[1]];
}

/**
 * Rv(v) = 2(v·u)u − v, the reflection of a free vector. An exact zero (both
 * components ±0) is returned unchanged, so it stays the same exact zero
 * bitwise (the arithmetic alone may turn +0 into −0).
 */
export function mirrorVector(
  axis: MirrorAxis,
  vector: SplineVector,
): SplineVector {
  if (vector[0] === 0 && vector[1] === 0) return vector;
  const [dx, dy] = axis.direction;
  const projectionScale =
    (vector[0] * dx + vector[1] * dy) / axis.lengthSquared;
  return [
    2 * projectionScale * dx - vector[0],
    2 * projectionScale * dy - vector[1],
  ];
}

/** The axis angle φ = atan2(d). */
export function mirrorAxisAngle(axis: MirrorAxis): number {
  return Math.atan2(axis.direction[1], axis.direction[0]);
}

/**
 * The output arc's variables from the seed arc's: r′ = r and θ′ = 2φ − θ
 * for both ends (modulo 2π, like the solver's arc state). The centre is a
 * point (`mirrorPoint`) and the sweep direction flips (structure).
 */
export function mirrorArcVariables(
  axis: MirrorAxis,
  arc: MirrorArcVariables,
): MirrorArcVariables {
  const twoPhi = 2 * mirrorAxisAngle(axis);
  return {
    radius: arc.radius,
    startAngle: twoPhi - arc.startAngle,
    endAngle: twoPhi - arc.endAngle,
  };
}

// ---------------------------------------------------------- derivatives

function axisVariationOf(
  axis: MirrorAxis,
  variation: MirrorAxisVariation | undefined,
): MirrorAxisVariation {
  if (
    axis.kind === "datum" &&
    variation &&
    [...variation.start, ...variation.end].some((value) => value !== 0)
  )
    throw new Error("A datum mirror axis has no variables to vary.");
  return variation ?? { start: ZERO, end: ZERO };
}

/** The directional derivative of R (point) or Rv (vector), `derived-geometry.ts` operation order. */
function differentiateReflection(
  axis: MirrorAxis,
  value: SketchPoint2D,
  differential: SketchPoint2D,
  axisVariation: MirrorAxisVariation | undefined,
  relativeToStart: boolean,
): SketchPoint2D {
  const { start: dStart, end: dEnd } = axisVariationOf(axis, axisVariation);
  const [dx, dy] = axis.direction;
  const lengthSquared = axis.lengthSquared;
  const dAxis: SketchPoint2D = [dEnd[0] - dStart[0], dEnd[1] - dStart[1]];
  const dLengthSquared = 2 * (dx * dAxis[0] + dy * dAxis[1]);
  const relative: SketchPoint2D = relativeToStart
    ? [value[0] - axis.start[0], value[1] - axis.start[1]]
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
}

/** dR(p)[dp, d axis]; omit `axisVariation` for a fixed axis (always for a datum). */
export function mirrorPointJvp(
  axis: MirrorAxis,
  point: SketchPoint2D,
  pointVariation: SketchPoint2D,
  axisVariation?: MirrorAxisVariation,
): SketchPoint2D {
  return differentiateReflection(
    axis,
    point,
    pointVariation,
    axisVariation,
    true,
  );
}

/** dRv(v)[dv, d axis]; omit `axisVariation` for a fixed axis (always for a datum). */
export function mirrorVectorJvp(
  axis: MirrorAxis,
  vector: SplineVector,
  vectorVariation: SplineVector,
  axisVariation?: MirrorAxisVariation,
): SplineVector {
  return differentiateReflection(
    axis,
    vector,
    vectorVariation,
    axisVariation,
    false,
  );
}

/** dφ = (dₓ·d(d_y) − d_y·d(dₓ)) / L² for a line axis; 0 for a datum. */
function axisAngleJvp(
  axis: MirrorAxis,
  axisVariation: MirrorAxisVariation | undefined,
) {
  const { start: dStart, end: dEnd } = axisVariationOf(axis, axisVariation);
  const [dx, dy] = axis.direction;
  return (
    (dx * (dEnd[1] - dStart[1]) - dy * (dEnd[0] - dStart[0])) /
    axis.lengthSquared
  );
}

/** d(r′, θs′, θe′) = (dr, 2dφ − dθs, 2dφ − dθe). */
export function mirrorArcVariablesJvp(
  axis: MirrorAxis,
  arcVariation: MirrorArcVariables,
  axisVariation?: MirrorAxisVariation,
): MirrorArcVariables {
  const twoDPhi = 2 * axisAngleJvp(axis, axisVariation);
  return {
    radius: arcVariation.radius,
    startAngle: twoDPhi - arcVariation.startAngle,
    endAngle: twoDPhi - arcVariation.endAngle,
  };
}

/** A cotangent on the axis endpoints; null for a datum axis (no variables). */
export type MirrorAxisCotangent = MirrorAxisVariation | null;

function lineAxisCotangent(
  axis: MirrorAxis,
  directionCotangent: SketchPoint2D,
  startOnly: SketchPoint2D,
): MirrorAxisCotangent {
  if (axis.kind === "datum") return null;
  return {
    start: [
      startOnly[0] - directionCotangent[0],
      startOnly[1] - directionCotangent[1],
    ],
    end: directionCotangent,
  };
}

/**
 * The transpose of `mirrorPointJvp`: for a cotangent w on R(p),
 * ∂/∂p = (2uuᵀ − I)w, ∂/∂d = 2(w·d)(r/L² − 2(r·d)d/L⁴) + 2kw and
 * ∂/∂start = 2w − 2(w·d)d/L² − ∂/∂d (r = p − start, k = r·d/L²).
 */
export function mirrorPointVjp(
  axis: MirrorAxis,
  point: SketchPoint2D,
  cotangent: SketchPoint2D,
): { readonly point: SketchPoint2D; readonly axis: MirrorAxisCotangent } {
  const [dx, dy] = axis.direction;
  const lengthSquared = axis.lengthSquared;
  const relative: SketchPoint2D = [
    point[0] - axis.start[0],
    point[1] - axis.start[1],
  ];
  const numerator = relative[0] * dx + relative[1] * dy;
  const cotangentAlong =
    (cotangent[0] * dx + cotangent[1] * dy) / lengthSquared;
  const throughRelative: SketchPoint2D = [
    2 * cotangentAlong * dx,
    2 * cotangentAlong * dy,
  ];
  const scale = numerator / lengthSquared;
  const direction: SketchPoint2D = [
    2 * cotangentAlong * (relative[0] - 2 * scale * dx) +
      2 * scale * cotangent[0],
    2 * cotangentAlong * (relative[1] - 2 * scale * dy) +
      2 * scale * cotangent[1],
  ];
  return {
    point: [
      throughRelative[0] - cotangent[0],
      throughRelative[1] - cotangent[1],
    ],
    axis: lineAxisCotangent(axis, direction, [
      2 * cotangent[0] - throughRelative[0],
      2 * cotangent[1] - throughRelative[1],
    ]),
  };
}

/** The transpose of `mirrorVectorJvp` (Rv does not depend on the axis start). */
export function mirrorVectorVjp(
  axis: MirrorAxis,
  vector: SplineVector,
  cotangent: SplineVector,
): { readonly vector: SplineVector; readonly axis: MirrorAxisCotangent } {
  const [dx, dy] = axis.direction;
  const lengthSquared = axis.lengthSquared;
  const cotangentAlong =
    (cotangent[0] * dx + cotangent[1] * dy) / lengthSquared;
  const scale = (vector[0] * dx + vector[1] * dy) / lengthSquared;
  const direction: SketchPoint2D = [
    2 * cotangentAlong * (vector[0] - 2 * scale * dx) +
      2 * scale * cotangent[0],
    2 * cotangentAlong * (vector[1] - 2 * scale * dy) +
      2 * scale * cotangent[1],
  ];
  return {
    vector: [
      2 * cotangentAlong * dx - cotangent[0],
      2 * cotangentAlong * dy - cotangent[1],
    ],
    axis: lineAxisCotangent(axis, direction, ZERO),
  };
}

/** The transpose of `mirrorArcVariablesJvp`. */
export function mirrorArcVariablesVjp(
  axis: MirrorAxis,
  cotangent: MirrorArcVariables,
): { readonly arc: MirrorArcVariables; readonly axis: MirrorAxisCotangent } {
  const [dx, dy] = axis.direction;
  const phiCotangent =
    (2 * (cotangent.startAngle + cotangent.endAngle)) / axis.lengthSquared;
  return {
    arc: {
      radius: cotangent.radius,
      startAngle: -cotangent.startAngle,
      endAngle: -cotangent.endAngle,
    },
    axis: lineAxisCotangent(
      axis,
      [-dy * phiCotangent, dx * phiCotangent],
      ZERO,
    ),
  };
}

// ------------------------------------------------- relationship evaluation

type MirrorableEntity = Extract<
  SketchEntityDefinition,
  { kind: "lineSegment" | "point" | "circle" | "arc" | "spline" }
>;

function isMirrorable(
  entity: SketchEntityDefinition,
): entity is MirrorableEntity {
  return (
    entity.kind === "lineSegment" ||
    entity.kind === "point" ||
    entity.kind === "circle" ||
    entity.kind === "arc" ||
    entity.kind === "spline"
  );
}

/** Entity-defining point ids, in the order outputs record them (null: invalid spline order). */
function mirrorablePointIds(
  entity: MirrorableEntity,
): readonly SketchPointId[] | null {
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
      return (
        orderedSplineOccurrences(entity)?.map(({ pointId }) => pointId) ?? null
      );
  }
}

const sameIds = (
  first: readonly string[],
  second: readonly string[],
): boolean =>
  first.length === second.length &&
  first.every((id, index) => id === second[index]);

/** A mirrored tangent: an authored seed occurrence and its reflected vector. */
export interface MirrorTangentValue {
  readonly seedOccurrenceId: string;
  readonly outputOccurrenceId: string;
  readonly vector: SplineVector;
}

/** The structural (value-free) fields an output copies from its seed (R-1). */
export type MirrorOutputStructure =
  | { readonly kind: "lineSegment" | "point" | "circle" }
  | {
      readonly kind: "arc";
      /** The seed's sweep direction, flipped. */
      readonly sweepDirection: "clockwise" | "counterClockwise";
    }
  | {
      readonly kind: "spline";
      readonly closure: SplineClosure;
      readonly interpolationPolicy: SplineInterpolationPolicy;
      /** Copied from the seed (a reflection is an isometry); null: absent. */
      readonly endSpanParameterLengths: SplineEndSpanParameterLengths | null;
      /** The output's occurrence ids in order (the sync checks them). */
      readonly occurrenceIds: readonly string[];
      /** Per occurrence in order: automatic, exact zero, or a nonzero authored vector. */
      readonly tangentKinds: readonly ("automatic" | "zero" | "authored")[];
    };

/** One output's mirrored values and structure. */
export interface MirrorOutputEvaluation {
  readonly seedEntityId: SketchEntityId;
  readonly outputEntityId: SketchEntityId;
  /** In map order: output point = R(seed point). */
  readonly points: readonly {
    readonly seedPointId: SketchPointId;
    readonly outputPointId: SketchPointId;
    readonly position: SketchPoint2D;
  }[];
  /** Circle outputs: r′ = r. */
  readonly circleRadius: number | null;
  /** Arc outputs whose seed arc variables were supplied (the solver seam, R-4). */
  readonly arc: MirrorArcVariables | null;
  /** Spline outputs: one entry per authored seed occurrence (exact zeros included). */
  readonly tangents: readonly MirrorTangentValue[];
  readonly structure: MirrorOutputStructure;
}

export type MirrorRelationshipEvaluation =
  | {
      readonly ok: true;
      readonly axis: MirrorAxis;
      readonly outputs: readonly MirrorOutputEvaluation[];
    }
  | { readonly ok: false; readonly failure: MirrorRelationshipFailure };

/**
 * Evaluates one mirror relationship on a definition iterate: axis
 * classification first, then every output's seed/output/point-map/
 * occurrence check (`derived-mirror-map-stale`, R-3b), then the values.
 * One result per relationship; never an unchanged point. Arc outputs carry
 * arc variables only when `arcVariables` holds the seed's solver slots (the
 * definition has no arc variables; there the arc is its mirrored points
 * plus the flipped sweep, R-4).
 */
type MirrorOutputRecord = MirrorRelationship["outputs"][number];

/**
 * The map check of one output (R-3b): seed and output exist, are
 * mirrorable and of one kind, the recorded maps equal their defining
 * points, have one length (spline occurrence counts), and every point
 * exists. An empty `seedPointIds` is stale like any other mismatch (T15b:
 * every writer records the seed's defining points). Returns the resolved
 * pair, or why the map is stale.
 */
function checkMirrorOutputMap(
  output: MirrorOutputRecord,
  geometry: MirrorGeometry,
):
  | {
      readonly seed: MirrorableEntity;
      readonly target: MirrorableEntity;
      readonly seedPointIds: readonly SketchPointId[];
    }
  | { readonly stale: string; readonly entityId: SketchEntityId | null } {
  const { pointById, entityById } = geometry;
  const seed = entityById.get(output.seedEntityId);
  const target = entityById.get(output.outputEntityId);
  const stale = (reason: string) => ({
    stale: reason,
    entityId: seed ? seed.entityId : target ? target.entityId : null,
  });
  if (!seed) return stale(`seed ${output.seedEntityId} is missing`);
  if (!target) return stale(`output ${output.outputEntityId} is missing`);
  if (!isMirrorable(seed) || !isMirrorable(target) || seed.kind !== target.kind)
    return stale(
      `${seed.kind} ${seed.entityId} cannot be mirrored onto ${target.kind} ${target.entityId}`,
    );
  const seedDefining = mirrorablePointIds(seed);
  const targetDefining = mirrorablePointIds(target);
  const seedPointIds = output.seedPointIds;
  if (
    !seedDefining ||
    !targetDefining ||
    seedPointIds.length !== output.outputPointIds.length ||
    !sameIds(seedPointIds, seedDefining) ||
    !sameIds(output.outputPointIds, targetDefining)
  )
    return stale(
      `the point map of ${seed.entityId} → ${target.entityId} differs from their defining points`,
    );
  const missing = [...seedPointIds, ...output.outputPointIds].find(
    (pointId) => !pointById.has(pointId),
  );
  if (missing) return stale(`point ${missing} is missing`);
  return { seed, target, seedPointIds };
}

export function evaluateMirrorRelationship(input: {
  readonly relationship: MirrorRelationshipInput;
  readonly geometry: MirrorGeometry;
  readonly modelingTolerance: number;
  readonly arcVariables?: ReadonlyMap<SketchEntityId, MirrorArcVariables>;
}): MirrorRelationshipEvaluation {
  const { relationship, geometry } = input;
  const resolution = resolveMirrorAxis(
    relationship.derivationId,
    relationship.mirrorReference,
    geometry,
    input.modelingTolerance,
  );
  if (!resolution.ok) return resolution;
  const { axis } = resolution;
  const outputs: MirrorOutputEvaluation[] = [];
  for (const output of relationship.outputs) {
    const checked = checkMirrorOutputMap(output, geometry);
    if ("stale" in checked)
      return {
        ok: false,
        failure: failure(
          relationship.derivationId,
          MIRROR_DIAGNOSTIC_CODES.mapStale,
          `Mirror relationship ${relationship.derivationId} no longer matches its geometry: ${checked.stale}.`,
          checked.entityId,
        ),
      };
    const { seed, target, seedPointIds } = checked;
    const points = seedPointIds.map((seedPointId, index) => ({
      seedPointId,
      outputPointId: output.outputPointIds[index]!,
      position: mirrorPoint(
        axis,
        geometry.pointById.get(seedPointId)!.position,
      ),
    }));
    let structure: MirrorOutputStructure;
    const tangents: MirrorTangentValue[] = [];
    let arc: MirrorArcVariables | null = null;
    if (seed.kind === "arc") {
      structure = {
        kind: "arc",
        sweepDirection:
          seed.sweepDirection === "clockwise"
            ? "counterClockwise"
            : "clockwise",
      };
      const seedArc = input.arcVariables?.get(seed.entityId);
      if (seedArc) arc = mirrorArcVariables(axis, seedArc);
    } else if (seed.kind === "spline") {
      // Same kind (checked above); both orders resolved (non-null point lists).
      const seedOccurrences = orderedSplineOccurrences(seed)!;
      const targetOccurrences = orderedSplineOccurrences(
        target as typeof seed,
      )!;
      structure = {
        kind: "spline",
        closure: seed.closure,
        interpolationPolicy: seed.interpolationPolicy,
        endSpanParameterLengths: seed.endSpanParameterLengths ?? null,
        occurrenceIds: targetOccurrences.map(
          ({ occurrenceId }) => occurrenceId,
        ),
        tangentKinds: seedOccurrences.map(({ tangent }) =>
          tangent.kind === "automatic"
            ? "automatic"
            : tangent.vector[0] === 0 && tangent.vector[1] === 0
              ? "zero"
              : "authored",
        ),
      };
      seedOccurrences.forEach((occurrence, index) => {
        if (occurrence.tangent.kind !== "authored") return;
        tangents.push({
          seedOccurrenceId: occurrence.occurrenceId,
          outputOccurrenceId: targetOccurrences[index]!.occurrenceId,
          vector: mirrorVector(axis, occurrence.tangent.vector),
        });
      });
    } else {
      structure = { kind: seed.kind };
    }
    outputs.push({
      seedEntityId: seed.entityId,
      outputEntityId: target.entityId,
      points,
      circleRadius: seed.kind === "circle" ? seed.radius : null,
      arc,
      tangents,
      structure,
    });
  }
  return { ok: true, axis, outputs };
}

/**
 * The structural sync of one output (R-1): sweep direction, closure,
 * policy, `endSpanParameterLengths` and tangent kinds follow the seed; no
 * existing value changes. An output occurrence keeps its own authored
 * nonzero vector; only an occurrence that becomes authored-nonzero (it was
 * automatic or an exact zero) takes the value map's vector, because a kind
 * change has no prior value to keep.
 */
export function applyMirrorOutputStructure(
  output: SketchEntityDefinition,
  evaluation: MirrorOutputEvaluation,
): SketchEntityDefinition {
  const { structure } = evaluation;
  if (
    output.entityId !== evaluation.outputEntityId ||
    output.kind !== structure.kind
  )
    throw new Error(
      `Mirror output ${output.entityId} does not match the evaluated output ${evaluation.outputEntityId}.`,
    );
  if (structure.kind === "arc" && output.kind === "arc")
    return { ...output, sweepDirection: structure.sweepDirection };
  if (structure.kind !== "spline" || output.kind !== "spline") return output;
  const occurrences = orderedSplineOccurrences(output);
  if (
    !occurrences ||
    !sameIds(
      occurrences.map(({ occurrenceId }) => occurrenceId),
      structure.occurrenceIds,
    )
  )
    throw new Error(
      `Mirror output ${output.entityId} has occurrences other than the evaluated output's.`,
    );
  const vectorByOccurrence = new Map(
    evaluation.tangents.map((tangent) => [
      tangent.outputOccurrenceId,
      tangent.vector,
    ]),
  );
  const tangentByOccurrence = new Map<string, SplineTangent>(
    occurrences.map((occurrence, index) => {
      const kind = structure.tangentKinds[index]!;
      const current = occurrence.tangent;
      if (kind === "automatic")
        return [occurrence.occurrenceId, { kind: "automatic" } as const];
      const keep =
        current.kind === "authored" &&
        (kind === "zero"
          ? current.vector[0] === 0 && current.vector[1] === 0
          : current.vector[0] !== 0 || current.vector[1] !== 0);
      return [
        occurrence.occurrenceId,
        keep
          ? current
          : ({
              kind: "authored",
              vector: vectorByOccurrence.get(occurrence.occurrenceId)!,
            } as const),
      ];
    }),
  );
  const synced: Extract<SketchEntityDefinition, { kind: "spline" }> = {
    ...output,
    closure: structure.closure,
    interpolationPolicy: structure.interpolationPolicy,
    pointOccurrences: output.pointOccurrences.map((occurrence) => ({
      ...occurrence,
      tangent: tangentByOccurrence.get(occurrence.occurrenceId)!,
    })),
  };
  if (structure.endSpanParameterLengths)
    synced.endSpanParameterLengths = { ...structure.endSpanParameterLengths };
  else delete synced.endSpanParameterLengths;
  return synced;
}

/**
 * The value write of one output entity: circle radius and authored
 * tangent vectors (output points are written by their ids from
 * `evaluation.points`). Applied after `applyMirrorOutputStructure`.
 */
export function applyMirrorOutputValues(
  output: SketchEntityDefinition,
  evaluation: MirrorOutputEvaluation,
): SketchEntityDefinition {
  if (output.kind === "circle" && evaluation.circleRadius !== null)
    return { ...output, radius: evaluation.circleRadius };
  if (output.kind !== "spline" || evaluation.tangents.length === 0)
    return output;
  const vectorByOccurrence = new Map(
    evaluation.tangents.map((tangent) => [
      tangent.outputOccurrenceId,
      tangent.vector,
    ]),
  );
  return {
    ...output,
    pointOccurrences: output.pointOccurrences.map((occurrence) => {
      const vector = vectorByOccurrence.get(occurrence.occurrenceId);
      return vector && occurrence.tangent.kind === "authored"
        ? { ...occurrence, tangent: { kind: "authored", vector } }
        : occurrence;
    }),
  };
}

// -------------------------------------------------------- dependency order

function definingPointIds(
  entity: SketchEntityDefinition,
): readonly SketchPointId[] {
  switch (entity.kind) {
    case "lineSegment":
    case "point":
    case "circle":
    case "arc":
    case "spline":
      return mirrorablePointIds(entity) ?? [];
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

function producedIds(relationship: SketchDerivationDefinition): string[] {
  const ids: string[] = relationship.outputs.flatMap((output) => [
    output.outputEntityId,
    ...output.outputPointIds,
  ]);
  if (relationship.kind === "offset") {
    for (const output of relationship.piecewiseCubicOutputs)
      ids.push(output.outputEntityId, output.startPointId, output.endPointId);
    for (const output of relationship.jointOutputs)
      ids.push(
        output.outputEntityId,
        output.centerPointId,
        output.startPointId,
        output.endPointId,
      );
  }
  return ids;
}

function readIds(
  relationship: SketchDerivationDefinition,
  entityById: ReadonlyMap<SketchEntityId, SketchEntityDefinition>,
): string[] {
  const entityIds: SketchEntityId[] = [
    ...relationship.seedEntityIds,
    ...relationship.outputs.map((output) => output.seedEntityId),
  ];
  if (
    relationship.kind === "mirror" &&
    relationship.mirrorReference.kind === "lineEntity"
  )
    entityIds.push(relationship.mirrorReference.entityId);
  const ids: string[] = relationship.outputs.flatMap(
    (output) => output.seedPointIds,
  );
  for (const entityId of entityIds) {
    ids.push(entityId);
    const entity = entityById.get(entityId);
    if (entity) ids.push(...definingPointIds(entity));
  }
  return ids;
}

/**
 * The evaluation order of a definition's derived relationships of every
 * kind ([TECH] T-9): a relationship comes after every relationship whose
 * outputs (entities or points) its seeds, seed points or mirror axis read.
 * Kahn's algorithm, O(relationships + ids + edges), no recursion. Ready
 * relationships are taken in a definition-order scan (a relationship that
 * becomes ready behind the scan is taken at once), so an already ordered
 * array comes back unchanged. A relationship left unsorted (on a cycle,
 * reading its own outputs, or downstream of either) fails with
 * `derived-relationship-dependency-unresolved` and is not in `order`.
 */
export function orderDerivedRelationships(
  definition: Pick<SketchDefinition, "entities" | "derivedRelationships">,
): {
  readonly order: readonly SketchDerivationDefinition[];
  readonly unresolved: readonly MirrorRelationshipFailure[];
} {
  const relationships = definition.derivedRelationships ?? [];
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const producers = new Map<string, number[]>();
  relationships.forEach((relationship, index) => {
    for (const id of producedIds(relationship)) {
      const list = producers.get(id);
      if (!list) producers.set(id, [index]);
      else if (list[list.length - 1] !== index) list.push(index);
    }
  });
  const dependents: number[][] = relationships.map(() => []);
  const inDegree = relationships.map(() => 0);
  relationships.forEach((relationship, index) => {
    const upstream = new Set<number>();
    for (const id of readIds(relationship, entityById))
      for (const producer of producers.get(id) ?? []) upstream.add(producer);
    for (const producer of upstream) {
      dependents[producer]!.push(index);
      inDegree[index]! += 1;
    }
  });
  const order: number[] = [];
  const taken = relationships.map(() => false);
  for (let scan = 0; scan < relationships.length; scan += 1) {
    if (inDegree[scan] !== 0 || taken[scan]) continue;
    const behind = [scan];
    for (let head = 0; head < behind.length; head += 1) {
      const index = behind[head]!;
      taken[index] = true;
      order.push(index);
      for (const dependent of dependents[index]!) {
        inDegree[dependent]! -= 1;
        // Ahead of the scan: the scan takes it in definition order.
        if (inDegree[dependent] === 0 && dependent < scan)
          behind.push(dependent);
      }
    }
  }
  return {
    order: order.map((index) => relationships[index]!),
    unresolved: relationships.flatMap((relationship, index) =>
      taken[index]
        ? []
        : [
            failure(
              relationship.derivationId,
              DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED,
              `Derived relationship ${relationship.derivationId} depends on outputs that cannot be evaluated before it (a dependency cycle or a self-reference).`,
              relationship.seedEntityIds[0] ?? null,
            ),
          ],
    ),
  };
}

// ------------------------------------------------------- correspondence

/** A geometry reference on either side of a mirror. */
export type MirrorCorrespondenceRef =
  | { readonly kind: "point"; readonly pointId: SketchPointId }
  | { readonly kind: "entity"; readonly entityId: SketchEntityId }
  | {
      readonly kind: "splineOccurrence";
      readonly entityId: SketchEntityId;
      readonly occurrenceId: string;
    };

/**
 * One mirror step: `ref` is on `side` of `relationshipId`, `counterpart` on
 * the other. `counterpart` is null when the relationship's map is stale
 * (review A-7): the participation is known, the correspondence is not.
 */
export interface MirrorCounterpart {
  readonly relationshipId: string;
  readonly side: "seed" | "output";
  readonly counterpart: MirrorCorrespondenceRef | null;
}

export interface MirrorCorrespondence extends MirrorCounterpart {
  /**
   * For an output-side step: the further upstream steps from `counterpart`
   * while it is itself a mirror output (mirror of a mirror), ending at the
   * root seed. Empty for a seed-side step (downstream may branch: resolve
   * the counterpart again to walk on).
   */
  readonly chain: readonly MirrorCounterpart[];
}

type CorrespondenceDefinition = Pick<
  SketchDefinition,
  "points" | "entities" | "derivedRelationships"
>;

function counterpartSteps(
  definition: CorrespondenceDefinition,
  entityById: MirrorGeometry["entityById"],
  staleRelationships: ReadonlySet<string>,
  ref: MirrorCorrespondenceRef,
): MirrorCounterpart[] {
  const steps: MirrorCounterpart[] = [];
  const seen = new Set<string>();
  const add = (step: MirrorCounterpart) => {
    const key = JSON.stringify(step);
    if (seen.has(key)) return;
    seen.add(key);
    steps.push(step);
  };
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "mirror") continue;
    const relationshipId = relationship.derivationId;
    for (const output of relationship.outputs) {
      if (staleRelationships.has(relationshipId)) {
        const [onSeed, onOutput] =
          ref.kind === "point"
            ? [
                output.seedPointIds.includes(ref.pointId),
                output.outputPointIds.includes(ref.pointId),
              ]
            : [
                output.seedEntityId === ref.entityId,
                output.outputEntityId === ref.entityId,
              ];
        if (onSeed) add({ relationshipId, side: "seed", counterpart: null });
        if (onOutput)
          add({ relationshipId, side: "output", counterpart: null });
        continue;
      }
      if (ref.kind === "entity") {
        if (output.seedEntityId === ref.entityId)
          add({
            relationshipId,
            side: "seed",
            counterpart: { kind: "entity", entityId: output.outputEntityId },
          });
        if (output.outputEntityId === ref.entityId)
          add({
            relationshipId,
            side: "output",
            counterpart: { kind: "entity", entityId: output.seedEntityId },
          });
        continue;
      }
      if (ref.kind === "point") {
        const seedPointIds = output.seedPointIds;
        if (seedPointIds.length !== output.outputPointIds.length) continue;
        seedPointIds.forEach((seedPointId, index) => {
          const outputPointId = output.outputPointIds[index]!;
          if (seedPointId === ref.pointId)
            add({
              relationshipId,
              side: "seed",
              counterpart: { kind: "point", pointId: outputPointId },
            });
          if (outputPointId === ref.pointId)
            add({
              relationshipId,
              side: "output",
              counterpart: { kind: "point", pointId: seedPointId },
            });
        });
        continue;
      }
      const side =
        output.seedEntityId === ref.entityId
          ? "seed"
          : output.outputEntityId === ref.entityId
            ? "output"
            : null;
      if (!side) continue;
      const seed = entityById.get(output.seedEntityId);
      const target = entityById.get(output.outputEntityId);
      if (seed?.kind !== "spline" || target?.kind !== "spline") continue;
      const seedOccurrences = orderedSplineOccurrences(seed);
      const targetOccurrences = orderedSplineOccurrences(target);
      if (
        !seedOccurrences ||
        !targetOccurrences ||
        seedOccurrences.length !== targetOccurrences.length
      )
        continue;
      const [from, to] =
        side === "seed"
          ? [seedOccurrences, targetOccurrences]
          : [targetOccurrences, seedOccurrences];
      const index = from.findIndex(
        (occurrence) => occurrence.occurrenceId === ref.occurrenceId,
      );
      if (index < 0) continue;
      add({
        relationshipId,
        side,
        counterpart: {
          kind: "splineOccurrence",
          entityId: side === "seed" ? target.entityId : seed.entityId,
          occurrenceId: to[index]!.occurrenceId,
        },
      });
    }
  }
  return steps;
}

/**
 * Every mirror relationship `ref` takes part in directly (definition
 * order), with its counterpart through the recorded seed/output maps (ids
 * are authored and never regenerated) and, for an output-side step, the
 * upstream chain to the root seed. A relationship whose map is stale
 * (the `derived-mirror-map-stale` check) yields a null counterpart and
 * ends a chain. Bounded: each relationship is visited at most once per
 * chain.
 */
export function resolveMirrorCounterpart(
  definition: CorrespondenceDefinition,
  ref: MirrorCorrespondenceRef,
): readonly MirrorCorrespondence[] {
  const geometry = indexMirrorGeometry(definition);
  const staleRelationships = new Set(
    (definition.derivedRelationships ?? []).flatMap((relationship) =>
      relationship.kind === "mirror" &&
      relationship.outputs.some(
        (output) => "stale" in checkMirrorOutputMap(output, geometry),
      )
        ? [relationship.derivationId]
        : [],
    ),
  );
  const steps = (current: MirrorCorrespondenceRef) =>
    counterpartSteps(
      definition,
      geometry.entityById,
      staleRelationships,
      current,
    );
  return steps(ref).map((step) => {
    if (step.side === "seed") return { ...step, chain: [] };
    const chain: MirrorCounterpart[] = [];
    const visited = new Set([step.relationshipId]);
    let current = step.counterpart;
    while (current) {
      const next = steps(current).find(
        (candidate) =>
          candidate.side === "output" && !visited.has(candidate.relationshipId),
      );
      if (!next) break;
      visited.add(next.relationshipId);
      chain.push(next);
      current = next.counterpart;
    }
    return { ...step, chain };
  });
}

// ------------------------------------------------- session helpers (T15d)

/**
 * T15d (R-1, [TECH] T-3): the structural sync of every mirror output of a
 * definition, in dependency order (an upstream copy before the mirror that
 * reads it), with no point, radius or kept authored vector written: tangent
 * kinds (exact zeros included), sweep direction, closure, policy and
 * `endSpanParameterLengths` follow the seed (`applyMirrorOutputStructure`).
 * An output occurrence that becomes authored-nonzero needs a value: the
 * reflected seed vector (initialization, as at creation; after a solve the
 * caller overwrites it with the snapshot's). Relationships in `held` (a
 * solve's `failedDerivationIds`) and those the owner cannot evaluate
 * (missing or degenerate axis, stale map, unresolved order) keep their
 * outputs untouched. Returns `definition` itself when nothing changes.
 */
export function syncMirrorOutputStructures(input: {
  readonly definition: SketchDefinition;
  readonly modelingTolerance: number;
  readonly held?: ReadonlySet<string>;
}): SketchDefinition {
  const { definition, held } = input;
  const mirrors = orderDerivedRelationships(definition).order.filter(
    (relationship): relationship is MirrorRelationship =>
      relationship.kind === "mirror" && !held?.has(relationship.derivationId),
  );
  if (mirrors.length === 0) return definition;
  const entityById = new Map(
    definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const geometry: MirrorGeometry = {
    pointById: new Map(
      definition.points.map((point) => [point.pointId, point]),
    ),
    entityById,
  };
  let changed = false;
  for (const relationship of mirrors) {
    const evaluation = evaluateMirrorRelationship({
      relationship,
      geometry,
      modelingTolerance: input.modelingTolerance,
    });
    if (!evaluation.ok) continue;
    for (const output of evaluation.outputs) {
      const current = entityById.get(output.outputEntityId)!;
      const synced = applyMirrorOutputStructure(current, output);
      if (sameMirrorStructure(current, synced)) continue;
      entityById.set(synced.entityId, synced);
      changed = true;
    }
  }
  return changed
    ? {
        ...definition,
        entities: definition.entities.map(
          (entity) => entityById.get(entity.entityId) ?? entity,
        ),
      }
    : definition;
}

/** Whether the structural sync left an output as it was (values included). */
function sameMirrorStructure(
  current: SketchEntityDefinition,
  synced: SketchEntityDefinition,
): boolean {
  if (current === synced) return true;
  if (current.kind === "arc" && synced.kind === "arc")
    return current.sweepDirection === synced.sweepDirection;
  if (current.kind !== "spline" || synced.kind !== "spline") return false;
  const sameVector = (first: SplineVector, second: SplineVector) =>
    Object.is(first[0], second[0]) && Object.is(first[1], second[1]);
  return (
    current.closure === synced.closure &&
    current.interpolationPolicy === synced.interpolationPolicy &&
    current.endSpanParameterLengths?.start ===
      synced.endSpanParameterLengths?.start &&
    current.endSpanParameterLengths?.end ===
      synced.endSpanParameterLengths?.end &&
    current.pointOccurrences.every((occurrence, index) => {
      const next = synced.pointOccurrences[index]!.tangent;
      const tangent = occurrence.tangent;
      return tangent.kind === "automatic"
        ? next.kind === "automatic"
        : next.kind === "authored" && sameVector(tangent.vector, next.vector);
    })
  );
}

/**
 * T15d ([TECH] T-12): the authority of a mirror output's spline occurrence
 * is its root seed's occurrence (the output's tangent is a driven slot).
 * For an occurrence on the output side of a mirror, returns the root seed
 * occurrence (through a chain of mirrors of mirrors) and `vector`, a
 * tangent vector at the output occurrence, carried to it by each step's
 * vector reflection (an involution, so the seed vector reproduces the
 * output's). Null when the occurrence is no mirror output, or a step's
 * mirror cannot be evaluated (stale map, missing or degenerate axis).
 */
export function mirrorSeedTangentOf(input: {
  readonly definition: SketchDefinition;
  readonly modelingTolerance: number;
  readonly entityId: SketchEntityId;
  readonly occurrenceId: string;
  readonly vector: SplineVector;
}): {
  readonly entityId: SketchEntityId;
  readonly occurrenceId: string;
  readonly vector: SplineVector;
} | null {
  const { definition } = input;
  const step = resolveMirrorCounterpart(definition, {
    kind: "splineOccurrence",
    entityId: input.entityId,
    occurrenceId: input.occurrenceId,
  }).find((candidate) => candidate.side === "output");
  if (!step) return null;
  const geometry = indexMirrorGeometry(definition);
  let vector = input.vector;
  let counterpart: MirrorCorrespondenceRef | null = null;
  for (const current of [step, ...step.chain]) {
    const relationship = definition.derivedRelationships?.find(
      (candidate) => candidate.derivationId === current.relationshipId,
    );
    if (relationship?.kind !== "mirror" || !current.counterpart) return null;
    const resolution = resolveMirrorAxis(
      relationship.derivationId,
      relationship.mirrorReference,
      geometry,
      input.modelingTolerance,
    );
    if (!resolution.ok) return null;
    vector = mirrorVector(resolution.axis, vector);
    counterpart = current.counterpart;
  }
  return counterpart?.kind === "splineOccurrence"
    ? {
        entityId: counterpart.entityId,
        occurrenceId: counterpart.occurrenceId,
        vector,
      }
    : null;
}

/**
 * T15d ([TECH] T-12): the root seed occurrence of a mirror output's spline
 * occurrence (through a chain of mirrors of mirrors), which holds its
 * tangent's authority. Null when the occurrence is no mirror output or the
 * chain has a stale map (no correspondence).
 */
export function mirrorRootSeedOccurrence(
  definition: CorrespondenceDefinition,
  entityId: SketchEntityId,
  occurrenceId: string,
): { readonly entityId: SketchEntityId; readonly occurrenceId: string } | null {
  const step = resolveMirrorCounterpart(definition, {
    kind: "splineOccurrence",
    entityId,
    occurrenceId,
  }).find((candidate) => candidate.side === "output");
  const root = step ? [step, ...step.chain].at(-1)!.counterpart : null;
  return root?.kind === "splineOccurrence"
    ? { entityId: root.entityId, occurrenceId: root.occurrenceId }
    : null;
}
