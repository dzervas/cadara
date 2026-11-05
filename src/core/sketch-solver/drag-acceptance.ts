import { deriveDragBranchInvariants } from "./constrained-drag-stage";
import type { DragBranchInvariants } from "./constrained-drag-stage";
import type { SketchCoreSolveResult } from "./solve-types";
import { hasRejectingError } from "./start-session";
import type {
  SketchCompiledSolveProgram,
  SketchCompiledSolveSession,
} from "./system-types";
import { isAcceptedConstraintStatus } from "@/contracts/sketch/schema";

/**
 * The branch invariants of every hard row and the validity margins at the
 * session's last accepted frame, derived once per accepted values (a
 * session replaces `values` when it accepts a frame) and program.
 */
const branchInvariantsByAcceptedValues = new WeakMap<
  Float64Array,
  { program: SketchCompiledSolveProgram; invariants: DragBranchInvariants }
>();

function acceptedBranchInvariants(session: SketchCompiledSolveSession) {
  const cached = branchInvariantsByAcceptedValues.get(session.values);
  if (cached?.program === session.program) return cached.invariants;
  const invariants = deriveDragBranchInvariants(
    session.program,
    session.program.system.scalarConstraints,
    session.values,
  );
  branchInvariantsByAcceptedValues.set(session.values, {
    program: session.program,
    invariants,
  });
  return invariants;
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
  // Branch and validity margins are derived at the accepted frame. Crossing
  // one, or ending on one previously clear, refuses the frame (policy block).
  // The step additionally observes its path, not only its landing.
  // Every candidate of every drag path is judged here, including the
  // re-checks after an offset rebuild.
  const accepted =
    program.validation.isValid &&
    derivationsValid &&
    constraintsSatisfied &&
    dimensionsSatisfied &&
    !acceptedBranchInvariants(input.session).refuses(input.values);

  return { accepted };
}
