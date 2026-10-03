import {
  type ExactProofBudget,
  nextBinary64,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

export interface CertifiedInterval {
  readonly lower: number;
  readonly upper: number;
}

export interface CertifiedSinCos {
  readonly sine: CertifiedInterval;
  readonly cosine: CertifiedInterval;
  readonly quadrant: 0 | 1 | 2 | 3;
}

// Adjacent binary64 bounds known to contain the mathematical constants.
const HALF_PI_LOWER = 1.5707963267948966;
const HALF_PI_UPPER = 1.5707963267948968;
// Accuracy bound on the reduced angle; see the certifySinCos proof.
const REDUCED_ANGLE_BOUND = 1;
const HALF_PI_SEED = 1.5707963267948966;
const MAX_QUADRANT = 1_048_576;
const MAX_BINARY64_STORAGE = 18446744073709551615n;
// Complete maximum-path fixed-work accounting. nextBinary64 calls and their
// representation work are excluded because that sole owner charges them.
const FIXED_ARITHMETIC_OPERATIONS = 594;
const FIXED_LOOP_INCREMENTS = 75; // Taylor 14 + remainder loops 31 + 30.
const FIXED_COMPARISONS = 90;
const FIXED_LIBRARY_CALLS =
  1 + // Number.isFinite
  1 + // Math.round
  1 + // Number.isSafeInteger
  1 + // Range-reduction Math.abs
  2 * (1 + 14 * 4) + // Math.min/Math.max in 57 interval multiplications.
  3; // Final Math.max and two Math.abs calls.
const CERTIFIED_TRIG_FIXED_OPERATIONS =
  FIXED_ARITHMETIC_OPERATIONS +
  FIXED_LOOP_INCREMENTS +
  FIXED_COMPARISONS +
  FIXED_LIBRARY_CALLS;

/** Outward-rounded interval addition owned by the certified numeric layer. */
export function outwardIntervalAdd(
  first: CertifiedInterval,
  second: CertifiedInterval,
  budget: ExactProofBudget,
): CertifiedInterval {
  return {
    lower: nextBinary64(first.lower + second.lower, "down", budget),
    upper: nextBinary64(first.upper + second.upper, "up", budget),
  };
}

/** Outward-rounded interval multiplication owned by the certified numeric layer. */
export function outwardIntervalMultiply(
  first: CertifiedInterval,
  second: CertifiedInterval,
  budget: ExactProofBudget,
): CertifiedInterval {
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

export function outwardIntervalNegate(
  interval: CertifiedInterval,
): CertifiedInterval {
  return { lower: -interval.upper, upper: -interval.lower };
}

function scale(
  interval: CertifiedInterval,
  scalar: number,
  budget: ExactProofBudget,
): CertifiedInterval {
  return outwardIntervalMultiply(
    interval,
    {
      lower: nextBinary64(scalar, "down", budget),
      upper: nextBinary64(scalar, "up", budget),
    },
    budget,
  );
}

function widen(
  interval: CertifiedInterval,
  radius: number,
  budget: ExactProofBudget,
): CertifiedInterval {
  return {
    lower: nextBinary64(interval.lower - radius, "down", budget),
    upper: nextBinary64(interval.upper + radius, "up", budget),
  };
}

function taylorRemainder(
  maximum: number,
  degree: number,
  budget: ExactProofBudget,
) {
  let bound = 1;
  for (let index = 1; index <= degree; index += 1) {
    bound = nextBinary64((bound * maximum) / index, "up", budget);
  }
  return bound;
}

/**
 * Bounded outward sin/cos enclosure without calling native trig or modulo.
 * The rounded quadrant is only a range-reduction seed. All fixed work and the
 * 64-bit nextafter representation are precharged to the caller's one meter.
 *
 * Proof sketch. Let a be the finite input angle and q = round(fl(a / L)).
 * 1. Reduction: L < π/2 < U, and each rounded product or difference is pushed
 *    one ulp outward, so r = a − qπ/2 lies in `reduced` for every q.
 * 2. Taylor: the loops sum sin's series to r^29 and cos's to r^28. The next
 *    nonzero terms have degree 31 and 30, and |sin^(n)| = |cos^(n)| ≤ 1 for
 *    every ξ, so the Lagrange remainders are at most |r|^31/31! and
 *    |r|^30/30!. `taylorRemainder(max|reduced|, 31 / 30)` bounds these (each
 *    step may fall about one ulp short before its upward nudge; the final
 *    `widen` absorbs that, so the enclosure stays sound).
 *    The interval terms and outward scalars enclose each term for every r in
 *    `reduced`. This holds for any finite r, not only |r| ≤ π/4.
 * 3. Quadrant: sin(r + qπ/2) and cos(r + qπ/2) are sin r, cos r rotated by
 *    q mod 4 (identity, (cos, −sin), (−sin, −cos), (−cos, sin)) for every r.
 * 4. Accuracy: at an odd multiple of π/4 both neighbouring q leave |reduced|
 *    a few ulps above π/4, so the bound is |reduced| ≤ 1. There the
 *    remainders are at most 1/31! ≈ 1.2e-34 and 1/30! ≈ 3.8e-33, so the
 *    width comes from the outward rounding, not the truncation. With
 *    |q| ≤ 2^20 the reduction already keeps |reduced| < π/4 + 1e-9, so the
 *    check only states the accuracy precondition locally.
 */
export function certifySinCos(
  angle: number,
  budget: ExactProofBudget,
): CertifiedSinCos | null {
  budget.stored(MAX_BINARY64_STORAGE);
  budget.operation(CERTIFIED_TRIG_FIXED_OPERATIONS);
  if (!Number.isFinite(angle)) return null;
  if (angle === 0) {
    return {
      sine: { lower: 0, upper: 0 },
      cosine: { lower: 1, upper: 1 },
      quadrant: 0,
    };
  }
  const quadrantIndex = Math.round(angle / HALF_PI_SEED);
  if (
    !Number.isSafeInteger(quadrantIndex) ||
    Math.abs(quadrantIndex) > MAX_QUADRANT
  ) {
    return null;
  }
  const product =
    quadrantIndex >= 0
      ? {
          lower: nextBinary64(quadrantIndex * HALF_PI_LOWER, "down", budget),
          upper: nextBinary64(quadrantIndex * HALF_PI_UPPER, "up", budget),
        }
      : {
          lower: nextBinary64(quadrantIndex * HALF_PI_UPPER, "down", budget),
          upper: nextBinary64(quadrantIndex * HALF_PI_LOWER, "up", budget),
        };
  const reduced: CertifiedInterval = {
    lower: nextBinary64(angle - product.upper, "down", budget),
    upper: nextBinary64(angle - product.lower, "up", budget),
  };
  if (
    reduced.lower < -REDUCED_ANGLE_BOUND ||
    reduced.upper > REDUCED_ANGLE_BOUND
  ) {
    return null;
  }
  const square = outwardIntervalMultiply(reduced, reduced, budget);
  let sineTerm = reduced;
  let sine = reduced;
  let cosineTerm: CertifiedInterval = { lower: 1, upper: 1 };
  let cosine = cosineTerm;
  const TERMS = 14;
  for (let index = 1; index <= TERMS; index += 1) {
    sineTerm = scale(
      outwardIntervalMultiply(sineTerm, square, budget),
      -1 / (2 * index * (2 * index + 1)),
      budget,
    );
    sine = outwardIntervalAdd(sine, sineTerm, budget);
    cosineTerm = scale(
      outwardIntervalMultiply(cosineTerm, square, budget),
      -1 / ((2 * index - 1) * (2 * index)),
      budget,
    );
    cosine = outwardIntervalAdd(cosine, cosineTerm, budget);
  }
  const maximum = Math.max(Math.abs(reduced.lower), Math.abs(reduced.upper));
  sine = widen(sine, taylorRemainder(maximum, 2 * TERMS + 3, budget), budget);
  cosine = widen(
    cosine,
    taylorRemainder(maximum, 2 * TERMS + 2, budget),
    budget,
  );
  const quadrant = (((quadrantIndex % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  if (quadrant === 0) return { sine, cosine, quadrant };
  if (quadrant === 1)
    return {
      sine: cosine,
      cosine: outwardIntervalNegate(sine),
      quadrant,
    };
  if (quadrant === 2)
    return {
      sine: outwardIntervalNegate(sine),
      cosine: outwardIntervalNegate(cosine),
      quadrant,
    };
  return {
    sine: outwardIntervalNegate(cosine),
    cosine: sine,
    quadrant,
  };
}
