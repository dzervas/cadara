import {
  checkNeutralCurvePointConsistency,
  evaluateNeutralCurve,
  getNeutralCurveActiveSearchBounds,
  type NeutralCurve,
  type NeutralCurvePointWitness,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
} from "@/contracts/modeling/neutral-curve-query";
import {
  admitVerifiedNeutralCurveResult,
  certifyStructuralCubicPair,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  addExact,
  compareExact,
  divideExact,
  exact,
  exactFromNumber,
  isolateDistinctRootsClosed,
  multiplyExact,
  negateExact,
  nextBinary64,
  outwardExactNumber,
  polynomialAdd,
  polynomialDerivative,
  polynomialIntervalEvaluate,
  polynomialIsZero,
  polynomialMultiply,
  polynomialRemainder,
  polynomialScale,
  polynomialTrim,
  refineIsolatedRoot,
  signAtIsolatedRoot,
  subtractExact,
  type ExactFraction,
  type ExactInterval,
  type ExactPolynomial,
  type ExactProofBudgetSnapshot,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

type Cubic = Extract<NeutralCurve, { kind: "cubicBezier" }>;
type CoefficientInEliminated = ExactPolynomial;
type SeparatedEquation = readonly CoefficientInEliminated[];

const ZERO: ExactFraction = { numerator: 0n, denominator: 1n };
const ONE: ExactFraction = { numerator: 1n, denominator: 1n };
const MAX_RESULTANT_DEGREE = 9;
const MAX_DETERMINANT_INTERMEDIATE_DEGREE = 18;
const MAX_SUBRESULTANT_COEFFICIENT_DEGREE = 12;
const MAX_CLEARED_SUBSTITUTION_DEGREE = 39;
const MAX_RETAINED_PAIRS = 9;

type AttemptResult =
  | {
      readonly kind: "complete";
      readonly points: readonly NeutralCurvePointWitness[];
    }
  | { readonly kind: "retry" }
  | { readonly kind: "zeroResultant" };

function interpolate(
  first: ExactFraction,
  second: ExactFraction,
  parameter: ExactFraction,
  budget: ExactProofBudget,
) {
  return addExact(
    first,
    multiplyExact(parameter, subtractExact(second, first, budget), budget),
    budget,
  );
}

function restrictBernstein(
  coefficients: readonly [
    ExactFraction,
    ExactFraction,
    ExactFraction,
    ExactFraction,
  ],
  lower: ExactFraction,
  upper: ExactFraction,
  budget: ExactProofBudget,
) {
  const split = (
    values: readonly [
      ExactFraction,
      ExactFraction,
      ExactFraction,
      ExactFraction,
    ],
    parameter: ExactFraction,
  ) => {
    const first = [
      interpolate(values[0], values[1], parameter, budget),
      interpolate(values[1], values[2], parameter, budget),
      interpolate(values[2], values[3], parameter, budget),
    ] as const;
    const second = [
      interpolate(first[0], first[1], parameter, budget),
      interpolate(first[1], first[2], parameter, budget),
    ] as const;
    const value = interpolate(second[0], second[1], parameter, budget);
    return {
      left: [values[0], first[0], second[0], value] as const,
      right: [value, second[1], first[2], values[3]] as const,
    };
  };
  const afterLower = split(coefficients, lower).right;
  const within = divideExact(
    subtractExact(upper, lower, budget),
    subtractExact(ONE, lower, budget),
    budget,
  );
  return split(afterLower, within).left;
}

function activePowerCoefficients(cubic: Cubic, budget: ExactProofBudget) {
  const active = getNeutralCurveActiveSearchBounds(cubic);
  const sourceLower = exactFromNumber(cubic.sourceDomain[0], budget);
  const sourceScale = subtractExact(
    exactFromNumber(cubic.sourceDomain[1], budget),
    sourceLower,
    budget,
  );
  const lower = divideExact(
    subtractExact(exactFromNumber(active[0], budget), sourceLower, budget),
    sourceScale,
    budget,
  );
  const upper = divideExact(
    subtractExact(exactFromNumber(active[1], budget), sourceLower, budget),
    sourceScale,
    budget,
  );
  const coordinate = (axis: 0 | 1) => {
    const restricted = restrictBernstein(
      cubic.poles.map((pole) =>
        exactFromNumber(pole[axis], budget),
      ) as unknown as readonly [
        ExactFraction,
        ExactFraction,
        ExactFraction,
        ExactFraction,
      ],
      lower,
      upper,
      budget,
    );
    const [p0, p1, p2, p3] = restricted;
    const three = exact(3n, 1n, budget);
    return [
      p0,
      multiplyExact(three, subtractExact(p1, p0, budget), budget),
      multiplyExact(
        three,
        addExact(
          subtractExact(
            p2,
            multiplyExact(exact(2n, 1n, budget), p1, budget),
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
  return { x: coordinate(0), y: coordinate(1), active };
}

function separatedEquations(
  projected: ReturnType<typeof activePowerCoefficients>,
  eliminated: ReturnType<typeof activePowerCoefficients>,
  budget: ExactProofBudget,
) {
  const equation = (
    projectedCoordinate: ExactPolynomial,
    eliminatedCoordinate: ExactPolynomial,
  ): SeparatedEquation => {
    const coefficients: ExactPolynomial[] = [
      polynomialAdd(
        projectedCoordinate,
        [negateExact(eliminatedCoordinate[0]!, budget)],
        budget,
      ),
    ];
    for (let index = 1; index < eliminatedCoordinate.length; index += 1) {
      coefficients.push([negateExact(eliminatedCoordinate[index]!, budget)]);
    }
    while (
      coefficients.length > 1 &&
      polynomialIsZero(coefficients.at(-1)!, budget)
    )
      coefficients.pop();
    return coefficients;
  };
  return [
    equation(projected.x, eliminated.x),
    equation(projected.y, eliminated.y),
  ] as const;
}

function polynomialSubtract(
  first: ExactPolynomial,
  second: ExactPolynomial,
  budget: ExactProofBudget,
) {
  return polynomialAdd(
    first,
    polynomialScale(second, exact(-1n, 1n, budget), budget),
    budget,
  );
}

function determinant(
  matrix: readonly (readonly ExactPolynomial[])[],
  budget: ExactProofBudget,
): ExactPolynomial {
  if (matrix.length === 0) return [ONE];
  if (matrix.length === 1) {
    budget.determinantTerm();
    return polynomialTrim(matrix[0]![0]!, budget);
  }
  let result: ExactPolynomial = [ZERO];
  for (let column = 0; column < matrix.length; column += 1) {
    const minor = matrix
      .slice(1)
      .map((row) => row.filter((_, index) => index !== column));
    let term = polynomialMultiply(
      matrix[0]![column]!,
      determinant(minor, budget),
      budget,
    );
    if (term.length - 1 > MAX_DETERMINANT_INTERMEDIATE_DEGREE)
      throw new Error("Fixed determinant intermediate degree exceeded");
    if (column % 2 === 1)
      term = polynomialScale(term, exact(-1n, 1n, budget), budget);
    result = polynomialAdd(result, term, budget);
  }
  return polynomialTrim(result, budget);
}

function sylvesterResultant(
  first: SeparatedEquation,
  second: SeparatedEquation,
  budget: ExactProofBudget,
) {
  const firstDegree = first.length - 1;
  const secondDegree = second.length - 1;
  if (firstDegree === 0 || secondDegree === 0) return null;
  const size = firstDegree + secondDegree;
  if (size > 6) throw new Error("Fixed Sylvester matrix size exceeded");
  const zero = [ZERO] as const;
  const descendingFirst = [...first].reverse();
  const descendingSecond = [...second].reverse();
  const rows: ExactPolynomial[][] = [];
  for (let shift = 0; shift < secondDegree; shift += 1) {
    rows.push(
      Array.from(
        { length: size },
        (_, column) => descendingFirst[column - shift] ?? zero,
      ),
    );
  }
  for (let shift = 0; shift < firstDegree; shift += 1) {
    rows.push(
      Array.from(
        { length: size },
        (_, column) => descendingSecond[column - shift] ?? zero,
      ),
    );
  }
  const result = polynomialTrim(determinant(rows, budget), budget);
  if (result.length - 1 > MAX_RESULTANT_DEGREE)
    throw new Error("Cancelled cubic resultant degree exceeded");
  return result;
}

/** Direct fixed degree-one subresultant: two maximal minors of M₁. */
function linearSubresultant(
  first: SeparatedEquation,
  second: SeparatedEquation,
  budget: ExactProofBudget,
) {
  const firstDegree = first.length - 1;
  const secondDegree = second.length - 1;
  const rowCount = firstDegree + secondDegree - 2;
  const columnCount = rowCount + 1;
  const zero = [ZERO] as const;
  const descendingFirst = [...first].reverse();
  const descendingSecond = [...second].reverse();
  const rows: ExactPolynomial[][] = [];
  for (let shift = 0; shift < secondDegree - 1; shift += 1) {
    rows.push(
      Array.from(
        { length: columnCount },
        (_, column) => descendingFirst[column - shift] ?? zero,
      ),
    );
  }
  for (let shift = 0; shift < firstDegree - 1; shift += 1) {
    rows.push(
      Array.from(
        { length: columnCount },
        (_, column) => descendingSecond[column - shift] ?? zero,
      ),
    );
  }
  // If one input is linear, M₁ has no rows and that input itself is S₁.
  if (rowCount === 0) {
    const linear = firstDegree === 1 ? first : second;
    return { a: linear[1]!, b: linear[0]! };
  }
  const minor = (deletedColumn: number) =>
    determinant(
      rows.map((row) => row.filter((_, column) => column !== deletedColumn)),
      budget,
    );
  const candidate = {
    a: minor(columnCount - 1),
    b: minor(columnCount - 2),
  };
  if (
    candidate.a.length - 1 > MAX_SUBRESULTANT_COEFFICIENT_DEGREE ||
    candidate.b.length - 1 > MAX_SUBRESULTANT_COEFFICIENT_DEGREE
  )
    throw new Error("Fixed S1 coefficient degree exceeded");
  return candidate;
}

function polynomialPower(
  base: ExactPolynomial,
  exponent: number,
  budget: ExactProofBudget,
) {
  let result: ExactPolynomial = [ONE];
  for (let index = 0; index < exponent; index += 1)
    result = polynomialMultiply(result, base, budget);
  return result;
}

function clearedSubstitution(
  equation: SeparatedEquation,
  a: ExactPolynomial,
  b: ExactPolynomial,
  budget: ExactProofBudget,
) {
  const degree = equation.length - 1;
  let result: ExactPolynomial = [ZERO];
  const negativeB = polynomialScale(b, exact(-1n, 1n, budget), budget);
  for (let index = 0; index <= degree; index += 1) {
    const term = polynomialMultiply(
      equation[index]!,
      polynomialMultiply(
        polynomialPower(negativeB, index, budget),
        polynomialPower(a, degree - index, budget),
        budget,
      ),
      budget,
    );
    result = polynomialAdd(result, term, budget);
  }
  result = polynomialTrim(result, budget);
  if (result.length - 1 > MAX_CLEARED_SUBSTITUTION_DEGREE)
    throw new Error("Cleared substitution degree exceeded");
  return result;
}

function signAt(
  rootPolynomial: ExactPolynomial,
  root: ExactInterval,
  value: ExactPolynomial,
  budget: ExactProofBudget,
) {
  return signAtIsolatedRoot(rootPolynomial, root, value, budget).sign;
}

/** Narrow guard used independently for each cleared F/G projection equation. */
export function clearedCubicProjectionEquationHolds(
  resultant: ExactPolynomial,
  root: ExactInterval,
  clearedEquation: ExactPolynomial,
  isResultantIdentity: boolean,
  budget: ExactProofBudget,
) {
  return (
    isResultantIdentity ||
    signAt(resultant, root, clearedEquation, budget) === 0
  );
}

function intervalMultiply(
  first: ExactInterval,
  second: ExactInterval,
  budget: ExactProofBudget,
): ExactInterval {
  const products = [
    multiplyExact(first[0], second[0], budget),
    multiplyExact(first[0], second[1], budget),
    multiplyExact(first[1], second[0], budget),
    multiplyExact(first[1], second[1], budget),
  ];
  let lower = products[0]!;
  let upper = products[0]!;
  for (const value of products.slice(1)) {
    if (compareExact(value, lower, budget) < 0) lower = value;
    if (compareExact(value, upper, budget) > 0) upper = value;
  }
  return [lower, upper];
}

function intervalDivide(
  numerator: ExactInterval,
  positiveDenominator: ExactInterval,
  budget: ExactProofBudget,
): ExactInterval {
  if (compareExact(positiveDenominator[0], ZERO, budget) <= 0)
    throw new RangeError("Interval division requires a positive denominator");
  const quotients = [
    divideExact(numerator[0], positiveDenominator[0], budget),
    divideExact(numerator[0], positiveDenominator[1], budget),
    divideExact(numerator[1], positiveDenominator[0], budget),
    divideExact(numerator[1], positiveDenominator[1], budget),
  ];
  let lower = quotients[0]!;
  let upper = quotients[0]!;
  for (const value of quotients.slice(1)) {
    if (compareExact(value, lower, budget) < 0) lower = value;
    if (compareExact(value, upper, budget) > 0) upper = value;
  }
  return [lower, upper];
}

function ratioBounds(
  rootPolynomial: ExactPolynomial,
  initialRoot: ExactInterval,
  numerator: ExactPolynomial,
  denominator: ExactPolynomial,
  budget: ExactProofBudget,
) {
  let root = initialRoot;
  for (;;) {
    const numeratorInterval = polynomialIntervalEvaluate(
      numerator,
      root,
      budget,
    );
    const denominatorInterval = polynomialIntervalEvaluate(
      denominator,
      root,
      budget,
    );
    if (
      compareExact(denominatorInterval[0], ZERO, budget) > 0 ||
      compareExact(denominatorInterval[1], ZERO, budget) < 0
    ) {
      const quotients = [
        divideExact(numeratorInterval[0], denominatorInterval[0], budget),
        divideExact(numeratorInterval[0], denominatorInterval[1], budget),
        divideExact(numeratorInterval[1], denominatorInterval[0], budget),
        divideExact(numeratorInterval[1], denominatorInterval[1], budget),
      ];
      let lower = quotients[0]!;
      let upper = quotients[0]!;
      for (const value of quotients.slice(1)) {
        if (compareExact(value, lower, budget) < 0) lower = value;
        if (compareExact(value, upper, budget) > 0) upper = value;
      }
      return { root, ratio: [lower, upper] as ExactInterval };
    }
    root = refineIsolatedRoot(rootPolynomial, root, budget);
  }
}

function mapBoundsToSource(
  bounds: ExactInterval,
  domain: readonly [number, number],
  budget: ExactProofBudget,
) {
  const lower = exactFromNumber(domain[0], budget);
  const scale = subtractExact(
    exactFromNumber(domain[1], budget),
    lower,
    budget,
  );
  return [
    outwardExactNumber(
      addExact(lower, multiplyExact(bounds[0], scale, budget), budget),
      "down",
      budget,
    ),
    outwardExactNumber(
      addExact(lower, multiplyExact(bounds[1], scale, budget), budget),
      "up",
      budget,
    ),
  ] as const;
}

function representative(bounds: readonly [number, number]) {
  if (bounds[0] === bounds[1]) return bounds[0];
  const midpoint = bounds[0] / 2 + bounds[1] / 2;
  return Math.min(bounds[1], Math.max(bounds[0], midpoint));
}

function derivativeAfterSubstitution(
  coordinate: ExactPolynomial,
  a: ExactPolynomial,
  b: ExactPolynomial,
  budget: ExactProofBudget,
) {
  const derivative = polynomialDerivative(coordinate, budget);
  const equation = derivative.map((coefficient) => [
    coefficient,
  ]) as SeparatedEquation;
  return clearedSubstitution(equation, a, b, budget);
}

function rootMultiplicity(
  fullResultant: ExactPolynomial,
  squareFreeRootPolynomial: ExactPolynomial,
  root: ExactInterval,
  budget: ExactProofBudget,
) {
  let derivative = fullResultant;
  let multiplicity = 0;
  while (
    derivative.length > 1 &&
    signAt(squareFreeRootPolynomial, root, derivative, budget) === 0
  ) {
    multiplicity += 1;
    derivative = polynomialDerivative(derivative, budget);
  }
  return multiplicity;
}

function makePoint(
  request: NeutralCurveQueryRequest & { first: Cubic; second: Cubic },
  projectedIsFirst: boolean,
  projectedData: ReturnType<typeof activePowerCoefficients>,
  eliminatedData: ReturnType<typeof activePowerCoefficients>,
  fullResultant: ExactPolynomial,
  rootPolynomial: ExactPolynomial,
  root: ExactInterval,
  a: ExactPolynomial,
  b: ExactPolynomial,
  budget: ExactProofBudget,
): NeutralCurvePointWitness | null {
  const negativeB = polynomialScale(b, exact(-1n, 1n, budget), budget);
  const ratio = ratioBounds(rootPolynomial, root, negativeB, a, budget);
  const projectedBounds = mapBoundsToSource(
    ratio.root,
    projectedData.active,
    budget,
  );
  const eliminatedBounds = mapBoundsToSource(
    ratio.ratio,
    eliminatedData.active,
    budget,
  );
  const firstBounds = projectedIsFirst ? projectedBounds : eliminatedBounds;
  const secondBounds = projectedIsFirst ? eliminatedBounds : projectedBounds;
  const firstParameter = representative(firstBounds);
  const secondParameter = representative(secondBounds);

  const projectedDx = polynomialDerivative(projectedData.x, budget);
  const projectedDy = polynomialDerivative(projectedData.y, budget);
  const eliminatedDx = derivativeAfterSubstitution(
    eliminatedData.x,
    a,
    b,
    budget,
  );
  const eliminatedDy = derivativeAfterSubstitution(
    eliminatedData.y,
    a,
    b,
    budget,
  );
  const determinant = polynomialSubtract(
    polynomialMultiply(projectedDx, eliminatedDy, budget),
    polynomialMultiply(projectedDy, eliminatedDx, budget),
    budget,
  );
  const projectedRegular =
    signAt(rootPolynomial, root, projectedDx, budget) !== 0 ||
    signAt(rootPolynomial, root, projectedDy, budget) !== 0;
  const eliminatedRegular =
    signAt(rootPolynomial, root, eliminatedDx, budget) !== 0 ||
    signAt(rootPolynomial, root, eliminatedDy, budget) !== 0;
  const determinantSign = signAt(rootPolynomial, root, determinant, budget);
  const projectedEndpoint =
    (compareExact(ratio.root[0], ZERO, budget) === 0 &&
      compareExact(ratio.root[1], ZERO, budget) === 0) ||
    (compareExact(ratio.root[0], ONE, budget) === 0 &&
      compareExact(ratio.root[1], ONE, budget) === 0);
  const betaAtZero = signAt(rootPolynomial, root, b, budget) === 0;
  const betaAtOne =
    signAt(rootPolynomial, root, polynomialAdd(a, b, budget), budget) === 0;
  const boundary = projectedEndpoint || betaAtZero || betaAtOne;
  const multiplicity = rootMultiplicity(
    fullResultant,
    rootPolynomial,
    root,
    budget,
  );
  const classification =
    boundary || !projectedRegular || !eliminatedRegular
      ? "unclassified"
      : determinantSign !== 0
        ? "crossing"
        : multiplicity > 0 && multiplicity % 2 === 0
          ? "tangent"
          : multiplicity >= 3 && multiplicity % 2 === 1
            ? "crossing"
            : "unclassified";

  let determinantBounds: readonly [number, number] | undefined;
  if (classification === "crossing" && determinantSign !== 0 && !boundary) {
    const determinantInterval = polynomialIntervalEvaluate(
      determinant,
      ratio.root,
      budget,
    );
    const aInterval = polynomialIntervalEvaluate(a, ratio.root, budget);
    const denominator = intervalMultiply(aInterval, aInterval, budget);
    const firstScale = subtractExact(
      exactFromNumber(
        request.first.queryDomain?.[1] ?? request.first.sourceDomain[1],
        budget,
      ),
      exactFromNumber(
        request.first.queryDomain?.[0] ?? request.first.sourceDomain[0],
        budget,
      ),
      budget,
    );
    const secondScale = subtractExact(
      exactFromNumber(
        request.second.queryDomain?.[1] ?? request.second.sourceDomain[1],
        budget,
      ),
      exactFromNumber(
        request.second.queryDomain?.[0] ?? request.second.sourceDomain[0],
        budget,
      ),
      budget,
    );
    const sourceDenominator = intervalMultiply(
      denominator,
      [
        multiplyExact(firstScale, secondScale, budget),
        multiplyExact(firstScale, secondScale, budget),
      ],
      budget,
    );
    if (compareExact(sourceDenominator[0], ZERO, budget) > 0) {
      const quotient = intervalDivide(
        determinantInterval,
        sourceDenominator,
        budget,
      );
      const oriented = projectedIsFirst
        ? quotient
        : ([
            negateExact(quotient[1], budget),
            negateExact(quotient[0], budget),
          ] as const);
      const converted = [
        nextBinary64(
          outwardExactNumber(oriented[0], "down", budget),
          "down",
          budget,
        ),
        nextBinary64(
          outwardExactNumber(oriented[1], "up", budget),
          "up",
          budget,
        ),
      ] as const;
      if (
        converted.every(Number.isFinite) &&
        (converted[0] > 0 || converted[1] < 0)
      )
        determinantBounds = converted;
    }
  }

  const point: NeutralCurvePointWitness = {
    classification,
    firstParameter,
    secondParameter,
    position: evaluateNeutralCurve(request.first, firstParameter),
    proof: {
      kind: "exactCubicPairRootSet",
      firstParameterBounds: firstBounds,
      secondParameterBounds: secondBounds,
      ...(determinantBounds
        ? { sourceUnitTangentDeterminantBounds: determinantBounds }
        : {}),
    },
  };
  return checkNeutralCurvePointConsistency(request, point) ? null : point;
}

function attemptProjection(
  request: NeutralCurveQueryRequest & { first: Cubic; second: Cubic },
  projectedIsFirst: boolean,
  firstData: ReturnType<typeof activePowerCoefficients>,
  secondData: ReturnType<typeof activePowerCoefficients>,
  budget: ExactProofBudget,
): AttemptResult {
  budget.projectionAttempt();
  const projected = projectedIsFirst ? firstData : secondData;
  const eliminated = projectedIsFirst ? secondData : firstData;
  const [firstEquation, secondEquation] = separatedEquations(
    projected,
    eliminated,
    budget,
  );
  if (firstEquation.length === 1 || secondEquation.length === 1)
    return { kind: "retry" };
  const resultant = sylvesterResultant(firstEquation, secondEquation, budget)!;
  if (polynomialIsZero(resultant, budget)) return { kind: "zeroResultant" };
  const isolatedRoots = isolateDistinctRootsClosed(
    resultant,
    [ZERO, ONE],
    budget,
  );
  if (isolatedRoots === null) return { kind: "zeroResultant" };
  if (isolatedRoots.length > MAX_RETAINED_PAIRS)
    throw new Error("Cubic pair root cap exceeded");
  const roots = [...isolatedRoots];
  for (let index = 1; index < roots.length; index += 1) {
    while (compareExact(roots[index - 1]![1], roots[index]![0], budget) >= 0) {
      roots[index - 1] = refineIsolatedRoot(
        resultant,
        roots[index - 1]!,
        budget,
      );
      roots[index] = refineIsolatedRoot(resultant, roots[index]!, budget);
    }
  }
  const candidate = linearSubresultant(firstEquation, secondEquation, budget);
  const clearedFirst = clearedSubstitution(
    firstEquation,
    candidate.a,
    candidate.b,
    budget,
  );
  const clearedSecond = clearedSubstitution(
    secondEquation,
    candidate.a,
    candidate.b,
    budget,
  );
  const firstIdentity = polynomialIsZero(
    polynomialRemainder(clearedFirst, resultant, budget),
    budget,
  );
  const secondIdentity = polynomialIsZero(
    polynomialRemainder(clearedSecond, resultant, budget),
    budget,
  );
  const points: NeutralCurvePointWitness[] = [];
  for (const root of roots) {
    const aSign = signAt(resultant, root, candidate.a, budget);
    if (aSign === 0) return { kind: "retry" };
    if (
      !clearedCubicProjectionEquationHolds(
        resultant,
        root,
        clearedFirst,
        firstIdentity,
        budget,
      ) ||
      !clearedCubicProjectionEquationHolds(
        resultant,
        root,
        clearedSecond,
        secondIdentity,
        budget,
      )
    )
      return { kind: "retry" };
    const bSign = signAt(resultant, root, candidate.b, budget);
    const sumSign = signAt(
      resultant,
      root,
      polynomialAdd(candidate.a, candidate.b, budget),
      budget,
    );
    const betaSign = -bSign * aSign;
    const betaMinusOneSign = -sumSign * aSign;
    if (betaSign < 0 || betaMinusOneSign > 0) continue;
    const point = makePoint(
      request,
      projectedIsFirst,
      projected,
      eliminated,
      resultant,
      resultant,
      root,
      candidate.a,
      candidate.b,
      budget,
    );
    if (!point) return { kind: "retry" };
    points.push(point);
  }
  return { kind: "complete", points };
}

function uncertain(code: string, message: string): NeutralCurveQueryResult {
  return { kind: "uncertain", code, message };
}

function run(
  request: NeutralCurveQueryRequest & { first: Cubic; second: Cubic },
  budget: ExactProofBudget,
): NeutralCurveQueryResult {
  const firstData = activePowerCoefficients(request.first, budget);
  const secondData = activePowerCoefficients(request.second, budget);
  const firstAttempt = attemptProjection(
    request,
    true,
    firstData,
    secondData,
    budget,
  );
  if (firstAttempt.kind === "zeroResultant") {
    return uncertain(
      "non-structural-cubic-overlap",
      "The non-structural cubic resultant vanishes, so an isolated complete root set is unavailable.",
    );
  }
  const completed =
    firstAttempt.kind === "complete"
      ? firstAttempt
      : attemptProjection(request, false, firstData, secondData, budget);
  if (completed.kind === "zeroResultant") {
    return uncertain(
      "non-structural-cubic-overlap",
      "The non-structural cubic resultant vanishes, so an isolated complete root set is unavailable.",
    );
  }
  if (completed.kind !== "complete") {
    return uncertain(
      "cubic-pair-exact-projection-unresolved",
      "Neither atomic projection proved one genuine complex fiber for every closed resultant root.",
    );
  }
  return admitVerifiedNeutralCurveResult(
    request,
    completed.points,
    [],
    {
      kind: "completeIsolatedRootSet",
      family: "cubicCubic",
      distinctRootCount: completed.points.length,
    },
    budget,
    "pair",
  );
}

/** Complete non-structural cubic/cubic certification on the caller's one meter. */
export function certifyCubicPairExact(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  if (
    request.first.kind !== "cubicBezier" ||
    request.second.kind !== "cubicBezier"
  )
    return null;
  const cubicRequest = {
    ...request,
    first: request.first,
    second: request.second,
  };
  const structural = certifyStructuralCubicPair(cubicRequest, budget);
  return structural ?? run(cubicRequest, budget);
}

/** Test-only lower ceilings; limits are clamped and can never raise production budgets. */
export function certifyCubicPairExactWithLowerBudgetForTest(
  request: NeutralCurveQueryRequest & { first: Cubic; second: Cubic },
  lowerLimits: ConstructorParameters<typeof ExactProofBudget>[0],
): {
  readonly result: NeutralCurveQueryResult;
  readonly budget: ExactProofBudgetSnapshot;
} {
  const budget = new ExactProofBudget(lowerLimits);
  try {
    const structural = certifyStructuralCubicPair(request, budget);
    return {
      result: structural ?? run(request, budget),
      budget: budget.snapshot(),
    };
  } catch (error) {
    if (error instanceof ExactQueryProofBudgetExceeded) {
      return {
        result: uncertain(
          "exact-query-proof-budget-exhausted",
          "The deterministic exact-query arithmetic budget was exhausted.",
        ),
        budget: budget.snapshot(),
      };
    }
    throw error;
  }
}
