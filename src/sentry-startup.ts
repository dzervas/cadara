import {
  initializeSentryErrorReporting,
  shouldEnablePerformanceTelemetry,
  shouldEnableSentryErrorReporting,
} from "@/contracts/errors/sentry-client";
import { sentryDist, sentryRelease } from "@/build-info";

const sentryEnabled = shouldEnableSentryErrorReporting({
  isProduction: import.meta.env.PROD,
  search: typeof window === "undefined" ? null : window.location.search,
});
const performanceTelemetryEnabled =
  sentryEnabled &&
  shouldEnablePerformanceTelemetry({
    isProduction: import.meta.env.PROD,
    search: typeof window === "undefined" ? null : window.location.search,
  });

initializeSentryErrorReporting({
  enabled: sentryEnabled,
  enablePerformanceTelemetry: performanceTelemetryEnabled,
  environment: import.meta.env.MODE,
  release: sentryRelease,
  dist: sentryDist,
  checkDsnReachability: true,
});
