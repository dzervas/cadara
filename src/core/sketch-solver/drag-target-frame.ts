import { componentJacobianOver } from "./analytic-residuals";
import {
  createDragRadiusConstraint,
  createDragTangentVectorConstraint,
  createDragTargetConstraint,
} from "./drag-target-constraints";
import { splineTangentStateKey } from "./parameter-projection";
import type { SketchDragTarget } from "./solve-types";
import { getPoint, zeroVector } from "./solver-geometry";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveComponent,
  SketchCompiledSolveProgram,
} from "./system-types";
import type {
  ConstraintId,
  SketchEntityId,
  SketchPointId,
} from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

/**
 * T12b: resolve a SketchDragTarget into soft constraints, dragged variable
 * indices, and the component to scope the solve. Called within the substep
 * loop so each substep's interpolated target is captured. `startValues` is the
 * projected parameter array at the beginning of the substep loop (translate
 * needs the current point positions to apply the shared delta).
 */
export function resolveDragTargetFrame(
  program: SketchCompiledSolveProgram,
  target: SketchDragTarget,
  startValues: Float64Array,
  weight: number,
): {
  constraints: ScalarConstraintRecord[];
  draggedVariableIndices: number[];
  component: SketchCompiledSolveComponent | null;
} | null {
  const system = program.system;
  switch (target.kind) {
    case "sketchPoint": {
      const constraint = createDragTargetConstraint(system, target, weight);
      if (!constraint) return null;
      const point = system.pointRecords.get(target.pointId)!;
      return {
        constraints: [constraint],
        draggedVariableIndices: [point.baseIndex, point.baseIndex + 1],
        component: findComponentForPoint(program, target.pointId),
      };
    }
    case "sketchTranslate": {
      const constraints: ScalarConstraintRecord[] = [];
      const draggedVariableIndices: number[] = [];
      let component: SketchCompiledSolveComponent | null = null;
      for (const pointId of target.pointIds) {
        const point = system.pointRecords.get(pointId);
        if (!point) continue;
        // Current position from session.values, not point.initial
        const currentPos = getPoint(startValues, point);
        const targetPos: SketchPoint2D = [
          currentPos[0] + target.delta[0],
          currentPos[1] + target.delta[1],
        ];
        const c = createDragTargetConstraint(
          system,
          { kind: "sketchPoint", pointId, position: targetPos },
          weight,
        );
        if (c) constraints.push(c);
        draggedVariableIndices.push(point.baseIndex, point.baseIndex + 1);
        if (!component) component = findComponentForPoint(program, pointId);
      }
      if (constraints.length === 0) return null;
      return { constraints, draggedVariableIndices, component };
    }
    case "sketchRadius": {
      const constraint = createDragRadiusConstraint(
        system,
        target.entityId,
        target.targetRadius,
        weight,
      );
      if (!constraint) return null;
      const entityState = system.entityStates.get(target.entityId)!;
      return {
        constraints: [constraint],
        draggedVariableIndices: [entityState.baseIndex],
        component: findComponentForEntity(program, target.entityId),
      };
    }
    case "sketchTangentVector": {
      const tangentState = system.splineTangentStates.get(
        splineTangentStateKey(target.entityId, target.occurrenceId),
      );
      if (!tangentState) return null;

      // Exact-zero request: fix both tangent variables at 0 as hard constraints
      // so the accepted frame stores exactly [0, 0] regardless of soft targets.
      if (target.exactZero) {
        const bx = tangentState.baseIndex;
        const by = tangentState.baseIndex + 1;
        const hardZeroX = system.parameterProjection.wrapConstraint(
          {
            id: `constraint_drag_tangent_zero_x_${target.entityId}_${target.occurrenceId}` as ConstraintId,
            evaluateComponents: (values) => [values[bx]!],
            evaluateComponentJacobian: componentJacobianOver(
              system.parameterCount,
              [bx],
              (columns) => [columns.variable(bx)],
            ),
            targetKind: "constraint",
            evaluate(values) {
              const gradient = zeroVector(system.parameterCount);
              const v = values[bx]!;
              gradient[bx] += v;
              return { residual: 0.5 * v * v, gradient };
            },
          },
          [bx],
        );
        const hardZeroY = system.parameterProjection.wrapConstraint(
          {
            id: `constraint_drag_tangent_zero_y_${target.entityId}_${target.occurrenceId}` as ConstraintId,
            evaluateComponents: (values) => [values[by]!],
            evaluateComponentJacobian: componentJacobianOver(
              system.parameterCount,
              [by],
              (columns) => [columns.variable(by)],
            ),
            targetKind: "constraint",
            evaluate(values) {
              const gradient = zeroVector(system.parameterCount);
              const v = values[by]!;
              gradient[by] += v;
              return { residual: 0.5 * v * v, gradient };
            },
          },
          [by],
        );
        return {
          constraints: [hardZeroX, hardZeroY],
          draggedVariableIndices: [bx, by],
          component: findComponentForEntity(program, target.entityId),
        };
      }

      const constraint = createDragTangentVectorConstraint(
        system,
        target.entityId,
        target.occurrenceId,
        target.targetVector,
        weight,
      );
      if (!constraint) return null;
      return {
        constraints: [constraint],
        draggedVariableIndices: [
          tangentState.baseIndex,
          tangentState.baseIndex + 1,
        ],
        component: findComponentForEntity(program, target.entityId),
      };
    }
  }
}

export function findComponentForEntity(
  program: SketchCompiledSolveProgram,
  entityId: SketchEntityId,
) {
  return (
    program.components.find((component) =>
      component.entityIds.includes(entityId),
    ) ?? null
  );
}

export function findComponentForPoint(
  program: SketchCompiledSolveProgram,
  pointId: SketchPointId,
) {
  return (
    program.components.find((component) =>
      component.pointIds.includes(pointId),
    ) ?? null
  );
}
