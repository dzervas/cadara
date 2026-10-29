export function canUseOccModuleWorker() {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

export function createOccModuleWorker() {
  return new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
}

const TRANSPORT_FAILURE_EVENTS = ["error", "messageerror"] as const;

interface StartedOccModuleWorker {
  worker: Worker;
  failure: (typeof TRANSPORT_FAILURE_EVENTS)[number] | null;
  record: (event: Event) => void;
}

let started: StartedOccModuleWorker | null = null;

/**
 * Starts the OCC worker from the app entry, before the editor bundle loads:
 * the worker's module evaluation (about a second) then overlaps the editor's
 * instead of following it. The browser worker client adopts it with
 * takeStartedOccModuleWorker. The worker answers requests only, so the one
 * thing it can emit before then is a transport failure (a module that does
 * not load or throws), which is kept for the client.
 */
export function startOccModuleWorker() {
  if (started || !canUseOccModuleWorker()) return;
  const worker = createOccModuleWorker();
  const entry: StartedOccModuleWorker = {
    worker,
    failure: null,
    record: (event) => {
      entry.failure ??= event.type as (typeof TRANSPORT_FAILURE_EVENTS)[number];
    },
  };
  for (const type of TRANSPORT_FAILURE_EVENTS)
    worker.addEventListener(type, entry.record);
  started = entry;
}

/**
 * The started worker, or null when none was started; the caller owns it and
 * attaches its listeners synchronously. A transport failure the worker had
 * before is dispatched to them again right after.
 */
export function takeStartedOccModuleWorker() {
  const entry = started;
  started = null;
  if (!entry) return null;
  for (const type of TRANSPORT_FAILURE_EVENTS)
    entry.worker.removeEventListener(type, entry.record);
  const failure = entry.failure;
  if (failure)
    queueMicrotask(() => entry.worker.dispatchEvent(new Event(failure)));
  return entry.worker;
}
