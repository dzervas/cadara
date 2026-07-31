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

function failedTopologyPrefix(
  consumerFeatureId: string,
  orderedPosition: number,
  error: {
    selector: {
      source: {
        consumerFeatureId: string;
        parameterId: string;
        deterministicId: string;
      };
    };
    detail: string | null;
  },
): TopologyConsumerPrefixResult {
  return {
    consumerFeatureId,
    orderedPosition,
    status: "failed",
    signatures: [],
    diagnostics: [{
      severity: "error",
      code: "topology-apply-rematch-failed",
      message: [
        `The pre-consumer prefix probe could not materialize ${error.selector.source.consumerFeatureId}:${error.selector.source.parameterId}:${error.selector.source.deterministicId}`,
        error.detail,
      ]
        .filter((part): part is string => Boolean(part))
        .join(": "),
    }],
  };
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
    try {
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
    } catch (error) {
      if (!isTopologyApplyRematchError(error)) throw error;
      const failed = failedTopologyPrefix(
        zeroConsumerFeatureId ?? "",
        0,
        error,
      );
      zeroBoundary = {
        status: failed.status,
        signatures: failed.signatures,
        diagnostics: failed.diagnostics,
      };
    }
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
  let probe: Awaited<ReturnType<ImportHistoryProbeCapabilities["evaluateHistoryProbe"]>>;
  try {
    probe = await input.history.evaluateHistoryProbe({
      actions: takePreparedActionPrefix(input.actions, longestPrefixPosition),
      consumerFeatureId: longestConsumerFeatureId,
      includeFinalTessellation: false,
      requestedSignatureStepOrdinals: prefixPositions
        .filter((position) => position > 0)
        .map((position) => position - 1),
      containTopologyRematchFailures: true,
    });
  } catch (error) {
    if (!isTopologyApplyRematchError(error)) throw error;
    // Retain the legacy diagnostic if an older probe implementation throws even
    // when containment is requested. Current kernel probes return this as a step.
    return consumers.map(({ consumerFeatureId, orderedPosition }) =>
      orderedPosition === 0
        ? { consumerFeatureId, orderedPosition, ...zeroBoundary }
        : failedTopologyPrefix(consumerFeatureId, orderedPosition, error),
    );
  }

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
