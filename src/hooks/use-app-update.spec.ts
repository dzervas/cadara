// UI lane (src/hooks, docs/testing.md). Seams: the service worker update
// checks the app schedules on its registration, and the update prompt's
// Reload sequence, both driven through fakes of the browser objects.
import { expect, test } from "vitest";

import {
  SERVICE_WORKER_UPDATE_INTERVAL_MS,
  createAppUpdateReload,
  startServiceWorkerUpdateChecks,
  watchServiceWorkerInstalls,
} from "@/hooks/use-app-update";

function fakeUpdateCheckHost() {
  const listeners = new Map<string, () => void>();
  const intervals: { callback: () => void; delay: number; cleared: boolean }[] =
    [];
  const remove = (key: string, listener: () => void) => {
    if (listeners.get(key) === listener) listeners.delete(key);
  };
  const host = {
    window: {
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(`window:${type}`, listener),
      removeEventListener: (type: string, listener: () => void) =>
        remove(`window:${type}`, listener),
      setInterval: (callback: () => void, delay: number) =>
        intervals.push({ callback, delay, cleared: false }) - 1,
      clearInterval: (id: number) => {
        intervals[id]!.cleared = true;
      },
    },
    document: {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (type: string, listener: () => void) =>
        listeners.set(`document:${type}`, listener),
      removeEventListener: (type: string, listener: () => void) =>
        remove(`document:${type}`, listener),
    },
    navigator: { onLine: true },
  };
  return { host, listeners, intervals };
}

test("the service worker is checked for updates hourly, when the tab becomes visible and when the network returns, never while offline or installing", async () => {
  const { host, listeners, intervals } = fakeUpdateCheckHost();
  const registration = {
    installing: null as ServiceWorker | null,
    updates: 0,
    async update() {
      registration.updates += 1;
    },
  };
  startServiceWorkerUpdateChecks(
    registration as unknown as ServiceWorkerRegistration,
    (error) => {
      throw error;
    },
    host as never,
  );
  expect(intervals.map((interval) => interval.delay)).toEqual([
    SERVICE_WORKER_UPDATE_INTERVAL_MS,
  ]);
  expect(SERVICE_WORKER_UPDATE_INTERVAL_MS).toBe(60 * 60 * 1000);

  intervals[0]!.callback();
  listeners.get("document:visibilitychange")!();
  listeners.get("window:online")!();
  expect(registration.updates).toBe(3);

  host.document.visibilityState = "hidden";
  listeners.get("document:visibilitychange")!();
  host.document.visibilityState = "visible";
  host.navigator.onLine = false;
  intervals[0]!.callback();
  host.navigator.onLine = true;
  registration.installing = {} as ServiceWorker;
  intervals[0]!.callback();
  expect(registration.updates, "no check while hidden/offline/installing").toBe(
    3,
  );
});

test("the update checks' disposer clears the interval and removes both listeners", () => {
  const { host, listeners, intervals } = fakeUpdateCheckHost();
  const stop = startServiceWorkerUpdateChecks(
    {
      installing: null,
      update: () => Promise.resolve({} as ServiceWorkerRegistration),
    },
    (error) => {
      throw error;
    },
    host as never,
  );
  expect([...listeners.keys()].sort()).toEqual([
    "document:visibilitychange",
    "window:online",
  ]);
  stop();
  expect(listeners.size).toBe(0);
  expect(intervals.map((interval) => interval.cleared)).toEqual([true]);
});

function fakeServiceWorker(scriptURL: string) {
  const worker = new EventTarget() as EventTarget & {
    state: ServiceWorkerState;
    scriptURL: string;
  };
  worker.state = "installing";
  worker.scriptURL = scriptURL;
  return {
    worker,
    becomes(state: ServiceWorkerState) {
      worker.state = state;
      worker.dispatchEvent(new Event("statechange"));
    },
  };
}

test("a new worker whose install fails (redundant straight from installing) is reported; a successful install, or a waiting worker superseded later, is not", () => {
  const registration = new EventTarget() as EventTarget & {
    installing: ServiceWorker | null;
  };
  const failed = fakeServiceWorker("https://cadara.local/service-worker.js");
  // An install already running when the page registered is watched too.
  registration.installing = failed.worker as unknown as ServiceWorker;
  const reported: Error[] = [];
  const stop = watchServiceWorkerInstalls(registration, (error) =>
    reported.push(error),
  );
  failed.becomes("redundant");
  expect(reported.map((error) => error.message)).toEqual([
    "The new service worker https://cadara.local/service-worker.js failed to install.",
  ]);

  const installed = fakeServiceWorker("https://cadara.local/service-worker.js");
  registration.installing = installed.worker as unknown as ServiceWorker;
  registration.dispatchEvent(new Event("updatefound"));
  installed.becomes("installed");
  installed.becomes("redundant");
  expect(reported, "superseded after installing is not a failure").toHaveLength(
    1,
  );

  stop();
  const unwatched = fakeServiceWorker("https://cadara.local/service-worker.js");
  registration.installing = unwatched.worker as unknown as ServiceWorker;
  registration.dispatchEvent(new Event("updatefound"));
  unwatched.becomes("redundant");
  expect(reported, "nothing is watched after the disposer").toHaveLength(1);
});

test("a failed update check is handed to the failure handler", async () => {
  const { host, intervals } = fakeUpdateCheckHost();
  const failure = new TypeError("Failed to update a ServiceWorker");
  const failures: unknown[] = [];
  startServiceWorkerUpdateChecks(
    { installing: null, update: () => Promise.reject(failure) },
    (error) => failures.push(error),
    host as never,
  );
  intervals[0]!.callback();
  await Promise.resolve();
  await Promise.resolve();
  expect(failures).toEqual([failure]);
});

test("Reload activates the waiting worker only after the local changes are persisted, then reloads once the new worker controls the tab", async () => {
  const events: string[] = [];
  const reload = createAppUpdateReload(() => events.push("reload page"));
  let persist!: () => void;
  const reloading = reload.reload({
    waitForLocalChanges: () =>
      new Promise<void>((resolve) => {
        events.push("wait for local changes");
        persist = () => {
          events.push("local changes persisted");
          resolve();
        };
      }),
    activateWaitingWorker: async () => {
      events.push("activate waiting worker");
    },
  });
  await Promise.resolve();
  expect(events, "nothing activates while saving").toEqual([
    "wait for local changes",
  ]);
  persist();
  await reloading;
  reload.onNewWorkerControls();
  expect(events).toEqual([
    "wait for local changes",
    "local changes persisted",
    "activate waiting worker",
    "reload page",
  ]);
});

test("another tab's Reload hands this tab to the new worker without reloading it; its own Reload then reloads without activating again", async () => {
  const events: string[] = [];
  const reload = createAppUpdateReload(() => events.push("reload page"));
  reload.onNewWorkerControls();
  expect(events, "the other tab is not reloaded").toEqual([]);
  await reload.reload({
    waitForLocalChanges: async () => {
      events.push("local changes persisted");
    },
    activateWaitingWorker: async () => {
      events.push("activate waiting worker");
    },
  });
  expect(events).toEqual(["local changes persisted", "reload page"]);
});
