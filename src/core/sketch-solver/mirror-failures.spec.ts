import { compileSketchSolveProgram } from "./compile-program";
import {
  arc,
  circle,
  DOCUMENT_TOLERANCES,
  eid,
  errorCodes,
  evaluatedPoint,
  horizontal,
  line,
  lineAndCircle,
  lineLength,
  MECHANISM_TOLERANCES,
  mirror,
  output,
  pid,
  point,
  pointEntity,
  profileGate,
  reflectY0,
  sketch,
  solve,
  solvedPoint,
  TAU,
} from "./mirror.fixtures";
import { startCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  evaluateSketchDerivationJvp,
  evaluateSketchDerivations,
  prepareSketchDerivationPullback,
} from "@/contracts/sketch/derived-geometry";
import {
  DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED,
  MIRROR_DIAGNOSTIC_CODES,
} from "@/contracts/sketch/mirror-requirements";
import { nonAcceptedDerivedOutputs } from "@/contracts/sketch/offset-publication";
import {
  createSketchArrangementDeriver,
  offsetArrangementInput,
} from "@/contracts/sketch/region-extraction";
import type {
  NumericSketchDefinition as SketchDefinition,
  NumericSketchDerivationDefinition as SketchDerivationDefinition,
  SketchPoint2D,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/core/modeling/neutral-curve-certification/query";
import { describe, expect, test } from "vitest";

describe("failure encoding: one relationship error, held outputs, the rest solves (T-8/T-16)", () => {
  test("MF1: a missing axis is one derived-mirror-axis-missing error (not one per output); outputs are held; the unrelated requirement solves; the sketch is invalid and every profile is blocked", () => {
    const definition = sketch({
      ...lineAndCircle("missing"),
      constraints: [horizontal("u_h", "u")],
    });
    const evaluation = evaluateSketchDerivations({
      definition,
      modelingTolerance: TAU,
    });
    expect(evaluation.diagnostics).toEqual([]);
    expect(
      evaluation.derivedFailures.map((failure) => [
        failure.derivationId,
        failure.diagnostic.code,
        failure.diagnostic.severity,
      ]),
    ).toEqual([["m", MIRROR_DIAGNOSTIC_CODES.axisMissing, "error"]]);
    // Held: the stored output positions, never R(seed) of a guessed axis.
    expect(evaluatedPoint(evaluation.definition, "ma")).toEqual([7, 7]);
    expect(evaluatedPoint(evaluation.definition, "mc")).toEqual([9, 9]);

    const { solvedSnapshot, status } = solve(definition);
    expect(errorCodes(solvedSnapshot)).toEqual([
      MIRROR_DIAGNOSTIC_CODES.axisMissing,
    ]);
    expect(solvedSnapshot.failedDerivationIds).toEqual(["m"]);
    expect(status.solveState).toBe("solved");
    expect(solvedSnapshot.constraintStatuses).toEqual([
      { constraintId: "constraint_u_h", status: "satisfied" },
    ]);
    expect(solvedPoint(solvedSnapshot, "u1")[1]).toBeCloseTo(
      solvedPoint(solvedSnapshot, "u0")[1],
      9,
    );
    expect(solvedPoint(solvedSnapshot, "ma")).toEqual([7, 7]);
    expect(profileGate(solvedSnapshot)).toEqual({
      validity: "invalid",
      consumable: 0,
    });
  });

  test("MF2: a missing seed is one derived-mirror-map-stale error; failed outputs are non-accepted (G19) and so are their mirror dependents", () => {
    const base = lineAndCircle();
    const definition = sketch({
      ...base,
      points: [...base.points, point("na", [0, 0]), point("nb", [0, 0])],
      entities: [
        ...base.entities.filter((entity) => entity.entityId !== eid("ab")),
        line("nab", "na", "nb"),
      ],
      relationships: [
        ...base.relationships,
        mirror("n", "u", [["mab", "nab", ["ma", "mb"], ["na", "nb"]]]),
      ],
    });
    const { solvedSnapshot, status } = solve(definition);
    expect(errorCodes(solvedSnapshot)).toEqual([
      MIRROR_DIAGNOSTIC_CODES.mapStale,
    ]);
    expect(solvedSnapshot.failedDerivationIds).toEqual(["m"]);
    expect(status.solveState).toBe("solved");
    const nonAccepted = nonAcceptedDerivedOutputs(definition, solvedSnapshot);
    expect(
      [...nonAccepted].map(([entityId, owner]) => [
        entityId,
        owner.derivationId,
      ]),
    ).toEqual([
      [eid("mab"), "m"],
      [eid("mc"), "m"],
      [eid("nab"), "m"],
    ]);
    expect(profileGate(solvedSnapshot)).toEqual({
      validity: "invalid",
      consumable: 0,
    });
  });

  test("MF3: start-state rule — a drag of unrelated geometry starts and is accepted while a mirror is already failed; requirements naming its outputs are blocked", () => {
    const definition = sketch({
      ...lineAndCircle("missing"),
      constraints: [horizontal("u_h", "u")],
      dimensions: [lineLength("mab_len", "mab", 2)],
    });
    const program = compileSketchSolveProgram({
      definition,
      tolerances: DOCUMENT_TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "bestEffort",
    });
    const started = startCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_t15b_mf3",
      program,
    });
    expect(started.kind).toBe("started");
    if (started.kind !== "started") return;
    expect(
      started.session.lastAcceptedSnapshot.dimensionStatuses.map(
        (entry) => entry.status,
      ),
    ).toEqual(["blocked"]);
    const frame = updateCompiledSketchSolveSession(
      started.session,
      { kind: "sketchPoint", pointId: pid("u1"), position: [12, 14] },
      null,
    );
    expect(frame.kind).toBe("solved");
    const snapshot = frame.solvedSnapshot!;
    expect(solvedPoint(snapshot, "u1")[0]).toBeCloseTo(12, 6);
    // The horizontal holds: u0 follows u1 up.
    expect(solvedPoint(snapshot, "u0")[1]).toBeCloseTo(
      solvedPoint(snapshot, "u1")[1],
      9,
    );
    expect(solvedPoint(snapshot, "u1")[1]).toBeGreaterThan(11);
    expect(errorCodes(snapshot)).toEqual([MIRROR_DIAGNOSTIC_CODES.axisMissing]);
    expect(
      snapshot.dimensionStatuses.map((entry) => [
        entry.dimensionId,
        entry.status,
      ]),
    ).toEqual([["dimension_mab_len", "blocked"]]);
  });

  test("MF4: a mirror failing during a solve (axis driven below τ in the mechanism band, where A2 does not fire) is not tolerated: the solve is not solved; with a requirement naming its outputs the failure is never a reward (+∞), so the solve stops short of it", () => {
    const failing = solve(
      sketch({
        ...lineAndCircle(),
        dimensions: [lineLength("axis_len", "axis", 5e-4)],
      }),
      MECHANISM_TOLERANCES,
    );
    expect(failing.solvedSnapshot.failedDerivationIds).toEqual(["m"]);
    expect(errorCodes(failing.solvedSnapshot)).toEqual([
      MIRROR_DIAGNOSTIC_CODES.axisDegenerate,
    ]);
    expect(failing.status.solveState).not.toBe("solved");
    // Control: the same mirror already failed at the start (missing axis)
    // does not fail the solve.
    const control = solve(
      sketch({ ...lineAndCircle("missing") }),
      MECHANISM_TOLERANCES,
    );
    expect(control.status.solveState).toBe("solved");
    // A requirement on an output scores +∞ where the mirror fails during
    // the solve: the axis requirement is left unsatisfied instead.
    const barred = solve(
      sketch({
        ...lineAndCircle(),
        dimensions: [
          lineLength("axis_len", "axis", 5e-4),
          lineLength("mab_len", "mab", Math.hypot(2, 1)),
        ],
      }),
      MECHANISM_TOLERANCES,
    ).solvedSnapshot;
    expect(barred.failedDerivationIds).toBeUndefined();
    expect(
      barred.dimensionStatuses.map((entry) => [
        entry.dimensionId,
        entry.status,
      ]),
    ).toEqual([
      ["dimension_axis_len", "unsatisfied"],
      ["dimension_mab_len", "driving"],
    ]);
  });
});

describe("regions (G19, T-8): a failed mirror blocks every profile of the sketch", () => {
  /** A closed triangle seed mirrored about the axis, with or without the axis. */
  function triangle(axis: "x0-x1" | "missing") {
    const base = lineAndCircle(axis);
    return sketch({
      points: [
        ...base.points,
        point("t0", [0, 5]),
        point("t1", [2, 5]),
        point("t2", [1, 7]),
        // Stale stored copy (non-degenerate, so a held copy is valid geometry).
        point("m0", [20, 0]),
        point("m1", [22, 0]),
        point("m2", [21, 2]),
      ],
      entities: [
        ...base.entities,
        line("e0", "t0", "t1"),
        line("e1", "t1", "t2"),
        line("e2", "t2", "t0"),
        line("f0", "m0", "m1"),
        line("f1", "m1", "m2"),
        line("f2", "m2", "m0"),
      ],
      relationships: [
        mirror("m", "axis", [
          ["e0", "f0", ["t0", "t1"], ["m0", "m1"]],
          ["e1", "f1", ["t1", "t2"], ["m1", "m2"]],
          ["e2", "f2", ["t2", "t0"], ["m2", "m0"]],
        ]),
      ],
    });
  }
  const derive = async (definition: SketchDefinition) => {
    const evaluated = evaluateSketchDerivations({
      definition,
      modelingTolerance: TAU,
    }).definition;
    const solvedSnapshot = solve(evaluated).solvedSnapshot;
    return {
      solvedSnapshot,
      evaluated,
      result: await createSketchArrangementDeriver(
        await createCertifiedNeutralCurveQueryCapabilityForTest(),
      ).derive({
        documentId: "doc_workspace" as never,
        revisionId: "rev_0001" as never,
        sketchId: "sketch_primary" as never,
        definition: evaluated,
        solvedSnapshot,
        projectedReferences: [],
        modelingTolerance: TAU,
        ...offsetArrangementInput(evaluated, solvedSnapshot, []),
      }),
    };
  };

  test("MR1: with the mirror healthy every closed loop (two triangles, two circles) is a region; with its axis missing no region is derived (regions-unavailable) and its held outputs are excluded arrangement input", async () => {
    const healthy = await derive(triangle("x0-x1"));
    // Two triangles and two circles.
    expect(healthy.result.regions.length).toBe(4);
    const broken = await derive(triangle("missing"));
    expect(broken.result.regions).toEqual([]);
    expect(broken.result.diagnostics.map((entry) => entry.code)).toContain(
      "regions-unavailable",
    );
    expect(
      (
        offsetArrangementInput(broken.evaluated, broken.solvedSnapshot, [])
          .unpublishedOffsetOutputs ?? []
      ).map((entry) => [entry.entityId, entry.derivationId]),
    ).toEqual(["f0", "f1", "f2"].map((id) => [eid(id), "m"]));
  }, 60_000);
});

describe("stale map: an empty seed map (T-15)", () => {
  test("MS1: an empty seedPointIds is stale (every writer records the seed's defining points); the copy is held, never evaluated through a guessed map", () => {
    const base = lineAndCircle();
    const definition = sketch({
      ...base,
      relationships: [
        mirror("m", "axis", [
          ["ab", "mab", [], ["ma", "mb"]],
          ["c", "mc", ["c"], ["mc"]],
        ]),
      ],
    });
    const evaluation = evaluateSketchDerivations({
      definition,
      modelingTolerance: TAU,
    });
    expect(
      evaluation.derivedFailures.map((failure) => failure.diagnostic.code),
    ).toEqual([MIRROR_DIAGNOSTIC_CODES.mapStale]);
    expect(evaluatedPoint(evaluation.definition, "ma")).toEqual([7, 7]);
  });
});

describe("degenerate axis (T-5, R-5): explicit, never an unchanged point or NaN", () => {
  for (const axis of ["short", "zero"] as const) {
    test(`MG1 (${axis}): one derived-mirror-axis-degenerate per relationship, outputs held and finite, sketch invalid, profiles blocked (document tolerances)`, () => {
      const definition = sketch(lineAndCircle(axis));
      const evaluation = evaluateSketchDerivations({
        definition,
        modelingTolerance: TAU,
      });
      expect(
        evaluation.derivedFailures.map((failure) => failure.diagnostic.code),
      ).toEqual([MIRROR_DIAGNOSTIC_CODES.axisDegenerate]);
      // Never the unchanged seed point (the old `reflected ?? point`).
      expect(evaluatedPoint(evaluation.definition, "ma")).toEqual([7, 7]);
      expect(evaluatedPoint(evaluation.definition, "ma")).not.toEqual([1, 1]);
      const { solvedSnapshot } = solve(definition);
      expect(
        solvedSnapshot.solvedPoints.every((entry) =>
          entry.solvedPosition.every(Number.isFinite),
        ),
      ).toBe(true);
      expect(
        errorCodes(solvedSnapshot).filter((code) => code.includes("mirror")),
      ).toEqual([MIRROR_DIAGNOSTIC_CODES.axisDegenerate]);
      expect(solvedSnapshot.failedDerivationIds).toEqual(["m"]);
      expect(profileGate(solvedSnapshot)).toEqual({
        validity: "invalid",
        consumable: 0,
      });
    });
  }
});

describe("datum axes (T-7)", () => {
  function datumSketch(datum: "xAxis" | "yAxis", dimensions: unknown[] = []) {
    return sketch({
      points: [
        point("a", [1, 1]),
        point("b", [3, 2]),
        point("ma", [0, 0]),
        point("mb", [0, 0]),
      ],
      entities: [line("ab", "a", "b"), line("mab", "ma", "mb")],
      relationships: [
        mirror("m", { datum }, [["ab", "mab", ["a", "b"], ["ma", "mb"]]]),
      ],
      dimensions,
    });
  }

  test("MD1: a mirror about a sketch datum axis evaluates exactly (x axis: (x, −y); y axis: (−x, y))", () => {
    const x = evaluateSketchDerivations({
      definition: datumSketch("xAxis"),
      modelingTolerance: TAU,
    });
    expect(x.derivedFailures).toEqual([]);
    expect(evaluatedPoint(x.definition, "ma")).toEqual([1, -1]);
    expect(evaluatedPoint(x.definition, "mb")).toEqual([3, -2]);
    const y = evaluateSketchDerivations({
      definition: datumSketch("yAxis"),
      modelingTolerance: TAU,
    });
    expect(evaluatedPoint(y.definition, "ma")).toEqual([-1, 1]);
    expect(evaluatedPoint(y.definition, "mb")).toEqual([-3, 2]);
  });

  test("MD2: a datum axis has no variables: the output depends on the seed only; a dimension on the output drives the seed and the copy stays its exact reflection", () => {
    const definition = datumSketch("xAxis", [lineLength("mab_len", "mab", 4)]);
    const program = compileSketchSolveProgram({
      definition,
      tolerances: DOCUMENT_TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "bestEffort",
    });
    const record = (id: string) =>
      program.system.pointRecords.get(pid(id))!.baseIndex;
    expect(
      program.system.parameterProjection.projectVariableIndices([
        record("ma"),
        record("ma") + 1,
      ]),
    ).toEqual([record("a"), record("a") + 1]);
    const { solvedSnapshot, status } = solve(definition);
    expect(status.solveState).toBe("solved");
    const a = solvedPoint(solvedSnapshot, "a");
    const b = solvedPoint(solvedSnapshot, "b");
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(4, 6);
    expect(solvedPoint(solvedSnapshot, "ma")).toEqual(reflectY0(a));
    expect(solvedPoint(solvedSnapshot, "mb")).toEqual(reflectY0(b));
  });

  test("MD3: a drag of the seed moves the copy as its exact reflection; the datum never moves", () => {
    const program = compileSketchSolveProgram({
      definition: datumSketch("yAxis"),
      tolerances: DOCUMENT_TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "bestEffort",
    });
    const started = startCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_t15b_md3",
      program,
    });
    if (started.kind !== "started") throw new Error("not started");
    const frame = updateCompiledSketchSolveSession(
      started.session,
      { kind: "sketchPoint", pointId: pid("b"), position: [5, 6] },
      null,
    );
    expect(frame.kind).toBe("solved");
    const b = solvedPoint(frame.solvedSnapshot!, "b");
    expect(b[0]).toBeCloseTo(5, 6);
    expect(solvedPoint(frame.solvedSnapshot!, "mb")).toEqual([-b[0], b[1]]);
  });
});

describe("arc shape from the seed arc's variables (T-4, R-4)", () => {
  /** A ccw seed arc above the axis x0–x1 (y = 0) and its stale copy; a free line u. */
  function arcSketch(bound: boolean) {
    return sketch({
      points: [
        point("ac", [5, 2]),
        point("as", [6, 2]),
        point("ae", [5, 3]),
        point("x0", [-1, 0]),
        point("x1", [6, 0]),
        point("mac", [0, 0]),
        point("mas", [0, 0]),
        point("mae", [0, 0]),
        point("u0", [10, 10]),
        point("u1", [12, 10]),
      ],
      entities: [
        arc("arc", "ac", "as", "ae", "counterClockwise"),
        line("axis", "x0", "x1"),
        arc("marc", "mac", "mas", "mae", "counterClockwise"),
        line("u", "u0", "u1"),
      ],
      relationships: [
        mirror("m", "axis", [
          ["arc", "marc", ["ac", "as", "ae"], ["mac", "mas", "mae"]],
        ]),
      ],
      constraints: [horizontal("u_h", "u")],
      dimensions: [
        ...(bound
          ? [
              {
                dimensionId: "dimension_arc_bs",
                kind: "arcStartPointCoincident",
                label: "bs",
                entityId: eid("arc"),
                pointId: pid("as"),
              },
              {
                dimensionId: "dimension_arc_be",
                kind: "arcEndPointCoincident",
                label: "be",
                entityId: eid("arc"),
                pointId: pid("ae"),
              },
            ]
          : []),
        {
          dimensionId: "dimension_marc_d",
          kind: "diameter",
          label: "marc d",
          entityId: eid("marc"),
          value: 4,
        },
      ],
    });
  }
  const arcRecord = (snapshot: SolvedSketchSnapshot, id: string) => {
    const entity = snapshot.solvedEntities.find(
      (entry) => entry.entityId === eid(id),
    );
    if (entity?.kind !== "arc") throw new Error(`${id} is not a solved arc`);
    return entity;
  };
  const distance = (first: SketchPoint2D, second: SketchPoint2D) =>
    Math.hypot(first[0] - second[0], first[1] - second[1]);

  test("MA1 (probe 3b analogue): with bound arcs, the output arc is the exact reflection of the seed arc's solver variables (no binding residual)", () => {
    const { solvedSnapshot, status } = solve(
      arcSketch(true),
      MECHANISM_TOLERANCES,
    );
    expect(status.solveState).toBe("solved");
    const seed = arcRecord(solvedSnapshot, "arc");
    const copy = arcRecord(solvedSnapshot, "marc");
    expect(copy.sweepDirection).toBe("clockwise");
    // Exact up to the rounding of one reflection and one cos/sin.
    for (const [key, label] of [
      ["centerPosition", "centre"],
      ["startPosition", "start"],
      ["endPosition", "end"],
    ] as const)
      expect(
        distance(copy[key], reflectY0(seed[key])),
        `output arc ${label} = R(seed arc ${label})`,
      ).toBeLessThan(1e-12);
    expect(distance(seed.startPosition, seed.centerPosition)).toBeCloseTo(2, 6);
  });

  test("MA2 (probe 3, recorded limit, T17): an unbound seed arc's points detach from its variables; T-4 mirrors the variables exactly but does not repair the detachment", () => {
    const { solvedSnapshot } = solve(arcSketch(false), MECHANISM_TOLERANCES);
    const seed = arcRecord(solvedSnapshot, "arc");
    const copy = arcRecord(solvedSnapshot, "marc");
    expect(
      distance(copy.startPosition, reflectY0(seed.startPosition)),
    ).toBeLessThan(1e-12);
    // The limit: the seed's own start point is not on its solved arc.
    expect(
      distance(solvedPoint(solvedSnapshot, "as"), seed.startPosition),
    ).toBeGreaterThan(1e-3);
  });

  test("MA3: the arc-slot JVP and pullback are adjoint and match central differences of the evaluation", () => {
    const definition = evaluateSketchDerivations({
      definition: arcSketch(true),
      modelingTolerance: TAU,
    }).definition;
    const seedArc = { radius: 1.25, startAngle: 0.3, endAngle: 1.9 };
    const evaluateAt = (arcVariables: typeof seedArc, x1: SketchPoint2D) =>
      evaluateSketchDerivations({
        definition: {
          ...definition,
          points: definition.points.map((entry) =>
            entry.pointId === pid("x1") ? { ...entry, position: x1 } : entry,
          ),
        },
        modelingTolerance: TAU,
        arcVariables: new Map([[eid("arc"), arcVariables]]),
      });
    const base = evaluateAt(seedArc, [6, 0.4]);
    const dArc = { radius: 0.3, startAngle: -0.7, endAngle: 0.2 };
    const dX1: SketchPoint2D = [0.11, -0.05];
    const jvp = evaluateSketchDerivationJvp(base, {
      entities: { [eid("arc")]: { kind: "arc", ...dArc } },
      points: { [pid("x1")]: dX1 },
    }).entities[eid("marc")];
    if (jvp?.kind !== "arc") throw new Error("no arc JVP");
    const h = 1e-6;
    const at = (sign: number) =>
      base.mirrorArcVariables.size > 0
        ? evaluateAt(
            {
              radius: seedArc.radius + sign * h * dArc.radius,
              startAngle: seedArc.startAngle + sign * h * dArc.startAngle,
              endAngle: seedArc.endAngle + sign * h * dArc.endAngle,
            },
            [6 + sign * h * dX1[0], 0.4 + sign * h * dX1[1]],
          ).mirrorArcVariables.get(eid("marc"))!
        : null;
    const plus = at(1)!;
    const minus = at(-1)!;
    for (const key of ["radius", "startAngle", "endAngle"] as const)
      expect(jvp[key]).toBeCloseTo((plus[key] - minus[key]) / (2 * h), 6);
    // Adjoint: w·(J v) = (Jᵀ w)·v.
    const w = { radius: 0.4, startAngle: -1.3, endAngle: 0.8 };
    const pulled = prepareSketchDerivationPullback(base)({
      entities: { [eid("marc")]: { kind: "arc", ...w } },
    });
    const pulledArc = pulled.entities?.[eid("arc")];
    if (pulledArc?.kind !== "arc") throw new Error("no arc cotangent");
    const pulledX1 = pulled.points?.[pid("x1")] ?? [0, 0];
    expect(
      pulledArc.radius * dArc.radius +
        pulledArc.startAngle * dArc.startAngle +
        pulledArc.endAngle * dArc.endAngle +
        pulledX1[0] * dX1[0] +
        pulledX1[1] * dX1[1],
    ).toBeCloseTo(
      w.radius * jvp.radius +
        w.startAngle * jvp.startAngle +
        w.endAngle * jvp.endAngle,
      12,
    );
  });
});

describe("review Q1: point-defined seed arcs, circle radius chains, offset + mirror failures", () => {
  /** An offset seed arc S (point-defined slots) mirrored to Q; diameter + end bindings on Q. */
  function mirrorOfOffsetSeed(): SketchDefinition {
    return sketch({
      points: [
        point("sc", [0, 0]),
        point("ss", [2, 0]),
        point("se", [0, 2]),
        point("oc", [9, 9]),
        point("os", [9, 9]),
        point("oe", [9, 9]),
        point("x0", [-3, -3.2]),
        point("x1", [3, -2.9]),
        point("qc", [0, 0]),
        point("qs", [0, 0]),
        point("qe", [0, 0]),
        point("f", [1, -7]),
      ],
      entities: [
        arc("S", "sc", "ss", "se", "counterClockwise"),
        arc("O", "oc", "os", "oe", "counterClockwise"),
        line("axis", "x0", "x1"),
        arc("Q", "qc", "qs", "qe", "clockwise"),
      ],
      relationships: [
        mirror("m", "axis", [
          ["S", "Q", ["sc", "ss", "se"], ["qc", "qs", "qe"]],
        ]),
        {
          kind: "offset",
          derivationId: "o",
          label: "o",
          seedEntityIds: [eid("S")],
          distance: 0.5,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [output(["S", "O", ["sc", "ss", "se"], ["oc", "os", "oe"]])],
        } as SketchDerivationDefinition,
      ],
      dimensions: [
        {
          dimensionId: "dimension_q_d",
          kind: "diameter",
          label: "d",
          entityId: eid("Q"),
          value: 3.3,
        },
        {
          dimensionId: "dimension_q_s",
          kind: "arcStartPointCoincident",
          label: "s",
          entityId: eid("Q"),
          pointId: pid("f"),
        },
        {
          dimensionId: "dimension_q_e",
          kind: "arcEndPointCoincident",
          label: "e",
          entityId: eid("Q"),
          pointId: pid("f"),
        },
      ],
    });
  }

  test("Q1a (review R3): requirements on the mirror of an offset seed arc pull back through its points (gradients = central differences) and a diameter on the copy solves", () => {
    const program = compileSketchSolveProgram({
      definition: mirrorOfOffsetSeed(),
      tolerances: DOCUMENT_TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "bestEffort",
    });
    const values = program.system.initialValues.slice();
    const authority =
      program.system.parameterProjection.authorityVariableIndices;
    for (const index of authority)
      values[index] = values[index]! + 0.01 * Math.sin(1 + 7 * index);
    for (const record of program.system.scalarConstraints) {
      const at = record.evaluate(values);
      for (const index of authority) {
        const h = 1e-6;
        const plus = values.slice();
        plus[index] = plus[index]! + h;
        const minus = values.slice();
        minus[index] = minus[index]! - h;
        const fd =
          (record.evaluate(plus).residual - record.evaluate(minus).residual) /
          (2 * h);
        expect(
          Math.abs(fd - at.gradient[index]!),
          `${record.id} ∂/∂${index}`,
        ).toBeLessThan(1e-5 * Math.max(1, Math.abs(fd)));
      }
    }
    const solved = solve(mirrorOfOffsetSeed()).solvedSnapshot;
    expect(solved.status.solveState).toBe("solved");
    expect(
      solved.dimensionStatuses.map((entry) => [
        entry.dimensionId,
        entry.status,
      ]),
    ).toEqual([
      ["dimension_q_d", "driving"],
      ["dimension_q_s", "driving"],
      ["dimension_q_e", "driving"],
    ]);
  });

  test("Q1b (review R4): a diameter on a pattern of a mirrored circle drives the seed radius", () => {
    const definition = sketch({
      points: [
        point("c", [2, 3]),
        point("x0", [-1, 0.2]),
        point("x1", [6, -0.4]),
        point("mc", [0, 0]),
        point("pc", [0, 0]),
      ],
      entities: [
        circle("c", "c", 1),
        line("axis", "x0", "x1"),
        circle("mc", "mc", 1),
        circle("pc", "pc", 1),
      ],
      relationships: [
        {
          kind: "linearPattern",
          derivationId: "p",
          label: "p",
          seedEntityIds: [eid("mc")],
          vector: [0.5, 6],
          instanceCount: 2,
          outputs: [output(["mc", "pc", ["mc"], ["pc"]])],
        } as SketchDerivationDefinition,
        mirror("m", "axis", [["c", "mc", ["c"], ["mc"]]]),
      ],
      dimensions: [
        {
          dimensionId: "dimension_pc_d",
          kind: "diameter",
          label: "d",
          entityId: eid("pc"),
          value: 3.3,
        },
      ],
    });
    const solved = solve(definition).solvedSnapshot;
    expect(solved.status.solveState).toBe("solved");
    const radius = (id: string) => {
      const entity = solved.solvedEntities.find(
        (entry) => entry.entityId === eid(id),
      );
      return entity?.kind === "circle" ? entity.solvedRadius : null;
    };
    for (const id of ["c", "mc", "pc"]) expect(radius(id)).toBeCloseTo(1.65, 6);
  });

  test("Q1c (review R7): with a mirror and an offset both failed at the start, an unrelated drag starts and its frame is solved", () => {
    const definition = sketch({
      points: [
        point("sc", [0, 0]),
        point("ss", [2, 0]),
        point("se", [0, 2]),
        point("oc", [9, 9]),
        point("os", [9, 9]),
        point("oe", [9, 9]),
        point("a", [1, 5]),
        point("b", [3, 6]),
        point("ma", [7, 7]),
        point("mb", [8, 8]),
        point("u0", [10, 10]),
        point("u1", [12, 11]),
      ],
      entities: [
        arc("S", "sc", "ss", "se", "counterClockwise"),
        arc("O", "oc", "os", "oe", "counterClockwise"),
        line("ab", "a", "b"),
        line("mab", "ma", "mb"),
        line("u", "u0", "u1"),
      ],
      relationships: [
        {
          // Inward by more than the radius: the offset arc collapses.
          kind: "offset",
          derivationId: "o",
          label: "o",
          seedEntityIds: [eid("S")],
          distance: 3,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [output(["S", "O", ["sc", "ss", "se"], ["oc", "os", "oe"]])],
        } as SketchDerivationDefinition,
        mirror("m", "missingAxis", [["ab", "mab", ["a", "b"], ["ma", "mb"]]]),
      ],
    });
    const program = compileSketchSolveProgram({
      definition,
      tolerances: DOCUMENT_TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "bestEffort",
    });
    const started = startCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_t15b_q1c",
      program,
    });
    expect(started.kind).toBe("started");
    if (started.kind !== "started") return;
    const startErrors = started.session.lastAcceptedSnapshot.diagnostics
      .filter((diagnostic) => diagnostic.severity === "error")
      .map((diagnostic) => diagnostic.code);
    expect(startErrors).toContain(MIRROR_DIAGNOSTIC_CODES.axisMissing);
    expect(startErrors.length, "the offset failure is reported too").toBe(2);
    const frame = updateCompiledSketchSolveSession(
      started.session,
      { kind: "sketchPoint", pointId: pid("u1"), position: [12, 14] },
      null,
    );
    expect(frame.kind).toBe("solved");
    expect(solvedPoint(frame.solvedSnapshot!, "u1")[1]).toBeCloseTo(14, 6);
  });
});

describe("dependency order (T-9)", () => {
  /**
   * m1 mirrors ab about axis; m2 mirrors m1's copy about axis2 (chain);
   * p patterns m2's copy (pattern of mirror); o offsets m1's copy
   * (offset of mirror); m3 mirrors o's output (mirror of offset).
   */
  function chainSketch(order: readonly number[]) {
    const relationships: SketchDerivationDefinition[] = [
      mirror("m1", "axis", [["ab", "c1", ["a", "b"], ["a1", "b1"]]]),
      mirror("m2", "axis2", [["c1", "c2", ["a1", "b1"], ["a2", "b2"]]]),
      {
        kind: "linearPattern",
        derivationId: "p",
        label: "p",
        seedEntityIds: [eid("c2")],
        vector: [0, 5],
        instanceCount: 2,
        outputs: [output(["c2", "c3", ["a2", "b2"], ["a3", "b3"]])],
      } as SketchDerivationDefinition,
      {
        kind: "offset",
        derivationId: "o",
        label: "o",
        seedEntityIds: [eid("c1")],
        distance: 0.5,
        jointPolicy: "trimExtendArcFallback",
        jointOutputs: [],
        piecewiseCubicOutputs: [],
        outputs: [output(["c1", "oc", ["a1", "b1"], ["o1", "o2"]])],
      } as SketchDerivationDefinition,
      mirror("m3", "axis2", [["oc", "c4", ["o1", "o2"], ["a4", "b4"]]]),
    ];
    const ids = [
      "a",
      "b",
      "x0",
      "x1",
      "y0",
      "y1",
      "a1",
      "b1",
      "a2",
      "b2",
      "a3",
      "b3",
      "o1",
      "o2",
      "a4",
      "b4",
    ];
    return sketch({
      points: ids.map((id, index) =>
        point(
          id,
          id === "a"
            ? [1, 1]
            : id === "b"
              ? [3, 2]
              : id === "x0"
                ? [-1, 0]
                : id === "x1"
                  ? [6, 0]
                  : id === "y0"
                    ? [-2, -5]
                    : id === "y1"
                      ? [-2, 5]
                      : [100 + index, 100],
        ),
      ),
      entities: [
        line("ab", "a", "b"),
        line("axis", "x0", "x1"),
        line("axis2", "y0", "y1"),
        line("c1", "a1", "b1"),
        line("c2", "a2", "b2"),
        line("c3", "a3", "b3"),
        line("oc", "o1", "o2"),
        line("c4", "a4", "b4"),
      ],
      relationships: order.map((index) => relationships[index]!),
    });
  }

  test("MO1: reversed and shuffled relationship orders (chain, pattern-of-mirror, offset-of-mirror, mirror-of-offset) evaluate and solve bitwise like the in-order definition", () => {
    const inOrder = chainSketch([0, 1, 2, 3, 4]);
    const reference = evaluateSketchDerivations({
      definition: inOrder,
      modelingTolerance: TAU,
    });
    expect(reference.derivedFailures).toEqual([]);
    expect(reference.offsetFailures).toEqual([]);
    expect(evaluatedPoint(reference.definition, "a2")).toEqual([-5, -1]);
    const referenceSolve = solve(inOrder).solvedSnapshot;
    for (const order of [
      [4, 3, 2, 1, 0],
      [2, 4, 0, 3, 1],
      [1, 0, 4, 2, 3],
    ]) {
      const shuffled = chainSketch(order);
      const evaluation = evaluateSketchDerivations({
        definition: shuffled,
        modelingTolerance: TAU,
      });
      expect(evaluation.derivedFailures).toEqual([]);
      expect(evaluation.definition.points).toEqual(reference.definition.points);
      expect(solve(shuffled).solvedSnapshot.solvedPoints).toEqual(
        referenceSolve.solvedPoints,
      );
    }
  });

  test("MO2: a cycle (two mirrors reading each other's outputs) fails explicitly, once per relationship, and terminates; an unrelated mirror still evaluates", () => {
    const definition = sketch({
      points: [
        point("a", [1, 1]),
        point("b", [3, 2]),
        point("p", [1, 3]),
        point("q", [2, 4]),
        point("x0", [-1, 0]),
        point("x1", [6, 0]),
        point("k", [5, 5]),
        point("mk", [0, 0]),
      ],
      entities: [
        line("ab", "a", "b"),
        line("pq", "p", "q"),
        line("axis", "x0", "x1"),
        pointEntity("kk", "k"),
        pointEntity("mkk", "mk"),
      ],
      relationships: [
        mirror("first", "axis", [["ab", "pq", ["a", "b"], ["p", "q"]]]),
        mirror("second", "axis", [["pq", "ab", ["p", "q"], ["a", "b"]]]),
        mirror("free", "axis", [["kk", "mkk", ["k"], ["mk"]]]),
      ],
    });
    const evaluation = evaluateSketchDerivations({
      definition,
      modelingTolerance: TAU,
    });
    expect(
      evaluation.derivedFailures.map((failure) => [
        failure.derivationId,
        failure.diagnostic.code,
      ]),
    ).toEqual([
      ["first", DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED],
      ["second", DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED],
    ]);
    expect(evaluatedPoint(evaluation.definition, "mk")).toEqual([5, -5]);
    const { solvedSnapshot } = solve(definition);
    expect(solvedSnapshot.failedDerivationIds).toEqual(["first", "second"]);
    expect(profileGate(solvedSnapshot).validity).toBe("invalid");
  });
});
