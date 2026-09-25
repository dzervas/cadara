import { describe, expect, test } from "vitest";
import type {
  EndpointNeutralSegment,
  NeutralCurve,
  NeutralCurvePointWitness,
  NeutralCurveQueryRequest,
} from "@/contracts/modeling/neutral-curve-query";
import { reconstructSpline } from "@/contracts/sketch/spline-geometry";
import { approximateSplineOffset } from "@/contracts/sketch/spline-offset-geometry";
import {
  createCertifiedNeutralCurveQuery,
  createCertifiedNeutralCurveQueryWithBudgetObserverForTest,
  createCertifiedNeutralCurveQueryWithLowerBudgetForTest,
} from "@/domain/modeling/neutral-curve-certification/query";

const provenance = (id: string) => ({
  sourceEntityId: id,
  sourceSpanId: `${id}:span`,
});
const circle = (
  id: string,
  center: readonly [number, number],
  radius: number,
  overrides: Partial<Extract<NeutralCurve, { kind: "circle" }>> = {},
): Extract<NeutralCurve, { kind: "circle" }> => ({
  kind: "circle",
  curveId: id,
  provenance: provenance(id),
  center,
  radius,
  xAxis: [1, 0],
  sourceDomain: { kind: "fullTurn", seam: 0 },
  ...overrides,
});
const cubic = (
  id: string,
  poles: Extract<NeutralCurve, { kind: "cubicBezier" }>["poles"],
  overrides: Partial<Extract<NeutralCurve, { kind: "cubicBezier" }>> = {},
): Extract<NeutralCurve, { kind: "cubicBezier" }> => ({
  kind: "cubicBezier",
  curveId: id,
  provenance: provenance(id),
  poles,
  sourceDomain: [0, 1],
  ...overrides,
});
const line = (
  id: string,
  origin: readonly [number, number],
  direction: readonly [number, number],
  sourceDomain: readonly [number, number],
): Extract<NeutralCurve, { kind: "line" }> => ({
  kind: "line",
  curveId: id,
  provenance: provenance(id),
  origin,
  direction,
  sourceDomain,
});
const request = (
  first: NeutralCurve,
  second: NeutralCurve,
): NeutralCurveQueryRequest => ({
  modelingTolerance: 1e-7,
  first,
  second,
});
const query = createCertifiedNeutralCurveQuery();
const verified = (result: ReturnType<typeof query.queryPair>) => {
  expect(result.kind).toBe("verified");
  if (result.kind !== "verified")
    throw new Error(`${result.code}: ${result.message}`);
  return result;
};

describe("constructive numeric neutral-curve dispatcher", () => {
  test("dispatches finite lines, line/circle, line/cubic and circle/circle in both orders", () => {
    const horizontal = line("horizontal", [-2, 0], [1, 0], [0, 4]);
    const vertical = line("vertical", [0, -2], [0, 1], [0, 4]);
    expect(
      verified(query.queryPair(request(horizontal, vertical))).points,
    ).toHaveLength(1);

    const unit = circle("unit", [0, 0], 1);
    for (const pair of [
      [horizontal, unit],
      [unit, horizontal],
    ] as const) {
      const result = verified(query.queryPair(request(...pair)));
      expect(result.points).toHaveLength(2);
      expect(result.completenessProof).toMatchObject({
        family: "lineCircle",
        distinctRootCount: 2,
      });
    }

    const diagonal = cubic("diagonal", [
      [-2, -2],
      [-2 / 3, -2 / 3],
      [2 / 3, 2 / 3],
      [2, 2],
    ]);
    for (const pair of [
      [horizontal, diagonal],
      [diagonal, horizontal],
    ] as const) {
      const result = verified(query.queryPair(request(...pair)));
      expect(result.points).toHaveLength(1);
      expect(result.points[0]?.classification).toBe("crossing");
    }

    const shifted = circle("shifted", [1, 0], 1);
    for (const pair of [
      [unit, shifted],
      [shifted, unit],
    ] as const) {
      const result = verified(query.queryPair(request(...pair)));
      expect(result.points).toHaveLength(2);
      expect(
        result.points.every((point) => point.classification === "crossing"),
      ).toBe(true);
    }
  });

  test.each([
    {
      name: "six",
      poles: [
        [-3, -3 / 4],
        [15, -1 / 4],
        [-15, 1 / 4],
        [3, 3 / 4],
      ] as const,
      center: [0, 0] as const,
      radius: 3 / 2,
      count: 6,
    },
    {
      name: "four",
      poles: [
        [-3, 3],
        [-1, -1],
        [1, -1],
        [3, 3],
      ] as const,
      center: [0, 3] as const,
      radius: 11 / 4,
      count: 4,
    },
  ])(
    "certifies the corrected $name-root circle/cubic fixture",
    ({ name, poles, center, radius, count }) => {
      const curve = cubic(name, poles);
      const support = circle(`${name}-circle`, center, radius, {
        xAxis: [7, -3],
      });
      for (const pair of [
        [support, curve],
        [curve, support],
      ] as const) {
        const result = verified(query.queryPair(request(...pair)));
        expect(result.points).toHaveLength(count);
        expect(result.completenessProof).toMatchObject({
          family: "circleCubic",
          distinctRootCount: count,
        });
        expect(
          result.points.every((point) => point.classification === "crossing"),
        ).toBe(true);
        for (const point of result.points) {
          expect(point.proof.firstParameterBounds[0]).toBeLessThanOrEqual(
            point.firstParameter,
          );
          expect(point.proof.firstParameterBounds[1]).toBeGreaterThanOrEqual(
            point.firstParameter,
          );
          expect(point.proof.secondParameterBounds[0]).toBeLessThanOrEqual(
            point.secondParameter,
          );
          expect(point.proof.secondParameterBounds[1]).toBeGreaterThanOrEqual(
            point.secondParameter,
          );
        }
      }
    },
  );

  test("certifies zero and two regular circle/cubic roots", () => {
    const support = circle("unit-circle-cubic", [0, 0], 1);
    const straight = (id: string, y: number) =>
      cubic(id, [
        [-2, y],
        [-2 / 3, y],
        [2 / 3, y],
        [2, y],
      ]);
    expect(
      verified(query.queryPair(request(support, straight("miss-cubic", 2))))
        .points,
    ).toEqual([]);
    const two = verified(
      query.queryPair(request(support, straight("two-cubic", 0))),
    );
    expect(two.points).toHaveLength(2);
    expect(two.points.map((point) => point.classification).sort()).toEqual([
      "crossing",
      "unclassified",
    ]);
  });

  test("clips the six-root support set by an ordinary binary π arc", () => {
    const curve = cubic("six-clipped", [
      [-3, -3 / 4],
      [15, -1 / 4],
      [-15, 1 / 4],
      [3, 3 / 4],
    ]);
    const clipped = circle("six-clipped-circle", [0, 0], 3 / 2, {
      sourceDomain: { kind: "fullTurn", seam: 0 },
      queryDomain: { kind: "arc", interval: [0, Math.PI] },
    });
    const result = verified(query.queryPair(request(clipped, curve)));
    expect(result.points).toHaveLength(3);
    expect(result.completenessProof).toMatchObject({ distinctRootCount: 3 });
    expect(
      result.points.every(
        (point) => point.firstParameter >= 0 && point.firstParameter <= Math.PI,
      ),
    ).toBe(true);
  });

  test("filters the six-root set with a super-π authored arc", () => {
    const curve = cubic("six-super", [
      [-3, -3 / 4],
      [15, -1 / 4],
      [-15, 1 / 4],
      [3, 3 / 4],
    ]);
    const superPi = circle("six-super-circle", [0, 0], 3 / 2, {
      sourceDomain: { kind: "arc", interval: [-0.1, 4] },
    });
    const result = verified(query.queryPair(request(superPi, curve)));
    expect(result.points).toHaveLength(5);
    expect(result.completenessProof).toMatchObject({ distinctRootCount: 5 });
  });

  test("preserves a negative full-turn winding and ignores non-authoritative proposal fields", () => {
    const curve = cubic("wound", [
      [-2, 0],
      [-2 / 3, 0],
      [2 / 3, 0],
      [2, 0],
    ]);
    const wound = circle("wound-circle", [0, 0], 1, {
      xAxis: [13, 0],
      sourceDomain: { kind: "fullTurn", seam: -7 },
    });
    const base = verified(query.queryPair(request(wound, curve)));
    const withFalseProposals = verified(
      query.queryPair({
        ...request(wound, curve),
        nativeCandidates: [{ firstParameter: 123, secondParameter: 456 }],
      } as NeutralCurveQueryRequest),
    );
    expect(base.points).toHaveLength(2);
    expect(base.points.map((point) => point.firstParameter)).toEqual(
      withFalseProposals.points.map((point) => point.firstParameter),
    );
    expect(
      base.points.every(
        (point) => point.firstParameter >= -7 && point.firstParameter < -0.7,
      ),
    ).toBe(true);
  });

  test("retains distinct parameter roots at the same geometric position", () => {
    const retracing = cubic("same-position", [
      [1, 0],
      [4 / 3, 0],
      [4 / 3, 0],
      [1, 0],
    ]);
    const result = verified(
      query.queryPair(
        request(circle("same-position-support", [0, 0], 1), retracing),
      ),
    );
    expect(result.points).toHaveLength(2);
    expect(result.points.map((point) => point.secondParameter)).toEqual([0, 1]);
    expect(result.points[0]?.position).toEqual(result.points[1]?.position);
    expect(
      result.points.every((point) => point.classification === "unclassified"),
    ).toBe(true);
  });

  test("fails closed for a constant-on-circle cubic degeneracy", () => {
    const constant = cubic("constant-on-circle", [
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
    ]);
    expect(
      query.queryPair(request(circle("constant-support", [0, 0], 1), constant)),
    ).toMatchObject({
      kind: "uncertain",
      code: "circle-cubic-constant-on-circle-degeneracy",
    });
  });

  test("retains a nonrational double tangent under a clipped affine cubic domain", () => {
    const curve = cubic(
      "double",
      [
        [-3, 3],
        [-1, -1],
        [1, -1],
        [3, 3],
      ],
      {
        sourceDomain: [-4, 8],
        queryDomain: [-4, 2],
      },
    );
    const result = verified(
      query.queryPair(request(circle("double-circle", [0, 15 / 4], 3), curve)),
    );
    expect(result.points).toHaveLength(1);
    expect(result.points[0]).toMatchObject({ classification: "tangent" });
    expect(result.points[0]!.secondParameter).toBeGreaterThan(-4);
    expect(result.points[0]!.secondParameter).toBeLessThan(2);
  });

  test("classifies the mandatory regular order-three contact as one crossing in both orders", () => {
    const curve = cubic("order-three", [
      [-3 / 2, 0],
      [-1 / 2, 1 / 4],
      [1 / 2, -1 / 2],
      [3 / 2, 3 / 4],
    ]);
    const support = circle("order-three-circle", [0, 3], 3);
    for (const pair of [
      [support, curve],
      [curve, support],
    ] as const) {
      const result = verified(query.queryPair(request(...pair)));
      expect(result.points).toHaveLength(1);
      expect(result.points[0]).toMatchObject({
        classification: "crossing",
        proof: { rootMultiplicity: 3 },
      });
      const circlePoint =
        pair[0].kind === "circle"
          ? result.points[0]!.firstParameter
          : result.points[0]!.secondParameter;
      expect(circlePoint).toBeGreaterThan(4.7);
      expect(circlePoint).toBeLessThan(4.72);
    }
  });

  test("bounded arcs filter support roots and coincident supports remain uncertain", () => {
    const upper = circle("upper", [0, 0], 1, {
      sourceDomain: { kind: "arc", interval: [0, Math.PI] },
    });
    const horizontal = line("diameter", [-2, 0], [1, 0], [0, 4]);
    expect(
      verified(query.queryPair(request(horizontal, upper))).points,
    ).toHaveLength(1);
    expect(
      query.queryPair(
        request(upper, {
          ...upper,
          curveId: "same",
          provenance: provenance("same"),
        }),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "coincident-circle-supports",
    });
  });

  test("classifies circle/cubic lower and upper active endpoints once", () => {
    const support = circle("endpoint-support", [0, 0], 1);
    const lower = cubic("lower-endpoint", [
      [-1, 0],
      [0, 0],
      [1, 0],
      [2, 0],
    ]);
    const upper = cubic("upper-endpoint", [
      [-2, 0],
      [-1, 0],
      [0, 0],
      [1, 0],
    ]);
    for (const pair of [
      [support, lower],
      [lower, support],
    ] as const) {
      const result = verified(query.queryPair(request(...pair)));
      const cubicIsFirst = pair[0].kind === "cubicBezier";
      expect(
        result.points.filter((point) =>
          cubicIsFirst
            ? point.firstParameter === 0
            : point.secondParameter === 0,
        ),
      ).toMatchObject([{ classification: "unclassified" }]);
    }
    for (const pair of [
      [support, upper],
      [upper, support],
    ] as const) {
      const result = verified(query.queryPair(request(...pair)));
      const cubicIsFirst = pair[0].kind === "cubicBezier";
      expect(
        result.points.filter((point) =>
          cubicIsFirst
            ? point.firstParameter === 1
            : point.secondParameter === 1,
        ),
      ).toMatchObject([{ classification: "unclassified" }]);
    }
  });

  test("owns active endpoints once and full-turn lower seams without an upper duplicate", () => {
    const support = circle("seam", [0, 0], 1);
    const endpointCurve = cubic(
      "endpoint",
      [
        [1, 0],
        [1, 1],
        [2, 1],
        [2, 0],
      ],
      { queryDomain: [0, 0.5] },
    );
    const result = verified(query.queryPair(request(support, endpointCurve)));
    expect(
      result.points.filter((point) => point.secondParameter === 0),
    ).toHaveLength(1);
    expect(
      result.points.find((point) => point.secondParameter === 0)
        ?.classification,
    ).toBe("unclassified");
    expect(
      result.points.filter((point) => point.firstParameter === 0),
    ).toHaveLength(1);
  });

  test("retains nearby distinct exact roots below modeling tolerance", () => {
    const support = circle("nearby-support", [0, 0], 1);
    const nearby = line("nearby-line", [-1, 1 - 2 ** -40], [1, 0], [0, 2]);
    const result = verified(
      query.queryPair({
        ...request(nearby, support),
        modelingTolerance: 0.1,
      }),
    );
    expect(result.points).toHaveLength(2);
    expect(result.points[0]!.proof.firstParameterBounds[1]).toBeLessThan(
      result.points[1]!.proof.firstParameterBounds[0],
    );
  });

  test("proves empty and tangent circle-family results constructively", () => {
    const support = circle("support", [0, 0], 1);
    const miss = line("miss", [-2, 2], [1, 0], [0, 4]);
    expect(verified(query.queryPair(request(miss, support))).points).toEqual(
      [],
    );
    const tangent = line("tangent", [-2, 1], [1, 0], [0, 4]);
    expect(
      verified(query.queryPair(request(tangent, support))).points,
    ).toMatchObject([{ classification: "tangent" }]);
    const tangentCircle = circle("tangent-circle", [2, 0], 1);
    for (const pair of [
      [support, tangentCircle],
      [tangentCircle, support],
    ] as const) {
      expect(verified(query.queryPair(request(...pair))).points).toMatchObject([
        { classification: "unclassified" },
      ]);
    }
  });

  test("uses the exact divided line projection for accepted near-unit directions", () => {
    const nearUnit = line("near-unit", [0, 0], [1 + Number.EPSILON, 0], [0, 1]);
    const vertical = cubic("near-unit-crossing", [
      [1, -1],
      [1, -1 / 3],
      [1, 1 / 3],
      [1, 1],
    ]);
    for (const pair of [
      [nearUnit, vertical],
      [vertical, nearUnit],
    ] as const) {
      const result = verified(query.queryPair(request(...pair)));
      expect(result.points).toHaveLength(1);
      const witness = result.points[0]!;
      const lineBounds =
        pair[0].kind === "line"
          ? witness.proof.firstParameterBounds
          : witness.proof.secondParameterBounds;
      expect(lineBounds[0]).toBeLessThanOrEqual(1 / (1 + Number.EPSILON));
      expect(lineBounds[1]).toBeGreaterThanOrEqual(1 / (1 + Number.EPSILON));
    }
  });

  test("classifies either curve active endpoint and proves even multiplicity truthfully", () => {
    const boundedLine = line("endpoint-line", [0, 0], [1, 0], [0, 1]);
    const vertical = cubic("endpoint-cubic", [
      [1, -1],
      [1, -1 / 3],
      [1, 1 / 3],
      [1, 1],
    ]);
    for (const pair of [
      [boundedLine, vertical],
      [vertical, boundedLine],
    ] as const) {
      expect(verified(query.queryPair(request(...pair))).points).toMatchObject([
        { classification: "unclassified" },
      ]);
    }

    const diameter = line("diameter", [0, 0], [1, 0], [0, 2]);
    const seamCircle = circle("seam-circle", [0, 0], 1);
    for (const pair of [
      [diameter, seamCircle],
      [seamCircle, diameter],
    ] as const) {
      expect(verified(query.queryPair(request(...pair))).points).toMatchObject([
        { classification: "unclassified" },
      ]);
    }

    const even = cubic("even-root", [
      [0, 1],
      [1 / 3, -1],
      [2 / 3, 0],
      [1, 4],
    ]);
    const tangentResult = verified(
      query.queryPair(request(line("even-line", [0, 0], [1, 0], [0, 1]), even)),
    );
    expect(tangentResult.points).toMatchObject([
      {
        classification: "tangent",
        proof: { verification: "exactMultiplicity", rootMultiplicity: 2 },
      },
    ]);
  });

  test("always publishes the computed implicit-line root multiplicity", () => {
    const straight = cubic("multiplicity-straight", [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ]);
    const exactRoot = verified(
      query.queryPair(
        request(line("exact-root", [1.5, -1], [0, 1], [0, 2]), straight),
      ),
    );
    expect(exactRoot.points).toMatchObject([
      {
        classification: "crossing",
        proof: {
          kind: "exactImplicitLineRootSet",
          family: "lineCubic",
          verification: "exactRoot",
          rootMultiplicity: 1,
        },
      },
    ]);
    const arch = cubic("multiplicity-arch", [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]);
    const signLine = line("sign-change", [2.5, 1], [0, -1], [0, 2]);
    for (const [first, second] of [
      [signLine, arch],
      [arch, signLine],
    ]) {
      expect(
        verified(query.queryPair(request(first!, second!))).points,
      ).toMatchObject([
        {
          classification: "crossing",
          proof: { verification: "boundedSignChange", rootMultiplicity: 1 },
        },
      ]);
    }
    // y = x³ has an order-three inflection contact with y = 0: a crossing, not transverse.
    const inflection = cubic("inflection", [
      [-1, -1],
      [-1 / 3, 1],
      [1 / 3, -1],
      [1, 1],
    ]);
    const inflectionLine = line("inflection-line", [-2, 0], [1, 0], [0, 4]);
    for (const [first, second] of [
      [inflectionLine, inflection],
      [inflection, inflectionLine],
    ]) {
      expect(
        verified(query.queryPair(request(first!, second!))).points,
      ).toMatchObject([
        {
          classification: "crossing",
          proof: { family: "lineCubic", rootMultiplicity: 3 },
        },
      ]);
    }
    const secant = verified(
      query.queryPair(
        request(
          line("circle-secant", [-2, 0.5], [1, 0], [0, 4]),
          circle("circle-secant-support", [0, 0], 1),
        ),
      ),
    );
    expect(secant.points).toHaveLength(2);
    for (const point of secant.points) {
      expect(point).toMatchObject({
        classification: "crossing",
        proof: { family: "lineCircle", rootMultiplicity: 1 },
      });
    }
  });

  test("lower-only meters govern every dispatcher family and cubic self", () => {
    const zero = createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
      operations: 0,
    });
    const horizontal = line("budget-horizontal", [-2, 0], [1, 0], [0, 4]);
    const vertical = line("budget-vertical", [0, -2], [0, 1], [0, 4]);
    const support = circle("budget-circle", [0, 0], 1);
    const shifted = circle("budget-shifted", [1, 0], 1);
    const diagonal = cubic("budget-diagonal", [
      [-2, -2],
      [-2 / 3, -2 / 3],
      [2 / 3, 2 / 3],
      [2, 2],
    ]);
    const otherCubic = cubic("budget-other", [
      [-2, 2],
      [-2 / 3, 2 / 3],
      [2 / 3, -2 / 3],
      [2, -2],
    ]);
    for (const pair of [
      [horizontal, vertical],
      [horizontal, support],
      [horizontal, diagonal],
      [support, shifted],
      [support, diagonal],
      [diagonal, otherCubic],
    ] as const) {
      expect(zero.queryPair(request(...pair))).toMatchObject({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
      });
    }
    expect(
      zero.querySelf({ modelingTolerance: 1e-7, curve: diagonal }),
    ).toMatchObject({
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
    });
  });

  test("one meter spans every circle-pair stage and can exhaust after the first root certifies", () => {
    const stagePair = request(
      circle("stage-first", [0, 0], 1),
      circle("stage-second", [1, 0], 1),
    );
    expect(
      verified(
        createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
          operations: 300_000,
        }).queryPair(stagePair),
      ).points,
    ).toHaveLength(2);
    // Receipt-backed literal (T08 polynomial budget repair): isolation 63,300,
    // first root 60,812, second root 73,810, total 197,954 operations. This
    // cap is above every single stage and the first root's completion, and
    // below the whole request, so only a shared unreset meter exhausts.
    const result = createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
      operations: 160_000,
    }).queryPair(stagePair);
    expect(result).toEqual({
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
      message: "The deterministic exact-query arithmetic budget was exhausted.",
    });
    expect("points" in result).toBe(false);
  });

  test.each([
    { operations: 10 },
    { euclideanSteps: 0 },
    { integerBits: 1 },
    { refinementSteps: 0 },
  ])(
    "returns whole-query uncertainty with no partial witnesses at lower cap $operations$euclideanSteps$integerBits$refinementSteps",
    (limits) => {
      const limited =
        createCertifiedNeutralCurveQueryWithLowerBudgetForTest(limits);
      const result = limited.queryPair(
        request(
          line("limited-line", [-2, 0], [1, 0], [0, 4]),
          circle("limited-circle", [0, 0], 1),
        ),
      );
      expect(result).toEqual({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
        message:
          "The deterministic exact-query arithmetic budget was exhausted.",
      });
      expect("points" in result).toBe(false);
    },
  );

  test("query meters are reentrant and never retain an exhausted call's state", () => {
    const limited = createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
      operations: 10,
    });
    const input = request(
      line("reentrant-line", [-2, 0], [1, 0], [0, 4]),
      circle("reentrant-circle", [0, 0], 1),
    );
    expect(limited.queryPair(input)).toMatchObject({
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
    });
    expect(limited.queryPair(input)).toMatchObject({
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
    });
    expect(verified(query.queryPair(input)).points).toHaveLength(2);
  });

  describe("real spline-offset owner output under production caps", () => {
    // F1: (0,0),(1,0.1),(2,0) automatic tangents, offset 0.2, tolerance 1e-3.
    const owner = () => {
      const geometry = reconstructSpline({
        id: "F1",
        policy: "centripetal-mean-arm-v1",
        closure: "open",
        points: (
          [
            [0, 0],
            [1, 0.1],
            [2, 0],
          ] as const
        ).map((position, index) => ({
          occurrenceId: `F1-o${index}`,
          id: `F1-p${index}`,
          position,
          tangent: { kind: "automatic" as const },
        })),
      });
      if (geometry.validity !== "valid") throw new Error("invalid F1 fixture");
      const offset = approximateSplineOffset({
        spans: geometry.spans,
        distance: 0.2,
        modelingTolerance: 1e-3,
      });
      if (!offset.ok) throw new Error(offset.code);
      return offset.spans;
    };
    const spans = owner();
    const span = (index: number) =>
      cubic(`F1-${index}`, spans[index]!.poles, {
        sourceDomain: spans[index]!.sourceInterval,
      });
    const ownerRequest = (first: NeutralCurve, second: NeutralCurve) => ({
      ...request(first, second),
      modelingTolerance: 1e-3,
    });
    const bezier = (index: number, t: number) => {
      const poles = spans[index]!.poles;
      const u = 1 - t;
      return [0, 1].map(
        (axis) =>
          u * u * u * poles[0]![axis]! +
          3 * u * u * t * poles[1]![axis]! +
          3 * u * t * t * poles[2]![axis]! +
          t * t * t * poles[3]![axis]!,
      );
    };
    /** Float oracle: squared distance to the circle minus r² at local t. */
    const support = (
      index: number,
      center: readonly [number, number],
      radius: number,
      t: number,
    ) => {
      const [x, y] = bezier(index, t);
      return (x! - center[0]) ** 2 + (y! - center[1]) ** 2 - radius ** 2;
    };
    const expectOnCircleInsideBounds = (
      point: NeutralCurvePointWitness,
      index: number,
      center: readonly [number, number],
      radius: number,
    ) => {
      const [low, high] = spans[index]!.sourceInterval;
      const t =
        ((point.proof.firstParameterBounds[0] +
          point.proof.firstParameterBounds[1]) /
          2 -
          low) /
        (high - low);
      expect(Math.abs(support(index, center, radius, t))).toBeLessThan(1e-9);
    };

    test("an adjacent pair has exactly its bitwise-shared knot", () => {
      expect(spans).toHaveLength(4);
      expect(spans[2]!.poles[3]).toEqual(spans[3]!.poles[0]);
      const result = verified(query.queryPair(ownerRequest(span(2), span(3))));
      expect(result.points).toHaveLength(1);
      const knot = spans[2]!.sourceInterval[1];
      expect(spans[3]!.sourceInterval[0]).toBe(knot);
      const [first, second] = [
        result.points[0]!.proof.firstParameterBounds,
        result.points[0]!.proof.secondParameterBounds,
      ];
      expect(first[0]).toBeLessThanOrEqual(knot);
      expect(first[1]).toBeGreaterThanOrEqual(knot);
      expect(second[0]).toBeLessThanOrEqual(knot);
      expect(second[1]).toBeGreaterThanOrEqual(knot);
    }, 60_000);

    test("a non-adjacent pair with disjoint pole boxes has no point", () => {
      const box = (index: number) => {
        const poles = spans[index]!.poles;
        return [0, 1].map((axis) => [
          Math.min(...poles.map((pole) => pole[axis]!)),
          Math.max(...poles.map((pole) => pole[axis]!)),
        ]);
      };
      expect(box(0)[0]![1]).toBeLessThan(box(2)[0]![0]!);
      expect(
        verified(query.queryPair(ownerRequest(span(0), span(2)))).points,
      ).toEqual([]);
    }, 60_000);

    test("cubic/arc crossings previously beyond the Euclid cap certify one point", () => {
      const quarterArc = circle("F1-arc", [2, 1], 0.8, {
        sourceDomain: { kind: "arc", interval: [-Math.PI / 2, 0] },
      });
      const smallCircle = circle("F1-small", [1, 0.3], 0.25, {
        sourceDomain: { kind: "arc", interval: [-Math.PI, Math.PI] },
      });
      // Independent float sign changes of |B(t) − c|² − r² with margin.
      expect(support(3, [2, 1], 0.8, 0.9)).toBeLessThan(-1e-3);
      expect(support(3, [2, 1], 0.8, 1)).toBeGreaterThan(1e-3);
      expect(support(2, [1, 0.3], 0.25, 0.4)).toBeLessThan(-1e-3);
      expect(support(2, [1, 0.3], 0.25, 0.5)).toBeGreaterThan(1e-3);
      for (const [index, other, center, radius] of [
        [3, quarterArc, [2, 1], 0.8],
        [2, smallCircle, [1, 0.3], 0.25],
      ] as const) {
        const result = verified(
          query.queryPair(ownerRequest(span(index), other)),
        );
        expect(result.points).toHaveLength(1);
        expect(result.points[0]!.classification).toBe("crossing");
        expectOnCircleInsideBounds(result.points[0]!, index, center, radius);
      }
      expect(
        verified(query.queryPair(ownerRequest(span(3), quarterArc))).points[0]!
          .secondParameter,
      ).toBeGreaterThan(-Math.PI / 2);
    }, 60_000);
  });

  test("dispatches cubic self intersections through the same synchronous object", () => {
    const loop = cubic("loop", [
      [0, 0],
      [2, 2],
      [-1, 2],
      [1, 0],
    ]);
    const result = query.querySelf({ modelingTolerance: 1e-7, curve: loop });
    expect(result.kind).toBe("verified");
  });
});

const segment = (
  id: string,
  start: readonly [number, number],
  end: readonly [number, number],
  queryDomain?: readonly [number, number],
): EndpointNeutralSegment => ({
  kind: "line",
  form: "endpointSegment",
  curveId: id,
  provenance: provenance(id),
  start,
  end,
  sourceDomain: [0, 1],
  ...(queryDomain ? { queryDomain } : {}),
});
const bitwise = (
  actual: readonly [number, number],
  expected: readonly [number, number],
) => Object.is(actual[0], expected[0]) && Object.is(actual[1], expected[1]);
const swapped = (point: NeutralCurvePointWitness) => ({
  firstParameter: point.secondParameter,
  secondParameter: point.firstParameter,
  firstParameterBounds: point.proof.secondParameterBounds,
  secondParameterBounds: point.proof.firstParameterBounds,
});
/** Runs both argument orders; the second result is reported in first-order terms. */
const bothOrders = (first: NeutralCurve, second: NeutralCurve) => [
  verified(query.queryPair(request(first, second))),
  verified(query.queryPair(request(second, first))),
];

describe("endpoint segments at the constructive dispatcher (not a T09 conversion claim)", () => {
  test("a shared declared endpoint is one exact finite-line root at (1, 0), exactly [3, 4], in both orders", () => {
    const first = segment("first", [0, 0], [3, 4]);
    const second = segment("second", [3, 4], [6, 0]);
    const [forward, backward] = bothOrders(first, second);
    for (const [result, order] of [
      [forward!, "forward"],
      [backward!, "backward"],
    ] as const) {
      expect(result.points, order).toHaveLength(1);
      const point = result.points[0]!;
      expect(point).toMatchObject({
        classification: "unclassified",
        proof: { kind: "exactFiniteLineIntersection" },
      });
      expect(bitwise(point.position, [3, 4]), order).toBe(true);
      expect(result.completenessProof).toEqual({
        kind: "completeIsolatedRootSet",
        family: "finiteLinePair",
        distinctRootCount: 1,
      });
    }
    expect(forward!.points[0]).toMatchObject({
      firstParameter: 1,
      secondParameter: 0,
    });
    expect(swapped(backward!.points[0]!)).toMatchObject({
      firstParameter: 1,
      secondParameter: 0,
      firstParameterBounds: [1, 1],
      secondParameterBounds: [0, 0],
    });
    // Preserved numeric semantics: the normalized binary64 conversion of the
    // same pair is a false verified empty (the reason segments exist).
    const normalized = (
      id: string,
      start: [number, number],
      end: [number, number],
    ) => {
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      return line(
        id,
        start,
        [(end[0] - start[0]) / length, (end[1] - start[1]) / length],
        [0, length],
      );
    };
    expect(
      verified(
        query.queryPair(
          request(
            normalized("numeric-first", [0, 0], [3, 4]),
            normalized("numeric-second", [3, 4], [6, 0]),
          ),
        ),
      ).points,
    ).toEqual([]);
  });

  test("the exact support uses exact end - start, not the rounded binary64 difference", () => {
    // Binary64 1e-20 - 1 rounds to -1, whose affine end would be (0, 1).
    const start = [1, 0] as const;
    const end = [1e-20, 1] as const;
    expect(start[0] + (end[0] - start[0])).toBe(0);
    const tilted = segment("tilted", start, end);
    for (const other of [
      segment("upward", end, [1e-20, 2]),
      cubic("from-end", [end, [1, 2], [2, 2], [3, 1]]),
    ]) {
      for (const [result, reversed] of bothOrders(tilted, other).map(
        (value, index) => [value, index === 1] as const,
      )) {
        expect(result.points, other.curveId).toHaveLength(1);
        const point = result.points[0]!;
        const oriented = reversed
          ? swapped(point)
          : {
              firstParameter: point.firstParameter,
              secondParameter: point.secondParameter,
            };
        expect(oriented).toMatchObject({
          firstParameter: 1,
          secondParameter: 0,
        });
        expect(bitwise(point.position, end), other.curveId).toBe(true);
      }
    }
  });

  test("reversed partial collinear overlap maps exactly through the finite-line structural correspondence", () => {
    const first = segment("overlap-first", [0, 0], [2, 0]);
    const second = segment("overlap-second", [2, 0], [1, 0]);
    const [forward, backward] = bothOrders(first, second);
    expect(forward!.overlaps).toEqual([
      {
        orientation: "opposite",
        firstInterval: [0.5, 1],
        secondInterval: [1, 0],
        proof: {
          kind: "exactCollinearLineOverlap",
          firstProvenance: first.provenance,
          secondProvenance: second.provenance,
        },
      },
    ]);
    expect(backward!.overlaps).toMatchObject([
      {
        orientation: "opposite",
        firstInterval: [0, 1],
        secondInterval: [1, 0.5],
      },
    ]);
    for (const result of [forward!, backward!]) {
      expect(result.points).toEqual([]);
      expect(result.completenessProof).toMatchObject({
        kind: "completeStructuralCorrespondence",
        family: "finiteLinePair",
        correspondence: "interval",
      });
    }
  });

  test("a query clip before the shared endpoint proves verified empty in both orders", () => {
    for (const result of bothOrders(
      segment("clipped", [0, 0], [3, 4], [0, 0.5]),
      segment("second", [3, 4], [6, 0]),
    )) {
      expect(result.points).toEqual([]);
      expect(result.overlaps).toEqual([]);
    }
  });

  test("preserved literal-arc semantics: a segment end on the full turn is an exact root; the literal quarter arc stays empty", () => {
    const vertical = segment("to-top", [0, 0.25], [0, 1]);
    const [forward, backward] = bothOrders(vertical, circle("unit", [0, 0], 1));
    for (const result of [forward!, backward!]) {
      expect(result.points).toHaveLength(1);
      expect(result.points[0]!.proof).toMatchObject({
        kind: "exactImplicitLineRootSet",
        family: "lineCircle",
        verification: "exactRoot",
      });
      expect(bitwise(result.points[0]!.position, [0, 1])).toBe(true);
    }
    expect(forward!.points[0]!.firstParameter).toBe(1);
    expect(backward!.points[0]!.secondParameter).toBe(1);
    const quarter = circle("quarter", [0, 0], 1, {
      sourceDomain: { kind: "arc", interval: [0, Math.PI / 2] },
    });
    for (const result of bothOrders(vertical, quarter)) {
      expect(result.points).toEqual([]);
    }
  });

  test("a segment ending on a cubic start pole is the exact endpoint root in both orders", () => {
    const [forward, backward] = bothOrders(
      segment("to-pole", [0, 0], [3, 4]),
      cubic("from-pole", [
        [3, 4],
        [4, 6],
        [5, 6],
        [6, 5],
      ]),
    );
    for (const result of [forward!, backward!]) {
      expect(result.points).toHaveLength(1);
      expect(result.points[0]).toMatchObject({
        classification: "unclassified",
        proof: {
          kind: "exactImplicitLineRootSet",
          family: "lineCubic",
          verification: "exactRoot",
        },
      });
      expect(bitwise(result.points[0]!.position, [3, 4])).toBe(true);
    }
    expect(forward!.points[0]).toMatchObject({
      firstParameter: 1,
      secondParameter: 0,
    });
    expect(swapped(backward!.points[0]!)).toMatchObject({
      firstParameter: 1,
      secondParameter: 0,
    });
  });

  test("crossings exactly at a segment queryDomain bound are admitted once for line, circle and cubic in both orders", () => {
    const clipped = segment("clipped", [0, 0], [4, 0], [0.25, 1]);
    for (const other of [
      segment("vertical", [1, -1], [1, 1]),
      circle("radius-one", [0, 0], 1),
      cubic("vertical-cubic", [
        [1, -1],
        [1, -1 / 3],
        [1, 1 / 3],
        [1, 1],
      ]),
    ]) {
      const [forward, backward] = bothOrders(clipped, other);
      for (const result of [forward!, backward!]) {
        expect(result.points, other.curveId).toHaveLength(1);
        expect(result.points[0]!.classification, other.curveId).toBe(
          "unclassified",
        );
        expect(bitwise(result.points[0]!.position, [1, 0]), other.curveId).toBe(
          true,
        );
      }
      expect(forward!.points[0]!.firstParameter).toBe(0.25);
      expect(backward!.points[0]!.secondParameter).toBe(0.25);
    }
  });

  test("M2: a long large-coordinate segment crossing a circle with a positive-width box is admitted", () => {
    const long = segment("long", [1e6, 1e6 + 0.5], [2e6, 2e6 + 0.5]);
    const target = circle("target", [1.5e6, 1.5e6], 1000);
    const [forward, backward] = bothOrders(long, target);
    for (const [result, segmentSide] of [
      [forward!, "firstParameterBounds"],
      [backward!, "secondParameterBounds"],
    ] as const) {
      expect(result.points).toHaveLength(2);
      for (const point of result.points) {
        expect(point.proof).toMatchObject({
          kind: "exactImplicitLineRootSet",
          family: "lineCircle",
          verification: "boundedSignChange",
          rootMultiplicity: 1,
        });
        const bounds = point.proof[segmentSide];
        expect(bounds[1] - bounds[0], "segment box width").toBeGreaterThan(0);
      }
    }
  });

  test("overflowing endpoint differences are invalid and underflowing ones stay exact", () => {
    expect(
      query.queryPair(
        request(
          segment("overflow", [-Number.MAX_VALUE, 0], [Number.MAX_VALUE, 0]),
          segment("vertical", [0, -1], [0, 1]),
        ),
      ),
    ).toMatchObject({ kind: "uncertain", code: "invalid-neutral-curve-query" });
    for (const result of bothOrders(
      segment("tiny", [0, 0], [Number.MIN_VALUE, 0]),
      segment("vertical", [0, -1], [0, 1]),
    )) {
      expect(result.points).toHaveLength(1);
      expect(bitwise(result.points[0]!.position, [0, 0])).toBe(true);
    }
  });

  test("one meter governs segment families: the measured whole request passes and one fewer exhausts", () => {
    // Receipt-backed literals (both orders): segment/segment, /circle, /cubic.
    const expectedOperations = [1121, 1132, 163438, 163438, 87487, 87487];
    for (const pair of [
      [segment("m-a", [0, 0], [3, 4]), segment("m-b", [3, 0], [0, 4])],
      [segment("m-c", [-2, 0.5], [2, 0.5]), circle("m-circle", [0, 0], 1)],
      [
        segment("m-d", [-2, 0.5], [2, 0.5]),
        cubic("m-cubic", [
          [-1, -1],
          [-1 / 3, 2],
          [1 / 3, 2],
          [1, -1],
        ]),
      ],
    ] as const) {
      for (const input of [
        request(pair[0], pair[1]),
        request(pair[1], pair[0]),
      ]) {
        const snapshots: { operations: number }[] = [];
        verified(
          createCertifiedNeutralCurveQueryWithBudgetObserverForTest(
            (snapshot) => snapshots.push(snapshot),
          ).queryPair(input),
        );
        expect(snapshots).toHaveLength(1);
        const operations = snapshots[0]!.operations;
        expect(
          operations,
          "receipt-backed whole-request segment cost (meter-review pinned)",
        ).toBe(expectedOperations.shift());
        verified(
          createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
            operations,
          }).queryPair(input),
        );
        expect(
          createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
            operations: operations - 1,
          }).queryPair(input),
        ).toEqual({
          kind: "uncertain",
          code: "exact-query-proof-budget-exhausted",
          message:
            "The deterministic exact-query arithmetic budget was exhausted.",
        });
      }
    }
  });
});
