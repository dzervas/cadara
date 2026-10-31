import type { ErrorReporter } from "@/contracts/errors";

/**
 * The server no longer publishes this tab's kernel version: a newer deploy
 * replaced it, because every deploy ships exactly one
 * /kernels/<content-version>/ directory. The tab must not fall back to another
 * kernel version; reloading loads the current app with its matching kernel.
 */
export class OccKernelVersionRetiredError extends Error {
  override name = "OccKernelVersionRetiredError";

  constructor(
    message = "CADara was updated; this tab's geometry engine is no longer available. Reload to continue.",
  ) {
    super(message);
  }
}

/**
 * Whether `error`, or an error it wraps, is a retired kernel. Every later
 * modeling call fails with it; the update notification is the only outcome.
 */
export function isOccKernelVersionRetiredFailure(error: unknown) {
  for (
    let current = error;
    typeof current === "object" && current !== null;
    current = (current as { cause?: unknown }).cause
  )
    if (current instanceof OccKernelVersionRetiredError) return true;
  return false;
}

/**
 * A retired kernel is a deploy, not a defect: failures it causes are not
 * reported.
 */
export function withoutOccKernelVersionRetiredReports(
  reporter: ErrorReporter,
): ErrorReporter {
  return {
    report: (error, metadata) =>
      isOccKernelVersionRetiredFailure(error)
        ? null
        : reporter.report(error, metadata),
  };
}

/** Whether the server answers this tab's kernel URL with 404. */
export async function isKernelVersionRetired(url: string) {
  // Unreachable (offline) proves nothing; the caller keeps its own error.
  const response = await fetch(url, { method: "HEAD" }).catch(() => null);
  return response?.status === 404;
}

let kernelVersionRetired = false;
const kernelVersionRetiredListeners = new Set<() => void>();

/**
 * Whether a deploy replaced this tab's kernel version, for the update
 * notification: the tab never loads another version's kernel, so only a
 * reload recovers.
 */
export const browserOccKernelVersionRetired = {
  mark() {
    if (kernelVersionRetired) return;
    kernelVersionRetired = true;
    for (const listener of kernelVersionRetiredListeners) listener();
  },
  subscribe(listener: () => void) {
    kernelVersionRetiredListeners.add(listener);
    return () => {
      kernelVersionRetiredListeners.delete(listener);
    };
  },
  getSnapshot: () => kernelVersionRetired,
};
