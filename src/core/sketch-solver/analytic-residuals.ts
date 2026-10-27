import { isAngleOnLocalArc, localArcData } from "./arc-geometry";
import type {
  ComponentJacobian,
  Dual,
  Dual2,
  DualColumns,
} from "./automatic-differentiation";
import { dual, dual2, dualColumns } from "./automatic-differentiation";
import { normalizeAngleRadians, projectedArcData } from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import { dot2, length, subtract, zeroVector } from "./solver-geometry";
import type { ScalarConstraintRecord } from "./system-types";
import type { ConstraintId, DimensionId } from "@/contracts/shared/ids";
import type {
  SketchEntityDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import type { ProjectedSketchReferenceGeometry } from "@/contracts/solver/schema";

export function createNumericalScalarConstraint(input: {
  id: ConstraintId | DimensionId;
  targetKind: "constraint" | "dimension";
  parameterCount: number;
  affectedVariableIndices?: readonly number[];
  evaluateResidual(values: Float64Array): number;
  evaluateComponents?(values: Float64Array): readonly number[];
  /** Of `evaluateComponents`, or of `[evaluateResidual]` without it. */
  evaluateComponentJacobian(values: Float64Array): ComponentJacobian;
  hingeComponentIndices?: readonly number[];
}): ScalarConstraintRecord {
  const indices = input.affectedVariableIndices;
  return {
    id: input.id,
    targetKind: input.targetKind,
    evaluateComponents:
      input.evaluateComponents ??
      ((values) => [input.evaluateResidual(values)]),
    evaluateComponentJacobian: input.evaluateComponentJacobian,
    ...(input.hingeComponentIndices
      ? { hingeComponentIndices: input.hingeComponentIndices }
      : {}),
    evaluate(values) {
      const residualValue = input.evaluateResidual(values);
      const gradient = zeroVector(input.parameterCount);
      const step = 1e-6;
      const loopIndices = indices ?? values;

      for (let i = 0; i < loopIndices.length; i += 1) {
        const index = indices ? indices[i]! : i;
        const saved = values[index]!;
        values[index] = saved + step;
        const nextLoss = 0.5 * input.evaluateResidual(values) ** 2;
        values[index] = saved - step;
        const previousLoss = 0.5 * input.evaluateResidual(values) ** 2;
        values[index] = saved;
        gradient[index] = (nextLoss - previousLoss) / (2 * step);
      }

      return { residual: 0.5 * residualValue * residualValue, gradient };
    },
  };
}

// cadara-p4r5.1: the dual twins of the geometry helpers above, for the rows'
// analytic component Jacobians. Each mirrors its plain helper's operations
// and branches exactly (see `solver-core-jacobian.ts`).

export function unitVectorDual(start: Dual2, end: Dual2): Dual2 | null {
  const delta = dual2.sub(end, start);
  const norm = dual2.length(delta);
  return norm.value < DEGENERATE_NORM_EPSILON
    ? null
    : [dual.div(delta[0], norm), dual.div(delta[1], norm)];
}

export function pointLineSignedDistanceDual(
  point: Dual2,
  start: Dual2,
  end: Dual2,
): Dual {
  const unit = unitVectorDual(start, end);
  return unit
    ? dual2.cross(dual2.sub(point, start), unit)
    : dual.constantLike(point[0], 0);
}

export function lineNormalDirectionResidualDual(
  lineStart: Dual2,
  lineEnd: Dual2,
  contactPoint: Dual2,
  center: Dual2,
): Dual {
  const lineUnit = unitVectorDual(lineStart, lineEnd);
  const radialUnit = unitVectorDual(center, contactPoint);
  return lineUnit && radialUnit
    ? dual2.cross(lineUnit, radialUnit)
    : dual.constantLike(center[0], 0);
}

export function lineParallelResidualDual(
  firstStart: Dual2,
  firstEnd: Dual2,
  secondStart: Dual2,
  secondEnd: Dual2,
): Dual {
  const firstUnit = unitVectorDual(firstStart, firstEnd);
  const secondUnit = unitVectorDual(secondStart, secondEnd);
  return firstUnit && secondUnit
    ? dual2.cross(firstUnit, secondUnit)
    : dual.constantLike(firstStart[0], Number.POSITIVE_INFINITY);
}

export function midpointDual(start: Dual2, end: Dual2): Dual2 {
  return [
    dual.scale(dual.add(start[0], end[0]), 0.5),
    dual.scale(dual.add(start[1], end[1]), 0.5),
  ];
}

export function lineAngleRadiansDual(
  firstStart: Dual2,
  firstEnd: Dual2,
  secondStart: Dual2,
  secondEnd: Dual2,
): Dual | null {
  const firstDelta = dual2.sub(firstEnd, firstStart);
  const secondDelta = dual2.sub(secondEnd, secondStart);
  const denominator = dual2.cross(firstDelta, secondDelta);
  const center: Dual2 | null =
    Math.abs(denominator.value) <= DEGENERATE_NORM_EPSILON
      ? null
      : (() => {
          const delta = dual2.sub(secondStart, firstStart);
          const t = dual.div(dual2.cross(delta, secondDelta), denominator);
          return [
            dual.add(firstStart[0], dual.mul(firstDelta[0], t)),
            dual.add(firstStart[1], dual.mul(firstDelta[1], t)),
          ];
        })();
  const firstUnit = lineAngleDirectionFromCenterDual(
    firstStart,
    firstEnd,
    center,
  );
  const secondUnit = lineAngleDirectionFromCenterDual(
    secondStart,
    secondEnd,
    center,
  );
  return firstUnit && secondUnit
    ? dual.acosClamped(dual2.dot(firstUnit, secondUnit))
    : null;
}

export function lineAngleDirectionFromCenterDual(
  start: Dual2,
  end: Dual2,
  center: Dual2 | null,
): Dual2 | null {
  const lineUnit = unitVectorDual(start, end);
  if (!lineUnit || !center) return lineUnit;
  const towardMidpoint = unitVectorDual(center, [
    dual.scale(dual.add(start[0], end[0]), 0.5),
    dual.scale(dual.add(start[1], end[1]), 0.5),
  ]);
  if (!towardMidpoint) return lineUnit;
  return dual2.dot(towardMidpoint, lineUnit).value >= 0
    ? lineUnit
    : [dual.neg(lineUnit[0]), dual.neg(lineUnit[1])];
}

/** A local or projected arc; `plain` is its value for the sweep predicates. */
export type ArcDual = {
  center: Dual2;
  radius: Dual;
  startAngle: Dual;
  endAngle: Dual;
  startPosition: Dual2;
  endPosition: Dual2;
  plain: ReturnType<typeof localArcData>;
};

export function localArcDataDual(input: {
  center: Dual2;
  radius: Dual;
  startAngle: Dual;
  endAngle: Dual;
  sweepDirection: Extract<
    SketchEntityDefinition,
    { kind: "arc" }
  >["sweepDirection"];
}): ArcDual {
  const position = (angle: Dual): Dual2 => [
    dual.add(input.center[0], dual.mul(dual.cos(angle), input.radius)),
    dual.add(input.center[1], dual.mul(dual.sin(angle), input.radius)),
  ];
  return {
    center: input.center,
    radius: input.radius,
    startAngle: input.startAngle,
    endAngle: input.endAngle,
    startPosition: position(input.startAngle),
    endPosition: position(input.endAngle),
    plain: localArcData({
      center: dual2.values(input.center),
      radius: input.radius.value,
      startAngle: input.startAngle.value,
      endAngle: input.endAngle.value,
      sweepDirection: input.sweepDirection,
    }),
  };
}

export function projectedArcDataDual(
  like: Dual,
  geometry: Extract<ProjectedSketchReferenceGeometry, { kind: "arc" }>,
): ArcDual {
  const plain = projectedArcData(geometry);
  const constant = (value: number) => dual.constantLike(like, value);
  return {
    center: [constant(plain.center[0]), constant(plain.center[1])],
    radius: constant(plain.radius),
    startAngle: constant(plain.startAngle),
    endAngle: constant(plain.endAngle),
    startPosition: [
      constant(plain.startPosition[0]),
      constant(plain.startPosition[1]),
    ],
    endPosition: [
      constant(plain.endPosition[0]),
      constant(plain.endPosition[1]),
    ],
    plain,
  };
}

/** The angle of `point` about the arc's centre (its start angle at the centre). */
export function arcContactAngleDual(point: Dual2, arc: ArcDual): Dual {
  const offset = dual2.sub(point, arc.center);
  return dual2.length(offset).value > DEGENERATE_NORM_EPSILON
    ? dual.atan2(offset[1], offset[0])
    : arc.startAngle;
}

export function arcCirclePointDual(arc: ArcDual, angle: Dual): Dual2 {
  return [
    dual.add(arc.center[0], dual.mul(dual.cos(angle), arc.radius)),
    dual.add(arc.center[1], dual.mul(dual.sin(angle), arc.radius)),
  ];
}

/** `nearestPointOnLocalArcSweep` / `nearestPointOnProjectedArcSweep`. */
export function nearestPointOnArcSweepDual(point: Dual2, arc: ArcDual): Dual2 {
  const angle = arcContactAngleDual(point, arc);
  if (isAngleOnLocalArc(angle.value, arc.plain))
    return arcCirclePointDual(arc, angle);
  return dual2.length(dual2.sub(point, arc.startPosition)).value <=
    dual2.length(dual2.sub(point, arc.endPosition)).value
    ? arc.startPosition
    : arc.endPosition;
}

/** `localArcSweepViolation` / `projectedArcSweepViolation`. */
export function arcSweepViolationDual(point: Dual2, arc: ArcDual): Dual {
  const angle = arcContactAngleDual(point, arc);
  if (isAngleOnLocalArc(angle.value, arc.plain))
    return dual.constantLike(angle, 0);
  const circlePoint = arcCirclePointDual(arc, angle);
  return dual.min(
    dual2.length(dual2.sub(circlePoint, arc.startPosition)),
    dual2.length(dual2.sub(circlePoint, arc.endPosition)),
  );
}

/**
 * cadara-p4r5.1: the explicit form of an arc-sweep hinge (`arcSweepViolation`
 * is 0 inside the sweep, so its derivative is undefined at the arc's ends):
 * `contact` lies inside the sweep iff both returned values are ≥ 0. Each is
 * the angular margin from one sweep end, measured about the sweep's middle,
 * so both are smooth except at the antipode of that middle.
 */
export function arcSweepMarginsDual(
  contact: Dual2,
  arc: ArcDual,
): readonly [start: Dual, end: Dual] {
  const direction = arc.plain.sweepDirection === "counterClockwise" ? 1 : -1;
  const angle = arcContactAngleDual(contact, arc);
  // The sweep is `arcSweepOffset(end, start)`; its derivative is the
  // directed difference of the end angles (its 2π wrap is constant).
  const halfSweep = dual.scale(
    dual.add(
      dual.scale(dual.sub(arc.endAngle, arc.startAngle), direction),
      dual.constantLike(
        angle,
        arc.plain.sweep -
          direction * (arc.plain.endAngle - arc.plain.startAngle),
      ),
    ),
    0.5,
  );
  const offset = dual.sub(
    dual.scale(dual.sub(angle, arc.startAngle), direction),
    halfSweep,
  );
  const wrapped = dual.add(
    offset,
    dual.constantLike(
      offset,
      normalizeAngleRadians(offset.value + Math.PI) - Math.PI - offset.value,
    ),
  );
  return [dual.add(halfSweep, wrapped), dual.sub(halfSweep, wrapped)];
}

export function localCircleTangencyContactsDual(
  first: { center: Dual2; radius: Dual },
  second: { center: Dual2; radius: Dual },
  relation: "external" | "internal",
): [Dual2, Dual2] {
  const centerDelta = dual2.sub(second.center, first.center);
  const centerDistance = dual2.length(centerDelta);
  const direction: Dual2 =
    centerDistance.value > DEGENERATE_NORM_EPSILON
      ? [
          dual.div(centerDelta[0], centerDistance),
          dual.div(centerDelta[1], centerDistance),
        ]
      : [
          dual.constantLike(centerDistance, 1),
          dual.constantLike(centerDistance, 0),
        ];
  const along = (
    center: Dual2,
    radius: Dual,
    sign: number,
    combineAxis: (left: Dual, right: Dual) => Dual,
  ): Dual2 => [
    combineAxis(center[0], dual.scale(dual.mul(direction[0], radius), sign)),
    combineAxis(center[1], dual.scale(dual.mul(direction[1], radius), sign)),
  ];
  if (relation === "external")
    return [
      along(first.center, first.radius, 1, dual.add),
      along(second.center, second.radius, 1, dual.sub),
    ];
  const contactSign = first.radius.value >= second.radius.value ? 1 : -1;
  return [
    along(first.center, first.radius, contactSign, dual.add),
    along(second.center, second.radius, contactSign, dual.add),
  ];
}

/**
 * cadara-p4r5.1: the Jacobian of a closest-point residual r = P − C(u*),
 * where u* minimises |P − C(u)| on a cubic span. With g(u) = (C − P)·C′ = 0
 * at an interior minimum, du = −[(dC − dP)·C′ + (C − P)·dC′] / (C′·C′ +
 * (C − P)·C″) and dr = dP − dC − C′·du. At a domain end where g is
 * not ≈ 0 the minimum is clamped there and du = 0. (Orthogonality alone
 * cannot decide it: near satisfaction |r| is tiny and the search's
 * location noise dominates g.) `dP`, `dC` and `dC′` are per column (dC, dC′
 * at fixed u).
 */
export function closestPointResidualDuals(input: {
  residual: SketchPoint2D;
  atDomainEnd: boolean;
  first: SketchPoint2D;
  second: SketchPoint2D;
  columns: number;
  dPoint(column: number): SketchPoint2D;
  dCurve(column: number): SketchPoint2D;
  dFirst(column: number): SketchPoint2D;
}): [Dual, Dual] {
  const { residual, first, second } = input;
  const curveMinusPoint: SketchPoint2D = [-residual[0], -residual[1]];
  const interior =
    !input.atDomainEnd ||
    Math.abs(dot2(curveMinusPoint, first)) <=
      1e-3 * length(residual) * length(first);
  const curvature = dot2(first, first) + dot2(curveMinusPoint, second);
  const x = new Float64Array(input.columns);
  const y = new Float64Array(input.columns);
  for (let column = 0; column < input.columns; column += 1) {
    const dPoint = input.dPoint(column);
    const dCurve = input.dCurve(column);
    const du = interior
      ? -(
          dot2(subtract(dCurve, dPoint), first) +
          dot2(curveMinusPoint, input.dFirst(column))
        ) / curvature
      : 0;
    x[column] = dPoint[0] - dCurve[0] - first[0] * du;
    y[column] = dPoint[1] - dCurve[1] - first[1] * du;
  }
  return [
    { value: residual[0], derivative: x },
    { value: residual[1], derivative: y },
  ];
}

/** cadara-p4r5.1: a row's analytic component Jacobian from its dual twin. */
export function componentJacobianOver(
  parameterCount: number,
  support: readonly number[],
  components: (columns: DualColumns) => readonly Dual[],
) {
  return (values: Float64Array): ComponentJacobian => {
    const columns = dualColumns(values, support);
    return columns.jacobian(components(columns), parameterCount);
  };
}
