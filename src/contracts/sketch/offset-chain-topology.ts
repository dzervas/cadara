import type {
  CertifiedCubicTubeChain,
  CertifiedTubePieceChain,
  CertifiedTubePieceChainRequests,
  CubicTubeChainResult,
  NeutralCurve,
  NeutralCurvePointWitness,
  NeutralCurveQueryRequest,
  NeutralCurveQueryResult,
  PieceTubeChainRequest,
  TubeChainArcDeclaration,
  TubeChainPiece,
  TubeChainTrimDeclaration,
  TubeChainVertexAuthority,
  TubeChainVertexDeclaration,
  TubePieceChainResult,
} from "@/contracts/modeling/neutral-curve-query";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  canonicalArcSupport,
  seedArcLeafSplits,
  type CanonicalArcSupport,
} from "@/contracts/sketch/canonical-arc-support";
import type { DeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import {
  OFFSET_DIAGNOSTIC_CODES,
  offsetLinePoints,
  scalePointFromCenter,
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
  type AdoptedEndpoint,
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
 * `topologyStabilityUnsupported`, never valid without a certificate. Without
 * declared vertices, fallback arcs and tangent-continuous joints with a
 * spline side are unsupported; with them (T08b-d/e) a convex declared vertex
 * is absorbed or joined by an F1 arc, never queried.
 *
 * T08b-f: point-defined seed arcs and circles are pieces. A seed arc's
 * emitted ends are the legacy ray-scaled S′, E′ (radius hypot(S′ − C)) and
 * it is queried one neutral circle per rule-B′ leaf (`seedArcLeafSplits`,
 * two leaves at least in a two-piece closed chain); a joint whose terminal
 * leaves do not cross queries the inner leaves in order (review R7, the
 * earlier leaves then being removed). A concave D > 0 vertex with a seed-arc
 * side proved within τ is absorbed first with no query ([TECH F6]); its
 * query is deferred to the SEL's fallback. Arcs adopt as the T2 rank rule
 * says (line < arc < spline) and are eligible swap adopters (review R6).
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
      /**
       * T08b-f: the seed arc's rule-B′ interior split directions
       * (`seedArcLeafSplits`), one query curve per leaf. Absent: one curve
       * for the whole arc (a raw arc piece without a declared seed).
       */
      readonly splits?: readonly SketchPoint2D[];
    }
  | {
      /** T08b-f [TECH F11]: a closed circle offset (8 fixed leaves, no joins). */
      readonly kind: "circle";
      readonly seedEntityId: SketchEntityId;
      /** Always false (a circle is traversed counter-clockwise). */
      readonly reversed: boolean;
      readonly center: SketchPoint2D;
      readonly radius: number;
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
  /**
   * Declared vertices (T08b-d), one per declared adjacency in order: built
   * only from the fresh adapter's source data (`declaredOffsetChainVertices`).
   * Absent: every adjacency is a joint query, as before. Present: each is
   * classified exactly first (parallel issues no query; T08b-e: nor does a
   * convex nonparallel one, [TECH E1]).
   */
  readonly vertices?: readonly OffsetChainVertex[];
  /**
   * The chain distance d (T08b-e). Required with `vertices` as soon as one is
   * nonparallel: its exact side sign(d)·(u₁ × u₂) decides whether it is
   * queried (concave) or absorbed / joined by an F1 arc (convex).
   */
  readonly distance?: number;
}

/** Declared authority of one adjacency: point IDs and the closure flag only. */
export type OffsetChainVertexAuthority =
  | { readonly kind: "sharedPoint"; readonly pointId: SketchPointId }
  | {
      readonly kind: "coincident";
      readonly pointIds: readonly [SketchPointId, SketchPointId];
    }
  | { readonly kind: "positionalClosure"; readonly pointId: SketchPointId };

/**
 * One traversal side of a declared vertex: its binary64 source vertex and its
 * exact traversal source tangent `tangent[1] − tangent[0]` (a difference of
 * binary64 points, never rounded).
 */
export interface OffsetChainVertexSide {
  readonly pointId: SketchPointId | undefined;
  readonly vertex: SketchPoint2D;
  readonly tangent: readonly [SketchPoint2D, SketchPoint2D];
}

/** A declared adjacency between traversal pieces `jointIndex` and the next. */
export interface OffsetChainVertex {
  readonly jointIndex: number;
  readonly authority: OffsetChainVertexAuthority;
  /** The traversal-exiting (first) and -entering (second) terminals. */
  readonly first: OffsetChainVertexSide;
  readonly second: OffsetChainVertexSide;
}

/**
 * Exact class of a declared vertex [TECH T4] on its traversal tangents u₁,
 * u₂ (X = u₁×u₂, D = u₁·u₂): parallel X = 0 ∧ D > 0; antiparallel X = 0 ∧
 * D < 0; nonparallel X ≠ 0 (absorbable only with D > 0); degenerate when a
 * tangent is exactly zero. The certifier re-derives it authoritatively.
 */
export type OffsetChainVertexClass =
  | "parallel"
  | "antiparallel"
  | "nonparallel"
  | "degenerate";

/** A declared vertex resolved without a trim (no witness, no root). */
export interface ResolvedOffsetVertex {
  readonly jointIndex: number;
  /** `parallel`: no query; `absorbed`: an absorption candidate (SEL). */
  readonly kind: "parallel" | "absorbed";
  readonly class: OffsetChainVertexClass;
  /** Whose emitted terminal pole is the shared pole (T2 rule). */
  readonly keeper: "first" | "second";
  /**
   * The resolver failure this vertex would have been before T08b-d (SEL step
   * 2(b), its query was verified but inadmissible), or the original trim
   * failure (SEL step 5 flip). Reported unchanged when absorption does not
   * certify (review R6).
   */
  readonly trigger?: {
    /**
     * `convex` (T08b-e): a convex vertex absorbed with no arc left to try,
     * reporting its failed arc (E2 fallback, E8 pre-test) or its missing
     * admissible arc (rule Z).
     */
    readonly step: "query" | "flip" | "convex";
    readonly failure: OffsetChainFailure;
  };
}

/**
 * An F1 arc at a convex declared vertex (T08b-e, U2): exactly what a
 * consumer publishes. Centre = the incoming terminal SOURCE vertex P_v
 * bitwise, start = the incoming piece's own emitted terminal pole A′, end =
 * the outgoing piece's own emitted terminal pole B′ (bitwise; no adoption at
 * an arc vertex), radius = `canonicalArcSupport` (hypot(A′ − V)), sweep =
 * the exact source turn. The tube certificate certifies this radius as
 * given; consumers must derive theirs with the same helper.
 */
export interface ResolvedOffsetArc extends CanonicalArcSupport {
  readonly jointIndex: number;
}

/** Where an active domain ends: the exact raw source end, a joint root, a declared vertex or an F1 arc. */
export type OffsetChainDomainEnd =
  | { readonly kind: "source" }
  | { readonly kind: "joint"; readonly jointIndex: number }
  | { readonly kind: "vertex"; readonly vertexIndex: number }
  | { readonly kind: "arc"; readonly jointIndex: number };

export interface ResolvedOffsetTrimJoint {
  /** The declared adjacency index (one index space with `vertices`, R5). */
  readonly jointIndex: number;
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
  /**
   * T08b-f review R7 (seed arcs only): leaves wholly removed at the natural
   * [start, end] because the joint root lies on a deeper leaf.
   */
  readonly removedLeaves?: readonly [number, number];
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
  /** Trims only, in adjacency order; each carries its adjacency index. */
  readonly joints: readonly ResolvedOffsetTrimJoint[];
  /** Declared vertices without a trim, in adjacency order (empty without `vertices`). */
  readonly vertices: readonly ResolvedOffsetVertex[];
  /** F1 arcs at convex declared vertices, in adjacency order (T08b-e). */
  readonly arcs: readonly ResolvedOffsetArc[];
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
      /**
       * Point variations of each F1 arc (T08b-e): the centre's declared
       * source point and both neighbours' OWN terminal pole variations (no
       * adoption at an arc vertex). The radius and angle variations are the
       * point-defined arc's (`derived-geometry.ts`), never recomputed here.
       */
      readonly arcs: readonly {
        readonly jointIndex: number;
        readonly center: SketchPoint2D;
        readonly start: SketchPoint2D;
        readonly end: SketchPoint2D;
      }[];
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

/** The eight fixed circle leaf directions (T08b-f [TECH F11]). */
const CIRCLE_LEAF_DIRECTIONS: readonly SketchPoint2D[] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

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
      // One neutral circle per leaf (T08b-f [TECH F2]: whole arcs would give
      // a lens two crossings), its domain the binary64 atan2 of the leaf's
      // boundary directions; natural leaf order from the start.
      const ccw =
        piece.kind === "circle" || piece.sweepDirection === "counterClockwise";
      const relative = (point: SketchPoint2D): SketchPoint2D => [
        point[0] - piece.center[0],
        point[1] - piece.center[1],
      ];
      const boundaries: readonly SketchPoint2D[] =
        piece.kind === "circle"
          ? [...CIRCLE_LEAF_DIRECTIONS, CIRCLE_LEAF_DIRECTIONS[0]!]
          : [
              relative(piece.start),
              ...(piece.splits ?? []),
              relative(piece.end),
            ];
      const angle = (vector: SketchPoint2D) => Math.atan2(vector[1], vector[0]);
      for (let leaf = 0; leaf + 1 < boundaries.length; leaf += 1) {
        const low = angle(boundaries[ccw ? leaf : leaf + 1]!);
        let high = angle(boundaries[ccw ? leaf + 1 : leaf]!);
        while (high <= low) high += 2 * Math.PI;
        push(
          leaf,
          {
            kind: "circle",
            ...neutralBase(piece.seedEntityId, leaf),
            center: piece.center,
            radius: piece.radius,
            xAxis: [1, 0],
            sourceDomain: { kind: "arc", interval: [low, high] },
          },
          ccw,
          [low, high],
        );
      }
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

/** Exact binary64 → BigInt scaled by 2^1074 (every finite binary64 is an integer there). */
function scaledExact(value: number) {
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0);
  const exponent = Number((raw >> 52n) & 0x7ffn);
  const fraction = raw & ((1n << 52n) - 1n);
  const significand = exponent === 0 ? fraction : fraction | (1n << 52n);
  const magnitude = significand << BigInt(Math.max(exponent, 1) - 1);
  return raw >> 63n ? -magnitude : magnitude;
}

const exactSign = (value: bigint) => (value > 0n ? 1 : value < 0n ? -1 : 0);

/**
 * Exact class of a declared vertex [TECH T4]: bounded 2×53-bit BigInt
 * products on the binary64 tangent endpoints (O(1), unmetered; contracts may
 * not import the domain meter). The certifier re-derives it authoritatively.
 */
export function classifyOffsetChainVertex(vertex: OffsetChainVertex): {
  readonly class: OffsetChainVertexClass;
  /** D = u₁·u₂ > 0 exactly. */
  readonly forward: boolean;
} {
  const [u, v] = exactTangents(vertex);
  const zero = (w: readonly [bigint, bigint]) => w[0] === 0n && w[1] === 0n;
  if (zero(u) || zero(v)) return { class: "degenerate", forward: false };
  const cross = exactSign(u[0] * v[1] - u[1] * v[0]);
  const forward = exactSign(u[0] * v[0] + u[1] * v[1]) > 0;
  return {
    class: cross !== 0 ? "nonparallel" : forward ? "parallel" : "antiparallel",
    forward,
  };
}

/** The exact traversal tangents u₁, u₂ scaled by 2^1074 (BigInt). */
function exactTangents(vertex: OffsetChainVertex) {
  const tangent = (side: OffsetChainVertexSide) =>
    [0, 1].map(
      (axis) =>
        scaledExact(side.tangent[1][axis]!) -
        scaledExact(side.tangent[0][axis]!),
    ) as [bigint, bigint];
  return [tangent(vertex.first), tangent(vertex.second)] as const;
}

/** σ = sign(u₁ × u₂), exact. */
function sourceTurn(vertex: OffsetChainVertex) {
  const [u, v] = exactTangents(vertex);
  return exactSign(u[0] * v[1] - u[1] * v[0]);
}

/** ⌈√n⌉ of a nonnegative integer (exact Newton iteration from above). */
function ceilingSquareRoot(value: bigint) {
  if (value < 2n) return value;
  let root = 1n << BigInt((value.toString(2).length + 1) >> 1);
  for (;;) {
    const next = (root + value / root) >> 1n;
    if (next >= root) break;
    root = next;
  }
  return root * root === value ? root : root + 1n;
}

/** The exact T08b-e plan of one convex nonparallel declared vertex. */
interface ConvexVertexPlan {
  /** D = u₁·u₂ > 0: absorbable (U1), so an arc may fall back to absorption. */
  readonly forward: boolean;
  /** Rule Z (T6): A′ = B′ bitwise or σ·(a × b) ≤ 0, so no arc is admissible. */
  readonly zero: boolean;
  /** U-E: G⁺ = δ⁺ + |g|⁺ < τ, the corner is proved to fit within τ. */
  readonly fits: boolean;
}

/**
 * Exact plan of a declared vertex whose side sign(d)·(u₁ × u₂) is convex
 * (< 0); null for every other vertex (parallel, antiparallel, degenerate,
 * concave, or d = 0: no side). Bounded BigInt arithmetic on binary64 inputs
 * (unmetered, the T4 pattern): A′ and B′ are the two pieces' own emitted
 * terminal poles, V = P_v. `fits` is user decision U-E's absorption
 * precondition, Lemma G's G = δ + |g| (δ = |d|·|N₁ − N₂|, g = Q_v − P_v)
 * PROVED below τ with exact integer-square-root upper bounds: G⁺ < τ is
 * necessary for the keeper's strict composition, and the certifier re-proves
 * it with its own bounds either way. No new tolerance.
 */
function convexVertexPlan(
  pieces: readonly OffsetChainPiece[],
  vertex: OffsetChainVertex,
  distance: number,
  modelingTolerance: number,
): ConvexVertexPlan | null {
  const [u, v] = exactTangents(vertex);
  const cross = exactSign(u[0] * v[1] - u[1] * v[0]);
  const side = Math.sign(distance) * cross;
  if (cross === 0 || !(side < 0)) return null;
  const product = u[0] * v[0] + u[1] * v[1];
  const forward = product > 0n;
  const count = pieces.length;
  const start = emittedTerminal(pieceTerminal(pieces, vertex.jointIndex, true));
  const end = emittedTerminal(
    pieceTerminal(pieces, (vertex.jointIndex + 1) % count, false),
  );
  const scaled = (point: SketchPoint2D) =>
    [scaledExact(point[0]), scaledExact(point[1])] as const;
  const center = scaled(vertex.first.vertex);
  let zero = !start || !end || samePoint(start.position, end.position);
  if (!zero) {
    const a = scaled(start!.position).map(
      (value, axis) => value - center[axis]!,
    );
    const b = scaled(end!.position).map((value, axis) => value - center[axis]!);
    zero = cross * exactSign(a[0]! * b[1]! - a[1]! * b[0]!) <= 0;
  }
  if (!forward) return { forward, zero, fits: false };
  return {
    forward,
    zero,
    fits: vertexFits(vertex, distance, modelingTolerance),
  };
}

/**
 * U-E's `fits` of a declared vertex with D > 0: Lemma G's G = δ + |g| (δ =
 * |d|·|N₁ − N₂|, g = Q_v − P_v) PROVED below τ with exact integer-square-
 * root upper bounds (bounded BigInt, unmetered). Shared by the convex plan
 * and the T08b-f [TECH F6] concave arc-side plan.
 */
function vertexFits(
  vertex: OffsetChainVertex,
  distance: number,
  modelingTolerance: number,
) {
  const [u, v] = exactTangents(vertex);
  const product = u[0] * v[0] + u[1] * v[1];
  const scaled = (point: SketchPoint2D) =>
    [scaledExact(point[0]), scaledExact(point[1])] as const;
  const center = scaled(vertex.first.vertex);
  // Values scaled by S = 2^1074: δ² = 2d²(1 − D/W), W = |u₁||u₂| ≤ R =
  // ⌈√(U₁U₂)⌉, so δ ≤ ⌈√(N·R)⌉/(S·R) with N = 2d²(R − D); |g| ≤ ⌈√(g·g)⌉/S.
  const root = ceilingSquareRoot(
    (u[0] * u[0] + u[1] * u[1]) * (v[0] * v[0] + v[1] * v[1]),
  );
  const d = scaledExact(distance);
  const normals = ceilingSquareRoot(2n * d * d * (root - product) * root);
  const gap = scaled(vertex.second.vertex).map(
    (value, axis) => value - center[axis]!,
  );
  const bridge = ceilingSquareRoot(gap[0]! * gap[0]! + gap[1]! * gap[1]!);
  return normals + root * bridge < root * scaledExact(modelingTolerance);
}

/**
 * T08b-f [TECH F6]: per declared adjacency, true for a concave nonparallel
 * vertex (exact side sign(d)·X > 0) with D > 0, a seed-arc side and U-E's
 * `fits` (absorbed first with no query), false when it does not fit, null
 * for every other vertex. Rows without an arc side are untouched.
 */
function concaveArcPlans(
  input: OffsetChainTopologyInput,
): readonly (boolean | null)[] {
  const { vertices, pieces, distance, modelingTolerance } = input;
  if (!vertices || distance === undefined) return [];
  return vertices.map((vertex) => {
    const next = (vertex.jointIndex + 1) % pieces.length;
    if (
      pieces[vertex.jointIndex]!.kind !== "arc" &&
      pieces[next]!.kind !== "arc"
    )
      return null;
    const classified = classifyOffsetChainVertex(vertex);
    if (classified.class !== "nonparallel" || !classified.forward) return null;
    if (!(Math.sign(distance) * sourceTurn(vertex) > 0)) return null;
    return vertexFits(vertex, distance, modelingTolerance);
  });
}

/** The convex plan of every declared adjacency (null where not convex). */
function convexVertexPlans(
  input: OffsetChainTopologyInput,
): readonly (ConvexVertexPlan | null)[] {
  const { vertices, pieces, distance, modelingTolerance } = input;
  if (!vertices) return [];
  return vertices.map((vertex) => {
    if (classifyOffsetChainVertex(vertex).class !== "nonparallel") return null;
    if (distance === undefined)
      throw new RangeError(
        "A nonparallel declared offset vertex needs the chain distance",
      );
    return convexVertexPlan(pieces, vertex, distance, modelingTolerance);
  });
}

/** Rule-Z / D ≤ 0 diagnostic of a convex vertex with no admissible arc. */
function noArcFailure(seedEntityId: SketchEntityId) {
  return failure(
    codes.splineJointUnsupported,
    "The convex declared vertex has no admissible arc (zero length, zero sweep or reversed ends).",
    seedEntityId,
  );
}

/** One adjacency's resolver decision (review R5: the adjacency index space). */
type AdjacencyDecision =
  | {
      readonly kind: "trim";
      readonly jointIndex: number;
      readonly request: NeutralCurveQueryRequest;
      readonly witness: NeutralCurvePointWitness;
      readonly firstParameterBounds: readonly [number, number];
      readonly secondParameterBounds: readonly [number, number];
      /** Nonparallel with D > 0: may flip to absorption (SEL step 5). */
      readonly flippable: boolean;
      /**
       * T08b-f review R7: the queried inner seed-arc leaf curves when the
       * joint root lies beyond a terminal leaf (absent: the terminals).
       */
      readonly firstCurve?: number;
      readonly secondCurve?: number;
    }
  | { readonly kind: "vertex"; readonly vertex: ResolvedOffsetVertex }
  /** An F1 arc at a convex declared vertex (T08b-e); never queried. */
  | { readonly kind: "arc"; readonly jointIndex: number };

const decisionIndex = (decision: AdjacencyDecision) =>
  decision.kind === "trim" || decision.kind === "arc"
    ? decision.jointIndex
    : decision.vertex.jointIndex;

/**
 * The initial decision of a convex declared vertex (T08b-e SEL step 3, user
 * decision U-E): D > 0 and the corner proved within τ (or no admissible arc)
 * ⇒ an absorption candidate; otherwise an F1 arc; D ≤ 0 without an
 * admissible arc fails closed. `absorptionFirst` is false only on the
 * test-only policy seam.
 */
function convexDecision(
  plan: ConvexVertexPlan,
  jointIndex: number,
  keeper: "first" | "second",
  seedEntityId: SketchEntityId,
  absorptionFirst: boolean,
): AdjacencyDecision | OffsetChainFailure {
  if (plan.forward && (plan.zero || (absorptionFirst && plan.fits)))
    return {
      kind: "vertex",
      vertex: {
        jointIndex,
        kind: "absorbed",
        class: "nonparallel",
        keeper,
        ...(plan.zero
          ? {
              trigger: {
                step: "convex" as const,
                failure: noArcFailure(seedEntityId),
              },
            }
          : {}),
      },
    };
  if (plan.zero) return noArcFailure(seedEntityId);
  return { kind: "arc", jointIndex };
}

/** The T2 structural keeper of a declared vertex (never geometry). */
function ruleKeeper(
  pieces: readonly OffsetChainPiece[],
  closed: boolean,
  jointIndex: number,
): "first" | "second" {
  const first = pieces[jointIndex]!;
  const second = pieces[(jointIndex + 1) % pieces.length]!;
  // Positional closure: the last leaf adopts the first pass's first leaf.
  if (pieces.length === 1) return "second";
  // Line–spline: the line adopts; T08b-f [TECH F4]: line–arc the line,
  // arc–spline the arc (rank line < arc < spline; the lower rank adopts).
  const rank = (piece: OffsetChainPiece) =>
    piece.kind === "lineSegment" ? 0 : piece.kind === "arc" ? 1 : 2;
  if (rank(first) !== rank(second))
    return rank(first) < rank(second) ? "second" : "first";
  // Spline–spline / line–line: the traversal-outgoing piece adopts, except at
  // the closing vertex of a closed chain, where the incoming piece does.
  return closed && jointIndex === pieces.length - 1 ? "second" : "first";
}

/**
 * Resolves the trim joints of the emitted chain: joint queries only, on one
 * whole-request meter opened for exactly the query count. It proves each
 * joint's single transverse interior crossing and the order of two trims on
 * one curve; it does NOT prove global validity (see the module note).
 * With declared `vertices` (T08b-d SEL steps 1–2), each adjacency is first
 * classified exactly: parallel issues no query; antiparallel fails closed; a
 * nonparallel vertex with D > 0 whose query is verified but inadmissible is
 * an absorption candidate (certified later, never here); an unverified query
 * always fails closed. T08b-e: a convex nonparallel vertex (exact side
 * sign(d)·X < 0, `distance` required) issues no query [TECH E1]; it is an
 * absorption candidate when D > 0 and its corner is proved within τ (U-E) or
 * it has no admissible arc (rule Z), else an F1 arc (`arcs`, the canonical
 * support of the input pieces). Ordinary exceptions from the query propagate
 * unchanged.
 */
export function resolveOffsetChainTopology(
  input: OffsetChainTopologyInput,
): OffsetChainTopologyResult {
  const decided = decideOffsetChainAdjacencies(input);
  return decided.ok
    ? assembleOffsetChainResolution(input, decided.decisions)
    : decided;
}

type AdjacencyDecisions =
  | {
      readonly ok: true;
      readonly decisions: readonly AdjacencyDecision[];
      /**
       * T08b-f [TECH F6]: the deferred joint query of a concave arc-side
       * vertex absorbed first (the SEL's fallback), on the same meter.
       */
      readonly requery?: (
        index: number,
      ) => AdjacencyDecision | OffsetChainFailure | QueryBudgetExhausted;
    }
  | OffsetChainFailure;

/** A joint-query budget exhaustion: always reported as itself (never an R6 trigger). */
interface QueryBudgetExhausted {
  readonly ok: false;
  readonly exhausted: OffsetChainFailure;
}

/**
 * The first step-2(b) absorption candidate's pre-T08b-d failure, if any: the
 * legacy resolver failed at the first inadmissible joint in adjacency order,
 * so a failure found later (at a later joint, the trim order check or the
 * certificate) keeps that verdict, with the later reason appended (R6). A
 * joint-query budget exhaustion never reaches here: it is reported as itself.
 */
function firstTrigger(
  decisions: readonly AdjacencyDecision[],
  reason: string,
): OffsetChainFailure | null {
  for (const decision of decisions)
    if (decision.kind === "vertex" && decision.vertex.trigger?.step === "query")
      return {
        ...decision.vertex.trigger.failure,
        message: `${decision.vertex.trigger.failure.message} Absorption not certified: ${reason}`,
      };
  return null;
}

function decideOffsetChainAdjacencies(
  input: OffsetChainTopologyInput,
  absorptionFirst = true,
): AdjacencyDecisions {
  const decisions: AdjacencyDecision[] = [];
  const decided = decideAdjacencies(input, decisions, absorptionFirst);
  if (decided.ok) return decided;
  if ("exhausted" in decided) return decided.exhausted;
  return (
    firstTrigger(decisions, `a later adjacency fails: ${decided.message}`) ??
    decided
  );
}

function decideAdjacencies(
  input: OffsetChainTopologyInput,
  decisions: AdjacencyDecision[],
  absorptionFirst: boolean,
): AdjacencyDecisions | QueryBudgetExhausted {
  const { pieces, closed, modelingTolerance, query, vertices } = input;
  if (pieces.length === 0) {
    throw new RangeError("An offset chain needs at least one piece");
  }
  const { curves, pieceCurves } = buildCurves(pieces);
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

  // Declared vertices replace the bitwise wrap heuristic (a smooth wrap is an
  // owner knot, not a declared vertex); every adjacency is covered in order.
  const adjacencyCount = vertices
    ? vertices.length
    : wrapIsKnot
      ? 0
      : closed
        ? pieces.length
        : pieces.length - 1;
  if (
    vertices &&
    (vertices.length > (closed ? pieces.length : pieces.length - 1) ||
      (pieces.length > 1 &&
        vertices.length !== (closed ? pieces.length : pieces.length - 1)) ||
      vertices.some((vertex, index) => vertex.jointIndex !== index))
  ) {
    throw new RangeError(
      "Declared offset vertices must cover every adjacency in order",
    );
  }
  const classes = vertices?.map(classifyOffsetChainVertex);
  const antiparallel = classes?.findIndex(
    (item) => item.class === "antiparallel",
  );
  if (antiparallel !== undefined && antiparallel >= 0)
    return failure(
      codes.knotIncidenceUnproven,
      "A declared vertex has exactly antiparallel traversal source tangents (a cusp): it is not absorbable.",
      pieces[antiparallel]!.seedEntityId,
    );
  // [TECH E1]: a convex nonparallel vertex issues no query.
  const plans = convexVertexPlans(input);
  // T08b-f [TECH F6]: a concave D > 0 vertex with a seed-arc side proved
  // within τ is absorbed first; its query is deferred to the SEL fallback.
  const concave = absorptionFirst ? concaveArcPlans(input) : [];
  const deferred = (index: number) => concave[index] === true;
  const queried = (index: number) =>
    classes?.[index]?.class !== "parallel" && !plans[index] && !deferred(index);
  // T08b-f review R7: a joint with a seed-arc side may query inner leaves.
  const innerLeaves = (pieceIndex: number) => {
    const [first, last] = pieceCurves[pieceIndex]!;
    return pieces[pieceIndex]!.kind === "arc" ? last - first : 0;
  };
  const queryCount = (index: number) =>
    1 + innerLeaves(index) + innerLeaves((index + 1) % pieces.length);
  let jointCount = 0;
  for (let index = 0; index < adjacencyCount; index += 1)
    if (queried(index) || deferred(index)) jointCount += queryCount(index);
  // M7: one precharged whole-request meter for exactly these joint queries.
  const jointRequest = query.openRequest(jointCount);
  /**
   * The joint query of one adjacency (SEL steps 1–2): a trim decision, a
   * step-2(b) absorption candidate or a failure. With a seed-arc side whose
   * terminal-leaf query is empty, the inner leaves are queried in order from
   * the vertex (review R7), so the trim may name an inner leaf.
   */
  const queryAdjacency = (
    index: number,
  ): AdjacencyDecision | OffsetChainFailure | QueryBudgetExhausted => {
    const next = (index + 1) % pieces.length;
    const firstSeed = pieces[index]!.seedEntityId;
    const keeper = ruleKeeper(pieces, closed, index);
    const vertexClass = classes?.[index];
    const absorbable =
      vertexClass?.class === "nonparallel" && vertexClass.forward;
    /** SEL step 2(b): a verified but inadmissible query, D > 0 only. */
    const inadmissible = (inadmissibleFailure: OffsetChainFailure) =>
      absorbable
        ? ({
            kind: "vertex",
            vertex: {
              jointIndex: index,
              kind: "absorbed",
              class: "nonparallel",
              keeper,
              trigger: { step: "query", failure: inadmissibleFailure },
            },
          } as const)
        : inadmissibleFailure;
    const end = terminal(pieces, pieceCurves, curves, index, "traversalEnd");
    const start = terminal(pieces, pieceCurves, curves, next, "traversalStart");
    if (end.curve === start.curve) {
      return failure(
        codes.splineJointUnsupported,
        "A closed single-curve offset whose only curve joins itself is not supported yet.",
        firstSeed,
      );
    }
    const issue = (endCurve: number, startCurve: number) => {
      const request = pair(endCurve, startCurve);
      return { request, result: jointRequest.queryPair(request) };
    };
    let endCurve = end.curve;
    let startCurve = start.curve;
    let { request, result } = issue(endCurve, startCurve);
    // Review R7 (T08b-f): inner seed-arc leaves, from the vertex inward.
    const inward = (terminalCurve: number, pieceIndex: number) => {
      if (pieces[pieceIndex]!.kind !== "arc") return [];
      const [first, last] = pieceCurves[pieceIndex]!;
      const step = terminalCurve === first ? 1 : -1;
      const inner: number[] = [];
      for (
        let curve = terminalCurve + step;
        curve >= first && curve <= last;
        curve += step
      )
        inner.push(curve);
      return inner;
    };
    const scans = [
      ...inward(end.curve, index).map((curve) => [curve, start.curve] as const),
      ...inward(start.curve, next).map((curve) => [end.curve, curve] as const),
    ];
    for (const [deepEnd, deepStart] of scans) {
      if (
        result.kind !== "verified" ||
        result.points.length !== 0 ||
        result.overlaps.length !== 0
      )
        break;
      endCurve = deepEnd;
      startCurve = deepStart;
      ({ request, result } = issue(endCurve, startCurve));
    }
    if (result.kind !== "verified") {
      if (result.code === "exact-query-proof-budget-exhausted")
        return {
          ok: false,
          exhausted: failure(
            codes.topologyUncertain,
            `Joint query is not verified (${describe(result)}): the whole-request budget of all ${jointCount} joint queries is exhausted, not necessarily by this joint.`,
            firstSeed,
          ),
        };
      return failure(
        codes.topologyUncertain,
        `Joint query is not verified (${describe(result)}).`,
        firstSeed,
      );
    }
    if (result.points.length === 0 && result.overlaps.length === 0) {
      return inadmissible(
        failure(
          codes.splineJointUnsupported,
          scans.length > 0
            ? "Offset joint has no crossing on any seed-arc leaf of the joint (the offset curves do not meet there; the offset may be empty or the arc collapses)."
            : "Offset joint needs a fallback arc or tangent-continuous join, which is not supported yet for spline chains.",
          firstSeed,
        ),
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
      !strictlyInside(firstBounds, curves[endCurve]!.bounds) ||
      !strictlyInside(secondBounds, curves[startCurve]!.bounds) ||
      !transverseCrossing(witness)
    ) {
      return inadmissible(
        failure(
          codes.jointUnsatisfied,
          "Offset joint has no single certified transverse interior crossing.",
          firstSeed,
        ),
      );
    }
    if (
      jointTangentDeterminant(
        pieces[curves[endCurve]!.pieceIndex]!,
        curves[endCurve]!.spanIndex,
        witness.firstParameter,
        pieces[curves[startCurve]!.pieceIndex]!,
        curves[startCurve]!.spanIndex,
        witness.secondParameter,
      ) === null
    ) {
      return failure(
        codes.derivativeUnavailable,
        "The offset joint derivative is singular or non-finite.",
        firstSeed,
      );
    }
    return {
      kind: "trim",
      jointIndex: index,
      request,
      witness,
      firstParameterBounds: firstBounds,
      secondParameterBounds: secondBounds,
      flippable: absorbable,
      ...(endCurve !== end.curve ? { firstCurve: endCurve } : {}),
      ...(startCurve !== start.curve ? { secondCurve: startCurve } : {}),
    };
  };
  for (let index = 0; index < adjacencyCount; index += 1) {
    const firstSeed = pieces[index]!.seedEntityId;
    const keeper = ruleKeeper(pieces, closed, index);
    const plan = plans[index];
    if (plan) {
      const decision = convexDecision(
        plan,
        index,
        keeper,
        firstSeed,
        absorptionFirst,
      );
      if ("ok" in decision) return decision;
      decisions.push(decision);
      continue;
    }
    if (deferred(index)) {
      decisions.push({
        kind: "vertex",
        vertex: {
          jointIndex: index,
          kind: "absorbed",
          class: "nonparallel",
          keeper,
        },
      });
      continue;
    }
    if (!queried(index)) {
      decisions.push({
        kind: "vertex",
        vertex: {
          jointIndex: index,
          kind: "parallel",
          class: "parallel",
          keeper,
        },
      });
      continue;
    }
    const decision = queryAdjacency(index);
    if ("ok" in decision) return decision;
    decisions.push(decision);
  }
  return { ok: true, decisions, requery: queryAdjacency };
}

/** Bitwise neutral-curve geometry equality, ignoring only curve labels. */
function sameCurveGeometry(first: NeutralCurve, second: NeutralCurve) {
  const encode = (curve: NeutralCurve) =>
    JSON.stringify(
      { ...curve, curveId: undefined, provenance: undefined },
      (_key, value: unknown) => {
        if (typeof value !== "number") return value;
        bits.setFloat64(0, value);
        return `f64:${bits.getBigUint64(0).toString(16)}`;
      },
    );
  return encode(first) === encode(second);
}

/**
 * Builds the resolution of `input` from per-adjacency decisions without any
 * query (SEL flips and adoption never re-query). A trim's request is the
 * queried one; after an adoption the recomputed request must have bitwise
 * the same geometry (only its leaf labels may move), else it fails closed.
 */
function assembleOffsetChainResolution(
  input: OffsetChainTopologyInput,
  decisions: readonly AdjacencyDecision[],
): OffsetChainTopologyResult {
  const { pieces, modelingTolerance } = input;
  const { curves, pieceCurves } = buildCurves(pieces);
  const seedOf = (curve: number) =>
    pieces[curves[curve]!.pieceIndex]!.seedEntityId;
  const jointRecords = new Map<number, JointRecord>();
  const vertices: ResolvedOffsetVertex[] = [];
  const arcs: ResolvedOffsetArc[] = [];
  const removedLeaves = new Map<number, readonly [number, number]>();
  for (const decision of decisions) {
    const index = decisionIndex(decision);
    const next = (index + 1) % pieces.length;
    const end = terminal(pieces, pieceCurves, curves, index, "traversalEnd");
    const start = terminal(pieces, pieceCurves, curves, next, "traversalStart");
    if (decision.kind === "arc") {
      // The published arc [TECH E7]: centre P_v, the neighbours' own emitted
      // terminal poles (after any adoption elsewhere), the canonical radius.
      const vertex = input.vertices![index]!;
      const from = emittedTerminal(pieceTerminal(pieces, index, true));
      const to = emittedTerminal(pieceTerminal(pieces, next, false));
      if (!from || !to)
        return failure(
          codes.topologyStabilityUnsupported,
          "An F1 arc joins declared line and spline pieces only.",
          pieces[index]!.seedEntityId,
        );
      arcs.push({
        jointIndex: index,
        ...canonicalArcSupport(
          vertex.first.vertex,
          from.position,
          to.position,
          sourceTurn(vertex) > 0 ? "counterClockwise" : "clockwise",
        ),
      });
      const arcEnd = { kind: "arc", jointIndex: index } as const;
      curves[end.curve]![end.side] = arcEnd;
      curves[start.curve]![start.side] = arcEnd;
      continue;
    }
    if (decision.kind === "vertex") {
      vertices.push(decision.vertex);
      const vertexEnd = { kind: "vertex", vertexIndex: index } as const;
      curves[end.curve]![end.side] = vertexEnd;
      curves[start.curve]![start.side] = vertexEnd;
      continue;
    }
    // T08b-f review R7: a deep arc-leaf trim names its own (inner) leaves;
    // the leaves before them on that piece are wholly removed.
    const endCurve = decision.firstCurve ?? end.curve;
    const startCurve = decision.secondCurve ?? start.curve;
    if (endCurve !== end.curve) {
      const removed = removedLeaves.get(index) ?? [0, 0];
      const count = Math.abs(endCurve - end.curve);
      removedLeaves.set(
        index,
        pieces[index]!.reversed ? [count, removed[1]] : [removed[0], count],
      );
    }
    if (startCurve !== start.curve) {
      const removed = removedLeaves.get(next) ?? [0, 0];
      const count = Math.abs(startCurve - start.curve);
      removedLeaves.set(
        next,
        pieces[next]!.reversed ? [removed[0], count] : [count, removed[1]],
      );
    }
    let request = decision.request;
    const current: NeutralCurveQueryRequest = {
      modelingTolerance,
      first: curves[endCurve]!.neutral,
      second: curves[startCurve]!.neutral,
    };
    if (current.first !== request.first || current.second !== request.second) {
      if (
        !sameCurveGeometry(current.first, request.first) ||
        !sameCurveGeometry(current.second, request.second)
      )
        return failure(
          codes.topologyUncertain,
          "An adopted declared vertex changed the queried geometry of a trim at the adopter's other end.",
          pieces[index]!.seedEntityId,
        );
      // Same geometry bitwise; only the leaf labels moved with the adoption.
      request = current;
    }
    const { witness } = decision;
    jointRecords.set(index, {
      firstCurve: endCurve,
      secondCurve: startCurve,
      joint: {
        jointIndex: index,
        firstSeedEntityId: pieces[index]!.seedEntityId,
        secondSeedEntityId: pieces[next]!.seedEntityId,
        request,
        witness,
        firstParameterBounds: decision.firstParameterBounds,
        secondParameterBounds: decision.secondParameterBounds,
        firstParameter: witness.firstParameter,
        secondParameter: witness.secondParameter,
        position: witness.position,
      },
    });
    const jointEnd = { kind: "joint", jointIndex: index } as const;
    curves[endCurve]![end.side] = jointEnd;
    curves[startCurve]![start.side] = jointEnd;
  }

  // Two trims on one curve must be ordered by disjoint root enclosures.
  for (const [curveIndex, curve] of curves.entries()) {
    if (curve.low.kind !== "joint" || curve.high.kind !== "joint") continue;
    const bounds = (jointIndex: number) => {
      const record = jointRecords.get(jointIndex)!;
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

  const joints = [...jointRecords.values()].map(({ joint }) => joint);
  const jointParameter = (end: OffsetChainDomainEnd, curveIndex: number) => {
    if (end.kind !== "joint") return null;
    const record = jointRecords.get(end.jointIndex)!;
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
    if (piece.kind === "circle") continue;
    // A seed arc's natural ends are its first and last retained leaves
    // (T08b-f); a line has one curve.
    const [head, tail] = removedLeaves.get(pieceIndex) ?? [0, 0];
    const startCurve = curves[first + head]!;
    const endCurve = curves[last - tail]!;
    const startEnd = startCurve.startIsLow ? startCurve.low : startCurve.high;
    const endEnd = endCurve.startIsLow ? endCurve.high : endCurve.low;
    // A vertex end keeps the raw (adopted) emitted end: no root.
    const position = (end: OffsetChainDomainEnd, source: SketchPoint2D) =>
      end.kind === "joint"
        ? jointRecords.get(end.jointIndex)!.joint.position
        : source;
    lineArcEndpoints.set(piece.seedEntityId, {
      start: position(startEnd, piece.start),
      end: position(endEnd, piece.end),
      startDomainEnd: startEnd,
      endDomainEnd: endEnd,
      ...(piece.kind === "arc" && (head > 0 || tail > 0)
        ? { removedLeaves: [head, tail] as const }
        : {}),
    });
  }
  return { ok: true, input, cubics, lineArcEndpoints, joints, vertices, arcs };
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
      /**
       * T08b-f: a point-defined seed arc (E3/R8): centre and source ends are
       * bitwise its solved point positions, ρ_s = hypot(S − C) (E7).
       */
      readonly kind: "arc";
      readonly center: SketchPoint2D;
      readonly source: readonly [SketchPoint2D, SketchPoint2D];
      readonly sourceRadius: number;
      readonly distance: number;
      readonly startPointId: SketchPointId;
      readonly endPointId: SketchPointId;
    }
  | {
      /** T08b-f [TECH F11]: a circle seed (solved centre and radius). */
      readonly kind: "circle";
      readonly center: SketchPoint2D;
      readonly sourceRadius: number;
      readonly distance: number;
    }
  | {
      readonly kind: "spline";
      readonly distance: number;
      /** The single owner call's spans (the resolver piece holds this array). */
      readonly spans: readonly SplineOffsetCubicSpan[];
      /**
       * The one fresh reconstruction's spans that owner call consumed; an
       * adoption re-call [TECH T1] uses exactly these (same frame).
       */
      readonly sourceSpans: readonly SplineSpan[];
    };

export interface DeclaredOffsetChainPieces {
  readonly ok: true;
  readonly connectivity: DeclaredOffsetChainConnectivity;
  readonly distance: number;
  readonly modelingTolerance: number;
  /** Raw resolver pieces in declared traversal order, forwarded by reference. */
  readonly pieces: readonly OffsetChainPiece[];
  readonly sources: readonly DeclaredOffsetPieceSource[];
  /**
   * Every declared adjacency as a declared vertex (T08b-d), in order: the
   * N2 joins, or the intrinsic positional closure of one closed spline (a
   * smooth closure is an owner knot and has none). Source data only.
   */
  readonly vertices: readonly OffsetChainVertex[];
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
    if (entity?.kind === "arc") {
      const solved = solvedEntities[0];
      const center = positions[entity.centerPointId];
      const start = positions[entity.startPointId];
      const end = positions[entity.endPointId];
      if (
        solvedEntities.length !== 1 ||
        solved?.kind !== "arc" ||
        !center ||
        !start ||
        !end ||
        solved.sweepDirection !== entity.sweepDirection
      )
        return uncertain(
          "The arc seed geometry does not match the solve frame.",
          seedEntityId,
        );
      // E3 / review R8: a point-defined seed (all three solved positions
      // bitwise its point positions); a state-driven arc is not a seed.
      if (
        !sameVector(center, solved.centerPosition) ||
        !sameVector(start, solved.startPosition) ||
        !sameVector(end, solved.endPosition)
      )
        return failure(
          codes.unsupportedSeed,
          "The arc seed is not point-defined in the solve frame (its solved ends are not its point positions).",
          seedEntityId,
        );
      const arc = seedArcPiece(
        seedEntityId,
        reversed,
        center,
        [start, end],
        entity.sweepDirection,
        effective,
        seedArcMinimumLeaves(connectivity),
      );
      if ("ok" in arc) return arc;
      pieces.push(arc.piece);
      sources.push({
        kind: "arc",
        center,
        source: [start, end],
        sourceRadius: arc.sourceRadius,
        distance: effective,
        startPointId: entity.startPointId,
        endPointId: entity.endPointId,
      });
      continue;
    }
    if (entity?.kind === "circle") {
      const solved = solvedEntities[0];
      const center = positions[entity.centerPointId];
      if (
        solvedEntities.length !== 1 ||
        solved?.kind !== "circle" ||
        !center ||
        !sameVector(center, solved.centerPosition) ||
        !Object.is(entity.radius, solved.solvedRadius)
      )
        return uncertain(
          "The circle seed geometry does not match the solve frame.",
          seedEntityId,
        );
      // [TECH F11]: counter-clockwise traversal, so left is inward: r − d.
      const radius = solved.solvedRadius - effective;
      if (!(radius > 0))
        return failure(
          codes.arcCollapse,
          "Offset distance collapses the circle radius.",
          seedEntityId,
        );
      pieces.push({
        kind: "circle",
        seedEntityId,
        reversed: false,
        center,
        radius,
      });
      sources.push({
        kind: "circle",
        center,
        sourceRadius: solved.solvedRadius,
        distance: effective,
      });
      continue;
    }
    if (entity?.kind !== "spline")
      return failure(
        codes.topologyStabilityUnsupported,
        "Tube stability supports declared line, arc, circle and spline pieces only.",
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
    sources.push({
      kind: "spline",
      distance: effective,
      spans: owner.spans,
      sourceSpans: geometry.spans,
    });
  }
  return {
    ok: true,
    connectivity,
    distance,
    modelingTolerance,
    pieces,
    sources,
    vertices: declaredOffsetChainVertices(connectivity, pieces, sources),
  };
}

/**
 * The emitted seed-arc piece of a point-defined arc (T08b-f design §2.1):
 * ρ_s = hypot(S − C) (E7), R̃ = fl(ρ_s − σ_s·d_i) (R̃ ≤ 0 collapses), the
 * legacy ray-scaled ends S′, E′ (so untrimmed ends are legacy-identical),
 * ρ_o = hypot(S′ − C) and the rule-B′ split directions. Fails closed on a
 * degenerate seed, a full turn or a consumer sweep-class disagreement
 * ([TECH F10], reject-only guards).
 */
function seedArcPiece(
  seedEntityId: SketchEntityId,
  reversed: boolean,
  center: SketchPoint2D,
  source: readonly [SketchPoint2D, SketchPoint2D],
  sweepDirection: "clockwise" | "counterClockwise",
  distance: number,
  minimumLeaves: 1 | 2,
):
  | {
      readonly piece: Extract<OffsetChainPiece, { kind: "arc" }>;
      readonly sourceRadius: number;
    }
  | OffsetChainFailure {
  const sigma = sweepDirection === "counterClockwise" ? 1 : -1;
  const sourceRadius = canonicalArcSupport(
    center,
    source[0],
    source[1],
    sweepDirection,
  ).radius;
  const shifted = sourceRadius - sigma * distance;
  if (!(shifted > 0))
    return failure(
      codes.arcCollapse,
      "Offset distance collapses the arc radius.",
      seedEntityId,
    );
  const start = scalePointFromCenter(center, source[0], shifted);
  const end = scalePointFromCenter(center, source[1], shifted);
  if (!start || !end)
    return failure(
      codes.unsupportedSeed,
      "Offset seed arc has degenerate geometry.",
      seedEntityId,
    );
  const piece = seedArcAt(
    { seedEntityId, reversed, center, start, end, sweepDirection },
    source,
    minimumLeaves,
  );
  return piece
    ? { piece, sourceRadius }
    : failure(
        codes.unsupportedSeed,
        "The offset seed arc has no admissible leaf partition (a full turn, a zero radius vector or a consumer sweep-class disagreement).",
        seedEntityId,
      );
}

/**
 * The arcs of a two-piece closed chain take at least two rule-B′ leaves
 * (the certifier re-derives the same rule from its request): every terminal
 * leaf then reaches only its own corner.
 */
function seedArcMinimumLeaves(
  connectivity: Pick<DeclaredOffsetChainConnectivity, "closed" | "pieces">,
): 1 | 2 {
  return connectivity.closed && connectivity.pieces.length === 2 ? 2 : 1;
}

/**
 * A seed-arc resolver piece with its canonical radius (hypot of the start)
 * and its rule-B′ partition re-derived for these ends (review A9: after
 * every adoption), or null on the [TECH F10] guards.
 */
function seedArcAt(
  arc: Pick<
    Extract<OffsetChainPiece, { kind: "arc" }>,
    "seedEntityId" | "reversed" | "center" | "start" | "end" | "sweepDirection"
  >,
  source: readonly [SketchPoint2D, SketchPoint2D],
  minimumLeaves: 1 | 2,
): Extract<OffsetChainPiece, { kind: "arc" }> | null {
  const { center, start, end, sweepDirection } = arc;
  const splits = seedArcLeafSplits(
    center,
    start,
    end,
    sweepDirection,
    source[0],
    source[1],
    minimumLeaves,
  );
  if (!splits) return null;
  // [TECH F10]: the consumer's binary64 atan2 sweep must not wrap across
  // 0/2π against the exact wedge (σ(a × b) > 0 minor, < 0 major): a minor
  // arc drawn above 3π/2, or a major one below π/2, is rejected. Rounding
  // across π is harmless (both halves are drawn alike) and is accepted.
  const angle = (point: SketchPoint2D) =>
    Math.atan2(point[1] - center[1], point[0] - center[0]);
  const ccw = sweepDirection === "counterClockwise";
  const low = angle(ccw ? start : end);
  let high = angle(ccw ? end : start);
  while (high <= low) high += 2 * Math.PI;
  const sweep = high - low;
  const a = [0, 1].map(
    (axis) => scaledExact(start[axis]!) - scaledExact(center[axis]!),
  );
  const b = [0, 1].map(
    (axis) => scaledExact(end[axis]!) - scaledExact(center[axis]!),
  );
  const turn = (ccw ? 1 : -1) * exactSign(a[0]! * b[1]! - a[1]! * b[0]!);
  if (
    !(sweep > 0 && sweep < 2 * Math.PI) ||
    (turn > 0 && !(sweep < 1.5 * Math.PI)) ||
    (turn < 0 && !(sweep > 0.5 * Math.PI))
  )
    return null;
  return {
    kind: "arc",
    ...arc,
    radius: canonicalArcSupport(center, start, end, sweepDirection).radius,
    splits,
  };
}

/**
 * One traversal terminal of a declared piece from its SOURCE data only: the
 * canonical point ID, the binary64 source vertex and the exact traversal
 * tangent as a pair of binary64 points (a line's ends; a spline terminal
 * span's first or last pole pair), reversed with the traversal.
 */
function declaredVertexSide(
  piece: OffsetChainPiece,
  source: DeclaredOffsetPieceSource,
  exiting: boolean,
): OffsetChainVertexSide {
  const naturalEnd = exiting !== piece.reversed;
  const orient = (from: SketchPoint2D, to: SketchPoint2D) =>
    (piece.reversed ? [to, from] : [from, to]) as readonly [
      SketchPoint2D,
      SketchPoint2D,
    ];
  if (source.kind === "line") {
    const [start, end] = source.source;
    return {
      pointId: naturalEnd ? source.endPointId : source.startPointId,
      vertex: naturalEnd ? end : start,
      tangent: orient(start, end),
    };
  }
  if (source.kind === "arc" && piece.kind === "arc") {
    // [TECH F3]: the exact reference tangent σ_trav·rot(V − C) encoded as
    // the binary64 pair [(V_y, C_x), (C_y, V_x)] (difference rot(V − C)),
    // swapped for σ_trav < 0; `classifyOffsetChainVertex` reads it exactly.
    const vertex = naturalEnd ? source.source[1] : source.source[0];
    const center = source.center;
    const pair: readonly [SketchPoint2D, SketchPoint2D] = [
      [vertex[1], center[0]],
      [center[1], vertex[0]],
    ];
    const positiveTurn =
      (piece.sweepDirection === "counterClockwise") !== piece.reversed;
    return {
      pointId: naturalEnd ? source.endPointId : source.startPointId,
      vertex,
      tangent: positiveTurn ? pair : [pair[1], pair[0]],
    };
  }
  if (source.kind !== "spline")
    throw new RangeError("A circle offset piece has no declared vertex.");
  const span = naturalEnd ? source.sourceSpans.at(-1)! : source.sourceSpans[0]!;
  const poles = span.poles;
  return {
    pointId: (naturalEnd
      ? span.source.endPointId
      : span.source.startPointId) as SketchPointId,
    vertex: naturalEnd ? poles[3] : poles[0],
    tangent: naturalEnd
      ? orient(poles[2], poles[3])
      : orient(poles[0], poles[1]),
  };
}

/** The declared vertices of one adapter output (see `DeclaredOffsetChainPieces`). */
function declaredOffsetChainVertices(
  connectivity: DeclaredOffsetChainConnectivity,
  pieces: readonly OffsetChainPiece[],
  sources: readonly DeclaredOffsetPieceSource[],
): OffsetChainVertex[] {
  const side = (index: number, exiting: boolean) =>
    declaredVertexSide(pieces[index]!, sources[index]!, exiting);
  if (pieces.length === 1) {
    const source = sources[0]!;
    const spans = source.kind === "spline" ? source.sourceSpans : [];
    // Positional closure: distinct first/last occurrences (a smooth closure
    // shares one occurrence and is the owner's wrap knot). One authority
    // point ID; distinct IDs are rejected by the certifier's C5 check.
    if (
      !connectivity.closed ||
      spans.length === 0 ||
      spans.at(-1)!.source.endOccurrenceId ===
        spans[0]!.source.startOccurrenceId
    )
      return [];
    return [
      {
        jointIndex: 0,
        authority: {
          kind: "positionalClosure",
          pointId: spans[0]!.source.startPointId as SketchPointId,
        },
        first: side(0, true),
        second: side(0, false),
      },
    ];
  }
  return connectivity.joins.map((join, index) => ({
    jointIndex: index,
    authority:
      join.kind === "sharedPoint"
        ? { kind: "sharedPoint", pointId: join.pointId }
        : { kind: "coincident", pointIds: join.pointIds },
    first: side(index, true),
    second: side((index + 1) % pieces.length, false),
  }));
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
          : result.code === "arc-tube-collapse"
            ? codes.arcCollapse
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
  const request = declaredTubeRequest(resolved, declared);
  if ("ok" in request) return request;
  return tubeStabilityResult(
    resolved,
    resolved.input.pieces[0]!.seedEntityId,
    certifier.certifyPieceChain(request),
    "leaves",
  );
}

/** The certifier's form of a declared vertex authority (IDs only). */
function certifierAuthority(
  authority: OffsetChainVertexAuthority,
): TubeChainVertexAuthority {
  switch (authority.kind) {
    case "sharedPoint":
      return { kind: "shared-point", pointId: authority.pointId };
    case "coincident":
      return { kind: "coincident", pointIds: authority.pointIds };
    case "positionalClosure":
      return { kind: "positional-closure", pointId: authority.pointId };
  }
}

/**
 * Binds a resolution to exactly this adapter output and builds the piece
 * request, or fails closed. A resolution with declared `vertices` (the SEL
 * entry's) is bound per adjacency in one index space (review R5): each is
 * exactly one resolved trim or one resolved vertex, and every domain end
 * names it. Without them this is the unchanged L1b/R_C binding.
 */
function declaredTubeRequest(
  resolved: OffsetChainTopologySuccess,
  declared: DeclaredOffsetChainPieces,
): PieceTubeChainRequest | OffsetChainFailure {
  const { pieces, closed, modelingTolerance } = resolved.input;
  const { connectivity, sources } = declared;
  const count = pieces.length;
  const seedEntityId = pieces[0]?.seedEntityId ?? null;
  const mismatch = (message: string) =>
    failure(codes.topologyUncertain, message, seedEntityId);
  const vertexAware = resolved.input.vertices !== undefined;
  // Identity binding: the resolution is of exactly this adapter output.
  if (
    count === 0 ||
    count !== declared.pieces.length ||
    count !== sources.length ||
    count !== connectivity.pieces.length ||
    closed !== connectivity.closed ||
    !Object.is(modelingTolerance, declared.modelingTolerance) ||
    (vertexAware && resolved.input.vertices !== declared.vertices) ||
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
  // A single closed piece closes through its own bitwise owner knot, or
  // (declared vertices only) through its positional-closure vertex.
  const wrap = closed && count > 1;
  const adjacencies = vertexAware
    ? declared.vertices.length
    : connectivity.joins.length;
  const adjacencyKind: ("trim" | "vertex" | "arc")[] = [];
  if (vertexAware) {
    const expected = wrap ? count : count - 1;
    let trim = 0;
    let vertex = 0;
    let arc = 0;
    for (let index = 0; index < adjacencies; index += 1) {
      if (resolved.joints[trim]?.jointIndex === index) {
        adjacencyKind.push("trim");
        trim += 1;
      } else if (resolved.vertices[vertex]?.jointIndex === index) {
        adjacencyKind.push("vertex");
        vertex += 1;
      } else if (resolved.arcs[arc]?.jointIndex === index) {
        adjacencyKind.push("arc");
        arc += 1;
      } else return mismatch("The resolved joints are not the declared joins.");
    }
    if (
      trim !== resolved.joints.length ||
      vertex !== resolved.vertices.length ||
      arc !== resolved.arcs.length ||
      (count > 1 && adjacencies !== expected) ||
      (count === 1 && adjacencies > (closed ? 1 : 0))
    )
      return mismatch("The resolved joints are not the declared joins.");
    // Each arc is exactly the declared pieces' canonical arc (what a
    // consumer publishes): centre P_v, the own emitted terminal poles.
    for (const arc of resolved.arcs) {
      const next = (arc.jointIndex + 1) % count;
      const from = emittedTerminal(pieceTerminal(pieces, arc.jointIndex, true));
      const to = emittedTerminal(pieceTerminal(pieces, next, false));
      const vertex = declared.vertices[arc.jointIndex]!;
      const canonical =
        from &&
        to &&
        canonicalArcSupport(
          vertex.first.vertex,
          from.position,
          to.position,
          sourceTurn(vertex) > 0 ? "counterClockwise" : "clockwise",
        );
      if (
        !canonical ||
        !samePoint(arc.center, canonical.center) ||
        !samePoint(arc.start, canonical.start) ||
        !samePoint(arc.end, canonical.end) ||
        !Object.is(arc.radius, canonical.radius) ||
        arc.sweepDirection !== canonical.sweepDirection
      )
        return mismatch(
          "A resolved arc is not the declared pieces' canonical arc.",
        );
    }
  } else if (
    resolved.arcs.length !== 0 ||
    resolved.joints.length !== connectivity.joins.length ||
    connectivity.joins.length !== (wrap ? count : count - 1)
  )
    return mismatch("The resolved joints are not the declared joins.");

  // Traversal-terminal canonical point of each piece (view, not coordinates).
  const terminalPoint = (index: number, exiting: boolean) => {
    const source = sources[index]!;
    const naturalEnd = exiting !== pieces[index]!.reversed;
    if (source.kind === "line" || source.kind === "arc")
      return naturalEnd ? source.endPointId : source.startPointId;
    if (source.kind === "circle") return undefined;
    return naturalEnd
      ? source.spans.at(-1)?.source.endPointId
      : source.spans[0]?.source.startPointId;
  };
  for (const [index, join] of connectivity.joins.entries()) {
    const next = (index + 1) % count;
    const exiting = terminalPoint(index, true);
    const entering = terminalPoint(next, false);
    const declaredTerminal =
      join.kind === "sharedPoint"
        ? join.pointId === exiting && join.pointId === entering
        : join.pointIds[0] !== join.pointIds[1] &&
          ((join.pointIds[0] === exiting && join.pointIds[1] === entering) ||
            (join.pointIds[1] === exiting && join.pointIds[0] === entering));
    const joint = vertexAware
      ? resolved.joints.find((item) => item.jointIndex === index)
      : resolved.joints[index]!;
    if (
      !declaredTerminal ||
      (joint &&
        (joint.firstSeedEntityId !== pieces[index]!.seedEntityId ||
          joint.secondSeedEntityId !== pieces[next]!.seedEntityId))
    )
      return mismatch(
        `Declared join ${index} is not the shared traversal terminal of its pieces.`,
      );
  }

  // Domain ends bind resolver adjacency indices to the declared adjacencies.
  const expectedEnd = (index: number, exiting: boolean) => {
    if (vertexAware) {
      if (exiting) return index < adjacencies ? index : null;
      const previous = (index - 1 + count) % count;
      return previous < adjacencies && (closed || index > 0) ? previous : null;
    }
    if (exiting) return wrap || index < count - 1 ? index : null;
    return wrap || index > 0 ? (index - 1 + count) % count : null;
  };
  const isEnd = (end: OffsetChainDomainEnd, expected: number | null) =>
    expected === null
      ? end.kind === "source"
      : adjacencyKind[expected] === "vertex"
        ? end.kind === "vertex" && end.vertexIndex === expected
        : adjacencyKind[expected] === "arc"
          ? end.kind === "arc" && end.jointIndex === expected
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
          startPointId: source.startPointId,
          endPointId: source.endPointId,
        },
      });
      continue;
    }
    if (piece.kind === "arc" && source.kind === "arc") {
      // T08b-f: the seed arc's own raw support, bound to its canonical
      // radius (E7) and its point-defined source (E3); R7 removals from the
      // resolution's domain ends.
      const ends = resolved.lineArcEndpoints.get(piece.seedEntityId);
      if (
        !ends ||
        !isEnd(ends.startDomainEnd, low) ||
        !isEnd(ends.endDomainEnd, high) ||
        !samePoint(piece.center, source.center) ||
        !Object.is(
          piece.radius,
          canonicalArcSupport(
            piece.center,
            piece.start,
            piece.end,
            piece.sweepDirection,
          ).radius,
        )
      )
        return mismatch("The resolution does not describe its own seed arc.");
      requestPieces.push({
        kind: "arc",
        reversed: piece.reversed,
        tube: {
          center: piece.center,
          radius: piece.radius,
          emitted: [piece.start, piece.end],
          source: source.source,
          sourceRadius: source.sourceRadius,
          sweep: piece.sweepDirection,
          distance: source.distance,
          startPointId: source.startPointId,
          endPointId: source.endPointId,
          ...(ends.removedLeaves ? { removed: ends.removedLeaves } : {}),
        },
      });
      continue;
    }
    if (piece.kind === "circle" && source.kind === "circle") {
      if (count !== 1 || !closed || !samePoint(piece.center, source.center))
        return mismatch("The resolution does not describe its own circle.");
      requestPieces.push({
        kind: "circle",
        reversed: false,
        tube: {
          center: piece.center,
          radius: piece.radius,
          sourceRadius: source.sourceRadius,
          distance: source.distance,
        },
      });
      continue;
    }
    if (piece.kind !== "derivedCubic" || source.kind !== "spline")
      return failure(
        codes.topologyStabilityUnsupported,
        "Tube stability supports declared line, arc, circle and spline pieces only.",
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
    // A vertex or F1 arc end runs K1 on the whole emitted leaf (R8, after
    // adoption; T08b-e arc-entry/exit cones).
    const vertexEnd = [low, high].some(
      (end) =>
        end !== null &&
        (adjacencyKind[end] === "vertex" || adjacencyKind[end] === "arc"),
    );
    if (count > 1 && piece.spans.length === 1 && !vertexEnd)
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
        // Owner metadata by reference, including its Q4-E1 `localError` split.
        reference: span.reference,
        source: span.source,
        sourceLocalInterval: span.sourceLocalInterval,
        // The stored query domain the witnesses are expressed in.
        queryDomain: span.sourceInterval,
      })),
    });
  }
  const positional =
    vertexAware && count === 1 ? declared.vertices[0] : undefined;
  return {
    modelingTolerance,
    closed,
    distance: declared.distance,
    pieces: requestPieces,
    trims: resolved.joints.map(
      (joint, position): TubeChainTrimDeclaration => ({
        jointIndex: vertexAware ? joint.jointIndex : position,
        firstParameterBounds: joint.firstParameterBounds,
        secondParameterBounds: joint.secondParameterBounds,
        // T7: a trim at a positional closure carries its authority.
        ...(positional
          ? { authority: certifierAuthority(positional.authority) }
          : {}),
      }),
    ),
    ...(vertexAware
      ? {
          vertices: resolved.vertices.map(
            (vertex): TubeChainVertexDeclaration => ({
              jointIndex: vertex.jointIndex,
              authority: certifierAuthority(
                declared.vertices[vertex.jointIndex]!.authority,
              ),
              keeper: vertex.keeper,
            }),
          ),
        }
      : {}),
    ...(resolved.arcs.length > 0
      ? {
          arcs: resolved.arcs.map(
            (arc): TubeChainArcDeclaration => ({
              jointIndex: arc.jointIndex,
              authority: certifierAuthority(
                declared.vertices[arc.jointIndex]!.authority,
              ),
              center: arc.center,
              radius: arc.radius,
              sweep: arc.sweepDirection,
            }),
          ),
        }
      : {}),
  };
}

/** Traversal terminal of piece `index` at an adjacency: its natural side. */
function pieceTerminal(
  pieces: readonly OffsetChainPiece[],
  index: number,
  exiting: boolean,
) {
  const piece = pieces[index]!;
  return {
    index,
    piece,
    side: exiting !== piece.reversed ? ("end" as const) : ("start" as const),
  };
}

type PieceTerminal = ReturnType<typeof pieceTerminal>;

/** The emitted terminal pole (and its JVP) of one piece at one natural side. */
function emittedTerminal(terminal: PieceTerminal) {
  const { piece, side } = terminal;
  if (piece.kind === "lineSegment" || piece.kind === "arc")
    return {
      position: side === "end" ? piece.end : piece.start,
      differential: undefined,
    };
  if (piece.kind !== "derivedCubic") return null;
  const span = side === "end" ? piece.spans.at(-1)! : piece.spans[0]!;
  const pole = side === "end" ? 3 : 0;
  return {
    position: span.poles[pole],
    differential: span.differential.poles[pole],
  };
}

type AdoptionOutcome =
  | {
      readonly ok: true;
      readonly declared: DeclaredOffsetChainPieces;
      readonly decisions: readonly AdjacencyDecision[];
    }
  | {
      readonly ok: false;
      /** The declared vertex whose absorption could not be built. */
      readonly jointIndex: number;
      readonly reason: string;
    };

/**
 * SEL step 3 (design §4.4, [TECH T1/T2]): for every declared vertex whose
 * terminal poles (or pole JVPs) are not already bitwise equal, the adopter
 * takes the keeper's emitted pole verbatim: a line by construction, a spline
 * by at most ONE owner re-call covering both its ends, with the same
 * reconstruction and distance. The rule keeper is tried first, then the
 * swap. An adopter whose other end is a trim must leave that trim's queried
 * geometry unchanged (a line never; a spline with ≥ 2 source spans). A
 * positional closure re-calls with the first pass's first leaf at its end
 * and requires its source spans 0 … n − 2 bitwise unchanged.
 */
function adoptDeclaredVertices(
  declared: DeclaredOffsetChainPieces,
  decisions: readonly AdjacencyDecision[],
): AdoptionOutcome {
  const { pieces } = declared;
  const closed = declared.connectivity.closed;
  const count = pieces.length;
  const kinds = new Map<number, AdjacencyDecision["kind"]>();
  for (const decision of decisions)
    kinds.set(decisionIndex(decision), decision.kind);
  /** The adjacency kind at the OTHER traversal end of piece `index`. */
  const otherAdjacency = (index: number, exitingHere: boolean) => {
    if (count === 1) return undefined;
    if (!closed && (exitingHere ? index === 0 : index === count - 1))
      return undefined;
    return kinds.get(exitingHere ? (index - 1 + count) % count : index);
  };
  /** T2 eligibility of the keeper choice at one vertex. */
  const eligible = (
    keeper: "first" | "second",
    first: PieceTerminal,
    second: PieceTerminal,
  ) => {
    if (count === 1) return keeper === "second";
    const [keep, adopt] =
      keeper === "first" ? [first, second] : [second, first];
    const other = otherAdjacency(adopt.index, adopt === first);
    if (adopt.piece.kind === "lineSegment") return other !== "trim";
    // T08b-f review R6: an arc is an eligible (swap) adopter of any
    // neighbour's pole. Next to a trim it may adopt only at its natural END
    // with its first leaf bitwise unchanged (the trim's queried support);
    // a start adoption re-derives ρ_o and is never next to a trim.
    if (adopt.piece.kind === "arc") {
      if (other !== "trim") return true;
      if (adopt.side !== "end") return false;
      const source = declared.sources[adopt.index]!;
      const pole = emittedTerminal(keep);
      if (source.kind !== "arc" || !pole) return false;
      const again = seedArcAt(
        { ...adopt.piece, end: pole.position },
        source.source,
        seedArcMinimumLeaves(declared.connectivity),
      );
      const before = adopt.piece.splits ?? [];
      return (
        again !== null &&
        before.length > 0 &&
        again.splits!.length > 0 &&
        samePoint(before[0]!, again.splits![0]!)
      );
    }
    // A spline adopts only another spline's emitted leaf (owner seam).
    if (keep.piece.kind !== "derivedCubic") return false;
    const source = declared.sources[adopt.index]!;
    return (
      other !== "trim" ||
      (source.kind === "spline" && source.sourceSpans.length >= 2)
    );
  };
  // [TECH T2]: the rule keeper first, the swap once more when the rule
  // adopter is ineligible or its owner re-call fails (review A4).
  const forced = new Map<number, "first" | "second">();
  for (;;) {
    const plans = new Map<
      number,
      {
        ends: { start?: AdoptedEndpoint; end?: AdoptedEndpoint };
        vertices: number[];
      }
    >();
    const lineEnds = new Map<
      number,
      { start?: SketchPoint2D; end?: SketchPoint2D }
    >();
    const arcEnds = new Map<
      number,
      { start?: SketchPoint2D; end?: SketchPoint2D }
    >();
    const updated: AdjacencyDecision[] = [];
    const swappable = new Map<number, "first" | "second">();
    for (const decision of decisions) {
      // An F1 arc end keeps its own emitted pole (no adoption there).
      if (decision.kind !== "vertex") {
        updated.push(decision);
        continue;
      }
      const { vertex } = decision;
      const index = vertex.jointIndex;
      const first = pieceTerminal(pieces, index, true);
      const second = pieceTerminal(pieces, (index + 1) % count, false);
      const firstPole = emittedTerminal(first);
      const secondPole = emittedTerminal(second);
      if (!firstPole || !secondPole)
        return {
          ok: false,
          jointIndex: index,
          reason: "unsupported piece kind",
        };
      const same =
        samePoint(firstPole.position, secondPole.position) &&
        (!firstPole.differential ||
          !secondPole.differential ||
          samePoint(firstPole.differential, secondPole.differential));
      if (same) {
        updated.push(decision);
        continue;
      }
      const other = vertex.keeper === "first" ? "second" : "first";
      const keeper =
        forced.get(index) ??
        (eligible(vertex.keeper, first, second)
          ? vertex.keeper
          : eligible(other, first, second)
            ? other
            : undefined);
      if (!keeper)
        return {
          ok: false,
          jointIndex: index,
          reason: "absorbed vertex adopter is trimmed at its other end",
        };
      if (!forced.has(index) && keeper === vertex.keeper) {
        const swap = keeper === "first" ? "second" : "first";
        if (eligible(swap, first, second)) swappable.set(index, swap);
      }
      const [keep, adopt] =
        keeper === "first" ? [first, second] : [second, first];
      const keepPole = keeper === "first" ? firstPole : secondPole;
      if (adopt.piece.kind === "lineSegment" || adopt.piece.kind === "arc") {
        const map = adopt.piece.kind === "arc" ? arcEnds : lineEnds;
        const ends = map.get(adopt.index) ?? {};
        ends[adopt.side] = keepPole.position;
        map.set(adopt.index, ends);
      } else {
        const keepPiece = keep.piece as Extract<
          OffsetChainPiece,
          { kind: "derivedCubic" }
        >;
        const join = declared.vertices[index]!.authority;
        const plan = plans.get(adopt.index) ?? { ends: {}, vertices: [] };
        plan.ends[adopt.side] = {
          neighbour:
            keep.side === "end" ? keepPiece.spans.at(-1)! : keepPiece.spans[0]!,
          neighbourEnd: keep.side,
          authority:
            join.kind === "sharedPoint"
              ? { kind: "sharedPoint" }
              : join.kind === "coincident"
                ? { kind: "coincident", pointIds: join.pointIds }
                : { kind: "positionalClosure" },
        };
        plan.vertices.push(index);
        plans.set(adopt.index, plan);
      }
      updated.push({ kind: "vertex", vertex: { ...vertex, keeper } });
    }
    const nextPieces = [...pieces];
    const nextSources = [...declared.sources];
    for (const [index, ends] of lineEnds) {
      const piece = pieces[index] as Extract<
        OffsetChainPiece,
        { kind: "lineSegment" }
      >;
      nextPieces[index] = {
        ...piece,
        start: ends.start ?? piece.start,
        end: ends.end ?? piece.end,
      };
    }
    // T08b-f: an adopting arc takes the pole verbatim; its canonical radius
    // and rule-B′ partition are re-derived from the adopted ends (A9).
    for (const [index, ends] of arcEnds) {
      const piece = pieces[index] as Extract<OffsetChainPiece, { kind: "arc" }>;
      const source = declared.sources[index]!;
      const adopted =
        source.kind === "arc"
          ? seedArcAt(
              {
                ...piece,
                start: ends.start ?? piece.start,
                end: ends.end ?? piece.end,
              },
              source.source,
              seedArcMinimumLeaves(declared.connectivity),
            )
          : null;
      if (!adopted)
        return {
          ok: false,
          jointIndex: index,
          reason: "the adopted seed arc has no admissible leaf partition",
        };
      nextPieces[index] = adopted;
    }
    let ownerFailure: { vertex: number; code: string } | undefined;
    let restart = false;
    for (const [index, plan] of plans) {
      const piece = pieces[index] as Extract<
        OffsetChainPiece,
        { kind: "derivedCubic" }
      >;
      const source = declared.sources[index] as Extract<
        DeclaredOffsetPieceSource,
        { kind: "spline" }
      >;
      // The owner seam rejects adoption at d = ±0 (its analytic branch would
      // overwrite it) as caller misuse: fail closed before calling it.
      if (source.distance === 0)
        return {
          ok: false,
          jointIndex: Math.min(...plan.vertices),
          reason:
            "a spline cannot adopt a declared vertex pole at d = 0 (owner seam precondition)",
        };
      // [TECH T1]: at most one re-call per adopting piece, both ends at once.
      const owner = approximateSplineOffset({
        spans: source.sourceSpans,
        distance: source.distance,
        modelingTolerance: declared.modelingTolerance,
        sharedEndpoints: plan.ends,
      });
      if (!owner.ok) {
        ownerFailure = { vertex: Math.min(...plan.vertices), code: owner.code };
        const swap = plan.vertices.find((vertex) => swappable.has(vertex));
        if (swap !== undefined) {
          forced.set(swap, swappable.get(swap)!);
          ownerFailure = undefined;
          restart = true;
        }
        break;
      }
      // Positional closure: only the closing source span's leaves may change.
      if (count === 1) {
        const closing = source.sourceSpans.length - 1;
        const kept = piece.spans.filter(
          (span) => span.source.spanIndex !== closing,
        );
        const again = owner.spans.filter(
          (span) => span.source.spanIndex !== closing,
        );
        if (
          kept.length !== again.length ||
          kept.some((span, offset) => !sameOwnerSpan(span, again[offset]!))
        )
          return {
            ok: false,
            jointIndex: 0,
            reason:
              "the second pass changed source spans before the closing one",
          };
      }
      nextPieces[index] = { ...piece, spans: owner.spans };
      nextSources[index] = { ...source, spans: owner.spans };
    }
    if (ownerFailure)
      return {
        ok: false,
        jointIndex: ownerFailure.vertex,
        reason: `owner ${ownerFailure.code}`,
      };
    if (restart) continue; // a swap was forced: rebuild the plan
    // Every vertex of the adopted chain now shares its emitted pole bitwise.
    for (const decision of updated) {
      if (decision.kind !== "vertex") continue;
      const index = decision.vertex.jointIndex;
      const a = emittedTerminal(pieceTerminal(nextPieces, index, true));
      const b = emittedTerminal(
        pieceTerminal(nextPieces, (index + 1) % count, false),
      );
      if (!a || !b || !samePoint(a.position, b.position))
        return {
          ok: false,
          jointIndex: index,
          reason: "the adopted chain does not share its vertex pole bitwise",
        };
    }
    return {
      ok: true,
      declared: { ...declared, pieces: nextPieces, sources: nextSources },
      decisions: updated,
    };
  }
}

/** Bitwise equality of two owner leaves (poles, JVP poles, ε, intervals, metadata). */
function sameOwnerSpan(
  first: SplineOffsetCubicSpan,
  second: SplineOffsetCubicSpan,
) {
  const encode = (span: SplineOffsetCubicSpan) =>
    JSON.stringify(span, (_key, value: unknown) => {
      if (typeof value !== "number") return value;
      bits.setFloat64(0, value);
      return `f64:${bits.getBigUint64(0).toString(16)}`;
    });
  return encode(first) === encode(second);
}

const MAGNITUDE_CODES: ReadonlySet<string> = new Set([
  "trim-window-unproven",
  "trim-composition-unproven",
  "trim-existence-unproven",
]);

/**
 * SEL (T08b-d design §7, T08b-e design §7 as amended by user decision U-E;
 * the declared-vertex chain entry, not wired into any frame). One resolver
 * request (the joint queries on one meter; a convex vertex issues none,
 * [TECH E1]), then adoption and ONE staged certifier request of 1 + J_flip +
 * J_convex attempts (J_flip = trims with D > 0, J_convex = convex vertices
 * with D > 0 and an admissible arc), never re-querying:
 * - Convex vertex (U-E): with D > 0 and the corner proved within τ (G⁺ < τ)
 *   it is an absorption candidate first, and an F1 arc if that absorption
 *   does not build or certify with a failure at its terminal leaves;
 *   otherwise an F1 arc first, falling back to absorption (D > 0 only,
 *   [TECH E2], M4 amendment: "absorption after an arc failure with an
 *   `arcJoints`-tagged code (cone, clearance, admission, ε), justified by
 *   independent re-certification"). Rule Z (no admissible arc) absorbs
 *   (D > 0) or fails closed. [TECH E8]: an arc whose neighbours' certified
 *   errors already cover its chord (|A′ − B′| ≤ ε_P + ε_Q, the certifier's
 *   own cubic errors, 0 for lines; exact) cannot clear K3, so it goes to
 *   absorption without an attempt. Each convex vertex switches at most once.
 * - Certify the adopted chain; verified ⇒ done. Otherwise, in this order:
 *   the lowest arc of `arcJoints` that may still fall back; the T08b-d flip
 *   (a magnitude-tagged trim code at the lowest-index unflipped D > 0 trim
 *   incident to a reported leaf); the lowest absorbed convex vertex that may
 *   still take its arc and whose terminal leaf is reported; T08b-f [TECH F6]
 *   the lowest concave seed-arc vertex absorbed first (also when its
 *   adoption fails) that may still take its deferred joint query, whose
 *   trim is never flipped back. Every retry is justified only by the
 *   independent re-certification of the new chain. Attempts add one per F6
 *   vertex.
 * - Failure precedence (review R6): a convex vertex that tried both reports
 *   its ARC failure with "Absorption not certified: …" appended; a step-2(b)
 *   vertex its step-2 resolver failure, a rule-Z vertex its missing arc,
 *   each with the absorption reason appended (the absorbed vertex whose
 *   terminal leaves were reported, else the lowest); after a flip the
 *   original trim failure. Budget exhaustion is always reported as itself. Every path ends
 *   in a verified certificate of the emitted chain or a diagnostic.
 * Exceptions (queries, owner misuse, certifier) propagate unchanged.
 */
export function certifyDeclaredOffsetChain(
  declared: DeclaredOffsetChainPieces,
  query: CertifiedNeutralCurveRequestQuery,
  certifier: CertifiedTubePieceChainRequests,
): OffsetChainTubeStabilityResult {
  return selectDeclaredOffsetChain(declared, query, certifier, SEL_POLICY);
}

/** The SEL's two U-E routing choices; production always uses both. */
export interface DeclaredOffsetChainPolicy {
  /** U-E: absorb a convex D > 0 corner proved within τ before any arc. */
  readonly absorptionFirst: boolean;
  /** [TECH E8]: skip an arc attempt that cannot clear K3. */
  readonly shortArcPretest: boolean;
}

const SEL_POLICY: DeclaredOffsetChainPolicy = {
  absorptionFirst: true,
  shortArcPretest: true,
};

/**
 * Test-only policy seam (never production): `certifyDeclaredOffsetChain`
 * with U-E's absorption-first order and/or the E8 pre-test switched off, so
 * a native arc → absorption fallback is reachable (review R6(b)). Every
 * result is still a certificate of the emitted chain or a diagnostic.
 */
export function certifyDeclaredOffsetChainWithPolicyForTest(
  declared: DeclaredOffsetChainPieces,
  query: CertifiedNeutralCurveRequestQuery,
  certifier: CertifiedTubePieceChainRequests,
  policy: DeclaredOffsetChainPolicy,
): OffsetChainTubeStabilityResult {
  return selectDeclaredOffsetChain(declared, query, certifier, policy);
}

/** Exact E8: |A′ − B′|² ≤ (ε_P + ε_Q)² on binary64 inputs (BigInt). */
function shortArc(pieces: readonly OffsetChainPiece[], arc: ResolvedOffsetArc) {
  const error = (index: number, exiting: boolean) => {
    const { piece, side } = pieceTerminal(pieces, index, exiting);
    if (piece.kind !== "derivedCubic") return 0n;
    return scaledExact(
      (side === "end" ? piece.spans.at(-1)! : piece.spans[0]!).certifiedError,
    );
  };
  const reach =
    error(arc.jointIndex, true) +
    error((arc.jointIndex + 1) % pieces.length, false);
  const chord = [0, 1].map(
    (axis) => scaledExact(arc.end[axis]!) - scaledExact(arc.start[axis]!),
  );
  return chord[0]! * chord[0]! + chord[1]! * chord[1]! <= reach * reach;
}

function selectDeclaredOffsetChain(
  declared: DeclaredOffsetChainPieces,
  query: CertifiedNeutralCurveRequestQuery,
  certifier: CertifiedTubePieceChainRequests,
  policy: DeclaredOffsetChainPolicy,
): OffsetChainTubeStabilityResult {
  const input: OffsetChainTopologyInput = {
    pieces: declared.pieces,
    closed: declared.connectivity.closed,
    modelingTolerance: declared.modelingTolerance,
    query,
    vertices: declared.vertices,
    distance: declared.distance,
  };
  const decided = decideOffsetChainAdjacencies(input, policy.absorptionFirst);
  if (!decided.ok) return decided;
  let decisions = decided.decisions;
  // Convex vertices (T08b-e): the one switch each may still make.
  const plans = convexVertexPlans(input);
  const convex = new Map<
    number,
    {
      readonly switchable: boolean;
      absorptionTried: boolean;
      arcTried: boolean;
      absorptionReason?: string;
    }
  >();
  plans.forEach((plan, index) => {
    if (plan)
      convex.set(index, {
        switchable: plan.forward && !plan.zero,
        absorptionTried: false,
        arcTried: false,
      });
  });
  const flippable = decisions.filter(
    (decision) => decision.kind === "trim" && decision.flippable,
  ).length;
  const switchable = [...convex.values()].filter(
    (state) => state.switchable,
  ).length;
  // T08b-f [TECH F6]: concave arc-side vertices absorbed first, each of
  // which may still take its (deferred) joint query and trim once.
  const concaveState = new Map<number, { queried: boolean }>();
  (policy.absorptionFirst ? concaveArcPlans(input) : []).forEach(
    (fits, index) => {
      if (fits === true) concaveState.set(index, { queried: false });
    },
  );
  const request = certifier.openRequest(
    1 + flippable + switchable + concaveState.size,
  );
  const modeOf = (jointIndex: number) =>
    decisions.find((decision) => decisionIndex(decision) === jointIndex)?.kind;
  /** Switches one convex vertex to absorption (with its arc's failure) or to its arc. */
  const switchTo = (
    jointIndex: number,
    mode: "absorbed" | "arc",
    arcFailure?: OffsetChainFailure,
  ) => {
    decisions = decisions.map((decision) =>
      decisionIndex(decision) !== jointIndex
        ? decision
        : mode === "arc"
          ? { kind: "arc", jointIndex }
          : {
              kind: "vertex",
              vertex: {
                jointIndex,
                kind: "absorbed",
                class: "nonparallel",
                keeper: ruleKeeper(declared.pieces, input.closed, jointIndex),
                trigger: { step: "convex", failure: arcFailure! },
              },
            },
    );
  };
  /** An absorbed convex vertex that may still take its arc. */
  const mayTakeArc = (jointIndex: number) => {
    const state = convex.get(jointIndex);
    return (
      state !== undefined &&
      state.switchable &&
      !state.arcTried &&
      modeOf(jointIndex) === "vertex"
    );
  };
  const withAbsorption = (failed: OffsetChainFailure, reason: string) => ({
    ...failed,
    message: `${failed.message} Absorption not certified: ${reason}`,
  });
  let original: OffsetChainFailure | undefined;
  const flipped = new Set<number>();
  /** An F6 vertex still absorbed that may take its deferred query. */
  const mayQuery = (jointIndex: number) =>
    concaveState.get(jointIndex)?.queried === false &&
    modeOf(jointIndex) === "vertex";
  /**
   * F6 fallback (U-E's switch mirrored): the deferred joint query on the
   * resolver's meter; a trim replaces the absorption (never flipped back),
   * anything else is final with the absorption's reason.
   */
  const takeQuery = (
    jointIndex: number,
    reason: string,
  ): OffsetChainTubeStabilityResult | null => {
    concaveState.get(jointIndex)!.queried = true;
    const decision = decided.requery!(jointIndex);
    if ("exhausted" in decision) return decision.exhausted;
    if ("ok" in decision) return withAbsorption(decision, reason);
    if (decision.kind !== "trim")
      return withAbsorption(
        decision.kind === "vertex" && decision.vertex.trigger
          ? decision.vertex.trigger.failure
          : failure(
              codes.splineJointUnsupported,
              "The concave seed-arc vertex's joint query is not admissible.",
              declared.pieces[jointIndex]!.seedEntityId,
            ),
        reason,
      );
    flipped.add(jointIndex);
    decisions = decisions.map((item) =>
      decisionIndex(item) === jointIndex ? decision : item,
    );
    return null;
  };
  for (;;) {
    // R6: a failed absorption keeps the pre-absorption verdict.
    const absorptionFailure = (jointIndex: number, reason: string) => {
      const vertex = decisions.find(
        (decision) =>
          decision.kind === "vertex" &&
          decision.vertex.jointIndex === jointIndex,
      );
      const trigger =
        vertex?.kind === "vertex" ? vertex.vertex.trigger : undefined;
      if (trigger?.step === "flip" && original) return original;
      if (trigger) return withAbsorption(trigger.failure, reason);
      return failure(
        codes.knotIncidenceUnproven,
        `Declared ${concaveState.has(jointIndex) ? "concave seed-arc" : "parallel"} vertex ${jointIndex} is not certified: ${reason}`,
        declared.pieces[jointIndex]!.seedEntityId,
      );
    };
    const adopted = adoptDeclaredVertices(declared, decisions);
    if (!adopted.ok) {
      // U-E: an absorption-first corner whose adoption fails takes its arc.
      if (mayTakeArc(adopted.jointIndex)) {
        const state = convex.get(adopted.jointIndex)!;
        state.absorptionTried = true;
        state.absorptionReason = adopted.reason;
        switchTo(adopted.jointIndex, "arc");
        continue;
      }
      if (mayQuery(adopted.jointIndex)) {
        const final = takeQuery(adopted.jointIndex, adopted.reason);
        if (final) return final;
        continue;
      }
      return absorptionFailure(adopted.jointIndex, adopted.reason);
    }
    const adoptedInput: OffsetChainTopologyInput = {
      ...input,
      pieces: adopted.declared.pieces,
    };
    const resolved = assembleOffsetChainResolution(
      adoptedInput,
      adopted.decisions,
    );
    if (!resolved.ok)
      return (
        firstTrigger(adopted.decisions, resolved.message) ??
        (original && flipped.size > 0 ? original : resolved)
      );
    // [TECH E8] on the adopted pieces: an arc that cannot clear K3 falls
    // back to absorption without an attempt.
    const short = policy.shortArcPretest
      ? resolved.arcs.find(
          (arc) =>
            convex.get(arc.jointIndex)!.switchable &&
            !convex.get(arc.jointIndex)!.absorptionTried &&
            shortArc(adopted.declared.pieces, arc),
        )
      : undefined;
    if (short) {
      convex.get(short.jointIndex)!.arcTried = true;
      switchTo(
        short.jointIndex,
        "absorbed",
        failure(
          codes.splineJointUnsupported,
          "The convex declared vertex's arc chord is covered by its neighbours' certified errors (|A′ − B′| ≤ ε_P + ε_Q): its arc cannot be certified apart.",
          declared.pieces[short.jointIndex]!.seedEntityId,
        ),
      );
      continue;
    }
    const pieceRequest = declaredTubeRequest(resolved, adopted.declared);
    if ("ok" in pieceRequest) return pieceRequest;
    const raw = request.certifyPieceChain(pieceRequest);
    for (const [jointIndex, state] of convex)
      if (modeOf(jointIndex) === "arc") state.arcTried = true;
      else state.absorptionTried = true;
    const mapped = tubeStabilityResult(
      resolved,
      adopted.declared.pieces[0]!.seedEntityId,
      raw,
      "leaves",
    );
    if (raw.kind === "verified") return mapped;
    if (mapped.ok) return mapped;
    // Budget exhaustion is never folded into an R6 trigger: it is reported
    // as itself (one staged budget, sticky; no exhaustion swallow).
    if (raw.code === "exact-query-proof-budget-exhausted") return mapped;
    // [TECH E2]: the lowest tagged arc that may still fall back.
    const arcs = raw.arcJoints ?? [];
    const fallback = arcs.find((jointIndex) => {
      const state = convex.get(jointIndex);
      return (
        state !== undefined &&
        state.switchable &&
        !state.absorptionTried &&
        modeOf(jointIndex) === "arc"
      );
    });
    if (fallback !== undefined) {
      switchTo(fallback, "absorbed", mapped);
      continue;
    }
    // SEL step 5: the lowest-index unflipped D > 0 trim at a reported leaf.
    const leaves = [raw.first, raw.second].filter(
      (leaf): leaf is number => leaf !== undefined,
    );
    const firstLeaf: number[] = [];
    let total = 0;
    // Certifier leaves per piece: owner spans, one per line, the retained
    // rule-B′ leaves of a seed arc (T08b-f), eight per circle.
    const leafCount = (piece: OffsetChainPiece) => {
      if (piece.kind === "derivedCubic") return piece.spans.length;
      if (piece.kind === "circle") return CIRCLE_LEAF_DIRECTIONS.length;
      if (piece.kind === "lineSegment") return 1;
      const removed = resolved.lineArcEndpoints.get(piece.seedEntityId)
        ?.removedLeaves ?? [0, 0];
      return (piece.splits?.length ?? 0) + 1 - removed[0] - removed[1];
    };
    for (const piece of adopted.declared.pieces) {
      firstLeaf.push(total);
      total += leafCount(piece);
    }
    const terminalLeaf = (index: number, exiting: boolean) => {
      const { piece, side } = pieceTerminal(
        adopted.declared.pieces,
        index,
        exiting,
      );
      const size = leafCount(piece);
      return firstLeaf[index]! + (side === "end" ? size - 1 : 0);
    };
    const incident = (jointIndex: number) =>
      [
        terminalLeaf(jointIndex, true),
        terminalLeaf((jointIndex + 1) % adopted.declared.pieces.length, false),
      ].some((leaf) => leaves.includes(leaf));
    const target =
      raw.kind === "uncertain" &&
      raw.magnitude === true &&
      MAGNITUDE_CODES.has(raw.code)
        ? adopted.decisions.find(
            (decision) =>
              decision.kind === "trim" &&
              decision.flippable &&
              !flipped.has(decision.jointIndex) &&
              incident(decision.jointIndex),
          )
        : undefined;
    if (target?.kind === "trim") {
      original ??= mapped;
      flipped.add(target.jointIndex);
      decisions = decisions.map((decision) =>
        decision.kind === "trim" && decision.jointIndex === target.jointIndex
          ? {
              kind: "vertex",
              vertex: {
                jointIndex: decision.jointIndex,
                kind: "absorbed",
                class: "nonparallel",
                keeper: ruleKeeper(
                  declared.pieces,
                  input.closed,
                  decision.jointIndex,
                ),
                trigger: { step: "flip", failure: mapped },
              },
            }
          : decision,
      );
      continue;
    }
    // U-E: an absorbed corner failing at its terminal leaves takes its arc.
    const arcTarget = [...convex.keys()]
      .sort((left, right) => left - right)
      .find((jointIndex) => mayTakeArc(jointIndex) && incident(jointIndex));
    if (arcTarget !== undefined) {
      convex.get(arcTarget)!.absorptionReason = `${raw.code}: ${raw.message}`;
      switchTo(arcTarget, "arc");
      continue;
    }
    // F6: an absorbed concave arc-side corner failing at its terminal
    // leaves takes its deferred joint query (at most once).
    const queryTarget = [...concaveState.keys()]
      .sort((left, right) => left - right)
      .find((jointIndex) => mayQuery(jointIndex) && incident(jointIndex));
    if (queryTarget !== undefined) {
      const final = takeQuery(queryTarget, `${raw.code}: ${raw.message}`);
      if (final) return final;
      continue;
    }
    // Any other failure is final. A tagged arc that already tried its
    // absorption reports the arc failure with the absorption's reason.
    const tried = arcs.find(
      (jointIndex) =>
        modeOf(jointIndex) === "arc" &&
        convex.get(jointIndex)?.absorptionReason !== undefined,
    );
    if (tried !== undefined)
      return withAbsorption(mapped, convex.get(tried)!.absorptionReason!);
    // A failed absorption keeps its trigger: the one whose terminal leaves
    // were reported (math review A4), else the lowest.
    const triggered = adopted.decisions.filter(
      (decision) =>
        decision.kind === "vertex" && decision.vertex.trigger !== undefined,
    );
    const absorbed =
      triggered.find(
        (decision) =>
          decision.kind === "vertex" && incident(decision.vertex.jointIndex),
      ) ?? triggered[0];
    if (absorbed?.kind === "vertex")
      return absorptionFailure(
        absorbed.vertex.jointIndex,
        `${raw.code}: ${raw.message}`,
      );
    return original ?? mapped;
  }
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
 *
 * An F1 arc (T08b-e) is point-defined: its centre varies with its declared
 * source point (`sourcePointVariations`, by the vertex's first point ID,
 * required when the resolution has arcs), its ends with the neighbours' OWN
 * terminal variations (never adopted). Its radius and angle variations are
 * the point-defined arc's (`derived-geometry.ts`).
 */
export function resolveOffsetChainTopologyJvp(
  input: OffsetChainTopologyInput,
  resolved: OffsetChainTopologySuccess,
  variations: ReadonlyMap<SketchEntityId, OffsetChainPieceVariation>,
  sourcePointVariations?: ReadonlyMap<SketchPointId, SketchPoint2D>,
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
  // Domain ends name adjacency indices (review R5); joints are dense.
  const jointPosition = new Map(
    resolved.joints.map((joint, position) => [joint.jointIndex, position]),
  );
  const jointDifferential = (
    end: OffsetChainDomainEnd,
    seed: SketchEntityId,
    spanIndex: number,
  ) => {
    // A vertex end is the source end: the span's own (adopted) differential.
    if (end.kind !== "joint") return null;
    const position = jointPosition.get(end.jointIndex)!;
    const joint = resolved.joints[position]!;
    const [ds, dt] = jointParameterDifferentials[position]!;
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
  /**
   * A line end at a declared vertex is the keeper's emitted pole verbatim
   * (adoption, T08b-d), so its variation is the keeper's pole variation:
   * a keeper spline's terminal pole differential, a keeper line's own end
   * variation. Null when this line is the keeper (its own variation).
   */
  const vertexEndVariation = (
    jointIndex: number,
    seed: SketchEntityId,
  ): SketchPoint2D | null => {
    const vertex = resolved.vertices.find(
      (item) => item.jointIndex === jointIndex,
    )!;
    const count = input.pieces.length;
    const keeperIndex =
      vertex.keeper === "first" ? jointIndex : (jointIndex + 1) % count;
    const keeper = pieceTerminal(
      input.pieces,
      keeperIndex,
      vertex.keeper === "first",
    );
    if (keeper.piece.seedEntityId === seed) return null;
    if (keeper.piece.kind === "derivedCubic")
      return emittedTerminal(keeper)!.differential!;
    const variation = variations.get(keeper.piece.seedEntityId);
    if (!variation || variation.kind !== keeper.piece.kind)
      throw new RangeError(
        `Missing variation for offset chain piece ${keeper.piece.seedEntityId}`,
      );
    return keeper.side === "end" ? variation.end : variation.start;
  };
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
      end.kind === "joint"
        ? jointPositions[jointPosition.get(end.jointIndex)!]!
        : end.kind === "vertex"
          ? (vertexEndVariation(end.vertexIndex, seed) ?? source)
          : source;
    lineArcEndpoints.set(seed, {
      start: endpoint(endpoints.startDomainEnd, variation.start),
      end: endpoint(endpoints.endDomainEnd, variation.end),
    });
  }
  /** A piece's own terminal pole variation (an arc end is never adopted). */
  const ownTerminal = (index: number, exiting: boolean) => {
    const end = pieceTerminal(input.pieces, index, exiting);
    if (end.piece.kind === "derivedCubic")
      return emittedTerminal(end)!.differential!;
    const variation = variations.get(end.piece.seedEntityId);
    if (!variation || variation.kind !== end.piece.kind)
      throw new RangeError(
        `Missing variation for offset chain piece ${end.piece.seedEntityId}`,
      );
    return end.side === "end" ? variation.end : variation.start;
  };
  const arcs = resolved.arcs.map((arc) => {
    const pointId = input.vertices![arc.jointIndex]!.first.pointId;
    const center =
      pointId === undefined ? undefined : sourcePointVariations?.get(pointId);
    if (!center)
      throw new RangeError(
        `Missing source point variation for offset arc ${arc.jointIndex}`,
      );
    return {
      jointIndex: arc.jointIndex,
      center,
      start: ownTerminal(arc.jointIndex, true),
      end: ownTerminal((arc.jointIndex + 1) % input.pieces.length, false),
    };
  });
  return {
    ok: true,
    representativeQueryDomains,
    jointPositions,
    lineArcEndpoints,
    arcs,
  };
}
