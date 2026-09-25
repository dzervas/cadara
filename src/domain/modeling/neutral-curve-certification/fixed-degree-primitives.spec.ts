import { describe, expect, test } from "vitest";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  addExact,
  compareExact,
  compareFiniteAngleToQuarterTurnMultipleExact,
  countDistinctRoots,
  divideExact,
  exact as exactWithMeter,
  exactFromNumber,
  exactToNumber,
  isolateDistinctRootsClosed,
  multiplyExact,
  polynomialRemainder,
  refineIsolatedRoot,
  signAtIsolatedRoot,
  type ExactFraction,
  type ExactInterval,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

const fixtureBudget = new ExactProofBudget();
const exact = (numerator: bigint, denominator = 1n, budget = fixtureBudget) =>
  exactWithMeter(numerator, denominator, budget);

test("closed Sturm isolation owns endpoints and repeated roots once", () => {
  // x(x-1)(2x-1)^2
  const polynomial = [exact(0n), exact(-1n), exact(5n), exact(-8n), exact(4n)];
  const roots = isolateDistinctRootsClosed(
    polynomial,
    [exact(0n), exact(1n)],
    new ExactProofBudget(),
  );
  expect(roots).not.toBeNull();
  expect(roots).toHaveLength(3);
  expect(roots![0]).toEqual([exact(0n), exact(0n)]);
  expect(
    signAtIsolatedRoot(
      polynomial,
      roots![1]!,
      [exact(-1n), exact(2n)],
      new ExactProofBudget(),
    ).sign,
  ).toBe(0);
  expect(roots![2]).toEqual([exact(1n), exact(1n)]);
});

test.each([
  [
    [exact(3n, 20n), exact(-19n, 20n), exact(1n)],
    [exact(1n, 5n), exact(3n, 4n)],
  ],
  [
    [exact(0n), exact(3n, 20n), exact(-23n, 20n), exact(1n)],
    [exact(0n), exact(3n, 20n), exact(1n)],
  ],
  [
    [
      exact(9n, 400n),
      exact(-57n, 200n),
      exact(481n, 400n),
      exact(-19n, 10n),
      exact(1n),
    ],
    [exact(1n, 5n), exact(3n, 4n)],
  ],
])(
  "closed Sturm isolation does not re-enumerate earlier branches %#",
  (polynomial, expectedSingletons) => {
    const roots = isolateDistinctRootsClosed(
      polynomial,
      [exact(0n), exact(1n)],
      new ExactProofBudget(),
    );
    expect(roots).not.toBeNull();
    expect(roots).toHaveLength(expectedSingletons.length);
    for (const [index, root] of expectedSingletons.entries()) {
      expect(
        compareExact(roots![index]![0], root, fixtureBudget),
      ).toBeLessThanOrEqual(0);
      expect(
        compareExact(roots![index]![1], root, fixtureBudget),
      ).toBeGreaterThanOrEqual(0);
    }
  },
);

test("closed isolation excludes separately owned roots below binary64 spacing", () => {
  const budget = new ExactProofBudget();
  const first = exact(1n, 2n, budget);
  const second = addExact(first, exact(1n, 3n * 2n ** 200n, budget), budget);
  const polynomial = [
    multiplyExact(first, second, budget),
    addExact(
      { numerator: -first.numerator, denominator: first.denominator },
      { numerator: -second.numerator, denominator: second.denominator },
      budget,
    ),
    exact(1n, 1n, budget),
  ];
  const roots = isolateDistinctRootsClosed(
    polynomial,
    [exact(0n, 1n, budget), exact(1n, 1n, budget)],
    budget,
  );
  expect(roots).toHaveLength(2);
  for (const root of roots!) {
    expect(countDistinctRoots(polynomial, root, budget)).toBe(1);
  }
  expect(compareExact(roots![0]![1], roots![1]![0], budget)).toBeLessThan(0);
});

test("close irrational roots have strictly separated closed boxes", () => {
  const budget = new ExactProofBudget();
  const half = exact(1n, 2n, budget);
  const epsilon = exact(1n, 3n * 2n ** 220n, budget);
  const polynomial = [
    addExact(
      exact(1n, 4n, budget),
      {
        numerator: -epsilon.numerator,
        denominator: epsilon.denominator,
      },
      budget,
    ),
    exact(-1n, 1n, budget),
    exact(1n, 1n, budget),
  ];
  const roots = isolateDistinctRootsClosed(
    polynomial,
    [exact(0n, 1n, budget), exact(1n, 1n, budget)],
    budget,
  );
  expect(roots).toHaveLength(2);
  for (const root of roots!) {
    expect(countDistinctRoots(polynomial, root, budget)).toBe(1);
  }
  expect(compareExact(roots![0]![1], roots![1]![0], budget)).toBeLessThan(0);
  expect(
    compareExact(roots![0]![1], half, budget) < 0 ||
      compareExact(half, roots![1]![0], budget) < 0,
  ).toBe(true);
});

const point = (value: ExactFraction): ExactInterval => [value, value];
const unitInterval = (): ExactInterval => [exact(0n), exact(1n)];
/** The closed box contains the independently known root and is not a point. */
const expectOpenBoxAround = (box: ExactInterval, root: ExactFraction) => {
  expect(compareExact(box[0], root, fixtureBudget)).toBeLessThan(0);
  expect(compareExact(root, box[1], fixtureBudget)).toBeLessThan(0);
};

test("Sturm counting survives a degree-dropping remainder sequence (x⁵ − x)", () => {
  // rem(x⁵ − x, 5x⁴ − 1) = −(4/5)x drops from degree 4 to degree 1.
  const polynomial = [
    exact(0n),
    exact(-1n),
    exact(0n),
    exact(0n),
    exact(0n),
    exact(1n),
  ];
  expect(
    countDistinctRoots(
      polynomial,
      [exact(-2n), exact(2n)],
      new ExactProofBudget(),
    ),
  ).toBe(3);
  expect(
    isolateDistinctRootsClosed(
      polynomial,
      unitInterval(),
      new ExactProofBudget(),
    ),
  ).toEqual([point(exact(0n)), point(exact(1n))]);
  expect(
    isolateDistinctRootsClosed(
      polynomial,
      [exact(-2n), exact(2n)],
      new ExactProofBudget(),
    ),
  ).toEqual([point(exact(-1n)), point(exact(0n)), point(exact(1n))]);
});

test("a negative leading rational cubic keeps its roots, including one at the first bisection midpoint", () => {
  // −(3/7)(x − 1/5)(x − 1/2)(x − 4/5)
  const polynomial = [
    exact(6n, 175n),
    exact(-99n, 350n),
    exact(9n, 14n),
    exact(-3n, 7n),
  ];
  expect(
    countDistinctRoots(polynomial, unitInterval(), new ExactProofBudget()),
  ).toBe(3);
  const roots = isolateDistinctRootsClosed(
    polynomial,
    unitInterval(),
    new ExactProofBudget(),
  )!;
  expect(roots).toHaveLength(3);
  expectOpenBoxAround(roots[0]!, exact(1n, 5n));
  expect(roots[1]).toEqual(point(exact(1n, 2n)));
  expectOpenBoxAround(roots[2]!, exact(4n, 5n));
  expect(compareExact(roots[0]![1], roots[1]![0], fixtureBudget)).toBe(-1);
  expect(compareExact(roots[1]![1], roots[2]![0], fixtureBudget)).toBe(-1);
});

test("repeated, non-dyadic endpoint, negative-domain, constant and zero polynomials count exactly", () => {
  // −7(x − 1/3)²(x − 2/3) has two distinct roots.
  const repeated = [
    exact(14n, 27n),
    exact(-35n, 9n),
    exact(28n, 3n),
    exact(-7n),
  ];
  expect(
    countDistinctRoots(repeated, unitInterval(), new ExactProofBudget()),
  ).toBe(2);
  const repeatedRoots = isolateDistinctRootsClosed(
    repeated,
    unitInterval(),
    new ExactProofBudget(),
  )!;
  expect(repeatedRoots).toHaveLength(2);
  expectOpenBoxAround(repeatedRoots[0]!, exact(1n, 3n));
  expectOpenBoxAround(repeatedRoots[1]!, exact(2n, 3n));

  // (x − 1/3)(x − 1/2)(x − 5/6) on the closed non-dyadic [1/3, 2/3].
  const nonDyadic = [
    exact(-5n, 36n),
    exact(31n, 36n),
    exact(-5n, 3n),
    exact(1n),
  ];
  const thirds: ExactInterval = [exact(1n, 3n), exact(2n, 3n)];
  expect(countDistinctRoots(nonDyadic, thirds, new ExactProofBudget())).toBe(2);
  expect(
    isolateDistinctRootsClosed(nonDyadic, thirds, new ExactProofBudget()),
  ).toEqual([point(exact(1n, 3n)), point(exact(1n, 2n))]);

  const unitSquare = [exact(-1n), exact(0n), exact(1n)];
  expect(
    countDistinctRoots(
      unitSquare,
      [exact(-1n), exact(0n)],
      new ExactProofBudget(),
    ),
  ).toBe(1);
  expect(
    countDistinctRoots(
      unitSquare,
      [exact(-1n, 3n), exact(0n)],
      new ExactProofBudget(),
    ),
  ).toBe(0);
  expect(
    countDistinctRoots([exact(5n)], unitInterval(), new ExactProofBudget()),
  ).toBe(0);
  expect(
    countDistinctRoots([exact(0n)], unitInterval(), new ExactProofBudget()),
  ).toBeNull();
});

test("a subnormal root and endpoint are counted, and wide powers fail closed on the bit cap", () => {
  const tiny = exactFromNumber(Number.MIN_VALUE, fixtureBudget);
  const negativeTiny = exact(-tiny.numerator, tiny.denominator);
  expect(
    countDistinctRoots(
      [negativeTiny, exact(1n)],
      [exact(0n), tiny],
      new ExactProofBudget(),
    ),
  ).toBe(1);
  expect(
    isolateDistinctRootsClosed(
      [negativeTiny, exact(1n)],
      [exact(0n), tiny],
      new ExactProofBudget(),
    ),
  ).toEqual([point(tiny)]);
  // (x − m)(x² + 1): evaluating at q = 2¹⁰⁷⁴ needs q³ (3,223 bits).
  const cubic = [negativeTiny, exact(1n), negativeTiny, exact(1n)];
  expect(
    countDistinctRoots(cubic, [exact(0n), tiny], new ExactProofBudget()),
  ).toBe(1);
  const limited = new ExactProofBudget({ integerBits: 2_048 });
  expect(() => countDistinctRoots(cubic, [exact(0n), tiny], limited)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(limited.snapshot().maxPreProductBits).toBeGreaterThan(2_048);
});

test("lowered operation caps exhaust root isolation and an exhausted meter stays exhausted", () => {
  const polynomial = [
    exact(6n, 175n),
    exact(-99n, 350n),
    exact(9n, 14n),
    exact(-3n, 7n),
  ];
  const limited = new ExactProofBudget({ operations: 20_000 });
  expect(() =>
    isolateDistinctRootsClosed(polynomial, unitInterval(), limited),
  ).toThrow(ExactQueryProofBudgetExceeded);
  expect(() =>
    countDistinctRoots([exact(-1n, 2n), exact(1n)], unitInterval(), limited),
  ).toThrow(ExactQueryProofBudgetExceeded);
});

describe("sign at the isolated root 1/√2 of x² − 1/2 in [7/10, 71/100]", () => {
  const root = () => [exact(-1n, 2n), exact(0n), exact(1n)];
  const interval = (): ExactInterval => [exact(7n, 10n), exact(71n, 100n)];
  const refined = (): ExactInterval => [exact(141n, 200n), exact(71n, 100n)];

  test.each([
    ["x − 7/10", [exact(-7n, 10n), exact(1n)], 1, refined],
    ["x − 3/4", [exact(-3n, 4n), exact(1n)], -1, interval],
    [
      "2x² − 1 (zero remainder)",
      [exact(-1n), exact(0n), exact(2n)],
      0,
      interval,
    ],
    [
      "−3(x − 7/10) + (x − 5)(x² − 1/2) (negative remainder)",
      [exact(23n, 5n), exact(-7n, 2n), exact(-5n), exact(1n)],
      -1,
      refined,
    ],
  ] as const)("%s", (_, value, sign, expectedInterval) => {
    expect(
      signAtIsolatedRoot(root(), interval(), value, new ExactProofBudget()),
    ).toEqual({ sign, interval: expectedInterval() });
  });

  test("a common factor with its root inside the interval proves zero", () => {
    // R = (x² − 1/2)², V = x² − 1/2: nonzero remainder, gcd root inside.
    const squared = [
      exact(1n, 4n),
      exact(0n),
      exact(-1n),
      exact(0n),
      exact(1n),
    ];
    expect(
      signAtIsolatedRoot(squared, interval(), root(), new ExactProofBudget()),
    ).toEqual({ sign: 0, interval: interval() });
  });

  test("a common factor with its root outside the interval does not decide the sign", () => {
    // R = (x − 1/10)(x² − 1/2), V = (x − 1/10)(x + 1) > 0 at 1/√2.
    expect(
      signAtIsolatedRoot(
        [exact(1n, 20n), exact(-1n, 2n), exact(-1n, 10n), exact(1n)],
        interval(),
        [exact(-1n, 10n), exact(9n, 10n), exact(1n)],
        new ExactProofBudget(),
      ),
    ).toEqual({ sign: 1, interval: interval() });
  });
});

test("the exported remainder is the exact mathematical remainder", () => {
  expect(
    polynomialRemainder(
      [exact(0n), exact(0n), exact(1n)],
      [exact(1n), exact(2n)],
      new ExactProofBudget(),
    ),
  ).toEqual([exact(1n, 4n)]);
  expect(
    polynomialRemainder(
      [exact(0n), exact(0n), exact(-1n)],
      [exact(1n), exact(2n)],
      new ExactProofBudget(),
    ),
  ).toEqual([exact(-1n, 4n)]);
});

test("fraction-free sign sites reject non-canonical caller coefficients and parameters", () => {
  // The coefficient guard enforces canonical form; 1/2 is a valid root of (1/−2) + x.
  expect(() =>
    refineIsolatedRoot(
      [{ numerator: 1n, denominator: -2n }, exact(1n)],
      unitInterval(),
      new ExactProofBudget(),
    ),
  ).toThrow("Expected a canonical exact fraction");
  // Canonical form is required even when the represented endpoint is a root.
  expect(() =>
    countDistinctRoots(
      [exact(-1n, 2n), exact(1n)],
      [{ numerator: -1n, denominator: -2n }, exact(1n)],
      new ExactProofBudget(),
    ),
  ).toThrow("Expected a canonical exact fraction");
  // Without the parameter guard, a negative denominator loses the root at zero.
  const polynomial = [exact(0n), exact(1n)];
  expect(
    countDistinctRoots(
      polynomial,
      [exact(-1n, 2n), exact(1n)],
      new ExactProofBudget(),
    ),
  ).toBe(1);
  expect(() =>
    countDistinctRoots(
      polynomial,
      [{ numerator: 1n, denominator: -2n }, exact(1n)],
      new ExactProofBudget(),
    ),
  ).toThrow("Expected a canonical exact fraction");
});

test("decimal-pi comparison precharges fixed widths to the caller meter", () => {
  const budget = new ExactProofBudget({ integerBits: 64 });
  expect(() =>
    compareFiniteAngleToQuarterTurnMultipleExact(Math.PI / 2, 1, budget),
  ).toThrow(ExactQueryProofBudgetExceeded);
  expect(budget.snapshot().maxStoredBits).toBeGreaterThan(64);
});

test("pre-product width is checked before bigint multiplication", () => {
  const budget = new ExactProofBudget({ integerBits: 8 });
  expect(() => multiplyExact(exact(127n), exact(127n), budget)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
});

test("sum width is checked before addExact cancellation", () => {
  const budget = new ExactProofBudget({ integerBits: 6 });
  expect(() => addExact(exact(7n, 5n), exact(7n, 6n), budget)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(budget.snapshot().maxStoredBits).toBe(7);
});

test("primitive zero checks consume the lowered operation budget", () => {
  expect(() =>
    divideExact(exact(1n), exact(0n), new ExactProofBudget({ operations: 0 })),
  ).toThrow(ExactQueryProofBudgetExceeded);
  expect(() =>
    exactToNumber(exact(0n), new ExactProofBudget({ operations: 0 })),
  ).toThrow(ExactQueryProofBudgetExceeded);
  expect(() =>
    polynomialRemainder(
      [exact(1n)],
      [exact(0n)],
      new ExactProofBudget({ operations: 4 }),
    ),
  ).toThrow(ExactQueryProofBudgetExceeded);
});

test("division preparation charges both its zero guard and pending operator", () => {
  const budget = new ExactProofBudget({ operations: 1 });
  expect(() => budget.bigintDivision(1n, 1n)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(budget.snapshot().operations).toBe(2);
});

test("binary64 conversion charges bit lengths before shifting", () => {
  const budget = new ExactProofBudget({ operations: 5 });
  expect(() => exactToNumber(exact(1n), budget)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(budget.snapshot()).toMatchObject({
    operations: 7,
    maxPreProductBits: 0,
    maxStoredBits: 0,
  });
});

test("binary64 conversion charges the final bigint-to-number conversion", () => {
  const complete = new ExactProofBudget();
  expect(exactToNumber(exact(1n), complete)).toBe(1);
  expect(complete.snapshot().operations).toBe(19);
  const exhausted = new ExactProofBudget({ operations: 18 });
  expect(() => exactToNumber(exact(1n), exhausted)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(exhausted.snapshot()).toMatchObject({
    operations: 19,
    maxStoredBits: 53,
  });
});

test("runtime exact construction requires the caller-owned request meter", () => {
  const callWithoutMeter = exactWithMeter as unknown as (
    numerator: bigint,
    denominator?: bigint,
  ) => unknown;
  expect(() => callWithoutMeter(7n)).toThrow("caller-owned proof budget");
  expect(() => callWithoutMeter(1n, 2n)).toThrow("caller-owned proof budget");
});

test("runtime exact construction rejects oversized integers before charged work", () => {
  const oversizedInteger = 1n << 20_000n;
  const budget = new ExactProofBudget({ integerBits: 16_384 });
  expect(() => exactWithMeter(oversizedInteger, 1n, budget)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(budget.snapshot()).toMatchObject({
    operations: 0,
    maxStoredBits: 20_001,
  });
});

test("proof meters are reentrant and do not share mutable counters", () => {
  const first = new ExactProofBudget({ operations: 4 });
  const second = new ExactProofBudget({ operations: 4 });
  exact(1n, 1n, first);
  exact(1n, 1n, second);
  expect(first.snapshot()).toMatchObject({ operations: 4 });
  expect(second.snapshot()).toMatchObject({ operations: 4 });
});
