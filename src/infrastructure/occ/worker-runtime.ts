import {
  OccWorkerClient,
  type OccWorkerClientOptions,
} from "@/infrastructure/occ/worker-client";
import type { GeometryAssetResolver } from "@/contracts/modeling/adapter";
import {
  canUseOccModuleWorker,
  createOccModuleWorker,
  takeStartedOccModuleWorker,
} from "@/infrastructure/occ/occ-module-worker";

export { canUseOccModuleWorker };

export function createBrowserOccWorkerClient(options: {
  assetResolver?: GeometryAssetResolver;
  onFatalError?: (error: Error) => void;
  onEngineDownloadProgress?: OccWorkerClientOptions["onEngineDownloadProgress"];
} = {}) {
  if (!canUseOccModuleWorker()) {
    return null;
  }

  return new OccWorkerClient({
    worker: takeStartedOccModuleWorker() ?? createOccModuleWorker(),
    createWorker: createOccModuleWorker,
    onFatalError: options.onFatalError,
    onEngineDownloadProgress: options.onEngineDownloadProgress,
    assetResolver: options.assetResolver,
    requestTimeoutMs: 30 * 60 * 1000,
  });
}
