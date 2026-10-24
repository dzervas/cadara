import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { messageSW } from "workbox-window";

import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "@/hooks/use-error-reporter";

export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

interface ServiceWorkerUpdateCheckHost {
  window: Pick<
    Window,
    "addEventListener" | "removeEventListener" | "setInterval" | "clearInterval"
  >;
  document: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
  navigator: Pick<Navigator, "onLine">;
}

/**
 * Asks the browser for a newer service worker every hour, when the tab
 * becomes visible and when the network returns. A new deploy changes the
 * worker script (its precache manifest), so the browser installs it.
 * Returns the disposer that stops the checks.
 */
export function startServiceWorkerUpdateChecks(
  registration: Pick<ServiceWorkerRegistration, "installing" | "update">,
  onCheckFailed: (error: unknown) => void,
  host: ServiceWorkerUpdateCheckHost = { window, document, navigator },
) {
  const check = () => {
    if (registration.installing || !host.navigator.onLine) return;
    registration.update().catch(onCheckFailed);
  };
  const checkWhenVisible = () => {
    if (host.document.visibilityState === "visible") check();
  };
  const interval = host.window.setInterval(
    check,
    SERVICE_WORKER_UPDATE_INTERVAL_MS,
  );
  host.document.addEventListener("visibilitychange", checkWhenVisible);
  host.window.addEventListener("online", check);
  return () => {
    host.window.clearInterval(interval);
    host.document.removeEventListener("visibilitychange", checkWhenVisible);
    host.window.removeEventListener("online", check);
  };
}

/**
 * Reports a new worker whose install failed: it turns redundant straight from
 * "installing" (for example a precache download that broke off, or storage
 * quota). `update()` already resolved once the script was fetched, so nothing
 * else hears about it; Workbox keeps the entries it cached, and the next check
 * retries the rest. Returns the disposer that stops watching.
 */
export function watchServiceWorkerInstalls(
  registration: Pick<
    ServiceWorkerRegistration,
    "installing" | "addEventListener" | "removeEventListener"
  >,
  onInstallFailed: (error: Error) => void,
) {
  const watchInstalling = () => {
    const worker = registration.installing;
    if (!worker) return;
    const onStateChange = () => {
      worker.removeEventListener("statechange", onStateChange);
      if (worker.state === "redundant")
        onInstallFailed(
          new Error(
            `The new service worker ${worker.scriptURL} failed to install.`,
          ),
        );
    };
    worker.addEventListener("statechange", onStateChange);
  };
  registration.addEventListener("updatefound", watchInstalling);
  // An install already running when the page registered.
  watchInstalling();
  return () =>
    registration.removeEventListener("updatefound", watchInstalling);
}

/**
 * The Reload sequence. The page reloads only after every local change
 * requested before the click is persisted, and only in the tab whose user
 * asked: another tab's Reload also hands this tab to the new worker, which
 * then just reloads on its own Reload.
 */
export function createAppUpdateReload(reloadPage: () => void) {
  let reloadRequested = false;
  let newWorkerControls = false;
  return {
    /** The new worker controls this tab (vite-plugin-pwa `onNeedReload`). */
    onNewWorkerControls() {
      newWorkerControls = true;
      if (reloadRequested) reloadPage();
    },
    async reload({
      waitForLocalChanges,
      activateWaitingWorker,
    }: {
      waitForLocalChanges: () => Promise<void>;
      activateWaitingWorker: () => Promise<void>;
    }) {
      await waitForLocalChanges();
      reloadRequested = true;
      if (newWorkerControls) reloadPage();
      else await activateWaitingWorker();
    },
  };
}

export type AppUpdatePhase = "idle" | "saving" | "reloading";

/**
 * The production service worker's update prompt (vite-plugin-pwa
 * `registerType: "prompt"`). `needRefresh` turns true when a new build is
 * installed and waiting, in every open tab; the first install shows nothing.
 */
export function useAppUpdate(waitForLocalChanges: () => Promise<void>) {
  const errorReporter = useErrorReporter();
  const [phase, setPhase] = useState<AppUpdatePhase>("idle");
  const [version, setVersion] = useState<string | null>(null);
  const [updateReload] = useState(() =>
    createAppUpdateReload(() => window.location.reload()),
  );
  const stopWatchingRegistration = useRef<(() => void) | null>(null);
  useEffect(() => () => stopWatchingRegistration.current?.(), []);
  const reportDeveloperFailure = (operation: string) => (error: unknown) =>
    errorReporter.report(
      normalizeUnknownError(error, {
        code: "app/operation-failed",
        fallbackMessage: "The app update check failed.",
        context: [{ key: "operation", value: operation }],
      }),
      {
        source: "app-update",
        visibility: "developer",
        dedupeKey: `app-update:${operation}`,
      },
    );
  // These options are read once, on the first render (upstream contract).
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const stopChecks = startServiceWorkerUpdateChecks(
        registration,
        reportDeveloperFailure("serviceWorker.update"),
      );
      const stopWatchingInstalls = watchServiceWorkerInstalls(
        registration,
        reportDeveloperFailure("serviceWorker.install"),
      );
      stopWatchingRegistration.current = () => {
        stopChecks();
        stopWatchingInstalls();
      };
    },
    onNeedRefresh() {
      void navigator.serviceWorker
        .getRegistration()
        .then((registration) =>
          registration?.waiting
            ? messageSW(registration.waiting, { type: "GET_VERSION" })
            : null,
        )
        .then(
          (label: unknown) => {
            if (typeof label === "string") setVersion(label);
          },
          reportDeveloperFailure("serviceWorker.version"),
        );
    },
    onNeedReload: updateReload.onNewWorkerControls,
    onRegisterError: reportDeveloperFailure("serviceWorker.register"),
  });

  async function reload() {
    setPhase("saving");
    try {
      await updateReload.reload({
        waitForLocalChanges: async () => {
          await waitForLocalChanges();
          setPhase("reloading");
        },
        activateWaitingWorker: updateServiceWorker,
      });
    } catch (error) {
      setPhase("idle");
      errorReporter.report(
        normalizeUnknownError(error, {
          code: "app/operation-failed",
          fallbackMessage:
            "Local changes could not be saved, so CADara did not reload.",
          context: [{ key: "operation", value: "appUpdate.reload" }],
        }),
        { source: "app-update", visibility: "user" },
      );
    }
  }

  return { needRefresh, version, phase, reload };
}
