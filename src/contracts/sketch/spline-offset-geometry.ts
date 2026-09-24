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
  | { ok: true; error: number }
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
  return { ok: true, error };
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

function makeOutput(
  span: SplineSpan,
  local: readonly [number, number],
  distance: number,
  distanceDifferential: number,
  hermiteRemainder: number,
): SplineOffsetCubicSpan | null {
  const start = offsetEndpoint(span, local[0], distance, distanceDifferential);
  const end = offsetEndpoint(span, local[1], distance, distanceDifferential);
  if (!start || !end) return null;
  const width = local[1] - local[0];
  const poles: SplinePoles = [
    start[0],
    add(start[0], scale(start[1], width / 3)),
    subtract(end[0], scale(end[1], width / 3)),
    end[0],
  ];
  const differentialPoles: SplinePoles = [
    start[2],
    add(start[2], scale(start[3], width / 3)),
    subtract(end[2], scale(end[3], width / 3)),
    end[2],
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
  const polePerturbation = Math.max(
    ...poles.map((pole, index) =>
      upperVectorDistance(pole, idealPoles[index]!),
    ),
  );
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

  const output: SplineOffsetCubicSpan[] = [];
  for (
    let sourceSpanIndex = 0;
    sourceSpanIndex < input.spans.length;
    sourceSpanIndex += 1
  ) {
    const span = input.spans[sourceSpanIndex]!;
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
