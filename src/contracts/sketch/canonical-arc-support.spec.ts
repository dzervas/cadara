import { describe, expect, test } from "vitest";
import { canonicalArcSupport } from "@/contracts/sketch/canonical-arc-support";

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
