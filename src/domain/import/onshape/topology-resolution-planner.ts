import type {
  HistoryProbeStepDiagnostic,
  HistoryProbeTopologySignature,
  HistoryProbeExactTopologyEvidence,
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
  exactTopologyEvidence?: HistoryProbeExactTopologyEvidence;
  historicalSignatureSteps: readonly {
    orderedActionIndex: number;
    signatures: readonly HistoryProbeTopologySignature[];
  }[];
  status: "rebuilt" | "failed";
  /** Structured kernel diagnostics from the failed step, preserved verbatim. */
  diagnostics: readonly HistoryProbeStepDiagnostic[];
}


export async function probeTopologyConsumerPrefixes(input: {
  actions: ImportPreparedActions;
  /** Prefix length immediately before each Onshape feature is planned. */
  featureIdToOrderedPrefixPosition: ReadonlyMap<string, number>;
  consumerFeatureIds: readonly string[];
  history: ImportHistoryProbeCapabilities;
  /** Request every ordered prefix step for exact public-id continuity and lineage. */
  includeHistoricalSignatures?: boolean;
  /** Require the complete-history request to run in a fresh isolated service. */
  requireFreshExecution?: boolean;
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
  const historicalOrdinals = input.includeHistoricalSignatures
    ? Array.from({ length: longestPrefixPosition }, (_, ordinal) => ordinal)
    : [];
  let zeroBoundary: Pick<
    TopologyConsumerPrefixResult,
    "status" | "signatures" | "historicalSignatureSteps" | "diagnostics"
  > = { status: "rebuilt", signatures: [], historicalSignatureSteps: [], diagnostics: [] };

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
      ? { status: "failed", signatures: [], historicalSignatureSteps: [], diagnostics: boundary.diagnostics }
      : {
          status: "rebuilt",
          signatures: boundary?.signatures ?? [],
          ...(boundary?.exactTopologyEvidence
            ? { exactTopologyEvidence: boundary.exactTopologyEvidence }
            : {}),
          diagnostics: [],
          historicalSignatureSteps: [],
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
      .map((position) => position - 1)
      .concat(historicalOrdinals),
    requireFreshExecution: input.requireFreshExecution,
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
        historicalSignatureSteps: historicalOrdinals
          .filter((ordinal) => ordinal < orderedPosition)
          .flatMap((ordinal) => {
            const step = probe.steps[ordinal];
            return step?.status === "rebuilt"
              ? [{
                  orderedActionIndex: ordinal,
                  signatures: step.signatures,
                  ...(step.exactTopologyEvidence
                    ? { exactTopologyEvidence: step.exactTopologyEvidence }
                    : {}),
                }]
              : [];
          }),
        signatures: boundary.signatures,
        ...(boundary.exactTopologyEvidence
          ? { exactTopologyEvidence: boundary.exactTopologyEvidence }
          : {}),
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
      historicalSignatureSteps: [],
      diagnostics: failedBoundary?.status === "failed" ? failedBoundary.diagnostics : [],
    };
  });
}
