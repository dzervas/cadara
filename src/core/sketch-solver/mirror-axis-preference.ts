import { pointVariableIndices } from "./compile-components";
import { solveProgramValues } from "./solve-program";
import { cloneValues } from "./solver-geometry";
import {
  isAcceptableSolvedSnapshot,
  startFailedDerivedDiagnostics,
} from "./start-session";
import type {
  ScalarConstraintRecord,
  SketchCompiledSolveComponent,
  SketchCompiledSolveProgram,
} from "./system-types";
import type { SketchPointId } from "@/contracts/shared/ids";
import { declaredJoinClasses } from "@/contracts/sketch/region-extraction";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";
import type {
  SketchSolveDiagnostic,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";

export const NO_FROZEN_VARIABLES: ReadonlySet<number> = new Set();

/**
 * T15c: `constraints` with the `frozen` variables excluded from the solved
 * set: their gradient entries are zero, so no strategy moves them (BFGS,
 * Gauss–Newton and gradient descent all step along the gradient's span).
 * Residuals, and so statuses and acceptance, are unchanged.
 */
export function withFrozenVariables(
  constraints: ScalarConstraintRecord[],
  frozen: ReadonlySet<number>,
): ScalarConstraintRecord[] {
  if (frozen.size === 0) return constraints;
  const indices = [...frozen];
  return constraints.map((constraint) => ({
    ...constraint,
    evaluate(values) {
      const evaluation = constraint.evaluate(values);
      if (indices.every((index) => evaluation.gradient[index] === 0))
        return evaluation;
      const gradient = evaluation.gradient.slice();
      for (const index of indices) gradient[index] = 0;
      return { ...evaluation, gradient };
    },
  }));
}

/** T15c: one mirror's line axis: its points, their variables and their authority. */
export type MirrorAxisVariables = {
  pointIds: readonly SketchPointId[];
  variables: readonly number[];
  authority: readonly number[];
};

export const mirrorAxisVariablesByProgram = new WeakMap<
  SketchCompiledSolveProgram,
  readonly MirrorAxisVariables[]
>();

/**
 * T15c: the line axes of the program's mirror relationships. A sketch datum
 * axis has no variables (fixed by construction), and a missing or non-line
 * axis (a failed mirror) has nothing to preserve.
 */
export function mirrorAxisVariables(
  program: SketchCompiledSolveProgram,
): readonly MirrorAxisVariables[] {
  const cached = mirrorAxisVariablesByProgram.get(program);
  if (cached) return cached;
  const entities = new Map(
    program.definition.entities.map((entity) => [entity.entityId, entity]),
  );
  const axes = (program.definition.derivedRelationships ?? []).flatMap(
    (relationship) => {
      if (
        relationship.kind !== "mirror" ||
        relationship.mirrorReference.kind !== "lineEntity"
      )
        return [];
      const axis = entities.get(relationship.mirrorReference.entityId);
      if (axis?.kind !== "lineSegment") return [];
      const pointIds = [axis.startPointId, axis.endPointId];
      const variables = pointIds.flatMap((pointId) =>
        pointVariableIndices(program.system.pointRecords.get(pointId)),
      );
      return [
        {
          pointIds,
          variables,
          authority:
            program.system.parameterProjection.projectVariableIndices(
              variables,
            ),
        },
      ];
    },
  );
  mirrorAxisVariablesByProgram.set(program, axes);
  return axes;
}

export const mirrorSourcePointsByProgram = new WeakMap<
  SketchCompiledSolveProgram,
  ReadonlyMap<SketchPointId, SketchPointId>
>();

/**
 * T15c (review R-1b): a mirror output point's source: its seed point,
 * followed through chains (a mirror of a mirror output) to the first point
 * that is not a mirror output. Bounded by the number of mirror outputs, so a
 * malformed cycle stops (T15b fails it explicitly elsewhere).
 */
export function mirrorSourcePoint(
  program: SketchCompiledSolveProgram,
  pointId: SketchPointId,
): SketchPointId {
  let seeds = mirrorSourcePointsByProgram.get(program);
  if (!seeds) {
    const entries = new Map<SketchPointId, SketchPointId>();
    for (const relationship of program.definition.derivedRelationships ?? []) {
      if (relationship.kind !== "mirror") continue;
      for (const output of relationship.outputs)
        output.outputPointIds.forEach((outputPointId, index) => {
          const seedPointId = output.seedPointIds[index];
          if (seedPointId) entries.set(outputPointId, seedPointId);
        });
    }
    seeds = entries;
    mirrorSourcePointsByProgram.set(program, seeds);
  }
  let source = pointId;
  for (let step = 0; step < seeds.size && seeds.has(source); step += 1)
    source = seeds.get(source)!;
  return source;
}

/**
 * T15c (issue 15, [TECH] T-6 + R-7; review R-1): the axis authority
 * variables a drag frame keeps fixed in its first stage: every mirror axis in
 * the dragged component (a chain's upstream axes included: their authority
 * is in the component through the projection), except an axis the drag
 * requests to move. A drag requests an axis when the dragged points, or the
 * mirror source of a dragged copy (`mirrorSourcePoint`), meet the axis's
 * points: its endpoints and every point in their declared-join class (a
 * shared point, or a satisfied `coincident` in the last accepted frame,
 * `declaredJoinClasses`: blocked or unsatisfied ones do not join), those
 * points' variables or their authority (the source of a derived axis, also
 * through a chain). Empty without a line axis in the component.
 */
export function dragFrozenAxisVariables(
  program: SketchCompiledSolveProgram,
  snapshot: SolvedSketchSnapshot,
  component: SketchCompiledSolveComponent | null,
  draggedVariableIndices: readonly number[],
): ReadonlySet<number> {
  const axes = mirrorAxisVariables(program);
  if (axes.length === 0) return NO_FROZEN_VARIABLES;
  const inComponent = component ? new Set(component.variableIndices) : null;
  const variablesOf = (pointId: SketchPointId) =>
    pointVariableIndices(program.system.pointRecords.get(pointId));
  const draggedSet = new Set(draggedVariableIndices);
  const draggedPoints = program.definition.points.filter((point) =>
    variablesOf(point.pointId).some((index) => draggedSet.has(index)),
  );
  const dragged = new Set([
    ...draggedVariableIndices,
    ...draggedPoints.flatMap((point) =>
      variablesOf(mirrorSourcePoint(program, point.pointId)),
    ),
  ]);
  const classes = declaredJoinClasses(program.definition, snapshot);
  const frozen = new Set<number>();
  for (const axis of axes) {
    if (inComponent && !axis.authority.some((index) => inComponent.has(index)))
      continue;
    const roots = new Set(
      axis.pointIds.map((pointId) => classes.find(pointId)),
    );
    const joined = program.definition.points.flatMap((point) =>
      roots.has(classes.find(point.pointId)) ? variablesOf(point.pointId) : [],
    );
    if (
      [
        ...axis.variables,
        ...axis.authority,
        ...joined,
        ...program.system.parameterProjection.projectVariableIndices(joined),
      ].some((index) => dragged.has(index))
    )
      continue;
    for (const index of axis.authority) frozen.add(index);
  }
  return frozen;
}

/**
 * T15c: the components among those holding a `frozen` variable that a
 * rejected stage-1 batch result cannot be accepted in: an unsatisfied
 * requirement or a rejecting error (not tolerated by the start-state rule)
 * targets them. A rejection that cannot be attributed to a component
 * releases every such component (today's solve for all of them).
 */
export function rejectedAxisComponents(
  program: SketchCompiledSolveProgram,
  snapshot: SolvedSketchSnapshot,
  frozen: ReadonlySet<number>,
) {
  const holding = program.components.filter((component) =>
    component.variableIndices.some((index) => frozen.has(index)),
  );
  const unsatisfied = new Set<string>([
    ...snapshot.constraintStatuses.flatMap((entry) =>
      isAcceptedConstraintStatus(entry.status) ? [] : [entry.constraintId],
    ),
    ...snapshot.dimensionStatuses.flatMap((entry) =>
      entry.status === "unsatisfied" ? [entry.dimensionId] : [],
    ),
  ]);
  const names = (component: SketchCompiledSolveComponent, id: string) =>
    component.equationIndices.some(
      (equationIndex) =>
        program.system.scalarConstraints[equationIndex]!.id === id,
    );
  const targets = (
    component: SketchCompiledSolveComponent,
    target: SketchSolveDiagnostic["target"],
  ) => {
    switch (target?.kind) {
      case "entity":
        return component.entityIds.includes(target.entityId);
      case "point":
        return component.pointIds.includes(target.pointId);
      case "constraint":
        return names(component, target.constraintId);
      case "dimension":
        return names(component, target.dimensionId);
      default:
        return false;
    }
  };
  const tolerated = startFailedDerivedDiagnostics.get(snapshot);
  const rejecting = snapshot.diagnostics.filter(
    (diagnostic) =>
      diagnostic.severity === "error" && !tolerated?.has(diagnostic),
  );
  const rejected = new Set(
    program.components.filter(
      (component) =>
        [...unsatisfied].some((id) => names(component, id)) ||
        rejecting.some((diagnostic) => targets(component, diagnostic.target)),
    ),
  );
  const unattributed =
    rejected.size === 0 ||
    rejecting.some(
      (diagnostic) =>
        !program.components.some((component) =>
          targets(component, diagnostic.target),
        ),
    );
  return unattributed
    ? holding
    : holding.filter((component) => rejected.has(component));
}

/**
 * T15c (issue 15: "preserve the axis unless requirements force it to
 * move"; [TECH] T-6 + R-7): a batch solve (commit, live solve, session
 * start, Undo/Redo/reopen; B4 inside each stage) in two stages.
 * - Stage 1: the solve with every mirror line axis's authority variables
 *   frozen. Kept whenever it is accepted.
 * - Stage 2, only for the components holding an axis whose stage-1 result
 *   is not accepted (component-local): today's unrestricted solve of those
 *   components' equations from their start values; every other component
 *   keeps its stage-1 values. It is reported whether or not it is accepted
 *   (a rejected result is today's rejected result for those components).
 * A sketch without a mirror line axis runs the unchanged single solve.
 */
export function solveProgramValuesPreferringAxes(
  program: SketchCompiledSolveProgram,
  startValues: Float64Array,
) {
  const axes = mirrorAxisVariables(program);
  if (axes.length === 0) return solveProgramValues(program, startValues);
  const frozen = new Set(axes.flatMap((axis) => axis.authority));
  const preferred = solveProgramValues(program, startValues, { frozen });
  const snapshot = preferred.result.solvedSnapshot;
  if (isAcceptableSolvedSnapshot(snapshot)) return preferred;
  const rejected = rejectedAxisComponents(program, snapshot, frozen);
  if (rejected.length === 0) return preferred;
  const restart = cloneValues(preferred.solved.values);
  for (const component of rejected)
    for (const index of component.variableIndices)
      restart[index] = startValues[index]!;
  return solveProgramValues(program, restart, { components: rejected });
}
