import { describe, expect, test } from "vitest";
import type {
  CubicTubeChainRequest,
  CubicTubeChainResult,
  NeutralCubicTube,
} from "@/contracts/modeling/neutral-curve-query";
import {
  reconstructSpline,
  type SplinePoles,
  type SplineSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import { approximateSplineOffset } from "@/contracts/sketch/spline-offset-geometry";
import {
  createCertifiedCubicTubeChain,
  createCertifiedCubicTubeChainWithBudgetObserverForTest,
  createCertifiedCubicTubeChainWithLowerBudgetForTest,
} from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import { crossExact } from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import {
  ExactProofBudget,
  addExact,
  compareExact,
  divideExact,
  exactFromNumber,
  exactToNumber,
  multiplyExact,
  nextBinary64,
  subtractExact,
  type ExactFraction,
  type ExactProofBudgetSnapshot,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

const certifier = createCertifiedCubicTubeChain();
const TOLERANCE = 1e-3;

/** Real owner output of one fresh reconstruction (automatic tangents). */
function makeOwnerTubes(
  points: readonly SplineVector[],
  distance: number,
  closure: "open" | "smooth" = "open",
) {
  const geometry = reconstructSpline({
    id: "tube-source",
    policy: "centripetal-mean-arm-v1",
    closure,
    points: points.map((position, index) => ({
      occurrenceId: `o${index}`,
      id: `p${index}`,
      position,
      tangent: { kind: "automatic" as const },
    })),
  });
  if (geometry.validity !== "valid") throw new Error("invalid fixture");
  return approximateSplineOffset({
    spans: geometry.spans,
    distance,
    modelingTolerance: TOLERANCE,
  });
}

function ownerTubes(
  points: readonly SplineVector[],
  distance: number,
  closure: "open" | "smooth" = "open",
): readonly NeutralCubicTube[] {
  const result = makeOwnerTubes(points, distance, closure);
  if (!result.ok) throw new Error(result.code);
  return result.spans;
}

const F1: readonly SplineVector[] = [
  [0, 0],
  [1, 0.1],
  [2, 0],
];
const DIAMOND: readonly SplineVector[] = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];
const F1_ASYM: readonly SplineVector[] = [
  [0, 0],
  [1, 0.1],
  [2.5, 0],
];
const GENERIC: readonly SplineVector[] = [
  [0, 0],
  [1.3, 0.7],
  [2.1, -0.2],
];
const HOOK: readonly SplineVector[] = [
  [0, 0],
  [2, 0],
  [2, 2],
  [0, 2],
  [0, 0.192344812476102],
];
/** Irregular smooth-closed pentagon: its wrap knot has exactly nonzero cross. */
const PENTAGON: readonly SplineVector[] = [
  [0, 0],
  [1.2, -0.1],
  [1.6, 0.9],
  [0.7, 1.4],
  [-0.2, 0.8],
];

function request(
  tubes: readonly NeutralCubicTube[],
  closed = false,
): CubicTubeChainRequest {
  return { modelingTolerance: TOLERANCE, closed, tubes };
}

function verified(result: CubicTubeChainResult) {
  if (result.kind !== "verified")
    throw new Error(`${result.kind} ${result.code}: ${result.message}`);
  return result.certificate;
}

type Box = NeutralCubicTube["reference"]["derivative"];
const POSITIVE_X: Box = [
  [0.5, 2],
  [-0.125, 0.125],
];

/** Hand-built exact adversary tube; real chains use owner output. */
function makeTube(
  poles: SplinePoles,
  overrides: Partial<Omit<NeutralCubicTube, "reference" | "source">> & {
    derivative?: Box;
    sourcePoles?: SplinePoles;
    distance?: number;
    spanIndex?: number;
    startOccurrenceId?: string;
    endOccurrenceId?: string;
  } = {},
): NeutralCubicTube {
  return {
    poles,
    certifiedError: overrides.certifiedError ?? 0,
    reference: {
      derivative: overrides.derivative ?? POSITIVE_X,
      sourcePoles: overrides.sourcePoles ?? LINE_SOURCE,
      distance: overrides.distance ?? 0.125,
    },
    source: {
      splineId: "fabricated",
      spanIndex: overrides.spanIndex ?? 0,
      startOccurrenceId: overrides.startOccurrenceId ?? "a",
      endOccurrenceId: overrides.endOccurrenceId ?? "b",
    },
    sourceLocalInterval: overrides.sourceLocalInterval ?? [0, 1],
  };
}

const LINE_SOURCE: SplinePoles = [
  [0, 0],
  [1, 0],
  [2, 0],
  [3, 0],
];

/** Straight dyadic cubic along y = 0 from x0 to x1 with uneven interior poles. */
function straight(x0: number, x1: number): SplinePoles {
  const width = x1 - x0;
  return [
    [x0, 0],
    [x0 + width / 4, 0],
    [x0 + width / 2, 0],
    [x1, 0],
  ];
}

/**
 * Two source spans meeting at the origin; `outgoing` is the next span's
 * first pole difference. The emitted cubics are straight along the x axis.
 */
function knotChain(
  outgoing: SplineVector,
  {
    distance = 0.125,
    scale = 1,
    next = [[0, 0], outgoing, [0.75, 0], [1, 0]],
  }: { distance?: number; scale?: number; next?: SplinePoles } = {},
) {
  const scaled = (poles: SplinePoles) =>
    poles.map(([x, y]) => [x * scale, y * scale]) as unknown as SplinePoles;
  const incoming: SplinePoles = [
    [-1, 0],
    [-0.75, 0],
    [-0.25, 0],
    [0, 0],
  ];
  return [
    makeTube(straight(-1, 0), {
      sourcePoles: scaled(incoming),
      distance,
      spanIndex: 0,
      startOccurrenceId: "o0",
      endOccurrenceId: "o1",
    }),
    makeTube(straight(0, 1), {
      sourcePoles: scaled(next),
      distance,
      spanIndex: 1,
      startOccurrenceId: "o1",
      endOccurrenceId: "o2",
    }),
  ];
}

/** Three same-leaf collinear straight spans; spans 0 and 2 are exactly 2⁻¹⁰ apart. */
function gapChain(error: number) {
  const gap = 2 ** -10;
  return [
    makeTube(straight(0, 1), {
      certifiedError: error,
      sourceLocalInterval: [0, 0.5],
    }),
    makeTube(straight(1, 1 + gap), { sourceLocalInterval: [0.5, 0.625] }),
    makeTube(straight(1 + gap, 2), {
      certifiedError: error,
      sourceLocalInterval: [0.625, 1],
    }),
  ];
}

const EXHAUSTED_RESULT = {
  kind: "uncertain",
  code: "exact-query-proof-budget-exhausted",
  message: "The deterministic exact-query arithmetic budget was exhausted.",
};
type Certificate = ReturnType<typeof verified>;
type Join = Certificate["joins"][number];

/** Exact sign shared by α = cross(u₁, e) and β = cross(u₂, e), else 0. */
function tangentSideOfCone(tubes: readonly NeutralCubicTube[], join: Join) {
  const budget = new ExactProofBudget();
  const vector = (to: SplineVector, from: SplineVector) =>
    [0, 1].map((axis) =>
      subtractExact(
        exactFromNumber(to[axis]!, budget),
        exactFromNumber(from[axis]!, budget),
        budget,
      ),
    ) as unknown as readonly [ExactFraction, ExactFraction];
  const p = tubes[join.first]!.reference.sourcePoles;
  const q = tubes[join.second]!.reference.sourcePoles;
  const e = vector(join.direction, [0, 0]);
  const sign = (u: readonly [ExactFraction, ExactFraction]) =>
    Math.sign(Number(crossExact(u, e, budget).numerator));
  const alpha = sign(vector(p[3], p[2]));
  return alpha === sign(vector(q[1], q[0])) ? alpha : 0;
}

/** Float-only lower oracle: max |λR′| in the leaf's local parameter units. */
function sampledLeafMaximumOffsetSpeed(tube: NeutralCubicTube) {
  const poles = tube.reference.sourcePoles;
  const [start, end] = tube.sourceLocalInterval;
  const width = end - start;
  let maximum = 0;
  for (let index = 0; index <= 2_000; index += 1) {
    const sourceParameter = start + (width * index) / 2_000;
    const derivative = ([0, 1] as const).map(
      (axis) =>
        3 *
        ((1 - sourceParameter) ** 2 * (poles[1]![axis] - poles[0]![axis]) +
          2 *
            sourceParameter *
            (1 - sourceParameter) *
            (poles[2]![axis] - poles[1]![axis]) +
          sourceParameter ** 2 * (poles[3]![axis] - poles[2]![axis])),
    );
    const second = ([0, 1] as const).map(
      (axis) =>
        6 *
        ((1 - sourceParameter) *
          (poles[2]![axis] - 2 * poles[1]![axis] + poles[0]![axis]) +
          sourceParameter *
            (poles[3]![axis] - 2 * poles[2]![axis] + poles[1]![axis])),
    );
    const speed = Math.hypot(derivative[0], derivative[1]);
    const curvature =
      (derivative[0] * second[1] - derivative[1] * second[0]) / speed ** 3;
    // R′ is in source-span units; multiply by width for the leaf τ units
    // used by trim and the reported tail.
    maximum = Math.max(
      maximum,
      Math.abs(1 - tube.reference.distance * curvature) * speed * width,
    );
  }
  // Round down this floating estimate so roundoff cannot turn a lower oracle
  // into an accidental overestimate at an exactly constant-speed leaf.
  return maximum * (1 - 1e-12);
}

/** D3: base error, full displacement bound and K3 radius stay separate. */
function expectHonestKnotReport(
  certificate: Certificate,
  join: Join,
  tubes: readonly NeutralCubicTube[],
) {
  if (join.kind !== "nonparallel-knot") throw new Error("not a J2′ knot");
  const incoming = certificate.leaves[join.first]!;
  const outgoing = certificate.leaves[join.second]!;
  if (join.side === "concave") {
    expect(join.retainedCrossing).toBe(true);
    for (const value of [...join.tail, ...join.trim])
      expect(value > 0 && Number.isFinite(value)).toBe(true);
    expect(incoming.baseErrorStar).toBeGreaterThanOrEqual(join.tail[0]);
    expect(outgoing.baseErrorStar).toBeGreaterThanOrEqual(join.tail[1]);
    // Sampling is a non-authoritative lower oracle only. The exported tail
    // must dominate trim times every sampled |λR′| on its adjacent leaf.
    expect(join.tail[0]).toBeGreaterThanOrEqual(
      join.trim[0] * sampledLeafMaximumOffsetSpeed(tubes[join.first]!),
    );
    expect(join.tail[1]).toBeGreaterThanOrEqual(
      join.trim[1] * sampledLeafMaximumOffsetSpeed(tubes[join.second]!),
    );
    return;
  }
  expect(join.arcDeviation > 0 && Number.isFinite(join.arcDeviation)).toBe(
    true,
  );
  // Convex END: the proved full bound is τ (arc reserve), never ε*.
  expect(incoming.displacementBound).toBe(TOLERANCE);
  expect(incoming.baseErrorStar).toBeLessThan(TOLERANCE);
  // Both adjacent tubes are inflated.
  expect(incoming.clearanceRadius).toBeGreaterThanOrEqual(join.arcDeviation);
  expect(outgoing.clearanceRadius).toBeGreaterThanOrEqual(join.arcDeviation);
}

/** Real owner output of a hand-built straight polyline source (certifier input, not owner-reachable: reconstruction never emits corners). */
function polylineOwnerTubes(
  vertices: readonly SplineVector[],
  distance: number,
): readonly NeutralCubicTube[] {
  const lerp = (p: SplineVector, q: SplineVector, s: number): SplineVector => [
    p[0] + (q[0] - p[0]) * s,
    p[1] + (q[1] - p[1]) * s,
  ];
  const spans: SplineSpan[] = vertices.slice(0, -1).map((p, index) => {
    const q = vertices[index + 1]!;
    return {
      source: {
        splineId: "polyline",
        spanIndex: index,
        startPointId: `p${index}`,
        endPointId: `p${index + 1}`,
        startOccurrenceId: `o${index}`,
        endOccurrenceId: `o${index + 1}`,
      },
      orientation: "forward",
      interval: [index, index + 1],
      poles: [p, lerp(p, q, 1 / 3), lerp(p, q, 2 / 3), q],
      validity: "valid",
      differential: {
        interval: [0, 0],
        poles: [
          [0, 0],
          [0, 0],
          [0, 0],
          [0, 0],
        ],
      },
    };
  });
  const owner = approximateSplineOffset({
    spans,
    distance,
    modelingTolerance: TOLERANCE,
  });
  if (!owner.ok) throw new Error(owner.code);
  return owner.spans;
}

/** Middle leaf of length 1 between two turns of θ (both left). */
const twoTurnPolyline = (theta: number): SplineVector[] => {
  const v2: SplineVector = [Math.cos(theta), Math.sin(theta)];
  return [
    [-1, 0],
    [0, 0],
    v2,
    [v2[0] + Math.cos(2 * theta), v2[1] + Math.sin(2 * theta)],
  ];
};

/**
 * Direct certifier-input tube chain (NOT owner-reachable) over straight
 * dyadic source spans with exact rational unit normals, built through the
 * public request shape. The true offset of a straight span is S + d·n
 * exactly; E rounds it, each later cubic starts at the previous bitwise end
 * and spreads that start shift linearly over its poles, ε is a verified upper
 * bound of max |Eᵢ − Oᵢ| (Bernstein hull ⇒ same-parameter bound) and the
 * derivative box is the exact source hodograph hull (O′ = S′), outward.
 */
function straightTubeChain(
  spans: readonly {
    readonly poles: SplinePoles;
    /** Exact unit left normal as [numerator, denominator] pairs. */
    readonly normal: readonly [
      readonly [number, number],
      readonly [number, number],
    ];
  }[],
  distance: number,
  certifiedErrors: readonly (number | undefined)[] = [],
): NeutralCubicTube[] {
  const budget = new ExactProofBudget();
  const x = (value: number) => exactFromNumber(value, budget);
  const d = x(distance);
  const offsets = spans.map(({ poles, normal }) => {
    const n = normal.map(([top, bottom]) =>
      divideExact(x(top), x(bottom), budget),
    );
    return poles.map((pole) =>
      [0, 1].map((axis) =>
        addExact(x(pole[axis]!), multiplyExact(d, n[axis]!, budget), budget),
      ),
    );
  });
  const round = (value: ExactFraction) => exactToNumber(value, budget);
  const emitted: SplineVector[][] = [];
  offsets.forEach((offset, k) => {
    if (k === 0) {
      emitted.push(offset.map(([a, b]) => [round(a!), round(b!)]));
      return;
    }
    const start = emitted[k - 1]![3]!;
    const shift = [0, 1].map((axis) =>
      subtractExact(x(start[axis]!), offset[0]![axis]!, budget),
    );
    emitted.push(
      offset.map((pole, index) => {
        if (index === 0) return [start[0], start[1]];
        const weight = divideExact(x(3 - index), x(3), budget);
        return [0, 1].map((axis) =>
          round(
            addExact(
              pole[axis]!,
              multiplyExact(weight, shift[axis]!, budget),
              budget,
            ),
          ),
        ) as unknown as SplineVector;
      }),
    );
  });
  return spans.map(({ poles }, k) => {
    let worst = x(0);
    emitted[k]!.forEach((pole, index) => {
      const gap = [0, 1].map((axis) =>
        subtractExact(x(pole[axis]!), offsets[k]![index]![axis]!, budget),
      );
      const squared = addExact(
        multiplyExact(gap[0]!, gap[0]!, budget),
        multiplyExact(gap[1]!, gap[1]!, budget),
        budget,
      );
      if (compareExact(squared, worst, budget) > 0) worst = squared;
    });
    let bound = nextBinary64(Math.sqrt(round(worst)), "up", budget);
    while (
      compareExact(multiplyExact(x(bound), x(bound), budget), worst, budget) < 0
    )
      bound = nextBinary64(bound, "up", budget);
    const certifiedError = certifiedErrors[k] ?? bound;
    if (!(certifiedError >= bound)) throw new Error("ε below proved bound");
    const box = [0, 1].map((axis) => {
      const steps = [0, 1, 2].map((index) =>
        multiplyExact(
          x(3),
          subtractExact(
            x(poles[index + 1]![axis]!),
            x(poles[index]![axis]!),
            budget,
          ),
          budget,
        ),
      );
      const low = steps.reduce((m, v) =>
        compareExact(v, m, budget) < 0 ? v : m,
      );
      const high = steps.reduce((m, v) =>
        compareExact(v, m, budget) > 0 ? v : m,
      );
      return [
        nextBinary64(round(low), "down", budget),
        nextBinary64(round(high), "up", budget),
      ] as const;
    });
    return {
      poles: emitted[k] as unknown as SplinePoles,
      certifiedError,
      reference: {
        derivative: box as unknown as Box,
        sourcePoles: poles,
        distance,
      },
      source: {
        splineId: "straight",
        spanIndex: k,
        startOccurrenceId: `o${k}`,
        endOccurrenceId: `o${k + 1}`,
      },
      sourceLocalInterval: [0, 1],
    };
  });
}

// Pythagorean triple (m² − 1, 2m, m² + 1), m = 2000: exact rational unit
// normals of directions turned by θ ≈ 1e-3 from the x axis; c = 2⁻²⁴.
const C = 2 ** -24;
const A0 = 2000 * 2000 - 1;
const B0 = 2 * 2000;
const H = 2000 * 2000 + 1;
/** Straight span from `start` along (A0, sign·B0), three steps of C. */
const turned = (start: SplineVector, sign: 1 | -1) => ({
  poles: [0, 1, 2, 3].map((i) => [
    start[0] + i * C * A0,
    start[1] + sign * i * C * B0,
  ]) as unknown as SplinePoles,
  normal: [
    [-sign * B0, H],
    [A0, H],
  ] as const,
});
/** Straight span ending at `end` along (A0, sign·B0). */
const turnedInto = (end: SplineVector, sign: 1 | -1) => ({
  poles: [3, 2, 1, 0].map((i) => [
    end[0] - i * C * A0,
    end[1] - sign * i * C * B0,
  ]) as unknown as SplinePoles,
  normal: [
    [-sign * B0, H],
    [A0, H],
  ] as const,
});
/** x-axis span through dyadic stations x₀ < x₁ < x₂ < x₃. */
const axis = (...stations: [number, number, number, number]) => ({
  poles: stations.map((station) => [station, 0]) as unknown as SplinePoles,
  normal: [
    [0, 1],
    [1, 1],
  ] as const,
});

/** Real owner output of one self-looping source span at distance 1/16. */
function loopOwnerSpans() {
  const source: SplineSpan = {
    source: {
      splineId: "loop",
      spanIndex: 0,
      startPointId: "a",
      endPointId: "b",
      startOccurrenceId: "a-use",
      endOccurrenceId: "b-use",
    },
    orientation: "forward",
    interval: [0, 1],
    poles: [
      [0, 0],
      [3, 3],
      [-2, 3],
      [1, 0],
    ],
    validity: "valid",
    differential: {
      interval: [0, 0],
      poles: [
        [0, 0],
        [0, 0],
        [0, 0],
        [0, 0],
      ],
    },
  };
  const owner = approximateSplineOffset({
    spans: [source],
    distance: 0.0625,
    modelingTolerance: TOLERANCE,
  });
  if (!owner.ok) throw new Error(owner.code);
  return owner.spans;
}

describe("cubic tube chain: real owner known answers", () => {
  test("F1 is verified with exact same-leaf and parallel-knot joins and three cleared pairs", () => {
    const certificate = verified(
      certifier.certifyChain(request(ownerTubes(F1, 0.2))),
    );
    expect(
      certificate.joins.map(({ first, second, kind }) => [first, second, kind]),
    ).toEqual([
      [0, 1, "same-leaf"],
      [1, 2, "parallel-knot"],
      [2, 3, "same-leaf"],
    ]);
    expect(certificate.clearedPairs).toEqual([
      [0, 2],
      [0, 3],
      [1, 3],
    ]);
    expect(certificate.maxSplits).toBe(0);
    expect(certificate).not.toHaveProperty("isolatedSpanDirection");
  });

  test("the real 40-span closed diamond is verified including its parallel-knot wrap", () => {
    const tubes = ownerTubes(DIAMOND, 0.1, "smooth");
    expect(tubes).toHaveLength(40);
    const certificate = verified(certifier.certifyChain(request(tubes, true)));
    expect(certificate.joins).toHaveLength(40);
    expect(certificate.joins.at(-1)).toMatchObject({
      first: 39,
      second: 0,
      kind: "parallel-knot",
    });
    expect(
      certificate.joins.filter((join) => join.kind === "parallel-knot"),
    ).toHaveLength(4);
    expect(certificate.clearedPairs).toHaveLength((40 * 39) / 2 - 40);
  });

  test("a single open span certifies its own cone", () => {
    const tubes = ownerTubes(
      [
        [0, 0],
        [1, 0.25],
      ],
      0.125,
    );
    expect(tubes).toHaveLength(1);
    const certificate = verified(certifier.certifyChain(request(tubes)));
    expect(certificate.joins).toEqual([]);
    expect(certificate.clearedPairs).toEqual([]);
    expect(certificate.isolatedSpanDirection).toBeDefined();
  });

  // Formerly rejected non-parallel knots, now certified by J2′. Orientation
  // is the exact sign of α = cross(u₁, e) = sign of β = cross(u₂, e).
  test.each([
    ["asymmetric F1", F1_ASYM, 0.2, [[2, 3, "concave", -1]]],
    ["asymmetric F1", F1_ASYM, -0.2, [[2, 3, "convex", -1]]],
    ["generic three-point", GENERIC, 0.15, [[6, 7, "concave", 1]]],
    ["generic three-point", GENERIC, -0.15, [[6, 7, "convex", 1]]],
    [
      "hook",
      HOOK,
      -0.2,
      [
        [8, 9, "concave", -1],
        [20, 21, "concave", 1],
        [32, 33, "convex", -1],
      ],
    ],
  ] as const)(
    "real %s output at d = %s verifies its non-parallel knots with exact sides",
    (_label, points, distance, expected) => {
      const tubes = ownerTubes(points, distance);
      const certificate = verified(certifier.certifyChain(request(tubes)));
      const knots = certificate.joins.filter(
        (join) => join.kind === "nonparallel-knot",
      );
      expect(
        knots.map((join) => [
          join.first,
          join.second,
          join.kind === "nonparallel-knot" && join.side,
          tangentSideOfCone(tubes, join),
        ]),
      ).toEqual(expected);
      for (const join of knots)
        expectHonestKnotReport(certificate, join, tubes);
    },
  );

  test("both α/β orientations are certified concave at both signs of d (signed Δ rationalisation)", () => {
    // D1: sign(α) is mandatory in the same-sign branch; dropping it makes
    // the α, β < 0 concave windows negative and these fail closed.
    const cases = [
      [F1_ASYM, 0.2, -1],
      [HOOK, -0.2, -1],
      [GENERIC, 0.15, 1],
      [PENTAGON, -0.1, 1],
    ] as const;
    for (const [points, distance, orientation] of cases) {
      const tubes = ownerTubes(
        points,
        distance,
        points === PENTAGON ? "smooth" : "open",
      );
      const certificate = verified(
        certifier.certifyChain(request(tubes, points === PENTAGON)),
      );
      expect(
        certificate.joins.some(
          (join) =>
            join.kind === "nonparallel-knot" &&
            join.side === "concave" &&
            tangentSideOfCone(tubes, join) === orientation,
        ),
      ).toBe(true);
    }
  });

  test("the hook at d = +0.2 fails clearance honestly (tubes overlap, not a contact claim)", () => {
    expect(
      certifier.certifyChain(request(ownerTubes(HOOK, 0.2))),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
      first: 0,
      second: 41,
    });
  });

  test.each([
    [
      0.1,
      [
        [9, 10, "convex"],
        [18, 19, "convex"],
        [25, 26, "convex"],
        [32, 33, "concave"],
        [38, 0, "convex"],
      ],
    ],
    [
      -0.1,
      [
        [9, 10, "concave"],
        [18, 19, "concave"],
        [25, 26, "concave"],
        [32, 33, "convex"],
        [38, 0, "concave"],
      ],
    ],
  ] as const)(
    "the real closed pentagon at d = %s verifies with its generic (nonzero-cross) wrap knot under one meter",
    (distance, expected) => {
      const tubes = ownerTubes(PENTAGON, distance, "smooth");
      expect(tubes).toHaveLength(39);
      const certificate = verified(
        certifier.certifyChain(request(tubes, true)),
      );
      expect(
        certificate.joins
          .filter((join) => join.kind === "nonparallel-knot")
          .map((join) => [
            join.first,
            join.second,
            join.kind === "nonparallel-knot" && join.side,
          ]),
      ).toEqual(expected);
      expect(certificate.clearedPairs).toHaveLength((39 * 38) / 2 - 39);
      for (const join of certificate.joins)
        if (join.kind === "nonparallel-knot")
          expectHonestKnotReport(certificate, join, tubes);
    },
  );

  test("near-cusp output fails the true-offset cone; at the cusp the owner itself fails", () => {
    expect(
      certifier.certifyChain(request(ownerTubes(F1, -2.475))),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-cone-unproven",
      first: 0,
      second: 1,
    });
    expect(makeOwnerTubes(F1, -2.5)).toMatchObject({
      ok: false,
      code: "offset-topology-uncertain",
    });
  });

  test("real single-source-span loop: tubes overlap, so clearance is unproven (not a claim of true-offset contact)", () => {
    const owner = { spans: loopOwnerSpans() };
    expect(owner.spans).toHaveLength(24);
    // Every join is same-leaf, so the J1 and K1 checks passed before K3.
    expect(owner.spans.every((span) => span.source.spanIndex === 0)).toBe(true);
    expect(certifier.certifyChain(request(owner.spans))).toEqual({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
      message:
        "Certified error tubes overlap; true-offset separation not proved.",
      first: 1,
      second: 22,
    });
  });
});

describe("cubic tube chain: exact boundaries and adversaries", () => {
  test("clearance is strict at the exact dyadic boundary ε_0 + ε_2 = 2⁻¹⁰", () => {
    expect(certifier.certifyChain(request(gapChain(2 ** -11)))).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
      first: 0,
      second: 2,
    });
    expect(
      verified(certifier.certifyChain(request(gapChain(2 ** -11 - 2 ** -60))))
        .clearedPairs,
    ).toEqual([[0, 2]]);
  });

  test("diagnostic only: the endpoint early exit names the overlap instead of exhausting the budget", () => {
    // Soundness never depends on this exit; without it the boundary case
    // subdivides until the shared budget fails closed as exhausted.
    const result = certifier.certifyChain(request(gapChain(2 ** -11)));
    expect(result.kind === "uncertain" && result.code).toBe(
      "cubic-tube-clearance-unproven",
    );
  });

  test("an exactly parallel knot verifies; antiparallel is unproven; one ulp off is a J2′ knot (certifier input, not owner-reachable)", () => {
    expect(
      verified(certifier.certifyChain(request(knotChain([0.25, 0])))).joins[0]!
        .kind,
    ).toBe("parallel-knot");
    // Exactly antiparallel: cross 0, dot < 0.
    expect(
      certifier.certifyChain(request(knotChain([-0.25, 0]))),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      first: 0,
      second: 1,
    });
    // One ulp of 0.25 off the incoming tangent line: nonzero exact cross.
    for (const [distance, side] of [
      [0.125, "concave"],
      [-0.125, "convex"],
    ] as const) {
      expect(
        verified(
          certifier.certifyChain(
            request(knotChain([0.25, 2 ** -54], { distance })),
          ),
        ).joins[0],
      ).toMatchObject({ kind: "nonparallel-knot", side });
    }
  });

  test("a same-leaf join needs bitwise identical source poles", () => {
    const shifted: SplinePoles = [
      LINE_SOURCE[0],
      [1, 2 ** -60],
      LINE_SOURCE[2],
      LINE_SOURCE[3],
    ];
    const chain = [
      makeTube(straight(0, 1), { sourceLocalInterval: [0, 0.5] }),
      makeTube(straight(1, 2), {
        sourceLocalInterval: [0.5, 1],
        sourcePoles: shifted,
      }),
    ];
    expect(certifier.certifyChain(request(chain))).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
    });
    expect(
      verified(
        certifier.certifyChain(
          request([
            chain[0]!,
            { ...chain[1]!, reference: chain[0]!.reference },
          ]),
        ),
      ).joins[0]!.kind,
    ).toBe("same-leaf");
  });

  test.each([
    [
      "same-leaf split parameters differ",
      () => [
        makeTube(straight(0, 1), { sourceLocalInterval: [0, 0.5] }),
        makeTube(straight(1, 2), { sourceLocalInterval: [0.625, 1] }),
      ],
    ],
    [
      "knot source points differ",
      () => {
        const chain = knotChain([0.25, 0]);
        return [
          chain[0]!,
          {
            ...chain[1]!,
            reference: {
              ...chain[1]!.reference,
              sourcePoles: [
                [0, 2 ** -20],
                [0.25, 2 ** -20],
                [0.75, 0],
                [1, 0],
              ] satisfies SplinePoles,
            },
          },
        ];
      },
    ],
    [
      "knot left leaf ends before 1",
      () => {
        const chain = knotChain([0.25, 0]);
        return [
          { ...chain[0]!, sourceLocalInterval: [0, 0.5] as const },
          chain[1]!,
        ];
      },
    ],
    [
      "knot spans use different spline IDs",
      () => {
        const chain = knotChain([0.25, 0]);
        return [
          chain[0]!,
          { ...chain[1]!, source: { ...chain[1]!.source, splineId: "other" } },
        ];
      },
    ],
    [
      "knot occurrences are not shared",
      () => {
        const chain = knotChain([0.25, 0]);
        return [
          chain[0]!,
          {
            ...chain[1]!,
            source: { ...chain[1]!.source, startOccurrenceId: "other-use" },
          },
        ];
      },
    ],
  ] as const)(
    "fabricated admission input with %s is rejected at the declared join",
    (_label, makeChain) => {
      // These metadata-valid adversaries are not fresh-owner-reachable.
      expect(certifier.certifyChain(request(makeChain()))).toEqual({
        kind: "uncertain",
        code: "cubic-tube-knot-incidence-unproven",
        message:
          "The true offset endpoints of a declared join are not proved identical.",
        first: 0,
        second: 1,
      });
    },
  );

  test("a metadata-valid small corner (not owner-reachable) is never admitted beyond its proved J2′ correction", () => {
    // Review §1.2: straight source spans turn by θ = 0.005 at the origin;
    // offset 0.2 on the concave (right, d < 0) side. The one-sided true
    // offsets cross, while E only shares the midpoint pole within ε ≤ τ.
    // J2′ proves the crossing, but ε + tail exceeds τ: no admission.
    const theta = 0.005;
    const distance = 0.2;
    const t1: SplineVector = [Math.cos(theta / 2), Math.sin(theta / 2)];
    const t2: SplineVector = [Math.cos(theta / 2), -Math.sin(theta / 2)];
    const a: SplineVector = [distance * t1[1], -distance * t1[0]];
    const b: SplineVector = [distance * t2[1], -distance * t2[0]];
    const shared: SplineVector = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const line = (from: SplineVector, to: SplineVector): SplinePoles => [
      from,
      [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3],
      [
        from[0] + (2 * (to[0] - from[0])) / 3,
        from[1] + (2 * (to[1] - from[1])) / 3,
      ],
      to,
    ];
    const box = (t: SplineVector): Box => [
      [t[0] - 1e-3, t[0] + 1e-3],
      [t[1] - 1e-3, t[1] + 1e-3],
    ];
    const chain = [
      makeTube(line([a[0] - t1[0], a[1] - t1[1]], shared), {
        certifiedError: 5.0001e-4,
        distance: -distance,
        derivative: box(t1),
        sourcePoles: line([-t1[0], -t1[1]], [0, 0]),
        spanIndex: 0,
        startOccurrenceId: "o0",
        endOccurrenceId: "o1",
      }),
      makeTube(line(shared, [b[0] + t2[0], b[1] + t2[1]]), {
        certifiedError: 5.0001e-4,
        distance: -distance,
        derivative: box(t2),
        sourcePoles: line([0, 0], t2),
        spanIndex: 1,
        startOccurrenceId: "o1",
        endOccurrenceId: "o2",
      }),
    ];
    expect(certifier.certifyChain(request(chain))).toEqual({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      message: "Leaf 0: corrected base error exceeds the modeling tolerance.",
      first: 0,
    });
  });

  test("a non-bitwise emitted join is uncertain", () => {
    const tubes = ownerTubes(F1, 0.2);
    const [x, y] = tubes[1]!.poles[0];
    const nudged: NeutralCubicTube = {
      ...tubes[1]!,
      poles: [
        [x, y + 2 ** -52],
        tubes[1]!.poles[1],
        tubes[1]!.poles[2],
        tubes[1]!.poles[3],
      ],
    };
    expect(y + 2 ** -52).not.toBe(y);
    expect(
      certifier.certifyChain(
        request([tubes[0]!, nudged, tubes[2]!, tubes[3]!]),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-chain-join-not-bitwise",
      first: 0,
      second: 1,
    });
  });

  test("ε outside [0, τ], NaN or reversed derivative boxes and reversed leaves are inadmissible", () => {
    const [first, ...rest] = ownerTubes(F1, 0.2);
    const withBox = (derivative: Box): NeutralCubicTube => ({
      ...first!,
      reference: { ...first!.reference, derivative },
    });
    for (const tube of [
      { ...first!, certifiedError: 2e-3 },
      { ...first!, certifiedError: -1e-9 },
      withBox([
        [Number.NaN, 1],
        [0, 0],
      ]),
      withBox([
        [2, 0.5],
        [0, 0],
      ]),
      { ...first!, sourceLocalInterval: [0.5, 0.25] as const },
    ]) {
      expect(certifier.certifyChain(request([tube, ...rest]))).toMatchObject({
        kind: "uncertain",
        code: "invalid-cubic-tube-chain",
        first: 0,
      });
    }
  });

  test("spans without owner metadata (persisted, projected or fabricated) are inadmissible", () => {
    const { reference, ...stale } = ownerTubes(F1, 0.2)[0]!;
    expect(reference).toBeDefined();
    expect(
      certifier.certifyChain(request([stale as unknown as NeutralCubicTube])),
    ).toMatchObject({ kind: "uncertain", code: "invalid-cubic-tube-chain" });
  });

  test("a looped emitted cubic fails the emitted cone; a derivative box containing 0 fails the true-offset cone", () => {
    const loop = makeTube([
      [0, 0],
      [3, 3],
      [-2, 3],
      [1, 0],
    ]);
    const zeroBox = makeTube(straight(0, 1), {
      derivative: [
        [-1, 1],
        [-1, 1],
      ],
    });
    for (const tube of [loop, zeroBox]) {
      expect(certifier.certifyChain(request([tube]))).toMatchObject({
        kind: "uncertain",
        code: "cubic-tube-cone-unproven",
        first: 0,
      });
    }
    expect(
      certifier.certifyChain(request([makeTube(straight(0, 1))])),
    ).toMatchObject({
      kind: "verified",
    });
  });

  test("empty chains and closed chains shorter than three spans are unsupported", () => {
    expect(certifier.certifyChain(request([]))).toMatchObject({
      kind: "unsupported",
      code: "cubic-tube-chain-empty",
    });
    const lens = [
      makeTube([
        [0, 0],
        [1, 1],
        [2, 1],
        [3, 0],
      ]),
      makeTube([
        [3, 0],
        [2, -1],
        [1, -1],
        [0, 0],
      ]),
    ];
    expect(certifier.certifyChain(request(lens, true))).toMatchObject({
      kind: "unsupported",
      code: "cubic-tube-chain-closed-too-short",
    });
  });

  test("ordinary exceptions propagate by identity", () => {
    const error = new Error("ordinary failure");
    const tube = makeTube(straight(0, 1));
    const throwing = {
      ...tube,
      get poles(): SplinePoles {
        throw error;
      },
    };
    let thrown: unknown;
    try {
      certifier.certifyChain(request([throwing]));
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
  });
});

describe("cubic tube chain: J2′ composition (certifier-input fixtures, not owner-reachable)", () => {
  const leafMessage = (leaf: number, reason: string) => ({
    kind: "uncertain",
    code: "cubic-tube-knot-incidence-unproven",
    message: `Leaf ${leaf}: ${reason}.`,
    first: leaf,
  });
  const OVER = "corrected base error exceeds the modeling tolerance";
  const NOT_BELOW =
    "corrected base error is not below the modeling tolerance at a convex end";

  test("straight corner θ = 0.002: concave tail ≥ |d|·tan(θ/2) and convex δ⁺ ≥ |A − B| (known answers)", () => {
    const theta = 0.002;
    const corner: SplineVector[] = [
      [-1, 0],
      [0, 0],
      [Math.cos(theta), Math.sin(theta)],
    ];
    for (const distance of [0.2, -0.2]) {
      const certificate = verified(
        certifier.certifyChain(request(polylineOwnerTubes(corner, distance))),
      );
      const [knot] = certificate.joins.filter(
        (join) => join.kind === "nonparallel-knot",
      );
      if (knot?.kind !== "nonparallel-knot") throw new Error("no J2′ knot");
      if (distance > 0) {
        expect(knot.side).toBe("concave");
        if (knot.side === "concave")
          for (const tail of knot.tail)
            expect(tail).toBeGreaterThanOrEqual(
              Math.abs(distance) * Math.tan(theta / 2),
            );
      } else {
        expect(knot.side).toBe("convex");
        if (knot.side === "convex")
          expect(knot.arcDeviation).toBeGreaterThanOrEqual(
            2 * Math.abs(distance) * Math.sin(theta / 2),
          );
      }
      expectHonestKnotReport(
        certificate,
        knot,
        polylineOwnerTubes(corner, distance),
      );
    }
  });

  test("a leaf corrected at both ends sums both corrections into ε* and both δ⁺ into its K3 radius", () => {
    const tubes = (distance: number) =>
      polylineOwnerTubes(twoTurnPolyline(1e-3), distance);
    const ulps = (value: number) => 4 * Number.EPSILON * value;
    // Concave (d > 0): tails enter ε* but never the clearance radius.
    const concaveTubes = tubes(0.2);
    const concave = verified(certifier.certifyChain(request(concaveTubes)));
    expect(
      concave.joins.map(
        (join) => join.kind === "nonparallel-knot" && join.side,
      ),
    ).toEqual(["concave", "concave"]);
    const [into, out] = concave.joins as readonly Join[];
    if (into?.kind !== "nonparallel-knot" || into.side !== "concave")
      throw new Error("concave");
    if (out?.kind !== "nonparallel-knot" || out.side !== "concave")
      throw new Error("concave");
    const middle = concave.leaves[1]!;
    const concaveSum =
      concaveTubes[1]!.certifiedError + into.tail[1] + out.tail[0];
    expect(Math.abs(middle.baseErrorStar - concaveSum)).toBeLessThanOrEqual(
      ulps(concaveSum),
    );
    expect(middle.baseErrorStar).toBeGreaterThan(
      concaveTubes[1]!.certifiedError +
        Math.max(into.tail[1], out.tail[0]) +
        ulps(concaveSum),
    );
    expect(middle.displacementBound).toBe(middle.baseErrorStar);
    expect(concave.leaves.map((leaf) => leaf.clearanceRadius)).toEqual(
      concaveTubes.map((tube) => tube.certifiedError),
    );
    // Convex (d < 0): both δ⁺ enter ε* and the radius; neighbours inflate too.
    const convexTubes = tubes(-0.2);
    const convex = verified(certifier.certifyChain(request(convexTubes)));
    const deltas = convex.joins.map((join) =>
      join.kind === "nonparallel-knot" && join.side === "convex"
        ? join.arcDeviation
        : Number.NaN,
    );
    const both = convexTubes[1]!.certifiedError + deltas[0]! + deltas[1]!;
    for (const value of [
      convex.leaves[1]!.baseErrorStar,
      convex.leaves[1]!.clearanceRadius,
    ])
      expect(Math.abs(value - both)).toBeLessThanOrEqual(ulps(both));
    expect(convex.leaves[1]!.displacementBound).toBe(TOLERANCE);
    for (const [leaf, delta] of [
      [0, deltas[0]!],
      [2, deltas[1]!],
    ] as const) {
      const inflated = convexTubes[leaf]!.certifiedError + delta;
      expect(
        Math.abs(convex.leaves[leaf]!.clearanceRadius - inflated),
      ).toBeLessThanOrEqual(ulps(inflated));
    }
    // Leaf 0 ends convex (full bound τ); leaf 2 only starts convex (bound ε*).
    expect(convex.leaves[0]!.displacementBound).toBe(TOLERANCE);
    expect(convex.leaves[2]!.displacementBound).toBe(
      convex.leaves[2]!.baseErrorStar,
    );
  });

  test("G1 (conservative SUM policy, not a MAX-unsoundness witness): θ = 2e-3 fails where a max rule would pass", () => {
    // Reviewer fixture: ε ≈ 4e-4, per-end corrections ≈ 4e-4 (concave) or
    // 5.66e-4 (convex), τ = 1e-3: ε + max ≤ τ < ε + sum at both signs.
    for (const [distance, reason] of [
      [0.2, OVER],
      [-0.2, NOT_BELOW],
    ] as const) {
      expect(
        certifier.certifyChain(
          request(polylineOwnerTubes(twoTurnPolyline(2e-3), distance)),
        ),
      ).toEqual(leafMessage(1, reason));
    }
  });

  test("G2 retention guard wiring: trims 0.555 + 0.555 ≥ 1 fail closed although ε* ≤ τ (mutant acceptance would be geometrically true here)", () => {
    const length = 5033 * C;
    const inset = 1007 * C;
    const tubes = straightTubeChain(
      [
        turnedInto([0, 0], -1),
        axis(0, inset, length - inset, length),
        turned([length, 0], 1),
      ],
      0.1,
    );
    expect(certifier.certifyChain(request(tubes))).toEqual(
      leafMessage(1, "retained domain not proved nonempty"),
    );
  });

  test("K3 inflates the INCOMING leaf of a convex knot: its non-adjacent neighbour-of-neighbour pair fails", () => {
    const length = 3 * 2 ** -17;
    const tubes = straightTubeChain(
      [
        turnedInto([0, 0], 1),
        axis(0, 2 ** -17, 2 ** -16, length),
        axis(length, length + 0.25, length + 0.5, length + 0.75),
      ],
      0.1,
    );
    // |E₀(1) − E₂(0)| ≈ |A − B| + L lies in (ε₀ + ε₂, ε₀ + δ⁺ + ε₂].
    expect(certifier.certifyChain(request(tubes))).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
      first: 0,
      second: 2,
    });
  });

  test("K3 inflates the OUTGOING leaf of a convex knot: its non-adjacent neighbour-of-neighbour pair fails", () => {
    const length = 3 * 2 ** -14;
    const tubes = straightTubeChain(
      [
        axis(-0.75, -0.5, -0.25, 0),
        axis(0, 2 ** -14, 2 ** -13, length),
        turned([length, 0], -1),
      ],
      0.1,
    );
    // |E₀(1) − E₂(0)| = L lies in (ε₀ + ε₂, ε₀ + ε₂ + δ⁺].
    expect(certifier.certifyChain(request(tubes))).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
      first: 0,
      second: 2,
    });
  });

  test("strict ε* < τ at a convex END: exactly representable ε + δ⁺ = τ is uncertain", () => {
    const tolerance = 2 ** -12;
    const spans = [turnedInto([0, 0], 1), axis(0, 0.25, 0.5, 0.75)];
    const probe = verified(
      certifier.certifyChain({
        modelingTolerance: tolerance,
        closed: false,
        tubes: straightTubeChain(spans, 0.09375),
      }),
    );
    const [knot] = probe.joins;
    if (knot?.kind !== "nonparallel-knot" || knot.side !== "convex")
      throw new Error("convex fixture");
    // Sterbenz: δ⁺ ∈ [τ/2, τ], so τ − δ⁺ is exact and ε₀ + δ⁺ = τ exactly.
    expect(
      knot.arcDeviation >= tolerance / 2 && knot.arcDeviation <= tolerance,
    ).toBe(true);
    const epsilon = tolerance - knot.arcDeviation;
    const budget = new ExactProofBudget();
    expect(
      compareExact(
        addExact(
          exactFromNumber(epsilon, budget),
          exactFromNumber(knot.arcDeviation, budget),
          budget,
        ),
        exactFromNumber(tolerance, budget),
        budget,
      ),
    ).toBe(0);
    // The convex-START leaf stays strictly below τ, so only the END decides.
    expect(probe.leaves[1]!.baseErrorStar).toBeLessThan(tolerance);
    expect(
      certifier.certifyChain({
        modelingTolerance: tolerance,
        closed: false,
        tubes: straightTubeChain(spans, 0.09375, [epsilon]),
      }),
    ).toEqual(leafMessage(0, NOT_BELOW));
  });

  test("ε = τ exactly on a zero-correction leaf of a J2′ chain still verifies (≤ away from convex ends)", () => {
    const certificate = verified(
      certifier.certifyChain(
        request(
          straightTubeChain(
            [
              turnedInto([0, 0], 1),
              axis(0, 0.25, 0.5, 0.75),
              axis(0.75, 1, 1.25, 1.5),
            ],
            0.1,
            [undefined, undefined, TOLERANCE],
          ),
        ),
      ),
    );
    expect(certificate.joins.map((join) => join.kind)).toEqual([
      "nonparallel-knot",
      "parallel-knot",
    ]);
    expect(certificate.leaves[2]).toEqual({
      baseErrorStar: TOLERANCE,
      displacementBound: TOLERANCE,
      clearanceRadius: TOLERANCE,
    });
  });

  test("an unproven κ-only λ enclosure is uncertain (fabricated curved source vs. straight tubes)", () => {
    const next: SplinePoles = [
      [0, 0],
      [0.25, 2 ** -54],
      [0.5, 0.5],
      [1, 0],
    ];
    expect(
      certifier.certifyChain(
        request(knotChain([0.25, 2 ** -54], { distance: 0.5, next })),
      ),
    ).toEqual({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      message:
        "The curvature enclosure does not prove the offset speed factor 1 − dκ positive.",
      first: 0,
      second: 1,
    });
  });

  test("square-root guards: a zero lower bound or a null (overflowing) bound is uncertain before any division", () => {
    const rootFailure = {
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      message: "A verified square-root bound is not finite and positive.",
      first: 0,
      second: 1,
    };
    // Convex δ⁺² ≈ 1e-650: the helper's lower bound is −MIN_VALUE.
    expect(
      certifier.certifyChain(
        request(knotChain([0.25, Number.MIN_VALUE], { distance: -0.125 })),
      ),
    ).toEqual(rootFailure);
    // Concave with source poles scaled by 2⁶⁰⁰: |R′|² overflows, helper null.
    expect(
      certifier.certifyChain(
        request(knotChain([0.25, 2 ** -54], { scale: 2 ** 600 })),
      ),
    ).toEqual(rootFailure);
  });

  test("d = 0 (and −0) at a real non-parallel knot is an honest uncertain, not a contradiction", () => {
    for (const distance of [0, -0]) {
      const tubes = ownerTubes(F1_ASYM, distance);
      expect(Object.is(tubes[0]!.reference.distance, distance)).toBe(true);
      expect(certifier.certifyChain(request(tubes))).toEqual({
        kind: "uncertain",
        code: "cubic-tube-knot-incidence-unproven",
        message:
          "Zero offset distance at a non-parallel knot: J2′ not attempted (no side).",
        first: 0,
        second: 1,
      });
    }
  });

  test("closed chains of three or four cubics with a non-parallel knot are uncertain before any J2′ work", () => {
    const corners: SplineVector[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    for (const size of [3, 4]) {
      const tubes = corners.slice(0, size).map((start, index) => {
        const end = corners[(index + 1) % size]!;
        const line: SplineVector[] = [0, 1, 2, 3].map((i) => [
          start[0] + ((end[0] - start[0]) * i) / 4,
          start[1] + ((end[1] - start[1]) * i) / 4,
        ]);
        line[3] = end;
        return makeTube(line as unknown as SplinePoles, {
          sourcePoles:
            index === 1
              ? [
                  [0, 0],
                  [0.25, 2 ** -54],
                  [0.75, 0],
                  [1, 0],
                ]
              : [
                  [-1, 0],
                  [-0.75, 0],
                  [-0.25, 0],
                  [0, 0],
                ],
          spanIndex: index,
          startOccurrenceId: `o${index}`,
          endOccurrenceId: `o${(index + 1) % size}`,
        });
      });
      expect(certifier.certifyChain(request(tubes, true))).toEqual({
        kind: "uncertain",
        code: "cubic-tube-knot-incidence-unproven",
        message:
          "A closed chain with a non-parallel knot needs at least five cubics: J2′ not attempted.",
        first: 0,
        second: 1,
      });
    }
  });

  test("tubes must carry one bitwise owner distance (0 and −0 differ)", () => {
    for (const [first, second] of [
      [0.125, 0.125 + 2 ** -55],
      [0, -0],
    ] as const) {
      const [left, right] = knotChain([0.25, 0], { distance: first });
      const other = {
        ...right!,
        reference: { ...right!.reference, distance: second },
      };
      expect(certifier.certifyChain(request([left!, other]))).toEqual({
        kind: "uncertain",
        code: "invalid-cubic-tube-chain",
        message: "The tubes do not carry one bitwise owner offset distance.",
        first: 0,
        second: 1,
      });
    }
    const [left, right] = knotChain([0.25, 0]);
    // Pre-J2′ metadata without a distance is inadmissible.
    const stale = {
      derivative: right!.reference.derivative,
      sourcePoles: right!.reference.sourcePoles,
    };
    expect(
      certifier.certifyChain(
        request([
          left!,
          { ...right!, reference: stale as NeutralCubicTube["reference"] },
        ]),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "invalid-cubic-tube-chain",
      first: 1,
    });
  });

  test("non-consecutive or repeated span indices and a positional (C0) closure never reach J2′", () => {
    for (const spanIndex of [2, 0]) {
      const [left, right] = knotChain([0.25, 2 ** -54]);
      expect(
        certifier.certifyChain(
          request([
            left!,
            { ...right!, source: { ...right!.source, spanIndex } },
          ]),
        ),
      ).toEqual({
        kind: "uncertain",
        code: "cubic-tube-knot-incidence-unproven",
        message:
          "The true offset endpoints of a declared join are not proved identical.",
        first: 0,
        second: 1,
      });
    }
    // A real positional closure is rejected earlier than the occurrence
    // guard: its emitted wrap is not bitwise at join 33/0. The fabricated T1
    // occurrence adversary above still directly protects that later gate.
    for (const distance of [0.1, -0.1]) {
      const geometry = reconstructSpline({
        id: "positional",
        policy: "centripetal-mean-arm-v1",
        closure: "positional",
        points: [...PENTAGON, PENTAGON[0]!].map((position, index) => ({
          occurrenceId: `o${index}`,
          id: `p${index % PENTAGON.length}`,
          position,
          tangent: { kind: "automatic" as const },
        })),
      });
      if (geometry.validity !== "valid") throw new Error("invalid fixture");
      const owner = approximateSplineOffset({
        spans: geometry.spans,
        distance,
        modelingTolerance: TOLERANCE,
      });
      if (!owner.ok) throw new Error(owner.code);
      expect(certifier.certifyChain(request(owner.spans, true))).toMatchObject({
        kind: "uncertain",
        code: "cubic-tube-chain-join-not-bitwise",
        first: 33,
        second: 0,
      });
    }
  });
});

describe("cubic tube chain: one shared proof budget per request", () => {
  // Receipt-backed literals (J2′ implementation evidence, fixtures probe):
  // admission, conversion, every join, knot, leaf and pair under one meter.
  // Pinned, not re-measured, so a per-knot, per-pair or reset meter (which
  // would measure less) cannot recalibrate its own boundary.
  const METERS = [
    [
      "F1 (S1′ joins only)",
      F1,
      0.2,
      { operations: 33_173, euclideanSteps: 8_248 },
    ],
    [
      "asymmetric F1 (one concave J2′ knot)",
      F1_ASYM,
      0.2,
      { operations: 316_931, euclideanSteps: 91_109 },
    ],
  ] as const;

  test.each(METERS)(
    "%s consumes the receipt-pinned whole-request meter",
    (_label, points, distance, meter) => {
      let snapshot: ExactProofBudgetSnapshot | undefined;
      verified(
        createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
          snapshot = value;
        }).certifyChain(request(ownerTubes(points, distance))),
      );
      expect(snapshot).toMatchObject({ ...meter, refinementSteps: 0 });
    },
  );

  test.each(
    METERS.flatMap(([label, points, distance, meter]) =>
      (["operations", "euclideanSteps"] as const).map(
        (kind) => [label, kind, points, distance, meter[kind]] as const,
      ),
    ),
  )(
    "%s: the exact %s count passes and count − 1 exhausts the whole request with no partial certificate",
    (_label, kind, points, distance, total) => {
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: total,
        }).certifyChain(request(ownerTubes(points, distance))).kind,
      ).toBe("verified");
      // Every join, knot and pair alone costs less than count − 1; only one
      // unreset meter across the whole request can exhaust here.
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: total - 1,
        }).certifyChain(request(ownerTubes(points, distance))),
      ).toEqual({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
        message:
          "The deterministic exact-query arithmetic budget was exhausted.",
      });
    },
  );

  test("late exhaustion inside K3 after every J2′ knot succeeded returns only exhausted", () => {
    // Real hook at d = +0.2: its three J2′ knots certify, then K3 subdivides
    // 19 times before the tubes are found to overlap (receipt).
    const tubes = ownerTubes(HOOK, 0.2);
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        refinementSteps: 19,
      }).certifyChain(request(tubes)),
    ).toMatchObject({ code: "cubic-tube-clearance-unproven" });
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        refinementSteps: 18,
      }).certifyChain(request(tubes)),
    ).toEqual(EXHAUSTED_RESULT);
  });

  test("subdivision steps are charged to the same request meter", () => {
    let snapshot: ExactProofBudgetSnapshot | undefined;
    const loop = loopOwnerSpans();
    const result = createCertifiedCubicTubeChainWithBudgetObserverForTest(
      (value) => {
        snapshot = value;
      },
    ).certifyChain(request(loop));
    expect(result).toMatchObject({ code: "cubic-tube-clearance-unproven" });
    const splits = snapshot!.refinementSteps;
    expect(splits).toBeGreaterThan(0);
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        refinementSteps: splits,
      }).certifyChain(request(loop)),
    ).toMatchObject({ code: "cubic-tube-clearance-unproven" });
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        refinementSteps: splits - 1,
      }).certifyChain(request(loop)),
    ).toMatchObject({ code: "exact-query-proof-budget-exhausted" });
  });
});
