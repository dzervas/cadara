import { describe, expect, test } from "vitest";
import type {
  NeutralCurve,
  NeutralCurveQueryRequest,
} from "@/contracts/modeling/neutral-curve-query";
import {
  certifyCubicPairExact as certifyCubicPairExactWithMeter,
  certifyCubicPairExactWithLowerBudgetForTest,
  clearedCubicProjectionEquationHolds,
} from "@/domain/modeling/neutral-curve-certification/cubic-pair-exact";
import {
  ExactProofBudget,
  exactFromNumber,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

const provenance = { sourceEntityId: "fixture", sourceSpanId: "span" };

const certifyCubicPairExact = (request: NeutralCurveQueryRequest) =>
  certifyCubicPairExactWithMeter(request, new ExactProofBudget());

function cubic(
  curveId: string,
  poles: readonly (readonly [number, number])[],
  sourceDomain: readonly [number, number] = [0, 1],
): Extract<NeutralCurve, { kind: "cubicBezier" }> {
  return {
    curveId,
    kind: "cubicBezier",
    poles: poles as Extract<NeutralCurve, { kind: "cubicBezier" }>["poles"],
    sourceDomain,
    provenance,
  };
}

const linear = (y: readonly [number, number, number, number]) =>
  cubic("linear", [
    [0, y[0]],
    [1, y[1]],
    [2, y[2]],
    [3, y[3]],
  ]);

function request(
  first: NeutralCurve,
  second: NeutralCurve,
): NeutralCurveQueryRequest {
  return { modelingTolerance: 1e-7, first, second };
}

function verified(result: ReturnType<typeof certifyCubicPairExact>) {
  expect(result?.kind).toBe("verified");
  if (!result || result.kind !== "verified")
    throw new Error("Expected verified result");
  return result;
}

describe("exact cubic-pair certification", () => {
  test.each([
    {
      name: "transverse",
      second: linear([-3, -1, 1, 3]),
      classification: "crossing",
      determinant: true,
    },
    {
      name: "even tangent",
      second: linear([3, -1, -1, 3]),
      classification: "tangent",
      determinant: false,
    },
    {
      name: "regular order three",
      second: linear([-1, 1, -1, 1]),
      classification: "crossing",
      determinant: false,
    },
  ])(
    "certifies $name with multiplicity parity and regularity",
    ({ second, classification, determinant }) => {
      const result = verified(
        certifyCubicPairExact(request(linear([0, 0, 0, 0]), second)),
      );
      expect(result.points).toHaveLength(1);
      expect(result.points[0]!.classification).toBe(classification);
      const proof = result.points[0]!.proof;
      expect(proof.kind).toBe("exactCubicPairRootSet");
      if (proof.kind === "exactCubicPairRootSet") {
        expect("sourceUnitTangentDeterminantBounds" in proof).toBe(determinant);
      }
    },
  );

  test("filters lifted parameters below and above the box while owning zero and one in both projection orientations", () => {
    const axis = linear([0, 0, 0, 0]);
    const lifted = (name: string, offset: number) =>
      cubic(name, [
        [offset, -3],
        [offset + 1, -1],
        [offset + 2, 1],
        [offset + 3, 3],
      ]);
    for (const [name, offset, expected] of [
      ["below", -3, 0],
      ["above", 3, 0],
      ["zero", -1.5, 1],
      ["one", 1.5, 1],
    ] as const) {
      const candidate = lifted(name, offset);
      for (const [first, second] of [
        [axis, candidate],
        [candidate, axis],
      ] as const) {
        const result = verified(certifyCubicPairExact(request(first, second)));
        expect(
          result.points,
          `${name} in ${first === axis ? "forward" : "reverse"} order`,
        ).toHaveLength(expected);
      }
    }
  });

  test("owns a closed endpoint once and leaves its classification unclassified", () => {
    const result = verified(
      certifyCubicPairExact(
        request(linear([0, 0, 0, 0]), linear([0, 1, 2, 3])),
      ),
    );
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({
      classification: "unclassified",
      firstParameter: 0,
      secondParameter: 0,
    });
  });

  test("atomically switches projection and preserves all three integer-pole parameter pairs", () => {
    const first = cubic("A", [
      [-1, -16],
      [0, 0],
      [1, 16],
      [2, 32],
    ]);
    const second = cubic("B", [
      [0, 0],
      [-1, -13],
      [-1, -26],
      [0, 9],
    ]);
    const result = verified(certifyCubicPairExact(request(first, second)));
    const pairs = result.points.map(({ firstParameter, secondParameter }) => [
      firstParameter,
      secondParameter,
    ]);
    expect(pairs).toHaveLength(3);
    expect(pairs[0]![0]).toBeCloseTo(1 / 3, 15);
    expect(pairs[0]![1]).toBe(0);
    expect(pairs[1]![0]).toBeCloseTo(7 / 48, 15);
    expect(pairs[1]![1]).toBe(1 / 4);
    expect(pairs[2]![0]).toBeCloseTo(7 / 48, 15);
    expect(pairs[2]![1]).toBe(3 / 4);
  });

  test("certifies all nine isolated pairs of the cubic Chebyshev two-cycle fixture", () => {
    // P(x)=(T3(2x-1)+1)/2. Intersections of (s,P(s)) and
    // (P(t),t) are the nine real fixed points of P∘P on [0,1].
    const first = cubic("chebyshev-forward", [
      [0, 0],
      [1, 9],
      [2, -6],
      [3, 3],
    ]);
    const second = cubic("chebyshev-reverse", [
      [0, 0],
      [9, 1],
      [-6, 2],
      [3, 3],
    ]);
    const result = verified(certifyCubicPairExact(request(first, second)));
    expect(result.points).toHaveLength(9);
    expect(result.completenessProof).toMatchObject({
      kind: "completeIsolatedRootSet",
      family: "cubicCubic",
      distinctRootCount: 9,
    });
  });

  test("certifies the generic sheared nine-pair fixture through 6x6 and 4x4 templates", () => {
    const shear = ([x, y]: readonly [number, number]) =>
      [x + y, x - y] as const;
    const first = cubic(
      "chebyshev-forward-sheared",
      [
        [0, 0],
        [1, 9],
        [2, -6],
        [3, 3],
      ].map(shear),
    );
    const second = cubic(
      "chebyshev-reverse-sheared",
      [
        [0, 0],
        [9, 1],
        [-6, 2],
        [3, 3],
      ].map(shear),
    );
    const { result, budget } = certifyCubicPairExactWithLowerBudgetForTest(
      request(first, second) as NeutralCurveQueryRequest & {
        first: typeof first;
        second: typeof second;
      },
      {},
    );
    expect(verified(result).points).toHaveLength(9);
    expect(budget.determinantTerms).toBe(768);
  });

  test("preserves a symmetric three-pair root set in both argument orders", () => {
    const horizontal = cubic("horizontal", [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    const threeRoots = cubic("three-roots", [
      [0, -4],
      [1, 7],
      [2, -7],
      [3, 4],
    ]);
    for (const [first, second] of [
      [horizontal, threeRoots],
      [threeRoots, horizontal],
    ] as const) {
      const result = verified(certifyCubicPairExact(request(first, second)));
      expect(result.points).toHaveLength(3);
      const parameters = result.points.map((point) =>
        first === horizontal ? point.secondParameter : point.firstParameter,
      );
      expect(parameters[0]).toBeCloseTo(1 / 5, 15);
      expect(parameters[1]).toBe(1 / 2);
      expect(parameters[2]).toBeCloseTo(4 / 5, 15);
    }
  });

  test("trims an integer-pole quadratic and retains ordered non-dyadic and midpoint roots in both orders", () => {
    const axis = linear([0, 0, 0, 0]);
    const quadratic = linear([9, -10, -9, 12]);
    for (const [first, second] of [
      [axis, quadratic],
      [quadratic, axis],
    ] as const) {
      const result = verified(certifyCubicPairExact(request(first, second)));
      expect(result.points).toHaveLength(2);
      const roots = result.points.map((point) =>
        first === axis ? point.secondParameter : point.firstParameter,
      );
      expect(roots[0]).toBeCloseTo(1 / 5, 15);
      expect(roots[1]).toBe(3 / 4);
    }
  });

  test("switches away from a degree-zero projection and refuses complex-fiber multiplicity transfer", () => {
    const first = cubic("degree-zero-first", [
      [-3, -3],
      [15, -1],
      [-15, 1],
      [3, 3],
    ]);
    const second = cubic("alternate-projection", [
      [-6, 0],
      [2, 0],
      [-2, 0],
      [6, 0],
    ]);
    const { result, budget } = certifyCubicPairExactWithLowerBudgetForTest(
      request(first, second) as NeutralCurveQueryRequest & {
        first: typeof first;
        second: typeof second;
      },
      {},
    );
    const complete = verified(result);
    expect(complete.points).toHaveLength(1);
    expect(complete.points[0]).toMatchObject({
      classification: "crossing",
      firstParameter: 0.5,
      secondParameter: 0.5,
    });
    expect(budget.projectionAttempts).toBe(2);
  });

  test("keeps two exact dyadic crossings distinct below modeling tolerance", () => {
    const d = 2 ** -30;
    const axis = linear([0, 0, 0, 0]);
    const close = linear([
      3 / 4 + (3 * d) / 2,
      -1 / 4 + d / 2,
      -1 / 4 - d / 2,
      3 / 4 - (3 * d) / 2,
    ]);
    const result = verified(certifyCubicPairExact(request(axis, close)));
    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.secondParameter).toBe(0.5);
    expect(result.points[1]!.secondParameter).toBe(0.5 + d);
    expect(
      result.points[1]!.secondParameter - result.points[0]!.secondParameter,
    ).toBeLessThan(1e-6);
  });

  test("rejects corrupted cleared F and G evidence independently at the projection guard", () => {
    const budget = new ExactProofBudget();
    const zero = exactFromNumber(0, budget);
    const one = exactFromNumber(1, budget);
    const half = exactFromNumber(0.5, budget);
    const resultant = [exactFromNumber(-0.5, budget), one] as const;
    const root = [half, half] as const;
    expect(
      clearedCubicProjectionEquationHolds(
        resultant,
        root,
        [zero],
        true,
        budget,
      ),
    ).toBe(true);
    const corruptedF = [one] as const;
    const corruptedG = [one, one] as const;
    expect(
      clearedCubicProjectionEquationHolds(
        resultant,
        root,
        corruptedF,
        false,
        budget,
      ),
    ).toBe(false);
    expect(
      clearedCubicProjectionEquationHolds(
        resultant,
        root,
        corruptedG,
        false,
        budget,
      ),
    ).toBe(false);
  });

  test("certifies a nonzero-resultant empty active box", () => {
    const result = verified(
      certifyCubicPairExact(
        request(linear([0, 0, 0, 0]), linear([3, 4, 5, 6])),
      ),
    );
    expect(result.points).toEqual([]);
  });

  test("fails closed for a zero resultant nonstructural line component", () => {
    const first = cubic("line", [
      [0, 0],
      [1 / 3, 16 / 3],
      [2 / 3, 32 / 3],
      [1, 16],
    ]);
    const second = cubic("quadratic-line", [
      [0, 0],
      [0, 0],
      [1 / 3, 16 / 3],
      [1, 16],
    ]);
    expect(certifyCubicPairExact(request(first, second))).toMatchObject({
      kind: "uncertain",
      code: "non-structural-cubic-overlap",
    });
  });

  test("returns whole-query uncertainty when both projections are unsupported", () => {
    const horizontal = cubic("horizontal", [
      [0, 0],
      [1 / 3, 0],
      [2 / 3, 0],
      [1, 0],
    ]);
    const verticalShift = cubic("horizontal-2", [
      [0, 2],
      [1 / 3, 2],
      [2 / 3, 2],
      [1, 2],
    ]);
    expect(
      certifyCubicPairExact(request(horizontal, verticalShift)),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-pair-exact-projection-unresolved",
    });
  });

  test("keeps a stationary contact complete but unclassified", () => {
    const stationary = cubic("stationary", [
      [3, -1],
      [-1, 1],
      [-1, -1],
      [3, 1],
    ]);
    const regular = cubic("regular", [
      [-3, -3],
      [-1, -1],
      [1, 1],
      [3, 3],
    ]);
    const result = verified(
      certifyCubicPairExact(request(stationary, regular)),
    );
    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.classification).toBe("unclassified");
  });

  test("a refused first projection does not reset the shared meter before the successful second attempt", () => {
    const first = cubic("degree-zero-first", [
      [-3, -3],
      [15, -1],
      [-15, 1],
      [3, 3],
    ]);
    const second = cubic("alternate-projection", [
      [-6, 0],
      [2, 0],
      [-2, 0],
      [6, 0],
    ]);
    const { result, budget } = certifyCubicPairExactWithLowerBudgetForTest(
      request(first, second) as NeutralCurveQueryRequest & {
        first: typeof first;
        second: typeof second;
      },
      {},
    );
    expect(result).toMatchObject({ kind: "verified" });
    expect(budget.projectionAttempts).toBe(2);
    expect(budget.operations).toBeGreaterThan(0);
  });

  test("pre-product width exhaustion returns whole-query uncertainty without partial points", () => {
    const huge = 2 ** 500;
    const first = cubic("wide-first", [
      [huge, 0],
      [0, 1],
      [-huge, 2],
      [1, 3],
    ]);
    const second = cubic("wide-second", [
      [0, huge],
      [1, 0],
      [2, -huge],
      [3, 1],
    ]);
    const { result, budget } = certifyCubicPairExactWithLowerBudgetForTest(
      request(first, second) as NeutralCurveQueryRequest & {
        first: typeof first;
        second: typeof second;
      },
      { integerBits: 256 },
    );
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
    });
    expect("points" in result).toBe(false);
    expect(budget.maxPreProductBits).toBeGreaterThan(256);
  });

  test("lowered shared primitive and second-attempt budgets fail with no partial points", () => {
    const first = cubic("A", [
      [-1, -16],
      [0, 0],
      [1, 16],
      [2, 32],
    ]);
    const second = cubic("B", [
      [0, 0],
      [-1, -13],
      [-1, -26],
      [0, 9],
    ]);
    for (const limits of [
      { operations: 1 },
      { determinantTerms: 0 },
      { euclideanSteps: 0 },
      { projectionAttempts: 1 },
      { refinementSteps: 0 },
    ]) {
      const { result } = certifyCubicPairExactWithLowerBudgetForTest(
        request(first, second) as NeutralCurveQueryRequest & {
          first: typeof first;
          second: typeof second;
        },
        limits,
      );
      expect(result).toMatchObject({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
      });
      expect("points" in result).toBe(false);
    }
  });

  test("meters structural and self work through the same public-entry budget", () => {
    const curve = cubic("structural", [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
    const { result, budget } = certifyCubicPairExactWithLowerBudgetForTest(
      request(curve, {
        ...curve,
        curveId: "structural-copy",
      }) as NeutralCurveQueryRequest & {
        first: typeof curve;
        second: typeof curve;
      },
      { operations: 1 },
    );
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
    });
    expect("points" in result).toBe(false);
    expect(budget.projectionAttempts).toBe(0);
  });

  test("omits an unrepresentable source-unit determinant without changing exact classification", () => {
    const huge = [0, Number.MAX_VALUE] as const;
    const first = { ...linear([0, 0, 0, 0]), sourceDomain: huge };
    const second = { ...linear([-3, -1, 1, 3]), sourceDomain: huge };
    const point = verified(certifyCubicPairExact(request(first, second)))
      .points[0]!;
    expect(point.classification).toBe("crossing");
    if (point.proof.kind !== "exactCubicPairRootSet")
      throw new Error("Expected cubic-pair proof");
    expect(point.proof.sourceUnitTangentDeterminantBounds).toBeUndefined();
  });

  test("source-unit determinant bounds contain signed non-singleton quotients in both orders", () => {
    const first = cubic(
      "negative-determinant-a",
      [
        [2, -3],
        [3, 1],
        [-1, 2],
        [-3, -1],
      ],
      [2, 6],
    );
    const second = cubic(
      "negative-determinant-b",
      [
        [2, -2],
        [4, 4],
        [4, 4],
        [2, 3],
      ],
      [-3, 2],
    );
    const sourceDerivative = (
      curve: Extract<NeutralCurve, { kind: "cubicBezier" }>,
      parameter: number,
    ) => {
      const scale = curve.sourceDomain[1] - curve.sourceDomain[0];
      const u = (parameter - curve.sourceDomain[0]) / scale;
      const differences = [0, 1, 2].map((index) => [
        curve.poles[index + 1]![0] - curve.poles[index]![0],
        curve.poles[index + 1]![1] - curve.poles[index]![1],
      ]);
      return [0, 1].map(
        (axis) =>
          (3 *
            ((1 - u) ** 2 * differences[0]![axis]! +
              2 * (1 - u) * u * differences[1]![axis]! +
              u ** 2 * differences[2]![axis]!)) /
          scale,
      ) as [number, number];
    };
    for (const [left, right] of [
      [first, second],
      [second, first],
    ] as const) {
      const point = verified(certifyCubicPairExact(request(left, right)))
        .points[0]!;
      if (point.proof.kind !== "exactCubicPairRootSet")
        throw new Error("Expected cubic-pair proof");
      const bounds = point.proof.sourceUnitTangentDeterminantBounds;
      expect(bounds).toBeDefined();
      const firstDerivative = sourceDerivative(left, point.firstParameter);
      const secondDerivative = sourceDerivative(right, point.secondParameter);
      const determinant =
        firstDerivative[0] * secondDerivative[1] -
        firstDerivative[1] * secondDerivative[0];
      expect(bounds![0]).toBeLessThanOrEqual(determinant);
      expect(bounds![1]).toBeGreaterThanOrEqual(determinant);
      expect(bounds![0] <= bounds![1]).toBe(true);
    }
  });

  test("source-unit determinant sign reverses under argument reversal and nonunit domains", () => {
    const first = { ...linear([0, 0, 0, 0]), sourceDomain: [2, 6] as const };
    const second = {
      ...linear([-3, -1, 1, 3]),
      sourceDomain: [10, 12] as const,
    };
    const forward = verified(certifyCubicPairExact(request(first, second)))
      .points[0]!;
    const reverse = verified(certifyCubicPairExact(request(second, first)))
      .points[0]!;
    expect(forward.firstParameter).toBe(4);
    expect(forward.secondParameter).toBe(11);
    expect(reverse.firstParameter).toBe(11);
    expect(reverse.secondParameter).toBe(4);
    const forwardProof = forward.proof;
    const reverseProof = reverse.proof;
    if (
      forwardProof.kind !== "exactCubicPairRootSet" ||
      reverseProof.kind !== "exactCubicPairRootSet"
    )
      throw new Error("Expected algebraic proof");
    expect(forwardProof.sourceUnitTangentDeterminantBounds![0]).toBeGreaterThan(
      0,
    );
    expect(reverseProof.sourceUnitTangentDeterminantBounds![1]).toBeLessThan(0);
  });
});
