import { useSyncExternalStore } from "react";

import { browserOccKernelVersionRetired } from "@/infrastructure/occ/kernel-version-retired";

/**
 * Whether a deploy retired this tab's kernel. Every modeling failure after
 * that is the engine's, and the update notification's reload is the only
 * outcome, so surfaces that report such failures stay quiet.
 */
export function useOccKernelVersionRetired() {
  return useSyncExternalStore(
    browserOccKernelVersionRetired.subscribe,
    browserOccKernelVersionRetired.getSnapshot,
    browserOccKernelVersionRetired.getSnapshot,
  );
}
