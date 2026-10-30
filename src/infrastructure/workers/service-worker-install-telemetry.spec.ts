// Logic lane: Workbox plugin callbacks publish progress and explicit causes
// without returning a fallback that would accidentally accept a broken install.
import { expect, test } from "vitest";

import {
  createServiceWorkerInstallTelemetry,
  type ServiceWorkerInstallDiagnostic,
} from "./service-worker-install-telemetry";

test("install telemetry preserves the failing URL, error kind and elapsed time", async () => {
  const error = Object.assign(new Error("Asset returned 503"), {
    name: "bad-precaching-response",
  });
  let now = 1000;
  const diagnostics: ServiceWorkerInstallDiagnostic[] = [];
  const plugin = createServiceWorkerInstallTelemetry(
    async (diagnostic) => {
      diagnostics.push(diagnostic);
    },
    () => now,
  );
  const request = new Request("https://cadara.test/assets/lazy-hash.js");
  const event = { type: "install" } as Parameters<
    NonNullable<typeof plugin.handlerWillStart>
  >[0]["event"];
  await plugin.handlerWillStart!({ event, request });
  now += 850;
  expect(
    await plugin.handlerDidError!({ event, request, error }),
  ).toBeUndefined();
  expect(diagnostics).toEqual([
    {
      type: "CADARA_SW_INSTALL",
      url: request.url,
      startedAt: 1000,
      elapsedMs: 0,
      errorKind: null,
      message: null,
    },
    {
      type: "CADARA_SW_INSTALL",
      url: request.url,
      startedAt: 1000,
      elapsedMs: 850,
      errorKind: error.name,
      message: error.message,
    },
  ]);
});

test("ordinary fetch failures are not mislabeled as install failures", async () => {
  const diagnostics: ServiceWorkerInstallDiagnostic[] = [];
  const plugin = createServiceWorkerInstallTelemetry(async (diagnostic) => {
    diagnostics.push(diagnostic);
  });
  const request = new Request("https://cadara.test/assets/lazy-hash.js");
  const event = { type: "fetch" } as Parameters<
    NonNullable<typeof plugin.handlerWillStart>
  >[0]["event"];
  await plugin.handlerWillStart!({ event, request });
  await plugin.handlerDidError!({
    event,
    request,
    error: new TypeError("offline"),
  });
  expect(diagnostics).toEqual([]);
});
