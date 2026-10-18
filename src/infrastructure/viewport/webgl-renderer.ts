import * as THREE from "three";

import { normalizeUnknownError, type ErrorReporter } from "@/contracts/errors";
import type { PerformanceTelemetry } from "@/contracts/performance/telemetry";

export type WebGlSurface = "viewport" | "view-cube";

export class WebGlInitializationError extends Error {
  readonly surface: WebGlSurface;
  readonly browserReason: string | null;

  constructor(
    surface: WebGlSurface,
    browserReason: string | null,
    cause: unknown,
  ) {
    super("The 3D view couldn’t start", { cause });
    this.name = "WebGlInitializationError";
    this.surface = surface;
    this.browserReason = browserReason;
  }

  get diagnostics() {
    return [
      "Required: WebGL 2",
      `Renderer: ${this.surface}`,
      `Browser reason: ${this.browserReason ?? "Not supplied"}`,
      `Error: ${this.cause instanceof Error ? this.cause.message : String(this.cause)}`,
    ].join("\n");
  }
}

export function createReportedWebGlRenderer(
  parameters: THREE.WebGLRendererParameters,
  surface: WebGlSurface,
  reporter: ErrorReporter,
  telemetry: PerformanceTelemetry,
  createRenderer = (options: THREE.WebGLRendererParameters) =>
    new THREE.WebGLRenderer(options),
) {
  const canvas = parameters.canvas ?? document.createElement("canvas");
  let browserReason: string | null = null;
  const onCreationError = (event: Event) => {
    browserReason = (event as WebGLContextEvent).statusMessage || null;
  };
  canvas.addEventListener("webglcontextcreationerror", onCreationError);
  const span = telemetry.startSpan({
    name: "WebGL renderer initialization",
    op: "webgl.init",
    attributes: {
      "cadara.seam": "webgl",
      "cadara.operation": surface,
    },
  });

  try {
    const renderer = createRenderer({ ...parameters, canvas });
    span.end({ "cadara.result": "success" });
    return renderer;
  } catch (cause) {
    const error = new WebGlInitializationError(surface, browserReason, cause);
    // Report at the failed constructor, not later when a scene needs the renderer.
    reporter.report(
      normalizeUnknownError(cause, {
        code: "render/crash",
        fallbackMessage: error.message,
        recoverable: true,
        context: [
          { key: "webglSurface", value: surface },
          { key: "webglVersion", value: 2 },
          { key: "webglCreationReason", value: browserReason },
        ],
      }),
      { source: "webgl-initialization", visibility: "user" },
    );
    span.end({
      "cadara.result": "failure",
      "cadara.error_name": cause instanceof Error ? cause.name : typeof cause,
      "cadara.error_message":
        cause instanceof Error ? cause.message : String(cause),
    });
    throw error;
  } finally {
    canvas.removeEventListener("webglcontextcreationerror", onCreationError);
  }
}
