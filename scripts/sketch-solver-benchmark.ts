import { bench, run, summary } from 'mitata'

import {
  evaluateSketchSolverBenchmarkFixture,
  SKETCH_SOLVER_BENCHMARK_FIXTURES,
  type SketchSolverBenchmarkEvaluation,
} from '../src/contracts/sketch/solver-benchmark.ts'

let benchmarkSink: SketchSolverBenchmarkEvaluation | null = null

function assertFixtureResult(result: SketchSolverBenchmarkEvaluation) {
  if (result.solveState !== 'solved') {
    throw new Error(`${result.fixture} did not solve; received ${result.solveState}.`)
  }
  if (result.regionCount === 0) {
    throw new Error(`${result.fixture} did not extract any regions.`)
  }
}

const preflight = SKETCH_SOLVER_BENCHMARK_FIXTURES.map((fixture) => {
  const result = evaluateSketchSolverBenchmarkFixture(fixture)
  assertFixtureResult(result)
  if (result.annotationCount !== fixture.expectedAnnotationCount) {
    throw new Error(
      `${fixture.name} expected ${fixture.expectedAnnotationCount} annotations, received ${result.annotationCount}.`,
    )
  }
  if (result.regionCount !== fixture.expectedRegionCount) {
    throw new Error(`${fixture.name} expected ${fixture.expectedRegionCount} regions, received ${result.regionCount}.`)
  }
  return {
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
  }
})

console.table(preflight)

summary(() => {
  for (const fixture of SKETCH_SOLVER_BENCHMARK_FIXTURES) {
    bench(`${fixture.name} solve + regions`, () => {
      const result = evaluateSketchSolverBenchmarkFixture(fixture)
      assertFixtureResult(result)
      benchmarkSink = result
    })
  }
})

await run({ throw: true })

if (!benchmarkSink) {
  throw new Error('Sketch solver benchmark did not execute any fixture.')
}
