import { test, expect } from "vitest";

import { createAppError } from "@/contracts/errors";
import { createDefaultErrorReporter } from "@/contracts/errors/default-reporter";
import {
  checkSentryDsnReachability,
  createSentryDsnTestUrl,
} from "@/contracts/errors/sentry-client";
import {
  SENTRY_DSN,
  createSentryErrorReporter,
  initializeSentryErrorReporting,
  shouldEnablePerformanceTelemetry,
  shouldEnableSentryErrorReporting,
  type SentryBrowserBoundary,
} from "@/contracts/errors/sentry-reporter";
import {
  clearActiveDocumentTelemetryContext,
  createActiveDocumentTelemetryContext,
  publishActiveDocumentTelemetryContext,
} from "@/contracts/errors/telemetry-context";
import { CONTRACT_VERSION } from "@/contracts/shared/versioning";
import { MockKernelAdapter } from "@/domain/modeling/mock-kernel-adapter";

interface CapturedEvent {
  kind: "exception" | "message";
  value: unknown;
  context: unknown;
}

const expectedTestEnvelopeUrl =
  "https://example.test/api/42/envelope/?sentry_version=7&sentry_key=public&sentry_client=sentry.javascript.browser%2F10.49.0";

test("src/contracts/errors/sentry-reporter.spec.ts", async () => {
  const initOptions: unknown[] = [];
  const capturedEvents: CapturedEvent[] = [];
  const client: SentryBrowserBoundary = {
    init(options) {
      initOptions.push(options);
    },
    captureException(exception, context) {
      capturedEvents.push({ kind: "exception", value: exception, context });
      return "event_exception";
    },
    captureMessage(message, context) {
      capturedEvents.push({ kind: "message", value: message, context });
      return "event_message";
    },
  };

  clearActiveDocumentTelemetryContext();
  const cause = new Error("Kernel stack source.");
  const reporter = createSentryErrorReporter({ client });
  const error = createAppError({
    code: "workbench/action-failed",
    severity: "fatal",
    message: "Workbench action failed.",
    cause,
    requestId: "request_action-1",
    context: [{ key: "operation", value: "Commit feature" }],
    target: { kind: "feature", featureId: "feature_extrude-1" },
    recoverable: false,
  });

  const record = reporter.report(error, {
    source: "workbench-action",
    visibility: "user",
    dedupeKey: "same-action",
    externalTracking: {
      fingerprint: "workbench-action-failed",
      tags: {
        command: "extrude",
      },
    },
  });
  const duplicate = reporter.report(error, {
    source: "workbench-action",
    dedupeKey: "same-action",
  });

  expect(record, "Sentry reporter should return the first record.").not.toBe(
    null,
  );
  expect(duplicate, "Sentry reporter should preserve dedupe behavior.").toBe(
    null,
  );
  expect(
    initOptions.length,
    "Sentry reporter should initialize the SDK once on creation.",
  ).toBe(1);
  expect(
    (initOptions[0] as { dsn?: string }).dsn,
    "Sentry reporter should use the Bugsink DSN.",
  ).toBe(SENTRY_DSN);
  expect(
    initializeSentryErrorReporting({ client }),
    "Repeated initialization should report the initialized client.",
  ).toBeTruthy();
  expect(
    initOptions.length,
    "Sentry reporter should not initialize the same SDK client twice.",
  ).toBe(1);
  expect(
    createSentryDsnTestUrl("https://public@example.test/sentry/42"),
    "The Sentry DSN test URL should target the project envelope endpoint with Sentry query metadata.",
  ).toBe(expectedTestEnvelopeUrl);
  const checkedRequests: { input: string; init?: RequestInit }[] = [];
  expect(
    await checkSentryDsnReachability({
      dsn: "https://public@example.test/sentry/42",
      fetchLike(input, init) {
        checkedRequests.push({ input, init });
        return Promise.resolve();
      },
    }),
    "Reachability checks should pass when the browser request resolves.",
  ).toBeTruthy();
  expect(
    checkedRequests[0]?.input,
    "Reachability checks should request the derived Sentry envelope endpoint.",
  ).toBe(expectedTestEnvelopeUrl);
  expect(
    checkedRequests[0]?.init?.method,
    "Reachability checks should use a visible browser GET probe.",
  ).toBe("GET");
  expect(
    await checkSentryDsnReachability({
      dsn: "https://public@example.test/sentry/42",
      fetchLike() {
        return Promise.reject(new Error("blocked"));
      },
    }),
    "Reachability checks should fail when the browser blocks the request.",
  ).toBeFalsy();
  expect(
    capturedEvents.length,
    "Dedupe should suppress duplicate SDK captures.",
  ).toBe(1);
  expect(
    capturedEvents[0]?.kind,
    "Error causes should be captured as exceptions to preserve stacks.",
  ).toBe("exception");
  expect(
    capturedEvents[0]?.value,
    "The original Error cause should be sent to the SDK.",
  ).toBe(cause);

  const captureContext = capturedEvents[0]?.context as {
    level?: string;
    tags?: Record<string, string>;
    contexts?: {
      app_error?: Record<string, unknown>;
      report?: Record<string, unknown>;
      active_document?: Record<string, unknown>;
    };
    extra?: Record<string, unknown>;
    fingerprint?: string[];
  };
  expect(
    captureContext.level,
    "AppError severity should map to Sentry level.",
  ).toBe("fatal");
  expect(
    captureContext.tags?.["app.error_code"],
    "Error code should be sent as a tag.",
  ).toBe("workbench/action-failed");
  expect(
    captureContext.tags?.["app.error_source"],
    "Report source should be sent as a tag.",
  ).toBe("workbench-action");
  expect(
    captureContext.tags?.command,
    "External tracking tags should be preserved.",
  ).toBe("extrude");
  expect(
    captureContext.tags?.["app.target_kind"],
    "Target metadata should be represented compactly.",
  ).toBe("feature");
  expect(
    captureContext.contexts?.app_error?.message,
    "AppError message should be preserved.",
  ).toBe("Workbench action failed.");
  expect(
    captureContext.contexts?.report?.visibility,
    "Report visibility should be included.",
  ).toBe("user");
  expect(
    captureContext.contexts?.active_document?.availability,
    "Missing document context should be explicit.",
  ).toBe("unavailable");
  expect(
    captureContext.extra?.causeStack,
    "Cause stack should be available as event extra.",
  ).toBe(cause.stack);
  expect(
    captureContext.fingerprint?.[0],
    "External fingerprint should be passed through.",
  ).toBe("workbench-action-failed");

  const adapter = new MockKernelAdapter();
  const snapshot = (
    await adapter.getDocumentSnapshot({
      contractVersion: CONTRACT_VERSION,
      documentId: "doc_workspace",
    })
  ).snapshot;
  publishActiveDocumentTelemetryContext(
    createActiveDocumentTelemetryContext(snapshot),
  );

  reporter.report(
    createAppError({
      code: "app/operation-failed",
      message: "Non-exception failure.",
    }),
    {
      source: "unit",
    },
  );

  const loadedDocumentContext = capturedEvents[1]?.context as {
    tags?: Record<string, string>;
    contexts?: {
      active_document?: Record<string, unknown>;
    };
    extra?: Record<string, unknown>;
  };
  const activeDocumentPayload = loadedDocumentContext.extra
    ?.activeDocumentPayload as Record<string, unknown> | null;
  expect(
    capturedEvents[1]?.kind,
    "Errors without Error causes should be captured as messages.",
  ).toBe("message");
  expect(
    loadedDocumentContext.tags?.["active_document.id"],
    "Document id should be tagged.",
  ).toBe(snapshot.document.documentId);
  expect(
    loadedDocumentContext.tags?.["active_document.revision_id"],
    "Revision id should be tagged.",
  ).toBe(snapshot.document.revisionId);
  expect(
    loadedDocumentContext.contexts?.active_document?.payloadStatus,
    "Loaded documents should attach payloads.",
  ).toBe("attached");
  expect(
    activeDocumentPayload,
    "Loaded document payload should be attached as event extra.",
  ).not.toBe(null);
  expect(
    "render" in activeDocumentPayload,
    "Telemetry payload should exclude render exports.",
  ).toBeFalsy();
  expect(
    "presentation" in activeDocumentPayload,
    "Telemetry payload should exclude presentation state.",
  ).toBeFalsy();
  expect(
    Array.isArray(activeDocumentPayload.sketches),
    "Telemetry payload should include authored sketches.",
  ).toBeTruthy();

  const devConsoleRecords: unknown[][] = [];
  const devReporter = createDefaultErrorReporter({
    isProduction: false,
    sentryClient: client,
    consoleLike: {
      error: (...args: unknown[]) => {
        devConsoleRecords.push(args);
      },
    },
  });
  devReporter.report(error, { source: "unit" });
  expect(
    initOptions.length,
    "Non-production reporter selection should not initialize Sentry.",
  ).toBe(1);
  expect(
    devConsoleRecords.length,
    "Non-production reporter selection should keep local reporting.",
  ).toBe(1);

  const productionInitOptions: unknown[] = [];
  const productionClient: SentryBrowserBoundary = {
    init(options) {
      productionInitOptions.push(options);
    },
    captureException() {
      return "event_exception";
    },
    captureMessage() {
      return "event_message";
    },
  };
  const productionReporter = createDefaultErrorReporter({
    isProduction: true,
    sentryClient: productionClient,
  });
  productionReporter.report(error, { source: "unit-production" });
  expect(
    productionInitOptions.length,
    "Production reporter selection should initialize Sentry.",
  ).toBe(1);

  const disabledInitOptions: unknown[] = [];
  const disabledClient: SentryBrowserBoundary = {
    init(options) {
      disabledInitOptions.push(options);
    },
    captureException() {
      return "event_exception";
    },
    captureMessage() {
      return "event_message";
    },
  };
  expect(
    initializeSentryErrorReporting({ client: disabledClient, enabled: false }),
    "Disabled Sentry initialization should report that no client was initialized.",
  ).toBeFalsy();
  expect(
    disabledInitOptions.length,
    "Disabled Sentry initialization should not call the SDK.",
  ).toBe(0);
  const disabledProbeUrls: string[] = [];
  expect(
    initializeSentryErrorReporting({
      client: disabledClient,
      enabled: false,
      dsn: "https://public@example.test/sentry/42",
      checkDsnReachability: true,
      fetchLike(input) {
        disabledProbeUrls.push(input);
        return Promise.resolve();
      },
    }),
    "Disabled Sentry initialization should still leave SDK reporting disabled.",
  ).toBeFalsy();
  await Promise.resolve();
  expect(
    disabledProbeUrls[0],
    "The DSN probe should still run when full Sentry reporting is disabled.",
  ).toBe(expectedTestEnvelopeUrl);
  expect(
    disabledInitOptions.length,
    "The dev probe should not initialize the SDK.",
  ).toBe(0);
  const probeInitOptions: unknown[] = [];
  const probeUrls: string[] = [];
  const probeClient: SentryBrowserBoundary = {
    init(options) {
      probeInitOptions.push(options);
    },
    captureException() {
      return "event_exception";
    },
    captureMessage() {
      return "event_message";
    },
  };
  expect(
    initializeSentryErrorReporting({
      client: probeClient,
      dsn: "https://public@example.test/sentry/42",
      checkDsnReachability: true,
      fetchLike(input) {
        probeUrls.push(input);
        return Promise.resolve();
      },
    }),
    "Enabled Sentry initialization should start successfully when the SDK initializes.",
  ).toBeTruthy();
  await Promise.resolve();
  expect(
    probeInitOptions.length,
    "The probe client should still initialize the SDK once.",
  ).toBe(1);
  expect(probeUrls[0], "Sentry init should probe DSN reachability.").toBe(
    expectedTestEnvelopeUrl,
  );
  expect(
    shouldEnableSentryErrorReporting({ isProduction: true, search: null }),
    "Production builds should enable Sentry reporting.",
  ).toBeTruthy();
  expect(
    shouldEnableSentryErrorReporting({ isProduction: false, search: null }),
    "Non-production builds should keep Sentry disabled by default.",
  ).toBeFalsy();
  expect(
    shouldEnableSentryErrorReporting({
      isProduction: false,
      search: "?cadEnableSentry=1",
    }),
    "The development query opt-in should enable Sentry reporting.",
  ).toBeTruthy();

  const releaseInitOptions: unknown[] = [];
  const releaseClient: SentryBrowserBoundary = {
    init(options) {
      releaseInitOptions.push(options);
    },
    captureException() {
      return "event_exception";
    },
    captureMessage() {
      return "event_message";
    },
  };
  initializeSentryErrorReporting({
    client: releaseClient,
    release: "cadara@abcdef",
    dist: "main",
  });
  expect(
    (releaseInitOptions[0] as { release?: string }).release,
    "Sentry initialization should pass the build release to the browser SDK.",
  ).toBe("cadara@abcdef");
  expect(
    (releaseInitOptions[0] as { dist?: string }).dist,
    "Sentry initialization should pass the build distribution to the browser SDK.",
  ).toBe("main");
  const tracingInitOptions: unknown[] = [];
  const tracingClient: SentryBrowserBoundary = {
    init(options) {
      tracingInitOptions.push(options);
    },
    captureException() {
      return "event_exception";
    },
    captureMessage() {
      return "event_message";
    },
  };
  initializeSentryErrorReporting({
    client: tracingClient,
    enablePerformanceTelemetry: true,
    tracesSampleRate: 0.02,
  });
  expect(
    (tracingInitOptions[0] as { tracesSampleRate?: number }).tracesSampleRate,
    "Sentry initialization should configure tracing only when performance telemetry is enabled.",
  ).toBe(0.02);
  const defaultTracingInitOptions: unknown[] = [];
  const defaultTracingClient: SentryBrowserBoundary = {
    init(options) {
      defaultTracingInitOptions.push(options);
    },
    captureException() {
      return "event_exception";
    },
    captureMessage() {
      return "event_message";
    },
  };
  initializeSentryErrorReporting({
    client: defaultTracingClient,
    enablePerformanceTelemetry: true,
  });
  expect(
    (defaultTracingInitOptions[0] as { tracesSampleRate?: number })
      .tracesSampleRate,
    "Sentry performance telemetry should default to full trace sampling.",
  ).toBe(1);
  expect(
    shouldEnablePerformanceTelemetry({
      isProduction: false,
      search: "?cadEnableSentry=1&cadEnablePerfTelemetry=1",
    }),
    "Development performance telemetry should require the explicit perf opt-in.",
  ).toBeTruthy();

  clearActiveDocumentTelemetryContext();
});
