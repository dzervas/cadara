import { beforeAll, describe, expect, test } from "vitest";
import {
  evaluateNeutralCurve,
  type NeutralCurve,
  type NeutralCurveQueryCapability,
} from "@/contracts/modeling/neutral-curve-query";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import {
  boundaryLoopSignedArea,
  createRegionBoundaryBasis,
  regionBoundaryBasisOfArrangementInput,
  curveLength,
  resolveRegionBoundaryCurve,
  tessellateBoundaryLoop,
  type RegionBoundaryBasis,
  type ResolvedBoundaryCurve,
} from "@/contracts/sketch/region-boundary-curves";
import {
  addRectangle,
  FIXTURE_TOLERANCE,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  createSketchArrangementDeriver,
  type SketchArrangementDerivedCurve,
  type SketchArrangementInput,
} from "@/contracts/sketch/region-extraction";
import { regionBranchKey } from "@/contracts/sketch/region-identity";
import type {
  RegionBoundarySegmentRecord,
  RegionLoopRecord,
  RegionRecord,
} from "@/contracts/sketch/schema";
import type {
  SplinePoles,
  SplineVector,
} from "@/contracts/sketch/spline-geometry";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";

let capability: NeutralCurveQueryCapability;
beforeAll(async () => {
  capability = await createCertifiedNeutralCurveQueryCapabilityForTest();
});

const TAU = 2 * Math.PI;

/**
 * One recorded arrangement run: the owner's regions plus every curve the
 * query capability was called with, so a resolved curve can be compared with
 * the arrangement's own query input (not with a rebuild).
 */
async function recordedRun(input: SketchArrangementInput) {
  const queried: NeutralCurve[] = [];
  const recording: NeutralCurveQueryCapability = {
    queryNeutralCurves: (request) => {
      queried.push(request.first, request.second);
      return capability.queryNeutralCurves(request);
    },
    queryNeutralCurveSelfIntersections: (request) => {
      queried.push(request.curve);
      return capability.queryNeutralCurveSelfIntersections(request);
    },
    queryNeutralCurveJoin: (request) => {
      queried.push(request.first, request.second);
      return capability.queryNeutralCurveJoin(request);
    },
  };
  const result = await createSketchArrangementDeriver(recording).derive(input);
  return {
    result,
    queried,
    // Consumers' pair-shaped constructor; fabricated shells (no offset
    // relationship) need the arrangement-input fields as given.
    basis: input.derivedCurves
      ? regionBoundaryBasisOfArrangementInput(input, result.regions)
      : createRegionBoundaryBasis(input, result.regions),
  };
}

const segmentsOf = (regions: readonly RegionRecord[]) =>
  regions.flatMap((region) => region.loops.flatMap((loop) => loop.segments));
const entityOf = (segment: RegionBoundarySegmentRecord) =>
  segment.branch.source.kind === "entity"
    ? segment.branch.source.entityId.replace("sketch_entity_", "")
    : "projected";

function resolved(
  basis: RegionBoundaryBasis,
  segment: RegionBoundarySegmentRecord,
): ResolvedBoundaryCurve {
  const result = resolveRegionBoundaryCurve(basis, segment);
  if (result.kind !== "resolved") throw new Error(result.message);
  return result;
}

/**
 * Every segment resolves to a curve the arrangement itself queried (deep
 * equality with a recorded query input, curve id = the branch key), with the
 * record's interval and traversal and the documented kernel mapping.
 */
function expectArrangementCurves(run: Awaited<ReturnType<typeof recordedRun>>) {
  const segments = segmentsOf(run.result.regions);
  expect(segments.length).toBeGreaterThan(0);
  for (const segment of segments) {
    const curve = resolved(run.basis, segment);
    const label = `${entityOf(segment)} ${segment.branch.spanId} [${segment.sourceParameterInterval}]`;
    expect(
      run.queried,
      `${label}: a curve the arrangement queried`,
    ).toContainEqual(curve.curve);
    expect(curve.curve.curveId, label).toBe(regionBranchKey(segment.branch));
    expect(curve.sourceInterval, label).toBe(segment.sourceParameterInterval);
    expect(curve.traversal, label).toBe(segment.traversalDirection);
    const [a, b] = segment.sourceParameterInterval;
    if (curve.curve.kind === "cubicBezier") {
      const [s0, s1] = curve.curve.sourceDomain;
      const local = (t: number) =>
        t === s0 ? 0 : t === s1 ? 1 : (t - s0) / (s1 - s0);
      expect(curve.kernelInterval, label).toEqual([local(a), local(b)]);
    } else expect(curve.kernelInterval, label).toEqual([a, b]);
  }
}

// ---------------------------------------------------------------------------
// Independent oracles (spec-only; written separately from
// `certifyNeutralCurvePieceSignedArea`): closed-form Green terms per piece
// (segment: ½ p × q; arc: ½ (c − o) × chord + ½ r² Δθ; cubic: exact power-
// basis integral of x y′ − y x′) plus straight connectors, from one origin.
// ---------------------------------------------------------------------------

type OraclePiece =
  | {
      kind: "line";
      start: SplineVector;
      end: SplineVector;
      from: number;
      to: number;
    }
  | {
      kind: "arc";
      center: SplineVector;
      radius: number;
      from: number;
      to: number;
    }
  | {
      kind: "cubic";
      poles: SplinePoles;
      domain: readonly [number, number];
      from: number;
      to: number;
    };

const lerp = (a: SplineVector, b: SplineVector, t: number): SplineVector => [
  a[0] + t * (b[0] - a[0]),
  a[1] + t * (b[1] - a[1]),
];

function powerBasis(poles: SplinePoles) {
  const [p0, p1, p2, p3] = poles;
  return [0, 1].map((axis) => [
    p0[axis]!,
    3 * (p1[axis]! - p0[axis]!),
    3 * (p0[axis]! - 2 * p1[axis]! + p2[axis]!),
    -p0[axis]! + 3 * p1[axis]! - 3 * p2[axis]! + p3[axis]!,
  ]) as [number[], number[]];
}

const localOf = (domain: readonly [number, number], t: number) =>
  (t - domain[0]) / (domain[1] - domain[0]);

function oraclePoint(piece: OraclePiece, t: number): SplineVector {
  if (piece.kind === "line") return lerp(piece.start, piece.end, t);
  if (piece.kind === "arc")
    return [
      piece.center[0] + piece.radius * Math.cos(t),
      piece.center[1] + piece.radius * Math.sin(t),
    ];
  const u = localOf(piece.domain, t);
  const [x, y] = powerBasis(piece.poles);
  const at = (c: number[]) => c[0]! + u * (c[1]! + u * (c[2]! + u * c[3]!));
  return [at(x), at(y)];
}

const cross = (p: SplineVector, q: SplineVector) => p[0] * q[1] - p[1] * q[0];
const minus = (p: SplineVector, q: SplineVector): SplineVector => [
  p[0] - q[0],
  p[1] - q[1],
];

function oraclePieceArea(piece: OraclePiece, origin: SplineVector): number {
  const start = minus(oraclePoint(piece, piece.from), origin);
  const end = minus(oraclePoint(piece, piece.to), origin);
  if (piece.kind === "line") return 0.5 * cross(start, end);
  if (piece.kind === "arc")
    return (
      0.5 * cross(minus(piece.center, origin), minus(end, start)) +
      0.5 * piece.radius * piece.radius * (piece.to - piece.from)
    );
  const shifted = piece.poles.map((pole) =>
    minus(pole, origin),
  ) as unknown as SplinePoles;
  const [x, y] = powerBasis(shifted);
  const u0 = localOf(piece.domain, piece.from);
  const u1 = localOf(piece.domain, piece.to);
  let total = 0;
  for (let j = 0; j < 4; j += 1)
    for (let k = 1; k < 4; k += 1) {
      const coefficient = k * (x[j]! * y[k]! - y[j]! * x[k]!);
      const power = j + k;
      total += (coefficient * (u1 ** power - u0 ** power)) / power;
    }
  return 0.5 * total;
}

function oracleLoopArea(pieces: readonly OraclePiece[], connectors = true) {
  const origin = oraclePoint(pieces[0]!, pieces[0]!.from);
  let total = 0;
  pieces.forEach((piece, index) => {
    total += oraclePieceArea(piece, origin);
    const next = pieces[(index + 1) % pieces.length]!;
    if (connectors)
      total +=
        0.5 *
        cross(
          minus(oraclePoint(piece, piece.to), origin),
          minus(oraclePoint(next, next.from), origin),
        );
  });
  return total;
}

/** Oracle pieces of one loop, read from the fixture's own data by record. */
function oraclePieces(
  loop: RegionLoopRecord,
  input: SketchArrangementInput,
): OraclePiece[] {
  const solved = new Map(
    input.solvedSnapshot.solvedEntities.map((entity) => [
      entity.entityId,
      entity,
    ]),
  );
  return loop.segments.map((segment): OraclePiece => {
    const [lo, hi] = segment.sourceParameterInterval;
    const [from, to] =
      segment.traversalDirection === "forward" ? [lo, hi] : [hi, lo];
    const source = segment.branch.source;
    if (source.kind === "projectedGeometry") {
      const geometry = input.projectedReferences
        .find(
          (reference) => reference.referenceId === source.reference.referenceId,
        )!
        .geometry.find(
          (item) => item.geometryId === source.reference.geometryId,
        )!;
      if (
        geometry.kind !== "spline" ||
        geometry.representation.kind !== "neutralCubicSpans"
      )
        throw new Error("oracle: projected splines only");
      const span =
        geometry.representation.spans[Number(segment.branch.spanId.slice(4))]!;
      return {
        kind: "cubic",
        poles: span.poles,
        domain: span.interval,
        from,
        to,
      };
    }
    const shell = input.derivedCurves?.find(
      (curve) => curve.outputEntityId === source.entityId,
    );
    if (shell) {
      const span = shell.spans.find(
        (candidate) =>
          candidate.outputSpanId === segment.branch.spanId &&
          candidate.sourceDomain[0] <= lo &&
          hi <= candidate.sourceDomain[1],
      )!;
      return {
        kind: "cubic",
        poles: span.poles,
        domain: span.sourceDomain,
        from,
        to,
      };
    }
    const geometry = solved.get(source.entityId)!;
    if (geometry.kind === "lineSegment")
      return {
        kind: "line",
        start: geometry.startPosition,
        end: geometry.endPosition,
        from,
        to,
      };
    if (geometry.kind === "spline") {
      const span = geometry.reconstruction.spans.find(
        (candidate) =>
          `${candidate.source.startOccurrenceId}>${candidate.source.endOccurrenceId}` ===
          segment.branch.spanId,
      )!;
      return {
        kind: "cubic",
        poles: span.poles,
        domain: span.interval,
        from,
        to,
      };
    }
    if (geometry.kind === "circle")
      return {
        kind: "arc",
        center: geometry.centerPosition,
        radius: geometry.solvedRadius,
        from,
        to,
      };
    if (geometry.kind === "arc")
      return {
        kind: "arc",
        center: geometry.centerPosition,
        radius: Math.hypot(
          geometry.startPosition[0] - geometry.centerPosition[0],
          geometry.startPosition[1] - geometry.centerPosition[1],
        ),
        from,
        to,
      };
    throw new Error(`oracle: no ${geometry.kind}`);
  });
}

/** The certified loop interval contains the independent oracle. */
function expectAreaContainsOracle(
  basis: RegionBoundaryBasis,
  loop: RegionLoopRecord,
  input: SketchArrangementInput,
  label: string,
) {
  const area = boundaryLoopSignedArea(basis, loop);
  if (area.kind !== "measured") throw new Error(area.message);
  const oracle = oracleLoopArea(oraclePieces(loop, input));
  expect(
    area.interval[0] <= oracle && oracle <= area.interval[1],
    `${label}: oracle ${oracle} in [${area.interval}]`,
  ).toBe(true);
  expect(area.value, label).toBe(
    area.interval[0] + (area.interval[1] - area.interval[0]) / 2,
  );
  return { area, oracle };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function lemniscate(sketch: SketchFixture) {
  const names = [...Array(8).keys()].map((k) => {
    const t = Math.PI / 8 + (k * Math.PI) / 4;
    sketch.point(
      `p${k}`,
      Math.round(6 * Math.cos(t) * 1000) / 1000,
      Math.round(6 * Math.sin(t) * Math.cos(t) * 1000) / 1000,
    );
    return `p${k}`;
  });
  sketch.spline("fig", names, "smooth");
}

function roundedRectangle(sketch: SketchFixture) {
  const [w, h, r] = [10, 6, 1.5];
  const P = (name: string, x: number, y: number) => sketch.point(name, x, y);
  P("a", r, 0);
  P("b", w - r, 0);
  P("c", w, r);
  P("d", w, h - r);
  P("e", w - r, h);
  P("f", r, h);
  P("g", 0, h - r);
  P("h", 0, r);
  P("k1", w - r, r);
  P("k2", w - r, h - r);
  P("k3", r, h - r);
  P("k4", r, r);
  sketch.line("l1", "a", "b");
  sketch.arc("a1", "k1", "b", "c");
  sketch.line("l2", "c", "d");
  sketch.arc("a2", "k2", "d", "e");
  sketch.line("l3", "e", "f");
  sketch.arc("a3", "k3", "f", "g");
  sketch.line("l4", "g", "h");
  sketch.arc("a4", "k4", "h", "a");
}

/** de Casteljau split of a cubic at u = 1/2 (exact in binary64 for these poles). */
function halves(poles: SplinePoles): [SplinePoles, SplinePoles] {
  const mid = (a: SplineVector, b: SplineVector): SplineVector => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const [p0, p1, p2, p3] = poles;
  const a = mid(p0, p1);
  const b = mid(p1, p2);
  const c = mid(p2, p3);
  const d = mid(a, b);
  const e = mid(b, c);
  const m = mid(d, e);
  return [
    [p0, a, d, m],
    [m, e, c, p3],
  ];
}

const ARCH: SplinePoles = [
  [0, 0],
  [1, 3],
  [3, 3],
  [4, 0],
];
const TRIM = 0.125;

/**
 * An open derived shell of one output span `s` in two sub-spans ([0, ½] and
 * [½, 1], knot = a declared port), trimmed at its start at TRIM; a line from
 * its end E back to its trim point T closes the loop.
 */
function trimmedShell() {
  const [left, right] = halves(ARCH);
  const shell: SketchArrangementDerivedCurve = {
    outputEntityId: "sketch_entity_shell" as SketchEntityId,
    startPointId: "sketch_point_T" as SketchPointId,
    endPointId: "sketch_point_E" as SketchPointId,
    spans: [
      {
        outputSpanId: "s",
        subIndex: 0,
        poles: left,
        sourceDomain: [0, 0.5],
        queryDomain: [TRIM, 0.5],
      },
      {
        outputSpanId: "s",
        subIndex: 1,
        poles: right,
        sourceDomain: [0.5, 1],
        queryDomain: [0.5, 1],
      },
    ],
  };
  const trim = evaluateNeutralCurve(
    {
      kind: "cubicBezier",
      curveId: "trim",
      provenance: { sourceEntityId: "shell", sourceSpanId: "s" },
      poles: left,
      sourceDomain: [0, 0.5],
    },
    TRIM,
  );
  const sketch = makeSketchFixture();
  sketch.point("T", trim[0], trim[1]);
  sketch.point("E", ARCH[3][0], ARCH[3][1]);
  sketch.line("L", "E", "T");
  return { input: sketch.build({ derivedCurves: [shell] }), shell };
}

/**
 * A closed derived shell (the smooth closed spline `src`'s spans, the first
 * split at its parameter midpoint into two sub-spans) inside a circle.
 */
function shellAnnulus() {
  const source = makeSketchFixture();
  [
    [3, 0],
    [0, 2],
    [-3, 0],
    [0, -2],
  ].forEach(([x, y], index) => source.point(`s${index}`, x!, y!));
  source.spline("src", ["s0", "s1", "s2", "s3"], "smooth");
  const record = source.build().solvedSnapshot.solvedEntities[0]!;
  if (record.kind !== "spline" || record.reconstruction.validity !== "valid")
    throw new Error("fixture: invalid source spline");
  const spans = record.reconstruction.spans;
  const id = (index: number) =>
    `${spans[index]!.source.startOccurrenceId}>${spans[index]!.source.endOccurrenceId}`;
  const [s0, s1] = spans[0]!.interval;
  const middle = s0 + (s1 - s0) / 2;
  const [left, right] = halves(spans[0]!.poles);
  const shell: SketchArrangementDerivedCurve = {
    outputEntityId: "sketch_entity_shell" as SketchEntityId,
    startPointId: "sketch_point_J" as SketchPointId,
    endPointId: "sketch_point_J" as SketchPointId,
    spans: [
      {
        outputSpanId: id(0),
        subIndex: 0,
        poles: left,
        sourceDomain: [s0, middle],
        queryDomain: [s0, middle],
      },
      {
        outputSpanId: id(0),
        subIndex: 1,
        poles: right,
        sourceDomain: [middle, s1],
        queryDomain: [middle, s1],
      },
      ...spans.slice(1).map((span, offset) => ({
        outputSpanId: id(offset + 1),
        subIndex: 0,
        poles: span.poles,
        sourceDomain: span.interval,
        queryDomain: span.interval,
      })),
    ],
  };
  const sketch = makeSketchFixture();
  sketch.point("J", spans[0]!.poles[0][0], spans[0]!.poles[0][1]);
  sketch.point("c", 0, 0);
  sketch.circle("ring", "c", 6);
  return { input: sketch.build({ derivedCurves: [shell] }), shell };
}

/** A forged copy of `region` whose loops are mapped segment by segment. */
function forged(
  region: RegionRecord,
  map: (segment: RegionBoundarySegmentRecord) => RegionBoundarySegmentRecord,
): RegionRecord {
  return {
    ...region,
    loops: region.loops.map((loop) => ({
      ...loop,
      segments: loop.segments.map(map),
    })),
  };
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

describe("region-boundary curve owner: every record resolves to the arrangement's own curve", () => {
  test("lines: endpoint segments, kernel = source on [0, 1]", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 5], "coincident");
    const run = await recordedRun(sketch.build());
    expect(run.result.regions).toHaveLength(1);
    expectArrangementCurves(run);
    for (const segment of segmentsOf(run.result.regions)) {
      const curve = resolved(run.basis, segment);
      expect(curve.curve.kind).toBe("line");
      expect(curve.kernelInterval).toEqual([0, 1]);
    }
  });

  test("arcs: an interval starting below 0 (atan2) and a major arc whose interval ends past 2π", async () => {
    const rounded = makeSketchFixture();
    roundedRectangle(rounded);
    const run = await recordedRun(rounded.build());
    expect(run.result.regions).toHaveLength(1);
    expectArrangementCurves(run);
    const a1 = segmentsOf(run.result.regions).find(
      (segment) => entityOf(segment) === "a1",
    )!;
    const arc = resolved(run.basis, a1);
    expect(arc.curve.kind).toBe("circle");
    expect(arc.kernelInterval[0], "θ_lo < 0").toBeLessThan(0);
    expect(arc.kernelInterval).toEqual(a1.sourceParameterInterval);

    // A ccw major arc from π/2 to π/6 (+2π) closed by its chord.
    const major = makeSketchFixture();
    major.point("k", 0, 0);
    major.point("s", 0, 3);
    major.point("e", 3 * Math.cos(Math.PI / 6), 3 * Math.sin(Math.PI / 6));
    major.arc("m", "k", "s", "e");
    major.line("chord", "e", "s");
    const majorRun = await recordedRun(major.build());
    expect(majorRun.result.regions).toHaveLength(1);
    expectArrangementCurves(majorRun);
    const m = segmentsOf(majorRun.result.regions).find(
      (segment) => entityOf(segment) === "m",
    )!;
    expect(
      resolved(majorRun.basis, m).kernelInterval[1],
      "past 2π",
    ).toBeGreaterThan(TAU);
  });

  test("circles: whole (unsplit, [0, 2π]) and split by a line (a wrap edge past 2π)", async () => {
    const whole = makeSketchFixture();
    whole.point("c", 0, 0);
    whole.circle("outer", "c", 6);
    whole.circle("inner", "c", 2);
    const run = await recordedRun(whole.build());
    expect(run.result.regions).toHaveLength(2);
    expectArrangementCurves(run);
    for (const segment of segmentsOf(run.result.regions)) {
      expect([segment.start, segment.end]).toEqual([null, null]);
      expect(resolved(run.basis, segment).kernelInterval).toEqual([0, TAU]);
    }

    const split = makeSketchFixture();
    split.point("c", 0, 0);
    split.circle("k", "c", 6);
    split.point("p", -8, 1);
    split.point("q", 8, 1);
    split.line("cut", "p", "q");
    const splitRun = await recordedRun(split.build());
    expect(splitRun.result.regions).toHaveLength(2);
    expectArrangementCurves(splitRun);
    const intervals = segmentsOf(splitRun.result.regions)
      .filter((segment) => entityOf(segment) === "k")
      .map((segment) => resolved(splitRun.basis, segment).kernelInterval);
    expect(intervals).toHaveLength(2);
    expect(
      intervals.some(([, b]) => b > TAU),
      "the wrap edge ends past 2π",
    ).toBe(true);
  });

  test("ordinary spline spans (figure-eight lobes, verified crossings) and projected neutral spans", async () => {
    const lobes = makeSketchFixture();
    lemniscate(lobes);
    const run = await recordedRun(lobes.build());
    expect(run.result.regions).toHaveLength(2);
    expectArrangementCurves(run);
    expect(
      segmentsOf(run.result.regions).every((segment) =>
        segment.branch.spanId.includes(">"),
      ),
    ).toBe(true);

    const projected = makeSketchFixture();
    addRectangle(projected, "r", [0, 0, 10, 10]);
    projected.project("loop", [
      projectedSpline("projected_geometry_loop", [
        neutralSpan(
          [
            [2, 5],
            [2, 8],
            [8, 8],
            [8, 5],
          ],
          0,
          ["o0", "o1"],
          0,
        ),
        neutralSpan(
          [
            [8, 5],
            [8, 2],
            [2, 2],
            [2, 5],
          ],
          1,
          ["o1", "o0"],
          1,
        ),
      ]),
    ]);
    const projectedRun = await recordedRun(projected.build());
    expect(projectedRun.result.regions).toHaveLength(2);
    expectArrangementCurves(projectedRun);
    const spans = segmentsOf(projectedRun.result.regions).filter(
      (segment) => entityOf(segment) === "projected",
    );
    expect(spans.map((segment) => segment.branch.spanId).sort()).toEqual([
      "span0",
      "span0",
      "span1",
      "span1",
    ]);
  }, 60_000);

  test("projected source samples are unsupported", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 10]);
    sketch.project("samples", [
      {
        geometryId:
          "projected_geometry_samples" as `projected_geometry_${string}`,
        kind: "spline",
        representation: {
          kind: "sourceSamples",
          points: [
            [20, 0],
            [21, 1],
            [22, 0],
          ],
          isClosed: false,
        },
      },
    ]);
    const input = sketch.build();
    const run = await recordedRun(input);
    expect(run.result.regions).toHaveLength(1);
    // A forged record on the sampled geometry, bound to the basis.
    const samples = forged(run.result.regions[0]!, (segment) => ({
      ...segment,
      branch: {
        source: {
          kind: "projectedGeometry",
          reference: {
            kind: "projectedSpline",
            referenceId: input.projectedReferences[0]!.referenceId,
            geometryId:
              "projected_geometry_samples" as `projected_geometry_${string}`,
          },
        },
        spanId: "span0",
      },
    }));
    const basis = createRegionBoundaryBasis(input, [
      ...run.result.regions,
      samples,
    ]);
    const result = resolveRegionBoundaryCurve(
      basis,
      samples.loops[0]!.segments[0]!,
    );
    expect(result.kind === "failed" && result.code).toBe(
      "profile-boundary-unsupported",
    );
  });

  test("shell sub-spans: knot-boundary intervals pick their own sub-span; a trimmed terminal sub-span resolves on its queryDomain", async () => {
    const { input, shell } = trimmedShell();
    const run = await recordedRun(input);
    expect(run.result.regions).toHaveLength(1);
    expectArrangementCurves(run);
    const shellSegments = segmentsOf(run.result.regions).filter(
      (segment) => entityOf(segment) === "shell",
    );
    expect(
      shellSegments.map((segment) => segment.sourceParameterInterval).sort(),
    ).toEqual([
      [TRIM, 0.5],
      [0.5, 1],
    ]);
    for (const segment of shellSegments) {
      const curve = resolved(run.basis, segment);
      if (curve.curve.kind !== "cubicBezier") throw new Error("a shell cubic");
      const own = shell.spans.find(
        (span) =>
          span.sourceDomain[0] <= segment.sourceParameterInterval[0] &&
          segment.sourceParameterInterval[1] <= span.sourceDomain[1],
      )!;
      expect(curve.curve.poles, "the sub-span's own untrimmed poles").toBe(
        own.poles,
      );
      expect(curve.curve.sourceDomain).toEqual(own.sourceDomain);
      expect(curve.kernelInterval).toEqual(
        segment.sourceParameterInterval[0] === TRIM ? [TRIM / 0.5, 1] : [0, 1],
      );
    }

    const annulus = shellAnnulus();
    const annulusRun = await recordedRun(annulus.input);
    expect(annulusRun.result.regions).toHaveLength(2);
    expectArrangementCurves(annulusRun);
    const knotted = segmentsOf(annulusRun.result.regions).filter(
      (segment) =>
        entityOf(segment) === "shell" &&
        segment.branch.spanId === annulus.shell.spans[0]!.outputSpanId,
    );
    // Both sub-spans of the split output span, in both regions.
    expect(knotted).toHaveLength(4);
    for (const segment of knotted) {
      const curve = resolved(annulusRun.basis, segment);
      const sub = annulus.shell.spans.findIndex(
        (span) =>
          span.outputSpanId === segment.branch.spanId &&
          span.sourceDomain[0] === segment.sourceParameterInterval[0] &&
          span.sourceDomain[1] === segment.sourceParameterInterval[1],
      );
      expect(
        sub,
        "a knot-boundary interval is one whole sub-span",
      ).toBeGreaterThanOrEqual(0);
      expect(curve.curve.kind === "cubicBezier" && curve.curve.poles).toBe(
        annulus.shell.spans[sub]!.poles,
      );
      expect(curve.kernelInterval).toEqual([0, 1]);
    }
  }, 120_000);

  test("unresolved: a non-accepted shell, intervals outside the span, sub-span or queryDomain, and a record of another basis (R2)", async () => {
    const { input } = trimmedShell();
    const run = await recordedRun(input);
    const region = run.result.regions[0]!;
    const unresolved = (
      basis: RegionBoundaryBasis,
      segment: RegionBoundarySegmentRecord,
    ) => {
      const result = resolveRegionBoundaryCurve(basis, segment);
      expect(
        result.kind === "failed" && result.code,
        `[${segment.sourceParameterInterval}]`,
      ).toBe("profile-boundary-unresolved");
    };
    const shellSegment = (records: RegionRecord) =>
      records.loops[0]!.segments.find(
        (segment) =>
          entityOf(segment) === "shell" &&
          segment.sourceParameterInterval[0] === TRIM,
      )!;

    // The same records against the pair in which the shell is not accepted:
    // it is absent from that pair's branch set.
    const notAccepted = regionBoundaryBasisOfArrangementInput(
      {
        ...input,
        derivedCurves: [],
        unpublishedOffsetOutputs: [
          {
            entityId: "sketch_entity_shell" as SketchEntityId,
            derivationId: "derivation_x",
            reason: "offset relationship derivation_x failed its publication",
          },
        ],
      },
      run.result.regions,
    );
    unresolved(notAccepted, shellSegment(region));
    // The line still resolves there.
    expect(
      resolveRegionBoundaryCurve(
        notAccepted,
        region.loops[0]!.segments.find((segment) => entityOf(segment) === "L")!,
      ).kind,
    ).toBe("resolved");

    const intervals: [string, readonly [number, number]][] = [
      [
        "inside sourceDomain, before the trim (outside queryDomain)",
        [TRIM / 2, 0.5],
      ],
      ["across the knot (two sub-spans, none contains it)", [0.25, 0.75]],
      ["past the span end", [0.5, 1.5]],
      ["empty", [0.5, 0.5]],
    ];
    const forgedRegions = intervals.map(([, interval]) =>
      forged(region, (segment) =>
        entityOf(segment) === "shell" &&
        segment.sourceParameterInterval[0] === TRIM
          ? { ...segment, sourceParameterInterval: interval }
          : segment,
      ),
    );
    const basis = regionBoundaryBasisOfArrangementInput(input, [
      ...run.result.regions,
      ...forgedRegions,
    ]);
    const index = region.loops[0]!.segments.indexOf(shellSegment(region));
    for (const records of forgedRegions)
      unresolved(basis, records.loops[0]!.segments[index]!);
    // A line interval outside [0, 1].
    const line = forged(region, (segment) =>
      entityOf(segment) === "L"
        ? { ...segment, sourceParameterInterval: [0, 1.5] }
        : segment,
    );
    unresolved(
      regionBoundaryBasisOfArrangementInput(input, [line]),
      line.loops[0]!.segments.find((segment) => entityOf(segment) === "L")!,
    );
    // R2: a structurally equal record that is not one of the basis's own.
    unresolved(run.basis, structuredClone(shellSegment(region)));
    // A basis that did not come from the constructor in this realm (a
    // structured clone, e.g. across a worker) is a named error, not a
    // TypeError.
    expect(() =>
      resolveRegionBoundaryCurve(
        structuredClone(run.basis),
        shellSegment(region),
      ),
    ).toThrow(
      "region boundary basis was not created by createRegionBoundaryBasis in this realm",
    );
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

describe("region-boundary curve owner: certified loop area contains the independent Green oracle", () => {
  test("spline lobes of a figure-eight (verified-crossing vertices)", async () => {
    const sketch = makeSketchFixture();
    lemniscate(sketch);
    const input = sketch.build();
    const run = await recordedRun(input);
    expect(run.result.regions).toHaveLength(2);
    for (const region of run.result.regions) {
      const { area, oracle } = expectAreaContainsOracle(
        run.basis,
        region.loops[0]!,
        input,
        "lobe",
      );
      expect(oracle).toBeGreaterThan(1);
      // Crossings carry witness enclosures; the smooth knots are declared
      // joins, so the width is their join-box allowance (τ-scale).
      expect(
        region.loops[0]!.segments.some(
          (segment) => segment.start?.kind === "verifiedIntersection",
        ),
      ).toBe(true);
      expect(area.interval[1] - area.interval[0]).toBeLessThan(
        FIXTURE_TOLERANCE,
      );
    }
  }, 60_000);

  test("annulus: a circle hole inside a smooth closed spline", async () => {
    const sketch = makeSketchFixture();
    [
      [6, 0],
      [0, 5],
      [-6, 0],
      [0, -5],
    ].forEach(([x, y], index) => sketch.point(`s${index}`, x!, y!));
    sketch.spline("outer", ["s0", "s1", "s2", "s3"], "smooth");
    sketch.point("c", 0, 0);
    sketch.circle("hole", "c", 2);
    const input = sketch.build();
    const run = await recordedRun(input);
    const annulus = run.result.regions.find(
      (region) => region.loops.length === 2,
    )!;
    expect(annulus.loops.map((loop) => loop.role)).toEqual(["outer", "inner"]);
    const outer = expectAreaContainsOracle(
      run.basis,
      annulus.loops[0]!,
      input,
      "outer",
    );
    const inner = expectAreaContainsOracle(
      run.basis,
      annulus.loops[1]!,
      input,
      "hole",
    );
    expect(outer.oracle).toBeGreaterThan(0);
    // The hole is clockwise: −πr².
    expect(Math.abs(inner.oracle + Math.PI * 4)).toBeLessThan(1e-12);
  }, 60_000);

  test("mixed line, arc (θ_lo < 0) and cubic spans", async () => {
    const sketch = makeSketchFixture();
    sketch.point("A", 0, 0);
    sketch.point("B", 10, 0);
    sketch.point("K", 10, 3);
    sketch.point("C", 10, 6);
    sketch.point("D", 5, 8.5);
    sketch.point("E", 0, 6);
    sketch.line("base", "A", "B");
    sketch.arc("bulge", "K", "B", "C");
    sketch.spline("top", ["C", "D", "E"], "open");
    sketch.line("side", "E", "A");
    const input = sketch.build();
    const run = await recordedRun(input);
    expect(run.result.regions).toHaveLength(1);
    expectArrangementCurves(run);
    const loop = run.result.regions[0]!.loops[0]!;
    expect([...new Set(loop.segments.map(entityOf))].sort()).toEqual([
      "base",
      "bulge",
      "side",
      "top",
    ]);
    const { oracle } = expectAreaContainsOracle(
      run.basis,
      loop,
      input,
      "mixed",
    );
    expect(oracle).toBeGreaterThan(60);
  }, 60_000);

  test("shell annulus: a closed derived shell (split sub-span) as the hole of a circle, and the shell disk", async () => {
    const { input } = shellAnnulus();
    const run = await recordedRun(input);
    expect(run.result.regions).toHaveLength(2);
    const annulus = run.result.regions.find(
      (region) => region.loops.length === 2,
    )!;
    const disk = run.result.regions.find(
      (region) => region.loops.length === 1,
    )!;
    const hole = expectAreaContainsOracle(
      run.basis,
      annulus.loops[1]!,
      input,
      "shell hole",
    );
    const own = expectAreaContainsOracle(
      run.basis,
      disk.loops[0]!,
      input,
      "shell disk",
    );
    expectAreaContainsOracle(run.basis, annulus.loops[0]!, input, "ring");
    expect(hole.oracle).toBeLessThan(0);
    expect(Math.abs(hole.oracle + own.oracle)).toBeLessThan(1e-9);
  }, 60_000);

  test("a three-member join class (spokes meeting within τ): the interval contains the realized loop and the loop routed through the record's join position", async () => {
    const sketch = makeSketchFixture();
    const g = 0.4 * FIXTURE_TOLERANCE;
    sketch.point("A", 0, 0);
    sketch.point("B", 10, 0);
    sketch.point("C", 5, 9);
    sketch.point("o1", 5, 3);
    sketch.point("o2", 5 + g, 3);
    sketch.point("o3", 5, 3 + g);
    sketch.line("ab", "A", "B");
    sketch.line("bc", "B", "C");
    sketch.line("ca", "C", "A");
    sketch.line("sa", "A", "o1");
    sketch.line("sb", "B", "o2");
    sketch.line("sc", "C", "o3");
    sketch.coincident("o1", "o2");
    sketch.coincident("o2", "o3");
    const input = sketch.build();
    const run = await recordedRun(input);
    expect(run.result.regions).toHaveLength(3);
    for (const region of run.result.regions) {
      const loop = region.loops[0]!;
      const hub = loop.segments.find(
        (segment) =>
          segment.start?.kind === "declaredJoin" &&
          segment.start.pointIds.length === 3,
      );
      expect(hub, "the loop visits the three-member class").toBeDefined();
      const { area } = expectAreaContainsOracle(
        run.basis,
        loop,
        input,
        "spoke cell",
      );
      // Each line piece from its traversal start to end, with each declared
      // join entered through its record position (end → position → start).
      const routed: SplineVector[] = [];
      oraclePieces(loop, input).forEach((piece, index) => {
        const start = loop.segments[index]!.start;
        if (start?.kind === "declaredJoin") routed.push(start.position);
        routed.push(
          oraclePoint(piece, piece.from),
          oraclePoint(piece, piece.to),
        );
      });
      const shoelace =
        routed.reduce(
          (sum, point, k) =>
            sum + cross(point, routed[(k + 1) % routed.length]!),
          0,
        ) / 2;
      expect(
        area.interval[0] <= shoelace && shoelace <= area.interval[1],
        `routed ${shoelace} in [${area.interval}]`,
      ).toBe(true);
    }
  }, 60_000);

  test("declared joins with a gap: connector terms make the interval origin-independent", async () => {
    // Rectangle [0, 10]² whose right side ends 0.9τ below the top side's
    // start; all four corners are satisfied coincident joins.
    const sketch = makeSketchFixture();
    const corners: [string, number, number][] = [
      ["r0s", 0, 0],
      ["r0e", 10, 0],
      ["r1s", 10, 0],
      ["r1e", 10, 10 - 0.9 * FIXTURE_TOLERANCE],
      ["r2s", 10, 10],
      ["r2e", 0, 10],
      ["r3s", 0, 10],
      ["r3e", 0, 0],
    ];
    for (const [name, x, y] of corners) sketch.point(name, x, y);
    for (let index = 0; index < 4; index += 1)
      sketch.line(`r_s${index}`, `r${index}s`, `r${index}e`);
    for (let index = 0; index < 4; index += 1)
      sketch.coincident(`r${index}e`, `r${(index + 1) % 4}s`);
    const input = sketch.build();
    const run = await recordedRun(input);
    expect(run.result.regions).toHaveLength(1);
    const loop = run.result.regions[0]!.loops[0]!;
    expect(
      loop.segments.every((segment) => segment.start?.kind === "declaredJoin"),
    ).toBe(true);
    const rotations = loop.segments.map((_, shift) => ({
      ...loop,
      segments: [
        ...loop.segments.slice(shift),
        ...loop.segments.slice(0, shift),
      ],
    }));
    const values = rotations.map(
      (rotated, shift) =>
        expectAreaContainsOracle(
          run.basis,
          rotated,
          input,
          `origin at segment ${shift}`,
        ).area,
    );
    const widest = Math.max(
      ...values.map((value) => value.interval[1] - value.interval[0]),
    );
    for (const value of values)
      expect(Math.abs(value.value - values[0]!.value)).toBeLessThanOrEqual(
        widest,
      );
    // The row exercises the connector: without it the oracle moves by more
    // than the certified width for some origin.
    const shifts = rotations.map((rotated) => {
      const pieces = oraclePieces(rotated, input);
      return Math.abs(oracleLoopArea(pieces) - oracleLoopArea(pieces, false));
    });
    expect(Math.max(...shifts)).toBeGreaterThan(widest);
  }, 60_000);
});

describe("region-boundary curve owner: curve length", () => {
  const cubic = (
    poles: SplinePoles,
  ): Extract<NeutralCurve, { kind: "cubicBezier" }> => ({
    kind: "cubicBezier",
    curveId: "length",
    provenance: { sourceEntityId: "length", sourceSpanId: "s" },
    poles,
    sourceDomain: [0, 1],
  });
  /** Poles of a Pythagorean-hodograph cubic with B′ = (a² − b², 2ab), a and b linear. */
  const pythagorean = (
    a: [number, number],
    b: [number, number],
  ): SplinePoles => {
    const hx = [
      a[0] * a[0] - b[0] * b[0],
      a[0] * a[1] - b[0] * b[1],
      a[1] * a[1] - b[1] * b[1],
    ];
    const hy = [2 * a[0] * b[0], a[0] * b[1] + a[1] * b[0], 2 * a[1] * b[1]];
    const poles: SplineVector[] = [[0, 0]];
    for (let k = 0; k < 3; k += 1)
      poles.push([poles[k]![0] + hx[k]! / 3, poles[k]![1] + hy[k]! / 3]);
    return poles as unknown as SplinePoles;
  };
  /** ∫ (a(u)² + b(u)²) du over [u0, u1], a(u) = a0(1 − u) + a1 u. */
  const pythagoreanLength = (
    a: [number, number],
    b: [number, number],
    u0: number,
    u1: number,
  ) => {
    const antiderivative = (u: number) =>
      [a, b].reduce((sum, [p, q]) => {
        const slope = q - p;
        return (
          sum +
          (slope === 0
            ? p * p * u
            : ((p + slope * u) ** 3 - p ** 3) / (3 * slope))
        );
      }, 0);
    return antiderivative(u1) - antiderivative(u0);
  };
  /** Double-exponential (tanh-sinh) quadrature, level doubling until stable (spec-only oracle). */
  const tanhSinh = (f: (u: number) => number, a: number, b: number) => {
    const [c, r] = [(a + b) / 2, (b - a) / 2];
    let [h, previous, sum] = [1, Number.NaN, 0];
    for (let level = 0; level < 14; level += 1) {
      sum = 0;
      for (let k = -Math.ceil(6 / h); k <= Math.ceil(6 / h); k += 1) {
        const s = (Math.PI / 2) * Math.sinh(k * h);
        const w = ((Math.PI / 2) * Math.cosh(k * h)) / Math.cosh(s) ** 2;
        const u = c + r * Math.tanh(s);
        if (w < 1e-300 || u <= a || u >= b) continue;
        sum += w * f(u);
      }
      sum *= h * r;
      if (Math.abs(sum - previous) <= 1e-16 * Math.abs(sum)) break;
      previous = sum;
      h /= 2;
    }
    return sum;
  };
  const relative = (value: number, oracle: number) =>
    Math.abs(value - oracle) / oracle;

  test("lines and arcs are closed form", () => {
    expect(
      curveLength(
        {
          kind: "line",
          form: "endpointSegment",
          curveId: "l",
          provenance: { sourceEntityId: "l", sourceSpanId: "whole" },
          start: [1, 2],
          end: [4, 6],
          sourceDomain: [0, 1],
        },
        [0.25, 1],
      ),
    ).toEqual({ value: 3.75, approximate: false });
    expect(
      curveLength(
        {
          kind: "circle",
          curveId: "c",
          provenance: { sourceEntityId: "c", sourceSpanId: "whole" },
          center: [0, 0],
          radius: 2,
          xAxis: [1, 0],
          sourceDomain: { kind: "arc", interval: [-1, 3] },
        },
        [-1, 3],
      ),
    ).toEqual({ value: 8, approximate: false });
  });

  test("cubics within 1e-12 relative of closed-form oracles: collinear non-uniform speed and a Pythagorean-hodograph cubic", () => {
    const collinear = curveLength(
      cubic([
        [0, 0],
        [3, 0],
        [1, 0],
        [4, 0],
      ]),
      [0.1, 0.9],
    );
    const x = (u: number) => 9 * u - 15 * u * u + 10 * u ** 3;
    expect(collinear.approximate).toBe(false);
    expect(relative(collinear.value, x(0.9) - x(0.1))).toBeLessThanOrEqual(
      1e-12,
    );

    const a: [number, number] = [1, 2];
    const b: [number, number] = [2, -1];
    const curved = curveLength(cubic(pythagorean(a, b)), [0.2, 0.95]);
    expect(curved.approximate).toBe(false);
    expect(
      relative(curved.value, pythagoreanLength(a, b, 0.2, 0.95)),
    ).toBeLessThanOrEqual(1e-12);
  });

  /** x = t², y = t³ + δt with t = 2(u − u*): |B′| = 2·√(4t² + (3t² + δ)²) ≥ 2δ at u*. */
  const nearCusp = (delta: number, ustar: number) => {
    const [a, b] = [2, -2 * ustar];
    const x = [b * b, 2 * a * b, a * a, 0];
    const y = [
      b ** 3 + delta * b,
      3 * a * b * b + delta * a,
      3 * a * a * b,
      a ** 3,
    ];
    const bezier = (c: number[]) => [
      c[0]!,
      c[0]! + c[1]! / 3,
      c[0]! + (2 * c[1]!) / 3 + c[2]! / 3,
      c[0]! + c[1]! + c[2]! + c[3]!,
    ];
    const [bx, by] = [bezier(x), bezier(y)];
    const poles = [0, 1, 2, 3].map((k) => [
      bx[k]!,
      by[k]!,
    ]) as unknown as SplinePoles;
    // Independent oracle: tanh-sinh quadrature of the power-basis speed,
    // split at the near-cusp u*.
    const speed = (u: number) =>
      Math.hypot(
        x[1]! + u * (2 * x[2]! + 3 * u * x[3]!),
        y[1]! + u * (2 * y[2]! + 3 * u * y[3]!),
      );
    return {
      curve: cubic(poles),
      oracle: tanhSinh(speed, 0, ustar) + tanhSinh(speed, ustar, 1),
    };
  };

  test("a non-polynomial near-cusp (δ = 1e-8) within 1e-12 of an independent tanh-sinh oracle", () => {
    const { curve, oracle } = nearCusp(1e-8, 0.6180339887);
    const near = curveLength(curve, [0, 1]);
    expect(near.approximate).toBe(false);
    expect(relative(near.value, oracle)).toBeLessThanOrEqual(1e-12);
  });

  test("the 1e-12 contract is pinned: this row reads 8.5e-12 off with a 1e-9 internal target", () => {
    const { curve, oracle } = nearCusp(0.01, 0.05 + (0.9 * 25) / 39);
    const length = curveLength(curve, [0, 1]);
    expect(length.approximate).toBe(false);
    expect(relative(length.value, oracle)).toBeLessThanOrEqual(1e-12);
  });

  test("an exact cusp off the bisection points within 1e-12; a depth bound marks the reading approximate; requests above the bound are clamped", () => {
    // (t², t³), t = 2u − 1: a cusp at u = ½ with |B′| = 0; length
    // ∫|t|√(4 + 9t²) dt = ((4 + 9t²)^{3/2} − 8)/27 on each side.
    const cusp = cubic([
      [1, -1],
      [-1 / 3, 1],
      [-1 / 3, -1],
      [1, 1],
    ]);
    const side = (t: number) => ((4 + 9 * t * t) ** 1.5 - 8) / 27;
    const [u0, u1] = [0.1, 0.95];
    const exactCusp = curveLength(cusp, [u0, u1]);
    expect(exactCusp.approximate).toBe(false);
    expect(
      relative(exactCusp.value, side(Math.abs(2 * u0 - 1)) + side(2 * u1 - 1)),
    ).toBeLessThanOrEqual(1e-12);

    // A depth bound that cannot reach the tolerance marks the reading.
    const bounded = curveLength(cusp, [u0, u1], { maxDepth: 2 });
    expect(bounded.approximate).toBe(true);
    expect(relative(bounded.value, exactCusp.value)).toBeLessThan(1e-3);
    expect(curveLength(cusp, [u0, u1], { maxDepth: 10_000 })).toEqual(
      exactCusp,
    );
  });

  test("a resolved spline span's length uses its kernel interval", async () => {
    const sketch = makeSketchFixture();
    lemniscate(sketch);
    const run = await recordedRun(sketch.build());
    const segment = segmentsOf(run.result.regions).find(
      (record) =>
        record.start?.kind === "verifiedIntersection" ||
        record.end?.kind === "verifiedIntersection",
    )!;
    const curve = resolved(run.basis, segment);
    const [u0, u1] = curve.kernelInterval;
    const whole = curveLength(curve.curve, [0, 1]).value;
    const part = curveLength(curve.curve, curve.kernelInterval).value;
    expect(u1 - u0).toBeLessThan(1);
    expect(part).toBeLessThan(whole);
    expect(part).toBeGreaterThan(0);
  }, 60_000);
});

describe("region-boundary curve owner: display tessellation of a loop", () => {
  test("a rectangle loop is its corners; a lobe starts each segment at the resolved curve's start", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 5]);
    const run = await recordedRun(sketch.build());
    const polygon = tessellateBoundaryLoop(
      run.basis,
      run.result.regions[0]!.loops[0]!,
    );
    expect(Array.isArray(polygon) && [...polygon].sort()).toEqual([
      [0, 0],
      [0, 5],
      [10, 0],
      [10, 5],
    ]);

    const lobes = makeSketchFixture();
    lemniscate(lobes);
    const lobeRun = await recordedRun(lobes.build());
    const loop = lobeRun.result.regions[0]!.loops[0]!;
    const points = tessellateBoundaryLoop(lobeRun.basis, loop, 8);
    if (!Array.isArray(points)) throw new Error("tessellation failed");
    expect(points).toHaveLength(8 * loop.segments.length);
    loop.segments.forEach((segment, index) => {
      const curve = resolved(lobeRun.basis, segment);
      const [a, b] = segment.sourceParameterInterval;
      expect(points[8 * index]).toEqual(
        evaluateNeutralCurve(
          curve.curve,
          segment.traversalDirection === "forward" ? a : b,
        ),
      );
    });
  }, 60_000);

  test("reversed segments run from their traversal start (a circle split by y = −1), and each polygon has its loop's area sign", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("k", "c", 6);
    sketch.point("p", -8, -1);
    sketch.point("q", 8, -1);
    sketch.line("cut", "p", "q");
    const run = await recordedRun(sketch.build());
    expect(run.result.regions).toHaveLength(2);
    const segments = segmentsOf(run.result.regions);
    expect(
      segments.some((segment) => segment.traversalDirection === "reverse"),
      "some segment runs in reverse",
    ).toBe(true);
    const n = 8;
    const at = (curve: ResolvedBoundaryCurve["curve"], t: number) =>
      curve.kind === "circle"
        ? [
            curve.center[0] + curve.radius * Math.cos(t),
            curve.center[1] + curve.radius * Math.sin(t),
          ]
        : evaluateNeutralCurve(curve, t);
    for (const region of run.result.regions)
      for (const loop of region.loops) {
        const points = tessellateBoundaryLoop(run.basis, loop, n);
        if (!Array.isArray(points)) throw new Error("tessellation failed");
        let offset = 0;
        for (const segment of loop.segments) {
          const curve = resolved(run.basis, segment);
          const [a, b] = segment.sourceParameterInterval;
          const forward = segment.traversalDirection === "forward";
          expect(
            points[offset],
            `${entityOf(segment)} ${segment.traversalDirection}`,
          ).toEqual(at(curve.curve, forward ? a : b));
          offset += curve.curve.kind === "line" ? 1 : n;
        }
        expect(points).toHaveLength(offset);
        const shoelace = points.reduce(
          (sum, point, k) =>
            sum + cross(point, points[(k + 1) % points.length]!),
          0,
        );
        const area = boundaryLoopSignedArea(run.basis, loop);
        if (area.kind !== "measured") throw new Error(area.message);
        expect(Math.sign(shoelace)).toBe(Math.sign(area.value));
      }
  }, 60_000);
});
