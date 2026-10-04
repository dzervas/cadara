import { describe, expect, test } from "vitest";
import {
  closestPointOnSolvedCubicSpans,
  closestSplineSpanLocation,
  cubicSpansPoleBounds,
  evaluateSplineSpan,
  solvedCubicSpanLocalDomain,
  solvedCubicSpanPoint,
  tessellateCubicSpans,
  type SolvedCubicSpan,
  reconstructSpline,
  reconstructSplineAggregate,
  splineAggregatePiece,
  trimSplineAggregate,
  type AuthoredSplineAggregate,
  type ResolvedSplineInput,
  type SplineCut,
  type SplineGeometry,
  type SplinePiece,
  type SplineSpan,
  type SplineVariation,
  type SplineVector as V,
} from "./spline-geometry";

const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1]];
const mul = (a: V, s: number): V => [a[0] * s, a[1] * s];
const near = (a: V, b: V, tolerance = 1e-9) => {
  expect(Math.hypot(...sub(a, b))).toBeLessThanOrEqual(
    tolerance * Math.max(1, Math.hypot(...a), Math.hypot(...b)),
  );
};
const uneven: V[] = [
  [-5, 2],
  [0, 0],
  [0.02, 0.01],
  [9, -3],
  [10, 4],
  [30, 5],
  [32, 1],
];
function input(
  points: readonly V[] = uneven,
  closure: ResolvedSplineInput["closure"] = "open",
  handles: Readonly<Record<number, V>> = {},
): ResolvedSplineInput {
  return {
    id: "spline",
    policy: "centripetal-mean-arm-v1",
    closure,
    points: points.map((position, i) => ({
      occurrenceId: `occurrence-${i}`,
      id: `p${i}`,
      position,
      tangent: handles[i]
        ? { kind: "authored", vector: handles[i] }
        : { kind: "automatic" },
    })),
  };
}
function build(data: ResolvedSplineInput, variation?: SplineVariation) {
  const result = reconstructSpline(data, variation);
  if (result.validity !== "valid")
    throw new Error(JSON.stringify(result.diagnostics));
  return result;
}
// Independent Barry–Goldman recursion, not a tangent-to-pole conversion.
function recursive([p0, p1, p2, p3]: readonly [V, V, V, V], u: number): V {
  const interval = (a: V, b: V) => Math.sqrt(Math.hypot(...sub(a, b)));
  const t0 = 0,
    t1 = interval(p0, p1),
    t2 = t1 + interval(p1, p2),
    t3 = t2 + interval(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const blend = (a: V, b: V, lo: number, hi: number) =>
    add(mul(a, (hi - t) / (hi - lo)), mul(b, (t - lo) / (hi - lo)));
  const a = blend(p0, p1, t0, t1),
    b = blend(p1, p2, t1, t2),
    c = blend(p2, p3, t2, t3);
  return blend(blend(a, b, t0, t2), blend(b, c, t1, t3), t1, t2);
}
function perturb(
  data: ResolvedSplineInput,
  variation: SplineVariation,
  epsilon: number,
): ResolvedSplineInput {
  return {
    ...data,
    points: data.points.map((p, i) => ({
      ...p,
      position: add(
        p.position,
        mul(variation.points?.[p.id] ?? [0, 0], epsilon),
      ),
      tangent:
        p.tangent.kind === "automatic"
          ? p.tangent
          : {
              kind: "authored",
              vector: add(
                p.tangent.vector,
                mul(variation.tangents?.[i] ?? [0, 0], epsilon),
              ),
            },
    })),
  };
}

describe("neutral spline reconstruction owner", () => {
  test("resolves stable ordered occurrences with independent alias tangents", () => {
    const aggregate = {
      entityId: "spline-alias",
      pointOccurrenceIds: ["start", "middle", "end"],
      pointOccurrences: [
        {
          occurrenceId: "middle",
          pointId: "p1",
          tangent: { kind: "automatic" as const },
        },
        {
          occurrenceId: "end",
          pointId: "p0",
          tangent: { kind: "authored" as const, vector: [0, 0] as V },
        },
        {
          occurrenceId: "start",
          pointId: "p0",
          tangent: { kind: "automatic" as const },
        },
      ],
      closure: "positional" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
    };
    const result = reconstructSplineAggregate(aggregate, {
      p0: [0, 0],
      p1: [2, 1],
    });
    expect(result.validity).toBe("valid");
    if (result.validity === "valid") {
      expect(result.spans[0]!.source.startOccurrenceId).toBe("start");
      expect(result.spans[1]!.source.endOccurrenceId).toBe("end");
      expect(result.handles[2]).toEqual([0, 0]);
      expect(result.handles[0]).not.toEqual([0, 0]);
    }

    expect(
      reconstructSplineAggregate(
        { ...aggregate, pointOccurrenceIds: ["start", "start", "end"] },
        { p0: [0, 0], p1: [2, 1] },
      ).validity,
    ).toBe("invalid");
  });
  test("automatic uneven, reflected endpoint and wrapped spans match recursive interpolation", () => {
    for (const closure of ["open", "smooth"] as const) {
      const result = build(input(uneven, closure));
      const n = uneven.length;
      const neighbor = (i: number): V =>
        closure === "smooth"
          ? uneven[(i + n) % n]
          : i < 0
            ? sub(mul(uneven[0], 2), uneven[1])
            : i >= n
              ? sub(mul(uneven[n - 1], 2), uneven[n - 2])
              : uneven[i];
      result.spans.forEach((span, i) => {
        expect(span.source).toEqual({
          splineId: "spline",
          spanIndex: i,
          startPointId: `p${i}`,
          endPointId: `p${(i + 1) % n}`,
          startOccurrenceId: `occurrence-${i}`,
          endOccurrenceId: `occurrence-${(i + 1) % n}`,
        });
        expect(span.orientation).toBe("forward");
        expect(span.interval[0]).toBe(i ? result.spans[i - 1].interval[1] : 0);
        for (let k = 0; k <= 20; k++)
          near(
            evaluateSplineSpan(span, { kind: "local", value: k / 20 }).position,
            recursive(
              [neighbor(i - 1), neighbor(i), neighbor(i + 1), neighbor(i + 2)],
              k / 20,
            ),
          );
      });
    }
  });

  test("two points traverse a straight segment linearly and remain handle-editable", () => {
    const points: V[] = [
      [2, 3],
      [8, 9],
    ];
    const span = build(input(points)).spans[0];
    for (let k = 0; k <= 20; k++) {
      const e = evaluateSplineSpan(span, { kind: "local", value: k / 20 });
      near(e.position, add(points[0], mul(sub(points[1], points[0]), k / 20)));
      near(e.first, [6, 6]);
      near(e.second, [0, 0]);
    }
    near(build(input(points, "open", { 0: [0, 3] })).spans[0].poles[1], [2, 6]);
  });

  test("mean arms, shared derivatives, neighbor redistribution and capture without a shape jump", () => {
    const H: V = [0, 2];
    const a = build(
      input(
        [
          [0, 0],
          [1, 0],
          [10, 0],
        ],
        "open",
        { 1: H },
      ),
    );
    const b = build(
      input(
        [
          [0, 0],
          [1, 0],
          [5, 0],
        ],
        "open",
        { 1: H },
      ),
    );
    near(sub(a.spans[0].poles[3], a.spans[0].poles[2]), [0, 1]);
    near(sub(a.spans[1].poles[1], a.spans[1].poles[0]), [0, 3]);
    near(sub(b.spans[0].poles[3], b.spans[0].poles[2]), [0, 4 / 3]);
    near(sub(b.spans[1].poles[1], b.spans[1].poles[0]), [0, 8 / 3]);
    const auto = build(input());
    const captured = build(input(uneven, "open", { 2: auto.handles[2] }));
    captured.spans.forEach((span, i) =>
      span.poles.forEach((pole, j) => near(pole, auto.spans[i].poles[j])),
    );
    const authored = build(input(uneven, "smooth", { 2: H }));
    authored.spans.forEach((span, i) => {
      const next = authored.spans[(i + 1) % authored.spans.length];
      near(
        evaluateSplineSpan(span, { kind: "source", value: span.interval[1] })
          .first,
        evaluateSplineSpan(next, { kind: "source", value: next.interval[0] })
          .first,
      );
    });
  });

  test("smooth closure wraps without duplication; positional endpoints remain independent", () => {
    const points: V[] = [
      [0, 0],
      [1, 2],
      [3, 1],
    ];
    const smooth = build(input(points, "smooth"));
    expect(smooth.spans).toHaveLength(3);
    near(smooth.spans[2].poles[3], points[0]);
    const positional = build(
      input([...points, points[0]], "positional", { 0: [2, 0], 3: [0, 3] }),
    );
    near(sub(positional.spans[0].poles[1], points[0]), [2, 0]);
    near(sub(points[0], positional.spans[2].poles[2]), [0, 3]);
    expect(reconstructSpline(input(points, "positional"))).toMatchObject({
      validity: "invalid",
      diagnostics: [{ code: "positional-gap" }],
    });
  });

  test("span provenance: consecutive spans and the smooth wrap share one occurrence, knot and derivative; positional closure does not", () => {
    const points: V[] = [
      [0, 0],
      [3, 0.5],
      [2.5, 3],
      [-0.5, 2],
    ];
    const tangentAt = (poles: readonly V[], end: boolean, h: number): V =>
      end
        ? mul(sub(poles[3]!, poles[2]!), 3 / h)
        : mul(sub(poles[1]!, poles[0]!), 3 / h);
    const shared = (
      left: (typeof smooth.spans)[number],
      right: typeof left,
    ) => {
      expect(left.source.splineId).toBe(right.source.splineId);
      expect(left.source.endOccurrenceId).toBe(right.source.startOccurrenceId);
      expect(left.source.endPointId).toBe(right.source.startPointId);
      expect(Object.is(left.poles[3][0], right.poles[0][0])).toBe(true);
      expect(Object.is(left.poles[3][1], right.poles[0][1])).toBe(true);
      // One source derivative D: p2 = P - D h_i / 3 and p1 = P + D h_{i+1} / 3.
      near(
        tangentAt(left.poles, true, left.interval[1] - left.interval[0]),
        tangentAt(right.poles, false, right.interval[1] - right.interval[0]),
        1e-12,
      );
    };
    const smooth = build(input(points, "smooth"));
    smooth.spans.forEach((span, index) => {
      expect(span.source.spanIndex).toBe(index);
      if (index > 0) shared(smooth.spans[index - 1]!, span);
    });
    shared(smooth.spans.at(-1)!, smooth.spans[0]!);
    const open = build(input(points));
    for (let index = 1; index < open.spans.length; index += 1)
      shared(open.spans[index - 1]!, open.spans[index]!);
    // Positional closure aliases the canonical point through a distinct occurrence.
    const closing = input([...points, points[0]!], "positional");
    const positional = build({
      ...closing,
      points: closing.points.map((point, index) =>
        index === points.length
          ? { ...point, id: closing.points[0]!.id }
          : point,
      ),
    });
    expect(positional.spans.at(-1)!.source.endPointId).toBe(
      positional.spans[0]!.source.startPointId,
    );
    expect(positional.spans.at(-1)!.source.endOccurrenceId).not.toBe(
      positional.spans[0]!.source.startOccurrenceId,
    );
  });

  test("direct reconstruction rejects duplicate occurrence identities", () => {
    const data = input([
      [0, 0],
      [1, 1],
      [2, -3],
    ]);
    const duplicated: ResolvedSplineInput = {
      ...data,
      points: data.points.map((point, index) =>
        index === 2
          ? { ...point, occurrenceId: data.points[0]!.occurrenceId }
          : point,
      ),
    };
    expect(reconstructSpline(duplicated)).toMatchObject({
      validity: "invalid",
      spans: [],
      diagnostics: [{ code: "invalid-occurrence-order", pointIndex: 2 }],
    });
  });

  test("transforms commute, moved points carry authored vectors, distant spans are unchanged", () => {
    const H: V = [0.7, -0.4];
    const base = build(input(uneven, "open", { 2: H }));
    for (const s of [0.001, 1, 1000]) {
      const vector = ([x, y]: V): V => [-s * y, s * x];
      const point = (p: V) => add(vector(p), [123, -57]);
      const changed = build(input(uneven.map(point), "open", { 2: vector(H) }));
      changed.spans.forEach((span, i) =>
        span.poles.forEach((p, j) => near(p, point(base.spans[i].poles[j]))),
      );
    }
    const moved = build(
      input(
        uneven.map((p, i) => (i === 2 ? add(p, [0.4, 0.8]) : p)),
        "open",
        { 2: H },
      ),
    );
    near(moved.handles[2], H);
    for (const i of [4, 5])
      expect(moved.spans[i].poles).toEqual(base.spans[i].poles);
  });

  test("explicit zero persists, can recover, and reset restores automatic (not a profile-validity claim)", () => {
    const data = input(uneven, "open", { 2: [0, 0] });
    const saved = JSON.stringify(data);
    const result = build(data);
    near(result.spans[1].poles[2], uneven[2]);
    near(result.spans[2].poles[1], uneven[2]);
    near(result.handles[2], [0, 0]);
    expect(JSON.stringify(data)).toBe(saved);
    expect(build(input(uneven, "open", { 2: [1, 2] })).handles[2]).toEqual([
      1, 2,
    ]);
    const reset = {
      ...data,
      points: data.points.map((p, i) =>
        i === 2 ? { ...p, tangent: { kind: "automatic" as const } } : p,
      ),
    };
    expect(build(reset)).toEqual(build(input()));
    // Two-point wrapping is reconstructible but not a usable bounded region.
    expect(
      build(
        input(
          [
            [0, 0],
            [1, 0],
          ],
          "smooth",
        ),
      ).handles,
    ).toEqual([
      [0, 0],
      [0, 0],
    ]);
  });

  test("coincident points and non-finite/unsupported input fail explicitly without repair", () => {
    for (const closure of ["open", "smooth"] as const) {
      const data = input(
        [
          [0, 0],
          [0, 0],
          [1, 2],
        ],
        closure,
      );
      const saved = JSON.stringify(data);
      expect(reconstructSpline(data)).toMatchObject({
        validity: "invalid",
        spans: [],
        diagnostics: [{ code: "coincident-points", spanIndex: 0 }],
      });
      expect(JSON.stringify(data)).toBe(saved);
    }
    expect(reconstructSpline(input([[0, 0]]))).toMatchObject({
      validity: "invalid",
      diagnostics: [{ code: "too-few-points" }],
    });
    expect(
      reconstructSpline(
        input([
          [0, 0],
          [Infinity, 2],
        ]),
      ),
    ).toMatchObject({
      validity: "invalid",
      diagnostics: [{ code: "non-finite" }],
    });
    expect(
      reconstructSpline({
        ...input(),
        policy: "other" as ResolvedSplineInput["policy"],
      }),
    ).toMatchObject({
      validity: "invalid",
      diagnostics: [{ code: "unsupported-policy" }],
    });
    const data = input([
      [0, 0],
      [1, 1],
    ]);
    expect(
      reconstructSpline({
        ...data,
        points: data.points.map((p) => ({ ...p, id: "same" })),
      }),
    ).toMatchObject({
      validity: "invalid",
      diagnostics: [{ code: "inconsistent-point" }],
    });
    expect(
      build(
        input([
          [0, 0],
          [1e-12, 0],
        ]),
      ).spans[0].interval[1],
    ).toBe(1e-6);
  });

  test.each(["open", "smooth", "positional"] as const)(
    "analytic Jacobian columns and mixed derivatives agree with finite differences: %s",
    (closure) => {
      const points: V[] = [
        [-3, 2],
        [0, 0],
        [0.2, 0.1],
        [9, -3],
        [10, 4],
      ];
      if (closure === "positional") points.push(points[0]);
      const raw = input(points, closure, {
        0: [0.4, 0.6],
        2: [0, 0],
        4: [-0.3, 0.7],
      });
      // Repeated canonical endpoint shares coordinates but not tangent intent.
      const data =
        closure === "positional"
          ? {
              ...raw,
              points: raw.points.map((p, i) =>
                i === points.length - 1 ? { ...p, id: "p0" } : p,
              ),
            }
          : raw;
      const directions: SplineVariation[] = [];
      for (let i = 0; i < 5; i++)
        for (const v of [
          [1, 0],
          [0, 1],
        ] as V[])
          directions.push({ points: { [`p${i}`]: v } });
      for (const i of [0, 2, 4])
        for (const v of [
          [1, 0],
          [0, 1],
        ] as V[])
          directions.push({ tangents: { [i]: v } });
      directions.push({
        points: { p0: [0.3, -0.2], p2: [-0.4, 0.6] },
        tangents: { 2: [0.7, 0.2] },
      });
      const epsilon = 1e-6;
      const difference = (a: V, b: V) => mul(sub(a, b), 1 / (2 * epsilon));
      for (const direction of directions) {
        const analytic = build(data, direction),
          plus = build(perturb(data, direction, epsilon)),
          minus = build(perturb(data, direction, -epsilon));
        analytic.handles.forEach((_, i) =>
          near(
            analytic.handleDifferentials[i],
            difference(plus.handles[i], minus.handles[i]),
            2e-6,
          ),
        );
        analytic.spans.forEach((span, i) => {
          near(
            span.differential.interval,
            difference(plus.spans[i].interval, minus.spans[i].interval),
            2e-6,
          );
          span.poles.forEach((_, j) =>
            near(
              span.differential.poles[j],
              difference(plus.spans[i].poles[j], minus.spans[i].poles[j]),
              2e-6,
            ),
          );
          for (const kind of ["local", "source"] as const) {
            const value =
              kind === "local"
                ? 0.37
                : span.interval[0] +
                  0.37 * (span.interval[1] - span.interval[0]);
            for (const parameterDirection of [0, 0.23]) {
              const exact = evaluateSplineSpan(span, {
                kind,
                value,
                differential: parameterDirection,
              });
              const a = evaluateSplineSpan(plus.spans[i], {
                kind,
                value: value + epsilon * parameterDirection,
              });
              const b = evaluateSplineSpan(minus.spans[i], {
                kind,
                value: value - epsilon * parameterDirection,
              });
              for (const key of ["position", "first", "second"] as const)
                near(exact.differential[key], difference(a[key], b[key]), 3e-5);
            }
          }
        });
      }
    },
  );

  test("closest location compares every stationary candidate across and within spans", () => {
    const points: V[] = [
      [0, 0],
      [1, -0.28642033599317074],
      [2, -0.8654971411451697],
    ];
    const geometry = build(
      input(points, "open", {
        0: [3.0955284759402275, -3.686498027294874],
        1: [7.648204565048218, 7.480724450200796],
        2: [0.6425580456852913, 5.708081874996424],
      }),
    );
    const closest = closestSplineSpanLocation(
      [0.3154072277247906, -1.2599992523901165],
      geometry.spans,
    );
    expect(closest?.spanIndex).toBe(0);
    expect(closest?.u).toBeCloseTo(0.9592206079, 8);
    expect(closest?.distanceSquared).toBeCloseTo(0.03953738724, 9);

    const secondSpanPoint = evaluateSplineSpan(geometry.spans[1], {
      kind: "local",
      value: 0.73,
    }).position;
    const acrossSpans = closestSplineSpanLocation(
      secondSpanPoint,
      geometry.spans,
    );
    expect(acrossSpans?.spanIndex).toBe(1);
    expect(acrossSpans?.u).toBeCloseTo(0.73, 9);
  });

  test("T08b-g2: domains restrict the search to each span's local sub-interval (a trimmed tail never binds); the default domains are the unrestricted search", () => {
    const points: V[] = [
      [0, 0],
      [1, -0.28642033599317074],
      [2, -0.8654971411451697],
    ];
    const geometry = build(
      input(points, "open", {
        0: [3.0955284759402275, -3.686498027294874],
        1: [7.648204565048218, 7.480724450200796],
        2: [0.6425580456852913, 5.708081874996424],
      }),
    );
    const query: V = [0.3154072277247906, -1.2599992523901165];
    const free = closestSplineSpanLocation(query, geometry.spans);
    expect(
      closestSplineSpanLocation(query, geometry.spans, [
        [0, 1],
        [0, 1],
      ]),
    ).toEqual(free);
    // Span 0's minimum (u ≈ 0.959) lies beyond a trim at u = 0.5: the
    // restricted search binds at the domain end or on span 1, never the tail.
    const restricted = closestSplineSpanLocation(query, geometry.spans, [
      [0, 0.5],
      [0, 1],
    ]);
    expect(restricted).not.toBeNull();
    expect(
      restricted!.spanIndex === 1 ||
        (restricted!.spanIndex === 0 && restricted!.u <= 0.5),
    ).toBe(true);
    const spanOnly = closestSplineSpanLocation(query, geometry.spans, [
      [0, 0.5],
      undefined,
    ]);
    expect(spanOnly?.spanIndex).toBe(0);
    expect(spanOnly!.u).toBeLessThanOrEqual(0.5);
    expect(spanOnly!.distanceSquared).toBeGreaterThan(free!.distanceSquared);
    // An interior stationary point inside the domain is still found.
    const inside = evaluateSplineSpan(geometry.spans[1], {
      kind: "local",
      value: 0.73,
    }).position;
    expect(
      closestSplineSpanLocation(inside, geometry.spans, [
        [0, 1],
        [0.25, 0.9],
      ])?.u,
    ).toBeCloseTo(0.73, 9);
    // An empty or inverted domain skips its span.
    expect(
      closestSplineSpanLocation(inside, geometry.spans, [
        undefined,
        [0.9, 0.2],
      ]),
    ).toBeNull();
  });

  test("closest location preserves representably distinct roots beside endpoints", () => {
    const zeroDifferential = {
      interval: [0, 0] as const,
      poles: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ] as const,
    };
    const span = {
      interval: [0, 1] as const,
      poles: [
        [0, 0],
        [0, 1e12],
        [0, -1e12],
        [0, 0],
      ] as const,
      differential: zeroDifferential,
    };

    for (const scale of [1, 1e-9, 1e9]) {
      const scaledSpan = {
        ...span,
        poles: span.poles.map(
          ([x, y]) => [x * scale, y * scale] as const,
        ) as unknown as typeof span.poles,
      };
      for (const query of [
        [0, 0.001 * scale],
        [0, scale],
      ] as const) {
        const closest = closestSplineSpanLocation(query, [scaledSpan]);
        expect(closest?.u).toBeGreaterThan(0);
        expect(closest!.distanceSquared / scale ** 2).toBeLessThanOrEqual(
          Number.EPSILON ** 2,
        );
        if (scale === 1) expect(closest?.distanceSquared).toBe(0);
      }
    }

    for (const scale of [1e145, 1e200, 1e-200]) {
      const scaledSpan = {
        ...span,
        poles: span.poles.map(
          ([x, y]) => [x * scale, y * scale] as const,
        ) as unknown as typeof span.poles,
      };
      const closest = closestSplineSpanLocation([0, scale], [scaledSpan]);
      expect(closest).not.toBeNull();
      expect(closest!.u).toBeGreaterThan(0);
      expect(Math.abs(closest!.u - 1 / 3e12) / (1 / 3e12)).toBeLessThan(1e-3);
      expect(closest!.distanceSquared).toBe(0);
    }
  });

  test("closest location reports representable numeric limits for unrepresentable squared distances", () => {
    const constantSpan = (x: number, y = 0) => ({
      interval: [0, 1] as const,
      poles: [
        [x, y],
        [x, y],
        [x, y],
        [x, y],
      ] as const,
      differential: {
        interval: [0, 0] as const,
        poles: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ] as const,
      },
    });

    expect(closestSplineSpanLocation([0, 0], [constantSpan(1e200)])).toEqual({
      spanIndex: 0,
      u: 0,
      distanceSquared: Number.POSITIVE_INFINITY,
    });
    expect(closestSplineSpanLocation([0, 0], [constantSpan(1e-200)])).toEqual({
      spanIndex: 0,
      u: 0,
      distanceSquared: Number.MIN_VALUE,
    });
    expect(
      closestSplineSpanLocation(
        [0, 0],
        [constantSpan(1e200), constantSpan(1e-200)],
      ),
    ).toEqual({ spanIndex: 1, u: 0, distanceSquared: Number.MIN_VALUE });

    const mixedAxisSpan = {
      ...constantSpan(0, 1e-200),
      poles: [
        [0, 1e-200],
        [1e200, 1e-200],
        [-1e200, 1e-200],
        [0, 1e-200],
      ] as const,
    };
    expect(closestSplineSpanLocation([0, 0], [mixedAxisSpan])).toMatchObject({
      spanIndex: 0,
      distanceSquared: Number.MIN_VALUE,
    });
  });

  test("closest location retains repeated stationary roots", () => {
    const repeatedMinimum = {
      interval: [0, 1] as const,
      poles: [
        [0.25, 0],
        [-1 / 12, 0],
        [-1 / 12, 0],
        [0.25, 0],
      ] as const,
      differential: {
        interval: [0, 0] as const,
        poles: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ] as const,
      },
    };
    const closest = closestSplineSpanLocation([0, 0], [repeatedMinimum]);
    expect(closest?.u).toBeCloseTo(0.5, 7);
    expect(closest?.distanceSquared).toBeLessThan(Number.EPSILON ** 4);
  });

  test("owner evaluation is stable under common translation", () => {
    const differential = {
      interval: [0.2, -0.1] as const,
      poles: [
        [0.3, -0.2],
        [-0.4, 0.5],
        [0.7, -0.6],
        [-0.8, 0.9],
      ] as const,
    };
    const poles = [
      [0, 0],
      [0, 1e12],
      [0, -1e12],
      [0, 0],
    ] as const;
    const translatedPoles = poles.map(
      ([x, y]) => [x + 1e9, y - 2e9] as const,
    ) as unknown as typeof poles;
    const base = { interval: [2, 5] as const, poles, differential };
    const translated = { ...base, poles: translatedPoles };

    for (const kind of ["local", "source"] as const) {
      const value = kind === "local" ? 0.37 : 3.11;
      const first = evaluateSplineSpan(base, {
        kind,
        value,
        differential: 0.13,
      });
      const second = evaluateSplineSpan(translated, {
        kind,
        value,
        differential: 0.13,
      });
      near(
        [second.position[0] - 1e9, second.position[1] + 2e9],
        first.position,
        1e-7,
      );
      near(second.first, first.first, 1e-7);
      near(second.second, first.second, 1e-7);
      near(second.differential.position, first.differential.position, 1e-7);
      near(second.differential.first, first.differential.first, 1e-7);
      near(second.differential.second, first.differential.second, 1e-7);
    }

    const closest = closestSplineSpanLocation([1e9, -2e9 + 1], [translated]);
    expect(closest?.distanceSquared).toBe(0);
  });

  test("closest location includes seams, endpoints, and zero-derivative cubics", () => {
    const wrapped = build(
      input(
        [
          [0, 0],
          [2, 0],
          [1, 2],
        ],
        "smooth",
      ),
    );
    const seam = closestSplineSpanLocation([0, 0], wrapped.spans);
    expect(seam?.distanceSquared).toBeLessThan(1e-20);

    const zero = {
      interval: [0, 1] as const,
      poles: [
        [2, 3],
        [2, 3],
        [2, 3],
        [2, 3],
      ] as const,
      differential: {
        interval: [0, 0] as const,
        poles: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ] as const,
      },
    };
    const stationaryEverywhere = closestSplineSpanLocation([5, 7], [zero]);
    expect(stationaryEverywhere).toMatchObject({
      spanIndex: 0,
      u: 0,
      distanceSquared: 25,
    });
    const endpoint = closestSplineSpanLocation(
      [3, 0],
      [
        {
          ...zero,
          poles: [
            [0, 0],
            [1, 0],
            [2, 0],
            [3, 0],
          ] as const,
        },
      ],
    );
    expect(endpoint).toMatchObject({ spanIndex: 0, u: 1, distanceSquared: 0 });
  });

  test("parameter derivatives and source/local mapping agree independently", () => {
    const span = build(input(uneven, "open", { 2: [0.2, -0.4] })).spans[2];
    for (const kind of ["local", "source"] as const) {
      const value =
        kind === "local"
          ? 0.41
          : span.interval[0] + 0.41 * (span.interval[1] - span.interval[0]);
      const epsilon = 1e-5;
      const a = evaluateSplineSpan(span, { kind, value: value + epsilon }),
        b = evaluateSplineSpan(span, { kind, value: value - epsilon }),
        exact = evaluateSplineSpan(span, { kind, value });
      near(
        exact.first,
        mul(sub(a.position, b.position), 1 / (2 * epsilon)),
        1e-7,
      );
      near(exact.second, mul(sub(a.first, b.first), 1 / (2 * epsilon)), 1e-7);
      near(
        exact.position,
        evaluateSplineSpan(span, { kind: "local", value: 0.41 }).position,
      );
    }
    expect(() =>
      evaluateSplineSpan(span, { kind: "local", value: NaN }),
    ).toThrow(RangeError);
    expect(() =>
      evaluateSplineSpan(span, { kind: "local", value: 1.1 }),
    ).toThrow(RangeError);
  });

  // T10f (review A6): the pick/snap closest point with a pole-box prefilter.
  test("closestPointOnSolvedCubicSpans returns the unfiltered owner search on drawn domains; the pole box is exact and conservative", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const zeroDifferential = {
      interval: [0, 0] as const,
      poles: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ] as const,
    };
    let pruned = 0;
    for (let trial = 0; trial < 200; trial += 1) {
      const fit: V[] = Array.from({ length: 3 + (trial % 30) }, (_, i) => [
        i * 2 + random(),
        Math.sin(i) * 3 + random() * 4 - 2,
      ]);
      const spans: SolvedCubicSpan[] = build(input(fit)).spans.map(
        (span, index, all) =>
          // Trim the first and last span like a derived shell (queryDomain).
          trial % 2 === 1 && (index === 0 || index === all.length - 1)
            ? {
                interval: span.interval,
                poles: span.poles,
                queryDomain:
                  index === 0
                    ? [
                        span.interval[0] +
                          0.3 * (span.interval[1] - span.interval[0]),
                        span.interval[1],
                      ]
                    : [
                        span.interval[0],
                        span.interval[0] +
                          0.6 * (span.interval[1] - span.interval[0]),
                      ],
              }
            : { interval: span.interval, poles: span.poles },
      );
      const query: V = [random() * 70 - 5, random() * 14 - 7];
      const unfiltered = closestSplineSpanLocation(
        query,
        spans.map((span) => ({ ...span, differential: zeroDifferential })),
        spans.map(solvedCubicSpanLocalDomain),
      );
      const found = closestPointOnSolvedCubicSpans(query, spans);
      expect(
        found && { spanIndex: found.spanIndex, u: found.u },
        `trial ${trial}: the prefiltered search is the unfiltered one`,
      ).toEqual(
        unfiltered && { spanIndex: unfiltered.spanIndex, u: unfiltered.u },
      );
      const point = solvedCubicSpanPoint(spans[found!.spanIndex]!, found!.u);
      expect(found!.point).toEqual(point);
      expect(found!.distance).toBe(Math.hypot(...sub(point, query)));
      // Spans the prefilter skips (box farther than the nearest drawn end).
      const ends = spans.flatMap((span) =>
        solvedCubicSpanLocalDomain(span).map((u) =>
          Math.hypot(...sub(solvedCubicSpanPoint(span, u), query)),
        ),
      );
      pruned += spans.filter((span) => {
        const box = cubicSpansPoleBounds([span])!;
        const gap = Math.hypot(
          Math.max(box.min[0] - query[0], 0, query[0] - box.max[0]),
          Math.max(box.min[1] - query[1], 0, query[1] - box.max[1]),
        );
        return gap > Math.min(...ends) * (1 + 1e-6);
      }).length;
      // The pole box contains every drawn point of every span.
      const box = cubicSpansPoleBounds(spans)!;
      for (const [x, y] of tessellateCubicSpans(spans, 64))
        expect(
          x >= box.min[0] &&
            x <= box.max[0] &&
            y >= box.min[1] &&
            y <= box.max[1],
        ).toBe(true);
    }
    expect(
      pruned,
      "premise: the prefilter actually skips spans",
    ).toBeGreaterThan(1000);
    expect(cubicSpansPoleBounds([])).toBeNull();
  });

  test("closestPointOnSolvedCubicSpans with maxDistance keeps any result within it and skips spans beyond it", () => {
    const spans: SolvedCubicSpan[] = build(
      input([
        [0, 0],
        [4, 3],
        [8, 0],
        [12, 3],
      ]),
    ).spans;
    const query: V = [4, 3.1];
    const free = closestPointOnSolvedCubicSpans(query, spans)!;
    expect(free.distance).toBeLessThan(0.2);
    expect(closestPointOnSolvedCubicSpans(query, spans, 0.2)).toEqual(free);
    expect(
      closestPointOnSolvedCubicSpans([4, 30], spans, 0.2),
      "every span's box is beyond maxDistance",
    ).toBeNull();
  });
});

// T10g-3a: option B (fixed end-span parameter lengths) and the Trim builder.
type Fields = ResolvedSplineInput["endSpanParameterLengths"];
type Closure = ResolvedSplineInput["closure"];
interface EditSpline {
  readonly aggregate: AuthoredSplineAggregate;
  readonly positions: Readonly<Record<string, V>>;
}
/** An aggregate over `points`; a positional closure aliases its last occurrence to p0. */
function editSpline(
  points: readonly V[],
  closure: Closure = "open",
  handles: Readonly<Record<number, V>> = {},
  endSpanParameterLengths?: Fields,
): EditSpline {
  const pointId = (i: number) =>
    closure === "positional" && i === points.length - 1 ? "p0" : `p${i}`;
  return {
    aggregate: {
      entityId: "spline",
      pointOccurrenceIds: points.map((_, i) => `occ-${i}`),
      pointOccurrences: points.map((_, i) => ({
        occurrenceId: `occ-${i}`,
        pointId: pointId(i),
        tangent: handles[i]
          ? { kind: "authored" as const, vector: handles[i]! }
          : { kind: "automatic" as const },
      })),
      closure,
      interpolationPolicy: "centripetal-mean-arm-v1",
      ...(endSpanParameterLengths ? { endSpanParameterLengths } : {}),
    },
    positions: Object.fromEntries(points.map((p, i) => [pointId(i), p])),
  };
}
/** The piece as an aggregate: cut points become new occurrences and points. */
function pieceSpline(piece: SplinePiece, positions: EditSpline["positions"]) {
  const next = { ...positions };
  const occurrences = piece.occurrences.map((occurrence, index) => {
    if (occurrence.kind === "original")
      return {
        occurrenceId: occurrence.occurrenceId,
        pointId: occurrence.pointId,
        tangent: occurrence.tangent,
      };
    next[`q-${index}`] = occurrence.position;
    return {
      occurrenceId: `cut-${index}`,
      pointId: `q-${index}`,
      tangent: occurrence.tangent,
    };
  });
  return {
    aggregate: {
      entityId: "piece",
      pointOccurrenceIds: occurrences.map((entry) => entry.occurrenceId),
      pointOccurrences: occurrences,
      closure: "open" as const,
      interpolationPolicy: "centripetal-mean-arm-v1" as const,
      ...(piece.endSpanParameterLengths
        ? { endSpanParameterLengths: piece.endSpanParameterLengths }
        : {}),
    },
    positions: next,
  };
}
function valid(geometry: SplineGeometry) {
  if (geometry.validity !== "valid")
    throw new Error(JSON.stringify(geometry.diagnostics));
  return geometry;
}
const geometryOf = ({ aggregate, positions }: EditSpline) =>
  valid(reconstructSplineAggregate(aggregate, positions));
const knotsOf = (spans: readonly SplineSpan[]) => [
  ...spans.map((span) => span.interval[0]),
  spans.at(-1)!.interval[1],
];
/** A cut at fraction f of span k (strictly inside), or exactly on knot j. */
const cutIn = (spans: readonly SplineSpan[], k: number, f: number) => ({
  representative:
    spans[k]!.interval[0] + f * (spans[k]!.interval[1] - spans[k]!.interval[0]),
  knotOccurrenceIndex: null,
});
const cutAtKnot = (spans: readonly SplineSpan[], j: number) => ({
  representative: spans[j]!.interval[0],
  knotOccurrenceIndex: j,
});
/** Owner evaluation of the original at its source parameter t. */
function originalAt(spans: readonly SplineSpan[], t: number): V {
  const span = spans.find(
    (entry) => entry.interval[0] <= t && t <= entry.interval[1],
  )!;
  return evaluateSplineSpan(span, { kind: "source", value: t }).position;
}
/**
 * Every piece span at 64 parameters (65 points) vs the original's owner
 * evaluation at tFrom + t, ≤ 1e-12·scale (design §4.6: positions, never pole
 * bitwise equality). Returns the relative error.
 */
function expectReproduces(
  original: readonly SplineSpan[],
  piece: readonly SplineSpan[],
  tFrom: number,
  tTo: number,
) {
  const scale = Math.max(
    ...original.flatMap((span) =>
      span.poles.flatMap((pole) => pole.map(Math.abs)),
    ),
  );
  let worst = 0;
  for (const span of piece)
    for (let step = 0; step <= 64; step++) {
      const u = step / 64;
      const t = Math.min(
        tTo,
        tFrom + span.interval[0] + u * (span.interval[1] - span.interval[0]),
      );
      const here = evaluateSplineSpan(span, { kind: "local", value: u });
      worst = Math.max(
        worst,
        Math.hypot(...sub(here.position, originalAt(original, t))),
      );
    }
  expect(worst / scale).toBeLessThanOrEqual(1e-12);
  expect(piece.at(-1)!.interval[1]).toBeCloseTo(tTo - tFrom, 12);
  return worst / scale;
}
/** Builds the piece [from, to], reconstructs it and checks it reproduces the original. */
function checkedPiece(
  spline: EditSpline,
  from: SplineCut | null,
  to: SplineCut | null,
) {
  const original = geometryOf(spline).spans;
  const piece = splineAggregatePiece(
    spline.aggregate,
    spline.positions,
    from,
    to,
  )!;
  const geometry = geometryOf(pieceSpline(piece, spline.positions));
  expectReproduces(
    original,
    geometry.spans,
    from?.representative ?? 0,
    to?.representative ?? original.at(-1)!.interval[1],
  );
  return { piece, geometry, original };
}
/** Independent oracle: de Casteljau split of one cubic at u → [left, right] poles. */
function deCasteljau(poles: readonly V[], u: number): [V[], V[]] {
  const lerp = (a: V, b: V) => add(a, mul(sub(b, a), u));
  const [p0, p1, p2, p3] = poles as [V, V, V, V];
  const a = lerp(p0, p1),
    b = lerp(p1, p2),
    c = lerp(p2, p3);
  const d = lerp(a, b),
    e = lerp(b, c);
  const f = lerp(d, e);
  return [
    [p0, a, d, f],
    [f, e, c, p3],
  ];
}
/** P-g1 open fixture: one authored interior point (P3). */
const pg1: V[] = [
  [0, 0],
  [1, 2],
  [3, 2.5],
  [4.2, 0.3],
  [6, 1],
  [7.5, -1],
  [9, 0.4],
];
const pg1Handles = { 3: [0.9, -0.4] as V };
/** R-g1 open fixture (review): all automatic. */
const rg1: V[] = [
  [0, 0],
  [1.3, 2.1],
  [3.2, 2.6],
  [4.1, 0.4],
  [6.3, -1.1],
  [7.9, 1.7],
  [9.4, 0.2],
];
/**
 * FD oracle plan (design §4.2): columns are every canonical coordinate and
 * every authored handle component; analytic pole and interval differentials
 * vs central differences at ε = 1e-6·scale, within 1e-7·max(1, |FD|); a
 * fixed span's interval differential is exactly 0.
 */
function expectFixedSpanJacobian(data: ResolvedSplineInput) {
  const scale = Math.max(
    1,
    ...data.points.flatMap((point) => point.position.map(Math.abs)),
  );
  const epsilon = 1e-6 * scale;
  const columns: SplineVariation[] = [];
  for (const id of new Set(data.points.map((point) => point.id)))
    for (const unit of [
      [1, 0],
      [0, 1],
    ] as V[])
      columns.push({ points: { [id]: unit } });
  data.points.forEach((point, i) => {
    if (point.tangent.kind === "authored")
      for (const unit of [
        [1, 0],
        [0, 1],
      ] as V[])
        columns.push({ tangents: { [i]: unit } });
  });
  const within = (analytic: number, fd: number) =>
    expect(Math.abs(analytic - fd)).toBeLessThanOrEqual(
      1e-7 * Math.max(1, Math.abs(fd)),
    );
  const fixed = data.endSpanParameterLengths!;
  for (const column of columns) {
    const analytic = build(data, column),
      plus = build(perturb(data, column, epsilon)),
      minus = build(perturb(data, column, -epsilon));
    analytic.spans.forEach((span, i) => {
      for (const side of [0, 1])
        within(
          span.differential.interval[side]!,
          (plus.spans[i]!.interval[side]! - minus.spans[i]!.interval[side]!) /
            (2 * epsilon),
        );
      span.differential.poles.forEach((pole, j) =>
        pole.forEach((value, axis) =>
          within(
            value,
            (plus.spans[i]!.poles[j]![axis]! -
              minus.spans[i]!.poles[j]![axis]!) /
              (2 * epsilon),
          ),
        ),
      );
    });
    const fixedSpans = [
      ...(fixed.start === undefined ? [] : [analytic.spans[0]!]),
      ...(fixed.end === undefined ? [] : [analytic.spans.at(-1)!]),
    ];
    for (const span of fixedSpans)
      expect(
        span.differential.interval[1] - span.differential.interval[0],
      ).toBe(0);
  }
  return columns.length;
}

describe("option B: fixed end-span parameter lengths (T10g-3a)", () => {
  test("an absent field (or an empty object) reconstructs exactly as before", () => {
    for (const closure of ["open", "smooth"] as const) {
      const data = input(uneven, closure, { 2: [0.7, -0.4] });
      const plain = JSON.stringify(reconstructSpline(data));
      expect(
        JSON.stringify(
          reconstructSpline({ ...data, endSpanParameterLengths: undefined }),
        ),
      ).toBe(plain);
      expect(
        JSON.stringify(
          reconstructSpline({ ...data, endSpanParameterLengths: {} }),
        ),
      ).toBe(plain);
    }
  });

  test("a fixed length replaces that end span's centripetal length as a constant", () => {
    const fixed = build({
      ...input(uneven, "open", { 2: [0.7, -0.4] }),
      endSpanParameterLengths: { start: 1.25, end: 0.5 },
    });
    const plain = build(input(uneven, "open", { 2: [0.7, -0.4] }));
    expect(fixed.spans[0]!.interval).toEqual([0, 1.25]);
    const last = fixed.spans.at(-1)!;
    expect(last.interval[1] - last.interval[0]).toBeCloseTo(0.5, 12);
    // Spans whose arms don't involve a fixed span are bitwise unchanged.
    for (const i of [2, 3])
      expect(fixed.spans[i]!.poles).toEqual(plain.spans[i]!.poles);
    expect(fixed.spans[0]!.poles).not.toEqual(plain.spans[0]!.poles);
    // Coincidence is still judged on the chord (no implicit repair).
    expect(
      reconstructSpline({
        ...input([
          [0, 0],
          [0, 0],
          [1, 2],
        ]),
        endSpanParameterLengths: { start: 1 },
      }),
    ).toMatchObject({
      validity: "invalid",
      diagnostics: [{ code: "coincident-points", spanIndex: 0 }],
    });
  });

  test("each numeric rule rejects with invalid-end-span-parameter-length", () => {
    const two: V[] = [
      [0, 0],
      [5, 3],
    ];
    const rejected: [string, ResolvedSplineInput][] = [
      ["NaN", { ...input(), endSpanParameterLengths: { start: Number.NaN } }],
      [
        "infinite",
        {
          ...input(),
          endSpanParameterLengths: { end: Number.POSITIVE_INFINITY },
        },
      ],
      ["zero", { ...input(), endSpanParameterLengths: { start: 0 } }],
      ["negative", { ...input(), endSpanParameterLengths: { end: -1 } }],
      [
        "smooth closure",
        { ...input(uneven, "smooth"), endSpanParameterLengths: { start: 1 } },
      ],
      [
        "one span, unequal keys",
        { ...input(two), endSpanParameterLengths: { start: 1, end: 2 } },
      ],
      [
        "one span, keys differ by one ulp",
        {
          ...input(two),
          endSpanParameterLengths: { start: 2, end: 2 + Number.EPSILON * 2 },
        },
      ],
    ];
    for (const [name, data] of rejected)
      expect(reconstructSpline(data), name).toEqual({
        validity: "invalid",
        diagnostics: [{ code: "invalid-end-span-parameter-length" }],
        spans: [],
      });
    const accepted: [string, ResolvedSplineInput][] = [
      [
        "one span, equal keys",
        { ...input(two), endSpanParameterLengths: { start: 2, end: 2 } },
      ],
      [
        "one span, one key",
        { ...input(two), endSpanParameterLengths: { end: 2 } },
      ],
      [
        "positional closure",
        {
          ...input([...uneven, uneven[0]!], "positional"),
          endSpanParameterLengths: { start: 1, end: 3 },
        },
      ],
    ];
    for (const [name, data] of accepted)
      expect(reconstructSpline(data).validity, name).toBe("valid");
    expect(
      build({ ...input(two), endSpanParameterLengths: { start: 2, end: 2 } })
        .spans[0]!.interval,
    ).toEqual([0, 2]);
  });

  test("FD Jacobian with fixed spans: open (both), positional, single span; fixed-span interval differential is exactly 0", () => {
    const pg1Spline = editSpline(pg1, "open", pg1Handles);
    const spans = geometryOf(pg1Spline).spans;
    const T = spans.at(-1)!.interval[1];
    const middle = splineAggregatePiece(
      pg1Spline.aggregate,
      pg1Spline.positions,
      { representative: 0.12 * T, knotOccurrenceIndex: null },
      { representative: 0.88 * T, knotOccurrenceIndex: null },
    )!;
    expect(middle.endSpanParameterLengths).toEqual({
      start: expect.any(Number),
      end: expect.any(Number),
    });
    const asInput = (spline: ReturnType<typeof pieceSpline>) => {
      const ordered = spline.aggregate.pointOccurrences;
      return {
        id: "piece",
        policy: "centripetal-mean-arm-v1" as const,
        closure: "open" as const,
        endSpanParameterLengths: spline.aggregate.endSpanParameterLengths,
        points: ordered.map((occurrence) => ({
          occurrenceId: occurrence.occurrenceId,
          id: occurrence.pointId,
          position: spline.positions[occurrence.pointId]!,
          tangent: occurrence.tangent,
        })),
      };
    };
    const loop: V[] = [
      [0, 0],
      [2, 1],
      [3, 3],
      [1, 4],
      [-1, 2],
      [0, 0],
    ];
    const positionalRaw = input(loop, "positional", {
      0: [0.5, 0.2],
      2: [-0.3, 0.6],
    });
    const cases: [string, ResolvedSplineInput, number][] = [
      // 7 points (14 coordinates) + authored Q₁, Q₂, P₁, P₃, P₅ (10 components).
      [
        "open trim piece, both fields",
        asInput(pieceSpline(middle, pg1Spline.positions)),
        24,
      ],
      [
        "open, end field only, automatic interior",
        // R-g1 points: `uneven`'s 0.022 chord is too short for ε = 1e-6·scale.
        { ...input(rg1), endSpanParameterLengths: { end: 1.7 } },
        14,
      ],
      [
        "positional, both fields",
        {
          ...positionalRaw,
          points: positionalRaw.points.map((point, i) =>
            i === loop.length - 1 ? { ...point, id: "p0" } : point,
          ),
          endSpanParameterLengths: { start: 1.1, end: 0.9 },
        },
        14,
      ],
      [
        "single span, both fields equal",
        {
          ...input(
            [
              [0, 0],
              [5, 3],
            ],
            "open",
            { 0: [1, 0.5], 1: [2, -1] },
          ),
          endSpanParameterLengths: { start: 2.2, end: 2.2 },
        },
        8,
      ],
    ];
    for (const [name, data, columns] of cases)
      expect(expectFixedSpanJacobian(data), name).toBe(columns);
  });

  test("P-g1: Trim pieces A and B, start/end trims and an authored neighbour reproduce the original sub-curve", () => {
    const spline = editSpline(pg1, "open", pg1Handles);
    const original = geometryOf(spline).spans;
    const T = original.at(-1)!.interval[1];
    const at = (f: number) => ({
      representative: f * T,
      knotOccurrenceIndex: null,
    });
    const a = checkedPiece(spline, null, at(0.41));
    expect(Object.keys(a.piece.endSpanParameterLengths!)).toEqual(["end"]);
    const b = checkedPiece(spline, at(0.67), null);
    expect(Object.keys(b.piece.endSpanParameterLengths!)).toEqual(["start"]);
    checkedPiece(spline, at(0.03), null);
    checkedPiece(spline, null, at(0.97));
    // P₃ (authored) is the neighbour of a cut in span 2: re-expressed with its new arm.
    const neighbour = checkedPiece(spline, at(0.47), null);
    const k = original.findIndex(
      (span) => span.interval[0] < 0.47 * T && 0.47 * T < span.interval[1],
    );
    expect(neighbour.piece.occurrences[1]).toMatchObject({
      kind: "original",
      occurrenceId: `occ-${k + 1}`,
      tangent: { kind: "authored" },
    });
    expect(neighbour.piece.occurrences[1]!.tangent).not.toEqual({
      kind: "authored",
      vector: pg1Handles[3],
    });
    // The new end Q: S(t*) with the handle S′(t*)·Δ/3, Δ the fixed field.
    const cut = neighbour.piece.occurrences[0]!;
    const span = original[k]!;
    const exact = evaluateSplineSpan(span, { kind: "source", value: 0.47 * T });
    const delta = span.interval[1] - 0.47 * T;
    expect(neighbour.piece.endSpanParameterLengths).toEqual({ start: delta });
    expect(cut).toEqual({
      kind: "cut",
      position: exact.position,
      tangent: { kind: "authored", vector: mul(exact.first, delta / 3) },
    });
  });

  test("open pieces carry an original start/end field bitwise; the untouched end span keeps the original poles", () => {
    const spline = editSpline(pg1, "open", pg1Handles, {
      start: 1.3,
      end: 0.9,
    });
    const original = geometryOf(spline).spans;
    // Piece B [c₂, end]: the original end span is untouched.
    const b = checkedPiece(spline, cutIn(original, 2, 0.4), null);
    expect(b.piece.endSpanParameterLengths!.end).toBe(0.9);
    expect(b.piece.endSpanParameterLengths!.start).toBe(
      original[2]!.interval[1] - cutIn(original, 2, 0.4).representative,
    );
    expect(b.geometry.spans.at(-1)!.poles).toEqual(original.at(-1)!.poles);
    // Piece A [start, c₁]: the original start span is untouched.
    const a = checkedPiece(spline, null, cutIn(original, 3, 0.6));
    expect(a.piece.endSpanParameterLengths!.start).toBe(1.3);
    expect(a.geometry.spans[0]!.poles).toEqual(original[0]!.poles);
  });

  test("P-g1: the cut end span's poles equal an independent de Casteljau split", () => {
    const spline = editSpline(pg1, "open", pg1Handles);
    const original = geometryOf(spline).spans;
    const t = 0.41 * original.at(-1)!.interval[1];
    const k = original.findIndex(
      (span) => span.interval[0] < t && t < span.interval[1],
    );
    const span = original[k]!;
    const [left] = deCasteljau(
      span.poles,
      (t - span.interval[0]) / (span.interval[1] - span.interval[0]),
    );
    const { geometry } = checkedPiece(spline, null, {
      representative: t,
      knotOccurrenceIndex: null,
    });
    geometry.spans
      .at(-1)!
      .poles.forEach((pole, j) => near(pole, left[j]!, 1e-14));
  });

  test("P-g1: a knot cut adds no point and no field; P_j becomes the end with H = D_j·h/3", () => {
    const spline = editSpline(pg1, "open", pg1Handles);
    const original = geometryOf(spline).spans;
    const { piece, geometry } = checkedPiece(
      spline,
      cutAtKnot(original, 3),
      null,
    );
    expect(piece.endSpanParameterLengths).toBeUndefined();
    expect(piece.occurrences.map((entry) => entry.kind)).toEqual([
      "original",
      "original",
      "original",
      "original",
    ]);
    // P₃ was authored; as the new start its handle is D₃·h₃/3 (endpoint arm),
    // i.e. the original span 3's first pole arm.
    near(
      (piece.occurrences[0]!.tangent as { vector: V }).vector,
      sub(original[3]!.poles[1], original[3]!.poles[0]),
      1e-14,
    );
    // Spans away from the re-expressed point are bitwise the original's.
    expect(geometry.spans[1]!.poles).toEqual(original[4]!.poles);
    expect(geometry.spans[2]!.poles).toEqual(original[5]!.poles);
  });

  test("P-g1: a single span trimmed twice keeps both fields equal to its one length", () => {
    const spline = editSpline(
      [
        [0, 0],
        [5, 3],
      ],
      "open",
      { 1: [2, -1] },
    );
    const original = geometryOf(spline).spans;
    const T = original[0]!.interval[1];
    const first = checkedPiece(spline, cutIn(original, 0, 0.2), null);
    expect(first.piece.endSpanParameterLengths).toEqual({ start: T - 0.2 * T });
    const once = pieceSpline(first.piece, spline.positions);
    const T1 = geometryOf(once).spans[0]!.interval[1];
    const second = splineAggregatePiece(once.aggregate, once.positions, null, {
      representative: 0.7 * T1,
      knotOccurrenceIndex: null,
    })!;
    expect(second.endSpanParameterLengths).toEqual({
      start: 0.7 * T1,
      end: 0.7 * T1,
    });
    expectReproduces(
      original,
      geometryOf(pieceSpline(second, once.positions)).spans,
      0.2 * T,
      0.2 * T + 0.7 * T1,
    );
    // Both cuts in one span at once: every present key is t_to − t_from.
    const both = checkedPiece(
      spline,
      cutIn(original, 0, 0.25),
      cutIn(original, 0, 0.6),
    );
    expect(both.piece.endSpanParameterLengths).toEqual({
      start: 0.6 * T - 0.25 * T,
      end: 0.6 * T - 0.25 * T,
    });
  });

  test("R-g1: middle pieces (adjacent spans sharing a neighbour, spans 0/4 and 0/5, cuts 1e-9 from knots)", () => {
    const spline = editSpline(rg1);
    const original = geometryOf(spline).spans;
    // Adjacent spans: P₂ is the one re-expressed neighbour of both cuts, w′ = (Δ₁ + Δ₂)/2.
    const adjacent = checkedPiece(
      spline,
      cutIn(original, 1, 0.37),
      cutIn(original, 2, 0.61),
    );
    expect(adjacent.piece.occurrences.map((entry) => entry.kind)).toEqual([
      "cut",
      "original",
      "cut",
    ]);
    checkedPiece(spline, cutIn(original, 0, 0.2), cutIn(original, 4, 0.8));
    const wide = checkedPiece(
      spline,
      cutIn(original, 0, 0.2),
      cutIn(original, 5, 0.7),
    );
    // P₁ and P₅ re-expressed; P₂…P₄ stay automatic and span P₂→P₃ is bitwise.
    expect(wide.piece.occurrences.map((entry) => entry.tangent.kind)).toEqual([
      "authored",
      "authored",
      "automatic",
      "automatic",
      "automatic",
      "authored",
      "authored",
    ]);
    expect(wide.geometry.spans[2]!.poles).toEqual(original[2]!.poles);
    checkedPiece(
      spline,
      cutIn(original, 2, 1 - 1e-9),
      cutIn(original, 3, 1e-9),
    );
  });

  test("A-8: a cut 1e-9 from a knot gives a micro end span the builder doesn't refuse", () => {
    const spline = editSpline(rg1);
    const original = geometryOf(spline).spans;
    const knots = knotsOf(original);
    const { piece } = checkedPiece(spline, cutIn(original, 2, 1 - 1e-9), null);
    const start = piece.endSpanParameterLengths!.start!;
    expect(start).toBeGreaterThan(0);
    expect(start).toBeLessThan(1e-8 * (knots[3]! - knots[2]!));
  });

  test("closed targets: a smooth or positional piece [c₁, c₂] never crosses the seam and reproduces it", () => {
    const smooth = editSpline(rg1.slice(0, 6), "smooth");
    const smoothSpans = geometryOf(smooth).spans;
    // c₂ inside the closing span P₅→P₀; P₀ dropped.
    checkedPiece(
      smooth,
      cutIn(smoothSpans, 0, 0.3),
      cutIn(smoothSpans, 5, 0.6),
    );
    // The seam knot as the first cut: P₀ becomes the start, re-expressed.
    const seam = checkedPiece(
      smooth,
      cutAtKnot(smoothSpans, 0),
      cutIn(smoothSpans, 2, 0.5),
    );
    expect(seam.piece.occurrences[0]).toMatchObject({
      occurrenceId: "occ-0",
      tangent: { kind: "authored" },
    });
    expect(seam.piece.endSpanParameterLengths).toEqual({
      end: expect.any(Number),
    });
    const loop = editSpline(
      [
        [0, 0],
        [2, 1],
        [3, 3],
        [1, 4],
        [-1, 2],
        [0, 0],
      ],
      "positional",
      {},
      { start: 1.6 },
    );
    const loopSpans = geometryOf(loop).spans;
    checkedPiece(loop, cutIn(loopSpans, 1, 0.5), cutIn(loopSpans, 4, 0.25));
    // From the corner: the original start field is carried (its span is untouched).
    const corner = checkedPiece(
      loop,
      cutAtKnot(loopSpans, 0),
      cutIn(loopSpans, 3, 0.5),
    );
    expect(corner.piece.endSpanParameterLengths).toEqual({
      start: 1.6,
      end: expect.any(Number),
    });
    expect(corner.geometry.spans[0]!.poles).toEqual(loopSpans[0]!.poles);
  });

  test("trimSplineAggregate: open → two pieces, closed → one; dropped occurrences and points are reported", () => {
    const open = editSpline(pg1, "open", pg1Handles);
    const spans = geometryOf(open).spans;
    const trim = trimSplineAggregate(open.aggregate, open.positions, [
      cutIn(spans, 1, 0.5),
      cutIn(spans, 4, 0.5),
    ])!;
    expect(
      trim.pieces.map((piece) =>
        piece.occurrences.map((entry) =>
          entry.kind === "original" ? entry.occurrenceId : "Q",
        ),
      ),
    ).toEqual([
      ["occ-0", "occ-1", "Q"],
      ["Q", "occ-5", "occ-6"],
    ]);
    expect(trim.droppedOccurrenceIds).toEqual(["occ-2", "occ-3", "occ-4"]);
    expect(trim.droppedPointIds).toEqual(["p2", "p3", "p4"]);
    // Knot cuts keep their fit points as the new ends.
    const knotTrim = trimSplineAggregate(open.aggregate, open.positions, [
      cutAtKnot(spans, 2),
      cutAtKnot(spans, 4),
    ])!;
    expect(knotTrim.droppedOccurrenceIds).toEqual(["occ-3"]);
    expect(
      knotTrim.pieces.map((piece) => piece.endSpanParameterLengths),
    ).toEqual([undefined, undefined]);

    const loop = editSpline(
      [
        [0, 0],
        [2, 1],
        [3, 3],
        [1, 4],
        [-1, 2],
        [0, 0],
      ],
      "positional",
    );
    const loopSpans = geometryOf(loop).spans;
    const closed = trimSplineAggregate(loop.aggregate, loop.positions, [
      cutIn(loopSpans, 1, 0.5),
      cutIn(loopSpans, 2, 0.5),
    ])!;
    expect(closed.pieces).toHaveLength(1);
    expect(closed.droppedOccurrenceIds).toEqual([
      "occ-0",
      "occ-1",
      "occ-3",
      "occ-4",
      "occ-5",
    ]);
    // The corner's two occurrences share p0, reported once.
    expect(closed.droppedPointIds).toEqual(["p0", "p1", "p3", "p4"]);

    expect(() =>
      trimSplineAggregate(open.aggregate, open.positions, [
        cutIn(spans, 4, 0.5),
        cutIn(spans, 1, 0.5),
      ]),
    ).toThrow(RangeError);
    expect(() =>
      trimSplineAggregate(open.aggregate, open.positions, [
        {
          representative: spans[2]!.interval[0] + 1e-3,
          knotOccurrenceIndex: 2,
        },
        cutIn(spans, 4, 0.5),
      ]),
    ).toThrow(RangeError);
    expect(
      trimSplineAggregate(
        { ...open.aggregate, endSpanParameterLengths: { start: -1 } },
        open.positions,
        [cutIn(spans, 1, 0.5), cutIn(spans, 4, 0.5)],
      ),
    ).toBeNull();
  });
});
