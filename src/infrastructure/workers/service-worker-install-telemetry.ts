import type { WorkboxPlugin } from "workbox-core";

export interface ServiceWorkerInstallDiagnostic {
  type: "CADARA_SW_INSTALL";
  url: string;
  startedAt: number;
  elapsedMs: number;
  errorKind: string | null;
  message: string | null;
}

/** Progress survives in the page even if the browser terminates the worker. */
export function createServiceWorkerInstallTelemetry(
  publish: (diagnostic: ServiceWorkerInstallDiagnostic) => Promise<void>,
  now = Date.now,
): WorkboxPlugin {
  let startedAt: number | undefined;
  return {
    async handlerWillStart({ event, request }) {
      if (event.type !== "install") return;
      startedAt ??= now();
      await publish({
        type: "CADARA_SW_INSTALL",
        url: request.url,
        startedAt,
        elapsedMs: now() - startedAt,
        errorKind: null,
        message: null,
      });
    },
    async handlerDidError({ event, request, error }) {
      if (event.type !== "install") return;
      const start = startedAt ?? now();
      await publish({
        type: "CADARA_SW_INSTALL",
        url: request.url,
        startedAt: start,
        elapsedMs: now() - start,
        errorKind: error.name,
        message: error.message,
      });
      // No fallback response: Workbox must still reject this install.
    },
  };
}

export function isServiceWorkerInstallDiagnostic(
  value: unknown,
): value is ServiceWorkerInstallDiagnostic {
  if (!value || typeof value !== "object") return false;
  const diagnostic = value as Partial<ServiceWorkerInstallDiagnostic>;
  return (
    diagnostic.type === "CADARA_SW_INSTALL" &&
    typeof diagnostic.url === "string" &&
    typeof diagnostic.startedAt === "number" &&
    Number.isFinite(diagnostic.startedAt) &&
    typeof diagnostic.elapsedMs === "number" &&
    Number.isFinite(diagnostic.elapsedMs) &&
    (diagnostic.errorKind === null ||
      typeof diagnostic.errorKind === "string") &&
    (diagnostic.message === null || typeof diagnostic.message === "string")
  );
}
