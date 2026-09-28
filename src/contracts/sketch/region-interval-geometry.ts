/**
 * Outward binary64 interval arithmetic, conservative boxes and certified
 * analytic signed areas for the three neutral curve forms the region
 * arrangement owner builds (endpoint segments, circles with xAxis [1, 0] and
 * cubic Bézier spans). Internal safeguards of `region-extraction.ts`: none of
 * them is a tolerance, and none can close a gap or create a contact.
 */
import type { NeutralCurve } from "@/contracts/modeling/neutral-curve-query";
import type { SplineVector } from "@/contracts/sketch/spline-geometry";

// ---------------------------------------------------------------------------
// Outward binary64 intervals (internal safeguard, never a tolerance)
// ---------------------------------------------------------------------------

export type Interval = readonly [number, number];
export type Box = { x: Interval; y: Interval };
export type IntervalPoint = readonly [Interval, Interval];

export const TAU = 2 * Math.PI;
const F64 = new Float64Array(1);
const I64 = new BigInt64Array(F64.buffer);

export function nextUp(value: number): number {
  if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return value;
  if (value === 0) return Number.MIN_VALUE;
  F64[0] = value;
  I64[0] += value > 0 ? 1n : -1n;
  return F64[0];
}

export function nextDown(value: number): number {
  return -nextUp(-value);
}

export const exact = (value: number): Interval => [value, value];
export const iv = (lo: number, hi: number): Interval => [
  nextDown(lo),
  nextUp(hi),
];
export const ivAdd = (a: Interval, b: Interval): Interval =>
  iv(a[0] + b[0], a[1] + b[1]);
export const ivSub = (a: Interval, b: Interval): Interval =>
  iv(a[0] - b[1], a[1] - b[0]);
export const ivNeg = (a: Interval): Interval => [-a[1], -a[0]];
export function ivMul(a: Interval, b: Interval): Interval {
  const products = [a[0] * b[0], a[0] * b[1], a[1] * b[0], a[1] * b[1]];
  return iv(Math.min(...products), Math.max(...products));
}
export function ivDiv(a: Interval, b: Interval): Interval | null {
  if (b[0] <= 0 && b[1] >= 0) return null;
  const quotients = [a[0] / b[0], a[0] / b[1], a[1] / b[0], a[1] / b[1]];
  return iv(Math.min(...quotients), Math.max(...quotients));
}
export const ivHull = (a: Interval, b: Interval): Interval => [
  Math.min(a[0], b[0]),
  Math.max(a[1], b[1]),
];
export const ivContainsZero = (a: Interval) => a[0] <= 0 && a[1] >= 0;
export const ivOverlap = (a: Interval, b: Interval) =>
  a[0] <= b[1] && b[0] <= a[1];
export const ivMid = (a: Interval) => a[0] + (a[1] - a[0]) / 2;

/** sin/cos over an interval: the midpoint value ± half-width (Lipschitz 1) ± evaluation error. */
function ivTrig(range: Interval, trig: (value: number) => number): Interval {
  const middle = ivMid(range);
  const half = nextUp(
    Math.max(nextUp(range[1] - middle), nextUp(middle - range[0])),
  );
  const value = trig(middle);
  const slack = nextUp(half + 4 * Number.EPSILON);
  return [
    Math.max(-1, nextDown(value - slack)),
    Math.min(1, nextUp(value + slack)),
  ];
}

export const ivCross = (a: IntervalPoint, b: IntervalPoint) =>
  ivSub(ivMul(a[0], b[1]), ivMul(a[1], b[0]));

export function boxOfPoints(points: readonly SplineVector[]): Box {
  return {
    x: [
      Math.min(...points.map((point) => point[0])),
      Math.max(...points.map((point) => point[0])),
    ],
    y: [
      Math.min(...points.map((point) => point[1])),
      Math.max(...points.map((point) => point[1])),
    ],
  };
}
export const boxHull = (a: Box, b: Box): Box => ({
  x: ivHull(a.x, b.x),
  y: ivHull(a.y, b.y),
});
export const boxesOverlap = (a: Box, b: Box) =>
  ivOverlap(a.x, b.x) && ivOverlap(a.y, b.y);
export const boxOfIntervalPoint = (point: IntervalPoint): Box => ({
  x: point[0],
  y: point[1],
});

// ---------------------------------------------------------------------------
// Interval evaluation of the three neutral forms the owner builds
// (endpoint segments, circles with xAxis [1, 0], cubic Bézier spans)
// ---------------------------------------------------------------------------

export type SegmentCurve = Extract<
  NeutralCurve,
  { kind: "line"; form: "endpointSegment" }
>;
export type CircleCurve = Extract<NeutralCurve, { kind: "circle" }>;
export type CubicCurve = Extract<NeutralCurve, { kind: "cubicBezier" }>;
export type OwnedCurve = SegmentCurve | CircleCurve | CubicCurve;

export const ivPoint = (point: SplineVector): IntervalPoint => [
  exact(point[0]),
  exact(point[1]),
];
export const ivPointSub = (
  a: IntervalPoint,
  b: IntervalPoint,
): IntervalPoint => [ivSub(a[0], b[0]), ivSub(a[1], b[1])];
const ivPointAdd = (a: IntervalPoint, b: IntervalPoint): IntervalPoint => [
  ivAdd(a[0], b[0]),
  ivAdd(a[1], b[1]),
];
const ivPointScale = (a: IntervalPoint, s: Interval): IntervalPoint => [
  ivMul(a[0], s),
  ivMul(a[1], s),
];
const ivLerp = (a: IntervalPoint, b: IntervalPoint, t: Interval) =>
  ivPointAdd(a, ivPointScale(ivPointSub(b, a), t));

function cubicLocal(curve: CubicCurve, parameter: Interval): Interval {
  const [s0, s1] = curve.sourceDomain;
  const local = ivDiv(
    ivSub(parameter, exact(s0)),
    ivSub(exact(s1), exact(s0)),
  )!;
  return [Math.max(0, local[0]), Math.min(1, local[1])];
}

/** Blossom B(a, b, c) of a cubic by interval de Casteljau. */
function cubicBlossom(
  poles: readonly IntervalPoint[],
  a: Interval,
  b: Interval,
  c: Interval,
): IntervalPoint {
  let level = poles;
  for (const t of [a, b, c]) {
    level = level.slice(1).map((pole, index) => ivLerp(level[index]!, pole, t));
  }
  return level[0]!;
}

export function curvePoint(
  curve: OwnedCurve,
  parameter: Interval,
): IntervalPoint {
  if (curve.kind === "line") {
    return ivLerp(ivPoint(curve.start), ivPoint(curve.end), parameter);
  }
  if (curve.kind === "circle") {
    const radius = exact(curve.radius);
    return [
      ivAdd(exact(curve.center[0]), ivMul(radius, ivTrig(parameter, Math.cos))),
      ivAdd(exact(curve.center[1]), ivMul(radius, ivTrig(parameter, Math.sin))),
    ];
  }
  const u = cubicLocal(curve, parameter);
  return cubicBlossom(curve.poles.map(ivPoint), u, u, u);
}

/** First and second derivative boxes (cubic: local units, a positive rescaling). */
export function curveDerivatives(
  curve: OwnedCurve,
  parameter: Interval,
): { first: IntervalPoint; second: IntervalPoint } {
  if (curve.kind === "line") {
    return {
      first: ivPointSub(ivPoint(curve.end), ivPoint(curve.start)),
      second: [exact(0), exact(0)],
    };
  }
  if (curve.kind === "circle") {
    const radius = exact(curve.radius);
    const sine = ivTrig(parameter, Math.sin);
    const cosine = ivTrig(parameter, Math.cos);
    return {
      first: [ivMul(radius, ivNeg(sine)), ivMul(radius, cosine)],
      second: [ivMul(radius, ivNeg(cosine)), ivMul(radius, ivNeg(sine))],
    };
  }
  const u = cubicLocal(curve, parameter);
  const v = ivSub(exact(1), u);
  const poles = curve.poles.map(ivPoint);
  const d = [0, 1, 2].map((index) =>
    ivPointSub(poles[index + 1]!, poles[index]!),
  );
  const first = ivPointScale(
    ivPointAdd(
      ivPointAdd(
        ivPointScale(d[0]!, ivMul(v, v)),
        ivPointScale(d[1]!, ivMul(exact(2), ivMul(u, v))),
      ),
      ivPointScale(d[2]!, ivMul(u, u)),
    ),
    exact(3),
  );
  const second = ivPointScale(
    ivPointAdd(
      ivPointScale(ivPointSub(d[1]!, d[0]!), v),
      ivPointScale(ivPointSub(d[2]!, d[1]!), u),
    ),
    exact(6),
  );
  return { first, second };
}

export function curveBox(curve: OwnedCurve): Box {
  if (curve.kind === "line") return boxOfPoints([curve.start, curve.end]);
  if (curve.kind === "cubicBezier") return boxOfPoints(curve.poles);
  const [cx, cy] = curve.center;
  const r = curve.radius;
  const full: Box = { x: iv(cx - r, cx + r), y: iv(cy - r, cy + r) };
  if (curve.sourceDomain.kind === "fullTurn") return full;
  const [lo, hi] = curve.sourceDomain.interval;
  let box = boxHull(
    boxOfIntervalPoint(curvePoint(curve, exact(lo))),
    boxOfIntervalPoint(curvePoint(curve, exact(hi))),
  );
  for (
    let k = Math.floor(lo / (Math.PI / 2)) - 1;
    k <= Math.ceil(hi / (Math.PI / 2)) + 1;
    k += 1
  ) {
    let low = k * (Math.PI / 2);
    let high = low;
    // The float multiple of π/2 is within a few ulps of the real extreme angle.
    for (let step = 0; step < 4; step += 1) {
      low = nextDown(low);
      high = nextUp(high);
    }
    if (high < lo || low > hi) continue;
    const quadrant = ((k % 4) + 4) % 4;
    const extreme: Box =
      quadrant === 0
        ? { x: [full.x[1], full.x[1]], y: exact(cy) }
        : quadrant === 1
          ? { x: exact(cx), y: [full.y[1], full.y[1]] }
          : quadrant === 2
            ? { x: [full.x[0], full.x[0]], y: exact(cy) }
            : { x: exact(cx), y: [full.y[0], full.y[0]] };
    box = boxHull(box, extreme);
  }
  return box;
}

/** ∫ x y′ over a Bernstein cubic: 3·C(3,i)·C(2,k) / (6·C(5,i+k)). */
const CUBIC_AREA_WEIGHTS = [0, 1, 2, 3].map((i) =>
  [0, 1, 2].map((k) => {
    const choose = (n: number, m: number) =>
      [...Array(m).keys()].reduce(
        (value, index) => (value * (n - index)) / (index + 1),
        1,
      );
    return (3 * choose(3, i) * choose(2, k)) / (6 * choose(5, i + k));
  }),
);

/**
 * Rigorous interval of ½∫ ((x − oₓ) dy − (y − o_y) dx) along one neutral curve
 * piece from any parameter in `from` to any parameter in `to` (either order).
 * Exact Green's-theorem forms: segment ½(p₀ × p₁); arc
 * ½[r²Δθ + r(cₓ Δsin θ − c_y Δcos θ)]; cubic the closed form over the exact
 * blossomed sub-poles. Evaluated with outward interval arithmetic only.
 *
 * Exported only so the spec's independent quadrature oracle can check it:
 * region records carry no areas, so the owner seam cannot expose them.
 */
export function certifyNeutralCurvePieceSignedArea(
  curve: NeutralCurve,
  from: readonly [number, number],
  to: readonly [number, number],
  origin: SplineVector,
): readonly [number, number] {
  const owned = curve as OwnedCurve;
  const o = ivPoint(origin);
  const half = exact(0.5);
  if (owned.kind === "line") {
    if (owned.form !== "endpointSegment")
      throw new Error("The arrangement owner only builds endpoint segments.");
    const p0 = ivPointSub(curvePoint(owned, from), o);
    const p1 = ivPointSub(curvePoint(owned, to), o);
    return ivMul(half, ivCross(p0, p1));
  }
  if (owned.kind === "circle") {
    if (owned.xAxis[0] !== 1 || owned.xAxis[1] !== 0)
      throw new Error(
        "The arrangement owner only builds circles with xAxis [1, 0].",
      );
    const r = exact(owned.radius);
    const cx = ivSub(exact(owned.center[0]), o[0]);
    const cy = ivSub(exact(owned.center[1]), o[1]);
    const sweep = ivSub(to, from);
    const deltaSin = ivSub(ivTrig(to, Math.sin), ivTrig(from, Math.sin));
    const deltaCos = ivSub(ivTrig(to, Math.cos), ivTrig(from, Math.cos));
    const total = ivAdd(
      ivMul(ivMul(r, r), sweep),
      ivMul(r, ivSub(ivMul(cx, deltaSin), ivMul(cy, deltaCos))),
    );
    return ivMul(half, total);
  }
  const u0 = cubicLocal(owned, from);
  const u1 = cubicLocal(owned, to);
  const poles = owned.poles.map((pole) => ivPointSub(ivPoint(pole), o));
  const sub = [
    cubicBlossom(poles, u0, u0, u0),
    cubicBlossom(poles, u0, u0, u1),
    cubicBlossom(poles, u0, u1, u1),
    cubicBlossom(poles, u1, u1, u1),
  ];
  let total: Interval = exact(0);
  for (let i = 0; i < 4; i += 1) {
    for (let k = 0; k < 3; k += 1) {
      const delta = ivPointSub(sub[k + 1]!, sub[k]!);
      const term = ivSub(
        ivMul(sub[i]![0], delta[1]),
        ivMul(sub[i]![1], delta[0]),
      );
      const weight = CUBIC_AREA_WEIGHTS[i]![k]!;
      total = ivAdd(total, ivMul(iv(weight, weight), term));
    }
  }
  return ivMul(half, total);
}
