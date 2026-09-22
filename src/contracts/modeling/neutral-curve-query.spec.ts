import { expect, test } from "vitest";
import {
  checkNeutralCurvePointConsistency,
  evaluateNeutralCurve,
  proveStructuralCubicOverlap,
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
  sourceDomain: [0, Math.PI * 2],
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
  proof: { kind: "nativeAnalyticCircleIntersection" as const },
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
      sourceDomain: [0, Number.POSITIVE_INFINITY],
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
    sourceDomain: [5.5, 6.5],
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

test("structural cubic overlap proves interiors, orientation, domains, and provenance", () => {
  const first: NeutralCurve = {
    curveId: "arch",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ],
    sourceDomain: [0, 1],
    queryDomain: [0.2, 0.8],
    provenance: { sourceEntityId: "spline", sourceSpanId: "span-0" },
  };
  const reversed: NeutralCurve = {
    curveId: "arch-reversed",
    kind: "cubicBezier",
    poles: [...first.poles].reverse() as typeof first.poles,
    sourceDomain: [0, 1],
    queryDomain: [0.2, 0.8],
    provenance: { sourceEntityId: "copy", sourceSpanId: "reversed" },
  };
  expect(proveStructuralCubicOverlap(first, reversed)).toEqual({
    orientation: "opposite",
    firstInterval: [0.2, 0.8],
    secondInterval: [0.8, 0.2],
    proof: {
      kind: "structuralCubicPoleIdentity",
      poleOrder: "reversed",
      firstProvenance: first.provenance,
      secondProvenance: reversed.provenance,
    },
  });

  const differentInterior: NeutralCurve = {
    ...reversed,
    poles: [
      [3, 0],
      [2, -1],
      [1, -1],
      [0, 0],
    ],
  };
  expect(proveStructuralCubicOverlap(first, differentInterior)).toBeNull();
});

test("structural overlap intersects both affine active ranges in either argument order", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const first: NeutralCurve = {
    curveId: "first",
    kind: "cubicBezier",
    poles,
    sourceDomain: [2, 4],
    queryDomain: [2.4, 3.6],
    provenance: { sourceEntityId: "first", sourceSpanId: "span" },
  };
  const second: NeutralCurve = {
    curveId: "second",
    kind: "cubicBezier",
    poles,
    sourceDomain: [10, 20],
    queryDomain: [14, 19],
    provenance: { sourceEntityId: "second", sourceSpanId: "span" },
  };

  expect(proveStructuralCubicOverlap(first, second)).toMatchObject({
    orientation: "same",
    firstInterval: [2.8, 3.6],
    secondInterval: [14, 18],
  });
  expect(proveStructuralCubicOverlap(second, first)).toMatchObject({
    orientation: "same",
    firstInterval: [14, 18],
    secondInterval: [2.8, 3.6],
  });

  const reversed: NeutralCurve = {
    ...second,
    poles: [...poles].reverse() as unknown as typeof poles,
  };
  expect(proveStructuralCubicOverlap(first, reversed)).toMatchObject({
    orientation: "opposite",
    firstInterval: [2.4, 3.2],
    secondInterval: [18, 14],
  });
  expect(proveStructuralCubicOverlap(reversed, first)).toMatchObject({
    orientation: "opposite",
    firstInterval: [14, 18],
    secondInterval: [3.2, 2.4],
  });
});

test("structural overlap uses exact binary64 affine ordering and rejects a rounded healed gap", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const first: NeutralCurve = {
    curveId: "first",
    kind: "cubicBezier",
    poles,
    sourceDomain: [-126945672.37721825, 4505890001.637915],
    queryDomain: [2125499653.7343376, 2125499653.7343385],
    provenance: { sourceEntityId: "first", sourceSpanId: "span" },
  };
  const second: NeutralCurve = {
    curveId: "second",
    kind: "cubicBezier",
    poles,
    sourceDomain: [-3609677398.139288, 1915706826.9335546],
    queryDomain: [-923282553.0681655, -923282553.0681646],
    provenance: { sourceEntityId: "second", sourceSpanId: "span" },
  };

  expect(proveStructuralCubicOverlap(first, second)).toBeNull();
  expect(proveStructuralCubicOverlap(second, first)).toBeNull();
  expect(
    proveStructuralCubicOverlap(first, {
      ...second,
      poles: [...poles].reverse() as unknown as typeof poles,
    }),
  ).toBeNull();
});

test("structural overlap maps extreme exact fractions without overflow or underflow", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const makeCubic = (
    curveId: string,
    sourceDomain: readonly [number, number],
    queryDomain: readonly [number, number],
    reversed = false,
  ): NeutralCurve => ({
    curveId,
    kind: "cubicBezier",
    poles: reversed ? ([...poles].reverse() as unknown as typeof poles) : poles,
    sourceDomain,
    queryDomain,
    provenance: { sourceEntityId: curveId, sourceSpanId: "span" },
  });
  const wide = makeCubic("wide", [0, Number.MAX_VALUE], [1, 2]);
  const narrow = makeCubic("narrow", [0, 1], [1e-309, 1e-308]);
  const reversed = makeCubic("reversed", [-1, 0], [-1e-308, -1e-309], true);

  for (const [first, second] of [
    [wide, narrow],
    [narrow, wide],
    [wide, reversed],
    [reversed, wide],
  ] as const) {
    const overlap = proveStructuralCubicOverlap(first, second);
    expect(overlap).not.toBeNull();
    expect(overlap!.firstInterval.every(Number.isFinite)).toBe(true);
    expect(overlap!.secondInterval.every(Number.isFinite)).toBe(true);
    expect(overlap!.firstInterval[0]).not.toBe(overlap!.firstInterval[1]);
    expect(overlap!.secondInterval[0]).not.toBe(overlap!.secondInterval[1]);
  }
});

test("structural overlap never snaps separated or zero-width active ranges", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const cubic = (
    curveId: string,
    queryDomain: readonly [number, number],
  ): NeutralCurve => ({
    curveId,
    kind: "cubicBezier",
    poles,
    sourceDomain: [0, 1],
    queryDomain,
    provenance: { sourceEntityId: curveId, sourceSpanId: "span" },
  });

  expect(
    proveStructuralCubicOverlap(
      cubic("first", [0.5, 0.5000000000000004]),
      cubic("second", [0.5000000000000007, 0.5000000000000011]),
    ),
  ).toBeNull();
  expect(
    proveStructuralCubicOverlap(
      cubic("first", [0.2, 0.4]),
      cubic("second", [0.4, 0.6]),
    ),
  ).toBeNull();
});
