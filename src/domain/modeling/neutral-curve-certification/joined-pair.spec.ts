import { describe, expect, test } from "vitest";
import {
  evaluateNeutralCurve,
  type NeutralCurve,
  type NeutralCurveJoinLocation,
  type NeutralCurveJoinRequest,
  type NeutralCurveJoinResult,
  type NeutralCurveOverlapWitness,
} from "@/contracts/modeling/neutral-curve-query";
import { reconstructSpline } from "@/contracts/sketch/spline-geometry";
import { ExactProofBudget } from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";
import { certifyNeutralCurveJoin } from "@/domain/modeling/neutral-curve-certification/joined-pair";
import {
  createCertifiedNeutralCurveQuery,
  createCertifiedNeutralCurveQueryWithBudgetObserverForTest,
  createCertifiedNeutralCurveQueryWithLowerBudgetForTest,
} from "@/domain/modeling/neutral-curve-certification/query";

type Point = readonly [number, number];
type Join = NeutralCurveJoinRequest["joins"][number];

const provenance = (id: string) => ({
  sourceEntityId: id,
  sourceSpanId: `${id}:span`,
});
const segment = (id: string, start: Point, end: Point): NeutralCurve => ({
  curveId: id,
  kind: "line",
  form: "endpointSegment",
  start,
  end,
  sourceDomain: [0, 1],
  provenance: provenance(id),
});
const arc = (
  id: string,
  center: Point,
  radius: number,
  interval: Point,
): NeutralCurve => ({
  curveId: id,
  kind: "circle",
  center,
  radius,
  xAxis: [1, 0],
  sourceDomain: { kind: "arc", interval },
  provenance: provenance(id),
});
const cubic = (
  id: string,
  poles: readonly [Point, Point, Point, Point],
  sourceDomain: Point = [0, 1],
): NeutralCurve => ({
  curveId: id,
  kind: "cubicBezier",
  poles,
  sourceDomain,
  provenance: provenance(id),
});
const onCircle = (center: Point, radius: number, angle: number): Point => [
  center[0] + radius * Math.cos(angle),
  center[1] + radius * Math.sin(angle),
];

// Seeds reused from T09-slice-design-evidence (query-timing / join-subdomain).
const theta = 0.7;
const center: Point = [10, 5];
const arcStart = onCircle(center, 3, theta);
const probeArc = arc("arc", center, 3, [theta, theta + 1.5]);
const tangent: Point = [-Math.sin(theta), Math.cos(theta)];
const figureEight = reconstructSpline({
  id: "fig8",
  policy: "centripetal-mean-arm-v1",
  closure: "smooth",
  points: [
    [0, 0],
    [2, 1],
    [4, 0],
    [2, -1],
    [0, 0.0001],
    [-2, 1],
    [-4, 0],
    [-2, -1],
  ].map((position, index) => ({
    occurrenceId: `o${index}`,
    id: `p${index}`,
    position: position as unknown as Point,
    tangent: { kind: "automatic" as const },
  })),
});
const corner = reconstructSpline({
  id: "tri",
  policy: "centripetal-mean-arm-v1",
  closure: "positional",
  points: [
    [0, 0],
    [3, 0.5],
    [1.5, 2.5],
    [0, 0],
  ].map((position, index) => ({
    occurrenceId: `t${index}`,
    id: index === 3 ? "q0" : `q${index}`,
    position: position as unknown as Point,
    tangent: { kind: "automatic" as const },
  })),
});
if (figureEight.validity !== "valid" || corner.validity !== "valid")
  throw new Error("spline fixtures must reconstruct");
const span = (spans: typeof figureEight.spans, index: number) =>
  cubic(`span-${index}`, spans[index]!.poles, spans[index]!.interval);

const endToStart: Join = { first: "end", second: "start" };
const startToStart: Join = { first: "start", second: "start" };
const nextUp = (value: number) => {
  const bits = new BigInt64Array(new Float64Array([value]).buffer);
  bits[0]! += 1n;
  return new Float64Array(bits.buffer)[0]!;
};
const arch: readonly [Point, Point, Point, Point] = [
  [0, 0],
  [1, 2],
  [3, 2],
  [4, 0],
];
const hostArc = arc("host", center, 3, [0.7, 2.2]);

interface ExpectedOverlap {
  readonly orientation: NeutralCurveOverlapWitness["orientation"];
  readonly firstInterval: readonly [number, number];
  readonly secondInterval: readonly [number, number];
  readonly kind: NeutralCurveOverlapWitness["proof"]["kind"];
}

interface VerifiedRow {
  readonly name: string;
  readonly first: NeutralCurve;
  readonly second: NeutralCurve;
  readonly joins: readonly Join[];
  readonly realizations: readonly ("declaredEnds" | "uniqueContactInBall")[];
  readonly classifications: readonly string[];
  /** Exact overlaps in the listed order (default none). */
  readonly overlaps?: readonly ExpectedOverlap[];
  /** Whole-request operation meter, [as listed, swapped]. */
  readonly operations: readonly [number, number];
}

const VERIFIED_ROWS: readonly VerifiedRow[] = [
  {
    name: "line/arc transverse join (probe: ordinary query exhausts)",
    first: segment("line", [0, 0], arcStart),
    second: probeArc,
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [113414, 113414],
  },
  {
    name: "line/arc tangent fillet join",
    first: segment(
      "fillet",
      [arcStart[0] - 5 * tangent[0], arcStart[1] - 5 * tangent[1]],
      arcStart,
    ),
    second: probeArc,
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [61131, 61131],
  },
  {
    name: "adjacent smooth spline spans 0/1 (probe: ~2.2 s)",
    first: span(figureEight.spans, 0),
    second: span(figureEight.spans, 1),
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [4004, 4004],
  },
  {
    name: "adjacent smooth spline spans 3/4 (probe: exhausted)",
    first: span(figureEight.spans, 3),
    second: span(figureEight.spans, 4),
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [4204, 4204],
  },
  {
    name: "adjacent positional-corner spline spans",
    first: span(corner.spans, corner.spans.length - 1),
    second: span(corner.spans, 0),
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [4062, 4062],
  },
  {
    name: "1e-9 overshoot corner",
    first: segment("a", [0, 0], [2 + 1e-9, 0]),
    second: segment("b", [2, -1e-9], [2, 1]),
    joins: [endToStart],
    realizations: ["uniqueContactInBall"],
    classifications: [],
    operations: [5220, 5582],
  },
  {
    name: "1e-9 undershoot corner",
    first: segment("a", [0, 0], [2 - 1e-9, 0]),
    second: segment("b", [2, 1e-9], [2, 1]),
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [3876, 3623],
  },
  {
    name: "D-shape: segment + arc with two joins",
    first: segment("chord", onCircle(center, 3, theta + 1.5), arcStart),
    second: probeArc,
    joins: [
      { first: "start", second: "end" },
      { first: "end", second: "start" },
    ],
    realizations: ["declaredEnds", "declaredEnds"],
    classifications: [],
    operations: [220507, 221452],
  },
  {
    name: "T-junction on a line (exact shared point)",
    first: segment("stem", [0.5, -1], [0.5, 0]),
    second: segment("bar", [0, 0], [1, 0]),
    joins: [{ first: "end", second: { interior: 0.5 } }],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [2583, 2665],
  },
  {
    name: "T-junction on a line (rounded interior point)",
    first: segment("stem", [1, -1], [1, 1 / 3]),
    second: segment("bar", [0, 0], [3, 1]),
    joins: [{ first: "end", second: { interior: 1 / 3 } }],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [2239, 2584],
  },
  {
    name: "T-junction on an arc",
    first: segment("stem", center, onCircle(center, 3, theta + 0.6)),
    second: probeArc,
    joins: [{ first: "end", second: { interior: theta + 0.6 } }],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [198824, 198824],
  },
  {
    name: "T-junction on an arc with a 1e-9 overshoot",
    first: segment("stem", center, onCircle(center, 3 + 1e-9, theta + 0.6)),
    second: probeArc,
    joins: [{ first: "end", second: { interior: theta + 0.6 } }],
    realizations: ["uniqueContactInBall"],
    classifications: [],
    operations: [265826, 265286],
  },
  {
    name: "line/arc join plus a genuine crossing outside the ball",
    first: segment("chord", [1, 0], [-0.5, 1.2]),
    second: arc("upper", [0, 0], 1, [0, Math.PI]),
    joins: [{ first: "start", second: "start" }],
    realizations: ["declaredEnds"],
    classifications: ["crossing"],
    operations: [242985, 247565],
  },
  {
    name: "cubic/segment join plus a genuine crossing outside the ball",
    first: cubic("arch", arch),
    second: segment("back", [4, 0], [0, 1]),
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: ["crossing"],
    operations: [219573, 218674],
  },
  {
    name: "U6 10→11: a 10 mm line on an 11 mm side, shared corner",
    first: segment("A", [0, 0], [10, 0]),
    second: segment("B", [0, 0], [11, 0]),
    joins: [startToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    overlaps: [
      {
        orientation: "same",
        firstInterval: [0, 1],
        secondInterval: [0, 10 / 11],
        kind: "exactCollinearLineOverlap",
      },
    ],
    operations: [732, 772],
  },
  {
    name: "U6 10→9: the line protrudes past a 9 mm side, shared corner",
    first: segment("A", [0, 0], [10, 0]),
    second: segment("B", [0, 0], [9, 0]),
    joins: [startToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    overlaps: [
      {
        orientation: "same",
        firstInterval: [0, 0.9],
        secondInterval: [0, 1],
        kind: "exactCollinearLineOverlap",
      },
    ],
    operations: [773, 733],
  },
  {
    name: "reversed collinear overlap joined A.start–B.end",
    first: segment("A", [0, 0], [10, 0]),
    second: segment("B", [11, 0], [0, 0]),
    joins: [{ first: "start", second: "end" }],
    realizations: ["declaredEnds"],
    classifications: [],
    overlaps: [
      {
        orientation: "opposite",
        firstInterval: [0, 1],
        secondInterval: [1, 1 / 11],
        kind: "exactCollinearLineOverlap",
      },
    ],
    operations: [776, 818],
  },
  {
    name: "collinear reversal: an exact retrace from the join",
    first: segment("a", [0, 0], [1, 0]),
    second: segment("b", [1, 0], [0.9999, 0]),
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    overlaps: [
      {
        orientation: "opposite",
        firstInterval: [0.9999, 1],
        secondInterval: [1, 0],
        kind: "exactCollinearLineOverlap",
      },
    ],
    operations: [898, 870],
  },
  {
    name: "cubic retrace from a knot (same poles reversed on [1, 2])",
    first: cubic("A", arch),
    second: cubic(
      "B",
      [...arch].reverse() as unknown as readonly [Point, Point, Point, Point],
      [1, 2],
    ),
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    overlaps: [
      {
        orientation: "opposite",
        firstInterval: [0, 1],
        secondInterval: [2, 1],
        kind: "structuralCubicPoleIdentity",
      },
    ],
    operations: [6537, 6962],
  },
  {
    name: "stem ending 1e-13 beyond an arc (enclosed unresolved contact)",
    first: segment("stem", center, onCircle(center, 3 + 1e-13, 1.3)),
    second: hostArc,
    joins: [{ first: "end", second: { interior: 1.3 } }],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [195794, 195254],
  },
  {
    name: "D-shape with one declared join: 1e-9 overshoot at the undeclared end",
    first: segment(
      "chord",
      onCircle(center, 3 + 1e-9, 2.2),
      onCircle(center, 3, 0.7),
    ),
    second: hostArc,
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: ["crossing"],
    operations: [329335, 333465],
  },
  {
    name: "D-shape with one declared join: 1e-9 undershoot at the undeclared end",
    first: segment(
      "chord",
      onCircle(center, 3 - 1e-9, 2.2),
      onCircle(center, 3, 0.7),
    ),
    second: hostArc,
    joins: [endToStart],
    realizations: ["declaredEnds"],
    classifications: [],
    operations: [150955, 151495],
  },
];

const UNCERTAIN_ROWS: readonly {
  readonly name: string;
  readonly first: NeutralCurve;
  readonly second: NeutralCurve;
  readonly joins: readonly Join[];
  readonly modelingTolerance?: number;
  readonly code: string;
  /** Pinned whole-request meter [as listed, swapped], with count − 1 exhaustion. */
  readonly operations?: readonly [number, number];
}[] = [
  {
    name: "zero end tangent (cusp) at the join",
    first: cubic("cusp", [
      [0, 0],
      [1, 1],
      [2, 0],
      [2, 0],
    ]),
    second: segment("after", [2, 0], [3, 1]),
    joins: [endToStart],
    code: "join-zero-end-tangent",
  },
  {
    name: "tangential reversal spike at a shared knot",
    first: cubic("in", [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ]),
    second: cubic("back", [
      [3, 0],
      [2, 1],
      [1.5, 1.5],
      [1, 2],
    ]),
    joins: [endToStart],
    code: "join-near-pieces-unresolved",
  },
  {
    name: "near-tangent spike hugging the other curve",
    first: segment("ray", [0, 0], [1, 0]),
    second: arc("hug", [1, 1e6], 1e6, [-Math.PI / 2 - 1e-3, -Math.PI / 2]),
    joins: [{ first: "end", second: "end" }],
    code: "join-separation-unresolved",
    // Stopped by the subdivision visit safeguard, below the proof budget.
    operations: [1948521, 1949461],
  },
  {
    name: "same-support arcs joined end to interior (overlap not admitted)",
    first: arc("A", [0, 0], 1, [0, 1]),
    second: arc("B", [0, 0], 1, [0.5, 2]),
    joins: [{ first: "end", second: { interior: 1 } }],
    code: "coincident-circle-supports",
    operations: [33742, 33742],
  },
  {
    name: "same-support arcs continuing at an end/start join (coincident supports)",
    first: arc("A", [0, 0], 1, [0, 1]),
    second: arc("B", [0, 0], 1, [1, 2]),
    joins: [endToStart],
    code: "coincident-circle-supports",
    operations: [26411, 26393],
  },
  {
    name: "non-structural cubic overlap (subdivided poles) at a join",
    first: cubic("A", arch),
    second: cubic("half", [
      [0, 0],
      [0.5, 1],
      [1.25, 1.5],
      [2, 1.5],
    ]),
    joins: [startToStart],
    code: "join-near-pieces-unresolved",
    operations: [3545, 3545],
  },
  {
    name: "two contacts inside one join ball (crowded)",
    first: segment("chord", [1, 0], [0.99, 0.2]),
    second: arc("upper", [0, 0], 1, [0, Math.PI]),
    joins: [{ first: "start", second: "start" }],
    modelingTolerance: 0.5,
    code: "join-ball-crowded",
  },
  {
    name: "declared points farther apart than the tolerance",
    first: segment("line", [0, 0], [arcStart[0] + 2e-3, arcStart[1]]),
    second: probeArc,
    joins: [endToStart],
    code: "join-ball-exceeds-tolerance",
  },
  {
    name: "U6 10→11 end to interior 1 ulp off the overlap",
    first: segment("a", [0, 0], [10, 0]),
    second: segment("b", [0, 0], [11, 0]),
    joins: [{ first: "end", second: { interior: nextUp(10 / 11) } }],
    code: "join-overlap-unsupported",
    operations: [754, 794],
  },
  {
    name: "two joins: start/start on overlap plus end/end 1e-5 off",
    first: segment("a", [0, 0], [10, 0]),
    second: segment("b", [0, 0], [10 - 1e-5, 0]),
    joins: [
      { first: "start", second: "start" },
      { first: "end", second: "end" },
    ],
    code: "join-overlap-unsupported",
    operations: [959, 918],
  },
];

const swapLocation = (join: Join): Join => ({
  first: join.second,
  second: join.first,
});
const orders = (row: {
  readonly first: NeutralCurve;
  readonly second: NeutralCurve;
  readonly joins: readonly Join[];
  readonly modelingTolerance?: number;
}): readonly NeutralCurveJoinRequest[] => [
  {
    modelingTolerance: row.modelingTolerance ?? 1e-3,
    first: row.first,
    second: row.second,
    joins: row.joins,
  },
  {
    modelingTolerance: row.modelingTolerance ?? 1e-3,
    first: row.second,
    second: row.first,
    joins: row.joins.map(swapLocation),
  },
];

const exhausted = {
  kind: "uncertain",
  code: "exact-query-proof-budget-exhausted",
  message: "The deterministic exact-query arithmetic budget was exhausted.",
};

/** Independent float re-evaluation of the published semantics. */
function expectSemantics(
  label: string,
  request: NeutralCurveJoinRequest,
  result: Extract<NeutralCurveJoinResult, { kind: "verified" }>,
  overlaps: readonly ExpectedOverlap[],
) {
  expect(result.completenessProof, label).toEqual({
    kind: "completeOutsideDeclaredJoins",
    joinCount: request.joins.length,
    distinctRootCount: result.points.length,
  });
  expect(
    result.overlaps.map((overlap) => ({
      orientation: overlap.orientation,
      firstInterval: overlap.firstInterval,
      secondInterval: overlap.secondInterval,
      kind: overlap.proof.kind,
      provenance: [
        overlap.proof.firstProvenance,
        overlap.proof.secondProvenance,
      ],
    })),
    `${label}: exact overlaps pass through unchanged`,
  ).toEqual(
    overlaps.map((overlap) => ({
      ...overlap,
      provenance: [request.first.provenance, request.second.provenance],
    })),
  );
  for (const join of result.joins) {
    if (overlaps.length === 0) continue;
    expect(join, `${label}: a join on an overlap is its declared ends`).toEqual(
      {
        firstParameter: join.firstParameter,
        secondParameter: join.secondParameter,
        firstParameterBounds: [join.firstParameter, join.firstParameter],
        secondParameterBounds: [join.secondParameter, join.secondParameter],
        position: join.position,
        ballRadius: request.modelingTolerance / 2,
        realization: "declaredEnds",
      },
    );
  }
  for (const join of result.joins) {
    expect(join.ballRadius, label).toBeGreaterThan(0);
    expect(join.ballRadius, label).toBeLessThanOrEqual(
      request.modelingTolerance,
    );
    expect(join.firstParameterBounds[0], label).toBeLessThanOrEqual(
      join.firstParameter,
    );
    expect(join.firstParameterBounds[1], label).toBeGreaterThanOrEqual(
      join.firstParameter,
    );
    for (const [curve, parameter] of [
      [request.first, join.firstParameter],
      [request.second, join.secondParameter],
    ] as const) {
      const position = evaluateNeutralCurve(curve, parameter);
      expect(
        Math.hypot(
          position[0] - join.position[0],
          position[1] - join.position[1],
        ),
        label,
      ).toBeLessThanOrEqual(join.ballRadius);
    }
    for (const found of result.points) {
      expect(
        Math.hypot(
          found.position[0] - join.position[0],
          found.position[1] - join.position[1],
        ),
        `${label}: reported contacts lie outside every join ball`,
      ).toBeGreaterThan(join.ballRadius);
    }
  }
}

/** The expected overlaps of the swapped request, from the listed ones. */
const swapExpectedOverlaps = (
  overlaps: readonly ExpectedOverlap[],
): readonly ExpectedOverlap[] =>
  overlaps.map((overlap) =>
    overlap.orientation === "same"
      ? {
          ...overlap,
          firstInterval: overlap.secondInterval,
          secondInterval: overlap.firstInterval,
        }
      : {
          ...overlap,
          firstInterval: [overlap.secondInterval[1], overlap.secondInterval[0]],
          secondInterval: [overlap.firstInterval[1], overlap.firstInterval[0]],
        },
  );

/** Swapping first/second swaps every witness parameter and bound. */
function swapped(
  result: Extract<NeutralCurveJoinResult, { kind: "verified" }>,
) {
  return {
    joins: result.joins.map((join) => ({
      ...join,
      firstParameter: join.secondParameter,
      secondParameter: join.firstParameter,
      firstParameterBounds: join.secondParameterBounds,
      secondParameterBounds: join.firstParameterBounds,
    })),
    points: result.points
      .map((found) => ({
        classification: found.classification,
        position: found.position,
        firstParameter: found.secondParameter,
        secondParameter: found.firstParameter,
        firstParameterBounds: found.proof.secondParameterBounds,
        secondParameterBounds: found.proof.firstParameterBounds,
      }))
      .sort((a, b) => a.firstParameter - b.firstParameter),
    overlaps: result.overlaps.map((overlap) =>
      overlap.orientation === "same"
        ? {
            orientation: overlap.orientation,
            firstInterval: overlap.secondInterval,
            secondInterval: overlap.firstInterval,
          }
        : {
            orientation: overlap.orientation,
            firstInterval: [...overlap.secondInterval].reverse(),
            secondInterval: [...overlap.firstInterval].reverse(),
          },
    ),
  };
}
const projected = (
  result: Extract<NeutralCurveJoinResult, { kind: "verified" }>,
) => ({
  joins: result.joins,
  points: result.points.map((found) => ({
    classification: found.classification,
    position: found.position,
    firstParameter: found.firstParameter,
    secondParameter: found.secondParameter,
    firstParameterBounds: found.proof.firstParameterBounds,
    secondParameterBounds: found.proof.secondParameterBounds,
  })),
  overlaps: result.overlaps.map((overlap) => ({
    orientation: overlap.orientation,
    firstInterval: overlap.firstInterval,
    secondInterval: overlap.secondInterval,
  })),
});

describe("declared-join certificate at the kernel-free dispatcher seam", () => {
  for (const row of VERIFIED_ROWS) {
    test(`verifies ${row.name} in both orders with pinned meters`, () => {
      const results: Extract<NeutralCurveJoinResult, { kind: "verified" }>[] =
        [];
      for (const [order, request] of orders(row).entries()) {
        const label = `${row.name} (${order === 0 ? "as listed" : "swapped"})`;
        const snapshots: { operations: number }[] = [];
        const result =
          createCertifiedNeutralCurveQueryWithBudgetObserverForTest(
            (snapshot) => snapshots.push(snapshot),
          ).queryJoin(request);
        expect(result.kind, label).toBe("verified");
        if (result.kind !== "verified") return;
        expect(
          result.joins.map((join) => join.realization),
          label,
        ).toEqual(row.realizations);
        expect(
          result.points.map((found) => found.classification),
          label,
        ).toEqual(row.classifications);
        expectSemantics(
          label,
          request,
          result,
          order === 0
            ? (row.overlaps ?? [])
            : swapExpectedOverlaps(row.overlaps ?? []),
        );
        results.push(result);
        expect(snapshots, label).toHaveLength(1);
        const operations = snapshots[0]!.operations;
        expect(operations, `${label} meter`).toBe(row.operations[order]);
        expect(
          createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
            operations,
          }).queryJoin(request),
          `${label} at its meter`,
        ).toEqual(result);
        expect(
          createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
            operations: operations - 1,
          }).queryJoin(request),
          `${label} meter - 1`,
        ).toEqual(exhausted);
      }
      expect(projected(results[1]!), `${row.name} swap`).toEqual(
        swapped(results[0]!),
      );
    });
  }

  for (const row of UNCERTAIN_ROWS) {
    test(`fails closed on ${row.name} in both orders`, () => {
      for (const [order, request] of orders(row).entries()) {
        const label = `${row.name} (${order === 0 ? "as listed" : "swapped"})`;
        const snapshots: { operations: number }[] = [];
        const result =
          createCertifiedNeutralCurveQueryWithBudgetObserverForTest(
            (snapshot) => snapshots.push(snapshot),
          ).queryJoin(request);
        expect(result, label).toMatchObject({
          kind: "uncertain",
          code: row.code,
        });
        if (!row.operations) continue;
        expect(snapshots[0]!.operations, `${label} meter`).toBe(
          row.operations[order],
        );
        expect(
          createCertifiedNeutralCurveQueryWithLowerBudgetForTest({
            operations: row.operations[order]! - 1,
          }).queryJoin(request),
          `${label} meter - 1`,
        ).toEqual(exhausted);
      }
    });
  }

  test("a realized overshoot contact is the exact line/line crossing inside the ball", () => {
    const [row] = VERIFIED_ROWS.filter((candidate) =>
      candidate.name.startsWith("1e-9 overshoot"),
    );
    const result = createCertifiedNeutralCurveQuery().queryJoin(
      orders(row!)[0]!,
    );
    expect(result).toMatchObject({
      kind: "verified",
      joins: [
        {
          realization: "uniqueContactInBall",
          firstParameter: 0.9999999995,
          secondParameter: 9.999999990000001e-10,
        },
      ],
      points: [],
    });
  });

  test("declared ends enclose an unresolved contact together with the declared locations", () => {
    const [row] = VERIFIED_ROWS.filter((candidate) =>
      candidate.name.startsWith("stem ending 1e-13"),
    );
    const result = createCertifiedNeutralCurveQuery().queryJoin(
      orders(row!)[0]!,
    );
    expect(result).toMatchObject({
      kind: "verified",
      joins: [
        {
          realization: "declaredEnds",
          firstParameter: 1,
          secondParameter: 1.3,
          firstParameterBounds: [0.999999999990066, 1],
          secondParameterBounds: [1.299999999990066, 1.300000000009934],
        },
      ],
      points: [],
    });
    if (result.kind !== "verified") return;
    const [join] = result.joins;
    expect(
      join!.firstParameterBounds[0],
      "the first bounds are non-degenerate",
    ).toBeLessThan(join!.firstParameterBounds[1]);
    expect(
      join!.secondParameterBounds[0],
      "the second bounds are non-degenerate",
    ).toBeLessThan(join!.secondParameterBounds[1]);
  });

  test("an undeclared end is never healed: overshoot is one crossing, undershoot stays open", () => {
    const pick = (prefix: string) =>
      VERIFIED_ROWS.filter((candidate) => candidate.name.startsWith(prefix));
    for (const request of orders(
      pick("D-shape with one declared join: 1e-9 overshoot")[0]!,
    )) {
      const result = createCertifiedNeutralCurveQuery().queryJoin(request);
      expect(result).toMatchObject({
        kind: "verified",
        joins: [{ realization: "declaredEnds" }],
        points: [{ classification: "crossing" }],
        completenessProof: { distinctRootCount: 1 },
      });
      if (result.kind !== "verified") continue;
      expect(result.points).toHaveLength(1);
      const chordParameter =
        request.first.kind === "line"
          ? result.points[0]!.firstParameter
          : result.points[0]!.secondParameter;
      expect(
        chordParameter,
        "the crossing sits at the undeclared chord start",
      ).toBeLessThan(1e-6);
    }
    for (const request of orders(
      pick("D-shape with one declared join: 1e-9 undershoot")[0]!,
    )) {
      expect(
        createCertifiedNeutralCurveQuery().queryJoin(request),
      ).toMatchObject({
        kind: "verified",
        joins: [{ realization: "declaredEnds" }],
        points: [],
        completenessProof: { distinctRootCount: 0 },
      });
    }
  });

  test("declared ends with an exact shared point report singleton bounds", () => {
    const result = createCertifiedNeutralCurveQuery().queryJoin(
      orders(VERIFIED_ROWS[2]!)[0]!,
    );
    const knot = figureEight.spans[0]!.interval[1];
    expect(result).toMatchObject({
      kind: "verified",
      joins: [
        {
          realization: "declaredEnds",
          firstParameterBounds: [knot, knot],
          secondParameterBounds: [knot, knot],
          position: figureEight.spans[1]!.poles[0],
          ballRadius: 5e-4,
        },
      ],
    });
  });

  test("invalid requests and full turns fail before any certificate work", () => {
    const query = createCertifiedNeutralCurveQuery();
    const line = segment("line", [0, 0], [1, 0]);
    const other = segment("other", [1, 0], [1, 1]);
    const invalid = {
      kind: "uncertain",
      code: "invalid-neutral-curve-join-query",
    };
    for (const joins of [
      [],
      [endToStart, endToStart, endToStart],
      [{ first: { interior: 0 }, second: "start" as NeutralCurveJoinLocation }],
      [
        {
          first: { interior: Number.NaN },
          second: "start" as NeutralCurveJoinLocation,
        },
      ],
    ] as const) {
      expect(
        query.queryJoin({
          modelingTolerance: 1e-3,
          first: line,
          second: other,
          joins,
        }),
      ).toMatchObject(invalid);
    }
    expect(
      query.queryJoin({
        modelingTolerance: 0,
        first: line,
        second: other,
        joins: [endToStart],
      }),
    ).toMatchObject(invalid);
    expect(
      query.queryJoin({
        modelingTolerance: 1e-3,
        first: { ...line, queryDomain: [0, 0.5] },
        second: other,
        joins: [endToStart],
      }),
    ).toMatchObject(invalid);
    const fullTurn: NeutralCurve = {
      ...probeArc,
      kind: "circle",
      center,
      radius: 3,
      xAxis: [1, 0],
      sourceDomain: { kind: "fullTurn", seam: 0 },
    };
    expect(
      query.queryJoin({
        modelingTolerance: 1e-3,
        first: line,
        second: fullTurn,
        joins: [{ first: "end", second: "start" }],
      }),
    ).toMatchObject(invalid);
    expect(
      query.queryJoin({
        modelingTolerance: 1e-3,
        first: segment("stem", [10, 0], onCircle(center, 3, 0.5)),
        second: fullTurn,
        joins: [{ first: "end", second: { interior: 0.5 } }],
      }),
    ).toMatchObject({
      kind: "unsupported",
      code: "unsupported-neutral-curve-join-full-turn",
    });
  });

  test("ordinary-owner failures pass through and non-budget errors propagate", () => {
    const request = orders(VERIFIED_ROWS[12]!)[0]!;
    expect(
      certifyNeutralCurveJoin(request, new ExactProofBudget(), () => ({
        kind: "uncertain",
        code: "inner-owner-uncertain",
        message: "inner",
      })),
    ).toEqual({
      kind: "uncertain",
      code: "inner-owner-uncertain",
      message: "inner",
    });
    expect(() =>
      certifyNeutralCurveJoin(request, new ExactProofBudget(), () => {
        throw new Error("inner owner defect");
      }),
    ).toThrow("inner owner defect");
  });
});
