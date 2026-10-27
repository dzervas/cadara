import type { ConstraintId, SketchEntityId } from "@/contracts/shared/ids";
import type {
  NumericSketchDefinition as SketchDefinition,
  SketchPoint2D,
} from "@/contracts/sketch/schema";
import { dual, dual2 } from "./automatic-differentiation";
import {
  buildAngleConstraint,
  buildCoincidentConstraint,
  buildEqualLengthCirclesConstraint,
  buildEqualOffsetConstraint,
  buildFixPointConstraint,
  buildHorizontalConstraint,
  buildParallelConstraint,
} from "./build-basic-constraints";
import { createBuildContext } from "./build-context";
import { buildDimensions } from "./build-dimensions";
import {
  buildCoincidentProjectedPointConstraint,
  buildCollinearConstraint,
  buildCollinearProjectedLineConstraint,
  buildMidpointConstraint,
  buildMidpointProjectedLineConstraint,
  buildParallelProjectedLineConstraint,
  buildPointOnCurveConstraint,
  buildPointOnProjectedCurveConstraint,
} from "./build-incidence-constraints";
import {
  buildConcentricConstraint,
  buildConcentricProjectedCurveConstraint,
  buildNormalConstraint,
  buildNormalProjectedCurveConstraint,
  buildSymmetricConstraint,
  buildSymmetricProjectedLineConstraint,
} from "./build-normal-symmetry-constraints";
import { buildTangentProjectedCurveConstraint } from "./build-projected-tangency";
import { buildTangentConstraint } from "./build-tangency";
import {
  structuralEquationVariableIndexMap,
  uniqueSortedIndices,
} from "./compile-components";
import { createDerivedParameterProjection } from "./parameter-projection";
import { DEGENERATE_NORM_EPSILON } from "./solve-constants";
import {
  addPointGradient,
  getPoint,
  length,
  subtract,
  zeroVector,
} from "./solver-geometry";
import type {
  BuildSystemOptions,
  BuildSystemResult,
  SolverInequalityRecord,
  SolverOrientedTangencyRecord,
} from "./system-types";

export function buildSystem(
  definition: SketchDefinition,
  options: BuildSystemOptions,
): BuildSystemResult {
  // Shell rows only evaluate after the projection is initialized below.
  const context = createBuildContext(
    definition,
    options,
    () => parameterProjection,
  );
  const {
    pointRecords,
    scalarConstraints,
    parameterCount,
    pIdx,
    componentJacobian,
    pointDual,
    entityStates,
    entityIdx,
    offsetSeedArcIds,
    orientedTangencyRows,
    initialValues,
    splineTangentStates,
    inequalityRows,
  } = context;

  for (const entity of definition.entities) {
    if (entity.kind !== "arc" || !offsetSeedArcIds.has(entity.entityId)) {
      continue;
    }
    const center = pointRecords.get(entity.centerPointId);
    const start = pointRecords.get(entity.startPointId);
    const end = pointRecords.get(entity.endPointId);
    if (!center || !start || !end) continue;

    scalarConstraints.push({
      id: `constraint_internal_arc_common_radius_${entity.entityId}` as ConstraintId,
      targetKind: "constraint",
      structuralVariableIndices: pIdx(center, start, end),
      evaluateComponentJacobian: componentJacobian(
        pIdx(center, start, end),
        (columns) => {
          const origin = pointDual(columns, center);
          return [
            dual.sub(
              dual2.length(dual2.sub(pointDual(columns, end), origin)),
              dual2.length(dual2.sub(pointDual(columns, start), origin)),
            ),
          ];
        },
      ),
      evaluateComponents(values) {
        const origin = getPoint(values, center);
        return [
          length(subtract(getPoint(values, end), origin)) -
            length(subtract(getPoint(values, start), origin)),
        ];
      },

      evaluate(values) {
        const gradient = zeroVector(parameterCount);
        const centerPosition = getPoint(values, center);
        const startOffset = subtract(getPoint(values, start), centerPosition);
        const endOffset = subtract(getPoint(values, end), centerPosition);
        const startRadius = length(startOffset);
        const endRadius = length(endOffset);
        if (
          startRadius <= DEGENERATE_NORM_EPSILON ||
          endRadius <= DEGENERATE_NORM_EPSILON
        ) {
          return { residual: Number.POSITIVE_INFINITY, gradient };
        }
        const delta = endRadius - startRadius;
        const startUnit: SketchPoint2D = [
          startOffset[0] / startRadius,
          startOffset[1] / startRadius,
        ];
        const endUnit: SketchPoint2D = [
          endOffset[0] / endRadius,
          endOffset[1] / endRadius,
        ];
        addPointGradient(
          gradient,
          center,
          delta * (startUnit[0] - endUnit[0]),
          delta * (startUnit[1] - endUnit[1]),
        );
        addPointGradient(
          gradient,
          start,
          -delta * startUnit[0],
          -delta * startUnit[1],
        );
        addPointGradient(gradient, end, delta * endUnit[0], delta * endUnit[1]);
        return { residual: 0.5 * delta * delta, gradient };
      },
    });
  }

  // A true result preserves the former branch's continue; false falls through.
  for (const constraint of definition.constraints) {
    if (buildEqualOffsetConstraint(context, constraint)) continue;
    if (buildCoincidentConstraint(context, constraint)) continue;
    if (buildHorizontalConstraint(context, constraint)) continue;
    if (buildFixPointConstraint(context, constraint)) continue;
    if (buildAngleConstraint(context, constraint)) continue;
    if (buildEqualLengthCirclesConstraint(context, constraint)) continue;
    if (buildParallelConstraint(context, constraint)) continue;
    if (buildCoincidentProjectedPointConstraint(context, constraint)) continue;
    if (buildPointOnProjectedCurveConstraint(context, constraint)) continue;
    if (buildMidpointConstraint(context, constraint)) continue;
    if (buildMidpointProjectedLineConstraint(context, constraint)) continue;
    if (buildPointOnCurveConstraint(context, constraint)) continue;
    if (buildCollinearConstraint(context, constraint)) continue;
    if (buildCollinearProjectedLineConstraint(context, constraint)) continue;
    if (buildParallelProjectedLineConstraint(context, constraint)) continue;
    if (buildTangentProjectedCurveConstraint(context, constraint)) continue;
    if (buildTangentConstraint(context, constraint)) continue;
    if (buildConcentricConstraint(context, constraint)) continue;
    if (buildConcentricProjectedCurveConstraint(context, constraint)) continue;
    if (buildNormalConstraint(context, constraint)) continue;
    if (buildNormalProjectedCurveConstraint(context, constraint)) continue;
    if (buildSymmetricConstraint(context, constraint)) continue;
    if (buildSymmetricProjectedLineConstraint(context, constraint)) continue;
  }

  buildDimensions(context);

  if (options.dragTarget) {
    const point = pointRecords.get(options.dragTarget.pointId);

    if (point) {
      scalarConstraints.push({
        id: `constraint_drag_target_${options.dragTarget.pointId}` as ConstraintId,
        targetKind: "constraint",
        evaluateComponentJacobian: componentJacobian(pIdx(point), (columns) =>
          dual2.sub(
            pointDual(columns, point),
            columns.constant2(options.dragTarget!.position),
          ),
        ),
        evaluateComponents(values) {
          return subtract(
            getPoint(values, point),
            options.dragTarget!.position,
          );
        },

        evaluate(values) {
          const gradient = zeroVector(parameterCount);
          const actual = getPoint(values, point);
          const delta = subtract(actual, options.dragTarget!.position);
          addPointGradient(gradient, point, delta[0], delta[1]);
          return {
            residual: 0.5 * (delta[0] * delta[0] + delta[1] * delta[1]),
            gradient,
          };
        },
      });
    }
  }

  const parameterProjection = createDerivedParameterProjection({
    definition,
    parameterCount,
    pointRecords,
    entityStates,
    splineTangentStates,
    modelingTolerance: options.modelingTolerance,
    offsetPlans: options.offsetPlans,
  });

  for (const entity of definition.entities) {
    const state = entityStates.get(entity.entityId);
    const tau = options.modelingTolerance;
    if (entity.kind === "lineSegment") {
      const start = pointRecords.get(entity.startPointId);
      const end = pointRecords.get(entity.endPointId);
      if (start && end)
        inequalityRows.push({
          record: {
            id: `segmentLength_${entity.entityId}`,
            kind: "segmentLength",
            entityId: entity.entityId,
          },
          support: pIdx(start, end),
          inequality: (columns) =>
            dual.sub(
              dual2.length(
                dual2.sub(pointDual(columns, end), pointDual(columns, start)),
              ),
              columns.constant(tau),
            ),
        });
    } else if (state?.kind === "circle" || state?.kind === "arc") {
      inequalityRows.push({
        record: {
          id: `radius_${entity.entityId}`,
          kind: "radius",
          entityId: entity.entityId,
        },
        support: [state.baseIndex],
        inequality: (columns) =>
          dual.sub(columns.variable(state.baseIndex), columns.constant(tau)),
      });
    }
  }
  const inequalities = inequalityRows.map(
    ({ record, support, inequality }): SolverInequalityRecord => ({
      ...record,
      variableIndices: parameterProjection.projectVariableIndices(support),
      evaluate: parameterProjection.wrapComponentJacobian(
        componentJacobian(support, (columns) => [inequality(columns)]),
        support,
      ),
    }),
  );

  const orientedTangencies = orientedTangencyRows.map(
    ({ record, support, component }): SolverOrientedTangencyRecord => ({
      ...record,
      variableIndices: parameterProjection.projectVariableIndices(support),
      evaluate: parameterProjection.wrapComponentJacobian(
        componentJacobian(support, (columns) => [component(columns)]),
        support,
      ),
    }),
  );

  const shellSourceVariables = new Map<SketchEntityId, readonly number[]>();
  for (const relationship of definition.derivedRelationships ?? []) {
    if (relationship.kind !== "offset") continue;
    const sources = uniqueSortedIndices(
      relationship.seedEntityIds.flatMap(entityIdx),
    );
    for (const output of relationship.piecewiseCubicOutputs)
      shellSourceVariables.set(output.outputEntityId, sources);
  }
  const system: BuildSystemResult = {
    parameterCount,
    initialValues: parameterProjection.projectValues(initialValues),
    pointRecords,
    entityStates,
    splineTangentStates,
    parameterProjection,
    scalarConstraints,
    shellSourceVariables,
    inequalities,
    orientedTangencies,
  };
  const structuralVariables = structuralEquationVariableIndexMap(
    system,
    definition,
  );
  system.scalarConstraints = scalarConstraints.map((constraint) => {
    const variables =
      structuralVariables.get(constraint.id) ??
      constraint.structuralVariableIndices;
    return parameterProjection.wrapConstraint(
      constraint,
      variables && variables.length > 0 ? variables : undefined,
    );
  });
  return system;
}
