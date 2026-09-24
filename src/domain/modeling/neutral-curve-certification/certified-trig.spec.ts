import { expect, test } from "vitest";
import { certifySinCos } from "@/domain/modeling/neutral-curve-certification/certified-trig";
import {
  ExactProofBudget,
  ExactQueryProofBudgetExceeded,
} from "@/domain/modeling/neutral-curve-certification/fixed-degree-primitives";

function contains(
  interval: readonly [number, number] | { lower: number; upper: number },
  value: number,
) {
  const lower = Array.isArray(interval) ? interval[0] : interval.lower;
  const upper = Array.isArray(interval) ? interval[1] : interval.upper;
  return value >= lower! && value <= upper!;
}

test("certified trig encloses zero and bounded ordinary angles", () => {
  expect(certifySinCos(0, new ExactProofBudget())).toEqual({
    sine: { lower: 0, upper: 0 },
    cosine: { lower: 1, upper: 1 },
    quadrant: 0,
  });
  for (const angle of [-7, -1, 0.25, 1, 3, 12.5]) {
    const result = certifySinCos(angle, new ExactProofBudget());
    expect(result).not.toBeNull();
    expect(contains(result!.sine, Math.sin(angle))).toBe(true);
    expect(contains(result!.cosine, Math.cos(angle))).toBe(true);
    expect(result!.sine.upper - result!.sine.lower).toBeLessThan(1e-12);
    expect(result!.cosine.upper - result!.cosine.lower).toBeLessThan(1e-12);
  }
});

test("certified trig fails closed when bounded range reduction is exhausted", () => {
  expect(certifySinCos(Number.MAX_VALUE, new ExactProofBudget())).toBeNull();
  expect(certifySinCos(Number.NaN, new ExactProofBudget())).toBeNull();
});

test("certified trig precharges every fixed operation before its early return", () => {
  const tinyWidth = new ExactProofBudget({ integerBits: 63 });
  expect(() => certifySinCos(0.25, tinyWidth)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(tinyWidth.snapshot().maxStoredBits).toBe(64);

  const oneShort = new ExactProofBudget({ operations: 879 });
  expect(() => certifySinCos(0, oneShort)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(oneShort.snapshot().operations).toBe(880);

  const exactBoundary = new ExactProofBudget({ operations: 880 });
  expect(certifySinCos(0, exactBoundary)).toEqual({
    sine: { lower: 0, upper: 0 },
    cosine: { lower: 1, upper: 1 },
    quadrant: 0,
  });
  expect(exactBoundary.snapshot().operations).toBe(880);
});

test("certified trig meters nested binary64 stepping separately from fixed work", () => {
  const exactBoundary = new ExactProofBudget({ operations: 1_759 });
  expect(certifySinCos(0.25, exactBoundary)).not.toBeNull();
  expect(exactBoundary.snapshot().operations).toBe(1_759);

  const oneShort = new ExactProofBudget({ operations: 1_758 });
  expect(() => certifySinCos(0.25, oneShort)).toThrow(
    ExactQueryProofBudgetExceeded,
  );
  expect(oneShort.snapshot().operations).toBe(1_759);
});
