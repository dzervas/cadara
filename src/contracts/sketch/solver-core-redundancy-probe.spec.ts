// T13e (D11, review R-2), logic lane, solver-core seam: the exported
// determined-quantity probe. Each row is checked in both directions (a
// determined quantity and an independent one in the same multi-entity
// sketch), so a no-op probe fails. The rows pin the δ rule (chain-scaled,
// from the document tolerances), two-sidedness (a quantity at the top of its
// range is still independent), the domain fallback (m − δ ≤ 0 tries m + δ and
// m + 2δ) and signed point-pair measurement.
import { expect, test } from "vitest";

import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";
import type {
  ConstraintDefinition,
  DimensionDefinition,
  SketchDefinition,
} from "@/contracts/sketch/schema";
import {
  probeSketchDimensionRedundancy,
  solveSketchDefinitionCore,
  type SketchSolveStrategy,
} from "@/contracts/sketch/solver-core";
import { makeSketchFixture } from "@/contracts/sketch/region-extraction.fixtures";

/** The kernel seed's document tolerances: τ = 1e-3 mm, τ_ang = 1e-4 rad. */
const TOLERANCES = {
  coincidence: 1e-3,
  angleRadians: 1e-4,
  minimumSegmentLength: 1e-3,
};
const TAU = TOLERANCES.coincidence;

const point = (name: string) => `sketch_point_${name}` as const;
const entity = (name: string) => `sketch_entity_${name}` as const;

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

const constraintId = (name: string) =>
  `constraint_t13e_${name}` as ConstraintId;
const dimensionId = (name: string) => `dimension_t13e_${name}` as DimensionId;
const lineLength = (name: string, line: string, value = 1) =>
  ({
    dimensionId: dimensionId(name),
    kind: "lineLength",
    label: name,
    entityId: entity(line),
    value,
  }) as const;
const axisConstraint = (kind: "horizontal" | "vertical", line: string) =>
  ({
    constraintId: constraintId(`${kind}_${line}`),
    kind,
    label: `${kind} ${line}`,
    entityId: entity(line),
  }) as const;
const fix = (name: string, x: number, y: number) =>
  ({
    constraintId: constraintId(`fix_${name}`),
    kind: "fixPoint",
    label: `fix ${name}`,
    pointId: point(name),
    position: [x, y],
  }) as const;

function probe(definition: SketchDefinition, candidate: DimensionDefinition) {
  return probeSketchDimensionRedundancy({
    definition,
    candidate,
    tolerances: TOLERANCES,
    modelingTolerance: TAU,
  });
}

function isAccepted(definition: SketchDefinition) {
  const solved = solveSketchDefinitionCore({
    definition,
    tolerances: TOLERANCES,
    modelingTolerance: TAU,
    partialSolvePolicy: "bestEffort",
  }).solvedSnapshot;
  return (
    solved.constraintStatuses.every(
      (status) => status.status !== "unsatisfied",
    ) &&
    solved.dimensionStatuses.every((status) => status.status !== "unsatisfied")
  );
}

/**
 * A rectangle a(0,0) b(w,0) c(w,h) d(0,h) with horizontal/vertical sides,
 * plus a free circle and a free line elsewhere (multi-entity).
 */
function rectangleSketch(width: number, height: number) {
  const sketch = makeSketchFixture();
  sketch.point("a", 0, 0);
  sketch.point("b", width, 0);
  sketch.point("c", width, height);
  sketch.point("d", 0, height);
  sketch.point("e", 12, 1);
  sketch.point("p", 20, 0);
  sketch.point("q", 23, 4);
  sketch.line("bottom", "a", "b");
  sketch.line("right", "b", "c");
  sketch.line("top", "c", "d");
  sketch.line("left", "d", "a");
  sketch.circle("circle", "e", 2.5);
  sketch.line("free", "p", "q");
  return withRequirements(sketch.definition(), [
    axisConstraint("horizontal", "bottom"),
    axisConstraint("horizontal", "top"),
    axisConstraint("vertical", "right"),
    axisConstraint("vertical", "left"),
  ]);
}

test("T13e D11: a rectangle's opposite width is determined by its width; a free side, a free circle and a free line are independent", () => {
  const free = rectangleSketch(4, 3);
  expect(probe(free, lineLength("top", "top", 4)).kind, "no width").toBe(
    "independent",
  );
  const sized = withRequirements(free, [], [lineLength("width", "bottom", 4)]);
  const top = probe(sized, lineLength("top", "top", 4));
  // 4 h/v rows + the width share the candidate's component: δ = 2·(1+5)·τ.
  expect(top).toEqual({
    kind: "determined",
    measuredValue: 4,
    delta: 2 * 6 * TAU,
    trialValues: [4 + 12 * TAU, 4 - 12 * TAU],
    trialStrategy: "bfgsWithoutFallback",
  });
  expect(probe(sized, lineLength("right", "right", 3)).kind).toBe(
    "independent",
  );
  expect(
    probe(sized, {
      dimensionId: dimensionId("diameter"),
      kind: "diameter",
      label: "diameter",
      entityId: entity("circle"),
      value: 5,
    }).kind,
  ).toBe("independent");
  expect(probe(sized, lineLength("free", "free", 5)).kind).toBe("independent");
});

test("T13e D11: sub-millimetre sizes — a 0.3 mm rectangle's opposite width is determined, its free side independent", () => {
  const sized = withRequirements(
    rectangleSketch(0.3, 0.2),
    [],
    [lineLength("width", "bottom", 0.3)],
  );
  const top = probe(sized, lineLength("top", "top", 0.3));
  expect(top.kind).toBe("determined");
  expect("measuredValue" in top && top.measuredValue).toBeCloseTo(0.3, 12);
  expect(probe(sized, lineLength("right", "right", 0.2)).kind).toBe(
    "independent",
  );
});

test("T13e D11 domain: when m − δ ≤ 0 the probe tries m + δ and m + 2δ (a 1.5 µm line: free → independent, dimensioned → determined)", () => {
  const sketch = makeSketchFixture();
  sketch.point("a", 0, 0);
  sketch.point("b", 0.0015, 0);
  sketch.point("e", 5, 5);
  sketch.line("tiny", "a", "b");
  sketch.circle("circle", "e", 1);
  const free = sketch.definition();
  const independent = probe(free, lineLength("tiny", "tiny", 0.0015));
  expect(independent).toMatchObject({ kind: "independent", delta: 2 * TAU });
  expect("trialValues" in independent && independent.trialValues).toEqual([
    0.0015 + 2 * TAU,
  ]);
  const dimensioned = probe(
    withRequirements(free, [], [lineLength("size", "tiny", 0.0015)]),
    lineLength("tiny", "tiny", 0.0015),
  );
  expect(dimensioned.kind).toBe("determined");
  const delta = "delta" in dimensioned ? dimensioned.delta : NaN;
  expect(delta, "δ = 2·(1+1)·τ exceeds m").toBeCloseTo(4 * TAU, 15);
  expect("trialValues" in dimensioned && dimensioned.trialValues).toEqual([
    0.0015 + delta,
    0.0015 + 2 * delta,
  ]);
});

/** A closed 32-gon (circumradius 5) whose sides are chained equal: s1 = s2, s2 = s3, … */
function chainedPolygonSketch() {
  const sketch = makeSketchFixture();
  const n = 32;
  for (let k = 0; k < n; k += 1) {
    const angle = (2 * Math.PI * k) / n + 0.1;
    sketch.point(`v${k}`, 5 * Math.cos(angle), 5 * Math.sin(angle));
  }
  for (let k = 0; k < n; k += 1)
    sketch.line(`s${k + 1}`, `v${k}`, `v${(k + 1) % n}`);
  sketch.point("e", 12, 0);
  sketch.circle("circle", "e", 1);
  const equalities = Array.from(
    { length: n - 1 },
    (_, k): ConstraintDefinition => ({
      constraintId: constraintId(`equal_${k + 1}`),
      kind: "equalLength",
      label: `equal s${k + 1} s${k + 2}`,
      entityIds: [entity(`s${k + 1}`), entity(`s${k + 2}`)],
    }),
  );
  return withRequirements(sketch.definition(), equalities);
}

test("T13e D11 long chain (R-2): in a 32-gon with chained equal sides and side 1 dimensioned, sides 17 and 32 read determined; with no size they are independent", () => {
  const free = chainedPolygonSketch();
  const side = 2 * 5 * Math.sin(Math.PI / 32);
  expect(probe(free, lineLength("s32", "s32", side)).kind).toBe("independent");
  const sized = withRequirements(free, [], [lineLength("size", "s1", side)]);
  // Premise: the chain absorbs a small perturbation (side 17 depends on 16
  // equalities and the size), so a fixed small δ (4τ) would miss it.
  expect(
    isAccepted(
      withRequirements(sized, [], [lineLength("s17", "s17", side + 4 * TAU)]),
    ),
    "premise: a 4τ conflict spread over the chain is accepted",
  ).toBe(true);
  for (const name of ["s17", "s32"]) {
    const verdict = probe(sized, lineLength(name, name, side));
    expect(verdict.kind, name).toBe("determined");
    // 31 equalities + the size: δ = 2·(1+32)·τ.
    expect("delta" in verdict && verdict.delta, name).toBeCloseTo(66 * TAU, 12);
  }
}, 60_000);

test("T13e D11 two-sided: a distance just below the top of its range (a point on a fixed circle, nearly farthest from a fixed point) is independent; m + δ alone would read determined", () => {
  // Q sits 0.05 rad off the farthest point, so |PQ| is 0.0018 below its
  // maximum 7: m + δ (δ = 0.01) is out of reach, m − δ is not.
  const sketch = makeSketchFixture();
  const qx = -2 * Math.cos(0.05);
  const qy = 2 * Math.sin(0.05);
  const reach = Math.hypot(5 - qx, qy);
  sketch.point("o", 0, 0);
  sketch.point("q", qx, qy);
  sketch.point("p", 5, 0);
  sketch.point("r", 5, 3);
  sketch.circle("ring", "o", 2);
  sketch.line("reach", "p", "q");
  sketch.line("other", "p", "r");
  sketch.pointOnCurve("q", "ring");
  const definition = withRequirements(
    sketch.definition(),
    [fix("o", 0, 0), fix("p", 5, 0)],
    [
      {
        dimensionId: dimensionId("ring_radius"),
        kind: "circleRadius",
        label: "ring radius",
        entityId: entity("ring"),
        value: 2,
      },
    ],
  );
  expect(7 - reach, "premise: just below the maximum").toBeCloseTo(0.0018, 4);
  const verdict = probe(definition, lineLength("reach", "reach", reach));
  expect(verdict.kind).toBe("independent");
  const delta = "delta" in verdict ? verdict.delta : NaN;
  const measured = "measuredValue" in verdict ? verdict.measuredValue : NaN;
  expect(measured).toBeCloseTo(reach, 12);
  expect(delta, "premise: δ is larger than the headroom").toBeGreaterThan(
    7 - reach,
  );
  expect(
    "trialValues" in verdict && verdict.trialValues,
    "m + δ (beyond the maximum) is rejected, m − δ is accepted",
  ).toEqual([measured + delta, measured - delta]);
  // The pinned quantity next to it: the fixed radius as a diameter.
  expect(
    probe(definition, {
      dimensionId: dimensionId("ring_diameter"),
      kind: "diameter",
      label: "ring diameter",
      entityId: entity("ring"),
      value: 4,
    }).kind,
  ).toBe("determined");
});

test("T13e D11 angle: a sized rectangle's corner angle is determined; the angle between two free lines is independent (δ in radians)", () => {
  const sized = withRequirements(
    rectangleSketch(4, 3),
    [],
    [lineLength("width", "bottom", 4), lineLength("height", "right", 3)],
  );
  const angle = (first: string, second: string) =>
    ({
      dimensionId: dimensionId(`angle_${first}_${second}`),
      kind: "lineAngle",
      label: "angle",
      lines: [
        { kind: "localEntity", entityId: entity(first) },
        { kind: "localEntity", entityId: entity(second) },
      ],
      valueRadians: 1,
    }) as const;
  const corner = probe(sized, angle("bottom", "right"));
  expect(corner.kind).toBe("determined");
  expect("measuredValue" in corner && corner.measuredValue).toBeCloseTo(
    Math.PI / 2,
    12,
  );
  expect("delta" in corner && corner.delta).toBeLessThan(0.01);
  expect(probe(sized, angle("bottom", "free")).kind).toBe("independent");
});

test("T13e D11 signed point pairs: a horizontal distance picked right-to-left measures −4 and is determined by the width", () => {
  const sized = withRequirements(
    rectangleSketch(4, 3),
    [],
    [lineLength("width", "bottom", 4)],
  );
  const verdict = probe(sized, {
    dimensionId: dimensionId("dx"),
    kind: "horizontalDistance",
    label: "dx",
    pointIds: [point("c"), point("d")],
    value: 4,
  });
  expect(verdict).toMatchObject({ kind: "determined", measuredValue: -4 });
  expect(
    probe(sized, {
      dimensionId: dimensionId("dy"),
      kind: "verticalDistance",
      label: "dy",
      pointIds: [point("a"), point("d")],
      value: 3,
    }).kind,
  ).toBe("independent");
});

test("T13e D11: a quantity without a measured value (line distance between non-parallel lines) is unmeasurable", () => {
  expect(
    probe(rectangleSketch(4, 3), {
      dimensionId: dimensionId("line_distance"),
      kind: "lineDistance",
      label: "line distance",
      lines: [
        { kind: "localEntity", entityId: entity("bottom") },
        { kind: "localEntity", entityId: entity("free") },
      ],
      value: 1,
    }),
  ).toEqual({ kind: "unmeasurable" });
});

test("T13e review B-1: the trials run BFGS without the Gauss–Newton fallback, which visibly changes an inconsistent solve", () => {
  const sized = withRequirements(
    rectangleSketch(4, 3),
    [],
    [lineLength("width", "bottom", 4)],
  );
  const verdict = probe(sized, lineLength("top", "top", 4));
  expect(verdict).toMatchObject({
    kind: "determined",
    trialStrategy: "bfgsWithoutFallback",
  });
  // The strategy is observable: on the rejected trial (top at m + δ) the
  // fallback moves the inconsistent solve, BFGS alone does not.
  const trial = withRequirements(sized, [], [lineLength("top", "top", 4.012)]);
  const solvedTop = (strategy: SketchSolveStrategy) =>
    solveSketchDefinitionCore({
      definition: trial,
      tolerances: TOLERANCES,
      modelingTolerance: TAU,
      partialSolvePolicy: "bestEffort",
      strategy,
    }).solvedSnapshot.dimensionStatuses.find(
      (status) => status.dimensionId === dimensionId("top"),
    )!;
  const withoutFallback = solvedTop("bfgsWithoutFallback");
  const withFallback = solvedTop("bfgs");
  expect(withoutFallback.status, "the trial is rejected either way").toBe(
    "unsatisfied",
  );
  expect(withFallback.status).toBe("unsatisfied");
  expect(
    Math.abs(withoutFallback.solvedValue! - withFallback.solvedValue!),
    "the fallback changes the inconsistent result",
  ).toBeGreaterThan(1e-9);
});

test("T13e review R-2 (documented miss): a thin rectangle's width determined by its height and diagonal (gains ≈ 10 > A) reads independent", () => {
  // Width 1, height 9.95: w = √(d² − h²), so ∂w/∂d ≈ d/w ≈ 10. The first-order
  // bound is ≈ 0.032 (review); the heuristic δ = 2·(1+6)·τ = 0.014 is below
  // it, so the conflict hides in the tolerances. Benign: a consistent
  // redundant driving width. Premise: at twice the bound both sides reject.
  const sketch = rectangleSketch(1, 9.95);
  const sized = withRequirements(
    sketch,
    [],
    [
      lineLength("height", "right", 9.95),
      {
        dimensionId: dimensionId("diagonal"),
        kind: "distance",
        label: "diagonal",
        axis: "aligned",
        pointIds: [point("a"), point("c")],
        value: Math.hypot(1, 9.95),
      },
    ],
  );
  for (const width of [1.064, 0.936])
    expect(
      isAccepted(
        withRequirements(sized, [], [lineLength("width", "bottom", width)]),
      ),
      `premise: the width is determined (${width} conflicts)`,
    ).toBe(false);
  const verdict = probe(sized, lineLength("width", "bottom", 1));
  expect(verdict.kind).toBe("independent");
  expect("delta" in verdict && verdict.delta).toBeLessThan(0.032);
});

test("T13e review R-2: δ is capped at max(0.1·|m|, 4τ_c); a 0.1 mm-side chained 32-gon's side 17 then reads independent (benign miss)", () => {
  const sketch = makeSketchFixture();
  const n = 32;
  const radius = 0.05 / Math.sin(Math.PI / n);
  for (let k = 0; k < n; k += 1) {
    const angle = (2 * Math.PI * k) / n + 0.1;
    sketch.point(`v${k}`, radius * Math.cos(angle), radius * Math.sin(angle));
  }
  for (let k = 0; k < n; k += 1)
    sketch.line(`s${k + 1}`, `v${k}`, `v${(k + 1) % n}`);
  const sized = withRequirements(
    sketch.definition(),
    Array.from(
      { length: n - 1 },
      (_, k): ConstraintDefinition => ({
        constraintId: constraintId(`equal_${k + 1}`),
        kind: "equalLength",
        label: `equal s${k + 1} s${k + 2}`,
        entityIds: [entity(`s${k + 1}`), entity(`s${k + 2}`)],
      }),
    ),
    [lineLength("size", "s1", 0.1)],
  );
  const verdict = probe(sized, lineLength("s17", "s17", 0.1));
  // δ_rule = 2·(1+32)·τ = 0.066 is capped to 0.1·m = 0.01, below the 17-row
  // chain's spread (≈ 18τ).
  expect("delta" in verdict && verdict.delta).toBeCloseTo(0.01, 9);
  expect(verdict.kind).toBe("independent");
  // The short chain is still seen: side 2 (two rows) reads determined.
  expect(probe(sized, lineLength("s2", "s2", 0.1)).kind).toBe("determined");
}, 60_000);
