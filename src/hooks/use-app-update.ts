import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { messageSW } from "workbox-window";

import { normalizeUnknownError } from "@/contracts/errors";
import { useErrorReporter } from "@/hooks/use-error-reporter";
import { useOccKernelVersionRetired } from "@/hooks/use-occ-kernel-version-retired";
import {
  isServiceWorkerInstallDiagnostic,
  type ServiceWorkerInstallDiagnostic,
} from "@/infrastructure/workers/service-worker-install-telemetry";

export const SERVICE_WORKER_UPDATE_INTERVAL_MS = 60 * 60 * 1000;

export function watchServiceWorkerInstallMessages(
  container: Pick<
    ServiceWorkerContainer,
    "addEventListener" | "removeEventListener"
  >,
  onDiagnostic: (
    worker: object,
    diagnostic: ServiceWorkerInstallDiagnostic,
  ) => void,
) {
  const onMessage = (event: MessageEvent) => {
    if (event.source && isServiceWorkerInstallDiagnostic(event.data))
      onDiagnostic(event.source, event.data);
  };
  container.addEventListener("message", onMessage);
  return () => container.removeEventListener("message", onMessage);
}

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
  registration: Pick<ServiceWorkerRegistration, "installing" | "update"> &
    Partial<Pick<ServiceWorkerRegistration, "active" | "scope">>,
  onCheckFailed: (error: unknown) => void,
  host: ServiceWorkerUpdateCheckHost = { window, document, navigator },
  migration?: {
    scriptURL: string;
    register: (url: string, options: RegistrationOptions) => Promise<unknown>;
  },
) {
  const check = () => {
    if (registration.installing || !host.navigator.onLine) return;
    // update() follows the ACTIVE script URL after a failed migration. That
    // endpoint may no longer exist; retry the shipped URL without unregistering
    // the working offline registration or discarding its caches. A failed
    // first install leaves no active worker and the browser drops the
    // registration, so update() would reject: register the shipped URL again.
    const active = registration.active;
    const update =
      migration && (!active || active.scriptURL !== migration.scriptURL)
        ? migration.register(migration.scriptURL, { scope: registration.scope })
        : registration.update();
    update.catch(onCheckFailed);
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
  onInstallFailed: (
    error: Error,
    diagnostic: ServiceWorkerInstallDiagnostic,
  ) => void,
  getDiagnostic: (
    worker: ServiceWorker,
  ) => ServiceWorkerInstallDiagnostic | undefined = () => undefined,
) {
  const watchInstalling = () => {
    const worker = registration.installing;
    if (!worker) return;
    const startedAt = Date.now();
    const onStateChange = () => {
      worker.removeEventListener("statechange", onStateChange);
      if (worker.state === "redundant") {
        const diagnostic = getDiagnostic(worker);
        // Explicit failures were already forwarded by the message listener.
        if (diagnostic?.errorKind) return;
        const start = diagnostic?.startedAt ?? startedAt;
        onInstallFailed(
          new Error(
            `The new service worker ${worker.scriptURL} failed to install.`,
          ),
          {
            type: "CADARA_SW_INSTALL",
            url: diagnostic?.url ?? worker.scriptURL,
            startedAt: start,
            elapsedMs: Date.now() - start,
            errorKind: "install-interrupted",
            message:
              "Worker became redundant without an explicit failure; termination cause unknown.",
          },
        );
      }
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
 * `kernelVersionRetired` turns true when a deploy already replaced this tab's
 * kernel on the server (no waiting worker needed): only a reload recovers.
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
  const installDiagnostics = useRef(
    new WeakMap<object, ServiceWorkerInstallDiagnostic>(),
  );
  const reportDeveloperFailure = useCallback(
    (operation: string, diagnostic?: ServiceWorkerInstallDiagnostic) =>
      (error: unknown) =>
        errorReporter.report(
          normalizeUnknownError(error, {
            code: "app/operation-failed",
            fallbackMessage: "The app update check failed.",
            context: [
              { key: "operation", value: operation },
              ...(diagnostic
                ? [
                    { key: "url", value: diagnostic.url },
                    { key: "errorKind", value: diagnostic.errorKind },
                    { key: "elapsedMs", value: diagnostic.elapsedMs },
                    { key: "installMessage", value: diagnostic.message },
                  ]
                : []),
            ],
          }),
          {
            source: "app-update",
            visibility: "developer",
            // Every open tab receives the worker's diagnostic; one install
            // attempt is reported once per tab, whichever signal arrives first.
            dedupeKey: diagnostic
              ? `app-update:install:${diagnostic.startedAt}:${diagnostic.url}`
              : `app-update:${operation}`,
          },
        ),
    [errorReporter],
  );
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    return watchServiceWorkerInstallMessages(
      navigator.serviceWorker,
      (worker, diagnostic) => {
        installDiagnostics.current.set(worker, diagnostic);
        if (diagnostic.errorKind)
          reportDeveloperFailure(
            "serviceWorker.install",
            diagnostic,
          )(new Error(diagnostic.message ?? diagnostic.errorKind));
      },
    );
  }, [reportDeveloperFailure]);
  // These options are read once, on the first render (upstream contract).
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(url, registration) {
      if (!registration) return;
      const stopChecks = startServiceWorkerUpdateChecks(
        registration,
        reportDeveloperFailure("serviceWorker.update"),
        { window, document, navigator },
        {
          scriptURL: new URL(url, window.location.href).href,
          register: (script, options) =>
            navigator.serviceWorker.register(script, options),
        },
      );
      const stopWatchingInstalls = watchServiceWorkerInstalls(
        registration,
        (error, diagnostic) =>
          reportDeveloperFailure("serviceWorker.install", diagnostic)(error),
        (worker) => installDiagnostics.current.get(worker),
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

  const kernelVersionRetired = useOccKernelVersionRetired();

  async function reload() {
    setPhase("saving");
    try {
      await updateReload.reload({
        waitForLocalChanges: async () => {
          await waitForLocalChanges();
          setPhase("reloading");
        },
        // Without a waiting worker the new build is already being served.
        activateWaitingWorker: needRefresh
          ? updateServiceWorker
          : async () => window.location.reload(),
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

  return { needRefresh, kernelVersionRetired, version, phase, reload };
}
