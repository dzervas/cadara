import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type { SketchPoint2D } from "@/contracts/sketch/schema";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import captured from "../../../test/fixtures/sketch-drag-conditioning.json";

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

export function startConditioningReplay(
  row: CapturedDragCase,
  compileOverrides: Pick<CompileInput, "dragStep"> = {},
) {
  const started = startCompiledSketchSolveSession({
    sessionId: "interactive_sketch_solve_conditioning_replay",
    program: compileSketchSolveProgram({
      ...dragConditioningFixture.compile,
      ...row.compileOptions,
      ...compileOverrides,
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

// Uninterrupted GN10 preview, then the real zero-delta/unchanged-goal release
// protocol. Recorded before the continuation port (not recomputed by the test).
// cadara-p4r5.2: re-recorded for the first-order tangency loss (Fillet 17
// tangent A, the arc start contact): the accepted frames move by ≤ 2.6e-3.
export const uninterruptedFarDragDigests = {
  "drag-large": {
    preview: "14ff12bc9d6f2283ea9fba2c74912b38e480a79e18dd55d400bd7f93a9626650",
    release: "c72622b837af488cf4990136f2eb66da77ddbbe974e730972dbdec7a3e1c7703",
  },
  "drag-corner": {
    preview: "fd9dbc7fab96aa82027ce99f12e6e4f2ca1e7f2fb9d07fda9f8ade6264bad2c0",
    release: "fd9dbc7fab96aa82027ce99f12e6e4f2ca1e7f2fb9d07fda9f8ade6264bad2c0",
  },
};
