import type {
  HistoryProbeTopologySignature,
  ImportHistoryProbeCapabilities,
} from "@/contracts/import/capabilities";
import type { ImportPreparedActions } from "@/contracts/import/actions";
import {
  getOrderedActionRefs,
  takePreparedActionPrefix,
} from "@/domain/import/kernel-history-probe";

export interface TopologyConsumerPrefixResult {
  consumerFeatureId: string;
  orderedPosition: number;
  signatures: readonly HistoryProbeTopologySignature[];
  status: "rebuilt" | "failed";
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
    const probe = await input.history.evaluateHistoryProbe({
      actions: takePreparedActionPrefix(input.actions, orderedPosition),
      consumerFeatureId,
      includeFinalTessellation: false,
    });
    const last = probe.steps.at(-1);
    results.push({
      consumerFeatureId,
      orderedPosition,
      status: last?.status === "failed" ? "failed" : "rebuilt",
      signatures: last?.status === "rebuilt" ? last.signatures : [],
    });
  }
  return results;
}
