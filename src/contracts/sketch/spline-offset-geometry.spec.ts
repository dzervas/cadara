import { describe, expect, test } from "vitest";
import {
  approximateSplineOffset,
  type SplineOffsetCubicSpan,
} from "./spline-offset-geometry";
import type { SplinePoles, SplineSpan, SplineVector } from "./spline-geometry";

const zeroPoles = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
] as const satisfies SplinePoles;

function span(
  poles: SplinePoles,
  differentialPoles: SplinePoles = zeroPoles,
): SplineSpan {
  return {
    source: {
      splineId: "source",
      spanIndex: 0,
      startPointId: "start",
      endPointId: "end",
      startOccurrenceId: "start-use",
      endOccurrenceId: "end-use",
    },
    orientation: "forward",
    interval: [2, 5],
    poles,
    validity: "valid",
    differential: { interval: [0.3, -0.2], poles: differentialPoles },
  };
}

const curved = span([
  [-2, 0],
  [-1, 4],
  [3, -3],
  [5, 2],
]);

function bezier(poles: SplinePoles, u: number): SplineVector {
  const v = 1 - u;
  const weights = [v ** 3, 3 * v * v * u, 3 * v * u * u, u ** 3];
  return [0, 1].map((axis) =>
    poles.reduce((sum, pole, index) => sum + pole[axis]! * weights[index]!, 0),
  ) as SplineVector;
}

/** Independent direct Bernstein source-offset oracle; never used as a certificate. */
function trueOffset(
  poles: SplinePoles,
  u: number,
  distance: number,
): SplineVector {
  const source = bezier(poles, u);
  const derivativePoles = [0, 1, 2].map(
    (index) =>
      [
        3 * (poles[index + 1]![0] - poles[index]![0]),
        3 * (poles[index + 1]![1] - poles[index]![1]),
      ] as SplineVector,
  );
  const v = 1 - u;
  const tangent: SplineVector = [0, 1].map(
    (axis) =>
      derivativePoles[0]![axis] * v * v +
      2 * derivativePoles[1]![axis] * v * u +
      derivativePoles[2]![axis] * u * u,
  ) as SplineVector;
  const speed = Math.hypot(...tangent);
  return [
    source[0] - (distance * tangent[1]) / speed,
    source[1] + (distance * tangent[0]) / speed,
  ];
}

function expectVectorClose(
  actual: SplineVector,
  expected: SplineVector,
  relative = 1e-7,
) {
  expect(
    Math.hypot(actual[0] - expected[0], actual[1] - expected[1]),
  ).toBeLessThanOrEqual(relative * Math.max(1, Math.hypot(...expected)));
}

function successful(input: Parameters<typeof approximateSplineOffset>[0]) {
  const result = approximateSplineOffset(input);
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result;
}

function sampleCertifiedSpan(
  source: SplineSpan,
  output: SplineOffsetCubicSpan,
  distance: number,
) {
  const [a, b] = output.sourceLocalInterval;
  for (let index = 0; index <= 100; index += 1) {
    const r = index / 100;
    const expected = trueOffset(source.poles, a + (b - a) * r, distance);
    const actual = bezier(output.poles, r);
    expect(
      Math.hypot(actual[0] - expected[0], actual[1] - expected[1]),
      "independent true-offset sample must remain below the analytic certificate",
    ).toBeLessThanOrEqual(output.certifiedError * (1 + 1e-10));
  }
}

describe("bounded standalone true-normal spline offset owner", () => {
  test("certifies every curved output interval against document tolerance", () => {
    const tolerance = 2e-4;
    const result = successful({
      spans: [curved],
      distance: 0.35,
      modelingTolerance: tolerance,
      maxDepth: 16,
      maxOutputSpans: 4096,
    });
    expect(result.spans.length).toBeGreaterThan(1);
    expect(result.spans.map((item) => item.sourceLocalInterval)).toEqual(
      result.topology.map((item) => item.localInterval),
    );
    for (const output of result.spans) {
      expect(output.certifiedError).toBeLessThanOrEqual(tolerance);
      expect(output.source.splineId).toBe("source");
      sampleCertifiedSpan(curved, output, 0.35);
    }
    expect(result.spans[0]!.sourceInterval[0]).toBe(2);
    expect(result.spans.at(-1)!.sourceInterval[1]).toBe(5);
  });

  test("analytic endpoint-pole JVP agrees with finite differences on uneven geometry", () => {
    const differentialPoles: SplinePoles = [
      [0.2, -0.4],
      [-0.7, 0.3],
      [0.5, 0.8],
      [-0.1, -0.6],
    ];
    const source = span(curved.poles, differentialPoles);
    const distance = 0.27;
    const distanceDifferential = -0.19;
    const base = successful({
      spans: [source],
      distance,
      distanceDifferential,
      modelingTolerance: 5e-4,
      maxDepth: 16,
    });
    const epsilon = 1e-6;
    const perturb = (amount: number): SplineSpan => ({
      ...source,
      poles: source.poles.map((pole, index) => [
        pole[0] + amount * differentialPoles[index]![0],
        pole[1] + amount * differentialPoles[index]![1],
      ]) as unknown as SplinePoles,
      interval: [
        source.interval[0] + amount * source.differential.interval[0],
        source.interval[1] + amount * source.differential.interval[1],
      ],
    });
    const plus = successful({
      spans: [perturb(epsilon)],
      distance: distance + epsilon * distanceDifferential,
      modelingTolerance: 5e-4,
      expectedTopology: base.topology,
      maxDepth: 16,
    });
    const minus = successful({
      spans: [perturb(-epsilon)],
      distance: distance - epsilon * distanceDifferential,
      modelingTolerance: 5e-4,
      expectedTopology: base.topology,
      maxDepth: 16,
    });
    base.spans.forEach((output, spanIndex) => {
      output.poles.forEach((_, poleIndex) => {
        const oracle: SplineVector = [0, 1].map(
          (axis) =>
            (plus.spans[spanIndex]!.poles[poleIndex]![axis] -
              minus.spans[spanIndex]!.poles[poleIndex]![axis]) /
            (2 * epsilon),
        ) as SplineVector;
        expectVectorClose(output.differential.poles[poleIndex]!, oracle, 3e-6);
      });
      output.differential.sourceInterval.forEach((value, endpoint) => {
        const oracle =
          (plus.spans[spanIndex]!.sourceInterval[endpoint]! -
            minus.spans[spanIndex]!.sourceInterval[endpoint]!) /
          (2 * epsilon);
        expect(value).toBeCloseTo(oracle, 7);
      });
    });
  });

  test("zero distance exactly preserves adversarial binary64 poles below roundoff", () => {
    const source = span([
      [0.1, 0.2],
      [1 / 3, Math.PI],
      [Math.E, -1 / 7],
      [10.1, -3.3],
    ]);
    const result = successful({
      spans: [source],
      distance: 0,
      modelingTolerance: Number.MIN_VALUE,
      maxDepth: 12,
    });
    expect(result.spans).toHaveLength(1);
    expect(result.spans[0]!.certifiedError).toBe(0);
    expect(result.spans[0]!.poles).toEqual(source.poles);
    for (let index = 0; index <= 100; index += 1) {
      const u = index / 100;
      expect(bezier(result.spans[0]!.poles, u)).toEqual(
        bezier(source.poles, u),
      );
    }
  });

  test("nonzero emitted-pole roundoff is included and blocks sub-roundoff acceptance", () => {
    const source = span([
      [0.1, 0.2],
      [1 / 3, Math.PI],
      [Math.E, -1 / 7],
      [10.1, -3.3],
    ]);
    const accepted = successful({
      spans: [source],
      distance: 0.125,
      modelingTolerance: 1e-3,
      maxDepth: 16,
    });
    accepted.spans.forEach((output) => {
      expect(output.certifiedError).toBeGreaterThan(0);
      sampleCertifiedSpan(source, output, 0.125);
    });

    const rejected = approximateSplineOffset({
      spans: [source],
      distance: 0.125,
      modelingTolerance: Number.MIN_VALUE,
      maxDepth: 16,
    });
    expect(rejected).toMatchObject({
      ok: false,
      code: "refinement-budget-exceeded",
    });
    expect(!rejected.ok && rejected.certifiedError).toBeGreaterThan(
      Number.MIN_VALUE,
    );
  });

  test("scales geometry, distance, tolerance, and certificates coherently", () => {
    const topologies: string[] = [];
    for (const factor of [1e-4, 1, 1e4]) {
      const scaled = span(
        curved.poles.map(([x, y]) => [
          x * factor,
          y * factor,
        ]) as unknown as SplinePoles,
      );
      const result = successful({
        spans: [scaled],
        distance: 0.35 * factor,
        modelingTolerance: 2e-4 * factor,
        maxDepth: 16,
      });
      topologies.push(JSON.stringify(result.topology));
      result.spans.forEach((output) => {
        expect(output.certifiedError).toBeLessThanOrEqual(2e-4 * factor);
        sampleCertifiedSpan(scaled, output, 0.35 * factor);
      });
    }
    expect(new Set(topologies).size).toBe(1);
  });

  test("fails explicitly for source degeneracy, offset cusp uncertainty, budget, and topology changes", () => {
    const constant = span([
      [1, 2],
      [1, 2],
      [1, 2],
      [1, 2],
    ]);
    expect(
      approximateSplineOffset({
        spans: [constant],
        distance: 1,
        modelingTolerance: 1e-3,
        maxDepth: 4,
      }),
    ).toMatchObject({ ok: false, code: "source-derivative-degenerate" });

    const parabola = span([
      [0, 0],
      [1 / 3, 0],
      [2 / 3, 1 / 3],
      [1, 1],
    ]);
    expect(
      approximateSplineOffset({
        spans: [parabola],
        distance: 0.5,
        modelingTolerance: 1e-4,
        maxDepth: 8,
      }),
    ).toMatchObject({ ok: false, code: "offset-topology-uncertain" });

    const regularCurved = span([
      [0, 0],
      [1, 2],
      [2, -1],
      [3, 1],
    ]);
    const budget = approximateSplineOffset({
      spans: [regularCurved],
      distance: 0.001,
      modelingTolerance: 1e-20,
      maxDepth: 0,
    });
    expect(budget).toMatchObject({
      ok: false,
      code: "refinement-budget-exceeded",
      sourceSpanIndex: 0,
      sourceLocalInterval: [0, 1],
    });
    expect(!budget.ok && budget.certifiedError).toBeGreaterThan(1e-20);

    expect(
      approximateSplineOffset({
        spans: [curved],
        distance: 0.35,
        modelingTolerance: 2e-4,
        maxDepth: 16,
        expectedTopology: [{ sourceSpanIndex: 0, localInterval: [0, 1] }],
      }),
    ).toMatchObject({ ok: false, code: "topology-changed" });
  });
});
