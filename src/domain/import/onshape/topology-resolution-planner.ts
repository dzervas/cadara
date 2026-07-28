import type {
  HistoryProbeStepDiagnostic,
  HistoryProbeTopologySignature,
  ImportHistoryProbeCapabilities,
} from "@/contracts/import/capabilities";
import type { ImportPreparedActions } from "@/contracts/import/actions";
import {
  getOrderedActionRefs,
  takePreparedActionPrefix,
} from "@/domain/import/kernel-history-probe";
import { isTopologyApplyRematchError } from "@/domain/import/orchestrator";

export interface TopologyConsumerPrefixResult {
  consumerFeatureId: string;
  orderedPosition: number;
  signatures: readonly HistoryProbeTopologySignature[];
  status: "rebuilt" | "failed";
  /** Structured kernel diagnostics from the failed step, preserved verbatim. */
  diagnostics: readonly HistoryProbeStepDiagnostic[];
}

/**
 * Probe the growing parametric history immediately before each declared topology
 * consumer. Final tessellation is deliberately not requested here; it belongs to
 * whole-plan verification only.
 */
export async function probeTopologyConsumerPrefixes(input: {
  actions: ImportPreparedActions;
  /** Prefix length immediately before each Onshape feature is planned. */
  featureIdToOrderedPrefixPosition: ReadonlyMap<string, number>;
  consumerFeatureIds: readonly string[];
  history: ImportHistoryProbeCapabilities;
}): Promise<readonly TopologyConsumerPrefixResult[]> {
  const actionCount = getOrderedActionRefs(input.actions).length;

  const results: TopologyConsumerPrefixResult[] = [];
  for (const consumerFeatureId of input.consumerFeatureIds) {
    const orderedPosition = input.featureIdToOrderedPrefixPosition.get(consumerFeatureId);
    if (orderedPosition === undefined || orderedPosition > actionCount) continue;
    let probe: Awaited<ReturnType<ImportHistoryProbeCapabilities["evaluateHistoryProbe"]>>;
    try {
      probe = await input.history.evaluateHistoryProbe({
        actions: takePreparedActionPrefix(input.actions, orderedPosition),
        consumerFeatureId,
        includeFinalTessellation: false,
      });
    } catch (error) {
      if (!isTopologyApplyRematchError(error)) throw error;
      // A pre-consumer prefix is a deliberately reduced action list: bake
      // checkpoints are suppressed for sub-topology consumers, so a baked run
      // inside the prefix contributes no bodies at all. Another feature's
      // apply-time rematch failing against that prefix is therefore a
      // probe-session artifact, not evidence about apply, and it must not
      // decide that feature's tier. Report a failed prefix for THIS consumer
      // (verbatim, so the cause stays visible) and leave the offending feature
      // eligible; the whole-plan probes, which build the same sequence apply
      // does, own that decision.
      results.push({
        consumerFeatureId,
        orderedPosition,
        status: "failed",
        signatures: [],
        diagnostics: [
          {
            severity: "error",
            code: "topology-apply-rematch-failed",
            message: [
              `The pre-consumer prefix probe could not materialize ${error.selector.source.consumerFeatureId}:${error.selector.source.parameterId}:${error.selector.source.deterministicId}`,
              error.detail,
            ]
              .filter((part): part is string => Boolean(part))
              .join(": "),
          },
        ],
      });
      continue;
    }
    const last = probe.steps.at(-1);
    results.push({
      consumerFeatureId,
      orderedPosition,
      status: last?.status === "failed" ? "failed" : "rebuilt",
      signatures: last?.status === "rebuilt" ? last.signatures : [],
      diagnostics: last?.status === "failed" ? last.diagnostics : [],
    });
  }
  return results;
}
