import type {
  CadaraDebugNamespace,
  DeveloperDebugSession,
  EditorRuntimeTraceSnapshot,
  SketchDebugSnapshot,
  WorkbenchDebugState,
} from "@/domain/debug/debug-platform";

export function isCadaraDebugPlatformEnabled(
  input: {
    dev: boolean;
    test?: boolean | string;
  } = {
    dev: import.meta.env.DEV,
    test: import.meta.env.TEST,
  },
) {
  return input.dev || input.test === true || input.test === "true";
}

export function createCadaraDebugNamespace(input: {
  getState: () => WorkbenchDebugState | null;
  getTrace: () => EditorRuntimeTraceSnapshot;
  selectTarget: (targetId: string) => boolean;
  clearSelection: () => void;
  refreshDocument: () => void;
  exportSession: () => DeveloperDebugSession;
  getSketchSnapshot: () => SketchDebugSnapshot | null;
}): CadaraDebugNamespace {
  return {
    version: 1,
    getState: () => input.getState(),
    getTrace: () => input.getTrace(),
    selectTarget: (targetId) => input.selectTarget(targetId),
    clearSelection: () => {
      input.clearSelection();
    },
    refreshDocument: () => {
      input.refreshDocument();
    },
    exportSession: () => input.exportSession(),
    getSketchSnapshot: () => input.getSketchSnapshot(),
  };
}

export function installCadaraDebugNamespace(
  namespace: CadaraDebugNamespace,
  targetWindow: Window = window,
) {
  targetWindow.__cadaraDebug = namespace;

  return () => {
    if (targetWindow.__cadaraDebug === namespace) {
      delete targetWindow.__cadaraDebug;
    }
  };
}
