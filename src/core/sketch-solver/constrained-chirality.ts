import type { ComponentJacobian, Dual2 } from "./automatic-differentiation";
import { dual, dual2 } from "./automatic-differentiation";
import { componentJacobianOver } from "./analytic-residuals";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveProgram,
  SolverPointRecord,
} from "./system-types";

/**
 * Branch (order-type) invariants derived from the hard rows, for the
 * constrained drag step. For each hard row, every triple of the points the
 * row depends on (3 to `MAX_ROW_POINTS` of them) whose signed height is at
 * least τ/2 at the last accepted frame and whose orientation the row cannot
 * see is an invariant. Its height must keep its sign and stay at least
 * `floor` = min(τ, its height there), so a triple parked on its boundary in
 * one frame is still an invariant in the next. The row admits both
 * orientations as solutions (for example |d| − r is unchanged when a tangent
 * arc's centre is reflected across the line), so only continuity keeps the
 * drag on the accepted branch. "Cannot see" is decided by evaluating the row alone: reflecting one
 * of the triple's points across the line through the other two leaves a
 * component that depends on that point unchanged. A component that is also
 * unchanged when the point is reflected across a turned line through either
 * of the other two sees the point only through its distance to that one
 * (for example an equal-length row): that is distance blindness, not a
 * branch, so it is not an invariant. No entity kinds are read.
 */
export type ChiralityInvariant = {
  rowId: string;
  points: readonly [SolverPointRecord, SolverPointRecord, SolverPointRecord];
  sign: 1 | -1;
  floor: number;
};

const MAX_ROW_POINTS = 8;
const DEPENDENCE_STEP = 1e-3;
/** How far (radians) the line is turned about one anchor in the distance-blindness test. */
const TURNED_LINE_ANGLE = 0.3;

/** `p` reflected across the line through `anchor` with direction `direction`. */
function reflectAcross(
  p: readonly [number, number],
  anchor: readonly [number, number],
  direction: readonly [number, number],
): [number, number] {
  const length2 = direction[0] ** 2 + direction[1] ** 2;
  const t =
    ((p[0] - anchor[0]) * direction[0] + (p[1] - anchor[1]) * direction[1]) /
    length2;
  return [
    2 * (anchor[0] + t * direction[0]) - p[0],
    2 * (anchor[1] + t * direction[1]) - p[1],
  ];
}

/** Signed height of the triangle: twice its area over its longest side. */
function signedHeight(a: Dual2, b: Dual2, c: Dual2) {
  const cross = dual2.cross(dual2.sub(b, a), dual2.sub(c, a));
  const sides = [
    dual2.length(dual2.sub(b, a)),
    dual2.length(dual2.sub(c, b)),
    dual2.length(dual2.sub(a, c)),
  ];
  const longest = sides.reduce((left, right) =>
    right.value > left.value ? right : left,
  );
  return longest.value > 0 ? dual.div(cross, longest) : null;
}

function signedHeightAt(
  values: Float64Array,
  [a, b, c]: ChiralityInvariant["points"],
) {
  const at = (point: SolverPointRecord) =>
    [values[point.baseIndex]!, values[point.baseIndex + 1]!] as const;
  const [pa, pb, pc] = [at(a), at(b), at(c)];
  const cross =
    (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
  const longest = Math.max(
    Math.hypot(pb[0] - pa[0], pb[1] - pa[1]),
    Math.hypot(pc[0] - pb[0], pc[1] - pb[1]),
    Math.hypot(pa[0] - pc[0], pa[1] - pc[1]),
  );
  return longest > 0 ? cross / longest : 0;
}

function rowAdmitsReflection(
  record: ScalarConstraintRecord,
  values: Float64Array,
  points: ChiralityInvariant["points"],
) {
  const base = record.evaluateComponents(values);
  const close = (value: number, k: number) =>
    Math.abs(value - base[k]!) <= 1e-9 * (1 + Math.abs(base[k]!));
  const cos = Math.cos(TURNED_LINE_ANGLE);
  const sin = Math.sin(TURNED_LINE_ANGLE);
  for (let moved = 0; moved < 3; moved += 1) {
    const point = points[moved]!;
    const a = points[(moved + 1) % 3]!;
    const b = points[(moved + 2) % 3]!;
    const p = [values[point.baseIndex]!, values[point.baseIndex + 1]!] as const;
    const pa = [values[a.baseIndex]!, values[a.baseIndex + 1]!] as const;
    const pb = [values[b.baseIndex]!, values[b.baseIndex + 1]!] as const;
    const direction = [pb[0] - pa[0], pb[1] - pa[1]] as const;
    if (!(direction[0] ** 2 + direction[1] ** 2 > 0)) continue;
    const turned = [
      cos * direction[0] - sin * direction[1],
      sin * direction[0] + cos * direction[1],
    ] as const;
    const movedTo = ([x, y]: readonly [number, number]) => {
      const next = Float64Array.from(values);
      next[point.baseIndex] = x;
      next[point.baseIndex + 1] = y;
      return record.evaluateComponents(next);
    };
    const movedX = movedTo([p[0] + DEPENDENCE_STEP, p[1]]);
    const movedY = movedTo([p[0], p[1] + DEPENDENCE_STEP]);
    const reflected = movedTo(reflectAcross(p, pa, direction));
    const turnedAboutA = movedTo(reflectAcross(p, pa, turned));
    const turnedAboutB = movedTo(reflectAcross(p, pb, turned));
    if (
      base.some(
        (_, k) =>
          !(close(movedX[k]!, k) && close(movedY[k]!, k)) &&
          close(reflected[k]!, k) &&
          !close(turnedAboutA[k]!, k) &&
          !close(turnedAboutB[k]!, k),
      )
    )
      return true;
  }
  return false;
}

/** The invariants of `rows` at `values` (the last accepted frame). */
export function deriveChiralityInvariants(
  program: SketchCompiledSolveProgram,
  rows: readonly ScalarConstraintRecord[],
  values: Float64Array,
): ChiralityInvariant[] {
  const tau = program.modelingTolerance;
  const authority = new Set(
    program.system.parameterProjection.authorityVariableIndices,
  );
  const pointByColumn = new Map<number, SolverPointRecord>();
  for (const point of program.system.pointRecords.values()) {
    if (!authority.has(point.baseIndex) || !authority.has(point.baseIndex + 1))
      continue;
    pointByColumn.set(point.baseIndex, point);
    pointByColumn.set(point.baseIndex + 1, point);
  }
  const invariants = new Map<string, ChiralityInvariant>();
  for (const record of rows) {
    const jacobian = record.evaluateComponentJacobian(values);
    if (jacobian.unavailable) continue;
    const support = new Set<SolverPointRecord>();
    for (const row of jacobian.rows)
      row.forEach((entry, column) => {
        const point = entry !== 0 ? pointByColumn.get(column) : undefined;
        if (point) support.add(point);
      });
    const points = [...support];
    if (points.length < 3 || points.length > MAX_ROW_POINTS) continue;
    for (let i = 0; i < points.length; i += 1)
      for (let j = i + 1; j < points.length; j += 1)
        for (let k = j + 1; k < points.length; k += 1) {
          const triple = [points[i]!, points[j]!, points[k]!] as const;
          const key = triple
            .map((point) => point.baseIndex)
            .sort((left, right) => left - right)
            .join("|");
          if (invariants.has(key)) continue;
          const height = signedHeightAt(values, triple);
          if (Math.abs(height) < tau / 2) continue;
          if (!rowAdmitsReflection(record, values, triple)) continue;
          invariants.set(key, {
            rowId: record.id,
            points: triple,
            sign: height > 0 ? 1 : -1,
            floor: Math.min(tau, Math.abs(height)),
          });
        }
  }
  return [...invariants.values()];
}

/** g = sign·height − floor ≥ 0 with its analytic gradient (one component). */
export function chiralityMargin(
  program: SketchCompiledSolveProgram,
  invariant: ChiralityInvariant,
): (values: Float64Array) => ComponentJacobian {
  const [a, b, c] = invariant.points;
  const support = [a, b, c].flatMap((point) => [
    point.baseIndex,
    point.baseIndex + 1,
  ]);
  return componentJacobianOver(
    program.system.parameterCount,
    support,
    (columns) => {
      const height = signedHeight(
        columns.point(a.baseIndex),
        columns.point(b.baseIndex),
        columns.point(c.baseIndex),
      );
      return [
        height
          ? dual.sub(
              dual.scale(height, invariant.sign),
              columns.constant(invariant.floor),
            )
          : columns.fromColumns(
              Number.NaN,
              columns.support.map(() => Number.NaN),
            ),
      ];
    },
  );
}
