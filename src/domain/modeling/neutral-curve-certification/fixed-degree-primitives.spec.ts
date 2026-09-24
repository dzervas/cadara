import { expect, test } from "vitest";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
  addExact,
  compareExact,
  compareFiniteAngleToQuarterTurnMultipleExact,
  countDistinctRoots,
  divideExact,
  exact as exactWithMeter,
  exactToNumber,
  isolateDistinctRootsClosed,
  multiplyExact,
  polynomialRemainder,
  signAtIsolatedRoot,
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
