import { beforeAll, describe, expect, test } from "vitest";
import {
  evaluateNeutralCurve,
  type NeutralCurve,
  type NeutralCurveQueryCapability,
} from "@/contracts/modeling/neutral-curve-query";
import {
  addOffsetFramePublication,
  addRectangle,
  arcOracle,
  closedCurvesSignedArea,
  curvesLength,
  cubicOracle,
  FIXTURE_TOLERANCE,
  lineOracle,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
  publishedOracleCurves,
  type OffsetPublicationOutputs,
  type OracleCurve,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  createSketchArrangementDeriver,
  offsetArrangementInput,
  type SketchArrangementDerivedCurve,
  type SketchArrangementInput,
  type SketchArrangementResult,
} from "@/contracts/sketch/region-extraction";
import {
  certifyNeutralCurvePieceSignedArea,
  nextDown,
  nextUp,
} from "@/contracts/sketch/region-interval-geometry";
import type {
  RegionBoundarySegmentRecord,
  RegionRecord,
} from "@/contracts/sketch/schema";
import { regionBranchKey } from "@/contracts/sketch/region-identity";
import { solveSketchDefinitionCore } from "@/contracts/sketch/solver-core";
import {
  applyOffsetPublications,
  publishSketchOffsets,
} from "@/contracts/sketch/offset-publication";
import type {
  SplinePoles,
  SplineSpan,
  SplineVector,
} from "@/contracts/sketch/spline-geometry";
import {
  createCertifiedNeutralCurveQueryCapabilityForTest,
  createCertifiedNeutralCurveRequestQuery,
} from "@/domain/modeling/neutral-curve-certification/query";
import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchDefinition } from "@/contracts/sketch/schema";
import type { SketchConstraintToolId } from "@/core/sketch-constraints/definition";
import {
  getSketchConstraintDefinition,
  resolveSketchConstraintTarget,
} from "@/core/sketch-constraints/registry";
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
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/internals";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";
import { OCC_KERNEL_SETTINGS } from "@/domain/modeling/opencascade-kernel-seed";
import { createCertifiedCubicTubeChain } from "@/domain/modeling/neutral-curve-certification/cubic-tube-chain";
import {
  ARCH_POINTS,
  CORNER_MATRIX_SOLVE_TOLERANCES,
  createNativeArcOffsetHarness,
  createNativeOffsetChainHarness,
  offsetFrameChainRows,
  offsetPartitionDragRows,
  seedArcRows,
  EDITED_FILLET_DELTAS,
  EDITED_FILLET_ROWS,
  TANGENT_FILLET_DISTANCES,
  editedFilletSketch,
  tangentEdit,
  withLineLength,
  withoutFilletRelationships,
  type AcceptedPair,
  type Authored,
  type EndpointSnaps,
  type NativeArcAuthoring,
  type NativeToolAuthoring,
  type Vector,
} from "@/contracts/sketch/offset-chain.fixtures";
import {
  publishOffsetFrame,
  solveOffsetFrame,
  type CertifiedOffsetFramePublication,
  type OffsetFramePlan,
  type OffsetFrameRelationship,
} from "@/contracts/sketch/offset-derivation-frame";

let capability: NeutralCurveQueryCapability;
beforeAll(async () => {
  capability = await createCertifiedNeutralCurveQueryCapabilityForTest();
});

/** Every derivation runs a fresh owner over the real kernel-free certifier. */
async function derive(
  sketch: SketchFixture,
  options?: Parameters<SketchFixture["build"]>[0],
): Promise<SketchArrangementResult> {
  const result = await createSketchArrangementDeriver(capability).derive(
    sketch.build(options),
  );
  expect(
    result.diagnostics.filter(
      (diagnostic) => diagnostic.severity !== "warning",
    ),
    "the arrangement owner only ever emits warnings; validity stays sketch-wide",
  ).toEqual([]);
  return result;
}

const codes = (result: SketchArrangementResult) =>
  [...new Set(result.diagnostics.map((d) => d.code))].sort();
const targetsOf = (result: SketchArrangementResult, code: string) =>
  [
    ...new Set(
      result.diagnostics
        .filter((d) => d.code === code && d.target?.kind === "entity")
        .map((d) =>
          (d.target as { entityId: string }).entityId.replace(
            "sketch_entity_",
            "",
          ),
        ),
    ),
  ].sort();
const entityOf = (segment: RegionBoundarySegmentRecord) =>
  segment.branch.source.kind === "entity"
    ? segment.branch.source.entityId.replace("sketch_entity_", "")
    : "projected";
const boundaryEntities = (region: RegionRecord) =>
  [
    ...new Set(region.loops.flatMap((loop) => loop.segments.map(entityOf))),
  ].sort();
/** Loop records start at an arbitrary vertex: rotate to start at `first`. */
/** Each segment's start `portPointId`, in traversal order (declared joins). */
const portPointIdsOf = (loop: RegionRecord["loops"][number]): string[] =>
  loop.segments.flatMap((segment) =>
    segment.start?.kind === "declaredJoin" && segment.start.portPointId
      ? [segment.start.portPointId]
      : [],
  );

const cyclicFrom = (names: string[], first: string) => {
  const index = names.indexOf(first);
  return [...names.slice(index), ...names.slice(0, index)];
};
const ids = (result: SketchArrangementResult) =>
  result.regions.map((region) => region.regionId).sort();

function lemniscate(sketch: SketchFixture, scale = 6, wiggle = 0) {
  const names = [...Array(8).keys()].map((k) => {
    const t = Math.PI / 8 + (k * Math.PI) / 4;
    sketch.point(
      `p${k}`,
      Math.round(scale * Math.cos(t) * 1000) / 1000 + (k === 0 ? wiggle : 0),
      Math.round(scale * Math.sin(t) * Math.cos(t) * 1000) / 1000,
    );
    return `p${k}`;
  });
  sketch.spline("fig", names, "smooth");
}

/**
 * Rectangle r = [0, 10]² with coincident corners whose right side ends
 * 0.9·tol below the top side's start: T09a verifies that corner as
 * `declaredEnds` with a gap inside its join ball (review probes A and G).
 */
function gapCornerRectangle(sketch: SketchFixture) {
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
}

function roundedRectangle(
  sketch: SketchFixture,
  [w, h, r]: readonly [number, number, number],
) {
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

describe("region arrangement owner: accepted solves and curve admission", () => {
  test("regions are derived only from an accepted solve", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 5], "coincident");
    const accepted = sketch.build();
    const partial = await derive(sketch, {
      solvedSnapshot: {
        ...accepted.solvedSnapshot,
        status: {
          solveState: "partiallySolved",
          constraintState: "underConstrained",
        },
      },
    });
    expect(partial.regions).toEqual([]);
    expect(codes(partial)).toEqual(["regions-unavailable"]);
    const unsatisfied = await derive(sketch, {
      solvedSnapshot: {
        ...accepted.solvedSnapshot,
        constraintStatuses: accepted.solvedSnapshot.constraintStatuses.map(
          (status, index) =>
            index === 0
              ? { ...status, status: "unsatisfied" as const }
              : status,
        ),
      },
    });
    expect(unsatisfied.regions).toEqual([]);
    expect(codes(unsatisfied)).toEqual(["regions-unavailable"]);
  });

  test("construction geometry is excluded, but a construction point still carries a declared join", async () => {
    const construction = makeSketchFixture();
    ["a", "b", "c", "d"].forEach((name, index) =>
      construction.point(name, [0, 10, 10, 0][index]!, [0, 0, 5, 5][index]!),
    );
    construction.line("l1", "a", "b", true);
    construction.line("l2", "b", "c", true);
    construction.line("l3", "c", "d", true);
    construction.line("l4", "d", "a", true);
    const excluded = await derive(construction);
    expect(excluded.regions).toEqual([]);
    expect(excluded.diagnostics).toEqual([]);

    // Two corner endpoints joined only through a construction point close transitively.
    const transitive = makeSketchFixture();
    addRectangle(transitive, "r", [0, 0, 10, 5], "coincident");
    transitive.point("hub", 10, 0, true);
    const definition = transitive.definition();
    expect(definition.constraints.length).toBe(4);
    const viaHub = makeSketchFixture();
    viaHub.point("r0s", 0, 0);
    viaHub.point("r0e", 10, 0);
    viaHub.point("r1s", 10, 0);
    viaHub.point("r1e", 10, 5);
    viaHub.point("r2s", 10, 5);
    viaHub.point("r2e", 0, 5);
    viaHub.point("r3s", 0, 5);
    viaHub.point("r3e", 0, 0);
    viaHub.point("hub", 10, 0, true);
    ["r_s0", "r_s1", "r_s2", "r_s3"].forEach((line, index) =>
      viaHub.line(line, `r${index}s`, `r${index}e`),
    );
    viaHub.coincident("r0e", "hub");
    viaHub.coincident("hub", "r1s");
    viaHub.coincident("r1e", "r2s");
    viaHub.coincident("r2e", "r3s");
    viaHub.coincident("r3e", "r0s");
    const closed = await derive(viaHub);
    expect(closed.regions).toHaveLength(1);
    const corner = closed.regions[0]!.loops[0]!.segments.find(
      (segment) => entityOf(segment) === "r_s0",
    )!.end!;
    expect(corner.kind).toBe("declaredJoin");
    expect(corner.kind === "declaredJoin" && corner.pointIds).toEqual([
      "sketch_point_hub",
      "sketch_point_r0e",
      "sketch_point_r1s",
    ]);
  });

  test("unsupported curves block only the components their box meets (U4)", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 5]);
    addRectangle(sketch, "q", [30, 0, 40, 5]);
    sketch.point("e", 10, 2);
    sketch.point("m", 13, 2);
    sketch.ellipse("el", "e", "m", 1);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-unsupported-curve"]);
    expect(targetsOf(result, "region-unsupported-curve")).toEqual([
      "el",
      "r_s0",
      "r_s1",
      "r_s2",
    ]);
  });

  test("projected source samples are unsupported curves", async () => {
    const sketch = makeSketchFixture();
    sketch.project("samples", [
      {
        geometryId: "projected_geometry_s",
        kind: "spline",
        representation: {
          kind: "sourceSamples",
          points: [
            [0, 0],
            [1, 1],
            [2, 0],
          ],
          isClosed: false,
        },
      },
    ]);
    addRectangle(sketch, "q", [30, 0, 40, 5]);
    const result = await derive(sketch);
    expect(result.regions).toHaveLength(1);
    expect(result.diagnostics.map((d) => [d.code, d.target])).toEqual([
      ["region-unsupported-curve", null],
    ]);
    expect(result.diagnostics[0]!.message).toContain(
      "ref_samples/projected_geometry_s",
    );
  });

  test("degenerate curves are diagnosed and block only what their box meets", async () => {
    const sketch = makeSketchFixture();
    sketch.point("p0", 0, 0);
    sketch.point("p1", 1, 1);
    sketch.point("p2", 1, 1);
    sketch.spline("S", ["p0", "p1", "p2"], "open");
    addRectangle(sketch, "r", [-1, -1, 2, 2]);
    sketch.point("z", 35, 5);
    sketch.line("zero", "z", "z");
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    addRectangle(sketch, "w", [60, 0, 70, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["w_s0", "w_s1", "w_s2", "w_s3"],
    ]);
    expect(codes(result)).toEqual(["region-degenerate-curve"]);
    expect(targetsOf(result, "region-degenerate-curve")).toEqual(
      [
        "S",
        "q_s0",
        "q_s1",
        "q_s2",
        "q_s3",
        "r_s0",
        "r_s1",
        "r_s2",
        "r_s3",
        "zero",
      ].sort(),
    );
  });
});

describe("region arrangement owner: declared joins and closure", () => {
  test("rectangle: one counter-clockwise region with exact provenance", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 5]);
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(1);
    const [region] = result.regions;
    expect(region!.label).toBe("Outer region");
    expect(region!.regionId).toMatch(/^region_[0-9a-f]{32}$/);
    expect(region!.loops).toHaveLength(1);
    const loop = region!.loops[0]!;
    expect(loop.role).toBe("outer");
    expect(loop.orientation).toBe("counterClockwise");
    expect(cyclicFrom(loop.segments.map(entityOf), "r_s0")).toEqual([
      "r_s0",
      "r_s1",
      "r_s2",
      "r_s3",
    ]);
    expect(cyclicFrom(portPointIdsOf(loop), "sketch_point_r0")).toEqual([
      "sketch_point_r0",
      "sketch_point_r1",
      "sketch_point_r2",
      "sketch_point_r3",
    ]);
    expect(
      loop.segments.find((segment) => entityOf(segment) === "r_s0"),
    ).toEqual({
      branch: {
        source: { kind: "entity", entityId: "sketch_entity_r_s0" },
        spanId: "whole",
      },
      sourceParameterInterval: [0, 1],
      traversalDirection: "forward",
      start: {
        kind: "declaredJoin",
        key: 'j["sketch_point_r0"]',
        pointIds: ["sketch_point_r0"],
        portPointId: "sketch_point_r0",
        position: [0, 0],
        ballRadius: FIXTURE_TOLERANCE / 2,
      },
      end: {
        kind: "declaredJoin",
        key: 'j["sketch_point_r1"]',
        pointIds: ["sketch_point_r1"],
        portPointId: "sketch_point_r1",
        position: [10, 0],
        ballRadius: FIXTURE_TOLERANCE / 2,
      },
      sourceSegmentOrdinal: 0,
    });
  });

  test("coincident corners close at Δ = 0, ±1e-8, a 0.3·tol overshoot and a 0.9·tol undershoot with one id; ±√2·tol and a 0.4·tol overshoot fail closed (T09a ball limits)", async () => {
    const results = [];
    for (const offset of [
      0,
      1e-8,
      -1e-8,
      0.3 * FIXTURE_TOLERANCE,
      -0.9 * FIXTURE_TOLERANCE,
    ]) {
      const sketch = makeSketchFixture();
      addRectangle(sketch, "r", [0, 0, 10, 5], "coincident", offset);
      const result = await derive(sketch);
      expect(result.diagnostics, `offset ${offset}`).toEqual([]);
      expect(result.regions, `offset ${offset}`).toHaveLength(1);
      results.push(result);
    }
    expect(
      new Set(results.map((result) => result.regions[0]!.regionId)).size,
    ).toBe(1);
    // Overshoot: the unique contact inside the join ball trims side 0 before its end.
    const overshoot = results[1]!.regions[0]!.loops[0]!.segments.find(
      (segment) => entityOf(segment) === "r_s0",
    )!;
    expect(overshoot.sourceParameterInterval[1]).toBeLessThan(1);
    expect(
      overshoot.end?.kind === "declaredJoin" && overshoot.end.pointIds,
    ).toEqual(["sketch_point_r0e", "sketch_point_r1s"]);
    // Undershoot: the declared ends are the join; no trimming.
    const undershoot = results[2]!.regions[0]!.loops[0]!.segments.find(
      (segment) => entityOf(segment) === "r_s0",
    )!;
    expect(undershoot.sourceParameterInterval).toEqual([0, 1]);

    for (const [offset, code] of [
      [Math.SQRT2 * FIXTURE_TOLERANCE, "join-ball-exceeds-tolerance"],
      [-Math.SQRT2 * FIXTURE_TOLERANCE, "join-ball-exceeds-tolerance"],
      [0.4 * FIXTURE_TOLERANCE, "join-ball-crowded"],
    ] as const) {
      const sketch = makeSketchFixture();
      addRectangle(sketch, "r", [0, 0, 10, 5], "coincident", offset);
      addRectangle(sketch, "q", [30, 0, 40, 5]);
      const far = await derive(sketch);
      expect(far.regions.map(boundaryEntities), `offset ${offset}`).toEqual([
        ["q_s0", "q_s1", "q_s2", "q_s3"],
      ]);
      expect(codes(far)).toEqual(["region-join-uncertain"]);
      expect(targetsOf(far, "region-join-uncertain")).toEqual(["r_s0", "r_s1"]);
      expect(far.diagnostics[0]!.message).toContain(code);
    }
  });

  test("a positive gap inside tolerance never closes: profile-open-segment", async () => {
    const sketch = makeSketchFixture();
    sketch.point("a", 1e-8, 0);
    sketch.point("a0", 0, 0);
    sketch.point("b", 10, 0);
    sketch.point("c", 10, 5);
    sketch.point("d", 0, 5);
    sketch.line("l1", "a", "b");
    sketch.line("l2", "b", "c");
    sketch.line("l3", "c", "d");
    sketch.line("l4", "d", "a0");
    const result = await derive(sketch);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["profile-open-segment"]);
    expect(targetsOf(result, "profile-open-segment")).toEqual([
      "l1",
      "l2",
      "l3",
      "l4",
    ]);
  });

  test("slot, rounded rectangle and D-shape close through line/arc joins", async () => {
    const slot = makeSketchFixture();
    slot.point("a", 0, 0);
    slot.point("b", 10, 0);
    slot.point("c", 10, 4);
    slot.point("d", 0, 4);
    slot.point("k1", 10, 2);
    slot.point("k2", 0, 2);
    slot.line("l1", "a", "b");
    slot.arc("a1", "k1", "b", "c");
    slot.line("l2", "c", "d");
    slot.arc("a2", "k2", "d", "a");
    const slotResult = await derive(slot);
    expect(slotResult.diagnostics).toEqual([]);
    expect(
      slotResult.regions.map((region) =>
        cyclicFrom(region.loops[0]!.segments.map(entityOf), "l1"),
      ),
    ).toEqual([["l1", "a1", "l2", "a2"]]);

    const rounded = makeSketchFixture();
    roundedRectangle(rounded, [10, 6, 1]);
    const roundedResult = await derive(rounded);
    expect(roundedResult.diagnostics).toEqual([]);
    expect(roundedResult.regions).toHaveLength(1);
    expect(roundedResult.regions[0]!.loops[0]!.segments).toHaveLength(8);

    const d = makeSketchFixture();
    d.point("a", 0, -2);
    d.point("b", 0, 2);
    d.point("k", 0, 0);
    d.line("l", "b", "a");
    d.arc("arc", "k", "a", "b");
    const dResult = await derive(d);
    expect(dResult.diagnostics).toEqual([]);
    const loop = dResult.regions[0]!.loops[0]!;
    expect(
      loop.segments
        .map((segment) => [entityOf(segment), segment.traversalDirection])
        .sort(),
    ).toEqual([
      ["arc", "forward"],
      ["l", "forward"],
    ]);
    const arc = loop.segments.find((segment) => entityOf(segment) === "arc")!;
    expect(arc.sourceParameterInterval).toEqual([-Math.PI / 2, Math.PI / 2]);
  });

  test("clockwise arcs are reversed traversals of their counter-clockwise interval", async () => {
    const sketch = makeSketchFixture();
    sketch.point("a", 0, -2);
    sketch.point("b", 0, 2);
    sketch.point("k", 0, 0);
    sketch.line("l", "a", "b");
    sketch.arc("arc", "k", "b", "a", "clockwise");
    const result = await derive(sketch);
    expect(result.regions).toHaveLength(1);
    const arc = result.regions[0]!.loops[0]!.segments.find(
      (segment) => entityOf(segment) === "arc",
    )!;
    expect(arc.sourceParameterInterval).toEqual([-Math.PI / 2, Math.PI / 2]);
    expect(arc.traversalDirection).toBe("forward");
    const line = result.regions[0]!.loops[0]!.segments.find(
      (segment) => entityOf(segment) === "l",
    )!;
    expect(line.traversalDirection).toBe("reverse");
    expect(line.start?.kind === "declaredJoin" && line.start.portPointId).toBe(
      "sketch_point_b",
    );
  });

  test.each([
    ["counter-clockwise (0,3)→(3,0)", [0, 3], [3, 0], "counterClockwise"],
    ["clockwise (0,3)→(−3,0)", [0, 3], [-3, 0], "clockwise"],
  ] as const)(
    "a 270° arc plus chord with ends on the axes derives one region, %s (T10a: arc samples at odd multiples of π/4)",
    async (_label, start, end, sweep) => {
      const sketch = makeSketchFixture();
      sketch.point("k", 0, 0);
      sketch.point("s", start[0], start[1]);
      sketch.point("e", end[0], end[1]);
      sketch.arc("arc", "k", "s", "e", sweep);
      sketch.line("chord", "s", "e");
      const result = await derive(sketch);
      expect(result.diagnostics).toEqual([]);
      expect(result.regions).toHaveLength(1);
      expect(boundaryEntities(result.regions[0]!)).toEqual(["arc", "chord"]);
    },
  );

  test("T-junctions on a line and on an arc split the host at the declared incidence", async () => {
    const onLine = makeSketchFixture();
    addRectangle(onLine, "r", [0, 0, 10, 5]);
    onLine.point("t0", 4, 0);
    onLine.point("t1", 4, 5);
    onLine.line("stem", "t0", "t1");
    onLine.pointOnCurve("t0", "r_s0");
    onLine.pointOnCurve("t1", "r_s2");
    const lineResult = await derive(onLine);
    expect(lineResult.diagnostics).toEqual([]);
    expect(lineResult.regions.map(boundaryEntities).sort()).toEqual([
      ["r_s0", "r_s1", "r_s2", "stem"],
      ["r_s0", "r_s2", "r_s3", "stem"],
    ]);
    const host = lineResult.regions
      .flatMap((region) => region.loops[0]!.segments)
      .find(
        (segment) =>
          entityOf(segment) === "r_s0" &&
          segment.sourceParameterInterval[0] === 0,
      )!;
    expect(host.sourceParameterInterval).toEqual([0, 0.4]);
    expect(
      host.end?.kind === "declaredJoin" && [
        host.end.portPointId,
        host.end.pointIds,
      ],
    ).toEqual([null, ["sketch_point_t0"]]);

    const onArc = makeSketchFixture();
    onArc.point("a", 0, -2);
    onArc.point("b", 0, 2);
    onArc.point("k", 0, 0);
    onArc.line("l", "b", "a");
    onArc.arc("arc", "k", "a", "b");
    onArc.point("m", 0, 0);
    onArc.point("q", 2, 0);
    onArc.line("stem", "m", "q");
    onArc.midpoint("m", "l");
    onArc.pointOnCurve("q", "arc");
    const arcResult = await derive(onArc);
    expect(arcResult.diagnostics).toEqual([]);
    expect(arcResult.regions).toHaveLength(2);
    expect(arcResult.regions.map(boundaryEntities)).toEqual([
      ["arc", "l", "stem"],
      ["arc", "l", "stem"],
    ]);
    const arcPieces = arcResult.regions
      .flatMap((region) => region.loops[0]!.segments)
      .filter((segment) => entityOf(segment) === "arc")
      .map((segment) => segment.sourceParameterInterval)
      .sort((l, r) => l[0] - r[0]);
    expect(arcPieces).toEqual([
      [-Math.PI / 2, 0],
      [0, Math.PI / 2],
    ]);
  });
  test("a satisfied pointOnCurve on a line's extension is no incidence with the segment (review probe E)", async () => {
    // The solver's line pointOnCurve is the infinite line: m1 lies on r_s0's
    // extension at t = 1.2, two units from the rectangle.
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 10]);
    sketch.point("m0", 15, 5);
    sketch.point("m1", 12, 0);
    sketch.line("M", "m0", "m1");
    sketch.pointOnCurve("m1", "r_s0");
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities).sort()).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
      ["r_s0", "r_s1", "r_s2", "r_s3"],
    ]);
    expect(codes(result)).toEqual(["profile-open-segment"]);
    expect(targetsOf(result, "profile-open-segment")).toEqual(["M"]);
  });

  test("a nesting ray through a declared corner's gap does not drop the hole (review probe A)", async () => {
    const sketch = makeSketchFixture();
    gapCornerRectangle(sketch);
    // Strictly inside, near the top: its +x ray height (√2−1 up its box) lies
    // in the corner gap band at x = 10 and touches neither side there.
    sketch.point("c", 5, 9.9992);
    sketch.circle("k", "c", 0.0005);
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.regions.map((region) =>
        region.loops.map((loop) => [
          loop.role,
          [...new Set(loop.segments.map(entityOf))].sort(),
        ]),
      ),
    ).toEqual([
      [
        ["outer", ["r_s0", "r_s1", "r_s2", "r_s3"]],
        ["inner", ["k"]],
      ],
      [["outer", ["k"]]],
    ]);
  });

  test("a curve through a declared corner's gap fails closed instead of publishing overlapping regions (review probe G)", async () => {
    const sketch = makeSketchFixture();
    gapCornerRectangle(sketch);
    // Both long sides of f lie in the corner gap band y ∈ (9.9991, 10): f
    // touches no side of r, yet crosses r's realized boundary at the corner.
    addRectangle(sketch, "f", [7, 9.99955, 15, 9.9998]);
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-join-uncertain"]);
    // The first intruder blocks both components; f_s2 then costs no query.
    expect(targetsOf(result, "region-join-uncertain")).toEqual([
      "f_s0",
      "r_s1",
      "r_s2",
    ]);
    expect(result.diagnostics[0]!.message).toContain("not proven clear");
  });

  test("a join member's own far strand through its join gap fails closed (re-review probe H)", async () => {
    // span0 crosses y = 0 at x ≈ 4.0014e-4 (t = 0.1), loops left and ends at
    // a = (0, 0); span1 starts at b = (8e-4, 0) across the declared knot o1.
    // T09a verifies the join (declaredEnds, c = (4e-4, 0), ρ = 5e-4), but
    // span0's far strand re-enters the ball and crosses the realized boundary
    // there: only the owner's member clearance can see it.
    const x0 = 0.083745;
    const build = (bx: number) => {
      const sketch = makeSketchFixture();
      sketch.project("h", [
        projectedSpline("projected_geometry_h", [
          neutralSpan(
            [
              [x0, -1],
              [x0, 3],
              [-3, 0],
              [0, 0],
            ],
            0,
            ["o0", "o1"],
            0,
          ),
          neutralSpan(
            [
              [bx, 0],
              [1, -0.2],
              [2, -0.2],
              [3, -1],
            ],
            1,
            ["o1", "o2"],
            1,
          ),
          neutralSpan(
            [
              [3, -1],
              [2, -1.5],
              [1, -1.5],
              [x0, -1],
            ],
            2,
            ["o2", "o0"],
            2,
          ),
        ]),
      ]);
      addRectangle(sketch, "q", [30, 0, 40, 10]);
      return sketch;
    };
    const result = await derive(build(8e-4));
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-join-uncertain"]);
    expect(
      result.diagnostics.map((d) => [d.target, d.message.includes("span0")]),
    ).toContainEqual([null, true]);
    expect(result.diagnostics[0]!.message).toContain("re-enter");
  }, 30_000);

  test("a tied join whose member points are not bitwise equal fails closed at the vertex (re-review 2 join-tiebreak)", async () => {
    // Two arcs leave J exactly horizontally: arc1 (r = 1) from j1 = (0, 0),
    // arc2 (r = 2) from j2 = (0, g), j1 coincident with j2; a line L also
    // leaves j1 downward. Near J arc2 lies above arc1 because of the gap, but
    // the curvature order puts arc1 counter-clockwise; they cross again at
    // s ≈ 2√g, outside the join ball. Curvature decides only at an exact
    // shared point.
    const build = (g: number) => {
      const sketch = makeSketchFixture();
      sketch.point("k1", 0, 1);
      sketch.point("j1", 0, 0);
      sketch.point("A1", Math.sin(1), 1 - Math.cos(1));
      sketch.arc("arc1", "k1", "j1", "A1");
      sketch.point("k2", 0, 2 + g);
      sketch.point("j2", 0, g);
      sketch.point("A2", 2 * Math.sin(0.5), 2 + g - 2 * Math.cos(0.5));
      sketch.arc("arc2", "k2", "j2", "A2");
      sketch.line("close", "A1", "A2");
      sketch.coincident("j1", "j2");
      sketch.point("B1", 0, -1);
      sketch.point("B2", 1.2, -1);
      sketch.line("L", "j1", "B1");
      sketch.line("bottom", "B1", "B2");
      sketch.line("right", "B2", "A2");
      addRectangle(sketch, "q", [30, 0, 40, 10]);
      return sketch;
    };
    const gapped = await derive(build(1e-5));
    expect(gapped.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(gapped)).toEqual(["region-vertex-order-uncertain"]);
    expect(targetsOf(gapped, "region-vertex-order-uncertain")).toEqual([
      "L",
      "arc1",
      "arc2",
    ]);
    expect(gapped.diagnostics[0]!.message).toContain("vertex j[");

    // Control: the bitwise-shared join keeps the curvature order.
    const shared = await derive(build(0));
    expect(codes(shared)).toEqual([]);
    expect(shared.regions.map(boundaryEntities).sort()).toEqual([
      ["L", "arc2", "bottom", "right"],
      ["arc1", "arc2", "close"],
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
  }, 30_000);

  test("a join is ordered by its certified exit order, not by tangents from distinct realized ends (math review B1, REQ-1)", async () => {
    // Triangle A = J(0, 0), X, Y with a1 = J→X and a2 = Y→J. Two clockwise
    // arcs b1 (R = 1) and b3 (R = 0.5) leave K at tangent angles π/2 + δ and
    // bend into A; a line top closes the sliver B. K is J (g = 0) or declared
    // coincident with J at (g, g). Truth: A has the hole B touching at J, plus B.
    const shapes = (regions: RegionRecord[]) =>
      regions.map((region) =>
        region.loops.map(
          (loop) => `${loop.role}(${loop.segments.map(entityOf).join(",")})`,
        ),
      );
    const arcSliver = (
      [jx, jy]: readonly [number, number],
      g: number,
      [d1, d2]: readonly [number, number],
    ) => {
      const sketch = makeSketchFixture();
      sketch.point("J", jx, jy);
      sketch.point("X", jx + 1, jy);
      sketch.point("Y", jx, jy + 1);
      sketch.line("a1", "J", "X");
      sketch.line("hyp", "X", "Y");
      sketch.line("a2", "Y", "J");
      const k = g === 0 ? "J" : "K";
      if (g !== 0) {
        sketch.point("K", jx + g, jy + g);
        sketch.coincident("J", "K");
      }
      const arc = (
        name: string,
        radius: number,
        delta: number,
        sweep: number,
      ) => {
        const cx = jx + g + radius * Math.cos(delta);
        const cy = jy + g + radius * Math.sin(delta);
        const end = Math.PI + delta - sweep;
        sketch.point(`${name}c`, cx, cy);
        sketch.point(
          `${name}e`,
          cx + radius * Math.cos(end),
          cy + radius * Math.sin(end),
        );
        sketch.arc(name, `${name}c`, k, `${name}e`, "clockwise");
      };
      arc("b1", 1, d1, 0.4);
      arc("b3", 0.5, d2, 0.6);
      sketch.line("top", "b1e", "b3e");
      addRectangle(sketch, "q", [30, 0, 40, 10]);
      return sketch;
    };

    // (i) Gapped: the tangents point out of A past a2 with disjoint certified
    // intervals, but the offset g keeps B inside A up to the box exit. The
    // tangent order used to move B into A's reflex wedge and publish A
    // without its hole, overlapping B.
    // (ii) Exact point J = (0.3, 0.7): the arcs' realized ends differ from J by
    // rounding, and b3's angle interval overlaps both a2′ and b1 while a2′
    // and b1 are disjoint: one overlap component, not two tie clusters
    // (REQ-1). It used to reach only the zero-area backstop.
    for (const [base, g, deltas] of [
      [[0, 0], 1e-5, [2e-6, 1e-6]],
      [[0.3, 0.7], 0, [2e-9, 1e-9]],
    ] as const) {
      const result = await derive(arcSliver(base, g, deltas));
      expect(
        shapes(result.regions),
        "A is never published without the hole B",
      ).toEqual([["outer(q_s0,q_s1,q_s2,q_s3)"]]);
      expect(codes(result)).toEqual(["region-vertex-order-uncertain"]);
      expect(targetsOf(result, "region-vertex-order-uncertain")).toEqual([
        "a1",
        "a2",
        "b1",
        "b3",
      ]);
      expect(result.diagnostics[0]!.message).toContain("vertex j[");
    }
    expect(
      (await derive(arcSliver([0, 0], 1e-5, [2e-6, 1e-6]))).diagnostics[0]!
        .message,
    ).toContain("contraction box in an order that disagrees");

    // (iii) Controls: tangents into A agree with the exit order, gapped and exact.
    for (const g of [1e-4, 0]) {
      const control = await derive(arcSliver([0, 0], g, [-1e-5, -2e-5]));
      expect(control.diagnostics).toEqual([]);
      expect(shapes(control.regions)).toEqual([
        ["outer(q_s0,q_s1,q_s2,q_s3)"],
        ["outer(a1,hyp,a2)", "inner(b1,top,b3)"],
        ["outer(b1,b3,top)"],
      ]);
    }
  }, 30_000);

  test("a cubic in a tied cluster at an exact-point join fails closed (math review REQ-2)", async () => {
    // Line a leaves J east; the cubic c leaves J at a tangent angle of about
    // −1.2e-14 (tied with a) with curvature ≈ 1.8e-10 > 0 at J that changes
    // sign ≈ 1e-11 along. Its lateral offset 3y1·u + 3(y2 − 2y1)·u² + c3·u³
    // (c3 ≈ −3) has no root in (0, 1]: c lies below a, while the curvature
    // at J orders it counter-clockwise of a. T09a verifies every join.
    const [y1, y2, y3] = [-4e-15, 3e-11, -3];
    const sketch = makeSketchFixture();
    sketch.point("J", 0, 0);
    sketch.point("X", 1, 0);
    sketch.point("Y", 0, 1);
    sketch.point("Q", 1, y3);
    sketch.line("a", "J", "X");
    sketch.line("hyp", "X", "Y");
    sketch.line("b", "Y", "J");
    sketch.line("e", "X", "Q");
    sketch.spline("c", ["J", "Q"], "open", [
      [1 / 3, y1],
      [1 / 3, y3 - y2],
    ]);
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-vertex-order-uncertain"]);
    expect(targetsOf(result, "region-vertex-order-uncertain")).toEqual([
      "a",
      "b",
      "c",
    ]);
  }, 30_000);

  test("a lens smaller than its join's contraction box fails closed (math review REQ-3)", async () => {
    // Two arcs leave the gapped join j1 ~ j2 horizontally and cross again at
    // s ≈ 2√g outside the ball. The lens between them has area ≈ (4/3)·g^1.5:
    // 4.2e-8 at g = 1e-5 and 1.3e-6 at g = 1e-4, both below the arc/arc
    // allowance of k = 3 ball boxes (≈ 3e-6, math re-review N1), where the
    // connector lobe can decide its sign; 1.07e-5 at g = 4e-4, still certified.
    const lens = (g: number) => {
      const sketch = makeSketchFixture();
      sketch.point("k1", 0, 1);
      sketch.point("j1", 0, 0);
      sketch.point("A1", Math.sin(1), 1 - Math.cos(1));
      sketch.arc("arc1", "k1", "j1", "A1");
      sketch.point("k2", 0, 2 + g);
      sketch.point("j2", 0, g);
      sketch.point("A2", 2 * Math.sin(0.5), 2 + g - 2 * Math.cos(0.5));
      sketch.arc("arc2", "k2", "j2", "A2");
      sketch.line("close", "A1", "A2");
      sketch.coincident("j1", "j2");
      addRectangle(sketch, "q", [30, 0, 40, 10]);
      return sketch;
    };
    for (const g of [1e-5, 1e-4]) {
      const small = await derive(lens(g));
      expect(small.regions.map(boundaryEntities)).toEqual([
        ["q_s0", "q_s1", "q_s2", "q_s3"],
      ]);
      expect(codes(small)).toEqual(["region-degenerate-curve"]);
      expect(targetsOf(small, "region-degenerate-curve")).toEqual([
        "arc1",
        "arc2",
      ]);
      expect(small.diagnostics[0]!.message).toContain("zero-area cell");
      expect(small.diagnostics[0]!.message).toContain(
        "within its join-contraction area allowance",
      );
    }

    const large = await derive(lens(4e-4));
    expect(large.diagnostics).toEqual([]);
    expect(large.regions.map(boundaryEntities).sort()).toEqual([
      ["arc1", "arc2"],
      ["arc1", "arc2", "close"],
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
  }, 30_000);

  test("a zero-area block at an exit-certified join names the contraction area allowance (math re-review N2)", async () => {
    // The line sliver B = K→U→W tilts into triangle A at the gapped join
    // J ~ K (g = 1e-4): its exit order agrees with its tangents, but its true
    // area 8e-7 lies within the join's line/line allowance of two ball boxes.
    const g = 1e-4;
    const sketch = makeSketchFixture();
    sketch.point("J", 0, 0);
    sketch.point("X", 1, 0);
    sketch.point("Y", 0, 1);
    sketch.line("a1", "J", "X");
    sketch.line("hyp", "X", "Y");
    sketch.line("a2", "Y", "J");
    sketch.point("K", g, g);
    sketch.point("U", g + 0.4e-5, 0.4);
    sketch.point("W", g + 0.8e-5, 0.4);
    sketch.line("b1", "K", "U");
    sketch.line("top", "U", "W");
    sketch.line("b3", "W", "K");
    sketch.coincident("J", "K");
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-degenerate-curve"]);
    expect(targetsOf(result, "region-degenerate-curve")).toEqual([
      "b1",
      "b3",
      "top",
    ]);
    expect(result.diagnostics[0]!.message).toContain("zero-area cell");
    expect(result.diagnostics[0]!.message).toContain("contraction");
  }, 30_000);

  test("a declared incidence on a full circle keeps the disk and leaves the stem open (T10g-0)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("C", "c", 2);
    sketch.point("s0", 2, 0);
    sketch.point("s1", 5, 0);
    sketch.line("stem", "s0", "s1");
    sketch.pointOnCurve("s0", "C");
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const input = sketch.build();
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
      ["C"],
    ]);
    expect(codes(result)).toEqual(["profile-open-segment"]);
    expect(targetsOf(result, "profile-open-segment")).toEqual(["stem"]);
    expect(
      closedCurvesSignedArea(
        regionLoopCurves(result.regions[1]!.loops[0]!, input),
      ),
    ).toBeCloseTo(4 * Math.PI, 9);
  });

  /**
   * Spokes from an inside apex r end on a whole ring (radius R) through
   * `pointOnCurve`. Between consecutive spoke angles θᵢ < θⱼ (cyclic, φ =
   * θⱼ − θᵢ) the region r → qᵢ → arc → qⱼ → r has the closed-form area
   * ½(qᵢ − r) × (qⱼ − r) + ½R²(φ − sin φ).
   */
  const FULL_TURN_SPOKE_ROWS: readonly {
    readonly name: string;
    readonly apex: SplineVector;
    readonly angles: readonly number[];
  }[] = [
    { name: "P-g2 A case 0", apex: [0.3, 0.1], angles: [0.4, 1.9] },
    { name: "P-g2 A case 1", apex: [-0.2, 0.35], angles: [0.77, 2.6] },
    {
      name: "P-g2 A case 2 (π/4, 3π/4)",
      apex: [0, 0.2],
      angles: [Math.PI / 4, (3 * Math.PI) / 4],
    },
    { name: "a spoke at the seam (angle 0)", apex: [0.3, 0.4], angles: [0, 2] },
    {
      name: "spokes at ±π/4 (the seam between them)",
      apex: [0.5, 0.1],
      angles: [-Math.PI / 4, Math.PI / 4],
    },
    {
      name: "a spoke 1e-9 rad below the seam (near 2π)",
      apex: [0.1, 0.3],
      angles: [-1e-9, 2.5],
    },
    {
      name: "three spokes (three joins on one circle)",
      apex: [0.2, -0.1],
      angles: [0.3, 2.4, 4.2],
    },
  ];
  for (const row of FULL_TURN_SPOKE_ROWS) {
    test(`tied spokes on a whole ring split its disk: ${row.name} (T10g-0)`, async () => {
      const radius = 2;
      const sketch = makeSketchFixture();
      sketch.point("c", 0, 0);
      sketch.circle("ring", "c", radius);
      sketch.point("r", ...row.apex);
      const ends = row.angles.map(
        (angle): SplineVector => [
          radius * Math.cos(angle),
          radius * Math.sin(angle),
        ],
      );
      ends.forEach((end, index) => {
        sketch.point(`q${index}`, ...end);
        sketch.line(`spoke${index}`, "r", `q${index}`);
        sketch.pointOnCurve(`q${index}`, "ring");
      });
      const input = sketch.build();
      const result = await derive(sketch);
      expect(result.diagnostics, row.name).toEqual([]);
      const sorted = [...row.angles].sort((l, r) => l - r);
      const expected = sorted
        .map((angle, index) => {
          const next = sorted[(index + 1) % sorted.length]!;
          const phi =
            next - angle + (index + 1 === sorted.length ? 2 * Math.PI : 0);
          const [from, to] = [angle, next].map(
            (value) => ends[row.angles.indexOf(value)]!,
          );
          const cross =
            (from![0] - row.apex[0]) * (to![1] - row.apex[1]) -
            (from![1] - row.apex[1]) * (to![0] - row.apex[0]);
          return cross / 2 + ((radius * radius) / 2) * (phi - Math.sin(phi));
        })
        .sort((l, r) => l - r);
      const areas = result.regions
        .map((region) => {
          expect(region.loops, row.name).toHaveLength(1);
          return closedCurvesSignedArea(
            regionLoopCurves(region.loops[0]!, input),
          );
        })
        .sort((l, r) => l - r);
      expect(areas, `${row.name}: one region per sector`).toHaveLength(
        expected.length,
      );
      areas.forEach((area, index) =>
        expect(area, `${row.name}: area vs closed form`).toBeCloseTo(
          expected[index]!,
          9,
        ),
      );
    }, 60_000);
  }

  test("a chord tied at both ends to a whole circle splits it into two segments (T10g-0)", async () => {
    const radius = 3;
    const [a, b] = [5.9, 1.2];
    const sketch = makeSketchFixture();
    sketch.point("c", 1, -2);
    sketch.circle("C", "c", radius);
    sketch.point("p", 1 + radius * Math.cos(a), -2 + radius * Math.sin(a));
    sketch.point("q", 1 + radius * Math.cos(b), -2 + radius * Math.sin(b));
    sketch.line("chord", "p", "q");
    sketch.pointOnCurve("p", "C");
    sketch.pointOnCurve("q", "C");
    const input = sketch.build();
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    const phi = b - a + 2 * Math.PI;
    const segment = ((radius * radius) / 2) * (phi - Math.sin(phi));
    const areas = result.regions
      .map((region) =>
        closedCurvesSignedArea(regionLoopCurves(region.loops[0]!, input)),
      )
      .sort((l, r) => l - r);
    expect(areas).toHaveLength(2);
    expect(areas[0]).toBeCloseTo(segment, 9);
    expect(areas[1]).toBeCloseTo(Math.PI * radius * radius - segment, 9);
  }, 60_000);

  // T10g-0 math review R2: one join on a whole circle at a vertex of degree
  // ≥ 3 makes its only sub-edge a self-loop whose two halves share both box
  // crossings; the forward half exits at the lower one, the reverse at the
  // upper one.
  test("a lollipop: one tied stem from a whole circle to a rectangle corner keeps both faces (T10g-0)", async () => {
    const radius = 2;
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("C", "c", radius);
    sketch.point("q", radius * Math.cos(0.5), radius * Math.sin(0.5));
    sketch.pointOnCurve("q", "C");
    addRectangle(sketch, "r", [6, 0, 9, 3]);
    sketch.line("stem", "q", "r0");
    const input = sketch.build();
    const result = await derive(sketch);
    expect(codes(result)).toEqual([]);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["C"],
      ["r_s0", "r_s1", "r_s2", "r_s3"],
    ]);
    const areas = result.regions.map((region) =>
      closedCurvesSignedArea(regionLoopCurves(region.loops[0]!, input)),
    );
    expect(areas[0]).toBeCloseTo(Math.PI * radius * radius, 9);
    expect(areas[1]).toBeCloseTo(9, 9);
  }, 60_000);

  test("a triangle outside a whole circle touching it at one tied point keeps both faces (T10g-0)", async () => {
    const radius = 2;
    const q: SplineVector = [radius * Math.cos(1), radius * Math.sin(1)];
    const [a, b]: SplineVector[] = [
      [5, 1],
      [3, 5],
    ];
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("C", "c", radius);
    sketch.point("q", ...q);
    sketch.pointOnCurve("q", "C");
    sketch.point("a", ...a!);
    sketch.point("b", ...b!);
    sketch.line("qa", "q", "a");
    sketch.line("ab", "a", "b");
    sketch.line("bq", "b", "q");
    const input = sketch.build();
    const result = await derive(sketch);
    expect(codes(result)).toEqual([]);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["C"],
      ["ab", "bq", "qa"],
    ]);
    const areas = result.regions.map((region) =>
      closedCurvesSignedArea(regionLoopCurves(region.loops[0]!, input)),
    );
    const triangle =
      ((a![0] - q[0]) * (b![1] - q[1]) - (a![1] - q[1]) * (b![0] - q[0])) / 2;
    expect(areas[0]).toBeCloseTo(Math.PI * radius * radius, 9);
    expect(areas[1]).toBeCloseTo(triangle, 9);
  }, 60_000);
});

describe("region arrangement owner: verified crossings, lobes and nesting", () => {
  test("mixed line/arc/cubic crossings split every branch exactly at the witness parameters", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 6]);
    [
      [3, -2],
      [5, 3],
      [7, 8],
    ].forEach(([x, y], index) => sketch.point(`s${index}`, x!, y!));
    sketch.spline("S", ["s0", "s1", "s2"], "open");
    sketch.point("k", 0, 3);
    sketch.point("a0", 2 * Math.cos(-2), 3 + 2 * Math.sin(-2));
    sketch.point("a1", 2 * Math.cos(2), 3 + 2 * Math.sin(2));
    sketch.arc("C", "k", "a0", "a1");
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(3);
    let checked = 0;
    for (const segment of result.regions.flatMap((region) =>
      region.loops.flatMap((loop) => loop.segments),
    )) {
      const [lo, hi] = segment.sourceParameterInterval;
      const ends =
        segment.traversalDirection === "forward"
          ? [segment.start, segment.end]
          : [segment.end, segment.start];
      ends.forEach((vertex, index) => {
        if (vertex?.kind !== "verifiedIntersection") return;
        const key = regionBranchKey(segment.branch);
        const side = [vertex.witness.first, vertex.witness.second].find(
          (entry) => regionBranchKey(entry.branch) === key,
        )!;
        expect(
          side.parameter,
          "sub-edges end exactly at the capability's witness parameter",
        ).toBe(index === 0 ? lo : hi);
        expect(side.parameterBounds[0]).toBeLessThanOrEqual(side.parameter);
        expect(side.parameterBounds[1]).toBeGreaterThanOrEqual(side.parameter);
        checked += 1;
      });
    }
    expect(checked).toBeGreaterThanOrEqual(8);
  });

  test("a figure-eight spline gives two lobes with distinct signatures", async () => {
    const sketch = makeSketchFixture();
    lemniscate(sketch);
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(2);
    const [left, right] = result.regions;
    expect(left!.signature).not.toBe(right!.signature);
    expect(left!.regionId).not.toBe(right!.regionId);
    for (const region of result.regions) {
      expect(region.loops).toHaveLength(1);
      expect(
        region.loops[0]!.segments.some(
          (segment) => segment.start?.kind === "verifiedIntersection",
        ),
      ).toBe(true);
    }
  }, 30_000);

  test("point-touching loops are separate regions: circles, and declared-knot spline loops", async () => {
    const circles = makeSketchFixture();
    circles.point("a", 0, 0);
    circles.point("b", 2, 0);
    circles.circle("c1", "a", 1);
    circles.circle("c2", "b", 1);
    const circleResult = await derive(circles);
    expect(circleResult.diagnostics).toEqual([]);
    expect(circleResult.regions.map(boundaryEntities).sort()).toEqual([
      ["c1"],
      ["c2"],
    ]);
    for (const region of circleResult.regions) {
      expect(region.loops.map((loop) => loop.segments.length)).toEqual([1]);
      expect(region.loops[0]!.segments[0]!.start?.kind).toBe(
        "verifiedIntersection",
      );
    }

    // Projected neutral loops touching at one exact shared pole: the knots are
    // declared structure (shared occurrences), the touch is a verified contact.
    const span = (
      poles: SplineVector[],
      index: number,
      occurrences: [string, string],
    ) => neutralSpan(poles, index, occurrences, index);
    const loop = (m: number) => [
      span(
        [
          [-3 * m, 1],
          [1 * m, 1],
          [1 * m, -1],
          [-3 * m, -1],
        ],
        0,
        ["k0", "k1"],
      ),
      span(
        [
          [-3 * m, -1],
          [-5 * m, -1],
          [-5 * m, 1],
          [-3 * m, 1],
        ],
        1,
        ["k1", "k0"],
      ),
    ];
    const splines = makeSketchFixture();
    splines.project("L", [projectedSpline("projected_geometry_l", loop(1))]);
    splines.project("R", [projectedSpline("projected_geometry_r", loop(-1))]);
    const splineResult = await derive(splines);
    expect(splineResult.diagnostics).toEqual([]);
    expect(splineResult.regions).toHaveLength(2);
  });

  test("tied directions at an unclassified contact are ordered by curvature only under a tangency proof (re-review 2)", async () => {
    const loop = (m: number, name: string) =>
      projectedSpline(`projected_geometry_${name}`, [
        neutralSpan(
          [
            [-3 * m, 1],
            [1 * m, 1],
            [1 * m, -1],
            [-3 * m, -1],
          ],
          0,
          ["k0", "k1"],
          0,
        ),
        neutralSpan(
          [
            [-3 * m, -1],
            [-5 * m, -1],
            [-5 * m, 1],
            [-3 * m, 1],
          ],
          1,
          ["k1", "k0"],
          1,
        ),
      ]);
    // A starts exactly on B's span0 at (0, 0) along B's tangent, then crosses
    // B. The cubic/cubic endpoint contact is `unclassified` with no tangency
    // proof, so its tied directions are never ordered by curvature.
    const unproven = makeSketchFixture();
    unproven.project("B", [loop(1, "b")]);
    unproven.project("A", [
      projectedSpline("projected_geometry_a", [
        neutralSpan(
          [
            [0, 0],
            [0, 1.5],
            [-2, 2],
            [-2, 0],
          ],
          0,
          ["a0", "a1"],
          0,
        ),
      ]),
    ]);
    addRectangle(unproven, "q", [30, 0, 40, 10]);
    const unprovenResult = await derive(unproven);
    expect(unprovenResult.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(unprovenResult)).toEqual(["region-vertex-order-uncertain"]);

    // A loop touching a circle at the circle's seam: the certifier leaves the
    // contact `unclassified`, and its double root of the circle's equation
    // along the cubic proves the tangency the curvature order relies on.
    const seam = makeSketchFixture();
    seam.point("a", -1, 0);
    seam.circle("c", "a", 1);
    seam.project("S", [loop(-1, "s")]);
    const seamResult = await derive(seam);
    expect(seamResult.diagnostics).toEqual([]);
    expect(seamResult.regions).toHaveLength(2);
  });

  test("near-tangent undeclared spline loops fail closed with a targeted diagnostic (R2 limitation)", async () => {
    const sketch = makeSketchFixture();
    [
      [-2, 0],
      [-1, 1],
      [0, 0],
      [-1, -1],
    ].forEach(([x, y], index) => sketch.point(`l${index}`, x!, y!));
    [
      [0, 0],
      [1, 1],
      [2, 0],
      [1, -1],
    ].forEach(([x, y], index) => sketch.point(`r${index}`, x!, y!));
    sketch.spline("L", ["l0", "l1", "l2", "l3"], "smooth");
    sketch.spline("R", ["r0", "r1", "r2", "r3"], "smooth");
    addRectangle(sketch, "q", [30, 0, 40, 5]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-vertex-order-uncertain"]);
    expect(targetsOf(result, "region-vertex-order-uncertain")).toEqual([
      "L",
      "R",
    ]);
  }, 30_000);

  test("nested and annular cells at three levels", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 20, 20]);
    sketch.point("c", 10, 10);
    sketch.circle("c1", "c", 6);
    addRectangle(sketch, "q", [8, 8, 12, 12]);
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.regions.map((region) => [
        region.label,
        region.loops.map((loop) => [
          loop.role,
          loop.orientation,
          loop.segments.map(entityOf).sort().join(","),
        ]),
      ]),
    ).toEqual([
      [
        "Outer region",
        [
          ["outer", "counterClockwise", "r_s0,r_s1,r_s2,r_s3"],
          ["inner", "clockwise", "c1"],
        ],
      ],
      [
        "Loop region 2",
        [
          ["outer", "counterClockwise", "c1"],
          ["inner", "clockwise", "q_s0,q_s1,q_s2,q_s3"],
        ],
      ],
      ["Loop region 3", [["outer", "counterClockwise", "q_s0,q_s1,q_s2,q_s3"]]],
    ]);
    // Holes reverse the boundary's traversal.
    const hole = result.regions[0]!.loops[1]!.segments[0]!;
    expect([hole.traversalDirection, hole.start, hole.end]).toEqual([
      "reverse",
      null,
      null,
    ]);
  });

  test("a loop whose conservative pole box pokes out of the face is nested by the certified ray test (review probe B)", async () => {
    // The curve spans y ∈ [0.275, 9.725] inside [0, 10]²; with `bulge` its
    // poles span y ∈ [−1.3, 11.3]. The control keeps the poles inside.
    const withLoop = async (bulge: number) => {
      const sketch = makeSketchFixture();
      addRectangle(sketch, "r", [0, 0, 10, 10]);
      sketch.project("loop", [
        projectedSpline("projected_geometry_loop", [
          neutralSpan(
            [
              [2, 5],
              [2, 5 + bulge],
              [8, 5 + bulge],
              [8, 5],
            ],
            0,
            ["o0", "o1"],
            0,
          ),
          neutralSpan(
            [
              [8, 5],
              [8, 5 - bulge],
              [2, 5 - bulge],
              [2, 5],
            ],
            1,
            ["o1", "o0"],
            1,
          ),
        ]),
      ]);
      return derive(sketch);
    };
    const poking = await withLoop(6.3);
    const control = await withLoop(4);
    expect(poking.diagnostics).toEqual([]);
    expect(
      poking.regions.map((region) =>
        region.loops.map((loop) => [
          loop.role,
          [...new Set(loop.segments.map(entityOf))].sort(),
        ]),
      ),
      "the square gets the loop as a hole, so the two regions do not overlap",
    ).toEqual([
      [
        ["outer", ["r_s0", "r_s1", "r_s2", "r_s3"]],
        ["inner", ["projected"]],
      ],
      [["outer", ["projected"]]],
    ]);
    expect(ids(poking)).toEqual(ids(control));
  });

  test("a bridge inside a face makes the inner boundary a hole of the same component", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 20, 20]);
    addRectangle(sketch, "q", [8, 8, 12, 12]);
    sketch.line("bridge", "r0", "q0");
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.regions.map((region) =>
        region.loops.map((loop) =>
          loop.segments.map(entityOf).sort().join(","),
        ),
      ),
    ).toEqual([
      ["r_s0,r_s1,r_s2,r_s3", "q_s0,q_s1,q_s2,q_s3"],
      ["q_s0,q_s1,q_s2,q_s3"],
    ]);
  });

  test("a zero-area cell is diagnosed and blocks only its component", async () => {
    const sketch = makeSketchFixture();
    sketch.point("a", 0, 0);
    sketch.circle("c1", "a", 1);
    sketch.point("b", 2 - 1e-12, 0);
    sketch.circle("c2", "b", 1);
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-degenerate-curve"]);
    expect(targetsOf(result, "region-degenerate-curve")).toEqual(["c1", "c2"]);
    expect(result.diagnostics[0]!.message).toContain("zero-area cell");
  });

  test("projected geometry closes only through verified exact endpoint contacts (R5)", async () => {
    const sketch = makeSketchFixture();
    const corners: SplineVector[] = [
      [0, 0],
      [4, 0],
      [4, 3],
      [0, 3],
    ];
    sketch.project(
      "pr",
      corners.map((start, index) => ({
        geometryId: `projected_geometry_${index}` as const,
        kind: "lineSegment" as const,
        startPosition: start,
        endPosition: corners[(index + 1) % 4]!,
      })),
    );
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(1);
    const segments = result.regions[0]!.loops[0]!.segments;
    expect(
      segments.every(
        (segment) => segment.start?.kind === "verifiedIntersection",
      ),
    ).toBe(true);
    expect(portPointIdsOf(result.regions[0]!.loops[0]!)).toEqual([]);
  });
});

describe("region arrangement owner: coverage carried from the former proximity owner", () => {
  test("mixed local and projected boundaries close one loop and keep the projected identity", async () => {
    const sketch = makeSketchFixture();
    sketch.point("a", 0, 0);
    sketch.point("b", 4, 0);
    sketch.point("c", 4, 3);
    sketch.point("d", 0, 3);
    sketch.line("ab", "a", "b");
    sketch.line("bc", "b", "c");
    sketch.line("cd", "c", "d");
    sketch.project("profile", [
      {
        geometryId: "projected_geometry_left",
        kind: "lineSegment",
        startPosition: [0, 3],
        endPosition: [0, 0],
      },
    ]);
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(1);
    const projected = result.regions[0]!.loops[0]!.segments.find(
      (segment) => segment.branch.source.kind === "projectedGeometry",
    );
    expect(
      projected?.branch.source,
      "the projected boundary keeps its authored reference and projected geometry ids",
    ).toEqual({
      kind: "projectedGeometry",
      reference: {
        kind: "projectedLineSegment",
        referenceId: "ref_profile",
        geometryId: "projected_geometry_left",
      },
    });
    expect(
      sketch.definition().entityIds,
      "projected boundaries are never copied into sketch-owned entities",
    ).toHaveLength(3);
  });

  test("a projected-only circle derives one projected-sourced region", async () => {
    const sketch = makeSketchFixture();
    sketch.project("profile", [
      {
        geometryId: "projected_geometry_circle",
        kind: "circle",
        centerPosition: [2, 2],
        radius: 1,
      },
    ]);
    const result = await derive(sketch);
    expect(result.regions).toHaveLength(1);
    const [segment] = result.regions[0]!.loops[0]!.segments;
    expect(segment!.branch.source.kind).toBe("projectedGeometry");
    expect(
      segment!.branch.source.kind === "projectedGeometry" &&
        segment!.branch.source.reference.geometryId,
    ).toBe("projected_geometry_circle");
    expect([segment!.start, segment!.end]).toEqual([null, null]);
  });

  test("missing, unauthored and record-less projections report diagnostics and invent no region", async () => {
    const missing = makeSketchFixture();
    missing.project("profile", []);
    const unresolved = await derive(missing, { projectedReferences: [] });
    expect(unresolved.regions).toEqual([]);
    expect(codes(unresolved)).toContain(
      "projected-region-reference-unresolved",
    );

    const stale = makeSketchFixture();
    const circle = {
      geometryId: "projected_geometry_stale_circle" as const,
      kind: "circle" as const,
      centerPosition: [2, 2] as SplineVector,
      radius: 1,
    };
    const unauthored = await derive(stale, {
      projectedReferences: [
        {
          referenceId: "ref_stale_projection",
          status: "projected",
          geometry: [circle],
          diagnostics: [],
        },
      ],
    });
    expect(unauthored.regions).toEqual([]);
    expect(codes(unauthored)).toContain(
      "projected-region-reference-unauthored",
    );

    const recordless = makeSketchFixture();
    recordless.project("profile", [circle]);
    const input = recordless.build();
    const withoutRecord = await createSketchArrangementDeriver(
      capability,
    ).derive({
      ...input,
      definition: { ...input.definition, references: [] },
    });
    expect(withoutRecord.regions).toEqual([]);
    expect(codes(withoutRecord)).toContain(
      "projected-region-reference-unauthored",
    );
  });

  test("region ids do not depend on the order of authored records", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 6]);
    sketch.point("c", 5, 3);
    sketch.circle("k", "c", 2);
    const input = sketch.build();
    const reversed = {
      ...input.definition,
      pointIds: [...input.definition.pointIds].reverse(),
      points: [...input.definition.points].reverse(),
      entityIds: [...input.definition.entityIds].reverse(),
      entities: [...input.definition.entities].reverse(),
    };
    const deriver = createSketchArrangementDeriver(capability);
    const forward = await deriver.derive(input);
    const backward = await deriver.derive({
      ...input,
      definition: reversed,
      solvedSnapshot: {
        ...input.solvedSnapshot,
        solvedEntities: [...input.solvedSnapshot.solvedEntities].reverse(),
        solvedPoints: [...input.solvedSnapshot.solvedPoints].reverse(),
      },
    });
    expect(forward.regions).toHaveLength(2);
    expect(ids(backward)).toEqual(ids(forward));
  });

  test("two crossing lines inside a rectangle subdivide it into four bounded cells", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 10]);
    sketch.point("h0", -2, 5);
    sketch.point("h1", 12, 5);
    sketch.point("v0", 5, -2);
    sketch.point("v1", 5, 12);
    sketch.line("h", "h0", "h1");
    sketch.line("v", "v0", "v1");
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(4);
    for (const region of result.regions) {
      expect(region.loops).toHaveLength(1);
      expect(region.loops[0]!.segments).toHaveLength(4);
    }
  });

  test("concentric circles without contacts give an annulus and an inner disk", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("outer", "c", 6);
    sketch.circle("inner", "c", 2);
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.regions
        .map((region) => region.loops.map((loop) => loop.role))
        .sort(),
    ).toEqual([["outer"], ["outer", "inner"]]);
  });

  test("a closed construction circle creates no region and does not split a profile", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 10]);
    sketch.point("c", 10, 5);
    sketch.circle("k", "c", 3, true);
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["r_s0", "r_s1", "r_s2", "r_s3"],
    ]);
  });
});

describe("region arrangement owner: exact overlaps and U6 identity", () => {
  const square = (sketch: SketchFixture, side: number) =>
    addRectangle(sketch, "r", [0, 0, side, side]);
  const squareId = async (side: number) => {
    const sketch = makeSketchFixture();
    square(sketch, side);
    return (await derive(sketch)).regions[0]!.regionId;
  };

  test("A (10) on side B sharing one corner: the square keeps its id at 11 (A strictly inside B)", async () => {
    const plain = await squareId(10);
    expect(await squareId(11)).toBe(plain);
    const sketch = makeSketchFixture();
    square(sketch, 11);
    sketch.point("ae", 10, 0);
    sketch.line("A", "r0", "ae");
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0]!.regionId).toBe(plain);
    const overlapped = result.regions[0]!.loops[0]!.segments.find(
      (segment) => segment.coincidentBranches,
    )!;
    expect(entityOf(overlapped)).toBe("r_s0");
    expect(overlapped.coincidentBranches).toEqual([
      {
        source: { kind: "entity", entityId: "sketch_entity_A" },
        spanId: "whole",
      },
    ]);
    expect(overlapped.sourceParameterInterval).toEqual([0, 10 / 11]);
    expect(overlapped.end?.kind).toBe("verifiedIntersection");
  });

  test("A on B with the corner declared on A keeps the square id at 10 and 9 (the stub is pruned)", async () => {
    const plain = await squareId(10);
    for (const side of [10, 9]) {
      const sketch = makeSketchFixture();
      square(sketch, side);
      sketch.point("ae", 10, 0);
      sketch.line("A", "r0", "ae");
      sketch.pointOnCurve("r1", "A");
      const result = await derive(sketch);
      expect(result.diagnostics, `side ${side}`).toEqual([]);
      expect(
        result.regions.map((region) => region.regionId),
        `side ${side}`,
      ).toEqual([plain]);
      const merged = result.regions[0]!.loops[0]!.segments.find(
        (segment) => segment.coincidentBranches,
      )!;
      expect(
        entityOf(merged),
        "the boundary side is primary; the duplicate is coincident",
      ).toBe("r_s0");
    }
  });

  test("undeclared A end or body exactly through another corner blocks that face (U6 limitation, R4)", async () => {
    for (const side of [10, 9]) {
      const sketch = makeSketchFixture();
      square(sketch, side);
      sketch.point("ae", 10, 0);
      sketch.line("A", "r0", "ae");
      addRectangle(sketch, "q", [30, 0, 40, 10]);
      const result = await derive(sketch);
      expect(result.regions.map(boundaryEntities), `side ${side}`).toEqual([
        ["q_s0", "q_s1", "q_s2", "q_s3"],
      ]);
      expect(codes(result)).toEqual(["region-vertex-order-uncertain"]);
      expect(targetsOf(result, "region-vertex-order-uncertain")).toEqual([
        "A",
        "r_s0",
        "r_s1",
        "r_s2",
        "r_s3",
      ]);
    }
  });

  test("a non-bitwise shared corner (1e-12 residual) blocks only the affected face (T09a overlap admission)", async () => {
    const sketch = makeSketchFixture();
    square(sketch, 11);
    sketch.point("as", 1e-12, 0);
    sketch.point("ae", 10, 0);
    sketch.line("A", "as", "ae");
    sketch.coincident("as", "r0");
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-join-uncertain"]);
    expect(targetsOf(result, "region-join-uncertain")).toEqual(["A", "r_s0"]);
    expect(result.diagnostics[0]!.message).toContain(
      "join-overlap-unsupported",
    );
  });

  test("the over-constrained corner-to-corner variant is not an accepted solve: no regions", async () => {
    const sketch = makeSketchFixture();
    square(sketch, 11);
    sketch.point("ae", 11, 0);
    sketch.line("A", "r0", "ae");
    sketch.coincident("ae", "r1");
    sketch.lineLength("A", 10);
    sketch.lineLength("r_s0", 11);
    const definition = sketch.definition();
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: FIXTURE_TOLERANCE,
        angleRadians: 1e-4,
        minimumSegmentLength: FIXTURE_TOLERANCE,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
    });
    expect(solved.status.solveState).not.toBe("solved");
    const result = await derive(sketch, {
      solvedSnapshot: solved.solvedSnapshot,
    });
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["regions-unavailable"]);
  });

  test("reversed partial exact overlap between two squares with declared corners merges one edge", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 10]);
    addRectangle(sketch, "q", [10, 5, 20, 15]);
    sketch.pointOnCurve("q0", "r_s1");
    sketch.pointOnCurve("r2", "q_s3");
    const result = await derive(sketch);
    expect(result.diagnostics).toEqual([]);
    expect(result.regions).toHaveLength(2);
    const shared = result.regions.flatMap((region) =>
      region.loops[0]!.segments.filter((segment) => segment.coincidentBranches),
    );
    expect(shared).toHaveLength(2);
    expect(
      new Set(shared.map((segment) => segment.traversalDirection)).size,
      "the two faces traverse the shared edge oppositely",
    ).toBe(2);
  });

  test("uncertain overlaps (non-structural cubic, coincident circles) are blocked in scope; a disjoint rectangle stays", async () => {
    const full: SplineVector[] = [
      [0, 0],
      [1, 2],
      [3, 2],
      [4, 0],
    ];
    const half: SplineVector[] = [
      [0, 0],
      [0.5, 1],
      [1.25, 1.5],
      [2, 1.5],
    ];
    const cubic = makeSketchFixture();
    cubic.project("A", [
      projectedSpline("projected_geometry_a", [
        neutralSpan(full, 0, ["a0", "a1"], 0),
      ]),
    ]);
    cubic.project("B", [
      projectedSpline("projected_geometry_b", [
        neutralSpan(half, 0, ["b0", "b1"], 0),
      ]),
    ]);
    addRectangle(cubic, "q", [30, 0, 40, 10]);
    const cubicResult = await derive(cubic);
    expect(cubicResult.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(cubicResult.diagnostics.map((d) => [d.code, d.target])).toEqual([
      ["region-query-uncertain", null],
      ["region-query-uncertain", null],
    ]);
    expect(cubicResult.diagnostics[0]!.message).toContain(
      "non-structural-cubic-overlap",
    );
    expect(cubicResult.diagnostics[0]!.message).toContain(
      "ref_A/projected_geometry_a",
    );

    const circles = makeSketchFixture();
    circles.point("a", 0, 0);
    circles.circle("c1", "a", 1);
    circles.point("b", 0, 0);
    circles.circle("c2", "b", 1);
    addRectangle(circles, "q", [30, 0, 40, 10]);
    const circleResult = await derive(circles);
    expect(circleResult.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(circleResult)).toEqual(["region-query-uncertain"]);
    expect(targetsOf(circleResult, "region-query-uncertain")).toEqual([
      "c1",
      "c2",
    ]);
  });

  test("a blocked component nested in a face blocks that face only", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [-5, -5, 5, 5]);
    sketch.point("a", 0, 0);
    sketch.circle("c1", "a", 1);
    sketch.point("b", 0, 0);
    sketch.circle("c2", "b", 1);
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual([
      "region-nesting-uncertain",
      "region-query-uncertain",
    ]);
    expect(targetsOf(result, "region-nesting-uncertain")).toEqual([
      "r_s0",
      "r_s1",
      "r_s2",
      "r_s3",
    ]);
  });
});

describe("analytic piece areas against an independent quadrature oracle", () => {
  /** Composite 5-point Gauss–Legendre of ½∫(x y′ − y x′) dt, spec-only oracle. */
  function quadrature(
    point: (t: number) => SplineVector,
    derivative: (t: number) => SplineVector,
    from: number,
    to: number,
    origin: SplineVector,
  ) {
    const nodes = [
      0, -0.5384693101056831, 0.5384693101056831, -0.906179845938664,
      0.906179845938664,
    ];
    const weights = [
      0.5688888888888889, 0.47862867049936647, 0.47862867049936647,
      0.23692688505618908, 0.23692688505618908,
    ];
    const pieces = 256;
    let total = 0;
    for (let piece = 0; piece < pieces; piece += 1) {
      const a = from + ((to - from) * piece) / pieces;
      const b = from + ((to - from) * (piece + 1)) / pieces;
      nodes.forEach((node, index) => {
        const t = (a + b) / 2 + ((b - a) / 2) * node;
        const [x, y] = point(t);
        const [dx, dy] = derivative(t);
        total +=
          weights[index]! *
          ((b - a) / 2) *
          0.5 *
          ((x - origin[0]) * dy - (y - origin[1]) * dx);
      });
    }
    return total;
  }
  const expectEnclosed = (
    interval: readonly [number, number],
    oracle: number,
    label: string,
  ) => {
    const slack = 1e-12 * Math.max(1, Math.abs(oracle));
    expect(interval[0], `${label}: lower bound`).toBeLessThanOrEqual(
      oracle + slack,
    );
    expect(interval[1], `${label}: upper bound`).toBeGreaterThanOrEqual(
      oracle - slack,
    );
    expect(interval[1] - interval[0], `${label}: bound is tight`).toBeLessThan(
      1e-9 * Math.max(1, Math.abs(oracle)),
    );
  };
  const provenance = { sourceEntityId: "oracle", sourceSpanId: "whole" };

  test("segment pieces", () => {
    const curve: NeutralCurve = {
      kind: "line",
      form: "endpointSegment",
      curveId: "s",
      provenance,
      start: [1, 2],
      end: [5, -3],
      sourceDomain: [0, 1],
    };
    const point = (t: number): SplineVector => [1 + 4 * t, 2 - 5 * t];
    for (const [from, to] of [
      [0.2, 0.9],
      [1, 0],
      [0, 1],
    ] as const) {
      const area = certifyNeutralCurvePieceSignedArea(
        curve,
        [from, from],
        [to, to],
        [0.5, 0.25],
      );
      expectEnclosed(
        area,
        quadrature(point, () => [4, -5], from, to, [0.5, 0.25]),
        `segment ${from}→${to}`,
      );
    }
  });

  test("arc and full-circle pieces", () => {
    const curve: NeutralCurve = {
      kind: "circle",
      curveId: "c",
      provenance,
      center: [2, -1],
      radius: 3,
      xAxis: [1, 0],
      sourceDomain: { kind: "fullTurn", seam: 0 },
    };
    const point = (t: number): SplineVector => [
      2 + 3 * Math.cos(t),
      -1 + 3 * Math.sin(t),
    ];
    const derivative = (t: number): SplineVector => [
      -3 * Math.sin(t),
      3 * Math.cos(t),
    ];
    for (const [from, to] of [
      [0.3, 2.9],
      [2.9, 0.3],
      [-1, 4],
    ] as const) {
      const area = certifyNeutralCurvePieceSignedArea(
        curve,
        [from, from],
        [to, to],
        [1, 1],
      );
      expectEnclosed(
        area,
        quadrature(point, derivative, from, to, [1, 1]),
        `arc ${from}→${to}`,
      );
    }
    const full = certifyNeutralCurvePieceSignedArea(
      curve,
      [0, 0],
      [2 * Math.PI, 2 * Math.PI],
      [7, -4],
    );
    expectEnclosed(full, 9 * Math.PI, "full circle");
  });

  test("cubic sub-span pieces over an affine source domain", () => {
    const poles: SplineVector[] = [
      [0, 0],
      [1, 3],
      [4, -2],
      [5, 1],
    ];
    const curve: NeutralCurve = {
      kind: "cubicBezier",
      curveId: "b",
      provenance,
      poles: poles as unknown as SplineSpan["poles"],
      sourceDomain: [2, 5],
    };
    const bernstein = (u: number) => [
      (1 - u) ** 3,
      3 * u * (1 - u) ** 2,
      3 * u * u * (1 - u),
      u ** 3,
    ];
    const point = (t: number): SplineVector => {
      const b = bernstein((t - 2) / 3);
      return [0, 1].map((axis) =>
        b.reduce(
          (sum, weight, index) => sum + weight * poles[index]![axis]!,
          0,
        ),
      ) as unknown as SplineVector;
    };
    const derivative = (t: number): SplineVector => {
      const u = (t - 2) / 3;
      const d = [(1 - u) ** 2, 2 * u * (1 - u), u * u];
      return [0, 1].map(
        (axis) =>
          (d.reduce(
            (sum, weight, index) =>
              sum + weight * (poles[index + 1]![axis]! - poles[index]![axis]!),
            0,
          ) *
            3) /
          3,
      ) as unknown as SplineVector;
    };
    for (const [from, to] of [
      [2.75, 4.4],
      [5, 2],
      [2, 5],
    ] as const) {
      const area = certifyNeutralCurvePieceSignedArea(
        curve,
        [from, from],
        [to, to],
        [-1, 2],
      );
      expectEnclosed(
        area,
        quadrature(point, derivative, from, to, [-1, 2]),
        `cubic ${from}→${to}`,
      );
    }
  });

  test("region ranking follows certified areas", async () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "small", [0, 0, 1, 1]);
    addRectangle(sketch, "large", [10, 0, 20, 10]);
    sketch.point("c", 40, 0);
    sketch.circle("mid", "c", 2);
    const result = await derive(sketch);
    expect(
      result.regions.map((region) => [
        region.label,
        boundaryEntities(region)[0],
      ]),
    ).toEqual([
      ["Outer region", "large_s0"],
      ["Loop region 2", "mid"],
      ["Loop region 3", "small_s0"],
    ]);
  });
});

describe("region identity under edits", () => {
  test("signatures are stable under topology-preserving motion", async () => {
    const shapes: [string, (sketch: SketchFixture, step: number) => void][] = [
      [
        "rectangle",
        (sketch, step) =>
          addRectangle(sketch, "r", [step, -step, 10 + 3 * step, 5 + step]),
      ],
      [
        "rectangle + inner circle",
        (sketch, step) => {
          addRectangle(sketch, "r", [0, 0, 10, 5]);
          sketch.point("c", 5 + step, 2.5);
          sketch.circle("c1", "c", 1 + step / 4);
        },
      ],
      [
        "rounded rectangle",
        (sketch, step) =>
          roundedRectangle(sketch, [10 + step, 6, 1 + step / 4]),
      ],
      [
        "crossing circle",
        (sketch, step) => {
          addRectangle(sketch, "r", [0, 0, 10, 5]);
          sketch.point("c", 10, 2.5 + step / 2);
          sketch.circle("c1", "c", 1 + step / 4);
        },
      ],
      [
        // Review probe C: the centre crosses the top side, so the circle's
        // fixed seam moves from the lower arc to the upper one.
        "circle crossing a side, its seam moving to the other arc",
        (sketch, step) => {
          addRectangle(sketch, "r", [0, 0, 10, 10]);
          sketch.point("c", 5, 9.7 + 0.6 * step);
          sketch.circle("k", "c", 2);
        },
      ],
      [
        // c1's seam (2, 0) starts inside c2 and ends outside it.
        "two crossing circles, one seam moving across the other circle",
        (sketch, step) => {
          sketch.point("a", 0, 0);
          sketch.circle("c1", "a", 2);
          sketch.point("b", step === 0 ? 3 : 0, step === 0 ? 0 : 3);
          sketch.circle("c2", "b", 2);
        },
      ],
    ];
    for (const [label, build] of shapes) {
      const results = [];
      for (const step of [0, 1]) {
        const sketch = makeSketchFixture();
        build(sketch, step);
        results.push(await derive(sketch));
      }
      expect(results[0]!.regions.length, label).toBeGreaterThan(0);
      expect(ids(results[1]!), label).toEqual(ids(results[0]!));
    }
    const lobes = [];
    for (const wiggle of [0, 0.25]) {
      const sketch = makeSketchFixture();
      lemniscate(sketch, 6, wiggle);
      lobes.push(await derive(sketch));
    }
    expect(ids(lobes[1]!)).toEqual(ids(lobes[0]!));
  }, 60_000);

  test("a crossing added to a family invalidates every region using it", async () => {
    const wave = async (dip: number) => {
      const sketch = makeSketchFixture();
      addRectangle(sketch, "r", [0, 0, 10, 6]);
      [
        [2, -1],
        [4, dip],
        [6, -1],
        [8, 1],
      ].forEach(([x, y], index) => sketch.point(`w${index}`, x!, y!));
      sketch.spline("W", ["w0", "w1", "w2", "w3"], "open");
      return derive(sketch);
    };
    const one = await wave(-1.5);
    const three = await wave(1);
    expect(one.regions).toHaveLength(1);
    expect(three.regions).toHaveLength(3);
    for (const region of three.regions)
      expect(ids(one)).not.toContain(region.regionId);
  });

  test("reordering crossings along a branch changes the ids", async () => {
    const dividers = async ([p, q]: [number, number]) => {
      const sketch = makeSketchFixture();
      addRectangle(sketch, "r", [0, 0, 10, 5]);
      sketch.point("p0", p, -1);
      sketch.point("p1", p, 6);
      sketch.line("P", "p0", "p1");
      sketch.point("q0", q, -1);
      sketch.point("q1", q, 6);
      sketch.line("Q", "q0", "q1");
      return derive(sketch);
    };
    const before = await dividers([3, 7]);
    const after = await dividers([7, 3]);
    expect(before.regions).toHaveLength(3);
    expect(after.regions).toHaveLength(3);
    for (const id of ids(after)) expect(ids(before)).not.toContain(id);
  });

  test("a crossing that becomes a tangency changes the ids", async () => {
    const circle = async (cy: number) => {
      const sketch = makeSketchFixture();
      addRectangle(sketch, "r", [0, 0, 10, 6]);
      sketch.point("c", 5, cy);
      sketch.circle("C", "c", 2);
      return derive(sketch);
    };
    const crossing = await circle(5);
    const tangent = await circle(4);
    expect(crossing.regions).toHaveLength(3);
    expect(tangent.diagnostics).toEqual([]);
    expect(tangent.regions.map((region) => region.loops.length)).toEqual([
      2, 1,
    ]);
    for (const id of ids(tangent)) expect(ids(crossing)).not.toContain(id);
  });

  test("removing a lobe changes the ids", async () => {
    const eight = makeSketchFixture();
    lemniscate(eight);
    const lobes = await derive(eight);
    const loop = makeSketchFixture();
    [
      [5.543, 2.121],
      [0, 3],
      [-5.543, 2.121],
      [-5.543, -2.121],
      [0, -3],
      [5.543, -2.121],
    ].forEach(([x, y], index) => loop.point(`p${index}`, x!, y!));
    loop.spline("fig", ["p0", "p1", "p2", "p3", "p4", "p5"], "smooth");
    const single = await derive(loop);
    expect(single.regions).toHaveLength(1);
    expect(ids(lobes)).not.toContain(single.regions[0]!.regionId);
  }, 30_000);

  test("a hole-role change changes the containing region's id but not the disk's", async () => {
    const withCircle = async (cx: number) => {
      const sketch = makeSketchFixture();
      addRectangle(sketch, "r", [0, 0, 10, 5]);
      sketch.point("c", cx, 2.5);
      sketch.circle("c1", "c", 1);
      return derive(sketch);
    };
    const inside = await withCircle(5);
    const outside = await withCircle(20);
    const rectangle = (result: SketchArrangementResult) =>
      result.regions.find((region) =>
        boundaryEntities(region).includes("r_s0"),
      )!.regionId;
    const disk = (result: SketchArrangementResult) =>
      result.regions.find((region) => boundaryEntities(region).join() === "c1")!
        .regionId;
    expect(rectangle(outside)).not.toBe(rectangle(inside));
    expect(disk(outside)).toBe(disk(inside));
  });
});

describe("query routing through the injected capability", () => {
  function recording(base: NeutralCurveQueryCapability) {
    const requests: { operation: string; tolerance: number }[] = [];
    const capability: NeutralCurveQueryCapability = {
      queryNeutralCurves: async (request) => {
        requests.push({
          operation: "pair",
          tolerance: request.modelingTolerance,
        });
        return base.queryNeutralCurves(request);
      },
      queryNeutralCurveSelfIntersections: async (request) => {
        requests.push({
          operation: "self",
          tolerance: request.modelingTolerance,
        });
        return base.queryNeutralCurveSelfIntersections(request);
      },
      queryNeutralCurveJoin: async (request) => {
        requests.push({
          operation: "join",
          tolerance: request.modelingTolerance,
        });
        return base.queryNeutralCurveJoin(request);
      },
    };
    return { requests, capability };
  }

  test("declared pairs use the join query, disjoint boxes send nothing, and the document tolerance reaches every request", async () => {
    const { requests, capability: recorder } = recording(capability);
    const deriver = createSketchArrangementDeriver(recorder);
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 5]);
    sketch.point("c", 10, 2.5);
    sketch.circle("c1", "c", 1);
    await deriver.derive(sketch.build({ modelingTolerance: 0.00123 }));
    const count = (operation: string) =>
      requests.filter((request) => request.operation === operation).length;
    expect(count("join"), "four declared corners").toBe(4);
    // The circle meets only the right side (plus the nesting rays); opposite sides are pruned.
    expect(requests.every((request) => request.tolerance === 0.00123)).toBe(
      true,
    );
    expect(count("self")).toBe(0);
    const pairsBefore = count("pair");
    expect(pairsBefore).toBeGreaterThanOrEqual(1);

    // Exact memoization: an identical derivation sends no new request.
    const sent = requests.length;
    await deriver.derive(sketch.build({ modelingTolerance: 0.00123 }));
    expect(requests.length).toBe(sent);
    // A different tolerance is a different request.
    await deriver.derive(sketch.build({ modelingTolerance: 0.002 }));
    expect(
      requests.slice(sent).every((request) => request.tolerance === 0.002),
    ).toBe(true);
    expect(requests.length).toBeGreaterThan(sent);
  });

  test("declarations that cannot be queried block both branches and send no ordinary pair query (review 6)", async () => {
    // Three declared joins between one branch pair (at most two are supported).
    const three = makeSketchFixture();
    three.point("a0", 0, 0);
    three.point("a1", 10, 0);
    three.point("b0", 0, 0);
    three.point("b1", 10, 0);
    three.point("m", 5, 0);
    three.line("A", "a0", "a1");
    three.line("B", "b0", "b1");
    three.coincident("a0", "b0");
    three.coincident("a1", "b1");
    three.midpoint("m", "A");
    three.pointOnCurve("m", "B");
    // Both ends of L declared to join each other, and M joined there too.
    const ends = makeSketchFixture();
    ends.point("l0", 0, 0);
    ends.point("l1", 0, 1e-4);
    ends.point("m0", 0, 0);
    ends.point("m1", 5, 0);
    ends.line("L", "l0", "l1");
    ends.line("M", "m0", "m1");
    ends.coincident("l0", "l1");
    ends.coincident("l1", "m0");
    for (const [sketch, blocked] of [
      [three, ["A", "B"]],
      [ends, ["L", "M"]],
    ] as const) {
      addRectangle(sketch, "q", [30, 0, 40, 10]);
      const { requests, capability: recorder } = recording(capability);
      const result = await createSketchArrangementDeriver(recorder).derive(
        sketch.build(),
      );
      expect(result.regions.map(boundaryEntities)).toEqual([
        ["q_s0", "q_s1", "q_s2", "q_s3"],
      ]);
      expect(codes(result)).toEqual(["region-join-uncertain"]);
      expect(targetsOf(result, "region-join-uncertain")).toEqual([...blocked]);
      expect(
        requests.filter((request) => request.operation !== "join"),
        "only q's four corner joins are queried",
      ).toEqual([]);
    }
  });

  test("capability exceptions propagate and a non-positive tolerance is rejected", async () => {
    const failing: NeutralCurveQueryCapability = {
      ...capability,
      queryNeutralCurveJoin: async () => {
        throw new Error("kernel exploded");
      },
    };
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 10, 5]);
    await expect(
      createSketchArrangementDeriver(failing).derive(sketch.build()),
    ).rejects.toThrow("kernel exploded");
    await expect(
      createSketchArrangementDeriver(capability).derive(
        sketch.build({ modelingTolerance: 0 }),
      ),
    ).rejects.toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// T08b-g3: published derived offset shells as region input (dark)
// ---------------------------------------------------------------------------

/*
 * The native authoring seams below are the offset-chain topology spec's own
 * (verbatim, as `offset-derivation-frame.spec.ts` carries them): contracts
 * fixtures may not import implementation layers (static guard), so each spec
 * injects them.
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

const offsetQuery = createCertifiedNeutralCurveRequestQuery();
const offsetCertifier = createCertifiedCubicTubeChain();
const chainHarnesses = {
  matrix: createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_g3m"),
    query: offsetQuery,
    modelingTolerance: FIXTURE_TOLERANCE,
    solveTolerances: CORNER_MATRIX_SOLVE_TOLERANCES,
  }),
  native: createNativeOffsetChainHarness({
    authoring: createNativeToolAuthoring("sketch_g3n"),
    query: offsetQuery,
    modelingTolerance: FIXTURE_TOLERANCE,
  }),
};
const offsetArcHarness = createNativeArcOffsetHarness({
  authoring: createNativeArcAuthoring("sketch_g3f"),
  modelingTolerance: FIXTURE_TOLERANCE,
  solveTolerances: createDocumentSolverTolerances(OCC_KERNEL_SETTINGS),
});

interface OffsetRow {
  pair: AcceptedPair;
  seeds: readonly SketchEntityId[];
  distance: number;
  publication: CertifiedOffsetFramePublication;
}

/** The T08b-g plan §3.1 publish cycle: solve, publish, at most one hinted re-solve. */
function certifiedPublication(
  pair: AcceptedPair,
  seeds: readonly SketchEntityId[],
  distance: number,
): CertifiedOffsetFramePublication {
  const relationship: OffsetFrameRelationship = {
    derivationId: "derivation_g3",
    seedEntityIds: seeds,
    distance,
  };
  const solve = (plan?: OffsetFramePlan) => {
    const frame = solveOffsetFrame(
      {
        relationship,
        definition: pair.definition,
        modelingTolerance: FIXTURE_TOLERANCE,
      },
      plan,
    );
    if (!frame.ok) throw new Error(`solve frame: ${frame.failure.message}`);
    return frame;
  };
  const publish = (solveFrame: ReturnType<typeof solve>) =>
    publishOffsetFrame({
      relationship,
      pair,
      modelingTolerance: FIXTURE_TOLERANCE,
      query: offsetQuery,
      certifier: offsetCertifier,
      solveFrame,
    });
  let publication = publish(solve());
  if (publication.status === "planChanged")
    publication = publish(solve(publication.plan));
  if (publication.status !== "certified")
    throw new Error(
      `publish: ${publication.status === "failed" ? publication.failure.message : publication.status}`,
    );
  return publication;
}

/** A chain row (`${row} ${distance}`, corner matrix by default) through native commit, solve and publish. */
function nativeChainRow(label: string, family = "corner matrix"): OffsetRow {
  const row = offsetFrameChainRows().find(
    (item) =>
      item.family === family && `${item.row} ${item.distance}` === label,
  );
  if (!row) throw new Error(`no row ${label}`);
  const harness = chainHarnesses[row.harness];
  harness.resetSequence();
  const pair = harness.solvedPair(row.build(harness));
  const seeds = pair.definition.entities.map((entity) => entity.entityId);
  return {
    pair,
    seeds,
    distance: row.distance,
    publication: certifiedPublication(pair, seeds, row.distance),
  };
}

/** A D3 row (`${row} ${distance}`) through native tools, Offset, solve and publish. */
function nativeD3Row(label: string): OffsetRow {
  const row = seedArcRows().find(
    (item) => `${item.row} ${item.distance}` === label,
  );
  if (!row) throw new Error(`no row ${label}`);
  const sketch = row.build(offsetArcHarness);
  const { pair } = offsetArcHarness.adapt(sketch, row.distance);
  return {
    pair,
    seeds: sketch.seeds,
    distance: row.distance,
    publication: certifiedPublication(pair, sketch.seeds, row.distance),
  };
}

const positionOf = (sketch: SketchFixture, name: string): SplineVector =>
  sketch
    .definition()
    .points.find((point) => point.pointId === `sketch_point_${name}`)!
    .position as SplineVector;

interface OffsetSketch {
  sketch: SketchFixture;
  outputs: OffsetPublicationOutputs;
  /** Oracle curves of the closing lines, after the published chain. */
  closing: OracleCurve[];
}

/**
 * The publication's outputs in a fresh fixture; an open chain is closed by
 * one line (end → start) or by two axis-parallel lines through a corner.
 */
function offsetSketch(
  publication: CertifiedOffsetFramePublication,
  close?: "line" | "lines",
): OffsetSketch {
  const sketch = makeSketchFixture();
  const outputs = addOffsetFramePublication(sketch, publication.frame);
  const closing: OracleCurve[] = [];
  if (close) {
    const start = positionOf(sketch, outputs.start!);
    const end = positionOf(sketch, outputs.end!);
    if (close === "line") {
      sketch.line("close", outputs.end!, outputs.start!);
      closing.push(lineOracle(end, start));
    } else {
      const corner: SplineVector = [start[0], end[1]];
      sketch.point("closeQ", corner[0], corner[1]);
      sketch.line("close0", outputs.end!, "closeQ");
      sketch.line("close1", "closeQ", outputs.start!);
      closing.push(lineOracle(end, corner), lineOracle(corner, start));
    }
  }
  return { sketch, outputs, closing };
}

/** The arrangement of an offset sketch, with its derived curves. */
const deriveOffset = (offset: OffsetSketch) =>
  derive(offset.sketch, { derivedCurves: offset.outputs.derivedCurves });

/** Oracle curves of one region loop, read back from its segment records. */
function regionLoopCurves(
  loop: RegionRecord["loops"][number],
  input: SketchArrangementInput,
): OracleCurve[] {
  const solved = new Map(
    input.solvedSnapshot.solvedEntities.map((entity) => [
      entity.entityId,
      entity,
    ]),
  );
  return loop.segments.map((segment): OracleCurve => {
    const [lo, hi] = segment.sourceParameterInterval;
    const [from, to] =
      segment.traversalDirection === "forward" ? [lo, hi] : [hi, lo];
    const source = segment.branch.source;
    if (source.kind !== "entity") throw new Error("a projected segment");
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
      return cubicOracle(span.poles, span.sourceDomain, from, to);
    }
    const geometry = solved.get(source.entityId)!;
    if (geometry.kind === "lineSegment")
      return {
        ...lineOracle(geometry.startPosition, geometry.endPosition),
        from,
        to,
      };
    if (geometry.kind === "spline") {
      const span = geometry.reconstruction.spans.find(
        (candidate) =>
          `${candidate.source.startOccurrenceId}>${candidate.source.endOccurrenceId}` ===
          segment.branch.spanId,
      )!;
      return cubicOracle(span.poles, span.interval, from, to);
    }
    if (geometry.kind !== "arc" && geometry.kind !== "circle")
      throw new Error(`no oracle for ${geometry.kind}`);
    const center = geometry.centerPosition;
    const radius =
      geometry.kind === "circle"
        ? geometry.solvedRadius
        : Math.hypot(
            geometry.startPosition[0] - center[0],
            geometry.startPosition[1] - center[1],
          );
    return {
      point: (t) => [
        center[0] + radius * Math.cos(t),
        center[1] + radius * Math.sin(t),
      ],
      derivative: (t) => [-radius * Math.sin(t), radius * Math.cos(t)],
      from,
      to,
    };
  });
}

/**
 * The region is exactly the published (trimmed) loop: its one outer loop's
 * area equals the published loop's area (the independent quadrature oracle
 * over the publication), and on every derived sub-span its segments tile the
 * published `queryDomain` exactly, ending bitwise at the trim parameters.
 */
function expectPublishedRegion(
  region: RegionRecord,
  input: SketchArrangementInput,
  offset: OffsetSketch,
  label: string,
) {
  expect(
    region.loops.map((loop) => loop.role),
    label,
  ).toEqual(["outer"]);
  const area = closedCurvesSignedArea(
    regionLoopCurves(region.loops[0]!, input),
  );
  const published = Math.abs(
    closedCurvesSignedArea([
      ...publishedOracleCurves(offset.outputs.pieces),
      ...offset.closing,
    ]),
  );
  expect(area, `${label}: counter-clockwise outer loop`).toBeGreaterThan(0);
  expect(
    Math.abs(area - published),
    `${label}: region area ${area} = published loop area ${published}`,
  ).toBeLessThanOrEqual(1e-9 * Math.max(1, published));
  for (const shell of offset.outputs.derivedCurves)
    for (const span of shell.spans) {
      const intervals = region.loops[0]!.segments.filter(
        (segment) =>
          segment.branch.source.kind === "entity" &&
          segment.branch.source.entityId === shell.outputEntityId &&
          segment.branch.spanId === span.outputSpanId &&
          span.sourceDomain[0] <= segment.sourceParameterInterval[0] &&
          segment.sourceParameterInterval[1] <= span.sourceDomain[1],
      )
        .map((segment) => segment.sourceParameterInterval)
        .sort((l, r) => l[0] - r[0]);
      const where = `${label}: sub-span ${span.outputSpanId}.${span.subIndex}`;
      expect(intervals.length, `${where} bounds the region`).toBeGreaterThan(0);
      expect(
        Object.is(intervals[0]![0], span.queryDomain[0]) &&
          Object.is(intervals.at(-1)![1], span.queryDomain[1]),
        `${where}: its segments end bitwise at the published domain`,
      ).toBe(true);
      for (let k = 0; k + 1 < intervals.length; k += 1)
        expect(intervals[k]![1], where).toBe(intervals[k + 1]![0]);
    }
}

/** Source loop curves in the frame's traversal order (for the Steiner oracle). */
function sourceLoopCurves(row: OffsetRow): OracleCurve[] {
  const solved = new Map(
    row.pair.solvedSnapshot.solvedEntities.map((entity) => [
      entity.entityId,
      entity,
    ]),
  );
  return row.publication.frame.pieces.flatMap((piece) => {
    const geometry = solved.get(piece.seedEntityId)!;
    const curves: OracleCurve[] =
      geometry.kind === "lineSegment"
        ? [lineOracle(geometry.startPosition, geometry.endPosition)]
        : geometry.kind === "arc"
          ? [
              arcOracle(
                geometry.centerPosition,
                geometry.startPosition,
                geometry.endPosition,
                geometry.sweepDirection,
              ),
            ]
          : geometry.kind === "spline"
            ? geometry.reconstruction.spans.map((span) =>
                cubicOracle(span.poles, span.interval, ...span.interval),
              )
            : [];
    return piece.reversed
      ? curves.reverse().map((curve) => ({
          ...curve,
          from: curve.to,
          to: curve.from,
        }))
      : curves;
  });
}

describe("T08b-g3 derived offset shells as region input", () => {
  const acceptance: {
    label: string;
    row: () => OffsetRow;
    close?: "line" | "lines";
    /** The offset is a parallel body of a convex source (Steiner's formula holds). */
    steiner: boolean;
  }[] = [
    {
      label: "SL-loop 0.01",
      row: () => nativeChainRow("SL-loop 0.01"),
      steiner: true,
    },
    {
      label: "SL-loop -0.01",
      row: () => nativeChainRow("SL-loop -0.01"),
      steiner: false,
    },
    {
      label: "rounded rect 0.01",
      row: () => nativeD3Row("rounded rect 0.01"),
      steiner: true,
    },
    {
      label: "rounded rect -0.01",
      row: () => nativeD3Row("rounded rect -0.01"),
      steiner: true,
    },
    {
      label: "rounded rect -0.1",
      row: () => nativeD3Row("rounded rect -0.1"),
      steiner: true,
    },
    { label: "slot 0.01", row: () => nativeD3Row("slot 0.01"), steiner: true },
    {
      label: "slot -0.01",
      row: () => nativeD3Row("slot -0.01"),
      steiner: true,
    },
    { label: "slot 0.1", row: () => nativeD3Row("slot 0.1"), steiner: true },
    { label: "lens 0.01", row: () => nativeD3Row("lens 0.01"), steiner: false },
    {
      label: "lens -0.01",
      row: () => nativeD3Row("lens -0.01"),
      steiner: true,
    },
    { label: "lens -0.1", row: () => nativeD3Row("lens -0.1"), steiner: true },
    {
      label: "SS-60 -0.01 closed by a line",
      row: () => nativeChainRow("SS-60 -0.01"),
      close: "line",
      steiner: false,
    },
    {
      label: "trimmed SL-90 0.01 closed by lines",
      row: () => nativeChainRow("SL-90 0.01"),
      close: "lines",
      steiner: false,
    },
    {
      label: "trimmed SL-90 0.2 closed by lines",
      row: () => nativeChainRow("SL-90 0.2"),
      close: "lines",
      steiner: false,
    },
  ];

  test.each(acceptance.map((entry) => [entry.label, entry] as const))(
    "%s: the published loop gives one closed region, its area checked against an independent oracle",
    async (label, entry) => {
      const row = entry.row();
      const offset = offsetSketch(row.publication, entry.close);
      const result = await deriveOffset(offset);
      expect(codes(result), label).toEqual([]);
      expect(result.regions, label).toHaveLength(1);
      expectPublishedRegion(
        result.regions[0]!,
        offset.sketch.build({ derivedCurves: offset.outputs.derivedCurves }),
        offset,
        label,
      );
      if (!entry.steiner) return;
      // Steiner: a parallel body of a convex source at |d| has area
      // A0 ± L0·|d| + π·d² (outward +; inward exact while every curvature
      // radius is at least |d|), up to the owner's certified cubic error.
      const source = sourceLoopCurves(row);
      const signed = closedCurvesSignedArea(source);
      const length = curvesLength(source);
      const outward = Math.sign(signed) * row.distance < 0 ? 1 : -1;
      const d = Math.abs(row.distance);
      const steiner = Math.abs(signed) + outward * length * d + Math.PI * d * d;
      const error = Math.max(
        0,
        ...row.publication.frame.pieces.flatMap((piece) =>
          piece.kind === "derivedCubic"
            ? piece.spans.map((span) => span.certifiedError)
            : [],
        ),
      );
      const area = Math.abs(
        closedCurvesSignedArea(publishedOracleCurves(offset.outputs.pieces)),
      );
      expect(
        Math.abs(area - steiner),
        `${label}: published area ${area} against Steiner ${steiner}`,
      ).toBeLessThanOrEqual(length * error + 1e-9 * Math.max(1, steiner));
      expect(result.regions[0]!.label).toBe("Outer region");
    },
    120_000,
  );

  test("an offset loop nests with its source outline: annulus plus inner disk (SL-loop 0.01)", async () => {
    const row = nativeChainRow("SL-loop 0.01");
    const offset = offsetSketch(row.publication);
    const names = new Map(
      row.pair.definition.points.map((point, index) => [
        point.pointId,
        `src${index}`,
      ]),
    );
    const name = (pointId: SketchPointId) => names.get(pointId)!;
    for (const point of row.pair.definition.points)
      offset.sketch.point(name(point.pointId), ...point.position);
    row.pair.definition.entities.forEach((entity, index) => {
      if (entity.kind === "lineSegment")
        offset.sketch.line(
          `src_${index}`,
          name(entity.startPointId),
          name(entity.endPointId),
        );
      else if (entity.kind === "spline")
        offset.sketch.spline(
          `src_${index}`,
          entity.pointOccurrences.map((occurrence) => name(occurrence.pointId)),
          entity.closure,
        );
      else throw new Error(`unexpected source ${entity.kind}`);
    });
    for (const constraint of row.pair.definition.constraints)
      if (constraint.kind === "coincident")
        offset.sketch.coincident(
          name(constraint.pointIds[0]),
          name(constraint.pointIds[1]),
        );
    const result = await deriveOffset(offset);
    expect(codes(result)).toEqual([]);
    expect(result.regions.map((region) => region.loops.length)).toEqual([2, 1]);
    const input = offset.sketch.build({
      derivedCurves: offset.outputs.derivedCurves,
    });
    const loopArea = (loop: RegionRecord["loops"][number]) =>
      closedCurvesSignedArea(regionLoopCurves(loop, input));
    const [annulus, disk] = result.regions as [RegionRecord, RegionRecord];
    const published = Math.abs(
      closedCurvesSignedArea(publishedOracleCurves(offset.outputs.pieces)),
    );
    const source = Math.abs(closedCurvesSignedArea(sourceLoopCurves(row)));
    expect(loopArea(annulus.loops[0]!)).toBeCloseTo(published, 9);
    expect(-loopArea(annulus.loops[1]!)).toBeCloseTo(source, 9);
    expect(loopArea(disk.loops[0]!)).toBeCloseTo(source, 9);
    expect(boundaryEntities(disk)).toEqual(["src_0", "src_1"]);
  }, 120_000);

  test.each(
    offsetPartitionDragRows().map((row) => [row.distance, row] as const),
  )(
    "region ids survive the owner's partition refinement along the probe drag (SL-loop, d = %s)",
    async (_distance, row) => {
      const harness = chainHarnesses.matrix;
      harness.resetSequence();
      const committed = row.build(harness);
      const steps = [];
      for (const height of row.heights) {
        const pair = harness.solvedPair(row.drag(committed, height));
        const seeds = pair.definition.entities.map((entity) => entity.entityId);
        const offset = offsetSketch(
          certifiedPublication(pair, seeds, row.distance),
        );
        const result = await deriveOffset(offset);
        expect(codes(result), `height ${height}`).toEqual([]);
        const shell = offset.outputs.derivedCurves[0]!;
        steps.push({
          height,
          partition: shell.spans
            .map((span) => `${span.outputSpanId}.${span.subIndex}`)
            .join("|"),
          subSpans: shell.spans.length,
          segments: result.regions[0]!.loops[0]!.segments.length,
          ids: ids(result),
        });
      }
      // The drag refines the sub-partition (4, 6, 6, 8, 10 sub-spans) and the
      // loop records follow it, while every region id stays the same.
      expect(steps.map((step) => step.subSpans)).toEqual([4, 6, 6, 8, 10]);
      expect(new Set(steps.map((step) => step.segments)).size).toBe(4);
      expect(steps.every((step) => step.ids.length === 1)).toBe(true);
      expect(new Set(steps.map((step) => step.ids[0])).size).toBe(1);
    },
    300_000,
  );

  test.each(
    offsetPartitionDragRows().map((row) => [row.distance, row] as const),
  )(
    "a circle crossing one output span twice, in two sub-spans, keeps two distinct crossing keys and the region ids along the probe drag (shared-key census, SL-loop, d = %s)",
    async (_distance, row) => {
      const harness = chainHarnesses.matrix;
      harness.resetSequence();
      const committed = row.build(harness);
      const steps = [];
      for (const height of row.heights) {
        const pair = harness.solvedPair(row.drag(committed, height));
        const seeds = pair.definition.entities.map((entity) => entity.entityId);
        const offset = offsetSketch(
          certifiedPublication(pair, seeds, row.distance),
        );
        const shell = offset.outputs.derivedCurves[0]!;
        // A circle (r = 0.05) centred on output span 0 at its mid-parameter.
        const spanId = shell.spans[0]!.outputSpanId;
        const own = shell.spans.filter((span) => span.outputSpanId === spanId);
        const [lo, hi] = [own[0]!.sourceDomain[0], own.at(-1)!.sourceDomain[1]];
        const t = (lo + hi) / 2;
        const host = own.find(
          (span) => span.sourceDomain[0] <= t && t <= span.sourceDomain[1],
        )!;
        const center = cubicOracle(
          host.poles,
          host.sourceDomain,
          ...host.sourceDomain,
        ).point(t);
        offset.sketch.point("hc", center[0], center[1]);
        offset.sketch.circle("h", "hc", 0.05);
        const result = await deriveOffset(offset);
        expect(codes(result), `height ${height}`).toEqual([]);
        // Every crossing vertex on the shell and the sub-span it lies in.
        const crossings = new Map<string, Set<string>>();
        for (const region of result.regions)
          for (const loop of region.loops)
            for (const segment of loop.segments) {
              if (
                segment.branch.source.kind !== "entity" ||
                segment.branch.source.entityId !== shell.outputEntityId
              )
                continue;
              const [a, b] = segment.sourceParameterInterval;
              const ends =
                segment.traversalDirection === "forward"
                  ? [
                      [segment.start, a],
                      [segment.end, b],
                    ]
                  : [
                      [segment.start, b],
                      [segment.end, a],
                    ];
              for (const [vertex, at] of ends as [
                RegionRecord["loops"][number]["segments"][number]["start"],
                number,
              ][]) {
                if (!vertex?.key.startsWith("x")) continue;
                const sub = shell.spans.find(
                  (span) =>
                    span.outputSpanId === segment.branch.spanId &&
                    span.sourceDomain[0] < at &&
                    at < span.sourceDomain[1],
                )!;
                const entry = crossings.get(vertex.key) ?? new Set<string>();
                entry.add(`${sub.outputSpanId}.${sub.subIndex}`);
                crossings.set(vertex.key, entry);
              }
            }
        steps.push({
          height,
          subSpans: shell.spans.length,
          regions: result.regions.length,
          keys: [...crossings.keys()].sort(),
          hosts: [...crossings.values()].flatMap((entry) => [...entry]),
          ids: ids(result),
        });
      }
      expect(steps.map((step) => step.subSpans)).toEqual([4, 6, 6, 8, 10]);
      for (const step of steps) {
        const at = `height ${step.height}`;
        // The circle splits the loop's region into three cells.
        expect(step.regions, at).toBe(3);
        // Two crossings of the one output span, each in its own sub-span.
        expect(step.keys, at).toHaveLength(2);
        expect(step.hosts, at).toHaveLength(2);
        expect(new Set(step.hosts).size, at).toBe(2);
      }
      // Crossing keys and region ids do not depend on the sub-partition.
      expect(new Set(steps.map((step) => JSON.stringify(step.keys))).size).toBe(
        1,
      );
      expect(new Set(steps.map((step) => JSON.stringify(step.ids))).size).toBe(
        1,
      );
    },
    300_000,
  );

  test("a forged crossing of the trimmed-off tail is not an arrangement event: the drawn loop keeps its plain id and area (fabricated arrangement input, not produced by the offset owner) ([TECH] G14′, D2 re-pin)", async () => {
    // SL-90 0.01 closed by lines: the shell is trimmed at T and its
    // untrimmed terminal sub-span runs on, undrawn, to the pole E. A line
    // through the line output and that tail would close a small cell whose
    // boundary is the undrawn tail. Its tail contact is certified strictly
    // beyond the trim, so it is dropped: the line's only drawn contact is
    // the line output, it dangles, and the drawn loop is unchanged.
    const row = nativeChainRow("SL-90 0.01");
    const plain = offsetSketch(row.publication, "lines");
    const plainIds = ids(await deriveOffset(plain));
    expect(plainIds).toHaveLength(1);
    const trim = row.publication.frame.trims[0]!.position;
    const withLine = async (from: SplineVector, to: SplineVector) => {
      const offset = offsetSketch(row.publication, "lines");
      offset.sketch.point("x0", from[0], from[1]);
      offset.sketch.point("x1", to[0], to[1]);
      offset.sketch.line("x", "x0", "x1");
      return deriveOffset(offset);
    };
    const [x, y] = trim;
    const forgedSketch = offsetSketch(row.publication, "lines");
    forgedSketch.sketch.point("x0", x - 0.005, y + 0.019);
    forgedSketch.sketch.point("x1", x + 0.01, y - 0.011);
    forgedSketch.sketch.line("x", "x0", "x1");
    const forged = await deriveOffset(forgedSketch);
    expect(codes(forged)).toEqual(["profile-open-segment"]);
    expect(targetsOf(forged, "profile-open-segment")).toEqual(["x"]);
    expect(ids(forged), "the plain loop's region id").toEqual(plainIds);
    expect(forged.regions).toHaveLength(1);
    expectPublishedRegion(
      forged.regions[0]!,
      forgedSketch.sketch.build({
        derivedCurves: forgedSketch.outputs.derivedCurves,
      }),
      forgedSketch,
      "forged tail crossing",
    );

    // Controls: the same line across the drawn shell instead. Dangling, it is
    // pruned and the region keeps its id; spanning the drawn corner, it
    // splits the region in two.
    const dangling = await withLine([x - 0.015, y + 0.019], [x, y - 0.011]);
    expect(codes(dangling)).toEqual(["profile-open-segment"]);
    expect(ids(dangling)).toEqual(plainIds);
    const split = await withLine([x + 0.005, y + 0.019], [x - 0.01, y - 0.011]);
    expect(codes(split)).toEqual([]);
    expect(split.regions).toHaveLength(2);
  }, 120_000);

  test.each(["SL-90 0.01", "SL-90 0.2"])(
    "%s outputs alone: an open trimmed chain is open on every shell sub-span, the trimmed one included (its tail is pruned)",
    async (label) => {
      const row = nativeChainRow(label);
      const offset = offsetSketch(row.publication);
      const result = await deriveOffset(offset);
      expect(result.regions, label).toEqual([]);
      expect(codes(result), label).toEqual(["profile-open-segment"]);
      const opens = result.diagnostics.map((d) => d.message);
      const spans = offset.outputs.derivedCurves.flatMap((shell) =>
        shell.spans.map((span, index) => ({
          key: `span ${span.outputSpanId} sub-span ${span.subIndex}.`,
          trimmed:
            (index === 0 && span.queryDomain[0] !== span.sourceDomain[0]) ||
            (index === shell.spans.length - 1 &&
              span.queryDomain[1] !== span.sourceDomain[1]),
        })),
      );
      expect(
        spans.some((span) => span.trimmed),
        `${label} has a trimmed sub-span`,
      ).toBe(true);
      for (const span of spans)
        expect(
          opens.some((message) => message.includes(span.key)),
          `${label} ${span.key} (trimmed: ${span.trimmed}) is reported open`,
        ).toBe(true);
    },
    120_000,
  );

  test.each(["wrap-flat4 0.01", "wrap-flat4 -0.01"])(
    "%s: one closed shell whose two ends are one driven point (no joint arc, no trim) gives one closed region, its area checked against an independent oracle",
    async (label) => {
      // The native self-trimmed wraps (wrap-near4(s) 1e-3 0.01) are not
      // certified (derived-offset-topology-uncertain), so no native row has a
      // closed shell trimmed on itself; this is the closed single-shell row.
      const row = nativeChainRow(label, "positional wrap");
      expect(row.publication.frame.trims, label).toEqual([]);
      const offset = offsetSketch(row.publication);
      const [shell, ...others] = offset.outputs.derivedCurves;
      expect(others, label).toEqual([]);
      expect(shell!.startPointId, label).toBe(shell!.endPointId);
      const result = await deriveOffset(offset);
      expect(codes(result), label).toEqual([]);
      expect(result.regions, label).toHaveLength(1);
      expectPublishedRegion(
        result.regions[0]!,
        offset.sketch.build({ derivedCurves: offset.outputs.derivedCurves }),
        offset,
        label,
      );
    },
    120_000,
  );

  test("a publication that is not a terminal-sub-span trim is no derived-curve input: it fails closed (fabricated)", async () => {
    const row = nativeChainRow("SL-90 0.01");
    const variants: [
      string,
      (shell: SketchArrangementDerivedCurve) => SketchArrangementDerivedCurve,
    ][] = [
      [
        "a trim inside a non-terminal sub-span",
        (shell) => ({
          ...shell,
          spans: shell.spans.map((span, index) =>
            index === 0
              ? {
                  ...span,
                  queryDomain: [
                    span.queryDomain[0],
                    (span.sourceDomain[0] + span.sourceDomain[1]) / 2,
                  ] as const,
                }
              : span,
          ),
        }),
      ],
      [
        "a repeated sub-index",
        (shell) => ({
          ...shell,
          spans: shell.spans.map((span) => ({
            ...span,
            outputSpanId: "one",
            subIndex: 0,
          })),
        }),
      ],
    ];
    for (const [label, edit] of variants) {
      const offset = offsetSketch(row.publication, "lines");
      const result = await derive(offset.sketch, {
        derivedCurves: offset.outputs.derivedCurves.map(edit),
      });
      expect(result.regions, label).toEqual([]);
      expect(targetsOf(result, "region-degenerate-curve"), label).toContain(
        "off_p0",
      );
    }
  }, 120_000);

  test("a derived curve whose id names ordinary sketch geometry fails closed without throwing (fabricated)", async () => {
    const row = nativeChainRow("SL-90 0.01");
    const variants: [
      string,
      (shell: SketchArrangementDerivedCurve) => SketchArrangementDerivedCurve,
    ][] = [
      [
        "its branch keys collide: the close0 line's id and every outputSpanId 'whole'",
        (shell) => ({
          ...shell,
          outputEntityId: "sketch_entity_close0" as SketchEntityId,
          spans: shell.spans.map((span, index) => ({
            ...span,
            outputSpanId: "whole",
            subIndex: index,
          })),
        }),
      ],
      [
        "only its entity id collides: the close0 line's id, span ids kept",
        (shell) => ({
          ...shell,
          outputEntityId: "sketch_entity_close0" as SketchEntityId,
        }),
      ],
    ];
    for (const [label, edit] of variants) {
      const offset = offsetSketch(row.publication, "lines");
      const result = await derive(offset.sketch, {
        derivedCurves: offset.outputs.derivedCurves.map(edit),
      });
      expect(result.regions, label).toEqual([]);
      expect(codes(result), label).toEqual(["region-degenerate-curve"]);
      // The shell's obstacle blocks the lines' component too.
      expect(targetsOf(result, "region-degenerate-curve"), label).toContain(
        "close0",
      );
      expect(
        result.diagnostics.some((d) =>
          d.message.includes(
            "a derived curve id that names ordinary sketch geometry",
          ),
        ),
        label,
      ).toBe(true);
    }
  }, 120_000);
});

// ---------------------------------------------------------------------------
// T08b-g3b: single-entry clearance for short trimmed tails (dark)
// ---------------------------------------------------------------------------

describe("T08b-g3b single-entry clearance for short trimmed tails", () => {
  const ballRadius = FIXTURE_TOLERANCE / 2;

  test.each(["C φ=0.200 0.01", "C φ=0.100 0.01", "C φ=0.050 0.01"])(
    "S2 %s closed by a line: the φ=0.2 shape, its region areas checked against the published loop",
    async (label) => {
      const row = nativeChainRow(label, "S2");
      const offset = offsetSketch(row.publication, "line");
      const shells = offset.outputs.derivedCurves;
      // The row's premise (T08b-g3 R-g1), measured on the tail ends against
      // the τ/2 box around the trim: at φ = 0.2 both tails end outside it
      // (the T09 rule), at φ = 0.05 both inside, and at φ = 0.1 the first
      // shell's inside (0.995ρ) and the second's just outside (1.0015ρ).
      const trim = row.publication.frame.trims[0]!.position;
      const tailEnds = shells.flatMap((shell) =>
        shell.spans.flatMap((span, index) => [
          ...(index === 0 && span.queryDomain[0] !== span.sourceDomain[0]
            ? [span.poles[0]]
            : []),
          ...(index === shell.spans.length - 1 &&
          span.queryDomain[1] !== span.sourceDomain[1]
            ? [span.poles[3]]
            : []),
        ]),
      );
      expect(tailEnds, label).toHaveLength(2);
      const inBox = tailEnds.map(
        (end) =>
          Math.max(Math.abs(end[0] - trim[0]), Math.abs(end[1] - trim[1])) <
          ballRadius,
      );
      expect(inBox, label).toEqual(
        {
          "C φ=0.200 0.01": [false, false],
          "C φ=0.100 0.01": [true, false],
          "C φ=0.050 0.01": [true, true],
        }[label],
      );

      const result = await deriveOffset(offset);
      expect(codes(result), label).toEqual([]);
      // The φ = 0.2 shape: the closing line crosses the chain once, so two
      // cells: one bounded by the line and both shells, and one lobe bounded
      // by the line and one shell.
      const shape = result.regions
        .map((region) => ({
          roles: region.loops.map((loop) => loop.role),
          segments: region.loops[0]!.segments.length,
          entities: boundaryEntities(region),
        }))
        .sort((l, r) => l.segments - r.segments);
      expect(
        shape.map((cell) => [cell.roles, cell.segments]),
        label,
      ).toEqual([
        [["outer"], 3],
        [["outer"], 4],
      ]);
      expect(shape[1]!.entities, label).toEqual(["close", "off_p0", "off_p1"]);
      expect(shape[0]!.entities, label).toHaveLength(2);
      expect(shape[0]!.entities, label).toContain("close");

      // Areas: each region's own loop through the independent quadrature
      // oracle; the published loop's signed area is their sum weighted by
      // winding, +1 for the cell that runs the closing line forward (the
      // line's other side is outside both cells).
      const input = offset.sketch.build({ derivedCurves: shells });
      const published = closedCurvesSignedArea([
        ...publishedOracleCurves(offset.outputs.pieces),
        ...offset.closing,
      ]);
      let weighted = 0;
      for (const region of result.regions) {
        const loop = region.loops[0]!;
        const area = closedCurvesSignedArea(regionLoopCurves(loop, input));
        expect(area, `${label}: counter-clockwise outer loop`).toBeGreaterThan(
          0,
        );
        const closing = loop.segments.filter(
          (segment) => entityOf(segment) === "close",
        );
        expect(closing, label).toHaveLength(1);
        weighted += closing[0]!.traversalDirection === "forward" ? area : -area;
      }
      expect(
        Math.abs(weighted - published),
        `${label}: winding-weighted region areas ${weighted} = published loop area ${published}`,
      ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(published)));

      // No region runs on a tail, and each trim is a region vertex bitwise.
      for (const shell of shells)
        shell.spans.forEach((span, index) => {
          const intervals = result.regions.flatMap((region) =>
            region.loops[0]!.segments.filter(
              (segment) =>
                segment.branch.source.kind === "entity" &&
                segment.branch.source.entityId === shell.outputEntityId &&
                segment.branch.spanId === span.outputSpanId &&
                span.sourceDomain[0] <= segment.sourceParameterInterval[0] &&
                segment.sourceParameterInterval[1] <= span.sourceDomain[1],
            ),
          );
          const where = `${label}: ${shell.outputEntityId} sub-span ${index}`;
          for (const segment of intervals) {
            const [lo, hi] = segment.sourceParameterInterval;
            expect(
              span.queryDomain[0] <= lo && hi <= span.queryDomain[1],
              `${where} lies in the published domain`,
            ).toBe(true);
          }
          for (const side of [0, 1] as const)
            if (span.queryDomain[side] !== span.sourceDomain[side])
              expect(
                intervals.some((segment) =>
                  Object.is(
                    segment.sourceParameterInterval[side],
                    span.queryDomain[side],
                  ),
                ),
                `${where} ends bitwise at its trim`,
              ).toBe(true);
        });
    },
    120_000,
  );

  /*
   * Fabricated arrangement inputs (not produced by the offset owner): one
   * derived shell of one sub-span, trimmed at its start at `q0`. Its trim
   * point T = shell(q0) (bitwise the owner's evaluation, so the join ball is
   * centred on T) starts a line L of length 20ρ along `direction`; the
   * shell's end point E has no other geometry. Poles are given in units of
   * ρ = τ/2 around (3, 2).
   */
  const unitPoles = (unit: readonly (readonly [number, number])[]) =>
    unit.map(([x, y]) => [
      3 + ballRadius * x,
      2 + ballRadius * y,
    ]) as unknown as SplinePoles;
  const onShell = (poles: SplinePoles, parameter: number) =>
    evaluateNeutralCurve(
      {
        kind: "cubicBezier",
        curveId: "fabricated",
        provenance: { sourceEntityId: "fabricated", sourceSpanId: "s" },
        poles,
        sourceDomain: [0, 1],
      },
      parameter,
    );
  const deriveTail = (
    poles: SplinePoles,
    q0: number,
    direction: readonly [number, number],
    rho = ballRadius,
  ) => {
    const sketch = makeSketchFixture();
    const join = onShell(poles, q0);
    const length = Math.hypot(direction[0], direction[1]);
    sketch.point("T", join[0], join[1]);
    sketch.point(
      "F",
      join[0] + (20 * rho * direction[0]) / length,
      join[1] + (20 * rho * direction[1]) / length,
    );
    sketch.point("E", poles[3][0], poles[3][1]);
    sketch.line("L", "T", "F");
    return derive(sketch, {
      modelingTolerance: 2 * rho,
      derivedCurves: [
        {
          outputEntityId: "sketch_entity_shell" as SketchEntityId,
          startPointId: "sketch_point_T" as SketchPointId,
          endPointId: "sketch_point_E" as SketchPointId,
          spans: [
            {
              outputSpanId: "s",
              subIndex: 0,
              poles,
              sourceDomain: [0, 1],
              queryDomain: [q0, 1],
            },
          ],
        },
      ],
    });
  };
  const notEnteredOnce = (result: SketchArrangementResult) => {
    expect(result.regions).toEqual([]);
    expect(codes(result)).toContain("region-join-uncertain");
    expect(targetsOf(result, "region-join-uncertain")).toEqual(["L", "shell"]);
    expect(
      result.diagnostics.find((d) => d.code === "region-join-uncertain")!
        .message,
    ).toContain("entered once by entity sketch_entity_shell");
  };
  // Its tail runs from P0 (inside the box) to T, and its kept part leaves
  // the box once.
  const hook = unitPoles([
    [0, 0],
    [0.2, 2],
    [-1.6, -3.5],
    [-3, -0.5],
  ]);

  test("a tail inside the join box whose kept part leaves it once is entered once (fabricated control)", async () => {
    // L points away from the tail: nothing else meets the box.
    const result = await deriveTail(hook, 0.48, [-1, 1]);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["profile-open-segment"]);
    expect(targetsOf(result, "profile-open-segment")).toEqual(["L", "shell"]);
  }, 60_000);

  test("a tail that leaves and re-enters the join box fails closed (fabricated, two box crossings)", async () => {
    // P0 is inside the box; the tail leaves it through the top and comes
    // back before T, then the kept part leaves once: three crossings.
    const poles = unitPoles([
      [0.5, 0.5],
      [1, 5],
      [-1.5, 3],
      [-0.5, -25],
    ]);
    notEnteredOnce(await deriveTail(poles, 0.45, [-1, 1]));
  }, 60_000);

  test("a tail whose kept end is inside the join box fails closed (fabricated, tail end one ulp outside the box)", async () => {
    // The kept part ends at E inside the box, and the tail starts one ulp
    // beyond the box's right side x = nextUp(T.x + ρ), so the certified
    // point test cannot prove it outside, and the tail crosses into the box
    // once. P0.x is iterated to that fixed point (T moves with P0).
    let poles = unitPoles([
      [1, 0.3],
      [0.3, 0.4],
      [-0.3, 0.1],
      [-0.6, -0.3],
    ]);
    const q0 = 0.53;
    for (let step = 0; step < 40; step += 1) {
      const target = nextUp(nextUp(onShell(poles, q0)[0] + ballRadius));
      if (poles[0][0] === target) break;
      poles = [[target, poles[0][1]], poles[1], poles[2], poles[3]];
    }
    const join = onShell(poles, q0);
    expect(poles[0][0]).toBe(nextUp(nextUp(join[0] + ballRadius)));
    const kept = poles[3].map(
      (value, axis) => (value - join[axis]!) / ballRadius,
    );
    expect(Math.max(...kept.map(Math.abs))).toBeLessThan(0.99);
    notEnteredOnce(await deriveTail(poles, q0, [0, -1]));
  }, 60_000);

  test("a tail contact with the join partner, in the join box outside the ball, is not an arrangement event: the drawn V is open (fabricated; [TECH] G14′, D2 re-pin)", async () => {
    // L runs from T along (1, 1) and the tail crosses it at X with
    // ρ < |X − T| and X inside the box (checked on the oracle below).
    const q0 = 0.48;
    const join = onShell(hook, q0);
    const tail = cubicOracle(hook, [0, 1], 0, q0);
    const side = (t: number) => {
      const [x, y] = tail.point(t);
      return y - join[1] - (x - join[0]);
    };
    let [lo, hi] = [0, 0.2];
    expect(Math.sign(side(lo))).toBe(-Math.sign(side(hi)));
    for (let step = 0; step < 60; step += 1) {
      const mid = (lo + hi) / 2;
      if (Math.sign(side(mid)) === Math.sign(side(lo))) lo = mid;
      else hi = mid;
    }
    const contact = tail.point(lo);
    const offset = [contact[0] - join[0], contact[1] - join[1]];
    expect(Math.hypot(offset[0]!, offset[1]!)).toBeGreaterThan(
      1.1 * ballRadius,
    );
    expect(Math.max(...offset.map(Math.abs))).toBeLessThan(0.95 * ballRadius);
    // The partner L's contact X lies on the tail (≥ 1.1ρ from T), so it is
    // not a contact of the drawn geometry: drawn shell and L meet only at T,
    // an open V. The tail lies in the contracted box (g3b), so dropping X is
    // sound (design L1–L4).
    const result = await deriveTail(hook, q0, [1, 1]);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["profile-open-segment"]);
    expect(targetsOf(result, "profile-open-segment")).toEqual(["L", "shell"]);
  }, 60_000);

  test("an ordinary interior membership whose free end is inside the join box still fails closed (the T09 rule, unchanged)", async () => {
    // A line starts on an authored spline 3e-4 from the spline's start: the
    // spline's free end lies in the join box. Only derived trimmed tails
    // take the one-crossing rule.
    const sketch = makeSketchFixture();
    sketch.point("a", 0, 0);
    sketch.point("b", 1, 0.5);
    sketch.point("c", 2, 0);
    sketch.spline("S", ["a", "b", "c"], "open");
    const spline = sketch
      .build()
      .solvedSnapshot.solvedEntities.find(
        (entity) => entity.entityId === "sketch_entity_S",
      )!;
    if (spline.kind !== "spline") throw new Error("no spline");
    const span = spline.reconstruction.spans[0]!;
    const speed = Math.hypot(
      span.poles[1][0] - span.poles[0][0],
      span.poles[1][1] - span.poles[0][1],
    );
    const [s0, s1] = span.interval;
    const at = evaluateNeutralCurve(
      {
        kind: "cubicBezier",
        curveId: "S",
        provenance: { sourceEntityId: "S", sourceSpanId: "0" },
        poles: span.poles,
        sourceDomain: span.interval,
      },
      s0 + ((s1 - s0) * 3e-4) / (3 * speed),
    );
    expect(Math.max(Math.abs(at[0]), Math.abs(at[1]))).toBeLessThan(
      0.8 * ballRadius,
    );
    sketch.point("p", at[0], at[1]);
    sketch.point("q", at[0] - 0.5, at[1] + 1);
    sketch.line("M", "p", "q");
    sketch.pointOnCurve("p", "S");
    const result = await derive(sketch);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toContain("region-join-uncertain");
    expect(targetsOf(result, "region-join-uncertain")).toEqual(["M", "S"]);
    expect(
      result.diagnostics.find((d) => d.code === "region-join-uncertain")!
        .message,
    ).toContain("entered once by entity sketch_entity_S");
  }, 60_000);

  /*
   * Exact box-side constructions (T08b-g3b review, advisory 2; fabricated,
   * not owner-reachable). The join box is centred on T = shell(q0), so its
   * right side is nextUp(fl(T.x + ρ)). Choosing ρ = nextDown(X) − T.x
   * (exact by Sterbenz) makes that side bitwise the X = 3 the poles are
   * built around, in units u = 2⁻¹² (so the pole offsets are exact).
   */
  const u = 2 ** -12;
  const exactRightSide = (
    unit: readonly (readonly [number, number])[],
    q0: number,
  ) => {
    const X = 3;
    const poles = unit.map(([x, y]) => [
      X + x * u,
      2.5 + y * u,
    ]) as unknown as SplinePoles;
    const join = onShell(poles, q0);
    const rho = nextDown(X) - join[0];
    expect(nextUp(join[0] + rho), "the box's right side is exactly X").toBe(X);
    return { poles, rho };
  };

  test("a tail tangent to its join box from inside fails closed (fabricated, not owner-reachable)", async () => {
    // x(t) − X = −48u (t − 1/4)² exactly: the tail touches the box's right
    // side at t = 1/4 from inside (a tangent contact, not a crossing), and
    // the kept part leaves the box once.
    const { poles, rho } = exactRightSide(
      [
        [-3, -2],
        [5, -1],
        [-3, 0],
        [-27, 1],
      ],
      0.5,
    );
    const result = await deriveTail(poles, 0.5, [0, 1], rho);
    expect(codes(result)).toEqual([
      "profile-open-segment",
      "region-join-uncertain",
    ]);
    notEnteredOnce(result);
  }, 60_000);

  test("a tail ending exactly on its join box fails closed (fabricated, not owner-reachable)", async () => {
    // x(t) = X − 9u t exactly: the tail end x(0) = X lies on the box's right
    // side (an endpoint contact), and the kept part leaves the box once.
    const { poles, rho } = exactRightSide(
      [
        [0, -1],
        [-3, 0],
        [-6, 0],
        [-9, 1],
      ],
      1 / 3,
    );
    const result = await deriveTail(poles, 1 / 3, [0, 1], rho);
    expect(codes(result)).toEqual([
      "profile-open-segment",
      "region-join-uncertain",
    ]);
    notEnteredOnce(result);
  }, 60_000);

  test("a straight tail whose kept part leaves through a side's interior is entered once (fabricated, not owner-reachable; control for the exact-side rows)", async () => {
    const poles = [
      [-2, -1],
      [-1, -0.5],
      [0, 0],
      [1, 0.5],
    ].map(([x, y]) => [3 + x! * u, 2.5 + y! * u]) as unknown as SplinePoles;
    const result = await deriveTail(poles, 1 / 4, [-1, 1], 1.25 * u);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["profile-open-segment"]);
    expect(targetsOf(result, "profile-open-segment")).toEqual(["L", "shell"]);
  }, 60_000);

  const maxOffset = (
    point: readonly [number, number],
    center: readonly [number, number],
  ) => Math.max(Math.abs(point[0] - center[0]), Math.abs(point[1] - center[1]));

  test("a sub-span trimmed at both ends, tails in overlapping join boxes of distinct classes, publishes the exact loop (fabricated, not owner-reachable)", async () => {
    // T08b-g3b review, advisory 1: trims at 0.2 and 0.8 driven by distinct
    // points T0 and T1. Each tail ends inside its own trim's box, the two
    // boxes overlap, and two lines close the kept arch at F. Each vertex
    // takes the one-crossing rule on its own.
    const poles = unitPoles([
      [-1.2, -0.3],
      [-0.5, 0.6],
      [0.5, 0.6],
      [1.2, -0.3],
    ]);
    const q: [number, number] = [0.2, 0.8];
    const T0 = onShell(poles, q[0]) as SplineVector;
    const T1 = onShell(poles, q[1]) as SplineVector;
    const F: SplineVector = [3, 3];
    expect(maxOffset(poles[0], T0), "start tail ends in its box").toBeLessThan(
      ballRadius,
    );
    expect(maxOffset(poles[3], T1), "end tail ends in its box").toBeLessThan(
      ballRadius,
    );
    expect(maxOffset(T0, T1), "the two join boxes overlap").toBeLessThan(
      2 * ballRadius,
    );
    const sketch = makeSketchFixture();
    sketch.point("T0", T0[0], T0[1]);
    sketch.point("T1", T1[0], T1[1]);
    sketch.point("F", F[0], F[1]);
    sketch.line("L0", "T0", "F");
    sketch.line("L1", "T1", "F");
    const options = {
      derivedCurves: [
        {
          outputEntityId: "sketch_entity_shell" as SketchEntityId,
          startPointId: "sketch_point_T0" as SketchPointId,
          endPointId: "sketch_point_T1" as SketchPointId,
          spans: [
            {
              outputSpanId: "s",
              subIndex: 0,
              poles,
              sourceDomain: [0, 1] as [number, number],
              queryDomain: q,
            },
          ],
        },
      ],
    };
    const result = await derive(sketch, options);
    expect(codes(result)).toEqual([]);
    expect(result.regions).toHaveLength(1);
    const region = result.regions[0]!;
    expect(region.loops.map((loop) => loop.role)).toEqual(["outer"]);
    const loop = region.loops[0]!;
    expect(cyclicFrom(loop.segments.map(entityOf), "shell")).toEqual([
      "shell",
      "L1",
      "L0",
    ]);
    const shell = loop.segments.find(
      (segment) => entityOf(segment) === "shell",
    )!;
    expect(shell.traversalDirection).toBe("forward");
    expect(
      Object.is(shell.sourceParameterInterval[0], q[0]) &&
        Object.is(shell.sourceParameterInterval[1], q[1]),
      `the shell segment ${shell.sourceParameterInterval} is bitwise the published domain`,
    ).toBe(true);
    const area = closedCurvesSignedArea(
      regionLoopCurves(loop, sketch.build(options)),
    );
    const oracle = closedCurvesSignedArea([
      cubicOracle(poles, [0, 1], q[0], q[1]),
      lineOracle(T1, F),
      lineOracle(F, T0),
    ]);
    expect(oracle).toBeGreaterThan(0);
    expect(
      Math.abs(area - oracle),
      `region loop area ${area} = oracle loop area ${oracle}`,
    ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(oracle)));
  }, 120_000);

  /*
   * A sub-span trimmed at both ends by one point T (a self-loop): both trim
   * memberships are one occurrence, so the G14 guard (which needs the trim
   * to be both the first and the last of at least two occurrences) blocks
   * it before clearance. Both tails end 0.3ρ from T.
   */
  const deriveSelfLoop = (withLine: boolean) => {
    const poles = unitPoles([
      [-0.3, 0],
      [40, 40],
      [-40, 40],
      [0.3, 0],
    ]);
    // The self crossing x = 3 on t < 1/4 by bisection; its partner is 1 − t.
    const x = (t: number) => onShell(poles, t)[0] - 3;
    let [lo, hi] = [0, 0.25];
    for (let step = 0; step < 80; step += 1) {
      const mid = (lo + hi) / 2;
      if (Math.sign(x(mid)) === Math.sign(x(lo))) lo = mid;
      else hi = mid;
    }
    const join = onShell(poles, lo);
    expect(maxOffset(poles[0], join)).toBeLessThan(ballRadius);
    expect(maxOffset(poles[3], join)).toBeLessThan(ballRadius);
    const sketch = makeSketchFixture();
    sketch.point("T", join[0], join[1]);
    if (withLine) {
      sketch.point("F", join[0], join[1] - 20 * ballRadius);
      sketch.line("L", "T", "F");
    }
    return derive(sketch, {
      derivedCurves: [
        {
          outputEntityId: "sketch_entity_shell" as SketchEntityId,
          startPointId: "sketch_point_T" as SketchPointId,
          endPointId: "sketch_point_T" as SketchPointId,
          spans: [
            {
              outputSpanId: "s",
              subIndex: 0,
              poles,
              sourceDomain: [0, 1],
              queryDomain: [lo, 1 - lo],
            },
          ],
        },
      ],
    });
  };

  test("a sub-span trimmed at both ends by one point is blocked by the G14 guard (fabricated, not owner-reachable)", async () => {
    const result = await deriveSelfLoop(false);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["region-derived-tail-crossing"]);
    expect(targetsOf(result, "region-derived-tail-crossing")).toEqual([
      "shell",
    ]);
  }, 60_000);

  test("a sub-span trimmed at both ends by one point that also starts a line fails closed before clearance (fabricated, not owner-reachable)", async () => {
    // The line's contacts at T cannot be ordered against the shell's own
    // occurrences, so the component is blocked by the vertex order check
    // that runs just before the G14 guard.
    const result = await deriveSelfLoop(true);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["region-vertex-order-uncertain"]);
    expect(targetsOf(result, "region-vertex-order-uncertain")).toEqual([
      "L",
      "shell",
    ]);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// T08b-g5c ([TECH] G14′): point contacts certified on a trimmed-off derived
// tail are not arrangement events; joins, overlaps and contacts reaching the
// trim are kept (G14 backstop); the nesting ray uses drawn contacts (D3).
// ---------------------------------------------------------------------------

describe("T08b-g5c contacts on undrawn tails are not region events", () => {
  /** The source chain of a native row, added to an offset sketch as `src_<k>` (points `src<k>`). */
  function addSource(
    row: OffsetRow,
    offset: OffsetSketch,
    tangents: "authored" | "automatic" = "authored",
  ) {
    const names = new Map(
      row.pair.definition.points.map((point, index) => [
        point.pointId,
        `src${index}`,
      ]),
    );
    const name = (pointId: SketchPointId) => names.get(pointId)!;
    for (const point of row.pair.definition.points)
      offset.sketch.point(name(point.pointId), ...point.position);
    row.pair.definition.entities.forEach((entity, index) => {
      if (entity.kind === "lineSegment")
        offset.sketch.line(
          `src_${index}`,
          name(entity.startPointId),
          name(entity.endPointId),
        );
      else if (entity.kind === "spline")
        // Authored tangents included: the source is the row's own spline.
        offset.sketch.spline(
          `src_${index}`,
          entity.pointOccurrences.map((occurrence) => name(occurrence.pointId)),
          entity.closure,
          entity.pointOccurrences.map((occurrence) =>
            occurrence.tangent.kind === "authored" && tangents === "authored"
              ? (occurrence.tangent.vector as [number, number])
              : (undefined as never),
          ),
        );
      else throw new Error(`unexpected source ${entity.kind}`);
    });
    for (const constraint of row.pair.definition.constraints)
      if (constraint.kind === "coincident")
        offset.sketch.coincident(
          name(constraint.pointIds[0]),
          name(constraint.pointIds[1]),
        );
    return name;
  }

  /** The source chain's two ends (frame traversal order). */
  function sourceEnds(row: OffsetRow, name: (id: SketchPointId) => string) {
    const curves = sourceLoopCurves(row);
    const start = curves[0]!.point(curves[0]!.from);
    const end = curves.at(-1)!.point(curves.at(-1)!.to);
    const at = (position: SplineVector) =>
      name(
        row.pair.definition.points.find(
          (point) =>
            Math.hypot(
              point.position[0] - position[0],
              point.position[1] - position[1],
            ) < 1e-12,
        )!.pointId,
      );
    return { start, end, startName: at(start), endName: at(end) };
  }

  /** The derivation with every verified join witness's realization recorded. */
  async function deriveWithJoins(offset: OffsetSketch) {
    const realizations: string[] = [];
    const recording: NeutralCurveQueryCapability = {
      ...capability,
      queryNeutralCurveJoin: async (request) => {
        const answer = await capability.queryNeutralCurveJoin(request);
        if (answer.kind === "verified")
          realizations.push(...answer.joins.map((join) => join.realization));
        return answer;
      },
    };
    const result = await createSketchArrangementDeriver(recording).derive(
      offset.sketch.build({ derivedCurves: offset.outputs.derivedCurves }),
    );
    return { result, realizations };
  }

  /**
   * Review R1: every shell segment of every region lies in its sub-span's
   * `queryDomain` and a trimmed end ends bitwise at its trim, asserted with
   * its premise: every declared join was realized `declaredEnds` (a join
   * realized at a nearby unique contact may end inside the trim's ball).
   */
  function expectDrawnShellSegments(
    result: SketchArrangementResult,
    realizations: readonly string[],
    offset: OffsetSketch,
    label: string,
  ) {
    expect(
      new Set(realizations),
      `${label}: premise, every join is realized declaredEnds`,
    ).toEqual(new Set(["declaredEnds"]));
    for (const shell of offset.outputs.derivedCurves)
      shell.spans.forEach((span, index) => {
        const segments = result.regions.flatMap((region) =>
          region.loops.flatMap((loop) =>
            loop.segments.filter(
              (segment) =>
                segment.branch.source.kind === "entity" &&
                segment.branch.source.entityId === shell.outputEntityId &&
                segment.branch.spanId === span.outputSpanId &&
                span.sourceDomain[0] <= segment.sourceParameterInterval[0] &&
                segment.sourceParameterInterval[1] <= span.sourceDomain[1],
            ),
          ),
        );
        const where = `${label}: ${shell.outputEntityId} sub-span ${index}`;
        for (const segment of segments) {
          const [lo, hi] = segment.sourceParameterInterval;
          expect(
            span.queryDomain[0] <= lo && hi <= span.queryDomain[1],
            `${where} [${lo}, ${hi}] lies in the published domain`,
          ).toBe(true);
        }
        if (segments.length === 0) return;
        for (const side of [0, 1] as const)
          if (span.queryDomain[side] !== span.sourceDomain[side])
            expect(
              segments.some((segment) =>
                Object.is(
                  segment.sourceParameterInterval[side],
                  span.queryDomain[side],
                ),
              ),
              `${where} ends bitwise at its trim`,
            ).toBe(true);
      });
  }

  const loopArea = (region: RegionRecord, offset: OffsetSketch, loop = 0) =>
    closedCurvesSignedArea(
      regionLoopCurves(
        region.loops[loop]!,
        offset.sketch.build({ derivedCurves: offset.outputs.derivedCurves }),
      ),
    );
  const reversed = (curves: OracleCurve[]) =>
    [...curves]
      .reverse()
      .map((curve) => ({ ...curve, from: curve.to, to: curve.from }));
  const expectArea = (actual: number, oracle: number, label: string) =>
    expect(
      Math.abs(actual - oracle),
      `${label}: area ${actual} = oracle ${oracle}`,
    ).toBeLessThanOrEqual(1e-9 * Math.max(1, Math.abs(oracle)));
  /** The band's oracle loop: published offset, a line to the source end, the source back, a line home. */
  const bandOracle = (
    row: OffsetRow,
    offset: OffsetSketch,
    ends: ReturnType<typeof sourceEnds>,
  ) => {
    const published = publishedOracleCurves(offset.outputs.pieces);
    const offStart = published[0]!.point(published[0]!.from);
    const offEnd = published.at(-1)!.point(published.at(-1)!.to);
    return Math.abs(
      closedCurvesSignedArea([
        ...published,
        lineOracle(offEnd, ends.end),
        ...reversed(sourceLoopCurves(row)),
        lineOracle(ends.start, offStart),
      ]),
    );
  };
  const addBand = (
    offset: OffsetSketch,
    ends: ReturnType<typeof sourceEnds>,
  ) => {
    offset.sketch.line("band0", offset.outputs.start!, ends.startName);
    offset.sketch.line("band1", offset.outputs.end!, ends.endName);
  };

  test("SL-loop -0.01 with its source outline: an annulus (outer = source, hole = offset) plus the inner disk, areas by oracle", async () => {
    const row = nativeChainRow("SL-loop -0.01");
    const offset = offsetSketch(row.publication);
    addSource(row, offset);
    const { result, realizations } = await deriveWithJoins(offset);
    expect(codes(result)).toEqual([]);
    expect(result.regions.map((region) => region.loops.length)).toEqual([2, 1]);
    const [annulus, disk] = result.regions as [RegionRecord, RegionRecord];
    const published = Math.abs(
      closedCurvesSignedArea(publishedOracleCurves(offset.outputs.pieces)),
    );
    const source = Math.abs(closedCurvesSignedArea(sourceLoopCurves(row)));
    expect(boundaryEntities(annulus)).toEqual([
      "off_p0",
      "off_p1",
      "src_0",
      "src_1",
    ]);
    expectArea(loopArea(annulus, offset, 0), source, "annulus outer = source");
    expectArea(
      -loopArea(annulus, offset, 1),
      published,
      "annulus hole = offset",
    );
    expectArea(loopArea(disk, offset), published, "disk = offset");
    expect(boundaryEntities(disk)).toEqual(["off_p0", "off_p1"]);
    expectDrawnShellSegments(result, realizations, offset, "SL-loop -0.01");
  }, 300_000);

  test.each(["SL-90 0.01", "SL-90 0.2"])(
    "%s with the source chain present: closed by a line and by two lines the region is the published loop (the source chain is open); joined to the source ends it is one band, area by oracle",
    async (label) => {
      const row = nativeChainRow(label);
      for (const close of ["line", "lines"] as const) {
        const offset = offsetSketch(row.publication, close);
        addSource(row, offset);
        const { result, realizations } = await deriveWithJoins(offset);
        const where = `${label} closed by ${close}`;
        expect(codes(result), where).toEqual(["profile-open-segment"]);
        expect(targetsOf(result, "profile-open-segment"), where).toEqual([
          "src_0",
          "src_1",
        ]);
        expect(result.regions, where).toHaveLength(1);
        expectPublishedRegion(
          result.regions[0]!,
          offset.sketch.build({ derivedCurves: offset.outputs.derivedCurves }),
          offset,
          where,
        );
        expectDrawnShellSegments(result, realizations, offset, where);
        // The same region as the g3 row without the source chain.
        const alone = await deriveOffset(offsetSketch(row.publication, close));
        expect(ids(result), `${where}: the g3 region id`).toEqual(ids(alone));
      }
      const offset = offsetSketch(row.publication);
      const ends = sourceEnds(row, addSource(row, offset));
      addBand(offset, ends);
      const { result, realizations } = await deriveWithJoins(offset);
      const where = `${label} band`;
      expect(codes(result), where).toEqual([]);
      expect(result.regions, where).toHaveLength(1);
      expect(
        result.regions[0]!.loops.map((loop) => loop.role),
        where,
      ).toEqual(["outer"]);
      expect(boundaryEntities(result.regions[0]!), where).toEqual([
        "band0",
        "band1",
        "off_p0",
        "off_p1",
        "src_0",
        "src_1",
      ]);
      expectArea(
        loopArea(result.regions[0]!, offset),
        bandOracle(row, offset, ends),
        where,
      );
      expectDrawnShellSegments(result, realizations, offset, where);
    },
    600_000,
  );

  /** The SL-90 shape with the spline's end tangent authored: the corner's interior angle. */
  function authoredCornerRow(vector: Vector, distance: number): OffsetRow {
    const harness = chainHarnesses.matrix;
    harness.resetSequence();
    const spline = tangentEdit(harness.drawSpline([], ARCH_POINTS), [
      { occurrence: 2, vector },
    ]);
    const [, splineEnd] = harness.splineEnds(spline);
    const pair = harness.solvedPair([
      spline,
      harness.drawLine([spline], [2, 0], [2, 1], { start: splineEnd }),
    ]);
    const seeds = pair.definition.entities.map((entity) => entity.entityId);
    return {
      pair,
      seeds,
      distance,
      publication: certifiedPublication(pair, seeds, distance),
    };
  }

  test.each([
    ["60°", [1, -0.57735], 0.01],
    ["60°", [1, -0.57735], 0.05],
    ["80°", [1, -0.17633], 0.01],
    ["80°", [1, -0.17633], 0.05],
  ] as const)(
    "authored-tangent corner %s, d = %s, with the source chain: closed by two lines it is the published loop; as a band one region, area by oracle",
    async (angle, vector, distance) => {
      const row = authoredCornerRow(vector, distance);
      const label = `${angle} d=${distance}`;
      const lines = offsetSketch(row.publication, "lines");
      addSource(row, lines);
      const closed = await deriveWithJoins(lines);
      expect(codes(closed.result), label).toEqual(["profile-open-segment"]);
      expect(closed.result.regions, label).toHaveLength(1);
      expectPublishedRegion(
        closed.result.regions[0]!,
        lines.sketch.build({ derivedCurves: lines.outputs.derivedCurves }),
        lines,
        label,
      );
      expectDrawnShellSegments(
        closed.result,
        closed.realizations,
        lines,
        label,
      );
      const band = offsetSketch(row.publication);
      const ends = sourceEnds(row, addSource(row, band));
      addBand(band, ends);
      const banded = await deriveWithJoins(band);
      expect(codes(banded.result), `${label} band`).toEqual([]);
      expect(banded.result.regions, `${label} band`).toHaveLength(1);
      expectArea(
        loopArea(banded.result.regions[0]!, band),
        bandOracle(row, band, ends),
        `${label} band`,
      );
      expectDrawnShellSegments(
        banded.result,
        banded.realizations,
        band,
        `${label} band`,
      );
    },
    600_000,
  );

  test.each([0.01, 0.05])(
    "authored-tangent corner exactly 90°, d = %s: the untrimmed tail ends exactly on the source line, and the drawn picture publishes (closed by two lines: the published loop; band: one region, area by oracle)",
    async (distance) => {
      const row = authoredCornerRow([1, 0], distance);
      const label = `90° d=${distance}`;
      const lines = offsetSketch(row.publication, "lines");
      const tailEnds = lines.outputs.derivedCurves.flatMap((shell) => {
        const last = shell.spans.at(-1)!;
        return last.queryDomain[1] !== last.sourceDomain[1]
          ? [last.poles[3]]
          : [];
      });
      expect(tailEnds, `${label}: premise, the end-trimmed tail`).toHaveLength(
        1,
      );
      expect(
        tailEnds[0]![0],
        `${label}: premise, the tail end lies exactly on the source line x = 2`,
      ).toBe(2);
      addSource(row, lines);
      const closed = await deriveWithJoins(lines);
      expect(codes(closed.result), label).toEqual(["profile-open-segment"]);
      expect(closed.result.regions, label).toHaveLength(1);
      expectPublishedRegion(
        closed.result.regions[0]!,
        lines.sketch.build({ derivedCurves: lines.outputs.derivedCurves }),
        lines,
        label,
      );
      expectDrawnShellSegments(
        closed.result,
        closed.realizations,
        lines,
        label,
      );
      const band = offsetSketch(row.publication);
      const ends = sourceEnds(row, addSource(row, band));
      addBand(band, ends);
      const banded = await deriveWithJoins(band);
      expect(codes(banded.result), `${label} band`).toEqual([]);
      expect(banded.result.regions, `${label} band`).toHaveLength(1);
      expectArea(
        loopArea(banded.result.regions[0]!, band),
        bandOracle(row, band, ends),
        `${label} band`,
      );
      expectDrawnShellSegments(
        banded.result,
        banded.realizations,
        band,
        `${label} band`,
      );
    },
    600_000,
  );

  /** Normalizes random native occurrence ids in a message. */
  const normalizedMessages = (
    result: SketchArrangementResult,
    code: string,
  ) => [
    ...new Set(
      result.diagnostics
        .filter((diagnostic) => diagnostic.code === code)
        .map((diagnostic) =>
          diagnostic.message.replace(
            /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
            "<uuid>",
          ),
        ),
    ),
  ];

  test("D7 known limit: LS-90 0.01 with the source chain, closed by two lines, fails closed because close0 passes through the j0 join box (T09 clearance, no longer masked by G14)", async () => {
    const row = nativeChainRow("LS-90 0.01");
    const offset = offsetSketch(row.publication, "lines");
    addSource(row, offset);
    const result = await deriveOffset(offset);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["region-join-uncertain"]);
    expect(targetsOf(result, "region-join-uncertain")).toEqual(D7_LS90_TARGETS);
    expect(normalizedMessages(result, "region-join-uncertain")).toEqual(
      D7_LS90_MESSAGES,
    );
  }, 300_000);

  test("D7 known limit: the 90°, d = 0.05 offset closed by two lines with the design probe's AUTOMATIC-tangent source spline (not the offset's own source) fails closed on an interior knot's join box against that spline (T09 clearance, unrelated to tails)", async () => {
    // With its real (authored-tangent) source the row publishes (above);
    // the T08b-g5c design measured this input, which is the clearance limit.
    const row = authoredCornerRow([1, 0], 0.05);
    const offset = offsetSketch(row.publication, "lines");
    addSource(row, offset, "automatic");
    const result = await deriveOffset(offset);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual([
      "profile-open-segment",
      "region-join-uncertain",
    ]);
    expect(targetsOf(result, "region-join-uncertain")).toEqual(D7_90_TARGETS);
    expect(normalizedMessages(result, "region-join-uncertain")).toEqual(
      D7_90_MESSAGES,
    );
  }, 300_000);

  test("a forged line across the tail and the source line closes no would-be tail cell: the regions are those without it (fabricated)", async () => {
    // SL-90 0.01 with the source chain, closed by lines. The forged line
    // crosses the shell's end tail and the source line src_1 only.
    const row = nativeChainRow("SL-90 0.01");
    const build = (forged: boolean) => {
      const offset = offsetSketch(row.publication, "lines");
      addSource(row, offset);
      if (forged) {
        const shell = offset.outputs.derivedCurves[0]!;
        const last = shell.spans.at(-1)!;
        expect(last.queryDomain[1], "premise: end trim").not.toBe(
          last.sourceDomain[1],
        );
        // A point on the tail halfway between the trim and the tail end.
        const t = (last.queryDomain[1] + last.sourceDomain[1]) / 2;
        const onTail = cubicOracle(last.poles, last.sourceDomain, t, t).point(
          t,
        );
        // Through it, rising to the right, across the source line x = 2.
        const [ux, uy] = [2 / Math.sqrt(5), 1 / Math.sqrt(5)];
        offset.sketch.point(
          "fa",
          onTail[0] - 0.001 * ux,
          onTail[1] - 0.001 * uy,
        );
        offset.sketch.point("fb", onTail[0] + 0.02 * ux, onTail[1] + 0.02 * uy);
        offset.sketch.line("forged", "fa", "fb");
      }
      return offset;
    };
    const without = await deriveOffset(build(false));
    const forgedOffset = build(true);
    const forged = await deriveOffset(forgedOffset);
    // Premise: the forged line meets the tail strictly beyond the trim and
    // the source line, and nothing else.
    const shell = forgedOffset.outputs.derivedCurves[0]!;
    const last = shell.spans.at(-1)!;
    const lineCurve: NeutralCurve = {
      kind: "line",
      form: "endpointSegment",
      curveId: "forged",
      provenance: { sourceEntityId: "forged", sourceSpanId: "whole" },
      start: positionOf(forgedOffset.sketch, "fa"),
      end: positionOf(forgedOffset.sketch, "fb"),
      sourceDomain: [0, 1],
    };
    const tail = await capability.queryNeutralCurves({
      modelingTolerance: FIXTURE_TOLERANCE,
      first: lineCurve,
      second: {
        kind: "cubicBezier",
        curveId: "tail",
        provenance: { sourceEntityId: "tail", sourceSpanId: "s" },
        poles: last.poles,
        sourceDomain: last.sourceDomain,
      },
    });
    if (tail.kind !== "verified") throw new Error("tail query");
    expect(
      tail.points.length,
      "premise: the forged line crosses the tail",
    ).toBe(1);
    expect(
      tail.points[0]!.proof.secondParameterBounds[0],
      "premise: strictly beyond the end trim",
    ).toBeGreaterThan(last.queryDomain[1]);
    expect(codes(forged)).toEqual(codes(without));
    expect(ids(forged)).toEqual(ids(without));
    expect(targetsOf(forged, "profile-open-segment")).toEqual(
      [...targetsOf(without, "profile-open-segment"), "forged"].sort(),
    );
  }, 300_000);

  /*
   * Fabricated single-sub-span shells (not owner-reachable), as the review
   * rows A–G: a shell start-trimmed at q at T = shell(q), with the partner
   * line L from E (the shell's end) to T unless stated otherwise.
   */
  const fabricatedCubic = (poles: SplinePoles): NeutralCurve => ({
    kind: "cubicBezier",
    curveId: "fabricated",
    provenance: { sourceEntityId: "fabricated", sourceSpanId: "s" },
    poles,
    sourceDomain: [0, 1],
  });
  const at = (poles: SplinePoles, t: number) =>
    evaluateNeutralCurve(fabricatedCubic(poles), t) as SplineVector;
  const fabricatedShell = (
    poles: SplinePoles,
    start: string,
    end: string,
    queryDomain: [number, number],
  ) => ({
    derivedCurves: [
      {
        outputEntityId: "sketch_entity_shell" as SketchEntityId,
        startPointId: `sketch_point_${start}` as SketchPointId,
        endPointId: `sketch_point_${end}` as SketchPointId,
        spans: [
          {
            outputSpanId: "s",
            subIndex: 0,
            poles,
            sourceDomain: [0, 1] as [number, number],
            queryDomain,
          },
        ],
      },
    ],
  });
  /** B(1/4) and B(1/2) are exact. */
  const ARCH = [
    [0, 0],
    [0, 3],
    [3, 3],
    [3, 0],
  ] as unknown as SplinePoles;
  const shellSegments = (result: SketchArrangementResult) =>
    result.regions.flatMap((region) =>
      region.loops.flatMap((loop) =>
        loop.segments
          .filter((segment) => entityOf(segment) === "shell")
          .map((segment) => segment.sourceParameterInterval),
      ),
    );
  const fabricatedArea = (
    region: RegionRecord,
    sketch: SketchFixture,
    options: ReturnType<typeof fabricatedShell>,
    loop = 0,
  ) =>
    closedCurvesSignedArea(
      regionLoopCurves(region.loops[loop]!, sketch.build(options)),
    );
  /** A capability whose contacts of `entity` with a cubic report `bounds(trueBounds)` on the cubic. */
  const loosened = (
    isOther: (curve: NeutralCurve) => boolean,
    bounds: (honest: readonly [number, number]) => readonly [number, number],
  ): NeutralCurveQueryCapability => ({
    ...capability,
    queryNeutralCurves: async (request) => {
      const answer = await capability.queryNeutralCurves(request);
      if (answer.kind !== "verified") return answer;
      const cubicSecond =
        isOther(request.first) && request.second.kind === "cubicBezier";
      const cubicFirst =
        isOther(request.second) && request.first.kind === "cubicBezier";
      if (!cubicFirst && !cubicSecond) return answer;
      return {
        ...answer,
        points: answer.points.map((point) => ({
          ...point,
          proof: {
            ...point.proof,
            ...(cubicSecond
              ? {
                  secondParameterBounds: bounds(
                    point.proof.secondParameterBounds,
                  ),
                }
              : {
                  firstParameterBounds: bounds(
                    point.proof.firstParameterBounds,
                  ),
                }),
          },
        })),
      } as typeof answer;
    },
  });
  const entityLine = (name: string) => (curve: NeutralCurve) =>
    curve.kind === "line" &&
    curve.provenance.sourceEntityId === `sketch_entity_${name}`;

  test("row F (review R2, the straddle killer): a real drawn crossing whose valid enclosure is loose enough to reach the trim is kept, so the component fails closed instead of losing a face", async () => {
    const q = 0.25;
    const T = at(ARCH, q);
    const sketch = makeSketchFixture();
    sketch.point("T", T[0], T[1]);
    sketch.point("E", 3, 0);
    sketch.line("L", "E", "T");
    sketch.point("wa", 1.5, 3);
    sketch.point("wb", 1.5, -0.5);
    sketch.line("W", "wa", "wb");
    const options = fabricatedShell(ARCH, "T", "E", [q, 1]);
    const honest = await derive(sketch, options);
    expect(codes(honest)).toEqual([]);
    expect(
      honest.regions.map((region) => fabricatedArea(region, sketch, options)),
      "control: two faces with honest enclosures",
    ).toHaveLength(2);
    const loose = await createSketchArrangementDeriver(
      loosened(entityLine("W"), (honestBounds) => {
        // Premise: the loose enclosure is valid (holds the true parameter
        // 1/2) and reaches q.
        expect(honestBounds[0] <= 0.5 && 0.5 <= honestBounds[1]).toBe(true);
        return [0.2, 0.55];
      }),
    ).derive(sketch.build(options));
    expect(loose.regions).toEqual([]);
    expect(codes(loose)).toEqual(["region-vertex-order-uncertain"]);
    expect(
      loose.diagnostics[0]!.message,
      "the order failure is on the shell's own list",
    ).toContain("two contacts on entity sketch_entity_shell span s sub-span 0");
  }, 120_000);

  test("a tail contact whose valid enclosure ends exactly at the trim parameter is kept (the comparison against q is exact and strict)", async () => {
    // S crosses only the tail, at t ≈ 0.023 < q = 1/4. The capability
    // reports the S × shell enclosure as [honest low, q]: valid (it holds
    // the true parameter) and its upper end is bitwise q, so the contact is
    // not certified strictly before the trim. Kept, it cannot be ordered
    // against the trim membership at q (realized at T, declaredEnds).
    const q = 0.25;
    const T = at(ARCH, q);
    const sketch = makeSketchFixture();
    sketch.point("T", T[0], T[1]);
    sketch.point("E", 3, 0);
    sketch.line("L", "E", "T");
    sketch.point("sa", -0.4, 0.2);
    sketch.point("sb", 0.8, 0.2);
    sketch.line("S", "sa", "sb");
    const options = fabricatedShell(ARCH, "T", "E", [q, 1]);
    const honest = await derive(sketch, options);
    expect(codes(honest), "control: honest, S is dropped and dangles").toEqual([
      "profile-open-segment",
    ]);
    expect(ids(honest)).toHaveLength(1);
    const result = await createSketchArrangementDeriver(
      loosened(entityLine("S"), (bounds) => {
        expect(bounds[1] < q, "premise: honestly strictly on the tail").toBe(
          true,
        );
        return [bounds[0], q];
      }),
    ).derive(sketch.build(options));
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["region-vertex-order-uncertain"]);
    expect(result.diagnostics[0]!.message).toContain(
      "two contacts on entity sketch_entity_shell span s sub-span 0",
    );
  }, 120_000);

  test("a line exactly through the trim point fails closed on the partner line's order (pin; review row B), and one shifted beyond T meets only the tail and is caught by the join clearance (backstop pin)", async () => {
    const q = 0.25;
    const T = at(ARCH, q);
    const v = 2 ** -4;
    const variant = async (step: number) => {
      const dx = 3 - T[0];
      const dy = -T[1];
      const length = Math.hypot(dx, dy);
      const sketch = makeSketchFixture();
      sketch.point("T", T[0], T[1]);
      sketch.point("E", 3, 0);
      sketch.line("L", "E", "T");
      sketch.point(
        "ma",
        T[0] - v - (step * dx) / length,
        T[1] + v - (step * dy) / length,
      );
      sketch.point(
        "mb",
        T[0] + v - (step * dx) / length,
        T[1] - v - (step * dy) / length,
      );
      sketch.line("M", "ma", "mb");
      return derive(sketch, fabricatedShell(ARCH, "T", "E", [q, 1]));
    };
    const exactly = await variant(0);
    expect(exactly.regions).toEqual([]);
    expect(codes(exactly)).toEqual(["region-vertex-order-uncertain"]);
    expect(exactly.diagnostics[0]!.message).toContain(
      "two contacts on entity sketch_entity_L cannot be ordered",
    );
    for (const step of [1e-15, 1e-12, 1e-9]) {
      const shifted = await variant(step);
      expect(shifted.regions, `shifted ${step}`).toEqual([]);
      expect(codes(shifted), `shifted ${step}`).toEqual([
        "profile-open-segment",
        "region-join-uncertain",
      ]);
      expect(
        targetsOf(shifted, "region-join-uncertain"),
        `shifted ${step}`,
      ).toEqual(["L", "M", "shell"]);
    }
  }, 120_000);

  test("a self contact of the start tail with the drawn part (s < q < t) is dropped: the drawn loop publishes, area by oracle (review row A)", async () => {
    const poles = [
      [0, 0],
      [6, 4],
      [-2, 4],
      [4, 0],
    ] as unknown as SplinePoles;
    // y(t) = 12t(1 − t) is symmetric: the self crossing is (s, 1 − s).
    const f = (s: number) => at(poles, s)[0] - at(poles, 1 - s)[0];
    let [lo, hi] = [0.1, 0.25];
    for (let k = 0; k < 80; k += 1) {
      const mid = (lo + hi) / 2;
      if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid;
      else hi = mid;
    }
    const q = (lo + 0.5) / 2;
    const T = at(poles, q);
    const self = await capability.queryNeutralCurveSelfIntersections({
      modelingTolerance: FIXTURE_TOLERANCE,
      curve: fabricatedCubic(poles),
    });
    if (self.kind !== "verified") throw new Error("self query");
    expect(self.points, "premise: one self crossing").toHaveLength(1);
    const [s, t] = [
      self.points[0]!.proof.firstParameterBounds,
      self.points[0]!.proof.secondParameterBounds,
    ];
    expect(
      s[1] < q && q < t[0],
      "premise: its tail parameter lies strictly before q, its other after",
    ).toBe(true);
    const sketch = makeSketchFixture();
    sketch.point("T", T[0], T[1]);
    sketch.point("E", 4, 0);
    sketch.line("L", "E", "T");
    const options = fabricatedShell(poles, "T", "E", [q, 1]);
    const result = await derive(sketch, options);
    expect(codes(result)).toEqual([]);
    expect(result.regions).toHaveLength(1);
    expectArea(
      fabricatedArea(result.regions[0]!, sketch, options),
      closedCurvesSignedArea([
        cubicOracle(poles, [0, 1], q, 1),
        lineOracle([4, 0], T),
      ]),
      "self-tail drawn loop",
    );
    expect(shellSegments(result)).toEqual([[q, 1]]);
  }, 120_000);

  test("a tail crossing two curves (a would-be tail triangle) and a line tangent to the tail bound no face: the drawn loop keeps its plain id and area (review rows C, D)", async () => {
    const build = (variant: "plain" | "triangle" | "tangent", q: number) => {
      const T = at(ARCH, q);
      const sketch = makeSketchFixture();
      sketch.point("T", T[0], T[1]);
      sketch.point("E", 3, 0);
      sketch.line("L", "E", "T");
      if (variant === "triangle") {
        sketch.point("sa", -0.4, 0.2);
        sketch.point("sb", 0.8, 0.2);
        sketch.line("S", "sa", "sb");
        sketch.point("xa", -0.3, 0);
        sketch.point("xb", 0.3, 1.2);
        sketch.line("X", "xa", "xb");
      }
      if (variant === "tangent") {
        // The tail [0, 0.7] holds the arch's top B(1/2) = (1.5, 2.25).
        sketch.point("ka", 1, 2.25);
        sketch.point("kb", 2, 2.25);
        sketch.line("K", "ka", "kb");
      }
      return sketch;
    };
    for (const [variant, q, open] of [
      ["triangle", 0.25, ["S", "X"]],
      ["tangent", 0.7, ["K"]],
    ] as const) {
      const options = fabricatedShell(ARCH, "T", "E", [q, 1]);
      const plain = await derive(build("plain", q), options);
      const result = await derive(build(variant, q), options);
      expect(codes(result), variant).toEqual(["profile-open-segment"]);
      expect(targetsOf(result, "profile-open-segment"), variant).toEqual(open);
      expect(ids(result), variant).toEqual(ids(plain));
      expect(ids(result), variant).toHaveLength(1);
      expect(
        fabricatedArea(result.regions[0]!, build(variant, q), options),
        variant,
      ).toBeCloseTo(
        fabricatedArea(plain.regions[0]!, build("plain", q), options),
        12,
      );
      expect(shellSegments(result), variant).toEqual([[q, 1]]);
    }
  }, 120_000);

  test("a declared join on the tail (a pointOnCurve membership certified strictly before the trim) is never dropped: the G14 guard blocks the shell (A2, mandatory join-on-the-tail row)", async () => {
    const q = 0.5;
    const T = at(ARCH, q);
    const P = at(ARCH, 0.25);
    const sketch = makeSketchFixture();
    sketch.point("T", T[0], T[1]);
    sketch.point("E", 3, 0);
    sketch.line("L", "E", "T");
    sketch.point("P", P[0], P[1]);
    sketch.point("F", P[0] + 1, P[1] - 3);
    sketch.line("J", "P", "F");
    sketch.line("C", "F", "E");
    sketch.pointOnCurve("P", "shell");
    const options = fabricatedShell(ARCH, "T", "E", [q, 1]);
    const input = sketch.build(options);
    expect(
      input.solvedSnapshot.status.solveState,
      "premise: the fixture solve is accepted",
    ).toBe("solved");
    const result = await derive(sketch, options);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["region-derived-tail-crossing"]);
    expect(targetsOf(result, "region-derived-tail-crossing")).toEqual([
      "shell",
    ]);
  }, 120_000);

  test("a join realized at a nearby unique contact (uniqueContactInBall) starts the shell segment inside the trim's join ball, not at q (review R1, row E; pin)", async () => {
    const q = 0.5;
    const T = at(ARCH, q);
    const rho = FIXTURE_TOLERANCE / 2;
    const sketch = makeSketchFixture();
    sketch.point("T", T[0], T[1] + 0.3 * rho);
    sketch.point("E", 3, 0);
    sketch.point("A", 1, -1);
    sketch.line("L", "A", "T");
    sketch.line("C", "E", "A");
    const options = fabricatedShell(ARCH, "T", "E", [q, 1]);
    const realizations: string[] = [];
    const recording: NeutralCurveQueryCapability = {
      ...capability,
      queryNeutralCurveJoin: async (request) => {
        const answer = await capability.queryNeutralCurveJoin(request);
        if (answer.kind === "verified")
          realizations.push(...answer.joins.map((join) => join.realization));
        return answer;
      },
    };
    const result = await createSketchArrangementDeriver(recording).derive(
      sketch.build(options),
    );
    expect(realizations, "premise").toContain("uniqueContactInBall");
    expect(codes(result)).toEqual([]);
    expect(result.regions).toHaveLength(1);
    const [segment] = shellSegments(result);
    expect(segment![1]).toBe(1);
    expect(
      segment![0],
      "the segment starts on the tail side of q",
    ).toBeLessThan(q);
    const start = at(ARCH, segment![0]);
    expect(
      Math.hypot(start[0] - T[0], start[1] - T[1]),
      "inside the trim's join ball",
    ).toBeLessThan(rho);
  }, 120_000);

  /** F = [0, s]² as four lines. */
  const addSquare = (sketch: SketchFixture, size: number) => {
    for (const [name, x, y] of [
      ["f0", 0, 0],
      ["f1", size, 0],
      ["f2", size, size],
      ["f3", 0, size],
    ] as const)
      sketch.point(name, x, y);
    sketch.line("F0", "f0", "f1");
    sketch.line("F1", "f1", "f2");
    sketch.line("F2", "f2", "f3");
    sketch.line("F3", "f3", "f0");
  };
  /** K: an end-trimmed arch in F = [0, 10]² whose undrawn tail leaves F and comes down outside it. */
  const rayAdversary = () => {
    const poles = [
      [8, 4],
      [8, 8],
      [12.5, 8],
      [12, 4],
    ] as unknown as SplinePoles;
    const q = 0.4;
    const T = at(poles, q);
    const sketch = makeSketchFixture();
    addSquare(sketch, 10);
    sketch.point("A", 8, 4);
    sketch.point("T", T[0], T[1]);
    sketch.point("B", T[0], 4);
    sketch.line("KL0", "T", "B");
    sketch.line("KL1", "B", "A");
    return {
      poles,
      q,
      sketch,
      options: fabricatedShell(poles, "A", "T", [0, q]),
    };
  };

  test("nesting ray (G5CRAY): a child whose tail leaves its parent face nests by its drawn part: F has one hole K, plus K's disk, areas by oracle", async () => {
    const { poles, q, sketch, options } = rayAdversary();
    const result = await derive(sketch, options);
    expect(codes(result)).toEqual([]);
    const [parent, child] = [...result.regions].sort(
      (l, r) => r.loops.length - l.loops.length,
    ) as [RegionRecord, RegionRecord];
    expect(parent.loops.map((loop) => loop.role)).toEqual(["outer", "inner"]);
    expect(boundaryEntities(child)).toEqual(["KL0", "KL1", "shell"]);
    const T = at(poles, q);
    const disk = Math.abs(
      closedCurvesSignedArea([
        cubicOracle(poles, [0, 1], 0, q),
        lineOracle(T, [T[0], 4]),
        lineOracle([T[0], 4], [8, 4]),
      ]),
    );
    expectArea(fabricatedArea(child, sketch, options), disk, "K's disk");
    expectArea(fabricatedArea(parent, sketch, options, 0), 100, "F's outer");
    expectArea(-fabricatedArea(parent, sketch, options, 1), disk, "F's hole");
  }, 120_000);

  test("nesting ray, D3: a ray contact on a tail that lost a contact, whose enclosure reaches the trim, retries (here every ray does, so nesting fails closed)", async () => {
    const { q, sketch, options } = rayAdversary();
    const isRay = (curve: NeutralCurve) => curve.curveId === "ray";
    const result = await createSketchArrangementDeriver(
      loosened(isRay, (honest) => [
        Math.min(honest[0], q),
        Math.max(honest[1], q),
      ]),
    ).derive(sketch.build(options));
    expect(codes(result)).toEqual(["region-nesting-uncertain"]);
    expect(
      result.regions.some((region) => region.loops.length === 2),
      "F is not published with a hole it cannot certify",
    ).toBe(false);
  }, 120_000);

  test("nesting ray, review advisory A1 (row G): a child whose box is dominated by a contact-free tail still nests (its tail lost no contact, so its ray contacts count)", async () => {
    const poles = [
      [2, 2],
      [3, 3],
      [14, 17],
      [16, 16],
    ] as unknown as SplinePoles;
    const q = 0.85;
    const T = at(poles, q);
    const sketch = makeSketchFixture();
    addSquare(sketch, 20);
    sketch.point("T", T[0], T[1]);
    sketch.point("E", 16, 16);
    sketch.point("B", 16, T[1]);
    sketch.line("K0", "E", "B");
    sketch.line("K1", "B", "T");
    const options = fabricatedShell(poles, "T", "E", [q, 1]);
    const result = await derive(sketch, options);
    expect(codes(result)).toEqual([]);
    expect(result.regions.map((region) => region.loops.length).sort()).toEqual([
      1, 2,
    ]);
    const parent = result.regions.find((region) => region.loops.length === 2)!;
    expect(boundaryEntities(parent)).toEqual([
      "F0",
      "F1",
      "F2",
      "F3",
      "K0",
      "K1",
      "shell",
    ]);
    expectArea(fabricatedArea(parent, sketch, options, 0), 400, "F's outer");
  }, 120_000);
});

// D7 pins (T09 clearance owner).
const D7_LS90_TARGETS = ["close0", "off_p0", "off_p1"];
const D7_LS90_MESSAGE =
  'The declared join j["sketch_point_off_j0"] is not proven clear of entity sketch_entity_close0: a curve may pass through the join ball, where the realized boundary is not queried. Affects entity ';
const D7_LS90_MESSAGES = [
  `${D7_LS90_MESSAGE}sketch_entity_off_p0.`,
  `${D7_LS90_MESSAGE}sketch_entity_close0.`,
  `${D7_LS90_MESSAGE}sketch_entity_off_p1 span spline_occurrence_<uuid>>spline_occurrence_<uuid> sub-span 0.`,
];
const D7_90_TARGETS = ["off_p0", "src_0"];
const D7_90_MESSAGE =
  'The declared join j["derived:sketch_entity_off_p0:spline_occurrence_<uuid>>spline_occurrence_<uuid>:10"] is not proven clear of entity sketch_entity_src_0 span src_0_o1>src_0_o2: a curve may pass through the join ball, where the realized boundary is not queried. Affects entity ';
const D7_90_MESSAGES = [
  `${D7_90_MESSAGE}sketch_entity_src_0 span src_0_o1>src_0_o2.`,
  `${D7_90_MESSAGE}sketch_entity_off_p0 span spline_occurrence_<uuid>>spline_occurrence_<uuid> sub-span 9.`,
  `${D7_90_MESSAGE}sketch_entity_off_p0 span spline_occurrence_<uuid>>spline_occurrence_<uuid> sub-span 10.`,
];

// ---------------------------------------------------------------------------
// T08b-g7-F (logic lane). Seam: solver → region arrangement on native Fillet
// and Slot outlines with no offset (design §4 consequence 1, review R14): an
// edit of a source line must leave each arc attached to its points in the
// solved snapshot and in the region output. Control: the same outline with
// the relationships stripped (a Fillet/Slot authored before T08b-g7-F).
// ---------------------------------------------------------------------------

describe("T08b-g7-F: Fillet and Slot arcs stay attached after an edit (no offset; solved snapshot and regions)", () => {
  const EDIT_TOLERANCES = createDocumentSolverTolerances(OCC_KERNEL_SETTINGS);
  type Row = "rounded rect" | "rect + 1 fillet" | "slot";
  /**
   * The row, edited by +Δ on its first source line and solved. `relationships`
   * "beforeG7F" strips the Fillet/Slot relationships; `slotSource`
   * "construction" makes the slot's reference line construction geometry.
   */
  const edit = (
    label: Row,
    relationships: "native" | "beforeG7F",
    delta: number,
    slotSource: "asDrawn" | "construction" = "asDrawn",
  ) => {
    const row = seedArcRows().find((item) => item.row === label)!;
    const sketch = row.build(offsetArcHarness);
    const base =
      relationships === "native"
        ? sketch.definition
        : withoutFilletRelationships(sketch.definition);
    const authored: SketchDefinition =
      slotSource === "construction"
        ? {
            ...base,
            entities: base.entities.map((entity) =>
              sketch.seeds.includes(entity.entityId)
                ? entity
                : { ...entity, isConstruction: true },
            ),
          }
        : base;
    const line = sketch.seeds.find(
      (id) =>
        authored.entities.find((entity) => entity.entityId === id)?.kind ===
        "lineSegment",
    )!;
    const definition = withLineLength(authored, line, delta);
    const solved = solveSketchDefinitionCore({
      definition,
      tolerances: EDIT_TOLERANCES,
      modelingTolerance: FIXTURE_TOLERANCE,
      partialSolvePolicy: "bestEffort",
    });
    const points = new Map(
      solved.solvedSnapshot.solvedPoints.map((point) => [
        point.pointId,
        point.solvedPosition,
      ]),
    );
    const arcs = definition.entities.filter(
      (entity): entity is Extract<typeof entity, { kind: "arc" }> =>
        entity.kind === "arc",
    );
    // The largest gap between a solved arc record's ends and its solved points.
    const detach = Math.max(
      ...arcs.map((arc) => {
        const record = solved.solvedSnapshot.solvedEntities.find(
          (entity) => entity.entityId === arc.entityId,
        );
        if (record?.kind !== "arc") throw new Error("no solved arc");
        const gap = (a: readonly number[], b: readonly number[]) =>
          Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
        return Math.max(
          gap(record.startPosition, points.get(arc.startPointId)!),
          gap(record.endPosition, points.get(arc.endPointId)!),
        );
      }),
    );
    return { definition, solved, arcs, detach };
  };
  const regionsOf = ({ definition, solved }: ReturnType<typeof edit>) =>
    createSketchArrangementDeriver(capability).derive({
      documentId: "doc_workspace" as never,
      revisionId: "rev_0001" as never,
      sketchId: "sketch_g7f" as never,
      definition,
      solvedSnapshot: solved.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: FIXTURE_TOLERANCE,
    });
  const boundedBy = (regions: readonly RegionRecord[], entityId: string) =>
    regions.some((region) =>
      region.loops.some((loop) =>
        loop.segments.some(
          (segment) =>
            segment.branch.source.kind === "entity" &&
            segment.branch.source.entityId === entityId,
        ),
      ),
    );

  test.each(
    (
      [
        ["rounded rect", "asDrawn"],
        ["rect + 1 fillet", "asDrawn"],
        ["slot", "construction"],
      ] as const
    ).flatMap(([label, slotSource]) =>
      [0.05, 0.2].map((delta) => [label, delta, slotSource] as const),
    ),
  )(
    "%s, source line +%s (slot reference line: %s): with the native relationships every arc stays on its points and bounds a region; with them stripped (identity control) an arc detaches and bounds none",
    async (label, delta, slotSource) => {
      const native = edit(label, "native", delta, slotSource);
      expect(native.solved.status.solveState).toBe("solved");
      // Measured ≤ 1.4e-6 (the solve's own convergence); the control's gap
      // is the edit itself (≥ τ).
      expect(
        native.detach,
        "native: the solved arc records sit on their solved points (within τ/100)",
      ).toBeLessThanOrEqual(FIXTURE_TOLERANCE / 100);
      const nativeRegions = await regionsOf(native);
      for (const arc of native.arcs)
        expect(
          boundedBy(nativeRegions.regions, arc.entityId),
          `native: ${arc.label} bounds a region`,
        ).toBe(true);

      const stripped = edit(label, "beforeG7F", delta, slotSource);
      expect(
        stripped.detach,
        "control: an unbound arc keeps its old record while its point slides",
      ).toBeGreaterThan(FIXTURE_TOLERANCE);
      const strippedRegions = await regionsOf(stripped);
      expect(
        stripped.arcs.some(
          (arc) => !boundedBy(strippedRegions.regions, arc.entityId),
        ),
        "control: a detached arc bounds no region",
      ).toBe(true);
    },
    120_000,
  );

  // With the slot's reference line left as drawn, it ends exactly at both cap
  // centres. Before T10a the line ↔ start-cap pair query exhausted its exact
  // budget after an edit and no region was published: the circle-root
  // bisection's first midpoint is fl(π/4), which certifySinCos rejected, so
  // the bisection never moved (T10a-evidence/slot-tip-null-trace.log). With
  // the T10a range bound the edited slot publishes one region, as unedited.
  test.each([0.05, 0.2])(
    "slot with its reference line as drawn, +%s: the caps stay attached and bound the one published region (T10a re-pin of the former budget-exhaustion limit)",
    async (delta) => {
      const native = edit("slot", "native", delta);
      expect(native.solved.status.solveState).toBe("solved");
      expect(native.detach).toBeLessThanOrEqual(FIXTURE_TOLERANCE / 100);
      const result = await regionsOf(native);
      // Only the reference line itself is open (its ends are the cap centres).
      expect([...new Set(result.diagnostics.map((item) => item.code))]).toEqual(
        ["profile-open-segment"],
      );
      for (const item of result.diagnostics)
        expect(
          item.target?.kind === "entity" &&
            !boundedBy(result.regions, item.target.entityId),
          "the open segment bounds no region",
        ).toBe(true);
      expect(result.regions).toHaveLength(1);
      for (const arc of native.arcs)
        expect(
          boundedBy(result.regions, arc.entityId),
          `${arc.label} bounds the region`,
        ).toBe(true);
    },
    120_000,
  );
});

// ---------------------------------------------------------------------------
// T08b-g7-F (logic lane). Seam: the native C1 outlines with the Fillet's own
// relationships, carrying an Offset, then a source-line edit, through the
// solver → publish rounds (unhinted and hinted with the unedited published
// plan, as the live G17 path) and, on certified cells, the region
// arrangement with the published offset (design §4 table, review R15).
// ---------------------------------------------------------------------------

describe("T08b-g7-F: tangent fillets carrying an offset certify after an edit (design §4 matrix)", () => {
  const TOLERANCES = createDocumentSolverTolerances(OCC_KERNEL_SETTINGS);
  type Plans = Parameters<typeof solveSketchDefinitionCore>[0]["offsetPlans"];
  const solve = (definition: SketchDefinition, offsetPlans?: Plans) =>
    solveSketchDefinitionCore({
      definition,
      tolerances: TOLERANCES,
      modelingTolerance: FIXTURE_TOLERANCE,
      partialSolvePolicy: "bestEffort",
      ...(offsetPlans ? { offsetPlans } : {}),
    });
  const capabilities = {
    query: offsetQuery,
    certifier: offsetCertifier,
  };
  /** One live round: solve, publish, at most one hinted re-solve on planChanged. */
  const round = (definition: SketchDefinition, hints?: Plans) => {
    const first = solve(definition, hints);
    let snapshot = first.solvedSnapshot;
    const publish = () =>
      publishSketchOffsets({
        definition,
        solvedSnapshot: snapshot,
        modelingTolerance: FIXTURE_TOLERANCE,
        capabilities,
      })[0];
    let publication = publish();
    if (publication?.status === "planChanged") {
      snapshot = solve(definition, [
        { derivationId: publication.derivationId, plan: publication.plan! },
      ]).solvedSnapshot;
      publication = publish();
    }
    return { solveState: first.status.solveState, snapshot, publication };
  };
  /**
   * Recorded cells that do not certify, by final code (review R15): the
   * solver's tangency residual is quadratic in the angle, so the edited
   * fillet ends keep a ≈ 0.2° kink; at |d| = 0.5 that is δ ≈ 2e-3 ≥ τ and
   * the outward corner needs an arc that rule Z cannot place. Routed to T12
   * (a linear G1 residual).
   */
  const FAILURES = new Map<string, string>(
    ["rounded rect", "rounded rect rotated 0.3"].flatMap((row) =>
      (["unhinted", "hinted"] as const).map(
        (label) =>
          [
            `${row} -0.5 0.2 ${label}`,
            "derived-offset-spline-joint-unsupported",
          ] as const,
      ),
    ),
  );

  test.each(
    EDITED_FILLET_ROWS.filter((row) => row !== "rect").map(
      (row) => [row] as const,
    ),
  )(
    "%s with native fillets: every d × Δ cell solves and certifies, unhinted and hinted, except the recorded |d| = 0.5 limit cells; at d = 0.1, Δ = 0.2 every fillet arc bounds a region with the published offset",
    async (row) => {
      const { sketch, line } = editedFilletSketch(
        offsetArcHarness,
        row,
        "native",
      );
      const cells = new Map<string, string>();
      let regionCell:
        | (ReturnType<typeof round> & { edited: SketchDefinition })
        | undefined;
      for (const distance of TANGENT_FILLET_DISTANCES) {
        const { pair, relationshipDistance } = offsetArcHarness.adapt(
          sketch,
          distance,
        );
        expect(relationshipDistance, `${row} ${distance}`).toBe(distance);
        const base = round(pair.definition);
        expect(base.publication?.status, `${row} ${distance} unedited`).toBe(
          "certified",
        );
        const published: Plans = [
          {
            derivationId: base.publication!.derivationId,
            plan: { ...base.publication!.plan!, origin: "published" },
          },
        ];
        for (const delta of EDITED_FILLET_DELTAS) {
          const edited = withLineLength(pair.definition, line, delta);
          for (const [label, result] of [
            ["unhinted", round(edited)],
            ["hinted", round(edited, published)],
          ] as const) {
            const cell = `${row} ${distance} ${delta} ${label}`;
            expect(result.solveState, cell).toBe("solved");
            if (distance === 0.1 && delta === 0.2 && label === "hinted")
              regionCell = { edited, ...result };
            cells.set(
              cell,
              result.publication?.status === "certified"
                ? "certified"
                : `${result.publication?.diagnostic?.code}`,
            );
          }
        }
      }
      expect(
        new Map([...cells].filter(([, verdict]) => verdict !== "certified")),
      ).toEqual(
        new Map(
          [...FAILURES].filter(
            ([cell]) =>
              cell.startsWith(`${row} `) &&
              /^[-\d]/.test(cell.slice(row.length + 1)),
          ),
        ),
      );

      const { edited, snapshot, publication } = regionCell!;
      expect(publication?.status).toBe("certified");
      const publications = [publication!];
      const applied = applyOffsetPublications(edited, snapshot, publications);
      const result = await createSketchArrangementDeriver(capability).derive({
        documentId: "doc_workspace" as never,
        revisionId: "rev_0001" as never,
        sketchId: "sketch_g7f" as never,
        definition: edited,
        solvedSnapshot: applied,
        projectedReferences: [],
        modelingTolerance: FIXTURE_TOLERANCE,
        ...offsetArrangementInput(edited, applied, publications),
      });
      const filletArcs = sketch.seeds.filter(
        (id) =>
          edited.entities.find((entity) => entity.entityId === id)?.kind ===
          "arc",
      );
      expect(filletArcs.length).toBeGreaterThan(0);
      for (const arc of filletArcs)
        expect(
          result.regions.some((region) =>
            region.loops.some((loop) =>
              loop.segments.some(
                (segment) =>
                  segment.branch.source.kind === "entity" &&
                  segment.branch.source.entityId === arc,
              ),
            ),
          ),
          `${row} d = 0.1 Δ = 0.2: fillet ${arc} bounds a region`,
        ).toBe(true);
    },
    600_000,
  );

  /**
   * Recorded slot cells that do not certify, by final code: the same R15
   * limit (a ≈ 0.27° residual kink times |d| = 0.25 is δ ≥ τ).
   */
  const SLOT_FAILURES = new Map<string, string>(
    ["slot 0.25 0.05", "slot 0.25 0.2", "slot rotated 0.3 0.25 0.05"].flatMap(
      (cell) =>
        (["unhinted", "hinted"] as const).map(
          (label) =>
            [
              `${cell} ${label}`,
              "derived-offset-spline-joint-unsupported",
            ] as const,
        ),
    ),
  );

  test.each(["slot", "slot rotated 0.3"])(
    "%s (native Slot relationships): an edit of a side line keeps every cell solved and certified, unhinted and hinted, except the recorded |d| = 0.25 limit cells",
    (row) => {
      const spec = seedArcRows().find((item) => item.row === row)!;
      const sketch = spec.build(offsetArcHarness);
      const line = sketch.seeds.find(
        (id) =>
          sketch.definition.entities.find((entity) => entity.entityId === id)
            ?.kind === "lineSegment",
      )!;
      const cells = new Map<string, string>();
      // The slot's own D3 distances (|d| = 0.5 collapses its r = 0.2 caps).
      const distances = seedArcRows()
        .filter((item) => item.row === row)
        .map((item) => item.distance);
      expect(distances).toEqual([0.01, -0.01, 0.1, -0.1, 0.25]);
      for (const distance of distances) {
        const { pair, relationshipDistance } = offsetArcHarness.adapt(
          sketch,
          distance,
        );
        expect(relationshipDistance, `${row} ${distance}`).toBe(distance);
        const base = round(pair.definition);
        expect(base.publication?.status, `${row} ${distance} unedited`).toBe(
          "certified",
        );
        const published: Plans = [
          {
            derivationId: base.publication!.derivationId,
            plan: { ...base.publication!.plan!, origin: "published" },
          },
        ];
        for (const delta of EDITED_FILLET_DELTAS) {
          const edited = withLineLength(pair.definition, line, delta);
          for (const [label, result] of [
            ["unhinted", round(edited)],
            ["hinted", round(edited, published)],
          ] as const) {
            const cell = `${row} ${distance} ${delta} ${label}`;
            expect(result.solveState, cell).toBe("solved");
            cells.set(
              cell,
              result.publication?.status === "certified"
                ? "certified"
                : `${result.publication?.diagnostic?.code}`,
            );
          }
        }
      }
      expect(
        new Map([...cells].filter(([, verdict]) => verdict !== "certified")),
      ).toEqual(
        new Map(
          [...SLOT_FAILURES].filter(
            ([cell]) =>
              cell.startsWith(`${row} `) &&
              /^[-\d]/.test(cell.slice(row.length + 1)),
          ),
        ),
      );
    },
    600_000,
  );
});
