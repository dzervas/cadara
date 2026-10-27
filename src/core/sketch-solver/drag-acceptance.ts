import { pointLineSignedDistance } from "./line-residuals";
import type { SketchCoreSolveResult } from "./solve-types";
import { hasRejectingError } from "./start-session";
import type {
  SketchCompiledSolveProgram,
  SketchCompiledSolveSession,
} from "./system-types";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";
import type { SolvedSketchSnapshot } from "@/contracts/sketch/schema";

/**
 * T13a2 (issue 05, Q3): the guarded arc quantities of one frame, each a
 * signed value whose sign is the arc's orientation and whose magnitude is
 * its radius:
 * - `radius:<arc>`: an arc's radius variable where it is an authority
 *   variable (radius through zero mirrors the arc);
 * - `side:<tangent>`: for a line↔arc tangent, the signed distance from the
 *   line to the arc's centre; the centre is a radius away from the line, so
 *   the side changes only through radius zero (the arc turns inside out,
 *   e.g. a collapsing fillet). A point-defined arc's radius is a distance
 *   (never negative), so this is its radius-through-zero signal.
 * The minor/major sweep (start×end about the centre) is deliberately not
 * guarded: it changes on a legitimate sweep through 180° and is noise on a
 * semicircle.
 */
export function guardedArcQuantities(
  program: SketchCompiledSolveProgram,
  values: Float64Array,
  snapshot: SolvedSketchSnapshot,
) {
  const signs = new Map<string, number>();
  const authority = new Set(
    program.system.parameterProjection.authorityVariableIndices,
  );
  for (const state of program.system.entityStates.values()) {
    if (state.kind === "arc" && authority.has(state.baseIndex)) {
      signs.set(`radius:${state.entityId}`, values[state.baseIndex]!);
    }
  }
  const points = new Map(
    snapshot.solvedPoints.map((point) => [point.pointId, point.solvedPosition]),
  );
  const arcCenters = new Map(
    snapshot.solvedEntities.flatMap((entity) =>
      entity.kind === "arc" ? [[entity.entityId, entity.centerPosition]] : [],
    ),
  );
  const entities = new Map(
    program.definition.entities.map((entity) => [entity.entityId, entity]),
  );
  for (const constraint of program.definition.constraints) {
    if (constraint.kind !== "tangent") continue;
    const [first, second] = constraint.entityIds.map((id) => entities.get(id));
    const line =
      first?.kind === "lineSegment"
        ? first
        : second?.kind === "lineSegment"
          ? second
          : null;
    const arc =
      first?.kind === "arc" ? first : second?.kind === "arc" ? second : null;
    if (!line || !arc) continue;
    const center = arcCenters.get(arc.entityId);
    const start = points.get(line.startPointId);
    const end = points.get(line.endPointId);
    if (!center || !start || !end) continue;
    signs.set(
      `side:${constraint.constraintId}`,
      pointLineSignedDistance(center, start, end),
    );
  }
  return signs;
}

/**
 * Whether a frame flips or collapses a guarded arc relative to the last
 * accepted frame (issue 05: no flips):
 * - **flip**: exact sign comparison, no tolerance. A previous sign of 0 is
 *   not compared (nothing to preserve); a next sign of 0 differs from a
 *   previous ±1 and is a flip, e.g. a tangent line shortened through zero
 *   length or a centre landing exactly on its tangent line.
 * - **collapse** (review R-1): a magnitude (radius) falling below the
 *   document modeling tolerance τ, the degenerate boundary (the same rule
 *   as "no piece shorter than τ"). Minimum motion otherwise parks an arc at
 *   radius ≈ 0, where the tangent residual's gradient degenerates and
 *   later frames cannot leave it. It applies only when the previous
 *   accepted magnitude was at least τ, so a sketch that already holds such
 *   an arc is not frozen: that arc is then only flip-guarded.
 */
export function guardedArcFlippedOrCollapsed(input: {
  program: SketchCompiledSolveProgram;
  previous: { values: Float64Array; snapshot: SolvedSketchSnapshot };
  next: { values: Float64Array; snapshot: SolvedSketchSnapshot };
}) {
  const tau = input.program.modelingTolerance;
  const previous = guardedArcQuantities(
    input.program,
    input.previous.values,
    input.previous.snapshot,
  );
  const next = guardedArcQuantities(
    input.program,
    input.next.values,
    input.next.snapshot,
  );
  return [...previous].some(([key, before]) => {
    const after = next.get(key);
    if (after === undefined) return false;
    const flipped =
      Math.sign(before) !== 0 && Math.sign(after) !== Math.sign(before);
    const collapsed = Math.abs(before) >= tau && Math.abs(after) < tau;
    return flipped || collapsed;
  });
}

export function createDraggedPointAcceptance(input: {
  session: SketchCompiledSolveSession;
  values: Float64Array;
  materialized: SketchCoreSolveResult;
}) {
  const program = input.session.program;
  const constraintsSatisfied =
    input.materialized.solvedSnapshot.constraintStatuses.every((status) =>
      isAcceptedConstraintStatus(status.status),
    );
  const dimensionsSatisfied =
    input.materialized.solvedSnapshot.dimensionStatuses.every(
      (status) => status.status !== "unsatisfied",
    );
  // T15b (T-16): a derived failure already present at the frame's start is tolerated.
  const derivationsValid = !hasRejectingError(
    input.materialized.solvedSnapshot,
  );
  // D1 (minimum-motion-sketch-drag): the cursor is a SOFT objective and is never
  // part of frame acceptance. A frame is accepted whenever the authored (hard)
  // constraints and dimensions are satisfied within tolerance, regardless of how
  // close the dragged point reached the cursor. `targetDistance` is intentionally
  // dropped from acceptance so a feasible-but-lagging frame is `solved`, not
  // `blocked`; `blocked` is reserved for invalid/non-convergent solves.
  // T13a2 (issue 05, no flips): a frame that flips or collapses a guarded
  // arc relative to the last accepted frame is not accepted either.
  const accepted =
    program.validation.isValid &&
    derivationsValid &&
    constraintsSatisfied &&
    dimensionsSatisfied &&
    !guardedArcFlippedOrCollapsed({
      program,
      previous: {
        values: input.session.values,
        snapshot: input.session.lastAcceptedSnapshot,
      },
      next: {
        values: input.values,
        snapshot: input.materialized.solvedSnapshot,
      },
    });

  return { accepted };
}
