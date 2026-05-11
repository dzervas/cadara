import { OccWorkerClient } from "@/domain/modeling/occ/worker-client";

export function canUseOccModuleWorker() {
  return typeof Worker !== "undefined" && typeof URL !== "undefined";
}

export function createBrowserOccWorkerClient() {
  if (!canUseOccModuleWorker()) {
    return null;
  }

  return new OccWorkerClient({
    worker: new Worker(new URL("./worker.ts", import.meta.url), {
      type: "module",
    }),
  });
}
