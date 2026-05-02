import { test } from 'bun:test'

import { expectTrue } from '@/testing/expect.spec'
import type { AuthoredSketchRecord } from '@/contracts/modeling/authored-document'
import {
  countSolverAnnotations,
  evaluateSketchSolverBenchmarkFixture,
  SKETCH_SOLVER_BENCHMARK_FIXTURES,
} from '@/contracts/sketch/solver-benchmark'

test('src/contracts/sketch/solver-benchmark.spec.ts', () => {  function assertAuthoredSketchRecord(sketch: AuthoredSketchRecord) {
    expectTrue(sketch.sketchId.startsWith('sketch_'), 'Benchmark fixtures should expose document-held sketch ids.')
    expectTrue(sketch.plane.key === 'xy', 'Benchmark fixtures should include sketch plane context.')
    expectTrue(sketch.plane.support.kind === 'construction', 'Benchmark fixtures should include the plane target.')
    expectTrue(sketch.definition.schemaVersion === 'sketch-definition/v1alpha1', 'Benchmark fixtures should expose authored definitions.')
  }

  expectTrue(SKETCH_SOLVER_BENCHMARK_FIXTURES.length === 4, 'Expected square plus three complex benchmark fixtures.')

  for (const fixture of SKETCH_SOLVER_BENCHMARK_FIXTURES) {
    assertAuthoredSketchRecord(fixture.sketch)
    expectTrue(
      countSolverAnnotations(fixture.sketch.definition) === fixture.expectedAnnotationCount,
      `${fixture.name} should report its expected solver-facing annotation count.`,
    )

    const result = evaluateSketchSolverBenchmarkFixture(fixture)
    expectTrue(result.solveState === 'solved', `${fixture.name} should solve before region extraction.`)
    expectTrue(
      result.regionCount === fixture.expectedRegionCount,
      `${fixture.name} should extract its expected closed regions.`,
    )
    expectTrue(result.diagnosticCount === 0, `${fixture.name} should not emit solve or region diagnostics.`)
  }
})
