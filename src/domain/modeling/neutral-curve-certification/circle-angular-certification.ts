import {
  getCircleAngularSearchBounds,
  validateCircleAngularDomain,
  type ValidCircleAngularDomain,
} from "@/contracts/modeling/circle-angular-domain";
import type { NeutralCurve } from "@/contracts/modeling/neutral-curve-query";
import {
  certifySinCos,
  outwardIntervalAdd,
  outwardIntervalMultiply,
  outwardIntervalNegate,
} from "@/domain/modeling/neutral-curve-certification/certified-trig";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  addExact,
  compareFiniteAngleToQuarterTurnMultipleExact,
  compareFiniteSpanToTwoPiExact,
  exactFromNumber,
  multiplyExact,
  negateExact,
  nextBinary64,
  outwardExactNumber,
  subtractExact,
  type ExactFraction,
  type ExactInterval,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

export interface AlgebraicPointOnRoot {
  /** Refines and outward-encloses one immutable algebraic root and point. */
  refine(): {
    readonly rootBounds: ExactInterval;
    readonly xBounds: ExactInterval;
    readonly yBounds: ExactInterval;
  };
  /** Exact sign of a*x+b*y+c at this same root. */
  signLinear(a: ExactFraction, b: ExactFraction, c: ExactFraction): -1 | 0 | 1;
}

export type CircleRootDisposition =
  | { readonly kind: "excluded" }
  | {
      readonly kind: "active";
      readonly parameter: number;
      readonly parameterBounds: readonly [number, number];
      readonly atActiveEndpoint: boolean;
    };

type NumberInterval = readonly [number, number];

export function validateCertifiedCircleAngularDomain(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  budget: ExactProofBudget,
): ValidCircleAngularDomain | null {
  const domain = validateCircleAngularDomain(
    circle.sourceDomain,
    circle.queryDomain,
  );
  if (!domain) return null;
  if (
    circle.sourceDomain.kind === "arc" &&
    compareFiniteSpanToTwoPiExact(
      circle.sourceDomain.interval[0],
      circle.sourceDomain.interval[1],
      budget,
    ) !== -1
  )
    return null;
  if (
    circle.queryDomain &&
    compareFiniteSpanToTwoPiExact(
      circle.queryDomain.interval[0],
      circle.queryDomain.interval[1],
      budget,
    ) !== -1
  )
    return null;
  if (
    circle.sourceDomain.kind === "fullTurn" &&
    circle.queryDomain &&
    compareFiniteSpanToTwoPiExact(
      circle.sourceDomain.seam,
      circle.queryDomain.interval[1],
      budget,
    ) !== -1
  )
    return null;
  return domain;
}

function add(
  first: NumberInterval,
  second: NumberInterval,
  budget: ExactProofBudget,
): NumberInterval {
  const result = outwardIntervalAdd(
    { lower: first[0], upper: first[1] },
    { lower: second[0], upper: second[1] },
    budget,
  );
  return [result.lower, result.upper];
}

function multiply(
  first: NumberInterval,
  second: NumberInterval,
  budget: ExactProofBudget,
): NumberInterval {
  const result = outwardIntervalMultiply(
    { lower: first[0], upper: first[1] },
    { lower: second[0], upper: second[1] },
    budget,
  );
  return [result.lower, result.upper];
}

function negate(value: NumberInterval): NumberInterval {
  const result = outwardIntervalNegate({ lower: value[0], upper: value[1] });
  return [result.lower, result.upper];
}

function exactNumberInterval(
  value: ExactFraction,
  budget: ExactProofBudget,
): NumberInterval {
  return [
    outwardExactNumber(value, "down", budget),
    outwardExactNumber(value, "up", budget),
  ];
}

function exactBoundsToNumbers(
  value: ExactInterval,
  budget: ExactProofBudget,
): NumberInterval {
  return [
    outwardExactNumber(value[0], "down", budget),
    outwardExactNumber(value[1], "up", budget),
  ];
}

function certifiedAngularValues(
  angle: number,
  cross: NumberInterval,
  dot: NumberInterval,
  budget: ExactProofBudget,
) {
  const trig = certifySinCos(angle, budget);
  if (!trig) return null;
  const sine: NumberInterval = [trig.sine.lower, trig.sine.upper];
  const cosine: NumberInterval = [trig.cosine.lower, trig.cosine.upper];
  return {
    f: add(
      multiply(cross, cosine, budget),
      negate(multiply(dot, sine, budget)),
      budget,
    ),
    g: add(
      multiply(dot, cosine, budget),
      multiply(cross, sine, budget),
      budget,
    ),
  };
}

function relativeIntervals(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  point: AlgebraicPointOnRoot,
  budget: ExactProofBudget,
) {
  const refined = point.refine();
  const centerX = exactFromNumber(circle.center[0], budget);
  const centerY = exactFromNumber(circle.center[1], budget);
  const x = exactBoundsToNumbers(
    [
      subtractExact(refined.xBounds[0], centerX, budget),
      subtractExact(refined.xBounds[1], centerX, budget),
    ],
    budget,
  );
  const y = exactBoundsToNumbers(
    [
      subtractExact(refined.yBounds[0], centerY, budget),
      subtractExact(refined.yBounds[1], centerY, budget),
    ],
    budget,
  );
  const axisX = exactNumberInterval(
    exactFromNumber(circle.xAxis[0], budget),
    budget,
  );
  const axisY = exactNumberInterval(
    exactFromNumber(circle.xAxis[1], budget),
    budget,
  );
  return {
    cross: add(
      multiply(axisX, y, budget),
      negate(multiply(axisY, x, budget)),
      budget,
    ),
    dot: add(multiply(axisX, x, budget), multiply(axisY, y, budget), budget),
    x,
    y,
  };
}

function certifyBracket(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  point: AlgebraicPointOnRoot,
  candidate: number,
  budget: ExactProofBudget,
): readonly [number, number] | null {
  for (let step = 0; step < 32; step += 1) {
    budget.refinementStep();
    const relative = relativeIntervals(circle, point, budget);
    const radius =
      Number.EPSILON *
      Math.max(Number.MIN_VALUE, Math.abs(candidate)) *
      2 ** (step + 2);
    const lower = candidate - radius;
    const upper = candidate + radius;
    if (!(lower < candidate && candidate < upper)) continue;
    const trials = [
      [lower, candidate],
      [candidate, upper],
      [lower, upper],
    ] as const;
    for (const trial of trials) {
      const lowerValues = certifiedAngularValues(
        trial[0],
        relative.cross,
        relative.dot,
        budget,
      );
      const upperValues = certifiedAngularValues(
        trial[1],
        relative.cross,
        relative.dot,
        budget,
      );
      if (!lowerValues || !upperValues) continue;
      if (!(lowerValues.f[0] > 0 && upperValues.f[1] < 0)) continue;
      const width = add(
        [trial[1], trial[1]],
        negate([trial[0], trial[0]]),
        budget,
      );
      const maximumDerivative = Math.max(
        Math.abs(relative.cross[0]),
        Math.abs(relative.cross[1]),
        Math.abs(relative.dot[0]),
        Math.abs(relative.dot[1]),
      );
      const continuation = multiply(
        width,
        [maximumDerivative, maximumDerivative],
        budget,
      );
      const positiveRay = add(
        [
          Math.min(lowerValues.g[0], upperValues.g[0]),
          Math.min(lowerValues.g[0], upperValues.g[0]),
        ],
        negate(continuation),
        budget,
      );
      if (positiveRay[0] > 0) return trial;
    }
  }
  return null;
}

function exactAxisSigns(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  point: AlgebraicPointOnRoot,
  budget: ExactProofBudget,
) {
  const axisX = exactFromNumber(circle.xAxis[0], budget);
  const axisY = exactFromNumber(circle.xAxis[1], budget);
  const centerX = exactFromNumber(circle.center[0], budget);
  const centerY = exactFromNumber(circle.center[1], budget);
  const crossSign = point.signLinear(
    negateExact(axisY, budget),
    axisX,
    subtractExact(
      multiplyExact(axisY, centerX, budget),
      multiplyExact(axisX, centerY, budget),
      budget,
    ),
  );
  const centerDot = addExact(
    multiplyExact(axisX, centerX, budget),
    multiplyExact(axisY, centerY, budget),
    budget,
  );
  const dotSign = point.signLinear(
    axisX,
    axisY,
    negateExact(centerDot, budget),
  );
  return { crossSign, dotSign };
}

function quarterTurnDisposition(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  quarterTurns: number,
  budget: ExactProofBudget,
): CircleRootDisposition | null {
  const domain = validateCertifiedCircleAngularDomain(circle, budget)!;
  const active = domain.active;
  const source = domain.source;
  const compareEndpoint = (endpoint: number, multiple: number) =>
    compareFiniteAngleToQuarterTurnMultipleExact(endpoint, multiple, budget);
  const arcContains = (interval: readonly [number, number]) => {
    const lower = compareEndpoint(interval[0], quarterTurns);
    const upper = compareEndpoint(interval[1], quarterTurns);
    if (lower === null || upper === null) return null;
    return lower <= 0 && upper >= 0;
  };
  const fullContains = (seam: number) => {
    const lower = compareEndpoint(seam, quarterTurns);
    const upper = compareEndpoint(seam, quarterTurns - 4);
    if (lower === null || upper === null) return null;
    return lower <= 0 && upper > 0;
  };
  const sourceContains =
    source.kind === "arc"
      ? arcContains(source.interval)
      : fullContains(source.seam);
  if (sourceContains === null) return null;
  if (!sourceContains) return { kind: "excluded" };
  const activeContains =
    active.kind === "arc"
      ? arcContains(active.interval)
      : fullContains(active.seam);
  if (activeContains === null) return null;
  if (!activeContains) return { kind: "excluded" };

  let lower = (quarterTurns * Math.PI) / 2;
  let upper = lower;
  for (let step = 0; step < 8; step += 1) {
    const lowerComparison = compareFiniteAngleToQuarterTurnMultipleExact(
      lower,
      quarterTurns,
      budget,
    );
    const upperComparison = compareFiniteAngleToQuarterTurnMultipleExact(
      upper,
      quarterTurns,
      budget,
    );
    if (
      lowerComparison !== null &&
      lowerComparison <= 0 &&
      upperComparison !== null &&
      upperComparison >= 0
    ) {
      const atActiveEndpoint =
        active.kind === "arc"
          ? compareEndpoint(active.interval[0], quarterTurns) === 0 ||
            compareEndpoint(active.interval[1], quarterTurns) === 0
          : compareEndpoint(active.seam, quarterTurns) === 0;
      return {
        kind: "active",
        parameter: lower === upper ? lower : lower + (upper - lower) / 2,
        parameterBounds: [lower, upper],
        atActiveEndpoint,
      };
    }
    if (lowerComparison === null || lowerComparison > 0)
      lower = nextBinary64(lower, "down", budget);
    if (upperComparison === null || upperComparison < 0)
      upper = nextBinary64(upper, "up", budget);
  }
  return null;
}

function quarterTurnBounds(
  quarterTurns: number,
  budget: ExactProofBudget,
): readonly [number, number] | null {
  let lower = (quarterTurns * Math.PI) / 2;
  let upper = lower;
  for (let step = 0; step < 8; step += 1) {
    budget.refinementStep();
    const lowerComparison = compareFiniteAngleToQuarterTurnMultipleExact(
      lower,
      quarterTurns,
      budget,
    );
    const upperComparison = compareFiniteAngleToQuarterTurnMultipleExact(
      upper,
      quarterTurns,
      budget,
    );
    if (
      lowerComparison !== null &&
      lowerComparison <= 0 &&
      upperComparison !== null &&
      upperComparison >= 0
    ) {
      return [lower, upper];
    }
    if (lowerComparison === null || lowerComparison > 0)
      lower = nextBinary64(lower, "down", budget);
    if (upperComparison === null || upperComparison < 0)
      upper = nextBinary64(upper, "up", budget);
  }
  return null;
}

function certifyQuadrantRoot(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  point: AlgebraicPointOnRoot,
  lowerQuarter: number,
  budget: ExactProofBudget,
): readonly [number, number] | null {
  const lowerBoundary = quarterTurnBounds(lowerQuarter, budget);
  const upperBoundary = quarterTurnBounds(lowerQuarter + 1, budget);
  if (!lowerBoundary || !upperBoundary) return null;
  let lower = lowerBoundary[1];
  let upper = upperBoundary[0];
  for (let step = 0; step < 64 && lower < upper; step += 1) {
    budget.refinementStep();
    const relative = relativeIntervals(circle, point, budget);
    const midpoint = lower + (upper - lower) / 2;
    if (step >= 48) {
      const candidate = certifyBracket(circle, point, midpoint, budget);
      if (candidate) return candidate;
    }
    const value = certifiedAngularValues(
      midpoint,
      relative.cross,
      relative.dot,
      budget,
    );
    if (!value) continue;
    if (value.f[0] > 0) lower = midpoint;
    else if (value.f[1] < 0) upper = midpoint;
    else point.refine();
  }
  return null;
}

/**
 * Associates one exact algebraic support point with the authored circle winding.
 * Exact axis signs select an exhaustive active-winding quadrant list. A seed may
 * reorder that list, but neither atan2 nor the seed determines whether it runs.
 */
export function certifyCircleRootDisposition(
  circle: Extract<NeutralCurve, { kind: "circle" }>,
  point: AlgebraicPointOnRoot,
  budget: ExactProofBudget,
  seed?: number,
): CircleRootDisposition {
  const domain = validateCertifiedCircleAngularDomain(circle, budget);
  if (!domain) throw new RangeError("Invalid circle angular domain");
  const active = getCircleAngularSearchBounds(domain);
  const source = validateCircleAngularDomain(circle.sourceDomain, undefined)!;
  const sourceBounds = getCircleAngularSearchBounds(source);

  const signs = exactAxisSigns(circle, point, budget);
  if (signs.crossSign === 0 || signs.dotSign === 0) {
    const canonicalQuarter =
      signs.crossSign === 0
        ? signs.dotSign > 0
          ? 0
          : 2
        : signs.crossSign > 0
          ? 1
          : 3;
    const centerQuarter = Math.round(
      (sourceBounds[0] + sourceBounds[1]) / 2 / (Math.PI / 2),
    );
    const centerTurn = Math.round((centerQuarter - canonicalQuarter) / 4);
    const quarterWindow = Array.from(
      { length: 5 },
      (_, index) => canonicalQuarter + 4 * (centerTurn + index - 2),
    );
    const leftGuard = compareFiniteAngleToQuarterTurnMultipleExact(
      sourceBounds[0],
      quarterWindow[0]!,
      budget,
    );
    const rightGuard = compareFiniteAngleToQuarterTurnMultipleExact(
      sourceBounds[1],
      quarterWindow[quarterWindow.length - 1]!,
      budget,
    );
    if (
      leftGuard === null ||
      leftGuard <= 0 ||
      rightGuard === null ||
      rightGuard >= 0
    ) {
      throw new ExactQueryProofBudgetExceeded();
    }
    for (const quarterTurns of quarterWindow) {
      const sourceLower = compareFiniteAngleToQuarterTurnMultipleExact(
        sourceBounds[0],
        quarterTurns,
        budget,
      );
      const sourceUpper = compareFiniteAngleToQuarterTurnMultipleExact(
        sourceBounds[1],
        quarterTurns,
        budget,
      );
      if (sourceLower === null || sourceUpper === null) {
        throw new ExactQueryProofBudgetExceeded();
      }
      const inSource =
        sourceLower <= 0 &&
        (circle.sourceDomain.kind === "fullTurn"
          ? sourceUpper > 0
          : sourceUpper >= 0);
      if (!inSource) continue;
      const disposition = quarterTurnDisposition(circle, quarterTurns, budget);
      if (!disposition) throw new ExactQueryProofBudgetExceeded();
      return disposition;
    }
    return { kind: "excluded" };
  }

  const relative = relativeIntervals(circle, point, budget);
  const approximate = Math.atan2(
    (relative.cross[0] + relative.cross[1]) / 2,
    (relative.dot[0] + relative.dot[1]) / 2,
  );
  const approximateTurn = Math.round(
    ((sourceBounds[0] + sourceBounds[1]) / 2 - approximate) / (2 * Math.PI),
  );
  const prioritizedBrackets: (readonly [number, number])[] = [];
  for (const [candidate, mayReturnActive] of [
    [approximate + approximateTurn * 2 * Math.PI, true] as const,
    ...(Number.isFinite(seed) ? ([[seed!, false]] as const) : []),
  ]) {
    const bracket = certifyBracket(circle, point, candidate, budget);
    if (!bracket) continue;
    prioritizedBrackets.push(bracket);
    if (
      mayReturnActive &&
      bracket[0] >= sourceBounds[0] &&
      bracket[1] <= sourceBounds[1]
    ) {
      if (bracket[0] >= active[0] && bracket[1] <= active[1]) {
        return {
          kind: "active",
          parameter: Math.min(bracket[1], Math.max(bracket[0], candidate)),
          parameterBounds: bracket,
          atActiveEndpoint: false,
        };
      }
      if (bracket[1] < active[0] || bracket[0] > active[1]) {
        return { kind: "excluded" };
      }
    }
  }

  const canonicalQuarter =
    signs.crossSign > 0
      ? signs.dotSign > 0
        ? 0
        : 1
      : signs.dotSign < 0
        ? 2
        : 3;
  const centerQuarter = Math.round(
    (sourceBounds[0] + sourceBounds[1]) / 2 / (Math.PI / 2),
  );
  const centerTurn = Math.round((centerQuarter - canonicalQuarter) / 4);
  const quadrantWindow = Array.from(
    { length: 9 },
    (_, index) => canonicalQuarter + 4 * (centerTurn + index - 4),
  );
  const leftGuard = compareFiniteAngleToQuarterTurnMultipleExact(
    sourceBounds[0],
    quadrantWindow[0]! + 1,
    budget,
  );
  const rightGuard = compareFiniteAngleToQuarterTurnMultipleExact(
    sourceBounds[1],
    quadrantWindow[quadrantWindow.length - 1]!,
    budget,
  );
  if (
    leftGuard === null ||
    leftGuard <= 0 ||
    rightGuard === null ||
    rightGuard >= 0
  ) {
    throw new ExactQueryProofBudgetExceeded();
  }
  const quadrants = quadrantWindow.filter((quarter) => {
    const sourceAfterUpper = compareFiniteAngleToQuarterTurnMultipleExact(
      sourceBounds[0],
      quarter + 1,
      budget,
    );
    const sourceBeforeLower = compareFiniteAngleToQuarterTurnMultipleExact(
      sourceBounds[1],
      quarter,
      budget,
    );
    if (sourceAfterUpper === null || sourceBeforeLower === null) {
      throw new ExactQueryProofBudgetExceeded();
    }
    return sourceAfterUpper <= 0 && sourceBeforeLower >= 0;
  });
  quadrants.sort(
    (first, second) =>
      Math.abs(
        (first * Math.PI) / 2 - (sourceBounds[0] + sourceBounds[1]) / 2,
      ) -
      Math.abs(
        (second * Math.PI) / 2 - (sourceBounds[0] + sourceBounds[1]) / 2,
      ),
  );
  if (Number.isFinite(seed)) {
    quadrants.sort(
      (first, second) =>
        Math.abs((first * Math.PI) / 2 - seed!) -
        Math.abs((second * Math.PI) / 2 - seed!),
    );
  }

  for (const quadrant of quadrants) {
    const prioritized = prioritizedBrackets.find((bracket) => {
      const afterLower = compareFiniteAngleToQuarterTurnMultipleExact(
        bracket[0],
        quadrant,
        budget,
      );
      const beforeUpper = compareFiniteAngleToQuarterTurnMultipleExact(
        bracket[1],
        quadrant + 1,
        budget,
      );
      return (
        afterLower !== null &&
        afterLower >= 0 &&
        beforeUpper !== null &&
        beforeUpper <= 0
      );
    });
    let bracket =
      prioritized ?? certifyQuadrantRoot(circle, point, quadrant, budget);
    if (!bracket) throw new ExactQueryProofBudgetExceeded();
    for (let refinement = 0; refinement <= 32; refinement += 1) {
      if (bracket[1] < sourceBounds[0] || bracket[0] > sourceBounds[1]) break;
      if (bracket[0] >= sourceBounds[0] && bracket[1] <= sourceBounds[1]) {
        const candidate = bracket[0] + (bracket[1] - bracket[0]) / 2;
        if (bracket[0] >= active[0] && bracket[1] <= active[1]) {
          return {
            kind: "active",
            parameter: candidate,
            parameterBounds: bracket,
            atActiveEndpoint: false,
          };
        }
        if (bracket[1] < active[0] || bracket[0] > active[1]) {
          return { kind: "excluded" };
        }
      }
      if (refinement === 32) throw new ExactQueryProofBudgetExceeded();
      budget.refinementStep();
      point.refine();
      const narrowed = certifyQuadrantRoot(circle, point, quadrant, budget);
      if (narrowed) bracket = narrowed;
    }
  }
  return { kind: "excluded" };
}
