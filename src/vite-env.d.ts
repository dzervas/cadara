/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly TEST?: boolean | string;
}

interface Window {
  __cadaraDebug?: import("@/domain/debug/debug-platform").CadaraDebugNamespace;
  __cadProjectToScreen?: (objectId: string) => { x: number; y: number } | null;
  __cadProjectSectionHandleToScreen?: () => {
    handle: { x: number; y: number };
    normal: { x: number; y: number } | null;
    offset: number;
  } | null;
  __cadOccPerf?: {
    warmupStartedAt?: number;
    warmupSettledAt?: number | null;
    warmupStatus?: "idle" | "pending" | "fulfilled" | "rejected";
    warmupError?: string | null;
    firstSnapshotReadyAt?: number | null;
    firstNonEmptyGeometryFrameAt?: number | null;
    lastMutationLatencyMs?: number | null;
  };
  __cadMeasureOccMutation?: () => Promise<{
    elapsedMs: number;
    revisionId: string;
    accepted: boolean;
  } | null>;
}

declare const __CADARA_APP_VERSION__: string;
declare const __CADARA_GIT_COMMIT__: string;
declare const __CADARA_SENTRY_RELEASE__: string | null;
declare const __CADARA_SENTRY_DIST__: string | null;

interface Window {
  __CADARA_SINGLE_ASSETS__?: {
    icons?: Record<string, string>;
  };
}
