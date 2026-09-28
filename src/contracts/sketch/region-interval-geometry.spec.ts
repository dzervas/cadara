import { describe, expect, test } from "vitest";
import {
  curvatureDominanceRadius,
  type LeavingDirection,
  sortLeavingDirections,
  widenByJoinBoxes,
} from "@/contracts/sketch/region-interval-geometry";

const u = Number.EPSILON;
/** The certified order is cyclic: rotate it to start at half 0. */
const cyclic = (items: LeavingDirection[] | null) => {
  const halves = items?.map((item) => item.half) ?? null;
  if (!halves) return null;
  const start = halves.indexOf(0);
  return [...halves.slice(start), ...halves.slice(0, start)];
};
const leaving = (
  half: number,
  angle: readonly [number, number],
  curvature: number,
  cubic = false,
): LeavingDirection => ({
  half,
  angle,
  curvature: [curvature, curvature],
  cubic,
});

describe("certified leaving order at one vertex", () => {
  test("tie clusters are overlap components over all pairs: an overlap across consecutive runs is uncertain (math review REQ-1)", () => {
    // A∩B = ∅ but C overlaps both, and C's midpoint sorts after B's: the runs
    // {A} and {B, C} hide the A∩C overlap. The review's truth is C, A, B, D;
    // the old clustering returned A, C, B, D.
    const items = [
      leaving(0, [1, 1 + 4 * u], 2),
      leaving(1, [1 + 5 * u, 1 + 6 * u], 3),
      leaving(2, [1 + 3 * u, 1 + 9 * u], 1),
      leaving(3, [3, 3], 0),
    ];
    expect(sortLeavingDirections(items, true, null)).toBeNull();

    // Control: one pairwise-overlapping cluster is ordered by curvature.
    const tied = [
      leaving(0, [1, 1 + 4 * u], 2),
      leaving(1, [1 + 2 * u, 1 + 6 * u], 3),
      leaving(2, [1 + 3 * u, 1 + 9 * u], 1),
      leaving(3, [3, 3], 0),
    ];
    expect(cyclic(sortLeavingDirections(tied, true, null))).toEqual([
      0, 1, 3, 2,
    ]);
  });

  test("the join guard bounds the curvature-dominance radius including the realized-end spread, and never orders a tied cubic (math review REQ-2)", () => {
    // (w + √(w² + 2ηΔκ))/Δκ: exactly 2w/Δκ at η = 0, and √(2η/Δκ) at w = 0.
    expect(curvatureDominanceRadius(1e-9, 0, 1)).toBeGreaterThanOrEqual(2e-9);
    expect(curvatureDominanceRadius(0, 1e-8, 2)).toBeGreaterThanOrEqual(1e-4);
    expect(curvatureDominanceRadius(0, 1e-8, 2)).toBeLessThan(1.0000001e-4);
    expect(curvatureDominanceRadius(1e-9, 1e-8, 0)).toBe(
      Number.POSITIVE_INFINITY,
    );

    // A tied pair with w = 8u and Δκ = 1e-10: the old guard 2w/Δκ ≈ 3.6e-5
    // passes a 5e-4 ball, but a realized-end spread of 1e-16 puts the
    // dominance radius at ≈ 1.4e-3, beyond the ball.
    const pair = [
      leaving(0, [1, 1 + 4 * u], 0),
      leaving(1, [1 + 4 * u, 1 + 8 * u], 1e-10),
      leaving(2, [3, 3], 0),
    ];
    expect(
      cyclic(sortLeavingDirections(pair, true, { eta: 0, ballRadius: 5e-4 })),
    ).toEqual([0, 1, 2]);
    expect(
      sortLeavingDirections(pair, true, { eta: 1e-16, ballRadius: 5e-4 }),
    ).toBeNull();

    // A cubic's curvature is enclosed only at the vertex: never ordered at a join.
    const cubic = [
      leaving(0, [1, 1 + 4 * u], 0),
      leaving(1, [1 + 4 * u, 1 + 8 * u], 1, true),
      leaving(2, [3, 3], 0),
    ];
    expect(
      sortLeavingDirections(cubic, true, { eta: 0, ballRadius: 5e-4 }),
    ).toBeNull();
    expect(cyclic(sortLeavingDirections(cubic, true, null))).toEqual([0, 1, 2]);
  });

  test("a whole-turn shift never merges intervals certified disjoint (math re-review N3)", () => {
    // A∩B and B∩C touch, A∩C = ∅: the chain A–B–C is not a tie cluster.
    // With D at 2 the run A, B, C wraps past D by a turn; the outward shift
    // used to widen A and C by ulps at 2π until they overlapped, and the
    // curvatures then ordered them D, C, B, A against the certified A < C.
    const chain = (curvatures: readonly number[]) => [
      leaving(0, [1, 1 + 2 * u], curvatures[0]!),
      leaving(1, [1 + 2 * u, 1 + 4 * u], curvatures[1]!),
      leaving(2, [1 + 4 * u, 1 + 6 * u], curvatures[2]!),
      leaving(3, [2, 2], 0),
    ];
    expect(sortLeavingDirections(chain([1, 2, 3]), true, null)).toBeNull();
    expect(sortLeavingDirections(chain([3, 2, 1]), true, null)).toBeNull();
  });
});

test("a cycle's area interval is widened by the area of every join box it visits (math review REQ-3)", () => {
  // Side 2^-10 (exact in binary64): the box area is exactly 2^-20.
  const side = 2 ** -10;
  const box = { x: [0, side], y: [2, 2 + side] } as const;
  const area: readonly [number, number] = [2 ** -22, 2 ** -21];
  const visit = { box, multiplier: 1 };
  expect(widenByJoinBoxes(area, [])).toEqual(area);
  const once = widenByJoinBoxes(area, [visit]);
  expect(once[0]).toBeLessThan(2 ** -22 - 2 ** -20);
  expect(once[1]).toBeGreaterThan(2 ** -21 + 2 ** -20);
  const twice = widenByJoinBoxes(area, [visit, visit]);
  expect(twice[0]).toBeLessThan(2 ** -22 - 2 ** -19);
  expect(twice[1]).toBeGreaterThan(2 ** -21 + 2 ** -19);
});

test("a visit's widening is its multiplier times the box area, since the lobe may wind more than once (math re-review N1)", () => {
  // An arc/arc visit meets almost every line at most 2 + 2 + 3 times: k = 3.
  const side = 2 ** -10;
  const box = { x: [0, side], y: [2, 2 + side] } as const;
  const area: readonly [number, number] = [2 ** -22, 2 ** -21];
  const widened = widenByJoinBoxes(area, [{ box, multiplier: 3 }]);
  expect(widened[0]).toBeLessThan(2 ** -22 - 3 * 2 ** -20);
  expect(widened[1]).toBeGreaterThan(2 ** -21 + 3 * 2 ** -20);
});
