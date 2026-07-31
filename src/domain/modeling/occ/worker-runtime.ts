import { OccWorkerClient } from "@/domain/modeling/occ/worker-client";
import type { GeometryAssetResolver } from "@/contracts/modeling/adapter";

export function canUseOccModuleWorker() {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

export function createBrowserOccWorkerClient(options: {
  assetResolver?: GeometryAssetResolver;
} = {}) {
  if (!canUseOccModuleWorker()) {
    return null;
  }

  return new OccWorkerClient({
    worker: new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    }),
    assetResolver: options.assetResolver,
    requestTimeoutMs: 30 * 60 * 1000,
  });
}
