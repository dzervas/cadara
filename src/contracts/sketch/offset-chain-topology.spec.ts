import { describe, expect, test } from "vitest";
import type {
  CertifiedCubicTubeChain,
  CertifiedNeutralCurveQuery,
  CubicTubeChainRequest,
  NeutralCurvePointWitness,
} from "@/contracts/modeling/neutral-curve-query";
import type { SketchEntityId } from "@/contracts/shared/ids";
import {
  certifyOffsetChainTubeStability,
  offsetChainRootEnclosure,
  resolveOffsetChainTopology,
  resolveOffsetChainTopologyJvp,
  type OffsetChainPiece,
  type OffsetChainPieceVariation,
  type OffsetChainTopologyInput,
  type OffsetChainTopologySuccess,
} from "@/contracts/sketch/offset-chain-topology";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import {
  reconstructSpline,
  type SplinePoles,
  type SplineSpan,
} from "@/contracts/sketch/spline-geometry";
import {
  approximateSplineOffset,
  type SplineOffsetCubicSpan,
} from "@/contracts/sketch/spline-offset-geometry";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import {
  createCertifiedNeutralCurveQuery,
  createCertifiedNeutralCurveQueryWithLowerBudgetForTest,
} from "@/domain/modeling/neutral-curve-certification/query";

type Point = readonly [number, number];
const codes = OFFSET_DIAGNOSTIC_CODES;
const query = createCertifiedNeutralCurveQuery();
const ZERO_POLES: SplinePoles = [
  [0, 0],
  [0, 0],
  [0, 0],
  [0, 0],
];
const ARCH: SplinePoles = [
  [0, 0],
  [1, 1],
  [2, 1],
  [3, 0],
];
const id = (name: string) => `sketch_entity_${name}` as SketchEntityId;

/** Shared seam fixture: raw pieces plus (by default) the real certified query. */
function makeOffsetChainFixture(
  pieces: readonly OffsetChainPiece[],
  options: {
    closed?: boolean;
    modelingTolerance?: number;
    query?: CertifiedNeutralCurveQuery;
  } = {},
): OffsetChainTopologyInput {
  return {
    pieces,
    closed: options.closed ?? false,
    modelingTolerance: options.modelingTolerance ?? 1e-3,
    query: options.query ?? query,
  };
}

/** Hand-built adversary span with dyadic poles; real chains use owner output. */
function fabricatedSpan(
  poles: SplinePoles,
  differentialPoles: SplinePoles = ZERO_POLES,
  sourceInterval: readonly [number, number] = [0, 1],
): SplineOffsetCubicSpan {
  return {
    source: {
      splineId: "fabricated",
      spanIndex: 0,
      startPointId: "a",
      endPointId: "b",
      startOccurrenceId: "a-use",
      endOccurrenceId: "b-use",
    },
    sourceInterval,
    sourceLocalInterval: [0, 1],
    poles,
    differential: { sourceInterval: [0, 0], poles: differentialPoles },
    certifiedError: 0,
    // Dummy owner metadata: its derivative box contains 0, so it never certifies.
    reference: {
      derivative: [
        [0, 0],
        [0, 0],
      ],
      sourcePoles: ZERO_POLES,
    },
  };
}

const cubic = (
  name: string,
  spans: readonly SplineOffsetCubicSpan[],
  reversed = false,
): OffsetChainPiece => ({
  kind: "derivedCubic",
  seedEntityId: id(name),
  reversed,
  spans,
});
const line = (
  name: string,
  start: Point,
  end: Point,
  reversed = false,
): OffsetChainPiece => ({
  kind: "lineSegment",
  seedEntityId: id(name),
  reversed,
  start,
  end,
});
const polar = (center: Point, radius: number, angle: number): Point => [
  center[0] + radius * Math.cos(angle),
  center[1] + radius * Math.sin(angle),
];
const arc = (
  name: string,
  center: Point,
  radius: number,
  angles: readonly [number, number],
  sweepDirection: "clockwise" | "counterClockwise",
): OffsetChainPiece => {
  const [low, high] = angles;
  const ccw = sweepDirection === "counterClockwise";
  return {
    kind: "arc",
    seedEntityId: id(name),
    reversed: false,
    center,
    radius,
    start: polar(center, radius, ccw ? low : high),
    end: polar(center, radius, ccw ? high : low),
    sweepDirection,
  };
};

function resolved(input: OffsetChainTopologyInput) {
  const result = resolveOffsetChainTopology(input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function failed(input: OffsetChainTopologyInput) {
  const result = resolveOffsetChainTopology(input);
  if (result.ok) throw new Error("expected the resolver to fail closed");
  return result;
}

const SOURCE_POLES: SplinePoles = [
  [0, 0],
  [1, 0.125],
  [2, 0.125],
  [3, 0],
];
const SOURCE_VARIATION: SplinePoles = [
  [0, 0],
  [0.1, 0.25],
  [-0.2, 0.05],
  [0, 0],
];

/** Real owner output for one source span; this shape emits one output span. */
function ownerSpans(input: {
  distance: number;
  distanceDifferential?: number;
  poles?: SplinePoles;
  poleVariation?: SplinePoles;
  modelingTolerance?: number;
}) {
  const source: SplineSpan = {
    source: {
      splineId: "seed",
      spanIndex: 0,
      startPointId: "p0",
      endPointId: "p1",
      startOccurrenceId: "p0-use",
      endOccurrenceId: "p1-use",
    },
    orientation: "forward",
    interval: [0, 1],
    poles: input.poles ?? SOURCE_POLES,
    validity: "valid",
    differential: {
      interval: [0, 0],
      poles: input.poleVariation ?? ZERO_POLES,
    },
  };
  const result = approximateSplineOffset({
    spans: [source],
    distance: input.distance,
    distanceDifferential: input.distanceDifferential ?? 0,
    modelingTolerance: input.modelingTolerance ?? 1e-3,
  });
  if (!result.ok) throw new Error(result.code);
  return result.spans;
}

/** Real owner chain: vertical line / offset cubic / vertical line (inside corners when distance < 0). */
function ownerLineCubicLine(
  distance: number,
  spans: readonly SplineOffsetCubicSpan[],
  reversedTraversal = false,
) {
  const first = line("first", [-distance, -1], [-distance, 0]);
  const middle = cubic("spline", spans);
  const last = line("last", [3 + distance, 0], [3 + distance, -1]);
  return reversedTraversal
    ? [last, middle, first].map((piece) => ({ ...piece, reversed: true }))
    : [first, middle, last];
}

const bitsOf = (value: number) => {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
};

/** Exact rational value of a finite binary64 (test oracle only). */
function exactDouble(value: number) {
  const raw = bitsOf(value);
  const sign = raw >> 63n ? -1n : 1n;
  const exponent = Number((raw >> 52n) & 0x7ffn);
  const fraction = raw & ((1n << 52n) - 1n);
  const significand = exponent === 0 ? fraction : fraction | (1n << 52n);
  const power = (exponent === 0 ? 1 : exponent) - 1075;
  return power >= 0
    ? { numerator: sign * (significand << BigInt(power)), denominator: 1n }
    : { numerator: sign * significand, denominator: 1n << BigInt(-power) };
}

const finiteLineWitness = (value: number): NeutralCurvePointWitness => ({
  classification: "crossing",
  firstParameter: value,
  secondParameter: value,
  position: [0, 0],
  proof: {
    kind: "exactFiniteLineIntersection",
    firstParameterBounds: [value, value],
    secondParameterBounds: [value, value],
  },
});

const verifiedEmptySelf: CertifiedNeutralCurveQuery["querySelf"] = () => ({
  kind: "verified",
  points: [],
  overlaps: [],
  completenessProof: {
    kind: "completeIsolatedRootSet",
    family: "cubicSelf",
    distinctRootCount: 0,
  },
});

describe("offset chain trim joints", () => {
  test("trims a real owner cubic at both line joints in both traversals, preserving owner poles", () => {
    const distance = -0.25;
    const spans = ownerSpans({ distance });
    expect(spans).toHaveLength(1);
    const ownerBefore = JSON.stringify(spans);
    const forward = resolved(
      makeOffsetChainFixture(ownerLineCubicLine(distance, spans)),
    );
    const backward = resolved(
      makeOffsetChainFixture(ownerLineCubicLine(distance, spans, true)),
    );
    expect(JSON.stringify(spans), "owner spans are immutable").toBe(
      ownerBefore,
    );
    for (const result of [forward, backward]) {
      expect(result.joints).toHaveLength(2);
      const [trimmed] = result.cubics.get(id("spline"))!;
      expect(trimmed!.span, "C2: the owner span passes through").toBe(spans[0]);
      expect(trimmed!.sourceDomain).toEqual([0, 1]);
      expect(trimmed!.start.kind).toBe("joint");
      expect(trimmed!.end.kind).toBe("joint");
      for (const joint of result.joints) {
        expect(joint.witness).toMatchObject({
          classification: "crossing",
          proof: {
            kind: "exactImplicitLineRootSet",
            family: "lineCubic",
            rootMultiplicity: 1,
          },
        });
      }
    }
    const [forwardSpan] = forward.cubics.get(id("spline"))!;
    const [backwardSpan] = backward.cubics.get(id("spline"))!;
    expect(backwardSpan!.representativeQueryDomain).toEqual(
      forwardSpan!.representativeQueryDomain,
    );
    const [low, high] = forwardSpan!.representativeQueryDomain;
    expect(0 < low && low < high && high < 1).toBe(true);
    expect(forward.lineArcEndpoints.get(id("first"))).toMatchObject({
      start: [-distance, -1],
      startDomainEnd: { kind: "source" },
      endDomainEnd: { kind: "joint", jointIndex: 0 },
    });
    expect(forward.lineArcEndpoints.get(id("first"))!.end).toBe(
      forward.joints[0]!.position,
    );
    expect(forward.lineArcEndpoints.get(id("last"))).toMatchObject({
      startDomainEnd: { kind: "joint", jointIndex: 1 },
      end: [3 + distance, -1],
    });
  });

  test("an irrational interior root is trim authority by proof bounds; the numeric end is only a representative", () => {
    const distance = -0.25;
    const result = resolved(
      makeOffsetChainFixture(
        ownerLineCubicLine(distance, ownerSpans({ distance })),
      ),
    );
    const joint = result.joints[0]!;
    const [span] = result.cubics.get(id("spline"))!;
    expect(span!.start).toEqual({ kind: "joint", jointIndex: 0 });
    const bounds = joint.secondParameterBounds;
    expect(bounds[0], "the cubic root is not a binary64 value").toBeLessThan(
      bounds[1],
    );
    expect(bounds).toEqual(joint.witness.proof.secondParameterBounds);
    expect(joint.request.second).toMatchObject({
      kind: "cubicBezier",
      poles: span!.span.poles,
      sourceDomain: span!.sourceDomain,
    });
    expect(joint.request.second).not.toHaveProperty("queryDomain");
    expect(span!.representativeQueryDomain[0]).toBe(joint.secondParameter);
    expect(bounds[0] <= joint.secondParameter).toBe(true);
    expect(joint.secondParameter <= bounds[1]).toBe(true);
  });

  test("trims arc/cubic joints for counter-clockwise and clockwise arcs", () => {
    for (const sweep of ["counterClockwise", "clockwise"] as const) {
      const result = resolved(
        makeOffsetChainFixture([
          cubic("arch", [fabricatedSpan(ARCH)]),
          arc("arc", [3, 1], 0.95, [3, 4], sweep),
        ]),
      );
      expect(result.joints, sweep).toHaveLength(1);
      expect(result.joints[0]!.witness).toMatchObject({
        classification: "crossing",
        proof: {
          kind: "exactAlgebraicCurveRootSet",
          family: "circleCubic",
          rootMultiplicity: 1,
        },
      });
      // The traversal start is trimmed whichever angular side the sweep starts on.
      expect(result.lineArcEndpoints.get(id("arc")), sweep).toMatchObject({
        start: result.joints[0]!.position,
        startDomainEnd: { kind: "joint", jointIndex: 0 },
        endDomainEnd: { kind: "source" },
      });
      const [span] = result.cubics.get(id("arch"))!;
      expect(span!.end).toEqual({ kind: "joint", jointIndex: 0 });
      expect(span!.start).toEqual({ kind: "source" });
    }
  });

  test("trims cubic/cubic joints with a certified tangent determinant in both traversals", () => {
    const first = fabricatedSpan(ARCH);
    const second = fabricatedSpan([
      [2, 1.5],
      [2.25, 0.5],
      [2.5, 0],
      [2.75, -1],
    ]);
    const forward = resolved(
      makeOffsetChainFixture([
        cubic("first", [first]),
        cubic("second", [second]),
      ]),
    );
    const backward = resolved(
      makeOffsetChainFixture([
        cubic("second", [second], true),
        cubic("first", [first], true),
      ]),
    );
    for (const result of [forward, backward]) {
      const proof = result.joints[0]!.witness.proof;
      expect(proof).toMatchObject({
        kind: "exactCubicPairRootSet",
        sourceUnitTangentDeterminantBounds: expect.any(Array),
      });
      expect(result.cubics.get(id("first"))![0]!.end.kind).toBe("joint");
      expect(result.cubics.get(id("second"))![0]!.start.kind).toBe("joint");
    }
    expect(
      backward.cubics.get(id("first"))![0]!.representativeQueryDomain,
    ).toEqual(forward.cubics.get(id("first"))![0]!.representativeQueryDomain);
  });

  test("trims line/line joints inside a spline chain with a one-neighbor rounding enclosure", () => {
    const result = resolved(
      makeOffsetChainFixture([
        line("horizontal", [0, 0], [3, 0]),
        line("vertical", [1, -1], [1, 3]),
        cubic("cap", [
          fabricatedSpan([
            [0, 1.5],
            [1, 2.5],
            [2, 2.5],
            [3, 1.5],
          ]),
        ]),
      ]),
    );
    expect(result.joints.map((joint) => joint.witness.proof.kind)).toEqual([
      "exactFiniteLineIntersection",
      "exactImplicitLineRootSet",
    ]);
    expect(result.joints[0]!.firstParameterBounds).toEqual([
      1 - 2 ** -53,
      1 + 2 ** -52,
    ]);
    expect(result.joints[0]!.witness.proof.firstParameterBounds).toEqual([
      1, 1,
    ]);
  });
});

describe("offset chain joints fail closed", () => {
  const archPiece = cubic("arch", [fabricatedSpan(ARCH)]);
  test.each([
    ["tangent contact", [archPiece, line("l", [1.5, 0.75], [4, 0.75])]],
    [
      "an order-three inflection crossing (multiplicity 3, not transverse)",
      [
        line("l", [-2, 0], [2, 0]),
        cubic("inflection", [
          fabricatedSpan([
            [-1, -1],
            [-1 / 3, 1],
            [1 / 3, -1],
            [1, 1],
          ]),
        ]),
      ],
    ],
    ["two raw witnesses", [archPiece, line("l", [0, 0.5], [3, 0.5])]],
    ["a boundary root", [archPiece, line("l", [3, 0], [3, 2])]],
    [
      "a structural overlap",
      [archPiece, cubic("copy", [fabricatedSpan(ARCH)])],
    ],
    [
      "a finite-line root one ulp inside the raw end (the enclosure never grants interior)",
      [
        line("a", [0, 0], [1, 0]),
        line("b", [1 - 2 ** -53, -1], [1 - 2 ** -53, 1]),
      ],
    ],
  ] as const)("%s is joint-unsatisfied", (_label, pieces) => {
    expect(failed(makeOffsetChainFixture(pieces)).code).toBe(
      codes.jointUnsatisfied,
    );
  });

  test("temporary unsupported: an outside corner needs a fallback arc", () => {
    const distance = 0.25;
    expect(
      failed(
        makeOffsetChainFixture(
          ownerLineCubicLine(distance, ownerSpans({ distance })),
        ),
      ),
    ).toMatchObject({
      code: codes.splineJointUnsupported,
      seedEntityId: id("first"),
    });
  });

  test("temporary unsupported: a closed single-span output joined to itself", () => {
    expect(
      failed(
        makeOffsetChainFixture([cubic("single", [fabricatedSpan(ARCH)])], {
          closed: true,
        }),
      ).code,
    ).toBe(codes.splineJointUnsupported);
  });

  test("budget exhaustion is topology-uncertain with no partial result", () => {
    expect(
      resolveOffsetChainTopology(
        makeOffsetChainFixture([archPiece, line("l", [2.5, 1], [2.5, -1])], {
          query: createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
            operations: 1000,
          }),
        }),
      ),
    ).toEqual({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      seedEntityId: id("arch"),
    });
  });

  test("seam: crossings without a determinant certificate or with unknown native multiplicity are rejected", () => {
    for (const proof of [
      {
        kind: "exactCubicPairRootSet",
        firstParameterBounds: [0.5, 0.5],
        secondParameterBounds: [0.5, 0.5],
      },
      {
        kind: "exactImplicitLineRootSet",
        family: "lineCubic",
        verification: "boundedSignChange",
        firstParameterBounds: [0.5, 0.5],
        secondParameterBounds: [0.5, 0.5],
      },
    ] as const) {
      const fake: CertifiedNeutralCurveQuery = {
        queryPair: () => ({
          kind: "verified",
          points: [
            {
              classification: "crossing",
              firstParameter: 0.5,
              secondParameter: 0.5,
              position: [1.5, 0.75],
              proof,
            },
          ],
          overlaps: [],
          completenessProof: {
            kind: "completeIsolatedRootSet",
            family: "cubicCubic",
            distinctRootCount: 1,
          },
        }),
        querySelf: () => {
          throw new Error("no self query before joint acceptance");
        },
      };
      expect(
        failed(
          makeOffsetChainFixture(
            [archPiece, cubic("other", [fabricatedSpan(ARCH)])],
            { query: fake },
          ),
        ).code,
        proof.kind,
      ).toBe(codes.jointUnsatisfied);
    }
  });
});

describe("offset chain adjacency and global validity", () => {
  const knotted = [
    fabricatedSpan(ARCH),
    fabricatedSpan([
      [3, 0],
      [4, -1],
      [5, -1],
      [6, 0],
    ]),
  ];

  test("a bitwise-shared owner knot is the single declared incidence", () => {
    const result = resolved(makeOffsetChainFixture([cubic("s", knotted)]));
    expect(result.joints).toEqual([]);
    expect(
      result.cubics.get(id("s"))!.map((span) => [span.start, span.end]),
    ).toEqual([
      [{ kind: "source" }, { kind: "source" }],
      [{ kind: "source" }, { kind: "source" }],
    ]);
  });

  test("a smooth closed output declares both bitwise knots on one span pair", () => {
    const lens = [
      fabricatedSpan(ARCH),
      fabricatedSpan([
        [3, 0],
        [2, -1],
        [1, -1],
        [0, 0],
      ]),
    ];
    expect(
      resolved(makeOffsetChainFixture([cubic("lens", lens)], { closed: true }))
        .joints,
    ).toEqual([]);
  });

  test("a non-bitwise owner knot (the recorded pre-Batch-0 values) is topology-uncertain", () => {
    const left: Point = [1.2669335818958114, 1.9637149282107609];
    const right: Point = [1.2669335818958114, 1.963714928210761];
    expect(bitsOf(left[1]) + 1n).toBe(bitsOf(right[1]));
    expect(
      failed(
        makeOffsetChainFixture([
          cubic("s", [
            fabricatedSpan([[0, 0], [0.5, 1], [1, 1.5], left]),
            fabricatedSpan([right, [1.5, 2.5], [2, 2.5], [2.5, 2]]),
          ]),
        ]),
      ),
    ).toMatchObject({ code: codes.topologyUncertain, seedEntityId: id("s") });
  });

  test("an extra crossing between knot-sharing spans cannot be ignored", () => {
    expect(
      failed(
        makeOffsetChainFixture([
          cubic("s", [
            fabricatedSpan([
              [0, 0],
              [1, 0],
              [2, 0],
              [3, 0],
            ]),
            fabricatedSpan([
              [3, 0],
              [4, 1],
              [1, 1],
              [1.5, -1],
            ]),
          ]),
        ]),
      ).code,
    ).toBe(codes.selfIntersection);
  });

  test("seam: a witness at the knot position whose box misses the knot parameters is not the incidence", () => {
    const fake: CertifiedNeutralCurveQuery = {
      queryPair: () => ({
        kind: "verified",
        points: [
          {
            classification: "unclassified",
            firstParameter: 0.5,
            secondParameter: 0.5,
            position: [3, 0],
            proof: {
              kind: "exactCubicPairRootSet",
              firstParameterBounds: [0.5, 0.5],
              secondParameterBounds: [0.5, 0.5],
            },
          },
        ],
        overlaps: [],
        completenessProof: {
          kind: "completeIsolatedRootSet",
          family: "cubicCubic",
          distinctRootCount: 1,
        },
      }),
      querySelf: verifiedEmptySelf,
    };
    expect(
      failed(makeOffsetChainFixture([cubic("s", knotted)], { query: fake }))
        .code,
    ).toBe(codes.topologyUncertain);
  });

  test("non-adjacent crossings are self-intersections within one output and across pieces", () => {
    expect(
      failed(
        makeOffsetChainFixture([
          cubic("s", [
            fabricatedSpan([
              [0, 0],
              [1, 0],
              [2, 0],
              [3, 0],
            ]),
            fabricatedSpan([
              [3, 0],
              [4, 0],
              [4, 1],
              [3, 1],
            ]),
            fabricatedSpan([
              [3, 1],
              [2, 1],
              [1.5, 1],
              [1.5, -1],
            ]),
          ]),
        ]),
      ).code,
    ).toBe(codes.selfIntersection);
    expect(
      failed(
        makeOffsetChainFixture([
          cubic("arch", [fabricatedSpan(ARCH)]),
          line("drop", [2.5, 1], [2.5, -1]),
          line("back", [3, -0.5], [0.5, 2]),
        ]),
      ),
    ).toMatchObject({ code: codes.selfIntersection, seedEntityId: id("arch") });
  });

  test("a crossing proved on the trimmed-away side on one curve is excluded", () => {
    expect(
      resolved(
        makeOffsetChainFixture([
          cubic("arch", [fabricatedSpan(ARCH)]),
          line("drop", [2.5, 1], [2.5, -1]),
          line("away", [2, -0.5], [3.5, 1]),
        ]),
      ).joints,
    ).toHaveLength(2);
  });

  test("a root whose enclosure overlaps a trim root enclosure fails closed", () => {
    // The non-adjacent cubic passes exactly through the horizontal/vertical joint point (1, 0).
    expect(
      failed(
        makeOffsetChainFixture([
          line("horizontal", [0, 0], [3, 0]),
          line("vertical", [1, -1], [1, 3]),
          line("top", [0, 2.5], [3, 2.5]),
          cubic("through", [
            fabricatedSpan([
              [2.5, 3],
              [1.5, 1],
              [0.5, -1],
              [-0.5, -3],
            ]),
          ]),
        ]),
      ),
    ).toMatchObject({
      code: codes.topologyUncertain,
      message: expect.stringContaining("offset trim"),
    });
  });

  test("a cubic self-loop is found by the self query", () => {
    expect(
      failed(
        makeOffsetChainFixture([
          cubic("loop", [
            fabricatedSpan([
              [0, 0],
              [3, 3],
              [-2, 3],
              [1, 0],
            ]),
          ]),
        ]),
      ).code,
    ).toBe(codes.selfIntersection);
  });

  test("the pole-box prefilter skips only strictly disjoint cubic pairs", () => {
    const counted = (first: SplinePoles) => {
      const pairs: string[] = [];
      const counting: CertifiedNeutralCurveQuery = {
        queryPair: (request) => {
          pairs.push(`${request.first.curveId}|${request.second.curveId}`);
          return query.queryPair(request);
        },
        querySelf: (request) => query.querySelf(request),
      };
      resolved(
        makeOffsetChainFixture(
          [
            cubic("s", [
              fabricatedSpan(first),
              fabricatedSpan([
                [1, 0],
                [1.25, 0.25],
                [1.25, 0.75],
                [1, 1],
              ]),
              fabricatedSpan([
                [1, 1],
                [1.25, 1.25],
                [1.75, 1.25],
                [2, 1],
              ]),
            ]),
          ],
          { query: counting },
        ),
      );
      return pairs;
    };
    const s = (index: number) => `${id("s")}:${index}`;
    expect(
      counted([
        [0, 0],
        [0.25, 0.5],
        [0.75, 0.5],
        [1, 0],
      ]),
    ).toEqual([`${s(0)}|${s(1)}`, `${s(1)}|${s(2)}`]);
    expect(
      counted([
        [0, 0],
        [0.25, 1],
        [0.75, 1],
        [1, 0],
      ]),
      "touching boxes are queried",
    ).toContain(`${s(0)}|${s(2)}`);
  });

  /** Real four-span owner output: (0,0),(1,0.1),(2,0), offset 0.2, tolerance 1e-3. */
  const realMultiSpanOwner = () => {
    const geometry = reconstructSpline({
      id: "seed",
      policy: "centripetal-mean-arm-v1",
      closure: "open",
      points: (
        [
          [0, 0],
          [1, 0.1],
          [2, 0],
        ] as const
      ).map((position, index) => ({
        occurrenceId: `o${index}`,
        id: `p${index}`,
        position,
        tangent: { kind: "automatic" as const },
      })),
    });
    if (geometry.validity !== "valid") throw new Error("invalid fixture");
    const owner = approximateSplineOffset({
      spans: geometry.spans,
      distance: 0.2,
      modelingTolerance: 1e-3,
    });
    if (!owner.ok) throw new Error(owner.code);
    return owner.spans;
  };
  const recordingQuery = (inner: CertifiedNeutralCurveQuery) => {
    const outcomes: string[] = [];
    const recorded: CertifiedNeutralCurveQuery = {
      queryPair: (request) => {
        const result = inner.queryPair(request);
        outcomes.push(result.kind);
        return result;
      },
      querySelf: (request) => {
        const result = inner.querySelf(request);
        outcomes.push(result.kind);
        return result;
      },
    };
    return { outcomes, query: recorded };
  };

  test("real multi-span owner output resolves under the unchanged production caps", () => {
    const spans = realMultiSpanOwner();
    expect(spans).toHaveLength(4);
    const { outcomes, query: recorded } = recordingQuery(query);
    const result = resolved(
      makeOffsetChainFixture([cubic("s", spans)], { query: recorded }),
    );
    expect(result.joints).toEqual([]);
    expect(
      result.cubics.get(id("s"))!.map((span) => [span.start, span.end]),
    ).toEqual(spans.map(() => [{ kind: "source" }, { kind: "source" }]));
    expect(outcomes).toHaveLength(7);
    expect(outcomes.every((kind) => kind === "verified")).toBe(true);
  }, 60_000);

  test("real multi-span owner output fails closed when a later query exhausts an injected lower budget", () => {
    // Receipt-backed literal: above the two adjacent pairs 0-1 (3,997,928)
    // and 1-2 (3,700,096) operations, below pair 2-3 (4,412,250).
    const { outcomes, query: recorded } = recordingQuery(
      createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
        operations: 4_200_000,
      }),
    );
    expect(
      resolveOffsetChainTopology(
        makeOffsetChainFixture([cubic("s", realMultiSpanOwner())], {
          query: recorded,
        }),
      ),
    ).toEqual({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      seedEntityId: id("s"),
    });
    expect(outcomes.at(-1)).toBe("uncertain");
    expect(outcomes.slice(0, -1)).toEqual([
      "verified",
      "verified",
      "verified",
      "verified",
    ]);
  }, 60_000);
});

describe("offset chain seam contracts", () => {
  test("forwards the document modeling tolerance unchanged into every request over owner poles", () => {
    for (const modelingTolerance of [1e-3, 2.5e-2]) {
      const distance = -0.25;
      const spans = ownerSpans({ distance, modelingTolerance });
      const seen: { tolerance: number; poles: unknown }[] = [];
      const recording: CertifiedNeutralCurveQuery = {
        queryPair: (request) => {
          for (const curve of [request.first, request.second]) {
            seen.push({
              tolerance: request.modelingTolerance,
              poles: curve.kind === "cubicBezier" ? curve.poles : null,
            });
          }
          return query.queryPair(request);
        },
        querySelf: (request) => {
          seen.push({
            tolerance: request.modelingTolerance,
            poles:
              request.curve.kind === "cubicBezier" ? request.curve.poles : null,
          });
          return query.querySelf(request);
        },
      };
      resolved(
        makeOffsetChainFixture(ownerLineCubicLine(distance, spans), {
          modelingTolerance,
          query: recording,
        }),
      );
      expect(seen.length).toBeGreaterThan(0);
      for (const request of seen) {
        expect(request.tolerance).toBe(modelingTolerance);
        if (request.poles) expect(request.poles).toBe(spans[0]!.poles);
      }
    }
  });

  test("ordinary query exceptions propagate by identity", () => {
    const error = new Error("ordinary failure");
    const throwing: CertifiedNeutralCurveQuery = {
      queryPair: () => {
        throw error;
      },
      querySelf: () => {
        throw error;
      },
    };
    let thrown: unknown;
    try {
      resolveOffsetChainTopology(
        makeOffsetChainFixture(
          [
            cubic("arch", [fabricatedSpan(ARCH)]),
            line("l", [2.5, 1], [2.5, -1]),
          ],
          { query: throwing },
        ),
      );
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
  });

  test("finite-line root enclosures are one binary64 neighbor on each side", () => {
    const step = (value: number, delta: bigint) => {
      const view = new DataView(new ArrayBuffer(8));
      view.setFloat64(0, value);
      view.setBigUint64(0, view.getBigUint64(0) + delta);
      return view.getFloat64(0);
    };
    const cases: [number, readonly [number, number]][] = [
      [1, [1 - 2 ** -53, 1 + 2 ** -52]],
      [-1, [-1 - 2 ** -52, -1 + 2 ** -53]],
      [0, [-Number.MIN_VALUE, Number.MIN_VALUE]],
      [Number.MIN_VALUE, [0, 2 * Number.MIN_VALUE]],
      [-Number.MIN_VALUE, [-2 * Number.MIN_VALUE, -0]],
      [2 ** -1022, [step(2 ** -1022, -1n), step(2 ** -1022, 1n)]],
      [2 ** 52, [2 ** 52 - 0.5, 2 ** 52 + 1]],
    ];
    for (const [value, expected] of cases) {
      expect(
        offsetChainRootEnclosure(finiteLineWitness(value), "first"),
        String(value),
      ).toEqual(expected);
    }
    // The correctly rounded representative of 1/3 is inexact; the enclosure strictly contains 1/3.
    const [lower, upper] = offsetChainRootEnclosure(
      finiteLineWitness(1 / 3),
      "second",
    )!;
    const low = exactDouble(lower);
    const high = exactDouble(upper);
    expect(3n * low.numerator < low.denominator).toBe(true);
    expect(3n * high.numerator > high.denominator).toBe(true);
    expect(
      offsetChainRootEnclosure(finiteLineWitness(Number.MAX_VALUE), "first"),
      "an infinite neighbor fails closed",
    ).toBeNull();
    const algebraic: NeutralCurvePointWitness = {
      ...finiteLineWitness(0.5),
      proof: {
        kind: "exactCubicPairRootSet",
        firstParameterBounds: [0.25, 0.75],
        secondParameterBounds: [0.5, 0.5],
      },
    };
    expect(offsetChainRootEnclosure(algebraic, "first")).toEqual([0.25, 0.75]);
    expect(offsetChainRootEnclosure(algebraic, "second")).toEqual([0.5, 0.5]);
  });
});

describe("offset chain fixed-topology JVP", () => {
  const flatten = (result: OffsetChainTopologySuccess) => [
    ...[...result.cubics.values()].flatMap((spans) =>
      spans.flatMap((span) => span.representativeQueryDomain),
    ),
    ...result.joints.flatMap((joint) => joint.position),
    ...[...result.lineArcEndpoints.values()].flatMap((endpoints) => [
      ...endpoints.start,
      ...endpoints.end,
    ]),
  ];
  /** Independent test-only central finite-difference oracle over re-run primal resolutions. */
  const checkAgainstFiniteDifference = (
    /** Dyadic steps keep perturbed dyadic fixtures inside the unchanged exact budget. */
    h: number,
    build: (epsilon: number) => {
      input: OffsetChainTopologyInput;
      variations: ReadonlyMap<SketchEntityId, OffsetChainPieceVariation>;
    },
  ) => {
    const base = build(0);
    const primal = resolved(base.input);
    const jvp = resolveOffsetChainTopologyJvp(
      base.input,
      primal,
      base.variations,
    );
    if (!jvp.ok) throw new Error(jvp.code);
    const plus = resolved(build(h).input);
    const minus = resolved(build(-h).input);
    const shape = (result: OffsetChainTopologySuccess) =>
      JSON.stringify([
        [...result.cubics.values()].map((spans) =>
          spans.map((span) => [span.start, span.end]),
        ),
        result.joints.length,
      ]);
    expect(shape(plus), "fixed topology").toBe(shape(primal));
    expect(shape(minus), "fixed topology").toBe(shape(primal));
    const predicted = [
      ...[...jvp.representativeQueryDomains.values()].flatMap((domains) =>
        domains.flat(),
      ),
      ...jvp.jointPositions.flat(),
      ...[...jvp.lineArcEndpoints.values()].flatMap((endpoints) => [
        ...endpoints.start,
        ...endpoints.end,
      ]),
    ];
    const upper = flatten(plus);
    const lower = flatten(minus);
    expect(predicted).toHaveLength(upper.length);
    predicted.forEach((value, index) => {
      const measured = (upper[index]! - lower[index]!) / (2 * h);
      expect(
        Math.abs(value - measured),
        `component ${index}: ${value} vs ${measured}`,
      ).toBeLessThanOrEqual(1e-5 * Math.max(1, Math.abs(measured)));
    });
  };
  const moved = (poles: SplinePoles, variation: SplinePoles, e: number) =>
    poles.map((pole, index) => [
      pole[0] + e * variation[index]![0],
      pole[1] + e * variation[index]![1],
    ]) as unknown as SplinePoles;

  test("line/cubic trims agree with the oracle under distance and source-point variation", () => {
    checkAgainstFiniteDifference(2 ** -20, (epsilon) => {
      const distance = -0.25 + epsilon;
      const spans = ownerSpans({
        distance,
        distanceDifferential: 1,
        poles: moved(SOURCE_POLES, SOURCE_VARIATION, epsilon),
        poleVariation: SOURCE_VARIATION,
      });
      expect(spans).toHaveLength(1);
      return {
        input: makeOffsetChainFixture(ownerLineCubicLine(distance, spans)),
        variations: new Map<SketchEntityId, OffsetChainPieceVariation>([
          [id("first"), { kind: "lineSegment", start: [-1, 0], end: [-1, 0] }],
          [id("last"), { kind: "lineSegment", start: [1, 0], end: [1, 0] }],
        ]),
      };
    });
  });

  test("arc/cubic and cubic/cubic trims agree with the oracle", () => {
    const archVariation: SplinePoles = [
      [0, 0.125],
      [0.25, -0.375],
      [0, 0.5],
      [0.125, 0],
    ];
    checkAgainstFiniteDifference(2 ** -20, (epsilon) => {
      const center: Point = [3 + 0.25 * epsilon, 1 - 0.125 * epsilon];
      const radius = 0.95 + 0.5 * epsilon;
      return {
        input: makeOffsetChainFixture([
          cubic("arch", [
            fabricatedSpan(moved(ARCH, archVariation, epsilon), archVariation),
          ]),
          arc("arc", center, radius, [3, 4], "counterClockwise"),
        ]),
        variations: new Map<SketchEntityId, OffsetChainPieceVariation>([
          [
            id("arc"),
            {
              kind: "arc",
              center: [0.25, -0.125],
              radius: 0.5,
              start: [0.25 + 0.5 * Math.cos(3), -0.125 + 0.5 * Math.sin(3)],
              end: [0.25 + 0.5 * Math.cos(4), -0.125 + 0.5 * Math.sin(4)],
            },
          ],
        ]),
      };
    });
    const secondPoles: SplinePoles = [
      [2, 1.5],
      [2.25, 0.5],
      [2.5, 0],
      [2.75, -1],
    ];
    // Before the polynomial budget repair, generic simultaneous pole variations
    // exhausted the budget. This bounded fixture retains one moving pole and a translation.
    const firstVariation: SplinePoles = [
      [0, 0],
      [0, 1],
      [0, 0],
      [0, 0],
    ];
    const secondVariation: SplinePoles = [
      [1, 0],
      [1, 0],
      [1, 0],
      [1, 0],
    ];
    checkAgainstFiniteDifference(2 ** -20, (epsilon) => ({
      input: makeOffsetChainFixture([
        cubic("first", [
          fabricatedSpan(moved(ARCH, firstVariation, epsilon), firstVariation),
        ]),
        cubic("second", [
          fabricatedSpan(
            moved(secondPoles, secondVariation, epsilon),
            secondVariation,
          ),
        ]),
      ]),
      variations: new Map(),
    }));
  });

  test("untrimmed cubic domain ends carry the owner's source-interval differential", () => {
    const span: SplineOffsetCubicSpan = {
      ...fabricatedSpan(ARCH),
      differential: { sourceInterval: [0.25, -0.5], poles: ZERO_POLES },
    };
    const input = makeOffsetChainFixture([cubic("s", [span])]);
    const jvp = resolveOffsetChainTopologyJvp(
      input,
      resolved(input),
      new Map(),
    );
    expect(jvp).toMatchObject({ ok: true });
    if (!jvp.ok) return;
    expect(jvp.representativeQueryDomains.get(id("s"))).toEqual([[0.25, -0.5]]);
  });

  test("real certifier: a subnormal tangent determinant is rejected by the primal", () => {
    const m = Number.MIN_VALUE;
    const input = makeOffsetChainFixture([
      line("line", [-1, 0], [4, 0]),
      cubic("subnormal", [
        fabricatedSpan(
          [
            [0, -m],
            [1, -m],
            [2, m],
            [3, m],
          ],
          ZERO_POLES,
          [0, 2 ** 20],
        ),
      ]),
    ]);
    expect(resolveOffsetChainTopology(input)).toMatchObject({
      ok: false,
      code: codes.derivativeUnavailable,
      seedEntityId: id("line"),
    });
  });

  test("seam: a fake singular joint is rejected by the primal", () => {
    const parallel: CertifiedNeutralCurveQuery = {
      queryPair: () => ({
        kind: "verified",
        points: [
          {
            classification: "crossing",
            firstParameter: 1,
            secondParameter: 1,
            position: [1, 0],
            proof: {
              kind: "exactFiniteLineIntersection",
              firstParameterBounds: [1, 1],
              secondParameterBounds: [1, 1],
            },
          },
        ],
        overlaps: [],
        completenessProof: {
          kind: "completeIsolatedRootSet",
          family: "finiteLinePair",
          distinctRootCount: 1,
        },
      }),
      querySelf: verifiedEmptySelf,
    };
    const input = makeOffsetChainFixture(
      [line("a", [0, 0], [2, 0]), line("b", [0, 1], [2, 1])],
      { query: parallel },
    );
    expect(resolveOffsetChainTopology(input)).toMatchObject({
      ok: false,
      code: codes.derivativeUnavailable,
      seedEntityId: id("a"),
    });
  });

  test("the JVP only differentiates the accepted resolution of the same input", () => {
    const distance = -0.25;
    const spans = ownerSpans({ distance });
    const input = makeOffsetChainFixture(ownerLineCubicLine(distance, spans));
    const other = makeOffsetChainFixture(ownerLineCubicLine(distance, spans));
    expect(() =>
      resolveOffsetChainTopologyJvp(other, resolved(input), new Map()),
    ).toThrow(RangeError);
  });
});

describe("offset chain tube-stability mapping (bounded helper, not live)", () => {
  const tubeCertifier = createCertifiedCubicTubeChain();
  const ownerChain = (
    points: readonly Point[],
    distance: number,
    closure: "open" | "smooth" = "open",
  ) => {
    const geometry = reconstructSpline({
      id: "seed",
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
    const owner = approximateSplineOffset({
      spans: geometry.spans,
      distance,
      modelingTolerance: 1e-3,
    });
    if (!owner.ok) throw new Error(owner.code);
    return owner.spans;
  };
  const F1_POINTS: readonly Point[] = [
    [0, 0],
    [1, 0.1],
    [2, 0],
  ];
  /**
   * Mapping-seam fake only, never topology evidence: reports exactly the
   * bitwise-shared knot of each owner span pair as its single root so the
   * resolver accepts untrimmed owner chains without the slow exact queries.
   */
  const knotOnlyQuery: CertifiedNeutralCurveQuery = {
    queryPair: ({ first, second }) => {
      if (first.kind !== "cubicBezier" || second.kind !== "cubicBezier") {
        throw new Error("knot-only fake admits owner cubics only");
      }
      const at = samePointForTest(first.poles[3], second.poles[0])
        ? ([first.sourceDomain[1], second.sourceDomain[0]] as const)
        : samePointForTest(second.poles[3], first.poles[0])
          ? ([first.sourceDomain[0], second.sourceDomain[1]] as const)
          : null;
      return {
        kind: "verified",
        points: at
          ? [
              {
                classification: "unclassified",
                firstParameter: at[0],
                secondParameter: at[1],
                position: first.poles[at[0] === first.sourceDomain[1] ? 3 : 0],
                proof: {
                  kind: "exactCubicPairRootSet",
                  firstParameterBounds: [at[0], at[0]],
                  secondParameterBounds: [at[1], at[1]],
                },
              },
            ]
          : [],
        overlaps: [],
        completenessProof: {
          kind: "completeIsolatedRootSet",
          family: "cubicCubic",
          distinctRootCount: at ? 1 : 0,
        },
      };
    },
    querySelf: verifiedEmptySelf,
  };
  const recordingCertifier = () => {
    const requests: CubicTubeChainRequest[] = [];
    const certifier: CertifiedCubicTubeChain = {
      certifyChain: (request) => {
        requests.push(request);
        return tubeCertifier.certifyChain(request);
      },
    };
    return { requests, certifier };
  };
  const refusingCertifier: CertifiedCubicTubeChain = {
    certifyChain: () => {
      throw new Error("out-of-scope chains never reach the certifier");
    },
  };

  test("real F1 resolution and real certifier: ok for the same resolution", () => {
    const spans = ownerChain(F1_POINTS, 0.2);
    const input = makeOffsetChainFixture([cubic("s", spans)]);
    const accepted = resolved(input);
    const result = certifyOffsetChainTubeStability(accepted, tubeCertifier);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.resolved).toBe(accepted);
    expect(result.seedEntityId).toBe(id("s"));
    expect(result.certificate.joins.map((join) => join.kind)).toEqual([
      "same-leaf",
      "parallel-knot",
      "same-leaf",
    ]);
  }, 60_000);

  test("forwards owner spans, errors, metadata and the tolerance unchanged in natural order for both traversals", () => {
    const spans = ownerChain(F1_POINTS, 0.2);
    for (const reversed of [false, true]) {
      for (const modelingTolerance of [1e-3, 2.5e-2]) {
        const { requests, certifier } = recordingCertifier();
        const accepted = resolved(
          makeOffsetChainFixture([cubic("s", spans, reversed)], {
            modelingTolerance,
            query: knotOnlyQuery,
          }),
        );
        expect(certifyOffsetChainTubeStability(accepted, certifier).ok).toBe(
          true,
        );
        expect(requests).toHaveLength(1);
        const [request] = requests;
        expect(request!.modelingTolerance).toBe(modelingTolerance);
        expect(request!.closed).toBe(false);
        expect(request!.tubes).toHaveLength(spans.length);
        request!.tubes.forEach((tube, index) => {
          expect(tube.poles, "never reversed").toBe(spans[index]!.poles);
          expect(tube.reference).toBe(spans[index]!.reference);
          expect(tube.certifiedError).toBe(spans[index]!.certifiedError);
          expect(tube.sourceLocalInterval).toBe(
            spans[index]!.sourceLocalInterval,
          );
          expect(tube.source).toBe(spans[index]!.source);
        });
      }
    }
  });

  test("the real closed 40-span diamond maps to a verified closed chain", () => {
    const spans = ownerChain(
      [
        [1, 0],
        [0, 1],
        [-1, 0],
        [0, -1],
      ],
      0.1,
      "smooth",
    );
    const result = certifyOffsetChainTubeStability(
      resolved(
        makeOffsetChainFixture([cubic("diamond", spans)], {
          closed: true,
          query: knotOnlyQuery,
        }),
      ),
      tubeCertifier,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(result.certificate.joins).toHaveLength(40);
    expect(result.certificate.joins.at(-1)).toMatchObject({
      first: 39,
      second: 0,
      kind: "parallel-knot",
    });
  });

  test("trimmed or multi-piece chains and the closed two-span lens are unsupported", () => {
    const distance = -0.25;
    expect(
      certifyOffsetChainTubeStability(
        resolved(
          makeOffsetChainFixture(
            ownerLineCubicLine(distance, ownerSpans({ distance })),
          ),
        ),
        refusingCertifier,
      ),
    ).toMatchObject({
      ok: false,
      code: codes.topologyStabilityUnsupported,
      seedEntityId: id("first"),
    });
    const lens = [
      fabricatedSpan(ARCH),
      fabricatedSpan([
        [3, 0],
        [2, -1],
        [1, -1],
        [0, 0],
      ]),
    ];
    expect(
      certifyOffsetChainTubeStability(
        resolved(
          makeOffsetChainFixture([cubic("lens", lens)], { closed: true }),
        ),
        tubeCertifier,
      ),
    ).toMatchObject({
      ok: false,
      code: codes.topologyStabilityUnsupported,
      seedEntityId: id("lens"),
    });
  });

  test("certifier outcomes map to clearance, knot-incidence and topology-uncertain codes", () => {
    const accepted = resolved(
      makeOffsetChainFixture([cubic("s", ownerChain(F1_POINTS, 0.2))], {
        query: knotOnlyQuery,
      }),
    );
    const answering = (
      code: string,
      kind: "uncertain" | "unsupported" = "uncertain",
    ): CertifiedCubicTubeChain => ({
      certifyChain: () => ({ kind, code, message: "m", first: 0, second: 2 }),
    });
    for (const [code, kind, expected] of [
      [
        "cubic-tube-clearance-unproven",
        "uncertain",
        codes.topologyClearanceUnproven,
      ],
      [
        "cubic-tube-knot-incidence-unproven",
        "uncertain",
        codes.knotIncidenceUnproven,
      ],
      [
        "exact-query-proof-budget-exhausted",
        "uncertain",
        codes.topologyUncertain,
      ],
      ["cubic-tube-cone-unproven", "uncertain", codes.topologyUncertain],
      [
        "cubic-tube-chain-closed-too-short",
        "unsupported",
        codes.topologyStabilityUnsupported,
      ],
    ] as const) {
      expect(
        certifyOffsetChainTubeStability(accepted, answering(code, kind)),
      ).toEqual({
        ok: false,
        code: expected,
        message: expect.stringContaining(`${code}: m`),
        seedEntityId: id("s"),
      });
    }
    const asymmetric = resolved(
      makeOffsetChainFixture(
        [
          cubic(
            "s",
            ownerChain(
              [
                [0, 0],
                [1, 0.1],
                [2.5, 0],
              ],
              0.2,
            ),
          ),
        ],
        { query: knotOnlyQuery },
      ),
    );
    expect(
      certifyOffsetChainTubeStability(asymmetric, tubeCertifier),
    ).toMatchObject({ ok: false, code: codes.knotIncidenceUnproven });
  });

  test("certifier exceptions propagate by identity", () => {
    const error = new Error("ordinary failure");
    const accepted = resolved(
      makeOffsetChainFixture([cubic("s", ownerChain(F1_POINTS, 0.2))], {
        query: knotOnlyQuery,
      }),
    );
    let thrown: unknown;
    try {
      certifyOffsetChainTubeStability(accepted, {
        certifyChain: () => {
          throw error;
        },
      });
    } catch (caught) {
      thrown = caught;
    }
    expect(thrown).toBe(error);
  });
});

function samePointForTest(first: Point, second: Point) {
  return Object.is(first[0], second[0]) && Object.is(first[1], second[1]);
}
