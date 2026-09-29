import {
  evaluateSplineSpan,
  type SplinePoles,
  type SplineSpan,
  type SplineVector,
} from "./spline-geometry";

type Interval = readonly [number, number];
type IntervalVector = readonly [Interval, Interval];

export interface SplineOffsetSourceInterval {
  readonly sourceSpanIndex: number;
  readonly localInterval: readonly [number, number];
}

export interface SplineOffsetCubicSpan {
  readonly source: SplineSpan["source"];
  readonly sourceInterval: readonly [number, number];
  readonly sourceLocalInterval: readonly [number, number];
  readonly poles: SplinePoles;
  readonly differential: {
    readonly sourceInterval: readonly [number, number];
    readonly poles: SplinePoles;
  };
  /** Conservative Euclidean parameter-corresponding error certificate. */
  readonly certifiedError: number;
  /**
   * Frame-only, immutable proof metadata of this owner call; never persisted.
   * `derivative` is the owner's existing outward enclosure of the true offset
   * derivative d/du (S + distance·N) over `sourceLocalInterval`, in source-local
   * units. `sourcePoles` is the source span's pole array itself (a reference).
   * `distance` is this owner call's signed input `distance`, bitwise (−0 kept).
   * `localError` is the endpoint-local split of `certifiedError` (Q4-E1).
   * Binding to one fresh owner result is the caller's obligation: the presence
   * of this metadata never validates provenance.
   */
  readonly reference: {
    readonly derivative: IntervalVector;
    readonly sourcePoles: SplinePoles;
    readonly distance: number;
    readonly localError: SplineOffsetLocalError;
  };
}

/**
 * The two terms `certifiedError` = up(R + max πᵢ) is made of, as the outward
 * (upper) binary64 values the owner already computed. With E the emitted
 * cubic, τ its Bézier parameter, [a, b] = `sourceLocalInterval`, Bᵢ the cubic
 * Bernstein basis and O = S + d·N the true offset in source-local u:
 *
 *   |E(τ) − O(a + τ(b − a))| ≤ Σᵢ Bᵢ(τ)·πᵢ + 16·R·τ²(1 − τ)²  for τ ∈ [0, 1].
 *
 * R ≥ (b − a)⁴·‖(max|O⁽⁴⁾ₓ|, max|O⁽⁴⁾ᵧ|)‖/384 over the leaf, so the
 * componentwise Hermite remainder of the ideal Hermite cubic H is
 * ≤ 16R·τ²(1 − τ)²; πᵢ ≥ |Eᵢ − Hᵢ| (distance of emitted pole i to the
 * outward enclosure of its ideal Hermite pole). Both are 0 on the d = 0
 * branch, whose emitted cubic is the source itself.
 */
export interface SplineOffsetLocalError {
  readonly hermiteRemainder: number;
  readonly polePerturbations: readonly [number, number, number, number];
}

export type SplineOffsetFailureCode =
  | "certification-failed"
  | "source-derivative-degenerate"
  | "offset-topology-uncertain"
  | "refinement-budget-exceeded"
  | "topology-changed";

export interface SplineOffsetFailure {
  readonly ok: false;
  readonly code: SplineOffsetFailureCode;
  readonly sourceSpanIndex: number | null;
  readonly sourceLocalInterval: readonly [number, number] | null;
  readonly certifiedError?: number;
}

export type SplineOffsetResult =
  | {
      readonly ok: true;
      readonly spans: readonly SplineOffsetCubicSpan[];
      readonly topology: readonly SplineOffsetSourceInterval[];
    }
  | SplineOffsetFailure;

export interface SplineOffsetInput {
  /** Ordered spans (or a contiguous subset) from one fresh, valid reconstruction; never persisted, projected, or mixed across revisions. */
  readonly spans: readonly SplineSpan[];
  readonly distance: number;
  readonly distanceDifferential?: number;
  readonly modelingTolerance: number;
  readonly maxDepth?: number;
  readonly maxOutputSpans?: number;
  /** Prior accepted partition. A mismatch fails instead of remapping identities. */
  readonly expectedTopology?: readonly SplineOffsetSourceInterval[];
}

const buffer = new ArrayBuffer(8);
const view = new DataView(buffer);

function nextUp(value: number) {
  if (Number.isNaN(value) || value === Number.POSITIVE_INFINITY) return value;
  if (Object.is(value, -0)) value = 0;
  if (value === 0) return Number.MIN_VALUE;
  view.setFloat64(0, value, false);
  let bits = view.getBigUint64(0, false);
  bits += value > 0 ? 1n : -1n;
  view.setBigUint64(0, bits, false);
  return view.getFloat64(0, false);
}

function nextDown(value: number) {
  return -nextUp(-value);
}

const exact = (value: number): Interval => [value, value];
const addI = (left: Interval, right: Interval): Interval => [
  nextDown(left[0] + right[0]),
  nextUp(left[1] + right[1]),
];
const negateI = (value: Interval): Interval => [-value[1], -value[0]];
const subtractI = (left: Interval, right: Interval): Interval =>
  addI(left, negateI(right));
const multiplyI = (left: Interval, right: Interval): Interval => {
  const values = [
    left[0] * right[0],
    left[0] * right[1],
    left[1] * right[0],
    left[1] * right[1],
  ];
  return [nextDown(Math.min(...values)), nextUp(Math.max(...values))];
};
const divideI = (left: Interval, right: Interval): Interval =>
  multiplyI(left, [nextDown(1 / right[1]), nextUp(1 / right[0])]);
const scaleI = (value: Interval, scalar: number): Interval =>
  multiplyI(value, exact(scalar));
const squareI = (value: Interval): Interval => {
  const high = Math.max(value[0] * value[0], value[1] * value[1]);
  const low =
    value[0] <= 0 && value[1] >= 0
      ? 0
      : Math.min(value[0] * value[0], value[1] * value[1]);
  return [Math.max(0, nextDown(low)), nextUp(high)];
};
const addV = (left: IntervalVector, right: IntervalVector): IntervalVector => [
  addI(left[0], right[0]),
  addI(left[1], right[1]),
];
const scaleV = (value: IntervalVector, scalar: number): IntervalVector => [
  scaleI(value[0], scalar),
  scaleI(value[1], scalar),
];
const multiplyVS = (
  value: IntervalVector,
  scalar: Interval,
): IntervalVector => [multiplyI(value[0], scalar), multiplyI(value[1], scalar)];
const dotI = (left: IntervalVector, right: IntervalVector): Interval =>
  addI(multiplyI(left[0], right[0]), multiplyI(left[1], right[1]));
const rotateI = (value: IntervalVector): IntervalVector => [
  negateI(value[1]),
  value[0],
];
const rotate = ([x, y]: SplineVector): SplineVector => [-y, x];
const add = (left: SplineVector, right: SplineVector): SplineVector => [
  left[0] + right[0],
  left[1] + right[1],
];
const subtract = (left: SplineVector, right: SplineVector): SplineVector => [
  left[0] - right[0],
  left[1] - right[1],
];
const scale = (value: SplineVector, scalar: number): SplineVector => [
  value[0] * scalar,
  value[1] * scalar,
];
const dot = (left: SplineVector, right: SplineVector) =>
  left[0] * right[0] + left[1] * right[1];
const finiteVector = (value: SplineVector) => value.every(Number.isFinite);

function restrictBernstein(
  controls: readonly Interval[],
  [a, b]: Interval,
): Interval {
  const split = (values: readonly Interval[], t: Interval) => {
    const levels: Interval[][] = [
      values.map((value) => [...value] as Interval),
    ];
    const left: Interval[] = [levels[0]![0]!];
    const right: Interval[] = [levels[0]!.at(-1)!];
    const complement = subtractI(exact(1), t);
    while (levels.at(-1)!.length > 1) {
      const prior = levels.at(-1)!;
      const next = prior
        .slice(0, -1)
        .map((value, index) =>
          addI(multiplyI(value, complement), multiplyI(prior[index + 1]!, t)),
        );
      levels.push(next);
      left.push(next[0]!);
      right.unshift(next.at(-1)!);
    }
    return [left, right] as const;
  };
  let restricted = b === 1 ? [...controls] : split(controls, exact(b))[0];
  if (a !== 0) restricted = split(restricted, divideI(exact(a), exact(b)))[1];
  return [
    Math.min(...restricted.map((value) => value[0])),
    Math.max(...restricted.map((value) => value[1])),
  ];
}

function polynomialDerivativeRanges(
  poles: SplinePoles,
  interval: Interval,
): { v: IntervalVector; first: IntervalVector; second: IntervalVector } {
  const component = (axis: 0 | 1) => {
    const velocity = [0, 1, 2].map((index) =>
      scaleI(
        subtractI(exact(poles[index + 1]![axis]), exact(poles[index]![axis])),
        3,
      ),
    );
    const first = [0, 1].map((index) =>
      scaleI(subtractI(velocity[index + 1]!, velocity[index]!), 2),
    );
    const second = subtractI(first[1]!, first[0]!);
    return {
      v: restrictBernstein(velocity, interval),
      first: restrictBernstein(first, interval),
      second,
    };
  };
  const x = component(0),
    y = component(1);
  return {
    v: [x.v, y.v],
    first: [x.first, y.first],
    second: [x.second, y.second],
  };
}

function positiveDyadic(value: number) {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  view.setFloat64(0, value, false);
  const bits = view.getBigUint64(0, false);
  const fraction = bits & ((1n << 52n) - 1n);
  const encodedExponent = Number((bits >> 52n) & 0x7ffn);
  return encodedExponent === 0
    ? { significand: fraction, exponent: -1074 }
    : {
        significand: (1n << 52n) | fraction,
        exponent: encodedExponent - 1023 - 52,
      };
}

function compareDyadics(
  leftSignificand: bigint,
  leftExponent: number,
  rightSignificand: bigint,
  rightExponent: number,
) {
  const exponent = Math.min(leftExponent, rightExponent);
  const left = leftSignificand << BigInt(leftExponent - exponent);
  const right = rightSignificand << BigInt(rightExponent - exponent);
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Exact comparison of two represented dyadics; Math.sqrt is only a seed. */
function compareSquareToValue(candidate: number, value: number) {
  const candidateDyadic = positiveDyadic(candidate);
  const valueDyadic = positiveDyadic(value);
  if (!candidateDyadic || !valueDyadic)
    throw new RangeError("positive finite dyadics required");
  return compareDyadics(
    candidateDyadic.significand * candidateDyadic.significand,
    candidateDyadic.exponent * 2,
    valueDyadic.significand,
    valueDyadic.exponent,
  );
}

function sqrtBounds(value: number): Interval | null {
  if (!(value > 0) || !Number.isFinite(value)) return null;
  let lower = Math.sqrt(value);
  if (!(lower > 0) || !Number.isFinite(lower)) return null;
  while (compareSquareToValue(lower, value) > 0) lower = nextDown(lower);
  for (;;) {
    const next = nextUp(lower);
    if (!Number.isFinite(next) || compareSquareToValue(next, value) > 0) break;
    lower = next;
  }
  return compareSquareToValue(lower, value) === 0
    ? [lower, lower]
    : [lower, nextUp(lower)];
}

function sqrtInterval(value: Interval): Interval | null {
  const lower = sqrtBounds(value[0]);
  const upper = sqrtBounds(value[1]);
  return lower && upper ? [lower[0], upper[1]] : null;
}

function reciprocalInterval(value: Interval): Interval | null {
  if (!(value[0] > 0)) return null;
  const result: Interval = [nextDown(1 / value[1]), nextUp(1 / value[0])];
  return result.every(Number.isFinite) ? result : null;
}

function intervalPower(value: Interval, exponent: number) {
  let result = exact(1);
  for (let index = 0; index < exponent; index += 1)
    result = multiplyI(result, value);
  return result;
}

function containsZeroVector(value: IntervalVector) {
  return (
    value[0][0] <= 0 && value[0][1] >= 0 && value[1][0] <= 0 && value[1][1] >= 0
  );
}

function certify(
  span: SplineSpan,
  interval: Interval,
  distance: number,
):
  | { ok: true; error: number; offsetFirst: IntervalVector }
  | {
      ok: false;
      code: Exclude<
        SplineOffsetFailureCode,
        "refinement-budget-exceeded" | "topology-changed"
      >;
    } {
  const { v, first, second } = polynomialDerivativeRanges(span.poles, interval);
  const g = addI(squareI(v[0]), squareI(v[1]));
  const nonnegativeG: Interval = [Math.max(0, g[0]), g[1]];
  if (!(nonnegativeG[0] > 0))
    return { ok: false, code: "source-derivative-degenerate" };

  const g1 = scaleI(dotI(v, first), 2);
  const g2 = scaleI(addI(dotI(first, first), dotI(v, second)), 2);
  const g3 = scaleI(dotI(first, second), 6);
  const g4 = scaleI(dotI(second, second), 6);
  const rootG = sqrtInterval(nonnegativeG);
  const q = rootG && reciprocalInterval(rootG);
  if (!q) return { ok: false, code: "certification-failed" };
  const p3 = intervalPower(q, 3);
  const p5 = intervalPower(q, 5);
  const p7 = intervalPower(q, 7);
  const p9 = intervalPower(q, 9);

  const q1 = scaleI(multiplyI(p3, g1), -1 / 2);
  const q2 = addI(
    scaleI(multiplyI(p5, squareI(g1)), 3 / 4),
    scaleI(multiplyI(p3, g2), -1 / 2),
  );
  const q3 = addI(
    addI(
      scaleI(multiplyI(p7, multiplyI(squareI(g1), g1)), -15 / 8),
      scaleI(multiplyI(p5, multiplyI(g1, g2)), 9 / 4),
    ),
    scaleI(multiplyI(p3, g3), -1 / 2),
  );
  const q4 = addI(
    addI(
      addI(
        scaleI(multiplyI(p9, squareI(squareI(g1))), 105 / 16),
        scaleI(multiplyI(p7, multiplyI(squareI(g1), g2)), -45 / 4),
      ),
      scaleI(multiplyI(p5, squareI(g2)), 9 / 4),
    ),
    addI(
      scaleI(multiplyI(p5, multiplyI(g1, g3)), 3),
      scaleI(multiplyI(p3, g4), -1 / 2),
    ),
  );
  const normalFourth = rotateI(
    addV(
      addV(multiplyVS(second, scaleI(q2, 6)), multiplyVS(first, scaleI(q3, 4))),
      multiplyVS(v, q4),
    ),
  );
  const offsetFourth = scaleV(normalFourth, distance);

  const inverseSpeed = q;
  const inverseSpeedCubed = p3;
  const normalFirst = addV(
    multiplyVS(first, inverseSpeed),
    scaleV(multiplyVS(v, multiplyI(dotI(v, first), inverseSpeedCubed)), -1),
  );
  const offsetFirst = addV(v, scaleV(rotateI(normalFirst), distance));
  if (containsZeroVector(offsetFirst))
    return { ok: false, code: "offset-topology-uncertain" };

  const maxima: SplineVector = [
    Math.max(Math.abs(offsetFourth[0][0]), Math.abs(offsetFourth[0][1])),
    Math.max(Math.abs(offsetFourth[1][0]), Math.abs(offsetFourth[1][1])),
  ];
  const normSquared = addI(
    squareI(exact(maxima[0])),
    squareI(exact(maxima[1])),
  );
  const norm = sqrtInterval([
    Math.max(Number.MIN_VALUE, normSquared[0]),
    normSquared[1],
  ]);
  const width = subtractI(exact(interval[1]), exact(interval[0]));
  const numerator = norm && multiplyI(intervalPower(width, 4), norm);
  const errorInterval = numerator && divideI(numerator, exact(384));
  const error = errorInterval?.[1];
  if (
    error === undefined ||
    !Number.isFinite(error) ||
    ![q1, q2, q3, q4].flat().every(Number.isFinite)
  )
    return { ok: false, code: "certification-failed" };
  return { ok: true, error, offsetFirst };
}

function offsetEndpoint(
  span: SplineSpan,
  u: number,
  distance: number,
  distanceDifferential: number,
) {
  const evaluated = evaluateSplineSpan(span, { kind: "local", value: u });
  const v = evaluated.first;
  const a = evaluated.second;
  const dv = evaluated.differential.first;
  const da = evaluated.differential.second;
  const speed = Math.hypot(...v);
  if (!(speed > 0) || !Number.isFinite(speed)) return null;
  const speed3 = speed ** 3;
  const speed5 = speed ** 5;
  const normal = scale(rotate(v), 1 / speed);
  const normalDifferential = rotate(
    subtract(scale(dv, 1 / speed), scale(v, dot(v, dv) / speed3)),
  );
  const k = dot(v, a);
  const tangentNormal = subtract(scale(a, 1 / speed), scale(v, k / speed3));
  const dk = dot(dv, a) + dot(v, da);
  const tangentNormalDifferential = subtract(
    subtract(
      subtract(scale(da, 1 / speed), scale(a, dot(v, dv) / speed3)),
      add(scale(dv, k / speed3), scale(v, dk / speed3)),
    ),
    scale(v, (-3 * k * dot(v, dv)) / speed5),
  );
  const position = add(evaluated.position, scale(normal, distance));
  const first = add(v, scale(rotate(tangentNormal), distance));
  const positionDifferential = add(
    evaluated.differential.position,
    add(
      scale(normal, distanceDifferential),
      scale(normalDifferential, distance),
    ),
  );
  const firstDifferential = add(
    dv,
    add(
      scale(rotate(tangentNormal), distanceDifferential),
      scale(rotate(tangentNormalDifferential), distance),
    ),
  );
  return [position, first, positionDifferential, firstDifferential] as const;
}

function intervalOffsetEndpoint(
  span: SplineSpan,
  u: number,
  distance: number,
): readonly [IntervalVector, IntervalVector] | null {
  const local: Interval = [u, u];
  const position: IntervalVector = [0, 1].map((axis) =>
    restrictBernstein(
      span.poles.map((pole) => exact(pole[axis]!)),
      local,
    ),
  ) as unknown as IntervalVector;
  const { v, first } = polynomialDerivativeRanges(span.poles, local);
  const g = addI(squareI(v[0]), squareI(v[1]));
  const root = sqrtInterval([Math.max(Number.MIN_VALUE, g[0]), g[1]]);
  const inverse = root && reciprocalInterval(root);
  if (!inverse) return null;
  const inverseCubed = intervalPower(inverse, 3);
  const normal = multiplyVS(rotateI(v), inverse);
  const tangentNormal = addV(
    multiplyVS(first, inverse),
    scaleV(multiplyVS(v, multiplyI(dotI(v, first), inverseCubed)), -1),
  );
  return [
    addV(position, scaleV(normal, distance)),
    addV(v, scaleV(rotateI(tangentNormal), distance)),
  ];
}

function upperVectorDistance(value: SplineVector, enclosure: IntervalVector) {
  const differences = enclosure.map((component, axis) =>
    subtractI(exact(value[axis]!), component),
  ) as unknown as IntervalVector;
  const maxima: SplineVector = [
    Math.max(Math.abs(differences[0][0]), Math.abs(differences[0][1])),
    Math.max(Math.abs(differences[1][0]), Math.abs(differences[1][1])),
  ];
  const squared = addI(squareI(exact(maxima[0])), squareI(exact(maxima[1])));
  const root = sqrtInterval([
    Math.max(Number.MIN_VALUE, squared[0]),
    squared[1],
  ]);
  return root?.[1] ?? Number.POSITIVE_INFINITY;
}

/**
 * Source knots whose offset endpoint pole is emitted once and reused verbatim.
 * Authority is the reconstruction provenance invariant documented on
 * `SplineSpan.source`: the same spline, consecutive span indices (or the
 * complete smooth wrap) and one shared occurrence. The exact knot coordinate
 * and point identity must then agree; a disagreement contradicts the source
 * and fails closed. Coordinates, array adjacency alone, reversed order,
 * disconnected subsets and positional (C0) closure never share a knot.
 */
function sharedSourceKnots(
  spans: readonly SplineSpan[],
):
  | { ok: true; sharesStart: readonly boolean[]; wrap: boolean }
  | { ok: false; sourceSpanIndex: number } {
  const agrees = (left: SplineSpan, right: SplineSpan) =>
    left.source.endPointId === right.source.startPointId &&
    Object.is(left.poles[3][0], right.poles[0][0]) &&
    Object.is(left.poles[3][1], right.poles[0][1]);
  const sharesStart: boolean[] = [];
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index]!;
    if (span.source.startOccurrenceId === span.source.endOccurrenceId)
      return { ok: false, sourceSpanIndex: index };
    const previous = spans[index - 1];
    const linked =
      !!previous &&
      previous.source.splineId === span.source.splineId &&
      span.source.spanIndex === previous.source.spanIndex + 1 &&
      previous.source.endOccurrenceId === span.source.startOccurrenceId;
    if (linked && !agrees(previous, span))
      return { ok: false, sourceSpanIndex: index };
    sharesStart.push(linked);
  }
  const first = spans[0];
  const last = spans.at(-1);
  const wrap =
    !!first &&
    !!last &&
    spans.length >= 2 &&
    sharesStart.slice(1).every(Boolean) &&
    spans.every(
      (span, index) =>
        span.source.splineId === first.source.splineId &&
        span.source.spanIndex === index,
    ) &&
    last.source.endOccurrenceId === first.source.startOccurrenceId;
  if (wrap && !agrees(last, first))
    return { ok: false, sourceSpanIndex: spans.length - 1 };
  return { ok: true, sharesStart, wrap };
}

/** An already emitted endpoint pole and its JVP, reused verbatim at a shared knot. */
interface SharedEndpoint {
  readonly position: SplineVector;
  readonly differential: SplineVector;
}

function makeOutput(
  span: SplineSpan,
  local: readonly [number, number],
  distance: number,
  distanceDifferential: number,
  hermiteRemainder: number,
  shared: { start?: SharedEndpoint; end?: SharedEndpoint },
  offsetFirst: IntervalVector,
): SplineOffsetCubicSpan | null {
  const start = offsetEndpoint(span, local[0], distance, distanceDifferential);
  const end = offsetEndpoint(span, local[1], distance, distanceDifferential);
  if (!start || !end) return null;
  const width = local[1] - local[0];
  // Only the endpoint pole and its JVP are shared; interior Hermite poles keep
  // this span's own position, tangent and differentials.
  const poles: SplinePoles = [
    shared.start?.position ?? start[0],
    add(start[0], scale(start[1], width / 3)),
    subtract(end[0], scale(end[1], width / 3)),
    shared.end?.position ?? end[0],
  ];
  const differentialPoles: SplinePoles = [
    shared.start?.differential ?? start[2],
    add(start[2], scale(start[3], width / 3)),
    subtract(end[2], scale(end[3], width / 3)),
    shared.end?.differential ?? end[2],
  ];
  const map = (values: readonly [number, number]) => {
    const delta = values[1] - values[0];
    return [
      local[0] === 0 ? values[0] : values[0] + local[0] * delta,
      local[1] === 1 ? values[1] : values[0] + local[1] * delta,
    ] as const;
  };
  if (!poles.every(finiteVector) || !differentialPoles.every(finiteVector))
    return null;

  const intervalStart = intervalOffsetEndpoint(span, local[0], distance);
  const intervalEnd = intervalOffsetEndpoint(span, local[1], distance);
  if (!intervalStart || !intervalEnd) return null;
  const thirdWidth = divideI(
    subtractI(exact(local[1]), exact(local[0])),
    exact(3),
  );
  const idealPoles: readonly IntervalVector[] = [
    intervalStart[0],
    addV(intervalStart[0], multiplyVS(intervalStart[1], thirdWidth)),
    addV(intervalEnd[0], scaleV(multiplyVS(intervalEnd[1], thirdWidth), -1)),
    intervalEnd[0],
  ];
  const polePerturbations = poles.map((pole, index) =>
    upperVectorDistance(pole, idealPoles[index]!),
  ) as unknown as SplineOffsetLocalError["polePerturbations"];
  const polePerturbation = Math.max(...polePerturbations);
  const certifiedError = addI(
    exact(hermiteRemainder),
    exact(polePerturbation),
  )[1];
  if (!Number.isFinite(certifiedError)) return null;
  return {
    source: span.source,
    sourceInterval: map(span.interval),
    sourceLocalInterval: local,
    poles,
    differential: {
      sourceInterval: map(span.differential.interval),
      poles: differentialPoles,
    },
    certifiedError,
    reference: Object.freeze({
      derivative: Object.freeze([
        Object.freeze(offsetFirst[0]),
        Object.freeze(offsetFirst[1]),
      ] as const),
      sourcePoles: span.poles,
      distance,
      localError: Object.freeze({
        hermiteRemainder,
        polePerturbations: Object.freeze(polePerturbations),
      }),
    }),
  };
}

/**
 * Approximates authoritative neutral cubic spans' true signed left offset.
 * Every returned cubic carries a conservative error certificate no larger
 * than `modelingTolerance`; uncertain regularity and topology fail closed.
 */
export function approximateSplineOffset(
  input: SplineOffsetInput,
): SplineOffsetResult {
  const maxDepth = input.maxDepth ?? 20;
  const maxOutputSpans = input.maxOutputSpans ?? 4096;
  if (
    !Number.isFinite(input.distance) ||
    !Number.isFinite(input.distanceDifferential ?? 0) ||
    !(input.modelingTolerance > 0) ||
    !Number.isFinite(input.modelingTolerance) ||
    !Number.isInteger(maxDepth) ||
    maxDepth < 0 ||
    !Number.isInteger(maxOutputSpans) ||
    maxOutputSpans < 1
  )
    return {
      ok: false,
      code: "certification-failed",
      sourceSpanIndex: null,
      sourceLocalInterval: null,
    };

  const knots = sharedSourceKnots(input.spans);
  if (!knots.ok)
    return {
      ok: false,
      code: "certification-failed",
      sourceSpanIndex: knots.sourceSpanIndex,
      sourceLocalInterval: [0, 1],
    };

  const output: SplineOffsetCubicSpan[] = [];
  for (
    let sourceSpanIndex = 0;
    sourceSpanIndex < input.spans.length;
    sourceSpanIndex += 1
  ) {
    const span = input.spans[sourceSpanIndex]!;
    const emittedEnd = (item: SplineOffsetCubicSpan | undefined) =>
      item && {
        position: item.poles[3],
        differential: item.differential.poles[3],
      };
    const sharedStart = knots.sharesStart[sourceSpanIndex]
      ? emittedEnd(output.at(-1))
      : undefined;
    const sharedEnd =
      knots.wrap && sourceSpanIndex === input.spans.length - 1
        ? output[0] && {
            position: output[0].poles[0],
            differential: output[0].differential.poles[0],
          }
        : undefined;
    const sharedFor = (local: readonly [number, number]) => ({
      start: local[0] === 0 ? sharedStart : undefined,
      end: local[1] === 1 ? sharedEnd : undefined,
    });
    if (
      !span.poles.every(finiteVector) ||
      !span.differential.poles.every(finiteVector) ||
      !span.interval.every(Number.isFinite) ||
      !span.differential.interval.every(Number.isFinite) ||
      !(span.interval[1] > span.interval[0])
    )
      return {
        ok: false,
        code: "certification-failed",
        sourceSpanIndex,
        sourceLocalInterval: [0, 1],
      };

    if (input.distance === 0) {
      const regular = certify(span, [0, 1], 0);
      if (regular.ok) {
        const analytic = makeOutput(
          span,
          [0, 1],
          0,
          input.distanceDifferential ?? 0,
          0,
          sharedFor([0, 1]),
          regular.offsetFirst,
        );
        if (!analytic)
          return {
            ok: false,
            code: "certification-failed",
            sourceSpanIndex,
            sourceLocalInterval: [0, 1],
          };
        output.push({
          ...analytic,
          poles: span.poles,
          differential: {
            ...analytic.differential,
            poles:
              (input.distanceDifferential ?? 0) === 0
                ? span.differential.poles
                : analytic.differential.poles,
          },
          certifiedError: 0,
          // The analytic branch computes with a literal 0; record the call's
          // bitwise d. The emitted cubic IS the source (= O), so its local
          // error terms are exactly 0, as `certifiedError` is.
          reference: Object.freeze({
            ...analytic.reference,
            distance: input.distance,
            localError: Object.freeze({
              hermiteRemainder: 0,
              polePerturbations: Object.freeze([0, 0, 0, 0] as const),
            }),
          }),
        });
        continue;
      }
    }

    const visit = (
      local: readonly [number, number],
      depth: number,
    ): SplineOffsetFailure | null => {
      const certificate = certify(span, local, input.distance);
      const result = certificate.ok
        ? makeOutput(
            span,
            local,
            input.distance,
            input.distanceDifferential ?? 0,
            certificate.error,
            sharedFor(local),
            certificate.offsetFirst,
          )
        : null;
      if (certificate.ok && !result)
        return {
          ok: false,
          code: "certification-failed",
          sourceSpanIndex,
          sourceLocalInterval: local,
        };
      if (result && result.certifiedError <= input.modelingTolerance) {
        if (output.length >= maxOutputSpans)
          return {
            ok: false,
            code: "refinement-budget-exceeded",
            sourceSpanIndex,
            sourceLocalInterval: local,
            certifiedError: result.certifiedError,
          };
        output.push(result);
        return null;
      }
      if (depth >= maxDepth) {
        return {
          ok: false,
          code: certificate.ok
            ? "refinement-budget-exceeded"
            : certificate.code,
          sourceSpanIndex,
          sourceLocalInterval: local,
          ...(certificate.ok ? { certifiedError: result!.certifiedError } : {}),
        };
      }
      const middle = local[0] + (local[1] - local[0]) / 2;
      if (middle === local[0] || middle === local[1])
        return {
          ok: false,
          code: "certification-failed",
          sourceSpanIndex,
          sourceLocalInterval: local,
        };
      return (
        visit([local[0], middle], depth + 1) ??
        visit([middle, local[1]], depth + 1)
      );
    };
    const failure = visit([0, 1], 0);
    if (failure) return failure;
  }

  const topology = output.map(({ source, sourceLocalInterval }) => ({
    sourceSpanIndex: source.spanIndex,
    localInterval: sourceLocalInterval,
  }));
  if (
    input.expectedTopology &&
    (input.expectedTopology.length !== topology.length ||
      input.expectedTopology.some((expected, index) => {
        const actual = topology[index];
        return (
          !actual ||
          expected.sourceSpanIndex !== actual.sourceSpanIndex ||
          expected.localInterval[0] !== actual.localInterval[0] ||
          expected.localInterval[1] !== actual.localInterval[1]
        );
      }))
  )
    return {
      ok: false,
      code: "topology-changed",
      sourceSpanIndex: null,
      sourceLocalInterval: null,
    };

  return { ok: true, spans: output, topology };
}
