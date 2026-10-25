import {
  OccWorkerClient,
  type OccWorkerClientOptions,
} from "@/domain/modeling/occ/worker-client";
import type { GeometryAssetResolver } from "@/contracts/modeling/adapter";

export function canUseOccModuleWorker() {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

export function createBrowserOccWorkerClient(options: {
  assetResolver?: GeometryAssetResolver;
  onFatalError?: (error: Error) => void;
  onEngineDownloadProgress?: OccWorkerClientOptions["onEngineDownloadProgress"];
} = {}) {
  if (!canUseOccModuleWorker()) {
    return null;
  }

  const createWorker = () => new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  return new OccWorkerClient({
    worker: createWorker(),
    createWorker,
    onFatalError: options.onFatalError,
    onEngineDownloadProgress: options.onEngineDownloadProgress,
    assetResolver: options.assetResolver,
    requestTimeoutMs: 30 * 60 * 1000,
  });
}
