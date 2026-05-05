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

  expectTrue(SKETCH_SOLVER_BENCHMARK_FIXTURES.length === 4, 'Expected 10, 50, 150 constraint and independent-component benchmark fixtures.')
  expectTrue(
    SKETCH_SOLVER_BENCHMARK_FIXTURES.map((fixture) => fixture.name).join(',') === 'constraints-10,constraints-50,constraints-150,independent-components',
    'Benchmark fixtures should cover the required incremental solver scenarios.',
  )

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
    expectTrue(
      result.diagnosticCount === fixture.expectedDiagnosticCount,
      `${fixture.name} should emit only its expected solve or region diagnostics.`,
    )
    expectTrue(Number.isFinite(result.fullSolveMs) && result.fullSolveMs >= 0, `${fixture.name} should report full-solve timing.`)
    expectTrue(Number.isFinite(result.interactiveDragFrameMs) && result.interactiveDragFrameMs >= 0, `${fixture.name} should report interactive drag-frame timing.`)
    expectTrue(result.interactiveDragAccepted, `${fixture.name} should accept the representative interactive drag frame.`)
  }
})
