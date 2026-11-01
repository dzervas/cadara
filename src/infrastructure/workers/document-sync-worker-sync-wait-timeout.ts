/** The part of a worker's global scope that receives unhandled rejections. */
export interface UnhandledRejectionScope {
  addEventListener(
    type: "unhandledrejection",
    listener: (event: PromiseRejectionEvent) => void,
  ): void;
}

/**
 * automerge-repo's DocHandle.whenReady timeout. The library does not export
 * its TimeoutError class, so it is recognised by name and message.
 */
function isAutomergeWhenReadyTimeout(reason: unknown): reason is Error {
  return (
    reason instanceof Error &&
    reason.name === "TimeoutError" &&
    reason.message.startsWith("withTimeout:")
  );
}

/**
 * automerge-repo starts a background wait whenever a peer announces a
 * document this Repo does not have yet. It waits up to 60 s for the
 * document to become ready and nothing awaits the result (DocSynchronizer
 * beginSync, called with `void`). When the announcing peer stops sending
 * before the document arrives (e.g. this worker's room link drops
 * mid-fetch and stays down), the wait rejects with no handler. The
 * document itself is unaffected: a later load reports its own
 * unavailability. So the worker reports the
 * timeout instead of letting it surface as an uncaught error. Every other
 * rejection passes through unchanged.
 */
export function reportAbandonedAutomergeSyncWaits(
  scope: UnhandledRejectionScope,
  report: (error: Error) => void,
) {
  scope.addEventListener("unhandledrejection", (event) => {
    if (!isAutomergeWhenReadyTimeout(event.reason)) return;
    event.preventDefault();
    report(event.reason);
  });
}
