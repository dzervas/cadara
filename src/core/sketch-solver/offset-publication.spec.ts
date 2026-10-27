import { sketchDraggedPointHasFreeDof } from "./free-dof";
import {
  blockedDiagnostics,
  circleOffsetDefinition,
  circleOffsetSketch,
  collapsedOffsetWithDependent,
  constraintStatusOf,
  dragSeedRadiusSession,
  failedOffsetLineAsMirrorAxis,
  fixPointConstraint,
  OFFSET_ROW_TOLERANCES,
  offsetFailureIds,
  planIds,
  pointOf,
  pointOnCircleConstraint,
  publishOnce,
  solveCoreAndLive,
  solvedCircleRadius,
  statusOf,
} from "./offset-publication.fixtures";
import type { SolvedSketchSnapshotForTest } from "./offset-publication.fixtures";
import { solveSketchDefinitionCore } from "./solve-sketch";
import type { DimensionId } from "@/contracts/shared/ids";
import { evaluateSketchDerivations } from "@/contracts/sketch/derived-geometry";
import { OFFSET_DIAGNOSTIC_CODES } from "@/contracts/sketch/offset-geometry";
import type { NumericSketchDefinition as SketchDefinition } from "@/contracts/sketch/schema";
import { expect, test } from "vitest";

// [TECH] G16′ (T08b-g7b, U-G9) re-pins both T08b-g6 R1 rows: an offset
// relationship's failure is relationship-scoped. The sketch stays solved,
// its snapshot never carries the failure (E1 reads it), and the publication
// round lists it exactly once (the "listed once" contract of R1).
test("T08b-g6 review R1 + T08b-g7b (G16′): a deleted offset seed's unsupported-seed diagnostic is listed once, by the relationship's publication, and the sketch stays solved (core solve and session live solve)", () => {
  const definition = circleOffsetDefinition({ deleteSeed: true });
  const { compiled, core, live } = solveCoreAndLive(definition);
  const missingSeed = OFFSET_DIAGNOSTIC_CODES.unsupportedSeed;
  expect(
    compiled,
    "the compiled program lists no relationship failure (G16′)",
  ).toEqual([]);
  for (const [label, snapshot] of [
    ["core solve", core],
    ["live solve", live],
  ] as const) {
    expect(snapshot.diagnostics, label).toEqual([]);
    expect(snapshot.status, label).toEqual({
      solveState: "solved",
      constraintState: "underConstrained",
    });
    expect(publishOnce(definition, snapshot), label).toEqual([
      ["derivation_offset_circle", "failed", missingSeed],
    ]);
  }
});

test("T08b-g6 review R1 + T08b-g7b (G16′): a projection-only offset failure (the solved seed radius collapses the offset) is listed once, by the relationship's publication, and no longer makes the sketch's geometry invalid", () => {
  const definition = circleOffsetDefinition({ seedRadius: 0.5 });
  const { compiled, core, live } = solveCoreAndLive(definition);
  expect(compiled, "premise: nothing collapses at the authored radius").toEqual(
    [],
  );
  for (const [label, snapshot] of [
    ["core solve", core],
    ["live solve", live],
  ] as const) {
    expect(snapshot.diagnostics, label).toEqual([]);
    expect(snapshot.status, label).toEqual({
      solveState: "solved",
      constraintState: "underConstrained",
    });
    expect(
      snapshot.solvedPoints.find(
        (point) => point.pointId === "sketch_point_output",
      )?.solvedPosition,
      `${label}: the collapsed offset's output is held`,
    ).toEqual([0, 0]);
    expect(publishOnce(definition, snapshot), label).toEqual([
      [
        "derivation_offset_circle",
        "failed",
        OFFSET_DIAGNOSTIC_CODES.arcCollapse,
      ],
    ]);
  }
});

// [TECH] G16′ (T08b-g7b): the frozen-points property (a failed offset's
// driven outputs keep their held values) is structural (they are never
// authority variables and every requirement zeroes their gradient), checked
// here for every solver strategy, including the Gauss-Newton fallback after
// an unaccepted BFGS solve and the damped Levenberg-Marquardt path.
test("T08b-g7b: a failed offset's outputs stay bitwise held under BFGS, its Gauss-Newton fallback, Gauss-Newton and damped Levenberg-Marquardt", () => {
  const collapsing = circleOffsetDefinition({ seedRadius: 0.5 });
  const conflicting: SketchDefinition = {
    ...collapsing,
    dimensionIds: [...collapsing.dimensionIds, "dimension_seed_radius_b"],
    dimensions: [
      ...collapsing.dimensions,
      {
        dimensionId: "dimension_seed_radius_b",
        kind: "circleRadius",
        label: "Conflicting seed radius",
        entityId: "sketch_entity_seed",
        value: 0.6,
      },
    ],
  };
  const held = (
    snapshot: SolvedSketchSnapshotForTest,
  ): [readonly number[] | undefined, number | undefined] => {
    const output = snapshot.solvedEntities.find(
      (entity) => entity.entityId === "sketch_entity_output",
    );
    return [
      snapshot.solvedPoints.find(
        (point) => point.pointId === "sketch_point_output",
      )?.solvedPosition,
      output?.kind === "circle" ? output.solvedRadius : undefined,
    ];
  };
  for (const [label, definition, strategy] of [
    ["bfgs", collapsing, "bfgs"],
    ["bfgs → Gauss-Newton fallback", conflicting, "bfgs"],
    ["gaussNewton", collapsing, "gaussNewton"],
    ["levenbergMarquardt (damped)", collapsing, "levenbergMarquardt"],
    [
      "levenbergMarquardt (damped), conflicting",
      conflicting,
      "levenbergMarquardt",
    ],
  ] as const) {
    const result = solveSketchDefinitionCore({
      definition,
      tolerances: {
        coincidence: 1e-6,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-6,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      strategy,
    });
    const seed = result.solvedSnapshot.solvedEntities.find(
      (entity) => entity.entityId === "sketch_entity_seed",
    );
    expect(
      seed?.kind === "circle" ? seed.solvedRadius : null,
      `${label}: premise, the solver moved the seed radius off its authored 2`,
    ).not.toBe(2);
    expect(
      result.solvedSnapshot.offsetFramePlans,
      `${label}: premise, the offset failed at the final values`,
    ).toEqual([]);
    if (label.includes("conflicting") || label.includes("fallback"))
      expect(
        result.status.solveState,
        `${label}: premise, BFGS is not accepted (so its Gauss-Newton fallback ran)`,
      ).toBe("partiallySolved");
    expect(held(result.solvedSnapshot), `${label}: outputs held`).toEqual([
      [0, 0],
      1,
    ]);
  }
});

// [TECH] G16‴ (T08b-g7b review B1): the blocked set is decided on the
// solve's start state. A requirement on an offset output whose relationship
// builds at the start is never dropped by the solver stepping into a
// failure: the failure is unbounded at that iterate (never a reward).
test("T08b-g7b review B1 ([TECH] G16‴): a requirement on an offset output that builds at the start never escapes into a failure: circle r = 10, inward offset 1, output diameter 2 solves the seed to radius 2, driving and certified (core solve and live session)", () => {
  const definition = circleOffsetDefinition({
    authoredSeedRadius: 10,
    authoredOutputRadius: 9,
    outputDiameter: 2,
  });
  expect(
    evaluateSketchDerivations({ definition, modelingTolerance: 1e-3 })
      .offsetFailures,
    "premise: the offset builds at the start",
  ).toEqual([]);
  const { core, live } = solveCoreAndLive(definition);
  for (const [label, snapshot] of [
    ["core solve", core],
    ["live solve", live],
  ] as const) {
    expect(snapshot.status, label).toEqual({
      solveState: "solved",
      constraintState: "underConstrained",
    });
    expect(
      solvedCircleRadius(snapshot, "sketch_entity_seed")! - 2,
      `${label}: the seed solves to the feasible radius 2`,
    ).toBeCloseTo(0, 6);
    expect(statusOf(snapshot, "dimension_output_diameter"), label).toBe(
      "driving",
    );
    expect(snapshot.diagnostics, label).toEqual([]);
    expect(publishOnce(definition, snapshot), label).toEqual([
      ["derivation_offset_circle", "certified", undefined],
    ]);
  }
});

test("T08b-g7b review B1 ([TECH] G16‴): every escape cell of the review solves under BFGS: seed r ∈ {1.2, 3, 10}, inward offset 1, output diameter 2v reaches the feasible seed radius 1 + v, driving, with the frame built", () => {
  for (const [seedRadius, v] of [
    [1.2, 0.15],
    [1.2, 0.1],
    [1.2, 0.05],
    [1.2, 0.01],
    [1.2, 0.001],
    [3, 0.01],
    [3, 0.5],
    [10, 0.01],
    [10, 1],
  ] as const) {
    const label = `seed r ${seedRadius}, output radius ${v}`;
    const snapshot = solveSketchDefinitionCore({
      definition: circleOffsetDefinition({
        authoredSeedRadius: seedRadius,
        authoredOutputRadius: seedRadius - 1,
        outputDiameter: 2 * v,
      }),
      tolerances: OFFSET_ROW_TOLERANCES,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      strategy: "bfgs",
    }).solvedSnapshot;
    expect(snapshot.status.solveState, label).toBe("solved");
    expect(
      solvedCircleRadius(snapshot, "sketch_entity_seed")! - (1 + v),
      label,
    ).toBeCloseTo(0, 6);
    expect(statusOf(snapshot, "dimension_output_diameter"), label).toBe(
      "driving",
    );
    expect(
      snapshot.offsetFramePlans?.map((plan) => plan.derivationId),
      `${label}: the frame built at the final values`,
    ).toEqual(["derivation_offset_circle"]);
  }
});

test("T08b-g7b review B1 ([TECH] G16‴): an offset already failed at the solve's start keeps the requirement on its output blocked and the sketch solved", () => {
  const definition = circleOffsetDefinition({
    authoredSeedRadius: 0.5,
    authoredOutputRadius: 1,
    seedRadius: 0.5,
    outputDiameter: 2,
  });
  expect(
    evaluateSketchDerivations({
      definition,
      modelingTolerance: 1e-3,
    }).offsetFailures.map((failure) => failure.diagnostic.code),
    "premise: the offset is collapsed at the start",
  ).toEqual([OFFSET_DIAGNOSTIC_CODES.arcCollapse]);
  const { core, live } = solveCoreAndLive(definition);
  for (const [label, snapshot] of [
    ["core solve", core],
    ["live solve", live],
  ] as const) {
    expect(snapshot.status, label).toEqual({
      solveState: "solved",
      constraintState: "underConstrained",
    });
    expect(statusOf(snapshot, "dimension_output_diameter"), label).toBe(
      "blocked",
    );
    expect(statusOf(snapshot, "dimension_seed_radius"), label).toBe("driving");
    expect(
      snapshot.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.target,
      ]),
      label,
    ).toEqual([
      [
        "derived-offset-requirement-blocked",
        { kind: "dimension", dimensionId: "dimension_output_diameter" },
      ],
    ]);
    expect(publishOnce(definition, snapshot), label).toEqual([
      [
        "derivation_offset_circle",
        "failed",
        OFFSET_DIAGNOSTIC_CODES.arcCollapse,
      ],
    ]);
  }
});

test("T08b-g7b review B1 ([TECH] G16‴): a drag frame pulling the seed toward collapse keeps the requirement on the offset output: the frame solves with the seed held at radius 2, the requirement driving and the frame built, never blocked-and-solved", () => {
  // Dragging P toward the centre would shrink the seed below the offset
  // distance, which the output diameter forbids.
  const { session, drag } = dragSeedRadiusSession(2);
  expect(
    statusOf(session.lastAcceptedSnapshot, "dimension_output_diameter"),
    "premise: the requirement holds at the drag start",
  ).toBe("driving");
  for (const target of [
    [1.2, 0],
    [0.5, 0],
    [0.2, 0.1],
  ] as const) {
    const label = `drag P to ${target.join(", ")}`;
    const frame = drag(target);
    expect(frame.kind, label).toBe("solved");
    const snapshot = frame.solvedSnapshot!;
    expect(snapshot.status.solveState, label).toBe("solved");
    expect(statusOf(snapshot, "dimension_output_diameter"), label).toBe(
      "driving",
    );
    expect(
      solvedCircleRadius(snapshot, "sketch_entity_seed")! - 2,
      `${label}: the seed is held at the feasible radius`,
    ).toBeCloseTo(0, 6);
    expect(
      snapshot.offsetFramePlans?.map((plan) => plan.derivationId),
      `${label}: the frame built`,
    ).toEqual(["derivation_offset_circle"]);
    expect(blockedDiagnostics(snapshot), label).toEqual([]);
  }
});

test("T08b-g7b review B1 ([TECH] G16‴): each drag frame decides its blocked set at its own start: with the offset collapsed at the frame start the requirement on its output stays blocked and the frame solves (the seed follows P)", () => {
  const { session, drag } = dragSeedRadiusSession(0.5);
  expect(
    statusOf(session.lastAcceptedSnapshot, "dimension_output_diameter"),
    "premise: the offset is collapsed at the session start",
  ).toBe("blocked");
  const collapsed = drag([0.6, 0]);
  expect(collapsed.kind).toBe("solved");
  const inside = collapsed.solvedSnapshot!;
  expect(inside.status.solveState).toBe("solved");
  expect(statusOf(inside, "dimension_output_diameter")).toBe("blocked");
  expect(
    blockedDiagnostics(inside).map((diagnostic) => diagnostic.target),
  ).toEqual([{ kind: "dimension", dimensionId: "dimension_output_diameter" }]);
  expect(
    solvedCircleRadius(inside, "sketch_entity_seed")! - 0.6,
    "the seed follows P inside the collapse (the cursor is a soft target)",
  ).toBeCloseTo(0, 4);
});

// [TECH] G16′ (T08b-g7b review R2): blocking follows derived outputs
// transitively: a requirement on a mirror or pattern of a failed offset's
// output, or on a mirror whose axis is a failed offset's output, is blocked.
test("T08b-g7b review R2: a requirement reaching a failed offset's output through a mirror, a linear pattern or a mirror axis is blocked and the sketch stays solved (core solve and live session)", () => {
  for (const kind of ["mirror", "linearPattern"] as const) {
    const { core, live } = solveCoreAndLive(collapsedOffsetWithDependent(kind));
    for (const [label, snapshot] of [
      [`${kind} core solve`, core],
      [`${kind} live solve`, live],
    ] as const) {
      expect(snapshot.status.solveState, label).toBe("solved");
      expect(statusOf(snapshot, "dimension_dependent_radius"), label).toBe(
        "blocked",
      );
      expect(
        snapshot.diagnostics.map((diagnostic) => [
          diagnostic.code,
          diagnostic.target,
        ]),
        label,
      ).toEqual([
        [
          "derived-offset-requirement-blocked",
          { kind: "dimension", dimensionId: "dimension_dependent_radius" },
        ],
      ]);
    }
  }
  const control = solveCoreAndLive(failedOffsetLineAsMirrorAxis(true));
  expect(
    control.core.constraintStatuses.find(
      (status) => status.constraintId === "constraint_fix_mirrored",
    )?.status,
    "control: with the axis's offset built the fix is ordinary",
  ).toBe("satisfied");
  const { core, live } = solveCoreAndLive(failedOffsetLineAsMirrorAxis(false));
  for (const [label, snapshot] of [
    ["mirror axis core solve", core],
    ["mirror axis live solve", live],
  ] as const) {
    expect(snapshot.status.solveState, label).toBe("solved");
    expect(
      snapshot.constraintStatuses.find(
        (status) => status.constraintId === "constraint_fix_mirrored",
      )?.status,
      label,
    ).toBe("blocked");
    expect(
      snapshot.diagnostics.map((diagnostic) => [
        diagnostic.code,
        diagnostic.target,
      ]),
      label,
    ).toEqual([
      [
        "derived-offset-requirement-blocked",
        { kind: "constraint", constraintId: "constraint_fix_mirrored" },
      ],
    ]);
  }
});

// [TECH] G16‴ (T08b-g7b re-review Q1): a failure that appears during the
// solve and still holds at the end is reported `unsatisfied`, never
// `blocked`. A +∞ start loss from an unrelated record (a second offset
// whose seed arc starts on its centre) lets the line search accept the
// jump of the circle seed into its collapse.
test("T08b-g7b re-review Q1 ([TECH] G16‴): an offset that builds at the start and has failed at the end of the solve leaves the requirement on its output unsatisfied, never blocked (core solve and live session)", () => {
  const definition = circleOffsetSketch({
    circles: [
      ["seed", 10],
      ["output", 9],
    ],
    points: [
      ["arc_center", [50, 0]],
      ["arc_start", [50, 0]],
      ["arc_end", [52, 0]],
    ],
    dimensions: [["output", "diameter", 2]],
    offsets: [["derivation_offset_circle", "seed", "output"]],
    extra: {
      points: [],
      entities: [
        {
          kind: "arc",
          entityId: "sketch_entity_degenerate",
          label: "degenerate",
          target: {
            kind: "sketchEntity",
            sketchId: "sketch_primary",
            entityId: "sketch_entity_degenerate",
          },
          isConstruction: false,
          centerPointId: "sketch_point_arc_center",
          startPointId: "sketch_point_arc_start",
          endPointId: "sketch_point_arc_end",
          sweepDirection: "counterClockwise",
        },
      ] as unknown as SketchDefinition["entities"],
      derivedRelationships: [
        {
          derivationId: "derivation_offset_degenerate",
          kind: "offset",
          label: "Degenerate offset",
          seedEntityIds: ["sketch_entity_degenerate"],
          distance: 0.1,
          jointPolicy: "trimExtendArcFallback",
          piecewiseCubicOutputs: [],
          jointOutputs: [],
          outputs: [],
        },
      ] as unknown as SketchDefinition["derivedRelationships"],
    },
  });
  expect(
    offsetFailureIds(definition),
    "premise: only the degenerate offset fails at the start, so the circle offset is not in the blocked set",
  ).toEqual([
    ["derivation_offset_degenerate", OFFSET_DIAGNOSTIC_CODES.arcCollapse],
  ]);
  const { core, live } = solveCoreAndLive(definition);
  for (const [label, snapshot] of [
    ["core solve", core],
    ["live solve", live],
  ] as const) {
    expect(
      planIds(snapshot),
      `${label}: premise, the circle offset has failed at the end`,
    ).toEqual([]);
    expect(statusOf(snapshot, "dimension_output"), label).toBe("unsatisfied");
    expect(blockedDiagnostics(snapshot), label).toEqual([]);
    expect(snapshot.status, label).toEqual({
      solveState: "partiallySolved",
      constraintState: "inconsistent",
    });
    expect(
      snapshot.diagnostics.map((diagnostic) => diagnostic.code),
      `${label}: the unaccepted snapshot reports both relationships' failures and the negative solved radius`,
    ).toEqual([
      "offset-arc-common-circle-unsatisfied",
      // B12: the seed circle solved to a negative radius.
      "invalid-solved-circle-radius",
      OFFSET_DIAGNOSTIC_CODES.arcCollapse,
      OFFSET_DIAGNOSTIC_CODES.arcCollapse,
    ]);
  }
});

// [TECH] G16‴ (T08b-g7b re-review Q2): each DOF probe frame is a solve
// from the session's values, so a session whose offset is collapsed at the
// start keeps the requirement on its output blocked in the probes and the
// point on the seed reads as free.
test("T08b-g7b re-review Q2 ([TECH] G16‴): the DOF probe decides its blocked set at the session's values: P on a seed collapsed at the start is free (control: the seed at radius 2)", () => {
  for (const seedRadius of [0.5, 2]) {
    const { session } = dragSeedRadiusSession(seedRadius);
    expect(
      sketchDraggedPointHasFreeDof(
        session,
        "sketch_point_on_seed" as SketchDefinition["pointIds"][number],
      ),
      `seed radius ${seedRadius}`,
    ).toBe(true);
  }
});

// [TECH] G16⁗ (T08b-g7b re-review A-1, barrier on rebuild): a requirement
// held blocked by an offset that failed at the start gets no real residual
// in that solve, so the loss never rewards staying failed; when the offset
// builds at the end, the solve is re-evaluated and, if needed, re-solved
// once from there with the offset no longer blocked.
test("T08b-g7b re-review A-1 ([TECH] G16⁗): seed collapsed at the start, seed dimension 3 and output diameter 4 (consistent once rebuilt) reach the rebuilt solution under BFGS, Gauss-Newton and Levenberg-Marquardt with no wrongly unsatisfied seed dimension", () => {
  const definition = circleOffsetDefinition({
    authoredSeedRadius: 0.5,
    authoredOutputRadius: 1,
    seedRadius: 3,
    outputDiameter: 4,
  });
  expect(
    offsetFailureIds(definition),
    "premise: the offset is collapsed at the start",
  ).toEqual([
    ["derivation_offset_circle", OFFSET_DIAGNOSTIC_CODES.arcCollapse],
  ]);
  // The same seed dimension with no offset relationship: what each strategy
  // reaches on it alone (Gauss-Newton and Levenberg-Marquardt stop about
  // 1e-4 short on a plain dimension, the pre-existing A5).
  const offsetFree: SketchDefinition = {
    ...definition,
    dimensionIds: ["dimension_seed_radius" as DimensionId],
    dimensions: definition.dimensions.filter(
      (dimension) => dimension.dimensionId === "dimension_seed_radius",
    ),
    derivedRelationships: [],
  };
  const solve = (
    input: SketchDefinition,
    strategy: "bfgs" | "gaussNewton" | "levenbergMarquardt",
  ) =>
    solveSketchDefinitionCore({
      definition: input,
      tolerances: OFFSET_ROW_TOLERANCES,
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort",
      strategy,
    }).solvedSnapshot;
  for (const strategy of [
    "bfgs",
    "gaussNewton",
    "levenbergMarquardt",
  ] as const) {
    const snapshot = solve(definition, strategy);
    const control = solve(offsetFree, strategy);
    const seed = solvedCircleRadius(snapshot, "sketch_entity_seed")!;
    expect(
      Math.abs(seed - 3),
      `${strategy}: the seed leaves the collapse and reaches its dimension`,
    ).toBeLessThan(1e-3);
    expect(
      seed,
      `${strategy}: the seed is where this strategy puts it with no offset at all`,
    ).toBe(solvedCircleRadius(control, "sketch_entity_seed"));
    expect(
      statusOf(snapshot, "dimension_seed_radius"),
      `${strategy}: the seed dimension reads as it does with no offset at all`,
    ).toBe(statusOf(control, "dimension_seed_radius"));
    expect(planIds(snapshot), `${strategy}: the offset rebuilt`).toEqual([
      "derivation_offset_circle",
    ]);
    expect(
      snapshot.dimensionStatuses.find(
        (status) => status.dimensionId === "dimension_output_diameter",
      )?.solvedValue,
      `${strategy}: the output follows the rebuilt offset`,
    ).toBeCloseTo(2 * (seed - 1), 12);
    expect(
      statusOf(snapshot, "dimension_output_diameter"),
      `${strategy}: the output dimension uses its real residual`,
    ).not.toBe("blocked");
    expect(blockedDiagnostics(snapshot), strategy).toEqual([]);
  }
  const { core, live } = solveCoreAndLive(definition);
  for (const [label, snapshot] of [
    ["core solve", core],
    ["live solve", live],
  ] as const) {
    expect(snapshot.status, label).toEqual({
      solveState: "solved",
      constraintState: "underConstrained",
    });
    expect(statusOf(snapshot, "dimension_seed_radius"), label).toBe("driving");
    expect(statusOf(snapshot, "dimension_output_diameter"), label).toBe(
      "driving",
    );
    expect(snapshot.diagnostics, label).toEqual([]);
    expect(publishOnce(definition, snapshot), label).toEqual([
      ["derivation_offset_circle", "certified", undefined],
    ]);
  }
});

test("T08b-g7b re-review A-1 ([TECH] G16⁗): a batch solve whose other requirements pull the seed out of the collapse re-solves once from there: P fixed at (3, 0) or (1.5, 0) on a free seed, output diameter 2 solves the seed to radius 2 (core solve and live session)", () => {
  for (const x of [3, 1.5]) {
    const definition = circleOffsetSketch({
      circles: [
        ["seed", 0.5],
        ["output", 1],
      ],
      points: [["p", [x, 0]]],
      constraints: [
        fixPointConstraint("fix_p", "p", [x, 0]),
        pointOnCircleConstraint("p_on_seed", "p", "seed"),
      ],
      dimensions: [["output", "diameter", 2]],
      offsets: [["derivation_offset_circle", "seed", "output"]],
    });
    expect(offsetFailureIds(definition), "premise").toEqual([
      ["derivation_offset_circle", OFFSET_DIAGNOSTIC_CODES.arcCollapse],
    ]);
    const { core, live } = solveCoreAndLive(definition);
    for (const [label, snapshot] of [
      [`P at ${x}: core solve`, core],
      [`P at ${x}: live solve`, live],
    ] as const) {
      expect(snapshot.status, label).toEqual({
        solveState: "solved",
        constraintState: "underConstrained",
      });
      expect(
        solvedCircleRadius(snapshot, "sketch_entity_seed")! - 2,
        `${label}: the seed solves to the radius the output diameter needs`,
      ).toBeCloseTo(0, 6);
      expect(statusOf(snapshot, "dimension_output"), label).toBe("driving");
      expect(snapshot.diagnostics, label).toEqual([]);
      expect(publishOnce(definition, snapshot), label).toEqual([
        ["derivation_offset_circle", "certified", undefined],
      ]);
    }
  }
});

test("T08b-g7b re-review A-1 ([TECH] G16⁗): a drag pulls the seed back out of the collapse: frames to (1.5, 0) and (3, 0) solve with the seed at the radius the output needs, and dragging back in holds it there", () => {
  const { session, drag } = dragSeedRadiusSession(0.5);
  expect(
    statusOf(session.lastAcceptedSnapshot, "dimension_output_diameter"),
    "premise: the offset is collapsed at the session start",
  ).toBe("blocked");
  for (const target of [
    [1.5, 0],
    [3, 0],
    [0.3, 0],
  ] as const) {
    const label = `drag P to ${target.join(", ")}`;
    const frame = drag(target);
    expect(frame.kind, label).toBe("solved");
    const snapshot = frame.solvedSnapshot!;
    expect(snapshot.status.solveState, label).toBe("solved");
    expect(
      solvedCircleRadius(snapshot, "sketch_entity_seed")! - 2,
      `${label}: the seed is at the radius the output diameter needs`,
    ).toBeCloseTo(0, 6);
    expect(statusOf(snapshot, "dimension_output_diameter"), label).toBe(
      "driving",
    );
    expect(planIds(snapshot), `${label}: the frame built`).toEqual([
      "derivation_offset_circle",
    ]);
    expect(blockedDiagnostics(snapshot), label).toEqual([]);
  }
});

// Two offsets collapsed at the start; B rebuilds only in A's re-solve. The
// re-solve is bounded to one: B's requirement is then judged on its real
// residual (unsatisfied, never blocked), so the re-solve is not accepted
// and the first result is kept.
test("T08b-g7b re-review A-1 ([TECH] G16⁗): at most one re-solve per solve: an offset that rebuilds only in the re-solve is judged on its real residual and never triggers a second re-solve (core solve and live session)", () => {
  const definition = circleOffsetSketch({
    circles: [
      ["a_seed", 0.5],
      ["a_output", 1],
      ["b_seed", 0.5],
      ["b_output", 1],
    ],
    points: [
      ["t", [0.5, 0]],
      ["q", [5, 5]],
    ],
    constraints: [
      fixPointConstraint("fix_a_seed", "a_seed", [0, 0]),
      fixPointConstraint("fix_b_seed", "b_seed", [0, 0]),
      pointOnCircleConstraint("t_on_a_output", "t", "a_output"),
      pointOnCircleConstraint("t_on_b_seed", "t", "b_seed"),
      {
        constraintId: "constraint_q_on_b_output_center",
        kind: "coincident",
        label: "q on B's output centre",
        pointIds: ["sketch_point_q", "sketch_point_b_output"],
      },
    ],
    dimensions: [["a_seed", "circleRadius", 3]],
    offsets: [
      ["derivation_a", "a_seed", "a_output"],
      ["derivation_b", "b_seed", "b_output"],
    ],
  });
  expect(
    offsetFailureIds(definition),
    "premise: both collapse at the start",
  ).toEqual([
    ["derivation_a", OFFSET_DIAGNOSTIC_CODES.arcCollapse],
    ["derivation_b", OFFSET_DIAGNOSTIC_CODES.arcCollapse],
  ]);
  const { core, live } = solveCoreAndLive(definition);
  for (const [label, snapshot] of [
    ["core solve", core],
    ["live solve", live],
  ] as const) {
    expect(snapshot.status.solveState, label).toBe("partiallySolved");
    expect(
      planIds(snapshot),
      `${label}: the first result is kept (A rebuilt, B still collapsed)`,
    ).toEqual(["derivation_a"]);
    expect(solvedCircleRadius(snapshot, "sketch_entity_a_seed"), label).toBe(3);
    expect(solvedCircleRadius(snapshot, "sketch_entity_b_seed"), label).toBe(
      0.5,
    );
    expect(pointOf(snapshot, "sketch_point_t"), label).toEqual([0.5, 0]);
    expect(pointOf(snapshot, "sketch_point_q"), label).toEqual([5, 5]);
    expect(
      constraintStatusOf(snapshot, "constraint_t_on_a_output"),
      `${label}: A's requirement uses its real residual`,
    ).toBe("unsatisfied");
    expect(
      constraintStatusOf(snapshot, "constraint_q_on_b_output_center"),
      `${label}: B is still collapsed in the kept result`,
    ).toBe("blocked");
  }
});
