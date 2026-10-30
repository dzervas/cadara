import type { SketchEntityId, SketchPointId } from "@/contracts/shared/ids";
import type {
  SketchPoint2D,
  SolvedSketchSnapshot,
} from "@/contracts/sketch/schema";
import { compileSketchSolveProgram } from "./compile-program";
import { startCompiledSketchSolveSession } from "./start-session";
import { updateCompiledSketchSolveSession } from "./update-session";
import captured from "../../../test/fixtures/sketch-drag-conditioning.json";
import firstGoalGeometry from "../../../test/fixtures/sketch-drag-first-goal-geometry.json";
import smallGeometry from "../../../test/fixtures/sketch-drag-small-geometry.json";

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

// Numeric geometry from the previously hash-approved Node 24 trajectory.
// Cross-runtime bit identity is not a geometry contract: Node 22 and 24 differ
// even on 0.013 ** 3, used by cubic evaluation, and BFGS amplifies that rounding.
export const approvedFirstGoalGeometry = firstGoalGeometry as unknown as Record<
  "drag-large" | "drag-corner",
  { preview: ApprovedDragGeometry; release: ApprovedDragGeometry }
>;

export type ApprovedDragGeometry = {
  points: [SketchPointId, number, number][];
  splines: { entityId: SketchEntityId; poles: SketchPoint2D[][] }[];
};

// Trusted numeric capture, like the shared native-document fixture above.
const smallDragApproval = smallGeometry as unknown as {
  fixed: ApprovedDragGeometry;
  pointIds: SketchPointId[];
  splineIds: SketchEntityId[];
  frames: { points: SketchPoint2D[]; splines: SketchPoint2D[][][] }[];
};

// Stationary geometry is stored once; each frame still approves every point
// and every cubic span, not only the geometry directly under the cursor.
export const approvedSmallDragFrames: ApprovedDragGeometry[] =
  smallDragApproval.frames.map((frame) => ({
    points: [
      ...smallDragApproval.fixed.points,
      ...frame.points.map((position, i): [SketchPointId, number, number] => [
        smallDragApproval.pointIds[i]!,
        ...position,
      ]),
    ],
    splines: [
      ...smallDragApproval.fixed.splines,
      ...frame.splines.map((poles, i) => ({
        entityId: smallDragApproval.splineIds[i]!,
        poles,
      })),
    ],
  }));

export function dragSnapshotGeometry(snapshot: SolvedSketchSnapshot) {
  return [
    snapshot.solvedPoints.map((p) => [p.pointId, ...p.solvedPosition]),
    snapshot.solvedEntities.filter((e) => e.kind === "spline"),
  ];
}

// Bound the entire cubic locus, not just a few sampled points. The maximum of
// each coordinate's difference is at an endpoint or a zero of its derivative.
// Off-curve control poles are not geometric points (they may differ by more).
export function cubicCoordinateDelta(
  before: readonly SketchPoint2D[],
  after: readonly SketchPoint2D[],
) {
  let maximum = 0;
  for (const coordinate of [0, 1] as const) {
    const [p0, p1, p2, p3] = before.map(
      (p, i) => after[i]![coordinate] - p[coordinate],
    );
    const a = -p0! + 3 * p1! - 3 * p2! + p3!;
    const b = 3 * p0! - 6 * p1! + 3 * p2!;
    const c = -3 * p0! + 3 * p1!;
    const candidates = [0, 1];
    if (a === 0) {
      if (b !== 0) candidates.push(-c / (2 * b));
    } else {
      const discriminant = 4 * b * b - 12 * a * c;
      if (discriminant >= 0)
        for (const sign of [-1, 1])
          candidates.push((-2 * b + sign * Math.sqrt(discriminant)) / (6 * a));
    }
    for (const t of candidates)
      if (t >= 0 && t <= 1)
        maximum = Math.max(maximum, Math.abs(((a * t + b) * t + c) * t + p0!));
  }
  return maximum;
}
