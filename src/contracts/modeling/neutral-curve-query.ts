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
  /** Increasing source-parameter interval. Query parameters always use these units. */
  readonly sourceDomain: readonly [number, number];
  /** Increasing active subinterval in the same source-parameter units. */
  readonly queryDomain?: readonly [number, number];
  readonly provenance: NeutralCurveProvenance;
}

export type NeutralCurve =
  | (NeutralCurveBase & {
      readonly kind: "line";
      readonly origin: SplineVector;
      /** Unit vector. The source parameter is signed model-space distance. */
      readonly direction: SplineVector;
    })
  | (NeutralCurveBase & {
      readonly kind: "circle";
      readonly center: SplineVector;
      readonly radius: number;
      /** Unit radial direction at parameter zero. Parameters are unwrapped radians. */
      readonly xAxis: SplineVector;
    })
  | (NeutralCurveBase & {
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
  /** Identifies the native algorithm that established semantic contact. */
  readonly proof:
    | { readonly kind: "nativeAnalyticCircleIntersection" }
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
      };
}

export interface NeutralCurveOverlapWitness {
  readonly orientation: "same" | "opposite";
  readonly firstInterval: readonly [number, number];
  readonly secondInterval: readonly [number, number];
  /**
   * Complete correspondence was derived from exact cubic poles and their
   * affine source domains, not from native segment endpoints or sampling.
   */
  readonly proof: {
    readonly kind: "structuralCubicPoleIdentity";
    readonly poleOrder: "same" | "reversed";
    readonly firstProvenance: NeutralCurveProvenance;
    readonly secondProvenance: NeutralCurveProvenance;
  };
}

export type NeutralCurveQueryResult =
  | {
      /** Every point has native semantic proof; every overlap has structural proof. */
      readonly kind: "verified";
      readonly points: readonly NeutralCurvePointWitness[];
      readonly overlaps: readonly NeutralCurveOverlapWitness[];
    }
  | {
      readonly kind: "unsupported" | "uncertain";
      readonly code: string;
      readonly message: string;
    };

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

export function getNeutralCurveActiveDomain(curve: NeutralCurve) {
  return curve.queryDomain ?? curve.sourceDomain;
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

function validCurveGeometry(curve: NeutralCurve) {
  if (curve.kind === "line") {
    return finiteVector(curve.origin) && unitVector(curve.direction);
  }
  if (curve.kind === "circle") {
    return (
      finiteVector(curve.center) &&
      Number.isFinite(curve.radius) &&
      curve.radius > 0 &&
      unitVector(curve.xAxis) &&
      curve.sourceDomain[1] - curve.sourceDomain[0] <= Math.PI * 2
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
      const active = getNeutralCurveActiveDomain(curve);
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
  if (!neutralCurveParameterInside(sourceParameter, curve.sourceDomain)) {
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
    const yAxis: SplineVector = [-curve.xAxis[1], curve.xAxis[0]];
    return [
      curve.center[0] +
        curve.radius * (curve.xAxis[0] * cosine + yAxis[0] * sine),
      curve.center[1] +
        curve.radius * (curve.xAxis[1] * cosine + yAxis[1] * sine),
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
    const domain = getNeutralCurveActiveDomain(curve);
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
      getNeutralCurveActiveDomain(request.first),
    ) ||
    !neutralCurveParameterInside(
      witness.secondParameter,
      getNeutralCurveActiveDomain(request.second),
    )
  ) {
    return {
      kind: "uncertain",
      code: "neutral-curve-witness-out-of-domain",
      message:
        "Native point witness does not preserve both active source domains.",
    };
  }
  if (
    witness.proof.kind === "nativeParametricCurveIntersection" &&
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
        "Native point parameters are outside the bounded incidence certificate.",
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
  const reportedResidual = Math.max(
    Math.hypot(first[0], first[1]),
    Math.hypot(second[0], second[1]),
  );
  return residual <= bound && reportedResidual <= bound
    ? null
    : {
        kind: "uncertain",
        code: "neutral-curve-witness-residual",
        message:
          "Native point parameters failed translation-independent source-curve consistency checking.",
      };
}

function sameVector(first: SplineVector, second: SplineVector) {
  return first[0] === second[0] && first[1] === second[1];
}

type ExactFraction = {
  readonly numerator: bigint;
  readonly denominator: bigint;
};

function exactFractionFromFiniteDouble(value: number): ExactFraction {
  if (value === 0) return { numerator: 0n, denominator: 1n };
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  const exponentBits = (high >>> 20) & 0x7ff;
  const fractionBits = (BigInt(high & 0xfffff) << 32n) | BigInt(low);
  const significand =
    exponentBits === 0 ? fractionBits : (1n << 52n) | fractionBits;
  const exponent = (exponentBits === 0 ? -1022 : exponentBits - 1023) - 52;
  let numerator = high >>> 31 === 0 ? significand : -significand;
  let denominator = 1n;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);
  return { numerator, denominator };
}

function subtractExact(
  first: ExactFraction,
  second: ExactFraction,
): ExactFraction {
  return {
    numerator:
      first.numerator * second.denominator -
      second.numerator * first.denominator,
    denominator: first.denominator * second.denominator,
  };
}

function addExact(first: ExactFraction, second: ExactFraction): ExactFraction {
  return {
    numerator:
      first.numerator * second.denominator +
      second.numerator * first.denominator,
    denominator: first.denominator * second.denominator,
  };
}

function multiplyExact(
  first: ExactFraction,
  second: ExactFraction,
): ExactFraction {
  return {
    numerator: first.numerator * second.numerator,
    denominator: first.denominator * second.denominator,
  };
}

function roundedIntegerQuotient(numerator: bigint, denominator: bigint) {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const comparison = remainder * 2n - denominator;
  return comparison > 0n || (comparison === 0n && quotient % 2n !== 0n)
    ? quotient + 1n
    : quotient;
}

/** Correctly rounds an exact rational to binary64 without first overflowing either term. */
function exactFractionToNumber(value: ExactFraction) {
  if (value.numerator === 0n) return 0;
  const negative = value.numerator < 0n !== value.denominator < 0n;
  const numerator = value.numerator < 0n ? -value.numerator : value.numerator;
  const denominator =
    value.denominator < 0n ? -value.denominator : value.denominator;
  const bitLength = (integer: bigint) => integer.toString(2).length;
  let exponent = bitLength(numerator) - bitLength(denominator);
  const belowPower =
    exponent >= 0
      ? numerator < denominator << BigInt(exponent)
      : numerator << BigInt(-exponent) < denominator;
  if (belowPower) exponent -= 1;

  let rounded: number;
  if (exponent < -1022) {
    const significand = roundedIntegerQuotient(numerator << 1074n, denominator);
    rounded = Number(significand) * Number.MIN_VALUE;
  } else {
    const shift = 52 - exponent;
    const significand = roundedIntegerQuotient(
      shift >= 0 ? numerator << BigInt(shift) : numerator,
      shift >= 0 ? denominator : denominator << BigInt(-shift),
    );
    rounded = Number(significand) * 2 ** (exponent - 52);
  }
  return negative ? -rounded : rounded;
}

function mapNormalizedExactToDomain(
  normalized: ExactFraction,
  domain: readonly [number, number],
  reversed: boolean,
) {
  const start = exactFractionFromFiniteDouble(reversed ? domain[1] : domain[0]);
  const length = subtractExact(
    exactFractionFromFiniteDouble(domain[1]),
    exactFractionFromFiniteDouble(domain[0]),
  );
  const offset = multiplyExact(normalized, length);
  return exactFractionToNumber(
    reversed ? subtractExact(start, offset) : addExact(start, offset),
  );
}

function normalizedExact(
  parameter: number,
  domain: readonly [number, number],
): ExactFraction {
  const offset = subtractExact(
    exactFractionFromFiniteDouble(parameter),
    exactFractionFromFiniteDouble(domain[0]),
  );
  const length = subtractExact(
    exactFractionFromFiniteDouble(domain[1]),
    exactFractionFromFiniteDouble(domain[0]),
  );
  return {
    numerator: offset.numerator * length.denominator,
    denominator: offset.denominator * length.numerator,
  };
}

function compareExact(first: ExactFraction, second: ExactFraction) {
  const difference =
    first.numerator * second.denominator - second.numerator * first.denominator;
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

function reverseExact(value: ExactFraction): ExactFraction {
  return {
    numerator: value.denominator - value.numerator,
    denominator: value.denominator,
  };
}

export function haveExactStructuralCubicBasis(
  first: NeutralCurve,
  second: NeutralCurve,
) {
  if (first.kind !== "cubicBezier" || second.kind !== "cubicBezier") {
    return false;
  }
  return (
    first.poles.every((pole, index) =>
      sameVector(pole, second.poles[index]!),
    ) ||
    first.poles.every((pole, index) =>
      sameVector(pole, second.poles[3 - index]!),
    )
  );
}

function exactStructuralCubicOverlap(
  first: NeutralCurve,
  second: NeutralCurve,
) {
  if (first.kind !== "cubicBezier" || second.kind !== "cubicBezier") {
    return null;
  }
  const same = first.poles.every((pole, index) =>
    sameVector(pole, second.poles[index]!),
  );
  const reversed = first.poles.every((pole, index) =>
    sameVector(pole, second.poles[3 - index]!),
  );
  if (!same && !reversed) return null;

  const firstActive = getNeutralCurveActiveDomain(first);
  const secondActive = getNeutralCurveActiveDomain(second);
  const firstLocal = firstActive.map((parameter) =>
    normalizedExact(parameter, first.sourceDomain),
  ) as [ExactFraction, ExactFraction];
  const secondLocal = secondActive.map((parameter) =>
    normalizedExact(parameter, second.sourceDomain),
  ) as [ExactFraction, ExactFraction];
  const secondInFirstBasis: readonly [ExactFraction, ExactFraction] = reversed
    ? [reverseExact(secondLocal[1]), reverseExact(secondLocal[0])]
    : secondLocal;
  const lowerFromFirst =
    compareExact(firstLocal[0], secondInFirstBasis[0]) >= 0;
  const upperFromFirst =
    compareExact(firstLocal[1], secondInFirstBasis[1]) <= 0;
  const lower = lowerFromFirst ? firstLocal[0] : secondInFirstBasis[0];
  const upper = upperFromFirst ? firstLocal[1] : secondInFirstBasis[1];
  if (compareExact(lower, upper) >= 0) return null;
  return {
    firstActive,
    secondActive,
    reversed,
    lowerFromFirst,
    upperFromFirst,
    lower,
    upper,
  };
}

export function hasExactStructuralCubicActiveOverlap(
  first: NeutralCurve,
  second: NeutralCurve,
) {
  return exactStructuralCubicOverlap(first, second) !== null;
}

/**
 * The only overlap constructor. Exact pole equality proves the entire cubic
 * interior and its affine basis correspondence. The returned interval is the
 * strict intersection of both active ranges in that common basis; no endpoint
 * proximity or native segment label can enlarge it.
 */
export function proveStructuralCubicOverlap(
  first: NeutralCurve,
  second: NeutralCurve,
): NeutralCurveOverlapWitness | null {
  const overlap = exactStructuralCubicOverlap(first, second);
  if (!overlap) return null;
  const {
    firstActive,
    secondActive,
    reversed,
    lowerFromFirst,
    upperFromFirst,
    lower,
    upper,
  } = overlap;
  const firstInterval: readonly [number, number] = [
    lowerFromFirst
      ? firstActive[0]
      : mapNormalizedExactToDomain(lower, first.sourceDomain, false),
    upperFromFirst
      ? firstActive[1]
      : mapNormalizedExactToDomain(upper, first.sourceDomain, false),
  ];
  const secondLowerFromOwnBoundary = reversed
    ? !upperFromFirst
    : !lowerFromFirst;
  const secondUpperFromOwnBoundary = reversed
    ? !lowerFromFirst
    : !upperFromFirst;
  const secondInterval: readonly [number, number] = reversed
    ? [
        secondUpperFromOwnBoundary
          ? secondActive[1]
          : mapNormalizedExactToDomain(lower, second.sourceDomain, true),
        secondLowerFromOwnBoundary
          ? secondActive[0]
          : mapNormalizedExactToDomain(upper, second.sourceDomain, true),
      ]
    : [
        secondLowerFromOwnBoundary
          ? secondActive[0]
          : mapNormalizedExactToDomain(lower, second.sourceDomain, false),
        secondUpperFromOwnBoundary
          ? secondActive[1]
          : mapNormalizedExactToDomain(upper, second.sourceDomain, false),
      ];
  const firstValid =
    firstInterval.every(Number.isFinite) &&
    firstInterval[1] > firstInterval[0] &&
    firstInterval.every((parameter) =>
      neutralCurveParameterInside(parameter, firstActive),
    );
  const secondValid =
    secondInterval.every(Number.isFinite) &&
    Math.abs(secondInterval[1] - secondInterval[0]) > 0 &&
    secondInterval.every((parameter) =>
      neutralCurveParameterInside(parameter, secondActive),
    );
  if (!firstValid || !secondValid) return null;
  return {
    orientation: reversed ? "opposite" : "same",
    firstInterval,
    secondInterval,
    proof: {
      kind: "structuralCubicPoleIdentity",
      poleOrder: reversed ? "reversed" : "same",
      firstProvenance: first.provenance,
      secondProvenance: second.provenance,
    },
  };
}
