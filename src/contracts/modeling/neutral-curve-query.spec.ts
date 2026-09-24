import { expect, test } from "vitest";
import {
  ExactProofBudget,
  compareFiniteAngleToQuarterTurnMultipleExact,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";
import {
  checkNeutralCurvePointConsistency,
  evaluateNeutralCurve,
  validateNeutralCurveQueryRequest,
  type NeutralCurve,
  type NeutralCurveQueryRequest,
} from "@/contracts/modeling/neutral-curve-query";

const circle = (
  curveId: string,
  center: readonly [number, number],
  overrides: Partial<Extract<NeutralCurve, { kind: "circle" }>> = {},
): Extract<NeutralCurve, { kind: "circle" }> => ({
  curveId,
  kind: "circle",
  center,
  radius: 1,
  xAxis: [1, 0],
  sourceDomain: { kind: "fullTurn", seam: 0 },
  provenance: { sourceEntityId: curveId, sourceSpanId: `${curveId}:full` },
  ...overrides,
});

const request = (
  first: NeutralCurve,
  second: NeutralCurve,
): NeutralCurveQueryRequest => ({ modelingTolerance: 1e-6, first, second });

const analyticCircleWitness = (
  position: readonly [number, number],
  firstParameter = 0,
  secondParameter = Math.PI,
) => ({
  classification: "tangent" as const,
  firstParameter,
  secondParameter,
  position,
  proof: {
    kind: "nativeAnalyticCircleIntersection" as const,
    firstParameterBounds: [firstParameter, firstParameter] as const,
    secondParameterBounds: [secondParameter, secondParameter] as const,
  },
});

test("point consistency is translation-independent and cannot prove a positive gap", () => {
  const input = request(
    circle("first", [1_000_000_000, 0]),
    circle("second", [1_000_000_002.000000476837158203125, 0]),
  );
  expect(
    checkNeutralCurvePointConsistency(
      input,
      analyticCircleWitness([1_000_000_001, 0]),
    ),
  ).toMatchObject({
    kind: "uncertain",
    code: "neutral-curve-witness-residual",
  });
});

test("large-coordinate cancellation cannot promote a parametric candidate", () => {
  const base = 1_000_000_000;
  const line: NeutralCurve = {
    curveId: "line",
    kind: "line",
    origin: [0, base],
    direction: [1, 0],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "line", sourceSpanId: "line" },
  };
  const cubic: NeutralCurve = {
    curveId: "cubic",
    kind: "cubicBezier",
    poles: [
      [0, base + 3],
      [1 / 3, base + (-1 + Number.EPSILON * base)],
      [2 / 3, base - 1],
      [1, base + 3],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "cubic", sourceSpanId: "span" },
  };
  expect(
    checkNeutralCurvePointConsistency(request(line, cubic), {
      classification: "unclassified",
      firstParameter: 0.5,
      secondParameter: 0.5,
      position: [0.5, base],
      proof: {
        kind: "nativeParametricCurveIntersection",
        verification: "boundedTransverseLineIncidence",
        firstParameterBounds: [0.49, 0.51],
        secondParameterBounds: [0.49, 0.51],
      },
    }),
  ).toMatchObject({
    kind: "uncertain",
    code: "neutral-curve-witness-residual",
  });
});

test("finite geometry and nonzero unit directions are validated before native dispatch", () => {
  const invalidCurves: NeutralCurve[] = [
    circle("nan-center", [Number.NaN, 0]),
    circle("nan-radius", [0, 0], { radius: Number.NaN }),
    circle("zero-radius", [0, 0], { radius: 0 }),
    circle("zero-axis", [0, 0], { xAxis: [0, 0] }),
    circle("bad-domain", [0, 0], {
      sourceDomain: {
        kind: "arc",
        interval: [0, Number.POSITIVE_INFINITY],
      },
    }),
    {
      curveId: "bad-origin",
      kind: "line",
      origin: [Number.NaN, 0],
      direction: [1, 0],
      sourceDomain: [0, 1],
      provenance: { sourceEntityId: "bad-origin", sourceSpanId: "line" },
    },
    {
      curveId: "line",
      kind: "line",
      origin: [0, 0],
      direction: [0, 0],
      sourceDomain: [0, 1],
      provenance: { sourceEntityId: "line", sourceSpanId: "line" },
    },
    {
      curveId: "overflow-domain",
      kind: "line",
      origin: [0, 0],
      direction: [1, 0],
      sourceDomain: [-Number.MAX_VALUE, Number.MAX_VALUE],
      provenance: {
        sourceEntityId: "overflow-domain",
        sourceSpanId: "line",
      },
    },
    {
      curveId: "cubic",
      kind: "cubicBezier",
      poles: [
        [0, 0],
        [1, 1],
        [Number.POSITIVE_INFINITY, 1],
        [2, 0],
      ],
      sourceDomain: [0, 1],
      provenance: { sourceEntityId: "cubic", sourceSpanId: "cubic" },
    },
  ];
  for (const invalid of invalidCurves) {
    expect(
      validateNeutralCurveQueryRequest(
        request(invalid, circle("valid", [2, 0])),
      ),
    ).toMatchObject({ kind: "uncertain", code: "invalid-neutral-curve-query" });
  }
});

test("circle angular domains reject oversized, out-of-winding, and legacy shapes without throwing", () => {
  const valid = circle("valid", [0, 0]);
  const invalidCircles = [
    circle("oversized", [0, 0], {
      sourceDomain: { kind: "arc", interval: [0, 7] },
    }),
    circle("outside-winding", [0, 0], {
      sourceDomain: { kind: "fullTurn", seam: 0 },
      queryDomain: { kind: "arc", interval: [100, 101] },
    }),
    {
      ...valid,
      sourceDomain: [0, 2 * Math.PI],
    },
    {
      ...valid,
      queryDomain: [0, 1],
    },
  ] as unknown as NeutralCurve[];
  for (const invalid of invalidCircles) {
    expect(() =>
      validateNeutralCurveQueryRequest(request(invalid, valid)),
    ).not.toThrow();
    expect(
      validateNeutralCurveQueryRequest(request(invalid, valid)),
    ).toMatchObject({
      kind: "uncertain",
      code: "invalid-neutral-curve-query",
    });
  }
});

test("quarter-turn comparisons distinguish binary64 π approximations from mathematical angles", () => {
  const budget = new ExactProofBudget();
  expect(
    compareFiniteAngleToQuarterTurnMultipleExact(Math.PI / 2, 1, budget),
  ).toBe(-1);
  expect(compareFiniteAngleToQuarterTurnMultipleExact(Math.PI, 2, budget)).toBe(
    -1,
  );
  expect(
    compareFiniteAngleToQuarterTurnMultipleExact(2 * Math.PI, 4, budget),
  ).toBe(-1);
  expect(compareFiniteAngleToQuarterTurnMultipleExact(0, 0, budget)).toBe(0);
});

test("symbolic full turns own the lower seam and treat binary 2π approximations by exact span", () => {
  const full = circle("full", [0, 0]);
  expect(evaluateNeutralCurve(full, 0)).toEqual([1, 0]);
  // This binary64 value is strictly below mathematical 2π, so it is not the
  // identified upper seam and remains a valid representative.
  expect(() => evaluateNeutralCurve(full, 2 * Math.PI)).not.toThrow();
  expect(
    validateNeutralCurveQueryRequest(
      request(
        circle("near-full-arc", [0, 0], {
          sourceDomain: { kind: "arc", interval: [0, 2 * Math.PI] },
        }),
        full,
      ),
    ),
  ).toBeNull();
  expect(
    validateNeutralCurveQueryRequest(
      request(
        circle("full-clipped-near-seam", [0, 0], {
          queryDomain: {
            kind: "arc",
            interval: [0, 2 * Math.PI],
          },
        }),
        full,
      ),
    ),
  ).toBeNull();
  expect(
    validateNeutralCurveQueryRequest(
      request(
        circle("past-full", [0, 0], {
          sourceDomain: {
            kind: "arc",
            interval: [0, 6.283185307179587],
          },
        }),
        full,
      ),
    ),
  ).toMatchObject({ kind: "uncertain", code: "invalid-neutral-curve-query" });
});

test("circle evaluation uses the documented normalized basis", () => {
  const nearUnit = circle("near-unit", [4, 5], {
    xAxis: [1 - Number.EPSILON, 0],
  });
  expect(
    validateNeutralCurveQueryRequest(
      request(nearUnit, circle("other", [8, 5])),
    ),
  ).toBeNull();
  expect(evaluateNeutralCurve(nearUnit, 0)).toEqual([5, 5]);
  expect(evaluateNeutralCurve(nearUnit, Math.PI / 2)).toEqual([4, 6]);
});

test("line, phased circle, and cubic retain their documented source parameters", () => {
  const line: NeutralCurve = {
    curveId: "line",
    kind: "line",
    origin: [2, 3],
    direction: [0, 1],
    sourceDomain: [-2, 4],
    provenance: { sourceEntityId: "line", sourceSpanId: "line" },
  };
  const phased = circle("phase", [10, 20], {
    xAxis: [0, 1],
    sourceDomain: { kind: "arc", interval: [5.5, 6.5] },
  });
  const cubic: NeutralCurve = {
    curveId: "cubic",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    sourceDomain: [2, 4],
    provenance: { sourceEntityId: "cubic", sourceSpanId: "span" },
  };

  expect(evaluateNeutralCurve(line, -2)).toEqual([2, 1]);
  expect(evaluateNeutralCurve(phased, Math.PI * 2)).toEqual([10, 21]);
  expect(evaluateNeutralCurve(cubic, 3)).toEqual([1.5, 0]);
});
