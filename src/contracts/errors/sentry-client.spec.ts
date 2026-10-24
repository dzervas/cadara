import type { BrowserOptions } from "@sentry/browser";
import { expect, test } from "vitest";

import {
  initializeSentryErrorReporting,
  type SentryBrowserBoundary,
} from "@/contracts/errors/sentry-client";

function createInitRecordingClient() {
  const initOptions: BrowserOptions[] = [];
  const client: SentryBrowserBoundary = {
    init(options) {
      initOptions.push(options ?? {});
    },
    captureException() {
      return "event_exception";
    },
    captureMessage() {
      return "event_message";
    },
  };
  return { client, initOptions };
}

function integrationNames(options: BrowserOptions | undefined) {
  const integrations = options?.integrations;
  return Array.isArray(integrations)
    ? integrations.map((integration) => integration.name)
    : [];
}

test("src/contracts/errors/sentry-client.spec.ts", () => {
  const performance = createInitRecordingClient();
  initializeSentryErrorReporting({
    client: performance.client,
    enablePerformanceTelemetry: true,
  });
  const performanceOptions = performance.initOptions[0];

  expect(
    integrationNames(performanceOptions),
    "Performance telemetry should add error-only replay and browser tracing.",
  ).toEqual(["Replay", "BrowserTracing"]);
  expect(
    performanceOptions?.replaysSessionSampleRate,
    "Replay should never record whole sessions.",
  ).toBe(0);
  expect(
    performanceOptions?.replaysOnErrorSampleRate,
    "Replay should attach to every error event.",
  ).toBe(1);
  expect(
    performanceOptions?.tracesSampleRate,
    "Performance telemetry should keep full trace sampling.",
  ).toBe(1);
  expect(
    performanceOptions?.tracePropagationTargets,
    "Trace headers should stay on the SDK's same-origin default.",
  ).toBeUndefined();
  expect(
    performanceOptions && "enableLogs" in performanceOptions,
    "Sentry logs are unused and should not be enabled.",
  ).toBe(false);

  const errorsOnly = createInitRecordingClient();
  initializeSentryErrorReporting({ client: errorsOnly.client });
  const errorsOnlyOptions = errorsOnly.initOptions[0];

  expect(
    integrationNames(errorsOnlyOptions),
    "Without performance telemetry only error replay should be added.",
  ).toEqual(["Replay"]);
  expect(
    errorsOnlyOptions?.tracesSampleRate,
    "Without performance telemetry tracing should stay off.",
  ).toBeUndefined();
  expect(
    errorsOnlyOptions?.replaysOnErrorSampleRate,
    "Error replay should not depend on performance telemetry.",
  ).toBe(1);

  const disabled = createInitRecordingClient();
  initializeSentryErrorReporting({ client: disabled.client, enabled: false });
  expect(
    disabled.initOptions,
    "Disabled error reporting should not start replay or tracing.",
  ).toEqual([]);
});
