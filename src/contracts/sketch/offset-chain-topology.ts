import type {
  CertifiedCubicTubeChain,
  CertifiedTubePieceChain,
  CubicTubeChainResult,
  NeutralCurve,
  NeutralCurvePointWitness,
  NeutralCurveQueryRequest,
  NeutralCurveQueryResult,
  TubeChainPiece,
  TubePieceChainResult,
} from "@/contracts/modeling/neutral-curve-query";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { DeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import {
  OFFSET_DIAGNOSTIC_CODES,
  offsetLinePoints,
  type OffsetChainFailure,
} from "@/contracts/sketch/offset-geometry";
import type {
  SketchDefinition,
  SketchPoint2D,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  evaluateSplineSpan,
  reconstructSplineAggregate,
  type SplineSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  approximateSplineOffset,
  type SplineOffsetCubicSpan,
} from "@/contracts/sketch/spline-offset-geometry";

/**
 * Certified topology of one offset chain's emitted approximant.
 *
 * The resolver decides every joint only by the injected certified neutral
 * query on the unchanged raw supports (owner poles, raw line/arc supports),
 * all on ONE whole-request meter. The trim authority is the joint's request
 * plus its proof-bearing witness bounds; numeric parameters are
 * representatives only.
 *
 * Global validity (M0) is NOT decided by the resolver: a resolution is only a
 * trim placement. The chain is certified simple, with these trim placements,
 * only by a verified `certifyOffsetChainTubeStability` result (K1 on adjacent
 * leaves, K3 on every other leaf pair, the joint query plus Lemma T at every
 * line trim or the S2 graph trim, with its emitted G1 cone, at every
 * cubic↔cubic trim). Chains outside the certifier's scope are
 * `topologyStabilityUnsupported`, never valid without a certificate. Fallback
 * arcs and tangent-continuous joints with a spline side are temporarily
 * unsupported.
 */

/** One whole-request pair meter: every query of the request draws on it. */
export interface CertifiedNeutralCurvePairRequest {
  queryPair(request: NeutralCurveQueryRequest): NeutralCurveQueryResult;
}

/**
 * Opens whole-request pair meters. The implementation sizes each request's
 * single budget structurally from `queryCount` (the exact number of pair
 * queries the request will issue) and precharges it; it is never reset.
 */
export interface CertifiedNeutralCurveRequestQuery {
  openRequest(queryCount: number): CertifiedNeutralCurvePairRequest;
}

/** Raw (untrimmed) offset pieces in traversal order, each in its natural order. */
export type OffsetChainPiece =
  | {
      readonly kind: "lineSegment";
      readonly seedEntityId: SketchEntityId;
      readonly reversed: boolean;
      readonly start: SketchPoint2D;
      readonly end: SketchPoint2D;
    }
  | {
      readonly kind: "arc";
      readonly seedEntityId: SketchEntityId;
      readonly reversed: boolean;
      readonly center: SketchPoint2D;
      readonly radius: number;
      readonly start: SketchPoint2D;
      readonly end: SketchPoint2D;
      readonly sweepDirection: "clockwise" | "counterClockwise";
    }
  | {
      readonly kind: "derivedCubic";
      readonly seedEntityId: SketchEntityId;
      readonly reversed: boolean;
      /** Owner output of one fresh reconstruction, in natural source order. */
      readonly spans: readonly SplineOffsetCubicSpan[];
    };

export interface OffsetChainTopologyInput {
  readonly pieces: readonly OffsetChainPiece[];
  readonly closed: boolean;
  /** The document's settings.modelingTolerance, forwarded unchanged. */
  readonly modelingTolerance: number;
  readonly query: CertifiedNeutralCurveRequestQuery;
}

/** Where an active domain ends: the exact raw source end, or a joint root. */
export type OffsetChainDomainEnd =
  | { readonly kind: "source" }
  | { readonly kind: "joint"; readonly jointIndex: number };

export interface ResolvedOffsetTrimJoint {
  readonly firstSeedEntityId: SketchEntityId;
  readonly secondSeedEntityId: SketchEntityId;
  /** Trim authority: the unchanged raw-support request and its single witness. */
  readonly request: NeutralCurveQueryRequest;
  readonly witness: NeutralCurvePointWitness;
  /** Conservative enclosures of the exact root in each support's parameter. */
  readonly firstParameterBounds: readonly [number, number];
  readonly secondParameterBounds: readonly [number, number];
  /** Binary64 representatives only; never trim identity. */
  readonly firstParameter: number;
  readonly secondParameter: number;
  readonly position: SketchPoint2D;
}

export interface ResolvedDerivedCubicSpan {
  /** Unchanged owner poles and certificate. */
  readonly span: SplineOffsetCubicSpan;
  readonly sourceDomain: readonly [number, number];
  readonly start: OffsetChainDomainEnd;
  readonly end: OffsetChainDomainEnd;
  /** Positional representative of the active domain; authority is start/end. */
  readonly representativeQueryDomain: readonly [number, number];
}

export interface ResolvedOffsetLineArcEndpoints {
  /** Natural-order positions; joint ends are representatives. */
  readonly start: SketchPoint2D;
  readonly end: SketchPoint2D;
  readonly startDomainEnd: OffsetChainDomainEnd;
  readonly endDomainEnd: OffsetChainDomainEnd;
}

export interface OffsetChainTopologySuccess {
  readonly ok: true;
  /** The exact input this result was resolved from (identity-checked by the JVP). */
  readonly input: OffsetChainTopologyInput;
  readonly cubics: ReadonlyMap<
    SketchEntityId,
    readonly ResolvedDerivedCubicSpan[]
  >;
  readonly lineArcEndpoints: ReadonlyMap<
    SketchEntityId,
    ResolvedOffsetLineArcEndpoints
  >;
  readonly joints: readonly ResolvedOffsetTrimJoint[];
}

export type OffsetChainTopologyResult =
  | OffsetChainTopologySuccess
  | OffsetChainFailure;

/** First-order variation of raw line/arc pieces; cubic variation is `span.differential`. */
export type OffsetChainPieceVariation =
  | {
      readonly kind: "lineSegment";
      readonly start: SketchPoint2D;
      readonly end: SketchPoint2D;
    }
  | {
      readonly kind: "arc";
      readonly center: SketchPoint2D;
      readonly radius: number;
      readonly start: SketchPoint2D;
      readonly end: SketchPoint2D;
    };

export type OffsetChainTopologyJvp =
  | {
      readonly ok: true;
      readonly representativeQueryDomains: ReadonlyMap<
        SketchEntityId,
        readonly (readonly [number, number])[]
      >;
      readonly jointPositions: readonly SketchPoint2D[];
      readonly lineArcEndpoints: ReadonlyMap<
        SketchEntityId,
        { readonly start: SketchPoint2D; readonly end: SketchPoint2D }
      >;
    }
  | OffsetChainFailure;

type Side = "low" | "high";

interface ChainCurve {
  readonly pieceIndex: number;
  readonly spanIndex: number;
  readonly neutral: NeutralCurve;
  /** True when the natural start is the low source-domain end. */
  readonly startIsLow: boolean;
  readonly bounds: readonly [number, number];
  low: OffsetChainDomainEnd;
  high: OffsetChainDomainEnd;
}

interface JointRecord {
  readonly joint: ResolvedOffsetTrimJoint;
  readonly firstCurve: number;
  readonly secondCurve: number;
}

const SOURCE_END: OffsetChainDomainEnd = { kind: "source" };
const codes = OFFSET_DIAGNOSTIC_CODES;

function failure(
  code: OffsetChainFailure["code"],
  message: string,
  seedEntityId: SketchEntityId | null,
): OffsetChainFailure {
  return { ok: false, code, message, seedEntityId };
}

const bits = new DataView(new ArrayBuffer(8));

/** Adjacent IEEE binary64 value; the maximum finite value steps to infinity. */
function binary64Neighbor(value: number, direction: "down" | "up") {
  if (value === 0) {
    return direction === "up" ? Number.MIN_VALUE : -Number.MIN_VALUE;
  }
  bits.setFloat64(0, value);
  const away = value > 0 === (direction === "up");
  bits.setBigUint64(0, bits.getBigUint64(0) + (away ? 1n : -1n));
  return bits.getFloat64(0);
}

/**
 * Conservative enclosure of the exact root in one support's parameter.
 * Finite-line witnesses carry the correctly rounded representative, so the
 * exact rational root lies within one binary64 neighbor on each side (a
 * rounding-error bound, not a geometric tolerance). A non-finite enclosure
 * returns null and callers fail closed.
 */
export function offsetChainRootEnclosure(
  witness: NeutralCurvePointWitness,
  curve: "first" | "second",
): readonly [number, number] | null {
  const bounds =
    curve === "first"
      ? witness.proof.firstParameterBounds
      : witness.proof.secondParameterBounds;
  const enclosure =
    witness.proof.kind === "exactFiniteLineIntersection"
      ? ([
          binary64Neighbor(bounds[0], "down"),
          binary64Neighbor(bounds[1], "up"),
        ] as const)
      : bounds;
  return Number.isFinite(enclosure[0]) && Number.isFinite(enclosure[1])
    ? enclosure
    : null;
}

function neutralBase(seedEntityId: SketchEntityId, spanIndex: number) {
  return {
    curveId: `${seedEntityId}:${spanIndex}`,
    provenance: {
      sourceEntityId: seedEntityId,
      sourceSpanId: String(spanIndex),
    },
  };
}

function buildCurves(pieces: readonly OffsetChainPiece[]) {
  const curves: ChainCurve[] = [];
  const pieceCurves: (readonly [number, number])[] = [];
  const seen = new Set<SketchEntityId>();
  pieces.forEach((piece, pieceIndex) => {
    if (seen.has(piece.seedEntityId)) {
      throw new RangeError("Offset chain pieces must have unique seed IDs");
    }
    seen.add(piece.seedEntityId);
    const first = curves.length;
    const push = (
      spanIndex: number,
      neutral: NeutralCurve,
      startIsLow: boolean,
      bounds: readonly [number, number],
    ) =>
      curves.push({
        pieceIndex,
        spanIndex,
        neutral,
        startIsLow,
        bounds,
        low: SOURCE_END,
        high: SOURCE_END,
      });
    if (piece.kind === "derivedCubic") {
      if (piece.spans.length === 0) {
        throw new RangeError("A derived cubic piece needs at least one span");
      }
      piece.spans.forEach((span, spanIndex) =>
        push(
          spanIndex,
          {
            kind: "cubicBezier",
            ...neutralBase(piece.seedEntityId, spanIndex),
            poles: span.poles,
            sourceDomain: span.sourceInterval,
          },
          true,
          span.sourceInterval,
        ),
      );
    } else if (piece.kind === "lineSegment") {
      // The query support is exactly the displayed segment: 0 is start, 1 is end.
      push(
        0,
        {
          kind: "line",
          form: "endpointSegment",
          ...neutralBase(piece.seedEntityId, 0),
          start: piece.start,
          end: piece.end,
          sourceDomain: [0, 1],
        },
        true,
        [0, 1],
      );
    } else {
      const angle = (point: SketchPoint2D) =>
        Math.atan2(point[1] - piece.center[1], point[0] - piece.center[0]);
      const ccw = piece.sweepDirection === "counterClockwise";
      const low = angle(ccw ? piece.start : piece.end);
      let high = angle(ccw ? piece.end : piece.start);
      while (high <= low) high += 2 * Math.PI;
      push(
        0,
        {
          kind: "circle",
          ...neutralBase(piece.seedEntityId, 0),
          center: piece.center,
          radius: piece.radius,
          xAxis: [1, 0],
          sourceDomain: { kind: "arc", interval: [low, high] },
        },
        ccw,
        [low, high],
      );
    }
    pieceCurves.push([first, curves.length - 1]);
  });
  return { curves, pieceCurves };
}

/** Traversal terminal curve and the source-domain side it ends on. */
function terminal(
  pieces: readonly OffsetChainPiece[],
  pieceCurves: readonly (readonly [number, number])[],
  curves: readonly ChainCurve[],
  pieceIndex: number,
  which: "traversalStart" | "traversalEnd",
): { curve: number; side: Side } {
  const [first, last] = pieceCurves[pieceIndex]!;
  const naturalEnd =
    (which === "traversalEnd") !== pieces[pieceIndex]!.reversed;
  const curve = naturalEnd ? last : first;
  const startIsLow = curves[curve]!.startIsLow;
  return { curve, side: naturalEnd === startIsLow ? "high" : "low" };
}

function strictlyInside(
  enclosure: readonly [number, number],
  bounds: readonly [number, number],
) {
  return enclosure[0] > bounds[0] && enclosure[1] < bounds[1];
}

/** Proof-backed nonsingular crossing admitted for a trim (manifest R-B). */
function transverseCrossing(witness: NeutralCurvePointWitness) {
  if (witness.classification !== "crossing") return false;
  const proof = witness.proof;
  switch (proof.kind) {
    case "exactFiniteLineIntersection":
      return true;
    case "exactImplicitLineRootSet":
      return proof.rootMultiplicity === 1;
    case "exactAlgebraicCurveRootSet":
      return (
        (proof.family === "circlePair" || proof.family === "circleCubic") &&
        proof.rootMultiplicity === 1
      );
    case "exactCubicPairRootSet": {
      const determinant = proof.sourceUnitTangentDeterminantBounds;
      return (
        determinant !== undefined && (determinant[0] > 0 || determinant[1] < 0)
      );
    }
    default:
      return false;
  }
}

function describe(result: NeutralCurveQueryResult) {
  return result.kind === "verified"
    ? "verified"
    : `${result.kind} ${result.code}: ${result.message}`;
}

function samePoint(first: SketchPoint2D, second: SketchPoint2D) {
  return Object.is(first[0], second[0]) && Object.is(first[1], second[1]);
}

/**
 * Resolves the trim joints of the emitted chain: joint queries only, on one
 * whole-request meter opened for exactly the joint count. It proves each
 * joint's single transverse interior crossing and the order of two trims on
 * one curve; it does NOT prove global validity (see the module note).
 * Ordinary exceptions from the query propagate unchanged.
 */
export function resolveOffsetChainTopology(
  input: OffsetChainTopologyInput,
): OffsetChainTopologyResult {
  const { pieces, closed, modelingTolerance, query } = input;
  if (pieces.length === 0) {
    throw new RangeError("An offset chain needs at least one piece");
  }
  const { curves, pieceCurves } = buildCurves(pieces);
  const seedOf = (curve: number) =>
    pieces[curves[curve]!.pieceIndex]!.seedEntityId;
  const pair = (first: number, second: number): NeutralCurveQueryRequest => ({
    modelingTolerance,
    first: curves[first]!.neutral,
    second: curves[second]!.neutral,
  });

  // Declared intra-output incidences: bitwise-shared owner knots only.
  let wrapIsKnot = false;
  const singleClosedPiece = closed && pieces.length === 1;
  for (const [pieceIndex, piece] of pieces.entries()) {
    if (piece.kind !== "derivedCubic") continue;
    const [first, last] = pieceCurves[pieceIndex]!;
    for (let curve = first; curve < last; curve += 1) {
      const left = piece.spans[curve - first]!;
      const right = piece.spans[curve - first + 1]!;
      if (!samePoint(left.poles[3], right.poles[0])) {
        return failure(
          codes.topologyUncertain,
          `Derived cubic spans ${curve - first} and ${curve - first + 1} do not share a bitwise owner knot.`,
          piece.seedEntityId,
        );
      }
    }
    wrapIsKnot ||=
      singleClosedPiece &&
      last > first &&
      samePoint(piece.spans.at(-1)!.poles[3], piece.spans[0]!.poles[0]);
  }

  const jointRecords: JointRecord[] = [];
  const jointCount = wrapIsKnot
    ? 0
    : closed
      ? pieces.length
      : pieces.length - 1;
  // M7: one precharged whole-request meter for exactly these joint queries.
  const jointRequest = query.openRequest(jointCount);
  for (let index = 0; index < jointCount; index += 1) {
    const next = (index + 1) % pieces.length;
    const end = terminal(pieces, pieceCurves, curves, index, "traversalEnd");
    const start = terminal(pieces, pieceCurves, curves, next, "traversalStart");
    const firstSeed = pieces[index]!.seedEntityId;
    if (end.curve === start.curve) {
      return failure(
        codes.splineJointUnsupported,
        "A closed single-curve offset whose only curve joins itself is not supported yet.",
        firstSeed,
      );
    }
    const request = pair(end.curve, start.curve);
    const result = jointRequest.queryPair(request);
    if (result.kind !== "verified") {
      return failure(
        codes.topologyUncertain,
        result.code === "exact-query-proof-budget-exhausted"
          ? `Joint query is not verified (${describe(result)}): the whole-request budget of all ${jointCount} joint queries is exhausted, not necessarily by this joint.`
          : `Joint query is not verified (${describe(result)}).`,
        firstSeed,
      );
    }
    if (result.points.length === 0 && result.overlaps.length === 0) {
      return failure(
        codes.splineJointUnsupported,
        "Offset joint needs a fallback arc or tangent-continuous join, which is not supported yet for spline chains.",
        firstSeed,
      );
    }
    const witness = result.points[0];
    const firstBounds = witness && offsetChainRootEnclosure(witness, "first");
    const secondBounds = witness && offsetChainRootEnclosure(witness, "second");
    if (
      result.overlaps.length !== 0 ||
      result.points.length !== 1 ||
      !witness ||
      !firstBounds ||
      !secondBounds ||
      !strictlyInside(firstBounds, curves[end.curve]!.bounds) ||
      !strictlyInside(secondBounds, curves[start.curve]!.bounds) ||
      !transverseCrossing(witness)
    ) {
      return failure(
        codes.jointUnsatisfied,
        "Offset joint has no single certified transverse interior crossing.",
        firstSeed,
      );
    }
    if (
      jointTangentDeterminant(
        pieces[curves[end.curve]!.pieceIndex]!,
        curves[end.curve]!.spanIndex,
        witness.firstParameter,
        pieces[curves[start.curve]!.pieceIndex]!,
        curves[start.curve]!.spanIndex,
        witness.secondParameter,
      ) === null
    ) {
      return failure(
        codes.derivativeUnavailable,
        "The offset joint derivative is singular or non-finite.",
        firstSeed,
      );
    }
    const jointIndex = jointRecords.length;
    jointRecords.push({
      firstCurve: end.curve,
      secondCurve: start.curve,
      joint: {
        firstSeedEntityId: firstSeed,
        secondSeedEntityId: pieces[next]!.seedEntityId,
        request,
        witness,
        firstParameterBounds: firstBounds,
        secondParameterBounds: secondBounds,
        firstParameter: witness.firstParameter,
        secondParameter: witness.secondParameter,
        position: witness.position,
      },
    });
    curves[end.curve]![end.side] = { kind: "joint", jointIndex };
    curves[start.curve]![start.side] = { kind: "joint", jointIndex };
  }

  // Two trims on one curve must be ordered by disjoint root enclosures.
  for (const [curveIndex, curve] of curves.entries()) {
    if (curve.low.kind !== "joint" || curve.high.kind !== "joint") continue;
    const bounds = (jointIndex: number) => {
      const record = jointRecords[jointIndex]!;
      return record.firstCurve === curveIndex
        ? record.joint.firstParameterBounds
        : record.joint.secondParameterBounds;
    };
    const low = bounds(curve.low.jointIndex);
    const high = bounds(curve.high.jointIndex);
    if (low[1] < high[0]) continue;
    return failure(
      high[1] < low[0] ? codes.jointUnsatisfied : codes.topologyUncertain,
      high[1] < low[0]
        ? "Both trims of one offset curve remove its whole active domain."
        : "Both trims of one offset curve have unordered root enclosures.",
      seedOf(curveIndex),
    );
  }

  const joints = jointRecords.map(({ joint }) => joint);
  const jointParameter = (end: OffsetChainDomainEnd, curveIndex: number) => {
    if (end.kind === "source") return null;
    const record = jointRecords[end.jointIndex]!;
    return record.firstCurve === curveIndex
      ? record.joint.firstParameter
      : record.joint.secondParameter;
  };
  const cubics = new Map<SketchEntityId, ResolvedDerivedCubicSpan[]>();
  const lineArcEndpoints = new Map<
    SketchEntityId,
    ResolvedOffsetLineArcEndpoints
  >();
  for (const [pieceIndex, piece] of pieces.entries()) {
    const [first, last] = pieceCurves[pieceIndex]!;
    if (piece.kind === "derivedCubic") {
      cubics.set(
        piece.seedEntityId,
        piece.spans.map((span, offset) => {
          const curve = curves[first + offset]!;
          return {
            span,
            sourceDomain: span.sourceInterval,
            start: curve.low,
            end: curve.high,
            representativeQueryDomain: [
              jointParameter(curve.low, first + offset) ?? curve.bounds[0],
              jointParameter(curve.high, first + offset) ?? curve.bounds[1],
            ],
          };
        }),
      );
      continue;
    }
    const curve = curves[last]!;
    const startEnd = curve.startIsLow ? curve.low : curve.high;
    const endEnd = curve.startIsLow ? curve.high : curve.low;
    const position = (end: OffsetChainDomainEnd, source: SketchPoint2D) =>
      end.kind === "joint" ? joints[end.jointIndex]!.position : source;
    lineArcEndpoints.set(piece.seedEntityId, {
      start: position(startEnd, piece.start),
      end: position(endEnd, piece.end),
      startDomainEnd: startEnd,
      endDomainEnd: endEnd,
    });
  }
  return { ok: true, input, cubics, lineArcEndpoints, joints };
}

export type OffsetChainTubeStabilityCertificate = Extract<
  TubePieceChainResult,
  { readonly kind: "verified" }
>["certificate"];

/** Natural-order source authority of one piece from one fresh adapter call. */
export type DeclaredOffsetPieceSource =
  | {
      readonly kind: "line";
      readonly source: readonly [SketchPoint2D, SketchPoint2D];
      /** Owner distance reversed ? −d : d, bitwise. */
      readonly distance: number;
      readonly startPointId: SketchPointId;
      readonly endPointId: SketchPointId;
    }
  | {
      readonly kind: "spline";
      readonly distance: number;
      /** The single owner call's spans (the resolver piece holds this array). */
      readonly spans: readonly SplineOffsetCubicSpan[];
    };

export interface DeclaredOffsetChainPieces {
  readonly ok: true;
  readonly connectivity: DeclaredOffsetChainConnectivity;
  readonly distance: number;
  readonly modelingTolerance: number;
  /** Raw resolver pieces in declared traversal order, forwarded by reference. */
  readonly pieces: readonly OffsetChainPiece[];
  readonly sources: readonly DeclaredOffsetPieceSource[];
}

function sameVector(first: SketchPoint2D, second: SketchPoint2D) {
  return Object.is(first[0], second[0]) && Object.is(first[1], second[1]);
}

function sameSpanGeometry(first: SplineSpan, second: SplineSpan) {
  return (
    Object.is(first.interval[0], second.interval[0]) &&
    Object.is(first.interval[1], second.interval[1]) &&
    first.source.splineId === second.source.splineId &&
    first.source.spanIndex === second.source.spanIndex &&
    first.source.startPointId === second.source.startPointId &&
    first.source.endPointId === second.source.endPointId &&
    first.source.startOccurrenceId === second.source.startOccurrenceId &&
    first.source.endOccurrenceId === second.source.endOccurrenceId &&
    first.poles.every((pole, index) => sameVector(pole, second.poles[index]!))
  );
}

/**
 * Fresh N2 → N1 adapter. It accepts only a trusted `(definition,
 * solvedSnapshot)` pair from one accepted solve: E1–E4 check the producer's
 * solved status, ordered ID coverage, seed geometry bitwise against solved
 * entities, and each direct coincident declaration. `satisfied` is relative to
 * that producer's solve policy. This does not detect same-ID parameter edits,
 * changes to unselected entities, or forged snapshots; a future consumer must
 * bind inside the accepted `session.liveSolve` pair's scope (its definition
 * with its own solved snapshot), never a session definition with a cached
 * incomplete-drag snapshot.
 *
 * Per declared piece, d_i = reversed ? −d : d. A line is
 * `offsetLinePoints` of its positions; a spline is ONE reconstruction and ONE
 * owner call, forwarded unchanged. No coordinate proximity is consulted.
 */
export function declaredOffsetChainPieces(input: {
  readonly definition: Pick<
    SketchDefinition,
    "points" | "entities" | "constraints" | "dimensions"
  >;
  readonly solvedSnapshot: SolvedSketchSnapshot;
  readonly connectivity: DeclaredOffsetChainConnectivity;
  readonly distance: number;
  readonly modelingTolerance: number;
}): DeclaredOffsetChainPieces | OffsetChainFailure {
  const {
    definition,
    solvedSnapshot,
    connectivity,
    distance,
    modelingTolerance,
  } = input;
  const uncertain = (
    message: string,
    seedEntityId: SketchEntityId | null = null,
  ) => failure(codes.topologyUncertain, message, seedEntityId);
  if (
    solvedSnapshot.status.solveState !== "solved" ||
    solvedSnapshot.constraintStatuses.some(
      (status) => status.status !== "satisfied",
    ) ||
    solvedSnapshot.dimensionStatuses.some(
      (status) => status.status === "unsatisfied",
    ) ||
    solvedSnapshot.diagnostics.some(
      (diagnostic) => diagnostic.severity === "error",
    )
  )
    return uncertain("The solve frame is not solver-accepted.");
  const sameIds = (actual: readonly string[], expected: readonly string[]) =>
    actual.length === expected.length &&
    actual.every((id, index) => id === expected[index]);
  if (
    !sameIds(
      solvedSnapshot.constraintStatuses.map((item) => item.constraintId),
      definition.constraints.map((item) => item.constraintId),
    ) ||
    !sameIds(
      solvedSnapshot.dimensionStatuses.map((item) => item.dimensionId),
      definition.dimensions.map((item) => item.dimensionId),
    ) ||
    !sameIds(
      solvedSnapshot.solvedPoints.map((item) => item.pointId),
      definition.points.map((item) => item.pointId),
    )
  )
    return uncertain("The solve frame does not cover this definition.");
  for (const join of connectivity.joins) {
    if (join.kind !== "coincidentConstraint") continue;
    const constraints = definition.constraints.filter(
      (constraint) => constraint.constraintId === join.constraintId,
    );
    const constraint = constraints[0];
    if (
      constraints.length !== 1 ||
      constraint?.kind !== "coincident" ||
      constraint.pointIds[0] !== join.pointIds[0] ||
      constraint.pointIds[1] !== join.pointIds[1]
    )
      return uncertain(
        "The declared coincident join is not a direct constraint of this definition.",
      );
  }
  const positions: Record<string, SplineVector> = {};
  for (const point of definition.points)
    positions[point.pointId] = point.position;
  const pieces: OffsetChainPiece[] = [];
  const sources: DeclaredOffsetPieceSource[] = [];
  for (const { seedEntityId, reversed } of connectivity.pieces) {
    const entity = definition.entities.find(
      (candidate) => candidate.entityId === seedEntityId,
    );
    const solvedEntities = solvedSnapshot.solvedEntities.filter(
      (candidate) => candidate.entityId === seedEntityId,
    );
    const effective = reversed ? -distance : distance;
    if (entity?.kind === "lineSegment") {
      const solved = solvedEntities[0];
      const start = positions[entity.startPointId];
      const end = positions[entity.endPointId];
      if (
        solvedEntities.length !== 1 ||
        solved?.kind !== "lineSegment" ||
        !start ||
        !end ||
        !sameVector(start, solved.startPosition) ||
        !sameVector(end, solved.endPosition)
      )
        return uncertain(
          "The line seed geometry does not match the solve frame.",
          seedEntityId,
        );
      const offset = offsetLinePoints(start, end, effective);
      if (!offset)
        return failure(
          codes.unsupportedSeed,
          "Offset seed segment is missing or too short.",
          seedEntityId,
        );
      pieces.push({
        kind: "lineSegment",
        seedEntityId,
        reversed,
        start: offset.start,
        end: offset.end,
      });
      sources.push({
        kind: "line",
        source: [start, end],
        distance: effective,
        startPointId: entity.startPointId,
        endPointId: entity.endPointId,
      });
      continue;
    }
    if (entity?.kind !== "spline")
      return failure(
        codes.topologyStabilityUnsupported,
        "Tube stability supports declared line and spline pieces only.",
        seedEntityId,
      );
    const geometry = reconstructSplineAggregate(entity, positions);
    const solved = solvedEntities[0];
    if (
      solvedEntities.length !== 1 ||
      solved?.kind !== "spline" ||
      geometry.validity !== "valid" ||
      solved.reconstruction.validity !== "valid" ||
      geometry.spans.length !== solved.reconstruction.spans.length ||
      geometry.spans.some(
        (span, index) =>
          !sameSpanGeometry(span, solved.reconstruction.spans[index]!),
      )
    )
      return uncertain(
        "The spline seed geometry does not match the solve frame.",
        seedEntityId,
      );
    const owner = approximateSplineOffset({
      spans: geometry.spans,
      distance: effective,
      modelingTolerance,
    });
    if (!owner.ok)
      return failure(
        codes.splineFitFailure,
        `The spline offset owner did not certify (${owner.code}).`,
        seedEntityId,
      );
    pieces.push({
      kind: "derivedCubic",
      seedEntityId,
      reversed,
      spans: owner.spans,
    });
    sources.push({ kind: "spline", distance: effective, spans: owner.spans });
  }
  return {
    ok: true,
    connectivity,
    distance,
    modelingTolerance,
    pieces,
    sources,
  };
}

export type OffsetChainTubeStabilityResult =
  | {
      readonly ok: true;
      readonly resolved: OffsetChainTopologySuccess;
      readonly seedEntityId: SketchEntityId;
      /** Join and pair indices are the owner's natural span order. */
      readonly certificate: OffsetChainTubeStabilityCertificate;
    }
  | OffsetChainFailure;

/**
 * C6-S1′/J2′ bounded helper, not wired into any frame, and the SOLE global
 * validity gate of an offset chain (M0): an ok result returns the certified
 * resolution, whose emitted chain with the resolver's trim placements is
 * simple and carries the topology of the declared-join-corrected true offset
 * under the owner's error tubes. Without `declared` the scope is one untrimmed
 * spline offset piece with no joints; everything else is
 * `topologyStabilityUnsupported`, never assumed valid.
 *
 * Owner spans are forwarded unchanged in natural source order, whatever the
 * traversal direction: reversing poles would pair them with the owner's
 * natural-order derivative enclosure and source normal. The tolerance, errors
 * and proof metadata are forwarded unchanged; binding them to one fresh owner
 * call remains the caller's obligation. Certifier exceptions propagate.
 *
 * With `declared` (L1b/R_C): the resolution must be of exactly that adapter
 * output (piece identity). Shared-point joins use one traversal-terminal ID;
 * direct coincident joins use the distinct terminal IDs as an unordered pair.
 * Coincident certification is conditional on R_C/H2 and the adapter's trusted
 * E1–E4 `(definition, solvedSnapshot)` premise. Those checks do not detect
 * same-ID parameter edits or forged snapshots; a future consumer must bind the
 * accepted `session.liveSolve` pair, never combine a session definition with
 * a cached incomplete-drag snapshot. The certificate concerns the abstract
 * chain trimmed at exact witnessed roots only (never rounded ends). In a
 * multi-piece chain a one-leaf cubic piece is unsupported: K1 cone-checks
 * emitted hodographs only at intra-piece joins, so its emitted self-
 * injectivity would be uncertified (routed to a later certifier slice). The
 * gate stays even though an S2 graph-trim end checks the emitted G1 cone:
 * Lemma T's m′ is a TRUE-O′ cone and does not count.
 *
 * Cubic↔cubic trims (S2, terminal leaves only) are certified under R_C′: at a
 * declared coincident or shared-point cubic↔cubic join that passes H2 in a
 * solver-accepted frame, O* is the two pieces' true offsets, each trimmed at
 * their unique common point. The premises are the same as R_C: the adapter's
 * E1–E4 accepted pair, H2 on exact source tangents, the stored joint bounds
 * through the stored query-domain map, and the owner's ε/O′/source metadata;
 * the proof never reads the source gap P₃ − Q₀, so a nonzero declared gap is
 * neither bridged nor required. The certificate records one `graph-trim` per
 * such joint (direction e, outward true-root bounds, separation σ), and its
 * two leaves carry displacementBound = τ and the max-form baseErrorStar.
 * Simplicity is re-based on M0 (no resolver-side global gate): K1 on
 * intra-piece joins, K3 on every other pair, the resolver's complete joint
 * query for the joint pair and S2's G1 on the two terminal leaves.
 * `resolved.joints` is trusted; the certifier never re-derives its one-root
 * premise.
 */
export function certifyOffsetChainTubeStability(
  resolved: OffsetChainTopologySuccess,
  certifier: CertifiedCubicTubeChain,
): OffsetChainTubeStabilityResult;
export function certifyOffsetChainTubeStability(
  resolved: OffsetChainTopologySuccess,
  certifier: CertifiedTubePieceChain,
  declared: DeclaredOffsetChainPieces,
): OffsetChainTubeStabilityResult;
export function certifyOffsetChainTubeStability(
  resolved: OffsetChainTopologySuccess,
  certifier: CertifiedCubicTubeChain | CertifiedTubePieceChain,
  declared?: DeclaredOffsetChainPieces,
): OffsetChainTubeStabilityResult {
  if (declared)
    return certifyDeclaredTubeStability(
      resolved,
      certifier as CertifiedTubePieceChain,
      declared,
    );
  const { pieces, closed, modelingTolerance } = resolved.input;
  const piece = pieces.length === 1 ? pieces[0] : undefined;
  const seedEntityId = pieces[0]?.seedEntityId ?? null;
  if (
    !piece ||
    piece.kind !== "derivedCubic" ||
    resolved.joints.length !== 0 ||
    resolved.lineArcEndpoints.size !== 0
  ) {
    return failure(
      codes.topologyStabilityUnsupported,
      "Tube stability is certified only for one untrimmed spline offset without joints.",
      seedEntityId,
    );
  }
  const spans = resolved.cubics.get(piece.seedEntityId);
  if (
    resolved.cubics.size !== 1 ||
    spans?.length !== piece.spans.length ||
    spans.some(
      (item, index) =>
        item.span !== piece.spans[index] ||
        item.start.kind !== "source" ||
        item.end.kind !== "source",
    )
  ) {
    return failure(
      codes.topologyUncertain,
      "The resolution does not describe its own untrimmed owner spans.",
      piece.seedEntityId,
    );
  }
  const result = (certifier as CertifiedCubicTubeChain).certifyChain({
    modelingTolerance,
    closed,
    tubes: piece.spans.map((span) => ({
      poles: span.poles,
      certifiedError: span.certifiedError,
      reference: span.reference,
      source: span.source,
      sourceLocalInterval: span.sourceLocalInterval,
    })),
  });
  return tubeStabilityResult(resolved, piece.seedEntityId, result, "spans");
}

function tubeStabilityResult(
  resolved: OffsetChainTopologySuccess,
  seedEntityId: SketchEntityId,
  result: TubePieceChainResult | CubicTubeChainResult,
  indices: "spans" | "leaves",
): OffsetChainTubeStabilityResult {
  if (result.kind === "verified") {
    return {
      ok: true,
      resolved,
      seedEntityId,
      certificate: result.certificate,
    };
  }
  const code =
    result.kind === "unsupported"
      ? codes.topologyStabilityUnsupported
      : result.code === "cubic-tube-clearance-unproven"
        ? codes.topologyClearanceUnproven
        : result.code === "cubic-tube-knot-incidence-unproven"
          ? codes.knotIncidenceUnproven
          : codes.topologyUncertain;
  const where =
    result.first === undefined
      ? ""
      : ` (${indices} ${result.first}${result.second === undefined ? "" : `/${result.second}`})`;
  return failure(
    code,
    `Tube stability is not certified${where}: ${result.kind} ${result.code}: ${result.message}`,
    seedEntityId,
  );
}

function certifyDeclaredTubeStability(
  resolved: OffsetChainTopologySuccess,
  certifier: CertifiedTubePieceChain,
  declared: DeclaredOffsetChainPieces,
): OffsetChainTubeStabilityResult {
  const { pieces, closed, modelingTolerance } = resolved.input;
  const { connectivity, sources } = declared;
  const count = pieces.length;
  const seedEntityId = pieces[0]?.seedEntityId ?? null;
  const mismatch = (message: string) =>
    failure(codes.topologyUncertain, message, seedEntityId);
  // Identity binding: the resolution is of exactly this adapter output.
  if (
    count === 0 ||
    count !== declared.pieces.length ||
    count !== sources.length ||
    count !== connectivity.pieces.length ||
    closed !== connectivity.closed ||
    !Object.is(modelingTolerance, declared.modelingTolerance) ||
    pieces.some(
      (piece, index) =>
        piece !== declared.pieces[index] ||
        piece.seedEntityId !== connectivity.pieces[index]!.seedEntityId ||
        piece.reversed !== connectivity.pieces[index]!.reversed,
    )
  )
    return mismatch(
      "The resolution was not resolved from this declared adapter output.",
    );
  // A single closed piece closes through its own bitwise owner knot.
  const wrap = closed && count > 1;
  if (
    resolved.joints.length !== connectivity.joins.length ||
    connectivity.joins.length !== (wrap ? count : count - 1)
  )
    return mismatch("The resolved joints are not the declared joins.");

  // Traversal-terminal canonical point of each piece (view, not coordinates).
  const terminalPoint = (index: number, exiting: boolean) => {
    const source = sources[index]!;
    const naturalEnd = exiting !== pieces[index]!.reversed;
    if (source.kind === "line")
      return naturalEnd ? source.endPointId : source.startPointId;
    return naturalEnd
      ? source.spans.at(-1)?.source.endPointId
      : source.spans[0]?.source.startPointId;
  };
  for (const [index, join] of connectivity.joins.entries()) {
    const next = (index + 1) % count;
    const joint = resolved.joints[index]!;
    const exiting = terminalPoint(index, true);
    const entering = terminalPoint(next, false);
    const declaredTerminal =
      join.kind === "sharedPoint"
        ? join.pointId === exiting && join.pointId === entering
        : join.pointIds[0] !== join.pointIds[1] &&
          ((join.pointIds[0] === exiting && join.pointIds[1] === entering) ||
            (join.pointIds[1] === exiting && join.pointIds[0] === entering));
    if (
      !declaredTerminal ||
      joint.firstSeedEntityId !== pieces[index]!.seedEntityId ||
      joint.secondSeedEntityId !== pieces[next]!.seedEntityId
    )
      return mismatch(
        `Declared join ${index} is not the shared traversal terminal of its pieces.`,
      );
  }

  // Domain ends bind resolver joint indices to the declared adjacencies.
  const expectedEnd = (index: number, exiting: boolean) => {
    if (exiting) return wrap || index < count - 1 ? index : null;
    return wrap || index > 0 ? (index - 1 + count) % count : null;
  };
  const isEnd = (end: OffsetChainDomainEnd, expected: number | null) =>
    expected === null
      ? end.kind === "source"
      : end.kind === "joint" && end.jointIndex === expected;
  const requestPieces: TubeChainPiece[] = [];
  for (const [index, piece] of pieces.entries()) {
    const source = sources[index]!;
    const [low, high] = piece.reversed
      ? [expectedEnd(index, true), expectedEnd(index, false)]
      : [expectedEnd(index, false), expectedEnd(index, true)];
    if (piece.kind === "lineSegment" && source.kind === "line") {
      const ends = resolved.lineArcEndpoints.get(piece.seedEntityId);
      if (
        !ends ||
        !isEnd(ends.startDomainEnd, low) ||
        !isEnd(ends.endDomainEnd, high)
      )
        return mismatch("The resolution does not describe its own line piece.");
      requestPieces.push({
        kind: "line",
        reversed: piece.reversed,
        // Raw resolver supports only; never lineArcEndpoints or witness.position.
        tube: {
          emitted: [piece.start, piece.end],
          source: source.source,
          distance: source.distance,
        },
      });
      continue;
    }
    if (piece.kind !== "derivedCubic" || source.kind !== "spline")
      return failure(
        codes.topologyStabilityUnsupported,
        "Tube stability supports declared line and spline pieces only.",
        piece.seedEntityId,
      );
    const spans = resolved.cubics.get(piece.seedEntityId);
    const last = piece.spans.length - 1;
    if (
      piece.spans !== source.spans ||
      spans?.length !== piece.spans.length ||
      spans.some(
        (item, offset) =>
          item.span !== piece.spans[offset] ||
          !isEnd(item.start, offset === 0 ? low : null) ||
          !isEnd(item.end, offset === last ? high : null),
      )
    )
      return mismatch("The resolution does not describe its own owner spans.");
    if (count > 1 && piece.spans.length === 1)
      return failure(
        codes.topologyStabilityUnsupported,
        "A one-leaf spline piece in a multi-piece chain has no certified emitted injectivity (K1) yet.",
        piece.seedEntityId,
      );
    requestPieces.push({
      kind: "cubic",
      reversed: piece.reversed,
      tubes: piece.spans.map((span) => ({
        poles: span.poles,
        certifiedError: span.certifiedError,
        reference: span.reference,
        source: span.source,
        sourceLocalInterval: span.sourceLocalInterval,
        // The stored query domain the witnesses are expressed in.
        queryDomain: span.sourceInterval,
      })),
    });
  }
  const result = certifier.certifyPieceChain({
    modelingTolerance,
    closed,
    distance: declared.distance,
    pieces: requestPieces,
    trims: resolved.joints.map((joint, jointIndex) => ({
      jointIndex,
      firstParameterBounds: joint.firstParameterBounds,
      secondParameterBounds: joint.secondParameterBounds,
    })),
  });
  return tubeStabilityResult(resolved, seedEntityId!, result, "leaves");
}

interface CurveFrame {
  readonly position: SketchPoint2D;
  readonly first: SketchPoint2D;
  readonly variation?: SketchPoint2D;
}

interface CurveJet extends CurveFrame {
  /** Position variation at the fixed source parameter. */
  readonly variation: SketchPoint2D;
}

/**
 * Segment parameter t ∈ [0, 1]: position start + t·(end − start). The binary64
 * `end − start` is the correctly rounded exact difference and serves only as a
 * representative derivative; joint authority stays with the exact query.
 */
function lineFrame(start: SketchPoint2D, end: SketchPoint2D) {
  return [end[0] - start[0], end[1] - start[1]] as const;
}

function curveFrame(
  piece: OffsetChainPiece,
  spanIndex: number,
  parameter: number,
): CurveFrame {
  if (piece.kind === "derivedCubic") {
    const span = piece.spans[spanIndex]!;
    const evaluated = evaluateSplineSpan(
      {
        interval: span.sourceInterval,
        poles: span.poles,
        differential: {
          interval: span.differential.sourceInterval,
          poles: span.differential.poles,
        },
      },
      { kind: "source", value: parameter },
    );
    return {
      position: evaluated.position,
      first: evaluated.first,
      variation: evaluated.differential.position,
    };
  }
  if (piece.kind === "lineSegment") {
    const derivative = lineFrame(piece.start, piece.end);
    return {
      position: [
        piece.start[0] + parameter * derivative[0],
        piece.start[1] + parameter * derivative[1],
      ],
      first: derivative,
    };
  }
  const cosine = Math.cos(parameter);
  const sine = Math.sin(parameter);
  return {
    position: [
      piece.center[0] + piece.radius * cosine,
      piece.center[1] + piece.radius * sine,
    ],
    first: [-piece.radius * sine, piece.radius * cosine],
  };
}

function jointTangentDeterminant(
  firstPiece: OffsetChainPiece,
  firstSpanIndex: number,
  firstParameter: number,
  secondPiece: OffsetChainPiece,
  secondSpanIndex: number,
  secondParameter: number,
) {
  const first = curveFrame(firstPiece, firstSpanIndex, firstParameter).first;
  const second = curveFrame(
    secondPiece,
    secondSpanIndex,
    secondParameter,
  ).first;
  const determinant = second[0] * first[1] - first[0] * second[1];
  return [determinant, ...first, ...second].every(Number.isFinite) &&
    determinant !== 0
    ? determinant
    : null;
}

function curveJet(
  piece: OffsetChainPiece,
  spanIndex: number,
  parameter: number,
  variation: OffsetChainPieceVariation | undefined,
): CurveJet {
  const frame = curveFrame(piece, spanIndex, parameter);
  if (piece.kind === "derivedCubic") {
    return { ...frame, variation: frame.variation! };
  }
  if (!variation || variation.kind !== piece.kind) {
    throw new RangeError(
      `Missing ${piece.kind} variation for offset chain piece ${piece.seedEntityId}`,
    );
  }
  if (piece.kind === "lineSegment" && variation.kind === "lineSegment") {
    // At fixed t the position varies by dStart + t·(dEnd − dStart).
    const derivative = lineFrame(variation.start, variation.end);
    return {
      ...frame,
      variation: [
        variation.start[0] + parameter * derivative[0],
        variation.start[1] + parameter * derivative[1],
      ],
    };
  }
  if (piece.kind !== "arc" || variation.kind !== "arc") {
    throw new RangeError("Offset chain variation kind mismatch");
  }
  const cosine = Math.cos(parameter);
  const sine = Math.sin(parameter);
  return {
    ...frame,
    variation: [
      variation.center[0] + variation.radius * cosine,
      variation.center[1] + variation.radius * sine,
    ],
  };
}

/**
 * Fixed-topology JVP of an accepted resolution. It reuses the accepted joints
 * (no requery) and solves the 2×2 implicit joint system at the representative
 * parameters; an exactly singular or non-finite solve fails closed.
 *
 * A finite nonzero joint determinant does not make arbitrary supplied
 * variations representable: their arithmetic can still overflow. Batch 2 must
 * not publish or consume a frame until every required JVP evaluation succeeds.
 */
export function resolveOffsetChainTopologyJvp(
  input: OffsetChainTopologyInput,
  resolved: OffsetChainTopologySuccess,
  variations: ReadonlyMap<SketchEntityId, OffsetChainPieceVariation>,
): OffsetChainTopologyJvp {
  if (resolved.input !== input) {
    throw new RangeError(
      "Offset chain JVP requires the resolution of this exact input",
    );
  }
  const pieceOf = new Map(
    input.pieces.map((piece) => [piece.seedEntityId, piece] as const),
  );
  const jointParameterDifferentials: (readonly [number, number])[] = [];
  const jointPositions: SketchPoint2D[] = [];
  for (const joint of resolved.joints) {
    const jet = (seed: SketchEntityId, curve: NeutralCurve, value: number) =>
      curveJet(
        pieceOf.get(seed)!,
        Number(curve.provenance.sourceSpanId),
        value,
        variations.get(seed),
      );
    const a = jet(
      joint.firstSeedEntityId,
      joint.request.first,
      joint.firstParameter,
    );
    const b = jet(
      joint.secondSeedEntityId,
      joint.request.second,
      joint.secondParameter,
    );
    const determinant = jointTangentDeterminant(
      pieceOf.get(joint.firstSeedEntityId)!,
      Number(joint.request.first.provenance.sourceSpanId),
      joint.firstParameter,
      pieceOf.get(joint.secondSeedEntityId)!,
      Number(joint.request.second.provenance.sourceSpanId),
      joint.secondParameter,
    );
    if (determinant === null) {
      return failure(
        codes.derivativeUnavailable,
        "The offset joint derivative is singular or non-finite.",
        joint.firstSeedEntityId,
      );
    }
    const rx = b.variation[0] - a.variation[0];
    const ry = b.variation[1] - a.variation[1];
    const ds = (b.first[0] * ry - b.first[1] * rx) / determinant;
    const dt = (a.first[0] * ry - a.first[1] * rx) / determinant;
    const position: SketchPoint2D = [
      a.variation[0] + a.first[0] * ds,
      a.variation[1] + a.first[1] * ds,
    ];
    if (![ds, dt, ...position].every(Number.isFinite)) {
      return failure(
        codes.derivativeUnavailable,
        "The offset joint derivative is singular or non-finite.",
        joint.firstSeedEntityId,
      );
    }
    jointParameterDifferentials.push([ds, dt]);
    jointPositions.push(position);
  }
  const jointDifferential = (
    end: OffsetChainDomainEnd,
    seed: SketchEntityId,
    spanIndex: number,
  ) => {
    if (end.kind === "source") return null;
    const joint = resolved.joints[end.jointIndex]!;
    const [ds, dt] = jointParameterDifferentials[end.jointIndex]!;
    return joint.firstSeedEntityId === seed &&
      Number(joint.request.first.provenance.sourceSpanId) === spanIndex
      ? ds
      : dt;
  };
  const representativeQueryDomains = new Map<
    SketchEntityId,
    (readonly [number, number])[]
  >();
  for (const [seed, spans] of resolved.cubics) {
    representativeQueryDomains.set(
      seed,
      spans.map(({ span, start, end }, spanIndex) => [
        jointDifferential(start, seed, spanIndex) ??
          span.differential.sourceInterval[0],
        jointDifferential(end, seed, spanIndex) ??
          span.differential.sourceInterval[1],
      ]),
    );
  }
  const lineArcEndpoints = new Map<
    SketchEntityId,
    { start: SketchPoint2D; end: SketchPoint2D }
  >();
  for (const [seed, endpoints] of resolved.lineArcEndpoints) {
    const variation = variations.get(seed);
    if (!variation) {
      throw new RangeError(`Missing variation for offset chain piece ${seed}`);
    }
    const endpoint = (end: OffsetChainDomainEnd, source: SketchPoint2D) =>
      end.kind === "joint" ? jointPositions[end.jointIndex]! : source;
    lineArcEndpoints.set(seed, {
      start: endpoint(endpoints.startDomainEnd, variation.start),
      end: endpoint(endpoints.endDomainEnd, variation.end),
    });
  }
  return {
    ok: true,
    representativeQueryDomains,
    jointPositions,
    lineArcEndpoints,
  };
}
