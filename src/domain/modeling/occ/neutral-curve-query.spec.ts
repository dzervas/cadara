import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";
import {
  evaluateNeutralCurve,
  type NeutralCurve,
  type NumericNeutralLine,
} from "@/contracts/modeling/neutral-curve-query";
import { ExactQueryProofBudgetExceeded } from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import { createCertifiedNeutralCurveQueryWithBudgetObserverForTest } from "@/domain/modeling/neutral-curve-certification/query";
import {
  createOpenCascadeNeutralCurveQueryCapability,
  createOpenCascadeNeutralCurveQueryCapabilityWithBudgetObserverForTest,
  createOpenCascadeNeutralCurveQueryCapabilityWithLowerBudgetForTest,
} from "@/domain/modeling/occ/neutral-curve-query";
import type { OpenCascadeInstance } from "@/domain/modeling/occ/runtime";

const makeCircle = (
  curveId: string,
  center: readonly [number, number],
  overrides: Partial<Extract<NeutralCurve, { kind: "circle" }>> = {},
): Extract<NeutralCurve, { kind: "circle" }> => ({
  curveId,
  kind: "circle",
  center,
  radius: 1,
  xAxis: [1, 0],
  sourceDomain: { kind: "fullTurn", seam: 0 },
  provenance: { sourceEntityId: curveId, sourceSpanId: `${curveId}:full` },
  ...overrides,
});

const makeLine = (
  curveId: string,
  origin: readonly [number, number],
  overrides: Partial<NumericNeutralLine> = {},
): NumericNeutralLine => ({
  curveId,
  kind: "line",
  origin,
  direction: [0, 1],
  sourceDomain: [-1, 2],
  provenance: { sourceEntityId: curveId, sourceSpanId: `${curveId}:full` },
  ...overrides,
});

const makeSegment = (
  curveId: string,
  start: readonly [number, number],
  end: readonly [number, number],
): NeutralCurve => ({
  curveId,
  kind: "line",
  form: "endpointSegment",
  start,
  end,
  sourceDomain: [0, 1],
  provenance: { sourceEntityId: curveId, sourceSpanId: `${curveId}:full` },
});

const makeStraightCubic = (
  curveId: string,
  offset = 0,
): Extract<NeutralCurve, { kind: "cubicBezier" }> => ({
  curveId,
  kind: "cubicBezier",
  poles: [
    [offset, 0],
    [offset + 1 / 3, 0],
    [offset + 2 / 3, 0],
    [offset + 1, 0],
  ],
  sourceDomain: [0, 1],
  provenance: { sourceEntityId: curveId, sourceSpanId: `${curveId}:full` },
});

class Disposable {
  delete() {}
}

class Point extends Disposable {
  constructor(
    private readonly x: number,
    private readonly y: number,
  ) {
    super();
  }
  X() {
    return this.x;
  }
  Y() {
    return this.y;
  }
}

function parametricRuntime(
  input?:
    | {
        firstParameter: number;
        secondParameter: number;
        position: readonly [number, number];
      }
    | readonly {
        firstParameter: number;
        secondParameter: number;
        position: readonly [number, number];
      }[],
) {
  const points = input ? (Array.isArray(input) ? input : [input]) : [];
  class PointArray extends Disposable {
    SetValue() {}
  }
  class IntersectionPoint extends Disposable {
    constructor(private readonly index: number) {
      super();
    }
    ParamOnFirst() {
      return points[this.index]!.firstParameter;
    }
    ParamOnSecond() {
      return points[this.index]!.secondParameter;
    }
    Value() {
      return new Point(...points[this.index]!.position);
    }
  }
  class Intersection extends Disposable {
    IsDone() {
      return true;
    }
    NbPoints() {
      return points.length;
    }
    NbSegments() {
      return 0;
    }
    Point(index: number) {
      return new IntersectionPoint(index - 1);
    }
  }
  return {
    gp_Pnt2d_3: Point,
    gp_Dir2d_4: Disposable,
    gp_Ax2d_2: Disposable,
    Geom2d_Circle_2: Disposable,
    TColgp_Array1OfPnt2d_2: PointArray,
    Geom2d_BezierCurve_1: Disposable,
    Geom2d_Line_3: Disposable,
    Handle_Geom2d_Curve_2: Disposable,
    Geom2dAdaptor_Curve_2: Disposable,
    Geom2dInt_GInter_4: Intersection,
    IntRes2d_Intersection: Disposable,
    IntRes2d_IntersectionPoint: IntersectionPoint,
    IntRes2d_IntersectionSegment: Disposable,
  } as unknown as OpenCascadeInstance;
}

type NativeFixturePoint = {
  firstParameter: number;
  secondParameter: number;
  position: readonly [number, number];
};

function nativeSemanticRuntime(
  input: NativeFixturePoint | readonly NativeFixturePoint[] = [],
  overrides: Record<string, unknown> = {},
) {
  const points = Array.isArray(input) ? input : [input];
  class NativeQuery {
    static QueryJson() {
      return JSON.stringify({
        schemaVersion: "cadara-neutral-curve-query/v1",
        status: "candidate",
        backend: "IntAna2d",
        points: points.map((point) => ({
          u: point.firstParameter,
          v: point.secondParameter,
          first: point.position,
          second: point.position,
          reported: point.position,
        })),
        segments: [],
        ...overrides,
      });
    }
  }
  return {
    gp_Pnt2d_3: Point,
    gp_Dir2d_4: Disposable,
    gp_Ax2d_2: Disposable,
    Geom2d_Circle_2: Disposable,
    TColgp_Array1OfPnt2d_2: class extends Disposable {
      SetValue() {}
    },
    Geom2d_BezierCurve_1: Disposable,
    Handle_Geom2d_Curve_2: Disposable,
    CadaraNativeNeutralCurveQuery: NativeQuery,
  } as unknown as OpenCascadeInstance;
}

const analyticCircleRuntime = nativeSemanticRuntime;

const neverLoadOpenCascade = async (): Promise<OpenCascadeInstance> => {
  throw new Error("kernel-free query families must never load OCC");
};

function structuralCubicRuntime(
  input: NativeFixturePoint | readonly NativeFixturePoint[] = [],
) {
  return nativeSemanticRuntime(input, {
    backend: "structuralBezierOverlap",
  });
}

test("OCC neutral query capability is lazy, validates before loading, and names missing bindings", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return {} as OpenCascadeInstance;
  });
  expect(loads).toBe(0);

  const invalid = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeCircle("invalid", [Number.NaN, 0]),
    second: makeCircle("second", [2, 0]),
  });
  expect(invalid).toMatchObject({
    kind: "uncertain",
    code: "invalid-neutral-curve-query",
  });
  expect(loads).toBe(0);

  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeCircle("first", [1.5, 0]),
    second: makeCircle("second", [3.5, 0]),
  });
  expect(loads).toBe(1);
  expect(result).toMatchObject({
    kind: "unsupported",
    code: "occ-neutral-curve-query-bindings-unavailable",
  });
  if (result.kind === "unsupported") {
    expect(result.message).toContain("CadaraNativeNeutralCurveQuery");
    expect(result.message).toContain("Handle_Geom2d_Curve_2");
    expect(result.message).toContain("Geom2d_Circle_2");
  }
});

test("public OCC capability measures validation through exact admission on one meter", async () => {
  const snapshots: { operations: number }[] = [];
  const request = {
    modelingTolerance: 1e-6,
    first: makeCircle("first", [0, 0]),
    second: makeCircle("second", [3, 0]),
  } as const;
  const load = async () => nativeSemanticRuntime();
  const measured =
    createOpenCascadeNeutralCurveQueryCapabilityWithBudgetObserverForTest(
      load,
      (snapshot) => snapshots.push(snapshot),
    );
  await expect(measured.queryNeutralCurves(request)).resolves.toMatchObject({
    kind: "verified",
    points: [],
  });
  expect(snapshots).toHaveLength(1);
  const operations = snapshots[0]!.operations;
  expect(operations).toBe(282);
  await expect(
    createOpenCascadeNeutralCurveQueryCapabilityWithLowerBudgetForTest(load, {
      operations,
    }).queryNeutralCurves(request),
  ).resolves.toMatchObject({ kind: "verified" });
  await expect(
    createOpenCascadeNeutralCurveQueryCapabilityWithLowerBudgetForTest(load, {
      operations: operations - 1,
    }).queryNeutralCurves(request),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "exact-query-proof-budget-exhausted",
  });
  console.log(
    JSON.stringify({ publicOccCirclePairWholeRequest: snapshots[0] }),
  );
});

test("public OCC capability owns one meter before validation and exact angular admission", async () => {
  let loads = 0;
  const capability =
    createOpenCascadeNeutralCurveQueryCapabilityWithLowerBudgetForTest(
      async () => {
        loads += 1;
        return parametricRuntime();
      },
      { integerBits: 64 },
    );
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeCircle("first", [0, 0], {
        sourceDomain: { kind: "arc", interval: [0, 1] },
      }),
      second: makeCircle("second", [3, 0]),
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "exact-query-proof-budget-exhausted",
  });
  expect(loads).toBe(0);
});

test("exported capability rejects malformed and legacy circle domains before loading", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return parametricRuntime();
  });
  const valid = makeCircle("valid", [0, 0]);
  const invalid = [
    makeCircle("oversized", [0, 0], {
      sourceDomain: { kind: "arc", interval: [0, 7] },
    }),
    makeCircle("outside", [0, 0], {
      queryDomain: { kind: "arc", interval: [100, 101] },
    }),
    { ...valid, sourceDomain: [0, 2 * Math.PI] },
    { ...valid, queryDomain: [0, 1] },
  ] as unknown as NeutralCurve[];
  for (const first of invalid) {
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first,
        second: valid,
      }),
    ).resolves.toMatchObject({
      kind: "uncertain",
      code: "invalid-neutral-curve-query",
    });
  }
  expect(loads).toBe(0);
});

test("line/cubic exact emptiness cannot bypass a native query failure", async () => {
  class NotDoneIntersection extends Disposable {
    IsDone() {
      return false;
    }
    NbPoints() {
      return 0;
    }
    NbSegments() {
      return 0;
    }
    Point() {
      throw new Error("unreachable");
    }
  }
  const runtime = {
    ...parametricRuntime(),
    Geom2dInt_GInter_4: NotDoneIntersection,
  } as unknown as OpenCascadeInstance;
  const capability = createOpenCascadeNeutralCurveQueryCapability(
    async () => runtime,
  );
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("line", [0, 1], {
        direction: [1, 0],
        sourceDomain: [0, 1],
      }),
      second: makeStraightCubic("cubic"),
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-query-not-done",
  });
});

test("circle/cubic emptiness is certified and collinear non-structural cubic supports fail closed without loading OCC", async () => {
  const capability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
  const firstCubic = makeStraightCubic("first-cubic");
  const secondCubic = makeStraightCubic("second-cubic", 2);
  const circle = makeCircle("circle", [3, 0]);

  for (const [first, second] of [
    [firstCubic, secondCubic],
    [secondCubic, firstCubic],
  ] as const) {
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first,
        second,
      }),
    ).resolves.toMatchObject({
      kind: "uncertain",
      code: "cubic-pair-exact-projection-unresolved",
    });
  }
  for (const [first, second] of [
    [circle, firstCubic],
    [firstCubic, circle],
  ] as const) {
    await expect(
      capability.queryNeutralCurves({ modelingTolerance: 1e6, first, second }),
    ).resolves.toMatchObject({
      kind: "verified",
      points: [],
      completenessProof: { family: "circleCubic", distinctRootCount: 0 },
    });
  }
});

test("circle/cubic certifies exact support emptiness and an incident endpoint root without loading OCC", async () => {
  const capability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
  const cubic = makeStraightCubic("diameter");
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e6,
      first: makeCircle("separated", [3, 0]),
      second: cubic,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [],
    completenessProof: { family: "circleCubic", distinctRootCount: 0 },
  });
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-12,
      first: makeCircle("incident", [0, 0]),
      second: cubic,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "unclassified",
        firstParameter: 0,
        secondParameter: 1,
        position: [1, 0],
      },
    ],
    completenessProof: { family: "circleCubic", distinctRootCount: 1 },
  });
});

test("finite line queries prove crossings, clipped disjointness, and reversed arguments without loading OCC", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return parametricRuntime();
  });
  const base = 1_000_000_000;
  const horizontal = makeLine("horizontal", [base, base], {
    direction: [1, 0],
    sourceDomain: [0, 4],
    queryDomain: [0.5, 3.5],
  });
  const vertical = makeLine("vertical", [base + 2, base - 1], {
    sourceDomain: [0, 3],
  });

  for (const [first, second, firstParameter, secondParameter] of [
    [horizontal, vertical, 2, 1],
    [vertical, horizontal, 1, 2],
  ] as const) {
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first,
        second,
      }),
    ).resolves.toMatchObject({
      kind: "verified",
      points: [
        {
          classification: "crossing",
          firstParameter,
          secondParameter,
          position: [base + 2, base],
          proof: {
            kind: "exactFiniteLineIntersection",
            firstParameterBounds: [firstParameter, firstParameter],
            secondParameterBounds: [secondParameter, secondParameter],
          },
        },
      ],
      overlaps: [],
    });
  }

  const reversedHorizontal = makeLine("horizontal-reversed", [base + 4, base], {
    direction: [-1, 0],
    sourceDomain: [0, 4],
  });
  const reversedVertical = makeLine("vertical-reversed", [base + 2, base + 2], {
    direction: [0, -1],
    sourceDomain: [0, 3],
  });
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: reversedVertical,
      second: reversedHorizontal,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "crossing",
        firstParameter: 2,
        secondParameter: 2,
        position: [base + 2, base],
      },
    ],
  });

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: { ...horizontal, queryDomain: [0.5, 1.5] },
      second: vertical,
    }),
  ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  expect(loads).toBe(0);
});

test("finite collinear lines distinguish endpoint contact and a positive translated gap without tolerance snapping", async () => {
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    parametricRuntime(),
  );
  const base = 1_000_000_000;
  const ulp = 1.1920928955078125e-7;
  const first = makeLine("first", [base, base], {
    direction: [1, 0],
    sourceDomain: [0, 1],
  });
  const touching = makeLine("touching", [base + 1, base], {
    direction: [1, 0],
    sourceDomain: [0, 1],
  });
  const gapped = makeLine("gapped", [base + 1 + ulp, base], {
    direction: [1, 0],
    sourceDomain: [0, 1],
  });

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first,
      second: touching,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "unclassified",
        firstParameter: 1,
        secondParameter: 0,
        position: [base + 1, base],
        proof: { kind: "exactFiniteLineIntersection" },
      },
    ],
    overlaps: [],
  });
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first,
      second: gapped,
    }),
  ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e3,
      first: gapped,
      second: first,
    }),
  ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
});

test("finite collinear overlap preserves clipping, direction, argument order, and provenance", async () => {
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    parametricRuntime(),
  );
  const first = makeLine("first", [0, 0], {
    direction: [1, 0],
    sourceDomain: [0, 10],
    queryDomain: [2, 8],
  });
  const same = makeLine("same", [1, 0], {
    direction: [1, 0],
    sourceDomain: [0, 10],
    queryDomain: [3, 9],
  });
  const opposite = makeLine("opposite", [10, 0], {
    direction: [-1, 0],
    sourceDomain: [0, 10],
    queryDomain: [3, 9],
  });

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first,
      second: same,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [],
    overlaps: [
      {
        orientation: "same",
        firstInterval: [4, 8],
        secondInterval: [3, 7],
        proof: {
          kind: "exactCollinearLineOverlap",
          firstProvenance: first.provenance,
          secondProvenance: same.provenance,
        },
      },
    ],
  });

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first,
      second: opposite,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [],
    overlaps: [
      {
        orientation: "opposite",
        firstInterval: [2, 7],
        secondInterval: [8, 3],
        proof: {
          kind: "exactCollinearLineOverlap",
          firstProvenance: first.provenance,
          secondProvenance: opposite.provenance,
        },
      },
    ],
  });
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: opposite,
      second: first,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [],
    overlaps: [
      {
        orientation: "opposite",
        firstInterval: [3, 8],
        secondInterval: [7, 2],
        proof: {
          kind: "exactCollinearLineOverlap",
          firstProvenance: opposite.provenance,
          secondProvenance: first.provenance,
        },
      },
    ],
  });
});

test("an exact positive line overlap fails closed when its source interval collapses in binary64 output", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return parametricRuntime();
  });
  const lower = 2 ** -1000;
  const upper = 9.33263618503219e-302;
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeLine("wide", [0, 0], {
      direction: [1, 0],
      sourceDomain: [0, Number.MAX_VALUE],
    }),
    second: makeLine("narrow", [1, 0], {
      direction: [1 + Number.EPSILON, 0],
      sourceDomain: [lower, upper],
    }),
  });

  expect(result).toMatchObject({
    kind: "uncertain",
    code: "exact-line-overlap-numerically-unrepresentable",
  });
  expect(loads).toBe(0);
});

test("complete exact root counts certify line/circle emptiness but reject a missing line/cubic root", async () => {
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    parametricRuntime(),
  );
  const kernelFreeCapability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
  const line = makeLine("line", [0, 0]);
  const cubic = makeStraightCubic("cubic");
  const circle = makeCircle("circle", [2, 0]);

  for (const [first, second] of [
    [line, cubic],
    [cubic, line],
  ] as const) {
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first,
        second,
      }),
    ).resolves.toMatchObject({
      kind: "uncertain",
      code: "occ-neutral-curve-empty-proof-unavailable",
    });
  }
  for (const [first, second] of [
    [line, circle],
    [circle, line],
  ] as const) {
    await expect(
      kernelFreeCapability.queryNeutralCurves({
        modelingTolerance: 1e3,
        first,
        second,
      }),
    ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  }
});

test("numeric line/circle proves its complete root set kernel-free and counts endpoint roots once", async () => {
  // Move the seam off both roots so only the line endpoint is unclassified.
  const circle = makeCircle("circle", [0, 0], {
    sourceDomain: { kind: "fullTurn", seam: 1 },
  });
  const line = makeLine("line", [-2, 0], {
    direction: [1, 0],
    sourceDomain: [0, 4],
  });
  const capability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
  const secant = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: line,
    second: circle,
  });
  expect(secant).toMatchObject({
    kind: "verified",
    points: [
      { classification: "crossing", firstParameter: 1 },
      { classification: "crossing", firstParameter: 3 },
    ],
    completenessProof: { family: "lineCircle", distinctRootCount: 2 },
  });

  const endpointLine = { ...line, sourceDomain: [0, 3] as const };
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: endpointLine,
      second: circle,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      { classification: "crossing", firstParameter: 1 },
      {
        classification: "unclassified",
        firstParameter: 3,
        proof: { verification: "exactRoot" },
      },
    ],
    completenessProof: { family: "lineCircle", distinctRootCount: 2 },
  });
});

test("full-turn line/circle roots lift into nonzero and large symbolic windings in both orders", async () => {
  const line = makeLine("lift-line", [-2, 0], {
    direction: [1, 0],
    sourceDomain: [0, 4],
  });
  for (const seam of [10, 1_000_000]) {
    const circle = makeCircle(`lift-circle-${seam}`, [0, 0], {
      xAxis: [7, 0],
      sourceDomain: { kind: "fullTurn", seam },
    });
    for (const circleFirst of [false, true]) {
      const capability =
        createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
      const result = await capability.queryNeutralCurves({
        modelingTolerance: 1e6,
        first: circleFirst ? circle : line,
        second: circleFirst ? line : circle,
      });
      expect(
        result,
        `seam ${seam}, circleFirst ${circleFirst}: ${JSON.stringify(result)}`,
      ).toMatchObject({
        kind: "verified",
        points: [
          { classification: "crossing" },
          { classification: "crossing" },
        ],
      });
      if (result.kind === "verified") {
        for (const point of result.points) {
          const parameter = circleFirst
            ? point.firstParameter
            : point.secondParameter;
          const bounds = circleFirst
            ? point.proof.firstParameterBounds
            : point.proof.secondParameterBounds;
          expect(parameter).toBeGreaterThanOrEqual(seam);
          expect(parameter).toBeLessThan(seam + 6.283185307179587);
          expect(bounds[0]).toBeLessThanOrEqual(parameter);
          expect(bounds[1]).toBeGreaterThanOrEqual(parameter);
        }
      }
    }
  }
});

test("far-seam nonunit-axis line/circle roots are certified kernel-free in the selected winding", async () => {
  const seam = 2_000_000;
  const result = await createOpenCascadeNeutralCurveQueryCapability(
    neverLoadOpenCascade,
  ).queryNeutralCurves({
    modelingTolerance: 1e12,
    first: makeLine("far-seam-line", [-2, 0], {
      direction: [1, 0],
      sourceDomain: [0, 4],
    }),
    second: makeCircle("far-seam-circle", [0, 0], {
      xAxis: [13, 0],
      sourceDomain: { kind: "fullTurn", seam },
    }),
  });
  expect(result, JSON.stringify(result)).toMatchObject({
    kind: "verified",
    points: [
      { classification: "crossing", firstParameter: 1 },
      { classification: "crossing", firstParameter: 3 },
    ],
    completenessProof: { family: "lineCircle", distinctRootCount: 2 },
  });
  if (result.kind === "verified") {
    for (const point of result.points) {
      expect(point.secondParameter).toBeGreaterThanOrEqual(seam);
      expect(point.secondParameter).toBeLessThan(seam + 6.283185307179587);
    }
  }
});

test("circle/circle candidates must inject into distinct exact root side classes", async () => {
  const upper = [0.5, Math.sqrt(3) / 2] as const;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    analyticCircleRuntime([
      {
        firstParameter: Math.PI / 3,
        secondParameter: (2 * Math.PI) / 3,
        position: upper,
      },
      {
        firstParameter: Math.PI / 3,
        secondParameter: (2 * Math.PI) / 3,
        position: upper,
      },
    ]),
  );

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeCircle("first", [0, 0]),
      second: makeCircle("second", [1, 0]),
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-root-set-incomplete",
  });
});

test("full-turn circle tangency lifts both nonunit-axis parameters into shifted windings", async () => {
  for (const seam of [10, 1_000_000]) {
    const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
      analyticCircleRuntime({
        firstParameter: 0,
        secondParameter: Math.PI / 2,
        position: [1, 0],
      }),
    );
    const result = await capability.queryNeutralCurves({
      modelingTolerance: 1e6,
      first: makeCircle(`first-${seam}`, [0, 0], {
        xAxis: [3, 0],
        sourceDomain: { kind: "fullTurn", seam },
      }),
      second: makeCircle(`second-${seam}`, [2, 0], {
        xAxis: [0, 7],
        sourceDomain: { kind: "fullTurn", seam },
      }),
    });
    expect(result, `seam ${seam}: ${JSON.stringify(result)}`).toMatchObject({
      kind: "verified",
      points: [{ classification: "tangent" }],
    });
    if (result.kind === "verified") {
      const point = result.points[0]!;
      expect(point.firstParameter).toBeGreaterThanOrEqual(seam);
      expect(point.secondParameter).toBeGreaterThanOrEqual(seam);
      expect(point.proof.firstParameterBounds[0]).toBeLessThanOrEqual(
        point.firstParameter,
      );
      expect(point.proof.secondParameterBounds[1]).toBeGreaterThanOrEqual(
        point.secondParameter,
      );
    }
  }
});

test("translated unequal near-tangent circles retain conservative root-side association", async () => {
  const firstCenter = [1_000, -2_000] as const;
  const distance = 8.999999;
  const firstRadius = 5;
  const secondRadius = 4;
  const radialX =
    (distance ** 2 + firstRadius ** 2 - secondRadius ** 2) / (2 * distance);
  const radialY = Math.sqrt(firstRadius ** 2 - radialX ** 2);
  const firstUpper = Math.atan2(radialY, radialX);
  const firstLower = 2 * Math.PI - firstUpper;
  const secondX = radialX - distance;
  const secondUpper = Math.atan2(-secondX, radialY);
  const secondLower = Math.atan2(-secondX, -radialY);
  const upper = [firstCenter[0] + radialX, firstCenter[1] + radialY] as const;
  const lower = [firstCenter[0] + radialX, firstCenter[1] - radialY] as const;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    analyticCircleRuntime([
      {
        firstParameter: firstUpper,
        secondParameter: secondUpper,
        position: upper,
      },
      {
        firstParameter: firstLower,
        secondParameter: secondLower,
        position: lower,
      },
    ]),
  );
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e12,
    first: makeCircle("translated-first", firstCenter, {
      radius: firstRadius,
      xAxis: [7, 0],
      sourceDomain: { kind: "fullTurn", seam: 10 },
    }),
    second: makeCircle(
      "translated-second",
      [firstCenter[0] + distance, firstCenter[1]],
      {
        radius: secondRadius,
        xAxis: [0, 11],
        sourceDomain: { kind: "fullTurn", seam: 10 },
      },
    ),
  });
  expect(result, JSON.stringify(result)).toMatchObject({
    kind: "verified",
    points: [{ classification: "crossing" }, { classification: "crossing" }],
  });
  if (result.kind === "verified") {
    expect(result.points).toHaveLength(2);
    for (const point of result.points) {
      expect(point.firstParameter).toBeGreaterThanOrEqual(10);
      expect(point.secondParameter).toBeGreaterThanOrEqual(10);
      expect(point.proof.firstParameterBounds[0]).toBeLessThanOrEqual(
        point.firstParameter,
      );
      expect(point.proof.secondParameterBounds[1]).toBeGreaterThanOrEqual(
        point.secondParameter,
      );
    }
  }
});

test("a unique tiny circle tangent requires independent parameter-to-root association", async () => {
  const radius = 1e-20;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    analyticCircleRuntime({
      firstParameter: Math.PI / 2,
      secondParameter: Math.PI / 2,
      position: [radius, 0],
    }),
  );

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeCircle("first", [0, 0], { radius }),
      second: makeCircle("second", [2 * radius, 0], { radius }),
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-root-association-unrepresentable",
  });
});

test("near-tangent circle candidates cannot use wrong reported positions to fake root injection", async () => {
  const radius = 1e-10;
  const distance = 1.9999999999999996e-10;
  const angle = Math.acos(distance / (2 * radius));
  const height = radius * Math.sin(angle);
  const upper = [distance / 2, height] as const;
  const lower = [distance / 2, -height] as const;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    analyticCircleRuntime([
      {
        firstParameter: angle,
        secondParameter: Math.PI - angle,
        position: upper,
      },
      {
        firstParameter: angle + Number.EPSILON,
        secondParameter: Math.PI - angle + Number.EPSILON,
        position: lower,
      },
    ]),
  );

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeCircle("first", [0, 0], { radius }),
      second: makeCircle("second", [distance, 0], { radius }),
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-root-association-unrepresentable",
  });
});

test("a line tangent just outside a partial circle domain is excluded exactly without loading OCC", async () => {
  const capability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("tangent", [1, -1], {
        direction: [0, 1],
        sourceDomain: [0, 2],
      }),
      second: makeCircle("partial", [0, 0], {
        queryDomain: {
          kind: "arc",
          interval: [Number.EPSILON, 1],
        },
      }),
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [],
    overlaps: [],
    completenessProof: { family: "lineCircle", distinctRootCount: 0 },
  });
});

test("zero-candidate line/cubic queries require exact strict active-hull separation", async () => {
  const zeroCandidateCapability = createOpenCascadeNeutralCurveQueryCapability(
    async () => parametricRuntime(),
  );
  const base = 1_000_000_000;
  const gap = 1.1920928955078125e-7;
  const line = makeLine("translated-line", [base, base], {
    direction: [1, 0],
    sourceDomain: [0, 1],
  });
  const separated: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    curveId: "translated-gap",
    kind: "cubicBezier",
    poles: [
      [base, base + gap],
      [base + 0.25, base + gap],
      [base + 0.75, base + gap],
      [base + 1, base + gap],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "translated-gap", sourceSpanId: "span" },
  };
  const reversed = {
    ...separated,
    curveId: "translated-gap-reversed",
    poles: [...separated.poles].reverse() as typeof separated.poles,
  };

  for (const [first, second] of [
    [line, separated],
    [separated, line],
    [line, reversed],
    [reversed, line],
  ] as const) {
    await expect(
      zeroCandidateCapability.queryNeutralCurves({
        modelingTolerance: 1e3,
        first,
        second,
      }),
    ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  }

  const clipped: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    curveId: "clipped",
    kind: "cubicBezier",
    poles: [
      [0, 1],
      [1 / 3, 1],
      [2 / 3, -1],
      [1, -1],
    ],
    sourceDomain: [0, 1],
    queryDomain: [0, 0.25],
    provenance: { sourceEntityId: "clipped", sourceSpanId: "span" },
  };
  const clippingLine = makeLine("clipping-line", [0, 0], {
    direction: [1, 0],
    sourceDomain: [0, 1],
  });
  await expect(
    zeroCandidateCapability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: clippingLine,
      second: clipped,
    }),
  ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  await expect(
    zeroCandidateCapability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: clippingLine,
      second: { ...clipped, queryDomain: undefined },
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-empty-proof-unavailable",
  });

  const boundaryContact: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    curveId: "boundary-contact",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1 / 3, 1],
      [2 / 3, 1],
      [1, 1],
    ],
    sourceDomain: [0, 1],
    provenance: {
      sourceEntityId: "boundary-contact",
      sourceSpanId: "span",
    },
  };
  await expect(
    zeroCandidateCapability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: clippingLine,
      second: boundaryContact,
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-empty-proof-unavailable",
  });

  const boundaryCandidateCapability =
    createOpenCascadeNeutralCurveQueryCapability(async () =>
      parametricRuntime({
        firstParameter: 0,
        secondParameter: 0,
        position: [0, 0],
      }),
    );
  await expect(
    boundaryCandidateCapability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: clippingLine,
      second: boundaryContact,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "unclassified",
        firstParameter: 0,
        secondParameter: 0,
        proof: { verification: "exactRoot" },
      },
    ],
  });
});

test("native line/cubic candidates with overlapping certificates cannot stand in for two distinct roots", async () => {
  // y(t) = 9/16 - 3t(1 - t) has exactly the two roots t = 1/4 and t = 3/4.
  const line = makeLine("duplicate-line", [0, 0], {
    direction: [1, 0],
    sourceDomain: [0, 1],
  });
  const cubic: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    curveId: "two-root-cubic",
    kind: "cubicBezier",
    poles: [
      [0, 9 / 16],
      [1 / 3, -7 / 16],
      [2 / 3, -7 / 16],
      [1, 9 / 16],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "two-root-cubic", sourceSpanId: "span" },
  };
  // One candidate at the exact root and one at root + epsilon: the count
  // matches the complete root set, but both certificates enclose t = 1/4.
  const roots = [0.25, 0.25 + Number.EPSILON];
  for (const lineFirst of [true, false]) {
    const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
      parametricRuntime(
        roots.map((root) => ({
          firstParameter: root,
          secondParameter: root,
          position: [root, 0] as const,
        })),
      ),
    );
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first: lineFirst ? line : cubic,
        second: lineFirst ? cubic : line,
      }),
      `lineFirst ${lineFirst}`,
    ).resolves.toMatchObject({
      kind: "uncertain",
      code: "occ-neutral-curve-root-set-incomplete",
    });
  }
});

test("line/cubic exact-root classification follows multiplicity parity", async () => {
  const line = makeLine("line", [0, 0], {
    direction: [1, 0],
    sourceDomain: [0, 1],
  });
  const query = async (
    ordinates: readonly [number, number, number, number],
  ) => {
    const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
      parametricRuntime({
        firstParameter: 0.5,
        secondParameter: 0.5,
        position: [0.5, 0],
      }),
    );
    return capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: line,
      second: {
        curveId: "cubic",
        kind: "cubicBezier",
        poles: ordinates.map((y, index) => [
          index / 3,
          y,
        ]) as unknown as Extract<
          NeutralCurve,
          { kind: "cubicBezier" }
        >["poles"],
        sourceDomain: [0, 1],
        provenance: { sourceEntityId: "cubic", sourceSpanId: "span" },
      },
    });
  };

  await expect(query([-1 / 8, 1 / 8, -1 / 8, 1 / 8])).resolves.toMatchObject({
    kind: "verified",
    points: [{ classification: "crossing" }],
  });
  await expect(query([-0.75, 0.25, 0.25, -0.75])).resolves.toMatchObject({
    kind: "verified",
    points: [{ classification: "tangent" }],
  });
});

test("near-unit line directions retain source-parameter projection semantics", async () => {
  const direction = 1 - Number.EPSILON;
  const crossingX = 1 - Number.EPSILON / 2;
  const sourceParameter = crossingX / direction;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    parametricRuntime({
      firstParameter: crossingX,
      secondParameter: 0.5,
      position: [crossingX, 0],
    }),
  );
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeLine("near-unit", [0, 0], {
      direction: [direction, 0],
      sourceDomain: [0, 1.0001],
    }),
    second: {
      curveId: "crossing",
      kind: "cubicBezier",
      poles: [
        [crossingX, -0.5],
        [crossingX, -0.25],
        [crossingX, 0.25],
        [crossingX, 0.5],
      ],
      sourceDomain: [0, 1],
      provenance: { sourceEntityId: "crossing", sourceSpanId: "span" },
    },
  });

  expect(result).toMatchObject({
    kind: "verified",
    points: [{ firstParameter: sourceParameter, classification: "crossing" }],
  });
});

test("complete exact root sets verify line/circle crossings and line/cubic tangency", async () => {
  const circle = makeCircle("circle", [0, 0]);
  const secant = makeLine("secant", [-2, 0], {
    direction: [1, 0],
    sourceDomain: [0, 4],
  });
  const circleCapability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
  const circleResult = await circleCapability.queryNeutralCurves({
    modelingTolerance: 1e3,
    first: secant,
    second: circle,
  });
  expect(circleResult).toMatchObject({
    kind: "verified",
    points: [
      { firstParameter: 1, proof: { kind: "exactImplicitLineRootSet" } },
      { firstParameter: 3, proof: { kind: "exactImplicitLineRootSet" } },
    ],
    overlaps: [],
  });

  const tangentLine = makeLine("tangent", [-1, 0.75], {
    direction: [1, 0],
    sourceDomain: [0, 4],
  });
  const arch: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    curveId: "arch",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "arch", sourceSpanId: "span" },
  };
  const tangentCapability = createOpenCascadeNeutralCurveQueryCapability(
    async () =>
      parametricRuntime({
        firstParameter: 2.5,
        secondParameter: 0.5,
        position: [1.5, 0.75],
      }),
  );
  await expect(
    tangentCapability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: tangentLine,
      second: arch,
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "tangent",
        proof: {
          kind: "exactImplicitLineRootSet",
          verification: "exactRoot",
        },
      },
    ],
  });
});

test("arc pairs preserve phase and retain a tangent in an unwrapped bounded domain without loading OCC", async () => {
  const capability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeCircle("first", [0, 0], {
      xAxis: [0, 1],
      sourceDomain: { kind: "arc", interval: [5.5, 6.5] },
    }),
    second: makeCircle("second", [0, 2], {
      xAxis: [0, -1],
      sourceDomain: { kind: "arc", interval: [5.5, 6.5] },
    }),
  });

  expect(result).toMatchObject({
    kind: "verified",
    points: [{ classification: "tangent" }],
  });

  const clipped = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeCircle("first", [0, 0], {
      xAxis: [0, 1],
      sourceDomain: { kind: "arc", interval: [5.5, 6.5] },
      queryDomain: { kind: "arc", interval: [5.5, 6.2] },
    }),
    second: makeCircle("second", [0, 2], {
      xAxis: [0, -1],
      sourceDomain: { kind: "arc", interval: [5.5, 6.5] },
    }),
  });
  expect(clipped).toMatchObject({
    kind: "verified",
    points: [],
    completenessProof: { family: "circlePair", distinctRootCount: 0 },
  });
});

test("exact reversed cubic structure requires the native component before admitting the complete overlap", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return structuralCubicRuntime();
  });
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: {
      curveId: "first",
      kind: "cubicBezier",
      poles,
      sourceDomain: [0, 1],
      queryDomain: [0.2, 0.8],
      provenance: { sourceEntityId: "spline", sourceSpanId: "span" },
    },
    second: {
      curveId: "second",
      kind: "cubicBezier",
      poles: [...poles].reverse() as unknown as typeof poles,
      sourceDomain: [0, 1],
      queryDomain: [0.2, 0.8],
      provenance: { sourceEntityId: "copy", sourceSpanId: "reverse" },
    },
  });

  expect(loads).toBe(1);
  expect(result).toMatchObject({
    kind: "verified",
    overlaps: [
      {
        orientation: "opposite",
        firstInterval: [0.2, 0.8],
        secondInterval: [0.8, 0.2],
        proof: { kind: "structuralCubicPoleIdentity", poleOrder: "reversed" },
      },
    ],
  });
});

test("cubic self certification excludes the diagonal and returns one complete crossing", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return parametricRuntime();
  });
  const curve: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    curveId: "endpoint-loop",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1, 2],
      [-1, 2],
      [0, 0],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "figure-eight", sourceSpanId: "span" },
  };
  const result = await capability.queryNeutralCurveSelfIntersections({
    modelingTolerance: 1e6,
    curve,
  });
  expect(result).toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "crossing",
        proof: {
          kind: "exactAlgebraicCurveRootSet",
          family: "cubicSelf",
        },
      },
    ],
    completenessProof: { family: "cubicSelf", distinctRootCount: 1 },
  });
  if (result.kind === "verified") {
    expect(result.points).toHaveLength(1);
    expect(result.points[0]!.firstParameter).toBeLessThan(
      result.points[0]!.secondParameter,
    );
    expect(result.points[0]!.proof.firstParameterBounds[0]).toBeLessThanOrEqual(
      result.points[0]!.firstParameter,
    );
    expect(
      result.points[0]!.proof.secondParameterBounds[1],
    ).toBeGreaterThanOrEqual(result.points[0]!.secondParameter);
  }
  await expect(
    capability.queryNeutralCurveSelfIntersections({
      modelingTolerance: 1e6,
      curve: { ...curve, queryDomain: [0, 0.4] },
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [],
    completenessProof: { family: "cubicSelf", distinctRootCount: 0 },
  });
  expect(loads).toBe(0);
});

test("disjoint structural ranges prove empty while a line-like cubic self proves empty", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return {} as OpenCascadeInstance;
  });
  const first = {
    ...makeStraightCubic("first"),
    poles: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  } satisfies Extract<NeutralCurve, { kind: "cubicBezier" }>;
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: { ...first, queryDomain: [0.1, 0.2] },
    second: { ...first, curveId: "second", queryDomain: [0.8, 0.9] },
  });
  expect(result).toMatchObject({
    kind: "verified",
    points: [],
    overlaps: [],
    completenessProof: {
      kind: "completeStructuralCorrespondence",
      family: "structuralCubicOverlap",
      correspondence: "disjoint",
      correspondencePointCount: 0,
      offCorrespondenceDistinctRootCount: 0,
    },
  });
  expect(loads).toBe(0);

  const self = await capability.queryNeutralCurveSelfIntersections({
    modelingTolerance: 1e-6,
    curve: {
      ...first,
      poles: [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
      ],
    },
  });
  expect(self).toMatchObject({
    kind: "verified",
    points: [],
    completenessProof: { family: "cubicSelf", distinctRootCount: 0 },
  });
  expect(loads).toBe(0);
});

test("exact affine ordering cannot heal a positive structural gap into verified overlap", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return {} as OpenCascadeInstance;
  });
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: {
      curveId: "first",
      kind: "cubicBezier",
      poles,
      sourceDomain: [-126945672.37721825, 4505890001.637915],
      queryDomain: [2125499653.7343376, 2125499653.7343385],
      provenance: { sourceEntityId: "first", sourceSpanId: "span" },
    },
    second: {
      curveId: "second",
      kind: "cubicBezier",
      poles,
      sourceDomain: [-3609677398.139288, 1915706826.9335546],
      queryDomain: [-923282553.0681655, -923282553.0681646],
      provenance: { sourceEntityId: "second", sourceSpanId: "span" },
    },
  });

  expect(result).toMatchObject({
    kind: "verified",
    points: [],
    overlaps: [],
    completenessProof: {
      kind: "completeStructuralCorrespondence",
      family: "structuralCubicOverlap",
      correspondence: "disjoint",
      correspondencePointCount: 0,
      offCorrespondenceDistinctRootCount: 0,
    },
  });
  expect(loads).toBe(0);
});

test("structural cubic queries include overlap, off-diagonal self pairs, and endpoint correspondence", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return structuralCubicRuntime();
  });
  const loop: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    curveId: "loop-first",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1, 2],
      [-1, 2],
      [0, 0],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "loop", sourceSpanId: "span" },
  };

  const overlapAndSelf = await capability.queryNeutralCurves({
    modelingTolerance: 1e-8,
    first: loop,
    second: { ...loop, curveId: "loop-copy" },
  });
  expect(overlapAndSelf).toMatchObject({
    kind: "verified",
    points: [{ classification: "crossing" }, { classification: "crossing" }],
    overlaps: [{ orientation: "same" }],
    completenessProof: {
      kind: "completeStructuralCorrespondence",
      correspondence: "interval",
      correspondencePointCount: 0,
      offCorrespondenceDistinctRootCount: 2,
    },
  });

  const disjointSelf = await capability.queryNeutralCurves({
    modelingTolerance: 1e-8,
    first: { ...loop, queryDomain: [0, 0.1] },
    second: { ...loop, curveId: "loop-late", queryDomain: [0.9, 1] },
  });
  expect(disjointSelf).toMatchObject({
    kind: "verified",
    points: [{ classification: "crossing" }],
    overlaps: [],
    completenessProof: {
      kind: "completeStructuralCorrespondence",
      family: "structuralCubicOverlap",
      correspondence: "disjoint",
      correspondencePointCount: 0,
      offCorrespondenceDistinctRootCount: 1,
    },
  });

  const reversedDomain = await capability.queryNeutralCurves({
    modelingTolerance: 1e-8,
    first: { ...loop, sourceDomain: [10, 20], queryDomain: [10, 11] },
    second: {
      ...loop,
      curveId: "loop-reversed-domain",
      poles: [...loop.poles].reverse() as unknown as typeof loop.poles,
      sourceDomain: [-4, 6],
      queryDomain: [-4, -3],
    },
  });
  expect(reversedDomain).toMatchObject({
    kind: "verified",
    points: [{ classification: "crossing" }],
    overlaps: [],
    completenessProof: {
      kind: "completeStructuralCorrespondence",
      family: "structuralCubicOverlap",
      correspondence: "disjoint",
      correspondencePointCount: 0,
      offCorrespondenceDistinctRootCount: 1,
    },
  });

  const straight = {
    ...makeStraightCubic("endpoint-first"),
    poles: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  } satisfies Extract<NeutralCurve, { kind: "cubicBezier" }>;
  const endpoint = await capability.queryNeutralCurves({
    modelingTolerance: 1e-8,
    first: { ...straight, queryDomain: [0, 0.5] },
    second: {
      ...straight,
      curveId: "endpoint-second",
      queryDomain: [0.5, 1],
    },
  });
  expect(endpoint).toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "unclassified",
        firstParameter: 0.5,
        secondParameter: 0.5,
      },
    ],
    overlaps: [],
    completenessProof: {
      kind: "completeStructuralCorrespondence",
      correspondence: "endpoint",
      correspondencePointCount: 1,
      offCorrespondenceDistinctRootCount: 0,
    },
  });
  expect(loads).toBe(1);
});

test("extreme positive structural overlaps stay verified in either order and orientation", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return structuralCubicRuntime();
  });
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const makeCubic = (
    curveId: string,
    sourceDomain: readonly [number, number],
    queryDomain: readonly [number, number],
    reversed = false,
  ): Extract<NeutralCurve, { kind: "cubicBezier" }> => ({
    curveId,
    kind: "cubicBezier",
    poles: reversed ? ([...poles].reverse() as unknown as typeof poles) : poles,
    sourceDomain,
    queryDomain,
    provenance: { sourceEntityId: curveId, sourceSpanId: "span" },
  });
  const wide = makeCubic("wide", [0, Number.MAX_VALUE], [1, 2]);
  const narrow = makeCubic("narrow", [0, 1], [1e-309, 1e-308]);
  const reversed = makeCubic("reversed", [-1, 0], [-1e-308, -1e-309], true);

  for (const [first, second] of [
    [wide, narrow],
    [narrow, wide],
    [wide, reversed],
    [reversed, wide],
  ] as const) {
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first,
        second,
      }),
    ).resolves.toMatchObject({
      kind: "verified",
      points: [],
      overlaps: [{ proof: { kind: "structuralCubicPoleIdentity" } }],
    });
  }
  expect(loads).toBe(4);
});

test("positive exact overlap stays numerically uncertain when mapped endpoints collapse", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return {} as OpenCascadeInstance;
  });
  const poles = makeStraightCubic("basis").poles;
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: {
      curveId: "large-offset",
      kind: "cubicBezier",
      poles,
      sourceDomain: [1e300, 1.1e300],
      queryDomain: [1e300, 1.0000000000000002e300],
      provenance: { sourceEntityId: "large-offset", sourceSpanId: "span" },
    },
    second: {
      curveId: "subnormal",
      kind: "cubicBezier",
      poles,
      sourceDomain: [0, 1],
      queryDomain: [1e-309, 1e-308],
      provenance: { sourceEntityId: "subnormal", sourceSpanId: "span" },
    },
  });

  expect(result).toMatchObject({
    kind: "uncertain",
    code: "structural-cubic-overlap-numerically-unrepresentable",
  });
  expect(loads).toBe(0);
});

test("undefined operation throws remain primary while every owned wrapper is cleaned", async () => {
  const cleanupErrors = [
    new Error("direction cleanup"),
    new Error("point cleanup"),
  ];
  let cleanupAttempts = 0;
  class FailingPoint extends Point {
    override delete() {
      cleanupAttempts += 1;
      throw cleanupErrors[1];
    }
  }
  class FailingDirection extends Disposable {
    override delete() {
      cleanupAttempts += 1;
      throw cleanupErrors[0];
    }
  }
  class ThrowingAxis {
    constructor() {
      throw undefined;
    }
  }
  const runtime = {
    gp_Pnt2d_3: FailingPoint,
    gp_Dir2d_4: FailingDirection,
    gp_Ax2d_2: ThrowingAxis,
    Geom2d_Circle_2: Disposable,
    Handle_Geom2d_Curve_2: Disposable,
    CadaraNativeNeutralCurveQuery: class extends Disposable {
      static QueryJson() {
        return "";
      }
    },
  } as unknown as OpenCascadeInstance;
  const capability = createOpenCascadeNeutralCurveQueryCapability(
    async () => runtime,
  );

  let caught: unknown;
  try {
    await capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeCircle("first", [0, 0]),
      second: makeCircle("second", [2, 0]),
    });
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors).toEqual([
    undefined,
    cleanupErrors[0],
    cleanupErrors[1],
  ]);
  expect(cleanupAttempts).toBe(2);
});

test("curve geometry has one owner after successful and throwing handle construction", async () => {
  let rawDeletes = 0;
  class Geometry extends Disposable {
    override delete() {
      rawDeletes += 1;
    }
  }
  class OwningHandle extends Disposable {
    constructor(private readonly geometry: Geometry) {
      super();
    }
    override delete() {
      this.geometry.delete();
    }
  }
  const request = {
    modelingTolerance: 1e-6,
    first: makeLine("line", [0, 1], {
      direction: [1, 0] as const,
      sourceDomain: [0, 1] as const,
    }),
    second: makeStraightCubic("cubic"),
  };
  const successfulRuntime = {
    ...parametricRuntime(),
    Geom2d_Line_3: Geometry,
    Geom2d_BezierCurve_1: Geometry,
    Handle_Geom2d_Curve_2: OwningHandle,
  } as unknown as OpenCascadeInstance;
  await expect(
    createOpenCascadeNeutralCurveQueryCapability(
      async () => successfulRuntime,
    ).queryNeutralCurves(request),
  ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  expect(rawDeletes).toBe(2);

  class ThrowingHandle {
    constructor() {
      throw new Error("handle construction failed");
    }
  }
  const throwingRuntime = {
    ...parametricRuntime(),
    Geom2d_Line_3: Geometry,
    Handle_Geom2d_Curve_2: ThrowingHandle,
  } as unknown as OpenCascadeInstance;
  const capability = createOpenCascadeNeutralCurveQueryCapability(
    async () => throwingRuntime,
  );

  let caught: unknown;
  try {
    await capability.queryNeutralCurves(request);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors[0]).toMatchObject({
    message: "handle construction failed",
  });
  expect(rawDeletes).toBe(3);
});

test("only a sole in-owned proof budget failure converts after successful cleanup", async () => {
  const cleanupFailure = new Error("intersection cleanup failed");
  const makeRuntime = (failCleanup: boolean) => {
    class BudgetIntersection extends Disposable {
      IsDone() {
        return true;
      }
      NbSegments(): number {
        throw new ExactQueryProofBudgetExceeded();
      }
      override delete() {
        if (failCleanup) throw cleanupFailure;
      }
    }
    return {
      ...parametricRuntime(),
      Geom2dInt_GInter_4: BudgetIntersection,
    } as unknown as OpenCascadeInstance;
  };
  const request = {
    modelingTolerance: 1e-6,
    first: makeLine("line", [0, 1], {
      direction: [1, 0] as const,
      sourceDomain: [0, 1] as const,
    }),
    second: makeStraightCubic("cubic"),
  };

  await expect(
    createOpenCascadeNeutralCurveQueryCapability(async () =>
      makeRuntime(false),
    ).queryNeutralCurves(request),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "exact-query-proof-budget-exhausted",
  });

  let caught: unknown;
  try {
    await createOpenCascadeNeutralCurveQueryCapability(async () =>
      makeRuntime(true),
    ).queryNeutralCurves(request);
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(AggregateError);
  expect((caught as AggregateError).errors).toEqual([
    expect.any(ExactQueryProofBudgetExceeded),
    cleanupFailure,
  ]);
});

test("parametric proof localizes a crossing to the native representative under reparameterization", async () => {
  const firstX = 2.000000001e-6;
  const lastX = -1.999999999e-6;
  const xStep = (firstX - lastX) / 3;
  const cubic: NeutralCurve = {
    curveId: "large-source-domain-cubic",
    kind: "cubicBezier",
    poles: [
      [firstX, 0.5],
      [firstX - xStep, 0.5],
      [firstX - 2 * xStep, 0.5],
      [lastX, 0.5],
    ],
    sourceDomain: [0, 1e16],
    queryDomain: [0, 1e16],
    provenance: {
      sourceEntityId: "large-source-domain-cubic",
      sourceSpanId: "span",
    },
  };
  const line: NeutralCurve = {
    curveId: "line",
    kind: "line",
    origin: [0, 0],
    direction: [0, 1],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "line", sourceSpanId: "full" },
  };
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    parametricRuntime({
      firstParameter: 0.5,
      secondParameter: 0.5,
      position: [0, 0.5],
    }),
  );

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: cubic,
      second: line,
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-point-proof-unavailable",
  });
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: line,
      second: cubic,
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-point-proof-unavailable",
  });
});

test("parametric witnesses bind both parameters and the reported point to the local certificate", async () => {
  const cubic: NeutralCurve = {
    curveId: "horizontal-cubic",
    kind: "cubicBezier",
    poles: [
      [-1, 0.5],
      [-1 / 3, 0.5],
      [1 / 3, 0.5],
      [1, 0.5],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "cubic", sourceSpanId: "span" },
  };
  const line: NeutralCurve = {
    curveId: "huge-domain-line",
    kind: "line",
    origin: [0, 0],
    direction: [0, 1],
    sourceDomain: [0, 1e120],
    provenance: { sourceEntityId: "line", sourceSpanId: "full" },
  };
  const queryBothOrders = async (
    lineParameter: number,
    position: readonly [number, number],
  ) => {
    const cubicFirst = createOpenCascadeNeutralCurveQueryCapability(async () =>
      parametricRuntime({
        firstParameter: 0.5,
        secondParameter: lineParameter,
        position,
      }),
    );
    const lineFirst = createOpenCascadeNeutralCurveQueryCapability(async () =>
      parametricRuntime({
        firstParameter: lineParameter,
        secondParameter: 0.5,
        position,
      }),
    );
    return Promise.all([
      cubicFirst.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first: cubic,
        second: line,
      }),
      lineFirst.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first: line,
        second: cubic,
      }),
    ]);
  };

  for (const result of await queryBothOrders(1e100, [0, 0.5])) {
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "neutral-curve-witness-outside-proof-bounds",
    });
  }
  for (const result of await queryBothOrders(0.5, [0, 1e100])) {
    expect(result).toMatchObject({
      kind: "uncertain",
      code: "neutral-curve-witness-residual",
    });
  }
});

test("a large-phase partial circle domain fails closed on the exact meter without loading OCC", async () => {
  const period = Math.PI * 2;
  const sourceDomain = [1e12, 1e12 + 4] as const;
  const nativeParameter = (sourceDomain[0] + 2) % period;
  const turn = Math.round(
    ((sourceDomain[0] + sourceDomain[1]) / 2 - nativeParameter) / period,
  );
  const candidateParameter = nativeParameter + turn * period;
  const circle: Extract<NeutralCurve, { kind: "circle" }> = {
    curveId: "large-phase-circle",
    kind: "circle",
    center: [0, 0],
    radius: 1,
    xAxis: [1, 0],
    sourceDomain: { kind: "arc", interval: sourceDomain },
    provenance: { sourceEntityId: "circle", sourceSpanId: "arc" },
  };
  const candidate = evaluateNeutralCurve(circle, candidateParameter);
  const bracketRadius = Number.EPSILON * Math.abs(candidateParameter) * 1_024;
  const directionAngle = candidateParameter + bracketRadius * 0.75;
  const direction = [
    Math.cos(directionAngle),
    Math.sin(directionAngle),
  ] as const;
  const origin = [
    candidate[0] - direction[0],
    candidate[1] - direction[1],
  ] as const;
  const projection = (parameter: number) => {
    const point = evaluateNeutralCurve(circle, parameter);
    return (
      (point[0] - origin[0]) * direction[0] +
      (point[1] - origin[1]) * direction[1]
    );
  };
  const endpointMaximum = Math.max(
    projection(candidateParameter - bracketRadius),
    projection(candidateParameter + bracketRadius),
    1,
  );
  const interiorMaximum = projection(directionAngle);
  expect(interiorMaximum).toBeGreaterThan(endpointMaximum);
  const line: NeutralCurve = {
    curveId: "bounded-line",
    kind: "line",
    origin,
    direction,
    sourceDomain: [0, (endpointMaximum + interiorMaximum) / 2],
    provenance: { sourceEntityId: "line", sourceSpanId: "bounded" },
  };
  const capability =
    createOpenCascadeNeutralCurveQueryCapability(neverLoadOpenCascade);

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: circle,
      second: line,
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "exact-query-proof-budget-exhausted",
  });
});

test("native semantic dispatch maps active cubic trims, forwards actual tolerance, and leaves completeness to TypeScript", async () => {
  const calls: unknown[][] = [];
  const runtime = structuralCubicRuntime() as OpenCascadeInstance & {
    CadaraNativeNeutralCurveQuery: {
      QueryJson: (...args: unknown[]) => string;
    };
  };
  const original = runtime.CadaraNativeNeutralCurveQuery.QueryJson;
  runtime.CadaraNativeNeutralCurveQuery.QueryJson = (...args) => {
    calls.push(args);
    return original(...args);
  };
  const capability = createOpenCascadeNeutralCurveQueryCapability(
    async () => runtime,
  );
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const first = {
    ...makeStraightCubic("mapped-first"),
    poles,
    sourceDomain: [7, 13] as const,
    queryDomain: [8, 11] as const,
  };
  const second = {
    ...makeStraightCubic("mapped-second"),
    poles,
    sourceDomain: [7, 13] as const,
    queryDomain: [9, 12] as const,
  };

  const result = await capability.queryNeutralCurves({
    modelingTolerance: 2e-7,
    first,
    second,
  });
  expect(result, JSON.stringify(result)).toMatchObject({
    kind: "verified",
    overlaps: [{ firstInterval: [9, 11], secondInterval: [9, 11] }],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]!.slice(1)).toEqual([
    1 / 6,
    4 / 6,
    calls[0]![3],
    2 / 6,
    5 / 6,
    false,
    2e-7,
  ]);
});

test("native circle dispatch receives nonzero winding trims and exact predicates reject tiny gaps regardless of tolerance", async () => {
  for (const seam of [10, 1_000_000]) {
    const calls: unknown[][] = [];
    const runtime = nativeSemanticRuntime([], {
      status: "verified",
      backend: "IntAna2d",
    }) as OpenCascadeInstance & {
      CadaraNativeNeutralCurveQuery: {
        QueryJson: (...args: unknown[]) => string;
      };
    };
    const original = runtime.CadaraNativeNeutralCurveQuery.QueryJson;
    runtime.CadaraNativeNeutralCurveQuery.QueryJson = (...args) => {
      calls.push(args);
      return original(...args);
    };
    const capability = createOpenCascadeNeutralCurveQueryCapability(
      async () => runtime,
    );
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e6,
        first: makeCircle(`gap-first-${seam}`, [0, 0], {
          sourceDomain: { kind: "fullTurn", seam },
        }),
        second: makeCircle(`gap-second-${seam}`, [2.0000000000000004, 0], {
          sourceDomain: { kind: "fullTurn", seam },
        }),
      }),
    ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
    expect(calls).toHaveLength(1);
    expect(calls[0]![1]).toBe(seam);
    expect(calls[0]![2]).toBeGreaterThanOrEqual(seam + 2 * Math.PI);
    expect(calls[0]![4]).toBe(seam);
    expect(calls[0]![5]).toBeGreaterThanOrEqual(seam + 2 * Math.PI);
    expect(calls[0]![7]).toBe(1e6);
  }
});

test("native failure and malformed payloads fail closed after owned handle cleanup", async () => {
  for (const [json, expectation] of [
    [
      JSON.stringify({
        schemaVersion: "cadara-neutral-curve-query/v1",
        status: "nativeFailure",
        backend: "none",
        reason: "forced native failure",
        points: [],
        segments: [],
      }),
      "result",
    ],
    ['{"schemaVersion":"wrong"}', "throw"],
  ] as const) {
    let deletes = 0;
    class Tracked extends Disposable {
      override delete() {
        deletes += 1;
      }
    }
    class TrackedPoint extends Tracked {
      constructor(
        readonly x: number,
        readonly y: number,
      ) {
        super();
      }
      X() {
        return this.x;
      }
      Y() {
        return this.y;
      }
    }
    class NativeQuery extends Tracked {
      static QueryJson() {
        return json;
      }
    }
    const runtime = {
      gp_Pnt2d_3: TrackedPoint,
      gp_Dir2d_4: Tracked,
      gp_Ax2d_2: Tracked,
      Geom2d_Circle_2: Tracked,
      Handle_Geom2d_Curve_2: Tracked,
      CadaraNativeNeutralCurveQuery: NativeQuery,
    } as unknown as OpenCascadeInstance;
    const query = createOpenCascadeNeutralCurveQueryCapability(
      async () => runtime,
    ).queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeCircle("cleanup-first", [0, 0]),
      second: makeCircle("cleanup-second", [2, 0]),
    });
    if (expectation === "result") {
      await expect(query).resolves.toMatchObject({
        kind: "uncertain",
        code: "occ-native-neutral-curve-nativeFailure",
      });
    } else {
      await expect(query).rejects.toBeInstanceOf(AggregateError);
    }
    expect(deletes).toBeGreaterThan(0);
  }
});

let productionCustomOpenCascade: Promise<OpenCascadeInstance> | undefined;
/** The promoted `public/cadara-occ` build (or the asset-dir override), shared per spec file. */
function loadProductionCustomOpenCascade() {
  productionCustomOpenCascade ??= (async () => {
    const assetDirectory = process.env.CADARA_OCC_NEUTRAL_QUERY_ASSET_DIR;
    const moduleUrl = assetDirectory
      ? pathToFileURL(resolve(assetDirectory, "cadara-occ.js")).href
      : new URL("../../../../public/cadara-occ.js", import.meta.url).href;
    const module = (await import(moduleUrl)) as {
      default: new (input: {
        wasmBinary: Uint8Array;
      }) => Promise<OpenCascadeInstance>;
    };
    const wasmPath = assetDirectory
      ? resolve(assetDirectory, "cadara-occ.wasm")
      : fileURLToPath(
          new URL("../../../../public/cadara-occ.wasm", import.meta.url),
        );
    const wasmBinary = new Uint8Array(readFileSync(wasmPath));
    return new module.default({ wasmBinary });
  })();
  return productionCustomOpenCascade;
}

test("production custom OCC enforces structural overlap and analytic circle acceptance at the exported adapter seam", async () => {
  let loads = 0;
  const loadCustomOpenCascade = () => {
    loads += 1;
    return loadProductionCustomOpenCascade();
  };
  const capability = createOpenCascadeNeutralCurveQueryCapability(
    loadCustomOpenCascade,
  );
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("native-runtime-horizontal", [0, 0], {
        direction: [1, 0],
        sourceDomain: [0, 2],
      }),
      second: makeLine("native-runtime-vertical", [1, -1], {
        sourceDomain: [0, 2],
      }),
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "crossing",
        firstParameter: 1,
        secondParameter: 1,
        position: [1, 0],
        proof: { kind: "exactFiniteLineIntersection" },
      },
    ],
  });
  expect(loads).toBe(0);

  const nativeStructuralResult = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: {
      curveId: "partial-overlap-first",
      kind: "cubicBezier",
      poles,
      sourceDomain: [0, 1],
      provenance: { sourceEntityId: "first", sourceSpanId: "span" },
    },
    second: {
      curveId: "partial-overlap-reversed",
      kind: "cubicBezier",
      poles: [...poles].reverse() as unknown as typeof poles,
      sourceDomain: [0, 1],
      queryDomain: [0.2, 0.8],
      provenance: { sourceEntityId: "second", sourceSpanId: "span" },
    },
  });
  expect(nativeStructuralResult).toMatchObject({
    kind: "verified",
    points: [],
    overlaps: [
      {
        orientation: "opposite",
        firstInterval: [1 - 0.8, 0.8],
        secondInterval: [0.8, 0.2],
        proof: {
          kind: "structuralCubicPoleIdentity",
          poleOrder: "reversed",
          firstProvenance: {
            sourceEntityId: "first",
            sourceSpanId: "span",
          },
          secondProvenance: {
            sourceEntityId: "second",
            sourceSpanId: "span",
          },
        },
      },
    ],
  });
  expect(loads).toBe(1);

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("native-empty-line", [0, 1], {
        direction: [1, 0],
        sourceDomain: [0, 1],
      }),
      second: makeStraightCubic("native-empty-cubic"),
    }),
  ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  expect(loads).toBe(2);

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("native-diagonal-near-unit", [0, 0], {
        direction: [0.6, 0.8],
        sourceDomain: [0, 1],
      }),
      second: {
        curveId: "native-diagonal-cubic",
        kind: "cubicBezier",
        poles: [
          [0.3, 0],
          [0.3, 0.2],
          [0.3, 0.6],
          [0.3, 0.8],
        ],
        sourceDomain: [0, 1],
        provenance: {
          sourceEntityId: "native-diagonal-cubic",
          sourceSpanId: "span",
        },
      },
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "crossing",
        firstParameter: 0.5,
        secondParameter: 0.5,
        proof: { kind: "exactImplicitLineRootSet" },
      },
    ],
  });

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("kernel-free-circle-secant", [-2, 0], {
        direction: [1, 0],
        sourceDomain: [0, 4],
      }),
      second: makeCircle("kernel-free-unit-circle", [0, 0]),
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      { proof: { kind: "exactImplicitLineRootSet" } },
      { proof: { kind: "exactImplicitLineRootSet" } },
    ],
  });
  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("native-cubic-tangent", [0, 0.75], {
        direction: [1, 0],
        sourceDomain: [0, 3],
      }),
      second: {
        curveId: "native-tangent-arch",
        kind: "cubicBezier",
        poles,
        sourceDomain: [0, 1],
        provenance: {
          sourceEntityId: "native-tangent-arch",
          sourceSpanId: "span",
        },
      },
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        proof: {
          kind: "exactImplicitLineRootSet",
          verification: "exactRoot",
        },
      },
    ],
  });
  // Line/circle proves kernel-free, so only the three cubic pairs loaded OCC.
  expect(loads).toBe(4);

  const touching = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeCircle("touching-first", [1.5, 0]),
    second: makeCircle("touching-second", [3.5, 0]),
  });
  const positiveGaps = await Promise.all(
    [5e-7, 2e-6].map((gap) =>
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first: makeCircle(`gap-first-${gap}`, [1.5, 0]),
        second: makeCircle(`gap-second-${gap}`, [3.5 + gap, 0]),
      }),
    ),
  );
  expect(loads).toBe(7);

  const oc = (await loadProductionCustomOpenCascade()) as OpenCascadeInstance &
    Record<string, unknown>;
  const throwingRuntime = Object.create(oc) as OpenCascadeInstance &
    Record<string, unknown>;
  Object.defineProperty(throwingRuntime, "Geom2dAdaptor_Curve_2", {
    value: class {
      constructor() {
        throw new Error("forced adaptor construction failure");
      }
    },
  });
  const throwingCapability = createOpenCascadeNeutralCurveQueryCapability(
    async () => throwingRuntime,
  );
  const repeatedRequest = {
    modelingTolerance: 1e-6,
    first: makeLine("native-cleanup-line", [0, 1], {
      direction: [1, 0] as const,
      sourceDomain: [0, 1] as const,
    }),
    second: makeStraightCubic("native-cleanup-cubic"),
  };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    let caught: unknown;
    try {
      await throwingCapability.queryNeutralCurves(repeatedRequest);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors[0]).toMatchObject({
      message: "forced adaptor construction failure",
    });
    await expect(
      capability.queryNeutralCurves(repeatedRequest),
    ).resolves.toMatchObject({ kind: "verified", points: [], overlaps: [] });
  }

  const missingAnalyticCircleBindings = [
    "IntAna2d_AnaIntersection_3",
    "IntAna2d_IntPoint",
    "gp_Circ2d",
  ].filter((name) => typeof oc[name] !== "function");
  expect(
    missingAnalyticCircleBindings,
    "Production custom OCC must provide the analytic circle bindings; unsupported is not acceptance.",
  ).toEqual([]);

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeLine("loaded-native-vertical", [1, -1], {
        sourceDomain: [0, 2],
      }),
      second: makeLine("loaded-native-horizontal", [2, 0], {
        direction: [-1, 0],
        sourceDomain: [0, 2],
      }),
    }),
  ).resolves.toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "crossing",
        firstParameter: 1,
        secondParameter: 1,
        position: [1, 0],
        proof: { kind: "exactFiniteLineIntersection" },
      },
    ],
  });
  expect(loads).toBe(15);

  expect(touching).toMatchObject({
    kind: "verified",
    points: [
      {
        classification: "tangent",
        firstParameter: 0,
        secondParameter: Math.PI,
        position: [2.5, 0],
        proof: { kind: "nativeAnalyticCircleIntersection" },
      },
    ],
    overlaps: [],
  });
  for (const result of positiveGaps) {
    expect(result).toMatchObject({
      kind: "verified",
      points: [],
      overlaps: [],
    });
  }
}, 65_000);

type MatrixCubic = Extract<NeutralCurve, { kind: "cubicBezier" }>;
const makeMatrixCubic = (
  curveId: string,
  poles: MatrixCubic["poles"],
  queryDomain?: readonly [number, number],
): MatrixCubic => ({
  curveId,
  kind: "cubicBezier",
  poles,
  sourceDomain: [0, 1],
  ...(queryDomain ? { queryDomain } : {}),
  provenance: { sourceEntityId: curveId, sourceSpanId: `${curveId}:full` },
});
const matrixLine = (
  curveId: string,
  origin: readonly [number, number],
  direction: readonly [number, number],
  sourceDomain: readonly [number, number],
) => makeLine(curveId, origin, { direction, sourceDomain });
const matrixCircle = (
  curveId: string,
  center: readonly [number, number],
  radius: number,
  arc?: readonly [number, number],
) =>
  makeCircle(curveId, center, {
    radius,
    ...(arc ? { sourceDomain: { kind: "arc", interval: arc } } : {}),
  });
const matrixArch = makeMatrixCubic("arch", [
  [0, 0],
  [1, 2],
  [3, 2],
  [4, 0],
]);

type ProductionMatrixRow = {
  readonly name: string;
  readonly first: NeutralCurve;
  readonly second: NeutralCurve;
  readonly expected:
    | {
        readonly kind: "verified";
        readonly family: string;
        readonly classifications: readonly string[];
        readonly overlaps: number;
      }
    | { readonly kind: "uncertain"; readonly code: string };
} & (
  | {
      /** Exact kernel-free owner: never loads OCC; meter pinned per order. */
      readonly route: "kernelFree";
      readonly operations: readonly [number, number];
    }
  | { readonly route: "occ" }
);

const verified = (
  family: string,
  classifications: readonly string[],
  overlaps = 0,
) => ({ kind: "verified" as const, family, classifications, overlaps });
const failClosed = (code: string) => ({ kind: "uncertain" as const, code });

/**
 * Shared production neutral-query family matrix: the supported/fail-closed
 * list T09 consumes. Every row runs through the exported capability on the
 * promoted custom OCC build in both argument orders.
 */
const PRODUCTION_QUERY_MATRIX: readonly ProductionMatrixRow[] = [
  {
    name: "line/line crossing",
    first: matrixLine("h", [0, 0], [1, 0], [0, 2]),
    second: matrixLine("v", [1, -1], [0, 1], [0, 2]),
    route: "kernelFree",
    expected: verified("finiteLinePair", ["crossing"]),
    operations: [647, 757],
  },
  {
    name: "line/line collinear overlap",
    first: matrixLine("a", [0, 0], [1, 0], [0, 2]),
    second: matrixLine("b", [1, 0], [1, 0], [0, 2]),
    route: "kernelFree",
    expected: verified("finiteLinePair", [], 1),
    operations: [518, 520],
  },
  {
    name: "segment/segment crossing",
    first: makeSegment("s1", [0, 0], [2, 2]),
    second: makeSegment("s2", [0, 2], [2, 0]),
    route: "kernelFree",
    expected: verified("finiteLinePair", ["crossing"]),
    operations: [1107, 1102],
  },
  {
    name: "segment/line crossing",
    first: makeSegment("s1", [0, 0], [2, 2]),
    second: matrixLine("v", [1, -1], [0, 1], [0, 3]),
    route: "kernelFree",
    expected: verified("finiteLinePair", ["crossing"]),
    operations: [950, 947],
  },
  {
    name: "line/circle two crossings",
    first: matrixLine("l", [-2, 0.25], [1, 0], [0, 4]),
    second: matrixCircle("c", [0, 0], 1),
    route: "kernelFree",
    expected: verified("lineCircle", ["crossing", "crossing"]),
    operations: [144952, 144952],
  },
  {
    name: "line/circle tangent",
    first: matrixLine("l", [-2, 1], [1, 0], [0, 4]),
    second: matrixCircle("c", [0, 0], 1),
    route: "kernelFree",
    expected: verified("lineCircle", ["tangent"]),
    operations: [27515, 27515],
  },
  {
    name: "line/arc crossing",
    first: matrixLine("l", [0.5, -2], [0, 1], [0, 4]),
    second: matrixCircle("arc", [0, 0], 1, [0, Math.PI]),
    route: "kernelFree",
    expected: verified("lineCircle", ["crossing"]),
    operations: [187214, 187214],
  },
  {
    name: "segment/arc crossing",
    first: makeSegment("s", [0.5, -2], [0.5, 2]),
    second: matrixCircle("arc", [0, 0], 1, [0, Math.PI]),
    route: "kernelFree",
    expected: verified("lineCircle", ["crossing"]),
    operations: [191817, 191817],
  },
  {
    name: "segment/circle crossing",
    first: makeSegment("s", [-2, 0.25], [2, 0.25]),
    second: matrixCircle("c", [0, 0], 1),
    route: "kernelFree",
    expected: verified("lineCircle", ["crossing", "crossing"]),
    operations: [148243, 148243],
  },
  {
    name: "circle/circle crossing",
    first: matrixCircle("c1", [0, 0], 1),
    second: matrixCircle("c2", [1, 0], 1),
    route: "occ",
    expected: verified("circlePair", ["crossing", "crossing"]),
  },
  {
    name: "circle/circle external tangency",
    first: matrixCircle("c1", [0, 0], 1),
    second: matrixCircle("c2", [2, 0], 1),
    route: "occ",
    expected: verified("circlePair", ["tangent"]),
  },
  {
    name: "circle/circle interior tangency",
    first: matrixCircle("c1", [0, 0], 2),
    second: matrixCircle("c2", [1, 0], 1),
    route: "occ",
    expected: verified("circlePair", ["tangent"]),
  },
  {
    name: "arc/arc crossing",
    first: matrixCircle("a1", [0, 0], 1, [0, Math.PI]),
    second: matrixCircle("a2", [1, 0], 1, [0, Math.PI]),
    route: "kernelFree",
    expected: verified("circlePair", ["crossing"]),
    operations: [273341, 275222],
  },
  {
    name: "arc/circle crossing",
    first: matrixCircle("a1", [0, 0], 1, [0, Math.PI]),
    second: matrixCircle("c2", [1, 0], 1),
    route: "kernelFree",
    expected: verified("circlePair", ["crossing"]),
    operations: [241458, 243339],
  },
  {
    name: "coincident full circles",
    first: matrixCircle("c1", [0, 0], 1),
    second: matrixCircle("c2", [0, 0], 1),
    route: "occ",
    expected: failClosed("occ-native-neutral-curve-uncertain"),
  },
  {
    name: "coincident arcs",
    first: matrixCircle("a1", [0, 0], 1, [0, 2]),
    second: matrixCircle("a2", [0, 0], 1, [1, 3]),
    route: "kernelFree",
    expected: failClosed("coincident-circle-supports"),
    operations: [2725, 2725],
  },
  {
    name: "line/cubic crossing",
    first: matrixLine("l", [2, -1], [0, 1], [0, 4]),
    second: matrixArch,
    route: "occ",
    expected: verified("lineCubic", ["crossing"]),
  },
  {
    name: "line/cubic tangent",
    first: matrixLine("l", [-1, 1.5], [1, 0], [0, 6]),
    second: matrixArch,
    route: "occ",
    expected: verified("lineCubic", ["tangent"]),
  },
  {
    name: "segment/cubic crossing",
    first: makeSegment("s", [2, -1], [2, 3]),
    second: matrixArch,
    route: "kernelFree",
    expected: verified("lineCubic", ["crossing"]),
    operations: [15306, 15306],
  },
  {
    name: "circle/cubic disjoint",
    first: matrixCircle("c", [2, 10], 1),
    second: matrixArch,
    route: "kernelFree",
    expected: verified("circleCubic", []),
    operations: [9577, 9577],
  },
  {
    name: "circle/cubic crossing",
    first: matrixCircle("c", [2, 1.5], 0.5),
    second: matrixArch,
    route: "kernelFree",
    expected: verified("circleCubic", ["crossing", "crossing"]),
    operations: [339084, 339084],
  },
  {
    name: "arc/cubic crossing (one root outside the arc)",
    first: matrixCircle("a", [2, 1.5], 0.5, [Math.PI / 2, (3 * Math.PI) / 2]),
    second: matrixArch,
    route: "kernelFree",
    expected: verified("circleCubic", ["crossing"]),
    operations: [353581, 353581],
  },
  {
    name: "cubic/cubic transverse crossing",
    first: matrixArch,
    second: makeMatrixCubic("down", [
      [0, 1.5],
      [1, -0.5],
      [3, -0.5],
      [4, 1.5],
    ]),
    route: "kernelFree",
    expected: verified("cubicCubic", ["crossing", "crossing"]),
    operations: [430591, 430222],
  },
  {
    name: "cubic/cubic interior tangency",
    first: matrixArch,
    second: makeMatrixCubic("cap", [
      [0, 3],
      [1, 1],
      [3, 1],
      [4, 3],
    ]),
    route: "kernelFree",
    expected: verified("cubicCubic", ["tangent"]),
    operations: [80463, 79431],
  },
  {
    name: "cubic/cubic structural reversed overlap",
    first: matrixArch,
    second: makeMatrixCubic(
      "reversed",
      [
        [4, 0],
        [3, 2],
        [1, 2],
        [0, 0],
      ],
      [0.2, 0.8],
    ),
    route: "occ",
    expected: verified("structuralCubicOverlap", [], 1),
  },
  {
    name: "cubic/cubic non-structural overlap",
    first: matrixArch,
    // The exact de Casteljau left half of the arch: same support, new basis.
    second: makeMatrixCubic("left-half", [
      [0, 0],
      [0.5, 1],
      [1.25, 1.5],
      [2, 1.5],
    ]),
    route: "kernelFree",
    expected: failClosed("non-structural-cubic-overlap"),
    operations: [28311, 26636],
  },
];

test("shared production family matrix verifies or fails closed in both argument orders on the custom OCC build", async () => {
  let loads = 0;
  const load = () => {
    loads += 1;
    return loadProductionCustomOpenCascade();
  };
  const syncQuery = createCertifiedNeutralCurveQueryWithBudgetObserverForTest;
  for (const row of PRODUCTION_QUERY_MATRIX) {
    const orders = [
      { first: row.first, second: row.second },
      { first: row.second, second: row.first },
    ] as const;
    for (const [order, curves] of orders.entries()) {
      const label = `${row.name} (${order === 0 ? "as listed" : "swapped"})`;
      const request = { modelingTolerance: 1e-6, ...curves };
      const operations: number[] = [];
      const loadsBefore = loads;
      const result =
        await createOpenCascadeNeutralCurveQueryCapabilityWithBudgetObserverForTest(
          load,
          (snapshot) => operations.push(snapshot.operations),
        ).queryNeutralCurves(request);
      expect(operations, label).toHaveLength(1);
      if (row.expected.kind === "verified") {
        expect(result, label).toMatchObject({
          kind: "verified",
          completenessProof: { family: row.expected.family },
        });
        if (result.kind === "verified") {
          expect(
            result.points.map((point) => point.classification).sort(),
            label,
          ).toEqual([...row.expected.classifications].sort());
          expect(result.overlaps, label).toHaveLength(row.expected.overlaps);
        }
      } else {
        expect(result, label).toMatchObject(row.expected);
      }
      if (row.route === "occ") {
        expect(loads - loadsBefore, `${label} is OCC-backed`).toBe(1);
        continue;
      }
      expect(loads - loadsBefore, `${label} never loads OCC`).toBe(0);
      const syncOperations: number[] = [];
      expect(
        syncQuery((snapshot) =>
          syncOperations.push(snapshot.operations),
        ).queryPair(request),
        `${label} composes the sync dispatcher's exact owner`,
      ).toEqual(result);
      expect(syncOperations, label).toEqual(operations);
      expect(operations[0], `${label} meter`).toBe(row.operations[order]);
      await expect(
        createOpenCascadeNeutralCurveQueryCapabilityWithLowerBudgetForTest(
          load,
          { operations: row.operations[order]! - 1 },
        ).queryNeutralCurves(request),
        `${label} meter - 1`,
      ).resolves.toMatchObject({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
      });
      expect(loads - loadsBefore, label).toBe(0);
    }
  }

  const loadsBeforeSelf = loads;
  const capability = createOpenCascadeNeutralCurveQueryCapability(load);
  for (const [curve, expected] of [
    [
      makeMatrixCubic("loop", [
        [0, 0],
        [3, 2],
        [-1, 2],
        [2, 0],
      ]),
      {
        kind: "verified",
        completenessProof: { family: "cubicSelf", distinctRootCount: 1 },
      },
    ],
    [
      matrixArch,
      {
        kind: "verified",
        completenessProof: { family: "cubicSelf", distinctRootCount: 0 },
      },
    ],
    [
      matrixLine("line-self", [0, 0], [1, 0], [0, 1]),
      {
        kind: "unsupported",
        code: "occ-neutral-curve-self-intersection-unsupported",
      },
    ],
    [
      matrixCircle("circle-self", [0, 0], 1),
      {
        kind: "unsupported",
        code: "occ-neutral-curve-self-intersection-unsupported",
      },
    ],
  ] as const) {
    await expect(
      capability.queryNeutralCurveSelfIntersections({
        modelingTolerance: 1e-6,
        curve,
      }),
      curve.curveId,
    ).resolves.toMatchObject(expected);
  }
  expect(loads, "self queries never load OCC").toBe(loadsBeforeSelf);
}, 120_000);

test("installed full OCC rejects positive endpoint gaps and verifies a bounded crossing", async () => {
  const { default: initializeOpenCascade } =
    await import("opencascade.js/dist/node.js");
  const wasm = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../node_modules/opencascade.js/dist/opencascade.full.wasm",
        import.meta.url,
      ),
    ),
  );
  const oc = (await initializeOpenCascade({
    module: { wasmBinary: wasm },
  })) as OpenCascadeInstance;
  const capability = createOpenCascadeNeutralCurveQueryCapability(
    async () => oc,
  );

  for (const gap of [5.10702591327572e-15, 1e-14, 2e-14]) {
    const result = await capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeStraightCubic(`cubic-gap-${gap}`),
      second: makeLine(`line-gap-${gap}`, [1 + gap, -1]),
    });
    expect(result, `positive gap ${gap} must not become contact`).toMatchObject(
      {
        kind: "uncertain",
        code: "occ-neutral-curve-point-proof-unavailable",
      },
    );
  }

  for (const offset of [0, 1_000_000_000]) {
    const result = await capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: makeStraightCubic(`crossing-${offset}`, offset),
      second: makeLine(`line-${offset}`, [offset + 0.5, -1]),
    });
    expect(result, `crossing translated by ${offset}`).toMatchObject({
      kind: "verified",
      points: [
        {
          classification: "crossing",
          proof: {
            kind: "exactImplicitLineRootSet",
            verification: offset === 0 ? "boundedSignChange" : "exactRoot",
          },
        },
      ],
      overlaps: [],
    });
  }
}, 65_000);

test("endpoint segments route to the kernel-free exact owners on one meter and never load OCC", async () => {
  const neverLoad = async (): Promise<OpenCascadeInstance> => {
    throw new Error("endpoint segments must never load OCC");
  };
  const across = makeSegment("across", [-2, 0.5], [2, 0.5]);
  const cases = [
    [across, makeSegment("down", [0, 2], [0, -2]), "finiteLinePair", 1],
    [across, makeLine("numeric", [0.25, -1]), "finiteLinePair", 1],
    [across, makeCircle("circle", [0, 0]), "lineCircle", 2],
    [
      across,
      {
        ...makeStraightCubic("arch"),
        poles: [
          [-1, -1],
          [-1 / 3, 2],
          [1 / 3, 2],
          [1, -1],
        ],
      },
      "lineCubic",
      2,
    ],
  ] as const;
  const syncQuery = createCertifiedNeutralCurveQueryWithBudgetObserverForTest;
  for (const [first, second, family, count] of cases) {
    for (const request of [
      { modelingTolerance: 1e-6, first, second },
      { modelingTolerance: 1e-6, first: second, second: first },
    ]) {
      const occOperations: number[] = [];
      const result =
        await createOpenCascadeNeutralCurveQueryCapabilityWithBudgetObserverForTest(
          neverLoad,
          (snapshot) => occOperations.push(snapshot.operations),
        ).queryNeutralCurves(request);
      expect(result, family).toMatchObject({
        kind: "verified",
        completenessProof: { family, distinctRootCount: count },
      });
      if (result.kind !== "verified") continue;
      expect(result.points).toHaveLength(count);
      const syncOperations: number[] = [];
      expect(
        syncQuery((snapshot) =>
          syncOperations.push(snapshot.operations),
        ).queryPair(request),
        "the adapter composes the same exact owner as the sync dispatcher",
      ).toEqual(result);
      expect(occOperations).toEqual(syncOperations);
      await expect(
        createOpenCascadeNeutralCurveQueryCapabilityWithLowerBudgetForTest(
          neverLoad,
          { operations: occOperations[0]! - 1 },
        ).queryNeutralCurves(request),
      ).resolves.toMatchObject({
        kind: "uncertain",
        code: "exact-query-proof-budget-exhausted",
      });
    }
  }
});

test("a spoofed or overflowing segment form is invalid before any OCC load", async () => {
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    throw new Error("invalid requests must never load OCC");
  });
  const base = {
    curveId: "spoof",
    kind: "line",
    start: [0, 0],
    end: [1, 0],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "spoof", sourceSpanId: "spoof:full" },
  } as const;
  for (const spoof of [
    { ...base, form: "endpointArc" },
    // A numeric form without numeric fields cannot inherit segment meaning.
    base,
    {
      ...base,
      form: "endpointSegment",
      end: [Number.MAX_VALUE, 0],
      start: [-Number.MAX_VALUE, 0],
    },
    { ...base, form: "endpointSegment", end: [0, 0] },
  ]) {
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first: spoof as unknown as NeutralCurve,
        second: makeCircle("circle", [0, 0]),
      }),
    ).resolves.toMatchObject({
      kind: "uncertain",
      code: "invalid-neutral-curve-query",
    });
  }
});
