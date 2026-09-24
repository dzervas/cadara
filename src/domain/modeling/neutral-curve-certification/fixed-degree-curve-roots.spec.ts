import { expect, test } from "vitest";
import { isolateFixedCurveRoots } from "@/domain/modeling/neutral-curve-certification/fixed-degree-curve-roots";
import {
  ExactProofBudget,
  exact,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

test("fixed-degree isolation retains multiplicity and nearby distinct identities", () => {
  const budget = new ExactProofBudget();
  // (x-1/2)^2 (x-(1/2+2^-20))
  const polynomial = [
    exact(-524289n, 4_194_304n, budget),
    exact(786433n, 1_048_576n, budget),
    exact(-1572865n, 1_048_576n, budget),
    exact(1n, 1n, budget),
  ] as const;
  const roots = isolateFixedCurveRoots(
    polynomial,
    [exact(0n, 1n, budget), exact(1n, 1n, budget)],
    3,
    budget,
  );
  expect(roots).not.toBeNull();
  expect(roots).toHaveLength(2);
  expect(roots?.map((root) => root.multiplicity)).toEqual([2, 1]);
  expect(roots?.[0]?.normalizedBounds[1]).not.toEqual(
    roots?.[1]?.normalizedBounds[0],
  );
});

test("fixed-degree isolation accounts through the supplied lower-only meter", () => {
  const budget = new ExactProofBudget({ operations: 1 });
  expect(() =>
    isolateFixedCurveRoots(
      [exact(0n, 1n, budget), exact(1n, 1n, budget)],
      [exact(0n, 1n, budget), exact(1n, 1n, budget)],
      2,
      budget,
    ),
  ).toThrow("deterministic exact-query arithmetic budget");
});
