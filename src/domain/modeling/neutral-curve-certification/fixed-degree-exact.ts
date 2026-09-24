import {
  checkNeutralCurvePointConsistency,
  evaluateNeutralCurve,
  getNeutralCurveActiveSearchBounds,
  neutralCurveParameterInside,
  neutralCurveSourceParameterInside,
  type NeutralCurve,
  type NeutralCurveCompletenessProof,
  type NeutralCurveIsolatedRootFamily,
  type NeutralCurveOverlapWitness,
  type NeutralCurvePointWitness,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
} from "@/contracts/modeling/neutral-curve-query";
import type { SplineVector } from "@/contracts/sketch/spline-geometry";
import {
  certifySinCos,
  type CertifiedInterval,
} from "@/domain/modeling/neutral-curve-certification/certified-trig";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  addExact,
  compareExact,
  countDistinctRoots,
  divideExact,
  exactFromNumber as exactFractionFromFiniteDouble,
  exactToNumber as exactFractionToNumber,
  isolateDistinctRootsClosed,
  multiplyExact,
  negateExact,
  nextBinary64,
  outwardExactNumber,
  polynomialAdd,
  polynomialDerivative,
  polynomialEvaluate,
  polynomialMultiply,
  polynomialTrim,
  reduceExact as reducedExact,
  subtractExact,
  type ExactFraction,
  type ExactPolynomial,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

export { ExactQueryProofBudgetExceeded } from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

type VerifiedNeutralCurveResult = Extract<
  NeutralCurveQueryResult,
  { readonly kind: "verified" }
>;

function pointMatchesIsolatedFamily(
  point: NeutralCurvePointWitness,
  family: NeutralCurveIsolatedRootFamily,
) {
  switch (family) {
    case "finiteLinePair":
      return point.proof.kind === "exactFiniteLineIntersection";
    case "lineCircle":
    case "lineCubic":
      return (
        point.proof.kind === "exactImplicitLineRootSet" &&
        point.proof.family === family
      );
    case "circlePair":
      return (
        point.proof.kind === "nativeAnalyticCircleIntersection" ||
        (point.proof.kind === "exactAlgebraicCurveRootSet" &&
          point.proof.family === family)
      );
    case "cubicCubic":
      return (
        point.proof.kind === "exactCubicPairRootSet" ||
        (point.proof.kind === "exactAlgebraicCurveRootSet" &&
          point.proof.family === family)
      );
    case "circleCubic":
    case "cubicSelf":
      return (
        point.proof.kind === "exactAlgebraicCurveRootSet" &&
        point.proof.family === family
      );
  }
}

function isStructuralCubicEndpoint(point: NeutralCurvePointWitness) {
  return (
    point.classification === "unclassified" &&
    point.proof.kind === "exactStructuralCubicCorrespondenceEndpoint" &&
    point.firstParameter === point.proof.firstParameterBounds[0] &&
    point.firstParameter === point.proof.firstParameterBounds[1] &&
    point.secondParameter === point.proof.secondParameterBounds[0] &&
    point.secondParameter === point.proof.secondParameterBounds[1]
  );
}

export function admitVerifiedNeutralCurveResult(
  request: NeutralCurveQueryRequest,
  points: readonly NeutralCurvePointWitness[],
  overlaps: readonly NeutralCurveOverlapWitness[],
  completenessProof: NeutralCurveCompletenessProof,
  budget: ExactProofBudget,
  queryKind: "pair" | "self",
): VerifiedNeutralCurveResult {
  budget.operation(16 + points.length * 8 + overlaps.length * 8);
  const expectedIsolatedFamily: NeutralCurveIsolatedRootFamily | null =
    queryKind === "self"
      ? request.first.kind === "cubicBezier" &&
        request.second.kind === "cubicBezier" &&
        request.first === request.second
        ? "cubicSelf"
        : null
      : request.first.kind === "line" && request.second.kind === "line"
        ? "finiteLinePair"
        : (request.first.kind === "line" && request.second.kind === "circle") ||
            (request.first.kind === "circle" && request.second.kind === "line")
          ? "lineCircle"
          : (request.first.kind === "line" &&
                request.second.kind === "cubicBezier") ||
              (request.first.kind === "cubicBezier" &&
                request.second.kind === "line")
            ? "lineCubic"
            : request.first.kind === "circle" &&
                request.second.kind === "circle"
              ? "circlePair"
              : (request.first.kind === "circle" &&
                    request.second.kind === "cubicBezier") ||
                  (request.first.kind === "cubicBezier" &&
                    request.second.kind === "circle")
                ? "circleCubic"
                : request.first.kind === "cubicBezier" &&
                    request.second.kind === "cubicBezier"
                  ? "cubicCubic"
                  : null;
  const sameProvenance = (
    first: NeutralCurve["provenance"],
    second: NeutralCurve["provenance"],
  ) =>
    first.sourceEntityId === second.sourceEntityId &&
    first.sourceSpanId === second.sourceSpanId;
  const finiteOrderedBounds = (bounds: readonly [number, number]) =>
    Number.isFinite(bounds[0]) &&
    Number.isFinite(bounds[1]) &&
    bounds[0] <= bounds[1];
  const firstActive = getNeutralCurveActiveSearchBounds(request.first);
  const secondActive = getNeutralCurveActiveSearchBounds(request.second);
  const contained = (
    bounds: readonly [number, number],
    active: readonly [number, number],
  ) => bounds[0] >= active[0] && bounds[1] <= active[1];
  const structuralPoleOrder = (() => {
    const { first, second } = request;
    if (first.kind !== "cubicBezier" || second.kind !== "cubicBezier")
      return null;
    if (
      first.poles.every((pole, index) => sameVector(pole, second.poles[index]!))
    )
      return "same";
    return first.poles.every((pole, index) =>
      sameVector(pole, second.poles[3 - index]!),
    )
      ? "reversed"
      : null;
  })();
  const normalizedCubicBounds = (
    curve: Extract<NeutralCurve, { kind: "cubicBezier" }>,
    bounds: readonly [number, number],
    reverse: boolean,
  ): readonly [ExactFraction, ExactFraction] => {
    const lower = normalizedExact(bounds[0], curve.sourceDomain, budget);
    const upper = normalizedExact(bounds[1], curve.sourceDomain, budget);
    return reverse
      ? [reverseExact(upper, budget), reverseExact(lower, budget)]
      : [lower, upper];
  };
  const structuralCorrespondenceDisposition = (() => {
    if (
      structuralPoleOrder === null ||
      request.first.kind !== "cubicBezier" ||
      request.second.kind !== "cubicBezier"
    )
      return null;
    const first = normalizedCubicBounds(request.first, firstActive, false);
    const second = normalizedCubicBounds(
      request.second,
      secondActive,
      structuralPoleOrder === "reversed",
    );
    const lower =
      compareExact(first[0], second[0], budget) >= 0 ? first[0] : second[0];
    const upper =
      compareExact(first[1], second[1], budget) <= 0 ? first[1] : second[1];
    const comparison = compareExact(lower, upper, budget);
    return comparison < 0
      ? "interval"
      : comparison === 0
        ? "endpoint"
        : "disjoint";
  })();
  const pointBoxExcludesStructuralCorrespondence = (
    point: NeutralCurvePointWitness,
  ) => {
    if (
      request.first.kind !== "cubicBezier" ||
      request.second.kind !== "cubicBezier" ||
      structuralPoleOrder === null
    )
      return false;
    const first = normalizedCubicBounds(
      request.first,
      point.proof.firstParameterBounds,
      false,
    );
    const second = normalizedCubicBounds(
      request.second,
      point.proof.secondParameterBounds,
      structuralPoleOrder === "reversed",
    );
    return (
      compareExact(first[1], second[0], budget) < 0 ||
      compareExact(second[1], first[0], budget) < 0
    );
  };
  const pointBoxesValid = points.every((point) => {
    const firstBounds = point.proof.firstParameterBounds;
    const secondBounds = point.proof.secondParameterBounds;
    const proofMatchesRequest =
      point.proof.kind !== "exactStructuralCubicCorrespondenceEndpoint" ||
      (point.proof.poleOrder === structuralPoleOrder &&
        sameProvenance(point.proof.firstProvenance, request.first.provenance) &&
        sameProvenance(
          point.proof.secondProvenance,
          request.second.provenance,
        ));
    return (
      proofMatchesRequest &&
      finiteOrderedBounds(firstBounds) &&
      finiteOrderedBounds(secondBounds) &&
      contained(firstBounds, firstActive) &&
      contained(secondBounds, secondActive) &&
      neutralCurveParameterInside(point.firstParameter, firstBounds) &&
      neutralCurveParameterInside(point.secondParameter, secondBounds) &&
      checkNeutralCurvePointConsistency(request, point) === null
    );
  });
  const boxesDisjoint = points.every((point, index) =>
    points.slice(index + 1).every((other) => {
      const first = point.proof.firstParameterBounds;
      const otherFirst = other.proof.firstParameterBounds;
      const second = point.proof.secondParameterBounds;
      const otherSecond = other.proof.secondParameterBounds;
      return (
        first[1] < otherFirst[0] ||
        otherFirst[1] < first[0] ||
        second[1] < otherSecond[0] ||
        otherSecond[1] < second[0]
      );
    }),
  );
  const overlapsValid = overlaps.every((overlap) => {
    const firstOrdered =
      Number.isFinite(overlap.firstInterval[0]) &&
      Number.isFinite(overlap.firstInterval[1]) &&
      overlap.firstInterval[0] < overlap.firstInterval[1];
    const secondOrdered =
      Number.isFinite(overlap.secondInterval[0]) &&
      Number.isFinite(overlap.secondInterval[1]) &&
      (overlap.orientation === "same"
        ? overlap.secondInterval[0] < overlap.secondInterval[1]
        : overlap.secondInterval[0] > overlap.secondInterval[1]);
    const secondAscending = [
      Math.min(...overlap.secondInterval),
      Math.max(...overlap.secondInterval),
    ] as const;
    const proofMatches =
      sameProvenance(overlap.proof.firstProvenance, request.first.provenance) &&
      sameProvenance(
        overlap.proof.secondProvenance,
        request.second.provenance,
      ) &&
      (overlap.proof.kind !== "structuralCubicPoleIdentity" ||
        (overlap.proof.poleOrder === structuralPoleOrder &&
          (overlap.proof.poleOrder === "same") ===
            (overlap.orientation === "same")));
    return (
      firstOrdered &&
      secondOrdered &&
      contained(overlap.firstInterval, firstActive) &&
      contained(secondAscending, secondActive) &&
      proofMatches
    );
  });
  if (!pointBoxesValid || !boxesDisjoint || !overlapsValid) {
    throw new Error("Invalid neutral-curve witness boxes or provenance.");
  }
  const invalidImplicitMultiplicityProof = points.some((point) =>
    point.proof.kind === "exactImplicitLineRootSet" &&
    point.proof.verification === "exactMultiplicity"
      ? !Number.isSafeInteger(point.proof.rootMultiplicity) ||
        point.proof.rootMultiplicity === undefined ||
        point.proof.rootMultiplicity < 2 ||
        point.proof.rootMultiplicity % 2 !== 0 ||
        point.classification === "crossing"
      : point.proof.kind === "exactImplicitLineRootSet" &&
        point.proof.verification !== "exactMultiplicity" &&
        point.proof.rootMultiplicity !== undefined,
  );
  if (invalidImplicitMultiplicityProof) {
    throw new Error("Invalid exact implicit-root multiplicity proof.");
  }
  const invalidDeterminantProof = points.some((point) => {
    if (
      point.proof.kind !== "exactCubicPairRootSet" ||
      !point.proof.sourceUnitTangentDeterminantBounds
    )
      return false;
    const [lower, upper] = point.proof.sourceUnitTangentDeterminantBounds;
    return (
      point.classification !== "crossing" ||
      !Number.isFinite(lower) ||
      !Number.isFinite(upper) ||
      lower > upper ||
      (lower <= 0 && upper >= 0)
    );
  });
  if (invalidDeterminantProof) {
    throw new Error("Invalid source-unit tangent determinant proof.");
  }
  const validCount = (value: number) =>
    Number.isSafeInteger(value) && value >= 0;
  if (completenessProof.kind === "completeIsolatedRootSet") {
    if (
      overlaps.length !== 0 ||
      completenessProof.family !== expectedIsolatedFamily ||
      (completenessProof.family === "cubicCubic" &&
        structuralPoleOrder !== null) ||
      !validCount(completenessProof.distinctRootCount) ||
      completenessProof.distinctRootCount !== points.length ||
      points.some(
        (point) => !pointMatchesIsolatedFamily(point, completenessProof.family),
      )
    ) {
      throw new Error("Invalid isolated neutral-curve completeness proof.");
    }
  } else {
    const expectedStructuralFamily =
      queryKind === "pair" &&
      request.first.kind === "line" &&
      request.second.kind === "line"
        ? "finiteLinePair"
        : queryKind === "pair" &&
            request.first.kind === "cubicBezier" &&
            request.second.kind === "cubicBezier"
          ? "structuralCubicOverlap"
          : null;
    const expectedOverlaps =
      completenessProof.correspondence === "interval" ? 1 : 0;
    const expectedCorrespondencePoints =
      completenessProof.correspondence === "endpoint" ? 1 : 0;
    const overlapMatchesFamily =
      overlaps.length === 0 ||
      (completenessProof.family === "finiteLinePair"
        ? overlaps[0]!.proof.kind === "exactCollinearLineOverlap"
        : overlaps[0]!.proof.kind === "structuralCubicPoleIdentity");
    const structuralPointsMatch =
      completenessProof.family === "finiteLinePair"
        ? points.length === 0 && completenessProof.correspondence === "interval"
        : structuralPoleOrder !== null &&
          structuralCorrespondenceDisposition ===
            completenessProof.correspondence &&
          points.filter(isStructuralCubicEndpoint).length ===
            expectedCorrespondencePoints &&
          points
            .filter((point) => !isStructuralCubicEndpoint(point))
            .every(
              (point) =>
                point.proof.kind === "exactAlgebraicCurveRootSet" &&
                point.proof.family === "cubicCubic" &&
                pointBoxExcludesStructuralCorrespondence(point),
            );
    if (
      completenessProof.family !== expectedStructuralFamily ||
      overlaps.length !== expectedOverlaps ||
      !overlapMatchesFamily ||
      !structuralPointsMatch ||
      completenessProof.correspondencePointCount !==
        expectedCorrespondencePoints ||
      !validCount(completenessProof.offCorrespondenceDistinctRootCount) ||
      points.length !==
        completenessProof.correspondencePointCount +
          completenessProof.offCorrespondenceDistinctRootCount
    ) {
      throw new Error("Invalid structural neutral-curve completeness proof.");
    }
  }
  return { kind: "verified", points, overlaps, completenessProof };
}

function completeIsolated(
  request: NeutralCurveQueryRequest,
  family: NeutralCurveIsolatedRootFamily,
  points: readonly NeutralCurvePointWitness[],
  budget: ExactProofBudget,
  queryKind: "pair" | "self" = "pair",
): VerifiedNeutralCurveResult {
  return admitVerifiedNeutralCurveResult(
    request,
    points,
    [],
    {
      kind: "completeIsolatedRootSet",
      family,
      distinctRootCount: points.length,
    },
    budget,
    queryKind,
  );
}

function sameVector(first: SplineVector, second: SplineVector) {
  return first[0] === second[0] && first[1] === second[1];
}

function mapNormalizedExactToDomain(
  normalized: ExactFraction,
  domain: readonly [number, number],
  reversed: boolean,
  budget?: ExactProofBudget,
) {
  const start = exactFractionFromFiniteDouble(
    reversed ? domain[1] : domain[0],
    budget,
  );
  const length = subtractExact(
    exactFractionFromFiniteDouble(domain[1], budget),
    exactFractionFromFiniteDouble(domain[0], budget),
    budget,
  );
  const offset = multiplyExact(normalized, length, budget);
  return exactFractionToNumber(
    reversed
      ? subtractExact(start, offset, budget)
      : addExact(start, offset, budget),
    budget,
  );
}

export function normalizedExact(
  parameter: number,
  domain: readonly [number, number],
  budget?: ExactProofBudget,
): ExactFraction {
  const offset = subtractExact(
    exactFractionFromFiniteDouble(parameter, budget),
    exactFractionFromFiniteDouble(domain[0], budget),
    budget,
  );
  const length = subtractExact(
    exactFractionFromFiniteDouble(domain[1], budget),
    exactFractionFromFiniteDouble(domain[0], budget),
    budget,
  );
  return divideExact(offset, length, budget);
}

function reverseExact(value: ExactFraction, budget?: ExactProofBudget) {
  return subtractExact(exactFractionFromFiniteDouble(1, budget), value, budget);
}

export function crossExact(
  first: readonly [ExactFraction, ExactFraction],
  second: readonly [ExactFraction, ExactFraction],
  budget?: ExactProofBudget,
) {
  return subtractExact(
    multiplyExact(first[0], second[1], budget),
    multiplyExact(first[1], second[0], budget),
    budget,
  );
}

export function exactVector(value: SplineVector, budget?: ExactProofBudget) {
  return value.map((coordinate) =>
    exactFractionFromFiniteDouble(coordinate, budget),
  ) as [ExactFraction, ExactFraction];
}

function interpolateExact(
  first: ExactFraction,
  second: ExactFraction,
  parameter: ExactFraction,
  budget?: ExactProofBudget,
) {
  return addExact(
    first,
    multiplyExact(parameter, subtractExact(second, first, budget), budget),
    budget,
  );
}

function splitScalarCubicBernstein(
  coefficients: readonly [
    ExactFraction,
    ExactFraction,
    ExactFraction,
    ExactFraction,
  ],
  parameter: ExactFraction,
  budget?: ExactProofBudget,
) {
  const firstLevel = [
    interpolateExact(coefficients[0], coefficients[1], parameter, budget),
    interpolateExact(coefficients[1], coefficients[2], parameter, budget),
    interpolateExact(coefficients[2], coefficients[3], parameter, budget),
  ] as const;
  const secondLevel = [
    interpolateExact(firstLevel[0], firstLevel[1], parameter, budget),
    interpolateExact(firstLevel[1], firstLevel[2], parameter, budget),
  ] as const;
  const split = interpolateExact(
    secondLevel[0],
    secondLevel[1],
    parameter,
    budget,
  );
  return {
    left: [coefficients[0], firstLevel[0], secondLevel[0], split],
    right: [split, secondLevel[1], firstLevel[2], coefficients[3]],
  } as const;
}

function countDistinctPolynomialRoots(
  polynomial: ExactPolynomial,
  domain: readonly [number, number],
  budget: ExactProofBudget,
) {
  return countDistinctRoots(
    polynomial,
    [
      exactFractionFromFiniteDouble(domain[0], budget),
      exactFractionFromFiniteDouble(domain[1], budget),
    ],
    budget,
  );
}

export interface NativeLineCurveCandidate {
  readonly firstParameter: number;
  readonly secondParameter: number;
  readonly position: SplineVector;
}

export function restrictCubicBernstein(
  coefficients: readonly [
    ExactFraction,
    ExactFraction,
    ExactFraction,
    ExactFraction,
  ],
  lower: ExactFraction,
  upper: ExactFraction,
  budget?: ExactProofBudget,
) {
  if (compareExact(lower, upper, budget) === 0) {
    const value = splitScalarCubicBernstein(coefficients, lower, budget)
      .left[3];
    return [value, value, value, value] as const;
  }
  const afterLower = splitScalarCubicBernstein(
    coefficients,
    lower,
    budget,
  ).right;
  const upperWithinRemainder = divideExact(
    subtractExact(upper, lower, budget),
    subtractExact(exactFractionFromFiniteDouble(1, budget), lower, budget),
    budget,
  );
  return splitScalarCubicBernstein(afterLower, upperWithinRemainder, budget)
    .left;
}

export function restrictedLineCubicData(
  line: Extract<NeutralCurve, { kind: "line" }>,
  cubic: Extract<NeutralCurve, { kind: "cubicBezier" }>,
  budget?: ExactProofBudget,
) {
  const origin = exactVector(line.origin, budget);
  const direction = exactVector(line.direction, budget);
  const relativePole = (pole: SplineVector) => {
    const exactPole = exactVector(pole, budget);
    return [
      subtractExact(exactPole[0], origin[0], budget),
      subtractExact(exactPole[1], origin[1], budget),
    ] as const;
  };
  const sideCoefficients = cubic.poles.map((pole) =>
    crossExact(direction, relativePole(pole), budget),
  ) as [ExactFraction, ExactFraction, ExactFraction, ExactFraction];
  const directionSquared = reducedExact(
    addExact(
      multiplyExact(direction[0], direction[0], budget),
      multiplyExact(direction[1], direction[1], budget),
      budget,
    ),
    budget,
  );
  const projectionCoefficients = cubic.poles.map((pole) => {
    const relative = relativePole(pole);
    return reducedExact(
      divideExact(
        addExact(
          multiplyExact(direction[0], relative[0], budget),
          multiplyExact(direction[1], relative[1], budget),
          budget,
        ),
        directionSquared,
        budget,
      ),
      budget,
    );
  }) as [ExactFraction, ExactFraction, ExactFraction, ExactFraction];
  const active = getNeutralCurveActiveSearchBounds(cubic);
  const lower = normalizedExact(active[0], cubic.sourceDomain, budget);
  const upper = normalizedExact(active[1], cubic.sourceDomain, budget);
  const restricted = restrictCubicBernstein(
    sideCoefficients,
    lower,
    upper,
    budget,
  );
  const [a, b, c, d] = restricted;
  const scaled = (value: ExactFraction, factor: number) =>
    multiplyExact(value, exactFractionFromFiniteDouble(factor, budget), budget);
  return {
    polynomial: [
      a,
      addExact(scaled(a, -3), scaled(b, 3), budget),
      addExact(
        addExact(scaled(a, 3), scaled(b, -6), budget),
        scaled(c, 3),
        budget,
      ),
      addExact(
        addExact(scaled(a, -1), scaled(b, 3), budget),
        addExact(scaled(c, -3), d, budget),
        budget,
      ),
    ] as const,
    projection: restrictCubicBernstein(
      projectionCoefficients,
      lower,
      upper,
      budget,
    ),
  };
}

function exactPolynomialRootMultiplicity(
  polynomial: ExactPolynomial,
  root: ExactFraction,
  budget: ExactProofBudget,
) {
  let derivative = polynomialTrim(polynomial, budget);
  let multiplicity = 0;
  while (derivative.length > 1) {
    budget.bigintComparison();
    if (polynomialEvaluate(derivative, root, budget).numerator !== 0n) {
      return multiplicity;
    }
    derivative = polynomialTrim(
      polynomialDerivative(derivative, budget),
      budget,
    );
    multiplicity += 1;
  }
  budget.bigintComparison();
  return polynomialEvaluate(derivative, root, budget).numerator === 0n
    ? null
    : multiplicity;
}

export function lineCirclePolynomial(
  line: Extract<NeutralCurve, { kind: "line" }>,
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  budget?: ExactProofBudget,
) {
  const displacement = [
    subtractExact(
      exactFractionFromFiniteDouble(line.origin[0], budget),
      exactFractionFromFiniteDouble(circle.center[0], budget),
      budget,
    ),
    subtractExact(
      exactFractionFromFiniteDouble(line.origin[1], budget),
      exactFractionFromFiniteDouble(circle.center[1], budget),
      budget,
    ),
  ] as const;
  const direction = exactVector(line.direction, budget);
  const radius = exactFractionFromFiniteDouble(circle.radius, budget);
  return [
    subtractExact(
      addExact(
        multiplyExact(displacement[0], displacement[0], budget),
        multiplyExact(displacement[1], displacement[1], budget),
        budget,
      ),
      multiplyExact(radius, radius, budget),
      budget,
    ),
    multiplyExact(
      exactFractionFromFiniteDouble(2, budget),
      addExact(
        multiplyExact(displacement[0], direction[0], budget),
        multiplyExact(displacement[1], direction[1], budget),
        budget,
      ),
      budget,
    ),
    addExact(
      multiplyExact(direction[0], direction[0], budget),
      multiplyExact(direction[1], direction[1], budget),
      budget,
    ),
  ] as const;
}

/**
 * Completes line/circle and line/cubic native queries with an exact root-set
 * certificate. OCC only proposes representatives; exact binary64-derived
 * scalar polynomials prove every distinct active incidence and candidate count.
 */
export function verifyCompleteLineCurveRootSet(
  request: NeutralCurveQueryRequest,
  candidates: readonly NativeLineCurveCandidate[],
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  const firstIsLine = request.first.kind === "line";
  const line = firstIsLine ? request.first : request.second;
  const curve = firstIsLine ? request.second : request.first;
  if (
    line.kind !== "line" ||
    (curve.kind !== "circle" && curve.kind !== "cubicBezier")
  )
    return null;

  const primaryDomain =
    curve.kind === "circle"
      ? getNeutralCurveActiveSearchBounds(line)
      : ([0, 1] as const);
  const polynomial =
    curve.kind === "circle"
      ? lineCirclePolynomial(line, curve, budget)
      : restrictedLineCubicData(line, curve, budget).polynomial;
  const rootCount = countDistinctPolynomialRoots(
    polynomial,
    primaryDomain,
    budget,
  );
  if (rootCount === null) {
    return {
      kind: "uncertain",
      code: "occ-neutral-curve-overlap-unproven",
      message:
        "The line/curve implicit polynomial vanishes identically; isolated-point verification cannot classify the overlap.",
    };
  }
  if (
    curve.kind === "circle" &&
    rootCount > 0 &&
    (curve.sourceDomain.kind !== "fullTurn" || curve.queryDomain)
  ) {
    return {
      kind: "uncertain",
      code: "occ-neutral-curve-circle-active-domain-proof-unavailable",
      message:
        "The active arc root requires certified angular membership and unwrapped representative isolation.",
    };
  }
  if (rootCount !== candidates.length) {
    return {
      kind: "uncertain",
      code:
        candidates.length === 0
          ? "occ-neutral-curve-empty-proof-unavailable"
          : candidates.length > rootCount
            ? "occ-neutral-curve-point-proof-unavailable"
            : "occ-neutral-curve-root-set-incomplete",
      message:
        "Native candidates do not correspond one-to-one with the complete exact active line/curve root set.",
    };
  }

  const witnesses: NeutralCurvePointWitness[] = [];
  const seen: ExactFraction[] = [];
  const certificates: (readonly [number, number])[] = [];
  for (const candidate of candidates) {
    const lineParameter = firstIsLine
      ? candidate.firstParameter
      : candidate.secondParameter;
    const curveParameter = firstIsLine
      ? candidate.secondParameter
      : candidate.firstParameter;
    const primary =
      curve.kind === "circle"
        ? lineParameter
        : (curveParameter - getNeutralCurveActiveSearchBounds(curve)[0]) /
          (getNeutralCurveActiveSearchBounds(curve)[1] -
            getNeutralCurveActiveSearchBounds(curve)[0]);
    if (
      !Number.isFinite(primary) ||
      !neutralCurveParameterInside(primary, primaryDomain)
    ) {
      return {
        kind: "uncertain",
        code: "occ-neutral-curve-root-representative-invalid",
        message:
          "A native line/curve representative is outside the exact polynomial domain.",
      };
    }
    const exactPrimary = exactFractionFromFiniteDouble(primary, budget);
    if (seen.some((value) => compareExact(value, exactPrimary, budget) === 0)) {
      return {
        kind: "uncertain",
        code: "occ-neutral-curve-root-set-incomplete",
        message:
          "Native candidates do not identify distinct exact line/curve roots.",
      };
    }
    seen.push(exactPrimary);
    const exactValue = polynomialEvaluate(polynomial, exactPrimary, budget);
    let bounds: readonly [number, number];
    let verification: "exactRoot" | "boundedSignChange";
    budget.bigintComparison(2);
    let certifiedExactRoot: ExactFraction | null =
      exactValue.numerator === 0n ? exactPrimary : null;
    if (exactValue.numerator === 0n) {
      bounds = [primary, primary];
      verification = "exactRoot";
    } else {
      const radius = Number.EPSILON * Math.max(1, Math.abs(primary)) * 4_096;
      const lower = Math.max(primaryDomain[0], primary - radius);
      const upper = Math.min(primaryDomain[1], primary + radius);
      const lowerValue = polynomialEvaluate(
        polynomial,
        exactFractionFromFiniteDouble(lower, budget),
        budget,
      );
      const upperValue = polynomialEvaluate(
        polynomial,
        exactFractionFromFiniteDouble(upper, budget),
        budget,
      );
      budget.bigintComparison(4);
      if (
        lower >= primary ||
        upper <= primary ||
        lowerValue.numerator === 0n ||
        upperValue.numerator === 0n ||
        lowerValue.numerator < 0n === upperValue.numerator < 0n
      ) {
        return {
          kind: "uncertain",
          code: "occ-neutral-curve-point-proof-unavailable",
          message:
            "A native line/curve candidate lacks an exact root or bounded sign-change certificate.",
        };
      }
      bounds = [lower, upper];
      verification = "boundedSignChange";
      const roundedInteger = Math.round(primary);
      if (roundedInteger >= lower && roundedInteger <= upper) {
        const exactRoundedInteger = exactFractionFromFiniteDouble(
          roundedInteger,
          budget,
        );
        budget.bigintComparison();
        if (
          polynomialEvaluate(polynomial, exactRoundedInteger, budget)
            .numerator === 0n
        ) {
          certifiedExactRoot = exactRoundedInteger;
        }
      }
    }
    if (countDistinctPolynomialRoots(polynomial, bounds, budget) !== 1) {
      return {
        kind: "uncertain",
        code: "occ-neutral-curve-root-set-incomplete",
        message:
          "A line/curve candidate certificate does not isolate exactly one distinct exact root.",
      };
    }
    const exactLower = exactFractionFromFiniteDouble(bounds[0], budget);
    const exactUpper = exactFractionFromFiniteDouble(bounds[1], budget);
    if (
      certificates.some(([otherLower, otherUpper]) => {
        const exactOtherLower = exactFractionFromFiniteDouble(
          otherLower,
          budget,
        );
        const exactOtherUpper = exactFractionFromFiniteDouble(
          otherUpper,
          budget,
        );
        return (
          compareExact(exactLower, exactOtherUpper, budget) <= 0 &&
          compareExact(exactOtherLower, exactUpper, budget) <= 0
        );
      })
    ) {
      return {
        kind: "uncertain",
        code: "occ-neutral-curve-root-set-incomplete",
        message:
          "Line/curve candidate certificates overlap and therefore do not prove distinct roots.",
      };
    }
    certificates.push(bounds);
    const primaryBounds =
      curve.kind === "circle"
        ? bounds
        : (bounds.map(
            (value) =>
              getNeutralCurveActiveSearchBounds(curve)[0] +
              value *
                (getNeutralCurveActiveSearchBounds(curve)[1] -
                  getNeutralCurveActiveSearchBounds(curve)[0]),
          ) as [number, number]);
    let lineBounds: readonly [number, number];
    if (curve.kind === "circle") {
      lineBounds = primaryBounds;
    } else {
      const projection = restrictedLineCubicData(
        line,
        curve,
        budget,
      ).projection;
      const projectionBounds = restrictCubicBernstein(
        projection,
        exactFractionFromFiniteDouble(bounds[0], budget),
        exactFractionFromFiniteDouble(bounds[1], budget),
        budget,
      );
      let lower = projectionBounds[0];
      let upper = projectionBounds[0];
      for (const coefficient of projectionBounds.slice(1)) {
        if (compareExact(coefficient, lower, budget) < 0) lower = coefficient;
        if (compareExact(coefficient, upper, budget) > 0) upper = coefficient;
      }
      const lineDomain = getNeutralCurveActiveSearchBounds(line);
      if (
        compareExact(
          lower,
          exactFractionFromFiniteDouble(lineDomain[0], budget),
          budget,
        ) < 0 ||
        compareExact(
          upper,
          exactFractionFromFiniteDouble(lineDomain[1], budget),
          budget,
        ) > 0
      ) {
        return {
          kind: "uncertain",
          code: "occ-neutral-curve-point-proof-unavailable",
          message:
            "The exact root bracket does not prove that the complete line projection stays inside the finite active line domain.",
        };
      }
      lineBounds = [
        exactFractionToNumber(lower, budget),
        exactFractionToNumber(upper, budget),
      ];
    }
    let curveBounds: readonly [number, number] = primaryBounds;
    let curveRepresentative = curveParameter;
    let witnessPosition = candidate.position;
    if (curve.kind === "circle") {
      if (!certifiedExactRoot) {
        return {
          kind: "uncertain",
          code: "occ-neutral-curve-root-association-unrepresentable",
          message:
            "A nonrational line/circle support root requires coupled algebraic angular refinement.",
        };
      }
      const exactPoint = exactLinePoint(line, certifiedExactRoot, budget);
      const center = exactVector(curve.center, budget);
      const angular = certifyExactPointCircleParameter(
        curve,
        [
          subtractExact(exactPoint[0], center[0], budget),
          subtractExact(exactPoint[1], center[1], budget),
        ],
        curveParameter,
        budget,
      );
      if (!angular) {
        return {
          kind: "uncertain",
          code: "occ-neutral-curve-root-association-unrepresentable",
          message:
            "The exact line/circle point could not be associated with a unique certified angular interval.",
        };
      }
      curveBounds = angular.bounds;
      curveRepresentative = angular.parameter;
      witnessPosition = [
        exactFractionToNumber(exactPoint[0], budget),
        exactFractionToNumber(exactPoint[1], budget),
      ];
    }
    const atPrimaryBoundary =
      primary === primaryDomain[0] || primary === primaryDomain[1];
    const exactMultiplicity =
      verification === "exactRoot"
        ? exactPolynomialRootMultiplicity(polynomial, exactPrimary, budget)
        : null;
    if (verification === "exactRoot" && exactMultiplicity === null) {
      return {
        kind: "uncertain",
        code: "occ-neutral-curve-point-proof-unavailable",
        message:
          "An exact line/curve root has no finite multiplicity certificate.",
      };
    }
    const witness: NeutralCurvePointWitness = {
      classification: atPrimaryBoundary
        ? "unclassified"
        : verification === "boundedSignChange" || exactMultiplicity! % 2 === 1
          ? "crossing"
          : "tangent",
      firstParameter: firstIsLine
        ? candidate.firstParameter
        : curveRepresentative,
      secondParameter: firstIsLine
        ? curveRepresentative
        : candidate.secondParameter,
      position: witnessPosition,
      proof: {
        kind: "exactImplicitLineRootSet",
        family: curve.kind === "circle" ? "lineCircle" : "lineCubic",
        verification,
        firstParameterBounds: firstIsLine ? lineBounds : curveBounds,
        secondParameterBounds: firstIsLine ? curveBounds : lineBounds,
      },
    };
    const inconsistency = checkNeutralCurvePointConsistency(request, witness);
    if (inconsistency) return inconsistency;
    witnesses.push(witness);
  }
  return completeIsolated(
    request,
    curve.kind === "circle" ? "lineCircle" : "lineCubic",
    witnesses,
    budget,
  );
}

function exactParameterInside(
  parameter: ExactFraction,
  domain: readonly [number, number],
  budget?: ExactProofBudget,
) {
  return (
    compareExact(
      parameter,
      exactFractionFromFiniteDouble(domain[0], budget),
      budget,
    ) >= 0 &&
    compareExact(
      parameter,
      exactFractionFromFiniteDouble(domain[1], budget),
      budget,
    ) <= 0
  );
}

function exactLinePoint(
  line: Extract<NeutralCurve, { kind: "line" }>,
  parameter: ExactFraction,
  budget?: ExactProofBudget,
) {
  const origin = exactVector(line.origin, budget);
  const direction = exactVector(line.direction, budget);
  return [
    addExact(origin[0], multiplyExact(direction[0], parameter, budget), budget),
    addExact(origin[1], multiplyExact(direction[1], parameter, budget), budget),
  ] as const;
}

function exactFractionEqual(
  first: ExactFraction,
  second: ExactFraction,
  budget?: ExactProofBudget,
) {
  return compareExact(first, second, budget) === 0;
}

function finiteLinePointResult(
  request: NeutralCurveQueryRequest & {
    first: Extract<NeutralCurve, { kind: "line" }>;
    second: Extract<NeutralCurve, { kind: "line" }>;
  },
  firstExact: ExactFraction,
  secondExact: ExactFraction,
  budget: ExactProofBudget,
): NeutralCurveQueryResult {
  const firstParameter = exactFractionToNumber(firstExact, budget);
  const secondParameter = exactFractionToNumber(secondExact, budget);
  const exactPosition = exactLinePoint(request.first, firstExact, budget);
  const position = exactPosition.map((coordinate) =>
    exactFractionToNumber(coordinate, budget),
  ) as [number, number];
  const firstDomain = getNeutralCurveActiveSearchBounds(request.first);
  const secondDomain = getNeutralCurveActiveSearchBounds(request.second);
  if (
    !Number.isFinite(firstParameter) ||
    !Number.isFinite(secondParameter) ||
    !position.every(Number.isFinite) ||
    !neutralCurveParameterInside(firstParameter, firstDomain) ||
    !neutralCurveParameterInside(secondParameter, secondDomain)
  ) {
    return {
      kind: "uncertain",
      code: "exact-line-witness-numerically-unrepresentable",
      message:
        "The exact finite-line contact cannot be represented by finite in-domain binary64 parameters and coordinates.",
    };
  }
  const atEndpoint =
    exactFractionEqual(
      firstExact,
      exactFractionFromFiniteDouble(firstDomain[0], budget),
      budget,
    ) ||
    exactFractionEqual(
      firstExact,
      exactFractionFromFiniteDouble(firstDomain[1], budget),
      budget,
    ) ||
    exactFractionEqual(
      secondExact,
      exactFractionFromFiniteDouble(secondDomain[0], budget),
      budget,
    ) ||
    exactFractionEqual(
      secondExact,
      exactFractionFromFiniteDouble(secondDomain[1], budget),
      budget,
    );
  const witness: NeutralCurvePointWitness = {
    classification: atEndpoint ? "unclassified" : "crossing",
    firstParameter,
    secondParameter,
    position,
    proof: {
      kind: "exactFiniteLineIntersection",
      firstParameterBounds: [firstParameter, firstParameter],
      secondParameterBounds: [secondParameter, secondParameter],
    },
  };
  const inconsistency = checkNeutralCurvePointConsistency(request, witness);
  return inconsistency
    ? {
        kind: "uncertain",
        code: "exact-line-witness-numerically-unrepresentable",
        message:
          "The exact finite-line contact cannot be represented consistently by binary64 witness data.",
      }
    : completeIsolated(request, "finiteLinePair", [witness], budget);
}

/**
 * Complete exact predicate for two finite active line domains. All decisions
 * use the exact rational values represented by the binary64 request. Output
 * conversion may fail closed, but modelingTolerance never changes topology.
 */
export function proveExactCirclePairIntersectionCount(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): number | null {
  if (request.first.kind !== "circle" || request.second.kind !== "circle") {
    return null;
  }
  const displacement = [
    subtractExact(
      exactFractionFromFiniteDouble(request.second.center[0], budget),
      exactFractionFromFiniteDouble(request.first.center[0], budget),
      budget,
    ),
    subtractExact(
      exactFractionFromFiniteDouble(request.second.center[1], budget),
      exactFractionFromFiniteDouble(request.first.center[1], budget),
      budget,
    ),
  ] as const;
  const distanceSquared = addExact(
    multiplyExact(displacement[0], displacement[0], budget),
    multiplyExact(displacement[1], displacement[1], budget),
    budget,
  );
  const firstRadius = exactFractionFromFiniteDouble(
    request.first.radius,
    budget,
  );
  const secondRadius = exactFractionFromFiniteDouble(
    request.second.radius,
    budget,
  );
  const radiusSum = addExact(firstRadius, secondRadius, budget);
  const radiusDifference = subtractExact(firstRadius, secondRadius, budget);
  const sumSquared = multiplyExact(radiusSum, radiusSum, budget);
  const differenceSquared = multiplyExact(
    radiusDifference,
    radiusDifference,
    budget,
  );
  budget.bigintComparison();
  if (distanceSquared.numerator === 0n) {
    return compareExact(firstRadius, secondRadius, budget) === 0 ? null : 0;
  }
  if (
    compareExact(distanceSquared, sumSquared, budget) > 0 ||
    compareExact(distanceSquared, differenceSquared, budget) < 0
  ) {
    return 0;
  }
  return compareExact(distanceSquared, sumSquared, budget) === 0 ||
    compareExact(distanceSquared, differenceSquared, budget) === 0
    ? 1
    : 2;
}

export function proveFiniteLinePair(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  if (request.first.kind !== "line" || request.second.kind !== "line") {
    return null;
  }
  const first = request.first;
  const second = request.second;
  const firstDirection = exactVector(first.direction, budget);
  const secondDirection = exactVector(second.direction, budget);
  const firstOrigin = exactVector(first.origin, budget);
  const secondOrigin = exactVector(second.origin, budget);
  const displacement = [
    subtractExact(secondOrigin[0], firstOrigin[0], budget),
    subtractExact(secondOrigin[1], firstOrigin[1], budget),
  ] as const;
  const determinant = crossExact(firstDirection, secondDirection, budget);
  const firstActive = getNeutralCurveActiveSearchBounds(first);
  const secondActive = getNeutralCurveActiveSearchBounds(second);

  if (
    compareExact(
      determinant,
      exactFractionFromFiniteDouble(0, budget),
      budget,
    ) !== 0
  ) {
    const firstParameter = divideExact(
      crossExact(displacement, secondDirection, budget),
      determinant,
      budget,
    );
    const secondParameter = divideExact(
      crossExact(displacement, firstDirection, budget),
      determinant,
      budget,
    );
    if (
      !exactParameterInside(firstParameter, firstActive, budget) ||
      !exactParameterInside(secondParameter, secondActive, budget)
    ) {
      return completeIsolated(request, "finiteLinePair", [], budget);
    }
    return finiteLinePointResult(
      { ...request, first, second },
      firstParameter,
      secondParameter,
      budget,
    );
  }

  if (
    compareExact(
      crossExact(displacement, firstDirection, budget),
      exactFractionFromFiniteDouble(0, budget),
      budget,
    ) !== 0
  ) {
    return completeIsolated(request, "finiteLinePair", [], budget);
  }

  const coordinate =
    compareExact(
      firstDirection[0],
      exactFractionFromFiniteDouble(0, budget),
      budget,
    ) !== 0
      ? 0
      : 1;
  const mapSecondToFirst = (parameter: number) =>
    divideExact(
      addExact(
        displacement[coordinate],
        multiplyExact(
          secondDirection[coordinate],
          exactFractionFromFiniteDouble(parameter, budget),
          budget,
        ),
        budget,
      ),
      firstDirection[coordinate],
      budget,
    );
  const mappedStart = mapSecondToFirst(secondActive[0]);
  const mappedEnd = mapSecondToFirst(secondActive[1]);
  const sameOrientation = compareExact(mappedStart, mappedEnd, budget) < 0;
  const mappedLower = sameOrientation ? mappedStart : mappedEnd;
  const mappedUpper = sameOrientation ? mappedEnd : mappedStart;
  const firstLower = exactFractionFromFiniteDouble(firstActive[0], budget);
  const firstUpper = exactFractionFromFiniteDouble(firstActive[1], budget);
  const lower =
    compareExact(firstLower, mappedLower, budget) >= 0
      ? firstLower
      : mappedLower;
  const upper =
    compareExact(firstUpper, mappedUpper, budget) <= 0
      ? firstUpper
      : mappedUpper;
  const intervalComparison = compareExact(lower, upper, budget);
  if (intervalComparison > 0) {
    return completeIsolated(request, "finiteLinePair", [], budget);
  }

  const mapFirstToSecond = (parameter: ExactFraction) =>
    divideExact(
      subtractExact(
        multiplyExact(firstDirection[coordinate], parameter, budget),
        displacement[coordinate],
        budget,
      ),
      secondDirection[coordinate],
      budget,
    );
  if (intervalComparison === 0) {
    return finiteLinePointResult(
      { ...request, first, second },
      lower,
      mapFirstToSecond(lower),
      budget,
    );
  }

  const firstInterval = [
    exactFractionToNumber(lower, budget),
    exactFractionToNumber(upper, budget),
  ] as const;
  const secondInterval = [
    exactFractionToNumber(mapFirstToSecond(lower), budget),
    exactFractionToNumber(mapFirstToSecond(upper), budget),
  ] as const;
  const valid =
    firstInterval.every(Number.isFinite) &&
    secondInterval.every(Number.isFinite) &&
    firstInterval[1] > firstInterval[0] &&
    secondInterval[0] !== secondInterval[1] &&
    firstInterval.every((parameter) =>
      neutralCurveParameterInside(parameter, firstActive),
    ) &&
    secondInterval.every((parameter) =>
      neutralCurveParameterInside(parameter, secondActive),
    );
  if (!valid) {
    return {
      kind: "uncertain",
      code: "exact-line-overlap-numerically-unrepresentable",
      message:
        "The exact collinear overlap cannot be represented as finite nondegenerate binary64 source intervals.",
    };
  }
  return admitVerifiedNeutralCurveResult(
    request,
    [],
    [
      {
        orientation: sameOrientation ? "same" : "opposite",
        firstInterval,
        secondInterval,
        proof: {
          kind: "exactCollinearLineOverlap",
          firstProvenance: first.provenance,
          secondProvenance: second.provenance,
        },
      },
    ],
    {
      kind: "completeStructuralCorrespondence",
      family: "finiteLinePair",
      correspondence: "interval",
      correspondencePointCount: 0,
      offCorrespondenceDistinctRootCount: 0,
    },
    budget,
    "pair",
  );
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
  budget?: ExactProofBudget,
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

  const firstActive = getNeutralCurveActiveSearchBounds(first);
  const secondActive = getNeutralCurveActiveSearchBounds(second);
  const firstLocal = firstActive.map((parameter) =>
    normalizedExact(parameter, first.sourceDomain, budget),
  ) as [ExactFraction, ExactFraction];
  const secondLocal = secondActive.map((parameter) =>
    normalizedExact(parameter, second.sourceDomain, budget),
  ) as [ExactFraction, ExactFraction];
  const secondInFirstBasis: readonly [ExactFraction, ExactFraction] = reversed
    ? [
        reverseExact(secondLocal[1], budget),
        reverseExact(secondLocal[0], budget),
      ]
    : secondLocal;
  const lowerFromFirst =
    compareExact(firstLocal[0], secondInFirstBasis[0], budget) >= 0;
  const upperFromFirst =
    compareExact(firstLocal[1], secondInFirstBasis[1], budget) <= 0;
  const lower = lowerFromFirst ? firstLocal[0] : secondInFirstBasis[0];
  const upper = upperFromFirst ? firstLocal[1] : secondInFirstBasis[1];
  if (compareExact(lower, upper, budget) >= 0) return null;
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

const polynomialAddExact = polynomialAdd;
const polynomialMultiplyExact = polynomialMultiply;

function isolateDistinctRoots01(
  input: ExactPolynomial,
  budget: ExactProofBudget,
) {
  return isolateDistinctRootsClosed(
    input,
    [
      exactFractionFromFiniteDouble(0, budget),
      exactFractionFromFiniteDouble(1, budget),
    ],
    budget,
  );
}

function intervalAdd(
  first: CertifiedInterval,
  second: CertifiedInterval,
  budget: ExactProofBudget,
): CertifiedInterval {
  budget.operation(2);
  return {
    lower: nextBinary64(first.lower + second.lower, "down", budget),
    upper: nextBinary64(first.upper + second.upper, "up", budget),
  };
}

function intervalMultiply(
  first: CertifiedInterval,
  second: CertifiedInterval,
  budget: ExactProofBudget,
): CertifiedInterval {
  budget.operation(4);
  const products = [
    first.lower * second.lower,
    first.lower * second.upper,
    first.upper * second.lower,
    first.upper * second.upper,
  ];
  return {
    lower: nextBinary64(Math.min(...products), "down", budget),
    upper: nextBinary64(Math.max(...products), "up", budget),
  };
}

function intervalNegate(
  value: CertifiedInterval,
  budget: ExactProofBudget,
): CertifiedInterval {
  budget.operation(2);
  return { lower: -value.upper, upper: -value.lower };
}

function exactInterval(
  value: ExactFraction,
  budget: ExactProofBudget,
): CertifiedInterval {
  return {
    lower: outwardExactNumber(value, "down", budget),
    upper: outwardExactNumber(value, "up", budget),
  };
}

function angularFunctions(
  angle: number,
  crossCoefficient: ExactFraction,
  dotCoefficient: ExactFraction,
  budget: ExactProofBudget,
) {
  const trig = certifySinCos(angle, budget);
  if (!trig) return null;
  const cross = exactInterval(crossCoefficient, budget);
  const dot = exactInterval(dotCoefficient, budget);
  return {
    f: intervalAdd(
      intervalMultiply(cross, trig.cosine, budget),
      intervalNegate(intervalMultiply(dot, trig.sine, budget), budget),
      budget,
    ),
    g: intervalAdd(
      intervalMultiply(dot, trig.cosine, budget),
      intervalMultiply(cross, trig.sine, budget),
      budget,
    ),
    trig,
  };
}

function certifyExactPointCircleParameter(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  relative: readonly [ExactFraction, ExactFraction],
  candidate: number,
  budget: ExactProofBudget,
) {
  if (!neutralCurveSourceParameterInside(circle, candidate)) return null;
  const axis = exactVector(circle.xAxis, budget);
  const crossCoefficient = crossExact(axis, relative, budget);
  const dotCoefficient = addExact(
    multiplyExact(axis[0], relative[0], budget),
    multiplyExact(axis[1], relative[1], budget),
    budget,
  );
  if (
    circle.sourceDomain.kind === "fullTurn" &&
    !circle.queryDomain &&
    circle.sourceDomain.seam === 0 &&
    crossCoefficient.numerator === 0n &&
    dotCoefficient.numerator > 0n
  ) {
    return { parameter: 0, bounds: [0, 0] as const };
  }
  for (let refinement = 0; refinement <= 24; refinement += 1) {
    const radius =
      Number.EPSILON * Math.max(1, Math.abs(candidate)) * 2 ** refinement;
    const lower = candidate - radius;
    const upper = candidate + radius;
    if (
      lower >= candidate ||
      upper <= candidate ||
      !neutralCurveSourceParameterInside(circle, lower) ||
      !neutralCurveSourceParameterInside(circle, upper)
    ) {
      continue;
    }
    const lowerValues = angularFunctions(
      lower,
      crossCoefficient,
      dotCoefficient,
      budget,
    );
    const upperValues = angularFunctions(
      upper,
      crossCoefficient,
      dotCoefficient,
      budget,
    );
    if (!lowerValues || !upperValues) continue;
    const signChange =
      (lowerValues.f.lower > 0 && upperValues.f.upper < 0) ||
      (lowerValues.f.upper < 0 && upperValues.f.lower > 0);
    if (!signChange) continue;
    const width = outwardNonnegativeDifference(upper, lower, budget);
    const sineHull = intervalHullWithLipschitz(
      lowerValues.trig.sine,
      upperValues.trig.sine,
      width,
      budget,
    );
    const cosineHull = intervalHullWithLipschitz(
      lowerValues.trig.cosine,
      upperValues.trig.cosine,
      width,
      budget,
    );
    const g = intervalAdd(
      intervalMultiply(
        exactInterval(dotCoefficient, budget),
        cosineHull,
        budget,
      ),
      intervalMultiply(
        exactInterval(crossCoefficient, budget),
        sineHull,
        budget,
      ),
      budget,
    );
    if (g.lower > 0) {
      return { parameter: candidate, bounds: [lower, upper] as const };
    }
  }
  return null;
}

function outwardNonnegativeDifference(
  upper: number,
  lower: number,
  budget: ExactProofBudget,
) {
  budget.operation();
  return nextBinary64(upper - lower, "up", budget);
}

function outwardNonnegativeProduct(
  first: number,
  second: number,
  budget: ExactProofBudget,
) {
  if (first < 0 || second < 0) return Number.POSITIVE_INFINITY;
  budget.operation();
  return nextBinary64(first * second, "up", budget);
}

function intervalHullWithLipschitz(
  first: CertifiedInterval,
  second: CertifiedInterval,
  radiusUpper: number,
  budget: ExactProofBudget,
): CertifiedInterval {
  const lower = Math.min(first.lower, second.lower);
  const upper = Math.max(first.upper, second.upper);
  budget.operation(2);
  return {
    lower: nextBinary64(lower - radiusUpper, "down", budget),
    upper: nextBinary64(upper + radiusUpper, "up", budget),
  };
}

function absoluteExact(
  value: ExactFraction,
  budget: ExactProofBudget,
): ExactFraction {
  budget.bigintComparison();
  return value.numerator < 0n ? negateExact(value, budget) : value;
}

function exactSqrtInterval(
  value: ExactFraction,
  budget: ExactProofBudget,
): CertifiedInterval | null {
  const source = exactInterval(value, budget);
  if (source.lower < 0 || !Number.isFinite(source.upper)) return null;
  return {
    lower: nextBinary64(Math.sqrt(Math.max(0, source.lower)), "down", budget),
    upper: nextBinary64(Math.sqrt(source.upper), "up", budget),
  };
}

function circlePairImplicitAt(
  first: Extract<NeutralCurve, { kind: "circle" }>,
  second: Extract<NeutralCurve, { kind: "circle" }>,
  angle: number,
  budget: ExactProofBudget,
) {
  const trig = certifySinCos(angle, budget);
  if (!trig) return null;
  const displacement = [
    subtractExact(
      exactFractionFromFiniteDouble(second.center[0], budget),
      exactFractionFromFiniteDouble(first.center[0], budget),
      budget,
    ),
    subtractExact(
      exactFractionFromFiniteDouble(second.center[1], budget),
      exactFractionFromFiniteDouble(first.center[1], budget),
      budget,
    ),
  ] as const;
  const axis = exactVector(first.xAxis, budget);
  const norm = exactSqrtInterval(
    addExact(
      multiplyExact(axis[0], axis[0], budget),
      multiplyExact(axis[1], axis[1], budget),
      budget,
    ),
    budget,
  );
  if (!norm) return null;
  const distanceSquared = addExact(
    multiplyExact(displacement[0], displacement[0], budget),
    multiplyExact(displacement[1], displacement[1], budget),
    budget,
  );
  const firstRadius = exactFractionFromFiniteDouble(first.radius, budget);
  const secondRadius = exactFractionFromFiniteDouble(second.radius, budget);
  const secondRadiusSquared = multiplyExact(secondRadius, secondRadius, budget);
  const constant = addExact(
    addExact(
      distanceSquared,
      multiplyExact(firstRadius, firstRadius, budget),
      budget,
    ),
    negateExact(secondRadiusSquared, budget),
    budget,
  );
  const cosineCoefficient = addExact(
    multiplyExact(displacement[0], axis[0], budget),
    multiplyExact(displacement[1], axis[1], budget),
    budget,
  );
  const sineCoefficient = crossExact(axis, displacement, budget);
  const radialDot = intervalAdd(
    intervalMultiply(
      exactInterval(cosineCoefficient, budget),
      trig.cosine,
      budget,
    ),
    intervalMultiply(exactInterval(sineCoefficient, budget), trig.sine, budget),
    budget,
  );
  const scale = multiplyExact(
    exactFractionFromFiniteDouble(2, budget),
    firstRadius,
    budget,
  );
  const implicit = intervalAdd(
    intervalMultiply(exactInterval(constant, budget), norm, budget),
    intervalNegate(
      intervalMultiply(exactInterval(scale, budget), radialDot, budget),
      budget,
    ),
    budget,
  );
  const sideCosineCoefficient = crossExact(displacement, axis, budget);
  const sideSineCoefficient = addExact(
    multiplyExact(displacement[0], axis[0], budget),
    multiplyExact(displacement[1], axis[1], budget),
    budget,
  );
  const side = intervalAdd(
    intervalMultiply(
      exactInterval(sideCosineCoefficient, budget),
      trig.cosine,
      budget,
    ),
    intervalMultiply(
      exactInterval(sideSineCoefficient, budget),
      trig.sine,
      budget,
    ),
    budget,
  );
  const sideDerivativeUpper = exactInterval(
    addExact(
      absoluteExact(sideCosineCoefficient, budget),
      absoluteExact(sideSineCoefficient, budget),
      budget,
    ),
    budget,
  ).upper;
  return { implicit, side, sideDerivativeUpper };
}

function certifyCirclePairParameter(
  first: Extract<NeutralCurve, { kind: "circle" }>,
  second: Extract<NeutralCurve, { kind: "circle" }>,
  candidate: number,
  budget: ExactProofBudget,
) {
  if (!neutralCurveSourceParameterInside(first, candidate)) return null;
  for (let refinement = 0; refinement <= 24; refinement += 1) {
    const radius =
      Number.EPSILON * Math.max(1, Math.abs(candidate)) * 2 ** refinement;
    const lower = candidate - radius;
    const upper = candidate + radius;
    if (
      lower >= candidate ||
      upper <= candidate ||
      !neutralCurveSourceParameterInside(first, lower) ||
      !neutralCurveSourceParameterInside(first, upper)
    )
      continue;
    const lowerValue = circlePairImplicitAt(first, second, lower, budget);
    const upperValue = circlePairImplicitAt(first, second, upper, budget);
    if (!lowerValue || !upperValue) continue;
    const signChange =
      (lowerValue.implicit.lower > 0 && upperValue.implicit.upper < 0) ||
      (lowerValue.implicit.upper < 0 && upperValue.implicit.lower > 0);
    if (!signChange) continue;
    const width = outwardNonnegativeDifference(upper, lower, budget);
    const side = intervalHullWithLipschitz(
      lowerValue.side,
      upperValue.side,
      outwardNonnegativeProduct(width, lowerValue.sideDerivativeUpper, budget),
      budget,
    );
    const sideSign = side.lower > 0 ? 1 : side.upper < 0 ? -1 : 0;
    if (sideSign !== 0) {
      return { bounds: [lower, upper] as const, side: sideSign as -1 | 1 };
    }
  }
  return null;
}

export interface NativeCirclePairCandidate {
  readonly firstParameter: number;
  readonly secondParameter: number;
  readonly position: SplineVector;
}

export function certifyCirclePairCandidates(
  request: NeutralCurveQueryRequest & {
    first: Extract<NeutralCurve, { kind: "circle" }>;
    second: Extract<NeutralCurve, { kind: "circle" }>;
  },
  candidates: readonly NativeCirclePairCandidate[],
  budget: ExactProofBudget,
): NeutralCurveQueryResult {
  const exactCount = proveExactCirclePairIntersectionCount(request, budget);
  if (exactCount === null) {
    return {
      kind: "uncertain",
      code: "occ-neutral-curve-identical-elements",
      message: "Coincident circle supports have no isolated root set.",
    };
  }
  if (exactCount === 0)
    return completeIsolated(request, "circlePair", [], budget);
  if (candidates.length !== exactCount) {
    return {
      kind: "uncertain",
      code: "occ-neutral-curve-root-set-incomplete",
      message:
        "Native circle representatives do not cover the exact support-root count.",
    };
  }
  if (exactCount === 1) {
    const displacement = [
      subtractExact(
        exactFractionFromFiniteDouble(request.second.center[0], budget),
        exactFractionFromFiniteDouble(request.first.center[0], budget),
        budget,
      ),
      subtractExact(
        exactFractionFromFiniteDouble(request.second.center[1], budget),
        exactFractionFromFiniteDouble(request.first.center[1], budget),
        budget,
      ),
    ] as const;
    const distanceSquared = addExact(
      multiplyExact(displacement[0], displacement[0], budget),
      multiplyExact(displacement[1], displacement[1], budget),
      budget,
    );
    budget.bigintComparison();
    if (distanceSquared.numerator === 0n) {
      return {
        kind: "uncertain",
        code: "occ-neutral-curve-root-association-unrepresentable",
        message: "The tangent support point is not uniquely representable.",
      };
    }
    const firstRadius = exactFractionFromFiniteDouble(
      request.first.radius,
      budget,
    );
    const secondRadius = exactFractionFromFiniteDouble(
      request.second.radius,
      budget,
    );
    const scale = divideExact(
      addExact(
        subtractExact(
          multiplyExact(firstRadius, firstRadius, budget),
          multiplyExact(secondRadius, secondRadius, budget),
          budget,
        ),
        distanceSquared,
        budget,
      ),
      multiplyExact(
        exactFractionFromFiniteDouble(2, budget),
        distanceSquared,
        budget,
      ),
      budget,
    );
    const firstCenter = exactVector(request.first.center, budget);
    const exactPoint = [
      addExact(
        firstCenter[0],
        multiplyExact(displacement[0], scale, budget),
        budget,
      ),
      addExact(
        firstCenter[1],
        multiplyExact(displacement[1], scale, budget),
        budget,
      ),
    ] as const;
    const candidate = candidates[0]!;
    const firstBounds = certifyExactPointCircleParameter(
      request.first,
      [
        subtractExact(exactPoint[0], firstCenter[0], budget),
        subtractExact(exactPoint[1], firstCenter[1], budget),
      ],
      candidate.firstParameter,
      budget,
    );
    const secondCenter = exactVector(request.second.center, budget);
    const secondBounds = certifyExactPointCircleParameter(
      request.second,
      [
        subtractExact(exactPoint[0], secondCenter[0], budget),
        subtractExact(exactPoint[1], secondCenter[1], budget),
      ],
      candidate.secondParameter,
      budget,
    );
    if (!firstBounds || !secondBounds) {
      return {
        kind: "uncertain",
        code: "occ-neutral-curve-root-association-unrepresentable",
        message:
          "The exact tangent point is outside a certified native angular interval.",
      };
    }
    const position: SplineVector = [
      exactFractionToNumber(exactPoint[0], budget),
      exactFractionToNumber(exactPoint[1], budget),
    ];
    const witness: NeutralCurvePointWitness = {
      classification: "tangent",
      firstParameter: firstBounds.parameter,
      secondParameter: secondBounds.parameter,
      position,
      proof: {
        kind: "nativeAnalyticCircleIntersection",
        firstParameterBounds: firstBounds.bounds,
        secondParameterBounds: secondBounds.bounds,
      },
    };
    return (
      checkNeutralCurvePointConsistency(request, witness) ??
      completeIsolated(request, "circlePair", [witness], budget)
    );
  }
  const certificates = candidates.map((candidate) => ({
    first: certifyCirclePairParameter(
      request.first,
      request.second,
      candidate.firstParameter,
      budget,
    ),
    second: certifyCirclePairParameter(
      request.second,
      request.first,
      candidate.secondParameter,
      budget,
    ),
  }));
  if (certificates.some(({ first, second }) => !first || !second)) {
    return {
      kind: "uncertain",
      code: "occ-neutral-curve-root-association-unrepresentable",
      message: "A circle root lacks a certified angular sign-change interval.",
    };
  }
  const first = certificates[0]!;
  const second = certificates[1]!;
  const disjoint = (
    a: readonly [number, number],
    b: readonly [number, number],
  ) => a[1] < b[0] || b[1] < a[0];
  if (
    !disjoint(first.first!.bounds, second.first!.bounds) ||
    !disjoint(first.second!.bounds, second.second!.bounds) ||
    first.first!.side === second.first!.side ||
    first.second!.side === second.second!.side ||
    first.first!.side !== -first.second!.side ||
    second.first!.side !== -second.second!.side
  ) {
    return {
      kind: "uncertain",
      code: "occ-neutral-curve-root-set-incomplete",
      message:
        "Circle candidates do not inject into both exact root-side classes.",
    };
  }
  const points: NeutralCurvePointWitness[] = candidates.map(
    (candidate, index) => {
      const certificate = certificates[index]!;
      return {
        classification: "crossing",
        firstParameter: candidate.firstParameter,
        secondParameter: candidate.secondParameter,
        position: evaluateNeutralCurve(request.first, candidate.firstParameter),
        proof: {
          kind: "nativeAnalyticCircleIntersection",
          firstParameterBounds: certificate.first!.bounds,
          secondParameterBounds: certificate.second!.bounds,
        },
      };
    },
  );
  for (const point of points) {
    const inconsistency = checkNeutralCurvePointConsistency(request, point);
    if (inconsistency) return inconsistency;
  }
  return completeIsolated(request, "circlePair", points, budget);
}

export function cubicPowerCoefficients(
  cubic: Extract<NeutralCurve, { kind: "cubicBezier" }>,
  budget: ExactProofBudget,
) {
  const active = getNeutralCurveActiveSearchBounds(cubic);
  const lower = normalizedExact(active[0], cubic.sourceDomain, budget);
  const upper = normalizedExact(active[1], cubic.sourceDomain, budget);
  const coordinate = (axis: 0 | 1) => {
    const restricted = restrictCubicBernstein(
      cubic.poles.map((pole) =>
        exactFractionFromFiniteDouble(pole[axis], budget),
      ) as [ExactFraction, ExactFraction, ExactFraction, ExactFraction],
      lower,
      upper,
      budget,
    );
    const [p0, p1, p2, p3] = restricted;
    const three = exactFractionFromFiniteDouble(3, budget);
    return [
      p0,
      multiplyExact(three, subtractExact(p1, p0, budget), budget),
      multiplyExact(
        three,
        addExact(
          subtractExact(
            p2,
            multiplyExact(exactFractionFromFiniteDouble(2, budget), p1, budget),
            budget,
          ),
          p0,
          budget,
        ),
        budget,
      ),
      addExact(
        subtractExact(p3, multiplyExact(three, p2, budget), budget),
        addExact(
          multiplyExact(three, p1, budget),
          negateExact(p0, budget),
          budget,
        ),
        budget,
      ),
    ] as const;
  };
  const x = coordinate(0);
  const y = coordinate(1);
  return [0, 1, 2, 3].map(
    (index) => [x[index]!, y[index]!] as const,
  ) as unknown as readonly [
    readonly [ExactFraction, ExactFraction],
    readonly [ExactFraction, ExactFraction],
    readonly [ExactFraction, ExactFraction],
    readonly [ExactFraction, ExactFraction],
  ];
}

/** Complete degree-six support-root certification for a circle/cubic pair. */
export function certifyCircleCubicPair(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  const firstIsCircle = request.first.kind === "circle";
  const circle = firstIsCircle ? request.first : request.second;
  const cubic = firstIsCircle ? request.second : request.first;
  if (circle.kind !== "circle" || cubic.kind !== "cubicBezier") return null;
  const coefficients = cubicPowerCoefficients(cubic, budget);
  const x = coefficients.map((value) => value[0]) as ExactFraction[];
  const y = coefficients.map((value) => value[1]) as ExactFraction[];
  x[0] = subtractExact(
    x[0]!,
    exactFractionFromFiniteDouble(circle.center[0], budget),
    budget,
  );
  y[0] = subtractExact(
    y[0]!,
    exactFractionFromFiniteDouble(circle.center[1], budget),
    budget,
  );
  const radius = exactFractionFromFiniteDouble(circle.radius, budget);
  const radiusSquared = multiplyExact(radius, radius, budget);
  const support = polynomialAddExact(
    polynomialAddExact(
      polynomialMultiplyExact(x, x, budget),
      polynomialMultiplyExact(y, y, budget),
      budget,
    ),
    [negateExact(radiusSquared, budget)],
    budget,
  );
  const roots = isolateDistinctRoots01(support, budget);
  if (roots === null) {
    return {
      kind: "uncertain",
      code: "circle-cubic-constant-on-circle-degeneracy",
      message:
        "The cubic is constant on the circle support, so no isolated root set exists.",
    };
  }
  if (roots.length > 0) {
    return {
      kind: "uncertain",
      code: "circle-cubic-angular-certification-pending",
      message:
        "The exact circle/cubic support roots require the certified angular parameter owner before promotion.",
    };
  }
  return completeIsolated(request, "circleCubic", [], budget);
}

function isolateQuadraticRoots(
  polynomial: ExactPolynomial,
  budget?: ExactProofBudget,
): readonly (readonly [ExactFraction, ExactFraction])[] {
  const zero = exactFractionFromFiniteDouble(0, budget);
  const one = exactFractionFromFiniteDouble(1, budget);
  const total = countDistinctRoots(polynomial, [zero, one], budget);
  if (total === null) throw new ExactQueryProofBudgetExceeded();
  if (total === 0) return [];
  const roots: (readonly [ExactFraction, ExactFraction])[] = [];
  const queue: {
    lower: ExactFraction;
    upper: ExactFraction;
    count: number;
    depth: number;
  }[] = [{ lower: zero, upper: one, count: total, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.pop()!;
    if (current.depth > 256) throw new ExactQueryProofBudgetExceeded();
    budget?.refinementStep();
    const lowerNumber = exactFractionToNumber(current.lower, budget);
    const upperNumber = exactFractionToNumber(current.upper, budget);
    if (
      current.count === 1 &&
      upperNumber - lowerNumber <=
        Number.EPSILON *
          Math.max(1, Math.abs(lowerNumber), Math.abs(upperNumber)) *
          8
    ) {
      roots.push([current.lower, current.upper]);
      continue;
    }
    const midpoint = divideExact(
      addExact(current.lower, current.upper, budget),
      exactFractionFromFiniteDouble(2, budget),
      budget,
    );
    if (
      compareExact(
        polynomialEvaluate(polynomial, midpoint, budget),
        zero,
        budget,
      ) === 0
    ) {
      roots.push([midpoint, midpoint]);
      const other = subtractExact(
        divideExact(
          negateExact(polynomial[1]!, budget),
          polynomial[2]!,
          budget,
        ),
        midpoint,
        budget,
      );
      if (
        total === 2 &&
        compareExact(other, zero, budget) >= 0 &&
        compareExact(other, one, budget) <= 0
      )
        roots.push([other, other]);
      break;
    }
    const leftCount = countDistinctRoots(
      polynomial,
      [current.lower, midpoint],
      budget,
    );
    const rightCount = countDistinctRoots(
      polynomial,
      [midpoint, current.upper],
      budget,
    );
    if (
      leftCount === null ||
      rightCount === null ||
      leftCount + rightCount !== current.count
    ) {
      throw new ExactQueryProofBudgetExceeded();
    }
    if (rightCount > 0)
      queue.push({
        lower: midpoint,
        upper: current.upper,
        count: rightCount,
        depth: current.depth + 1,
      });
    if (leftCount > 0)
      queue.push({
        lower: current.lower,
        upper: midpoint,
        count: leftCount,
        depth: current.depth + 1,
      });
  }
  return roots.sort((first, second) =>
    compareExact(first[0], second[0], budget),
  );
}

/** Closed-form distinct-parameter cubic self certification with symbolic diagonal exclusion. */
export function certifyCubicSelfIntersection(
  curve: Extract<NeutralCurve, { kind: "cubicBezier" }>,
  modelingTolerance: number,
  budget: ExactProofBudget,
): NeutralCurveQueryResult {
  // Solve on the complete cubic basis. Active-domain filtering happens only
  // after the sole possible off-diagonal pair has been enumerated.
  const selfRequest: NeutralCurveQueryRequest = {
    modelingTolerance,
    first: curve,
    second: curve,
  };
  const coefficients = cubicPowerCoefficients(
    { ...curve, queryDomain: undefined },
    budget,
  );
  const [, c, b, a] = coefficients;
  const zero = exactFractionFromFiniteDouble(0, budget);
  const delta = crossExact(a, b, budget);
  if (compareExact(delta, zero, budget) === 0) {
    const firstRank = compareExact(crossExact(a, c, budget), zero, budget);
    const secondRank = compareExact(crossExact(b, c, budget), zero, budget);
    const constantInconsistent =
      a.every((value) => compareExact(value, zero, budget) === 0) &&
      b.every((value) => compareExact(value, zero, budget) === 0) &&
      c.some((value) => compareExact(value, zero, budget) !== 0);
    return firstRank !== 0 || secondRank !== 0 || constantInconsistent
      ? completeIsolated(selfRequest, "cubicSelf", [], budget, "self")
      : {
          kind: "uncertain",
          code: "cubic-self-degenerate-correspondence",
          message:
            "The degree-reduced cubic has a rank-deficient distinct-parameter correspondence.",
        };
  }
  const negativeC = c.map((value) => negateExact(value, budget)) as [
    ExactFraction,
    ExactFraction,
  ];
  const w = divideExact(crossExact(negativeC, b, budget), delta, budget);
  const sum = divideExact(crossExact(a, negativeC, budget), delta, budget);
  const product = subtractExact(multiplyExact(sum, sum, budget), w, budget);
  const discriminant = subtractExact(
    multiplyExact(sum, sum, budget),
    multiplyExact(exactFractionFromFiniteDouble(4, budget), product, budget),
    budget,
  );
  if (compareExact(discriminant, zero, budget) <= 0) {
    return completeIsolated(selfRequest, "cubicSelf", [], budget, "self");
  }
  const polynomial = [
    product,
    negateExact(sum, budget),
    exactFractionFromFiniteDouble(1, budget),
  ] as const;
  const roots = isolateQuadraticRoots(polynomial, budget);
  if (roots.length !== 2) {
    return completeIsolated(selfRequest, "cubicSelf", [], budget, "self");
  }
  const active = getNeutralCurveActiveSearchBounds(curve);
  const activeLocal = [
    normalizedExact(active[0], curve.sourceDomain, budget),
    normalizedExact(active[1], curve.sourceDomain, budget),
  ] as const;
  const inside = roots.map(
    ([lower, upper]) =>
      compareExact(lower, activeLocal[0], budget) >= 0 &&
      compareExact(upper, activeLocal[1], budget) <= 0,
  );
  const outside = roots.map(
    ([lower, upper]) =>
      compareExact(upper, activeLocal[0], budget) < 0 ||
      compareExact(lower, activeLocal[1], budget) > 0,
  );
  if (inside.some((value, index) => !value && !outside[index])) {
    return {
      kind: "uncertain",
      code: "cubic-self-active-boundary-unresolved",
      message:
        "An exact cubic self parameter cannot be separated from an active-domain boundary.",
    };
  }
  if (!inside.every(Boolean))
    return completeIsolated(selfRequest, "cubicSelf", [], budget, "self");

  const sourceBounds = roots.map(([lower, upper]) => {
    const sourceLower = exactFractionFromFiniteDouble(
      curve.sourceDomain[0],
      budget,
    );
    const sourceScale = subtractExact(
      exactFractionFromFiniteDouble(curve.sourceDomain[1], budget),
      sourceLower,
      budget,
    );
    const mappedLower = addExact(
      sourceLower,
      multiplyExact(lower, sourceScale, budget),
      budget,
    );
    const mappedUpper = addExact(
      sourceLower,
      multiplyExact(upper, sourceScale, budget),
      budget,
    );
    return [
      outwardExactNumber(mappedLower, "down", budget),
      outwardExactNumber(mappedUpper, "up", budget),
    ] as const;
  });
  const parameters = sourceBounds.map(([lower, upper]) =>
    lower === upper ? lower : (lower + upper) / 2,
  );
  const firstPosition = evaluateNeutralCurve(curve, parameters[0]!);
  const secondPosition = evaluateNeutralCurve(curve, parameters[1]!);
  const position: SplineVector = [
    (firstPosition[0] + secondPosition[0]) / 2,
    (firstPosition[1] + secondPosition[1]) / 2,
  ];
  const witness: NeutralCurvePointWitness = {
    classification: "crossing",
    firstParameter: parameters[0]!,
    secondParameter: parameters[1]!,
    position,
    proof: {
      kind: "exactAlgebraicCurveRootSet",
      family: "cubicSelf",
      firstParameterBounds: sourceBounds[0]!,
      secondParameterBounds: sourceBounds[1]!,
    },
  };
  const consistency = checkNeutralCurvePointConsistency(
    { modelingTolerance, first: curve, second: curve },
    witness,
  );
  return consistency
    ? {
        kind: "uncertain",
        code: "cubic-self-witness-numerically-unrepresentable",
        message:
          "The exact cubic self pair has no consistent binary64 witness.",
      }
    : completeIsolated(selfRequest, "cubicSelf", [witness], budget, "self");
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
  budget: ExactProofBudget,
): NeutralCurveOverlapWitness | null {
  const overlap = exactStructuralCubicOverlap(first, second, budget);
  if (!overlap || first.kind !== "cubicBezier" || second.kind !== "cubicBezier")
    return null;
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
      : mapNormalizedExactToDomain(lower, first.sourceDomain, false, budget),
    upperFromFirst
      ? firstActive[1]
      : mapNormalizedExactToDomain(upper, first.sourceDomain, false, budget),
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
          : mapNormalizedExactToDomain(
              lower,
              second.sourceDomain,
              true,
              budget,
            ),
        secondLowerFromOwnBoundary
          ? secondActive[0]
          : mapNormalizedExactToDomain(
              upper,
              second.sourceDomain,
              true,
              budget,
            ),
      ]
    : [
        secondLowerFromOwnBoundary
          ? secondActive[0]
          : mapNormalizedExactToDomain(
              lower,
              second.sourceDomain,
              false,
              budget,
            ),
        secondUpperFromOwnBoundary
          ? secondActive[1]
          : mapNormalizedExactToDomain(
              upper,
              second.sourceDomain,
              false,
              budget,
            ),
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

/** Complete same/reversed cubic query, including the off-diagonal self pair. */
export function certifyStructuralCubicPair(
  request: NeutralCurveQueryRequest & {
    first: Extract<NeutralCurve, { kind: "cubicBezier" }>;
    second: Extract<NeutralCurve, { kind: "cubicBezier" }>;
  },
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  if (!haveExactStructuralCubicBasis(request.first, request.second))
    return null;
  const reversed = request.first.poles.every((pole, index) =>
    sameVector(pole, request.second.poles[3 - index]!),
  );
  const firstActive = getNeutralCurveActiveSearchBounds(request.first);
  const secondActive = getNeutralCurveActiveSearchBounds(request.second);
  const firstLocal = [
    normalizedExact(firstActive[0], request.first.sourceDomain, budget),
    normalizedExact(firstActive[1], request.first.sourceDomain, budget),
  ] as const;
  const secondLocal = [
    normalizedExact(secondActive[0], request.second.sourceDomain, budget),
    normalizedExact(secondActive[1], request.second.sourceDomain, budget),
  ] as const;
  const secondInFirstBasis: readonly [ExactFraction, ExactFraction] = reversed
    ? [
        reverseExact(secondLocal[1], budget),
        reverseExact(secondLocal[0], budget),
      ]
    : secondLocal;
  const lower =
    compareExact(firstLocal[0], secondInFirstBasis[0], budget) >= 0
      ? firstLocal[0]
      : secondInFirstBasis[0];
  const upper =
    compareExact(firstLocal[1], secondInFirstBasis[1], budget) <= 0
      ? firstLocal[1]
      : secondInFirstBasis[1];
  const correspondenceComparison = compareExact(lower, upper, budget);
  const overlap = proveStructuralCubicOverlap(
    request.first,
    request.second,
    budget,
  );
  if (correspondenceComparison < 0 && !overlap) {
    return {
      kind: "uncertain",
      code: "structural-cubic-overlap-numerically-unrepresentable",
      message:
        "The exact cubic active ranges overlap, but their correspondence is not representable by finite binary64 intervals.",
    };
  }

  const fullSelf = certifyCubicSelfIntersection(
    { ...request.first, queryDomain: undefined },
    request.modelingTolerance,
    budget,
  );
  if (fullSelf.kind !== "verified") return fullSelf;

  const mapFirstExactToSecond = (parameter: ExactFraction) => {
    const local = divideExact(
      subtractExact(
        parameter,
        exactFractionFromFiniteDouble(request.first.sourceDomain[0], budget),
        budget,
      ),
      subtractExact(
        exactFractionFromFiniteDouble(request.first.sourceDomain[1], budget),
        exactFractionFromFiniteDouble(request.first.sourceDomain[0], budget),
        budget,
      ),
      budget,
    );
    return addExact(
      exactFractionFromFiniteDouble(request.second.sourceDomain[0], budget),
      multiplyExact(
        reversed ? reverseExact(local, budget) : local,
        subtractExact(
          exactFractionFromFiniteDouble(request.second.sourceDomain[1], budget),
          exactFractionFromFiniteDouble(request.second.sourceDomain[0], budget),
          budget,
        ),
        budget,
      ),
      budget,
    );
  };
  const mapBoundsToSecond = (bounds: readonly [number, number]) => {
    const first = mapFirstExactToSecond(
      exactFractionFromFiniteDouble(bounds[0], budget),
    );
    const second = mapFirstExactToSecond(
      exactFractionFromFiniteDouble(bounds[1], budget),
    );
    const lowerBound =
      compareExact(first, second, budget) <= 0 ? first : second;
    const upperBound =
      compareExact(first, second, budget) <= 0 ? second : first;
    return [
      outwardExactNumber(lowerBound, "down", budget),
      outwardExactNumber(upperBound, "up", budget),
    ] as const;
  };
  const boundsDisposition = (
    bounds: readonly [number, number],
    active: readonly [number, number],
  ) => {
    const lowerBound = exactFractionFromFiniteDouble(bounds[0], budget);
    const upperBound = exactFractionFromFiniteDouble(bounds[1], budget);
    const activeLower = exactFractionFromFiniteDouble(active[0], budget);
    const activeUpper = exactFractionFromFiniteDouble(active[1], budget);
    if (
      compareExact(lowerBound, activeLower, budget) >= 0 &&
      compareExact(upperBound, activeUpper, budget) <= 0
    )
      return "inside" as const;
    if (
      compareExact(upperBound, activeLower, budget) < 0 ||
      compareExact(lowerBound, activeUpper, budget) > 0
    )
      return "outside" as const;
    return "unresolved" as const;
  };

  const points: NeutralCurvePointWitness[] = [];
  const selfPoint = fullSelf.points[0];
  if (selfPoint) {
    const assignments = [
      [
        selfPoint.firstParameter,
        selfPoint.secondParameter,
        selfPoint.proof.firstParameterBounds,
        selfPoint.proof.secondParameterBounds,
      ],
      [
        selfPoint.secondParameter,
        selfPoint.firstParameter,
        selfPoint.proof.secondParameterBounds,
        selfPoint.proof.firstParameterBounds,
      ],
    ] as const;
    for (const [
      firstParameter,
      secondOnFirst,
      firstBounds,
      secondOnFirstBounds,
    ] of assignments) {
      const secondBounds = mapBoundsToSecond(secondOnFirstBounds);
      const firstDisposition = boundsDisposition(firstBounds, firstActive);
      const secondDisposition = boundsDisposition(secondBounds, secondActive);
      if (
        firstDisposition === "unresolved" ||
        secondDisposition === "unresolved"
      ) {
        return {
          kind: "uncertain",
          code: "structural-cubic-self-pair-boundary-unresolved",
          message:
            "An off-correspondence cubic self pair cannot be separated from an active-domain boundary.",
        };
      }
      if (firstDisposition !== "inside" || secondDisposition !== "inside")
        continue;
      const secondParameter = exactFractionToNumber(
        mapFirstExactToSecond(
          exactFractionFromFiniteDouble(secondOnFirst, budget),
        ),
        budget,
      );
      const witness: NeutralCurvePointWitness = {
        classification: selfPoint.classification,
        firstParameter,
        secondParameter,
        position: selfPoint.position,
        proof: {
          kind: "exactAlgebraicCurveRootSet",
          family: "cubicCubic",
          firstParameterBounds: firstBounds,
          secondParameterBounds: secondBounds,
        },
      };
      const inconsistency = checkNeutralCurvePointConsistency(request, witness);
      if (inconsistency) return inconsistency;
      points.push(witness);
    }
  }

  let correspondencePointCount: 0 | 1 = 0;
  if (correspondenceComparison === 0) {
    const firstExact = addExact(
      exactFractionFromFiniteDouble(request.first.sourceDomain[0], budget),
      multiplyExact(
        lower,
        subtractExact(
          exactFractionFromFiniteDouble(request.first.sourceDomain[1], budget),
          exactFractionFromFiniteDouble(request.first.sourceDomain[0], budget),
          budget,
        ),
        budget,
      ),
      budget,
    );
    const secondExact = mapFirstExactToSecond(firstExact);
    const firstParameter = exactFractionToNumber(firstExact, budget);
    const secondParameter = exactFractionToNumber(secondExact, budget);
    const position = evaluateNeutralCurve(request.first, firstParameter);
    const endpoint: NeutralCurvePointWitness = {
      classification: "unclassified",
      firstParameter,
      secondParameter,
      position,
      proof: {
        kind: "exactStructuralCubicCorrespondenceEndpoint",
        poleOrder: reversed ? "reversed" : "same",
        firstProvenance: request.first.provenance,
        secondProvenance: request.second.provenance,
        firstParameterBounds: [firstParameter, firstParameter],
        secondParameterBounds: [secondParameter, secondParameter],
      },
    };
    const inconsistency = checkNeutralCurvePointConsistency(request, endpoint);
    if (inconsistency) return inconsistency;
    points.push(endpoint);
    correspondencePointCount = 1;
  }

  return admitVerifiedNeutralCurveResult(
    request,
    points,
    overlap ? [overlap] : [],
    {
      kind: "completeStructuralCorrespondence",
      family: "structuralCubicOverlap",
      correspondence:
        correspondenceComparison > 0
          ? "disjoint"
          : overlap
            ? "interval"
            : "endpoint",
      correspondencePointCount,
      offCorrespondenceDistinctRootCount:
        points.length - correspondencePointCount,
    },
    budget,
    "pair",
  );
}
