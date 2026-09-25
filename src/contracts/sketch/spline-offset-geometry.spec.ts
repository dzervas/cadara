import { describe, expect, test } from "vitest";
import {
  approximateSplineOffset,
  type SplineOffsetCubicSpan,
} from "./spline-offset-geometry";
import {
  reconstructSpline,
  type SplinePoles,
  type SplineSpan,
  type SplineVariation,
  type SplineVector,
} from "./spline-geometry";

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

function realSpans(
  points: readonly SplineVector[],
  closure: "open" | "smooth" | "positional" = "open",
  handles: Readonly<Record<number, SplineVector>> = {},
  variation: SplineVariation = {},
  pointAliases: Readonly<Record<number, number>> = {},
): readonly SplineSpan[] {
  const result = reconstructSpline(
    {
      id: "knot-source",
      policy: "centripetal-mean-arm-v1",
      closure,
      points: points.map((position, index) => ({
        occurrenceId: `o${index}`,
        id: `p${pointAliases[index] ?? index}`,
        position,
        tangent: handles[index]
          ? { kind: "authored" as const, vector: handles[index]! }
          : { kind: "automatic" as const },
      })),
    },
    variation,
  );
  if (result.validity !== "valid")
    throw new Error(JSON.stringify(result.diagnostics));
  return result.spans;
}

/** Output boundary located by source provenance, never by output index. */
function knotBoundary(
  output: readonly SplineOffsetCubicSpan[],
  leftSourceSpan: number,
  rightSourceSpan: number,
) {
  const index = output.findIndex(
    (item, position) =>
      item.source.spanIndex === leftSourceSpan &&
      item.sourceLocalInterval[1] === 1 &&
      output[position + 1]?.source.spanIndex === rightSourceSpan &&
      output[position + 1]!.sourceLocalInterval[0] === 0,
  );
  if (index < 0) throw new Error("source knot boundary not found");
  return [output[index]!, output[index + 1]!] as const;
}

const knotFixture: readonly SplineVector[] = [
  [0, 0],
  [1, 1],
  [2, -3],
];

describe("shared smooth source-knot endpoints", () => {
  test("red fixture: a one-ulp source-knot gap becomes one shared emitted pole", () => {
    const spans = realSpans(knotFixture);
    expect(spans[0]!.source.endOccurrenceId).toBe(
      spans[1]!.source.startOccurrenceId,
    );
    // Pre-repair left end / right start at occurrence o1 (recorded values).
    const preLeftY = 1.9637149282107609;
    const preRightY = 1.963714928210761;
    expect(preRightY - preLeftY).toBe(2.220446049250313e-16);
    const result = successful({
      spans,
      distance: 1,
      modelingTolerance: 1e-3,
    });
    const [left, right] = knotBoundary(result.spans, 0, 1);
    expect(left.source.endOccurrenceId).toBe("o1");
    expect(right.source.startOccurrenceId).toBe("o1");
    expect(Object.is(right.poles[0][0], left.poles[3][0])).toBe(true);
    expect(Object.is(right.poles[0][1], left.poles[3][1])).toBe(true);
    expect(left.poles[3]).toEqual([1.2669335818958114, preLeftY]);
    expect(right.differential.poles[0]).toEqual(left.differential.poles[3]);
    for (const output of result.spans) {
      expect(output.certifiedError).toBeLessThanOrEqual(1e-3);
      sampleCertifiedSpan(spans[output.source.spanIndex]!, output, 1);
    }
  });

  test("certificate is recomputed on the copied pole before acceptance and refinement", () => {
    // Fabricated provenance: same occurrence and knot, but a real tangent corner.
    const leftPoles: SplinePoles = [
      [-3, 0],
      [-2, 0],
      [-1, 0],
      [0, 0],
    ];
    const rightPoles: SplinePoles = [
      [0, 0],
      [0.7, 0.7],
      [1.4, 1.4],
      [2.1, 2.1],
    ];
    const make = (
      poles: SplinePoles,
      spanIndex: number,
      start: string,
      end: string,
      interval: readonly [number, number],
    ): SplineSpan => ({
      source: {
        splineId: "corner",
        spanIndex,
        startPointId: start,
        endPointId: end,
        startOccurrenceId: `${start}-use`,
        endOccurrenceId: `${end}-use`,
      },
      orientation: "forward",
      interval,
      poles,
      validity: "valid",
      differential: { interval: [0, 0], poles: zeroPoles },
    });
    const corner = [
      make(leftPoles, 0, "a", "k", [0, 3]),
      make(rightPoles, 1, "k", "b", [3, 6]),
    ];
    const rejected = approximateSplineOffset({
      spans: corner,
      distance: 0.5,
      modelingTolerance: 1e-3,
      maxDepth: 12,
    });
    expect(rejected).toMatchObject({
      ok: false,
      code: "refinement-budget-exceeded",
      sourceSpanIndex: 1,
    });
    // The copied pole lies ~0.5*|n_left - n_right| from the right ideal endpoint.
    expect(!rejected.ok && rejected.certifiedError).toBeGreaterThan(0.1);

    // Corner and disconnected lookalikes are emitted independently.
    const lookalikes: SplineSpan[][] = [
      [
        corner[0]!,
        {
          ...corner[1]!,
          source: { ...corner[1]!.source, startOccurrenceId: "other-use" },
        },
      ],
      [
        corner[0]!,
        { ...corner[1]!, source: { ...corner[1]!.source, splineId: "other" } },
      ],
      [
        corner[0]!,
        { ...corner[1]!, source: { ...corner[1]!.source, spanIndex: 2 } },
      ],
      [corner[1]!, corner[0]!],
    ];
    for (const spans of lookalikes) {
      const accepted = successful({
        spans,
        distance: 0.5,
        modelingTolerance: 1e-3,
        maxDepth: 12,
      });
      accepted.spans.forEach((output) =>
        expect(output.certifiedError).toBeLessThanOrEqual(1e-3),
      );
    }
  });

  test("fails closed when shared provenance contradicts the exact knot", () => {
    const spans = realSpans(knotFixture);
    const shifted: SplineSpan = {
      ...spans[1]!,
      poles: [
        [spans[1]!.poles[0][0], nextAfter(spans[1]!.poles[0][1])],
        spans[1]!.poles[1],
        spans[1]!.poles[2],
        spans[1]!.poles[3],
      ],
    };
    expect(
      approximateSplineOffset({
        spans: [spans[0]!, shifted],
        distance: 1,
        modelingTolerance: 1e-3,
      }),
    ).toMatchObject({
      ok: false,
      code: "certification-failed",
      sourceSpanIndex: 1,
      sourceLocalInterval: [0, 1],
    });
    const renamedPoint: SplineSpan = {
      ...spans[1]!,
      source: { ...spans[1]!.source, startPointId: "elsewhere" },
    };
    expect(
      approximateSplineOffset({
        spans: [spans[0]!, renamedPoint],
        distance: 1,
        modelingTolerance: 1e-3,
      }),
    ).toMatchObject({ ok: false, code: "certification-failed" });
    const selfLoop: SplineSpan = {
      ...spans[0]!,
      source: { ...spans[0]!.source, endOccurrenceId: "o0" },
    };
    expect(
      approximateSplineOffset({
        spans: [selfLoop],
        distance: 1,
        modelingTolerance: 1e-3,
      }),
    ).toMatchObject({ ok: false, code: "certification-failed" });
  });

  test("disconnected subsets and reversed order never join; contiguous subsets share their knot", () => {
    const spans = realSpans([
      [0, 0],
      [2, 1],
      [4, 0],
      [6, 1],
    ]);
    const full = successful({ spans, distance: 0.2, modelingTolerance: 1e-3 });
    const standalone = (span: SplineSpan) =>
      successful({ spans: [span], distance: 0.2, modelingTolerance: 1e-3 })
        .spans;
    const skip = successful({
      spans: [spans[0]!, spans[2]!],
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    expect(skip.spans).toEqual([
      ...standalone(spans[0]!),
      ...standalone(spans[2]!),
    ]);
    const reversed = successful({
      spans: [spans[1]!, spans[0]!],
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    expect(reversed.spans).toEqual([
      ...standalone(spans[1]!),
      ...standalone(spans[0]!),
    ]);
    const contiguous = successful({
      spans: [spans[1]!, spans[2]!],
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    const [left, right] = knotBoundary(contiguous.spans, 1, 2);
    expect(right.poles[0]).toEqual(left.poles[3]);
    const [fullLeft, fullRight] = knotBoundary(full.spans, 1, 2);
    expect(fullRight.poles[0]).toEqual(fullLeft.poles[3]);
  });

  test("smooth closure shares the complete wrap; positional C0 closure stays a corner", () => {
    const loop: SplineVector[] = [
      [0, 0],
      [3, 0.5],
      [2.5, 3],
      [-0.5, 2],
    ];
    const smooth = realSpans(loop, "smooth");
    expect(smooth.at(-1)!.source.endOccurrenceId).toBe(
      smooth[0]!.source.startOccurrenceId,
    );
    const closed = successful({
      spans: smooth,
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    expect(closed.spans.at(-1)!.poles[3]).toEqual(closed.spans[0]!.poles[0]);
    expect(closed.spans.at(-1)!.differential.poles[3]).toEqual(
      closed.spans[0]!.differential.poles[0],
    );
    for (let index = 0; index + 1 < closed.spans.length; index += 1)
      expect(closed.spans[index + 1]!.poles[0]).toEqual(
        closed.spans[index]!.poles[3],
      );

    // Incomplete wrap subset (last + first) never joins the wrap.
    const subset = successful({
      spans: [smooth.at(-1)!, smooth[0]!],
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    expect(subset.spans).toEqual([
      ...successful({
        spans: [smooth.at(-1)!],
        distance: 0.2,
        modelingTolerance: 1e-3,
      }).spans,
      ...successful({
        spans: [smooth[0]!],
        distance: 0.2,
        modelingTolerance: 1e-3,
      }).spans,
    ]);

    const positional = realSpans(
      [...loop, loop[0]!],
      "positional",
      {},
      {},
      {
        [loop.length]: 0,
      },
    );
    expect(positional.at(-1)!.source.endPointId).toBe(
      positional[0]!.source.startPointId,
    );
    expect(positional.at(-1)!.source.endOccurrenceId).not.toBe(
      positional[0]!.source.startOccurrenceId,
    );
    const corner = successful({
      spans: positional,
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    expect(corner.spans.at(-1)!.poles[3]).not.toEqual(
      corner.spans[0]!.poles[0],
    );
  });

  test("zero authored tangent at a shared knot fails before any reuse", () => {
    const spans = realSpans(knotFixture, "open", { 1: [0, 0] });
    expect(
      approximateSplineOffset({
        spans,
        distance: 1,
        modelingTolerance: 1e-3,
      }),
    ).toMatchObject({ ok: false, sourceSpanIndex: 0 });
  });

  test("tight tolerance, output cap and expected topology behave as before with reuse", () => {
    const spans = realSpans(knotFixture);
    const base = successful({ spans, distance: 1, modelingTolerance: 1e-3 });
    expect(
      successful({
        spans,
        distance: 1,
        modelingTolerance: 1e-3,
        maxOutputSpans: base.spans.length,
        expectedTopology: base.topology,
      }).spans,
    ).toEqual(base.spans);
    expect(
      approximateSplineOffset({
        spans,
        distance: 1,
        modelingTolerance: 1e-3,
        maxOutputSpans: base.spans.length - 1,
      }),
    ).toMatchObject({ ok: false, code: "refinement-budget-exceeded" });
    expect(
      approximateSplineOffset({
        spans,
        distance: 1,
        modelingTolerance: 1e-3,
        expectedTopology: base.topology.slice(1),
      }),
    ).toMatchObject({ ok: false, code: "topology-changed" });
    const tight = approximateSplineOffset({
      spans,
      distance: 1,
      modelingTolerance: Number.MIN_VALUE,
      maxDepth: 6,
    });
    expect(tight).toMatchObject({
      ok: false,
      code: "refinement-budget-exceeded",
    });
  });

  const jvpCases: readonly {
    name: string;
    distance: number;
    handles: Readonly<Record<number, SplineVector>>;
    variation: SplineVariation;
  }[] = [
    {
      name: "distance and source points",
      distance: 1,
      handles: {},
      variation: {
        points: { p0: [0.3, -0.2], p1: [-0.5, 0.4], p2: [0.2, 0.7] },
      },
    },
    {
      name: "authored knot handle",
      distance: 0.3,
      handles: { 1: [0.9, -0.4] },
      variation: { tangents: { 1: [-0.3, 0.6] }, points: { p1: [0.1, 0.2] } },
    },
  ];

  test.each(jvpCases)(
    "real-source fixed-topology JVP of shared and interior poles agrees with finite differences ($name)",
    ({ distance, handles, variation }) => {
      const distanceDifferential = -0.37;
      const tolerance = 1e-3;
      const moved = (
        value: SplineVector,
        delta: SplineVector | undefined,
        epsilon: number,
      ): SplineVector => [
        value[0] + epsilon * (delta?.[0] ?? 0),
        value[1] + epsilon * (delta?.[1] ?? 0),
      ];
      const at = (epsilon: number) => {
        const points = knotFixture.map((point, index) =>
          moved(point, variation.points?.[`p${index}`], epsilon),
        );
        const perturbedHandles: Record<number, SplineVector> = {};
        for (const [index, handle] of Object.entries(handles))
          perturbedHandles[Number(index)] = moved(
            handle,
            variation.tangents?.[Number(index)],
            epsilon,
          );
        return realSpans(points, "open", perturbedHandles);
      };
      const base = successful({
        spans: realSpans(knotFixture, "open", handles, variation),
        distance,
        distanceDifferential,
        modelingTolerance: tolerance,
      });
      const epsilon = 1e-6;
      const run = (sign: number) =>
        successful({
          spans: at(sign * epsilon),
          distance: distance + sign * epsilon * distanceDifferential,
          modelingTolerance: tolerance,
          expectedTopology: base.topology,
        });
      const plus = run(1);
      const minus = run(-1);
      const [left, right] = knotBoundary(base.spans, 0, 1);
      expect(right.poles[0]).toEqual(left.poles[3]);
      expect(right.differential.poles[0]).toEqual(left.differential.poles[3]);
      base.spans.forEach((output, spanIndex) => {
        output.poles.forEach((_, poleIndex) => {
          const difference = (axis: 0 | 1) =>
            (plus.spans[spanIndex]!.poles[poleIndex]![axis] -
              minus.spans[spanIndex]!.poles[poleIndex]![axis]) /
            (2 * epsilon);
          expectVectorClose(
            output.differential.poles[poleIndex]!,
            [difference(0), difference(1)],
            2e-5,
          );
        });
      });
    },
  );
});

/** Independent analytic source derivatives at local u (test oracle only). */
function sourceDerivatives(poles: SplinePoles, u: number) {
  const v = 1 - u;
  const axis = (index: 0 | 1) => {
    const [p0, p1, p2, p3] = poles.map((pole) => pole[index]!);
    return [
      3 * (v * v * (p1! - p0!) + 2 * v * u * (p2! - p1!) + u * u * (p3! - p2!)),
      6 * (v * (p2! - 2 * p1! + p0!) + u * (p3! - 2 * p2! + p1!)),
    ] as const;
  };
  const x = axis(0);
  const y = axis(1);
  return { first: [x[0], y[0]] as const, second: [x[1], y[1]] as const };
}

/** Analytic O′(u) = S′ + d·rot(S″/|S′| − S′(S′·S″)/|S′|³) (test oracle only). */
function analyticOffsetDerivative(
  poles: SplinePoles,
  u: number,
  distance: number,
): SplineVector {
  const { first, second } = sourceDerivatives(poles, u);
  const speed = Math.hypot(...first);
  const along = first[0] * second[0] + first[1] * second[1];
  const normalFirst = [0, 1].map(
    (axis) => second[axis]! / speed - (first[axis]! * along) / speed ** 3,
  );
  return [
    first[0] - distance * normalFirst[1]!,
    first[1] + distance * normalFirst[0]!,
  ];
}

describe("owner proof metadata for the tube-stability certificate", () => {
  test("sanity only: each leaf's derivative box contains sampled analytic O′ and references its source poles", () => {
    const spans = realSpans([
      [0, 0],
      [1, 0.1],
      [2, 0],
    ]);
    const result = successful({
      spans,
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    expect(result.spans).toHaveLength(4);
    for (const output of result.spans) {
      const source = spans[output.source.spanIndex]!;
      expect(
        output.reference.sourcePoles,
        "a reference to the source span's own pole array",
      ).toBe(source.poles);
      expect(Object.isFrozen(output.reference)).toBe(true);
      expect(Object.isFrozen(output.reference.derivative)).toBe(true);
      const [a, b] = output.sourceLocalInterval;
      const box = output.reference.derivative;
      // Sampling is a sanity check of the enclosure, never a proof of it.
      for (let index = 0; index < 64; index += 1) {
        const value = analyticOffsetDerivative(
          source.poles,
          a + ((b - a) * index) / 63,
          0.2,
        );
        for (const axis of [0, 1] as const) {
          expect(box[axis][0]).toBeLessThanOrEqual(value[axis]);
          expect(value[axis]).toBeLessThanOrEqual(box[axis][1]);
        }
      }
    }
  });

  test("metadata is deterministic and the only field added to emitted spans", () => {
    // Byte-identity of poles, errors, partition, sharing and JVP against the
    // pre-metadata owner is a private baseline comparison (scratch evidence):
    // literal digests would pin engine-specific Math.hypot rounding.
    for (const [points, distance] of [
      [
        [
          [0, 0],
          [1, 0.1],
          [2, 0],
        ],
        0.2,
      ],
      [
        [
          [0, 0],
          [1, 1],
          [2, 0],
          [3, 1],
        ],
        0.1,
      ],
      [
        [
          [0, 0],
          [2, 0.5],
          [4, 0],
        ],
        -0.3,
      ],
      [knotFixture, 1],
    ] as const) {
      const input = {
        spans: realSpans(points),
        distance,
        distanceDifferential: 0.7,
        modelingTolerance: 1e-3,
      };
      const result = successful(input);
      expect(JSON.stringify(approximateSplineOffset(input))).toBe(
        JSON.stringify(result),
      );
      for (const output of result.spans) {
        expect(Object.keys(output).sort()).toEqual([
          "certifiedError",
          "differential",
          "poles",
          "reference",
          "source",
          "sourceInterval",
          "sourceLocalInterval",
        ]);
      }
    }
  });

  test("the zero-distance branch carries the source derivative box and source poles", () => {
    const result = successful({
      spans: [curved],
      distance: 0,
      modelingTolerance: 1e-3,
    });
    expect(result.spans).toHaveLength(1);
    const [output] = result.spans;
    expect(output!.poles).toBe(curved.poles);
    expect(output!.certifiedError).toBe(0);
    expect(output!.reference.sourcePoles).toBe(curved.poles);
    for (let index = 0; index < 64; index += 1) {
      const value = sourceDerivatives(curved.poles, index / 63).first;
      for (const axis of [0, 1] as const) {
        expect(output!.reference.derivative[axis][0]).toBeLessThanOrEqual(
          value[axis],
        );
        expect(value[axis]).toBeLessThanOrEqual(
          output!.reference.derivative[axis][1],
        );
      }
    }
  });
});

function nextAfter(value: number) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  view.setBigUint64(0, view.getBigUint64(0) + (value >= 0 ? 1n : -1n));
  return view.getFloat64(0);
}
