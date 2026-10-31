/**
 * Errors that a modeling service's initialization threw. A failed
 * initialization is final for that service: every later call rejects with the
 * same error instance, so its identity (not its message) tells callers that
 * the document never opened. The workbench's "Document could not be opened"
 * notice is the one outcome for it; other surfaces that hit the same error
 * defer to that notice instead of repeating it.
 */
const initializationFailures = new WeakSet<object>();

export function markModelingServiceInitializationFailure(error: unknown) {
  if (typeof error === "object" && error !== null)
    initializationFailures.add(error);
}

export function isModelingServiceInitializationFailure(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    initializationFailures.has(error)
  );
}
