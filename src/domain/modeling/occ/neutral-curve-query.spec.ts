import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import {
  evaluateNeutralCurve,
  type NeutralCurve,
} from "@/contracts/modeling/neutral-curve-query";
import { createOpenCascadeNeutralCurveQueryCapability } from "@/domain/modeling/occ/neutral-curve-query";
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
  sourceDomain: [0, Math.PI * 2],
  provenance: { sourceEntityId: curveId, sourceSpanId: `${curveId}:full` },
  ...overrides,
});

const makeLine = (
  curveId: string,
  origin: readonly [number, number],
): Extract<NeutralCurve, { kind: "line" }> => ({
  curveId,
  kind: "line",
  origin,
  direction: [0, 1],
  sourceDomain: [-1, 2],
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

function parametricRuntime(input?: {
  firstParameter: number;
  secondParameter: number;
  position: readonly [number, number];
}) {
  class PointArray extends Disposable {
    SetValue() {}
  }
  class IntersectionPoint extends Disposable {
    ParamOnFirst() {
      return input!.firstParameter;
    }
    ParamOnSecond() {
      return input!.secondParameter;
    }
    Value() {
      return new Point(...input!.position);
    }
  }
  class Intersection extends Disposable {
    IsDone() {
      return true;
    }
    NbPoints() {
      return input ? 1 : 0;
    }
    NbSegments() {
      return 0;
    }
    Point() {
      return new IntersectionPoint();
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

function analyticCircleRuntime(input: {
  firstParameter: number;
  secondParameter: number;
  position: readonly [number, number];
}) {
  class Circle extends Disposable {
    Circ2d() {
      return new Disposable();
    }
  }
  class IntersectionPoint extends Disposable {
    ParamOnFirst() {
      return input.firstParameter;
    }
    ParamOnSecond() {
      return input.secondParameter;
    }
    Value() {
      return new Point(...input.position);
    }
  }
  class Intersection extends Disposable {
    IsDone() {
      return true;
    }
    IsEmpty() {
      return false;
    }
    IdenticalElements() {
      return false;
    }
    NbPoints() {
      return 1;
    }
    Point() {
      return new IntersectionPoint();
    }
  }
  return {
    gp_Pnt2d_3: Point,
    gp_Dir2d_4: Disposable,
    gp_Ax2d_2: Disposable,
    Geom2d_Circle_2: Circle,
    IntAna2d_AnaIntersection_3: Intersection,
    IntAna2d_IntPoint: IntersectionPoint,
    gp_Circ2d: Disposable,
  } as unknown as OpenCascadeInstance;
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
    expect(result.message).toContain("IntAna2d_AnaIntersection_3");
    expect(result.message).toContain("IntAna2d_IntPoint");
    expect(result.message).toContain("gp_Circ2d");
  }
});

test("unsupported pair classes are gated in either argument order without loading OCC", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return parametricRuntime();
  });
  const firstLine = makeLine("first-line", [0, 0]);
  const secondLine = makeLine("second-line", [1, 0]);
  const firstCubic = makeStraightCubic("first-cubic");
  const secondCubic = makeStraightCubic("second-cubic", 2);
  const circle = makeCircle("circle", [0, 0]);

  for (const [first, second] of [
    [firstLine, secondLine],
    [secondLine, firstLine],
    [firstCubic, secondCubic],
    [secondCubic, firstCubic],
    [circle, firstCubic],
    [firstCubic, circle],
  ] as const) {
    await expect(
      capability.queryNeutralCurves({
        modelingTolerance: 1e-6,
        first,
        second,
      }),
    ).resolves.toMatchObject({
      kind: "unsupported",
      code: "occ-neutral-curve-pair-unsupported",
    });
  }
  expect(loads).toBe(0);
});

test("zero native candidates cannot certify supported parametric pairs as empty", async () => {
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    parametricRuntime(),
  );
  const line = makeLine("line", [0, 0]);
  const cubic = makeStraightCubic("cubic");
  const circle = makeCircle("circle", [2, 0]);

  for (const [first, second] of [
    [line, cubic],
    [cubic, line],
    [line, circle],
    [circle, line],
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
});

test("analytic circles preserve phase and retain a tangent in an unwrapped bounded domain", async () => {
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    analyticCircleRuntime({
      firstParameter: 0,
      secondParameter: 0,
      position: [0, 1],
    }),
  );
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeCircle("first", [0, 0], {
      xAxis: [0, 1],
      sourceDomain: [5.5, 6.5],
    }),
    second: makeCircle("second", [0, 2], {
      xAxis: [0, -1],
      sourceDomain: [5.5, 6.5],
    }),
  });

  expect(result).toEqual({
    kind: "verified",
    points: [
      {
        classification: "tangent",
        firstParameter: Math.PI * 2,
        secondParameter: Math.PI * 2,
        position: [0, 1],
        proof: { kind: "nativeAnalyticCircleIntersection" },
      },
    ],
    overlaps: [],
  });

  const clipped = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: makeCircle("first", [0, 0], {
      xAxis: [0, 1],
      sourceDomain: [5.5, 6.5],
      queryDomain: [5.5, 6.2],
    }),
    second: makeCircle("second", [0, 2], {
      xAxis: [0, -1],
      sourceDomain: [5.5, 6.5],
    }),
  });
  expect(clipped).toEqual({ kind: "verified", points: [], overlaps: [] });
});

test("exact reversed cubic structure returns a complete overlap without loading OCC", async () => {
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

  expect(loads).toBe(0);
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

test("disjoint ranges on an exact cubic basis remain uncertain without an explicit self proof", async () => {
  let loads = 0;
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () => {
    loads += 1;
    return {} as OpenCascadeInstance;
  });
  const first = makeStraightCubic("first");
  const result = await capability.queryNeutralCurves({
    modelingTolerance: 1e-6,
    first: { ...first, queryDomain: [0.1, 0.2] },
    second: { ...first, curveId: "second", queryDomain: [0.8, 0.9] },
  });
  expect(result).toMatchObject({
    kind: "uncertain",
    code: "structural-cubic-disjoint-parameter-contact-unresolved",
  });
  expect(loads).toBe(0);

  const self = await capability.queryNeutralCurveSelfIntersections({
    modelingTolerance: 1e-6,
    curve: first,
  });
  expect(self).toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-self-intersection-proof-unavailable",
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
    kind: "uncertain",
    code: "structural-cubic-disjoint-parameter-contact-unresolved",
  });
  expect(loads).toBe(0);
});

test("extreme positive structural overlaps stay verified in either order and orientation", async () => {
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
  expect(loads).toBe(0);
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
    IntAna2d_AnaIntersection_3: Disposable,
    IntAna2d_IntPoint: Disposable,
    gp_Circ2d: Disposable,
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

test("line bounds cover a nonmonotone projection across the complete proof bracket", async () => {
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
    sourceDomain,
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
  const capability = createOpenCascadeNeutralCurveQueryCapability(async () =>
    parametricRuntime({
      firstParameter: nativeParameter,
      secondParameter: 1,
      position: candidate,
    }),
  );

  await expect(
    capability.queryNeutralCurves({
      modelingTolerance: 1e-6,
      first: circle,
      second: line,
    }),
  ).resolves.toMatchObject({
    kind: "uncertain",
    code: "occ-neutral-curve-point-proof-unavailable",
  });
});

test("production custom OCC enforces structural overlap and analytic circle acceptance at the exported adapter seam", async () => {
  let loads = 0;
  let runtime: Promise<OpenCascadeInstance> | undefined;
  const loadCustomOpenCascade = () => {
    loads += 1;
    runtime ??= (async () => {
      const module = (await import("../../../../public/cadara-occ.js")) as {
        default: new (input: {
          wasmBinary: Uint8Array;
        }) => Promise<OpenCascadeInstance>;
      };
      const wasmBinary = new Uint8Array(
        readFileSync(
          fileURLToPath(
            new URL("../../../../public/cadara-occ.wasm", import.meta.url),
          ),
        ),
      );
      return new module.default({ wasmBinary });
    })();
    return runtime;
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
    }),
  ).resolves.toEqual({
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
  expect(loads).toBe(0);

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
  expect(loads).toBe(3);

  const oc = (await runtime!) as OpenCascadeInstance & Record<string, unknown>;
  const missingAnalyticCircleBindings = [
    "IntAna2d_AnaIntersection_3",
    "IntAna2d_IntPoint",
    "gp_Circ2d",
  ].filter((name) => typeof oc[name] !== "function");
  expect(
    missingAnalyticCircleBindings,
    "Production custom OCC must provide the analytic circle bindings; unsupported is not acceptance.",
  ).toEqual([]);

  expect(touching).toEqual({
    kind: "verified",
    points: [
      {
        classification: "tangent",
        firstParameter: Math.PI * 2,
        secondParameter: Math.PI,
        position: [2.5, 0],
        proof: { kind: "nativeAnalyticCircleIntersection" },
      },
    ],
    overlaps: [],
  });
  for (const result of positiveGaps) {
    expect(result).toEqual({ kind: "verified", points: [], overlaps: [] });
  }
}, 65_000);

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
            kind: "nativeParametricCurveIntersection",
            verification: "boundedTransverseLineIncidence",
          },
        },
      ],
      overlaps: [],
    });
  }
}, 65_000);
