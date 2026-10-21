import captured from "../../../test/fixtures/sketch-drag-conditioning.json";
import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import {
  compileSketchSolveProgram,
  startCompiledSketchSolveSession,
  updateCompiledSketchSolveSession,
} from "@/contracts/sketch/solver-core";

type CompileInput = Parameters<typeof compileSketchSolveProgram>[0];
type CapturedDragCase = {
  scenario: "drag-large" | "drag-corner" | "drag-small";
  compileOptions: Pick<CompileInput, "degenerateSplineSpanDragPointId">;
  targets: [
    Parameters<typeof updateCompiledSketchSolveSession>[1],
    number | null,
  ][];
  baselineReleasePoints: [SketchPointId, number, number][];
  baselineReleaseSplines: {
    entityId: SketchEntityId;
    poles: SketchPoint2D[][];
  }[];
  baselineFrameDigests: string[];
  baselineKinds: ("solved" | "blocked")[];
};

// Captured through the real EditorEventLoop, including its published offset
// plans. One shared definition replaces three duplicate native-document loads.
// These are trusted, checked-in numeric fixture values, not transport input.
export const dragConditioningFixture = captured as unknown as {
  compile: CompileInput;
  priorSolvedSnapshot: Parameters<
    typeof startCompiledSketchSolveSession
  >[0]["priorSolvedSnapshot"];
  initialValues: number[];
  cases: CapturedDragCase[];
};

export function startConditioningReplay(row: CapturedDragCase) {
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_conditioning_replay",
    program: compileSketchSolveProgram({
      ...dragConditioningFixture.compile,
      ...row.compileOptions,
    }),
    priorSolvedSnapshot: dragConditioningFixture.priorSolvedSnapshot,
  });
  if (started.kind !== "started")
    throw new Error("Captured drag must initialize");
  // Snapshot materialization differs by up to 4.4e-16. Restore the exact native
  // starting values so a long BFGS trajectory and the small-delta approval are
  // independent of a second snapshot round trip.
  started.session.values.set(dragConditioningFixture.initialValues);
  return started.session;
}
