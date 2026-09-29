import { describe, expect, test } from "vitest";
import type {
  CubicTubeChainRequest,
  CubicTubeChainResult,
  NeutralCubicPieceTube,
  NeutralCubicTube,
  PieceTubeChainRequest,
  TubeChainPiece,
  TubeChainTrimJoin,
  TubePieceChainResult,
} from "@/contracts/modeling/neutral-curve-query";
import {
  reconstructSpline,
  type SplinePoles,
  type SplineSpan,
  type SplineVector,
} from "@/contracts/sketch/spline-geometry";
import { canonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";
import {
  approximateSplineOffset,
  type AdoptedEndpoint,
} from "@/contracts/sketch/spline-offset-geometry";
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

describe("piece tube chain (L1b): Lemma-T trims under one meter", () => {
  type Vector = readonly [number, number];
  const pieceVerified = (result: TubePieceChainResult) => {
    if (result.kind !== "verified")
      throw new Error(`${result.kind} ${result.code}: ${result.message}`);
    return result.certificate;
  };
  /** Owner-style line tube: emitted = source + d·leftNormal (+ optional shift). */
  const linePiece = (
    start: Vector,
    end: Vector,
    ownerDistance: number,
    {
      reversed = false,
      shift = [0, 0] as Vector,
    }: { reversed?: boolean; shift?: Vector } = {},
  ): TubeChainPiece => {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const normal: Vector = [
      -(end[1] - start[1]) / length,
      (end[0] - start[0]) / length,
    ];
    const offset = (point: Vector): Vector => [
      point[0] + normal[0] * ownerDistance + shift[0],
      point[1] + normal[1] * ownerDistance + shift[1],
    ];
    return {
      kind: "line",
      reversed,
      tube: {
        emitted: [offset(start), offset(end)],
        source: [start, end],
        distance: ownerDistance,
      },
    };
  };
  /** Hand-built adversary cubic leaf with an explicit query domain. */
  const pieceTube = (
    poles: SplinePoles,
    sourcePoles: SplinePoles,
    derivative: Box,
    ownerDistance: number,
    {
      certifiedError = 0,
      sourceLocalInterval = [0, 1] as readonly [number, number],
      queryDomain = [0, 1] as readonly [number, number],
      splineId = "adversary",
    } = {},
  ): NeutralCubicPieceTube => ({
    poles,
    certifiedError,
    reference: { derivative, sourcePoles, distance: ownerDistance },
    source: {
      splineId,
      spanIndex: 0,
      startOccurrenceId: "o0",
      endOccurrenceId: "o1",
    },
    sourceLocalInterval,
    queryDomain,
  });
  const cubicPiece = (
    tubes: readonly NeutralCubicPieceTube[],
    reversed = false,
  ): TubeChainPiece => ({ kind: "cubic", reversed, tubes });
  const pieceRequest = (
    pieces: readonly TubeChainPiece[],
    trims: readonly (readonly [Vector, Vector])[],
    {
      distance,
      closed = false,
      modelingTolerance = TOLERANCE,
    }: {
      distance: number;
      closed?: boolean;
      modelingTolerance?: number;
    },
  ): PieceTubeChainRequest => ({
    modelingTolerance,
    closed,
    distance,
    pieces,
    trims: trims.map(([first, second], jointIndex) => ({
      jointIndex,
      firstParameterBounds: first,
      secondParameterBounds: second,
    })),
  });
  const at = (value: number): Vector => [value, value];

  /**
   * Reversed natural-up straight source (0,0)→(0,0.75), split once at local
   * 0.5 (same-leaf), traversed downward into a line going right at the
   * shared vertex (0,0): a left turn, concave at d = 1/64. Leaf 0 is the
   * trimmed terminal; leaf 1 is its non-terminal neighbour and sits next to
   * the line in the flattened order [leaf 0, leaf 1, line] WITHOUT being
   * adjacent to it. The larger ε on leaf 1 is an honest (loose) bound.
   */
  const D8 = 1 / 64;
  const RISE: SplinePoles = [
    [0, 0],
    [0, 0.25],
    [0, 0.5],
    [0, 0.75],
  ];
  const RISE_BOX: Box = [
    [0, 0],
    [0.75, 0.75],
  ];
  const reversedRise = ({
    upperError = 0.3,
    lowerDomain = [0, 0.5] as Vector,
    ownerDistance = -D8,
  } = {}) => {
    const leaf = (
      poles: SplinePoles,
      sourceLocalInterval: Vector,
      certifiedError: number,
      queryDomain: Vector,
    ) =>
      pieceTube(poles, RISE, RISE_BOX, ownerDistance, {
        certifiedError,
        sourceLocalInterval,
        queryDomain,
        splineId: "rise",
      });
    // Emitted crossing: τ̂ = D8/0.375 on leaf 0, through its stored domain.
    const query =
      lowerDomain[0] + (D8 / 0.375) * (lowerDomain[1] - lowerDomain[0]);
    return pieceRequest(
      [
        cubicPiece(
          [
            leaf(
              [
                [D8, 0],
                [D8, 0.125],
                [D8, 0.25],
                [D8, 0.375],
              ],
              [0, 0.5],
              0,
              lowerDomain,
            ),
            leaf(
              [
                [D8, 0.375],
                [D8, 0.5],
                [D8, 0.625],
                [D8, 0.75],
              ],
              [0.5, 1],
              upperError,
              [0.5, 1],
            ),
          ],
          true,
        ),
        linePiece([0, 0], [1, 0], D8),
      ],
      [[at(query), at(D8)]],
      { distance: D8, modelingTolerance: 1 },
    );
  };

  test("exact reversal: a reversed piece keeps natural leaves, owner distance −d and a fixed s", () => {
    const certificate = pieceVerified(
      certifier.certifyPieceChain(reversedRise()),
    );
    expect(certificate.joins).toHaveLength(2);
    expect(certificate.joins[0]).toMatchObject({
      first: 0,
      second: 1,
      kind: "same-leaf",
    });
    const trim = certificate.joins[1]!;
    expect(trim).toMatchObject({
      kind: "trim",
      jointIndex: 0,
      first: 0,
      second: 2,
      line: "second",
      // s_trav = −sgn(d) (line second), negated exactly on the reversed leaf.
      orientation: 1,
    });
    if (trim.kind !== "trim") throw new Error("not a trim");
    const tau = D8 / 0.375;
    expect(trim.firstRootBounds[0]).toBeLessThanOrEqual(tau);
    expect(trim.firstRootBounds[1]).toBeGreaterThanOrEqual(tau);
    expect(trim.secondRootBounds[0]).toBeLessThanOrEqual(D8);
    expect(trim.secondRootBounds[1]).toBeGreaterThanOrEqual(D8);
    // Leaf 1 and the line are NOT adjacent although flattened neighbours.
    expect(certificate.clearedPairs).toEqual([[1, 2]]);
    expect(certificate.leaves).toHaveLength(3);
  });

  test("signed distance: each piece's owner distance is bitwise reversed ? −d : d, −0 visible", () => {
    expect(
      certifier.certifyPieceChain(reversedRise({ ownerDistance: D8 })),
    ).toMatchObject({
      kind: "uncertain",
      code: "invalid-cubic-tube-chain",
      message: expect.stringContaining("piece-oriented chain distance"),
    });
    const lone = (ownerDistance: number) =>
      certifier.certifyPieceChain(
        pieceRequest(
          [linePiece([0, 0], [1, 0], ownerDistance, { reversed: true })],
          [],
          { distance: 0 },
        ),
      );
    expect(lone(0)).toMatchObject({ code: "invalid-cubic-tube-chain" });
    expect(lone(-0).kind).toBe("verified");
  });

  test("root bounds at 0.1 use the stored query-domain map, never the source-local leaf", () => {
    const trim = pieceVerified(
      certifier.certifyPieceChain(reversedRise({ lowerDomain: [0, 0.1] })),
    ).joins[1]!;
    if (trim.kind !== "trim") throw new Error("not a trim");
    // τ̂ = D8/0.375 ≈ 0.0417; a map over sourceLocalInterval [0, 0.5] would
    // report ≈ 0.0083 instead.
    const tau = D8 / 0.375;
    expect(trim.firstRootBounds[0]).toBeLessThanOrEqual(tau + 1e-15);
    expect(trim.firstRootBounds[1]).toBeGreaterThanOrEqual(tau - 1e-15);
    expect(trim.firstRootBounds[1] - trim.firstRootBounds[0]).toBeLessThan(
      1e-12,
    );
  });

  test("MR5 terminal source gate: a trimmed cubic must expose its natural terminal leaf end", () => {
    const base = reversedRise();
    const cubic = base.pieces[0] as Extract<TubeChainPiece, { kind: "cubic" }>;
    const first = cubic.tubes[0]!;
    expect(
      certifier.certifyPieceChain({
        ...base,
        pieces: [
          {
            ...cubic,
            tubes: [
              { ...first, sourceLocalInterval: [0.125, 0.5] },
              cubic.tubes[1]!,
            ],
          },
          base.pieces[1]!,
        ],
      }),
    ).toMatchObject({
      kind: "uncertain",
      code: "trim-side-unproven",
      message: expect.stringContaining("tangents at the trim vertex"),
    });
  });

  test("near-nonterminal clearance: a flattened neighbour that is not adjacent is cleared, and fails closed when its tube reaches the line", () => {
    expect(
      certifier.certifyPieceChain(reversedRise({ upperError: 0.6 })),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
      first: 1,
      second: 2,
    });
  });

  test("line tube: same-parameter ε from the literal emitted ends, no √ulp cancellation at d = 100", () => {
    const [leaf] = pieceVerified(
      certifier.certifyPieceChain(
        pieceRequest([linePiece([0.1, 0.2], [3.1, 4.2], 100)], [], {
          distance: 100,
        }),
      ),
    ).leaves;
    // The scalar |D|² + d² − 2d·D·ν form would lose ≈ 2e-6 here.
    expect(leaf!.baseErrorStar).toBeLessThan(1e-12);
    expect(leaf!.clearanceRadius).toBe(leaf!.baseErrorStar);
    // A literal end moved off the true offset is measured, never recomputed.
    const [moved] = pieceVerified(
      certifier.certifyPieceChain(
        pieceRequest(
          [linePiece([0, 0], [1, 0], 0.25, { shift: [0, 2 ** -12] })],
          [],
          { distance: 0.25 },
        ),
      ),
    ).leaves;
    expect(moved!.baseErrorStar).toBeGreaterThanOrEqual(2 ** -12);
    expect(
      certifier.certifyPieceChain(
        pieceRequest(
          [linePiece([0, 0], [1, 0], 0.25, { shift: [0, 2 ** -9] })],
          [],
          { distance: 0.25 },
        ),
      ),
    ).toMatchObject({ code: "line-tube-error-unproven" });
  });

  // CX1 (review §1.3): source line (0,0)→(0.01,0), d = 0.0103, a straight
  // curve up from the shared vertex whose emitted cubic is shifted 4e-4 along
  // ℓ. Every emitted check passes (t̂ = 0.01 interior), but the true line
  // offset is consumed: t* ≈ −0.03, and η/L_lo = 0.08 > t̂.
  const CX1_D = 0.0103;
  const cx1 = (lineStart: Vector) => {
    const x = 0.0001;
    const up: SplinePoles = [
      [0.01, 0],
      [0.01, 0.25],
      [0.01, 0.5],
      [0.01, 0.75],
    ];
    const tHat = (x - lineStart[0]) / (0.01 - lineStart[0]);
    return pieceRequest(
      [
        linePiece(lineStart, [0.01, 0], CX1_D),
        cubicPiece([
          pieceTube(
            [
              [x, 0],
              [x, 0.25],
              [x, 0.5],
              [x, 0.75],
            ],
            up,
            RISE_BOX,
            CX1_D,
            { certifiedError: 4.0001e-4 },
          ),
        ]),
      ],
      [
        [
          [tHat - 1e-7, tHat + 1e-7],
          [CX1_D / 0.75 - 1e-7, CX1_D / 0.75 + 1e-7],
        ],
      ],
      { distance: CX1_D },
    );
  };

  test("X1/CX1 line-consumed: the true line root leaves the segment and fails closed", () => {
    expect(certifier.certifyPieceChain(cx1([0, 0]))).toMatchObject({
      kind: "uncertain",
      code: "trim-window-unproven",
      message: expect.stringContaining("strictly inside"),
    });
    // Control: the same corner on a long line keeps its true root inside.
    const certificate = pieceVerified(
      certifier.certifyPieceChain(cx1([-0.99, 0])),
    );
    expect(certificate.joins).toMatchObject([
      { kind: "trim", line: "first", orientation: 1 },
    ]);
  });

  test("X2/CX2 convex gap: a coincident-style convex line↔line corner is never a trim", () => {
    // Right turn of 1e-6 rad with a 1e-3 source gap; d > 0 (convex).
    const result = certifier.certifyPieceChain(
      pieceRequest(
        [
          linePiece([-1, 0], [0, 0], 0.01),
          linePiece([-0.001, 5e-13], [0.999, 5e-13 - 1e-6], 0.01),
        ],
        [[at(0.999), at(0.0005)]],
        { distance: 0.01 },
      ),
    );
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "trim-side-unproven",
      message: expect.stringContaining("not concave"),
    });
    // T08b-d R1: a side failure is never a magnitude failure (never flips).
    expect(result).not.toHaveProperty("magnitude");
  });

  test("X3 convex shared vertex with λ < 0 on the terminal leaf: the gate, not a free sign, decides", () => {
    // O′ = −S′ (λ = −1) would pass the leaf-wide cone with s = +1.
    const down: SplinePoles = [
      [0, 0],
      [0.25, -0.25],
      [0.5, -0.5],
      [0.75, -0.75],
    ];
    expect(
      certifier.certifyPieceChain(
        pieceRequest(
          [
            linePiece([-1, 0], [0, 0], 0.125),
            cubicPiece([
              pieceTube(
                down,
                down,
                [
                  [-0.75, -0.75],
                  [0.75, 0.75],
                ],
                0.125,
              ),
            ]),
          ],
          [[at(0.9), at(0.2)]],
          { distance: 0.125 },
        ),
      ),
    ).toMatchObject({ kind: "uncertain", code: "trim-side-unproven" });
  });

  /** U chain line → straight cubic up (h = 3/256) → line back, d/h = 0.45. */
  const uChain = (curveError: number, modelingTolerance = 1e-2) => {
    const h = 3 / 256;
    const d = 0.45 * h;
    const up: SplinePoles = [
      [0, 0],
      [0, 1 / 256],
      [0, 2 / 256],
      [0, 3 / 256],
    ];
    return pieceRequest(
      [
        linePiece([-1, 0], [0, 0], d),
        cubicPiece([
          pieceTube(
            up.map(([, y]) => [-d, y]) as unknown as SplinePoles,
            up,
            [
              [0, 0],
              [h, h],
            ],
            d,
            { certifiedError: curveError },
          ),
        ]),
        linePiece([0, h], [-1, h], d),
      ],
      [
        [at(1 - d), at(0.45)],
        [at(0.55), at(d)],
      ],
      { distance: d, modelingTolerance },
    );
  };

  describe("Q4-E1 local ε at Lemma-T trims (certifier-input fixtures, not owner-reachable)", () => {
    // The uChain geometry with both crossings 1/64 of the cubic from its
    // vertices (d = h/64): E = O exactly, so any nonnegative metadata is an
    // honest bound; "owner-like" is R = ε, π = 0. Leaf-wide, each tail M·δ is
    // ≈ ε_A + ε, so the cubic star ε + 2(ε_A + ε) exceeds τ = 2ε.
    const H = 3 / 256;
    const DL = H / 64;
    const UP: SplinePoles = [
      [0, 0],
      [0, 1 / 256],
      [0, 2 / 256],
      [0, 3 / 256],
    ];
    const BOX: Box = [
      [0, 0],
      [H, H],
    ];
    type Local = {
      readonly hermiteRemainder: number;
      readonly polePerturbations: readonly [number, number, number, number];
    };
    const ownerLike = (error: number): Local => ({
      hermiteRemainder: error,
      polePerturbations: [0, 0, 0, 0],
    });
    const withLocal = (
      tube: NeutralCubicPieceTube,
      local: Local | undefined,
    ): NeutralCubicPieceTube =>
      local
        ? { ...tube, reference: { ...tube.reference, localError: local } }
        : tube;
    const localU = (
      curveError: number,
      modelingTolerance: number,
      local: Local | undefined,
    ) =>
      pieceRequest(
        [
          linePiece([-1, 0], [0, 0], DL),
          cubicPiece([
            withLocal(
              pieceTube(
                UP.map(([, y]) => [-DL, y]) as unknown as SplinePoles,
                UP,
                BOX,
                DL,
                { certifiedError: curveError },
              ),
              local,
            ),
          ]),
          linePiece([0, H], [-1, H], DL),
        ],
        [
          [at(1 - DL), at(1 / 64)],
          [at(63 / 64), at(DL)],
        ],
        { distance: DL, modelingTolerance },
      );
    /** Line → cubic only; `reversed` traverses the cubic downward (natural data flipped). */
    const localL = (
      reversed: boolean,
      curveError: number,
      modelingTolerance: number,
      local: Local,
    ) => {
      const natural = reversed
        ? ([...UP].reverse() as unknown as SplinePoles)
        : UP;
      const ownerDistance = reversed ? -DL : DL;
      const box: Box = reversed
        ? [
            [0, 0],
            [-H, -H],
          ]
        : BOX;
      return pieceRequest(
        [
          linePiece([-1, 0], [0, 0], DL),
          cubicPiece(
            [
              withLocal(
                pieceTube(
                  natural.map(([, y]) => [-DL, y]) as unknown as SplinePoles,
                  natural,
                  box,
                  ownerDistance,
                  { certifiedError: curveError },
                ),
                local,
              ),
            ],
            reversed,
          ),
        ],
        [[at(1 - DL), at(reversed ? 63 / 64 : 1 / 64)]],
        { distance: DL, modelingTolerance },
      );
    };
    const EPS = 2 ** -17;

    test("composition band: leaf-wide ε + 2(ε_A + ε) > τ = 2ε; owner-like metadata upgrades both trims and verifies", () => {
      expect(
        certifier.certifyPieceChain(localU(EPS, 2 * EPS, undefined)),
      ).toMatchObject({
        kind: "uncertain",
        code: "trim-composition-unproven",
        message: expect.stringContaining("corrected base error exceeds"),
      });
      const certificate = pieceVerified(
        certifier.certifyPieceChain(localU(EPS, 2 * EPS, ownerLike(EPS))),
      );
      const trims = certificate.joins.filter((join) => join.kind === "trim");
      expect(trims).toHaveLength(2);
      for (const trim of trims) {
        if (trim.kind !== "trim") throw new Error("trim");
        // Local tail M·δ = ε_A + R/256 (s = 1/64): far below the leaf-wide ε.
        expect(trim.tail).toBeLessThan(EPS / 64);
      }
      // The exact true roots: 1/64 and 63/64 on the cubic, 1 − d and d on the lines.
      const [first, second] = trims as TubeChainTrimJoin[];
      expect(first!.secondRootBounds[0]).toBeLessThan(1 / 64);
      expect(first!.secondRootBounds[1]).toBeGreaterThan(1 / 64);
      expect(second!.firstRootBounds[0]).toBeLessThan(63 / 64);
      expect(second!.firstRootBounds[1]).toBeGreaterThan(63 / 64);
      // The cubic star keeps the leaf-wide ε plus both local tails.
      expect(certificate.leaves[1]!.baseErrorStar).toBeGreaterThan(EPS);
      for (const leaf of certificate.leaves)
        expect(leaf.displacementBound).toBeLessThanOrEqual(2 * EPS);
    });

    test("the cubic star keeps the leaf-wide ε: ε = τ exactly stays trim-composition-unproven after the upgrade", () => {
      expect(
        certifier.certifyPieceChain(localU(EPS, EPS, ownerLike(EPS))),
      ).toMatchObject({
        kind: "uncertain",
        code: "trim-composition-unproven",
        message: expect.stringContaining("corrected base error exceeds"),
        first: 1,
      });
    });

    test("window band: leaf-wide δ = (ε_A + ε)/h ≥ 1/64 pushes the curve root past the vertex; the local δ keeps it interior", () => {
      const error = 2 ** -12;
      expect(
        certifier.certifyPieceChain(localU(error, 2 ** -10, undefined)),
      ).toMatchObject({
        kind: "uncertain",
        code: "trim-window-unproven",
        message: expect.stringContaining(
          "not strictly inside its terminal leaf",
        ),
      });
      pieceVerified(
        certifier.certifyPieceChain(localU(error, 2 ** -10, ownerLike(error))),
      );
    });

    test("honest π on the FAR natural pole: forward and reversed cubics verify; on the vertex pole there is no gain", () => {
      // Forward: the vertex is natural pole 0; reversed: natural pole 3.
      for (const reversed of [false, true]) {
        const far: Local = {
          hermiteRemainder: 0,
          polePerturbations: reversed ? [EPS, 0, 0, 0] : [0, 0, 0, EPS],
        };
        const vertex: Local = {
          hermiteRemainder: 0,
          polePerturbations: reversed ? [0, 0, 0, EPS] : [EPS, 0, 0, 0],
        };
        pieceVerified(
          certifier.certifyPieceChain(localL(reversed, EPS, 2 * EPS, far)),
        );
        expect(
          certifier.certifyPieceChain(localL(reversed, EPS, 2 * EPS, vertex)),
          `reversed ${reversed}`,
        ).toMatchObject({
          kind: "uncertain",
          code: "trim-composition-unproven",
        });
      }
    });

    test("MR1 stays composition-unproven: its crossing at s = 0.45 has 16R·s² > ε, so the local bound is the leaf-wide ε", () => {
      const base = uChain(1e-5, 1e-5);
      const cubic = base.pieces[1] as Extract<
        TubeChainPiece,
        { kind: "cubic" }
      >;
      expect(
        certifier.certifyPieceChain({
          ...base,
          pieces: [
            base.pieces[0]!,
            { ...cubic, tubes: [withLocal(cubic.tubes[0]!, ownerLike(1e-5))] },
            base.pieces[2]!,
          ],
        }),
      ).toMatchObject({
        kind: "uncertain",
        code: "trim-composition-unproven",
      });
    });

    /** Every trim's cubic-side stored bounds widened by `width` around the true root. */
    const widened = (
      request: PieceTubeChainRequest,
      width: number,
    ): PieceTubeChainRequest => ({
      ...request,
      trims: request.trims.map((trim) => {
        const side =
          trim.jointIndex === 0
            ? "secondParameterBounds"
            : "firstParameterBounds";
        const [low, high] = trim[side];
        return { ...trim, [side]: [low - width, high + width] as const };
      }),
    });
    test.each([
      ["composition band", EPS, 2 * EPS, "trim-composition-unproven"],
      ["window band", 2 ** -12, 2 ** -10, "trim-window-unproven"],
    ] as const)(
      "wide stored curve bounds (not owner-reachable): the local ε reaches the FAR stored bound of U, so R = 128ε rejects the %s",
      (_label, error, tau, code) => {
        // Honest for any R (E = O exactly). With bounds 1/64 ± 2⁻⁷ the far
        // reach is 3/128 and the near one 1/128 (s² ratio 9). Review-fixes
        // probe: the far-bound (current) window rejects from R ≈ 64ε /
        // 48ε, a NEAR-bound window would verify up to R ≥ 192ε / 256ε.
        // Semantic killer of the near-bound mutant (math review A1).
        const request = (remainder: number) =>
          widened(localU(error, tau, ownerLike(remainder)), 2 ** -7);
        pieceVerified(certifier.certifyPieceChain(request(32 * error)));
        expect(certifier.certifyPieceChain(request(128 * error))).toMatchObject(
          { kind: "uncertain", code },
        );
      },
    );

    // Whole-request literals of the two owner-like band rows (T08b-c meter
    // review R1, two processes, re-measured in the review fixes) pinned on
    // operations, Euclid and integerBits. The staged caps land INSIDE the
    // Lemma-T upgrade (instrumented stage map): precharge, δ, `place` (roots
    // and outputs) and the leaf-loop recomposition. The composition row
    // upgrades in the leaf loop, the window row at the trim stage.
    // Load-bearing exhaustion-swallow, once-guard and precharge killers.
    const LOCAL_PINS = [
      [
        "composition band (leaf-loop upgrades)",
        () => localU(EPS, 2 * EPS, ownerLike(EPS)),
        { operations: 19_455, euclideanSteps: 2_337, integerBits: 286 },
        // Upgrade 1 ops [11 967, 14 317], upgrade 2 [14 863, 17 606].
        [
          ["operations", 12_000], // precharge
          ["operations", 12_500], // δ
          ["operations", 13_500], // place, upgrade 1
          ["operations", 16_500], // place, upgrade 2
          ["operations", 17_400], // recomposition
          ["euclideanSteps", 1_300], // place, upgrade 1
          ["euclideanSteps", 1_800], // place, upgrade 2
          ["euclideanSteps", 2_050], // recomposition
        ],
      ],
      [
        "window band (trim-stage upgrades)",
        () => localU(2 ** -12, 2 ** -10, ownerLike(2 ** -12)),
        { operations: 16_535, euclideanSteps: 1_744, integerBits: 286 },
        // Trim 1 ops [7 917, 10 001], trim 2 [11 889, 14 107].
        [
          ["operations", 7_950], // precharge, trim 1
          ["operations", 8_450], // δ, trim 1
          ["operations", 9_000], // place, trim 1
          ["operations", 13_000], // place, trim 2
          ["euclideanSteps", 800], // place, trim 1
          ["euclideanSteps", 1_200], // place, trim 2
        ],
      ],
    ] as const;
    const METERS = ["operations", "euclideanSteps", "integerBits"] as const;

    test.each(LOCAL_PINS)(
      "fabricated Lemma-T local literal, %s (observer)",
      (_label, request, literal) => {
        let snapshot: ExactProofBudgetSnapshot | undefined;
        expect(
          createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
            snapshot = value;
          }).certifyPieceChain(request()).kind,
        ).toBe("verified");
        expect({
          operations: snapshot!.operations,
          euclideanSteps: snapshot!.euclideanSteps,
          integerBits: Math.max(
            snapshot!.maxStoredBits,
            snapshot!.maxPreProductBits,
          ),
        }).toEqual(literal);
      },
    );

    test.each(
      LOCAL_PINS.flatMap(([label, request, literal]) =>
        METERS.map((kind) => [label, kind, request, literal[kind]] as const),
      ),
    )(
      "fabricated Lemma-T local, %s: the literal %s count passes and count − 1 exhausts the whole request",
      (_label, kind, request, total) => {
        expect(
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [kind]: total,
          }).certifyPieceChain(request()).kind,
        ).toBe("verified");
        expect(
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [kind]: total - 1,
          }).certifyPieceChain(request()),
        ).toEqual(EXHAUSTED_RESULT);
      },
    );

    test.each(
      LOCAL_PINS.flatMap(([label, request, , staged]) =>
        staged.map(([kind, cap]) => [label, kind, cap, request] as const),
      ),
    )(
      "staged cap inside the Lemma-T upgrade (%s, %s = %s) exhausts the request, never a window or composition failure code",
      (_label, kind, cap, request) => {
        expect(
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [kind]: cap,
          }).certifyPieceChain(request()),
        ).toEqual(EXHAUSTED_RESULT);
      },
    );
  });

  test("MR1 trim composition: both Mδ tails are included in the corrected error", () => {
    expect(certifier.certifyPieceChain(uChain(1e-5, 1e-5))).toMatchObject({
      kind: "uncertain",
      code: "trim-composition-unproven",
      message: expect.stringContaining("corrected base error exceeds"),
      first: 0,
    });
  });

  test("MR4 leaf-wide cone: a terminal derivative enclosure may not reach zero", () => {
    const base = uChain(1e-5);
    const cubic = base.pieces[1] as Extract<TubeChainPiece, { kind: "cubic" }>;
    expect(
      certifier.certifyPieceChain({
        ...base,
        pieces: [
          base.pieces[0]!,
          {
            ...cubic,
            tubes: cubic.tubes.map((tube) => ({
              ...tube,
              reference: {
                ...tube.reference,
                derivative: [
                  [0, 0],
                  [0, 3 / 256],
                ],
              },
            })),
          },
          base.pieces[2]!,
        ],
      }),
    ).toMatchObject({
      kind: "uncertain",
      code: "trim-window-unproven",
      message: expect.stringContaining("leaf-wide cone"),
      first: 0,
      second: 1,
    });
  });

  test("MR7 curve-side terminal removal: an admission adversary at the curve end is rejected", () => {
    const base = uChain(1e-5);
    expect(
      certifier.certifyPieceChain({
        ...base,
        trims: [
          { ...base.trims[0]!, secondParameterBounds: [0, 0] },
          base.trims[1]!,
        ],
      }),
    ).toMatchObject({
      kind: "uncertain",
      code: "trim-window-unproven",
      message: expect.stringContaining("strictly inside"),
      first: 0,
      second: 1,
    });
  });

  test("X4 both-end order: a doubly trimmed single leaf needs strictly ordered true-root enclosures", () => {
    expect(certifier.certifyPieceChain(uChain(1.2e-3))).toMatchObject({
      kind: "uncertain",
      code: "trim-window-unproven",
      message: expect.stringContaining("retained domain"),
      first: 1,
    });
    const certificate = pieceVerified(
      certifier.certifyPieceChain(uChain(1e-5)),
    );
    expect(certificate.joins.map((join) => join.kind)).toEqual([
      "trim",
      "trim",
    ]);
    expect(certificate.clearedPairs).toEqual([[0, 2]]);
  });

  test("X6 a short line trimmed at both ends by widened line-side enclosures fails closed", () => {
    const d = 0.0045;
    const s = 0.01;
    expect(
      certifier.certifyPieceChain(
        pieceRequest(
          [
            linePiece([-1, 0], [0, 0], d),
            linePiece([0, 0], [0, s], d, { shift: [0, 5e-4] }),
            linePiece([0, s], [-1, s], d),
          ],
          [
            [at(1 - d), at(0.4)],
            [at(0.5), at(d)],
          ],
          // Room for L1's own trim-end displacement ε_B + Mδ ≈ 1e-3.
          { distance: d, modelingTolerance: 2e-3 },
        ),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "trim-window-unproven",
      message: expect.stringContaining("retained domain"),
      first: 1,
    });
  });

  test("X5 premise-violating admission adversary: a claimed trim enclosure inside the J2′-removed end fails closed", () => {
    // The stored trim bounds are deliberately not a true-root enclosure: this
    // is admission-adversary coverage only, not isolated mixed-order evidence.
    const length = 5033 * C;
    const inset = 1007 * C;
    const tubes = straightTubeChain(
      [axis(0, inset, length - inset, length), turned([length, 0], 1)],
      0.1,
    );
    const pieces = (tau: number) =>
      pieceRequest(
        [
          linePiece([0, 1], [0, 0], 0.1),
          cubicPiece(tubes.map((tube) => ({ ...tube, queryDomain: [0, 1] }))),
        ],
        [[at(0.5), at(tau)]],
        { distance: 0.1 },
      );
    // The cubic piece alone certifies its concave J2′ knot with t_e > 0.5.
    const knot = verified(certifier.certifyChain(request(tubes))).joins[0]!;
    if (knot.kind !== "nonparallel-knot" || knot.side !== "concave")
      throw new Error("fixture must keep its concave J2′ knot");
    expect(knot.trim[0]).toBeGreaterThan(0.5);
    expect(certifier.certifyPieceChain(pieces(0.5))).toMatchObject({
      kind: "uncertain",
      code: "trim-window-unproven",
      message: expect.stringContaining("retained domain"),
      first: 1,
    });
  });

  test("a closed mixed chain with any J2′ knot keeps the flattened n ≥ 5 gate", () => {
    const spans = makeOwnerTubes(F1_ASYM, 0.2);
    if (!spans.ok) throw new Error(spans.code);
    const knotPair = spans.spans.slice(2, 4);
    expect(
      certifier.certifyPieceChain(
        pieceRequest(
          [
            cubicPiece(
              knotPair.map((span) => ({
                ...span,
                queryDomain: span.sourceInterval,
              })),
            ),
            linePiece([2.5, 0], [2.5, 1], 0.2),
            linePiece([2.5, 1], [0, 1], 0.2),
          ],
          [
            [at(0.5), at(0.5)],
            [at(0.5), at(0.5)],
            [at(0.5), at(0.5)],
          ],
          { distance: 0.2, closed: true },
        ),
      ),
    ).toMatchObject({
      code: KNOT_UNPROVEN_CODE,
      message: expect.stringContaining("at least five"),
    });
  });

  test("a cubic↔cubic trim is no longer unsupported: a collinear pair fails the H2 side gate", () => {
    const tube = pieceTube(straight(0, 1), LINE_SOURCE, POSITIVE_X, 0.125);
    expect(
      certifier.certifyPieceChain(
        pieceRequest(
          [cubicPiece([tube]), cubicPiece([tube])],
          [[at(0.5), at(0.5)]],
          {
            distance: 0.125,
          },
        ),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "trim-side-unproven",
      message: expect.stringContaining("not concave"),
    });
  });
  // Literal whole-chain meters, measured once on the baseline implementation
  // (evidence piece-meter-measurement.log) and pinned: a per-piece, per-trim
  // or reset meter measures less and cannot recalibrate its own boundary.
  const PIECE_METERS = [
    [
      "reversed rise (same-leaf + trim)",
      () => reversedRise(),
      {
        operations: 8_638,
        euclideanSteps: 607,
      },
    ],
    [
      "U chain (two trims on one leaf)",
      () => uChain(1e-5),
      {
        operations: 21_155,
        euclideanSteps: 3_822,
      },
    ],
  ] as const;

  test.each(
    PIECE_METERS.flatMap(([label, build, meter]) =>
      (["operations", "euclideanSteps"] as const).map(
        (kind) => [label, kind, build, meter[kind]] as const,
      ),
    ),
  )(
    "%s: the literal %s count passes and count − 1 exhausts the whole request with no partial certificate",
    (_label, kind, build, total) => {
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: total,
        }).certifyPieceChain(build()).kind,
      ).toBe("verified");
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: total - 1,
        }).certifyPieceChain(build()),
      ).toEqual(EXHAUSTED_RESULT);
    },
  );

  test("a single cubic piece without trims is the legacy chain: identical receipt-pinned meter", () => {
    for (const [points, meter] of [
      [F1, { operations: 33_173, euclideanSteps: 8_248 }],
      [F1_ASYM, { operations: 316_931, euclideanSteps: 91_109 }],
    ] as const) {
      const tubes = ownerTubes(points, 0.2).map((tube) => ({
        ...tube,
        queryDomain: [0, 1] as const,
      }));
      let snapshot: ExactProofBudgetSnapshot | undefined;
      const result = createCertifiedCubicTubeChainWithBudgetObserverForTest(
        (value) => {
          snapshot = value;
        },
      ).certifyPieceChain(
        pieceRequest([cubicPiece(tubes)], [], { distance: 0.2 }),
      );
      expect(result).toEqual(certifier.certifyChain(request(tubes)));
      expect(snapshot).toMatchObject({ ...meter, refinementSteps: 0 });
    }
  });

  test("pieces and trims are precharged exactly before any element read", () => {
    const base = uChain(1e-5);
    const read = new Error("element read");
    const untouchable = <T extends object>(target: T) =>
      new Proxy(target, {
        get(inner, key, receiver) {
          if (key === "length") return Reflect.get(inner, key, receiver);
          throw read;
        },
      });
    const run = (operations?: number) => {
      const snapshots: ExactProofBudgetSnapshot[] = [];
      const chain =
        operations === undefined
          ? createCertifiedCubicTubeChainWithBudgetObserverForTest((value) =>
              snapshots.push(value),
            )
          : createCertifiedCubicTubeChainWithLowerBudgetForTest({ operations });
      let thrown: unknown;
      try {
        return {
          result: chain.certifyPieceChain({
            ...base,
            pieces: untouchable([...base.pieces]),
            trims: untouchable([...base.trims]),
          }),
          snapshots,
        };
      } catch (error) {
        thrown = error;
      }
      return { thrown, snapshots };
    };
    expect(run(4)).toEqual({ result: EXHAUSTED_RESULT, snapshots: [] });
    expect(run(5).thrown).toBe(read);
    const production = run();
    expect(production.thrown).toBe(read);
    expect(production.snapshots).toEqual([
      expect.objectContaining({ operations: 5, euclideanSteps: 0 }),
    ]);
  });

  test("each cubic piece's leaves are charged before they are enumerated", () => {
    const base = uChain(1e-5);
    const cubic = base.pieces[1] as Extract<TubeChainPiece, { kind: "cubic" }>;
    let reads = 0;
    const tubes = new Proxy(new Array(1_000).fill(cubic.tubes[0]), {
      get(inner, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(inner, key, receiver);
      },
    });
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        operations: 1_004,
      }).certifyPieceChain({
        ...base,
        pieces: [base.pieces[0]!, { ...cubic, tubes }, base.pieces[2]!],
      }),
    ).toEqual(EXHAUSTED_RESULT);
    expect(reads).toBe(0);
  });

  test("one observer snapshot per piece request, delegate included", () => {
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const chain = createCertifiedCubicTubeChainWithBudgetObserverForTest(
      (value) => snapshots.push(value),
    );
    expect(chain.certifyPieceChain(uChain(1e-5)).kind).toBe("verified");
    const tubes = ownerTubes(F1, 0.2).map((tube) => ({
      ...tube,
      queryDomain: [0, 1] as const,
    }));
    expect(
      chain.certifyPieceChain(
        pieceRequest([cubicPiece(tubes)], [], { distance: 0.2 }),
      ).kind,
    ).toBe("verified");
    const cubic = uChain(1e-5).pieces[1] as Extract<
      TubeChainPiece,
      { kind: "cubic" }
    >;
    expect(
      chain.certifyPieceChain({
        ...uChain(1e-5),
        pieces: [
          uChain(1e-5).pieces[0]!,
          { ...cubic, tubes: new Array(10_000_000) },
          uChain(1e-5).pieces[2]!,
        ],
      }),
    ).toEqual(EXHAUSTED_RESULT);
    expect(snapshots.map(({ operations }) => operations)).toEqual([
      21_155, 33_173, 10_000_005,
    ]);
  });

  test("a line tube needs exactly two emitted and two source ends", () => {
    const base = uChain(1e-5);
    const line = base.pieces[0] as Extract<TubeChainPiece, { kind: "line" }>;
    for (const key of ["emitted", "source"] as const) {
      const ends = [...line.tube[key], line.tube[key][1]];
      expect(
        certifier.certifyPieceChain({
          ...base,
          pieces: [
            {
              ...line,
              tube: {
                ...line.tube,
                [key]: ends as unknown as typeof line.tube.emitted,
              },
            },
            base.pieces[1]!,
            base.pieces[2]!,
          ],
        }),
      ).toMatchObject({ code: "invalid-cubic-tube-chain", first: 0 });
    }
  });

  test("a line tube whose two emitted ends are bitwise equal is not admitted, even as a lone piece (math review A1)", () => {
    // Formerly verified: a lone line piece is never joint-queried, so admission
    // is the only guard (T08b-a-math-review-evidence/zero-length-line.result.json).
    expect(
      certifier.certifyPieceChain({
        modelingTolerance: 1e-3,
        closed: false,
        distance: 0.5,
        pieces: [
          {
            kind: "line",
            reversed: false,
            tube: {
              emitted: [
                [0, 0],
                [0, 0],
              ],
              source: [
                [0, -0.5],
                [1e-4, -0.5],
              ],
              distance: 0.5,
            },
          },
        ],
        trims: [],
      }),
    ).toMatchObject({
      kind: "uncertain",
      code: "invalid-cubic-tube-chain",
      message: "Tube 0: coincident emitted line ends.",
      first: 0,
    });
  });
});

describe("piece tube chain (S2): cubic↔cubic graph trims (certifier-input fixtures, not owner-reachable)", () => {
  type Vector = readonly [number, number];
  const H = 1 / 16;
  /** Straight source leg: poles start + i·step (exact for dyadic data). */
  const legPoles = (start: Vector, step: Vector): SplinePoles =>
    [0, 1, 2, 3].map((index) => [
      start[0] + index * step[0],
      start[1] + index * step[1],
    ]) as unknown as SplinePoles;
  /** Exact hodograph hull 3·(Pᵢ₊₁ − Pᵢ) of a dyadic source (O′ = S′ when straight). */
  const hodographBox = (poles: SplinePoles): Box =>
    ([0, 1] as const).map((axis) => {
      const steps = [0, 1, 2].map(
        (index) => 3 * (poles[index + 1]![axis] - poles[index]![axis]),
      );
      return [Math.min(...steps), Math.max(...steps)] as const;
    }) as unknown as Box;
  interface Leg {
    readonly source: SplinePoles;
    /** d·N of the natural source, exact where dyadic. */
    readonly offset: Vector;
    readonly error: number;
    readonly box?: Box;
    readonly emitted?: SplinePoles;
    /** Q4-E1 metadata (R, πᵢ in TRAVERSAL pole order); absent = none. */
    readonly local?: {
      readonly remainder: number;
      readonly poles: readonly [number, number, number, number];
    };
  }
  const tubeOf = (
    leg: Leg,
    ownerDistance: number,
    splineId: string,
  ): NeutralCubicPieceTube => ({
    poles:
      leg.emitted ??
      (leg.source.map(([x, y]) => [
        x + leg.offset[0],
        y + leg.offset[1],
      ]) as unknown as SplinePoles),
    certifiedError: leg.error,
    reference: {
      derivative: leg.box ?? hodographBox(leg.source),
      sourcePoles: leg.source,
      distance: ownerDistance,
      ...(leg.local
        ? {
            localError: {
              hermiteRemainder: leg.local.remainder,
              polePerturbations: leg.local.poles,
            },
          }
        : {}),
    },
    source: {
      splineId,
      spanIndex: 0,
      startOccurrenceId: `${splineId}-o0`,
      endOccurrenceId: `${splineId}-o1`,
    },
    sourceLocalInterval: [0, 1],
    queryDomain: [0, 1],
  });
  const bezier = (poles: SplinePoles, u: number): Vector => {
    const w = [(1 - u) ** 3, 3 * u * (1 - u) ** 2, 3 * u * u * (1 - u), u ** 3];
    return [0, 1].map((axis) =>
      poles.reduce((sum, pole, index) => sum + w[index]! * pole[axis]!, 0),
    ) as unknown as Vector;
  };
  const bezierDerivative = (poles: SplinePoles, u: number): Vector => {
    const w = [(1 - u) ** 2, 2 * u * (1 - u), u * u];
    return [0, 1].map(
      (axis) =>
        3 *
        [0, 1, 2].reduce(
          (sum, index) =>
            sum + w[index]! * (poles[index + 1]![axis]! - poles[index]![axis]!),
          0,
        ),
    ) as unknown as Vector;
  };
  /** Float Newton for the emitted crossing (natural τ), test oracle only. */
  const emittedCrossing = (
    first: SplinePoles,
    second: SplinePoles,
    start: Vector,
  ): Vector => {
    let [u, v] = start;
    for (let step = 0; step < 60; step += 1) {
      const p = bezier(first, u);
      const q = bezier(second, v);
      const a = bezierDerivative(first, u);
      const b = bezierDerivative(second, v);
      const r = [p[0] - q[0], p[1] - q[1]];
      const det = -a[0] * b[1] + a[1] * b[0];
      u -= (-r[0] * b[1] + r[1] * b[0]) / det;
      v -= (a[0] * r[1] - a[1] * r[0]) / det;
    }
    return [u, v];
  };
  const PAD = 1e-9;
  /**
   * Two one-leaf cubic pieces P → Q meeting at a declared vertex; the stored
   * trim bounds enclose the float emitted crossing ± PAD. `reversed` flips a
   * piece's natural data (poles reversed, owner distance −d, same geometry).
   */
  const graphRequest = ({
    first,
    second,
    distance,
    modelingTolerance = TOLERANCE,
    reversed = [false, false],
    guess = [0.9, 0.1],
    bounds,
  }: {
    first: Leg;
    second: Leg;
    distance: number;
    modelingTolerance?: number;
    reversed?: readonly [boolean, boolean];
    guess?: Vector;
    bounds?: readonly [Vector, Vector];
  }): PieceTubeChainRequest => {
    const natural = (leg: Leg, flip: boolean): Leg =>
      flip
        ? {
            ...leg,
            source: [...leg.source].reverse() as unknown as SplinePoles,
            ...(leg.emitted
              ? {
                  emitted: [...leg.emitted].reverse() as unknown as SplinePoles,
                }
              : {}),
            ...(leg.box
              ? {
                  box: leg.box.map(
                    ([low, high]) => [-high, -low] as const,
                  ) as unknown as Box,
                }
              : {}),
            ...(leg.local
              ? {
                  local: {
                    ...leg.local,
                    poles: [...leg.local.poles].reverse() as unknown as [
                      number,
                      number,
                      number,
                      number,
                    ],
                  },
                }
              : {}),
          }
        : leg;
    const tubes = [first, second].map((leg, index) =>
      tubeOf(
        natural(leg, reversed[index]!),
        reversed[index] ? -distance : distance,
        index === 0 ? "P" : "Q",
      ),
    );
    const traversal = (value: number, index: number) =>
      reversed[index] ? 1 - value : value;
    const [u, v] = emittedCrossing(tubes[0]!.poles, tubes[1]!.poles, [
      traversal(guess[0], 0),
      traversal(guess[1], 1),
    ]);
    return {
      modelingTolerance,
      closed: false,
      distance,
      pieces: tubes.map((tube, index) => ({
        kind: "cubic" as const,
        reversed: reversed[index]!,
        tubes: [tube],
      })),
      trims: [
        {
          jointIndex: 0,
          firstParameterBounds: bounds?.[0] ?? [u! - PAD, u! + PAD],
          secondParameterBounds: bounds?.[1] ?? [v! - PAD, v! + PAD],
        },
      ],
    };
  };
  /**
   * Straight 3-4-5 legs into and out of the origin: P along (4, −3), Q along
   * (4, 3), a left turn of 2·atan(3/4), concave at d > 0. d = 5/64 makes
   * d·N = (±3/64, 1/16) exact, so the emitted legs ARE the true offsets and
   * the true slopes are exactly ∓3/4 and 3/4 against e = (24h, 0).
   */
  const D = 5 / 64;
  const P_LEG = (h = H): Leg => ({
    source: legPoles([-12 * h, 9 * h], [4 * h, -3 * h]),
    offset: [3 / 64, 1 / 16],
    error: 2 ** -11,
  });
  const Q_LEG = (h = H): Leg => ({
    source: legPoles([0, 0], [4 * h, 3 * h]),
    offset: [-3 / 64, 1 / 16],
    error: 2 ** -30,
  });
  const graphVerified = (request: PieceTubeChainRequest) => {
    const result = certifier.certifyPieceChain(request);
    if (result.kind !== "verified")
      throw new Error(`${result.kind} ${result.code}: ${result.message}`);
    return result.certificate;
  };

  test("baseline and T1: a concave straight-leg pair verifies; the ASYMMETRIC star of B₀ carries w_A (A1)", () => {
    const request = graphRequest({
      first: P_LEG(),
      second: Q_LEG(),
      distance: D,
    });
    const certificate = graphVerified(request);
    expect(certificate.joins).toHaveLength(1);
    const join = certificate.joins[0]!;
    if (join.kind !== "graph-trim") throw new Error("graph trim");
    expect(Object.keys(join).sort()).toEqual([
      "direction",
      "first",
      "firstRootBounds",
      "jointIndex",
      "kind",
      "second",
      "secondRootBounds",
      "separation",
    ]);
    expect(join).toMatchObject({
      jointIndex: 0,
      first: 0,
      second: 1,
      direction: [24 * H, 0],
    });
    // True slopes ∓3/4 and 3/4 exactly: σ = 3/2 (outward down).
    expect(join.separation).toBe(1.5);
    // The exact true crossing (0, 5d/4) is at u* = 15/16, v* = 1/16.
    expect(join.firstRootBounds[0]).toBeLessThan(15 / 16);
    expect(join.firstRootBounds[1]).toBeGreaterThan(15 / 16);
    expect(join.secondRootBounds[0]).toBeLessThan(1 / 16);
    expect(join.secondRootBounds[1]).toBeGreaterThan(1 / 16);
    for (const leaf of certificate.leaves)
      expect(leaf.displacementBound).toBe(TOLERANCE);
    // T1 (A1): ε_B ≪ ε_A; B₀'s switch-region points map onto the TRUE P, so
    // its star is at least w_A = ε_A·√(1 + (3/4)²) = (5/4)·2⁻¹¹, not its own G.
    const wA = (5 / 4) * 2 ** -11;
    expect(certificate.leaves[1]!.baseErrorStar).toBeGreaterThanOrEqual(wA);
    expect(certificate.leaves[0]!.baseErrorStar).toBeGreaterThanOrEqual(wA);
    expect(certificate.clearedPairs).toEqual([]);
  });

  test("exact reversal and mirror: a reversed P and the mirrored d < 0 pair verify with the same record", () => {
    const reversed = graphVerified(
      graphRequest({
        first: P_LEG(),
        second: Q_LEG(),
        distance: D,
        reversed: [true, false],
      }),
    );
    expect(reversed.joins[0]).toMatchObject({
      kind: "graph-trim",
      first: 0,
      second: 1,
      direction: [24 * H, 0],
      separation: 1.5,
    });
    const mirror = (leg: Leg): Leg => ({
      ...leg,
      source: leg.source.map(([x, y]) => [x, -y]) as unknown as SplinePoles,
      offset: [leg.offset[0], -leg.offset[1]],
    });
    const mirrored = graphVerified(
      graphRequest({
        first: mirror(P_LEG()),
        second: mirror(Q_LEG()),
        distance: -D,
        reversed: [false, true],
      }),
    );
    expect(mirrored.joins[0]).toMatchObject({
      kind: "graph-trim",
      direction: [24 * H, 0],
      separation: 1.5,
    });
  });

  test("§8-1 strict glue: G = w = τ exactly (L = 3/4, ε = 2⁻¹⁰, τ = 5·2⁻¹²) is rejected; one ulp more τ verifies", () => {
    const first = { ...P_LEG(), error: 2 ** -10 };
    const tau = 5 * 2 ** -12;
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first,
          second: Q_LEG(),
          distance: D,
          modelingTolerance: tau,
        }),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "trim-composition-unproven",
      message: expect.stringContaining("glue bound is not strictly below"),
      first: 0,
    });
    graphVerified(
      graphRequest({
        first,
        second: Q_LEG(),
        distance: D,
        modelingTolerance: nextBinary64(tau, "up", new ExactProofBudget()),
      }),
    );
  });

  test("glue ΔS term: a loose honest P box (slopes [−5/4, 5/8]) keeps w < τ but w + ΔS·ε/4 ≥ τ", () => {
    const first: Leg = {
      ...P_LEG(),
      box: [
        [0.5, 1],
        [-0.625, 0.3125],
      ],
    };
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first,
          second: Q_LEG(),
          distance: D,
          modelingTolerance: 2 ** -10,
        }),
      ),
    ).toMatchObject({
      code: "trim-composition-unproven",
      message: expect.stringContaining("glue bound"),
      first: 0,
    });
  });

  test("§8-4 Lemma X: a δ-window reaching the true domain end is trim-existence-unproven", () => {
    const small = 5 * 2 ** -12;
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first: { ...P_LEG(), offset: [3 * 2 ** -12, 2 ** -10] },
          second: {
            ...Q_LEG(),
            offset: [-3 * 2 ** -12, 2 ** -10],
            error: 2 ** -11,
          },
          distance: small,
        }),
      ),
    ).toMatchObject({
      code: "trim-existence-unproven",
      message: expect.stringContaining(
        "cross once inside both terminal leaves",
      ),
    });
  });

  test("§8-5 G2: a B₀ derivative box reaching e·v ≤ 0 is trim-window-unproven", () => {
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first: P_LEG(),
          second: {
            ...Q_LEG(),
            box: [
              [-0.125, 1],
              [0.5, 0.625],
            ],
          },
          distance: D,
        }),
      ),
    ).toMatchObject({
      code: "trim-window-unproven",
      message: expect.stringContaining("(G2)"),
      first: 0,
      second: 1,
    });
  });

  test("§8-6 Lemma P necessity: box slopes overlap Q's but the refined source slopes separate, so it verifies", () => {
    // P's loose box reaches slope 1 > 3/4 (Q); the exact source restriction
    // keeps −3/4, so σ = 3/2 only through Lemma P.
    const certificate = graphVerified(
      graphRequest({
        first: {
          ...P_LEG(),
          error: 2 ** -14,
          box: [
            [0.5, 1],
            [-0.625, 0.5],
          ],
        },
        second: Q_LEG(),
        distance: D,
      }),
    );
    expect(certificate.joins[0]).toMatchObject({
      kind: "graph-trim",
      separation: 1.5,
    });
  });

  test("§8-7 source cone: a source hodograph not e-positive on the vertex window is trim-classification-unproven", () => {
    // Certifier input only: P's source bends back inside the window (P₂ − P₁ =
    // (−30h, 0)) while its vertex tangent, emitted leg and box are unchanged.
    const straightP = P_LEG();
    const source = [
      straightP.source[0]!,
      [26 * H, 3 * H],
      straightP.source[2]!,
      straightP.source[3]!,
    ] as unknown as SplinePoles;
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first: {
            ...straightP,
            source,
            emitted: straightP.source.map(([x, y]) => [
              x + 3 / 64,
              y + 1 / 16,
            ]) as unknown as SplinePoles,
            box: hodographBox(straightP.source),
          },
          second: Q_LEG(),
          distance: D,
        }),
      ),
    ).toMatchObject({
      code: "trim-classification-unproven",
      message: expect.stringContaining("source hodograph"),
    });
  });

  test("§8-2 overlapping true slopes: an e-positive source window whose slopes reach P's is trim-classification-unproven", () => {
    // Certifier input only (the source is not the emitted/box source): Q's
    // source keeps its vertex tangent (4, 3) but dives to slope < −3/4 inside
    // its vertex window, so σ ≤ 0 although H2, G1, G2 and t < 1 hold (the
    // loose box admits those slopes too).
    const straightQ = Q_LEG();
    const source = [
      [0, 0],
      [4 * H, 3 * H],
      [0.45, -1.3125],
      [0.75, -1.0125],
    ] as unknown as SplinePoles;
    const result = certifier.certifyPieceChain(
      graphRequest({
        first: P_LEG(),
        second: {
          ...straightQ,
          source,
          emitted: straightQ.source.map(([x, y]) => [
            x - 3 / 64,
            y + 1 / 16,
          ]) as unknown as SplinePoles,
          // Loose box containing O′ = (3/4, 9/16), corner slopes [−1, 6/5].
          box: [
            [0.5, 1],
            [-0.5, 0.6],
          ],
        },
        distance: D,
      }),
    );
    expect(result).toMatchObject({
      code: "trim-classification-unproven",
      message: expect.stringContaining("slopes are not proved separated"),
    });
    // T08b-d R1: a classification failure is never tagged `magnitude`.
    expect(result).not.toHaveProperty("magnitude");
  });

  test("§8-3 emitted orientation: H2 and the true slopes pass but the emitted legs cross the wrong way round", () => {
    // Premise-violating certifier input (Q's declared ε is not a bound of its
    // emitted leg): pins the emitted-orientation gate as the rejecting check.
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first: P_LEG(),
          second: {
            ...Q_LEG(),
            emitted: legPoles([-3 / 64, 1 / 16], [4 * H, -4 * H]),
          },
          distance: D,
          bounds: [
            [0.9, 0.9 + 2 ** -20],
            [0.1, 0.1 + 2 ** -20],
          ],
        }),
      ),
    ).toMatchObject({
      code: "trim-classification-unproven",
      message: expect.stringContaining("emitted crossing orientation"),
    });
  });

  test("T2 collar: a leg just long enough for t < 1 puts E(½) within |e|ε* of the switch region", () => {
    const h = 33 * 2 ** -12;
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first: { ...P_LEG(h), error: 2 ** -10 },
          second: { ...Q_LEG(h), error: 2 ** -10 },
          distance: D,
          modelingTolerance: 2 ** -9,
          guess: [0.5, 0.5],
        }),
      ),
    ).toMatchObject({
      code: "trim-window-unproven",
      message: expect.stringContaining("glue collar"),
      first: 0,
    });
  });

  test("T3 G1: an emitted hodograph step that points backwards is trim-window-unproven although E is a monotone graph", () => {
    // ε = 2⁻¹⁰, h = ε, d = 5ε: P₁, P₂ move ±3.125ε ALONG the leg, so
    // |E − O| ≤ 0.29·3.125ε ≤ ε, E′ > 0 everywhere, but P₂ − P₁ is e-negative.
    const e = 2 ** -10;
    const straightP = P_LEG(e);
    const offset: Vector = [3 * e, 4 * e];
    const shift: Vector = [2.5 * e, -1.875 * e];
    const emitted = straightP.source.map(([x, y], index) => [
      x + offset[0] + (index === 1 ? shift[0] : index === 2 ? -shift[0] : 0),
      y + offset[1] + (index === 1 ? shift[1] : index === 2 ? -shift[1] : 0),
    ]) as unknown as SplinePoles;
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first: { ...straightP, offset, error: e, emitted },
          second: { ...Q_LEG(e), offset: [-3 * e, 4 * e] },
          distance: 5 * e,
          modelingTolerance: 2 ** -7,
          guess: [0.6, 0.4],
        }),
      ),
    ).toMatchObject({
      code: "trim-window-unproven",
      message: expect.stringContaining("(G1)"),
      first: 0,
      second: 1,
    });
  });

  test("T4 reversed curved piece (real owner): the vertex window is the NATURAL start [0, t]; the far end turns", () => {
    // Owner output of a reversed P whose natural END (the traversal far
    // start) turns to slope ≈ 1; its terminal leaf is the natural FIRST leaf.
    // Only the natural-start window separates the slopes enough for Lemma X.
    const d = 0.02;
    const tolerance = 1e-2;
    const owner = (poles: SplinePoles, distance: number, id: string) => {
      const result = approximateSplineOffset({
        spans: [
          {
            source: {
              splineId: id,
              spanIndex: 0,
              startPointId: `${id}0`,
              endPointId: `${id}1`,
              startOccurrenceId: `${id}o0`,
              endOccurrenceId: `${id}o1`,
            },
            orientation: "forward",
            interval: [0, 1],
            poles,
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
          },
        ],
        distance,
        modelingTolerance: tolerance,
      });
      if (!result.ok) throw new Error(result.code);
      return result.spans.map((span) => ({
        ...span,
        queryDomain: span.sourceInterval,
      }));
    };
    const first = owner(
      [
        [0, 0],
        [-4 * H, 3 * H],
        [-8 * H, 6 * H],
        [-8 * H - 0.2, 6 * H - 0.2],
      ],
      -d,
      "P",
    );
    const second = owner(
      legPoles([0, 0], [4 * H, 3 * H]) as SplinePoles,
      d,
      "Q",
    );
    const [A, B] = [first[0]!, second[0]!];
    const [u, v] = emittedCrossing(A.poles, B.poles, [0.05, 0.05]);
    const at = (domain: readonly [number, number], value: number) =>
      domain[0] + value * (domain[1] - domain[0]);
    const request: PieceTubeChainRequest = {
      modelingTolerance: tolerance,
      closed: false,
      distance: d,
      pieces: [
        { kind: "cubic", reversed: true, tubes: first },
        { kind: "cubic", reversed: false, tubes: second },
      ],
      trims: [
        {
          jointIndex: 0,
          firstParameterBounds: [
            at(A.queryDomain, u!) - PAD,
            at(A.queryDomain, u!) + PAD,
          ],
          secondParameterBounds: [
            at(B.queryDomain, v!) - PAD,
            at(B.queryDomain, v!) + PAD,
          ],
        },
      ],
    };
    // Premise: the terminal leaf's box reaches slopes of both signs (it turns).
    expect(
      A.reference.derivative[1][1] - A.reference.derivative[1][0],
    ).toBeGreaterThan(0.25);
    const certificate = graphVerified(request);
    expect(certificate.joins.at(-1)).toMatchObject({
      kind: "graph-trim",
      first: 0,
      second: first.length,
    });
  });

  test("T5 a single-leaf piece with graph trims at both ends is trim-window-unproven (retained ½ + ½ ≥ 1)", () => {
    // P (4, −3) → Q (4, 3) → R (−3, 4): two concave left turns at d > 0.
    const r: Leg = {
      source: legPoles([12 * H, 9 * H], [-3 * H, 4 * H]),
      offset: [-1 / 16, -3 / 64],
      error: 2 ** -30,
    };
    const legs = [P_LEG(), Q_LEG(), r];
    const tubes = legs.map((leg, index) => tubeOf(leg, D, `S${index}`));
    const crossings = [0, 1].map((index) =>
      emittedCrossing(tubes[index]!.poles, tubes[index + 1]!.poles, [0.9, 0.1]),
    );
    expect(
      certifier.certifyPieceChain({
        modelingTolerance: TOLERANCE,
        closed: false,
        distance: D,
        pieces: tubes.map((tube) => ({
          kind: "cubic" as const,
          reversed: false,
          tubes: [tube],
        })),
        trims: crossings.map(([u, v], jointIndex) => ({
          jointIndex,
          firstParameterBounds: [u! - PAD, u! + PAD],
          secondParameterBounds: [v! - PAD, v! + PAD],
        })),
      }),
    ).toMatchObject({
      code: "trim-window-unproven",
      message: expect.stringContaining("retained domain"),
      first: 1,
    });
  });

  test("T6 nonzero source gap: Q's source shifted by (0, 9/1024) verifies (the proof never reads P₃ − Q₀)", () => {
    const shifted = Q_LEG();
    const gap = 9 / 1024;
    const certificate = graphVerified(
      graphRequest({
        first: P_LEG(),
        second: {
          ...shifted,
          source: shifted.source.map(([x, y]) => [
            x,
            y + gap,
          ]) as unknown as SplinePoles,
        },
        distance: D,
      }),
    );
    const join = certificate.joins[0]!;
    if (join.kind !== "graph-trim") throw new Error("graph trim");
    // Exact true crossing at u* = 119/128, v* = 7/128.
    expect(join.firstRootBounds[0]).toBeLessThan(119 / 128);
    expect(join.firstRootBounds[1]).toBeGreaterThan(119 / 128);
    expect(join.secondRootBounds[0]).toBeLessThan(7 / 128);
    expect(join.secondRootBounds[1]).toBeGreaterThan(7 / 128);
  });

  test("T7 t ≥ 1 only through the ±|e|ε widening of H against the TRUE advance (loose honest box)", () => {
    // 1.2d < adv_O = 0.9·12h ≤ 1.2d + ε_A + ε_B < adv_E = 12h.
    const h = 36 * 2 ** -12;
    const first: Leg = {
      ...P_LEG(h),
      error: 2 ** -10,
      box: [
        [0.9 * 12 * h, 1.1 * 12 * h],
        [-9 * h, -9 * h],
      ],
    };
    expect(
      certifier.certifyPieceChain(
        graphRequest({
          first,
          second: { ...Q_LEG(h), error: 2 ** -10 },
          distance: D,
          modelingTolerance: 2 ** -9,
          guess: [0.5, 0.5],
        }),
      ),
    ).toMatchObject({
      code: "trim-window-unproven",
      message: expect.stringContaining("(t ≥ 1)"),
    });
  });

  // Whole-request literal of the fabricated baseline, measured on this
  // implementation (T08b-b evidence) and pinned on operations, Euclid and
  // integerBits; the staged caps land INSIDE the S2 stage (stage probe:
  // operations [2 785, 40 257], Euclid [205, 5 943] of the total); the 0.97
  // caps land in the Lemma-C glue stage (leaf loop). These staged rows and the
  // bits count − 1 row are load-bearing exhaustion-swallow killers: keep them.
  const GRAPH_METER = {
    operations: 42_018,
    euclideanSteps: 6_202,
    integerBits: 187,
  };
  const baseline = () =>
    graphRequest({ first: P_LEG(), second: Q_LEG(), distance: D });

  test("fabricated graph-trim whole-request literal (observer)", () => {
    let snapshot: ExactProofBudgetSnapshot | undefined;
    expect(
      createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
        snapshot = value;
      }).certifyPieceChain(baseline()).kind,
    ).toBe("verified");
    expect({
      operations: snapshot!.operations,
      euclideanSteps: snapshot!.euclideanSteps,
      integerBits: Math.max(
        snapshot!.maxStoredBits,
        snapshot!.maxPreProductBits,
      ),
    }).toEqual(GRAPH_METER);
  });

  test.each(
    (["operations", "euclideanSteps", "integerBits"] as const).map(
      (kind) => [kind] as const,
    ),
  )(
    "fabricated graph trim: the literal %s count passes and count − 1 exhausts the whole request with no partial certificate",
    (kind) => {
      const total = GRAPH_METER[kind];
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: total,
        }).certifyPieceChain(baseline()).kind,
      ).toBe("verified");
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: total - 1,
        }).certifyPieceChain(baseline()),
      ).toEqual(EXHAUSTED_RESULT);
    },
  );

  test.each([
    ["operations", 0.5],
    ["operations", 0.9],
    ["euclideanSteps", 0.5],
    ["euclideanSteps", 0.9],
    ["operations", 0.97],
    ["euclideanSteps", 0.97],
  ] as const)(
    "staged cap inside the S2 stage (%s at %s of the literal) exhausts the request, never an S2 failure code",
    (kind, fraction) => {
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: Math.floor(GRAPH_METER[kind] * fraction),
        }).certifyPieceChain(baseline()),
      ).toEqual(EXHAUSTED_RESULT);
    },
  );

  describe("Q4-E1 local ε on the S2 vertex sub-windows", () => {
    // The §8-4 geometry: d = 5·2⁻¹², the true offsets cross 2⁻¹⁰ of a leg
    // before the vertex, so the leaf-wide ε = 2⁻¹¹ fails Lemma X. Emitted =
    // true offsets exactly unless a pole is shifted, so metadata that bounds
    // the actual |E − O| is honest; "owner-like" is R = ε, π = 0.
    const SMALL = 5 * 2 ** -12;
    const EPS = 2 ** -11;
    const OWNER_LIKE = { remainder: EPS, poles: [0, 0, 0, 0] } as const;
    const bandP = (overrides: Partial<Leg> = {}): Leg => ({
      ...P_LEG(),
      offset: [3 * 2 ** -12, 2 ** -10],
      error: EPS,
      ...overrides,
    });
    const bandQ = (overrides: Partial<Leg> = {}): Leg => ({
      ...Q_LEG(),
      offset: [-3 * 2 ** -12, 2 ** -10],
      error: EPS,
      ...overrides,
    });
    /** Emitted = true offset + `shift` on traversal pole `pole` (|E − O| = |shift|·B_pole). */
    const shifted = (leg: Leg, pole: number, shift: Vector): SplinePoles =>
      leg.source.map(([x, y], index) => [
        x + leg.offset[0] + (index === pole ? shift[0] : 0),
        y + leg.offset[1] + (index === pole ? shift[1] : 0),
      ]) as unknown as SplinePoles;
    const band = (
      first: Leg,
      second: Leg,
      options: { reversed?: readonly [boolean, boolean]; tau?: number } = {},
    ) =>
      graphRequest({
        first,
        second,
        distance: SMALL,
        ...(options.reversed ? { reversed: options.reversed } : {}),
        ...(options.tau ? { modelingTolerance: options.tau } : {}),
      });

    const verifiedLocal = (request: PieceTubeChainRequest) => {
      const certificate = graphVerified(request);
      expect(certificate.joins[0]).toMatchObject({ kind: "graph-trim" });
      for (const leaf of certificate.leaves)
        expect(leaf.displacementBound).toBe(TOLERANCE);
      return certificate;
    };
    const EXISTENCE_FAILURE = {
      kind: "uncertain",
      code: "trim-existence-unproven",
      message:
        "The true terminal offsets are not proved to cross once inside both terminal leaves.",
      first: 0,
      second: 1,
      // A Lemma-X margin failure is a bound-versus-budget (magnitude) failure.
      magnitude: true,
    };

    test("the leaf-wide band row fails Lemma X; owner-like metadata (R = ε, π = 0) verifies it through the local branch", () => {
      expect(certifier.certifyPieceChain(band(bandP(), bandQ()))).toEqual(
        EXISTENCE_FAILURE,
      );
      const certificate = verifiedLocal(
        band(bandP({ local: OWNER_LIKE }), bandQ({ local: OWNER_LIKE })),
      );
      const join = certificate.joins[0]!;
      if (join.kind !== "graph-trim") throw new Error("graph trim");
      // The exact true crossing is at u* = 1 − 2⁻¹⁰ on P and v* = 2⁻¹⁰ on Q.
      expect(join.firstRootBounds[0]).toBeLessThan(1 - 2 ** -10);
      expect(join.firstRootBounds[1]).toBeGreaterThan(1 - 2 ** -10);
      expect(join.secondRootBounds[0]).toBeLessThan(2 ** -10);
      expect(join.secondRootBounds[1]).toBeGreaterThan(2 ** -10);
      expect(join.separation).toBe(1.5);
      // The stars keep the leaf-wide ε (and the other side's leaf-wide w).
      for (const leaf of certificate.leaves)
        expect(leaf.baseErrorStar).toBeGreaterThanOrEqual((5 / 4) * EPS);
      // Metadata on one side only is not enough: the other side keeps ε.
      expect(
        certifier.certifyPieceChain(
          band(bandP({ local: OWNER_LIKE }), bandQ()),
        ),
      ).toEqual(EXISTENCE_FAILURE);
    });

    test("true error concentrated at the VERTEX pole (honest π₃ = ε) leaves no local gain and is rejected", () => {
      // |E − O| = 2⁻¹¹·B₃(τ): not ≤ the vanishing profile a far error would
      // allow, and within ε; its honest metadata carries it at pole 3.
      const shift: Vector = [0, EPS];
      const first = bandP({
        emitted: shifted(bandP(), 3, shift),
        local: { remainder: 0, poles: [0, 0, 0, EPS] },
      });
      expect(
        certifier.certifyPieceChain(band(first, bandQ({ local: OWNER_LIKE }))),
      ).toEqual(EXISTENCE_FAILURE);
    });

    test("true error at the FAR pole (honest π₀ = ε) weighs (1 − τ)³ at the vertex and verifies", () => {
      const first = bandP({
        emitted: shifted(bandP(), 0, [0, EPS]),
        local: { remainder: 0, poles: [EPS, 0, 0, 0] },
      });
      verifiedLocal(band(first, bandQ({ local: OWNER_LIKE })));
    });

    test("reversed P: the far error is on NATURAL pole 3 and the vertex window is the natural start [0, s]", () => {
      // Traversal pole 0 (far) shifted; natural() reverses poles and π.
      const first = bandP({
        emitted: shifted(bandP(), 0, [0, EPS]),
        local: { remainder: 0, poles: [EPS, 0, 0, 0] },
      });
      verifiedLocal(
        band(first, bandQ({ local: OWNER_LIKE }), { reversed: [true, false] }),
      );
      // The same metadata on the vertex pole is rejected under reversal too.
      const vertex = bandP({
        emitted: shifted(bandP(), 3, [0, EPS]),
        local: { remainder: 0, poles: [0, 0, 0, EPS] },
      });
      expect(
        certifier.certifyPieceChain(
          band(vertex, bandQ({ local: OWNER_LIKE }), {
            reversed: [true, false],
          }),
        ),
      ).toEqual(EXISTENCE_FAILURE);
    });

    test("tightness of 16R·s²: R = 30 is rejected and R = 15 verifies (threshold R* ∈ (28.5, 29), uncapped by ε)", () => {
      // Honest for any R (E = O exactly). At the witness s ≈ 2⁻¹⁰, 16·30·s²
      // ≈ 4.6e-4 < ε: the remainder term, not the ε cap, decides.
      const at = (remainder: number) =>
        certifier.certifyPieceChain(
          band(
            bandP({ local: { remainder, poles: [0, 0, 0, 0] } }),
            bandQ({ local: { remainder, poles: [0, 0, 0, 0] } }),
          ),
        );
      expect(at(30)).toEqual(EXISTENCE_FAILURE);
      expect(at(15).kind).toBe("verified");
    });

    test("wide stored witness bounds (not owner-reachable): the local ε reaches the FAR stored bound, so R = 20 rejects", () => {
      // Honest for any R (E = O exactly). Both stored bounds widened by
      // 2⁻¹² around the true crossing: far reach ≈ 1.25·2⁻¹⁰, near ≈
      // 0.75·2⁻¹⁰. Review-fixes probe: the far-bound (current) window
      // rejects from R = 15, a NEAR-bound window would verify up to R = 30.
      // Semantic killer of the near-bound mutant (math review A1).
      const WIDTH = 2 ** -12;
      const request = (remainder: number, width: number) => {
        const local = { remainder, poles: [0, 0, 0, 0] } as const;
        const base = band(bandP({ local }), bandQ({ local }));
        return {
          ...base,
          trims: base.trims.map((trim) => ({
            ...trim,
            firstParameterBounds: [
              trim.firstParameterBounds[0] - width,
              trim.firstParameterBounds[1] + width,
            ] as const,
            secondParameterBounds: [
              trim.secondParameterBounds[0] - width,
              trim.secondParameterBounds[1] + width,
            ] as const,
          })),
        };
      };
      expect(certifier.certifyPieceChain(request(20, 0)).kind).toBe("verified");
      expect(certifier.certifyPieceChain(request(10, WIDTH)).kind).toBe(
        "verified",
      );
      expect(certifier.certifyPieceChain(request(20, WIDTH))).toEqual(
        EXISTENCE_FAILURE,
      );
    });

    test("the glue keeps the leaf-wide ε: w_P = τ exactly passes Lemma V, the local Lemma X, and fails the strict glue", () => {
      // ε_P = 2⁻¹⁰, τ = 5·2⁻¹²: w_P = (5/4)ε_P = τ.
      const tau = 5 * 2 ** -12;
      const first = bandP({
        error: 2 ** -10,
        local: { remainder: 2 ** -10, poles: [0, 0, 0, 0] },
      });
      expect(
        certifier.certifyPieceChain(
          band(first, bandQ({ local: OWNER_LIKE }), { tau }),
        ),
      ).toMatchObject({
        kind: "uncertain",
        code: "trim-composition-unproven",
        message: expect.stringContaining("glue bound is not strictly below"),
        first: 0,
      });
    });

    test.each([
      ["absent", undefined],
      ["negative R", { remainder: -1, poles: [0, 0, 0, 0] }],
      ["NaN π", { remainder: 0, poles: [0, Number.NaN, 0, 0] }],
      ["three poles", { remainder: 0, poles: [0, 0, 0] }],
    ] as const)(
      "inadmissible local metadata (%s) fails closed with the leaf-wide result",
      (_label, local) => {
        expect(
          certifier.certifyPieceChain(
            band(
              bandP({ local: local as Leg["local"] }),
              bandQ({ local: OWNER_LIKE }),
            ),
          ),
        ).toEqual(EXISTENCE_FAILURE);
      },
    );

    // Whole-request literal of the owner-like local row, measured on this
    // implementation (T08b-c evidence) and pinned on operations, Euclid and
    // integerBits; the staged caps land INSIDE the local branch (stage probe).
    // Load-bearing exhaustion-swallow and precharge killers: keep them.
    const LOCAL_METER = {
      operations: 53_764,
      euclideanSteps: 7_678,
      integerBits: 315,
    };
    // Local branch window (stage probe): operations [35 844, 51 003], Euclid
    // [5 056, 7 370]; the leaf-wide attempt ends at the window's start.
    const LOCAL_STAGED = [
      ["operations", 35_845],
      ["operations", 43_423],
      ["operations", 49_487],
      ["euclideanSteps", 6_213],
      ["euclideanSteps", 7_139],
    ] as const;
    const localRow = () =>
      band(bandP({ local: OWNER_LIKE }), bandQ({ local: OWNER_LIKE }));

    test("fabricated local-branch whole-request literal (observer)", () => {
      let snapshot: ExactProofBudgetSnapshot | undefined;
      expect(
        createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
          snapshot = value;
        }).certifyPieceChain(localRow()).kind,
      ).toBe("verified");
      expect({
        operations: snapshot!.operations,
        euclideanSteps: snapshot!.euclideanSteps,
        integerBits: Math.max(
          snapshot!.maxStoredBits,
          snapshot!.maxPreProductBits,
        ),
      }).toEqual(LOCAL_METER);
    });

    test.each(
      (["operations", "euclideanSteps", "integerBits"] as const).map(
        (kind) => [kind] as const,
      ),
    )(
      "fabricated local branch: the literal %s count passes and count − 1 exhausts the whole request",
      (kind) => {
        const total = LOCAL_METER[kind];
        expect(
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [kind]: total,
          }).certifyPieceChain(localRow()).kind,
        ).toBe("verified");
        expect(
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [kind]: total - 1,
          }).certifyPieceChain(localRow()),
        ).toEqual(EXHAUSTED_RESULT);
      },
    );

    test.each(LOCAL_STAGED)(
      "staged cap inside the local branch (%s = %s) exhausts the request, never a local or leaf-wide failure code",
      (kind, cap) => {
        expect(
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [kind]: cap,
          }).certifyPieceChain(localRow()),
        ).toEqual(EXHAUSTED_RESULT);
      },
    );
  });
});

const KNOT_UNPROVEN_CODE = "cubic-tube-knot-incidence-unproven";

// Logic lane (docs/testing.md): the exported certifier seam
// `certifyPieceChain` / `openRequest` with declared vertices (T08b-d).
// Line fixtures are certifier-input, not owner-reachable; their true offsets
// are exact and every ε is computed by the certifier from the literal ends.
describe("piece tube chain (T08b-d): declared vertices (certifier-input fixtures, not owner-reachable)", () => {
  type Vector = readonly [number, number];
  const D = 1 / 64;
  const TAU = 2 ** -10;
  /** Line tube with point IDs; emitted = source + d·ν unless overridden. */
  const line = (
    start: Vector,
    end: Vector,
    ids: readonly [string, string],
    {
      distance = D,
      emitted,
      reversed = false,
    }: {
      distance?: number;
      emitted?: readonly [Vector, Vector];
      reversed?: boolean;
    } = {},
  ): TubeChainPiece => {
    const owner = reversed ? -distance : distance;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const normal: Vector = [
      -(end[1] - start[1]) / length,
      (end[0] - start[0]) / length,
    ];
    const offset = (point: Vector): Vector => [
      point[0] + owner * normal[0],
      point[1] + owner * normal[1],
    ];
    return {
      kind: "line",
      reversed,
      tube: {
        emitted: emitted ?? [offset(start), offset(end)],
        source: [start, end],
        distance: owner,
        startPointId: ids[0],
        endPointId: ids[1],
      },
    };
  };
  const endOf = (piece: TubeChainPiece): Vector =>
    piece.kind === "line" ? piece.tube.emitted[1] : [0, 0];
  const vertexRequest = (
    pieces: readonly TubeChainPiece[],
    vertices: PieceTubeChainRequest["vertices"],
    {
      distance = D,
      modelingTolerance = TAU,
      closed = false,
      trims = [],
    }: {
      distance?: number;
      modelingTolerance?: number;
      closed?: boolean;
      trims?: PieceTubeChainRequest["trims"];
    } = {},
  ): PieceTubeChainRequest => ({
    modelingTolerance,
    closed,
    distance,
    pieces,
    trims,
    vertices,
  });
  const shared = (pointId = "v") =>
    ({ kind: "shared-point", pointId }) as const;
  const coincident = (a = "v", b = "w") =>
    ({ kind: "coincident", pointIds: [a, b] }) as const;
  const at0 = (
    authority: NonNullable<
      PieceTubeChainRequest["vertices"]
    >[number]["authority"],
    keeper: "first" | "second" = "first",
  ) => [{ jointIndex: 0, authority, keeper }];
  const certificateOf = (result: TubePieceChainResult) => {
    if (result.kind !== "verified")
      throw new Error(`${result.kind} ${result.code}: ${result.message}`);
    return result.certificate;
  };
  const vertexJoin = (result: TubePieceChainResult) => {
    const join = certificateOf(result).joins.find(
      (item) =>
        item.kind === "parallel-vertex" || item.kind === "nonparallel-vertex",
    );
    if (!join) throw new Error("no vertex record");
    return join as Extract<
      typeof join,
      { kind: "parallel-vertex" | "nonparallel-vertex" }
    >;
  };
  /** Straight source along x with a gap g at the vertex; Q adopts Z = P's end. */
  const parallelPair = (
    gap: Vector,
    { shift = 0, ids = ["v", "w"] as readonly [string, string] } = {},
  ) => {
    const p = line([-1, 0], [0, 0], ["p", ids[0]], {
      emitted: [
        [-1, D + shift],
        [0, D + shift],
      ],
    });
    const q = line(gap, [1, gap[1]], [ids[1], "q"], {
      emitted: [endOf(p), [1, gap[1] + D]],
    });
    return [p, q] as const;
  };

  test("parallel g = 0 at one shared point: parallel-vertex, zero bridge, no reserve, no inflation", () => {
    const certificate = certificateOf(
      certifier.certifyPieceChain(
        vertexRequest(parallelPair([0, 0], { ids: ["v", "v"] }), at0(shared())),
      ),
    );
    expect(certificate.joins).toEqual([
      expect.objectContaining({
        kind: "parallel-vertex",
        jointIndex: 0,
        first: 0,
        second: 1,
        authority: "shared-point",
        keeper: "first",
        bridge: 0,
      }),
    ]);
    for (const leaf of certificate.leaves) {
      expect(leaf.displacementBound).toBe(leaf.baseErrorStar);
      expect(leaf.clearanceRadius).toBe(leaf.baseErrorStar);
    }
  });

  test("parallel coincident gap: the keeper carries the bridge |g|⁺ strictly (displacementBound = τ), both radii carry |g|⁺, the adopter keeps ε", () => {
    const g = 2 ** -11;
    const certificate = certificateOf(
      certifier.certifyPieceChain(
        vertexRequest(parallelPair([g, 0]), at0(coincident())),
      ),
    );
    const join = vertexJoin({ kind: "verified", certificate });
    expect(join).toMatchObject({
      kind: "parallel-vertex",
      authority: "coincident",
    });
    // |g|⁺ is the verified outward √ bound of the exact g·g.
    expect(join.bridge).toBeGreaterThanOrEqual(g);
    expect(join.bridge).toBeLessThan(g * (1 + 1e-15));
    const [keeper, adopter] = certificate.leaves;
    // Keeper: its literal end error (≈ 0) plus the bridge, strict: τ reported.
    expect(keeper!.baseErrorStar).toBeGreaterThanOrEqual(join.bridge);
    expect(keeper!.baseErrorStar).toBeLessThan(g * (1 + 1e-14));
    expect(keeper!.displacementBound).toBe(TAU);
    expect(keeper!.clearanceRadius).toBeGreaterThanOrEqual(join.bridge);
    // Adopter: its own ε (the adopted pole's distance to its true end) only.
    expect(adopter!.baseErrorStar).toBeGreaterThanOrEqual(g);
    expect(adopter!.baseErrorStar).toBeLessThan(g * (1 + 1e-14));
    expect(adopter!.displacementBound).toBe(adopter!.baseErrorStar);
    expect(adopter!.clearanceRadius).toBeGreaterThanOrEqual(2 * g);
  });

  test("strict at the bridge end: ε* = |g|⁺ = τ exactly is not certified (the adopter's own ε = τ is)", () => {
    const pair = parallelPair([2 ** -11, 0]);
    const bridge = vertexJoin(
      certifier.certifyPieceChain(vertexRequest(pair, at0(coincident()))),
    ).bridge;
    expect(
      certifier.certifyPieceChain(
        vertexRequest(pair, at0(coincident()), { modelingTolerance: bridge }),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining("declared-vertex reserve end"),
    });
  });

  /**
   * Exact straight cubic keeper (E = O, so any ε ≥ 0 is honest) ending at the
   * origin, and a line adopter with source gap g taking its end pole.
   */
  const cubicKeeperPair = (
    gap: Vector,
    certifiedError: number,
    leaf: readonly [number, number] = [0, 1],
  ) => {
    const source = straight(-1, 0);
    const keeper: NeutralCubicPieceTube = {
      poles: source.map(([x, y]) => [x, y + D]) as unknown as SplinePoles,
      certifiedError,
      reference: {
        derivative: [
          [0.75, 1.5],
          [0, 0],
        ],
        sourcePoles: source,
        distance: D,
      },
      source: {
        splineId: "keeper",
        spanIndex: 0,
        startOccurrenceId: "o0",
        endOccurrenceId: "o1",
        startPointId: "p",
        endPointId: "v",
      },
      sourceLocalInterval: leaf,
      queryDomain: [0, 1],
    };
    const adopter = line(gap, [gap[0] + 1, gap[1]], ["w", "q"], {
      emitted: [
        [0, D],
        [gap[0] + 1, gap[1] + D],
      ],
    });
    return [
      { kind: "cubic", reversed: false, tubes: [keeper] },
      adopter,
    ] as const;
  };

  test("strict at the bridge end, exactly: a cubic keeper with ε + |g|⁺ = τ in exact arithmetic is not certified; one ulp less ε verifies", () => {
    const g = 2 ** -11;
    // |g|⁺ = nextUp(2⁻¹¹) = 2⁻¹¹ + 2⁻⁶³; ε = 2⁻¹¹ − 2⁻⁶³ (two ulps below
    // 2⁻¹¹, exactly representable) makes the EXACT sum 2⁻¹⁰ = τ.
    const bridge = g + 2 ** -63;
    const epsilon = g - 2 ** -63;
    expect(bridge - g).toBe(2 ** -63);
    expect(g - epsilon).toBe(2 ** -63);
    const at = (error: number) =>
      certifier.certifyPieceChain(
        vertexRequest(cubicKeeperPair([g, 0], error), at0(coincident())),
      );
    expect(at(epsilon)).toMatchObject({
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining("declared-vertex reserve end"),
    });
    // One ulp (2⁻⁶⁴) less ε is strictly below τ and verifies.
    const certificate = certificateOf(at(epsilon - 2 ** -64));
    expect(vertexJoin({ kind: "verified", certificate })).toMatchObject({
      kind: "parallel-vertex",
      bridge,
    });
    expect(certificate.leaves[0]!.displacementBound).toBe(TAU);
  });

  test("C5-3: a vertex leaf that does not reach its natural source end is not admitted", () => {
    expect(
      certifier.certifyPieceChain(
        vertexRequest(cubicKeeperPair([0, 0], 0, [0, 0.5]), at0(coincident())),
      ),
    ).toMatchObject({
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining("natural source end"),
    });
  });

  test("the bridge is load-bearing: keeper ε = 3τ/4 plus |g| = τ/2 fails; |g| = τ/8 verifies", () => {
    const shift = 3 * 2 ** -12;
    expect(
      certifier.certifyPieceChain(
        vertexRequest(
          parallelPair([2 ** -11, 0], { shift }),
          at0(coincident()),
        ),
      ),
    ).toMatchObject({
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining("reserve end"),
    });
    const certificate = certificateOf(
      certifier.certifyPieceChain(
        vertexRequest(
          parallelPair([2 ** -13, 0], { shift }),
          at0(coincident()),
        ),
      ),
    );
    expect(certificate.leaves[0]!.baseErrorStar).toBeGreaterThanOrEqual(
      shift + 2 ** -13,
    );
    expect(certificate.leaves[0]!.baseErrorStar).toBeLessThan(
      (shift + 2 ** -13) * (1 + 1e-14),
    );
  });

  test("backward declared gap (e·g < 0) fails closed: parallel, and the review's convex counterexample whose true offsets cross", () => {
    expect(
      certifier.certifyPieceChain(
        vertexRequest(parallelPair([-(2 ** -11), 0]), at0(coincident())),
      ),
    ).toMatchObject({
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining("backward declared gap"),
    });
    // T08b-d-design-review-evidence/eg-gate-counterexample.py: d = −0.01,
    // u₂ = (9999, 200)/10001, g = (−6e-4, −5e-6); O_P and O_Q cross.
    const d = -0.01;
    const g: Vector = [-6e-4, -5e-6];
    const p = line([-1, 0], [0, 0], ["p", "v"], { distance: d });
    const q = line(g, [g[0] + 9999 / 10001, g[1] + 200 / 10001], ["w", "q"], {
      distance: d,
    });
    const adopted: TubeChainPiece = {
      ...q,
      tube: {
        ...(q as Extract<TubeChainPiece, { kind: "line" }>).tube,
        emitted: [
          endOf(p),
          (q as Extract<TubeChainPiece, { kind: "line" }>).tube.emitted[1],
        ],
      },
    } as TubeChainPiece;
    expect(
      certifier.certifyPieceChain(
        vertexRequest([p, adopted], at0(coincident()), {
          distance: d,
          modelingTolerance: 1e-3,
        }),
      ),
    ).toMatchObject({
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining("backward declared gap"),
    });
  });

  // Convex corner of exact 7-24-25 geometry: u₁ = (7, 24)/32, u₂ = (1, 0),
  // d = 1/64, so |N₁ − N₂| = 6/5 and δ = 6d/5 = 3/160 (the tight G2 form is
  // exact here: c₋ = 7/25).
  const convexCorner = ({
    keeper = "first" as "first" | "second",
    adopterEndShift = 0,
  } = {}) => {
    const p = line([-7 / 32, -24 / 32], [0, 0], ["p", "v"]);
    const qFree = line([0, 0], [1, 0], ["v", "q"]);
    const pEnd = endOf(p);
    const qStart = (qFree as Extract<TubeChainPiece, { kind: "line" }>).tube
      .emitted[0];
    // The adopter takes the keeper's pole; the keeper keeps its own.
    const [first, second] =
      keeper === "first"
        ? [
            p,
            line([0, 0], [1, 0], ["v", "q"], {
              emitted: [pEnd, [1, D + adopterEndShift]],
            }),
          ]
        : [
            line([-7 / 32, -24 / 32], [0, 0], ["p", "v"], {
              emitted: [
                (p as Extract<TubeChainPiece, { kind: "line" }>).tube
                  .emitted[0],
                qStart,
              ],
            }),
            qFree,
          ];
    return [first, second] as const;
  };

  test("convex keeper-only rule: the adopter's ε = τ exactly passes (no correction, no strictness on the adopter)", () => {
    const pieces = convexCorner({ adopterEndShift: 1 / 32 });
    // τ := the adopter's own certified ε (its far end error |shift|⁺).
    const tau = certificateOf(
      certifier.certifyPieceChain(
        vertexRequest(pieces, at0(shared()), { modelingTolerance: 1 / 16 }),
      ),
    ).leaves[1]!.baseErrorStar;
    expect(tau).toBeGreaterThanOrEqual(1 / 32);
    const result = certifier.certifyPieceChain(
      vertexRequest(pieces, at0(shared()), { modelingTolerance: tau }),
    );
    const join = vertexJoin(result);
    expect(join).toMatchObject({ kind: "nonparallel-vertex", side: "convex" });
    if (join.kind !== "nonparallel-vertex" || join.side !== "convex")
      throw new Error("convex");
    // δ⁺ is the tight Lemma-G2 bound: ≥ 3/160 and within one ulp-scale of it.
    expect(join.arcDeviation).toBeGreaterThanOrEqual(3 / 160);
    expect(join.arcDeviation).toBeLessThan((3 / 160) * (1 + 1e-12));
    const [keeper, adopter] = certificateOf(result).leaves;
    expect(adopter!.baseErrorStar).toBe(tau);
    expect(adopter!.displacementBound).toBe(tau);
    expect(keeper!.displacementBound).toBe(tau);
    expect(keeper!.baseErrorStar).toBeLessThan(tau);
    // Both leaves carry G⁺ in their K3 radius.
    expect(adopter!.clearanceRadius).toBeGreaterThanOrEqual(
      tau + join.arcDeviation,
    );
    expect(keeper!.clearanceRadius).toBeGreaterThanOrEqual(join.arcDeviation);
  });

  test("outgoing keeper: the correction and the reserve sit on the keeper's START, so its displacementBound is τ", () => {
    const tau = 1 / 16;
    const certificate = certificateOf(
      certifier.certifyPieceChain(
        vertexRequest(
          convexCorner({ keeper: "second" }),
          at0(shared(), "second"),
          {
            modelingTolerance: tau,
          },
        ),
      ),
    );
    const [adopter, keeper] = certificate.leaves;
    // Keeper Q: its own start error (≈ 0) plus δ⁺ at its START, strict.
    expect(keeper!.displacementBound).toBe(tau);
    expect(keeper!.baseErrorStar).toBeGreaterThanOrEqual(3 / 160);
    expect(keeper!.baseErrorStar).toBeLessThan((3 / 160) * (1 + 1e-9));
    // Adopter P: its ε is the adopted pole's distance |Z − A| ≤ δ, no reserve.
    expect(adopter!.displacementBound).toBe(adopter!.baseErrorStar);
    expect(adopter!.baseErrorStar).toBeLessThan((3 / 160) * (1 + 1e-9));
  });

  test("a one-leaf keeper at BOTH ends reserves both ends strictly (line max-form)", () => {
    const tau = 1 / 32;
    const middle = line([0, 0], [1, 0], ["v", "w"]);
    const [, qFree] = convexCorner({ keeper: "second" });
    void qFree;
    const incoming = line([-7 / 32, -24 / 32], [0, 0], ["p", "v"]);
    const outgoingFree = line([1, 0], [1 + 7 / 32, -24 / 32], ["w", "r"]);
    const withEnd = (
      piece: TubeChainPiece,
      index: 0 | 1,
      value: Vector,
    ): TubeChainPiece => {
      const tube = (piece as Extract<TubeChainPiece, { kind: "line" }>).tube;
      const emitted = [...tube.emitted] as [Vector, Vector];
      emitted[index] = value;
      return { ...piece, tube: { ...tube, emitted } } as TubeChainPiece;
    };
    const [mStart, mEnd] = (middle as Extract<TubeChainPiece, { kind: "line" }>)
      .tube.emitted;
    const pieces = [
      withEnd(incoming, 1, mStart),
      middle,
      withEnd(outgoingFree, 0, mEnd),
    ];
    const vertices = [
      { jointIndex: 0, authority: shared("v"), keeper: "second" as const },
      { jointIndex: 1, authority: shared("w"), keeper: "first" as const },
    ];
    const certificate = certificateOf(
      certifier.certifyPieceChain(
        vertexRequest(pieces, vertices, { modelingTolerance: tau }),
      ),
    );
    expect(certificate.leaves[1]!.displacementBound).toBe(tau);
    expect(certificate.leaves[1]!.baseErrorStar).toBeGreaterThanOrEqual(
      3 / 160,
    );
    expect(certificate.clearedPairs).toEqual([[0, 2]]);
    // The adopters at either end carry no reserve.
    for (const index of [0, 2])
      expect(certificate.leaves[index]!.displacementBound).toBe(
        certificate.leaves[index]!.baseErrorStar,
      );
    // The keeper's two end corrections are both in its K3 radius (G⁺ each).
    expect(certificate.leaves[1]!.clearanceRadius).toBeGreaterThanOrEqual(
      2 * (3 / 160),
    );
  });

  test("concave line↔line vertex with a gap: J2′ trims both lines, the line tail is |a|·t from the SOURCE direction a (never the adopted emitted step)", () => {
    const g: Vector = [2 ** -9, 2 ** -10];
    const a: Vector = [1, 1 / 64];
    const p = line([-1, 0], [0, 0], ["p", "v"]);
    const qFree = line(g, [g[0] + a[0], g[1] + a[1]], ["w", "q"]);
    const qEmitted = (qFree as Extract<TubeChainPiece, { kind: "line" }>).tube
      .emitted;
    const q = line(g, [g[0] + a[0], g[1] + a[1]], ["w", "q"], {
      emitted: [endOf(p), qEmitted[1]],
    });
    const result = certifier.certifyPieceChain(
      vertexRequest([p, q], at0(coincident()), { modelingTolerance: 1 / 64 }),
    );
    const join = vertexJoin(result);
    if (join.kind !== "nonparallel-vertex" || join.side !== "concave")
      throw new Error(`expected concave, got ${JSON.stringify(join)}`);
    expect(join.retainedCrossing).toBe(true);
    expect(join.bridge).toBeGreaterThan(Math.hypot(...g) * (1 - 1e-12));
    // λ = 1 and |R′| = |a| on a line: tail/trim is exactly |a| (up to the
    // two outward roundings), P's |a| = 1.
    expect(join.tail[0] / join.trim[0]).toBeCloseTo(1, 12);
    expect(join.tail[1] / join.trim[1]).toBeCloseTo(Math.hypot(...a), 12);
    const step = Math.hypot(
      qEmitted[1][0] - endOf(p)[0],
      qEmitted[1][1] - endOf(p)[1],
    );
    expect(Math.abs(step - Math.hypot(...a))).toBeGreaterThan(1e-5);
    const [keeper, adopter] = certificateOf(result).leaves;
    expect(keeper!.displacementBound).toBe(1 / 64);
    expect(adopter!.displacementBound).toBe(adopter!.baseErrorStar);
  });

  test("C5 adversaries on lines: no authority by coordinates, one ID needs a bitwise vertex, coincident names two distinct terminal IDs, Z is bitwise", () => {
    const knot = (message: string) => ({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining(message),
    });
    // Equal coordinates, different IDs, declared as one shared point.
    expect(
      certifier.certifyPieceChain(
        vertexRequest(parallelPair([0, 0]), at0(shared())),
      ),
    ).toMatchObject(knot("shared point"));
    // One ID with a non-bitwise source vertex (a coincident gap is not shared).
    expect(
      certifier.certifyPieceChain(
        vertexRequest(
          parallelPair([2 ** -30, 0], { ids: ["v", "v"] }),
          at0(shared()),
        ),
      ),
    ).toMatchObject(knot("shared point"));
    // Coincident naming a non-terminal ID, and with equal IDs.
    expect(
      certifier.certifyPieceChain(
        vertexRequest(parallelPair([0, 0]), at0(coincident("v", "x"))),
      ),
    ).toMatchObject(knot("coincident"));
    expect(
      certifier.certifyPieceChain(
        vertexRequest(
          parallelPair([0, 0], { ids: ["v", "v"] }),
          at0(coincident("v", "v")),
        ),
      ),
    ).toMatchObject(knot("coincident"));
    // No authority at all.
    expect(
      certifier.certifyPieceChain(
        vertexRequest(parallelPair([0, 0], { ids: ["v", "v"] }), [
          { jointIndex: 0, authority: undefined as never, keeper: "first" },
        ]),
      ),
    ).toMatchObject(knot("no declared authority"));
    // Z not bitwise shared.
    const [p, q] = parallelPair([0, 0], { ids: ["v", "v"] });
    const moved = {
      ...q,
      tube: {
        ...(q as Extract<TubeChainPiece, { kind: "line" }>).tube,
        emitted: [
          [2 ** -40, D],
          [1, D],
        ],
      },
    } as TubeChainPiece;
    expect(
      certifier.certifyPieceChain(vertexRequest([p, moved], at0(shared()))),
    ).toMatchObject(knot("bitwise emitted pole"));
    // Positional closure is never admitted between two pieces.
    expect(
      certifier.certifyPieceChain(
        vertexRequest(
          parallelPair([0, 0], { ids: ["v", "v"] }),
          at0({
            kind: "positional-closure",
            pointId: "v",
          }),
        ),
      ),
    ).toMatchObject(knot("positional closure"));
  });

  test("R5 one index space: every adjacency is covered exactly once by a trim or a vertex", () => {
    const pieces = [
      ...parallelPair([0, 0], { ids: ["v", "v"] }),
      line([1, 0], [2, 0], ["q", "r"], {
        emitted: [
          [1, D],
          [2, D],
        ],
      }),
    ];
    const bounds = {
      firstParameterBounds: [0.5, 0.5],
      secondParameterBounds: [0.5, 0.5],
    } as const;
    const invalid = (message: string) => ({
      kind: "uncertain",
      code: "invalid-cubic-tube-chain",
      message: expect.stringContaining(message),
    });
    // Missing adjacency 1.
    expect(
      certifier.certifyPieceChain(vertexRequest(pieces, at0(shared()))),
    ).toMatchObject(invalid("per adjacency"));
    // Adjacency 0 twice (trim and vertex).
    expect(
      certifier.certifyPieceChain(
        vertexRequest(pieces, at0(shared()), {
          trims: [{ jointIndex: 0, ...bounds }],
        }),
      ),
    ).toMatchObject(invalid("Vertex 0"));
    // Out of order / out of range.
    expect(
      certifier.certifyPieceChain(
        vertexRequest(pieces, [
          { jointIndex: 1, authority: shared("q"), keeper: "first" },
          { jointIndex: 0, authority: shared(), keeper: "first" },
        ]),
      ),
    ).toMatchObject(invalid("Vertex 1"));
    expect(
      certifier.certifyPieceChain(
        vertexRequest(pieces, [
          { jointIndex: 0, authority: shared(), keeper: "first" },
          { jointIndex: 2, authority: shared("q"), keeper: "first" },
        ]),
      ),
    ).toMatchObject(invalid("Vertex 1"));
    // Both as vertices: verified, the index names each adjacency.
    const certificate = certificateOf(
      certifier.certifyPieceChain(
        vertexRequest(pieces, [
          { jointIndex: 0, authority: shared(), keeper: "first" },
          { jointIndex: 1, authority: shared("q"), keeper: "first" },
        ]),
      ),
    );
    expect(
      certificate.joins.map((join) =>
        "jointIndex" in join ? [join.jointIndex, join.first, join.second] : [],
      ),
    ).toEqual([
      [0, 0, 1],
      [1, 1, 2],
    ]);
  });

  test("reversed line pieces: the traversal-signed K1 and J2′ read traversal tangents (lines drawn toward the vertex, starts meeting)", () => {
    // Traversal P: (0,0) → (−1,0) reversed; Q: (0,0) → (−1, 1/64)... both
    // natural STARTS at the shared vertex, the first traversed backwards.
    const p = line([0, 0], [-1, 0], ["v", "p"], { reversed: true });
    const q = line([0, 0], [1, 1 / 64], ["v", "q"]);
    const pTube = (p as Extract<TubeChainPiece, { kind: "line" }>).tube;
    const qTube = (q as Extract<TubeChainPiece, { kind: "line" }>).tube;
    const adopted = {
      ...q,
      tube: { ...qTube, emitted: [pTube.emitted[0], qTube.emitted[1]] },
    } as TubeChainPiece;
    const result = certifier.certifyPieceChain(
      vertexRequest([p, adopted], at0(shared())),
    );
    expect(vertexJoin(result)).toMatchObject({
      kind: "nonparallel-vertex",
      side: "concave",
    });
    // The natural-sign cone (unsigned sum) cancels here: the traversal chord
    // sum is ≈ (2, 1/64), the natural one ≈ (0, 1/64).
    expect(vertexJoin(result).direction[0]).toBeGreaterThan(1.9);
  });

  /** Real owner output of a positional closure (closing occurrence of `closeId`). */
  const positionalTubes = (closeId: string, distance: number) => {
    const points: readonly Vector[] = [
      [0, 0],
      [1, 0],
      [0, 1.5],
      [-1, 0],
      [0, 0],
    ];
    const geometry = reconstructSpline({
      id: "loop",
      policy: "centripetal-mean-arm-v1",
      closure: "positional",
      points: points.map((position, index) => ({
        occurrenceId: `o${index}`,
        id: index === 4 ? closeId : `p${index}`,
        position,
        tangent: { kind: "automatic" as const },
      })),
    });
    if (geometry.validity !== "valid") throw new Error("invalid fixture");
    const free = approximateSplineOffset({
      spans: geometry.spans,
      distance,
      modelingTolerance: TOLERANCE,
    });
    if (!free.ok) throw new Error(free.code);
    const second = approximateSplineOffset({
      spans: geometry.spans,
      distance,
      modelingTolerance: TOLERANCE,
      ...(closeId === "p0"
        ? {
            sharedEndpoints: {
              end: {
                neighbour: free.spans[0]!,
                neighbourEnd: "start" as const,
                authority: { kind: "positionalClosure" as const },
              },
            },
          }
        : {}),
    });
    if (!second.ok) throw new Error(second.code);
    return second.spans.map((span) => ({
      ...span,
      queryDomain: span.sourceInterval,
    }));
  };
  const closedPiece = (tubes: readonly NeutralCubicPieceTube[]) =>
    ({ kind: "cubic", reversed: false, tubes }) as const;
  const positional = (pointId = "p0") =>
    ({ kind: "positional-closure", pointId }) as const;

  test("positional closure (real owner, two passes): the closure is a parallel vertex; distinct IDs, a split of one spline and an unauthorized closure trim fail closed", () => {
    const distance = 0.01;
    const tubes = positionalTubes("p0", distance);
    const closed = (
      vertices: PieceTubeChainRequest["vertices"],
      trims: PieceTubeChainRequest["trims"] = [],
    ) =>
      vertexRequest([closedPiece(tubes)], vertices, {
        distance,
        modelingTolerance: TOLERANCE,
        closed: true,
        trims,
      });
    const certificate = certificateOf(
      certifier.certifyPieceChain(closed(at0(positional(), "second"))),
    );
    expect(vertexJoin({ kind: "verified", certificate })).toMatchObject({
      kind: "parallel-vertex",
      authority: "positional-closure",
      first: tubes.length - 1,
      second: 0,
    });
    const knot = (message: string) => ({
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining(message),
    });
    // The closing occurrence of a DIFFERENT point ID: no positional authority.
    const distinct = positionalTubes("p9", distance);
    expect(
      certifier.certifyPieceChain(
        vertexRequest([closedPiece(distinct)], at0(positional(), "second"), {
          distance,
          modelingTolerance: TOLERANCE,
          closed: true,
        }),
      ),
    ).toMatchObject(knot("positional closure needs"));
    // Two pieces of ONE spline joined by a shared point (intra-spline).
    const cut = tubes.findIndex((tube) => tube.source.spanIndex === 2);
    expect(
      certifier.certifyPieceChain(
        vertexRequest(
          [closedPiece(tubes.slice(0, cut)), closedPiece(tubes.slice(cut))],
          at0(shared(tubes[cut]!.source.startPointId!)),
          { distance, modelingTolerance: TOLERANCE },
        ),
      ),
    ).toMatchObject(knot("two pieces of one spline"));
    // T7: a trim inside one closed piece without its positional authority.
    const bounds = {
      firstParameterBounds: [0.5, 0.5],
      secondParameterBounds: [0.5, 0.5],
    } as const;
    expect(
      certifier.certifyPieceChain(closed([], [{ jointIndex: 0, ...bounds }])),
    ).toMatchObject(knot("Trim 0: no declared authority"));
    expect(
      certifier.certifyPieceChain(
        closed([], [{ jointIndex: 0, ...bounds, authority: shared("p0") }]),
      ),
    ).toMatchObject(knot("Trim 0: no declared authority"));
  });

  test("R8: a looped one-leaf cubic with a VERTEX end is rejected by the vertex K1 (the lifted one-leaf case is covered by the certificate)", () => {
    const loop: SplinePoles = [
      [0, 0],
      [3, 3],
      [-2, 3],
      [1, 0],
    ];
    const tube: NeutralCubicPieceTube = {
      poles: loop,
      certifiedError: 0,
      reference: {
        derivative: [
          [-15, 9],
          [-9, 9],
        ],
        sourcePoles: loop,
        distance: D,
      },
      source: {
        splineId: "loop",
        spanIndex: 0,
        startOccurrenceId: "o0",
        endOccurrenceId: "o1",
        startPointId: "p",
        endPointId: "v",
      },
      sourceLocalInterval: [0, 1],
      queryDomain: [0, 1],
    };
    const exit = line([1, 0], [2, 0], ["v", "q"], {
      emitted: [
        [1, 0],
        [2, D],
      ],
    });
    expect(
      certifier.certifyPieceChain(
        vertexRequest([closedPiece([tube]), exit], at0(shared()), {
          modelingTolerance: 1 / 32,
        }),
      ),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-cone-unproven",
      message: expect.stringContaining("Declared vertex 0"),
    });
  });

  test("openRequest: one budget, attempt k ≥ 2 pays a fixed 64 before any work, exhaustion is sticky, over-issue and bad sizes throw", () => {
    const requestOf = () =>
      vertexRequest(parallelPair([2 ** -11, 0]), at0(coincident()));
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const single = createCertifiedCubicTubeChainWithBudgetObserverForTest(
      (snapshot) => snapshots.push(snapshot),
    );
    certificateOf(single.certifyPieceChain(requestOf()));
    const once = snapshots.at(-1)!;
    snapshots.length = 0;
    const staged = single.openRequest(2);
    certificateOf(staged.certifyPieceChain(requestOf()));
    certificateOf(staged.certifyPieceChain(requestOf()));
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]).toEqual(once);
    expect(snapshots[1]!.operations).toBe(2 * once.operations + 64);
    expect(snapshots[1]!.euclideanSteps).toBe(2 * once.euclideanSteps);
    expect(() => staged.certifyPieceChain(requestOf())).toThrow(RangeError);
    expect(() => single.openRequest(0)).toThrow(RangeError);
    expect(() => single.openRequest(1.5)).toThrow(RangeError);
    // Count / count − 1 over the whole staged request (ops is additive).
    const total = snapshots[1]!.operations;
    const lower = (operations: number) =>
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        operations,
      }).openRequest(2);
    const exact = lower(total);
    expect(exact.certifyPieceChain(requestOf()).kind).toBe("verified");
    expect(exact.certifyPieceChain(requestOf()).kind).toBe("verified");
    const short = lower(total - 1);
    expect(short.certifyPieceChain(requestOf()).kind).toBe("verified");
    expect(short.certifyPieceChain(requestOf())).toEqual(EXHAUSTED_RESULT);
    // Sticky: an attempt exhausted inside attempt 1 never lets attempt 2 work.
    snapshots.length = 0;
    const tiny = createCertifiedCubicTubeChainWithLowerBudgetForTest({
      operations: once.operations - 1,
    }).openRequest(2);
    expect(tiny.certifyPieceChain(requestOf())).toEqual(EXHAUSTED_RESULT);
    expect(tiny.certifyPieceChain(requestOf())).toEqual(EXHAUSTED_RESULT);
  });

  test("R9 sticky: a per-value bits exhaustion of attempt 1 never lets a smaller-bits attempt 2 (or 3) work on the same staged request", () => {
    // The convex corner reaches 378 stored bits, the parallel coincident gap
    // 276 (observer, meter review): bits are per value, not cumulative, so
    // only the sticky flag stops the small request after the big one.
    const big = () =>
      vertexRequest(convexCorner(), at0(shared()), {
        modelingTolerance: 1 / 16,
      });
    const small = () =>
      vertexRequest(parallelPair([2 ** -11, 0]), at0(coincident()));
    const lower = () =>
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        integerBits: 276,
      });
    // Controls: alone, the small request verifies and the big one exhausts.
    expect(lower().certifyPieceChain(small()).kind).toBe("verified");
    expect(lower().certifyPieceChain(big())).toEqual(EXHAUSTED_RESULT);
    const two = lower().openRequest(2);
    expect(two.certifyPieceChain(big())).toEqual(EXHAUSTED_RESULT);
    expect(two.certifyPieceChain(small()), "sticky").toEqual(EXHAUSTED_RESULT);
    const three = lower().openRequest(3);
    expect(three.certifyPieceChain(small()).kind).toBe("verified");
    expect(three.certifyPieceChain(big())).toEqual(EXHAUSTED_RESULT);
    expect(three.certifyPieceChain(small()), "sticky after attempt 2").toEqual(
      EXHAUSTED_RESULT,
    );
  });

  // Whole-request literal of one fabricated vertex row (parallel coincident
  // gap, the only kind that charges the bridge √): observer exact; count
  // passes; count − 1 exhausts on operations, Euclid and bits.
  const VERTEX_PIN = {
    operations: 8_053,
    euclideanSteps: 716,
    integerBits: 276,
  };
  test("fabricated vertex whole-request literal (observer), count / count − 1 on all three meters", () => {
    const requestOf = () =>
      vertexRequest(parallelPair([2 ** -11, 0]), at0(coincident()));
    let snapshot: ExactProofBudgetSnapshot | undefined;
    certificateOf(
      createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
        snapshot = value;
      }).certifyPieceChain(requestOf()),
    );
    const measured = {
      operations: snapshot!.operations,
      euclideanSteps: snapshot!.euclideanSteps,
      integerBits: Math.max(
        snapshot!.maxStoredBits,
        snapshot!.maxPreProductBits,
      ),
    };
    expect(measured).toEqual(VERTEX_PIN);
    for (const kind of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: VERTEX_PIN[kind],
        }).certifyPieceChain(requestOf()).kind,
        kind,
      ).toBe("verified");
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: VERTEX_PIN[kind] - 1,
        }).certifyPieceChain(requestOf()),
        kind,
      ).toEqual(EXHAUSTED_RESULT);
    }
  });

  test("vertex sub-stage caps: K1, classification, the bridge √, the convex G2 √ and the vertex output exhaust as themselves", () => {
    const parallel = () =>
      vertexRequest(parallelPair([2 ** -11, 0]), at0(coincident()));
    const convex = () =>
      vertexRequest(convexCorner(), at0(shared()), {
        modelingTolerance: 1 / 16,
      });
    // Stage map (meter review, instrumented copy): parallel gap V-precharged
    // 5 890 → V-K1 6 644 → V-class 6 832 → V-gap (bridge √) 7 153 → V-exit
    // 7 279, Euclid V-class 581 → V-gap 592; convex V-J2-cones 14 931 →
    // V-convex-done 16 103, Euclid 2 557 → 2 734.
    for (const [request, kind, cap] of [
      [parallel, "operations", 6_300],
      [parallel, "operations", 6_700],
      [parallel, "operations", 7_000],
      [parallel, "euclideanSteps", 590],
      [parallel, "operations", 7_200],
      [convex, "operations", 15_500],
      [convex, "euclideanSteps", 2_650],
    ] as const)
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: cap,
        }).certifyPieceChain(request()),
        `${kind} ${cap}`,
      ).toEqual(EXHAUSTED_RESULT);
  });

  test("the vertex precharge is paid BEFORE authorization: an authority-rejected vertex costs exactly 4 840 ops; 4 839 exhausts", () => {
    const rejected = () =>
      vertexRequest(
        parallelPair([0, 0], { ids: ["v", "v"] }),
        at0(shared("zz")),
      );
    const lower = (operations: number) =>
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        operations,
      }).certifyPieceChain(rejected());
    expect(lower(4_840)).toEqual({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      message:
        "Declared vertex 0: a shared point needs one terminal point ID and a bitwise source vertex.",
      first: 0,
      second: 1,
    });
    expect(lower(4_839)).toEqual(EXHAUSTED_RESULT);
  });

  /** Real owner of one fabricated source span (point IDs, optional adoption). */
  const ownerPiece = (
    poles: SplinePoles,
    id: string,
    [startPointId, endPointId]: readonly [string, string],
    distance: number,
    sharedEndpoints?: {
      start?: AdoptedEndpoint;
      end?: AdoptedEndpoint;
    },
  ) => {
    const result = approximateSplineOffset({
      spans: [
        {
          source: {
            splineId: id,
            spanIndex: 0,
            startPointId,
            endPointId,
            startOccurrenceId: `${id}o0`,
            endOccurrenceId: `${id}o1`,
          },
          orientation: "forward",
          interval: [0, 1],
          poles,
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
        },
      ],
      distance,
      modelingTolerance: TOLERANCE,
      ...(sharedEndpoints ? { sharedEndpoints } : {}),
    });
    if (!result.ok) throw new Error(result.code);
    return result.spans;
  };
  const tubesOf = (spans: ReturnType<typeof ownerPiece>) =>
    spans.map((span) => ({ ...span, queryDomain: span.sourceInterval }));
  /** Straight cubic source from `from` to `to` (uniform poles, exact ends). */
  const straightSource = (from: Vector, to: Vector) =>
    [
      from,
      [from[0] + (to[0] - from[0]) / 3, from[1] + (to[1] - from[1]) / 3],
      [
        from[0] + (2 * (to[0] - from[0])) / 3,
        from[1] + (2 * (to[1] - from[1])) / 3,
      ],
      to,
    ] as unknown as SplinePoles;
  /** Cubic arc of radius R from `start` at direction φ, sweep θ (left if θ > 0). */
  const arcSource = (
    start: Vector,
    phi: number,
    radius: number,
    theta: number,
  ) => {
    const k = (4 / 3) * Math.tan(theta / 4);
    const t0: Vector = [Math.cos(phi), Math.sin(phi)];
    const t1: Vector = [Math.cos(phi + theta), Math.sin(phi + theta)];
    const center: Vector = [
      start[0] - radius * t0[1],
      start[1] + radius * t0[0],
    ];
    const end: Vector = [
      center[0] + radius * Math.sin(phi + theta),
      center[1] - radius * Math.cos(phi + theta),
    ];
    return [
      [start[0], start[1]],
      [start[0] + k * radius * t0[0], start[1] + k * radius * t0[1]],
      [end[0] - k * radius * t1[0], end[1] - k * radius * t1[1]],
      end,
    ] as unknown as SplinePoles;
  };
  const reversedSource = (poles: SplinePoles) =>
    [poles[3], poles[2], poles[1], poles[0]] as unknown as SplinePoles;
  /** Q (traversal reversed) curls inward and adopts P's end pole (shared point). */
  const qReversedRow = (): PieceTubeChainRequest => {
    const d = 0.01;
    const p = ownerPiece(straightSource([-0.3, 0], [0, 0]), "P", ["p", "v"], d);
    const q = ownerPiece(
      reversedSource(
        arcSource(
          [0, 0],
          0.007911509979516267,
          0.027146307589486243,
          1.3016902776435018,
        ),
      ),
      "Q",
      ["q", "v"],
      -d,
      {
        end: {
          neighbour: p.at(-1)!,
          neighbourEnd: "end",
          authority: { kind: "sharedPoint" },
        },
      },
    );
    return vertexRequest(
      [
        { kind: "cubic", reversed: false, tubes: tubesOf(p) },
        { kind: "cubic", reversed: true, tubes: tubesOf(q) },
      ],
      at0(shared()),
      { distance: d, modelingTolerance: TOLERANCE },
    );
  };
  /** P (traversal reversed) curls inward; Q adopts P's natural start pole. */
  const pReversedRow = (): PieceTubeChainRequest => {
    const d = -0.01;
    const phi = -0.00558565815538168;
    const p = ownerPiece(
      arcSource([0, 0], Math.PI, 0.028079077823553233, 0.6997285035438836),
      "P",
      ["v", "p"],
      -d,
    );
    const q = ownerPiece(
      straightSource([0, 0], [0.3 * Math.cos(phi), 0.3 * Math.sin(phi)]),
      "Q",
      ["v", "q"],
      d,
      {
        start: {
          neighbour: p[0]!,
          neighbourEnd: "start",
          authority: { kind: "sharedPoint" },
        },
      },
    );
    return vertexRequest(
      [
        { kind: "cubic", reversed: true, tubes: tubesOf(p) },
        { kind: "cubic", reversed: false, tubes: tubesOf(q) },
      ],
      at0(shared()),
      { distance: d, modelingTolerance: TOLERANCE },
    );
  };
  test.each([
    ["Q reversed (outgoing curls inward)", qReversedRow],
    ["P reversed (incoming curls inward)", pReversedRow],
  ] as const)(
    "reversed-leaf slope rate (math review M-R3; real owner, certifier input, not owner-reachable through a native chain): %s at |d|κ ≈ 0.4–0.6 verifies as one concave vertex only with the traversal-signed rate",
    (_label, requestOf) => {
      // An unsigned rate (natural cross over the signed cone) fails J2′
      // uniqueness here: "not proved to cross only once".
      expect(
        certificateOf(certifier.certifyPieceChain(requestOf())).joins.filter(
          (join) => join.kind === "nonparallel-vertex",
        ),
      ).toEqual([
        expect.objectContaining({
          kind: "nonparallel-vertex",
          side: "concave",
          authority: "shared-point",
          jointIndex: 0,
          keeper: "first",
        }),
      ]);
    },
  );
});

describe("piece tube chain (T08b-e): F1 arcs at convex declared vertices (certifier-input fixtures, not owner-reachable)", () => {
  type Vector = readonly [number, number];
  const D = 1 / 64;
  const TAU = 2 ** -10;
  /** Line tube with point IDs; emitted = source + d·ν unless overridden. */
  const line = (
    start: Vector,
    end: Vector,
    ids: readonly [string, string],
    {
      distance = -D,
      emitted,
      reversed = false,
    }: {
      distance?: number;
      emitted?: readonly [Vector, Vector];
      reversed?: boolean;
    } = {},
  ): TubeChainPiece => {
    const owner = reversed ? -distance : distance;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const normal: Vector = [
      -(end[1] - start[1]) / length,
      (end[0] - start[0]) / length,
    ];
    const offset = (point: Vector): Vector => [
      point[0] + owner * normal[0],
      point[1] + owner * normal[1],
    ];
    return {
      kind: "line",
      reversed,
      tube: {
        emitted: emitted ?? [offset(start), offset(end)],
        source: [start, end],
        distance: owner,
        startPointId: ids[0],
        endPointId: ids[1],
      },
    };
  };
  const emittedOf = (piece: TubeChainPiece) =>
    (piece as Extract<TubeChainPiece, { kind: "line" }>).tube.emitted;
  type Arc = NonNullable<PieceTubeChainRequest["arcs"]>[number];
  const shared = (pointId = "v") =>
    ({ kind: "shared-point", pointId }) as const;
  const coincident = (a = "v", b = "w") =>
    ({ kind: "coincident", pointIds: [a, b] }) as const;
  const arcRequest = (
    pieces: readonly TubeChainPiece[],
    arcs: readonly Arc[],
    {
      distance = -D,
      modelingTolerance = TAU,
      closed = false,
      trims = [],
      vertices,
    }: {
      distance?: number;
      modelingTolerance?: number;
      closed?: boolean;
      trims?: PieceTubeChainRequest["trims"];
      vertices?: PieceTubeChainRequest["vertices"];
    } = {},
  ): PieceTubeChainRequest => ({
    modelingTolerance,
    closed,
    distance,
    pieces,
    trims,
    ...(vertices ? { vertices } : {}),
    arcs,
  });
  const arcAt = (
    center: Vector,
    radius: number,
    sweep: Arc["sweep"],
    authority: Arc["authority"] = shared(),
  ): Arc => ({ jointIndex: 0, authority, center, radius, sweep });
  const certificateOf = (result: TubePieceChainResult) => {
    if (result.kind !== "verified")
      throw new Error(`${result.kind} ${result.code}: ${result.message}`);
    return result.certificate;
  };
  /**
   * Exact LL-90 corner (D = 0): P along +x into V = 0, Q up along +y, d = −D
   * (a left turn offset to the right: convex). A′ = (0, −D), B′ = (D, 0),
   * ρ = D exactly; a·b = 0, so the arc splits at s = a + b (R1).
   */
  const rightAngle = ({ gap = [0, 0] as Vector } = {}) => {
    const p = line([-1, 0], [0, 0], ["p", "v"]);
    const q = line(
      gap,
      [gap[0], gap[1] + 1],
      [gap[0] === 0 && gap[1] === 0 ? "v" : "w", "q"],
    );
    return [p, q] as const;
  };
  const rightAngleArc = (overrides: Partial<Arc> = {}): Arc => ({
    ...arcAt([0, 0], D, "counterClockwise"),
    ...overrides,
  });
  /**
   * Single-sub-arc corner (7-24-25): P along (7, 24) into V = 0, Q along +x,
   * d = +D (a right turn offset to the left: convex, σ = −1), turn ≈ 73.7°.
   */
  const acute = () => {
    const p = line([-7 / 32, -24 / 32], [0, 0], ["p", "v"], { distance: D });
    const q = line([0, 0], [1, 0], ["v", "q"], { distance: D });
    const a = emittedOf(p)[1];
    return {
      pieces: [p, q] as const,
      arc: arcAt([0, 0], Math.hypot(a[0], a[1]), "clockwise"),
    };
  };
  const failureOf = (result: TubePieceChainResult) => {
    if (result.kind === "verified") throw new Error("verified");
    return result;
  };

  test("exact LL-90 corner (D = 0): two sub-arcs split at a + b, flattened after the pieces; records bitwise; the (P, Q) pair is K3-cleared", () => {
    const certificate = certificateOf(
      certifier.certifyPieceChain(arcRequest(rightAngle(), [rightAngleArc()])),
    );
    expect(certificate.arcs).toEqual([
      {
        jointIndex: 0,
        authority: "shared-point",
        leaves: [2, 3],
        center: [0, 0],
        radius: D,
        sweep: "counterClockwise",
        epsilon: [expect.any(Number), expect.any(Number)],
        entryConnector: 0,
        exitConnector: 0,
      },
    ]);
    // Lemma A: the only nonzero terms are the lines' outward end errors.
    for (const value of certificate.arcs![0]!.epsilon)
      expect(value).toBeLessThan(1e-16);
    expect(certificate.joins).toEqual([
      {
        kind: "arc-entry",
        jointIndex: 0,
        first: 0,
        second: 2,
        direction: [D, 0],
        tangentDeviation: 0,
      },
      {
        kind: "arc-knot",
        jointIndex: 0,
        first: 2,
        second: 3,
        direction: [D, D],
      },
      {
        kind: "arc-exit",
        jointIndex: 0,
        first: 3,
        second: 1,
        direction: [0, D],
        tangentDeviation: 0,
        bridge: 0,
      },
    ]);
    // Arc leaves: collapsed connectors, strict ε < τ, displacementBound = τ.
    expect(certificate.leaves).toHaveLength(4);
    for (const leaf of certificate.leaves.slice(2)) {
      expect(leaf.displacementBound).toBe(TAU);
      expect(leaf.clearanceRadius).toBe(leaf.baseErrorStar);
    }
    // The neighbours keep their own ε: no correction, reserve or inflation.
    for (const leaf of certificate.leaves.slice(0, 2)) {
      expect(leaf.displacementBound).toBe(leaf.baseErrorStar);
      expect(leaf.clearanceRadius).toBe(leaf.baseErrorStar);
    }
    // Every non-adjacent pair, including the arc's (P, Q) leaves.
    expect(certificate.clearedPairs).toEqual([
      [0, 1],
      [0, 3],
      [1, 2],
    ]);
  });

  test("single sub-arc (7-24-25, σ = −1): one arc leaf, clockwise; G1 at rounding; the helper radius is certified as given", () => {
    const { pieces, arc } = acute();
    const certificate = certificateOf(
      certifier.certifyPieceChain(arcRequest(pieces, [arc], { distance: D })),
    );
    expect(certificate.arcs).toEqual([
      expect.objectContaining({
        leaves: [2],
        radius: arc.radius,
        sweep: "clockwise",
      }),
    ]);
    const kinds = certificate.joins.map((join) => join.kind);
    expect(kinds).toEqual(["arc-entry", "arc-exit"]);
    for (const join of certificate.joins)
      if ("tangentDeviation" in join)
        expect(join.tangentDeviation).toBeLessThan(1e-14);
    expect(certificate.clearedPairs).toEqual([[0, 1]]);
    expect(certificate.arcs![0]!.epsilon[0]).toBeLessThan(1e-16);
  });

  /**
   * Exact straight cubic neighbours of the LL-90 corner (E = O + (0, −D)
   * translated exactly, so ε = π is honest) with Q4-E1 metadata π₃ = π₀ = π:
   * every Lemma-A term but π vanishes, so the arc's ε is exactly π.
   */
  const cubicCorner = (pi: number) => {
    const tube = (
      splineId: string,
      source: SplinePoles,
      shift: Vector,
      ids: readonly [string, string],
      derivative: NeutralCubicPieceTube["reference"]["derivative"],
    ): NeutralCubicPieceTube => ({
      poles: source.map(([x, y]) => [
        x + shift[0],
        y + shift[1],
      ]) as unknown as SplinePoles,
      certifiedError: pi,
      reference: {
        derivative,
        sourcePoles: source,
        distance: -D,
        localError: { hermiteRemainder: 0, polePerturbations: [pi, 0, 0, pi] },
      },
      source: {
        splineId,
        spanIndex: 0,
        startOccurrenceId: `${splineId}0`,
        endOccurrenceId: `${splineId}1`,
        startPointId: ids[0],
        endPointId: ids[1],
      },
      sourceLocalInterval: [0, 1],
      queryDomain: [0, 1],
    });
    const vertical = straight(0, 1).map(([x, y]) => [
      y,
      x,
    ]) as unknown as SplinePoles;
    return [
      {
        kind: "cubic",
        reversed: false,
        tubes: [
          tube(
            "P",
            straight(-1, 0),
            [0, -D],
            ["p", "v"],
            [
              [0.75, 1.5],
              [0, 0],
            ],
          ),
        ],
      },
      {
        kind: "cubic",
        reversed: false,
        tubes: [
          tube(
            "Q",
            vertical,
            [D, 0],
            ["v", "q"],
            [
              [0, 0],
              [0.75, 1.5],
            ],
          ),
        ],
      },
    ] as const satisfies readonly TubeChainPiece[];
  };

  test("R3 strict ε: an arc leaf whose Lemma-A ε equals τ exactly is not certified; one ulp more τ verifies", () => {
    const pi = 2 ** -12;
    const request = (modelingTolerance: number) =>
      arcRequest(cubicCorner(pi), [rightAngleArc()], { modelingTolerance });
    expect(failureOf(certifier.certifyPieceChain(request(pi)))).toMatchObject({
      code: "cubic-tube-knot-incidence-unproven",
      message: expect.stringContaining(
        "not strictly below the modeling tolerance",
      ),
      arcJoints: [0],
    });
    const certificate = certificateOf(
      certifier.certifyPieceChain(request(pi + 2 ** -64)),
    );
    expect(certificate.arcs![0]!.epsilon).toEqual([pi, pi]);
    // The neighbours at ε = π ≤ τ keep their non-strict own bound.
    expect(certificate.leaves[0]!.displacementBound).toBe(pi);
  });

  test("R1: at D ≈ 0 a rounded a·b > 0 with a·n₂ < 0 still splits at a + b (two sub-arcs; the reference wedge W(n₁, n₂) is not a·-positive)", () => {
    const eta = 2 ** -20;
    const p = line([-1, 0], [0, 0], ["p", "v"], {
      emitted: [
        [-1, -D],
        [-eta, -D],
      ],
    });
    const q = line([0, 0], [0, 1], ["v", "q"], {
      emitted: [
        [D, -2 * eta],
        [D, 1],
      ],
    });
    const a: Vector = [-eta, -D];
    const b: Vector = [D, -2 * eta];
    // The review's rounding case: a·b > 0 but a·n₂ = a_x < 0 (n₂ = (1, 0)).
    expect(a[0] * b[0] + a[1] * b[1]).toBeGreaterThan(0);
    expect(a[0]).toBeLessThan(0);
    const certificate = certificateOf(
      certifier.certifyPieceChain(
        arcRequest([p, q], [rightAngleArc({ radius: Math.hypot(...a) })]),
      ),
    );
    expect(certificate.arcs![0]!.leaves).toEqual([2, 3]);
    expect(certificate.joins.map((join) => join.kind)).toContain("arc-knot");
  });

  test("R2 one sub-arc with a gap: the bridge needs e_out·(O′_P box) > 0 or e_in·g ≥ 0; a loose honest P box with e_in·g < 0 fails, either branch alone verifies", () => {
    // P: exact straight cubic along +x into V = 0 (E = O + (0, −D) exactly),
    // Q: a line along (7, 24)/25 from the coincident gap g (73.7° left turn,
    // d = −D convex, one sub-arc).
    const pOf = (
      derivative: NeutralCubicPieceTube["reference"]["derivative"],
    ) =>
      ({
        kind: "cubic",
        reversed: false,
        tubes: [
          {
            poles: straight(-1, 0).map(([x, y]) => [
              x,
              y - D,
            ]) as unknown as SplinePoles,
            certifiedError: 2 ** -20,
            reference: {
              derivative,
              sourcePoles: straight(-1, 0),
              distance: -D,
            },
            source: {
              splineId: "P",
              spanIndex: 0,
              startOccurrenceId: "P0",
              endOccurrenceId: "P1",
              startPointId: "p",
              endPointId: "v",
            },
            sourceLocalInterval: [0, 1],
            queryDomain: [0, 1],
          },
        ],
      }) as const satisfies TubeChainPiece;
    const tight: NeutralCubicPieceTube["reference"]["derivative"] = [
      [0.75, 1.5],
      [0, 0],
    ];
    // Honest (it contains the true O′ = S′) but reaches e_out·v < 0.
    const loose: NeutralCubicPieceTube["reference"]["derivative"] = [
      [0.75, 1.5],
      [-0.5, 0],
    ];
    const request = (
      derivative: NeutralCubicPieceTube["reference"]["derivative"],
      g: Vector,
    ) =>
      arcRequest(
        [pOf(derivative), line(g, [g[0] + 7 / 25, g[1] + 24 / 25], ["w", "q"])],
        [rightAngleArc({ authority: coincident(), radius: D })],
        { modelingTolerance: 2 ** -8 },
      );
    const backward: Vector = [-(2 ** -12), 2 ** -11];
    const forward: Vector = [2 ** -12, 2 ** -11];
    expect(
      failureOf(certifier.certifyPieceChain(request(loose, backward))),
    ).toMatchObject({
      code: "cubic-tube-cone-unproven",
      message: expect.stringContaining("bridge is not proved apart"),
      arcJoints: [0],
    });
    for (const [derivative, g] of [
      [tight, backward],
      [loose, forward],
    ] as const) {
      const certificate = certificateOf(
        certifier.certifyPieceChain(request(derivative, g)),
      );
      expect(certificate.arcs![0]!.leaves).toEqual([2]);
    }
  });

  test("Lemma E (E1) on a cubic neighbour: an honest O′ box not e_in-positive fails the arc-entry cone (the hodograph alone passes)", () => {
    const [p, q] = cubicCorner(2 ** -20);
    const tube = p.tubes[0]!;
    const loose: TubeChainPiece = {
      ...p,
      tubes: [
        {
          ...tube,
          reference: {
            ...tube.reference,
            derivative: [
              [-0.25, 1.5],
              [0, 0],
            ],
          },
        },
      ],
    };
    expect(
      failureOf(
        certifier.certifyPieceChain(arcRequest([loose, q], [rightAngleArc()])),
      ),
    ).toMatchObject({
      code: "cubic-tube-cone-unproven",
      message: expect.stringContaining("arc-entry cone"),
      first: 0,
      second: 2,
      arcJoints: [0],
    });
  });

  test("K3 on the arc's (P, Q) pair: an arc shorter than the neighbours' honest tubes is clearance-unproven, tagged with its arc (never a join)", () => {
    // A 2⁻¹⁰-radian turn: chord ≈ D·2⁻¹⁰ ≈ 1.5e-5, below P's honest far-end
    // error 2⁻¹² (its K3 radius).
    const turn = 2 ** -10;
    const p = line([-1, 0], [0, 0], ["p", "v"], {
      emitted: [
        [-1, -D + 2 ** -12],
        [0, -D],
      ],
    });
    const q = line([0, 0], [1, turn], ["v", "q"]);
    const a = emittedOf(p)[1];
    expect(
      failureOf(
        certifier.certifyPieceChain(
          arcRequest(
            [p, q],
            [arcAt([0, 0], Math.hypot(a[0], a[1]), "counterClockwise")],
          ),
        ),
      ),
    ).toMatchObject({
      code: "cubic-tube-clearance-unproven",
      first: 0,
      second: 1,
      arcJoints: [0],
    });
  });

  test("Lemma A is load-bearing (δ_a): A′ displaced radially by δ with ρ = |a| gives ε_in ≈ 4δ; τ = 3δ fails, τ = 5δ verifies", () => {
    const delta = 2 ** -12;
    const p = line([-1, 0], [0, 0], ["p", "v"], {
      emitted: [
        [-1, -D],
        [0, -D - delta],
      ],
    });
    const request = (modelingTolerance: number) =>
      arcRequest([p, rightAngle()[1]], [rightAngleArc({ radius: D + delta })], {
        modelingTolerance,
      });
    expect(
      failureOf(certifier.certifyPieceChain(request(3 * delta))),
    ).toMatchObject({
      message: expect.stringContaining(
        "not strictly below the modeling tolerance",
      ),
      arcJoints: [0],
    });
    const certificate = certificateOf(
      certifier.certifyPieceChain(request(5 * delta)),
    );
    // |ρ − |d|| = δ, δ_a = (2Dδ + δ²)/D, π_A ≥ δ: ε_in > 3δ.
    expect(certificate.arcs![0]!.epsilon[0]).toBeGreaterThan(3 * delta);
  });

  test("the bridge |g|⁺ is load-bearing in ε_out: a coincident gap g = (γ, 0) gives ε_out ≈ 3γ (δ_b ≈ 2γ plus |g|); τ = 2.5γ fails, τ = 4γ verifies", () => {
    const gamma = 2 ** -12;
    const request = (modelingTolerance: number) =>
      arcRequest(
        rightAngle({ gap: [gamma, 0] }),
        [rightAngleArc({ authority: coincident() })],
        { modelingTolerance },
      );
    expect(
      failureOf(certifier.certifyPieceChain(request(2.5 * gamma))),
    ).toMatchObject({
      message: expect.stringContaining(
        "not strictly below the modeling tolerance",
      ),
      arcJoints: [0],
    });
    const certificate = certificateOf(
      certifier.certifyPieceChain(request(4 * gamma)),
    );
    expect(certificate.arcs![0]!.epsilon[1]).toBeGreaterThan(2.5 * gamma);
    const exit = certificate.joins.at(-1);
    if (exit?.kind !== "arc-exit") throw new Error("exit");
    expect(exit.bridge).toBeGreaterThanOrEqual(gamma);
    expect(exit.bridge).toBeLessThan(gamma * (1 + 1e-12));
    // The exit connector is |ρ² − |b|²|/ρ ≥ γ (B′ = g + (D, 0), ρ = D).
    expect(certificate.arcs![0]!.exitConnector).toBeGreaterThan(gamma);
  });

  test("one index space: an arc and a vertex covering one adjacency, an arc index out of range or unordered arcs are invalid", () => {
    const pieces = rightAngle();
    const vertex = {
      jointIndex: 0,
      authority: shared(),
      keeper: "first" as const,
    };
    for (const request of [
      arcRequest(pieces, [rightAngleArc()], { vertices: [vertex] }),
      arcRequest(pieces, [rightAngleArc({ jointIndex: 1 })]),
      arcRequest(pieces, [rightAngleArc(), rightAngleArc()]),
    ])
      expect(certifier.certifyPieceChain(request)).toMatchObject({
        kind: "uncertain",
        code: "invalid-cubic-tube-chain",
      });
  });

  // Whole-request literal of the fabricated exact LL-90 arc row (observer):
  // count passes; count − 1 exhausts on operations, Euclid and bits.
  const ARC_PIN = {
    operations: 17_213,
    euclideanSteps: 1_671,
    integerBits: 426,
  };
  test("fabricated arc whole-request literal (observer), count / count − 1 on all three meters; staged caps inside the arc stages exhaust as themselves", () => {
    const requestOf = () => arcRequest(rightAngle(), [rightAngleArc()]);
    let snapshot: ExactProofBudgetSnapshot | undefined;
    certificateOf(
      createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
        snapshot = value;
      }).certifyPieceChain(requestOf()),
    );
    expect({
      operations: snapshot!.operations,
      euclideanSteps: snapshot!.euclideanSteps,
      integerBits: Math.max(
        snapshot!.maxStoredBits,
        snapshot!.maxPreProductBits,
      ),
    }).toEqual(ARC_PIN);
    for (const kind of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: ARC_PIN[kind],
        }).certifyPieceChain(requestOf()).kind,
        kind,
      ).toBe("verified");
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: ARC_PIN[kind] - 1,
        }).certifyPieceChain(requestOf()),
        kind,
      ).toEqual(EXHAUSTED_RESULT);
    }
    // Stage map (T08b-e-evidence/stages/): arc precharged 4 945 ops →
    // admitted 6 053 → ε 6 584 → cones 7 296 → records 7 636 → K3 7 896 …
    // 16 638; Euclid admitted 308 → ε 314.
    for (const [kind, cap] of [
      ["operations", 4_946],
      ["operations", 5_500],
      ["operations", 6_300],
      ["operations", 7_000],
      ["operations", 7_500],
      ["operations", 12_000],
      ["euclideanSteps", 305],
      ["euclideanSteps", 311],
    ] as const)
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: cap,
        }).certifyPieceChain(requestOf()),
        `${kind} ${cap}`,
      ).toEqual(EXHAUSTED_RESULT);
  });

  test("the arc precharge is paid BEFORE authorization: an authority-rejected arc costs exactly its admission ops; one fewer exhausts", () => {
    const rejected = () =>
      arcRequest(rightAngle(), [rightAngleArc({ authority: shared("zz") })]);
    let spent = 0;
    const observed = createCertifiedCubicTubeChainWithBudgetObserverForTest(
      (snapshot) => {
        spent = snapshot.operations;
      },
    ).certifyPieceChain(rejected());
    const lower = (operations: number) =>
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        operations,
      }).certifyPieceChain(rejected());
    expect(observed).toEqual({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      message:
        "Declared arc 0: a shared point needs one terminal point ID and a bitwise source vertex.",
      first: 0,
      second: 1,
      arcJoints: [0],
    });
    expect(spent).toBe(4_945);
    expect(lower(spent)).toEqual(observed);
    expect(lower(spent - 1)).toEqual(EXHAUSTED_RESULT);
  });

  test.each([
    [
      "centre ≠ P_v bitwise",
      () =>
        arcRequest(rightAngle(), [
          rightAngleArc({ center: [Number.MIN_VALUE, 0] }),
        ]),
      "knot",
      "centre is not bitwise",
    ],
    [
      "ρ = 0",
      () => arcRequest(rightAngle(), [rightAngleArc({ radius: 0 })]),
      "knot",
      "radius is not finite and positive",
    ],
    [
      "ρ < 0",
      () => arcRequest(rightAngle(), [rightAngleArc({ radius: -D })]),
      "knot",
      "radius is not finite and positive",
    ],
    [
      "ρ = NaN",
      () => arcRequest(rightAngle(), [rightAngleArc({ radius: Number.NaN })]),
      "knot",
      "radius is not finite and positive",
    ],
    [
      "ρ = ∞",
      () => arcRequest(rightAngle(), [rightAngleArc({ radius: Infinity })]),
      "knot",
      "radius is not finite and positive",
    ],
    [
      "ρ so far off that ε > τ",
      () => arcRequest(rightAngle(), [rightAngleArc({ radius: 2 * D })]),
      "knot",
      "not strictly below the modeling tolerance",
    ],
    [
      "wrong sweep",
      () => arcRequest(rightAngle(), [rightAngleArc({ sweep: "clockwise" })]),
      "knot",
      "sweep is not the exact source turn",
    ],
    [
      "an arc on a concave vertex (d = +D)",
      () =>
        arcRequest(
          [
            line([-1, 0], [0, 0], ["p", "v"], { distance: D }),
            line([0, 0], [0, 1], ["v", "q"], { distance: D }),
          ],
          [rightAngleArc()],
          { distance: D },
        ),
      "knot",
      "not convex",
    ],
    [
      "d = 0",
      () =>
        arcRequest(
          [
            line([-1, 0], [0, 0], ["p", "v"], { distance: 0 }),
            line([0, 0], [0, 1], ["v", "q"], { distance: 0 }),
          ],
          [rightAngleArc()],
          { distance: 0 },
        ),
      "knot",
      "zero offset distance",
    ],
    [
      "A′ = B′ (zero-length arc, rule Z)",
      () => {
        const [p, q] = rightAngle();
        const pinned = line([-1, 0], [0, 0], ["p", "v"], {
          emitted: [emittedOf(p)[0], emittedOf(q)[0]],
          distance: -D,
        });
        return arcRequest([pinned, q], [rightAngleArc()], {
          modelingTolerance: 1 / 16,
        });
      },
      "knot",
      "not in the exact turn orientation",
    ],
    [
      "(A2) an end direction a quarter turn or more from its normal (|d| < τ)",
      () => {
        const d = 2 ** -12;
        const r = 2 ** -13;
        const angle = (degrees: number) => (degrees * Math.PI) / 180;
        const p = line([-1, 0], [0, 0], ["p", "v"], {
          distance: -d,
          emitted: [
            [-1, -d],
            [r * Math.cos(angle(170)), r * Math.sin(angle(170))],
          ],
        });
        const q = line([0, 0], [0, 1], ["v", "q"], {
          distance: -d,
          emitted: [
            [d * Math.cos(angle(-15)), d * Math.sin(angle(-15))],
            [d, 1],
          ],
        });
        return arcRequest([p, q], [arcAt([0, 0], r, "counterClockwise")], {
          distance: -d,
        });
      },
      "knot",
      "within a quarter turn of its reference normal",
    ],
    [
      "(A4) the split a + b outside the wedges (|a| ≪ |b|, b past n₂)",
      () => {
        const angle = (20 * Math.PI) / 180;
        const p = line([-1, 0], [0, 0], ["p", "v"], {
          emitted: [
            [-1, -D],
            [0, -D / 8],
          ],
        });
        const q = line([0, 0], [0, 1], ["v", "q"], {
          emitted: [
            [D * Math.cos(angle), D * Math.sin(angle)],
            [D, 1],
          ],
        });
        return arcRequest([p, q], [rightAngleArc({ radius: D / 8 })], {
          modelingTolerance: 1 / 16,
        });
      },
      "knot",
      "split a + b is not inside",
    ],
    [
      "e_out·g < 0 (backward declared gap at the arc exit)",
      () =>
        arcRequest(rightAngle({ gap: [0, -(2 ** -12)] }), [
          rightAngleArc({ authority: coincident() }),
        ]),
      "cone",
      "backward declared gap at the arc exit",
    ],
    [
      "R2 two sub-arcs: σrot(s)·g < 0 (the bridge meets the reference sub-arc 0)",
      () =>
        arcRequest(rightAngle({ gap: [-(2 ** -12), 0] }), [
          rightAngleArc({ authority: coincident() }),
        ]),
      "cone",
      "bridge is not proved apart",
    ],
    [
      "R7 a line neighbour whose emitted step leaves the arc-entry cone (its source direction does not)",
      () => {
        const length = 2 ** -11;
        const p = line([-length, 0], [0, 0], ["p", "v"], {
          emitted: [
            [length / 4, -D],
            [0, -D],
          ],
        });
        return arcRequest([p, rightAngle()[1]], [rightAngleArc()]);
      },
      "cone",
      "incoming terminal leaf is not proved inside the arc-entry cone",
    ],
  ] as const)(
    "fabricated adversary: %s fails closed, tagged with its arc",
    (_label, requestOf, kind, message) => {
      expect(failureOf(certifier.certifyPieceChain(requestOf()))).toMatchObject(
        {
          kind: "uncertain",
          code:
            kind === "knot"
              ? "cubic-tube-knot-incidence-unproven"
              : "cubic-tube-cone-unproven",
          message: expect.stringContaining(message),
          arcJoints: [0],
        },
      );
    },
  );

  /**
   * Honest cubic↔cubic arc corner (real owner, τ = 1e-3, d = 0.01, P
   * reversed; T08b-e math review F1 row): P ends and Q starts at V = 0, Q
   * leaves at φ = −2.7456; the arc is the resolver's canonical support.
   */
  const cubicArcCorner = (): PieceTubeChainRequest => {
    const tolerance = 1e-3;
    const d = 0.01;
    const a = 0.37257013670168815 / 3;
    const [b1, b2, b3, b4] = [
      -0.02459265496581793, -0.19457978894934058, -0.028773711994290352,
      -0.06853010701015592,
    ];
    const phi = -2.745622824016027;
    const dir: Vector = [Math.cos(phi), Math.sin(phi)];
    const n: Vector = [-dir[1], dir[0]];
    const owner = (
      poles: SplinePoles,
      splineId: string,
      ids: readonly [string, string],
      distance: number,
    ) => {
      const result = approximateSplineOffset({
        spans: [
          {
            source: {
              splineId,
              spanIndex: 0,
              startPointId: ids[0],
              endPointId: ids[1],
              startOccurrenceId: `${splineId}o0`,
              endOccurrenceId: `${splineId}o1`,
            },
            orientation: "forward",
            interval: [0, 1],
            poles,
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
          },
        ],
        distance,
        modelingTolerance: tolerance,
      });
      if (!result.ok) throw new Error(result.code);
      return result.spans.map((span) => ({
        ...span,
        queryDomain: span.sourceInterval,
      }));
    };
    // P's natural poles run from V (its traversal is reversed).
    const first = owner(
      [
        [0, 0],
        [-a, 0],
        [-2 * a, b1 * a],
        [-3 * a, b2 * a],
      ],
      "P",
      ["v", "p"],
      -d,
    );
    const second = owner(
      [
        [0, 0],
        [a * dir[0], a * dir[1]],
        [2 * a * dir[0] + b3 * a * n[0], 2 * a * dir[1] + b3 * a * n[1]],
        [3 * a * dir[0] + b4 * a * n[0], 3 * a * dir[1] + b4 * a * n[1]],
      ],
      "Q",
      ["v", "q"],
      d,
    );
    const support = canonicalArcSupport(
      [0, 0],
      first[0]!.poles[0],
      second[0]!.poles[0],
      "clockwise",
    );
    return {
      modelingTolerance: tolerance,
      closed: false,
      distance: d,
      pieces: [
        { kind: "cubic", reversed: true, tubes: first },
        { kind: "cubic", reversed: false, tubes: second },
      ],
      trims: [],
      arcs: [
        {
          jointIndex: 0,
          authority: shared(),
          center: [0, 0],
          radius: support.radius,
          sweep: support.sweepDirection,
        },
      ],
    };
  };

  test("no exhaustion swallow in the arc stage (math review F1): an integerBits cap first tripped INSIDE the arc stage of an honest cubic↔cubic corner is reported as exhaustion, never as an arc-less certificate", () => {
    const full = certificateOf(certifier.certifyPieceChain(cubicArcCorner()));
    expect(full.arcs?.map((arc) => arc.leaves.length)).toEqual([2]);
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        integerBits: 151,
      }).certifyPieceChain(cubicArcCorner()),
    ).toEqual(EXHAUSTED_RESULT);
  });

  // Whole-request literal of a gapped fabricated arc (meter review R2): the
  // arc-exit bridge |g|⁺ is a verified, charged √.
  const GAP_ARC_PIN = {
    operations: 18_787,
    euclideanSteps: 1_929,
    integerBits: 432,
  };
  test("gapped fabricated arc whole-request literal (observer): the bridge |g|⁺ is a verified √; count / count − 1 on all three meters", () => {
    const requestOf = () =>
      arcRequest(rightAngle({ gap: [2 ** -12, 0] }), [
        rightAngleArc({ authority: coincident() }),
      ]);
    let snapshot: ExactProofBudgetSnapshot | undefined;
    const certificate = certificateOf(
      createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
        snapshot = value;
      }).certifyPieceChain(requestOf()),
    );
    const exit = certificate.joins.at(-1);
    if (exit?.kind !== "arc-exit") throw new Error("exit");
    expect(exit.bridge).toBeGreaterThanOrEqual(2 ** -12);
    expect({
      operations: snapshot!.operations,
      euclideanSteps: snapshot!.euclideanSteps,
      integerBits: Math.max(
        snapshot!.maxStoredBits,
        snapshot!.maxPreProductBits,
      ),
    }).toEqual(GAP_ARC_PIN);
    for (const kind of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: GAP_ARC_PIN[kind],
        }).certifyPieceChain(requestOf()).kind,
        kind,
      ).toBe("verified");
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [kind]: GAP_ARC_PIN[kind] - 1,
        }).certifyPieceChain(requestOf()),
        kind,
      ).toEqual(EXHAUSTED_RESULT);
    }
  });
});
