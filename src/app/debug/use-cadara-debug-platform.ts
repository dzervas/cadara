import { useEffect, useEffectEvent } from "react";

import type {
  DeveloperDebugSession,
  EditorRuntimeTraceSnapshot,
  WorkbenchDebugState,
} from "@/domain/debug/debug-platform";
import {
  createCadaraDebugNamespace,
  installCadaraDebugNamespace,
  isCadaraDebugPlatformEnabled,
} from "@/app/debug/cadara-debug-bridge";

export function useCadaraDebugPlatform(input: {
  getState: () => WorkbenchDebugState | null;
  getTrace: () => EditorRuntimeTraceSnapshot;
  selectTarget: (targetId: string) => boolean;
  clearSelection: () => void;
  refreshDocument: () => void;
  exportSession: () => DeveloperDebugSession;
}) {
  const getState = useEffectEvent(input.getState);
  const getTrace = useEffectEvent(input.getTrace);
  const selectTarget = useEffectEvent(input.selectTarget);
  const clearSelection = useEffectEvent(input.clearSelection);
  const refreshDocument = useEffectEvent(input.refreshDocument);
  const exportSession = useEffectEvent(input.exportSession);

  useEffect(() => {
    if (typeof window === "undefined" || !isCadaraDebugPlatformEnabled()) {
      return undefined;
    }

    return installCadaraDebugNamespace(
      createCadaraDebugNamespace({
        getState: () => getState(),
        getTrace: () => getTrace(),
        selectTarget: (targetId) => selectTarget(targetId),
        clearSelection: () => {
          clearSelection();
        },
        refreshDocument: () => {
          refreshDocument();
        },
        exportSession: () => exportSession(),
      }),
    );
  }, []);
}
