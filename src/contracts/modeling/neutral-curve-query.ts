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

export type NeutralCurve =
  | (BoundedNeutralCurveBase & {
      readonly kind: "line";
      readonly origin: SplineVector;
      /** Unit vector. The source parameter is signed model-space distance. */
      readonly direction: SplineVector;
    })
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

/**
 * One emitted cubic of a certified tube chain plus the owner proof metadata
 * it was emitted with. The certifier trusts that every field comes from one
 * fresh owner result (caller obligation); metadata presence is not provenance.
 */
export interface NeutralCubicTube {
  /** Emitted binary64 poles E, unchanged. */
  readonly poles: SplinePoles;
  /** Owner certificate ε: |E(u) − O(a + u·(b − a))| ≤ ε on the leaf [a, b]. */
  readonly certifiedError: number;
  readonly reference: {
    /** Outward box of the true one-sided offset derivative O′ over the leaf. */
    readonly derivative: readonly [
      readonly [number, number],
      readonly [number, number],
    ];
    /** Binary64 poles of the source span the leaf belongs to. */
    readonly sourcePoles: SplinePoles;
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

export interface CubicTubeChainJoin {
  readonly first: number;
  readonly second: number;
  /** How the exact true-offset endpoint identity O_first(b) = O_second(a) is proved. */
  readonly kind: "same-leaf" | "parallel-knot";
  /** Binary64 cone candidate e; both hodographs and O′ boxes are strictly e-positive. */
  readonly direction: SplineVector;
}

export type CubicTubeChainResult =
  | {
      readonly kind: "verified";
      readonly certificate: {
        readonly joins: readonly CubicTubeChainJoin[];
        /** Present only for a single open span. */
        readonly isolatedSpanDirection?: SplineVector;
        /** Every non-join pair, each separated by more than ε_i + ε_j. */
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
 * queries: it proves simplicity and separation, never contact.
 */
export interface CertifiedCubicTubeChain {
  certifyChain(request: CubicTubeChainRequest): CubicTubeChainResult;
}

export interface NeutralCurveQueryCapability {
  queryNeutralCurves(
    request: NeutralCurveQueryRequest,
  ): Promise<NeutralCurveQueryResult>;
  /** Explicit operation: pairing two copies of one basis is not a self query. */
  queryNeutralCurveSelfIntersections(
    request: NeutralCurveSelfIntersectionRequest,
  ): Promise<NeutralCurveQueryResult>;
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
    return finiteVector(curve.origin) && unitVector(curve.direction);
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
          "Neutral queries require finite geometry, unit directions, positive radii and tolerance, and finite increasing bounded domains.",
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
