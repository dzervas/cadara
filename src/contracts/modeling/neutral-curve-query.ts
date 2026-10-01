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
        /**
         * Multiplicity in the exact support polynomial when applicable. For
         * `circleCubic` that polynomial is the circle's implicit equation
         * along the cubic. For `circlePair` it is the first circle's implicit
         * equation along the two circles' radical line, which meets the first
         * circle exactly in their common points. In both, a multiple root
         * proves a shared tangent line (see `neutralCurveWitnessProvesTangency`).
         * Absence means unknown, never simple.
         */
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
    /**
     * Endpoint-local split of `certifiedError` (owner Q4-E1 metadata), outward
     * binary64 upper bounds R = `hermiteRemainder` and πᵢ = `polePerturbations`
     * (natural pole order) with, in the emitted Bézier parameter τ ∈ [0, 1]
     * and Bᵢ the cubic Bernstein basis, the same-parameter bound
     * |E(τ) − O(a + τ(b − a))| ≤ Σᵢ Bᵢ(τ)·πᵢ + 16R·τ²(1 − τ)² on the leaf
     * [a, b]. It refines `certifiedError` pointwise and never replaces it:
     * the certifier uses it only on a vertex sub-window of a terminal leaf.
     * Absent on persisted, projected or fabricated spans; the local branch
     * then fails closed with the leaf-wide result.
     */
    readonly localError?: {
      readonly hermiteRemainder: number;
      readonly polePerturbations: readonly [number, number, number, number];
    };
  };
  readonly source: {
    readonly splineId: string;
    readonly spanIndex: number;
    readonly startOccurrenceId: string;
    readonly endOccurrenceId: string;
    /**
     * Canonical point IDs of the source span's ends (`SplineSpan.source`).
     * Read only by declared-vertex admission; absent ⇒ no vertex is admitted.
     */
    readonly startPointId?: string;
    readonly endPointId?: string;
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
  /**
   * ε* = ε + both end corrections (sum). NOT the full bound on a convex-END
   * leaf. On a leaf of a `graph-trim` it is instead the S2 max-form sup bound
   * up(max(ε + c_far, G_own, w_other)): the far-end corrected error, the glue
   * bound of its own side and the OTHER side's vertical deviation (switch-
   * region points map onto the other piece). Rounded up, it may exceed the
   * leaf's displacementBound = τ by an ulp; both are valid upper bounds.
   */
  readonly baseErrorStar: number;
  /**
   * Proved sup |E − Φ| against the declared-join-corrected reference O*: exactly
   * the modeling tolerance on a convex-END leaf (arc reserve, slack 0), on
   * a `graph-trim` leaf (strict glue reserve), on an F1 arc leaf (its
   * collapsed radial connectors: strict ε < τ plus the η reserve) and on
   * every T08b-f seed-arc or circle leaf (the same convention), else ε*.
   */
  readonly displacementBound: number;
  /** K3 radius r = ε + δ⁺ of each convex end (concave tails are never added). */
  readonly clearanceRadius: number;
  /**
   * T08b-g5d (U-G6): a cubic leaf wholly removed by a deep trim (a leaf
   * strictly between its piece's traversal-terminal leaf and the trim leaf).
   * It is not part of the certified emitted chain E: no displacement claim
   * (its bounds are its owner ε, reported only). Absent on every other leaf.
   */
  readonly removed?: true;
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
      /**
       * Present (true) only on a trim failure (`trim-window-unproven`,
       * `trim-composition-unproven`, `trim-existence-unproven`) raised by a
       * bound-versus-budget comparison (root reach, retained domain, t < 1,
       * vertical deviation, Lemma-X margins, collar, glue, corrected error).
       * Never on a sign, cone, side, classification, structural, square-root
       * or budget failure. The offset-chain SEL flips only on it (R1); the
       * flip is justified by the independent re-certification of the
       * absorbed chain, never by this flag.
       */
      readonly magnitude?: true;
      /**
       * Piece path only (T08b-e [TECH E2]): the declared arcs this failure is
       * attributable to, ascending (arc admission, Lemma-A ε, the arc-entry
       * / arc-exit / bridge cones, or K3 clearance of a pair containing one
       * of its arc leaves or its two neighbour leaves). Produced by the
       * certifier only; a missing or wrong tag can only prevent the SEL's
       * absorption fallback, which is independently re-certified.
       */
      readonly arcJoints?: readonly number[];
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
  /** Canonical point IDs of the source ends (declared-vertex admission only). */
  readonly startPointId?: string;
  readonly endPointId?: string;
}

/** A cubic tube plus the stored binary64 query domain its witnesses use. */
export interface NeutralCubicPieceTube extends NeutralCubicTube {
  /** The resolver's `sourceDomain` for this cubic (the owner `sourceInterval`). */
  readonly queryDomain: readonly [number, number];
}

/**
 * One emitted seed-arc offset piece (T08b-f), natural order. The certifier
 * trusts that `emitted` are the literal resolver supports (the legacy
 * ray-scaled ends S′, E′, or an adopted neighbour pole) and that `source`,
 * `center` and `distance` come from the same fresh adapter call, bitwise the
 * solve frame's POINT-DEFINED seed arc (E3 / review R8); it checks
 * `radius` = hypot(S′ − C) and `sourceRadius` = hypot(S − C) bitwise (the
 * canonical support formula, E7) and certifies both as given (E9).
 *
 * Reference R′ ([TECH] F1, review R10 wording, binding): "At a point-defined
 * seed arc, O* is the true offset of the circle through each end's radius
 * r_V (|V − C| at a declared-join end, the canonical ρ_s at a trimmed or
 * chain-terminal end), joined at one interior sub-arc knot by a radial step
 * of length |r_E − r_S|. It realizes the arc's declared end incidences
 * within τ, is measured exactly, and fails closed unless ε < τ." (Ledger:
 * circles through the arc's declared ends with r_V = |V − C| at declared-join
 * ends and ρ_s at trimmed or chain-terminal ends, plus a vertical radial step
 * of length |r_E − r_S| at an interior knot; it realizes the arc's own
 * declared end-point incidence within τ, measured exactly, and is not
 * undeclared healing.)
 *
 * Emitted: the circle (C, ρ_o) over the exact wedge from a = S′ − C to b =
 * E′ − C, split by rule B′ (`seedArcLeafSplits`, recomputed by the
 * certifier), plus a never-drawn straight realization segment at every
 * untrimmed end: radial [S′, Ŝ] to its own pole, or, next to another seed arc
 * or an F1 arc, the direct segment between the two consumer ends (Lemma W).
 * Consumers join by point identity and draw from rounded `atan2` angles,
 * which are NOT certified (the T08b-e R4 non-claim).
 */
export interface NeutralArcTube {
  /** Bitwise the seed arc's solved centre point C. */
  readonly center: SplineVector;
  /** Emitted radius ρ_o = hypot(S′ − C) (checked bitwise; E7/E9). */
  readonly radius: number;
  /** Emitted natural ends S′, E′ (the published arc's start and end). */
  readonly emitted: readonly [SplineVector, SplineVector];
  /** Source natural ends S, E (the seed's point positions). */
  readonly source: readonly [SplineVector, SplineVector];
  /** Canonical source radius ρ_s = hypot(S − C) (checked bitwise). */
  readonly sourceRadius: number;
  /** Natural sweep σ_s of the seed arc (left offset radius r − σ_s·d). */
  readonly sweep: "clockwise" | "counterClockwise";
  /** Owner signed distance of this piece's natural direction (left positive). */
  readonly distance: number;
  /** Canonical point IDs of the source ends (declared-vertex admission only). */
  readonly startPointId?: string;
  readonly endPointId?: string;
  /**
   * Review R7: leaves [at the natural start, at the natural end] wholly
   * removed because the joint root lies beyond them; nonzero only at a
   * trimmed end, whose first retained leaf then starts at a split direction.
   */
  readonly removed?: readonly [number, number];
}

/**
 * One closed emitted circle offset piece ([TECH] F11): the circle entity
 * (C, r) offset to the reference radius r − d (counter-clockwise traversal,
 * so left is inward) and emitted with radius fl(r − d), checked bitwise and
 * certified as given. Eight fixed exact leaves; no ends, no joins.
 */
export interface NeutralCircleTube {
  readonly center: SplineVector;
  /** fl(sourceRadius − distance), the published circle radius. */
  readonly radius: number;
  readonly sourceRadius: number;
  readonly distance: number;
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
    }
  | {
      readonly kind: "arc";
      readonly reversed: boolean;
      readonly tube: NeutralArcTube;
    }
  | {
      readonly kind: "circle";
      /** Must be false (checked): a circle is traversed counter-clockwise. */
      readonly reversed: boolean;
      readonly tube: NeutralCircleTube;
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
  /**
   * Required (and checked like a vertex's) only when both terminals belong to
   * ONE closed piece: the intrinsic positional closure (T08b-d T7).
   */
  readonly authority?: TubeChainVertexAuthority;
  /**
   * T08b-g5d (U-G6): the trim leaf of each side, counted in leaves from that
   * piece's traversal terminal (the vertex leaf) inward: the leaves before it
   * are removed. Absent means 0 (the terminal leaf; every pre-g5d request).
   * Only a cubic side may be deep, inside the terminal leaf's source span.
   * Never trusted: it only names the leaf the certifier must prove the trim
   * on (the stored bounds through that leaf's `queryDomain`), and every
   * removed leaf is re-proved (window cone, or the deep S2 covering).
   */
  readonly firstLeafOffset?: number;
  readonly secondLeafOffset?: number;
}

/**
 * Declared authority of one adjacency, checked by the certifier itself on
 * point IDs, bitwise source vertices and structure only (never coordinates
 * proximity): one shared canonical point, a direct coincident constraint
 * between two distinct terminal IDs, or the intrinsic positional closure of
 * one spline (same point ID, distinct occurrences, spans n − 1 → 0).
 */
export type TubeChainVertexAuthority =
  | { readonly kind: "shared-point"; readonly pointId: string }
  | {
      readonly kind: "coincident";
      readonly pointIds: readonly [string, string];
    }
  | { readonly kind: "positional-closure"; readonly pointId: string };

/**
 * A declared vertex at adjacency `jointIndex` (T08b-d): the two traversal
 * terminal leaves share one emitted pole bitwise. `keeper` names the piece
 * whose own emitted pole it is and which carries the whole correction path;
 * soundness does not depend on the label (each leaf's ε is an honest bound
 * of its own emitted leaf, ending at the shared pole), so a forged label can
 * only make verification fail.
 */
export interface TubeChainVertexDeclaration {
  readonly jointIndex: number;
  readonly authority: TubeChainVertexAuthority;
  readonly keeper: "first" | "second";
}

/**
 * F1 arc join at a convex declared vertex (T08b-e, user decision U2): a true
 * offset arc about the incoming terminal source vertex P_v from A′ to B′,
 * the two neighbours' OWN free emitted terminal poles (read by the certifier
 * from the terminal leaves, never supplied, so J0 holds by construction).
 * The certifier checks the authority exactly as a vertex's (C5), the centre
 * bitwise, the sweep against the exact turn and certifies the arc with the
 * radius AS GIVEN (finite, > 0; the trust model of ε [TECH E9]): consumer
 * agreement with it is the caller's obligation (`canonicalArcSupport`).
 */
export interface TubeChainArcDeclaration {
  readonly jointIndex: number;
  readonly authority: TubeChainVertexAuthority;
  /** Must be bitwise the traversal-incoming piece's terminal source vertex. */
  readonly center: SplineVector;
  readonly radius: number;
  /** The exact source turn σ = sign(u₁ × u₂): counter-clockwise iff σ > 0. */
  readonly sweep: "clockwise" | "counterClockwise";
}

export interface PieceTubeChainRequest {
  /** The consuming document's authored settings.modelingTolerance. */
  readonly modelingTolerance: number;
  readonly closed: boolean;
  /** Chain distance d; piece i's owner distance is bitwise reversed ? −d : d. */
  readonly distance: number;
  readonly pieces: readonly TubeChainPiece[];
  /**
   * Trims, `vertices` and `arcs` share ONE index space, the declared
   * adjacency index (0 … n − 2 open, the wrap n − 1 when closed; a single
   * closed piece has the one adjacency 0): every adjacency is covered
   * exactly once, each list strictly increasing. Without `vertices` and
   * `arcs` every adjacency is a trim.
   */
  readonly trims: readonly TubeChainTrimDeclaration[];
  readonly vertices?: readonly TubeChainVertexDeclaration[];
  readonly arcs?: readonly TubeChainArcDeclaration[];
}

/**
 * Lemma-T trim at a concave line↔cubic or line↔line joint. The certificate
 * concerns ONLY the abstract chain trimmed at the exact (unknown) witnessed
 * roots of `jointIndex`: bounds enclose the TRUE-offset roots, outward, in each
 * leaf's natural parameter (Bézier τ, or segment t). No representative
 * parameter or position is claimed; rounded emitted ends are NOT claimed to
 * connect (emitted representation and JVP remain a later batch's obligation).
 *
 * T08b-g5d (U-G6, Lemma T-W): the cubic side may be deep, its trim leaf an
 * inner leaf of the terminal source span (`firstLeafOffset` /
 * `secondLeafOffset` > 0). Then Lemma T runs on the trim leaf and the window
 * cone s·rot(a)·O′ > 0 (the same s) on every removed leaf, so the true offset
 * meets the full support line of ℓ once on the window. Reference [TECH]
 * R_C″, read joint-locally (math review A1): at a declared coincident or
 * shared-point line↔cubic join that passes H2 in a solver-accepted frame, O*
 * is the two pieces' true offsets, each trimmed at the unique common point of
 * the two joined pieces' true offsets over the joint window. Removed leaves
 * carry no claim against other pieces (they are neither in E nor in O*).
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
  /** T08b-g5d: the proved trim-leaf offsets (present only when > 0). */
  readonly firstLeafOffset?: number;
  readonly secondLeafOffset?: number;
}

/**
 * S2 graph trim at a concave cubic↔cubic joint (terminal leaves, or since
 * T08b-g5d deep trim leaves inside the terminal source span). Both
 * terminal leaves are e-graphs (emitted hodograph and true O′ box strictly
 * e-positive); the certificate concerns ONLY the abstract chain trimmed at the
 * exact (unknown) witnessed root of `jointIndex`, against the two pieces' true
 * offsets each trimmed at their unique common point. Bounds enclose the TRUE-
 * offset root, outward, in each leaf's natural Bézier τ. No representative
 * parameter or position is claimed; rounded emitted ends are NOT claimed to
 * connect (emitted representation and JVP remain a later batch's obligation).
 */
export interface TubeChainGraphTrimJoin {
  readonly kind: "graph-trim";
  readonly jointIndex: number;
  /** Flattened leaf indices (traversal-first piece's terminal leaf first). */
  readonly first: number;
  readonly second: number;
  /** Binary64 graph direction e (sum of the two traversal chords). */
  readonly direction: SplineVector;
  readonly firstRootBounds: readonly [number, number];
  readonly secondRootBounds: readonly [number, number];
  /** σ, outward down: the proved true-slope separation on the vertex windows. */
  readonly separation: number;
  /**
   * T08b-g5d deep S2: the proved trim-leaf offsets (present only when > 0)
   * and the Lemma-C glue fractions [first, second] measured from each trim
   * leaf's vertex side (present only when one is not ½: 1 − 2⁻ᵏ, k ≥ 2,
   * tried only after k = 1 failed its collar).
   */
  readonly firstLeafOffset?: number;
  readonly secondLeafOffset?: number;
  readonly glue?: readonly [number, number];
}

interface TubeChainVertexJoinBase {
  readonly jointIndex: number;
  /** Flattened traversal terminal leaves (traversal-first piece's first). */
  readonly first: number;
  readonly second: number;
  /** Binary64 K1 cone e of the vertex pair (traversal-signed chord sum). */
  readonly direction: SplineVector;
  readonly authority: TubeChainVertexAuthority["kind"];
  readonly keeper: "first" | "second";
  /** |g|⁺ outward, g = Q_v − P_v the declared source gap; exactly 0 when g = 0. */
  readonly bridge: number;
  /**
   * T08b-f, present only with a seed-arc side: the emitted realization
   * segment between the two consumer ends. `vertical` (e·v = 0 exactly: the
   * radial connector on the ray C → Z, [TECH] F5, or two ends on one exact
   * line through Z) or `steep` (Lemma W1/W2 on the rationalized segment).
   */
  readonly realization?: "vertical" | "steep";
}

/**
 * Declared vertex (T08b-d, U1 absorption), reference O* per the [TECH] R7
 * record: the gap-free reference (Q translated by −g, Lemma B) plus a
 * straight bridge of the exact declared source gap g at the declared join.
 * This realizes a declared join within τ under the standing declared-joins
 * decision; it requires e·g ≥ 0 and Lemma G's bound, and fails closed
 * otherwise. Exact contact structure at declared joins, a certified bridge of
 * the declared residual, separation elsewhere. Every point of O* lies on a
 * true offset of a declared piece, on K + d·n about the source vertex K (the
 * convex arc), or on the bridge of vector g. Both emitted terminal leaves
 * end at one bitwise pole and are K1 e-graphs meeting only there.
 */
export type TubeChainVertexJoin =
  | (TubeChainVertexJoinBase & {
      /** Exactly parallel traversal tangents (X = 0, D > 0): O_P(1) + g = O_Q(0). */
      readonly kind: "parallel-vertex";
    })
  | (TubeChainVertexJoinBase & {
      readonly kind: "nonparallel-vertex";
      readonly side: "convex";
      /** δ⁺ ≥ |A − A′| (tight Lemma-G normal term), the arc part of the path. */
      readonly arcDeviation: number;
    })
  | (TubeChainVertexJoinBase & {
      readonly kind: "nonparallel-vertex";
      readonly side: "concave";
      readonly retainedCrossing: true;
      /** Upper bounds on the removed tails' displacement [first, second]. */
      readonly tail: readonly [number, number];
      /** Upper bounds on the removed leaf-parameter fractions [first, second]. */
      readonly trim: readonly [number, number];
    });

/**
 * The joins of one F1 arc (T08b-e). Reference O* at the convex vertex (R7
 * with the arc macroscopic): O_P (untrimmed) ∪ arc(P_v, |d|; A → B°,
 * orientation σ) ∪ [B°, B] ∪ O_Q (untrimmed), A = P_v + dN₁, B = Q_v + dN₂,
 * B° = B − g, g = Q_v − P_v the exact declared gap (the bridge is empty when
 * g = 0). Every point lies on a declared piece's true offset, on K + d·n
 * about the source vertex K = P_v, or on the bridge of vector g.
 *
 * The certified emitted piece is E_v = [A′, Â] ∪ Ĉ ∪ [B̂, B′], Ĉ the arc of
 * centre V = P_v and the GIVEN radius ρ over the exact end directions â =
 * (A′ − V)/|A′ − V| and b̂ (Â = V + ρâ, B̂ = V + ρb̂). The radial connectors
 * (lengths ≤ `entryConnector`, `exitConnector`) are never drawn: consumers
 * realize the joins by point identity (the arc's start and end ARE the
 * neighbours' end points), as for every point-defined arc. Consumers draw
 * the arc from binary64 `atan2` angles of A′ − V and B′ − V, whose end
 * directions differ from â and b̂ by implementation-approximated ulps: that
 * is NOT certified (the trust model of every binary64 arc).
 *
 * `direction` is the binary64 nearest of the exact cone e (informational):
 * σ·rot(A′ − V) at the entry, σ·rot(s) at the knot, σ·rot(B′ − V) at the
 * exit. `tangentDeviation` is up(tan α) of the angle α between the arc's end
 * tangent and the neighbour's emitted end control (exact |a·h|/|a×h|): G1 to
 * rounding at gap-free joins, ≈ |g|/|d| at a coincident join with gap g.
 * Reported only, never gated (no tangency is claimed).
 */
export type TubeChainArcJoin =
  | {
      readonly kind: "arc-entry";
      readonly jointIndex: number;
      /** The incoming piece's terminal leaf, then the first arc leaf. */
      readonly first: number;
      readonly second: number;
      readonly direction: SplineVector;
      readonly tangentDeviation: number;
      /** T08b-f: `steep` when the neighbour is a seed arc (Lemma W junction). */
      readonly realization?: "steep" | "vertical";
    }
  | {
      /** The exact split s = a + b of a two-sub-arc arc. */
      readonly kind: "arc-knot";
      readonly jointIndex: number;
      readonly first: number;
      readonly second: number;
      readonly direction: SplineVector;
    }
  | {
      readonly kind: "arc-exit";
      readonly jointIndex: number;
      /** The last arc leaf, then the outgoing piece's terminal leaf. */
      readonly first: number;
      readonly second: number;
      readonly direction: SplineVector;
      readonly tangentDeviation: number;
      /** |g|⁺ outward; exactly 0 when g = 0. */
      readonly bridge: number;
      /** T08b-f: `steep` when the neighbour is a seed arc (Lemma W junction). */
      readonly realization?: "steep" | "vertical";
    };

/** One certified F1 arc (T08b-e); see `TubeChainArcJoin` for its meaning. */
export interface TubeChainArcRecord {
  readonly jointIndex: number;
  readonly authority: TubeChainVertexAuthority["kind"];
  /** Flattened arc leaves (after every piece leaf, in adjacency order). */
  readonly leaves: readonly number[];
  readonly center: SplineVector;
  readonly radius: number;
  readonly sweep: "clockwise" | "counterClockwise";
  /** Lemma-A ε per arc leaf, outward up (each strictly below τ). */
  readonly epsilon: readonly number[];
  /** u_A⁺ = up(|ρ² − |A′ − V|²|/ρ) ≥ the entry connector length. */
  readonly entryConnector: number;
  /** γ_B⁺ = up(|ρ² − |B′ − V|²|/ρ) ≥ the exit connector length. */
  readonly exitConnector: number;
}

/**
 * Lemma-T° trim (T08b-f) at a concave joint with a seed-arc terminal leaf:
 * the `circle` side's reference circle K = (C, R) is the implicit side, the
 * other terminal leaf B (line, cubic or seed-arc leaf) the explicit one. The
 * certificate concerns ONLY the abstract chain trimmed at the exact
 * (unknown) witnessed roots, against the two pieces' true offsets each
 * trimmed at their unique common point (unique against the FULL circle K and
 * the full emitted circle, R3), never the binary64 angle domain of the query.
 */
export interface TubeChainArcTrimJoin {
  readonly kind: "arc-trim";
  readonly jointIndex: number;
  /** Flattened leaf indices (traversal-first piece's terminal leaf first). */
  readonly first: number;
  readonly second: number;
  /** Which side's reference circle is the implicit side. */
  readonly circle: "first" | "second";
  /**
   * Outward true-root bounds in the natural parameter of each non-arc side
   * (segment t or Bézier τ); absent on a seed-arc side, whose cut is `cut`.
   */
  readonly firstRootBounds?: readonly [number, number];
  readonly secondRootBounds?: readonly [number, number];
  /**
   * Per side, the chord bound R⁺·c of the arc cut, c ≥ the unit-direction
   * distance between the emitted and the true root seen from the arc centre
   * (hull of both cut wedges); 0 on a non-arc side.
   */
  readonly cut: readonly [number, number];
  /** Upper bound on the non-arc side's removed-tail displacement (0 if none). */
  readonly tail: number;
}

/** A natural join between consecutive leaves of one seed arc or circle (F7). */
export interface TubeChainSeedKnotJoin {
  readonly kind: "seed-arc-knot";
  readonly piece: number;
  readonly first: number;
  readonly second: number;
}

/** One certified seed-arc or circle piece (T08b-f). */
export interface TubeChainSeedArcRecord {
  readonly piece: number;
  readonly kind: "arc" | "circle";
  /** Flattened retained leaves, natural order. */
  readonly leaves: readonly number[];
  readonly center: SplineVector;
  readonly radius: number;
  /**
   * Review R12 (option c): every emitted radius in [lo, hi] is certified;
   * [radius, radius] unless the natural start is trimmed, where hi − radius
   * and radius − lo bound |hypot(X − C) − ρ_o| over binary64 X one ulp
   * around the stored emitted root box (a publisher must check its radius
   * lies inside).
   */
  readonly radiusFamily: readonly [number, number];
  /** Lemma A-R ε per retained leaf, outward (each strictly below τ). */
  readonly epsilon: readonly number[];
  /** |r_E − r_S|⁺, the reference step's length (0 when r_S = r_E exactly). */
  readonly step: number;
  /** √-free |λ_S|⁺, |λ_E|⁺ of the radial gaps |V − C| − ρ_s (0 on a circle). */
  readonly radialGaps: readonly [number, number];
  /** u⁺ of the radial realization connectors at the natural ends (0 if none). */
  readonly connectors: readonly [number, number];
  /** Leaves removed by deep trims [natural start, natural end] (R7). */
  readonly removed: readonly [number, number];
}

export type TubePieceChainJoin =
  | CubicTubeChainJoin
  | TubeChainTrimJoin
  | TubeChainGraphTrimJoin
  | TubeChainVertexJoin
  | TubeChainArcJoin
  | TubeChainArcTrimJoin
  | TubeChainSeedKnotJoin;

/**
 * Leaves are flattened per piece in traversal order, natural order inside a
 * piece (a seed arc's retained rule-B′ leaves, a circle's eight); F1 arc
 * leaves follow every piece leaf, in adjacency order ([TECH E3]).
 */
export type TubePieceChainResult =
  | {
      readonly kind: "verified";
      readonly certificate: {
        readonly joins: readonly TubePieceChainJoin[];
        readonly isolatedSpanDirection?: SplineVector;
        readonly leaves: readonly CubicTubeChainLeaf[];
        readonly clearedPairs: readonly (readonly [number, number])[];
        readonly maxSplits: number;
        /** Present only when the request declared arcs. */
        readonly arcs?: readonly TubeChainArcRecord[];
        /** Present only when the request has seed-arc or circle pieces. */
        readonly seedArcs?: readonly TubeChainSeedArcRecord[];
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

/**
 * Staged whole-request certifier meter (T08b-d SEL, review R9): ONE budget
 * for at most `attempts` certifications of one offset chain, never reset,
 * replaced or topped up. Attempt k may use at most k·m times the production
 * ceilings in total, where m = min(⌈leaves/32⌉, 128) is fixed by attempt 1
 * (T08b-f1 [TECH] F12, cap F12a; so attempt 1 behaves exactly as
 * `certifyPieceChain`);
 * every retry k ≥ 2 is charged a fixed entry before any work; exhaustion is
 * sticky; issuing more than `attempts` requests is a `RangeError`.
 */
export interface CertifiedTubePieceChainRequests {
  openRequest(attempts: number): CertifiedTubePieceChain;
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

/**
 * The witness proves the two curves share their tangent line there. This is
 * part of the capability contract: every producer must honour these proof
 * meanings. `unclassified` alone proves nothing: an endpoint, stationary or boundary
 * contact may be a shallow crossing.
 * - `tangent`: even multiplicity at a regular point, or a single circle-pair root.
 * - A structural same-support cubic correspondence end.
 * - A multiple root of the exact support polynomial of a pair with a line or
 *   circle side (line/circle, line/cubic, circle/cubic, circle pair).
 *   - Line/circle, line/cubic and circle/cubic: the polynomial is the
 *     circle's implicit equation along the line, the line's along the cubic,
 *     or the circle's along the cubic. A multiple root is a zero of its
 *     derivative, so the moving curve's tangent lies along the line or
 *     circle there, unless that curve's derivative vanishes. The order step
 *     certifies a nonzero derivative on every half-edge at the vertex before
 *     it sorts.
 *   - Circle pair: the polynomial is the first circle's implicit equation
 *     along the two circles' radical line, not along the other circle. That
 *     line meets the first circle exactly in the common points, so a double
 *     root means the circles meet once, and they are tangent.
 *   This holds at a full circle's seam or an active end too, which the
 *   certifier leaves `unclassified`.
 * Cubic/cubic and cubic self roots are excluded: their multiplicity lives in
 * a resultant, where a transversal crossing can be multiple.
 */
export function neutralCurveWitnessProvesTangency(
  point: NeutralCurvePointWitness,
): boolean {
  if (point.classification === "tangent") return true;
  const proof = point.proof;
  if (proof.kind === "exactStructuralCubicCorrespondenceEndpoint") return true;
  const lineOrCircleSide =
    (proof.kind === "exactAlgebraicCurveRootSet" &&
      (proof.family === "circlePair" || proof.family === "circleCubic")) ||
    proof.kind === "exactImplicitLineRootSet";
  return lineOrCircleSide && (proof.rootMultiplicity ?? 1) >= 2;
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
