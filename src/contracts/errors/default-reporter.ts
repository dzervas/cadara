import {
  createConsoleErrorReporter,
  type ErrorReporter,
} from "@/contracts/errors/reporter";
import {
  createSentryErrorReporter,
  type SentryBrowserBoundary,
} from "@/contracts/errors/sentry-reporter";

interface ConsoleLike {
  error: (...args: unknown[]) => void;
}

interface DefaultErrorReporterOptions {
  isProduction: boolean;
  sentryClient?: SentryBrowserBoundary;
  consoleLike?: ConsoleLike;
}

export function createDefaultErrorReporter(
  options: DefaultErrorReporterOptions,
): ErrorReporter {
  if (options.isProduction) {
    return createSentryErrorReporter({
      client: options.sentryClient,
      consoleLike: options.consoleLike,
    });
  }

  return createConsoleErrorReporter(options.consoleLike);
}
