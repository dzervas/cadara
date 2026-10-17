import { expect } from "vitest";
import type { SemanticResult } from "@/contracts/semantic/schema";
import type { CadaraBrepBSplineCurve3Record } from "@/contracts/modeling/geometry-assets";

export function loftBody(result: SemanticResult) {
  const model = result.discovery!.model!;
  const feature = model.features.find((f) => f.kind === "loft")!;
  const target = feature.producedTargets.find((t) => t.kind === "body")!;
  if (target.kind !== "body")
    throw new Error("Loft has no current produced body");
  return model.bodies.find((b) => b.bodyId === target.bodyId)!;
}

// Independent test-only Cox–de Boor evaluation of the actual native B-rep's
// polynomial/rational curve records. No tessellation, bounds or authored-value
// substitute can supply these interior points. Production does not use this evaluator.
function at(curve: CadaraBrepBSplineCurve3Record, u: number): number[] {
  const knots = curve.knots.flatMap((k, i) =>
    Array<number>(curve.multiplicities[i]!).fill(k),
  );
  function basis(i: number, degree: number): number {
    if (!degree) return knots[i]! <= u && u < knots[i + 1]! ? 1 : 0;
    const left = knots[i + degree]! - knots[i]!;
    const right = knots[i + degree + 1]! - knots[i + 1]!;
    return (
      (left ? ((u - knots[i]!) / left) * basis(i, degree - 1) : 0) +
      (right
        ? ((knots[i + degree + 1]! - u) / right) * basis(i + 1, degree - 1)
        : 0)
    );
  }
  const weights = curve.poles.map(
    (_, i) => basis(i, curve.degree) * (curve.weights?.[i] ?? 1),
  );
  const denominator = weights.reduce((a, b) => a + b, 0);
  return [0, 1, 2].map(
    (axis) =>
      curve.poles.reduce((sum, p, i) => sum + p[axis]! * weights[i]!, 0) /
      denominator,
  );
}

export function loftInterior(result: SemanticResult, z: number) {
  const body = loftBody(result);
  const curves = body
    .topology!.filter(
      (t) => t.entityClass === "edge" && t.definingData?.kind === "bSpline",
    )
    .map((t) => t.definingData as unknown as CadaraBrepBSplineCurve3Record)
    .filter(
      (c) =>
        Math.min(...c.poles.map((p) => p[2])) < 1e-5 &&
        Math.max(...c.poles.map((p) => p[2])) > 9.999,
    );
  expect(curves).toHaveLength(4);
  return curves.map((curve) => {
    let [low, high] = curve.parameterRange;
    const increasing =
      at(curve, low + (high - low) * 1e-8)[2]! <
      at(curve, high - (high - low) * 1e-8)[2]!;
    for (let i = 0; i < 60; i++) {
      const mid = (low + high) / 2;
      if (at(curve, mid)[2]! < z === increasing) low = mid;
      else high = mid;
    }
    const point = at(curve, (low + high) / 2);
    expect(point[2]).toBeCloseTo(z, 6);
    return point;
  });
}

export function assertLoftInterior(
  result: SemanticResult,
  z: number,
  halfWidth: number,
) {
  for (const point of loftInterior(result, z)) {
    expect(Math.abs(point[0]!)).toBeCloseTo(halfWidth, 5);
    expect(Math.abs(point[1]!)).toBeCloseTo(halfWidth, 5);
  }
  expect(result.completion.geometry.kind).toBe("current");
  expect(result.completion.persistence.kind).toBe("committed");
}
