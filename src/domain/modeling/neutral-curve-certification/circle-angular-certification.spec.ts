import { expect, test } from "vitest";
import type {
  NeutralCurve,
  NeutralCurveQueryRequest,
} from "@/contracts/modeling/neutral-curve-query";
import {
  certifyCircleRootDisposition,
  type AlgebraicPointOnRoot,
} from "@/domain/modeling/neutral-curve-certification/circle-angular-certification";
import { createCertifiedNeutralCurveQuery } from "@/domain/modeling/neutral-curve-certification/query";
import {
  ExactProofBudget,
  addExact,
  compareExact,
  exact,
  multiplyExact,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

const point = (
  x: bigint,
  y: bigint,
  budget: ExactProofBudget,
): AlgebraicPointOnRoot => ({
  refine: () => ({
    rootBounds: [exact(0n, 1n, budget), exact(0n, 1n, budget)],
    xBounds: [exact(x, 1n, budget), exact(x, 1n, budget)],
    yBounds: [exact(y, 1n, budget), exact(y, 1n, budget)],
  }),
  signLinear: (a, b, c) => {
    const value = addExact(
      addExact(
        multiplyExact(a, exact(x, 1n, budget), budget),
        multiplyExact(b, exact(y, 1n, budget), budget),
        budget,
      ),
      c,
      budget,
    );
    return compareExact(value, exact(0n, 1n, budget), budget) as -1 | 0 | 1;
  },
});

const circle = (
  sourceDomain: Extract<NeutralCurve, { kind: "circle" }>["sourceDomain"],
): Extract<NeutralCurve, { kind: "circle" }> => ({
  kind: "circle",
  curveId: "circle",
  provenance: { sourceEntityId: "circle", sourceSpanId: "circle" },
  center: [0, 0],
  radius: 1,
  xAxis: [9, 0],
  sourceDomain,
});

test("exported query retains roots near either arc seam in both argument orders", () => {
  const center = [3, 2 ** -40] as const;
  const tiny = 2 ** -60;
  const request = (
    first: NeutralCurve,
    second: NeutralCurve,
  ): NeutralCurveQueryRequest => ({
    modelingTolerance: 1e-7,
    first,
    second,
  });
  const query = createCertifiedNeutralCurveQuery();

  for (const fixture of [
    { interval: [0, 1] as const, offset: tiny },
    { interval: [-1, 0] as const, offset: -tiny },
  ]) {
    const seamCircle: Extract<NeutralCurve, { kind: "circle" }> = {
      ...circle({ kind: "arc", interval: fixture.interval }),
      center,
      radius: 1,
      xAxis: [9, 0],
    };
    const seamLine: Extract<NeutralCurve, { kind: "line" }> = {
      kind: "line",
      curveId: "line",
      provenance: { sourceEntityId: "line", sourceSpanId: "line" },
      origin: [1, center[1] + fixture.offset],
      direction: [1, 0],
      sourceDomain: [0, 4],
    };

    for (const input of [
      request(seamLine, seamCircle),
      request(seamCircle, seamLine),
    ]) {
      const result = query.queryPair(input);
      expect(result.kind).toBe("verified");
      if (result.kind === "verified") {
        expect(result.points).toHaveLength(1);
        const circleBounds =
          input.first.kind === "circle"
            ? result.points[0]!.proof.firstParameterBounds
            : result.points[0]!.proof.secondParameterBounds;
        expect(circleBounds[0]).toBeGreaterThan(fixture.interval[0]);
        expect(circleBounds[1]).toBeLessThan(fixture.interval[1]);
      }
    }
  }
});

test("binary64 Math.PI/2 is not treated as exact quarter-turn equality", () => {
  const insideBudget = new ExactProofBudget();
  const inside = certifyCircleRootDisposition(
    circle({ kind: "arc", interval: [0, Math.PI / 2] }),
    point(0n, 1n, insideBudget),
    insideBudget,
  );
  expect(inside).toEqual({ kind: "excluded" });

  const outsideBudget = new ExactProofBudget();
  const outside = certifyCircleRootDisposition(
    circle({ kind: "arc", interval: [Math.PI / 2, 3] }),
    point(0n, 1n, outsideBudget),
    outsideBudget,
  );
  expect(outside.kind).toBe("active");
  if (outside.kind === "active") {
    expect(outside.parameterBounds[0]).toBe(Math.PI / 2);
    expect(outside.parameterBounds[1]).toBeGreaterThan(Math.PI / 2);
  }
});

test("certified quadrant search is seed-independent for a non-axis bounded arc", () => {
  const results = [undefined, 0, -1_000_000].map((seed) => {
    const budget = new ExactProofBudget();
    return certifyCircleRootDisposition(
      {
        ...circle({ kind: "arc", interval: [0.5, 1] }),
        radius: Math.SQRT2,
        xAxis: [1, 0],
      },
      point(1n, 1n, budget),
      budget,
      seed,
    );
  });
  for (const result of results) {
    expect(result.kind).toBe("active");
    if (result.kind === "active") {
      expect(result.parameterBounds[0]).toBeLessThan(Math.PI / 4);
      expect(result.parameterBounds[1]).toBeGreaterThan(Math.PI / 4);
    }
  }
});

test("adjacent windings are exhaustive and adversarial seeds cannot select the antipode", () => {
  for (const interval of [
    [-6, -5] as const,
    [0.5, 1] as const,
    [6.5, 7.5] as const,
  ]) {
    for (const seed of [undefined, -1_000_000, 1_000_000]) {
      const activeBudget = new ExactProofBudget();
      const active = certifyCircleRootDisposition(
        {
          ...circle({ kind: "arc", interval }),
          xAxis: [3, 0],
        },
        point(1n, 1n, activeBudget),
        activeBudget,
        seed,
      );
      expect(active.kind).toBe("active");

      const antipodalBudget = new ExactProofBudget();
      const antipodal = certifyCircleRootDisposition(
        {
          ...circle({ kind: "arc", interval }),
          xAxis: [3, 0],
        },
        point(-1n, -1n, antipodalBudget),
        antipodalBudget,
        seed,
      );
      expect(antipodal).toEqual({ kind: "excluded" });
    }
  }
});

test("symbolic full turns select one negative winding and own no upper duplicate", () => {
  const budget = new ExactProofBudget();
  const result = certifyCircleRootDisposition(
    circle({ kind: "fullTurn", seam: -7 }),
    point(0n, 1n, budget),
    budget,
  );
  expect(result.kind).toBe("active");
  if (result.kind === "active") {
    expect(result.parameter).toBeGreaterThan(-4.72);
    expect(result.parameter).toBeLessThan(-4.7);
  }
});
