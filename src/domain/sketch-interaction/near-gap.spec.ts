// Lane: logic (docs/testing.md). Seam: `findNearGapEndpoints`,
// `findSketchNearGapAt` and `getSketchNearGapBasis` (T13k, D26, review R1):
// a sketch definition, its solve, its display positions and a screen
// projection in; the near-gap pairs out.
import { describe, expect, test } from "vitest";

import type {
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  ConstraintStatusRecord,
  SketchDefinition,
  SketchPoint2D,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { sketchSnapshotRecordForTest } from "@/contracts/sketch/region-record.fixtures";
import {
  createSketchSessionFromSnapshot,
  type SketchSessionState,
} from "@/domain/editor/sketch-session";
import { updateSketchReferenceProjection } from "@/domain/editor/sketch-session/references";
import {
  createStandardPlaneDefinition,
  OCC_KERNEL_SETTINGS,
} from "@/domain/modeling/opencascade-kernel-seed";
import {
  FIXTURE_SKETCH_ID,
  FIXTURE_TOLERANCE,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  appendDefinition,
  createSessionCommitFactories,
} from "@/domain/editor/sketch-session/internals";
import { createSketchDerivedTransformContribution } from "@/domain/sketch-editing/operations";
import {
  findNearGapEndpoints,
  findSketchNearGapAt,
  getSketchNearGapBasis,
} from "@/domain/sketch-interaction/near-gap";
import { SKETCH_POINT_RADII_PX } from "@/domain/sketch-interaction/screen-radii";

const pid = (name: string) => `sketch_point_${name}` as SketchPointId;
const eid = (name: string) => `sketch_entity_${name}` as SketchEntityId;

/** `pxPerUnit` screen px per sketch unit; y flips like a screen. */
const projection =
  (pxPerUnit: number) =>
  ([x, y]: SketchPoint2D) => ({ x: x * pxPerUnit, y: -y * pxPerUnit });

const positions = (definition: SketchDefinition) =>
  new Map(definition.points.map((point) => [point.pointId, point.position]));

/**
 * A solved snapshot of `definition` whose constraints are all satisfied,
 * except those given in `statuses` (`declaredJoinClasses` reads only the
 * constraint statuses).
 */
function solve(
  definition: SketchDefinition,
  statuses: Record<string, ConstraintStatusRecord["status"]> = {},
): SolvedSketchSnapshot {
  return {
    schemaVersion: "solved-sketch/v1alpha2",
    status: { solveState: "solved", constraintState: "wellConstrained" },
    solvedEntities: [],
    solvedPoints: [],
    constraintStatuses: definition.constraints.map((constraint) => ({
      constraintId: constraint.constraintId,
      status: statuses[constraint.constraintId] ?? "satisfied",
    })),
    dimensionStatuses: [],
    diagnostics: [],
  };
}

function gaps(
  definition: SketchDefinition,
  pxPerUnit = 100,
  solved: SolvedSketchSnapshot | null = solve(definition),
) {
  return findNearGapEndpoints(
    definition,
    solved,
    positions(definition),
    projection(pxPerUnit),
  ).map((gap) => ({
    pair: [gap.a.pointId, gap.b.pointId],
    distancePx: gap.distancePx,
  }));
}

/** Line ab (0,0)→(4,0) and line cd starting `gap` units right of b. */
function twoLines(gap: number) {
  const f = makeSketchFixture();
  f.point("a", 0, 0);
  f.point("b", 4, 0);
  f.point("c", 4 + gap, 0);
  f.point("d", 4 + gap, 3);
  f.line("ab", "a", "b");
  f.line("cd", "c", "d");
  return f;
}

describe("findNearGapEndpoints (T13k, D26)", () => {
  test("two open ends of different curves within 12 px are a near gap; the threshold is the 12 px point radius", () => {
    expect(SKETCH_POINT_RADII_PX.enter).toBe(12);
    expect(gaps(twoLines(0.05).definition())).toEqual([
      { pair: [pid("b"), pid("c")], distancePx: expect.closeTo(5, 9) },
    ]);
    const gap = findNearGapEndpoints(
      twoLines(0.05).definition(),
      solve(twoLines(0.05).definition()),
      positions(twoLines(0.05).definition()),
      projection(100),
    )[0]!;
    expect(gap.a).toEqual({
      pointId: pid("b"),
      entityId: eid("ab"),
      role: "end",
      screen: { x: 400, y: -0 },
    });
    expect(gap.b.entityId).toBe(eid("cd"));
    expect(gap.b.role, "review Q3: c is the start of cd").toBe("start");
  });

  test("the threshold is in screen px: one gap at two scales", () => {
    const definition = twoLines(0.1).definition();
    expect(gaps(definition, 100), "0.1 units at 100 px/unit = 10 px").toEqual([
      { pair: [pid("b"), pid("c")], distancePx: expect.closeTo(10, 9) },
    ]);
    expect(gaps(definition, 200), "the same gap zoomed in is 20 px").toEqual(
      [],
    );
    const exact = twoLines(0.125).definition();
    expect(
      gaps(exact, 96),
      "exactly 12 px (0.125 × 96) is still within",
    ).toEqual([{ pair: [pid("b"), pid("c")], distancePx: 12 }]);
    expect(gaps(exact, 97), "just past 12 px is not").toEqual([]);
    expect(
      findNearGapEndpoints(
        definition,
        solve(definition),
        positions(definition),
        projection(200),
        24,
      ),
      "an explicit threshold is honoured",
    ).toHaveLength(1);
  });

  test("distance 0 is a gap: two distinct points at one position that are not joined", () => {
    expect(gaps(twoLines(0).definition())).toEqual([
      { pair: [pid("b"), pid("c")], distancePx: 0 },
    ]);
  });

  test("ends joined by a shared point id are not open ends", () => {
    const f = makeSketchFixture();
    f.point("a", 0, 0);
    f.point("b", 4, 0);
    f.point("d", 4, 3);
    f.point("e", 4.01, 0.01);
    f.line("ab", "a", "b");
    f.line("bd", "b", "d");
    f.line("de", "d", "e");
    // b is shared (used by two curves): not open, so e (an open end next
    // to it) has no partner there.
    expect(gaps(f.definition())).toEqual([]);
  });

  test("ends in one declared coincident class are joined, also through a chain", () => {
    const direct = twoLines(0.01);
    direct.coincident("b", "c");
    expect(gaps(direct.definition())).toEqual([]);

    const f = twoLines(0.01);
    f.point("x", 4, 0);
    f.point("y", 9, 9);
    f.line("xy", "x", "y");
    f.coincident("b", "x");
    f.coincident("x", "c");
    // b~x~c: no pair inside the class. x is an open end of xy, joined too.
    expect(gaps(f.definition())).toEqual([]);

    const premise = twoLines(0.01);
    premise.coincident("a", "d");
    expect(
      gaps(premise.definition()),
      "a coincident between other points does not join b and c",
    ).toHaveLength(1);
  });

  test("construction curves have no open ends and do not join a real end", () => {
    const f = makeSketchFixture();
    f.point("a", 0, 0);
    f.point("b", 4, 0);
    f.point("c", 4.01, 0);
    f.point("d", 4.01, 3);
    f.line("ab", "a", "b");
    f.line("cd", "c", "d", true);
    expect(gaps(f.definition()), "c is only a construction end").toEqual([]);

    const g = twoLines(0.01);
    g.point("z", 9, 9);
    g.line("bz", "b", "z", true);
    expect(
      gaps(g.definition()),
      "b also ends a construction line: still one real curve, still open",
    ).toEqual([
      { pair: [pid("b"), pid("c")], distancePx: expect.closeTo(1, 9) },
    ]);
  });

  test("the two ends of one curve are never paired", () => {
    const f = makeSketchFixture();
    f.point("a", 0, 0);
    f.point("b", 0.01, 0);
    f.line("ab", "a", "b");
    expect(gaps(f.definition())).toEqual([]);

    const s = makeSketchFixture();
    for (const [name, x, y] of [
      ["s0", 0, 0],
      ["s1", 3, 0],
      ["s2", 3, 3],
      ["s3", 0.02, 0.01],
    ] as const)
      s.point(name, x, y);
    s.spline("loop", ["s0", "s1", "s2", "s3"], "open");
    expect(gaps(s.definition()), "nor an open spline's own ends").toEqual([]);
  });

  test("arc and open-spline ends count; centres and interior fit points do not", () => {
    const f = makeSketchFixture();
    f.point("o", 0, 0);
    f.point("p", 2, 0);
    f.point("q", 0, 2);
    f.arc("arc", "o", "p", "q");
    f.point("s0", 2.01, 0);
    f.point("s1", 5, 1);
    f.point("s2", 8, 0);
    f.spline("wave", ["s0", "s1", "s2"], "open");
    f.point("l0", 0.01, 0.01);
    f.point("l1", -3, -3);
    f.point("m0", 5, 1.01);
    f.point("m1", 9, 9);
    f.line("l", "l0", "l1");
    f.line("m", "m0", "m1");
    // p (arc end) ~ s0 (spline end): a gap. l0 near the arc centre o and
    // m0 near the interior fit point s1: no partner there.
    expect(gaps(f.definition())).toEqual([
      { pair: [pid("p"), pid("s0")], distancePx: expect.closeTo(1, 9) },
    ]);
  });

  test("Point-tool points, projected points and off-screen ends are excluded", () => {
    // A Point-tool point placed on c, an otherwise open line end.
    const definition = twoLines(0.01).definition();
    expect(gaps(definition), "premise: b~c without it").toHaveLength(1);
    const withDot: SketchDefinition = {
      ...definition,
      entityIds: [...definition.entityIds, eid("dot")],
      entities: [
        ...definition.entities,
        {
          kind: "point",
          entityId: eid("dot"),
          label: "dot",
          target: {
            kind: "sketchEntity",
            sketchId: FIXTURE_SKETCH_ID as SketchId,
            entityId: eid("dot"),
          },
          isConstruction: false,
          pointId: pid("c"),
        },
      ],
    };
    expect(gaps(withDot), "a Point-tool point is not an open end").toEqual([]);

    const p = twoLines(5);
    p.project("edge", [
      {
        geometryId: "g_point",
        kind: "point",
        position: [4.01, 0],
      } as never,
    ]);
    expect(
      gaps(p.definition()),
      "a projected point is not a local point",
    ).toEqual([]);

    const near = twoLines(0.01).definition();
    expect(
      findNearGapEndpoints(near, solve(near), positions(near), (point) =>
        point[0] > 3.5 && point[1] === 0 && point[0] < 4.005
          ? null
          : projection(100)(point),
      ),
      "an end that does not project (behind the camera) has no gap",
    ).toEqual([]);
  });

  test("driven points (a derived relationship's outputs) are excluded", () => {
    const f = makeSketchFixture();
    f.point("p", 0, 0);
    f.point("q", 4, 0);
    f.point("u", 8.01, 0);
    f.point("v", 8.01, 3);
    f.line("pq", "p", "q");
    f.line("uv", "u", "v");
    const definition = f.definition();
    const contribution = createSketchDerivedTransformContribution({
      definition,
      operatorKind: "linearPattern",
      entityIds: [eid("pq")],
      value: 4,
      sequence: 50,
      factories: createSessionCommitFactories(
        50,
        FIXTURE_SKETCH_ID as SketchId,
      ),
      modelingTolerance: FIXTURE_TOLERANCE,
      documentVariables: [],
    });
    expect(contribution.valid, contribution.message ?? "").toBe(true);
    const patterned = appendDefinition(definition, contribution.contribution!);
    const outputPointIds = patterned.derivedRelationships![0]!.outputs.flatMap(
      (output) => output.outputPointIds,
    );
    expect(outputPointIds.length, "premise: outputs exist").toBeGreaterThan(0);
    // Display positions: the pattern copy pq' sits at x 4→8 (outputs at the
    // copy ends), so its end lies 0.01 from u and its start on q.
    const display = positions(patterned);
    const copy = patterned.derivedRelationships![0]!.outputs[0]!;
    copy.outputPointIds.forEach((pointId, index) => {
      const seed = display.get(copy.seedPointIds[index]!)!;
      display.set(pointId, [seed[0] + 4, seed[1]]);
    });
    expect(
      findNearGapEndpoints(
        patterned,
        solve(patterned),
        display,
        projection(100),
      ),
      "no gap involves a driven point",
    ).toEqual([]);
  });
});

describe("joined means the topology owner's declared join classes (T13k review R1)", () => {
  test("an unsatisfied or blocked coincident does not join: the gap is shown", () => {
    const f = twoLines(0.05);
    const coincident = f.coincident("b", "c");
    const definition = f.definition();
    expect(
      gaps(definition),
      "premise: satisfied, the coincident joins",
    ).toEqual([]);
    for (const status of ["unsatisfied", "conflicting", "blocked"] as const)
      expect(
        gaps(definition, 100, solve(definition, { [coincident]: status })),
        `a ${status} coincident is not a join`,
      ).toEqual([
        { pair: [pid("b"), pid("c")], distancePx: expect.closeTo(5, 9) },
      ]);
  });

  test("two ends each satisfied-coincident with the origin, or with one projected point, are joined", () => {
    const toTarget = (
      id: string,
      point: string,
      target: Extract<
        ConstraintDefinition,
        { kind: "coincidentProjectedPoint" }
      >["projectedPoint"],
    ): ConstraintDefinition => ({
      constraintId: id as ConstraintDefinition["constraintId"],
      kind: "coincidentProjectedPoint",
      label: id,
      point: { kind: "localPoint", pointId: pid(point) },
      projectedPoint: target,
    });
    const withConstraints = (constraints: ConstraintDefinition[]) => {
      const definition = twoLines(0).definition();
      return {
        ...definition,
        constraintIds: constraints.map((constraint) => constraint.constraintId),
        constraints,
      };
    };
    const origin = { kind: "sketchDatum", datum: "origin" } as const;
    const atOrigin = withConstraints([
      toTarget("constraint_o1", "b", origin),
      toTarget("constraint_o2", "c", origin),
    ]);
    expect(gaps(atOrigin), "both on the origin: one class").toEqual([]);
    expect(
      gaps(atOrigin, 100, solve(atOrigin, { constraint_o2: "unsatisfied" })),
      "premise: one unsatisfied, they are not joined (distance 0 gap)",
    ).toEqual([{ pair: [pid("b"), pid("c")], distancePx: 0 }]);

    const projected = (geometryId: string) =>
      ({
        kind: "projectedGeometry",
        reference: {
          kind: "projectedPoint",
          referenceId: "ref_edge",
          geometryId,
        },
      }) as unknown as Extract<
        ConstraintDefinition,
        { kind: "coincidentProjectedPoint" }
      >["projectedPoint"];
    expect(
      gaps(
        withConstraints([
          toTarget("constraint_p1", "b", projected("g_vertex")),
          toTarget("constraint_p2", "c", projected("g_vertex")),
        ]),
      ),
      "both on one projected point: one class",
    ).toEqual([]);
    expect(
      gaps(
        withConstraints([
          toTarget("constraint_p1", "b", projected("g_vertex")),
          toTarget("constraint_p2", "c", projected("g_other")),
        ]),
      ),
      "on two different projected points: not joined",
    ).toHaveLength(1);
  });

  test("without a solve nothing is reported", () => {
    const definition = twoLines(0.05).definition();
    expect(gaps(definition), "premise: solved, a gap").toHaveLength(1);
    expect(gaps(definition, 100, null)).toEqual([]);
  });

  test("getSketchNearGapBasis: only the accepted live solve of the current definition", () => {
    const open = (build: (f: ReturnType<typeof twoLines>) => void) => {
      const f = twoLines(0.05);
      build(f);
      return updateSketchReferenceProjection(
        createSketchSessionFromSnapshot(
          sketchSnapshotRecordForTest(
            f.build(),
            [],
            createStandardPlaneDefinition("xy"),
          ),
          OCC_KERNEL_SETTINGS,
        ),
        [],
        [],
      );
    };
    const accepted = open(() => undefined);
    expect(accepted.liveSolve?.accepted, "premise").toBe(true);
    expect(getSketchNearGapBasis(accepted)).toEqual({
      definition: accepted.definition,
      solved: accepted.liveSolve!.solvedSnapshot,
    });

    const conflicting = open((f) => {
      f.lineLength("ab", 2);
      f.lineLength("ab", 9);
    });
    expect(conflicting.liveSolve?.accepted, "premise: invalid").toBe(false);
    expect(getSketchNearGapBasis(conflicting), "not solved: none").toBeNull();

    const stale: SketchSessionState = {
      ...accepted,
      definition: { ...accepted.definition },
    };
    expect(
      getSketchNearGapBasis(stale),
      "a solve of another definition is not current: none",
    ).toBeNull();
    expect(getSketchNearGapBasis({ ...accepted, liveSolve: null })).toBeNull();
  });
});

describe("findSketchNearGapAt (T13k)", () => {
  test("the nearest partner of an end, oriented from that end", () => {
    const f = twoLines(0.08);
    f.point("e", 4.03, 0);
    f.point("g", 4.03, -3);
    f.line("eg", "e", "g");
    const definition = f.definition();
    const all = findNearGapEndpoints(
      definition,
      solve(definition),
      positions(definition),
      projection(100),
    );
    expect(all.map((gap) => [gap.a.pointId, gap.b.pointId])).toEqual([
      [pid("b"), pid("c")],
      [pid("b"), pid("e")],
      [pid("c"), pid("e")],
    ]);
    const atB = findSketchNearGapAt(all, pid("b"));
    expect(atB?.end.pointId).toBe(pid("b"));
    expect(atB?.partner.pointId, "e (3 px) beats c (8 px)").toBe(pid("e"));
    expect(findSketchNearGapAt(all, pid("c"))?.partner.pointId).toBe(pid("e"));
    expect(findSketchNearGapAt(all, pid("a"))).toBeNull();
  });
});
