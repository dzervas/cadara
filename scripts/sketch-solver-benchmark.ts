import { runSketchSolverBenchmark } from '../src/contracts/sketch/solver-benchmark.ts'

const results = runSketchSolverBenchmark().map((result) => ({
  fixture: result.fixture,
  constraints: result.constraintCount,
  points: result.pointCount,
  elapsedMs: Number(result.elapsedMs.toFixed(3)),
  solveState: result.solveState,
  constraintState: result.constraintState,
}))

console.table(results)
