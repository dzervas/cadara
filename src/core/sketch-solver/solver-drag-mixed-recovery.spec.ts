import { expect, test } from "vitest";
import type { SketchPointId } from "@/contracts/shared/ids";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { traceSketchSolverForTest } from "./solve-tracing";
import { updateCompiledSketchSolveSession } from "./update-session";
import { type SketchDraggedPointTarget } from "./solve-types";
// Logic lane: exact compiled-session inputs from the E2E-2 collapse / recover
// pointer paths (acceptance-mixed-topology.spec.ts:424-501). The retained
// geometry includes the previously authored interior tangent and arc joins.

import captured from "../../../test/fixtures/sketch-drag-mixed-recovery.json";

type CapturedSession = {
  stage: "drop" | "apart";
  compile: Parameters<typeof compileSketchSolveProgram>[0];
  priorSolvedSnapshot: Parameters<
    typeof startCompiledSketchSolveSession
  >[0]["priorSolvedSnapshot"];
  initialValues: number[];
  fitIds: SketchPointId[];
  frames: { target: SketchDraggedPointTarget; tolerance: number | null }[];
  baselineFrameKinds: ("solved" | "blocked")[];
};

for (const input of captured.sessions as unknown as CapturedSession[]) {
  test(`mixed outline ${input.stage}: preserve baseline recovery and exact release through the real pointer path`, () => {
    const started = startCompiledSketchSolveSession({
      sessionId: "interactive_sketch_solve_mixed_recovery",
      program: compileSketchSolveProgram(input.compile),
      priorSolvedSnapshot: input.priorSolvedSnapshot,
    });
    expect(started.kind).toBe("started");
    if (started.kind !== "started") return;
    started.session.values.set(input.initialValues);
    const before = started.session.lastAcceptedSnapshot;
    for (const [index, frame] of input.frames.entries()) {
      const trace = traceSketchSolverForTest(() =>
        updateCompiledSketchSolveSession(
          started.session,
          frame.target,
          frame.tolerance,
        ),
      );
      expect(trace.result.kind, `frame ${index}`).toBe(
        input.baselineFrameKinds[index],
      );
    }
    const snapshot = started.session.lastAcceptedSnapshot;
    expect(
      snapshot.constraintStatuses.every((s) => s.status === "satisfied"),
    ).toBe(true);
    expect(
      snapshot.dimensionStatuses.every((s) => s.status === "driving"),
    ).toBe(true);
    const positions = new Map(
      snapshot.solvedPoints.map((p) => [p.pointId, p.solvedPosition]),
    );
    const [, b, c] = input.fitIds.map((id) => positions.get(id)!);
    const release = input.frames.at(-1)!;
    expect(
      positions.get(release.target.pointId),
      "release reaches the actual hovered point's cursor exactly",
    ).toEqual(release.target.position);
    if (input.stage === "drop") {
      expect(c, "fit 3 drops exactly onto fit 2").toEqual(b);
    } else {
      for (const point of before.solvedPoints.filter(
        (p) => p.pointId !== release.target.pointId,
      )) {
        const after = positions.get(point.pointId)!;
        expect(
          Math.hypot(
            after[0] - point.solvedPosition[0],
            after[1] - point.solvedPosition[1],
          ),
          `ungrabbed ${point.pointId}`,
        ).toBeLessThanOrEqual(1e-6);
      }
    }
  });
}
