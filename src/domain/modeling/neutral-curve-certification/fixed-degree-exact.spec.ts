import { expect, test } from "vitest";
import type {
  NeutralCurve,
  NeutralCurvePointWitness,
} from "@/contracts/modeling/neutral-curve-query";
import {
  admitVerifiedNeutralCurveResult as admitVerifiedNeutralCurveResultWithMeter,
  certifyStructuralCubicPair,
  proveFiniteLinePair,
  proveStructuralCubicOverlap as proveStructuralCubicOverlapWithMeter,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-exact";
import { ExactProofBudget } from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

const proveStructuralCubicOverlap = (
  first: NeutralCurve,
  second: NeutralCurve,
) =>
  proveStructuralCubicOverlapWithMeter(first, second, new ExactProofBudget());

const admitVerifiedNeutralCurveResult = (
  ...args: Parameters<typeof admitVerifiedNeutralCurveResultWithMeter> extends [
    infer Request,
    infer Points,
    infer Overlaps,
    infer Completeness,
    ...unknown[],
  ]
    ? [Request, Points, Overlaps, Completeness]
    : never
) =>
  admitVerifiedNeutralCurveResultWithMeter(
    ...args,
    new ExactProofBudget(),
    "pair",
  );

test("admission derives the completeness family from pair versus self requests", () => {
  const provenance = (id: string) => ({
    sourceEntityId: id,
    sourceSpanId: id,
  });
  const line: Extract<NeutralCurve, { kind: "line" }> = {
    kind: "line",
    curveId: "line",
    provenance: provenance("line"),
    origin: [0, 0],
    direction: [1, 0],
    sourceDomain: [0, 1],
  };
  const circle: Extract<NeutralCurve, { kind: "circle" }> = {
    kind: "circle",
    curveId: "circle",
    provenance: provenance("circle"),
    center: [0, 0],
    radius: 1,
    xAxis: [1, 0],
    sourceDomain: { kind: "fullTurn", seam: 0 },
  };
  expect(() =>
    admitVerifiedNeutralCurveResultWithMeter(
      { modelingTolerance: 1e-7, first: line, second: circle },
      [],
      [],
      {
        kind: "completeIsolatedRootSet",
        family: "cubicSelf",
        distinctRootCount: 0,
      },
      new ExactProofBudget(),
      "pair",
    ),
  ).toThrow("Invalid isolated neutral-curve completeness proof.");

  const cubic: Extract<NeutralCurve, { kind: "cubicBezier" }> = {
    kind: "cubicBezier",
    curveId: "cubic",
    provenance: provenance("cubic"),
    poles: [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    sourceDomain: [0, 1],
  };
  expect(() =>
    admitVerifiedNeutralCurveResultWithMeter(
      { modelingTolerance: 1e-7, first: cubic, second: cubic },
      [],
      [],
      {
        kind: "completeIsolatedRootSet",
        family: "cubicSelf",
        distinctRootCount: 0,
      },
      new ExactProofBudget(),
      "pair",
    ),
  ).toThrow("Invalid isolated neutral-curve completeness proof.");
  expect(() =>
    admitVerifiedNeutralCurveResultWithMeter(
      {
        modelingTolerance: 1e-7,
        first: cubic,
        second: { ...cubic, curveId: "other-cubic" },
      },
      [],
      [],
      {
        kind: "completeIsolatedRootSet",
        family: "cubicSelf",
        distinctRootCount: 0,
      },
      new ExactProofBudget(),
      "self",
    ),
  ).toThrow("Invalid isolated neutral-curve completeness proof.");
});

test("finite-line certification charges one supplied proof meter", () => {
  const line = (
    id: string,
    origin: readonly [number, number],
    direction: readonly [number, number],
  ) => ({
    curveId: id,
    kind: "line" as const,
    origin,
    direction,
    sourceDomain: [-2, 2] as const,
    provenance: { sourceEntityId: id, sourceSpanId: id },
  });
  expect(() =>
    proveFiniteLinePair(
      {
        modelingTolerance: 1e-7,
        first: line("horizontal", [0, 0], [1, 0]),
        second: line("vertical", [0, 0], [0, 1]),
      },
      new ExactProofBudget({ operations: 1 }),
    ),
  ).toThrow("deterministic exact-query arithmetic budget");
});

const admissionRequest = {
  modelingTolerance: 1e-7,
  first: {
    curveId: "first",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1 / 3, 0],
      [2 / 3, 0],
      [1, 0],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "first", sourceSpanId: "span" },
  },
  second: {
    curveId: "second",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1 / 3, 0],
      [2 / 3, 0],
      [1, 0],
    ],
    sourceDomain: [0, 1],
    provenance: { sourceEntityId: "second", sourceSpanId: "span" },
  },
} as const;

const point = (
  proof: NeutralCurvePointWitness["proof"],
): NeutralCurvePointWitness => ({
  classification: "crossing",
  firstParameter: 0,
  secondParameter: 0,
  position: [0, 0],
  proof,
});

test("verified admission rejects mismatched families and structural point dispositions", () => {
  const bounds = [0, 0] as const;
  expect(() =>
    admitVerifiedNeutralCurveResult(
      admissionRequest,
      [
        point({
          kind: "nativeAnalyticCircleIntersection",
          firstParameterBounds: bounds,
          secondParameterBounds: bounds,
        }),
      ],
      [],
      {
        kind: "completeIsolatedRootSet",
        family: "cubicCubic",
        distinctRootCount: 1,
      },
    ),
  ).toThrow("Invalid isolated neutral-curve completeness proof.");

  expect(() =>
    admitVerifiedNeutralCurveResult(
      admissionRequest,
      [
        point({
          kind: "exactImplicitLineRootSet",
          family: "lineCubic",
          verification: "exactRoot",
          firstParameterBounds: bounds,
          secondParameterBounds: bounds,
        }),
      ],
      [],
      {
        kind: "completeIsolatedRootSet",
        family: "lineCircle",
        distinctRootCount: 1,
      },
    ),
  ).toThrow("Invalid isolated neutral-curve completeness proof.");

  const offDiagonal = point({
    kind: "exactAlgebraicCurveRootSet",
    family: "cubicCubic",
    firstParameterBounds: bounds,
    secondParameterBounds: bounds,
  });
  expect(() =>
    admitVerifiedNeutralCurveResult(admissionRequest, [offDiagonal], [], {
      kind: "completeStructuralCorrespondence",
      family: "structuralCubicOverlap",
      correspondence: "endpoint",
      correspondencePointCount: 1,
      offCorrespondenceDistinctRootCount: 0,
    }),
  ).toThrow("Invalid structural neutral-curve completeness proof.");

  const endpoint: NeutralCurvePointWitness = {
    ...point({
      kind: "exactStructuralCubicCorrespondenceEndpoint",
      poleOrder: "same",
      firstProvenance: { sourceEntityId: "first", sourceSpanId: "span" },
      secondProvenance: { sourceEntityId: "second", sourceSpanId: "span" },
      firstParameterBounds: bounds,
      secondParameterBounds: bounds,
    }),
    classification: "unclassified",
  };
  expect(() =>
    admitVerifiedNeutralCurveResult(
      admissionRequest,
      [endpoint],
      [
        {
          orientation: "same",
          firstInterval: [0, 1],
          secondInterval: [0, 1],
          proof: {
            kind: "structuralCubicPoleIdentity",
            poleOrder: "same",
            firstProvenance: { sourceEntityId: "first", sourceSpanId: "span" },
            secondProvenance: {
              sourceEntityId: "second",
              sourceSpanId: "span",
            },
          },
        },
      ],
      {
        kind: "completeStructuralCorrespondence",
        family: "structuralCubicOverlap",
        correspondence: "interval",
        correspondencePointCount: 0,
        offCorrespondenceDistinctRootCount: 1,
      },
    ),
  ).toThrow("Invalid structural neutral-curve completeness proof.");
});

test("request-aware admission rejects malformed boxes, duplicates, and provenance", () => {
  const valid: NeutralCurvePointWitness = {
    classification: "unclassified",
    firstParameter: 0,
    secondParameter: 0,
    position: [0, 0],
    proof: {
      kind: "exactCubicPairRootSet",
      firstParameterBounds: [0, 0],
      secondParameterBounds: [0, 0],
    },
  };
  const completeness = {
    kind: "completeIsolatedRootSet" as const,
    family: "cubicCubic" as const,
    distinctRootCount: 1,
  };
  for (const malformed of [
    {
      ...valid,
      proof: {
        ...valid.proof,
        firstParameterBounds: [1, 0] as const,
      },
    },
    {
      ...valid,
      proof: {
        ...valid.proof,
        firstParameterBounds: [-1, 0] as const,
      },
    },
    { ...valid, firstParameter: 0.5 },
  ]) {
    expect(() =>
      admitVerifiedNeutralCurveResult(
        admissionRequest,
        [malformed],
        [],
        completeness,
      ),
    ).toThrow("Invalid neutral-curve witness boxes or provenance.");
  }
  expect(() =>
    admitVerifiedNeutralCurveResult(admissionRequest, [valid, valid], [], {
      ...completeness,
      distinctRootCount: 2,
    }),
  ).toThrow("Invalid neutral-curve witness boxes or provenance.");

  expect(() =>
    admitVerifiedNeutralCurveResult(
      admissionRequest,
      [],
      [
        {
          orientation: "same",
          firstInterval: [0, 1],
          secondInterval: [0, 1],
          proof: {
            kind: "structuralCubicPoleIdentity",
            poleOrder: "reversed",
            firstProvenance: admissionRequest.first.provenance,
            secondProvenance: admissionRequest.second.provenance,
          },
        },
      ],
      {
        kind: "completeStructuralCorrespondence",
        family: "structuralCubicOverlap",
        correspondence: "interval",
        correspondencePointCount: 0,
        offCorrespondenceDistinctRootCount: 0,
      },
    ),
  ).toThrow("Invalid neutral-curve witness boxes or provenance.");
});

test("structural admission rejects diagonal impostors in both pole orders", () => {
  for (const poleOrder of ["same", "reversed"] as const) {
    const second =
      poleOrder === "same"
        ? admissionRequest.second
        : {
            ...admissionRequest.second,
            poles: [
              ...admissionRequest.second.poles,
            ].reverse() as unknown as typeof admissionRequest.second.poles,
          };
    const input = { ...admissionRequest, second };
    const parameter = 0.2;
    const secondParameter = poleOrder === "same" ? parameter : 0.8;
    const allegedOffCorrespondence: NeutralCurvePointWitness = {
      classification: "unclassified",
      firstParameter: parameter,
      secondParameter,
      position: [parameter, 0],
      proof: {
        kind: "exactAlgebraicCurveRootSet",
        family: "cubicCubic",
        firstParameterBounds: [parameter, parameter],
        secondParameterBounds:
          poleOrder === "same"
            ? [secondParameter, secondParameter]
            : [0.7999999999999999, 0.8000000000000002],
      },
    };
    expect(() =>
      admitVerifiedNeutralCurveResult(
        input,
        [allegedOffCorrespondence],
        [
          {
            orientation: poleOrder === "same" ? "same" : "opposite",
            firstInterval: [0, 1],
            secondInterval: poleOrder === "same" ? [0, 1] : [1, 0],
            proof: {
              kind: "structuralCubicPoleIdentity",
              poleOrder,
              firstProvenance: input.first.provenance,
              secondProvenance: input.second.provenance,
            },
          },
        ],
        {
          kind: "completeStructuralCorrespondence",
          family: "structuralCubicOverlap",
          correspondence: "interval",
          correspondencePointCount: 0,
          offCorrespondenceDistinctRootCount: 1,
        },
      ),
    ).toThrow("Invalid structural neutral-curve completeness proof.");
  }
});

test("structural admission permits shared-one-parameter boxes when the other boxes are disjoint", () => {
  const constant = {
    ...admissionRequest.first,
    poles: [
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ],
  } as const;
  const input = { ...admissionRequest, first: constant, second: constant };
  const offPoint = (secondParameter: number): NeutralCurvePointWitness => ({
    classification: "unclassified",
    firstParameter: 0.5,
    secondParameter,
    position: [0, 0],
    proof: {
      kind: "exactAlgebraicCurveRootSet",
      family: "cubicCubic",
      firstParameterBounds: [0.5, 0.5],
      secondParameterBounds: [secondParameter, secondParameter],
    },
  });
  expect(
    admitVerifiedNeutralCurveResult(
      input,
      [offPoint(0), offPoint(1)],
      [
        {
          orientation: "same",
          firstInterval: [0, 1],
          secondInterval: [0, 1],
          proof: {
            kind: "structuralCubicPoleIdentity",
            poleOrder: "same",
            firstProvenance: constant.provenance,
            secondProvenance: constant.provenance,
          },
        },
      ],
      {
        kind: "completeStructuralCorrespondence",
        family: "structuralCubicOverlap",
        correspondence: "interval",
        correspondencePointCount: 0,
        offCorrespondenceDistinctRootCount: 2,
      },
    ).points,
  ).toHaveLength(2);
});

test("structural certification keeps interval, singleton, and disjoint cases structural in both pole orders", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const make = (
    curveId: string,
    queryDomain: readonly [number, number],
    reversed: boolean,
  ): Extract<NeutralCurve, { kind: "cubicBezier" }> => ({
    ...admissionRequest.first,
    curveId,
    poles: reversed ? ([...poles].reverse() as unknown as typeof poles) : poles,
    sourceDomain: [10, 20],
    queryDomain,
    provenance: { sourceEntityId: curveId, sourceSpanId: "span" },
  });
  for (const reversed of [false, true]) {
    const second = make("second", reversed ? [12, 14] : [16, 18], reversed);
    const cases = [
      { firstDomain: [12, 18] as const, correspondence: "interval" },
      { firstDomain: [14, 16] as const, correspondence: "endpoint" },
      { firstDomain: [10, 12] as const, correspondence: "disjoint" },
    ] as const;
    for (const fixture of cases) {
      const result = certifyStructuralCubicPair(
        {
          modelingTolerance: 1e-7,
          first: make("first", fixture.firstDomain, false),
          second,
        },
        new ExactProofBudget(),
      );
      expect(result).toMatchObject({
        kind: "verified",
        completenessProof: {
          kind: "completeStructuralCorrespondence",
          correspondence: fixture.correspondence,
        },
      });
    }
  }
});

test("structural cubic overlap proves interiors, orientation, domains, and provenance", () => {
  const first: NeutralCurve = {
    curveId: "arch",
    kind: "cubicBezier",
    poles: [
      [0, 0],
      [1, 1],
      [2, 1],
      [3, 0],
    ],
    sourceDomain: [0, 1],
    queryDomain: [0.2, 0.8],
    provenance: { sourceEntityId: "spline", sourceSpanId: "span-0" },
  };
  const reversed: NeutralCurve = {
    curveId: "arch-reversed",
    kind: "cubicBezier",
    poles: [...first.poles].reverse() as typeof first.poles,
    sourceDomain: [0, 1],
    queryDomain: [0.2, 0.8],
    provenance: { sourceEntityId: "copy", sourceSpanId: "reversed" },
  };
  expect(proveStructuralCubicOverlap(first, reversed)).toEqual({
    orientation: "opposite",
    firstInterval: [0.2, 0.8],
    secondInterval: [0.8, 0.2],
    proof: {
      kind: "structuralCubicPoleIdentity",
      poleOrder: "reversed",
      firstProvenance: first.provenance,
      secondProvenance: reversed.provenance,
    },
  });

  const differentInterior: NeutralCurve = {
    ...reversed,
    poles: [
      [3, 0],
      [2, -1],
      [1, -1],
      [0, 0],
    ],
  };
  expect(proveStructuralCubicOverlap(first, differentInterior)).toBeNull();
});

test("structural overlap intersects both affine active ranges in either argument order", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const first: NeutralCurve = {
    curveId: "first",
    kind: "cubicBezier",
    poles,
    sourceDomain: [2, 4],
    queryDomain: [2.4, 3.6],
    provenance: { sourceEntityId: "first", sourceSpanId: "span" },
  };
  const second: NeutralCurve = {
    curveId: "second",
    kind: "cubicBezier",
    poles,
    sourceDomain: [10, 20],
    queryDomain: [14, 19],
    provenance: { sourceEntityId: "second", sourceSpanId: "span" },
  };

  expect(proveStructuralCubicOverlap(first, second)).toMatchObject({
    orientation: "same",
    firstInterval: [2.8, 3.6],
    secondInterval: [14, 18],
  });
  expect(proveStructuralCubicOverlap(second, first)).toMatchObject({
    orientation: "same",
    firstInterval: [14, 18],
    secondInterval: [2.8, 3.6],
  });

  const reversed: NeutralCurve = {
    ...second,
    poles: [...poles].reverse() as unknown as typeof poles,
  };
  expect(proveStructuralCubicOverlap(first, reversed)).toMatchObject({
    orientation: "opposite",
    firstInterval: [2.4, 3.2],
    secondInterval: [18, 14],
  });
  expect(proveStructuralCubicOverlap(reversed, first)).toMatchObject({
    orientation: "opposite",
    firstInterval: [14, 18],
    secondInterval: [3.2, 2.4],
  });
});

test("structural overlap uses exact binary64 affine ordering and rejects a rounded healed gap", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const first: NeutralCurve = {
    curveId: "first",
    kind: "cubicBezier",
    poles,
    sourceDomain: [-126945672.37721825, 4505890001.637915],
    queryDomain: [2125499653.7343376, 2125499653.7343385],
    provenance: { sourceEntityId: "first", sourceSpanId: "span" },
  };
  const second: NeutralCurve = {
    curveId: "second",
    kind: "cubicBezier",
    poles,
    sourceDomain: [-3609677398.139288, 1915706826.9335546],
    queryDomain: [-923282553.0681655, -923282553.0681646],
    provenance: { sourceEntityId: "second", sourceSpanId: "span" },
  };

  expect(proveStructuralCubicOverlap(first, second)).toBeNull();
  expect(proveStructuralCubicOverlap(second, first)).toBeNull();
  expect(
    proveStructuralCubicOverlap(first, {
      ...second,
      poles: [...poles].reverse() as unknown as typeof poles,
    }),
  ).toBeNull();
});

test("structural overlap maps extreme exact fractions without overflow or underflow", () => {
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
  ): NeutralCurve => ({
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
    const overlap = proveStructuralCubicOverlap(first, second);
    expect(overlap).not.toBeNull();
    expect(overlap!.firstInterval.every(Number.isFinite)).toBe(true);
    expect(overlap!.secondInterval.every(Number.isFinite)).toBe(true);
    expect(overlap!.firstInterval[0]).not.toBe(overlap!.firstInterval[1]);
    expect(overlap!.secondInterval[0]).not.toBe(overlap!.secondInterval[1]);
  }
});

test("structural overlap never snaps separated or zero-width active ranges", () => {
  const poles = [
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 0],
  ] as const;
  const cubic = (
    curveId: string,
    queryDomain: readonly [number, number],
  ): NeutralCurve => ({
    curveId,
    kind: "cubicBezier",
    poles,
    sourceDomain: [0, 1],
    queryDomain,
    provenance: { sourceEntityId: curveId, sourceSpanId: "span" },
  });

  expect(
    proveStructuralCubicOverlap(
      cubic("first", [0.5, 0.5000000000000004]),
      cubic("second", [0.5000000000000007, 0.5000000000000011]),
    ),
  ).toBeNull();
  expect(
    proveStructuralCubicOverlap(
      cubic("first", [0.2, 0.4]),
      cubic("second", [0.4, 0.6]),
    ),
  ).toBeNull();
});
