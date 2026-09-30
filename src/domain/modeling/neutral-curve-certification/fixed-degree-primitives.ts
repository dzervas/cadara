/** Private fixed-degree exact arithmetic shared by neutral-curve certifiers. */

export interface ExactFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

export type ExactPolynomial = readonly ExactFraction[];
export type ExactInterval = readonly [ExactFraction, ExactFraction];

// Immutable decimal enclosure constants. Runtime exponentiation, parsing, or
// addition here would execute before a request owns a proof meter.
const TWO_PI_DENOMINATOR =
  1000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000n;
const TWO_PI_LOWER_NUMERATOR =
  6283185307179586476925286766559005768394338798750211641949889184615632812572417997256069650684234135n;
const TWO_PI_UPPER_NUMERATOR =
  6283185307179586476925286766559005768394338798750211641949889184615632812572417997256069650684234136n;
const MAX_SAFE_INTEGER_MAGNITUDE = 9007199254740991n;

export interface ExactProofBudgetSnapshot {
  readonly operations: number;
  readonly determinantTerms: number;
  readonly euclideanSteps: number;
  readonly refinementSteps: number;
  readonly projectionAttempts: number;
  readonly maxStoredBits: number;
  readonly maxPreProductBits: number;
}

interface ExactProofLimits {
  operations: number;
  integerBits: number;
  determinantTerms: number;
  euclideanSteps: number;
  refinementSteps: number;
  projectionAttempts: number;
}

const PRODUCTION_LIMITS: ExactProofLimits = {
  operations: 10_000_000,
  integerBits: 16_384,
  determinantTerms: 1_536,
  // Includes integer gcd iterations as well as polynomial division steps.
  euclideanSteps: 1_500_000,
  refinementSteps: 4_096,
  projectionAttempts: 2,
};

export class ExactQueryProofBudgetExceeded extends Error {
  constructor() {
    super("The deterministic exact-query arithmetic budget was exhausted.");
    this.name = "ExactQueryProofBudgetExceeded";
  }
}

export class ExactProofBudget {
  readonly #lowerLimits: Partial<ExactProofLimits>;
  #limits: ExactProofLimits;
  #multiplier: number;
  #raised = false;
  #operations = 0;
  #determinantTerms = 0;
  #euclideanSteps = 0;
  #refinementSteps = 0;
  #projectionAttempts = 0;
  #maxStoredBits = 0;
  #maxPreProductBits = 0;

  /**
   * `requestMultiplier` (default 1) scales the additive production ceilings
   * (operations, determinant terms, Euclidean, refinement and projection
   * steps) for one whole-request meter spanning several queries. The
   * per-value `integerBits` ceiling is never scaled. Lower limits clamp to
   * the scaled ceilings.
   */
  constructor(
    lowerLimits: Partial<ExactProofLimits> = {},
    requestMultiplier = 1,
  ) {
    if (!Number.isSafeInteger(requestMultiplier) || requestMultiplier < 1) {
      throw new RangeError(
        "The exact proof request multiplier must be a positive integer.",
      );
    }
    this.#lowerLimits = { ...lowerLimits };
    this.#multiplier = requestMultiplier;
    this.#limits = limitsFor(lowerLimits, requestMultiplier);
  }

  /**
   * One-shot raise of the request multiplier (T08b-f1 [TECH] F12): the
   * additive ceilings become `multiplier` × production, with lower limits
   * clamped to them exactly as in the constructor (so they stay absolute);
   * `integerBits` is never scaled. Charges nothing. At most one call per
   * budget, with a positive safe integer not below the current multiplier;
   * otherwise, or if a scaled ceiling is not a safe integer, a RangeError
   * leaves the budget unchanged.
   */
  raise(multiplier: number) {
    if (this.#raised)
      throw new RangeError("An exact proof budget may be raised only once.");
    if (!Number.isSafeInteger(multiplier) || multiplier < this.#multiplier)
      throw new RangeError(
        "The raised exact proof multiplier must be a safe integer not below the current one.",
      );
    this.#limits = limitsFor(this.#lowerLimits, multiplier);
    this.#multiplier = multiplier;
    this.#raised = true;
  }

  operation(count = 1) {
    this.#operations += count;
    if (this.#operations > this.#limits.operations) this.#fail();
  }

  bigintComparison(count = 1) {
    this.operation(count);
  }

  bigintNegation() {
    this.operation();
  }

  bigintDivision(first: bigint, second: bigint) {
    this.operation();
    this.bigintComparison();
    this.stored(first, second);
    if (second === 0n) throw new RangeError("BigInt division by zero");
  }

  determinantTerm() {
    this.#determinantTerms += 1;
    if (this.#determinantTerms > this.#limits.determinantTerms) this.#fail();
  }

  euclideanStep() {
    this.#euclideanSteps += 1;
    if (this.#euclideanSteps > this.#limits.euclideanSteps) this.#fail();
  }

  refinementStep() {
    this.#refinementSteps += 1;
    if (this.#refinementSteps > this.#limits.refinementSteps) this.#fail();
  }

  projectionAttempt() {
    this.#projectionAttempts += 1;
    if (this.#projectionAttempts > this.#limits.projectionAttempts)
      this.#fail();
  }

  stored(...values: bigint[]) {
    for (const value of values) {
      const bits = bigintBitLength(value);
      this.#maxStoredBits = Math.max(this.#maxStoredBits, bits);
      if (bits > this.#limits.integerBits) this.#fail();
    }
  }

  product(first: bigint, second: bigint) {
    this.operation();
    const bits = bigintBitLength(first) + bigintBitLength(second);
    this.#maxPreProductBits = Math.max(this.#maxPreProductBits, bits);
    if (bits > this.#limits.integerBits) this.#fail();
  }

  shift(value: bigint, shift: number) {
    // Precharge the shift and its optional numeric-to-bigint shift count.
    this.operation(2);
    const bits = bigintBitLength(value) + shift;
    this.#maxPreProductBits = Math.max(this.#maxPreProductBits, bits);
    if (shift < 0 || bits > this.#limits.integerBits) this.#fail();
  }

  snapshot(): ExactProofBudgetSnapshot {
    return {
      operations: this.#operations,
      determinantTerms: this.#determinantTerms,
      euclideanSteps: this.#euclideanSteps,
      refinementSteps: this.#refinementSteps,
      projectionAttempts: this.#projectionAttempts,
      maxStoredBits: this.#maxStoredBits,
      maxPreProductBits: this.#maxPreProductBits,
    };
  }

  #fail(): never {
    throw new ExactQueryProofBudgetExceeded();
  }
}

/** The clamped limits of one multiplier; a RangeError unless safe integers. */
function limitsFor(
  lowerLimits: Partial<ExactProofLimits>,
  requestMultiplier: number,
): ExactProofLimits {
  const ceiling = (limit: number) => limit * requestMultiplier;
  const limits = {
    operations: Math.min(
      ceiling(PRODUCTION_LIMITS.operations),
      lowerLimits.operations ?? ceiling(PRODUCTION_LIMITS.operations),
    ),
    integerBits: Math.min(
      PRODUCTION_LIMITS.integerBits,
      lowerLimits.integerBits ?? PRODUCTION_LIMITS.integerBits,
    ),
    determinantTerms: Math.min(
      ceiling(PRODUCTION_LIMITS.determinantTerms),
      lowerLimits.determinantTerms ??
        ceiling(PRODUCTION_LIMITS.determinantTerms),
    ),
    euclideanSteps: Math.min(
      ceiling(PRODUCTION_LIMITS.euclideanSteps),
      lowerLimits.euclideanSteps ?? ceiling(PRODUCTION_LIMITS.euclideanSteps),
    ),
    refinementSteps: Math.min(
      ceiling(PRODUCTION_LIMITS.refinementSteps),
      lowerLimits.refinementSteps ?? ceiling(PRODUCTION_LIMITS.refinementSteps),
    ),
    projectionAttempts: Math.min(
      ceiling(PRODUCTION_LIMITS.projectionAttempts),
      lowerLimits.projectionAttempts ??
        ceiling(PRODUCTION_LIMITS.projectionAttempts),
    ),
  };
  if (
    Object.values(limits).some(
      (limit) => !Number.isSafeInteger(limit) || limit < 0,
    )
  ) {
    throw new RangeError("Exact proof limits must be nonnegative integers.");
  }
  return limits;
}

const budgetOf = (budget?: ExactProofBudget): ExactProofBudget => {
  if (!budget)
    throw new Error("Exact arithmetic requires a caller-owned proof budget.");
  return budget;
};

function bigintMagnitude(value: bigint, budget?: ExactProofBudget) {
  const meter = budgetOf(budget);
  meter.bigintComparison();
  if (value >= 0n) return value;
  meter.bigintNegation();
  const magnitude = -value;
  meter.stored(magnitude);
  return magnitude;
}

function bigintBitLength(value: bigint) {
  const magnitude = value < 0n ? -value : value;
  return magnitude === 0n ? 0 : magnitude.toString(2).length;
}

function gcdBigInt(first: bigint, second: bigint, budget?: ExactProofBudget) {
  const meter = budgetOf(budget);
  let a = bigintMagnitude(first, meter);
  let b = bigintMagnitude(second, meter);
  meter.bigintComparison(4);
  if (a === 0n) return b;
  if (b === 0n) return a;
  if (a === 1n || b === 1n) return 1n;
  for (;;) {
    meter.bigintComparison();
    if (b === 0n) return a;
    meter.euclideanStep();
    meter.bigintDivision(a, b);
    const remainder = a % b;
    meter.stored(remainder);
    [a, b] = [b, remainder];
  }
}

/** Metered exact comparison of a finite binary64 angle with k·π/2. */
export function compareFiniteAngleToQuarterTurnMultipleExact(
  angle: number,
  quarterTurns: number,
  budget: ExactProofBudget,
): -1 | 0 | 1 | null {
  if (!Number.isFinite(angle) || !Number.isSafeInteger(quarterTurns)) {
    return null;
  }
  const scaledAngle = multiplyExact(
    exactFromNumber(angle, budget),
    exact(4n, 1n, budget),
    budget,
  );
  // A safe integer converts to at most 53 magnitude bits. Admit that maximum
  // and the immutable decimal constants before conversion or use.
  budget.operation();
  budget.stored(
    MAX_SAFE_INTEGER_MAGNITUDE,
    TWO_PI_DENOMINATOR,
    TWO_PI_LOWER_NUMERATOR,
    TWO_PI_UPPER_NUMERATOR,
  );
  const multiple = BigInt(quarterTurns);
  budget.stored(multiple);
  budget.bigintComparison(2);
  const nonnegative = multiple >= 0n;
  const lowerConstant = nonnegative
    ? TWO_PI_LOWER_NUMERATOR
    : TWO_PI_UPPER_NUMERATOR;
  const upperConstant = nonnegative
    ? TWO_PI_UPPER_NUMERATOR
    : TWO_PI_LOWER_NUMERATOR;
  budget.product(multiple, lowerConstant);
  const lowerNumerator = multiple * lowerConstant;
  budget.stored(lowerNumerator);
  budget.product(multiple, upperConstant);
  const upperNumerator = multiple * upperConstant;
  budget.stored(upperNumerator);
  const lower = exact(lowerNumerator, TWO_PI_DENOMINATOR, budget);
  const upper = exact(upperNumerator, TWO_PI_DENOMINATOR, budget);
  const lowerComparison = compareExact(scaledAngle, lower, budget);
  if (lowerComparison < 0) return -1;
  const upperComparison = compareExact(scaledAngle, upper, budget);
  if (upperComparison > 0) return 1;
  return quarterTurns === 0 && angle === 0 ? 0 : null;
}

/** Metered exact comparison of a finite authored span with mathematical 2π. */
export function compareFiniteSpanToTwoPiExact(
  lower: number,
  upper: number,
  budget: ExactProofBudget,
): -1 | 1 | null {
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) {
    return null;
  }
  const span = subtractExact(
    exactFromNumber(upper, budget),
    exactFromNumber(lower, budget),
    budget,
  );
  const lowerBound = exact(TWO_PI_LOWER_NUMERATOR, TWO_PI_DENOMINATOR, budget);
  const upperBound = exact(TWO_PI_UPPER_NUMERATOR, TWO_PI_DENOMINATOR, budget);
  if (compareExact(span, lowerBound, budget) < 0) return -1;
  if (compareExact(span, upperBound, budget) > 0) return 1;
  return null;
}

export function exact(
  numerator: bigint,
  denominator: bigint,
  budget: ExactProofBudget,
): ExactFraction {
  const meter = budgetOf(budget);
  // Admit both runtime inputs before any bigint comparison or normalization.
  meter.stored(numerator, denominator);
  meter.bigintComparison(2);
  if (denominator === 0n) throw new RangeError("Exact division by zero");
  if (numerator === 0n) return { numerator: 0n, denominator: 1n };
  meter.bigintComparison();
  const negativeDenominator = denominator < 0n;
  if (negativeDenominator) meter.bigintNegation();
  meter.bigintComparison();
  if (denominator === 1n) {
    meter.stored(numerator);
    return { numerator, denominator };
  }
  meter.bigintComparison();
  if (denominator === -1n) {
    meter.bigintNegation();
    const canonicalNumerator = -numerator;
    meter.stored(canonicalNumerator);
    return { numerator: canonicalNumerator, denominator: 1n };
  }
  const divisor = gcdBigInt(numerator, denominator, budget);
  const sign = negativeDenominator ? -1n : 1n;
  meter.product(sign, numerator);
  const signedNumerator = sign * numerator;
  meter.stored(signedNumerator);
  meter.bigintDivision(signedNumerator, divisor);
  meter.product(sign, denominator);
  const signedDenominator = sign * denominator;
  meter.stored(signedDenominator);
  meter.bigintDivision(signedDenominator, divisor);
  const result = {
    numerator: signedNumerator / divisor,
    denominator: signedDenominator / divisor,
  };
  meter.stored(result.numerator, result.denominator);
  return result;
}

function exactIsZero(value: ExactFraction, budget?: ExactProofBudget) {
  budgetOf(budget).bigintComparison();
  return value.numerator === 0n;
}

function exactSign(value: ExactFraction, budget?: ExactProofBudget) {
  budgetOf(budget).bigintComparison(2);
  return value.numerator < 0n ? -1 : value.numerator > 0n ? 1 : 0;
}

export function reduceExact(value: ExactFraction, budget?: ExactProofBudget) {
  const meter = budgetOf(budget);
  meter.bigintComparison(2);
  if (value.denominator <= 0n)
    throw new RangeError("Expected a canonical exact fraction");
  meter.stored(value.numerator, value.denominator);
  return { numerator: value.numerator, denominator: value.denominator };
}

export function exactFromNumber(value: number, budget?: ExactProofBudget) {
  if (!Number.isFinite(value)) throw new RangeError("Expected finite binary64");
  if (value === 0) return exact(0n, 1n, budgetOf(budget));
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  const high = view.getUint32(0, false);
  const low = view.getUint32(4, false);
  const exponentBits = (high >>> 20) & 0x7ff;
  const meter = budgetOf(budget);
  meter.operation(2);
  const highFraction = BigInt(high & 0xfffff);
  const lowFraction = BigInt(low);
  meter.stored(highFraction, lowFraction);
  meter.shift(highFraction, 32);
  meter.operation();
  const fractionBits = (highFraction << 32n) | lowFraction;
  meter.stored(fractionBits);
  let significand = fractionBits;
  if (exponentBits !== 0) {
    meter.shift(1n, 52);
    meter.operation();
    significand = (1n << 52n) | fractionBits;
    meter.stored(significand);
  }
  const exponent = (exponentBits === 0 ? -1022 : exponentBits - 1023) - 52;
  let numerator = significand;
  if (high >>> 31 !== 0) {
    meter.bigintNegation();
    numerator = -numerator;
    meter.stored(numerator);
  }
  let denominator = 1n;
  if (exponent >= 0) {
    meter.shift(numerator, exponent);
    numerator <<= BigInt(exponent);
    meter.stored(numerator);
  } else {
    meter.shift(denominator, -exponent);
    denominator <<= BigInt(-exponent);
    meter.stored(denominator);
  }
  return exact(numerator, denominator, meter);
}

export function addExact(
  first: ExactFraction,
  second: ExactFraction,
  budget?: ExactProofBudget,
) {
  const meter = budgetOf(budget);
  meter.bigintComparison();
  if (first.denominator === second.denominator) {
    meter.operation();
    const numerator = first.numerator + second.numerator;
    meter.stored(numerator);
    return exact(numerator, first.denominator, meter);
  }
  const common = gcdBigInt(first.denominator, second.denominator, budget);
  meter.bigintDivision(second.denominator, common);
  const firstMultiplier = second.denominator / common;
  meter.stored(firstMultiplier);
  meter.bigintDivision(first.denominator, common);
  const secondMultiplier = first.denominator / common;
  meter.stored(secondMultiplier);
  meter.product(first.numerator, firstMultiplier);
  const firstProduct = first.numerator * firstMultiplier;
  meter.stored(firstProduct);
  meter.product(second.numerator, secondMultiplier);
  const secondProduct = second.numerator * secondMultiplier;
  meter.stored(secondProduct);
  meter.operation();
  const numerator = firstProduct + secondProduct;
  meter.stored(numerator);
  const remainingCancellation = gcdBigInt(numerator, common, budget);
  meter.bigintDivision(numerator, remainingCancellation);
  meter.product(first.denominator, firstMultiplier);
  const denominator = first.denominator * firstMultiplier;
  meter.stored(denominator);
  meter.bigintDivision(denominator, remainingCancellation);
  const result = {
    numerator: numerator / remainingCancellation,
    denominator: denominator / remainingCancellation,
  };
  meter.stored(result.numerator, result.denominator);
  return result;
}

export function negateExact(
  value: ExactFraction,
  budget?: ExactProofBudget,
): ExactFraction {
  const meter = budgetOf(budget);
  meter.bigintNegation();
  const numerator = -value.numerator;
  meter.stored(numerator);
  return { numerator, denominator: value.denominator };
}

export function subtractExact(
  first: ExactFraction,
  second: ExactFraction,
  budget?: ExactProofBudget,
) {
  return addExact(first, negateExact(second, budget), budget);
}

export function multiplyExact(
  first: ExactFraction,
  second: ExactFraction,
  budget?: ExactProofBudget,
) {
  const meter = budgetOf(budget);
  meter.bigintComparison(4);
  if (first.numerator === 0n || second.numerator === 0n)
    return exact(0n, 1n, meter);
  if (first.numerator === first.denominator) return reduceExact(second, budget);
  if (second.numerator === second.denominator)
    return reduceExact(first, budget);
  const firstCancellation = gcdBigInt(
    first.numerator,
    second.denominator,
    budget,
  );
  const secondCancellation = gcdBigInt(
    second.numerator,
    first.denominator,
    budget,
  );
  meter.bigintDivision(first.numerator, firstCancellation);
  const firstNumerator = first.numerator / firstCancellation;
  meter.stored(firstNumerator);
  meter.bigintDivision(second.numerator, secondCancellation);
  const secondNumerator = second.numerator / secondCancellation;
  meter.stored(secondNumerator);
  meter.bigintDivision(first.denominator, secondCancellation);
  const firstDenominator = first.denominator / secondCancellation;
  meter.stored(firstDenominator);
  meter.bigintDivision(second.denominator, firstCancellation);
  const secondDenominator = second.denominator / firstCancellation;
  meter.stored(secondDenominator);
  meter.product(firstNumerator, secondNumerator);
  meter.product(firstDenominator, secondDenominator);
  const result = {
    numerator: firstNumerator * secondNumerator,
    denominator: firstDenominator * secondDenominator,
  };
  // Cross-cancellation of both numerator/denominator pairs proves this product
  // canonical; a second whole-result gcd would duplicate exact work.
  meter.stored(result.numerator, result.denominator);
  return result;
}

export function divideExact(
  first: ExactFraction,
  second: ExactFraction,
  budget?: ExactProofBudget,
) {
  budgetOf(budget).bigintComparison();
  if (second.numerator === 0n) throw new RangeError("Exact division by zero");
  return multiplyExact(
    first,
    exact(second.denominator, second.numerator, budgetOf(budget)),
    budget,
  );
}

export function compareExact(
  first: ExactFraction,
  second: ExactFraction,
  budget?: ExactProofBudget,
) {
  const numerator = subtractExact(first, second, budget).numerator;
  budgetOf(budget).bigintComparison(2);
  return numerator < 0n ? -1 : numerator > 0n ? 1 : 0;
}

export function exactToNumber(value: ExactFraction, budget?: ExactProofBudget) {
  const meter = budgetOf(budget);
  meter.bigintComparison();
  if (value.numerator === 0n) return 0;
  meter.bigintComparison();
  const negative = value.numerator < 0n;
  const numerator = bigintMagnitude(value.numerator, budget);
  const denominator = value.denominator;
  const bits = (integer: bigint) => {
    meter.operation();
    return integer.toString(2).length;
  };
  const toNumber = (integer: bigint) => {
    meter.operation();
    return Number(integer);
  };
  let exponent = bits(numerator) - bits(denominator);
  const shiftedLess = (left: bigint, right: bigint, shift: number) => {
    if (shift >= 0) {
      meter.shift(right, shift);
      const shifted = right << BigInt(shift);
      meter.stored(shifted);
      meter.bigintComparison();
      return left < shifted;
    }
    meter.shift(left, -shift);
    const shifted = left << BigInt(-shift);
    meter.stored(shifted);
    meter.bigintComparison();
    return shifted < right;
  };
  if (shiftedLess(numerator, denominator, exponent)) exponent -= 1;
  const roundedQuotient = (top: bigint, bottom: bigint) => {
    meter.bigintDivision(top, bottom);
    const quotient = top / bottom;
    meter.stored(quotient);
    meter.bigintDivision(top, bottom);
    const remainder = top % bottom;
    meter.stored(remainder);
    meter.product(remainder, 2n);
    const doubledRemainder = remainder * 2n;
    meter.stored(doubledRemainder);
    meter.operation();
    const comparison = doubledRemainder - bottom;
    meter.stored(comparison);
    meter.bigintComparison(2);
    if (comparison > 0n) {
      meter.operation();
      const rounded = quotient + 1n;
      meter.stored(rounded);
      return rounded;
    }
    if (comparison < 0n) return quotient;
    meter.bigintDivision(quotient, 2n);
    const parity = quotient % 2n;
    meter.stored(parity);
    meter.bigintComparison();
    if (parity === 0n) return quotient;
    meter.operation();
    const rounded = quotient + 1n;
    meter.stored(rounded);
    return rounded;
  };
  let rounded: number;
  if (exponent < -1022) {
    meter.shift(numerator, 1074);
    const shiftedNumerator = numerator << 1074n;
    meter.stored(shiftedNumerator);
    rounded =
      toNumber(roundedQuotient(shiftedNumerator, denominator)) *
      Number.MIN_VALUE;
  } else {
    const shift = 52 - exponent;
    if (shift >= 0) {
      meter.shift(numerator, shift);
      const shiftedNumerator = numerator << BigInt(shift);
      meter.stored(shiftedNumerator);
      rounded =
        toNumber(roundedQuotient(shiftedNumerator, denominator)) *
        2 ** (exponent - 52);
    } else {
      meter.shift(denominator, -shift);
      const shiftedDenominator = denominator << BigInt(-shift);
      meter.stored(shiftedDenominator);
      rounded =
        toNumber(roundedQuotient(numerator, shiftedDenominator)) *
        2 ** (exponent - 52);
    }
  }
  return negative ? -rounded : rounded;
}

export function nextBinary64(
  value: number,
  direction: "down" | "up",
  budget?: ExactProofBudget,
) {
  if (!Number.isFinite(value)) return value;
  if (value === 0)
    return direction === "up" ? Number.MIN_VALUE : -Number.MIN_VALUE;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  const meter = budgetOf(budget);
  meter.operation();
  const bits = view.getBigUint64(0, false);
  meter.stored(bits);
  meter.operation();
  const adjacentBits = bits + (value > 0 === (direction === "up") ? 1n : -1n);
  meter.stored(adjacentBits);
  meter.operation();
  view.setBigUint64(0, adjacentBits, false);
  return view.getFloat64(0, false);
}

export function outwardExactNumber(
  value: ExactFraction,
  direction: "down" | "up",
  budget?: ExactProofBudget,
) {
  const nearest = exactToNumber(value, budget);
  if (!Number.isFinite(nearest)) return nearest;
  const comparison = compareExact(
    exactFromNumber(nearest, budget),
    value,
    budget,
  );
  return (direction === "down" && comparison > 0) ||
    (direction === "up" && comparison < 0)
    ? nextBinary64(nearest, direction, budget)
    : nearest;
}

export function polynomialTrim(
  polynomial: ExactPolynomial,
  budget?: ExactProofBudget,
): ExactFraction[] {
  const result = polynomial.map((coefficient) =>
    reduceExact(coefficient, budget),
  );
  while (result.length > 1 && exactIsZero(result.at(-1)!, budget)) result.pop();
  return result;
}

export function polynomialAdd(
  first: ExactPolynomial,
  second: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  const zero = exact(0n, 1n, budgetOf(budget));
  return polynomialTrim(
    Array.from({ length: Math.max(first.length, second.length) }, (_, index) =>
      addExact(first[index] ?? zero, second[index] ?? zero, budget),
    ),
    budget,
  );
}

export function polynomialScale(
  polynomial: ExactPolynomial,
  scalar: ExactFraction,
  budget?: ExactProofBudget,
) {
  return polynomialTrim(
    polynomial.map((coefficient) => multiplyExact(coefficient, scalar, budget)),
    budget,
  );
}

export function polynomialMultiply(
  first: ExactPolynomial,
  second: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  const result = Array.from({ length: first.length + second.length - 1 }, () =>
    exact(0n, 1n, budgetOf(budget)),
  );
  for (let firstIndex = 0; firstIndex < first.length; firstIndex += 1) {
    for (let secondIndex = 0; secondIndex < second.length; secondIndex += 1) {
      result[firstIndex + secondIndex] = addExact(
        result[firstIndex + secondIndex]!,
        multiplyExact(first[firstIndex]!, second[secondIndex]!, budget),
        budget,
      );
    }
  }
  return polynomialTrim(result, budget);
}

export function polynomialDerivative(
  polynomial: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  return polynomial.length === 1
    ? [exact(0n, 1n, budgetOf(budget))]
    : polynomial.slice(1).map((coefficient, index) => {
        budgetOf(budget).operation();
        return multiplyExact(
          coefficient,
          exact(BigInt(index + 1), 1n, budgetOf(budget)),
          budget,
        );
      });
}

export function polynomialEvaluate(
  polynomial: ExactPolynomial,
  parameter: ExactFraction,
  budget?: ExactProofBudget,
) {
  let result = exact(0n, 1n, budgetOf(budget));
  for (let index = polynomial.length - 1; index >= 0; index -= 1) {
    result = addExact(
      multiplyExact(result, parameter, budget),
      polynomial[index]!,
      budget,
    );
  }
  return result;
}

export function polynomialRemainder(
  dividend: ExactPolynomial,
  divisor: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  const result = polynomialTrim(dividend, budget);
  const normalizedDivisor = polynomialTrim(divisor, budget);
  if (
    normalizedDivisor.length === 1 &&
    exactIsZero(normalizedDivisor[0]!, budget)
  )
    throw new RangeError("Polynomial division by zero");
  while (
    result.length >= normalizedDivisor.length &&
    !polynomialIsZero(result, budget)
  ) {
    budgetOf(budget).euclideanStep();
    const factor = divideExact(
      result.at(-1)!,
      normalizedDivisor.at(-1)!,
      budget,
    );
    const offset = result.length - normalizedDivisor.length;
    for (let index = 0; index < normalizedDivisor.length; index += 1) {
      result[index + offset] = subtractExact(
        result[index + offset]!,
        multiplyExact(factor, normalizedDivisor[index]!, budget),
        budget,
      );
    }
    while (result.length > 1 && exactIsZero(result.at(-1)!, budget))
      result.pop();
  }
  return polynomialTrim(result, budget);
}

/**
 * Integer coefficients L·cᵢ of a polynomial, where L > 0 is the lcm of the
 * coefficient denominators. Every denominator is first proved positive, since a
 * non-canonical caller coefficient would otherwise flip signs silently.
 */
function positiveDenominatorMultiple(
  polynomial: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  const meter = budgetOf(budget);
  const coefficients = polynomial.map((coefficient) =>
    reduceExact(coefficient, meter),
  );
  let lcm = 1n;
  for (const coefficient of coefficients) {
    meter.bigintComparison();
    if (coefficient.denominator === 1n) continue;
    const common = gcdBigInt(lcm, coefficient.denominator, meter);
    meter.bigintDivision(coefficient.denominator, common);
    const factor = coefficient.denominator / common;
    meter.stored(factor);
    meter.product(lcm, factor);
    lcm *= factor;
    meter.stored(lcm);
  }
  return coefficients.map((coefficient) => {
    meter.bigintDivision(lcm, coefficient.denominator);
    const multiplier = lcm / coefficient.denominator;
    meter.stored(multiplier);
    meter.product(coefficient.numerator, multiplier);
    const integer = coefficient.numerator * multiplier;
    meter.stored(integer);
    return integer;
  });
}

/**
 * Private (L/c)·rem(A, B) with L > 0 the denominator lcm and c > 0 the integer
 * content: a positive multiple of the exact remainder. Only the gcd, Sturm and
 * isolated-sign owners may use it, because they depend on a remainder solely up
 * to a positive scalar. It never normalizes the leading sign.
 */
function remainderUpToPositiveScale(
  dividend: ExactPolynomial,
  divisor: ExactPolynomial,
  budget?: ExactProofBudget,
): ExactFraction[] {
  const remainder = polynomialRemainder(dividend, divisor, budget);
  if (polynomialIsZero(remainder, budget)) return remainder;
  const meter = budgetOf(budget);
  const integers = positiveDenominatorMultiple(remainder, meter);
  let content = 0n;
  for (const integer of integers) content = gcdBigInt(content, integer, meter);
  return integers.map((integer) => {
    meter.bigintDivision(integer, content);
    const numerator = integer / content;
    meter.stored(numerator);
    return { numerator, denominator: 1n };
  });
}

/**
 * Private fraction-free exact sign of P(p/q): for q > 0 and L > 0,
 * Σ L·cᵢ·pⁱ·q^(n−i) = L·qⁿ·P(p/q) has the same sign and zero set.
 */
function polynomialSignAt(
  polynomial: ExactPolynomial,
  parameter: ExactFraction,
  budget?: ExactProofBudget,
): -1 | 0 | 1 {
  const meter = budgetOf(budget);
  const { numerator, denominator } = reduceExact(parameter, meter);
  const coefficients = positiveDenominatorMultiple(polynomial, meter);
  let accumulator = coefficients.at(-1)!;
  let denominatorPower = 1n;
  for (let index = coefficients.length - 2; index >= 0; index -= 1) {
    meter.product(denominatorPower, denominator);
    denominatorPower *= denominator;
    meter.stored(denominatorPower);
    meter.product(accumulator, numerator);
    const scaled = accumulator * numerator;
    meter.stored(scaled);
    meter.product(coefficients[index]!, denominatorPower);
    const term = coefficients[index]! * denominatorPower;
    meter.stored(term);
    meter.operation();
    accumulator = scaled + term;
    meter.stored(accumulator);
  }
  meter.bigintComparison(2);
  return accumulator < 0n ? -1 : accumulator > 0n ? 1 : 0;
}

export function polynomialExactDivide(
  dividend: ExactPolynomial,
  divisor: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  const remainder = polynomialTrim(dividend, budget);
  const normalizedDivisor = polynomialTrim(divisor, budget);
  const quotient = Array.from(
    { length: Math.max(1, remainder.length - normalizedDivisor.length + 1) },
    () => exact(0n, 1n, budgetOf(budget)),
  );
  while (
    remainder.length >= normalizedDivisor.length &&
    !polynomialIsZero(remainder, budget)
  ) {
    budgetOf(budget).euclideanStep();
    const offset = remainder.length - normalizedDivisor.length;
    const factor = divideExact(
      remainder.at(-1)!,
      normalizedDivisor.at(-1)!,
      budget,
    );
    quotient[offset] = factor;
    for (let index = 0; index < normalizedDivisor.length; index += 1) {
      remainder[offset + index] = subtractExact(
        remainder[offset + index]!,
        multiplyExact(factor, normalizedDivisor[index]!, budget),
        budget,
      );
    }
    while (remainder.length > 1 && exactIsZero(remainder.at(-1)!, budget))
      remainder.pop();
  }
  if (!polynomialIsZero(remainder, budget))
    throw new Error("Inexact polynomial division");
  return polynomialTrim(quotient, budget);
}

export function polynomialGcd(
  first: ExactPolynomial,
  second: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  let left = polynomialTrim(first, budget);
  let right = polynomialTrim(second, budget);
  while (!polynomialIsZero(right, budget)) {
    const remainder = remainderUpToPositiveScale(left, right, budget);
    left = right;
    right = remainder;
  }
  return polynomialScale(
    left,
    divideExact(exact(1n, 1n, budgetOf(budget)), left.at(-1)!, budget),
    budget,
  );
}

export function polynomialIsZero(
  polynomial: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  return polynomial.every((coefficient) => exactIsZero(coefficient, budget));
}

function sturmSequence(polynomial: ExactPolynomial, budget?: ExactProofBudget) {
  const squareFree = polynomialTrim(polynomial, budget);
  const derivative = polynomialTrim(
    polynomialDerivative(squareFree, budget),
    budget,
  );
  const sequence: ExactFraction[][] = [squareFree, derivative];
  while (!polynomialIsZero(sequence.at(-1)!, budget)) {
    const remainder = remainderUpToPositiveScale(
      sequence.at(-2)!,
      sequence.at(-1)!,
      budget,
    );
    if (polynomialIsZero(remainder, budget)) break;
    sequence.push(remainder.map((value) => negateExact(value, budget)));
  }
  return sequence;
}

function sturmVariations(
  sequence: readonly ExactPolynomial[],
  parameter: ExactFraction,
  budget?: ExactProofBudget,
) {
  let previous = 0;
  let variations = 0;
  for (const polynomial of sequence) {
    const sign = polynomialSignAt(polynomial, parameter, budget);
    if (sign === 0) continue;
    if (previous !== 0 && sign !== previous) variations += 1;
    previous = sign;
  }
  return variations;
}

function sturmVariationsAtSide(
  sequence: readonly ExactPolynomial[],
  parameter: ExactFraction,
  side: "left" | "right",
  budget?: ExactProofBudget,
) {
  let previous = 0;
  let variations = 0;
  for (const polynomial of sequence) {
    let derivative = polynomial;
    let order = 0;
    let valueSign = polynomialSignAt(derivative, parameter, budget);
    while (valueSign === 0 && derivative.length > 1) {
      derivative = polynomialDerivative(derivative, budget);
      order += 1;
      valueSign = polynomialSignAt(derivative, parameter, budget);
    }
    if (valueSign === 0) continue;
    let sign: number = valueSign;
    if (side === "left" && order % 2 === 1) sign = -sign;
    if (previous !== 0 && sign !== previous) variations += 1;
    previous = sign;
  }
  return variations;
}

/** Counts distinct roots in the closed exact interval. */
export function countDistinctRoots(
  polynomial: ExactPolynomial,
  interval: ExactInterval,
  budget?: ExactProofBudget,
) {
  let squareFree = polynomialTrim(polynomial, budget);
  if (squareFree.length === 1)
    return polynomialIsZero(squareFree, budget) ? null : 0;
  const common = polynomialGcd(
    squareFree,
    polynomialDerivative(squareFree, budget),
    budget,
  );
  if (common.length > 1)
    squareFree = polynomialExactDivide(squareFree, common, budget);
  const sequence = sturmSequence(squareFree, budget);
  const lowerRoot =
    polynomialSignAt(squareFree, interval[0], budget) === 0 ? 1 : 0;
  return (
    sturmVariations(sequence, interval[0], budget) -
    sturmVariations(sequence, interval[1], budget) +
    lowerRoot
  );
}

function divideLinear(
  polynomial: ExactPolynomial,
  root: ExactFraction,
  budget?: ExactProofBudget,
) {
  return polynomialExactDivide(
    polynomial,
    [negateExact(root, budget), exact(1n, 1n, budgetOf(budget))],
    budget,
  );
}

export function isolateDistinctRootsClosed(
  input: ExactPolynomial,
  interval: ExactInterval,
  budget?: ExactProofBudget,
): ExactInterval[] | null {
  let polynomial = polynomialTrim(input, budget);
  if (polynomial.length === 1)
    return polynomialIsZero(polynomial, budget) ? null : [];
  const common = polynomialGcd(
    polynomial,
    polynomialDerivative(polynomial, budget),
    budget,
  );
  if (common.length > 1)
    polynomial = polynomialExactDivide(polynomial, common, budget);
  const roots: ExactInterval[] = [];
  for (const endpoint of interval) {
    if (
      polynomial.length > 1 &&
      polynomialSignAt(polynomial, endpoint, budget) === 0
    ) {
      roots.push([endpoint, endpoint]);
      polynomial = divideLinear(polynomial, endpoint, budget);
    }
  }
  // This square-free polynomial and its Sturm sequence are immutable for the
  // complete isolation. Exact split roots are removed only from their local
  // branch accounting; restarting over the whole domain would re-enumerate
  // roots already emitted by earlier branches.
  const squareFree = polynomial;
  const sequence = sturmSequence(squareFree, budget);
  const isRoot = (parameter: ExactFraction) =>
    polynomialSignAt(squareFree, parameter, budget) === 0;
  const countOpenWithSequence = (bounds: ExactInterval) =>
    sturmVariationsAtSide(sequence, bounds[0], "right", budget) -
    sturmVariationsAtSide(sequence, bounds[1], "left", budget);
  const total = countOpenWithSequence(interval);
  const queue = total > 0 ? [{ interval, count: total }] : [];
  while (queue.length > 0) {
    budgetOf(budget).refinementStep();
    const current = queue.pop()!;
    const [lower, upper] = current.interval;
    if (
      current.count === 1 &&
      !isRoot(lower) &&
      !isRoot(upper) &&
      nextBinary64(exactToNumber(lower, budget), "up", budget) >=
        exactToNumber(upper, budget)
    ) {
      roots.push(current.interval);
      continue;
    }
    const midpoint = divideExact(
      addExact(lower, upper, budget),
      exact(2n, 1n, budgetOf(budget)),
      budget,
    );
    const left: ExactInterval = [lower, midpoint];
    const right: ExactInterval = [midpoint, upper];
    const midpointIsRoot = isRoot(midpoint);
    const leftCount = countOpenWithSequence(left);
    const rightCount = countOpenWithSequence(right);
    if (
      leftCount < 0 ||
      rightCount < 0 ||
      leftCount + rightCount + (midpointIsRoot ? 1 : 0) !== current.count
    )
      throw new Error("Sturm root accounting invariant failed");
    if (midpointIsRoot) roots.push([midpoint, midpoint]);
    if (rightCount > 0) queue.push({ interval: right, count: rightCount });
    if (leftCount > 0) queue.push({ interval: left, count: leftCount });
  }
  roots.sort((first, second) => compareExact(first[0], second[0], budget));
  // Closed isolating boxes must be strictly separated, not merely own one
  // immutable root each. A shared nonroot split endpoint is still an overlap.
  for (let index = 1; index < roots.length; index += 1) {
    while (compareExact(roots[index - 1]![1], roots[index]![0], budget) >= 0) {
      roots[index - 1] = refineIsolatedRoot(
        squareFree,
        roots[index - 1]!,
        budget,
      );
      roots[index] = refineIsolatedRoot(squareFree, roots[index]!, budget);
    }
  }
  return roots;
}

export function refineIsolatedRoot(
  polynomial: ExactPolynomial,
  interval: ExactInterval,
  budget?: ExactProofBudget,
): ExactInterval {
  if (compareExact(interval[0], interval[1], budget) === 0) return interval;
  budgetOf(budget).refinementStep();
  const midpoint = divideExact(
    addExact(interval[0], interval[1], budget),
    exact(2n, 1n, budgetOf(budget)),
    budget,
  );
  if (polynomialSignAt(polynomial, midpoint, budget) === 0)
    return [midpoint, midpoint];
  const left: ExactInterval = [interval[0], midpoint];
  return countDistinctRoots(polynomial, left, budget) === 1
    ? left
    : [midpoint, interval[1]];
}

function intervalAddExact(
  first: ExactInterval,
  second: ExactInterval,
  budget?: ExactProofBudget,
): ExactInterval {
  return [
    addExact(first[0], second[0], budget),
    addExact(first[1], second[1], budget),
  ];
}

function intervalMultiplyExact(
  first: ExactInterval,
  second: ExactInterval,
  budget?: ExactProofBudget,
): ExactInterval {
  const products = [
    multiplyExact(first[0], second[0], budget),
    multiplyExact(first[0], second[1], budget),
    multiplyExact(first[1], second[0], budget),
    multiplyExact(first[1], second[1], budget),
  ];
  let lower = products[0]!;
  let upper = products[0]!;
  for (const product of products.slice(1)) {
    if (compareExact(product, lower, budget) < 0) lower = product;
    if (compareExact(product, upper, budget) > 0) upper = product;
  }
  return [lower, upper];
}

export function polynomialIntervalEvaluate(
  polynomial: ExactPolynomial,
  interval: ExactInterval,
  budget?: ExactProofBudget,
): ExactInterval {
  const meter = budgetOf(budget);
  let result: ExactInterval = [exact(0n, 1n, meter), exact(0n, 1n, meter)];
  for (let index = polynomial.length - 1; index >= 0; index -= 1) {
    const coefficient: ExactInterval = [polynomial[index]!, polynomial[index]!];
    result = intervalAddExact(
      intervalMultiplyExact(result, interval, budget),
      coefficient,
      budget,
    );
  }
  return result;
}

/** Exact sign of a polynomial at the sole root in an isolating interval. */
export function signAtIsolatedRoot(
  rootPolynomial: ExactPolynomial,
  initialInterval: ExactInterval,
  valuePolynomial: ExactPolynomial,
  budget?: ExactProofBudget,
) {
  const remainder = remainderUpToPositiveScale(
    valuePolynomial,
    rootPolynomial,
    budget,
  );
  if (polynomialIsZero(remainder, budget))
    return { sign: 0 as const, interval: initialInterval };
  const common = polynomialGcd(rootPolynomial, remainder, budget);
  if (
    common.length > 1 &&
    countDistinctRoots(common, initialInterval, budget) === 1
  )
    return { sign: 0 as const, interval: initialInterval };
  let interval = initialInterval;
  for (;;) {
    const value = polynomialIntervalEvaluate(remainder, interval, budget);
    if (exactSign(value[0], budget) > 0) return { sign: 1 as const, interval };
    if (exactSign(value[1], budget) < 0) return { sign: -1 as const, interval };
    interval = refineIsolatedRoot(rootPolynomial, interval, budget);
  }
}
