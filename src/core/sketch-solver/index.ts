export type { SketchCompiledSolveSession } from "./system-types";
export type { SketchDragTarget } from "./solve-types";
export { compileSketchSolveProgram } from "./compile-program";
export { createCompiledSketchSolveSession } from "./start-session";
export { describeDegenerateSplineSpan } from "./degenerate-spline-recovery";
export { measureReferenceDimensionsAtAuthoredPositions } from "./solve-sketch";
export { probeSketchDimensionRedundancy } from "./dimension-redundancy";
export { sketchDraggedPointHasFreeDof } from "./free-dof";
export { solveSketchDefinitionCore } from "./solve-sketch";
export { solveSketchDefinitionWithDraggedPointTarget } from "./solve-sketch";
export { startCompiledSketchSolveSession } from "./start-session";
export { undefinedReferenceDimensionDiagnostics } from "./solver-geometry";
export { unsatisfiedRequirementDiagnostics } from "./solver-geometry";
export { updateCompiledSketchSolveSession } from "./update-session";
export { validateSketchDefinitionCore } from "./solve-sketch";
export {
  evaluateSketchSolverBenchmarkFixture,
  SKETCH_SOLVER_BENCHMARK_DOCUMENT,
  SKETCH_SOLVER_BENCHMARK_TOLERANCES,
  SKETCH_SOLVER_BENCHMARK_FIXTURES,
  type SketchSolverBenchmarkFixture,
  type SketchSolverBenchmarkEvaluation,
} from "./solver-benchmark";
