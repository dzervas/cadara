import type { SketchPoint2D } from "@/contracts/sketch/schema";

/**
 * The one support formula of a point-defined arc (T08b-e [TECH E7]): centre,
 * start and end points verbatim and radius = `Math.hypot(start − centre)`,
 * the solver's driven-arc projection `length(subtract(start, center))`
 * (`solver-core.ts`) and region input's `arcDraft`. The offset-chain
 * resolver builds its joint arcs with it; the tube certifier never trusts it
 * and certifies the arc with the radius it is given.
 */
export interface CanonicalArcSupport {
  readonly center: SketchPoint2D;
  readonly start: SketchPoint2D;
  readonly end: SketchPoint2D;
  readonly radius: number;
  readonly sweepDirection: "clockwise" | "counterClockwise";
}

/** Exact binary64 → BigInt scaled by 2^1074 (every finite binary64 is an integer there). */
const bits = new DataView(new ArrayBuffer(8));
function scaled(value: number) {
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0);
  const exponent = Number((raw >> 52n) & 0x7ffn);
  const fraction = raw & ((1n << 52n) - 1n);
  const significand = exponent === 0 ? fraction : fraction | (1n << 52n);
  const magnitude = significand << BigInt(Math.max(exponent, 1) - 1);
  return raw >> 63n ? -magnitude : magnitude;
}

type Direction = readonly [bigint, bigint];
/** Deepest recursion of the balanced split: at most 16 leaves. */
const SEED_ARC_SPLIT_DEPTH = 4;

/**
 * The rule-B′ leaf partition of one seed arc (T08b-f [TECH F2] as amended by
 * review R1): recursive balanced near-bisection of the σ-oriented wedge from
 * a = start − centre to b = end − centre, sharing every interior split
 * direction with the reference wedge from s = sourceStart − centre to e =
 * sourceEnd − centre. A wedge [u, v] (emitted) with its reference [u′, v′] is
 * one leaf iff BOTH satisfy σ(u × v) > 0 and 2u·v > σ(u × v) (a sweep below
 * atan 2 ≈ 63.4°), exactly; otherwise it splits at the binary64 [cos, sin] of
 * the float half-angle, admitted only when strictly inside both wedges.
 * `minimumLeaves` = 2 forces the first split (the arcs of a two-piece
 * closed chain: each terminal leaf then reaches only its own corner, so a
 * joint query never sees the other corner's crossing). Returns the interior
 * split directions in natural order ([] for one leaf), or null for a zero
 * vector, an exactly full turn (a ∥ b in the same sense) or a failed
 * admission within depth 4. Bounded BigInt (unmetered, the T4 pattern): it
 * only CHOOSES the partition; the tube certifier recomputes it and re-proves
 * every leaf with its own metered exact predicates.
 */
export function seedArcLeafSplits(
  center: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: CanonicalArcSupport["sweepDirection"],
  sourceStart: SketchPoint2D,
  sourceEnd: SketchPoint2D,
  minimumLeaves: 1 | 2 = 1,
): SketchPoint2D[] | null {
  const sigma = sweepDirection === "counterClockwise" ? 1n : -1n;
  const c = [scaled(center[0]), scaled(center[1])] as const;
  const relative = (point: SketchPoint2D): Direction => [
    scaled(point[0]) - c[0],
    scaled(point[1]) - c[1],
  ];
  const direction = (point: SketchPoint2D): Direction => [
    scaled(point[0]),
    scaled(point[1]),
  ];
  const cross = (u: Direction, v: Direction) =>
    sigma * (u[0] * v[1] - u[1] * v[0]);
  const dot = (u: Direction, v: Direction) => u[0] * v[0] + u[1] * v[1];
  const zero = (u: Direction) => u[0] === 0n && u[1] === 0n;
  const a = relative(start);
  const b = relative(end);
  const s = relative(sourceStart);
  const e = relative(sourceEnd);
  if ([a, b, s, e].some(zero)) return null;
  if (cross(a, b) === 0n && dot(a, b) > 0n) return null;
  const leaf = (u: Direction, v: Direction) => {
    const turn = cross(u, v);
    return turn > 0n && 2n * dot(u, v) > turn;
  };
  const angle = (u: SketchPoint2D) => Math.atan2(u[1], u[0]);
  const go = (
    emitted: readonly [SketchPoint2D, SketchPoint2D],
    exact: readonly [Direction, Direction, Direction, Direction],
    depth: number,
  ): SketchPoint2D[] | null => {
    const [uE, vE, uR, vR] = exact;
    if ((depth > 0 || minimumLeaves < 2) && leaf(uE, vE) && leaf(uR, vR))
      return [];
    if (depth >= SEED_ARC_SPLIT_DEPTH) return null;
    const from = angle(emitted[0]);
    let sweep =
      (sweepDirection === "counterClockwise" ? 1 : -1) *
      (angle(emitted[1]) - from);
    while (sweep <= 0) sweep += 2 * Math.PI;
    while (sweep > 2 * Math.PI) sweep -= 2 * Math.PI;
    const middle =
      from + ((sweepDirection === "counterClockwise" ? 1 : -1) * sweep) / 2;
    const split: SketchPoint2D = [Math.cos(middle), Math.sin(middle)];
    const m = direction(split);
    if (
      !(cross(uE, m) > 0n && cross(m, vE) > 0n) ||
      !(cross(uR, m) > 0n && cross(m, vR) > 0n)
    )
      return null;
    const left = go([emitted[0], split], [uE, m, uR, m], depth + 1);
    const right = left && go([split, emitted[1]], [m, vE, m, vR], depth + 1);
    return left && right ? [...left, split, ...right] : null;
  };
  return go(
    [
      [start[0] - center[0], start[1] - center[1]],
      [end[0] - center[0], end[1] - center[1]],
    ],
    [a, b, s, e],
    0,
  );
}

export function canonicalArcSupport(
  center: SketchPoint2D,
  start: SketchPoint2D,
  end: SketchPoint2D,
  sweepDirection: CanonicalArcSupport["sweepDirection"],
): CanonicalArcSupport {
  return {
    center,
    start,
    end,
    radius: Math.hypot(start[0] - center[0], start[1] - center[1]),
    sweepDirection,
  };
}
