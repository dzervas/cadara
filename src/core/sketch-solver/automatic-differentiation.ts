import type { SketchPoint2D } from "@/contracts/sketch/schema";

/**
 * cadara-p4r5.1: forward-mode dual numbers for the solver rows' analytic
 * component Jacobians. A dual carries a value and its derivative over one
 * row's columns (its support variables). Every operation computes the value
 * with the same binary64 operations, in the same order, as the plain row
 * code it mirrors, so a row's dual components equal its `evaluateComponents`
 * bitwise. A piecewise operation (|·|, a clamp, a min, an arc-sweep branch)
 * takes the derivative of the branch its value selects.
 */
export interface Dual {
  readonly value: number;
  readonly derivative: Float64Array;
}

export type Dual2 = readonly [Dual, Dual];

/**
 * The raw components of one row and their first-order Jacobian
 * ∂components/∂values: one dense row of the system's parameter count per
 * component.
 */
export interface ComponentJacobian {
  readonly components: readonly number[];
  readonly rows: readonly Float64Array[];
  /**
   * Set when the rows are not a derivative: every entry of `rows` is NaN
   * (never silent zeros). Each entry names a derived relationship the row
   * reads that failed (`failed`: in the solve's blocked set;
   * `failedDuringSolve`: fails at these values) or whose pullback is
   * singular (`derivativeUnavailable`). `components` stay the row's
   * `evaluateComponents`.
   */
  readonly unavailable?: readonly {
    readonly derivationId: string;
    readonly reason: "failed" | "failedDuringSolve" | "derivativeUnavailable";
  }[];
}

/** One row's columns: its support variables, in order. */
export interface DualColumns {
  readonly values: Float64Array;
  /** The variable `index` (a constant when it is not a column). */
  variable(index: number): Dual;
  /** The point whose coordinates are the variables `baseIndex`, `baseIndex + 1`. */
  point(baseIndex: number): Dual2;
  constant(value: number): Dual;
  constant2(point: SketchPoint2D): Dual2;
  /** A dual from a value and its derivative along each column. */
  fromColumns(value: number, derivatives: ArrayLike<number>): Dual;
  readonly support: readonly number[];
  jacobian(
    components: readonly Dual[],
    parameterCount: number,
  ): ComponentJacobian;
}

export function dualColumns(
  values: Float64Array,
  support: readonly number[],
): DualColumns {
  const columns = [...new Set(support)].sort((left, right) => left - right);
  const columnOf = new Map(columns.map((index, column) => [index, column]));
  const width = columns.length;
  const constant = (value: number): Dual => ({
    value,
    derivative: new Float64Array(width),
  });
  const variable = (index: number): Dual => {
    const derivative = new Float64Array(width);
    const column = columnOf.get(index);
    if (column !== undefined) derivative[column] = 1;
    return { value: values[index]!, derivative };
  };
  return {
    values,
    support: columns,
    variable,
    point: (baseIndex) => [variable(baseIndex), variable(baseIndex + 1)],
    constant,
    constant2: (point) => [constant(point[0]), constant(point[1])],
    fromColumns: (value, derivatives) => ({
      value,
      derivative: Float64Array.from(derivatives),
    }),
    jacobian(components, parameterCount) {
      return {
        components: components.map((component) => component.value),
        rows: components.map((component) => {
          const row = new Float64Array(parameterCount);
          columns.forEach((index, column) => {
            row[index] = component.derivative[column]!;
          });
          return row;
        }),
      };
    },
  };
}

export function combine(
  value: number,
  left: Dual,
  leftScale: number,
  right?: Dual,
  rightScale = 0,
): Dual {
  const derivative = new Float64Array(left.derivative.length);
  for (let column = 0; column < derivative.length; column += 1)
    derivative[column] =
      left.derivative[column]! * leftScale +
      (right ? right.derivative[column]! * rightScale : 0);
  return { value, derivative };
}

export const dual = {
  /** A constant over the same columns as `like`. */
  constantLike: (like: Dual, value: number): Dual => ({
    value,
    derivative: new Float64Array(like.derivative.length),
  }),
  add: (left: Dual, right: Dual) =>
    combine(left.value + right.value, left, 1, right, 1),
  sub: (left: Dual, right: Dual) =>
    combine(left.value - right.value, left, 1, right, -1),
  mul: (left: Dual, right: Dual) =>
    combine(left.value * right.value, left, right.value, right, left.value),
  div: (left: Dual, right: Dual) =>
    combine(
      left.value / right.value,
      left,
      1 / right.value,
      right,
      -left.value / (right.value * right.value),
    ),
  /** `left · k` for a constant k. */
  scale: (left: Dual, k: number) => combine(left.value * k, left, k),
  neg: (left: Dual) => combine(-left.value, left, -1),
  sqrt: (left: Dual) => {
    const value = Math.sqrt(left.value);
    return combine(value, left, value === 0 ? 0 : 0.5 / value);
  },
  abs: (left: Dual) =>
    combine(Math.abs(left.value), left, left.value < 0 ? -1 : 1),
  hypot: (x: Dual, y: Dual) => {
    const value = Math.hypot(x.value, y.value);
    return value === 0
      ? combine(value, x, 0)
      : combine(value, x, x.value / value, y, y.value / value);
  },
  atan2: (y: Dual, x: Dual) => {
    const squared = x.value * x.value + y.value * y.value;
    return combine(
      Math.atan2(y.value, x.value),
      y,
      squared === 0 ? 0 : x.value / squared,
      x,
      squared === 0 ? 0 : -y.value / squared,
    );
  },
  cos: (angle: Dual) =>
    combine(Math.cos(angle.value), angle, -Math.sin(angle.value)),
  sin: (angle: Dual) =>
    combine(Math.sin(angle.value), angle, Math.cos(angle.value)),
  /** `Math.acos(Math.max(-1, Math.min(1, x)))`; zero derivative when clamped. */
  acosClamped: (x: Dual) => {
    const clamped = Math.max(-1, Math.min(1, x.value));
    return combine(
      Math.acos(clamped),
      x,
      clamped !== x.value || Math.abs(clamped) === 1
        ? 0
        : -1 / Math.sqrt(1 - clamped * clamped),
    );
  },
  min: (left: Dual, right: Dual) =>
    Math.min(left.value, right.value) === left.value ? left : right,
};

export const dual2 = {
  sub: (left: Dual2, right: Dual2): Dual2 => [
    dual.sub(left[0], right[0]),
    dual.sub(left[1], right[1]),
  ],
  add: (left: Dual2, right: Dual2): Dual2 => [
    dual.add(left[0], right[0]),
    dual.add(left[1], right[1]),
  ],
  dot: (left: Dual2, right: Dual2) =>
    dual.add(dual.mul(left[0], right[0]), dual.mul(left[1], right[1])),
  /** `left[0]·right[1] − left[1]·right[0]`. */
  cross: (left: Dual2, right: Dual2) =>
    dual.sub(dual.mul(left[0], right[1]), dual.mul(left[1], right[0])),
  length: (point: Dual2) => dual.hypot(point[0], point[1]),
  values: (point: Dual2): SketchPoint2D => [point[0].value, point[1].value],
};
