import type { WorkspaceSnapshot } from "@/contracts/modeling/schema";
import type { ModelingService } from "@/domain/modeling/modeling-service";

export function shouldEnableOccPerfBridge() {
  if (typeof window === "undefined") {
    return false;
  }

  return (
    import.meta.env.DEV ||
    new URLSearchParams(window.location.search).has("cadPerfMode")
  );
}

export function installOccPerfMutationBridge(input: {
  getSnapshot: () => WorkspaceSnapshot | null;
  modelingService: Pick<ModelingService, "addDocumentVariable">;
}) {
  if (typeof window === "undefined" || !shouldEnableOccPerfBridge()) {
    return undefined;
  }

  window.__cadMeasureOccMutation = async () => {
    const currentSnapshot = input.getSnapshot();
    if (!currentSnapshot) {
      return null;
    }

    const startedAt = performance.now();
    const result = await input.modelingService.addDocumentVariable({
      baseRevisionId: currentSnapshot.document.revisionId,
      name: `__cad_occ_perf_${Date.now()}`,
      valueText: "1",
    });
    const elapsedMs = performance.now() - startedAt;

    window.__cadOccPerf = {
      warmupStatus: "idle",
      ...window.__cadOccPerf,
      lastMutationLatencyMs: elapsedMs,
    };

    return result.match(
      (value) => ({
        elapsedMs,
        revisionId: value.revisionId,
        accepted: value.revisionState.kind === "accepted",
      }),
      () => ({
        elapsedMs,
        revisionId: currentSnapshot.document.revisionId,
        accepted: false,
      }),
    );
  };

  return () => {
    delete window.__cadMeasureOccMutation;
  };
}
