import type {
  SolvedSketchSnapshot,
  SketchDefinition,
  SolvedOffsetFramePlanRecord,
} from "@/contracts/sketch/schema";
import {
  updateCompiledSketchSolveSession,
  solveSketchDefinitionWithDraggedPointTarget,
  sketchDraggedPointHasFreeDof,
  startCompiledSketchSolveSession,
  compileSketchSolveProgram,
} from "@/core/sketch-solver";
import type {
  SketchCompiledSolveSession,
  SketchDragTarget,
} from "@/core/sketch-solver";
import type { SketchDragFeedback, SketchSessionState } from "./types";
import type { SketchPoint } from "@/contracts/modeling/schema";
import type {
  ProjectedSketchReferenceRecord,
  SolverTolerancePolicy,
} from "@/contracts/solver/schema";
import { evaluateAuthoredSketchDerivations } from "@/core/modeling/sketch-dimension-expressions";
import type { AuthoredSketchDerivationSettings } from "@/core/modeling/sketch-dimension-expressions";
import type { SketchDragIntent } from "./drag-intent";
import { resolveSketchDefinitionForSolve } from "./session-live-solve";
import {
  CONSTRAINED_DRAG_BLOCKED_MESSAGE,
  CONSTRAINED_DRAG_REQUEST_EPSILON,
  CONSTRAINED_DRAG_MOVE_FRACTION,
} from "./session-definition";
import {
  applySolvedSketchToDefinition,
  applyPointPositionsToDefinition,
} from "./definition-patches";
import { carriedOffsetPlans } from "@/contracts/sketch/offset-publication";

/** T12f: structured drag edit result with optional feedback cue. */
type SolveDragEditResult =
  | {
      kind: "pending";
      solvedSnapshot: SolvedSketchSnapshot;
      interactiveSolveSession: SketchCompiledSolveSession;
    }
  | {
      kind: "accepted";
      definition: SketchDefinition;
      solvedSnapshot?: SolvedSketchSnapshot;
      interactiveSolveSession: SketchCompiledSolveSession | null;
    }
  | {
      kind: "blocked";
      message: string;
      /** T12f: structured feedback for the viewport cue (issue 05). */
      feedback?: SketchDragFeedback;
    };

// Editor translation inputs are measured from DISPLAYED geometry. While a
// preview is held, convert that absolute goal to new motion, not a second copy
// of the same relative delta. The solver still receives incremental deltas.
const pendingTranslationGoals = new WeakMap<SketchCompiledSolveSession, SketchPoint>();

/**
 * T12b: generalized drag edit that routes every intent through the solver.
 * T12f: every blocked result includes structured feedback for the viewport
 * cue (issue 05) with kind, target position and short diagnostic text.
 */
export function solveDragEdit(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: AuthoredSketchDerivationSettings,
  documentVariables: SketchSessionState["documentVariables"],
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  interactiveSolveSession?: SketchCompiledSolveSession | null,
  complete?: true,
): Exclude<SolveDragEditResult, { kind: "pending" }>;

export function solveDragEdit(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: AuthoredSketchDerivationSettings,
  documentVariables: SketchSessionState["documentVariables"],
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  interactiveSolveSession: SketchCompiledSolveSession | null,
  complete: boolean,
): SolveDragEditResult;

export function solveDragEdit(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: AuthoredSketchDerivationSettings,
  documentVariables: SketchSessionState["documentVariables"],
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  interactiveSolveSession: SketchCompiledSolveSession | null = null,
  complete = true,
): SolveDragEditResult {
  if (intent.kind === "radius") {
    const arc = definition.entities.find(e => e.entityId === intent.entityId && e.kind === "arc");
    const mirrored = definition.derivedRelationships?.some(r => r.kind === "mirror" && r.outputs.some(o => o.outputEntityId === intent.entityId));
    // Production arc tools bind endpoints; mirror outputs are coupled through
    // their owning relationship instead. Unbound native inputs would otherwise
    // leave authored endpoints untouched while reporting a completed radius edit.
    if (arc?.kind === "arc" && !mirrored && (!definition.dimensions.some(d => d.kind === "arcStartPointCoincident" && d.entityId === arc.entityId && d.pointId === arc.startPointId) || !definition.dimensions.some(d => d.kind === "arcEndPointCoincident" && d.entityId === arc.entityId && d.pointId === arc.endPointId)))
      return { kind: "blocked", message: "Arc radius editing requires endpoint bindings." };
  }
  // Unconstrained fast path: no constraints, dimensions or mirrors (T15d:
  // a mirror drag always solves).
  if (usesUnconstrainedDragFastPath(definition)) {
    return applyUnconstrainedDrag(definition, intent, dragTarget, derivation);
  }

  let solveSession = interactiveSolveSession;
  if (!solveSession) {
    const started = startInteractiveSolveSessionForDrag(
      definition,
      projectedReferences,
      tolerances,
      derivation,
      documentVariables,
      intent,
    );
    if (started.kind === "unacceptable") {
      return {
        kind: "blocked",
        message: started.message,
        feedback: {
          kind: "failed",
          target: dragFeedbackTarget(definition, intent),
          text: "Sketch solve failed.",
        },
      };
    }
    solveSession = started.session;
  }

  let solverTarget = dragTarget;
  let translationGoal: SketchPoint | undefined;
  if (solveSession && dragTarget.kind === "sketchTranslate") {
    const pointId = dragTarget.pointIds[0];
    const displayed = definition.points.find((point) => point.pointId === pointId)?.position;
    const accepted = solveSession.lastAcceptedSnapshot.solvedPoints.find((point) => point.pointId === pointId)?.solvedPosition;
    if (displayed && accepted) {
      translationGoal = [displayed[0] + dragTarget.delta[0], displayed[1] + dragTarget.delta[1]];
      const previous = pendingTranslationGoals.get(solveSession) ?? accepted;
      solverTarget = { ...dragTarget, delta: [translationGoal[0] - previous[0], translationGoal[1] - previous[1]] };
    }
  }

  const solved = solveSession
    ? updateCompiledSketchSolveSession(
        solveSession,
        solverTarget,
        // T13a2: only the release frame runs the exact-reach step.
        complete ? 1e-4 : null,
      )
    : dragTarget.kind === "sketchPoint"
      ? solveSketchDefinitionWithDraggedPointTarget({
          definition: resolveSketchDefinitionForSolve(
            definition,
            documentVariables,
          ),
          projectedReferences,
          dragTarget,
          tolerances,
          ...derivation,
          partialSolvePolicy: "failOnConflict",
          targetTolerance: 1e-4,
        })
      : {
          kind: "blocked" as const,
          reason: "missingPoint" as const,
          solvedSnapshot: null,
          diagnostics: [],
        };

  if (solveSession) {
    if (solved.kind === "pending" && translationGoal)
      pendingTranslationGoals.set(solveSession, translationGoal);
    else pendingTranslationGoals.delete(solveSession);
  }
  if (solved.kind === "pending") {
    return {
      kind: "pending",
      solvedSnapshot: solved.solvedSnapshot,
      interactiveSolveSession: solveSession!,
    };
  }

  if (solved.kind === "blocked") {
    return {
      kind: "blocked",
      message: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
      feedback: {
        kind: "failed",
        target: dragFeedbackTarget(definition, intent),
        text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
      },
    };
  }

  // D6/T12f: constrained-movement feedback for every intent (not just point).
  const constrainedFeedback = detectConstrainedMovementFeedback(
    definition,
    intent,
    dragTarget,
    solved.solvedSnapshot,
    solveSession,
  );
  if (constrainedFeedback) {
    return {
      kind: "blocked",
      message: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
      feedback: constrainedFeedback,
    };
  }

  return {
    kind: "accepted",
    definition: applySolvedSketchToDefinition(
      definition,
      solved.solvedSnapshot,
      derivation,
    ),
    solvedSnapshot: solved.solvedSnapshot,
    interactiveSolveSession: solveSession,
  };
}

/**
 * T12f: detect constrained-movement feedback for every intent type.
 * Returns structured feedback when the drag target barely moved and has no
 * free DOF, or null when the motion is normal (partial constraint with
 * movement toward the pointer).
 */
function detectConstrainedMovementFeedback(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  solvedSnapshot: SolvedSketchSnapshot,
  solveSession: SketchCompiledSolveSession | null,
): SketchDragFeedback | null {
  if (!solveSession) return null;

  switch (intent.kind) {
    case "point": {
      if (dragTarget.kind !== "sketchPoint") return null;
      const solvedPoint = solvedSnapshot.solvedPoints.find(
        (p) => p.pointId === intent.pointId,
      );
      const previousPos = definition.points.find(
        (p) => p.pointId === intent.pointId,
      )?.position;
      if (!solvedPoint || !previousPos) return null;
      const requested = Math.hypot(
        dragTarget.position[0] - previousPos[0],
        dragTarget.position[1] - previousPos[1],
      );
      const moved = Math.hypot(
        solvedPoint.solvedPosition[0] - previousPos[0],
        solvedPoint.solvedPosition[1] - previousPos[1],
      );
      if (
        requested > CONSTRAINED_DRAG_REQUEST_EPSILON &&
        moved < requested * CONSTRAINED_DRAG_MOVE_FRACTION &&
        !sketchDraggedPointHasFreeDof(solveSession, intent.pointId)
      ) {
        return {
          kind: "constrained",
          target: previousPos,
          text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
        };
      }
      return null;
    }
    case "translate": {
      if (dragTarget.kind !== "sketchTranslate") return null;
      const delta = dragTarget.delta;
      const requested = Math.hypot(delta[0], delta[1]);
      if (requested <= CONSTRAINED_DRAG_REQUEST_EPSILON) return null;
      // Check if the first point barely moved.
      const firstPointId = intent.pointIds[0];
      if (!firstPointId) return null;
      const previousPos = definition.points.find(
        (p) => p.pointId === firstPointId,
      )?.position;
      const solvedPoint = solvedSnapshot.solvedPoints.find(
        (p) => p.pointId === firstPointId,
      );
      if (!previousPos || !solvedPoint) return null;
      const moved = Math.hypot(
        solvedPoint.solvedPosition[0] - previousPos[0],
        solvedPoint.solvedPosition[1] - previousPos[1],
      );
      if (
        moved < requested * CONSTRAINED_DRAG_MOVE_FRACTION &&
        !sketchDraggedPointHasFreeDof(solveSession, firstPointId)
      ) {
        return {
          kind: "constrained",
          target: previousPos,
          text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
        };
      }
      return null;
    }
    case "radius": {
      if (dragTarget.kind !== "sketchRadius") return null;
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc"))
        return null;
      const currentRadius = entity.kind === "circle" ? entity.radius : null;
      if (currentRadius === null) return null;
      const requestedDelta = Math.abs(dragTarget.targetRadius - currentRadius);
      const solvedEntity = solvedSnapshot.solvedEntities?.find(
        (e) => e.entityId === intent.entityId,
      );
      const solvedRadius =
        solvedEntity?.kind === "circle"
          ? solvedEntity.solvedRadius
          : currentRadius;
      const movedDelta = Math.abs(solvedRadius - currentRadius);
      if (
        requestedDelta > CONSTRAINED_DRAG_REQUEST_EPSILON &&
        movedDelta < requestedDelta * CONSTRAINED_DRAG_MOVE_FRACTION
      ) {
        // Radius is constrained — show cue at rim position.
        const center = definition.points.find(
          (p) => p.pointId === entity.centerPointId,
        );
        const target: SketchPoint = center
          ? [center.position[0] + currentRadius, center.position[1]]
          : [0, 0];
        return {
          kind: "constrained",
          target,
          text: CONSTRAINED_DRAG_BLOCKED_MESSAGE,
        };
      }
      return null;
    }
    case "tangentVector": {
      // Tangent vectors are rarely fully constrained; the solver's acceptance
      // already handles the common cases. Skip constrained-movement feedback
      // for tangent vector intents (no DOF probe available for vectors).
      return null;
    }
  }
}

/**
 * T12f: compute the feedback cue target position from the intent's current
 * geometry position (before the drag frame).
 */
function dragFeedbackTarget(
  definition: SketchDefinition,
  intent: SketchDragIntent,
): SketchPoint {
  switch (intent.kind) {
    case "point": {
      const p = definition.points.find((pt) => pt.pointId === intent.pointId);
      return p?.position ?? [0, 0];
    }
    case "translate": {
      const p = definition.points.find(
        (pt) => pt.pointId === intent.pointIds[0],
      );
      return p?.position ?? [0, 0];
    }
    case "radius": {
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || (entity.kind !== "circle" && entity.kind !== "arc"))
        return [0, 0];
      const center = definition.points.find(
        (p) => p.pointId === entity.centerPointId,
      );
      const radius = entity.kind === "circle" ? entity.radius : 1;
      return center
        ? [center.position[0] + radius, center.position[1]]
        : [0, 0];
    }
    case "tangentVector": {
      const entity = definition.entities.find(
        (e) => e.entityId === intent.entityId,
      );
      if (!entity || entity.kind !== "spline") return [0, 0];
      const occ = entity.pointOccurrences.find(
        (o) => o.occurrenceId === intent.occurrenceId,
      );
      if (!occ) return [0, 0];
      const fitPoint = definition.points.find((p) => p.pointId === occ.pointId);
      if (!fitPoint) return [0, 0];
      if (occ.tangent.kind === "authored") {
        return [
          fitPoint.position[0] + occ.tangent.vector[0],
          fitPoint.position[1] + occ.tangent.vector[1],
        ];
      }
      return fitPoint.position;
    }
  }
}

/**
 * Whether a drag skips the solver (T12b fast path): nothing in the sketch
 * constrains the dragged geometry. T15d ([TECH] T-3): never with a mirror
 * relationship, whose outputs are coupled to their seeds and axis through
 * the solve (an output drag must move its seed, not be re-derived back).
 */
function usesUnconstrainedDragFastPath(definition: SketchDefinition) {
  return (
    definition.constraints.length === 0 &&
    definition.dimensions.length === 0 &&
    !(definition.derivedRelationships ?? []).some(
      (relationship) => relationship.kind === "mirror",
    )
  );
}

/**
 * Unconstrained fast path: apply the drag target directly to the definition
 * without running the solver. Radius and tangent writes re-evaluate derived
 * copies just like point writes; no subsequent solve is needed to refresh them.
 */
function applyUnconstrainedDrag(
  definition: SketchDefinition,
  intent: SketchDragIntent,
  dragTarget: SketchDragTarget,
  derivation: AuthoredSketchDerivationSettings,
):
  | {
      kind: "accepted";
      definition: SketchDefinition;
      interactiveSolveSession: null;
    }
  | { kind: "blocked"; message: string } {
  switch (intent.kind) {
    case "point": {
      if (dragTarget.kind !== "sketchPoint") break;
      return {
        kind: "accepted",
        definition: applyPointPositionsToDefinition(
          definition,
          [{ pointId: intent.pointId, position: dragTarget.position }],
          derivation,
        ),
        interactiveSolveSession: null,
      };
    }
    case "translate": {
      if (dragTarget.kind !== "sketchTranslate") break;
      const positions = intent.pointIds.map((pointId) => {
        const p = definition.points.find((pt) => pt.pointId === pointId);
        return {
          pointId,
          position: [
            (p?.position[0] ?? 0) + dragTarget.delta[0],
            (p?.position[1] ?? 0) + dragTarget.delta[1],
          ] as SketchPoint,
        };
      });
      return {
        kind: "accepted",
        definition: applyPointPositionsToDefinition(
          definition,
          positions,
          derivation,
        ),
        interactiveSolveSession: null,
      };
    }
    case "radius": {
      if (dragTarget.kind !== "sketchRadius") break;
      return {
        kind: "accepted",
        definition: evaluateAuthoredSketchDerivations({
          ...derivation,
          definition: {
            ...definition,
            entities: definition.entities.map((e) => {
              if (e.entityId !== intent.entityId) return e;
              if (e.kind === "circle")
                return { ...e, radius: Math.max(1e-9, dragTarget.targetRadius) };
              // Unsupported non-circle radius targets are not changed.
              return e;
            }),
          },
        }).definition,
        interactiveSolveSession: null,
      };
    }
    case "tangentVector": {
      if (dragTarget.kind !== "sketchTangentVector") break;
      return {
        kind: "accepted",
        definition: evaluateAuthoredSketchDerivations({
          ...derivation,
          definition: {
            ...definition,
            entities: definition.entities.map((e) => {
              if (e.entityId !== intent.entityId || e.kind !== "spline") return e;
              return {
                ...e,
                pointOccurrences: e.pointOccurrences.map((occ) =>
                  occ.occurrenceId === intent.occurrenceId
                    ? {
                        ...occ,
                        tangent: {
                          kind: "authored" as const,
                          vector: dragTarget.targetVector,
                        },
                      }
                    : occ,
                ),
              };
            }),
          },
        }).definition,
        interactiveSolveSession: null,
      };
    }
  }
  return { kind: "blocked", message: "Unsupported drag intent." };
}

export function startInteractiveSolveSessionForDrag(
  definition: SketchDefinition,
  projectedReferences: readonly ProjectedSketchReferenceRecord[],
  tolerances: SolverTolerancePolicy,
  derivation: AuthoredSketchDerivationSettings,
  documentVariables: SketchSessionState["documentVariables"],
  intent: SketchDragIntent,
  offsetPlans?: readonly SolvedOffsetFramePlanRecord[],
):
  | { kind: "started"; session: SketchCompiledSolveSession | null }
  | { kind: "unacceptable"; message: string; degenerateSpan: boolean } {
  if (usesUnconstrainedDragFastPath(definition)) {
    return { kind: "started", session: null };
  }

  const sessionLabel =
    intent.kind === "point"
      ? intent.pointId
      : intent.kind === "translate"
        ? `translate_${intent.pointIds[0]}`
        : intent.kind === "radius"
          ? `radius_${intent.entityId}`
          : `tangent_${intent.entityId}_${intent.occurrenceId}`;

  // B7: apply carriedOffsetPlans for uniformity with other interactive solve
  // session starts (g5a re-review advisory 5).
  const carried = offsetPlans ? carriedOffsetPlans(offsetPlans) : undefined;

  // T13a: the program solves the resolved numeric values, exactly as the live
  // solve does; authored (literal/expression) values stay in `definition`.
  const started = startCompiledSketchSolveSession({
    sessionId: `interactive_sketch_solve_drag_${sessionLabel}`,
    program: compileSketchSolveProgram({
      definition: resolveSketchDefinitionForSolve(
        definition,
        documentVariables,
      ),
      projectedReferences,
      tolerances,
      ...derivation,
      offsetPlans: carried,
      partialSolvePolicy: "failOnConflict",
      // T17c5 (issue 08 :107): a fit point dragged off its coincident
      // neighbour may recover the degenerate span.
      degenerateSplineSpanDragPointId:
        intent.kind === "point" ? intent.pointId : undefined,
    }),
  });
  return started.kind === "started"
    ? started
    : {
        kind: "unacceptable",
        message: `Geometry can't be dragged until the sketch solves${
          started.diagnostic ? `: ${started.diagnostic.message}` : "."
        }`,
        degenerateSpan:
          started.diagnostic?.code === "invalid-spline-coincident-points",
      };
}
