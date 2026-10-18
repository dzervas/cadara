import { expect, test } from "vitest";
import type {
  ConstraintDefinition,
  NumericSketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import {
  compileSketchSolveProgram,
  solveCompiledSketchProgram,
  solveSketchDefinitionCore,
  startCompiledSketchSolveSession,
  traceSketchSolverForTest,
  updateCompiledSketchSolveSession,
} from "@/contracts/sketch/solver-core";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";

const tolerances = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
};
const input = (definition: NumericSketchDefinition) => ({
  definition,
  tolerances,
  modelingTolerance: 1e-3,
  partialSolvePolicy: "bestEffort" as const,
});
const fix = (
  name: string,
  point: string,
  position: SketchPoint2D,
): ConstraintDefinition => ({
  kind: "fixPoint",
  constraintId: `constraint_${name}`,
  label: name,
  pointId: `sketch_point_${point}`,
  position,
});
function withConstraints(
  definition: NumericSketchDefinition,
  constraints: ConstraintDefinition[],
): NumericSketchDefinition {
  return {
    ...definition,
    constraints,
    constraintIds: constraints.map((entry) => entry.constraintId),
  };
}
function line() {
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  fixture.point("b", 10, 0);
  fixture.line("line", "a", "b");
  return literalResolvedDefinition(fixture.definition());
}
function expectState(
  definition: NumericSketchDefinition,
  state: "underConstrained" | "wellConstrained",
) {
  const solved = solveSketchDefinitionCore(input(definition));
  expect(solved.status).toEqual({
    solveState: "solved",
    constraintState: state,
  });
  expect(solved.solvedSnapshot.status).toEqual(solved.status);
  return solved;
}

test("fixed points remove two freedoms each, but duplicate equations do not fix another point", () => {
  const definition = line();
  expectState(
    withConstraints(definition, [fix("a", "a", [0, 0])]),
    "underConstrained",
  );
  // Four scalar records for four variables, but only two independent equations.
  expectState(
    withConstraints(
      definition,
      Array.from({ length: 4 }, (_, i) => fix(`a_${i}`, "a", [0, 0])),
    ),
    "underConstrained",
  );
  expectState(
    withConstraints(definition, [
      fix("a", "a", [0, 0]),
      fix("b", "b", [10, 0]),
    ]),
    "wellConstrained",
  );
});

test("dimensions fix size, not translation or rotation; reference dimensions never remove freedom", () => {
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  fixture.point("b", 10, 0);
  const entityId = fixture.line("line", "a", "b");
  fixture.lineLength("line", 10);
  const definition = literalResolvedDefinition(fixture.definition());
  const constraints: ConstraintDefinition[] = [fix("a", "a", [0, 0])];
  expectState(withConstraints(definition, constraints), "underConstrained");
  constraints.push({
    kind: "horizontal",
    constraintId: "constraint_horizontal",
    label: "Horizontal",
    entityId,
  });
  expectState(withConstraints(definition, constraints), "wellConstrained");
  const dimension = definition.dimensions[0]!;
  if (dimension.kind !== "lineLength")
    throw new Error("Expected line-length fixture.");
  expectState(
    withConstraints(
      {
        ...definition,
        dimensions: [{ ...dimension, reference: true, value: undefined }],
      },
      constraints,
    ),
    "underConstrained",
  );
});

test.each(["coincident", "midpoint", "coincidentProjectedPoint"] as const)(
  "%s exposes independent raw components at an exactly satisfied solution",
  (kind) => {
    const fixture = makeSketchFixture();
    fixture.point("a", 0, 0);
    fixture.point("b", 10, 0);
    fixture.point("p", kind === "midpoint" ? 5 : 0, 0);
    const entityId = fixture.line("line", "a", "b");
    const point = {
      kind: "localPoint" as const,
      pointId: "sketch_point_p" as const,
    };
    const constraint: ConstraintDefinition =
      kind === "coincident"
        ? {
            kind,
            constraintId: "constraint_join",
            label: "Join",
            pointIds: ["sketch_point_a", "sketch_point_p"],
          }
        : kind === "midpoint"
          ? {
              kind,
              constraintId: "constraint_join",
              label: "Join",
              point,
              line: { kind: "localEntity", entityId },
            }
          : {
              kind,
              constraintId: "constraint_join",
              label: "Join",
              point,
              projectedPoint: { kind: "sketchDatum", datum: "origin" },
            };
    expectState(
      withConstraints(literalResolvedDefinition(fixture.definition()), [
        fix("a", "a", [0, 0]),
        fix("b", "b", [10, 0]),
        constraint,
      ]),
      "wellConstrained",
    );
  },
);

test.each([0, Math.PI])(
  "an exactly satisfied angle %s still removes the angular freedom",
  (valueRadians) => {
    const fixture = makeSketchFixture();
    fixture.point("origin", 0, 0);
    fixture.point("a", 10, 0);
    fixture.point("b", valueRadians === 0 ? 20 : -20, 0);
    fixture.line("a", "origin", "a");
    fixture.line("b", "origin", "b");
    fixture.lineLength("b", 20);
    const definition = literalResolvedDefinition(fixture.definition());
    expectState(
      withConstraints(definition, [
        fix("origin", "origin", [0, 0]),
        fix("a", "a", [10, 0]),
        {
          kind: "angle",
          constraintId: "constraint_angle",
          label: "Angle",
          pointIds: ["sketch_point_a", "sketch_point_b", "sketch_point_origin"],
          valueRadians,
        },
      ]),
      "wellConstrained",
    );
  },
);

test("a mirror output is not an independent parameter, and its requirements pull back to the seed", () => {
  const fixture = makeSketchFixture();
  fixture.point("seed", 3, 2);
  fixture.point("copy", 3, -2);
  const seed = fixture.circle("seed", "seed", 2);
  const copy = fixture.circle("copy", "copy", 2);
  const base = literalResolvedDefinition(fixture.definition());
  const definition: NumericSketchDefinition = {
    ...base,
    derivedRelationships: [
      {
        kind: "mirror",
        derivationId: "derivation_mirror",
        label: "Mirror",
        seedEntityIds: [seed],
        mirrorReference: { kind: "sketchDatum", datum: "xAxis" },
        outputs: [
          {
            seedEntityId: seed,
            outputEntityId: copy,
            instanceIndex: 1,
            seedPointIds: ["sketch_point_seed"],
            outputPointIds: ["sketch_point_copy"],
          },
        ],
      },
    ],
    dimensionIds: ["dimension_radius"],
    dimensions: [
      {
        kind: "circleRadius",
        dimensionId: "dimension_radius",
        label: "Radius",
        entityId: copy,
        value: 2,
      },
    ],
  };
  expectState(definition, "underConstrained");
  expectState(
    withConstraints(definition, [fix("copy", "copy", [3, -2])]),
    "wellConstrained",
  );
});

test("offset outputs add no free parameters; output diameter and seed position fully constrain the circle", () => {
  const fixture = makeSketchFixture();
  fixture.point("seed", 0, 0);
  fixture.point("copy", 0, 0);
  const seed = fixture.circle("seed", "seed", 3);
  const copy = fixture.circle("copy", "copy", 2);
  const definition: NumericSketchDefinition = {
    ...literalResolvedDefinition(fixture.definition()),
    derivedRelationships: [
      {
        kind: "offset",
        derivationId: "derivation_offset",
        label: "Offset",
        seedEntityIds: [seed],
        distance: 1,
        jointPolicy: "trimExtendArcFallback",
        jointOutputs: [],
        piecewiseCubicOutputs: [],
        outputs: [
          {
            seedEntityId: seed,
            outputEntityId: copy,
            instanceIndex: 1,
            seedPointIds: ["sketch_point_seed"],
            outputPointIds: ["sketch_point_copy"],
          },
        ],
      },
    ],
    dimensionIds: ["dimension_diameter"],
    dimensions: [
      {
        kind: "diameter",
        dimensionId: "dimension_diameter",
        label: "Diameter",
        entityId: copy,
        value: 4,
      },
    ],
  };
  expectState(definition, "underConstrained");
  expectState(
    withConstraints(definition, [fix("seed", "seed", [0, 0])]),
    "wellConstrained",
  );
});

test("rank work follows equation support and runs once per public solve, not during drag frames", () => {
  const fixture = makeSketchFixture();
  const constraints: ConstraintDefinition[] = [];
  const count = 100;
  for (let i = 0; i < count; i += 1) {
    fixture.point(`a${i}`, 0, i * 10);
    fixture.point(`b${i}`, 10, i * 10);
    fixture.line(`line${i}`, `a${i}`, `b${i}`);
    constraints.push(
      fix(`a${i}`, `a${i}`, [0, i * 10]),
      fix(`b${i}`, `b${i}`, [10, i * 10]),
    );
  }
  const definition = withConstraints(
    literalResolvedDefinition(fixture.definition()),
    constraints,
  );
  const program = compileSketchSolveProgram(input(definition));
  const trace = traceSketchSolverForTest(() =>
    solveCompiledSketchProgram(program),
  );
  expect(trace.result.status.constraintState).toBe("wellConstrained");
  expect(trace.work.constrainednessClassifications).toBe(1);
  // Each fixed-point record reads its two authority variables: 1 + 2*2 calls.
  expect(trace.work.componentResidualEvaluations).toBe(count * 2 * 5);
  const started = startCompiledSketchSolveSession({
    program,
    sessionId: "interactive_sketch_solve_rank_work",
  });
  expect(started.kind).toBe("started");
  if (started.kind !== "started") throw new Error("Expected a solved session.");
  const drag = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(
      started.session,
      {
        kind: "sketchPoint",
        pointId: "sketch_point_a0",
        position: [1, 0],
      },
      null,
    ),
  );
  expect(drag.work.constrainednessClassifications).toBe(0);
  expect(drag.work.componentResidualEvaluations).toBe(0);
  const released = traceSketchSolverForTest(() =>
    updateCompiledSketchSolveSession(started.session, {
      kind: "sketchPoint",
      pointId: "sketch_point_a0",
      position: [1, 0],
    }),
  );
  expect(released.work.constrainednessClassifications).toBe(1);
  expect(released.work.componentResidualEvaluations).toBe(count * 2 * 5);
  expect(released.result.kind).toBe("solved");
  if (released.result.kind !== "solved")
    throw new Error("Expected an accepted release.");
  expect(released.result.solvedSnapshot.status).toEqual({
    solveState: "solved",
    constraintState: "wellConstrained",
  });
});
