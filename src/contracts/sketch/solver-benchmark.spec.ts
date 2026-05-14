import { test, expect } from "vitest";

import type { AuthoredSketchRecord } from "@/contracts/modeling/authored-document";
import {
  countSolverAnnotations,
  evaluateSketchSolverBenchmarkFixture,
  SKETCH_SOLVER_BENCHMARK_FIXTURES,
} from "@/contracts/sketch/solver-benchmark";

test("src/contracts/sketch/solver-benchmark.spec.ts", () => {
  function assertAuthoredSketchRecord(sketch: AuthoredSketchRecord) {
    expect(
      sketch.sketchId.startsWith("sketch_"),
      "Benchmark fixtures should expose document-held sketch ids.",
    ).toBeTruthy();
    expect(
      sketch.plane.key,
      "Benchmark fixtures should include sketch plane context.",
    ).toBe("xy");
    expect(
      sketch.plane.support.kind,
      "Benchmark fixtures should include the plane target.",
    ).toBe("construction");
    expect(
      sketch.definition.schemaVersion,
      "Benchmark fixtures should expose authored definitions.",
    ).toBe("sketch-definition/v1alpha1");
  }

  expect(
    SKETCH_SOLVER_BENCHMARK_FIXTURES.length,
    "Expected incremental, independent-component, and branch-fallback benchmark fixtures.",
  ).toBe(5);
  expect(
    SKETCH_SOLVER_BENCHMARK_FIXTURES.map((fixture) => fixture.name).join(","),
    "Benchmark fixtures should cover the required incremental solver scenarios.",
  ).toBe(
    "constraints-10,constraints-50,constraints-150,independent-components,three-branch-drag-fallback",
  );

  for (const fixture of SKETCH_SOLVER_BENCHMARK_FIXTURES) {
    assertAuthoredSketchRecord(fixture.sketch);
    expect(
      countSolverAnnotations(fixture.sketch.definition),
      `${fixture.name} should report its expected solver-facing annotation count.`,
    ).toBe(fixture.expectedAnnotationCount);

    const result = evaluateSketchSolverBenchmarkFixture(fixture);
    expect(
      result.solveState,
      `${fixture.name} should solve before region extraction.`,
    ).toBe("solved");
    expect(
      result.regionCount,
      `${fixture.name} should extract its expected closed regions.`,
    ).toBe(fixture.expectedRegionCount);
    expect(
      result.diagnosticCount,
      `${fixture.name} should emit only its expected solve or region diagnostics.`,
    ).toBe(fixture.expectedDiagnosticCount);
    expect(
      Number.isFinite(result.fullSolveMs) && result.fullSolveMs >= 0,
      `${fixture.name} should report full-solve timing.`,
    ).toBeTruthy();
    expect(
      Number.isFinite(result.interactiveDragFrameMs) &&
        result.interactiveDragFrameMs >= 0,
      `${fixture.name} should report interactive drag-frame timing.`,
    ).toBeTruthy();
    expect(
      result.interactiveDragAccepted,
      `${fixture.name} should accept the representative interactive drag frame.`,
    ).toBeTruthy();
  }
});
