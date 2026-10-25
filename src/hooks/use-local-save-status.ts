import { useCallback, useSyncExternalStore } from "react";

import type { LocalSaveStatusSource } from "@/application/workspace/local-save-guard";
import type { LocalSaveStatus } from "@/domain/modeling/modeling-service";

/** The local save status of a service or of every open tab (cadara-8p7o). */
export function useLocalSaveStatus(
  source: LocalSaveStatusSource,
): LocalSaveStatus {
  const subscribe = useCallback(
    (listener: () => void) => source.subscribeToLocalSaveStatus(listener),
    [source],
  );
  const getSnapshot = useCallback(() => source.getLocalSaveStatus(), [source]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
