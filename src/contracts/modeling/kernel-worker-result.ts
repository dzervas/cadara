import type { OccNativeTopologyCapabilityProbeResult, OccNativeTopologyDiagnostic } from "@/contracts/modeling/kernel-payloads";

export interface OccNativeTopologyUnavailableResult {
  kind: "nativeTopologyUnavailable";
  diagnostics: readonly OccNativeTopologyDiagnostic[];
  capability: OccNativeTopologyCapabilityProbeResult;
}

export type OccNativeTopologyWorkerResult<TPayload> =
  | {
      kind: "nativeTopologyPayload";
      payload: TPayload;
      diagnostics: readonly OccNativeTopologyDiagnostic[];
    }
  | OccNativeTopologyUnavailableResult;
