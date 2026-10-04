import { describe, expect, test } from "vitest";
import {
  evaluateNeutralCurve,
  type NeutralCurveQueryCapability,
} from "@/contracts/modeling/neutral-curve-query";
import {
  EXTEND_NO_INTERSECTION_MESSAGE,
  EXTEND_TARGET_UNSUPPORTED_MESSAGE,
  querySketchEditIntersections,
  SPLIT_NO_CROSSING_MESSAGE,
  SPLIT_TARGET_UNSUPPORTED_MESSAGE,
  TRIM_TOO_FEW_CUTS_MESSAGE,
  type SketchEditIntersectionResult,
} from "@/contracts/sketch/edit-intersections";
import {
  addRectangle,
  makeSketchFixture,
  type SketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import { collectArrangementBranches } from "@/contracts/sketch/region-extraction";
import { nextDown, nextUp } from "@/contracts/sketch/region-interval-geometry";
import type { SketchEntityId } from "@/contracts/shared/ids";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";

// Contract seam (logic lane): the exact edit-intersection service, on the
// arrangement fixtures and the kernel-free certified capability.

const entity = (name: string) => `sketch_entity_${name}` as SketchEntityId;
const point = (name: string) => `sketch_point_${name}`;

async function trim(
  sketch: SketchFixture,
  target: string,
  queries: NeutralCurveQueryCapability = createCertifiedNeutralCurveQueryCapabilityForTest(),
) {
  const input = sketch.build();
  return querySketchEditIntersections(
    {
      definition: input.definition,
      solvedSnapshot: input.solvedSnapshot,
      projectedReferences: [],
      modelingTolerance: input.modelingTolerance,
      operation: { kind: "trim", targetEntityId: entity(target) },
    },
    queries,
  );
}

function verified(result: SketchEditIntersectionResult) {
  if (result.kind !== "verified")
    throw new Error(`expected verified, got ${JSON.stringify(result)}`);
  return result;
}

/** The target's solved neutral branch (the oracle evaluates the same curve). */
function targetCurve(sketch: SketchFixture, target: string) {
  const input = sketch.build();
  return collectArrangementBranches(
    input.definition,
    input.solvedSnapshot,
    [],
    [],
    [],
    { includeConstruction: true },
  ).branches.filter((branch) => branch.entityId === entity(target));
}

/** A horizontal target (0,0)→(4,0) with vertical cutters at the given x. */
function lineWithCutters(
  xs: readonly number[],
  construction: readonly boolean[] = [],
) {
  const sketch = makeSketchFixture();
  sketch.point("t0", 0, 0);
  sketch.point("t1", 4, 0);
  sketch.line("target", "t0", "t1");
  xs.forEach((x, index) => {
    sketch.point(`c${index}a`, x, -1);
    sketch.point(`c${index}b`, x, 1);
    sketch.line(`c${index}`, `c${index}a`, `c${index}b`, construction[index]);
  });
  return sketch;
}

describe("querySketchEditIntersections (T10g-1 exact edit-intersection service)", () => {
  test("line target: cuts in order with certified enclosures; positions are the sole evaluator at the representatives; construction cutters cut (A4) and are tied", async () => {
    const sketch = lineWithCutters([1, 3], [false, true]);
    const result = verified(await trim(sketch, "target"));
    const [branch] = targetCurve(sketch, "target");
    expect(result.parameterOrder).toBe("increasing");
    expect(result.cuts.map((cut) => cut.representative)).toEqual([0.25, 0.75]);
    for (const cut of result.cuts) {
      expect(cut.enclosure[0]).toBeLessThanOrEqual(cut.representative);
      expect(cut.enclosure[1]).toBeGreaterThanOrEqual(cut.representative);
      expect(cut.position).toEqual(
        evaluateNeutralCurve(branch!.curve, cut.representative),
      );
      expect(cut.knotOccurrenceIndex).toBeNull();
    }
    expect(result.cuts.map((cut) => cut.cutters)).toEqual([
      [{ entityId: entity("c0"), tie: { kind: "pointOnCurve" } }],
      [{ entityId: entity("c1"), tie: { kind: "pointOnCurve" } }],
    ]);
    expect(result.nonAcceptedNearTarget).toEqual([]);
  });

  test("every cutter kind: line, arc, circle (two roots) and spline span", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", -10, 0);
    sketch.point("t1", 10, 0);
    sketch.line("target", "t0", "t1");
    sketch.point("l0", -8, -1);
    sketch.point("l1", -8, 1);
    sketch.line("line", "l0", "l1");
    sketch.point("ac", -5, 0);
    sketch.point("as", -4, -1);
    sketch.point("ae", -4, 1);
    sketch.arc("arc", "ac", "as", "ae");
    sketch.point("cc", 0, 0);
    sketch.circle("circle", "cc", 1);
    sketch.point("s0", 4, -1);
    sketch.point("s1", 5, 1);
    sketch.point("s2", 6, 2);
    sketch.spline("spline", ["s0", "s1", "s2"], "open");
    const result = verified(await trim(sketch, "target"));
    expect(
      result.cuts.map((cut) => cut.cutters.map((cutter) => cutter.entityId)),
    ).toEqual([
      [entity("line")],
      [entity("arc")],
      [entity("circle")],
      [entity("circle")],
      [entity("spline")],
    ]);
    const xs = result.cuts.map((cut) => cut.position[0]);
    expect(xs[0]).toBe(-8);
    expect(xs[2]).toBeCloseTo(-1, 12);
    expect(xs[3]).toBeCloseTo(1, 12);
    expect(
      result.cuts.every((cut) => cut.cutters[0]!.tie?.kind === "pointOnCurve"),
    ).toBe(true);
  });

  test("a declared join at a target end is no cut; a cutter end tied onto the target is a cut tied `coincident` to that end", async () => {
    const sketch = lineWithCutters([3]);
    // A corner: a line sharing the target's start point.
    sketch.point("u", 0, 2);
    sketch.line("corner", "t0", "u");
    // A spoke whose end is declared on the target (`pointOnCurve`).
    sketch.point("r", 1, 2);
    sketch.point("q", 1, 0);
    sketch.line("spoke", "r", "q");
    sketch.pointOnCurve("q", "target");
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts.map((cut) => cut.cutters)).toEqual([
      [
        {
          entityId: entity("spoke"),
          tie: { kind: "coincident", pointId: point("q") },
        },
      ],
      [{ entityId: entity("c0"), tie: { kind: "pointOnCurve" } }],
    ]);
    expect(result.incidences).toEqual([
      {
        constraintId: expect.any(String),
        pointId: point("q"),
        parameter: 0.25,
        cut: 0,
      },
    ]);
  });

  test("review R-2: an undeclared cutter end exactly on the target interior ties `coincident` with that end (the cutter's enclosure holds its port)", async () => {
    const sketch = lineWithCutters([3]);
    sketch.point("r", 1, 2);
    sketch.point("q", 1, 0);
    sketch.line("spoke", "r", "q");
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts[0]!.cutters).toEqual([
      {
        entityId: entity("spoke"),
        tie: { kind: "coincident", pointId: point("q") },
      },
    ]);
  });

  test("T-g16: exact collinear overlap ends are cuts, tied to the overlapping cutter's ends", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", 0, 0);
    sketch.point("t1", 4, 0);
    sketch.line("target", "t0", "t1");
    sketch.point("o0", 1, 0, true);
    sketch.point("o1", 3, 0, true);
    sketch.line("overlap", "o0", "o1", true);
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts.map((cut) => cut.representative)).toEqual([0.25, 0.75]);
    expect(result.cuts.map((cut) => cut.cutters)).toEqual([
      [
        {
          entityId: entity("overlap"),
          tie: { kind: "coincident", pointId: point("o0") },
        },
      ],
      [
        {
          entityId: entity("overlap"),
          tie: { kind: "coincident", pointId: point("o1") },
        },
      ],
    ]);
  });

  test("endpoint rule: a crossing whose enclosure holds an open target's end is a contact at that end, not a cut", async () => {
    const sketch = lineWithCutters([0, 2, 4]);
    const result = await trim(sketch, "target");
    expect(result).toEqual({
      kind: "failed",
      code: "edit-too-few-cuts",
      message: TRIM_TOO_FEW_CUTS_MESSAGE,
      entityIds: [entity("target")],
      nonAcceptedNearTarget: [],
    });
  });

  test("knot rule: a crossing through a spline fit point snaps to that knot bitwise (one cut, not two span roots); spans' interior roots stay ordinary", async () => {
    const sketch = makeSketchFixture();
    sketch.point("s0", 0, 0);
    sketch.point("s1", 2, 3);
    sketch.point("s2", 4, 0);
    sketch.spline("target", ["s0", "s1", "s2"], "open");
    sketch.point("k0", 2, -1);
    sketch.point("k1", 2, 5);
    sketch.line("knot", "k0", "k1");
    sketch.point("m0", 3, -1);
    sketch.point("m1", 3, 5);
    sketch.line("mid", "m0", "m1");
    const result = verified(await trim(sketch, "target"));
    const spans = targetCurve(sketch, "target").sort(
      (left, right) => left.domain[0] - right.domain[0],
    );
    const knot = spans[1]!.domain[0];
    expect(result.cuts).toHaveLength(2);
    expect(result.cuts[0]).toMatchObject({
      representative: knot,
      knotOccurrenceIndex: 1,
      position: [2, 3],
      cutters: [{ entityId: entity("knot"), tie: { kind: "pointOnCurve" } }],
    });
    expect(result.cuts[1]!.knotOccurrenceIndex).toBeNull();
    expect(result.cuts[1]!.representative).toBeGreaterThan(knot);
  });

  test("T10g-1 re-review A-R2 (T10g-3b): a smooth closed 4-point spline cut by y = 0 meets it at its seam knot and at the opposite knot: 2 cuts, the first the seam (t = 0, knot 0)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("p0", 1, 0);
    sketch.point("p1", 0, 1);
    sketch.point("p2", -1, 0);
    sketch.point("p3", 0, -1);
    sketch.spline("target", ["p0", "p1", "p2", "p3"], "smooth");
    sketch.point("a", -2, 0);
    sketch.point("b", 2, 0);
    sketch.line("axis", "a", "b");
    const result = verified(await trim(sketch, "target"));
    const spans = targetCurve(sketch, "target").sort(
      (left, right) => left.domain[0] - right.domain[0],
    );
    expect(result.cuts).toHaveLength(2);
    const [seam, opposite] = result.cuts as [
      (typeof result.cuts)[0],
      (typeof result.cuts)[0],
    ];
    expect(Object.is(seam.representative, 0)).toBe(true);
    expect(seam.knotOccurrenceIndex).toBe(0);
    expect(seam.position).toEqual([1, 0]);
    expect(
      seam.enclosure[0],
      "the seam cut's enclosure is lifted around the seam start (its part before T wraps)",
    ).toBeLessThan(0);
    expect(seam.cutters).toEqual([
      { entityId: entity("axis"), tie: { kind: "pointOnCurve" } },
    ]);
    expect(opposite).toMatchObject({
      representative: spans[2]!.domain[0],
      knotOccurrenceIndex: 2,
      position: [-1, 0],
    });
  });

  test("A-8: a circle target's parameter is the angle from the +x seam, today's Trim origin (cuts at π/3, 2π/3, 4π/3, 5π/3)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("target", "c", 2);
    for (const [name, x] of [
      ["right", 1],
      ["left", -1],
    ] as const) {
      sketch.point(`${name}0`, x, -3);
      sketch.point(`${name}1`, x, 3);
      sketch.line(name, `${name}0`, `${name}1`);
    }
    const result = verified(await trim(sketch, "target"));
    expect(result.parameterOrder).toBe("increasing");
    const angles = result.cuts.map((cut) => cut.representative);
    [
      Math.PI / 3,
      (2 * Math.PI) / 3,
      (4 * Math.PI) / 3,
      (5 * Math.PI) / 3,
    ].forEach((angle, index) => expect(angles[index]).toBeCloseTo(angle, 12));
    expect(result.cuts[0]!.position[0]).toBeCloseTo(1, 12);
    expect(result.cuts[0]!.position[1]).toBeCloseTo(Math.sqrt(3), 12);
    expect(result.cuts.map((cut) => cut.cutters[0]!.entityId)).toEqual([
      entity("right"),
      entity("left"),
      entity("left"),
      entity("right"),
    ]);
  });

  test("[TECH] 2026-10-04 seam: a line through a circle's centre along x meets it at θ = 0, which is snapped bitwise and is the first cut from the seam", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("target", "c", 1);
    sketch.point("a", -2, 0);
    sketch.point("b", 2, 0);
    sketch.line("h", "a", "b");
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts).toHaveLength(2);
    const [seam, opposite] = result.cuts;
    expect(Object.is(seam!.representative, 0)).toBe(true);
    expect(seam!.position).toEqual([1, 0]);
    expect(seam!.enclosure[0]).toBeLessThan(0);
    expect(seam!.enclosure[1]).toBeGreaterThanOrEqual(0);
    expect(opposite!.representative).toBeCloseTo(Math.PI, 12);
    expect(result.cuts.map((cut) => cut.cutters)).toEqual([
      [{ entityId: entity("h"), tie: { kind: "pointOnCurve" } }],
      [{ entityId: entity("h"), tie: { kind: "pointOnCurve" } }],
    ]);
  });

  test("[TECH] 2026-10-04 seam: a spoke tied at the circle's 0° point is the seam cut (`coincident` with its end), its incidence belongs to it", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("target", "c", 1);
    sketch.point("q", 1, 0);
    sketch.point("r", 3, 0);
    sketch.line("spoke", "r", "q");
    const tie = sketch.pointOnCurve("q", "target");
    sketch.point("v0", 0, -2);
    sketch.point("v1", 0, 2);
    sketch.line("v", "v0", "v1");
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts.map((cut) => cut.representative)).toEqual([
      0,
      expect.closeTo(Math.PI / 2, 12),
      expect.closeTo((3 * Math.PI) / 2, 12),
    ]);
    expect(result.cuts[0]!.cutters).toEqual([
      {
        entityId: entity("spoke"),
        tie: { kind: "coincident", pointId: point("q") },
      },
    ]);
    expect(result.incidences).toEqual([
      expect.objectContaining({ constraintId: tie, cut: 0 }),
    ]);
  });

  test("[TECH] 2026-10-04 seam: clustering wraps — a contact just before 2π that overlaps the seam contact's enclosure joins the seam cut", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("target", "c", 1);
    sketch.point("a", -2, 0);
    sketch.point("b", 2, 0);
    sketch.line("h", "a", "b");
    // Inside the target's box, so the (stubbed) pair is queried.
    sketch.point("w0", 0.5, 0.5);
    sketch.point("w1", 0.6, 0.6);
    sketch.line("w", "w0", "w1");
    const inner = createCertifiedNeutralCurveQueryCapabilityForTest();
    const late = nextDown(nextDown(2 * Math.PI));
    const result = verified(
      await trim(sketch, "target", {
        ...inner,
        queryNeutralCurves: async (request) =>
          request.second.provenance.sourceEntityId === entity("w")
            ? {
                kind: "verified",
                points: [
                  {
                    classification: "crossing",
                    firstParameter: late,
                    secondParameter: 0.5,
                    position: [1, 0],
                    proof: {
                      kind: "exactAlgebraicCurveRootSet",
                      family: "circlePair",
                      firstParameterBounds: [late, late],
                      secondParameterBounds: [0.5, 0.5],
                    },
                  },
                ],
                overlaps: [],
                completenessProof: {
                  kind: "completeIsolatedRootSet",
                  family: "circlePair",
                  distinctRootCount: 1,
                },
              }
            : inner.queryNeutralCurves(request),
      }),
    );
    expect(result.cuts).toHaveLength(2);
    expect(Object.is(result.cuts[0]!.representative, 0)).toBe(true);
    expect(
      result.cuts[0]!.cutters.map((cutter) => cutter.entityId).sort(),
    ).toEqual([entity("h"), entity("w")]);
  });

  test("a clockwise arc target lists its cuts along its traversal (decreasing angle)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.point("a", -2, 0);
    sketch.point("b", 2, 0);
    sketch.arc("target", "c", "a", "b", "clockwise");
    sketch.point("l0", -1, -1);
    sketch.point("l1", -1, 3);
    sketch.line("left", "l0", "l1");
    sketch.point("r0", 1, -1);
    sketch.point("r1", 1, 3);
    sketch.line("right", "r0", "r1");
    const result = verified(await trim(sketch, "target"));
    expect(result.parameterOrder).toBe("decreasing");
    expect(result.cuts.map((cut) => cut.cutters[0]!.entityId)).toEqual([
      entity("left"),
      entity("right"),
    ]);
    expect(result.cuts[0]!.representative).toBeGreaterThan(
      result.cuts[1]!.representative,
    );
  });

  test("A-2: a tangent contact is a cut whose position is evaluated inside its certified enclosure (width pinned)", async () => {
    const sketch = makeSketchFixture();
    sketch.point("t0", -4, 2);
    sketch.point("t1", 4, 2);
    sketch.line("target", "t0", "t1");
    sketch.point("c", 0, 0);
    sketch.circle("circle", "c", 2);
    sketch.point("x0", 2, 0);
    sketch.point("x1", 2, 4);
    sketch.line("cross", "x0", "x1");
    const result = verified(await trim(sketch, "target"));
    const tangent = result.cuts[0]!;
    expect(tangent.cutters[0]!.entityId).toBe(entity("circle"));
    expect(tangent.representative).toBe(0.5);
    expect(tangent.enclosure[1] - tangent.enclosure[0]).toBeLessThanOrEqual(
      nextUp(0.5) - nextDown(0.5),
    );
  });

  test("an uncertain pair is a named failure that changes nothing", async () => {
    const sketch = lineWithCutters([1, 3]);
    const inner = createCertifiedNeutralCurveQueryCapabilityForTest();
    const result = await trim(sketch, "target", {
      ...inner,
      queryNeutralCurves: async (request) =>
        request.second.provenance.sourceEntityId === entity("c1")
          ? { kind: "uncertain", code: "probe-uncertain", message: "probe" }
          : inner.queryNeutralCurves(request),
    });
    expect(result).toEqual({
      kind: "failed",
      code: "edit-intersection-uncertain",
      message:
        "Trim could not verify where target meets c1 (probe-uncertain). Nothing was changed.",
      entityIds: [entity("target"), entity("c1")],
      nonAcceptedNearTarget: [],
    });
  });

  test("two certified roots of one cutter in one cluster cannot be ordered: fail closed", async () => {
    const sketch = lineWithCutters([1, 3]);
    const inner = createCertifiedNeutralCurveQueryCapabilityForTest();
    const result = await trim(sketch, "target", {
      ...inner,
      queryNeutralCurves: async (request) => {
        const answer = await inner.queryNeutralCurves(request);
        if (
          request.second.provenance.sourceEntityId !== entity("c0") ||
          answer.kind !== "verified"
        )
          return answer;
        const [only] = answer.points;
        return {
          ...answer,
          points: [
            only!,
            {
              ...only!,
              firstParameter: nextUp(only!.firstParameter),
              proof: {
                ...only!.proof,
                firstParameterBounds: [
                  nextUp(only!.firstParameter),
                  nextUp(only!.firstParameter),
                ],
              },
            },
          ],
        } as typeof answer;
      },
    });
    expect(result).toMatchObject({
      kind: "failed",
      code: "edit-intersections-unordered",
      entityIds: [entity("target"), entity("c0")],
    });
  });

  test("review R-4: two cutters through one cut that share no declared join class: only the representative's cutter is tied (near-parallel cutters would otherwise pull the end to their far intersection)", async () => {
    const sketch = lineWithCutters([3]);
    sketch.point("a0", 1, -1);
    sketch.point("a1", 1, 1);
    sketch.line("a", "a0", "a1");
    sketch.point("b0", 1 - 1 / 1024, -1);
    sketch.point("b1", 1 + 1 / 1024, 1);
    sketch.line("b", "b0", "b1");
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts).toHaveLength(2);
    expect(result.cuts[0]!.cutters).toEqual([
      { entityId: entity("a"), tie: { kind: "pointOnCurve" } },
      { entityId: entity("b"), tie: null },
    ]);
  });

  test("review R-4: two cutters whose ends share one declared join class at the cut are both kept, tied once (`coincident` with the shared point)", async () => {
    const sketch = lineWithCutters([3]);
    sketch.point("q", 1, 0);
    sketch.point("a0", 0.5, 1);
    sketch.line("a", "a0", "q");
    sketch.point("b0", 1.5, 1);
    sketch.line("b", "q", "b0");
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts[0]!.cutters).toEqual([
      {
        entityId: entity("a"),
        tie: { kind: "coincident", pointId: point("q") },
      },
      { entityId: entity("b"), tie: null },
    ]);
  });

  test("review A-5: two cutters ending at two distinct points of one satisfied coincident class are tied once per class (one `coincident`)", async () => {
    const sketch = lineWithCutters([3]);
    sketch.point("q1", 1, 0);
    sketch.point("q2", 1, 0);
    sketch.point("a0", 0.5, 1);
    sketch.point("b0", 1.5, 1);
    sketch.line("a", "a0", "q1");
    sketch.line("b", "q2", "b0");
    sketch.coincident("q1", "q2");
    const result = verified(await trim(sketch, "target"));
    expect(result.cuts[0]!.cutters).toEqual([
      {
        entityId: entity("a"),
        tie: { kind: "coincident", pointId: point("q1") },
      },
      { entityId: entity("b"), tie: null },
    ]);
  });

  test("the arrangement is unchanged with default options: a construction curve is no region branch", () => {
    const sketch = makeSketchFixture();
    addRectangle(sketch, "r", [0, 0, 2, 1]);
    sketch.point("k0", 1, -1, true);
    sketch.point("k1", 1, 2, true);
    sketch.line("construction", "k0", "k1", true);
    const input = sketch.build();
    const defaults = collectArrangementBranches(
      input.definition,
      input.solvedSnapshot,
      [],
      [],
      [],
    );
    expect(
      defaults.branches.some(
        (branch) => branch.entityId === entity("construction"),
      ),
    ).toBe(false);
    expect(
      collectArrangementBranches(
        input.definition,
        input.solvedSnapshot,
        [],
        [],
        [],
        { includeConstruction: true },
      ).branches.map((branch) => branch.key),
    ).toEqual([
      ...defaults.branches.map((branch) => branch.key),
      expect.stringContaining("construction"),
    ]);
  });
});

// T10g-2 (Q-g3: today's kinds, a line target with a line boundary, made
// exact and tied). Contract seam, kernel-free certified capability.
describe("Extend and Split (T10g-2)", () => {
  async function edit(
    sketch: SketchFixture,
    kind: "extend" | "split",
    target = "target",
    boundary = "boundary",
    queries: NeutralCurveQueryCapability = createCertifiedNeutralCurveQueryCapabilityForTest(),
  ) {
    const input = sketch.build();
    return querySketchEditIntersections(
      {
        definition: input.definition,
        solvedSnapshot: input.solvedSnapshot,
        projectedReferences: [],
        modelingTolerance: input.modelingTolerance,
        operation: {
          kind,
          targetEntityId: entity(target),
          boundaryEntityId: entity(boundary),
        },
      },
      queries,
    );
  }
  /** Target (0,0)→(t1x,0) and a boundary line (b0)→(b1). */
  function lines(
    t1x: number,
    b0: readonly [number, number],
    b1: readonly [number, number],
  ) {
    const sketch = makeSketchFixture();
    sketch.point("t0", 0, 0);
    sketch.point("t1", t1x, 0);
    sketch.line("target", "t0", "t1");
    sketch.point("b0", b0[0], b0[1]);
    sketch.point("b1", b1[0], b1[1]);
    sketch.line("boundary", "b0", "b1");
    return sketch;
  }
  const failure = (code: string, message: string) => ({
    kind: "failed",
    code,
    message,
    entityIds: [entity("target"), entity("boundary")],
    nonAcceptedNearTarget: [],
  });

  test("extend line→line, end: the end moves to the boundary at the evaluator position on the extension, tied pointOnCurve", async () => {
    const result = verified(await edit(lines(1, [3, -1], [3, 1]), "extend"));
    expect(result.extendedEnd).toBe("end");
    expect(result.cuts).toHaveLength(1);
    const [cut] = result.cuts;
    // Distance from the end (1,0) along the unit extension.
    expect(cut!.representative).toBe(2);
    expect(cut!.enclosure[0]).toBeLessThanOrEqual(2);
    expect(cut!.enclosure[1]).toBeGreaterThanOrEqual(2);
    expect(cut!.position).toEqual([3, 0]);
    expect(cut!.cutters).toEqual([
      { entityId: entity("boundary"), tie: { kind: "pointOnCurve" } },
    ]);
    expect(result.incidences).toEqual([]);
  });

  test("extend line→line, start: a boundary behind the start extends the start", async () => {
    const result = verified(await edit(lines(1, [-2, -1], [-2, 1]), "extend"));
    expect(result.extendedEnd).toBe("start");
    expect(result.cuts[0]!.position).toEqual([-2, 0]);
    expect(result.cuts[0]!.representative).toBe(2);
  });

  test("extend: the boundary is its infinite line (T-g10): a hit beyond the boundary segment extends, tied pointOnCurve", async () => {
    const result = verified(await edit(lines(1, [3, 1], [3, 2]), "extend"));
    expect(result.cuts[0]!.position).toEqual([3, 0]);
    expect(result.cuts[0]!.cutters).toEqual([
      { entityId: entity("boundary"), tie: { kind: "pointOnCurve" } },
    ]);
    // Beyond its end point too, along a slanted boundary.
    const slanted = verified(await edit(lines(1, [5, 4], [4, 2]), "extend"));
    expect(slanted.extendedEnd).toBe("end");
    expect(slanted.cuts[0]!.position[0]).toBeCloseTo(3, 12);
    expect(slanted.cuts[0]!.position[1]).toBe(0);
  });

  test("extend R-2: a boundary end point on the extension is tied coincident with that point (by the boundary segment's or its ray's enclosure alone)", async () => {
    const inner = createCertifiedNeutralCurveQueryCapabilityForTest();
    // Drops one boundary piece's contacts: the segment's, or its two rays'.
    const without = (
      piece: "segment" | "rays",
    ): NeutralCurveQueryCapability => ({
      ...inner,
      queryNeutralCurves: async (request) => {
        const answer = await inner.queryNeutralCurves(request);
        const isSegment =
          request.second.kind === "line" &&
          request.second.form === "endpointSegment";
        return answer.kind === "verified" && (piece === "segment") === isSegment
          ? { ...answer, points: [] }
          : answer;
      },
    });
    for (const queries of [
      createCertifiedNeutralCurveQueryCapabilityForTest(),
      without("segment"),
      without("rays"),
    ])
      for (const [b0, b1, port] of [
        [[3, 0], [3, 2], "b0"],
        [[3, 2], [3, 0], "b1"],
      ] as const) {
        const result = verified(
          await edit(lines(1, b0, b1), "extend", "target", "boundary", queries),
        );
        expect(result.cuts[0]!.position).toEqual([3, 0]);
        expect(result.cuts[0]!.cutters).toEqual([
          {
            entityId: entity("boundary"),
            tie: { kind: "coincident", pointId: point(port) },
          },
        ]);
      }
  });

  test("extend: parallel, collinear, crossing inside, or through the end is no intersection outside the selected curve", async () => {
    for (const [b0, b1] of [
      [
        [0, 1],
        [1, 1],
      ], // parallel
      [
        [2, 0],
        [3, 0],
      ], // collinear (an overlap of the extension)
      [
        [0.5, -1],
        [0.5, 1],
      ], // crosses the target inside
      [
        [1, -1],
        [1, 1],
      ], // through the end
      [
        [0, -1],
        [0, 1],
      ], // through the start
    ] as const)
      expect(await edit(lines(1, b0, b1), "extend")).toEqual(
        failure("edit-no-crossing", EXTEND_NO_INTERSECTION_MESSAGE),
      );
  });

  test("review A-2 (intended, T-g10 exact semantics): a nearly parallel boundary is met far away and Extend goes there; no extent bound refuses it", async () => {
    // Boundary y = 1 − 1e-9·x: it meets the target's line at x = 1e9.
    const result = verified(
      await edit(lines(1, [0, 1], [1, 1 - 1e-9]), "extend"),
    );
    expect(result.extendedEnd).toBe("end");
    expect(result.cuts[0]!.position[1]).toBe(0);
    expect(Math.abs(result.cuts[0]!.position[0] / 1e9 - 1)).toBeLessThan(1e-6);
    expect(result.cuts[0]!.cutters).toEqual([
      { entityId: entity("boundary"), tie: { kind: "pointOnCurve" } },
    ]);
  });

  test("review A-5: a degenerate boundary is named as the boundary, not as the curve being extended", async () => {
    expect(await edit(lines(1, [3, 1], [3, 1]), "extend")).toEqual({
      kind: "failed",
      code: "edit-target-invalid",
      message:
        "Extend can't use boundary as a boundary: its shape is invalid (zero-length line).",
      entityIds: [entity("boundary")],
      nonAcceptedNearTarget: [],
    });
  });

  test("extend: the nearer end wins; both ends reaching the boundary equally far fail closed (edit-extend-ambiguous)", async () => {
    const inner = createCertifiedNeutralCurveQueryCapabilityForTest();
    // A stub: each extension ray meets the boundary segment at `distance[end]`.
    const stub = (distance: { start: number; end: number }) => ({
      ...inner,
      queryNeutralCurves: async (
        request: Parameters<
          NeutralCurveQueryCapability["queryNeutralCurves"]
        >[0],
      ) => {
        const span = request.first.provenance.sourceSpanId;
        if (
          (span !== "extend-start" && span !== "extend-end") ||
          request.second.kind !== "line" ||
          request.second.form !== "endpointSegment"
        )
          return inner.queryNeutralCurves(request);
        const s = span === "extend-start" ? distance.start : distance.end;
        return {
          kind: "verified" as const,
          points: [
            {
              classification: "crossing" as const,
              firstParameter: s,
              secondParameter: 0.5,
              position: evaluateNeutralCurve(request.first, s),
              proof: {
                kind: "exactAlgebraicCurveRootSet" as const,
                family: "linePair" as const,
                firstParameterBounds: [s, s] as [number, number],
                secondParameterBounds: [0.5, 0.5] as [number, number],
              },
            },
          ],
          overlaps: [],
          completenessProof: {
            kind: "completeIsolatedRootSet" as const,
            family: "linePair" as const,
            distinctRootCount: 1,
          },
        };
      },
    });
    const sketch = lines(1, [0.5, 3], [0.5, 4]);
    const nearer = verified(
      await edit(
        sketch,
        "extend",
        "target",
        "boundary",
        stub({ start: 1, end: 2 }),
      ),
    );
    expect(nearer.extendedEnd).toBe("start");
    expect(nearer.cuts[0]!.position).toEqual([-1, 0]);
    expect(
      await edit(
        sketch,
        "extend",
        "target",
        "boundary",
        stub({ start: 2, end: 2 }),
      ),
    ).toEqual(
      failure(
        "edit-extend-ambiguous",
        "Extend can't choose which end of target to extend: both reach boundary equally far.",
      ),
    );
  });

  test("extend: an uncertain pair is a named failure", async () => {
    const inner = createCertifiedNeutralCurveQueryCapabilityForTest();
    const result = await edit(
      lines(1, [3, -1], [3, 1]),
      "extend",
      "target",
      "boundary",
      {
        ...inner,
        queryNeutralCurves: async () => ({
          kind: "uncertain",
          code: "probe-uncertain",
          message: "probe",
        }),
      },
    );
    expect(result).toEqual(
      failure(
        "edit-intersection-uncertain",
        "Extend could not verify where target meets boundary (probe-uncertain). Nothing was changed.",
      ),
    );
  });

  test("split line×line: one cut at the crossing inside, tied pointOnCurve; none, at an end, or collinear is no crossing", async () => {
    const result = verified(await edit(lines(4, [2, -1], [2, 1]), "split"));
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]!.representative).toBe(0.5);
    expect(result.cuts[0]!.position).toEqual([2, 0]);
    expect(result.cuts[0]!.cutters).toEqual([
      { entityId: entity("boundary"), tie: { kind: "pointOnCurve" } },
    ]);
    expect(result.extendedEnd).toBeUndefined();
    for (const [b0, b1] of [
      [
        [5, -1],
        [5, 1],
      ], // misses
      [
        [0, 1],
        [4, 1],
      ], // parallel
      [
        [4, -1],
        [4, 1],
      ], // at the end: no cut
      [
        [0, -1],
        [0, 1],
      ], // at the start: no cut
      [
        [1, 0],
        [2, 0],
      ], // collinear overlap
      [
        [2, 0],
        [5, 0],
      ], // collinear through the end (one overlap end inside)
    ] as const)
      expect(await edit(lines(4, b0, b1), "split")).toEqual(
        failure("edit-no-crossing", SPLIT_NO_CROSSING_MESSAGE),
      );
  });

  test("review R-1: a Split crossing closer than the modeling tolerance (1e-3) to an end leaves a sub-tolerance piece: no crossing, as today; 2e-3 away splits", async () => {
    expect(lines(4, [2, -1], [2, 1]).build().modelingTolerance).toBe(1e-3);
    for (const x of [4 - 1e-9, 4 - 1e-4, 1e-4, 1e-9])
      expect(
        await edit(lines(4, [x, -1], [x, 1]), "split"),
        `crossing at x = ${x}`,
      ).toEqual(failure("edit-no-crossing", SPLIT_NO_CROSSING_MESSAGE));
    for (const x of [4 - 2e-3, 2e-3]) {
      const result = verified(await edit(lines(4, [x, -1], [x, 1]), "split"));
      expect(result.cuts[0]!.position).toEqual([x, 0]);
    }
  });

  test("split: only the boundary cuts (other curves are not cutters); a boundary end on the target is tied coincident (R-2)", async () => {
    const sketch = lines(4, [2, 0], [2, 1]);
    sketch.point("o0", 1, -1);
    sketch.point("o1", 1, 1);
    sketch.line("other", "o0", "o1");
    const result = verified(await edit(sketch, "split"));
    expect(result.cuts).toHaveLength(1);
    expect(result.cuts[0]!.position).toEqual([2, 0]);
    expect(result.cuts[0]!.cutters).toEqual([
      {
        entityId: entity("boundary"),
        tie: { kind: "coincident", pointId: point("b0") },
      },
    ]);
  });

  test("split R-3 data: a target pointOnCurve that produced the cut belongs to it; one away from it does not", async () => {
    const sketch = lines(4, [2, 0], [2, 1]);
    const atCut = sketch.pointOnCurve("b0", "target");
    sketch.point("p", 3, 0);
    sketch.point("q", 3, 1);
    sketch.line("other", "p", "q");
    const away = sketch.pointOnCurve("p", "target");
    const result = verified(await edit(sketch, "split"));
    expect(result.cuts).toHaveLength(1);
    expect(result.incidences).toEqual([
      { constraintId: atCut, pointId: point("b0"), parameter: 0.5, cut: 0 },
      { constraintId: away, pointId: point("p"), parameter: 0.75, cut: null },
    ]);
  });

  test("unsupported kinds keep today's messages", async () => {
    const arcTarget = makeSketchFixture();
    arcTarget.point("c", 0, 0);
    arcTarget.point("a", 1, 0);
    arcTarget.point("b", 0, 1);
    arcTarget.arc("target", "c", "a", "b");
    arcTarget.point("b0", 3, -1);
    arcTarget.point("b1", 3, 1);
    arcTarget.line("boundary", "b0", "b1");
    const circleBoundary = makeSketchFixture();
    circleBoundary.point("t0", 0, 0);
    circleBoundary.point("t1", 4, 0);
    circleBoundary.line("target", "t0", "t1");
    circleBoundary.point("c", 2, 0);
    circleBoundary.circle("boundary", "c", 1);
    for (const sketch of [arcTarget, circleBoundary]) {
      expect(await edit(sketch, "extend")).toMatchObject({
        kind: "failed",
        code: "edit-target-unsupported",
        message: EXTEND_TARGET_UNSUPPORTED_MESSAGE,
      });
      expect(await edit(sketch, "split")).toMatchObject({
        kind: "failed",
        code: "edit-target-unsupported",
        message: SPLIT_TARGET_UNSUPPORTED_MESSAGE,
      });
    }
  });
});

// Review A-1: a Trim refuses a kept piece shorter than the modeling
// tolerance (the solver's minimum segment length; arcs by chord).
describe("Trim kept-piece length (T10g-2 review A-1)", () => {
  const tooShort = (target: string) => ({
    kind: "failed",
    code: "edit-piece-too-short",
    message: `Trim would leave a piece of ${target} shorter than the modeling tolerance (0.001). Nothing was changed.`,
    entityIds: [entity(target)],
    nonAcceptedNearTarget: [],
  });

  test("a line: a cut within 1e-3 of either end refuses; 2e-3 away trims", async () => {
    for (const xs of [
      [1e-4, 3],
      [1, 4 - 1e-4],
      [1, 4 - 1e-9],
    ])
      expect(await trim(lineWithCutters(xs), "target"), `cuts ${xs}`).toEqual(
        tooShort("target"),
      );
    const kept = verified(
      await trim(lineWithCutters([2e-3, 4 - 2e-3]), "target"),
    );
    expect(kept.cuts.map((cut) => cut.position)).toEqual([
      [2e-3, 0],
      [4 - 2e-3, 0],
    ]);
  });

  /** Arc (2,0)→(0,2) ccw about the origin, crossed by verticals at `xs`. */
  function arcWithCutters(xs: readonly number[]) {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.point("a", 2, 0);
    sketch.point("b", 0, 2);
    sketch.arc("target", "c", "a", "b");
    xs.forEach((x, index) => {
      sketch.point(`v${index}a`, x, 0.5);
      sketch.point(`v${index}b`, x, 3);
      sketch.line(`v${index}`, `v${index}a`, `v${index}b`);
    });
    return sketch;
  }

  test("an arc: a kept piece whose chord is under 1e-3 refuses; 2e-3 trims", async () => {
    expect(await trim(arcWithCutters([1, 1e-4]), "target")).toEqual(
      tooShort("target"),
    );
    verified(await trim(arcWithCutters([1, 2e-3]), "target"));
  });

  /** Circle r = 2 at the origin, crossed near its top by short verticals at `xs`. */
  function circleWithCutters(xs: readonly number[]) {
    const sketch = makeSketchFixture();
    sketch.point("c", 0, 0);
    sketch.circle("target", "c", 2);
    xs.forEach((x, index) => {
      sketch.point(`v${index}a`, x, 1.9);
      sketch.point(`v${index}b`, x, 2.1);
      sketch.line(`v${index}`, `v${index}a`, `v${index}b`);
    });
    return sketch;
  }

  test("a circle: a kept arc (first to last cut) whose chord is under 1e-3 refuses; 1e-2 trims", async () => {
    expect(await trim(circleWithCutters([0, 1e-4]), "target")).toEqual(
      tooShort("target"),
    );
    verified(await trim(circleWithCutters([0, 1e-2]), "target"));
  });

  // T10g-3b (brief item 6): a spline piece is measured by the polyline
  // through its fit points (its ends and every kept knot), a lower bound
  // of its curve length.
  test("an open spline: a kept end piece whose fit-point polyline is under 1e-3 refuses; 2e-3 trims", async () => {
    const openSpline = (x: number) => {
      const sketch = makeSketchFixture();
      sketch.point("s0", 0, 0);
      sketch.point("s1", 2, 3);
      sketch.point("s2", 4, 0);
      sketch.spline("target", ["s0", "s1", "s2"], "open");
      [x, 3].forEach((at, index) => {
        sketch.point(`v${index}a`, at, -1);
        sketch.point(`v${index}b`, at, 5);
        sketch.line(`v${index}`, `v${index}a`, `v${index}b`);
      });
      return sketch;
    };
    expect(await trim(openSpline(1e-4), "target")).toEqual(tooShort("target"));
    const kept = verified(await trim(openSpline(2e-3), "target"));
    expect(Math.abs(kept.cuts[0]!.position[0] - 2e-3)).toBeLessThan(1e-15);
  });

  test("a smooth closed spline: a kept piece [c₁, c₂] whose fit-point polyline is under 1e-3 refuses; 1e-2 trims", async () => {
    const closedSpline = (x: number) => {
      const sketch = makeSketchFixture();
      sketch.point("p0", 2, 0);
      sketch.point("p1", 0, 2);
      sketch.point("p2", -2, 0);
      sketch.point("p3", 0, -2);
      sketch.spline("target", ["p0", "p1", "p2", "p3"], "smooth");
      [x, 0].forEach((at, index) => {
        sketch.point(`v${index}a`, at, 1.9);
        sketch.point(`v${index}b`, at, 2.1);
        sketch.line(`v${index}`, `v${index}a`, `v${index}b`);
      });
      return sketch;
    };
    expect(await trim(closedSpline(1e-4), "target")).toEqual(
      tooShort("target"),
    );
    const kept = verified(await trim(closedSpline(1e-2), "target"));
    expect(kept.cuts.map((cut) => cut.knotOccurrenceIndex)).toEqual([null, 1]);
  });
});
