/**
 * T15b: the solver and evaluation cutover to the mirror owner
 * (`mirror-requirements.ts`). Logic lane; seams: `evaluateSketchDerivations`,
 * the core solve and the compiled session, and the validity/profile gate.
 * T15c (end of file): axis preference and driven exact reach, through the
 * compiled session and the batch solve.
 */
import { describe, expect, test } from "vitest";
import type {
  ConstraintId,
  DimensionId,
  DocumentId,
  RequestId,
  RevisionId,
  SketchEntityId,
  SketchId,
  SketchPointId,
} from "@/contracts/shared/ids";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { SOLVER_SCHEMA_VERSION } from "@/contracts/solver/schema";
import {
  DEFAULT_MOCK_SKETCH_PLANE_FRAME,
  MockSketchSolverAdapter,
} from "@/domain/solver/mock-sketch-solver-adapter";
// T17p2 (F-2): the solver works on resolved definitions.
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchDerivationDefinition,
  SketchEntityDefinition,
  SketchPoint2D,
  SketchPointDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  evaluateSketchDerivations,
  evaluateSketchDerivationJvp,
  prepareSketchDerivationPullback,
} from "@/contracts/sketch/derived-geometry";
import {
  DERIVED_RELATIONSHIP_DEPENDENCY_UNRESOLVED,
  MIRROR_DIAGNOSTIC_CODES,
} from "@/contracts/sketch/mirror-requirements";
import {
  compileSketchSolveProgram,
  sketchDraggedPointHasFreeDof,
  solveSketchDefinitionCore,
  startCompiledSketchSolveSession,
  updateCompiledSketchSolveSession,
} from "@/contracts/sketch/solver-core";
import {
  deriveSketchValidity,
  getConsumableSketchRegions,
} from "@/contracts/sketch/derived-validity";
import { nonAcceptedDerivedOutputs } from "@/contracts/sketch/offset-publication";
import {
  createSketchArrangementDeriver,
  offsetArrangementInput,
} from "@/contracts/sketch/region-extraction";
import { createCertifiedNeutralCurveQueryCapabilityForTest } from "@/domain/modeling/neutral-curve-certification/query";
import { createDocumentSolverTolerances } from "@/contracts/solver/schema";

const TAU = 1e-3;
/** Production tolerances: minimumSegmentLength = τ (review R-5). */
const DOCUMENT_TOLERANCES = createDocumentSolverTolerances({
  modelingTolerance: TAU,
  angularToleranceRadians: 1e-6,
});
/**
 * Mechanism tolerances (minimumSegmentLength 1e-6 < τ): the band where a
 * mirror axis shorter than τ is not yet a degenerate line (A2), so the
 * mirror's own failure is observed alone. Production cannot reach it.
 */
const MECHANISM_TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const;

type P = readonly [number, number];
const pid = (id: string) => `sketch_point_${id}` as SketchPointId;
const eid = (id: string) => `sketch_entity_${id}` as SketchEntityId;
const target = (id: string) => ({
  kind: "sketchEntity" as const,
  sketchId: "sketch_primary" as const,
  entityId: eid(id),
});
function point(id: string, position: P): SketchPointDefinition {
  return {
    pointId: pid(id),
    label: id,
    target: {
      kind: "sketchPoint",
      sketchId: "sketch_primary",
      pointId: pid(id),
    },
    position: [position[0], position[1]],
    isConstruction: false,
  } as SketchPointDefinition;
}
function line(id: string, a: string, b: string): SketchEntityDefinition {
  return {
    kind: "lineSegment",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    startPointId: pid(a),
    endPointId: pid(b),
  } as SketchEntityDefinition;
}
function pointEntity(id: string, p: string): SketchEntityDefinition {
  return {
    kind: "point",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    pointId: pid(p),
  } as SketchEntityDefinition;
}
function circle(id: string, c: string, radius: number): SketchEntityDefinition {
  return {
    kind: "circle",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    centerPointId: pid(c),
    radius,
  } as SketchEntityDefinition;
}
function arc(
  id: string,
  c: string,
  s: string,
  e: string,
  sweepDirection: "clockwise" | "counterClockwise",
): SketchEntityDefinition {
  return {
    kind: "arc",
    entityId: eid(id),
    label: id,
    target: target(id),
    isConstruction: false,
    centerPointId: pid(c),
    startPointId: pid(s),
    endPointId: pid(e),
    sweepDirection,
  } as SketchEntityDefinition;
}
type OutputSpec = readonly [
  string,
  string,
  readonly string[],
  readonly string[],
];
function output([seed, out, seedPoints, outputPoints]: OutputSpec) {
  return {
    seedEntityId: eid(seed),
    outputEntityId: eid(out),
    instanceIndex: 1,
    seedPointIds: seedPoints.map(pid),
    outputPointIds: outputPoints.map(pid),
  };
}
function mirror(
  id: string,
  axis: string | { datum: "xAxis" | "yAxis" },
  outputs: readonly OutputSpec[],
): SketchDerivationDefinition {
  return {
    kind: "mirror",
    derivationId: id,
    label: id,
    seedEntityIds: [...new Set(outputs.map(([seed]) => eid(seed)))],
    mirrorReference:
      typeof axis === "string"
        ? { kind: "lineEntity", entityId: eid(axis) }
        : { kind: "sketchDatum", datum: axis.datum },
    outputs: outputs.map(output),
  } as SketchDerivationDefinition;
}
function sketch(input: {
  points: readonly SketchPointDefinition[];
  entities: readonly SketchEntityDefinition[];
  relationships?: readonly SketchDerivationDefinition[];
  constraints?: readonly unknown[];
  dimensions?: readonly unknown[];
}): SketchDefinition {
  const constraints = (input.constraints ??
    []) as SketchDefinition["constraints"];
  const dimensions = (input.dimensions ?? []) as SketchDefinition["dimensions"];
  return {
    schemaVersion: "sketch-definition/v1alpha2",
    referenceIds: [],
    references: [],
    pointIds: input.points.map((entry) => entry.pointId),
    points: [...input.points],
    entityIds: input.entities.map((entry) => entry.entityId),
    entities: [...input.entities],
    constraintIds: constraints.map((entry) => entry.constraintId),
    constraints,
    dimensionIds: dimensions.map((entry) => entry.dimensionId),
    dimensions,
    derivedRelationships: [...(input.relationships ?? [])],
  } as SketchDefinition;
}
const lineLength = (id: string, entity: string, value: number) => ({
  dimensionId: `dimension_${id}` as DimensionId,
  kind: "lineLength",
  label: id,
  entityId: eid(entity),
  value,
});
const horizontal = (id: string, entity: string) => ({
  constraintId: `constraint_${id}` as ConstraintId,
  kind: "horizontal",
  label: id,
  entityId: eid(entity),
});
const solve = (
  definition: SketchDefinition,
  tolerances: typeof DOCUMENT_TOLERANCES = DOCUMENT_TOLERANCES,
) =>
  solveSketchDefinitionCore({
    definition,
    tolerances,
    modelingTolerance: TAU,
    partialSolvePolicy: "bestEffort",
  });
const solvedPoint = (snapshot: SolvedSketchSnapshot, id: string) =>
  snapshot.solvedPoints.find((entry) => entry.pointId === pid(id))!
    .solvedPosition;
const evaluatedPoint = (definition: SketchDefinition, id: string) =>
  definition.points.find((entry) => entry.pointId === pid(id))!.position;
const reflectY0 = (p: SketchPoint2D): SketchPoint2D => [p[0], -p[1]];
const errorCodes = (snapshot: SolvedSketchSnapshot) =>
  snapshot.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.code);
const profileGate = (snapshot: SolvedSketchSnapshot) => {
  const validity = deriveSketchValidity({ solvedSnapshot: snapshot });
  return {
    validity: validity.state,
    consumable: getConsumableSketchRegions({
      derivedValidity: validity,
      regions: [{} as never],
    }).length,
  };
};

/**
 * Seeds: line ab and circle c above the axis x0–x1 (y = 0); outputs mab and
 * mc stored stale; unrelated line u (free).
 */
function lineAndCircle(axis: "x0-x1" | "missing" | "short" | "zero" = "x0-x1") {
  const axisEnd: P =
    axis === "short" ? [-1 + 5e-4, 0] : axis === "zero" ? [-1, 0] : [6, 0];
  return {
    points: [
      point("a", [1, 1]),
      point("b", [3, 2]),
      point("c", [2, 3]),
      point("x0", [-1, 0]),
      point("x1", axisEnd),
      point("ma", [7, 7]),
      point("mb", [8, 8]),
      point("mc", [9, 9]),
      point("u0", [10, 10]),
      point("u1", [12, 11]),
    ],
    entities: [
      line("ab", "a", "b"),
      circle("c", "c", 1),
      ...(axis === "missing" ? [] : [line("axis", "x0", "x1")]),
      line("mab", "ma", "mb"),
      circle("mc", "mc", 1),
      line("u", "u0", "u1"),
    ],
    relationships: [
      mirror("m", "axis", [
        ["ab", "mab", ["a", "b"], ["ma", "mb"]],
        ["c", "mc", ["c"], ["mc"]],
      ]),
    ],
  };
}

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

// ---------------------------------------------------------------------------
// T15c: axis preference and driven exact reach. Logic lane; seams: the
// compiled solve session (drag frames, DOF probe) and the batch solve.

const RELEASE_TOLERANCE = 1e-4;
const at = (snapshot: SolvedSketchSnapshot, ids: readonly string[]) =>
  Object.fromEntries(ids.map((id) => [id, solvedPoint(snapshot, id)]));
const distance = (left: SketchPoint2D, right: SketchPoint2D) =>
  Math.hypot(right[0] - left[0], right[1] - left[1]);
/** R(p) across the line through `start` and `end`. */
const reflectAcross = (
  p: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
): SketchPoint2D => {
  const d = [end[0] - start[0], end[1] - start[1]] as const;
  const t =
    ((p[0] - start[0]) * d[0] + (p[1] - start[1]) * d[1]) /
    (d[0] * d[0] + d[1] * d[1]);
  return [2 * (start[0] + t * d[0]) - p[0], 2 * (start[1] + t * d[1]) - p[1]];
};
const fixPoint = (id: string, p: string, position: P) => ({
  constraintId: `constraint_${id}` as ConstraintId,
  kind: "fixPoint",
  label: id,
  pointId: pid(p),
  position: [position[0], position[1]],
});
const coincident = (id: string, first: string, second: string) => ({
  constraintId: `constraint_${id}` as ConstraintId,
  kind: "coincident",
  label: id,
  pointIds: [pid(first), pid(second)],
});
const pointDistance = (
  id: string,
  first: string,
  second: string,
  value: number,
) => ({
  dimensionId: `dimension_${id}` as DimensionId,
  kind: "distance",
  axis: "aligned",
  label: id,
  pointIds: [pid(first), pid(second)],
  value,
});
function startSession(definition: SketchDefinition) {
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_t15c",
    program: compileSketchSolveProgram({
      definition,
      tolerances: DOCUMENT_TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "failOnConflict",
    }),
  });
  if (started.kind !== "started")
    throw new Error(`session did not start: ${started.diagnostic?.code}`);
  return started.session;
}
type T15cSession = ReturnType<typeof startSession>;
/** One editor point drag: a preview frame, then the release frame (d1). */
function dragPoint(session: T15cSession, id: string, position: SketchPoint2D) {
  const preview = updateCompiledSketchSolveSession(
    session,
    { kind: "sketchPoint", pointId: pid(id), position },
    null,
  );
  const release = updateCompiledSketchSolveSession(
    session,
    { kind: "sketchPoint", pointId: pid(id), position },
    RELEASE_TOLERANCE,
  );
  return { preview, release, snapshot: release.solvedSnapshot! };
}
/** The line-and-circle mirror (axis x0–x1 on y = 0, free) with `extra` requirements. */
function freeAxis(constraints: unknown[] = [], dimensions: unknown[] = []) {
  return sketch({
    ...lineAndCircle(),
    constraints: [horizontal("u_h", "u"), ...constraints],
    dimensions,
  });
}
const AXIS = ["x0", "x1"] as const;

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

// T15c review fixes (R-1, R-2, R-3).

/** Seed end b tied to axis end x1 by a coincident constraint (not a shared point). */
function coincidentAxisEnd() {
  return sketch({
    points: [
      point("a", [1, 1]),
      point("b", [6, 0]),
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
    constraints: [coincident("bx1", "b", "x1")],
  });
}
/** Axis O = offset(S, 1) of a free line S; L mirrored across O (and S itself too when `alsoMirrorS`). */
function derivedOffsetAxis(alsoMirrorS: boolean) {
  return sketch({
    points: [
      point("a", [0, 0]),
      point("b", [6, 0]),
      point("o0", [9, 9]),
      point("o1", [9, 9]),
      point("c", [1, 3]),
      point("d", [3, 4]),
      point("mc", [0, 0]),
      point("md", [0, 0]),
      point("ms0", [0, 0]),
      point("ms1", [0, 0]),
    ],
    entities: [
      line("S", "a", "b"),
      line("O", "o0", "o1"),
      line("L", "c", "d"),
      line("ML", "mc", "md"),
      ...(alsoMirrorS ? [line("MS", "ms0", "ms1")] : []),
    ],
    relationships: [
      {
        kind: "offset",
        derivationId: "o",
        label: "o",
        seedEntityIds: [eid("S")],
        distance: 1,
        jointPolicy: "trimExtendArcFallback",
        jointOutputs: [],
        piecewiseCubicOutputs: [],
        outputs: [output(["S", "O", ["a", "b"], ["o0", "o1"]])],
      } as SketchDerivationDefinition,
      mirror("m", "O", [
        ["L", "ML", ["c", "d"], ["mc", "md"]],
        ...(alsoMirrorS
          ? ([["S", "MS", ["a", "b"], ["ms0", "ms1"]]] as const)
          : []),
      ]),
    ],
  });
}
/** Axis S′ = the mirror copy of S across A; L mirrored across S′. */
function derivedMirrorAxis() {
  return sketch({
    points: [
      point("a", [0, 2]),
      point("b", [6, 3]),
      point("x0", [-1, 0]),
      point("x1", [8, 0]),
      point("s0", [0, 0]),
      point("s1", [0, 0]),
      point("c", [1, -5]),
      point("d", [3, -6]),
      point("mc", [0, 0]),
      point("md", [0, 0]),
    ],
    entities: [
      line("S", "a", "b"),
      line("axis", "x0", "x1"),
      line("SP", "s0", "s1"),
      line("L", "c", "d"),
      line("ML", "mc", "md"),
    ],
    relationships: [
      mirror("m1", "axis", [["S", "SP", ["a", "b"], ["s0", "s1"]]]),
      mirror("m2", "SP", [["L", "ML", ["c", "d"], ["mc", "md"]]]),
    ],
  });
}
/** A drag by `delta` of `id`: how far the preview and the release moved it, and its free DOF. */
function dragBy(definition: SketchDefinition, id: string, delta: P) {
  const session = startSession(definition);
  const start = session.lastAcceptedSnapshot;
  const from = solvedPoint(start, id);
  const cursor: SketchPoint2D = [from[0] + delta[0], from[1] + delta[1]];
  const { preview, release, snapshot } = dragPoint(session, id, cursor);
  return {
    start,
    snapshot,
    kinds: [preview.kind, release.kind],
    previewLag: distance(solvedPoint(preview.solvedSnapshot!, id), cursor),
    releaseLag: distance(solvedPoint(snapshot, id), cursor),
    freeDof: sketchDraggedPointHasFreeDof(session, pid(id)),
  };
}

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
