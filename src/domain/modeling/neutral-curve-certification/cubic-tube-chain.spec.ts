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
import type { ExactProofBudgetSnapshot } from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

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
function knotChain(outgoing: SplineVector) {
  const incoming: SplinePoles = [
    [-1, 0],
    [-0.75, 0],
    [-0.25, 0],
    [0, 0],
  ];
  const next: SplinePoles = [[0, 0], outgoing, [0.75, 0], [1, 0]];
  return [
    makeTube(straight(-1, 0), {
      sourcePoles: incoming,
      spanIndex: 0,
      startOccurrenceId: "o0",
      endOccurrenceId: "o1",
    }),
    makeTube(straight(0, 1), {
      sourcePoles: next,
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

  test.each([
    [
      "asymmetric F1",
      [
        [0, 0],
        [1, 0.1],
        [2.5, 0],
      ],
      0.2,
      [2, 3],
    ],
    [
      "generic three-point",
      [
        [0, 0],
        [1.3, 0.7],
        [2.1, -0.2],
      ],
      0.15,
      [6, 7],
    ],
    [
      "hook",
      [
        [0, 0],
        [2, 0],
        [2, 2],
        [0, 2],
        [0, 0.192344812476102],
      ],
      0.2,
      [8, 9],
    ],
  ] as const)(
    "real %s output is rejected at its non-parallel source knot",
    (_label, points, distance, [first, second]) => {
      expect(
        certifier.certifyChain(request(ownerTubes(points, distance))),
      ).toMatchObject({
        kind: "uncertain",
        code: "cubic-tube-knot-incidence-unproven",
        first,
        second,
      });
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

  test("an exactly parallel knot verifies; one ulp off the tangent line or antiparallel is unproven", () => {
    expect(
      verified(certifier.certifyChain(request(knotChain([0.25, 0])))).joins[0]!
        .kind,
    ).toBe("parallel-knot");
    for (const outgoing of [
      [0.25, 2 ** -54], // one ulp of 0.25, off the incoming tangent line
      [0.25, Number.MIN_VALUE],
      [-0.25, 0], // exactly antiparallel: cross 0, dot < 0
    ] as const) {
      expect(
        certifier.certifyChain(request(knotChain(outgoing))),
      ).toMatchObject({
        kind: "uncertain",
        code: "cubic-tube-knot-incidence-unproven",
        first: 0,
        second: 1,
      });
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

  test("a metadata-valid small corner (not owner-reachable) is never admitted without exact incidence", () => {
    // Review §1.2: straight source spans turn by θ = 0.005 at the origin;
    // offset 0.2 on the concave side. The one-sided true offsets cross, while
    // E only shares the midpoint pole within ε ≤ τ.
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
        derivative: box(t1),
        sourcePoles: line([-t1[0], -t1[1]], [0, 0]),
        spanIndex: 0,
        startOccurrenceId: "o0",
        endOccurrenceId: "o1",
      }),
      makeTube(line(shared, [b[0] + t2[0], b[1] + t2[1]]), {
        certifiedError: 5.0001e-4,
        derivative: box(t2),
        sourcePoles: line([0, 0], t2),
        spanIndex: 1,
        startOccurrenceId: "o1",
        endOccurrenceId: "o2",
      }),
    ];
    expect(certifier.certifyChain(request(chain))).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-knot-incidence-unproven",
      first: 0,
      second: 1,
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

describe("cubic tube chain: one shared proof budget per request", () => {
  // Receipt-backed literals for F1: admission, conversion, 3 joins and 3 pairs
  // under one meter. Pinned, not re-measured, so a per-pair or reset meter
  // (which would measure less) cannot recalibrate its own boundary.
  const F1_METER = { operations: 32_459, euclideanSteps: 8_094 } as const;

  test("F1 consumes the receipt-pinned whole-request meter", () => {
    let snapshot: ExactProofBudgetSnapshot | undefined;
    verified(
      createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
        snapshot = value;
      }).certifyChain(request(ownerTubes(F1, 0.2))),
    );
    expect(snapshot).toMatchObject({ ...F1_METER, refinementSteps: 0 });
  });

  test.each(["operations", "euclideanSteps"] as const)(
    "the exact %s count passes and count − 1 exhausts the whole request with no partial certificate",
    (meter) => {
      const total = F1_METER[meter];
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [meter]: total,
        }).certifyChain(request(ownerTubes(F1, 0.2))).kind,
      ).toBe("verified");
      // Every join and pair alone costs less than count − 1; only one unreset
      // meter across the whole request can exhaust here.
      expect(
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          [meter]: total - 1,
        }).certifyChain(request(ownerTubes(F1, 0.2))),
      ).toEqual({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
        message:
          "The deterministic exact-query arithmetic budget was exhausted.",
      });
    },
  );

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
