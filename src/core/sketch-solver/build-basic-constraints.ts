import type {
  ConstraintDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import { unitVectorDual } from "./analytic-residuals";
import { dual, dual2 } from "./automatic-differentiation";
import type { BuildContext } from "./build-context";
import { unitVector } from "./projected-geometry";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import {
  addPointGradient,
  dot2,
  getCircleRadius,
  getPoint,
  length,
  subtract,
  zeroVector,
} from "./solver-geometry";

export function buildEqualOffsetConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    pIdx,
    componentJacobian,
    pointDual,
    infiniteDuals,
  } = context;
  if (constraint.kind === "equalOffset") {
    if (
      constraint.pairs.some((pair) => pair.seedEntityId === pair.offsetEntityId)
    ) {
      return true;
    }
    const pairLines = constraint.pairs.map((pair) => ({
      pair,
      seed: lineEntityMap.get(pair.seedEntityId),
      offset: lineEntityMap.get(pair.offsetEntityId),
    }));
    if (pairLines.some(({ seed, offset }) => !seed || !offset)) {
      return true;
    }

    const records = pairLines.map(({ pair, seed, offset }) => ({
      pair,
      seedStart: pointRecords.get(seed!.startPointId),
      seedEnd: pointRecords.get(seed!.endPointId),
      offsetStart: pointRecords.get(offset!.startPointId),
      offsetEnd: pointRecords.get(offset!.endPointId),
    }));
    if (
      records.some(
        ({ seedStart, seedEnd, offsetStart, offsetEnd }) =>
          !seedStart || !seedEnd || !offsetStart || !offsetEnd,
      )
    ) {
      return true;
    }

    scalarConstraints.push({
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluateComponentJacobian: componentJacobian(
        records.flatMap((record) =>
          pIdx(
            record.seedStart,
            record.seedEnd,
            record.offsetStart,
            record.offsetEnd,
          ),
        ),
        (columns) => {
          const pairs = records.map((record) => {
            const seedStart = pointDual(columns, record.seedStart!);
            const seedEnd = pointDual(columns, record.seedEnd!);
            const offsetStart = pointDual(columns, record.offsetStart!);
            const offsetEnd = pointDual(columns, record.offsetEnd!);
            const seedUnit = unitVectorDual(seedStart, seedEnd);
            const offsetUnit = unitVectorDual(offsetStart, offsetEnd);
            if (!seedUnit || !offsetUnit) return infiniteDuals(columns, 2);
            return [
              dual2.cross(seedUnit, offsetUnit),
              dual.scale(
                dual2.dot(
                  [dual.neg(seedUnit[1]), seedUnit[0]],
                  dual2.sub(offsetStart, seedStart),
                ),
                record.pair.side === "left" ? 1 : -1,
              ),
            ];
          });
          return [
            pairs[0]![0]!,
            pairs[1]![0]!,
            dual.sub(pairs[0]![1]!, pairs[1]![1]!),
          ];
        },
      ),
      evaluateComponents(values) {
        const pairs = records.map((record) => {
          const seedStart = getPoint(values, record.seedStart!);
          const seedEnd = getPoint(values, record.seedEnd!);
          const offsetStart = getPoint(values, record.offsetStart!);
          const offsetEnd = getPoint(values, record.offsetEnd!);
          const seedUnit = unitVector(seedStart, seedEnd);
          const offsetUnit = unitVector(offsetStart, offsetEnd);
          if (!seedUnit || !offsetUnit) return [Infinity, Infinity];
          return [
            seedUnit[0] * offsetUnit[1] - seedUnit[1] * offsetUnit[0],
            (record.pair.side === "left" ? 1 : -1) *
              dot2(
                [-seedUnit[1], seedUnit[0]],
                subtract(offsetStart, seedStart),
              ),
          ];
        });
        return [pairs[0]![0]!, pairs[1]![0]!, pairs[0]![1]! - pairs[1]![1]!];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const evaluations = records.map((record) => {
          const seedStart = record.seedStart!;
          const seedEnd = record.seedEnd!;
          const offsetStart = record.offsetStart!;
          const offsetEnd = record.offsetEnd!;
          const seedVector = subtract(
            getPoint(values, seedEnd),
            getPoint(values, seedStart),
          );
          const offsetVector = subtract(
            getPoint(values, offsetEnd),
            getPoint(values, offsetStart),
          );
          const seedLength = length(seedVector);
          const offsetLength = length(offsetVector);
          if (
            !Number.isFinite(seedLength) ||
            !Number.isFinite(offsetLength) ||
            seedLength < DEGENERATE_NORM_EPSILON ||
            offsetLength < DEGENERATE_NORM_EPSILON
          ) {
            return null;
          }

          const seedUnit: SketchPoint2D = [
            seedVector[0] / seedLength,
            seedVector[1] / seedLength,
          ];
          const offsetUnit: SketchPoint2D = [
            offsetVector[0] / offsetLength,
            offsetVector[1] / offsetLength,
          ];
          const seedNormal: SketchPoint2D = [-seedUnit[1], seedUnit[0]];
          const side = record.pair.side === "left" ? 1 : -1;
          const startDelta = subtract(
            getPoint(values, offsetStart),
            getPoint(values, seedStart),
          );
          const distance = side * dot2(seedNormal, startDelta);

          const seedUnitJacobian = [
            [
              (1 - seedUnit[0] * seedUnit[0]) / seedLength,
              -(seedUnit[0] * seedUnit[1]) / seedLength,
            ],
            [
              -(seedUnit[0] * seedUnit[1]) / seedLength,
              (1 - seedUnit[1] * seedUnit[1]) / seedLength,
            ],
          ] as const;
          const offsetUnitJacobian = [
            [
              (1 - offsetUnit[0] * offsetUnit[0]) / offsetLength,
              -(offsetUnit[0] * offsetUnit[1]) / offsetLength,
            ],
            [
              -(offsetUnit[0] * offsetUnit[1]) / offsetLength,
              (1 - offsetUnit[1] * offsetUnit[1]) / offsetLength,
            ],
          ] as const;

          const parallel =
            seedUnit[0] * offsetUnit[1] - seedUnit[1] * offsetUnit[0];
          const parallelSeedUnitGradient: SketchPoint2D = [
            offsetUnit[1],
            -offsetUnit[0],
          ];
          const parallelOffsetUnitGradient: SketchPoint2D = [
            -seedUnit[1],
            seedUnit[0],
          ];
          const parallelSeedVectorGradient: SketchPoint2D = [
            parallelSeedUnitGradient[0] * seedUnitJacobian[0][0] +
              parallelSeedUnitGradient[1] * seedUnitJacobian[1][0],
            parallelSeedUnitGradient[0] * seedUnitJacobian[0][1] +
              parallelSeedUnitGradient[1] * seedUnitJacobian[1][1],
          ];
          const parallelOffsetVectorGradient: SketchPoint2D = [
            parallelOffsetUnitGradient[0] * offsetUnitJacobian[0][0] +
              parallelOffsetUnitGradient[1] * offsetUnitJacobian[1][0],
            parallelOffsetUnitGradient[0] * offsetUnitJacobian[0][1] +
              parallelOffsetUnitGradient[1] * offsetUnitJacobian[1][1],
          ];

          const rotatedDelta: SketchPoint2D = [startDelta[1], -startDelta[0]];
          const distanceSeedVectorGradient: SketchPoint2D = [
            side *
              (seedUnitJacobian[0][0] * rotatedDelta[0] +
                seedUnitJacobian[0][1] * rotatedDelta[1]),
            side *
              (seedUnitJacobian[1][0] * rotatedDelta[0] +
                seedUnitJacobian[1][1] * rotatedDelta[1]),
          ];
          const distanceDeltaGradient: SketchPoint2D = [
            side * seedNormal[0],
            side * seedNormal[1],
          ];

          return {
            distance,
            parallel,
            seedStart,
            seedEnd,
            offsetStart,
            offsetEnd,
            parallelSeedVectorGradient,
            parallelOffsetVectorGradient,
            distanceSeedVectorGradient,
            distanceDeltaGradient,
          };
        });

        const first = evaluations[0];
        const second = evaluations[1];
        if (!first || !second) {
          return { residual: Number.POSITIVE_INFINITY, gradient };
        }

        for (const evaluation of evaluations as [
          NonNullable<typeof first>,
          NonNullable<typeof second>,
        ]) {
          addPointGradient(
            gradient,
            evaluation.seedStart,
            -evaluation.parallel * evaluation.parallelSeedVectorGradient[0],
            -evaluation.parallel * evaluation.parallelSeedVectorGradient[1],
          );
          addPointGradient(
            gradient,
            evaluation.seedEnd,
            evaluation.parallel * evaluation.parallelSeedVectorGradient[0],
            evaluation.parallel * evaluation.parallelSeedVectorGradient[1],
          );
          addPointGradient(
            gradient,
            evaluation.offsetStart,
            -evaluation.parallel * evaluation.parallelOffsetVectorGradient[0],
            -evaluation.parallel * evaluation.parallelOffsetVectorGradient[1],
          );
          addPointGradient(
            gradient,
            evaluation.offsetEnd,
            evaluation.parallel * evaluation.parallelOffsetVectorGradient[0],
            evaluation.parallel * evaluation.parallelOffsetVectorGradient[1],
          );
        }

        const distanceDelta = first.distance - second.distance;
        const distanceScales = [distanceDelta, -distanceDelta] as const;
        evaluations.forEach((evaluation, index) => {
          if (!evaluation) return;
          const scale = distanceScales[index]!;
          addPointGradient(
            gradient,
            evaluation.seedStart,
            scale *
              (-evaluation.distanceSeedVectorGradient[0] -
                evaluation.distanceDeltaGradient[0]),
            scale *
              (-evaluation.distanceSeedVectorGradient[1] -
                evaluation.distanceDeltaGradient[1]),
          );
          addPointGradient(
            gradient,
            evaluation.seedEnd,
            scale * evaluation.distanceSeedVectorGradient[0],
            scale * evaluation.distanceSeedVectorGradient[1],
          );
          addPointGradient(
            gradient,
            evaluation.offsetStart,
            scale * evaluation.distanceDeltaGradient[0],
            scale * evaluation.distanceDeltaGradient[1],
          );
        });

        return {
          residual:
            0.5 *
            (first.parallel * first.parallel +
              second.parallel * second.parallel +
              distanceDelta * distanceDelta),
          gradient,
        };
      },
    });
    return true;
  }
  return false;
}

export function buildCoincidentConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (constraint.kind === "coincident") {
    const left = pointRecords.get(constraint.pointIds[0]);
    const right = pointRecords.get(constraint.pointIds[1]);
    if (!left || !right) {
      return true;
    }

    scalarConstraints.push({
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluateComponentJacobian: componentJacobian(
        pIdx(left, right),
        (columns) =>
          dual2.sub(pointDual(columns, left), pointDual(columns, right)),
      ),
      evaluateComponents(values) {
        return subtract(getPoint(values, left), getPoint(values, right));
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const a = getPoint(values, left);
        const b = getPoint(values, right);
        const delta = subtract(a, b);
        addPointGradient(gradient, left, delta[0], delta[1]);
        addPointGradient(gradient, right, -delta[0], -delta[1]);
        return {
          residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
          gradient,
        };
      },
    });
    return true;
  }
  return false;
}

export function buildHorizontalConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (constraint.kind === "horizontal" || constraint.kind === "vertical") {
    const line = lineEntityMap.get(constraint.entityId);
    if (!line) {
      return true;
    }
    const start = pointRecords.get(line.startPointId);
    const end = pointRecords.get(line.endPointId);
    if (!start || !end) {
      return true;
    }

    scalarConstraints.push({
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluateComponentJacobian: componentJacobian(
        pIdx(start, end),
        (columns) => [
          dual2.sub(pointDual(columns, end), pointDual(columns, start))[
            constraint.kind === "horizontal" ? 1 : 0
          ],
        ],
      ),
      evaluateComponents(values) {
        const delta = subtract(getPoint(values, end), getPoint(values, start));
        return [delta[constraint.kind === "horizontal" ? 1 : 0]];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const a = getPoint(values, start);
        const b = getPoint(values, end);
        if (constraint.kind === "horizontal") {
          const dy = b[1] - a[1];
          addPointGradient(gradient, start, 0, -dy);
          addPointGradient(gradient, end, 0, dy);
          return { residual: 0.5 * dy * dy, gradient };
        }

        const dx = b[0] - a[0];
        addPointGradient(gradient, start, -dx, 0);
        addPointGradient(gradient, end, dx, 0);
        return { residual: 0.5 * dx * dx, gradient };
      },
    });
    return true;
  }
  return false;
}

export function buildFixPointConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (constraint.kind === "fixPoint") {
    const point = pointRecords.get(constraint.pointId);
    if (!point) {
      return true;
    }

    scalarConstraints.push({
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
        dual2.sub(
          pointDual(columns, point),
          columns.constant2(constraint.position),
        ),
      ),
      evaluateComponents(values) {
        return subtract(getPoint(values, point), constraint.position);
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const actual = getPoint(values, point);
        const delta = subtract(actual, constraint.position);
        addPointGradient(gradient, point, delta[0], delta[1]);
        return {
          residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
          gradient,
        };
      },
    });
    return true;
  }
  return false;
}

export function buildAngleConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (constraint.kind === "angle") {
    const point1 = pointRecords.get(constraint.pointIds[0]);
    const point2 = pointRecords.get(constraint.pointIds[1]);
    const middle = pointRecords.get(constraint.pointIds[2]);
    if (!point1 || !point2 || !middle) {
      return true;
    }

    scalarConstraints.push({
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluateComponentJacobian: componentJacobian(
        pIdx(point1, point2, middle),
        (columns) => {
          const a = dual2.sub(
            pointDual(columns, point1),
            pointDual(columns, middle),
          );
          const b = dual2.sub(
            pointDual(columns, point2),
            pointDual(columns, middle),
          );
          const lengths = dual.mul(dual2.length(a), dual2.length(b));
          if (
            constraint.valueRadians === 0 ||
            constraint.valueRadians === Math.PI
          )
            return [dual.div(dual2.cross(a, b), lengths)];
          return [
            dual.sub(
              dual.acosClamped(dual.div(dual2.dot(a, b), lengths)),
              columns.constant(constraint.valueRadians),
            ),
          ];
        },
      ),
      evaluateComponents(values) {
        const a = subtract(getPoint(values, point1), getPoint(values, middle));
        const b = subtract(getPoint(values, point2), getPoint(values, middle));
        // acos is even at 0 and pi; its central difference there vanishes.
        // The signed sine has the same local zero set and retains the angular row.
        if (
          constraint.valueRadians === 0 ||
          constraint.valueRadians === Math.PI
        )
          return [(a[0] * b[1] - a[1] * b[0]) / (length(a) * length(b))];
        return [
          Math.acos(
            Math.max(-1, Math.min(1, dot2(a, b) / (length(a) * length(b)))),
          ) - constraint.valueRadians,
        ];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const p1 = getPoint(values, point1);
        const p2 = getPoint(values, point2);
        const pm = getPoint(values, middle);
        const d1 = subtract(p1, pm);
        const d2 = subtract(p2, pm);
        const norm1 = length(d1);
        const norm2 = length(d2);
        if (
          norm1 < DEGENERATE_NORM_EPSILON ||
          norm2 < DEGENERATE_NORM_EPSILON
        ) {
          return {
            residual: 0.5 * constraint.valueRadians * constraint.valueRadians,
            gradient,
          };
        }

        const dotValue = d1[0] * d2[0] + d1[1] * d2[1];
        const cosTheta = Math.max(-1, Math.min(1, dotValue / (norm1 * norm2)));
        const theta = Math.acos(cosTheta);
        const lossGradient = theta - constraint.valueRadians;
        const denom = Math.sqrt(Math.max(1e-12, 1 - cosTheta * cosTheta));
        const gradThetaFromCos = -1 / denom;

        const gradCosFromD1X =
          d2[0] / (norm1 * norm2) -
          (dotValue * d1[0]) / (norm1 * norm1 * norm1 * norm2);
        const gradCosFromD1Y =
          d2[1] / (norm1 * norm2) -
          (dotValue * d1[1]) / (norm1 * norm1 * norm1 * norm2);
        const gradCosFromD2X =
          d1[0] / (norm1 * norm2) -
          (dotValue * d2[0]) / (norm1 * norm2 * norm2 * norm2);
        const gradCosFromD2Y =
          d1[1] / (norm1 * norm2) -
          (dotValue * d2[1]) / (norm1 * norm2 * norm2 * norm2);

        const scaleFactor = lossGradient * gradThetaFromCos;
        addPointGradient(
          gradient,
          point1,
          scaleFactor * gradCosFromD1X,
          scaleFactor * gradCosFromD1Y,
        );
        addPointGradient(
          gradient,
          point2,
          scaleFactor * gradCosFromD2X,
          scaleFactor * gradCosFromD2Y,
        );
        addPointGradient(
          gradient,
          middle,
          -scaleFactor * (gradCosFromD1X + gradCosFromD2X),
          -scaleFactor * (gradCosFromD1Y + gradCosFromD2Y),
        );
        const residual = 0.5 * lossGradient * lossGradient;
        return { residual, gradient };
      },
    });
    return true;
  }
  return false;
}

export function buildEqualLengthCirclesConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const { entityStates, scalarConstraints, parameterCount, componentJacobian } =
    context;
  if (constraint.kind === "equalLength") {
    const a = entityStates.get(constraint.entityIds[0]);
    const b = entityStates.get(constraint.entityIds[1]);
    if (a?.kind === "circle" && b?.kind === "circle") {
      scalarConstraints.push({
        id: constraint.constraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(
          [a.baseIndex, b.baseIndex],
          (columns) => [
            dual.sub(
              columns.variable(a.baseIndex),
              columns.variable(b.baseIndex),
            ),
          ],
        ),
        evaluateComponents(values) {
          return [getCircleRadius(values, a) - getCircleRadius(values, b)];
        },
        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const difference =
            getCircleRadius(values, a) - getCircleRadius(values, b);
          gradient[a.baseIndex] += difference;
          gradient[b.baseIndex] -= difference;
          return { residual: 0.5 * difference * difference, gradient };
        },
      });
      return true;
    }
  }
  return false;
}

export function buildParallelConstraint(
  context: BuildContext,
  constraint: ConstraintDefinition,
): boolean {
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    lineEntityMap,
    pIdx,
    componentJacobian,
    pointDual,
  } = context;
  if (
    constraint.kind === "parallel" ||
    constraint.kind === "perpendicular" ||
    constraint.kind === "equalLength"
  ) {
    const lineA = lineEntityMap.get(constraint.entityIds[0]);
    const lineB = lineEntityMap.get(constraint.entityIds[1]);
    if (!lineA || !lineB) {
      return true;
    }
    const a0 = pointRecords.get(lineA.startPointId);
    const a1 = pointRecords.get(lineA.endPointId);
    const b0 = pointRecords.get(lineB.startPointId);
    const b1 = pointRecords.get(lineB.endPointId);
    if (!a0 || !a1 || !b0 || !b1) {
      return true;
    }

    scalarConstraints.push({
      id: constraint.constraintId,
      targetKind: "constraint",
      evaluateComponentJacobian: componentJacobian(
        pIdx(a0, a1, b0, b1),
        (columns) => {
          const da = dual2.sub(pointDual(columns, a1), pointDual(columns, a0));
          const db = dual2.sub(pointDual(columns, b1), pointDual(columns, b0));
          const na = dual2.length(da),
            nb = dual2.length(db);
          if (constraint.kind === "equalLength") return [dual.sub(na, nb)];
          return [
            dual.div(
              constraint.kind === "parallel"
                ? dual2.cross(da, db)
                : dual2.dot(da, db),
              dual.mul(na, nb),
            ),
          ];
        },
      ),
      evaluateComponents(values) {
        const da = subtract(getPoint(values, a1), getPoint(values, a0));
        const db = subtract(getPoint(values, b1), getPoint(values, b0));
        const na = length(da),
          nb = length(db);
        if (constraint.kind === "equalLength") return [na - nb];
        return [
          constraint.kind === "parallel"
            ? (da[0] * db[1] - da[1] * db[0]) / (na * nb)
            : dot2(da, db) / (na * nb),
        ];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const pa0 = getPoint(values, a0);
        const pa1 = getPoint(values, a1);
        const pb0 = getPoint(values, b0);
        const pb1 = getPoint(values, b1);
        const da = subtract(pa1, pa0);
        const db = subtract(pb1, pb0);
        const na = length(da);
        const nb = length(db);
        if (na < DEGENERATE_NORM_EPSILON || nb < DEGENERATE_NORM_EPSILON) {
          return { residual: 0, gradient };
        }

        if (constraint.kind === "equalLength") {
          const diff = na - nb;
          const dNa = [da[0] / na, da[1] / na] as const;
          const dNb = [db[0] / nb, db[1] / nb] as const;
          addPointGradient(gradient, a0, -diff * dNa[0], -diff * dNa[1]);
          addPointGradient(gradient, a1, diff * dNa[0], diff * dNa[1]);
          addPointGradient(gradient, b0, diff * dNb[0], diff * dNb[1]);
          addPointGradient(gradient, b1, -diff * dNb[0], -diff * dNb[1]);
          return { residual: 0.5 * diff * diff, gradient };
        }

        const ua = [da[0] / na, da[1] / na] as const;
        const ub = [db[0] / nb, db[1] / nb] as const;
        const residualValue =
          constraint.kind === "parallel"
            ? ua[0] * ub[1] - ua[1] * ub[0]
            : ua[0] * ub[0] + ua[1] * ub[1];

        const hA = [
          [
            1 / na - (da[0] * da[0]) / (na * na * na),
            -(da[0] * da[1]) / (na * na * na),
          ],
          [
            -(da[0] * da[1]) / (na * na * na),
            1 / na - (da[1] * da[1]) / (na * na * na),
          ],
        ] as const;
        const hB = [
          [
            1 / nb - (db[0] * db[0]) / (nb * nb * nb),
            -(db[0] * db[1]) / (nb * nb * nb),
          ],
          [
            -(db[0] * db[1]) / (nb * nb * nb),
            1 / nb - (db[1] * db[1]) / (nb * nb * nb),
          ],
        ] as const;

        const gradResidualUa =
          constraint.kind === "parallel"
            ? ([ub[1], -ub[0]] as const)
            : ([ub[0], ub[1]] as const);
        const gradResidualUb =
          constraint.kind === "parallel"
            ? ([-ua[1], ua[0]] as const)
            : ([ua[0], ua[1]] as const);

        const gradResidualDa = [
          gradResidualUa[0] * hA[0][0] + gradResidualUa[1] * hA[1][0],
          gradResidualUa[0] * hA[0][1] + gradResidualUa[1] * hA[1][1],
        ] as const;
        const gradResidualDb = [
          gradResidualUb[0] * hB[0][0] + gradResidualUb[1] * hB[1][0],
          gradResidualUb[0] * hB[0][1] + gradResidualUb[1] * hB[1][1],
        ] as const;

        addPointGradient(
          gradient,
          a0,
          -residualValue * gradResidualDa[0],
          -residualValue * gradResidualDa[1],
        );
        addPointGradient(
          gradient,
          a1,
          residualValue * gradResidualDa[0],
          residualValue * gradResidualDa[1],
        );
        addPointGradient(
          gradient,
          b0,
          -residualValue * gradResidualDb[0],
          -residualValue * gradResidualDb[1],
        );
        addPointGradient(
          gradient,
          b1,
          residualValue * gradResidualDb[0],
          residualValue * gradResidualDb[1],
        );
        return { residual: 0.5 * residualValue * residualValue, gradient };
      },
    });
  }
  return false;
}
