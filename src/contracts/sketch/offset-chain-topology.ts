import type {
  CertifiedNeutralCurveQuery,
  NeutralCurve,
  NeutralCurvePointWitness,
  NeutralCurveQueryRequest,
  NeutralCurveQueryResult,
} from "@/contracts/modeling/neutral-curve-query";
import type { SketchEntityId } from "@/contracts/shared/ids";
import {
  OFFSET_DIAGNOSTIC_CODES,
  type OffsetChainFailure,
} from "@/contracts/sketch/offset-geometry";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import { evaluateSplineSpan } from "@/contracts/sketch/spline-geometry";
import type { SplineOffsetCubicSpan } from "@/contracts/sketch/spline-offset-geometry";

/**
 * Certified topology of one offset chain's emitted approximant.
 *
 * Every joint and the global validity gate are decided only by the injected
 * certified neutral query on the unchanged raw supports (owner poles, raw
 * line/arc supports). The trim authority is the joint's request plus its
 * proof-bearing witness bounds; numeric parameters are representatives only.
 *
 * Not proved here (C6): stability of these decisions under the owner's
 * certificate tubes, i.e. topology of the true analytic offset. Fallback arcs
 * and tangent-continuous joints with a spline side are temporarily unsupported.
 */

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
  readonly query: CertifiedNeutralCurveQuery;
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
      const dx = piece.end[0] - piece.start[0];
      const dy = piece.end[1] - piece.start[1];
      const length = Math.hypot(dx, dy);
      push(
        0,
        {
          kind: "line",
          ...neutralBase(piece.seedEntityId, 0),
          origin: piece.start,
          direction: [dx / length, dy / length],
          sourceDomain: [0, length],
        },
        true,
        [0, length],
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

type Placement = "inside" | "outside" | "unresolved";

function placeOnCurve(
  curve: ChainCurve,
  enclosure: readonly [number, number] | null,
  joints: readonly JointRecord[],
  curveIndex: number,
): Placement {
  if (!enclosure) return "unresolved";
  let placement: Placement = "inside";
  for (const side of ["low", "high"] as const) {
    const end = curve[side];
    if (end.kind === "source") continue;
    const record = joints[end.jointIndex]!;
    const trim =
      record.firstCurve === curveIndex
        ? record.joint.firstParameterBounds
        : record.joint.secondParameterBounds;
    const kept =
      side === "low" ? enclosure[0] > trim[1] : enclosure[1] < trim[0];
    const removed =
      side === "low" ? enclosure[1] < trim[0] : enclosure[0] > trim[1];
    if (removed) return "outside";
    if (!kept) placement = "unresolved";
  }
  return placement;
}

function bboxesStrictlyDisjoint(first: NeutralCurve, second: NeutralCurve) {
  if (first.kind !== "cubicBezier" || second.kind !== "cubicBezier") {
    return false;
  }
  for (const axis of [0, 1] as const) {
    const a = first.poles.map((pole) => pole[axis]);
    const b = second.poles.map((pole) => pole[axis]);
    if (Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a)) {
      return true;
    }
  }
  return false;
}

function samePoint(first: SketchPoint2D, second: SketchPoint2D) {
  return Object.is(first[0], second[0]) && Object.is(first[1], second[1]);
}

/**
 * Resolves trim joints and certifies global validity of the emitted chain.
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
  const knots: (readonly [number, number])[] = [];
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
      knots.push([curve, curve + 1]);
    }
    if (
      singleClosedPiece &&
      last > first &&
      samePoint(piece.spans.at(-1)!.poles[3], piece.spans[0]!.poles[0])
    ) {
      knots.push([last, first]);
    }
  }

  const jointRecords: JointRecord[] = [];
  const jointCount = closed ? pieces.length : pieces.length - 1;
  const wrapIsKnot = singleClosedPiece && knots.some(([a, b]) => a > b);
  for (let index = 0; index < (wrapIsKnot ? 0 : jointCount); index += 1) {
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
    const result = query.queryPair(request);
    if (result.kind !== "verified") {
      return failure(
        codes.topologyUncertain,
        `Joint query is not verified (${describe(result)}).`,
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

  const jointPairs = new Set(
    jointRecords.map(
      ({ firstCurve, secondCurve }) =>
        `${Math.min(firstCurve, secondCurve)}:${Math.max(firstCurve, secondCurve)}`,
    ),
  );
  const classify = (
    witness: NeutralCurvePointWitness,
    firstCurve: number,
    secondCurve: number,
  ): OffsetChainFailure | null => {
    const first = placeOnCurve(
      curves[firstCurve]!,
      offsetChainRootEnclosure(witness, "first"),
      jointRecords,
      firstCurve,
    );
    const second = placeOnCurve(
      curves[secondCurve]!,
      offsetChainRootEnclosure(witness, "second"),
      jointRecords,
      secondCurve,
    );
    if (first === "outside" || second === "outside") return null;
    if (first === "unresolved" || second === "unresolved") {
      return failure(
        codes.topologyUncertain,
        "A contact cannot be proved inside or outside an offset trim.",
        seedOf(firstCurve),
      );
    }
    return witness.classification === "crossing"
      ? failure(
          codes.selfIntersection,
          "The offset chain intersects itself.",
          seedOf(firstCurve),
        )
      : failure(
          codes.topologyUncertain,
          `The offset chain has an unresolved ${witness.classification} contact.`,
          seedOf(firstCurve),
        );
  };

  for (let first = 0; first < curves.length; first += 1) {
    for (let second = first + 1; second < curves.length; second += 1) {
      if (jointPairs.has(`${first}:${second}`)) continue;
      const request = pair(first, second);
      if (bboxesStrictlyDisjoint(request.first, request.second)) continue;
      const result = query.queryPair(request);
      if (result.kind !== "verified" || result.overlaps.length !== 0) {
        return failure(
          codes.topologyUncertain,
          `Global offset validity is not certified (${describe(result)}).`,
          seedOf(first),
        );
      }
      // Exact knot parameters (owner endpoints at u = 1 and u = 0) in request order.
      const pairKnots = knots
        .filter(
          ([a, b]) =>
            (a === first && b === second) || (a === second && b === first),
        )
        .map(([left, right]) => {
          const leftParameter = curves[left]!.bounds[1];
          const rightParameter = curves[right]!.bounds[0];
          return left === first
            ? ([leftParameter, rightParameter] as const)
            : ([rightParameter, leftParameter] as const);
        });
      const incidences = pairKnots.map(() => 0);
      for (const witness of result.points) {
        const firstBounds = witness.proof.firstParameterBounds;
        const secondBounds = witness.proof.secondParameterBounds;
        const contained = pairKnots.flatMap(([firstKnot, secondKnot], index) =>
          firstBounds[0] <= firstKnot &&
          firstKnot <= firstBounds[1] &&
          secondBounds[0] <= secondKnot &&
          secondKnot <= secondBounds[1]
            ? [index]
            : [],
        );
        if (contained.length === 1) {
          incidences[contained[0]!]! += 1;
          continue;
        }
        if (contained.length > 1) {
          return failure(
            codes.topologyUncertain,
            "One certified root box contains two shared owner knots.",
            seedOf(first),
          );
        }
        const violation = classify(witness, first, second);
        if (violation) return violation;
      }
      if (incidences.some((count) => count !== 1)) {
        return failure(
          codes.topologyUncertain,
          "The shared owner knot is not isolated by exactly one certified root.",
          seedOf(first),
        );
      }
    }
    if (curves[first]!.neutral.kind !== "cubicBezier") continue;
    const self = query.querySelf({
      modelingTolerance,
      curve: curves[first]!.neutral,
    });
    if (self.kind !== "verified" || self.overlaps.length !== 0) {
      return failure(
        codes.topologyUncertain,
        `Offset cubic self validity is not certified (${describe(self)}).`,
        seedOf(first),
      );
    }
    for (const witness of self.points) {
      const violation = classify(witness, first, first);
      if (violation) return violation;
    }
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

interface CurveFrame {
  readonly position: SketchPoint2D;
  readonly first: SketchPoint2D;
  readonly variation?: SketchPoint2D;
}

interface CurveJet extends CurveFrame {
  /** Position variation at the fixed source parameter. */
  readonly variation: SketchPoint2D;
}

function lineFrame(start: SketchPoint2D, end: SketchPoint2D) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  return { length, direction: [dx / length, dy / length] as const };
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
    const { direction } = lineFrame(piece.start, piece.end);
    return {
      position: [
        piece.start[0] + direction[0] * parameter,
        piece.start[1] + direction[1] * parameter,
      ],
      first: direction,
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
    const { length, direction } = lineFrame(piece.start, piece.end);
    const dd = [
      variation.end[0] - variation.start[0],
      variation.end[1] - variation.start[1],
    ] as const;
    const along = direction[0] * dd[0] + direction[1] * dd[1];
    const dDirection = [
      (dd[0] - direction[0] * along) / length,
      (dd[1] - direction[1] * along) / length,
    ] as const;
    return {
      ...frame,
      variation: [
        variation.start[0] + dDirection[0] * parameter,
        variation.start[1] + dDirection[1] * parameter,
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
