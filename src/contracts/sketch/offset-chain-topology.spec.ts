import { describe, expect, test, vi } from "vitest";

/** Pass-through call-order recorder on the adapter's exported spline seams. */
const splineSeamCalls = vi.hoisted(() => ({ log: null as string[] | null }));
vi.mock("@/contracts/sketch/spline-geometry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/contracts/sketch/spline-geometry")>();
  return {
    ...actual,
    reconstructSplineAggregate: ((...args) => {
      splineSeamCalls.log?.push("reconstruct");
      return actual.reconstructSplineAggregate(...args);
    }) as typeof actual.reconstructSplineAggregate,
  };
});
vi.mock("@/contracts/sketch/spline-offset-geometry", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/contracts/sketch/spline-offset-geometry")
    >();
  return {
    ...actual,
    approximateSplineOffset: ((...args) => {
      splineSeamCalls.log?.push("owner");
      return actual.approximateSplineOffset(...args);
    }) as typeof actual.approximateSplineOffset,
  };
});
import {
  evaluateNeutralCurve,
  type CertifiedCubicTubeChain,
  type CertifiedNeutralCurveQuery,
  type CertifiedTubePieceChain,
  type CubicTubeChainRequest,
  type EndpointNeutralSegment,
  type NeutralCurvePointWitness,
  type PieceTubeChainRequest,
} from "@/contracts/modeling/neutral-curve-query";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  SketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import type { SketchToolCommitContribution } from "@/core/sketch-tools/definition";
import type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";
import {
  getSketchConstraintDefinition,
  resolveSketchConstraintTarget,
} from "@/core/sketch-constraints/registry";
import { solveCommittedConstraintDefinition } from "@/domain/editor/sketch-session/constraints";
import { applySolvedSketchToDefinition } from "@/domain/editor/sketch-session/definition-patches";
import { lineSketchToolDefinition } from "@/core/sketch-tools/tools/line";
import { splineSketchToolDefinition } from "@/core/sketch-tools/tools/spline";
import { appendInferredSnapConstraints } from "@/domain/editor/sketch-session/tools";
import {
  createSessionCommitFactories,
  createSketchPointRef,
  SKETCH_DIRECT_EDIT_TOLERANCES,
} from "@/domain/editor/sketch-session/internals";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  certifyOffsetChainTubeStability,
  declaredOffsetChainPieces,
  offsetChainRootEnclosure,
  resolveOffsetChainTopology,
  resolveOffsetChainTopologyJvp,
  type DeclaredOffsetChainPieces,
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
      distance: 0,
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
    // Segment parameter: the exact root x = 1 on [0, 0] -> [3, 0] is t = 1/3.
    expect(result.joints[0]!.witness.proof.firstParameterBounds).toEqual([
      1 / 3,
      1 / 3,
    ]);
    const enclosure = result.joints[0]!.firstParameterBounds;
    expect(enclosure).toEqual([1 / 3 - 2 ** -54, 1 / 3 + 2 ** -54]);
    const low = exactDouble(enclosure[0]);
    const high = exactDouble(enclosure[1]);
    expect(3n * low.numerator < low.denominator).toBe(true);
    expect(3n * high.numerator > high.denominator).toBe(true);
  });
});

describe("offset chain line pieces are exact endpoint segments", () => {
  const bitwise = (actual: Point, expected: Point) =>
    Object.is(actual[0], expected[0]) && Object.is(actual[1], expected[1]);
  const recordingSegments = () => {
    const segments: EndpointNeutralSegment[] = [];
    const recorded: CertifiedNeutralCurveQuery = {
      queryPair: (request) => {
        for (const curve of [request.first, request.second]) {
          if (curve.kind === "line" && curve.form === "endpointSegment") {
            segments.push(curve);
          }
        }
        return query.queryPair(request);
      },
      querySelf: (request) => query.querySelf(request),
    };
    return { segments, query: recorded };
  };

  test("the four plan-probe segments reach the resolver with their displayed ends as bitwise query endpoints", () => {
    const receipt: readonly (readonly [Point, Point])[] = [
      [
        [0.1, 0.2],
        [1.3, 0.7],
      ],
      [
        [-1, 0.2],
        [0, 0.2],
      ],
      [
        [0, 0],
        [1, 1e-9],
      ],
      [
        [0.3, 0.1],
        [2.1, -0.2],
      ],
    ];
    receipt.forEach(([start, end], index) => {
      // Receipt: the former numeric support end is not bitwise the displayed end for the fourth segment.
      const dx = end[0] - start[0];
      const dy = end[1] - start[1];
      const length = Math.hypot(dx, dy);
      const numericEnd: Point = [
        start[0] + (dx / length) * length,
        start[1] + (dy / length) * length,
      ];
      expect(bitwise(numericEnd, end), `receipt ${index}`).toBe(index !== 3);
      const middle: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
      const across = line(
        "across",
        [middle[0] - dy, middle[1] + dx],
        [middle[0] + dy, middle[1] - dx],
      );
      const probe = line("probe", start, end);
      for (const pieces of [
        [probe, across],
        [
          { ...across, reversed: true },
          { ...probe, reversed: true },
        ],
      ]) {
        const { segments, query: recorded } = recordingSegments();
        const result = resolved(
          makeOffsetChainFixture(pieces, { query: recorded }),
        );
        expect(result.joints, `segment ${index}`).toHaveLength(1);
        const submitted = segments.filter(
          (curve) => curve.provenance.sourceEntityId === id("probe"),
        );
        expect(submitted.length, `segment ${index}`).toBeGreaterThan(0);
        for (const curve of submitted) {
          expect(curve.sourceDomain).toEqual([0, 1]);
          expect(bitwise(curve.start, start), `segment ${index}`).toBe(true);
          expect(bitwise(curve.end, end), `segment ${index}`).toBe(true);
          expect(bitwise(evaluateNeutralCurve(curve, 0), start)).toBe(true);
          expect(bitwise(evaluateNeutralCurve(curve, 1), end)).toBe(true);
        }
        const joint = result.joints[0]!;
        const probeIsFirst = joint.firstSeedEntityId === id("probe");
        const parameter = probeIsFirst
          ? joint.firstParameter
          : joint.secondParameter;
        expect(0 < parameter && parameter < 1, `segment ${index}`).toBe(true);
        const endpoints = result.lineArcEndpoints.get(id("probe"))!;
        expect(endpoints.startDomainEnd).toEqual({ kind: "source" });
        expect(bitwise(endpoints.start, start), `segment ${index}`).toBe(true);
        expect(endpoints.end).toBe(joint.position);
      }
    });
  });

  test("line/line and line/cubic trims agree in both traversal directions on the segment parameter", () => {
    const cap = cubic("cap", [
      fabricatedSpan([
        [0, 1.5],
        [1, 2.5],
        [2, 2.5],
        [3, 1.5],
      ]),
    ]);
    const horizontal = line("horizontal", [0, 0], [3, 0]);
    const vertical = line("vertical", [1, -1], [1, 3]);
    const forward = resolved(
      makeOffsetChainFixture([horizontal, vertical, cap]),
    );
    const backward = resolved(
      makeOffsetChainFixture(
        [cap, vertical, horizontal].map((piece) => ({
          ...piece,
          reversed: true,
        })),
      ),
    );
    for (const result of [forward, backward]) {
      expect(result.joints).toHaveLength(2);
      const lineLine = result.joints.find(
        (joint) => joint.witness.proof.kind === "exactFiniteLineIntersection",
      )!;
      expect(bitwise(lineLine.position, [1, 0])).toBe(true);
      const onHorizontal =
        lineLine.firstSeedEntityId === id("horizontal") ? "first" : "second";
      const onVertical = onHorizontal === "first" ? "second" : "first";
      expect(lineLine.witness.proof[`${onHorizontal}ParameterBounds`]).toEqual([
        1 / 3,
        1 / 3,
      ]);
      expect(lineLine.witness.proof[`${onVertical}ParameterBounds`]).toEqual([
        0.25, 0.25,
      ]);
      for (const curve of [lineLine.request.first, lineLine.request.second]) {
        expect(curve).toMatchObject({
          kind: "line",
          form: "endpointSegment",
          sourceDomain: [0, 1],
        });
      }
      const lineCubic = result.joints.find(
        (joint) => joint.witness.proof.kind === "exactImplicitLineRootSet",
      )!;
      const verticalParameter =
        lineCubic.firstSeedEntityId === id("vertical")
          ? lineCubic.firstParameter
          : lineCubic.secondParameter;
      expect(0.75 < verticalParameter && verticalParameter < 1).toBe(true);
    }
    for (const seed of ["horizontal", "vertical"]) {
      const a = forward.lineArcEndpoints.get(id(seed))!;
      const b = backward.lineArcEndpoints.get(id(seed))!;
      expect(bitwise(a.start, b.start), seed).toBe(true);
      expect(bitwise(a.end, b.end), seed).toBe(true);
      expect([a.startDomainEnd.kind, a.endDomainEnd.kind]).toEqual([
        b.startDomainEnd.kind,
        b.endDomainEnd.kind,
      ]);
    }
    const horizontalEnds = forward.lineArcEndpoints.get(id("horizontal"))!;
    expect(bitwise(horizontalEnds.start, [0, 0])).toBe(true);
    expect(bitwise(horizontalEnds.end, [1, 0])).toBe(true);
    expect(
      backward.cubics.get(id("cap"))![0]!.representativeQueryDomain,
    ).toEqual(forward.cubics.get(id("cap"))![0]!.representativeQueryDomain);
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

  test("line/line and line/cubic trims agree with the oracle under independent segment endpoint variation", () => {
    const horizontalVariation = {
      start: [0.5, 0.25],
      end: [-0.25, 1],
    } as const;
    const verticalVariation = {
      start: [0.125, -0.5],
      end: [0.75, 0.25],
    } as const;
    const shift = (point: Point, variation: Point, e: number): Point => [
      point[0] + e * variation[0],
      point[1] + e * variation[1],
    ];
    const cap = cubic("cap", [
      fabricatedSpan([
        [0, 1.5],
        [1, 2.5],
        [2, 2.5],
        [3, 1.5],
      ]),
    ]);
    for (const reversedTraversal of [false, true]) {
      checkAgainstFiniteDifference(2 ** -20, (epsilon) => {
        const horizontal = line(
          "horizontal",
          shift([0, 0], horizontalVariation.start, epsilon),
          shift([3, 0], horizontalVariation.end, epsilon),
        );
        const vertical = line(
          "vertical",
          shift([1, -1], verticalVariation.start, epsilon),
          shift([1, 3], verticalVariation.end, epsilon),
        );
        const pieces = reversedTraversal
          ? [cap, vertical, horizontal].map((piece) => ({
              ...piece,
              reversed: true,
            }))
          : [horizontal, vertical, cap];
        return {
          input: makeOffsetChainFixture(pieces),
          variations: new Map<SketchEntityId, OffsetChainPieceVariation>([
            [id("horizontal"), { kind: "lineSegment", ...horizontalVariation }],
            [id("vertical"), { kind: "lineSegment", ...verticalVariation }],
          ]),
        };
      });
    }
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
            // Interior segment parameter, so the primal reaches the determinant.
            firstParameter: 0.5,
            secondParameter: 0.5,
            position: [1, 0],
            proof: {
              kind: "exactFiniteLineIntersection",
              firstParameterBounds: [0.5, 0.5],
              secondParameterBounds: [0.5, 0.5],
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
    // Formerly knot-incidence-unproven; J2′ now certifies its concave knot.
    const certified = certifyOffsetChainTubeStability(
      asymmetric,
      tubeCertifier,
    );
    if (!certified.ok)
      throw new Error(`${certified.code}: ${certified.message}`);
    expect(certified.certificate.joins[2]).toMatchObject({
      first: 2,
      second: 3,
      kind: "nonparallel-knot",
      side: "concave",
    });
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

describe("declared multi-piece tube stability (L1b, bounded helper, not live)", () => {
  const TOLERANCE = 1e-3;
  const pieceCertifier = createCertifiedCubicTubeChain();
  type Vector = readonly [number, number];
  type Authored = SketchToolCommitContribution;
  let sequence = 0;
  const factory = createSessionCommitFactories(1, "sketch_l1b" as never);
  /** Full authored definition of native commit contributions. */
  const sketch = (patches: readonly Authored[]): SketchDefinition => {
    const points = patches.flatMap((patch) => patch.points);
    const entities = patches.flatMap((patch) => patch.entities);
    const constraints = patches.flatMap((patch) => patch.constraints ?? []);
    return {
      schemaVersion: "sketch-definition/v1alpha1",
      referenceIds: [],
      references: [],
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((constraint) => constraint.constraintId),
      constraints,
      dimensionIds: [],
      dimensions: [],
    } as SketchDefinition;
  };
  const endpointSnap = (pointId: SketchPointId, point: Vector) => ({
    key: `endpoint:${pointId}`,
    kind: "endpoint" as const,
    point,
    rawPointer: point,
    distance: 0,
    priority: 0,
    sources: [{ kind: "localPoint" as const, pointId }],
    preview: { label: "endpoint", glyph: "endpoint" as const },
  });
  /** Native tool commit plus the session's endpoint-snap inference. */
  const author = (
    previous: readonly Authored[],
    activeTool: "line" | "spline",
    patch: Authored,
    start: Vector,
    end: Vector,
    snaps: { start?: SketchPointId; end?: SketchPointId } = {},
  ) =>
    appendInferredSnapConstraints({
      previousDefinition: sketch(previous),
      patch,
      activeTool,
      startSnap: snaps.start ? endpointSnap(snaps.start, start) : null,
      endSnap: snaps.end ? endpointSnap(snaps.end, end) : null,
      sequence,
      createConstraintId: (name: string) => `constraint_${name}` as never,
    });
  const drawLine = (
    previous: readonly Authored[],
    start: Vector,
    end: Vector,
    snaps: { start?: SketchPointId; end?: SketchPointId } = {},
  ) => {
    sequence += 1;
    return author(
      previous,
      "line",
      lineSketchToolDefinition.createCommitContribution({
        sequence,
        start,
        end,
        isConstruction: false,
        factories: factory,
      }),
      start,
      end,
      snaps,
    );
  };
  const drawSpline = (
    previous: readonly Authored[],
    points: readonly Vector[],
    snaps: { start?: SketchPointId } = {},
  ) => {
    sequence += 1;
    return author(
      previous,
      "spline",
      splineSketchToolDefinition.createCommitContribution({
        sequence,
        start: points[0]!,
        end: points.at(-1)!,
        points: points as [number, number][],
        isConstruction: false,
        factories: factory,
      }),
      points[0]!,
      points.at(-1)!,
      snaps,
    );
  };
  const lineEnds = (patch: Authored) => {
    const entity = patch.entities[0]!;
    if (entity.kind !== "lineSegment") throw new Error("not a line");
    return [entity.startPointId, entity.endPointId] as const;
  };
  const splineEnds = (patch: Authored) => {
    const entity = patch.entities[0]!;
    if (entity.kind !== "spline") throw new Error("not a spline");
    return [
      entity.pointOccurrences[0]!.pointId,
      entity.pointOccurrences.at(-1)!.pointId,
    ] as const;
  };
  const ARCH_POINTS: readonly Vector[] = [
    [0, 0],
    [1, 0.1],
    [2, 0],
  ];

  /** commit → solve → N2 → fresh adapter → N1 resolver (real query). */
  const nativeChain = (patches: readonly Authored[], distance: number) => {
    const definition = sketch(patches);
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      partialSolvePolicy: "bestEffort",
    });
    expect(solved.status.solveState).toBe("solved");
    const positions = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const solvedDefinition = {
      ...definition,
      points: definition.points.map((point) => ({
        ...point,
        position: positions.get(point.pointId)!,
      })),
    };
    return pairChain(
      { definition: solvedDefinition, solvedSnapshot: solved.solvedSnapshot },
      distance,
    );
  };
  interface AcceptedPair {
    readonly definition: SketchDefinition;
    readonly solvedSnapshot: SolvedSketchSnapshot;
  }
  /** One accepted (definition, solvedSnapshot) pair → N2 → fresh adapter → N1 resolver. */
  const pairChain = (
    pair: AcceptedPair,
    distance: number,
    seedIds: readonly SketchEntityId[] = pair.definition.entities.map(
      (entity) => entity.entityId,
    ),
  ) => {
    const connectivity = extractDeclaredOffsetChainConnectivity({
      definition: pair.definition,
      seedIds,
    });
    if (!connectivity.ok) throw new Error(connectivity.message);
    const adapt = () => {
      const declared = declaredOffsetChainPieces({
        definition: pair.definition,
        solvedSnapshot: pair.solvedSnapshot,
        connectivity,
        distance,
        modelingTolerance: TOLERANCE,
      });
      if (!declared.ok) throw new Error(declared.message);
      return declared;
    };
    const declared = adapt();
    const resolution = resolveOffsetChainTopology({
      pieces: declared.pieces,
      closed: connectivity.closed,
      modelingTolerance: TOLERANCE,
      query,
    });
    return { connectivity, declared, resolution, adapt, pair };
  };
  const accepted = (chain: ReturnType<typeof nativeChain>) => {
    if (!chain.resolution.ok)
      throw new Error(`${chain.resolution.code}: ${chain.resolution.message}`);
    return chain.resolution;
  };
  const recording = () => {
    const requests: PieceTubeChainRequest[] = [];
    const certifier: CertifiedTubePieceChain = {
      certifyPieceChain: (request) => {
        requests.push(request);
        return pieceCertifier.certifyPieceChain(request);
      },
    };
    return { requests, certifier };
  };
  const refusing: CertifiedTubePieceChain = {
    certifyPieceChain: () => {
      throw new Error("the certifier must not be reached");
    },
  };
  const TRIM_KEYS = [
    "first",
    "firstRootBounds",
    "jointIndex",
    "kind",
    "line",
    "orientation",
    "second",
    "secondRootBounds",
    "tail",
  ];

  const splineThenLine = (fromStart: boolean) => {
    const spline = drawSpline([], ARCH_POINTS);
    const [start, end] = splineEnds(spline);
    const line = fromStart
      ? drawLine([spline], [0, 0], [0, 1], { start })
      : drawLine([spline], [2, 0], [2, 1], { start: end });
    return [spline, line];
  };

  test("native spline → line from its end: a concave line↔cubic trim is verified on the declared branch", () => {
    const patches = splineThenLine(false);
    const chain = nativeChain(patches, 0.01);
    // The line tool reused the spline's end point ID (no constraint).
    expect(chain.connectivity.joins).toEqual([
      { kind: "sharedPoint", pointId: splineEnds(patches[0]!)[1] },
    ]);
    const resolved = accepted(chain);
    const { requests, certifier } = recording();
    const result = certifyOffsetChainTubeStability(
      resolved,
      certifier,
      chain.declared,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(requests).toHaveLength(1);
    const [request] = requests;
    const [splinePiece, linePiece] = resolved.input.pieces;
    if (
      splinePiece?.kind !== "derivedCubic" ||
      linePiece?.kind !== "lineSegment"
    )
      throw new Error("unexpected piece kinds");
    // One fresh owner call, forwarded by identity with its stored query domains.
    expect(chain.declared.sources[0]).toMatchObject({
      spans: splinePiece.spans,
    });
    const cubicTubes = request!.pieces[0]!;
    if (cubicTubes.kind !== "cubic") throw new Error("cubic piece");
    cubicTubes.tubes.forEach((tube, index) => {
      expect(tube.poles).toBe(splinePiece.spans[index]!.poles);
      expect(tube.queryDomain).toBe(splinePiece.spans[index]!.sourceInterval);
    });
    // H1 binding: raw resolver supports, never the joint representative.
    const lineTube = request!.pieces[1]!;
    if (lineTube.kind !== "line") throw new Error("line piece");
    expect(lineTube.tube.emitted[0]).toBe(linePiece.start);
    expect(lineTube.tube.emitted[1]).toBe(linePiece.end);
    expect(lineTube.tube.emitted[0]).not.toBe(
      resolved.lineArcEndpoints.get(linePiece.seedEntityId)!.start,
    );
    expect(request!.trims).toEqual([
      {
        jointIndex: 0,
        firstParameterBounds: resolved.joints[0]!.firstParameterBounds,
        secondParameterBounds: resolved.joints[0]!.secondParameterBounds,
      },
    ]);
    const trims = result.certificate.joins.filter(
      (join) => join.kind === "trim",
    );
    expect(trims).toEqual([
      expect.objectContaining({
        kind: "trim",
        jointIndex: 0,
        first: splinePiece.spans.length - 1,
        second: splinePiece.spans.length,
        line: "second",
        orientation: -1,
      }),
    ]);
    // X10: joint identity + true-root enclosures only; no representative.
    expect(Object.keys(trims[0]!).sort()).toEqual(TRIM_KEYS);
    expect(result.certificate.leaves).toHaveLength(
      splinePiece.spans.length + 1,
    );
    for (const leaf of result.certificate.leaves)
      expect(leaf.displacementBound).toBeLessThanOrEqual(TOLERANCE);
  }, 120_000);

  test.each([
    [0.01, 1],
    [-0.01, -1],
  ] as const)(
    "native reversed spline at d = %s preserves its signed owner distance and trim orientation",
    (distance, orientation) => {
      const spline = drawSpline([], ARCH_POINTS);
      const [start] = splineEnds(spline);
      const line = drawLine([spline], [0, 0], distance > 0 ? [0, -1] : [0, 1], {
        start,
      });
      const chain = nativeChain([line, spline], distance);
      expect(chain.connectivity.pieces.map((piece) => piece.reversed)).toEqual([
        true,
        false,
      ]);
      const { requests, certifier } = recording();
      const result = certifyOffsetChainTubeStability(
        accepted(chain),
        certifier,
        chain.declared,
      );
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      const requestedLine = requests[0]!.pieces.find(
        (piece) => piece.kind === "line",
      );
      const requestedSpline = requests[0]!.pieces.find(
        (piece) => piece.kind === "cubic",
      );
      if (requestedLine?.kind !== "line" || requestedSpline?.kind !== "cubic")
        throw new Error("mixed request");
      expect(requestedSpline.reversed).toBe(true);
      expect(Object.is(requestedLine.tube.distance, distance)).toBe(true);
      expect(
        Object.is(requestedSpline.tubes[0]!.reference.distance, -distance),
      ).toBe(true);
      expect(
        result.certificate.joins.filter((join) => join.kind === "trim"),
      ).toEqual([
        expect.objectContaining({
          jointIndex: 0,
          first: 0,
          second: 2,
          line: "second",
          orientation,
        }),
      ]);
    },
    120_000,
  );

  test.each([
    [0.01, "convex"],
    [-0.01, "concave"],
  ] as const)(
    "native reversed multi-leaf spline at d = %s reaches J2′ on its actual side",
    (distance, side) => {
      const spline = drawSpline(
        [],
        [
          [0, 0],
          [1, 0.3],
          [2, -0.2],
          [3, 0],
        ],
      );
      const [start] = splineEnds(spline);
      const line = drawLine([spline], [0, 0], distance > 0 ? [0, -1] : [0, 1], {
        start,
      });
      const chain = nativeChain([line, spline], distance);
      const { requests, certifier } = recording();
      const result = certifyOffsetChainTubeStability(
        accepted(chain),
        certifier,
        chain.declared,
      );
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      const splinePiece = requests[0]!.pieces.find(
        (piece) => piece.kind === "cubic",
      );
      if (!splinePiece || splinePiece.kind !== "cubic")
        throw new Error("reversed spline piece");
      expect(splinePiece.reversed).toBe(true);
      expect(
        Object.is(splinePiece.tubes[0]!.reference.distance, -distance),
      ).toBe(true);
      expect(result.certificate.joins).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: "nonparallel-knot", side }),
        ]),
      );
    },
    120_000,
  );

  test("native reversed traversal: the line drawn from the spline start is reversed with owner distance −d", () => {
    const distance = 0.01;
    const chain = nativeChain(splineThenLine(true), distance);
    expect(chain.connectivity.pieces.map((piece) => piece.reversed)).toEqual([
      true,
      false,
    ]);
    const { requests, certifier } = recording();
    const result = certifyOffsetChainTubeStability(
      accepted(chain),
      certifier,
      chain.declared,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const [line] = requests[0]!.pieces;
    if (line?.kind !== "line") throw new Error("line first");
    expect(line.reversed).toBe(true);
    expect(Object.is(line.tube.distance, -distance)).toBe(true);
    expect(
      result.certificate.joins.filter((join) => join.kind === "trim"),
    ).toEqual([
      expect.objectContaining({
        jointIndex: 0,
        first: 0,
        second: 1,
        line: "first",
      }),
    ]);
  }, 120_000);

  const closedLoop = (vertices: readonly Vector[]) => {
    const patches: Authored[] = [];
    let first: SketchPointId | undefined;
    let previous: SketchPointId | undefined;
    vertices.forEach((vertex, index) => {
      const next = vertices[(index + 1) % vertices.length]!;
      const closing = index === vertices.length - 1;
      const patch = drawLine(patches, vertex, next, {
        ...(previous ? { start: previous } : {}),
        ...(closing && first ? { end: first } : {}),
      });
      const [start, end] = lineEnds(patch);
      first ??= start;
      previous = end;
      patches.push(patch);
    });
    return patches;
  };

  test("native closed all-line rectangle and triangle: trim-only closed chains verify without the n ≥ 5 gate", () => {
    for (const [vertices, cleared] of [
      [
        [
          [0, 0],
          [1, 0],
          [1, 1],
          [0, 1],
        ],
        [
          [0, 2],
          [1, 3],
        ],
      ],
      [
        [
          [0, 0],
          [1, 0],
          [0.5, 1],
        ],
        [],
      ],
    ] as const) {
      const chain = nativeChain(closedLoop(vertices), 0.01);
      expect(chain.connectivity.closed).toBe(true);
      const result = certifyOffsetChainTubeStability(
        accepted(chain),
        pieceCertifier,
        chain.declared,
      );
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      expect(result.certificate.joins.map((join) => join.kind)).toEqual(
        vertices.map(() => "trim"),
      );
      expect(result.certificate.clearedPairs).toEqual(cleared);
    }
  }, 120_000);

  test("T2/T8 convex corners fail in the resolver with splineJointUnsupported before any certifier", () => {
    for (const patches of [
      splineThenLine(false),
      closedLoop([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
    ]) {
      expect(nativeChain(patches, -0.01).resolution).toMatchObject({
        ok: false,
        code: codes.splineJointUnsupported,
      });
    }
  }, 120_000);

  test("control: an ID-distinct, zero-gap direct coincidence reaches the real certifier without merging points", () => {
    const line = drawLine([], [-1, 0], [0, 0]);
    const [, lineEnd] = lineEnds(line);
    const spline = drawSpline(
      [line],
      [
        [0, 0],
        [0.1, 1],
        [0, 2],
      ],
      { start: lineEnd },
    );
    const chain = nativeChain([line, spline], 0.01);
    const join = chain.connectivity.joins[0]!;
    if (join.kind !== "coincidentConstraint") throw new Error("direct join");
    expect(join.pointIds[0]).not.toBe(join.pointIds[1]);
    // Zero-gap control, NOT R_C coverage: the solved positions are bitwise equal.
    const [p, q] = join.pointIds.map((pointId) =>
      positionOf(chain.pair.definition, pointId),
    );
    expect(samePointForTest(p!, q!)).toBe(true);
    const { requests, certifier } = recording();
    const result = certifyOffsetChainTubeStability(
      accepted(chain),
      certifier,
      chain.declared,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(requests).toHaveLength(1);
  }, 120_000);

  // R_C: declared direct coincident joins with NONZERO solved source gaps.
  // Every positive is one native accepted (definition, solvedSnapshot) pair:
  // native commit → native constraint/dimension edit → the editor's real
  // committed-edit solve. Hand-built inputs appear only in labelled
  // admission adversaries, each a single-field change of such a pair. Same-ID
  // parameter edits (retargeted pointIds, changed dimension values) and forged
  // snapshots are OUTSIDE the trusted same-accepted-solve premise and are
  // documented non-detections, not tested as rejected.
  const SKETCH_ID = "sketch_l1b" as SketchId;
  type ToolTarget =
    | readonly ["point", SketchPointId]
    | readonly ["entity", SketchEntityId];
  /** Native constraint/dimension tool commit contribution (no solve). */
  const commitTool = (
    definition: SketchDefinition,
    toolId: SketchConstraintToolId,
    targets: readonly ToolTarget[],
    value: number | null = null,
  ): SketchDefinition => {
    sequence += 1;
    const step = sequence;
    const contribution = getSketchConstraintDefinition(
      toolId,
    ).createCommitContribution({
      sequence: step,
      selectedTargets: targets.map(([kind, targetId]) => {
        const record = resolveSketchConstraintTarget(
          toolId,
          definition,
          kind === "point"
            ? createSketchPointRef(SKETCH_ID, targetId)
            : { kind: "sketchEntity", sketchId: SKETCH_ID, entityId: targetId },
        );
        if (!record) throw new Error(`${toolId} rejected ${targetId}`);
        return record;
      }),
      pointer: null,
      value,
      annotationPlacement: null,
      createConstraintId: (suffix) => `constraint_${step}_${suffix}` as const,
      createDimensionId: (suffix) => `dimension_${step}_${suffix}` as const,
    });
    const constraints = contribution.constraints ?? [];
    const dimensions = contribution.dimensions ?? [];
    return {
      ...definition,
      constraintIds: [
        ...definition.constraintIds,
        ...constraints.map((constraint) => constraint.constraintId),
      ],
      constraints: [...definition.constraints, ...constraints],
      dimensionIds: [
        ...definition.dimensionIds,
        ...dimensions.map((dimension) => dimension.dimensionId),
      ],
      dimensions: [...definition.dimensions, ...dimensions],
    };
  };
  /** Native tool edit + the editor's real committed-edit solve (must accept). */
  const acceptedEdit = (
    ...edit: Parameters<typeof commitTool>
  ): AcceptedPair => {
    const solved = solveCommittedConstraintDefinition(commitTool(...edit), []);
    if (!solved.solvedSnapshot)
      throw new Error(`${edit[1]} edit was not solver-accepted`);
    return solved as AcceptedPair;
  };
  const connectivityOf = (
    definition: SketchDefinition,
    seedIds = definition.entities.map((entity) => entity.entityId),
  ) => {
    const connectivity = extractDeclaredOffsetChainConnectivity({
      definition,
      seedIds,
    });
    if (!connectivity.ok) throw new Error(connectivity.message);
    return connectivity;
  };
  /** The raw adapter result, with the exported spline seams' call order. */
  const adaptRecorded = (
    pair: AcceptedPair,
    connectivity = connectivityOf(pair.definition),
    distance = 0.01,
  ) => {
    const calls: string[] = [];
    splineSeamCalls.log = calls;
    try {
      const result = declaredOffsetChainPieces({
        definition: pair.definition,
        solvedSnapshot: pair.solvedSnapshot,
        connectivity,
        distance,
        modelingTolerance: TOLERANCE,
      });
      return { result, calls };
    } finally {
      splineSeamCalls.log = null;
    }
  };
  const expectAdapterRejects = (
    adapted: ReturnType<typeof adaptRecorded>,
    message: string,
    calls: readonly string[] = [],
  ) => {
    expect(adapted.result).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining(message),
    });
    // Fails before any owner call (E1/E2/E4 also before any reconstruction).
    expect(adapted.calls).toEqual(calls);
  };
  const positionOf = (
    definition: Pick<SketchDefinition, "points">,
    pointId: SketchPointId,
  ) => {
    const point = definition.points.find((item) => item.pointId === pointId);
    if (!point) throw new Error(`missing point ${pointId}`);
    return point.position;
  };
  const coincidentJoin = (
    chain: { connectivity: ReturnType<typeof connectivityOf> },
    index: number,
  ) => {
    const join = chain.connectivity.joins[index];
    if (join?.kind !== "coincidentConstraint")
      throw new Error(`join ${index} is not a direct coincidence`);
    return join;
  };
  /** Solved source gap q − p between the two distinct declared point IDs. */
  const sourceGap = (
    pair: AcceptedPair,
    join: ReturnType<typeof coincidentJoin>,
  ) => {
    const [p, q] = join.pointIds.map((pointId) =>
      positionOf(pair.definition, pointId),
    );
    return {
      bitwiseEqual: samePointForTest(p!, q!),
      delta: [q![0] - p![0], q![1] - p![1]] as const,
    };
  };
  /**
   * Common R_C positive: accepted solved frame, distinct IDs, NONZERO bitwise
   * source gap, exactly one real certifier call, the verified trim at the
   * coincident join, and every leaf within τ.
   */
  const expectVerifiedCoincidentTrim = (
    pair: AcceptedPair,
    distance: number,
    joinIndex: number,
    trim: Record<string, unknown>,
    seedIds?: readonly SketchEntityId[],
  ) => {
    expect(pair.solvedSnapshot.status.solveState).toBe("solved");
    expect(
      pair.solvedSnapshot.constraintStatuses.map((status) => status.status),
    ).toEqual(pair.definition.constraints.map(() => "satisfied"));
    const chain = pairChain(pair, distance, seedIds);
    const join = coincidentJoin(chain, joinIndex);
    expect(join.pointIds[0]).not.toBe(join.pointIds[1]);
    const gap = sourceGap(pair, join);
    expect(gap.bitwiseEqual).toBe(false);
    const { requests, certifier } = recording();
    const result = certifyOffsetChainTubeStability(
      accepted(chain),
      certifier,
      chain.declared,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(requests).toHaveLength(1);
    const trims = result.certificate.joins.filter(
      (item) => item.kind === "trim",
    );
    expect(trims).toContainEqual(
      expect.objectContaining({ kind: "trim", jointIndex: joinIndex, ...trim }),
    );
    for (const leaf of result.certificate.leaves)
      expect(leaf.displacementBound).toBeLessThanOrEqual(TOLERANCE);
    return { chain, join, gap, trims };
  };
  const lineId = (patch: Authored) => patch.entities[0]!.entityId;
  /**
   * C1 matrix fixture: a line drawn toward/away from the join and a spline
   * drawn from it (endpoint-snap-inferred coincidence) or to it (Coincident
   * tool). A native Distance length edit then re-solves to a nonzero gap.
   */
  const lineSplineGap = (
    bulge: number,
    lineTowardJoin: boolean,
    splineFromJoin: boolean,
  ) => {
    const line = lineTowardJoin
      ? drawLine([], [-1, 0], [0, 0])
      : drawLine([], [0, 0], [-1, 0]);
    const lineJoin = lineEnds(line)[lineTowardJoin ? 1 : 0];
    const points: readonly Vector[] = [
      [0, 0],
      [bulge, 1],
      [0, 2],
    ];
    const spline = splineFromJoin
      ? drawSpline([line], points, { start: lineJoin })
      : drawSpline([line], [...points].reverse());
    const splineJoin = splineEnds(spline)[splineFromJoin ? 0 : 1];
    const joined = splineFromJoin
      ? sketch([line, spline])
      : acceptedEdit(sketch([line, spline]), "constraintCoincident", [
          ["point", lineJoin],
          ["point", splineJoin],
        ]).definition;
    const pair = acceptedEdit(
      joined,
      "dimensionDistance",
      [["entity", lineId(line)]],
      1.3,
    );
    return { line, spline, lineJoin, splineJoin, pair };
  };
  /** Fix, Fix, then the Coincident tool: accepted in place with its gap. */
  const fixedCoincidence = (
    definition: SketchDefinition,
    first: SketchPointId,
    second: SketchPointId,
  ) => {
    const fixed = commitTool(
      commitTool(definition, "constraintFix", [["point", first]]),
      "constraintFix",
      [["point", second]],
    );
    return commitTool(fixed, "constraintCoincident", [
      ["point", first],
      ["point", second],
    ]);
  };
  const nextUp = (value: number) => {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value);
    const bits = view.getBigUint64(0);
    view.setBigUint64(0, value >= 0 ? bits + 1n : bits - 1n);
    return view.getFloat64(0);
  };
  const withPointMoved = (
    pair: AcceptedPair,
    pointId: SketchPointId,
  ): AcceptedPair => ({
    ...pair,
    definition: {
      ...pair.definition,
      points: pair.definition.points.map((point) =>
        point.pointId === pointId
          ? {
              ...point,
              position: [nextUp(point.position[0]), point.position[1]] as const,
            }
          : point,
      ),
    },
  });

  test("R_C P1: native snapped line→spline + Distance edit certifies a nonzero-gap trim; one reconstruction precedes one owner call", () => {
    const { lineJoin, splineJoin, pair } = lineSplineGap(0.1, true, true);
    const { join, gap } = expectVerifiedCoincidentTrim(pair, 0.01, 0, {
      line: "first",
      orientation: 1,
    });
    expect(gap.delta[0]).not.toBe(0);
    // Constraint order is (entry, exit): the reverse of traversal order.
    expect(join.pointIds).toEqual([splineJoin, lineJoin]);
    // E3′ reuses the adapter's single fresh reconstruction, then one owner call.
    const adapted = adaptRecorded(pair);
    expect(adapted.result.ok).toBe(true);
    expect(adapted.calls).toEqual(["reconstruct", "owner"]);
  }, 300_000);

  // Concave side of every C1 orientation; the other side is convex. Two of the
  // eight concave cases exhaust the unchanged global exact-query budget and
  // fail closed in the resolver: disclosed, not waived, no cap change.
  test.each([
    [0.1, true, true, 0.01, [false, false], { line: "first", orientation: 1 }],
    [0.1, true, false, 0.01, null, "budget"],
    [
      0.1,
      false,
      true,
      -0.01,
      [true, false],
      { line: "second", orientation: -1 },
    ],
    [0.1, false, false, -0.01, null, "budget"],
    [-0.1, true, true, 0.01, [false, false], { line: "first", orientation: 1 }],
    [
      -0.1,
      true,
      false,
      0.01,
      [false, true],
      { line: "first", orientation: -1 },
    ],
    [
      -0.1,
      false,
      true,
      -0.01,
      [true, false],
      { line: "second", orientation: -1 },
    ],
    [
      -0.1,
      false,
      false,
      -0.01,
      [false, false],
      { line: "second", orientation: 1 },
    ],
  ] as const)(
    "R_C C1 bulge %s, line toward join %s, spline from join %s: concave d = %s",
    (bulge, lineTowardJoin, splineFromJoin, distance, reversed, expected) => {
      const { pair } = lineSplineGap(bulge, lineTowardJoin, splineFromJoin);
      const convex = pairChain(pair, -distance);
      expect(sourceGap(pair, coincidentJoin(convex, 0)).bitwiseEqual).toBe(
        false,
      );
      expect(convex.resolution).toMatchObject({
        ok: false,
        code: codes.splineJointUnsupported,
      });
      if (expected === "budget") {
        expect(pairChain(pair, distance).resolution).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
        return;
      }
      const { chain } = expectVerifiedCoincidentTrim(
        pair,
        distance,
        0,
        expected,
      );
      expect(chain.connectivity.pieces.map((piece) => piece.reversed)).toEqual(
        reversed,
      );
    },
    300_000,
  );

  test("R_C reversed LINE: spline-first seeds traverse the coincident line backwards and verify at −d", () => {
    const line = drawLine([], [-1, 0], [0, 0]);
    const spline = drawSpline(
      [line],
      [
        [0, 2],
        [-0.1, 1],
        [0, 0],
      ],
    );
    const joined = acceptedEdit(
      sketch([line, spline]),
      "constraintCoincident",
      [
        ["point", lineEnds(line)[1]],
        ["point", splineEnds(spline)[1]],
      ],
    );
    const pair = acceptedEdit(
      joined.definition,
      "dimensionDistance",
      [["entity", lineId(line)]],
      1.3,
    );
    const seeds = [spline.entities[0]!.entityId, lineId(line)];
    const { chain } = expectVerifiedCoincidentTrim(
      pair,
      -0.01,
      0,
      { line: "second", orientation: 1 },
      seeds,
    );
    expect(chain.connectivity.pieces.map((piece) => piece.reversed)).toEqual([
      false,
      true,
    ]);
  }, 300_000);

  test("R_C line↔line: length + horizontal + Coincident tool leaves a gap in both coordinates and verifies in both seed orders", () => {
    const first = drawLine([], [-1, 0], [0, 0]);
    const second = drawLine([first], [0.002, 0.001], [0.3, 1]);
    const sized = acceptedEdit(
      sketch([first, second]),
      "dimensionDistance",
      [["entity", lineId(first)]],
      1,
    );
    const level = acceptedEdit(sized.definition, "constraintHorizontal", [
      ["entity", lineId(first)],
    ]);
    const pair = acceptedEdit(level.definition, "constraintCoincident", [
      ["point", lineEnds(first)[1]],
      ["point", lineEnds(second)[0]],
    ]);
    for (const seeds of [
      [lineId(first), lineId(second)],
      [lineId(second), lineId(first)],
    ]) {
      const { gap } = expectVerifiedCoincidentTrim(
        pair,
        0.01,
        0,
        { line: "first", orientation: 1 },
        seeds,
      );
      expect(gap.delta[0]).not.toBe(0);
      expect(gap.delta[1]).not.toBe(0);
    }
  }, 300_000);

  test("R_C closed rectangle: the coincident corner verifies as the wrap join and as an interior join, four trims each", () => {
    const a = drawLine([], [0, 0], [1, 0]);
    const b = drawLine([a], [1, 0], [1, 1], { start: lineEnds(a)[1] });
    const c = drawLine([a, b], [1, 1], [0, 1], { start: lineEnds(b)[1] });
    const d = drawLine([a, b, c], [0, 1], [0.002, 0.001], {
      start: lineEnds(c)[1],
    });
    const joined = acceptedEdit(sketch([a, b, c, d]), "constraintCoincident", [
      ["point", lineEnds(d)[1]],
      ["point", lineEnds(a)[0]],
    ]);
    const pair = acceptedEdit(
      joined.definition,
      "dimensionDistance",
      [["entity", lineId(a)]],
      1.25,
    );
    for (const [seeds, joinIndex] of [
      [[a, b, c, d].map(lineId), 3],
      [[b, a, c, d].map(lineId), 2],
    ] as const) {
      const { chain, trims } = expectVerifiedCoincidentTrim(
        pair,
        0.01,
        joinIndex,
        {},
        seeds,
      );
      expect(chain.connectivity.closed).toBe(true);
      expect(chain.connectivity.joins.map((join) => join.kind)).toEqual(
        [0, 1, 2, 3].map((index) =>
          index === joinIndex ? "coincidentConstraint" : "sharedPoint",
        ),
      );
      expect(trims).toHaveLength(4);
    }
  }, 300_000);

  // With H2 removed (private mutant) this fixture still fails closed later at
  // trim-window-unproven; it pins H2 as the rejecting gate, it does not prove
  // H2 is the only gate that would reject it.
  test("H2: a native convex-gap crossing accepted by the real resolver is rejected at the certifier's trim-side gate", () => {
    const first = drawLine([], [-1, 0], [0, 0]);
    const second = drawLine([first], [-1e-6, 1e-13], [1 - 1e-6, 1e-13 - 1e-6]);
    const solved = solveCommittedConstraintDefinition(
      fixedCoincidence(
        sketch([first, second]),
        lineEnds(first)[1],
        lineEnds(second)[0],
      ),
      [],
    );
    if (!solved.solvedSnapshot) throw new Error("not accepted in place");
    const pair = solved as AcceptedPair;
    expect(pair.solvedSnapshot.status.solveState).toBe("solved");
    const convex = pairChain(pair, 0.01);
    const gap = sourceGap(pair, coincidentJoin(convex, 0));
    expect(gap.bitwiseEqual).toBe(false);
    const { requests, certifier } = recording();
    expect(
      certifyOffsetChainTubeStability(
        accepted(convex),
        certifier,
        convex.declared,
      ),
    ).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("trim-side-unproven"),
    });
    expect(requests).toHaveLength(1);
    // The same accepted pair is concave at −d and verifies.
    expectVerifiedCoincidentTrim(pair, -0.01, 0, {
      line: "first",
      orientation: -1,
    });
  }, 300_000);

  test("E1: unaccepted frames fail before reconstruction, including partiallySolved with EVERY constraint satisfied", () => {
    const line = drawLine([], [-1, 0], [0, 0]);
    for (const [apart, coincidence, statuses] of [
      // N3: editor tolerance; every status unsatisfied.
      [1e-3, 1e-6, "unsatisfied"],
      // N3b: document tolerance; every status satisfied, only solveState differs.
      [1.2e-3, 1e-3, "satisfied"],
    ] as const) {
      const spline = drawSpline(
        [line],
        [
          [apart, 0],
          [0.1, 1],
          [0, 2],
        ],
      );
      const definition = fixedCoincidence(
        sketch([line, spline]),
        lineEnds(line)[1],
        splineEnds(spline)[0],
      );
      const solved = solveSketchDefinitionCore({
        definition,
        tolerances: { ...SKETCH_DIRECT_EDIT_TOLERANCES, coincidence },
        partialSolvePolicy: "bestEffort",
      });
      const snapshot = solved.solvedSnapshot;
      expect(snapshot.status.solveState).toBe("partiallySolved");
      expect(snapshot.constraintStatuses.map((item) => item.status)).toEqual(
        definition.constraints.map(() => statuses),
      );
      expect(
        snapshot.diagnostics.some((item) => item.severity === "error"),
      ).toBe(false);
      const pair = {
        definition: applySolvedSketchToDefinition(definition, snapshot),
        solvedSnapshot: snapshot,
      };
      expect(
        sourceGap(
          pair,
          coincidentJoin({ connectivity: connectivityOf(pair.definition) }, 0),
        ).bitwiseEqual,
      ).toBe(false);
      expectAdapterRejects(adaptRecorded(pair), "not solver-accepted");
    }
  }, 300_000);

  test("E1 admission adversaries: one solved-frame field each (constraint status, dimension status, error diagnostic)", () => {
    const { pair } = lineSplineGap(0.1, true, true);
    const snapshot = pair.solvedSnapshot;
    expect(snapshot.dimensionStatuses).toHaveLength(1);
    for (const solvedSnapshot of [
      {
        ...snapshot,
        constraintStatuses: snapshot.constraintStatuses.map((item) => ({
          ...item,
          status: "unsatisfied" as const,
        })),
      },
      {
        ...snapshot,
        dimensionStatuses: snapshot.dimensionStatuses.map((item) => ({
          ...item,
          status: "unsatisfied" as const,
        })),
      },
      {
        ...snapshot,
        diagnostics: [
          ...snapshot.diagnostics,
          {
            code: "adversary",
            severity: "error" as const,
            message: "adversary",
            target: null,
          },
        ],
      },
    ] satisfies SolvedSketchSnapshot[])
      expectAdapterRejects(
        adaptRecorded({ ...pair, solvedSnapshot }),
        "not solver-accepted",
      );
  }, 300_000);

  test("E2: ordered ID coverage rejects a rejected edit's definition with the previous snapshot, and reordered status or point records", () => {
    const first = drawLine([], [-1, 0], [0, 0]);
    const second = drawLine([first], [0.002, 0.001], [0.3, 1]);
    const sized = acceptedEdit(
      sketch([first, second]),
      "dimensionDistance",
      [["entity", lineId(first)]],
      1,
    );
    const level = acceptedEdit(sized.definition, "constraintHorizontal", [
      ["entity", lineId(first)],
    ]);
    const pair = acceptedEdit(level.definition, "constraintCoincident", [
      ["point", lineEnds(first)[1]],
      ["point", lineEnds(second)[0]],
    ]);
    expect(adaptRecorded(pair).result.ok).toBe(true);
    // N4 (ID coverage, not a staleness proof): the solver rejects this edit
    // and returns the unsolved definition with a new dimension ID.
    const rejectedDefinition = commitTool(
      pair.definition,
      "dimensionDistance",
      [["entity", lineId(first)]],
      1.7,
    );
    expect(
      solveCommittedConstraintDefinition(rejectedDefinition, []).solvedSnapshot,
    ).toBeUndefined();
    expectAdapterRejects(
      adaptRecorded(
        { ...pair, definition: rejectedDefinition },
        connectivityOf(rejectedDefinition),
      ),
      "does not cover this definition",
    );
    // Admission adversaries: same ID sets, different order.
    const snapshot = pair.solvedSnapshot;
    expect(snapshot.constraintStatuses).toHaveLength(2);
    for (const solvedSnapshot of [
      {
        ...snapshot,
        constraintStatuses: [...snapshot.constraintStatuses].reverse(),
      },
      { ...snapshot, solvedPoints: [...snapshot.solvedPoints].reverse() },
    ])
      expectAdapterRejects(
        adaptRecorded({ ...pair, solvedSnapshot }),
        "does not cover this definition",
      );
  }, 300_000);

  test("E3′: seed geometry must equal the frame's solved entities bitwise (line endpoint, spline poles, span source IDs, one record)", () => {
    const { line, spline, lineJoin, splineJoin, pair } = lineSplineGap(
      0.1,
      true,
      true,
    );
    const snapshot = pair.solvedSnapshot;
    // Unsolved 1-ulp edits of either declared join point.
    expectAdapterRejects(
      adaptRecorded(withPointMoved(pair, lineJoin)),
      "line seed geometry does not match",
    );
    expectAdapterRejects(
      adaptRecorded(withPointMoved(pair, splineJoin)),
      "spline seed geometry does not match",
      ["reconstruct"],
    );
    // Admission adversaries on the snapshot's solved entity records.
    const splineRecordAdversary = {
      ...snapshot,
      solvedEntities: snapshot.solvedEntities.map((record) => {
        if (
          record.kind !== "spline" ||
          record.entityId !== spline.entities[0]!.entityId ||
          record.reconstruction.validity !== "valid"
        )
          return record;
        const [span, ...rest] = record.reconstruction.spans;
        return {
          ...record,
          reconstruction: {
            ...record.reconstruction,
            spans: [
              {
                ...span!,
                source: { ...span!.source, startOccurrenceId: "other-use" },
              },
              ...rest,
            ],
          },
        };
      }),
    } satisfies SolvedSketchSnapshot;
    expectAdapterRejects(
      adaptRecorded({ ...pair, solvedSnapshot: splineRecordAdversary }),
      "spline seed geometry does not match",
      ["reconstruct"],
    );
    const lineRecord = snapshot.solvedEntities.find(
      (record) => record.entityId === lineId(line),
    )!;
    expectAdapterRejects(
      adaptRecorded({
        ...pair,
        solvedSnapshot: {
          ...snapshot,
          solvedEntities: [...snapshot.solvedEntities, lineRecord],
        },
      }),
      "line seed geometry does not match",
    );
  }, 300_000);

  test("E3′ (N5b): an authored tangent flipped to automatic without a re-solve keeps every position bitwise but fails on spline poles", () => {
    const { spline, pair: gapped } = lineSplineGap(0.1, true, true);
    const splineEntityId = spline.entities[0]!.entityId;
    const withTangents = (
      tangent: (index: number) => { kind: "automatic" } | null,
      definition: SketchDefinition,
    ): SketchDefinition => ({
      ...definition,
      entities: definition.entities.map((entity) =>
        entity.kind === "spline" && entity.entityId === splineEntityId
          ? {
              ...entity,
              pointOccurrences: entity.pointOccurrences.map(
                (occurrence, index) => ({
                  ...occurrence,
                  tangent: tangent(index) ?? occurrence.tangent,
                }),
              ),
            }
          : entity,
      ),
    });
    // An authored tangent accepted by one real committed solve.
    const authored = solveCommittedConstraintDefinition(
      {
        ...gapped.definition,
        entities: gapped.definition.entities.map((entity) =>
          entity.kind === "spline" && entity.entityId === splineEntityId
            ? {
                ...entity,
                pointOccurrences: entity.pointOccurrences.map(
                  (occurrence, index) =>
                    index === 1
                      ? {
                          ...occurrence,
                          tangent: {
                            kind: "authored" as const,
                            vector: [0.2, 1.1] as const,
                          },
                        }
                      : occurrence,
                ),
              }
            : entity,
        ),
      },
      [],
    );
    if (!authored.solvedSnapshot) throw new Error("authored tangent rejected");
    const pair = authored as AcceptedPair;
    expect(adaptRecorded(pair).result.ok).toBe(true);
    const stale = {
      ...pair,
      definition: withTangents(() => ({ kind: "automatic" }), pair.definition),
    };
    for (const point of stale.definition.points)
      expect(
        samePointForTest(
          point.position,
          pair.solvedSnapshot.solvedPoints.find(
            (item) => item.pointId === point.pointId,
          )!.solvedPosition,
        ),
      ).toBe(true);
    expectAdapterRejects(
      adaptRecorded(stale),
      "spline seed geometry does not match",
      ["reconstruct"],
    );
  }, 300_000);

  test("E4: each coincident join must be exactly one direct, identically ordered coincident constraint of this definition", () => {
    const { pair } = lineSplineGap(0.1, true, true);
    const connectivity = connectivityOf(pair.definition);
    const join = coincidentJoin({ connectivity }, 0);
    expect(pair.definition.constraints).toEqual([
      expect.objectContaining({
        kind: "coincident",
        constraintId: join.constraintId,
      }),
    ]);
    // N7: the constraint deleted and the sketch re-solved (accepted), while the
    // connectivity still declares it.
    const without = solveCommittedConstraintDefinition(
      {
        ...pair.definition,
        constraintIds: [],
        constraints: [],
      },
      [],
    );
    if (!without.solvedSnapshot) throw new Error("re-solve rejected");
    expectAdapterRejects(
      adaptRecorded(without as AcceptedPair, connectivity),
      "not a direct constraint of this definition",
    );
    // Admission adversaries: join order swapped; duplicated constraint identity.
    const swapped = {
      ...connectivity,
      joins: [
        { ...join, pointIds: [join.pointIds[1], join.pointIds[0]] as const },
      ],
    };
    expectAdapterRejects(
      adaptRecorded(pair, swapped),
      "not a direct constraint of this definition",
    );
    const constraint = pair.definition.constraints[0]!;
    const duplicated: AcceptedPair = {
      definition: {
        ...pair.definition,
        constraintIds: [constraint.constraintId, constraint.constraintId],
        constraints: [constraint, constraint],
      },
      solvedSnapshot: {
        ...pair.solvedSnapshot,
        constraintStatuses: [
          pair.solvedSnapshot.constraintStatuses[0]!,
          pair.solvedSnapshot.constraintStatuses[0]!,
        ],
      },
    };
    expectAdapterRejects(
      adaptRecorded(duplicated, connectivity),
      "not a direct constraint of this definition",
    );
  }, 300_000);

  test("W2 admission adversaries: a coincident join must bind the two distinct actual traversal terminals", () => {
    const { line, pair } = lineSplineGap(0.1, true, true);
    const chain = pairChain(pair, 0.01);
    const resolved = accepted(chain);
    const join = coincidentJoin(chain, 0);
    const forge = (
      joins: DeclaredOffsetChainPieces["connectivity"]["joins"],
      declared: DeclaredOffsetChainPieces = chain.declared,
    ) => ({
      ...declared,
      connectivity: { ...declared.connectivity, joins },
    });
    // A non-terminal ID (the line's far start) in place of the line's exit.
    expect(
      certifyOffsetChainTubeStability(
        resolved,
        refusing,
        forge([{ ...join, pointIds: [join.pointIds[0], lineEnds(line)[0]] }]),
      ),
    ).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("shared traversal terminal"),
    });
    // A shared-point chain cannot be relabelled as a coincidence of one ID.
    const shared = nativeChain(splineThenLine(false), 0.01);
    const sharedJoin = shared.connectivity.joins[0]!;
    if (sharedJoin.kind !== "sharedPoint") throw new Error("shared join");
    expect(
      certifyOffsetChainTubeStability(
        accepted(shared),
        refusing,
        forge(
          [
            {
              kind: "coincidentConstraint",
              constraintId: join.constraintId,
              pointIds: [sharedJoin.pointId, sharedJoin.pointId],
            },
          ],
          shared.declared,
        ),
      ),
    ).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("shared traversal terminal"),
    });
  }, 300_000);

  test("MR6 wrapper binding: every resolver domain end names its declared joint", () => {
    const chain = nativeChain(splineThenLine(false), 0.01);
    const resolution = accepted(chain);
    const line = resolution.input.pieces.find(
      (piece) => piece.kind === "lineSegment",
    );
    if (!line || line.kind !== "lineSegment") throw new Error("line piece");
    const ends = resolution.lineArcEndpoints.get(line.seedEntityId)!;
    const forged = {
      ...resolution,
      lineArcEndpoints: new Map(resolution.lineArcEndpoints).set(
        line.seedEntityId,
        { ...ends, startDomainEnd: { kind: "joint" as const, jointIndex: 99 } },
      ),
    };
    expect(
      certifyOffsetChainTubeStability(forged, refusing, chain.declared),
    ).toMatchObject({ ok: false, code: codes.topologyUncertain });
  }, 120_000);

  test("X9 binding: a resolution of another adapter call or a mismatched shared point is rejected", () => {
    const chain = nativeChain(splineThenLine(false), 0.01);
    const resolved = accepted(chain);
    expect(
      certifyOffsetChainTubeStability(resolved, refusing, chain.adapt()),
    ).toMatchObject({ ok: false, code: codes.topologyUncertain });
    // All-line chains have no owner-span backstop: piece identity alone binds.
    const loop = nativeChain(
      closedLoop([
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]),
      0.01,
    );
    expect(
      certifyOffsetChainTubeStability(accepted(loop), refusing, loop.adapt()),
    ).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("not resolved from this declared"),
    });
    const wrongPoint = {
      ...chain.declared,
      connectivity: {
        ...chain.connectivity,
        joins: [
          {
            kind: "sharedPoint" as const,
            pointId: "sketch_point_other" as SketchPointId,
          },
        ],
      },
    };
    expect(
      certifyOffsetChainTubeStability(resolved, refusing, wrongPoint),
    ).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("shared traversal terminal"),
    });
  }, 120_000);
});
