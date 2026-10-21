// T13e2, logic lane, solver-core seam (`solveSketchDefinitionCore` and the
// solver trace): conflicting requirements are rejected instead of accepted
// through the tolerances.
// - A1: a horizontal/vertical line is judged by direction too, so a corner
//   angle cannot collapse a rectangle side to ≈ τ and tilt it freely.
// - A2: a solved line shorter than the minimum segment length is degenerate.
// - B1: an orientation requirement keeps its positional effect within τ over
//   the lever of its line's extension, so a conflict is not absorbed by
//   sliding kilometres along it; B4: a rejected result is the minimum-motion
//   compromise near the start.
// - C1–C3: the Gauss–Newton fallback continues from BFGS's result, stops when
//   it makes no progress, and does not run when BFGS is accepted.
// Every conflicting row has a consistent control in the same sketch.
import { expect, test } from "vitest";

import type { DimensionId } from "@/contracts/shared/ids";
// T17p2 (F-2): the solver works on resolved definitions.
import type {
  ConstraintDefinition,
  NumericDimensionDefinition as DimensionDefinition,
  NumericSketchDefinition as SketchDefinition,
} from "@/contracts/sketch/schema";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  solvePivotedCholeskyForTest,
  solveSketchDefinitionCore,
  traceSketchSolverForTest,
} from "@/contracts/sketch/solver-core";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";

/** The kernel seed's document tolerances: τ = 1e-3 mm, τ_ang = 1e-4 rad. */
const TOLERANCES = {
  coincidence: 1e-3,
  angleRadians: 1e-4,
  minimumSegmentLength: 1e-3,
};

const point = (name: string) => `sketch_point_${name}` as const;
const entity = (name: string) => `sketch_entity_${name}` as const;
const dimensionId = (name: string) => `dimension_t13e2_${name}` as DimensionId;

function withRequirements(
  definition: SketchDefinition,
  constraints: readonly ConstraintDefinition[],
  dimensions: readonly DimensionDefinition[] = [],
): SketchDefinition {
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
}

const constraint = (
  name: string,
  body: Record<string, unknown>,
): ConstraintDefinition =>
  ({
    constraintId: `constraint_t13e2_${name}`,
    label: name,
    ...body,
  }) as unknown as ConstraintDefinition;
const lineLength = (name: string, line: string, value: number) =>
  ({
    dimensionId: dimensionId(name),
    kind: "lineLength",
    label: name,
    entityId: entity(line),
    value,
  }) as DimensionDefinition;
const lineAngle = (name: string, first: string, second: string, deg: number) =>
  ({
    dimensionId: dimensionId(name),
    kind: "lineAngle",
    label: name,
    lines: [
      { kind: "localEntity", entityId: entity(first) },
      { kind: "localEntity", entityId: entity(second) },
    ],
    valueRadians: (deg * Math.PI) / 180,
  }) as DimensionDefinition;
const diameter = (circle: string, value: number) =>
  ({
    dimensionId: dimensionId("diameter"),
    kind: "diameter",
    label: "diameter",
    entityId: entity(circle),
    value,
  }) as DimensionDefinition;

function solve(definition: SketchDefinition) {
  return solveSketchDefinitionCore({
    definition,
    tolerances: TOLERANCES,
    modelingTolerance: TOLERANCES.coincidence,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
}
type Snapshot = ReturnType<typeof solve>;

const accepted = (snapshot: Snapshot) =>
  snapshot.status.solveState === "solved" &&
  snapshot.constraintStatuses.every((entry) => entry.status === "satisfied") &&
  snapshot.dimensionStatuses.every((entry) => entry.status !== "unsatisfied") &&
  !snapshot.diagnostics.some((diagnostic) => diagnostic.severity === "error");

/** Every solved line, as [entity id, length]. */
function solvedLineLengths(definition: SketchDefinition, snapshot: Snapshot) {
  const positions = new Map(
    snapshot.solvedPoints.map((entry) => [entry.pointId, entry.solvedPosition]),
  );
  return definition.entities.flatMap((candidate) => {
    if (candidate.kind !== "lineSegment") return [];
    const start = positions.get(candidate.startPointId)!;
    const end = positions.get(candidate.endPointId)!;
    return [
      [
        candidate.entityId,
        Math.hypot(end[0] - start[0], end[1] - start[1]),
      ] as const,
    ];
  });
}

/**
 * The largest distance a solved point moved from its authored position. The
 * rows bound a rejected result's move by a few times the sketch's own extent
 * (a minimum-motion compromise of a large conflict still moves geometry);
 * before T13e2 these results moved hundreds of mm to tens of km.
 */
function largestMove(definition: SketchDefinition, snapshot: Snapshot) {
  const authored = new Map(
    definition.points.map((entry) => [entry.pointId, entry.position]),
  );
  return Math.max(
    ...snapshot.solvedPoints.map((entry) => {
      const start = authored.get(entry.pointId)!;
      return Math.hypot(
        entry.solvedPosition[0] - start[0],
        entry.solvedPosition[1] - start[1],
      );
    }),
  );
}

/** The authored bounding-box diagonal (points and circle extents). */
function authoredExtent(definition: SketchDefinition) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const entry of definition.points) {
    xs.push(entry.position[0]);
    ys.push(entry.position[1]);
  }
  for (const candidate of definition.entities) {
    if (candidate.kind !== "circle") continue;
    const center = definition.points.find(
      (entry) => entry.pointId === candidate.centerPointId,
    )!.position;
    xs.push(center[0] - candidate.radius, center[0] + candidate.radius);
    ys.push(center[1] - candidate.radius, center[1] + candidate.radius);
  }
  return Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
  );
}

/** An h/v rectangle (1,1)–(5,4): bottom/top horizontal, left/right vertical. */
function hvRectangle() {
  const sketch = makeSketchFixture();
  sketch.point("a", 1, 1);
  sketch.point("b", 5, 1);
  sketch.point("c", 5, 4);
  sketch.point("d", 1, 4);
  sketch.line("bottom", "a", "b");
  sketch.line("right", "b", "c");
  sketch.line("top", "c", "d");
  sketch.line("left", "d", "a");
  return withRequirements(literalResolvedDefinition(sketch.definition()), [
    constraint("h_bottom", { kind: "horizontal", entityId: entity("bottom") }),
    constraint("h_top", { kind: "horizontal", entityId: entity("top") }),
    constraint("v_right", { kind: "vertical", entityId: entity("right") }),
    constraint("v_left", { kind: "vertical", entityId: entity("left") }),
  ]);
}

test("T13e2 A1/A2: a conflicting corner angle on an h/v rectangle is rejected, never accepted by collapsing a side (free, height-sized, width-sized)", () => {
  const rectangle = hvRectangle();
  const variants: readonly [string, SketchDefinition][] = [
    ["free", rectangle],
    [
      "height 3",
      withRequirements(rectangle, [], [lineLength("height", "right", 3)]),
    ],
    [
      "width 4",
      withRequirements(rectangle, [], [lineLength("width", "bottom", 4)]),
    ],
  ];
  for (const [label, sketch] of variants) {
    // Control: the right angle the h/v rows already imply is consistent.
    const square = withRequirements(
      sketch,
      [],
      [lineAngle("corner", "bottom", "right", 90)],
    );
    const consistent = solve(square);
    expect(accepted(consistent), `${label}: 90° is consistent`).toBe(true);
    expect(largestMove(square, consistent)).toBeLessThan(1e-6);

    for (const degrees of [90.2, 95, 120]) {
      const definition = withRequirements(
        sketch,
        [],
        [lineAngle("corner", "bottom", "right", degrees)],
      );
      const snapshot = solve(definition);
      expect(
        accepted(snapshot),
        `${label}, ${degrees}°: the conflicting angle is rejected`,
      ).toBe(false);
      expect(
        [...snapshot.constraintStatuses, ...snapshot.dimensionStatuses].some(
          (entry) => entry.status === "unsatisfied",
        ),
        `${label}, ${degrees}°: the conflict is reported on its requirements`,
      ).toBe(true);
      // A side that does collapse below the minimum segment is reported
      // as degenerate geometry, never silently accepted.
      const degenerate = new Set(
        snapshot.diagnostics.flatMap((diagnostic) =>
          diagnostic.code === "degenerate-solved-line-segment" &&
          diagnostic.target?.kind === "entity"
            ? [diagnostic.target.entityId]
            : [],
        ),
      );
      for (const [lineId, solvedLength] of solvedLineLengths(
        definition,
        snapshot,
      ))
        if (solvedLength < TOLERANCES.minimumSegmentLength)
          expect(
            degenerate.has(lineId),
            `${label}, ${degrees}°: ${lineId} (${solvedLength}) is reported`,
          ).toBe(true);
    }
  }
});

test("T13e2 A2: a line driven below the minimum segment length is degenerate geometry; just above it is accepted", () => {
  const sketch = makeSketchFixture();
  sketch.point("a", 0, 0);
  sketch.point("b", 2, 0);
  sketch.point("c", 2, 3);
  sketch.line("short", "a", "b");
  sketch.line("other", "b", "c");
  const base = literalResolvedDefinition(sketch.definition());

  const above = solve(
    withRequirements(base, [], [lineLength("short", "short", 0.002)]),
  );
  expect(accepted(above), "0.002 mm ≥ the 0.001 mm minimum").toBe(true);

  const definition = withRequirements(
    base,
    [],
    [lineLength("short", "short", 0.0005)],
  );
  const below = solve(definition);
  expect(accepted(below), "0.0005 mm < the 0.001 mm minimum").toBe(false);
  expect(
    below.diagnostics
      .filter(
        (diagnostic) => diagnostic.code === "degenerate-solved-line-segment",
      )
      .map((diagnostic) => [diagnostic.severity, diagnostic.target]),
  ).toEqual([["error", { kind: "entity", entityId: entity("short") }]]);
});

/** A rectangle 6 × 4 (height sized) with a circle tangent to its top and bottom. */
function horizontalSlot() {
  const sketch = makeSketchFixture();
  sketch.point("center", 3, 2);
  sketch.circle("circle", "center", 2);
  const rectangle = hvRectangle();
  const moved = {
    ...rectangle,
    points: rectangle.points.map((entry) => ({
      ...entry,
      position: [
        (entry.position[0] - 1) * 1.5,
        (entry.position[1] - 1) * (4 / 3),
      ] as [number, number],
    })),
  };
  const circle = literalResolvedDefinition(sketch.definition());
  return withRequirements(
    {
      ...moved,
      pointIds: [...moved.pointIds, ...circle.pointIds],
      points: [...moved.points, ...circle.points],
      entityIds: [...moved.entityIds, ...circle.entityIds],
      entities: [...moved.entities, ...circle.entities],
    },
    [
      constraint("tangent_bottom", {
        kind: "tangent",
        entityIds: [entity("bottom"), entity("circle")],
        relation: "external",
      }),
      constraint("tangent_top", {
        kind: "tangent",
        entityIds: [entity("top"), entity("circle")],
        relation: "external",
      }),
    ],
    [lineLength("height", "right", 4)],
  );
}

/** Two free lines 4 apart held by parallel + line distance, a circle tangent to both. */
function parallelSlot() {
  const sketch = makeSketchFixture();
  sketch.point("a0", 0, 0);
  sketch.point("a1", 6, 0);
  sketch.point("b0", 0, 4);
  sketch.point("b1", 6, 4);
  sketch.point("c", 3, 2);
  sketch.line("A", "a0", "a1");
  sketch.line("B", "b0", "b1");
  sketch.circle("circle", "c", 2);
  return withRequirements(
    literalResolvedDefinition(sketch.definition()),
    [
      constraint("parallel", {
        kind: "parallel",
        entityIds: [entity("A"), entity("B")],
      }),
      constraint("tangent_a", {
        kind: "tangent",
        entityIds: [entity("A"), entity("circle")],
        relation: "external",
      }),
      constraint("tangent_b", {
        kind: "tangent",
        entityIds: [entity("B"), entity("circle")],
        relation: "external",
      }),
    ],
    [
      {
        dimensionId: dimensionId("gap"),
        kind: "lineDistance",
        label: "gap",
        lines: [
          { kind: "localEntity", entityId: entity("A") },
          { kind: "localEntity", entityId: entity("B") },
        ],
        value: 4,
      } as DimensionDefinition,
    ],
  );
}

test("T13e2 B1/B4: a diameter conflicting with a doubly tangent slot is rejected and the rejected result stays near the start (h/v slot and parallel slot)", () => {
  for (const [label, slot, conflicts] of [
    ["h/v slot", horizontalSlot(), [4.016, 4.1, 3.984, 5, 3]],
    ["parallel slot", parallelSlot(), [4.016, 4.1, 5]],
  ] as const) {
    const extent = authoredExtent(slot);
    // Control: the slot's own width is consistent.
    const fitting = withRequirements(slot, [], [diameter("circle", 4)]);
    const consistent = solve(fitting);
    expect(accepted(consistent), `${label}: diameter 4 fits`).toBe(true);
    expect(largestMove(fitting, consistent)).toBeLessThan(1e-3);

    for (const value of conflicts) {
      const definition = withRequirements(
        slot,
        [],
        [diameter("circle", value)],
      );
      const snapshot = solve(definition);
      expect(
        accepted(snapshot),
        `${label}, diameter ${value}: the conflict is rejected`,
      ).toBe(false);
      expect(
        largestMove(definition, snapshot),
        `${label}, diameter ${value}: the rejected result stays near the start (a few times the sketch's ${extent} extent; T13e2 base moved 0.25–33 km)`,
      ).toBeLessThan(5 * extent);
    }
  }
});

test("T13e2 B1: a tangent contact on the segment adds no lever (a fillet-like tangency within the segment solves as before)", () => {
  const slot = horizontalSlot();
  // The circle shifted along the lines but still between their ends.
  const shifted = {
    ...slot,
    points: slot.points.map((entry) =>
      entry.pointId === point("center")
        ? { ...entry, position: [4.5, 2] as [number, number] }
        : entry,
    ),
  };
  const snapshot = solve(
    withRequirements(shifted, [], [diameter("circle", 4)]),
  );
  expect(accepted(snapshot)).toBe(true);
});

/** Two free lines; a point on each; the points 2.9 apart while the lines are 3 apart. */
test("T13e2 B1: points on two parallel lines with a conflicting point distance are rejected, not accepted far along the lines", () => {
  const sketch = makeSketchFixture();
  sketch.point("a0", 0, 0);
  sketch.point("a1", 6, 0);
  sketch.point("b0", 0, 3);
  sketch.point("b1", 6, 3);
  sketch.point("p", 3, 0);
  sketch.point("q", 3, 3);
  sketch.line("A", "a0", "a1");
  sketch.line("B", "b0", "b1");
  sketch.pointOnCurve("p", "A");
  sketch.pointOnCurve("q", "B");
  const base = withRequirements(
    literalResolvedDefinition(sketch.definition()),
    [
      constraint("parallel", {
        kind: "parallel",
        entityIds: [entity("A"), entity("B")],
      }),
    ],
    [
      {
        dimensionId: dimensionId("gap"),
        kind: "lineDistance",
        label: "gap",
        lines: [
          { kind: "localEntity", entityId: entity("A") },
          { kind: "localEntity", entityId: entity("B") },
        ],
        value: 3,
      } as DimensionDefinition,
    ],
  );
  const pointDistance = (value: number) =>
    withRequirements(
      base,
      [],
      [
        {
          dimensionId: dimensionId("pq"),
          kind: "distance",
          label: "pq",
          axis: "aligned",
          pointIds: [point("p"), point("q")],
          value,
        } as DimensionDefinition,
      ],
    );
  expect(accepted(solve(pointDistance(3))), "3 is consistent").toBe(true);
  for (const value of [2.99, 2.9]) {
    const definition = pointDistance(value);
    const snapshot = solve(definition);
    expect(accepted(snapshot), `distance ${value} is rejected`).toBe(false);
    expect(largestMove(definition, snapshot)).toBeLessThan(
      5 * authoredExtent(definition),
    );
  }
});

test("T13e2 C1/C2: on a conflict the Gauss–Newton fallback continues from BFGS's result and stops after one step without progress", () => {
  const rectangle = hvRectangle();
  const conflicting = withRequirements(
    rectangle,
    [],
    [lineLength("width", "bottom", 4), lineLength("width_b", "bottom", 5)],
  );
  const traced = traceSketchSolverForTest(() => solve(conflicting));
  expect(accepted(traced.result)).toBe(false);
  const [run, ...others] = traced.gaussNewtonFallbacks;
  expect(others).toEqual([]);
  expect(run).toMatchObject({
    skipped: false,
    iterations: 1,
    linearSolve: "pivotedCholesky",
  });
  // Gauss–Newton's own evaluation of its start is BFGS's end loss (from the
  // authored start the loss of the two widths is 0.5).
  expect(run!.startLoss, "Gauss–Newton starts where BFGS ended").toBe(
    run!.bfgsLoss,
  );
});

test("T13e2 C3: a BFGS result that is accepted (each row within τ, total loss above 1e-8) skips the Gauss–Newton fallback", () => {
  const rectangle = hvRectangle();
  // Two width dimensions 0.8 µm apart: each residual (0.4 µm) is within
  // τ, the total loss (1.6e-7) is above the 1e-8 loss threshold.
  const definition = withRequirements(
    rectangle,
    [],
    [lineLength("width", "bottom", 4), lineLength("width_b", "bottom", 4.0008)],
  );
  const traced = traceSketchSolverForTest(() => solve(definition));
  expect(accepted(traced.result), "premise: accepted").toBe(true);
  expect(traced.gaussNewtonFallbacks).toMatchObject([
    { skipped: true, startLoss: null, iterations: 0 },
  ]);
  expect(traced.gaussNewtonFallbacks[0]!.bfgsLoss).toBeGreaterThan(1e-8);
});

/** A seeded linear congruential generator (deterministic rows). */
function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32 - 0.5;
  };
}

test("T13e2 C2 (review B-1): the fallback's pivoted Cholesky solves random full-rank and rank-deficient SPD systems", () => {
  const random = seededRandom(13);
  const multiply = (matrix: number[][], vector: readonly number[]) =>
    matrix.map((row) =>
      row.reduce((sum, value, index) => sum + value * vector[index]!, 0),
    );
  for (const size of [3, 5, 8, 16, 32]) {
    for (const rank of [size, Math.max(1, size - 2)]) {
      for (let trial = 0; trial < 4; trial += 1) {
        // A = Bᵀ·B with B rank × size; b = A·x₀ lies in A's range.
        const factor = Array.from({ length: rank }, () =>
          Array.from({ length: size }, () => random()),
        );
        const matrix = Array.from({ length: size }, (_, row) =>
          Array.from({ length: size }, (_, column) =>
            factor.reduce((sum, line) => sum + line[row]! * line[column]!, 0),
          ),
        );
        const rhs = multiply(
          matrix,
          Array.from({ length: size }, () => random()),
        );
        const solution = solvePivotedCholeskyForTest(matrix, rhs, 1e-12);
        const residual = multiply(matrix, solution).map(
          (value, index) => value - rhs[index]!,
        );
        const norm = (vector: readonly number[]) => Math.hypot(...vector);
        expect(
          norm(residual) / norm(rhs),
          `size ${size}, rank ${rank}, trial ${trial}`,
        ).toBeLessThan(1e-8);
      }
    }
  }
});

test.each(["batch", "session"] as const)(
  "T13e2 (review A-1/T2): a tight-policy rescue stops at its first accepted Gauss–Newton iterate instead of the 1000-iteration cap (%s)",
  (path) => {
    // Two free lines 0.1 rad off parallel under a 1e-5 mm / 1e-6 rad policy:
    // BFGS stops (loss < 1e-12) about 1.25e-6 rad off, above the policy, and
    // the fallback rescues it (the solver-core.spec rescue row).
    const sketch = makeSketchFixture();
    sketch.point("a0", 0, 0);
    sketch.point("a1", 10, 0);
    sketch.point("b0", 0, 5);
    sketch.point("b1", 10 * Math.cos(0.1), 5 + 10 * Math.sin(0.1));
    sketch.line("A", "a0", "a1");
    sketch.line("B", "b0", "b1");
    const definition = withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [
        constraint("parallel", {
          kind: "parallel",
          entityIds: [entity("A"), entity("B")],
        }),
      ],
    );
    const input = {
      definition,
      tolerances: {
        coincidence: 1e-5,
        angleRadians: 1e-6,
        minimumSegmentLength: 1e-5,
      },
      modelingTolerance: 1e-3,
      partialSolvePolicy: "bestEffort" as const,
    };
    // T2/M14: no accepted prior snapshot may mask a missing session fallback.
    const traced = traceSketchSolverForTest(() =>
      path === "batch"
        ? solveSketchDefinitionCore(input).solvedSnapshot
        : createCompiledSketchSolveSession({
            sessionId: "interactive_sketch_solve_tight_policy_rescue",
            program: compileSketchSolveProgram(input),
          }).lastAcceptedSnapshot,
    );
    expect(accepted(traced.result)).toBe(true);
    const positions = new Map(
      traced.result.solvedPoints.map((entry) => [
        entry.pointId,
        entry.solvedPosition,
      ]),
    );
    const direction = (start: string, end: string) => {
      const a = positions.get(point(start))!;
      const b = positions.get(point(end))!;
      return [b[0] - a[0], b[1] - a[1]] as const;
    };
    const a = direction("a0", "a1");
    const b = direction("b0", "b1");
    expect(
      Math.atan2(
        Math.abs(a[0] * b[1] - a[1] * b[0]),
        a[0] * b[0] + a[1] * b[1],
      ),
      "The solved directions meet the tight angular tolerance, not just a low total loss",
    ).toBeLessThanOrEqual(input.tolerances.angleRadians);
    // The local minimum-motion solution rotates each line about its midpoint
    // by ~0.05 rad, moving its endpoints ~0.25 mm, not into a distant basin.
    expect(largestMove(definition, traced.result)).toBeLessThan(0.3);
    const [run] = traced.gaussNewtonFallbacks;
    expect(run?.skipped, "premise: BFGS alone is not accepted").toBe(false);
    expect(run!.bfgsLoss).toBeLessThan(1e-12);
    expect(run!.startLoss, "the fallback continues from BFGS's result").toBe(
      run!.bfgsLoss,
    );
    expect(run!.iterations).toBeGreaterThan(0);
    expect(run!.iterations).toBeLessThan(1000);
  },
);

// --- Review R-2: one far-basin row per B1 lever operand and per lever rule.
// Each conflict is absorbed only by a tiny tilt of a line whose extension
// the operand relies on far beyond its segment; every row fails when that
// operand (or rule) is removed from the lever (`phase2/review-mutations`).

type Fixture = ReturnType<typeof makeSketchFixture>;

const horizontal = (line: string) =>
  constraint(`h_${line}`, { kind: "horizontal", entityId: entity(line) });
const verticalDistance = (
  name: string,
  first: string,
  second: string,
  value: number,
) =>
  ({
    dimensionId: dimensionId(name),
    kind: "verticalDistance",
    label: name,
    pointIds: [point(first), point(second)],
    value,
  }) as DimensionDefinition;
const pointDistance = (first: string, second: string, value: number) =>
  ({
    dimensionId: dimensionId("pq"),
    kind: "distance",
    label: "pq",
    axis: "aligned",
    pointIds: [point(first), point(second)],
    value,
  }) as DimensionDefinition;
const localLine = (line: string) => ({
  kind: "localEntity",
  entityId: entity(line),
});

/** Horizontal lines A (y = 0) and B (y = 3), 6 long, B's height dimensioned. */
function horizontalPair(sketch: Fixture) {
  sketch.point("a0", 0, 0);
  sketch.point("a1", 6, 0);
  sketch.point("b0", 0, 3);
  sketch.point("b1", 6, 3);
  sketch.line("A", "a0", "a1");
  sketch.line("B", "b0", "b1");
  return {
    constraints: [horizontal("A"), horizontal("B")],
    dimensions: [verticalDistance("gap", "a0", "b0", 3)],
  };
}

function expectFarBasinRejected(
  label: string,
  variant: (conflicting: boolean) => SketchDefinition,
  projectedReferences: Parameters<
    typeof solveSketchDefinitionCore
  >[0]["projectedReferences"] = [],
) {
  const run = (definition: SketchDefinition) =>
    solveSketchDefinitionCore({
      definition,
      projectedReferences,
      tolerances: TOLERANCES,
      modelingTolerance: TOLERANCES.coincidence,
      partialSolvePolicy: "bestEffort",
    }).solvedSnapshot;
  expect(accepted(run(variant(false))), `${label}: the control solves`).toBe(
    true,
  );
  const definition = variant(true);
  const snapshot = run(definition);
  expect(accepted(snapshot), `${label}: the conflict is rejected`).toBe(false);
  expect(largestMove(definition, snapshot)).toBeLessThan(
    5 * authoredExtent(definition),
  );
}

test("T13e2 B1 (review R-2): pointOnCurve — points on two horizontal lines 3 apart at point distance 2.9", () => {
  expectFarBasinRejected("pointOnCurve", (conflicting) => {
    const sketch = makeSketchFixture();
    const pair = horizontalPair(sketch);
    sketch.point("p", 3, 0);
    sketch.point("q", 3, 3);
    sketch.pointOnCurve("p", "A");
    sketch.pointOnCurve("q", "B");
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      pair.constraints,
      [...pair.dimensions, pointDistance("p", "q", conflicting ? 2.9 : 3)],
    );
  });
});

test("T13e2 B1 (review R-2): collinear (point target) — points collinear with two horizontal lines 3 apart at distance 2.9", () => {
  expectFarBasinRejected("collinear point", (conflicting) => {
    const sketch = makeSketchFixture();
    const pair = horizontalPair(sketch);
    sketch.point("p", 3, 0);
    sketch.point("q", 3, 3);
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [
        ...pair.constraints,
        ...(["p", "q"] as const).map((name) =>
          constraint(`collinear_${name}`, {
            kind: "collinear",
            target: { kind: "localPoint", pointId: point(name) },
            line: localLine(name === "p" ? "A" : "B"),
          }),
        ),
      ],
      [...pair.dimensions, pointDistance("p", "q", conflicting ? 2.9 : 3)],
    );
  });
});

test("T13e2 B1 (review R-2): collinear (line target) — short lines collinear with two horizontal lines 3 apart, their starts 2.9 apart", () => {
  expectFarBasinRejected("collinear line", (conflicting) => {
    const sketch = makeSketchFixture();
    const pair = horizontalPair(sketch);
    sketch.point("p", 3, 0);
    sketch.point("p1", 4, 0);
    sketch.point("q", 3, 3);
    sketch.point("q1", 4, 3);
    sketch.line("P", "p", "p1");
    sketch.line("Q", "q", "q1");
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [
        ...pair.constraints,
        ...(
          [
            ["P", "A"],
            ["Q", "B"],
          ] as const
        ).map(([target, line]) =>
          constraint(`collinear_${target}`, {
            kind: "collinear",
            target: localLine(target),
            line: localLine(line),
          }),
        ),
      ],
      [...pair.dimensions, pointDistance("p", "q", conflicting ? 2.9 : 3)],
    );
  });
});

test("T13e2 B1 (review R-2): linePointDistance — a point 3 from a horizontal line but 2.9 above its start", () => {
  expectFarBasinRejected("linePointDistance", (conflicting) => {
    const sketch = makeSketchFixture();
    sketch.point("a0", 0, 0);
    sketch.point("a1", 6, 0);
    sketch.point("p", 3, 3);
    sketch.line("A", "a0", "a1");
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [horizontal("A")],
      [
        lineLength("length_a", "A", 6),
        {
          dimensionId: dimensionId("line_point"),
          kind: "linePointDistance",
          label: "line point",
          line: localLine("A"),
          point: { kind: "localPoint", pointId: point("p") },
          value: 3,
        } as DimensionDefinition,
        verticalDistance("height", "a0", "p", conflicting ? 2.9 : 3),
      ],
    );
  });
});

test("T13e2 B1 (review R-2): lineDistance is no lever source — two fixed-length horizontal lines 3 apart by line distance but 2.9 apart at their starts are rejected without one (no far basin is reached)", () => {
  expectFarBasinRejected("lineDistance", (conflicting) => {
    const sketch = makeSketchFixture();
    const pair = horizontalPair(sketch);
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      pair.constraints,
      [
        lineLength("length_a", "A", 6),
        lineLength("length_b", "B", 6),
        {
          dimensionId: dimensionId("line_gap"),
          kind: "lineDistance",
          label: "line gap",
          lines: [localLine("A"), localLine("B")],
          value: 3,
        } as DimensionDefinition,
        verticalDistance("start_gap", "a0", "b0", conflicting ? 2.9 : 3),
      ],
    );
  });
});

test("T13e2 B1 (review R-2): symmetric — two points symmetric about a horizontal line, 1 above its start but 1.9 apart", () => {
  expectFarBasinRejected("symmetric", (conflicting) => {
    const sketch = makeSketchFixture();
    sketch.point("a0", 0, 0);
    sketch.point("a1", 6, 0);
    sketch.point("p", 3, 1);
    sketch.point("q", 3, -1);
    sketch.line("A", "a0", "a1");
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [
        horizontal("A"),
        constraint("symmetric", {
          kind: "symmetric",
          pointIds: [point("p"), point("q")],
          axis: localLine("A"),
        }),
      ],
      [
        verticalDistance("height", "a0", "p", 1),
        pointDistance("p", "q", conflicting ? 1.9 : 2),
      ],
    );
  });
});

test("T13e2 B1 (review R-2): equalOffset between two fixed-length horizontal pairs held 3 and 2.9 apart is rejected", () => {
  expectFarBasinRejected("equalOffset", (conflicting) => {
    const sketch = makeSketchFixture();
    const pair = horizontalPair(sketch);
    sketch.point("c0", 10, 0);
    sketch.point("c1", 16, 0);
    sketch.point("d0", 10, 3);
    sketch.point("d1", 16, 3);
    sketch.line("C", "c0", "c1");
    sketch.line("D", "d0", "d1");
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [
        ...pair.constraints,
        horizontal("C"),
        horizontal("D"),
        constraint("equal_offset", {
          kind: "equalOffset",
          pairs: [
            {
              seedEntityId: entity("A"),
              offsetEntityId: entity("B"),
              side: "left",
            },
            {
              seedEntityId: entity("C"),
              offsetEntityId: entity("D"),
              side: "left",
            },
          ],
        }),
      ],
      [
        ...pair.dimensions,
        verticalDistance("gap_cd", "c0", "d0", conflicting ? 2.9 : 3),
        ...["A", "B", "C", "D"].map((line) =>
          lineLength(`length_${line}`, line, 6),
        ),
      ],
    );
  });
});

test("T13e2 B1 (review R-2): two fixed-length horizontal lines 3 apart both normal to one circle are rejected", () => {
  expectFarBasinRejected("normal", (conflicting) => {
    const sketch = makeSketchFixture();
    const pair = horizontalPair(sketch);
    sketch.point("center", 3, conflicting ? 1.5 : 0);
    sketch.circle("circle", "center", 1);
    sketch.point("pa", 2, 0);
    sketch.point("pb", 2, 3);
    const normal = (name: string, line: string, contact: string) =>
      constraint(`normal_${name}`, {
        kind: "normal",
        point: { kind: "localPoint", pointId: point(contact) },
        line: localLine(line),
        curve: localLine("circle"),
      });
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [
        ...pair.constraints,
        normal("a", "A", "pa"),
        ...(conflicting ? [normal("b", "B", "pb")] : []),
      ],
      [
        ...pair.dimensions,
        lineLength("length_a", "A", 6),
        lineLength("length_b", "B", 6),
      ],
    );
  });
});

test("T13e2 B1 (review R-2): tangentProjectedCurve and normalProjectedCurve — horizontal lines against a projected circle", () => {
  const sketch = makeSketchFixture();
  const referenceId = sketch.project("circle", [
    {
      geometryId: "projected_geometry_circle",
      kind: "circle",
      centerPosition: [3, 1.5],
      radius: 1.5,
    },
  ] as never);
  const projectedReferences = sketch.build().projectedReferences;
  const projectedCircle = {
    kind: "projectedGeometry",
    reference: {
      kind: "projectedCircle",
      referenceId,
      geometryId: "projected_geometry_circle",
    },
  };
  const base = makeSketchFixture();
  const pair = horizontalPair(base);
  const definition = {
    ...literalResolvedDefinition(base.definition()),
    referenceIds: literalResolvedDefinition(sketch.definition()).referenceIds,
    references: literalResolvedDefinition(sketch.definition()).references,
  };
  // Tangent to the fixed circle on both sides, but 2.9 apart at the starts.
  expectFarBasinRejected(
    "tangentProjectedCurve",
    (conflicting) =>
      withRequirements(
        definition,
        [
          ...pair.constraints,
          ...(["A", "B"] as const).map((line) =>
            constraint(`tangent_${line}`, {
              kind: "tangentProjectedCurve",
              curve: localLine(line),
              projectedCurve: projectedCircle,
              relation: "external",
            }),
          ),
        ],
        [verticalDistance("gap", "a0", "b0", conflicting ? 2.9 : 3)],
      ),
    projectedReferences,
  );
  // Normal to the fixed circle (through its centre, y = 1.5) but with its
  // start held 1.6 above a fixed origin point; the line keeps its length.
  const withContact = makeSketchFixture();
  withContact.point("o", 0, 0);
  withContact.point("a0", 0, 1.5);
  withContact.point("a1", 6, 1.5);
  withContact.point("p", 1.5, 1.5);
  withContact.line("A", "a0", "a1");
  expectFarBasinRejected(
    "normalProjectedCurve",
    (conflicting) =>
      withRequirements(
        {
          ...literalResolvedDefinition(withContact.definition()),
          referenceIds: literalResolvedDefinition(sketch.definition())
            .referenceIds,
          references: literalResolvedDefinition(sketch.definition()).references,
        },
        [
          horizontal("A"),
          constraint("normal", {
            kind: "normalProjectedCurve",
            point: { kind: "localPoint", pointId: point("p") },
            line: localLine("A"),
            projectedCurve: projectedCircle,
          }),
          constraint("fix_o", {
            kind: "fixPoint",
            pointId: point("o"),
            position: [0, 0],
          }),
        ],
        [
          lineLength("length_a", "A", 6),
          verticalDistance("height", "o", "a0", conflicting ? 1.6 : 1.5),
        ],
      ),
    projectedReferences,
  );
});

/**
 * A slot whose two lines are kept parallel only by `holding` (no line
 * distance: its prerequisite is judged by the lever too, re-review RR-2),
 * b0 held 4 straight above a0, a circle tangent to both.
 */
function heldOrientationSlot(holding: "lineAngle" | "parallel", value: number) {
  const sketch = makeSketchFixture();
  sketch.point("a0", 0, 0);
  sketch.point("a1", 6, 0);
  sketch.point("b0", 0, 4);
  sketch.point("b1", 6, 4);
  sketch.point("m0", -1, -1);
  sketch.point("m1", -1, 5);
  sketch.point("c", 3, 2);
  sketch.line("A", "a0", "a1");
  sketch.line("B", "b0", "b1");
  sketch.line("M", "m0", "m1");
  sketch.circle("circle", "c", 2);
  return withRequirements(
    literalResolvedDefinition(sketch.definition()),
    [
      ...["A", "B"].map((line) =>
        constraint(`tangent_${line}`, {
          kind: "tangent",
          entityIds: [entity(line), entity("circle")],
          relation: "external",
        }),
      ),
      ...(holding === "parallel"
        ? [
            constraint("parallel", {
              kind: "parallel",
              entityIds: [entity("A"), entity("B")],
            }),
          ]
        : []),
    ],
    [
      ...(holding === "lineAngle"
        ? [
            lineAngle("angle_a", "A", "M", 90),
            lineAngle("angle_b", "B", "M", 90),
          ]
        : []),
      verticalDistance("gap", "a0", "b0", 4),
      horizontalDistance("offset", "a0", "b0", 0),
      diameter("circle", value),
    ],
  );
}

test("T13e2 B1 (review R-2): the lineAngle lever rule — a slot held by right angles to a transversal, not by parallel", () => {
  expectFarBasinRejected("lineAngle", (conflicting) =>
    heldOrientationSlot("lineAngle", conflicting ? 4.1 : 4),
  );
});

test("T13e2 B1 (re-review): the parallel lever rule — a slot held by parallel lines without a line distance", () => {
  expectFarBasinRejected("parallel", (conflicting) =>
    heldOrientationSlot("parallel", conflicting ? 4.1 : 4),
  );
});

// --- Re-review RR-1/RR-2 and advisories: one held line, the conflicting
// measurement taken along its extension.

const horizontalDistance = (
  name: string,
  first: string,
  second: string,
  value: number,
) =>
  ({
    dimensionId: dimensionId(name),
    kind: "horizontalDistance",
    label: name,
    pointIds: [point(first), point(second)],
    value,
  }) as DimensionDefinition;
const fixAt = (name: string, x: number, y: number) =>
  constraint(`fix_${name}`, {
    kind: "fixPoint",
    pointId: point(name),
    position: [x, y],
  });

test("T13e2 B1 (re-review RR-1): normal (local curve) — a circle normal to a held horizontal line, its centre 0.1 above the line's start", () => {
  expectFarBasinRejected("normal, centre off the line", (conflicting) => {
    const sketch = makeSketchFixture();
    sketch.point("a0", 0, 0);
    sketch.point("a1", 6, 0);
    sketch.line("A", "a0", "a1");
    sketch.point("center", 3, 0);
    sketch.circle("circle", "center", 1);
    sketch.point("pc", 2, 0);
    return withRequirements(
      literalResolvedDefinition(sketch.definition()),
      [
        fixAt("a0", 0, 0),
        horizontal("A"),
        constraint("normal", {
          kind: "normal",
          point: { kind: "localPoint", pointId: point("pc") },
          line: localLine("A"),
          curve: localLine("circle"),
        }),
      ],
      [
        lineLength("length_a", "A", 6),
        verticalDistance("centre", "a0", "center", conflicting ? 0.1 : 0),
        diameter("circle", 2),
      ],
    );
  });
});

test("T13e2 B1 (re-review advisory): normal (local curve), its two sources separately — a fixed 10 m circle with its contact, or its centre, far beyond the line", () => {
  for (const [label, centerX, contactX] of [
    ["contact far, centre on the segment", 3, 10_003],
    ["centre far, contact on the segment", 10_003, 3],
  ] as const) {
    expectFarBasinRejected(`normal, ${label}`, (conflicting) => {
      const sketch = makeSketchFixture();
      sketch.point("o", 0, 0);
      sketch.point("a0", 0, 1.5);
      sketch.point("a1", 6, 1.5);
      sketch.point("center", centerX, 1.5);
      sketch.point("p", contactX, 1.5);
      sketch.line("A", "a0", "a1");
      sketch.circle("circle", "center", 10_000);
      return withRequirements(
        literalResolvedDefinition(sketch.definition()),
        [
          fixAt("o", 0, 0),
          fixAt("center", centerX, 1.5),
          horizontal("A"),
          constraint("normal", {
            kind: "normal",
            point: { kind: "localPoint", pointId: point("p") },
            line: localLine("A"),
            curve: localLine("circle"),
          }),
        ],
        [
          lineLength("length_a", "A", 6),
          horizontalDistance("ax", "o", "a0", 0),
          diameter("circle", 20_000),
          verticalDistance("height", "o", "p", conflicting ? 1.6 : 1.5),
        ],
      );
    });
  }
});

/** A held horizontal line A, a free line B 6 long, a point p on B held at (3, height). */
function heldLineWithFreeParallel(
  relation: (sketch: Fixture) => {
    constraints: ConstraintDefinition[];
    dimensions: DimensionDefinition[];
  },
  height: number,
  holdBothEnds = false,
) {
  const sketch = makeSketchFixture();
  sketch.point("a0", 0, 0);
  sketch.point("a1", 6, 0);
  sketch.point("b0", 0, 3);
  sketch.point("b1", 6, 3);
  sketch.point("p", 3, 3);
  sketch.line("A", "a0", "a1");
  sketch.line("B", "b0", "b1");
  sketch.pointOnCurve("p", "B");
  const extra = relation(sketch);
  return withRequirements(
    literalResolvedDefinition(sketch.definition()),
    [
      fixAt("a0", 0, 0),
      holdBothEnds ? fixAt("a1", 6, 0) : horizontal("A"),
      ...extra.constraints,
    ],
    [
      lineLength("length_a", "A", 6),
      lineLength("length_b", "B", 6),
      horizontalDistance("px", "a0", "p", 3),
      verticalDistance("py", "a0", "p", height),
      ...extra.dimensions,
    ],
  );
}

test("T13e2 B1 (re-review RR-2): lineDistance's parallel prerequisite — line B at distance 3 from a held line, a point on B held 2.9 above it", () => {
  expectFarBasinRejected("lineDistance prerequisite", (conflicting) =>
    heldLineWithFreeParallel(
      () => ({
        constraints: [],
        dimensions: [
          {
            dimensionId: dimensionId("line_gap"),
            kind: "lineDistance",
            label: "line gap",
            lines: [localLine("A"), localLine("B")],
            value: 3,
          } as DimensionDefinition,
        ],
      }),
      conflicting ? 2.9 : 3,
    ),
  );
});

test("T13e2 B1 (re-review advisory): normalProjectedCurve's two sources separately — a 10 m projected circle with its contact, or its centre, far beyond the held line", () => {
  for (const [label, centerX, contactX] of [
    ["contact far, centre on the segment", 3, 10_003],
    ["centre far, contact on the segment", 10_003, 3],
  ] as const) {
    const sketch = makeSketchFixture();
    const referenceId = sketch.project("circle", [
      {
        geometryId: "projected_geometry_circle",
        kind: "circle",
        centerPosition: [centerX, 1.5],
        radius: 10_000,
      },
    ] as never);
    sketch.point("o", 0, 0);
    sketch.point("a0", 0, 1.5);
    sketch.point("a1", 6, 1.5);
    sketch.point("p", contactX, 1.5);
    sketch.line("A", "a0", "a1");
    expectFarBasinRejected(
      `normalProjectedCurve, ${label}`,
      (conflicting) =>
        withRequirements(
          literalResolvedDefinition(sketch.definition()),
          [
            fixAt("o", 0, 0),
            horizontal("A"),
            constraint("normal", {
              kind: "normalProjectedCurve",
              point: { kind: "localPoint", pointId: point("p") },
              line: localLine("A"),
              projectedCurve: {
                kind: "projectedGeometry",
                reference: {
                  kind: "projectedCircle",
                  referenceId,
                  geometryId: "projected_geometry_circle",
                },
              },
            }),
          ],
          [
            lineLength("length_a", "A", 6),
            horizontalDistance("ax", "o", "a0", 0),
            verticalDistance("height", "o", "p", conflicting ? 1.6 : 1.5),
          ],
        ),
      sketch.build().projectedReferences,
    );
  }
});

/** A second pair C/D held 3 apart and an equal offset between (A, B) and (C, D). */
function equalOffsetToHeldPair(sketch: Fixture) {
  sketch.point("c0", 10, 0);
  sketch.point("c1", 16, 0);
  sketch.point("d0", 10, 3);
  sketch.point("d1", 16, 3);
  sketch.line("C", "c0", "c1");
  sketch.line("D", "d0", "d1");
  return {
    constraints: [
      fixAt("c0", 10, 0),
      horizontal("C"),
      horizontal("D"),
      constraint("equal_offset", {
        kind: "equalOffset",
        pairs: [
          {
            seedEntityId: entity("A"),
            offsetEntityId: entity("B"),
            side: "left",
          },
          {
            seedEntityId: entity("C"),
            offsetEntityId: entity("D"),
            side: "left",
          },
        ],
      }),
    ],
    dimensions: [
      lineLength("length_c", "C", 6),
      lineLength("length_d", "D", 6),
      verticalDistance("gap_cd", "c0", "d0", 3),
    ],
  };
}

test("T13e2 B1 (re-review RR-1): equalOffset's per-pair parallelism — line B offset from a line held at both ends equal to a pair 3 apart, a point on B held 2.9 above", () => {
  expectFarBasinRejected("equalOffset, per-pair parallelism", (conflicting) =>
    heldLineWithFreeParallel(
      equalOffsetToHeldPair,
      conflicting ? 2.9 : 3,
      true,
    ),
  );
});
