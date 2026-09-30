import { describe, expect, test } from "vitest";
import {
  canonicalArcSupport,
  seedArcLeafSplits,
} from "@/contracts/sketch/canonical-arc-support";

describe("canonical arc support (T08b-e [TECH E7])", () => {
  test("keeps centre, start, end and sweep verbatim and takes the radius as hypot(start − centre), the solver's projection formula", () => {
    const center = [0.1, -0.2] as const;
    const start = [0.1 + 3e-3, -0.2 + 4e-3] as const;
    const end = [0.1 - 4e-3, -0.2 + 3.0000001e-3] as const;
    const support = canonicalArcSupport(center, start, end, "clockwise");
    expect(support.center).toBe(center);
    expect(support.start).toBe(start);
    expect(support.end).toBe(end);
    expect(support.sweepDirection).toBe("clockwise");
    // Bitwise the solver-core driven-arc radius length(subtract(start, center)).
    expect(
      Object.is(
        support.radius,
        Math.hypot(start[0] - center[0], start[1] - center[1]),
      ),
    ).toBe(true);
    // The end is never consulted: |end − centre| ≠ radius is kept as given.
    expect(
      Math.hypot(end[0] - center[0], end[1] - center[1]) === support.radius,
    ).toBe(false);
  });
});

describe("seed-arc rule-B′ partition (T08b-f review R1)", () => {
  const angle = (vector: readonly [number, number]) =>
    Math.atan2(vector[1], vector[0]);
  test("splits balanced and shared: a quarter arc gives two leaves, a semicircle four, a 3/4 arc eight; every leaf is below atan 2 ≈ 63.4° on both wedges", () => {
    const center = [0, 0] as const;
    const cases = [
      [[1, 0], [0, 1], 1],
      [[1, 0], [-1, 0], 3],
      [[1, 0], [0, -1], 7],
    ] as const;
    for (const [start, end, splits] of cases) {
      const result = seedArcLeafSplits(
        center,
        start,
        end,
        "counterClockwise",
        start,
        end,
      );
      expect(result).toHaveLength(splits);
      const boundaries = [start, ...result!, end].map(angle);
      for (let leaf = 0; leaf + 1 < boundaries.length; leaf += 1) {
        let sweep = boundaries[leaf + 1]! - boundaries[leaf]!;
        while (sweep <= 0) sweep += 2 * Math.PI;
        expect(sweep).toBeLessThan(Math.atan(2));
      }
    }
  });

  test("a fillet whose emitted leaf is π/2 − ulp still splits (rule B would keep one leaf whose reference wedge reaches π/2)", () => {
    const center = [0, 0] as const;
    const start = [0.19, 0] as const;
    const end = [0.19 * Math.cos(Math.PI / 2), 0.19] as const;
    expect(
      seedArcLeafSplits(
        center,
        start,
        end,
        "counterClockwise",
        [0.2, 0],
        [0, 0.2],
      ),
    ).toHaveLength(1);
  });

  test("an exactly full turn, a zero radius vector or an unadmitted bisector has no partition (null)", () => {
    expect(
      seedArcLeafSplits([0, 0], [1, 0], [2, 0], "clockwise", [1, 0], [2, 0]),
    ).toBeNull();
    expect(
      seedArcLeafSplits(
        [0, 0],
        [0, 0],
        [0, 1],
        "counterClockwise",
        [1, 0],
        [0, 1],
      ),
    ).toBeNull();
    // Emitted and reference ends a quarter turn apart share no bisector.
    expect(
      seedArcLeafSplits(
        [0, 0],
        [0, 1],
        [-1, 0],
        "counterClockwise",
        [1, 0],
        [0, 1],
      ),
    ).toBeNull();
  });
});
