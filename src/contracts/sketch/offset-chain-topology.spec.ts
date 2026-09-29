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
} from "@/domain/editor/sketch-session/internals";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  ARCH_POINTS,
  CORNER_MATRIX_SOLVE_TOLERANCES,
  POSITIONAL_WRAPS,
  cornerMatrixRows,
  createNativeOffsetChainHarness,
  positionalClosureSpline,
  splineLineShallowRows,
  splineSplineCornerRows,
  type AcceptedPair,
  type Authored,
  type EndpointSnaps,
  type NativeOffsetChainHarness,
  type NativeToolAuthoring,
  type Vector,
} from "@/contracts/sketch/offset-chain.fixtures";
import {
  certifyDeclaredOffsetChain,
  certifyOffsetChainTubeStability,
  classifyOffsetChainVertex,
  declaredOffsetChainPieces,
  offsetChainRootEnclosure,
  resolveOffsetChainTopology,
  resolveOffsetChainTopologyJvp,
  type CertifiedNeutralCurveRequestQuery,
  type DeclaredOffsetChainPieces,
  type OffsetChainPiece,
  type OffsetChainPieceVariation,
  type OffsetChainTopologyInput,
  type OffsetChainTopologySuccess,
  type OffsetChainTubeStabilityCertificate,
  type OffsetChainVertex,
} from "@/contracts/sketch/offset-chain-topology";
import {
  OFFSET_DIAGNOSTIC_CODES,
  offsetLinePoints,
} from "@/contracts/sketch/offset-geometry";
import {
  reconstructSpline,
  type SplinePoles,
  type SplineSpan,
} from "@/contracts/sketch/spline-geometry";
import {
  approximateSplineOffset,
  type SplineOffsetCubicSpan,
} from "@/contracts/sketch/spline-offset-geometry";
import {
  createCertifiedCubicTubeChain,
  createCertifiedCubicTubeChainWithBudgetObserverForTest,
  createCertifiedCubicTubeChainWithLowerBudgetForTest,
} from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import {
  createCertifiedNeutralCurveRequestQuery,
  createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest,
  createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest,
} from "@/domain/modeling/neutral-curve-certification/query";
import type { ExactProofBudgetSnapshot } from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

const SKETCH_DIRECT_EDIT_TOLERANCES =
  createDocumentSolverTolerances(OCC_KERNEL_SETTINGS);

type Point = readonly [number, number];
const codes = OFFSET_DIAGNOSTIC_CODES;
const query = createCertifiedNeutralCurveRequestQuery();

/**
 * The native authoring seam of the shared harness: the line/spline tools'
 * commit contribution plus the session's endpoint-snap inference.
 */
function createNativeToolAuthoring(sketchId: string): NativeToolAuthoring {
  const factories = createSessionCommitFactories(1, sketchId as never);
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
  const infer = (
    previousDefinition: SketchDefinition,
    activeTool: "line" | "spline",
    patch: ReturnType<typeof lineSketchToolDefinition.createCommitContribution>,
    sequence: number,
    start: Vector,
    end: Vector,
    snaps: EndpointSnaps,
  ) =>
    appendInferredSnapConstraints({
      previousDefinition,
      patch,
      activeTool,
      startSnap: snaps.start ? endpointSnap(snaps.start, start) : null,
      endSnap: snaps.end ? endpointSnap(snaps.end, end) : null,
      sequence,
      createConstraintId: (name: string) => `constraint_${name}` as never,
    });
  return {
    line: ({ previousDefinition, sequence, start, end, snaps }) =>
      infer(
        previousDefinition,
        "line",
        lineSketchToolDefinition.createCommitContribution({
          sequence,
          start,
          end,
          isConstruction: false,
          factories,
        }),
        sequence,
        start,
        end,
        snaps,
      ),
    spline: ({ previousDefinition, sequence, points, snaps }) =>
      infer(
        previousDefinition,
        "spline",
        splineSketchToolDefinition.createCommitContribution({
          sequence,
          start: points[0]!,
          end: points.at(-1)!,
          points: points as [number, number][],
          isConstruction: false,
          factories,
        }),
        sequence,
        points[0]!,
        points.at(-1)!,
        snaps,
      ),
  };
}

/** Seam fake: every request of the resolver answers pair queries with `fake`. */
const perRequest = (
  fake: Pick<CertifiedNeutralCurveQuery, "queryPair">,
): CertifiedNeutralCurveRequestQuery => ({
  openRequest: () => ({ queryPair: (request) => fake.queryPair(request) }),
});

/** Pass-through recorder of the resolver's requests (sizes) and pair queries. */
const recordingRequests = (
  inner: CertifiedNeutralCurveRequestQuery = query,
  onPair: (
    request: Parameters<CertifiedNeutralCurveQuery["queryPair"]>[0],
    result: ReturnType<CertifiedNeutralCurveQuery["queryPair"]>,
  ) => void = () => {},
) => {
  const sizes: number[] = [];
  const recorded: CertifiedNeutralCurveRequestQuery = {
    openRequest: (queryCount) => {
      sizes.push(queryCount);
      const request = inner.openRequest(queryCount);
      return {
        queryPair: (pair) => {
          const result = request.queryPair(pair);
          onPair(pair, result);
          return result;
        },
      };
    },
  };
  return { sizes, query: recorded };
};
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
    query?: CertifiedNeutralCurveRequestQuery;
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
      localError: { hermiteRemainder: 0, polePerturbations: [0, 0, 0, 0] },
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
    const { query: recorded } = recordingRequests(query, (request) => {
      for (const curve of [request.first, request.second]) {
        if (curve.kind === "line" && curve.form === "endpointSegment") {
          segments.push(curve);
        }
      }
    });
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
          query: createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest({
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
            { query: perRequest(fake) },
          ),
        ).code,
        proof.kind,
      ).toBe(codes.jointUnsatisfied);
    }
  });
});

describe("offset chain adjacency and global validity (M0: the certificate is the only global gate)", () => {
  const knotted = [
    fabricatedSpan(ARCH),
    fabricatedSpan([
      [3, 0],
      [4, -1],
      [5, -1],
      [6, 0],
    ]),
  ];
  const chainCertifier = createCertifiedCubicTubeChain();
  /** Resolver, then the certificate: the only claim of global validity. */
  const certifiedChain = (input: OffsetChainTopologyInput) => {
    const resolution = resolveOffsetChainTopology(input);
    return resolution.ok
      ? certifyOffsetChainTubeStability(resolution, chainCertifier)
      : resolution;
  };
  /**
   * Former global-gate adversary: the resolver no longer rejects it (it only
   * places trims, with no non-joint query), and the chain still fails closed
   * at the certificate.
   */
  const expectRejectedOnlyByCertificate = (
    input: OffsetChainTopologyInput,
    expected: { code: string; message?: string },
  ) => {
    const { sizes, query: recorded } = recordingRequests(input.query);
    const withRecording = { ...input, query: recorded };
    expect(resolveOffsetChainTopology(withRecording).ok).toBe(true);
    expect(sizes, "one request, joint queries only").toEqual([
      input.closed ? input.pieces.length : input.pieces.length - 1,
    ]);
    expect(certifiedChain(input)).toMatchObject({
      ok: false,
      code: expected.code,
      ...(expected.message
        ? { message: expect.stringContaining(expected.message) }
        : {}),
    });
  };

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

  test("an extra crossing between knot-sharing spans cannot be ignored (now by the certificate)", () => {
    expectRejectedOnlyByCertificate(
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
      // Fabricated spans share one source span, so J1 already fails.
      { code: codes.knotIncidenceUnproven },
    );
  });

  test("the resolver never queries knot incidence: an injected knot witness is never consulted", () => {
    const { sizes, query: recorded } = recordingRequests(
      perRequest({
        queryPair: () => {
          throw new Error("no pair query without a joint");
        },
      }),
    );
    expect(
      resolved(
        makeOffsetChainFixture([cubic("s", knotted)], { query: recorded }),
      ).joints,
    ).toEqual([]);
    expect(sizes).toEqual([0]);
  });

  test("non-adjacent crossings within one output and across pieces are rejected by the certificate", () => {
    expectRejectedOnlyByCertificate(
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
      { code: codes.knotIncidenceUnproven },
    );
    expectRejectedOnlyByCertificate(
      makeOffsetChainFixture([
        cubic("arch", [fabricatedSpan(ARCH)]),
        line("drop", [2.5, 1], [2.5, -1]),
        line("back", [3, -0.5], [0.5, 2]),
      ]),
      { code: codes.topologyStabilityUnsupported },
    );
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

  test("a non-adjacent curve through a trim root is rejected by the certificate", () => {
    // The non-adjacent cubic passes exactly through the horizontal/vertical joint point (1, 0).
    expectRejectedOnlyByCertificate(
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
      { code: codes.topologyStabilityUnsupported },
    );
  });

  test("a cubic self-loop is rejected by the certificate's K1 cone", () => {
    expectRejectedOnlyByCertificate(
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
      { code: codes.topologyUncertain, message: "cubic-tube-cone-unproven" },
    );
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

  test("real multi-span owner output resolves with no query and is certified by the tube certificate", () => {
    const spans = realMultiSpanOwner();
    expect(spans).toHaveLength(4);
    const outcomes: string[] = [];
    const { sizes, query: recorded } = recordingRequests(query, (_, result) =>
      outcomes.push(result.kind),
    );
    const result = resolved(
      makeOffsetChainFixture([cubic("s", spans)], { query: recorded }),
    );
    expect(result.joints).toEqual([]);
    expect(
      result.cubics.get(id("s"))!.map((span) => [span.start, span.end]),
    ).toEqual(spans.map(() => [{ kind: "source" }, { kind: "source" }]));
    expect(sizes).toEqual([0]);
    expect(outcomes, "formerly 7 global queries").toEqual([]);
    const certified = certifyOffsetChainTubeStability(result, chainCertifier);
    expect(certified).toMatchObject({ ok: true, resolved: result });
  });
});

describe("offset chain seam contracts", () => {
  test("forwards the document modeling tolerance unchanged into every request over owner poles", () => {
    for (const modelingTolerance of [1e-3, 2.5e-2]) {
      const distance = -0.25;
      const spans = ownerSpans({ distance, modelingTolerance });
      const seen: { tolerance: number; poles: unknown }[] = [];
      const { query: recording } = recordingRequests(query, (request) => {
        for (const curve of [request.first, request.second]) {
          seen.push({
            tolerance: request.modelingTolerance,
            poles: curve.kind === "cubicBezier" ? curve.poles : null,
          });
        }
      });
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
          { query: perRequest(throwing) },
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
      { query: perRequest(parallel) },
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
      makeOffsetChainFixture([cubic("s", ownerChain(F1_POINTS, 0.2))]),
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
      makeOffsetChainFixture([
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
      ]),
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
      makeOffsetChainFixture([cubic("s", ownerChain(F1_POINTS, 0.2))]),
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
  const harness = createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_l1b"),
    query,
    modelingTolerance: TOLERANCE,
  });
  const {
    sketch,
    drawLine,
    drawSpline,
    lineEnds,
    splineEnds,
    pairChain,
    nativeChain,
    accepted,
  } = harness;
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
    const step = harness.nextSequence();
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
    const solved = solveCommittedConstraintDefinition(
      commitTool(...edit),
      [],
      SKETCH_DIRECT_EDIT_TOLERANCES,
    );
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

  // Concave side of every C1 orientation; the other side is convex. Before
  // T08b-a two of the eight concave cases (bulge 0.1, spline not from the
  // join) exhausted the removed global gate's per-query budget in the
  // resolver; with joint queries only they now verify through the certificate.
  test.each([
    [0.1, true, true, 0.01, [false, false], { line: "first", orientation: 1 }],
    [0.1, true, false, 0.01, [false, true], { line: "first", orientation: -1 }],
    [
      0.1,
      false,
      true,
      -0.01,
      [true, false],
      { line: "second", orientation: -1 },
    ],
    [
      0.1,
      false,
      false,
      -0.01,
      [false, false],
      { line: "second", orientation: 1 },
    ],
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
      SKETCH_DIRECT_EDIT_TOLERANCES,
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
    // SEL (R1): trim-side-unproven never flips, although this trim has D > 0
    // and the staged request was sized for a flip.
    const snapshots: ExactProofBudgetSnapshot[] = [];
    expect(
      certifyDeclaredOffsetChain(
        convex.declared,
        query,
        createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
          snapshots.push(snapshot),
        ),
      ),
    ).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("trim-side-unproven"),
    });
    expect(snapshots, "one certifier attempt").toHaveLength(1);
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
      // N3b: with every requirement within the document tolerance the solver
      // now reports the frame solved, so the partiallySolved adversary is the
      // solved frame with only its solveState changed.
      if (statuses === "satisfied") {
        expect(solved.solvedSnapshot.status.solveState).toBe("solved");
      }
      const snapshot: SolvedSketchSnapshot =
        statuses === "satisfied"
          ? {
              ...solved.solvedSnapshot,
              status: {
                ...solved.solvedSnapshot.status,
                solveState: "partiallySolved",
              },
            }
          : solved.solvedSnapshot;
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
      solveCommittedConstraintDefinition(
        rejectedDefinition,
        [],
        SKETCH_DIRECT_EDIT_TOLERANCES,
      ).solvedSnapshot,
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
      SKETCH_DIRECT_EDIT_TOLERANCES,
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
      SKETCH_DIRECT_EDIT_TOLERANCES,
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

/**
 * Math review row E: a fabricated honest one-leaf tube (τ = 1e-3). Straight
 * source S(t) = (x0 + μt, 0), true offset O = S + (0, d) exactly, so
 * O′ = (μ, 0); emitted E = O + (A·T₃(2t − 1), k(t − ½)²), so |E − O| ≤ ε ≈
 * 4e-4, and E crosses itself at t = ½ ± s inside the part a trim near x1 − d
 * keeps (T08b-a-math-review-evidence/one-leaf-loop.result.json).
 */
function rowELoopSpan() {
  const [mu, A, k, d, x0, x1] = [2e-3, 4e-4, 1e-6, 9.6e-4, 0.499, 0.501];
  // Bernstein poles of the cubic polynomial Σ aᵢ tⁱ.
  const bernstein = (a: readonly [number, number, number, number]) => [
    a[0],
    a[0] + a[1] / 3,
    a[0] + (2 * a[1]) / 3 + a[2] / 3,
    a[0] + a[1] + a[2] + a[3],
  ];
  const sx = bernstein([x0, mu, 0, 0]);
  // A·T₃(2t − 1) = A(−1 + 18t − 48t² + 32t³); k(t − ½)² = k(¼ − t + t²).
  const ax = bernstein([-A, 18 * A, -48 * A, 32 * A]);
  const by = bernstein([k / 4, -k, k, 0]);
  const poles = sx.map(
    (x, index) => [x + ax[index]!, d + by[index]!] as const,
  ) as unknown as SplinePoles;
  const error = Math.sqrt(A * A + (k / 4) ** 2) * (1 + 1e-9) + 1e-15;
  const span: SplineOffsetCubicSpan = {
    source: {
      splineId: "loop",
      spanIndex: 0,
      startPointId: "pS",
      endPointId: "pJ",
      startOccurrenceId: "oS",
      endOccurrenceId: "oJ",
    },
    sourceInterval: [0, 1],
    sourceLocalInterval: [0, 1],
    poles,
    differential: { sourceInterval: [0, 1], poles: ZERO_POLES },
    certifiedError: error,
    reference: {
      // O′ = (μ, 0) exactly, in an outward box.
      derivative: [
        [mu * (1 - 1e-12), mu * (1 + 1e-12)],
        [0, 0],
      ],
      sourcePoles: sx.map((x) => [x, 0] as const) as unknown as SplinePoles,
      distance: d,
      // Neutral profile: Σ Bᵢ·ε ≡ ε, no endpoint-local refinement.
      localError: {
        hermiteRemainder: 0,
        polePerturbations: [error, error, error, error],
      },
    },
  };
  const s = Math.sqrt((6 * A - mu) / (32 * A));
  return { span, poles, d, x1, s };
}

describe("T08b-a capacity: joint queries only on one whole-request meter (M0/M7)", () => {
  const TOLERANCE = 1e-3;
  const pieceCertifier = createCertifiedCubicTubeChain();
  const harness = createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_t08ba"),
    query,
    modelingTolerance: TOLERANCE,
  });
  const matrixHarness = createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_t08b"),
    query,
    modelingTolerance: TOLERANCE,
    solveTolerances: CORNER_MATRIX_SOLVE_TOLERANCES,
  });
  const refusing: CertifiedTubePieceChain = {
    certifyPieceChain: () => {
      throw new Error("the certifier must not be reached");
    },
  };
  /** Final verdict: the resolver's failure code, else the certificate's. */
  const verdict = (chain: ReturnType<typeof harness.nativeChain>) => {
    if (!chain.resolution.ok) return chain.resolution.code;
    const result = certifyOffsetChainTubeStability(
      chain.resolution,
      pieceCertifier,
      chain.declared,
    );
    if (result.ok) return "verified";
    const inner = /: (?:uncertain|unsupported) ([a-z0-9-]+):/.exec(
      result.message,
    );
    return inner ? `${result.code} / ${inner[1]}` : result.code;
  };
  const splitLeaf = (chain: ReturnType<typeof harness.nativeChain>) =>
    chain.declared.pieces.map((piece) =>
      piece.kind === "derivedCubic" ? piece.spans.length : 0,
    );

  // Design §1.5 verdicts at 5fe2b17d (T08b-a-evidence/corner-matrix-before);
  // only S2pt changes (the removed cubic self query rejected it), and since
  // T08b-b SS-60 d = 0.01/0.2 verify through the S2 graph trim (formerly
  // trim-pair-unsupported; T08b-b-evidence/corner-matrix-{before,after}).
  // Since T08b-c the Lemma-T band rows SL-shallow d = −0.01 (formerly
  // trim-window-unproven) and SL-loop d = −0.01 (formerly
  // trim-composition-unproven) verify through the Q4-E1 local ε
  // (T08b-c-evidence/matrix-{before,after}); every other row is unchanged.
  const MATRIX_VERDICTS: Record<string, string> = {
    "S1 0.01": "verified",
    "S1 -0.01": "verified",
    "S1 0.2": "verified",
    "S1b 0.01": "verified",
    "S1b -0.05": "verified",
    "SL-90 0.01": "verified",
    "SL-90 -0.01": codes.splineJointUnsupported,
    "SL-90 0.2": "verified",
    "SL-90 -0.2": codes.splineJointUnsupported,
    "SL-90 0.5": codes.splineJointUnsupported,
    "SL-shallow 0.01": codes.splineJointUnsupported,
    "SL-shallow -0.01": "verified",
    "SL-tiny 0.01": codes.jointUnsatisfied,
    "SL-tiny -0.01": codes.jointUnsatisfied,
    "LS-90 0.01": "verified",
    "LS-90 -0.01": codes.splineJointUnsupported,
    "SS-60 0.01": "verified",
    "SS-60 -0.01": codes.splineJointUnsupported,
    "SS-60 0.2": "verified",
    "SS-tiny 0.01": codes.jointUnsatisfied,
    "SS-tiny -0.01": codes.jointUnsatisfied,
    "LL-90 0.01": "verified",
    "LL-90 -0.01": codes.splineJointUnsupported,
    "SL-loop 0.01": codes.splineJointUnsupported,
    "SL-loop -0.01": "verified",
    "S2pt 0.01": "verified",
  };

  test("native corner matrix: every row keeps its verdict, S2pt, SS-60 (d > 0) and the Lemma-T band rows now verify, and each request is sized by its joints", () => {
    const rows = cornerMatrixRows();
    expect(rows.map((row) => `${row.row} ${row.distance}`)).toEqual(
      Object.keys(MATRIX_VERDICTS),
    );
    for (const row of rows) {
      matrixHarness.resetSequence();
      const pairs: number[] = [];
      const { sizes, query: recorded } = recordingRequests(query, () =>
        pairs.push(1),
      );
      const chain = matrixHarness.nativeChain(
        row.build(matrixHarness),
        row.distance,
        { query: recorded },
      );
      const label = `${row.row} ${row.distance}`;
      expect(verdict(chain), label).toBe(MATRIX_VERDICTS[label]);
      const joints = chain.connectivity.joins.length;
      expect(sizes, label).toEqual([joints]);
      expect(pairs.length, label).toBeLessThanOrEqual(joints);
    }
  }, 120_000);

  test("S1 issues no query and SL-90 exactly its one joint query (formerly 3 and 5)", () => {
    for (const [label, expectedPairs] of [
      ["S1 0.01", 0],
      ["SL-90 0.01", 1],
    ] as const) {
      const row = cornerMatrixRows().find(
        (item) => `${item.row} ${item.distance}` === label,
      )!;
      matrixHarness.resetSequence();
      let pairs = 0;
      const { query: recorded } = recordingRequests(query, () => (pairs += 1));
      const chain = matrixHarness.nativeChain(
        row.build(matrixHarness),
        row.distance,
        { query: recorded },
      );
      expect(verdict(chain), label).toBe("verified");
      expect(pairs, label).toBe(expectedPairs);
    }
  });

  test("K3 adversaries: native chains whose non-adjacent emitted pieces cross resolve but fail closed at the certificate", () => {
    const { drawLine, drawSpline, lineEnds, splineEnds } = harness;
    // Across pieces: spline → line down → line back through the arch.
    const spline = drawSpline([], ARCH_POINTS);
    const down = drawLine([spline], [2, 0], [2, -1], {
      start: splineEnds(spline)[1],
    });
    const back = drawLine([spline, down], [2, -1], [0.5, 0.5], {
      start: lineEnds(down)[1],
    });
    // All lines: the third segment crosses the first.
    const first = drawLine([], [0, 0], [2, 0]);
    const second = drawLine([first], [2, 0], [2, 1], {
      start: lineEnds(first)[1],
    });
    const third = drawLine([first, second], [2, 1], [1, -1], {
      start: lineEnds(second)[1],
    });
    for (const [label, patches, distance] of [
      ["spline → line → crossing line", [spline, down, back], -0.01],
      ["three lines, third crosses first", [first, second, third], 0.01],
    ] as const) {
      const chain = harness.nativeChain(patches, distance);
      expect(chain.resolution.ok, label).toBe(true);
      const result = certifyOffsetChainTubeStability(
        harness.accepted(chain),
        pieceCertifier,
        chain.declared,
      );
      expect(result, label).toMatchObject({
        ok: false,
        code: codes.topologyClearanceUnproven,
        message: expect.stringContaining("cubic-tube-clearance-unproven"),
      });
    }
    // Within one output (labelled: the native spline tool authors at most
    // three fit points, so this source is reconstructed directly): a real
    // owner offset of a self-crossing five-point source.
    const geometry = reconstructSpline({
      id: "seed",
      policy: "centripetal-mean-arm-v1",
      closure: "open",
      points: (
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, -1],
        ] as const
      ).map((position, index) => ({
        occurrenceId: `o${index}`,
        id: `p${index}`,
        position,
        tangent: { kind: "automatic" as const },
      })),
    });
    if (geometry.validity !== "valid") throw new Error("invalid fixture");
    for (const distance of [0.01, -0.01]) {
      const owner = approximateSplineOffset({
        spans: geometry.spans,
        distance,
        modelingTolerance: TOLERANCE,
      });
      if (!owner.ok) throw new Error(owner.code);
      const { sizes, query: recorded } = recordingRequests();
      const resolution = resolved(
        makeOffsetChainFixture([cubic("loop", owner.spans)], {
          query: recorded,
        }),
      );
      expect(sizes, "no joint, no query").toEqual([0]);
      expect(
        certifyOffsetChainTubeStability(
          resolution,
          createCertifiedCubicTubeChain(),
        ),
        `self-crossing source, d = ${distance}`,
      ).toMatchObject({
        ok: false,
        code: codes.topologyClearanceUnproven,
        message: expect.stringContaining("cubic-tube-clearance-unproven"),
      });
    }
  });

  test("a one-leaf spline piece in a multi-piece chain is topology-stability-unsupported before the certifier", () => {
    const { drawLine, drawSpline, splineEnds } = harness;
    const straight = drawSpline(
      [],
      [
        [0, 0],
        [1, 0],
      ],
    );
    const up = drawLine([straight], [1, 0], [1, 1], {
      start: splineEnds(straight)[1],
    });
    const chain = harness.nativeChain([straight, up], 0.01);
    expect(splitLeaf(chain)).toEqual([1, 0]);
    expect(chain.resolution.ok).toBe(true);
    expect(
      certifyOffsetChainTubeStability(
        harness.accepted(chain),
        refusing,
        chain.declared,
      ),
    ).toEqual({
      ok: false,
      code: codes.topologyStabilityUnsupported,
      message: expect.stringContaining("one-leaf spline piece"),
      seedEntityId: straight.entities[0]!.entityId,
    });
    // Alone, the same one-leaf piece is the isolated-span certificate.
    const alone = harness.nativeChain([straight], 0.01);
    expect(verdict(alone)).toBe("verified");
  });

  test("a one-leaf cubic whose emitted curve loops inside its kept part, joined to a line, is topology-stability-unsupported (math review row E)", () => {
    // Fabricated honest tube (τ = 1e-3): straight source S(t) = (x0 + μt, 0),
    // true offset O = S + (0, d) exactly, so O′ = (μ, 0); emitted
    // E = O + (A·T₃(2t − 1), k(t − ½)²), so |E − O| ≤ ε ≈ 4e-4, and E crosses
    // itself at t = ½ ± s. Without the gate the real certifier verifies this
    // non-simple chain (T08b-a-math-review-evidence/one-leaf-loop.result.json).
    const { span, poles, d, x1, s } = rowELoopSpan();
    const lineSource: readonly [Point, Point] = [
      [x1, 0],
      [x1, 1],
    ];
    const emitted = offsetLinePoints(lineSource[0], lineSource[1], d)!;
    // One spans array: the adapter source is the resolver piece's own.
    const spans = [span];
    const pieces = [
      cubic("loop", spans),
      line("up", emitted.start, emitted.end),
    ];
    const resolution = resolved(makeOffsetChainFixture(pieces));
    // Premise: the emitted cubic crosses itself inside the part the trim keeps.
    const at = (t: number) => {
      let points: readonly Point[] = poles;
      while (points.length > 1)
        points = points
          .slice(1)
          .map(
            (point, index): Point => [
              points[index]![0] + t * (point[0] - points[index]![0]),
              points[index]![1] + t * (point[1] - points[index]![1]),
            ],
          );
      return points[0]!;
    };
    const [left, right] = [at(0.5 - s), at(0.5 + s)];
    expect(Math.hypot(left[0] - right[0], left[1] - right[1])).toBeLessThan(
      1e-12,
    );
    expect(resolution.joints).toHaveLength(1);
    expect(resolution.joints[0]!.firstParameterBounds[0]).toBeGreaterThan(
      0.5 + s,
    );
    const declared: DeclaredOffsetChainPieces = {
      ok: true,
      connectivity: {
        ok: true,
        closed: false,
        pieces: pieces.map(({ seedEntityId, reversed }) => ({
          seedEntityId,
          reversed,
        })),
        joins: [{ kind: "sharedPoint", pointId: "pJ" as SketchPointId }],
      },
      distance: d,
      modelingTolerance: TOLERANCE,
      pieces,
      vertices: [],
      sources: [
        { kind: "spline", distance: d, spans, sourceSpans: [] },
        {
          kind: "line",
          source: lineSource,
          distance: d,
          startPointId: "pJ" as SketchPointId,
          endPointId: "pE" as SketchPointId,
        },
      ],
    };
    expect(
      certifyOffsetChainTubeStability(resolution, pieceCertifier, declared),
    ).toEqual({
      ok: false,
      code: codes.topologyStabilityUnsupported,
      message: expect.stringContaining("one-leaf spline piece"),
      seedEntityId: id("loop"),
    });
  });

  /** One authored native chain; every resolution reuses its accepted pair. */
  const nativePair = (build: () => readonly Authored[]) =>
    harness.nativeChain(build(), 0.01).pair;
  const sl90 = nativePair(() => {
    const spline = harness.drawSpline([], ARCH_POINTS);
    return [
      spline,
      harness.drawLine([spline], [2, 0], [2, 1], {
        start: harness.splineEnds(spline)[1],
      }),
    ];
  });
  const ls90 = nativePair(() => {
    const line = harness.drawLine([], [-1, 1], [0, 0]);
    return [
      line,
      harness.drawSpline([line], ARCH_POINTS, {
        start: harness.lineEnds(line)[1],
      }),
    ];
  });
  const ownerDistance = -0.25;
  const ownerChainSpans = ownerSpans({ distance: ownerDistance });
  const REQUEST_ROWS: readonly (readonly [
    string,
    (
      requestQuery: CertifiedNeutralCurveRequestQuery,
    ) => ReturnType<typeof resolveOffsetChainTopology>,
    readonly ("line" | "cubicBezier")[],
    { operations: number; euclideanSteps: number; bits: number },
  ])[] = [
    [
      "native SL-90 (cubic, line)",
      (requestQuery) =>
        harness.pairChain(sl90, 0.01, undefined, requestQuery).resolution,
      ["cubicBezier"],
      { operations: 126_651, euclideanSteps: 17_194, bits: 537 },
    ],
    [
      "native LS-90 (line, cubic)",
      (requestQuery) =>
        harness.pairChain(ls90, 0.01, undefined, requestQuery).resolution,
      ["line"],
      { operations: 160_021, euclideanSteps: 25_907, bits: 582 },
    ],
    [
      "owner line/cubic/line, forward: (first line, cubic) then (cubic, last line)",
      (requestQuery) =>
        resolveOffsetChainTopology(
          makeOffsetChainFixture(
            ownerLineCubicLine(ownerDistance, ownerChainSpans),
            { query: requestQuery },
          ),
        ),
      ["line", "cubicBezier"],
      { operations: 239_058, euclideanSteps: 29_510, bits: 280 },
    ],
    [
      "owner line/cubic/line, reversed traversal: each pair in the swapped argument order",
      (requestQuery) =>
        resolveOffsetChainTopology(
          makeOffsetChainFixture(
            ownerLineCubicLine(ownerDistance, ownerChainSpans, true),
            { query: requestQuery },
          ),
        ),
      ["line", "cubicBezier"],
      { operations: 239_058, euclideanSteps: 29_510, bits: 280 },
    ],
  ];

  test.each(REQUEST_ROWS)(
    "%s: exact whole-request literals; count − 1 exhausts on operations, Euclid and bits",
    (_label, resolveWith, firstKinds, literal) => {
      const snapshots: ExactProofBudgetSnapshot[] = [];
      const resolution = resolveWith(
        createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
          (snapshot) => snapshots.push(snapshot),
        ),
      );
      if (!resolution.ok) throw new Error(resolution.message);
      const joints = resolution.joints.length;
      expect(
        resolution.joints.map((joint) => joint.request.first.kind),
        "request argument order",
      ).toEqual(firstKinds);
      // One precharge of 64 per joint, then exactly one snapshot per joint query.
      expect(snapshots).toHaveLength(joints + 1);
      expect(snapshots[0]!.operations).toBe(64 * joints);
      const last = snapshots.at(-1)!;
      const bits = Math.max(last.maxStoredBits, last.maxPreProductBits);
      expect({
        operations: last.operations,
        euclideanSteps: last.euclideanSteps,
        bits,
      }).toEqual(literal);
      const metric = {
        operations: (snapshot: ExactProofBudgetSnapshot) => snapshot.operations,
        euclideanSteps: (snapshot: ExactProofBudgetSnapshot) =>
          snapshot.euclideanSteps,
        integerBits: (snapshot: ExactProofBudgetSnapshot) =>
          Math.max(snapshot.maxStoredBits, snapshot.maxPreProductBits),
      };
      for (const [key, value] of [
        ["operations", literal.operations],
        ["euclideanSteps", literal.euclideanSteps],
        ["integerBits", literal.bits],
      ] as const) {
        // Additive meters bind on the request total (the last joint for
        // operations/Euclid); bits bind on the query that attains the maximum.
        const binding = snapshots.findIndex(
          (snapshot) => metric[key](snapshot) >= value,
        );
        expect(binding, key).toBeGreaterThan(0);
        if (key !== "integerBits") expect(binding, key).toBe(joints);
        const seed = resolution.joints[binding - 1]!.firstSeedEntityId;
        const under = (limit: number) =>
          resolveWith(
            createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest({
              [key]: limit,
            }),
          );
        expect(under(value).ok, `${key} = count`).toBe(true);
        const exhausted = under(value - 1);
        expect(exhausted, `${key} = count − 1`).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
        expect(exhausted.ok ? null : exhausted.seedEntityId).toBe(seed);
        // Blame is not local: the message names the pooled request budget.
        expect(exhausted.ok ? null : exhausted.message).toContain(
          `the whole-request budget of all ${joints} joint queries is exhausted`,
        );
      }
    },
  );
});

// Logic lane (docs/testing.md): the exported resolver → wrapper seam with the
// real kernel-free request query and the real certifier, every chain authored
// only by native tools (commit → solve → N2 → adapter). S2 terminal-leaf
// cubic↔cubic graph trims under R_C′ (T08b-b). The full native C/R/SS-60 row
// set, with meters and timings, is in T08b-b-evidence/native-s2.result.jsonl;
// a representative subset is pinned here to keep the lane's runtime bounded
// (each cubic↔cubic joint query costs ≈ 4 s).
describe("T08b-b S2: native spline→spline graph trims under R_C′ (terminal leaves)", () => {
  const TOLERANCE = 1e-3;
  const pieceCertifier = createCertifiedCubicTubeChain();
  const harness = createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_s2"),
    query,
    modelingTolerance: TOLERANCE,
  });
  const matrixHarness = createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_t08b"),
    query,
    modelingTolerance: TOLERANCE,
    solveTolerances: CORNER_MATRIX_SOLVE_TOLERANCES,
  });
  type Chain = ReturnType<typeof harness.nativeChain>;
  const splineRow = (label: string) => {
    const row = splineSplineCornerRows().find(
      (item) => `${item.row} ${item.distance}` === label,
    );
    if (!row) throw new Error(`no row ${label}`);
    harness.resetSequence();
    return harness.nativeChain(row.build(harness), row.distance);
  };
  const matrixRow = (label: string) => {
    const row = cornerMatrixRows().find(
      (item) => `${item.row} ${item.distance}` === label,
    );
    if (!row) throw new Error(`no row ${label}`);
    matrixHarness.resetSequence();
    return matrixHarness.nativeChain(row.build(matrixHarness), row.distance);
  };
  /** Flattened terminal leaves of the single joint (P's exit, Q's entry). */
  const terminalLeaves = (chain: Chain) => {
    const [first, second] = chain.declared.pieces;
    if (first?.kind !== "derivedCubic" || second?.kind !== "derivedCubic")
      throw new Error("spline→spline chain");
    return [
      first.reversed ? 0 : first.spans.length - 1,
      first.spans.length + (second.reversed ? second.spans.length - 1 : 0),
    ] as const;
  };
  /**
   * Common native S2 positive: a direct coincident join between distinct
   * IDs, exactly one real certifier call, the `graph-trim` record at the
   * joint, every displacementBound ≤ τ (exactly τ on both graph leaves).
   */
  const expectVerifiedGraphTrim = (chain: Chain) => {
    expect(chain.connectivity.joins.map((join) => join.kind)).toEqual([
      "coincidentConstraint",
    ]);
    const join = chain.connectivity.joins[0]!;
    if (join.kind !== "coincidentConstraint") throw new Error("coincidence");
    expect(join.pointIds[0]).not.toBe(join.pointIds[1]);
    const requests: PieceTubeChainRequest[] = [];
    const result = certifyOffsetChainTubeStability(
      harness.accepted(chain),
      {
        certifyPieceChain: (request) => {
          requests.push(request);
          return pieceCertifier.certifyPieceChain(request);
        },
      },
      chain.declared,
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(requests).toHaveLength(1);
    const [first, second] = terminalLeaves(chain);
    const graphTrims = result.certificate.joins.filter(
      (item) => item.kind === "graph-trim",
    );
    expect(graphTrims).toEqual([
      expect.objectContaining({
        kind: "graph-trim",
        jointIndex: 0,
        first,
        second,
      }),
    ]);
    const [record] = graphTrims;
    if (record?.kind !== "graph-trim") throw new Error("graph trim");
    expect(record.separation).toBeGreaterThan(0);
    for (const leaf of result.certificate.leaves)
      expect(leaf.displacementBound).toBeLessThanOrEqual(TOLERANCE);
    expect(result.certificate.leaves[first]!.displacementBound).toBe(TOLERANCE);
    expect(result.certificate.leaves[second]!.displacementBound).toBe(
      TOLERANCE,
    );
    return result;
  };

  test.each([
    "C φ=1.571 0.01",
    "C φ=0.500 0.2",
    "C φ=0.050 0.2",
    "R φ=0.5 -0.01",
    "R φ=0.2 -0.2",
  ])(
    "native %s: the spline drawn from the other's end verifies as one graph trim",
    (label) => {
      const chain = splineRow(label);
      const result = expectVerifiedGraphTrim(chain);
      // R rows traverse the first spline backwards (its START is the join).
      expect(chain.connectivity.pieces.map((piece) => piece.reversed)).toEqual([
        label.startsWith("R"),
        false,
      ]);
      expect(result.ok).toBe(true);
    },
    120_000,
  );

  test.each(["SS-60 0.01", "SS-60 0.2"])(
    "native corner-matrix %s (formerly trim-pair-unsupported) verifies as one graph trim",
    (label) => {
      expectVerifiedGraphTrim(matrixRow(label));
    },
    120_000,
  );

  test("native NONZERO gap: Fix / Fix / Coincident on the spline ends is accepted in place and verifies (gap independence)", () => {
    const SKETCH_ID = "sketch_s2" as SketchId;
    const pointTool = (
      definition: SketchDefinition,
      toolId: SketchConstraintToolId,
      pointIds: readonly SketchPointId[],
    ): SketchDefinition => {
      const step = harness.nextSequence();
      const contribution = getSketchConstraintDefinition(
        toolId,
      ).createCommitContribution({
        sequence: step,
        selectedTargets: pointIds.map((pointId) => {
          const record = resolveSketchConstraintTarget(
            toolId,
            definition,
            createSketchPointRef(SKETCH_ID, pointId),
          );
          if (!record) throw new Error(`${toolId} rejected ${pointId}`);
          return record;
        }),
        pointer: null,
        value: null,
        annotationPlacement: null,
        createConstraintId: (suffix) => `constraint_${step}_${suffix}` as const,
        createDimensionId: (suffix) => `dimension_${step}_${suffix}` as const,
      });
      const constraints = contribution.constraints ?? [];
      return {
        ...definition,
        constraintIds: [
          ...definition.constraintIds,
          ...constraints.map((constraint) => constraint.constraintId),
        ],
        constraints: [...definition.constraints, ...constraints],
      };
    };
    harness.resetSequence();
    const row = splineSplineCornerRows().find(
      (item) => `${item.row} ${item.distance}` === "C φ=0.500 0.01",
    )!;
    // The same C φ = 0.5 outgoing spline, started 3e-4/2e-4 off the arch end.
    const [first, drawn] = row.build(harness);
    const entity = drawn!.entities[0]!;
    if (entity.kind !== "spline") throw new Error("spline");
    const fitPoints = entity.pointOccurrences.map(
      (occurrence) =>
        drawn!.points.find((point) => point.pointId === occurrence.pointId)
          ?.position ??
        first!.points.find((point) => point.pointId === occurrence.pointId)!
          .position,
    );
    const second = harness.drawSpline(
      [first!],
      [[2 + 3e-4, 2e-4] as const, ...fitPoints.slice(1)],
    );
    const end = harness.splineEnds(first!)[1];
    const start = harness.splineEnds(second)[0];
    const definition = pointTool(
      pointTool(
        pointTool(harness.sketch([first!, second]), "constraintFix", [end]),
        "constraintFix",
        [start],
      ),
      "constraintCoincident",
      [end, start],
    );
    const solved = solveCommittedConstraintDefinition(
      definition,
      [],
      SKETCH_DIRECT_EDIT_TOLERANCES,
    );
    if (!solved.solvedSnapshot) throw new Error("not accepted in place");
    const pair = solved as AcceptedPair;
    expect(pair.solvedSnapshot.status.solveState).toBe("solved");
    expect(
      pair.solvedSnapshot.constraintStatuses.map((status) => status.status),
    ).toEqual(definition.constraints.map(() => "satisfied"));
    const position = (pointId: SketchPointId) =>
      pair.definition.points.find((point) => point.pointId === pointId)!
        .position;
    const [p, q] = [position(end), position(start)];
    expect(Object.is(p[0], q[0]) && Object.is(p[1], q[1])).toBe(false);
    expectVerifiedGraphTrim(harness.pairChain(pair, 0.01));
  }, 120_000);

  // C φ = 0.1 d = 0.01 (formerly trim-existence-unproven, the E-emit band)
  // verifies since T08b-c through the Q4-E1 local ε; see the T08b-c block.
  test("native fail-closed: C φ = π/2 d = 0.2 is trim-window-unproven (t ≥ 1, needs multi-leaf windows)", () => {
    for (const [label, inner, detail] of [
      ["C φ=1.571 0.2", "trim-window-unproven", "(t ≥ 1)"],
    ] as const) {
      const chain = splineRow(label);
      expect(chain.resolution.ok, label).toBe(true);
      const result = certifyOffsetChainTubeStability(
        harness.accepted(chain),
        pieceCertifier,
        chain.declared,
      );
      expect(result, label).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining(inner),
      });
      expect(result, label).toMatchObject({
        message: expect.stringContaining(detail),
      });
    }
  }, 120_000);

  test("native convex sides fail in the resolver with splineJointUnsupported; the certifier is never reached", () => {
    for (const chain of [splineRow("R φ=0.5 0.01"), matrixRow("SS-60 -0.01")])
      expect(chain.resolution).toMatchObject({
        ok: false,
        code: codes.splineJointUnsupported,
      });
  }, 120_000);

  // Native whole-request certifier literal via the wrapper (SS-60 d = 0.01),
  // measured on this implementation (T08b-b-evidence/native-s2.result.jsonl).
  // integerBits 722 of 16 384 (4.4 %) here; the same chain's resolver request
  // uses 14 756 bits (90.1 %), which stays the binding meter.
  const NATIVE_GRAPH_METER = {
    operations: 245_596,
    euclideanSteps: 68_158,
    integerBits: 722,
  };
  test("native SS-60 d = 0.01 via the wrapper: exact whole-request literal on operations, Euclid and bits; count − 1 and staged caps inside S2 exhaust", () => {
    const chain = matrixRow("SS-60 0.01");
    const resolution = matrixHarness.accepted(chain);
    let snapshot: ExactProofBudgetSnapshot | undefined;
    expect(
      certifyOffsetChainTubeStability(
        resolution,
        createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
          snapshot = value;
        }),
        chain.declared,
      ).ok,
    ).toBe(true);
    expect({
      operations: snapshot!.operations,
      euclideanSteps: snapshot!.euclideanSteps,
      integerBits: Math.max(
        snapshot!.maxStoredBits,
        snapshot!.maxPreProductBits,
      ),
    }).toEqual(NATIVE_GRAPH_METER);
    const under = (limits: Record<string, number>) =>
      certifyOffsetChainTubeStability(
        resolution,
        createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
        chain.declared,
      );
    const exhausted = {
      ok: false,
      code: codes.topologyUncertain,
      message:
        "Tube stability is not certified: uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.",
      seedEntityId: chain.declared.pieces[0]!.seedEntityId,
    };
    for (const kind of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      expect(under({ [kind]: NATIVE_GRAPH_METER[kind] }).ok, kind).toBe(true);
      expect(under({ [kind]: NATIVE_GRAPH_METER[kind] - 1 }), kind).toEqual(
        exhausted,
      );
    }
    // Staged caps inside the S2 stage (stage probe: operations
    // [42 843, 221 475], Euclid [10 230, 61 708]) and 0.92 inside the Lemma-C
    // glue stage: exhaustion propagates. Load-bearing swallow killers: keep.
    for (const kind of ["operations", "euclideanSteps"] as const)
      for (const fraction of [0.5, 0.85, 0.92])
        expect(
          under({ [kind]: Math.floor(NATIVE_GRAPH_METER[kind] * fraction) }),
          `${kind} ${fraction}`,
        ).toEqual(exhausted);
  }, 120_000);

  test("row E, cubic↔cubic variant: the one-leaf looped cubic joined to a spline piece is still rejected by the wrapper's one-leaf gate", () => {
    const { span, poles, d, x1, s } = rowELoopSpan();
    // Second piece: a real-shaped straight vertical offset cubic x = x1 − d.
    const up: SplineOffsetCubicSpan = {
      source: {
        splineId: "up",
        spanIndex: 0,
        startPointId: "pJ",
        endPointId: "pE",
        startOccurrenceId: "oJ2",
        endOccurrenceId: "oE",
      },
      sourceInterval: [0, 1],
      sourceLocalInterval: [0, 1],
      poles: [0, 1, 2, 3].map(
        (index) => [x1 - d, index / 3] as const,
      ) as unknown as SplinePoles,
      differential: { sourceInterval: [0, 1], poles: ZERO_POLES },
      certifiedError: 1e-15,
      reference: {
        derivative: [
          [0, 0],
          [1 - 1e-12, 1 + 1e-12],
        ],
        sourcePoles: [0, 1, 2, 3].map(
          (index) => [x1, index / 3] as const,
        ) as unknown as SplinePoles,
        distance: d,
        localError: {
          hermiteRemainder: 0,
          polePerturbations: [1e-15, 1e-15, 1e-15, 1e-15],
        },
      },
    };
    const [loopSpans, upSpans] = [[span], [up]];
    const pieces = [cubic("loop", loopSpans), cubic("up", upSpans)];
    const resolution = resolved(makeOffsetChainFixture(pieces));
    // Premise: the joint root is past the loop, so the trim keeps it.
    expect(resolution.joints).toHaveLength(1);
    expect(resolution.joints[0]!.firstParameterBounds[0]).toBeGreaterThan(
      0.5 + s,
    );
    const at = (t: number) => {
      let points: readonly Point[] = poles;
      while (points.length > 1)
        points = points
          .slice(1)
          .map(
            (point, index): Point => [
              points[index]![0] + t * (point[0] - points[index]![0]),
              points[index]![1] + t * (point[1] - points[index]![1]),
            ],
          );
      return points[0]!;
    };
    const [left, right] = [at(0.5 - s), at(0.5 + s)];
    expect(Math.hypot(left[0] - right[0], left[1] - right[1])).toBeLessThan(
      1e-12,
    );
    const declared: DeclaredOffsetChainPieces = {
      ok: true,
      connectivity: {
        ok: true,
        closed: false,
        pieces: pieces.map(({ seedEntityId, reversed }) => ({
          seedEntityId,
          reversed,
        })),
        joins: [{ kind: "sharedPoint", pointId: "pJ" as SketchPointId }],
      },
      distance: d,
      modelingTolerance: TOLERANCE,
      pieces,
      vertices: [],
      sources: [
        { kind: "spline", distance: d, spans: loopSpans, sourceSpans: [] },
        { kind: "spline", distance: d, spans: upSpans, sourceSpans: [] },
      ],
    };
    expect(
      certifyOffsetChainTubeStability(resolution, pieceCertifier, declared),
    ).toEqual({
      ok: false,
      code: codes.topologyStabilityUnsupported,
      message: expect.stringContaining("one-leaf spline piece"),
      seedEntityId: id("loop"),
    });
    // Behind the gate, the same request's S2 G1 cone rejects the looped
    // emitted leaf (its hodograph is not e-positive); informative only.
    expect(
      pieceCertifier.certifyPieceChain({
        modelingTolerance: TOLERANCE,
        closed: false,
        distance: d,
        pieces: [loopSpans, upSpans].map((spans) => ({
          kind: "cubic" as const,
          reversed: false,
          tubes: spans.map((item) => ({
            poles: item.poles,
            certifiedError: item.certifiedError,
            reference: item.reference,
            source: item.source,
            sourceLocalInterval: item.sourceLocalInterval,
            queryDomain: item.sourceInterval,
          })),
        })),
        trims: [
          {
            jointIndex: 0,
            firstParameterBounds: resolution.joints[0]!.firstParameterBounds,
            secondParameterBounds: resolution.joints[0]!.secondParameterBounds,
          },
        ],
      }),
    ).toMatchObject({
      code: "trim-window-unproven",
      message: expect.stringContaining("(G1)"),
    });
  }, 120_000);
});

// Logic lane (docs/testing.md): the exported resolver → wrapper seam with the
// real kernel-free request query and the real certifier, every chain authored
// only by native tools (commit → solve → N2 → adapter). T08b-c Q4-E1: the
// owner's endpoint-local metadata (R, πᵢ) and the certifier's local-ε branch
// on the terminal vertex sub-windows (S2 Lemma X, Lemma-T δ). Full before /
// after tables with meters: T08b-c-evidence/matrix-{before,after}.result.jsonl.
describe("T08b-c Q4-E1: native band rows through the endpoint-local ε", () => {
  const TOLERANCE = 1e-3;
  const pieceCertifier = createCertifiedCubicTubeChain();
  const harnesses = {
    s2: createNativeOffsetChainHarness({
      authoring: createNativeToolAuthoring("sketch_s2"),
      query,
      modelingTolerance: TOLERANCE,
    }),
    matrix: createNativeOffsetChainHarness({
      authoring: createNativeToolAuthoring("sketch_t08b"),
      query,
      modelingTolerance: TOLERANCE,
      solveTolerances: CORNER_MATRIX_SOLVE_TOLERANCES,
    }),
    B: createNativeOffsetChainHarness({
      authoring: createNativeToolAuthoring("sketch_b"),
      query,
      modelingTolerance: TOLERANCE,
    }),
  };
  const rows = {
    s2: splineSplineCornerRows,
    matrix: cornerMatrixRows,
    B: splineLineShallowRows,
  };
  type Family = keyof typeof harnesses;
  const nativeRow = (family: Family, label: string) => {
    const harness = harnesses[family];
    const row = rows[family]().find(
      (item) => `${item.row} ${item.distance}` === label,
    );
    if (!row) throw new Error(`no row ${label}`);
    harness.resetSequence();
    const chain = harness.nativeChain(row.build(harness), row.distance);
    return { chain, resolution: harness.accepted(chain) };
  };
  /** The same requests with every owner `localError` removed (leaf-wide ε only). */
  const leafWideOnly: CertifiedTubePieceChain = {
    certifyPieceChain: (request) =>
      pieceCertifier.certifyPieceChain({
        ...request,
        pieces: request.pieces.map((piece) =>
          piece.kind === "cubic"
            ? {
                ...piece,
                tubes: piece.tubes.map((tube) => {
                  const { localError, ...reference } = tube.reference;
                  expect(localError, "owner metadata present").toBeDefined();
                  return { ...tube, reference };
                }),
              }
            : piece,
        ),
      }),
  };

  test.each([
    ["s2", "C φ=0.100 0.01", "graph-trim", "trim-existence-unproven"],
    ["s2", "C φ=0.050 0.01", "graph-trim", "trim-existence-unproven"],
    ["matrix", "SL-shallow -0.01", "trim", "trim-window-unproven"],
    ["matrix", "SL-loop -0.01", "trim", "trim-composition-unproven"],
    ["B", "B φ=0.05 0.2", "trim", "trim-composition-unproven"],
    ["B", "B φ=0.02 0.2", "trim", "trim-window-unproven"],
  ] as const)(
    "native %s %s verifies with a %s record; with the leaf-wide ε only it is %s",
    (family, label, kind, leafWide) => {
      const { chain, resolution } = nativeRow(family, label);
      const requests: PieceTubeChainRequest[] = [];
      const result = certifyOffsetChainTubeStability(
        resolution,
        {
          certifyPieceChain: (request) => {
            requests.push(request);
            return pieceCertifier.certifyPieceChain(request);
          },
        },
        chain.declared,
      );
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      expect(requests).toHaveLength(1);
      expect(
        result.certificate.joins.filter((join) => join.kind === kind),
      ).toHaveLength(chain.connectivity.joins.length);
      for (const leaf of result.certificate.leaves)
        expect(leaf.displacementBound).toBeLessThanOrEqual(TOLERANCE);
      // The owner metadata is load-bearing: the leaf-wide certificate fails
      // with the band code (the T08b-b / T08b-a verdict of this row).
      expect(
        certifyOffsetChainTubeStability(
          resolution,
          leafWideOnly,
          chain.declared,
        ),
      ).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining(leafWide),
      });
    },
    120_000,
  );

  test.each(["B φ=0.1 0.01", "B φ=0.05 0.01", "B φ=0.02 0.01"])(
    "listed: native %s stays trim-window-unproven at the leaf-wide TRUE-derivative cone (local ε bounds position, not O′)",
    (label) => {
      const { chain, resolution } = nativeRow("B", label);
      expect(
        certifyOffsetChainTubeStability(
          resolution,
          pieceCertifier,
          chain.declared,
        ),
      ).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining(
          "trim-window-unproven: The leaf-wide cone s·rot(a)·B′ > 0",
        ),
      });
    },
  );

  // Native whole-request certifier literals via the wrapper, measured on this
  // implementation (T08b-c-evidence): C φ = 0.05 d = 0.01 (S2 local branch) and
  // SL-loop d = −0.01 (Lemma-T local upgrade in the leaf loop). The staged caps
  // land inside the local branch (T08b-c-evidence/stages). Load-bearing
  // precharge, charging and exhaustion-swallow killers: keep them.
  test.each([
    [
      "s2",
      "C φ=0.050 0.01",
      { operations: 289_303, euclideanSteps: 81_779, integerBits: 838 },
      // S2 local window: operations [189 124, 259 997], Euclid [53 534, 73 872].
      [
        ["operations", 189_125],
        ["operations", 224_560],
        ["operations", 252_909],
        ["euclideanSteps", 63_703],
        ["euclideanSteps", 71_838],
      ],
    ],
    [
      "matrix",
      "SL-loop -0.01",
      { operations: 124_145, euclideanSteps: 30_300, integerBits: 424 },
      // Two Lemma-T upgrades in the leaf loop: operations [54 844, 63 019] and
      // [64 164, 72 218], Euclid [13 125, 15 316] and [15 600, 17 744].
      [
        ["operations", 54_845],
        ["operations", 58_931],
        ["operations", 68_191],
        ["euclideanSteps", 14_220],
        ["euclideanSteps", 16_672],
      ],
    ],
  ] as const)(
    "native %s %s via the wrapper: exact whole-request literal; count − 1 and staged caps inside the local branch exhaust",
    (family, label, literal, staged) => {
      const { chain, resolution } = nativeRow(family, label);
      let snapshot: ExactProofBudgetSnapshot | undefined;
      expect(
        certifyOffsetChainTubeStability(
          resolution,
          createCertifiedCubicTubeChainWithBudgetObserverForTest((value) => {
            snapshot = value;
          }),
          chain.declared,
        ).ok,
      ).toBe(true);
      expect({
        operations: snapshot!.operations,
        euclideanSteps: snapshot!.euclideanSteps,
        integerBits: Math.max(
          snapshot!.maxStoredBits,
          snapshot!.maxPreProductBits,
        ),
      }).toEqual(literal);
      const under = (limits: Record<string, number>) =>
        certifyOffsetChainTubeStability(
          resolution,
          createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
          chain.declared,
        );
      const exhausted = {
        ok: false,
        code: codes.topologyUncertain,
        message:
          "Tube stability is not certified: uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.",
        seedEntityId: chain.declared.pieces[0]!.seedEntityId,
      };
      for (const kind of [
        "operations",
        "euclideanSteps",
        "integerBits",
      ] as const) {
        expect(under({ [kind]: literal[kind] }).ok, kind).toBe(true);
        expect(under({ [kind]: literal[kind] - 1 }), kind).toEqual(exhausted);
      }
      for (const [kind, cap] of staged)
        expect(under({ [kind]: cap }), `${kind} ${cap}`).toEqual(exhausted);
    },
    120_000,
  );
});

// Logic lane (docs/testing.md): the exported SEL entry
// `certifyDeclaredOffsetChain` (T08b-d, not live) over native tool authoring
// (commit → solve → N2 → fresh adapter), the real kernel-free request query,
// the real owner for adoption re-calls and the real staged certifier. Full
// before/after table: T08b-d-evidence/matrix-{before,after}.jsonl.
describe("T08b-d SEL: declared vertices, adoption, U1 absorption", () => {
  const TOLERANCE = 1e-3;
  const pieceCertifier = createCertifiedCubicTubeChain();
  const harnesses = {
    matrix: createNativeOffsetChainHarness({
      authoring: createNativeToolAuthoring("sketch_t08b"),
      query,
      modelingTolerance: TOLERANCE,
      solveTolerances: CORNER_MATRIX_SOLVE_TOLERANCES,
    }),
    s2: createNativeOffsetChainHarness({
      authoring: createNativeToolAuthoring("sketch_s2"),
      query,
      modelingTolerance: TOLERANCE,
    }),
    native: createNativeOffsetChainHarness({
      authoring: createNativeToolAuthoring("sketch_t08bd"),
      query,
      modelingTolerance: TOLERANCE,
    }),
  };
  type Family = keyof typeof harnesses;
  const rowsOf = { matrix: cornerMatrixRows, s2: splineSplineCornerRows };
  const nativeRow = (family: "matrix" | "s2", label: string) => {
    const harness = harnesses[family];
    const row = rowsOf[family]().find(
      (item) => `${item.row} ${item.distance}` === label,
    );
    if (!row) throw new Error(`no row ${label}`);
    harness.resetSequence();
    return harness.nativeChain(row.build(harness), row.distance);
  };
  const built = (
    family: Family,
    distance: number,
    build: (harness: NativeOffsetChainHarness) => readonly Authored[],
  ) => {
    const harness = harnesses[family];
    harness.resetSequence();
    return harness.nativeChain(build(harness), distance);
  };
  const wrap = (name: keyof typeof POSITIONAL_WRAPS, distance: number) =>
    built("native", distance, (harness) => [
      positionalClosureSpline(harness, POSITIONAL_WRAPS[name]),
    ]);
  /** One SEL run with its request sizes, owner re-calls and certifier snapshots. */
  const sel = (declared: DeclaredOffsetChainPieces) => {
    const { sizes, query: recorded } = recordingRequests();
    const snapshots: ExactProofBudgetSnapshot[] = [];
    splineSeamCalls.log = [];
    const result = certifyDeclaredOffsetChain(
      declared,
      recorded,
      createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
        snapshots.push(snapshot),
      ),
    );
    const reCalls = splineSeamCalls.log.filter(
      (call) => call === "owner",
    ).length;
    splineSeamCalls.log = null;
    return { result, sizes, reCalls, snapshots };
  };
  const verifiedOf = (run: ReturnType<typeof sel>) => {
    if (!run.result.ok)
      throw new Error(`${run.result.code}: ${run.result.message}`);
    return run.result.certificate;
  };
  const vertexJoins = (certificate: OffsetChainTubeStabilityCertificate) =>
    certificate.joins.filter(
      (join) =>
        join.kind === "parallel-vertex" || join.kind === "nonparallel-vertex",
    );
  const meterOf = (snapshot: ExactProofBudgetSnapshot) => ({
    operations: snapshot.operations,
    euclideanSteps: snapshot.euclideanSteps,
    integerBits: Math.max(snapshot.maxStoredBits, snapshot.maxPreProductBits),
  });
  /** T4 agreement: the resolver's exact class is the certificate's kind. */
  const expectAgreement = (
    declared: DeclaredOffsetChainPieces,
    certificate: OffsetChainTubeStabilityCertificate,
  ) => {
    for (const join of vertexJoins(certificate)) {
      if (!("jointIndex" in join)) continue;
      const exact = classifyOffsetChainVertex(
        declared.vertices[join.jointIndex]!,
      );
      expect(join.kind, `vertex ${join.jointIndex}`).toBe(
        exact.class === "parallel" ? "parallel-vertex" : "nonparallel-vertex",
      );
    }
  };

  test.each([
    ["SL-tiny 0.01", "concave", "shared-point"],
    ["SL-tiny -0.01", "convex", "shared-point"],
    ["SS-tiny 0.01", "concave", "coincident"],
    ["SS-tiny -0.01", "convex", "coincident"],
  ] as const)(
    "native %s (formerly jointUnsatisfied) verifies as one %s nonparallel vertex, %s, g = 0, no adoption, one query",
    (label, side, authority) => {
      const chain = nativeRow("matrix", label);
      // Pre-T08b-d path: the legacy resolver still fails here.
      expect(chain.resolution).toMatchObject({
        ok: false,
        code: codes.jointUnsatisfied,
      });
      const run = sel(chain.declared);
      const certificate = verifiedOf(run);
      // Exact classification queried it: a FLOAT class (cross ≈ 5e-18 < ulp)
      // would call it parallel and open a request of 0 (review T4 mutant).
      expect(run.sizes, "one query").toEqual([1]);
      expect(run.reCalls, "emitted poles already bitwise: no re-call").toBe(0);
      expect(run.snapshots).toHaveLength(1);
      expect(vertexJoins(certificate)).toEqual([
        expect.objectContaining({
          kind: "nonparallel-vertex",
          side,
          authority,
          jointIndex: 0,
          keeper: "first",
          bridge: 0,
        }),
      ]);
      expectAgreement(chain.declared, certificate);
      for (const leaf of certificate.leaves)
        expect(leaf.displacementBound).toBeLessThanOrEqual(TOLERANCE);
    },
    120_000,
  );

  test("native two natural STARTS meeting (R4): the arch authored backwards and SS-tiny's spline drawn from its start; N2 traverses SS-tiny's spline reversed into the arch, so the sides swap and both verify", () => {
    // Traversal: SS-tiny's second spline backwards ((4, −0.2) → (2, 0)), then
    // the arch from its natural start (2, 0): the opposite direction of
    // SS-tiny, hence convex at d = +0.01 and concave at d = −0.01.
    for (const [distance, side] of [
      [0.01, "convex"],
      [-0.01, "concave"],
    ] as const) {
      const chain = built("matrix", distance, (harness) => {
        const first = harness.drawSpline([], [...ARCH_POINTS].reverse());
        return [
          first,
          harness.drawSpline(
            [first],
            [
              [2, 0],
              [3, -0.1],
              [4, -0.2],
            ],
            { start: harness.splineEnds(first)[0] },
          ),
        ];
      });
      expect(chain.connectivity.pieces.map((piece) => piece.reversed)).toEqual([
        true,
        false,
      ]);
      const certificate = verifiedOf(sel(chain.declared));
      expect(vertexJoins(certificate), `d = ${distance}`).toEqual([
        expect.objectContaining({ kind: "nonparallel-vertex", side }),
      ]);
    }
  }, 120_000);

  // Native whole-request certifier literal of the vertex path (SL-tiny
  // d = 0.01, measured on this implementation): count passes; count − 1 and
  // staged caps inside the vertex stage exhaust (T08b-d-evidence/stages).
  const SL_TINY_METER = {
    operations: 155_461,
    euclideanSteps: 43_400,
    integerBits: 1_007,
  };
  test("native SL-tiny d = 0.01 via SEL: exact certifier literal; count − 1 and staged caps exhaust on one budget", () => {
    const chain = nativeRow("matrix", "SL-tiny 0.01");
    const run = sel(chain.declared);
    verifiedOf(run);
    expect(meterOf(run.snapshots.at(-1)!)).toEqual(SL_TINY_METER);
    const under = (limits: Record<string, number>) =>
      certifyDeclaredOffsetChain(
        chain.declared,
        query,
        createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
      );
    // Exhaustion is reported as itself, never as the R6 step-2 code.
    const exhausted = {
      ok: false,
      code: codes.topologyUncertain,
      message:
        "Tube stability is not certified: uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.",
    };
    for (const kind of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      expect(under({ [kind]: SL_TINY_METER[kind] }).ok, kind).toBe(true);
      expect(under({ [kind]: SL_TINY_METER[kind] - 1 }), kind).toMatchObject(
        exhausted,
      );
    }
    for (const [kind, cap] of SL_TINY_STAGED)
      expect(under({ [kind]: cap }), `${kind} ${cap}`).toMatchObject(exhausted);
  });

  // The resolver's whole-request literal of SL-tiny d = 0.01 under SEL (one
  // nonparallel vertex query): the precharge 64, then one query.
  const SL_TINY_REQUEST = {
    operations: 116_928,
    euclideanSteps: 18_072,
    integerBits: 536,
  };
  test("native SL-tiny d = 0.01: the resolver request is sized 1 with an exact literal; count − 1 exhausts before any certifier", () => {
    const chain = nativeRow("matrix", "SL-tiny 0.01");
    const snapshots: ExactProofBudgetSnapshot[] = [];
    verifiedOf({
      ...sel(chain.declared),
      result: certifyDeclaredOffsetChain(
        chain.declared,
        createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
          (snapshot) => snapshots.push(snapshot),
        ),
        pieceCertifier,
      ),
    });
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]!.operations).toBe(64);
    expect(meterOf(snapshots[1]!)).toEqual(SL_TINY_REQUEST);
    for (const kind of ["operations", "euclideanSteps", "integerBits"] as const)
      expect(
        certifyDeclaredOffsetChain(
          chain.declared,
          createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest({
            [kind]: SL_TINY_REQUEST[kind] - 1,
          }),
          {
            openRequest: () => {
              throw new Error("the certifier must not be reached");
            },
          },
        ),
        kind,
      ).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining(
          "the whole-request budget of all 1 joint queries is exhausted",
        ),
      });
  }, 120_000);

  // wrap-near4 1e-3 d = −0.01 certifier literal (40 leaves; K3-bound, Euclid
  // 72 % of one cap): count passes, count − 1 exhausts (operations).
  const WRAP_NEAR_METER = {
    operations: 4_143_742,
    euclideanSteps: 1_085_975,
    integerBits: 398,
  };
  test("native wrap-near4 1e-3 d = −0.01: exact certifier literal of the absorbed positional vertex; count − 1 exhausts", () => {
    const chain = wrap("wrap-near4 1e-3", -0.01);
    const run = sel(chain.declared);
    verifiedOf(run);
    expect(meterOf(run.snapshots.at(-1)!)).toEqual(WRAP_NEAR_METER);
    for (const kind of ["operations"] as const) {
      const under = (limit: number) =>
        certifyDeclaredOffsetChain(
          chain.declared,
          query,
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [kind]: limit,
          }),
        );
      expect(under(WRAP_NEAR_METER[kind]).ok, kind).toBe(true);
      expect(under(WRAP_NEAR_METER[kind] - 1), kind).toMatchObject({
        ok: false,
        message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      });
    }
  }, 300_000);

  test("positional closure: wrap-flat4 is a parallel vertex with ZERO queries at both sides of d; its legacy route stays J1-unproven", () => {
    for (const distance of [0.01, -0.01]) {
      const chain = wrap("wrap-flat4", distance);
      expect(chain.connectivity.joins).toEqual([]);
      const run = sel(chain.declared);
      const certificate = verifiedOf(run);
      expect(run.sizes, "a parallel vertex is never queried").toEqual([0]);
      expect(vertexJoins(certificate)).toEqual([
        expect.objectContaining({
          kind: "parallel-vertex",
          authority: "positional-closure",
          bridge: 0,
          keeper: "second",
        }),
      ]);
      expectAgreement(chain.declared, certificate);
    }
  }, 120_000);

  test("positional closure: wrap-near4 1e-3 d = −0.01 (formerly splineJointUnsupported) is absorbed convex with ONE end-adoption re-call", () => {
    const chain = wrap("wrap-near4 1e-3", -0.01);
    expect(chain.resolution).toMatchObject({
      ok: false,
      code: codes.splineJointUnsupported,
    });
    const run = sel(chain.declared);
    const certificate = verifiedOf(run);
    expect(run.sizes).toEqual([1]);
    expect(run.reCalls, "one second-pass owner call").toBe(1);
    const [join] = vertexJoins(certificate);
    expect(join).toMatchObject({
      kind: "nonparallel-vertex",
      side: "convex",
      authority: "positional-closure",
      keeper: "second",
    });
    // The keeper is the first leaf: its START is the reserve end.
    expect(certificate.leaves[0]!.displacementBound).toBe(TOLERANCE);
  }, 120_000);

  test("T7/R11 named: wrap-near4 1e-3 d = +0.01 queries a trim at the positional closure, carries its authority to the certifier and fails ONLY as trim-classification-unproven (never flipped)", () => {
    const chain = wrap("wrap-near4 1e-3", 0.01);
    const requests: PieceTubeChainRequest[] = [];
    splineSeamCalls.log = [];
    const run = (() => {
      const snapshots: ExactProofBudgetSnapshot[] = [];
      const inner = createCertifiedCubicTubeChainWithBudgetObserverForTest(
        (snapshot) => snapshots.push(snapshot),
      );
      const result = certifyDeclaredOffsetChain(chain.declared, query, {
        openRequest: (attempts) => {
          const request = inner.openRequest(attempts);
          return {
            certifyPieceChain: (item) => {
              requests.push(item);
              return request.certifyPieceChain(item);
            },
          };
        },
      });
      return { result, snapshots };
    })();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.trims).toEqual([
      expect.objectContaining({
        jointIndex: 0,
        authority: expect.objectContaining({ kind: "positional-closure" }),
      }),
    ]);
    expect(run.result).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining(
        "trim-classification-unproven: The true terminal slopes are not proved separated",
      ),
    });
    expect(run.snapshots, "classification never flips").toHaveLength(1);
    expect(splineSeamCalls.log, "no flip ⇒ no adoption re-call").toEqual([]);
    splineSeamCalls.log = null;
  }, 120_000);

  const nativeId = "sketch_t08bd" as SketchId;
  /** Native constraint/dimension tool commit contribution (no solve). */
  const commitTool = (
    definition: SketchDefinition,
    toolId: SketchConstraintToolId,
    targets: readonly (
      | readonly ["point", SketchPointId]
      | readonly ["entity", SketchEntityId]
    )[],
    value: number | null = null,
  ): SketchDefinition => {
    const step = harnesses.native.nextSequence();
    const contribution = getSketchConstraintDefinition(
      toolId,
    ).createCommitContribution({
      sequence: step,
      selectedTargets: targets.map(([kind, targetId]) => {
        const record = resolveSketchConstraintTarget(
          toolId,
          definition,
          kind === "point"
            ? createSketchPointRef(nativeId, targetId)
            : { kind: "sketchEntity", sketchId: nativeId, entityId: targetId },
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
  const acceptedEdit = (definition: SketchDefinition): AcceptedPair => {
    const solved = solveCommittedConstraintDefinition(
      definition,
      [],
      SKETCH_DIRECT_EDIT_TOLERANCES,
    );
    if (!solved.solvedSnapshot) throw new Error("not accepted in place");
    return solved as AcceptedPair;
  };
  /** SS-tiny's outgoing spline started off the arch end, then Fix/Fix/Coincident. */
  const ssTinyGap = (offset: Vector, distance: number) => {
    const harness = harnesses.native;
    harness.resetSequence();
    const first = harness.drawSpline([], ARCH_POINTS);
    const second = harness.drawSpline(
      [first],
      [
        [2 + offset[0], offset[1]],
        [3, -0.1],
        [4, -0.2],
      ],
    );
    const end = harness.splineEnds(first)[1];
    const start = harness.splineEnds(second)[0];
    let definition = harness.sketch([first, second]);
    definition = commitTool(definition, "constraintFix", [["point", end]]);
    definition = commitTool(definition, "constraintFix", [["point", start]]);
    definition = commitTool(definition, "constraintCoincident", [
      ["point", end],
      ["point", start],
    ]);
    return harness.pairChain(acceptedEdit(definition), distance);
  };
  /** Native snapped line → near-tangent spline, then a Distance edit on the line. */
  const lineSplineGap = (distance: number) => {
    const harness = harnesses.native;
    harness.resetSequence();
    const line = harness.drawLine([], [-1, 0], [0, 0]);
    const spline = harness.drawSpline(
      [line],
      [
        [0, 0],
        [1, 0.001],
        [2, 0.003],
      ],
      { start: harness.lineEnds(line)[1] },
    );
    return harness.pairChain(
      acceptedEdit(
        commitTool(
          harness.sketch([line, spline]),
          "dimensionDistance",
          [["entity", line.entities[0]!.entityId]],
          1.3,
        ),
      ),
      distance,
    );
  };
  const gapOf = (chain: { declared: DeclaredOffsetChainPieces }) => {
    const vertex = chain.declared.vertices[0]!;
    return Math.hypot(
      vertex.second.vertex[0] - vertex.first.vertex[0],
      vertex.second.vertex[1] - vertex.first.vertex[1],
    );
  };

  test.each([
    [0.01, "convex"],
    [-0.01, "concave"],
  ] as const)(
    "native SS-tiny Fix/Fix/Coincident (3e-4, 2e-4) d = %s (formerly splineJointUnsupported) verifies with the Lemma-B bridge |g|⁺ > 0 on the keeper",
    (distance, side) => {
      const chain = ssTinyGap([3e-4, 2e-4], distance);
      expect(chain.resolution).toMatchObject({
        ok: false,
        code: codes.splineJointUnsupported,
      });
      const g = gapOf(chain);
      expect(g).toBeGreaterThan(1e-4);
      const run = sel(chain.declared);
      const certificate = verifiedOf(run);
      expect(run.reCalls, "the outgoing spline adopts once").toBe(1);
      const [join] = vertexJoins(certificate);
      expect(join).toMatchObject({
        kind: "nonparallel-vertex",
        side,
        authority: "coincident",
        keeper: "first",
      });
      if (!join || !("bridge" in join)) throw new Error("vertex");
      expect(join.bridge).toBeGreaterThanOrEqual(g);
      expect(join.bridge).toBeLessThan(g * (1 + 1e-12));
      // The keeper's reserve end (its natural end) makes it τ-bounded.
      expect(certificate.leaves[join.first]!.displacementBound).toBe(TOLERANCE);
    },
    120_000,
  );

  test("native backward declared gap: SS-tiny Fix/Fix/Coincident (−3e-4, 2e-4) keeps its step-2 code with 'absorption not certified: backward declared gap' (R6)", () => {
    for (const distance of [0.01, -0.01]) {
      const run = sel(ssTinyGap([-3e-4, 2e-4], distance).declared);
      expect(run.result, `d = ${distance}`).toMatchObject({
        ok: false,
        code: codes.splineJointUnsupported,
        message: expect.stringContaining(
          "Absorption not certified: cubic-tube-knot-incidence-unproven: Declared vertex 0: backward declared gap (e·g < 0)",
        ),
      });
    }
  }, 120_000);

  test("M-R1: native SS-tiny Fix/Fix/Coincident (3e-4, 2e-4) at d = 0 fails closed with a source-linked diagnostic; the owner seam (which rejects adoption at d = 0) is never called", () => {
    const chain = ssTinyGap([3e-4, 2e-4], 0);
    const run = sel(chain.declared);
    expect(run.reCalls, "no owner re-call at d = 0").toBe(0);
    expect(run.snapshots, "the certifier is not reached").toEqual([]);
    expect(run.result).toEqual({
      ok: false,
      code: codes.splineJointUnsupported,
      message:
        "Offset joint needs a fallback arc or tangent-continuous join, which is not supported yet for spline chains. Absorption not certified: a spline cannot adopt a declared vertex pole at d = 0 (owner seam precondition)",
      seedEntityId: chain.declared.pieces[0]!.seedEntityId,
    });
  }, 120_000);

  test("native near-tangent line → spline + Distance (g ≈ 1.0e-8): d = +0.01 fails on the Lemma-T CONE (a sign test) and never flips; d = −0.01 is absorbed with an OUTGOING keeper whose strict start reserve reports τ", () => {
    const plus = sel(lineSplineGap(0.01).declared);
    expect(plus.result).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining(
        "trim-window-unproven: The leaf-wide cone s·rot(a)·B′ > 0",
      ),
    });
    expect(plus.snapshots, "a sign failure is never flipped (R1)").toHaveLength(
      1,
    );
    const minusChain = lineSplineGap(-0.01);
    const minus = sel(minusChain.declared);
    const certificate = verifiedOf(minus);
    expect(minus.reCalls, "the line adopts by construction").toBe(0);
    const [join] = vertexJoins(certificate);
    expect(join).toMatchObject({
      kind: "nonparallel-vertex",
      side: "convex",
      authority: "coincident",
      keeper: "second",
    });
    if (!join || !("bridge" in join)) throw new Error("vertex");
    const g = gapOf(minusChain);
    expect(g).toBeGreaterThan(1e-8);
    expect(join.bridge).toBeGreaterThanOrEqual(g);
    // Leaf 0 is the adopting line; leaf 1 the keeper spline's first leaf,
    // whose natural START carries the correction path (review R2).
    expect(join.second).toBe(1);
    expect(certificate.leaves[1]!.displacementBound).toBe(TOLERANCE);
    expect(certificate.leaves[0]!.displacementBound).toBe(
      certificate.leaves[0]!.baseErrorStar,
    );
  }, 120_000);

  test("controls: trims keep their verdicts and literals through SEL; C φ = 0.05 d = −0.01 is now absorbed; failed absorptions keep their step-2 code (R6)", () => {
    // SL-loop d = −0.01 (two Lemma-T trims, T08b-c pin): unchanged
    // whole-request certifier literal through SEL (attempts sized 1 + 2).
    const loop = sel(nativeRow("matrix", "SL-loop -0.01").declared);
    verifiedOf(loop);
    expect(meterOf(loop.snapshots.at(-1)!)).toEqual({
      operations: 124_145,
      euclideanSteps: 30_300,
      integerBits: 424,
    });
    for (const label of ["SL-90 0.01", "LS-90 0.01", "SL-shallow -0.01"]) {
      const certificate = verifiedOf(sel(nativeRow("matrix", label).declared));
      expect(vertexJoins(certificate), label).toEqual([]);
    }
    // C φ = 0.05 d = −0.01 (formerly splineJointUnsupported): keeper-only.
    const convexC = built("s2", -0.01, (harness) => {
      const row = splineSplineCornerRows().find(
        (item) => `${item.row} ${item.distance}` === "C φ=0.050 0.01",
      )!;
      return row.build(harness);
    });
    const convexRun = sel(convexC.declared);
    expect(vertexJoins(verifiedOf(convexRun))).toEqual([
      expect.objectContaining({ kind: "nonparallel-vertex", side: "convex" }),
    ]);
    expect(convexRun.reCalls).toBe(1);
    // R6: owner infeasible (G ≫ τ) at SS-60 d = −0.01 after the swap too.
    expect(sel(nativeRow("matrix", "SS-60 -0.01").declared)).toMatchObject({
      reCalls: 2,
      result: {
        ok: false,
        code: codes.splineJointUnsupported,
        message: expect.stringContaining(
          "Absorption not certified: owner refinement-budget-exceeded",
        ),
      },
    });
    // R6: the owner succeeds but the absorption certificate does not.
    const shallow = sel(nativeRow("matrix", "SL-shallow 0.01").declared);
    expect(shallow.result).toMatchObject({
      ok: false,
      code: codes.splineJointUnsupported,
      message: expect.stringMatching(
        /^Offset joint needs a fallback arc .* Absorption not certified: /,
      ),
    });
  }, 300_000);

  test("R6 native: C φ = 0.1 d = −0.01 keeps splineJointUnsupported; the flip at C φ = π/2 d = 0.2 (t ≥ 1, a magnitude failure) is tried and reports the ORIGINAL trim failure", () => {
    const c01 = built("s2", -0.01, (harness) =>
      splineSplineCornerRows()
        .find((item) => `${item.row} ${item.distance}` === "C φ=0.100 0.01")!
        .build(harness),
    );
    expect(sel(c01.declared).result).toMatchObject({
      ok: false,
      code: codes.splineJointUnsupported,
      message: expect.stringContaining("Absorption not certified: "),
    });
    const sharp = sel(nativeRow("s2", "C φ=1.571 0.2").declared);
    expect(sharp.reCalls, "flip → adoption tried, and the swap").toBe(2);
    expect(sharp.snapshots, "the owner failed: no second attempt").toHaveLength(
      1,
    );
    expect(sharp.result).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining(
        "trim-window-unproven: The vertex window of a terminal leaf is not proved inside it (t ≥ 1).",
      ),
    });
  }, 300_000);

  test("R8 native one-leaf rows: a 2-point spline absorbed near-tangentially into a line verifies (vertex end); with a trim end it stays gated", () => {
    const chainAt = (distance: number) =>
      built("native", distance, (harness) => {
        const spline = harness.drawSpline(
          [],
          [
            [0, 0],
            [1, 0],
          ],
        );
        return [
          spline,
          harness.drawLine([spline], [1, 0], [2, 0.001], {
            start: harness.splineEnds(spline)[1],
          }),
        ];
      });
    const vertexEnd = chainAt(-0.01);
    expect(
      vertexEnd.declared.pieces.map((piece) =>
        piece.kind === "derivedCubic" ? piece.spans.length : 0,
      ),
    ).toEqual([1, 0]);
    expect(vertexJoins(verifiedOf(sel(vertexEnd.declared)))).toEqual([
      expect.objectContaining({ kind: "nonparallel-vertex", side: "convex" }),
    ]);
    expect(sel(chainAt(0.01).declared).result).toMatchObject({
      ok: false,
      code: codes.topologyStabilityUnsupported,
      message: expect.stringContaining("one-leaf spline piece"),
    });
  }, 120_000);

  /** SL-tiny's vertex (a step-2(b) candidate at d = −0.01), then a later convex line corner. */
  const vertexThenFailChain = () =>
    built("matrix", -0.01, (harness) => {
      const spline = harness.drawSpline([], ARCH_POINTS);
      const line = harness.drawLine([spline], [2, 0], [3, -0.1], {
        start: harness.splineEnds(spline)[1],
      });
      return [
        spline,
        line,
        harness.drawLine([spline, line], [3, -0.1], [3, 1], {
          start: harness.lineEnds(line)[1],
        }),
      ];
    });

  test("R5 native mixed chains: a vertex and a trim share one adjacency index space in either order", () => {
    const vertexThenTrim = built("matrix", 0.01, (harness) => {
      const spline = harness.drawSpline([], ARCH_POINTS);
      const line = harness.drawLine([spline], [2, 0], [3, -0.1], {
        start: harness.splineEnds(spline)[1],
      });
      return [
        spline,
        line,
        harness.drawLine([spline, line], [3, -0.1], [3, 1], {
          start: harness.lineEnds(line)[1],
        }),
      ];
    });
    const first = verifiedOf(sel(vertexThenTrim.declared));
    expect(
      first.joins
        .filter((join) => "jointIndex" in join)
        .map((join) => [
          join.kind,
          (join as { jointIndex: number }).jointIndex,
        ]),
    ).toEqual([
      ["trim", 1],
      ["nonparallel-vertex", 0],
    ]);
    const trimThenVertex = built("matrix", 0.01, (harness) => {
      const up = harness.drawLine([], [-1, 1], [-1, -0.1]);
      const line = harness.drawLine([up], [-1, -0.1], [0, 0], {
        start: harness.lineEnds(up)[1],
      });
      return [
        up,
        line,
        harness.drawSpline([up, line], ARCH_POINTS, {
          start: harness.lineEnds(line)[1],
        }),
      ];
    });
    // R6: at d = −0.01 the tiny vertex is an absorption candidate and the
    // LATER convex line corner fails in the resolver; the pre-T08b-d verdict
    // (the tiny vertex's jointUnsatisfied) is kept, the reason appended.
    const vertexThenFail = vertexThenFailChain();
    expect(vertexThenFail.resolution).toMatchObject({
      ok: false,
      code: codes.jointUnsatisfied,
    });
    expect(sel(vertexThenFail.declared).result).toMatchObject({
      ok: false,
      code: codes.jointUnsatisfied,
      message: expect.stringContaining(
        "Absorption not certified: a later adjacency fails: Offset joint needs a fallback arc",
      ),
    });
    const second = verifiedOf(sel(trimThenVertex.declared));
    expect(
      second.joins
        .filter((join) => "jointIndex" in join)
        .map((join) => [
          join.kind,
          (join as { jointIndex: number }).jointIndex,
        ]),
    ).toEqual([
      ["trim", 0],
      ["nonparallel-vertex", 1],
    ]);
  }, 120_000);

  test("M-R2: a joint-query budget exhaustion AFTER a step-2(b) candidate is reported as itself (topologyUncertain), never under the candidate's jointUnsatisfied", () => {
    const chain = vertexThenFailChain();
    const snapshots: number[] = [];
    expect(
      certifyDeclaredOffsetChain(
        chain.declared,
        createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
          (snapshot) => snapshots.push(snapshot.operations),
        ),
        pieceCertifier,
      ),
      "control: the R6 trigger",
    ).toMatchObject({ ok: false, code: codes.jointUnsatisfied });
    // Precharge 2 × 64, then after query 1 and after query 2.
    expect(snapshots).toEqual([128, 102_317, 104_682]);
    // Capped one operation above query 1: query 2 exhausts the request.
    expect(
      certifyDeclaredOffsetChain(
        chain.declared,
        createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest({
          operations: snapshots[1]! + 1,
        }),
        {
          openRequest: () => {
            throw new Error("the certifier must not be reached");
          },
        },
      ),
    ).toEqual({
      ok: false,
      code: codes.topologyUncertain,
      message:
        "Joint query is not verified (uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.): the whole-request budget of all 2 joint queries is exhausted, not necessarily by this joint.",
      seedEntityId: chain.declared.pieces[1]!.seedEntityId,
    });
  }, 120_000);

  test("SEL adversaries: an unverified query never absorbs; an antiparallel vertex fails before any query; without declared vertices the resolver infers nothing from bitwise poles", () => {
    const chain = nativeRow("matrix", "SS-tiny 0.01");
    splineSeamCalls.log = [];
    const uncertain = certifyDeclaredOffsetChain(
      chain.declared,
      perRequest({
        queryPair: () => ({
          kind: "uncertain",
          code: "fake-uncertain",
          message: "seam fake",
        }),
      }),
      {
        openRequest: () => {
          throw new Error("the certifier must not be reached");
        },
      },
    );
    expect(splineSeamCalls.log, "no adoption re-call").toEqual([]);
    splineSeamCalls.log = null;
    expect(uncertain).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("fake-uncertain"),
    });
    // Antiparallel (exact X = 0, D < 0): a forged cusp vertex.
    const vertex = chain.declared.vertices[0]!;
    const cusp: OffsetChainVertex = {
      ...vertex,
      second: {
        ...vertex.second,
        tangent: [vertex.first.tangent[1], vertex.first.tangent[0]],
      },
    };
    expect(classifyOffsetChainVertex(cusp).class).toBe("antiparallel");
    // T4: exact, not float: (1 + 2⁻⁵²)(1 − 2⁻⁵²) − 1·1 = −2⁻¹⁰⁴ ≠ 0, which a
    // binary64 cross rounds to 0 (and would call parallel, skipping the query).
    const epsilon = 2 ** -52;
    const nearly: OffsetChainVertex = {
      ...vertex,
      first: {
        ...vertex.first,
        tangent: [
          [0, 0],
          [1 + epsilon, 1],
        ],
      },
      second: {
        ...vertex.second,
        tangent: [
          [0, 0],
          [1, 1 - epsilon],
        ],
      },
    };
    expect((1 + epsilon) * (1 - epsilon) - 1).toBe(0);
    expect(classifyOffsetChainVertex(nearly)).toEqual({
      class: "nonparallel",
      forward: true,
    });
    const { sizes, query: recorded } = recordingRequests();
    expect(
      certifyDeclaredOffsetChain(
        { ...chain.declared, vertices: [cusp] },
        recorded,
        pieceCertifier,
      ),
    ).toMatchObject({ ok: false, code: codes.knotIncidenceUnproven });
    expect(sizes).toEqual([]);
    // M4: the same bitwise-shared poles without vertices are just queried.
    const legacy = recordingRequests();
    expect(
      resolveOffsetChainTopology({
        pieces: chain.declared.pieces,
        closed: false,
        modelingTolerance: TOLERANCE,
        query: legacy.query,
      }),
    ).toMatchObject({ ok: false, code: codes.jointUnsatisfied });
    expect(legacy.sizes).toEqual([1]);
  }, 120_000);

  /**
   * Fabricated resolver/certifier input (not owner-reachable): a near-tangent
   * concave line↔line join whose emitted incoming line is tilted by `shift`
   * at its end (an honest line error). The query finds a single interior
   * crossing (a trim); Lemma T's root reach then exceeds the leaf (a genuine
   * magnitude failure) and the SEL flip absorbs the vertex.
   */
  const flipChain = (shift: number): DeclaredOffsetChainPieces => {
    const d = 1 / 64;
    const a = [1, 1 / 32] as const;
    const length = Math.hypot(a[0], a[1]);
    const normal = [-a[1] / length, a[0] / length] as const;
    const pieces: OffsetChainPiece[] = [
      {
        kind: "lineSegment",
        seedEntityId: id("p"),
        reversed: false,
        start: [-1, d],
        end: [0, d - shift],
      },
      {
        kind: "lineSegment",
        seedEntityId: id("q"),
        reversed: false,
        start: [d * normal[0], d * normal[1]],
        end: [a[0] + d * normal[0], a[1] + d * normal[1]],
      },
    ];
    const v = "pv" as SketchPointId;
    return {
      ok: true,
      connectivity: {
        ok: true,
        closed: false,
        pieces: pieces.map(({ seedEntityId, reversed }) => ({
          seedEntityId,
          reversed,
        })),
        joins: [{ kind: "sharedPoint", pointId: v }],
      },
      distance: d,
      modelingTolerance: 2 ** -10,
      pieces,
      sources: [
        {
          kind: "line",
          source: [
            [-1, 0],
            [0, 0],
          ],
          distance: d,
          startPointId: "pp" as SketchPointId,
          endPointId: v,
        },
        {
          kind: "line",
          source: [[0, 0], a],
          distance: d,
          startPointId: v,
          endPointId: "pq" as SketchPointId,
        },
      ],
      vertices: [
        {
          jointIndex: 0,
          authority: { kind: "sharedPoint", pointId: v },
          first: {
            pointId: v,
            vertex: [0, 0],
            tangent: [
              [-1, 0],
              [0, 0],
            ],
          },
          second: { pointId: v, vertex: [0, 0], tangent: [[0, 0], a] },
        },
      ],
    };
  };
  // Flip whole-request certifier literal (two attempts, ONE staged budget).
  const FLIP_METER = {
    operations: 63_357,
    euclideanSteps: 13_544,
    integerBits: 380,
  };
  test("fabricated magnitude flip: a Lemma-T root-reach failure flips the trim to an absorbed vertex on attempt 2 of ONE staged budget; the control verifies as a trim", () => {
    const control = sel(flipChain(1e-6));
    expect(verifiedOf(control).joins).toEqual([
      expect.objectContaining({ kind: "trim", jointIndex: 0 }),
    ]);
    expect(control.snapshots).toHaveLength(1);
    // The first attempt alone (legacy route): a magnitude trim failure.
    const flip = flipChain(5e-6);
    const first = certifyOffsetChainTubeStability(
      resolved({
        pieces: flip.pieces,
        closed: false,
        modelingTolerance: 2 ** -10,
        query,
      }),
      pieceCertifier,
      flip,
    );
    expect(first).toMatchObject({
      ok: false,
      message: expect.stringContaining(
        "trim-window-unproven: A true-root enclosure is not strictly inside its terminal leaf.",
      ),
    });
    const run = sel(flipChain(5e-6));
    const certificate = verifiedOf(run);
    expect(run.snapshots, "attempt 2 verified").toHaveLength(2);
    expect(run.sizes, "the flip never re-queries").toEqual([1]);
    expect(vertexJoins(certificate)).toEqual([
      expect.objectContaining({
        kind: "nonparallel-vertex",
        side: "concave",
        keeper: "first",
      }),
    ]);
    expect(meterOf(run.snapshots.at(-1)!)).toEqual(FLIP_METER);
    const under = (limits: Record<string, number>) =>
      certifyDeclaredOffsetChain(
        flipChain(5e-6),
        query,
        createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
      );
    // count passes; count − 1 exhausts (a fresh budget per attempt would not).
    for (const kind of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      expect(under({ [kind]: FLIP_METER[kind] }).ok, kind).toBe(true);
      expect(under({ [kind]: FLIP_METER[kind] - 1 }), kind).toMatchObject({
        ok: false,
        message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      });
    }
    // Staged caps in the flip retry: inside its fixed entry charge, then
    // inside its vertex stage (T08b-d-evidence/stages: operations
    // [28 061, 61 799], Euclid [5 771, 13 198]). Attempt 1 alone uses 15 615.
    const firstTotal = run.snapshots[0]!.operations;
    expect(firstTotal).toBe(15_615);
    for (const [kind, cap] of [
      ["operations", firstTotal + 32],
      ["operations", 28_062],
      ["operations", 45_000],
      ["operations", 61_000],
      ["euclideanSteps", 6_000],
      ["euclideanSteps", 12_000],
    ] as const)
      expect(under({ [kind]: cap }), `${kind} ${cap}`).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      });
  });

  /** Three exact concave near-tangent lines: two flippable trims (D > 0). */
  const twoTrimChain = (): DeclaredOffsetChainPieces => {
    const d = 1 / 64;
    const sources: readonly (readonly [Point, Point])[] = [
      [
        [-1, 0],
        [0, 0],
      ],
      [
        [0, 0],
        [1, 1 / 32],
      ],
      [
        [1, 1 / 32],
        [2, 3 / 32],
      ],
    ];
    const ids = ["pa", "pb", "pc", "pd"] as unknown as SketchPointId[];
    const pieces: OffsetChainPiece[] = sources.map(([start, end], index) => {
      const offset = offsetLinePoints(start, end, d)!;
      return line(`seg${index}`, offset.start, offset.end);
    });
    const tangent = (index: number) => sources[index]!;
    return {
      ok: true,
      connectivity: {
        ok: true,
        closed: false,
        pieces: pieces.map(({ seedEntityId, reversed }) => ({
          seedEntityId,
          reversed,
        })),
        joins: [
          { kind: "sharedPoint", pointId: ids[1]! },
          { kind: "sharedPoint", pointId: ids[2]! },
        ],
      },
      distance: d,
      modelingTolerance: 2 ** -10,
      pieces,
      sources: sources.map((source, index) => ({
        kind: "line" as const,
        source,
        distance: d,
        startPointId: ids[index]!,
        endPointId: ids[index + 1]!,
      })),
      vertices: [0, 1].map((index) => ({
        jointIndex: index,
        authority: { kind: "sharedPoint" as const, pointId: ids[index + 1]! },
        first: {
          pointId: ids[index + 1]!,
          vertex: sources[index]![1],
          tangent: tangent(index),
        },
        second: {
          pointId: ids[index + 1]!,
          vertex: sources[index + 1]![0],
          tangent: tangent(index + 1),
        },
      })),
    };
  };
  /** Seam fake for attempt 1 only; later attempts use the real certifier. */
  const firstAttempt = (
    failure: Exclude<
      ReturnType<CertifiedTubePieceChain["certifyPieceChain"]>,
      { kind: "verified" }
    >,
  ) => {
    const requests: PieceTubeChainRequest[] = [];
    return {
      requests,
      certifier: {
        openRequest: (attempts: number) => {
          const real = pieceCertifier.openRequest(attempts);
          return {
            certifyPieceChain: (request: PieceTubeChainRequest) => {
              requests.push(request);
              return requests.length === 1
                ? failure
                : real.certifyPieceChain(request);
            },
          };
        },
      },
    };
  };
  test("SEL tie-break and code gate (seam fake for attempt 1): a magnitude failure on the MIDDLE leaf flips the LOWEST incident trim; a non-magnitude trim code or an untagged failure never flips", () => {
    const declared = twoTrimChain();
    const plain = verifiedOf(sel(declared));
    expect(plain.joins.map((join) => join.kind)).toEqual(["trim", "trim"]);
    const flip = firstAttempt({
      kind: "uncertain",
      code: "trim-composition-unproven",
      message: "fake",
      first: 1,
      magnitude: true,
    });
    const flipped = certifyDeclaredOffsetChain(declared, query, flip.certifier);
    expect(flipped.ok).toBe(true);
    expect(flip.requests).toHaveLength(2);
    expect(flip.requests[1]!.vertices).toEqual([
      expect.objectContaining({ jointIndex: 0 }),
    ]);
    expect(flip.requests[1]!.trims.map((trim) => trim.jointIndex)).toEqual([1]);
    for (const failure of [
      { code: "trim-classification-unproven", magnitude: true as const },
      { code: "trim-side-unproven", magnitude: true as const },
      { code: "trim-composition-unproven" },
    ]) {
      const fake = firstAttempt({
        kind: "uncertain",
        message: "fake",
        first: 1,
        ...failure,
      });
      expect(
        certifyDeclaredOffsetChain(declared, query, fake.certifier),
        failure.code,
      ).toMatchObject({ ok: false, message: expect.stringContaining("fake") });
      expect(fake.requests, failure.code).toHaveLength(1);
    }
  });

  test("JVP at a vertex end: the adopting line's end varies with the keeper spline's pole (finite-difference oracle of the adoption recipe)", () => {
    const d = 0.125;
    // Exactly parallel at the vertex: the line ends along +x, the spline starts along +x.
    const poles: SplinePoles = [
      [0, 0],
      [1, 0],
      [2, 0.25],
      [3, 0],
    ];
    const variation: SplinePoles = [
      [0, 0],
      [0.25, 0],
      [-0.25, 0.125],
      [0, 0],
    ];
    const lineVariation = {
      kind: "lineSegment" as const,
      start: [0.5, -0.25] as Point,
      // The line's OWN end variation is ignored at an adopted vertex end.
      end: [5, 5] as Point,
    };
    const build = (epsilon: number) => {
      const spans = ownerSpans({
        distance: d + epsilon,
        distanceDifferential: 1,
        poles: poles.map((pole, index) => [
          pole[0] + epsilon * variation[index]![0],
          pole[1] + epsilon * variation[index]![1],
        ]) as unknown as SplinePoles,
        poleVariation: variation,
      });
      // The adoption recipe: the line's end IS the spline's start pole.
      const lineStart: Point = [
        -1 + epsilon * lineVariation.start[0],
        d + epsilon + epsilon * lineVariation.start[1],
      ];
      const vertices: OffsetChainVertex[] = [
        {
          jointIndex: 0,
          authority: { kind: "sharedPoint", pointId: "p0" as SketchPointId },
          first: {
            pointId: "p0" as SketchPointId,
            vertex: [0, 0],
            tangent: [
              [-1, 0],
              [0, 0],
            ],
          },
          second: {
            pointId: "p0" as SketchPointId,
            vertex: [0, 0],
            tangent: [
              [0, 0],
              [1, 0],
            ],
          },
        },
      ];
      return {
        input: {
          ...makeOffsetChainFixture([
            line("in", lineStart, spans[0]!.poles[0]),
            cubic("spline", spans),
          ]),
          vertices,
        },
        variations: new Map<SketchEntityId, OffsetChainPieceVariation>([
          [id("in"), lineVariation],
        ]),
      };
    };
    const base = build(0);
    const primal = resolved(base.input);
    expect(primal.vertices).toEqual([
      // Line–spline: the line adopts, the spline keeps (T2).
      expect.objectContaining({ kind: "parallel", keeper: "second" }),
    ]);
    // A parallel vertex is not queried and domain ends name the vertex.
    expect(primal.joints).toEqual([]);
    const jvp = resolveOffsetChainTopologyJvp(
      base.input,
      primal,
      base.variations,
    );
    if (!jvp.ok) throw new Error(jvp.code);
    const h = 2 ** -20;
    const end = (epsilon: number) =>
      resolved(build(epsilon).input).lineArcEndpoints.get(id("in"))!.end;
    const measured = [0, 1].map(
      (axis) => (end(h)[axis]! - end(-h)[axis]!) / (2 * h),
    );
    const predicted = jvp.lineArcEndpoints.get(id("in"))!.end;
    for (const axis of [0, 1])
      expect(Math.abs(predicted[axis]! - measured[axis]!)).toBeLessThanOrEqual(
        1e-6,
      );
    // It is the keeper's pole differential, not the line's own end variation.
    expect(predicted).toEqual(
      base.input.pieces[1]!.kind === "derivedCubic"
        ? base.input.pieces[1]!.spans[0]!.differential.poles[0]
        : null,
    );
  });

  test("R9 staged cap (native, zero queries): wrap-flat4 d = +0.05 exceeds ONE production Euclid ceiling, so attempt 1 of a 2-attempt request exhausts exactly as today, stays exhausted, and attempt k may use k·C", () => {
    /** SEL with the real certifier; returns the verdict and the piece request. */
    const capture = (distance: number) => {
      const requests: PieceTubeChainRequest[] = [];
      const real = createCertifiedCubicTubeChain();
      const result = certifyDeclaredOffsetChain(
        wrap("wrap-flat4", distance).declared,
        query,
        {
          openRequest: (attempts) => {
            expect(attempts, "a parallel vertex is not flippable").toBe(1);
            const request = real.openRequest(attempts);
            return {
              certifyPieceChain: (item) => {
                requests.push(item);
                return request.certifyPieceChain(item);
              },
            };
          },
        },
      );
      return { result, request: requests[0]! };
    };
    const exhausted = {
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
    };
    // Today (attempts = 1): the 50-leaf wrap needs ≈ 1.73M Euclid > 1.5M.
    const heavy = capture(0.05);
    expect(heavy.result).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("exact-query-proof-budget-exhausted"),
    });
    // Stage 1 of a 2-attempt request behaves exactly like one request.
    const staged = createCertifiedCubicTubeChain().openRequest(2);
    expect(
      staged.certifyPieceChain(heavy.request),
      "attempt 1 capped at 1·C",
    ).toMatchObject(exhausted);
    // Sticky: a cheap second attempt (the 40-leaf d = −0.01 wrap, ≈ 1.04M
    // Euclid, verifies alone) never works after an exhausted attempt.
    const light = capture(-0.01);
    expect(light.result.ok).toBe(true);
    expect(staged.certifyPieceChain(light.request), "sticky").toMatchObject(
      exhausted,
    );
    // Stage k is k·C: two light attempts (≈ 2.08M Euclid cumulative) verify.
    const twice = createCertifiedCubicTubeChain().openRequest(2);
    expect(twice.certifyPieceChain(light.request).kind).toBe("verified");
    expect(twice.certifyPieceChain(light.request).kind, "stage 2 = 2·C").toBe(
      "verified",
    );
  }, 120_000);
});

/**
 * Staged caps inside the SL-tiny vertex stage (T08b-d-evidence/stages:
 * operations [18 450, 150 532], Euclid [4 396, 42 257]); the first sits
 * right after the vertex precharge. Load-bearing swallow killers: keep.
 */
const SL_TINY_STAGED: readonly (readonly [
  "operations" | "euclideanSteps",
  number,
])[] = [
  ["operations", 18_451],
  ["operations", 80_000],
  ["operations", 150_000],
  ["euclideanSteps", 10_000],
  ["euclideanSteps", 40_000],
];
