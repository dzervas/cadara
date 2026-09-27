import {
  circleParameterInsideAngularDomain,
  getCircleAngularSearchBounds,
  validateCircleAngularDomain,
} from "@/contracts/modeling/circle-angular-domain";
import {
  evaluateSplineSpan,
  type SplinePoles,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";

export interface NeutralCurveProvenance {
  readonly sourceEntityId: string;
  readonly sourceSpanId: string;
}

interface NeutralCurveBase {
  readonly curveId: string;
  readonly provenance: NeutralCurveProvenance;
}

interface BoundedNeutralCurveBase extends NeutralCurveBase {
  /** Increasing source-parameter interval. Query parameters always use these units. */
  readonly sourceDomain: readonly [number, number];
  /** Increasing active subinterval in the same source-parameter units. */
  readonly queryDomain?: readonly [number, number];
}

export type CircleSourceDomain =
  | {
      readonly kind: "arc";
      /** Closed, increasing, unwrapped real-radian interval shorter than 2π. */
      readonly interval: readonly [number, number];
    }
  | {
      /** One symbolic winding [seam, seam + 2π), with the upper seam identified. */
      readonly kind: "fullTurn";
      readonly seam: number;
    };

export interface CircleQueryDomain {
  readonly kind: "arc";
  /** Closed active arc represented in the source domain's selected winding. */
  readonly interval: readonly [number, number];
}

export type NumericNeutralLine = BoundedNeutralCurveBase & {
  readonly kind: "line";
  /** Discriminant only: the literal numeric line keeps its existing meaning. */
  readonly form?: undefined;
  readonly origin: SplineVector;
  /** Unit vector. The source parameter is signed model-space distance. */
  readonly direction: SplineVector;
};

/**
 * Endpoint-preserving finite segment. The exact support is the exact dyadic
 * `start + t·(end − start)`; parameter 0 is exactly `start` and 1 exactly `end`.
 */
export type EndpointNeutralSegment = NeutralCurveBase & {
  readonly kind: "line";
  readonly form: "endpointSegment";
  readonly start: SplineVector;
  readonly end: SplineVector;
  readonly sourceDomain: readonly [0, 1];
  /** Increasing active subinterval of [0, 1]. */
  readonly queryDomain?: readonly [number, number];
};

export type NeutralCurve =
  | NumericNeutralLine
  | EndpointNeutralSegment
  | (NeutralCurveBase & {
      readonly kind: "circle";
      readonly center: SplineVector;
      readonly radius: number;
      /** Nonzero radial direction at parameter zero; normalized by the sole evaluator. */
      readonly xAxis: SplineVector;
      readonly sourceDomain: CircleSourceDomain;
      readonly queryDomain?: CircleQueryDomain;
    })
  | (BoundedNeutralCurveBase & {
      readonly kind: "cubicBezier";
      readonly poles: SplinePoles;
      /** The source domain maps affinely to the Bézier local interval [0, 1]. */
    });

export interface NeutralCurveQueryRequest {
  /** The consuming document's authored settings.modelingTolerance. */
  readonly modelingTolerance: number;
  readonly first: NeutralCurve;
  readonly second: NeutralCurve;
}

export interface NeutralCurveSelfIntersectionRequest {
  /** The consuming document's authored settings.modelingTolerance. */
  readonly modelingTolerance: number;
  readonly curve: NeutralCurve;
}

export interface NeutralCurvePointWitness {
  readonly classification: "crossing" | "tangent" | "unclassified";
  readonly firstParameter: number;
  readonly secondParameter: number;
  readonly position: SplineVector;
  /** Identifies the exact or independently verified algorithm establishing contact. */
  readonly proof:
    | {
        readonly kind: "nativeAnalyticCircleIntersection";
        readonly firstParameterBounds: readonly [number, number];
        readonly secondParameterBounds: readonly [number, number];
      }
    | {
        readonly kind: "exactFiniteLineIntersection";
        /**
         * Singleton bounds on the correctly rounded representatives, not root
         * enclosures. Exact rational predicates establish contact before rounding.
         */
        readonly firstParameterBounds: readonly [number, number];
        readonly secondParameterBounds: readonly [number, number];
      }
    | {
        readonly kind: "nativeParametricCurveIntersection";
        /**
         * An isolated native candidate is not semantic proof. These bounds
         * identify a strict sign-change interval that independently proves a
         * transverse line incidence by continuity.
         */
        readonly verification:
          | "boundedTransverseLineIncidence"
          | "exactEndpointLineIncidence";
        readonly firstParameterBounds: readonly [number, number];
        readonly secondParameterBounds: readonly [number, number];
      }
    | {
        readonly kind: "exactImplicitLineRootSet";
        readonly family: "lineCircle" | "lineCubic";
        readonly verification:
          | "exactRoot"
          | "boundedSignChange"
          | "exactMultiplicity";
        /**
         * Exact support-root multiplicity. Required for `exactMultiplicity`.
         * The synchronous constructive certifier always attaches it; other
         * producers may omit it, and absence means unknown, never simple.
         */
        readonly rootMultiplicity?: number;
        /** Every distinct active root is matched once before witnesses return. */
        readonly firstParameterBounds: readonly [number, number];
        readonly secondParameterBounds: readonly [number, number];
      }
    | {
        readonly kind: "exactAlgebraicCurveRootSet";
        readonly family:
          | "circlePair"
          | "circleCubic"
          | "cubicCubic"
          | "cubicSelf";
        /** Multiplicity in the exact support polynomial when applicable. */
        readonly rootMultiplicity?: number;
        /** Outward-containing dyadic enclosures of the exact source parameters. */
        readonly firstParameterBounds: readonly [number, number];
        readonly secondParameterBounds: readonly [number, number];
      }
    | {
        readonly kind: "exactCubicPairRootSet";
        /** Outward-containing dyadic enclosures of the exact source parameters. */
        readonly firstParameterBounds: readonly [number, number];
        readonly secondParameterBounds: readonly [number, number];
        /** Optional outward enclosure in source-parameter derivative units. */
        readonly sourceUnitTangentDeterminantBounds?: readonly [number, number];
      }
    | {
        /** Exact endpoint of the proven same/reversed affine cubic correspondence. */
        readonly kind: "exactStructuralCubicCorrespondenceEndpoint";
        readonly poleOrder: "same" | "reversed";
        readonly firstProvenance: NeutralCurveProvenance;
        readonly secondProvenance: NeutralCurveProvenance;
        readonly firstParameterBounds: readonly [number, number];
        readonly secondParameterBounds: readonly [number, number];
      };
}

export interface NeutralCurveOverlapWitness {
  readonly orientation: "same" | "opposite";
  readonly firstInterval: readonly [number, number];
  readonly secondInterval: readonly [number, number];
  /** Complete correspondence is structural/exact, never inferred from tolerance-defined native segments or sampling. */
  readonly proof:
    | {
        readonly kind: "structuralCubicPoleIdentity";
        readonly poleOrder: "same" | "reversed";
        readonly firstProvenance: NeutralCurveProvenance;
        readonly secondProvenance: NeutralCurveProvenance;
      }
    | {
        readonly kind: "exactCollinearLineOverlap";
        readonly firstProvenance: NeutralCurveProvenance;
        readonly secondProvenance: NeutralCurveProvenance;
      };
}

export type NeutralCurveIsolatedRootFamily =
  | "finiteLinePair"
  | "lineCircle"
  | "lineCubic"
  | "circlePair"
  | "circleCubic"
  | "cubicCubic"
  | "cubicSelf";

export type NeutralCurveCompletenessProof =
  | {
      readonly kind: "completeIsolatedRootSet";
      readonly family: NeutralCurveIsolatedRootFamily;
      readonly distinctRootCount: number;
    }
  | {
      readonly kind: "completeStructuralCorrespondence";
      readonly family: "finiteLinePair" | "structuralCubicOverlap";
      /** Disposition of the exact same/reversed affine correspondence in both active domains. */
      readonly correspondence: "disjoint" | "interval" | "endpoint";
      /** Point witnesses on the correspondence (zero for disjoint/interval, one for an endpoint). */
      readonly correspondencePointCount: 0 | 1;
      /** Complete finite root set away from the represented correspondence. */
      readonly offCorrespondenceDistinctRootCount: number;
    };

export type NeutralCurveQueryResult =
  | {
      /** Every point and overlap carries proof, and this tag certifies completeness. */
      readonly kind: "verified";
      readonly points: readonly NeutralCurvePointWitness[];
      readonly overlaps: readonly NeutralCurveOverlapWitness[];
      readonly completenessProof: NeutralCurveCompletenessProof;
    }
  | {
      readonly kind: "unsupported" | "uncertain";
      readonly code: string;
      readonly message: string;
    };

/** Synchronous, kernel-free dependency for future offset topology work. */
export interface CertifiedNeutralCurveQuery {
  queryPair(request: NeutralCurveQueryRequest): NeutralCurveQueryResult;
  querySelf(
    request: NeutralCurveSelfIntersectionRequest,
  ): NeutralCurveQueryResult;
}

/** Where a declared join sits on one curve. `interior` carries the solver's representative host parameter. */
export type NeutralCurveJoinLocation =
  | "start"
  | "end"
  | { readonly interior: number };

export interface NeutralCurveJoinRequest {
  /** The consuming document's settings.modelingTolerance. Also bounds every join ball. */
  readonly modelingTolerance: number;
  /** Whole source curves: a join query rejects `queryDomain`. */
  readonly first: NeutralCurve;
  readonly second: NeutralCurve;
  /** One or two declared joins between these two curves (a D-shape, a two-span closed spline). */
  readonly joins: readonly {
    readonly first: NeutralCurveJoinLocation;
    readonly second: NeutralCurveJoinLocation;
  }[];
}

export interface NeutralCurveJoinWitness {
  /** Realized join parameters: the declared locations, or the unique contact inside the ball. */
  readonly firstParameter: number;
  readonly secondParameter: number;
  /**
   * Outward source-parameter bounds holding the realized parameters and the
   * at most one contact of the two near pieces, when that contact exists.
   */
  readonly firstParameterBounds: readonly [number, number];
  readonly secondParameterBounds: readonly [number, number];
  /** Realized join position; also the centre of the join ball. */
  readonly position: SplineVector;
  /** Certified radius (≤ modelingTolerance) of the ball around the join that holds both near pieces. */
  readonly ballRadius: number;
  /**
   * `declaredEnds`: the near pieces meet at most once, and never outside the
   * reported bounds (no contact, the exact shared declared point, or an
   * unresolved contact enclosed together with the declared locations). For a
   * join on a reported exact overlap the near pieces instead coincide along
   * that overlap, and the bounds are the declared parameters.
   * `uniqueContactInBall`: exactly one proven contact away from the declared
   * locations (for example a 1e-9 overshoot corner).
   */
  readonly realization: "declaredEnds" | "uniqueContactInBall";
}

export type NeutralCurveJoinResult =
  | {
      readonly kind: "verified";
      /** One witness per declared join, in request order. */
      readonly joins: readonly NeutralCurveJoinWitness[];
      /**
       * Apart from the declared joins, the complete contact set is
       * `points ∪ overlaps`, in the ordinary witness forms. Every point lies
       * outside every join ball.
       */
      readonly points: readonly NeutralCurvePointWitness[];
      /**
       * Non-empty only for the two exact structural families the ordinary
       * owner proves on the whole pair (`exactCollinearLineOverlap`,
       * `structuralCubicPoleIdentity`), passed through unchanged, and only
       * when every declared join lies on the overlap.
       */
      readonly overlaps: readonly NeutralCurveOverlapWitness[];
      readonly completenessProof: {
        readonly kind: "completeOutsideDeclaredJoins";
        readonly joinCount: number;
        readonly distinctRootCount: number;
      };
    }
  | {
      readonly kind: "unsupported" | "uncertain";
      readonly code: string;
      readonly message: string;
    };

/** The kernel-free dispatcher plus its declared-join operation. */
export interface CertifiedNeutralCurveJoinQuery extends CertifiedNeutralCurveQuery {
  queryJoin(request: NeutralCurveJoinRequest): NeutralCurveJoinResult;
}

/**
 * One emitted cubic of a certified tube chain plus the owner proof metadata
 * it was emitted with. The certifier trusts that every field comes from one
 * fresh owner result (caller obligation); metadata presence is not provenance.
 */
export interface NeutralCubicTube {
  /** Emitted binary64 poles E, unchanged. */
  readonly poles: SplinePoles;
  /**
   * Owner certificate ε, a SAME-PARAMETER bound: |E(u) − O(a + u·(b − a))| ≤ ε
   * on the leaf [a, b]. The J2′ composition's parametric-shift argument relies
   * on this form.
   */
  readonly certifiedError: number;
  readonly reference: {
    /** Outward box of the true one-sided offset derivative O′ over the leaf. */
    readonly derivative: readonly [
      readonly [number, number],
      readonly [number, number],
    ];
    /** Binary64 poles of the source span the leaf belongs to. */
    readonly sourcePoles: SplinePoles;
    /** The owner call's signed offset distance d; bitwise equal across one chain. */
    readonly distance: number;
  };
  readonly source: {
    readonly splineId: string;
    readonly spanIndex: number;
    readonly startOccurrenceId: string;
    readonly endOccurrenceId: string;
  };
  /** The leaf [a, b] ⊆ [0, 1] in the source span's local parameter. */
  readonly sourceLocalInterval: readonly [number, number];
}

export interface CubicTubeChainRequest {
  /** The consuming document's authored settings.modelingTolerance. */
  readonly modelingTolerance: number;
  /** Declared joins are (k, k + 1), plus (n − 1, 0) when closed. */
  readonly closed: boolean;
  readonly tubes: readonly NeutralCubicTube[];
}

interface CubicTubeChainJoinBase {
  readonly first: number;
  readonly second: number;
  /** Binary64 cone candidate e; both hodographs and O′ boxes are strictly e-positive. */
  readonly direction: SplineVector;
}

/**
 * Every bound below is outward (up) binary64 and finite: each is dominated by
 * the finite modeling tolerance.
 */
export type CubicTubeChainJoin =
  | (CubicTubeChainJoinBase & {
      /** Exact true-offset endpoint identity O_first(b) = O_second(a). */
      readonly kind: "same-leaf" | "parallel-knot";
    })
  | (CubicTubeChainJoinBase & {
      /**
       * J2′ at a declared smooth source knot with exactly nonzero tangent cross:
       * the one-sided true offsets cross once; the unique crossing X* is
       * RETAINED as the join vertex and only the proved tails beyond it leave
       * the corrected reference.
       */
      readonly kind: "nonparallel-knot";
      readonly side: "concave";
      readonly retainedCrossing: true;
      /** Upper bounds on the removed tails' displacement [first, second]. */
      readonly tail: readonly [number, number];
      /** Upper bounds on the removed leaf-parameter fractions [first, second]. */
      readonly trim: readonly [number, number];
    })
  | (CubicTubeChainJoinBase & {
      /**
       * J2′ convex: the one-sided true offsets are disjoint; the corrected
       * reference inserts the short arc of radius |d| about the source knot.
       */
      readonly kind: "nonparallel-knot";
      readonly side: "convex";
      /** δ⁺ ≥ |A − B|; every arc point lies within δ⁺ of both arc ends. */
      readonly arcDeviation: number;
    });

/** Per-emitted-cubic J2′ report; never conflates the three quantities. */
export interface CubicTubeChainLeaf {
  /** ε* = ε + both end corrections (sum). NOT the full bound on a convex-END leaf. */
  readonly baseErrorStar: number;
  /**
   * Proved sup |E − Φ| against the declared-join-corrected reference O*: exactly
   * the modeling tolerance on a convex-END leaf (arc reserve, slack 0), else ε*.
   */
  readonly displacementBound: number;
  /** K3 radius r = ε + δ⁺ of each convex end (concave tails are never added). */
  readonly clearanceRadius: number;
}

export type CubicTubeChainResult =
  | {
      readonly kind: "verified";
      readonly certificate: {
        readonly joins: readonly CubicTubeChainJoin[];
        /** Present only for a single open span. */
        readonly isolatedSpanDirection?: SplineVector;
        /** One entry per tube, in request order. */
        readonly leaves: readonly CubicTubeChainLeaf[];
        /** Every non-join pair, each separated by more than r_i + r_j. */
        readonly clearedPairs: readonly (readonly [number, number])[];
        readonly maxSplits: number;
      };
    }
  | {
      /**
       * Uncertain never asserts that the true geometry is unstable: a failed
       * clearance only means the certified error tubes are not proved apart.
       */
      readonly kind: "unsupported" | "uncertain";
      readonly code: string;
      readonly message: string;
      readonly first?: number;
      readonly second?: number;
    };

/**
 * Synchronous, kernel-free topology-stability certificate of one emitted cubic
 * chain against its owner's error tubes. A separate proof kind from root-set
 * queries: exact contact structure at declared joins; separation elsewhere.
 * The tube reference is the declared-join-corrected true offset O*, not the
 * raw union of one-sided offsets.
 */
export interface CertifiedCubicTubeChain {
  certifyChain(request: CubicTubeChainRequest): CubicTubeChainResult;
}

/**
 * One emitted offset line of a piece chain (natural order). The certifier
 * trusts that `emitted` are the literal raw resolver supports and that
 * `source`/`distance` come from the same fresh adapter call (caller
 * obligation). The true offset is O(t) = A₀ + t(A₁ − A₀) + d·ν, ν the unit
 * left normal of A₁ − A₀; nothing is rounded into a line identity.
 */
export interface NeutralLineTube {
  /** Literal emitted segment ends Ê₀, Ê₁: parameter 0 and 1 of the query support. */
  readonly emitted: readonly [SplineVector, SplineVector];
  /** Source segment ends A₀, A₁. */
  readonly source: readonly [SplineVector, SplineVector];
  /** Owner signed distance of this piece's natural direction (left positive). */
  readonly distance: number;
}

/** A cubic tube plus the stored binary64 query domain its witnesses use. */
export interface NeutralCubicPieceTube extends NeutralCubicTube {
  /** The resolver's `sourceDomain` for this cubic (the owner `sourceInterval`). */
  readonly queryDomain: readonly [number, number];
}

/** One traversal piece, always in natural data order (never re-ordered). */
export type TubeChainPiece =
  | {
      readonly kind: "cubic";
      readonly reversed: boolean;
      readonly tubes: readonly NeutralCubicPieceTube[];
    }
  | {
      readonly kind: "line";
      readonly reversed: boolean;
      readonly tube: NeutralLineTube;
    };

/**
 * A resolver trim joint between traversal pieces i and i + 1 (the wrap last).
 * Bounds are the stored conservative root enclosures of the joint witness in
 * each terminal curve's query parameter (first = traversal-first piece).
 */
export interface TubeChainTrimDeclaration {
  readonly jointIndex: number;
  readonly firstParameterBounds: readonly [number, number];
  readonly secondParameterBounds: readonly [number, number];
}

export interface PieceTubeChainRequest {
  /** The consuming document's authored settings.modelingTolerance. */
  readonly modelingTolerance: number;
  readonly closed: boolean;
  /** Chain distance d; piece i's owner distance is bitwise reversed ? −d : d. */
  readonly distance: number;
  readonly pieces: readonly TubeChainPiece[];
  /** One per inter-piece adjacency (n − 1 open, n closed), in traversal order. */
  readonly trims: readonly TubeChainTrimDeclaration[];
}

/**
 * Lemma-T trim at a concave line↔cubic or line↔line joint. The certificate
 * concerns ONLY the abstract chain trimmed at the exact (unknown) witnessed
 * roots of `jointIndex`: bounds enclose the TRUE-offset roots, outward, in each
 * leaf's natural parameter (Bézier τ, or segment t). No representative
 * parameter or position is claimed; rounded emitted ends are NOT claimed to
 * connect (emitted representation and JVP remain a later batch's obligation).
 */
export interface TubeChainTrimJoin {
  readonly kind: "trim";
  readonly jointIndex: number;
  /** Flattened leaf indices (traversal-first piece's terminal leaf first). */
  readonly first: number;
  readonly second: number;
  /** Which side carries the Lemma-T line ℓ. */
  readonly line: "first" | "second";
  /** Fixed sign s in the other leaf's natural parameter: s·rot(a)·B′ > 0. */
  readonly orientation: 1 | -1;
  readonly firstRootBounds: readonly [number, number];
  readonly secondRootBounds: readonly [number, number];
  /** Upper bound M·δ on the removed-tail parameter-shift displacement. */
  readonly tail: number;
}

export type TubePieceChainJoin = CubicTubeChainJoin | TubeChainTrimJoin;

/** Leaves are flattened per piece in traversal order, natural order inside a piece. */
export type TubePieceChainResult =
  | {
      readonly kind: "verified";
      readonly certificate: {
        readonly joins: readonly TubePieceChainJoin[];
        readonly isolatedSpanDirection?: SplineVector;
        readonly leaves: readonly CubicTubeChainLeaf[];
        readonly clearedPairs: readonly (readonly [number, number])[];
        readonly maxSplits: number;
      };
    }
  | Exclude<CubicTubeChainResult, { readonly kind: "verified" }>;

/**
 * Multi-piece tube certificate: one exact meter per request. A single cubic
 * piece without trims is exactly `certifyChain`.
 */
export interface CertifiedTubePieceChain {
  certifyPieceChain(request: PieceTubeChainRequest): TubePieceChainResult;
}

export interface NeutralCurveQueryCapability {
  queryNeutralCurves(
    request: NeutralCurveQueryRequest,
  ): Promise<NeutralCurveQueryResult>;
  /** Explicit operation: pairing two copies of one basis is not a self query. */
  queryNeutralCurveSelfIntersections(
    request: NeutralCurveSelfIntersectionRequest,
  ): Promise<NeutralCurveQueryResult>;
  /**
   * Declared-join pairs; ordinary pair queries on joined curves are
   * pathological (T09 probe). Documented limits, all failing closed:
   * - a join on a full-turn circle is `unsupported`;
   * - tangential cubic/cubic joins without a bitwise-shared point are
   *   `uncertain`;
   * - exact overlaps are admitted only for collinear line pairs (numeric lines
   *   and endpoint segments) and structural same-support cubics (identical
   *   poles) with every join on the overlap;
   *   same-support arcs/circles and other cubic overlaps are `uncertain`;
   * - a contact on a boundary between two certificate pieces is `uncertain`
   *   `join-contact-not-distinct`;
   * - the join ball radius is modelingTolerance / 2, so a contact between
   *   that and modelingTolerance from a join is reported in `points`;
   * - a whole-request subdivision visit safeguard beside the proof budget
   *   returns `uncertain` `join-separation-unresolved`.
   */
  queryNeutralCurveJoin(
    request: NeutralCurveJoinRequest,
  ): Promise<NeutralCurveJoinResult>;
}

const ZERO_POLES: SplinePoles = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];

function finiteVector(value: SplineVector | undefined) {
  return (
    Array.isArray(value) &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  );
}

function validDomain(domain: readonly [number, number]) {
  return (
    Number.isFinite(domain[0]) &&
    Number.isFinite(domain[1]) &&
    domain[1] > domain[0] &&
    Number.isFinite(domain[1] - domain[0])
  );
}

export function getNeutralCurveActiveSearchBounds(
  curve: NeutralCurve,
): readonly [number, number] {
  if (curve.kind !== "circle") return curve.queryDomain ?? curve.sourceDomain;
  const angular = validateCircleAngularDomain(
    curve.sourceDomain,
    curve.queryDomain,
  );
  return angular
    ? getCircleAngularSearchBounds(angular)
    : [Number.NaN, Number.NaN];
}

/** Tests the selected winding; a full turn owns its lower seam, never its upper copy. */
export function neutralCurveSourceParameterInside(
  curve: NeutralCurve,
  parameter: number,
) {
  if (curve.kind !== "circle") {
    return neutralCurveParameterInside(
      parameter,
      curve.queryDomain ?? curve.sourceDomain,
    );
  }
  const angular = validateCircleAngularDomain(
    curve.sourceDomain,
    curve.queryDomain,
  );
  return angular
    ? circleParameterInsideAngularDomain(angular, parameter)
    : false;
}

/** The sole circle-basis normalization used by neutral evaluation and OCC construction. */
export function getNeutralCircleUnitXAxis(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
): SplineVector {
  const length = Math.hypot(circle.xAxis[0], circle.xAxis[1]);
  return [circle.xAxis[0] / length, circle.xAxis[1] / length];
}

export function neutralCurveParameterInside(
  parameter: number,
  domain: readonly [number, number],
) {
  return (
    Number.isFinite(parameter) &&
    parameter >= domain[0] &&
    parameter <= domain[1]
  );
}

function unitVector(value: SplineVector) {
  if (!finiteVector(value)) return false;
  const length = Math.hypot(value[0], value[1]);
  return Number.isFinite(length) && Math.abs(length - 1) <= Number.EPSILON * 8;
}

function nonzeroDirection(value: SplineVector) {
  return finiteVector(value) && (value[0] !== 0 || value[1] !== 0);
}

function validCurveGeometry(curve: NeutralCurve) {
  if (curve.kind === "line") {
    if (curve.form === undefined) {
      return finiteVector(curve.origin) && unitVector(curve.direction);
    }
    return (
      curve.form === "endpointSegment" &&
      finiteVector(curve.start) &&
      finiteVector(curve.end) &&
      // Binary64 differences are evaluation-only; exact code subtracts exactly.
      Number.isFinite(curve.end[0] - curve.start[0]) &&
      Number.isFinite(curve.end[1] - curve.start[1]) &&
      (curve.start[0] !== curve.end[0] || curve.start[1] !== curve.end[1]) &&
      curve.sourceDomain[0] === 0 &&
      curve.sourceDomain[1] === 1
    );
  }
  if (curve.kind === "circle") {
    return (
      finiteVector(curve.center) &&
      Number.isFinite(curve.radius) &&
      curve.radius > 0 &&
      nonzeroDirection(curve.xAxis)
    );
  }
  return curve.poles.every(finiteVector);
}

export function validateNeutralCurveQueryRequest(
  request: NeutralCurveQueryRequest,
): NeutralCurveQueryResult | null {
  const curves = [request.first, request.second] as const;
  const valid =
    Number.isFinite(request.modelingTolerance) &&
    request.modelingTolerance > 0 &&
    curves.every((curve) => {
      if (curve.kind === "circle") {
        return (
          validateCircleAngularDomain(curve.sourceDomain, curve.queryDomain) !==
            null && validCurveGeometry(curve)
        );
      }
      const active = getNeutralCurveActiveSearchBounds(curve);
      return (
        validDomain(curve.sourceDomain) &&
        validDomain(active) &&
        neutralCurveParameterInside(active[0], curve.sourceDomain) &&
        neutralCurveParameterInside(active[1], curve.sourceDomain) &&
        validCurveGeometry(curve)
      );
    });
  return valid
    ? null
    : {
        kind: "uncertain",
        code: "invalid-neutral-curve-query",
        message:
          "Neutral queries require finite geometry, unit directions or exact distinct segment endpoints, positive radii and tolerance, and finite increasing bounded domains.",
      };
}

/**
 * The source parameter of one declared join location, or null when the
 * location is invalid: a full turn has no ends, and an interior location must
 * be finite and strictly inside the source domain.
 */
export function getNeutralCurveJoinParameter(
  curve: NeutralCurve,
  location: NeutralCurveJoinLocation,
): number | null {
  const domain =
    curve.kind !== "circle"
      ? curve.sourceDomain
      : curve.sourceDomain.kind === "arc"
        ? curve.sourceDomain.interval
        : null;
  if (location === "start") return domain ? domain[0] : null;
  if (location === "end") return domain ? domain[1] : null;
  if (
    typeof location !== "object" ||
    location === null ||
    !Number.isFinite(location.interior)
  )
    return null;
  if (!domain) {
    return neutralCurveSourceParameterInside(curve, location.interior)
      ? location.interior
      : null;
  }
  return location.interior > domain[0] && location.interior < domain[1]
    ? location.interior
    : null;
}

export function validateNeutralCurveJoinRequest(
  request: NeutralCurveJoinRequest,
): NeutralCurveJoinResult | null {
  const valid =
    validateNeutralCurveQueryRequest(request) === null &&
    request.first.queryDomain === undefined &&
    request.second.queryDomain === undefined &&
    Array.isArray(request.joins) &&
    (request.joins.length === 1 || request.joins.length === 2) &&
    request.joins.every(
      (join) =>
        typeof join === "object" &&
        join !== null &&
        getNeutralCurveJoinParameter(request.first, join.first) !== null &&
        getNeutralCurveJoinParameter(request.second, join.second) !== null,
    );
  return valid
    ? null
    : {
        kind: "uncertain",
        code: "invalid-neutral-curve-join-query",
        message:
          "Join queries require a valid neutral pair without query domains, a positive finite tolerance, and one or two joins at curve ends or strictly interior source parameters.",
      };
}

/** Evaluates each curve in its documented source-parameter units. */
export function evaluateNeutralCurve(
  curve: NeutralCurve,
  sourceParameter: number,
): SplineVector {
  if (!neutralCurveSourceParameterInside(curve, sourceParameter)) {
    throw new RangeError(
      "Neutral curve parameter is outside its source domain",
    );
  }
  if (curve.kind === "line" && curve.form === "endpointSegment") {
    if (sourceParameter === 0) return [curve.start[0], curve.start[1]];
    if (sourceParameter === 1) return [curve.end[0], curve.end[1]];
    return [
      curve.start[0] + sourceParameter * (curve.end[0] - curve.start[0]),
      curve.start[1] + sourceParameter * (curve.end[1] - curve.start[1]),
    ];
  }
  if (curve.kind === "line") {
    return [
      curve.origin[0] + curve.direction[0] * sourceParameter,
      curve.origin[1] + curve.direction[1] * sourceParameter,
    ];
  }
  if (curve.kind === "circle") {
    const cosine = Math.cos(sourceParameter);
    const sine = Math.sin(sourceParameter);
    const xAxis = getNeutralCircleUnitXAxis(curve);
    const yAxis: SplineVector = [-xAxis[1], xAxis[0]];
    return [
      curve.center[0] + curve.radius * (xAxis[0] * cosine + yAxis[0] * sine),
      curve.center[1] + curve.radius * (xAxis[1] * cosine + yAxis[1] * sine),
    ];
  }
  return evaluateSplineSpan(
    {
      interval: curve.sourceDomain,
      poles: curve.poles,
      differential: { interval: [0, 0], poles: ZERO_POLES },
    },
    { kind: "source", value: sourceParameter },
  ).position;
}

/** Evaluates through the sole curve evaluator in a translated local frame. */
export function evaluateNeutralCurveInFrame(
  curve: NeutralCurve,
  sourceParameter: number,
  frameOrigin: SplineVector,
): SplineVector {
  const translate = (point: SplineVector): SplineVector => [
    point[0] - frameOrigin[0],
    point[1] - frameOrigin[1],
  ];
  if (curve.kind === "line" && curve.form === "endpointSegment") {
    return evaluateNeutralCurve(
      { ...curve, start: translate(curve.start), end: translate(curve.end) },
      sourceParameter,
    );
  }
  if (curve.kind === "line") {
    return evaluateNeutralCurve(
      { ...curve, origin: translate(curve.origin) },
      sourceParameter,
    );
  }
  if (curve.kind === "circle") {
    return evaluateNeutralCurve(
      { ...curve, center: translate(curve.center) },
      sourceParameter,
    );
  }
  const poles: SplinePoles = [
    translate(curve.poles[0]),
    translate(curve.poles[1]),
    translate(curve.poles[2]),
    translate(curve.poles[3]),
  ];
  return evaluateNeutralCurve({ ...curve, poles }, sourceParameter);
}

/** A translation-independent geometric scale used by bounded query proofs. */
export function getNeutralCurveLocalScale(curve: NeutralCurve) {
  if (curve.kind === "circle") return Math.max(1, curve.radius);
  if (curve.kind === "line") {
    const domain = getNeutralCurveActiveSearchBounds(curve);
    return Math.max(1, domain[1] - domain[0]);
  }
  let diameter = 0;
  for (const first of curve.poles) {
    for (const second of curve.poles) {
      diameter = Math.max(
        diameter,
        Math.hypot(first[0] - second[0], first[1] - second[1]),
      );
    }
  }
  return Math.max(1, diameter);
}

/**
 * Checks that native parameters re-evaluate consistently. This is not contact
 * proof: only the named native algorithms may create point witnesses.
 */
function curveEvaluationScaleInFrame(
  curve: NeutralCurve,
  sourceParameter: number,
  frameOrigin: SplineVector,
) {
  const coordinateScale = (point: SplineVector) =>
    Math.max(
      Math.abs(point[0] - frameOrigin[0]),
      Math.abs(point[1] - frameOrigin[1]),
    );
  if (curve.kind === "line" && curve.form === "endpointSegment") {
    return Math.max(
      1,
      coordinateScale(curve.start),
      coordinateScale(curve.end),
    );
  }
  if (curve.kind === "line") {
    return Math.max(
      1,
      coordinateScale(curve.origin),
      Math.abs(sourceParameter * curve.direction[0]),
      Math.abs(sourceParameter * curve.direction[1]),
    );
  }
  if (curve.kind === "circle") {
    return Math.max(1, coordinateScale(curve.center), curve.radius);
  }
  return Math.max(1, ...curve.poles.map(coordinateScale));
}

export function checkNeutralCurvePointConsistency(
  request: NeutralCurveQueryRequest,
  witness: NeutralCurvePointWitness,
): NeutralCurveQueryResult | null {
  if (
    !finiteVector(witness.position) ||
    !neutralCurveParameterInside(
      witness.firstParameter,
      getNeutralCurveActiveSearchBounds(request.first),
    ) ||
    !neutralCurveSourceParameterInside(request.first, witness.firstParameter) ||
    !neutralCurveParameterInside(
      witness.secondParameter,
      getNeutralCurveActiveSearchBounds(request.second),
    ) ||
    !neutralCurveSourceParameterInside(request.second, witness.secondParameter)
  ) {
    return {
      kind: "uncertain",
      code: "neutral-curve-witness-out-of-domain",
      message:
        "Native point witness does not preserve both active source domains.",
    };
  }
  if (
    "firstParameterBounds" in witness.proof &&
    (!neutralCurveParameterInside(
      witness.firstParameter,
      witness.proof.firstParameterBounds,
    ) ||
      !neutralCurveParameterInside(
        witness.secondParameter,
        witness.proof.secondParameterBounds,
      ))
  ) {
    return {
      kind: "uncertain",
      code: "neutral-curve-witness-outside-proof-bounds",
      message:
        "Point parameters are outside the bounded incidence certificate.",
    };
  }
  const first = evaluateNeutralCurveInFrame(
    request.first,
    witness.firstParameter,
    witness.position,
  );
  const second = evaluateNeutralCurveInFrame(
    request.second,
    witness.secondParameter,
    witness.position,
  );
  const bound =
    Number.EPSILON *
    Math.max(
      curveEvaluationScaleInFrame(
        request.first,
        witness.firstParameter,
        witness.position,
      ),
      curveEvaluationScaleInFrame(
        request.second,
        witness.secondParameter,
        witness.position,
      ),
    ) *
    64;
  const residual = Math.hypot(first[0] - second[0], first[1] - second[1]);
  const parameterMotionBound = (
    curve: NeutralCurve,
    parameter: number,
    parameterBounds: readonly [number, number],
  ) =>
    curve.kind === "circle"
      ? curve.radius *
        Math.max(
          Math.abs(parameter - parameterBounds[0]),
          Math.abs(parameterBounds[1] - parameter),
        )
      : 0;
  const firstMotion = parameterMotionBound(
    request.first,
    witness.firstParameter,
    witness.proof.firstParameterBounds,
  );
  const secondMotion = parameterMotionBound(
    request.second,
    witness.secondParameter,
    witness.proof.secondParameterBounds,
  );
  const firstReportedResidual = Math.hypot(first[0], first[1]);
  const secondReportedResidual = Math.hypot(second[0], second[1]);
  return residual <= bound + firstMotion + secondMotion &&
    firstReportedResidual <= bound + firstMotion &&
    secondReportedResidual <= bound + secondMotion
    ? null
    : {
        kind: "uncertain",
        code: "neutral-curve-witness-residual",
        message:
          "Native point parameters failed translation-independent source-curve consistency checking.",
      };
}
