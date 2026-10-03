import { expect, test } from "vitest";
import { certifySinCos } from "@/domain/modeling/neutral-curve-certification/certified-trig";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

function contains(
  interval: readonly [number, number] | { lower: number; upper: number },
  value: number,
) {
  const lower = Array.isArray(interval) ? interval[0] : interval.lower;
  const upper = Array.isArray(interval) ? interval[1] : interval.upper;
  return value >= lower! && value <= upper!;
}

test("certified trig encloses zero and bounded ordinary angles", () => {
  expect(certifySinCos(0, new ExactProofBudget())).toEqual({
    sine: { lower: 0, upper: 0 },
    cosine: { lower: 1, upper: 1 },
    quadrant: 0,
  });
  for (const angle of [-7, -1, 0.25, 1, 3, 12.5]) {
    const result = certifySinCos(angle, new ExactProofBudget());
    expect(result).not.toBeNull();
    expect(contains(result!.sine, Math.sin(angle))).toBe(true);
    expect(contains(result!.cosine, Math.cos(angle))).toBe(true);
    expect(result!.sine.upper - result!.sine.lower).toBeLessThan(1e-12);
    expect(result!.cosine.upper - result!.cosine.lower).toBeLessThan(1e-12);
  }
});

// Independent BigInt-rational oracle: no module constant is used.
type Rational = readonly [numerator: bigint, denominator: bigint];
type RationalInterval = readonly [Rational, Rational];
const SCALE = 10n ** 60n;
// pi and sqrt(2)/2 truncated to 60 decimals (lower bounds; +1e-60 is an upper bound).
const PI_60 = 3_141592653589793238462643383279502884197169399375105820974944n;
const HALF_SQRT2_60 =
  707106781186547524400844362104849039284835937688474036588339n;

function exactRational(value: number): Rational {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const sign = bits >> 63n ? -1n : 1n;
  const exponent = Number((bits >> 52n) & 0x7ffn);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const shift = (exponent || 1) - 1075;
  return shift >= 0
    ? [sign * mantissa * (1n << BigInt(shift)), 1n]
    : [sign * mantissa, 1n << BigInt(-shift)];
}
const compare = (a: Rational, b: Rational) => {
  const difference = a[0] * b[1] - b[0] * a[1];
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
};
const add = (a: Rational, b: Rational): Rational => [
  a[0] * b[1] + b[0] * a[1],
  a[1] * b[1],
];
const multiply = (a: Rational, b: Rational): Rational => [
  a[0] * b[0],
  a[1] * b[1],
];
const negate = (a: Rational): Rational => [-a[0], a[1]];
const point = (a: Rational): RationalInterval => [a, a];
const scaled = (numerator: bigint): RationalInterval => [
  [numerator, SCALE],
  [numerator + 1n, SCALE],
];
const hull = (values: readonly Rational[]): RationalInterval => {
  const sorted = [...values].sort(compare);
  return [sorted[0]!, sorted[sorted.length - 1]!];
};
const addInterval = (
  a: RationalInterval,
  b: RationalInterval,
): RationalInterval => [add(a[0], b[0]), add(a[1], b[1])];
const multiplyInterval = (a: RationalInterval, b: RationalInterval) =>
  hull(a.flatMap((x) => b.map((y) => multiply(x, y))));
const negateInterval = (a: RationalInterval): RationalInterval => [
  negate(a[1]),
  negate(a[0]),
];

/** Rigorous rational bounds for sin and cos of the binary64 value fl(kπ/4). */
function quarterTurnOracle(k: number, angle: number) {
  const quarterPi = multiplyInterval(scaled(PI_60), point([1n, 4n]));
  // d = angle − kπ/4 is tiny; sin(angle) = s0 cos d + c0 sin d.
  const offset = addInterval(
    point(exactRational(angle)),
    negateInterval(multiplyInterval(point([BigInt(k), 1n]), quarterPi)),
  );
  const magnitude = hull([...offset, ...offset.map(negate)])[1];
  const cube = multiply(multiply(magnitude, magnitude), magnitude);
  const sinOffset: RationalInterval = [
    add(offset[0], negate(multiply(cube, [1n, 6n]))),
    add(offset[1], multiply(cube, [1n, 6n])),
  ];
  const cosOffset: RationalInterval = [
    add([1n, 1n], negate(multiply(multiply(magnitude, magnitude), [1n, 2n]))),
    [1n, 1n],
  ];
  const half = scaled(HALF_SQRT2_60);
  const zero = point([0n, 1n]);
  const one = point([1n, 1n]);
  const unit = [one, half, zero, negateInterval(half)];
  const octant = ((k % 8) + 8) % 8;
  const sign = (index: number) =>
    index >= 4 ? negateInterval(unit[index - 4]!) : unit[index]!;
  const s0 = sign((octant + 6) % 8);
  const c0 = sign(octant);
  return {
    sine: addInterval(
      multiplyInterval(s0, cosOffset),
      multiplyInterval(c0, sinOffset),
    ),
    cosine: addInterval(
      multiplyInterval(c0, cosOffset),
      negateInterval(multiplyInterval(s0, sinOffset)),
    ),
  };
}

test("the rational oracle constants bound sqrt(2)/2 and give sub-1e-30 widths", () => {
  const square = HALF_SQRT2_60 * HALF_SQRT2_60;
  expect(2n * square <= SCALE * SCALE).toBe(true);
  expect(2n * (HALF_SQRT2_60 + 1n) ** 2n > SCALE * SCALE).toBe(true);
  for (const k of [-16, -3, 0, 5, 16]) {
    const oracle = quarterTurnOracle(k, (k * Math.PI) / 4);
    for (const bound of [oracle.sine, oracle.cosine]) {
      const width = add(bound[1], negate(bound[0]));
      expect(compare(width, [1n, 10n ** 30n])).toBe(-1);
    }
  }
});

test("certified trig encloses every fl(kπ/4), including the odd multiples of π/4", () => {
  const encloses = (
    certified: { lower: number; upper: number },
    oracle: RationalInterval,
  ) =>
    compare(exactRational(certified.lower), oracle[0]) <= 0 &&
    compare(oracle[1], exactRational(certified.upper)) <= 0;
  for (let k = -16; k <= 16; k += 1) {
    const angle = (k * Math.PI) / 4;
    const result = certifySinCos(angle, new ExactProofBudget());
    expect(result, `k = ${k}`).not.toBeNull();
    const oracle = quarterTurnOracle(k, angle);
    expect(encloses(result!.sine, oracle.sine), `sine k = ${k}`).toBe(true);
    expect(encloses(result!.cosine, oracle.cosine), `cosine k = ${k}`).toBe(
      true,
    );
    expect(result!.sine.upper - result!.sine.lower).toBeLessThan(2e-14);
    expect(result!.cosine.upper - result!.cosine.lower).toBeLessThan(2e-14);
  }
});

test("certified trig fails closed when bounded range reduction is exhausted", () => {
  expect(certifySinCos(Number.MAX_VALUE, new ExactProofBudget())).toBeNull();
  expect(certifySinCos(Number.NaN, new ExactProofBudget())).toBeNull();
});

test("certified trig precharges every fixed operation before its early return", () => {
  const tinyWidth = new ExactProofBudget({ integerBits: 63 });
  expect(() => certifySinCos(0.25, tinyWidth)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(tinyWidth.snapshot().maxStoredBits).toBe(64);

  const oneShort = new ExactProofBudget({ operations: 879 });
  expect(() => certifySinCos(0, oneShort)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(oneShort.snapshot().operations).toBe(880);

  const exactBoundary = new ExactProofBudget({ operations: 880 });
  expect(certifySinCos(0, exactBoundary)).toEqual({
    sine: { lower: 0, upper: 0 },
    cosine: { lower: 1, upper: 1 },
    quadrant: 0,
  });
  expect(exactBoundary.snapshot().operations).toBe(880);
});

test("certified trig meters nested binary64 stepping separately from fixed work", () => {
  const exactBoundary = new ExactProofBudget({ operations: 1_759 });
  expect(certifySinCos(0.25, exactBoundary)).not.toBeNull();
  expect(exactBoundary.snapshot().operations).toBe(1_759);

  const oneShort = new ExactProofBudget({ operations: 1_758 });
  expect(() => certifySinCos(0.25, oneShort)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(oneShort.snapshot().operations).toBe(1_759);
});
