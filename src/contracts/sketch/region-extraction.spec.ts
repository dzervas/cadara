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
  CORNER_MATRIX_SOLVE_TOLERANCES,
  createNativeArcOffsetHarness,
  createNativeOffsetChainHarness,
  offsetFrameChainRows,
  offsetPartitionDragRows,
  seedArcRows,
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
    expect(cyclicFrom(loop.boundaryPointIds, "sketch_point_r0")).toEqual([
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

  test("a declared incidence on a full circle fails closed (T09a full-turn join limit)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("C", "c", 2);
    sketch.point("s0", 2, 0);
    sketch.point("s1", 5, 0);
    sketch.line("stem", "s0", "s1");
    sketch.pointOnCurve("s0", "C");
    addRectangle(sketch, "q", [30, 0, 40, 10]);
    const result = await derive(sketch);
    expect(result.regions.map(boundaryEntities)).toEqual([
      ["q_s0", "q_s1", "q_s2", "q_s3"],
    ]);
    expect(codes(result)).toEqual(["region-join-uncertain"]);
    expect(targetsOf(result, "region-join-uncertain")).toEqual(["C", "stem"]);
    expect(result.diagnostics[0]!.message).toContain("unsupported");
  });
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
    expect(result.regions[0]!.loops[0]!.boundaryPointIds).toEqual([]);
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

  test("a forged crossing of the trimmed-off tail fails closed (fabricated arrangement input, not produced by the offset owner) (G14)", async () => {
    // SL-90 0.01 closed by lines: the shell is trimmed at T and its
    // untrimmed terminal sub-span runs on, undrawn, to the pole E. A line
    // through the line output and that tail would close a small cell whose
    // boundary is the undrawn tail.
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
    const forged = await withLine(
      [x - 0.005, y + 0.019],
      [x + 0.01, y - 0.011],
    );
    expect(forged.regions).toEqual([]);
    expect(codes(forged)).toContain("region-derived-tail-crossing");
    expect(targetsOf(forged, "region-derived-tail-crossing")).toEqual([
      "off_p0",
    ]);
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

  test("a tail contact in the join box outside the ball is seen by the G14 guard (fabricated)", async () => {
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
    const result = await deriveTail(hook, q0, [1, 1]);
    expect(result.regions).toEqual([]);
    expect(codes(result)).toEqual(["region-derived-tail-crossing"]);
    expect(targetsOf(result, "region-derived-tail-crossing")).toEqual([
      "shell",
    ]);
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
