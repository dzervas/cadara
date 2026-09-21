import { describe, expect, test } from "vitest";
import {
  evaluateSplineSpan,
  reconstructSpline,
  reconstructSplineAggregate,
  type ResolvedSplineInput,
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
});
