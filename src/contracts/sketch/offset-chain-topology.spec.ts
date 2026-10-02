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
  type NeutralCurveQueryResult,
  type PieceTubeChainRequest,
  type TubeChainPiece,
  type TubePieceChainResult,
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
import { centerPointArcSketchToolDefinition } from "@/core/sketch-tools/tools/center-point-arc";
import { circleSketchToolDefinition } from "@/core/sketch-tools/tools/circle";
import { rectangleSketchToolDefinition } from "@/core/sketch-tools/tools/rectangle";
import {
  createSketchFilletMutation,
  createSketchOffsetDerivationContribution,
  createSketchSlotContribution,
} from "@/domain/sketch-editing/operations";
import { appendInferredSnapConstraints } from "@/domain/editor/sketch-session/tools";
import {
  createSessionCommitFactories,
  createSketchPointRef,
} from "@/domain/editor/sketch-session/internals";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import {
  canonicalArcSupport,
  seedArcLeafSplits,
} from "@/contracts/sketch/canonical-arc-support";
import { extractDeclaredOffsetChainConnectivity } from "@/contracts/sketch/offset-chain-connectivity";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  ARCH_POINTS,
  CORNER_MATRIX_SOLVE_TOLERANCES,
  POSITIONAL_WRAPS,
  SS_60_OUTGOING,
  convexArcMatrixRows,
  convexArcNativeRows,
  cornerMatrixRows,
  createNativeArcOffsetHarness,
  deepTrimRows,
  createNativeOffsetChainHarness,
  seedArcRows,
  positionalClosureSpline,
  splineLineShallowRows,
  splineSplineCornerRows,
  regularPolygonOutline,
  seedArcCapacityRows,
  uSlotPolygon,
  withLineLength,
  type AcceptedPair,
  type Authored,
  type EndpointSnaps,
  type NativeArcAuthoring,
  type NativeOffsetChainHarness,
  type NativeToolAuthoring,
  type Vector,
} from "@/contracts/sketch/offset-chain.fixtures";
import {
  adoptOffsetChainPlan,
  certifyDeclaredOffsetChain,
  certifyDeclaredOffsetChainWithPolicyForTest,
  certifyOffsetChainTubeStability,
  classifyOffsetChainVertex,
  declaredOffsetChainPieces,
  firstChoiceOffsetChainPlan,
  offsetChainRequiredArcs,
  offsetChainRootEnclosure,
  resolveOffsetChainTopologyForTest,
  type CertifiedNeutralCurveRequestQuery,
  type DeclaredOffsetChainPieces,
  type DeclaredOffsetPieceSource,
  type OffsetChainPiece,
  type OffsetChainTopologyInput,
  type OffsetChainTubeStabilityCertificate,
  type OffsetChainVertex,
} from "@/contracts/sketch/offset-chain-topology";
import {
  OFFSET_DIAGNOSTIC_CODES,
  offsetLinePoints,
  scalePointFromCenter,
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
  const result = resolveOffsetChainTopologyForTest(input);
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
  return result;
}

function failed(input: OffsetChainTopologyInput) {
  const result = resolveOffsetChainTopologyForTest(input);
  if (result.ok) throw new Error("expected the resolver to fail closed");
  return result;
}

const SOURCE_POLES: SplinePoles = [
  [0, 0],
  [1, 0.125],
  [2, 0.125],
  [3, 0],
];

/** Real owner output for one source span; this shape emits one output span. */
function ownerSpans(input: { distance: number; modelingTolerance?: number }) {
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
    poles: SOURCE_POLES,
    validity: "valid",
    differential: { interval: [0, 0], poles: ZERO_POLES },
  };
  const result = approximateSplineOffset({
    spans: [source],
    distance: input.distance,
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
      resolveOffsetChainTopologyForTest(
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
    const resolution = resolveOffsetChainTopologyForTest(input);
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
    expect(resolveOffsetChainTopologyForTest(withRecording).ok).toBe(true);
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
      resolveOffsetChainTopologyForTest(
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

describe("offset chain joint determinant (primal)", () => {
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
    expect(resolveOffsetChainTopologyForTest(input)).toMatchObject({
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
    expect(resolveOffsetChainTopologyForTest(input)).toMatchObject({
      ok: false,
      code: codes.derivativeUnavailable,
      seedEntityId: id("a"),
    });
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
      [],
      { modelingTolerance: 1e-3 },
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
      [],
      { modelingTolerance: 1e-3 },
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
    // SEL (T08b-e [TECH E1]): a convex declared vertex is never queried, so
    // this crossing never becomes a trim there. Its backward gap leaves no
    // admissible arc (rule Z) and the absorption fails on e·g < 0.
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const sizes = recordingRequests();
    expect(
      certifyDeclaredOffsetChain(
        convex.declared,
        sizes.query,
        createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
          snapshots.push(snapshot),
        ),
      ),
    ).toMatchObject({
      ok: false,
      code: codes.splineJointUnsupported,
      message: expect.stringMatching(
        /^The convex declared vertex has no admissible arc .* Absorption not certified: .*backward declared gap \(e·g < 0\)/,
      ),
    });
    expect(sizes.sizes, "no query at a convex vertex").toEqual([0]);
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
        modelingTolerance: 1e-3,
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
        definition: applySolvedSketchToDefinition(definition, snapshot, {
          modelingTolerance: 1e-3,
        }),
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
        [],
        { modelingTolerance: 1e-3 },
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
      [],
      { modelingTolerance: 1e-3 },
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
      [],
      { modelingTolerance: 1e-3 },
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
    // T08b-g5d (U-G6): the root lies on an inner leaf of the terminal source
    // span; Lemma T-W certifies the deep trim (formerly splineJointUnsupported).
    "SL-90 0.5": "verified",
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

  // T08b-g5d review R2 (one-time re-pin, old → new): a cubic-side joint
  // whose terminal source span has more than one leaf is sized for its ring
  // scan, (1 + n_P)(1 + n_Q) joint queries; every other request keeps one per
  // joint (T08b-g5d-evidence/out/sizes-matrix.jsonl).
  const MATRIX_SIZES: Record<string, number> = {
    "SL-90 0.2": 2, // was 1
    "SL-90 -0.2": 2, // was 1
    "SL-90 0.5": 2, // was 1
    "SS-60 0.2": 4, // was 1
    "SL-loop 0.01": 6, // was 2
    "SL-loop -0.01": 6, // was 2
  };

  test("native corner matrix: every row keeps its verdict, S2pt, SS-60 (d > 0) and the Lemma-T band rows now verify, SL-90 d = 0.5 verifies deep (T08b-g5d), and each request is sized structurally", () => {
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
      const size = MATRIX_SIZES[label] ?? joints;
      expect(sizes, label).toEqual([size]);
      expect(pairs.length, label).toBeLessThanOrEqual(size);
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
    ) => ReturnType<typeof resolveOffsetChainTopologyForTest>,
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
        resolveOffsetChainTopologyForTest(
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
        resolveOffsetChainTopologyForTest(
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
      [],
      { modelingTolerance: 1e-3 },
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
    operations: 240_522,
    euclideanSteps: 66_762,
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
    // [42 843, 221 475], Euclid [10 230, 61 708]) and 0.94 inside the Lemma-C
    // glue stage: exhaustion propagates. Load-bearing swallow killers: keep.
    for (const kind of ["operations", "euclideanSteps"] as const)
      for (const fraction of [0.5, 0.85, 0.94])
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
      { operations: 284_523, euclideanSteps: 80_477, integerBits: 838 },
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
      { operations: 89_681, euclideanSteps: 21_970, integerBits: 424 },
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
    "native %s (formerly jointUnsatisfied) verifies as one %s nonparallel vertex, %s, g = 0, no adoption; one query when concave, none when convex (T08b-e E1)",
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
      // T08b-e [TECH E1]: a convex vertex is never queried (U-E absorbs it).
      expect(run.sizes, "queries").toEqual([side === "concave" ? 1 : 0]);
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
    operations: 157_219,
    euclideanSteps: 43_768,
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

  // wrap-near4 1e-3 d = −0.01 certifier literal (40 leaves; Euclid 9.8 % of
  // one cap after the T08b-f0 broad phase, 72 % before): count passes,
  // count − 1 exhausts (operations).
  const WRAP_NEAR_METER = {
    operations: 565_323,
    euclideanSteps: 146_824,
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

  test("positional closure: wrap-near4 1e-3 d = −0.01 (formerly splineJointUnsupported) is absorbed convex with ONE end-adoption re-call and no query (T08b-e E1, U-E)", () => {
    const chain = wrap("wrap-near4 1e-3", -0.01);
    expect(chain.resolution).toMatchObject({
      ok: false,
      code: codes.splineJointUnsupported,
    });
    const run = sel(chain.declared);
    const certificate = verifiedOf(run);
    expect(run.sizes).toEqual([0]);
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
      [],
      { modelingTolerance: 1e-3 },
    );
    if (!solved.solvedSnapshot) throw new Error("not accepted in place");
    return solved as AcceptedPair;
  };
  /** SS-tiny's outgoing spline started off the arch end, then Fix/Fix/Coincident. */
  const ssTinyGap = (offset: Vector, distance: number) =>
    splineGap(
      [
        [2, 0],
        [3, -0.1],
        [4, -0.2],
      ],
      offset,
      distance,
    );
  /** An outgoing spline started off the arch end by `offset`, then Fix/Fix/Coincident. */
  const splineGap = (
    outgoing: readonly Vector[],
    offset: Vector,
    distance: number,
  ) => {
    const harness = harnesses.native;
    harness.resetSequence();
    const first = harness.drawSpline([], ARCH_POINTS);
    const second = harness.drawSpline(
      [first],
      [
        [outgoing[0]![0] + offset[0], outgoing[0]![1] + offset[1]],
        ...outgoing.slice(1),
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

  test("controls: trims keep their verdicts and literals through SEL; C φ = 0.05 d = −0.01 is now absorbed; the former R6 absorption failures SS-60 d = −0.01 and SL-shallow d = 0.01 now take their F1 arc (T08b-e)", () => {
    // SL-loop d = −0.01 (two Lemma-T trims, T08b-c pin): unchanged
    // whole-request certifier literal through SEL (attempts sized 1 + 2).
    const loop = sel(nativeRow("matrix", "SL-loop -0.01").declared);
    verifiedOf(loop);
    expect(meterOf(loop.snapshots.at(-1)!)).toEqual({
      operations: 89_681,
      euclideanSteps: 21_970,
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
    // T08b-e (U-E): G⁺ ≫ τ at SS-60 d = −0.01 and SL-shallow d = 0.01, so the
    // arc comes first: no query, no owner re-call, one attempt. (The R6
    // owner-failure-after-swap row is now the native E2 fallback row.)
    for (const label of ["SS-60 -0.01", "SL-shallow 0.01"]) {
      const run = sel(nativeRow("matrix", label).declared);
      expect(
        verifiedOf(run).joins.map((join) => join.kind),
        label,
      ).toContain("arc-entry");
      expect(run, label).toMatchObject({ sizes: [0], reCalls: 0 });
      expect(run.snapshots, label).toHaveLength(1);
    }
  }, 300_000);

  test("R6 native: C φ = 0.1 d = −0.01 (sub-τ, absorbed first under U-E) fails its absorption and verifies with its F1 arc on attempt 2; the flip at C φ = π/2 d = 0.2 (t ≥ 1, a magnitude failure) is tried and reports the ORIGINAL trim failure", () => {
    const c01 = built("s2", -0.01, (harness) =>
      splineSplineCornerRows()
        .find((item) => `${item.row} ${item.distance}` === "C φ=0.100 0.01")!
        .build(harness),
    );
    const c01Run = sel(c01.declared);
    const c01Certificate = verifiedOf(c01Run);
    expect(vertexJoins(c01Certificate), "not absorbed").toEqual([]);
    expect(
      c01Certificate.joins
        .map((join) => join.kind)
        .filter((kind) => kind.startsWith("arc-")),
    ).toEqual(["arc-entry", "arc-exit"]);
    expect(
      c01Run,
      "absorption (one adoption re-call), then the arc",
    ).toMatchObject({
      sizes: [0],
      reCalls: 1,
    });
    expect(c01Run.snapshots, "two attempts on one staged budget").toHaveLength(
      2,
    );
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

  /**
   * SL-tiny's vertex (a concave step-2(b) candidate at d = +0.01), then a
   * later 165° concave turn onto a short line whose offsets never meet (the
   * query is empty; D < 0, not absorbable), so the later adjacency fails in
   * the resolver. (T08b-e: the former d = −0.01 chain's later corner is
   * convex and now takes its F1 arc, see the T08b-e block.)
   */
  const vertexThenFailChain = (distance = 0.01) =>
    built("matrix", distance, (harness) => {
      const spline = harness.drawSpline([], ARCH_POINTS);
      const line = harness.drawLine([spline], [2, 0], [3, -0.1], {
        start: harness.splineEnds(spline)[1],
      });
      return [
        spline,
        line,
        harness.drawLine([spline, line], [3, -0.1], [2.95, -0.085], {
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
    // R6: at d = +0.01 the tiny vertex is an absorption candidate and the
    // LATER sharp concave corner fails in the resolver; the pre-T08b-d
    // verdict (the tiny vertex's jointUnsatisfied) is kept, the reason
    // appended.
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
    expect(snapshots).toEqual([128, 116_992, 120_223]);
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
      resolveOffsetChainTopologyForTest({
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
    operations: 65_932,
    euclideanSteps: 14_045,
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

  test("R9 staged cap under [TECH] F12 (native, zero queries): wrap-zig34 d = +0.05 needs more than ONE production Euclid ceiling but its 378 leaves give m = 12, so it verifies alone and as attempt 1 of a 2-attempt request (stage 1 = m·C); an exhausted attempt stays sticky; attempt k may use k·m·C", () => {
    /** SEL with the real certifier; returns the verdict and the piece request. */
    const capture = (distance: number) => {
      const requests: PieceTubeChainRequest[] = [];
      const snapshots: ExactProofBudgetSnapshot[] = [];
      const real = createCertifiedCubicTubeChainWithBudgetObserverForTest(
        (snapshot) => snapshots.push(snapshot),
      );
      const result = certifyDeclaredOffsetChain(
        wrap("wrap-zig34", distance).declared,
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
      return { result, request: requests[0]!, snapshots };
    };
    const exhausted = {
      kind: "uncertain",
      code: "exact-query-proof-budget-exhausted",
    };
    // The 378-leaf wrap needs ≈ 2.16M Euclid > 1.5M = C; before F12 it
    // exhausted here. One cubic piece, so a piece-count multiplier is 1.
    const heavy = capture(0.05);
    expect(heavy.request.pieces).toHaveLength(1);
    expect(heavy.snapshots.at(-1)!.euclideanSteps).toBe(2_162_698);
    expect(heavy.result.ok, "m = ⌈378 / 32⌉ = 12").toBe(true);
    // Stage 1 of a 2-attempt request is m·C, not C.
    const staged = createCertifiedCubicTubeChain().openRequest(2);
    expect(
      staged.certifyPieceChain(heavy.request).kind,
      "attempt 1 capped at m·C",
    ).toBe("verified");
    // Sticky, with an absolute lower Euclid limit of one C: attempt 1
    // exhausts, and a cheap second attempt (the 204-leaf d = −0.01 wrap,
    // ≈ 1.09M Euclid, verifies alone) never works after it.
    const light = capture(-0.01);
    expect(light.result.ok).toBe(true);
    const lowered = createCertifiedCubicTubeChainWithLowerBudgetForTest({
      euclideanSteps: 1_500_000,
    }).openRequest(2);
    expect(lowered.certifyPieceChain(heavy.request)).toMatchObject(exhausted);
    expect(lowered.certifyPieceChain(light.request), "sticky").toMatchObject(
      exhausted,
    );
    // Stage k is k·m·C: two light attempts (≈ 2.18M Euclid cumulative) verify.
    const twice = createCertifiedCubicTubeChain().openRequest(2);
    expect(twice.certifyPieceChain(light.request).kind).toBe("verified");
    expect(twice.certifyPieceChain(light.request).kind, "stage 2").toBe(
      "verified",
    );
  }, 120_000);

  describe("T08b-e F1 arcs at convex declared vertices (U2, U-E, [TECH] E1–E9)", () => {
    const convexRows = {
      matrix: cornerMatrixRows,
      s2: splineSplineCornerRows,
      convexMatrix: convexArcMatrixRows,
      convexNative: convexArcNativeRows,
    } as const;
    const harnessOf = {
      matrix: harnesses.matrix,
      s2: harnesses.s2,
      convexMatrix: harnesses.matrix,
      convexNative: harnesses.s2,
    } as const;
    const arcRow = (family: keyof typeof convexRows, label: string) => {
      const row = convexRows[family]().find(
        (item) => `${item.row} ${item.distance}` === label,
      );
      if (!row) throw new Error(`no row ${label}`);
      const harness = harnessOf[family];
      harness.resetSequence();
      return harness.nativeChain(row.build(harness), row.distance);
    };
    /**
     * The published arc [TECH E7]: centre = the declared incoming source
     * vertex P_v, ends = the neighbours' OWN emitted terminal poles of the
     * certified (adopted) pieces, all bitwise; radius = canonicalArcSupport
     * = Math.hypot(A′ − V); and the certificate certifies exactly that.
     */
    const expectCanonicalArcs = (
      declared: DeclaredOffsetChainPieces,
      run: ReturnType<typeof sel>,
    ) => {
      if (!run.result.ok) throw new Error(run.result.message);
      const { resolved: resolution, certificate } = run.result;
      const pieces = resolution.input.pieces;
      const terminalPole = (index: number, exiting: boolean) => {
        const piece = pieces[index]!;
        const naturalEnd = exiting !== piece.reversed;
        if (piece.kind === "lineSegment")
          return naturalEnd ? piece.end : piece.start;
        if (piece.kind !== "derivedCubic") throw new Error("piece kind");
        return naturalEnd
          ? piece.spans.at(-1)!.poles[3]
          : piece.spans[0]!.poles[0];
      };
      const bitwise = (first: Point, second: Point) =>
        Object.is(first[0], second[0]) && Object.is(first[1], second[1]);
      expect(resolution.arcs.length).toBeGreaterThan(0);
      expect(certificate.arcs).toHaveLength(resolution.arcs.length);
      for (const [position, arc] of resolution.arcs.entries()) {
        const vertex = declared.vertices[arc.jointIndex]!;
        const start = terminalPole(arc.jointIndex, true);
        const end = terminalPole((arc.jointIndex + 1) % pieces.length, false);
        expect(bitwise(arc.center, vertex.first.vertex), "centre = P_v").toBe(
          true,
        );
        expect(bitwise(arc.start, start), "start = A′").toBe(true);
        expect(bitwise(arc.end, end), "end = B′").toBe(true);
        expect(
          Object.is(
            arc.radius,
            canonicalArcSupport(
              vertex.first.vertex,
              start,
              end,
              arc.sweepDirection,
            ).radius,
          ),
        ).toBe(true);
        expect(
          Object.is(
            arc.radius,
            Math.hypot(start[0] - arc.center[0], start[1] - arc.center[1]),
          ),
        ).toBe(true);
        const record = certificate.arcs![position]!;
        expect(record).toMatchObject({
          jointIndex: arc.jointIndex,
          center: arc.center,
          radius: arc.radius,
          sweep: arc.sweepDirection,
        });
        for (const value of record.epsilon)
          expect(value).toBeLessThan(TOLERANCE);
      }
      for (const leaf of certificate.leaves)
        expect(leaf.displacementBound).toBeLessThanOrEqual(TOLERANCE);
      return certificate;
    };
    const arcJoins = (certificate: OffsetChainTubeStabilityCertificate) =>
      certificate.joins.filter(
        (join) =>
          join.kind === "arc-entry" ||
          join.kind === "arc-knot" ||
          join.kind === "arc-exit",
      );

    test.each([
      ["matrix", "SL-90 -0.01", [2]],
      ["matrix", "SL-90 -0.2", [2]],
      ["matrix", "LS-90 -0.01", [1]],
      ["convexMatrix", "LS-90 -0.2", [1]],
      ["matrix", "SS-60 -0.01", [1]],
      ["convexMatrix", "SS-60 -0.2", [1]],
      ["matrix", "LL-90 -0.01", [2]],
      ["convexMatrix", "LL-90 -0.2", [2]],
      ["matrix", "SL-loop 0.01", [2, 2]],
      ["matrix", "SL-shallow 0.01", [1]],
      ["s2", "R φ=0.5 0.01", [1]],
    ] as const)(
      "native %s %s (formerly splineJointUnsupported) verifies with its F1 arc(s): no query, the published arc bitwise, sub-arcs %j",
      (family, label, subArcs) => {
        const chain = arcRow(family, label);
        const run = sel(chain.declared);
        const certificate = expectCanonicalArcs(chain.declared, run);
        expect(run.sizes, "a convex vertex is never queried (E1)").toEqual([0]);
        expect(run.reCalls, "no adoption at an arc vertex").toBe(0);
        expect(run.snapshots, "one attempt").toHaveLength(1);
        expect(vertexJoins(certificate)).toEqual([]);
        expect(certificate.arcs!.map((arc) => arc.leaves.length)).toEqual(
          subArcs,
        );
        // G1 at rounding on gap-free joins; reported, never gated (E4).
        for (const join of arcJoins(certificate))
          if ("tangentDeviation" in join)
            expect(join.tangentDeviation).toBeLessThan(1e-12);
        // Arc leaves follow every piece leaf (E3).
        const pieceLeaves = run.result.ok
          ? run.result.resolved.input.pieces.reduce(
              (total, piece) =>
                total +
                (piece.kind === "derivedCubic" ? piece.spans.length : 1),
              0,
            )
          : 0;
        expect(certificate.arcs![0]!.leaves[0]).toBe(pieceLeaves);
      },
      120_000,
    );

    test("U-E: sub-τ convex corners stay absorbed with no query and no arc; LL-phi1e-12 (a 1e-14 arc) is pinned to absorption; C φ = 0.005 absorbs in ONE attempt", () => {
      for (const [family, label] of [
        ["convexNative", "LL-phi1e-12 -0.01"],
        ["convexNative", "C φ=0.005 -0.01"],
        ["matrix", "SL-tiny -0.01"],
      ] as const) {
        const run = sel(arcRow(family, label).declared);
        const certificate = verifiedOf(run);
        expect(certificate.arcs, label).toBeUndefined();
        expect(vertexJoins(certificate), label).toEqual([
          expect.objectContaining({
            kind: "nonparallel-vertex",
            side: "convex",
          }),
        ]);
        expect(run.sizes, label).toEqual([0]);
        expect(run.snapshots, label).toHaveLength(1);
      }
    }, 120_000);

    test("mixed native chain: an absorbed tiny corner, then a sharp F1 arc at the adopting line's OTHER end (SL-tiny then a 165° return, d = −0.01)", () => {
      const chain = vertexThenFailChain(-0.01);
      const run = sel(chain.declared);
      const certificate = expectCanonicalArcs(chain.declared, run);
      expect(run.sizes).toEqual([0]);
      expect(vertexJoins(certificate)).toEqual([
        expect.objectContaining({
          kind: "nonparallel-vertex",
          side: "convex",
          jointIndex: 0,
        }),
      ]);
      expect(certificate.arcs!.map((arc) => arc.jointIndex)).toEqual([1]);
    }, 120_000);

    test("gapped coincident SS-60 (3e-4, 2e-4) d = −0.01 verifies with its arc: the bridge |g|⁺ on the arc exit, the exit kink ≈ |g⊥|/|d| reported (not gated)", () => {
      const chain = splineGap(SS_60_OUTGOING, [3e-4, 2e-4], -0.01);
      const run = sel(chain.declared);
      const certificate = expectCanonicalArcs(chain.declared, run);
      const exit = arcJoins(certificate).find(
        (join) => join.kind === "arc-exit",
      );
      if (exit?.kind !== "arc-exit") throw new Error("exit");
      const g = gapOf(chain);
      expect(exit.bridge).toBeGreaterThanOrEqual(g);
      expect(exit.bridge).toBeLessThan(g * (1 + 1e-12));
      expect(exit.tangentDeviation).toBeGreaterThan(1e-3);
      expect(exit.tangentDeviation).toBeLessThan(0.05);
      expect(certificate.arcs![0]!.exitConnector).toBeGreaterThan(1e-5);
    }, 120_000);

    test("native E2 row (review R6(b)): gap SS-60 (−3e-4, 2e-4) d = −0.01 fails its arc exit cone (e_out·g < 0, tagged), falls back to absorption, whose owner fails after the swap: the ARC failure is reported with the absorption reason", () => {
      const chain = splineGap(SS_60_OUTGOING, [-3e-4, 2e-4], -0.01);
      const requests: PieceTubeChainRequest[] = [];
      const raws: TubePieceChainResult[] = [];
      splineSeamCalls.log = [];
      const result = certifyDeclaredOffsetChain(chain.declared, query, {
        openRequest: (attempts) => {
          expect(attempts, "1 + one switchable convex vertex").toBe(2);
          const request = pieceCertifier.openRequest(attempts);
          return {
            certifyPieceChain: (item) => {
              requests.push(item);
              const raw = request.certifyPieceChain(item);
              raws.push(raw);
              return raw;
            },
          };
        },
      });
      const reCalls = splineSeamCalls.log.filter((call) => call === "owner");
      splineSeamCalls.log = null;
      expect(requests).toHaveLength(1);
      expect(requests[0]!.arcs).toEqual([
        expect.objectContaining({ jointIndex: 0, sweep: "counterClockwise" }),
      ]);
      expect(raws[0]).toMatchObject({
        code: "cubic-tube-cone-unproven",
        arcJoints: [0],
      });
      expect(reCalls, "the fallback adoption and its swap").toHaveLength(2);
      expect(result).toEqual({
        ok: false,
        code: codes.topologyUncertain,
        message:
          "Tube stability is not certified (leaves 4/2): uncertain cubic-tube-cone-unproven: Declared arc 0: backward declared gap at the arc exit (e_out·g < 0). Absorption not certified: owner refinement-budget-exceeded",
        seedEntityId: chain.declared.pieces[0]!.seedEntityId,
      });
    }, 120_000);

    // Verified-after-fallback (review R6(b)): C φ = 0.005 d = −0.01 through the
    // test-only policy seam (arc first, no E8): the arc fails K3 (tagged), the
    // absorption verifies, both on ONE staged budget (count / count − 1).
    const ARC_FIRST = { absorptionFirst: false, shortArcPretest: false };
    const FALLBACK_METER = {
      operations: 122_088,
      euclideanSteps: 29_884,
      integerBits: 432,
    };
    test("verified after fallback (test-only policy, arc first): C φ = 0.005 d = −0.01's arc fails K3 tagged, attempt 2 absorbs and verifies on ONE staged budget; count / count − 1 and staged caps in the retry", () => {
      const declared = arcRow("convexNative", "C φ=0.005 -0.01").declared;
      const raws: TubePieceChainResult[] = [];
      const snapshots: ExactProofBudgetSnapshot[] = [];
      const observed = createCertifiedCubicTubeChainWithBudgetObserverForTest(
        (snapshot) => snapshots.push(snapshot),
      );
      const result = certifyDeclaredOffsetChainWithPolicyForTest(
        declared,
        query,
        {
          openRequest: (attempts) => {
            const request = observed.openRequest(attempts);
            return {
              certifyPieceChain: (item) => {
                const raw = request.certifyPieceChain(item);
                raws.push(raw);
                return raw;
              },
            };
          },
        },
        ARC_FIRST,
      );
      expect(raws.map((raw) => raw.kind)).toEqual(["uncertain", "verified"]);
      expect(raws[0]).toMatchObject({
        code: "cubic-tube-clearance-unproven",
        arcJoints: [0],
      });
      if (!result.ok) throw new Error(result.message);
      expect(vertexJoins(result.certificate)).toEqual([
        expect.objectContaining({ kind: "nonparallel-vertex", side: "convex" }),
      ]);
      expect(meterOf(snapshots.at(-1)!)).toEqual(FALLBACK_METER);
      const under = (limits: Record<string, number>) =>
        certifyDeclaredOffsetChainWithPolicyForTest(
          declared,
          query,
          createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
          ARC_FIRST,
        );
      for (const kind of [
        "operations",
        "euclideanSteps",
        "integerBits",
      ] as const) {
        expect(under({ [kind]: FALLBACK_METER[kind] }).ok, kind).toBe(true);
        expect(under({ [kind]: FALLBACK_METER[kind] - 1 }), kind).toMatchObject(
          {
            ok: false,
            code: codes.topologyUncertain,
            message: expect.stringContaining(
              "exact-query-proof-budget-exhausted",
            ),
          },
        );
      }
      // Staged caps inside the fallback retry: its fixed entry charge, its
      // vertex/composition stage and its K3 (stages/: attempt 1 = 63 943 ops,
      // attempt-2 K3 from 113 079 ops / 27 716 Euclid).
      expect(snapshots[0]!.operations).toBe(63_943);
      for (const [kind, cap] of [
        ["operations", 63_943 + 32],
        ["operations", 90_000],
        ["operations", 117_000],
        ["euclideanSteps", 25_000],
        ["euclideanSteps", 28_500],
      ] as const)
        expect(under({ [kind]: cap }), `${kind} ${cap}`).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
      // Exhaustion inside the arc attempt is reported as itself: never a
      // fallback (the budget is sticky; an absorption reason would append).
      expect(under({ operations: 50_000 })).toEqual({
        ok: false,
        code: codes.topologyUncertain,
        message:
          "Tube stability is not certified: uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.",
        seedEntityId: declared.pieces[0]!.seedEntityId,
      });
      // E8 (exact |A′ − B′| ≤ ε_P + ε_Q): with the pre-test on, the arc
      // attempt is skipped and the absorption verifies in ONE attempt.
      const pretest = recordingRequests();
      const skipped: number[] = [];
      const e8 = certifyDeclaredOffsetChainWithPolicyForTest(
        declared,
        pretest.query,
        createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
          skipped.push(snapshot.operations),
        ),
        { absorptionFirst: false, shortArcPretest: true },
      );
      expect(e8.ok).toBe(true);
      expect(skipped, "E8 skips the arc attempt").toHaveLength(1);
    }, 120_000);

    test("no exhaustion swallow in the arc stage (meter review R1): C φ = 0.005 d = −0.01 under the test-only arc-first policy at integerBits 180 (the arc's Lemma-A ε lifts the bits peak before K3) reports the exact exhaustion, never an untagged K3 failure", () => {
      const declared = arcRow("convexNative", "C φ=0.005 -0.01").declared;
      const requests: PieceTubeChainRequest[] = [];
      certifyDeclaredOffsetChainWithPolicyForTest(
        declared,
        query,
        {
          openRequest: (attempts) => {
            const request = pieceCertifier.openRequest(attempts);
            return {
              certifyPieceChain: (item) => {
                requests.push(item);
                return request.certifyPieceChain(item);
              },
            };
          },
        },
        ARC_FIRST,
      );
      const lowered = () =>
        createCertifiedCubicTubeChainWithLowerBudgetForTest({
          integerBits: 180,
        });
      // Certifier seam: the arc attempt's own request exhausts.
      expect(requests[0]!.arcs).toHaveLength(1);
      expect(lowered().certifyPieceChain(requests[0]!)).toMatchObject({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
      });
      // Through SEL: exhaustion in attempt 1 is final and reported as itself.
      expect(
        certifyDeclaredOffsetChainWithPolicyForTest(
          declared,
          query,
          lowered(),
          ARC_FIRST,
        ),
      ).toEqual({
        ok: false,
        code: codes.topologyUncertain,
        message:
          "Tube stability is not certified: uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.",
        seedEntityId: declared.pieces[0]!.seedEntityId,
      });
    }, 120_000);

    /**
     * Fabricated resolver/certifier input (not owner-reachable): flipChain's
     * concave near-tangent line↔line trim (a genuine Lemma-T magnitude
     * failure, SEL flip), then a 2⁻¹⁰-slope right turn onto a third line
     * whose far end carries an honest 2⁻¹² error: its convex arc is shorter
     * than that line's K3 radius, so it fails K3 tagged and falls back.
     */
    const flipThenArcChain = (): DeclaredOffsetChainPieces => {
      const base = flipChain(5e-6);
      const d = base.distance;
      const a: Point = [1, 1 / 32];
      const b: Point = [2, 2 / 32 - 2 ** -10];
      const offset = offsetLinePoints(a, b, d)!;
      const w = "pw" as SketchPointId;
      const r: OffsetChainPiece = {
        kind: "lineSegment",
        seedEntityId: id("r"),
        reversed: false,
        start: offset.start,
        end: [offset.end[0], offset.end[1] + 2 ** -12],
      };
      const pieces = [...base.pieces, r];
      const q = base.sources[1]!;
      return {
        ...base,
        connectivity: {
          ...base.connectivity,
          pieces: pieces.map(({ seedEntityId, reversed }) => ({
            seedEntityId,
            reversed,
          })),
          joins: [
            ...base.connectivity.joins,
            { kind: "sharedPoint", pointId: w },
          ],
        },
        pieces,
        sources: [
          base.sources[0]!,
          { ...q, endPointId: w } as DeclaredOffsetPieceSource,
          {
            kind: "line",
            source: [a, b],
            distance: d,
            startPointId: w,
            endPointId: "pr" as SketchPointId,
          },
        ],
        vertices: [
          base.vertices[0]!,
          {
            jointIndex: 1,
            authority: { kind: "sharedPoint", pointId: w },
            first: { pointId: w, vertex: a, tangent: [[0, 0], a] },
            second: { pointId: w, vertex: a, tangent: [a, b] },
          },
        ],
      };
    };
    const MIXED_METER = {
      operations: 181_736,
      euclideanSteps: 39_960,
      integerBits: 380,
    };
    test("mixed flip + arc fallback on ONE staged budget (fabricated, test-only arc-first policy): attempt 1 flips the trim, attempt 2's arc fails K3 tagged, attempt 3 absorbs both and verifies; count / count − 1, staged cap in the fallback retry", () => {
      const declared = flipThenArcChain();
      const requests: PieceTubeChainRequest[] = [];
      const raws: TubePieceChainResult[] = [];
      const snapshots: ExactProofBudgetSnapshot[] = [];
      const observed = createCertifiedCubicTubeChainWithBudgetObserverForTest(
        (snapshot) => snapshots.push(snapshot),
      );
      const sizes = recordingRequests();
      const result = certifyDeclaredOffsetChainWithPolicyForTest(
        declared,
        sizes.query,
        {
          openRequest: (attempts) => {
            expect(
              attempts,
              "1 + one flippable trim + one switchable arc",
            ).toBe(3);
            const request = observed.openRequest(attempts);
            return {
              certifyPieceChain: (item) => {
                requests.push(item);
                const raw = request.certifyPieceChain(item);
                raws.push(raw);
                return raw;
              },
            };
          },
        },
        ARC_FIRST,
      );
      expect(sizes.sizes, "the concave joint only").toEqual([1]);
      expect(
        requests.map((request) => [
          request.trims.map((trim) => trim.jointIndex),
          (request.vertices ?? []).map((vertex) => vertex.jointIndex),
          (request.arcs ?? []).map((arc) => arc.jointIndex),
        ]),
      ).toEqual([
        [[0], [], [1]],
        [[], [0], [1]],
        [[], [0, 1], []],
      ]);
      expect(raws[0]).toMatchObject({
        code: "trim-window-unproven",
        magnitude: true,
      });
      expect(raws[0]).not.toHaveProperty("arcJoints");
      expect(raws[1]).toMatchObject({
        code: "cubic-tube-clearance-unproven",
        arcJoints: [1],
      });
      if (!result.ok) throw new Error(result.message);
      expect(
        vertexJoins(result.certificate).map((join) => join.jointIndex),
      ).toEqual([0, 1]);
      expect(meterOf(snapshots.at(-1)!)).toEqual(MIXED_METER);
      const under = (limits: Record<string, number>) =>
        certifyDeclaredOffsetChainWithPolicyForTest(
          flipThenArcChain(),
          query,
          createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
          ARC_FIRST,
        );
      for (const kind of [
        "operations",
        "euclideanSteps",
        "integerBits",
      ] as const) {
        expect(under({ [kind]: MIXED_METER[kind] }).ok, kind).toBe(true);
        expect(under({ [kind]: MIXED_METER[kind] - 1 }), kind).toMatchObject({
          ok: false,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
      }
      // Inside the third attempt's fixed entry charge (sticky afterwards).
      expect(
        under({ operations: snapshots[1]!.operations + 32 }),
      ).toMatchObject({
        ok: false,
        message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      });
    });

    // Native U-slot certifier literal (closed, 8 lines, 19 leaves; K3 is 84 %
    // of its operations; stages/: K3 from 242 649 ops, first arc-wedge split
    // at 1 345 825 ops / 336 171 Euclid).
    const U_SLOT_METER = {
      operations: 1_536_143,
      euclideanSteps: 383_905,
      integerBits: 518,
    };
    test("native closed U-slot (rotated 0.5, d = −0.48): six F1 arcs and two concave trims verify; K3 bisects arc wedges; count / count − 1 on operations and a staged cap inside the first arc split", () => {
      const harness = harnesses.matrix;
      harness.resetSequence();
      const chain = harness.nativeChain(uSlotPolygon(harness, 0.5), -0.48);
      const run = sel(chain.declared);
      const certificate = expectCanonicalArcs(chain.declared, run);
      expect(run.sizes, "the two concave corners only").toEqual([2]);
      expect(run.snapshots).toHaveLength(1);
      expect(
        certificate.joins.filter((join) => join.kind === "trim"),
      ).toHaveLength(2);
      expect(certificate.arcs!.map((arc) => arc.jointIndex)).toEqual([
        0, 1, 2, 5, 6, 7,
      ]);
      // 8 line leaves, then each arc's one or two sub-arcs (a rotated right
      // angle rounds to a·b of either sign, R1 decides exactly).
      expect(certificate.leaves).toHaveLength(
        8 +
          certificate.arcs!.reduce(
            (total, arc) => total + arc.leaves.length,
            0,
          ),
      );
      expect(meterOf(run.snapshots.at(-1)!)).toEqual(U_SLOT_METER);
      // Every arc-wedge split charges a refinement step (meter review A1).
      expect(run.snapshots.at(-1)!.refinementSteps).toBe(45);
      const under = (limit: number) =>
        certifyDeclaredOffsetChain(
          chain.declared,
          query,
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            operations: limit,
          }),
        );
      expect(under(U_SLOT_METER.operations).ok).toBe(true);
      for (const limit of [U_SLOT_METER.operations - 1, 1_345_826])
        expect(under(limit), `operations ${limit}`).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
    }, 120_000);

    // Capacity row (T08b-f0 broad phase): the closed native 24-gon offset
    // outward (24 lines, 24 F1 arcs, 48 leaves, 1 080 K3 pairs) exhausted one
    // Euclid ceiling before (≈ 2.25M, 150 %); it now needs 21 % of it.
    const POLYGON_24_METER = {
      operations: 1_219_935,
      euclideanSteps: 316_937,
      integerBits: 470,
    };
    test("native closed 24-gon offset outward (d = −0.1): 24 F1 arcs verify within one production ceiling; count / count − 1 on operations, Euclid and bits", () => {
      const harness = harnesses.matrix;
      harness.resetSequence();
      const chain = harness.nativeChain(
        uSlotPolygon(harness, 0, regularPolygonOutline(24)),
        -0.1,
      );
      const run = sel(chain.declared);
      const certificate = expectCanonicalArcs(chain.declared, run);
      expect(run.sizes, "no concave corner").toEqual([0]);
      expect(run.snapshots).toHaveLength(1);
      expect(certificate.arcs).toHaveLength(24);
      expect(certificate.leaves).toHaveLength(48);
      expect(certificate.clearedPairs).toHaveLength(1_080);
      expect(meterOf(run.snapshots.at(-1)!)).toEqual(POLYGON_24_METER);
      const under = (limits: Record<string, number>) =>
        certifyDeclaredOffsetChain(
          chain.declared,
          query,
          createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
        );
      for (const kind of [
        "operations",
        "euclideanSteps",
        "integerBits",
      ] as const) {
        expect(under({ [kind]: POLYGON_24_METER[kind] }).ok, kind).toBe(true);
        expect(
          under({ [kind]: POLYGON_24_METER[kind] - 1 }),
          kind,
        ).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
      }
    }, 120_000);

    test("rule Z (T6) under the test-only arc-first policy: SL-tiny d = −0.01's zero-length arc (A′ = B′ bitwise) is never attempted; the vertex is absorbed in ONE attempt", () => {
      const requests: PieceTubeChainRequest[] = [];
      const result = certifyDeclaredOffsetChainWithPolicyForTest(
        nativeRow("matrix", "SL-tiny -0.01").declared,
        query,
        {
          openRequest: (attempts) => {
            expect(attempts, "rule Z: not switchable").toBe(1);
            const request = pieceCertifier.openRequest(attempts);
            return {
              certifyPieceChain: (item) => {
                requests.push(item);
                return request.certifyPieceChain(item);
              },
            };
          },
        },
        ARC_FIRST,
      );
      expect(result.ok).toBe(true);
      expect(requests).toHaveLength(1);
      expect(requests[0]!.arcs).toBeUndefined();
    }, 120_000);

    /** Fabricated LL-90 (D = 0) with a backward coincident gap at the exit. */
    const backwardRightAngle = (): DeclaredOffsetChainPieces => {
      const d = -1 / 64;
      const g: Point = [0, -(2 ** -12)];
      const sources: readonly (readonly [Point, Point])[] = [
        [
          [-1, 0],
          [0, 0],
        ],
        [g, [g[0], g[1] + 1]],
      ];
      const ids = ["pa", "pv", "pw", "pb"] as unknown as SketchPointId[];
      const pieces = sources.map(([start, end], index) => {
        const offset = offsetLinePoints(start, end, d)!;
        return line(`corner${index}`, offset.start, offset.end);
      });
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
            {
              kind: "coincidentConstraint",
              constraintId: "c0" as never,
              pointIds: [ids[1]!, ids[2]!],
            },
          ],
        },
        distance: d,
        modelingTolerance: 2 ** -10,
        pieces,
        sources: sources.map((source, index) => ({
          kind: "line" as const,
          source,
          distance: d,
          startPointId: ids[2 * index]!,
          endPointId: ids[2 * index + 1]!,
        })),
        vertices: [
          {
            jointIndex: 0,
            authority: { kind: "coincident", pointIds: [ids[1]!, ids[2]!] },
            first: { pointId: ids[1]!, vertex: [0, 0], tangent: sources[0]! },
            second: { pointId: ids[2]!, vertex: g, tangent: sources[1]! },
          },
        ],
      };
    };
    test("D ≤ 0 never falls back (fabricated LL-90 with a backward exit gap): the tagged arc failure is final and reported as itself; the request is sized for ONE attempt", () => {
      const declared = backwardRightAngle();
      expect(classifyOffsetChainVertex(declared.vertices[0]!).forward).toBe(
        false,
      );
      const result = certifyDeclaredOffsetChain(declared, query, {
        openRequest: (attempts) => {
          expect(attempts).toBe(1);
          return pieceCertifier.openRequest(attempts);
        },
      });
      expect(result).toEqual({
        ok: false,
        code: codes.topologyUncertain,
        message:
          "Tube stability is not certified (leaves 3/1): uncertain cubic-tube-cone-unproven: Declared arc 0: backward declared gap at the arc exit (e_out·g < 0).",
        seedEntityId: declared.pieces[0]!.seedEntityId,
      });
    });

    test("wrapper binding: a resolved arc must be the declared pieces' canonical arc (radius, centre, ends, sweep bitwise)", () => {
      const chain = nativeRow("matrix", "SL-90 -0.01");
      const run = sel(chain.declared);
      if (!run.result.ok) throw new Error(run.result.message);
      const resolution = run.result.resolved;
      const arc = resolution.arcs[0]!;
      const forge = (patch: Partial<typeof arc>) =>
        certifyOffsetChainTubeStability(
          { ...resolution, arcs: [{ ...arc, ...patch }] },
          {
            certifyPieceChain: () => {
              throw new Error("the certifier must not be reached");
            },
          },
          chain.declared,
        );
      for (const patch of [
        { radius: arc.radius * (1 + 2 ** -52) },
        { center: [arc.center[0] + 2 ** -40, arc.center[1]] as Point },
        { end: arc.start },
        {
          sweepDirection:
            arc.sweepDirection === "clockwise"
              ? ("counterClockwise" as const)
              : ("clockwise" as const),
        },
      ])
        expect(forge(patch), JSON.stringify(patch)).toEqual({
          ok: false,
          code: codes.topologyUncertain,
          message: "A resolved arc is not the declared pieces' canonical arc.",
          seedEntityId: chain.declared.pieces[0]!.seedEntityId,
        });
      // The unforged resolution binds (and reaches the real certifier).
      expect(
        certifyOffsetChainTubeStability(
          resolution,
          pieceCertifier,
          chain.declared,
        ).ok,
      ).toBe(true);
    }, 120_000);

    /**
     * Fabricated open line chain (resolver/certifier input, not
     * owner-reachable): source segments, the declared joins (shared unless
     * listed as coincident) and optional literal emitted ends.
     */
    const fabricatedLines = (
      segments: readonly (readonly [Point, Point])[],
      d: number,
      {
        modelingTolerance = 2 ** -10,
        emitted = {},
        coincident = [],
      }: {
        modelingTolerance?: number;
        emitted?: Readonly<Record<number, readonly [Point, Point]>>;
        coincident?: readonly number[];
      } = {},
    ): DeclaredOffsetChainPieces => {
      const startId = (index: number) =>
        (index > 0 && !coincident.includes(index - 1)
          ? `e${index - 1}`
          : `s${index}`) as SketchPointId;
      const endId = (index: number) => `e${index}` as SketchPointId;
      const pieces = segments.map(([start, end], index) => {
        const offset = offsetLinePoints(start, end, d)!;
        const [from, to] = emitted[index] ?? [offset.start, offset.end];
        return line(`fab${index}`, from, to);
      });
      const joins = segments.slice(1).map((_, index) =>
        coincident.includes(index)
          ? ({
              kind: "coincidentConstraint",
              constraintId: `c${index}` as never,
              pointIds: [endId(index), startId(index + 1)],
            } as const)
          : ({ kind: "sharedPoint", pointId: endId(index) } as const),
      );
      return {
        ok: true,
        connectivity: {
          ok: true,
          closed: false,
          pieces: pieces.map(({ seedEntityId, reversed }) => ({
            seedEntityId,
            reversed,
          })),
          joins,
        },
        distance: d,
        modelingTolerance,
        pieces,
        sources: segments.map((source, index) => ({
          kind: "line" as const,
          source,
          distance: d,
          startPointId: startId(index),
          endPointId: endId(index),
        })),
        vertices: joins.map((join, index) => ({
          jointIndex: index,
          authority:
            join.kind === "sharedPoint"
              ? { kind: "sharedPoint", pointId: join.pointId }
              : { kind: "coincident", pointIds: join.pointIds },
          first: {
            pointId: endId(index),
            vertex: segments[index]![1],
            tangent: segments[index]!,
          },
          second: {
            pointId: startId(index + 1),
            vertex: segments[index + 1]![0],
            tangent: segments[index + 1]!,
          },
        })),
      };
    };
    /** SEL run that records every certifier request and raw result. */
    const recordedSel = (
      declared: DeclaredOffsetChainPieces,
      policy = { absorptionFirst: true, shortArcPretest: true },
    ) => {
      const requests: PieceTubeChainRequest[] = [];
      const raws: TubePieceChainResult[] = [];
      const result = certifyDeclaredOffsetChainWithPolicyForTest(
        declared,
        query,
        {
          openRequest: (attempts) => {
            const request = pieceCertifier.openRequest(attempts);
            return {
              certifyPieceChain: (item) => {
                requests.push(item);
                const raw = request.certifyPieceChain(item);
                raws.push(raw);
                return raw;
              },
            };
          },
        },
        policy,
      );
      const shape = requests.map((request) => ({
        vertices: (request.vertices ?? []).map((vertex) => vertex.jointIndex),
        arcs: (request.arcs ?? []).map((arc) => arc.jointIndex),
      }));
      return { result, requests, raws, shape };
    };

    test("U-E precondition is Lemma G's G⁺ = δ⁺ + |g|⁺ (fabricated): a corner with δ = τ/2 and a coincident gap |g| = 0.6τ takes its arc FIRST (one attempt, never an absorption)", () => {
      const theta = 2 * Math.asin(2 ** -6);
      const g: Point = [0.6 * 2 ** -10, 0];
      const run = recordedSel(
        fabricatedLines(
          [
            [
              [-1, 0],
              [0, 0],
            ],
            [g, [g[0] + Math.cos(theta), g[1] + Math.sin(theta)]],
          ],
          -1 / 64,
          { coincident: [0] },
        ),
      );
      expect(run.result.ok).toBe(true);
      expect(run.shape).toEqual([{ vertices: [], arcs: [0] }]);
    });

    /** The U-E line chain: vertex 1 (≈ 0.06° convex, G⁺ < τ) between two 45°-ish trims. */
    const tightCorner = () =>
      built("matrix", -0.01, (harness) => {
        const a = harness.drawLine([], [-1, -1], [0, 0]);
        const p = harness.drawLine([a], [0, 0], [1, 0], {
          start: harness.lineEnds(a)[1],
        });
        const q = harness.drawLine([a, p], [1, 0], [2, 0.001], {
          start: harness.lineEnds(p)[1],
        });
        return [
          a,
          p,
          q,
          harness.drawLine([a, p, q], [2, 0.001], [2.5, -0.5], {
            start: harness.lineEnds(q)[1],
          }),
        ];
      });
    /**
     * SEL run recording every certifier request (its attempt count) and
     * attempt (request index, shape, verdict), and the resolver's request
     * sizes; `forge` may replace the raw result of one request's attempts.
     */
    /** The rung attempt's charges on `tightCorner` (pinned, see the meter row). */
    const RUNG_METER = { operations: 62_646, euclideanSteps: 14_512 };
    const ladderRun = (
      declared: DeclaredOffsetChainPieces,
      forge?: (
        request: number,
        raw: TubePieceChainResult,
      ) => TubePieceChainResult,
      limits?: Record<string, number>,
      inner?: CertifiedNeutralCurveRequestQuery,
    ) => {
      const { sizes, query: recorded } = recordingRequests(inner);
      const requests: number[] = [];
      const attempts: {
        request: number;
        vertices: number[];
        arcs: number[];
        kind: string;
      }[] = [];
      const result = certifyDeclaredOffsetChain(declared, recorded, {
        openRequest: (count) => {
          const index = requests.length;
          requests.push(count);
          const inner = (
            limits
              ? createCertifiedCubicTubeChainWithLowerBudgetForTest(limits)
              : pieceCertifier
          ).openRequest(count);
          return {
            certifyPieceChain: (item) => {
              const raw = inner.certifyPieceChain(item);
              const final = forge ? forge(index, raw) : raw;
              attempts.push({
                request: index,
                vertices: (item.vertices ?? []).map(
                  (vertex) => vertex.jointIndex,
                ),
                arcs: (item.arcs ?? []).map((arc) => arc.jointIndex),
                kind: final.kind,
              });
              return final;
            },
          };
        },
      });
      return { result, requests, attempts, querySizes: sizes };
    };

    // T08b-g7 P2 (review R7, recorded): before P2 this corner's adoption
    // failed (both line adopters trimmed at their other ends) and U-E took
    // its arc with no attempt spent. The re-query rung now honours U-E's
    // absorption-first rule: the outgoing line adopts the pole, its other-
    // end trim is re-queried on the adopted line (a second resolver request
    // of exactly Σ queryCount = 1), and the composition is certified on its
    // own one-attempt request; today's staged request (sized as before)
    // issues nothing.
    test("U-E + T08b-g7 P2 (R7 verdict change): an absorption-first corner whose adopters are both trimmed at their other ends now absorbs on the re-query rung (its own query request of Σ queryCount, its own one-attempt certifier request); before P2 it took its arc (native)", () => {
      const run = ladderRun(tightCorner().declared);
      if (!run.result.ok) throw new Error(run.result.message);
      expect(run.attempts).toEqual([
        { request: 1, vertices: [1], arcs: [], kind: "verified" },
      ]);
      // Today's staged request: 1 + 2 flippable trims + 1 switchable corner.
      expect(run.requests).toEqual([4, 1]);
      expect(run.querySizes).toEqual([2, 1]);
      expect(
        run.result.certificate.joins.filter((join) => join.kind === "trim"),
      ).toHaveLength(2);
      expect(run.result.resolved.vertices).toMatchObject([
        { jointIndex: 1, kind: "absorbed", keeper: "first" },
      ]);
      expect(run.result.resolved.arcs).toHaveLength(0);
    }, 120_000);

    test("T08b-g7 P2 meter (review R5/R6): the rung's own attempt is pinned count / count − 1 on operations and Euclid; a cap inside it exhausts the rung only: the vertex returns to today's ladder, whose arc attempt then runs under the same cap and reports its own exhaustion", () => {
      const declared = tightCorner().declared;
      const snapshots: ExactProofBudgetSnapshot[] = [];
      const observed = certifyDeclaredOffsetChain(
        declared,
        query,
        createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
          snapshots.push(snapshot),
        ),
      );
      expect(observed.ok).toBe(true);
      expect(snapshots).toHaveLength(1);
      const rung = snapshots[0]!;
      expect({
        operations: rung.operations,
        euclideanSteps: rung.euclideanSteps,
      }).toEqual(RUNG_METER);
      const under = (limits: Record<string, number>) =>
        ladderRun(declared, undefined, limits);
      for (const kind of ["operations", "euclideanSteps"] as const) {
        const exact = under({ [kind]: RUNG_METER[kind] });
        expect(exact.attempts, kind).toEqual([
          { request: 1, vertices: [1], arcs: [], kind: "verified" },
        ]);
        // The rung's exhaustion is not the verdict: today's ladder runs (its
        // arc attempt, on today's staged request) under the same absolute
        // cap, and exhausts there as itself (today's verdict at that cap).
        const capped = under({ [kind]: RUNG_METER[kind] - 1 });
        expect(capped.attempts, kind).toEqual([
          { request: 1, vertices: [1], arcs: [], kind: "uncertain" },
          { request: 0, vertices: [], arcs: [1], kind: "uncertain" },
        ]);
        expect(capped.result, kind).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
      }
    }, 120_000);

    test("T08b-g7 P2 review R4 (fabricated rung failure): when the re-query composition fails its certificate at leaves NOT incident to the vertex (trim 2's, a magnitude code), the vertex returns to today's ladder exactly: U-E takes its arc on today's staged request and the verdict is today's", () => {
      const declared = tightCorner().declared;
      const run = ladderRun(declared, (request, raw) =>
        request === 1
          ? {
              kind: "uncertain",
              code: "trim-window-unproven",
              message: "forged rung failure at trim 2's leaves",
              magnitude: true,
              first: 2,
              second: 3,
            }
          : raw,
      );
      if (!run.result.ok) throw new Error(run.result.message);
      expect(run.attempts).toEqual([
        { request: 1, vertices: [1], arcs: [], kind: "uncertain" },
        { request: 0, vertices: [], arcs: [1], kind: "verified" },
      ]);
      expect(run.requests).toEqual([4, 1]);
      expect(run.result.resolved.arcs.map((arc) => arc.jointIndex)).toEqual([
        1,
      ]);
      expect(
        run.result.certificate.joins.filter((join) => join.kind === "trim"),
      ).toHaveLength(2);
    }, 120_000);

    /**
     * T08b-g7a review R-3 / A1: the real query, except its second request
     * (the rung's re-query on `tightCorner`, sized 1) under `limits`, or
     * observed (each snapshot is that request's running total).
     */
    const requeryUnder = (
      limits?: Record<string, number>,
      observe?: (snapshot: ExactProofBudgetSnapshot) => void,
    ): CertifiedNeutralCurveRequestQuery => {
      let opened = 0;
      return {
        openRequest: (count) =>
          (opened++ !== 1
            ? query
            : limits
              ? createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest(
                  limits,
                )
              : createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
                  observe!,
                )
          ).openRequest(count),
      };
    };
    /** The rung's re-query request on `tightCorner` (pinned, observer). */
    const REQUERY_METER = { operations: 4_964, euclideanSteps: 1_130 };

    test("T08b-g7a review R-3 (meter): the rung's re-query request is pinned count / count − 1 on operations and Euclid; a cap inside it closes the rung before its certificate, and the vertex goes down today's ladder exactly (U-E's arc on today's staged request, today's verdict)", () => {
      const declared = tightCorner().declared;
      const snapshots: ExactProofBudgetSnapshot[] = [];
      expect(
        certifyDeclaredOffsetChain(
          declared,
          requeryUnder(undefined, (snapshot) => snapshots.push(snapshot)),
          pieceCertifier,
        ).ok,
      ).toBe(true);
      expect({
        operations: snapshots.at(-1)!.operations,
        euclideanSteps: snapshots.at(-1)!.euclideanSteps,
      }).toEqual(REQUERY_METER);
      for (const kind of ["operations", "euclideanSteps"] as const) {
        const exact = ladderRun(
          declared,
          undefined,
          undefined,
          requeryUnder({ [kind]: REQUERY_METER[kind] }),
        );
        expect(exact.attempts, kind).toEqual([
          { request: 1, vertices: [1], arcs: [], kind: "verified" },
        ]);
        expect(exact.querySizes, kind).toEqual([2, 1]);
        // count − 1: the re-query exhausts, so the rung closes before its
        // one-attempt request is opened; today's ladder then takes U-E's
        // arc on today's staged request (sized as before) and verifies.
        const capped = ladderRun(
          declared,
          undefined,
          undefined,
          requeryUnder({ [kind]: REQUERY_METER[kind] - 1 }),
        );
        if (!capped.result.ok) throw new Error(capped.result.message);
        expect(capped.attempts, kind).toEqual([
          { request: 0, vertices: [], arcs: [1], kind: "verified" },
        ]);
        expect(capped.requests, kind).toEqual([4]);
        expect(capped.querySizes, kind).toEqual([2, 1]);
      }
    }, 120_000);

    test("T08b-g7a review A1: a rung that ran out of its own budget never hides that: when today's ladder then fails with another code, that code stands and the rung's exhaustion is appended (a cap inside the re-query, and inside the rung's own attempt); with no rung exhaustion the message is today's alone", () => {
      const declared = tightCorner().declared;
      const FORGED = "forged failure of today's arc attempt at trim 2's leaves";
      /** A non-verified SEL verdict's message (today's code throughout). */
      const messageOf = (
        result: ReturnType<typeof certifyDeclaredOffsetChain>,
      ) => {
        if (result.ok) throw new Error("unexpectedly verified");
        expect(result.code).toBe(codes.topologyUncertain);
        return result.message;
      };
      /** Today's staged request (request 0) fails, not magnitude-tagged. */
      const forgeToday = (request: number, raw: TubePieceChainResult) =>
        request === 0
          ? ({
              kind: "uncertain",
              code: "trim-window-unproven",
              message: FORGED,
              first: 2,
              second: 3,
            } as const)
          : raw;
      // Control: the rung's certificate forged to fail (R4): today's
      // failure is reported with no rung note.
      const plain = ladderRun(declared, (request, raw) =>
        request === 1
          ? {
              kind: "uncertain",
              code: "trim-window-unproven",
              message: "forged rung failure",
              first: 2,
              second: 3,
            }
          : forgeToday(request, raw),
      );
      expect(messageOf(plain.result)).toContain(FORGED);
      expect(messageOf(plain.result)).not.toContain("re-query rung");
      // The re-query exhausts: today's code, the re-query's exhaustion named.
      const requery = ladderRun(
        declared,
        forgeToday,
        undefined,
        requeryUnder({ operations: REQUERY_METER.operations - 1 }),
      );
      expect(requery.attempts).toEqual([
        { request: 0, vertices: [], arcs: [1], kind: "uncertain" },
      ]);
      expect(messageOf(requery.result)).toMatch(
        new RegExp(
          `${FORGED}.*\\(The re-query rung was not decided first: Joint re-query after adoption is not verified \\(uncertain exact-query-proof-budget-exhausted`,
        ),
      );
      // The rung's own attempt exhausts at its count − 1. (No cap lies
      // between the rung's attempt and today's arc attempt here: the arc
      // attempt costs more, 68 740 ops, so its result is forged.) Today's
      // code, the attempt's exhaustion named.
      const attempt = ladderRun(declared, forgeToday, {
        operations: RUNG_METER.operations - 1,
      });
      expect(attempt.attempts).toEqual([
        { request: 1, vertices: [1], arcs: [], kind: "uncertain" },
        { request: 0, vertices: [], arcs: [1], kind: "uncertain" },
      ]);
      expect(messageOf(attempt.result)).toMatch(
        new RegExp(
          `${FORGED}.*\\(The re-query rung was not decided first: its one-attempt certifier request is not verified \\(uncertain exact-query-proof-budget-exhausted`,
        ),
      );
    }, 120_000);

    test("T08b-g7a review A3: splines stay off the re-query rung: `tightCorner` with its middle lines drawn as one-source-span (2-point) splines, both trimmed at their other ends, has no rung adopter (the frame's adoption fails there as today) and the SEL opens no re-query and no rung request (native)", () => {
      const chain = built("native", -0.01, (harness) => {
        const a = harness.drawLine([], [-1, -1], [0, 0]);
        const p = harness.drawSpline(
          [a],
          [
            [0, 0],
            [1, 0],
          ],
          { start: harness.lineEnds(a)[1] },
        );
        const q = harness.drawSpline(
          [a, p],
          [
            [1, 0],
            [2, 0.001],
          ],
          { start: harness.splineEnds(p)[1] },
        );
        return [
          a,
          p,
          q,
          harness.drawLine([a, p, q], [2, 0.001], [2.5, -0.5], {
            start: harness.splineEnds(q)[1],
          }),
        ];
      });
      const { declared } = chain;
      expect(
        declared.sources.map((source) =>
          source.kind === "spline" ? source.sourceSpans.length : 0,
        ),
      ).toEqual([0, 1, 1, 0]);
      const choices = firstChoiceOffsetChainPlan(declared);
      if ("ok" in choices) throw new Error(choices.message);
      expect(choices.map((choice) => choice.kind)).toEqual([
        "trim",
        "absorbed",
        "trim",
      ]);
      expect(adoptOffsetChainPlan(declared, choices)).toEqual({
        ok: false,
        jointIndex: 1,
        reason: "absorbed vertex adopter is trimmed at its other end",
      });
      // Today's verdict: U-E takes the corner's arc on today's staged
      // request; nothing is re-queried and no rung request is opened.
      const run = ladderRun(declared);
      if (!run.result.ok) throw new Error(run.result.message);
      expect(run.querySizes).toHaveLength(1);
      expect(run.requests).toHaveLength(1);
      expect(run.attempts).toEqual([
        { request: 0, vertices: [], arcs: [1], kind: "verified" },
      ]);
    }, 120_000);

    test("a one-leaf spline piece at an F1 arc end is admitted (the arc-entry cone checks its whole emitted leaf; native 2-point spline → line at 90°)", () => {
      const chain = built("native", -0.01, (harness) => {
        const spline = harness.drawSpline(
          [],
          [
            [0, 0],
            [1, 0],
          ],
        );
        return [
          spline,
          harness.drawLine([spline], [1, 0], [1, 1], {
            start: harness.splineEnds(spline)[1],
          }),
        ];
      });
      expect(
        chain.declared.pieces.map((piece) =>
          piece.kind === "derivedCubic" ? piece.spans.length : 0,
        ),
      ).toEqual([1, 0]);
      const certificate = expectCanonicalArcs(
        chain.declared,
        sel(chain.declared),
      );
      expect(certificate.arcs!.map((arc) => arc.jointIndex)).toEqual([0]);
    }, 120_000);

    test("R6 precedence: an absorption-first corner that fails its absorption AND its arc reports the ARC failure with the absorption's reason (fabricated)", () => {
      // δ = 0.3τ (U-E fits), but P's emitted end is 0.8τ off its true offset
      // along the normal: absorption needs 0.8τ + G⁺ < τ; the arc's Lemma-A
      // entry error is ≥ π_A + δ_a > τ.
      const tau = 2 ** -10;
      const d = -1 / 64;
      const theta = 2 * Math.asin((0.3 * tau) / (2 / 64));
      const run = recordedSel(
        fabricatedLines(
          [
            [
              [-1, 0],
              [0, 0],
            ],
            [
              [0, 0],
              [Math.cos(theta), Math.sin(theta)],
            ],
          ],
          d,
          {
            emitted: {
              0: [
                [-1, d],
                [0, d - 0.8 * tau],
              ],
            },
          },
        ),
      );
      expect(run.shape).toEqual([
        { vertices: [0], arcs: [] },
        { vertices: [], arcs: [0] },
      ]);
      expect(run.raws[1]).toMatchObject({ arcJoints: [0] });
      expect(run.result).toMatchObject({
        ok: false,
        message: expect.stringMatching(
          /^Tube stability is not certified .*Declared arc 0: .* Absorption not certified: cubic-tube-knot-incidence-unproven: Leaf 0: /,
        ),
      });
    });

    test("U-E incidence: an absorption-first corner takes its arc only for a failure at ITS terminal leaves; a failed D ≤ 0 arc further on is final after one attempt (fabricated)", () => {
      const q: readonly [Point, Point] = [
        [0, 0],
        [1, 0.001],
      ];
      const g: Point = [q[1][0], q[1][1] - 2 ** -12];
      const run = recordedSel(
        fabricatedLines(
          [
            [
              [-1, 0],
              [0, 0],
            ],
            q,
            [g, [g[0] - 0.001, g[1] + 1]],
          ],
          -1 / 64,
          { coincident: [1] },
        ),
      );
      expect(run.shape).toEqual([{ vertices: [0], arcs: [1] }]);
      expect(run.result).toMatchObject({
        ok: false,
        message: expect.stringContaining(
          "Declared arc 1: backward declared gap at the arc exit (e_out·g < 0).",
        ),
      });
    });

    test("the lowest tagged arc falls back first (fabricated, test-only arc-first policy): two arcs around a 2⁻¹⁹ line with honest 2⁻¹⁹ end errors fail K3 together, tagged [0, 1]; attempt 2 absorbs vertex 0 only", () => {
      const tiny = 2 ** -19;
      const turn = (angle: number): Point => [Math.cos(angle), Math.sin(angle)];
      const middle: readonly [Point, Point] = [
        [0, 0],
        [tiny * turn(0.5)[0], tiny * turn(0.5)[1]],
      ];
      const d = -1 / 64;
      const offset = offsetLinePoints(middle[0], middle[1], d)!;
      const normal = turn(0.5 + Math.PI / 2);
      const run = recordedSel(
        fabricatedLines(
          [
            [
              [-Math.cos(0), 0],
              [0, 0],
            ],
            middle,
            [middle[1], [middle[1][0] + turn(1)[0], middle[1][1] + turn(1)[1]]],
          ],
          d,
          {
            emitted: {
              1: [
                [
                  offset.start[0] + tiny * normal[0],
                  offset.start[1] + tiny * normal[1],
                ],
                [
                  offset.end[0] + tiny * normal[0],
                  offset.end[1] + tiny * normal[1],
                ],
              ],
            },
          },
        ),
        ARC_FIRST,
      );
      expect(run.raws[0]).toMatchObject({
        code: "cubic-tube-clearance-unproven",
        arcJoints: [0, 1],
      });
      expect(run.shape.slice(0, 2)).toEqual([
        { vertices: [], arcs: [0, 1] },
        { vertices: [0], arcs: [1] },
      ]);
    });

    /** SEL through a scripted certifier port: `respond` sees each request's shape. */
    const scriptedSel = (
      declared: DeclaredOffsetChainPieces,
      expectedAttempts: number,
      respond: (
        item: PieceTubeChainRequest,
        attempt: number,
      ) => TubePieceChainResult,
    ) => {
      const shape: { vertices: number[]; arcs: number[] }[] = [];
      const result = certifyDeclaredOffsetChain(declared, query, {
        openRequest: (attempts) => {
          expect(attempts).toBe(expectedAttempts);
          return {
            certifyPieceChain: (item) => {
              shape.push({
                vertices: (item.vertices ?? []).map((v) => v.jointIndex),
                arcs: (item.arcs ?? []).map((arc) => arc.jointIndex),
              });
              return respond(item, shape.length);
            },
          };
        },
      });
      return { result, shape };
    };
    const scripted = (
      message: string,
      extra: { first?: number; arcJoints?: number[] } = {},
    ): TubePieceChainResult => ({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
      message,
      ...extra,
    });

    test("U-E `fits` is strict (meter review A3): at the exact tie G = δ = τ (fabricated LL corner, cos = 161/289, |d| = 17τ/16, g = 0) the corner takes its arc FIRST; one step inside the tie it is absorbed first", () => {
      const corner = (d: number) =>
        fabricatedLines(
          [
            [
              [-1, 0],
              [0, 0],
            ],
            [
              [0, 0],
              [161 / 256, 240 / 256],
            ],
          ],
          d,
        );
      // δ = |d|·|N₁ − N₂| = |d|·√(2·128/289) = 16|d|/17 = τ exactly.
      const tie = recordedSel(corner(-17 * 2 ** -14));
      expect(tie.result.ok).toBe(true);
      expect(tie.shape).toEqual([{ vertices: [], arcs: [0] }]);
      const inside = recordedSel(corner(-17 * 2 ** -14 * (1 - 2 ** -40)));
      expect(inside.shape[0]).toEqual({ vertices: [0], arcs: [] });
    });

    test("E8 never re-routes an arc whose absorption was already tried (meter review A3; scripted certifier port rejecting every absorption at its terminal leaves): C φ = 0.005 d = −0.01 absorbs, then takes its E8-short arc once; the arc's K3 failure is final with the absorption reason", () => {
      const declared = arcRow("convexNative", "C φ=0.005 -0.01").declared;
      const leavesOf = (piece: TubeChainPiece) =>
        piece.kind === "cubic" ? piece.tubes.length : 1;
      const run = scriptedSel(declared, 2, (item) => {
        if ((item.arcs ?? []).length > 0)
          return pieceCertifier.certifyPieceChain(item);
        const p = item.pieces[0]!;
        return scripted("absorption rejected by the scripted port.", {
          first: p.reversed ? 0 : leavesOf(p) - 1,
        });
      });
      expect(run.shape).toEqual([
        { vertices: [0], arcs: [] },
        { vertices: [], arcs: [0] },
      ]);
      expect(run.result).toMatchObject({
        ok: false,
        code: codes.topologyClearanceUnproven,
        message:
          "Tube stability is not certified (leaves 1/2): uncertain cubic-tube-clearance-unproven: Certified error tubes overlap; true-offset separation not proved. Absorption not certified: cubic-tube-clearance-unproven: absorption rejected by the scripted port.",
      });
    }, 120_000);

    test("final precedence names the vertex whose leaves failed (math review A4; scripted certifier port): after both arcs fell back, a failure at vertex 1's leaves reports vertex 1's arc failure, not vertex 0's", () => {
      const turn = (angle: number): Point => [Math.cos(angle), Math.sin(angle)];
      const q = turn(Math.PI / 3);
      const r: Point = [
        q[0] + turn((2 * Math.PI) / 3)[0],
        q[1] + turn((2 * Math.PI) / 3)[1],
      ];
      const run = scriptedSel(
        fabricatedLines(
          [
            [
              [-1, 0],
              [0, 0],
            ],
            [[0, 0], q],
            [q, r],
          ],
          -1 / 64,
        ),
        3,
        (_item, attempt) =>
          attempt === 1
            ? scripted("attempt 1 (scripted).", { arcJoints: [0, 1] })
            : attempt === 2
              ? scripted("attempt 2 (scripted).", { arcJoints: [1] })
              : scripted("attempt 3 (scripted).", { first: 2 }),
      );
      expect(run.shape).toEqual([
        { vertices: [], arcs: [0, 1] },
        { vertices: [0], arcs: [1] },
        { vertices: [0, 1], arcs: [] },
      ]);
      expect(run.result).toMatchObject({
        ok: false,
        code: codes.topologyClearanceUnproven,
        message:
          "Tube stability is not certified: uncertain cubic-tube-clearance-unproven: attempt 2 (scripted). Absorption not certified: cubic-tube-clearance-unproven: attempt 3 (scripted).",
      });
    });

    test("R8 fabricated K3 adversary (native U-slot request, radius forged): the arc's radial connector end A′ is the ONLY part within the K3 radius of the far wall, so the pair stays unproven after the wedge is bisected", () => {
      const harness = harnesses.matrix;
      harness.resetSequence();
      const chain = harness.nativeChain(
        uSlotPolygon(harness, 0, [
          [0, 0],
          [3, 0],
          [3, 2],
          [2, 2],
          [2, 1],
          [1, 1],
          [1, 5 / 3],
          [0.95, 2],
          [0, 2],
        ]),
        -0.48,
      );
      const requests: PieceTubeChainRequest[] = [];
      const native = certifyDeclaredOffsetChain(chain.declared, query, {
        openRequest: (attempts) => {
          const request = pieceCertifier.openRequest(attempts);
          return {
            certifyPieceChain: (item) => {
              requests.push(item);
              return request.certifyPieceChain(item);
            },
          };
        },
      });
      expect(native.ok, "the native chain verifies").toBe(true);
      const request = requests[0]!;
      // Joint 5: the slight convex corner at (1, 5/3) facing the right wall
      // (x = 1.52) across the slot. ρ = 0.46 < |a| = 0.48 puts Ĉ 0.06 from
      // the wall and the connector end A′ 0.04 from it; the leaf's radius
      // ε ≥ u_A ≈ 0.041 (τ := 1/16 for the forged row).
      const forged: PieceTubeChainRequest = {
        ...request,
        modelingTolerance: 1 / 16,
        arcs: request.arcs!.map((arc) =>
          arc.jointIndex === 5 ? { ...arc, radius: 0.46 } : arc,
        ),
      };
      expect(pieceCertifier.certifyPieceChain(forged)).toMatchObject({
        kind: "uncertain",
        code: "cubic-tube-clearance-unproven",
        first: 3,
        second: 15,
        arcJoints: [5],
      });
    }, 120_000);

    // Native certifier literals through SEL (measured on this implementation;
    // stage map in T08b-e-evidence/stages/).
    const SL_90_METER = {
      operations: 46_417,
      euclideanSteps: 10_355,
      integerBits: 309,
    };
    const LL_90_METER = {
      operations: 25_754,
      euclideanSteps: 4_429,
      integerBits: 329,
    };
    test.each([
      ["matrix", "SL-90 -0.01", SL_90_METER],
      ["matrix", "LL-90 -0.01", LL_90_METER],
    ] as const)(
      "native %s %s certifier literal through SEL: count passes, count − 1 exhausts on operations, Euclid and bits",
      (family, label, meter) => {
        const declared = arcRow(family, label).declared;
        const run = sel(declared);
        verifiedOf(run);
        expect(meterOf(run.snapshots.at(-1)!)).toEqual(meter);
        for (const kind of [
          "operations",
          "euclideanSteps",
          "integerBits",
        ] as const) {
          const under = (limit: number) =>
            certifyDeclaredOffsetChain(
              declared,
              query,
              createCertifiedCubicTubeChainWithLowerBudgetForTest({
                [kind]: limit,
              }),
            );
          expect(under(meter[kind]).ok, kind).toBe(true);
          expect(under(meter[kind] - 1), kind).toMatchObject({
            ok: false,
            code: codes.topologyUncertain,
            message: expect.stringContaining(
              "exact-query-proof-budget-exhausted",
            ),
          });
        }
      },
      120_000,
    );

    test("native SL-90 d = −0.01: staged caps inside the arc stages (precharge/authority, admission, ε, K1, records) exhaust as themselves", () => {
      const declared = arcRow("matrix", "SL-90 -0.01").declared;
      // Stage map (stages/): arc precharged 12 591 ops → admitted 16 855 →
      // ε 20 918 → cones 23 479 → records 25 740 → K3 27 262 … 45 049;
      // Euclid admitted 3 532 → ε 4 486 → cones 5 066.
      for (const [kind, cap] of [
        ["operations", 12_592],
        ["operations", 15_000],
        ["operations", 19_000],
        ["operations", 22_000],
        ["operations", 24_500],
        ["operations", 40_000],
        ["euclideanSteps", 3_000],
        ["euclideanSteps", 4_000],
        ["euclideanSteps", 4_800],
      ] as const)
        expect(
          certifyDeclaredOffsetChain(
            declared,
            query,
            createCertifiedCubicTubeChainWithLowerBudgetForTest({
              [kind]: cap,
            }),
          ),
          `${kind} ${cap}`,
        ).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
    }, 120_000);
  });
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

/**
 * [TECH] G13: the legacy offset's verdict on every `seedArcRows()` row
 * (`${row} ${distance}`), captured from `computeOffsetChain` at `7b524c28`
 * before T08b-g6 deleted it. Legacy drew the other 114 rows.
 */
const LEGACY_D3_ROW_COUNT = 120;
const LEGACY_D3_ARC_COLLAPSES: ReadonlySet<string> = new Set([
  "rounded rect 0.25",
  "rounded rect rotated 0.3 0.25",
  "circle 1.5",
  "line-arc-line semicircle 0.6",
  "line-arc-line cap 0.8",
  "quarter arc 1.2",
]);

/**
 * The T08b-f native arc authoring seam: the line, centre-point arc, spline,
 * circle and rectangle tools with the session's endpoint-snap inference, the
 * Fillet and Slot edit operations, constraint tool commits on entities and
 * the native Offset tool's relationship contribution (review R8).
 */
function createNativeArcAuthoring(sketchId: string): NativeArcAuthoring {
  const factoriesOf = (sequence: number) =>
    createSessionCommitFactories(sequence, sketchId as never);
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
    activeTool: "line" | "spline" | "centerPointArc",
    patch: Authored,
    sequence: number,
    start: Vector,
    end: Vector,
    snaps: EndpointSnaps,
  ) =>
    appendInferredSnapConstraints({
      previousDefinition,
      patch: patch as never,
      activeTool: activeTool as never,
      startSnap: snaps.start ? endpointSnap(snaps.start, start) : null,
      endSnap: snaps.end ? endpointSnap(snaps.end, end) : null,
      sequence,
      createConstraintId: (name: string) =>
        `constraint_${sequence}_${name}` as never,
    }) as Authored;
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
          factories: factoriesOf(sequence),
        }) as Authored,
        sequence,
        start,
        end,
        snaps,
      ),
    arc: ({ previousDefinition, sequence, center, start, end, snaps }) =>
      infer(
        previousDefinition,
        "centerPointArc",
        centerPointArcSketchToolDefinition.createCommitContribution({
          sequence,
          points: [center, start, end],
          isConstruction: false,
          factories: factoriesOf(sequence),
        } as never) as Authored,
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
          factories: factoriesOf(sequence),
        }) as Authored,
        sequence,
        points[0]!,
        points.at(-1)!,
        snaps,
      ),
    circle: ({ sequence, center, rim }) =>
      circleSketchToolDefinition.createCommitContribution({
        sequence,
        start: center,
        end: rim,
        isConstruction: false,
        factories: factoriesOf(sequence),
      } as never) as Authored,
    rectangle: ({ sequence, start, end }) =>
      rectangleSketchToolDefinition.createCommitContribution({
        sequence,
        start,
        end,
        isConstruction: false,
        factories: factoriesOf(sequence),
      } as never) as Authored,
    fillet: ({ definition, sequence, entityIds, radius }) => {
      const result = createSketchFilletMutation({
        definition,
        entityIds,
        radius,
        sequence,
        factories: factoriesOf(sequence),
      } as never);
      if (!result.valid || !result.definition)
        throw new Error(`fillet: ${result.message}`);
      return result.definition;
    },
    slot: ({ definition, sequence, lineId, width }) => {
      const result = createSketchSlotContribution({
        definition,
        entityIds: [lineId],
        width,
        sequence,
        factories: factoriesOf(sequence),
      } as never);
      if (!result.valid || !result.contribution)
        throw new Error(`slot: ${result.message}`);
      return result.contribution as Authored;
    },
    constraint: ({ definition, sequence, toolId, entityIds }) => {
      const tool = toolId as SketchConstraintToolId;
      const contribution = getSketchConstraintDefinition(
        tool,
      ).createCommitContribution({
        sequence,
        selectedTargets: entityIds.map((entityId) => {
          const record = resolveSketchConstraintTarget(tool, definition, {
            kind: "sketchEntity",
            sketchId: sketchId as SketchId,
            entityId,
          });
          if (!record) throw new Error(`${toolId} rejected ${entityId}`);
          return record;
        }),
        pointer: null,
        value: null,
        annotationPlacement: null,
        createConstraintId: (suffix) =>
          `constraint_${sequence}_${suffix}` as const,
        createDimensionId: (suffix) =>
          `dimension_${sequence}_${suffix}` as const,
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
    },
    offset: ({ definition, sequence, entityIds, distance }) => {
      const result = createSketchOffsetDerivationContribution({
        definition,
        entityIds,
        distance: Math.abs(distance),
        side: distance >= 0 ? "left" : "right",
        sequence,
        factories: factoriesOf(sequence),
        modelingTolerance: 1e-3,
      } as never);
      return result.valid && result.contribution
        ? (result.contribution as never)
        : null;
    },
  };
}

describe("T08b-f seed arcs: native line/arc chains through the SEL (Offset relationship, real query, owner and certifier)", () => {
  const harness = createNativeArcOffsetHarness({
    authoring: createNativeArcAuthoring("sketch_t08bf"),
    modelingTolerance: 1e-3,
    solveTolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
  });
  const rows = seedArcRows();
  const rowOf = (label: string) => {
    const row = rows.find((item) => `${item.row} ${item.distance}` === label);
    if (!row) throw new Error(`no row ${label}`);
    return row;
  };
  const built = new Map<string, ReturnType<NativeArcOffsetHarnessAdapt>>();
  type NativeArcOffsetHarnessAdapt = typeof harness.adapt;
  const adapted = (label: string) => {
    const cached = built.get(label);
    if (cached) return cached;
    const row = rowOf(label);
    const result = harness.adapt(row.build(harness), row.distance);
    built.set(label, result);
    return result;
  };
  const declaredOf = (label: string) => {
    const { declared } = adapted(label);
    if (!declared.ok) throw new Error(`${declared.code}: ${declared.message}`);
    return declared;
  };
  const run = (label: string) => {
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const pairs: unknown[] = [];
    const { query: recorded } = recordingRequests(query, (pair) =>
      pairs.push(pair),
    );
    const result = certifyDeclaredOffsetChain(
      declaredOf(label),
      recorded,
      createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
        snapshots.push(snapshot),
      ),
    );
    return { result, snapshots, pairs };
  };
  const certificateOf = (label: string) => {
    const { result } = run(label);
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result;
  };
  const kinds = (certificate: OffsetChainTubeStabilityCertificate) => {
    const counts: Record<string, number> = {};
    for (const join of certificate.joins) {
      const kind =
        join.kind === "nonparallel-vertex"
          ? `${join.kind}/${join.side}`
          : join.kind;
      counts[kind] = (counts[kind] ?? 0) + 1;
    }
    return counts;
  };
  const meterOf = (snapshot: ExactProofBudgetSnapshot) => ({
    operations: snapshot.operations,
    euclideanSteps: snapshot.euclideanSteps,
    integerBits: Math.max(snapshot.maxStoredBits, snapshot.maxPreProductBits),
  });

  // D3 against legacy (design §5 as amended): every row legacy draws must
  // verify; the legacy arc collapses fail as derived-offset-arc-collapse.
  // [TECH] G13: the legacy verdicts are pinned (LEGACY_D3_ARC_COLLAPSES).
  test("G13: the pinned legacy verdicts cover exactly the D3 rows", () => {
    expect(rows).toHaveLength(LEGACY_D3_ROW_COUNT);
    const labels = new Set(rows.map((row) => `${row.row} ${row.distance}`));
    expect(labels.size).toBe(LEGACY_D3_ROW_COUNT);
    for (const label of LEGACY_D3_ARC_COLLAPSES)
      expect(labels.has(label)).toBe(true);
  });
  test.each(rows.map((row) => [row.row, row.distance, row] as const))(
    "D3 %s d = %s: the certified verdict matches the legacy offset (verified where legacy draws, arc collapse where it collapses)",
    (label, distance, row) => {
      const sketch = row.build(harness);
      const { declared } = harness.adapt(sketch, distance);
      if (LEGACY_D3_ARC_COLLAPSES.has(`${label} ${distance}`)) {
        expect(declared).toMatchObject({ ok: false, code: codes.arcCollapse });
        return;
      }
      if (!declared.ok)
        throw new Error(`${declared.code}: ${declared.message}`);
      const result = certifyDeclaredOffsetChain(
        declared,
        query,
        createCertifiedCubicTubeChain(),
      );
      if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
      // Every seed-arc record is the resolver's canonical support: centre
      // bitwise the point-defined seed centre, radius hypot(start − centre).
      for (const record of result.certificate.seedArcs ?? []) {
        const piece = result.resolved.input.pieces[record.piece]!;
        if (piece.kind === "circle") {
          expect(record.radius).toBe(piece.radius);
          continue;
        }
        if (piece.kind !== "arc") throw new Error("not a seed arc");
        expect(record.center).toEqual(piece.center);
        expect(record.radius).toBe(
          Math.hypot(
            piece.start[0] - piece.center[0],
            piece.start[1] - piece.center[1],
          ),
        );
        for (const value of record.epsilon) expect(value).toBeLessThan(1e-3);
        expect(record.radiusFamily[0]).toBeLessThanOrEqual(record.radius);
        expect(record.radiusFamily[1]).toBeGreaterThanOrEqual(record.radius);
      }
    },
    60_000,
  );

  test.each([
    [
      "rounded rect 0.01",
      {
        "parallel-vertex": 2,
        "nonparallel-vertex/convex": 6,
        "seed-arc-knot": 4,
      },
    ],
    [
      "rounded rect -0.01",
      {
        "parallel-vertex": 2,
        "nonparallel-vertex/concave": 6,
        "seed-arc-knot": 4,
      },
    ],
    ["slot 0.1", { "parallel-vertex": 4, "seed-arc-knot": 6 }],
    ["circle 0.01", { "seed-arc-knot": 8 }],
    ["two semicircles 0.01", { "parallel-vertex": 2, "seed-arc-knot": 6 }],
    ["lens 0.01", { "arc-trim": 2, "seed-arc-knot": 2 }],
    ["lens -0.01", { "arc-entry": 2, "arc-exit": 2, "seed-arc-knot": 2 }],
    ["line-arc-line semicircle -0.1", { "arc-trim": 2, "seed-arc-knot": 3 }],
    [
      "line-arc-line semicircle 0.01",
      { "arc-entry": 2, "arc-knot": 2, "arc-exit": 2, "seed-arc-knot": 3 },
    ],
    [
      "line-arc-line semicircle long (R7) -2",
      { "arc-trim": 2, "seed-arc-knot": 1 },
    ],
    ["half-disc 0.1", { "arc-trim": 2, "seed-arc-knot": 3 }],
    [
      "rect + 1 fillet 0.01",
      {
        trim: 3,
        "parallel-vertex": 1,
        "nonparallel-vertex/convex": 1,
        "seed-arc-knot": 1,
      },
    ],
    ["S-curve 0.01", { "parallel-vertex": 1, "seed-arc-knot": 2 }],
  ] as const)("%s takes the design route: joins %j", (label, expected) => {
    expect(kinds(certificateOf(label).certificate)).toEqual(expected);
  });

  test("the concave near-tangent arc vertices are absorbed first with no joint query ([TECH F6]); legacy-identical untrimmed ends S′, E′ are published at every unadopted end", () => {
    const { result, pairs } = run("rounded rect -0.01");
    if (!result.ok) throw new Error(result.message);
    expect(pairs).toEqual([]);
    const declared = declaredOf("rounded rect -0.01");
    for (const [index, piece] of declared.pieces.entries()) {
      if (piece.kind !== "arc") continue;
      const source = declared.sources[index]!;
      if (source.kind !== "arc") throw new Error("not an arc source");
      const sigma = piece.sweepDirection === "counterClockwise" ? 1 : -1;
      const shifted = source.sourceRadius - sigma * source.distance;
      expect(piece.start).toEqual(
        scalePointFromCenter(source.center, source.source[0], shifted),
      );
      expect(piece.end).toEqual(
        scalePointFromCenter(source.center, source.source[1], shifted),
      );
    }
  });

  test("review R4: next to a seed arc every F1 junction is one rationalized realization segment, steep (W1/W2) on the lens and exactly vertical on the axis-aligned semicircle", () => {
    const lens = certificateOf("lens -0.01").certificate;
    const junctions = lens.joins.filter(
      (join) => join.kind === "arc-entry" || join.kind === "arc-exit",
    );
    expect(
      junctions.map((join) => "realization" in join && join.realization),
    ).toEqual(["steep", "steep", "steep", "steep"]);
    // Only the junctions next to the seed arc carry a realization segment.
    const semicircle = certificateOf(
      "line-arc-line semicircle 0.01",
    ).certificate;
    expect(
      semicircle.joins.flatMap((join) =>
        (join.kind === "arc-entry" || join.kind === "arc-exit") &&
        join.realization
          ? [[join.kind, join.realization]]
          : [],
      ),
    ).toEqual([
      ["arc-exit", "vertical"],
      ["arc-entry", "vertical"],
    ]);
  });

  test("review R12: a seed arc trimmed at its natural start certifies a radius family [ρ_o − w, ρ_o + w] with w > 0; untrimmed starts keep [ρ_o, ρ_o]", () => {
    const trimmed = certificateOf("line-arc-line semicircle -0.1").certificate
      .seedArcs![0]!;
    expect(trimmed.radiusFamily[0]).toBeLessThan(trimmed.radius);
    expect(trimmed.radiusFamily[1]).toBeGreaterThan(trimmed.radius);
    const vertex = certificateOf("rounded rect 0.01").certificate.seedArcs!;
    for (const record of vertex)
      expect(record.radiusFamily).toEqual([record.radius, record.radius]);
  });

  test("review R7: a joint root beyond the terminal 45° leaf is proved within the arc on an inner leaf; the leaves before it are removed", () => {
    const { result } = run("line-arc-line semicircle long (R7) -2");
    if (!result.ok) throw new Error(result.message);
    expect(result.certificate.seedArcs![0]).toMatchObject({ removed: [1, 1] });
    const arc = result.resolved.input.pieces[1]!;
    expect(
      result.resolved.lineArcEndpoints.get(arc.seedEntityId),
    ).toMatchObject({
      removedLeaves: [1, 1],
    });
  });

  test("review Q1 control: an asymmetric lens (flat cap centred (0, −3) over a deep four-leaf cap centred (0, 0.2)) at d = 0.45 trims deep on the EXPLICIT arc (removed [1, 1]); its removed leaves are proved off K and it verifies", () => {
    const sketch = (() => {
      const a = harness.arc(harness.empty(), [0, -3], [1, 0], [-1, 0]);
      const b = harness.arc(a.definition, [0, 0.2], [-1, 0], [1, 0], {
        start: a.end,
        end: a.start,
      });
      return { definition: b.definition, seeds: [a.id, b.id] };
    })();
    const { declared } = harness.adapt(sketch, 0.45);
    if (!declared.ok) throw new Error(`${declared.code}: ${declared.message}`);
    const result = certifyDeclaredOffsetChain(
      declared,
      query,
      createCertifiedCubicTubeChain(),
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    // Joint 0 (flat cap → deep cap): the flat cap is implicit ("first"),
    // so the deep cap is the explicit side and carries the removal.
    expect(
      result.certificate.joins.flatMap((join) =>
        join.kind === "arc-trim" ? [[join.jointIndex, join.circle]] : [],
      ),
    ).toEqual([
      [0, "first"],
      [1, "first"],
    ]);
    expect(
      result.certificate.seedArcs!.map((record) => record.removed),
    ).toEqual([
      [0, 0],
      [1, 1],
    ]);
  });

  test("review R6: on a partially filleted rectangle the arc is the swap adopter of the line whose other end is a trim", () => {
    const { result } = run("rect + 1 fillet 0.01");
    if (!result.ok) throw new Error(result.message);
    const pieces = result.resolved.input.pieces;
    const arcIndex = pieces.findIndex((piece) => piece.kind === "arc");
    const arc = pieces[arcIndex]!;
    if (arc.kind !== "arc") throw new Error("no arc");
    const neighbours = [
      pieces[(arcIndex - 1 + pieces.length) % pieces.length]!,
      pieces[(arcIndex + 1) % pieces.length]!,
    ];
    // At least one arc end IS a neighbouring line's own pole (adopted).
    const poles = neighbours.flatMap((piece) =>
      piece.kind === "lineSegment" ? [piece.start, piece.end] : [],
    );
    expect(
      [arc.start, arc.end].some((end) =>
        poles.some(
          (pole) => Object.is(pole[0], end[0]) && Object.is(pole[1], end[1]),
        ),
      ),
    ).toBe(true);
    expect(arc.radius).toBe(
      Math.hypot(arc.start[0] - arc.center[0], arc.start[1] - arc.center[1]),
    );
  });

  test("review R9: next to a non-radial realization segment a seed arc of sweep ≥ π keeps its (first, last) leaf pair in K3", () => {
    const { result } = run("D (300° arc + chord) -0.01");
    if (!result.ok) throw new Error(result.message);
    const record = result.certificate.seedArcs![0]!;
    const pair = [record.leaves[0]!, record.leaves.at(-1)!];
    expect(result.certificate.clearedPairs).toContainEqual(pair);
    // Other intra-arc pairs stay exempt (F7).
    expect(result.certificate.clearedPairs).not.toContainEqual([
      record.leaves[0]!,
      record.leaves[2]!,
    ]);
  });

  test("a thin D (37° arc + chord, height 0.162) at d = 0.1 > height/2 has no inward offset: the certified path fails closed (no crossing on any arc leaf), where legacy draws an inverted, self-crossing loop", () => {
    const row = rows.find((item) => item.row.startsWith("thin D"))!;
    const sketch = row.build(harness);
    const { declared } = harness.adapt(sketch, 0.1);
    if (!declared.ok) throw new Error(declared.message);
    expect(
      certifyDeclaredOffsetChain(
        declared,
        query,
        createCertifiedCubicTubeChain(),
      ),
    ).toMatchObject({
      ok: false,
      code: codes.splineJointUnsupported,
      message: expect.stringContaining(
        "no crossing on any seed-arc leaf of the joint (the offset curves do not meet there; the offset may be empty or the arc collapses)",
      ),
    });
    // [TECH] G13: the legacy owner (deleted in T08b-g6) drew this row at
    // d = 0.1 with its offset arc starting at y = −0.09486832980505122,
    // BELOW its offset chord (y = 0.1): inverted (T08b-g6 evidence,
    // probes/g13-literals.json).
  });

  test("Lemma T° adversary (certifier input, not owner-reachable): a line bracket forged to straddle the chord's exact foot t₀ fails T°1 as a SIGN failure (never magnitude-tagged, so never flipped)", () => {
    let captured: PieceTubeChainRequest | undefined;
    const real = createCertifiedCubicTubeChain();
    const port = {
      openRequest: () => ({
        certifyPieceChain: (request: PieceTubeChainRequest) => {
          captured = request;
          return real.certifyPieceChain(request);
        },
      }),
    };
    expect(
      certifyDeclaredOffsetChain(declaredOf("half-disc 0.1"), query, port).ok,
    ).toBe(true);
    const request = captured!;
    // The chord is piece 1 (natural t ∈ [0, 1]); its foot about C is t₀ = ½.
    const trims = request.trims.map((trim) => {
      const lineFirst = request.pieces[trim.jointIndex]!.kind === "line";
      return lineFirst
        ? { ...trim, firstParameterBounds: [0.4, 0.6] as const }
        : { ...trim, secondParameterBounds: [0.4, 0.6] as const };
    });
    const result = real.certifyPieceChain({ ...request, trims });
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "trim-classification-unproven",
    });
    expect("magnitude" in result).toBe(false);
  });

  test("review R8: a state-driven arc (no offset relationship in the solve) is not a seed: its solved ends are not its point positions", () => {
    const row = rowOf("lens 0.01");
    const sketch = row.build(harness);
    const pair = harness.solved(sketch.definition);
    const connectivity = extractDeclaredOffsetChainConnectivity({
      definition: pair.definition,
      seedIds: sketch.seeds,
    });
    if (!connectivity.ok) throw new Error(connectivity.message);
    expect(
      declaredOffsetChainPieces({
        definition: pair.definition,
        solvedSnapshot: pair.solvedSnapshot,
        connectivity,
        distance: row.distance,
        modelingTolerance: 1e-3,
      }),
    ).toMatchObject({ ok: false, code: codes.unsupportedSeed });
  });

  const PINS = {
    "rounded rect 0.01": {
      operations: 309_320,
      euclideanSteps: 63_857,
      integerBits: 1_186,
    },
    "rounded rect -0.01": {
      operations: 644_816,
      euclideanSteps: 145_556,
      integerBits: 1_186,
    },
    "rounded rect rotated 0.3 -0.01": {
      operations: 825_234,
      euclideanSteps: 212_511,
      integerBits: 427,
    },
    "slot 0.1": {
      operations: 85_777,
      euclideanSteps: 14_181,
      integerBits: 1_179,
    },
    "line-arc-line semicircle -0.1": {
      operations: 84_625,
      euclideanSteps: 15_897,
      integerBits: 1_182,
    },
    "lens 0.01": {
      operations: 400_176,
      euclideanSteps: 103_953,
      integerBits: 404,
    },
    "lens -0.01": {
      operations: 266_175,
      euclideanSteps: 67_183,
      integerBits: 317,
    },
    "circle 0.01": {
      operations: 26_886,
      euclideanSteps: 4_469,
      integerBits: 164,
    },
    "line-arc-line semicircle 0.01": {
      operations: 96_159,
      euclideanSteps: 17_625,
      integerBits: 1_239,
    },
    "rounded rect rotated + Tangent, dragged 1e-4 -0.01": {
      operations: 1_012_471,
      euclideanSteps: 265_257,
      integerBits: 482,
    },
    "rect + 1 fillet 0.01": {
      operations: 93_682,
      euclideanSteps: 18_318,
      integerBits: 1_186,
    },
    "line-arc-line semicircle long (R7) -2": {
      operations: 57_845,
      euclideanSteps: 9_291,
      integerBits: 316,
    },
    "half-disc 0.1": {
      operations: 97_204,
      euclideanSteps: 19_586,
      integerBits: 1_182,
    },
    // Meter review R1: the only row through the circle↔cubic Lemma T°
    // (cubic dyadic windows, the Q4-E1 witness precharge, the cubic root
    // restriction); its per-value bit peak lies inside T°.
    "arc→spline corner -0.01": {
      operations: 526_796,
      euclideanSteps: 160_123,
      integerBits: 4_364,
    },
  } as const;
  test.each(Object.entries(PINS))(
    "native %s certifier literal through SEL: count passes, count − 1 exhausts on operations, Euclid and bits",
    (label, pin) => {
      const { result, snapshots } = run(label);
      expect(result.ok).toBe(true);
      expect(meterOf(snapshots.at(-1)!)).toEqual(pin);
      for (const kind of [
        "operations",
        "euclideanSteps",
        "integerBits",
      ] as const) {
        const under = (limit: number) =>
          certifyDeclaredOffsetChain(
            declaredOf(label),
            query,
            createCertifiedCubicTubeChainWithLowerBudgetForTest({
              [kind]: limit,
            }),
          );
        expect(under(pin[kind]).ok, kind).toBe(true);
        expect(under(pin[kind] - 1), kind).toMatchObject({
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        });
      }
    },
    120_000,
  );

  /**
   * The 9eef2dbf resolver literal of the R1 row (identical at the g5d
   * working copy, T08b-g5d-evidence/out/r1-candidates.json "c1 -0.01").
   */
  const R1_ARC_SPLINE_LITERAL = {
    operations: 662_873,
    euclideanSteps: 153_324,
    bits: 2_325,
  };
  test("T08b-g5d review R1: a joint with a seed-arc side keeps R7 exactly (no cubic inner-leaf scan): an arc→spline corner whose spline terminal source span has 4 leaves is sized 1 + n_arc and keeps its resolver literal", () => {
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const pairs: string[] = [];
    const { sizes, query: recorded } = recordingRequests(
      createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
        (snapshot) => snapshots.push(snapshot),
      ),
      (pair) =>
        pairs.push(
          `${pair.first.kind}:${pair.first.provenance.sourceSpanId}/${pair.second.kind}:${pair.second.provenance.sourceSpanId}`,
        ),
    );
    const arcThenSpline = harness.arc(harness.empty(), [0, 0], [1, 0], [0, 1]);
    const sketch = harness.spline(
      arcThenSpline.definition,
      [
        [0, 1],
        [-1, 1.3],
        [-1.3, 2.6],
      ],
      { start: arcThenSpline.end },
    );
    const { declared } = harness.adapt(
      {
        definition: sketch.definition,
        seeds: [arcThenSpline.id, sketch.id],
      },
      -0.01,
    );
    if (!declared.ok) throw new Error(declared.message);
    // Premise: the spline's terminal source span has more than one leaf, so
    // a ring scan would have sized (1 + n_arc)(1 + n_cubic) queries.
    const spline = declared.pieces.find(
      (piece) => piece.kind === "derivedCubic",
    )!;
    if (spline.kind !== "derivedCubic") throw new Error("spline");
    const arc = declared.pieces.find((piece) => piece.kind === "arc")!;
    if (arc.kind !== "arc") throw new Error("arc");
    const terminalSpan = spline.reversed
      ? spline.spans.at(-1)!.source.spanIndex
      : spline.spans[0]!.source.spanIndex;
    expect(
      spline.spans.filter((span) => span.source.spanIndex === terminalSpan)
        .length,
      "premise: a multi-leaf terminal source span",
    ).toBeGreaterThan(1);
    const result = certifyDeclaredOffsetChain(
      declared,
      recorded,
      createCertifiedCubicTubeChain(),
    );
    expect(result.ok).toBe(true);
    expect(sizes, "R7: 1 + n_arc, unchanged").toEqual([
      1 + (arc.splits?.length ?? 0),
    ]);
    // The arc's terminal (last) leaf against the spline's terminal leaf only.
    expect(pairs, "the terminal pair only").toEqual(["circle:1/cubicBezier:0"]);
    const last = snapshots.at(-1)!;
    expect({
      operations: last.operations,
      euclideanSteps: last.euclideanSteps,
      bits: Math.max(last.maxStoredBits, last.maxPreProductBits),
    }).toEqual(R1_ARC_SPLINE_LITERAL);
  });

  // Staged caps inside every new stage (instrumented stage maps in
  // T08b-f-evidence/stages/): each exhausts as itself.
  test.each([
    // LAL semicircle −0.1: seed stage admission 7 023 → radii 16 287 → A-R
    // 19 920 → family 21 639 → T° 26 787 / 45 209 → K3 64 581 … 84 625.
    ["line-arc-line semicircle -0.1", "operations", 12_000],
    ["line-arc-line semicircle -0.1", "operations", 18_000],
    ["line-arc-line semicircle -0.1", "operations", 20_500],
    ["line-arc-line semicircle -0.1", "operations", 24_000],
    ["line-arc-line semicircle -0.1", "operations", 35_000],
    ["line-arc-line semicircle -0.1", "euclideanSteps", 6_000],
    // Lens −0.01: the first Lemma-W junction starts at 93 544 ops / 23 067.
    ["lens -0.01", "operations", 93_600],
    ["lens -0.01", "euclideanSteps", 23_200],
    // Rotated rounded rect −0.01: vertex 0 K1-wedge 209 666 → J2′-arc
    // 219 059 … 330 679 (meter review A3: exhaustion-stack frames).
    // Ops 214 000 trips in the LINE leaf's K1 cone under the F5 seed-vertex
    // e (seed-vertex path, not the seed leaf's own K1-wedge).
    ["rounded rect rotated 0.3 -0.01", "operations", 214_000],
    // Ops 250 000 trips in seedJ2 (J2′-arc data).
    ["rounded rect rotated 0.3 -0.01", "operations", 250_000],
    // Euclid 70 000 trips in the SHARED concave J2′ block fed seed data.
    ["rounded rect rotated 0.3 -0.01", "euclideanSteps", 70_000],
    // Meter review R1, arc→spline corner −0.01: ops 100 000 lands in the
    // cubic dyadic T°1/T°2 windows (monotoneRun → visit); bits 2 000 in the
    // cubic root-position restriction.
    ["arc→spline corner -0.01", "operations", 100_000],
    ["arc→spline corner -0.01", "integerBits", 2_000],
  ] as const)(
    "native %s: a staged %s cap of %d inside a seed-arc stage exhausts as itself",
    (label, kind, cap) => {
      expect(
        certifyDeclaredOffsetChain(
          declaredOf(label),
          query,
          createCertifiedCubicTubeChainWithLowerBudgetForTest({ [kind]: cap }),
        ),
      ).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      });
    },
    60_000,
  );
});

describe("T08b-f1 [TECH] F12: the certifier's whole-request ceiling scales with the leaf count (m = min(⌈leaves / 32⌉, 128) from the charged flattened leaves, charges unchanged, integerBits unscaled)", () => {
  const C_EUCLID = 1_500_000;
  const arcHarness = createNativeArcOffsetHarness({
    authoring: createNativeArcAuthoring("sketch_t08bf"),
    modelingTolerance: 1e-3,
    solveTolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
  });
  const splineHarness = createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_t08bd"),
    query,
    modelingTolerance: 1e-3,
  });
  const exhausted = {
    kind: "uncertain",
    code: "exact-query-proof-budget-exhausted",
  };
  const declaredOf = (label: string) => {
    const row = seedArcCapacityRows().find(
      (item) => `${item.row} ${item.distance}` === label,
    );
    if (!row) throw new Error(`no row ${label}`);
    const { declared } = arcHarness.adapt(row.build(arcHarness), row.distance);
    if (!declared.ok) throw new Error(`${declared.code}: ${declared.message}`);
    return declared;
  };
  /** One production SEL run: its verdict, piece requests and snapshots. */
  const capture = (declared: DeclaredOffsetChainPieces) => {
    const requests: PieceTubeChainRequest[] = [];
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const real = createCertifiedCubicTubeChainWithBudgetObserverForTest(
      (snapshot) => snapshots.push(snapshot),
    );
    const result = certifyDeclaredOffsetChain(declared, query, {
      openRequest: (attempts) => {
        const request = real.openRequest(attempts);
        return {
          certifyPieceChain: (item) => {
            requests.push(item);
            return request.certifyPieceChain(item);
          },
        };
      },
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return { certificate: result.certificate, requests, snapshots };
  };
  /** wrap-zig34 d = +0.05: one cubic piece, 378 leaves, ≈ 1.44 C Euclid. */
  const heavyWrap = () => {
    splineHarness.resetSequence();
    const run = capture(
      splineHarness.nativeChain(
        [
          positionalClosureSpline(
            splineHarness,
            POSITIONAL_WRAPS["wrap-zig34"],
          ),
        ],
        0.05,
      ).declared,
    );
    expect(run.requests).toHaveLength(1);
    expect(run.certificate.leaves).toHaveLength(378);
    return run;
  };
  const meterOf = (snapshot: ExactProofBudgetSnapshot) => ({
    operations: snapshot.operations,
    euclideanSteps: snapshot.euclideanSteps,
    integerBits: Math.max(snapshot.maxStoredBits, snapshot.maxPreProductBits),
  });

  // Capacity row: exhausted before F12 (≈ 120 % of one Euclid ceiling).
  // T08b-g7 review R9 (P3: every fillet takes two leaves): 96 leaves, m = 3
  // (was 64, m = 2; operations 6 881 306, Euclid 1 798 813, bits 413).
  // Lower limits are absolute, so count / count − 1 pin the charges.
  const POLYGON_32_METER = {
    operations: 7_390_511,
    euclideanSteps: 1_922_268,
    integerBits: 413,
  };
  test("native rounded 32-gon d = −0.01 (32 lines + 32 two-leaf fillets, 96 leaves, m = 3) needs more than one production Euclid ceiling and verifies; count / count − 1 on operations, Euclid and bits", () => {
    const declared = declaredOf("rounded 32-gon -0.01");
    const run = capture(declared);
    expect(run.certificate.leaves).toHaveLength(96);
    expect(run.snapshots).toHaveLength(1);
    const meter = meterOf(run.snapshots[0]!);
    expect(meter.euclideanSteps, "premise: above one ceiling").toBeGreaterThan(
      C_EUCLID,
    );
    expect(meter).toEqual(POLYGON_32_METER);
    const under = (limits: Record<string, number>) =>
      certifyDeclaredOffsetChain(
        declared,
        query,
        createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
      );
    for (const kind of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      expect(under({ [kind]: POLYGON_32_METER[kind] }).ok, kind).toBe(true);
      expect(under({ [kind]: POLYGON_32_METER[kind] - 1 }), kind).toMatchObject(
        {
          ok: false,
          code: codes.topologyUncertain,
          message: expect.stringContaining(
            "exact-query-proof-budget-exhausted",
          ),
        },
      );
    }
  }, 300_000);

  // T08b-g7 review R9: P3 gives every fillet of a closed chain two leaves,
  // so the pair is re-derived (was 16-gon / 15 fillets −0.01 and 17-gon / 16
  // fillets +0.01). The new 32-leaf row is lighter (10 fillets, not 15), so
  // one heavy attempt no longer crosses 2·C: two heavy attempts after it
  // cross 3·C at m = 1 and fit 6·C at m = 2.
  test("the 32 / 33 leaf boundary (m = 1 / m = 2; a declared F1 arc counts one leaf) is fixed by attempt 1 for the whole staged request: heavy 378-leaf attempts 2 and 3 are never rescaled", () => {
    // 11 lines + 10 two-leaf fillets + 1 F1 arc (the unfilleted outward
    // corner) = 32; the rounded 11-gon inward: 11 + 22 = 33.
    const at32 = capture(declaredOf("11-gon with 10 fillets -0.01"));
    expect(at32.certificate.leaves).toHaveLength(32);
    expect(at32.certificate.arcs).toHaveLength(1);
    const at33 = capture(declaredOf("rounded 11-gon 0.01"));
    expect(at33.certificate.leaves).toHaveLength(33);
    expect(at33.certificate.arcs ?? []).toHaveLength(0);
    const heavy = heavyWrap();
    const euclid = (run: { snapshots: ExactProofBudgetSnapshot[] }) =>
      run.snapshots.at(-1)!.euclideanSteps;
    // Premises: 32 + heavy fits 2·C, 32 + 2·heavy exceeds 3·C; 33 + 2·heavy
    // fits 3·2·C.
    expect(euclid(at32) + euclid(heavy)).toBeLessThanOrEqual(2 * C_EUCLID);
    expect(euclid(at32) + 2 * euclid(heavy)).toBeGreaterThan(3 * C_EUCLID);
    expect(euclid(at33) + 2 * euclid(heavy)).toBeLessThanOrEqual(6 * C_EUCLID);
    const staged = (first: PieceTubeChainRequest) => {
      const request = createCertifiedCubicTubeChain().openRequest(3);
      return [
        request.certifyPieceChain(first),
        request.certifyPieceChain(heavy.requests[0]!),
        request.certifyPieceChain(heavy.requests[0]!),
      ];
    };
    const [first32, second32, third32] = staged(at32.requests[0]!);
    expect(first32!.kind).toBe("verified");
    expect(second32!.kind, "m = 1: stage 2 is 2·C").toBe("verified");
    expect(third32, "m = 1: stage 3 is 3·C").toMatchObject(exhausted);
    const [first33, second33, third33] = staged(at33.requests[0]!);
    expect(first33!.kind).toBe("verified");
    expect(second33!.kind).toBe("verified");
    expect(third33!.kind, "m = 2: stage 3 is 6·C").toBe("verified");
  }, 300_000);

  test("the legacy path scales too: the heavy wrap's 378 cubic leaves as ONE open legacy chain reach their clearance verdict at m = 12, and exhaust under one absolute Euclid ceiling", () => {
    const heavy = heavyWrap();
    const piece = heavy.requests[0]!.pieces[0]!;
    if (piece.kind !== "cubic") throw new Error("not a cubic piece");
    const legacy = {
      modelingTolerance: heavy.requests[0]!.modelingTolerance,
      closed: false,
      tubes: piece.tubes,
    };
    // The cut-open wrap's ends overlap: an honest clearance failure.
    expect(createCertifiedCubicTubeChain().certifyChain(legacy)).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
    });
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        euclideanSteps: C_EUCLID,
      }).certifyChain(legacy),
    ).toMatchObject(exhausted);
  }, 120_000);

  // Review R2: the single-piece delegate of `certifyPieceChain` scales too.
  test("the single-piece delegate scales too: the heavy wrap's 378 leaves as ONE open cubic piece reach their clearance verdict, and exhaust under one absolute Euclid ceiling", () => {
    const request = heavyWrap().requests[0]!;
    const piece = request.pieces[0]!;
    if (piece.kind !== "cubic") throw new Error("not a cubic piece");
    expect(piece.tubes).toHaveLength(378);
    const single: PieceTubeChainRequest = {
      modelingTolerance: request.modelingTolerance,
      distance: request.distance,
      closed: false,
      pieces: [piece],
      trims: [],
    };
    // The cut-open wrap's ends overlap: an honest clearance failure.
    expect(
      createCertifiedCubicTubeChain().certifyPieceChain(single),
    ).toMatchObject({
      kind: "uncertain",
      code: "cubic-tube-clearance-unproven",
    });
    expect(
      createCertifiedCubicTubeChainWithLowerBudgetForTest({
        euclideanSteps: C_EUCLID,
      }).certifyPieceChain(single),
    ).toMatchObject(exhausted);
  }, 120_000);

  // Review R3: the multiplier's magnitude well above 2. A mirror-symmetric
  // closed zig-zag spline with 28 teeth per side (62 points) at +0.05 has
  // 1 386 leaves (m = 44) and needs > 10 Euclid ceilings. Lower limits are
  // absolute, so count / count − 1 pin the unchanged charge. ≈ 17 s.
  test("a 1 386-leaf zig-zag spline (m = 44) needs more than ten production Euclid ceilings and verifies; count / count − 1 on Euclid", () => {
    const zig = (teeth: number): Vector[] => {
      const right: Vector[] = [];
      for (let j = 0; j <= 2 * teeth; j += 1)
        right.push([j % 2 === 0 ? 2 : 1.3, 0.5 + 0.7 * j]);
      const top: Vector = [0, right.at(-1)![1] + 1.4];
      return [
        [0, 0],
        [1, 0],
        ...right,
        top,
        ...right
          .slice()
          .reverse()
          .map(([x, y]): Vector => [-x, y]),
        [-1, 0],
      ];
    };
    splineHarness.resetSequence();
    const { declared } = splineHarness.nativeChain(
      [positionalClosureSpline(splineHarness, zig(28))],
      0.05,
    );
    const run = capture(declared);
    expect(run.requests).toHaveLength(1);
    expect(run.certificate.leaves).toHaveLength(1_386);
    const euclid = run.snapshots.at(-1)!.euclideanSteps;
    expect(euclid, "premise: above ten ceilings").toBeGreaterThan(
      10 * C_EUCLID,
    );
    expect(euclid).toBe(15_646_822);
    const under = (euclideanSteps: number) =>
      certifyDeclaredOffsetChain(
        declared,
        query,
        createCertifiedCubicTubeChainWithLowerBudgetForTest({ euclideanSteps }),
      );
    expect(under(euclid).ok).toBe(true);
    expect(under(euclid - 1)).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: expect.stringContaining("exact-query-proof-budget-exhausted"),
    });
  }, 300_000);
});

// Logic lane (docs/testing.md): T08b-g5d (U-G6, no refinement rounds by user
// decision U-G7). Seam: the exported SEL (`declaredOffsetChainPieces` +
// `certifyDeclaredOffsetChain`) on the shared native fixture rows
// `deepTrimRows()` (commit → solve → N2 → adapter), the real kernel-free
// query and certifier. Full matrix with timings in
// T08b-g5d-evidence/out/harness-{sl,5pt,lens}.jsonl.
/** The g5d deep row's certifier literal (new path; T08b-g5d-evidence). */
const G5D_CERTIFIER_LITERAL = {
  operations: 98_910,
  euclideanSteps: 24_644,
  integerBits: 321,
};
/** The g5d deep row's resolver literal (sized 8: R2; T08b-g5d-evidence). */
const G5D_RESOLVER_LITERAL = {
  operations: 328_922,
  euclideanSteps: 52_179,
  integerBits: 486,
};

describe("T08b-g5d (U-G6): deep spline offset trims inside the terminal source span (native SEL)", () => {
  const harness = createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_g5d"),
    query,
    modelingTolerance: 1e-3,
  });
  const rows = deepTrimRows();
  /** `<row> <distance>`: a fixture row, at any distance (G20 rows: d = −0.3). */
  const declaredOf = (label: string) => {
    const at = label.lastIndexOf(" ");
    const row = rows.find((item) => item.row === label.slice(0, at));
    if (!row) throw new Error(`no row ${label}`);
    harness.resetSequence();
    return harness.nativeChain(row.build(harness), Number(label.slice(at + 1)))
      .declared;
  };
  /** One SEL run: verdict, resolver sizes and pairs, certifier requests. */
  const run = (label: string, requestQuery = query) => {
    const declared = declaredOf(label);
    const pairs: string[] = [];
    const { sizes, query: recorded } = recordingRequests(requestQuery, (pair) =>
      pairs.push(
        `${pair.first.provenance.sourceSpanId}/${pair.second.provenance.sourceSpanId}`,
      ),
    );
    const requests: PieceTubeChainRequest[] = [];
    const real = createCertifiedCubicTubeChain();
    const result = certifyDeclaredOffsetChain(declared, recorded, {
      openRequest: (attempts) => {
        const request = real.openRequest(attempts);
        return {
          certifyPieceChain: (item) => {
            requests.push(item);
            return request.certifyPieceChain(item);
          },
        };
      },
    });
    return { declared, result, sizes, pairs, requests };
  };
  const trimsOf = (result: ReturnType<typeof run>["result"]) => {
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result.certificate.joins.flatMap((join) =>
      join.kind === "trim" || join.kind === "graph-trim"
        ? [
            {
              kind: join.kind,
              jointIndex: join.jointIndex,
              first: join.first,
              second: join.second,
              offsets: [join.firstLeafOffset ?? 0, join.secondLeafOffset ?? 0],
              ...(join.kind === "graph-trim" && join.glue
                ? { glue: join.glue }
                : {}),
            },
          ]
        : [],
    );
  };

  test.each([
    [
      "SL h0.4 -0.1",
      [
        [0, 6, 8, [1, 0]],
        [1, 8, 1, [0, 1]],
      ],
      [0, 7],
      8,
    ],
    [
      "SL h0.8 -0.2",
      [
        [0, 11, 14, [2, 0]],
        [1, 14, 2, [0, 2]],
      ],
      [0, 1, 12, 13],
      14,
    ],
  ] as const)(
    "Lemma T-W: %s verifies with deep line trims on inner leaves of the terminal source span; the removed leaves are reported removed and the resolution marks them",
    (label, trims, removed, size) => {
      const { result, requests, sizes, declared } = run(label);
      expect(
        trimsOf(result).map((trim) => [
          trim.jointIndex,
          trim.first,
          trim.second,
          trim.offsets,
        ]),
      ).toEqual(trims);
      if (!result.ok) throw new Error("verified");
      expect(
        result.certificate.leaves.flatMap((leaf, index) =>
          leaf.removed ? [index] : [],
        ),
        "removed leaves (vertex leaf … trim leaf, exclusive)",
      ).toEqual(removed);
      // The request carries exactly the trim-leaf offsets, once.
      expect(requests).toHaveLength(1);
      expect(
        requests[0]!.trims.map((trim) => [
          trim.firstLeafOffset ?? 0,
          trim.secondLeafOffset ?? 0,
        ]),
      ).toEqual(trims.map(([, , , offsets]) => offsets));
      // R2: the request is sized for the ring scan of both cubic joints.
      expect(sizes).toEqual([size]);
      // The resolution's own domain ends: removed leaves at both ends.
      const spline = declared.pieces.find(
        (piece) => piece.kind === "derivedCubic",
      )!;
      const ends = result.resolved.cubics.get(spline.seedEntityId)!;
      expect(
        ends.flatMap((span, offset) =>
          span.start.kind === "removed" && span.end.kind === "removed"
            ? [offset]
            : [],
        ),
      ).toEqual(removed);
    },
    60_000,
  );

  // Rows that stay fail-closed (U-G7 refinement rows, U-B, owner
  // singularities, a K1 cone), each with its exact code and certifier text.
  test.each([
    ["SL h0.4 -0.03", "trim-composition-unproven", "(leaves 0)"],
    ["SL h0.4 -0.05", "trim-composition-unproven", "(leaves 0)"],
    ["SL h0.8 -0.1", "trim-composition-unproven", "(leaves 0)"],
    ["SL lean -0.01", "trim-composition-unproven", "(leaves 16)"],
    // The design's "5-point" row: the deep trim is found and fails its
    // composition on the trim leaf (it needs a refinement round, U-G7).
    ["SL h0.4 5pt -0.1", "trim-composition-unproven", "(leaves 2)"],
    ["SL lean -0.05", "cubic-tube-cone-unproven", "(leaves 7/8)"],
  ] as const)(
    "%s fails closed with %s %s",
    (label, inner, leaves) => {
      const { result } = run(label);
      expect(result).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining(`${leaves}: uncertain ${inner}:`),
      });
    },
    60_000,
  );

  test("U-B (review R5): a corner beyond the terminal source span fails closed; a spline side says so", () => {
    expect(run("SL h0.4 -0.2").result).toMatchObject({
      ok: false,
      code: codes.jointUnsatisfied,
      message:
        "Offset joint has no single certified transverse interior crossing.",
    });
    const { result, sizes, pairs } = run("SL h0.4 5pt -0.2");
    expect(result).toMatchObject({
      ok: false,
      code: codes.splineJointUnsupported,
      message:
        "Offset joint has no crossing on any leaf of the terminal source span: the offset corner lies beyond the terminal source span (U-B), or the offsets do not meet.",
    });
    // Every scanned pair stays inside the terminal source span.
    expect(sizes).toEqual([pairs.length]);
    for (const label of ["SL h1.6 -0.2", "SL lean -0.1", "SL lean -0.2"])
      expect(() => declaredOf(label), label).toThrow(
        "The spline offset owner did not certify (offset-topology-uncertain).",
      );
  });

  test("G20 pole-box prefilter (fabricated spans, seam-fake query): a deep spline↔spline ring pair whose r-inflated pole boxes are disjoint is never queried; a pair disjoint only inside the inflation r is queried", () => {
    // Collinear dyadic leaves on y = 0, r = 2⁻¹² each. P (natural order,
    // traversal end = leaf 1) and Q (traversal start = leaf 0); the ring
    // pairs (1,0) = P0/Q0, (0,1) = P1/Q1, (1,1) = P0/Q1. P1 [1, 2] and Q1
    // [2 + 2⁻²⁰, 4] are disjoint by 2⁻²⁰ < r_P + r_Q (queried); P0 [0, 1]
    // is 3 from Q0 and 1 + 2⁻²⁰ from Q1 (skipped).
    const r = 2 ** -12;
    const leaf = (
      poles: SplinePoles,
      sourceInterval: readonly [number, number],
    ) => ({
      ...fabricatedSpan(poles, ZERO_POLES, sourceInterval),
      certifiedError: r,
    });
    const gap = 2 ** -20;
    const pieces = [
      cubic("p", [
        leaf(
          [
            [0, 0],
            [0.25, 0],
            [0.75, 0],
            [1, 0],
          ],
          [0, 0.5],
        ),
        leaf(
          [
            [1, 0],
            [1.25, 0],
            [1.75, 0],
            [2, 0],
          ],
          [0.5, 1],
        ),
      ]),
      cubic("q", [
        leaf(
          [
            [5, 0],
            [4.75, 0],
            [4.25, 0],
            [4, 0],
          ],
          [0, 0.5],
        ),
        leaf(
          [
            [4, 0],
            [3, 0],
            [2.5, 0],
            [2 + gap, 0],
          ],
          [0.5, 1],
        ),
      ]),
    ];
    const issued: string[] = [];
    const empty: NeutralCurveQueryResult = {
      kind: "verified",
      points: [],
      overlaps: [],
      completenessProof: {
        kind: "completeIsolatedRootSet",
        family: "cubicCubic",
        distinctRootCount: 0,
      },
    };
    const { sizes, query: recorded } = recordingRequests(
      perRequest({ queryPair: () => empty }),
      (pair) =>
        issued.push(
          `${pair.first.provenance.sourceEntityId === id("p") ? "P" : "Q"}${pair.first.provenance.sourceSpanId}/Q${pair.second.provenance.sourceSpanId}`,
        ),
    );
    expect(
      failed(makeOffsetChainFixture(pieces, { query: recorded })),
    ).toMatchObject({
      code: codes.splineJointUnsupported,
      message:
        "Offset joint has no crossing on any leaf of the terminal source span: the offset corner lies beyond the terminal source span (U-B), or the offsets do not meet.",
    });
    // Sized structurally (R2): every ring slot is precharged, skipped or not.
    expect(sizes).toEqual([4]);
    expect(issued, "the terminal pair, then P1/Q1 only").toEqual([
      "P1/Q0",
      "P1/Q1",
    ]);
  });

  test("R2: the deep row's resolver literal (sized 8, 4 issued); count − 1 exhausts on operations, Euclid and bits with the pooled message", () => {
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const observed = run(
      "SL h0.4 -0.1",
      createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
        (snapshot) => snapshots.push(snapshot),
      ),
    );
    expect(observed.result.ok).toBe(true);
    expect(observed.sizes).toEqual([8]);
    expect(observed.pairs).toEqual(["7/0", "6/0", "0/0", "0/1"]);
    expect(snapshots).toHaveLength(5);
    expect(snapshots[0]!.operations).toBe(64 * 8);
    const last = snapshots.at(-1)!;
    const literal = {
      operations: last.operations,
      euclideanSteps: last.euclideanSteps,
      integerBits: Math.max(last.maxStoredBits, last.maxPreProductBits),
    };
    expect(literal).toEqual(G5D_RESOLVER_LITERAL);
    for (const key of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      const under = (limit: number) =>
        run(
          "SL h0.4 -0.1",
          createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest({
            [key]: limit,
          }),
        ).result;
      expect(under(literal[key]).ok, `${key} = count`).toBe(true);
      expect(under(literal[key] - 1), `${key} = count − 1`).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining(
          "the whole-request budget of all 8 joint queries is exhausted",
        ),
      });
    }
  }, 120_000);

  test("R3: a D > 0 absorbable corner keeps absorption first (terminal query only); its failed absorption takes the deferred deep scan once, reusing the empty terminal result, on a request sized for the whole ring (no RangeError)", () => {
    // A native arch spline into a line turning by less than 90° (D > 0),
    // concave toward d = 0.4: the terminal query is verified empty, so the
    // first pass absorbs (step 2(b)); absorption does not certify.
    const declared = declaredOf("SL arch R3 0.4");
    expect(classifyOffsetChainVertex(declared.vertices[0]!)).toMatchObject({
      class: "nonparallel",
      forward: true,
    });
    const pairs: string[] = [];
    const { sizes, query: recorded } = recordingRequests(query, (pair) =>
      pairs.push(
        `${pair.first.provenance.sourceSpanId}/${pair.second.provenance.sourceSpanId}`,
      ),
    );
    const attempts: number[] = [];
    const real = createCertifiedCubicTubeChain();
    const result = certifyDeclaredOffsetChain(declared, recorded, {
      openRequest: (count) => {
        attempts.push(count);
        return real.openRequest(count);
      },
    });
    const spline = declared.pieces[0]!;
    if (spline.kind !== "derivedCubic") throw new Error("spline");
    const terminalSpan = spline.spans.at(-1)!.source.spanIndex;
    const ring = spline.spans.filter(
      (span) => span.source.spanIndex === terminalSpan,
    ).length;
    expect(sizes, "sized (1 + n_P)(1 + n_Q) once").toEqual([ring]);
    expect(pairs.length).toBeLessThanOrEqual(ring);
    expect(pairs[0], "the first pass: the terminal pair only").toBe(
      `${spline.spans.length - 1}/0`,
    );
    expect(new Set(pairs).size, "the terminal pair is never re-issued").toBe(
      pairs.length,
    );
    expect(attempts, "1 + one deferred deep vertex").toEqual([2]);
    expect(trimsOf(result)).toEqual([
      expect.objectContaining({ kind: "trim", jointIndex: 0 }),
    ]);
    expect(trimsOf(result)[0]!.offsets[0]).toBeGreaterThan(0);
  }, 60_000);

  test("R3 meters (meter review R2): the deferred deep vertex draws on one resolver meter and one staged certifier budget: resolver 199,432 / 37,559 / 497 (sized 7; the deep requery issues 12/0 only), certifier attempts 11,562 → 200,907 / 51,861 / 373; count passes, count − 1 exhausts; exhaustion inside the deep requery or attempt 2 is reported as itself, never as the pre-deep verdict", () => {
    const declared = declaredOf("SL arch R3 0.4");
    const meterOf = (snapshot: ExactProofBudgetSnapshot) => ({
      operations: snapshot.operations,
      euclideanSteps: snapshot.euclideanSteps,
      integerBits: Math.max(snapshot.maxStoredBits, snapshot.maxPreProductBits),
    });
    const KEYS = ["operations", "euclideanSteps", "integerBits"] as const;
    const RESOLVER = {
      operations: 199_432,
      euclideanSteps: 37_559,
      integerBits: 497,
    };
    const CERTIFIER = {
      operations: 200_907,
      euclideanSteps: 51_861,
      integerBits: 373,
    };
    const RESOLVER_EXHAUSTED =
      "Joint query is not verified (uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.): the whole-request budget of all 7 joint queries is exhausted, not necessarily by this joint.";
    const resolverSnapshots: ExactProofBudgetSnapshot[] = [];
    const pairs: string[] = [];
    const { sizes, query: recorded } = recordingRequests(
      createCertifiedNeutralCurveRequestQueryWithBudgetObserverForTest(
        (snapshot) => resolverSnapshots.push(snapshot),
      ),
      (pair) =>
        pairs.push(
          `${pair.first.provenance.sourceSpanId}/${pair.second.provenance.sourceSpanId}`,
        ),
    );
    const certifierSnapshots: ExactProofBudgetSnapshot[] = [];
    const result = certifyDeclaredOffsetChain(
      declared,
      recorded,
      createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
        certifierSnapshots.push(snapshot),
      ),
    );
    expect(result.ok).toBe(true);
    expect(sizes).toEqual([7]);
    expect(pairs, "terminal first pass, then the deep requery").toEqual([
      "13/0",
      "12/0",
    ]);
    expect(resolverSnapshots.map(meterOf)).toEqual([
      { operations: 64 * 7, euclideanSteps: 0, integerBits: 0 },
      { operations: 45_191, euclideanSteps: 11_464, integerBits: 497 },
      RESOLVER,
    ]);
    expect(certifierSnapshots.map((snapshot) => snapshot.operations)).toEqual([
      11_562, 200_907,
    ]);
    expect(meterOf(certifierSnapshots.at(-1)!)).toEqual(CERTIFIER);
    const withResolver = (limits: Record<string, number>) =>
      certifyDeclaredOffsetChain(
        declared,
        createCertifiedNeutralCurveRequestQueryWithLowerBudgetForTest(limits),
        createCertifiedCubicTubeChain(),
      );
    const withCertifier = (limits: Record<string, number>) =>
      certifyDeclaredOffsetChain(
        declared,
        query,
        createCertifiedCubicTubeChainWithLowerBudgetForTest(limits),
      );
    for (const key of KEYS) {
      expect(withResolver({ [key]: RESOLVER[key] }).ok, `resolver ${key}`).toBe(
        true,
      );
      expect(
        withResolver({ [key]: RESOLVER[key] - 1 }),
        `resolver ${key} − 1`,
      ).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: RESOLVER_EXHAUSTED,
      });
      expect(
        withCertifier({ [key]: CERTIFIER[key] }).ok,
        `certifier ${key}`,
      ).toBe(true);
      expect(
        withCertifier({ [key]: CERTIFIER[key] - 1 }),
        `certifier ${key} − 1`,
      ).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      });
    }
    // Inside the deep requery's first query (after the first pass).
    expect(withResolver({ operations: 45_191 + 64 })).toMatchObject({
      ok: false,
      code: codes.topologyUncertain,
      message: RESOLVER_EXHAUSTED,
    });
    // Inside attempt 2's retry entry charge and inside its window cone.
    for (const cap of [11_563, 125_389])
      expect(
        withCertifier({ operations: cap }),
        `certifier @ ${cap}`,
      ).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message:
          "Tube stability is not certified: uncertain exact-query-proof-budget-exhausted: The deterministic exact-query arithmetic budget was exhausted.",
      });
  }, 120_000);

  test("Lemma T-W certifier literal (SL h0.4 d = −0.1, two window cones): count passes, count − 1 exhausts on operations, Euclid and bits", () => {
    const declared = declaredOf("SL h0.4 -0.1");
    const snapshots: ExactProofBudgetSnapshot[] = [];
    const result = certifyDeclaredOffsetChain(
      declared,
      query,
      createCertifiedCubicTubeChainWithBudgetObserverForTest((snapshot) =>
        snapshots.push(snapshot),
      ),
    );
    expect(result.ok).toBe(true);
    const last = snapshots.at(-1)!;
    const literal = {
      operations: last.operations,
      euclideanSteps: last.euclideanSteps,
      integerBits: Math.max(last.maxStoredBits, last.maxPreProductBits),
    };
    expect(literal).toEqual(G5D_CERTIFIER_LITERAL);
    for (const key of [
      "operations",
      "euclideanSteps",
      "integerBits",
    ] as const) {
      const under = (limit: number) =>
        certifyDeclaredOffsetChain(
          declared,
          query,
          createCertifiedCubicTubeChainWithLowerBudgetForTest({
            [key]: limit,
          }),
        );
      expect(under(literal[key]).ok, `${key} = count`).toBe(true);
      expect(under(literal[key] - 1), `${key} = count − 1`).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining("exact-query-proof-budget-exhausted"),
      });
    }
  }, 120_000);

  // Deep S2 (each spline↔spline resolution costs ≈ 8–14 s).
  test("deep S2: lens 0.4/−0.3 d = −0.2 verifies with both trims deep on both splines, glue at ¾ (k ≥ 2 only after ½)", () => {
    const { result, sizes, pairs } = run("SS lens 0.4/-0.3 -0.2");
    // G20: the ring of radius 1 (4 slots per joint); the pole-box prefilter
    // skips 6/0 and 7/1 at both joints, never the crossing pair 6/1.
    expect(sizes).toEqual([8]);
    expect(pairs).toEqual(["7/0", "6/1", "7/0", "6/1"]);
    expect(trimsOf(result)).toEqual([
      {
        kind: "graph-trim",
        jointIndex: 0,
        first: 6,
        second: 9,
        offsets: [1, 1],
        glue: [0.75, 0.75],
      },
      {
        kind: "graph-trim",
        jointIndex: 1,
        first: 14,
        second: 1,
        offsets: [1, 1],
        glue: [0.75, 0.75],
      },
    ]);
  }, 120_000);

  test("deep S2: lens 0.8/−0.6 d = −0.2 verifies with one deep side per trim, glue at ⅞ on the deep side", () => {
    const { result, sizes, pairs } = run("SS lens 0.8/-0.6 -0.2");
    expect(sizes).toEqual([8]);
    expect(pairs).toEqual(["13/0", "12/0", "9/0", "9/1"]);
    expect(trimsOf(result)).toEqual([
      {
        kind: "graph-trim",
        jointIndex: 0,
        first: 12,
        second: 14,
        offsets: [1, 0],
        glue: [0.5, 0.875],
      },
      {
        kind: "graph-trim",
        jointIndex: 1,
        first: 23,
        second: 1,
        offsets: [0, 1],
        glue: [0.875, 0.5],
      },
    ]);
  }, 120_000);

  test.each([
    [
      "SS lens 0.4/-0.3 -0.3",
      ["7/0"],
      "Offset joint has no crossing within one leaf of the corner: the corner trim may lie too deep inside the offset curve to verify (deep spline-to-spline corners are checked only one piece deep).",
    ],
    [
      "SS lens 0.8/-0.6 -0.3",
      ["13/0", "12/1"],
      "Offset joint has no crossing within one leaf of the corner: the corner trim may lie too deep inside the offset curve to verify (deep spline-to-spline corners are checked only one piece deep).",
    ],
    // A real U-B row: every pair of the terminal source spans beyond the
    // ring is pole-box disjoint, so no crossing lies anywhere in the spans.
    [
      "SS lens 0.4/-0.3 -0.4",
      ["9/0"],
      "Offset joint has no crossing on any leaf of the terminal source span: the offset corner lies beyond the terminal source span (U-B), or the offsets do not meet.",
    ],
  ] as const)(
    "G20: %s fails closed at joint 0 after the terminal query and the unskipped radius-1 ring pairs only: the too-deep text when a pair beyond the ring may hold the crossing, the U-B text when none can",
    (label, issued, message) => {
      const { result, sizes, pairs } = run(label);
      expect(result).toMatchObject({
        ok: false,
        code: codes.splineJointUnsupported,
        message,
      });
      expect(sizes, "(1 + 1)² slots per joint").toEqual([8]);
      expect(pairs).toEqual(issued);
    },
    120_000,
  );

  test.each([
    [
      "SS lens 0.4/-0.3 -0.1",
      "(leaves 7/8): uncertain trim-window-unproven: The emitted terminal hodograph is not proved inside the graph cone e (G1).",
    ],
    [
      "SS lens 0.8/-0.6 -0.1",
      "(leaves 11/12): uncertain trim-window-unproven: The vertex window of a terminal leaf is not proved inside it (t ≥ 1).",
    ],
  ] as const)(
    "%s (a refinement row, U-G7) keeps failing closed with its current code",
    (label, text) => {
      expect(run(label).result).toMatchObject({
        ok: false,
        code: codes.topologyUncertain,
        message: expect.stringContaining(text),
      });
    },
    120_000,
  );
});

describe("T08b-g7a: kinked line↔arc corners (P2 re-query rung, P3 two-leaf seed arcs, D5 proved arcs; native SEL and contract rows)", () => {
  const harness = createNativeArcOffsetHarness({
    authoring: createNativeArcAuthoring("sketch_g7a"),
    modelingTolerance: 1e-3,
    solveTolerances: SKETCH_DIRECT_EDIT_TOLERANCES,
  });
  const rotate = (vector: Vector, degrees: number): Vector => {
    const angle = (degrees * Math.PI) / 180;
    return [
      vector[0] * Math.cos(angle) - vector[1] * Math.sin(angle),
      vector[0] * Math.sin(angle) + vector[1] * Math.cos(angle),
    ];
  };
  const along = (point: Vector, direction: Vector, length = 1): Vector => [
    point[0] + length * direction[0],
    point[1] + length * direction[1],
  ];
  /** The ccw tangent of a circle about `center` at `point`. */
  const tangentAt = (center: Vector, point: Vector): Vector => {
    const length = Math.hypot(point[0] - center[0], point[1] - center[1]);
    return [-(point[1] - center[1]) / length, (point[0] - center[0]) / length];
  };
  const polarPoint = (center: Vector, radius: number, degrees: number) =>
    along(center, rotate([1, 0], degrees), radius);
  const declaredOf = (sketch: SeedArcSketchOf, distance: number) => {
    const { declared } = harness.adapt(sketch, distance);
    if (!declared.ok) throw new Error(`${declared.code}: ${declared.message}`);
    return declared;
  };
  type SeedArcSketchOf = Parameters<typeof harness.adapt>[0];
  /** SEL run recording certifier requests / attempts and query request sizes. */
  const ladderRun = (declared: DeclaredOffsetChainPieces) => {
    const { sizes, query: recorded } = recordingRequests();
    const requests: number[] = [];
    const attempts: { request: number; vertices: number[]; kind: string }[] =
      [];
    const certifier = createCertifiedCubicTubeChain();
    const result = certifyDeclaredOffsetChain(declared, recorded, {
      openRequest: (count) => {
        const index = requests.length;
        requests.push(count);
        const inner = certifier.openRequest(count);
        return {
          certifyPieceChain: (item) => {
            const raw = inner.certifyPieceChain(item);
            attempts.push({
              request: index,
              vertices: (item.vertices ?? []).map(
                (vertex) => vertex.jointIndex,
              ),
              kind: raw.kind,
            });
            return raw;
          },
        };
      },
    });
    return { result, requests, attempts, querySizes: sizes };
  };
  const leavesOf = (
    certificate: OffsetChainTubeStabilityCertificate,
    piece: number,
  ) =>
    certificate.seedArcs?.find((record) => record.piece === piece)?.leaves
      .length;

  /**
   * Open chain S → A → L1 (review R8): a native 3-point spline S, then a ccw
   * quarter arc A (r = 1) from S's end along S's end chord (a small kink,
   * absorbed at d = 0.01), then a line at an 11° concave kink (a Lemma-T°
   * trim). A adopts S's pole at its natural START (rank arc < spline; ρ_o
   * and its partition re-derived), next to its end trim (never eligible
   * before P2), and S cannot adopt an arc's pole: A adopts on the rung.
   */
  const arcStartRung = () => {
    const points: readonly Vector[] = [
      [-2, -0.3],
      [-1, -0.05],
      [0, 0],
    ];
    const spline = harness.spline(harness.empty(), points);
    const entity = spline.definition.entities.at(-1)!;
    if (entity.kind !== "spline") throw new Error("not a spline");
    const chord = Math.hypot(1, 0.05);
    const t: Vector = [1 / chord, 0.05 / chord];
    const start: Vector = [0, 0];
    const center: Vector = [-t[1], t[0]];
    const end = along(
      center,
      rotate([start[0] - center[0], start[1] - center[1]], 90),
    );
    const a = harness.arc(spline.definition, center, start, end, {
      start: entity.pointOccurrences.at(-1)!.pointId,
    });
    const l1 = harness.line(
      a.definition,
      end,
      along(end, rotate(tangentAt(center, end), 11)),
      { start: a.end },
    );
    return { definition: l1.definition, seeds: [spline.id, a.id, l1.id] };
  };

  test("T08b-g7 P2 review R8: an ARC adopts on the re-query rung at its natural start (ρ_o and its partition re-derived); its end trim is re-queried on the adopted arc (next to a spline keeper) with a request of Σ queryCount = 2 (a two-leaf arc side, P3), and the chain certifies on the rung's own attempt", () => {
    const run = ladderRun(declaredOf(arcStartRung(), 0.01));
    if (!run.result.ok) throw new Error(run.result.message);
    expect(run.result.resolved.vertices).toMatchObject([
      { jointIndex: 0, kind: "absorbed", keeper: "first" },
    ]);
    expect(run.result.resolved.joints.map((joint) => joint.jointIndex)).toEqual(
      [1],
    );
    expect(run.attempts).toEqual([
      { request: 1, vertices: [0], kind: "verified" },
    ]);
    expect(run.requests.at(-1)).toBe(1);
    // First pass, then the re-query of trim 1 on the adopted pieces: 1 + the
    // arc side's one inner leaf.
    expect(run.querySizes.at(-1)).toBe(2);
    expect(leavesOf(run.result.certificate, 1)).toBe(2);
    // ρ_o re-derived from the adopted start (S's emitted end pole).
    const adoptedArc = run.result.resolved.input.pieces[1]!;
    const kept = run.result.resolved.input.pieces[0]!;
    if (adoptedArc.kind !== "arc" || kept.kind !== "derivedCubic")
      throw new Error("not an arc after a spline");
    expect(adoptedArc.start).toEqual(kept.spans.at(-1)!.poles[3]);
    expect(adoptedArc.radius).toBe(
      canonicalArcSupport(
        adoptedArc.center,
        adoptedArc.start,
        adoptedArc.end,
        adoptedArc.sweepDirection,
      ).radius,
    );
  }, 120_000);

  /**
   * Open chain L0 → A → L1 (review R10): a 40° arc (one rule-B′ leaf by
   * sweep) trimmed at its START by a 10° concave kink, joined at its END to
   * a 0.01°-kinked line (absorbed). Its stepped reference R′ (ρ_s at the
   * trim, |V − C| at the declared end, unequal in binary64) needs the step
   * on an interior knot: P3 gives this open-chain arc two leaves.
   */
  const steppedOpenArc = () => {
    const center: Vector = [0.3, 1.1];
    const radius = Math.hypot(0.3, 1.1);
    const start: Vector = [0, 0];
    const startAngle = (Math.atan2(-1.1, -0.3) * 180) / Math.PI;
    const end = polarPoint(center, radius, startAngle + 40);
    const a = harness.arc(harness.empty(), center, start, end);
    const l0 = harness.line(
      a.definition,
      along(start, rotate(tangentAt(center, start), -10), -1),
      start,
      { end: a.start },
    );
    const l1 = harness.line(
      l0.definition,
      end,
      along(end, rotate(tangentAt(center, end), 0.01)),
      { start: a.end },
    );
    return { definition: l1.definition, seeds: [l0.id, a.id, l1.id] };
  };

  test("T08b-g7 P3 review R10 (open chain): a one-leaf-by-sweep arc whose natural start and end are both declared adjacencies takes two leaves on BOTH sides (owner and certifier share `seedArcMinimumLeaves`), so its stepped reference sits on the knot and the kinked inward trim certifies", () => {
    const declared = declaredOf(steppedOpenArc(), 0.01);
    const arc = declared.pieces[1]!;
    if (arc.kind !== "arc") throw new Error("not an arc");
    expect(arc.splits).toHaveLength(1);
    // The sweep alone admits one leaf (the predicate, not geometry, splits).
    expect(
      seedArcLeafSplits(
        arc.center,
        arc.start,
        arc.end,
        arc.sweepDirection,
        (
          declared.sources[1] as Extract<
            DeclaredOffsetPieceSource,
            { kind: "arc" }
          >
        ).source[0],
        (
          declared.sources[1] as Extract<
            DeclaredOffsetPieceSource,
            { kind: "arc" }
          >
        ).source[1],
      ),
    ).toEqual([]);
    const result = certifyDeclaredOffsetChain(
      declared,
      query,
      createCertifiedCubicTubeChain(),
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(leavesOf(result.certificate, 1)).toBe(2);
    expect(result.resolved.joints.map((joint) => joint.jointIndex)).toEqual([
      0,
    ]);
    expect(
      result.certificate.joins.filter((join) => join.kind === "arc-trim"),
    ).toHaveLength(1);
  }, 120_000);

  test("T08b-g7 P3 review R11: a micro fillet (r = 10⁻³, a 60° hexagon corner) in a closed chain keeps an admitted two-leaf partition and the outward offset certifies", () => {
    const hexagon = harness.polygon(
      harness.empty(),
      Array.from(
        { length: 6 },
        (_, k): Vector => polarPoint([0, 0], 1, 60 * k + 5.7),
      ),
    );
    const definition = harness.fillet(
      hexagon.definition,
      hexagon.ids[0]!,
      hexagon.ids[1]!,
      1e-3,
    );
    const declared = declaredOf(
      { definition, seeds: harness.lineArcSeeds(definition) },
      -0.01,
    );
    const arc = declared.pieces.find((piece) => piece.kind === "arc");
    if (arc?.kind !== "arc") throw new Error("no fillet arc");
    expect(arc.splits).toHaveLength(1);
    const result = certifyDeclaredOffsetChain(
      declared,
      query,
      createCertifiedCubicTubeChain(),
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    expect(
      result.certificate.seedArcs?.map((record) => record.leaves.length),
    ).toEqual([2]);
  }, 120_000);

  test("T08b-g7a review A4 (R11 intent): an ADOPTED inward micro fillet (r = 10⁻³ at a 60° hexagon corner, the line after it edited by Δ = 10⁻⁴, a 2.86° kink, d = 5·10⁻⁴ < r) adopts the line's pole at its start (shift ≈ 0.1 of its half sweep), keeps an admitted two-leaf partition and certifies (the tip certified it too)", () => {
    const hexagon = harness.polygon(
      harness.empty(),
      Array.from(
        { length: 6 },
        (_, k): Vector => polarPoint([0, 0], 1, 60 * k + 5.7),
      ),
    );
    const definition = harness.fillet(
      hexagon.definition,
      hexagon.ids[0]!,
      hexagon.ids[1]!,
      1e-3,
    );
    const seeds = harness.lineArcSeeds(definition);
    const line = seeds.find(
      (id) =>
        definition.entities.find((entity) => entity.entityId === id)?.kind ===
        "lineSegment",
    )!;
    const declared = declaredOf(
      { definition: withLineLength(definition, line, 1e-4), seeds },
      5e-4,
    );
    const arcIndex = declared.pieces.findIndex((piece) => piece.kind === "arc");
    const arc = declared.pieces[arcIndex]!;
    if (arc.kind !== "arc") throw new Error("no fillet arc");
    expect(arc.splits).toHaveLength(1);
    const result = certifyDeclaredOffsetChain(
      declared,
      query,
      createCertifiedCubicTubeChain(),
    );
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    const before =
      (arcIndex - 1 + declared.pieces.length) % declared.pieces.length;
    expect(
      result.resolved.vertices.find((vertex) => vertex.jointIndex === before),
    ).toMatchObject({ kind: "absorbed", keeper: "first" });
    // The arc adopted the line's emitted pole at its natural start.
    const adopted = result.resolved.input.pieces[arcIndex]!;
    if (adopted.kind !== "arc") throw new Error("not an arc");
    expect(adopted.start).not.toEqual(arc.start);
    const angle = (point: Vector) =>
      Math.atan2(point[1] - arc.center[1], point[0] - arc.center[0]);
    const shift = Math.abs(angle(adopted.start) - angle(arc.start));
    const halfSweep = Math.abs(angle(arc.end) - angle(arc.start)) / 2;
    expect(shift / halfSweep).toBeGreaterThan(0.05);
    expect(shift / halfSweep).toBeLessThan(0.5);
    expect(
      result.certificate.seedArcs?.map((record) => record.leaves.length),
    ).toEqual([2]);
  }, 120_000);

  /**
   * D5 contract rows (review R12): one convex declared line↔line vertex at
   * V = 0 with u₁ = (1, 0), d = −2⁻¹⁰⁷⁴ and τ = 5·2⁻¹⁰⁷⁴, so δ ≈ 2⁻¹⁰⁸⁴ and
   * G ≈ |g| on the subnormal grid, where the floor and ceiling square roots
   * of |g|² differ by one unit. Only the convex plan's data is read: the
   * two pieces' emitted terminal poles A′ (piece 0's end) and B′ (piece 1's
   * start) decide rule Z.
   */
  const unit = Number.MIN_VALUE;
  const d5Chain = (
    gap: Vector,
    outgoing: Vector,
    poles: readonly [Vector, Vector] = [
      [0, 1],
      [-1, 1],
    ],
  ) =>
    ({
      pieces: [
        {
          kind: "lineSegment",
          seedEntityId: "sketch_entity_d5_a",
          reversed: false,
          start: [-1, 1],
          end: poles[0],
        },
        {
          kind: "lineSegment",
          seedEntityId: "sketch_entity_d5_b",
          reversed: false,
          start: poles[1],
          end: [1, 1],
        },
      ],
      vertices: [
        {
          jointIndex: 0,
          authority: { kind: "sharedPoint", pointId: "sketch_point_d5" },
          first: {
            pointId: undefined,
            vertex: [0, 0],
            tangent: [
              [-1, 0],
              [0, 0],
            ],
          },
          second: {
            pointId: undefined,
            vertex: gap,
            tangent: [gap, [gap[0] + outgoing[0], gap[1] + outgoing[1]]],
          },
        },
      ],
      distance: -unit,
      modelingTolerance: 5 * unit,
    }) as unknown as Parameters<typeof offsetChainRequiredArcs>[0];

  test("T08b-g7 D5 review R12 (contract): a corner whose U-E upper bound G⁺ reaches τ but whose lower bound G⁻ does not (|g| = √20 units, τ = 5 units: ⌊√20⌋ = 4 < 5 ≤ ⌈√20⌉) is NOT a proved arc; |g| = 5 units (G⁻ = τ) is", () => {
    const outgoing: Vector = [1, 2 ** -10];
    expect(
      offsetChainRequiredArcs(d5Chain([4 * unit, 2 * unit], outgoing)),
    ).toEqual([]);
    expect(offsetChainRequiredArcs(d5Chain([5 * unit, 0], outgoing))).toEqual([
      0,
    ]);
    // D ≤ 0 (a 135° corner): no absorption exists, so the arc is proved.
    expect(offsetChainRequiredArcs(d5Chain([0, 0], [-1, 1]))).toEqual([0]);
  });

  test("T08b-g7 D5 review R12 (contract): rule Z (A′ = B′, or reversed ends) is never a proved arc, whatever G⁻ and D (no admissible arc: `splineJointUnsupported` stays)", () => {
    const outgoing: Vector = [1, 2 ** -10];
    const same: readonly [Vector, Vector] = [
      [0, 1],
      [0, 1],
    ];
    const reversed: readonly [Vector, Vector] = [
      [-1, 1],
      [0, 1],
    ];
    for (const poles of [same, reversed]) {
      expect(
        offsetChainRequiredArcs(d5Chain([5 * unit, 0], outgoing, poles)),
      ).toEqual([]);
      expect(offsetChainRequiredArcs(d5Chain([0, 0], [-1, 1], poles))).toEqual(
        [],
      );
    }
  });
});
