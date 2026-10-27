import { sketchDraggedPointHasFreeDof } from "./free-dof";
import {
  at,
  AXIS,
  coincident,
  coincidentAxisEnd,
  derivedMirrorAxis,
  derivedOffsetAxis,
  distance,
  dragBy,
  dragPoint,
  eid,
  fixPoint,
  freeAxis,
  horizontal,
  line,
  lineAndCircle,
  lineLength,
  MECHANISM_TOLERANCES,
  mirror,
  pid,
  point,
  pointDistance,
  pointEntity,
  reflectAcross,
  reflectY0,
  RELEASE_TOLERANCE,
  sketch,
  solve,
  solvedPoint,
  startSession,
  TAU,
} from "./mirror.fixtures";
import { updateCompiledSketchSolveSession } from "./update-session";
import type {
  DocumentId,
  RequestId,
  RevisionId,
  SketchId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { MIRROR_DIAGNOSTIC_CODES } from "@/contracts/sketch/mirror-requirements";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  MockSketchSolverAdapter,
} from "@/domain/solver/mock-sketch-solver-adapter";
import { describe, expect, test } from "vitest";

describe("T15c axis preference (issue 15; [TECH] T-6 + R-7): drag frames keep a mirror axis bitwise unless the frame cannot be accepted with it", () => {
  test("AX1 (probe 6a): dragging the copy away from a free axis moves only the seed; the axis is bitwise unchanged and the copy reaches the cursor", () => {
    const session = startSession(freeAxis());
    const start = session.lastAcceptedSnapshot;
    const ma = solvedPoint(start, "ma");
    const cursor: SketchPoint2D = [ma[0], ma[1] - 1.5];
    const { preview, release, snapshot } = dragPoint(session, "ma", cursor);
    expect([preview.kind, release.kind]).toEqual(["solved", "solved"]);
    expect(at(preview.solvedSnapshot!, AXIS)).toEqual(at(start, AXIS));
    expect(at(snapshot, AXIS)).toEqual(at(start, AXIS));
    expect(distance(solvedPoint(snapshot, "ma"), cursor)).toBeLessThanOrEqual(
      RELEASE_TOLERANCE,
    );
    // Minimum motion: only the seed point follows (reciprocally).
    expect(at(snapshot, ["b", "mb", "c", "mc"])).toEqual(
      at(start, ["b", "mb", "c", "mc"]),
    );
    expect(solvedPoint(snapshot, "a")).toEqual(
      reflectY0(solvedPoint(snapshot, "ma")),
    );
  });

  test("AX2 (probes 6b, 6f): dragging the copy along a free axis, and with an axis constrained horizontal, keeps the axis bitwise", () => {
    for (const definition of [
      freeAxis(),
      freeAxis([horizontal("axis_h", "axis")]),
    ]) {
      const session = startSession(definition);
      const start = session.lastAcceptedSnapshot;
      const ma = solvedPoint(start, "ma");
      for (const cursor of [
        [ma[0] + 1.5, ma[1]],
        [ma[0], ma[1] - 1.5],
      ] as const) {
        const { release, snapshot } = dragPoint(session, "ma", cursor);
        expect(release.kind).toBe("solved");
        expect(at(snapshot, AXIS)).toEqual(at(start, AXIS));
        expect(
          distance(solvedPoint(snapshot, "ma"), cursor),
        ).toBeLessThanOrEqual(RELEASE_TOLERANCE);
      }
    }
  });

  test("AX3 (probe 6g, Q2): with the seed fixed the copy cannot follow: the frame is accepted with the cursor lagging, the axis stays, and the copy has no free DOF (the T12f constrained cue)", () => {
    const session = startSession(freeAxis([fixPoint("fa", "a", [1, 1])]));
    const start = session.lastAcceptedSnapshot;
    const ma = solvedPoint(start, "ma");
    const cursor: SketchPoint2D = [ma[0], ma[1] - 1.5];
    const { preview, release, snapshot } = dragPoint(session, "ma", cursor);
    expect([preview.kind, release.kind]).toEqual(["solved", "solved"]);
    expect(at(snapshot, AXIS)).toEqual(at(start, AXIS));
    expect(distance(solvedPoint(snapshot, "ma"), ma)).toBeLessThan(1e-3);
    expect(distance(solvedPoint(snapshot, "ma"), cursor)).toBeGreaterThan(1.49);
    expect(sketchDraggedPointHasFreeDof(session, pid("ma"))).toBe(false);
  });

  test("AX4 (review S1): a constrained slide (seed horizontal, one end fixed) is accepted with the cursor lagging and the axis bitwise; the copy slides only along its remaining DOF", () => {
    const base = lineAndCircle();
    const definition = sketch({
      ...base,
      points: base.points.map((entry) =>
        entry.pointId === pid("a") ? point("a", [1, 2]) : entry,
      ),
      constraints: [
        horizontal("u_h", "u"),
        horizontal("ab_h", "ab"),
        fixPoint("fb", "b", [3, 2]),
      ],
    });
    const session = startSession(definition);
    const start = session.lastAcceptedSnapshot;
    const ma = solvedPoint(start, "ma");
    const cursor: SketchPoint2D = [ma[0] - 0.5, ma[1] - 1];
    const { release, snapshot } = dragPoint(session, "ma", cursor);
    expect(release.kind).toBe("solved");
    expect(at(snapshot, AXIS)).toEqual(at(start, AXIS));
    const moved = solvedPoint(snapshot, "ma");
    expect(moved[0]).toBeCloseTo(ma[0] - 0.5, 3);
    expect(moved[1]).toBeCloseTo(ma[1], 6);
    expect(distance(moved, cursor)).toBeGreaterThan(0.99);
    // A slide keeps a free DOF, so T12f shows no cue (unchanged for slides).
    expect(sketchDraggedPointHasFreeDof(session, pid("ma"))).toBe(true);
  });

  test("AX5 (control, green on base; explicit axis drags): an axis endpoint drag and an axis body drag move the axis; the seeds stay bitwise and the copies follow as their reflection across the moved axis", () => {
    const endpoint = startSession(freeAxis());
    const start = endpoint.lastAcceptedSnapshot;
    const seeds = ["a", "b", "c"] as const;
    const endpointDrag = dragPoint(endpoint, "x1", [6, 1]);
    // The preview frame (no exact-reach step) already moves the axis.
    expect(
      distance(solvedPoint(endpointDrag.preview.solvedSnapshot!, "x1"), [6, 1]),
    ).toBeLessThan(1e-3);
    const byEndpoint = endpointDrag.snapshot;
    expect(distance(solvedPoint(byEndpoint, "x1"), [6, 1])).toBeLessThanOrEqual(
      RELEASE_TOLERANCE,
    );
    const body = startSession(freeAxis());
    const byBody = updateCompiledSketchSolveSession(
      body,
      {
        kind: "sketchTranslate",
        pointIds: [pid("x0"), pid("x1")],
        delta: [0, 0.5],
      },
      RELEASE_TOLERANCE,
    ).solvedSnapshot!;
    expect(solvedPoint(byBody, "x0")[1]).toBeCloseTo(0.5, 6);
    expect(solvedPoint(byBody, "x1")[1]).toBeCloseTo(0.5, 6);
    for (const snapshot of [byEndpoint, byBody]) {
      expect(at(snapshot, seeds)).toEqual(at(start, seeds));
      const [x0, x1] = [
        solvedPoint(snapshot, "x0"),
        solvedPoint(snapshot, "x1"),
      ];
      for (const [seed, copy] of [
        ["a", "ma"],
        ["b", "mb"],
        ["c", "mc"],
      ] as const) {
        const expected = reflectAcross(solvedPoint(snapshot, seed), x0, x1);
        const actual = solvedPoint(snapshot, copy);
        expect(actual[0]).toBeCloseTo(expected[0], 9);
        expect(actual[1]).toBeCloseTo(expected[1], 9);
      }
    }
  });

  test("AX6 (control, green on base; explicit axis drag through a shared point): a seed end that is the axis end itself drags the axis; the copy end on it follows", () => {
    const definition = sketch({
      points: [
        point("a", [1, 1]),
        point("x0", [-1, 0]),
        point("x1", [6, 0]),
        point("ma", [0, 0]),
        point("mx", [0, 0]),
      ],
      entities: [
        line("ax", "a", "x1"),
        line("axis", "x0", "x1"),
        line("max", "ma", "mx"),
      ],
      relationships: [
        mirror("m", "axis", [["ax", "max", ["a", "x1"], ["ma", "mx"]]]),
      ],
    });
    const session = startSession(definition);
    const start = session.lastAcceptedSnapshot;
    const { preview, snapshot } = dragPoint(session, "x1", [6, 1]);
    expect(
      distance(solvedPoint(preview.solvedSnapshot!, "x1"), [6, 1]),
    ).toBeLessThan(1e-3);
    expect(distance(solvedPoint(snapshot, "x1"), [6, 1])).toBeLessThanOrEqual(
      RELEASE_TOLERANCE,
    );
    expect(at(snapshot, ["a", "x0"])).toEqual(at(start, ["a", "x0"]));
    const mx = solvedPoint(snapshot, "mx");
    expect(mx[0]).toBeCloseTo(6, 9);
    expect(mx[1]).toBeCloseTo(1, 9);
  });

  test("AX7 (datum axis): a copy about the X datum drags its seed reciprocally and reaches the cursor; the reflection is about y = 0 exactly", () => {
    const definition = sketch({
      points: [
        point("a", [1, 1]),
        point("b", [3, 2]),
        point("ma", [0, 0]),
        point("mb", [0, 0]),
      ],
      entities: [line("ab", "a", "b"), line("mab", "ma", "mb")],
      relationships: [
        mirror("m", { datum: "xAxis" }, [
          ["ab", "mab", ["a", "b"], ["ma", "mb"]],
        ]),
      ],
    });
    const session = startSession(definition);
    const { release, snapshot } = dragPoint(session, "ma", [1, -2.5]);
    expect(release.kind).toBe("solved");
    expect(
      distance(solvedPoint(snapshot, "ma"), [1, -2.5]),
    ).toBeLessThanOrEqual(RELEASE_TOLERANCE);
    expect(solvedPoint(snapshot, "ma")).toEqual(
      reflectY0(solvedPoint(snapshot, "a")),
    );
    expect(solvedPoint(snapshot, "b")).toEqual([3, 2]);
  });

  test("AX8 (chains): dragging the last copy of a two-mirror chain moves only the seed; both axes (the upstream one included) stay bitwise", () => {
    const base = lineAndCircle();
    const definition = sketch({
      ...base,
      points: [
        ...base.points,
        point("y0", [8, -5]),
        point("y1", [8, 5]),
        point("na", [0, 0]),
        point("nb", [0, 0]),
      ],
      entities: [
        ...base.entities,
        line("axis2", "y0", "y1"),
        line("nab", "na", "nb"),
      ],
      relationships: [
        ...base.relationships,
        mirror("n", "axis2", [["mab", "nab", ["ma", "mb"], ["na", "nb"]]]),
      ],
      constraints: [horizontal("u_h", "u")],
    });
    const session = startSession(definition);
    const start = session.lastAcceptedSnapshot;
    const na = solvedPoint(start, "na");
    const cursor: SketchPoint2D = [na[0] + 0.5, na[1] - 1];
    const { release, snapshot } = dragPoint(session, "na", cursor);
    expect(release.kind).toBe("solved");
    const axes = ["x0", "x1", "y0", "y1"] as const;
    expect(at(snapshot, axes)).toEqual(at(start, axes));
    expect(distance(solvedPoint(snapshot, "na"), cursor)).toBeLessThanOrEqual(
      RELEASE_TOLERANCE,
    );
    expect(at(snapshot, ["b", "c"])).toEqual(at(start, ["b", "c"]));
    expect(
      distance(solvedPoint(snapshot, "a"), solvedPoint(start, "a")),
    ).toBeCloseTo(Math.hypot(0.5, 1), 6);
  });

  test("AX9 (continuity): a slow sweep of the copy onto its fixed partner's image never jumps: the axis stays bitwise until the seed line would collapse below τ, that one frame moves the axis (stage 2) by less than the cursor step, and later frames keep the moved axis", () => {
    const definition = sketch({
      points: [
        point("a", [1, 1]),
        point("b", [3, 2]),
        point("x0", [-1, 0]),
        point("x1", [6, 0]),
        point("ma", [0, 0]),
        point("mb", [0, 0]),
      ],
      entities: [
        line("ab", "a", "b"),
        line("axis", "x0", "x1"),
        line("mab", "ma", "mb"),
      ],
      relationships: [
        mirror("m", "axis", [["ab", "mab", ["a", "b"], ["ma", "mb"]]]),
      ],
      constraints: [fixPoint("fb", "b", [3, 2])],
    });
    const session = startSession(definition);
    const ids = ["a", "ma", "mb", "x0", "x1"] as const;
    let previous = at(session.lastAcceptedSnapshot, ids);
    const step = Math.hypot(2, 1) / 40;
    const axisMoves: number[] = [];
    for (let frame = 1; frame <= 50; frame += 1) {
      const t = frame / 40;
      const result = updateCompiledSketchSolveSession(
        session,
        {
          kind: "sketchPoint",
          pointId: pid("ma"),
          position: [1 + 2 * t, -1 - t],
        },
        null,
      );
      expect(result.kind).toBe("solved");
      const next = at(result.solvedSnapshot!, ids);
      for (const id of ids)
        expect(distance(previous[id]!, next[id]!)).toBeLessThanOrEqual(
          1.5 * step,
        );
      if (
        AXIS.some(
          (id) =>
            previous[id]![0] !== next[id]![0] ||
            previous[id]![1] !== next[id]![1],
        )
      )
        axisMoves.push(frame);
      previous = next;
    }
    // Frame 40 puts the cursor on R(b): with the axis kept, a = b.
    expect(axisMoves).toEqual([40]);
  });
  test("AX14 (control, green on base; no mirror axis in the component: stage 1 skipped): a drag of unrelated geometry in a mirrored sketch is bitwise the frame of the same sketch without the mirror relationship", () => {
    const mirrored = freeAxis();
    const plain = sketch({
      ...lineAndCircle(),
      points: evaluateSketchDerivations({
        definition: mirrored,
        modelingTolerance: TAU,
      }).definition.points,
      relationships: [],
      constraints: [horizontal("u_h", "u")],
    });
    const frames = [mirrored, plain].map((definition) => {
      const session = startSession(definition);
      return dragPoint(session, "u1", [12.5, 13]).snapshot;
    });
    expect(at(frames[0]!, ["u0", "u1"])).toEqual(at(frames[1]!, ["u0", "u1"]));
  });
});

describe("T15c batch axis preference: the axis stays unless a requirement forces it (component-local stage 2)", () => {
  test("AX10 (probes 10b, 12c; review A-4 C1): a dimension from the copy to unrelated geometry, a loop across the mirror and a seed point coincident with its own image solve with the axis bitwise; in C1 the point lands on the axis", () => {
    for (const [label, definition] of [
      [
        "10b",
        freeAxis(
          [fixPoint("fu0", "u0", [10, 10])],
          [pointDistance("ma_u0", "ma", "u0", 10)],
        ),
      ],
      ["12c", freeAxis([coincident("loop", "ma", "b")])],
      ["C1", freeAxis([coincident("self", "a", "ma")])],
    ] as const) {
      const { solvedSnapshot, status } = solve(definition);
      expect(status.solveState, label).toBe("solved");
      expect(at(solvedSnapshot, AXIS), label).toEqual({
        x0: [-1, 0],
        x1: [6, 0],
      });
    }
    const c1 = solve(freeAxis([coincident("self", "a", "ma")])).solvedSnapshot;
    const a = solvedPoint(c1, "a");
    expect(Math.abs(a[1])).toBeLessThanOrEqual(TAU);
    expect(distance(a, solvedPoint(c1, "ma"))).toBeLessThanOrEqual(TAU);
  });

  test("AX11 (control, green on base; probe 10b, seed fixed): a requirement that needs the axis to move solves in stage 2: the axis moves and the dimension is satisfied", () => {
    const { solvedSnapshot, status } = solve(
      freeAxis(
        [fixPoint("fu0", "u0", [10, 10]), fixPoint("fa", "a", [1, 1])],
        [pointDistance("ma_u0", "ma", "u0", 15)],
      ),
    );
    expect(status.solveState).toBe("solved");
    expect(
      solvedSnapshot.dimensionStatuses.map((entry) => entry.status),
    ).toEqual(["driving"]);
    expect(
      distance(
        solvedPoint(solvedSnapshot, "ma"),
        solvedPoint(solvedSnapshot, "u0"),
      ),
    ).toBeCloseTo(15, 2);
    expect(at(solvedSnapshot, AXIS)).not.toEqual({ x0: [-1, 0], x1: [6, 0] });
  });

  test("AX12 (component-local stage 2): in one sketch, a mirror whose requirement needs its axis moves only that axis; an independent mirror solvable with its axis kept stays bitwise", () => {
    const base = lineAndCircle();
    const definition = sketch({
      points: [
        ...base.points,
        point("p", [21, 1]),
        point("q", [23, 2]),
        point("z0", [20, -5]),
        point("z1", [20, 5]),
        point("mp", [0, 0]),
        point("mq", [0, 0]),
        point("w", [30, 0]),
      ],
      entities: [
        ...base.entities,
        line("pq", "p", "q"),
        line("axis2", "z0", "z1"),
        line("mpq", "mp", "mq"),
        pointEntity("w", "w"),
      ],
      relationships: [
        ...base.relationships,
        mirror("n", "axis2", [["pq", "mpq", ["p", "q"], ["mp", "mq"]]]),
      ],
      constraints: [
        horizontal("u_h", "u"),
        coincident("self", "a", "ma"),
        fixPoint("fp", "p", [21, 1]),
        fixPoint("fw", "w", [30, 0]),
      ],
      dimensions: [pointDistance("mp_w", "mp", "w", 6)],
    });
    const { solvedSnapshot, status } = solve(definition);
    expect(status.solveState).toBe("solved");
    expect(at(solvedSnapshot, AXIS)).toEqual({ x0: [-1, 0], x1: [6, 0] });
    expect(at(solvedSnapshot, ["z0", "z1"])).not.toEqual({
      z0: [20, -5],
      z1: [20, 5],
    });
    expect(
      distance(
        solvedPoint(solvedSnapshot, "mp"),
        solvedPoint(solvedSnapshot, "w"),
      ),
    ).toBeCloseTo(6, 2);
    // Stage 2 restarts that component from its start values: its result is
    // bitwise the same component solved alone (review A-2, R4).
    const alone = solve(
      sketch({
        points: definition.points.filter(
          (entry) => !base.points.includes(entry),
        ),
        entities: definition.entities.filter(
          (entry) => !base.entities.includes(entry),
        ),
        relationships: [
          mirror("n", "axis2", [["pq", "mpq", ["p", "q"], ["mp", "mq"]]]),
        ],
        constraints: [
          fixPoint("fp", "p", [21, 1]),
          fixPoint("fw", "w", [30, 0]),
        ],
        dimensions: [pointDistance("mp_w", "mp", "w", 6)],
      }),
    ).solvedSnapshot;
    const group = ["p", "q", "z0", "z1", "mp", "mq"] as const;
    expect(at(solvedSnapshot, group)).toEqual(at(alone, group));
  });
});

describe("T15c driven exact reach (T13a2 d1 for a mirror output target)", () => {
  test("AX13 (probe 6e): with a fixed axis the release frame pins a dragged copy at the cursor within the reach tolerance", () => {
    const session = startSession(
      freeAxis([fixPoint("fx0", "x0", [-1, 0]), fixPoint("fx1", "x1", [6, 0])]),
    );
    const ma = solvedPoint(session.lastAcceptedSnapshot, "ma");
    const cursor: SketchPoint2D = [ma[0], ma[1] - 1.5];
    const { release, snapshot } = dragPoint(session, "ma", cursor);
    expect(release.kind).toBe("solved");
    expect(distance(solvedPoint(snapshot, "ma"), cursor)).toBeLessThanOrEqual(
      RELEASE_TOLERANCE,
    );
  });

  test("AX15: the driven pin is kept only within the reach tolerance: a release 5e-4 from a copy whose seed is fixed (beyond twice the tolerance) keeps the frame, so the fixed seed is not traded for the cursor (a release within (tol, 2·tol] may split the gap: recorded, review A-1)", () => {
    const session = startSession(freeAxis([fixPoint("fa", "a", [1, 1])]));
    const ma = solvedPoint(session.lastAcceptedSnapshot, "ma");
    const { release, snapshot } = dragPoint(session, "ma", [
      ma[0],
      ma[1] - 5e-4,
    ]);
    expect(release.kind).toBe("solved");
    expect(distance(solvedPoint(snapshot, "a"), [1, 1])).toBeLessThan(1e-5);
    expect(at(snapshot, AXIS)).toEqual({ x0: [-1, 0], x1: [6, 0] });
  });
});

describe("T15c review fixes: a drag that requests the axis frees it; the freeze never kills a free drag", () => {
  test("AX16 (R-1a): a seed end in the same satisfied coincident class as an axis end drags the axis, like a shared point (preview and release reach, free DOF, no constrained cue); dragging the copy in the same sketch keeps the axis bitwise", () => {
    const seedEnd = dragBy(coincidentAxisEnd(), "b", [0.5, 1]);
    expect(seedEnd.kinds).toEqual(["solved", "solved"]);
    expect(seedEnd.previewLag).toBeLessThan(1e-3);
    expect(seedEnd.releaseLag).toBeLessThanOrEqual(RELEASE_TOLERANCE);
    expect(
      distance(
        solvedPoint(seedEnd.snapshot, "x1"),
        solvedPoint(seedEnd.snapshot, "b"),
      ),
    ).toBeLessThanOrEqual(TAU);
    expect(seedEnd.freeDof).toBe(true);
    const copy = dragBy(coincidentAxisEnd(), "ma", [0.5, -1]);
    expect(copy.kinds).toEqual(["solved", "solved"]);
    expect(at(copy.snapshot, AXIS)).toEqual(at(copy.start, AXIS));
  });

  test("AX17 (R-1b): a copy whose seed is the derived axis's own source (S mirrored across O = offset(S)) drags its seed and the axis with it (reach, free DOF); a copy of unrelated geometry keeps O bitwise", () => {
    const sourceCopy = dragBy(derivedOffsetAxis(true), "ms0", [0.3, -0.7]);
    expect(sourceCopy.kinds).toEqual(["solved", "solved"]);
    expect(sourceCopy.previewLag).toBeLessThan(1e-3);
    expect(sourceCopy.releaseLag).toBeLessThanOrEqual(RELEASE_TOLERANCE);
    expect(sourceCopy.freeDof).toBe(true);
    // Through a chain: the copy of that copy (across a second, free axis
    // A2) still has S as its source; O is released, A2 stays bitwise.
    const base = derivedOffsetAxis(true);
    const chained = sketch({
      points: [
        ...base.points,
        point("y0", [20, -5]),
        point("y1", [20, 5]),
        point("ns0", [0, 0]),
        point("ns1", [0, 0]),
      ],
      entities: [
        ...base.entities,
        line("A2", "y0", "y1"),
        line("NS", "ns0", "ns1"),
      ],
      relationships: [
        ...(base.derivedRelationships ?? []),
        mirror("n", "A2", [["MS", "NS", ["ms0", "ms1"], ["ns0", "ns1"]]]),
      ],
    });
    const chainCopy = dragBy(chained, "ns0", [0.3, -0.7]);
    expect(chainCopy.kinds).toEqual(["solved", "solved"]);
    expect(chainCopy.previewLag).toBeLessThan(1e-3);
    expect(chainCopy.releaseLag).toBeLessThanOrEqual(RELEASE_TOLERANCE);
    expect(chainCopy.freeDof).toBe(true);
    expect(at(chainCopy.snapshot, ["y0", "y1"])).toEqual(
      at(chainCopy.start, ["y0", "y1"]),
    );
    const other = dragBy(derivedOffsetAxis(true), "mc", [0.3, -0.7]);
    expect(other.releaseLag).toBeLessThanOrEqual(RELEASE_TOLERANCE);
    expect(at(other.snapshot, ["o0", "o1", "a", "b"])).toEqual(
      at(other.start, ["o0", "o1", "a", "b"]),
    );
  });

  test("AX18 (R-2, green on base, mutant-guarded: derived-axis exceptions): dragging the source of a derived axis (offset or mirror copy) and dragging a derived axis's own endpoint (a driven slot) move in the preview frame and keep a free DOF", () => {
    for (const [label, definition, id, delta] of [
      ["offset axis source", derivedOffsetAxis(false), "a", [0.3, -0.7]],
      ["mirror axis source", derivedMirrorAxis(), "a", [0.3, 0.7]],
      ["offset axis endpoint", derivedOffsetAxis(false), "o1", [0.3, -0.7]],
      ["mirror axis endpoint", derivedMirrorAxis(), "s1", [0.3, -0.7]],
    ] as const) {
      const drag = dragBy(definition, id, delta);
      expect(drag.kinds, label).toEqual(["solved", "solved"]);
      expect(drag.previewLag, label).toBeLessThan(1e-3);
      expect(drag.freeDof, label).toBe(true);
    }
  });

  test("AX19 (R-2: phase B keeps the freeze): with a seed–copy distance, dragging the copy perpendicular to the axis lags (phase A rejected, phase B projects) and the axis stays bitwise", () => {
    const drag = dragBy(
      freeAxis([], [pointDistance("a_ma", "a", "ma", 2)]),
      "ma",
      [0, -1],
    );
    expect(drag.kinds).toEqual(["solved", "solved"]);
    expect(at(drag.snapshot, AXIS)).toEqual(at(drag.start, AXIS));
  });

  test("AX20 (R-3, green on base, mutant-guarded: the stage-1 B4 re-solve keeps the freeze): a length on a free axis is solved in stage 2 (exactly), never accepted from a stage-1 B4 compromise that moved the frozen axis", () => {
    const { solvedSnapshot, status } = solve(
      freeAxis([], [lineLength("axis_len", "axis", 10)]),
    );
    expect(status.solveState).toBe("solved");
    expect(
      Math.abs(
        distance(
          solvedPoint(solvedSnapshot, "x0"),
          solvedPoint(solvedSnapshot, "x1"),
        ) - 10,
      ),
    ).toBeLessThanOrEqual(1e-9);
  });

  test("AX21 (R-1a C4, mutant-guarded: blocked coincidents do not join): a seed end tied to an axis end only through blocked coincidents (they name a held output of a mirror failed at the start) is not an axis point, so dragging its copy keeps the axis bitwise", () => {
    const base = lineAndCircle();
    const definition = sketch({
      points: [
        ...base.points,
        point("p", [21, 1]),
        point("q", [23, 2]),
        point("mp", [5, 5]),
        point("mq", [6, 6]),
      ],
      entities: [
        ...base.entities,
        line("pq", "p", "q"),
        line("mpq", "mp", "mq"),
      ],
      relationships: [
        ...base.relationships,
        // No entity "gone": the mirror fails at the start, mp is held.
        mirror("n", "gone", [["pq", "mpq", ["p", "q"], ["mp", "mq"]]]),
      ],
      constraints: [
        horizontal("u_h", "u"),
        coincident("mp_x1", "mp", "x1"),
        coincident("mp_a", "mp", "a"),
      ],
    });
    const session = startSession(definition);
    const start = session.lastAcceptedSnapshot;
    expect(
      start.constraintStatuses
        .filter((entry) => entry.constraintId.startsWith("constraint_mp_"))
        .map((entry) => entry.status),
    ).toEqual(["blocked", "blocked"]);
    const ma = solvedPoint(start, "ma");
    const cursor: SketchPoint2D = [ma[0], ma[1] - 1.5];
    const { preview, release, snapshot } = dragPoint(session, "ma", cursor);
    expect([preview.kind, release.kind]).toEqual(["solved", "solved"]);
    expect(at(preview.solvedSnapshot!, AXIS)).toEqual(at(start, AXIS));
    expect(at(snapshot, AXIS)).toEqual(at(start, AXIS));
    expect(distance(solvedPoint(snapshot, "ma"), cursor)).toBeLessThanOrEqual(
      RELEASE_TOLERANCE,
    );
  });
});

// T17d (B4, [TECH] T17-6; logic lane, seams: the core solve and the mock
// solver adapter's solve, the solved-snapshot contract). The reasons the
// evaluation classified travel with the failure in
// `failedDerivationReasons`, keyed to `failedDerivationIds`, primary first;
// a mirror whose line is too short and whose original was deleted carries
// both, and its one message names both repairs. Red on base: the field is
// absent and the double fault's text names the line only.
describe("T17d B4: the failure reason travels with the failure", () => {
  const withoutSeed = (definition: SketchDefinition): SketchDefinition => {
    const entities = definition.entities.filter(
      (entity) => entity.entityId !== eid("ab"),
    );
    return {
      ...definition,
      entities,
      entityIds: entities.map((entity) => entity.entityId),
    };
  };
  const cases: readonly [
    string,
    SketchDefinition,
    Record<string, readonly string[]>,
  ][] = [
    ["line missing", sketch(lineAndCircle("missing")), { m: ["axisMissing"] }],
    [
      "line too short",
      sketch(lineAndCircle("short")),
      { m: ["axisDegenerate"] },
    ],
    [
      "original deleted",
      withoutSeed(sketch(lineAndCircle())),
      { m: ["seedMissing"] },
    ],
    [
      "line too short and original deleted",
      withoutSeed(sketch(lineAndCircle("short"))),
      { m: ["axisDegenerate", "seedMissing"] },
    ],
  ];

  test("RB1: each failed relationship carries its reasons in the core solve and, with the same reasons, in the mock solver's", async () => {
    const mock = new MockSketchSolverAdapter({
      documentId: "doc_t17d",
      revisionId: "rev_t17d",
      neutralCurveQueries: createCertifiedNeutralCurveQueryCapabilityForTest(),
    });
    for (const [name, definition, reasons] of cases) {
      const core = solve(definition, MECHANISM_TOLERANCES).solvedSnapshot;
      expect(core.failedDerivationIds, name).toEqual(["m"]);
      expect(core.failedDerivationReasons, name).toEqual(reasons);
      const mocked = await mock.solveSketch({
        contractVersion: CONTRACT_VERSION,
        solverSchemaVersion: SOLVER_SCHEMA_VERSION,
        requestId: "request_t17d" as RequestId,
        documentId: "doc_t17d" as DocumentId,
        revisionId: "rev_t17d" as RevisionId,
        sketchId: "sketch_primary" as SketchId,
        plane: DEFAULT_MOCK_SKETCH_PLANE_FRAME,
        tolerances: MECHANISM_TOLERANCES,
        modelingTolerance: TAU,
        partialSolvePolicy: "bestEffort",
        definition,
        projectedReferences: [],
      });
      expect(
        mocked.solvedSnapshot.failedDerivationReasons,
        `${name} (mock)`,
      ).toEqual(reasons);
    }
    // A healthy mirror carries neither field.
    const healthy = solve(sketch(lineAndCircle())).solvedSnapshot;
    expect(healthy.failedDerivationIds).toBeUndefined();
    expect(healthy.failedDerivationReasons).toBeUndefined();
  });

  test("RB2: a dependency loop carries its reason; a mirror failing only during the solve carries the reason of the solved positions", () => {
    const loop = solve(
      sketch({
        points: [
          point("a", [1, 1]),
          point("b", [3, 2]),
          point("p", [1, 3]),
          point("q", [2, 4]),
          point("x0", [-1, 0]),
          point("x1", [6, 0]),
        ],
        entities: [
          line("ab", "a", "b"),
          line("pq", "p", "q"),
          line("axis", "x0", "x1"),
        ],
        relationships: [
          mirror("first", "axis", [["ab", "pq", ["a", "b"], ["p", "q"]]]),
          mirror("second", "axis", [["pq", "ab", ["p", "q"], ["a", "b"]]]),
        ],
      }),
    ).solvedSnapshot;
    expect(loop.failedDerivationReasons).toEqual({
      first: ["dependencyLoop"],
      second: ["dependencyLoop"],
    });
    // MF4's case: the authored axis is long; the solve drives it below τ.
    const during = solve(
      sketch({
        ...lineAndCircle(),
        dimensions: [lineLength("axis_len", "axis", 5e-4)],
      }),
      MECHANISM_TOLERANCES,
    ).solvedSnapshot;
    expect(during.failedDerivationReasons).toEqual({ m: ["axisDegenerate"] });
  });

  test("RB3: the double fault's one error names both breaks and both repairs", () => {
    const { solvedSnapshot } = solve(
      withoutSeed(sketch(lineAndCircle("short"))),
      MECHANISM_TOLERANCES,
    );
    expect(
      solvedSnapshot.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => [diagnostic.code, diagnostic.message]),
    ).toEqual([
      [
        MIRROR_DIAGNOSTIC_CODES.axisDegenerate,
        "Mirror ‘m’ is broken: its mirror line is shorter than the modeling tolerance, and the original of ‘mab’ was deleted. Its copies stay where they were last solved and can't be used; profiles from this sketch are blocked. Undo, replace the mirror line and the original, or remove the mirror from the Mirror panel.",
      ],
    ]);
  });
});
