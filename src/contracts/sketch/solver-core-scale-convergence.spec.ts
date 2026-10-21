// cadara-05f: logic lane, batch/session/drag acceptance at scale. Reconstructed
// from T08-r1r2-repair-review-evidence/{largescale,realistic}.probe.spec.ts.txt.
import { expect, test } from "vitest";

import type {
  NumericSketchDefinition,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import {
  literalResolvedDefinition,
  makeSketchFixture,
} from "@/contracts/sketch/region-extraction.fixtures";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  solveSketchDefinitionCore,
  startCompiledSketchSolveSession,
  traceSketchSolverForTest,
  updateCompiledSketchSolveSession,
} from "@/contracts/sketch/solver-core";

const point = (name: string) => `sketch_point_${name}` as const;
const entity = (name: string) => `sketch_entity_${name}` as const;
const angle = (25 * Math.PI) / 180;
const policies = [
  {
    name: "default",
    coincidence: 1e-3,
    angleRadians: 1e-4,
    minimumSegmentLength: 1e-3,
  },
  {
    name: "tight",
    coincidence: 1e-3,
    angleRadians: 1e-6,
    minimumSegmentLength: 1e-3,
  },
] as const;

// T08 R1/R2's actual jitter is ±scale*noise mm, NOT noise*lineLength.
// Keep its xorshift seed (seed*7919 + scale), call order, and 40:17.3 rectangle.
function rectangle(
  scale: number,
  noise: number,
  seed: number,
): NumericSketchDefinition {
  let state = (seed * 7919 + scale) >>> 0 || 1;
  const jitter = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (((state >>> 0) / 4294967296) * 2 - 1) * scale * noise;
  };
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  for (const [name, x, y] of [
    ["b", 40 * scale, 0],
    ["c", 40 * scale, 17.3 * scale],
    ["d", 0, 17.3 * scale],
  ] as const) {
    fixture.point(
      name,
      x * Math.cos(angle) - y * Math.sin(angle) + jitter(),
      x * Math.sin(angle) + y * Math.cos(angle) + jitter(),
    );
  }
  fixture.point("x", 30 * scale, jitter());
  for (const [name, a, b] of [
    ["ab", "a", "b"],
    ["bc", "b", "c"],
    ["cd", "c", "d"],
    ["da", "d", "a"],
    ["ax", "a", "x"],
  ] as const) {
    fixture.line(name, a, b);
  }
  const definition = literalResolvedDefinition(fixture.definition());
  const constraints: NumericSketchDefinition["constraints"] = [
    {
      constraintId: "constraint_fix",
      kind: "fixPoint",
      label: "fix",
      pointId: point("a"),
      position: [0, 0],
    },
    {
      constraintId: "constraint_h_ax",
      kind: "horizontal",
      label: "horizontal",
      entityId: entity("ax"),
    },
    {
      constraintId: "constraint_perp_ab_bc",
      kind: "perpendicular",
      label: "perpendicular",
      entityIds: [entity("ab"), entity("bc")],
    },
    {
      constraintId: "constraint_par_ab_cd",
      kind: "parallel",
      label: "parallel",
      entityIds: [entity("ab"), entity("cd")],
    },
    {
      constraintId: "constraint_perp_cd_da",
      kind: "perpendicular",
      label: "perpendicular",
      entityIds: [entity("cd"), entity("da")],
    },
  ];
  const dimensions: NumericSketchDefinition["dimensions"] = [
    {
      dimensionId: "dimension_len_ab",
      kind: "lineLength",
      label: "width",
      entityId: entity("ab"),
      value: 40 * scale,
    },
    {
      dimensionId: "dimension_len_bc",
      kind: "lineLength",
      label: "height",
      entityId: entity("bc"),
      value: 17.3 * scale,
    },
    {
      dimensionId: "dimension_ang_ax_ab",
      kind: "lineAngle",
      label: "angle",
      lines: [
        { kind: "localEntity", entityId: entity("ax") },
        { kind: "localEntity", entityId: entity("ab") },
      ],
      valueRadians: angle,
    },
    {
      dimensionId: "dimension_len_ax",
      kind: "lineLength",
      label: "reference length",
      entityId: entity("ax"),
      value: 30 * scale,
    },
  ];
  return {
    ...definition,
    constraints,
    constraintIds: constraints.map((row) => row.constraintId),
    dimensions,
    dimensionIds: dimensions.map((row) => row.dimensionId),
  };
}

function triangle(
  scale: number,
  noise: number,
  seed: number,
): NumericSketchDefinition {
  let state = (seed * 7919 + scale) >>> 0 || 1;
  const jitter = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (((state >>> 0) / 4294967296) * 2 - 1) * scale * noise;
  };
  const fixture = makeSketchFixture();
  fixture.point("a", 0, 0);
  fixture.point("b", 50 * scale + jitter(), jitter());
  fixture.point("c", 20 * scale + jitter(), 30 * scale + jitter());
  fixture.line("ab", "a", "b");
  fixture.line("bc", "b", "c");
  fixture.line("ca", "c", "a");
  fixture.lineLength("ab", 50 * scale);
  fixture.lineLength("ca", 33.333 * scale);
  const definition = literalResolvedDefinition(fixture.definition());
  const constraints: NumericSketchDefinition["constraints"] = [
    {
      constraintId: "constraint_fix",
      kind: "fixPoint",
      label: "fix",
      pointId: point("a"),
      position: [0, 0],
    },
    {
      constraintId: "constraint_h_ab",
      kind: "horizontal",
      label: "horizontal",
      entityId: entity("ab"),
    },
    {
      constraintId: "constraint_angle",
      kind: "angle",
      label: "angle",
      pointIds: [point("b"), point("c"), point("a")],
      valueRadians: Math.PI / 3,
    },
  ];
  return {
    ...definition,
    constraints,
    constraintIds: constraints.map((row) => row.constraintId),
  };
}

type Outcome =
  | "solved within tolerance"
  | "truthful invalid"
  | "nonconvergence";

// T08's other historical large-scale failure: a perpendicular L mirrored
// through a fixed vertical axis. Keep the authored output coordinates, too.
function mirrorL(scale: number, noise: number, seed: number) {
  let state = (seed * 7919 + scale) >>> 0 || 1;
  const jitter = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (((state >>> 0) / 4294967296) * 2 - 1) * scale * noise;
  };
  const fixture = makeSketchFixture();
  fixture.point("ax0", 0, -50 * scale);
  fixture.point("ax1", 0, 50 * scale);
  fixture.point("a", 5 * scale + jitter(), jitter());
  fixture.point("b", 25 * scale + jitter(), jitter());
  fixture.point("c", 25 * scale + jitter(), 15 * scale + jitter());
  fixture.point("o0", -5 * scale, 0);
  fixture.point("o1", -25 * scale, 0);
  fixture.point("o2", -25 * scale, 15 * scale);
  fixture.line("axis", "ax0", "ax1");
  fixture.line("ab", "a", "b");
  fixture.line("bc", "b", "c");
  fixture.line("oa", "o0", "o1");
  fixture.line("ob", "o1", "o2");
  fixture.lineLength("ab", 20 * scale);
  fixture.lineLength("bc", 15.75 * scale);
  const definition = literalResolvedDefinition(fixture.definition());
  const constraints: NumericSketchDefinition["constraints"] = [
    ...(["ax0", "ax1", "a"] as const).map((name) => ({
      constraintId: `constraint_fix_${name}` as const,
      kind: "fixPoint" as const,
      label: "fixed",
      pointId: point(name),
      position: (name === "a"
        ? [5 * scale, 0]
        : [0, (name === "ax0" ? -50 : 50) * scale]) as readonly [
        number,
        number,
      ],
    })),
    {
      constraintId: "constraint_h_ab",
      kind: "horizontal",
      label: "horizontal",
      entityId: entity("ab"),
    },
    {
      constraintId: "constraint_perp_ab_bc",
      kind: "perpendicular",
      label: "perpendicular",
      entityIds: [entity("ab"), entity("bc")],
    },
  ];
  return {
    ...definition,
    constraints,
    constraintIds: constraints.map((row) => row.constraintId),
    derivedRelationships: [
      {
        derivationId: "derivation_mirror",
        kind: "mirror",
        label: "Mirror",
        seedEntityIds: [entity("ab"), entity("bc")],
        mirrorReference: { kind: "lineEntity", entityId: entity("axis") },
        outputs: [
          {
            seedEntityId: entity("ab"),
            outputEntityId: entity("oa"),
            instanceIndex: 1,
            seedPointIds: [point("a"), point("b")],
            outputPointIds: [point("o0"), point("o1")],
          },
          {
            seedEntityId: entity("bc"),
            outputEntityId: entity("ob"),
            instanceIndex: 1,
            seedPointIds: [point("b"), point("c")],
            outputPointIds: [point("o1"), point("o2")],
          },
        ],
      },
    ],
  } satisfies NumericSketchDefinition;
}

// Do not trust the status as the measurement: inspect every requirement in
// these fixtures directly, including the sine/cosine rows and lineAngle.
function classify(
  snapshot: SolvedSketchSnapshot,
  scale: number,
  policy: (typeof policies)[number],
  scenario: "rectangle" | "triangle" | "mirrorL",
): Outcome {
  const positions = new Map(
    snapshot.solvedPoints.map((row) => [row.pointId, row.solvedPosition]),
  );
  const p = (name: string) => positions.get(point(name))!;
  const vector = (a: string, b: string) =>
    [p(b)[0] - p(a)[0], p(b)[1] - p(a)[1]] as const;
  const length = (a: string, b: string) => Math.hypot(...vector(a, b));
  const direction = (a: string, b: string) =>
    vector(a, b).map((v) => v / length(a, b));
  const dot = (u: number[], v: number[]) => u[0]! * v[0]! + u[1]! * v[1]!;
  const cross = (u: number[], v: number[]) => u[0]! * v[1]! - u[1]! * v[0]!;
  const ab = direction("a", "b"),
    bc = direction("b", "c");
  let linearError: number, angularError: number, minimumLength: number;
  if (scenario === "rectangle") {
    const cd = direction("c", "d"),
      da = direction("d", "a"),
      ax = direction("a", "x");
    linearError = Math.max(
      Math.hypot(...p("a")),
      Math.abs(p("x")[1] - p("a")[1]),
      Math.abs(length("a", "b") - 40 * scale),
      Math.abs(length("b", "c") - 17.3 * scale),
      Math.abs(length("a", "x") - 30 * scale),
    );
    angularError = Math.max(
      Math.abs(dot(ab, bc)),
      Math.abs(cross(ab, cd)),
      Math.abs(dot(cd, da)),
      Math.abs(Math.atan2(Math.abs(cross(ax, ab)), dot(ax, ab)) - angle),
    );
    minimumLength = Math.min(
      length("a", "b"),
      length("b", "c"),
      length("c", "d"),
      length("d", "a"),
      length("a", "x"),
    );
  } else if (scenario === "triangle") {
    const ac = direction("a", "c");
    linearError = Math.max(
      Math.hypot(...p("a")),
      Math.abs(p("b")[1] - p("a")[1]),
      Math.abs(length("a", "b") - 50 * scale),
      Math.abs(length("c", "a") - 33.333 * scale),
    );
    angularError = Math.abs(
      Math.atan2(Math.abs(cross(ab, ac)), dot(ab, ac)) - Math.PI / 3,
    );
    minimumLength = Math.min(
      length("a", "b"),
      length("b", "c"),
      length("c", "a"),
    );
  } else {
    linearError = Math.max(
      Math.hypot(p("a")[0] - 5 * scale, p("a")[1]),
      Math.hypot(p("ax0")[0], p("ax0")[1] + 50 * scale),
      Math.hypot(p("ax1")[0], p("ax1")[1] - 50 * scale),
      Math.abs(p("b")[1] - p("a")[1]),
      Math.abs(length("a", "b") - 20 * scale),
      Math.abs(length("b", "c") - 15.75 * scale),
      ...(["a", "b", "c"] as const).map((name, i) =>
        Math.hypot(p(`o${i}`)[0] + p(name)[0], p(`o${i}`)[1] - p(name)[1]),
      ),
    );
    angularError = Math.abs(dot(ab, bc));
    minimumLength = Math.min(
      length("a", "b"),
      length("b", "c"),
      length("o0", "o1"),
      length("o1", "o2"),
      length("ax0", "ax1"),
    );
  }
  const withinTolerance =
    linearError <= policy.coincidence &&
    angularError <= policy.angleRadians &&
    minimumLength >= policy.minimumSegmentLength;
  if (snapshot.status.solveState !== "solved") {
    expect(
      withinTolerance,
      "a rejected start has a measurable requirement violation",
    ).toBe(false);
    expect(
      snapshot.constraintStatuses.some((row) => row.status !== "satisfied") ||
        snapshot.dimensionStatuses.some((row) => row.status === "unsatisfied"),
    ).toBe(true);
    return "truthful invalid";
  }
  expect(
    snapshot.constraintStatuses.every((row) => row.status === "satisfied"),
  ).toBe(true);
  expect(
    snapshot.dimensionStatuses.every((row) => row.status !== "unsatisfied"),
  ).toBe(true);
  return withinTolerance ? "solved within tolerance" : "nonconvergence";
}

const solved = "solved within tolerance";
const invalid = "truthful invalid";

// Representative subset of the requalification: all three angular families,
// 0/2%/20% noise, original x1..x10000 scales and the 10/16 m onset seeds.
// No unreachable authored systems: the analytic witnesses below satisfy them.
// This pins honest refusal, NOT a claim that GN now converges at every scale.
const cells = [
  // scenario, scale, noise, seed, default outcome, tight outcome
  ["rectangle", 1, 0.02, 1, solved, solved],
  ["rectangle", 10, 0.2, 1, solved, solved],
  ["rectangle", 100, 0.02, 1, solved, invalid],
  ["rectangle", 250, 0.02, 4, invalid, invalid],
  ["rectangle", 400, 0.02, 3, invalid, invalid],
  ["rectangle", 1000, 0.2, 1, invalid, invalid],
  ["rectangle", 10000, 0.02, 1, invalid, invalid],
  ["rectangle", 10000, 0, 1, solved, solved],
  ["triangle", 1, 0, 1, solved, solved],
  ["triangle", 100, 0.2, 1, solved, solved],
  ["triangle", 1000, 0.02, 1, solved, solved],
  ["triangle", 10000, 0.02, 1, invalid, invalid],
  ["mirrorL", 1, 0.02, 1, solved, solved],
  ["mirrorL", 10000, 0.02, 1, invalid, invalid],
] as const;

for (const [scenario, scale, noise, seed, ...expected] of cells) {
  for (const [policyIndex, policy] of policies.entries()) {
    const widthMeters =
      ((scenario === "rectangle" ? 40 : scenario === "triangle" ? 50 : 20) *
        scale) /
      1000;
    test(`${policy.name}: ${widthMeters} m ${scenario}, noise ${noise}, seed ${seed}`, () => {
      const definition = { rectangle, triangle, mirrorL }[scenario](
        scale,
        noise,
        seed,
      );
      const input = {
        definition,
        tolerances: policy,
        modelingTolerance: policy.coincidence,
        partialSolvePolicy: "bestEffort" as const,
      };
      const batch = traceSketchSolverForTest(() =>
        solveSketchDefinitionCore(input),
      );
      const outcome = classify(
        batch.result.solvedSnapshot,
        scale,
        policy,
        scenario,
      );
      expect(outcome).toBe(expected[policyIndex]);
      expect(batch.work.lossEvaluations).toBeGreaterThan(0);
      if (outcome === invalid) {
        expect(
          batch.gaussNewtonFallbacks.some(
            (row) => !row.skipped && row.iterations > 0,
          ),
          "a rejected BFGS candidate must attempt GN, even at low loss",
        ).toBe(true);
      }
      const program = compileSketchSolveProgram(input);
      if (expected[policyIndex] === invalid) {
        expect(() =>
          createCompiledSketchSolveSession({
            sessionId: "interactive_sketch_solve_scale",
            program,
          }),
        ).toThrow("without an acceptable solved snapshot");
        expect(
          startCompiledSketchSolveSession({
            sessionId: "interactive_sketch_solve_scale_drag",
            program,
          }).kind,
        ).toBe("unacceptable");
      } else {
        const session = createCompiledSketchSolveSession({
          sessionId: "interactive_sketch_solve_scale",
          program,
        });
        expect(
          classify(session.lastAcceptedSnapshot, scale, policy, scenario),
        ).toBe(solved);
      }
      // Supply an analytic feasible previous state so a refused jittered start
      // never skips drag coverage. Only initialization uses this prior snapshot.
      let witnessDefinition = rectangle(scale, 0, 1);
      if (scenario === "triangle") {
        const clean = triangle(scale, 0, 1);
        witnessDefinition = {
          ...clean,
          points: clean.points.map((p) =>
            p.pointId === point("c")
              ? {
                  ...p,
                  position: [
                    33.333 * scale * Math.cos(Math.PI / 3),
                    33.333 * scale * Math.sin(Math.PI / 3),
                  ],
                }
              : p,
          ),
        };
      } else if (scenario === "mirrorL") {
        const clean = mirrorL(scale, 0, 1);
        witnessDefinition = {
          ...clean,
          points: clean.points.map((p) =>
            p.pointId === point("c") || p.pointId === point("o2")
              ? { ...p, position: [p.position[0], 15.75 * scale] }
              : p,
          ),
        };
      }
      const witness = solveSketchDefinitionCore({
        ...input,
        definition: witnessDefinition,
      }).solvedSnapshot;
      expect(classify(witness, scale, policy, scenario)).toBe(solved);
      const dragStart = startCompiledSketchSolveSession({
        sessionId: "interactive_sketch_solve_scale_prior",
        program,
        priorSolvedSnapshot: witness,
      });
      expect(dragStart.kind).toBe("started");
      if (dragStart.kind !== "started") return;
      const start = dragStart.session.lastAcceptedSnapshot.solvedPoints.find(
        (row) => row.pointId === point("c"),
      )!.solvedPosition;
      for (let frame = 1; frame <= 2; frame += 1) {
        const previous = dragStart.session.lastAcceptedSnapshot;
        const result = updateCompiledSketchSolveSession(dragStart.session, {
          kind: "sketchPoint",
          pointId: point("c"),
          position: [
            start[0] + 0.3 * scale * frame,
            start[1] + 0.2 * scale * frame,
          ],
        });
        if (result.kind === "blocked")
          expect(result.solvedSnapshot).toBe(previous);
        const dragOutcome =
          result.kind === "blocked"
            ? invalid
            : classify(result.solvedSnapshot, scale, policy, scenario);
        expect(dragOutcome).not.toBe("nonconvergence");
        if (scale <= 10) expect(dragOutcome).toBe(solved);
        if (scenario === "mirrorL" && frame === 1)
          expect(dragOutcome).toBe(solved);
        else if (scenario !== "mirrorL" && scale === 10000)
          expect(dragOutcome).toBe(invalid);
      }
    });
  }
}
