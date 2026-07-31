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
  const consumers = input.consumerFeatureIds.flatMap((consumerFeatureId) => {
    const orderedPosition = input.featureIdToOrderedPrefixPosition.get(consumerFeatureId);
    return orderedPosition === undefined ||
      !Number.isInteger(orderedPosition) ||
      orderedPosition < 0 ||
      orderedPosition > actionCount
      ? []
      : [{ consumerFeatureId, orderedPosition }];
  });
  const prefixPositions = [...new Set(consumers.map(({ orderedPosition }) => orderedPosition))]
    .sort((left, right) => left - right);
  const longestPrefixPosition = Math.max(0, ...prefixPositions);
  let zeroBoundary: Pick<
    TopologyConsumerPrefixResult,
    "status" | "signatures" | "diagnostics"
  > = { status: "rebuilt", signatures: [], diagnostics: [] };

  if (prefixPositions.includes(0)) {
    const zeroConsumerFeatureId = consumers.find(
      ({ orderedPosition }) => orderedPosition === 0,
    )?.consumerFeatureId;
    const zeroProbe = await input.history.evaluateHistoryProbe({
      actions: takePreparedActionPrefix(input.actions, 0),
      consumerFeatureId: zeroConsumerFeatureId,
      includeFinalTessellation: false,
      requestedSignatureStepOrdinals: [],
      containTopologyRematchFailures: true,
    });
    const boundary = zeroProbe.steps.at(-1);
    zeroBoundary = boundary?.status === "failed"
      ? { status: "failed", signatures: [], diagnostics: boundary.diagnostics }
      : {
          status: "rebuilt",
          signatures: boundary?.signatures ?? [],
          diagnostics: [],
        };
  }

  if (longestPrefixPosition === 0) {
    return consumers.map(({ consumerFeatureId, orderedPosition }) => ({
      consumerFeatureId,
      orderedPosition,
      ...zeroBoundary,
    }));
  }

  const longestConsumerFeatureId = consumers.find(
    ({ orderedPosition }) => orderedPosition === longestPrefixPosition,
  )?.consumerFeatureId;
  const probe = await input.history.evaluateHistoryProbe({
    actions: takePreparedActionPrefix(input.actions, longestPrefixPosition),
    consumerFeatureId: longestConsumerFeatureId,
    includeFinalTessellation: false,
    requestedSignatureStepOrdinals: prefixPositions
      .filter((position) => position > 0)
      .map((position) => position - 1),
    containTopologyRematchFailures: true,
  });

  return consumers.map(({ consumerFeatureId, orderedPosition }) => {
    if (orderedPosition === 0) {
      return { consumerFeatureId, orderedPosition, ...zeroBoundary };
    }
    const boundary = probe.steps[orderedPosition - 1];
    if (boundary?.status === "rebuilt") {
      return {
        consumerFeatureId,
        orderedPosition,
        status: "rebuilt" as const,
        signatures: boundary.signatures,
        diagnostics: [],
      };
    }
    const failedBoundary = boundary?.status === "failed"
      ? boundary
      : probe.steps.find((step) => step.status === "failed");
    return {
      consumerFeatureId,
      orderedPosition,
      status: "failed" as const,
      signatures: [],
      diagnostics: failedBoundary?.status === "failed" ? failedBoundary.diagnostics : [],
    };
  });
}
