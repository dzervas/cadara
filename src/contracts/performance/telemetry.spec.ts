import { test, expect } from "vitest";

import {
  classifyRevisionResult,
  filterPerformanceSpanAttributes,
  measurePerformanceSpan,
  noopPerformanceTelemetry,
  recordPerformanceMark,
  type PerformanceSpanDescriptor,
} from "@/contracts/performance/telemetry";
import {
  createSentryPerformanceTelemetry,
  shouldEnablePerformanceTelemetry,
  type SentryBrowserBoundary,
} from "@/contracts/errors/sentry-client";

test("src/contracts/performance/telemetry.spec.ts preserves no-op results and filters expensive attributes", async () => {
  const result = await measurePerformanceSpan({
    telemetry: noopPerformanceTelemetry,
    descriptor: makeDescriptor("noop"),
    action: () => Promise.resolve({ ok: true as const }),
  });

  expect(
    result.ok,
    "No-op telemetry should preserve successful operation results.",
  ).toBeTruthy();

  const rejected = new Error("boom");
  try {
    await measurePerformanceSpan({
      telemetry: noopPerformanceTelemetry,
      descriptor: makeDescriptor("throw"),
      action: () => Promise.reject(rejected),
    });
  } catch (error) {
    expect(
      error,
      "No-op telemetry should preserve the exact thrown error.",
    ).toBe(rejected);
  }

  const filtered = filterPerformanceSpanAttributes({
    "cadara.operation": "solveSketch",
    "cadara.constraint_count": 4,
    mesh_triangle_total: 1000,
    automerge_version_count: 10,
    solver_iteration_count: 30,
    pointer_move_x: 20,
  });

  expect(
    filtered["cadara.operation"],
    "Allowed low-cardinality attributes should be retained.",
  ).toBe("solveSketch");
  expect(
    filtered["cadara.constraint_count"],
    "Cheap count attributes should be retained.",
  ).toBe(4);
  expect(
    "mesh_triangle_total" in filtered,
    "Mesh triangle totals should not be allowed telemetry attributes.",
  ).toBeFalsy();
  expect(
    "automerge_version_count" in filtered,
    "Full Automerge version counts should not be allowed telemetry attributes.",
  ).toBeFalsy();
  expect(
    "solver_iteration_count" in filtered,
    "Solver iteration counts should not be allowed telemetry attributes.",
  ).toBeFalsy();
  expect(
    "pointer_move_x" in filtered,
    "Pointer-move attributes should not be allowed telemetry attributes.",
  ).toBeFalsy();
});

test("src/contracts/performance/telemetry.spec.ts records Sentry spans with filtered attributes", () => {
  const startedSpans: unknown[] = [];
  const endedAttributes: Record<string, unknown>[] = [];
  const client: SentryBrowserBoundary = {
    init() {
      return undefined;
    },
    captureException() {
      return "event";
    },
    captureMessage() {
      return "event";
    },
    startInactiveSpan(options) {
      startedSpans.push(options);
      return {
        setAttribute() {
          return undefined;
        },
        setAttributes(attributes) {
          endedAttributes.push(attributes);
          return undefined;
        },
        setStatus() {
          return undefined;
        },
        end() {
          return undefined;
        },
      };
    },
  };

  const telemetry = createSentryPerformanceTelemetry({ enabled: true, client });
  recordPerformanceMark(
    telemetry,
    makeDescriptor("sentry", {
      "cadara.operation": "getDocumentSnapshot",
      "cadara.render_record_count": 2,
      pointer_move_x: 10,
    }),
  );

  const started = startedSpans[0] as { attributes?: Record<string, unknown> };
  expect(
    started.attributes?.["cadara.operation"],
    "Sentry spans should receive operation attributes.",
  ).toBe("getDocumentSnapshot");
  expect(
    "pointer_move_x" in (started.attributes ?? {}),
    "Sentry spans should not receive high-frequency attributes.",
  ).toBeFalsy();
  expect(
    endedAttributes[0]?.["cadara.result"],
    "Sentry span end should include result classification.",
  ).toBe("success");
});

test("src/contracts/performance/telemetry.spec.ts classifies revision results and keeps dev tracing opt-in conservative", () => {
  expect(
    classifyRevisionResult({ revisionState: { kind: "accepted" } }),
    "Accepted revision results should classify as success.",
  ).toBe("success");
  expect(
    classifyRevisionResult({ revisionState: { kind: "rejected" } }),
    "Rejected revision results should classify as rejected.",
  ).toBe("rejected");
  expect(
    classifyRevisionResult({ revisionState: { kind: "conflict" } }),
    "Conflicted revision results should classify as conflict.",
  ).toBe("conflict");
  expect(
    shouldEnablePerformanceTelemetry({ isProduction: true, search: null }),
    "Production should enable sampled performance telemetry.",
  ).toBeTruthy();
  expect(
    shouldEnablePerformanceTelemetry({
      isProduction: false,
      search: "?cadEnableSentry=1",
    }),
    "Development should not enable performance telemetry from error reporting alone.",
  ).toBeFalsy();
  expect(
    shouldEnablePerformanceTelemetry({
      isProduction: false,
      search: "?cadEnableSentry=1&cadEnablePerfTelemetry=1",
    }),
    "Development should require explicit performance telemetry opt-in.",
  ).toBeTruthy();
});

function makeDescriptor(
  operation: string,
  attributes: Record<string, unknown> = {},
): PerformanceSpanDescriptor {
  return {
    name: operation,
    op: "cad.test",
    attributes: {
      "cadara.seam": "test",
      "cadara.operation": operation,
      ...attributes,
    },
  } as PerformanceSpanDescriptor;
}
