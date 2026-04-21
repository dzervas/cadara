import { test } from 'bun:test'

import type { AuthoredSketchRecord } from '@/contracts/modeling/authored-document'
import {
  countSolverAnnotations,
  evaluateSketchSolverBenchmarkFixture,
  SKETCH_SOLVER_BENCHMARK_FIXTURES,
} from '@/contracts/sketch/solver-benchmark'

test('src/contracts/sketch/solver-benchmark.spec.ts', () => {
  function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
      throw new Error(message)
    }
  }

  function assertAuthoredSketchRecord(sketch: AuthoredSketchRecord) {
    assert(sketch.sketchId.startsWith('sketch_'), 'Benchmark fixtures should expose document-held sketch ids.')
    assert(sketch.plane.key === 'xy', 'Benchmark fixtures should include sketch plane context.')
    assert(sketch.planeTarget.kind === 'construction', 'Benchmark fixtures should include the plane target.')
    assert(sketch.definition.schemaVersion === 'sketch-definition/v1alpha1', 'Benchmark fixtures should expose authored definitions.')
  }

  assert(SKETCH_SOLVER_BENCHMARK_FIXTURES.length === 4, 'Expected square plus three complex benchmark fixtures.')

  for (const fixture of SKETCH_SOLVER_BENCHMARK_FIXTURES) {
    assertAuthoredSketchRecord(fixture.sketch)
    assert(
      countSolverAnnotations(fixture.sketch.definition) === fixture.expectedAnnotationCount,
      `${fixture.name} should report its expected solver-facing annotation count.`,
    )

    const result = evaluateSketchSolverBenchmarkFixture(fixture)
    assert(result.solveState === 'solved', `${fixture.name} should solve before region extraction.`)
    assert(
      result.regionCount === fixture.expectedRegionCount,
      `${fixture.name} should extract its expected closed regions.`,
    )
    assert(result.diagnosticCount === 0, `${fixture.name} should not emit solve or region diagnostics.`)
  }
})
