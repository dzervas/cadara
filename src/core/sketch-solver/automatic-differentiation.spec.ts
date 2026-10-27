import { expect, test } from "vitest";
import { compileSketchSolveProgram } from "./compile-program";
import { dragFrameRowsForTest } from "./solver-test-seams";
import { updateCompiledSketchSolveSession } from "./update-session";
import {
  dragConditioningFixture,
  startConditioningReplay,
} from "./solver-drag-conditioning.fixtures";
import {
  FIXTURE_SKETCH_ID,
  literalResolvedDefinition,
  makeSketchFixture,
  neutralSpan,
  projectedSpline,
} from "@/contracts/sketch/region-extraction.fixtures";
import { createSessionCommitFactories } from "@/domain/editor/sketch-session/tool-authoring";
import { createSketchOffsetDerivationContribution } from "@/domain/sketch-editing/operations";
import type { ComponentJacobian } from "./automatic-differentiation";
import type {
  ProjectedGeometryId,
  ReferenceId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchDefinition as AuthoredSketchDefinition,
} from "@/contracts/sketch/schema";
import type {
  ProjectedSketchReferenceGeometry,
  ProjectedSketchReferenceRecord,
} from "@/contracts/solver/schema";
// Logic lane: every compiled row's analytic component Jacobian
// (`evaluateComponentJacobian`, cadara-p4r5.1) and every explicit inequality
// row against central differences of the row's own components, on the shared
// solver fixtures. A row without a Jacobian, or with a wrong one, fails here.

type Program = ReturnType<typeof compileSketchSolveProgram>;
type Row = {
  label: string;
  variableIndices: readonly number[];
  jacobian(values: Float64Array): ComponentJacobian;
  components(values: Float64Array): readonly number[];
};

/**
 * Central differences (step ∛ε·max(1, |x|)), accepting a one-sided
 * difference where the component is piecewise (|·|, an arc-sweep branch)
 * and the active branch's derivative is one of the two sides. Outside the
 * support, one joint perturbation of every other column (distinct steps)
 * must leave the components bitwise unchanged: a dependence the support
 * misses fails there instead of passing with a zero analytic entry.
 */
function jacobianMismatches(row: Row, values: Float64Array): string[] {
  const base = row.components(values);
  const { components, rows, unavailable } = row.jacobian(values);
  if (unavailable)
    return [`${row.label}: unavailable ${JSON.stringify(unavailable)}`];
  // The dual twin mirrors the row's operations: its values are bitwise equal.
  if (
    components.length !== base.length ||
    !components.every((value, index) => Object.is(value, base[index]))
  )
    return [`${row.label}: components ${components} ≠ ${base}`];
  const support = new Set(row.variableIndices);
  const mismatches: string[] = [];
  rows.forEach((jacobianRow, component) =>
    jacobianRow.forEach((value, index) => {
      if (value !== 0 && !support.has(index))
        mismatches.push(
          `${row.label}[${component}]: ∂/∂x${index} = ${value} outside its support`,
        );
    }),
  );
  if (!base.every(Number.isFinite)) return mismatches;
  const outside = Float64Array.from(values);
  outside.forEach((value, index) => {
    if (!support.has(index))
      outside[index] =
        value +
        Math.cbrt(Number.EPSILON) *
          (1 + (index % 7)) *
          Math.max(1, Math.abs(value));
  });
  const moved = row.components(outside);
  if (!moved.every((value, component) => Object.is(value, base[component])))
    mismatches.push(
      `${row.label}: components ${base} move to ${moved} outside the support`,
    );
  for (const index of support) {
    const step =
      Math.cbrt(Number.EPSILON) * Math.max(1, Math.abs(values[index]!));
    const plus = Float64Array.from(values);
    const minus = Float64Array.from(values);
    plus[index] += step;
    minus[index] -= step;
    const next = row.components(plus);
    const previous = row.components(minus);
    base.forEach((value, component) => {
      const analytic = rows[component]![index]!;
      const central = (next[component]! - previous[component]!) / (2 * step);
      const forward = (next[component]! - value) / step;
      const backward = (value - previous[component]!) / step;
      const scale = Math.max(1, Math.abs(analytic), Math.abs(central));
      if (
        Math.abs(analytic - central) <= 1e-5 * scale ||
        Math.abs(analytic - forward) <= 1e-4 * scale ||
        Math.abs(analytic - backward) <= 1e-4 * scale
      )
        return;
      mismatches.push(
        `${row.label}[${component}]: ∂/∂x${index} analytic ${analytic}, central ${central} (forward ${forward}, backward ${backward})`,
      );
    });
  }
  return mismatches;
}

function programRows(program: Program): Row[] {
  const kindById = new Map<string, string>([
    ...program.definition.constraints.map(
      (constraint) => [constraint.constraintId, constraint.kind] as const,
    ),
    ...program.definition.dimensions.map(
      (dimension) => [dimension.dimensionId, dimension.kind] as const,
    ),
  ]);
  const { system } = program;
  return [
    ...system.scalarConstraints.map(
      (record, equation): Row => ({
        label: `${kindById.get(record.id) ?? "internal"} ${record.id}`,
        variableIndices: program.equationMetadata[equation]!.variableIndices,
        jacobian: (values) => record.evaluateComponentJacobian(values),
        components: (values) => record.evaluateComponents(values),
      }),
    ),
    ...system.inequalities.map(
      (record): Row => ({
        label: `${record.kind} ${record.id}`,
        variableIndices: record.variableIndices,
        jacobian: (values) => record.evaluate(values),
        components: (values) => record.evaluate(values).components,
      }),
    ),
    ...system.orientedTangencies.map(
      (record): Row => ({
        label: `orientedTangency ${record.id}`,
        variableIndices: record.variableIndices,
        jacobian: (values) => record.evaluate(values),
        components: (values) => record.evaluate(values).components,
      }),
    ),
  ];
}

function expectConformingJacobians(program: Program, values: Float64Array) {
  const rows = programRows(program);
  // Every row is differentiated: none is skipped as non-finite.
  expect(
    rows.filter((row) => !row.components(values).every(Number.isFinite)),
  ).toEqual([]);
  expect(rows.flatMap((row) => jacobianMismatches(row, values))).toEqual([]);
}

const TOLERANCES = {
  coincidence: 1e-6,
  angleRadians: 1e-6,
  minimumSegmentLength: 1e-6,
} as const;

function compile(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[] = [],
) {
  return compileSketchSolveProgram({
    definition,
    projectedReferences,
    tolerances: TOLERANCES,
    modelingTolerance: 1e-3,
    partialSolvePolicy: "bestEffort",
  });
}

const pid = (name: string) => `sketch_point_${name}` as SketchPointId;
const eid = (name: string) => `sketch_entity_${name}` as SketchEntityId;
const local = (name: string) => ({
  kind: "localEntity" as const,
  entityId: eid(name),
});
const localPoint = (name: string) => ({
  kind: "localPoint" as const,
  pointId: pid(name),
});
const datum = (name: "origin" | "xAxis" | "yAxis") => ({
  kind: "sketchDatum" as const,
  datum: name,
});
const projectedOperand = (
  geometry: string,
  kind:
    | "projectedPoint"
    | "projectedLineSegment"
    | "projectedCircle"
    | "projectedArc"
    | "projectedSpline",
) => ({
  kind: "projectedGeometry" as const,
  reference: {
    kind,
    referenceId: "ref_catalogue" as ReferenceId,
    geometryId: `projected_geometry_${geometry}` as ProjectedGeometryId,
  },
});

/**
 * One row of every authored constraint and dimension kind the solver
 * compiles that the T18 capture lacks, on one unsolved sketch (a Jacobian
 * is checked wherever the rows are, satisfied or not), away from the
 * kinks of |·| and the arc sweeps. Projected operands come from one
 * reference; a spline/arc endpoint tangency shares the spline's first fit
 * point as the arc's start.
 */
function rowCatalogue() {
  const sketch = makeSketchFixture();
  for (const [name, x, y] of [
    ["a", 0, 0],
    ["b", 4, 0.3],
    ["c", 4.2, 3],
    ["d", 0.1, 3.2],
    ["e", 6, 0],
    ["f", 9, 3.1],
    ["g", 12, 1],
    ["h", 15.5, 1.2],
    ["i", 12, 8],
    ["j", 14, 8.1],
    ["k", 12.1, 10],
    ["l", 17, 8],
    ["m", 18.5, 8.2],
    ["n", 17.1, 9.6],
    ["p", 2, 1.5],
    ["q", 3, 2.2],
    ["r", 5.3, 5.1],
    ["s", 5.6, 1.1],
    ["t0", 0, -3],
    ["t1", 2, -2],
    ["t2", 4, -3.5],
    ["u", 2.1, -1.9],
    ["w", -2, -3.1],
    ["x", -2.2, -1],
    ["y", 7, -1],
    ["z", 10, 2.1],
  ] as const)
    sketch.point(name, x, y);
  sketch.line("l1", "a", "b");
  sketch.line("l2", "c", "d");
  sketch.line("l3", "e", "f");
  sketch.line("l4", "y", "z");
  sketch.circle("c1", "g", 2);
  sketch.circle("c2", "h", 1.4);
  sketch.arc("a1", "i", "j", "k");
  sketch.arc("a2", "l", "m", "n");
  sketch.arc("a3", "w", "t0", "x", "clockwise");
  sketch.spline("s1", ["t0", "t1", "t2"], "open", [null, [1.5, 0.4], null]);
  sketch.project("catalogue", [
    { geometryId: "projected_geometry_pp", kind: "point", position: [1, -1] },
    {
      geometryId: "projected_geometry_pl",
      kind: "lineSegment",
      startPosition: [-1, 6],
      endPosition: [8, 7.5],
    },
    {
      geometryId: "projected_geometry_pc",
      kind: "circle",
      centerPosition: [20, 0],
      radius: 1.5,
    },
    {
      geometryId: "projected_geometry_pa",
      kind: "arc",
      centerPosition: [22, 5],
      startPosition: [25, 5],
      endPosition: [22, 8],
      sweepDirection: "counterClockwise",
    },
    projectedSpline("projected_geometry_ps", [
      neutralSpan(
        [
          [0, 9],
          [1, 10.5],
          [2, 10.5],
          [3, 9],
        ],
        0,
        ["ps0", "ps1"],
        0,
      ),
    ]),
  ] as ProjectedSketchReferenceGeometry[]);
  const built = sketch.build();
  const constraints = [
    {
      kind: "angle",
      pointIds: [pid("p"), pid("q"), pid("a")],
      valueRadians: 1,
    },
    {
      kind: "angle",
      pointIds: [pid("q"), pid("r"), pid("s")],
      valueRadians: 0,
    },
    { kind: "equalLength", entityIds: [eid("c1"), eid("c2")] },
    { kind: "equalLength", entityIds: [eid("l1"), eid("l2")] },
    { kind: "parallel", entityIds: [eid("l1"), eid("l2")] },
    { kind: "perpendicular", entityIds: [eid("l1"), eid("l3")] },
    { kind: "midpoint", point: localPoint("p"), line: local("l3") },
    {
      kind: "midpointProjectedLine",
      point: localPoint("q"),
      projectedLine: projectedOperand("pl", "projectedLineSegment"),
    },
    {
      kind: "midpointProjectedLine",
      point: localPoint("r"),
      projectedLine: datum("xAxis"),
    },
    { kind: "pointOnCurve", point: localPoint("p"), curve: local("l1") },
    { kind: "pointOnCurve", point: localPoint("r"), curve: local("c1") },
    { kind: "pointOnCurve", point: localPoint("s"), curve: local("a1") },
    { kind: "pointOnCurve", point: localPoint("u"), curve: local("s1") },
    { kind: "collinear", target: localPoint("q"), line: local("l2") },
    { kind: "collinear", target: local("l3"), line: local("l1") },
    {
      kind: "collinearProjectedLine",
      target: localPoint("r"),
      projectedLine: projectedOperand("pl", "projectedLineSegment"),
    },
    {
      kind: "collinearProjectedLine",
      target: local("l2"),
      projectedLine: datum("yAxis"),
    },
    {
      kind: "parallelProjectedLine",
      line: local("l1"),
      projectedLine: projectedOperand("pl", "projectedLineSegment"),
    },
    {
      kind: "perpendicularProjectedLine",
      line: local("l2"),
      projectedLine: datum("xAxis"),
    },
    {
      kind: "tangentProjectedCurve",
      curve: local("l3"),
      projectedCurve: projectedOperand("pc", "projectedCircle"),
      relation: "external",
    },
    {
      kind: "tangentProjectedCurve",
      curve: local("c2"),
      projectedCurve: projectedOperand("pa", "projectedArc"),
      relation: "external",
    },
    {
      kind: "tangentProjectedCurve",
      curve: local("a2"),
      projectedCurve: projectedOperand("pc", "projectedCircle"),
      relation: "internal",
    },
    {
      kind: "tangent",
      entityIds: [eid("l2"), eid("a1")],
      relation: "external",
    },
    {
      kind: "tangent",
      entityIds: [eid("l1"), eid("c1")],
      relation: "external",
    },
    {
      kind: "tangent",
      entityIds: [eid("c1"), eid("c2")],
      relation: "external",
    },
    {
      kind: "tangent",
      entityIds: [eid("a1"), eid("a2")],
      relation: "internal",
    },
    {
      kind: "tangent",
      entityIds: [eid("s1"), eid("a3")],
      relation: "external",
    },
    { kind: "concentric", entityIds: [eid("c1"), eid("a1")] },
    {
      kind: "concentricProjectedCurve",
      curve: local("c2"),
      projectedCurve: projectedOperand("pc", "projectedCircle"),
    },
    {
      kind: "normal",
      line: local("l3"),
      curve: local("c1"),
      point: localPoint("r"),
    },
    {
      kind: "normalProjectedCurve",
      line: local("l2"),
      projectedCurve: projectedOperand("pa", "projectedArc"),
      point: localPoint("s"),
    },
    { kind: "symmetric", pointIds: [pid("p"), pid("q")], axis: local("l3") },
    {
      kind: "symmetricProjectedLine",
      pointIds: [pid("r"), pid("s")],
      projectedLine: projectedOperand("pl", "projectedLineSegment"),
    },
    {
      kind: "equalOffset",
      pairs: [
        { seedEntityId: eid("l1"), offsetEntityId: eid("l2"), side: "left" },
        { seedEntityId: eid("l3"), offsetEntityId: eid("l4"), side: "right" },
      ],
    },
    {
      kind: "coincidentProjectedPoint",
      point: localPoint("a"),
      projectedPoint: projectedOperand("pp", "projectedPoint"),
    },
    {
      kind: "coincidentProjectedPoint",
      point: localPoint("d"),
      projectedPoint: datum("origin"),
    },
    {
      kind: "pointOnProjectedCurve",
      point: localPoint("p"),
      projectedCurve: projectedOperand("pl", "projectedLineSegment"),
    },
    {
      kind: "pointOnProjectedCurve",
      point: localPoint("q"),
      projectedCurve: projectedOperand("pa", "projectedArc"),
    },
    {
      kind: "pointOnProjectedCurve",
      point: localPoint("r"),
      projectedCurve: projectedOperand("pc", "projectedCircle"),
    },
    {
      kind: "pointOnProjectedCurve",
      point: localPoint("s"),
      projectedCurve: projectedOperand("ps", "projectedSpline"),
    },
    {
      kind: "pointOnProjectedCurve",
      point: localPoint("t1"),
      projectedCurve: datum("xAxis"),
    },
    { kind: "coincident", pointIds: [pid("b"), pid("c")] },
    { kind: "horizontal", entityId: eid("l1") },
    { kind: "vertical", entityId: eid("l2") },
    { kind: "fixPoint", pointId: pid("e"), position: [6.1, 0.2] },
  ].map((constraint, index) => ({
    ...constraint,
    constraintId: `constraint_catalogue_${index}`,
    label: `catalogue ${index}`,
  }));
  const dimensions = [
    {
      kind: "distance",
      axis: "aligned",
      pointIds: [pid("a"), pid("c")],
      value: 5,
    },
    {
      kind: "distance",
      axis: "horizontal",
      pointIds: [pid("a"), pid("b")],
      value: 4,
    },
    {
      kind: "distance",
      axis: "vertical",
      pointIds: [pid("a"), pid("d")],
      value: 3,
    },
    { kind: "horizontalDistance", pointIds: [pid("d"), pid("c")], value: 4 },
    { kind: "verticalDistance", pointIds: [pid("b"), pid("c")], value: 3 },
    { kind: "circleRadius", entityId: eid("c1"), value: 2 },
    { kind: "diameter", entityId: eid("c2"), value: 3 },
    { kind: "diameter", entityId: eid("a1"), value: 4 },
    {
      kind: "pointDatumDistance",
      axis: "aligned",
      point: localPoint("c"),
      datum: datum("origin"),
      value: 5,
    },
    {
      kind: "pointDatumDistance",
      axis: "horizontal",
      point: localPoint("q"),
      datum: datum("origin"),
      value: 2,
    },
    {
      kind: "pointDatumDistance",
      axis: "vertical",
      point: localPoint("r"),
      datum: datum("origin"),
      value: 0,
    },
    { kind: "lineLength", entityId: eid("l1"), value: 4 },
    { kind: "lineDistance", lines: [local("l3"), local("l4")], value: 1 },
    {
      kind: "linePointDistance",
      line: local("l1"),
      point: localPoint("c"),
      value: 3,
    },
    {
      kind: "linePointDistance",
      line: datum("yAxis"),
      point: localPoint("s"),
      value: 0,
    },
    { kind: "lineAngle", lines: [local("l1"), local("l3")], valueRadians: 0.7 },
    { kind: "arcStartPointCoincident", entityId: eid("a2"), pointId: pid("m") },
    { kind: "arcEndPointCoincident", entityId: eid("a2"), pointId: pid("n") },
  ].map((dimension, index) => ({
    ...dimension,
    dimensionId: `dimension_catalogue_${index}`,
    label: `catalogue ${index}`,
  }));
  return compile(
    {
      ...built.definition,
      constraintIds: constraints.map((entry) => entry.constraintId),
      constraints,
      dimensionIds: dimensions.map((entry) => entry.dimensionId),
      dimensions,
    } as unknown as SketchDefinition,
    built.projectedReferences,
  );
}

test("row catalogue: every constraint and dimension kind's Jacobian matches central differences", () => {
  const program = rowCatalogue();
  expectConformingJacobians(program, program.system.initialValues);
  // Every authored requirement compiled a row; every inequality kind occurs.
  const compiled = new Set(
    program.system.scalarConstraints.map((row) => row.id),
  );
  expect(
    [
      ...program.definition.constraints.map((entry) => entry.constraintId),
      ...program.definition.dimensions.map((entry) => entry.dimensionId),
    ].filter((id) => !compiled.has(id)),
  ).toEqual([]);
  expect(
    [...new Set(program.system.inequalities.map((row) => row.kind))].sort(),
  ).toEqual(["arcSweepEnd", "arcSweepStart", "radius", "segmentLength"]);
  expect(
    program.system.scalarConstraints.filter(
      (row) => row.hingeComponentIndices?.length,
    ).length,
  ).toBe(3);
});

/**
 * Requirements on mirror outputs (a line, a radius-slot arc and a circle
 * reflected across a line axis): their Jacobians pull back through the
 * mirror onto the seeds and the axis.
 */
function mirrorOutputs() {
  const sketch = makeSketchFixture();
  for (const [name, x, y] of [
    ["ax0", 0, -1],
    ["ax1", 0.2, 5],
    ["s0", 1, 0],
    ["s1", 2, 2.1],
    ["sc", 3, 1],
    ["ss", 4, 1.2],
    ["se", 3.1, 2],
    ["cc", 2, 4],
    ["m0", -1, 0],
    ["m1", -2, 2.1],
    ["mc", -3, 1],
    ["ms", -4, 1.2],
    ["me", -3.1, 2],
    ["mcc", -2, 4],
    ["free", -2.5, 3],
  ] as const)
    sketch.point(name, x, y);
  sketch.line("axis", "ax0", "ax1");
  sketch.line("seedLine", "s0", "s1");
  sketch.arc("seedArc", "sc", "ss", "se");
  sketch.circle("seedCircle", "cc", 0.5);
  sketch.line("mirrorLine", "m0", "m1");
  sketch.arc("mirrorArc", "mc", "ms", "me", "clockwise");
  sketch.circle("mirrorCircle", "mcc", 0.5);
  const definition = sketch.definition();
  const output = (
    seed: string,
    out: string,
    seeds: string[],
    outs: string[],
  ) => ({
    seedEntityId: eid(seed),
    outputEntityId: eid(out),
    instanceIndex: 1,
    seedPointIds: seeds.map(pid),
    outputPointIds: outs.map(pid),
  });
  const constraints = [
    {
      kind: "pointOnCurve",
      point: localPoint("free"),
      curve: local("mirrorArc"),
    },
    {
      kind: "tangent",
      entityIds: [eid("mirrorLine"), eid("mirrorArc")],
      relation: "external",
    },
    {
      kind: "tangent",
      entityIds: [eid("mirrorCircle"), eid("mirrorArc")],
      relation: "external",
    },
    { kind: "horizontal", entityId: eid("mirrorLine") },
  ].map((constraint, index) => ({
    ...constraint,
    constraintId: `constraint_mirror_${index}`,
    label: `mirror ${index}`,
  }));
  const dimensions = [
    {
      kind: "distance",
      axis: "aligned",
      pointIds: [pid("m1"), pid("free")],
      value: 1,
    },
    { kind: "circleRadius", entityId: eid("mirrorCircle"), value: 0.7 },
  ].map((dimension, index) => ({
    ...dimension,
    dimensionId: `dimension_mirror_${index}`,
    label: `mirror ${index}`,
  }));
  return compile({
    ...definition,
    constraintIds: constraints.map((entry) => entry.constraintId),
    constraints,
    dimensionIds: dimensions.map((entry) => entry.dimensionId),
    dimensions,
    derivedRelationships: [
      {
        kind: "mirror",
        derivationId: "derivation_mirror",
        label: "mirror",
        seedEntityIds: [eid("seedLine"), eid("seedArc"), eid("seedCircle")],
        mirrorReference: { kind: "lineEntity", entityId: eid("axis") },
        outputs: [
          output("seedLine", "mirrorLine", ["s0", "s1"], ["m0", "m1"]),
          output(
            "seedArc",
            "mirrorArc",
            ["sc", "ss", "se"],
            ["mc", "ms", "me"],
          ),
          output("seedCircle", "mirrorCircle", ["cc"], ["mcc"]),
        ],
      },
    ],
  } as unknown as SketchDefinition);
}

test("mirror outputs: requirements on derived geometry pull their Jacobians back onto the seeds and axis", () => {
  const program = mirrorOutputs();
  expect(program.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expectConformingJacobians(program, program.system.initialValues);
});

/**
 * A point on the derived shell of a spline offset (T08b-g5 U-G2): the
 * closest-point residual's Jacobian pulls back through the offset frame.
 */
function shellPoint() {
  const sketch = makeSketchFixture();
  for (const [name, x, y] of [
    ["f0", 0, 0],
    ["f1", 1, 1],
    ["f2", 2, -0.4],
    ["target", 1, 0.8],
  ] as const)
    sketch.point(name, x, y);
  sketch.spline("seed", ["f0", "f1", "f2"], "open", [null, [1.2, -0.4], null]);
  const definition = sketch.definition();
  const offset = createSketchOffsetDerivationContribution({
    definition,
    entityIds: [eid("seed")],
    distance: 0.2,
    side: "right",
    sequence: 900,
    factories: createSessionCommitFactories(900, FIXTURE_SKETCH_ID),
    modelingTolerance: 1e-3,
    documentVariables: [],
  });
  if (!offset.valid || !offset.contribution)
    throw new Error(`offset: ${offset.message}`);
  const { contribution } = offset;
  const shell = contribution.entities.find(
    (entity) => entity.kind === "derivedPiecewiseCubic",
  )!;
  const points = [...definition.points, ...contribution.points];
  const entities = [...definition.entities, ...contribution.entities];
  const constraints = [
    {
      constraintId: "constraint_shell_point",
      kind: "pointOnCurve",
      label: "on offset",
      point: localPoint("target"),
      curve: { kind: "localEntity", entityId: shell.entityId },
    },
  ];
  return compile(
    literalResolvedDefinition({
      ...definition,
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((entry) => entry.constraintId),
      constraints,
      derivedRelationships: contribution.derivedRelationships,
    } as AuthoredSketchDefinition),
  );
}

test("offset shell: a point-on-shell row's Jacobian includes the moving closest location", () => {
  const program = shellPoint();
  expect(program.system.scalarConstraints.map((row) => row.id)).toContain(
    "constraint_shell_point",
  );
  expectConformingJacobians(program, program.system.initialValues);
});

test("T18 drag fixture: every row's Jacobian matches central differences along the drag-small replay", () => {
  const row = dragConditioningFixture.cases.find(
    (candidate) => candidate.scenario === "drag-small",
  )!;
  const session = startConditioningReplay(row);
  expectConformingJacobians(session.program, session.values);
  for (const [target, tolerance] of row.targets.slice(0, 6))
    updateCompiledSketchSolveSession(session, target, tolerance);
  expectConformingJacobians(session.program, session.values);
  const kinds = new Set(session.program.system.inequalities.map((r) => r.kind));
  expect([...kinds].sort()).toEqual([
    "arcSweepEnd",
    "arcSweepStart",
    "radius",
    "segmentLength",
  ]);
});

test("T18 drag frames: target, translate, radius, tangent-vector, exact-zero, anchor and dragTarget rows match central differences", () => {
  const row = dragConditioningFixture.cases.find(
    (candidate) => candidate.scenario === "drag-small",
  )!;
  const { program, values } = startConditioningReplay(row);
  const { system } = program;
  const [first, second] = [...system.pointRecords.values()];
  // A point-defined (offset seed) arc: its radius slot pulls back onto points.
  const seedArc = program.definition.entities.find(
    (entity) =>
      entity.kind === "arc" &&
      (program.definition.derivedRelationships ?? []).some(
        (relationship) =>
          relationship.kind === "offset" &&
          relationship.seedEntityIds.includes(entity.entityId),
      ),
  )!;
  const tangent = [...system.splineTangentStates.values()][0]!;
  const position = (index: number): [number, number] => [
    values[index]! + 0.3,
    values[index + 1]! - 0.2,
  ];
  const targets = [
    {
      kind: "sketchPoint",
      pointId: first!.pointId,
      position: position(first!.baseIndex),
    },
    {
      kind: "sketchTranslate",
      pointIds: [first!.pointId, second!.pointId],
      delta: [0.1, -0.05],
    },
    { kind: "sketchRadius", entityId: seedArc.entityId, targetRadius: 2 },
    {
      kind: "sketchTangentVector",
      entityId: tangent.entityId,
      occurrenceId: tangent.occurrenceId,
      targetVector: [0.4, 0.1],
    },
    {
      kind: "sketchTangentVector",
      entityId: tangent.entityId,
      occurrenceId: tangent.occurrenceId,
      targetVector: [0, 0],
      exactZero: true,
    },
  ] as const;
  const labels: string[] = [];
  const rows = targets.flatMap((target) =>
    dragFrameRowsForTest({
      program,
      target,
      values,
      anchorVariableIndices: program.components[0]!.variableIndices,
    }).map(({ record, variableIndices }): Row => {
      labels.push(record.id);
      return {
        label: `${target.kind} ${record.id}`,
        variableIndices,
        jacobian: (at) => record.evaluateComponentJacobian(at),
        components: (at) => record.evaluateComponents(at),
      };
    }),
  );
  expect(new Set(labels.map((id) => id.replace(/_sketch_.*$/, "")))).toEqual(
    new Set([
      "constraint_drag_target",
      "constraint_drag_radius",
      "constraint_drag_tangent",
      "constraint_drag_tangent_zero_x",
      "constraint_drag_tangent_zero_y",
      "constraint_minimum_motion_anchor_test",
    ]),
  );
  // The radius row reads the arc's centre and start points, not a slot.
  const radiusRow = rows.find((entry) =>
    entry.label.startsWith("sketchRadius"),
  )!;
  expect(radiusRow.jacobian(values).rows[0]!.some((value) => value !== 0)).toBe(
    true,
  );
  expect(
    rows.filter((entry) => !entry.components(values).every(Number.isFinite)),
  ).toEqual([]);
  expect(rows.flatMap((entry) => jacobianMismatches(entry, values))).toEqual(
    [],
  );
});

test("T18 fillet tangents (cadara-p4r5.2): the start contact's loss component 0 is its first-order oriented row; the end contact keeps |d| \u2212 r", () => {
  const row = dragConditioningFixture.cases.find(
    (candidate) => candidate.scenario === "drag-small",
  )!;
  const { program, values } = startConditioningReplay(row);
  const pair = (prefix: string) => {
    const oriented = program.system.orientedTangencies.find((record) =>
      record.requirementId.startsWith(prefix),
    )!;
    const tangency = program.system.scalarConstraints.find(
      (record) => record.id === oriented.requirementId,
    )!;
    const arc = program.definition.entities.find(
      (entity) => entity.entityId === oriented.arcEntityId,
    );
    return {
      atStart:
        arc?.kind === "arc" && arc.startPointId === oriented.contactPointId,
      oriented: oriented.evaluate(values),
      loss: tangency.evaluateComponentJacobian(values),
      components: tangency.evaluateComponents(values),
    };
  };
  const a = pair("constraint_17_fillet-tangent-a_");
  const b = pair("constraint_17_fillet-tangent-b_");
  expect([a.atStart, b.atStart]).toEqual([true, false]);
  // Tangent A: the loss reads (s \u2212 c)\u00b7u (rank 1, \u2016\u2207\u2016 \u2248 1.5), not the
  // second-order |d| \u2212 r (\u2016\u2207\u2016 \u2248 1e-5 at satisfaction).
  expect(Object.is(a.components[0], a.oriented.components[0])).toBe(true);
  expect(Object.is(a.loss.components[0], a.oriented.components[0])).toBe(true);
  expect([...a.loss.rows[0]!]).toEqual([...a.oriented.rows[0]!]);
  expect(Math.hypot(...a.loss.rows[0]!)).toBeGreaterThan(0.5);
  // Tangent B keeps |d| \u2212 r: its oriented row reads ~2e-3 at this state.
  expect(Math.abs(b.oriented.components[0]!)).toBeGreaterThan(1e-4);
  expect(Math.abs(b.components[0]!)).toBeLessThan(1e-5);
});

/**
 * A line tangent to a point-defined arc (an offset seed) whose contact is
 * joined by a coincident constraint, not a shared point id.
 */
function coincidentTangency() {
  const sketch = makeSketchFixture();
  for (const [name, x, y] of [
    ["l0", -3, 1.02],
    ["l1", 0.02, 1],
    ["ac", 0, 0],
    ["as", 0, 1],
    ["ae", 1, 0],
  ] as const)
    sketch.point(name, x, y);
  sketch.line("line", "l0", "l1");
  sketch.arc("arc", "ac", "as", "ae", "clockwise");
  const definition = sketch.definition();
  const offset = createSketchOffsetDerivationContribution({
    definition,
    entityIds: [eid("arc")],
    distance: 0.2,
    side: "right",
    sequence: 900,
    factories: createSessionCommitFactories(900, FIXTURE_SKETCH_ID),
    modelingTolerance: 1e-3,
    documentVariables: [],
  });
  if (!offset.valid || !offset.contribution)
    throw new Error(`offset: ${offset.message}`);
  const { contribution } = offset;
  const points = [...definition.points, ...contribution.points];
  const entities = [...definition.entities, ...contribution.entities];
  const constraints = [
    {
      constraintId: "constraint_join",
      kind: "coincident",
      label: "join",
      pointIds: [pid("l1"), pid("as")],
    },
    {
      constraintId: "constraint_tangent",
      kind: "tangent",
      label: "tangent",
      entityIds: [eid("line"), eid("arc")],
      relation: "external",
    },
  ];
  return compile(
    literalResolvedDefinition({
      ...definition,
      pointIds: points.map((point) => point.pointId),
      points,
      entityIds: entities.map((entity) => entity.entityId),
      entities,
      constraintIds: constraints.map((entry) => entry.constraintId),
      constraints,
      derivedRelationships: contribution.derivedRelationships,
    } as unknown as AuthoredSketchDefinition),
  );
}

test("coincident-joined contact: a point-defined arc's tangency gets its first-order row", () => {
  const program = coincidentTangency();
  expect(
    program.system.orientedTangencies.map(
      ({ requirementId, arcEntityId, contactPointId }) => ({
        requirementId,
        arcEntityId,
        contactPointId,
      }),
    ),
  ).toEqual([
    {
      requirementId: "constraint_tangent",
      arcEntityId: eid("arc"),
      contactPointId: pid("as"),
    },
  ]);
  expectConformingJacobians(program, program.system.initialValues);
});

test("degenerate rows are flagged, never zero rows: an unlocatable sweep contact is NaN, a failed relationship is unavailable", () => {
  const catalogue = rowCatalogue();
  const values = Float64Array.from(catalogue.system.initialValues);
  // Collapse l2 (c \u2192 d): its tangency to a1 has no contact.
  const [c, d] = [pid("c"), pid("d")].map(
    (id) => catalogue.system.pointRecords.get(id)!.baseIndex,
  );
  values[c!] = values[d!]!;
  values[c! + 1] = values[d! + 1]!;
  const tangentId = catalogue.definition.constraints.find(
    (constraint) =>
      constraint.kind === "tangent" &&
      constraint.entityIds[0] === eid("l2") &&
      constraint.entityIds[1] === eid("a1"),
  )!.constraintId;
  const sweep = catalogue.system.inequalities.filter(
    (record) => record.requirement?.id === tangentId,
  );
  expect(sweep.map((record) => record.kind).sort()).toEqual([
    "arcSweepEnd",
    "arcSweepStart",
  ]);
  for (const record of sweep) {
    const { components, rows } = record.evaluate(values);
    expect(components[0]).toBeNaN();
    expect(
      record.variableIndices.every((index) => Number.isNaN(rows[0]![index])),
    ).toBe(true);
  }

  const mirror = mirrorOutputs();
  const collapsed = Float64Array.from(mirror.system.initialValues);
  // A zero-length axis: the mirror fails at these values.
  const [ax0, ax1] = [pid("ax0"), pid("ax1")].map(
    (id) => mirror.system.pointRecords.get(id)!.baseIndex,
  );
  collapsed[ax1!] = collapsed[ax0!]!;
  collapsed[ax1! + 1] = collapsed[ax0! + 1]!;
  const horizontal = mirror.system.scalarConstraints.find(
    (record) => record.id === "constraint_mirror_3",
  )!;
  const jacobian = horizontal.evaluateComponentJacobian(collapsed);
  expect(jacobian.unavailable).toEqual([
    { derivationId: "derivation_mirror", reason: "failedDuringSolve" },
  ]);
  expect(jacobian.rows.every((entry) => entry.every(Number.isNaN))).toBe(true);
  expect(jacobian.components).toEqual(horizontal.evaluateComponents(collapsed));
});
