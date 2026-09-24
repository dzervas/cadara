import {
  checkNeutralCurvePointConsistency,
  evaluateNeutralCurve,
  getNeutralCurveActiveSearchBounds,
  type NeutralCurve,
  type NeutralCurvePointWitness,
  type NeutralCurveQueryRequest,
  type NeutralCurveQueryResult,
} from "@/contracts/modeling/neutral-curve-query";
import type { SplineVector } from "@/contracts/sketch/spline-geometry";
import {
  type AlgebraicPointOnRoot,
  certifyCircleRootDisposition,
} from "@/domain/modeling/neutral-curve-certification/circle-angular-certification";
import {
  admitVerifiedNeutralCurveResult,
  cubicPowerCoefficients,
  exactVector,
  lineCirclePolynomial,
  restrictedLineCubicData,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  ExactProofBudget,
  addExact,
  compareExact,
  divideExact,
  exact,
  exactFromNumber,
  isolateDistinctRootsClosed,
  multiplyExact,
  negateExact,
  outwardExactNumber,
  polynomialAdd,
  polynomialDerivative,
  polynomialIntervalEvaluate,
  polynomialIsZero,
  polynomialMultiply,
  polynomialTrim,
  refineIsolatedRoot,
  signAtIsolatedRoot,
  subtractExact,
  type ExactFraction,
  type ExactInterval,
  type ExactPolynomial,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

type Line = Extract<NeutralCurve, { kind: "line" }>;
type Circle = Extract<NeutralCurve, { kind: "circle" }>;
type Cubic = Extract<NeutralCurve, { kind: "cubicBezier" }>;

export interface IsolatedCurveRoot {
  readonly normalizedBounds: ExactInterval;
  readonly multiplicity: number;
}

function zero(budget: ExactProofBudget) {
  return exact(0n, 1n, budget);
}

function evenMultiplicity(multiplicity: number, budget: ExactProofBudget) {
  budget.operation();
  return multiplicity % 2 === 0;
}

function implicitLineVerification(
  root: IsolatedCurveRoot,
  budget: ExactProofBudget,
) {
  if (
    compareExact(root.normalizedBounds[0], root.normalizedBounds[1], budget) ===
    0
  ) {
    return { verification: "exactRoot" as const };
  }
  if (evenMultiplicity(root.multiplicity, budget)) {
    return {
      verification: "exactMultiplicity" as const,
      rootMultiplicity: root.multiplicity,
    };
  }
  return { verification: "boundedSignChange" as const };
}

function rootEqualsValue(
  rootPolynomial: ExactPolynomial,
  interval: ExactInterval,
  value: ExactFraction,
  budget: ExactProofBudget,
) {
  return (
    signAtIsolatedRoot(
      rootPolynomial,
      interval,
      [negateExact(value, budget), exact(1n, 1n, budget)],
      budget,
    ).sign === 0
  );
}

function rootMultiplicity(
  polynomial: ExactPolynomial,
  interval: ExactInterval,
  budget: ExactProofBudget,
) {
  let derivative = polynomialDerivative(polynomial, budget);
  let multiplicity = 1;
  while (!polynomialIsZero(derivative, budget)) {
    const sign = signAtIsolatedRoot(
      polynomial,
      interval,
      derivative,
      budget,
    ).sign;
    if (sign !== 0) return multiplicity;
    multiplicity += 1;
    derivative = polynomialDerivative(derivative, budget);
  }
  return multiplicity;
}

export function isolateFixedCurveRoots(
  polynomial: ExactPolynomial,
  closedDomain: ExactInterval,
  maximumDegree: 2 | 3 | 6,
  budget: ExactProofBudget,
): readonly IsolatedCurveRoot[] | null {
  const trimmed = polynomialTrim(polynomial, budget);
  if (trimmed.length - 1 > maximumDegree)
    throw new RangeError("Fixed curve degree cap exceeded");
  const intervals = isolateDistinctRootsClosed(trimmed, closedDomain, budget);
  if (intervals === null) return null;
  if (intervals.length > maximumDegree)
    throw new Error("Fixed curve root shape cap exceeded");
  return intervals.map((normalizedBounds) => ({
    normalizedBounds,
    multiplicity: rootMultiplicity(trimmed, normalizedBounds, budget),
  }));
}

class PolynomialPoint implements AlgebraicPointOnRoot {
  #interval: ExactInterval;
  readonly #rootPolynomial: ExactPolynomial;
  readonly #xPolynomial: ExactPolynomial;
  readonly #yPolynomial: ExactPolynomial;
  readonly #budget: ExactProofBudget;

  constructor(
    rootPolynomial: ExactPolynomial,
    interval: ExactInterval,
    xPolynomial: ExactPolynomial,
    yPolynomial: ExactPolynomial,
    budget: ExactProofBudget,
  ) {
    this.#rootPolynomial = rootPolynomial;
    this.#interval = interval;
    this.#xPolynomial = xPolynomial;
    this.#yPolynomial = yPolynomial;
    this.#budget = budget;
  }

  refine() {
    if (
      compareExact(this.#interval[0], this.#interval[1], this.#budget) !== 0
    ) {
      this.#interval = refineIsolatedRoot(
        this.#rootPolynomial,
        this.#interval,
        this.#budget,
      );
    }
    return {
      rootBounds: this.#interval,
      xBounds: polynomialIntervalEvaluate(
        this.#xPolynomial,
        this.#interval,
        this.#budget,
      ),
      yBounds: polynomialIntervalEvaluate(
        this.#yPolynomial,
        this.#interval,
        this.#budget,
      ),
    };
  }

  signLinear(a: ExactFraction, b: ExactFraction, c: ExactFraction) {
    const value = polynomialAdd(
      polynomialAdd(
        this.#xPolynomial.map((coefficient) =>
          multiplyExact(a, coefficient, this.#budget),
        ),
        this.#yPolynomial.map((coefficient) =>
          multiplyExact(b, coefficient, this.#budget),
        ),
        this.#budget,
      ),
      [c],
      this.#budget,
    );
    const result = signAtIsolatedRoot(
      this.#rootPolynomial,
      this.#interval,
      value,
      this.#budget,
    );
    this.#interval = result.interval;
    return result.sign;
  }
}

function exactDomain(
  domain: readonly [number, number],
  budget: ExactProofBudget,
): ExactInterval {
  return [
    exactFromNumber(domain[0], budget),
    exactFromNumber(domain[1], budget),
  ];
}

function sourceBoundsFromNormalized(
  interval: ExactInterval,
  sourceDomain: readonly [number, number],
  activeDomain: readonly [number, number],
  budget: ExactProofBudget,
): readonly [number, number] {
  const sourceLower = exactFromNumber(activeDomain[0], budget);
  const scale = subtractExact(
    exactFromNumber(activeDomain[1], budget),
    sourceLower,
    budget,
  );
  const lower = addExact(
    sourceLower,
    multiplyExact(interval[0], scale, budget),
    budget,
  );
  const upper = addExact(
    sourceLower,
    multiplyExact(interval[1], scale, budget),
    budget,
  );
  const bounds = [
    outwardExactNumber(lower, "down", budget),
    outwardExactNumber(upper, "up", budget),
  ] as const;
  if (bounds[0] < sourceDomain[0] || bounds[1] > sourceDomain[1]) {
    throw new RangeError("Mapped root escaped the authored source domain");
  }
  return bounds;
}

function representative(bounds: readonly [number, number]) {
  return bounds[0] === bounds[1]
    ? bounds[0]
    : bounds[0] + (bounds[1] - bounds[0]) / 2;
}

function pointPosition(
  point: PolynomialPoint,
  budget: ExactProofBudget,
): SplineVector {
  const refined = point.refine();
  return [
    representative([
      outwardExactNumber(refined.xBounds[0], "down", budget),
      outwardExactNumber(refined.xBounds[1], "up", budget),
    ]),
    representative([
      outwardExactNumber(refined.yBounds[0], "down", budget),
      outwardExactNumber(refined.yBounds[1], "up", budget),
    ]),
  ];
}

function complete(
  request: NeutralCurveQueryRequest,
  family: "lineCircle" | "lineCubic" | "circlePair" | "circleCubic",
  points: readonly NeutralCurvePointWitness[],
  budget: ExactProofBudget,
) {
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
    "pair",
  );
}

function consistentOrUncertain(
  request: NeutralCurveQueryRequest,
  family: "lineCircle" | "lineCubic" | "circlePair" | "circleCubic",
  points: readonly NeutralCurvePointWitness[],
  budget: ExactProofBudget,
): NeutralCurveQueryResult {
  for (const point of points) {
    const failure = checkNeutralCurvePointConsistency(request, point);
    if (failure) return failure;
  }
  return complete(request, family, points, budget);
}

function linePointPolynomials(line: Line, budget: ExactProofBudget) {
  const origin = exactVector(line.origin, budget);
  const direction = exactVector(line.direction, budget);
  return [
    [origin[0], direction[0]],
    [origin[1], direction[1]],
  ] as const;
}

export function certifyConstructiveLineCircle(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  const firstIsLine = request.first.kind === "line";
  const line = firstIsLine ? request.first : request.second;
  const circle = firstIsLine ? request.second : request.first;
  if (line.kind !== "line" || circle.kind !== "circle") return null;
  const polynomial = lineCirclePolynomial(line, circle, budget);
  const active = getNeutralCurveActiveSearchBounds(line);
  const roots = isolateFixedCurveRoots(
    polynomial,
    exactDomain(active, budget),
    2,
    budget,
  );
  if (!roots)
    return {
      kind: "uncertain",
      code: "line-circle-overlap",
      message: "The line/circle support polynomial vanished identically.",
    };
  const [xPolynomial, yPolynomial] = linePointPolynomials(line, budget);
  const points: NeutralCurvePointWitness[] = [];
  for (const root of roots) {
    const point = new PolynomialPoint(
      polynomial,
      root.normalizedBounds,
      xPolynomial,
      yPolynomial,
      budget,
    );
    const angular = certifyCircleRootDisposition(circle, point, budget);
    if (angular.kind === "excluded") continue;
    const lineBounds = [
      outwardExactNumber(root.normalizedBounds[0], "down", budget),
      outwardExactNumber(root.normalizedBounds[1], "up", budget),
    ] as const;
    const lineParameter = representative(lineBounds);
    const endpoint =
      angular.atActiveEndpoint ||
      rootEqualsValue(
        polynomial,
        root.normalizedBounds,
        exactFromNumber(active[0], budget),
        budget,
      ) ||
      rootEqualsValue(
        polynomial,
        root.normalizedBounds,
        exactFromNumber(active[1], budget),
        budget,
      );
    points.push({
      classification: endpoint
        ? "unclassified"
        : evenMultiplicity(root.multiplicity, budget)
          ? "tangent"
          : "crossing",
      firstParameter: firstIsLine ? lineParameter : angular.parameter,
      secondParameter: firstIsLine ? angular.parameter : lineParameter,
      position: pointPosition(point, budget),
      proof: {
        kind: "exactImplicitLineRootSet",
        family: "lineCircle",
        ...implicitLineVerification(root, budget),
        firstParameterBounds: firstIsLine
          ? lineBounds
          : angular.parameterBounds,
        secondParameterBounds: firstIsLine
          ? angular.parameterBounds
          : lineBounds,
      },
    });
  }
  return consistentOrUncertain(request, "lineCircle", points, budget);
}

function cubicPointData(cubic: Cubic, budget: ExactProofBudget) {
  const coefficients = cubicPowerCoefficients(cubic, budget);
  return {
    x: coefficients.map((coefficient) => coefficient[0]),
    y: coefficients.map((coefficient) => coefficient[1]),
    active: getNeutralCurveActiveSearchBounds(cubic),
  };
}

function isStationary(
  rootPolynomial: ExactPolynomial,
  interval: ExactInterval,
  x: ExactPolynomial,
  y: ExactPolynomial,
  budget: ExactProofBudget,
) {
  return (
    signAtIsolatedRoot(
      rootPolynomial,
      interval,
      polynomialDerivative(x, budget),
      budget,
    ).sign === 0 &&
    signAtIsolatedRoot(
      rootPolynomial,
      interval,
      polynomialDerivative(y, budget),
      budget,
    ).sign === 0
  );
}

export function certifyConstructiveLineCubic(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  const firstIsLine = request.first.kind === "line";
  const line = firstIsLine ? request.first : request.second;
  const cubic = firstIsLine ? request.second : request.first;
  if (line.kind !== "line" || cubic.kind !== "cubicBezier") return null;
  const data = restrictedLineCubicData(line, cubic, budget);
  const unit = [zero(budget), exact(1n, 1n, budget)] as const;
  const roots = isolateFixedCurveRoots(data.polynomial, unit, 3, budget);
  if (!roots)
    return {
      kind: "uncertain",
      code: "line-cubic-overlap",
      message: "The cubic lies on the line support.",
    };
  const coordinates = cubicPointData(cubic, budget);
  const [projectionA, projectionB, projectionC, projectionD] = data.projection;
  const scaledProjection = (value: ExactFraction, factor: number) =>
    multiplyExact(value, exactFromNumber(factor, budget), budget);
  const projection = [
    projectionA,
    addExact(
      scaledProjection(projectionA, -3),
      scaledProjection(projectionB, 3),
      budget,
    ),
    addExact(
      addExact(
        scaledProjection(projectionA, 3),
        scaledProjection(projectionB, -6),
        budget,
      ),
      scaledProjection(projectionC, 3),
      budget,
    ),
    addExact(
      addExact(
        scaledProjection(projectionA, -1),
        scaledProjection(projectionB, 3),
        budget,
      ),
      addExact(scaledProjection(projectionC, -3), projectionD, budget),
      budget,
    ),
  ] as const;
  const lineActive = exactDomain(
    getNeutralCurveActiveSearchBounds(line),
    budget,
  );
  const points: NeutralCurvePointWitness[] = [];
  for (const root of roots) {
    let rootBounds = root.normalizedBounds;
    let projectionBounds = polynomialIntervalEvaluate(
      projection,
      rootBounds,
      budget,
    );
    while (
      !(
        compareExact(projectionBounds[1], lineActive[0], budget) < 0 ||
        compareExact(projectionBounds[0], lineActive[1], budget) > 0
      ) &&
      (compareExact(projectionBounds[0], lineActive[0], budget) < 0 ||
        compareExact(projectionBounds[1], lineActive[1], budget) > 0)
    ) {
      rootBounds = refineIsolatedRoot(data.polynomial, rootBounds, budget);
      projectionBounds = polynomialIntervalEvaluate(
        projection,
        rootBounds,
        budget,
      );
    }
    if (
      compareExact(projectionBounds[1], lineActive[0], budget) < 0 ||
      compareExact(projectionBounds[0], lineActive[1], budget) > 0
    )
      continue;
    const refinedRoot = { ...root, normalizedBounds: rootBounds };
    const cubicBounds = sourceBoundsFromNormalized(
      rootBounds,
      cubic.sourceDomain,
      coordinates.active,
      budget,
    );
    const lineBounds = [
      outwardExactNumber(projectionBounds[0], "down", budget),
      outwardExactNumber(projectionBounds[1], "up", budget),
    ] as const;
    const cubicParameter = representative(cubicBounds);
    const lineParameter = representative(lineBounds);
    const projectionAtLower = [...projection];
    projectionAtLower[0] = subtractExact(
      projectionAtLower[0]!,
      lineActive[0],
      budget,
    );
    const projectionAtUpper = [...projection];
    projectionAtUpper[0] = subtractExact(
      projectionAtUpper[0]!,
      lineActive[1],
      budget,
    );
    const endpoint =
      rootEqualsValue(data.polynomial, rootBounds, unit[0], budget) ||
      rootEqualsValue(data.polynomial, rootBounds, unit[1], budget) ||
      signAtIsolatedRoot(data.polynomial, rootBounds, projectionAtLower, budget)
        .sign === 0 ||
      signAtIsolatedRoot(data.polynomial, rootBounds, projectionAtUpper, budget)
        .sign === 0;
    const stationary = isStationary(
      data.polynomial,
      rootBounds,
      coordinates.x,
      coordinates.y,
      budget,
    );
    const position = evaluateNeutralCurve(cubic, cubicParameter);
    points.push({
      classification:
        endpoint || stationary
          ? "unclassified"
          : evenMultiplicity(root.multiplicity, budget)
            ? "tangent"
            : "crossing",
      firstParameter: firstIsLine ? lineParameter : cubicParameter,
      secondParameter: firstIsLine ? cubicParameter : lineParameter,
      position,
      proof: {
        kind: "exactImplicitLineRootSet",
        family: "lineCubic",
        ...implicitLineVerification(refinedRoot, budget),
        firstParameterBounds: firstIsLine ? lineBounds : cubicBounds,
        secondParameterBounds: firstIsLine ? cubicBounds : lineBounds,
      },
    });
  }
  return consistentOrUncertain(request, "lineCubic", points, budget);
}

function circleSupportPolynomial(
  circle: Circle,
  x: ExactPolynomial,
  y: ExactPolynomial,
  budget: ExactProofBudget,
) {
  const relativeX = [...x];
  const relativeY = [...y];
  relativeX[0] = subtractExact(
    relativeX[0]!,
    exactFromNumber(circle.center[0], budget),
    budget,
  );
  relativeY[0] = subtractExact(
    relativeY[0]!,
    exactFromNumber(circle.center[1], budget),
    budget,
  );
  const radius = exactFromNumber(circle.radius, budget);
  return polynomialAdd(
    polynomialAdd(
      polynomialMultiply(relativeX, relativeX, budget),
      polynomialMultiply(relativeY, relativeY, budget),
      budget,
    ),
    [negateExact(multiplyExact(radius, radius, budget), budget)],
    budget,
  );
}

export function certifyConstructiveCircleCubic(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  const firstIsCircle = request.first.kind === "circle";
  const circle = firstIsCircle ? request.first : request.second;
  const cubic = firstIsCircle ? request.second : request.first;
  if (circle.kind !== "circle" || cubic.kind !== "cubicBezier") return null;
  const data = cubicPointData(cubic, budget);
  const polynomial = circleSupportPolynomial(circle, data.x, data.y, budget);
  const unit = [zero(budget), exact(1n, 1n, budget)] as const;
  const roots = isolateFixedCurveRoots(polynomial, unit, 6, budget);
  if (!roots)
    return {
      kind: "uncertain",
      code: "circle-cubic-constant-on-circle-degeneracy",
      message:
        "The cubic support polynomial vanishes identically on the circle.",
    };
  const points: NeutralCurvePointWitness[] = [];
  for (const root of roots) {
    const point = new PolynomialPoint(
      polynomial,
      root.normalizedBounds,
      data.x,
      data.y,
      budget,
    );
    const angular = certifyCircleRootDisposition(circle, point, budget);
    if (angular.kind === "excluded") continue;
    const cubicBounds = sourceBoundsFromNormalized(
      root.normalizedBounds,
      cubic.sourceDomain,
      data.active,
      budget,
    );
    const cubicParameter = representative(cubicBounds);
    const endpoint =
      angular.atActiveEndpoint ||
      rootEqualsValue(polynomial, root.normalizedBounds, unit[0], budget) ||
      rootEqualsValue(polynomial, root.normalizedBounds, unit[1], budget);
    const stationary = isStationary(
      polynomial,
      root.normalizedBounds,
      data.x,
      data.y,
      budget,
    );
    points.push({
      classification:
        endpoint || stationary
          ? "unclassified"
          : evenMultiplicity(root.multiplicity, budget)
            ? "tangent"
            : "crossing",
      firstParameter: firstIsCircle ? angular.parameter : cubicParameter,
      secondParameter: firstIsCircle ? cubicParameter : angular.parameter,
      position: pointPosition(point, budget),
      proof: {
        kind: "exactAlgebraicCurveRootSet",
        family: "circleCubic",
        rootMultiplicity: root.multiplicity,
        firstParameterBounds: firstIsCircle
          ? angular.parameterBounds
          : cubicBounds,
        secondParameterBounds: firstIsCircle
          ? cubicBounds
          : angular.parameterBounds,
      },
    });
  }
  return consistentOrUncertain(request, "circleCubic", points, budget);
}

export function certifyConstructiveCirclePair(
  request: NeutralCurveQueryRequest,
  budget: ExactProofBudget,
): NeutralCurveQueryResult | null {
  if (request.first.kind !== "circle" || request.second.kind !== "circle")
    return null;
  const first = request.first;
  const second = request.second;
  const firstCenter = exactVector(first.center, budget);
  const secondCenter = exactVector(second.center, budget);
  const displacement = [
    subtractExact(secondCenter[0], firstCenter[0], budget),
    subtractExact(secondCenter[1], firstCenter[1], budget),
  ] as const;
  const distanceSquared = addExact(
    multiplyExact(displacement[0], displacement[0], budget),
    multiplyExact(displacement[1], displacement[1], budget),
    budget,
  );
  const firstRadius = exactFromNumber(first.radius, budget);
  const secondRadius = exactFromNumber(second.radius, budget);
  const exactZero = zero(budget);
  if (
    compareExact(distanceSquared, exactZero, budget) === 0 &&
    compareExact(firstRadius, secondRadius, budget) === 0
  ) {
    return {
      kind: "uncertain",
      code: "coincident-circle-supports",
      message:
        "Coincident circle supports are a positive-dimensional unsupported family.",
    };
  }
  if (compareExact(distanceSquared, exactZero, budget) === 0) {
    return complete(request, "circlePair", [], budget);
  }
  const a = divideExact(
    addExact(
      subtractExact(
        multiplyExact(firstRadius, firstRadius, budget),
        multiplyExact(secondRadius, secondRadius, budget),
        budget,
      ),
      distanceSquared,
      budget,
    ),
    multiplyExact(exact(2n, 1n, budget), distanceSquared, budget),
    budget,
  );
  const base = [
    addExact(firstCenter[0], multiplyExact(displacement[0], a, budget), budget),
    addExact(firstCenter[1], multiplyExact(displacement[1], a, budget), budget),
  ] as const;
  const x = [base[0], negateExact(displacement[1], budget)] as const;
  const y = [base[1], displacement[0]] as const;
  const polynomial = circleSupportPolynomial(first, x, y, budget);
  const absoluteX =
    compareExact(displacement[0], exactZero, budget) < 0
      ? negateExact(displacement[0], budget)
      : displacement[0];
  const absoluteY =
    compareExact(displacement[1], exactZero, budget) < 0
      ? negateExact(displacement[1], budget)
      : displacement[1];
  const nonzeroComponent =
    compareExact(absoluteX, absoluteY, budget) >= 0 ? absoluteX : absoluteY;
  const parameterBound = divideExact(firstRadius, nonzeroComponent, budget);
  const roots = isolateFixedCurveRoots(
    polynomial,
    [negateExact(parameterBound, budget), parameterBound],
    2,
    budget,
  );
  if (!roots)
    throw new Error("Noncoincident circle radical polynomial vanished");
  const points: NeutralCurvePointWitness[] = [];
  for (const root of roots) {
    const point = new PolynomialPoint(
      polynomial,
      root.normalizedBounds,
      x,
      y,
      budget,
    );
    const firstAngular = certifyCircleRootDisposition(first, point, budget);
    const secondAngular = certifyCircleRootDisposition(second, point, budget);
    if (firstAngular.kind === "excluded" || secondAngular.kind === "excluded")
      continue;
    points.push({
      classification:
        firstAngular.atActiveEndpoint || secondAngular.atActiveEndpoint
          ? "unclassified"
          : roots.length === 1
            ? "tangent"
            : "crossing",
      firstParameter: firstAngular.parameter,
      secondParameter: secondAngular.parameter,
      position: pointPosition(point, budget),
      proof: {
        kind: "exactAlgebraicCurveRootSet",
        family: "circlePair",
        rootMultiplicity: root.multiplicity,
        firstParameterBounds: firstAngular.parameterBounds,
        secondParameterBounds: secondAngular.parameterBounds,
      },
    });
  }
  return consistentOrUncertain(request, "circlePair", points, budget);
}
