import { expect, test } from "vitest";
import type * as THREE from "three";

import { createTestErrorReporter } from "@/contracts/errors";
import type {
  PerformanceSpanAttributes,
  PerformanceTelemetry,
} from "@/contracts/performance/telemetry";
import {
  createReportedWebGlRenderer,
  WebGlInitializationError,
} from "@/infrastructure/viewport/webgl-renderer";

function createTelemetry() {
  const spans: {
    operation: string | number | boolean | null | undefined;
    result?: PerformanceSpanAttributes;
  }[] = [];
  const telemetry: PerformanceTelemetry = {
    startSpan(descriptor) {
      const span: (typeof spans)[number] = {
        operation: descriptor.attributes?.["cadara.operation"],
      };
      spans.push(span);
      return {
        setAttribute() {},
        setAttributes() {},
        end(result) {
          span.result = result;
        },
      };
    },
  };
  return { telemetry, spans };
}

for (const surface of ["viewport", "view-cube"] as const) {
  test(`${surface} creation failure immediately reports original error and failed trace`, () => {
    const canvas = new EventTarget() as HTMLCanvasElement;
    const reporter = createTestErrorReporter();
    const { telemetry, spans } = createTelemetry();
    const cause = new Error("Error creating WebGL context.");
    let failure: WebGlInitializationError | undefined;
    try {
      createReportedWebGlRenderer(
        { canvas },
        surface,
        reporter,
        telemetry,
        () => {
          const event = new Event("webglcontextcreationerror");
          Object.defineProperty(event, "statusMessage", {
            value: "GPU context allocation refused",
          });
          canvas.dispatchEvent(event);
          throw cause;
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(WebGlInitializationError);
      failure = error as WebGlInitializationError;
    }
    expect(failure?.cause).toBe(cause);
    expect(failure?.diagnostics).toContain("GPU context allocation refused");
    expect(reporter.reports).toHaveLength(1);
    expect(reporter.reports[0].error.cause).toBe(cause);
    expect(reporter.reports[0].metadata.source).toBe("webgl-initialization");
    expect(reporter.reports[0].error.context).toContainEqual({
      key: "webglSurface",
      value: surface,
    });
    expect(spans).toEqual([
      {
        operation: surface,
        result: {
          "cadara.result": "failure",
          "cadara.error_name": "Error",
          "cadara.error_message": cause.message,
        },
      },
    ]);
    // The failure is reported at creation, with no scene callback or later error needed.
  });
}

test("successful retry returns its real renderer and records success without an error", () => {
  const canvas = new EventTarget() as HTMLCanvasElement;
  const reporter = createTestErrorReporter();
  const { telemetry, spans } = createTelemetry();
  const renderer = {} as THREE.WebGLRenderer;
  expect(
    createReportedWebGlRenderer(
      { canvas },
      "viewport",
      reporter,
      telemetry,
      () => renderer,
    ),
  ).toBe(renderer);
  expect(reporter.reports).toEqual([]);
  expect(spans[0].result).toEqual({ "cadara.result": "success" });
});
