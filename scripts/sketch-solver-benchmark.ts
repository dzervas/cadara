// TODO: Turn into a vitest benchmark
import { bench, run, summary } from "mitata";

import {
  evaluateSketchSolverBenchmarkFixture,
  SKETCH_SOLVER_BENCHMARK_DOCUMENT,
  SKETCH_SOLVER_BENCHMARK_TOLERANCES,
  SKETCH_SOLVER_BENCHMARK_FIXTURES,
  type SketchSolverBenchmarkFixture,
  type SketchSolverBenchmarkEvaluation,
} from "../src/contracts/sketch/solver-benchmark.ts";
import type { RequestId } from "../src/contracts/shared/ids.ts";
import { CONTRACT_VERSION } from "../src/contracts/shared/versioning.ts";
import { SOLVER_SCHEMA_VERSION } from "../src/contracts/solver/schema.ts";
import { SketchConstraintSolverAdapter } from "../src/domain/solver/sketch-constraint-solver-adapter.ts";
import {
  compileSketchSolveProgram,
  createCompiledSketchSolveSession,
  solveSketchDefinitionCore,
  updateCompiledSketchSolveSession,
  type SketchCompiledSolveSession,
} from "../src/contracts/sketch/solver-core.ts";

const sketchSolver = new SketchConstraintSolverAdapter(
  SKETCH_SOLVER_BENCHMARK_DOCUMENT,
);
let benchmarkSink: { solveState: string } | null = null;
let interactiveSink: ReturnType<
  typeof updateCompiledSketchSolveSession
> | null = null;

function assertFixtureResult(
  fixture: SketchSolverBenchmarkFixture,
  result: SketchSolverBenchmarkEvaluation,
) {
  if (result.solveState !== "solved") {
    throw new Error(
      `${result.fixture} did not solve; received ${result.solveState}.`,
    );
  }
  if (result.annotationCount !== fixture.expectedAnnotationCount) {
    throw new Error(
      `${fixture.name} expected ${fixture.expectedAnnotationCount} annotations, received ${result.annotationCount}.`,
    );
  }
  if (result.regionCount !== fixture.expectedRegionCount) {
    throw new Error(
      `${fixture.name} expected ${fixture.expectedRegionCount} regions, received ${result.regionCount}.`,
    );
  }
  if (result.diagnosticCount !== fixture.expectedDiagnosticCount) {
    throw new Error(
      `${fixture.name} expected ${fixture.expectedDiagnosticCount} diagnostics, received ${result.diagnosticCount}.`,
    );
  }
}

function assertFullSolveResult(
  fixture: SketchSolverBenchmarkFixture,
  result: Awaited<ReturnType<typeof evaluateFullSolveAndRegions>>,
) {
  if (result.solveState !== "solved") {
    throw new Error(
      `${fixture.name} did not solve; received ${result.solveState}.`,
    );
  }
  if (result.regionCount !== fixture.expectedRegionCount) {
    throw new Error(
      `${fixture.name} expected ${fixture.expectedRegionCount} regions, received ${result.regionCount}.`,
    );
  }
  if (result.diagnosticCount !== fixture.expectedDiagnosticCount) {
    throw new Error(
      `${fixture.name} expected ${fixture.expectedDiagnosticCount} diagnostics, received ${result.diagnosticCount}.`,
    );
  }
}

const preflight = [];
for (const fixture of SKETCH_SOLVER_BENCHMARK_FIXTURES) {
  const result = await evaluateSketchSolverBenchmarkFixture(fixture, sketchSolver);
  assertFixtureResult(fixture, result);
  preflight.push({
    fixture: result.fixture,
    annotations: result.annotationCount,
    constraints: result.constraintCount,
    dimensions: result.dimensionCount,
    points: result.pointCount,
    entities: result.entityCount,
    regions: result.regionCount,
    loops: result.loopCount,
    solve: result.solveState,
    constrained: result.constraintState,
    diagnostics: result.diagnosticCount,
    fullSolveMs: Number(result.fullSolveMs.toFixed(2)),
    dragFrameMs: Number(result.interactiveDragFrameMs.toFixed(2)),
  });
}

console.table(preflight);

async function evaluateFullSolveAndRegions(fixture: SketchSolverBenchmarkFixture) {
  const solved = solveSketchDefinitionCore({
    definition: fixture.sketch.definition,
    tolerances: SKETCH_SOLVER_BENCHMARK_TOLERANCES,
    partialSolvePolicy: "bestEffort",
  });
  const extracted = await sketchSolver.deriveSketchRegions({
    contractVersion: CONTRACT_VERSION,
    solverSchemaVersion: SOLVER_SCHEMA_VERSION,
    requestId: `request_benchmark_${fixture.name.replaceAll("-", "_")}` as RequestId,
    ...SKETCH_SOLVER_BENCHMARK_DOCUMENT,
    sketchId: fixture.sketch.sketchId,
    definition: fixture.sketch.definition,
    solvedSnapshot: solved.solvedSnapshot,
    projectedReferences: [],
  });
  return {
    solveState: solved.status.solveState,
    regionCount: extracted.regions.length,
    diagnosticCount: solved.diagnostics.length + extracted.diagnostics.length,
  };
}

function createInteractiveDragBenchmarkState(
  fixture: SketchSolverBenchmarkFixture,
): {
  session: SketchCompiledSolveSession;
  pointId: NonNullable<
    SketchSolverBenchmarkFixture["sketch"]["definition"]["points"][number]
  >["pointId"];
  basePosition: readonly [number, number];
  direction: 1 | -1;
  explicitTarget: readonly [number, number] | null;
  targetTolerance: number;
} {
  const definition = fixture.sketch.definition;
  const solved = solveSketchDefinitionCore({
    definition,
    tolerances: SKETCH_SOLVER_BENCHMARK_TOLERANCES,
    partialSolvePolicy: "bestEffort",
  });
  const program = compileSketchSolveProgram({
    definition,
    tolerances: SKETCH_SOLVER_BENCHMARK_TOLERANCES,
    partialSolvePolicy: "bestEffort",
  });
  const session = createCompiledSketchSolveSession({
    sessionId: `interactive_sketch_solve_benchmark_${fixture.name.replaceAll("-", "_")}`,
    program,
    priorSolvedSnapshot: solved.solvedSnapshot,
  });
  const dragPoint = fixture.interactiveDragTarget
    ? definition.points.find(
        (point) => point.pointId === fixture.interactiveDragTarget?.pointId,
      )
    : (definition.points[1] ?? definition.points[0]);
  if (!dragPoint) {
    throw new Error(`${fixture.name} does not expose a benchmark drag point.`);
  }
  return {
    session,
    pointId: dragPoint.pointId,
    basePosition: dragPoint.position,
    direction: 1,
    explicitTarget: fixture.interactiveDragTarget?.position ?? null,
    targetTolerance: fixture.interactiveDragTarget?.targetTolerance ?? 0.1,
  };
}

summary(() => {
  for (const fixture of SKETCH_SOLVER_BENCHMARK_FIXTURES) {
    bench(`${fixture.name} full solve + regions`, async () => {
      const result = await evaluateFullSolveAndRegions(fixture);
      assertFullSolveResult(fixture, result);
      benchmarkSink = result;
    });

    const interactive = createInteractiveDragBenchmarkState(fixture);
    bench(`${fixture.name} interactive drag frame`, () => {
      interactive.direction = interactive.direction === 1 ? -1 : 1;
      const result = updateCompiledSketchSolveSession(
        interactive.session,
        {
          kind: "sketchPoint",
          pointId: interactive.pointId,
          position: interactive.explicitTarget
            ? interactive.direction === 1
              ? interactive.explicitTarget
              : interactive.basePosition
            : [
                interactive.basePosition[0] + interactive.direction * 0.05,
                interactive.basePosition[1],
              ],
        },
        interactive.targetTolerance,
      );
      if (result.kind !== "solved") {
        throw new Error(
          `${fixture.name} interactive drag frame did not solve; received ${result.kind}.`,
        );
      }
      interactiveSink = result;
    });
  }
});

await run({ throw: true });

if (!benchmarkSink) {
  throw new Error(
    "Sketch solver full-solve benchmark did not execute any fixture.",
  );
}

if (!interactiveSink) {
  throw new Error(
    "Sketch solver interactive benchmark did not execute any fixture.",
  );
}
