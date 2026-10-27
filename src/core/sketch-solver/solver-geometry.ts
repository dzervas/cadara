import type { ArcState, CircleState, SolverPointRecord } from "./system-types";
import type {
  ConstraintStatusRecord,
  NumericDimensionDefinition as DimensionDefinition,
  DimensionStatusRecord,
  NumericSketchDefinition as SketchDefinition,
  SketchPoint2D,
  SketchSolveDiagnostic,
} from "@/contracts/sketch/schema";
import { isReferenceDimension } from "@/contracts/sketch/schema";

export function cloneValues(values: Float64Array) {
  return new Float64Array(values);
}

export function makeDiagnostic(
  code: string,
  severity: SketchSolveDiagnostic["severity"],
  message: string,
  target: SketchSolveDiagnostic["target"],
): SketchSolveDiagnostic {
  return { code, severity, message, target };
}

/**
 * T13c (D7): one `solver-requirement-unsatisfied` warning per requirement
 * whose status is `unsatisfied`, targeted at that constraint or dimension, so
 * the reason is geometry-linked and recomputed with every solve (incl. after
 * reopen). Shared with the mock solver adapter (A-7 parity).
 */
export function unsatisfiedRequirementDiagnostics(
  definition: Pick<SketchDefinition, "constraints" | "dimensions">,
  constraintStatuses: readonly ConstraintStatusRecord[],
  dimensionStatuses: readonly DimensionStatusRecord[],
): SketchSolveDiagnostic[] {
  const constraintLabels = new Map(
    definition.constraints.map((constraint) => [
      constraint.constraintId,
      constraint.label,
    ]),
  );
  const dimensionLabels = new Map(
    definition.dimensions.map((dimension) => [
      dimension.dimensionId,
      dimension.label,
    ]),
  );
  return [
    ...constraintStatuses.flatMap((entry) =>
      entry.status === "unsatisfied"
        ? [
            makeDiagnostic(
              "solver-requirement-unsatisfied",
              "warning",
              `${constraintLabels.get(entry.constraintId) ?? entry.constraintId} is not satisfied within its authored tolerance.`,
              { kind: "constraint", constraintId: entry.constraintId },
            ),
          ]
        : [],
    ),
    ...dimensionStatuses.flatMap((entry) =>
      entry.status === "unsatisfied"
        ? [
            makeDiagnostic(
              "solver-requirement-unsatisfied",
              "warning",
              `${dimensionLabels.get(entry.dimensionId) ?? entry.dimensionId} is not satisfied within its authored tolerance.`,
              { kind: "dimension", dimensionId: entry.dimensionId },
            ),
          ]
        : [],
    ),
  ];
}

/**
 * T13d (D9): a driving dimension's numeric value (references never reach
 * here; the binding kinds have none). A driving dimension without one breaks
 * the validated contract, so it throws instead of solving with NaN.
 */
export function getDrivingDimensionValue(dimension: DimensionDefinition): number {
  if (
    dimension.kind === "arcStartPointCoincident" ||
    dimension.kind === "arcEndPointCoincident"
  ) {
    return 0;
  }
  // T17p2 (F-2): a reference keeps its authored (unresolved) value.
  if (isReferenceDimension(dimension)) {
    throw new Error(
      `Reference dimension ${dimension.dimensionId} has no driving value.`,
    );
  }
  const value =
    "valueRadians" in dimension
      ? dimension.valueRadians
      : "value" in dimension
        ? dimension.value
        : undefined;
  if (value === undefined) {
    throw new Error(`Driving dimension ${dimension.dimensionId} has no value.`);
  }
  return value;
}

/**
 * T13d (D10): one info diagnostic per reference dimension whose measured
 * quantity is undefined (e.g. a line distance between non-parallel lines).
 * Never a warning or error: a reference never counts against the solve.
 * Shared with the mock solver adapter (parity).
 */
export function undefinedReferenceDimensionDiagnostics(
  definition: Pick<SketchDefinition, "dimensions">,
  dimensionStatuses: readonly DimensionStatusRecord[],
): SketchSolveDiagnostic[] {
  const labels = new Map(
    definition.dimensions.map((dimension) => [
      dimension.dimensionId,
      dimension.label,
    ]),
  );
  return dimensionStatuses.flatMap((entry) =>
    entry.status === "driven" && entry.solvedValue === null
      ? [
          makeDiagnostic(
            "reference-dimension-undefined",
            "info",
            `${labels.get(entry.dimensionId) ?? entry.dimensionId} has no measurable value for its current geometry.`,
            { kind: "dimension", dimensionId: entry.dimensionId },
          ),
        ]
      : [],
  );
}

export function zeroVector(length: number) {
  return new Float64Array(length);
}

// Scalar residuals are half-squared errors (0.5·r²), so this is |r| ≤ tolerance.
export function isConstraintResidualWithinTolerance(
  residual: number,
  tolerance: number,
) {
  return residual <= 0.5 * tolerance * tolerance;
}

export function addScaled(target: Float64Array, scale: number, source: Float64Array) {
  for (let index = 0; index < target.length; index += 1) {
    target[index] += scale * source[index]!;
  }
}

export function dot(left: Float64Array, right: Float64Array) {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) {
    value += left[index]! * right[index]!;
  }
  return value;
}

export function halfSquaredDistanceWithSaturation(distanceSquared: number) {
  if (distanceSquared === 0 || !Number.isFinite(distanceSquared)) {
    return 0.5 * distanceSquared;
  }
  return Math.max(Number.MIN_VALUE, 0.5 * distanceSquared);
}

export function euclideanNorm(values: Float64Array) {
  return Math.sqrt(dot(values, values));
}

export function uniformNorm(values: Float64Array) {
  let value = 0;
  for (let index = 0; index < values.length; index += 1) {
    value = Math.max(value, Math.abs(values[index]!));
  }
  return value;
}

export function getPoint(
  values: Float64Array,
  point: SolverPointRecord,
): SketchPoint2D {
  return [values[point.baseIndex]!, values[point.baseIndex + 1]!] as const;
}

export function getArcParameters(values: Float64Array, arc: ArcState) {
  return {
    radius: values[arc.baseIndex]!,
    startAngle: values[arc.baseIndex + 1]!,
    endAngle: values[arc.baseIndex + 2]!,
  };
}

export function getCircleRadius(values: Float64Array, circle: CircleState) {
  return values[circle.baseIndex]!;
}

export function subtract(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] - right[0], left[1] - right[1]];
}

export function add(left: SketchPoint2D, right: SketchPoint2D): SketchPoint2D {
  return [left[0] + right[0], left[1] + right[1]];
}

export function length(point: SketchPoint2D) {
  return Math.hypot(point[0], point[1]);
}

export function dot2(left: SketchPoint2D, right: SketchPoint2D) {
  return left[0] * right[0] + left[1] * right[1];
}

export function addPointGradient(
  gradient: Float64Array,
  point: SolverPointRecord,
  x: number,
  y: number,
) {
  gradient[point.baseIndex] += x;
  gradient[point.baseIndex + 1] += y;
}
