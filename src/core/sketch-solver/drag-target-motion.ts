import type { DraggedPointCandidate } from "./drag-candidates";
import { reevaluateDraggedPointCandidate } from "./drag-candidates";
import { resolveDragTargetFrame } from "./drag-target-frame";
import { splineTangentStateKey } from "./parameter-projection";
import type {
  SketchDraggedPointSolveResult,
  SketchDragTarget,
} from "./solve-types";
import {
  cloneValues,
  getPoint,
  length,
  makeDiagnostic,
  subtract,
} from "./solver-geometry";
import type { SketchCompiledSolveSession } from "./system-types";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";

// --- Helpers for the generalized updateCompiledSketchSolveSession ---

/**
 * T17i: the exact-zero pin is a penalty (½ v²), so its frame converges to
 * the solver tolerance (≈ 1e-7 after a run of capture frames), not to the
 * exactly [0, 0] the target promises (T12d D4). Like the point exact-reach
 * step (T13a2 d1), the pinned tangent slots are set to exactly 0 and the
 * candidate is re-judged; it is kept only if still accepted. A rejected
 * zeroed candidate silently keeps the solver's near-zero vector (as d1
 * keeps its unpinned candidate); no fixture reaches that branch.
 */
export function exactZeroTangentFrame(
  session: SketchCompiledSolveSession,
  resolved: NonNullable<ReturnType<typeof resolveDragTargetFrame>>,
  frame: DraggedPointCandidate | null,
): DraggedPointCandidate | null {
  if (!frame?.accepted) return frame;
  if (
    resolved.draggedVariableIndices.every((index) => frame.values[index] === 0)
  )
    return frame;
  const values = cloneValues(frame.values);
  for (const index of resolved.draggedVariableIndices) values[index] = 0;
  const zeroed = reevaluateDraggedPointCandidate(session, values);
  return zeroed.accepted ? { ...zeroed, curvature: frame.curvature } : frame;
}

export function dragTargetDiagnosticTarget(
  target: SketchDragTarget,
): { kind: "point"; pointId: SketchPointId } | { kind: "entity"; entityId: SketchEntityId } {
  switch (target.kind) {
    case "sketchPoint":
      return { kind: "point", pointId: target.pointId };
    case "sketchTranslate":
      return { kind: "point", pointId: target.pointIds[0]! as SketchPointId };
    case "sketchRadius":
      return { kind: "entity", entityId: target.entityId };
    case "sketchTangentVector":
      return { kind: "entity", entityId: target.entityId };
  }
}

export function dragTargetLabel(target: SketchDragTarget): string {
  switch (target.kind) {
    case "sketchPoint":
      return target.pointId;
    case "sketchTranslate":
      return `translate_${target.pointIds[0]}`;
    case "sketchRadius":
      return `radius_${target.entityId}`;
    case "sketchTangentVector":
      return `tangent_${target.entityId}_${target.occurrenceId}`;
  }
}

export function validateDragTarget(
  session: SketchCompiledSolveSession,
  target: SketchDragTarget,
): SketchDraggedPointSolveResult | null {
  switch (target.kind) {
    case "sketchPoint": {
      if (
        !session.program.definition.points.some(
          (p) => p.pointId === target.pointId,
        )
      ) {
        return {
          kind: "blocked",
          reason: "missingPoint",
          solvedSnapshot: null,
          diagnostics: [
            makeDiagnostic(
              "drag-target-missing-point",
              "error",
              `Dragged point ${target.pointId} does not exist in the sketch definition.`,
              { kind: "point", pointId: target.pointId },
            ),
          ],
        };
      }
      if (!target.position.every(Number.isFinite)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Dragged point frame contains a non-finite target and cannot be solved.",
              { kind: "point", pointId: target.pointId },
            ),
          ],
        };
      }
      if (!session.program.system.pointRecords.get(target.pointId)) {
        return {
          kind: "blocked",
          reason: "missingPoint",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-missing-point",
              "error",
              `Dragged point ${target.pointId} does not exist in the compiled solve program.`,
              { kind: "point", pointId: target.pointId },
            ),
          ],
        };
      }
      return null;
    }
    case "sketchTranslate": {
      if (!target.delta.every(Number.isFinite)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Translate drag frame contains a non-finite delta and cannot be solved.",
              { kind: "point", pointId: target.pointIds[0]! as SketchPointId },
            ),
          ],
        };
      }
      return null;
    }
    case "sketchRadius": {
      if (!Number.isFinite(target.targetRadius)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Radius drag frame contains a non-finite target and cannot be solved.",
              { kind: "entity", entityId: target.entityId },
            ),
          ],
        };
      }
      return null;
    }
    case "sketchTangentVector": {
      if (!target.targetVector.every(Number.isFinite)) {
        return {
          kind: "blocked",
          reason: "nonConvergent",
          solvedSnapshot: session.lastAcceptedSnapshot,
          diagnostics: [
            makeDiagnostic(
              "drag-target-nonconvergent",
              "warning",
              "Tangent vector drag frame contains a non-finite target and cannot be solved.",
              { kind: "entity", entityId: target.entityId },
            ),
          ],
        };
      }
      return null;
    }
  }
}

/** T12b: motion metric for substep subdivision. */
export type DragTargetMotion = {
  distance: number;
  startPosition?: SketchPoint2D;
  totalDelta?: SketchPoint2D;
  startRadius?: number;
  totalRadiusDelta?: number;
  startVector?: SketchPoint2D;
  totalVectorDelta?: SketchPoint2D;
};

export function dragTargetMotion(
  session: SketchCompiledSolveSession,
  target: SketchDragTarget,
): DragTargetMotion | null {
  const system = session.program.system;
  const projectedValues = system.parameterProjection.projectValues(
    session.values,
  );
  switch (target.kind) {
    case "sketchPoint": {
      const record = system.pointRecords.get(target.pointId);
      if (!record) return null;
      const startPosition = getPoint(projectedValues, record);
      const totalDelta = subtract(target.position, startPosition);
      return { distance: length(totalDelta), startPosition, totalDelta };
    }
    case "sketchTranslate": {
      return { distance: length(target.delta), totalDelta: target.delta };
    }
    case "sketchRadius": {
      const entityState = system.entityStates.get(target.entityId);
      if (!entityState) return null;
      const startRadius = projectedValues[entityState.baseIndex]!;
      const totalRadiusDelta = target.targetRadius - startRadius;
      return {
        distance: Math.abs(totalRadiusDelta),
        startRadius,
        totalRadiusDelta,
      };
    }
    case "sketchTangentVector": {
      const tangentState = system.splineTangentStates.get(
        splineTangentStateKey(
          target.entityId,
          target.occurrenceId,
        ),
      );
      if (!tangentState) return null;
      const startVector: SketchPoint2D = [
        projectedValues[tangentState.baseIndex]!,
        projectedValues[tangentState.baseIndex + 1]!,
      ];
      const totalVectorDelta = subtract(target.targetVector, startVector);
      return {
        distance: length(totalVectorDelta),
        startVector,
        totalVectorDelta,
      };
    }
  }
}

/** T12b: interpolate a drag target to a substep fraction. */
export function interpolateDragTarget(
  target: SketchDragTarget,
  motion: DragTargetMotion,
  fraction: number,
): SketchDragTarget {
  switch (target.kind) {
    case "sketchPoint":
      return {
        kind: "sketchPoint",
        pointId: target.pointId,
        position: [
          motion.startPosition![0] + motion.totalDelta![0] * fraction,
          motion.startPosition![1] + motion.totalDelta![1] * fraction,
        ],
      };
    case "sketchTranslate":
      return {
        kind: "sketchTranslate",
        pointIds: target.pointIds,
        delta: [
          motion.totalDelta![0] * fraction,
          motion.totalDelta![1] * fraction,
        ],
      };
    case "sketchRadius":
      return {
        kind: "sketchRadius",
        entityId: target.entityId,
        targetRadius:
          motion.startRadius! + motion.totalRadiusDelta! * fraction,
      };
    case "sketchTangentVector":
      return {
        kind: "sketchTangentVector",
        entityId: target.entityId,
        occurrenceId: target.occurrenceId,
        targetVector: [
          motion.startVector![0] + motion.totalVectorDelta![0] * fraction,
          motion.startVector![1] + motion.totalVectorDelta![1] * fraction,
        ],
        exactZero: target.exactZero,
      };
  }
}

export function blockedDragResult(
  session: SketchCompiledSolveSession,
  frame: DraggedPointCandidate | null,
  target: SketchDragTarget,
): SketchDraggedPointSolveResult {
  return {
    kind: "blocked",
    reason: "nonConvergent",
    solvedSnapshot: session.lastAcceptedSnapshot,
    diagnostics: [
      ...(frame?.materialized.diagnostics ?? []),
      makeDiagnostic(
        "drag-target-nonconvergent",
        "warning",
        "Dragged point frame could not converge to a valid constrained solution.",
        dragTargetDiagnosticTarget(target),
      ),
    ],
  };
}
